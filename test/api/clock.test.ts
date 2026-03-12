import { describe, expect, test } from "bun:test";
import { createClock } from "#api/clock.ts";
import { makeStamp, parseStamp } from "#crdt/stamp";

describe("createClock", () => {
  test("with no seed starts from now and seq 0", () => {
    const clock = createClock("device");
    const stamp = clock.latestStamp;
    const { ms, seq } = parseStamp(stamp);
    expect(seq).toBe(0);
    expect(ms).toBeGreaterThanOrEqual(Date.now() - 1000);
    expect(ms).toBeLessThanOrEqual(Date.now() + 1000);
  });

  test("with seed uses parsed ms and seq", () => {
    const seed = makeStamp(5000, 3, "other");
    const clock = createClock("my-id", seed);
    const stamp = clock.latestStamp;
    expect(parseStamp(stamp)).toEqual({ ms: 5000, seq: 3 });
  });

  test("tick advances ms and resets seq when now > ms", () => {
    const past = makeStamp(0, 99, "d");
    const clock = createClock("d", past);
    const stamp = clock.tick();
    const { ms, seq } = parseStamp(stamp);
    expect(ms).toBeGreaterThanOrEqual(Date.now() - 10);
    expect(seq).toBe(0);
  });

  test("tick increments seq when now <= ms", () => {
    const futureMs = Date.now() + 60_000;
    const seed = makeStamp(futureMs, 5, "other");
    const clock = createClock("d", seed);
    const stamp = clock.tick();
    const { ms, seq } = parseStamp(stamp);
    expect(ms).toBe(futureMs);
    expect(seq).toBe(6);
  });

  test("latestStamp returns current clock state after ticks", () => {
    const futureMs = Date.now() + 30_000;
    const seed = makeStamp(futureMs, 0, "other");
    const clock = createClock("d", seed);
    const s0 = clock.latestStamp;
    expect(parseStamp(s0)).toEqual({ ms: futureMs, seq: 0 });
    clock.tick();
    const s1 = clock.latestStamp;
    expect(parseStamp(s1)).toEqual({ ms: futureMs, seq: 1 });
  });
});
