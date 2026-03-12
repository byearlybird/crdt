import { describe, expect, test } from "bun:test";
import * as Atom from "#crdt/atom";
import { makeStamp } from "#crdt/stamp";

describe("makeAtom", () => {
	test("creates an atom with the given value and timestamp", () => {
		const stamp = makeStamp(1, 0, "device");
		const value = { foo: "bar" };

		const atom = Atom.makeAtom(value, stamp);

		expect(atom["~d"]).toEqual(value);
		expect(atom["~t"]).toBe(stamp);
	});

	test("computes a deterministic hash from value and timestamp", () => {
		const stamp1 = makeStamp(1, 0, "device");
		const stamp2 = makeStamp(2, 0, "device");

		const a1 = Atom.makeAtom({ foo: "bar" }, stamp1);
		const a2 = Atom.makeAtom({ foo: "bar" }, stamp1);
		const a3 = Atom.makeAtom({ foo: "baz" }, stamp1);
		const a4 = Atom.makeAtom({ foo: "bar" }, stamp2);

		expect(a1["~h"]).toBe(a2["~h"]);
		expect(a1["~h"]).not.toBe(a3["~h"]);
		expect(a1["~h"]).not.toBe(a4["~h"]);
	});
});

describe("patchAtom", () => {
	test("updates the atom when the incoming timestamp is later", () => {
		const stamp1 = makeStamp(1, 0, "device");
		const stamp2 = makeStamp(2, 0, "device");
		const atom = Atom.makeAtom("old", stamp1);

		Atom.patchAtom(atom, "new", stamp2);

		expect(atom["~d"]).toBe("new");
		expect(atom["~t"]).toBe(stamp2);
	});

	test("does not update the atom when the incoming timestamp is earlier", () => {
		const stamp1 = makeStamp(1, 0, "device");
		const stamp2 = makeStamp(2, 0, "device");
		const atom = Atom.makeAtom("current", stamp2);

		Atom.patchAtom(atom, "older", stamp1);

		expect(atom["~d"]).toBe("current");
		expect(atom["~t"]).toBe(stamp2);
	});

	test("does not update the atom when the incoming timestamp is equal", () => {
		const stamp = makeStamp(1, 0, "device");
		const atom = Atom.makeAtom("current", stamp);

		Atom.patchAtom(atom, "same-time", stamp);

		expect(atom["~d"]).toBe("current");
		expect(atom["~t"]).toBe(stamp);
	});
});
