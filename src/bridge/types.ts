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
    readonly durable?: boolean;
    readonly sourceId?: string;
}

/**
 * Error events emitted by the store bridge error stream.
 */
export interface BridgeCommandErrorEvent {
    readonly kind: 'command';
    readonly collection?: string;
    readonly id?: string;
    readonly mutationId?: string;
    readonly correlationId?: string;
    readonly error: unknown;
}

export interface BridgeBusSendErrorEvent {
    readonly kind: 'bus_send';
    readonly channel?: string;
    readonly topic?: string;
    readonly error: unknown;
}

export interface BridgeValidationErrorEvent {
    readonly kind: 'validation';
    readonly error: unknown;
}

export type BridgeErrorEvent =
    | BridgeCommandErrorEvent
    | BridgeBusSendErrorEvent
    | BridgeValidationErrorEvent;

/**
 * Configuration options for attaching a store bridge to MsgMesh.
 */
export interface StoreBridgeOptions {
    readonly channelPrefix?: string;
    readonly enableCdcStream?: boolean;
    readonly enableCommandHandling?: boolean;
    /** @deprecated Use MutationLedger deterministic suppression. Retained for backwards compatibility. */
    readonly echoSuppressionMs?: number;
    readonly defaultOrigin?: StoreCdcOrigin;
    readonly collection?: string;
    readonly secondaryChannelPerCollection?: boolean;
    readonly publishOrigins?: StoreCdcOrigin[];
    readonly freezeEvents?: boolean;
    readonly ledgerCapacity?: number;
    readonly onInvalid?: (error: unknown, rawItem: unknown) => void;
}

/**
 * Controller interface returned by attachStoreBridge.
 */
export interface StoreBridgeController {
    readonly isConnected: boolean;
    readonly isDisposed: boolean;
    readonly cdc$: Observable<StoreCdcEvent>;
    readonly errors$: Observable<BridgeErrorEvent>;
    whenIdle(): Promise<void>;
    disconnect(): void;
    dispose(): void;
}
