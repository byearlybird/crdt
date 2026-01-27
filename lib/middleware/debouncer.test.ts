import { describe, test, expect, vi, afterEach } from "vitest";
import { Debouncer } from "./debouncer";

afterEach(() => {
  vi.useRealTimers();
});

describe("Debouncer", () => {
  test("executes callback after delay", async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const debouncer = new Debouncer(100, callback);

    debouncer.trigger();
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(99);
    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("resets timer on repeated triggers", async () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const debouncer = new Debouncer(100, callback);

    debouncer.trigger();
    vi.advanceTimersByTime(50);
    debouncer.trigger();
    vi.advanceTimersByTime(50);
    debouncer.trigger();
    vi.advanceTimersByTime(50);

    expect(callback).not.toHaveBeenCalled();

    vi.advanceTimersByTime(50);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("cancel prevents execution", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const debouncer = new Debouncer(100, callback);

    debouncer.trigger();
    vi.advanceTimersByTime(50);
    debouncer.cancel();
    vi.advanceTimersByTime(100);

    expect(callback).not.toHaveBeenCalled();
  });

  test("flush executes immediately when pending", () => {
    vi.useFakeTimers();
    const callback = vi.fn();
    const debouncer = new Debouncer(100, callback);

    debouncer.trigger();
    expect(callback).not.toHaveBeenCalled();

    debouncer.flush();
    expect(callback).toHaveBeenCalledTimes(1);

    // Should not execute again after original delay
    vi.advanceTimersByTime(100);
    expect(callback).toHaveBeenCalledTimes(1);
  });

  test("flush does nothing when not pending", () => {
    const callback = vi.fn();
    const debouncer = new Debouncer(100, callback);

    debouncer.flush();
    expect(callback).not.toHaveBeenCalled();
  });

  test("pending returns correct state", () => {
    vi.useFakeTimers();
    const debouncer = new Debouncer(100, () => {});

    expect(debouncer.pending).toBe(false);

    debouncer.trigger();
    expect(debouncer.pending).toBe(true);

    debouncer.cancel();
    expect(debouncer.pending).toBe(false);

    debouncer.trigger();
    vi.advanceTimersByTime(100);
    expect(debouncer.pending).toBe(false);
  });

  test("handles async callbacks", async () => {
    vi.useFakeTimers();
    let resolved = false;
    const callback = async () => {
      await Promise.resolve();
      resolved = true;
    };
    const debouncer = new Debouncer(100, callback);

    debouncer.trigger();
    vi.advanceTimersByTime(100);

    // Need to flush promises
    await vi.runAllTimersAsync();
    expect(resolved).toBe(true);
  });
});
