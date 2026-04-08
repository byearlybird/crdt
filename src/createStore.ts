import type { StandardSchemaV1 } from "@standard-schema/spec";
import { createBatchIntent } from "./createBatchIntent.ts";
import {
	buildInsertIntent,
	buildRemoveIntent,
	buildUpdateIntent,
} from "./createIntent.ts";
import {
	type CollectionState,
	createMutationRuntime,
	type MutationRuntime,
	type RuntimeIntent,
} from "./createMutationRuntime.ts";
import type {
	CollectionConfig,
	CollectionHandle,
	SchemaCollectionConfig,
	Store,
	StoreConfig,
	StoreTransaction,
} from "./types.ts";

export function collection<
	S extends StandardSchemaV1,
	Id extends string = string,
>(config: {
	schema: S;
	getId: (record: StandardSchemaV1.InferOutput<S>) => Id;
	initial?: StandardSchemaV1.InferOutput<S>[];
}): SchemaCollectionConfig<S, Id>;
export function collection<T, Id extends string = string>(config: {
	getId: (record: T) => Id;
	initial?: T[];
}): CollectionConfig<T, Id>;
export function collection(
	// biome-ignore lint/suspicious/noExplicitAny: overload implementation
	config: any,
) {
	return config;
}

function createCollections(config: StoreConfig): Map<string, CollectionState> {
	const collections = new Map<string, CollectionState>();
	for (const [name, cfg] of Object.entries(config)) {
		const schema =
			"schema" in cfg ? (cfg.schema as StandardSchemaV1) : undefined;
		const committed = new Map<string, unknown>();
		if (cfg.initial) {
			for (const record of cfg.initial) {
				committed.set(cfg.getId(record as never), record);
			}
		}
		collections.set(name, {
			committed,
			getId: cfg.getId as (record: unknown) => string,
			schema,
		});
	}
	return collections;
}

type InsertIntentOptions = {
	runtime: MutationRuntime;
	collectionName: string;
	state: CollectionState;
	record: unknown;
};

function createInsertIntent(opts: InsertIntentOptions): RuntimeIntent {
	const { runtime, collectionName, state, record } = opts;

	const { op, optimisticEvent } = buildInsertIntent({
		collectionName,
		state,
		record,
	});

	if (runtime.getCollectionData(collectionName).has(op.id)) {
		throw new Error(`Record with ID "${op.id}" already exists`);
	}

	return { kind: "single", ops: [op], optimisticEvent };
}

type UpdateIntentOptions = {
	runtime: MutationRuntime;
	collectionName: string;
	state: CollectionState;
	id: string;
	delta: unknown;
};

function createUpdateIntent(opts: UpdateIntentOptions): RuntimeIntent {
	const { runtime, collectionName, state, id, delta } = opts;

	const existing = runtime.getCollectionData(collectionName).get(id);
	if (existing === undefined) {
		throw new Error(`Record with ID "${id}" does not exist`);
	}

	const { op, optimisticEvent } = buildUpdateIntent({
		collectionName,
		state,
		existingRecord: existing,
		id,
		delta,
	});

	return { kind: "single", ops: [op], optimisticEvent };
}

type RemoveIntentOptions = {
	runtime: MutationRuntime;
	collectionName: string;
	id: string;
};

function createRemoveIntent(opts: RemoveIntentOptions): RuntimeIntent {
	const { runtime, collectionName, id } = opts;

	const existing = runtime.getCollectionData(collectionName).get(id);
	if (existing === undefined) {
		throw new Error(`Record with ID "${id}" does not exist`);
	}

	const { op, optimisticEvent } = buildRemoveIntent({
		collectionName,
		existingRecord: existing,
		id,
	});

	return { kind: "single", ops: [op], optimisticEvent };
}

function createCollectionHandle<T, Id extends string, TInput = T>(
	name: string,
	col: CollectionState,
	runtime: MutationRuntime,
): CollectionHandle<T, Id, TInput> {
	return {
		get data(): ReadonlyMap<Id, Readonly<T>> {
			return runtime.getCollectionData(name) as ReadonlyMap<Id, Readonly<T>>;
		},

		insert(record: TInput): Promise<void> {
			runtime.assertNotDisposed();
			return runtime.enqueue(
				createInsertIntent({
					runtime,
					collectionName: name,
					state: col,
					record,
				}),
			);
		},

		update(id: Id, delta: Partial<T> | ((prev: T) => T)): Promise<void> {
			runtime.assertNotDisposed();
			return runtime.enqueue(
				createUpdateIntent({
					runtime,
					collectionName: name,
					state: col,
					id,
					delta,
				}),
			);
		},

		remove(id: Id): Promise<void> {
			runtime.assertNotDisposed();
			return runtime.enqueue(
				createRemoveIntent({ runtime, collectionName: name, id }),
			);
		},

		snapshot(): T[] {
			return Array.from(runtime.getCollectionData(name).values()) as T[];
		},
	};
}

export function createStore<C extends StoreConfig>(config: C): Store<C> {
	const collections = createCollections(config);
	const runtime = createMutationRuntime(collections);

	return {
		...Object.fromEntries(
			Array.from(collections, ([name, col]) => [
				name,
				createCollectionHandle(name, col, runtime),
			]),
		),

		batch(transaction: (tx: StoreTransaction<C>) => void): Promise<void> {
			runtime.assertNotDisposed();

			const intent = createBatchIntent<C>(
				collections,
				runtime.getCollectionData,
				transaction,
			);
			if (!intent) {
				return Promise.resolve();
			}
			return runtime.enqueue(intent);
		},

		use: runtime.use,
		subscribe: runtime.subscribe,
		dispose: runtime.dispose,
	} as Store<C>;
}
