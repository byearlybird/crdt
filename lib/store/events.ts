import type { CollectionName, StoreConfig } from "./schema";
import type { StoreChangeEvent } from "./types";

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
