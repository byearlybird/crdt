import { expect, test } from "bun:test";
import { encodeEventstamp, maxEventstamp } from "../clock/eventstamp";
import { makeResource, mergeResources, type ResourceObject } from "./resource";

// Helper to create test eventstamps consistently
const stamp1 = encodeEventstamp({
	ms: new Date("2025-01-01T00:00:00.000Z").getTime(),
	counter: 0,
	nonce: "a1b2c3",
});
const stamp2 = encodeEventstamp({
	ms: new Date("2025-01-02T00:00:00.000Z").getTime(),
	counter: 0,
	nonce: "c3d4e5",
});
const stamp5 = encodeEventstamp({
	ms: new Date("2025-01-05T00:00:00.000Z").getTime(),
	counter: 0,
	nonce: "b1c2d3",
});
const stamp8 = encodeEventstamp({
	ms: new Date("2025-01-08T00:00:00.000Z").getTime(),
	counter: 0,
	nonce: "c3d4e5",
});
const stamp10 = encodeEventstamp({
	ms: new Date("2025-01-10T00:00:00.000Z").getTime(),
	counter: 0,
	nonce: "d5e6f7",
});

test("makeResource creates resource with correct metadata", () => {
	const result = makeResource("user-1", { name: "Alice", age: 30 }, stamp1);

	expect(result.id).toBe("user-1");
	expect(result.attributes).toBeDefined();
	expect(maxEventstamp(Object.values(result.eventstamps))).toBe(stamp1);
});

test("makeResource with id", () => {
	const result = makeResource(
		"user-2",
		{ name: "Bob", email: "bob@example.com" },
		stamp1,
	);

	expect(result.id).toBe("user-2");
	expect(result.attributes).toBeDefined();
	expect(maxEventstamp(Object.values(result.eventstamps))).toBe(stamp1);
});

test("mergeResources preserves id from into document", () => {
	const doc1 = makeResource("doc-1", { name: "Alice" }, stamp1);

	const doc2 = makeResource("doc-2", { name: "Bob" }, stamp2);

	const merged = mergeResources(doc1, doc2);

	expect(merged.id).toBe("doc-1");
});

test("mergeResources merges attributes using object mergeRecords", () => {
	type TestAttrs = { name: string; age?: number; email?: string };
	const doc1: ResourceObject<TestAttrs> = makeResource(
		"doc-1",
		{ name: "Alice", age: 30 },
		stamp1,
	);
	const doc2: ResourceObject<TestAttrs> = makeResource(
		"doc-1",
		{ name: "Alice Updated", email: "alice@example.com" },
		stamp2,
	);

	const merged = mergeResources(doc1, doc2);

	expect(merged.attributes).toBeDefined();
	expect(maxEventstamp(Object.values(merged.eventstamps))).toBe(stamp2);
});

test("mergeResources bubbles newest eventstamp from nested object fields", () => {
	const doc1 = makeResource(
		"doc-1",
		{ user: { name: "Alice", email: "alice@old.com" } },
		stamp1,
	);
	const doc2 = makeResource(
		"doc-1",
		{ user: { email: "alice@new.com" } },
		stamp5, // Much newer
	);

	const merged = mergeResources(doc1, doc2);

	// The newest eventstamp should bubble up
	expect(maxEventstamp(Object.values(merged.eventstamps))).toBe(stamp5);
	// And the merge should work correctly
	const user = (merged.attributes as any).user;
	expect(user.name).toBe("Alice");
	expect(user.email).toBe("alice@new.com");
});

test("mergeResources returns newest eventstamp even with multiple nested changes", () => {
	const doc1 = makeResource(
		"doc-1",
		{
			profile: {
				personal: { name: "Alice" },
				settings: { theme: "dark" },
			},
		},
		stamp1,
	);
	const doc2 = makeResource(
		"doc-1",
		{
			profile: {
				personal: { name: "Alice Updated" },
				settings: { theme: "light" },
			},
		},
		stamp10, // Much newer timestamp
	);

	const merged = mergeResources(doc1, doc2);

	// Even with multiple nested changes, newest eventstamp bubbles up
	expect(maxEventstamp(Object.values(merged.eventstamps))).toBe(stamp10);
});

test("mergeResources returns newest eventstamp when adding new fields", () => {
	type TestAttrs = {
		name?: string;
		age?: number;
		email?: string;
		phone?: string;
	};
	const doc1: ResourceObject<TestAttrs> = makeResource(
		"doc-1",
		{ name: "Alice", age: 30 },
		stamp1,
	);
	const doc2: ResourceObject<TestAttrs> = makeResource(
		"doc-1",
		{ email: "alice@example.com", phone: "555-1234" },
		stamp8, // Newer
	);

	const merged = mergeResources(doc1, doc2);

	expect(maxEventstamp(Object.values(merged.eventstamps))).toBe(stamp8);
});

test("mergeResources handles schema changes (object replaced with primitive)", () => {
	const doc1: ResourceObject<TestAttrs> = makeResource(
		"doc-1",
		{ settings: { theme: "dark", notifications: true } },
		stamp1,
	);
	const doc2: ResourceObject<TestAttrs> = makeResource(
		"doc-1",
		{ settings: null },
		stamp2,
	);

	const merged = mergeResources(doc1, doc2);

	// With flat paths, all fields can coexist without schema conflicts
	// The newer "settings" value wins, but nested fields from doc1 remain
	expect(merged.attributes.settings).toBe(null);
	expect(merged.eventstamps.settings).toBe(stamp2);
	expect(merged.eventstamps["settings.theme"]).toBe(stamp1);
});

test("mergeResources handles schema changes in nested fields", () => {
	type TestAttrs = {
		profile: {
			personal: { name: string } | string;
			settings?: { theme: string };
		};
	};
	const doc1: ResourceObject<TestAttrs> = makeResource(
		"doc-1",
		{ profile: { personal: { name: "Alice" }, settings: { theme: "dark" } } },
		stamp1,
	);
	const doc2: ResourceObject<TestAttrs> = makeResource(
		"doc-1",
		{ profile: { personal: "Alice Smith" } },
		stamp2,
	);

	const merged = mergeResources(doc1, doc2);

	// With flat paths, both the newer primitive and older nested fields coexist
	expect(merged.attributes.profile.personal).toBe("Alice Smith");
	expect(merged.eventstamps["profile.personal"]).toBe(stamp2);
	expect(merged.eventstamps["profile.personal.name"]).toBe(stamp1);
});
