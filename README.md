# ▲ Orangereel

**Doom scroll something useful.** Hacker News as a Reels / Shorts style feed: one story per screen, swipe up for the next, and the next 10 stories are always loaded before you reach them.

Plain HTML, CSS and JavaScript. No framework, no build step, no backend.

## Features

- Full-screen snap scroll, one story per screen (mobile first)
- Tablet: centered card. Laptop: YouTube Shorts layout with sidebar feeds and up / down buttons
- Feeds: Top, New, Best, Ask, Show, Jobs, Saved
- Prefetch engine: current story + next 10, max 5 requests at a time, current story jumps the queue
- Top comment preview on each card, full nested comments in a bottom sheet (side panel on laptop)
- Double tap to save, swipe left for comments, long press to share
- Resumes where you left off in each feed
- Installable PWA, works offline with cached stories
- A gentle nudge every 50 stories, because it is still doom scrolling

## Controls

| Phone | Laptop | Action |
| --- | --- | --- |
| Swipe up / down | Wheel, J / K, arrows | Next / previous story |
| Tap title | Click title, O | Open article |
| Swipe left, tap 💬 | C | Comments |
| Double tap | Double click, S | Save |
| Long press | Share button | Share |
| Tap active tab | Click active tab | Refresh feed |

## Run locally

```sh
python3 -m http.server 8080
# open http://localhost:8080
```

## Tests

```sh
node --test
```

Tests cover the prefetch engine (window size, concurrency cap, dedupe, queue jumping, dead stories, errors, reset) and the small util helpers. No dependencies.

## Deploy

GitHub Pages, straight from `main`: Settings → Pages → Source: "Deploy from a branch" → `main` / root. The site is then at `https://withrvr.github.io/orangereel/`.

After changing app files, bump `VERSION` in `sw.js` so installed copies pick up the update.

## How it works

```
index.html, style.css      one page, mobile-first CSS
js/api.js                  HN Firebase API (feeds, items) + Algolia (comment trees)
js/prefetch.js             window + queue + cache, pure JS, tested in Node
js/store.js                IndexedDB story cache (15 min TTL), localStorage settings
js/ui.js                   card, comments and toast rendering (HN HTML is sanitized)
js/app.js                  wiring: feed, scroll observer, gestures, keys
sw.js                      offline shell
```

Data comes from the official [Hacker News API](https://github.com/HackerNews/API) and the [Algolia HN Search API](https://hn.algolia.com/api). Not affiliated with Y Combinator.
