import { describe, expect, it } from "vitest";
import { IDEA_STATUSES } from "@/db/schema";
import { makeIdea } from "../../test/fixtures";
import { BIAS_LABEL, EXIT_LABEL, REGIME_LABEL, STATUS_LABEL } from "./format";
import { BIASES, EXIT_REASONS, REGIMES } from "@/db/schema";
import { bucketOf, inBuckets, isHypothetical, isOpen, STATUS_BUCKETS, type StatusBucket } from "./status";

describe("status buckets", () => {
  it("places every IDEA_STATUSES value in exactly one bucket", () => {
    for (const status of IDEA_STATUSES) {
      const hits = (Object.keys(STATUS_BUCKETS) as StatusBucket[]).filter((b) => (STATUS_BUCKETS[b] as readonly string[]).includes(status));
      expect(hits, status).toHaveLength(1);
      expect(bucketOf(status)).toBe(hits[0]);
    }
  });

  it("has no bucket entry that is not a real status", () => {
    const all = Object.values(STATUS_BUCKETS).flat();
    expect(all.every((s) => (IDEA_STATUSES as readonly string[]).includes(s))).toBe(true);
    expect(all).toHaveLength(IDEA_STATUSES.length);
  });

  it("inBuckets selects by bucket", () => {
    const list = IDEA_STATUSES.map((status) => makeIdea({ status }));
    expect(inBuckets(list, "taken").map((i) => i.status)).toEqual(["taken"]);
    expect(inBuckets(list, "skips").map((i) => i.status)).toEqual(["skipped", "missed"]);
    expect(inBuckets(list, "skips", "forward").map((i) => i.status)).toEqual(["skipped", "missed", "forward_test"]);
  });
});

describe("isOpen", () => {
  it("is true only for a primary with no result and no hit/miss outcome", () => {
    expect(isOpen(makeIdea({ r: null }))).toBe(true);
    expect(isOpen(makeIdea({ r: 1 }))).toBe(false);
    expect(isOpen(makeIdea({ r: 0 }))).toBe(false); // e.g. not filled scores 0R
    expect(isOpen(makeIdea({ r: false }))).toBe(false); // observation only: no primary
    expect(isOpen(makeIdea({ r: null, outcome: "hit" }))).toBe(false);
  });
});

describe("isHypothetical", () => {
  it("is true for skipped, missed and forward tests only", () => {
    expect(IDEA_STATUSES.filter(isHypothetical).sort()).toEqual(["forward_test", "missed", "skipped"]);
  });
});

describe("label maps cover every enum value", () => {
  it("labels", () => {
    for (const s of IDEA_STATUSES) expect(STATUS_LABEL[s]).toBeTruthy();
    for (const s of BIASES) expect(BIAS_LABEL[s]).toBeTruthy();
    for (const s of REGIMES) expect(REGIME_LABEL[s]).toBeTruthy();
    for (const s of EXIT_REASONS) expect(EXIT_LABEL[s]).toBeTruthy();
  });
});
