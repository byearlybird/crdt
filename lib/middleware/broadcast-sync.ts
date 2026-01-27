import type { StoreState } from "../core";

export type BroadcastSyncOptions = {
  channelName: string;
  onMessage: (state: StoreState) => void;
};

/**
 * Cross-tab synchronization via BroadcastChannel.
 * Handles environments where BroadcastChannel is unavailable.
 */
export class BroadcastSync {
  #channel: globalThis.BroadcastChannel | null = null;
  #onMessage: (state: StoreState) => void;

  constructor(options: BroadcastSyncOptions) {
    this.#onMessage = options.onMessage;

    try {
      this.#channel = new globalThis.BroadcastChannel(options.channelName);
      this.#channel.onmessage = (event: MessageEvent) => {
        if (event.data?.type === "state-update" && event.data?.state) {
          try {
            const incomingState = event.data.state as StoreState;
            this.#onMessage(incomingState);
          } catch (error) {
            console.warn("[BroadcastSync] Failed to process message:", error);
          }
        }
      };
    } catch (error) {
      // BroadcastChannel may not be available in some environments
      console.warn("[BroadcastSync] BroadcastChannel not available:", error);
    }
  }

  /**
   * Broadcast state to other tabs. Does nothing if BroadcastChannel is unavailable.
   */
  broadcast(state: StoreState): void {
    if (!this.#channel) return;

    try {
      this.#channel.postMessage({
        type: "state-update",
        state,
      });
    } catch (error) {
      console.warn("[BroadcastSync] Failed to broadcast:", error);
    }
  }

  /**
   * Close the BroadcastChannel and clean up resources.
   */
  close(): void {
    if (this.#channel) {
      this.#channel.close();
      this.#channel = null;
    }
  }

  /**
   * Check if BroadcastChannel is available and connected.
   */
  get available(): boolean {
    return this.#channel !== null;
  }
}
