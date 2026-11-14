import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createQueue, createPrefetcher, AbortedError } from '../js/prefetch.js';
import { timeAgo, domainOf, compact, hueOf } from '../js/util.js';

const tick = () => new Promise((r) => setTimeout(r, 0));

// A fake HN that resolves when we say so, and records concurrency.
function fakeHn({ dead = [] } = {}) {
  const pending = new Map();
  const calls = [];
  let active = 0;
  let peak = 0;
  return {
    calls,
    get peak() {
      return peak;
    },
    fetchItem(id) {
      calls.push(id);
      active++;
      peak = Math.max(peak, active);
      return new Promise((resolve, reject) => {
        pending.set(id, {
          ok: () => {
            active--;
            resolve(dead.includes(id) ? { id, dead: true } : { id, title: `story ${id}` });
          },
          fail: () => {
            active--;
            reject(new Error('net'));
          },
        });
      });
    },
    finish(id) {
      pending.get(id).ok();
      pending.delete(id);
    },
    fail(id) {
      pending.get(id).fail();
      pending.delete(id);
    },
    async finishAll() {
      await tick();
      while (pending.size) {
        for (const id of [...pending.keys()]) this.finish(id);
        await tick();
      }
    },
  };
}

const ids = Array.from({ length: 50 }, (_, i) => 1000 + i);

test('ensure queues current + next 10 and never more than 5 at once', async () => {
  const hn = fakeHn();
  const pf = createPrefetcher({ fetchItem: (id) => hn.fetchItem(id) });
  const queued = pf.ensure(ids, 0);
  assert.equal(queued.length, 11);
  await tick();
  assert.equal(hn.calls.length, 5, 'only 5 in flight at first');
  await hn.finishAll();
  assert.equal(hn.calls.length, 11);
  assert.ok(hn.peak <= 5, `peak was ${hn.peak}`);
  for (let k = 0; k <= 10; k++) assert.ok(pf.has(ids[k]));
  assert.ok(!pf.has(ids[11]));
});

test('moving one card fetches exactly one new story', async () => {
  const hn = fakeHn();
  const pf = createPrefetcher({ fetchItem: (id) => hn.fetchItem(id) });
  pf.ensure(ids, 0);
  await hn.finishAll();
  const before = hn.calls.length;
  const queued = pf.ensure(ids, 1);
  assert.deepEqual(queued, [ids[11]]);
  await hn.finishAll();
  assert.equal(hn.calls.length, before + 1);
});

test('in-flight requests are deduped', async () => {
  const hn = fakeHn();
  const pf = createPrefetcher({ fetchItem: (id) => hn.fetchItem(id) });
  const a = pf.load(ids[0]);
  const b = pf.load(ids[0]);
  assert.equal(a, b);
  pf.ensure(ids, 0);
  await hn.finishAll();
  assert.equal(hn.calls.filter((id) => id === ids[0]).length, 1);
});

test('the current story jumps the queue', async () => {
  const hn = fakeHn();
  const pf = createPrefetcher({ fetchItem: (id) => hn.fetchItem(id), concurrency: 1 });
  pf.ensure(ids, 0); // 1000 starts, 1001..1010 wait
  await tick();
  pf.ensure(ids, 8); // user flung to 1008: it must be next
  hn.finish(ids[0]);
  await tick();
  await tick();
  assert.equal(hn.calls[1], ids[8]);
});

test('dead and deleted stories are cached as null and reported', async () => {
  const hn = fakeHn({ dead: [ids[3]] });
  const loaded = [];
  const pf = createPrefetcher({ fetchItem: (id) => hn.fetchItem(id), onLoad: (id, it) => loaded.push([id, it]) });
  pf.ensure(ids, 0);
  await hn.finishAll();
  assert.equal(pf.get(ids[3]), null);
  assert.ok(loaded.some(([id, it]) => id === ids[3] && it === null));
});

test('errors call onError and are retried on the next load', async () => {
  const hn = fakeHn();
  const errors = [];
  const pf = createPrefetcher({ fetchItem: (id) => hn.fetchItem(id), onError: (id) => errors.push(id) });
  const p = pf.load(ids[0]).catch((e) => e);
  await tick();
  hn.fail(ids[0]);
  const err = await p;
  assert.equal(err.message, 'net');
  assert.deepEqual(errors, [ids[0]]);
  assert.ok(!pf.has(ids[0]));
  const again = pf.load(ids[0]);
  await tick();
  hn.finish(ids[0]);
  assert.equal((await again).id, ids[0]);
});

test('reset drops queued work but keeps the cache', async () => {
  const hn = fakeHn();
  const errors = [];
  const pf = createPrefetcher({ fetchItem: (id) => hn.fetchItem(id), onError: (id) => errors.push(id) });
  pf.ensure(ids, 0);
  await tick();
  pf.reset(); // 5 running keep going, 6 waiting are dropped
  await hn.finishAll();
  assert.equal(hn.calls.length, 5);
  assert.equal(pf.inflight.size, 0);
  assert.deepEqual(errors, [], 'aborts are not errors');
  pf.ensure(ids, 0);
  await hn.finishAll();
  assert.equal(hn.calls.length, 11, 'only the dropped 6 are fetched again');
});

test('window stops at the end of the list', () => {
  const pf = createPrefetcher({ fetchItem: () => new Promise(() => {}) });
  assert.equal(pf.ensure(ids, 45).length, 5);
});

test('queue rejects cleared jobs with AbortedError', async () => {
  const q = createQueue(1);
  q.push(() => new Promise(() => {}));
  const waiting = q.push(() => 1);
  q.clear();
  await assert.rejects(waiting, AbortedError);
});

test('util helpers', () => {
  const now = 1_700_000_000_000;
  assert.equal(timeAgo(now / 1000 - 30, now), '30s');
  assert.equal(timeAgo(now / 1000 - 3 * 3600, now), '3h');
  assert.equal(timeAgo(now / 1000 - 2 * 86400, now), '2d');
  assert.equal(domainOf('https://www.github.com/withrvr'), 'github.com');
  assert.equal(domainOf(undefined), '');
  assert.equal(compact(412), '412');
  assert.equal(compact(1234), '1.2k');
  assert.equal(compact(18500), '19k');
  assert.equal(hueOf('github.com'), hueOf('github.com'));
});
