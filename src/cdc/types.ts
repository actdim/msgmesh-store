import type { Observable } from 'rxjs';

/**
 * Mutation types emitted by the storage engine.
 */
export type StoreCdcType = 'insert' | 'update' | 'delete';

/**
 * Mutation origin tracking.
 * - 'local': change originated from direct local engine or collection mutation.
 * - 'remote': change originated from cloud replication or synchronization.
 * - 'bus': change arrived via message bus event.
 */
export type StoreCdcOrigin = 'local' | 'remote' | 'bus';

/**
 * Normalized Change Data Capture (CDC) event payload.
 */
export interface StoreCdcEvent<T = Record<string, unknown>> {
    readonly type: StoreCdcType;
    readonly collection: string;
    readonly id: string;
    readonly delta: Partial<T>;
    readonly origin: StoreCdcOrigin;
    readonly timestamp: number;
    readonly mutationId?: string;
}

/**
 * Subscription and filtering options for CDC event streams.
 */
export interface CdcSubscriptionOptions {
    readonly channelPrefix?: string;
    readonly collection?: string;
    readonly id?: string;
    readonly originFilter?: StoreCdcOrigin[];
    readonly typeFilter?: StoreCdcType[];
}

/**
 * Options for configuring a CDC bridge instance.
 */
export interface CdcBridgeOptions {
    readonly channelPrefix?: string;
    readonly defaultOrigin?: StoreCdcOrigin;
    readonly collection?: string;
    readonly secondaryChannelPerCollection?: boolean;
}

/**
 * Disposable controller managing a CDC stream and its bus attachment.
 */
export interface CdcBridge {
    readonly isDisposed: boolean;
    readonly cdc$: Observable<StoreCdcEvent>;
    dispose(): void;
    disconnect(): void;
    readonly isConnected: boolean;
}

/**
 * Minimal interface for a MsgMesh bus used by CDC streaming.
 */
export interface MsgMeshBusLike {
    send(params: {
        channel: string | any;
        group?: string | any;
        topic?: string;
        payload?: unknown;
        [key: string]: unknown;
    }): Promise<unknown>;
    on?(params: any): unknown;
    [key: string]: unknown;
}
