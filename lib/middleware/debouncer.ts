/**
 * A simple debouncer that delays callback execution until after
 * a specified time has elapsed since the last trigger.
 */
export class Debouncer {
  #ms: number;
  #callback: () => void | Promise<void>;
  #timeout: ReturnType<typeof setTimeout> | null = null;

  constructor(ms: number, callback: () => void | Promise<void>) {
    this.#ms = ms;
    this.#callback = callback;
  }

  /**
   * Trigger the debouncer. Resets the timer if already pending.
   */
  trigger(): void {
    this.cancel();
    this.#timeout = setTimeout(() => {
      this.#timeout = null;
      void this.#callback();
    }, this.#ms);
  }

  /**
   * Cancel any pending execution without invoking the callback.
   */
  cancel(): void {
    if (this.#timeout) {
      clearTimeout(this.#timeout);
      this.#timeout = null;
    }
  }

  /**
   * Immediately execute the callback if there's a pending timer,
   * then cancel the timer. Does nothing if no timer is pending.
   */
  flush(): void | Promise<void> {
    if (this.#timeout) {
      clearTimeout(this.#timeout);
      this.#timeout = null;
      return this.#callback();
    }
  }

  /**
   * Check if there's a pending execution.
   */
  get pending(): boolean {
    return this.#timeout !== null;
  }
}
