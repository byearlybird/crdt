import { parseDocument, type DocumentId } from "../core";
import type { Document } from "../core/document";
import type { AnyObject, CollectionConfig } from "./schema";
import type { Tombstones } from "../core/tombstone";
import type { ReadHandles } from "./transaction";

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

export type QueryDependencies<T extends Record<string, CollectionConfig<AnyObject>>> = {
  configs: Map<string, CollectionConfig<AnyObject>>;
  documents: Record<string, Record<DocumentId, Document>>;
  tombstones: Tombstones;
};

// Helper to check if two values are deeply equal
function deepEqual(a: any, b: any): boolean {
  if (a === b) return true;
  if (a == null || b == null) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  if (Array.isArray(a) !== Array.isArray(b)) return false;

  if (Array.isArray(a)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }

  const keysA = Object.keys(a);
  const keysB = Object.keys(b);
  if (keysA.length !== keysB.length) return false;

  for (const key of keysA) {
    if (!keysB.includes(key)) return false;
    if (!deepEqual(a[key], b[key])) return false;
  }
  return true;
}

// Helper function to create read handle
function createReadHandle(
  txDocs: Record<DocumentId, Document>,
  txTombstones: Tombstones,
) {
  return {
    get(id: DocumentId) {
      if (txTombstones[id]) return undefined;
      const doc = txDocs[id];
      if (!doc) return undefined;
      return parseDocument(doc);
    },
    list(options?: { where?: (item: any) => boolean }) {
      const resultDocs: any[] = [];
      for (const [id, doc] of Object.entries(txDocs)) {
        if (doc && !txTombstones[id]) {
          const parsed = parseDocument(doc);
          if (!options?.where || options.where(parsed)) {
            resultDocs.push(parsed);
          }
        }
      }
      return resultDocs;
    },
  };
}

export function createQuery<
  T extends Record<string, CollectionConfig<AnyObject>>,
  R,
>(
  callback: (handles: ReadHandles<T>) => R,
  deps: QueryDependencies<T>,
  queryManager: QueryManager,
): QueryObject<R> {
  // Track dependencies for this query
  const dependencies = new Set<string>();
  const subscribers = new Set<(results: R) => void>();
  let lastResult: R | undefined = undefined;

  // Create a custom transaction execution that tracks dependencies
  const executeQuery = (): R => {
    // Reset dependencies for this execution
    dependencies.clear();

    // Create a custom proxy that tracks collection access
    const accessedCollections = new Set<string>();
    const txDocuments: Record<string, Record<DocumentId, Document>> = {};
    const handleCache: Record<string, any> = {};

    const initializeCollection = (collectionName: string): void => {
      if (accessedCollections.has(collectionName)) {
        return;
      }

      accessedCollections.add(collectionName);
      dependencies.add(collectionName); // Track as dependency

      const collectionDocs = deps.documents[collectionName];
      if (!collectionDocs) {
        throw new Error(`Collection "${collectionName}" not found`);
      }

      // Use original documents (no copy for read-only)
      txDocuments[collectionName] = collectionDocs;

      const collectionConfig = deps.configs.get(collectionName);
      if (!collectionConfig) {
        throw new Error(`Collection "${collectionName}" not found`);
      }

      const txDocs = txDocuments[collectionName]!;
      handleCache[collectionName] = createReadHandle(txDocs, deps.tombstones);
    };

    // Create proxy that intercepts property access
    const proxy = new Proxy({} as ReadHandles<T>, {
      get(_target, prop: string | symbol) {
        if (typeof prop !== "string") {
          return undefined;
        }

        if (!deps.configs.has(prop)) {
          throw new Error(`Collection "${prop}" not found`);
        }

        if (!accessedCollections.has(prop)) {
          initializeCollection(prop);
        }

        return handleCache[prop];
      },
    });

    // Execute callback and return result
    return callback(proxy);
  };

  // Create the query object
  const query: ActiveQuery<R> = {
    callback,
    dependencies,
    subscribers,
    lastResult,
    execute: executeQuery,
  };

  // Create the QueryObject with result() and subscribe() methods
  const queryObject: QueryObject<R> = {
    result(): R {
      const result = query.execute();
      query.lastResult = result;
      return result;
    },

    subscribe(callback: (results: R) => void): () => void {
      subscribers.add(callback);

      // Add query to active queries if not already there
      queryManager.addQuery(query);

      // Execute immediately to get initial result
      const initialResult = query.execute();
      query.lastResult = initialResult;
      callback(initialResult);

      // Return unsubscribe function
      return () => {
        subscribers.delete(callback);
        // Remove query from active queries if no subscribers
        if (subscribers.size === 0) {
          queryManager.removeQuery(query);
        }
      };
    },
  };

  return queryObject;
}

// QueryManager handles tracking and re-executing active queries
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
      // Check if any dependency was changed
      let shouldReexecute = false;
      for (const dep of query.dependencies) {
        if (changedCollections.has(dep)) {
          shouldReexecute = true;
          break;
        }
      }

      if (shouldReexecute && query.subscribers.size > 0) {
        const newResult = query.execute();
        // Only notify if result actually changed
        if (!deepEqual(query.lastResult, newResult)) {
          query.lastResult = newResult;
          query.subscribers.forEach((subscriber) => subscriber(newResult));
        }
      }
    }
  }
}
