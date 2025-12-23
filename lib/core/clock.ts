import { nonce, toHex } from "./hex";

const MS_LENGTH = 12;
const SEQ_LENGTH = 6;
const NONCE_LENGTH = 6;

export type Clock = {
  ms: number;
  seq: number;
};

export function advanceClock(current: Clock, next: Clock): Clock {
  if (next.ms > current.ms) {
    // Physical time advanced: update ms and reset seq
    return { ms: next.ms, seq: next.seq };
  } else if (next.ms === current.ms) {
    // Same physical time: advance seq to ensure monotonicity
    return { ms: current.ms, seq: Math.max(current.seq, next.seq) + 1 };
  } else {
    // Physical time went backward (clock skew): increment seq to maintain monotonicity
    return { ms: current.ms, seq: current.seq + 1 };
  }
}

export function makeStamp(ms: number, seq: number): string {
  return `${toHex(ms, MS_LENGTH)}${toHex(seq, SEQ_LENGTH)}${nonce(NONCE_LENGTH)}`;
}

export function parseStamp(stamp: string): { ms: number; seq: number } {
  return {
    ms: parseInt(stamp.slice(0, MS_LENGTH), 16),
    seq: parseInt(stamp.slice(MS_LENGTH, MS_LENGTH + SEQ_LENGTH), 16),
  };
}
