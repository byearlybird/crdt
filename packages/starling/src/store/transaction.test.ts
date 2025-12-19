import { describe, expect, test } from "bun:test";
import { createMultiCollectionStore, createTestStore } from "./test-helpers";

describe("Transactions", () => {
	describe("commit", () => {
		test("commits changes on successful completion", () => {
			const store = createTestStore();

			store.transact(["tasks"], (tx) => {
				tx.tasks.add({ id: "1", title: "Task 1", completed: false });
				tx.tasks.add({ id: "2", title: "Task 2", completed: false });
			});

			expect(store.tasks.get("1")?.title).toBe("Task 1");
			expect(store.tasks.get("2")?.title).toBe("Task 2");
		});

		test("returns callback result", () => {
			const store = createTestStore();

			const result = store.transact(["tasks"], (tx) => {
				const task = tx.tasks.add({ id: "1", title: "Test", completed: false });
				return task;
			});

			expect(result.id).toBe("1");
			expect(result.title).toBe("Test");
		});

		test("commits changes across multiple collections", () => {
			const store = createMultiCollectionStore();

			store.transact(["tasks", "users"], (tx) => {
				tx.tasks.add({ id: "1", title: "Task 1", completed: false });
				tx.users.add({ id: "1", name: "Alice", email: "alice@example.com" });
			});

			expect(store.tasks.get("1")?.title).toBe("Task 1");
			expect(store.users.get("1")?.name).toBe("Alice");
		});
	});

	describe("rollback", () => {
		test("discards changes on explicit rollback", () => {
			const store = createTestStore();

			store.transact(["tasks"], (tx) => {
				tx.tasks.add({
					id: "1",
					title: "Should not persist",
					completed: false,
				});
				tx.rollback();
			});

			expect(store.tasks.get("1")).toBeNull();
		});

		test("discards changes on exception", () => {
			const store = createTestStore();

			try {
				store.transact(["tasks"], (tx) => {
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

			expect(store.tasks.get("1")).toBeNull();
		});

		test("rolls back all collections", () => {
			const store = createMultiCollectionStore();

			store.transact(["tasks", "users"], (tx) => {
				tx.tasks.add({ id: "1", title: "Task 1", completed: false });
				tx.users.add({ id: "1", name: "Alice", email: "alice@example.com" });
				tx.rollback();
			});

			expect(store.tasks.get("1")).toBeNull();
			expect(store.users.get("1")).toBeNull();
		});

		test("prevents remove operation from persisting", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "Task to keep", completed: false });

			store.transact(["tasks"], (tx) => {
				tx.tasks.remove("1");
				tx.rollback();
			});

			expect(store.tasks.get("1")?.title).toBe("Task to keep");
		});
	});

	describe("isolation", () => {
		test("sees snapshot of data at transaction start", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "Original", completed: false });

			store.transact(["tasks"], (tx) => {
				const task = tx.tasks.get("1");
				expect(task?.title).toBe("Original");

				tx.tasks.update("1", { title: "Updated" });

				const updatedTask = tx.tasks.get("1");
				expect(updatedTask?.title).toBe("Updated");
			});

			expect(store.tasks.get("1")?.title).toBe("Updated");
		});

		test("supports chained operations on same resource", () => {
			const store = createTestStore();

			store.transact(["tasks"], (tx) => {
				tx.tasks.add({ id: "1", title: "New Task", completed: false });
				tx.tasks.update("1", { completed: true });
				tx.tasks.update("1", { title: "Modified Task" });

				const task = tx.tasks.get("1");
				expect(task?.title).toBe("Modified Task");
				expect(task?.completed).toBe(true);
			});

			const task = store.tasks.get("1");
			expect(task?.title).toBe("Modified Task");
			expect(task?.completed).toBe(true);
		});

		test("supports queries within transaction", () => {
			const store = createTestStore();
			store.tasks.add({ id: "1", title: "Task 1", completed: false });
			store.tasks.add({ id: "2", title: "Task 2", completed: true });

			store.transact(["tasks"], (tx) => {
				tx.tasks.add({ id: "3", title: "Task 3", completed: false });

				const incomplete = tx.tasks.find((task) => !task.completed);
				expect(incomplete).toHaveLength(2);

				const all = tx.tasks.getAll();
				expect(all).toHaveLength(3);
			});
		});
	});
});
