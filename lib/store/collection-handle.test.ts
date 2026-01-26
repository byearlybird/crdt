import { describe, expect, test } from "vitest";
import type { Collection, Tombstones } from "../core";
import { createHandle } from "./collection-handle";

type Doc = { id: string; name: string };

function setup() {
  const collection: Collection<Doc> = {} as Collection<Doc>;
  const tombstones: Tombstones = {};
  let ts = 0;
  const handle = createHandle<Doc>({
    getCollection: () => collection,
    getTombstones: () => tombstones,
    getTimestamp: () => String(++ts),
    validate: (d) => d as Doc,
    getId: (d) => d.id,
  });
  return { handle, collection, tombstones };
}

describe("createHandle", () => {
  test("add and get", () => {
    const { handle } = setup();
    handle.add({ id: "1", name: "Alice" });
    expect(handle.get("1")).toEqual({ id: "1", name: "Alice" });
  });

  test("list returns non-deleted docs", () => {
    const { handle } = setup();
    handle.add({ id: "1", name: "Alice" });
    handle.add({ id: "2", name: "Bob" });
    expect(handle.list()).toHaveLength(2);
    expect(
      handle
        .list()
        .map((d) => d.name)
        .sort(),
    ).toEqual(["Alice", "Bob"]);
  });

  test("update merges partial data", () => {
    const { handle } = setup();
    handle.add({ id: "1", name: "Alice" });
    handle.update("1", { name: "Bob" });
    expect(handle.get("1")).toEqual({ id: "1", name: "Bob" });
  });

  test("update on missing id is no-op", () => {
    const { handle } = setup();
    handle.update("missing", { name: "x" });
    expect(handle.get("missing")).toBeUndefined();
  });

  test("remove deletes doc and tombstones", () => {
    const { handle } = setup();
    handle.add({ id: "1", name: "Alice" });
    handle.remove("1");
    expect(handle.get("1")).toBeUndefined();
    expect(handle.list()).toHaveLength(0);
  });

  test("add throws on tombstoned id", () => {
    const { handle } = setup();
    handle.add({ id: "1", name: "Alice" });
    handle.remove("1");
    expect(() => handle.add({ id: "1", name: "Bob" })).toThrow(
      'Cannot add document with tombstoned id "1"',
    );
  });
});
