import {
  advanceClock,
  makeStamp,
  type CollectionState,
  type StoreState,
} from "../core";
import { createEmitter } from "../emitter";
import { createHandle, type Handle } from "./collection-handle";
import type { CollectionName, DocType, IdType, StoreConfig } from "./schema";
import { validate } from "./schema";
import type { StoreChangeEvent } from "./types";
import { mergeState, hasRelevantChange, validateCollectionNames } from "./store-utils";

export type StoreAPI<T extends StoreConfig> = {
  subscribe: {
    (callback: (event: StoreChangeEvent<T>) => void): () => void;
    <K extends (keyof T & string)[]>(
      collections: [...K],
      callback: (event: StoreChangeEvent<T>) => void,
    ): () => void;
  };
  getState(): StoreState;
  merge(snapshot: StoreState): StoreChangeEvent<T>;
  transact<K extends (keyof T & string)[], R>(
    collections: [...K],
    callback: (tx: Pick<StoreAPI<T>, K[number]>) => R,
  ): R;
} & {
  [N in CollectionName<T>]: Handle<DocType<T[N]>, IdType<T[N]>>;
};

export function createStore<T extends StoreConfig>(config: T): StoreAPI<T> {
  const emitter = createEmitter<StoreChangeEvent<T>>();

  const state: StoreState = {
    clock: { ms: Date.now(), seq: 0 },
    collections: {},
  };

  const getNextStamp = () => {
    state.clock = advanceClock(state.clock, { ms: Date.now(), seq: 0 });
    return makeStamp(state.clock.ms, state.clock.seq);
  };

  const collectionHandles = {} as {
    [N in CollectionName<T>]: Handle<DocType<T[N]>, IdType<T[N]>>;
  };

  for (const collectionName of Object.keys(config) as CollectionName<T>[]) {
    state.collections[collectionName] = {
      documents: {},
      tombstones: {},
    };
    const collectionConfig = config[collectionName];
    if (!collectionConfig) {
      throw new Error(`Collection config not found for "${collectionName}"`);
    }
    collectionHandles[collectionName] = createHandle({
      getCollection: () => state.collections[collectionName]?.documents ?? {},
      getTombstones: () => state.collections[collectionName]?.tombstones ?? {},
      getTimestamp: getNextStamp,
      validate: (data: unknown) =>
        validate(collectionConfig.schema, data as Record<string, unknown>),
      getId: (data: DocType<T[typeof collectionName]>) => collectionConfig.getId(data),
      onMutate: () => emitter.emit({ [collectionName]: true } as StoreChangeEvent<T>),
    });
  }

  return {
    ...collectionHandles,
    subscribe(
      collectionsOrCallback: string[] | ((event: StoreChangeEvent<T>) => void),
      maybeCallback?: (event: StoreChangeEvent<T>) => void,
    ) {
      if (typeof collectionsOrCallback === "function") {
        return emitter.subscribe(collectionsOrCallback);
      }

      const collections = collectionsOrCallback as (keyof T & string)[];
      const callback = maybeCallback!;
      validateCollectionNames(collections, config);

      return emitter.subscribe((event) => {
        if (hasRelevantChange(event, collections)) {
          callback(event);
        }
      });
    },
    getState() {
      return { ...state };
    },
    merge(snapshot) {
      const diff = mergeState(state, snapshot) as StoreChangeEvent<T>;
      emitter.emit(diff);
      return diff;
    },
    transact<K extends (keyof T & string)[], R>(
      collections: [...K],
      callback: (tx: Pick<StoreAPI<T>, K[number]>) => R,
    ): R {
      validateCollectionNames(collections, config);

      // 1. Create event object upfront (will be populated by onMutate)
      const event = {} as StoreChangeEvent<T>;

      // 2. Clone relevant collection states
      const clonedStates: Record<string, CollectionState> = {};
      for (const name of collections) {
        const original = state.collections[name]!;
        clonedStates[name] = {
          documents: structuredClone(original.documents),
          tombstones: structuredClone(original.tombstones),
        };
      }

      // 3. Create transaction-scoped handles
      const txHandles: Record<string, Handle<any, any>> = {};
      for (const name of collections) {
        const collectionConfig = config[name]!;
        txHandles[name] = createHandle({
          getCollection: () => clonedStates[name]!.documents,
          getTombstones: () => clonedStates[name]!.tombstones,
          getTimestamp: getNextStamp,
          validate: (data: unknown) =>
            validate(collectionConfig.schema, data as Record<string, unknown>),
          getId: (data: DocType<T[typeof name]>) => collectionConfig.getId(data),
          onMutate: () => {
            (event as Record<string, true>)[name] = true;
          },
        });
      }

      // 4. Execute callback
      const result = callback(txHandles as Pick<StoreAPI<T>, K[number]>);

      // 5. Commit: swap cloned state back into real state
      for (const name of collections) {
        state.collections[name] = clonedStates[name]!;
      }

      // 6. Emit event (only includes collections that were actually mutated)
      if (Object.keys(event).length > 0) {
        emitter.emit(event);
      }

      return result;
    },
  } as StoreAPI<T>;
}
