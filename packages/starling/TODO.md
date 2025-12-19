# Starling Package File Review Checklist

## Root Files
- [ ] build.ts
- [ ] package.json
- [ ] tsconfig.json

## Source Files

### Main Entry
- [ ] src/index.ts

### Core Module
- [ ] src/core/index.ts

#### Clock
- [x] src/core/clock/index.ts
- [x] src/core/clock/clock.ts
- [x] src/core/clock/clock.test.ts
- [x] src/core/clock/eventstamp.ts
- [x] src/core/clock/eventstamp.test.ts
- [x] src/core/clock/errors.ts

#### Document
- [ ] src/core/document/index.ts
- [ ] src/core/document/document.ts
- [ ] src/core/document/document.test.ts
- [ ] src/core/document/resource.ts
- [ ] src/core/document/resource.test.ts
- [ ] src/core/document/utils.ts
- [ ] src/core/document/utils.test.ts
- [ ] src/core/document/latest.test.ts

### Store Module
- [ ] src/store/collection.ts
- [ ] src/store/collection.test.ts
- [ ] src/store/emitter.ts
- [ ] src/store/emitter.test.ts
- [ ] src/store/query.ts
- [ ] src/store/standard-schema.ts
- [ ] src/store/standard-schema.test.ts
- [ ] src/store/store.ts
- [ ] src/store/store.test.ts
- [ ] src/store/test-helpers.ts
- [ ] src/store/transaction.ts
- [ ] src/store/transaction.test.ts
- [ ] src/store/types.ts

### Persisters Module
- [ ] src/persisters/idb/index.ts
- [ ] src/persisters/idb/idb.test.ts

### Synchronizers Module
- [ ] src/synchronizers/http/index.ts
- [ ] src/synchronizers/http/http.test.ts

---

**Total Files:** 45
