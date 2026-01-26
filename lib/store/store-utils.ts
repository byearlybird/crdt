import { advanceClock, mergeCollections, mergeTombstones, type StoreState } from "../core";
import type { StoreConfig } from "./schema";
import type { StoreChangeEvent } from "./types";

export function mergeState(currentState: StoreState, snapshot: StoreState): Record<string, true> {
  const diff: Record<string, true> = {};

  currentState.clock = advanceClock(currentState.clock, snapshot.clock);
  currentState.tombstones = mergeTombstones(currentState.tombstones, snapshot.tombstones);

  for (const [name, incomingCollection] of Object.entries(snapshot.collections)) {
    const localCollection = currentState.collections[name] ?? {};
    currentState.collections[name] = mergeCollections(
      localCollection,
      incomingCollection,
      currentState.tombstones,
    );
    diff[name] = true;
  }

  return diff;
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
