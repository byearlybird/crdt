import type { AnyObject, StarlingDocument } from "../core";
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
 * Serialized database snapshot containing all collections.
 * Used for persistence and sync operations.
 */
export type DatabaseSnapshot<Schemas extends SchemasMap> = {
	version: string;
	name: string;
	latest: string;
	collections: {
		[K in keyof Schemas]: StarlingDocument<InferOutput<Schemas[K]>>;
	};
};
