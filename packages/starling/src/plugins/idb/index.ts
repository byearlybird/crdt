import type { Database, DatabasePlugin } from "../../database/db";
import type { DatabaseSnapshot } from "../../database/types";

export type IdbPluginConfig = {
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
 * Create an IndexedDB persistence plugin for Starling databases.
 *
 * The plugin:
 * - Loads existing snapshot from IndexedDB on init
 * - Persists database snapshot to IndexedDB on every mutation
 * - Enables instant cross-tab sync via BroadcastChannel API
 * - Gracefully closes the database connection on dispose
 *
 * Cross-tab sync uses the BroadcastChannel API to notify other tabs
 * of changes in real-time. When a mutation occurs in one tab, other tabs
 * are instantly notified and reload the data from IndexedDB.
 *
 * @param config - IndexedDB configuration
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
 *   .use(idbPlugin())
 *   .init();
 * ```
 *
 * @example Disable BroadcastChannel
 * ```typescript
 * const db = await createDatabase({
 *   name: "my-app",
 *   schema: {
 *     tasks: { schema: taskSchema, getId: (task) => task.id },
 *   },
 * })
 *   .use(idbPlugin({ useBroadcastChannel: false }))
 *   .init();
 * ```
 */
export function idbPlugin(config: IdbPluginConfig = {}): DatabasePlugin<any> {
	const { version = 1, useBroadcastChannel = true } = config;
	let dbInstance: IDBDatabase | null = null;
	let unsubscribe: (() => void) | null = null;
	let broadcastChannel: BroadcastChannel | null = null;
	const instanceId = crypto.randomUUID();

	return {
		handlers: {
			async init(db: Database<any>) {
				// Open IndexedDB connection with single store
				dbInstance = await openDatabase(db.name, version);

				// Load existing snapshot from IndexedDB
				const savedSnapshot = await loadSnapshot(dbInstance);

				// Merge loaded snapshot into database
				if (savedSnapshot) {
					db.mergeSnapshot(savedSnapshot);
				}

				// Subscribe to mutations and persist on change
				unsubscribe = db.on("mutation", async () => {
					if (dbInstance) {
						const snapshot = db.toSnapshot();
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
					broadcastChannel = new BroadcastChannel(`starling:${db.name}`);

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
								db.mergeSnapshot(savedSnapshot);
							}
						}
					};
				}
			},

			async dispose(db: Database<any>) {
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

				// Save final state
				if (dbInstance) {
					const snapshot = db.toSnapshot();
					await saveSnapshot(dbInstance, snapshot);

					// Close the database connection
					dbInstance.close();
					dbInstance = null;
				}
			},
		},
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
 * Load database snapshot from IndexedDB
 */
async function loadSnapshot(
	db: IDBDatabase,
): Promise<DatabaseSnapshot<any> | null> {
	return getFromStore<DatabaseSnapshot<any>>(db, "snapshot", "current");
}

/**
 * Save database snapshot to IndexedDB
 */
async function saveSnapshot(
	db: IDBDatabase,
	snapshot: DatabaseSnapshot<any>,
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
