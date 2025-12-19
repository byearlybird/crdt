// Document types and functions
export type {
	AnyObject,
	DocumentChanges,
	MergeDocumentsResult,
	DocumentState,
} from "./document";
export { makeDocument, mergeDocuments } from "./document";
export type { Resource } from "./resource";
export { makeResource, mergeResources } from "./resource";
export { documentToMap, mapToDocument } from "./utils";
