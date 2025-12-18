import { describe, expect, test } from "bun:test";
import { z } from "zod";
import { type StandardSchemaV1, standardValidate } from "./standard-schema";

describe("standardValidate", () => {
	test("validates and returns output for valid input", () => {
		const schema = z.object({
			name: z.string(),
			age: z.number(),
		});

		const result = standardValidate(schema, { name: "Alice", age: 30 });

		expect(result).toEqual({ name: "Alice", age: 30 });
	});

	test("throws Error with JSON issues for invalid input", () => {
		const schema = z.object({
			name: z.string(),
			age: z.number(),
		});

		expect(() =>
			standardValidate(schema, { name: "Alice", age: "not a number" }),
		).toThrow(Error);
	});

	test("throws TypeError for async schema validation", () => {
		// Create a mock schema that returns a Promise from validate
		const asyncSchema: StandardSchemaV1<{ name: string }, { name: string }> = {
			"~standard": {
				version: 1,
				vendor: "test",
				validate: (_value: unknown) => {
					// Return a Promise to trigger the async error path
					return Promise.resolve({ value: { name: "test" } });
				},
			},
		};

		expect(() => standardValidate(asyncSchema, { name: "test" })).toThrow(
			TypeError,
		);
		expect(() => standardValidate(asyncSchema, { name: "test" })).toThrow(
			"Schema validation must be synchronous",
		);
	});

	test("applies default values from schema", () => {
		const schema = z.object({
			id: z.string().default(() => "default-id"),
			title: z.string(),
		});

		const result = standardValidate(schema, { title: "Test" });

		expect(result.id).toBe("default-id");
		expect(result.title).toBe("Test");
	});
});
