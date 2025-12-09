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
 * @returns StarlingDocument representation of the resources
 */
export function mapToDocument<T extends AnyObject>(
	type: string,
	resources: Map<string, ResourceObject<T>>,
	fallbackEventstamp?: string,
): StarlingDocument<T> {
	const resourceArray = Array.from(resources.values());
	const eventstamps = resourceArray.map((r) => r.meta.latest);

	// Include fallback eventstamp in the max calculation if provided
	if (fallbackEventstamp) {
		eventstamps.push(fallbackEventstamp);
	}

	const latest = maxEventstamp(eventstamps);

	// Convert Map to Record
	const resourcesRecord: Record<string, ResourceObject<T>> = {};
	for (const [id, resource] of resources) {
		resourcesRecord[id] = resource;
	}

	return {
		type,
		latest,
		resources: resourcesRecord,
	};
}
