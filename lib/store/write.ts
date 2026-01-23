import { validate } from "./schema";
import { makeDocument, parseDocument, mergeDocuments, type DocumentId } from "../core";
import type { Document } from "../core/document";
import type { Input, AnyObject, CollectionConfig } from "./schema";

export type WriteHandle<T extends CollectionConfig<AnyObject>> = {
  add(data: Input<T["schema"]>): void;
  update(id: DocumentId, data: Partial<Input<T["schema"]>>): void;
  remove(id: DocumentId): void;
};

export type WriteCallbacks = {
  onAdd: (id: DocumentId, document: Document) => void;
  onUpdate: (id: DocumentId, document: Document) => void;
  onRemove: (id: DocumentId, tombstoneStamp: string) => void;
};

export type WriteDependencies<C extends CollectionConfig<AnyObject>> = {
  config: C;
  documents: Record<DocumentId, Document>;
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
      const current = deps.documents[id];
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
