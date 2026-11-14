// Orangereel: wiring. Feed loading, the scroll window, gestures, keys, comments.

import { FEEDS, feedIds, item as fetchItemNet, thread as fetchThread } from './api.js';
import { createPrefetcher, AHEAD } from './prefetch.js';
import { idbGet, idbSet, idbPrune, ls, saved } from './store.js';
import * as ui from './ui.js';
import { hnItemUrl } from './util.js';

const ITEM_TTL = 15 * 60 * 1000; // score and comment counts go stale after 15 min
const IDS_TTL = 5 * 60 * 1000; // feed order goes stale after 5 min
const BEHIND = 3; // cards kept rendered above the current one
const PREVIEW_AHEAD = 2; // top-comment previews for i .. i+2
const THREAD_AHEAD = 2; // full comment trees for i+1 .. i+2
const NUDGE_EVERY = 50;

const $ = (id) => document.getElementById(id);
const feedEl = $('feed');
const tabsEl = $('tabs');
const progressEl = $('progress');
const sheet = $('sheet');
const sheetBody = $('sheetBody');
const backdrop = $('backdrop');
const prevBtn = $('prevBtn');
const nextBtn = $('nextBtn');

const desktop = window.matchMedia('(min-width: 1024px)');
const finePointer = window.matchMedia('(pointer: fine)');

const state = {
  feed: 'top',
  ids: [],
  idIndex: new Map(),
  cards: [],
  endCard: null,
  index: -1,
  token: 0,
  sheetFor: null,
  viewed: new Set(),
  sessionStart: Date.now(),
};
const painted = new Set();
const threads = new Map();

// ---------- data ----------

async function cachedItem(id) {
  const hit = await idbGet(`i:${id}`);
  if (hit && Date.now() - hit.t < ITEM_TTL) return hit.v;
  try {
    const v = await fetchItemNet(id);
    if (v) idbSet(`i:${id}`, { t: Date.now(), v });
    return v;
  } catch (err) {
    if (hit) return hit.v; // offline: stale is better than nothing
    throw err;
  }
}

const pf = createPrefetcher({ fetchItem: cachedItem, onLoad: handleLoad, onError: handleError });

function getThread(id) {
  if (!threads.has(id)) {
    const p = fetchThread(id).catch((err) => {
      threads.delete(id);
      throw err;
    });
    threads.set(id, p);
  }
  return threads.get(id);
}

async function getIds(feed, fresh) {
  if (feed === 'saved') return saved.list();
  const cached = ls.get(`ids:${feed}`, null);
  if (!fresh && cached && Date.now() - cached.t < IDS_TTL) return cached.v;
  try {
    const ids = await feedIds(feed);
    ls.set(`ids:${feed}`, { t: Date.now(), v: ids });
    return ids;
  } catch (err) {
    if (cached) return cached.v;
    throw err;
  }
}

// ---------- rendering window ----------

function paint(k) {
  const el = state.cards[k];
  const id = state.ids[k];
  if (!el) return;
  painted.add(el);
  if (pf.has(id)) {
    const it = pf.get(id);
    if (!it) return; // removed story, handled in handleLoad
    if (el.dataset.id !== String(id)) {
      ui.renderStory(el, it, {
        index: k,
        saved: saved.has(id),
        first: k === 0 && !ls.get('hinted', false),
      });
      delete el.dataset.pv;
    }
  } else if (el.dataset.state !== 'loading' && el.dataset.state !== 'msg') {
    ui.renderLoading(el, k);
  }
}

function ensurePreview(k) {
  const el = state.cards[k];
  const it = pf.get(state.ids[k]);
  if (!el || !it || el.dataset.state !== 'ready' || el.dataset.pv) return;
  el.dataset.pv = '1';
  const first = it.kids && it.kids[0];
  if (!first) return;
  pf.load(first)
    .then((c) => {
      if (el.dataset.id === String(it.id)) ui.renderPreview(el, c);
    })
    .catch(() => {});
}

function hydrate(i) {
  const lo = Math.max(0, i - BEHIND);
  const hi = Math.min(state.cards.length - 1, i + AHEAD);
  for (let k = lo; k <= hi; k++) paint(k);
  // Free cards that drifted far away.
  for (const el of painted) {
    const k = Number(el.dataset.index);
    if (k < lo - 2 || k > hi + 2) {
      ui.renderIdle(el);
      delete el.dataset.pv;
      painted.delete(el);
    }
  }
}

function handleLoad(id, item) {
  const k = state.idIndex.get(id);
  if (k == null) return; // a comment preview, not a story in this feed
  if (item === null) {
    removeAt(k);
    return;
  }
  if (k >= state.index - BEHIND && k <= state.index + AHEAD) {
    paint(k);
    if (k <= state.index + PREVIEW_AHEAD) ensurePreview(k);
  }
}

function handleError(id) {
  const k = state.idIndex.get(id);
  const el = state.cards[k];
  if (k == null || !el || !painted.has(el)) return;
  ui.renderMessage(el, "Couldn't load this story. Check your connection.", 'Retry', () => {
    ui.renderLoading(el, k);
    pf.load(id, { urgent: true }).catch(() => {});
  });
}

// Dead or deleted story: drop it if it is ahead of us, so the window stays full.
function removeAt(k) {
  const el = state.cards[k];
  if (!el) return;
  if (k <= state.index) {
    ui.renderMessage(el, 'This story was removed from HN.', null);
    return;
  }
  state.ids.splice(k, 1);
  state.cards.splice(k, 1);
  observer.unobserve(el);
  painted.delete(el);
  el.remove();
  for (let j = k; j < state.cards.length; j++) {
    const c = state.cards[j];
    c.dataset.index = String(j);
    if (c.dataset.state === 'ready' || c.dataset.state === 'loading') {
      c.querySelector('.rank').textContent = `#${j + 1}`;
    }
  }
  if (state.endCard) state.endCard.dataset.index = String(state.ids.length);
  rebuildIndex();
  pf.ensure(state.ids, state.index);
  hydrate(state.index);
}

function rebuildIndex() {
  state.idIndex = new Map(state.ids.map((id, k) => [id, k]));
}

// ---------- active card ----------

function setActive(i) {
  if (i === state.index) return;
  state.index = i;
  const id = state.ids[i];

  if (id != null) ls.set(`pos:${state.feed}`, id);
  progressEl.style.width = `${Math.min(100, ((i + 1) / state.ids.length) * 100)}%`;
  prevBtn.disabled = i <= 0;
  nextBtn.disabled = i >= state.ids.length;

  pf.ensure(state.ids, i);
  hydrate(i);
  for (let k = i; k <= i + PREVIEW_AHEAD; k++) ensurePreview(k);
  for (let k = i + 1; k <= i + THREAD_AHEAD; k++) {
    const it = pf.get(state.ids[k]);
    if (it && it.descendants) getThread(it.id).catch(() => {});
  }

  if (i > 0 && !ls.get('hinted', false)) {
    ls.set('hinted', true);
    if (state.cards[0]) delete state.cards[0].dataset.first;
  }

  if (id != null && !state.viewed.has(id)) {
    state.viewed.add(id);
    const n = state.viewed.size;
    if (n % NUDGE_EVERY === 0) {
      const mins = Math.max(1, Math.round((Date.now() - state.sessionStart) / 60000));
      ui.toast(`${n} stories in ${mins} min. Still having fun?`, 4000);
    }
  }

  if (state.sheetFor != null && desktop.matches && id != null) openComments(i);
}

const observer = new IntersectionObserver(
  (entries) => {
    for (const e of entries) {
      if (e.isIntersecting && e.intersectionRatio >= 0.6) setActive(Number(e.target.dataset.index));
    }
  },
  { root: feedEl, threshold: [0.6] },
);

// ---------- feed ----------

function renderTabs() {
  tabsEl.replaceChildren(
    ...FEEDS.map((f) => {
      const b = document.createElement('button');
      b.className = 'tab';
      b.textContent = f.label;
      b.dataset.feed = f.key;
      b.setAttribute('aria-current', String(f.key === state.feed));
      b.addEventListener('click', () => {
        if (f.key === state.feed) loadFeed(f.key, { fresh: true });
        else loadFeed(f.key);
      });
      return b;
    }),
  );
}

function messageCard(text, button, onClick) {
  const el = ui.createCard(0);
  el.querySelector('.rail').remove();
  ui.renderMessage(el, text, button, onClick);
  return el;
}

async function loadFeed(feed, { fresh = false } = {}) {
  const token = ++state.token;
  state.feed = feed;
  ls.set('feed', feed);
  closeSheet();
  history.replaceState(null, '', `#${feed}`);
  tabsEl.querySelectorAll('.tab').forEach((t) => t.setAttribute('aria-current', String(t.dataset.feed === feed)));

  pf.reset();
  observer.disconnect();
  painted.clear();
  state.index = -1;
  state.cards = [];
  progressEl.style.width = '0';

  const loading = ui.createCard(0);
  ui.renderLoading(loading, 0);
  loading.querySelector('.rank').textContent = '';
  feedEl.replaceChildren(loading);

  let ids;
  try {
    ids = await getIds(feed, fresh);
  } catch {
    if (token !== state.token) return;
    feedEl.replaceChildren(
      messageCard("Couldn't reach Hacker News. Check your connection.", 'Try again', () => loadFeed(feed, { fresh: true })),
    );
    return;
  }
  if (token !== state.token) return; // user switched feeds meanwhile

  state.ids = ids.filter((id) => !(pf.has(id) && pf.get(id) === null)); // skip known dead stories
  rebuildIndex();

  if (!state.ids.length) {
    const text = feed === 'saved' ? 'Nothing saved yet. Double tap a story to save it.' : 'This feed is empty right now.';
    feedEl.replaceChildren(messageCard(text, null));
    return;
  }

  state.cards = state.ids.map((_, k) => ui.createCard(k));
  state.endCard = ui.createEndCard(() => loadFeed(feed, { fresh: true }));
  state.endCard.dataset.index = String(state.ids.length);
  feedEl.replaceChildren(...state.cards, state.endCard);
  state.cards.forEach((c) => observer.observe(c));
  observer.observe(state.endCard);

  let start = 0;
  if (!fresh) {
    const lastId = ls.get(`pos:${feed}`, null);
    const k = lastId == null ? -1 : state.idIndex.get(lastId) ?? -1;
    if (k > 0) start = k;
  }
  state.cards[start].scrollIntoView({ block: 'start', behavior: 'instant' });
  setActive(start);
  if (start > 0) ui.toast(`Picked up where you left off (#${start + 1})`);
}

// ---------- actions ----------

function go(delta) {
  const n = Math.max(0, Math.min(state.ids.length, state.index + delta));
  const target = n === state.ids.length ? state.endCard : state.cards[n];
  if (target) target.scrollIntoView({ block: 'start', behavior: 'smooth' });
}

function storyAt(k) {
  return pf.get(state.ids[k]) || null;
}

function toggleSave(k, withBurst) {
  const it = storyAt(k);
  if (!it) return;
  const on = saved.toggle(it.id);
  ui.setSaved(state.cards[k], on);
  if (on && withBurst) ui.burst(state.cards[k]);
  ui.toast(on ? 'Saved' : 'Removed from saved', 1400);
}

async function share(k) {
  const it = storyAt(k);
  if (!it) return;
  const url = it.url || hnItemUrl(it.id);
  if (navigator.share) {
    try {
      await navigator.share({ title: it.title, url });
    } catch {
      /* user cancelled */
    }
    return;
  }
  try {
    await navigator.clipboard.writeText(url);
    ui.toast('Link copied');
  } catch {
    ui.toast(url, 4000);
  }
}

function openArticle(k) {
  const it = storyAt(k);
  if (it) window.open(it.url || hnItemUrl(it.id), '_blank', 'noopener');
}

function act(action, k) {
  if (action === 'save') toggleSave(k, true);
  else if (action === 'comments') openComments(k);
  else if (action === 'share') share(k);
  else if (action === 'open') openArticle(k);
}

// ---------- comments sheet ----------

function openComments(k) {
  const it = storyAt(k);
  if (!it) return;
  const wasOpen = state.sheetFor != null;
  if (state.sheetFor === it.id && wasOpen) return;
  state.sheetFor = it.id;

  $('sheetTitle').textContent = it.title || 'Comments';
  $('sheetLink').href = hnItemUrl(it.id);
  sheet.classList.add('open');
  sheet.setAttribute('aria-hidden', 'false');
  document.body.classList.add('sheet-open');
  if (!desktop.matches) backdrop.hidden = false;
  if (!wasOpen && !desktop.matches) history.pushState({ sheet: true }, '');
  sheetBody.scrollTop = 0;

  if (!it.descendants) {
    ui.renderSheetMessage(sheetBody, it.type === 'job' ? 'Jobs have no comments.' : 'No comments yet.');
    return;
  }
  ui.renderSheetMessage(sheetBody, `Loading ${it.descendants} comments`);
  getThread(it.id)
    .then((t) => {
      if (state.sheetFor === it.id) ui.renderThread(sheetBody, t, it.kids || []);
    })
    .catch(() => {
      if (state.sheetFor === it.id) ui.renderSheetMessage(sheetBody, "Couldn't load comments. Close and try again.");
    });
}

function closeSheet({ fromHistory = false } = {}) {
  if (state.sheetFor == null) return;
  state.sheetFor = null;
  sheet.classList.remove('open');
  sheet.setAttribute('aria-hidden', 'true');
  document.body.classList.remove('sheet-open');
  backdrop.hidden = true;
  if (!fromHistory && history.state && history.state.sheet) history.back();
}

window.addEventListener('popstate', () => closeSheet({ fromHistory: true }));
backdrop.addEventListener('click', () => closeSheet());
$('sheetClose').addEventListener('click', () => closeSheet());

// Swipe the sheet header down to close (phone).
{
  let y0 = null;
  const head = sheet.querySelector('.sheet-head');
  head.addEventListener('touchstart', (e) => (y0 = e.touches[0].clientY), { passive: true });
  head.addEventListener('touchend', (e) => {
    if (y0 != null && e.changedTouches[0].clientY - y0 > 60) closeSheet();
    y0 = null;
  });
}

// ---------- gestures ----------

const cardOf = (target) => target.closest('.card');
const indexOf = (card) => (card && card.dataset.index != null ? Number(card.dataset.index) : -1);

feedEl.addEventListener('click', (e) => {
  const btn = e.target.closest('[data-act]');
  if (btn) {
    act(btn.dataset.act, indexOf(cardOf(btn)));
    return;
  }
  if (e.target.closest('.preview')) openComments(indexOf(cardOf(e.target)));
});

// Double tap to save. Single taps do nothing, so no delay is added to links.
{
  let last = { t: 0, x: 0, y: 0, k: -1 };
  feedEl.addEventListener('pointerup', (e) => {
    if (e.target.closest('a, button')) return;
    const k = indexOf(cardOf(e.target));
    if (k < 0) return;
    const now = performance.now();
    const close = Math.hypot(e.clientX - last.x, e.clientY - last.y) < 30;
    if (now - last.t < 320 && close && last.k === k) {
      toggleSave(k, true);
      last = { t: 0, x: 0, y: 0, k: -1 };
    } else {
      last = { t: now, x: e.clientX, y: e.clientY, k };
    }
  });
}

// Swipe left for comments, long press to share.
{
  let start = null;
  let pressTimer = null;
  let longPressed = false;
  feedEl.addEventListener(
    'touchstart',
    (e) => {
      const t = e.touches[0];
      start = { x: t.clientX, y: t.clientY, t: performance.now(), k: indexOf(cardOf(e.target)) };
      clearTimeout(pressTimer);
      longPressed = false;
      if (!e.target.closest('a, button')) {
        pressTimer = setTimeout(() => {
          longPressed = true;
          if (navigator.vibrate) navigator.vibrate(15);
        }, 550);
      }
    },
    { passive: true },
  );
  feedEl.addEventListener(
    'touchmove',
    (e) => {
      if (!start) return;
      const t = e.touches[0];
      if (Math.hypot(t.clientX - start.x, t.clientY - start.y) > 10) {
        clearTimeout(pressTimer);
        longPressed = false;
      }
    },
    { passive: true },
  );
  feedEl.addEventListener('touchend', (e) => {
    clearTimeout(pressTimer);
    if (!start) return;
    if (longPressed) {
      longPressed = false;
      share(start.k); // touchend counts as a user gesture, so the share sheet is allowed
      start = null;
      return;
    }
    const t = e.changedTouches[0];
    const dx = t.clientX - start.x;
    const dy = t.clientY - start.y;
    if (dx < -70 && Math.abs(dy) < 50 && performance.now() - start.t < 700) openComments(start.k);
    start = null;
  });
  feedEl.addEventListener('contextmenu', (e) => {
    if (!e.target.closest('a')) e.preventDefault();
  });
}

// Desktop: one wheel or trackpad flick moves exactly one card.
{
  let locked = false;
  let lockedAt = 0;
  let timer = null;
  feedEl.addEventListener(
    'wheel',
    (e) => {
      if (!finePointer.matches || e.ctrlKey) return;
      e.preventDefault();
      const now = performance.now();
      if (!locked && Math.abs(e.deltaY) > 12) {
        go(e.deltaY > 0 ? 1 : -1);
        locked = true;
        lockedAt = now;
      }
      clearTimeout(timer);
      timer = setTimeout(() => (locked = false), Math.max(220, 420 - (now - lockedAt)));
    },
    { passive: false },
  );
}

prevBtn.addEventListener('click', () => go(-1));
nextBtn.addEventListener('click', () => go(1));

document.addEventListener('keydown', (e) => {
  if (e.metaKey || e.ctrlKey || e.altKey || e.target.closest('input, textarea')) return;
  if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('button, a')) return;
  const k = state.index;
  switch (e.key) {
    case 'j':
    case 'ArrowDown':
    case 'PageDown':
    case ' ':
      e.preventDefault();
      go(1);
      break;
    case 'k':
    case 'ArrowUp':
    case 'PageUp':
      e.preventDefault();
      go(-1);
      break;
    case 'o':
    case 'Enter':
      openArticle(k);
      break;
    case 'c':
      if (state.sheetFor != null) closeSheet();
      else openComments(k);
      break;
    case 's':
      toggleSave(k, true);
      break;
    case 'Escape':
      closeSheet();
      break;
  }
});

// Leaving desktop width with the panel open: switch to bottom sheet behaviour.
desktop.addEventListener('change', () => {
  if (state.sheetFor != null) backdrop.hidden = desktop.matches;
});

window.addEventListener('offline', () => ui.toast('You are offline. Showing cached stories.'));

// ---------- start ----------

function start() {
  const fromHash = location.hash.slice(1);
  const feed = FEEDS.some((f) => f.key === fromHash) ? fromHash : ls.get('feed', 'top');
  state.feed = FEEDS.some((f) => f.key === feed) ? feed : 'top';
  renderTabs();
  loadFeed(state.feed);
  setTimeout(idbPrune, 5000);
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('sw.js').catch(() => {});
}

start();
