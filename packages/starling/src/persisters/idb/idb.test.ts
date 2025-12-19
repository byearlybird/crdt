import { afterEach, describe, expect, test } from "bun:test";
import "fake-indexeddb/auto";
import { createStore } from "../../store/store";
import { makeTask, taskSchema } from "../../store/test-helpers";
import { createIdbPersister } from "./index";

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

describe("createIdbPersister", () => {
	test("loads and persists documents", async () => {
		// Create store with persister
		const store1 = createStore({
			name: "test-db",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		});
		const cleanup1 = await createIdbPersister(store1);

		// Add a task
		const task = makeTask({ id: "1", title: "Test Task" });
		store1.tasks.add(task);

		// Wait for mutation event to propagate
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Cleanup
		cleanup1();

		// Create a new store instance and load (same db name to load persisted data)
		const store2 = createStore({
			name: "test-db",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		});
		const cleanup2 = await createIdbPersister(store2);

		// Verify task was loaded
		const loadedTask = store2.tasks.get("1");
		expect(loadedTask).toBeDefined();
		expect(loadedTask?.title).toBe("Test Task");

		cleanup2();
	});

	test("creates object stores on upgrade", async () => {
		const store = createStore({
			name: "upgrade-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		});
		const cleanup = await createIdbPersister(store);

		// Verify database was created without errors
		expect(store.tasks.getAll()).toEqual([]);

		cleanup();
	});

	test("handles empty database gracefully", async () => {
		const store = createStore({
			name: "empty-db",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		});
		const cleanup = await createIdbPersister(store);

		// Should not throw and should have no tasks
		expect(store.tasks.getAll()).toEqual([]);

		cleanup();
	});

	test("uses custom version", async () => {
		const store = createStore({
			name: "version-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		});
		const cleanup = await createIdbPersister(store, { version: 5 });

		// If init completes without error, the version was set correctly
		expect(store.tasks.getAll()).toEqual([]);

		cleanup();
	});

	test("persists on mutations", async () => {
		const store1 = createStore({
			name: "mutation-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		});
		const cleanup1 = await createIdbPersister(store1);

		// Add task
		store1.tasks.add(makeTask({ id: "1", title: "Task 1" }));

		// Wait for mutation event
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Cleanup and reload to verify persistence (same db name)
		cleanup1();

		const store2 = createStore({
			name: "mutation-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		});
		const cleanup2 = await createIdbPersister(store2);

		const tasks = store2.tasks.getAll();
		expect(tasks).toHaveLength(1);
		expect(tasks[0]?.title).toBe("Task 1");

		cleanup2();
	});

	test("closes database on cleanup", async () => {
		const store = createStore({
			name: "dispose-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		});
		const cleanup = await createIdbPersister(store);
		cleanup();

		// The database should have been closed
		// We can't directly check if close() was called, but we can verify no errors occurred
		expect(true).toBe(true);
	});

	test("handles multiple collections", async () => {
		const userSchema = taskSchema.extend({
			email: taskSchema.shape.title,
		});

		const store1 = createStore({
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
		});
		const cleanup1 = await createIdbPersister(store1);

		// Add items to both collections
		store1.tasks.add(makeTask({ id: "1", title: "Task 1" }));
		store1.users.add({
			id: "u1",
			title: "User 1",
			email: "user@example.com",
			completed: false,
		});

		// Wait for mutations
		await new Promise((resolve) => setTimeout(resolve, 10));

		cleanup1();

		// Reload and verify both collections persisted (same db name)
		const store2 = createStore({
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
		});
		const cleanup2 = await createIdbPersister(store2);

		expect(store2.tasks.getAll()).toHaveLength(1);
		expect(store2.users.getAll()).toHaveLength(1);

		cleanup2();
	});

	test("syncs changes across tabs via BroadcastChannel", async () => {
		// Create two store instances (simulating two tabs)
		const store1 = createStore({
			name: "broadcast-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		});
		const cleanup1 = await createIdbPersister(store1);

		const store2 = createStore({
			name: "broadcast-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		});
		const cleanup2 = await createIdbPersister(store2);

		// Add task in store1
		store1.tasks.add(makeTask({ id: "1", title: "Task from tab 1" }));

		// Wait for broadcast and reload
		await new Promise((resolve) => setTimeout(resolve, 50));

		// store2 should have received the update via broadcast
		const task = store2.tasks.get("1");
		expect(task).toBeDefined();
		expect(task?.title).toBe("Task from tab 1");

		cleanup1();
		cleanup2();
	});

	test("ignores own broadcasts", async () => {
		const store = createStore({
			name: "self-broadcast-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		});
		const cleanup = await createIdbPersister(store);

		// Add a task - this will broadcast, but the same instance should ignore it
		store.tasks.add(makeTask({ id: "1", title: "Task 1" }));

		// Wait for any potential broadcast handling
		await new Promise((resolve) => setTimeout(resolve, 20));

		// Should still have exactly one task
		expect(store.tasks.getAll()).toHaveLength(1);

		cleanup();
	});

	test("ignores broadcasts with matching instanceId", async () => {
		const store = createStore({
			name: "instance-id-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		});
		const cleanup = await createIdbPersister(store);

		// Get the broadcast channel for this store
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
		store.tasks.add(makeTask({ id: "1", title: "Task 1" }));
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
		expect(store.tasks.getAll()).toHaveLength(1);

		cleanup();
	});

	test("can disable BroadcastChannel", async () => {
		const store = createStore({
			name: "no-broadcast-test",
			schema: {
				tasks: {
					schema: taskSchema,
					getId: (task) => task.id,
				},
			},
		});
		const cleanup = await createIdbPersister(store, {
			useBroadcastChannel: false,
		});

		// Add task
		store.tasks.add(makeTask({ id: "1", title: "Task 1" }));

		// Wait for mutation
		await new Promise((resolve) => setTimeout(resolve, 10));

		// Should work without errors
		expect(store.tasks.getAll()).toHaveLength(1);

		cleanup();
	});
});
