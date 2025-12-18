/**
 * @byearlybird/starling
 * Local-first data sync for JavaScript apps
 *
 * Main export: Store with typed collections, transactions, and plugins.
 * For low-level CRDT primitives, import from "@byearlybird/starling/core"
 *
 * Plugins are available as separate optional imports:
 * - @byearlybird/starling/plugin-idb - IndexedDB persistence
 * - @byearlybird/starling/plugin-http - HTTP sync
 */

// Re-export commonly needed core types
export type { AnyObject, StarlingDocument } from "./core";
export {
	type Collection,
	CollectionInternals,
	DuplicateIdError,
	IdNotFoundError,
} from "./store/collection";
export type {
	CollectionConfig,
	Store,
	StorePlugin,
	StoreConfig,
} from "./store/store";
// Store features
export { createStore } from "./store/store";
export type { QueryContext } from "./store/query";
export type { StandardSchemaV1 } from "./store/standard-schema";
export type {
	TransactionCollectionHandle,
	TransactionContext,
} from "./store/transaction";
export type { StoreSnapshot } from "./store/types";
