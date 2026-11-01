import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { firstValueFrom, Subject } from 'rxjs';
import { take, toArray } from 'rxjs/operators';
import { createMsgBus } from '@actdim/msgmesh/core';
import {
    createLiveEngine,
    createLiveStruct,
    type LiveSqliteEngine,
    type LiveStoreInstance,
} from '@actdim/livestruct';
import {
    type StoreCdcEvent,
    toStoreCdcObservable,
    filterCdc,
    filterCollection,
    filterEntity,
    publishCdcToBus,
    subscribeCdc,
    createCdcBridge,
    attachStoreBridge,
} from '../src/index';

describe('Change Data Capture (CDC) Stream Integration', () => {
    let engine: LiveSqliteEngine;
    let bus: ReturnType<typeof createMsgBus>;

    beforeEach(async () => {
        bus = createMsgBus();
        engine = await createLiveEngine({
            name: `test-cdc-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            forceMemory: true,
        });
    });

    afterEach(async () => {
        if (!engine.isClosed) {
            await engine.close();
        }
    });

    it('REQ-1 & REQ-2: engine mutation triggers typed STORE.ENTITY_CHANGED CDC event on MsgMesh bus', async () => {
        const bridge = createCdcBridge(engine, bus, { channelPrefix: 'STORE' });
        expect(bridge.isConnected).toBe(true);
        expect(bridge.isDisposed).toBe(false);

        const eventPromise = new Promise<StoreCdcEvent>((resolve) => {
            bus.on({
                channel: 'STORE.ENTITY_CHANGED',
                group: 'out',
                topic: 'users',
                callback: (msg) => {
                    resolve(msg.payload as StoreCdcEvent);
                },
            });
        });

        const now = Date.now();
        await engine.insertDoc('users', 'u-1', { name: 'Alice', age: 30 }, undefined, 'mut-001');

        const event = await eventPromise;
        expect(event.type).toBe('insert');
        expect(event.collection).toBe('users');
        expect(event.id).toBe('u-1');
        expect(event.delta).toEqual({ name: 'Alice', age: 30 });
        expect(event.origin).toBe('local');
        expect(event.mutationId).toBe('mut-001');
        expect(event.timestamp).toBeGreaterThanOrEqual(now);

        bridge.dispose();
    });

    it('verifies event payload structure for insert, update, patch, and delete operations', async () => {
        const bridge = createCdcBridge(engine, bus);
        const events: StoreCdcEvent[] = [];

        const sub = bridge.cdc$.subscribe((e) => events.push(e));

        // 1. Insert
        await engine.insertDoc('docs', 'doc-1', { title: 'First', counter: 1 }, undefined, 'mut-1');

        // 2. Patch
        await engine.patchDoc('docs', 'doc-1', { counter: 2 }, undefined, 'mut-2');

        // 3. Update
        await engine.updateDoc(
            'docs',
            'doc-1',
            { title: 'Second', counter: 3 },
            undefined,
            'mut-3'
        );

        // 4. Delete
        await engine.deleteDoc('docs', 'doc-1', 'mut-4');

        expect(events).toHaveLength(4);

        expect(events[0]).toMatchObject({
            type: 'insert',
            collection: 'docs',
            id: 'doc-1',
            delta: { title: 'First', counter: 1 },
            origin: 'local',
            mutationId: 'mut-1',
        });
        expect(typeof events[0].timestamp).toBe('number');

        expect(events[1]).toMatchObject({
            type: 'update',
            collection: 'docs',
            id: 'doc-1',
            delta: { counter: 2 },
            origin: 'local',
            mutationId: 'mut-2',
        });

        expect(events[2]).toMatchObject({
            type: 'update',
            collection: 'docs',
            id: 'doc-1',
            delta: { title: 'Second', counter: 3 },
            origin: 'local',
            mutationId: 'mut-3',
        });

        expect(events[3]).toMatchObject({
            type: 'delete',
            collection: 'docs',
            id: 'doc-1',
            origin: 'local',
            mutationId: 'mut-4',
        });

        sub.unsubscribe();
        bridge.dispose();
    });

    it('REQ-3: filters events by collection name and entity ID via subscribeCdc', async () => {
        const bridge = createCdcBridge(engine, bus, { channelPrefix: 'STORE' });

        const matchingEvents: StoreCdcEvent[] = [];
        const filtered$ = subscribeCdc(bus, {
            channelPrefix: 'STORE',
            collection: 'accounts',
            id: 'acc-target',
        });

        const matchingEventPromise = firstValueFrom(filtered$);

        // Non-matching collection
        await engine.insertDoc('profiles', 'acc-target', { note: 'wrong collection' });
        // Non-matching id
        await engine.insertDoc('accounts', 'acc-other', { note: 'wrong id' });
        // Matching collection and id
        await engine.insertDoc('accounts', 'acc-target', { note: 'match!' });

        const matchingEvent = await matchingEventPromise;
        matchingEvents.push(matchingEvent);

        expect(matchingEvents).toHaveLength(1);
        expect(matchingEvents[0].collection).toBe('accounts');
        expect(matchingEvents[0].id).toBe('acc-target');
        expect(matchingEvents[0].delta).toEqual({ note: 'match!' });

        bridge.dispose();
    });

    it('supports RxJS operators filterCollection and filterEntity', async () => {
        const bridge = createCdcBridge(engine, bus);

        const collectionFilteredPromise = firstValueFrom(
            bridge.cdc$.pipe(filterCollection('orders'))
        );
        const entityFilteredPromise = firstValueFrom(
            bridge.cdc$.pipe(filterEntity('orders', 'ord-42'))
        );

        await engine.insertDoc('inventory', 'inv-1', { qty: 10 });
        await engine.insertDoc('orders', 'ord-99', { amount: 100 });
        await engine.insertDoc('orders', 'ord-42', { amount: 250 });

        const collEvent = await collectionFilteredPromise;
        expect(collEvent.collection).toBe('orders');
        expect(collEvent.id).toBe('ord-99');

        const entityEvent = await entityFilteredPromise;
        expect(entityEvent.collection).toBe('orders');
        expect(entityEvent.id).toBe('ord-42');
        expect(entityEvent.delta).toEqual({ amount: 250 });

        bridge.dispose();
    });

    it('filters events by mutation type and origin', async () => {
        const bridge = createCdcBridge(engine, bus, { defaultOrigin: 'local' });

        const deleteOnlyPromise = firstValueFrom(
            bridge.cdc$.pipe(
                filterCdc({
                    typeFilter: ['delete'],
                    originFilter: ['local'],
                })
            )
        );

        await engine.insertDoc('items', 'i-1', { name: 'Item 1' });
        await engine.patchDoc('items', 'i-1', { name: 'Item 1 updated' });
        await engine.deleteDoc('items', 'i-1');

        const deleted = await deleteOnlyPromise;
        expect(deleted.type).toBe('delete');
        expect(deleted.id).toBe('i-1');
        expect(deleted.origin).toBe('local');

        bridge.dispose();
    });

    it('unsubscription prevents further messages and leaves no memory leaks', async () => {
        const bridge = createCdcBridge(engine, bus, { channelPrefix: 'STORE' });
        const received: StoreCdcEvent[] = [];

        const stream$ = subscribeCdc(bus, {
            channelPrefix: 'STORE',
            collection: 'messages',
        });

        const sub = stream$.subscribe((e) => received.push(e));

        const event1Promise = firstValueFrom(stream$);
        await engine.insertDoc('messages', 'm-1', { text: 'Hello' });
        await event1Promise;
        expect(received).toHaveLength(1);

        // Unsubscribe from bus CDC stream
        sub.unsubscribe();

        // Mutate again after unsubscription
        await engine.insertDoc('messages', 'm-2', { text: 'World' });
        expect(received).toHaveLength(1);

        // Disposing bridge shuts down all internal subjects
        expect(bridge.isDisposed).toBe(false);
        bridge.dispose();
        expect(bridge.isDisposed).toBe(true);
        expect(bridge.isConnected).toBe(false);

        // Subsequent mutations do not cause unhandled errors or deliveries
        await engine.insertDoc('messages', 'm-3', { text: 'Quiet' });
        expect(received).toHaveLength(1);
    });

    it('supports multiple collections concurrently emitting CDC events', async () => {
        const bridge = createCdcBridge(engine, bus);

        const authors: StoreCdcEvent[] = [];
        const posts: StoreCdcEvent[] = [];
        const comments: StoreCdcEvent[] = [];

        const subAuthors = firstValueFrom(
            subscribeCdc(bus, { collection: 'authors' }).pipe(take(2), toArray())
        );
        const subPosts = firstValueFrom(
            subscribeCdc(bus, { collection: 'posts' }).pipe(take(2), toArray())
        );
        const subComments = firstValueFrom(
            subscribeCdc(bus, { collection: 'comments' }).pipe(take(1), toArray())
        );

        await Promise.all([
            engine.insertDoc('authors', 'a-1', { name: 'Author One' }),
            engine.insertDoc('posts', 'p-1', { title: 'Post One', authorId: 'a-1' }),
            engine.insertDoc('comments', 'c-1', { content: 'Nice!', postId: 'p-1' }),
            engine.insertDoc('authors', 'a-2', { name: 'Author Two' }),
            engine.insertDoc('posts', 'p-2', { title: 'Post Two', authorId: 'a-2' }),
        ]);

        const [authorsEvents, postsEvents, commentsEvents] = await Promise.all([
            subAuthors,
            subPosts,
            subComments,
        ]);
        authors.push(...authorsEvents);
        posts.push(...postsEvents);
        comments.push(...commentsEvents);

        expect(authors).toHaveLength(2);
        expect(posts).toHaveLength(2);
        expect(comments).toHaveLength(1);

        expect(authors.map((a) => a.id).sort()).toEqual(['a-1', 'a-2']);
        expect(posts.map((p) => p.id).sort()).toEqual(['p-1', 'p-2']);
        expect(comments[0].id).toBe('c-1');

        bridge.dispose();
    });

    it('attaches to high-level LiveStoreInstance and LiveCollection with attachStoreBridge', async () => {
        const store: LiveStoreInstance = await createLiveStruct({
            name: `test-store-${Date.now()}`,
            forceMemory: true,
        });

        const controller = attachStoreBridge(bus, store, {
            channelPrefix: 'STORE',
        });

        expect(controller.isConnected).toBe(true);

        const eventsPromise = firstValueFrom(controller.cdc$.pipe(take(2), toArray()));

        const col = await store.collection<{ title: string }>('articles');
        const doc = await col.create('art-1', { title: 'Article 1' });
        await doc.patch({ title: 'Article 1 Patched' });

        const events = await eventsPromise;
        expect(events).toHaveLength(2);
        expect(events[0]).toMatchObject({
            type: 'insert',
            collection: 'articles',
            id: 'art-1',
            delta: { title: 'Article 1' },
        });
        expect(events[1]).toMatchObject({
            type: 'update',
            collection: 'articles',
            id: 'art-1',
            delta: { title: 'Article 1 Patched' },
        });

        controller.disconnect();
        expect(controller.isConnected).toBe(false);
        await store.close();
    });

    it('secondaryChannelPerCollection publishes on collection-specific channel', async () => {
        const bridge = createCdcBridge(engine, bus, {
            channelPrefix: 'STORE',
            secondaryChannelPerCollection: true,
        });

        const collectionEvents: StoreCdcEvent[] = [];
        const eventReceived = new Promise<void>((resolve) => {
            bus.on({
                channel: 'STORE.widgets.CHANGED',
                group: 'out',
                topic: 'w-100',
                callback: (msg) => {
                    collectionEvents.push(msg.payload as StoreCdcEvent);
                    resolve();
                },
            });
        });

        await engine.insertDoc('widgets', 'w-100', { color: 'blue' });
        await eventReceived;

        expect(collectionEvents).toHaveLength(1);
        expect(collectionEvents[0].collection).toBe('widgets');
        expect(collectionEvents[0].id).toBe('w-100');

        bridge.dispose();
    });

    it('REQ-7: malformed CDC item calls onInvalid without terminating stream; erroring source sets isConnected to false', async () => {
        const rawSubject = new Subject<any>();
        let invalidCount = 0;
        let receivedError: unknown = null;

        const cdc$ = toStoreCdcObservable(rawSubject.asObservable(), {
            onInvalid: (err) => {
                invalidCount++;
                receivedError = err;
            },
        });

        const bridge = createCdcBridge(cdc$, bus);
        expect(bridge.isConnected).toBe(true);

        const receivedEvents: StoreCdcEvent[] = [];
        bridge.cdc$.subscribe({
            next: (e) => receivedEvents.push(e),
            error: () => {},
        });

        // 1. Emit invalid non-object item (null, string)
        rawSubject.next(null);
        rawSubject.next('invalid');

        expect(invalidCount).toBe(2);
        expect(receivedError).toBeDefined();

        // 2. Stream is NOT terminated; valid item is delivered
        rawSubject.next({
            type: 'insert',
            collection: 'test',
            id: '1',
            delta: { ok: true },
        });

        expect(receivedEvents).toHaveLength(1);
        expect(receivedEvents[0].id).toBe('1');
        expect(bridge.isConnected).toBe(true);

        // 3. Erroring source marks bridge.isConnected === false
        rawSubject.error(new Error('Fatal source error'));
        expect(bridge.isConnected).toBe(false);

        bridge.dispose();
    });

    it('REQ-8: subscriber mutating payload.delta throws because delta is frozen, engine doc unchanged', async () => {
        const bridge = createCdcBridge(engine, bus, { freezeEvents: true });

        let subscriberError: unknown = null;
        const callbackDone = new Promise<void>((resolve) => {
            bus.on({
                channel: 'STORE.ENTITY_CHANGED',
                group: 'out',
                topic: 'users',
                callback: (msg) => {
                    const event = msg.payload as StoreCdcEvent;
                    try {
                        // Attempt to mutate frozen delta
                        (event.delta as any).name = 'Malicious Hack';
                    } catch (err) {
                        subscriberError = err;
                    }
                    resolve();
                },
            });
        });

        await engine.insertDoc('users', 'u-secure', { name: 'Original Name' });
        await callbackDone;

        expect(subscriberError).toBeInstanceOf(TypeError);

        const doc = await engine.getDoc('users', 'u-secure');
        expect(doc?.data).toEqual({ name: 'Original Name' });

        bridge.dispose();
    });
});
