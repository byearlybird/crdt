import { expect, test } from "bun:test";
import { maxEventstamp } from "../clock/eventstamp";
import { computeResourceLatest } from "./resource";

/**
 * Focused tests for "latest eventstamp" computation utilities.
 * These utilities are used to compute cached latest values in resources and documents.
 */

test("computeResourceLatest returns max eventstamp from flat eventstamps", () => {
	const eventstamps = {
		name: "2025-01-01T00:00:00.000Z|0001|a1b2",
		email: "2025-01-01T00:05:00.000Z|0001|c3d4", // Newer
		age: "2025-01-01T00:02:00.000Z|0001|e5f6",
	};

	const latest = computeResourceLatest(eventstamps);

	expect(latest).toBe("2025-01-01T00:05:00.000Z|0001|c3d4");
});

test("computeResourceLatest uses fallback for empty eventstamps", () => {
	const eventstamps = {};
	const fallback = "2025-01-01T00:00:00.000Z|0001|a1b2";

	const latest = computeResourceLatest(eventstamps, fallback);

	expect(latest).toBe(fallback);
});

test("computeResourceLatest handles nested eventstamps from flat paths", () => {
	const eventstamps = {
		name: "2025-01-01T00:00:00.000Z|0001|a1b2",
		"settings.theme": "2025-01-01T00:05:00.000Z|0001|c3d4",
		"settings.notifications": "2025-01-01T00:03:00.000Z|0001|e5f6",
	};

	const latest = computeResourceLatest(eventstamps);

	expect(latest).toBe("2025-01-01T00:05:00.000Z|0001|c3d4");
});

test("maxEventstamp returns max from array of eventstamps", () => {
	const eventstamps = [
		"2025-01-01T00:00:00.000Z|0001|a1b2",
		"2025-01-01T00:05:00.000Z|0001|c3d4", // Max
		"2025-01-01T00:02:00.000Z|0001|e5f6",
	];

	const max = maxEventstamp(eventstamps);

	expect(max).toBe("2025-01-01T00:05:00.000Z|0001|c3d4");
});

test("maxEventstamp handles single eventstamp", () => {
	const eventstamps = ["2025-01-01T00:00:00.000Z|0001|a1b2"];

	const max = maxEventstamp(eventstamps);

	expect(max).toBe("2025-01-01T00:00:00.000Z|0001|a1b2");
});

test("maxEventstamp returns MIN_EVENTSTAMP for empty array", () => {
	const max = maxEventstamp([]);

	expect(max).toBe("1970-01-01T00:00:00.000Z|0000|0000");
});
