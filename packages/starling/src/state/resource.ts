import type { AnyObject, Eventstamp, EventstampMap } from "./types";
import { isPlainObject } from "./types";
import { getValueAtPath, setValueAtPath } from "./utils";

export type Resource<T extends { [key: string]: unknown }> = {
	id: string;
	attributes: T;
	eventstamps: EventstampMap;
};

/**
 * Creates a resource from an object. All fields get the same event stamp.
 */
export function makeResource<T extends AnyObject>(
	id: string,
	obj: T,
	eventstamp: Eventstamp,
): Resource<T> {
	const eventstamps: EventstampMap = {};

	// Go through the object and create paths for each field
	const traverse = (input: Record<string, unknown>, path: string = "") => {
		for (const key in input) {
			if (!Object.hasOwn(input, key)) continue;

			const value = input[key];
			const fieldPath = path ? `${path}.${key}` : key;

			if (isPlainObject(value)) {
				// This is an object inside another object - keep going deeper
				traverse(value as Record<string, unknown>, fieldPath);
			} else {
				// This is the actual value - save the timestamp
				eventstamps[fieldPath] = eventstamp;
			}
		}
	};

	traverse(obj);

	return {
		id,
		attributes: obj,
		eventstamps,
	};
}

/**
 * Picks which resource has the newest value for a field.
 */
function pickWinner<T extends AnyObject>(
	path: string,
	into: Resource<T>,
	from: Resource<T>,
): { resource: Resource<T>; stamp: Eventstamp } {
	const intoStamp = into.eventstamps[path];
	const fromStamp = from.eventstamps[path];

	if (!intoStamp && !fromStamp) {
		// This shouldn't happen, but just in case
		return { resource: into, stamp: "" };
	}

	if (!intoStamp && fromStamp) {
		return { resource: from, stamp: fromStamp };
	}

	if (!fromStamp && intoStamp) {
		return { resource: into, stamp: intoStamp };
	}

	if (intoStamp && fromStamp) {
		return intoStamp > fromStamp
			? { resource: into, stamp: intoStamp }
			: { resource: from, stamp: fromStamp };
	}

	// This line should never run
	throw new Error(`Unexpected error while merging resources`);
}

/**
 * Combines two resources, keeping the newest value for each field.
 */
export function mergeResources<T extends AnyObject>(
	into: Resource<T>,
	from: Resource<T>,
): Resource<T> {
	const resultAttributes: Record<string, unknown> = {};
	const resultEventstamps: EventstampMap = {};

	// Get all the field paths from both resources
	const allPaths = new Set([
		...Object.keys(into.eventstamps),
		...Object.keys(from.eventstamps),
	]);

	// For each field, choose the newer value
	for (const path of allPaths) {
		const { resource: winningResource, stamp: winningStamp } = pickWinner(
			path,
			into,
			from,
		);

		const value = getValueAtPath(winningResource.attributes, path);
		setValueAtPath(resultAttributes, path, value);
		resultEventstamps[path] = winningStamp;
	}

	return {
		id: into.id,
		attributes: resultAttributes as T,
		eventstamps: resultEventstamps,
	};
}
