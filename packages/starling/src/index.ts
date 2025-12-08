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
export type { StarlingDocument, AnyObject } from "./core";

// Database features
export { createDatabase } from "./database/db";
export type {
	Database,
	DbConfig,
	CollectionConfig,
	DatabasePlugin,
} from "./database/db";

export {
	type Collection,
	CollectionInternals,
	DuplicateIdError,
	IdNotFoundError,
} from "./database/collection";

export type {
	TransactionContext,
	TransactionCollectionHandle,
} from "./database/transaction";

export type {
	QueryContext,
	QueryHandle,
	QueryCollectionHandle,
} from "./database/query";

export type { StandardSchemaV1 } from "./database/standard-schema";
