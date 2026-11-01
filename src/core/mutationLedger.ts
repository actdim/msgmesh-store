/**
 * Deterministic, bounded ledger for tracking in-flight and completed mutations.
 * Prevents echo loops and duplicate command processing using count-based LRU eviction.
 */
export class MutationLedger {
    readonly capacity: number;
    readonly inFlight = new Map<string, string>();
    readonly applied = new Map<string, number>();
    private readonly appliedOrigins = new Map<string, string>();

    constructor(capacity = 4096) {
        this.capacity = capacity > 0 ? capacity : 4096;
    }

    begin(mutationId: string, origin: string): void {
        if (!mutationId) {
            return;
        }
        this.inFlight.set(mutationId, origin);
    }

    end(mutationId: string): void {
        if (!mutationId) {
            return;
        }
        this.inFlight.delete(mutationId);
    }

    isInFlight(mutationId: string): boolean {
        if (!mutationId) {
            return false;
        }
        return this.inFlight.has(mutationId);
    }

    getInFlightOrigin(mutationId: string): string | undefined {
        if (!mutationId) {
            return undefined;
        }
        return this.inFlight.get(mutationId) ?? this.appliedOrigins.get(mutationId);
    }

    markApplied(mutationId: string, origin?: string): void {
        if (!mutationId) {
            return;
        }
        if (this.applied.has(mutationId)) {
            this.applied.delete(mutationId);
            this.appliedOrigins.delete(mutationId);
        }
        while (this.applied.size >= this.capacity) {
            const oldestKey = this.applied.keys().next().value;
            if (oldestKey !== undefined) {
                this.applied.delete(oldestKey);
                this.appliedOrigins.delete(oldestKey);
            } else {
                break;
            }
        }
        this.applied.set(mutationId, Date.now());
        const resolvedOrigin = origin ?? this.inFlight.get(mutationId);
        if (resolvedOrigin) {
            this.appliedOrigins.set(mutationId, resolvedOrigin);
        }
    }

    wasApplied(mutationId: string): boolean {
        if (!mutationId) {
            return false;
        }
        return this.applied.has(mutationId);
    }

    clear(): void {
        this.inFlight.clear();
        this.applied.clear();
        this.appliedOrigins.clear();
    }
}
