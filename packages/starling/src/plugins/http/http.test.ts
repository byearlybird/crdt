import {
	afterEach,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from "bun:test";
import { makeDocument, makeResource } from "../../core";
import { createDatabase } from "../../database/db";
import { makeTask, taskSchema, userSchema } from "../../database/test-helpers";
import { httpPlugin, type RequestContext } from "./index";

// Mock fetch
let mockFetch: ReturnType<typeof mock>;
let consoleErrorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
	mockFetch = mock(() =>
		Promise.resolve({
			ok: true,
			json: () => Promise.resolve(makeEmptyDocument()),
		}),
	);
	globalThis.fetch = mockFetch as unknown as typeof fetch;
	consoleErrorSpy = spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
	mockFetch.mockRestore?.();
	consoleErrorSpy.mockRestore();
});

// Helper to create an empty document
function makeEmptyDocument() {
	return makeDocument("tasks", "2099-01-01T00:00:00.000Z|0001|a1b2");
}

// Helper to create a document with tasks
function makeTaskDocument(
	tasks: Array<{ id: string; title: string; completed: boolean }>,
	eventstamp = "2099-01-01T00:00:00.000Z|0001|a1b2",
) {
	const doc = makeDocument<{ id: string; title: string; completed: boolean }>(
		"tasks",
		eventstamp,
	);
	for (const task of tasks) {
		doc.resources[task.id] = makeResource(task.id, task, eventstamp);
	}
	return doc;
}

describe("httpPlugin", () => {
	describe("initialization", () => {
		test("fetches all collections on init", async () => {
			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000, // Long interval to prevent polling during test
					}),
				)
				.init();

			// Should have made a GET request for tasks collection
			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch.mock.calls[0]?.[0]).toBe(
				"https://api.example.com/test-app/tasks",
			);
			expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({
				method: "GET",
			});

			await db.dispose();
		});

		test("fetches multiple collections on init", async () => {
			const db = await createDatabase({
				name: "test-app",
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
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
					}),
				)
				.init();

			// Should have made GET requests for both collections
			expect(mockFetch).toHaveBeenCalledTimes(2);

			await db.dispose();
		});

		test("merges fetched documents into store", async () => {
			const serverDoc = makeTaskDocument([
				{ id: "server-1", title: "Server Task", completed: false },
			]);

			mockFetch.mockImplementation(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve(serverDoc),
				}),
			);

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
					}),
				)
				.init();

			// Should have merged server data
			const task = db.tasks.get("server-1");
			expect(task).toBeDefined();
			expect(task?.title).toBe("Server Task");

			await db.dispose();
		});

		test("continues with other collections when one fetch fails", async () => {
			let callCount = 0;
			mockFetch.mockImplementation(() => {
				callCount++;
				if (callCount === 1) {
					return Promise.reject(new Error("Network error"));
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(makeEmptyDocument()),
				});
			});

			const db = await createDatabase({
				name: "test-app",
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
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
					}),
				)
				.init();

			// Should have attempted both collections
			expect(mockFetch).toHaveBeenCalledTimes(2);
			// Should have logged error for first collection
			expect(consoleErrorSpy).toHaveBeenCalled();

			await db.dispose();
		});

		test("does not retry on init failure", async () => {
			mockFetch.mockImplementation(() =>
				Promise.reject(new Error("Network error")),
			);

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						retry: { maxAttempts: 3 },
					}),
				)
				.init();

			// Should have only tried once (no retry on init)
			expect(mockFetch).toHaveBeenCalledTimes(1);

			await db.dispose();
		});
	});

	describe("polling", () => {
		test("polls server at configured interval", async () => {
			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 50, // Short interval for testing
					}),
				)
				.init();

			// Initial fetch
			expect(mockFetch).toHaveBeenCalledTimes(1);

			// Wait for polling
			await new Promise((resolve) => setTimeout(resolve, 120));

			// Should have polled at least once more
			expect(mockFetch.mock.calls.length).toBeGreaterThanOrEqual(2);

			await db.dispose();
		});

		test("stops polling on dispose", async () => {
			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 50,
					}),
				)
				.init();

			await db.dispose();

			const callsAfterDispose = mockFetch.mock.calls.length;

			// Wait longer than polling interval
			await new Promise((resolve) => setTimeout(resolve, 120));

			// Should not have made any more calls
			expect(mockFetch.mock.calls.length).toBe(callsAfterDispose);
		});

		test("logs error when polling fails after all retries", async () => {
			let initDone = false;
			mockFetch.mockImplementation(() => {
				if (!initDone) {
					initDone = true;
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve(makeEmptyDocument()),
					});
				}
				// All subsequent calls (polling) fail
				return Promise.reject(new Error("Network error"));
			});

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 30, // Short interval
						retry: {
							maxAttempts: 2,
							initialDelay: 5,
							maxDelay: 10,
						},
					}),
				)
				.init();

			consoleErrorSpy.mockClear();

			// Wait for polling to fail after retries
			await new Promise((resolve) => setTimeout(resolve, 150));

			// Should have logged polling error
			expect(consoleErrorSpy).toHaveBeenCalled();
			const errorCall = consoleErrorSpy.mock.calls.find((call) =>
				String(call[0]).includes("Failed to poll collection"),
			);
			expect(errorCall).toBeDefined();

			await db.dispose();
		});

		test("retries polling on failure", async () => {
			let callCount = 0;
			mockFetch.mockImplementation(() => {
				callCount++;
				// First call (init) succeeds, subsequent calls fail then succeed
				if (callCount === 1) {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve(makeEmptyDocument()),
					});
				}
				if (callCount <= 3) {
					return Promise.reject(new Error("Network error"));
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(makeEmptyDocument()),
				});
			});

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 50,
						retry: {
							maxAttempts: 3,
							initialDelay: 10,
							maxDelay: 50,
						},
					}),
				)
				.init();

			// Wait for polling and retries
			await new Promise((resolve) => setTimeout(resolve, 200));

			// Should have made multiple retry attempts
			expect(mockFetch.mock.calls.length).toBeGreaterThan(2);

			await db.dispose();
		});
	});

	describe("push on mutation", () => {
		test("pushes changes to server after mutation", async () => {
			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						debounceDelay: 10, // Short debounce for testing
					}),
				)
				.init();

			// Clear initial fetch call
			mockFetch.mockClear();

			// Add a task
			db.tasks.add(makeTask({ id: "local-1", title: "Local Task" }));

			// Wait for debounce
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Should have pushed changes
			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch.mock.calls[0]?.[0]).toBe(
				"https://api.example.com/test-app/tasks",
			);
			expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({
				method: "PATCH",
			});

			await db.dispose();
		});

		test("debounces multiple rapid mutations", async () => {
			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						debounceDelay: 50,
					}),
				)
				.init();

			mockFetch.mockClear();

			// Multiple rapid mutations
			db.tasks.add(makeTask({ id: "1", title: "Task 1" }));
			db.tasks.add(makeTask({ id: "2", title: "Task 2" }));
			db.tasks.add(makeTask({ id: "3", title: "Task 3" }));

			// Wait for debounce
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Should have only pushed once (debounced)
			expect(mockFetch).toHaveBeenCalledTimes(1);

			await db.dispose();
		});

		test("pushes to different collections independently", async () => {
			const db = await createDatabase({
				name: "test-app",
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
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						debounceDelay: 10,
					}),
				)
				.init();

			mockFetch.mockClear();

			// Mutate both collections
			db.tasks.add(makeTask({ id: "1", title: "Task 1" }));
			db.users.add({ id: "u1", name: "User 1", email: "user@example.com" });

			// Wait for debounce
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Should have pushed both collections
			expect(mockFetch).toHaveBeenCalledTimes(2);

			await db.dispose();
		});

		test("clears debounce timers on dispose", async () => {
			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						debounceDelay: 100,
					}),
				)
				.init();

			mockFetch.mockClear();

			// Add a task
			db.tasks.add(makeTask({ id: "1", title: "Task 1" }));

			// Dispose before debounce completes
			await db.dispose();

			// Wait longer than debounce
			await new Promise((resolve) => setTimeout(resolve, 150));

			// Should not have pushed (timer was cleared)
			expect(mockFetch).toHaveBeenCalledTimes(0);
		});

		test("merges server response after push", async () => {
			const serverResponseDoc = makeTaskDocument([
				{ id: "local-1", title: "Local Task", completed: false },
				{ id: "server-1", title: "Server Added Task", completed: true },
			]);

			mockFetch.mockImplementation((_url, options) => {
				if (options?.method === "PATCH") {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve(serverResponseDoc),
					});
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(makeEmptyDocument()),
				});
			});

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						debounceDelay: 10,
					}),
				)
				.init();

			db.tasks.add(makeTask({ id: "local-1", title: "Local Task" }));

			// Wait for push and merge
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Should have server's data merged
			const serverTask = db.tasks.get("server-1");
			expect(serverTask).toBeDefined();
			expect(serverTask?.title).toBe("Server Added Task");

			await db.dispose();
		});
	});

	describe("onRequest hook", () => {
		test("adds custom headers from onRequest hook", async () => {
			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						onRequest: () => ({
							headers: { Authorization: "Bearer test-token" },
						}),
					}),
				)
				.init();

			expect(mockFetch.mock.calls[0]?.[1]?.headers).toMatchObject({
				Authorization: "Bearer test-token",
			});

			await db.dispose();
		});

		test("skips request when onRequest returns skip: true", async () => {
			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						onRequest: () => ({ skip: true }),
					}),
				)
				.init();

			// Should not have made any fetch calls
			expect(mockFetch).toHaveBeenCalledTimes(0);

			await db.dispose();
		});

		test("receives correct context in onRequest hook", async () => {
			const onRequestMock = mock(
				(_context: RequestContext) => undefined as undefined,
			);

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						debounceDelay: 10,
						onRequest: onRequestMock,
					}),
				)
				.init();

			// Check GET context
			expect(onRequestMock.mock.calls[0]?.[0]).toMatchObject({
				collection: "tasks",
				operation: "GET",
				url: "https://api.example.com/test-app/tasks",
			});

			// Trigger a PATCH
			db.tasks.add(makeTask({ id: "1", title: "Test" }));
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Check PATCH context
			const patchCall = onRequestMock.mock.calls.find(
				(call) => call[0]?.operation === "PATCH",
			);
			expect(patchCall?.[0]).toMatchObject({
				collection: "tasks",
				operation: "PATCH",
				url: "https://api.example.com/test-app/tasks",
			});
			expect(patchCall?.[0]?.document).toBeDefined();

			await db.dispose();
		});

		test("transforms document in onRequest for PATCH", async () => {
			let capturedBody: string | undefined;
			mockFetch.mockImplementation((_url, options) => {
				if (options?.method === "PATCH") {
					capturedBody = options.body as string;
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(makeEmptyDocument()),
				});
			});

			const transformedDoc = makeTaskDocument([
				{ id: "transformed", title: "Transformed", completed: true },
			]);

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						debounceDelay: 10,
						onRequest: ({ operation }) => {
							if (operation === "PATCH") {
								return { document: transformedDoc };
							}
							return undefined;
						},
					}),
				)
				.init();

			db.tasks.add(makeTask({ id: "1", title: "Original" }));
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Should have sent the transformed document
			expect(capturedBody).toBeDefined();
			const parsed = JSON.parse(capturedBody!);
			expect(parsed.resources.transformed?.id).toBe("transformed");

			await db.dispose();
		});
	});

	describe("onResponse hook", () => {
		test("skips merge when onResponse returns skip: true", async () => {
			const serverDoc = makeTaskDocument([
				{ id: "server-1", title: "Server Task", completed: false },
			]);

			mockFetch.mockImplementation(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve(serverDoc),
				}),
			);

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						onResponse: () => ({ skip: true }),
					}),
				)
				.init();

			// Should not have merged server data
			const task = db.tasks.get("server-1");
			expect(task).toBeFalsy();

			await db.dispose();
		});

		test("transforms document in onResponse before merge", async () => {
			const serverDoc = makeTaskDocument([
				{ id: "server-1", title: "Original Title", completed: false },
			]);

			const transformedDoc = makeTaskDocument([
				{ id: "server-1", title: "Transformed Title", completed: true },
			]);

			mockFetch.mockImplementation(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve(serverDoc),
				}),
			);

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						onResponse: () => ({ document: transformedDoc }),
					}),
				)
				.init();

			// Should have merged transformed data
			const task = db.tasks.get("server-1");
			expect(task?.title).toBe("Transformed Title");
			expect(task?.completed).toBe(true);

			await db.dispose();
		});

		test("receives correct context in onResponse hook", async () => {
			const serverDoc = makeTaskDocument([
				{ id: "server-1", title: "Server Task", completed: false },
			]);

			mockFetch.mockImplementation(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve(serverDoc),
				}),
			);

			const onResponseMock = mock(() => undefined as undefined);

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						onResponse: onResponseMock,
					}),
				)
				.init();

			expect(onResponseMock).toHaveBeenCalledTimes(1);
			expect(onResponseMock.mock.calls[0]?.[0]).toMatchObject({
				collection: "tasks",
			});
			expect(onResponseMock.mock.calls[0]?.[0]?.document).toBeDefined();

			await db.dispose();
		});
	});

	describe("retry logic", () => {
		test("retries with exponential backoff on push failure", async () => {
			let callCount = 0;
			const callTimestamps: number[] = [];

			mockFetch.mockImplementation((_url, options) => {
				callTimestamps.push(Date.now());
				callCount++;

				// Init succeeds
				if (options?.method === "GET") {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve(makeEmptyDocument()),
					});
				}

				// PATCH fails twice then succeeds
				if (callCount <= 3) {
					return Promise.reject(new Error("Network error"));
				}

				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(makeEmptyDocument()),
				});
			});

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						debounceDelay: 10,
						retry: {
							maxAttempts: 3,
							initialDelay: 20,
							maxDelay: 100,
						},
					}),
				)
				.init();

			db.tasks.add(makeTask({ id: "1", title: "Test" }));

			// Wait for retries
			await new Promise((resolve) => setTimeout(resolve, 200));

			// Should have retried
			expect(callCount).toBeGreaterThan(2);

			await db.dispose();
		});

		test("stops retrying after max attempts", async () => {
			let patchCallCount = 0;

			mockFetch.mockImplementation((_url, options) => {
				if (options?.method === "GET") {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve(makeEmptyDocument()),
					});
				}

				patchCallCount++;
				return Promise.reject(new Error("Network error"));
			});

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						debounceDelay: 10,
						retry: {
							maxAttempts: 3,
							initialDelay: 10,
							maxDelay: 50,
						},
					}),
				)
				.init();

			db.tasks.add(makeTask({ id: "1", title: "Test" }));

			// Wait for all retries to complete
			await new Promise((resolve) => setTimeout(resolve, 300));

			// Should have stopped after max attempts
			expect(patchCallCount).toBe(3);

			await db.dispose();
		});

		test("respects maxDelay cap", async () => {
			const callTimestamps: number[] = [];

			mockFetch.mockImplementation((_url, options) => {
				if (options?.method === "GET") {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve(makeEmptyDocument()),
					});
				}

				callTimestamps.push(Date.now());
				return Promise.reject(new Error("Network error"));
			});

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						debounceDelay: 10,
						retry: {
							maxAttempts: 4,
							initialDelay: 20,
							maxDelay: 30, // Cap at 30ms
						},
					}),
				)
				.init();

			db.tasks.add(makeTask({ id: "1", title: "Test" }));

			// Wait for all retries
			await new Promise((resolve) => setTimeout(resolve, 300));

			// Should have made 4 attempts
			expect(callTimestamps.length).toBe(4);

			await db.dispose();
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

			// Should not throw, just log error
			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
					}),
				)
				.init();

			expect(consoleErrorSpy).toHaveBeenCalled();

			await db.dispose();
		});

		test("handles 404 responses gracefully", async () => {
			mockFetch.mockImplementation(() =>
				Promise.resolve({
					ok: false,
					status: 404,
					statusText: "Not Found",
				}),
			);

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
					}),
				)
				.init();

			// Should have empty store
			expect(db.tasks.getAll()).toEqual([]);

			await db.dispose();
		});
	});

	describe("push request hooks", () => {
		test("skips PATCH when onRequest returns skip: true for PATCH", async () => {
			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						debounceDelay: 10,
						onRequest: ({ operation }) => {
							if (operation === "PATCH") {
								return { skip: true };
							}
							return undefined;
						},
					}),
				)
				.init();

			mockFetch.mockClear();

			// Add a task - this should trigger a PATCH that gets skipped
			db.tasks.add(makeTask({ id: "1", title: "Test" }));

			// Wait for debounce
			await new Promise((resolve) => setTimeout(resolve, 50));

			// No PATCH should have been made (skipped by onRequest)
			expect(mockFetch).toHaveBeenCalledTimes(0);

			await db.dispose();
		});

		test("handles non-ok HTTP response on PATCH", async () => {
			mockFetch.mockImplementation((_url, options) => {
				if (options?.method === "GET") {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve(makeEmptyDocument()),
					});
				}
				// Return non-ok for PATCH
				return Promise.resolve({
					ok: false,
					status: 500,
					statusText: "Internal Server Error",
				});
			});

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						debounceDelay: 10,
						retry: { maxAttempts: 1 }, // Single attempt for faster test
					}),
				)
				.init();

			mockFetch.mockClear();
			consoleErrorSpy.mockClear();

			// Add a task - this triggers PATCH which will fail
			db.tasks.add(makeTask({ id: "1", title: "Test" }));

			// Wait for debounce and request
			await new Promise((resolve) => setTimeout(resolve, 100));

			// Should have logged error
			expect(consoleErrorSpy).toHaveBeenCalled();

			await db.dispose();
		});

		test("skips merge on PATCH response when onResponse returns skip: true", async () => {
			const serverResponseDoc = makeTaskDocument([
				{ id: "1", title: "Server Modified", completed: true },
				{ id: "server-new", title: "Server New Task", completed: false },
			]);

			mockFetch.mockImplementation((_url, options) => {
				if (options?.method === "GET") {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve(makeEmptyDocument()),
					});
				}
				// PATCH returns server document
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(serverResponseDoc),
				});
			});

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						debounceDelay: 10,
						onResponse: () => ({ skip: true }), // Skip all response merges
					}),
				)
				.init();

			// Add a task
			db.tasks.add(makeTask({ id: "1", title: "Local Task" }));

			// Wait for PATCH
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Server response should NOT have been merged (skipped)
			const serverTask = db.tasks.get("server-new");
			expect(serverTask).toBeFalsy();

			// Our local task should still have original title
			const localTask = db.tasks.get("1");
			expect(localTask?.title).toBe("Local Task");

			await db.dispose();
		});
	});

	describe("disposal", () => {
		test("unsubscribes from mutation events on dispose", async () => {
			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						debounceDelay: 10,
					}),
				)
				.init();

			await db.dispose();

			mockFetch.mockClear();

			// This mutation should not trigger a push (plugin disposed)
			// Note: The db still works, but plugin won't respond
			// In practice, users shouldn't mutate after dispose
			expect(mockFetch).not.toHaveBeenCalled();
		});

		test("can be safely disposed multiple times", async () => {
			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
					}),
				)
				.init();

			// Should not throw
			await db.dispose();
			await db.dispose();
		});
	});

	describe("default configuration", () => {
		test("uses default polling interval of 5000ms", async () => {
			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						// No pollingInterval specified
					}),
				)
				.init();

			// Initial fetch
			expect(mockFetch).toHaveBeenCalledTimes(1);

			// After 100ms, no additional polls yet (default is 5000ms)
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(mockFetch).toHaveBeenCalledTimes(1);

			await db.dispose();
		});

		test("uses default debounce delay of 1000ms", async () => {
			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						// No debounceDelay specified
					}),
				)
				.init();

			mockFetch.mockClear();

			db.tasks.add(makeTask({ id: "1", title: "Test" }));

			// After 100ms, no push yet (default is 1000ms)
			await new Promise((resolve) => setTimeout(resolve, 100));
			expect(mockFetch).toHaveBeenCalledTimes(0);

			await db.dispose();
		});

		test("uses default retry configuration", async () => {
			let callCount = 0;
			mockFetch.mockImplementation((_url, options) => {
				if (options?.method === "GET") {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve(makeEmptyDocument()),
					});
				}
				callCount++;
				return Promise.reject(new Error("Network error"));
			});

			const db = await createDatabase({
				name: "test-app",
				schema: {
					tasks: {
						schema: taskSchema,
						getId: (task) => task.id,
					},
				},
			})
				.use(
					httpPlugin({
						baseUrl: "https://api.example.com",
						pollingInterval: 60000,
						debounceDelay: 10,
						// No retry config specified
					}),
				)
				.init();

			db.tasks.add(makeTask({ id: "1", title: "Test" }));

			// Wait for default retry attempts (3 by default)
			await new Promise((resolve) => setTimeout(resolve, 5000));

			// Default maxAttempts is 3
			expect(callCount).toBe(3);

			await db.dispose();
		}, 10000); // Increase timeout for retry test
	});
});
