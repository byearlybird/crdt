import { createClock, MIN_EVENTSTAMP, type StarlingDocument } from "../core";
import {
	type Collection,
	type CollectionWithInternals,
	createCollection,
	type MutationBatch,
} from "./collection";
import { createEmitter } from "./emitter";
import { executeQuery, type QueryContext, type QueryHandle } from "./query";
import type { StandardSchemaV1 } from "./standard-schema";
import { executeTransaction, type TransactionContext } from "./transaction";
import type { AnyObjectSchema, DatabaseSnapshot, SchemasMap } from "./types";

export type Collections<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: Collection<Schemas[K]>;
};

export type CollectionConfigMap<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: CollectionConfig<Schemas[K]>;
};

type CollectionInstances<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: CollectionWithInternals<Schemas[K]>;
};

export type MutationEnvelope<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: {
		collection: K;
	} & MutationBatch<StandardSchemaV1.InferOutput<Schemas[K]>>;
}[keyof Schemas];

export type DatabaseMutationEvent<Schemas extends SchemasMap> =
	MutationEnvelope<Schemas>;

export type DatabaseEvents<Schemas extends SchemasMap> = {
	mutation: DatabaseMutationEvent<Schemas>;
};

export type CollectionConfig<T extends AnyObjectSchema> = {
	schema: T;
	getId: (item: StandardSchemaV1.InferOutput<T>) => string;
};

export type DatabasePlugin<Schemas extends SchemasMap> = {
	handlers: {
		init?: (db: Database<Schemas>) => Promise<unknown> | unknown;
		dispose?: (db: Database<Schemas>) => Promise<unknown> | unknown;
	};
};

export type DbConfig<Schemas extends SchemasMap> = {
	name: string;
	schema: CollectionConfigMap<Schemas>;
	version?: number;
};

export type Database<Schemas extends SchemasMap> = Collections<Schemas> & {
	name: string;
	version: number;
	begin<R>(callback: (tx: TransactionContext<Schemas>) => R): R;
	query<R>(callback: (ctx: QueryContext<Schemas>) => R): QueryHandle<R>;
	toSnapshot(): DatabaseSnapshot<Schemas>;
	mergeSnapshot(snapshot: DatabaseSnapshot<Schemas>): void;
	on(
		event: "mutation",
		handler: (payload: DatabaseMutationEvent<Schemas>) => unknown,
	): () => void;
	use(plugin: DatabasePlugin<Schemas>): Database<Schemas>;
	init(): Promise<Database<Schemas>>;
	dispose(): Promise<void>;
	collectionKeys(): (keyof Schemas)[];
};

/**
 * Create a typed database instance with collection access.
 * @param config - Database configuration
 * @param config.name - Database name used for persistence and routing
 * @param config.schema - Collection schema definitions
 * @param config.version - Optional database version, defaults to 1
 * @returns A database instance with typed collection properties
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
 *
 * const task = db.tasks.add({ title: 'Learn Starling' });
 * ```
 */
export function createDatabase<Schemas extends SchemasMap>(
	config: DbConfig<Schemas>,
): Database<Schemas> {
	const { name, schema, version = 1 } = config;
	const clock = createClock();
	const getEventstamp = () => clock.now();
	const collections = makeCollections(schema, getEventstamp);

	// Cast to public Collection type (hides Symbol-keyed internals)
	const publicCollections = collections as unknown as Collections<Schemas>;

	// Database-level emitter
	const dbEmitter = createEmitter<DatabaseEvents<Schemas>>();

	// Subscribe to all collection events and re-emit at database level
	for (const collectionName of Object.keys(collections) as (keyof Schemas)[]) {
		const collection = collections[collectionName];

		collection.on("mutation", (mutations) => {
			// Only emit if there were actual changes
			if (
				mutations.added.length > 0 ||
				mutations.updated.length > 0 ||
				mutations.removed.length > 0
			) {
				dbEmitter.emit("mutation", {
					collection: collectionName,
					added: mutations.added,
					updated: mutations.updated,
					removed: mutations.removed,
				} as DatabaseMutationEvent<Schemas>);
			}
		});
	}

	const plugins: DatabasePlugin<Schemas>[] = [];

	const db: Database<Schemas> = {
		...publicCollections,
		name,
		version,
		begin<R>(callback: (tx: TransactionContext<Schemas>) => R): R {
			return executeTransaction(schema, collections, getEventstamp, callback);
		},
		query<R>(callback: (ctx: QueryContext<Schemas>) => R): QueryHandle<R> {
			return executeQuery(db, callback);
		},
		toSnapshot(): DatabaseSnapshot<Schemas> {
			const collectionDocs = {} as {
				[K in keyof Schemas]: StarlingDocument<
					StandardSchemaV1.InferOutput<Schemas[K]>
				>;
			};

			for (const collectionName of Object.keys(
				collections,
			) as (keyof Schemas)[]) {
				collectionDocs[collectionName] =
					collections[collectionName].toDocument();
			}

			// Find the maximum eventstamp across all collections
			let latest = MIN_EVENTSTAMP;
			for (const doc of Object.values(collectionDocs)) {
				if (doc.latest > latest) {
					latest = doc.latest as string;
				}
			}

			return {
				version: "1.0",
				name,
				latest,
				collections: collectionDocs,
			};
		},
		mergeSnapshot(snapshot: DatabaseSnapshot<Schemas>): void {
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
		},
		on(event, handler) {
			return dbEmitter.on(event, handler);
		},
		use(plugin: DatabasePlugin<Schemas>) {
			plugins.push(plugin);
			return db;
		},
		async init() {
			// Execute all plugin init handlers sequentially
			for (const plugin of plugins) {
				if (plugin.handlers.init) {
					await plugin.handlers.init(db);
				}
			}
			return db;
		},
		async dispose() {
			// Execute all plugin dispose handlers sequentially (in reverse order)
			for (let i = plugins.length - 1; i >= 0; i--) {
				const plugin = plugins[i];
				if (plugin?.handlers.dispose) {
					await plugin.handlers.dispose(db);
				}
			}
		},
		collectionKeys() {
			return Object.keys(collections) as (keyof Schemas)[];
		},
	};

	return db;
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
