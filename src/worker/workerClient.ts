import { Subject, Observable } from 'rxjs';
import type { StoreCdcEvent } from '../cdc/types';
import {
    WorkerDeadError,
    type WorkerBatchRequest,
    type WorkerClientRequest,
    type WorkerClientState,
    type WorkerHostMessage,
    type WorkerMessageEventLike,
    type WorkerMessagePortLike,
    type WorkerStoreClient,
    type WorkerStoreClientOptions,
} from './types';
import { addPortListener, removePortListener, safelyClone } from './channel';

interface PendingRequest {
    resolve: (value: unknown) => void;
    reject: (reason: unknown) => void;
    timer: ReturnType<typeof setTimeout>;
    type: string;
}

/**
 * Creates a main-thread client communicating with a storage engine inside a Web Worker.
 */
export function createWorkerStoreClient(
    portOrWorker: WorkerMessagePortLike,
    options: WorkerStoreClientOptions = {}
): WorkerStoreClient {
    let currentPort: WorkerMessagePortLike = portOrWorker;
    let state: WorkerClientState = 'idle';
    let deadReason: string | undefined = undefined;
    let idCounter = 0;

    const errorPolicy = options.errorPolicy ?? 'fatal';
    const defaultRequestTimeoutMs = options.requestTimeoutMs ?? 10000;
    const defaultInitTimeoutMs = options.initTimeoutMs ?? 5000;

    const cdcSubject = new Subject<StoreCdcEvent>();
    const errorsSubject = new Subject<unknown>();
    const pendingRequests = new Map<string, PendingRequest>();

    // Batching state
    const batchMode = options.batch;
    const useBatching = Boolean(batchMode && batchMode !== 'none');
    let flushScheduled = false;
    const batchQueue: WorkerClientRequest[] = [];
    const batchRequestsMap = new Map<string, string[]>();

    // CDC subscription refcounting
    let cdcSubscriberCount = 0;
    const cdc$ = new Observable<StoreCdcEvent>((subscriber) => {
        cdcSubscriberCount++;
        if (cdcSubscriberCount === 1) {
            try {
                currentPort.postMessage({ type: 'CDC_SUBSCRIBE' });
            } catch {
                // Ignore if port not ready
            }
        }
        const sub = cdcSubject.subscribe(subscriber);
        return () => {
            sub.unsubscribe();
            cdcSubscriberCount--;
            if (cdcSubscriberCount === 0) {
                try {
                    currentPort.postMessage({ type: 'CDC_UNSUBSCRIBE' });
                } catch {
                    // Ignore if port closed
                }
            }
        };
    });

    const nextId = (prefix: string): string => {
        idCounter += 1;
        return `${prefix}_${idCounter}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    };

    const flushBatch = (): void => {
        if (state === 'dead' || state === 'disposed' || batchQueue.length === 0) {
            batchQueue.length = 0;
            return;
        }

        if (batchQueue.length === 1) {
            const singleReq = batchQueue.shift()!;
            try {
                currentPort.postMessage(singleReq);
            } catch (err) {
                const reqId = (singleReq as { id: string }).id;
                const pending = pendingRequests.get(reqId);
                if (pending) {
                    clearTimeout(pending.timer);
                    pendingRequests.delete(reqId);
                    pending.reject(err);
                }
            }
            return;
        }

        const reqs = batchQueue.splice(0, batchQueue.length);
        const batchId = nextId('batch');
        const itemIds = reqs.map((r) => (r as { id: string }).id);
        batchRequestsMap.set(batchId, itemIds);

        const batchReq: WorkerBatchRequest = {
            id: batchId,
            type: 'BATCH',
            payload: reqs,
        };

        try {
            currentPort.postMessage(batchReq);
        } catch (err) {
            batchRequestsMap.delete(batchId);
            for (const req of reqs) {
                const reqId = (req as { id: string }).id;
                const pending = pendingRequests.get(reqId);
                if (pending) {
                    clearTimeout(pending.timer);
                    pendingRequests.delete(reqId);
                    pending.reject(err);
                }
            }
        }
    };

    const scheduleFlush = (): void => {
        if (flushScheduled) {
            return;
        }
        flushScheduled = true;
        const doFlush = () => {
            flushScheduled = false;
            flushBatch();
        };

        if (batchMode === 'microtask') {
            queueMicrotask(doFlush);
        } else if (typeof batchMode === 'function') {
            batchMode(doFlush);
        }
    };

    const handleClose = (reason: string): void => {
        if (state === 'disposed') {
            return;
        }
        state = 'dead';
        deadReason = reason;
        initPromise = null;
        batchQueue.length = 0;
        batchRequestsMap.clear();

        const deadErr = new WorkerDeadError(reason);
        for (const [, pending] of pendingRequests.entries()) {
            clearTimeout(pending.timer);
            pending.reject(deadErr);
        }
        pendingRequests.clear();
        errorsSubject.next(deadErr);
    };

    const handleMessage = (event: WorkerMessageEventLike<unknown>): void => {
        if (state === 'disposed') {
            return;
        }

        const msg = event && typeof event === 'object' && 'data' in event ? event.data : event;
        if (!msg || typeof msg !== 'object') {
            return;
        }

        const hostMsg = msg as WorkerHostMessage;

        // 1. Streaming Change Data Capture (CDC) events
        if (hostMsg.type === 'CDC') {
            if (hostMsg.payload) {
                cdcSubject.next(hostMsg.payload);
            }
            return;
        }

        if (hostMsg.type === 'CDC_BATCH') {
            if (Array.isArray(hostMsg.payload)) {
                for (const eventItem of hostMsg.payload) {
                    cdcSubject.next(eventItem);
                }
            }
            return;
        }

        // 2. Worker shutdown / close message from host
        if (hostMsg.type === 'CLOSE') {
            handleClose(hostMsg.reason ?? 'Worker closed');
            return;
        }

        // 3. Batch confirmation response
        if (hostMsg.type === 'BATCH_OK') {
            if (hostMsg.id) {
                batchRequestsMap.delete(hostMsg.id);
            }
            const results = hostMsg.payload?.results ?? [];
            for (const item of results) {
                if (item && item.id && pendingRequests.has(item.id)) {
                    const pending = pendingRequests.get(item.id)!;
                    clearTimeout(pending.timer);
                    pendingRequests.delete(item.id);
                    if (item.success) {
                        pending.resolve(item.result);
                    } else {
                        const err =
                            item.error instanceof Error
                                ? item.error
                                : typeof item.error === 'object' &&
                                  item.error !== null &&
                                  'message' in item.error
                                ? Object.assign(
                                      new Error((item.error as { message: string }).message),
                                      item.error
                                  )
                                : new Error(String(item.error || 'Batch item failed'));
                        pending.reject(err);
                    }
                }
            }
            return;
        }

        // 4. Error responses
        if (hostMsg.type === 'ERROR') {
            if (hostMsg.id && batchRequestsMap.has(hostMsg.id)) {
                const itemIds = batchRequestsMap.get(hostMsg.id)!;
                batchRequestsMap.delete(hostMsg.id);
                const err = new Error(hostMsg.error?.message || 'Worker host error');
                if (hostMsg.error?.name) {
                    err.name = hostMsg.error.name;
                }
                for (const id of itemIds) {
                    if (pendingRequests.has(id)) {
                        const pending = pendingRequests.get(id)!;
                        clearTimeout(pending.timer);
                        pendingRequests.delete(id);
                        pending.reject(err);
                    }
                }
                return;
            }

            if (hostMsg.id && pendingRequests.has(hostMsg.id)) {
                const pending = pendingRequests.get(hostMsg.id)!;
                clearTimeout(pending.timer);
                pendingRequests.delete(hostMsg.id);

                const err = new Error(hostMsg.error?.message || 'Worker host error');
                if (hostMsg.error?.name) {
                    err.name = hostMsg.error.name;
                }
                pending.reject(err);
            } else {
                const err = new Error(hostMsg.error?.message || 'Worker host error');
                if (hostMsg.error?.name) {
                    err.name = hostMsg.error.name;
                }
                console.error('[WorkerStoreClient] Worker host reported error:', hostMsg.error);
                errorsSubject.next(err);
            }
            return;
        }

        // 5. Init confirmation
        if (hostMsg.type === 'INIT_OK') {
            state = 'ready';
            if (pendingRequests.has(hostMsg.id)) {
                const pending = pendingRequests.get(hostMsg.id)!;
                clearTimeout(pending.timer);
                pendingRequests.delete(hostMsg.id);
                pending.resolve(hostMsg.payload);
            }
            return;
        }

        // 6. Command confirmation
        if (hostMsg.type === 'COMMAND_OK') {
            if (pendingRequests.has(hostMsg.id)) {
                const pending = pendingRequests.get(hostMsg.id)!;
                clearTimeout(pending.timer);
                pendingRequests.delete(hostMsg.id);
                pending.resolve(hostMsg.payload);
            }
            return;
        }

        // 7. Query results
        if (hostMsg.type === 'QUERY_OK') {
            if (pendingRequests.has(hostMsg.id)) {
                const pending = pendingRequests.get(hostMsg.id)!;
                clearTimeout(pending.timer);
                pendingRequests.delete(hostMsg.id);
                pending.resolve(hostMsg.payload?.rows ?? []);
            }
            return;
        }
    };

    const handleError = (error: unknown): void => {
        if (state === 'disposed') {
            return;
        }

        const errorMsg =
            error instanceof Error
                ? error.message
                : error && typeof error === 'object' && 'message' in error
                ? String((error as { message: unknown }).message)
                : String(error);

        const fatalError = new WorkerDeadError(`Worker boundary failure: ${errorMsg}`);

        if (errorPolicy === 'log') {
            console.error('[WorkerStoreClient] Worker boundary error (log policy):', fatalError);
            errorsSubject.next(fatalError);
            return;
        }

        state = 'dead';
        deadReason = `Worker boundary failure: ${errorMsg}`;
        initPromise = null;
        batchQueue.length = 0;
        batchRequestsMap.clear();

        for (const [, pending] of pendingRequests.entries()) {
            clearTimeout(pending.timer);
            pending.reject(fatalError);
        }
        pendingRequests.clear();

        errorsSubject.next(fatalError);
    };

    const handleMessageError = (event: unknown): void => {
        if (state === 'disposed') {
            return;
        }
        const err = event instanceof Error ? event : new Error(`Message deserialization error: ${String(event)}`);
        console.warn('[WorkerStoreClient] Non-fatal messageerror received:', event);
        errorsSubject.next(err);
    };

    const handlePortClose = (): void => {
        handleClose('Worker closed');
    };

    const attachListeners = (port: WorkerMessagePortLike): void => {
        addPortListener(port, 'message', handleMessage);
        addPortListener(port, 'error', handleError);
        addPortListener(port, 'messageerror', handleMessageError);
        addPortListener(port, 'close', handlePortClose);
    };

    const detachListeners = (port: WorkerMessagePortLike): void => {
        removePortListener(port, 'message', handleMessage);
        removePortListener(port, 'error', handleError);
        removePortListener(port, 'messageerror', handleMessageError);
        removePortListener(port, 'close', handlePortClose);
    };

    attachListeners(currentPort);

    if (typeof currentPort.start === 'function') {
        currentPort.start();
    }

    const sendRequest = <T>(req: WorkerClientRequest, timeoutMs = defaultRequestTimeoutMs): Promise<T> => {
        if (state === 'dead' || state === 'disposed') {
            const msg =
                deadReason ||
                (state === 'disposed'
                    ? 'WorkerStoreClient has been disposed.'
                    : 'Worker is dead or has been closed.');
            return Promise.reject(new WorkerDeadError(msg));
        }

        try {
            safelyClone(req);
        } catch (cloneErr) {
            return Promise.reject(cloneErr);
        }

        const reqId = (req as { id: string }).id;

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                pendingRequests.delete(reqId);
                reject(
                    new Error(
                        `Worker request timed out after ${timeoutMs}ms: [${req.type}]`
                    )
                );
            }, timeoutMs);

            pendingRequests.set(reqId, {
                resolve: resolve as (val: unknown) => void,
                reject,
                timer,
                type: req.type,
            });

            if (!useBatching || req.type === 'INIT') {
                try {
                    currentPort.postMessage(req);
                } catch (err) {
                    clearTimeout(timer);
                    pendingRequests.delete(reqId);
                    reject(err);
                }
            } else {
                batchQueue.push(req);
                scheduleFlush();
            }
        });
    };

    let initPromise: Promise<void> | null = null;

    const triggerInit = (): Promise<void> => {
        if (state === 'ready') {
            return Promise.resolve();
        }
        if (state === 'dead' || state === 'disposed') {
            const msg =
                deadReason ||
                (state === 'disposed'
                    ? 'WorkerStoreClient has been disposed.'
                    : 'Worker is dead or has been closed.');
            return Promise.reject(new WorkerDeadError(msg));
        }
        if (initPromise) {
            return initPromise;
        }

        state = 'initializing';
        const reqId = nextId('init');
        initPromise = sendRequest<Record<string, unknown>>(
            {
                id: reqId,
                type: 'INIT',
                payload: options.initPayload,
            },
            defaultInitTimeoutMs
        )
            .then(() => {
                state = 'ready';
            })
            .catch((err) => {
                initPromise = null;
                if (state === 'initializing') {
                    state = 'idle';
                }
                throw err;
            });

        return initPromise;
    };

    if (options.autoInit !== false) {
        void triggerInit().catch(() => {
            // Error captured when caller awaits ready()
        });
    }

    const client: WorkerStoreClient = {
        get state(): WorkerClientState {
            return state;
        },
        get isReady(): boolean {
            return state === 'ready';
        },
        get isDisposed(): boolean {
            return state === 'disposed';
        },
        get cdc$(): Observable<StoreCdcEvent> {
            return cdc$;
        },
        get errors$(): Observable<unknown> {
            return errorsSubject.asObservable();
        },
        ready(): Promise<void> {
            return triggerInit();
        },
        reconnect(port?: WorkerMessagePortLike): Promise<void> {
            if (state === 'disposed') {
                return Promise.reject(new WorkerDeadError('WorkerStoreClient has been disposed.'));
            }
            if (port && port !== currentPort) {
                detachListeners(currentPort);
                currentPort = port;
                attachListeners(currentPort);
                if (typeof currentPort.start === 'function') {
                    currentPort.start();
                }
            }
            state = 'idle';
            deadReason = undefined;
            initPromise = null;
            batchQueue.length = 0;
            batchRequestsMap.clear();

            if (cdcSubscriberCount > 0) {
                try {
                    currentPort.postMessage({ type: 'CDC_SUBSCRIBE' });
                } catch {
                    // Ignore
                }
            }

            return triggerInit();
        },
        async create(
            collection: string,
            id: string,
            data: Record<string, unknown>,
            opts?: { mutationId?: string }
        ): Promise<void> {
            if (state === 'dead' || state === 'disposed') {
                throw new WorkerDeadError(
                    deadReason ||
                    (state === 'disposed' ? 'WorkerStoreClient has been disposed.' : 'Worker is dead or has been closed.')
                );
            }
            await triggerInit();
            const reqId = nextId('cmd');
            await sendRequest({
                id: reqId,
                type: 'COMMAND',
                payload: {
                    type: 'CREATE',
                    action: 'CREATE',
                    collection,
                    docId: id,
                    delta: data,
                    data,
                    mutationId: opts?.mutationId,
                },
            });
        },
        async patch(
            collection: string,
            id: string,
            delta: Record<string, unknown>,
            opts?: { mutationId?: string }
        ): Promise<void> {
            if (state === 'dead' || state === 'disposed') {
                throw new WorkerDeadError(
                    deadReason ||
                    (state === 'disposed' ? 'WorkerStoreClient has been disposed.' : 'Worker is dead or has been closed.')
                );
            }
            await triggerInit();
            const reqId = nextId('cmd');
            await sendRequest({
                id: reqId,
                type: 'COMMAND',
                payload: {
                    type: 'PATCH',
                    action: 'PATCH',
                    collection,
                    docId: id,
                    delta,
                    data: delta,
                    mutationId: opts?.mutationId,
                },
            });
        },
        async patchPath(
            collection: string,
            id: string,
            path: string,
            value: unknown,
            opts?: { mutationId?: string }
        ): Promise<void> {
            if (state === 'dead' || state === 'disposed') {
                throw new WorkerDeadError(
                    deadReason ||
                    (state === 'disposed' ? 'WorkerStoreClient has been disposed.' : 'Worker is dead or has been closed.')
                );
            }
            await triggerInit();
            const reqId = nextId('cmd');
            await sendRequest({
                id: reqId,
                type: 'COMMAND',
                payload: {
                    type: 'PATCH_PATH',
                    action: 'PATCH_PATH',
                    collection,
                    docId: id,
                    path,
                    value,
                    mutationId: opts?.mutationId,
                },
            });
        },
        async delete(
            collection: string,
            id: string,
            opts?: { mutationId?: string }
        ): Promise<void> {
            if (state === 'dead' || state === 'disposed') {
                throw new WorkerDeadError(
                    deadReason ||
                    (state === 'disposed' ? 'WorkerStoreClient has been disposed.' : 'Worker is dead or has been closed.')
                );
            }
            await triggerInit();
            const reqId = nextId('cmd');
            await sendRequest({
                id: reqId,
                type: 'COMMAND',
                payload: {
                    type: 'DELETE',
                    action: 'DELETE',
                    collection,
                    docId: id,
                    mutationId: opts?.mutationId,
                },
            });
        },
        async query<T = unknown>(sql: string, params?: unknown[]): Promise<T[]> {
            if (state === 'dead' || state === 'disposed') {
                throw new WorkerDeadError(
                    deadReason ||
                    (state === 'disposed' ? 'WorkerStoreClient has been disposed.' : 'Worker is dead or has been closed.')
                );
            }
            await triggerInit();
            const reqId = nextId('query');
            return sendRequest<T[]>({
                id: reqId,
                type: 'QUERY',
                payload: {
                    sql,
                    params,
                },
            });
        },
        disconnect(): void {
            this.dispose();
        },
        dispose(): void {
            if (state === 'disposed') {
                return;
            }
            state = 'disposed';
            batchQueue.length = 0;
            batchRequestsMap.clear();

            const disposeErr = new WorkerDeadError('WorkerStoreClient has been disposed.');
            for (const [, pending] of pendingRequests.entries()) {
                clearTimeout(pending.timer);
                pending.reject(disposeErr);
            }
            pendingRequests.clear();

            try {
                currentPort.postMessage({ type: 'CLOSE', reason: 'Client disposed' });
            } catch {
                // Ignore if port already closed or broken
            }

            detachListeners(currentPort);

            cdcSubject.complete();
            errorsSubject.complete();

            if (options.terminateOnDispose !== false) {
                if (typeof currentPort.terminate === 'function') {
                    currentPort.terminate();
                } else if (typeof currentPort.close === 'function') {
                    currentPort.close();
                }
            }
        },
    };

    return client;
}
