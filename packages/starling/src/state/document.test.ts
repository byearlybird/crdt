import { expect, test } from "bun:test";
import { type DocumentState, makeDocument, mergeDocuments } from "./document";
import { makeResource } from "./resource";
import type { AnyObject } from "./types";

test("makeDocument creates an empty document", () => {
	const collection = makeDocument<AnyObject>("items");

	expect(Object.keys(collection.resources).length).toBe(0);
	expect(collection.tombstones).toEqual({});
});

test("mergeDocuments works when both documents are empty", () => {
	const into = makeDocument<AnyObject>("items");
	const from = makeDocument<AnyObject>("items");
	const currentClock = "01941f297c00000000a1b2c3";

	const result = mergeDocuments(into, from, currentClock);

	expect(Object.keys(result.document.resources).length).toBe(0);
	expect(result.latest).toBe(currentClock);
	expect(result.changes.added.size).toBe(0);
	expect(result.changes.updated.size).toBe(0);
	expect(result.changes.deleted.size).toBe(0);
});

test("mergeDocuments finds the newest timestamp from resources", () => {
	const into = makeDocument<AnyObject>("items");
	const from = makeDocument<AnyObject>("items");
	from.resources.item1 = makeResource(
		"item1",
		{ name: "Test" },
		"01941f32a3c0000002e5f6a7",
	);

	const currentClock = "01941f297c00000000a1b2c3";
	const result = mergeDocuments(into, from, currentClock);

	// Should return the newest timestamp between current time and resources
	expect(result.latest).toBe("01941f32a3c0000002e5f6a7");
});

test("mergeDocuments uses current time when no resources exist", () => {
	const into = makeDocument<AnyObject>("items");
	const from = makeDocument<AnyObject>("items");

	const currentClock = "01941f32a3c0000002e5f6a7";
	const result = mergeDocuments(into, from, currentClock);

	// Should use currentClock since there are no resources
	expect(result.latest).toBe(currentClock);
});

test("mergeDocuments adds new resources from incoming document", () => {
	const into = makeDocument<AnyObject>("items");
	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"000192e85b8c000001a1b2c3",
			), // Older timestamp
		},
		tombstones: {},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	expect(Object.keys(result.document.resources).length).toBe(1);
	expect(Object.values(result.document.resources)[0]?.id).toBe("doc-1");
	expect(result.changes.added.size).toBe(1);
	expect(result.changes.added.has("doc-1")).toBe(true);
	expect(result.changes.updated.size).toBe(0);
	expect(result.changes.deleted.size).toBe(0);
});

test("mergeDocuments updates resources that already exist", () => {
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice", age: 30 },
				"01941f297c00000000a1b2c3",
			),
		},
		tombstones: {},
	};
	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource("doc-1", { age: 31 }, "01941f2e0fe0000001c3d4e5"),
		},
		tombstones: {},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	expect(Object.keys(result.document.resources).length).toBe(1);
	expect(result.changes.added.size).toBe(0);
	expect(result.changes.updated.size).toBe(1);
	expect(result.changes.updated.has("doc-1")).toBe(true);
	expect(result.changes.deleted.size).toBe(0);
});

test("mergeDocuments marks resources as deleted", () => {
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"01941f297c00000000a1b2c3",
			),
		},
		tombstones: {},
	};

	// Remote has tombstone for doc-1
	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {},
		tombstones: {
			"doc-1": "01941f2e0fe0000001c3d4e5",
		},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	// Resource should be removed (tombstoned)
	expect(Object.keys(result.document.resources).length).toBe(0);
	expect(result.document.tombstones["doc-1"]).toBe("01941f2e0fe0000001c3d4e5");
	expect(result.changes.added.size).toBe(0);
	expect(result.changes.updated.size).toBe(0);
	expect(result.changes.deleted.size).toBe(1);
	expect(result.changes.deleted.has("doc-1")).toBe(true);
});

test("mergeDocuments keeps deleted resources deleted even when updates arrive", () => {
	// Local has tombstone for doc-1
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {},
		tombstones: {
			"doc-1": "01941f2b50c0000001b2c3d4",
		},
	};

	// Remote has updated resource for doc-1
	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice Updated" },
				"01941f2e0fe0000002c3d4e5",
			),
		},
		tombstones: {},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	// Deletion is final: resource should stay tombstoned, not restored
	expect(Object.keys(result.document.resources).length).toBe(0);
	expect(result.document.tombstones["doc-1"]).toBe("01941f2b50c0000001b2c3d4");
	expect(result.changes.added.size).toBe(0);
	expect(result.changes.updated.size).toBe(0);
	expect(result.changes.deleted.size).toBe(0);
});

test("mergeDocuments does not add resources that are already deleted", () => {
	const into = makeDocument<AnyObject>("items");

	// Remote has a tombstone (no resource)
	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {},
		tombstones: {
			"doc-1": "01941f2e0fe0000001c3d4e5",
		},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	// Tombstone should be merged, no resources added
	expect(Object.keys(result.document.resources).length).toBe(0);
	expect(result.document.tombstones["doc-1"]).toBe("01941f2e0fe0000001c3d4e5");
	expect(result.changes.added.size).toBe(0);
	expect(result.changes.updated.size).toBe(0);
	expect(result.changes.deleted.size).toBe(0);
});

test("mergeDocuments handles adding, updating, and deleting resources at the same time", () => {
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice", age: 30 },
				"01941f297c00000000a1b2c3",
			),
			"doc-2": makeResource(
				"doc-2",
				{ name: "Bob", age: 25 },
				"01941f297c00000000a1b2c3",
			),
		},
		tombstones: {},
	};

	// Remote has doc-2 tombstoned, doc-1 updated, doc-3 added
	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource("doc-1", { age: 31 }, "01941f2e0fe0000001c3d4e5"),
			"doc-3": makeResource(
				"doc-3",
				{ name: "Charlie", age: 28 },
				"01941f2e0fe0000001c3d4e5",
			),
		},
		tombstones: {
			"doc-2": "01941f2e0fe0000001c3d4e5",
		},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	// doc-1 updated, doc-2 deleted, doc-3 added
	expect(Object.keys(result.document.resources).length).toBe(2);
	expect(result.document.tombstones["doc-2"]).toBe("01941f2e0fe0000001c3d4e5");
	expect(result.changes.added.size).toBe(1);
	expect(result.changes.added.has("doc-3")).toBe(true);
	expect(result.changes.updated.size).toBe(1);
	expect(result.changes.updated.has("doc-1")).toBe(true);
	expect(result.changes.deleted.size).toBe(1);
	expect(result.changes.deleted.has("doc-2")).toBe(true);
});

test("mergeDocuments keeps resources that only exist in the first document", () => {
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"01941f297c00000000a1b2c3",
			),
			"doc-2": makeResource(
				"doc-2",
				{ name: "Bob" },
				"01941f297c00000000a1b2c3",
			),
		},
		tombstones: {},
	};
	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-3": makeResource(
				"doc-3",
				{ name: "Charlie" },
				"01941f2e0fe0000001c3d4e5",
			),
		},
		tombstones: {},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	expect(Object.keys(result.document.resources).length).toBe(3);
	const ids = Object.values(result.document.resources).map((doc) => doc.id);
	expect(ids).toContain("doc-1");
	expect(ids).toContain("doc-2");
	expect(ids).toContain("doc-3");
});

test("mergeDocuments does not mark resources as updated when nothing changed", () => {
	const resource = makeResource(
		"doc-1",
		{ name: "Alice" },
		"000192e85b8c000001a1b2c3",
	);

	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": resource,
		},
		tombstones: {},
	};

	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": resource, // Same reference
		},
		tombstones: {},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	expect(Object.keys(result.document.resources).length).toBe(1);
	expect(result.changes.added.size).toBe(0);
	expect(result.changes.updated.size).toBe(0);
	expect(result.changes.deleted.size).toBe(0);
});

test("mergeDocuments picks newest value for each field in nested objects", () => {
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice", email: "alice@old.com" },
				"01941f297c00000000a1b2c3",
			),
		},
		tombstones: {},
	};

	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ email: "alice@new.com" },
				"01941f2e0fe0000001c3d4e5",
			),
		},
		tombstones: {},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	expect(Object.keys(result.document.resources).length).toBe(1);
	expect(result.changes.updated.size).toBe(1);
	expect(result.changes.updated.has("doc-1")).toBe(true);
});

test("mergeDocuments finds no changes when content is the same", () => {
	const eventstamp = "01941f297c00000000a1b2c3";
	const resource = makeResource(
		"doc-1",
		{ name: "Alice", age: 30 },
		eventstamp,
	);

	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": resource,
		},
		tombstones: {},
	};

	// Create a copy of the document with identical content but different object reference
	const fromResource = makeResource(
		"doc-1",
		{ name: "Alice", age: 30 },
		eventstamp,
	);

	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": fromResource,
		},
		tombstones: {},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	// Should have 1 resource but no changes tracked
	expect(Object.keys(result.document.resources).length).toBe(1);
	expect(result.changes.added.size).toBe(0);
	expect(result.changes.updated.size).toBe(0);
	expect(result.changes.deleted.size).toBe(0);
});

// Document-level cache validation tests

test("mergeDocuments: newest document timestamp matches newest resource timestamp", () => {
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"01941f297c00000000a1b2c3",
			),
			"doc-2": makeResource(
				"doc-2",
				{ name: "Bob" },
				"01941f2b50c0000000e5f6a7",
			),
		},
		tombstones: {},
	};

	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-3": makeResource(
				"doc-3",
				{ name: "Charlie" },
				"01941f2e0fe0000001c3d4e5",
			),
		},
		tombstones: {},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	// Should be the newest resource eventstamp
	expect(result.latest).toBe("01941f2e0fe0000001c3d4e5");
});

test("mergeDocuments: updates newest timestamp when adding new resource", () => {
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"01941f297c00000000a1b2c3",
			),
		},
		tombstones: {},
	};

	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-2": makeResource(
				"doc-2",
				{ name: "Bob" },
				"01941f32a3c0000002a9b0c1",
			),
		},
		tombstones: {},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	expect(result.latest).toBe("01941f32a3c0000002a9b0c1");
});

test("mergeDocuments: updates newest timestamp when changing a resource", () => {
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice", age: 30 },
				"01941f297c00000000a1b2c3",
			),
		},
		tombstones: {},
	};

	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource("doc-1", { age: 31 }, "01941f30cf00000001a7b8c9"),
		},
		tombstones: {},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	expect(result.latest).toBe("01941f30cf00000001a7b8c9");
});

test("mergeDocuments: updates newest timestamp when deleting a resource", () => {
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"01941f297c00000000a1b2c3",
			),
		},
		tombstones: {},
	};

	// Remote has tombstone for doc-1
	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {},
		tombstones: {
			"doc-1": "01941f347880000003b1c2d3",
		},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	// Should include the deletion eventstamp
	expect(result.latest).toBe("01941f347880000003b1c2d3");
});

test("mergeDocuments: finds newest timestamp across multiple resources", () => {
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"01941f2a6660000000a1b2c3",
			),
			"doc-2": makeResource(
				"doc-2",
				{ name: "Bob" },
				"01941f2c3b20000001c3d4e5",
			),
		},
		tombstones: {},
	};

	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-3": makeResource(
				"doc-3",
				{ name: "Charlie" },
				"01941f2e0fe0000001e5f6a7",
			),
			"doc-4": makeResource(
				"doc-4",
				{ name: "Dave" },
				"01941f2fe4a0000002a7b8c9",
			),
		},
		tombstones: {},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	// Should be the newest resource eventstamp across all resources
	expect(result.latest).toBe("01941f2fe4a0000002a7b8c9");
});

test("mergeDocuments: uses new resource timestamp when it's newer than current document", () => {
	// Edge case: document latest is older than a resource's latest
	// This can happen with inconsistent document construction
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {},
		tombstones: {},
	};

	// Resource has a later timestamp than the document's latest
	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"01941f2e0fe0000001e5f6a7", // Later than from.latest
			),
		},
		tombstones: {},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	// Document's latest should be updated to the resource's timestamp
	expect(result.latest).toBe("01941f2e0fe0000001e5f6a7");
	expect(result.changes.added.size).toBe(1);
	expect(result.changes.added.has("doc-1")).toBe(true);
});

test("mergeDocuments: uses merged resource timestamp when it's newer than current document", () => {
	// Edge case: merged resource's latest exceeds both documents' latest
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"01941f297c00000000a1b2c3",
			),
		},
		tombstones: {},
	};

	// from document has resource with later timestamp but document latest is older
	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ age: 31 },
				"01941f32a3c0000001a9b0c1", // Much later than document latest
			),
		},
		tombstones: {},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	// Document's latest should be updated to merged resource's timestamp
	expect(result.latest).toBe("01941f32a3c0000001a9b0c1");
	expect(result.changes.updated.size).toBe(1);
});

// Tombstone merge tests
test("mergeDocuments combines deletion records and keeps newest timestamps", () => {
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {},
		tombstones: {
			"doc-1": "01941f32a3c0000001e5f6a7",
			"doc-2": "01941f2e0fe0000001c3d4e5",
		},
	};

	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {},
		tombstones: {
			"doc-2": "01941f3737a0000001a7b8c9", // Newer
			"doc-3": "01941f347880000001a9b0c1",
		},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	// Should keep all tombstones, using LWW for doc-2
	expect(Object.keys(result.document.tombstones)).toHaveLength(3);
	expect(result.document.tombstones["doc-1"]).toBe("01941f32a3c0000001e5f6a7");
	expect(result.document.tombstones["doc-2"]).toBe("01941f3737a0000001a7b8c9"); // Newer wins
	expect(result.document.tombstones["doc-3"]).toBe("01941f347880000001a9b0c1");
});

test("mergeDocuments deletion prevents bringing back resource from incoming data", () => {
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {},
		tombstones: {
			"doc-1": "01941f32a3c0000001e5f6a7",
		},
	};

	// Remote has resource that we deleted
	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"01941f2e0fe0000001c3d4e5",
			),
		},
		tombstones: {},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	// Resource should NOT be resurrected
	expect(result.document.resources["doc-1"]).toBeUndefined();
	expect(result.document.tombstones["doc-1"]).toBe("01941f32a3c0000001e5f6a7");
	expect(result.changes.added.size).toBe(0);
	expect(result.changes.deleted.size).toBe(0);
});

test("mergeDocuments incoming deletion prevents bringing back local resource", () => {
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"01941f2e0fe0000001c3d4e5",
			),
		},
		tombstones: {},
	};

	// Remote has tombstone for resource we still have
	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {},
		tombstones: {
			"doc-1": "01941f32a3c0000001e5f6a7",
		},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	// Resource should be removed, tombstone kept
	expect(result.document.resources["doc-1"]).toBeUndefined();
	expect(result.document.tombstones["doc-1"]).toBe("01941f32a3c0000001e5f6a7");
	expect(result.changes.deleted.size).toBe(1);
	expect(result.changes.deleted.has("doc-1")).toBe(true);
});

test("mergeDocuments deletion timestamps update the newest document timestamp", () => {
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"01941f2e0fe0000001c3d4e5",
			),
		},
		tombstones: {},
	};

	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {},
		tombstones: {
			"doc-2": "01941f3bcb80000001b1c2d3", // Newest eventstamp
		},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	// Document latest should be updated from tombstone eventstamp
	expect(result.latest).toBe("01941f3bcb80000001b1c2d3");
});

test("mergeDocuments handles when both documents delete the same resource", () => {
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {},
		tombstones: {
			"doc-1": "01941f32a3c0000001e5f6a7",
		},
	};

	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {},
		tombstones: {
			"doc-1": "01941f30cf00000001a7b8c9", // Older
		},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	// Should keep newer tombstone eventstamp
	expect(result.document.tombstones["doc-1"]).toBe("01941f32a3c0000001e5f6a7");
	expect(result.changes.deleted.size).toBe(0); // No new deletion
});

test("mergeDocuments empty tombstones merge correctly", () => {
	const into: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"01941f2e0fe0000001c3d4e5",
			),
		},
		tombstones: {},
	};

	const from: DocumentState<AnyObject> = {
		type: "items",
		resources: {
			"doc-2": makeResource(
				"doc-2",
				{ name: "Bob" },
				"01941f32a3c0000001e5f6a7",
			),
		},
		tombstones: {},
	};

	const result = mergeDocuments(into, from, "01941f297c00000000a1b2c3");

	// Should merge resources normally, no tombstones
	expect(Object.keys(result.document.resources)).toHaveLength(2);
	expect(Object.keys(result.document.tombstones)).toHaveLength(0);
});
