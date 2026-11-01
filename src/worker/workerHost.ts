import type { Subscription } from 'rxjs';
import { toStoreCdcObservable } from '../cdc/cdcStream';
import type { StoreCdcOrigin } from '../cdc/types';
import { KeyedSerialQueue } from '../core/keyedQueue';
import {
    applyStoreCommand,
    resolveMutationTarget,
    type MutationTarget,
    type NormalizedStoreCommand,
} from '../core/applyMutation';
import {
    WorkerHostStorageError,
    type StoreOrFactory,
    type WorkerClientRequest,
    type WorkerHostController,
    type WorkerHostMessage,
    type WorkerHostOptions,
    type WorkerMessageEventLike,
    type WorkerMessagePortLike,
} from './types';
import { addPortListener, removePortListener } from './channel';

/**
 * Fast-fails if a LiveStruct / LiveStore target is not configured for in-memory execution.
 */
export function validateStoreForWorker(store: unknown): void {
    if (!store || typeof store !== 'object') {
        return;
    }
    const rec = store as Record<string, any>;
    const engine =
        rec.engine ??
        (typeof rec.insertDoc === 'function' && typeof rec.patchDoc === 'function' ? rec : null);

    if (engine && engine.config) {
        if (engine.config.forceMemory !== true) {
            throw new WorkerHostStorageError();
        }
    } else if (rec.config && typeof rec.config === 'object') {
        if (rec.config.forceMemory !== true) {
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
        const rec = store as Record<string, any>;
        if (rec && typeof rec.collection === 'function') {
            return {
                async get(collection: string, id: string): Promise<unknown> {
                    const col = await rec.collection(collection);
                    const doc = await col.get(id);
                    return doc ? (doc.data ?? doc) : null;
                },
                async insert(
                    collection: string,
                    id: string,
                    data: Record<string, unknown>
                ): Promise<unknown> {
                    const col = await rec.collection(collection);
                    const existing = await col.get(id);
                    if (existing) {
                        if (typeof existing.patch === 'function') {
                            await existing.patch(data);
                        }
                        return existing.data ?? existing;
                    }
                    const created = await col.create(id, data);
                    return created.data ?? created;
                },
                async patch(
                    collection: string,
                    id: string,
                    patch: Record<string, unknown>
                ): Promise<unknown> {
                    const col = await rec.collection(collection);
                    const existing = await col.get(id);
                    if (existing) {
                        if (typeof existing.patch === 'function') {
                            await existing.patch(patch);
                        }
                        return existing.data ?? existing;
                    }
                    const created = await col.create(id, patch);
                    return created.data ?? created;
                },
                async remove(collection: string, id: string): Promise<boolean> {
                    const col = await rec.collection(collection);
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

    const defaultOrigin: StoreCdcOrigin = options.defaultOrigin ?? 'local';
    const maxRetries = options.factoryRetries ?? 1;
    const commandQueue = new KeyedSerialQueue();

    const reply = (msg: WorkerHostMessage): void => {
        if (disposed) {
            return;
        }
        try {
            portOrSelf.postMessage(msg);
        } catch (err: any) {
            if (msg.type !== 'ERROR') {
                const errorMsg = err?.message || String(err);
                const errName = err?.name || 'DataCloneError';
                try {
                    portOrSelf.postMessage({
                        id: (msg as any).id,
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
                    if (disposed) {
                        return;
                    }
                    reply({
                        type: 'CDC',
                        payload: event,
                    });
                },
                error: (err) => {
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
            } catch (err: any) {
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

        const reqId = clientReq.id;

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
            } catch (err: any) {
                reply({
                    id: reqId,
                    type: 'ERROR',
                    error: {
                        message: err?.message || String(err),
                        name: err?.name,
                        stack: err?.stack,
                    },
                });
            }
            return;
        }

        // 2. Mutation command
        if (clientReq.type === 'COMMAND') {
            const payload = clientReq.payload;
            if (!payload || !payload.action || !payload.collection || !payload.docId) {
                reply({
                    id: reqId,
                    type: 'ERROR',
                    error: {
                        message: 'Malformed COMMAND request payload: missing required fields.',
                    },
                });
                return;
            }

            const mutationId =
                payload.mutationId ||
                `wcmd_${payload.docId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

            const normalizedCmd: NormalizedStoreCommand = {
                type: payload.action,
                collection: payload.collection,
                id: payload.docId,
                delta: payload.data ?? {},
                path: payload.path,
                value: payload.value,
                mutationId,
                origin: defaultOrigin,
            };

            const key = `${payload.collection}:${payload.docId}`;

            // Synchronously enqueue into KeyedSerialQueue on receipt
            const queuePromise = commandQueue.run(key, async () => {
                const store = await resolveStoreInstance();
                const target = resolveTargetForWorker(store);
                await applyStoreCommand(target, normalizedCmd);
            });

            try {
                await queuePromise;
                reply({
                    id: reqId,
                    type: 'COMMAND_OK',
                    payload: {
                        mutationId,
                    },
                });
            } catch (err: any) {
                reply({
                    id: reqId,
                    type: 'ERROR',
                    error: {
                        message: err?.message || String(err),
                        name: err?.name,
                        stack: err?.stack,
                    },
                });
            }
            return;
        }

        // 3. Raw SQL query
        if (clientReq.type === 'QUERY') {
            try {
                const store = await resolveStoreInstance();
                const payload = clientReq.payload;
                if (!payload || typeof payload.sql !== 'string') {
                    throw new Error('Malformed QUERY request payload: missing sql string.');
                }

                const rec = store as Record<string, any>;
                const engine =
                    rec?.engine && typeof rec.engine.queryRaw === 'function'
                        ? rec.engine
                        : typeof rec?.queryRaw === 'function'
                        ? rec
                        : null;

                let rows: unknown[] = [];
                if (engine) {
                    rows = await engine.queryRaw(payload.sql, payload.params, options.collection);
                } else if (typeof rec?.query === 'function') {
                    rows = await rec.query(payload.sql, payload.params);
                } else {
                    throw new Error('Storage target does not support raw SQL querying.');
                }

                reply({
                    id: reqId,
                    type: 'QUERY_OK',
                    payload: {
                        rows,
                    },
                });
            } catch (err: any) {
                reply({
                    id: reqId,
                    type: 'ERROR',
                    error: {
                        message: err?.message || String(err),
                        name: err?.name,
                        stack: err?.stack,
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
                const storeObj = resolvedStore as any;
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