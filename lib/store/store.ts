import {
  advanceClock,
  makeStamp,
  type CollectionState,
  type StoreState,
  type Document,
  type Stamp,
} from "../core";
import { Emitter } from "../emitter";
import type { CollectionName, DocType, IdType, InputType, StoreConfig } from "./schema";
import { validate } from "./schema";
import type { StoreChangeEvent } from "./types";
import { doGet, doList, doPatch, doPut, doRemove, mergeState } from "./operations";

export type TransactionAPI<T extends StoreConfig> = {
  get<N extends CollectionName<T>>(collection: N, id: IdType<T[N]>): DocType<T[N]> | undefined;
  list<N extends CollectionName<T>>(collection: N): DocType<T[N]>[];
  put<N extends CollectionName<T>>(collection: N, data: InputType<T[N]>): DocType<T[N]>;
  patch<N extends CollectionName<T>>(
    collection: N,
    id: IdType<T[N]>,
    data: Partial<DocType<T[N]>>,
  ): DocType<T[N]>;
  remove<N extends CollectionName<T>>(collection: N, id: IdType<T[N]>): void;
};

export class Store<T extends StoreConfig> {
  #config: T;
  #emitter: Emitter<StoreChangeEvent<T>>;
  #state: StoreState;

  constructor(config: T) {
    this.#config = config;
    this.#emitter = new Emitter<StoreChangeEvent<T>>();
    this.#state = {
      clock: { ms: Date.now(), seq: 0 },
      collections: {},
    };

    // Initialize collections
    for (const collectionName of Object.keys(config) as CollectionName<T>[]) {
      this.#state.collections[collectionName] = {
        documents: {},
        tombstones: {},
      };
    }
  }

  #getNextStamp(): Stamp {
    this.#state.clock = advanceClock(this.#state.clock, { ms: Date.now(), seq: 0 });
    return makeStamp(this.#state.clock.ms, this.#state.clock.seq);
  }

  #getCollection<N extends CollectionName<T>>(collection: N): CollectionState<Document> {
    if (!(collection in this.#config)) {
      throw new Error(`Collection "${collection}" not found`);
    }
    return this.#state.collections[collection]!;
  }

  get<N extends CollectionName<T>>(collection: N, id: IdType<T[N]>): DocType<T[N]> | undefined {
    const col = this.#getCollection(collection);
    return doGet(col.documents, col.tombstones, id);
  }

  list<N extends CollectionName<T>>(collection: N): DocType<T[N]>[] {
    const col = this.#getCollection(collection);
    return doList(col.documents, col.tombstones);
  }

  put<N extends CollectionName<T>>(collection: N, data: InputType<T[N]>): DocType<T[N]> {
    const col = this.#getCollection(collection);
    const collectionConfig = this.#config[collection]!;
    const result = doPut(
      col.documents,
      col.tombstones,
      data as Document,
      this.#getNextStamp(),
      (d: unknown) => validate(collectionConfig.schema, d),
      (d: DocType<T[typeof collection]>) => collectionConfig.getId(d),
    );
    this.#emitter.emit({ [collection]: true } as StoreChangeEvent<T>);
    return result;
  }

  patch<N extends CollectionName<T>>(
    collection: N,
    id: IdType<T[N]>,
    data: Partial<DocType<T[N]>>,
  ): DocType<T[N]> {
    const col = this.#getCollection(collection);
    const collectionConfig = this.#config[collection]!;
    const result = doPatch(col.documents, id, data, this.#getNextStamp(), (d: unknown) =>
      validate(collectionConfig.schema, d),
    );
    this.#emitter.emit({ [collection]: true } as StoreChangeEvent<T>);
    return result;
  }

  remove<N extends CollectionName<T>>(collection: N, id: IdType<T[N]>): void {
    const col = this.#getCollection(collection);
    doRemove(col.documents, col.tombstones, id, this.#getNextStamp());
    this.#emitter.emit({ [collection]: true } as StoreChangeEvent<T>);
  }

  subscribe(callback: (event: StoreChangeEvent<T>) => void): () => void {
    return this.#emitter.subscribe(callback);
  }

  getState(): StoreState {
    return { ...this.#state };
  }

  merge(snapshot: StoreState): StoreChangeEvent<T> {
    const diff = mergeState(this.#state, snapshot, this.#config);
    this.#emitter.emit(diff);
    return diff;
  }

  transact<R>(callback: (tx: TransactionAPI<T>) => R): R {
    // 1. Create event object upfront (will be populated on mutations)
    const event = {} as StoreChangeEvent<T>;

    // 2. Lazy cloning map - collections cloned on first access
    const clonedStates: Record<string, CollectionState<Document>> = {};

    // 3. Helper to ensure a collection is cloned
    const ensureCloned = (name: string): CollectionState<Document> => {
      if (!(name in this.#config)) {
        throw new Error(`Collection "${name}" not found`);
      }
      if (!clonedStates[name]) {
        const original = this.#state.collections[name]!;
        clonedStates[name] = {
          documents: structuredClone(original.documents),
          tombstones: structuredClone(original.tombstones),
        };
      }
      return clonedStates[name]!;
    };

    // 4. Create transaction API object
    const tx: TransactionAPI<T> = {
      get: (collection, id) => {
        const cloned = ensureCloned(collection);
        return doGet(cloned.documents, cloned.tombstones, id);
      },
      list: (collection) => {
        const cloned = ensureCloned(collection);
        return doList(cloned.documents, cloned.tombstones);
      },
      put: (collection, data) => {
        const cloned = ensureCloned(collection);
        const collectionConfig = this.#config[collection]!;
        event[collection] = true;
        return doPut(
          cloned.documents,
          cloned.tombstones,
          data,
          this.#getNextStamp(),
          (d: unknown) => validate(collectionConfig.schema, d),
          (d: DocType<T[typeof collection]>) => collectionConfig.getId(d),
        );
      },
      patch: (collection, id, data) => {
        const cloned = ensureCloned(collection);
        const collectionConfig = this.#config[collection]!;
        event[collection] = true;
        return doPatch(
          cloned.documents,
          id,
          data as Partial<Document>,
          this.#getNextStamp(),
          (d: unknown) => validate(collectionConfig.schema, d),
        );
      },
      remove: (collection, id) => {
        const cloned = ensureCloned(collection);
        event[collection] = true;
        doRemove(cloned.documents, cloned.tombstones, id, this.#getNextStamp());
      },
    };

    // 5. Execute callback
    const result = callback(tx);

    // 6. Commit: swap cloned state back into real state (only for collections that were cloned)
    for (const name of Object.keys(clonedStates)) {
      this.#state.collections[name] = clonedStates[name]!;
    }

    // 7. Emit event (only includes collections that were actually mutated)
    if (Object.keys(event).length > 0) {
      this.#emitter.emit(event);
    }

    return result;
  }
}

export function createStore<T extends StoreConfig>(config: T): Store<T> {
  return new Store(config);
}
