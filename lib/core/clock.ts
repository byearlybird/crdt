import { nonce, toHex } from "./hex";

const MS_LENGTH = 12;
const SEQ_LENGTH = 6;
const NONCE_LENGTH = 6;
const STAMP_LENGTH = MS_LENGTH + SEQ_LENGTH + NONCE_LENGTH;
const HEX_PATTERN = /^[0-9a-f]+$/i;

export type Clock = {
  ms: number;
  seq: number;
};

/**
 * Branded type for HLC timestamps.
 * Stamps are lexicographically sortable hex strings encoding (ms, seq, nonce).
 */
export type Stamp = string & { readonly __brand: "Stamp" };

export function advanceClock(current: Clock, next: Clock): Clock {
  if (next.ms > current.ms) {
    return { ms: next.ms, seq: next.seq };
  } else if (next.ms === current.ms) {
    return { ms: current.ms, seq: Math.max(current.seq, next.seq) + 1 };
  } else {
    return { ms: current.ms, seq: current.seq + 1 };
  }
}

export function makeStamp(ms: number, seq: number): Stamp {
  return `${toHex(ms, MS_LENGTH)}${toHex(seq, SEQ_LENGTH)}${nonce(NONCE_LENGTH)}` as Stamp;
}

/**
 * Parse and validate a string as a Stamp. Use when deserializing stored state.
 * Throws if the value is not a valid 24-character hex string.
 */
export function asStamp(value: string): Stamp {
  if (value.length !== STAMP_LENGTH || !HEX_PATTERN.test(value)) {
    throw new Error(`Invalid stamp: expected ${STAMP_LENGTH} hex characters, got "${value}"`);
  }
  return value as Stamp;
}
