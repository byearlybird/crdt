export class Emitter<T> {
  #listeners = new Set<(event: T) => void>();

  subscribe(listener: (event: T) => void) {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  emit(event: T) {
    // Copy the listeners to avoid calling listeners that are added during the emit.
    const listeners = Array.from(this.#listeners);
    for (const listener of listeners) {
      listener(event);
    }
  }
}
