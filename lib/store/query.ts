import type { DocumentId } from "../core";
import type { Document } from "../core/document";
import type { AnyObject, CollectionConfig, StoreConfig } from "./schema";
import type { Tombstones } from "../core/tombstone";
import type { ReadHandles } from "./transaction";
import { createReadHandle, getCollectionDocuments } from "./handles";

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
};

export type QueryDependencies<T extends StoreConfig> = {
  configs: Map<string, CollectionConfig<AnyObject>>;
  documents: Record<string, Record<DocumentId, Document>>;
  tombstones: Tombstones;
};

type QueryState = {
  accessed: Set<string>;
  documents: Record<string, Record<DocumentId, Document>>;
  handleCache: Record<string, any>;
};

function initializeCollection(
  collectionName: string,
  state: QueryState,
  dependencies: Set<string>,
  deps: QueryDependencies<any>,
): void {
  if (state.accessed.has(collectionName)) {
    return;
  }

  state.accessed.add(collectionName);
  dependencies.add(collectionName);

  const documents = getCollectionDocuments(collectionName, deps.documents);
  state.documents[collectionName] = documents;

  state.handleCache[collectionName] = createReadHandle(documents, deps.tombstones);
}

function createHandleProxy<T extends StoreConfig>(
  state: QueryState,
  dependencies: Set<string>,
  deps: QueryDependencies<T>,
): ReadHandles<T> {
  return new Proxy({} as ReadHandles<T>, {
    get(_target, prop: string | symbol) {
      if (typeof prop !== "string") {
        return undefined;
      }

      if (!deps.configs.has(prop)) {
        throw new Error(`Collection "${prop}" not found`);
      }

      if (!state.accessed.has(prop)) {
        initializeCollection(prop, state, dependencies, deps);
      }

      return state.handleCache[prop];
    },
  });
}

export function createQuery<T extends StoreConfig, R>(
  callback: (handles: ReadHandles<T>) => R,
  deps: QueryDependencies<T>,
  queryManager: QueryManager,
): QueryObject<R> {
  const dependencies = new Set<string>();
  const subscribers = new Set<(results: R) => void>();
  let lastResult: R | undefined = undefined;

  const executeQuery = (): R => {
    dependencies.clear();

    const state: QueryState = {
      accessed: new Set<string>(),
      documents: {},
      handleCache: {},
    };

    const handles = createHandleProxy(state, dependencies, deps);
    return callback(handles);
  };

  const query: ActiveQuery<R> = {
    callback,
    dependencies,
    subscribers,
    lastResult,
    execute: executeQuery,
  };

  return {
    result(): R {
      const result = query.execute();
      query.lastResult = result;
      return result;
    },

    subscribe(callback: (results: R) => void): () => void {
      subscribers.add(callback);
      queryManager.addQuery(query);

      const initialResult = query.execute();
      query.lastResult = initialResult;
      callback(initialResult);

      return () => {
        subscribers.delete(callback);
        if (subscribers.size === 0) {
          queryManager.removeQuery(query);
        }
      };
    },
  };
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

export class QueryManager {
  private activeQueries = new Set<ActiveQuery<any>>();

  addQuery<R>(query: ActiveQuery<R>): void {
    this.activeQueries.add(query);
  }

  removeQuery<R>(query: ActiveQuery<R>): void {
    this.activeQueries.delete(query);
  }

  reexecuteQueries(changedCollections: Set<string>): void {
    for (const query of this.activeQueries) {
      const hasChanges = hasDependencyChanged(query.dependencies, changedCollections);
      const hasSubscribers = query.subscribers.size > 0;

      if (hasChanges && hasSubscribers) {
        const result = query.execute();
        notifySubscribers(query, result);
      }
    }
  }
}
