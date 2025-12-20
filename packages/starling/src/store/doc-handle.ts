import {
	type DocumentState,
	makeResource,
	mapToDocument,
	mergeDocuments,
	mergeResources,
	type Resource,
} from "../state";
import { createEmitter } from "./emitter";
import { standardValidate } from "./standard-schema";
import type { AnyObjectSchema, InferInput, InferOutput } from "./types";

/**
 * Error classes
 */
export class IdNotFoundError extends Error {
	constructor(id: string) {
		super(`Resource with id ${id} not found`);
		this.name = "IdNotFoundError";
	}
}

export class DuplicateIdError extends Error {
	constructor(id: string) {
		super(`Resource with id ${id} already exists`);
		this.name = "DuplicateIdError";
	}
}

/**
 * Symbols for internal doc handle methods used by transactions.
 * These are not part of the public DocHandle type.
 */
export const DocHandleInternals = {
	getPendingMutations: Symbol("getPendingMutations"),
	emitMutations: Symbol("emitMutations"),
	replaceData: Symbol("replaceData"),
	data: Symbol("data"),
	onMutation: Symbol("onMutation"),
} as const;

export type MutationBatch<T> = {
	added: Array<{ id: string; item: T }>;
	updated: Array<{ id: string; before: T; after: T }>;
	removed: Array<{ id: string; item: T }>;
};

export type DocHandleEvents<T> = {
	mutation: MutationBatch<T>;
};

export type DocHandle<T extends AnyObjectSchema> = {
	get(id: string): InferOutput<T> | null;
	getAll(): InferOutput<T>[];
	find<U = InferOutput<T>>(
		filter: (item: InferOutput<T>) => boolean,
		opts?: {
			map?: (item: InferOutput<T>) => U;
			sort?: (a: U, b: U) => number;
		},
	): U[];
	add(item: InferInput<T>): InferOutput<T>;
	update(id: string, updates: Partial<InferInput<T>>): void;
	remove(id: string): void;
};

/** Internal type that includes Symbol-keyed methods for transaction support */
export type DocHandleWithInternals<T extends AnyObjectSchema> = DocHandle<T> & {
	merge(state: DocumentState<InferOutput<T>>): void;
	toJSON(): DocumentState<InferOutput<T>>;
	[DocHandleInternals.data]: () => Map<string, Resource<InferOutput<T>>>;
	[DocHandleInternals.getPendingMutations]: () => MutationBatch<InferOutput<T>>;
	[DocHandleInternals.emitMutations]: (
		mutations: MutationBatch<InferOutput<T>>,
	) => void;
	[DocHandleInternals.replaceData]: (
		data: Map<string, Resource<InferOutput<T>>>,
	) => void;
	[DocHandleInternals.onMutation]: (
		handler: (batch: MutationBatch<InferOutput<T>>) => void,
	) => () => void;
};

export function createDocHandle<T extends AnyObjectSchema>(
	name: string,
	schema: T,
	getId: (item: InferOutput<T>) => string,
	getEventstamp: () => string,
	initialData?: Map<string, Resource<InferOutput<T>>>,
	options?: { autoFlush?: boolean },
): DocHandleWithInternals<T> {
	const autoFlush = options?.autoFlush ?? true;
	const data = initialData ?? new Map<string, Resource<InferOutput<T>>>();
	const tombstones = new Map<string, string>();

	const emitter = createEmitter<DocHandleEvents<InferOutput<T>>>();

	// Pending mutations buffer
	const pendingMutations: MutationBatch<InferOutput<T>> = {
		added: [],
		updated: [],
		removed: [],
	};

	const flushMutations = () => {
		if (
			pendingMutations.added.length > 0 ||
			pendingMutations.updated.length > 0 ||
			pendingMutations.removed.length > 0
		) {
			emitter.emit("mutation", {
				added: [...pendingMutations.added],
				updated: [...pendingMutations.updated],
				removed: [...pendingMutations.removed],
			});

			pendingMutations.added = [];
			pendingMutations.updated = [];
			pendingMutations.removed = [];
		}
	};

	return {
		get(id: string) {
			const resource = data.get(id);
			if (!resource) {
				return null;
			}

			return resource.attributes;
		},

		getAll() {
			const resources = Array.from(data.values());
			return resources.map((resource) => resource.attributes);
		},

		find<U = InferOutput<T>>(
			filter: (item: InferOutput<T>) => boolean,
			opts?: {
				map?: (item: InferOutput<T>) => U;
				sort?: (a: U, b: U) => number;
			},
		): U[] {
			const results: U[] = [];

			for (const [, resource] of data.entries()) {
				const attributes = resource.attributes;

				if (filter(attributes)) {
					const value = opts?.map ? opts.map(attributes) : (attributes as U);

					results.push(value);
				}
			}

			if (opts?.sort) {
				results.sort(opts.sort);
			}

			return results;
		},

		add(item: InferInput<T>): InferOutput<T> {
			const validated = standardValidate(schema, item);
			const id = getId(validated);

			if (data.has(id)) {
				throw new DuplicateIdError(id);
			}

			const resource = makeResource(id, validated, getEventstamp());
			data.set(id, resource);

			pendingMutations.added.push({ id, item: validated });

			// Flush immediately for non-transaction operations
			if (autoFlush) {
				flushMutations();
			}

			return validated;
		},

		update(id: string, updates: Partial<InferInput<T>>): void {
			const existing = data.get(id);

			if (!existing) {
				throw new IdNotFoundError(id);
			}

			const before = existing.attributes;

			const merged = mergeResources(
				existing,
				makeResource(id, updates, getEventstamp()),
			);

			standardValidate(schema, merged.attributes);

			data.set(id, merged);

			pendingMutations.updated.push({
				id,
				before,
				after: merged.attributes,
			});

			// Flush immediately for non-transaction operations
			if (autoFlush) {
				flushMutations();
			}
		},

		remove(id: string) {
			const existing = data.get(id);
			if (!existing) {
				throw new IdNotFoundError(id);
			}

			const item = existing.attributes;

			data.delete(id);

			tombstones.set(id, getEventstamp());

			pendingMutations.removed.push({ id, item });

			// Flush immediately for non-transaction operations
			if (autoFlush) {
				flushMutations();
			}
		},

		merge(state: DocumentState<InferOutput<T>>): void {
			const beforeState = new Map<string, InferOutput<T>>();
			for (const [id, resource] of data.entries()) {
				beforeState.set(id, resource.attributes);
			}

			// Build current document from state including tombstones
			const currentDoc = mapToDocument(name, data, tombstones);

			const result = mergeDocuments(currentDoc, state, getEventstamp());

			data.clear();
			for (const [id, resource] of Object.entries(result.document.resources)) {
				data.set(id, resource);
			}

			tombstones.clear();
			for (const [id, stamp] of Object.entries(result.document.tombstones)) {
				tombstones.set(id, stamp);
			}

			for (const [id, resource] of result.changes.added) {
				standardValidate(schema, resource.attributes);
				pendingMutations.added.push({ id, item: resource.attributes });
			}

			for (const [id, resource] of result.changes.updated) {
				standardValidate(schema, resource.attributes);
				// beforeState is built from data.entries(), and changes.updated only contains
				// resources that existed in data, so before is guaranteed to exist
				const before = beforeState.get(id)!;
				pendingMutations.updated.push({
					id,
					before,
					after: resource.attributes,
				});
			}

			for (const id of result.changes.deleted) {
				// beforeState is built from data.entries(), and changes.deleted only contains
				// resources that existed in data, so before is guaranteed to exist
				const before = beforeState.get(id)!;
				pendingMutations.removed.push({ id, item: before });
			}

			// Flush immediately for non-transaction operations
			if (autoFlush) {
				flushMutations();
			}
		},

		toJSON() {
			return mapToDocument(name, data, tombstones);
		},

		// Symbol-keyed internal methods for transaction support
		[DocHandleInternals.data]() {
			return new Map(data);
		},

		[DocHandleInternals.getPendingMutations]() {
			return {
				added: [...pendingMutations.added],
				updated: [...pendingMutations.updated],
				removed: [...pendingMutations.removed],
			};
		},

		[DocHandleInternals.emitMutations](
			mutations: MutationBatch<InferOutput<T>>,
		) {
			if (
				mutations.added.length > 0 ||
				mutations.updated.length > 0 ||
				mutations.removed.length > 0
			) {
				emitter.emit("mutation", mutations);
			}
		},

		[DocHandleInternals.replaceData](
			newData: Map<string, Resource<InferOutput<T>>>,
		) {
			data.clear();
			for (const [id, resource] of newData.entries()) {
				data.set(id, resource);
			}
		},

		[DocHandleInternals.onMutation](
			handler: (batch: MutationBatch<InferOutput<T>>) => void,
		) {
			return emitter.on("mutation", handler);
		},
	};
}
