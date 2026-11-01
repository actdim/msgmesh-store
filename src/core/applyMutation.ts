import type { StoreCdcOrigin } from '../cdc/types';
import type { StoreCommandType } from '../bridge/types';

/**
 * Normalized representation of a store mutation command.
 */
export interface NormalizedStoreCommand {
    readonly type: StoreCommandType;
    readonly collection: string;
    readonly id: string;
    readonly delta?: Record<string, unknown>;
    readonly path?: string;
    readonly value?: unknown;
    readonly mutationId: string;
    readonly correlationId?: string;
    readonly origin: StoreCdcOrigin;
    readonly durable?: boolean;
    readonly sourceId?: string;
    readonly rawPayload?: unknown;
}

/**
 * Default options for command normalization.
 */
export interface NormalizeCommandDefaults {
    readonly defaultCollection?: string;
    readonly defaultOrigin?: StoreCdcOrigin;
    readonly boundCollection?: string;
}

/**
 * Common mutation interface abstracting storage targets (LiveDocEngine, LiveStoreInstance, LiveCollection).
 */
export interface MutationTarget {
    readonly boundCollection?: string;
    get(collection: string, id: string): Promise<unknown>;
    insert(
        collection: string,
        id: string,
        data: Record<string, unknown>,
        mutationId?: string,
        origin?: string
    ): Promise<unknown>;
    patch(
        collection: string,
        id: string,
        patch: Record<string, unknown>,
        mutationId?: string,
        origin?: string
    ): Promise<unknown>;
    remove(
        collection: string,
        id: string,
        mutationId?: string,
        origin?: string
    ): Promise<boolean>;
    flush?(collection?: string, id?: string): Promise<void>;
}

/**
 * Thrown when a storage target cannot be resolved or does not implement supported interfaces.
 */
export class UnsupportedStoreError extends Error {
    constructor(
        message = 'Provided storage target does not implement supported storage mutation interfaces.'
    ) {
        super(message);
        this.name = 'UnsupportedStoreError';
    }
}

/**
 * Constructs a nested object patch from a dot-delimited path and value.
 */
export function buildNestedPathPatch(path: string, value: unknown): Record<string, unknown> {
    const segments = path.split('.');
    let current: unknown = value;
    for (let i = segments.length - 1; i >= 0; i--) {
        current = { [segments[i]]: current };
    }
    return current as Record<string, unknown>;
}

/**
 * Normalizes an incoming bus message or raw command payload into a strictly typed NormalizedStoreCommand.
 * If mutationId is absent, generates a fresh random UUID (never re-uses correlationId).
 */
export function normalizeCommand(
    msg: unknown,
    defaults: NormalizeCommandDefaults = {}
): NormalizedStoreCommand {
    if (!msg || typeof msg !== 'object') {
        throw new Error('Command message must be a valid non-null object.');
    }

    const message = msg as {
        address?: { channel?: string; group?: string; topic?: string };
        payload?: Record<string, unknown>;
        [key: string]: unknown;
    };

    const payload = (
        message.payload && typeof message.payload === 'object'
            ? message.payload
            : message
    ) as Record<string, unknown>;

    const id = payload.id ?? payload.docId ?? payload.entityId;
    if (id === undefined || id === null || id === '') {
        throw new Error('Command payload missing required id.');
    }

    let collection =
        typeof payload.collection === 'string' && payload.collection ? payload.collection : '';
    if (!collection && message.address?.channel) {
        const parts = message.address.channel.split('.');
        if (parts.length >= 3 && parts[parts.length - 1].toUpperCase() === 'COMMAND') {
            collection = parts[parts.length - 2];
        }
    }
    if (!collection && message.address?.topic) {
        const topic = message.address.topic;
        const upperTopic = topic.toUpperCase();
        if (
            !['CREATE', 'PATCH', 'DELETE', 'PATCH_PATH', 'INSERT', 'UPDATE'].includes(upperTopic) &&
            !topic.startsWith('/')
        ) {
            collection = topic;
        }
    }
    if (!collection && defaults.boundCollection) {
        collection = defaults.boundCollection;
    }
    if (!collection && defaults.defaultCollection) {
        collection = defaults.defaultCollection;
    }
    if (!collection) {
        collection = 'default';
    }

    let type: StoreCommandType = 'PATCH';
    const rawType = String(payload.type || payload.action || '').toUpperCase();
    if (['CREATE', 'PATCH', 'DELETE', 'PATCH_PATH'].includes(rawType)) {
        type = rawType as StoreCommandType;
    } else if (rawType === 'INSERT') {
        type = 'CREATE';
    } else if (rawType === 'UPDATE') {
        type = 'PATCH';
    } else if (message.address?.topic) {
        const topicUpper = message.address.topic.toUpperCase();
        if (['CREATE', 'PATCH', 'DELETE', 'PATCH_PATH'].includes(topicUpper)) {
            type = topicUpper as StoreCommandType;
        } else if (topicUpper === 'INSERT') {
            type = 'CREATE';
        } else if (topicUpper === 'UPDATE') {
            type = 'PATCH';
        }
    }

    const mutationId = payload.mutationId
        ? String(payload.mutationId)
        : crypto.randomUUID();

    const correlationId = payload.correlationId
        ? String(payload.correlationId)
        : undefined;

    const origin = (payload.origin as StoreCdcOrigin) || defaults.defaultOrigin || 'bus';
    const durable = Boolean(payload.durable);
    const sourceId = payload.sourceId ? String(payload.sourceId) : undefined;
    const delta = (payload.delta ?? payload.data ?? {}) as Record<string, unknown>;
    const path = payload.path ? String(payload.path) : undefined;
    const value = payload.value;

    return {
        type,
        collection,
        id: String(id),
        delta,
        path,
        value,
        mutationId,
        correlationId,
        origin,
        durable,
        sourceId,
        rawPayload: payload,
    };
}

/**
 * Resolves a storage instance, collection, or low-level engine into a unified MutationTarget.
 * Accesses only public APIs and strictly enforces collection boundary constraints.
 */
export function resolveMutationTarget(
    store: unknown,
    options: { boundCollection?: string } = {}
): MutationTarget {
    if (!store || typeof store !== 'object') {
        throw new UnsupportedStoreError();
    }

    const rec = store as Record<string, any>;

    // Case 1: High-level LiveCollection (has name, get, create, delete)
    if (
        typeof rec.name === 'string' &&
        typeof rec.get === 'function' &&
        typeof rec.create === 'function' &&
        typeof rec.delete === 'function'
    ) {
        const colName = rec.name;
        if (options.boundCollection && options.boundCollection !== colName) {
            throw new Error(
                `Target collection mismatch: options specified '${options.boundCollection}' but collection is '${colName}'.`
            );
        }

        const assertCol = (col: string): void => {
            if (col !== colName) {
                throw new Error(
                    `Cannot operate on collection '${col}': target is bound to collection '${colName}'.`
                );
            }
        };

        return {
            boundCollection: colName,
            async get(collection: string, id: string): Promise<unknown> {
                assertCol(collection);
                const doc = await rec.get(id);
                return doc ? (doc.data ?? doc) : null;
            },
            async insert(
                collection: string,
                id: string,
                data: Record<string, unknown>,
                mutationId?: string
            ): Promise<unknown> {
                assertCol(collection);
                if (rec.engineAccess && typeof rec.engineAccess.commitRaw === 'function') {
                    await rec.engineAccess.commitRaw({
                        type: 'insert',
                        collection: colName,
                        id,
                        data,
                        mutationId,
                    });
                    const doc = await rec.get(id);
                    return doc ? (doc.data ?? doc) : null;
                }
                const existing = await rec.get(id);
                if (existing) {
                    if (typeof existing.patch === 'function') {
                        await existing.patch(data);
                    }
                    return existing.data ?? existing;
                }
                const created = await rec.create(id, data);
                return created.data ?? created;
            },
            async patch(
                collection: string,
                id: string,
                patch: Record<string, unknown>,
                mutationId?: string
            ): Promise<unknown> {
                assertCol(collection);
                if (rec.engineAccess && typeof rec.engineAccess.commitRaw === 'function') {
                    await rec.engineAccess.commitRaw({
                        type: 'patch',
                        collection: colName,
                        id,
                        data: patch,
                        mutationId,
                    });
                    const doc = await rec.get(id);
                    return doc ? (doc.data ?? doc) : null;
                }
                const existing = await rec.get(id);
                if (existing) {
                    if (typeof existing.patch === 'function') {
                        await existing.patch(patch);
                    }
                    return existing.data ?? existing;
                }
                const created = await rec.create(id, patch);
                return created.data ?? created;
            },
            async remove(
                collection: string,
                id: string,
                mutationId?: string
            ): Promise<boolean> {
                assertCol(collection);
                if (rec.engineAccess && typeof rec.engineAccess.commitRaw === 'function') {
                    try {
                        await rec.engineAccess.commitRaw({
                            type: 'delete',
                            collection: colName,
                            id,
                            mutationId,
                        });
                        return true;
                    } catch {
                        return false;
                    }
                }
                try {
                    await rec.delete(id);
                    return true;
                } catch {
                    return false;
                }
            },
            async flush(collection?: string): Promise<void> {
                if (collection) {
                    assertCol(collection);
                }
                if (typeof rec.flush === 'function') {
                    await rec.flush();
                }
            },
        };
    }

    // Case 2: LiveStoreInstance (has engine property with insertDoc, patchDoc, deleteDoc, getDoc)
    if (
        rec.engine &&
        typeof rec.engine.insertDoc === 'function' &&
        typeof rec.engine.patchDoc === 'function' &&
        typeof rec.engine.deleteDoc === 'function' &&
        typeof rec.engine.getDoc === 'function'
    ) {
        const boundCollection = options.boundCollection;
        const assertCol = (col: string): void => {
            if (boundCollection && col !== boundCollection) {
                throw new Error(
                    `Cannot operate on collection '${col}': target is bound to collection '${boundCollection}'.`
                );
            }
        };

        return {
            boundCollection,
            async get(collection: string, id: string): Promise<unknown> {
                assertCol(collection);
                const doc = await rec.engine.getDoc(collection, id);
                return doc ? doc.data : null;
            },
            async insert(
                collection: string,
                id: string,
                data: Record<string, unknown>,
                mutationId?: string,
                origin?: string
            ): Promise<unknown> {
                assertCol(collection);
                const doc = await rec.engine.insertDoc(
                    collection,
                    id,
                    data,
                    undefined,
                    mutationId,
                    origin
                );
                return doc ? doc.data : null;
            },
            async patch(
                collection: string,
                id: string,
                patch: Record<string, unknown>,
                mutationId?: string,
                origin?: string
            ): Promise<unknown> {
                assertCol(collection);
                const doc = await rec.engine.patchDoc(
                    collection,
                    id,
                    patch,
                    undefined,
                    mutationId,
                    origin
                );
                return doc ? doc.data : null;
            },
            async remove(
                collection: string,
                id: string,
                mutationId?: string,
                origin?: string
            ): Promise<boolean> {
                assertCol(collection);
                try {
                    await rec.engine.deleteDoc(collection, id, mutationId, origin);
                    return true;
                } catch {
                    return false;
                }
            },
            async flush(collection?: string, id?: string): Promise<void> {
                if (collection && boundCollection) {
                    assertCol(collection);
                }
                if (typeof rec.flush === 'function') {
                    await rec.flush(collection, id);
                } else if (typeof rec.engine.flush === 'function') {
                    await rec.engine.flush(collection, id);
                }
            },
        };
    }

    // Case 3: Low-level engine (has insertDoc, patchDoc, deleteDoc, getDoc directly)
    if (
        typeof rec.insertDoc === 'function' &&
        typeof rec.patchDoc === 'function' &&
        typeof rec.deleteDoc === 'function' &&
        typeof rec.getDoc === 'function'
    ) {
        const boundCollection = options.boundCollection;
        const assertCol = (col: string): void => {
            if (boundCollection && col !== boundCollection) {
                throw new Error(
                    `Cannot operate on collection '${col}': target is bound to collection '${boundCollection}'.`
                );
            }
        };

        return {
            boundCollection,
            async get(collection: string, id: string): Promise<unknown> {
                assertCol(collection);
                const doc = await rec.getDoc(collection, id);
                return doc ? doc.data : null;
            },
            async insert(
                collection: string,
                id: string,
                data: Record<string, unknown>,
                mutationId?: string,
                origin?: string
            ): Promise<unknown> {
                assertCol(collection);
                const doc = await rec.insertDoc(
                    collection,
                    id,
                    data,
                    undefined,
                    mutationId,
                    origin
                );
                return doc ? doc.data : null;
            },
            async patch(
                collection: string,
                id: string,
                patch: Record<string, unknown>,
                mutationId?: string,
                origin?: string
            ): Promise<unknown> {
                assertCol(collection);
                const doc = await rec.patchDoc(
                    collection,
                    id,
                    patch,
                    undefined,
                    mutationId,
                    origin
                );
                return doc ? doc.data : null;
            },
            async remove(
                collection: string,
                id: string,
                mutationId?: string,
                origin?: string
            ): Promise<boolean> {
                assertCol(collection);
                try {
                    await rec.deleteDoc(collection, id, mutationId, origin);
                    return true;
                } catch {
                    return false;
                }
            },
            async flush(collection?: string, id?: string): Promise<void> {
                if (collection && boundCollection) {
                    assertCol(collection);
                }
                if (typeof rec.flush === 'function') {
                    await rec.flush(collection, id);
                }
            },
        };
    }

    // Case 4: Already implements MutationTarget
    if (
        typeof rec.get === 'function' &&
        typeof rec.insert === 'function' &&
        typeof rec.patch === 'function' &&
        typeof rec.remove === 'function'
    ) {
        return rec as MutationTarget;
    }

    throw new UnsupportedStoreError();
}

/**
 * Applies a normalized command against a MutationTarget using consistent semantics:
 * - CREATE: insert (or patch if already exists)
 * - PATCH: patch existing or insert if not present
 * - PATCH_PATH: build nested path patch, patch existing or insert if not present
 * - DELETE: remove document; missing document is a silent no-op
 * - durable: calls target.flush()
 */
export async function applyStoreCommand(
    target: MutationTarget,
    cmd: NormalizedStoreCommand
): Promise<unknown> {
    let result: unknown = null;

    switch (cmd.type) {
        case 'CREATE': {
            const existing = await target.get(cmd.collection, cmd.id);
            if (existing) {
                result = await target.patch(
                    cmd.collection,
                    cmd.id,
                    cmd.delta ?? {},
                    cmd.mutationId,
                    cmd.origin
                );
            } else {
                result = await target.insert(
                    cmd.collection,
                    cmd.id,
                    cmd.delta ?? {},
                    cmd.mutationId,
                    cmd.origin
                );
            }
            break;
        }

        case 'PATCH': {
            const existing = await target.get(cmd.collection, cmd.id);
            if (existing) {
                result = await target.patch(
                    cmd.collection,
                    cmd.id,
                    cmd.delta ?? {},
                    cmd.mutationId,
                    cmd.origin
                );
            } else {
                result = await target.insert(
                    cmd.collection,
                    cmd.id,
                    cmd.delta ?? {},
                    cmd.mutationId,
                    cmd.origin
                );
            }
            break;
        }

        case 'PATCH_PATH': {
            const patch = cmd.path ? buildNestedPathPatch(cmd.path, cmd.value) : (cmd.delta ?? {});
            const existing = await target.get(cmd.collection, cmd.id);
            if (existing) {
                result = await target.patch(
                    cmd.collection,
                    cmd.id,
                    patch,
                    cmd.mutationId,
                    cmd.origin
                );
            } else {
                result = await target.insert(
                    cmd.collection,
                    cmd.id,
                    patch,
                    cmd.mutationId,
                    cmd.origin
                );
            }
            break;
        }

        case 'DELETE': {
            try {
                result = await target.remove(
                    cmd.collection,
                    cmd.id,
                    cmd.mutationId,
                    cmd.origin
                );
            } catch {
                result = false;
            }
            break;
        }
    }

    if (cmd.durable === true && typeof target.flush === 'function') {
        await target.flush(cmd.collection, cmd.id);
    }

    return result;
}
