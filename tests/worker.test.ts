import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
    WorkerDeadError,
    WorkerHostStorageError,
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
        if (!process.env.CI) {
            expect(syncDispatchDuration).toBeLessThan(16.6);
        }

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

    it('REQ-1 & REQ-2: fatal error transitions client to dead, rejecting subsequent calls immediately with WorkerDeadError and zero timers fired', async () => {
        const { port1, port2 } = createMessageChannelPair();
        host = attachWorkerStoreHost(store, port1);
        client = createWorkerStoreClient(port2);

        await client.ready();
        expect(client.state).toBe('ready');

        // Fatal crash event on worker port
        (port2 as any).triggerError(new Error('Unrecoverable worker crash'));

        // Let microtasks run
        await new Promise<void>((r) => queueMicrotask(r));

        expect(client.state).toBe('dead');
        expect(client.isReady).toBe(false);

        // Verify with fake timers: zero timers fired or scheduled
        vi.useFakeTimers();
        try {
            const patchPromise = client.patch('users', 'u-fail', { name: 'Bob' });
            await expect(patchPromise).rejects.toThrow(WorkerDeadError);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    it('REQ-4: host dispose rejects pending requests with CLOSE reason and sets dead state; peer close() marks client dead', async () => {
        // Part A: host.dispose() while request pending
        const pair1 = createMessageChannelPair();
        host = attachWorkerStoreHost(store, pair1.port1);
        client = createWorkerStoreClient(pair1.port2, { requestTimeoutMs: 5000 });

        await client.ready();

        // Send a request
        const queryPromise = client.query('SELECT * FROM docs');

        // Host is disposed
        host.dispose();

        // Pending query rejects with WorkerDeadError containing "Host disposed"
        await expect(queryPromise).rejects.toThrow(/Host disposed/);
        expect(client.state).toBe('dead');

        // Part B: port1.close() marks client dead
        const pair2 = createMessageChannelPair();
        const client2 = createWorkerStoreClient(pair2.port2);
        const host2 = attachWorkerStoreHost(store, pair2.port1);

        await client2.ready();
        expect(client2.state).toBe('ready');

        pair2.port1.close();
        await new Promise<void>((r) => queueMicrotask(r));

        expect(client2.state).toBe('dead');
        client2.dispose();
        host2.dispose();
    });

    it('REQ-3: messageerror is non-fatal and leaves other pending requests resolvable', async () => {
        const { port1, port2 } = createMessageChannelPair();
        host = attachWorkerStoreHost(store, port1);
        client = createWorkerStoreClient(port2);

        await client.ready();

        const errors: unknown[] = [];
        const sub = client.errors$.subscribe((err) => errors.push(err));

        // Start a valid query
        const queryPromise = client.query('SELECT * FROM docs WHERE collection = ?', ['users']);

        // Dispatch a non-fatal messageerror
        (port2 as any)._dispatch('messageerror', new Error('Simulated deserialization error'));

        // Client must stay ready
        expect(client.state).toBe('ready');
        expect(errors).toHaveLength(1);

        // Pending query must still resolve successfully
        const rows = await queryPromise;
        expect(Array.isArray(rows)).toBe(true);

        sub.unsubscribe();
    });

    it('REQ-5: deferred factory is called once under 5 concurrent requests; failing factory retried once then permanent ERROR', async () => {
        // Part A: 5 concurrent requests memoize pending factory
        const pair1 = createMessageChannelPair();
        let factoryCalls = 0;

        host = attachWorkerStoreHost(async () => {
            factoryCalls++;
            await new Promise<void>((r) => queueMicrotask(r));
            return store;
        }, pair1.port1);

        client = createWorkerStoreClient(pair1.port2);

        // 5 concurrent requests before ready
        const results = await Promise.all([
            client.ready(),
            client.query('SELECT 1'),
            client.query('SELECT 2'),
            client.query('SELECT 3'),
            client.query('SELECT 4'),
        ]);

        expect(factoryCalls).toBe(1);
        expect(results).toHaveLength(5);
        expect(client.state).toBe('ready');

        // Part B: Failing factory retries once then permanent ERROR
        const pair2 = createMessageChannelPair();
        let failCalls = 0;

        const host2 = attachWorkerStoreHost(async () => {
            failCalls++;
            throw new Error(`Factory init failed #${failCalls}`);
        }, pair2.port1, { factoryRetries: 1 });

        const client2 = createWorkerStoreClient(pair2.port2, { autoInit: false });

        // Attempt 1: calls factory (call 1)
        await expect(client2.ready()).rejects.toThrow('Factory init failed #1');
        expect(failCalls).toBe(1);

        // Attempt 2: retries factory (call 2)
        await expect(client2.ready()).rejects.toThrow('Factory init failed #2');
        expect(failCalls).toBe(2);

        // Attempt 3: exceeds retries, permanent ERROR without calling factory again
        await expect(client2.ready()).rejects.toThrow(/Factory init failed #2|failed permanently/);
        expect(failCalls).toBe(2);

        client2.dispose();
        host2.dispose();
    });

    it('REQ-3 & REQ-6: command with a function in payload rejects with DataCloneError and client stays ready', async () => {
        const { port1, port2 } = createMessageChannelPair();
        host = attachWorkerStoreHost(store, port1);
        client = createWorkerStoreClient(port2);

        await client.ready();
        expect(client.state).toBe('ready');

        // Function in payload cannot be cloned by structuredClone
        const badPayload = { invalidFn: () => 'cannot clone' };

        await expect(
            client.patch('users', 'u-bad', badPayload as any)
        ).rejects.toThrow(/could not be cloned|DataCloneError/);

        // Client must remain ready and functional
        expect(client.state).toBe('ready');

        // Subsequent valid command succeeds
        await client.create('users', 'u-valid', { name: 'Bob', age: 30 });
        const usersCol = await store.collection('users');
        const doc = await usersCol.get('u-valid');
        expect(doc?.data).toEqual({ name: 'Bob', age: 30 });
    });

    it('REQ-7: 20 concurrent PATCH to a new id run in order with all fields present', async () => {
        const { port1, port2 } = createMessageChannelPair();
        host = attachWorkerStoreHost(store, port1);
        client = createWorkerStoreClient(port2);

        await client.ready();

        const patchCount = 20;
        const promises: Promise<void>[] = [];

        for (let i = 0; i < patchCount; i++) {
            promises.push(
                client.patch('items', 'item-seq-1', {
                    [`field_${i}`]: i,
                })
            );
        }

        await Promise.all(promises);

        const itemsCol = await store.collection('items');
        const finalDoc = await itemsCol.get('item-seq-1');
        expect(finalDoc).not.toBeNull();

        for (let i = 0; i < patchCount; i++) {
            expect(finalDoc?.data[`field_${i}`]).toBe(i);
        }
    });

    it('Acceptance Criteria: hosting a persisted livestruct store inside a worker fails fast with WorkerHostStorageError', async () => {
        const { port1, port2 } = createMessageChannelPair();

        // 1. Direct attach with persisted (forceMemory: false) store throws synchronously
        const persistedStore = await createLiveStruct({
            name: `test-persisted-${Date.now()}`,
            forceMemory: false,
        });

        try {
            expect(() => {
                attachWorkerStoreHost(persistedStore, port1);
            }).toThrow(WorkerHostStorageError);

            // 2. Lazy factory returning persisted store throws on init handshake
            const hostLazy = attachWorkerStoreHost(async () => persistedStore, port1);
            const clientLazy = createWorkerStoreClient(port2);

            await expect(clientLazy.ready()).rejects.toThrow(
                /LiveStruct store hosted in worker must use forceMemory or in-memory storage/
            );

            clientLazy.dispose();
            hostLazy.dispose();
        } finally {
            await persistedStore.close();
        }
    });

    it('REQ-2: reconnect resets dead state to idle and re-establishes worker connection', async () => {
        const pair1 = createMessageChannelPair();
        host = attachWorkerStoreHost(store, pair1.port1);
        client = createWorkerStoreClient(pair1.port2);

        await client.ready();
        expect(client.state).toBe('ready');

        // Crash current worker port
        (pair1.port2 as any).triggerError(new Error('Worker dead'));
        await new Promise<void>((r) => queueMicrotask(r));
        expect(client.state).toBe('dead');

        // Reconnect with new port pair
        const pair2 = createMessageChannelPair();
        const host2 = attachWorkerStoreHost(store, pair2.port1);

        await client.reconnect(pair2.port2);
        expect(client.state).toBe('ready');

        await client.create('users', 'u-reconnect', { ok: true });
        const usersCol = await store.collection('users');
        const doc = await usersCol.get('u-reconnect');
        expect(doc?.data).toEqual({ ok: true });

        host2.dispose();
    });

    it('REQ-3: groups multiple concurrent mutations into a single BATCH postMessage using batch: microtask', async () => {
        const { port1, port2 } = createMessageChannelPair();
        host = attachWorkerStoreHost(store, port1);
        client = createWorkerStoreClient(port2, { batch: 'microtask' });

        await client.ready();

        let postMessageCount = 0;
        const origPostMessage = port2.postMessage.bind(port2);
        port2.postMessage = (msg: unknown) => {
            postMessageCount++;
            origPostMessage(msg);
        };

        const promises = [
            client.create('todos', 't-1', { title: 'First' }),
            client.create('todos', 't-2', { title: 'Second' }),
            client.create('todos', 't-3', { title: 'Third' }),
        ];

        await Promise.all(promises);

        // Exactly 1 postMessage dispatch for all 3 mutations due to microtask batching
        expect(postMessageCount).toBe(1);

        const col = await store.collection('todos');
        const doc1 = await col.get('t-1');
        const doc2 = await col.get('t-2');
        const doc3 = await col.get('t-3');
        expect(doc1?.data.title).toBe('First');
        expect(doc2?.data.title).toBe('Second');
        expect(doc3?.data.title).toBe('Third');
    });

    it('REQ-3: handles mixed success and failure inside batch independently', async () => {
        const { port1, port2 } = createMessageChannelPair();
        host = attachWorkerStoreHost(store, port1);
        client = createWorkerStoreClient(port2, { batch: 'microtask' });

        await client.ready();

        const successPromise = client.create('items', 'it-ok', { status: 'good' });
        const failPromise = client.query('INVALID SQL THAT FAILS');

        await expect(failPromise).rejects.toThrow();
        await expect(successPromise).resolves.not.toThrow();

        const col = await store.collection('items');
        const doc = await col.get('it-ok');
        expect(doc?.data.status).toBe('good');
    });

    it('REQ-3: suppresses CDC streaming when no subscribers exist and sends CDC_SUBSCRIBE/CDC_UNSUBSCRIBE on refcount transitions', async () => {
        const { port1, port2 } = createMessageChannelPair();
        host = attachWorkerStoreHost(store, port1);
        client = createWorkerStoreClient(port2);

        await client.ready();

        let cdcDeliveredCount = 0;
        let cdcSubscribeSent = 0;
        let cdcUnsubscribeSent = 0;

        const origPostMessage = port2.postMessage.bind(port2);
        port2.postMessage = (msg: unknown) => {
            const req = msg as { type?: string };
            if (req?.type === 'CDC_SUBSCRIBE') {
                cdcSubscribeSent++;
            }
            if (req?.type === 'CDC_UNSUBSCRIBE') {
                cdcUnsubscribeSent++;
            }
            origPostMessage(msg);
        };

        // Mutation before subscription -> CDC suppressed on host
        await client.create('users', 'u-nosub', { name: 'Silent' });
        await new Promise<void>((r) => queueMicrotask(r));
        expect(cdcSubscribeSent).toBe(0);

        // First subscriber subscribes -> refcount 0 -> 1 -> sends CDC_SUBSCRIBE
        const sub1 = client.cdc$.subscribe(() => {
            cdcDeliveredCount++;
        });
        expect(cdcSubscribeSent).toBe(1);

        // Second subscriber subscribes -> refcount 1 -> 2 -> no new CDC_SUBSCRIBE sent
        const sub2 = client.cdc$.subscribe(() => {});
        expect(cdcSubscribeSent).toBe(1);

        // Mutation while subscribed -> delivered via CDC_BATCH or CDC
        const eventPromise = firstValueFrom(client.cdc$.pipe(filter((e) => e.id === 'u-subbed')));
        await client.create('users', 'u-subbed', { name: 'Active' });
        await eventPromise;
        expect(cdcDeliveredCount).toBeGreaterThan(0);

        // First unsubscription -> refcount 2 -> 1 -> no CDC_UNSUBSCRIBE sent
        sub1.unsubscribe();
        expect(cdcUnsubscribeSent).toBe(0);

        // Second unsubscription -> refcount 1 -> 0 -> sends CDC_UNSUBSCRIBE
        sub2.unsubscribe();
        expect(cdcUnsubscribeSent).toBe(1);
    });

    it('REQ-4: disposing client while request pending rejects with WorkerDeadError and clears request timeout', async () => {
        const { port1, port2 } = createMessageChannelPair();
        host = attachWorkerStoreHost(store, port1);
        client = createWorkerStoreClient(port2);

        await client.ready();

        const clearTimeoutSpy = vi.spyOn(globalThis, 'clearTimeout');
        const pendingQuery = client.query('SELECT * FROM docs');
        // Flush microtask tick so query advances past triggerInit and registers pending request with timer
        await Promise.resolve();

        client.dispose();

        await expect(pendingQuery).rejects.toThrow(WorkerDeadError);
        expect(clearTimeoutSpy).toHaveBeenCalled();
        expect(client.state).toBe('disposed');
        clearTimeoutSpy.mockRestore();
    });
});
