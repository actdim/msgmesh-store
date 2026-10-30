import { Subject, type Observable } from 'rxjs';
import type { StoreCdcEvent } from '../cdc/types';
import type {
    WorkerClientRequest,
    WorkerHostMessage,
    WorkerMessageEventLike,
    WorkerMessagePortLike,
    WorkerStoreClient,
    WorkerStoreClientOptions,
} from './types';
import { addPortListener, removePortListener } from './channel';

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
    let isReady = false;
    let isDisposed = false;
    let idCounter = 0;

    const defaultRequestTimeoutMs = options.requestTimeoutMs ?? 10000;
    const defaultInitTimeoutMs = options.initTimeoutMs ?? 5000;

    const cdcSubject = new Subject<StoreCdcEvent>();
    const pendingRequests = new Map<string, PendingRequest>();

    const nextId = (prefix: string): string => {
        idCounter += 1;
        return `${prefix}_${idCounter}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
    };

    const handleMessage = (event: WorkerMessageEventLike<unknown>): void => {
        if (isDisposed) {
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

        // 2. Error responses
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
                console.error('[WorkerStoreClient] Worker host reported error:', hostMsg.error);
            }
            return;
        }

        // 3. Init confirmation
        if (hostMsg.type === 'INIT_OK') {
            isReady = true;
            if (pendingRequests.has(hostMsg.id)) {
                const pending = pendingRequests.get(hostMsg.id)!;
                clearTimeout(pending.timer);
                pendingRequests.delete(hostMsg.id);
                pending.resolve(hostMsg.payload);
            }
            return;
        }

        // 4. Command confirmation
        if (hostMsg.type === 'COMMAND_OK') {
            if (pendingRequests.has(hostMsg.id)) {
                const pending = pendingRequests.get(hostMsg.id)!;
                clearTimeout(pending.timer);
                pendingRequests.delete(hostMsg.id);
                pending.resolve(hostMsg.payload);
            }
            return;
        }

        // 5. Query results
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
        if (isDisposed) {
            return;
        }

        const errorMsg =
            error instanceof Error
                ? error.message
                : error && typeof error === 'object' && 'message' in error
                ? String((error as { message: unknown }).message)
                : String(error);

        const fatalError = new Error(`Worker boundary failure: ${errorMsg}`);

        for (const [id, pending] of pendingRequests.entries()) {
            clearTimeout(pending.timer);
            pending.reject(fatalError);
        }
        pendingRequests.clear();
    };

    // Attach listeners to port or worker
    addPortListener(portOrWorker, 'message', handleMessage);
    addPortListener(portOrWorker, 'error', handleError);
    addPortListener(portOrWorker, 'messageerror', handleError);

    if (typeof portOrWorker.start === 'function') {
        portOrWorker.start();
    }

    const sendRequest = <T>(req: WorkerClientRequest, timeoutMs = defaultRequestTimeoutMs): Promise<T> => {
        if (isDisposed) {
            return Promise.reject(new Error('WorkerStoreClient has been disposed.'));
        }

        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                pendingRequests.delete(req.id);
                reject(
                    new Error(
                        `Worker request timed out after ${timeoutMs}ms: [${req.type}]`
                    )
                );
            }, timeoutMs);

            pendingRequests.set(req.id, {
                resolve,
                reject,
                timer,
                type: req.type,
            });

            try {
                portOrWorker.postMessage(req);
            } catch (err) {
                clearTimeout(timer);
                pendingRequests.delete(req.id);
                reject(err);
            }
        });
    };

    let initPromise: Promise<void> | null = null;

    const triggerInit = (): Promise<void> => {
        if (isReady) {
            return Promise.resolve();
        }
        if (initPromise) {
            return initPromise;
        }

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
                isReady = true;
            })
            .catch((err) => {
                initPromise = null;
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
        get isReady(): boolean {
            return isReady;
        },
        get isDisposed(): boolean {
            return isDisposed;
        },
        get cdc$(): Observable<StoreCdcEvent> {
            return cdcSubject.asObservable();
        },
        ready(): Promise<void> {
            return triggerInit();
        },
        async create(
            collection: string,
            id: string,
            data: Record<string, unknown>,
            opts?: { mutationId?: string }
        ): Promise<void> {
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
            if (isDisposed) {
                return;
            }
            isDisposed = true;

            const disposeErr = new Error('WorkerStoreClient has been disposed.');
            for (const [, pending] of pendingRequests.entries()) {
                clearTimeout(pending.timer);
                pending.reject(disposeErr);
            }
            pendingRequests.clear();

            removePortListener(portOrWorker, 'message', handleMessage);
            removePortListener(portOrWorker, 'error', handleError);
            removePortListener(portOrWorker, 'messageerror', handleError);

            cdcSubject.complete();

            if (options.terminateOnDispose !== false) {
                if (typeof portOrWorker.terminate === 'function') {
                    portOrWorker.terminate();
                } else if (typeof portOrWorker.close === 'function') {
                    portOrWorker.close();
                }
            }
        },
    };

    return client;
}
