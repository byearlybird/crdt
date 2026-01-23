import type { AnyObject, CollectionConfig, CollectionName, Input, StoreConfig } from "./schema";
import { validate } from "./schema";
import {
  type Document,
  type DocumentId,
  makeDocument,
  mergeDocuments,
  parseDocument,
  type StoreState,
} from "../core";

type DeepPartial<T> = T extends object ? { [P in keyof T]?: DeepPartial<T[P]> } : T;

export type WriteHandle<T extends CollectionConfig<AnyObject>> = {
  add(data: Input<T["schema"]>): void;
  update(id: DocumentId, data: DeepPartial<Input<T["schema"]>>): void;
  remove(id: DocumentId): void;
};

export type WriteCallbacks = {
  onAdd: (id: DocumentId, document: Document) => void;
  onUpdate: (id: DocumentId, document: Document) => void;
  onRemove: (id: DocumentId, tombstoneStamp: string) => void;
};

export type WriteDependencies<C extends CollectionConfig<AnyObject>> = {
  config: C;
  documents: () => Record<DocumentId, Document>;
  getTimestamp: () => string;
  callbacks: WriteCallbacks;
};

export function createWriteHandle<C extends CollectionConfig<AnyObject>>(
  deps: WriteDependencies<C>,
): WriteHandle<C> {
  return {
    add(data) {
      const validated = validate(deps.config.schema, data);
      const id = validated[deps.config.keyPath] as DocumentId;
      const document = makeDocument(validated, deps.getTimestamp());

      deps.callbacks.onAdd(id, document);
    },

    update(id, data) {
      const documents = deps.documents();
      const current = documents[id];
      if (!current) return;

      const changes = makeDocument(data, deps.getTimestamp());
      const merged = mergeDocuments(current, changes);
      const parsed = parseDocument(merged);
      validate(deps.config.schema, parsed);

      deps.callbacks.onUpdate(id, merged);
    },

    remove(id) {
      const tombstoneStamp = deps.getTimestamp();

      deps.callbacks.onRemove(id, tombstoneStamp);
    },
  };
}

export type WriteHandles<T extends StoreConfig> = {
  [N in CollectionName<T>]: WriteHandle<T[N]>;
};

export type WriteHandlesDependencies<T extends StoreConfig = StoreConfig> = {
  configs: Map<string, CollectionConfig<AnyObject>>;
  state: StoreState;
  tick: () => string;
  buildCallbacks: (collectionName: CollectionName<T>) => WriteCallbacks;
};

export function createWriteHandles<T extends StoreConfig>(
  deps: WriteHandlesDependencies<T>,
): WriteHandles<T> {
  const handles = {} as WriteHandles<T>;

  for (const [collectionName] of deps.configs) {
    const config = deps.configs.get(collectionName)!;
    const callbacks = deps.buildCallbacks(collectionName as CollectionName<T>);

    Object.assign(handles, {
      [collectionName]: createWriteHandle({
        config,
        documents: () => deps.state.collections[collectionName] ?? {},
        getTimestamp: deps.tick,
        callbacks,
      }),
    });
  }

  return handles;
}
