import { Observable, Subject, Subscription } from 'rxjs';
import { toStoreCdcObservable } from '../cdc/cdcStream';
import type { StoreCdcEvent, StoreCdcOrigin, MsgMeshBusLike } from '../cdc/types';
import type {
    StoreBridgeOptions,
    StoreBridgeController,
    StoreCommandPayload,
    StoreCommandType,
} from './types';
import { EchoTracker } from './echoSuppression';

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
 * Executes a store mutation against a storage target (LiveStoreInstance, LiveCollection, or LiveSqliteEngine).
 */
async function executeStoreMutation(
    target: unknown,
    cmd: {
        type: StoreCommandType;
        id: string;
        collection: string;
        delta?: Record<string, unknown>;
        path?: string;
        value?: unknown;
    },
    collection: string,
    mutationId: string
): Promise<void> {
    if (!target || typeof target !== 'object') {
        return;
    }

    const rec = target as Record<string, any>;
    const rawEngine =
        rec.engine && typeof rec.engine.patchDoc === 'function'
            ? rec.engine
            : rec.rawEngine && typeof rec.rawEngine.patchDoc === 'function'
            ? rec.rawEngine
            : typeof rec.patchDoc === 'function' && typeof rec.insertDoc === 'function'
            ? rec
            : null;

    const data = (cmd.delta ?? {}) as Record<string, unknown>;

    // Direct SQLite engine execution with explicit mutationId
    if (rawEngine) {
        if (cmd.type === 'CREATE') {
            const existing = await rawEngine.getDoc(collection, cmd.id);
            if (existing) {
                await rawEngine.patchDoc(collection, cmd.id, data, undefined, mutationId);
            } else {
                await rawEngine.insertDoc(collection, cmd.id, data, undefined, mutationId);
            }
        } else if (cmd.type === 'DELETE') {
            await rawEngine.deleteDoc(collection, cmd.id, mutationId);
        } else if (cmd.type === 'PATCH_PATH' && cmd.path) {
            const patch = buildNestedPathPatch(cmd.path, cmd.value);
            const existing = await rawEngine.getDoc(collection, cmd.id);
            if (existing) {
                await rawEngine.patchDoc(collection, cmd.id, patch, undefined, mutationId);
            } else {
                await rawEngine.insertDoc(collection, cmd.id, patch, undefined, mutationId);
            }
        } else {
            // Default: PATCH
            const existing = await rawEngine.getDoc(collection, cmd.id);
            if (existing) {
                await rawEngine.patchDoc(collection, cmd.id, data, undefined, mutationId);
            } else {
                await rawEngine.insertDoc(collection, cmd.id, data, undefined, mutationId);
            }
        }
        return;
    }

    // High level LiveStoreInstance fallback
    if (typeof rec.collection === 'function') {
        const col = await rec.collection(collection);
        if (cmd.type === 'CREATE') {
            const existing = await col.get(cmd.id);
            if (!existing) {
                await col.create(cmd.id, data);
            } else if (typeof existing.patch === 'function') {
                await existing.patch(data);
            }
        } else if (cmd.type === 'DELETE') {
            await col.delete(cmd.id);
        } else if (cmd.type === 'PATCH_PATH' && cmd.path) {
            const doc = await col.get(cmd.id);
            if (doc) {
                if (typeof doc.patchPath === 'function') {
                    await doc.patchPath(cmd.path, cmd.value);
                } else if (typeof doc.patch === 'function') {
                    await doc.patch(buildNestedPathPatch(cmd.path, cmd.value));
                }
            }
        } else {
            // PATCH
            const doc = await col.get(cmd.id);
            if (doc && typeof doc.patch === 'function') {
                await doc.patch(data);
            } else {
                await col.create(cmd.id, data);
            }
        }
        return;
    }

    // High level LiveCollection fallback
    if (typeof rec.get === 'function' && typeof rec.create === 'function') {
        if (cmd.type === 'CREATE') {
            const existing = await rec.get(cmd.id);
            if (!existing) {
                await rec.create(cmd.id, data);
            } else if (typeof existing.patch === 'function') {
                await existing.patch(data);
            }
        } else if (cmd.type === 'DELETE') {
            await rec.delete(cmd.id);
        } else if (cmd.type === 'PATCH_PATH' && cmd.path) {
            const doc = await rec.get(cmd.id);
            if (doc) {
                if (typeof doc.patchPath === 'function') {
                    await doc.patchPath(cmd.path, cmd.value);
                } else if (typeof doc.patch === 'function') {
                    await doc.patch(buildNestedPathPatch(cmd.path, cmd.value));
                }
            }
        } else {
            // PATCH
            const doc = await rec.get(cmd.id);
            if (doc && typeof doc.patch === 'function') {
                await doc.patch(data);
            } else {
                await rec.create(cmd.id, data);
            }
        }
    }
}

/**
 * Attaches a persistent store (LiveStoreInstance, LiveCollection, or LiveSqliteEngine)
 * to an active MsgMesh message bus instance with bidirectional command translation,
 * origin tagging, and echo feedback suppression.
 */
export function attachStoreBridge(
    bus: unknown,
    storeOrCollection: unknown,
    options: StoreBridgeOptions = {}
): StoreBridgeController {
    const channelPrefix = options.channelPrefix ?? 'STORE';
    const enableCdc = options.enableCdcStream !== false;
    const enableCommands = options.enableCommandHandling !== false;
    const echoSuppressionMs = options.echoSuppressionMs ?? 1000;
    const defaultOrigin: StoreCdcOrigin = options.defaultOrigin ?? 'local';

    let disposed = false;
    const echoTracker = new EchoTracker(echoSuppressionMs);
    const cdcSubject = new Subject<StoreCdcEvent>();
    const commandAbortController = new AbortController();
    const unsubscribers: Array<() => void> = [];
    let sourceSubscription: Subscription | null = null;

    const typedBus = bus as MsgMeshBusLike | null | undefined;

    // 1. Setup CDC streaming and origin tracking from store
    if (storeOrCollection && enableCdc) {
        const rawCdc$ = toStoreCdcObservable(storeOrCollection, {
            defaultCollection: options.collection,
            defaultOrigin,
        });

        sourceSubscription = rawCdc$.subscribe({
            next: (rawEvent) => {
                if (disposed) {
                    return;
                }

                // Origin tagging: if mutation matches a bus command in sliding window, mark origin as 'bus'
                let origin: StoreCdcOrigin = rawEvent.origin;
                if (rawEvent.mutationId && echoTracker.has(rawEvent.mutationId)) {
                    origin = echoTracker.getOrigin(rawEvent.mutationId) ?? 'bus';
                } else if (!origin) {
                    origin = defaultOrigin;
                }

                const enrichedEvent: StoreCdcEvent = {
                    ...rawEvent,
                    origin,
                };

                // Emit on local cdc$ stream
                cdcSubject.next(enrichedEvent);

                // Publish to MsgMesh bus ONLY if event is NOT a bus echo
                if (typedBus && typeof typedBus.send === 'function') {
                    const isBusEcho =
                        enrichedEvent.origin === 'bus' ||
                        (enrichedEvent.mutationId !== undefined &&
                            echoTracker.isEcho(enrichedEvent.mutationId, 'bus'));

                    if (!isBusEcho) {
                        void typedBus.send({
                            channel: `${channelPrefix}.ENTITY_CHANGED`,
                            group: 'out',
                            topic: enrichedEvent.collection,
                            payload: enrichedEvent,
                        });

                        if (options.secondaryChannelPerCollection) {
                            void typedBus.send({
                                channel: `${channelPrefix}.${enrichedEvent.collection}.CHANGED`,
                                group: 'out',
                                topic: enrichedEvent.id,
                                payload: enrichedEvent,
                            });
                        }
                    }
                }
            },
            error: (err) => {
                if (!disposed) {
                    cdcSubject.error(err);
                }
            },
            complete: () => {
                if (!disposed) {
                    cdcSubject.complete();
                }
            },
        });
    }

    // 2. Setup bus command listener & translation
    if (typedBus && typeof (typedBus as Record<string, unknown>).on === 'function' && enableCommands) {
        const busOn = (typedBus as Record<string, unknown>).on as (params: unknown) => unknown;

        const handleCommand = async (msg: unknown): Promise<void> => {
            if (disposed || !msg || typeof msg !== 'object') {
                return;
            }

            const message = msg as {
                address?: { channel?: string; group?: string; topic?: string };
                payload?: StoreCommandPayload;
            };

            const payload = message.payload;
            if (!payload || typeof payload !== 'object') {
                return;
            }

            const id = payload.id;
            if (!id) {
                return;
            }

            // Extract collection
            let collection = payload.collection;
            if (!collection) {
                const topic = typeof message.address?.topic === 'string' ? message.address.topic : '';
                const upperTopic = topic.toUpperCase();
                if (
                    topic &&
                    !['CREATE', 'PATCH', 'DELETE', 'PATCH_PATH', 'INSERT', 'UPDATE'].includes(
                        upperTopic
                    ) &&
                    !topic.startsWith('/')
                ) {
                    collection = topic;
                } else if (options.collection) {
                    collection = options.collection;
                } else if (
                    typeof storeOrCollection === 'object' &&
                    storeOrCollection &&
                    'name' in (storeOrCollection as Record<string, unknown>)
                ) {
                    collection = String((storeOrCollection as Record<string, unknown>).name);
                } else {
                    collection = 'default';
                }
            }

            // Extract command type
            let type: StoreCommandType = 'PATCH';
            const rawType = String(payload.type || payload.action || '').toUpperCase();
            if (['CREATE', 'PATCH', 'DELETE', 'PATCH_PATH'].includes(rawType)) {
                type = rawType as StoreCommandType;
            } else {
                const topicUpper = String(message.address?.topic || '').toUpperCase();
                if (['CREATE', 'PATCH', 'DELETE', 'PATCH_PATH'].includes(topicUpper)) {
                    type = topicUpper as StoreCommandType;
                } else if (topicUpper === 'INSERT') {
                    type = 'CREATE';
                } else if (topicUpper === 'UPDATE') {
                    type = 'PATCH';
                }
            }

            const origin: StoreCdcOrigin = payload.origin ?? 'bus';
            const mutationId =
                payload.mutationId ||
                payload.correlationId ||
                `cmd_${id}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

            // Echo suppression: ignore if this mutation was already processed
            if (echoTracker.isEcho(mutationId)) {
                return;
            }

            // Record in echo tracker
            echoTracker.record(mutationId, origin, { collection, id });

            try {
                await executeStoreMutation(
                    storeOrCollection,
                    {
                        type,
                        id,
                        collection,
                        delta: (payload.delta ?? payload.data) as Record<string, unknown>,
                        path: payload.path,
                        value: payload.value,
                    },
                    collection,
                    mutationId
                );
            } catch (err) {
                console.error(`[msgmesh-store] Command execution failed for ${collection}/${id}:`, err);
            }
        };

        const registerListener = (channel: string, group: string): void => {
            const cleanup = busOn({
                channel,
                group,
                topic: '/.*/',
                callback: handleCommand,
                options: {
                    abortSignal: commandAbortController.signal,
                },
            });
            if (typeof cleanup === 'function') {
                unsubscribers.push(cleanup as () => void);
            }
        };

        registerListener(`${channelPrefix}.COMMAND`, 'in');
        registerListener(`${channelPrefix}.COMMAND`, 'out');
        if (options.collection) {
            registerListener(`${channelPrefix}.${options.collection}.COMMAND`, 'in');
            registerListener(`${channelPrefix}.${options.collection}.COMMAND`, 'out');
        }
    }

    const controller: StoreBridgeController = {
        get isConnected(): boolean {
            return !disposed;
        },
        get isDisposed(): boolean {
            return disposed;
        },
        get cdc$(): Observable<StoreCdcEvent> {
            if (!storeOrCollection) {
                throw new Error(
                    `CDC stream for prefix '${channelPrefix}' requires an active store engine.`
                );
            }
            return cdcSubject.asObservable();
        },
        disconnect(): void {
            this.dispose();
        },
        dispose(): void {
            if (disposed) {
                return;
            }
            disposed = true;

            commandAbortController.abort();
            for (const unsub of unsubscribers) {
                try {
                    unsub();
                } catch {
                    // Ignore errors during disposal
                }
            }
            unsubscribers.length = 0;

            if (sourceSubscription) {
                sourceSubscription.unsubscribe();
                sourceSubscription = null;
            }

            echoTracker.dispose();
            cdcSubject.complete();
        },
    };

    return controller;
}
