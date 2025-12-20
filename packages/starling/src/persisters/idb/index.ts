import type { Store } from "../../store/store";
import type { StoreState } from "../../store/types";

export type IdbPersisterConfig = {
	/**
	 * Version of the IndexedDB database
	 * @default 1
	 */
	version?: number;
	/**
	 * Use BroadcastChannel API for instant cross-tab sync
	 * @default true
	 */
	useBroadcastChannel?: boolean;
};

/**
 * Create an IndexedDB persister for Starling stores.
 *
 * The persister:
 * - Loads existing snapshot from IndexedDB on init
 * - Persists store snapshot to IndexedDB on every mutation
 * - Enables instant cross-tab sync via BroadcastChannel API
 *
 * Cross-tab sync uses the BroadcastChannel API to notify other tabs
 * of changes in real-time. When a mutation occurs in one tab, other tabs
 * are instantly notified and reload the data from IndexedDB.
 *
 * @param store - The Starling store to persist
 * @param config - IndexedDB configuration
 * @returns A cleanup function to stop persistence and close the database
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
 * const cleanup = await createIdbPersister(store);
 *
 * // Later, when done:
 * cleanup();
 * ```
 *
 * @example Disable BroadcastChannel
 * ```typescript
 * const store = createStore({
 *   name: "my-app",
 *   schema: {
 *     tasks: { schema: taskSchema, getId: (task) => task.id },
 *   },
 * });
 *
 * const cleanup = await createIdbPersister(store, {
 *   useBroadcastChannel: false
 * });
 * ```
 */
export async function createIdbPersister(
	store: Store<any>,
	config: IdbPersisterConfig = {},
): Promise<() => void> {
	const { version = 1, useBroadcastChannel = true } = config;
	let dbInstance: IDBDatabase | null = null;
	let unsubscribe: (() => void) | null = null;
	let broadcastChannel: BroadcastChannel | null = null;
	const instanceId = crypto.randomUUID();

	// Open IndexedDB connection with single store
	dbInstance = await openDatabase(store.name, version);

	// Load existing snapshot from IndexedDB
	const savedSnapshot = await loadSnapshot(dbInstance);

	// Merge loaded snapshot into store
	if (savedSnapshot) {
		store.mergeState(savedSnapshot);
	}

	// Subscribe to mutations and persist on change
	unsubscribe = store.on("mutation", async () => {
		if (dbInstance) {
			const snapshot = store.toJSON();
			await saveSnapshot(dbInstance, snapshot);

			// Broadcast changes to other tabs via BroadcastChannel
			if (broadcastChannel) {
				broadcastChannel.postMessage({
					type: "mutation",
					instanceId,
					timestamp: Date.now(),
				});
			}
		}
	});

	// Set up BroadcastChannel for instant cross-tab sync
	if (useBroadcastChannel && typeof BroadcastChannel !== "undefined") {
		broadcastChannel = new BroadcastChannel(`starling:${store.name}`);

		// Listen for changes from other tabs
		broadcastChannel.onmessage = async (event) => {
			// Ignore our own broadcasts
			if (event.data.instanceId === instanceId) {
				return;
			}

			if (event.data.type === "mutation" && dbInstance) {
				// Another tab made changes - reload and merge
				const savedSnapshot = await loadSnapshot(dbInstance);
				if (savedSnapshot) {
					store.mergeState(savedSnapshot);
				}
			}
		};
	}

	// Return cleanup function
	return () => {
		// Close BroadcastChannel
		if (broadcastChannel) {
			broadcastChannel.close();
			broadcastChannel = null;
		}

		// Unsubscribe from mutation events
		if (unsubscribe) {
			unsubscribe();
			unsubscribe = null;
		}

		// Close the database connection
		if (dbInstance) {
			dbInstance.close();
			dbInstance = null;
		}
	};
}

/**
 * Open an IndexedDB database with a single snapshot store
 */
function openDatabase(dbName: string, version: number): Promise<IDBDatabase> {
	return new Promise((resolve, reject) => {
		const request = indexedDB.open(dbName, version);

		request.onerror = () => {
			reject(new Error(`Failed to open IndexedDB: ${request.error?.message}`));
		};

		request.onsuccess = () => {
			resolve(request.result);
		};

		request.onupgradeneeded = (event) => {
			const db = (event.target as IDBOpenDBRequest).result;

			// Create single snapshot store if it doesn't exist
			if (!db.objectStoreNames.contains("snapshot")) {
				db.createObjectStore("snapshot");
			}
		};
	});
}

/**
 * Load store snapshot from IndexedDB
 */
async function loadSnapshot(db: IDBDatabase): Promise<StoreState<any> | null> {
	return getFromStore<StoreState<any>>(db, "snapshot", "current");
}

/**
 * Save store snapshot to IndexedDB
 */
async function saveSnapshot(
	db: IDBDatabase,
	snapshot: StoreState<any>,
): Promise<void> {
	await putToStore(db, "snapshot", "current", snapshot);
}

/**
 * Get a value from an IndexedDB object store
 */
function getFromStore<T>(
	db: IDBDatabase,
	storeName: string,
	key: string,
): Promise<T | null> {
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(storeName, "readonly");
		const store = transaction.objectStore(storeName);
		const request = store.get(key);

		request.onerror = () => {
			reject(
				new Error(
					`Failed to get from store ${storeName}: ${request.error?.message}`,
				),
			);
		};

		request.onsuccess = () => {
			resolve(request.result ?? null);
		};
	});
}

/**
 * Put a value into an IndexedDB object store
 */
function putToStore<T>(
	db: IDBDatabase,
	storeName: string,
	key: string,
	value: T,
): Promise<void> {
	return new Promise((resolve, reject) => {
		const transaction = db.transaction(storeName, "readwrite");
		const store = transaction.objectStore(storeName);
		const request = store.put(value, key);

		request.onerror = () => {
			reject(
				new Error(
					`Failed to put to store ${storeName}: ${request.error?.message}`,
				),
			);
		};

		request.onsuccess = () => {
			resolve();
		};
	});
}
