import { Observable, Subject, Subscription } from 'rxjs';
import { toStoreCdcObservable, safeSend, deepFreeze } from '../cdc/cdcStream';
import type { StoreCdcEvent, StoreCdcOrigin, MsgMeshBusLike } from '../cdc/types';
import type {
    StoreBridgeOptions,
    StoreBridgeController,
    BridgeErrorEvent,
} from './types';
import { KeyedSerialQueue } from '../core/keyedQueue';
import { MutationLedger } from '../core/mutationLedger';
import {
    resolveMutationTarget,
    applyStoreCommand,
    normalizeCommand,
    type NormalizedStoreCommand,
    type MutationTarget,
} from '../core/applyMutation';

/**
 * Attaches a persistent store (LiveStoreInstance, LiveCollection, or LiveSqliteEngine)
 * to an active MsgMesh message bus instance with bidirectional command translation,
 * per-document serial execution queue, deterministic mutation ledger suppression,
 * and origin filtering.
 */
export function attachStoreBridge(
    bus: unknown,
    storeOrCollection: unknown,
    options: StoreBridgeOptions = {}
): StoreBridgeController {
    const channelPrefix = options.channelPrefix ?? 'STORE';
    const enableCdc = options.enableCdcStream !== false;
    const enableCommands = options.enableCommandHandling !== false;
    const defaultOrigin: StoreCdcOrigin = options.defaultOrigin ?? 'local';
    const publishOrigins: StoreCdcOrigin[] = options.publishOrigins ?? ['local', 'remote'];
    const freezeEvents = options.freezeEvents !== false;
    const ledgerCapacity = options.ledgerCapacity ?? 4096;

    const sourceId = crypto.randomUUID();
    let disposed = false;
    let sourceAlive = true;

    const ledger = new MutationLedger(ledgerCapacity);
    const queue = new KeyedSerialQueue();
    const cdcSubject = new Subject<StoreCdcEvent>();
    const errorsSubject = new Subject<BridgeErrorEvent>();
    const commandAbortController = new AbortController();
    const unsubscribers: Array<() => void> = [];
    let sourceSubscription: Subscription | null = null;

    const typedBus = bus as MsgMeshBusLike | null | undefined;

    let target: MutationTarget | null = null;
    if (storeOrCollection) {
        target = resolveMutationTarget(storeOrCollection, {
            boundCollection: options.collection,
        });
    }
    const boundCollection = options.collection ?? target?.boundCollection;

    // 1. Setup CDC streaming and origin tracking from store
    if (storeOrCollection && enableCdc) {
        const rawCdc$ = toStoreCdcObservable(storeOrCollection, {
            defaultCollection: boundCollection,
            defaultOrigin,
            freezeEvents,
            onInvalid: (err, raw) => {
                errorsSubject.next({ kind: 'validation', error: err });
                options.onInvalid?.(err, raw);
            },
        });

        sourceSubscription = rawCdc$.subscribe({
            next: (rawEvent) => {
                if (disposed) {
                    return;
                }

                const viaBus = Boolean(
                    rawEvent.mutationId &&
                        (ledger.isInFlight(rawEvent.mutationId) ||
                            ledger.wasApplied(rawEvent.mutationId))
                );

                const origin: StoreCdcOrigin = viaBus
                    ? ((ledger.getInFlightOrigin(rawEvent.mutationId!) as StoreCdcOrigin) ??
                      'bus')
                    : (rawEvent.origin ?? defaultOrigin);

                const enrichedEvent: StoreCdcEvent = {
                    ...rawEvent,
                    origin,
                };

                const frozenEvent = freezeEvents ? deepFreeze(enrichedEvent) : enrichedEvent;

                // Emit on local cdc$ stream
                cdcSubject.next(frozenEvent);

                // Publish to MsgMesh bus ONLY IF !viaBus && publishOrigins.includes(origin)
                if (typedBus && typeof typedBus.send === 'function') {
                    if (!viaBus && publishOrigins.includes(origin)) {
                        const eventWithSource: StoreCdcEvent = {
                            ...frozenEvent,
                            sourceId,
                        };
                        const frozenWithSource = freezeEvents
                            ? deepFreeze(eventWithSource)
                            : eventWithSource;

                        safeSend(
                            typedBus,
                            {
                                channel: `${channelPrefix}.ENTITY_CHANGED`,
                                group: 'out',
                                topic: enrichedEvent.collection,
                                payload: frozenWithSource,
                            },
                            (err) => {
                                errorsSubject.next({
                                    kind: 'bus_send',
                                    channel: `${channelPrefix}.ENTITY_CHANGED`,
                                    topic: enrichedEvent.collection,
                                    error: err,
                                });
                            }
                        );

                        if (options.secondaryChannelPerCollection) {
                            safeSend(
                                typedBus,
                                {
                                    channel: `${channelPrefix}.${enrichedEvent.collection}.CHANGED`,
                                    group: 'out',
                                    topic: enrichedEvent.id,
                                    payload: frozenWithSource,
                                },
                                (err) => {
                                    errorsSubject.next({
                                        kind: 'bus_send',
                                        channel: `${channelPrefix}.${enrichedEvent.collection}.CHANGED`,
                                        topic: enrichedEvent.id,
                                        error: err,
                                    });
                                }
                            );
                        }
                    }
                }
            },
            error: (err) => {
                sourceAlive = false;
                errorsSubject.next({ kind: 'validation', error: err });
                if (!disposed) {
                    cdcSubject.error(err);
                }
            },
            complete: () => {
                sourceAlive = false;
                if (!disposed) {
                    cdcSubject.complete();
                }
            },
        });
    }

    // 2. Setup bus command listener & translation
    if (
        typedBus &&
        typeof (typedBus as Record<string, unknown>).on === 'function' &&
        enableCommands
    ) {
        const busOn = (typedBus as Record<string, unknown>).on as (params: unknown) => unknown;

        const handleCommand = (msg: unknown): void => {
            if (disposed || !msg || typeof msg !== 'object') {
                return;
            }

            let cmd: NormalizedStoreCommand;
            try {
                cmd = normalizeCommand(msg, {
                    boundCollection,
                    defaultCollection: boundCollection,
                    defaultOrigin: options.defaultOrigin,
                });
            } catch (err) {
                errorsSubject.next({
                    kind: 'validation',
                    error: err,
                });
                return;
            }

            if (boundCollection && cmd.collection !== boundCollection) {
                errorsSubject.next({
                    kind: 'command',
                    collection: cmd.collection,
                    id: cmd.id,
                    mutationId: cmd.mutationId,
                    correlationId: cmd.correlationId,
                    error: new Error(
                        `Command collection '${cmd.collection}' does not match bound collection '${boundCollection}'.`
                    ),
                });
                return;
            }

            if (!target) {
                errorsSubject.next({
                    kind: 'command',
                    collection: cmd.collection,
                    id: cmd.id,
                    mutationId: cmd.mutationId,
                    correlationId: cmd.correlationId,
                    error: new Error('Cannot execute command without an active store target.'),
                });
                return;
            }

            if (cmd.sourceId && cmd.sourceId === sourceId) {
                return;
            }

            if (ledger.wasApplied(cmd.mutationId) || ledger.isInFlight(cmd.mutationId)) {
                return;
            }

            queue.run(`${cmd.collection}:${cmd.id}`, async () => {
                ledger.begin(cmd.mutationId, cmd.origin);
                try {
                    await applyStoreCommand(target!, cmd);
                } catch (err) {
                    errorsSubject.next({
                        kind: 'command',
                        collection: cmd.collection,
                        id: cmd.id,
                        mutationId: cmd.mutationId,
                        correlationId: cmd.correlationId,
                        error: err,
                    });
                } finally {
                    ledger.markApplied(cmd.mutationId, cmd.origin);
                    ledger.end(cmd.mutationId);
                }
            });
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
        if (boundCollection) {
            registerListener(`${channelPrefix}.${boundCollection}.COMMAND`, 'in');
            registerListener(`${channelPrefix}.${boundCollection}.COMMAND`, 'out');
        }
    }

    const controller: StoreBridgeController = {
        get isConnected(): boolean {
            return !disposed && sourceAlive;
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
        get errors$(): Observable<BridgeErrorEvent> {
            return errorsSubject.asObservable();
        },
        whenIdle(): Promise<void> {
            return queue.drain();
        },
        disconnect(): void {
            this.dispose();
        },
        dispose(): void {
            if (disposed) {
                return;
            }
            disposed = true;
            sourceAlive = false;

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

            cdcSubject.complete();
            errorsSubject.complete();
        },
    };

    return controller;
}
