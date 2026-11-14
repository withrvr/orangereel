// DOM rendering for cards, the comments sheet and toasts.
// User data goes in with textContent; HN HTML fields go through sanitize().

import { timeAgo, domainOf, hueOf, compact, hnItemUrl, sanitize, toText } from './util.js';

const tpl = document.getElementById('cardTpl');

export function createCard(index) {
  const el = tpl.content.firstElementChild.cloneNode(true);
  el.dataset.index = String(index);
  el.dataset.state = 'idle';
  return el;
}

const q = (el, sel) => el.querySelector(sel);

function span(text, cls) {
  const s = document.createElement('span');
  s.textContent = text;
  if (cls) s.className = cls;
  return s;
}

export function renderStory(el, item, { index, saved, first }) {
  const url = item.url || hnItemUrl(item.id);
  const domain = domainOf(item.url);

  clearMessage(el);
  el.dataset.state = 'ready';
  el.dataset.id = String(item.id);
  q(el, '.card-inner').style.setProperty('--hue', String(hueOf(domain || item.by || 'hn')));

  q(el, '.rank').textContent = `#${index + 1}`;
  q(el, '.domain').textContent = domain;

  const a = q(el, '.title a');
  a.textContent = item.title || '(untitled)';
  a.href = url;

  const byline = q(el, '.byline');
  byline.replaceChildren();
  if (item.type !== 'job') {
    byline.append(span(`▲ ${compact(item.score)}`, 'pts'), span(`${compact(item.descendants || 0)} comments`));
  }
  if (item.by) byline.append(span(`by ${item.by}`));
  if (item.time) byline.append(span(timeAgo(item.time)));

  q(el, '.text').innerHTML = sanitize(item.text);
  q(el, '.preview').replaceChildren();
  q(el, '.c-count').textContent = compact(item.descendants || 0);
  setSaved(el, saved);

  if (first) el.dataset.first = '';
  else delete el.dataset.first;
}

export function renderPreview(el, comment) {
  const box = q(el, '.preview');
  if (!comment || !comment.text) {
    box.replaceChildren();
    return;
  }
  const who = document.createElement('b');
  who.textContent = `${comment.by || 'anon'}: `;
  const text = toText(comment.text);
  box.replaceChildren(who, document.createTextNode(text.length > 280 ? text.slice(0, 280) + '…' : text));
}

export function renderLoading(el, index) {
  clearMessage(el);
  el.dataset.state = 'loading';
  delete el.dataset.id;
  q(el, '.rank').textContent = `#${index + 1}`;
  q(el, '.domain').textContent = '';
  q(el, '.title a').textContent = 'Loading';
  q(el, '.title a').removeAttribute('href');
  q(el, '.byline').textContent = 'loading';
  q(el, '.text').innerHTML = '';
  q(el, '.preview').replaceChildren();
}

export function renderIdle(el) {
  if (el.dataset.state === 'idle') return;
  clearMessage(el);
  el.dataset.state = 'idle';
  delete el.dataset.id;
  q(el, '.title a').textContent = '';
  q(el, '.byline').replaceChildren();
  q(el, '.text').innerHTML = '';
  q(el, '.preview').replaceChildren();
}

export function renderMessage(el, message, buttonLabel, onClick) {
  el.dataset.state = 'msg';
  delete el.dataset.id;
  const body = q(el, '.card-body');
  q(el, '.title a').textContent = '';
  q(el, '.byline').replaceChildren();
  q(el, '.text').innerHTML = '';
  q(el, '.preview').replaceChildren();
  const msg = document.createElement('div');
  msg.className = 'state-msg';
  msg.textContent = message;
  clearMessage(el);
  body.append(msg);
  if (buttonLabel) {
    const b = document.createElement('button');
    b.className = 'btn';
    b.textContent = buttonLabel;
    b.addEventListener('click', onClick);
    body.append(b);
  }
}

export function clearMessage(el) {
  el.querySelectorAll('.state-msg, .btn').forEach((n) => n.remove());
}

export function setSaved(el, on) {
  const btn = q(el, '[data-act="save"]');
  if (!btn) return;
  if (on) btn.dataset.on = '';
  else delete btn.dataset.on;
  btn.querySelector('span').textContent = on ? 'Saved' : 'Save';
}

export function burst(el) {
  const b = q(el, '.burst');
  b.classList.remove('go');
  void b.offsetWidth; // restart the animation
  b.classList.add('go');
}

export function createEndCard(onRefresh) {
  const el = tpl.content.firstElementChild.cloneNode(true);
  el.classList.add('end-card');
  el.dataset.state = 'end';
  q(el, '.rail').remove();
  q(el, '.rank').textContent = 'the end';
  q(el, '.title a').textContent = 'You finished Hacker News. Go outside.';
  q(el, '.byline').textContent = 'or pull a fresh list';
  const b = document.createElement('button');
  b.className = 'btn';
  b.textContent = 'Refresh feed';
  b.addEventListener('click', onRefresh);
  q(el, '.card-body').append(b);
  return el;
}

// ---------- comments ----------

function commentNode(c, depth) {
  const kids = (c.children || []).map((k) => commentNode(k, depth + 1)).filter(Boolean);
  if (!c.text && !kids.length) return null;

  const d = document.createElement('details');
  d.className = 'cmt';
  d.open = depth < 4;

  const s = document.createElement('summary');
  const who = document.createElement('b');
  who.textContent = c.author || '[deleted]';
  s.append(who, document.createTextNode(c.created_at_i ? ` · ${timeAgo(c.created_at_i)}` : ''));
  d.append(s);

  const body = document.createElement('div');
  body.className = 'cmt-text';
  body.innerHTML = c.text ? sanitize(c.text) : '<i>[deleted]</i>';
  d.append(body);

  if (kids.length) {
    const wrap = document.createElement('div');
    wrap.className = 'cmt-kids';
    wrap.append(...kids);
    d.append(wrap);
  }
  return d;
}

// kidsOrder: Firebase `kids` array, which is in HN's ranked order. Algolia's is not.
export function renderThread(container, thread, kidsOrder = []) {
  const rank = new Map(kidsOrder.map((id, i) => [id, i]));
  const top = [...(thread.children || [])].sort(
    (a, b) => (rank.get(a.id) ?? 1e9) - (rank.get(b.id) ?? 1e9),
  );
  const nodes = top.map((c) => commentNode(c, 0)).filter(Boolean);
  if (!nodes.length) {
    const p = document.createElement('div');
    p.className = 'state-msg';
    p.textContent = 'No comments yet.';
    container.replaceChildren(p);
    return;
  }
  container.replaceChildren(...nodes);
}

export function renderSheetMessage(container, text) {
  const p = document.createElement('div');
  p.className = 'state-msg';
  p.textContent = text;
  container.replaceChildren(p);
}

// ---------- toast ----------

let toastTimer;
export function toast(text, ms = 2600) {
  const t = document.getElementById('toast');
  t.textContent = text;
  t.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (t.hidden = true), ms);
}
