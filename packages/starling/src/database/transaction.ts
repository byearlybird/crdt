import {
	type Collection,
	CollectionInternals,
	type CollectionWithInternals,
	createCollection,
} from "./collection";
import type { CollectionConfigMap } from "./db";
import type { AnyObjectSchema, SchemasMap } from "./types";

/** Transaction-safe collection handle that excludes serialization */
export type TransactionCollectionHandle<T extends AnyObjectSchema> = Omit<
	Collection<T>,
	"toDocument"
>;

type TransactionCollectionHandles<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: TransactionCollectionHandle<Schemas[K]>;
};

export type TransactionContext<Schemas extends SchemasMap> =
	TransactionCollectionHandles<Schemas> & {
		rollback(): void;
	};

/**
 * Execute a transaction with snapshot isolation.
 *
 * @param configs - Collection configurations for creating new instances
 * @param collections - Active collection instances (mutable reference)
 * @param getEventstamp - Function to generate eventstamps
 * @param callback - Transaction callback with tx context
 * @returns The return value from the callback
 *
 * @remarks
 * - All collections are cloned upfront (eager cloning)
 * - Provides snapshot isolation: tx sees consistent data from transaction start
 * - Explicit rollback via tx.rollback() or implicit on exception
 */
export function executeTransaction<Schemas extends SchemasMap, R>(
	configs: CollectionConfigMap<Schemas>,
	collections: { [K in keyof Schemas]: CollectionWithInternals<Schemas[K]> },
	getEventstamp: () => string,
	callback: (tx: TransactionContext<Schemas>) => R,
): R {
	// Clone ALL collections upfront (eager)
	const clonedCollections = {} as {
		[K in keyof Schemas]: CollectionWithInternals<Schemas[K]>;
	};

	for (const name of Object.keys(collections) as (keyof Schemas)[]) {
		const original = collections[name];
		const config = configs[name];

		clonedCollections[name] = createCollection(
			name as string,
			config.schema,
			config.getId,
			getEventstamp,
			original[CollectionInternals.data](),
			{ autoFlush: false },
		);
	}

	// Track rollback state
	let shouldRollback = false;

	const tx = {
		...clonedCollections,
		rollback() {
			shouldRollback = true;
		},
	} as TransactionContext<Schemas>;

	// Execute callback
	const result = callback(tx);

	// Commit only if not rolled back
	if (!shouldRollback) {
		for (const name of Object.keys(clonedCollections) as (keyof Schemas)[]) {
			const original = collections[name] as CollectionWithInternals<AnyObjectSchema>;
			const cloned = clonedCollections[name] as CollectionWithInternals<AnyObjectSchema>;

			const pendingMutations = cloned[CollectionInternals.getPendingMutations]!();
			original[CollectionInternals.replaceData]!(cloned[CollectionInternals.data]!());
			original[CollectionInternals.emitMutations]!(pendingMutations);
		}
	}

	return result;
}
