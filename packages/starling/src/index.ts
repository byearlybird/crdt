/**
 * @byearlybird/starling
 * Local-first data sync for JavaScript apps
 *
 * Main export: Database with typed collections, transactions, and plugins.
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
} from "./database/collection";
export type {
	CollectionConfig,
	Database,
	DatabasePlugin,
	DbConfig,
} from "./database/db";
// Database features
export { createDatabase } from "./database/db";
export type { StandardSchemaV1 } from "./database/standard-schema";
export type {
	TransactionCollectionHandle,
	TransactionContext,
} from "./database/transaction";
export type { DatabaseSnapshot } from "./database/types";
