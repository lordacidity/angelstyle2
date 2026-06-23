# Commit `279ee87` — "canvas"

**Author:** angelmohamed · **Date:** 2026-06-15
**Stat:** 6 files changed, +494 / −174

Adds a widescreen ("PPT") aspect ratio to the Charts Image canvas, manual
override inputs (industry / % / raw change), an AI caption generator, and
makes the Google Trends endpoint more robust against rate-limiting.

---

## New features

### Widescreen / PPT aspect ratio
- New `CanvasAspectRatio = 'portrait' | 'ppt'` type.
- `ChartsImageCanvas` accepts an `aspectRatio` prop (defaults to `portrait`).
- New constants for the widescreen layout:
  - `PPT_W = 1600`, `PPT_H = 1080`
  - `PPT_DISPLAY_SCALE = 0.2565` (keeps on-screen width matching the
    portrait preview; taller-looking due to the wider ratio).
- Per-entry toggle button in `CanvasGrid` flips an entry between
  portrait (1080×1350) and widescreen (1600×1080), backed by
  `chartsImageAspectRatioMap`.

### Manual override inputs
`ChartsImageCanvas` / `CanvasGrid` gain editable overrides so a card's
displayed values can be set by hand instead of computed:
- `overrideIndustry` — free-text industry label.
- `overridePct` — signed % string (e.g. `"-5.2"`); empty = use calculated.
- `overrideRaw` — signed raw change string (e.g. `"-0.32"`); empty = use calculated.

State is held in `CanvasGrid` via
`chartsImageIndustryOverrideMap`, `chartsImagePctOverrideMap`,
`chartsImageRawOverrideMap`, wired through `onUpdateOverride*` callbacks.

### AI caption generator (new API route)
`frontend/src/app/api/ai/chartsimage-caption/route.ts` (new, 71 lines):
- `POST` accepts `{ name, pct, isPositive }` (validated with `zod`).
- Calls Gemini (`gemini-2.5-flash` by default) **with Google Search grounding**
  to find a news item about `name` from the last 24h.
- Returns a single Kalshi-style social caption: "<name>'s Sentiment is
  Up/Down by X% as <event>." No emojis/hashtags/quotes.
- Resilient: exponential-backoff retry (4 attempts) on 503/429/500;
  requires `GEMINI_API_KEY`.

`CanvasGrid` adds `generateChartsImageCaption(entryId)` which derives
direction and a seeded % from the sparkline, then calls the route and stores
the result in `socialCaptionMap` (with loading/error/copied state).

---

## Fixes / hardening

### Google Trends endpoint (`api/charts/trends/route.ts`)
- **In-flight de-duplication:** concurrent requests for the same term now
  share one `fetchPromise` via an `inflight` map instead of each hitting Google.
- **Better rate-limit detection:** treats an HTML response (`<…`) as
  `rate_limited` and returns 429 instead of throwing a JSON parse error.
- **Robust XSSI prefix handling:** strips the `)]}'` prefix only when present,
  rather than assuming it.
- **Cache headers:** responses now `max-age=86400` (24h) for trends data.
  > Note: the in-process `CACHE_TTL_MS` constant was set to `60 * 1000`
  > despite the "24 hours" comment — worth confirming that's intentional.

---

## Files changed
| File | Δ | What |
|------|---|------|
| `components/ChartsImageCanvas/index.tsx` | +367/−… | Render portrait + PPT layouts, apply overrides |
| `components/CanvasGrid.tsx` | +162 | Override inputs, aspect toggle, caption generation, state maps |
| `api/ai/chartsimage-caption/route.ts` | +71 (new) | Gemini-backed caption API |
| `api/charts/trends/route.ts` | +57/−… | In-flight dedup + rate-limit hardening |
| `components/ChartsImageCanvas/types.ts` | +6 | `CanvasAspectRatio`, new override/aspect props |
| `components/ChartsImageCanvas/constants.ts` | +5 | `PPT_W`, `PPT_H`, `PPT_DISPLAY_SCALE` |
