import type { StandardSchemaV1 } from "@standard-schema/spec";
import { AbortError, DisposedError, SchemaError } from "./errors.ts";
import type {
	CollectionConfig,
	CollectionHandle,
	SchemaCollectionConfig,
	Store,
	StoreConfig,
	StoreMiddleware,
	StoreMutateEvent,
	StoreSingleMutateEvent,
	StoreSubscribeEvent,
} from "./types.ts";

// --- Collection helper ---

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

// --- Internal types ---

type StoreOp = {
	collection: string;
	op: "insert" | "update" | "remove";
	id: string;
	// biome-ignore lint/suspicious/noExplicitAny: internal type-erased operations
	data?: any;
};

type StorePendingIntent = {
	isBatch: boolean;
	ops: StoreOp[];
	optimisticEvent: StoreMutateEvent;
	resolve: () => void;
	reject: (reason: unknown) => void;
};

type CollectionState = {
	committed: Map<string, unknown>;
	getId: (record: unknown) => string;
	schema?: StandardSchemaV1;
};

// --- Helpers ---

// biome-ignore lint/suspicious/noExplicitAny: delta can be partial or updater
function mergeDelta(existing: unknown, delta: any): unknown {
	return typeof delta === "function"
		? delta(existing)
		: { ...(existing as object), ...delta };
}

function validateWithSchema(schema: StandardSchemaV1, record: unknown): void {
	const result = schema["~standard"].validate(record);
	if (result instanceof Promise) {
		throw new TypeError(
			"Async schema validation is not supported. Use middleware for async validation.",
		);
	}
	if (result.issues) {
		throw new SchemaError(result.issues);
	}
}

function mustGet<K, V>(map: ReadonlyMap<K, V>, key: K): V {
	const value = map.get(key);
	if (value === undefined)
		throw new Error(`Invariant: missing key ${String(key)}`);
	return value;
}

// Apply a single op to a map. Returns the event on success, null on failure.
function applySingleOp(
	target: Map<string, unknown>,
	op: StoreOp,
): StoreSingleMutateEvent | null {
	switch (op.op) {
		case "insert": {
			if (target.has(op.id)) return null;
			target.set(op.id, op.data);
			return {
				collection: op.collection,
				op: "insert",
				id: op.id,
				record: op.data,
				previous: null,
			};
		}
		case "update": {
			const existing = target.get(op.id);
			if (existing === undefined) return null;
			const merged = mergeDelta(existing, op.data);
			target.set(op.id, merged);
			return {
				collection: op.collection,
				op: "update",
				id: op.id,
				record: merged,
				previous: existing,
			};
		}
		case "remove": {
			const existing = target.get(op.id);
			if (existing === undefined) return null;
			target.delete(op.id);
			return {
				collection: op.collection,
				op: "remove",
				id: op.id,
				record: null,
				previous: existing,
			};
		}
	}
}

// Apply an intent's ops to view maps (used in rebase). Returns true on success.
// On success, mutates the view maps. On failure, view maps may be partially mutated
// but rebase rebuilds from committed anyway so this is safe.
function applyIntentToViews(
	viewMaps: Map<string, Map<string, unknown>>,
	ops: StoreOp[],
): boolean {
	if (ops.length === 1) {
		const op = ops[0];
		if (!op) return false;
		const view = viewMaps.get(op.collection);
		if (!view) return false;
		return applySingleOp(view, op) !== null;
	}
	// Multi-op batch: use scratch copies for atomicity
	const affected = [...new Set(ops.map((op) => op.collection))];
	const scratch = new Map<string, Map<string, unknown>>();
	for (const name of affected) {
		const view = viewMaps.get(name);
		if (!view) return false;
		scratch.set(name, new Map(view));
	}
	for (const op of ops) {
		const target = mustGet(scratch, op.collection);
		if (!applySingleOp(target, op)) return false;
	}
	// All succeeded — update view maps
	for (const [key, value] of scratch) {
		const view = mustGet(viewMaps, key);
		view.clear();
		for (const [entryKey, entryValue] of value) view.set(entryKey, entryValue);
	}
	return true;
}

export function createStore<C extends StoreConfig>(config: C): Store<C> {
	// --- Per-collection state ---
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
			getId: cfg.getId as (r: unknown) => string,
			schema,
		});
	}

	// --- Shared state ---
	const pending: StorePendingIntent[] = [];
	const subscribers = new Set<(event: StoreSubscribeEvent) => void>();
	const middlewares = new Set<StoreMiddleware>();
	const cachedData = new Map<string, ReadonlyMap<string, unknown>>();
	let processing = false;
	let disposed = false;

	function invalidateCache(): void {
		cachedData.clear();
	}

	function enqueueMutation(
		ops: StoreOp[],
		optimisticEvent: StoreMutateEvent,
	): Promise<void> {
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		pending.push({ isBatch: false, ops, optimisticEvent, resolve, reject });
		invalidateCache();
		notify({ type: "optimistic", event: optimisticEvent });
		drainQueue();
		return promise;
	}

	function computeAllViews(): void {
		const viewMaps = new Map<string, Map<string, unknown>>();
		for (const [colName, col] of collections) {
			viewMaps.set(colName, new Map(col.committed));
		}
		for (const intent of pending) {
			applyIntentToViews(viewMaps, intent.ops); // atomic: scratch-copy for multi-op
		}
		for (const [colName, view] of viewMaps) {
			cachedData.set(colName, view);
		}
	}

	function computeCollectionData(name: string): ReadonlyMap<string, unknown> {
		if (!cachedData.has(name)) computeAllViews();
		return mustGet(cachedData, name);
	}

	function notify(event: StoreSubscribeEvent): void {
		for (const cb of subscribers) {
			try {
				cb(event);
			} catch (error) {
				console.error(error);
			}
		}
	}

	function resolveEvent(intent: StorePendingIntent): StoreMutateEvent {
		if (!intent.isBatch && intent.ops.length === 1) {
			const op = intent.ops[0];
			if (!op) throw new Error("Invariant: empty ops in resolveEvent");
			const col = mustGet(collections, op.collection);
			const scratch = new Map(col.committed);
			const event = applySingleOp(scratch, op);
			if (!event) throw new Error("Invariant: op failed during resolveEvent");
			return event;
		}
		// Batch
		const scratchMaps = new Map<string, Map<string, unknown>>();
		const mutations: StoreSingleMutateEvent[] = [];
		for (const op of intent.ops) {
			if (!scratchMaps.has(op.collection)) {
				const col = mustGet(collections, op.collection);
				scratchMaps.set(op.collection, new Map(col.committed));
			}
			const scratch = mustGet(scratchMaps, op.collection);
			const event = applySingleOp(scratch, op);
			if (!event)
				throw new Error("Invariant: batch op failed during resolveEvent");
			mutations.push(event);
		}
		return { op: "batch", mutations };
	}

	function applyIntentToCommitted(intent: StorePendingIntent): void {
		for (const op of intent.ops) {
			const col = mustGet(collections, op.collection);
			switch (op.op) {
				case "insert":
					col.committed.set(op.id, op.data);
					break;
				case "update": {
					const existing = mustGet(col.committed, op.id);
					col.committed.set(op.id, mergeDelta(existing, op.data));
					break;
				}
				case "remove":
					col.committed.delete(op.id);
					break;
			}
		}
	}

	function rebaseAndCascade(): StorePendingIntent[] {
		const cascaded: StorePendingIntent[] = [];
		// Build view maps from all committed maps
		const viewMaps = new Map<string, Map<string, unknown>>();
		for (const [name, col] of collections) {
			viewMaps.set(name, new Map(col.committed));
		}
		let i = 0;
		while (i < pending.length) {
			const intent = pending[i];
			if (!intent) break;
			if (applyIntentToViews(viewMaps, intent.ops)) {
				i++;
			} else {
				cascaded.push(intent);
				pending.splice(i, 1);
			}
		}
		return cascaded;
	}

	function drainQueue(): void {
		if (processing) return;
		processing = true;
		processNext();
	}

	async function processNext(): Promise<void> {
		while (pending.length > 0) {
			const intent = pending[0];
			if (!intent) break;

			try {
				const commitEvent = resolveEvent(intent);
				const snapshot = [...middlewares];
				for (const middleware of snapshot) {
					if (middlewares.has(middleware)) {
						await middleware({
							event: commitEvent,
							abort(reason?: string) {
								throw new AbortError(reason);
							},
						});
						if (disposed) return;
					}
				}

				// Success — commit
				pending.shift();
				applyIntentToCommitted(intent);
				invalidateCache();
				notify({ type: "commit", event: commitEvent });
				intent.resolve();
			} catch (error) {
				// Failure — rebase remaining
				pending.shift();
				const cascaded = rebaseAndCascade();
				invalidateCache();

				notify({
					type: "rollback",
					event: intent.optimisticEvent,
					reason: error,
				});
				intent.reject(error);

				for (const cascadedIntent of cascaded) {
					notify({
						type: "rollback",
						event: cascadedIntent.optimisticEvent,
						reason: error,
					});
					cascadedIntent.reject(error);
				}
			}
		}
		processing = false;
	}

	// --- Collection handle factory ---

	function createCollectionHandle<T, Id extends string>(
		name: string,
	): CollectionHandle<T, Id> {
		const col = mustGet(collections, name);

		return {
			get data(): ReadonlyMap<Id, Readonly<T>> {
				return computeCollectionData(name) as ReadonlyMap<Id, Readonly<T>>;
			},

			insert(record: T): Promise<void> {
				if (disposed) throw new DisposedError();
				const id = col.getId(record);
				if (computeCollectionData(name).has(id)) {
					throw new Error(`Record with ID "${id}" already exists`);
				}
				if (col.schema) validateWithSchema(col.schema, record);

				const optimisticEvent: StoreSingleMutateEvent = {
					collection: name,
					op: "insert",
					id,
					record,
					previous: null,
				};
				return enqueueMutation(
					[{ collection: name, op: "insert", id, data: record }],
					optimisticEvent,
				);
			},

			update(id: Id, delta: Partial<T> | ((prev: T) => T)): Promise<void> {
				if (disposed) throw new DisposedError();
				const existing = computeCollectionData(name).get(id) as T | undefined;
				if (existing === undefined) {
					throw new Error(`Record with ID "${id}" does not exist`);
				}
				const merged = mergeDelta(existing, delta) as T;
				if (col.schema) validateWithSchema(col.schema, merged);

				const optimisticEvent: StoreSingleMutateEvent = {
					collection: name,
					op: "update",
					id,
					record: merged,
					previous: existing,
				};
				return enqueueMutation(
					[{ collection: name, op: "update", id, data: delta }],
					optimisticEvent,
				);
			},

			remove(id: Id): Promise<void> {
				if (disposed) throw new DisposedError();
				const existing = computeCollectionData(name).get(id);
				if (existing === undefined) {
					throw new Error(`Record with ID "${id}" does not exist`);
				}

				const optimisticEvent: StoreSingleMutateEvent = {
					collection: name,
					op: "remove",
					id,
					record: null,
					previous: existing,
				};
				return enqueueMutation(
					[{ collection: name, op: "remove", id }],
					optimisticEvent,
				);
			},

			snapshot(): T[] {
				return Array.from(computeCollectionData(name).values()) as T[];
			},
		};
	}

	// --- Store object ---

	return {
		...Object.fromEntries(
			Object.keys(config).map((name) => [name, createCollectionHandle(name)]),
		),

		batch(transaction: (tx: Record<string, unknown>) => void): Promise<void> {
			if (disposed) throw new DisposedError();

			const ops: StoreOp[] = [];
			const optimisticMutations: StoreSingleMutateEvent[] = [];

			// Build per-collection views (include current optimistic state)
			const views = new Map<string, Map<string, unknown>>();
			for (const name of collections.keys()) {
				views.set(name, new Map(computeCollectionData(name)));
			}

			// Build transaction proxy
			const tx: Record<string, unknown> = {};
			for (const [name, col] of collections) {
				tx[name] = {
					insert(record: unknown): void {
						const id = col.getId(record);
						const view = mustGet(views, name);
						if (view.has(id)) {
							throw new Error(`Record with ID "${id}" already exists`);
						}
						if (col.schema) validateWithSchema(col.schema, record);
						view.set(id, record);
						ops.push({ collection: name, op: "insert", id, data: record });
						optimisticMutations.push({
							collection: name,
							op: "insert",
							id,
							record,
							previous: null,
						});
					},
					update(id: string, delta: unknown): void {
						const view = mustGet(views, name);
						const existing = view.get(id);
						if (existing === undefined) {
							throw new Error(`Record with ID "${id}" does not exist`);
						}
						const merged = mergeDelta(existing, delta);
						if (col.schema) validateWithSchema(col.schema, merged);
						view.set(id, merged);
						ops.push({ collection: name, op: "update", id, data: delta });
						optimisticMutations.push({
							collection: name,
							op: "update",
							id,
							record: merged,
							previous: existing,
						});
					},
					remove(id: string): void {
						const view = mustGet(views, name);
						const existing = view.get(id);
						if (existing === undefined) {
							throw new Error(`Record with ID "${id}" does not exist`);
						}
						view.delete(id);
						ops.push({ collection: name, op: "remove", id });
						optimisticMutations.push({
							collection: name,
							op: "remove",
							id,
							record: null,
							previous: existing,
						});
					},
				};
			}

			transaction(tx);

			if (ops.length === 0) {
				return Promise.resolve();
			}

			const optimisticEvent: StoreMutateEvent = {
				op: "batch",
				mutations: optimisticMutations,
			};
			const { promise, resolve, reject } = Promise.withResolvers<void>();
			pending.push({ isBatch: true, ops, optimisticEvent, resolve, reject });
			invalidateCache();
			notify({ type: "optimistic", event: optimisticEvent });
			drainQueue();
			return promise;
		},

		use(middleware: StoreMiddleware): () => void {
			middlewares.add(middleware);
			return () => middlewares.delete(middleware);
		},

		subscribe(callback: (event: StoreSubscribeEvent) => void): () => void {
			subscribers.add(callback);
			return () => subscribers.delete(callback);
		},

		dispose(): void {
			disposed = true;
			for (const intent of pending) {
				intent.reject(new DisposedError());
			}
			pending.length = 0;
			for (const col of collections.values()) {
				col.committed.clear();
			}
			subscribers.clear();
			middlewares.clear();
			invalidateCache();
		},
	} as Store<C>;
}
