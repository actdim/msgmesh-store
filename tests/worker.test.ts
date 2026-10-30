import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { filter, take, toArray } from 'rxjs/operators';
import {
    createLiveStruct,
    type LiveStoreInstance,
    type LiveCollection,
} from '@actdim/livestruct';
import {
    createMessageChannelPair,
    createWorkerStoreClient,
    attachWorkerStoreHost,
    type WorkerStoreClient,
    type WorkerHostController,
    type StoreCdcEvent,
} from '../src/index';

describe('Web Worker Boundary Transport for Storage', () => {
    let store: LiveStoreInstance;
    let client: WorkerStoreClient | null = null;
    let host: WorkerHostController | null = null;

    beforeEach(async () => {
        store = await createLiveStruct({
            name: `test-worker-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            forceMemory: true,
        });
    });

    afterEach(async () => {
        if (client && !client.isDisposed) {
            client.dispose();
            client = null;
        }
        if (host && !host.isDisposed) {
            host.dispose();
            host = null;
        }
        await store.close();
    });

    it('REQ-3: initializes handshake between client and worker host adapter', async () => {
        const { port1, port2 } = createMessageChannelPair();

        host = attachWorkerStoreHost(store, port1);
        client = createWorkerStoreClient(port2);

        expect(client.isReady).toBe(false);
        await client.ready();
        expect(client.isReady).toBe(true);
        expect(host.isDisposed).toBe(false);
    });

    it('REQ-3: supports lazy store factory resolution on init handshake', async () => {
        const { port1, port2 } = createMessageChannelPair();
        let factoryCalled = false;

        host = attachWorkerStoreHost(async () => {
            factoryCalled = true;
            return store;
        }, port1);

        client = createWorkerStoreClient(port2);
        expect(factoryCalled).toBe(false);

        await client.ready();
        expect(factoryCalled).toBe(true);
        expect(client.isReady).toBe(true);
    });

    it('REQ-1 & REQ-2: serializes CREATE, PATCH, PATCH_PATH, DELETE and streams typed CDC deltas back', async () => {
        const { port1, port2 } = createMessageChannelPair();
        host = attachWorkerStoreHost(store, port1);
        client = createWorkerStoreClient(port2);

        await client.ready();
        const usersCol: LiveCollection<{ name: string; score?: number; role?: string; profile?: { bio: string } }> =
            await store.collection('users');

        // 1. CREATE mutation across worker boundary
        const createCdcPromise = firstValueFrom(
            client.cdc$.pipe(filter((e) => e.collection === 'users' && e.id === 'usr-1' && e.type === 'insert'))
        );

        await client.create('users', 'usr-1', { name: 'Alice', role: 'member', score: 10 });
        const cdcInsert = await createCdcPromise;

        expect(cdcInsert.type).toBe('insert');
        expect(cdcInsert.id).toBe('usr-1');
        expect(cdcInsert.delta).toEqual({ name: 'Alice', role: 'member', score: 10 });

        const docInStore = await usersCol.get('usr-1');
        expect(docInStore).not.toBeNull();
        expect(docInStore?.data).toEqual({ name: 'Alice', role: 'member', score: 10 });

        // 2. PATCH mutation across worker boundary
        const patchCdcPromise = firstValueFrom(
            client.cdc$.pipe(filter((e) => e.collection === 'users' && e.id === 'usr-1' && e.type === 'update'))
        );

        await client.patch('users', 'usr-1', { score: 25, role: 'moderator' });
        const cdcPatch = await patchCdcPromise;

        expect(cdcPatch.type).toBe('update');
        expect(cdcPatch.id).toBe('usr-1');
        expect(cdcPatch.delta.score).toBe(25);
        expect(cdcPatch.delta.role).toBe('moderator');

        const updatedDoc = await usersCol.get('usr-1');
        expect(updatedDoc?.data.score).toBe(25);
        expect(updatedDoc?.data.role).toBe('moderator');
        expect(updatedDoc?.data.name).toBe('Alice');

        // 3. PATCH_PATH mutation across worker boundary
        const pathCdcPromise = firstValueFrom(
            client.cdc$.pipe(filter((e) => e.collection === 'users' && e.id === 'usr-1' && e.type === 'update'))
        );

        await client.patchPath('users', 'usr-1', 'profile.bio', 'Hello from Web Worker');
        await pathCdcPromise;

        const pathDoc = await usersCol.get('usr-1');
        expect(pathDoc?.data.profile).toEqual({ bio: 'Hello from Web Worker' });

        // 4. DELETE mutation across worker boundary
        const deleteCdcPromise = firstValueFrom(
            client.cdc$.pipe(filter((e) => e.collection === 'users' && e.id === 'usr-1' && e.type === 'delete'))
        );

        await client.delete('users', 'usr-1');
        const cdcDelete = await deleteCdcPromise;

        expect(cdcDelete.type).toBe('delete');
        expect(cdcDelete.id).toBe('usr-1');

        const deletedDoc = await usersCol.get('usr-1');
        expect(deletedDoc).toBeNull();
    });

    it('REQ-1: executes raw SQL queries over worker boundary with parameter binding', async () => {
        const { port1, port2 } = createMessageChannelPair();
        host = attachWorkerStoreHost(store, port1);
        client = createWorkerStoreClient(port2);

        await client.ready();
        await client.create('products', 'p-1', { title: 'Laptop', price: 999 });
        await client.create('products', 'p-2', { title: 'Mouse', price: 29 });
        await client.create('products', 'p-3', { title: 'Keyboard', price: 79 });

        const rows = await client.query<{ id: string; collection: string; data: string }>(
            'SELECT * FROM products WHERE id = ?',
            ['p-2']
        );

        expect(rows).toHaveLength(1);
        expect(rows[0].id).toBe('p-2');
        expect(JSON.parse(rows[0].data)).toEqual({ title: 'Mouse', price: 29 });
    });

    it('REQ-3: handles command error boundaries gracefully when worker rejects', async () => {
        const { port1, port2 } = createMessageChannelPair();

        // Host attached to an invalid target that throws on mutations
        host = attachWorkerStoreHost({
            collection: () => {
                throw new Error('Database locked or disk full simulation');
            },
        }, port1);

        client = createWorkerStoreClient(port2);
        await client.ready();

        await expect(
            client.patch('users', 'u-err', { name: 'Bob' })
        ).rejects.toThrow('Database locked or disk full simulation');
    });

    it('REQ-3: handles query errors when invalid SQL is supplied', async () => {
        const { port1, port2 } = createMessageChannelPair();
        host = attachWorkerStoreHost(store, port1);
        client = createWorkerStoreClient(port2);

        await client.ready();

        await expect(
            client.query('INVALID SQL STATEMENT HERE')
        ).rejects.toThrow('Unsupported raw SQL query');
    });

    it('REQ-3: handles request timeouts when worker fails to respond in time', async () => {
        const { port1, port2 } = createMessageChannelPair();

        // Silent port - never responds to commands
        client = createWorkerStoreClient(port2, {
            autoInit: false,
            initTimeoutMs: 150,
            requestTimeoutMs: 150,
        });

        await expect(client.ready()).rejects.toThrow(/Worker request timed out after 150ms: \[INIT\]/);
    });

    it('REQ-3: rejects pending requests when fatal worker error event occurs', async () => {
        const { port1, port2 } = createMessageChannelPair();
        host = attachWorkerStoreHost(store, port1);
        client = createWorkerStoreClient(port2, { requestTimeoutMs: 2000 });

        await client.ready();

        // Slow down next command by overriding port1 postMessage to stall
        const pendingPromise = client.patch('users', 'u-stall', { data: 'test' });

        // Trigger worker crash event on client port
        (port2 as any).triggerError(new Error('Out of memory in Web Worker thread'));

        await expect(pendingPromise).rejects.toThrow(/Worker boundary failure: Out of memory in Web Worker thread/);
    });

    it('REQ-3: disposes client and host cleanly, rejecting outstanding calls without memory leaks', async () => {
        const { port1, port2 } = createMessageChannelPair();
        host = attachWorkerStoreHost(store, port1);
        client = createWorkerStoreClient(port2, { requestTimeoutMs: 5000 });

        await client.ready();

        // Trigger a pending command
        const pending = client.query('SELECT * FROM docs WHERE collection = ?', ['users']);

        // Dispose client immediately
        client.dispose();
        expect(client.isDisposed).toBe(true);

        await expect(pending).rejects.toThrow('WorkerStoreClient has been disposed.');

        // Calling after disposal rejects immediately
        await expect(client.patch('users', 'u-1', { a: 1 })).rejects.toThrow(
            'WorkerStoreClient has been disposed.'
        );

        host.dispose();
        expect(host.isDisposed).toBe(true);
    });

    it('Acceptance Criteria: UI main thread dispatches 100+ writes at 60fps budget (<16.6ms sync time)', async () => {
        const { port1, port2 } = createMessageChannelPair();
        host = attachWorkerStoreHost(store, port1);
        client = createWorkerStoreClient(port2);

        await client.ready();
        const itemCount = 100;
        const promises: Promise<void>[] = [];

        // Measure synchronous execution time on main thread
        const startTime = performance.now();

        for (let i = 0; i < itemCount; i++) {
            promises.push(
                client.create('benchmarks', `doc-${i}`, {
                    index: i,
                    payload: `Benchmark payload data item #${i}`,
                    timestamp: Date.now(),
                })
            );
        }

        const syncDispatchDuration = performance.now() - startTime;

        // 60fps frame budget is 16.6ms. Main thread dispatch MUST be well below 16.6ms
        expect(syncDispatchDuration).toBeLessThan(16.6);

        // Wait for all mutations to be committed in background worker
        await Promise.all(promises);

        // Verify all 100 items exist in store
        const benchCol = await store.collection('benchmarks');
        const doc50 = await benchCol.get('doc-50');
        expect(doc50).not.toBeNull();
        expect(doc50?.data.index).toBe(50);

        const rows = await client.query('SELECT * FROM docs WHERE collection = ?', ['benchmarks']);
        expect(rows).toHaveLength(itemCount);
    });
});
