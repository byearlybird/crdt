import type { Clock, Stamp } from "./clock";
import type { Tombstones } from "./tombstone";
import { Atomizer } from "./atomizer";

// CONSTANTS
export const KEYS = { VAL: "~val", TS: "~ts" } as const;

/**
 * Base constraint for plain document shapes - any object with string keys.
 */
export type Document = Record<string, unknown>;

export type Atom<T> = {
  [KEYS.VAL]: T;
  [KEYS.TS]: Stamp;
};

/**
 * Atomized document with plain shape T. Each key K is stored as Atom<T[K]> (per-field).
 */
export type AtomizedDocument<T extends Document> = {
  [K in keyof T]: Atom<T[K]>;
};

/**
 * Collection of atomized documents with shape T. Map from document ID to AtomizedDocument<T>.
 */
export type Collection<T extends Document> = Record<string, AtomizedDocument<T>>;

/**
 * Collection state containing documents and tombstones.
 */
export type CollectionState<T extends Document> = {
  documents: Collection<T>;
  tombstones: Tombstones;
};

export type StoreState = {
  clock: Clock;
  collections: Record<string, CollectionState<Document>>;
};

/**
 * Type guard to check if a value is an AtomizedDocument.
 * An AtomizedDocument is an object where all values are Atoms.
 */
export function isAtomizedDocument<T extends Document>(
  value: unknown,
): value is AtomizedDocument<T> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const obj = value as Record<string, unknown>;
  // Check that all values are atoms
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (!Atomizer.isAtom(obj[key])) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Type guard to check if a value is a Collection.
 * A Collection is a Record where all values are AtomizedDocuments.
 */
export function isCollection<T extends Document>(value: unknown): value is Collection<T> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const obj = value as Record<string, unknown>;
  // Check that all values are documents
  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      if (!isAtomizedDocument<T>(obj[key])) {
        return false;
      }
    }
  }
  return true;
}

/**
 * Type guard to check if a value is a CollectionState.
 * A CollectionState has documents (Collection) and tombstones (Record<string, string>).
 */
export function isCollectionState<T extends Document>(value: unknown): value is CollectionState<T> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const obj = value as Record<string, unknown>;
  if (!("documents" in obj) || !("tombstones" in obj)) {
    return false;
  }
  return (
    isCollection<T>(obj["documents"]) &&
    obj["tombstones"] !== null &&
    typeof obj["tombstones"] === "object" &&
    !Array.isArray(obj["tombstones"])
  );
}
