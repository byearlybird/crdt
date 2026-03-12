import * as Atom from "./atom";
import { flatten, unflatten } from "./flatten";
import { reduceItemHashes } from "./hash";
import { latestItemStamp } from "./stamp";
import type { Doc, DocData, Stamp } from "./types";

export function makeDoc(data: DocData): Doc {
	return {
		"~d": data,
		"~h": hashDocData(data),
		"~t": latestDocDataStamp(data),
	};
}

export function patchDoc(state: Doc, data: DocData): void {
	for (const [key, atom] of Object.entries(data)) {
		const existingAtom = state["~d"][key];
		if (existingAtom) {
			Atom.patchAtom(existingAtom, atom["~d"], atom["~t"]);
		} else {
			state["~d"][key] = atom;
		}
	}
	state["~h"] = hashDocData(state["~d"]);
	state["~t"] = latestDocDataStamp(state["~d"]);
}

export function makeDataFromPOJO(
	record: Record<string, unknown>,
	timestamp: Stamp,
): DocData {
	const atoms = flatten(record, (value) => Atom.makeAtom(value, timestamp));
	return atoms;
}

export function makePOJO<T extends Record<string, unknown>>(state: Doc): T {
	const flattened: Record<string, unknown> = {};
	for (const [key, atom] of Object.entries(state["~d"])) {
		flattened[key] = atom["~d"];
	}
	return unflatten(flattened) as T;
}

export function latestDocDataStamp(data: DocData): Stamp {
	return latestItemStamp(Object.values(data));
}

export function hashDocData(data: DocData): number {
	return reduceItemHashes(Object.values(data));
}
