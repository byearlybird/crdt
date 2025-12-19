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
 *
 * @param type - Resource type identifier for this collection
 * @param resources - Map of resource ID to ResourceObject
 * @param tombstones - Map of deleted resource IDs to deletion eventstamps (optional)
 * @returns StarlingDocument
 */
export function mapToDocument<T extends AnyObject>(
	type: string,
	resources: Map<string, ResourceObject<T>>,
	tombstones?: Map<string, string>,
): StarlingDocument<T> {
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
		resources: resourcesRecord,
		tombstones: tombstonesRecord,
	};
}
