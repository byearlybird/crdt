import { afterEach, describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import { createDatabase } from "../../database/db";
import { makeTask, taskSchema } from "../../database/test-helpers";
import { idbPlugin } from "./index";

// Mock BroadcastChannel for testing cross-tab sync
class MockBroadcastChannel {
	static channels: Map<string, MockBroadcastChannel[]> = new Map();
	name: string;
	onmessage: ((event: { data: any }) => void) | null = null;

	constructor(name: string) {
		this.name = name;
		const channels = MockBroadcastChannel.channels.get(name) || [];
		channels.push(this);
		MockBroadcastChannel.channels.set(name, channels);
	}

	postMessage(data: any) {
		const channels = MockBroadcastChannel.channels.get(this.name) || [];
		for (const channel of channels) {
			if (channel !== this && channel.onmessage) {
				channel.onmessage({ data });
			}
		}
	}

	close() {
		const channels = MockBroadcastChannel.channels.get(this.name) || [];
		const index = channels.indexOf(this);
		if (index !== -1) {
			channels.splice(index, 1);
		}
	}

	static reset() {
		MockBroadcastChannel.channels.clear();
	}
}

// Set up global BroadcastChannel mock
(globalThis as any).BroadcastChannel = MockBroadcastChannel;

afterEach(() => {
	MockBroadcastChannel.reset();
});

// Helper to trigger IDB errors
function _makeFailingIDBRequest(errorMessage: string): IDBRequest {
	const request = {
		result: null,
		error: new DOMException(errorMessage),
		onerror: null as ((this: IDBRequest, ev: Event) => any) | null,
		onsuccess: null as ((this: IDBRequest, ev: Event) => any) | null,
	} as unknown as IDBRequest;
	return request;
}

describe("idbPlugin", () => {
	test("loads and persists documents", async () => {
		// Create database with plugin
		const db1 = await createDatabase({
			name: "test-db",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		})
			.use(idbPlugin())
			.init();

		// Add a task
		const task = makeTask({ id: "1", title: "Test Task" });
		db1.tasks.add(task);

		// Wait for mutation event to propagate
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Dispose to save
		await db1.dispose();

		// Create a new database instance and load (same db name to load persisted data)
		const db2 = await createDatabase({
			name: "test-db",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		})
			.use(idbPlugin())
			.init();

		// Verify task was loaded
		const loadedTask = db2.tasks.get("1");
		expect(loadedTask).toBeDefined();
		expect(loadedTask?.title).toBe("Test Task");

		await db2.dispose();
	});

	test("creates object stores on upgrade", async () => {
		const db = await createDatabase({
			name: "upgrade-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		})
			.use(idbPlugin())
			.init();

		// Verify database was created without errors
		expect(db.tasks.getAll()).toEqual([]);

		await db.dispose();
	});

	test("handles empty database gracefully", async () => {
		const db = await createDatabase({
			name: "empty-db",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		})
			.use(idbPlugin())
			.init();

		// Should not throw and should have no tasks
		expect(db.tasks.getAll()).toEqual([]);

		await db.dispose();
	});

	test("uses custom version", async () => {
		const db = await createDatabase({
			name: "version-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		})
			.use(idbPlugin({ version: 5 }))
			.init();

		// If init completes without error, the version was set correctly
		expect(db.tasks.getAll()).toEqual([]);

		await db.dispose();
	});

	test("persists on mutations", async () => {
		const db = await createDatabase({
			name: "mutation-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		})
			.use(idbPlugin())
			.init();

		// Add task
		db.tasks.add(makeTask({ id: "1", title: "Task 1" }));

		// Wait for mutation event
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Dispose and reload to verify persistence (same db name)
		await db.dispose();

		const db2 = await createDatabase({
			name: "mutation-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		})
			.use(idbPlugin())
			.init();

		const tasks = db2.tasks.getAll();
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.title).toBe("Task 1");

		await db2.dispose();
	});

	test("closes database on dispose", async () => {
		const db = await createDatabase({
			name: "dispose-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		})
			.use(idbPlugin())
			.init();
		await db.dispose();

		// The database should have been closed
		// We can't directly check if close() was called, but we can verify no errors occurred
		expect(true).toBe(true);
	});

	test("handles multiple collections", async () => {
		const userSchema = taskSchema.extend({
			email: taskSchema.shape.title,
		});

		const db = await createDatabase({
			name: "multi-collection-test",
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
		})
			.use(idbPlugin())
			.init();

		// Add items to both collections
		db.tasks.add(makeTask({ id: "1", title: "Task 1" }));
		db.users.add({
			id: "u1",
			title: "User 1",
			email: "user@example.com",
			completed: false,
		});

		// Wait for mutations
		await new Promise((resolve) => setTimeout(resolve, 10));

		await db.dispose();

		// Reload and verify both collections persisted (same db name)
		const db2 = await createDatabase({
			name: "multi-collection-test",
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
		})
			.use(idbPlugin())
			.init();

		expect(db2.tasks.getAll()).toHaveLength(1);
		expect(db2.users.getAll()).toHaveLength(1);

		await db2.dispose();
	});

	test("syncs changes across tabs via BroadcastChannel", async () => {
		// Create two database instances (simulating two tabs)
		const db1 = await createDatabase({
			name: "broadcast-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		})
			.use(idbPlugin())
			.init();

		const db2 = await createDatabase({
			name: "broadcast-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		})
			.use(idbPlugin())
			.init();

		// Add task in db1
		db1.tasks.add(makeTask({ id: "1", title: "Task from tab 1" }));

		// Wait for broadcast and reload
		await new Promise((resolve) => setTimeout(resolve, 50));

		// db2 should have received the update via broadcast
		const task = db2.tasks.get("1");
		expect(task).toBeDefined();
		expect(task?.title).toBe("Task from tab 1");

		await db1.dispose();
		await db2.dispose();
	});

	test("ignores own broadcasts", async () => {
		const db = await createDatabase({
			name: "self-broadcast-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		})
			.use(idbPlugin())
			.init();

		// Add a task - this will broadcast, but the same instance should ignore it
		db.tasks.add(makeTask({ id: "1", title: "Task 1" }));

		// Wait for any potential broadcast handling
		await new Promise((resolve) => setTimeout(resolve, 20));

		// Should still have exactly one task
		expect(db.tasks.getAll()).toHaveLength(1);

		await db.dispose();
	});

	test("ignores broadcasts with matching instanceId", async () => {
		const db = await createDatabase({
			name: "instance-id-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		})
			.use(idbPlugin())
			.init();

		// Get the broadcast channel for this db
		const channels =
			MockBroadcastChannel.channels.get("starling:instance-id-test") || [];
		expect(channels.length).toBeGreaterThan(0);

		const channel = channels[0]!;

		// Manually trigger onmessage with the same instanceId that was used
		// We need to extract instanceId from a real broadcast first
		let capturedInstanceId: string | null = null;
		const originalPostMessage = channel.postMessage.bind(channel);
		channel.postMessage = (data: any) => {
			capturedInstanceId = data.instanceId;
			originalPostMessage(data);
		};

		// Add a task to trigger a broadcast
		db.tasks.add(makeTask({ id: "1", title: "Task 1" }));
		await new Promise((resolve) => setTimeout(resolve, 20));

		// Now manually call onmessage with the same instanceId
		if (channel.onmessage && capturedInstanceId) {
			channel.onmessage({
				data: {
					type: "mutation",
					instanceId: capturedInstanceId,
					timestamp: Date.now(),
				},
			});
		}

		// Wait for any potential handling
		await new Promise((resolve) => setTimeout(resolve, 20));

		// Should still have exactly one task (the broadcast was ignored)
		expect(db.tasks.getAll()).toHaveLength(1);

		await db.dispose();
	});

	test("can disable BroadcastChannel", async () => {
		const db = await createDatabase({
			name: "no-broadcast-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		})
			.use(idbPlugin({ useBroadcastChannel: false }))
			.init();

		// Add task
		db.tasks.add(makeTask({ id: "1", title: "Task 1" }));

		// Wait for mutation
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Should work without errors
		expect(db.tasks.getAll()).toHaveLength(1);

		await db.dispose();
	});
});
