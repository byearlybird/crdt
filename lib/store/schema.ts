import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Validates input data against a schema.
 * Accepts `unknown` input to allow safe validation of untyped data.
 * The schema's runtime validation will ensure type safety.
 */
export function validate<T extends StandardSchemaV1>(
  schema: T,
  input: unknown,
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

/**
 * A collection definition with document and ID types captured directly.
 * Use the `collection()` helper to create instances with proper type inference.
 *
 * The `~docType` and `~idType` are phantom types used only for type inference.
 * They are not accessed at runtime.
 */
import type { Document } from "../core";

export type CollectionDef<T extends Document = Document, Id extends string = string> = {
  readonly "~docType": T; // Phantom - document shape
  readonly "~idType": Id; // Phantom - ID type
  schema: AnyObject; // Runtime only - used for validation
  getId: (data: T) => Id; // Properly typed, no contravariance issue
};

/**
 * Helper function to create a collection definition with proper type inference.
 * This captures the schema output type directly as the document type.
 *
 * @example
 * ```ts
 * const store = createStore({
 *   users: collection(userSchema, (data) => data.id),
 * });
 * ```
 */
export function collection<S extends AnyObject, Id extends string = string>(
  schema: S,
  getId: (data: Output<S>) => Id,
): CollectionDef<Output<S>, Id> {
  return {
    "~docType": undefined as unknown as Output<S>, // Phantom
    "~idType": undefined as unknown as Id, // Phantom
    schema,
    getId,
  };
}

/**
 * Extract the document type from a CollectionDef
 */
export type DocType<C extends CollectionDef> = C["~docType"];

/**
 * Extract the ID type from a CollectionDef
 */
export type IdType<C extends CollectionDef> = C["~idType"];

/**
 * Configuration for all collections in a store.
 * All collection definitions must be created using the `collection()` helper.
 *
 * Uses `any` for type parameters to allow any CollectionDef to be stored,
 * while still preserving specific types through inference in createStore.
 */
export type StoreConfig = Record<string, CollectionDef<any, any>>;

/**
 * Valid collection name from a store config
 */
export type CollectionName<T extends StoreConfig> = keyof T & string;
