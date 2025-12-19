import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createStore } from "./store";
import {
	createMultiCollectionStore,
	createTestStore,
	subscribeToCollection,
} from "./test-helpers";

describe("Store", () => {
	describe("initialization", () => {
		test("creates store with typed collections", () => {
			const store = createTestStore();

			expect(store.tasks).toBeDefined();
			expect(typeof store.tasks.add).toBe("function");
			expect(typeof store.tasks.get).toBe("function");
			expect(typeof store.tasks.update).toBe("function");
			expect(typeof store.tasks.remove).toBe("function");
			expect(typeof store.transact).toBe("function");
		});

		test("creates multiple collections", () => {
			const store = createMultiCollectionStore();

			expect(store.tasks).toBeDefined();
			expect(store.users).toBeDefined();
			expect(typeof store.transact).toBe("function");
		});

		test("supports custom getId functions", () => {
			const store = createStore({
				name: "kv-db",
				schema: {
					kv: {
						schema: z.object({
							key: z.string(),
							value: z.string(),
						}),
						getId: (item) => item.key,
					},
				},
			});

			const item = store.kv.add({ key: "foo", value: "bar" });
			expect(store.kv.get("foo")).toEqual(item);
		});
	});

	describe("API surface", () => {
		test("provides transaction method", () => {
			const store = createTestStore();

			const result = store.transact(["tasks"], (tx) => {
				tx.tasks.add({ id: "1", title: "Test", completed: false });
				return "success";
			});

			expect(result).toBe("success");
			expect(store.tasks.get("1")?.title).toBe("Test");
		});

		test("provides event subscription", () => {
			const store = createTestStore();
			const events: any[] = [];

			store.on("mutation", (e) => events.push(e));
			store.tasks.add({ id: "1", title: "Test", completed: false });

			expect(events).toHaveLength(1);
		});
	});

	describe("events", () => {
		test("emits events with collection name", () => {
			const store = createTestStore();
			const storeEvents: any[] = [];
			store.on("mutation", (e) => storeEvents.push(e));

			store.tasks.add({ id: "1", title: "Task 1", completed: false });

			expect(storeEvents).toHaveLength(1);
			expect(storeEvents[0].collection).toBe("tasks");
			expect(storeEvents[0].added).toHaveLength(1);
		});

		test("emits events from multiple collections", () => {
			const store = createMultiCollectionStore();
			const storeEvents: any[] = [];
			store.on("mutation", (e) => storeEvents.push(e));

			store.transact(["tasks", "users"], (tx) => {
				tx.tasks.add({ id: "1", title: "Task 1", completed: false });
				tx.users.add({ id: "u1", name: "Alice", email: "alice@example.com" });
			});

			expect(storeEvents).toHaveLength(2);

			const tasksEvent = storeEvents.find((e) => e.collection === "tasks");
			expect(tasksEvent.added).toHaveLength(1);

			const usersEvent = storeEvents.find((e) => e.collection === "users");
			expect(usersEvent.added).toHaveLength(1);
		});

		test("keeps store subscriptions active after transactions", () => {
			const store = createTestStore();
			const events: any[] = [];
			subscribeToCollection(store, "tasks", (e) => events.push(e));

			store.transact(["tasks"], (tx) => {
				tx.tasks.add({ id: "1", title: "Tx Task", completed: false });
			});

			store.tasks.add({ id: "2", title: "Outside Task", completed: false });

			expect(events).toHaveLength(2);
			expect(events[0].added).toHaveLength(1);
			expect(events[1].added).toHaveLength(1);
		});
	});

	describe("toSnapshot", () => {
		test("returns snapshot for all collections", () => {
			const store = createMultiCollectionStore();
			store.tasks.add({ id: "task-1", title: "Buy milk", completed: false });
			store.tasks.add({ id: "task-2", title: "Walk dog", completed: true });
			store.users.add({ id: "user-1", name: "Alice", email: "alice@example.com" });

			const snapshot = store.toSnapshot();

			// Verify snapshot structure
			expect(snapshot.version).toBe("1.0");
			expect(snapshot.name).toBe("multi-collection-store");
			expect(snapshot.latest).toBeDefined();
			expect(typeof snapshot.latest).toBe("string");

			// Verify collections
			expect(snapshot.collections.tasks).toBeDefined();
			expect(snapshot.collections.users).toBeDefined();
			expect(Object.keys(snapshot.collections.tasks.resources)).toHaveLength(2);
			expect(Object.keys(snapshot.collections.users.resources)).toHaveLength(1);
		});

		test("returns empty snapshot for empty collections", () => {
			const store = createMultiCollectionStore();

			const snapshot = store.toSnapshot();

			// Verify snapshot structure
			expect(snapshot.version).toBe("1.0");
			expect(snapshot.name).toBe("multi-collection-store");
			expect(snapshot.latest).toBeDefined();

			// Verify empty collections
			expect(snapshot.collections.tasks).toBeDefined();
			expect(snapshot.collections.users).toBeDefined();
			expect(Object.keys(snapshot.collections.tasks.resources)).toHaveLength(0);
			expect(Object.keys(snapshot.collections.users.resources)).toHaveLength(0);
			expect(snapshot.collections.tasks.tombstones).toBeDefined();
			expect(snapshot.collections.users.tombstones).toBeDefined();
		});

		test("includes tombstones in snapshot", () => {
			const store = createTestStore();
			store.tasks.add({ id: "task-1", title: "Buy milk", completed: false });
			store.tasks.remove("task-1");

			const snapshot = store.toSnapshot();

			// Resource should be removed, tombstone should exist
			expect(Object.keys(snapshot.collections.tasks.resources)).toHaveLength(0);
			expect(snapshot.collections.tasks.tombstones["task-1"]).toBeDefined();
			expect(typeof snapshot.collections.tasks.tombstones["task-1"]).toBe(
				"string",
			);
		});

		test("includes correct latest eventstamps", () => {
			const store = createMultiCollectionStore();
			store.tasks.add({ id: "task-1", title: "Buy milk", completed: false });
			store.users.add({ id: "user-1", name: "Alice", email: "alice@example.com" });

			const snapshot = store.toSnapshot();

			// Verify store-level latest eventstamp exists
			expect(snapshot.latest).toBeDefined();
			expect(typeof snapshot.latest).toBe("string");

			// Verify collections exist with proper structure
			expect(snapshot.collections.tasks).toBeDefined();
			expect(snapshot.collections.users).toBeDefined();
			expect(snapshot.collections.tasks.type).toBe("tasks");
			expect(snapshot.collections.users.type).toBe("users");
		});
	});

});
