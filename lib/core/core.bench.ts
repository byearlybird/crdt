import { bench, group, run } from "mitata";
import { mergeDocs, mergeCollections } from "./merge.ts";
import { createReadLens } from "./lens.ts";
import { pack, unpack, isAtom, atomize } from "./atomizer.ts";
import { makeStamp } from "./clock.ts";
import type { AtomizedDocument, CollectionState, Document } from "./types.ts";

// ============================================================================
// Helper Functions
// ============================================================================

function createDoc(fieldCount: number): Document {
  const doc: Document = {};
  for (let i = 0; i < fieldCount; i++) {
    doc[`field${i}`] = `value${i}`;
  }
  return doc;
}

function createCollection<T extends Document>(
  docCount: number,
  fieldsPerDoc: number,
  baseTime: number,
  deletionRate = 0,
): CollectionState<T> {
  const documents: Record<string, AtomizedDocument<T>> = {};
  const tombstones: Record<string, string> = {};
  const stamp = makeStamp(baseTime, 0);

  for (let i = 0; i < docCount; i++) {
    const id = `doc${i}`;
    if (Math.random() < deletionRate) {
      tombstones[id] = stamp;
    } else {
      documents[id] = atomize(createDoc(fieldsPerDoc) as T, stamp);
    }
  }

  return { documents, tombstones };
}

// ============================================================================
// Fixtures - Merge Benchmarks
// ============================================================================

const stamp1 = makeStamp(1000, 0);
const stamp2 = makeStamp(2000, 0);
const stamp3 = makeStamp(3000, 0);

// 5 field documents
const doc5_base = atomize(createDoc(5), stamp1);
const doc5_subset = atomize({ field0: "value0", field1: "value1" }, stamp1);
const doc5_newer = atomize(createDoc(5), stamp2);
const doc5_partial1 = atomize({ field0: "v0", field1: "v1", field2: "v2" }, stamp1);
const doc5_partial2 = atomize({ field2: "v2new", field3: "v3", field4: "v4" }, stamp2);

// 20 field documents
const doc20_base = atomize(createDoc(20), stamp1);
const doc20_newer = atomize(createDoc(20), stamp2);
const doc20_partial1 = (() => {
  const doc: Document = {};
  for (let i = 0; i < 10; i++) doc[`field${i}`] = `old${i}`;
  return atomize(doc, stamp1);
})();
const doc20_partial2 = (() => {
  const doc: Document = {};
  for (let i = 10; i < 20; i++) doc[`field${i}`] = `new${i}`;
  return atomize(doc, stamp2);
})();

// 100 field documents
const doc100_base = atomize(createDoc(100), stamp1);
const doc100_newer = atomize(createDoc(100), stamp2);

// Collections
const local100 = createCollection(100, 10, 1000);
const incoming100 = createCollection(100, 10, 2000);
const tombstones100_10pct = createCollection(100, 10, 1000, 0.1);

const local5k = createCollection(5000, 10, 1000);
const incoming5k = createCollection(5000, 10, 2000);
const incoming5k_new = createCollection(5000, 10, 2000);
const tombstones5k_25pct = createCollection(5000, 10, 1000, 0.25);

const local25k = createCollection(25000, 10, 1000);
const incoming25k = createCollection(25000, 10, 2000);

const localEmpty: CollectionState<Document> = { documents: {}, tombstones: {} };

const localPartial = (() => {
  const documents: Record<string, AtomizedDocument<Document>> = {};
  const stamp = makeStamp(1000, 0);
  for (let i = 0; i < 2500; i++) {
    documents[`doc${i}`] = atomize(createDoc(10), stamp);
  }
  return { documents, tombstones: {} };
})();

const incomingPartial = (() => {
  const documents: Record<string, AtomizedDocument<Document>> = {};
  const stamp = makeStamp(2000, 0);
  for (let i = 2500; i < 5000; i++) {
    documents[`doc${i}`] = atomize(createDoc(10), stamp);
  }
  return { documents, tombstones: {} };
})();

// ============================================================================
// Fixtures - Lens Benchmarks
// ============================================================================

const doc5 = atomize(createDoc(5), stamp1);
const doc20 = atomize(createDoc(20), stamp1);
const doc100 = atomize(createDoc(100), stamp1);

const lens5 = createReadLens(doc5);
const lens20 = createReadLens(doc20);
const lens100 = createReadLens(doc100);

// ============================================================================
// Fixtures - Atomizer Benchmarks
// ============================================================================

const atomized5 = atomize(createDoc(5), stamp1);
const atomized20 = atomize(createDoc(20), stamp1);
const atomized100 = atomize(createDoc(100), stamp1);

const validAtom = pack("test value", stamp1);
const invalidObject = { someKey: "value" };
const nullValue = null;

// ============================================================================
// Merge Benchmarks
// ============================================================================

group("mergeDocs - 5 fields", () => {
  bench("no conflicts (subset)", () => {
    mergeDocs(doc5_base, doc5_subset);
  });

  bench("100% conflicts (all newer)", () => {
    mergeDocs(doc5_base, doc5_newer);
  });

  bench("50% conflicts (partial overlap)", () => {
    mergeDocs(doc5_partial1, doc5_partial2);
  });
});

group("mergeDocs - 20 fields", () => {
  bench("no conflicts (subset)", () => {
    mergeDocs(doc20_base, doc20_partial1);
  });

  bench("100% conflicts (all newer)", () => {
    mergeDocs(doc20_base, doc20_newer);
  });

  bench("50% conflicts (partial overlap)", () => {
    mergeDocs(doc20_partial1, doc20_partial2);
  });
});

group("mergeDocs - 100 fields", () => {
  bench("100% conflicts (all newer)", () => {
    mergeDocs(doc100_base, doc100_newer);
  });
});

group("mergeCollections - 100 documents", () => {
  bench("both sides have data", () => {
    mergeCollections(local100, incoming100);
  });

  bench("with 10% tombstones", () => {
    mergeCollections(tombstones100_10pct, incoming100);
  });
});

group("mergeCollections - 5,000 documents", () => {
  bench("both sides have data", () => {
    mergeCollections(local5k, incoming5k);
  });

  bench("initial sync (local empty)", () => {
    mergeCollections(localEmpty, incoming5k_new);
  });

  bench("partial overlap (50/50)", () => {
    mergeCollections(localPartial, incomingPartial);
  });

  bench("with 25% tombstones", () => {
    mergeCollections(tombstones5k_25pct, incoming5k);
  });
});

group("mergeCollections - 25,000 documents", () => {
  bench("both sides have data", () => {
    mergeCollections(local25k, incoming25k);
  });
});

// ============================================================================
// Lens (Read) Benchmarks
// ============================================================================

group("createReadLens - proxy setup", () => {
  bench("5 fields", () => {
    createReadLens(doc5);
  });

  bench("20 fields", () => {
    createReadLens(doc20);
  });

  bench("100 fields", () => {
    createReadLens(doc100);
  });
});

group("single field read - 5 fields", () => {
  bench("first field access", () => {
    lens5.field0;
  });

  bench("repeated access (no caching)", () => {
    lens5.field0;
    lens5.field0;
    lens5.field0;
  });
});

group("multiple field reads - 5 fields", () => {
  bench("read all 5 fields", () => {
    lens5.field0;
    lens5.field1;
    lens5.field2;
    lens5.field3;
    lens5.field4;
  });
});

group("multiple field reads - 20 fields", () => {
  bench("read 5 fields", () => {
    lens20.field0;
    lens20.field1;
    lens20.field2;
    lens20.field3;
    lens20.field4;
  });

  bench("read all 20 fields", () => {
    for (let i = 0; i < 20; i++) {
      lens20[`field${i}` as keyof typeof lens20];
    }
  });
});

group("multiple field reads - 100 fields", () => {
  bench("read 10 fields", () => {
    for (let i = 0; i < 10; i++) {
      lens100[`field${i}` as keyof typeof lens100];
    }
  });

  bench("read all 100 fields", () => {
    for (let i = 0; i < 100; i++) {
      lens100[`field${i}` as keyof typeof lens100];
    }
  });
});

group("document iteration patterns", () => {
  bench("Object.keys() + read all (5 fields)", () => {
    const keys = Object.keys(lens5);
    for (const key of keys) {
      lens5[key as keyof typeof lens5];
    }
  });

  bench("Object.keys() + read all (20 fields)", () => {
    const keys = Object.keys(lens20);
    for (const key of keys) {
      lens20[key as keyof typeof lens20];
    }
  });

  bench("Object.keys() + read all (100 fields)", () => {
    const keys = Object.keys(lens100);
    for (const key of keys) {
      lens100[key as keyof typeof lens100];
    }
  });
});

group("destructuring patterns", () => {
  bench("destructure 3 fields from 5", () => {
    const { field0, field1, field2 } = lens5;
    return field0 + field1 + field2;
  });

  bench("destructure 5 fields from 20", () => {
    const { field0, field1, field2, field3, field4 } = lens20;
    return field0 + field1 + field2 + field3 + field4;
  });

  bench("destructure 10 fields from 100", () => {
    const { field0, field1, field2, field3, field4, field5, field6, field7, field8, field9 } =
      lens100;
    return field0 + field1 + field2 + field3 + field4 + field5 + field6 + field7 + field8 + field9;
  });
});

// ============================================================================
// Atomizer (Write) Benchmarks
// ============================================================================

group("pack - create atoms", () => {
  bench("pack string value", () => {
    pack("test string", stamp1);
  });

  bench("pack number value", () => {
    pack(12345, stamp1);
  });

  bench("pack object value", () => {
    pack({ nested: "object" }, stamp1);
  });
});

group("unpack - extract values", () => {
  bench("unpack valid atom", () => {
    unpack(validAtom);
  });

  bench("unpack invalid (null)", () => {
    unpack(nullValue);
  });

  bench("unpack invalid (object)", () => {
    unpack(invalidObject);
  });
});

group("isAtom - validation", () => {
  bench("valid atom", () => {
    isAtom(validAtom);
  });

  bench("invalid (null)", () => {
    isAtom(nullValue);
  });

  bench("invalid (object)", () => {
    isAtom(invalidObject);
  });

  bench("invalid (string)", () => {
    isAtom("just a string");
  });

  bench("invalid (undefined)", () => {
    isAtom(undefined);
  });
});

group("atomize - 5 fields", () => {
  bench("atomize document", () => {
    atomize(createDoc(5), stamp1);
  });

  bench("atomize with different stamp", () => {
    atomize(createDoc(5), stamp2);
  });
});

group("atomize - 20 fields", () => {
  bench("atomize document", () => {
    atomize(createDoc(20), stamp1);
  });
});

group("atomize - 100 fields", () => {
  bench("atomize document", () => {
    atomize(createDoc(100), stamp1);
  });
});

group("pack/unpack cycles", () => {
  bench("single field cycle", () => {
    const atom = pack("value", stamp1);
    unpack(atom);
  });

  bench("100 field cycles", () => {
    for (let i = 0; i < 100; i++) {
      const atom = pack(`value${i}`, stamp1);
      unpack(atom);
    }
  });

  bench("1000 field cycles", () => {
    for (let i = 0; i < 1000; i++) {
      const atom = pack(`value${i}`, stamp1);
      unpack(atom);
    }
  });
});

group("batch atomization", () => {
  bench("10 documents (5 fields each)", () => {
    for (let i = 0; i < 10; i++) {
      atomize(createDoc(5), stamp1);
    }
  });

  bench("100 documents (5 fields each)", () => {
    for (let i = 0; i < 100; i++) {
      atomize(createDoc(5), stamp1);
    }
  });

  bench("10 documents (20 fields each)", () => {
    for (let i = 0; i < 10; i++) {
      atomize(createDoc(20), stamp1);
    }
  });
});

group("isAtom in hot paths (simulating merge/lens)", () => {
  bench("validate 100 atoms", () => {
    for (let i = 0; i < 100; i++) {
      isAtom(atomized100[`field${i}` as keyof typeof atomized100]);
    }
  });

  bench("validate mixed atoms and non-atoms", () => {
    for (let i = 0; i < 50; i++) {
      isAtom(atomized100[`field${i}` as keyof typeof atomized100]);
      isAtom(invalidObject);
    }
  });
});

run();
