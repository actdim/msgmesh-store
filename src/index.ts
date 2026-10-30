/**
 * @actdim/msgmesh-store
 * Decoupled message bus bridge and Change Data Capture (CDC) engine connecting @actdim/msgmesh with persistent stores.
 */

import { Observable } from 'rxjs';
import {
    type StoreCdcEvent,
    type CdcBridge,
    type MsgMeshBusLike,
    createCdcBridge,
} from './cdc/index';

export * from './cdc/index';

/**
 * Configuration options for attaching a persistent store bridge to MsgMesh.
 */
export interface StoreBridgeOptions {
    readonly channelPrefix?: string;
    readonly enableCdcStream?: boolean;
    readonly enableCommandHandling?: boolean;
    readonly echoSuppressionMs?: number;
    readonly collection?: string;
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
 * Attaches a LiveStruct/LiveStore collection or engine to an active MsgMesh message bus instance.
 */
export function attachStoreBridge(
    bus: unknown,
    storeOrCollection: unknown,
    options: StoreBridgeOptions = {}
): StoreBridgeController {
    const channelPrefix = options.channelPrefix ?? 'STORE';
    const enableCdc = options.enableCdcStream !== false;

    let bridge: CdcBridge | null = null;
    let fallbackConnected = true;

    if (storeOrCollection && enableCdc) {
        bridge = createCdcBridge(storeOrCollection, bus as MsgMeshBusLike, {
            channelPrefix,
            collection: options.collection,
        });
    }

    return {
        disconnect(): void {
            if (bridge) {
                bridge.dispose();
            } else {
                fallbackConnected = false;
            }
        },
        get isConnected(): boolean {
            if (bridge) {
                return bridge.isConnected;
            }
            return fallbackConnected;
        },
        get cdc$(): Observable<StoreCdcEvent> {
            if (bridge) {
                return bridge.cdc$;
            }
            throw new Error(
                `CDC stream for prefix '${channelPrefix}' requires an active store engine.`
            );
        },
    };
}
