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
 * Checks if two eventstamp maps are different.
 */
function eventstampsChanged(
	before: Record<string, string>,
	after: Record<string, string>,
): boolean {
	const beforeKeys = Object.keys(before);
	const afterKeys = Object.keys(after);

	if (beforeKeys.length !== afterKeys.length) {
		return true;
	}

	return beforeKeys.some(key => before[key] !== after[key]);
}

/**
 * Merges tombstone maps, keeping the newer eventstamp for each ID.
 */
function mergeTombstones(
	into: Record<string, string>,
	from: Record<string, string>,
): Record<string, string> {
	const merged = { ...into };

	for (const [id, fromStamp] of Object.entries(from)) {
		const intoStamp = merged[id];
		if (!intoStamp || fromStamp > intoStamp) {
			merged[id] = fromStamp;
		}
	}

	return merged;
}

/**
 * Finds resources that are newly deleted in this merge.
 * A resource is newly deleted if it exists in resources and appears in the new
 * tombstones but not in the old tombstones.
 */
function findNewDeletions<T extends AnyObject>(
	intoResources: Record<string, Resource<T>>,
	fromResources: Record<string, Resource<T>>,
	oldTombstones: Record<string, string>,
	newTombstones: Record<string, string>,
): Set<string> {
	const deleted = new Set<string>();
	const allResourceIds = new Set([
		...Object.keys(intoResources),
		...Object.keys(fromResources),
	]);

	for (const id of allResourceIds) {
		const wasDeleted = oldTombstones[id] !== undefined;
		const isDeleted = newTombstones[id] !== undefined;

		if (isDeleted && !wasDeleted) {
			deleted.add(id);
		}
	}

	return deleted;
}

/**
 * Gets the maximum eventstamp from a resource's eventstamps.
 */
function getResourceLatestStamp<T extends AnyObject>(resource: Resource<T>): string {
	return maxEventstamp(Object.values(resource.eventstamps));
}

/**
 * Filters out tombstoned resources from a resource map.
 * Returns only resources that are not marked as deleted.
 */
function filterTombstonedResources<T extends AnyObject>(
	resources: Record<string, Resource<T>>,
	tombstones: Record<string, string>,
): Record<string, Resource<T>> {
	const filtered: Record<string, Resource<T>> = {};

	for (const [id, resource] of Object.entries(resources)) {
		if (!tombstones[id]) {
			filtered[id] = resource;
		}
	}

	return filtered;
}

/**
 * Result of merging source resources into base resources.
 */
type MergeResourcesResult<T extends AnyObject> = {
	/** The merged resources map */
	resources: Record<string, Resource<T>>;
	/** Resources that were added */
	added: Map<string, Resource<T>>;
	/** Resources that were updated */
	updated: Map<string, Resource<T>>;
	/** The latest eventstamp found during merge */
	newestEventstamp: string;
};

/**
 * Merges source resources into base resources, skipping tombstoned resources.
 * Tracks which resources were added or updated and finds the newest eventstamp.
 */
function mergeSourceResources<T extends AnyObject>(
	baseResources: Record<string, Resource<T>>,
	sourceResources: Record<string, Resource<T>>,
	tombstones: Record<string, string>,
	currentClock: string,
): MergeResourcesResult<T> {
	const resources = { ...baseResources };
	const added = new Map<string, Resource<T>>();
	const updated = new Map<string, Resource<T>>();
	let newestEventstamp = currentClock;

	for (const [id, fromResource] of Object.entries(sourceResources)) {
		// Skip tombstoned resources
		if (tombstones[id]) {
			continue;
		}

		const intoResource = resources[id];

		if (!intoResource) {
			// New resource
			resources[id] = fromResource;
			added.set(id, fromResource);

			const resourceLatest = getResourceLatestStamp(fromResource);
			if (resourceLatest > newestEventstamp) {
				newestEventstamp = resourceLatest;
			}
		} else if (intoResource !== fromResource) {
			// Merge existing resource
			const mergedResource = mergeResources(intoResource, fromResource);
			resources[id] = mergedResource;

			const resourceLatest = getResourceLatestStamp(mergedResource);
			if (resourceLatest > newestEventstamp) {
				newestEventstamp = resourceLatest;
			}

			// Track update if eventstamps changed
			if (eventstampsChanged(intoResource.eventstamps, mergedResource.eventstamps)) {
				updated.set(id, mergedResource);
			}
		}
	}

	return { resources, added, updated, newestEventstamp };
}

/**
 * Finds the maximum eventstamp from tombstones, comparing against a current value.
 */
function maxEventstampFromTombstones(
	tombstones: Record<string, string>,
	current: string,
): string {
	let newest = current;

	for (const stamp of Object.values(tombstones)) {
		if (stamp > newest) {
			newest = stamp;
		}
	}

	return newest;
}

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
	// Step 1: Merge tombstones
	const mergedTombstones = mergeTombstones(into.tombstones, from.tombstones);

	// Step 2: Find newly deleted resources
	const deleted = findNewDeletions(
		into.resources,
		from.resources,
		into.tombstones,
		mergedTombstones,
	);

	// Step 3: Filter out tombstoned resources from base document
	const filteredResources = filterTombstonedResources(into.resources, mergedTombstones);

	// Step 4: Merge resources from source document
	const { resources: mergedResources, added, updated, newestEventstamp: resourcesLatest } =
		mergeSourceResources(filteredResources, from.resources, mergedTombstones, currentClock);

	// Step 5: Update latest from tombstones
	const newestEventstamp = maxEventstampFromTombstones(mergedTombstones, resourcesLatest);

	return {
		document: {
			type: into.type,
			resources: mergedResources,
			tombstones: mergedTombstones,
		},
		changes: { added, updated, deleted },
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
