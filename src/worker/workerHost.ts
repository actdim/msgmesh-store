import type { Subscription } from 'rxjs';
import { toStoreCdcObservable } from '../cdc/cdcStream';
import type { StoreCdcOrigin } from '../cdc/types';
import type {
    StoreOrFactory,
    WorkerClientRequest,
    WorkerHostController,
    WorkerHostOptions,
    WorkerMessageEventLike,
    WorkerMessagePortLike,
    WorkerRequestAction,
} from './types';
import { addPortListener, removePortListener } from './channel';

/**
 * Constructs a nested object patch from a dot-delimited path and value.
 */
function buildNestedPathPatch(path: string, value: unknown): Record<string, unknown> {
    const segments = path.split('.');
    let current: unknown = value;
    for (let i = segments.length - 1; i >= 0; i--) {
        current = { [segments[i]]: current };
    }
    return current as Record<string, unknown>;
}

/**
 * Executes a mutation against the storage engine target inside the worker.
 */
async function executeWorkerMutation(
    target: unknown,
    action: WorkerRequestAction,
    collection: string,
    docId: string,
    data?: Record<string, unknown>,
    path?: string,
    value?: unknown,
    mutationId?: string
): Promise<void> {
    if (!target || typeof target !== 'object') {
        throw new Error('Worker store target is not a valid object.');
    }

    const rec = target as Record<string, any>;
    const storageEngine =
        rec.engine && typeof rec.engine.patchDoc === 'function'
            ? rec.engine
            : typeof rec.patchDoc === 'function' && typeof rec.insertDoc === 'function'
            ? rec
            : null;

    const payloadData = data ?? {};

    // 1. Direct low-level SQLite / storage engine execution
    if (storageEngine) {
        if (action === 'CREATE') {
            const existing = await storageEngine.getDoc(collection, docId);
            if (existing) {
                await storageEngine.patchDoc(collection, docId, payloadData, undefined, mutationId);
            } else {
                await storageEngine.insertDoc(collection, docId, payloadData, undefined, mutationId);
            }
            return;
        }

        if (action === 'DELETE') {
            await storageEngine.deleteDoc(collection, docId, mutationId);
            return;
        }

        if (action === 'PATCH_PATH' && path) {
            const patchObj = buildNestedPathPatch(path, value);
            const existing = await storageEngine.getDoc(collection, docId);
            if (existing) {
                await storageEngine.patchDoc(collection, docId, patchObj, undefined, mutationId);
            } else {
                await storageEngine.insertDoc(collection, docId, patchObj, undefined, mutationId);
            }
            return;
        }

        // Default: PATCH
        const existing = await storageEngine.getDoc(collection, docId);
        if (existing) {
            await storageEngine.patchDoc(collection, docId, payloadData, undefined, mutationId);
        } else {
            await storageEngine.insertDoc(collection, docId, payloadData, undefined, mutationId);
        }
        return;
    }

    // 2. High-level LiveStoreInstance fallback (collection access)
    if (typeof rec.collection === 'function') {
        const col = await rec.collection(collection);
        if (action === 'CREATE') {
            const existing = await col.get(docId);
            if (!existing) {
                await col.create(docId, payloadData);
            } else if (typeof existing.patch === 'function') {
                await existing.patch(payloadData);
            }
        } else if (action === 'DELETE') {
            await col.delete(docId);
        } else if (action === 'PATCH_PATH' && path) {
            const doc = await col.get(docId);
            if (doc) {
                if (typeof doc.patchPath === 'function') {
                    await doc.patchPath(path, value);
                } else if (typeof doc.patch === 'function') {
                    await doc.patch(buildNestedPathPatch(path, value));
                }
            } else {
                await col.create(docId, buildNestedPathPatch(path, value));
            }
        } else {
            // PATCH
            const doc = await col.get(docId);
            if (doc && typeof doc.patch === 'function') {
                await doc.patch(payloadData);
            } else {
                await col.create(docId, payloadData);
            }
        }
        return;
    }

    // 3. High-level LiveCollection fallback
    if (typeof rec.get === 'function' && typeof rec.create === 'function') {
        if (action === 'CREATE') {
            const existing = await rec.get(docId);
            if (!existing) {
                await rec.create(docId, payloadData);
            } else if (typeof existing.patch === 'function') {
                await existing.patch(payloadData);
            }
        } else if (action === 'DELETE') {
            await rec.delete(docId);
        } else if (action === 'PATCH_PATH' && path) {
            const doc = await rec.get(docId);
            if (doc) {
                if (typeof doc.patchPath === 'function') {
                    await doc.patchPath(path, value);
                } else if (typeof doc.patch === 'function') {
                    await doc.patch(buildNestedPathPatch(path, value));
                }
            } else {
                await rec.create(docId, buildNestedPathPatch(path, value));
            }
        } else {
            // PATCH
            const doc = await rec.get(docId);
            if (doc && typeof doc.patch === 'function') {
                await doc.patch(payloadData);
            } else {
                await rec.create(docId, payloadData);
            }
        }
        return;
    }

    throw new Error('Provided target does not implement supported storage mutation interfaces.');
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
    let disposed = false;
    let resolvedStore: unknown | null = typeof storeOrFactory !== 'function' ? storeOrFactory : null;
    let cdcSubscription: Subscription | null = null;

    const defaultOrigin: StoreCdcOrigin = options.defaultOrigin ?? 'local';

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
                    try {
                        portOrSelf.postMessage({
                            type: 'CDC',
                            payload: event,
                        });
                    } catch (err) {
                        console.error('[WorkerStoreHost] Failed to post CDC event:', err);
                    }
                },
                error: (err) => {
                    if (!disposed) {
                        console.error('[WorkerStoreHost] CDC stream error:', err);
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

        if (typeof storeOrFactory === 'function') {
            const result = (storeOrFactory as () => unknown | Promise<unknown>)();
            resolvedStore = result instanceof Promise ? await result : result;
            setupCdcStream(resolvedStore);
            return resolvedStore;
        }

        throw new Error('Worker store instance could not be resolved.');
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
        const reqId = clientReq.id;

        // 1. Handshake request
        if (clientReq.type === 'INIT') {
            try {
                await resolveStoreInstance();
                portOrSelf.postMessage({
                    id: reqId,
                    type: 'INIT_OK',
                    payload: {
                        ready: true,
                    },
                });
            } catch (err: any) {
                portOrSelf.postMessage({
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
            try {
                const store = await resolveStoreInstance();
                const payload = clientReq.payload;
                if (!payload || !payload.action || !payload.collection || !payload.docId) {
                    throw new Error('Malformed COMMAND request payload: missing required fields.');
                }

                const mutationId =
                    payload.mutationId ||
                    `wcmd_${payload.docId}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

                await executeWorkerMutation(
                    store,
                    payload.action,
                    payload.collection,
                    payload.docId,
                    payload.data,
                    payload.path,
                    payload.value,
                    mutationId
                );

                portOrSelf.postMessage({
                    id: reqId,
                    type: 'COMMAND_OK',
                    payload: {
                        mutationId,
                    },
                });
            } catch (err: any) {
                portOrSelf.postMessage({
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

                portOrSelf.postMessage({
                    id: reqId,
                    type: 'QUERY_OK',
                    payload: {
                        rows,
                    },
                });
            } catch (err: any) {
                portOrSelf.postMessage({
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

            removePortListener(portOrSelf, 'message', handleMessage);

            if (cdcSubscription) {
                cdcSubscription.unsubscribe();
                cdcSubscription = null;
            }
        },
    };

    return controller;
}
