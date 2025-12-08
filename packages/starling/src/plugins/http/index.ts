import type { AnyObject, StarlingDocument } from "../../core";
import type { Database, DatabasePlugin } from "../../database/db";
import type { StandardSchemaV1 } from "../../database/standard-schema";
import type { SchemasMap } from "../../database/types";

/**
 * Context provided to the onRequest hook
 */
export type RequestContext<T extends AnyObject = AnyObject> = {
	collection: string;
	operation: "GET" | "PATCH";
	url: string;
	document?: StarlingDocument<T>; // Present for PATCH operations
};

/**
 * Result returned by the onRequest hook
 */
export type RequestHookResult<T extends AnyObject = AnyObject> =
	| { skip: true }
	| { headers?: Record<string, string>; document?: StarlingDocument<T> }
	| undefined;

/**
 * Result returned by the onResponse hook
 */
export type ResponseHookResult<T extends AnyObject = AnyObject> =
	| { document: StarlingDocument<T> }
	| { skip: true }
	| undefined; // Use original document

/**
 * Configuration for the HTTP plugin
 */
export type HttpPluginConfig<_Schemas extends SchemasMap> = {
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
	 * Return { document } to transform the document (PATCH only)
	 */
	onRequest?: <T extends AnyObject>(
		context: RequestContext<T>,
	) => RequestHookResult<T>;

	/**
	 * Hook called after each successful HTTP response
	 * Return { skip: true } to skip merging the response
	 * Return { document } to transform the document before merging
	 */
	onResponse?: <T extends AnyObject>(context: {
		collection: string;
		document: StarlingDocument<T>;
	}) => ResponseHookResult<T>;

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
 * - Fetches all collections from the server on init (single attempt)
 * - Polls the server at regular intervals to fetch updates (with retry)
 * - Debounces local mutations and pushes them to the server (with retry)
 * - Supports request/response hooks for authentication, encryption, etc.
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
 *     onRequest: ({ document }) => ({
 *       headers: { Authorization: `Bearer ${token}` },
 *       document: document ? encrypt(document) : undefined
 *     }),
 *     onResponse: ({ document }) => ({
 *       document: decrypt(document)
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
	const debounceTimers: Map<string, ReturnType<typeof setTimeout>> = new Map();

	return {
		handlers: {
			async init(db: Database<Schemas>) {
				const collectionNames = db.collectionKeys();

				// Initial fetch for all collections (single attempt, no retry)
				for (const collectionName of collectionNames) {
					try {
						await fetchCollection(
							db,
							collectionName,
							baseUrl,
							onRequest,
							onResponse,
							false, // No retry on init
						);
					} catch (error) {
						// Log error but continue with other collections
						console.error(
							`Failed to fetch collection "${String(collectionName)}" during init:`,
							error,
						);
					}
				}

				// Set up polling
				pollingTimer = setInterval(async () => {
					for (const collectionName of collectionNames) {
						try {
							await fetchCollection(
								db,
								collectionName,
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
							console.error(
								`Failed to poll collection "${String(collectionName)}":`,
								error,
							);
						}
					}
				}, pollingInterval);

				// Subscribe to mutations for debounced push
				unsubscribe = db.on("mutation", (event) => {
					const collectionName = event.collection;
					const key = String(collectionName);

					// Clear existing timer if any
					const existingTimer = debounceTimers.get(key);
					if (existingTimer) {
						clearTimeout(existingTimer);
					}

					// Schedule new push
					const timer = setTimeout(async () => {
						debounceTimers.delete(key);
						try {
							await pushCollection(
								db,
								collectionName,
								baseUrl,
								onRequest,
								onResponse,
								maxAttempts,
								initialDelay,
								maxDelay,
							);
						} catch (error) {
							console.error(
								`Failed to push collection "${String(collectionName)}":`,
								error,
							);
						}
					}, debounceDelay);

					debounceTimers.set(key, timer);
				});
			},

			async dispose(_db: Database<Schemas>) {
				// Clear polling timer
				if (pollingTimer) {
					clearInterval(pollingTimer);
					pollingTimer = null;
				}

				// Clear all debounce timers
				for (const timer of debounceTimers.values()) {
					clearTimeout(timer);
				}
				debounceTimers.clear();

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
 * Fetch a collection from the server (GET request)
 */
async function fetchCollection<Schemas extends SchemasMap>(
	db: Database<Schemas>,
	collectionName: keyof Schemas,
	baseUrl: string,
	onRequest:
		| (<T extends AnyObject>(
				context: RequestContext<T>,
		  ) => RequestHookResult<T>)
		| undefined,
	onResponse:
		| (<T extends AnyObject>(context: {
				collection: string;
				document: StarlingDocument<T>;
		  }) => ResponseHookResult<T>)
		| undefined,
	enableRetry: boolean,
	maxAttempts = 3,
	initialDelay = 1000,
	maxDelay = 30000,
): Promise<void> {
	const url = `${baseUrl}/${db.name}/${String(collectionName)}`;

	// Call onRequest hook
	const requestResult = onRequest?.({
		collection: String(collectionName),
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

		const document = (await response.json()) as StarlingDocument<
			StandardSchemaV1.InferOutput<Schemas[typeof collectionName]>
		>;

		// Call onResponse hook
		const responseResult = onResponse?.({
			collection: String(collectionName),
			document,
		});

		// Check if merge should be skipped
		if (responseResult && "skip" in responseResult && responseResult.skip) {
			return;
		}

		// Use transformed document if provided, otherwise use original
		const finalDocument =
			responseResult && "document" in responseResult
				? responseResult.document
				: document;

		// Merge into collection
		db[collectionName].merge(finalDocument);
	};

	if (enableRetry) {
		await withRetry(executeRequest, maxAttempts, initialDelay, maxDelay);
	} else {
		await executeRequest();
	}
}

/**
 * Push a collection to the server (PATCH request)
 */
async function pushCollection<Schemas extends SchemasMap>(
	db: Database<Schemas>,
	collectionName: keyof Schemas,
	baseUrl: string,
	onRequest:
		| (<T extends AnyObject>(
				context: RequestContext<T>,
		  ) => RequestHookResult<T>)
		| undefined,
	onResponse:
		| (<T extends AnyObject>(context: {
				collection: string;
				document: StarlingDocument<T>;
		  }) => ResponseHookResult<T>)
		| undefined,
	maxAttempts = 3,
	initialDelay = 1000,
	maxDelay = 30000,
): Promise<void> {
	const url = `${baseUrl}/${db.name}/${String(collectionName)}`;

	// Get current document
	const document = db[collectionName].toDocument();

	// Call onRequest hook
	const requestResult = onRequest?.({
		collection: String(collectionName),
		operation: "PATCH",
		url,
		document,
	});

	// Check if request should be skipped
	if (requestResult && "skip" in requestResult && requestResult.skip) {
		return;
	}

	// Extract headers and potentially transformed document
	const headers =
		requestResult && "headers" in requestResult
			? requestResult.headers
			: undefined;

	const requestDocument =
		requestResult && "document" in requestResult
			? requestResult.document
			: document;

	// Execute fetch with retry
	const executeRequest = async (): Promise<void> => {
		const response = await fetch(url, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				...headers,
			},
			body: JSON.stringify(requestDocument),
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const responseDocument = (await response.json()) as StarlingDocument<
			StandardSchemaV1.InferOutput<Schemas[typeof collectionName]>
		>;

		// Call onResponse hook
		const responseResult = onResponse?.({
			collection: String(collectionName),
			document: responseDocument,
		});

		// Check if merge should be skipped
		if (responseResult && "skip" in responseResult && responseResult.skip) {
			return;
		}

		// Use transformed document if provided, otherwise use original
		const finalDocument =
			responseResult && "document" in responseResult
				? responseResult.document
				: responseDocument;

		// Merge server response (trust LWW merge)
		db[collectionName].merge(finalDocument);
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
