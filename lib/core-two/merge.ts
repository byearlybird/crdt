import { Atomizer } from "./atomizer";
import { KEYS } from "./types";
import type { Document } from "./types";

/** Merges incoming doc fields into local. Adds new keys from incoming; LWW on conflicts. */
export function mergeDocs(local: Document<any>, incoming: Document<any>): Document<any> {
  const merged = { ...local } as Document<any>;
  let hasChanges = false;

  for (const key of Object.keys(incoming)) {
    const localAtom = local[key];
    const incomingAtom = incoming[key];
    if (incomingAtom === undefined) continue;

    if (!localAtom) {
      if (Atomizer.isAtom(incomingAtom)) {
        merged[key] = incomingAtom;
        hasChanges = true;
      }
      continue;
    }

    if (Atomizer.isAtom(localAtom) && Atomizer.isAtom(incomingAtom)) {
      if (incomingAtom[KEYS.TS] > localAtom[KEYS.TS]) {
        merged[key] = incomingAtom;
        hasChanges = true;
      }
    }
  }

  return hasChanges ? merged : local;
}
