import {
  Atomizer,
  createReadLens,
  isDeleted,
  mergeDocs,
  type Collection,
  type Tombstones,
} from "../core";

export type Handle<T, Id extends string = string> = {
  get(id: Id): T | undefined;
  list(): T[];
  put(data: T): void;
  patch(id: Id, data: Partial<T>): void;
  remove(id: Id): void;
};

export type HandleDependencies<T extends object, Id extends string = string> = {
  getCollection: () => Collection<T>;
  getTombstones: () => Tombstones;
  getTimestamp: () => string;
  validate: (data: unknown) => T;
  getId: (data: T) => Id;
  onMutate?: () => void;
};

export function createHandle<T extends Record<string, unknown>, Id extends string = string>(
  deps: HandleDependencies<T, Id>,
): Handle<T, Id> {
  const { getCollection, getTombstones, getTimestamp, validate, getId, onMutate } = deps;

  return {
    get(id) {
      const tombstones = getTombstones();
      if (isDeleted(id, tombstones)) return undefined;
      const current = getCollection()[id];
      if (!current) return undefined;
      return createReadLens<T>(current);
    },
    list() {
      const collection = getCollection();
      const tombstones = getTombstones();
      const results: T[] = [];
      for (const [id, document] of Object.entries(collection)) {
        if (!isDeleted(id, tombstones)) {
          results.push(createReadLens<T>(document));
        }
      }
      return results;
    },
    put(data) {
      const validated = validate(data);
      const id = getId(validated);
      const tombstones = getTombstones();
      if (tombstones[id]) {
        delete tombstones[id]; // Revive
      }
      getCollection()[id] = Atomizer.atomize<T>(validated, getTimestamp());
      onMutate?.();
    },
    patch(id, data) {
      const collection = getCollection();
      const current = collection[id];
      if (!current) {
        throw new Error(`Cannot patch non-existent document "${id}"`);
      }

      const changes = Atomizer.atomize<Partial<T>>(data, getTimestamp());
      const merged = mergeDocs(current, changes);
      const plain = createReadLens(merged);
      validate(plain);
      collection[id] = merged;
      onMutate?.();
    },
    remove(id) {
      getTombstones()[id] = getTimestamp();
      delete getCollection()[id];
      onMutate?.();
    },
  };
}
