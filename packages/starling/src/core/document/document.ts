import { mergeResources, type ResourceObject } from "./resource";

/**
 * Base constraint for all document data in Starling.
 * Documents must be plain JavaScript objects with string keys.
 */
export type AnyObject = Record<string, unknown>;

/**
 * A Starling document represents the complete state of a collection:
 * - Resource type identifier
 * - Latest eventstamp for clock synchronization
 * - Map of resources keyed by ID
 *
 * Documents are the unit of synchronization between replicas.
 */
export type StarlingDocument<T extends AnyObject> = {
	/** Resource type for this homogeneous collection */
	type: string;

	/** Latest eventstamp observed by this document for clock synchronization */
	latest: string;

	/** Map of resources keyed by ID for efficient lookups */
	resources: Record<string, ResourceObject<T>>;
};

/**
 * Type helper for StarlingDocument with any object-like structure.
 * Preserves type inference when a specific type is provided.
 *
 * @example
 * ```typescript
 * // Use without type argument as a catch-all
 * function processDocument(doc: AnyStarlingDocument) { ... }
 *
 * // Use with type argument to preserve specific types
 * function processTypedDocument<T extends AnyObject>(doc: AnyStarlingDocument<T>) { ... }
 * ```
 */
export type AnyStarlingDocument<T extends AnyObject = AnyObject> =
	StarlingDocument<T>;

/**
 * Change tracking information returned by mergeDocuments.
 * Categorizes resources by mutation type for hook notifications.
 */
export type DocumentChanges<T extends AnyObject> = {
	/** Resources that were newly added (didn't exist before or were previously deleted) */
	added: Map<string, ResourceObject<T>>;

	/** Resources that were modified (existed before and changed) */
	updated: Map<string, ResourceObject<T>>;

	/** Resources that were deleted (newly marked with deletedAt) */
	deleted: Set<string>;
};

/**
 * Result of merging two Starling documents.
 */
export type MergeDocumentsResult<T extends AnyObject> = {
	/** The merged document with updated resources and forwarded clock */
	document: StarlingDocument<T>;

	/** Change tracking for plugin hook notifications */
	changes: DocumentChanges<T>;
};

/**
 * Merges two Starling documents using field-level Last-Write-Wins semantics.
 *
 * The merge operation:
 * 1. Forwards the clock to the newest eventstamp from either document
 * 2. Merges each resource pair using field-level LWW (via mergeResources)
 * 3. Tracks what changed for hook notifications (added/updated/deleted)
 *
 * Deletion is final: once a resource is deleted, updates to it are merged into
 * the resource's attributes but don't restore visibility. Only new resources or
 * transitions into the deleted state are tracked.
 *
 * @param into - The base document to merge into
 * @param from - The source document to merge from
 * @returns Merged document and categorized changes
 *
 * @example
 * ```typescript
 * const into = {
 *   type: "items",
 *   latest: "2025-01-01T00:00:00.000Z|0001|a1b2",
 *   resources: { "doc1": { id: "doc1", attributes: {...}, meta: {...} } }
 * };
 *
 * const from = {
 *   type: "items",
 *   latest: "2025-01-01T00:05:00.000Z|0001|c3d4",
 *   resources: {
 *     "doc1": { id: "doc1", attributes: {...}, meta: {...} }, // updated
 *     "doc2": { id: "doc2", attributes: {...}, meta: {...} }  // new
 *   }
 * };
 *
 * const result = mergeDocuments(into, from);
 * // result.document.latest === "2025-01-01T00:05:00.000Z|0001|c3d4"
 * // result.changes.added has "doc2"
 * // result.changes.updated has "doc1"
 * ```
 */
export function mergeDocuments<T extends AnyObject>(
	into: StarlingDocument<T>,
	from: StarlingDocument<T>,
): MergeDocumentsResult<T> {
	// Track changes for hook notifications
	const added = new Map<string, ResourceObject<T>>();
	const updated = new Map<string, ResourceObject<T>>();
	const deleted = new Set<string>();

	// Start with base resources
	const mergedResources: Record<string, ResourceObject<T>> = {
		...into.resources,
	};
	let newestEventstamp = into.latest >= from.latest ? into.latest : from.latest;

	// Process each source resource
	for (const [id, fromDoc] of Object.entries(from.resources)) {
		const intoDoc = into.resources[id];

		if (!intoDoc) {
			// New resource from source - store it and track if not deleted
			mergedResources[id] = fromDoc;
			if (!fromDoc.meta.deletedAt) {
				added.set(id, fromDoc);
			}
			if (fromDoc.meta.latest > newestEventstamp) {
				newestEventstamp = fromDoc.meta.latest;
			}
		} else {
			// Skip merge if resources are identical (same reference)
			if (intoDoc === fromDoc) {
				continue;
			}

			// Merge existing resource using field-level LWW
			const mergedDoc = mergeResources(intoDoc, fromDoc);
			mergedResources[id] = mergedDoc;
			if (mergedDoc.meta.latest > newestEventstamp) {
				newestEventstamp = mergedDoc.meta.latest;
			}

			// Track state transitions for hook notifications
			const wasDeleted = intoDoc.meta.deletedAt !== null;
			const isDeleted = mergedDoc.meta.deletedAt !== null;

			// Only track transitions: new deletion or non-deleted update
			if (!wasDeleted && isDeleted) {
				// Transitioned to deleted
				deleted.add(id);
			} else if (!isDeleted) {
				// Not deleted, so this is an update (but only if eventstamps differ)
				// Compare meta.latest to avoid false positives when content is identical
				if (intoDoc.meta.latest !== mergedDoc.meta.latest) {
					updated.set(id, mergedDoc);
				}
			}
			// If wasDeleted && isDeleted, resource stays deleted - no change tracking
		}
	}

	return {
		document: {
			type: into.type,
			latest: newestEventstamp,
			resources: mergedResources,
		},
		changes: {
			added,
			updated,
			deleted,
		},
	};
}

/**
 * Creates an empty Starling document with the given type and eventstamp.
 * Useful for initializing new stores or testing.
 *
 * @param type - Resource type identifier for this collection
 * @param eventstamp - Initial clock value for this document
 * @returns Empty document
 *
 * @example
 * ```typescript
 * const empty = makeDocument("tasks", "2025-01-01T00:00:00.000Z|0000|0000");
 * ```
 */
export function makeDocument<T extends AnyObject>(
	type: string,
	eventstamp: string,
): StarlingDocument<T> {
	return {
		type,
		latest: eventstamp,
		resources: {},
	};
}
