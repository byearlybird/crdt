import { AbortError, DisposedError } from "./errors.ts";
import type {
	DB,
	DBOptions,
	Middleware,
	MutateEvent,
	SingleMutateEvent,
	SubscribeEvent,
	Transaction,
} from "./types.ts";

function mergeDelta<T>(existing: T, delta: Partial<T> | ((prev: T) => T)): T {
	return typeof delta === "function"
		? delta(existing)
		: { ...existing, ...delta };
}

type BatchOp<T, Id extends string> =
	| { op: "insert"; id: Id; data: T }
	| { op: "update"; id: Id; data: Partial<T> | ((prev: T) => T) }
	| { op: "remove"; id: Id };

type ApplyResult<T, Id extends string> =
	| { ok: true; event: SingleMutateEvent<T, Id> }
	| { ok: false };

function applySingleOp<T, Id extends string>(
	target: Map<Id, T>,
	op: BatchOp<T, Id>,
): ApplyResult<T, Id> {
	switch (op.op) {
		case "insert": {
			if (target.has(op.id)) return { ok: false };
			target.set(op.id, op.data);
			return {
				ok: true,
				event: { op: "insert", id: op.id, record: op.data, previous: null },
			};
		}
		case "update": {
			const existing = target.get(op.id);
			if (existing === undefined) return { ok: false };
			const merged = mergeDelta(existing, op.data);
			target.set(op.id, merged);
			return {
				ok: true,
				event: { op: "update", id: op.id, record: merged, previous: existing },
			};
		}
		case "remove": {
			const existing = target.get(op.id);
			if (existing === undefined) return { ok: false };
			target.delete(op.id);
			return {
				ok: true,
				event: { op: "remove", id: op.id, record: null, previous: existing },
			};
		}
	}
}

type PendingIntentOp<T, Id extends string> =
	| BatchOp<T, Id>
	| { op: "batch"; ops: BatchOp<T, Id>[] };

type PendingIntent<T, Id extends string> = PendingIntentOp<T, Id> & {
	optimisticEvent: MutateEvent<T, Id>;
	resolve: () => void;
	reject: (reason: unknown) => void;
};

export function createDB<T, Id extends string = string>(
	opts: DBOptions<T, Id>,
): DB<T, Id> {
	const { getId, validate } = opts;
	const committed = new Map<Id, T>();
	const subscribers = new Set<(event: SubscribeEvent<T, Id>) => void>();
	const middlewares = new Set<Middleware<T, Id>>();
	const pending: PendingIntent<T, Id>[] = [];
	let cachedData: ReadonlyMap<Id, Readonly<T>> | null = null;
	let processing = false;
	let disposed = false;

	if (opts.initial) {
		for (const record of opts.initial) {
			committed.set(getId(record), record);
		}
	}

	function invalidateCache(): void {
		cachedData = null;
	}

	type BatchOpsResult =
		| { ok: false }
		| { ok: true; mutations: SingleMutateEvent<T, Id>[] };

	function applyBatchOps(
		target: Map<Id, T>,
		ops: BatchOp<T, Id>[],
	): BatchOpsResult {
		const mutations: SingleMutateEvent<T, Id>[] = [];
		for (const sub of ops) {
			const result = applySingleOp(target, sub);
			if (!result.ok) return { ok: false };
			mutations.push(result.event);
		}
		return { ok: true, mutations };
	}

	function applyIntent(
		target: Map<Id, T>,
		intent: PendingIntent<T, Id>,
	): boolean {
		if (intent.op === "batch") {
			const scratch = new Map<Id, T>(target);
			if (!applyBatchOps(scratch, intent.ops).ok) return false;
			target.clear();
			for (const [k, v] of scratch) target.set(k, v);
			return true;
		}
		return applySingleOp(target, intent).ok;
	}

	function computeData(): ReadonlyMap<Id, Readonly<T>> {
		if (cachedData !== null) return cachedData;
		const view = new Map<Id, T>(committed);
		for (const intent of pending) {
			applyIntent(view, intent);
		}
		cachedData = view;
		return cachedData;
	}

	function resolveEvent(
		intent: PendingIntent<T, Id>,
		base: Map<Id, T>,
	): MutateEvent<T, Id> {
		if (intent.op === "batch") {
			const view = new Map<Id, T>(base);
			const result = applyBatchOps(view, intent.ops);
			if (!result.ok)
				throw new Error("Invariant: batch sub-op failed during resolveEvent");
			return { op: "batch", mutations: result.mutations };
		}
		const scratch = new Map<Id, T>(base);
		const result = applySingleOp(scratch, intent);
		if (!result.ok) throw new Error("Invariant: op failed during resolveEvent");
		return result.event;
	}

	function notify(event: SubscribeEvent<T, Id>): void {
		for (const cb of subscribers) {
			try {
				cb(event);
			} catch (e) {
				console.error(e);
			}
		}
	}

	function rebaseAndCascade(): PendingIntent<T, Id>[] {
		const cascaded: PendingIntent<T, Id>[] = [];
		const view = new Map<Id, T>(committed);
		let i = 0;
		while (i < pending.length) {
			const intent = pending[i];
			if (!intent) break;
			if (applyIntent(view, intent)) {
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
				const commitEvent = resolveEvent(intent, committed);
				const snapshot = [...middlewares];
				for (const mw of snapshot) {
					if (middlewares.has(mw)) {
						await mw({
							event: commitEvent,
							abort(reason?: string) {
								throw new AbortError(reason);
							},
						});
						if (disposed) return;
					}
				}

				// Success — remove from pending, apply to committed
				pending.shift();
				applyIntent(committed, intent);
				invalidateCache();
				notify({ type: "commit", event: commitEvent });
				intent.resolve();
			} catch (error) {
				// Failure — remove from pending, rebase remaining
				pending.shift();
				const cascaded = rebaseAndCascade();
				invalidateCache();

				notify({
					type: "rollback",
					event: intent.optimisticEvent,
					reason: error,
				});
				intent.reject(error);

				for (const ci of cascaded) {
					notify({
						type: "rollback",
						event: ci.optimisticEvent,
						reason: error,
					});
					ci.reject(error);
				}
			}
		}
		processing = false;
	}

	return {
		get data(): ReadonlyMap<Id, Readonly<T>> {
			return computeData();
		},

		insert(record: T): Promise<void> {
			if (disposed) throw new DisposedError();
			const id = getId(record);
			if (computeData().has(id)) {
				throw new Error(`Record with ID "${id}" already exists`);
			}
			if (validate) validate(record);

			const optimisticEvent: SingleMutateEvent<T, Id> = {
				op: "insert",
				id,
				record,
				previous: null,
			};
			const { promise, resolve, reject } = Promise.withResolvers<void>();
			pending.push({
				op: "insert",
				id,
				data: record,
				optimisticEvent,
				resolve,
				reject,
			});
			invalidateCache();
			notify({ type: "optimistic", event: optimisticEvent });
			drainQueue();
			return promise;
		},

		update(id: Id, delta: Partial<T> | ((prev: T) => T)): Promise<void> {
			if (disposed) throw new DisposedError();
			const data = computeData();
			const existing = data.get(id);
			if (existing === undefined) {
				throw new Error(`Record with ID "${id}" does not exist`);
			}
			const merged = mergeDelta(existing, delta);
			if (validate) validate(merged);

			const optimisticEvent: SingleMutateEvent<T, Id> = {
				op: "update",
				id,
				record: merged,
				previous: existing,
			};
			const { promise, resolve, reject } = Promise.withResolvers<void>();
			pending.push({
				op: "update",
				id,
				data: delta,
				optimisticEvent,
				resolve,
				reject,
			});
			invalidateCache();
			notify({ type: "optimistic", event: optimisticEvent });
			drainQueue();
			return promise;
		},

		remove(id: Id): Promise<void> {
			if (disposed) throw new DisposedError();
			const data = computeData();
			const existing = data.get(id);
			if (existing === undefined) {
				throw new Error(`Record with ID "${id}" does not exist`);
			}

			const optimisticEvent: SingleMutateEvent<T, Id> = {
				op: "remove",
				id,
				record: null,
				previous: existing,
			};
			const { promise, resolve, reject } = Promise.withResolvers<void>();
			pending.push({ op: "remove", id, optimisticEvent, resolve, reject });
			invalidateCache();
			notify({ type: "optimistic", event: optimisticEvent });
			drainQueue();
			return promise;
		},

		batch(fn: (tx: Transaction<T, Id>) => void): Promise<void> {
			if (disposed) throw new DisposedError();
			const ops: BatchOp<T, Id>[] = [];
			const optimisticMutations: SingleMutateEvent<T, Id>[] = [];
			const view = new Map<Id, T>(computeData());

			const tx: Transaction<T, Id> = {
				insert(record: T): void {
					const id = getId(record);
					if (view.has(id)) {
						throw new Error(`Record with ID "${id}" already exists`);
					}
					if (validate) validate(record);
					optimisticMutations.push({
						op: "insert",
						id,
						record,
						previous: null,
					});
					view.set(id, record);
					ops.push({ op: "insert", id, data: record });
				},
				update(id: Id, delta: Partial<T> | ((prev: T) => T)): void {
					const existing = view.get(id);
					if (existing === undefined) {
						throw new Error(`Record with ID "${id}" does not exist`);
					}
					const merged = mergeDelta(existing, delta);
					if (validate) validate(merged);
					optimisticMutations.push({
						op: "update",
						id,
						record: merged,
						previous: existing,
					});
					view.set(id, merged);
					ops.push({ op: "update", id, data: delta });
				},
				remove(id: Id): void {
					const existing = view.get(id);
					if (existing === undefined) {
						throw new Error(`Record with ID "${id}" does not exist`);
					}
					optimisticMutations.push({
						op: "remove",
						id,
						record: null,
						previous: existing,
					});
					view.delete(id);
					ops.push({ op: "remove", id });
				},
			};

			fn(tx);

			if (ops.length === 0) {
				return Promise.resolve();
			}

			const optimisticEvent: MutateEvent<T, Id> = {
				op: "batch",
				mutations: optimisticMutations,
			};
			const { promise, resolve, reject } = Promise.withResolvers<void>();
			pending.push({ op: "batch", ops, optimisticEvent, resolve, reject });
			invalidateCache();
			notify({ type: "optimistic", event: optimisticEvent });
			drainQueue();
			return promise;
		},

		snapshot(): T[] {
			return Array.from(computeData().values());
		},

		subscribe(callback: (event: SubscribeEvent<T, Id>) => void): () => void {
			subscribers.add(callback);
			return () => subscribers.delete(callback);
		},

		use(fn: Middleware<T, Id>): () => void {
			middlewares.add(fn);
			return () => middlewares.delete(fn);
		},

		dispose(): void {
			disposed = true;
			for (const intent of pending) {
				intent.reject(new DisposedError());
			}
			pending.length = 0;
			committed.clear();
			subscribers.clear();
			middlewares.clear();
			invalidateCache();
		},
	};
}
