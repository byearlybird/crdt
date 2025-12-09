// Document types and functions
export type {
	AnyObject,
	DocumentChanges,
	MergeDocumentsResult,
	StarlingDocument,
} from "./document";
export { makeDocument, mergeDocuments } from "./document";
export type { ResourceObject } from "./resource";
export { deleteResource, makeResource, mergeResources } from "./resource";
export { documentToMap, mapToDocument } from "./utils";
