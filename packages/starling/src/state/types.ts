/**
 * Base constraint for all document data in Starling.
 * Documents must be plain JavaScript objects with string keys.
 */
export type AnyObject = Record<string, unknown>;

/**
 * A lexicographically-sortable timestamp string (24 hex characters).
 * Created by encodeEventstamp(), validated by isValidEventstamp().
 *
 * This alias provides semantic clarity and a single point for future
 * enhancement (e.g., branded types) without runtime overhead.
 */
export type Eventstamp = string;

/**
 * Map of field paths to their eventstamps.
 * Used for field-level Last-Write-Wins in resources.
 */
export type EventstampMap = Record<string, Eventstamp>;

/**
 * Map of resource IDs to deletion eventstamps.
 * Used for tombstone tracking in documents.
 */
export type TombstoneMap = Record<string, Eventstamp>;

/**
 * Type guard to check if a value is a plain JavaScript object.
 * Returns false for null, arrays, and objects with custom prototypes.
 */
export function isPlainObject(value: unknown): boolean {
	return (
		value != null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.getPrototypeOf(value) === Object.prototype
	);
}

/**
 * Type guard to check if a value is a record (plain object).
 * Less strict than isPlainObject - allows objects with custom prototypes.
 */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return value != null && typeof value === "object" && !Array.isArray(value);
}
