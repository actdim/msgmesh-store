import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { createLiveStruct, type LiveStoreInstance } from '@actdim/livestruct';
import {
    resolveMutationTarget,
    applyStoreCommand,
    normalizeCommand,
    buildNestedPathPatch,
    UnsupportedStoreError,
} from '../src/core/applyMutation';

describe('applyMutation & resolveMutationTarget', () => {
    let store: LiveStoreInstance;

    beforeEach(async () => {
        store = await createLiveStruct({
            name: `test-apply-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        });
    });

    afterEach(async () => {
        if (store) {
            await store.close();
        }
    });

    describe('resolveMutationTarget', () => {
        it('resolves LiveStoreInstance target successfully', async () => {
            const target = resolveMutationTarget(store);
            expect(target).toBeDefined();

            await target.insert('items', 'i-1', { title: 'Item 1' }, 'm-1');
            const doc = await target.get('items', 'i-1');
            expect(doc).toEqual({ title: 'Item 1' });

            await target.patch('items', 'i-1', { price: 99 }, 'm-2');
            const patched = await target.get('items', 'i-1');
            expect(patched).toEqual({ title: 'Item 1', price: 99 });

            const removed = await target.remove('items', 'i-1', 'm-3');
            expect(removed).toBe(true);
            const deleted = await target.get('items', 'i-1');
            expect(deleted).toBeNull();
        });

        it('resolves LiveDocEngine target directly', async () => {
            const target = resolveMutationTarget(store.engine);
            expect(target).toBeDefined();

            await target.insert('docs', 'd-1', { val: 42 });
            const doc = await target.get('docs', 'd-1');
            expect(doc).toEqual({ val: 42 });
        });

        it('resolves LiveCollection target and enforces collection boundary', async () => {
            const col = await store.collection('users');
            const target = resolveMutationTarget(col);
            expect(target.boundCollection).toBe('users');

            await target.insert('users', 'u-1', { name: 'Alice' }, 'm-u1');
            const user = await target.get('users', 'u-1');
            expect(user).toEqual({ name: 'Alice' });

            // Enforces collection boundary: operating on 'orders' throws
            await expect(target.get('orders', 'u-1')).rejects.toThrow(
                "Cannot operate on collection 'orders': target is bound to collection 'users'."
            );
            await expect(target.insert('orders', 'u-1', {})).rejects.toThrow(
                "Cannot operate on collection 'orders': target is bound to collection 'users'."
            );
        });

        it('throws UnsupportedStoreError for invalid target objects', () => {
            expect(() => resolveMutationTarget(null)).toThrow(UnsupportedStoreError);
            expect(() => resolveMutationTarget({})).toThrow(UnsupportedStoreError);
            expect(() => resolveMutationTarget('string')).toThrow(UnsupportedStoreError);
        });
    });

    describe('applyStoreCommand', () => {
        it('applies CREATE: inserts if absent, patches if already present', async () => {
            const target = resolveMutationTarget(store);

            // 1. Insert when new
            await applyStoreCommand(target, {
                type: 'CREATE',
                collection: 'products',
                id: 'p-1',
                delta: { name: 'Book', stock: 10 },
                mutationId: 'm-1',
                origin: 'bus',
            });
            expect(await target.get('products', 'p-1')).toEqual({ name: 'Book', stock: 10 });

            // 2. Patch if already existing
            await applyStoreCommand(target, {
                type: 'CREATE',
                collection: 'products',
                id: 'p-1',
                delta: { stock: 15 },
                mutationId: 'm-2',
                origin: 'bus',
            });
            expect(await target.get('products', 'p-1')).toEqual({ name: 'Book', stock: 15 });
        });

        it('applies PATCH: inserts if absent, patches if present', async () => {
            const target = resolveMutationTarget(store);

            // 1. Insert if absent
            await applyStoreCommand(target, {
                type: 'PATCH',
                collection: 'notes',
                id: 'n-1',
                delta: { text: 'Hello' },
                mutationId: 'm-n1',
                origin: 'bus',
            });
            expect(await target.get('notes', 'n-1')).toEqual({ text: 'Hello' });

            // 2. Update existing
            await applyStoreCommand(target, {
                type: 'PATCH',
                collection: 'notes',
                id: 'n-1',
                delta: { archived: true },
                mutationId: 'm-n2',
                origin: 'bus',
            });
            expect(await target.get('notes', 'n-1')).toEqual({ text: 'Hello', archived: true });
        });

        it('applies PATCH_PATH with nested object building', async () => {
            const target = resolveMutationTarget(store);

            await applyStoreCommand(target, {
                type: 'PATCH_PATH',
                collection: 'configs',
                id: 'c-1',
                path: 'settings.theme.dark',
                value: true,
                mutationId: 'm-c1',
                origin: 'bus',
            });

            expect(await target.get('configs', 'c-1')).toEqual({
                settings: {
                    theme: {
                        dark: true,
                    },
                },
            });
        });

        it('applies DELETE: removes document, silent no-op if document does not exist', async () => {
            const target = resolveMutationTarget(store);

            await applyStoreCommand(target, {
                type: 'CREATE',
                collection: 'tokens',
                id: 'tok-1',
                delta: { key: 'secret' },
                mutationId: 'm-tok1',
                origin: 'bus',
            });

            await applyStoreCommand(target, {
                type: 'DELETE',
                collection: 'tokens',
                id: 'tok-1',
                mutationId: 'm-tok2',
                origin: 'bus',
            });
            expect(await target.get('tokens', 'tok-1')).toBeNull();

            // Deleting non-existent doc should be a silent no-op (no throw)
            await expect(
                applyStoreCommand(target, {
                    type: 'DELETE',
                    collection: 'tokens',
                    id: 'tok-1',
                    mutationId: 'm-tok3',
                    origin: 'bus',
                })
            ).resolves.not.toThrow();
        });

        it('invokes target flush when durable: true is set', async () => {
            let flushed = false;
            const mockTarget = {
                async get() {
                    return null;
                },
                async insert() {
                    return {};
                },
                async patch() {
                    return {};
                },
                async remove() {
                    return true;
                },
                async flush() {
                    flushed = true;
                },
            };

            await applyStoreCommand(mockTarget, {
                type: 'CREATE',
                collection: 'records',
                id: 'r-1',
                delta: { val: 1 },
                mutationId: 'm-r1',
                origin: 'bus',
                durable: true,
            });

            expect(flushed).toBe(true);
        });
    });

    describe('normalizeCommand & buildNestedPathPatch', () => {
        it('builds nested path patch from dot segments', () => {
            const patch = buildNestedPathPatch('a.b.c', 123);
            expect(patch).toEqual({ a: { b: { c: 123 } } });
        });

        it('normalizes INSERT to CREATE and UPDATE to PATCH', () => {
            const cmd1 = normalizeCommand({
                payload: { action: 'INSERT', id: '1', data: { a: 1 } },
            });
            expect(cmd1.type).toBe('CREATE');

            const cmd2 = normalizeCommand({
                payload: { action: 'UPDATE', id: '2', delta: { b: 2 } },
            });
            expect(cmd2.type).toBe('PATCH');
        });

        it('never re-uses correlationId as mutationId and generates random UUID if absent', () => {
            const cmd = normalizeCommand({
                payload: {
                    id: 'doc-1',
                    correlationId: 'client-req-999',
                },
            });
            expect(cmd.correlationId).toBe('client-req-999');
            expect(cmd.mutationId).toBeDefined();
            expect(cmd.mutationId).not.toBe('client-req-999');
            expect(cmd.mutationId.length).toBeGreaterThan(10);
        });
    });
});
