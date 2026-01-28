import {
  createReadLens,
  isDeleted,
  mergeDocs,
  type AtomizedDocument,
  type Document,
  type Collection,
  type Stamp,
  type Tombstones,
  atomize,
  advanceClock,
  type StoreState,
  mergeCollections,
} from "../core";
import type { StoreConfig } from "./schema";
import type { StoreChangeEvent } from "./types";

export function doGet<T extends Document>(
  docs: Collection<T>,
  tombstones: Tombstones,
  id: string,
): T | undefined {
  if (isDeleted(id, tombstones)) return undefined;
  const current = docs[id];
  if (!current) return undefined;
  return createReadLens<T>(current);
}

export function doList<T extends Document>(docs: Collection<T>, tombstones: Tombstones): T[] {
  const results: T[] = [];
  for (const [id, document] of Object.entries(docs)) {
    if (!isDeleted(id, tombstones)) {
      results.push(createReadLens<T>(document));
    }
  }
  return results;
}

export function doPut<T extends Document>(
  docs: Collection<T>,
  tombstones: Tombstones,
  data: T,
  stamp: Stamp,
  validateFn: (data: unknown) => T,
  getId: (data: T) => string,
): T {
  const validated = validateFn(data);
  const id = getId(validated);
  if (tombstones[id]) {
    delete tombstones[id]; // Revive
  }
  docs[id] = atomize<T>(validated, stamp);
  return createReadLens<T>(docs[id]!);
}

export function doPatch<T extends Document>(
  docs: Collection<T>,
  id: string,
  data: Partial<T>,
  stamp: Stamp,
  validateFn: (data: unknown) => T,
): T {
  const current = docs[id];
  if (!current) {
    throw new Error(`Cannot patch non-existent document "${id}"`);
  }

  const changes = atomize<Partial<T>>(data, stamp) as Partial<AtomizedDocument<T>>;
  const merged = mergeDocs(current, changes);
  const plain = createReadLens<T>(merged);
  validateFn(plain);
  docs[id] = merged;
  return plain;
}

export function doRemove(
  docs: Collection<Document>,
  tombstones: Tombstones,
  id: string,
  stamp: Stamp,
): void {
  tombstones[id] = stamp;
  delete docs[id];
}

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
