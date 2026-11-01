import { Subject, type Observable } from 'rxjs';
import type { StoreCdcEvent } from '../cdc/types';
import {
    WorkerDeadError,
    type WorkerClientRequest,
    type WorkerClientState,
    type WorkerHostMessage,
    type WorkerMessageEventLike,
    type WorkerMessagePortLike,
    type WorkerStoreClient,
    type WorkerStoreClientOptions,
} from './types';
import { addPortListener, removePortListener, safelyClone } from './channel';

interface PendingRequest<T = any> {
    resolve: (value: T) => void;
    reject: (reason: any) => void;
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

    const nextId = (prefix: string): string => {
        idCounter += 1;
        return `${prefix}_${idCounter}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    };

    const handleClose = (reason: string): void => {
        if (state === 'disposed') {
            return;
        }
        state = 'dead';
        deadReason = reason;
        initPromise = null;

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

        // 2. Worker shutdown / close message from host
        if (hostMsg.type === 'CLOSE') {
            handleClose(hostMsg.reason ?? 'Worker closed');
            return;
        }

        // 3. Error responses
        if (hostMsg.type === 'ERROR') {
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

        // 4. Init confirmation
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

        // 5. Command confirmation
        if (hostMsg.type === 'COMMAND_OK') {
            if (pendingRequests.has(hostMsg.id)) {
                const pending = pendingRequests.get(hostMsg.id)!;
                clearTimeout(pending.timer);
                pendingRequests.delete(hostMsg.id);
                pending.resolve(hostMsg.payload);
            }
            return;
        }

        // 6. Query results
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

        const reqId = (req as any).id as string;

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
                resolve,
                reject,
                timer,
                type: req.type,
            });

            try {
                currentPort.postMessage(req);
            } catch (err) {
                clearTimeout(timer);
                pendingRequests.delete(reqId);
                reject(err);
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
            return cdcSubject.asObservable();
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
                    action: 'CREATE',
                    collection,
                    docId: id,
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
                    action: 'PATCH',
                    collection,
                    docId: id,
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
        dispose(): void {
            if (state === 'disposed') {
                return;
            }
            state = 'disposed';

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
