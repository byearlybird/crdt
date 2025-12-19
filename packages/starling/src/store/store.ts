import { createClock, MIN_EVENTSTAMP, type StarlingDocument } from "../core";
import {
	type Collection,
	CollectionInternals,
	type CollectionWithInternals,
	createCollection,
	type MutationBatch,
} from "./collection";
import { createEmitter } from "./emitter";
import { executeQuery, type QueryContext } from "./query";
import { executeTransaction, type TransactionContext } from "./transaction";
import type {
	AnyObjectSchema,
	StoreSnapshot,
	InferOutput,
	SchemasMap,
} from "./types";

export type Collections<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: Collection<Schemas[K]>;
};

export type CollectionConfigMap<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: CollectionConfig<Schemas[K]>;
};

type CollectionInstances<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: CollectionWithInternals<Schemas[K]>;
};

export type CollectionMutation<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: {
		collection: K;
	} & MutationBatch<InferOutput<Schemas[K]>>;
}[keyof Schemas];

export type StoreEvents<Schemas extends SchemasMap> = {
	mutation: CollectionMutation<Schemas>;
};

export type CollectionConfig<T extends AnyObjectSchema> = {
	schema: T;
	getId: (item: InferOutput<T>) => string;
};

export type StoreConfig<Schemas extends SchemasMap> = {
	name: string;
	schema: CollectionConfigMap<Schemas>;
	version?: number;
};

export type Store<Schemas extends SchemasMap> = Collections<Schemas> & {
	name: string;
	version: number;
	transact<Keys extends ReadonlyArray<keyof Schemas>, R>(
		collections: Keys,
		callback: (tx: TransactionContext<Schemas, Keys>) => R,
	): R;
	query<Keys extends ReadonlyArray<keyof Schemas>, R>(
		collections: Keys,
		callback: (q: QueryContext<Schemas, Keys>) => R,
	): R;
	toSnapshot(): StoreSnapshot<Schemas>;
	mergeSnapshot(snapshot: StoreSnapshot<Schemas>): void;
	on(
		event: "mutation",
		handler: (payload: CollectionMutation<Schemas>) => unknown,
	): () => void;
	collectionKeys(): (keyof Schemas)[];
};

/**
 * Create a typed store instance with collection access.
 * @param config - Store configuration
 * @param config.name - Store name used for persistence and routing
 * @param config.schema - Collection schema definitions
 * @param config.version - Optional store version, defaults to 1
 * @returns A store instance with typed collection properties
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
 * const task = store.tasks.add({ title: 'Learn Starling' });
 * ```
 */
export function createStore<Schemas extends SchemasMap>(
	config: StoreConfig<Schemas>,
): Store<Schemas> {
	const { name, schema, version = 1 } = config;
	const clock = createClock();
	const getEventstamp = () => clock.now();
	const collections = makeCollections(schema, getEventstamp);

	// Cast to public Collection type (hides Symbol-keyed internals)
	const publicCollections = collections as unknown as Collections<Schemas>;

	// Store-level emitter
	const storeEmitter = createEmitter<StoreEvents<Schemas>>();

	// Subscribe to all collection events and re-emit at store level
	for (const collectionName of Object.keys(collections) as (keyof Schemas)[]) {
		const collection = collections[collectionName];

		// Type assertion needed for Symbol-keyed method access
		const onMutation = (
			collection as unknown as CollectionWithInternals<AnyObjectSchema>
		)[CollectionInternals.onMutation]!;

		onMutation((mutations) => {
			// Only emit if there were actual changes
			if (
				mutations.added.length > 0 ||
				mutations.updated.length > 0 ||
				mutations.removed.length > 0
			) {
				storeEmitter.emit("mutation", {
					collection: collectionName,
					added: mutations.added,
					updated: mutations.updated,
					removed: mutations.removed,
				} as CollectionMutation<Schemas>);
			}
		});
	}

	const store: Store<Schemas> = {
		...publicCollections,
		name,
		version,
		transact<Keys extends ReadonlyArray<keyof Schemas>, R>(
			collectionNames: Keys,
			callback: (tx: TransactionContext<Schemas, Keys>) => R,
		): R {
			return executeTransaction(
				schema,
				collections,
				getEventstamp,
				collectionNames,
				callback,
			);
		},
		query<Keys extends ReadonlyArray<keyof Schemas>, R>(
			collectionNames: Keys,
			callback: (q: QueryContext<Schemas, Keys>) => R,
		): R {
			return executeQuery(collections, collectionNames, callback);
		},
		toSnapshot(): StoreSnapshot<Schemas> {
			const collectionDocs = {} as {
				[K in keyof Schemas]: StarlingDocument<InferOutput<Schemas[K]>>;
			};

			for (const collectionName of Object.keys(
				collections,
			) as (keyof Schemas)[]) {
				collectionDocs[collectionName] =
					collections[collectionName].toDocument();
			}

			// Use current clock value as snapshot latest
			const latest = clock.latest();

			return {
				version: "1.0",
				name,
				latest,
				collections: collectionDocs,
			};
		},
		mergeSnapshot(snapshot: StoreSnapshot<Schemas>): void {
			// Validate version compatibility
			if (snapshot.version !== "1.0") {
				throw new Error(`Unsupported snapshot version: ${snapshot.version}`);
			}

			// Merge each collection
			for (const collectionName of Object.keys(
				snapshot.collections,
			) as (keyof Schemas)[]) {
				const collection = collections[collectionName];
				const document = snapshot.collections[collectionName];
				if (collection && document) {
					collection.merge(document);
				}
			}

			// Forward clock based on snapshot latest
			clock.forward(snapshot.latest);
		},
		on(event, handler) {
			return storeEmitter.on(event, handler);
		},
		collectionKeys() {
			return Object.keys(collections) as (keyof Schemas)[];
		},
	};

	return store;
}

function makeCollections<Schemas extends SchemasMap>(
	configs: CollectionConfigMap<Schemas>,
	getEventstamp: () => string,
): CollectionInstances<Schemas> {
	const collections = {} as CollectionInstances<Schemas>;

	for (const name of Object.keys(configs) as (keyof Schemas)[]) {
		const config = configs[name];
		collections[name] = createCollection(
			name as string,
			config.schema,
			config.getId,
			getEventstamp,
		);
	}

	return collections;
}
