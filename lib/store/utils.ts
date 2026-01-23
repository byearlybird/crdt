import type { DocumentId, Tombstones } from "../core";
import type { AnyObject, CollectionConfig, CollectionName, StoreConfig } from "./schema";
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

/**
 * Creates a Proxy that lazily initializes collection handles on first access.
 * Used by transactions and queries to track which collections are accessed.
 */
export function createHandleProxy<T>(
  configs: Map<string, CollectionConfig<AnyObject>>,
  onAccess: (collectionName: string, target: Record<string, unknown>) => void,
): T {
  const target = {} as Record<string, unknown>;
  return new Proxy(target, {
    get(target, prop: string | symbol) {
      if (typeof prop !== "string") {
        return undefined;
      }

      if (!configs.has(prop)) {
        throw new Error(`Collection "${prop}" not found`);
      }

      if (!(prop in target)) {
        onAccess(prop, target);
      }

      return target[prop];
    },
  }) as T;
}
