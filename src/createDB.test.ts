import { test, expect, describe } from 'bun:test';
import { createDB } from './createDB.ts';
import { AbortError, DisposedError } from './errors.ts';
import type { MutateEvent, SubscribeEvent } from './types.ts';

type Task = { id: string; title: string; status: string };

const makeTask = (id: string, title = `Task ${id}`, status = 'todo'): Task => ({
  id,
  title,
  status,
});

describe('createDB — M1', () => {
  test('create with initial data populates .data', () => {
    const tasks = [makeTask('1'), makeTask('2')];
    const db = createDB<Task>({ getId: (t) => t.id, initial: tasks });

    expect(db.data.size).toBe(2);
    expect(db.data.get('1')).toEqual(tasks[0]);
    expect(db.data.get('2')).toEqual(tasks[1]);
  });

  test('snapshot returns plain array and round-trips through initial', () => {
    const tasks = [makeTask('1'), makeTask('2')];
    const db = createDB<Task>({ getId: (t) => t.id, initial: tasks });
    const snap = db.snapshot();

    expect(snap).toEqual(tasks);

    const db2 = createDB<Task>({ getId: (t) => t.id, initial: snap });
    expect(db2.data.size).toBe(2);
    expect(db2.snapshot()).toEqual(tasks);
  });

  test('insert adds record', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const task = makeTask('1');
    await db.insert(task);

    expect(db.data.get('1')).toEqual(task);
    expect(db.data.size).toBe(1);
  });

  test('insert duplicate throws', () => {
    const db = createDB<Task>({ getId: (t) => t.id, initial: [makeTask('1')] });
    expect(() => db.insert(makeTask('1'))).toThrow('already exists');
  });

  test('update with partial merges', async () => {
    const db = createDB<Task>({ getId: (t) => t.id, initial: [makeTask('1')] });
    await db.update('1', { status: 'done' });

    expect(db.data.get('1')).toEqual({ id: '1', title: 'Task 1', status: 'done' });
  });

  test('update with updater function', async () => {
    const db = createDB<Task>({ getId: (t) => t.id, initial: [makeTask('1')] });
    await db.update('1', (prev) => ({ ...prev, title: prev.title + '!' }));

    expect(db.data.get('1')!.title).toBe('Task 1!');
  });

  test('update missing ID throws', () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    expect(() => db.update('nope', { status: 'done' })).toThrow('does not exist');
  });

  test('remove deletes record', async () => {
    const db = createDB<Task>({ getId: (t) => t.id, initial: [makeTask('1')] });
    await db.remove('1');

    expect(db.data.has('1')).toBe(false);
    expect(db.data.size).toBe(0);
  });

  test('remove missing ID throws', () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    expect(() => db.remove('nope')).toThrow('does not exist');
  });

  test('insert with failing validate throws, record not in data', () => {
    const db = createDB<Task>({
      getId: (t) => t.id,
      validate: (t) => {
        if (!t.title) throw new Error('title required');
      },
    });

    expect(() => db.insert({ id: '1', title: '', status: 'todo' })).toThrow('title required');
    expect(db.data.has('1')).toBe(false);
  });

  test('update with failing validate throws, record unchanged', async () => {
    const original = makeTask('1');
    const db = createDB<Task>({
      getId: (t) => t.id,
      initial: [original],
      validate: (t) => {
        if (!t.title) throw new Error('title required');
      },
    });

    expect(() => db.update('1', { title: '' })).toThrow('title required');
    expect(db.data.get('1')).toEqual(original);
  });

  test('remove does not trigger validate', async () => {
    let validateCalled = false;
    const db = createDB<Task>({
      getId: (t) => t.id,
      initial: [makeTask('1')],
      validate: () => {
        validateCalled = true;
      },
    });

    await db.remove('1');
    expect(validateCalled).toBe(false);
  });

  test('no validate option works normally', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    await db.insert(makeTask('1'));
    await db.update('1', { status: 'done' });
    await db.remove('1');

    expect(db.data.size).toBe(0);
  });
});

describe('createDB — M2', () => {
  test('insert fires optimistic then commit with correct event shape', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const events: SubscribeEvent<Task>[] = [];
    db.subscribe((e) => events.push(e));

    const task = makeTask('1');
    await db.insert(task);

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'optimistic', event: { op: 'insert', id: '1', record: task, previous: null } });
    expect(events[1]).toEqual({ type: 'commit', event: { op: 'insert', id: '1', record: task, previous: null } });
  });

  test('update fires optimistic then commit with correct record and previous', async () => {
    const original = makeTask('1');
    const db = createDB<Task>({ getId: (t) => t.id, initial: [original] });
    const events: SubscribeEvent<Task>[] = [];
    db.subscribe((e) => events.push(e));

    await db.update('1', { status: 'done' });

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'optimistic', event: { op: 'update', id: '1', record: { ...original, status: 'done' }, previous: original } });
    expect(events[1]).toEqual({ type: 'commit', event: { op: 'update', id: '1', record: { ...original, status: 'done' }, previous: original } });
  });

  test('remove fires optimistic then commit with correct previous', async () => {
    const original = makeTask('1');
    const db = createDB<Task>({ getId: (t) => t.id, initial: [original] });
    const events: SubscribeEvent<Task>[] = [];
    db.subscribe((e) => events.push(e));

    await db.remove('1');

    expect(events).toHaveLength(2);
    expect(events[0]).toEqual({ type: 'optimistic', event: { op: 'remove', id: '1', record: null, previous: original } });
    expect(events[1]).toEqual({ type: 'commit', event: { op: 'remove', id: '1', record: null, previous: original } });
  });

  test('unsubscribe stops notifications', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const events: SubscribeEvent<Task>[] = [];
    const unsub = db.subscribe((e) => events.push(e));

    unsub();
    await db.insert(makeTask('1'));

    expect(events).toHaveLength(0);
  });

  test('throwing subscriber does not break db or other subscribers', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const goodEvents: SubscribeEvent<Task>[] = [];

    db.subscribe(() => { throw new Error('bad subscriber'); });
    db.subscribe((e) => goodEvents.push(e));

    await db.insert(makeTask('1'));

    expect(goodEvents).toHaveLength(2);
    expect(db.data.has('1')).toBe(true);
  });

  test('multiple subscribers all notified', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const events1: SubscribeEvent<Task>[] = [];
    const events2: SubscribeEvent<Task>[] = [];

    db.subscribe((e) => events1.push(e));
    db.subscribe((e) => events2.push(e));

    await db.insert(makeTask('1'));

    expect(events1).toHaveLength(2);
    expect(events2).toHaveLength(2);
  });

  test('db.data reflects change when optimistic fires', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    let dataOnOptimistic: ReadonlyMap<string, Readonly<Task>> | undefined;

    db.subscribe((e) => {
      if (e.type === 'optimistic') dataOnOptimistic = db.data;
    });

    const task = makeTask('1');
    await db.insert(task);

    expect(dataOnOptimistic?.has('1')).toBe(true);
  });
});

type CountTask = { id: string; title: string; status: string; count: number };

describe('createDB — M3', () => {
  test('sync middleware runs, mutation commits', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const seen: string[] = [];
    db.use((ctx) => {
      seen.push(ctx.event.op);
    });

    const task = makeTask('1');
    await db.insert(task);

    expect(seen).toEqual(['insert']);
    expect(db.data.get('1')).toEqual(task);
  });

  test('async middleware runs, mutation commits after await', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    let middlewareRan = false;
    db.use(async () => {
      await new Promise((r) => setTimeout(r, 10));
      middlewareRan = true;
    });

    const task = makeTask('1');
    const promise = db.insert(task);

    // Optimistically visible before middleware completes
    expect(db.data.has('1')).toBe(true);
    expect(middlewareRan).toBe(false);

    await promise;
    expect(middlewareRan).toBe(true);
    expect(db.data.get('1')).toEqual(task);
  });

  test('ctx.abort() triggers rollback, promise rejects with AbortError', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const events: SubscribeEvent<Task>[] = [];
    db.subscribe((e) => events.push(e));
    db.use((ctx) => {
      ctx.abort('denied');
    });

    const task = makeTask('1');
    await expect(db.insert(task)).rejects.toBeInstanceOf(AbortError);
    expect(db.data.has('1')).toBe(false);

    const rollback = events.find((e) => e.type === 'rollback');
    expect(rollback).toBeDefined();
    expect(rollback!.type === 'rollback' && rollback!.reason).toBeInstanceOf(AbortError);
  });

  test('thrown error triggers rollback, promise rejects with original error', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const customErr = new Error('custom');
    db.use(() => {
      throw customErr;
    });

    try {
      await db.insert(makeTask('1'));
      expect.unreachable('should have thrown');
    } catch (e) {
      expect(e).toBe(customErr);
    }
    expect(db.data.has('1')).toBe(false);
  });

  test('middleware ordering respected', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const order: number[] = [];
    db.use(() => { order.push(1); });
    db.use(() => { order.push(2); });
    db.use(() => { order.push(3); });

    await db.insert(makeTask('1'));
    expect(order).toEqual([1, 2, 3]);
  });

  test('queue serialization: two mutations, second waits for first', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const order: string[] = [];
    let resolveFirst!: () => void;
    const firstGate = new Promise<void>((r) => { resolveFirst = r; });
    let resolveSecond!: () => void;
    const secondGate = new Promise<void>((r) => { resolveSecond = r; });

    db.use(async (ctx) => {
      const id = ctx.event.op === 'insert' ? ctx.event.id : 'other';
      order.push(`start:${id}`);
      if (id === '1') await firstGate;
      if (id === '2') await secondGate;
      order.push(`end:${id}`);
    });

    const p1 = db.insert(makeTask('1'));
    const p2 = db.insert(makeTask('2'));

    // Both optimistically visible
    expect(db.data.has('1')).toBe(true);
    expect(db.data.has('2')).toBe(true);

    // First middleware started, second hasn't
    expect(order).toEqual(['start:1']);

    resolveFirst();
    await p1;
    // First committed; second now started
    expect(order).toEqual(['start:1', 'end:1', 'start:2']);

    resolveSecond();
    await p2;
    expect(order).toEqual(['start:1', 'end:1', 'start:2', 'end:2']);
  });

  test('rollback + rebase: failed insert does not affect independent insert', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    db.use(async (ctx) => {
      await Promise.resolve();
      if (ctx.event.op === 'insert' && ctx.event.id === 'A') {
        ctx.abort('fail A');
      }
    });

    const pA = db.insert(makeTask('A'));
    const pB = db.insert(makeTask('B'));

    // Both optimistically visible
    expect(db.data.has('A')).toBe(true);
    expect(db.data.has('B')).toBe(true);

    await expect(pA).rejects.toBeInstanceOf(AbortError);
    await pB;

    expect(db.data.has('A')).toBe(false);
    expect(db.data.has('B')).toBe(true);
  });

  test('updater rebase: updater re-evaluates against committed base after rollback', async () => {
    const initial: CountTask = { id: 'B', title: 'Task B', status: 'todo', count: 0 };
    const db = createDB<CountTask>({ getId: (t) => t.id, initial: [initial] });

    db.use(async (ctx) => {
      await Promise.resolve();
      if (ctx.event.op === 'insert' && ctx.event.id === 'A') {
        ctx.abort('fail A');
      }
    });

    const pA = db.insert({ id: 'A', title: 'Task A', status: 'todo', count: 0 });
    const pB = db.update('B' as string, (prev) => ({ ...prev, count: prev.count + 1 }));

    await expect(pA).rejects.toBeInstanceOf(AbortError);
    await pB;

    // Updater re-evaluated against committed state (count=0), so count=1
    expect(db.data.get('B')!.count).toBe(1);
  });

  test('cascade rollback: update on failed insert is also rolled back', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const events: SubscribeEvent<Task>[] = [];
    db.subscribe((e) => events.push(e));

    db.use(async (ctx) => {
      await Promise.resolve();
      if (ctx.event.op === 'insert' && ctx.event.id === 'A') {
        ctx.abort('fail A');
      }
    });

    const pInsert = db.insert(makeTask('A'));
    const pUpdate = db.update('A' as string, { status: 'done' });

    // Observe both rejections concurrently to avoid unhandled rejection
    const [rInsert, rUpdate] = await Promise.allSettled([pInsert, pUpdate]);
    expect(rInsert.status).toBe('rejected');
    expect((rInsert as PromiseRejectedResult).reason).toBeInstanceOf(AbortError);
    expect(rUpdate.status).toBe('rejected');
    expect((rUpdate as PromiseRejectedResult).reason).toBeInstanceOf(AbortError);

    expect(db.data.has('A')).toBe(false);

    // Should have rollback events for both
    const rollbacks = events.filter((e) => e.type === 'rollback');
    expect(rollbacks.length).toBe(2);
  });

  test('validate failure with pending queue rejects synchronously', async () => {
    const db = createDB<Task>({
      getId: (t) => t.id,
      validate: (t) => {
        if (!t.title) throw new Error('title required');
      },
    });

    let resolveGate!: () => void;
    const gate = new Promise<void>((r) => { resolveGate = r; });
    db.use(async () => { await gate; });

    // Start a valid mutation (queued in middleware)
    const p1 = db.insert(makeTask('1'));

    // Try an invalid mutation — throws synchronously, queue unaffected
    expect(() => db.insert({ id: '2', title: '', status: 'todo' })).toThrow('title required');

    resolveGate();
    await p1;

    expect(db.data.has('1')).toBe(true);
    expect(db.data.has('2')).toBe(false);
  });

  test('subscriber receives optimistic immediately, commit after pipeline', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const events: SubscribeEvent<Task>[] = [];

    let resolveGate!: () => void;
    const gate = new Promise<void>((r) => { resolveGate = r; });
    db.use(async () => { await gate; });

    db.subscribe((e) => events.push(e));
    const promise = db.insert(makeTask('1'));

    // Optimistic fires synchronously
    expect(events.length).toBe(1);
    expect(events[0]!.type).toBe('optimistic');

    resolveGate();
    await promise;

    // Commit fires after pipeline
    expect(events.length).toBe(2);
    expect(events[1]!.type).toBe('commit');
  });

  test('middleware unsubscribe works', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const calls: string[] = [];
    const unsub = db.use(() => { calls.push('mw'); });

    unsub();
    await db.insert(makeTask('1'));

    expect(calls).toEqual([]);
    expect(db.data.has('1')).toBe(true);
  });

  test('db.data returns stable reference on cache hit', () => {
    const db = createDB<Task>({ getId: (t) => t.id, initial: [makeTask('1')] });
    const ref1 = db.data;
    const ref2 = db.data;
    expect(ref1).toBe(ref2);
  });

  test('snapshot includes optimistic state', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    let resolveGate!: () => void;
    const gate = new Promise<void>((r) => { resolveGate = r; });
    db.use(async () => { await gate; });

    const promise = db.insert(makeTask('1'));

    // Not yet committed, but snapshot should include it
    expect(db.snapshot().length).toBe(1);
    expect(db.snapshot()[0]!.id).toBe('1');

    resolveGate();
    await promise;
  });

  test('rollback event includes reason', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const events: SubscribeEvent<Task>[] = [];
    db.subscribe((e) => events.push(e));
    db.use((ctx) => { ctx.abort('nope'); });

    await expect(db.insert(makeTask('1'))).rejects.toBeInstanceOf(AbortError);

    const rollback = events.find((e) => e.type === 'rollback');
    expect(rollback).toBeDefined();
    if (rollback!.type === 'rollback') {
      expect(rollback!.reason).toBeInstanceOf(AbortError);
      expect((rollback!.reason as AbortError).reason).toBe('nope');
    }
  });

  test('cascaded promises reject with upstream error', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    db.use(async (ctx) => {
      await Promise.resolve();
      if (ctx.event.op === 'insert' && ctx.event.id === 'A') {
        ctx.abort('upstream fail');
      }
    });

    const pInsert = db.insert(makeTask('A'));
    const pUpdate = db.update('A' as string, { status: 'done' });

    let insertErr: unknown;
    let updateErr: unknown;
    try { await pInsert; } catch (e) { insertErr = e; }
    try { await pUpdate; } catch (e) { updateErr = e; }

    // Both reject with the same upstream AbortError
    expect(insertErr).toBeInstanceOf(AbortError);
    expect(updateErr).toBe(insertErr);
  });
});

describe('createDB — M4', () => {
  test('batch with multiple operations, all appear in data', async () => {
    const db = createDB<Task>({ getId: (t) => t.id, initial: [makeTask('1')] });

    await db.batch((tx) => {
      tx.insert(makeTask('2'));
      tx.insert(makeTask('3'));
      tx.update('1', { status: 'done' });
    });

    expect(db.data.size).toBe(3);
    expect(db.data.get('1')!.status).toBe('done');
    expect(db.data.has('2')).toBe(true);
    expect(db.data.has('3')).toBe(true);
  });

  test('batch middleware receives single event with op: batch', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const events: MutateEvent<Task>[] = [];
    db.use((ctx) => { events.push(ctx.event); });

    await db.batch((tx) => {
      tx.insert(makeTask('1'));
      tx.insert(makeTask('2'));
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.op).toBe('batch');
    if (events[0]!.op === 'batch') {
      expect(events[0]!.mutations).toHaveLength(2);
      expect(events[0]!.mutations[0]!.op).toBe('insert');
      expect(events[0]!.mutations[1]!.op).toBe('insert');
    }
  });

  test('batch rollback reverts all operations', async () => {
    const db = createDB<Task>({ getId: (t) => t.id, initial: [makeTask('1')] });
    const events: SubscribeEvent<Task>[] = [];
    db.subscribe((e) => events.push(e));
    db.use(() => { throw new Error('fail'); });

    await expect(
      db.batch((tx) => {
        tx.insert(makeTask('2'));
        tx.update('1', { status: 'done' });
      }),
    ).rejects.toThrow('fail');

    expect(db.data.size).toBe(1);
    expect(db.data.get('1')!.status).toBe('todo');
    expect(db.data.has('2')).toBe(false);

    const rollbacks = events.filter((e) => e.type === 'rollback');
    expect(rollbacks).toHaveLength(1);
    expect(rollbacks[0]!.type === 'rollback' && rollbacks[0]!.event.op).toBe('batch');
  });

  test('batch with invalid operation throws synchronously', () => {
    const db = createDB<Task>({ getId: (t) => t.id });

    expect(() => {
      db.batch((tx) => {
        tx.update('nope' as string, { status: 'done' });
      });
    }).toThrow('does not exist');

    expect(db.data.size).toBe(0);
  });

  test('batch interacts correctly with queue', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const order: string[] = [];
    db.use(async (ctx) => {
      order.push(ctx.event.op);
      await Promise.resolve();
    });

    const p1 = db.insert(makeTask('1'));
    const pBatch = db.batch((tx) => {
      tx.insert(makeTask('2'));
      tx.insert(makeTask('3'));
    });
    const p3 = db.insert(makeTask('4'));

    expect(db.data.size).toBe(4);

    await Promise.all([p1, pBatch, p3]);

    expect(order).toEqual(['insert', 'batch', 'insert']);
    expect(db.data.size).toBe(4);
  });

  test('tx.insert then tx.update on same ID works', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });

    await db.batch((tx) => {
      tx.insert(makeTask('1'));
      tx.update('1' as string, { status: 'done' });
    });

    expect(db.data.get('1')!.status).toBe('done');
  });

  test('tx.insert then tx.remove on same ID works', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });

    await db.batch((tx) => {
      tx.insert(makeTask('1'));
      tx.remove('1' as string);
    });

    expect(db.data.has('1')).toBe(false);
  });

  test('empty batch resolves without triggering middleware', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    let mwCalled = false;
    db.use(() => { mwCalled = true; });

    await db.batch(() => {});

    expect(mwCalled).toBe(false);
  });

  test('batch fn throwing prevents pending intent', () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    let mwCalled = false;
    db.use(() => { mwCalled = true; });

    expect(() => {
      db.batch(() => { throw new Error('user error'); });
    }).toThrow('user error');

    expect(mwCalled).toBe(false);
    expect(db.data.size).toBe(0);
  });

  test('batch subscriber receives optimistic immediately, commit after pipeline', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const events: SubscribeEvent<Task>[] = [];
    let resolveGate!: () => void;
    const gate = new Promise<void>((r) => { resolveGate = r; });
    db.use(async () => { await gate; });
    db.subscribe((e) => events.push(e));

    const promise = db.batch((tx) => {
      tx.insert(makeTask('1'));
      tx.insert(makeTask('2'));
    });

    expect(events).toHaveLength(1);
    expect(events[0]!.type).toBe('optimistic');
    expect(events[0]!.type === 'optimistic' && events[0]!.event.op).toBe('batch');
    expect(db.data.size).toBe(2);

    resolveGate();
    await promise;

    expect(events).toHaveLength(2);
    expect(events[1]!.type).toBe('commit');
  });

  test('batch cascade: later intent depending on batch insert is cascaded', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    db.use(async (ctx) => {
      await Promise.resolve();
      if (ctx.event.op === 'batch') {
        throw new Error('batch fail');
      }
    });

    const pBatch = db.batch((tx) => {
      tx.insert(makeTask('A'));
    });
    const pUpdate = db.update('A' as string, { status: 'done' });

    const [rBatch, rUpdate] = await Promise.allSettled([pBatch, pUpdate]);
    expect(rBatch.status).toBe('rejected');
    expect(rUpdate.status).toBe('rejected');

    expect(db.data.has('A')).toBe(false);
  });

  test('batch respects validate option', () => {
    const db = createDB<Task>({
      getId: (t) => t.id,
      validate: (t) => { if (!t.title) throw new Error('title required'); },
    });

    expect(() => {
      db.batch((tx) => {
        tx.insert({ id: '1', title: '', status: 'todo' });
      });
    }).toThrow('title required');

    expect(db.data.size).toBe(0);
  });
});

describe('createDB — M5', () => {
  test('dispose rejects pending mutation promises with DisposedError', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    let resolveGate!: () => void;
    const gate = new Promise<void>((r) => { resolveGate = r; });
    db.use(async () => { await gate; });

    const promise = db.insert(makeTask('1'));
    db.dispose();

    await expect(promise).rejects.toBeInstanceOf(DisposedError);
    resolveGate();
  });

  test('post-dispose insert throws DisposedError', () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    db.dispose();
    expect(() => db.insert(makeTask('1'))).toThrow(DisposedError);
  });

  test('post-dispose update throws DisposedError', () => {
    const db = createDB<Task>({ getId: (t) => t.id, initial: [makeTask('1')] });
    db.dispose();
    expect(() => db.update('1', { status: 'done' })).toThrow(DisposedError);
  });

  test('post-dispose remove throws DisposedError', () => {
    const db = createDB<Task>({ getId: (t) => t.id, initial: [makeTask('1')] });
    db.dispose();
    expect(() => db.remove('1')).toThrow(DisposedError);
  });

  test('post-dispose batch throws DisposedError', () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    db.dispose();
    expect(() => db.batch((tx) => { tx.insert(makeTask('1')); })).toThrow(DisposedError);
  });

  test('post-dispose db.data is empty', () => {
    const db = createDB<Task>({ getId: (t) => t.id, initial: [makeTask('1'), makeTask('2')] });
    expect(db.data.size).toBe(2);
    db.dispose();
    expect(db.data.size).toBe(0);
  });

  test('dispose clears subscribers — no further notifications', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const events: SubscribeEvent<Task>[] = [];
    db.subscribe((e) => events.push(e));

    await db.insert(makeTask('1'));
    const countBefore = events.length;

    db.dispose();

    // No new events should fire — mutations throw, so subscribers are never triggered
    expect(() => db.insert(makeTask('2'))).toThrow(DisposedError);
    expect(events.length).toBe(countBefore);
  });

  test('dispose with multiple pending mutations rejects all', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    let resolveGate!: () => void;
    const gate = new Promise<void>((r) => { resolveGate = r; });
    db.use(async () => { await gate; });

    const p1 = db.insert(makeTask('1'));
    const p2 = db.insert(makeTask('2'));
    const p3 = db.insert(makeTask('3'));

    db.dispose();

    const results = await Promise.allSettled([p1, p2, p3]);
    for (const result of results) {
      expect(result.status).toBe('rejected');
      expect((result as PromiseRejectedResult).reason).toBeInstanceOf(DisposedError);
    }
    resolveGate();
  });

  test('snapshot is empty after dispose', () => {
    const db = createDB<Task>({ getId: (t) => t.id, initial: [makeTask('1')] });
    db.dispose();
    expect(db.snapshot()).toEqual([]);
  });

  test('full lifecycle integration', async () => {
    const db = createDB<Task>({ getId: (t) => t.id });
    const log: string[] = [];

    // Middleware: validation
    db.use((ctx) => {
      if (ctx.event.op === 'insert' && !ctx.event.record.title) {
        ctx.abort('title is required');
      }
    });

    // Middleware: mock persistence
    db.use(async () => {
      await Promise.resolve();
    });

    // Subscriber
    db.subscribe((event) => {
      log.push(`${event.type}:${event.event.op}`);
    });

    // Insert
    await db.insert({ id: '1', title: 'Write spec', status: 'todo' });
    expect(db.data.get('1')!.title).toBe('Write spec');

    // Update
    await db.update('1', { status: 'done' });
    expect(db.data.get('1')!.status).toBe('done');

    // Batch
    await db.batch((tx) => {
      tx.insert({ id: '2', title: 'Review', status: 'todo' });
      tx.remove('1');
    });
    expect(db.data.has('1')).toBe(false);
    expect(db.data.has('2')).toBe(true);

    // Subscriber was notified for all operations
    expect(log).toEqual([
      'optimistic:insert', 'commit:insert',
      'optimistic:update', 'commit:update',
      'optimistic:batch', 'commit:batch',
    ]);

    // Dispose
    db.dispose();
    expect(db.data.size).toBe(0);
    expect(() => db.insert(makeTask('3'))).toThrow(DisposedError);
  });
});
