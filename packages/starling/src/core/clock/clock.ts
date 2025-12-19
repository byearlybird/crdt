import { InvalidEventstampError } from "./errors";
import {
	decodeEventstamp,
	encodeEventstamp,
	generateNonce,
	isValidEventstamp,
} from "./eventstamp";

/**
 * Generates unique, ordered timestamps. Each call to `now()` returns a
 * timestamp that's guaranteed to be greater than the previous one.
 *
 * @example
 * ```typescript
 * const clock = createClock();
 * const stamp1 = clock.now();
 * const stamp2 = clock.now();
 * ```
 */
export type Clock = {
	now: () => string;
	latest: () => string;
	forward: (eventstamp: string) => void;
};

export type ClockState = {
	counter: number;
	ms: number;
	nonce: string;
};

/**
 * Create a new Clock instance.
 * @param initialState - Optional initial state for the clock
 */
export function createClock(initialState?: ClockState): Clock {
	let state = initialState ?? {
		counter: 0,
		ms: Date.now(),
		nonce: generateNonce(),
	};

	const now = (): string => {
		const wallMs = Date.now();

		if (wallMs > state.ms) {
			state.ms = wallMs;
			state.counter = 0;
			state.nonce = generateNonce();
		} else {
			state.counter++;
			state.nonce = generateNonce();
		}

		return encodeEventstamp(state);
	};

	const latest = (): string => encodeEventstamp(state);

	const forward = (eventstamp: string): void => {
		if (!isValidEventstamp(eventstamp)) {
			throw new InvalidEventstampError(eventstamp);
		}

		const current = latest();
		if (eventstamp > current) {
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
 * Create a Clock from an eventstamp string.
 * @param eventstamp - Eventstamp string to decode and initialize clock from
 * @throws Error if eventstamp is invalid
 */
export function createClockFromEventstamp(eventstamp: string): Clock {
	const decoded = decodeEventstamp(eventstamp);
	return createClock(decoded);
}
