import type { AnyObject, DocumentState } from "../state";
import type { StandardSchemaV1 } from "./standard-schema";

export type AnyObjectSchema<T extends AnyObject = AnyObject> =
	StandardSchemaV1<T>;
export type SchemasMap = Record<string, AnyObjectSchema>;

/** Infer the output type from a schema */
export type InferOutput<T extends AnyObjectSchema> =
	StandardSchemaV1.InferOutput<T>;

/** Infer the input type from a schema */
export type InferInput<T extends AnyObjectSchema> =
	StandardSchemaV1.InferInput<T>;

/**
 * Serialized store state containing all documents.
 * Used for persistence and sync operations.
 * This is the JSON-serializable representation of the entire store.
 */
export type StoreState<Schemas extends SchemasMap> = {
	version: string;
	name: string;
	latest: string;
	documents: {
		[K in keyof Schemas]: DocumentState<InferOutput<Schemas[K]>>;
	};
};
