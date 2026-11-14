// The prefetch engine. Pure JS, no DOM, so it runs in Node tests unchanged.
//
// Rule: when the user is on index i, stories i .. i+AHEAD are cached or in flight.
// Requests go through a small queue capped at CONCURRENCY. The current story
// jumps the queue so a fast fling never waits behind prefetches.

export const AHEAD = 10;
export const CONCURRENCY = 5;

export class AbortedError extends Error {
  constructor() {
    super('aborted');
    this.name = 'AbortedError';
  }
}

export function createQueue(limit = CONCURRENCY) {
  const waiting = [];
  let active = 0;

  const pump = () => {
    while (active < limit && waiting.length) {
      const job = waiting.shift();
      active++;
      Promise.resolve()
        .then(job.task)
        .then(job.resolve, job.reject)
        .finally(() => {
          active--;
          pump();
        });
    }
  };

  return {
    push(task, { front = false, key } = {}) {
      return new Promise((resolve, reject) => {
        const job = { task, resolve, reject, key };
        if (front) waiting.unshift(job);
        else waiting.push(job);
        pump();
      });
    },
    // Move a waiting job to the front. True if it was waiting.
    promote(key) {
      const i = waiting.findIndex((job) => job.key === key);
      if (i <= 0) return i === 0;
      waiting.unshift(...waiting.splice(i, 1));
      return true;
    },
    // Drop everything not yet started. Started requests finish normally.
    clear() {
      const dropped = waiting.splice(0);
      dropped.forEach((job) => job.reject(new AbortedError()));
    },
    get active() {
      return active;
    },
    get waiting() {
      return waiting.length;
    },
  };
}

const usable = (item) => (item && !item.dead && !item.deleted ? item : null);

export function createPrefetcher({
  fetchItem,
  ahead = AHEAD,
  concurrency = CONCURRENCY,
  onLoad = () => {},
  onError = () => {},
} = {}) {
  const cache = new Map(); // id -> item, or null for dead / deleted
  const inflight = new Map(); // id -> Promise
  const queue = createQueue(concurrency);

  function load(id, { urgent = false } = {}) {
    if (cache.has(id)) return Promise.resolve(cache.get(id));
    if (inflight.has(id)) return inflight.get(id);

    const p = queue.push(() => fetchItem(id), { front: urgent, key: id }).then(
      (raw) => {
        inflight.delete(id);
        const item = usable(raw);
        cache.set(id, item);
        onLoad(id, item);
        return item;
      },
      (err) => {
        inflight.delete(id);
        if (!(err instanceof AbortedError)) onError(id, err);
        throw err;
      },
    );
    inflight.set(id, p);
    return p;
  }

  // Make sure ids[i .. i+ahead] are cached or loading. Returns the ids it queued.
  function ensure(ids, i) {
    const queued = [];
    const end = Math.min(ids.length, i + ahead + 1);
    for (let k = Math.max(0, i); k < end; k++) {
      const id = ids[k];
      if (cache.has(id)) continue;
      if (inflight.has(id)) {
        if (k === i) queue.promote(id);
        continue;
      }
      load(id, { urgent: k === i }).catch(() => {});
      queued.push(id);
    }
    return queued;
  }

  // New feed: forget queued work, keep the cache (stories are shared across feeds).
  function reset() {
    queue.clear();
  }

  return {
    load,
    ensure,
    reset,
    get: (id) => cache.get(id),
    has: (id) => cache.has(id),
    isLoading: (id) => inflight.has(id),
    forget: (id) => cache.delete(id),
    cache,
    inflight,
    queue,
  };
}
