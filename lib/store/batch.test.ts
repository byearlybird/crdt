import { describe, expect, test } from "vitest";
import { type Document, type DocumentId, makeDocument, makeStamp, parseDocument } from "../core";
import { executeBatch, type BatchDependencies } from "./batch";
import { createTimestampGenerator, noteSchema, profileSchema, userSchema } from "./test-utils";
import type { AnyObject, CollectionConfig } from "./schema";

// Concrete StoreConfig types that properly extend StoreConfig
type SingleCollectionConfig = Record<"users", CollectionConfig<AnyObject>>;

// Helper to create test dependencies
function createTestDeps(
  options: {
    collections?: Array<{ name: string; schema: any; keyPath?: string }>;
    documents?: Record<string, Record<DocumentId, Document>>;
    tombstones?: Record<DocumentId, string>;
  } = {},
): BatchDependencies {
  const configs = new Map();
  const collections = options.collections || [{ name: "users", schema: userSchema, keyPath: "id" }];

  for (const col of collections) {
    configs.set(col.name, { schema: col.schema, keyPath: col.keyPath || "id" });
  }

  return {
    configs,
    documents: options.documents || {},
    tombstones: options.tombstones || {},
    tick: createTimestampGenerator(),
  };
}

describe("executeBatch", () => {
  describe("basic operations", () => {
    test("returns callback return value", () => {
      const deps = createTestDeps();

      const result = executeBatch(() => {
        return "test-result";
      }, deps);

      expect(result.value).toBe("test-result");
      expect(result.changes).toBeNull();
    });

    test("returns null changes when nothing modified", () => {
      const deps = createTestDeps({
        documents: {
          users: {
            "1": makeDocument({ id: "1", name: "Alice" }, makeStamp(500, 0)),
          },
        },
      });

      const result = executeBatch<SingleCollectionConfig, any>(({ users }) => {
        // Read-only operation
        return users.get("1");
      }, deps);

      expect(result.value).toEqual({ id: "1", name: "Alice" });
      expect(result.changes).toBeNull();
    });

    test("executes callback with batch handles", () => {
      const deps = createTestDeps();
      let handlesReceived: any = null;

      executeBatch((handles) => {
        handlesReceived = handles;
        // Access a collection to trigger proxy
        handles["users"]?.list();
      }, deps);

      expect(handlesReceived).toBeDefined();
      expect(typeof handlesReceived["users"]).toBe("object");
    });
  });

  describe("write operations & change tracking", () => {
    test("tracks changes for add() operation", () => {
      const deps = createTestDeps();

      const result = executeBatch((handles) => {
        handles["users"]!.add({ id: "1", name: "Alice" });
      }, deps);

      expect(result.changes).not.toBeNull();
      expect(result.changes!.documents["users"]).toBeDefined();
      expect(result.changes!.documents["users"]!["1"]).toBeDefined();
      expect(parseDocument(result.changes!.documents["users"]!["1"]!)).toEqual({
        id: "1",
        name: "Alice",
      });
      expect(result.changes!.event["users"]).toBe(true);
    });

    test("tracks changes for update() operation", () => {
      const existingDoc = makeDocument({ id: "1", name: "Alice" }, makeStamp(500, 0));
      const deps = createTestDeps({
        documents: {
          users: { "1": existingDoc },
        },
      });

      const result = executeBatch((handles) => {
        handles["users"]!.update("1", { name: "Bob" });
      }, deps);

      expect(result.changes).not.toBeNull();
      expect(result.changes!.documents["users"]).toBeDefined();
      expect(result.changes!.documents["users"]!["1"]).toBeDefined();
      expect(parseDocument(result.changes!.documents["users"]!["1"]!)).toEqual({
        id: "1",
        name: "Bob",
      });
      expect(result.changes!.event["users"]).toBe(true);
    });

    test("tracks changes for remove() operation", () => {
      const existingDoc = makeDocument({ id: "1", name: "Alice" }, makeStamp(500, 0));
      const deps = createTestDeps({
        documents: {
          users: { "1": existingDoc },
        },
      });

      const result = executeBatch((handles) => {
        handles["users"]!.remove("1");
      }, deps);

      expect(result.changes).not.toBeNull();
      expect(result.changes!.tombstones["1"]).toBeDefined();
      expect(result.changes!.documents["users"]!["1"]).toBeUndefined();
      expect(result.changes!.event["users"]).toBe(true);
    });

    test("tracks changes across multiple collections", () => {
      const deps = createTestDeps({
        collections: [
          { name: "users", schema: userSchema },
          { name: "notes", schema: noteSchema },
        ],
        documents: {
          users: {},
          notes: { "1": makeDocument({ id: "1", content: "Note 1" }, makeStamp(500, 0)) },
        },
      });

      const result = executeBatch((handles) => {
        handles["users"]!.add({ id: "1", name: "Alice" });
        handles["notes"]!.update("1", { content: "Updated Note" });
      }, deps);

      expect(result.changes).not.toBeNull();
      expect(result.changes!.event["users"]).toBe(true);
      expect(result.changes!.event["notes"]).toBe(true);
      expect(result.changes!.documents["users"]).toBeDefined();
      expect(result.changes!.documents["notes"]).toBeDefined();
    });
  });

  describe("copy-on-write isolation", () => {
    test("isolates document changes (copy-on-write)", () => {
      const existingDoc = makeDocument({ id: "1", name: "Alice" }, makeStamp(500, 0));
      const deps = createTestDeps({
        documents: {
          users: { "1": existingDoc },
        },
      });

      const result = executeBatch((handles) => {
        handles["users"]!.update("1", { name: "Bob" });
      }, deps);

      // Original deps.documents should be unchanged
      expect(parseDocument(deps.documents["users"]!["1"]!)).toEqual({
        id: "1",
        name: "Alice",
      });

      // Batch result should have the updated document
      expect(parseDocument(result.changes!.documents["users"]!["1"]!)).toEqual({
        id: "1",
        name: "Bob",
      });
    });

    test("lazy collection document initialization", () => {
      const deps = createTestDeps({
        collections: [
          { name: "users", schema: userSchema },
          { name: "notes", schema: noteSchema },
          { name: "profiles", schema: profileSchema },
        ],
        documents: {
          users: { "1": makeDocument({ id: "1", name: "Alice" }, makeStamp(500, 0)) },
          notes: { "1": makeDocument({ id: "1", content: "Note" }, makeStamp(500, 0)) },
          profiles: {
            "1": makeDocument({ id: "1", name: "Alice", profile: {} }, makeStamp(500, 0)),
          },
        },
      });

      const result = executeBatch((handles) => {
        // Only access users collection
        handles["users"]!.list();
      }, deps);

      // Since nothing was modified, changes should be null
      expect(result.changes).toBeNull();
    });

    test("tombstones are copied at batch start", () => {
      const deps = createTestDeps({
        tombstones: {
          existing: "500:0",
        },
      });

      const result = executeBatch((handles) => {
        handles["users"]!.remove("new");
      }, deps);

      // Original tombstones unchanged
      expect(deps.tombstones).toEqual({ existing: "500:0" });

      // Result has both existing and new tombstone
      expect(result.changes!.tombstones["existing"]).toBe("500:0");
      expect(result.changes!.tombstones["new"]).toBeDefined();
    });
  });

  describe("read operations during batch", () => {
    test("read operations reflect batch writes", () => {
      const deps = createTestDeps();

      const result = executeBatch((handles) => {
        handles["users"]!.add({ id: "1", name: "Alice" });
        const retrieved = handles["users"]!.get("1");
        const allUsers = handles["users"]!.list();
        return { retrieved, allUsers };
      }, deps);

      expect(result.value["retrieved"]).toEqual({ id: "1", name: "Alice" });
      expect(result.value["allUsers"]).toHaveLength(1);
      expect(result.value["allUsers"][0]).toEqual({ id: "1", name: "Alice" });
    });

    test("read operations respect tombstones", () => {
      const existingDoc = makeDocument({ id: "1", name: "Alice" }, makeStamp(500, 0));
      const deps = createTestDeps({
        documents: {
          users: { "1": existingDoc },
        },
      });

      const result = executeBatch((handles) => {
        handles["users"]!.remove("1");
        const retrieved = handles["users"]!.get("1");
        const allUsers = handles["users"]!.list();
        return { retrieved, allUsers };
      }, deps);

      expect(result.value["retrieved"]).toBeUndefined();
      expect(result.value["allUsers"]).toHaveLength(0);
    });

    test("combines read and write handles correctly", () => {
      const existingDoc = makeDocument({ id: "1", name: "Alice" }, makeStamp(500, 0));
      const deps = createTestDeps({
        documents: {
          users: { "1": existingDoc },
        },
      });

      const result = executeBatch((handles) => {
        // Read methods
        const before = handles["users"]!.get("1");
        const listBefore = handles["users"]!.list();

        // Write methods
        handles["users"]!.update("1", { name: "Bob" });
        handles["users"]!.add({ id: "2", name: "Charlie" });

        // Read after write
        const after = handles["users"]!.get("1");
        const listAfter = handles["users"]!.list();

        return { before, listBefore, after, listAfter };
      }, deps);

      expect(result.value["before"]).toEqual({ id: "1", name: "Alice" });
      expect(result.value["listBefore"]).toHaveLength(1);
      expect(result.value["after"]).toEqual({ id: "1", name: "Bob" });
      expect(result.value["listAfter"]).toHaveLength(2);
    });
  });

  describe("proxy behavior", () => {
    test("proxy throws error for non-existent collection", () => {
      const deps = createTestDeps();

      expect(() => {
        executeBatch((handles: any) => {
          handles.invalidCollection.list();
        }, deps);
      }).toThrow('Collection "invalidCollection" not found');
    });

    test("proxy returns undefined for non-string properties", () => {
      const deps = createTestDeps();

      const result = executeBatch((handles: any) => {
        const symbolProp = Symbol("test");
        return handles[symbolProp];
      }, deps);

      expect(result.value).toBeUndefined();
    });

    test("proxy caches initialized handles", () => {
      const deps = createTestDeps({
        documents: {
          users: { "1": makeDocument({ id: "1", name: "Alice" }, makeStamp(500, 0)) },
        },
      });

      executeBatch((handles) => {
        const firstAccess = handles["users"]!.get("1");
        const secondAccess = handles["users"]!.get("1");
        // Both should return the same data
        expect(firstAccess).toEqual(secondAccess);
      }, deps);
    });
  });

  describe("integration tests", () => {
    test("complete batch workflow (add + update + remove)", () => {
      const existingDoc = makeDocument({ id: "1", name: "Alice" }, makeStamp(500, 0));
      const deps = createTestDeps({
        documents: {
          users: { "1": existingDoc },
        },
      });

      const result = executeBatch((handles) => {
        handles["users"]!.add({ id: "2", name: "Bob" });
        handles["users"]!.update("1", { name: "Alice Updated" });
        handles["users"]!.remove("2");
        return handles["users"]!.list();
      }, deps);

      expect(result.changes).not.toBeNull();
      expect(result.changes!.event["users"]).toBe(true);
      expect(result.changes!.documents["users"]!["1"]).toBeDefined();
      const parsed = parseDocument(result.changes!.documents["users"]!["1"]!);
      expect(parsed["name"]).toBe("Alice Updated");
      expect(result.changes!.documents["users"]!["2"]).toBeUndefined();
      expect(result.changes!.tombstones["2"]).toBeDefined();

      // List should only show user 1 (user 2 was removed)
      expect(result.value).toHaveLength(1);
      expect(result.value[0]!["id"]).toBe("1");
    });

    test("batch with no changes returns proper null result", () => {
      const deps = createTestDeps();

      const result = executeBatch(() => {
        return 42;
      }, deps);

      expect(result.value).toBe(42);
      expect(result.changes).toBeNull();
    });

    test("multiple collections with mixed operations", () => {
      const deps = createTestDeps({
        collections: [
          { name: "users", schema: userSchema },
          { name: "notes", schema: noteSchema },
        ],
        documents: {
          users: { "1": makeDocument({ id: "1", name: "Alice" }, makeStamp(500, 0)) },
          notes: { "1": makeDocument({ id: "1", content: "Note 1" }, makeStamp(500, 0)) },
        },
      });

      const result = executeBatch((handles) => {
        handles["users"]!.add({ id: "2", name: "Bob" });
        handles["notes"]!.remove("1");
        handles["users"]!.update("1", { name: "Alice Updated" });
        handles["notes"]!.add({ id: "2", content: "Note 2" });
      }, deps);

      expect(result.changes).not.toBeNull();
      expect(result.changes!.event["users"]).toBe(true);
      expect(result.changes!.event["notes"]).toBe(true);

      expect(result.changes!.documents["users"]).toBeDefined();
      expect(result.changes!.documents["notes"]).toBeDefined();

      expect(result.changes!.documents["users"]!["1"]).toBeDefined();
      expect(result.changes!.documents["users"]!["2"]).toBeDefined();
      expect(result.changes!.documents["notes"]!["1"]).toBeUndefined();
      expect(result.changes!.documents["notes"]!["2"]).toBeDefined();
    });

    test("callback return value preserved with changes", () => {
      const deps = createTestDeps();

      const result = executeBatch((handles) => {
        handles["users"]!.add({ id: "1", name: "Alice" });
        return { success: true, userId: "1" };
      }, deps);

      expect(result.value).toEqual({ success: true, userId: "1" });
      expect(result.changes).not.toBeNull();
      expect(result.changes!.documents["users"]!["1"]).toBeDefined();
    });

    test("timestamp generation via tick()", () => {
      const deps = createTestDeps();
      const stamps: string[] = [];

      // Track tick calls by wrapping the tick function
      const originalTick = deps.tick;
      deps.tick = () => {
        const stamp = originalTick();
        stamps.push(stamp);
        return stamp;
      };

      executeBatch((handles) => {
        handles["users"]!.add({ id: "1", name: "Alice" });
        handles["users"]!.add({ id: "2", name: "Bob" });
        handles["users"]!.remove("1");
      }, deps);

      // Three operations should generate three timestamps
      expect(stamps).toHaveLength(3);
      expect(stamps[0]).toBeDefined();
      expect(stamps[1]).toBeDefined();
      expect(stamps[2]).toBeDefined();
    });
  });

  describe("edge cases", () => {
    test("accessing collection initializes only that collection's documents", () => {
      const deps = createTestDeps({
        collections: [
          { name: "users", schema: userSchema },
          { name: "notes", schema: noteSchema },
          { name: "profiles", schema: profileSchema },
        ],
        documents: {
          users: { "1": makeDocument({ id: "1", name: "Alice" }, makeStamp(500, 0)) },
          notes: { "1": makeDocument({ id: "1", content: "Note" }, makeStamp(500, 0)) },
          profiles: {
            "1": makeDocument({ id: "1", name: "Alice", profile: {} }, makeStamp(500, 0)),
          },
        },
      });

      executeBatch((handles) => {
        // Access only users collection
        handles["users"]!.list();
        // notes and profiles are never accessed
      }, deps);

      // No assertion needed - just verifying no errors occur
      // The lazy initialization ensures only accessed collections are copied
    });

    test("event object only includes changed collections", () => {
      const deps = createTestDeps({
        collections: [
          { name: "users", schema: userSchema },
          { name: "notes", schema: noteSchema },
          { name: "profiles", schema: profileSchema },
        ],
        documents: {
          users: {},
          notes: {},
          profiles: {},
        },
      });

      const result = executeBatch((handles) => {
        handles["users"]!.add({ id: "1", name: "Alice" });
        handles["notes"]!.add({ id: "1", content: "Note" });
        // profiles not modified
      }, deps);

      expect(result.changes).not.toBeNull();
      expect(result.changes!.event["users"]).toBe(true);
      expect(result.changes!.event["notes"]).toBe(true);
      expect(result.changes!.event["profiles"]).toBeUndefined();
      expect(Object.keys(result.changes!.event)).toHaveLength(2);
    });

    test("removed documents deleted from collection but tombstone persists", () => {
      const existingDoc = makeDocument({ id: "1", name: "Alice" }, makeStamp(500, 0));
      const deps = createTestDeps({
        documents: {
          users: { "1": existingDoc },
        },
      });

      const result = executeBatch((handles) => {
        handles["users"]!.remove("1");
      }, deps);

      expect(result.changes).not.toBeNull();
      expect(result.changes!.documents["users"]!["1"]).toBeUndefined();
      expect(result.changes!.tombstones["1"]).toBeDefined();
      expect(result.changes!.event["users"]).toBe(true);
    });

    test("handles empty collections", () => {
      const deps = createTestDeps({
        documents: {
          users: {},
        },
      });

      const result = executeBatch((handles) => {
        return handles["users"]!.list();
      }, deps);

      expect(result.value).toEqual([]);
      expect(result.changes).toBeNull();
    });

    test("handles nested objects in documents", () => {
      const deps = createTestDeps({
        collections: [{ name: "profiles", schema: profileSchema }],
        documents: {
          profiles: {},
        },
      });

      const result = executeBatch((handles) => {
        handles["profiles"]!.add({
          id: "1",
          name: "Alice",
          profile: { age: 30, email: "alice@example.com" },
        });
        return handles["profiles"]!.get("1");
      }, deps);

      expect(result.value).toEqual({
        id: "1",
        name: "Alice",
        profile: { age: 30, email: "alice@example.com" },
      });
      expect(result.changes).not.toBeNull();
    });

    test("update on non-existent document returns silently", () => {
      const deps = createTestDeps({
        documents: {
          users: {},
        },
      });

      const result = executeBatch((handles) => {
        handles["users"]!.update("nonexistent", { name: "Bob" });
      }, deps);

      // No changes should be recorded
      expect(result.changes).toBeNull();
    });

    test("remove creates tombstone even for non-existent document", () => {
      const deps = createTestDeps({
        documents: {
          users: {},
        },
      });

      const result = executeBatch((handles) => {
        handles["users"]!.remove("nonexistent");
      }, deps);

      expect(result.changes).not.toBeNull();
      expect(result.changes!.tombstones["nonexistent"]).toBeDefined();
      expect(result.changes!.event["users"]).toBe(true);
    });
  });
});
