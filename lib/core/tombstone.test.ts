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
      "1": "000000000000000002000000",
      "2": "000000000000000001000000",
      "3": "000000000000000001000000",
    };
    const source: Tombstones = {
      "1": "000000000000000001000000",
      "2": "000000000000000002000000",
      "4": "000000000000000001000000",
    };

    const result = mergeTombstones(target, source);

    expect(result["1"]).toBe("000000000000000002000000");
    expect(result["2"]).toBe("000000000000000002000000");
    expect(result["3"]).toBe("000000000000000001000000");
    expect(result["4"]).toBe("000000000000000001000000");
  });

  test("handles empty inputs", () => {
    expect(mergeTombstones({}, {})).toEqual({});
    expect(mergeTombstones({}, { "1": "000000000000000001000000" })).toEqual({
      "1": "000000000000000001000000",
    });
    expect(mergeTombstones({ "1": "000000000000000001000000" }, {})).toEqual({
      "1": "000000000000000001000000",
    });
  });
});
