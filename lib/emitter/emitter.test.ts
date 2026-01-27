import { describe, expect, test, vi } from "vitest";
import { createEmitter } from "./emitter";

describe("createEmitter", () => {
  test("returns an emitter with subscribe and emit methods", () => {
    const emitter = createEmitter<string>();

    expect(emitter).toHaveProperty("subscribe");
    expect(emitter).toHaveProperty("emit");
    expect(typeof emitter.subscribe).toBe("function");
    expect(typeof emitter.emit).toBe("function");
  });

  test("subscribe returns an unsubscribe function", () => {
    const emitter = createEmitter<string>();
    const listener = vi.fn();
    const unsubscribe = emitter.subscribe(listener);

    expect(typeof unsubscribe).toBe("function");
  });

  test("emit calls all subscribed listeners", () => {
    const emitter = createEmitter<string>();

    const listener1 = vi.fn();
    const listener2 = vi.fn();

    emitter.subscribe(listener1);
    emitter.subscribe(listener2);

    emitter.emit("test-event");

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener1).toHaveBeenCalledWith("test-event");
    expect(listener2).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledWith("test-event");
  });

  test("unsubscribe stops listener from receiving events", () => {
    const emitter = createEmitter<string>();

    const listener1 = vi.fn();
    const listener2 = vi.fn();

    const unsubscribe1 = emitter.subscribe(listener1);
    emitter.subscribe(listener2);

    unsubscribe1();

    emitter.emit("test-event");

    expect(listener1).not.toHaveBeenCalled();
    expect(listener2).toHaveBeenCalledTimes(1);
  });

  test("multiple emits call listeners multiple times", () => {
    const emitter = createEmitter<number>();

    const listener = vi.fn();
    emitter.subscribe(listener);

    emitter.emit(1);
    emitter.emit(2);
    emitter.emit(3);

    expect(listener).toHaveBeenCalledTimes(3);
    expect(listener).toHaveBeenNthCalledWith(1, 1);
    expect(listener).toHaveBeenNthCalledWith(2, 2);
    expect(listener).toHaveBeenNthCalledWith(3, 3);
  });

  test("works with object events", () => {
    type Event = { type: string; data: unknown };
    const emitter = createEmitter<Event>();

    const listener = vi.fn();
    emitter.subscribe(listener);

    emitter.emit({ type: "add", data: { id: "1" } });
    emitter.emit({ type: "remove", data: { id: "1" } });

    expect(listener).toHaveBeenCalledTimes(2);
    expect(listener).toHaveBeenNthCalledWith(1, { type: "add", data: { id: "1" } });
    expect(listener).toHaveBeenNthCalledWith(2, { type: "remove", data: { id: "1" } });
  });

  test("unsubscribing multiple times is safe", () => {
    const emitter = createEmitter<string>();

    const listener = vi.fn();
    const unsubscribe = emitter.subscribe(listener);

    unsubscribe();
    unsubscribe();
    unsubscribe();

    emitter.emit("test");

    expect(listener).not.toHaveBeenCalled();
  });

  test("listeners added during emit are not called for that emit", () => {
    const emitter = createEmitter<string>();

    const listener1 = vi.fn(() => {
      emitter.subscribe(listener2);
    });
    const listener2 = vi.fn();

    emitter.subscribe(listener1);
    emitter.emit("test");

    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).not.toHaveBeenCalled();

    // Next emit should call both
    emitter.emit("test2");

    expect(listener1).toHaveBeenCalledTimes(2);
    expect(listener2).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledWith("test2");
  });

  test("listeners removed during emit are still called for that emit", () => {
    const emitter = createEmitter<string>();

    let unsubscribe: (() => void) | undefined;
    const listener1 = vi.fn(() => {
      unsubscribe?.();
    });
    const listener2 = vi.fn();

    unsubscribe = emitter.subscribe(listener1);
    emitter.subscribe(listener2);

    emitter.emit("test");

    // Both should be called even though listener1 unsubscribed itself
    expect(listener1).toHaveBeenCalledTimes(1);
    expect(listener2).toHaveBeenCalledTimes(1);

    // Next emit should only call listener2
    emitter.emit("test2");

    expect(listener1).toHaveBeenCalledTimes(1); // No new calls
    expect(listener2).toHaveBeenCalledTimes(2);
  });
});
