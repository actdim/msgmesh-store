import type { Subscription } from 'rxjs';
import { toStoreCdcObservable } from '../cdc/cdcStream';
import type { StoreCdcEvent, StoreCdcOrigin } from '../cdc/types';
import { KeyedSerialQueue } from '../core/keyedQueue';
import {
    applyStoreCommand,
    resolveMutationTarget,
    buildNestedPathPatch,
    type MutationTarget,
    type NormalizedStoreCommand,
} from '../core/applyMutation';
import {
    WorkerHostStorageError,
    type StoreOrFactory,
    type WorkerBatchResultItem,
    type WorkerClientRequest,
    type WorkerCommandRequest,
    type WorkerHostController,
    type WorkerHostMessage,
    type WorkerHostOptions,
    type WorkerMessageEventLike,
    type WorkerMessagePortLike,
    type WorkerQueryRequest,
} from './types';
import { addPortListener, removePortListener } from './channel';

export { buildNestedPathPatch };

/**
 * Fast-fails if a LiveStruct / LiveStore target is not configured for in-memory execution.
 */
export function validateStoreForWorker(store: unknown): void {
    if (!store || typeof store !== 'object') {
        return;
    }
    const rec = store as Record<string, unknown>;
    const engine = (rec.engine ??
        (typeof rec.insertDoc === 'function' && typeof rec.patchDoc === 'function'
            ? rec
            : null)) as Record<string, unknown> | null;

    if (engine && engine.config && typeof engine.config === 'object') {
        if ((engine.config as Record<string, unknown>).forceMemory !== true) {
            throw new WorkerHostStorageError();
        }
    } else if (rec.config && typeof rec.config === 'object') {
        if ((rec.config as Record<string, unknown>).forceMemory !== true) {
            throw new WorkerHostStorageError();
        }
    }
}

/**
 * Resolves a storage target into a unified MutationTarget, supporting both
 * standard LiveStore engines and mock targets providing a collection() accessor.
 */
function resolveTargetForWorker(store: unknown): MutationTarget {
    try {
        return resolveMutationTarget(store);
    } catch (err) {
        const rec = store as Record<string, unknown>;
        if (rec && typeof rec.collection === 'function') {
            const colFn = rec.collection as (
                colName: string
            ) => Promise<Record<string, unknown>> | Record<string, unknown>;
            return {
                async get(collection: string, id: string): Promise<unknown> {
                    const col = (await colFn(collection)) as {
                        get: (docId: string) => Promise<{ data?: unknown } | unknown>;
                    };
                    const doc = (await col.get(id)) as { data?: unknown } | null;
                    return doc ? (doc.data ?? doc) : null;
                },
                async insert(
                    collection: string,
                    id: string,
                    data: Record<string, unknown>
                ): Promise<unknown> {
                    const col = (await colFn(collection)) as {
                        get: (docId: string) => Promise<{ data?: unknown; patch?: (d: unknown) => Promise<unknown> } | null>;
                        create: (docId: string, d: Record<string, unknown>) => Promise<{ data?: unknown } | unknown>;
                    };
                    const existing = await col.get(id);
                    if (existing) {
                        if (typeof existing.patch === 'function') {
                            await existing.patch(data);
                        }
                        return existing.data ?? existing;
                    }
                    const created = (await col.create(id, data)) as { data?: unknown };
                    return created.data ?? created;
                },
                async patch(
                    collection: string,
                    id: string,
                    patch: Record<string, unknown>
                ): Promise<unknown> {
                    const col = (await colFn(collection)) as {
                        get: (docId: string) => Promise<{ data?: unknown; patch?: (d: unknown) => Promise<unknown> } | null>;
                        create: (docId: string, d: Record<string, unknown>) => Promise<{ data?: unknown } | unknown>;
                    };
                    const existing = await col.get(id);
                    if (existing) {
                        if (typeof existing.patch === 'function') {
                            await existing.patch(patch);
                        }
                        return existing.data ?? existing;
                    }
                    const created = (await col.create(id, patch)) as { data?: unknown };
                    return created.data ?? created;
                },
                async remove(collection: string, id: string): Promise<boolean> {
                    const col = (await colFn(collection)) as {
                        delete: (docId: string) => Promise<unknown>;
                    };
                    await col.delete(id);
                    return true;
                },
            };
        }
        throw err;
    }
}

/**
 * Attaches a storage engine host to a Web Worker context or message port,
 * translating incoming postMessage commands and streaming CDC delta packets back.
 */
export function attachWorkerStoreHost(
    storeOrFactory: StoreOrFactory,
    portOrSelf: WorkerMessagePortLike,
    options: WorkerHostOptions = {}
): WorkerHostController {
    if (typeof storeOrFactory !== 'function') {
        validateStoreForWorker(storeOrFactory);
    }

    let disposed = false;
    let resolvedStore: unknown | null =
        typeof storeOrFactory !== 'function' ? storeOrFactory : null;
    let storePromise: Promise<unknown> | null = null;
    let cdcSubscription: Subscription | null = null;
    let failureCount = 0;
    let permanentFailure: Error | null = null;

    let cdcSubscribed = false;
    const cdcBuffer: StoreCdcEvent[] = [];
    let cdcFlushScheduled = false;

    const defaultOrigin: StoreCdcOrigin = options.defaultOrigin ?? 'local';
    const maxRetries = options.factoryRetries ?? 1;
    const commandQueue = new KeyedSerialQueue();

    const reply = (msg: WorkerHostMessage): void => {
        if (disposed) {
            return;
        }
        try {
            portOrSelf.postMessage(msg);
        } catch (err: unknown) {
            if (msg.type !== 'ERROR') {
                const error = err as { message?: string; name?: string };
                const errorMsg = error?.message || String(err);
                const errName = error?.name || 'DataCloneError';
                try {
                    portOrSelf.postMessage({
                        id: (msg as { id?: string }).id,
                        type: 'ERROR',
                        error: {
                            name: errName,
                            message: `${errName}: ${errorMsg}`,
                        },
                    });
                } catch {
                    // Ignore if port cannot send at all
                }
            }
        }
    };

    const scheduleCdcFlush = (): void => {
        if (cdcFlushScheduled) {
            return;
        }
        cdcFlushScheduled = true;
        queueMicrotask(() => {
            cdcFlushScheduled = false;
            if (disposed || !cdcSubscribed || cdcBuffer.length === 0) {
                cdcBuffer.length = 0;
                return;
            }
            const events = cdcBuffer.splice(0, cdcBuffer.length);
            if (events.length === 1) {
                reply({
                    type: 'CDC',
                    payload: events[0],
                });
            } else {
                reply({
                    type: 'CDC_BATCH',
                    payload: events,
                });
            }
        });
    };

    const setupCdcStream = (store: unknown): void => {
        if (cdcSubscription || !store) {
            return;
        }
        try {
            const cdc$ = toStoreCdcObservable(store, {
                defaultCollection: options.collection,
                defaultOrigin,
            });

            cdcSubscription = cdc$.subscribe({
                next: (event) => {
                    if (disposed || !cdcSubscribed) {
                        return;
                    }
                    cdcBuffer.push(event);
                    scheduleCdcFlush();
                },
                error: (err: unknown) => {
                    if (!disposed) {
                        console.error('[WorkerStoreHost] CDC stream error:', err);
                        const errorObj =
                            err instanceof Error
                                ? { message: err.message, name: err.name, stack: err.stack }
                                : { message: String(err) };
                        reply({
                            type: 'ERROR',
                            error: errorObj,
                        });
                    }
                },
            });
        } catch {
            // Source does not support CDC streaming; commands and queries will still operate
        }
    };

    // If store is already available synchronously, begin CDC stream
    if (resolvedStore) {
        setupCdcStream(resolvedStore);
    }

    const resolveStoreInstance = async (): Promise<unknown> => {
        if (resolvedStore) {
            return resolvedStore;
        }
        if (permanentFailure) {
            throw permanentFailure;
        }
        if (typeof storeOrFactory !== 'function') {
            throw new Error('Worker store instance could not be resolved.');
        }
        if (storePromise) {
            return storePromise;
        }

        if (failureCount > maxRetries) {
            permanentFailure = new Error(
                `Worker store factory failed permanently after ${failureCount} attempts.`
            );
            throw permanentFailure;
        }

        storePromise = (async () => {
            try {
                const result = (storeOrFactory as () => unknown | Promise<unknown>)();
                const store = result instanceof Promise ? await result : result;
                validateStoreForWorker(store);
                resolvedStore = store;
                storePromise = null;
                setupCdcStream(resolvedStore);
                return resolvedStore;
            } catch (err: unknown) {
                failureCount += 1;
                storePromise = null;
                const error = err instanceof Error ? err : new Error(String(err));
                if (failureCount > maxRetries) {
                    permanentFailure = error;
                }
                throw error;
            }
        })();

        return storePromise;
    };

    const executeCommand = async (
        payload: WorkerCommandRequest['payload']
    ): Promise<{ mutationId: string }> => {
        const action = payload.type || payload.action;
        const delta = payload.delta ?? payload.data ?? {};
        if (!action || !payload.collection || !payload.docId) {
            throw new Error('Malformed COMMAND request payload: missing required fields.');
        }

        const mutationId =
            payload.mutationId ||
            `wcmd_${payload.docId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        const normalizedCmd: NormalizedStoreCommand = {
            type: action,
            collection: payload.collection,
            id: payload.docId,
            delta,
            path: payload.path,
            value: payload.value,
            mutationId,
            origin: defaultOrigin,
        };

        const key = `${payload.collection}:${payload.docId}`;
        await commandQueue.run(key, async () => {
            const store = await resolveStoreInstance();
            const target = resolveTargetForWorker(store);
            await applyStoreCommand(target, normalizedCmd);
        });

        return { mutationId };
    };

    const executeQuery = async (payload: WorkerQueryRequest['payload']): Promise<unknown[]> => {
        const store = await resolveStoreInstance();
        if (!payload || typeof payload.sql !== 'string') {
            throw new Error('Malformed QUERY request payload: missing sql string.');
        }

        const rec = store as Record<string, unknown>;
        const engine = (
            rec?.engine && typeof (rec.engine as Record<string, unknown>).queryRaw === 'function'
                ? rec.engine
                : typeof rec?.queryRaw === 'function'
                ? rec
                : null
        ) as { queryRaw: (sql: string, params?: unknown[], collection?: string) => Promise<unknown[]> } | null;

        if (engine) {
            return engine.queryRaw(payload.sql, payload.params, options.collection);
        } else if (
            typeof (rec as { query?: (sql: string, params?: unknown[]) => Promise<unknown[]> })?.query ===
            'function'
        ) {
            return (rec as { query: (sql: string, params?: unknown[]) => Promise<unknown[]> }).query(
                payload.sql,
                payload.params
            );
        } else {
            throw new Error('Storage target does not support raw SQL querying.');
        }
    };

    const handleMessage = async (event: WorkerMessageEventLike<unknown>): Promise<void> => {
        if (disposed) {
            return;
        }

        const msg = event && typeof event === 'object' && 'data' in event ? event.data : event;
        if (!msg || typeof msg !== 'object') {
            return;
        }

        const clientReq = msg as WorkerClientRequest;

        // Clean close dispatched from client
        if (clientReq.type === 'CLOSE') {
            return;
        }

        // CDC subscription management
        if (clientReq.type === 'CDC_SUBSCRIBE') {
            cdcSubscribed = true;
            return;
        }

        if (clientReq.type === 'CDC_UNSUBSCRIBE') {
            cdcSubscribed = false;
            cdcBuffer.length = 0;
            return;
        }

        const reqId = (clientReq as { id?: string }).id ?? '';

        // 1. Handshake request
        if (clientReq.type === 'INIT') {
            try {
                await resolveStoreInstance();
                reply({
                    id: reqId,
                    type: 'INIT_OK',
                    payload: {
                        ready: true,
                    },
                });
            } catch (err: unknown) {
                const error = err as { message?: string; name?: string; stack?: string };
                reply({
                    id: reqId,
                    type: 'ERROR',
                    error: {
                        message: error?.message || String(err),
                        name: error?.name,
                        stack: error?.stack,
                    },
                });
            }
            return;
        }

        // 2. Batch request
        if (clientReq.type === 'BATCH') {
            const requests = clientReq.payload;
            if (!Array.isArray(requests)) {
                reply({
                    id: reqId,
                    type: 'ERROR',
                    error: {
                        message: 'Malformed BATCH request: payload must be an array.',
                    },
                });
                return;
            }

            const executeItem = async (req: WorkerClientRequest): Promise<WorkerBatchResultItem> => {
                const itemId = (req as { id: string }).id;
                try {
                    if (req.type === 'COMMAND') {
                        const res = await executeCommand(req.payload);
                        return {
                            id: itemId,
                            success: true,
                            result: res,
                        };
                    } else if (req.type === 'QUERY') {
                        const rows = await executeQuery(req.payload);
                        return {
                            id: itemId,
                            success: true,
                            result: rows,
                        };
                    } else if (req.type === 'INIT') {
                        await resolveStoreInstance();
                        return {
                            id: itemId,
                            success: true,
                            result: { ready: true },
                        };
                    } else {
                        return {
                            id: itemId,
                            success: false,
                            error: { message: `Unsupported request type in batch: ${req.type}` },
                        };
                    }
                } catch (err: unknown) {
                    const error = err instanceof Error ? err : new Error(String(err));
                    return {
                        id: itemId,
                        success: false,
                        error: {
                            message: error.message,
                            name: error.name,
                            stack: error.stack,
                        },
                    };
                }
            };

            const results = await Promise.all(requests.map((r) => executeItem(r)));
            reply({
                id: reqId,
                type: 'BATCH_OK',
                payload: {
                    results,
                },
            });
            return;
        }

        // 3. Mutation command (single unbatched)
        if (clientReq.type === 'COMMAND') {
            try {
                const res = await executeCommand(clientReq.payload);
                reply({
                    id: reqId,
                    type: 'COMMAND_OK',
                    payload: res,
                });
            } catch (err: unknown) {
                const error = err as { message?: string; name?: string; stack?: string };
                reply({
                    id: reqId,
                    type: 'ERROR',
                    error: {
                        message: error?.message || String(err),
                        name: error?.name,
                        stack: error?.stack,
                    },
                });
            }
            return;
        }

        // 4. Raw SQL query (single unbatched)
        if (clientReq.type === 'QUERY') {
            try {
                const rows = await executeQuery(clientReq.payload);
                reply({
                    id: reqId,
                    type: 'QUERY_OK',
                    payload: {
                        rows,
                    },
                });
            } catch (err: unknown) {
                const error = err as { message?: string; name?: string; stack?: string };
                reply({
                    id: reqId,
                    type: 'ERROR',
                    error: {
                        message: error?.message || String(err),
                        name: error?.name,
                        stack: error?.stack,
                    },
                });
            }
            return;
        }
    };

    addPortListener(portOrSelf, 'message', handleMessage);

    if (typeof portOrSelf.start === 'function') {
        portOrSelf.start();
    }

    const controller: WorkerHostController = {
        get isDisposed(): boolean {
            return disposed;
        },
        get store(): unknown | null {
            return resolvedStore;
        },
        dispose(): void {
            if (disposed) {
                return;
            }
            disposed = true;
            cdcSubscribed = false;
            cdcBuffer.length = 0;

            try {
                portOrSelf.postMessage({ type: 'CLOSE', reason: 'Host disposed' });
            } catch {
                // Ignore if port already closed or broken
            }

            removePortListener(portOrSelf, 'message', handleMessage);

            if (cdcSubscription) {
                cdcSubscription.unsubscribe();
                cdcSubscription = null;
            }

            if (resolvedStore) {
                const storeObj = resolvedStore as {
                    close?: () => void | Promise<void>;
                    dispose?: () => void | Promise<void>;
                };
                if (typeof storeObj.close === 'function') {
                    void storeObj.close();
                } else if (typeof storeObj.dispose === 'function') {
                    void storeObj.dispose();
                }
            }
        },
    };

    return controller;
}
