import { z } from "zod";
import { makeDocument, makeResource } from "../core";
import { createStore } from "./store";

// Shared schemas
export const taskSchema = z.object({
	id: z.string().default(() => crypto.randomUUID()),
	title: z.string(),
	completed: z.boolean(),
});

export const userSchema = z.object({
	id: z.string(),
	name: z.string(),
	email: z.string(),
});

export type Task = z.infer<typeof taskSchema>;
export type User = z.infer<typeof userSchema>;

// Store factories
export function createTestStore() {
	return createStore({
		name: "test-store",
		schema: {
			tasks: {
				schema: taskSchema,
				getId: (task) => task.id,
			},
		},
	});
}

export function createMultiCollectionStore() {
	return createStore({
		name: "multi-collection-store",
		schema: {
			tasks: {
				schema: taskSchema,
				getId: (task) => task.id,
			},
			users: {
				schema: userSchema,
				getId: (user) => user.id,
			},
		},
	});
}

// Test data factories
export function makeTask(overrides: Partial<Task> = {}): Task & { id: string } {
	return {
		id: crypto.randomUUID(),
		title: "Test Task",
		completed: false,
		...overrides,
	};
}

// Document helpers for merge tests
export function makeTaskDocument(
	tasks: Array<{ id: string; title: string; completed: boolean }>,
	eventstamp = "2099-01-01T00:00:00.000Z|0001|a1b2",
) {
	const doc = makeDocument<Task>("tasks", eventstamp);
	for (const task of tasks) {
		doc.resources[task.id] = makeResource(task.id, task, eventstamp);
	}
	return doc;
}

// Subscription helper for testing collection mutations
export function subscribeToCollection(
	store: ReturnType<typeof createTestStore | typeof createMultiCollectionStore>,
	collectionName: string,
	handler: (mutations: {
		added: unknown[];
		updated: unknown[];
		removed: unknown[];
	}) => void,
): () => void {
	return store.on("mutation", (e) => {
		if (e.collection === collectionName) {
			handler({ added: e.added, updated: e.updated, removed: e.removed });
		}
	});
}
