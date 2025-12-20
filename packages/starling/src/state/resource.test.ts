import { expect, test } from "bun:test";
import { encodeEventstamp, maxEventstamp } from "../clock/eventstamp";
import type { Resource } from "./resource";
import { makeResource, mergeResources } from "./resource";

// Create timestamps to use in tests
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
const stamp3 = encodeEventstamp({
	ms: new Date("2025-01-05T00:00:00.000Z").getTime(),
	counter: 0,
	nonce: "b1c2d3",
});

test("makeResource creates a resource with the right info", () => {
	const result = makeResource("user-1", { name: "Alice", age: 30 }, stamp1);

	expect(result.id).toBe("user-1");
	expect(result.attributes).toBeDefined();
	expect(maxEventstamp(Object.values(result.eventstamps))).toBe(stamp1);
});

test("mergeResources keeps the ID from the first document", () => {
	const doc1 = makeResource("doc-1", { name: "Alice" }, stamp1);

	const doc2 = makeResource("doc-2", { name: "Bob" }, stamp2);

	const merged = mergeResources(doc1, doc2);

	expect(merged.id).toBe("doc-1");
});

test("mergeResources combines data from both documents", () => {
	type TestAttrs = { name: string; age?: number; email?: string };
	const doc1: Resource<TestAttrs> = makeResource(
		"doc-1",
		{ name: "Alice", age: 30 },
		stamp1,
	);
	const doc2: Resource<TestAttrs> = makeResource(
		"doc-1",
		{ name: "Alice Updated", email: "alice@example.com" },
		stamp2,
	);

	const merged = mergeResources(doc1, doc2);

	expect(merged.attributes).toBeDefined();
	expect(maxEventstamp(Object.values(merged.eventstamps))).toBe(stamp2);
});

test("mergeResources finds newest timestamp from nested objects", () => {
	const doc1 = makeResource(
		"doc-1",
		{ user: { name: "Alice", email: "alice@old.com" } },
		stamp1,
	);
	const doc2 = makeResource(
		"doc-1",
		{ user: { email: "alice@new.com" } },
		stamp3, // Much newer timestamp
	);

	const merged = mergeResources(doc1, doc2);

	// The newest timestamp should be found
	expect(maxEventstamp(Object.values(merged.eventstamps))).toBe(stamp3);
	// And the merge should work right
	const user = (merged.attributes as any).user;
	expect(user.name).toBe("Alice");
	expect(user.email).toBe("alice@new.com");
});

test("mergeResources handles when an object is replaced with a simple value", () => {
	type TestAttrs = {
		settings: { theme: string; notifications: boolean } | null;
	};
	const doc1: Resource<TestAttrs> = makeResource(
		"doc-1",
		{ settings: { theme: "dark", notifications: true } },
		stamp1,
	);
	const doc2: Resource<TestAttrs> = makeResource(
		"doc-1",
		{ settings: null },
		stamp2,
	);

	const merged = mergeResources(doc1, doc2);

	// With flat paths, all fields can exist together without conflicts
	// The newer "settings" value wins, but nested fields from doc1 stay
	expect(merged.attributes.settings).toBe(null);
	expect(merged.eventstamps.settings).toBe(stamp2);
	expect(merged.eventstamps["settings.theme"]).toBe(stamp1);
});

test("mergeResources handles when nested fields change types", () => {
	type TestAttrs = {
		profile: {
			personal: { name: string } | string;
			settings?: { theme: string };
		};
	};
	const doc1: Resource<TestAttrs> = makeResource(
		"doc-1",
		{ profile: { personal: { name: "Alice" }, settings: { theme: "dark" } } },
		stamp1,
	);
	const doc2: Resource<TestAttrs> = makeResource(
		"doc-1",
		{ profile: { personal: "Alice Smith" } },
		stamp2,
	);

	const merged = mergeResources(doc1, doc2);

	// With flat paths, both the newer simple value and older nested fields exist together
	expect(merged.attributes.profile.personal).toBe("Alice Smith");
	expect(merged.eventstamps["profile.personal"]).toBe(stamp2);
	expect(merged.eventstamps["profile.personal.name"]).toBe(stamp1);
});
