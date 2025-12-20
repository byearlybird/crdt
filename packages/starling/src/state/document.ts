import { mergeResources, type Resource } from "./resource";
import type { AnyObject, Eventstamp, TombstoneMap } from "./types";
import { eventstampsChanged, maxEventstampFromValues } from "./utils";

/**
 * DocumentState holds all the info for a document:
 * - What type of resource this is
 * - All the resources, organized by their ID
 * - Which resources have been deleted
 *
 * This is what gets shared between different copies of the data.
 */
export type DocumentState<T extends AnyObject> = {
	type: string;
	resources: Record<string, Resource<T>>;
	tombstones: TombstoneMap;
};

export type DocumentChanges<T extends AnyObject> = {
	added: Map<string, Resource<T>>;
	updated: Map<string, Resource<T>>;
	deleted: Set<string>;
};

export type MergeDocumentsResult<T extends AnyObject> = {
	document: DocumentState<T>;
	changes: DocumentChanges<T>;
	latest: Eventstamp;
};

/**
 * Combines deletion lists, keeping the newest eventstamp for each ID.
 */
function mergeTombstones(into: TombstoneMap, from: TombstoneMap): TombstoneMap {
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
 * Finds resources that were just deleted during this merge.
 * A resource is newly deleted if it's in the new deletion list but wasn't
 * in the old deletion list.
 */
function findNewDeletions<T extends AnyObject>(
	intoResources: Record<string, Resource<T>>,
	fromResources: Record<string, Resource<T>>,
	oldTombstones: TombstoneMap,
	newTombstones: TombstoneMap,
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
 * Removes deleted resources from the list.
 * Returns only resources that are not marked as deleted.
 */
function filterTombstonedResources<T extends AnyObject>(
	resources: Record<string, Resource<T>>,
	tombstones: TombstoneMap,
): Record<string, Resource<T>> {
	const filtered: Record<string, Resource<T>> = {};

	for (const [id, resource] of Object.entries(resources)) {
		if (!tombstones[id]) {
			filtered[id] = resource;
		}
	}

	return filtered;
}

type MergeResourcesResult<T extends AnyObject> = {
	resources: Record<string, Resource<T>>;
	added: Map<string, Resource<T>>;
	updated: Map<string, Resource<T>>;
	newestEventstamp: Eventstamp;
};

/**
 * Combines incoming resources with existing ones, skipping deleted resources.
 * Keeps track of what was added or changed and finds the newest eventstamp.
 */
function mergeSourceResources<T extends AnyObject>(
	baseResources: Record<string, Resource<T>>,
	sourceResources: Record<string, Resource<T>>,
	tombstones: TombstoneMap,
	currentClock: Eventstamp,
): MergeResourcesResult<T> {
	const resources = { ...baseResources };
	const added = new Map<string, Resource<T>>();
	const updated = new Map<string, Resource<T>>();
	let newestEventstamp = currentClock;

	for (const [id, fromResource] of Object.entries(sourceResources)) {
		// Skip resources that are deleted
		if (tombstones[id]) {
			continue;
		}

		const intoResource = resources[id];

		if (!intoResource) {
			// This is a new resource
			resources[id] = fromResource;
			added.set(id, fromResource);

			const resourceLatest = maxEventstampFromValues(fromResource.eventstamps);
			if (resourceLatest > newestEventstamp) {
				newestEventstamp = resourceLatest;
			}
		} else if (intoResource !== fromResource) {
			// Combine with existing resource
			const mergedResource = mergeResources(intoResource, fromResource);
			resources[id] = mergedResource;

			const resourceLatest = maxEventstampFromValues(
				mergedResource.eventstamps,
			);
			if (resourceLatest > newestEventstamp) {
				newestEventstamp = resourceLatest;
			}

			// Mark as updated if timestamps changed
			if (
				eventstampsChanged(intoResource.eventstamps, mergedResource.eventstamps)
			) {
				updated.set(id, mergedResource);
			}
		}
	}

	return { resources, added, updated, newestEventstamp };
}

/**
 * Combines two documents, keeping the newest value for each field and merging tombstones.
 *
 * @param into - The first document (base)
 * @param from - The second document (incoming)
 * @param currentClock - The current time (to make sure time doesn't go backwards)
 * @returns Combined document, list of changes, and newest timestamp
 */
export function mergeDocuments<T extends AnyObject>(
	into: DocumentState<T>,
	from: DocumentState<T>,
	currentClock: Eventstamp,
): MergeDocumentsResult<T> {
	// Step 1: Combine deletion lists
	const mergedTombstones = mergeTombstones(into.tombstones, from.tombstones);

	// Step 2: Find resources that were just deleted
	const deleted = findNewDeletions(
		into.resources,
		from.resources,
		into.tombstones,
		mergedTombstones,
	);

	// Step 3: Remove deleted resources from first document
	const filteredResources = filterTombstonedResources(
		into.resources,
		mergedTombstones,
	);

	// Step 4: Combine resources from second document
	const {
		resources: mergedResources,
		added,
		updated,
		newestEventstamp: resourcesLatest,
	} = mergeSourceResources(
		filteredResources,
		from.resources,
		mergedTombstones,
		currentClock,
	);

	// Step 5: Check deletion timestamps for newest time
	const newestTombstone = maxEventstampFromValues(mergedTombstones);
	const newestEventstamp =
		newestTombstone > resourcesLatest ? newestTombstone : resourcesLatest;

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
 * Creates an empty document for a given type.
 * Useful when starting fresh or for testing.
 *
 * @param type - What type of resource this document will hold
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
