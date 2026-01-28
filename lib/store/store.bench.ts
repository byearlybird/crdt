import { bench, group, run } from "mitata";
import { z } from "zod";
import { define } from "./schema";
import { createStore, type Store } from "./store";

// Simple benchmark-specific schema
const benchmarkItemSchema = z.object({
  id: z.string(),
  value: z.number(),
  label: z.string(),
});

type BenchmarkItem = z.infer<typeof benchmarkItemSchema>;

type BenchConfig = {
  items: ReturnType<typeof define<typeof benchmarkItemSchema>>;
};

// Helper to populate store with N documents
function populateStore(store: Store<BenchConfig>, count: number): string[] {
  const ids: string[] = [];
  for (let i = 0; i < count; i++) {
    const id = `item-${i.toString().padStart(8, "0")}`;
    ids.push(id);
    store.put("items", { id, value: i, label: `Label ${i}` });
  }
  return ids;
}

// Random element selector
function randomElement<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)]!;
}

// Setup stores for each scale
const store100 = createStore({
  items: define(benchmarkItemSchema, (data) => data.id),
});
const ids100 = populateStore(store100, 100);

const store5k = createStore({
  items: define(benchmarkItemSchema, (data) => data.id),
});
const ids5k = populateStore(store5k, 5_000);

const store25k = createStore({
  items: define(benchmarkItemSchema, (data) => data.id),
});
const ids25k = populateStore(store25k, 25_000);

// Benchmark groups by scale
group("Store operations - 100 documents", () => {
  bench("baseline: get()", () => {
    const id = randomElement(ids100);
    store100.get("items", id);
  });

  bench("put()", () => {
    const id = `new-${Math.random().toString(36).slice(2)}`;
    store100.put("items", { id, value: 999, label: "New item" });
  });

  bench("patch()", () => {
    const id = randomElement(ids100);
    store100.patch("items", id, { value: 42 });
  });

  bench("remove()", () => {
    const id = randomElement(ids100);
    store100.remove("items", id);
  });

  bench("list()", () => {
    store100.list("items");
  });

  bench("transact()", () => {
    store100.transact((tx) => {
      const id1 = randomElement(ids100);
      tx.get("items", id1);

      const newId = `tx-${Math.random().toString(36).slice(2)}`;
      tx.put("items", { id: newId, value: 123, label: "Transaction" });

      // Use the newly created document for patch to avoid missing documents
      tx.patch("items", newId, { value: 88 });
    });
  });
});

group("Store operations - 5,000 documents", () => {
  bench("baseline: get()", () => {
    const id = randomElement(ids5k);
    store5k.get("items", id);
  });

  bench("put()", () => {
    const id = `new-${Math.random().toString(36).slice(2)}`;
    store5k.put("items", { id, value: 999, label: "New item" });
  });

  bench("patch()", () => {
    const id = randomElement(ids5k);
    store5k.patch("items", id, { value: 42 });
  });

  bench("remove()", () => {
    const id = randomElement(ids5k);
    store5k.remove("items", id);
  });

  bench("list()", () => {
    store5k.list("items");
  });

  bench("transact()", () => {
    store5k.transact((tx) => {
      const id1 = randomElement(ids5k);
      tx.get("items", id1);

      const newId = `tx-${Math.random().toString(36).slice(2)}`;
      tx.put("items", { id: newId, value: 123, label: "Transaction" });

      // Use the newly created document for patch to avoid missing documents
      tx.patch("items", newId, { value: 88 });
    });
  });
});

group("Store operations - 25,000 documents", () => {
  bench("baseline: get()", () => {
    const id = randomElement(ids25k);
    store25k.get("items", id);
  });

  bench("put()", () => {
    const id = `new-${Math.random().toString(36).slice(2)}`;
    store25k.put("items", { id, value: 999, label: "New item" });
  });

  bench("patch()", () => {
    const id = randomElement(ids25k);
    store25k.patch("items", id, { value: 42 });
  });

  bench("remove()", () => {
    const id = randomElement(ids25k);
    store25k.remove("items", id);
  });

  bench("list()", () => {
    store25k.list("items");
  });

  bench("transact()", () => {
    store25k.transact((tx) => {
      const id1 = randomElement(ids25k);
      tx.get("items", id1);

      const newId = `tx-${Math.random().toString(36).slice(2)}`;
      tx.put("items", { id: newId, value: 123, label: "Transaction" });

      // Use the newly created document for patch to avoid missing documents
      tx.patch("items", newId, { value: 88 });
    });
  });
});

run();
