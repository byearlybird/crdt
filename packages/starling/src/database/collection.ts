import {
	deleteResource,
	type StarlingDocument,
	makeResource,
	mapToDocument,
	mergeDocuments,
	mergeResources,
	type ResourceObject,
} from "../core";
import { createEmitter } from "./emitter";
import { type StandardSchemaV1, standardValidate } from "./standard-schema";
import type { AnyObjectSchema } from "./types";

/**
 * Symbols for internal collection methods used by transactions.
 * These are not part of the public Collection type.
 */
export const CollectionInternals = {
	getPendingMutations: Symbol("getPendingMutations"),
	emitMutations: Symbol("emitMutations"),
	replaceData: Symbol("replaceData"),
	data: Symbol("data"),
} as const;

/** Shorthand for extracting the data type from a schema */
type InferData<T extends AnyObjectSchema> = StandardSchemaV1.InferOutput<T>;

export type MutationBatch<T> = {
	added: Array<{ id: string; item: T }>;
	updated: Array<{ id: string; before: T; after: T }>;
	removed: Array<{ id: string; item: T }>;
};

export type CollectionMutationEvent<T> = MutationBatch<T>;

export type CollectionEvents<T> = {
	mutation: CollectionMutationEvent<T>;
};

export type Collection<T extends AnyObjectSchema> = {
	get(id: string, opts?: { includeDeleted?: boolean }): InferData<T> | null;
	getAll(opts?: { includeDeleted?: boolean }): InferData<T>[];
	find<U = InferData<T>>(
		filter: (item: InferData<T>) => boolean,
		opts?: {
			map?: (item: InferData<T>) => U;
			sort?: (a: U, b: U) => number;
		},
	): U[];
	add(item: StandardSchemaV1.InferInput<T>): InferData<T>;
	update(id: string, updates: Partial<StandardSchemaV1.InferInput<T>>): void;
	remove(id: string): void;
	merge(document: StarlingDocument<InferData<T>>): void;
	toDocument(): StarlingDocument<InferData<T>>;
	on(
		event: "mutation",
		handler: (payload: CollectionMutationEvent<InferData<T>>) => void,
	): () => void;
};

/** Internal type that includes Symbol-keyed methods for transaction support */
export type CollectionWithInternals<T extends AnyObjectSchema> =
	Collection<T> & {
		[CollectionInternals.data]: () => Map<string, ResourceObject<InferData<T>>>;
		[CollectionInternals.getPendingMutations]: () => CollectionMutationEvent<
			InferData<T>
		>;
		[CollectionInternals.emitMutations]: (
			mutations: CollectionMutationEvent<InferData<T>>,
		) => void;
		[CollectionInternals.replaceData]: (
			data: Map<string, ResourceObject<InferData<T>>>,
		) => void;
	};

export function createCollection<T extends AnyObjectSchema>(
	name: string,
	schema: T,
	getId: (item: InferData<T>) => string,
	getEventstamp: () => string,
	initialData?: Map<string, ResourceObject<InferData<T>>>,
	options?: { autoFlush?: boolean },
): CollectionWithInternals<T> {
	const autoFlush = options?.autoFlush ?? true;
	const data = initialData ?? new Map<string, ResourceObject<InferData<T>>>();

	const emitter = createEmitter<CollectionEvents<InferData<T>>>();

	// Pending mutations buffer
	const pendingMutations: CollectionMutationEvent<InferData<T>> = {
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

			// Clear the buffer
			pendingMutations.added = [];
			pendingMutations.updated = [];
			pendingMutations.removed = [];
		}
	};

	return {
		get(id: string, opts: { includeDeleted?: boolean } = {}) {
			const resource = data.get(id);
			if (!resource) {
				return null;
			}

			if (!opts.includeDeleted && resource.meta.deletedAt) {
				return null;
			}

			return resource.attributes;
		},

		getAll(opts: { includeDeleted?: boolean } = {}) {
			const resources = Array.from(data.values());
			if (opts.includeDeleted) {
				return resources.map((resource) => resource.attributes);
			} else {
				return resources
					.filter((resource) => !resource.meta.deletedAt)
					.map((resource) => resource.attributes);
			}
		},

		find<U = InferData<T>>(
			filter: (item: InferData<T>) => boolean,
			opts?: {
				map?: (item: InferData<T>) => U;
				sort?: (a: U, b: U) => number;
			},
		): U[] {
			const results: U[] = [];

			for (const [, resource] of data.entries()) {
				if (resource.meta.deletedAt) {
					continue;
				}

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

		add(item: StandardSchemaV1.InferInput<T>): InferData<T> {
			const validated = standardValidate(schema, item);
			const id = getId(validated);

			if (data.has(id)) {
				throw new DuplicateIdError(id);
			}

			const resource = makeResource(name, id, validated, getEventstamp());
			data.set(id, resource);

			// Buffer the add mutation
			pendingMutations.added.push({ id, item: validated });

			// Flush immediately for non-transaction operations
			if (autoFlush) {
				flushMutations();
			}

			return validated;
		},

		update(id: string, updates: Partial<StandardSchemaV1.InferInput<T>>): void {
			const existing = data.get(id);

			if (!existing) {
				throw new IdNotFoundError(id);
			}

			// Capture the before state
			const before = existing.attributes;

			const merged = mergeResources(
				existing,
				makeResource(name, id, updates, getEventstamp()),
			);

			standardValidate(schema, merged.attributes);

			data.set(id, merged);

			// Buffer the update mutation
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

			// Capture the item before deletion
			const item = existing.attributes;

			const removed = deleteResource(existing, getEventstamp());

			data.set(id, removed);

			// Buffer the remove mutation
			pendingMutations.removed.push({ id, item });

			// Flush immediately for non-transaction operations
			if (autoFlush) {
				flushMutations();
			}
		},

		merge(document: JsonDocument<InferData<T>>): void {
			// Capture before state for update/delete event tracking
			const beforeState = new Map<string, InferData<T>>();
			for (const [id, resource] of data.entries()) {
				beforeState.set(id, resource.attributes);
			}

			// Build current document from collection state
			const currentDoc = mapToDocument(data, getEventstamp());

			// Merge using core mergeDocuments
			const result = mergeDocuments(currentDoc, document);

			// Replace collection data with merged result
			data.clear();
			for (const resource of result.document.data) {
				data.set(resource.id, resource);
			}

			// Emit events for changes
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

		toDocument() {
			return mapToDocument(name, data, getEventstamp());
		},

		on(event, handler) {
			return emitter.on(event, handler);
		},

		// Symbol-keyed internal methods for transaction support
		[CollectionInternals.data]() {
			return new Map(data);
		},

		[CollectionInternals.getPendingMutations]() {
			return {
				added: [...pendingMutations.added],
				updated: [...pendingMutations.updated],
				removed: [...pendingMutations.removed],
			};
		},

		[CollectionInternals.emitMutations](
			mutations: CollectionMutationEvent<InferData<T>>,
		) {
			if (
				mutations.added.length > 0 ||
				mutations.updated.length > 0 ||
				mutations.removed.length > 0
			) {
				emitter.emit("mutation", mutations);
			}
		},

		[CollectionInternals.replaceData](
			newData: Map<string, ResourceObject<InferData<T>>>,
		) {
			data.clear();
			for (const [id, resource] of newData.entries()) {
				data.set(id, resource);
			}
		},
	};
}

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
