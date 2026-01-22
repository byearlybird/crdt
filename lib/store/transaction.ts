import { validate } from "./schema";
import { makeDocument, parseDocument, mergeDocuments, type DocumentId } from "../core";
import type { Input, AnyObject, CollectionConfig, StoreConfig, CollectionName } from "./schema";
import type { Tombstones, Document } from "../core";
import type { StoreChangeEvent } from "./store";
import { createReadHandle, type ReadHandle } from "./read";

export type TransactionHandle<T extends CollectionConfig<AnyObject>> = ReadHandle<T> & {
  add(data: Input<T["schema"]>): void;
  update(id: DocumentId, data: Partial<Input<T["schema"]>>): void;
  remove(id: DocumentId): void;
};

export type TransactionHandles<T extends StoreConfig> = {
  [N in CollectionName<T>]: TransactionHandle<T[N]>;
};

function createTransactionHandle<C extends CollectionConfig<AnyObject>>(
  config: C,
  documents: Record<DocumentId, Document>,
  tombstones: Tombstones,
  getTimestamp: () => string,
  markChanged: () => void,
): TransactionHandle<C> {
  const readHandle = createReadHandle<C>(documents, tombstones);

  return {
    ...readHandle,

    add(data) {
      const validated = validate(config.schema, data);
      const id = validated[config.keyPath] as DocumentId;
      const document = makeDocument(validated, getTimestamp());
      documents[id] = document;
      markChanged();
    },

    update(id, data) {
      const current = documents[id];
      if (!current) return;

      const changes = makeDocument(data, getTimestamp());
      const merged = mergeDocuments(current, changes);
      const parsed = parseDocument(merged);
      validate(config.schema, parsed);

      documents[id] = merged;
      markChanged();
    },

    remove(id) {
      tombstones[id] = getTimestamp();
      delete documents[id];
      markChanged();
    },
  };
}

export type TransactionDependencies = {
  configs: Map<string, CollectionConfig<AnyObject>>;
  documents: Record<string, Record<DocumentId, Document>>;
  tombstones: Tombstones;
  tick: () => string;
};

export type TransactionChanges<T extends StoreConfig> = {
  documents: Record<string, Record<DocumentId, Document>>;
  tombstones: Tombstones;
  event: StoreChangeEvent<T>;
};

export type TransactionResult<T extends StoreConfig, R> = {
  value: R;
  changes: TransactionChanges<T> | null;
};

export function executeTransaction<T extends StoreConfig, R>(
  callback: (handles: TransactionHandles<T>) => R,
  deps: TransactionDependencies,
): TransactionResult<T, R> {
  const documents: Record<string, Record<DocumentId, Document>> = {};
  const tombstones: Tombstones = { ...deps.tombstones };
  const changed = new Set<string>();

  const handles = createHandleProxy<TransactionHandles<T>>(
    deps.configs,
    (collectionName, target) => {
      // Copy-on-write: isolate collection documents for transaction
      documents[collectionName] = { ...deps.documents[collectionName]! };
      const config = deps.configs.get(collectionName)!;

      target[collectionName] = createTransactionHandle(
        config,
        documents[collectionName]!,// hidden mutation, maybe handke through callbacks
        tombstones,
        deps.tick,
        () => changed.add(collectionName),
      );
    },
  );

  const value = callback(handles);

  // Build changes only if something was modified
  if (changed.size === 0) {
    return { value, changes: null };
  }

  const event: StoreChangeEvent<T> = {};
  const changedDocuments: Record<string, Record<DocumentId, Document>> = {};
  for (const collectionName of changed) {
    event[collectionName as keyof T] = true;
    changedDocuments[collectionName] = documents[collectionName]!;
  }

  return {
    value,
    changes: {
      documents: changedDocuments,
      tombstones,
      event,
    },
  };
}

/**
 * Creates a Proxy that lazily initializes collection handles on first access.
 * Used by transactions.
 */
function createHandleProxy<T>(
  configs: Map<string, CollectionConfig<AnyObject>>,
  onAccess: (collectionName: string, target: any) => void,
): T {
  const target = {} as any;
  return new Proxy(target, {
    get(target, prop: string | symbol) {
      if (typeof prop !== "string") {
        return undefined;
      }

      if (!configs.has(prop)) {
        throw new Error(`Collection "${prop}" not found`);
      }

      if (!(prop in target)) {
        onAccess(prop, target);
      }

      return target[prop];
    },
  });
}
