import { advanceClock, mergeTombstones, type Collection, type StoreState } from "../core";
import type { StoreConfig } from "./schema";
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
