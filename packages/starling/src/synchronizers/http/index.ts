import type { Store } from "../../store/store";
import type { StoreState, SchemasMap } from "../../store/types";

/**
 * Context provided to the onRequest hook
 */
export type RequestContext = {
	operation: "GET" | "PATCH";
	url: string;
	state?: StoreState<SchemasMap>; // Present for PATCH operations
};

/**
 * Result returned by the onRequest hook
 */
export type RequestHookResult =
	| { skip: true }
	| {
			headers?: Record<string, string>;
			state?: StoreState<SchemasMap>;
	  }
	| undefined;

/**
 * Result returned by the onResponse hook
 */
export type ResponseHookResult =
	| { state: StoreState<SchemasMap> }
	| { skip: true }
	| undefined; // Use original snapshot

/**
 * Configuration for the HTTP synchronizer
 */
export type HttpSynchronizerConfig = {
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
	 * Return { state } to transform the state (PATCH only)
	 */
	onRequest?: (context: RequestContext) => RequestHookResult;

	/**
	 * Hook called after each successful HTTP response
	 * Return { skip: true } to skip merging the response
	 * Return { state } to transform the state before merging
	 */
	onResponse?: (context: {
		state: StoreState<SchemasMap>;
	}) => ResponseHookResult;

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
 * Create an HTTP synchronizer for Starling stores.
 *
 * The synchronizer:
 * - Fetches store state from the server on init (single attempt)
 * - Polls the server at regular intervals to fetch updates (with retry)
 * - Debounces local mutations and pushes them to the server (with retry)
 * - Supports request/response hooks for authentication, encryption, etc.
 * - Uses endpoint: GET/PATCH /database/:name
 *
 * @param store - The Starling store to synchronize
 * @param config - HTTP synchronizer configuration
 * @returns A cleanup function to stop synchronization
 *
 * @example
 * ```typescript
 * const store = createStore({
 *   name: "my-app",
 *   schema: {
 *     tasks: { schema: taskSchema, getId: (task) => task.id },
 *   },
 * });
 *
 * const cleanup = createHttpSynchronizer(store, {
 *   baseUrl: "https://api.example.com",
 *   onRequest: () => ({
 *     headers: { Authorization: `Bearer ${token}` }
 *   })
 * });
 *
 * // Later, when done:
 * cleanup();
 * ```
 *
 * @example With encryption
 * ```typescript
 * const store = createStore({
 *   name: "my-app",
 *   schema: {
 *     tasks: { schema: taskSchema, getId: (task) => task.id },
 *   },
 * });
 *
 * const cleanup = createHttpSynchronizer(store, {
 *   baseUrl: "https://api.example.com",
 *   onRequest: ({ state }) => ({
 *     headers: { Authorization: `Bearer ${token}` },
 *     state: state ? encrypt(state) : undefined
 *   }),
 *   onResponse: ({ state }) => ({
 *     state: decrypt(state)
 *   })
 * });
 * ```
 */
export function createHttpSynchronizer(
	store: Store<any>,
	config: HttpSynchronizerConfig,
): () => void {
	const {
		baseUrl,
		pollingInterval = 5000,
		debounceDelay = 1000,
		onRequest,
		onResponse,
		retry = {},
	} = config;

	const { maxAttempts = 3, initialDelay = 1000, maxDelay = 30000 } = retry;

	// Synchronizer state
	let pollingTimer: ReturnType<typeof setInterval> | null = null;
	let unsubscribe: (() => void) | null = null;
	let debounceTimer: ReturnType<typeof setTimeout> | null = null;

	// Initial fetch (single attempt, no retry)
	(async () => {
		try {
			await fetchStore(store, baseUrl, onRequest, onResponse, false);
		} catch (error) {
			// Log error but continue
			console.error("Failed to fetch database during init:", error);
		}
	})();

	// Set up polling
	pollingTimer = setInterval(async () => {
		try {
			await fetchStore(
				store,
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
	unsubscribe = store.on("mutation", () => {
		// Clear existing timer if any
		if (debounceTimer) {
			clearTimeout(debounceTimer);
		}

		// Schedule new push
		debounceTimer = setTimeout(async () => {
			debounceTimer = null;
			try {
				await pushStore(
					store,
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

	// Return cleanup function
	return () => {
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
	};
}

/**
 * Fetch store state from the server (GET request)
 */
async function fetchStore(
	store: Store<any>,
	baseUrl: string,
	onRequest: ((context: RequestContext) => RequestHookResult) | undefined,
	onResponse:
		| ((context: {
				state: StoreState<SchemasMap>;
		  }) => ResponseHookResult)
		| undefined,
	enableRetry: boolean,
	maxAttempts = 3,
	initialDelay = 1000,
	maxDelay = 30000,
): Promise<void> {
	const url = `${baseUrl}/database/${store.name}`;

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

		const state = (await response.json()) as StoreState<SchemasMap>;

		// Call onResponse hook
		const responseResult = onResponse?.({ state });

		// Check if merge should be skipped
		if (responseResult && "skip" in responseResult && responseResult.skip) {
			return;
		}

		// Use transformed state if provided, otherwise use original
		const finalState =
			responseResult && "state" in responseResult
				? responseResult.state
				: state;

		// Merge into store
		store.mergeState(finalState);
	};

	if (enableRetry) {
		await withRetry(executeRequest, maxAttempts, initialDelay, maxDelay);
	} else {
		await executeRequest();
	}
}

/**
 * Push store state to the server (PATCH request)
 */
async function pushStore(
	store: Store<any>,
	baseUrl: string,
	onRequest: ((context: RequestContext) => RequestHookResult) | undefined,
	onResponse:
		| ((context: {
				state: StoreState<SchemasMap>;
		  }) => ResponseHookResult)
		| undefined,
	maxAttempts = 3,
	initialDelay = 1000,
	maxDelay = 30000,
): Promise<void> {
	const url = `${baseUrl}/database/${store.name}`;

	// Get current state
	const state = store.toJSON();

	// Call onRequest hook
	const requestResult = onRequest?.({
		operation: "PATCH",
		url,
		state,
	});

	// Check if request should be skipped
	if (requestResult && "skip" in requestResult && requestResult.skip) {
		return;
	}

	// Extract headers and potentially transformed state
	const headers =
		requestResult && "headers" in requestResult
			? requestResult.headers
			: undefined;

	const requestState =
		requestResult && "state" in requestResult
			? requestResult.state
			: state;

	// Execute fetch with retry
	const executeRequest = async (): Promise<void> => {
		const response = await fetch(url, {
			method: "PATCH",
			headers: {
				"Content-Type": "application/json",
				...headers,
			},
			body: JSON.stringify(requestState),
		});

		if (!response.ok) {
			throw new Error(`HTTP ${response.status}: ${response.statusText}`);
		}

		const responseState =
			(await response.json()) as StoreState<SchemasMap>;

		// Call onResponse hook
		const responseResult = onResponse?.({ state: responseState });

		// Check if merge should be skipped
		if (responseResult && "skip" in responseResult && responseResult.skip) {
			return;
		}

		// Use transformed state if provided, otherwise use original
		const finalState =
			responseResult && "state" in responseResult
				? responseResult.state
				: responseState;

		// Merge server response (trust LWW merge)
		store.mergeState(finalState);
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
