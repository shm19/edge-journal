// The ONE place that decides which statuses are counted together. Pure (no DB), unit tested in status.test.ts.
// Adding an IdeaStatus without placing it in a bucket fails the type-check / status.test.ts.
import type { IdeaStatus } from "@/db/schema";

export const STATUS_BUCKETS = {
  /** Real trades: the only status that feeds live dashboard numbers. */
  taken: ["taken"],
  /** Hypothetical exits of ideas that were not traded. */
  skips: ["skipped", "missed"],
  forward: ["forward_test"],
  backtest: ["backtest"],
} as const satisfies Record<string, readonly IdeaStatus[]>;

export type StatusBucket = keyof typeof STATUS_BUCKETS;

export function bucketOf(status: IdeaStatus): StatusBucket {
  return (Object.keys(STATUS_BUCKETS) as StatusBucket[]).find((b) => (STATUS_BUCKETS[b] as readonly IdeaStatus[]).includes(status))!;
}

/** Ideas whose status is in any of the given buckets. */
export function inBuckets<T extends { status: IdeaStatus }>(list: T[], ...buckets: StatusBucket[]): T[] {
  return list.filter((i) => buckets.includes(bucketOf(i.status)));
}

/** Still open: has a primary scenario with no result yet (and is not an observation-only hit/miss). */
export function isOpen(i: { primary: { r: number | null } | null; outcome: string | null }): boolean {
  return i.primary != null && i.primary.r == null && i.outcome == null;
}
