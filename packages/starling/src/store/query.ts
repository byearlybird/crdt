import type { Document, DocumentWithInternals } from "./document";
import type { SchemasMap } from "./types";

/**
 * Query context providing read-only access to specified documents.
 * Only documents declared in the documents array are accessible.
 */
export type QueryContext<
	Schemas extends SchemasMap,
	Keys extends ReadonlyArray<keyof Schemas>,
> = Pick<
	{
		[K in keyof Schemas]: Document<Schemas[K]>;
	},
	Keys[number]
>;

/**
 * Execute a read-only query with explicit dependencies.
 *
 * @param documents - Active document instances
 * @param documentNames - Array of document names to include in query
 * @param callback - Query callback with read-only context
 * @returns The return value from the callback
 *
 * @remarks
 * - No cloning needed - provides direct read-only access
 * - Documents are accessed in their current state
 * - TypeScript enforces that only declared documents are accessible
 * - Mutations inside queries are NOT recommended (use transactions instead)
 */
export function executeQuery<
	Schemas extends SchemasMap,
	Keys extends ReadonlyArray<keyof Schemas>,
	R,
>(
	documents: { [K in keyof Schemas]: DocumentWithInternals<Schemas[K]> },
	documentNames: Keys,
	callback: (q: QueryContext<Schemas, Keys>) => R,
): R {
	// Build query context with only specified documents
	const queryContext = {} as QueryContext<Schemas, Keys>;

	for (const name of documentNames) {
		queryContext[name] = documents[name] as Document<Schemas[typeof name]>;
	}

	return callback(queryContext);
}
