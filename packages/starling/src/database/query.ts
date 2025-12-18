import type { Collection, CollectionWithInternals } from "./collection";
import type { SchemasMap } from "./types";

/**
 * Query context providing read-only access to specified collections.
 * Only collections declared in the collection array are accessible.
 */
export type QueryContext<
	Schemas extends SchemasMap,
	Keys extends ReadonlyArray<keyof Schemas>,
> = Pick<
	{
		[K in keyof Schemas]: Collection<Schemas[K]>;
	},
	Keys[number]
>;

/**
 * Execute a read-only query with explicit dependencies.
 *
 * @param collections - Active collection instances
 * @param collectionNames - Array of collection names to include in query
 * @param callback - Query callback with read-only context
 * @returns The return value from the callback
 *
 * @remarks
 * - No cloning needed - provides direct read-only access
 * - Collections are accessed in their current state
 * - TypeScript enforces that only declared collections are accessible
 * - Mutations inside queries are NOT recommended (use transactions instead)
 */
export function executeQuery<
	Schemas extends SchemasMap,
	Keys extends ReadonlyArray<keyof Schemas>,
	R,
>(
	collections: { [K in keyof Schemas]: CollectionWithInternals<Schemas[K]> },
	collectionNames: Keys,
	callback: (q: QueryContext<Schemas, Keys>) => R,
): R {
	// Build query context with only specified collections
	const queryContext = {} as QueryContext<Schemas, Keys>;

	for (const name of collectionNames) {
		queryContext[name] = collections[name] as Collection<Schemas[typeof name]>;
	}

	return callback(queryContext);
}
