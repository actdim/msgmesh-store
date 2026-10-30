import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom } from 'rxjs';
import { take, filter } from 'rxjs/operators';
import { createMsgBus } from '@actdim/msgmesh/core';
import {
    createLiveStruct,
    type LiveStoreInstance,
    type LiveCollection,
} from '@actdim/livestruct';
import {
    attachStoreBridge,
    EchoTracker,
    type StoreCdcEvent,
    type StoreBridgeController,
} from '../src/index';

describe('Store Bridge & Echo Suppression Integration', () => {
    let store: LiveStoreInstance;
    let bus: ReturnType<typeof createMsgBus>;
    let controller: StoreBridgeController | null = null;

    beforeEach(async () => {
        bus = createMsgBus();
        store = await createLiveStruct({
            name: `test-bridge-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            forceMemory: true,
        });
    });

    afterEach(async () => {
        if (controller && !controller.isDisposed) {
            controller.dispose();
            controller = null;
        }
        await store.close();
    });

    it('REQ-1: translates bus commands into store document mutations (CREATE, PATCH, PATCH_PATH, DELETE)', async () => {
        controller = attachStoreBridge(bus, store, {
            channelPrefix: 'STORE',
        });
        expect(controller.isConnected).toBe(true);
        expect(controller.isDisposed).toBe(false);

        const col: LiveCollection<{ name: string; role?: string; score?: number; settings?: { theme: string } }> =
            await store.collection('users');

        // 1. CREATE command
        const createCdcPromise = firstValueFrom(
            controller.cdc$.pipe(filter((e) => e.id === 'u-100' && e.type === 'insert'))
        );

        await bus.send({
            channel: 'STORE.COMMAND',
            group: 'in',
            topic: 'users',
            payload: {
                type: 'CREATE',
                id: 'u-100',
                delta: { name: 'Alice', role: 'member' },
            },
        });

        await createCdcPromise;
        const createdDoc = await col.get('u-100');
        expect(createdDoc).not.toBeNull();
        expect(createdDoc?.data).toEqual({ name: 'Alice', role: 'member' });

        // 2. PATCH command
        const patchCdcPromise = firstValueFrom(
            controller.cdc$.pipe(filter((e) => e.id === 'u-100' && e.type === 'update'))
        );

        await bus.send({
            channel: 'STORE.COMMAND',
            group: 'in',
            topic: 'users',
            payload: {
                type: 'PATCH',
                id: 'u-100',
                delta: { role: 'admin', score: 100 },
            },
        });

        await patchCdcPromise;
        const patchedDoc = await col.get('u-100');
        expect(patchedDoc?.data).toEqual({ name: 'Alice', role: 'admin', score: 100 });

        // 3. PATCH_PATH command
        const pathCdcPromise = firstValueFrom(
            controller.cdc$.pipe(filter((e) => e.id === 'u-100' && e.type === 'update'))
        );

        await bus.send({
            channel: 'STORE.COMMAND',
            group: 'in',
            topic: 'users',
            payload: {
                type: 'PATCH_PATH',
                id: 'u-100',
                path: 'settings.theme',
                value: 'dark',
            },
        });

        await pathCdcPromise;
        const pathDoc = await col.get('u-100');
        expect(pathDoc?.data).toEqual({
            name: 'Alice',
            role: 'admin',
            score: 100,
            settings: { theme: 'dark' },
        });

        // 4. DELETE command
        const deleteCdcPromise = firstValueFrom(
            controller.cdc$.pipe(filter((e) => e.id === 'u-100' && e.type === 'delete'))
        );

        await bus.send({
            channel: 'STORE.COMMAND',
            group: 'in',
            topic: 'users',
            payload: {
                type: 'DELETE',
                id: 'u-100',
            },
        });

        await deleteCdcPromise;
        const deletedDoc = await col.get('u-100');
        expect(deletedDoc).toBeNull();
    });

    it('REQ-2: attaches origin markers (local, remote, bus) correctly to events', async () => {
        controller = attachStoreBridge(bus, store, {
            channelPrefix: 'STORE',
            defaultOrigin: 'local',
        });

        const col = await store.collection<{ title: string; count: number }>('posts');

        // Case A: Local store mutation emits with origin: 'local'
        const localEventPromise = firstValueFrom(
            controller.cdc$.pipe(filter((e) => e.id === 'p-1'))
        );

        await col.create('p-1', { title: 'Local Article', count: 1 });

        const localEvent = await localEventPromise;
        expect(localEvent.origin).toBe('local');
        expect(localEvent.collection).toBe('posts');
        expect(localEvent.id).toBe('p-1');

        // Case B: Bus-driven command emits with origin: 'bus'
        const busEventPromise = firstValueFrom(
            controller.cdc$.pipe(filter((e) => e.id === 'p-2'))
        );

        await bus.send({
            channel: 'STORE.COMMAND',
            group: 'in',
            topic: 'posts',
            payload: {
                type: 'CREATE',
                id: 'p-2',
                delta: { title: 'Bus Article', count: 2 },
                origin: 'bus',
            },
        });

        const busEvent = await busEventPromise;
        expect(busEvent.origin).toBe('bus');
        expect(busEvent.collection).toBe('posts');
        expect(busEvent.id).toBe('p-2');

        // Case C: Remote-tagged command emits with origin: 'remote'
        const remoteEventPromise = firstValueFrom(
            controller.cdc$.pipe(filter((e) => e.id === 'p-3'))
        );

        await bus.send({
            channel: 'STORE.COMMAND',
            group: 'in',
            topic: 'posts',
            payload: {
                type: 'CREATE',
                id: 'p-3',
                delta: { title: 'Remote Article', count: 3 },
                origin: 'remote',
            },
        });

        const remoteEvent = await remoteEventPromise;
        expect(remoteEvent.origin).toBe('remote');
        expect(remoteEvent.collection).toBe('posts');
        expect(remoteEvent.id).toBe('p-3');
    });

    it('REQ-3: suppresses feedback loops when bus commands trigger store commits', async () => {
        controller = attachStoreBridge(bus, store, {
            channelPrefix: 'STORE',
        });

        const busPublishedEvents: StoreCdcEvent[] = [];

        // Subscribe to bus CDC broadcasts
        bus.on({
            channel: 'STORE.ENTITY_CHANGED',
            group: 'out',
            topic: '/.*/',
            callback: (msg) => {
                busPublishedEvents.push(msg.payload as StoreCdcEvent);
            },
        });

        const col = await store.collection<{ value: number }>('counters');

        // 1. Direct local mutation MUST publish to bus
        const doc = await col.create('c-1', { value: 10 });
        await new Promise((r) => setTimeout(r, 25));

        expect(busPublishedEvents).toHaveLength(1);
        expect(busPublishedEvents[0].id).toBe('c-1');
        expect(busPublishedEvents[0].origin).toBe('local');

        // 2. Bus-driven command MUST NOT re-publish back to bus (echo suppressed)
        const busCdcReceived = firstValueFrom(
            controller.cdc$.pipe(filter((e) => e.id === 'c-2'))
        );

        await bus.send({
            channel: 'STORE.COMMAND',
            group: 'in',
            topic: 'counters',
            payload: {
                type: 'CREATE',
                id: 'c-2',
                delta: { value: 20 },
                origin: 'bus',
            },
        });

        await busCdcReceived;
        await new Promise((r) => setTimeout(r, 35));

        // Total bus-broadcasted events must remain 1: the bus command did not trigger a bus echo!
        expect(busPublishedEvents).toHaveLength(1);

        // Document in store is indeed updated
        const docC2 = await col.get('c-2');
        expect(docC2).not.toBeNull();
        expect(docC2?.data.value).toBe(20);
    });

    it('REQ-3: EchoTracker sliding window drops duplicate / reflected commands', async () => {
        const tracker = new EchoTracker(200);

        expect(tracker.size).toBe(0);
        expect(tracker.isEcho('mut-100')).toBe(false);

        tracker.record('mut-100', 'bus');
        expect(tracker.has('mut-100')).toBe(true);
        expect(tracker.isEcho('mut-100')).toBe(true);
        expect(tracker.isEcho('mut-100', 'bus')).toBe(true);
        expect(tracker.isEcho('mut-100', 'local')).toBe(false);
        expect(tracker.getOrigin('mut-100')).toBe('bus');
        expect(tracker.size).toBe(1);

        // Sliding window expiration
        await new Promise((r) => setTimeout(r, 250));
        expect(tracker.isEcho('mut-100')).toBe(false);
        expect(tracker.has('mut-100')).toBe(false);
        expect(tracker.size).toBe(0);

        tracker.dispose();
    });

    it('drops echoed commands with identical mutationId within suppression window', async () => {
        controller = attachStoreBridge(bus, store, {
            channelPrefix: 'STORE',
            echoSuppressionMs: 500,
        });

        const col = await store.collection<{ count: number }>('metrics');

        const firstCommitPromise = firstValueFrom(
            controller.cdc$.pipe(filter((e) => e.id === 'm-1'))
        );

        // Send first command
        await bus.send({
            channel: 'STORE.COMMAND',
            group: 'in',
            topic: 'metrics',
            payload: {
                type: 'CREATE',
                id: 'm-1',
                delta: { count: 1 },
                mutationId: 'mut-fixed-id-001',
            },
        });

        await firstCommitPromise;
        const initialDoc = await col.get('m-1');
        expect(initialDoc?.data.count).toBe(1);

        // Track how many CDC events fire
        let cdcCount = 0;
        const sub = controller.cdc$
            .pipe(filter((e) => e.id === 'm-1'))
            .subscribe(() => {
                cdcCount++;
            });

        // Send duplicate command with same mutationId
        await bus.send({
            channel: 'STORE.COMMAND',
            group: 'in',
            topic: 'metrics',
            payload: {
                type: 'PATCH',
                id: 'm-1',
                delta: { count: 999 },
                mutationId: 'mut-fixed-id-001',
            },
        });

        await new Promise((r) => setTimeout(r, 40));

        // Duplicate command was dropped by echoTracker, document value not updated to 999
        const unchangedDoc = await col.get('m-1');
        expect(unchangedDoc?.data.count).toBe(1);
        expect(cdcCount).toBe(0);

        sub.unsubscribe();
    });

    it('handles collection-bound channels: STORE.{collection}.COMMAND', async () => {
        controller = attachStoreBridge(bus, store, {
            channelPrefix: 'STORE',
            collection: 'orders',
        });

        const col = await store.collection<{ status: string; total: number }>('orders');

        const cdcPromise = firstValueFrom(
            controller.cdc$.pipe(filter((e) => e.id === 'ord-555'))
        );

        await bus.send({
            channel: 'STORE.orders.COMMAND',
            group: 'in',
            topic: 'CREATE',
            payload: {
                id: 'ord-555',
                delta: { status: 'pending', total: 50 },
            },
        });

        await cdcPromise;
        const orderDoc = await col.get('ord-555');
        expect(orderDoc?.data).toEqual({ status: 'pending', total: 50 });
    });

    it('disconnect cleans up listeners without memory leaks and halts command processing', async () => {
        controller = attachStoreBridge(bus, store, {
            channelPrefix: 'STORE',
        });

        expect(controller.isConnected).toBe(true);
        expect(controller.isDisposed).toBe(false);

        const col = await store.collection<{ text: string }>('notes');

        controller.disconnect();
        expect(controller.isConnected).toBe(false);
        expect(controller.isDisposed).toBe(true);

        // Sending command after disconnect should NOT mutate store
        await bus.send({
            channel: 'STORE.COMMAND',
            group: 'in',
            topic: 'notes',
            payload: {
                type: 'CREATE',
                id: 'n-1',
                delta: { text: 'Ignored after disconnect' },
            },
        });

        await new Promise((r) => setTimeout(r, 30));
        const doc = await col.get('n-1');
        expect(doc).toBeNull();
    });

    it('throws meaningful error if accessing cdc$ when store is null', () => {
        const dummyController = attachStoreBridge(bus, null, { channelPrefix: 'CUSTOM' });
        expect(dummyController.isConnected).toBe(true);
        expect(() => dummyController.cdc$).toThrow(
            "CDC stream for prefix 'CUSTOM' requires an active store engine."
        );
        dummyController.disconnect();
        expect(dummyController.isConnected).toBe(false);
    });

    it('attaches directly to low-level LiveSqliteEngine and translates commands', async () => {
        const engineController = attachStoreBridge(bus, store.engine, {
            channelPrefix: 'ENGINE_STORE',
            collection: 'devices',
        });

        const cdcPromise = firstValueFrom(
            engineController.cdc$.pipe(filter((e) => e.id === 'dev-1'))
        );

        await bus.send({
            channel: 'ENGINE_STORE.COMMAND',
            group: 'in',
            topic: 'devices',
            payload: {
                type: 'CREATE',
                id: 'dev-1',
                delta: { ip: '192.168.1.1', status: 'online' },
            },
        });

        const event = await cdcPromise;
        expect(event.collection).toBe('devices');
        expect(event.id).toBe('dev-1');
        expect(event.origin).toBe('bus');

        const record = await store.engine.getDoc('devices', 'dev-1');
        expect(record?.data).toEqual({ ip: '192.168.1.1', status: 'online' });

        engineController.dispose();
    });

    it('attaches directly to LiveCollection instance and translates commands', async () => {
        const tasksCol = await store.collection<{ title: string; done: boolean }>('tasks');
        const colController = attachStoreBridge(bus, tasksCol, {
            channelPrefix: 'COL_STORE',
            collection: 'tasks',
        });

        const cdcPromise = firstValueFrom(
            colController.cdc$.pipe(filter((e) => e.id === 'task-1'))
        );

        await bus.send({
            channel: 'COL_STORE.COMMAND',
            group: 'in',
            topic: 'tasks',
            payload: {
                type: 'CREATE',
                id: 'task-1',
                delta: { title: 'Implement Bridge', done: true },
            },
        });

        const event = await cdcPromise;
        expect(event.id).toBe('task-1');
        expect(event.origin).toBe('bus');

        const taskDoc = await tasksCol.get('task-1');
        expect(taskDoc?.data).toEqual({ title: 'Implement Bridge', done: true });

        colController.dispose();
    });

    it('verifies bidirectional multi-store bridge without infinite recursions', async () => {
        // Store 1 and Bridge 1
        const store1 = store; // already created
        const controller1 = attachStoreBridge(bus, store1, {
            channelPrefix: 'SYNC',
        });

        // Store 2 and Bridge 2 connected to the same bus
        const store2 = await createLiveStruct({
            name: `test-store2-${Date.now()}`,
            forceMemory: true,
        });
        const controller2 = attachStoreBridge(bus, store2, {
            channelPrefix: 'SYNC',
        });

        // Bridge 1 local mutation:
        const col1 = await store1.collection<{ msg: string }>('chat');
        const col2 = await store2.collection<{ msg: string }>('chat');

        let store2CdcCount = 0;
        const sub2 = controller2.cdc$.subscribe(() => {
            store2CdcCount++;
        });

        // When store1 mutates locally, bus receives entity changed event
        const busEventPromise = new Promise<StoreCdcEvent>((resolve) => {
            bus.on({
                channel: 'SYNC.ENTITY_CHANGED',
                group: 'out',
                topic: 'chat',
                callback: (m) => resolve(m.payload as StoreCdcEvent),
            });
        });

        await col1.create('msg-1', { msg: 'Hello from store 1' });

        const busEvent = await busEventPromise;
        expect(busEvent.id).toBe('msg-1');
        expect(busEvent.origin).toBe('local');

        // Forward the CDC event to Store 2 as a command (simulating sync pipeline)
        await bus.send({
            channel: 'SYNC.COMMAND',
            group: 'in',
            topic: 'chat',
            payload: {
                type: 'CREATE',
                id: busEvent.id,
                delta: busEvent.delta,
                origin: 'bus',
                mutationId: busEvent.mutationId ?? 'sync-msg-1',
            },
        });

        await new Promise((r) => setTimeout(r, 40));

        // Store 2 document was updated
        const doc2 = await col2.get('msg-1');
        expect(doc2?.data).toEqual({ msg: 'Hello from store 1' });

        // Store 2 processed the command with origin: 'bus', which was suppressed from re-broadcasting to bus
        expect(store2CdcCount).toBe(1);

        sub2.unsubscribe();
        controller1.dispose();
        controller2.dispose();
        await store2.close();
    });
});
