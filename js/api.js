// Hacker News data. Firebase for feeds and items, Algolia for whole comment trees.
// Both allow browser CORS and need no key.

const HN = 'https://hacker-news.firebaseio.com/v0';
const ALGOLIA = 'https://hn.algolia.com/api/v1';

export const FEEDS = [
  { key: 'top', label: 'Top', path: 'topstories' },
  { key: 'new', label: 'New', path: 'newstories' },
  { key: 'best', label: 'Best', path: 'beststories' },
  { key: 'ask', label: 'Ask', path: 'askstories' },
  { key: 'show', label: 'Show', path: 'showstories' },
  { key: 'jobs', label: 'Jobs', path: 'jobstories' },
  { key: 'saved', label: 'Saved', path: null },
];

async function getJson(url, signal) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

export function feedIds(feedKey, signal) {
  const feed = FEEDS.find((f) => f.key === feedKey);
  if (!feed || !feed.path) return Promise.resolve([]);
  return getJson(`${HN}/${feed.path}.json`, signal);
}

export function item(id, signal) {
  return getJson(`${HN}/item/${id}.json`, signal);
}

// Story plus every comment, nested, in one request.
export function thread(id, signal) {
  return getJson(`${ALGOLIA}/items/${id}`, signal);
}
