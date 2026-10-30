import type {
    WorkerMessageEventLike,
    WorkerMessagePortLike,
} from './types';

/**
 * Deep clones data simulating the Web Worker Structured Clone Algorithm.
 */
export function safelyClone<T>(data: T): T {
    if (data === undefined || data === null) {
        return data;
    }
    if (typeof globalThis.structuredClone === 'function') {
        try {
            return globalThis.structuredClone(data);
        } catch {
            // Fall back to JSON serialization if structuredClone throws (e.g. non-cloneable objects)
        }
    }
    return JSON.parse(JSON.stringify(data)) as T;
}

/**
 * Universal event listener registration supporting standard addEventListener,
 * Node EventEmitter (on/addListener), or direct onmessage/onerror properties.
 */
export function addPortListener(
    port: WorkerMessagePortLike,
    type: string,
    listener: (...args: any[]) => void
): void {
    if (typeof port.addEventListener === 'function') {
        port.addEventListener(type, listener);
    } else if (typeof port.on === 'function') {
        port.on(type, listener);
    } else if (typeof port.addListener === 'function') {
        port.addListener(type, listener);
    } else if (type === 'message') {
        port.onmessage = listener;
    } else if (type === 'error') {
        port.onerror = listener;
    }
}

/**
 * Universal event listener removal supporting standard removeEventListener,
 * Node EventEmitter (off/removeListener), or direct onmessage/onerror properties.
 */
export function removePortListener(
    port: WorkerMessagePortLike,
    type: string,
    listener: (...args: any[]) => void
): void {
    if (typeof port.removeEventListener === 'function') {
        port.removeEventListener(type, listener);
    } else if (typeof port.off === 'function') {
        port.off(type, listener);
    } else if (typeof port.removeListener === 'function') {
        port.removeListener(type, listener);
    } else if (type === 'message' && port.onmessage === listener) {
        port.onmessage = null;
    } else if (type === 'error' && port.onerror === listener) {
        port.onerror = null;
    }
}

/**
 * Hermetic in-memory message port simulating asynchronous postMessage transport.
 */
export class InMemoryMessagePort implements WorkerMessagePortLike {
    private peer: InMemoryMessagePort | null = null;
    private listeners = new Map<string, Set<(...args: any[]) => void>>();
    private _isClosed = false;

    onmessage: ((event: WorkerMessageEventLike<unknown>) => void) | null = null;
    onerror: ((error: unknown) => void) | null = null;

    get isClosed(): boolean {
        return this._isClosed;
    }

    _setPeer(peer: InMemoryMessagePort): void {
        this.peer = peer;
    }

    postMessage(message: unknown, _transfer?: unknown[]): void {
        if (this._isClosed || !this.peer || this.peer._isClosed) {
            return;
        }

        const cloned = safelyClone(message);
        const target = this.peer;

        queueMicrotask(() => {
            if (!target.isClosed) {
                target._dispatch('message', { data: cloned });
            }
        });
    }

    addEventListener(type: string, listener: (...args: any[]) => void): void {
        if (!this.listeners.has(type)) {
            this.listeners.set(type, new Set());
        }
        this.listeners.get(type)!.add(listener);
    }

    removeEventListener(type: string, listener: (...args: any[]) => void): void {
        const set = this.listeners.get(type);
        if (set) {
            set.delete(listener);
        }
    }

    on(type: string, listener: (...args: any[]) => void): void {
        this.addEventListener(type, listener);
    }

    off(type: string, listener: (...args: any[]) => void): void {
        this.removeEventListener(type, listener);
    }

    addListener(type: string, listener: (...args: any[]) => void): void {
        this.addEventListener(type, listener);
    }

    removeListener(type: string, listener: (...args: any[]) => void): void {
        this.removeEventListener(type, listener);
    }

    terminate(): void {
        this.close();
    }

    close(): void {
        if (this._isClosed) {
            return;
        }
        this._isClosed = true;
        this.listeners.clear();
        this.onmessage = null;
        this.onerror = null;
        this.peer = null;
    }

    triggerError(error: unknown): void {
        if (this._isClosed) {
            return;
        }
        queueMicrotask(() => {
            if (!this._isClosed) {
                this._dispatch('error', error);
            }
        });
    }

    private _dispatch(type: string, eventOrData: unknown): void {
        if (type === 'message') {
            if (typeof this.onmessage === 'function') {
                this.onmessage(eventOrData as WorkerMessageEventLike<unknown>);
            }
        } else if (type === 'error') {
            if (typeof this.onerror === 'function') {
                this.onerror(eventOrData);
            }
        }

        const handlers = this.listeners.get(type);
        if (handlers) {
            for (const handler of Array.from(handlers)) {
                try {
                    handler(eventOrData);
                } catch (err) {
                    console.error(`[InMemoryMessagePort] Error in '${type}' handler:`, err);
                }
            }
        }
    }
}

/**
 * Creates an in-memory pair of connected ports for hermetic unit testing
 * without requiring DOM or Web Worker browser globals.
 */
export function createMessageChannelPair(): {
    port1: WorkerMessagePortLike;
    port2: WorkerMessagePortLike;
} {
    const port1 = new InMemoryMessagePort();
    const port2 = new InMemoryMessagePort();

    port1._setPeer(port2);
    port2._setPeer(port1);

    return { port1, port2 };
}
