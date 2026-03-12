import { hash as hashValue } from "./hash";
import type { Atom, Stamp } from "./types";

export function makeAtom(value: unknown, timestamp: Stamp): Atom {
  return {
    "~d": value,
    "~t": timestamp,
    "~h": hashAtom(value, timestamp),
  };
}

export function patchAtom(state: Atom, value: unknown, timestamp: Stamp): void {
  if (timestamp > state["~t"]) {
    state["~d"] = value;
    state["~t"] = timestamp;
    state["~h"] = hashAtom(value, timestamp);
  }
}

export function hashAtom(value: unknown, timestamp: Stamp): number {
  return hashValue(JSON.stringify(value) + "\0" + timestamp);
}
