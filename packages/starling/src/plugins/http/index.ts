import type { Database, DatabasePlugin } from "../../database/db";
import type { DatabaseSnapshot, SchemasMap } from "../../database/types";

/**
 * Context provided to the onRequest hook
 */
export type RequestContext<Schemas extends SchemasMap = SchemasMap> = {
	operation: "GET" | "PATCH";
	url: string;
	snapshot?: DatabaseSnapshot<Schemas>; // Present for PATCH operations
};

/**
 * Result returned by the onRequest hook
 */
export type RequestHookResult<Schemas extends SchemasMap = SchemasMap> =
	| { skip: true }
	| { headers?: Record<string, string>; snapshot?: DatabaseSnapshot<Schemas> }
	| undefined;

/**
 * Result returned by the onResponse hook
 */
export type ResponseHookResult<Schemas extends SchemasMap = SchemasMap> =
	| { snapshot: DatabaseSnapshot<Schemas> }
	| { skip: true }
	| undefined; // Use original snapshot

/**
 * Configuration for the HTTP plugin
 */
export type HttpPluginConfig<Schemas extends SchemasMap> = {
	/**
	 * Base URL for the HTTP server (e.g., "https://api.example.com")
	 */
	baseUrl: string;

	/**
	 * Interval in milliseconds to poll for server updates
	 * @default 5000
	 */
	pollingInterval?: number;

	/**
	 * Delay in milliseconds to debounce local mutations before pushing
	 * @default 1000
	 */
	debounceDelay?: number;

	/**
	 * Hook called before each HTTP request
	 * Return { skip: true } to abort the request
	 * Return { headers } to add custom headers
	 * Return { snapshot } to transform the snapshot (PATCH only)
	 */
	onRequest?: (context: RequestContext<Schemas>) => RequestHookResult<Schemas>;

	/**
	 * Hook called after each successful HTTP response
	 * Return { skip: true } to skip merging the response
	 * Return { snapshot } to transform the snapshot before merging
	 */
	onResponse?: (context: {
		snapshot: DatabaseSnapshot<Schemas>;
	}) => ResponseHookResult<Schemas>;

	/**
	 * Retry configuration for failed requests
	 */
	retry?: {
		/**
		 * Maximum number of retry attempts
		 * @default 3
		 */
		maxAttempts?: number;

		/**
		 * Initial delay in milliseconds before first retry
		 * @default 1000
		 */
		initialDelay?: number;

		/**
		 * Maximum delay in milliseconds between retries
		 * @default 30000
		 */
		maxDelay?: number;
	};
};

/**
 * Create an HTTP sync plugin for Starling databases.
 *
 * The plugin:
 * - Fetches database snapshot from the server on init (single attempt)
 * - Polls the server at regular intervals to fetch updates (with retry)
 * - Debounces local mutations and pushes them to the server (with retry)
 * - Supports request/response hooks for authentication, encryption, etc.
 * - Uses endpoint: GET/PATCH /database/:name
 *
 * @param config - HTTP plugin configuration
 * @returns A DatabasePlugin instance
 *
 * @example
 * ```typescript
 * const db = await createDatabase({
 *   name: "my-app",
 *   schema: {
 *     tasks: { schema: taskSchema, getId: (task) => task.id },
 *   },
 * })
 *   .use(httpPlugin({
 *     baseUrl: "https://api.example.com",
 *     onRequest: () => ({
 *       headers: { Authorization: `Bearer ${token}` }
 *     })
 *   }))
 *   .init();
 * ```
 *
 * @example With encryption
 * ```typescript
 * const db = await createDatabase({
 *   name: "my-app",
 *   schema: {
 *     tasks: { schema: taskSchema, getId: (task) => task.id },
 *   },
 * })
 *   .use(httpPlugin({
 *     baseUrl: "https://api.example.com",
 *     onRequest: ({ snapshot }) => ({
 *       headers: { Authorization: `Bearer ${token}` },
 *       snapshot: snapshot ? encrypt(snapshot) : undefined
 *     }),
 *     onResponse: ({ snapshot }) => ({
 *       snapshot: decrypt(snapshot)
 *     })
 *   }))
 *   .init();
 * ```
 */
export function httpPlugin<Schemas extends SchemasMap>(
	config: HttpPluginConfig<Schemas>,
): DatabasePlugin<Schemas> {
	const {
		baseUrl,
		pollingInterval = 5000,
		debounceDelay = 1000,
		onRequest,
		onResponse,
		retry = {},
	} = config;

	const { maxAttempts = 3, initialDelay = 1000, maxDelay = 30000 } = retry;

	// Plugin state
	let pollingTimer: ReturnType<typeof setInterval> | null = null;
	let unsubscribe: (() => void) | null = null;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	return {
		handlers: {
			async init(db: Database<Schemas>) {
				// Initial fetch (single attempt, no retry)
				try {
					await fetchDatabase(db, baseUrl, onRequest, onResponse, false);
				} catch (error) {
					// Log error but continue
					console.error("Failed to fetch database during init:", error);
				}

				// Set up polling
				pollingTimer = setInterval(async () => {
					try {
						await fetchDatabase(
							db,
							baseUrl,
							onRequest,
							onResponse,
							true, // Enable retry for polling
							maxAttempts,
							initialDelay,
							maxDelay,
						);
					} catch (error) {
						// Log error but continue polling
						console.error("Failed to poll database:", error);
					}
				}, pollingInterval);

				// Subscribe to mutations for debounced push
				unsubscribe = db.on("mutation", () => {
					// Clear existing timer if any
					if (debounceTimer) {
						clearTimeout(debounceTimer);
					}

					// Schedule new push
					debounceTimer = setTimeout(async () => {
						debounceTimer = null;
						try {
							await pushDatabase(
								db,
								baseUrl,
								onRequest,
								onResponse,
								maxAttempts,
								initialDelay,
								maxDelay,
							);
						} catch (error) {
							console.error("Failed to push database:", error);
						}
					}, debounceDelay);
				});
			},

			async dispose(_db: Database<Schemas>) {
				// Clear polling timer
				if (pollingTimer) {
					clearInterval(pollingTimer);
					pollingTimer = null;
				}

				// Clear debounce timer
				if (debounceTimer) {
					clearTimeout(debounceTimer);
					debounceTimer = null;
				}

				// Unsubscribe from mutations
				if (unsubscribe) {
					unsubscribe();
					unsubscribe = null;
				}
			},
		},
	};
}

/**
 * Fetch database snapshot from the server (GET request)
 */
async function fetchDatabase<Schemas extends SchemasMap>(
	db: Database<Schemas>,
	baseUrl: string,
	onRequest:
		| ((context: RequestContext<Schemas>) => RequestHookResult<Schemas>)
		| undefined,
	onResponse:
		| ((context: {
				snapshot: DatabaseSnapshot<Schemas>;
		  }) => ResponseHookResult<Schemas>)
		| undefined,
	enableRetry: boolean,
	maxAttempts = 3,
	initialDelay = 1000,
	maxDelay = 30000,
): Promise<void> {
	const url = `${baseUrl}/database/${db.name}`;

	// Call onRequest hook
	const requestResult = onRequest?.({
		operation: "GET",
		url,
	});

	// Check if request should be skipped
	if (requestResult && "skip" in requestResult && requestResult.skip) {
		return;
	}

	// Extract headers
	const headers =
		requestResult && "headers" in requestResult
			? requestResult.headers
			: undefined;

	// Execute fetch with retry
	const executeRequest = async (): Promise<void> => {
		const response = await fetch(url, {
			method: "GET",
			headers: {
				"Content-Type": "application/json",
				...headers,
			},
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const snapshot = (await response.json()) as DatabaseSnapshot<Schemas>;

		// Call onResponse hook
		const responseResult = onResponse?.({ snapshot });

		// Check if merge should be skipped
		if (responseResult && "skip" in responseResult && responseResult.skip) {
			return;
		}

		// Use transformed snapshot if provided, otherwise use original
		const finalSnapshot =
			responseResult && "snapshot" in responseResult
				? responseResult.snapshot
				: snapshot;

		// Merge into database
		db.mergeSnapshot(finalSnapshot);
	};

	if (enableRetry) {
		await withRetry(executeRequest, maxAttempts, initialDelay, maxDelay);
	} else {
		await executeRequest();
	}
}

/**
 * Push database snapshot to the server (PATCH request)
 */
async function pushDatabase<Schemas extends SchemasMap>(
	db: Database<Schemas>,
	baseUrl: string,
	onRequest:
		| ((context: RequestContext<Schemas>) => RequestHookResult<Schemas>)
		| undefined,
	onResponse:
		| ((context: {
				snapshot: DatabaseSnapshot<Schemas>;
		  }) => ResponseHookResult<Schemas>)
		| undefined,
	maxAttempts = 3,
	initialDelay = 1000,
	maxDelay = 30000,
): Promise<void> {
	const url = `${baseUrl}/database/${db.name}`;

	// Get current snapshot
	const snapshot = db.toSnapshot();

	// Call onRequest hook
	const requestResult = onRequest?.({
		operation: "PATCH",
		url,
		snapshot,
	});

	// Check if request should be skipped
	if (requestResult && "skip" in requestResult && requestResult.skip) {
		return;
	}

	// Extract headers and potentially transformed snapshot
	const headers =
		requestResult && "headers" in requestResult
			? requestResult.headers
			: undefined;

	const requestSnapshot =
		requestResult && "snapshot" in requestResult
			? requestResult.snapshot
			: snapshot;

	// Execute fetch with retry
	const executeRequest = async (): Promise<void> => {
		const response = await fetch(url, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				...headers,
			},
			body: JSON.stringify(requestSnapshot),
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const responseSnapshot =
			(await response.json()) as DatabaseSnapshot<Schemas>;

		// Call onResponse hook
		const responseResult = onResponse?.({ snapshot: responseSnapshot });

		// Check if merge should be skipped
		if (responseResult && "skip" in responseResult && responseResult.skip) {
			return;
		}

		// Use transformed snapshot if provided, otherwise use original
		const finalSnapshot =
			responseResult && "snapshot" in responseResult
				? responseResult.snapshot
				: responseSnapshot;

		// Merge server response (trust LWW merge)
		db.mergeSnapshot(finalSnapshot);
	};

	await withRetry(executeRequest, maxAttempts, initialDelay, maxDelay);
}

/**
 * Execute a function with exponential backoff retry logic
 */
async function withRetry<T>(
	fn: () => Promise<T>,
	maxAttempts: number,
	initialDelay: number,
	maxDelay: number,
): Promise<T> {
	let lastError: Error | undefined;
	let delay = initialDelay;

	for (let attempt = 0; attempt < maxAttempts; attempt++) {
		try {
			return await fn();
		} catch (error) {
			lastError = error instanceof Error ? error : new Error(String(error));

			// Don't wait after the last attempt
			if (attempt < maxAttempts - 1) {
				await new Promise((resolve) => setTimeout(resolve, delay));
				// Exponential backoff with cap
				delay = Math.min(delay * 2, maxDelay);
			}
		}
	}

	// All attempts failed
	throw lastError;
}
