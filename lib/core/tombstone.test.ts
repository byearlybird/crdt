import { describe, test, expect } from "bun:test";
import { mergeTombstones, type Tombstones } from "./tombstone";

describe("mergeTombstones", () => {
  test("chooses target when both have key and target stamp is higher", () => {
    const target: Tombstones = {
      "1": "000000000000000002000000",
    };
    const source: Tombstones = {
      "1": "000000000000000001000000",
    };

    const result = mergeTombstones(target, source);

    expect(result["1"]).toBe("000000000000000002000000");
  });

  test("chooses source when both have key and source stamp is higher", () => {
    const target: Tombstones = {
      "1": "000000000000000001000000",
    };
    const source: Tombstones = {
      "1": "000000000000000002000000",
    };

    const result = mergeTombstones(target, source);

    expect(result["1"]).toBe("000000000000000002000000");
  });

  test("includes key that only exists in source", () => {
    const target: Tombstones = {};
    const source: Tombstones = {
      "2": "000000000000000001000000",
    };

    const result = mergeTombstones(target, source);

    expect(result["2"]).toBe("000000000000000001000000");
  });

  test("includes key that only exists in target", () => {
    const target: Tombstones = {
      "3": "000000000000000001000000",
    };
    const source: Tombstones = {};

    const result = mergeTombstones(target, source);

    expect(result["3"]).toBe("000000000000000001000000");
  });

  test("merges multiple keys with mixed scenarios", () => {
    const target: Tombstones = {
      "1": "000000000000000002000000", // target wins
      "2": "000000000000000001000000", // source wins
      "3": "000000000000000001000000", // only in target
    };
    const source: Tombstones = {
      "1": "000000000000000001000000",
      "2": "000000000000000002000000",
      "4": "000000000000000001000000", // only in source
    };

    const result = mergeTombstones(target, source);

    expect(result["1"]).toBe("000000000000000002000000"); // target wins
    expect(result["2"]).toBe("000000000000000002000000"); // source wins
    expect(result["3"]).toBe("000000000000000001000000"); // only in target
    expect(result["4"]).toBe("000000000000000001000000"); // only in source
  });

  test("handles empty target", () => {
    const target: Tombstones = {};
    const source: Tombstones = {
      "1": "000000000000000001000000",
      "2": "000000000000000002000000",
    };

    const result = mergeTombstones(target, source);

    expect(result).toEqual(source);
  });

  test("handles empty source", () => {
    const target: Tombstones = {
      "1": "000000000000000001000000",
      "2": "000000000000000002000000",
    };
    const source: Tombstones = {};

    const result = mergeTombstones(target, source);

    expect(result).toEqual(target);
  });

  test("handles both empty", () => {
    const target: Tombstones = {};
    const source: Tombstones = {};

    const result = mergeTombstones(target, source);

    expect(result).toEqual({});
  });
});
