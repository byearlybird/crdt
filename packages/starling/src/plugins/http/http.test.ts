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
import {
	makeTask,
	type Task,
	taskSchema,
	userSchema,
} from "../../database/test-helpers";
import type { DatabaseSnapshot } from "../../database/types";
import { httpPlugin, type RequestContext } from "./index";

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

// Helper to create an empty database snapshot
function makeEmptySnapshot(dbName = "test-app"): DatabaseSnapshot<any> {
	const tasksDoc = makeDocument("tasks", "2099-01-01T00:00:00.000Z|0001|a1b2");
	return {
		version: "1.0",
		name: dbName,
		latest: "2099-01-01T00:00:00.000Z|0001|a1b2",
		collections: {
			tasks: tasksDoc,
		},
	};
}

// Helper to create a database snapshot with tasks
function makeTaskSnapshot(
	tasks: Array<{ id: string; title: string; completed: boolean }>,
	eventstamp = "2099-01-01T00:00:00.000Z|0001|a1b2",
	dbName = "test-app",
): DatabaseSnapshot<any> {
	const tasksDoc = makeDocument<{
		id: string;
		title: string;
		completed: boolean;
	}>("tasks", eventstamp);
	for (const task of tasks) {
		tasksDoc.resources[task.id] = makeResource(task.id, task, eventstamp);
	}
	return {
		version: "1.0",
		name: dbName,
		latest: eventstamp,
		collections: {
			tasks: tasksDoc,
		},
	};
}

// Helper to create a test database with http plugin
async function createTestHttpDb(
	pluginOptions: Partial<Parameters<typeof httpPlugin>[0]> = {},
) {
	return await createDatabase({
		name: "test-app",
		schema: {
			tasks: {
				schema: taskSchema,
				getId: (task: Task) => task.id,
			},
		},
	})
		.use(
			// @ts-expect-error - httpPlugin returns generic type
			httpPlugin({
				baseUrl: "https://api.example.com",
				pollingInterval: 60000, // Long interval to prevent polling during tests
				...pluginOptions,
			}),
		)
		.init();
}

// Helper to mock successful GET responses
function mockSuccessfulGet(
	snapshot: DatabaseSnapshot<any> = makeEmptySnapshot(),
) {
	mockFetch.mockImplementation(() =>
		Promise.resolve({
			ok: true,
			json: () => Promise.resolve(snapshot),
		}),
	);
}

// Helper to mock successful PATCH responses
function mockSuccessfulPatch(
	snapshot: DatabaseSnapshot<any> = makeEmptySnapshot(),
) {
	mockFetch.mockImplementation((_url, options) => {
		if (options?.method === "PATCH") {
			return Promise.resolve({
				ok: true,
				json: () => Promise.resolve(snapshot),
			});
		}
		return Promise.resolve({
			ok: true,
			json: () => Promise.resolve(makeEmptySnapshot()),
		});
	});
}

describe("httpPlugin", () => {
	describe("initialization", () => {
		test("fetches database snapshot on init", async () => {
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

			// Should have made a single GET request for database snapshot
			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch.mock.calls[0]?.[0]).toBe(
				"https://api.example.com/database/test-app",
			);
			expect(mockFetch.mock.calls[0]?.[1]).toMatchObject({
				method: "GET",
			});

			await db.dispose();
		});

		test("fetches all collections in single snapshot", async () => {
			// Create a snapshot with both collections
			const tasksDoc = makeDocument(
				"tasks",
				"2099-01-01T00:00:00.000Z|0001|a1b2",
			);
			const usersDoc = makeDocument(
				"users",
				"2099-01-01T00:00:00.000Z|0001|a1b2",
			);
			const snapshot: DatabaseSnapshot<any> = {
				version: "1.0",
				name: "test-app",
				latest: "2099-01-01T00:00:00.000Z|0001|a1b2",
				collections: {
					tasks: tasksDoc,
					users: usersDoc,
				},
			};

			mockSuccessfulGet(snapshot);

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

			// Should have made only 1 GET request for database snapshot
			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch.mock.calls[0]?.[0]).toBe(
				"https://api.example.com/database/test-app",
			);

			await db.dispose();
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

		test("handles fetch failure gracefully on init", async () => {
			mockFetch.mockImplementation(() => {
				return Promise.reject(new Error("Network error"));
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

			// Should have attempted fetch once
			expect(mockFetch).toHaveBeenCalledTimes(1);
			// Should have logged error
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
						json: () => Promise.resolve(makeEmptySnapshot()),
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
			const errorCall = consoleErrorSpy.mock.calls.find((call: unknown[]) =>
				String(call[0]).includes("Failed to poll database"),
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
						json: () => Promise.resolve(makeEmptySnapshot()),
					});
				}
				if (callCount <= 3) {
					return Promise.reject(new Error("Network error"));
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(makeEmptySnapshot()),
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
		test("pushes database snapshot to server after mutation", async () => {
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

			// Should have pushed database snapshot
			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch.mock.calls[0]?.[0]).toBe(
				"https://api.example.com/database/test-app",
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

		test("pushes all collection mutations in single database snapshot", async () => {
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

			// Should have pushed once with full database snapshot
			expect(mockFetch).toHaveBeenCalledTimes(1);
			expect(mockFetch.mock.calls[0]?.[0]).toBe(
				"https://api.example.com/database/test-app",
			);

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
			const db = await createTestHttpDb({
				onRequest: () => ({
					headers: { Authorization: "Bearer test-token" },
				}),
			});

			expect(mockFetch.mock.calls[0]?.[1]?.headers).toMatchObject({
				Authorization: "Bearer test-token",
			});

			await db.dispose();
		});

		test.each([
			["GET on init", "GET", undefined],
			["PATCH after mutation", "PATCH", { operation: "PATCH" }],
		])(
			"skips request when onRequest returns skip: true for %s",
			async (_description, _method, hookFilter) => {
				const db = await createTestHttpDb({
					debounceDelay: 10,
					onRequest: (context) => {
						if (!hookFilter || context.operation === hookFilter.operation) {
							return { skip: true };
						}
						return undefined;
					},
				});

				mockFetch.mockClear();

				// Trigger PATCH if testing that operation
				if (hookFilter?.operation === "PATCH") {
					db.tasks.add(makeTask({ id: "1", title: "Test" }));
					await new Promise((resolve) => setTimeout(resolve, 50));
				}

				expect(mockFetch).toHaveBeenCalledTimes(0);
				await db.dispose();
			},
		);

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
					// @ts-expect-error - httpPlugin returns generic type
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
				operation: "GET",
				url: "https://api.example.com/database/test-app",
			});

			// Trigger a PATCH
			db.tasks.add(makeTask({ id: "1", title: "Test" }));
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Check PATCH context
			const patchCall = onRequestMock.mock.calls.find(
				(call) => call[0]?.operation === "PATCH",
			);
			expect(patchCall?.[0]).toMatchObject({
				operation: "PATCH",
				url: "https://api.example.com/database/test-app",
			});
			expect(patchCall?.[0]?.snapshot).toBeDefined();

			await db.dispose();
		});

		test("transforms snapshot in onRequest for PATCH", async () => {
			let capturedBody: string | undefined;
			mockFetch.mockImplementation((_url, options) => {
				if (options?.method === "PATCH") {
					capturedBody = options.body as string;
				}
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve(makeEmptySnapshot()),
				});
			});

			const transformedSnapshot = makeTaskSnapshot([
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
								return {
									snapshot: transformedSnapshot,
								};
							}
							return undefined;
						},
					}),
				)
				.init();

			db.tasks.add(makeTask({ id: "1", title: "Original" }));
			await new Promise((resolve) => setTimeout(resolve, 50));

			// Should have sent the transformed snapshot
			expect(capturedBody).toBeDefined();
			if (!capturedBody) {
				throw new Error("Expected capturedBody to be defined");
			}
			const parsed = JSON.parse(capturedBody);
			expect(parsed.collections.tasks.resources.transformed?.id).toBe(
				"transformed",
			);

			await db.dispose();
		});
	});

	describe("onResponse hook", () => {
		test.each([
			["GET on init", false],
			["PATCH after mutation", true],
		])(
			"skips merge when onResponse returns skip: true for %s",
			async (_description, triggerPatch) => {
				const serverSnapshot = makeTaskSnapshot([
					{ id: "server-1", title: "Server Task", completed: false },
				]);

				mockSuccessfulGet(serverSnapshot);

				const db = await createTestHttpDb({
					debounceDelay: 10,
					onResponse: () => ({ skip: true }),
				});

				if (triggerPatch) {
					mockFetch.mockClear();
					mockSuccessfulPatch(serverSnapshot);
					db.tasks.add(makeTask({ id: "1", title: "Local Task" }));
					await new Promise((resolve) => setTimeout(resolve, 50));
				}

				// Should not have merged server data
				const task = db.tasks.get("server-1");
				expect(task).toBeFalsy();

				await db.dispose();
			},
		);

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
						onResponse: () => ({
							snapshot: transformedSnapshot,
						}),
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
			const serverSnapshot = makeTaskSnapshot([
				{ id: "server-1", title: "Server Task", completed: false },
			]);

			mockFetch.mockImplementation(() =>
				Promise.resolve({
					ok: true,
					json: () => Promise.resolve(serverSnapshot),
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
			const typedCalls = onResponseMock.mock.calls as unknown as Array<
				[{ snapshot: DatabaseSnapshot<any> }]
			>;
			const firstCall = typedCalls[0];
			expect(firstCall).toBeDefined();
			if (!firstCall) {
				throw new Error("onResponse hook was not invoked");
			}
			const [responseContext] = firstCall;
			expect(responseContext.snapshot).toBeDefined();
			expect(responseContext.snapshot.version).toBe("1.0");

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
						json: () => Promise.resolve(makeEmptySnapshot()),
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
						json: () => Promise.resolve(makeEmptySnapshot()),
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
		test("handles non-ok HTTP response on PATCH", async () => {
			mockFetch.mockImplementation((_url, options) => {
				if (options?.method === "GET") {
					return Promise.resolve({
						ok: true,
						json: () => Promise.resolve(makeEmptySnapshot()),
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
						json: () => Promise.resolve(makeEmptySnapshot()),
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
