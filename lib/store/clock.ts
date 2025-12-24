import { atom } from "nanostores";
import type { Clock } from "../core/clock";
import { advanceClock, makeStamp } from "../core/clock";

type ClockAtom = ReturnType<typeof atom<Clock>>;

export type ClockAPI = {
  $state: ClockAtom;
  tick: () => string;
  advance: (ms: number, seq: number) => void;
};

export function createClock(): ClockAPI {
  const $state: ClockAtom = atom<Clock>(nowClock());

  const tick = () => {
    const next = advanceClock($state.get(), nowClock());
    $state.set(next);
    return makeStamp(next.ms, next.seq);
  };

  const advance = (ms: number, seq: number) => {
    const next = advanceClock($state.get(), { ms, seq });
    $state.set(next);
  };

  return {
    $state,
    tick,
    advance,
  };
}

function nowClock(): Clock {
  return { ms: Date.now(), seq: 0 };
}
