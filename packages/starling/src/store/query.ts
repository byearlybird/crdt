import type { DocHandle, DocHandleWithInternals } from "./doc-handle";
import type { SchemasMap } from "./types";

/**
 * Query context providing read-only access to specified doc handles.
 * Only doc handles declared in the docHandles array are accessible.
 */
export type QueryContext<
	Schemas extends SchemasMap,
	Keys extends ReadonlyArray<keyof Schemas>,
> = Pick<
	{
		[K in keyof Schemas]: DocHandle<Schemas[K]>;
	},
	Keys[number]
>;

/**
 * Execute a read-only query with explicit dependencies.
 *
 * No cloning - provides direct read access to current state.
 * For mutations, use transact() instead.
 */
export function executeQuery<
	Schemas extends SchemasMap,
	Keys extends ReadonlyArray<keyof Schemas>,
	R,
>(
	docHandles: { [K in keyof Schemas]: DocHandleWithInternals<Schemas[K]> },
	handleNames: Keys,
	callback: (q: QueryContext<Schemas, Keys>) => R,
): R {
	// Build query context with only specified doc handles
	const queryContext = {} as QueryContext<Schemas, Keys>;

	for (const name of handleNames) {
		queryContext[name] = docHandles[name] as DocHandle<Schemas[typeof name]>;
	}

	return callback(queryContext);
}
