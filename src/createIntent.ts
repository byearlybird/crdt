import type { CollectionState, StoreOp } from "./createMutationRuntime.ts";
import { mergeDelta, parseWithSchema } from "./helpers.ts";
import type { StoreSingleMutateEvent } from "./types.ts";

type BuildInsertOptions = {
	collectionName: string;
	state: CollectionState;
	record: unknown;
};

type BuildUpdateOptions = {
	collectionName: string;
	state: CollectionState;
	existingRecord: unknown;
	id: string;
	delta: unknown;
};

type BuildRemoveOptions = {
	collectionName: string;
	existingRecord: unknown;
	id: string;
};

type IntentBuildResult = {
	op: StoreOp;
	optimisticEvent: StoreSingleMutateEvent;
};

export function buildInsertIntent(opts: BuildInsertOptions): IntentBuildResult {
	const { collectionName, state, record } = opts;

	const parsed = state.schema ? parseWithSchema(state.schema, record) : record;
	const id = state.getId(parsed);

	const optimisticEvent: StoreSingleMutateEvent = {
		collection: collectionName,
		op: "insert",
		id,
		record: parsed,
		previous: null,
	};

	const op: StoreOp = {
		collection: collectionName,
		op: "insert",
		id,
		data: parsed,
	};

	return { op, optimisticEvent };
}

export function buildUpdateIntent(opts: BuildUpdateOptions): IntentBuildResult {
	const { collectionName, state, existingRecord, id, delta } = opts;

	const merged = mergeDelta(existingRecord, delta);
	if (state.schema) parseWithSchema(state.schema, merged);

	const optimisticEvent: StoreSingleMutateEvent = {
		collection: collectionName,
		op: "update",
		id,
		record: merged,
		previous: existingRecord,
	};

	const op: StoreOp = {
		collection: collectionName,
		op: "update",
		id,
		data: delta,
	};

	return { op, optimisticEvent };
}

export function buildRemoveIntent(opts: BuildRemoveOptions): IntentBuildResult {
	const { collectionName, existingRecord, id } = opts;

	const optimisticEvent: StoreSingleMutateEvent = {
		collection: collectionName,
		op: "remove",
		id,
		record: null,
		previous: existingRecord,
	};

	const op: StoreOp = {
		collection: collectionName,
		op: "remove",
		id,
	};

	return { op, optimisticEvent };
}
