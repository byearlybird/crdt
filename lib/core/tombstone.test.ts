import { describe, expect, test } from "vitest";
import { makeStamp } from "./clock";
import { isDeleted, mergeTombstones, type Tombstones } from "./tombstone";

const t1 = makeStamp(1000, 0);
const t2 = makeStamp(2000, 0);

describe("isDeleted", () => {
  test("returns true when id is present in tombstones", () => {
    const tombstones: Tombstones = { "1": t1 };
    expect(isDeleted("1", tombstones)).toBe(true);
  });

  test("returns false when id is absent from tombstones", () => {
    const tombstones: Tombstones = { "1": t1 };
    expect(isDeleted("2", tombstones)).toBe(false);
  });

  test("returns false when tombstones is empty", () => {
    expect(isDeleted("1", {})).toBe(false);
  });
});

describe("mergeTombstones", () => {
  test("chooses target when both have key and target stamp is higher", () => {
    const target: Tombstones = {
      "1": t2,
    };
    const source: Tombstones = {
      "1": t1,
    };

    const result = mergeTombstones(target, source);

    expect(result["1"]).toBe(t2);
  });

  test("chooses source when both have key and source stamp is higher", () => {
    const target: Tombstones = {
      "1": t1,
    };
    const source: Tombstones = {
      "1": t2,
    };

    const result = mergeTombstones(target, source);

    expect(result["1"]).toBe(t2);
  });

  test("includes key that only exists in source", () => {
    const target: Tombstones = {};
    const source: Tombstones = {
      "2": t1,
    };

    const result = mergeTombstones(target, source);

    expect(result["2"]).toBe(t1);
  });

  test("includes key that only exists in target", () => {
    const target: Tombstones = {
      "3": t1,
    };
    const source: Tombstones = {};

    const result = mergeTombstones(target, source);

    expect(result["3"]).toBe(t1);
  });

  test("merges multiple keys with mixed scenarios", () => {
    const target: Tombstones = {
      "1": t2,
      "2": t1,
      "3": t1,
    };
    const source: Tombstones = {
      "1": t1,
      "2": t2,
      "4": t1,
    };

    const result = mergeTombstones(target, source);

    expect(result["1"]).toBe(t2);
    expect(result["2"]).toBe(t2);
    expect(result["3"]).toBe(t1);
    expect(result["4"]).toBe(t1);
  });

  test("handles empty inputs", () => {
    expect(mergeTombstones({}, {})).toEqual({});
    expect(mergeTombstones({}, { "1": t1 })).toEqual({
      "1": t1,
    });
    expect(mergeTombstones({ "1": t1 }, {})).toEqual({
      "1": t1,
    });
  });
});
