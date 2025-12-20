import type { Resource } from "../state";
import {
	createDocHandle,
	type DocHandle,
	DocHandleInternals,
	type DocHandleWithInternals,
	type MutationBatch,
} from "./doc-handle";
import type { DocHandleConfigMap } from "./store";
import type { AnyObjectSchema, SchemasMap } from "./types";

/** Transaction-safe doc handle that excludes serialization */
export type TransactionDocHandle<T extends AnyObjectSchema> = Omit<
	DocHandle<T>,
	"toJSON"
>;

type TransactionDocHandles<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: TransactionDocHandle<Schemas[K]>;
};

/**
 * Transaction context providing access to specified doc handles.
 * Only doc handles declared in the docHandles array are accessible.
 */
export type TransactionContext<
	Schemas extends SchemasMap,
	Keys extends ReadonlyArray<keyof Schemas>,
> = Pick<TransactionDocHandles<Schemas>, Keys[number]> & {
	rollback(): void;
};

/**
 * Execute a transaction with snapshot isolation.
 *
 * Only specified doc handles are cloned for efficiency.
 * Call tx.rollback() to abort, or throw to rollback automatically.
 *
 * @example
 * ```typescript
 * store.transact(["tasks", "users"], (tx) => {
 *   const task = tx.tasks.add({ title: "Write code" });
 *   tx.users.update(userId, { lastActivity: Date.now() });
 * });
 * ```
 */
export function executeTransaction<
	Schemas extends SchemasMap,
	Keys extends ReadonlyArray<keyof Schemas>,
	R,
>(
	configs: DocHandleConfigMap<Schemas>,
	docHandles: { [K in keyof Schemas]: DocHandleWithInternals<Schemas[K]> },
	getEventstamp: () => string,
	handleNames: Keys,
	callback: (tx: TransactionContext<Schemas, Keys>) => R,
): R {
	// Clone ONLY specified doc handles (efficient)
	const clonedDocHandles = {} as {
		[K in keyof Schemas]: DocHandleWithInternals<Schemas[K]>;
	};

	for (const name of handleNames) {
		const original = docHandles[name];
		const config = configs[name];

		const getData = original[DocHandleInternals.data] as
			| (() => Map<string, Resource<any>>)
			| undefined;
		if (!getData) continue;

		clonedDocHandles[name] = createDocHandle(
			name as string,
			config.schema,
			config.getId,
			getEventstamp,
			getData(),
			{ autoFlush: false },
		);
	}

	// Track rollback state
	let shouldRollback = false;

	const tx = {
		...clonedDocHandles,
		rollback() {
			shouldRollback = true;
		},
	} as TransactionContext<Schemas, Keys>;

	// Execute callback
	const result = callback(tx);

	// Commit only if not rolled back
	if (!shouldRollback) {
		// Commit only the doc handles that were cloned
		for (const name of handleNames) {
			const original = docHandles[
				name
			] as DocHandleWithInternals<AnyObjectSchema>;
			const cloned = clonedDocHandles[
				name
			] as DocHandleWithInternals<AnyObjectSchema>;

			const getPendingMutations = cloned[
				DocHandleInternals.getPendingMutations
			] as (() => MutationBatch<any>) | undefined;
			const replaceData = original[DocHandleInternals.replaceData] as
				| ((data: Map<string, Resource<any>>) => void)
				| undefined;
			const emitMutations = original[DocHandleInternals.emitMutations] as
				| ((mutations: MutationBatch<any>) => void)
				| undefined;
			const getData = cloned[DocHandleInternals.data] as
				| (() => Map<string, Resource<any>>)
				| undefined;

			if (!getPendingMutations || !replaceData || !emitMutations || !getData) {
				continue;
			}

			const pendingMutations = getPendingMutations();
			const data = getData();
			replaceData(data);
			emitMutations(pendingMutations);
		}
	}

	return result;
}
