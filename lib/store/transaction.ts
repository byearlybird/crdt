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

function isDeleted(id: DocumentId, tombstones: Tombstones): boolean {
  return tombstones[id] !== undefined;
}

function createReadHandle<C extends CollectionConfig<AnyObject>>(
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
  notifyListeners: (event: StoreChangeEvent<T>) => void;
  applyMerge: (collectionName: string, documents: Record<DocumentId, Document>) => void;
  applyTombstones: (tombstones: Tombstones) => void;
};

type TransactionState = {
  accessed: Set<string>;
  documents: Record<string, Record<DocumentId, Document>>;
  tombstones: Tombstones;
  changed: Set<string>;
  handleCache: Record<string, any>;
};

function getCollectionConfig(
  collectionName: string,
  configs: Map<string, CollectionConfig<AnyObject>>,
): CollectionConfig<AnyObject> {
  const config = configs.get(collectionName);
  if (!config) {
    throw new Error(`Collection "${collectionName}" not found`);
  }
  return config;
}

function getCollectionDocuments(
  collectionName: string,
  documents: Record<string, Record<DocumentId, Document>>,
): Record<DocumentId, Document> {
  const collectionDocs = documents[collectionName];
  if (!collectionDocs) {
    throw new Error(`Collection "${collectionName}" not found`);
  }
  return collectionDocs;
}

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

function createHandleProxy<T extends StoreConfig, Mode extends "read" | "mutate">(
  state: TransactionState,
  deps: TransactionDependencies<T>,
  isReadOnly: boolean,
): Mode extends "read" ? ReadHandles<T> : MutateHandles<T> {
  return new Proxy({} as Mode extends "read" ? ReadHandles<T> : MutateHandles<T>, {
    get(_target, prop: string | symbol) {
      if (typeof prop !== "string") {
        return undefined;
      }

      if (!deps.configs.has(prop)) {
        throw new Error(`Collection "${prop}" not found`);
      }

      if (!state.accessed.has(prop)) {
        initializeCollection(prop, state, deps, isReadOnly);
      }

      return state.handleCache[prop];
    },
  });
}

function commitTransaction<T extends StoreConfig>(
  state: TransactionState,
  deps: TransactionDependencies<T>,
): void {
  deps.applyTombstones(state.tombstones);

  for (const collectionName of state.accessed) {
    deps.applyMerge(collectionName, state.documents[collectionName]!);
  }

  if (state.changed.size === 0) {
    return;
  }

  const event: StoreChangeEvent<T> = {};
  for (const collectionName of state.changed) {
    event[collectionName as keyof T] = true;
  }
  deps.notifyListeners(event);
}

export function executeTransaction<
  T extends StoreConfig,
  R,
  Mode extends "read" | "mutate" = "mutate",
>(
  mode: Mode,
  callback: (handles: Mode extends "read" ? ReadHandles<T> : MutateHandles<T>) => R,
  deps: TransactionDependencies<T>,
): R {
  const isReadOnly = mode === "read";

  const state: TransactionState = {
    accessed: new Set<string>(),
    documents: {},
    tombstones: isReadOnly ? deps.tombstones : { ...deps.tombstones },
    changed: new Set<string>(),
    handleCache: {},
  };

  const handles = createHandleProxy<T, Mode>(state, deps, isReadOnly);
  const result = callback(handles);

  if (!isReadOnly) {
    commitTransaction(state, deps);
  }

  return result;
}
