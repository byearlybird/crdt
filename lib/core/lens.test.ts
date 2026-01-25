import { describe, expect, test, vi } from "vitest";
import { Atomizer } from "./atomizer";
import { createReadLens } from "./lens";

describe("createReadLens", () => {
  test("unwraps atoms and returns values", () => {
    const internal = {
      name: Atomizer.pack("Alice", "1000"),
      age: Atomizer.pack(30, "1000"),
    };
    const lens = createReadLens<{ name: string; age: number }>(internal);

    expect(lens.name).toBe("Alice");
    expect(lens.age).toBe(30);
  });

  test("returns undefined for missing keys", () => {
    const internal = { a: Atomizer.pack(1, "t") };
    const lens = createReadLens<{ a: number; b?: number }>(internal);

    expect(lens.a).toBe(1);
    expect(lens.b).toBeUndefined();
  });

  test("does not recurse into unpacked values (blob behavior)", () => {
    const blob = { theme: "dark", notifications: true };
    const internal = { settings: Atomizer.pack(blob, "1000") };
    const lens = createReadLens<{ settings: typeof blob }>(internal);

    expect(lens.settings).toBe(blob);
    expect(lens.settings.theme).toBe("dark");
  });

  test("throws when field is not an atom", () => {
    const internal = { raw: "plain" } as any;
    const lens = createReadLens(internal) as any;

    expect(() => lens.raw).toThrow(
      'createReadLens: field "raw" is not an atom. Expected Document<T> with atomized fields only.',
    );
  });

  test("blocks writes via set", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const internal = { x: Atomizer.pack(1, "t") };
    const lens = createReadLens<{ x: number }>(internal);

    expect(() => {
      (lens as any).x = 2;
    }).toThrow();
    expect(Atomizer.unpack(internal.x)).toBe(1);
    expect(warn).toHaveBeenCalledWith("Mutations must use the update API.");

    warn.mockRestore();
  });
});
