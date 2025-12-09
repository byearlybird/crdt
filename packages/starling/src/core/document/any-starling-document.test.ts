import { describe, expect, test } from "bun:test";
import type {
	AnyObject,
	AnyStarlingDocument,
	StarlingDocument,
} from "./document";

describe("AnyStarlingDocument", () => {
	test("accepts StarlingDocument with any object type", () => {
		// Test with specific type
		type User = { name: string; age: number };
		const userDoc: StarlingDocument<User> = {
			type: "users",
			latest: "2025-01-01T00:00:00.000Z|0000|0000",
			resources: {},
		};

		// Should be assignable to AnyStarlingDocument
		const anyDoc: AnyStarlingDocument = userDoc;
		expect(anyDoc.type).toBe("users");
	});

	test("preserves type inference when using generic parameter", () => {
		type Task = { title: string; completed: boolean };

		// Function that preserves specific type
		function processDocument<T extends AnyObject>(
			doc: AnyStarlingDocument<T>,
		): T | undefined {
			const firstId = Object.keys(doc.resources)[0];
			return firstId ? doc.resources[firstId]?.attributes : undefined;
		}

		const taskDoc: StarlingDocument<Task> = {
			type: "tasks",
			latest: "2025-01-01T00:00:00.000Z|0000|0000",
			resources: {
				"task-1": {
					id: "task-1",
					attributes: { title: "Test", completed: false },
					meta: {
						eventstamps: { title: "", completed: "" },
						latest: "",
						deletedAt: null,
					},
				},
			},
		};

		const result = processDocument(taskDoc);
		// TypeScript should infer result as Task | undefined
		expect(result?.title).toBe("Test");
	});

	test("works as catch-all without type parameter", () => {
		function acceptAnyDocument(doc: AnyStarlingDocument): string {
			return doc.type;
		}

		const doc1: StarlingDocument<{ name: string }> = {
			type: "users",
			latest: "2025-01-01T00:00:00.000Z|0000|0000",
			resources: {},
		};

		const doc2: StarlingDocument<{ title: string }> = {
			type: "posts",
			latest: "2025-01-01T00:00:00.000Z|0000|0000",
			resources: {},
		};

		expect(acceptAnyDocument(doc1)).toBe("users");
		expect(acceptAnyDocument(doc2)).toBe("posts");
	});
});
