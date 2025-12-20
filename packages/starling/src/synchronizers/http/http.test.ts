import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { makeDocument, makeResource } from "../../state";
import { createStore } from "../../store/store";
import { makeTask, taskSchema } from "../../store/test-helpers";
import type { StoreState } from "../../store/types";
import { createHttpSynchronizer, type RequestContext } from "./index";

// Mock fetch
let mockFetch: ReturnType<typeof mock>;
let consoleErrorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
	mockFetch = mock(() =>
		Promise.resolve({
			ok: true,
			json: () => Promise.resolve(makeEmptySnapshot()),
		}),
	);
	globalThis.fetch = mockFetch as unknown as typeof fetch;
	consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	mockFetch.mockRestore?.();
	consoleErrorSpy.mockRestore();
});

// Helper to create an empty store snapshot
function makeEmptySnapshot(storeName = "test-app"): StoreState<any> {
	const tasksDoc = makeDocument("tasks");
	return {
		version: "1.0",
		name: storeName,
		latest: "2099-01-01T00:00:00.000Z|0001|a1b2",
		documents: {
			tasks: tasksDoc,
		},
	};
}

// Helper to create a store snapshot with tasks
function makeTaskSnapshot(
	tasks: Array<{ id: string; title: string; completed: boolean }>,
	eventstamp = "2099-01-01T00:00:00.000Z|0001|a1b2",
	dbName = "test-app",
): StoreState<any> {
	const tasksDoc = makeDocument<{
		id: string;
		title: string;
		completed: boolean;
	}>("tasks");
	for (const task of tasks) {
		tasksDoc.resources[task.id] = makeResource(task.id, task, eventstamp);
	}
	return {
		version: "1.0",
		name: dbName,
		latest: eventstamp,
		documents: {
			tasks: tasksDoc,
		},
	};
}

describe("createHttpSynchronizer", () => {
	describe("initialization", () => {
		test("fetches store snapshot on init", async () => {
			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 60000, // Long interval to prevent polling during test
			});

			// Wait for initial fetch
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Should have made a single GET request for store snapshot
			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch.mock.calls[0]?.[0]).toBe(
				"https://api.example.com/database/test-app",
			);
			expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({
				method: "GET",
			});

			cleanup();
		});

		test("merges fetched snapshot into store", async () => {
			const snapshot = makeTaskSnapshot([
				{ id: "server-1", title: "Server Task", completed: false },
			]);

			mockFetch.mockImplementation(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve(snapshot),
				}),
			);

			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 60000,
			});

			// Wait for initial fetch and merge
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Should have merged server data
			const task = store.tasks.get("server-1");
			expect(task).toBeDefined();
			expect(task?.title).toBe("Server Task");

			cleanup();
		});

		test("handles fetch failure gracefully on init", async () => {
			mockFetch.mockImplementation(() => {
				return Promise.reject(new Error("Network error"));
			});

			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 60000,
			});

			// Wait for init attempt
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Should have attempted fetch once
			expect(mockFetch).toHaveBeenCalledTimes(1);
			// Should have logged error
			expect(consoleErrorSpy).toHaveBeenCalled();

			cleanup();
		});
	});

	describe("polling", () => {
		test("polls server at configured interval", async () => {
			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 50, // Short interval for testing
			});

			// Initial fetch
			await new Promise((resolve) => setTimeout(resolve, 10));
			const initialCalls = mockFetch.mock.calls.length;

			// Wait for polling
			await new Promise((resolve) => setTimeout(resolve, 120));

			// Should have polled at least once more
			expect(mockFetch.mock.calls.length).toBeGreaterThan(initialCalls);

			cleanup();
		});

		test("stops polling on cleanup", async () => {
			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 50,
			});

			await new Promise((resolve) => setTimeout(resolve, 10));
			cleanup();

			const callsAfterCleanup = mockFetch.mock.calls.length;

			// Wait longer than polling interval
			await new Promise((resolve) => setTimeout(resolve, 120));

			// Should not have made any more calls
			expect(mockFetch.mock.calls.length).toBe(callsAfterCleanup);
		});
	});

	describe("push on mutation", () => {
		test("pushes store snapshot to server after mutation", async () => {
			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 60000,
				debounceDelay: 10, // Short debounce for testing
			});

			// Wait for init
			await new Promise((resolve) => setTimeout(resolve, 10));

			// Clear initial fetch call
			mockFetch.mockClear();

			// Add a task
			store.tasks.add(makeTask({ id: "local-1", title: "Local Task" }));

			// Wait for debounce
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Should have pushed store snapshot
			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch.mock.calls[0]?.[0]).toBe(
				"https://api.example.com/database/test-app",
			);
			expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({
				method: "PATCH",
			});

			cleanup();
		});

		test("debounces multiple rapid mutations", async () => {
			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 60000,
				debounceDelay: 50,
			});

			await new Promise((resolve) => setTimeout(resolve, 10));
			mockFetch.mockClear();

			// Multiple rapid mutations
			store.tasks.add(makeTask({ id: "1", title: "Task 1" }));
			store.tasks.add(makeTask({ id: "2", title: "Task 2" }));
			store.tasks.add(makeTask({ id: "3", title: "Task 3" }));

			// Wait for debounce
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Should have only pushed once (debounced)
			expect(mockFetch).toHaveBeenCalledTimes(1);

			cleanup();
		});

		test("clears debounce timers on cleanup", async () => {
			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 60000,
				debounceDelay: 100,
			});

			await new Promise((resolve) => setTimeout(resolve, 10));
			mockFetch.mockClear();

			// Add a task
			store.tasks.add(makeTask({ id: "1", title: "Task 1" }));

			// Cleanup before debounce completes
			cleanup();

			// Wait longer than debounce
			await new Promise((resolve) => setTimeout(resolve, 150));

			// Should not have pushed (timer was cleared)
			expect(mockFetch).toHaveBeenCalledTimes(0);
		});

		test("merges server response after push", async () => {
			const serverResponseSnapshot = makeTaskSnapshot([
				{ id: "local-1", title: "Local Task", completed: false },
				{ id: "server-1", title: "Server Added Task", completed: true },
			]);

			mockFetch.mockImplementation((_url, options) => {
				if (options?.method === "PATCH") {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve(serverResponseSnapshot),
					});
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(makeEmptySnapshot()),
				});
			});

			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 60000,
				debounceDelay: 10,
			});

			await new Promise((resolve) => setTimeout(resolve, 10));

			store.tasks.add(makeTask({ id: "local-1", title: "Local Task" }));

			// Wait for push and merge
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Should have server's data merged
			const serverTask = store.tasks.get("server-1");
			expect(serverTask).toBeDefined();
			expect(serverTask?.title).toBe("Server Added Task");

			cleanup();
		});
	});

	describe("onRequest hook", () => {
		test("adds custom headers from onRequest hook", async () => {
			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 60000,
				onRequest: () => ({
					headers: { Authorization: "Bearer test-token" },
				}),
			});

			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(mockFetch.mock.calls[0]?.[1]?.headers).toMatchObject({
				Authorization: "Bearer test-token",
			});

			cleanup();
		});

		test("skips request when onRequest returns skip: true", async () => {
			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 60000,
				onRequest: () => ({ skip: true }),
			});

			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(mockFetch).toHaveBeenCalledTimes(0);

			cleanup();
		});

		test("receives correct context in onRequest hook", async () => {
			const onRequestMock = mock(
				(_context: RequestContext) => undefined as undefined,
			);

			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 60000,
				debounceDelay: 10,
				onRequest: onRequestMock,
			});

			await new Promise((resolve) => setTimeout(resolve, 10));

			// Check GET context
			expect(onRequestMock.mock.calls[0]?.[0]).toMatchObject({
				operation: "GET",
				url: "https://api.example.com/database/test-app",
			});

			// Trigger a PATCH
			store.tasks.add(makeTask({ id: "1", title: "Test" }));
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Check PATCH context
			const patchCall = onRequestMock.mock.calls.find(
				(call) => call[0]?.operation === "PATCH",
			);
			expect(patchCall?.[0]).toMatchObject({
				operation: "PATCH",
				url: "https://api.example.com/database/test-app",
			});
			expect(patchCall?.[0]?.state).toBeDefined();

			cleanup();
		});
	});

	describe("onResponse hook", () => {
		test("skips merge when onResponse returns skip: true", async () => {
			const serverSnapshot = makeTaskSnapshot([
				{ id: "server-1", title: "Server Task", completed: false },
			]);

			mockFetch.mockImplementation(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve(serverSnapshot),
				}),
			);

			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 60000,
				onResponse: () => ({ skip: true }),
			});

			await new Promise((resolve) => setTimeout(resolve, 10));

			// Should not have merged server data
			const task = store.tasks.get("server-1");
			expect(task).toBeFalsy();

			cleanup();
		});

		test("transforms snapshot in onResponse before merge", async () => {
			const serverSnapshot = makeTaskSnapshot([
				{ id: "server-1", title: "Original Title", completed: false },
			]);

			const transformedSnapshot = makeTaskSnapshot([
				{ id: "server-1", title: "Transformed Title", completed: true },
			]);

			mockFetch.mockImplementation(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve(serverSnapshot),
				}),
			);

			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 60000,
				onResponse: () => ({
					state: transformedSnapshot,
				}),
			});

			await new Promise((resolve) => setTimeout(resolve, 10));

			// Should have merged transformed data
			const task = store.tasks.get("server-1");
			expect(task?.title).toBe("Transformed Title");
			expect(task?.completed).toBe(true);

			cleanup();
		});
	});

	describe("retry logic", () => {
		test("retries with exponential backoff on push failure", async () => {
			let callCount = 0;

			mockFetch.mockImplementation((_url, options) => {
				callCount++;

				// Init succeeds
				if (options?.method === "GET") {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve(makeEmptySnapshot()),
					});
				}

				// PATCH fails twice then succeeds
				if (callCount <= 3) {
					return Promise.reject(new Error("Network error"));
				}

				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(makeEmptySnapshot()),
				});
			});

			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 60000,
				debounceDelay: 10,
				retry: {
					maxAttempts: 3,
					initialDelay: 20,
					maxDelay: 100,
				},
			});

			await new Promise((resolve) => setTimeout(resolve, 10));

			store.tasks.add(makeTask({ id: "1", title: "Test" }));

			// Wait for retries
			await new Promise((resolve) => setTimeout(resolve, 200));

			// Should have retried
			expect(callCount).toBeGreaterThan(2);

			cleanup();

			// Wait for any async operations to complete before next test
			await new Promise((resolve) => setTimeout(resolve, 50));
		});

		test("stops retrying after max attempts", async () => {
			let patchCallCount = 0;

			mockFetch.mockImplementation((_url, options) => {
				if (options?.method === "GET") {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve(makeEmptySnapshot()),
					});
				}

				patchCallCount++;
				return Promise.reject(new Error("Network error"));
			});

			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 60000,
				debounceDelay: 10,
				retry: {
					maxAttempts: 3,
					initialDelay: 10,
					maxDelay: 50,
				},
			});

			await new Promise((resolve) => setTimeout(resolve, 10));

			store.tasks.add(makeTask({ id: "1", title: "Test" }));

			// Wait for debounce + all 3 retry attempts with exponential backoff
			// Debounce: 10ms, Attempt 1: 0ms, Delay: 10ms, Attempt 2: 0ms, Delay: 20ms, Attempt 3: 0ms
			// Total: ~40ms, use 100ms for safety
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Should have stopped after max attempts
			expect(patchCallCount).toBe(3);

			cleanup();
		});
	});

	describe("HTTP errors", () => {
		test("handles non-ok HTTP responses", async () => {
			mockFetch.mockImplementation(() =>
				Promise.resolve({
					ok: false,
					status: 500,
					statusText: "Internal Server Error",
				}),
			);

			const store = createStore({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			});

			const cleanup = createHttpSynchronizer(store, {
				baseUrl: "https://api.example.com",
				pollingInterval: 60000,
			});

			await new Promise((resolve) => setTimeout(resolve, 10));

			expect(consoleErrorSpy).toHaveBeenCalled();

			cleanup();
		});
	});
});
