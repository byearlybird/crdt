import { maxEventstamp } from "../clock/eventstamp";
import type { AnyObject, StarlingDocument } from "./document";
import type { ResourceObject } from "./resource";

/**
 * Convert a StarlingDocument's resources into a Map keyed by resource ID.
 * @param document - StarlingDocument containing resource data
 * @returns Map of resource ID to ResourceObject
 */
export function documentToMap<T extends AnyObject>(
	document: StarlingDocument<T>,
): Map<string, ResourceObject<T>> {
	return new Map(Object.entries(document.resources));
}

/**
 * Convert a Map of resources into a StarlingDocument.
 * @param type - Resource type identifier for this collection
 * @param resources - Map of resource ID to ResourceObject
 * @param fallbackEventstamp - Eventstamp to include when computing the max (optional)
 * @param tombstones - Map of deleted resource IDs to deletion eventstamps (optional)
 * @returns StarlingDocument representation of the resources
 */
export function mapToDocument<T extends AnyObject>(
	type: string,
	resources: Map<string, ResourceObject<T>>,
	fallbackEventstamp?: string,
	tombstones?: Map<string, string>,
): StarlingDocument<T> {
	const resourceArray = Array.from(resources.values());
	const eventstamps = resourceArray.map((r) => r.meta.latest);

	// Include fallback eventstamp in the max calculation if provided
	if (fallbackEventstamp) {
		eventstamps.push(fallbackEventstamp);
	}

	// Include tombstone eventstamps in the max calculation
	if (tombstones) {
		for (const stamp of tombstones.values()) {
			eventstamps.push(stamp);
		}
	}

	const latest = maxEventstamp(eventstamps);

	// Convert Map to Record
	const resourcesRecord: Record<string, ResourceObject<T>> = {};
	for (const [id, resource] of resources) {
		resourcesRecord[id] = resource;
	}

	// Convert tombstones Map to Record
	const tombstonesRecord: Record<string, string> = {};
	if (tombstones) {
		for (const [id, stamp] of tombstones) {
			tombstonesRecord[id] = stamp;
		}
	}

	return {
		type,
		latest,
		resources: resourcesRecord,
		tombstones: tombstonesRecord,
	};
}
