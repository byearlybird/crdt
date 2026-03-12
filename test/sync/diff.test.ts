import { describe, expect, test } from "bun:test";
import * as Atom from "#crdt/atom";
import { makeDoc } from "#crdt/document";
import { makeStamp } from "#crdt/stamp";
import type { DocData } from "#crdt/types";
import { takeAtomHashes, takeDiffedData } from "#sync/diff";

describe("takeAtomHashes", () => {
	test("returns a hash for each key in the doc data", () => {
		const stamp = makeStamp(1, 0, "device");
		const data: DocData = {
			name: Atom.makeAtom("alice", stamp),
			age: Atom.makeAtom(30, stamp),
		};
		const doc = makeDoc(data);

		const hashes = takeAtomHashes(doc);

		expect(Object.keys(hashes).sort()).toEqual(["age", "name"]);
		expect(hashes.name).toBe(data.name?.["~h"]);
		expect(hashes.age).toBe(data.age?.["~h"]);
	});

	test("returns an empty object for a doc with no data", () => {
		const doc = makeDoc({});
		const hashes = takeAtomHashes(doc);
		expect(hashes).toEqual({});
	});
});

describe("takeDiffedData", () => {
	test("returns atoms whose hashes differ from the provided hash map", () => {
		const stamp1 = makeStamp(1, 0, "device");
		const stamp2 = makeStamp(2, 0, "device");
		const original: DocData = {
			name: Atom.makeAtom("alice", stamp1),
			age: Atom.makeAtom(30, stamp1),
		};
		const originalDoc = makeDoc(original);
		const originalHashes = takeAtomHashes(originalDoc);

		const updated: DocData = {
			name: Atom.makeAtom("alice", stamp1),
			age: Atom.makeAtom(31, stamp2),
		};
		const updatedDoc = makeDoc(updated);

		const diff = takeDiffedData(updatedDoc, originalHashes);

		expect(Object.keys(diff)).toEqual(["age"]);
		expect(diff.age?.["~d"]).toBe(31);
	});

	test("returns an empty object when all hashes match", () => {
		const stamp = makeStamp(1, 0, "device");
		const data: DocData = {
			name: Atom.makeAtom("alice", stamp),
		};
		const doc = makeDoc(data);
		const hashes = takeAtomHashes(doc);

		const diff = takeDiffedData(doc, hashes);

		expect(diff).toEqual({});
	});

	test("returns all atoms when the hash map is empty", () => {
		const stamp = makeStamp(1, 0, "device");
		const data: DocData = {
			name: Atom.makeAtom("alice", stamp),
			age: Atom.makeAtom(30, stamp),
		};
		const doc = makeDoc(data);

		const diff = takeDiffedData(doc, {});

		expect(Object.keys(diff).sort()).toEqual(["age", "name"]);
	});

	test("includes new keys not present in the hash map", () => {
		const stamp1 = makeStamp(1, 0, "device");
		const stamp2 = makeStamp(2, 0, "device");
		const original: DocData = {
			name: Atom.makeAtom("alice", stamp1),
		};
		const originalDoc = makeDoc(original);
		const originalHashes = takeAtomHashes(originalDoc);

		const updated: DocData = {
			name: Atom.makeAtom("alice", stamp1),
			email: Atom.makeAtom("alice@example.com", stamp2),
		};
		const updatedDoc = makeDoc(updated);

		const diff = takeDiffedData(updatedDoc, originalHashes);

		expect(Object.keys(diff)).toEqual(["email"]);
		expect(diff.email?.["~d"]).toBe("alice@example.com");
	});
});
