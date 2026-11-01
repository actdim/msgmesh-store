/**
 * Structural interface for low-level document engine targets (e.g. LiveSqliteEngine).
 */
export interface LiveEngineTarget {
    getDoc(collection: string, id: string): Promise<{ data?: unknown } | unknown>;
    insertDoc(
        collection: string,
        id: string,
        data: Record<string, unknown>,
        meta?: unknown,
        mutationId?: string,
        origin?: string
    ): Promise<{ data?: unknown } | unknown>;
    patchDoc(
        collection: string,
        id: string,
        patch: Record<string, unknown>,
        meta?: unknown,
        mutationId?: string,
        origin?: string
    ): Promise<{ data?: unknown } | unknown>;
    deleteDoc(
        collection: string,
        id: string,
        mutationId?: string,
        origin?: string
    ): Promise<unknown>;
    flush?(collection?: string, id?: string): Promise<void>;
}

/**
 * Structural interface for high-level collection targets (e.g. LiveCollection).
 */
export interface LiveCollectionTarget {
    readonly name: string;
    get(id: string): Promise<{ data?: unknown; patch?: (delta: Record<string, unknown>) => Promise<unknown> } | unknown>;
    create(id: string, data: Record<string, unknown>): Promise<{ data?: unknown } | unknown>;
    delete(id: string): Promise<unknown>;
    flush?(): Promise<void>;
}

/**
 * Structural interface for high-level store instances (e.g. LiveStoreInstance).
 */
export interface LiveStoreTarget {
    readonly engine: LiveEngineTarget;
    collection?(name: string): Promise<LiveCollectionTarget> | LiveCollectionTarget;
    flush?(collection?: string, id?: string): Promise<void>;
}

/**
 * Structural interface for custom or mock storage targets.
 */
export type CustomStoreTarget =
    | {
          get(collection: string, id: string): Promise<unknown>;
          insert?(
              collection: string,
              id: string,
              data: Record<string, unknown>,
              mutationId?: string,
              origin?: string
          ): Promise<unknown>;
          patch?(
              collection: string,
              id: string,
              patch: Record<string, unknown>,
              mutationId?: string,
              origin?: string
          ): Promise<unknown>;
          remove?(
              collection: string,
              id: string,
              mutationId?: string,
              origin?: string
          ): Promise<boolean>;
          flush?(collection?: string, id?: string): Promise<void>;
      }
    | {
          collection(name: string): Promise<unknown> | unknown;
          flush?(collection?: string, id?: string): Promise<void>;
      };

/**
 * Unified storage target accepted by the store bridge and mutation engines.
 */
export type StoreTarget =
    | LiveStoreTarget
    | LiveEngineTarget
    | LiveCollectionTarget
    | CustomStoreTarget;
