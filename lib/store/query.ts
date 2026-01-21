import type { DocumentId } from "../core";
import type { Document } from "../core/document";
import type { AnyObject, CollectionConfig, StoreConfig } from "./schema";
import type { Tombstones } from "../core/tombstone";
import type { ReadHandles } from "./transaction";
import type { StoreChangeEvent } from "./store";
import {
  createReadHandle,
  getCollectionDocuments,
  createHandleProxy,
  type HandleCache,
} from "./handles";

export type QueryObject<R> = {
  result(): R;
  subscribe(callback: (results: R) => void): () => void;
};

type ActiveQuery<R> = {
  callback: (handles: ReadHandles<any>) => R;
  dependencies: Set<string>;
  subscribers: Set<(results: R) => void>;
  lastResult: R | undefined;
  execute: () => R;
  onStoreChange: (event: StoreChangeEvent<any>) => void;
};

export type QueryDependencies<_T extends StoreConfig> = {
  configs: Map<string, CollectionConfig<AnyObject>>;
  documents: Record<string, Record<DocumentId, Document>>;
  tombstones: Tombstones;
};

type QueryState = {
  accessed: Set<string>;
  documents: Record<string, Record<DocumentId, Document>>;
  handleCache: HandleCache;
};

function initializeQueryCollection(
  collectionName: string,
  state: QueryState,
  dependencies: Set<string>,
  deps: QueryDependencies<any>,
): void {
  state.accessed.add(collectionName);
  dependencies.add(collectionName);

  const documents = getCollectionDocuments(collectionName, deps.documents);
  state.documents[collectionName] = documents;
  state.handleCache[collectionName] = createReadHandle(documents, deps.tombstones);
}

export function createQuery<T extends StoreConfig, R>(
  callback: (handles: ReadHandles<T>) => R,
  deps: QueryDependencies<T>,
  onChange: (listener: (event: StoreChangeEvent<T>) => void) => () => void,
): QueryObject<R> {
  const dependencies = new Set<string>();
  const subscribers = new Set<(results: R) => void>();
  let lastResult: R | undefined = undefined;
  let unsubscribeListener: (() => void) | null = null;

  const executeQuery = (): R => {
    dependencies.clear();

    const state: QueryState = {
      accessed: new Set<string>(),
      documents: {},
      handleCache: {},
    };

    const handles = createHandleProxy<ReadHandles<T>>(
      deps.configs,
      state.accessed,
      state.handleCache,
      (collectionName) => initializeQueryCollection(collectionName, state, dependencies, deps),
    );
    return callback(handles);
  };

  const onStoreChange = (event: StoreChangeEvent<T>): void => {
    const changed = getChangedCollections(event);

    if (changed.size > 0 && hasDependencyChanged(dependencies, changed) && subscribers.size > 0) {
      const result = executeQuery();
      notifySubscribers(query, result);
    }
  };

  const query: ActiveQuery<R> = {
    callback,
    dependencies,
    subscribers,
    lastResult,
    execute: executeQuery,
    onStoreChange,
  };

  return {
    result(): R {
      const result = query.execute();
      query.lastResult = result;
      return result;
    },

    subscribe(callback: (results: R) => void): () => void {
      subscribers.add(callback);

      if (unsubscribeListener === null) {
        unsubscribeListener = onChange(query.onStoreChange);
      }

      const initialResult = query.execute();
      query.lastResult = initialResult;
      callback(initialResult);

      return () => {
        subscribers.delete(callback);
        if (subscribers.size === 0 && unsubscribeListener !== null) {
          unsubscribeListener();
          unsubscribeListener = null;
        }
      };
    },
  };
}

function getChangedCollections<T extends StoreConfig>(event: StoreChangeEvent<T>): Set<string> {
  const changed = new Set<string>();
  for (const key in event) {
    if (event[key]) {
      changed.add(key);
    }
  }
  return changed;
}

function hasDependencyChanged(dependencies: Set<string>, changedCollections: Set<string>): boolean {
  for (const dependency of dependencies) {
    if (changedCollections.has(dependency)) {
      return true;
    }
  }
  return false;
}

function notifySubscribers<R>(query: ActiveQuery<R>, result: R): void {
  query.lastResult = result;
  query.subscribers.forEach((subscriber) => subscriber(result));
}
