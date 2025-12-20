import { maxEventstamp } from "../clock/eventstamp";
import type { DocumentState } from "./document";
import type { Resource } from "./resource";
import type { AnyObject, Eventstamp } from "./types";
import { isRecord } from "./types";

/**
 * Gets a value from inside an object using a dot path like "user.name".
 * Returns undefined if the path doesn't exist or goes through something that's not an object.
 */
export function getValueAtPath(
	obj: Record<string, unknown>,
	path: string,
): unknown {
	const parts = path.split(".");
	let current: unknown = obj;

	for (const part of parts) {
		if (!isRecord(current)) return undefined;
		current = current[part];
	}

	return current;
}

/**
 * Sets a value inside an object using a dot path like "user.name".
 * Creates any missing objects along the way.
 */
export function setValueAtPath(
	obj: Record<string, unknown>,
	path: string,
	value: unknown,
): void {
	const parts = path.split(".");
	let current = obj;

	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i]!;

		if (!current[part] || typeof current[part] !== "object") {
			current[part] = {};
		}
		current = current[part] as Record<string, unknown>;
	}

	const lastPart = parts[parts.length - 1]!;
	current[lastPart] = value;
}

/**
 * Checks if two eventstamp records have changed.
 * Returns true if the records have different keys or different values for any key.
 */
export function eventstampsChanged(
	before: Record<string, string>,
	after: Record<string, string>,
): boolean {
	const beforeKeys = Object.keys(before);
	const afterKeys = Object.keys(after);

	if (beforeKeys.length !== afterKeys.length) {
		return true;
	}

	return beforeKeys.some((key) => before[key] !== after[key]);
}

/**
 * Finds the maximum eventstamp from a record's values.
 */
export function maxEventstampFromValues<T extends Record<string, string>>(
	values: T,
): Eventstamp {
	return maxEventstamp(Object.values(values));
}

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
