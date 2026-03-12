import { describe, expect, test } from "bun:test";
import { makeStamp } from "#crdt/stamp";
import * as Atom from "#crdt/atom";
import { makeDoc } from "#crdt/document";
import { assertCipherIntegrity, createCipher } from "#sync/cipher";
import type { DocData } from "#crdt/types";

describe("createCipher", () => {
  const rot13: (v: unknown) => unknown = (v) => {
    if (typeof v !== "string") return v;
    return v.replace(/[a-zA-Z]/g, (c) => {
      const base = c <= "Z" ? 65 : 97;
      return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
    });
  };

  test("encodeDoc transforms each atom value via the encode function", () => {
    const stamp = makeStamp(1, 0, "device");
    const data: DocData = {
      name: Atom.makeAtom("alice", stamp),
      age: Atom.makeAtom(30, stamp),
    };
    const doc = makeDoc(data);

    const cipher = createCipher(rot13, rot13);
    const encoded = cipher.encodeDoc(doc);

    expect(encoded["~d"]["name"]!["~d"]).toBe("nyvpr");
    expect(encoded["~d"]["age"]!["~d"]).toBe(30);
  });

  test("encodeDoc preserves atom timestamps and hashes", () => {
    const stamp = makeStamp(1, 0, "device");
    const data: DocData = {
      name: Atom.makeAtom("alice", stamp),
    };
    const doc = makeDoc(data);

    const cipher = createCipher(rot13, rot13);
    const encoded = cipher.encodeDoc(doc);

    expect(encoded["~d"]["name"]!["~t"]).toBe(stamp);
    expect(encoded["~d"]["name"]!["~h"]).toBe(doc["~d"]["name"]!["~h"]);
  });

  test("decodeDoc restores original values after a roundtrip", () => {
    const stamp = makeStamp(1, 0, "device");
    const data: DocData = {
      name: Atom.makeAtom("alice", stamp),
      age: Atom.makeAtom(30, stamp),
    };
    const doc = makeDoc(data);

    const cipher = createCipher(rot13, rot13);
    const decoded = cipher.decodeDoc(cipher.encodeDoc(doc));

    expect(decoded["~d"]["name"]!["~d"]).toBe("alice");
    expect(decoded["~d"]["age"]!["~d"]).toBe(30);
  });

  test("decodeDoc throws when an atom hash does not match", () => {
    const stamp = makeStamp(1, 0, "device");
    const data: DocData = {
      name: Atom.makeAtom("alice", stamp),
    };
    const doc = makeDoc(data);

    const badDecode = (_v: unknown) => "tampered";
    const cipher = createCipher(rot13, badDecode);
    const encoded = cipher.encodeDoc(doc);

    expect(() => cipher.decodeDoc(encoded)).toThrow(/Integrity check failed for key "name"/);
  });

  test("decodeDoc throws when the document hash does not match", () => {
    const stamp = makeStamp(1, 0, "device");
    const data: DocData = {
      name: Atom.makeAtom("alice", stamp),
    };
    const doc = makeDoc(data);

    const cipher = createCipher(rot13, rot13);
    const encoded = cipher.encodeDoc(doc);

    const corruptedDoc = { ...encoded, "~h": encoded["~h"] ^ 1 };

    expect(() => cipher.decodeDoc(corruptedDoc)).toThrow(/Integrity check failed for doc/);
  });

  test("encodeDoc does not mutate the original document", () => {
    const stamp = makeStamp(1, 0, "device");
    const data: DocData = {
      name: Atom.makeAtom("hello", stamp),
    };
    const doc = makeDoc(data);
    const originalHash = doc["~h"];
    const originalValue = doc["~d"]["name"]!["~d"];

    const cipher = createCipher(rot13, rot13);
    cipher.encodeDoc(doc);

    expect(doc["~h"]).toBe(originalHash);
    expect(doc["~d"]["name"]!["~d"]).toBe(originalValue);
  });
});

describe("assertCipherIntegrity", () => {
  test("does not throw for a valid encode/decode pair", () => {
    const identity = (v: unknown) => v;
    const cipher = createCipher(identity, identity);

    expect(() => assertCipherIntegrity(cipher)).not.toThrow();
  });

  test("throws when decode produces mismatched hashes", () => {
    const identity = (v: unknown) => v;
    const badDecode = (_v: unknown) => "corrupted";
    const cipher = createCipher(identity, badDecode);

    expect(() => assertCipherIntegrity(cipher)).toThrow(/Integrity check failed/);
  });
});
