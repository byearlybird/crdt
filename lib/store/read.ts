import type { Document, DocumentId, StoreState, Tombstones } from "../core";
import { createReadLens } from "../core";
import { isDeleted } from "./utils";
import type { AnyObject, CollectionConfig, CollectionName, Output, StoreConfig } from "./schema";

export type ReadHandle<T extends CollectionConfig<AnyObject>> = {
  get(id: DocumentId): Output<T["schema"]> | undefined;
  list(): Output<T["schema"]>[];
};

export type ReadHandles<T extends StoreConfig> = {
  [N in CollectionName<T>]: ReadHandle<T[N]>;
};

export type ReadDependencies = {
  configs: Map<string, CollectionConfig<AnyObject>>;
  state: StoreState;
};

export function createReadHandle<C extends CollectionConfig<AnyObject>>(
  getDocuments: (() => Record<DocumentId, Document>) | Record<DocumentId, Document>,
  getTombstones: (() => Tombstones) | Tombstones,
): ReadHandle<C> {
  const documentsFn = typeof getDocuments === "function" ? getDocuments : () => getDocuments;
  const tombstonesFn = typeof getTombstones === "function" ? getTombstones : () => getTombstones;

  return {
    get(id) {
      const tombstones = tombstonesFn();
      if (isDeleted(id, tombstones)) return undefined;
      const documents = documentsFn();
      const document = documents[id];
      if (!document) return undefined;
      return createReadLens<Output<C["schema"]>>(document);
    },

    list() {
      const documents = documentsFn();
      const tombstones = tombstonesFn();
      const results: Output<C["schema"]>[] = [];
      for (const [id, document] of Object.entries(documents)) {
        if (document && !isDeleted(id, tombstones)) {
          results.push(createReadLens<Output<C["schema"]>>(document));
        }
      }
      return results;
    },
  };
}

export function createReadHandles<T extends StoreConfig>(deps: ReadDependencies): ReadHandles<T> {
  const handles = {} as ReadHandles<T>;

  for (const [collectionName] of deps.configs) {
    Object.assign(handles, {
      [collectionName]: createReadHandle(
        () => deps.state.collections[collectionName] ?? {},
        () => deps.state.tombstones,
      ),
    });
  }

  return handles;
}
