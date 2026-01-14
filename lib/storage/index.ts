/**
 * Storage adapter interfaces and implementations for Starling.
 *
 * @module storage
 */

export type {
  StorageAdapter,
  StorageTransaction,
  StorageState,
  StorageAdapterConfig,
  DocumentId,
} from "./adapter.js";

export { StorageError } from "./adapter.js";

export { MemoryAdapter } from "./memory-adapter.js";
