import type { StoreConfig } from "../store/schema";
import type { StoreAPI } from "../store/store";
import type { StoreState } from "../core";

export type PersistenceOptions = {
  key: string;
  debounceMs?: number;
  channelName?: string;
};

const DEFAULT_DEBOUNCE_MS = 300;
const DB_VERSION = 1;
const STORE_NAME = "state";
const STORE_KEY = "store";

function openDB(key: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(key, DB_VERSION);

    request.onerror = () => {
      reject(new Error(`Failed to open IndexedDB: ${request.error?.message ?? "Unknown error"}`));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });
}

async function loadState(key: string): Promise<StoreState | null> {
  try {
    const db = await openDB(key);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readonly");
      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(STORE_KEY);

      request.onerror = () => {
        db.close();
        reject(new Error(`Failed to load state: ${request.error?.message ?? "Unknown error"}`));
      };

      request.onsuccess = () => {
        db.close();
        const result = request.result;
        if (result) {
          try {
            const state = JSON.parse(result) as StoreState;
            resolve(state);
          } catch {
            resolve(null);
          }
        } else {
          resolve(null);
        }
      };
    });
  } catch {
    // Handle errors gracefully - return null if DB can't be opened
    return null;
  }
}

async function saveState(key: string, state: StoreState): Promise<void> {
  try {
    const db = await openDB(key);
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([STORE_NAME], "readwrite");
      const store = transaction.objectStore(STORE_NAME);
      const serialized = JSON.stringify(state);
      const request = store.put(serialized, STORE_KEY);

      request.onerror = () => {
        db.close();
        reject(new Error(`Failed to save state: ${request.error?.message ?? "Unknown error"}`));
      };

      request.onsuccess = () => {
        db.close();
        resolve();
      };
    });
  } catch (error) {
    // Handle errors gracefully - don't throw, just log
    console.warn("[Starling Persistence] Failed to save state:", error);
  }
}

export async function createPersistence<T extends StoreConfig>(
  store: StoreAPI<T>,
  options: PersistenceOptions,
): Promise<() => Promise<void>> {
  const { key, debounceMs = DEFAULT_DEBOUNCE_MS, channelName = `starling:${key}` } = options;

  let debounceTimeout: ReturnType<typeof setTimeout> | null = null;
  let broadcastChannel: globalThis.BroadcastChannel | null = null;

  // Load state from IndexedDB
  try {
    const savedState = await loadState(key);
    if (savedState) {
      store.setState(({ applyState, notify }) => {
        notify(applyState(savedState));
      });
    }
  } catch (error) {
    console.warn("[Starling Persistence] Failed to load state:", error);
  }

  // Set up BroadcastChannel for cross-tab sync
  try {
    broadcastChannel = new globalThis.BroadcastChannel(channelName);

    broadcastChannel.onmessage = (event: MessageEvent) => {
      if (event.data?.type === "state-update" && event.data?.state) {
        try {
          const incomingState = event.data.state as StoreState;
          store.setState(({ applyState, notify }) => {
            notify(applyState(incomingState));
          });
        } catch (error) {
          console.warn("[Starling Persistence] Failed to process broadcast message:", error);
        }
      }
    };
  } catch (error) {
    // BroadcastChannel may not be available in some environments
    console.warn("[Starling Persistence] BroadcastChannel not available:", error);
  }

  // Subscribe to store changes
  const unsubscribe = store.subscribe(() => {
    // Debounce writes
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
    }

    debounceTimeout = setTimeout(async () => {
      const state = store.getState();
      await saveState(key, state);

      // Broadcast to other tabs after successful save
      if (broadcastChannel) {
        try {
          broadcastChannel.postMessage({
            type: "state-update",
            state,
          });
        } catch (error) {
          console.warn("[Starling Persistence] Failed to broadcast state:", error);
        }
      }
    }, debounceMs);
  });

  // Return cleanup function
  return async () => {
    // Unsubscribe first to prevent new changes during cleanup
    unsubscribe();

    // Cancel any pending debounced write
    if (debounceTimeout) {
      clearTimeout(debounceTimeout);
      debounceTimeout = null;
    }

    // Persist the latest state before closing
    const state = store.getState();
    await saveState(key, state);

    // Close BroadcastChannel
    if (broadcastChannel) {
      broadcastChannel.close();
      broadcastChannel = null;
    }
  };
}
