import { describe, expect, test } from "vitest";
import { Atomizer } from "./atomizer";
import { mergeDocs, mergeCollections } from "./merge";

describe("mergeDocs", () => {
  test("adds missing keys from incoming", () => {
    const local: Record<string, any> = { a: Atomizer.pack(1, "1000") };
    const incoming = { a: Atomizer.pack(1, "1000"), b: Atomizer.pack(2, "1000") };

    const result = mergeDocs(local, incoming);

    expect(result["a"]).toEqual(Atomizer.pack(1, "1000"));
    expect(result["b"]).toEqual(Atomizer.pack(2, "1000"));
  });

  test("LWW: takes incoming when incoming ts > local ts", () => {
    const local = { x: Atomizer.pack("old", "1000") };
    const incoming = { x: Atomizer.pack("new", "2000") };

    const result = mergeDocs(local, incoming);

    expect(result["x"]).toEqual(Atomizer.pack("new", "2000"));
  });

  test("LWW: keeps local when local ts >= incoming ts", () => {
    const local = { x: Atomizer.pack("local", "2000") };
    const incoming = { x: Atomizer.pack("incoming", "1000") };

    const result = mergeDocs(local, incoming);

    expect(result["x"]).toEqual(Atomizer.pack("local", "2000"));
  });

  test("returns local reference when no changes", () => {
    const local = { a: Atomizer.pack(1, "1000") };
    const incoming = { a: Atomizer.pack(1, "1000") };

    const result = mergeDocs(local, incoming);

    expect(result).toBe(local);
  });

  test("returns new object when there are changes", () => {
    const local = { a: Atomizer.pack(1, "1000") };
    const incoming = { a: Atomizer.pack(2, "2000") };

    const result = mergeDocs(local, incoming);

    expect(result).not.toBe(local);
    expect(result).toEqual({ a: Atomizer.pack(2, "2000") });
  });
});

describe("mergeCollections", () => {
  test("merges documents that exist in both collections", () => {
    const local = {
      "1": { name: Atomizer.pack("Alice", "1000"), age: Atomizer.pack(30, "1000") },
    };
    const incoming = {
      "1": { name: Atomizer.pack("Bob", "2000"), age: Atomizer.pack(30, "1000") },
    };
    const tombstones = {};

    const result = mergeCollections(local, incoming, tombstones);

    expect(result["1"]).toBeDefined();
    expect(result["1"]!.name).toEqual(Atomizer.pack("Bob", "2000")); // LWW: incoming wins
    expect(result["1"]!.age).toEqual(Atomizer.pack(30, "1000")); // Local kept (same timestamp)
  });

  test("adds documents that only exist in incoming", () => {
    const local = {
      "1": { name: Atomizer.pack("Alice", "1000") },
    };
    const incoming = {
      "2": { name: Atomizer.pack("Bob", "1000") },
    };
    const tombstones = {};

    const result = mergeCollections(local, incoming, tombstones);

    expect(result["1"]).toBeDefined();
    expect(result["2"]).toBeDefined();
    expect(result["1"]!.name).toEqual(Atomizer.pack("Alice", "1000"));
    expect(result["2"]!.name).toEqual(Atomizer.pack("Bob", "1000"));
  });

  test("keeps documents that only exist in local", () => {
    const local = {
      "1": { name: Atomizer.pack("Alice", "1000") },
    };
    const incoming = {};
    const tombstones = {};

    const result = mergeCollections(local, incoming, tombstones);

    expect(result["1"]).toBeDefined();
    expect(result["1"]!.name).toEqual(Atomizer.pack("Alice", "1000"));
  });

  test("filters out tombstoned documents", () => {
    const local = {
      "1": { name: Atomizer.pack("Alice", "1000") },
      "2": { name: Atomizer.pack("Bob", "1000") },
    };
    const incoming = {
      "3": { name: Atomizer.pack("Charlie", "1000") },
    };
    const tombstones = { "2": "1500" }; // Bob is tombstoned

    const result = mergeCollections(local, incoming, tombstones);

    expect(result["1"]).toBeDefined();
    expect(result["2"]).toBeUndefined(); // Tombstoned, should be filtered
    expect(result["3"]).toBeDefined();
  });

  test("filters out tombstoned documents from incoming", () => {
    const local = {
      "1": { name: Atomizer.pack("Alice", "1000") },
    };
    const incoming = {
      "2": { name: Atomizer.pack("Bob", "1000") },
    };
    const tombstones = { "2": "1500" }; // Bob is tombstoned

    const result = mergeCollections(local, incoming, tombstones);

    expect(result["1"]).toBeDefined();
    expect(result["2"]).toBeUndefined(); // Tombstoned, should be filtered
  });

  test("handles empty collections", () => {
    const local = {};
    const incoming = {};
    const tombstones = {};

    const result = mergeCollections(local, incoming, tombstones);

    expect(Object.keys(result)).toHaveLength(0);
  });

  test("handles collections with all tombstoned documents", () => {
    const local = {
      "1": { name: Atomizer.pack("Alice", "1000") },
      "2": { name: Atomizer.pack("Bob", "1000") },
    };
    const incoming = {};
    const tombstones = { "1": "1500", "2": "1500" }; // All tombstoned

    const result = mergeCollections(local, incoming, tombstones);

    expect(Object.keys(result)).toHaveLength(0);
  });
});
