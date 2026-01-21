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
    return { ms: next.ms, seq: next.seq };
  } else if (next.ms === current.ms) {
    return { ms: current.ms, seq: Math.max(current.seq, next.seq) + 1 };
  } else {
    return { ms: current.ms, seq: current.seq + 1 };
  }
}

export function makeStamp(ms: number, seq: number): string {
  return `${toHex(ms, MS_LENGTH)}${toHex(seq, SEQ_LENGTH)}${nonce(NONCE_LENGTH)}`;
}
