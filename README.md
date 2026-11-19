# IB Flashcards

Personal, offline-first PWA for practicing investment banking interview questions
(accounting, valuation, DCF, M&A, LBO and fit) with spaced repetition.

**This repository contains code only.** The flashcards themselves live in a private
Supabase database protected by Row Level Security and are readable only by the owner's
account. No card content or source material is stored here.

## Stack

- Plain HTML, CSS and JavaScript (ES modules), no build step; hosted on GitHub Pages.
- PWA: `manifest.webmanifest` + `sw.js` cache the app shell; `supabase-js` is vendored
  in `vendor/` so the app opens with no connection.
- Local storage: IndexedDB (cards, progress, pending reviews).
- Auth: Supabase e-mail OTP (6-digit code).
- Sync: on login, on reconnect and after reviews; card/progress/review deltas use
  server timestamps; progress conflicts resolve to the most recent `updated_at`.

## Run locally

Serve the folder with any static server and open it on `http://localhost`:

```sh
npx http-server -p 8080 -c-1
```

## Layout

| Path | Purpose |
|---|---|
| `index.html`, `css/app.css` | App shell and styles (mobile-first, dark theme by default) |
| `js/app.js` | UI, study modes, keyboard and swipe |
| `js/srs.js` | Simplified SM-2 scheduler |
| `js/sync.js`, `js/db.js` | Offline storage and Supabase sync |
| `js/auth.js`, `js/supa.js`, `js/config.js` | Login and client config (publishable key only) |
| `tools/make_icons.R` | Generates the PWA icons |
