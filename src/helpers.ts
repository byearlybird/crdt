import type { StandardSchemaV1 } from "@standard-schema/spec";
import { SchemaError } from "./errors.ts";

export function mustGet<K, V>(map: ReadonlyMap<K, V>, key: K): V {
	const value = map.get(key);
	if (value === undefined)
		throw new Error(`Invariant: missing key ${String(key)}`);
	return value;
}

export function mergeDelta(existing: unknown, delta: unknown): unknown {
	return typeof delta === "function"
		? (delta as (value: unknown) => unknown)(existing)
		: { ...(existing as object), ...(delta as object) };
}

export function parseWithSchema(
	schema: StandardSchemaV1,
	record: unknown,
): unknown {
	const result = schema["~standard"].validate(record);
	if (result instanceof Promise) {
		throw new TypeError(
			"Async schema validation is not supported. Use middleware for async validation.",
		);
	}
	if (result.issues) {
		throw new SchemaError(result.issues);
	}
	return result.value;
}
