/**
 * Serial execution queue partitioned by string key.
 * Tasks with different keys run concurrently; tasks with the same key
 * run sequentially in FIFO order with per-task error isolation.
 */
export class KeyedSerialQueue {
    private readonly queues = new Map<string, Promise<unknown>>();

    /**
     * Number of currently active keys in the queue.
     */
    get size(): number {
        return this.queues.size;
    }

    /**
     * Enqueues a task under the given key.
     * Guaranteed FIFO execution per key.
     * Rejection of a preceding task does not cause subsequent tasks to fail.
     */
    run<T>(key: string, task: () => Promise<T>): Promise<T> {
        const prev = this.queues.get(key) ?? Promise.resolve();

        const runTask = (): Promise<T> => {
            try {
                return Promise.resolve(task());
            } catch (err) {
                return Promise.reject(err);
            }
        };

        const resultPromise = prev.then(runTask, runTask);

        const tailPromise = resultPromise
            .catch(() => {})
            .finally(() => {
                if (this.queues.get(key) === tailPromise) {
                    this.queues.delete(key);
                }
            });

        this.queues.set(key, tailPromise);

        return resultPromise;
    }

    /**
     * Waits until all currently enqueued tasks across all keys have settled.
     */
    async drain(): Promise<void> {
        while (this.queues.size > 0) {
            await Promise.allSettled(Array.from(this.queues.values()));
        }
    }
}
