import { describe, it, expect } from 'vitest';
import { MutationLedger } from '../src/core/mutationLedger';

describe('MutationLedger', () => {
    it('initializes with default or custom capacity', () => {
        const defaultLedger = new MutationLedger();
        expect(defaultLedger.capacity).toBe(4096);

        const customLedger = new MutationLedger(5);
        expect(customLedger.capacity).toBe(5);

        const invalidLedger = new MutationLedger(-10);
        expect(invalidLedger.capacity).toBe(4096);
    });

    it('tracks and clears in-flight mutations with origins', () => {
        const ledger = new MutationLedger();

        expect(ledger.isInFlight('m1')).toBe(false);
        expect(ledger.getInFlightOrigin('m1')).toBeUndefined();

        ledger.begin('m1', 'bus-node-1');
        expect(ledger.isInFlight('m1')).toBe(true);
        expect(ledger.getInFlightOrigin('m1')).toBe('bus-node-1');

        ledger.end('m1');
        expect(ledger.isInFlight('m1')).toBe(false);
        expect(ledger.getInFlightOrigin('m1')).toBeUndefined();
    });

    it('gracefully handles empty or null mutation IDs', () => {
        const ledger = new MutationLedger();

        ledger.begin('', 'origin');
        expect(ledger.isInFlight('')).toBe(false);

        ledger.end('');
        expect(ledger.getInFlightOrigin('')).toBeUndefined();

        ledger.markApplied('');
        expect(ledger.wasApplied('')).toBe(false);
    });

    it('evicts oldest entries when capacity is reached (LRU)', () => {
        const ledger = new MutationLedger(3);

        ledger.markApplied('m1', 'client-a');
        ledger.markApplied('m2', 'client-b');
        ledger.markApplied('m3', 'client-c');

        expect(ledger.wasApplied('m1')).toBe(true);
        expect(ledger.wasApplied('m2')).toBe(true);
        expect(ledger.wasApplied('m3')).toBe(true);
        expect(ledger.applied.size).toBe(3);

        // Add 4th item, m1 should be evicted
        ledger.markApplied('m4', 'client-d');
        expect(ledger.wasApplied('m1')).toBe(false);
        expect(ledger.wasApplied('m2')).toBe(true);
        expect(ledger.wasApplied('m3')).toBe(true);
        expect(ledger.wasApplied('m4')).toBe(true);
        expect(ledger.applied.size).toBe(3);

        // Access/re-mark m2 to refresh its position
        ledger.markApplied('m2', 'client-b');
        // Now m3 is the oldest, adding m5 should evict m3
        ledger.markApplied('m5', 'client-e');
        expect(ledger.wasApplied('m3')).toBe(false);
        expect(ledger.wasApplied('m2')).toBe(true);
        expect(ledger.wasApplied('m4')).toBe(true);
        expect(ledger.wasApplied('m5')).toBe(true);
    });

    it('resolves origin from in-flight when markApplied has no explicit origin', () => {
        const ledger = new MutationLedger();

        ledger.begin('m1', 'client-x');
        expect(ledger.getInFlightOrigin('m1')).toBe('client-x');

        ledger.markApplied('m1');
        expect(ledger.wasApplied('m1')).toBe(true);
        expect(ledger.getInFlightOrigin('m1')).toBe('client-x');

        ledger.end('m1');
        expect(ledger.isInFlight('m1')).toBe(false);
        // Retains appliedOrigin even after in-flight is ended
        expect(ledger.getInFlightOrigin('m1')).toBe('client-x');
    });

    it('clears all in-flight and applied records', () => {
        const ledger = new MutationLedger();

        ledger.begin('m1', 'origin-1');
        ledger.markApplied('m2', 'origin-2');

        expect(ledger.inFlight.size).toBe(1);
        expect(ledger.applied.size).toBe(1);

        ledger.clear();

        expect(ledger.inFlight.size).toBe(0);
        expect(ledger.applied.size).toBe(0);
        expect(ledger.isInFlight('m1')).toBe(false);
        expect(ledger.wasApplied('m2')).toBe(false);
        expect(ledger.getInFlightOrigin('m1')).toBeUndefined();
    });
});
