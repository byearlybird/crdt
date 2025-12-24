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

export type SchemaWithId<T extends AnyObject> =
  StandardSchemaV1.InferOutput<T> extends {
    id: any;
  }
    ? T
    : never;

export type Output<T extends AnyObject> = StandardSchemaV1.InferOutput<T>;

export type Input<T extends AnyObject> = StandardSchemaV1.InferInput<T>;
