import { describe, test, expect } from "bun:test";
import { mergeCollections, type CollectionSnapshot } from "./collection";
import { makeStamp } from "./clock";
import { makeDocument } from "./document";

describe("mergeCollections", () => {
  test("merges clocks by advancing target with source", () => {
    const target: CollectionSnapshot = {
      clock: { ms: 1000, seq: 1 },
      documents: {},
      tombstones: {},
    };
    const source: CollectionSnapshot = {
      clock: { ms: 2000, seq: 1 },
      documents: {},
      tombstones: {},
    };

    const result = mergeCollections(target, source);

    expect(result.clock).toEqual({ ms: 2000, seq: 1 });
  });

  test("merges documents when both have the same ID", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);

    const target: CollectionSnapshot = {
      clock: { ms: 1000, seq: 1 },
      documents: {
        "1": makeDocument({ name: "Alice", age: 30 }, stamp1),
      },
      tombstones: {},
    };
    const source: CollectionSnapshot = {
      clock: { ms: 2000, seq: 1 },
      documents: {
        "1": makeDocument({ name: "Bob", age: 31 }, stamp2),
      },
      tombstones: {},
    };

    const result = mergeCollections(target, source);

    expect(result.documents["1"]).toBeDefined();
    // Newer stamp (stamp2) should win, so name should be "Bob"
    expect(result.documents["1"]?.["name"]?.["~value"]).toBe("Bob");
    expect(result.documents["1"]?.["age"]?.["~value"]).toBe(31);
  });

  test("includes documents that only exist in target", () => {
    const stamp1 = makeStamp(1000, 1);

    const target: CollectionSnapshot = {
      clock: { ms: 1000, seq: 1 },
      documents: {
        "1": makeDocument({ name: "Alice" }, stamp1),
      },
      tombstones: {},
    };
    const source: CollectionSnapshot = {
      clock: { ms: 1000, seq: 1 },
      documents: {},
      tombstones: {},
    };

    const result = mergeCollections(target, source);

    expect(result.documents["1"]).toBeDefined();
    expect(result.documents["1"]?.["name"]?.["~value"]).toBe("Alice");
  });

  test("includes documents that only exist in source", () => {
    const stamp2 = makeStamp(2000, 1);

    const target: CollectionSnapshot = {
      clock: { ms: 1000, seq: 1 },
      documents: {},
      tombstones: {},
    };
    const source: CollectionSnapshot = {
      clock: { ms: 2000, seq: 1 },
      documents: {
        "2": makeDocument({ name: "Bob" }, stamp2),
      },
      tombstones: {},
    };

    const result = mergeCollections(target, source);

    expect(result.documents["2"]).toBeDefined();
    expect(result.documents["2"]?.["name"]?.["~value"]).toBe("Bob");
  });

  test("merges tombstones", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);
    const tombstone2_old = makeStamp(1000, 1);
    const tombstone2_new = makeStamp(2000, 1);
    const tombstone4 = makeStamp(1500, 1);

    const target: CollectionSnapshot = {
      clock: { ms: 1000, seq: 1 },
      documents: {
        "1": makeDocument({ name: "Alice" }, stamp1),
      },
      tombstones: {
        "2": tombstone2_old,
      },
    };
    const source: CollectionSnapshot = {
      clock: { ms: 2000, seq: 1 },
      documents: {
        "2": makeDocument({ name: "Bob" }, stamp2),
        "3": makeDocument({ name: "Charlie" }, stamp2),
      },
      tombstones: {
        "2": tombstone2_new, // Newer tombstone
        "4": tombstone4,
      },
    };

    const result = mergeCollections(target, source);

    // Tombstone "2" should have the newer stamp
    expect(result.tombstones["2"]).toBe(tombstone2_new);
    expect(result.tombstones["4"]).toBe(tombstone4);
  });

  test("removes documents that are tombstoned", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);
    const tombstone1 = makeStamp(2000, 1);

    const target: CollectionSnapshot = {
      clock: { ms: 1000, seq: 1 },
      documents: {
        "1": makeDocument({ name: "Alice" }, stamp1),
      },
      tombstones: {},
    };
    const source: CollectionSnapshot = {
      clock: { ms: 2000, seq: 1 },
      documents: {
        "1": makeDocument({ name: "Bob" }, stamp2),
      },
      tombstones: {
        "1": tombstone1, // Document 1 is tombstoned
      },
    };

    const result = mergeCollections(target, source);

    // Document "1" should not be in the merged documents because it's tombstoned
    expect(result.documents["1"]).toBeUndefined();
    expect(result.tombstones["1"]).toBe(tombstone1);
  });

  test("handles complex merge scenario", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);
    const stamp3 = makeStamp(3000, 1);
    const tombstone3_old = makeStamp(1000, 1);
    const tombstone3_new = makeStamp(1500, 1);
    const tombstone2 = makeStamp(2500, 1);

    const target: CollectionSnapshot = {
      clock: { ms: 1000, seq: 1 },
      documents: {
        "1": makeDocument({ name: "Alice", age: 30 }, stamp1),
        "2": makeDocument({ name: "Bob" }, stamp1),
      },
      tombstones: {
        "3": tombstone3_old,
      },
    };
    const source: CollectionSnapshot = {
      clock: { ms: 3000, seq: 1 },
      documents: {
        "1": makeDocument({ name: "Alice", age: 31 }, stamp2), // Older update
        "2": makeDocument({ name: "Robert" }, stamp3), // Newer update
        "4": makeDocument({ name: "David" }, stamp2),
      },
      tombstones: {
        "2": tombstone2, // Document 2 gets tombstoned
        "3": tombstone3_new, // Newer tombstone, should keep newer one
      },
    };

    const result = mergeCollections(target, source);

    // Clock should be advanced
    expect(result.clock.ms).toBe(3000);

    // Document 1: merged, age from source (stamp2) but name from target (stamp1) - wait, actually
    // both fields exist in both, so we merge field by field. Let me think...
    // Actually, mergeDocuments merges at the field level, so newer field stamps win
    expect(result.documents["1"]).toBeDefined();

    // Document 2: should be removed (tombstoned in source)
    expect(result.documents["2"]).toBeUndefined();

    // Document 4: should be included (only in source)
    expect(result.documents["4"]).toBeDefined();
    expect(result.documents["4"]?.["name"]?.["~value"]).toBe("David");

    // Tombstones
    expect(result.tombstones["2"]).toBe(tombstone2);
    expect(result.tombstones["3"]).toBe(tombstone3_new); // Newer stamp wins
  });

  test("handles empty snapshots", () => {
    const target: CollectionSnapshot = {
      clock: { ms: 1000, seq: 1 },
      documents: {},
      tombstones: {},
    };
    const source: CollectionSnapshot = {
      clock: { ms: 2000, seq: 1 },
      documents: {},
      tombstones: {},
    };

    const result = mergeCollections(target, source);

    expect(result.clock.ms).toBe(2000);
    expect(result.documents).toEqual({});
    expect(result.tombstones).toEqual({});
  });
});
