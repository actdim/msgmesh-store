import { describe, it, expect } from 'vitest';
import { KeyedSerialQueue } from '../src/core/keyedQueue';

describe('KeyedSerialQueue', () => {
    it('executes tasks for the same key strictly sequentially in arrival order', async () => {
        const queue = new KeyedSerialQueue();
        const executionOrder: number[] = [];

        const t1 = queue.run('user-1', async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            executionOrder.push(1);
            return 'res-1';
        });

        const t2 = queue.run('user-1', async () => {
            await new Promise((resolve) => setTimeout(resolve, 5));
            executionOrder.push(2);
            return 'res-2';
        });

        const t3 = queue.run('user-1', async () => {
            executionOrder.push(3);
            return 'res-3';
        });

        const results = await Promise.all([t1, t2, t3]);
        expect(results).toEqual(['res-1', 'res-2', 'res-3']);
        expect(executionOrder).toEqual([1, 2, 3]);
    });

    it('executes tasks for different keys concurrently', async () => {
        const queue = new KeyedSerialQueue();
        const startTimes = new Map<string, number>();
        const finishTimes = new Map<string, number>();

        const pA = queue.run('key-A', async () => {
            startTimes.set('A', Date.now());
            await new Promise((resolve) => setTimeout(resolve, 40));
            finishTimes.set('A', Date.now());
        });

        const pB = queue.run('key-B', async () => {
            startTimes.set('B', Date.now());
            await new Promise((resolve) => setTimeout(resolve, 10));
            finishTimes.set('B', Date.now());
        });

        await Promise.all([pA, pB]);

        // Key B should finish before key A finishes even though both started around the same time
        expect(finishTimes.get('B')!).toBeLessThan(finishTimes.get('A')!);
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

        queue.run('k1', async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
            count++;
        });
        queue.run('k2', async () => {
            await new Promise((resolve) => setTimeout(resolve, 30));
            count++;
        });
        queue.run('k1', async () => {
            await new Promise((resolve) => setTimeout(resolve, 10));
            count++;
        });

        expect(queue.size).toBe(2);
        await queue.drain();
        expect(count).toBe(3);
        expect(queue.size).toBe(0);
    });

    it('tracks active queue size dynamically and removes settled keys', async () => {
        const queue = new KeyedSerialQueue();
        expect(queue.size).toBe(0);

        const p1 = queue.run('key-1', async () => {
            await new Promise((resolve) => setTimeout(resolve, 15));
        });
        const p2 = queue.run('key-2', async () => {
            await new Promise((resolve) => setTimeout(resolve, 15));
        });

        expect(queue.size).toBe(2);
        await Promise.all([p1, p2]);
        expect(queue.size).toBe(0);
    });
});
