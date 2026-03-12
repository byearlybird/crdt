import type { Doc, DocData } from "#crdt/types";

export type AtomHashes = Record<string, number>;

export function takeAtomHashes(doc: Doc): AtomHashes {
  const atomHashes: AtomHashes = {};
  for (const [key, atom] of Object.entries(doc["~d"])) {
    atomHashes[key] = atom["~h"];
  }
  return atomHashes;
}

export function takeDiffedData(doc: Doc, atomHashes: AtomHashes): DocData {
  const diffedData: DocData = {};
  for (const [key, atom] of Object.entries(doc["~d"])) {
    if (atomHashes[key] !== atom["~h"]) {
      diffedData[key] = atom;
    }
  }
  return diffedData;
}
