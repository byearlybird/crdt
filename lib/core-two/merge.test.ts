import { describe, expect, test } from "vitest";
import { Atomizer } from "./atomizer";
import { mergeDocs } from "./merge";

describe("mergeDocs", () => {
  test("adds missing keys from incoming", () => {
    const local: Record<string, any> = { a: Atomizer.pack(1, "1000") };
    const incoming = { a: Atomizer.pack(1, "1000"), b: Atomizer.pack(2, "1000") };

    const result = mergeDocs(local, incoming);

    expect(result["a"]).toEqual(Atomizer.pack(1, "1000"));
    expect(result["b"]).toEqual(Atomizer.pack(2, "1000"));
  });

  test("LWW: takes incoming when incoming ts > local ts", () => {
    const local = { x: Atomizer.pack("old", "1000") };
    const incoming = { x: Atomizer.pack("new", "2000") };

    const result = mergeDocs(local, incoming);

    expect(result["x"]).toEqual(Atomizer.pack("new", "2000"));
  });

  test("LWW: keeps local when local ts >= incoming ts", () => {
    const local = { x: Atomizer.pack("local", "2000") };
    const incoming = { x: Atomizer.pack("incoming", "1000") };

    const result = mergeDocs(local, incoming);

    expect(result["x"]).toEqual(Atomizer.pack("local", "2000"));
  });

  test("returns local reference when no changes", () => {
    const local = { a: Atomizer.pack(1, "1000") };
    const incoming = { a: Atomizer.pack(1, "1000") };

    const result = mergeDocs(local, incoming);

    expect(result).toBe(local);
  });

  test("returns new object when there are changes", () => {
    const local = { a: Atomizer.pack(1, "1000") };
    const incoming = { a: Atomizer.pack(2, "2000") };

    const result = mergeDocs(local, incoming);

    expect(result).not.toBe(local);
    expect(result).toEqual({ a: Atomizer.pack(2, "2000") });
  });
});
