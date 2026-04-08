import type { StandardSchemaV1 } from "@standard-schema/spec";

export type { StandardSchemaV1 };

// --- Collection config ---

declare const _collectionBrand: unique symbol;

export type CollectionConfig<T, Id extends string = string> = {
	readonly [_collectionBrand]: true;
	readonly getId: (record: T) => Id;
	readonly initial?: T[];
};

export type SchemaCollectionConfig<
	S extends StandardSchemaV1,
	Id extends string = string,
> = {
	readonly [_collectionBrand]: true;
	readonly schema: S;
	readonly getId: (record: StandardSchemaV1.InferOutput<S>) => Id;
	readonly initial?: StandardSchemaV1.InferOutput<S>[];
};

export type StoreConfig = {
	// biome-ignore lint/suspicious/noExplicitAny: index signature requires any for contravariant T slot
	[name: string]: CollectionConfig<any, any> | SchemaCollectionConfig<any, any>;
};

// --- Type inference ---

export type InferRecord<C> =
	C extends SchemaCollectionConfig<infer S, infer _>
		? StandardSchemaV1.InferOutput<S>
		: C extends CollectionConfig<infer T, infer _>
			? T
			: never;

export type InferId<C> =
	C extends SchemaCollectionConfig<infer _, infer Id>
		? Id
		: C extends CollectionConfig<infer _, infer Id>
			? Id
			: string;

// --- Collection handle ---

export type CollectionHandle<T, Id extends string = string> = {
	readonly data: ReadonlyMap<Id, Readonly<T>>;
	insert(record: T): Promise<void>;
	update(id: Id, delta: Partial<T> | ((prev: T) => T)): Promise<void>;
	remove(id: Id): Promise<void>;
	snapshot(): T[];
};

// --- Transaction ---

export type CollectionTransaction<T, Id extends string = string> = {
	insert(record: T): void;
	update(id: Id, delta: Partial<T> | ((prev: T) => T)): void;
	remove(id: Id): void;
};

export type StoreTransaction<C extends StoreConfig> = {
	[K in keyof C]: CollectionTransaction<InferRecord<C[K]>, InferId<C[K]>>;
};

// --- Events ---

export type StoreSingleMutateEvent =
	| {
			readonly collection: string;
			readonly op: "insert";
			readonly id: string;
			readonly record: unknown;
			readonly previous: null;
	  }
	| {
			readonly collection: string;
			readonly op: "update";
			readonly id: string;
			readonly record: unknown;
			readonly previous: unknown;
	  }
	| {
			readonly collection: string;
			readonly op: "remove";
			readonly id: string;
			readonly record: null;
			readonly previous: unknown;
	  };

export type StoreMutateEvent =
	| StoreSingleMutateEvent
	| {
			readonly op: "batch";
			readonly mutations: ReadonlyArray<StoreSingleMutateEvent>;
	  };

export type StoreSubscribeEvent =
	| { readonly type: "optimistic"; readonly event: StoreMutateEvent }
	| { readonly type: "commit"; readonly event: StoreMutateEvent }
	| {
			readonly type: "rollback";
			readonly event: StoreMutateEvent;
			readonly reason: unknown;
	  };

// --- Middleware ---

export type StoreMutateContext = {
	readonly event: StoreMutateEvent;
	readonly abort: (reason?: string) => void;
};

export type StoreMiddleware = (ctx: StoreMutateContext) => void | Promise<void>;

// --- Store ---

export type Store<C extends StoreConfig> = {
	[K in keyof C]: CollectionHandle<InferRecord<C[K]>, InferId<C[K]>>;
} & {
	batch(transaction: (tx: StoreTransaction<C>) => void): Promise<void>;
	use(middleware: StoreMiddleware): () => void;
	subscribe(callback: (event: StoreSubscribeEvent) => void): () => void;
	dispose(): void;
};
