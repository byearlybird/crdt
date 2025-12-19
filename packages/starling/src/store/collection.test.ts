import { describe, expect, test } from "bun:test";
import { DuplicateIdError, IdNotFoundError } from "./collection";
import { createTestStore, makeTask, subscribeToCollection } from "./test-helpers";

describe("Collection", () => {
	describe("add", () => {
		test("adds new item and returns validated result", () => {
			const store = createTestStore();

			const task = store.tasks.add({
				id: "1",
				title: "Learn Starling",
				completed: false,
			});

			expect(task.id).toBe("1");
			expect(task.title).toBe("Learn Starling");
			expect(task.completed).toBe(false);
		});

		test("generates default id when not provided", () => {
			const store = createTestStore();

			const task = store.tasks.add({
				title: "Auto ID Task",
				completed: false,
			});

			expect(task.id).toBeDefined();
			expect(typeof task.id).toBe("string");
			expect(task.id.length).toBeGreaterThan(0);
		});

		test("throws on duplicate id", () => {
			const store = createTestStore();
			const task = makeTask({ id: "1" });

			store.tasks.add(task);

			expect(() => store.tasks.add(task)).toThrow(DuplicateIdError);
		});
	});

	describe("get", () => {
		test("retrieves existing item", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "Test", completed: false });

			const task = store.tasks.get("1");

			expect(task?.title).toBe("Test");
		});

		test("returns null for non-existent item", () => {
			const store = createTestStore();

			expect(store.tasks.get("missing")).toBeNull();
		});

		test("excludes soft-deleted items by default", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "Test", completed: false });
			store.tasks.remove("1");

			expect(store.tasks.get("1")).toBeNull();
		});

		test("truly deletes items (no recovery)", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "Test", completed: false });
			store.tasks.remove("1");

			const task = store.tasks.get("1");

			expect(task).toBeNull();
		});
	});

	describe("update", () => {
		test("updates existing item with partial data", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "Learn Starling", completed: false });

			store.tasks.update("1", { completed: true });

			const task = store.tasks.get("1");
			expect(task?.completed).toBe(true);
			expect(task?.title).toBe("Learn Starling");
		});

		test("throws on non-existent item", () => {
			const store = createTestStore();

			expect(() => store.tasks.update("missing", { completed: true })).toThrow(
				IdNotFoundError,
			);
		});
	});

	describe("remove", () => {
		test("truly deletes item", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "Test", completed: false });

			store.tasks.remove("1");

			expect(store.tasks.get("1")).toBeNull();
		});

		test("throws on non-existent item", () => {
			const store = createTestStore();

			expect(() => store.tasks.remove("missing")).toThrow(IdNotFoundError);
		});
	});

	describe("getAll", () => {
		test("returns all non-deleted items", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "Task 1", completed: false });
			store.tasks.add({ id: "2", title: "Task 2", completed: true });
			store.tasks.add({ id: "3", title: "Task 3", completed: false });

			const allTasks = store.tasks.getAll();

			expect(allTasks).toHaveLength(3);
		});

		test("excludes soft-deleted items by default", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "Task 1", completed: false });
			store.tasks.add({ id: "2", title: "Task 2", completed: true });
			store.tasks.remove("2");

			const allTasks = store.tasks.getAll();

			expect(allTasks).toHaveLength(1);
			expect(allTasks[0]?.id).toBe("1");
		});

		test("excludes deleted items", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "Task 1", completed: false });
			store.tasks.add({ id: "2", title: "Task 2", completed: true });
			store.tasks.remove("2");

			const allTasks = store.tasks.getAll();

			expect(allTasks).toHaveLength(1);
			expect(allTasks[0]?.id).toBe("1");
		});
	});

	describe("find", () => {
		test("filters items with predicate", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "Task 1", completed: false });
			store.tasks.add({ id: "2", title: "Task 2", completed: true });
			store.tasks.add({ id: "3", title: "Task 3", completed: false });

			const incomplete = store.tasks.find((task) => !task.completed);

			expect(incomplete).toHaveLength(2);
			expect(incomplete[0]?.id).toBe("1");
			expect(incomplete[1]?.id).toBe("3");
		});

		test("excludes soft-deleted items", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "Task 1", completed: false });
			store.tasks.add({ id: "2", title: "Task 2", completed: false });
			store.tasks.add({ id: "3", title: "Task 3", completed: false });
			store.tasks.remove("2");

			const all = store.tasks.find(() => true);

			expect(all).toHaveLength(2);
			expect(all.map((t) => t.id)).toEqual(["1", "3"]);
		});

		test("supports map and sort options", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "C Task", completed: false });
			store.tasks.add({ id: "2", title: "A Task", completed: false });
			store.tasks.add({ id: "3", title: "B Task", completed: false });

			const titles = store.tasks.find(() => true, {
				map: (task) => task.title,
				sort: (a, b) => a.localeCompare(b),
			});

			expect(titles).toEqual(["A Task", "B Task", "C Task"]);
		});
	});

	describe("events", () => {
		test("emits add event", () => {
			const store = createTestStore();
			const events: any[] = [];
			subscribeToCollection(store, "tasks", (e) => events.push(e));

			store.tasks.add({ id: "1", title: "Buy milk", completed: false });

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				added: [
					{ id: "1", item: { id: "1", title: "Buy milk", completed: false } },
				],
				updated: [],
				removed: [],
			});
		});

		test("emits update event with before/after", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "Buy milk", completed: false });

			const events: any[] = [];
			subscribeToCollection(store, "tasks", (e) => events.push(e));

			store.tasks.update("1", { completed: true });

			expect(events).toHaveLength(1);
			expect(events[0].added).toEqual([]);
			expect(events[0].removed).toEqual([]);
			expect(events[0].updated).toHaveLength(1);
			expect(events[0].updated[0]).toEqual({
				id: "1",
				before: { id: "1", title: "Buy milk", completed: false },
				after: { id: "1", title: "Buy milk", completed: true },
			});
		});

		test("emits remove event", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "Buy milk", completed: false });

			const events: any[] = [];
			subscribeToCollection(store, "tasks", (e) => events.push(e));

			store.tasks.remove("1");

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				added: [],
				updated: [],
				removed: [
					{ id: "1", item: { id: "1", title: "Buy milk", completed: false } },
				],
			});
		});

		test("supports unsubscribe", () => {
			const store = createTestStore();
			const events: any[] = [];
			const unsubscribe = store.on("mutation", (e) => {
				if (e.collection === "tasks") {
					events.push({
						added: e.added,
						updated: e.updated,
						removed: e.removed,
					});
				}
			});

			store.tasks.add({ id: "1", title: "Task 1", completed: false });
			expect(events).toHaveLength(1);

			unsubscribe();
			store.tasks.add({ id: "2", title: "Task 2", completed: false });

			expect(events).toHaveLength(1);
		});

		test("batches events in transactions", () => {
			const store = createTestStore();
			const events: any[] = [];
			subscribeToCollection(store, "tasks", (e) => events.push(e));

			store.transact(["tasks"], (tx) => {
				tx.tasks.add({ id: "1", title: "Task 1", completed: false });
				tx.tasks.add({ id: "2", title: "Task 2", completed: false });
				tx.tasks.add({ id: "3", title: "Task 3", completed: false });
			});

			expect(events).toHaveLength(1);
			expect(events[0].added).toHaveLength(3);
		});

		test("batches mixed operations in transactions", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "Task 1", completed: false });
			store.tasks.add({ id: "2", title: "Task 2", completed: false });

			const events: any[] = [];
			subscribeToCollection(store, "tasks", (e) => events.push(e));

			store.transact(["tasks"], (tx) => {
				tx.tasks.add({ id: "3", title: "Task 3", completed: false });
				tx.tasks.update("1", { completed: true });
				tx.tasks.remove("2");
			});

			expect(events).toHaveLength(1);
			expect(events[0].added).toHaveLength(1);
			expect(events[0].updated).toHaveLength(1);
			expect(events[0].removed).toHaveLength(1);
		});

		test("emits no events on transaction rollback", () => {
			const store = createTestStore();
			const events: any[] = [];
			subscribeToCollection(store, "tasks", (e) => events.push(e));

			store.transact(["tasks"], (tx) => {
				tx.tasks.add({ id: "1", title: "Task 1", completed: false });
				tx.rollback();
			});

			expect(events).toHaveLength(0);
		});

		test("emits no events on transaction exception", () => {
			const store = createTestStore();
			const events: any[] = [];
			subscribeToCollection(store, "tasks", (e) => events.push(e));

			try {
				store.transact(["notes", "tasks"], (tx) => {
					tx.tasks.add({ id: "1", title: "Task 1", completed: false });
					throw new Error("Oops!");
				});
			} catch {
				// Expected
			}

			expect(events).toHaveLength(0);
		});
	});
});
