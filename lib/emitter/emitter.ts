/**
 * A minimal event emitter for subscribing to and emitting events.
 */
export type Emitter<T> = {
  /**
   * Subscribe to events. Returns an unsubscribe function.
   */
  subscribe(listener: (event: T) => void): () => void;

  /**
   * Emit an event to all subscribers.
   */
  emit(event: T): void;
};

/**
 * Creates a new event emitter.
 */
export function createEmitter<T>(): Emitter<T> {
  const listeners = new Set<(event: T) => void>();

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    emit(event) {
      // Create a snapshot to avoid issues with listeners added/removed during emit
      const snapshot = Array.from(listeners);
      snapshot.forEach((listener) => listener(event));
    },
  };
}
