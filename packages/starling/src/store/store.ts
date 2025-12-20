import { createClock } from "../clock";
import type { AnyObject, DocumentState } from "../state";
import {
	createDocHandle,
	type DocHandle,
	DocHandleInternals,
	type DocHandleWithInternals,
	type MutationBatch,
} from "./doc-handle";
import { createEmitter } from "./emitter";
import { executeQuery, type QueryContext } from "./query";
import { executeTransaction, type TransactionContext } from "./transaction";
import type {
	AnyObjectSchema,
	InferOutput,
	SchemasMap,
	StoreState,
} from "./types";

export type DocHandles<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: DocHandle<Schemas[K]>;
};

export type DocHandleConfigMap<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: DocHandleConfig<Schemas[K]>;
};

type DocHandleInstances<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: DocHandleWithInternals<Schemas[K]>;
};

export type DocHandleMutation<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: {
		docHandle: K;
	} & MutationBatch<InferOutput<Schemas[K]>>;
}[keyof Schemas];

export type StoreEvents<Schemas extends SchemasMap> = {
	mutation: DocHandleMutation<Schemas>;
};

export type DocHandleConfig<T extends AnyObjectSchema> = {
	schema: T;
	getId: (item: InferOutput<T>) => string;
};

export type StoreConfig<Schemas extends SchemasMap> = {
	name: string;
	schema: DocHandleConfigMap<Schemas>;
	version?: number;
};

export type Store<Schemas extends SchemasMap> = DocHandles<Schemas> & {
	name: string;
	version: number;
	transact<Keys extends ReadonlyArray<keyof Schemas>, R>(
		docHandles: Keys,
		callback: (tx: TransactionContext<Schemas, Keys>) => R,
	): R;
	query<Keys extends ReadonlyArray<keyof Schemas>, R>(
		docHandles: Keys,
		callback: (q: QueryContext<Schemas, Keys>) => R,
	): R;
	toJSON(): StoreState<Schemas>;
	mergeState(state: StoreState<Schemas>): void;
	on(
		event: "mutation",
		handler: (payload: DocHandleMutation<Schemas>) => unknown,
	): () => void;
};

function makeDocHandles<Schemas extends SchemasMap>(
	configs: DocHandleConfigMap<Schemas>,
	getEventstamp: () => string,
): DocHandleInstances<Schemas> {
	const docHandles = {} as DocHandleInstances<Schemas>;

	for (const name of Object.keys(configs) as (keyof Schemas)[]) {
		const config = configs[name];
		docHandles[name] = createDocHandle(
			name as string,
			config.schema,
			config.getId,
			getEventstamp,
		);
	}

	return docHandles;
}

/**
 * Create a typed store instance with doc handle access.
 * @param config - Store configuration
 * @param config.name - Store name used for persistence and routing
 * @param config.schema - Doc handle schema definitions
 * @param config.version - Optional store version, defaults to 1
 * @returns A store instance with typed doc handle properties
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
 * store.tasks.add({ title: 'Learn Starling' });
 * ```
 */
export function createStore<Schemas extends SchemasMap>(
	config: StoreConfig<Schemas>,
): Store<Schemas> {
	const { name, schema, version = 1 } = config;
	const clock = createClock();
	const getEventstamp = () => clock.now();
	const docHandles = makeDocHandles(schema, getEventstamp);

	// Cast to public DocHandle type (hides Symbol-keyed internals)
	const publicDocHandles = docHandles as unknown as DocHandles<Schemas>;

	const storeEmitter = createEmitter<StoreEvents<Schemas>>();
	for (const handleName of Object.keys(docHandles) as (keyof Schemas)[]) {
		const handle = docHandles[handleName];

		// Type assertion needed for Symbol-keyed method access
		const handleWithInternals =
			handle as unknown as DocHandleWithInternals<AnyObjectSchema>;
		const onMutationMethod:
			| ((handler: (batch: MutationBatch<AnyObject>) => void) => () => void)
			| undefined = handleWithInternals[DocHandleInternals.onMutation] as any;

		if (onMutationMethod) {
			onMutationMethod((mutations) => {
				// Only emit if there were actual changes
				if (
					mutations.added.length > 0 ||
					mutations.updated.length > 0 ||
					mutations.removed.length > 0
				) {
					storeEmitter.emit("mutation", {
						docHandle: handleName,
						added: mutations.added,
						updated: mutations.updated,
						removed: mutations.removed,
					} as DocHandleMutation<Schemas>);
				}
			});
		}
	}

	const store: Store<Schemas> = {
		...publicDocHandles,
		name,
		version,
		transact<Keys extends ReadonlyArray<keyof Schemas>, R>(
			handleNames: Keys,
			callback: (tx: TransactionContext<Schemas, Keys>) => R,
		): R {
			return executeTransaction(
				schema,
				docHandles,
				getEventstamp,
				handleNames,
				callback,
			);
		},
		query<Keys extends ReadonlyArray<keyof Schemas>, R>(
			handleNames: Keys,
			callback: (q: QueryContext<Schemas, Keys>) => R,
		): R {
			return executeQuery(docHandles, handleNames, callback);
		},
		toJSON(): StoreState<Schemas> {
			const documentStates = {} as {
				[K in keyof Schemas]: DocumentState<InferOutput<Schemas[K]>>;
			};

			for (const handleName of Object.keys(docHandles) as (keyof Schemas)[]) {
				documentStates[handleName] = docHandles[handleName].toJSON();
			}

			const latest = clock.latest();

			return {
				version: "1.0",
				name,
				latest,
				documents: documentStates,
			};
		},
		mergeState(state: StoreState<Schemas>): void {
			if (state.version !== "1.0") {
				throw new Error(`Unsupported state version: ${state.version}`);
			}

			for (const handleName of Object.keys(
				state.documents,
			) as (keyof Schemas)[]) {
				const handle = docHandles[handleName];
				const documentState = state.documents[handleName];
				if (handle && documentState) {
					handle.merge(documentState);
				}
			}

			// Forward clock based on state latest
			clock.forward(state.latest);
		},
		on(event, handler) {
			return storeEmitter.on(event, handler);
		},
	};

	return store;
}
