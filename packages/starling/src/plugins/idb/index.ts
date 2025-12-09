import type { StarlingDocument } from "../../core";
import type { Database, DatabasePlugin } from "../../database/db";

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
 * - Loads existing documents from IndexedDB on init
 * - Persists all documents to IndexedDB on every mutation
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
				const collectionNames = db.collectionKeys() as string[];

				// Open IndexedDB connection
				dbInstance = await openDatabase(db.name, version, collectionNames);

				// Load existing documents from IndexedDB
				const savedDocs = await loadDocuments(dbInstance, collectionNames);

				// Merge loaded documents into each collection
				for (const collectionName of Object.keys(savedDocs)) {
					const doc = savedDocs[collectionName];
					const collection = db[collectionName];
					if (doc && collection) {
						collection.merge(doc);
					}
				}

				// Subscribe to mutations and persist on change
				unsubscribe = db.on("mutation", async () => {
					if (dbInstance) {
						const docs = db.toDocuments();
						await saveDocuments(dbInstance, docs);

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
							const savedDocs = await loadDocuments(
								dbInstance,
								collectionNames,
							);

							for (const collectionName of Object.keys(savedDocs)) {
								const doc = savedDocs[collectionName];
								const collection = db[collectionName];
								if (doc && collection) {
									collection.merge(doc);
								}
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
					const docs = db.toDocuments();
					await saveDocuments(dbInstance, docs);

					// Close the database connection
					dbInstance.close();
					dbInstance = null;
				}
			},
		},
	};
}

/**
 * Open an IndexedDB database and create object stores for each collection
 */
function openDatabase(
	dbName: string,
	version: number,
	collectionNames: string[],
): Promise<IDBDatabase> {
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

			// Create object stores for each collection if they don't exist
			for (const collectionName of collectionNames) {
				if (!db.objectStoreNames.contains(collectionName)) {
					db.createObjectStore(collectionName);
				}
			}
		};
	});
}

/**
 * Load documents from IndexedDB for all collections
 */
async function loadDocuments(
	db: IDBDatabase,
	collectionNames: string[],
): Promise<Record<string, StarlingDocument<any>>> {
	const documents: Record<string, StarlingDocument<any>> = {};

	for (const collectionName of collectionNames) {
		if (db.objectStoreNames.contains(collectionName)) {
			const doc = await getFromStore<StarlingDocument<any>>(
				db,
				collectionName,
				"document",
			);
			if (doc) {
				documents[collectionName] = doc;
			}
		}
	}

	return documents;
}

/**
 * Save documents to IndexedDB for all collections
 */
async function saveDocuments(
	db: IDBDatabase,
	documents: Record<string, StarlingDocument<any>>,
): Promise<void> {
	const promises: Promise<void>[] = [];

	for (const collectionName of Object.keys(documents)) {
		if (db.objectStoreNames.contains(collectionName)) {
			promises.push(
				putToStore(db, collectionName, "document", documents[collectionName]),
			);
		}
	}

	await Promise.all(promises);
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
