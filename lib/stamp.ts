import { nonce, toHex } from "./hex";

const MS_LENGTH = 12;
const SEQ_LENGTH = 6;
const NONCE_LENGTH = 6;

export function makeStamp(ms: number, seq: number): string {
  return `${toHex(ms, MS_LENGTH)}${toHex(seq, SEQ_LENGTH)}${nonce(NONCE_LENGTH)}`;
}

export function parseStamp(stamp: string): { ms: number; seq: number } {
  return {
    ms: parseInt(stamp.slice(0, MS_LENGTH), 16),
    seq: parseInt(stamp.slice(MS_LENGTH, MS_LENGTH + SEQ_LENGTH), 16),
  };
}
