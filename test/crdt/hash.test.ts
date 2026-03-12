import { describe, expect, test } from "bun:test";
import { hash, reduceHashes, reduceItemHashes } from "#crdt/hash";

describe("hash", () => {
  test("returns a number", () => {
    expect(typeof hash("hello")).toBe("number");
  });

  test("is deterministic", () => {
    expect(hash("hello")).toBe(hash("hello"));
  });

  test("different inputs produce different hashes", () => {
    expect(hash("a")).not.toBe(hash("b"));
  });

  test("handles empty string", () => {
    expect(typeof hash("")).toBe("number");
  });
});

describe("reduceHashes", () => {
  test("XOR-reduces a list of hashes deterministically", () => {
    const h1 = hash("a");
    const h2 = hash("b");
    const h3 = hash("c");

    const combined1 = reduceHashes([h1, h2, h3]);
    const combined2 = reduceHashes([h1, h2, h3]);

    expect(combined1).toBe(combined2);
  });
});

describe("reduceItemHashes", () => {
  test("extracts ~h from items and reduces like reduceHashes", () => {
    const items = [{ "~h": hash("a") }, { "~h": hash("b") }, { "~h": hash("c") }];

    const direct = reduceHashes(items.map((i) => i["~h"]));
    const viaItems = reduceItemHashes(items);

    expect(viaItems).toBe(direct);
  });
});
