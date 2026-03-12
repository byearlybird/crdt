import type { Hashed } from "./types";

const FNV_OFFSET = 0x811c9dc5n;
const FNV_PRIME = 0x01000193n;
const MASK_32 = 0xffffffffn;

export function hash(input: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < input.length; i++) {
    h ^= BigInt(input.charCodeAt(i));
    h = (h * FNV_PRIME) & MASK_32;
  }
  return Number(h & MASK_32);
}

export function reduceHashes(hashes: Iterable<number>): number {
  let h = 0;
  for (const hash of hashes) h ^= hash;
  return h;
}

export function reduceItemHashes(items: Iterable<Hashed>): number {
  const hashes: number[] = [];
  for (const item of items) hashes.push(item["~h"]);
  return reduceHashes(hashes);
}
