import {
    Observable,
    Subject,
    Subscription,
    type MonoTypeOperatorFunction,
    isObservable,
} from 'rxjs';
import { filter, map } from 'rxjs/operators';
import type {
    StoreCdcEvent,
    StoreCdcOrigin,
    StoreCdcType,
    CdcSubscriptionOptions,
    CdcBridgeOptions,
    CdcBridge,
    MsgMeshBusLike,
} from './types';

/**
 * Normalizes any storage engine, collection, or reactive stream into an Observable of StoreCdcEvent.
 */
export function toStoreCdcObservable(
    source: unknown,
    options: {
        defaultCollection?: string;
        defaultOrigin?: StoreCdcOrigin;
    } = {}
): Observable<StoreCdcEvent> {
    if (!source) {
        throw new Error('CDC source must not be null or undefined.');
    }

    const defaultOrigin: StoreCdcOrigin = options.defaultOrigin ?? 'local';
    let rawStream$: Observable<unknown> | null = null;
    let inferredCollection = options.defaultCollection;

    // Case 1: Source is already an Observable
    if (isObservable(source)) {
        rawStream$ = source;
    }
    // Case 2: Source is a LiveStoreInstance (has .engine)
    else if (typeof source === 'object' && 'engine' in (source as Record<string, unknown>)) {
        const engine = (source as { engine: unknown }).engine;
        return toStoreCdcObservable(engine, options);
    }
    // Case 3: Source is a LiveEngineAccess (has .tableName and .cdc$)
    else if (
        typeof source === 'object' &&
        'tableName' in (source as Record<string, unknown>) &&
        'cdc$' in (source as Record<string, unknown>)
    ) {
        inferredCollection = (source as { tableName: string }).tableName;
        rawStream$ = (source as { cdc$: Observable<unknown> }).cdc$;
    }
    // Case 4: Source is a LiveCollection (has .name and (.cdc$ or .engineAccess or .rawEngine))
    else if (typeof source === 'object' && 'name' in (source as Record<string, unknown>)) {
        inferredCollection = (source as { name: string }).name;
        const col = source as Record<string, unknown>;
        if (col.cdc$ && isObservable(col.cdc$)) {
            rawStream$ = col.cdc$ as Observable<unknown>;
        } else if (
            col.engineAccess &&
            typeof col.engineAccess === 'object' &&
            'cdc$' in (col.engineAccess as Record<string, unknown>)
        ) {
            rawStream$ = (col.engineAccess as { cdc$: Observable<unknown> }).cdc$;
        } else if (col.rawEngine && typeof col.rawEngine === 'object') {
            return toStoreCdcObservable(col.rawEngine, {
                defaultCollection: inferredCollection,
                defaultOrigin,
            });
        }
    }
    // Case 5: Source has .cdc$ Observable
    else if (
        typeof source === 'object' &&
        'cdc$' in (source as Record<string, unknown>) &&
        isObservable((source as { cdc$: unknown }).cdc$)
    ) {
        rawStream$ = (source as { cdc$: Observable<unknown> }).cdc$;
    }
    // Case 6: Source has .cdcSubject
    else if (
        typeof source === 'object' &&
        'cdcSubject' in (source as Record<string, unknown>) &&
        typeof (source as { cdcSubject: { asObservable?: () => Observable<unknown> } }).cdcSubject
            ?.asObservable === 'function'
    ) {
        rawStream$ = (
            source as { cdcSubject: { asObservable: () => Observable<unknown> } }
        ).cdcSubject.asObservable();
    }

    if (!rawStream$) {
        throw new Error(
            'Unable to extract CDC stream from provided source: missing cdc$, engine, or observable interface.'
        );
    }

    return rawStream$.pipe(
        map((rawItem: unknown): StoreCdcEvent => {
            if (!rawItem || typeof rawItem !== 'object') {
                throw new Error('Received invalid non-object item from CDC source.');
            }

            const item = rawItem as Record<string, unknown>;
            const rawType = String(item.type || 'update').toLowerCase();
            const type: StoreCdcType =
                rawType === 'insert' ? 'insert' : rawType === 'delete' ? 'delete' : 'update';

            const collection = String(
                item.collection || inferredCollection || options.defaultCollection || 'default'
            );
            const id = String(item.id ?? '');
            const delta = (item.delta ?? item.data ?? {}) as Record<string, unknown>;
            const origin: StoreCdcOrigin = (item.origin as StoreCdcOrigin) || defaultOrigin;
            const timestamp = typeof item.timestamp === 'number' ? item.timestamp : Date.now();
            const mutationId = item.mutationId !== undefined ? String(item.mutationId) : undefined;

            return {
                type,
                collection,
                id,
                delta,
                origin,
                timestamp,
                mutationId,
            };
        })
    );
}

/**
 * RxJS operator filtering CDC events by collection, entity ID, origin, and mutation type.
 */
export function filterCdc(
    options: CdcSubscriptionOptions = {}
): MonoTypeOperatorFunction<StoreCdcEvent> {
    return filter((event: StoreCdcEvent) => {
        if (options.collection !== undefined && event.collection !== options.collection) {
            return false;
        }
        if (options.id !== undefined && event.id !== options.id) {
            return false;
        }
        if (
            options.originFilter !== undefined &&
            options.originFilter.length > 0 &&
            !options.originFilter.includes(event.origin)
        ) {
            return false;
        }
        if (
            options.typeFilter !== undefined &&
            options.typeFilter.length > 0 &&
            !options.typeFilter.includes(event.type)
        ) {
            return false;
        }
        return true;
    });
}

/**
 * RxJS operator filtering CDC events by target collection name.
 */
export function filterCollection(collection: string): MonoTypeOperatorFunction<StoreCdcEvent> {
    return filterCdc({ collection });
}

/**
 * RxJS operator filtering CDC events by collection name and entity ID.
 */
export function filterEntity(
    collection: string,
    id: string
): MonoTypeOperatorFunction<StoreCdcEvent> {
    return filterCdc({ collection, id });
}

/**
 * Publishes normalized StoreCdcEvent records onto a typed MsgMesh bus instance.
 */
export function publishCdcToBus(
    bus: MsgMeshBusLike,
    cdc$: Observable<StoreCdcEvent>,
    options: CdcBridgeOptions = {}
): Subscription {
    const channelPrefix = options.channelPrefix ?? 'STORE';
    const primaryChannel = `${channelPrefix}.ENTITY_CHANGED`;

    return cdc$.subscribe({
        next: (event) => {
            void bus.send({
                channel: primaryChannel,
                group: 'out',
                topic: event.collection,
                payload: event,
            });

            if (options.secondaryChannelPerCollection) {
                void bus.send({
                    channel: `${channelPrefix}.${event.collection}.CHANGED`,
                    group: 'out',
                    topic: event.id,
                    payload: event,
                });
            }
        },
    });
}

/**
 * Subscribes to CDC events emitted on a MsgMesh bus, with filtering and leak-free disposal.
 */
export function subscribeCdc(
    bus: MsgMeshBusLike,
    options: CdcSubscriptionOptions = {}
): Observable<StoreCdcEvent> {
    const channelPrefix = options.channelPrefix ?? 'STORE';
    const channel = `${channelPrefix}.ENTITY_CHANGED`;
    const topic = options.collection !== undefined ? options.collection : '/.*/';

    return new Observable<StoreCdcEvent>((subscriber) => {
        const ac = new AbortController();

        const cleanup = bus.on?.({
            channel,
            group: 'out',
            topic,
            callback: (msg) => {
                const payload = msg.payload as StoreCdcEvent;
                if (!payload) {
                    return;
                }

                if (options.collection !== undefined && payload.collection !== options.collection) {
                    return;
                }
                if (options.id !== undefined && payload.id !== options.id) {
                    return;
                }
                if (
                    options.originFilter !== undefined &&
                    options.originFilter.length > 0 &&
                    !options.originFilter.includes(payload.origin)
                ) {
                    return;
                }
                if (
                    options.typeFilter !== undefined &&
                    options.typeFilter.length > 0 &&
                    !options.typeFilter.includes(payload.type)
                ) {
                    return;
                }

                subscriber.next(payload);
            },
            options: {
                abortSignal: ac.signal,
            },
        });

        return () => {
            ac.abort();
            if (typeof cleanup === 'function') {
                cleanup();
            }
        };
    });
}

/**
 * Creates a disposable CDC bridge connecting a storage source to an optional MsgMesh message bus.
 */
export function createCdcBridge(
    source: unknown,
    bus?: MsgMeshBusLike | null,
    options: CdcBridgeOptions = {}
): CdcBridge {
    let disposed = false;
    const cdcSubject = new Subject<StoreCdcEvent>();

    const source$ = toStoreCdcObservable(source, {
        defaultCollection: options.collection,
        defaultOrigin: options.defaultOrigin,
    });

    const filteredSource$ = options.collection
        ? source$.pipe(filterCdc({ collection: options.collection }))
        : source$;

    const sourceSub = filteredSource$.subscribe({
        next: (event) => {
            if (!disposed) {
                cdcSubject.next(event);
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

    let busSub: Subscription | null = null;
    if (bus && typeof bus.send === 'function') {
        busSub = publishCdcToBus(bus, cdcSubject.asObservable(), options);
    }

    const bridge: CdcBridge = {
        get isDisposed(): boolean {
            return disposed;
        },
        get isConnected(): boolean {
            return !disposed;
        },
        get cdc$(): Observable<StoreCdcEvent> {
            return cdcSubject.asObservable();
        },
        dispose(): void {
            if (disposed) {
                return;
            }
            disposed = true;
            if (busSub) {
                busSub.unsubscribe();
                busSub = null;
            }
            sourceSub.unsubscribe();
            cdcSubject.complete();
        },
        disconnect(): void {
            this.dispose();
        },
    };

    return bridge;
}
