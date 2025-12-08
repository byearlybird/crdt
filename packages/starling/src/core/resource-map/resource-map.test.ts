import { describe, expect, test } from "bun:test";
import { MIN_EVENTSTAMP } from "../clock/eventstamp";
import type { AnyObject, Document } from "../document/document";
import { makeResource } from "../document/resource";
import { createMap, createMapFromDocument } from "./resource-map";

describe("ResourceMap", () => {
	describe("constructor", () => {
		test("creates empty ResourceMap with default eventstamp", () => {
			const crdt = createMap("default");
			const collection = crdt.toDocument();
			expect(collection.data).toHaveLength(0);
			expect(collection.meta.latest).toBeDefined();
		});

		test("creates ResourceMap with initial eventstamp and forwards clock", () => {
			const eventstamp = "2025-01-01T00:00:00.000Z|0001|abcd";
			const crdt = createMap("default", new Map(), eventstamp);
			const collection = crdt.toDocument();
			// Clock should be at least at the provided eventstamp
			expect(collection.meta.latest >= eventstamp).toBe(true);
		});

		test("creates ResourceMap with existing documents", () => {
			const doc1 = makeResource(
				"items",
				"id1",
				{ name: "Alice" },
				MIN_EVENTSTAMP,
			);
			const doc2 = makeResource(
				"items",
				"id2",
				{ name: "Bob" },
				MIN_EVENTSTAMP,
			);
			const map = new Map([
				[doc1.id, doc1},
				[doc2.id, doc2},
			]);

			const crdt = createMap<{ name: string }>("items", map);
			expect(crdt.has("id1")).toBe(true);
			expect(crdt.has("id2")).toBe(true);
			expect(crdt.get("id1")?.attributes).toEqual({ name: "Alice" });
			expect(crdt.get("id2")?.attributes).toEqual({ name: "Bob" });
		});
	});

	describe("has", () => {
		test("returns true for existing documents", () => {
			const doc = makeResource(
				"items",
				"id1",
				{ name: "Alice" },
				MIN_EVENTSTAMP,
			);
			const crdt = createMap<{ name: string }>(
				"items",
				new Map([[doc.id, doc]]),
			);

			expect(crdt.has("id1")).toBe(true);
		});

		test("returns false for non-existing documents", () => {
			const crdt = createMap("default");
			expect(crdt.has("id1")).toBe(false);
		});
	});

	describe("entries", () => {
		test("iterates over all resources as [id, resource] tuples", () => {
			const doc1 = makeResource(
				"items",
				"id1",
				{ name: "Alice" },
				MIN_EVENTSTAMP,
			);
			const doc2 = makeResource(
				"items",
				"id2",
				{ name: "Bob" },
				MIN_EVENTSTAMP,
			);
			const crdt = createMap<{ name: string }>(
				"items",
				new Map([
					[doc1.id, doc1},
					[doc2.id, doc2},
				]),
			);

			const entries = Array.from(crdt.entries());

			expect(entries.length).toBe(2);
			const ids = entries.map(([id]) => id);
			expect(ids).toContain("id1");
			expect(ids).toContain("id2");
		});

		test("returns empty iterator for empty map", () => {
			const crdt = createMap("default");
			const entries = Array.from(crdt.entries());
			expect(entries.length).toBe(0);
		});
	});

	describe("get", () => {
		test("returns document for existing id", () => {
			const doc = makeResource(
				"items",
				"id1",
				{ name: "Alice" },
				MIN_EVENTSTAMP,
			);
			const crdt = createMap<{ name: string }>(
				"items",
				new Map([[doc.id, doc]]),
			);

			expect(crdt.get("id1")?.attributes).toEqual({ name: "Alice" });
		});

		test("returns undefined for non-existing id", () => {
			const crdt = createMap("default");
			expect(crdt.get("id1")).toBeUndefined();
		});
	});

	describe("set", () => {
		test("creates new document", () => {
			const crdt = createMap<{ name: string }>("items", new Map());
			crdt.set("id1", { name: "Alice" });

			expect(crdt.has("id1")).toBe(true);
			expect(crdt.get("id1")?.attributes).toEqual({ name: "Alice" });
		});

		test("merges with existing document", () => {
			const crdt = createMap<{ name: string; age: number }>("items", new Map());
			crdt.set("id1", { name: "Alice", age: 30 });
			crdt.set("id1", { age: 31 });

			const merged = crdt.get("id1")?.attributes;
			expect(merged).toBeDefined();
			// Name should be preserved from original, age should be updated
			expect(merged?.name).toBe("Alice");
			expect(merged?.age).toBe(31);
		});

		test("overwrites with full object", () => {
			const crdt = createMap<{ name: string }>("items", new Map());
			crdt.set("id1", { name: "Alice" });
			crdt.set("id1", { name: "Bob" });

			expect(crdt.get("id1")?.attributes).toEqual({ name: "Bob" });
		});

		test("last-write-wins for concurrent sets", () => {
			const crdt = createMap<{ name: string }>("items", new Map());
			crdt.set("id1", { name: "Alice" });
			crdt.set("id1", { name: "Bob" });
			crdt.set("id1", { name: "Charlie" });

			const merged = crdt.get("id1")?.attributes;
			expect(merged?.name).toBe("Charlie");
		});
	});

	describe("delete", () => {
		test("soft-deletes existing document", () => {
			const crdt = createMap<{ name: string }>("items", new Map());
			crdt.set("id1", { name: "Alice" });
			crdt.delete("id1");

			// ResourceMap returns deleted documents, just marks them with deletedAt
			expect(crdt.has("id1")).toBe(true);
			expect(crdt.get("id1")).toBeDefined();
			expect(crdt.get("id1")?.meta.deletedAt).not.toBeNull();
		});

		test("does nothing if document doesn't exist", () => {
			const crdt = createMap("default");
			crdt.delete("id1");

			expect(crdt.has("id1")).toBe(false);
		});

		test("generates unique eventstamp for each delete", () => {
			const crdt = createMap<{ name: string }>("items", new Map());
			crdt.set("id1", { name: "Alice" });
			crdt.delete("id1");
			const collection1 = crdt.toDocument();

			// Re-add and delete again
			crdt.set("id1", { name: "Alice" });
			crdt.delete("id1");
			const collection2 = crdt.toDocument();

			// Collections should have different eventstamps due to second delete
			expect(collection2.meta.latest > collection1.meta.latest).toBe(true);
		});
	});

	describe("cloneMap", () => {
		test("returns a copy of the internal encoded map", () => {
			const crdt = createMap<{ name: string }>("items", new Map());
			crdt.set("id1", { name: "Alice" });
			const clonedMap = crdt.cloneMap();

			expect(clonedMap).not.toBe(crdt.cloneMap());
			expect(clonedMap.size).toBe(1);
			expect(clonedMap.get("id1")).toBeDefined();
			expect(clonedMap.get("id1")?.id).toBe("id1");
		});

		test("modifications to cloned map don't affect original", () => {
			const crdt = createMap<{ name: string }>("items", new Map());
			crdt.set("id1", { name: "Alice" });
			const clonedMap = crdt.cloneMap();
			clonedMap.delete("id1");

			expect(crdt.has("id1")).toBe(true);
		});
	});

	describe("snapshot", () => {
		test("returns collection with documents and eventstamp", () => {
			const doc1 = makeResource(
				"items",
				"id1",
				{ name: "Alice" },
				MIN_EVENTSTAMP,
			);
			const doc2 = makeResource(
				"items",
				"id2",
				{ name: "Bob" },
				MIN_EVENTSTAMP,
			);
			const crdt = createMap(
				"items",
				new Map([
					[doc1.id, doc1},
					[doc2.id, doc2},
				]),
			);

			const collection = crdt.toDocument();

			expect(collection.data).toHaveLength(2);
			expect(collection.meta.latest).toBeDefined();
		});

		test("includes deleted documents in collection", () => {
			const crdt = createMap<{ name: string }>("items", new Map());
			crdt.set("id1", { name: "Alice" });
			crdt.delete("id1");

			const collection = crdt.toDocument();

			expect(collection.data).toHaveLength(1);
			expect(collection.data[0]?.meta.deletedAt).not.toBeNull();
		});

		test("eventstamp reflects latest operation", () => {
			const crdt = createMap<{ name: string }>(
				"items",
				new Map(),
				"2025-01-01T00:00:00.000Z|0001|abcd",
			);
			crdt.set("id1", { name: "Alice" });
			crdt.delete("id1");

			const collection = crdt.toDocument();

			// Eventstamp should be from the delete operation, which is more recent
			expect(
				collection.meta.latest > "2025-01-01T00:00:00.000Z|0001|abcd",
			).toBe(true);
		});
	});

	describe("fromSnapshot", () => {
		test("creates ResourceMap from collection", () => {
			const collection: Document<AnyObject> = {
				version: "1.0",
			type: "items",
				latest: "2025-01-01T00:00:00.000Z|0001|abcd",,
				resources: {
					makeResource("items", "id1", { name: "Alice" }, MIN_EVENTSTAMP),
					makeResource("items", "id2", { name: "Bob" }, MIN_EVENTSTAMP),
				},
			};

			const crdt = createMapFromDocument<{ name: string }>(
				"default",
				collection,
			);
			expect(crdt.has("id1")).toBe(true);
			expect(crdt.has("id2")).toBe(true);
			// Clock forwards to at least the provided eventstamp
			expect(crdt.toDocument().meta.latest >= collection.meta.latest).toBe(
				true,
			);
		});

		test("preserves deleted documents", () => {
			const deletedDoc = makeResource(
				"items",
				"id1",
				{ name: "Alice" },
				MIN_EVENTSTAMP,
			);
			deletedDoc.meta.deletedAt = "2025-01-01T00:00:01.000Z|0001|abcd";

			const collection: Document<AnyObject> = {
				version: "1.0",
			type: "items",
				latest: "2025-01-01T00:00:01.000Z|0001|abcd",,
				resources: {deletedDoc},
			};

			const crdt = createMapFromDocument<{ name: string }>(
				"default",
				collection,
			);
			// ResourceMap returns deleted documents, just marks them with deletedAt
			expect(crdt.has("id1")).toBe(true);
			expect(crdt.get("id1")).toBeDefined();
			expect(crdt.get("id1")?.meta.deletedAt).not.toBeNull();
		});

		test("round-trip preserves data", () => {
			const original = createMap<{ name: string; age: number }>(
				"items",
				new Map(),
				"2025-01-01T00:00:00.000Z|0001|abcd",
			);
			original.set("id1", { name: "Alice", age: 30 });

			const collection = original.toDocument();
			const restored = createMapFromDocument<{
				name: string;
				age: number;
			}>("default", collection);
			expect(restored.has("id1")).toBe(true);
			expect(restored.get("id1")?.attributes).toEqual({
				name: "Alice",
				age: 30,
			});
		});
	});

	describe("convergence", () => {
		test("multiple replicas converge to same state", () => {
			// Replica 1: Add Alice, update age
			const replica1 = createMap<{ name: string; age: number }>(
				"users",
				new Map(),
			);
			replica1.set("id1", { name: "Alice", age: 30 });
			replica1.set("id1", { age: 31 });

			// Replica 2: Add Alice with different age
			const replica2 = createMap<{ name: string; age: number }>(
				"users",
				new Map(),
			);
			replica2.set("id1", { name: "Alice", age: 25 });

			// Merge replica1 into replica2
			const collection1 = replica1.toDocument();
			for (const encodedDoc of collection1.data) {
				replica2.set(encodedDoc.id, encodedDoc.attributes as any);
			}

			// Age should be 31 (most recent update)
			const merged = replica2.get("id1")?.attributes;
			expect(merged?.age).toBe(31);
		});

		test("concurrent updates resolve via LWW", () => {
			const crdt = createMap<{ name?: string; age?: number }>(
				"items",
				new Map(),
			);
			// Two concurrent updates to different fields
			crdt.set("id1", { name: "Alice" });
			crdt.set("id1", { age: 30 });

			const doc = crdt.get("id1")?.attributes;
			// Both fields should be present
			expect(doc?.name).toBe("Alice");
			expect(doc?.age).toBe(30);
		});

		test("delete after update preserves deletion", () => {
			const crdt = createMap<{ name: string }>("items", new Map());
			// Add document
			crdt.set("id1", { name: "Alice" });

			// Delete it
			crdt.delete("id1");

			// Try to update (with older eventstamp via plain update)
			crdt.set("id1", { name: "Bob" });

			// Should still be deleted (delete eventstamp is newer)
			const collection = crdt.toDocument();
			const doc = collection.data.find((d) => d.id === "id1");
			expect(doc?.meta.deletedAt).not.toBeNull();
		});
	});

	describe("clock forwarding", () => {
		test("clock forwards when loading newer eventstamp", () => {
			const collection: Document<AnyObject> = {
				version: "1.0",
			type: "items",
				latest: "2025-01-01T00:00:10.000Z|0001|abcd",,
				resources: {},
			};

			const restored = createMapFromDocument<{ name: string }>(
				"default",
				collection,
			);
			restored.set("id1", { name: "Alice" });

			// New operations should have eventstamps >= the loaded eventstamp
			restored.delete("id1");
			const collectionAfter = restored.toDocument();
			expect(collectionAfter.meta.latest >= collection.meta.latest).toBe(true);
		});
	});

	describe("merge", () => {
		test("merges new documents from a collection", () => {
			const crdt = createMap<{ name: string }>("items", new Map());
			crdt.set("id1", { name: "Alice" });

			const remoteCollection: Document<AnyObject> = {
				version: "1.0",
			type: "items",
				meta: { latest: MIN_EVENTSTAMP },
				resources: {makeResource("items", "id2", { name: "Bob" }, MIN_EVENTSTAMP)},
			};

			const result = crdt.merge(remoteCollection);

			expect(crdt.has("id1")).toBe(true);
			expect(crdt.has("id2")).toBe(true);
			expect(crdt.get("id1")?.attributes).toEqual({ name: "Alice" });
			expect(crdt.get("id2")?.attributes).toEqual({ name: "Bob" });

			// Check merge result
			expect(result.changes.added.has("id2")).toBe(true);
			expect(result.changes.updated.size).toBe(0);
		});

		test("applies field-level last-write-wins during merge", () => {
			// Create a local document with an older eventstamp
			const localEventstamp = "2025-01-01T00:00:00.000Z|0001|aaaa";
			const localDoc = makeResource(
				"items",
				"id1",
				{ name: "Alice", age: 30 },
				localEventstamp,
			);
			const crdt = createMap<{ name: string; age: number }>(
				"items",
				new Map([["id1", localDoc]]),
				localEventstamp,
			);

			// Create a remote document with a newer eventstamp for one field
			const laterEventstamp = "2025-01-01T00:00:05.000Z|0001|efgh";
			const remoteCollection: Document<AnyObject> = {
				version: "1.0",
			type: "items",
				meta: { latest: laterEventstamp },
				resources: {makeResource("items", "id1", { age: 31 }, laterEventstamp)},
			};

			const result = crdt.merge(remoteCollection);

			const merged = crdt.get("id1")?.attributes;
			expect(merged?.name).toBe("Alice"); // Local value preserved
			expect(merged?.age).toBe(31); // Remote value wins (later eventstamp)

			// Check merge result - should be an update since id1 already existed
			expect(result.changes.updated.has("id1")).toBe(true);
			expect(result.changes.added.size).toBe(0);
		});

		test("handles deleted documents in remote collection", () => {
			const crdt = createMap<{ name: string }>("items", new Map());
			crdt.set("id1", { name: "Alice" });

			const deletedDoc = makeResource(
				"items",
				"id1",
				{ name: "Alice" },
				MIN_EVENTSTAMP,
			);
			const deletionEventstamp = "2025-01-01T00:00:05.000Z|0001|efgh";
			deletedDoc.meta.deletedAt = deletionEventstamp;

			const remoteCollection: Document<AnyObject> = {
				version: "1.0",
			type: "items",
				meta: { latest: deletionEventstamp },
				resources: {deletedDoc},
			};

			const result = crdt.merge(remoteCollection);

			// Document is soft-deleted
			const collection = crdt.toDocument();
			const doc = collection.data.find((d) => d.id === "id1");
			expect(doc?.meta.deletedAt).not.toBeNull();

			// Check merge result - deletion is tracked in deleted set
			expect(result.changes.deleted.has("id1")).toBe(true);
		});

		test("forwards clock to remote eventstamp during merge", () => {
			const crdt = createMap<{ name: string }>(
				"items",
				new Map(),
				MIN_EVENTSTAMP,
			);
			const futureEventstamp = "2025-01-01T00:00:10.000Z|0001|abcd";
			const remoteCollection: Document<AnyObject> = {
				version: "1.0",
			type: "items",
				meta: { latest: futureEventstamp },
				resources: {},
			};

			const result = crdt.merge(remoteCollection);

			// Check merge result has forwarded clock
			expect(result.document.meta.latest >= futureEventstamp).toBe(true);

			// Add a new document after merge
			crdt.set("id1", { name: "Alice" });
			const collection = crdt.toDocument();

			// New eventstamp should be >= remote eventstamp
			expect(collection.meta.latest >= futureEventstamp).toBe(true);
		});

		test("merge is idempotent", () => {
			const crdt = createMap<{ name: string; age: number }>("items", new Map());
			crdt.set("id1", { name: "Alice", age: 30 });

			const remoteCollection: Document<AnyObject> = {
				version: "1.0",
			type: "items",
				meta: { latest: MIN_EVENTSTAMP },
				resources: {
					makeResource(
						"items",
						"id2",
						{ name: "Bob", age: 25 },
						MIN_EVENTSTAMP,
					),
				},
			};

			crdt.merge(remoteCollection);
			const collection2 = crdt.toDocument();

			// Merge again
			crdt.merge(remoteCollection);
			const collection3 = crdt.toDocument();

			// Results should be identical
			expect(collection2.data.length).toBe(collection3.data.length);
			expect(crdt.get("id1")?.attributes).toEqual({ name: "Alice", age: 30 });
			expect(crdt.get("id2")?.attributes).toEqual({ name: "Bob", age: 25 });
		});

		test("merge preserves local data when remote is older", () => {
			const localEventstamp = "2025-01-01T00:00:10.000Z|0001|abcd";
			const localDoc = makeResource(
				"items",
				"id1",
				{ name: "Alice" },
				localEventstamp,
			);
			const crdt = createMap("items", new Map([["id1", localDoc]]));
			const olderEventstamp = "2025-01-01T00:00:05.000Z|0001|efgh";
			const remoteCollection: Document<AnyObject> = {
				version: "1.0",
			type: "items",
				meta: { latest: olderEventstamp },
				resources: {makeResource("items", "id1", { name: "Bob" }, olderEventstamp)},
			};

			crdt.merge(remoteCollection);

			// Local value should be preserved (newer eventstamp)
			expect(crdt.get("id1")?.attributes).toEqual({ name: "Alice" });
		});

		test("merge combines documents from multiple replicas", () => {
			// Simulate two replicas that have diverged
			const replica1 = createMap<{ text: string; completed: boolean }>(
				"todos",
				new Map(),
			);
			replica1.set("todo1", { text: "Task 1", completed: false });
			replica1.set("todo2", { text: "Task 2", completed: false });

			const replica2 = createMap<{ text: string; completed: boolean }>(
				"todos",
				new Map(),
			);
			replica2.set("todo3", { text: "Task 3", completed: false });
			replica2.set("todo1", { completed: true }); // Update existing

			// Merge replica2's changes into replica1
			const collection2 = replica2.toDocument();
			replica1.merge(collection2);

			// replica1 should now have all three todos
			expect(replica1.has("todo1")).toBe(true);
			expect(replica1.has("todo2")).toBe(true);
			expect(replica1.has("todo3")).toBe(true);

			// And todo1 should reflect the completion status
			expect(replica1.get("todo1")?.attributes?.completed).toBe(true);
		});
	});
});
