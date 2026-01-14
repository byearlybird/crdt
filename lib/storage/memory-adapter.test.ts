import { describe, test, expect } from "vitest";
import { MemoryAdapter } from "./memory-adapter";
import type { Clock } from "../core/clock";
import type { Document, Collection } from "../core/collection";

describe("MemoryAdapter", () => {
  describe("initialization", () => {
    test("initializes with default clock and empty collections", async () => {
      const adapter = new MemoryAdapter({ collections: ["users", "notes"] });
      const state = await adapter.initialize();

      expect(state.clock).toEqual(
        expect.objectContaining({
          ms: expect.any(Number),
          seq: 0,
        }),
      );

      expect(state.collections).toEqual({
        users: { documents: {}, tombstones: {} },
        notes: { documents: {}, tombstones: {} },
      });
    });

    test("initializes with no collections", async () => {
      const adapter = new MemoryAdapter({ collections: [] });
      const state = await adapter.initialize();

      expect(state.collections).toEqual({});
    });
  });

  describe("clock operations", () => {
    test("gets and sets clock", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const newClock: Clock = { ms: 12345, seq: 42 };
      await adapter.setClock(newClock);

      const clock = await adapter.getClock();
      expect(clock).toEqual({ ms: 12345, seq: 42 });
    });

    test("returns copy of clock (not reference)", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const clock1 = await adapter.getClock();
      clock1.ms = 99999;

      const clock2 = await adapter.getClock();
      expect(clock2.ms).not.toBe(99999);
    });
  });

  describe("document operations", () => {
    test("sets and gets document", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const doc: Document = {
        name: { "~value": "Alice", "~stamp": "stamp1" },
        age: { "~value": 30, "~stamp": "stamp1" },
      };

      await adapter.setDocument("users", "alice", doc);
      const retrieved = await adapter.getDocument("users", "alice");

      expect(retrieved).toEqual(doc);
    });

    test("returns undefined for non-existent document", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const doc = await adapter.getDocument("users", "nonexistent");
      expect(doc).toBeUndefined();
    });

    test("returns undefined for document in non-existent collection", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const doc = await adapter.getDocument("nonexistent", "alice");
      expect(doc).toBeUndefined();
    });

    test("updates existing document", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const doc1: Document = {
        name: { "~value": "Alice", "~stamp": "stamp1" },
      };
      await adapter.setDocument("users", "alice", doc1);

      const doc2: Document = {
        name: { "~value": "Alice Updated", "~stamp": "stamp2" },
      };
      await adapter.setDocument("users", "alice", doc2);

      const retrieved = await adapter.getDocument("users", "alice");
      expect(retrieved).toEqual(doc2);
    });

    test("deletes document", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const doc: Document = {
        name: { "~value": "Alice", "~stamp": "stamp1" },
      };
      await adapter.setDocument("users", "alice", doc);
      await adapter.deleteDocument("users", "alice");

      const retrieved = await adapter.getDocument("users", "alice");
      expect(retrieved).toBeUndefined();
    });

    test("throws when setting document in non-existent collection", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const doc: Document = {
        name: { "~value": "Alice", "~stamp": "stamp1" },
      };

      await expect(adapter.setDocument("nonexistent", "alice", doc)).rejects.toThrow(
        'Collection "nonexistent" not found',
      );
    });

    test("throws when deleting document in non-existent collection", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      await expect(adapter.deleteDocument("nonexistent", "alice")).rejects.toThrow(
        'Collection "nonexistent" not found',
      );
    });

    test("returns copy of document (not reference)", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const doc: Document = {
        name: { "~value": "Alice", "~stamp": "stamp1" },
      };
      await adapter.setDocument("users", "alice", doc);

      const retrieved = await adapter.getDocument("users", "alice");
      if (retrieved) {
        retrieved.name["~value"] = "Modified";
      }

      const retrieved2 = await adapter.getDocument("users", "alice");
      expect(retrieved2?.name["~value"]).toBe("Alice");
    });
  });

  describe("tombstone operations", () => {
    test("sets and gets tombstone", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      await adapter.setTombstone("users", "alice", "deletion-stamp-123");
      const tombstone = await adapter.getTombstone("users", "alice");

      expect(tombstone).toBe("deletion-stamp-123");
    });

    test("returns undefined for non-existent tombstone", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const tombstone = await adapter.getTombstone("users", "nonexistent");
      expect(tombstone).toBeUndefined();
    });

    test("returns undefined for tombstone in non-existent collection", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const tombstone = await adapter.getTombstone("nonexistent", "alice");
      expect(tombstone).toBeUndefined();
    });

    test("updates existing tombstone", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      await adapter.setTombstone("users", "alice", "stamp1");
      await adapter.setTombstone("users", "alice", "stamp2");

      const tombstone = await adapter.getTombstone("users", "alice");
      expect(tombstone).toBe("stamp2");
    });

    test("throws when setting tombstone in non-existent collection", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      await expect(adapter.setTombstone("nonexistent", "alice", "stamp1")).rejects.toThrow(
        'Collection "nonexistent" not found',
      );
    });
  });

  describe("collection operations", () => {
    test("gets entire collection", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const doc1: Document = {
        name: { "~value": "Alice", "~stamp": "stamp1" },
      };
      const doc2: Document = {
        name: { "~value": "Bob", "~stamp": "stamp2" },
      };

      await adapter.setDocument("users", "alice", doc1);
      await adapter.setDocument("users", "bob", doc2);
      await adapter.setTombstone("users", "charlie", "stamp3");

      const collection = await adapter.getCollection("users");

      expect(collection).toEqual({
        documents: {
          alice: doc1,
          bob: doc2,
        },
        tombstones: {
          charlie: "stamp3",
        },
      });
    });

    test("returns empty collection for non-existent collection", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const collection = await adapter.getCollection("nonexistent");
      expect(collection).toEqual({ documents: {}, tombstones: {} });
    });

    test("sets entire collection", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const collection: Collection = {
        documents: {
          alice: { name: { "~value": "Alice", "~stamp": "stamp1" } },
          bob: { name: { "~value": "Bob", "~stamp": "stamp2" } },
        },
        tombstones: {
          charlie: "stamp3",
        },
      };

      await adapter.setCollection("users", collection);
      const retrieved = await adapter.getCollection("users");

      expect(retrieved).toEqual(collection);
    });

    test("replaces existing collection", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const collection1: Collection = {
        documents: {
          alice: { name: { "~value": "Alice", "~stamp": "stamp1" } },
        },
        tombstones: {},
      };
      await adapter.setCollection("users", collection1);

      const collection2: Collection = {
        documents: {
          bob: { name: { "~value": "Bob", "~stamp": "stamp2" } },
        },
        tombstones: {
          alice: "stamp3",
        },
      };
      await adapter.setCollection("users", collection2);

      const retrieved = await adapter.getCollection("users");
      expect(retrieved).toEqual(collection2);
    });

    test("gets document IDs", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const doc1: Document = {
        name: { "~value": "Alice", "~stamp": "stamp1" },
      };
      const doc2: Document = {
        name: { "~value": "Bob", "~stamp": "stamp2" },
      };

      await adapter.setDocument("users", "alice", doc1);
      await adapter.setDocument("users", "bob", doc2);

      const ids = await adapter.getDocumentIds("users");
      expect(ids).toEqual(expect.arrayContaining(["alice", "bob"]));
      expect(ids).toHaveLength(2);
    });

    test("returns empty array for non-existent collection", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const ids = await adapter.getDocumentIds("nonexistent");
      expect(ids).toEqual([]);
    });

    test("returns copy of collection (not reference)", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const collection: Collection = {
        documents: {
          alice: { name: { "~value": "Alice", "~stamp": "stamp1" } },
        },
        tombstones: {},
      };
      await adapter.setCollection("users", collection);

      const retrieved = await adapter.getCollection("users");
      retrieved.documents["alice"].name["~value"] = "Modified";

      const retrieved2 = await adapter.getCollection("users");
      expect(retrieved2.documents["alice"]?.name["~value"]).toBe("Alice");
    });
  });

  describe("transactions", () => {
    test("commits all operations atomically", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      await adapter.transaction(async (tx) => {
        tx.setDocument("users", "alice", {
          name: { "~value": "Alice", "~stamp": "stamp1" },
        });
        tx.setDocument("users", "bob", {
          name: { "~value": "Bob", "~stamp": "stamp2" },
        });
        tx.setTombstone("users", "charlie", "stamp3");
        tx.setClock({ ms: 12345, seq: 42 });
      });

      const alice = await adapter.getDocument("users", "alice");
      const bob = await adapter.getDocument("users", "bob");
      const tombstone = await adapter.getTombstone("users", "charlie");
      const clock = await adapter.getClock();

      expect(alice).toEqual({
        name: { "~value": "Alice", "~stamp": "stamp1" },
      });
      expect(bob).toEqual({
        name: { "~value": "Bob", "~stamp": "stamp2" },
      });
      expect(tombstone).toBe("stamp3");
      expect(clock).toEqual({ ms: 12345, seq: 42 });
    });

    test("rolls back all operations on error", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      // Set initial state
      await adapter.setDocument("users", "alice", {
        name: { "~value": "Alice", "~stamp": "stamp1" },
      });
      await adapter.setClock({ ms: 1000, seq: 1 });

      // Attempt transaction that fails
      await expect(
        adapter.transaction(async (tx) => {
          tx.setDocument("users", "bob", {
            name: { "~value": "Bob", "~stamp": "stamp2" },
          });
          tx.setClock({ ms: 2000, seq: 2 });
          throw new Error("Transaction failed");
        }),
      ).rejects.toThrow("Transaction failed");

      // Verify rollback
      const bob = await adapter.getDocument("users", "bob");
      const clock = await adapter.getClock();
      const alice = await adapter.getDocument("users", "alice");

      expect(bob).toBeUndefined();
      expect(clock).toEqual({ ms: 1000, seq: 1 });
      expect(alice).toEqual({
        name: { "~value": "Alice", "~stamp": "stamp1" },
      });
    });

    test("returns transaction function result", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      const result = await adapter.transaction(async (tx) => {
        tx.setDocument("users", "alice", {
          name: { "~value": "Alice", "~stamp": "stamp1" },
        });
        return { success: true, count: 1 };
      });

      expect(result).toEqual({ success: true, count: 1 });
    });

    test("can delete documents in transaction", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });

      await adapter.setDocument("users", "alice", {
        name: { "~value": "Alice", "~stamp": "stamp1" },
      });

      await adapter.transaction(async (tx) => {
        tx.deleteDocument("users", "alice");
        tx.setTombstone("users", "alice", "deletion-stamp");
      });

      const alice = await adapter.getDocument("users", "alice");
      const tombstone = await adapter.getTombstone("users", "alice");

      expect(alice).toBeUndefined();
      expect(tombstone).toBe("deletion-stamp");
    });
  });

  describe("close", () => {
    test("closes without errors", async () => {
      const adapter = new MemoryAdapter({ collections: ["users"] });
      await expect(adapter.close()).resolves.toBeUndefined();
    });
  });
});
