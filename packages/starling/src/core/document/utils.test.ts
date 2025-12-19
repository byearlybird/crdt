import { expect, test } from "bun:test";
import { makeDocument } from "./document";
import { makeResource } from "./resource";
import { documentToMap, mapToDocument } from "./utils";

const USERS_TYPE = "users";

test("documentToMap() converts document to map", () => {
	const doc = makeDocument<{ name: string }>(USERS_TYPE);
	doc.resources["user-1"] = makeResource(
		"user-1",
		{ name: "Alice" },
		"2025-01-01T00:00:00.000Z|0001|a1b2",
	);
	doc.resources["user-2"] = makeResource(
		"user-2",
		{ name: "Bob" },
		"2025-01-01T00:05:00.000Z|0001|c3d4",
	);

	const map = documentToMap(doc);

	expect(map.size).toBe(2);
	expect(map.get("user-1")?.attributes.name).toBe("Alice");
	expect(map.get("user-2")?.attributes.name).toBe("Bob");
});

test("documentToMap() handles empty document", () => {
	const doc = makeDocument<{ name: string }>(USERS_TYPE);

	const map = documentToMap(doc);

	expect(map.size).toBe(0);
});

test("mapToDocument() converts map to document", () => {
	const map = new Map<string, ReturnType<typeof makeResource>>();
	map.set(
		"user-1",
		makeResource(
			"user-1",
			{ name: "Alice" },
			"2025-01-01T00:00:00.000Z|0001|a1b2",
		),
	);
	map.set(
		"user-2",
		makeResource(
			"user-2",
			{ name: "Bob" },
			"2025-01-01T00:05:00.000Z|0001|c3d4",
		),
	);

	const doc = mapToDocument(USERS_TYPE, map);

	expect(doc.type).toBe(USERS_TYPE);
	expect(Object.keys(doc.resources)).toHaveLength(2);
	expect(doc.resources["user-1"]?.id).toBe("user-1");
	expect(doc.resources["user-2"]?.id).toBe("user-2");
});

test("mapToDocument() handles tombstones", () => {
	const map = new Map<string, ReturnType<typeof makeResource>>();
	map.set(
		"user-1",
		makeResource(
			"user-1",
			{ name: "Alice" },
			"2025-01-01T00:00:00.000Z|0001|a1b2",
		),
	);

	const tombstones = new Map<string, string>();
	tombstones.set("user-2", "2025-01-01T00:05:00.000Z|0001|c3d4");

	const doc = mapToDocument(USERS_TYPE, map, tombstones);

	expect(doc.type).toBe(USERS_TYPE);
	expect(Object.keys(doc.resources)).toHaveLength(1);
	expect(Object.keys(doc.tombstones)).toHaveLength(1);
	expect(doc.tombstones["user-2"]).toBe("2025-01-01T00:05:00.000Z|0001|c3d4");
});

test("documentToMap() and mapToDocument() are inverses", () => {
	const originalDoc = makeDocument<{ name: string }>(USERS_TYPE);
	originalDoc.resources["user-1"] = makeResource(
		"user-1",
		{ name: "Alice" },
		"2025-01-01T00:00:00.000Z|0001|a1b2",
	);
	originalDoc.resources["user-2"] = makeResource(
		"user-2",
		{ name: "Bob" },
		"2025-01-01T00:05:00.000Z|0001|c3d4",
	);

	const map = documentToMap(originalDoc);
	const reconstructedDoc = mapToDocument(USERS_TYPE, map);

	expect(reconstructedDoc.type).toBe(USERS_TYPE);
	expect(Object.keys(reconstructedDoc.resources)).toHaveLength(
		Object.keys(originalDoc.resources).length,
	);
	expect(reconstructedDoc.resources["user-1"]?.id).toBe("user-1");
	expect(reconstructedDoc.resources["user-2"]?.id).toBe("user-2");
});
