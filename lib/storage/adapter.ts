/**
 * Storage adapter interface for Starling stores.
 *
 * Adapters provide persistent storage for CRDT data, supporting various backends
 * like IndexedDB (browser), SQLite (Node.js/Bun), or remote sync servers.
 */

import type { Clock } from "../core/clock.js";
import type { Collection, Document, Tombstones } from "../core/collection.js";

/**
 * Document identifier (typically a string)
 */
export type DocumentId = string;

/**
 * Storage adapter interface that all adapters must implement.
 *
 * Design principles:
 * - All operations are async (required for IndexedDB, works for everything else)
 * - Provides both granular (single document) and bulk (entire collection) operations
 * - Transaction support for atomic multi-operation updates
 * - Collections are identified by string names (e.g., "users", "notes")
 */
export interface StorageAdapter {
  /**
   * Initialize the adapter and load existing state.
   *
   * Called once when the store is created. Must:
   * - Set up storage backend (create tables, object stores, etc.)
   * - Load and return existing clock + all collections
   * - Return default state if no existing data
   *
   * @returns Initial state (clock + all collections)
   */
  initialize(): Promise<StorageState>;

  /**
   * Get the current hybrid logical clock.
   *
   * @returns Current clock state
   */
  getClock(): Promise<Clock>;

  /**
   * Update the hybrid logical clock.
   *
   * Called whenever the clock advances (on every operation).
   *
   * @param clock New clock state
   */
  setClock(clock: Clock): Promise<void>;

  /**
   * Get a single document from a collection.
   *
   * @param collectionName Collection identifier
   * @param id Document ID
   * @returns Document if exists, undefined otherwise
   */
  getDocument(
    collectionName: string,
    id: DocumentId,
  ): Promise<Document | undefined>;

  /**
   * Set (create or update) a single document in a collection.
   *
   * @param collectionName Collection identifier
   * @param id Document ID
   * @param document Document data (flattened with stamps)
   */
  setDocument(
    collectionName: string,
    id: DocumentId,
    document: Document,
  ): Promise<void>;

  /**
   * Delete a document from a collection.
   *
   * Note: This removes the document data, but tombstone should remain.
   *
   * @param collectionName Collection identifier
   * @param id Document ID
   */
  deleteDocument(collectionName: string, id: DocumentId): Promise<void>;

  /**
   * Get a single tombstone from a collection.
   *
   * @param collectionName Collection identifier
   * @param id Document ID
   * @returns Tombstone stamp if exists, undefined otherwise
   */
  getTombstone(
    collectionName: string,
    id: DocumentId,
  ): Promise<string | undefined>;

  /**
   * Set a tombstone in a collection.
   *
   * @param collectionName Collection identifier
   * @param id Document ID
   * @param stamp Deletion timestamp
   */
  setTombstone(
    collectionName: string,
    id: DocumentId,
    stamp: string,
  ): Promise<void>;

  /**
   * Get all document IDs in a collection.
   *
   * Used for iteration. Does not include tombstoned documents.
   *
   * @param collectionName Collection identifier
   * @returns Array of document IDs
   */
  getDocumentIds(collectionName: string): Promise<DocumentId[]>;

  /**
   * Get an entire collection (documents + tombstones).
   *
   * Used for:
   * - Initial load during initialize()
   * - Creating snapshots for sync
   * - Bulk operations
   *
   * @param collectionName Collection identifier
   * @returns Full collection data
   */
  getCollection(collectionName: string): Promise<Collection>;

  /**
   * Replace an entire collection (documents + tombstones).
   *
   * Used for:
   * - Merging remote snapshots
   * - Bulk sync operations
   *
   * Warning: This replaces all documents and tombstones in the collection.
   *
   * @param collectionName Collection identifier
   * @param collection New collection data
   */
  setCollection(collectionName: string, collection: Collection): Promise<void>;

  /**
   * Execute multiple operations atomically within a transaction.
   *
   * If any operation fails, all operations should be rolled back.
   * If all operations succeed, all changes should be committed together.
   *
   * Transaction support is REQUIRED for consistency, but adapters may
   * implement it differently:
   * - IndexedDB: Use IDBTransaction
   * - SQLite: Use BEGIN/COMMIT/ROLLBACK
   * - Memory: Batch operations and apply atomically
   * - Remote: Send as single batch request
   *
   * @param fn Transaction function that receives a transaction context
   * @returns Result of the transaction function
   * @throws If transaction fails or is aborted
   */
  transaction<T>(fn: (tx: StorageTransaction) => Promise<T>): Promise<T>;

  /**
   * Close the adapter and release resources.
   *
   * Should:
   * - Close database connections
   * - Release file handles
   * - Clean up any background tasks
   * - Flush pending writes
   *
   * After close(), the adapter should not be used.
   */
  close(): Promise<void>;
}

/**
 * Transaction context for batching multiple operations atomically.
 *
 * All operations are queued and executed together when the transaction
 * function completes. If the function throws, operations are rolled back.
 *
 * Design note: These methods are synchronous (not async) because they
 * just queue operations. The actual async work happens when the transaction
 * commits.
 */
export interface StorageTransaction {
  /**
   * Queue a clock update in this transaction.
   *
   * @param clock New clock state
   */
  setClock(clock: Clock): void;

  /**
   * Queue a document write in this transaction.
   *
   * @param collectionName Collection identifier
   * @param id Document ID
   * @param document Document data
   */
  setDocument(collectionName: string, id: DocumentId, document: Document): void;

  /**
   * Queue a document deletion in this transaction.
   *
   * @param collectionName Collection identifier
   * @param id Document ID
   */
  deleteDocument(collectionName: string, id: DocumentId): void;

  /**
   * Queue a tombstone write in this transaction.
   *
   * @param collectionName Collection identifier
   * @param id Document ID
   * @param stamp Deletion timestamp
   */
  setTombstone(collectionName: string, id: DocumentId, stamp: string): void;
}

/**
 * Initial state returned by adapter.initialize()
 */
export interface StorageState {
  /**
   * Current hybrid logical clock
   */
  clock: Clock;

  /**
   * All collections in storage, keyed by collection name
   */
  collections: Record<string, Collection>;
}

/**
 * Configuration for creating a storage adapter
 */
export interface StorageAdapterConfig {
  /**
   * Collection names that will be stored.
   *
   * This is required for adapters that need upfront schema definition
   * (e.g., IndexedDB object stores, SQLite tables).
   */
  collections: string[];
}

/**
 * Error thrown when storage operations fail
 */
export class StorageError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = "StorageError";
  }
}
