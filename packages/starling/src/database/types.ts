import type { AnyObject, StarlingDocument } from "../core";
import type { StandardSchemaV1 } from "./standard-schema";

export type AnyObjectSchema<T extends AnyObject = AnyObject> =
	StandardSchemaV1<T>;
export type SchemasMap = Record<string, AnyObjectSchema>;

/**
 * Serialized database snapshot containing all collections.
 * Used for persistence and sync operations.
 */
export type DatabaseSnapshot<Schemas extends SchemasMap> = {
	version: string;
	name: string;
	latest: string;
	collections: {
		[K in keyof Schemas]: StarlingDocument<
			StandardSchemaV1.InferOutput<Schemas[K]>
		>;
	};
};
