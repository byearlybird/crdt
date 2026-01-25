import { describe, expect, test } from "vitest";
import { type Document, type DocumentId, makeStamp } from "../core";
import { atomizeDocument } from "./write";
import { createReadHandle, createReadHandles, type ReadDependencies } from "./read";

describe("createReadHandle", () => {
  test("get() - returns parsed document for valid ID", () => {
    const stamp = makeStamp(1000, 0);
    const doc = atomizeDocument({ id: "1", name: "Alice" }, stamp);
    const documents: Record<DocumentId, Document> = { "1": doc };
    const tombstones = {};

    const handle = createReadHandle(documents, tombstones);
    const result = handle.get("1");

    expect(result).toEqual({ id: "1", name: "Alice" });
  });

  test("get() - returns undefined for deleted document", () => {
    const stamp = makeStamp(1000, 0);
    const doc = atomizeDocument({ id: "1", name: "Alice" }, stamp);
    const documents: Record<DocumentId, Document> = { "1": doc };
    const tombstones = { "1": stamp };

    const handle = createReadHandle(documents, tombstones);
    const result = handle.get("1");

    expect(result).toBeUndefined();
  });

  test("get() - returns undefined for non-existent document", () => {
    const documents: Record<DocumentId, Document> = {};
    const tombstones = {};

    const handle = createReadHandle(documents, tombstones);
    const result = handle.get("nonexistent");

    expect(result).toBeUndefined();
  });

  test("list() - returns all non-deleted documents", () => {
    const stamp1 = makeStamp(1000, 0);
    const stamp2 = makeStamp(1000, 1);
    const stamp3 = makeStamp(1000, 2);

    const doc1 = atomizeDocument({ id: "1", name: "Alice" }, stamp1);
    const doc2 = atomizeDocument({ id: "2", name: "Bob" }, stamp2);
    const doc3 = atomizeDocument({ id: "3", name: "Charlie" }, stamp3);

    const documents: Record<DocumentId, Document> = {
      "1": doc1,
      "2": doc2,
      "3": doc3,
    };
    const tombstones = {};

    const handle = createReadHandle(documents, tombstones);
    const result = handle.list();

    expect(result).toHaveLength(3);
    expect(result).toEqual(
      expect.arrayContaining([
        { id: "1", name: "Alice" },
        { id: "2", name: "Bob" },
        { id: "3", name: "Charlie" },
      ]),
    );
  });

  test("list() - filters out deleted documents", () => {
    const stamp1 = makeStamp(1000, 0);
    const stamp2 = makeStamp(1000, 1);
    const stamp3 = makeStamp(1000, 2);

    const doc1 = atomizeDocument({ id: "1", name: "Alice" }, stamp1);
    const doc2 = atomizeDocument({ id: "2", name: "Bob" }, stamp2);
    const doc3 = atomizeDocument({ id: "3", name: "Charlie" }, stamp3);

    const documents: Record<DocumentId, Document> = {
      "1": doc1,
      "2": doc2,
      "3": doc3,
    };
    const tombstones = { "2": stamp2 }; // Bob is deleted

    const handle = createReadHandle(documents, tombstones);
    const result = handle.list();

    expect(result).toHaveLength(2);
    expect(result).toEqual(
      expect.arrayContaining([
        { id: "1", name: "Alice" },
        { id: "3", name: "Charlie" },
      ]),
    );
    expect(result.find((doc: any) => doc.id === "2")).toBeUndefined();
  });
});

describe("createReadHandles", () => {
  test("creates read handles for multiple collections", () => {
    const stamp1 = makeStamp(1000, 0);
    const stamp2 = makeStamp(1000, 1);

    const userDoc = atomizeDocument({ id: "1", name: "Alice" }, stamp1);
    const noteDoc = atomizeDocument({ id: "1", content: "Note 1" }, stamp2);

    const deps: ReadDependencies = {
      configs: new Map([
        ["users", { schema: {} as any, keyPath: "id" }],
        ["notes", { schema: {} as any, keyPath: "id" }],
      ]),
      state: {
        clock: { ms: 1000, seq: 0 },
        collections: {
          users: { "1": userDoc },
          notes: { "1": noteDoc },
        },
        tombstones: {},
      },
    };

    const handles = createReadHandles(deps);

    // Verify handles exist for each collection
    expect(handles["users"]).toBeDefined();
    expect(handles["notes"]).toBeDefined();

    // Verify get() works on each handle
    expect(handles["users"]?.get("1")).toEqual({ id: "1", name: "Alice" });
    expect(handles["notes"]?.get("1")).toEqual({ id: "1", content: "Note 1" });

    // Verify list() works on each handle
    expect(handles["users"]?.list()).toHaveLength(1);
    expect(handles["notes"]?.list()).toHaveLength(1);
  });

  test("handles empty collections", () => {
    const deps: ReadDependencies = {
      configs: new Map([["users", { schema: {} as any, keyPath: "id" }]]),
      state: {
        clock: { ms: 1000, seq: 0 },
        collections: {},
        tombstones: {},
      },
    };

    const handles = createReadHandles(deps);

    expect(handles["users"]).toBeDefined();
    expect(handles["users"]?.list()).toHaveLength(0);
    expect(handles["users"]?.get("1")).toBeUndefined();
  });

  test("respects tombstones across collections", () => {
    const stamp1 = makeStamp(1000, 0);
    const userDoc = atomizeDocument({ id: "1", name: "Alice" }, stamp1);

    const deps: ReadDependencies = {
      configs: new Map([["users", { schema: {} as any, keyPath: "id" }]]),
      state: {
        clock: { ms: 1000, seq: 0 },
        collections: {
          users: { "1": userDoc },
        },
        tombstones: { "1": stamp1 }, // Document is deleted
      },
    };

    const handles = createReadHandles(deps);

    expect(handles["users"]?.get("1")).toBeUndefined();
    expect(handles["users"]?.list()).toHaveLength(0);
  });
});
