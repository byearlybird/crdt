import type { StoreState } from "../core";
import type { AnyObject, CollectionConfig, StoreConfig } from "./schema";
import type { ReadHandles } from "./read";
import type { StoreChangeEvent } from "./store";
import { createReadHandle } from "./read";
import { createHandleProxy } from "./utils";

export type QueryDependencies<T extends StoreConfig> = {
  configs: Map<string, CollectionConfig<AnyObject>>;
  state: StoreState;
  subscribe: (listener: (event: StoreChangeEvent<T>) => void) => () => void;
};

/**
 * Executes a reactive query that tracks collection dependencies and re-runs
 * when those collections change.
 *
 * Unlike transactions, queries:
 * - Do NOT copy documents (reads directly from state)
 * - Do NOT support writes
 * - DO track dependencies and re-run on changes
 *
 * @param selector - Function that reads from collections and returns a computed value
 * @param callback - Called immediately with initial value, then on each relevant change
 * @param deps - Query dependencies (configs, state, subscribe)
 * @returns Unsubscribe function to stop listening for changes
 */
export function executeQuery<T extends StoreConfig, R>(
  selector: (handles: ReadHandles<T>) => R,
  callback: (value: R) => void,
  deps: QueryDependencies<T>,
): () => void {
  const accessedCollections = new Set<string>();

  const runQuery = () => {
    // Clear and re-track on each run (handles conditional access patterns)
    accessedCollections.clear();

    const handles = createHandleProxy<ReadHandles<T>>(deps.configs, (collectionName, target) => {
      // Track this collection as a dependency
      accessedCollections.add(collectionName);

      // Create read handle pointing directly to state (no copying)
      target[collectionName] = createReadHandle(
        () => deps.state.collections[collectionName] ?? {},
        () => deps.state.tombstones,
      );
    });

    return selector(handles);
  };

  // Invoke callback immediately with initial value
  callback(runQuery());

  // Subscribe to store changes
  const unsubscribe = deps.subscribe((event) => {
    // Check if any tracked collection changed
    const hasRelevantChange = [...accessedCollections].some((name) => event[name as keyof T]);

    if (hasRelevantChange) {
      callback(runQuery());
    }
  });

  return unsubscribe;
}
