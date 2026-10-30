import type { Observable } from 'rxjs';
import type { StoreCdcEvent, StoreCdcOrigin } from '../cdc/types';

/**
 * Command types accepted by the store bridge.
 */
export type StoreCommandType = 'CREATE' | 'PATCH' | 'DELETE' | 'PATCH_PATH';

/**
 * Payload structure for bus-driven store mutation commands.
 */
export interface StoreCommandPayload<T = Record<string, unknown>> {
    readonly type?: StoreCommandType;
    readonly action?: StoreCommandType;
    readonly collection?: string;
    readonly id: string;
    readonly delta?: Partial<T> | Record<string, unknown>;
    readonly data?: Partial<T> | Record<string, unknown>;
    readonly path?: string;
    readonly value?: unknown;
    readonly origin?: StoreCdcOrigin;
    readonly correlationId?: string;
    readonly mutationId?: string;
}

/**
 * Configuration options for attaching a store bridge to MsgMesh.
 */
export interface StoreBridgeOptions {
    readonly channelPrefix?: string;
    readonly enableCdcStream?: boolean;
    readonly enableCommandHandling?: boolean;
    readonly echoSuppressionMs?: number;
    readonly defaultOrigin?: StoreCdcOrigin;
    readonly collection?: string;
    readonly secondaryChannelPerCollection?: boolean;
}

/**
 * Controller interface returned by attachStoreBridge.
 */
export interface StoreBridgeController {
    readonly isConnected: boolean;
    readonly isDisposed: boolean;
    readonly cdc$: Observable<StoreCdcEvent>;
    disconnect(): void;
    dispose(): void;
}
