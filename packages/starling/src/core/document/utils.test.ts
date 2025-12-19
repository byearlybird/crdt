import { expect, test } from "bun:test";
import { makeDocument } from "./document";
import { makeResource } from "./resource";
import { documentToMap, mapToDocument } from "./utils";

const USERS_TYPE = "users";

test("documentToMap() converts document to map", () => {
	const doc = makeDocument<{ name: string }>(
		USERS_TYPE,
		"2025-01-01T00:00:00.000Z|0001|a1b2",
	);
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
	const doc = makeDocument<{ name: string }>(
		USERS_TYPE,
		"2025-01-01T00:00:00.000Z|0001|a1b2",
	);

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

	const {document: doc, latest} = mapToDocument(USERS_TYPE, map);

	expect(doc.type).toBe(USERS_TYPE);
	expect(latest).toBe("2025-01-01T00:05:00.000Z|0001|c3d4");
	expect(Object.keys(doc.resources)).toHaveLength(2);
	expect(doc.resources["user-1"]?.id).toBe("user-1");
	expect(doc.resources["user-2"]?.id).toBe("user-2");
});

test("mapToDocument() includes fallback eventstamp in max calculation", () => {
	const map = new Map<string, ReturnType<typeof makeResource>>();
	map.set(
		"user-1",
		makeResource(
			"user-1",
			{ name: "Alice" },
			"2025-01-01T00:00:00.000Z|0001|a1b2",
		),
	);

	const fallback = "2025-01-01T00:10:00.000Z|0001|f1f2";
	const {document: doc, latest} = mapToDocument(USERS_TYPE, map, fallback);

	expect(latest).toBe(fallback);
	expect(Object.keys(doc.resources)).toHaveLength(1);
});

test("mapToDocument() uses fallback eventstamp for empty map", () => {
	const fallback = "2025-01-01T00:10:00.000Z|0001|f1f2";
	const {document: doc, latest} = mapToDocument(USERS_TYPE, new Map(), fallback);

	expect(latest).toBe(fallback);
	expect(Object.keys(doc.resources)).toHaveLength(0);
});

test("mapToDocument() uses MIN_EVENTSTAMP when no fallback provided", () => {
	const {document: doc, latest} = mapToDocument(USERS_TYPE, new Map());

	expect(latest).toBe("1970-01-01T00:00:00.000Z|0000|0000");
	expect(Object.keys(doc.resources)).toHaveLength(0);
});

test("documentToMap() and mapToDocument() are inverses", () => {
	const originalDoc = makeDocument<{ name: string }>(
		USERS_TYPE,
		"2025-01-01T00:00:00.000Z|0001|a1b2",
	);
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
	const { document: reconstructedDoc, latest: reconstructedLatest } =
		mapToDocument(USERS_TYPE, map);

	expect(reconstructedDoc.type).toBe(USERS_TYPE);
	expect(reconstructedLatest).toBe("2025-01-01T00:05:00.000Z|0001|c3d4");
	expect(Object.keys(reconstructedDoc.resources)).toHaveLength(
		Object.keys(originalDoc.resources).length,
	);
	expect(reconstructedDoc.resources["user-1"]?.id).toBe("user-1");
	expect(reconstructedDoc.resources["user-2"]?.id).toBe("user-2");
});
