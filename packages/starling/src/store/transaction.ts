import type { Resource } from "../core";
import {
	createDocument,
	type Document,
	DocumentInternals,
	type DocumentWithInternals,
	type MutationBatch,
} from "./document";
import type { DocumentConfigMap } from "./store";
import type { AnyObjectSchema, SchemasMap } from "./types";

/** Transaction-safe document handle that excludes serialization */
export type TransactionDocumentHandle<T extends AnyObjectSchema> = Omit<
	Document<T>,
	"toJSON"
>;

type TransactionDocumentHandles<Schemas extends SchemasMap> = {
	[K in keyof Schemas]: TransactionDocumentHandle<Schemas[K]>;
};

/**
 * Transaction context providing access to specified documents.
 * Only documents declared in the documents array are accessible.
 */
export type TransactionContext<
	Schemas extends SchemasMap,
	Keys extends ReadonlyArray<keyof Schemas>,
> = Pick<TransactionDocumentHandles<Schemas>, Keys[number]> & {
	rollback(): void;
};

/**
 * Execute a transaction with snapshot isolation and explicit dependencies.
 *
 * @param configs - Document configurations for creating new instances
 * @param documents - Active document instances (mutable reference)
 * @param getEventstamp - Function to generate eventstamps
 * @param documentNames - Array of document names to include in transaction
 * @param callback - Transaction callback with tx context
 * @returns The return value from the callback
 *
 * @remarks
 * - Only specified documents are cloned (lazy cloning for performance)
 * - Provides snapshot isolation: tx sees consistent data from transaction start
 * - Explicit rollback via tx.rollback() or implicit on exception
 * - TypeScript enforces that only declared documents are accessible
 */
export function executeTransaction<
	Schemas extends SchemasMap,
	Keys extends ReadonlyArray<keyof Schemas>,
	R,
>(
	configs: DocumentConfigMap<Schemas>,
	documents: { [K in keyof Schemas]: DocumentWithInternals<Schemas[K]> },
	getEventstamp: () => string,
	documentNames: Keys,
	callback: (tx: TransactionContext<Schemas, Keys>) => R,
): R {
	// Clone ONLY specified documents (efficient)
	const clonedDocuments = {} as {
		[K in keyof Schemas]: DocumentWithInternals<Schemas[K]>;
	};

	for (const name of documentNames) {
		const original = documents[name];
		const config = configs[name];

		const getData = original[DocumentInternals.data] as
			| (() => Map<string, Resource<any>>)
			| undefined;
		if (!getData) continue;

		clonedDocuments[name] = createDocument(
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
		...clonedDocuments,
		rollback() {
			shouldRollback = true;
		},
	} as TransactionContext<Schemas, Keys>;

	// Execute callback
	const result = callback(tx);

	// Commit only if not rolled back
	if (!shouldRollback) {
		// Commit only the documents that were cloned
		for (const name of documentNames) {
			const original = documents[
				name
			] as DocumentWithInternals<AnyObjectSchema>;
			const cloned = clonedDocuments[
				name
			] as DocumentWithInternals<AnyObjectSchema>;

			const getPendingMutations = cloned[
				DocumentInternals.getPendingMutations
			] as (() => MutationBatch<any>) | undefined;
			const replaceData = original[DocumentInternals.replaceData] as
				| ((data: Map<string, Resource<any>>) => void)
				| undefined;
			const emitMutations = original[DocumentInternals.emitMutations] as
				| ((mutations: MutationBatch<any>) => void)
				| undefined;
			const getData = cloned[DocumentInternals.data] as
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
