import { describe, expect, test } from "bun:test";
import {
	laterStamp,
	latestItemStamp,
	latestStamp,
	MIN_STAMP,
	makeStamp,
	parseStamp,
} from "#crdt/stamp";

describe("makeStamp", () => {
	test("produces ms@seq@deviceIdHash hex format", () => {
		const s = makeStamp(255, 1, "device");
		const [ms, seq, device] = s.split("@");
		expect(ms).toBeDefined();
		expect(seq).toBeDefined();
		expect(device).toBeDefined();

		// biome-ignore lint/style/noNonNullAssertion: <protected by expect assertion>
		expect(/^[0-9a-f]+$/.test(ms!)).toBe(true);
		// biome-ignore lint/style/noNonNullAssertion: <protected by expect assertion>
		expect(/^[0-9a-f]+$/.test(seq!)).toBe(true);
		// biome-ignore lint/style/noNonNullAssertion: <protected by expect assertion>
		expect(/^[0-9a-f]+$/.test(device!)).toBe(true);
	});

	test("pads segments to fixed width", () => {
		const s = makeStamp(0, 0, "x");
		const [ms, seq, device] = s.split("@");
		expect(ms?.length).toBe(12);
		expect(seq?.length).toBe(6);
		expect(device?.length).toBe(8);
	});

	test("stamps are lexicographically sortable by ms then seq", () => {
		const a = makeStamp(1000, 0, "d");
		const b = makeStamp(2000, 0, "d");
		const c = makeStamp(2000, 1, "d");
		expect(a < b).toBe(true);
		expect(b < c).toBe(true);
	});
});

describe("parseStamp", () => {
	test("returns ms and seq as integers for stamp from makeStamp", () => {
		expect(parseStamp(makeStamp(0, 0, "device"))).toEqual({ ms: 0, seq: 0 });
		expect(parseStamp(makeStamp(255, 1, "device"))).toEqual({
			ms: 255,
			seq: 1,
		});
		expect(parseStamp(makeStamp(1000, 42, "x"))).toEqual({ ms: 1000, seq: 42 });
	});
});

describe("laterStamp", () => {
	test("returns lexicographically later stamp", () => {
		const a = makeStamp(1000, 0, "d");
		const b = makeStamp(2000, 0, "d");
		expect(laterStamp(a, b)).toBe(b);
		expect(laterStamp(b, a)).toBe(b);
	});
});

describe("latestStamp", () => {
	test("returns max stamp from non-empty iterable", () => {
		const a = makeStamp(1000, 0, "d");
		const b = makeStamp(2000, 0, "d");
		const c = makeStamp(1500, 0, "d");
		expect(latestStamp([a, b, c])).toBe(b);
	});

	test("returns MIN_STAMP for empty iterable", () => {
		expect(latestStamp([])).toBe(MIN_STAMP);
	});
});

describe("MIN_STAMP", () => {
	test("is less than or equal to any normal stamp", () => {
		const s = makeStamp(1, 0, "device");
		expect(MIN_STAMP <= s).toBe(true);
		expect(MIN_STAMP).toBe(makeStamp(0, 0, "0"));
	});
});

describe("latestItemStamp", () => {
	test("returns the max ~t from timestamped items", () => {
		const a = { "~t": makeStamp(1000, 0, "d") };
		const b = { "~t": makeStamp(2000, 0, "d") };
		const c = { "~t": makeStamp(1500, 0, "d") };

		expect(latestItemStamp([a, b, c])).toBe(b["~t"]);
	});

	test("falls back to MIN_STAMP for an empty iterable", () => {
		expect(latestItemStamp([])).toBe(MIN_STAMP);
	});
});
