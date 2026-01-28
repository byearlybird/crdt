export class Emitter<T> {
  #listeners = new Set<(event: T) => void>();
  #snapshot: ((event: T) => void)[] | null = null;

  subscribe(listener: (event: T) => void) {
    this.#listeners.add(listener);
    this.#snapshot = null;
    return () => {
      this.#listeners.delete(listener);
      this.#snapshot = null;
    };
  }

  emit(event: T) {
    // Cache the snapshot array so repeated emits without listener changes avoid allocation.
    // Capture into a local so mid-emit subscribe/unsubscribe invalidations don't
    // affect the current iteration.
    const listeners = (this.#snapshot ??= Array.from(this.#listeners));
    for (const listener of listeners) {
      listener(event);
    }
  }
}
