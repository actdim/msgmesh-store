import { describe, it, expect } from 'vitest';
import { attachStoreBridge, type MsgMeshBusLike, type StoreTarget } from '../src/index';

describe('TypeScript type-level constraints', () => {
    it('verifies that attachStoreBridge rejects invalid arguments at compile time and runtime', () => {
        const dummyBus: MsgMeshBusLike = {
            send: async () => {},
            on: () => () => {},
        };

        const dummyStore: StoreTarget = {
            get: async () => null,
            insert: async () => {},
            patch: async () => {},
            remove: async () => true,
        };

        // Valid calls compile cleanly
        const controller = attachStoreBridge(dummyBus, dummyStore, { enableCdcStream: false });
        expect(controller).toBeDefined();

        expect(() => {
            // @ts-expect-error Type test proving attachStoreBridge(123, ...) fails to compile
            attachStoreBridge(123, dummyStore);
        }).toThrow();

        expect(() => {
            // @ts-expect-error Type test proving invalid number store fails to compile
            attachStoreBridge(dummyBus, 123);
        }).toThrow();

        expect(() => {
            // @ts-expect-error Type test proving invalid string store fails to compile
            attachStoreBridge(dummyBus, 'invalid-store');
        }).toThrow();

        controller.dispose();
    });
});
