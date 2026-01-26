import {
  Atomizer,
  createReadLens,
  isDeleted,
  mergeDocs,
  type Collection,
  type DocumentId,
  type Tombstones,
} from "../core";

export type Handle<T> = {
  get(id: DocumentId): T | undefined;
  list(): T[];
  add(data: T): void;
  update(id: DocumentId, data: Partial<T>): void;
  remove(id: DocumentId): void;
};

export type HandleDependencies<T extends object> = {
  getCollection: () => Collection<T>;
  getTombstones: () => Tombstones;
  getTimestamp: () => string;
  validate: (data: unknown) => T;
  getId: (data: T) => string;
  onMutate?: () => void;
};

export function createHandle<T extends Record<string, unknown>>(
  deps: HandleDependencies<T>,
): Handle<T> {
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
    add(data) {
      const validated = validate(data);
      const id = getId(validated);
      getCollection()[id] = Atomizer.atomize<T>(validated, getTimestamp());
      onMutate?.();
    },
    update(id, data) {
      const collection = getCollection();
      const current = collection[id];
      if (!current) return;

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
