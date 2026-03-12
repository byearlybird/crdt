import { latestItemStamp } from "./stamp";
import * as Atom from "./atom";
import type { DocData, Doc, Stamp } from "./types";
import { reduceItemHashes } from "./hash";
import { flatten, unflatten } from "./flatten";

export function makeDoc(data: DocData): Doc {
  return {
    "~d": data,
    "~h": hashDocData(data),
    "~t": latestDocDataStamp(data),
  };
}

export function patchDoc(state: Doc, data: DocData): void {
  for (const [key, atom] of Object.entries(data)) {
    Atom.patchAtom(state["~d"][key]!, atom["~d"], atom["~t"]);
  }
  state["~h"] = hashDocData(state["~d"]);
  state["~t"] = latestDocDataStamp(state["~d"]);
}

export function makeDataFromPOJO(record: Record<string, unknown>, timestamp: Stamp): DocData {
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
