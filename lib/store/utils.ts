import type { DocumentId, Tombstones } from "../core";
import type { CollectionName, StoreConfig } from "./schema";
import type { StoreChangeEvent } from "./store";

export function isDeleted(id: DocumentId, tombstones: Tombstones): boolean {
  return tombstones[id] !== undefined;
}

/**
 * Creates a StoreChangeEvent for a single collection.
 * This helper centralizes the type assertion needed because TypeScript
 * cannot prove that a runtime string is a valid CollectionName<T>.
 */
export function createChangeEvent<T extends StoreConfig>(
  collectionName: CollectionName<T>,
): StoreChangeEvent<T> {
  return { [collectionName]: true } as StoreChangeEvent<T>;
}
