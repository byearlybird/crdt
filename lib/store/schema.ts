import type { StandardSchemaV1 } from "@standard-schema/spec";

/**
 * Validates input data against a schema and returns the validated output.
 * Throws an error if validation fails or if the schema is asynchronous.
 */
export function validate<T extends StandardSchemaV1>(
  schema: T,
  input: StandardSchemaV1.InferInput<T>,
): StandardSchemaV1.InferOutput<T> {
  const result = schema["~standard"].validate(input);
  if (result instanceof Promise) {
    throw new TypeError("Schema validation must be synchronous");
  }

  // if the `issues` field exists, the validation failed
  if (result.issues) {
    throw new Error(JSON.stringify(result.issues, null, 2));
  }

  return result.value;
}

/**
 * Base type constraint for any standard schema object.
 * This represents a schema that validates to a Record<string, any>.
 */
export type AnyStandardObject = StandardSchemaV1<Record<string, any>>;
