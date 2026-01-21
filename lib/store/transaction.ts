import { validate } from "./schema";
import { makeDocument, parseDocument, mergeDocuments, type DocumentId } from "../core";
import type { Document } from "../core/document";
import type {
  Input,
  Output,
  AnyObject,
  CollectionConfig,
  StoreConfig,
  CollectionName,
} from "./schema";
import type { Tombstones } from "../core/tombstone";
import type { StoreChangeEvent } from "./store";
import {
  createReadHandle,
  getCollectionConfig,
  getCollectionDocuments,
  createHandleProxy,
  type HandleCache,
} from "./handles";

export type ReadHandle<T extends CollectionConfig<AnyObject>> = {
  get(id: DocumentId): Output<T["schema"]> | undefined;
  list(): Output<T["schema"]>[];
};

export type MutateHandle<T extends CollectionConfig<AnyObject>> = ReadHandle<T> & {
  add(data: Input<T["schema"]>): void;
  update(id: DocumentId, data: Partial<Input<T["schema"]>>): void;
  remove(id: DocumentId): void;
};

export type ReadHandles<T extends StoreConfig> = {
  [N in CollectionName<T>]: ReadHandle<T[N]>;
};

export type MutateHandles<T extends StoreConfig> = {
  [N in CollectionName<T>]: MutateHandle<T[N]>;
};

function createMutateHandle<C extends CollectionConfig<AnyObject>>(
  config: C,
  documents: Record<DocumentId, Document>,
  tombstones: Tombstones,
  getTimestamp: () => string,
  markChanged: () => void,
): MutateHandle<C> {
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

export type TransactionDependencies<T extends StoreConfig> = {
  configs: Map<string, CollectionConfig<AnyObject>>;
  documents: Record<string, Record<DocumentId, Document>>;
  tombstones: Tombstones;
  tick: () => string;
};

export type TransactionChanges<T extends StoreConfig> = {
  accessed: string[];
  documents: Record<string, Record<DocumentId, Document>>;
  tombstones: Tombstones;
  event: StoreChangeEvent<T>;
};

export type TransactionResult<T extends StoreConfig, R> = {
  value: R;
  changes: TransactionChanges<T> | null;
};

type TransactionState = {
  accessed: Set<string>;
  documents: Record<string, Record<DocumentId, Document>>;
  tombstones: Tombstones;
  changed: Set<string>;
  handleCache: HandleCache;
};

function initializeCollection(
  collectionName: string,
  state: TransactionState,
  deps: TransactionDependencies<any>,
  isReadOnly: boolean,
): void {
  if (state.accessed.has(collectionName)) {
    return;
  }

  state.accessed.add(collectionName);

  const sourceDocs = getCollectionDocuments(collectionName, deps.documents);
  state.documents[collectionName] = isReadOnly ? sourceDocs : { ...sourceDocs };

  const config = getCollectionConfig(collectionName, deps.configs);
  const documents = state.documents[collectionName]!;

  if (isReadOnly) {
    state.handleCache[collectionName] = createReadHandle(documents, state.tombstones);
  } else {
    state.handleCache[collectionName] = createMutateHandle(
      config,
      documents,
      state.tombstones,
      deps.tick,
      () => state.changed.add(collectionName),
    );
  }
}

function buildChanges<T extends StoreConfig>(
  state: TransactionState,
): TransactionChanges<T> | null {
  if (state.changed.size === 0) {
    return null;
  }

  const event: StoreChangeEvent<T> = {};
  for (const collectionName of state.changed) {
    event[collectionName as keyof T] = true;
  }

  return {
    accessed: Array.from(state.accessed),
    documents: state.documents,
    tombstones: state.tombstones,
    event,
  };
}

export function executeTransaction<
  T extends StoreConfig,
  R,
  Mode extends "read" | "mutate" = "mutate",
>(
  mode: Mode,
  callback: (handles: Mode extends "read" ? ReadHandles<T> : MutateHandles<T>) => R,
  deps: TransactionDependencies<T>,
): TransactionResult<T, R> {
  const isReadOnly = mode === "read";

  const state: TransactionState = {
    accessed: new Set<string>(),
    documents: {},
    tombstones: isReadOnly ? deps.tombstones : { ...deps.tombstones },
    changed: new Set<string>(),
    handleCache: {},
  };

  type Handles = Mode extends "read" ? ReadHandles<T> : MutateHandles<T>;
  const handles = createHandleProxy<Handles>(
    deps.configs,
    state.accessed,
    state.handleCache,
    (collectionName) => initializeCollection(collectionName, state, deps, isReadOnly),
  );
  const value = callback(handles);

  const changes = isReadOnly ? null : buildChanges<T>(state);

  return { value, changes };
}
