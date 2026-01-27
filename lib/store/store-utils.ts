import { advanceClock, mergeCollections, type StoreState } from "../core";
import type { StoreConfig } from "./schema";
import type { StoreChangeEvent } from "./types";

export function mergeState<T extends StoreConfig>(
  currentState: StoreState,
  snapshot: StoreState,
  config: T,
): StoreChangeEvent<T> {
  const diff = {} as StoreChangeEvent<T>;

  currentState.clock = advanceClock(currentState.clock, snapshot.clock);

  for (const [name, incomingCollectionState] of Object.entries(snapshot.collections)) {
    const localCollectionState = currentState.collections[name] ?? {
      documents: {},
      tombstones: {},
    };
    currentState.collections[name] = mergeCollections(
      localCollectionState,
      incomingCollectionState,
    );
    // Only mark collections that exist in the config
    if (name in config) {
      (diff as Record<string, true>)[name] = true;
    }
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
