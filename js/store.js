// Storage: IndexedDB for cached stories, localStorage for small settings.
// Every call is wrapped so private mode or a full disk never breaks the app.

const DB_NAME = 'orangereel';
const STORE = 'items';
const MAX_AGE_MS = 3 * 24 * 60 * 60 * 1000; // prune cache entries older than 3 days

let dbPromise;

function openDb() {
  if (!dbPromise) {
    dbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }
  return dbPromise;
}

export async function idbGet(key) {
  try {
    const db = await openDb();
    return await new Promise((resolve, reject) => {
      const req = db.transaction(STORE).objectStore(STORE).get(key);
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return undefined;
  }
}

export async function idbSet(key, value) {
  try {
    const db = await openDb();
    db.transaction(STORE, 'readwrite').objectStore(STORE).put(value, key);
  } catch {
    /* ignore */
  }
}

export async function idbPrune() {
  try {
    const db = await openDb();
    const cutoff = Date.now() - MAX_AGE_MS;
    const req = db.transaction(STORE, 'readwrite').objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const cur = req.result;
      if (!cur) return;
      if (!cur.value || cur.value.t < cutoff) cur.delete();
      cur.continue();
    };
  } catch {
    /* ignore */
  }
}

export const ls = {
  get(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : JSON.parse(raw);
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* ignore */
    }
  },
};

// Saved stories, newest first.
export const saved = {
  list: () => ls.get('saved', []),
  has: (id) => saved.list().includes(id),
  toggle(id) {
    const list = saved.list();
    const i = list.indexOf(id);
    if (i >= 0) list.splice(i, 1);
    else list.unshift(id);
    ls.set('saved', list);
    return i < 0;
  },
};
