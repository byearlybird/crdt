import {
  createReadLens,
  isDeleted,
  mergeDocs,
  type Collection,
  type DocumentId,
  type Tombstones,
} from "../core";
import { atomizeDocument } from "../store/write";

export type Handle<T> = {
  get(id: DocumentId): T | undefined;
  list(): T[];
  add(data: T): void;
  update(id: DocumentId, data: Partial<T>): void;
  remove(id: DocumentId): void;
};

export function createHandle<T extends Record<string, unknown>>(
  collection: Collection<T>,
  tombstones: Tombstones,
  getTimestamp: () => string,
  validate: (data: unknown) => T,
  getId: (data: T) => string,
): Handle<T> {
  return {
    get(id) {
      if (isDeleted(id, tombstones)) return undefined;
      const current = collection[id];
      if (!current) return undefined;
      return createReadLens<T>(current);
    },
    list() {
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
      const id = getId(data);
      collection[id] = atomizeDocument<T>(validated, getTimestamp());
    },
    update(id, data) {
      const current = collection[id];
      if (!current) return;

      const changes = atomizeDocument<Partial<T>>(data, getTimestamp());
      const merged = mergeDocs(current, changes);
      // Use createReadLens to get plain object for validation
      const plain = createReadLens(merged);
      validate(plain);
      collection[id] = merged;
    },
    remove(id) {
      tombstones[id] = getTimestamp();
      delete collection[id];
    },
  };
}
