/**
 * @actdim/msgmesh-store
 * Decoupled message bus bridge and Change Data Capture (CDC) engine connecting @actdim/msgmesh with persistent stores.
 */

import { Observable } from 'rxjs';

/**
 * Change Data Capture (CDC) event payload.
 */
export interface StoreCdcEvent<T = Record<string, unknown>> {
    readonly type: 'insert' | 'update' | 'delete';
    readonly collection: string;
    readonly id: string;
    readonly delta: Partial<T>;
    readonly origin: 'local' | 'remote' | 'bus';
    readonly timestamp: number;
}

/**
 * Configuration options for attaching a persistent store bridge to MsgMesh.
 */
export interface StoreBridgeOptions {
    readonly channelPrefix?: string;
    readonly enableCdcStream?: boolean;
    readonly enableCommandHandling?: boolean;
    readonly echoSuppressionMs?: number;
}

/**
 * Store bridge controller contract.
 */
export interface StoreBridgeController {
    disconnect(): void;
    readonly isConnected: boolean;
    readonly cdc$: Observable<StoreCdcEvent>;
}

/**
 * Attaches a LiveStruct/LiveStore collection to an active MsgMesh message bus instance.
 */
export function attachStoreBridge(
    _bus: unknown,
    _storeOrCollection: unknown,
    options: StoreBridgeOptions = {}
): StoreBridgeController {
    const channelPrefix = options.channelPrefix ?? 'STORE';
    let connected = true;

    return {
        disconnect(): void {
            connected = false;
        },
        get isConnected(): boolean {
            return connected;
        },
        get cdc$(): Observable<StoreCdcEvent> {
            throw new Error(`CDC stream for prefix '${channelPrefix}' requires an active store engine.`);
        },
    };
}
