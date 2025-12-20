import { expect, test } from "bun:test";
import { encodeEventstamp } from "../clock/eventstamp";
import { makeDocument } from "./document";
import { makeResource } from "./resource";
import {
	documentToMap,
	eventstampsChanged,
	getValueAtPath,
	mapToDocument,
	maxEventstampFromValues,
	setValueAtPath,
} from "./utils";

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

test("getValueAtPath() retrieves simple property", () => {
	const obj = { name: "Alice", age: 30 };

	const result = getValueAtPath(obj, "name");

	expect(result).toBe("Alice");
});

test("getValueAtPath() retrieves nested property", () => {
	const obj = { user: { profile: { name: "Alice" } } };

	const result = getValueAtPath(obj, "user.profile.name");

	expect(result).toBe("Alice");
});

test("getValueAtPath() returns undefined for non-existent path", () => {
	const obj = { name: "Alice" };

	const result = getValueAtPath(obj, "email");

	expect(result).toBeUndefined();
});

test("getValueAtPath() returns undefined when path goes through non-object", () => {
	const obj = { name: "Alice" };

	const result = getValueAtPath(obj, "name.firstName");

	expect(result).toBeUndefined();
});

test("setValueAtPath() sets simple property", () => {
	const obj: Record<string, unknown> = {};

	setValueAtPath(obj, "name", "Alice");

	expect(obj.name).toBe("Alice");
});

test("setValueAtPath() sets nested property", () => {
	const obj: Record<string, unknown> = {};

	setValueAtPath(obj, "user.profile.name", "Alice");

	expect((obj.user as any).profile.name).toBe("Alice");
});

test("setValueAtPath() creates missing intermediate objects", () => {
	const obj: Record<string, unknown> = { user: { id: "123" } };

	setValueAtPath(obj, "user.profile.name", "Alice");

	expect((obj.user as any).id).toBe("123");
	expect((obj.user as any).profile.name).toBe("Alice");
});

test("setValueAtPath() overwrites non-object values in path", () => {
	const obj: Record<string, unknown> = { user: "simple-string" };

	setValueAtPath(obj, "user.profile.name", "Alice");

	expect(typeof obj.user).toBe("object");
	expect((obj.user as any).profile.name).toBe("Alice");
});

test("eventstampsChanged() returns false for identical records", () => {
	const before = { a: "stamp1", b: "stamp2" };
	const after = { a: "stamp1", b: "stamp2" };

	const result = eventstampsChanged(before, after);

	expect(result).toBe(false);
});

test("eventstampsChanged() returns true when keys differ", () => {
	const before = { a: "stamp1", b: "stamp2" };
	const after = { a: "stamp1", c: "stamp2" };

	const result = eventstampsChanged(before, after);

	expect(result).toBe(true);
});

test("eventstampsChanged() returns true when values differ", () => {
	const before = { a: "stamp1", b: "stamp2" };
	const after = { a: "stamp1", b: "stamp3" };

	const result = eventstampsChanged(before, after);

	expect(result).toBe(true);
});

test("eventstampsChanged() returns true when length differs", () => {
	const before = { a: "stamp1" };
	const after = { a: "stamp1", b: "stamp2" };

	const result = eventstampsChanged(before, after);

	expect(result).toBe(true);
});

test("eventstampsChanged() returns false for empty records", () => {
	const before = {};
	const after = {};

	const result = eventstampsChanged(before, after);

	expect(result).toBe(false);
});

test("maxEventstampFromValues() returns maximum eventstamp", () => {
	const stamp1 = encodeEventstamp({
		ms: new Date("2025-01-01T00:00:00.000Z").getTime(),
		counter: 0,
		nonce: "a1b2c3",
	});
	const stamp2 = encodeEventstamp({
		ms: new Date("2025-01-05T00:00:00.000Z").getTime(),
		counter: 0,
		nonce: "c3d4e5",
	});
	const stamp3 = encodeEventstamp({
		ms: new Date("2025-01-03T00:00:00.000Z").getTime(),
		counter: 0,
		nonce: "e5f6a7",
	});

	const values = {
		a: stamp1,
		b: stamp2,
		c: stamp3,
	};

	const result = maxEventstampFromValues(values);

	expect(result).toBe(stamp2);
});

test("maxEventstampFromValues() handles single value", () => {
	const stamp = encodeEventstamp({
		ms: new Date("2025-01-01T00:00:00.000Z").getTime(),
		counter: 0,
		nonce: "a1b2c3",
	});

	const values = { a: stamp };

	const result = maxEventstampFromValues(values);

	expect(result).toBe(stamp);
});

test("maxEventstampFromValues() returns MIN_EVENTSTAMP for empty record", () => {
	const values = {};

	const result = maxEventstampFromValues(values);

	expect(result).toBe("000000000000000000000000");
});
