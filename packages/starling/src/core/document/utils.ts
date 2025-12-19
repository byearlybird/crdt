import { maxEventstamp } from "../clock/eventstamp";
import type { AnyObject, DocumentState } from "./document";
import type { Resource } from "./resource";

/**
 * Convert a DocumentState's resources into a Map keyed by resource ID.
 * @param document - DocumentState containing resource data
 * @returns Map of resource ID to Resource
 */
export function documentToMap<T extends AnyObject>(
	document: DocumentState<T>,
): Map<string, Resource<T>> {
	return new Map(Object.entries(document.resources));
}

/**
 * Convert a Map of resources into a DocumentState.
 *
 * @param type - Resource type identifier for this document
 * @param resources - Map of resource ID to Resource
 * @param tombstones - Map of deleted resource IDs to deletion eventstamps (optional)
 * @returns DocumentState
 */
export function mapToDocument<T extends AnyObject>(
	type: string,
	resources: Map<string, Resource<T>>,
	tombstones?: Map<string, string>,
): DocumentState<T> {
	// Convert Map to Record
	const resourcesRecord: Record<string, Resource<T>> = {};
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
