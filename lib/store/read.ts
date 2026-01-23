import {
  parseDocument,
  type Document,
  type DocumentId,
  type StoreState,
  type Tombstones,
} from "../core";
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
  documents: Record<DocumentId, Document>,
  tombstones: Tombstones,
): ReadHandle<C> {
  return {
    get(id) {
      if (isDeleted(id, tombstones)) return undefined;
      const document = documents[id];
      if (!document) return undefined;
      return parseDocument<Output<C["schema"]>>(document);
    },

    list() {
      const results: Output<C["schema"]>[] = [];
      for (const [id, document] of Object.entries(documents)) {
        if (document && !isDeleted(id, tombstones)) {
          results.push(parseDocument<Output<C["schema"]>>(document));
        }
      }
      return results;
    },
  };
}

export function createReadHandles<T extends StoreConfig>(
  deps: ReadDependencies,
): ReadHandles<T> {
  const handles = {} as ReadHandles<T>;

  for (const [collectionName] of deps.configs) {
    const documents = deps.state.collections[collectionName] ?? {};
    Object.assign(handles, { [collectionName]: createReadHandle(documents, deps.state.tombstones) });
  }

  return handles;
}
