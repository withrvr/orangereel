// Small pure helpers. No DOM at import time, so Node tests can import this file.

export function timeAgo(unixSeconds, now = Date.now()) {
  const s = Math.max(0, Math.floor(now / 1000 - unixSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  const d = Math.floor(h / 24);
  if (d < 365) return `${d}d`;
  return `${Math.floor(d / 365)}y`;
}

export function domainOf(url) {
  if (!url) return '';
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}

// Stable hue per domain so stories from the same site share a tint.
export function hueOf(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return Math.abs(h) % 360;
}

export function compact(n) {
  if (n == null) return '0';
  if (n < 1000) return String(n);
  return (n / 1000).toFixed(n < 10000 ? 1 : 0).replace(/\.0$/, '') + 'k';
}

export const hnItemUrl = (id) => `https://news.ycombinator.com/item?id=${id}`;

// HN text fields are HTML. Keep a tiny allowlist, drop everything else.
const ALLOWED = new Set(['P', 'A', 'I', 'B', 'EM', 'STRONG', 'CODE', 'PRE', 'BR']);

export function sanitize(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  const root = doc.body.firstChild;
  const walk = (node) => {
    for (const child of [...node.childNodes]) {
      if (child.nodeType === 1) {
        if (!ALLOWED.has(child.tagName)) {
          if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT'].includes(child.tagName)) {
            child.remove();
          } else {
            walk(child);
            child.replaceWith(...child.childNodes);
          }
          continue;
        }
        const href = child.tagName === 'A' ? child.getAttribute('href') : null;
        for (const attr of [...child.attributes]) child.removeAttribute(attr.name);
        if (child.tagName === 'A') {
          if (href && /^https?:\/\//i.test(href)) {
            child.setAttribute('href', href);
            child.setAttribute('target', '_blank');
            child.setAttribute('rel', 'noopener nofollow');
          }
        }
        walk(child);
      } else if (child.nodeType !== 3) {
        child.remove();
      }
    }
  };
  walk(root);
  return root.innerHTML;
}

// Plain text version, for one-line previews.
export function toText(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(html.replace(/<p>/g, ' '), 'text/html');
  return (doc.body.textContent || '').replace(/\s+/g, ' ').trim();
}
