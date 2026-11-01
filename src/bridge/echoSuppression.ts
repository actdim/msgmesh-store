import type { StoreCdcOrigin } from '../cdc/types';

/**
 * Metadata record for a tracked mutation.
 * @deprecated Use MutationLedger deterministic suppression instead.
 */
export interface EchoRecord {
    readonly mutationId: string;
    readonly origin: StoreCdcOrigin;
    readonly timestamp: number;
    readonly collection?: string;
    readonly entityId?: string;
}

/**
 * Sliding window tracker for identifying echoed mutations, reflected events,
 * and breaking bidirectional message bus loops.
 * @deprecated Use MutationLedger deterministic suppression instead.
 */
export class EchoTracker {
    private readonly ttlMs: number;
    private readonly records = new Map<string, EchoRecord>();

    constructor(ttlMs = 1000) {
        this.ttlMs = ttlMs > 0 ? ttlMs : 1000;
    }

    /**
     * Records a mutation ID with its associated origin and timestamp.
     */
    record(
        mutationId: string,
        origin: StoreCdcOrigin = 'bus',
        extra?: { collection?: string; id?: string }
    ): void {
        if (!mutationId) {
            return;
        }
        this.prune();
        this.records.delete(mutationId);
        this.records.set(mutationId, {
            mutationId,
            origin,
            timestamp: Date.now(),
            collection: extra?.collection,
            entityId: extra?.id,
        });
    }

    /**
     * Checks if a mutation ID is an echo within the sliding time window.
     * Optionally verifies whether its recorded origin matches expectedOrigin.
     */
    isEcho(mutationId: string, expectedOrigin?: StoreCdcOrigin): boolean {
        if (!mutationId) {
            return false;
        }
        this.prune();
        const record = this.records.get(mutationId);
        if (!record) {
            return false;
        }
        if (expectedOrigin !== undefined) {
            return record.origin === expectedOrigin;
        }
        return true;
    }

    /**
     * Checks whether a mutation ID is currently active in the sliding window.
     */
    has(mutationId: string): boolean {
        if (!mutationId) {
            return false;
        }
        this.prune();
        return this.records.has(mutationId);
    }

    /**
     * Returns the recorded origin for a given mutation ID, if present.
     */
    getOrigin(mutationId: string): StoreCdcOrigin | undefined {
        if (!mutationId) {
            return undefined;
        }
        this.prune();
        return this.records.get(mutationId)?.origin;
    }

    /**
     * Removes expired records from the sliding window.
     * Since entries are inserted chronologically into Map, iterate insertion order
     * and break at the first unexpired entry.
     */
    prune(now = Date.now()): void {
        const cutoff = now - this.ttlMs;
        for (const [key, rec] of this.records.entries()) {
            if (rec.timestamp < cutoff) {
                this.records.delete(key);
            } else {
                break;
            }
        }
    }

    /**
     * Clears all tracked records.
     */
    clear(): void {
        this.records.clear();
    }

    /**
     * Returns the count of active records within the sliding window.
     */
    get size(): number {
        this.prune();
        return this.records.size;
    }

    /**
     * Disposes the tracker and releases stored records.
     */
    dispose(): void {
        this.clear();
    }
}
