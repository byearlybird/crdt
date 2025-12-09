import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { createDatabase } from "./db";
import { createMultiCollectionDb, createTestDb } from "./test-helpers";

describe("Database", () => {
	describe("initialization", () => {
		test("creates database with typed collections", () => {
			const db = createTestDb();

			expect(db.tasks).toBeDefined();
			expect(typeof db.tasks.add).toBe("function");
			expect(typeof db.tasks.get).toBe("function");
			expect(typeof db.tasks.update).toBe("function");
			expect(typeof db.tasks.remove).toBe("function");
			expect(typeof db.begin).toBe("function");
		});

		test("creates multiple collections", () => {
			const db = createMultiCollectionDb();

			expect(db.tasks).toBeDefined();
			expect(db.users).toBeDefined();
			expect(typeof db.begin).toBe("function");
		});

		test("supports custom getId functions", () => {
			const db = createDatabase({
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

			const item = db.kv.add({ key: "foo", value: "bar" });
			expect(db.kv.get("foo")).toEqual(item);
		});
	});

	describe("API surface", () => {
		test("provides collection CRUD methods", () => {
			const db = createTestDb();

			db.tasks.add({ id: "1", title: "Task 1", completed: false });
			expect(db.tasks.get("1")?.title).toBe("Task 1");

			db.tasks.update("1", { completed: true });
			expect(db.tasks.get("1")?.completed).toBe(true);

			db.tasks.remove("1");
			expect(db.tasks.get("1")).toBeNull();
		});

		test("provides transaction method", () => {
			const db = createTestDb();

			const result = db.begin((tx) => {
				tx.tasks.add({ id: "1", title: "Test", completed: false });
				return "success";
			});

			expect(result).toBe("success");
			expect(db.tasks.get("1")?.title).toBe("Test");
		});

		test("provides event subscription", () => {
			const db = createTestDb();
			const events: any[] = [];

			db.on("mutation", (e) => events.push(e));
			db.tasks.add({ id: "1", title: "Test", completed: false });

			expect(events).toHaveLength(1);
		});
	});

	describe("events", () => {
		test("emits events with collection name", () => {
			const db = createTestDb();
			const dbEvents: any[] = [];
			db.on("mutation", (e) => dbEvents.push(e));

			db.tasks.add({ id: "1", title: "Task 1", completed: false });

			expect(dbEvents).toHaveLength(1);
			expect(dbEvents[0].collection).toBe("tasks");
			expect(dbEvents[0].added).toHaveLength(1);
		});

		test("emits events from multiple collections", () => {
			const db = createMultiCollectionDb();
			const dbEvents: any[] = [];
			db.on("mutation", (e) => dbEvents.push(e));

			db.begin((tx) => {
				tx.tasks.add({ id: "1", title: "Task 1", completed: false });
				tx.users.add({ id: "u1", name: "Alice", email: "alice@example.com" });
			});

			expect(dbEvents).toHaveLength(2);

			const tasksEvent = dbEvents.find((e) => e.collection === "tasks");
			expect(tasksEvent.added).toHaveLength(1);

			const usersEvent = dbEvents.find((e) => e.collection === "users");
			expect(usersEvent.added).toHaveLength(1);
		});

		test("keeps database subscriptions active after transactions", () => {
			const db = createTestDb();
			const events: any[] = [];
			db.on("mutation", (e) => events.push(e));

			db.begin((tx) => {
				tx.tasks.add({ id: "1", title: "Tx Task", completed: false });
			});

			db.tasks.add({ id: "2", title: "Outside Task", completed: false });

			expect(events).toHaveLength(2);
			expect(events[0].collection).toBe("tasks");
			expect(events[1].collection).toBe("tasks");
		});

		test("keeps collection subscriptions active after transactions", () => {
			const db = createTestDb();
			const events: any[] = [];
			db.tasks.on("mutation", (e) => events.push(e));

			db.begin((tx) => {
				tx.tasks.add({ id: "1", title: "Tx Task", completed: false });
			});

			db.tasks.add({ id: "2", title: "Outside Task", completed: false });

			expect(events).toHaveLength(2);
			expect(events[0].added).toHaveLength(1);
			expect(events[1].added).toHaveLength(1);
		});
	});

	describe("toDocuments", () => {
		test("returns documents for all collections", () => {
			const db = createMultiCollectionDb();
			db.tasks.add({ id: "task-1", title: "Buy milk", completed: false });
			db.tasks.add({ id: "task-2", title: "Walk dog", completed: true });
			db.users.add({ id: "user-1", name: "Alice", email: "alice@example.com" });

			const documents = db.toDocuments();

			expect(documents.tasks).toBeDefined();
			expect(documents.users).toBeDefined();
			expect(Object.keys(documents.tasks.resources)).toHaveLength(2);
			expect(Object.keys(documents.users.resources)).toHaveLength(1);
		});

		test("returns empty documents for empty collections", () => {
			const db = createMultiCollectionDb();

			const documents = db.toDocuments();

			expect(documents.tasks).toBeDefined();
			expect(documents.users).toBeDefined();
			expect(Object.keys(documents.tasks.resources)).toHaveLength(0);
			expect(Object.keys(documents.users.resources)).toHaveLength(0);
			expect(documents.tasks.latest).toBeDefined();
			expect(documents.users.latest).toBeDefined();
		});

		test("includes soft-deleted items in documents", () => {
			const db = createTestDb();
			db.tasks.add({ id: "task-1", title: "Buy milk", completed: false });
			db.tasks.remove("task-1");

			const documents = db.toDocuments();

			expect(Object.keys(documents.tasks.resources)).toHaveLength(1);
			expect(
				Object.values(documents.tasks.resources)[0]?.meta.deletedAt,
			).toBeDefined();
			expect(
				Object.values(documents.tasks.resources)[0]?.meta.deletedAt,
			).not.toBeNull();
		});

		test("includes correct latest eventstamps for each collection", () => {
			const db = createMultiCollectionDb();
			db.tasks.add({ id: "task-1", title: "Buy milk", completed: false });
			db.users.add({ id: "user-1", name: "Alice", email: "alice@example.com" });

			const documents = db.toDocuments();

			expect(documents.tasks.latest).toBeDefined();
			expect(documents.users.latest).toBeDefined();
			expect(typeof documents.tasks.latest).toBe("string");
			expect(typeof documents.users.latest).toBe("string");
			expect(documents.tasks.latest).toMatch(
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[0-9a-f]+\|[0-9a-f]+$/,
			);
			expect(documents.users.latest).toMatch(
				/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z\|[0-9a-f]+\|[0-9a-f]+$/,
			);
		});
	});

	describe("plugins", () => {
		test("init handlers execute in registration order", async () => {
			const calls: string[] = [];

			const db = createDatabase({
				name: "plugins-db",
				schema: {
					tasks: {
						schema: z.object({
							id: z.string(),
							title: z.string(),
							completed: z.boolean(),
						}),
						getId: (task) => task.id,
					},
				},
			})
				.use({ handlers: { init: () => calls.push("1") } })
				.use({ handlers: { init: () => calls.push("2") } })
				.use({ handlers: { init: () => calls.push("3") } });

			await db.init();
			expect(calls).toEqual(["1", "2", "3"]);
		});

		test("dispose handlers execute in reverse order", async () => {
			const calls: string[] = [];

			const db = createDatabase({
				name: "plugins-db",
				schema: {
					tasks: {
						schema: z.object({
							id: z.string(),
							title: z.string(),
							completed: z.boolean(),
						}),
						getId: (task) => task.id,
					},
				},
			})
				.use({ handlers: { dispose: () => calls.push("1") } })
				.use({ handlers: { dispose: () => calls.push("2") } })
				.use({ handlers: { dispose: () => calls.push("3") } });

			await db.dispose();
			expect(calls).toEqual(["3", "2", "1"]);
		});

		test("plugins can perform database operations", async () => {
			const db = createDatabase({
				name: "plugins-db",
				schema: {
					tasks: {
						schema: z.object({
							id: z.string(),
							title: z.string(),
							completed: z.boolean(),
						}),
						getId: (task) => task.id,
					},
				},
			}).use({
				handlers: {
					init: (db) => {
						db.tasks.add({
							id: "1",
							title: "Added by plugin",
							completed: false,
						});
					},
				},
			});

			await db.init();
			expect(db.tasks.get("1")?.title).toBe("Added by plugin");
		});

		test("async handlers work correctly", async () => {
			const calls: string[] = [];

			const db = createDatabase({
				name: "plugins-db",
				schema: {
					tasks: {
						schema: z.object({
							id: z.string(),
							title: z.string(),
							completed: z.boolean(),
						}),
						getId: (task) => task.id,
					},
				},
			}).use({
				handlers: {
					init: async () => {
						await new Promise((resolve) => setTimeout(resolve, 10));
						calls.push("init");
					},
					dispose: async () => {
						await new Promise((resolve) => setTimeout(resolve, 10));
						calls.push("dispose");
					},
				},
			});

			await db.init();
			await db.dispose();
			expect(calls).toEqual(["init", "dispose"]);
		});

		test("plugins can subscribe to mutation events", async () => {
			const pluginEvents: any[] = [];

			const db = createDatabase({
				name: "plugins-db",
				schema: {
					tasks: {
						schema: z.object({
							id: z.string(),
							title: z.string(),
							completed: z.boolean(),
						}),
						getId: (task) => task.id,
					},
				},
			}).use({
				handlers: {
					init: (db) => {
						db.on("mutation", (event) => pluginEvents.push(event));
					},
				},
			});

			await db.init();
			db.tasks.add({ id: "1", title: "Test", completed: false });

			expect(pluginEvents).toHaveLength(1);
			expect(pluginEvents[0].collection).toBe("tasks");
		});

		test("works without plugins", async () => {
			const db = createTestDb();
			await db.init();
			await db.dispose();
			db.tasks.add({ id: "1", title: "Test", completed: false });
			expect(db.tasks.get("1")).toBeDefined();
		});
	});
});
