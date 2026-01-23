import type { StandardSchemaV1 } from "@standard-schema/spec";

export function validate<T extends StandardSchemaV1>(
  schema: T,
  input: StandardSchemaV1.InferInput<T>,
): StandardSchemaV1.InferOutput<T> {
  const result = schema["~standard"].validate(input);
  if (result instanceof Promise) {
    throw new TypeError("Schema validation must be synchronous");
  }

  if (result.issues) {
    throw new Error(JSON.stringify(result.issues, null, 2));
  }

  return result.value;
}

/**
 * Base type constraint for any standard schema object
 */
export type AnyObject = StandardSchemaV1<Record<string, any>>;

export type Output<T extends AnyObject> = StandardSchemaV1.InferOutput<T>;

export type Input<T extends AnyObject> = StandardSchemaV1.InferInput<T>;

export type CollectionConfig<T extends AnyObject> = {
  schema: T;
  keyPath: keyof Output<T> & string;
};

/**
 * Configuration for all collections in a store
 */
export type StoreConfig = Record<string, CollectionConfig<AnyObject>>;

/**
 * Valid collection name from a store config
 */
export type CollectionName<T extends StoreConfig> = keyof T & string;
