import { expect, test } from "bun:test";
import {
	type AnyObject,
	makeDocument,
	mergeDocuments,
	type StarlingDocument,
} from "./document";
import { makeResource } from "./resource";

test("makeDocument returns empty collection with given eventstamp", () => {
	const eventstamp = "2025-01-01T00:00:00.000Z|0000|a1b2";
	const collection = makeDocument<AnyObject>("items", eventstamp);

	expect(Object.keys(collection.resources).length).toBe(0);
	expect(collection.latest).toBe(eventstamp);
	expect(collection.version).toBe("1.0");
});

test("mergeDocuments with empty collections", () => {
	const into = makeDocument<AnyObject>(
		"items",
		"2025-01-01T00:00:00.000Z|0000|a1b2",
	);
	const from = makeDocument<AnyObject>(
		"items",
		"2025-01-01T00:05:00.000Z|0001|c3d4",
	);

	const result = mergeDocuments(into, from);

	expect(Object.keys(result.document.resources).length).toBe(0);
	expect(result.document.latest).toBe("2025-01-01T00:05:00.000Z|0001|c3d4");
	expect(result.changes.added.size).toBe(0);
	expect(result.changes.updated.size).toBe(0);
	expect(result.changes.deleted.size).toBe(0);
});

test("mergeDocuments forwards clock to newer eventstamp", () => {
	const into = makeDocument<AnyObject>(
		"items",
		"2025-01-01T00:00:00.000Z|0000|a1b2",
	);
	const from = makeDocument<AnyObject>(
		"items",
		"2025-01-01T00:10:00.000Z|0002|e5f6",
	);

	const result = mergeDocuments(into, from);

	expect(result.document.latest).toBe("2025-01-01T00:10:00.000Z|0002|e5f6");
});

test("mergeDocuments keeps older eventstamp when into is newer", () => {
	const into = makeDocument<AnyObject>(
		"items",
		"2025-01-01T00:10:00.000Z|0002|e5f6",
	);
	const from = makeDocument<AnyObject>(
		"items",
		"2025-01-01T00:00:00.000Z|0000|a1b2",
	);

	const result = mergeDocuments(into, from);

	expect(result.document.latest).toBe("2025-01-01T00:10:00.000Z|0002|e5f6");
});

test("mergeDocuments adds new document from source", () => {
	const into = makeDocument<AnyObject>(
		"items",
		"2025-01-01T00:00:00.000Z|0000|a1b2",
	);
	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:05:00.000Z|0001|c3d4",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"2025-01-01T00:05:00.000Z|0001|c3d4",
			),
		},
	};

	const result = mergeDocuments(into, from);

	expect(Object.keys(result.document.resources).length).toBe(1);
	expect(Object.values(result.document.resources)[0]?.id).toBe("doc-1");
	expect(result.changes.added.size).toBe(1);
	expect(result.changes.added.has("doc-1")).toBe(true);
	expect(result.changes.updated.size).toBe(0);
	expect(result.changes.deleted.size).toBe(0);
});

test("mergeDocuments updates existing document", () => {
	const into: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:00:00.000Z|0000|a1b2",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice", age: 30 },
				"2025-01-01T00:00:00.000Z|0000|a1b2",
			),
		},
	};
	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:05:00.000Z|0001|c3d4",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ age: 31 },
				"2025-01-01T00:05:00.000Z|0001|c3d4",
			),
		},
	};

	const result = mergeDocuments(into, from);

	expect(Object.keys(result.document.resources).length).toBe(1);
	expect(result.changes.added.size).toBe(0);
	expect(result.changes.updated.size).toBe(1);
	expect(result.changes.updated.has("doc-1")).toBe(true);
	expect(result.changes.deleted.size).toBe(0);
});

test("mergeDocuments marks document as deleted", () => {
	const into: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:00:00.000Z|0000|a1b2",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"2025-01-01T00:00:00.000Z|0000|a1b2",
			),
		},
	};

	const deletedDoc = makeResource(
		"doc-1",
		{ name: "Alice" },
		"2025-01-01T00:00:00.000Z|0000|a1b2",
	);
	deletedDoc.meta.deletedAt = "2025-01-01T00:05:00.000Z|0001|c3d4";

	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:05:00.000Z|0001|c3d4",
		resources: {
			"doc-1": deletedDoc,
		},
	};

	const result = mergeDocuments(into, from);

	expect(Object.keys(result.document.resources).length).toBe(1);
	expect(Object.values(result.document.resources)[0]?.meta.deletedAt).toBe(
		"2025-01-01T00:05:00.000Z|0001|c3d4",
	);
	expect(result.changes.added.size).toBe(0);
	expect(result.changes.updated.size).toBe(0);
	expect(result.changes.deleted.size).toBe(1);
	expect(result.changes.deleted.has("doc-1")).toBe(true);
});

test("mergeDocuments keeps deleted document deleted on update", () => {
	const deletedDoc = makeResource(
		"doc-1",
		{ name: "Alice" },
		"2025-01-01T00:00:00.000Z|0000|a1b2",
	);
	deletedDoc.meta.deletedAt = "2025-01-01T00:02:00.000Z|0001|b2c3";

	const into: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:02:00.000Z|0001|b2c3",
		resources: {
			"doc-1": deletedDoc,
		},
	};

	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:05:00.000Z|0002|c3d4",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice Updated" },
				"2025-01-01T00:05:00.000Z|0002|c3d4",
			),
		},
	};

	const result = mergeDocuments(into, from);

	// Deletion is final: document stays deleted, but data is merged internally
	expect(Object.keys(result.document.resources).length).toBe(1);
	expect(Object.values(result.document.resources)[0]?.meta.deletedAt).toBe(
		"2025-01-01T00:02:00.000Z|0001|b2c3",
	);
	expect(result.changes.added.size).toBe(0);
	expect(result.changes.updated.size).toBe(0);
	expect(result.changes.deleted.size).toBe(0);
});

test("mergeDocuments does not track deleted documents as added", () => {
	const into = makeDocument<AnyObject>(
		"items",
		"2025-01-01T00:00:00.000Z|0000|a1b2",
	);

	const deletedDoc = makeResource(
		"doc-1",
		{ name: "Alice" },
		"2025-01-01T00:05:00.000Z|0001|c3d4",
	);
	deletedDoc.meta.deletedAt = "2025-01-01T00:05:00.000Z|0001|c3d4";

	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:05:00.000Z|0001|c3d4",
		resources: {
			"doc-1": deletedDoc,
		},
	};

	const result = mergeDocuments(into, from);

	expect(Object.keys(result.document.resources).length).toBe(1);
	expect(result.changes.added.size).toBe(0);
	expect(result.changes.updated.size).toBe(0);
	expect(result.changes.deleted.size).toBe(0);
});

test("mergeDocuments merges multiple documents with mixed operations", () => {
	const into: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:00:00.000Z|0000|a1b2",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice", age: 30 },
				"2025-01-01T00:00:00.000Z|0000|a1b2",
			),
			"doc-2": makeResource(
				"doc-2",
				{ name: "Bob", age: 25 },
				"2025-01-01T00:00:00.000Z|0000|a1b2",
			),
		},
	};

	const deletedDoc = makeResource(
		"doc-2",
		{ name: "Bob" },
		"2025-01-01T00:00:00.000Z|0000|a1b2",
	);
	deletedDoc.meta.deletedAt = "2025-01-01T00:05:00.000Z|0001|c3d4";

	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:05:00.000Z|0001|c3d4",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ age: 31 },
				"2025-01-01T00:05:00.000Z|0001|c3d4",
			),
			"doc-2": deletedDoc,
			"doc-3": makeResource(
				"doc-3",
				{ name: "Charlie", age: 28 },
				"2025-01-01T00:05:00.000Z|0001|c3d4",
			),
		},
	};

	const result = mergeDocuments(into, from);

	expect(Object.keys(result.document.resources).length).toBe(3);
	expect(result.changes.added.size).toBe(1);
	expect(result.changes.added.has("doc-3")).toBe(true);
	expect(result.changes.updated.size).toBe(1);
	expect(result.changes.updated.has("doc-1")).toBe(true);
	expect(result.changes.deleted.size).toBe(1);
	expect(result.changes.deleted.has("doc-2")).toBe(true);
});

test("mergeDocuments preserves documents only in base collection", () => {
	const into: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:00:00.000Z|0000|a1b2",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"2025-01-01T00:00:00.000Z|0000|a1b2",
			),
			"doc-2": makeResource(
				"doc-2",
				{ name: "Bob" },
				"2025-01-01T00:00:00.000Z|0000|a1b2",
			),
		},
	};
	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:05:00.000Z|0001|c3d4",
		resources: {
			"doc-3": makeResource(
				"doc-3",
				{ name: "Charlie" },
				"2025-01-01T00:05:00.000Z|0001|c3d4",
			),
		},
	};

	const result = mergeDocuments(into, from);

	expect(Object.keys(result.document.resources).length).toBe(3);
	const ids = Object.values(result.document.resources).map((doc) => doc.id);
	expect(ids).toContain("doc-1");
	expect(ids).toContain("doc-2");
	expect(ids).toContain("doc-3");
});

test("mergeDocuments does not mark unchanged documents as updated", () => {
	const doc = makeResource(
		"doc-1",
		{ name: "Alice" },
		"2025-01-01T00:00:00.000Z|0000|a1b2",
	);

	const into: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:00:00.000Z|0000|a1b2",
		resources: {
			"doc-1": doc,
		},
	};
	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:00:00.000Z|0000|a1b2",
		resources: {
			"doc-1": doc,
		},
	};

	const result = mergeDocuments(into, from);

	expect(Object.keys(result.document.resources).length).toBe(1);
	expect(result.changes.added.size).toBe(0);
	expect(result.changes.updated.size).toBe(0);
	expect(result.changes.deleted.size).toBe(0);
});

test("mergeDocuments field-level LWW for nested objects", () => {
	const into: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:00:00.000Z|0000|a1b2",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice", email: "alice@old.com" },
				"2025-01-01T00:00:00.000Z|0000|a1b2",
			),
		},
	};

	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:05:00.000Z|0001|c3d4",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ email: "alice@new.com" },
				"2025-01-01T00:05:00.000Z|0001|c3d4",
			),
		},
	};

	const result = mergeDocuments(into, from);

	expect(Object.keys(result.document.resources).length).toBe(1);
	expect(result.changes.updated.size).toBe(1);
	expect(result.changes.updated.has("doc-1")).toBe(true);
});

test("mergeDocuments detects no changes when content is identical", () => {
	const eventstamp = "2025-01-01T00:00:00.000Z|0000|a1b2";
	const resource = makeResource(
		"doc-1",
		{ name: "Alice", age: 30 },
		eventstamp,
	);

	const into: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: eventstamp,
		resources: {
			"doc-1": resource,
		},
	};

	// Create a copy of the document with identical content but different object reference
	const fromResource = makeResource(
		"doc-1",
		{ name: "Alice", age: 30 },
		eventstamp,
	);

	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: eventstamp,
		resources: {
			"doc-1": fromResource,
		},
	};

	const result = mergeDocuments(into, from);

	// Should have 1 resource but no changes tracked
	expect(Object.keys(result.document.resources).length).toBe(1);
	expect(result.changes.added.size).toBe(0);
	expect(result.changes.updated.size).toBe(0);
	expect(result.changes.deleted.size).toBe(0);
});

// Document-level cache validation tests

test("mergeDocuments: document meta.latest matches max of resource meta.latest values", () => {
	const into: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:00:00.000Z|0000|a1b2",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"2025-01-01T00:00:00.000Z|0000|a1b2",
			),
			"doc-2": makeResource(
				"doc-2",
				{ name: "Bob" },
				"2025-01-01T00:02:00.000Z|0000|e5f6",
			),
		},
	};

	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:05:00.000Z|0001|c3d4",
		resources: {
			"doc-3": makeResource(
				"doc-3",
				{ name: "Charlie" },
				"2025-01-01T00:05:00.000Z|0001|c3d4",
			),
		},
	};

	const result = mergeDocuments(into, from);

	// Should be the newest resource eventstamp
	expect(result.document.latest).toBe("2025-01-01T00:05:00.000Z|0001|c3d4");
});

test("mergeDocuments: document meta.latest after adding new resource", () => {
	const into: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:00:00.000Z|0000|a1b2",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"2025-01-01T00:00:00.000Z|0000|a1b2",
			),
		},
	};

	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:10:00.000Z|0002|i9j0",
		resources: {
			"doc-2": makeResource(
				"doc-2",
				{ name: "Bob" },
				"2025-01-01T00:10:00.000Z|0002|i9j0",
			),
		},
	};

	const result = mergeDocuments(into, from);

	expect(result.document.latest).toBe("2025-01-01T00:10:00.000Z|0002|i9j0");
});

test("mergeDocuments: document meta.latest after update", () => {
	const into: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:00:00.000Z|0000|a1b2",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice", age: 30 },
				"2025-01-01T00:00:00.000Z|0000|a1b2",
			),
		},
	};

	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:08:00.000Z|0001|g7h8",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ age: 31 },
				"2025-01-01T00:08:00.000Z|0001|g7h8",
			),
		},
	};

	const result = mergeDocuments(into, from);

	expect(result.document.latest).toBe("2025-01-01T00:08:00.000Z|0001|g7h8");
});

test("mergeDocuments: document meta.latest with deleted resource", () => {
	const into: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:00:00.000Z|0000|a1b2",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"2025-01-01T00:00:00.000Z|0000|a1b2",
			),
		},
	};

	const deletedDoc = makeResource(
		"doc-1",
		{ name: "Alice" },
		"2025-01-01T00:00:00.000Z|0000|a1b2",
	);
	deletedDoc.meta.deletedAt = "2025-01-01T00:12:00.000Z|0003|k1l2";

	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:12:00.000Z|0003|k1l2",
		resources: {
			"doc-1": deletedDoc,
		},
	};

	const result = mergeDocuments(into, from);

	// Should include the deletion eventstamp
	expect(result.document.latest).toBe("2025-01-01T00:12:00.000Z|0003|k1l2");
});

test("mergeDocuments: document meta.latest with multiple resources at different times", () => {
	const into: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:03:00.000Z|0001|c3d4",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"2025-01-01T00:01:00.000Z|0000|a1b2",
			),
			"doc-2": makeResource(
				"doc-2",
				{ name: "Bob" },
				"2025-01-01T00:03:00.000Z|0001|c3d4",
			),
		},
	};

	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:07:00.000Z|0002|g7h8",
		resources: {
			"doc-3": makeResource(
				"doc-3",
				{ name: "Charlie" },
				"2025-01-01T00:05:00.000Z|0001|e5f6",
			),
			"doc-4": makeResource(
				"doc-4",
				{ name: "Dave" },
				"2025-01-01T00:07:00.000Z|0002|g7h8",
			),
		},
	};

	const result = mergeDocuments(into, from);

	// Should be the newest resource eventstamp across all resources
	expect(result.document.latest).toBe("2025-01-01T00:07:00.000Z|0002|g7h8");
});

test("mergeDocuments: updates newestEventstamp from new resource with later timestamp than document meta", () => {
	// Edge case: document latest is older than a resource's latest
	// This can happen with inconsistent document construction
	const into: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:00:00.000Z|0000|a1b2",
		resources: {},
	};

	// Resource has a later timestamp than the document's latest
	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:01:00.000Z|0000|b2c3",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"2025-01-01T00:05:00.000Z|0001|e5f6", // Later than from.latest
			),
		},
	};

	const result = mergeDocuments(into, from);

	// Document's latest should be updated to the resource's timestamp
	expect(result.document.latest).toBe("2025-01-01T00:05:00.000Z|0001|e5f6");
	expect(result.changes.added.size).toBe(1);
	expect(result.changes.added.has("doc-1")).toBe(true);
});

test("mergeDocuments: updates newestEventstamp from merged resource with later timestamp than document meta", () => {
	// Edge case: merged resource's latest exceeds both documents' latest
	const into: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:00:00.000Z|0000|a1b2",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ name: "Alice" },
				"2025-01-01T00:00:00.000Z|0000|a1b2",
			),
		},
	};

	// from document has resource with later timestamp but document latest is older
	const from: StarlingDocument<AnyObject> = {
		version: "1.0",
		type: "items",
		latest: "2025-01-01T00:01:00.000Z|0000|b2c3",
		resources: {
			"doc-1": makeResource(
				"doc-1",
				{ age: 31 },
				"2025-01-01T00:10:00.000Z|0001|j9k0", // Much later than document latest
			),
		},
	};

	const result = mergeDocuments(into, from);

	// Document's latest should be updated to merged resource's timestamp
	expect(result.document.latest).toBe("2025-01-01T00:10:00.000Z|0001|j9k0");
	expect(result.changes.updated.size).toBe(1);
});
