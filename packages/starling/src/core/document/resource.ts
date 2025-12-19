import { MIN_EVENTSTAMP } from "../clock/eventstamp";
import type { AnyObject } from "./document";

function isObject(value: unknown): boolean {
	return (
		value != null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

/**
 * Get a value from a nested object using a dot-separated path.
 * @internal
 */
function getValueAtPath(obj: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".");
	let current: unknown = obj;

	for (const part of parts) {
		if (current == null || typeof current !== "object") return undefined;
		current = (current as Record<string, unknown>)[part];
	}

	return current;
}

/**
 * Set a value in a nested object using a dot-separated path.
 * Creates intermediate objects as needed.
 * @internal
 */
function setValueAtPath(
	obj: Record<string, unknown>,
	path: string,
	value: unknown,
): void {
	const parts = path.split(".");
	let current: Record<string, unknown> = obj;

	for (let i = 0; i < parts.length - 1; i++) {
		const part = parts[i];
		if (part === undefined) continue;

		if (!current[part] || typeof current[part] !== "object") {
			current[part] = {};
		}
		current = current[part] as Record<string, unknown>;
	}

	const lastPart = parts[parts.length - 1];
	if (lastPart !== undefined) {
		current[lastPart] = value;
	}
}

/**
 * Compute the latest eventstamp for a resource from its field eventstamps.
 * Used internally and exported for testing/validation.
 * @internal
 */
export function computeResourceLatest(
	eventstamps: Record<string, string>,
	fallback?: string,
): string {
	let max = fallback ?? MIN_EVENTSTAMP;

	// With flat eventstamps, just iterate over all values
	for (const stamp of Object.values(eventstamps)) {
		if (stamp > max) {
			max = stamp;
		}
	}

	return max;
}

/**
 * Resource object structure representing a single stored entity.
 * Resources are the primary unit of storage and synchronization in Starling.
 *
 * Each resource has a unique identifier, attributes containing the data,
 * and metadata for tracking eventstamps.
 * The resource type is stored at the document level.
 */
export type ResourceObject<T extends { [key: string]: unknown }> = {
	/** Unique identifier for this resource */
	id: string;
	/** The resource's data as a nested object structure */
	attributes: T;
	/** Metadata for tracking eventstamps */
	meta: {
		/** Flat map of dot-separated paths to eventstamps (e.g., "user.address.street": "2025-11-18...") */
		eventstamps: Record<string, string>;
		/** The greatest eventstamp in this resource */
		latest: string;
	};
};

export function makeResource<T extends AnyObject>(
	id: string,
	obj: T,
	eventstamp: string,
): ResourceObject<T> {
	const eventstamps: Record<string, string> = {};

	// Traverse the object and build flat paths
	const traverse = (input: Record<string, unknown>, path: string = "") => {
		for (const key in input) {
			if (!Object.hasOwn(input, key)) continue;

			const value = input[key];
			const fieldPath = path ? `${path}.${key}` : key;

			if (isObject(value)) {
				// Nested object - recurse to build deeper paths
				traverse(value as Record<string, unknown>, fieldPath);
			} else {
				// Leaf value - store path -> eventstamp
				eventstamps[fieldPath] = eventstamp;
			}
		}
	};

	traverse(obj);

	return {
		id,
		attributes: obj,
		meta: {
			eventstamps,
			latest: eventstamp,
		},
	};
}

export function mergeResources<T extends AnyObject>(
	into: ResourceObject<T>,
	from: ResourceObject<T>,
): ResourceObject<T> {
	const resultAttributes: Record<string, unknown> = {};
	const resultEventstamps: Record<string, string> = {};

	// Collect all paths from both eventstamp maps
	const allPaths = new Set([
		...Object.keys(into.meta.eventstamps),
		...Object.keys(from.meta.eventstamps),
	]);

	// Simple iteration: for each path, pick the winner based on eventstamp
	for (const path of allPaths) {
		const stamp1 = into.meta.eventstamps[path];
		const stamp2 = from.meta.eventstamps[path];

		if (stamp1 && stamp2) {
			// Both have this path - compare eventstamps
			if (stamp1 > stamp2) {
				setValueAtPath(
					resultAttributes,
					path,
					getValueAtPath(into.attributes, path),
				);
				resultEventstamps[path] = stamp1;
			} else {
				setValueAtPath(
					resultAttributes,
					path,
					getValueAtPath(from.attributes, path),
				);
				resultEventstamps[path] = stamp2;
			}
		} else if (stamp1) {
			// Only in first record
			setValueAtPath(
				resultAttributes,
				path,
				getValueAtPath(into.attributes, path),
			);
			resultEventstamps[path] = stamp1;
		} else if (stamp2) {
			// Only in second record
			setValueAtPath(
				resultAttributes,
				path,
				getValueAtPath(from.attributes, path),
			);
			resultEventstamps[path] = stamp2;
		}
	}

	// Use the cached latest values from both records
	const baseLatest =
		into.meta.latest > from.meta.latest ? into.meta.latest : from.meta.latest;
	const latest = computeResourceLatest(resultEventstamps, baseLatest);

	return {
		id: into.id,
		attributes: resultAttributes as T,
		meta: {
			eventstamps: resultEventstamps,
			latest,
		},
	};
}
