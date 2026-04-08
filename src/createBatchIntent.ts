import {
	buildInsertIntent,
	buildRemoveIntent,
	buildUpdateIntent,
} from "./createIntent.ts";
import {
	type CollectionState,
	type RuntimeIntent,
	type StoreOp,
} from "./createMutationRuntime.ts";
import { mergeDelta, mustGet } from "./helpers.ts";
import type {
	StoreConfig,
	StoreSingleMutateEvent,
	StoreTransaction,
} from "./types.ts";

export function createBatchIntent<C extends StoreConfig>(
	collections: ReadonlyMap<string, CollectionState>,
	getCollectionData: (name: string) => ReadonlyMap<string, unknown>,
	transaction: (tx: StoreTransaction<C>) => void,
): RuntimeIntent | null {
	const ops: StoreOp[] = [];
	const optimisticMutations: StoreSingleMutateEvent[] = [];

	const views = new Map<string, Map<string, unknown>>();
	for (const name of collections.keys()) {
		views.set(name, new Map(getCollectionData(name)));
	}

	const tx: Record<string, unknown> = {};
	for (const [name, col] of collections) {
		tx[name] = {
			insert(record: unknown): void {
				const { op, optimisticEvent } = buildInsertIntent({
					collectionName: name,
					state: col,
					record,
				});

				const view = mustGet(views, name);
				if (view.has(op.id)) {
					throw new Error(`Record with ID "${op.id}" already exists`);
				}

				view.set(op.id, optimisticEvent.record);
				ops.push(op);
				optimisticMutations.push(optimisticEvent);
			},

			update(id: string, delta: unknown): void {
				const view = mustGet(views, name);
				const existing = view.get(id);
				if (existing === undefined) {
					throw new Error(`Record with ID "${id}" does not exist`);
				}

				const merged = mergeDelta(existing, delta);
				const { op, optimisticEvent } = buildUpdateIntent({
					collectionName: name,
					state: col,
					existingRecord: existing,
					id,
					delta,
				});

				view.set(id, merged);
				ops.push(op);
				optimisticMutations.push(optimisticEvent);
			},

			remove(id: string): void {
				const view = mustGet(views, name);
				const existing = view.get(id);
				if (existing === undefined) {
					throw new Error(`Record with ID "${id}" does not exist`);
				}

				const { op, optimisticEvent } = buildRemoveIntent({
					collectionName: name,
					existingRecord: existing,
					id,
				});

				view.delete(id);
				ops.push(op);
				optimisticMutations.push(optimisticEvent);
			},
		};
	}

	transaction(tx as StoreTransaction<C>);

	if (ops.length === 0) {
		return null;
	}

	return {
		kind: "batch",
		ops,
		optimisticEvent: {
			op: "batch",
			mutations: optimisticMutations,
		},
	};
}
