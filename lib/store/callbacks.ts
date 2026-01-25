import {
  mergeCollections,
  mergeTombstones,
  type Document,
  type DocumentId,
  type StoreState,
} from "../core";
import type { CollectionName, StoreConfig } from "./schema";
import type { StoreChangeEvent } from "./types";
import { createChangeEvent, notifyListeners } from "./events";
import type { WriteCallbacks } from "./write";

export function createBuildCallbacks<T extends StoreConfig>(deps: {
  state: StoreState;
  listeners: Set<(event: StoreChangeEvent<T>) => void>;
}): (collectionName: CollectionName<T>) => WriteCallbacks {
  const { state, listeners } = deps;

  return (collectionName: CollectionName<T>) => ({
    onAdd(id: DocumentId, document: Document) {
      const updated = { [id]: document };
      state.collections[collectionName] = mergeCollections(
        state.collections[collectionName] ?? {},
        updated,
        state.tombstones,
      );
      notifyListeners(createChangeEvent(collectionName), listeners);
    },
    onUpdate(id: DocumentId, document: Document) {
      const updated = { [id]: document };
      state.collections[collectionName] = mergeCollections(
        state.collections[collectionName] ?? {},
        updated,
        state.tombstones,
      );
      notifyListeners(createChangeEvent(collectionName), listeners);
    },
    onRemove(id: DocumentId, tombstoneStamp: string) {
      state.tombstones = mergeTombstones(state.tombstones, { [id]: tombstoneStamp });
      state.collections[collectionName] = mergeCollections(
        state.collections[collectionName] ?? {},
        {},
        state.tombstones,
      );
      notifyListeners(createChangeEvent(collectionName), listeners);
    },
  });
}
