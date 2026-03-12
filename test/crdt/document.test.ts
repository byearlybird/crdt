import { describe, expect, test } from "bun:test";
import { makeStamp } from "#crdt/stamp";
import * as Atom from "#crdt/atom";
import * as Document from "#crdt/document";
import type { DocData } from "#crdt/types";

describe("makeDoc", () => {
  test("creates a doc whose data matches the provided DocData", () => {
    const stamp = makeStamp(1, 0, "device");
    const data: DocData = {
      name: Atom.makeAtom("alice", stamp),
    };

    const doc = Document.makeDoc(data);

    expect(doc["~d"]).toBe(data);
  });

  test("sets the doc timestamp to the latest atom timestamp", () => {
    const stamp1 = makeStamp(1, 0, "device");
    const stamp2 = makeStamp(2, 0, "device");
    const data: DocData = {
      first: Atom.makeAtom("a", stamp1),
      second: Atom.makeAtom("b", stamp2),
    };

    const doc = Document.makeDoc(data);

    expect(doc["~t"]).toBe(stamp2);
  });
});

describe("patchDoc", () => {
  test("applies incoming atoms that have a later timestamp", () => {
    const stamp1 = makeStamp(1, 0, "device");
    const stamp2 = makeStamp(2, 0, "device");
    const baseData: DocData = {
      field: Atom.makeAtom("old", stamp1),
    };
    const state = Document.makeDoc({ ...baseData });

    const incoming: DocData = {
      field: Atom.makeAtom("new", stamp2),
    };

    Document.patchDoc(state, incoming);

    expect(state["~d"]["field"]!["~d"]).toBe("new");
    expect(state["~t"]).toBe(stamp2);
  });

  test("ignores incoming atoms with an earlier timestamp", () => {
    const stamp1 = makeStamp(1, 0, "device");
    const stamp2 = makeStamp(2, 0, "device");
    const baseData: DocData = {
      field: Atom.makeAtom("current", stamp2),
    };
    const state = Document.makeDoc({ ...baseData });

    const incoming: DocData = {
      field: Atom.makeAtom("older", stamp1),
    };

    Document.patchDoc(state, incoming);

    expect(state["~d"]["field"]!["~d"]).toBe("current");
    expect(state["~t"]).toBe(stamp2);
  });
});

describe("makeDataFromPOJO", () => {
  test("wraps each top-level field as an atom with the given timestamp", () => {
    const stamp = makeStamp(1, 0, "device");
    const pojo = { name: "alice", age: 30 };

    const data = Document.makeDataFromPOJO(pojo, stamp);

    expect(Object.keys(data).sort()).toEqual(["age", "name"]);
    expect(data["name"]!["~d"]).toBe("alice");
    expect(data["name"]!["~t"]).toBe(stamp);
    expect(data["age"]!["~d"]).toBe(30);
    expect(data["age"]!["~t"]).toBe(stamp);
  });

  test("flattens nested objects into dot-separated keys", () => {
    const stamp = makeStamp(1, 0, "device");
    const pojo = { address: { city: "NYC", zip: "10001" } };

    const data = Document.makeDataFromPOJO(pojo, stamp);

    expect(Object.keys(data).sort()).toEqual(["address.city", "address.zip"]);
    expect(data["address.city"]!["~d"]).toBe("NYC");
    expect(data["address.zip"]!["~d"]).toBe("10001");
  });
});

describe("makePOJO", () => {
  test("reconstructs a flat plain object from a doc", () => {
    const stamp = makeStamp(1, 0, "device");
    const pojo = { name: "alice", age: 30 };
    const data = Document.makeDataFromPOJO(pojo, stamp);
    const doc = Document.makeDoc(data);

    const result = Document.makePOJO<typeof pojo>(doc);

    expect(result).toEqual(pojo);
  });

  test("unflattens dot-separated keys into nested objects", () => {
    const stamp = makeStamp(1, 0, "device");
    const data: DocData = {
      "a.b": Atom.makeAtom(1, stamp),
      "a.c": Atom.makeAtom(2, stamp),
    };
    const doc = Document.makeDoc(data);

    const result = Document.makePOJO<{ a: { b: number; c: number } }>(doc);

    expect(result).toEqual({ a: { b: 1, c: 2 } });
  });
});
