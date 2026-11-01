import { describe, it, expect } from 'vitest';
import { KeyedSerialQueue } from '../src/core/keyedQueue';

function createDeferred<T = void>() {
    let resolve!: (value: T | PromiseLike<T>) => void;
    let reject!: (reason?: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

describe('KeyedSerialQueue', () => {
    it('executes tasks for the same key strictly sequentially in arrival order', async () => {
        const queue = new KeyedSerialQueue();
        const executionOrder: number[] = [];
        const t1Gate = createDeferred<void>();
        const t2Gate = createDeferred<void>();

        const t1 = queue.run('user-1', async () => {
            await t1Gate.promise;
            executionOrder.push(1);
            return 'res-1';
        });

        const t2 = queue.run('user-1', async () => {
            await t2Gate.promise;
            executionOrder.push(2);
            return 'res-2';
        });

        const t3 = queue.run('user-1', async () => {
            executionOrder.push(3);
            return 'res-3';
        });

        // While t1 is blocked, neither t2 nor t3 should have executed
        expect(executionOrder).toEqual([]);

        // Unblock t1
        t1Gate.resolve();
        expect(await t1).toBe('res-1');
        expect(executionOrder).toEqual([1]);

        // Unblock t2
        t2Gate.resolve();
        const [r2, r3] = await Promise.all([t2, t3]);
        expect(r2).toBe('res-2');
        expect(r3).toBe('res-3');
        expect(executionOrder).toEqual([1, 2, 3]);
    });

    it('executes tasks for different keys concurrently', async () => {
        const queue = new KeyedSerialQueue();
        const aStarted = createDeferred<void>();
        const bStarted = createDeferred<void>();
        const aGate = createDeferred<void>();

        let aFinished = false;
        let bFinished = false;

        const pA = queue.run('key-A', async () => {
            aStarted.resolve();
            await aGate.promise;
            aFinished = true;
        });

        const pB = queue.run('key-B', async () => {
            bStarted.resolve();
            bFinished = true;
        });

        // Wait for both to start
        await Promise.all([aStarted.promise, bStarted.promise]);
        await pB;

        // B finishes while A is still blocked
        expect(bFinished).toBe(true);
        expect(aFinished).toBe(false);

        // Unblock A
        aGate.resolve();
        await pA;
        expect(aFinished).toBe(true);
    });

    it('isolates errors so subsequent tasks on the same key still execute', async () => {
        const queue = new KeyedSerialQueue();
        const executionOrder: string[] = [];

        const p1 = queue.run('doc-1', async () => {
            executionOrder.push('task-1-fails');
            throw new Error('Task 1 boom');
        });

        const p2 = queue.run('doc-1', async () => {
            executionOrder.push('task-2-succeeds');
            return 'ok-2';
        });

        await expect(p1).rejects.toThrow('Task 1 boom');
        const res2 = await p2;
        expect(res2).toBe('ok-2');
        expect(executionOrder).toEqual(['task-1-fails', 'task-2-succeeds']);
    });

    it('drains completely waiting for all pending tasks across all keys', async () => {
        const queue = new KeyedSerialQueue();
        let count = 0;
        const gate1 = createDeferred<void>();
        const gate2 = createDeferred<void>();
        const gate3 = createDeferred<void>();

        queue.run('k1', async () => {
            await gate1.promise;
            count++;
        });
        queue.run('k2', async () => {
            await gate2.promise;
            count++;
        });
        queue.run('k1', async () => {
            await gate3.promise;
            count++;
        });

        expect(queue.size).toBe(2);

        gate1.resolve();
        gate2.resolve();
        gate3.resolve();

        await queue.drain();
        expect(count).toBe(3);
        expect(queue.size).toBe(0);
    });

    it('tracks active queue size dynamically and removes settled keys', async () => {
        const queue = new KeyedSerialQueue();
        expect(queue.size).toBe(0);

        const gate1 = createDeferred<void>();
        const gate2 = createDeferred<void>();

        const p1 = queue.run('key-1', async () => {
            await gate1.promise;
        });
        const p2 = queue.run('key-2', async () => {
            await gate2.promise;
        });

        expect(queue.size).toBe(2);

        gate1.resolve();
        gate2.resolve();

        await Promise.all([p1, p2]);
        expect(queue.size).toBe(0);
    });
});
