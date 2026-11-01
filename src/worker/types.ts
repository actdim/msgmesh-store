import type { Observable } from 'rxjs';
import type { StoreCdcEvent, StoreCdcOrigin } from '../cdc/types';

/**
 * Thrown when an operation is attempted on a worker client whose worker has died or been closed.
 */
export class WorkerDeadError extends Error {
    constructor(message = 'Worker is dead or has been closed.') {
        super(message);
        this.name = 'WorkerDeadError';
    }
}

/**
 * Thrown when an unsupported persisted storage engine is hosted inside a Web Worker.
 */
export class WorkerHostStorageError extends Error {
    constructor(
        message = 'LiveStruct store hosted in worker must use forceMemory or in-memory storage.'
    ) {
        super(message);
        this.name = 'WorkerHostStorageError';
    }
}

/**
 * Supported mutation actions dispatched across the worker boundary.
 */
export type WorkerRequestAction = 'CREATE' | 'PATCH' | 'PATCH_PATH' | 'DELETE';

/**
 * Message types emitted by the client to the worker host.
 */
export type WorkerRequestType = 'INIT' | 'COMMAND' | 'QUERY' | 'CLOSE';

/**
 * Clean shutdown / close message dispatched across worker boundary in either direction.
 */
export interface WorkerCloseMessage {
    readonly type: 'CLOSE';
    readonly reason?: string;
}

/**
 * Initialization handshake request from client to worker host.
 */
export interface WorkerInitRequest {
    readonly id: string;
    readonly type: 'INIT';
    readonly payload?: {
        readonly storeName?: string;
        readonly options?: Record<string, unknown>;
        readonly [key: string]: unknown;
    };
}

/**
 * Mutation command request serialized across the worker boundary.
 */
export interface WorkerCommandRequest {
    readonly id: string;
    readonly type: 'COMMAND';
    readonly payload: {
        readonly action: WorkerRequestAction;
        readonly collection: string;
        readonly docId: string;
        readonly data?: Record<string, unknown>;
        readonly path?: string;
        readonly value?: unknown;
        readonly mutationId?: string;
    };
}

/**
 * Raw SQL query request dispatched to the worker store engine.
 */
export interface WorkerQueryRequest {
    readonly id: string;
    readonly type: 'QUERY';
    readonly payload: {
        readonly sql: string;
        readonly params?: unknown[];
    };
}

/**
 * Union of all requests sent from client to worker.
 */
export type WorkerClientRequest =
    | WorkerInitRequest
    | WorkerCommandRequest
    | WorkerQueryRequest
    | WorkerCloseMessage;

/**
 * Successful initialization response.
 */
export interface WorkerInitResponse {
    readonly id: string;
    readonly type: 'INIT_OK';
    readonly payload?: Record<string, unknown>;
}

/**
 * Successful command mutation confirmation response.
 */
export interface WorkerCommandResponse {
    readonly id: string;
    readonly type: 'COMMAND_OK';
    readonly payload?: {
        readonly mutationId?: string;
        readonly [key: string]: unknown;
    };
}

/**
 * Successful query result response.
 */
export interface WorkerQueryResponse {
    readonly id: string;
    readonly type: 'QUERY_OK';
    readonly payload: {
        readonly rows: unknown[];
    };
}

/**
 * Unsolicited Change Data Capture (CDC) delta event stream from worker to client.
 */
export interface WorkerCdcResponse {
    readonly type: 'CDC';
    readonly payload: StoreCdcEvent;
}

/**
 * Normalized error response returned on initialization, command, or query failure.
 */
export interface WorkerErrorResponse {
    readonly id?: string;
    readonly type: 'ERROR';
    readonly error: {
        readonly message: string;
        readonly name?: string;
        readonly stack?: string;
        readonly code?: string;
    };
}

/**
 * Union of all messages emitted from worker host to client.
 */
export type WorkerHostMessage =
    | WorkerInitResponse
    | WorkerCommandResponse
    | WorkerQueryResponse
    | WorkerCdcResponse
    | WorkerErrorResponse
    | WorkerCloseMessage;

/**
 * Generic message event wrapper for worker transport ports.
 */
export interface WorkerMessageEventLike<T = unknown> {
    readonly data: T;
}

/**
 * Universal abstraction for Worker, MessagePort, DedicatedWorkerGlobalScope, or in-memory channel.
 */
export interface WorkerMessagePortLike {
    postMessage(message: unknown, transfer?: unknown[]): void;
    addEventListener?(type: string, listener: (...args: any[]) => void): void;
    removeEventListener?(type: string, listener: (...args: any[]) => void): void;
    on?(event: string, listener: (...args: any[]) => void): void;
    off?(event: string, listener: (...args: any[]) => void): void;
    addListener?(event: string, listener: (...args: any[]) => void): void;
    removeListener?(event: string, listener: (...args: any[]) => void): void;
    onmessage?: ((event: WorkerMessageEventLike<unknown>) => void) | null;
    onerror?: ((error: unknown) => void) | null;
    onclose?: ((event: unknown) => void) | null;
    terminate?(): void;
    close?(): void;
    start?(): void;
}

/**
 * Lifecycle states of the WorkerStoreClient.
 */
export type WorkerClientState = 'idle' | 'initializing' | 'ready' | 'dead' | 'disposed';

/**
 * Options for configuring the worker store client.
 */
export interface WorkerStoreClientOptions {
    readonly initTimeoutMs?: number;
    readonly requestTimeoutMs?: number;
    readonly autoInit?: boolean;
    readonly initPayload?: Record<string, unknown>;
    readonly terminateOnDispose?: boolean;
    readonly errorPolicy?: 'fatal' | 'log';
}

/**
 * Alias for WorkerStoreClientOptions.
 */
export type WorkerClientOptions = WorkerStoreClientOptions;

/**
 * Main-thread client facade communicating with worker storage engine via postMessage.
 */
export interface WorkerStoreClient {
    readonly state: WorkerClientState;
    readonly isReady: boolean;
    readonly isDisposed: boolean;
    readonly cdc$: Observable<StoreCdcEvent>;
    readonly errors$: Observable<unknown>;
    ready(): Promise<void>;
    reconnect(port?: WorkerMessagePortLike): Promise<void>;
    create(
        collection: string,
        id: string,
        data: Record<string, unknown>,
        options?: { mutationId?: string }
    ): Promise<void>;
    patch(
        collection: string,
        id: string,
        delta: Record<string, unknown>,
        options?: { mutationId?: string }
    ): Promise<void>;
    patchPath(
        collection: string,
        id: string,
        path: string,
        value: unknown,
        options?: { mutationId?: string }
    ): Promise<void>;
    delete(
        collection: string,
        id: string,
        options?: { mutationId?: string }
    ): Promise<void>;
    query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]>;
    dispose(): void;
}

/**
 * Store target or lazy store factory accepted by the worker host.
 */
export type StoreOrFactory = unknown | (() => unknown | Promise<unknown>);

/**
 * Configuration options for attaching a worker store host.
 */
export interface WorkerHostOptions {
    readonly channelPrefix?: string;
    readonly defaultOrigin?: StoreCdcOrigin;
    readonly collection?: string;
    readonly factoryRetries?: number;
}

/**
 * Host controller managing the worker store lifecycle.
 */
export interface WorkerHostController {
    readonly isDisposed: boolean;
    readonly store: unknown | null;
    dispose(): void;
}
