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

/**
 * Transaction context providing access to specified collections.
 * Only collections declared in the collection array are accessible.
 */
export type TransactionContext<
	Schemas extends SchemasMap,
	Keys extends ReadonlyArray<keyof Schemas>,
> = Pick<TransactionCollectionHandles<Schemas>, Keys[number]> & {
	rollback(): void;
};

/**
 * Execute a transaction with snapshot isolation and explicit dependencies.
 *
 * @param configs - Collection configurations for creating new instances
 * @param collections - Active collection instances (mutable reference)
 * @param getEventstamp - Function to generate eventstamps
 * @param collectionNames - Array of collection names to include in transaction
 * @param callback - Transaction callback with tx context
 * @returns The return value from the callback
 *
 * @remarks
 * - Only specified collections are cloned (lazy cloning for performance)
 * - Provides snapshot isolation: tx sees consistent data from transaction start
 * - Explicit rollback via tx.rollback() or implicit on exception
 * - TypeScript enforces that only declared collections are accessible
 */
export function executeTransaction<
	Schemas extends SchemasMap,
	Keys extends ReadonlyArray<keyof Schemas>,
	R,
>(
	configs: CollectionConfigMap<Schemas>,
	collections: { [K in keyof Schemas]: CollectionWithInternals<Schemas[K]> },
	getEventstamp: () => string,
	collectionNames: Keys,
	callback: (tx: TransactionContext<Schemas, Keys>) => R,
): R {
	// Clone ONLY specified collections (efficient)
	const clonedCollections = {} as {
		[K in keyof Schemas]: CollectionWithInternals<Schemas[K]>;
	};

	for (const name of collectionNames) {
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
	} as TransactionContext<Schemas, Keys>;

	// Execute callback
	const result = callback(tx);

	// Commit only if not rolled back
	if (!shouldRollback) {
		// Commit only the collections that were cloned
		for (const name of collectionNames) {
			const original = collections[name] as CollectionWithInternals<AnyObjectSchema>;
			const cloned = clonedCollections[name] as CollectionWithInternals<AnyObjectSchema>;

			const pendingMutations = cloned[CollectionInternals.getPendingMutations]!();
			original[CollectionInternals.replaceData]!(cloned[CollectionInternals.data]!());
			original[CollectionInternals.emitMutations]!(pendingMutations);
		}
	}

	return result;
}
