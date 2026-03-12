import { hashAtom, makeAtom } from "#crdt/atom";
import { hashDocData, makeDoc } from "#crdt/document";
import type { Doc, DocData, Stamp } from "#crdt/types";

type CipherCodec = (value: unknown) => unknown;

type Cipher = {
  encodeDoc: (doc: Doc) => Doc;
  decodeDoc: (doc: Doc) => Doc;
};

export function assertCipherIntegrity(cipher: Cipher): void {
  const original = makeDoc({
    a: makeAtom(1, "a@b@c" as Stamp),
  });
  const encoded = cipher.encodeDoc(original);
  cipher.decodeDoc(encoded);
}

export function createCipher(encode: CipherCodec, decode: CipherCodec): Cipher {
  return {
    encodeDoc(doc) {
      const data: DocData = {};
      for (const [key, atom] of Object.entries(doc["~d"])) {
        data[key] = { ...atom, "~d": encode(atom["~d"]) };
      }
      return { ...doc, "~d": data };
    },

    decodeDoc(doc) {
      const data: DocData = {};
      for (const [key, atom] of Object.entries(doc["~d"])) {
        const decoded = decode(atom["~d"]);
        const expectedHash = hashAtom(decoded, atom["~t"]);
        if (expectedHash !== atom["~h"]) {
          throw new Error(
            `Integrity check failed for key "${key}": expected hash ${atom["~h"]}, got ${expectedHash}`,
          );
        }
        data[key] = { ...atom, "~d": decoded };
      }

      const expectedDocHash = hashDocData(data);
      if (expectedDocHash !== doc["~h"]) {
        throw new Error(
          `Integrity check failed for doc: expected hash ${doc["~h"]}, got ${expectedDocHash}`,
        );
      }

      return { ...doc, "~d": data };
    },
  };
}
