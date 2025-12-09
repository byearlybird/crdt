import { describe, expect, test } from "bun:test";
import { makeResource, type ResourceObject } from "../core";
import {
	CollectionInternals,
	type CollectionMutationEvent,
	type CollectionWithInternals,
	createCollection,
	DuplicateIdError,
	IdNotFoundError,
} from "./collection";
import {
	createTestDb,
	makeTask,
	makeTaskDocument,
	type Task,
	taskSchema,
} from "./test-helpers";

type TaskCollectionInternals = CollectionWithInternals<typeof taskSchema>;

describe("Collection", () => {
	describe("add", () => {
		test("adds new item and returns validated result", () => {
			const db = createTestDb();

			const task = db.tasks.add({
				id: "1",
				title: "Learn Starling",
				completed: false,
			});

			expect(task.id).toBe("1");
			expect(task.title).toBe("Learn Starling");
			expect(task.completed).toBe(false);
		});

		test("generates default id when not provided", () => {
			const db = createTestDb();

			const task = db.tasks.add({
				title: "Auto ID Task",
				completed: false,
			});

			expect(task.id).toBeDefined();
			expect(typeof task.id).toBe("string");
			expect(task.id.length).toBeGreaterThan(0);
		});

		test("throws on duplicate id", () => {
			const db = createTestDb();
			const task = makeTask({ id: "1" });

			db.tasks.add(task);

			expect(() => db.tasks.add(task)).toThrow(DuplicateIdError);
		});
	});

	describe("get", () => {
		test("retrieves existing item", () => {
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "Test", completed: false });

			const task = db.tasks.get("1");

			expect(task?.title).toBe("Test");
		});

		test("returns null for non-existent item", () => {
			const db = createTestDb();

			expect(db.tasks.get("missing")).toBeNull();
		});

		test("excludes soft-deleted items by default", () => {
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "Test", completed: false });
			db.tasks.remove("1");

			expect(db.tasks.get("1")).toBeNull();
		});

		test("includes soft-deleted items with includeDeleted flag", () => {
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "Test", completed: false });
			db.tasks.remove("1");

			const task = db.tasks.get("1", { includeDeleted: true });

			expect(task?.title).toBe("Test");
		});
	});

	describe("update", () => {
		test("updates existing item with partial data", () => {
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "Learn Starling", completed: false });

			db.tasks.update("1", { completed: true });

			const task = db.tasks.get("1");
			expect(task?.completed).toBe(true);
			expect(task?.title).toBe("Learn Starling");
		});

		test("throws on non-existent item", () => {
			const db = createTestDb();

			expect(() => db.tasks.update("missing", { completed: true })).toThrow(
				IdNotFoundError,
			);
		});
	});

	describe("remove", () => {
		test("soft-deletes item", () => {
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "Test", completed: false });

			db.tasks.remove("1");

			expect(db.tasks.get("1")).toBeNull();
			expect(db.tasks.get("1", { includeDeleted: true })).toBeDefined();
		});

		test("throws on non-existent item", () => {
			const db = createTestDb();

			expect(() => db.tasks.remove("missing")).toThrow(IdNotFoundError);
		});
	});

	describe("getAll", () => {
		test("returns all non-deleted items", () => {
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "Task 1", completed: false });
			db.tasks.add({ id: "2", title: "Task 2", completed: true });
			db.tasks.add({ id: "3", title: "Task 3", completed: false });

			const allTasks = db.tasks.getAll();

			expect(allTasks).toHaveLength(3);
		});

		test("excludes soft-deleted items by default", () => {
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "Task 1", completed: false });
			db.tasks.add({ id: "2", title: "Task 2", completed: true });
			db.tasks.remove("2");

			const allTasks = db.tasks.getAll();

			expect(allTasks).toHaveLength(1);
			expect(allTasks[0]?.id).toBe("1");
		});

		test("includes soft-deleted items with includeDeleted flag", () => {
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "Task 1", completed: false });
			db.tasks.add({ id: "2", title: "Task 2", completed: true });
			db.tasks.remove("2");

			const allTasks = db.tasks.getAll({ includeDeleted: true });

			expect(allTasks).toHaveLength(2);
			expect(allTasks.map((t) => t.id).sort()).toEqual(["1", "2"]);
		});
	});

	describe("find", () => {
		test("filters items with predicate", () => {
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "Task 1", completed: false });
			db.tasks.add({ id: "2", title: "Task 2", completed: true });
			db.tasks.add({ id: "3", title: "Task 3", completed: false });

			const incomplete = db.tasks.find((task) => !task.completed);

			expect(incomplete).toHaveLength(2);
			expect(incomplete[0]?.id).toBe("1");
			expect(incomplete[1]?.id).toBe("3");
		});

		test("excludes soft-deleted items", () => {
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "Task 1", completed: false });
			db.tasks.add({ id: "2", title: "Task 2", completed: false });
			db.tasks.add({ id: "3", title: "Task 3", completed: false });
			db.tasks.remove("2");

			const all = db.tasks.find(() => true);

			expect(all).toHaveLength(2);
			expect(all.map((t) => t.id)).toEqual(["1", "3"]);
		});

		test("supports map and sort options", () => {
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "C Task", completed: false });
			db.tasks.add({ id: "2", title: "A Task", completed: false });
			db.tasks.add({ id: "3", title: "B Task", completed: false });

			const titles = db.tasks.find(() => true, {
				map: (task) => task.title,
				sort: (a, b) => a.localeCompare(b),
			});

			expect(titles).toEqual(["A Task", "B Task", "C Task"]);
		});
	});

	describe("merge", () => {
		test("adds new resources from document", () => {
			const db = createTestDb();

			const doc = makeTaskDocument([
				{ id: "task-1", title: "Buy milk", completed: false },
				{ id: "task-2", title: "Walk dog", completed: true },
			]);

			db.tasks.merge(doc);

			expect(db.tasks.get("task-1")?.title).toBe("Buy milk");
			expect(db.tasks.get("task-1")?.completed).toBe(false);
			expect(db.tasks.get("task-2")?.title).toBe("Walk dog");
			expect(db.tasks.get("task-2")?.completed).toBe(true);
		});

		test("merges multiple resources at once", () => {
			const db = createTestDb();
			db.tasks.add({ id: "task-1", title: "Buy milk", completed: false });

			const doc = makeTaskDocument(
				[
					{ id: "task-1", title: "Buy milk", completed: true },
					{ id: "task-2", title: "Walk dog", completed: true },
					{ id: "task-3", title: "Read book", completed: false },
				],
				"2099-01-01T00:05:00.000Z|0001|c3d4",
			);

			db.tasks.merge(doc);

			expect(db.tasks.get("task-1")?.completed).toBe(true);
			expect(db.tasks.get("task-2")?.title).toBe("Walk dog");
			expect(db.tasks.get("task-3")?.title).toBe("Read book");
		});

		test("applies field-level LWW with newer eventstamps", () => {
			const db = createTestDb();
			db.tasks.add({ id: "task-1", title: "Buy milk", completed: false });

			const doc = makeTaskDocument(
				[{ id: "task-1", title: "Buy milk", completed: true }],
				"2099-01-01T00:05:00.000Z|0001|c3d4",
			);

			db.tasks.merge(doc);

			const task = db.tasks.get("task-1");
			expect(task?.completed).toBe(true);
			expect(task?.title).toBe("Buy milk");
		});

		test("handles soft-deleted resources", () => {
			const db = createTestDb();
			db.tasks.add({ id: "task-1", title: "Buy milk", completed: false });

			const doc = makeTaskDocument([], "2099-01-01T00:05:00.000Z|0001|c3d4");
			const resource = makeResource(
				"task-1",
				{ id: "task-1", title: "Buy milk", completed: false },
				"2099-01-01T00:00:00.000Z|0001|a1b2",
			);
			resource.meta.deletedAt = "2099-01-01T00:05:00.000Z|0001|c3d4";
			resource.meta.latest = "2099-01-01T00:05:00.000Z|0001|c3d4";
			doc.resources[resource.id] = resource;

			db.tasks.merge(doc);

			expect(db.tasks.get("task-1")).toBeNull();
			expect(db.tasks.get("task-1", { includeDeleted: true })).toBeDefined();
		});

		test("merges within transaction", () => {
			const db = createTestDb();

			db.begin((tx) => {
				const doc = makeTaskDocument([
					{ id: "task-1", title: "Buy milk", completed: false },
				]);

				tx.tasks.merge(doc);

				const task = tx.tasks.get("task-1");
				expect(task?.title).toBe("Buy milk");
			});

			expect(db.tasks.get("task-1")?.title).toBe("Buy milk");
		});

		test("rolls back merge on transaction rollback", () => {
			const db = createTestDb();

			db.begin((tx) => {
				const doc = makeTaskDocument([
					{ id: "task-1", title: "Buy milk", completed: false },
				]);

				tx.tasks.merge(doc);
				tx.rollback();
			});

			expect(db.tasks.get("task-1")).toBeNull();
		});
	});

	describe("events", () => {
		test("emits add event", () => {
			const db = createTestDb();
			const events: any[] = [];
			db.tasks.on("mutation", (e) => events.push(e));

			db.tasks.add({ id: "1", title: "Buy milk", completed: false });

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
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "Buy milk", completed: false });

			const events: any[] = [];
			db.tasks.on("mutation", (e) => events.push(e));

			db.tasks.update("1", { completed: true });

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
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "Buy milk", completed: false });

			const events: any[] = [];
			db.tasks.on("mutation", (e) => events.push(e));

			db.tasks.remove("1");

			expect(events).toHaveLength(1);
			expect(events[0]).toEqual({
				added: [],
				updated: [],
				removed: [
					{ id: "1", item: { id: "1", title: "Buy milk", completed: false } },
				],
			});
		});

		test("emits merge add events", () => {
			const db = createTestDb();
			const events: any[] = [];
			db.tasks.on("mutation", (e) => events.push(e));

			const doc = makeTaskDocument([
				{ id: "task-1", title: "Buy milk", completed: false },
			]);

			db.tasks.merge(doc);

			expect(events).toHaveLength(1);
			expect(events[0].added).toHaveLength(1);
			expect(events[0].added[0].id).toBe("task-1");
		});

		test("emits merge update events", () => {
			const db = createTestDb();
			db.tasks.add({ id: "task-1", title: "Buy milk", completed: false });

			const events: any[] = [];
			db.tasks.on("mutation", (e) => events.push(e));

			const doc = makeTaskDocument(
				[{ id: "task-1", title: "Buy milk", completed: true }],
				"2099-01-01T00:05:00.000Z|0001|c3d4",
			);

			db.tasks.merge(doc);

			expect(events).toHaveLength(1);
			expect(events[0].updated).toHaveLength(1);
			expect(events[0].updated[0].before.completed).toBe(false);
			expect(events[0].updated[0].after.completed).toBe(true);
		});

		test("emits merge remove events", () => {
			const db = createTestDb();
			db.tasks.add({ id: "task-1", title: "Buy milk", completed: false });

			const events: any[] = [];
			db.tasks.on("mutation", (e) => events.push(e));

			const doc = makeTaskDocument([], "2099-01-01T00:05:00.000Z|0001|c3d4");
			const resource = makeResource(
				"task-1",
				{ id: "task-1", title: "Buy milk", completed: false },
				"2099-01-01T00:00:00.000Z|0001|a1b2",
			);
			resource.meta.deletedAt = "2099-01-01T00:05:00.000Z|0001|c3d4";
			resource.meta.latest = "2099-01-01T00:05:00.000Z|0001|c3d4";
			doc.resources[resource.id] = resource;

			db.tasks.merge(doc);

			expect(events).toHaveLength(1);
			expect(events[0].removed).toHaveLength(1);
			expect(events[0].removed[0].id).toBe("task-1");
			expect(events[0].removed[0].item.title).toBe("Buy milk");
		});

		test("supports unsubscribe", () => {
			const db = createTestDb();
			const events: any[] = [];
			const unsubscribe = db.tasks.on("mutation", (e) => events.push(e));

			db.tasks.add({ id: "1", title: "Task 1", completed: false });
			expect(events).toHaveLength(1);

			unsubscribe();
			db.tasks.add({ id: "2", title: "Task 2", completed: false });

			expect(events).toHaveLength(1);
		});

		test("batches events in transactions", () => {
			const db = createTestDb();
			const events: any[] = [];
			db.tasks.on("mutation", (e) => events.push(e));

			db.begin((tx) => {
				tx.tasks.add({ id: "1", title: "Task 1", completed: false });
				tx.tasks.add({ id: "2", title: "Task 2", completed: false });
				tx.tasks.add({ id: "3", title: "Task 3", completed: false });
			});

			expect(events).toHaveLength(1);
			expect(events[0].added).toHaveLength(3);
		});

		test("batches mixed operations in transactions", () => {
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "Task 1", completed: false });
			db.tasks.add({ id: "2", title: "Task 2", completed: false });

			const events: any[] = [];
			db.tasks.on("mutation", (e) => events.push(e));

			db.begin((tx) => {
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
			const db = createTestDb();
			const events: any[] = [];
			db.tasks.on("mutation", (e) => events.push(e));

			db.begin((tx) => {
				tx.tasks.add({ id: "1", title: "Task 1", completed: false });
				tx.rollback();
			});

			expect(events).toHaveLength(0);
		});

		test("emits no events on transaction exception", () => {
			const db = createTestDb();
			const events: any[] = [];
			db.tasks.on("mutation", (e) => events.push(e));

			try {
				db.begin((tx) => {
					tx.tasks.add({ id: "1", title: "Task 1", completed: false });
					throw new Error("Oops!");
				});
			} catch {
				// Expected
			}

			expect(events).toHaveLength(0);
		});

		test("batches merge events in transactions", () => {
			const db = createTestDb();
			const events: any[] = [];
			db.tasks.on("mutation", (e) => events.push(e));

			db.begin((tx) => {
				const doc = makeTaskDocument([
					{ id: "task-1", title: "Buy milk", completed: false },
				]);
				tx.tasks.merge(doc);
			});

			expect(events).toHaveLength(1);
			expect(events[0].added).toHaveLength(1);
		});

		test("discards merge events on rollback", () => {
			const db = createTestDb();
			const events: any[] = [];
			db.tasks.on("mutation", (e) => events.push(e));

			db.begin((tx) => {
				const doc = makeTaskDocument([
					{ id: "task-1", title: "Buy milk", completed: false },
				]);
				tx.tasks.merge(doc);
				tx.rollback();
			});

			expect(db.tasks.get("task-1")).toBeNull();
			expect(events).toHaveLength(0);
		});
	});

	describe("toDocument", () => {
		test("returns JsonDocument representation of current state", () => {
			const db = createTestDb();
			db.tasks.add({ id: "task-1", title: "Buy milk", completed: false });
			db.tasks.add({ id: "task-2", title: "Walk dog", completed: true });

			const doc = db.tasks.toDocument();

			expect(doc.type).toBe("tasks");
			expect(doc.latest).toBeDefined();
			expect(Object.keys(doc.resources)).toHaveLength(2);
			expect(doc.resources["task-1"]?.id).toBe("task-1");
			expect(doc.resources["task-1"]?.attributes.title).toBe("Buy milk");
			expect(doc.resources["task-2"]?.id).toBe("task-2");
			expect(doc.resources["task-2"]?.attributes.title).toBe("Walk dog");
		});

		test("returns empty document for empty collection", () => {
			const db = createTestDb();

			const doc = db.tasks.toDocument();

			expect(doc.latest).toBeDefined();
			expect(Object.keys(doc.resources)).toHaveLength(0);
		});

		test("includes soft-deleted items in document", () => {
			const db = createTestDb();
			db.tasks.add({ id: "task-1", title: "Buy milk", completed: false });
			db.tasks.remove("task-1");

			const doc = db.tasks.toDocument();

			expect(Object.keys(doc.resources)).toHaveLength(1);
			expect(doc.resources["task-1"]?.meta.deletedAt).toBeDefined();
			expect(doc.resources["task-1"]?.meta.deletedAt).not.toBeNull();
		});

		test("includes correct latest eventstamp", () => {
			const db = createTestDb();
			db.tasks.add({ id: "task-1", title: "Buy milk", completed: false });
			db.tasks.add({ id: "task-2", title: "Walk dog", completed: true });

			const doc = db.tasks.toDocument();

			// The latest should be the maximum of all resource eventstamps
			expect(doc.latest).toBeDefined();
			expect(typeof doc.latest).toBe("string");

			// Verify it matches the format
			expect(doc.latest).toMatch(
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[0-9a-f]+\|[0-9a-f]+$/,
			);
		});
	});
});
