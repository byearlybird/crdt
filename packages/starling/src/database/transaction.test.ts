import { describe, expect, test } from "bun:test";
import { createMultiCollectionDb, createTestDb } from "./test-helpers";

describe("Transactions", () => {
	describe("commit", () => {
		test("commits changes on successful completion", () => {
			const db = createTestDb();

			db.begin(["tasks"], (tx) => {
				tx.tasks.add({ id: "1", title: "Task 1", completed: false });
				tx.tasks.add({ id: "2", title: "Task 2", completed: false });
			});

			expect(db.tasks.get("1")?.title).toBe("Task 1");
			expect(db.tasks.get("2")?.title).toBe("Task 2");
		});

		test("returns callback result", () => {
			const db = createTestDb();

			const result = db.begin(["tasks"], (tx) => {
				const task = tx.tasks.add({ id: "1", title: "Test", completed: false });
				return task;
			});

			expect(result.id).toBe("1");
			expect(result.title).toBe("Test");
		});

		test("commits changes across multiple collections", () => {
			const db = createMultiCollectionDb();

			db.begin(["tasks", "users"], (tx) => {
				tx.tasks.add({ id: "1", title: "Task 1", completed: false });
				tx.users.add({ id: "1", name: "Alice", email: "alice@example.com" });
			});

			expect(db.tasks.get("1")?.title).toBe("Task 1");
			expect(db.users.get("1")?.name).toBe("Alice");
		});
	});

	describe("rollback", () => {
		test("discards changes on explicit rollback", () => {
			const db = createTestDb();

			db.begin(["tasks"], (tx) => {
				tx.tasks.add({
					id: "1",
					title: "Should not persist",
					completed: false,
				});
				tx.rollback();
			});

			expect(db.tasks.get("1")).toBeNull();
		});

		test("discards changes on exception", () => {
			const db = createTestDb();

			try {
				db.begin(["tasks"], (tx) => {
					tx.tasks.add({
						id: "1",
						title: "Should not persist",
						completed: false,
					});
					throw new Error("Transaction failed");
				});
			} catch {
				// Expected
			}

			expect(db.tasks.get("1")).toBeNull();
		});

		test("rolls back all collections", () => {
			const db = createMultiCollectionDb();

			db.begin(["tasks", "users"], (tx) => {
				tx.tasks.add({ id: "1", title: "Task 1", completed: false });
				tx.users.add({ id: "1", name: "Alice", email: "alice@example.com" });
				tx.rollback();
			});

			expect(db.tasks.get("1")).toBeNull();
			expect(db.users.get("1")).toBeNull();
		});

		test("prevents remove operation from persisting", () => {
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "Task to keep", completed: false });

			db.begin(["tasks"], (tx) => {
				tx.tasks.remove("1");
				tx.rollback();
			});

			expect(db.tasks.get("1")?.title).toBe("Task to keep");
		});
	});

	describe("isolation", () => {
		test("sees snapshot of data at transaction start", () => {
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "Original", completed: false });

			db.begin(["tasks"], (tx) => {
				const task = tx.tasks.get("1");
				expect(task?.title).toBe("Original");

				tx.tasks.update("1", { title: "Updated" });

				const updatedTask = tx.tasks.get("1");
				expect(updatedTask?.title).toBe("Updated");
			});

			expect(db.tasks.get("1")?.title).toBe("Updated");
		});

		test("supports chained operations on same resource", () => {
			const db = createTestDb();

			db.begin(["tasks"], (tx) => {
				tx.tasks.add({ id: "1", title: "New Task", completed: false });
				tx.tasks.update("1", { completed: true });
				tx.tasks.update("1", { title: "Modified Task" });

				const task = tx.tasks.get("1");
				expect(task?.title).toBe("Modified Task");
				expect(task?.completed).toBe(true);
			});

			const task = db.tasks.get("1");
			expect(task?.title).toBe("Modified Task");
			expect(task?.completed).toBe(true);
		});

		test("supports queries within transaction", () => {
			const db = createTestDb();
			db.tasks.add({ id: "1", title: "Task 1", completed: false });
			db.tasks.add({ id: "2", title: "Task 2", completed: true });

			db.begin(["tasks"], (tx) => {
				tx.tasks.add({ id: "3", title: "Task 3", completed: false });

				const incomplete = tx.tasks.find((task) => !task.completed);
				expect(incomplete).toHaveLength(2);

				const all = tx.tasks.getAll();
				expect(all).toHaveLength(3);
			});
		});
	});
});
