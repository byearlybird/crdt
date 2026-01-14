/**
 * In-memory storage adapter for Starling stores.
 *
 * This adapter provides a reference implementation that stores all data
 * in memory. It's useful for:
 * - Testing
 * - Development
 * - Applications that don't need persistence
 * - Default behavior (when no adapter is specified)
 */

import type { Clock } from "../core/clock.js";
import type { Collection, Document } from "../core/collection.js";
import type {
  StorageAdapter,
  StorageTransaction,
  StorageState,
  StorageAdapterConfig,
  DocumentId,
} from "./adapter.js";

/**
 * Deep clone helper for ensuring data isolation.
 */
function deepClone<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj));
}

/**
 * In-memory storage adapter.
 *
 * All data is stored in memory and lost when the process exits.
 * Operations are synchronous under the hood but wrapped in Promises
 * to maintain API consistency with other adapters.
 */
export class MemoryAdapter implements StorageAdapter {
  private clock: Clock;
  private collections: Map<string, Collection>;

  /**
   * Create a new in-memory storage adapter.
   *
   * @param config Adapter configuration
   */
  constructor(config: StorageAdapterConfig) {
    this.clock = { ms: Date.now(), seq: 0 };
    this.collections = new Map();

    // Initialize empty collections
    for (const name of config.collections) {
      this.collections.set(name, {
        documents: {},
        tombstones: {},
      });
    }
  }

  async initialize(): Promise<StorageState> {
    return {
      clock: deepClone(this.clock),
      collections: Object.fromEntries(
        Array.from(this.collections.entries()).map(([name, collection]) => [
          name,
          deepClone(collection),
        ]),
      ),
    };
  }

  async getClock(): Promise<Clock> {
    return deepClone(this.clock);
  }

  async setClock(clock: Clock): Promise<void> {
    this.clock = deepClone(clock);
  }

  async getDocument(collectionName: string, id: DocumentId): Promise<Document | undefined> {
    const collection = this.collections.get(collectionName);
    if (!collection) {
      return undefined;
    }
    const doc = collection.documents[id];
    return doc ? deepClone(doc) : undefined;
  }

  async setDocument(collectionName: string, id: DocumentId, document: Document): Promise<void> {
    const collection = this.collections.get(collectionName);
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`);
    }
    collection.documents[id] = deepClone(document);
  }

  async deleteDocument(collectionName: string, id: DocumentId): Promise<void> {
    const collection = this.collections.get(collectionName);
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`);
    }
    delete collection.documents[id];
  }

  async getTombstone(collectionName: string, id: DocumentId): Promise<string | undefined> {
    const collection = this.collections.get(collectionName);
    if (!collection) {
      return undefined;
    }
    return collection.tombstones[id];
  }

  async setTombstone(collectionName: string, id: DocumentId, stamp: string): Promise<void> {
    const collection = this.collections.get(collectionName);
    if (!collection) {
      throw new Error(`Collection "${collectionName}" not found`);
    }
    collection.tombstones[id] = stamp;
  }

  async getDocumentIds(collectionName: string): Promise<DocumentId[]> {
    const collection = this.collections.get(collectionName);
    if (!collection) {
      return [];
    }
    return Object.keys(collection.documents);
  }

  async getCollection(collectionName: string): Promise<Collection> {
    const collection = this.collections.get(collectionName);
    if (!collection) {
      return { documents: {}, tombstones: {} };
    }
    return deepClone(collection);
  }

  async setCollection(collectionName: string, collection: Collection): Promise<void> {
    this.collections.set(collectionName, deepClone(collection));
  }

  async transaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T> {
    // Create a transaction that batches operations
    const tx = new MemoryTransaction(this);

    try {
      // Execute the transaction function
      const result = await fn(tx);

      // Commit all queued operations
      await tx.commit();

      return result;
    } catch (error) {
      // Rollback on error
      tx.rollback();
      throw error;
    }
  }

  async close(): Promise<void> {
    // No-op for memory adapter - nothing to clean up
  }
}

/**
 * Transaction implementation for MemoryAdapter.
 *
 * Queues all operations and applies them atomically on commit.
 * If the transaction fails, all operations are discarded.
 */
class MemoryTransaction implements StorageTransaction {
  private operations: Array<() => Promise<void>> = [];
  private snapshot: {
    clock: Clock;
    collections: Map<string, Collection>;
  };

  constructor(private adapter: MemoryAdapter) {
    // Create a snapshot for rollback
    this.snapshot = {
      clock: deepClone((adapter as any).clock),
      collections: new Map(
        Array.from((adapter as any).collections.entries()).map(
          ([name, collection]: [string, Collection]) => [name, deepClone(collection)],
        ),
      ),
    };
  }

  setClock(clock: Clock): void {
    this.operations.push(async () => {
      await this.adapter.setClock(clock);
    });
  }

  setDocument(collectionName: string, id: DocumentId, document: Document): void {
    this.operations.push(async () => {
      await this.adapter.setDocument(collectionName, id, document);
    });
  }

  deleteDocument(collectionName: string, id: DocumentId): void {
    this.operations.push(async () => {
      await this.adapter.deleteDocument(collectionName, id);
    });
  }

  setTombstone(collectionName: string, id: DocumentId, stamp: string): void {
    this.operations.push(async () => {
      await this.adapter.setTombstone(collectionName, id, stamp);
    });
  }

  async commit(): Promise<void> {
    // Execute all queued operations
    for (const operation of this.operations) {
      await operation();
    }
  }

  rollback(): void {
    // Restore snapshot
    (this.adapter as any).clock = this.snapshot.clock;
    (this.adapter as any).collections = this.snapshot.collections;
  }
}
