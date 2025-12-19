import { InvalidEventstampError } from "./errors";
import {
	decodeEventstamp,
	encodeEventstamp,
	generateNonce,
	isValidEventstamp,
} from "./eventstamp";

/**
 * Creates unique timestamps in order. Each time you call `now()`, you get a
 * timestamp that is always larger than the one before it.
 */
export type Clock = {
	/** Create a new timestamp that is larger than all previous ones */
	now: () => string;
	/** Get the current timestamp without moving the clock forward */
	latest: () => string;
	/** Move the clock forward to match a newer timestamp from somewhere else */
	forward: (eventstamp: string) => void;
};

/** The internal data of a clock. Used for saving and loading clock state. */
export type ClockState = {
	counter: number;
	ms: number;
	nonce: string;
};

/**
 * Creates a clock that makes unique timestamps in order.
 * @param initialState - Starting information. Use this to restore a saved clock.
 * @returns A Clock object
 */
export function createClock(initialState?: ClockState): Clock {
	let state = initialState ?? {
		counter: 0,
		ms: Date.now(),
		nonce: generateNonce(),
	};

	const now = (): string => {
		const wallMs = Date.now();
		const shouldAdvanceWallClock = wallMs > state.ms;

		if (shouldAdvanceWallClock) {
			state.ms = wallMs;
			state.counter = 0;
		} else {
			state.counter++;
		}

		state.nonce = generateNonce();

		return encodeEventstamp(state);
	};

	const latest = (): string => encodeEventstamp(state);

	const forward = (eventstamp: string): void => {
		if (!isValidEventstamp(eventstamp)) {
			throw new InvalidEventstampError(eventstamp);
		}

		const current = latest();
		const isEventstampNewer = eventstamp > current;

		if (isEventstampNewer) {
			state = decodeEventstamp(eventstamp);
		}
	};

	return {
		now,
		latest,
		forward,
	};
}

/**
 * Creates a clock that starts at a specific timestamp.
 * @param eventstamp - The timestamp to start the clock at
 * @returns A Clock object that begins at the given timestamp
 * @throws {InvalidEventstampError} If the eventstamp format is wrong
 */
export function createClockFromEventstamp(eventstamp: string): Clock {
	const decoded = decodeEventstamp(eventstamp);
	return createClock(decoded);
}
