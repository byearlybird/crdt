import { describe, expect, test } from "vitest";
import { define, validate, type StoreConfig } from "./schema";
import type { StoreState } from "../core";
import { makeStamp } from "../core/clock";
import { mergeState } from "./operations";

describe("mergeState", () => {
  test("merges collection states correctly", () => {
    const config: StoreConfig = {
      users: define({} as any, (d: any) => d.id),
    };

    const stamp1 = makeStamp(1000, 0);
    const stamp2 = makeStamp(2000, 0);

    const currentState: StoreState = {
      clock: { ms: 1000, seq: 0 },
      collections: {
        users: {
          documents: {
            "1": {
              id: { "~val": "1", "~ts": stamp1 },
              name: { "~val": "Alice", "~ts": stamp1 },
            },
          },
          tombstones: {},
        },
      },
    };

    const snapshot: StoreState = {
      clock: { ms: 2000, seq: 0 },
      collections: {
        users: {
          documents: {
            "2": {
              id: { "~val": "2", "~ts": stamp2 },
              name: { "~val": "Bob", "~ts": stamp2 },
            },
          },
          tombstones: {},
        },
      },
    };

    const diff = mergeState(currentState, snapshot, config);

    expect(diff).toEqual({ users: true });
    expect(currentState.collections?.["users"]?.documents["1"]).toBeDefined();
    expect(currentState.collections?.["users"]?.documents["2"]).toBeDefined();
  });

  test("advances clock based on snapshot", () => {
    const config: StoreConfig = {
      users: define({} as any, (d: any) => d.id),
    };

    const currentState: StoreState = {
      clock: { ms: 1000, seq: 5 },
      collections: {},
    };

    const snapshot: StoreState = {
      clock: { ms: 2000, seq: 3 },
      collections: {},
    };

    mergeState(currentState, snapshot, config);

    expect(currentState.clock.ms).toBe(2000);
    expect(currentState.clock.seq).toBeGreaterThanOrEqual(3);
  });

  test("returns change event with modified collections", () => {
    const config: StoreConfig = {
      users: define({} as any, (d: any) => d.id),
      posts: define({} as any, (d: any) => d.id),
    };

    const currentState: StoreState = {
      clock: { ms: 1000, seq: 0 },
      collections: {},
    };

    const snapshot: StoreState = {
      clock: { ms: 2000, seq: 0 },
      collections: {
        users: { documents: {}, tombstones: {} },
        posts: { documents: {}, tombstones: {} },
      },
    };

    const diff = mergeState(currentState, snapshot, config);

    expect(diff).toEqual({ users: true, posts: true });
  });

  test("handles empty collections", () => {
    const config: StoreConfig = {};

    const currentState: StoreState = {
      clock: { ms: 1000, seq: 0 },
      collections: {},
    };

    const snapshot: StoreState = {
      clock: { ms: 2000, seq: 0 },
      collections: {},
    };

    const diff = mergeState(currentState, snapshot, config);

    expect(diff).toEqual({});
  });

  test("handles missing collections in current state", () => {
    const config: StoreConfig = {
      users: define({} as any, (d: any) => d.id),
    };

    const stamp = makeStamp(2000, 0);

    const currentState: StoreState = {
      clock: { ms: 1000, seq: 0 },
      collections: {},
    };

    const snapshot: StoreState = {
      clock: { ms: 2000, seq: 0 },
      collections: {
        users: {
          documents: {
            "1": {
              id: { "~val": "1", "~ts": stamp },
            },
          },
          tombstones: {},
        },
      },
    };

    const diff = mergeState(currentState, snapshot, config);

    expect(diff).toEqual({ users: true });
    expect(currentState.collections["users"]).toBeDefined();
  });

  test("ignores collections not in config", () => {
    const config: StoreConfig = {
      users: define({} as any, (d: any) => d.id),
    };

    const currentState: StoreState = {
      clock: { ms: 1000, seq: 0 },
      collections: {},
    };

    const snapshot: StoreState = {
      clock: { ms: 2000, seq: 0 },
      collections: {
        users: { documents: {}, tombstones: {} },
        unknown: { documents: {}, tombstones: {} },
      },
    };

    const diff = mergeState(currentState, snapshot, config);

    expect(diff).toEqual({ users: true });
    expect(currentState.collections["unknown"]).toBeDefined();
  });

  test("merges tombstones correctly", () => {
    const config: StoreConfig = {
      users: define({} as any, (d: any) => d.id),
    };

    const stamp1 = makeStamp(1000, 0);
    const stamp2 = makeStamp(2000, 0);

    const currentState: StoreState = {
      clock: { ms: 1000, seq: 0 },
      collections: {
        users: {
          documents: {},
          tombstones: { "1": stamp1 },
        },
      },
    };

    const snapshot: StoreState = {
      clock: { ms: 2000, seq: 0 },
      collections: {
        users: {
          documents: {},
          tombstones: { "2": stamp2 },
        },
      },
    };

    const diff = mergeState(currentState, snapshot, config);

    expect(diff).toEqual({ users: true });
    expect(currentState.collections?.["users"]?.tombstones["1"]).toBeDefined();
    expect(currentState.collections?.["users"]?.tombstones["2"]).toBeDefined();
  });
});

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
