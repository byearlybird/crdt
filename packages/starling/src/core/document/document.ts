import { maxEventstamp } from "../clock/eventstamp";
import { mergeResources, type Resource } from "./resource";

/**
 * Base constraint for all document data in Starling.
 * Documents must be plain JavaScript objects with string keys.
 */
export type AnyObject = Record<string, unknown>;

/**
 * DocumentState represents the complete state of a document:
 * - Resource type identifier
 * - Map of resources keyed by ID
 * - Tombstones tracking deleted resource IDs
 *
 * DocumentState is the unit of synchronization between replicas.
 */
export type DocumentState<T extends AnyObject> = {
	/** Resource type for this document */
	type: string;

	/** Map of resources keyed by ID for efficient lookups */
	resources: Record<string, Resource<T>>;

	/** Map of deleted resource IDs to deletion eventstamps */
	tombstones: Record<string, string>;
};

/**
 * Change tracking information returned by mergeDocuments.
 * Categorizes resources by mutation type for hook notifications.
 */
export type DocumentChanges<T extends AnyObject> = {
	/** Resources that were newly added (didn't exist before or were previously deleted) */
	added: Map<string, Resource<T>>;

	/** Resources that were modified (existed before and changed) */
	updated: Map<string, Resource<T>>;

	/** Resources that were deleted (newly marked with deletedAt) */
	deleted: Set<string>;
};

/**
 * Result of merging two documents.
 */
export type MergeDocumentsResult<T extends AnyObject> = {
	/** The merged document with updated resources */
	document: DocumentState<T>;

	/** Change tracking for plugin hook notifications */
	changes: DocumentChanges<T>;

	/** The maximum eventstamp from the merge (for clock forwarding) */
	latest: string;
};

/**
 * Merges two documents using field-level Last-Write-Wins semantics.
 *
 * The merge operation:
 * 1. Merges tombstones (union, keeping newer deletion eventstamp)
 * 2. Removes resources that have tombstones
 * 3. Merges non-tombstoned resources using field-level LWW
 * 4. Computes the maximum eventstamp from all resources and tombstones
 *
 * Deletion is final: once a resource is tombstoned, it will not be restored.
 * Tombstoned resources are removed from the resources map entirely.
 *
 * @param into - The base document to merge into
 * @param from - The source document to merge from
 * @param currentClock - The current store clock value (for preventing regression)
 * @returns Merged document, categorized changes, and maximum eventstamp
 *
 * @example
 * ```typescript
 * const into = {
 *   type: "items",
 *   resources: { "doc1": { id: "doc1", attributes: {...}, eventstamps: {...} } },
 *   tombstones: {}
 * };
 *
 * const from = {
 *   type: "items",
 *   resources: {
 *     "doc1": { id: "doc1", attributes: {...}, eventstamps: {...} }, // updated
 *     "doc2": { id: "doc2", attributes: {...}, eventstamps: {...} }  // new
 *   },
 *   tombstones: {}
 * };
 *
 * const result = mergeDocuments(into, from, "000192e85b8c000001a1b2c3");
 * // result.latest === max eventstamp from merge
 * // result.changes.added has "doc2"
 * // result.changes.updated has "doc1"
 * ```
 */
export function mergeDocuments<T extends AnyObject>(
	into: DocumentState<T>,
	from: DocumentState<T>,
	currentClock: string,
): MergeDocumentsResult<T> {
	// Track changes for hook notifications
	const added = new Map<string, Resource<T>>();
	const updated = new Map<string, Resource<T>>();
	const deleted = new Set<string>();

	// Step 1: Merge tombstones (union, keeping newer eventstamp)
	const mergedTombstones: Record<string, string> = { ...into.tombstones };
	for (const [id, fromStamp] of Object.entries(from.tombstones)) {
		const intoStamp = mergedTombstones[id];
		if (!intoStamp || fromStamp > intoStamp) {
			mergedTombstones[id] = fromStamp;
		}
	}

	// Step 2: Start with base resources, removing tombstoned ones
	const mergedResources: Record<string, Resource<T>> = {};
	for (const [id, resource] of Object.entries(into.resources)) {
		if (!mergedTombstones[id]) {
			mergedResources[id] = resource;
		} else {
			// Resource exists in 'into' but has a tombstone - mark as deleted
			if (!into.tombstones[id]) {
				// Newly tombstoned (from remote)
				deleted.add(id);
			}
		}
	}

	let newestEventstamp = currentClock;

	// Step 3: Process each source resource (skip tombstoned ones)
	for (const [id, fromDoc] of Object.entries(from.resources)) {
		// Skip if tombstoned (deletion is final)
		if (mergedTombstones[id]) {
			const intoDoc = into.resources[id];
			if (intoDoc && !into.tombstones[id]) {
				// Newly tombstoned
				deleted.add(id);
			}
			continue;
		}

		const intoDoc = mergedResources[id];

		if (!intoDoc) {
			// New resource - add it
			mergedResources[id] = fromDoc;
			added.set(id, fromDoc);
			const resourceLatest = maxEventstamp(Object.values(fromDoc.eventstamps));
			if (resourceLatest > newestEventstamp) {
				newestEventstamp = resourceLatest;
			}
		} else {
			// Skip merge if resources are identical (same reference)
			if (intoDoc === fromDoc) {
				continue;
			}

			// Merge existing resource using field-level LWW
			const mergedDoc = mergeResources(intoDoc, fromDoc);
			mergedResources[id] = mergedDoc;
			const resourceLatest = maxEventstamp(Object.values(mergedDoc.eventstamps));
			if (resourceLatest > newestEventstamp) {
				newestEventstamp = resourceLatest;
			}

			// Track update if eventstamps changed
			// Compare eventstamp maps to detect changes
			const intoStamps = JSON.stringify(intoDoc.eventstamps);
			const mergedStamps = JSON.stringify(mergedDoc.eventstamps);
			if (intoStamps !== mergedStamps) {
				updated.set(id, mergedDoc);
			}
		}
	}

	// Step 4: Update newestEventstamp from tombstones
	for (const stamp of Object.values(mergedTombstones)) {
		if (stamp > newestEventstamp) {
			newestEventstamp = stamp;
		}
	}

	return {
		document: {
			type: into.type,
			resources: mergedResources,
			tombstones: mergedTombstones,
		},
		changes: {
			added,
			updated,
			deleted,
		},
		latest: newestEventstamp,
	};
}

/**
 * Creates an empty document with the given type.
 * Useful for initializing new stores or testing.
 *
 * @param type - Resource type identifier for this document
 * @returns Empty document
 *
 * @example
 * ```typescript
 * const empty = makeDocument("tasks");
 * ```
 */
export function makeDocument<T extends AnyObject>(
	type: string,
): DocumentState<T> {
	return {
		type,
		resources: {},
		tombstones: {},
	};
}
