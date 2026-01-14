import { describe, test, expect } from "vitest";
import { mergeCollections, mergeCollectionRecords, type Collection } from "./collection";
import { makeStamp } from "./clock";
import { makeDocument } from "./document";
import { mergeTombstones } from "./tombstone";

describe("mergeCollections", () => {
  test("merges documents when both have the same ID", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);

    const target: Collection = {
      documents: {
        "1": makeDocument({ name: "Alice", age: 30 }, stamp1),
      },
    };
    const source: Collection = {
      documents: {
        "1": makeDocument({ name: "Bob", age: 31 }, stamp2),
      },
    };

    const result = mergeCollections(target, source, {});

    expect(result.documents["1"]).toBeDefined();
    expect(result.documents["1"]?.["name"]?.["~value"]).toBe("Bob");
    expect(result.documents["1"]?.["age"]?.["~value"]).toBe(31);
  });

  test("includes documents that only exist in target", () => {
    const stamp1 = makeStamp(1000, 1);

    const target: Collection = {
      documents: {
        "1": makeDocument({ name: "Alice" }, stamp1),
      },
    };
    const source: Collection = {
      documents: {},
    };

    const result = mergeCollections(target, source, {});

    expect(result.documents["1"]).toBeDefined();
    expect(result.documents["1"]?.["name"]?.["~value"]).toBe("Alice");
  });

  test("includes documents that only exist in source", () => {
    const stamp2 = makeStamp(2000, 1);

    const target: Collection = {
      documents: {},
    };
    const source: Collection = {
      documents: {
        "2": makeDocument({ name: "Bob" }, stamp2),
      },
    };

    const result = mergeCollections(target, source, {});

    expect(result.documents["2"]).toBeDefined();
    expect(result.documents["2"]?.["name"]?.["~value"]).toBe("Bob");
  });

  test("merges tombstones", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);
    const tombstone2_old = makeStamp(1000, 1);
    const tombstone2_new = makeStamp(2000, 1);
    const tombstone4 = makeStamp(1500, 1);

    const target: Collection = {
      documents: {
        "1": makeDocument({ name: "Alice" }, stamp1),
      },
    };
    const source: Collection = {
      documents: {
        "2": makeDocument({ name: "Bob" }, stamp2),
        "3": makeDocument({ name: "Charlie" }, stamp2),
      },
    };

    const tombstones = mergeTombstones(
      {
        "2": tombstone2_old,
      },
      {
        "2": tombstone2_new,
        "4": tombstone4,
      },
    );

    const result = mergeCollections(target, source, tombstones);

    // Verify that tombstoned documents are excluded
    expect(result.documents["2"]).toBeUndefined();
    expect(result.documents["4"]).toBeUndefined();
    expect(result.documents["1"]).toBeDefined();
    expect(result.documents["3"]).toBeDefined();
  });

  test("removes documents that are tombstoned", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);
    const tombstone1 = makeStamp(2000, 1);

    const target: Collection = {
      documents: {
        "1": makeDocument({ name: "Alice" }, stamp1),
      },
    };
    const source: Collection = {
      documents: {
        "1": makeDocument({ name: "Bob" }, stamp2),
      },
    };

    const result = mergeCollections(target, source, {
      "1": tombstone1,
    });

    expect(result.documents["1"]).toBeUndefined();
  });

  test("handles complex merge scenario", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);
    const stamp3 = makeStamp(3000, 1);
    const tombstone3_old = makeStamp(1000, 1);
    const tombstone3_new = makeStamp(1500, 1);
    const tombstone2 = makeStamp(2500, 1);

    const target: Collection = {
      documents: {
        "1": makeDocument({ name: "Alice", age: 30 }, stamp1),
        "2": makeDocument({ name: "Bob" }, stamp1),
      },
    };
    const source: Collection = {
      documents: {
        "1": makeDocument({ name: "Alice", age: 31 }, stamp2),
        "2": makeDocument({ name: "Robert" }, stamp3),
        "4": makeDocument({ name: "David" }, stamp2),
      },
    };

    const tombstones = mergeTombstones(
      {
        "3": tombstone3_old,
      },
      {
        "2": tombstone2,
        "3": tombstone3_new,
      },
    );

    const result = mergeCollections(target, source, tombstones);

    expect(result.documents["1"]).toBeDefined();
    expect(result.documents["2"]).toBeUndefined();
    expect(result.documents["4"]).toBeDefined();
    expect(result.documents["4"]?.["name"]?.["~value"]).toBe("David");
  });

  test("handles empty snapshots", () => {
    const target: Collection = {
      documents: {},
    };
    const source: Collection = {
      documents: {},
    };

    const result = mergeCollections(target, source, {});

    expect(result.documents).toEqual({});
  });
});

describe("mergeCollectionRecords", () => {
  test("merges multiple collection records", () => {
    const stamp1 = makeStamp(1000, 1);
    const stamp2 = makeStamp(2000, 1);

    const target: Record<string, Collection> = {
      users: {
        documents: {
          "1": makeDocument({ name: "Alice" }, stamp1),
        },
      },
    };

    const source: Record<string, Collection> = {
      users: {
        documents: {
          "2": makeDocument({ name: "Bob" }, stamp2),
        },
      },
      notes: {
        documents: {
          "note-1": makeDocument({ content: "Hello" }, stamp2),
        },
      },
    };

    const result = mergeCollectionRecords(target, source, {});

    expect(result["users"]?.documents["1"]).toBeDefined();
    expect(result["users"]?.documents["2"]).toBeDefined();
    expect(result["notes"]?.documents["note-1"]).toBeDefined();
  });

  test("adds new collections from source", () => {
    const stamp = makeStamp(1000, 1);

    const target: Record<string, Collection> = {};
    const source: Record<string, Collection> = {
      users: {
        documents: {
          "1": makeDocument({ name: "Alice" }, stamp),
        },
      },
    };

    const result = mergeCollectionRecords(target, source, {});

    expect(result["users"]).toBeDefined();
    expect(result["users"]?.documents["1"]).toBeDefined();
  });
});
