import type { StoreConfig } from "../store/schema";
import type { Store } from "../store";
import type { StoreState } from "../core";
import { Emitter } from "../emitter";
import { BroadcastSync } from "./broadcast-sync";

export interface IPersister {
  init(): Promise<void>;
  dispose(): Promise<void>;
}

export type PersistenceOptions = {
  key: string;
  storeName?: string;
  debounceMs?: number;
  channelName?: string;
  serialize?: (state: StoreState) => string;
  deserialize?: (serialized: string) => StoreState;
};

const DEFAULT_DEBOUNCE_MS = 300;
const DB_VERSION = 1;
const DEFAULT_STORE_NAME = "state";
const STORE_KEY = "store";

export class IdbPersister<T extends StoreConfig> implements IPersister {
  #store: Store<T>;
  #config: Required<PersistenceOptions>;
  #debounceTimer: ReturnType<typeof setTimeout> | null = null;
  #sync: BroadcastSync;
  #emitter: Emitter<string>;
  #unsubscribe: (() => void) | null = null;
  #db: IDBDatabase | null = null;

  constructor(store: Store<T>, options: PersistenceOptions) {
    this.#store = store;
    this.#config = {
      key: options.key,
      debounceMs: options.debounceMs ?? DEFAULT_DEBOUNCE_MS,
      storeName: options.storeName ?? DEFAULT_STORE_NAME,
      serialize: options.serialize ?? ((s) => JSON.stringify(s)),
      deserialize: options.deserialize ?? ((s) => JSON.parse(s) as StoreState),
      channelName: options.channelName ?? `starling:${options.key}`,
    };
    this.#emitter = new Emitter<string>();
    this.#sync = new BroadcastSync({
      channelName: this.#config.channelName,
      onMessage: (state) => this.#store.merge(state),
    });
  }

  async #load(): Promise<StoreState | null> {
    const db = this.#db;
    if (!db) {
      return null;
    }

    try {
      return new Promise((resolve, reject) => {
        const transaction = db.transaction([this.#config.storeName], "readonly");
        const store = transaction.objectStore(this.#config.storeName);
        const request = store.get(STORE_KEY);

        request.onerror = () => {
          reject(new Error(`Failed to load state: ${request.error?.message ?? "Unknown error"}`));
        };

        request.onsuccess = () => {
          const result = request.result;
          if (result) {
            try {
              const state = this.#config.deserialize(result);
              resolve(state);
            } catch (error) {
              console.warn("[Starling Persistence] Failed to deserialize state:", error);
              resolve(null);
            }
          } else {
            resolve(null);
          }
        };
      });
    } catch {
      // Handle errors gracefully - return null if load fails
      return null;
    }
  }

  async #save(serialized: string): Promise<void> {
    const db = this.#db;
    if (!db) {
      throw new Error("IndexedDB not initialized. Call init() first.");
    }

    return new Promise((resolve, reject) => {
      const transaction = db.transaction([this.#config.storeName], "readwrite");
      const store = transaction.objectStore(this.#config.storeName);
      const request = store.put(serialized, STORE_KEY);

      request.onerror = () => {
        reject(new Error(`Failed to save state: ${request.error?.message ?? "Unknown error"}`));
      };

      request.onsuccess = () => {
        resolve();
      };
    });
  }

  async #persist(): Promise<void> {
    try {
      const state = this.#store.getState();
      const serialized = this.#config.serialize(state);

      // Save to IndexedDB
      await this.#save(serialized);

      // Notify broadcast channel (other tabs)
      this.#sync.broadcast(state);

      // Notify listeners
      this.#emitter.emit(serialized);
    } catch (error) {
      console.warn("[Starling Persistence] Failed to save state:", error);
    }
  }

  #openDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.#config.key, DB_VERSION);

      request.onerror = () => {
        reject(new Error(`Failed to open IndexedDB: ${request.error?.message ?? "Unknown error"}`));
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains(this.#config.storeName)) {
          db.createObjectStore(this.#config.storeName);
        }
      };
    });
  }

  async init(): Promise<void> {
    // Open IndexedDB connection
    try {
      this.#db = await this.#openDB();
    } catch (error) {
      console.warn("[Starling Persistence] Failed to open IndexedDB:", error);
      // Continue without DB - operations will fail gracefully
    }

    // Load state from storage
    try {
      const savedState = await this.#load();
      if (savedState) {
        this.#store.merge(savedState);
      }
    } catch (error) {
      console.warn("[Starling Persistence] Failed to load state:", error);
    }

    // Subscribe to store changes after loading (so initial load doesn't trigger save)
    this.#unsubscribe = this.#store.subscribe(() => {
      if (this.#debounceTimer) {
        clearTimeout(this.#debounceTimer);
      }
      this.#debounceTimer = setTimeout(
        () => {
          this.#debounceTimer = null;
          void this.#persist();
        },
        this.#config.debounceMs,
      );
    });
  }

  async dispose(): Promise<void> {
    // Unsubscribe first to prevent new changes during cleanup
    if (this.#unsubscribe) {
      this.#unsubscribe();
      this.#unsubscribe = null;
    }

    // Cancel any pending debounced write
    if (this.#debounceTimer) {
      clearTimeout(this.#debounceTimer);
      this.#debounceTimer = null;
    }

    // Persist the latest state before closing (only if DB is initialized)
    if (this.#db) {
      await this.#persist();
    }

    // Close IndexedDB connection
    if (this.#db) {
      this.#db.close();
      this.#db = null;
    }

    // Close cross-tab sync
    this.#sync.close();
  }

  subscribe(listener: (serialized: string) => void): () => void {
    return this.#emitter.subscribe(listener);
  }
}
