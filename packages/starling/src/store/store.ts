import { createClock } from "../clock";
import type { AnyObject, DocumentState } from "../state";
import {
	createDocument,
	type Document,
	DocumentInternals,
	type DocumentWithInternals,
	type MutationBatch,
} from "./document";
import { createEmitter } from "./emitter";
import { executeQuery, type QueryContext } from "./query";
import { executeTransaction, type TransactionContext } from "./transaction";
import type {
	AnyObjectSchema,
	InferOutput,
	SchemasMap,
	StoreState,
} from "./types";

export type Documents<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: Document<Schemas[K]>;
};

export type DocumentConfigMap<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: DocumentConfig<Schemas[K]>;
};

type DocumentInstances<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: DocumentWithInternals<Schemas[K]>;
};

export type DocumentMutation<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: {
		document: K;
	} & MutationBatch<InferOutput<Schemas[K]>>;
}[keyof Schemas];

export type StoreEvents<Schemas extends SchemasMap> = {
	mutation: DocumentMutation<Schemas>;
};

export type DocumentConfig<T extends AnyObjectSchema> = {
	schema: T;
	getId: (item: InferOutput<T>) => string;
};

export type StoreConfig<Schemas extends SchemasMap> = {
	name: string;
	schema: DocumentConfigMap<Schemas>;
	version?: number;
};

export type Store<Schemas extends SchemasMap> = Documents<Schemas> & {
	name: string;
	version: number;
	transact<Keys extends ReadonlyArray<keyof Schemas>, R>(
		documents: Keys,
		callback: (tx: TransactionContext<Schemas, Keys>) => R,
	): R;
	query<Keys extends ReadonlyArray<keyof Schemas>, R>(
		documents: Keys,
		callback: (q: QueryContext<Schemas, Keys>) => R,
	): R;
	toJSON(): StoreState<Schemas>;
	mergeState(state: StoreState<Schemas>): void;
	on(
		event: "mutation",
		handler: (payload: DocumentMutation<Schemas>) => unknown,
	): () => void;
	documentKeys(): (keyof Schemas)[];
};

/**
 * Create a typed store instance with document access.
 * @param config - Store configuration
 * @param config.name - Store name used for persistence and routing
 * @param config.schema - Document schema definitions
 * @param config.version - Optional store version, defaults to 1
 * @returns A store instance with typed document properties
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
	const documents = makeDocuments(schema, getEventstamp);

	// Cast to public Document type (hides Symbol-keyed internals)
	const publicDocuments = documents as unknown as Documents<Schemas>;

	// Store-level emitter
	const storeEmitter = createEmitter<StoreEvents<Schemas>>();

	// Subscribe to all document events and re-emit at store level
	for (const documentName of Object.keys(documents) as (keyof Schemas)[]) {
		const document = documents[documentName];

		// Type assertion needed for Symbol-keyed method access
		const docWithInternals =
			document as unknown as DocumentWithInternals<AnyObjectSchema>;
		const onMutationMethod:
			| ((handler: (batch: MutationBatch<AnyObject>) => void) => () => void)
			| undefined = docWithInternals[DocumentInternals.onMutation] as any;

		if (onMutationMethod) {
			onMutationMethod((mutations) => {
				// Only emit if there were actual changes
				if (
					mutations.added.length > 0 ||
					mutations.updated.length > 0 ||
					mutations.removed.length > 0
				) {
					storeEmitter.emit("mutation", {
						document: documentName,
						added: mutations.added,
						updated: mutations.updated,
						removed: mutations.removed,
					} as DocumentMutation<Schemas>);
				}
			});
		}
	}

	const store: Store<Schemas> = {
		...publicDocuments,
		name,
		version,
		transact<Keys extends ReadonlyArray<keyof Schemas>, R>(
			documentNames: Keys,
			callback: (tx: TransactionContext<Schemas, Keys>) => R,
		): R {
			return executeTransaction(
				schema,
				documents,
				getEventstamp,
				documentNames,
				callback,
			);
		},
		query<Keys extends ReadonlyArray<keyof Schemas>, R>(
			documentNames: Keys,
			callback: (q: QueryContext<Schemas, Keys>) => R,
		): R {
			return executeQuery(documents, documentNames, callback);
		},
		toJSON(): StoreState<Schemas> {
			const documentStates = {} as {
				[K in keyof Schemas]: DocumentState<InferOutput<Schemas[K]>>;
			};

			for (const documentName of Object.keys(documents) as (keyof Schemas)[]) {
				documentStates[documentName] = documents[documentName].toJSON();
			}

			// Use current clock value as latest
			const latest = clock.latest();

			return {
				version: "1.0",
				name,
				latest,
				documents: documentStates,
			};
		},
		mergeState(state: StoreState<Schemas>): void {
			// Validate version compatibility
			if (state.version !== "1.0") {
				throw new Error(`Unsupported state version: ${state.version}`);
			}

			// Merge each document
			for (const documentName of Object.keys(
				state.documents,
			) as (keyof Schemas)[]) {
				const document = documents[documentName];
				const documentState = state.documents[documentName];
				if (document && documentState) {
					document.merge(documentState);
				}
			}

			// Forward clock based on state latest
			clock.forward(state.latest);
		},
		on(event, handler) {
			return storeEmitter.on(event, handler);
		},
		documentKeys() {
			return Object.keys(documents) as (keyof Schemas)[];
		},
	};

	return store;
}

function makeDocuments<Schemas extends SchemasMap>(
	configs: DocumentConfigMap<Schemas>,
	getEventstamp: () => string,
): DocumentInstances<Schemas> {
	const documents = {} as DocumentInstances<Schemas>;

	for (const name of Object.keys(configs) as (keyof Schemas)[]) {
		const config = configs[name];
		documents[name] = createDocument(
			name as string,
			config.schema,
			config.getId,
			getEventstamp,
		);
	}

	return documents;
}
