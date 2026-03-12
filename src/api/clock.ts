import { makeStamp, parseStamp } from "#crdt/stamp";
import type { Stamp } from "#crdt/types";

export function createClock(uniqueId: string, seedStamp: Stamp | null = null) {
	let { ms, seq } = getStart(seedStamp);

	return {
		tick() {
			const now = Date.now();
			if (now > ms) {
				ms = now;
				seq = 0;
			} else {
				seq++;
			}
			return makeStamp(ms, seq, uniqueId);
		},
		get latestStamp() {
			return makeStamp(ms, seq, uniqueId);
		},
	};
}

function getStart(stamp: Stamp | null) {
	if (!stamp) return { ms: Date.now(), seq: 0 };
	const { ms, seq } = parseStamp(stamp);
	return { ms, seq };
}

export type Clock = ReturnType<typeof createClock>;
