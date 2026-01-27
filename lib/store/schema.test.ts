import { describe, expect, test } from "vitest";
import { validate } from "./schema";

describe("validate", () => {
  test("throws error for async schema", () => {
    const asyncSchema = {
      "~standard": {
        validate: () => Promise.resolve({ value: {} }),
      },
    };

    expect(() => {
      validate(asyncSchema as any, {});
    }).toThrow("Schema validation must be synchronous");
  });

  test("throws error for schema validation issues", () => {
    const failingSchema = {
      "~standard": {
        validate: () => ({
          issues: [{ message: "Validation failed", path: ["field"] }],
        }),
      },
    };

    expect(() => {
      validate(failingSchema as any, {});
    }).toThrow();
  });
});
