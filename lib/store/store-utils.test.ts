import { describe, expect, test } from "vitest";
import { mergeState, validateCollectionNames, hasRelevantChange } from "./store-utils";
import type { StoreState } from "../core";
import type { StoreConfig } from "./schema";

describe("mergeState", () => {
  test("merges collection states correctly", () => {
    const config: StoreConfig = {
      users: { schema: {} as any, getId: (d: any) => d.id },
    };

    const currentState: StoreState = {
      clock: { ms: 1000, seq: 0 },
      collections: {
        users: {
          documents: {
            "1": {
              id: { "~val": "1", "~ts": "1000:0" },
              name: { "~val": "Alice", "~ts": "1000:0" },
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
              id: { "~val": "2", "~ts": "2000:0" },
              name: { "~val": "Bob", "~ts": "2000:0" },
            },
          },
          tombstones: {},
        },
      },
    };

    const diff = mergeState(currentState, snapshot, config);

    expect(diff).toEqual({ users: true });
    expect(currentState.collections.users?.documents["1"]).toBeDefined();
    expect(currentState.collections.users?.documents["2"]).toBeDefined();
  });

  test("advances clock based on snapshot", () => {
    const config: StoreConfig = {
      users: { schema: {} as any, getId: (d: any) => d.id },
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
      users: { schema: {} as any, getId: (d: any) => d.id },
      posts: { schema: {} as any, getId: (d: any) => d.id },
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
      users: { schema: {} as any, getId: (d: any) => d.id },
    };

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
              id: { "~val": "1", "~ts": "2000:0" },
            },
          },
          tombstones: {},
        },
      },
    };

    const diff = mergeState(currentState, snapshot, config);

    expect(diff).toEqual({ users: true });
    expect(currentState.collections.users).toBeDefined();
  });

  test("ignores collections not in config", () => {
    const config: StoreConfig = {
      users: { schema: {} as any, getId: (d: any) => d.id },
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
    expect(currentState.collections.unknown).toBeDefined();
  });

  test("merges tombstones correctly", () => {
    const config: StoreConfig = {
      users: { schema: {} as any, getId: (d: any) => d.id },
    };

    const currentState: StoreState = {
      clock: { ms: 1000, seq: 0 },
      collections: {
        users: {
          documents: {},
          tombstones: { "1": "1000:0" },
        },
      },
    };

    const snapshot: StoreState = {
      clock: { ms: 2000, seq: 0 },
      collections: {
        users: {
          documents: {},
          tombstones: { "2": "2000:0" },
        },
      },
    };

    const diff = mergeState(currentState, snapshot, config);

    expect(diff).toEqual({ users: true });
    expect(currentState.collections.users?.tombstones["1"]).toBeDefined();
    expect(currentState.collections.users?.tombstones["2"]).toBeDefined();
  });
});

describe("hasRelevantChange", () => {
  test("returns true when event includes subscribed collection", () => {
    const event = { users: true };
    const collections = ["users"];

    expect(hasRelevantChange(event, collections)).toBe(true);
  });

  test("returns false when event excludes subscribed collection", () => {
    const event = { posts: true };
    const collections = ["users"];

    expect(hasRelevantChange(event, collections)).toBe(false);
  });

  test("handles multiple collections in event", () => {
    const event = { users: true, posts: true };
    const collections = ["users"];

    expect(hasRelevantChange(event, collections)).toBe(true);
  });

  test("handles empty event", () => {
    const event = {};
    const collections = ["users"];

    expect(hasRelevantChange(event, collections)).toBe(false);
  });

  test("handles multiple subscribed collections", () => {
    const event = { comments: true };
    const collections = ["users", "posts"];

    expect(hasRelevantChange(event, collections)).toBe(false);
  });

  test("returns true when any subscribed collection changes", () => {
    const event = { posts: true };
    const collections = ["users", "posts"];

    expect(hasRelevantChange(event, collections)).toBe(true);
  });
});

describe("validateCollectionNames", () => {
  test("validates valid collection names", () => {
    const config: StoreConfig = {
      users: { schema: {} as any, getId: (d: any) => d.id },
      posts: { schema: {} as any, getId: (d: any) => d.id },
    };

    expect(() => {
      validateCollectionNames(["users", "posts"], config);
    }).not.toThrow();
  });

  test("throws on invalid collection name", () => {
    const config: StoreConfig = {
      users: { schema: {} as any, getId: (d: any) => d.id },
    };

    expect(() => {
      validateCollectionNames(["users", "invalid"], config);
    }).toThrow('Collection "invalid" not found');
  });

  test("handles empty array", () => {
    const config: StoreConfig = {
      users: { schema: {} as any, getId: (d: any) => d.id },
    };

    expect(() => {
      validateCollectionNames([], config);
    }).not.toThrow();
  });

  test("throws on first invalid collection", () => {
    const config: StoreConfig = {
      users: { schema: {} as any, getId: (d: any) => d.id },
    };

    expect(() => {
      validateCollectionNames(["invalid1", "invalid2"], config);
    }).toThrow('Collection "invalid1" not found');
  });
});
