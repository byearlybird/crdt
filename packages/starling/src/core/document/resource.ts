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
 * Type guard to check if a value is a record (plain object).
 */
function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}

/**
 * Get a value from a nested object using a dot-separated path.
 * Returns undefined if the path doesn't exist or traverses through a non-object.
 * @internal
 */
function getValueAtPath(obj: Record<string, unknown>, path: string): unknown {
	const parts = path.split(".");
	let current: unknown = obj;

	for (const part of parts) {
		if (!isRecord(current)) return undefined;
		current = current[part];
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
 * A single data record with change tracking.
 * @see docs/architecture.md#resource-object-format
 */
export type Resource<T extends { [key: string]: unknown }> = {
	/** Unique identifier */
	id: string;
	/** The record's data */
	attributes: T;
	/** Maps field paths to timestamps (e.g., "name": "2025-11-18...") */
	eventstamps: Record<string, string>;
};

/**
 * Creates a resource from an object. All fields get the same timestamp.
 */
export function makeResource<T extends AnyObject>(
	id: string,
	obj: T,
	eventstamp: string,
): Resource<T> {
	const eventstamps: Record<string, string> = {};

	// Walk through object and build field paths
	const traverse = (input: Record<string, unknown>, path: string = "") => {
		for (const key in input) {
			if (!Object.hasOwn(input, key)) continue;

			const value = input[key];
			const fieldPath = path ? `${path}.${key}` : key;

			if (isObject(value)) {
				// Nested object - go deeper
				traverse(value as Record<string, unknown>, fieldPath);
			} else {
				// Final value - store timestamp
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
 * Picks the winning resource and eventstamp for a given field path.
 */
function pickWinner<T extends AnyObject>(
	path: string,
	into: Resource<T>,
	from: Resource<T>,
): { resource: Resource<T>; stamp: string } {
	const intoStamp = into.eventstamps[path];
	const fromStamp = from.eventstamps[path];

	if (!intoStamp && !fromStamp) {
		// Shouldn't happen if allPaths is correct, but handle it
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

	// Should never reach here, but satisfy TypeScript
	return { resource: into, stamp: intoStamp || fromStamp || "" };
}

/**
 * Merges two resources, keeping the newest value for each field.
 */
export function mergeResources<T extends AnyObject>(
	into: Resource<T>,
	from: Resource<T>,
): Resource<T> {
	const resultAttributes: Record<string, unknown> = {};
	const resultEventstamps: Record<string, string> = {};

	// Get all field paths from both resources
	const allPaths = new Set([
		...Object.keys(into.eventstamps),
		...Object.keys(from.eventstamps),
	]);

	// For each field, pick the newer value
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
