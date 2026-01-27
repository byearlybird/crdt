import { describe, expect, test } from "vitest";
import { pack } from "./atomizer";
import { mergeDocs, mergeCollections } from "./merge";
import { makeStamp } from "./clock";

const t1 = makeStamp(1000, 0);
const t15 = makeStamp(1500, 0);
const t2 = makeStamp(2000, 0);

describe("mergeDocs", () => {
  test("adds missing keys from incoming", () => {
    const local: Record<string, any> = { a: pack(1, t1) };
    const incoming = { a: pack(1, t1), b: pack(2, t1) };

    const result = mergeDocs(local, incoming);

    expect(result["a"]).toEqual(pack(1, t1));
    expect(result["b"]).toEqual(pack(2, t1));
  });

  test("LWW: takes incoming when incoming ts > local ts", () => {
    const local = { x: pack("old", t1) };
    const incoming = { x: pack("new", t2) };

    const result = mergeDocs(local, incoming);

    expect(result["x"]).toEqual(pack("new", t2));
  });

  test("LWW: keeps local when local ts >= incoming ts", () => {
    const local = { x: pack("local", t2) };
    const incoming = { x: pack("incoming", t1) };

    const result = mergeDocs(local, incoming);

    expect(result["x"]).toEqual(pack("local", t2));
  });

  test("returns local reference when no changes", () => {
    const local = { a: pack(1, t1) };
    const incoming = { a: pack(1, t1) };

    const result = mergeDocs(local, incoming);

    expect(result).toBe(local);
  });

  test("returns new object when there are changes", () => {
    const local = { a: pack(1, t1) };
    const incoming = { a: pack(2, t2) };

    const result = mergeDocs(local, incoming);

    expect(result).not.toBe(local);
    expect(result).toEqual({ a: pack(2, t2) });
  });
});

describe("mergeCollections", () => {
  test("merges documents that exist in both collections", () => {
    const local = {
      documents: {
        "1": { name: pack("Alice", t1), age: pack(30, t1) },
      },
      tombstones: {},
    };
    const incoming = {
      documents: {
        "1": { name: pack("Bob", t2), age: pack(30, t1) },
      },
      tombstones: {},
    };

    const result = mergeCollections(local, incoming);

    expect(result.documents["1"]).toBeDefined();
    expect(result.documents["1"]!.name).toEqual(pack("Bob", t2)); // LWW: incoming wins
    expect(result.documents["1"]!.age).toEqual(pack(30, t1)); // Local kept (same timestamp)
  });

  test("adds documents that only exist in incoming", () => {
    const local = {
      documents: {
        "1": { name: pack("Alice", t1) },
      },
      tombstones: {},
    };
    const incoming = {
      documents: {
        "2": { name: pack("Bob", t1) },
      },
      tombstones: {},
    };

    const result = mergeCollections(local, incoming);

    expect(result.documents["1"]).toBeDefined();
    expect(result.documents["2"]).toBeDefined();
    expect(result.documents["1"]!.name).toEqual(pack("Alice", t1));
    expect(result.documents["2"]!.name).toEqual(pack("Bob", t1));
  });

  test("keeps documents that only exist in local", () => {
    const local = {
      documents: {
        "1": { name: pack("Alice", t1) },
      },
      tombstones: {},
    };
    const incoming = {
      documents: {},
      tombstones: {},
    };

    const result = mergeCollections(local, incoming);

    expect(result.documents["1"]).toBeDefined();
    expect(result.documents["1"]!.name).toEqual(pack("Alice", t1));
  });

  test("filters out tombstoned documents", () => {
    const local = {
      documents: {
        "1": { name: pack("Alice", t1) },
        "2": { name: pack("Bob", t1) },
      },
      tombstones: { "2": t15 }, // Bob is tombstoned
    };
    const incoming = {
      documents: {
        "3": { name: pack("Charlie", t1) },
      },
      tombstones: {},
    };

    const result = mergeCollections(local, incoming);

    expect(result.documents["1"]).toBeDefined();
    expect(result.documents["2"]).toBeUndefined(); // Tombstoned, should be filtered
    expect(result.documents["3"]).toBeDefined();
  });

  test("filters out tombstoned documents from incoming", () => {
    const local = {
      documents: {
        "1": { name: pack("Alice", t1) },
      },
      tombstones: {},
    };
    const incoming = {
      documents: {
        "2": { name: pack("Bob", t1) },
      },
      tombstones: { "2": t15 }, // Bob is tombstoned
    };

    const result = mergeCollections(local, incoming);

    expect(result.documents["1"]).toBeDefined();
    expect(result.documents["2"]).toBeUndefined(); // Tombstoned, should be filtered
  });

  test("handles empty collections", () => {
    const local = {
      documents: {},
      tombstones: {},
    };
    const incoming = {
      documents: {},
      tombstones: {},
    };

    const result = mergeCollections(local, incoming);

    expect(Object.keys(result.documents)).toHaveLength(0);
  });

  test("handles collections with all tombstoned documents", () => {
    const local = {
      documents: {
        "1": { name: pack("Alice", t1) },
        "2": { name: pack("Bob", t1) },
      },
      tombstones: { "1": t15, "2": t15 }, // All tombstoned
    };
    const incoming = {
      documents: {},
      tombstones: {},
    };

    const result = mergeCollections(local, incoming);

    expect(Object.keys(result.documents)).toHaveLength(0);
  });
});
