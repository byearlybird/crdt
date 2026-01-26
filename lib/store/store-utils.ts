import { advanceClock, mergeTombstones, type Collection, type StoreState } from "../core";
import type { CollectionName, StoreConfig } from "./schema";
import type { StoreChangeEvent } from "./types";

export function filterTombstones<T extends Collection>(
  collection: T,
  tombstones: Record<string, string>,
): T {
  return Object.fromEntries(Object.entries(collection).filter(([id]) => !tombstones[id])) as T;
}

export function applyStateSnapshot(currentState: StoreState, snapshot: StoreState): void {
  currentState.clock = advanceClock(currentState.clock, snapshot.clock);
  currentState.tombstones = mergeTombstones(currentState.tombstones, snapshot.tombstones);

  for (const [name, collectionData] of Object.entries(snapshot.collections)) {
    currentState.collections[name] = filterTombstones(collectionData, currentState.tombstones);
  }
}

export function getCollectionConfig<T extends StoreConfig, N extends CollectionName<T>>(
  config: T,
  collectionName: N,
): T[N] {
  const collectionConfig = config[collectionName];
  if (!collectionConfig) {
    throw new Error(`Collection config not found for "${collectionName}"`);
  }
  return collectionConfig;
}

export function validateCollectionNames<T extends StoreConfig>(
  collections: (keyof T & string)[],
  config: T,
): void {
  const invalid = collections.find((name) => !(name in config));
  if (invalid) {
    throw new Error(`Collection "${invalid}" not found`);
  }
}

export function hasRelevantChange<T extends StoreConfig>(
  event: StoreChangeEvent<T>,
  collections: (keyof T & string)[],
): boolean {
  return collections.some((name) => event[name as keyof T]);
}

export function createChangeEvent<T extends StoreConfig>(
  collectionName: keyof T & string,
): StoreChangeEvent<T> {
  return { [collectionName]: true } as StoreChangeEvent<T>;
}

export function ensureNotInitialized(isInitialized: boolean, operation: string): void {
  if (isInitialized) {
    throw new Error(operation);
  }
}

export function ensureInitialized(isInitialized: boolean, operation: string): void {
  if (!isInitialized) {
    throw new Error(operation);
  }
}
