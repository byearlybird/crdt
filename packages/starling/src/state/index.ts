// Foundation types

// Document types and functions
export type {
	DocumentChanges,
	DocumentState,
	MergeDocumentsResult,
} from "./document";
export { makeDocument, mergeDocuments } from "./document";

// Resource types and functions
export type { Resource } from "./resource";
export { makeResource, mergeResources } from "./resource";
export type {
	AnyObject,
	Eventstamp,
	EventstampMap,
	TombstoneMap,
} from "./types";
export { isPlainObject, isRecord } from "./types";

// Utilities
export { documentToMap, mapToDocument } from "./utils";
