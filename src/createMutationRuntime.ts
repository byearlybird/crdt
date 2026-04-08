import type { StandardSchemaV1 } from "@standard-schema/spec";
import { AbortError, DisposedError } from "./errors.ts";
import { mergeDelta, mustGet } from "./helpers.ts";
import type {
	StoreMiddleware,
	StoreMutateEvent,
	StoreSingleMutateEvent,
	StoreSubscribeEvent,
} from "./types.ts";

export type StoreOp = {
	collection: string;
	op: "insert" | "update" | "remove";
	id: string;
	data?: unknown;
};

export type CollectionState = {
	committed: Map<string, unknown>;
	getId: (record: unknown) => string;
	schema?: StandardSchemaV1;
};

export type RuntimeIntent = {
	kind: "single" | "batch";
	ops: StoreOp[];
	optimisticEvent: StoreMutateEvent;
};

type PendingIntent = RuntimeIntent & {
	resolve: () => void;
	reject: (reason: unknown) => void;
};

export type MutationRuntime = {
	getCollectionData(name: string): ReadonlyMap<string, unknown>;
	enqueue(intent: RuntimeIntent): Promise<void>;
	use(middleware: StoreMiddleware): () => void;
	subscribe(callback: (event: StoreSubscribeEvent) => void): () => void;
	dispose(): void;
	assertNotDisposed(): void;
};

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
	for (const [key, value] of scratch) {
		const view = mustGet(viewMaps, key);
		view.clear();
		for (const [entryKey, entryValue] of value) view.set(entryKey, entryValue);
	}
	return true;
}

export function createMutationRuntime(
	collections: ReadonlyMap<string, CollectionState>,
): MutationRuntime {
	const pending: PendingIntent[] = [];
	const subscribers = new Set<(event: StoreSubscribeEvent) => void>();
	const middlewares = new Set<StoreMiddleware>();
	const cachedData = new Map<string, ReadonlyMap<string, unknown>>();
	let processing = false;
	let disposed = false;

	function invalidateCache(): void {
		cachedData.clear();
	}

	function computeAllViews(): void {
		const viewMaps = new Map<string, Map<string, unknown>>();
		for (const [colName, col] of collections) {
			viewMaps.set(colName, new Map(col.committed));
		}
		for (const intent of pending) {
			applyIntentToViews(viewMaps, intent.ops);
		}
		for (const [colName, view] of viewMaps) {
			cachedData.set(colName, view);
		}
	}

	function getCollectionData(name: string): ReadonlyMap<string, unknown> {
		if (!cachedData.has(name)) computeAllViews();
		return mustGet(cachedData, name);
	}

	function notify(event: StoreSubscribeEvent): void {
		for (const callback of subscribers) {
			try {
				callback(event);
			} catch (error) {
				console.error(error);
			}
		}
	}

	function resolveEvent(intent: PendingIntent): StoreMutateEvent {
		if (intent.kind === "single" && intent.ops.length === 1) {
			const op = intent.ops[0];
			if (!op) throw new Error("Invariant: empty ops in resolveEvent");
			const col = mustGet(collections, op.collection);
			const scratch = new Map(col.committed);
			const event = applySingleOp(scratch, op);
			if (!event) throw new Error("Invariant: op failed during resolveEvent");
			return event;
		}

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

	function applyIntentToCommitted(intent: PendingIntent): void {
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

	function rebaseAndCascade(): PendingIntent[] {
		const cascaded: PendingIntent[] = [];
		const viewMaps = new Map<string, Map<string, unknown>>();
		for (const [name, col] of collections) {
			viewMaps.set(name, new Map(col.committed));
		}
		let index = 0;
		while (index < pending.length) {
			const intent = pending[index];
			if (!intent) break;
			if (applyIntentToViews(viewMaps, intent.ops)) {
				index++;
			} else {
				cascaded.push(intent);
				pending.splice(index, 1);
			}
		}
		return cascaded;
	}

	function drainQueue(): void {
		if (processing) return;
		processing = true;
		void processNext();
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

				pending.shift();
				applyIntentToCommitted(intent);
				invalidateCache();
				notify({ type: "commit", event: commitEvent });
				intent.resolve();
			} catch (error) {
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

	function enqueue(intent: RuntimeIntent): Promise<void> {
		const { promise, resolve, reject } = Promise.withResolvers<void>();
		pending.push({ ...intent, resolve, reject });
		invalidateCache();
		notify({ type: "optimistic", event: intent.optimisticEvent });
		drainQueue();
		return promise;
	}

	function use(middleware: StoreMiddleware): () => void {
		middlewares.add(middleware);
		return () => middlewares.delete(middleware);
	}

	function subscribe(
		callback: (event: StoreSubscribeEvent) => void,
	): () => void {
		subscribers.add(callback);
		return () => subscribers.delete(callback);
	}

	function dispose(): void {
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
	}

	function assertNotDisposed(): void {
		if (disposed) throw new DisposedError();
	}

	return {
		getCollectionData,
		enqueue,
		use,
		subscribe,
		dispose,
		assertNotDisposed,
	};
}
