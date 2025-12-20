/**
 * @byearlybird/starling
 * Local-first data sync for JavaScript apps
 *
 * Main export: Store with typed documents, transactions, and JSON-serializable sync.
 * For low-level CRDT primitives, import from "@byearlybird/starling/core"
 *
 * Persistence and sync helpers are available as separate optional imports:
 * - @byearlybird/starling/persister-idb - IndexedDB persistence
 * - @byearlybird/starling/synchronizer-http - HTTP sync
 */

// Re-export commonly needed core types
export type { AnyObject, DocumentState } from "./state";
export {
	type DocHandle,
	DocHandleInternals,
	DuplicateIdError,
	IdNotFoundError,
} from "./store/doc-handle";
export type { QueryContext } from "./store/query";
export type { StandardSchemaV1 } from "./store/standard-schema";
export type {
	DocHandleConfig,
	Store,
	StoreConfig,
} from "./store/store";
// Store features
export { createStore } from "./store/store";
export type {
	TransactionContext,
	TransactionDocHandle,
} from "./store/transaction";
export type { StoreState } from "./store/types";
