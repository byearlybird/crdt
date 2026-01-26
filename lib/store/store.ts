import {
  advanceClock,
  makeStamp,
  type Collection,
  type StoreState,
  type Tombstones,
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
  } as StoreAPI<T>;
}
