# Pricer (Studio > Pricer)

The Pauv AI Pricer inside the Studio. Type a name and six steps price them against the master list:
a bio, then the social / news / industry analysts in parallel, then a judge. **How the pricing works**
is in [HOW_IT_WORKS.md](HOW_IT_WORKS.md); nothing about it changed coming in from the standalone.
This file is about where things live now.

## Layout

| File | What it is |
|---|---|
| `pipeline.js` | The standalone's `server.mjs` minus its HTTP server, env loading and password. Exports `runPipeline()` and the config the page shows. The mechanism is untouched; do not change it without re-measuring the judge's calibration block (see HOW_IT_WORKS.md). |
| `csv.js` | The CSV parser/writer the pipeline and the log download share. |
| `store.ts` | Railway Postgres (`DATABASE_PUBLIC_URL`, the same DB as Board and Vids): `pricer_peer_lines` and `pricer_priced`. Tables self-create; the first use in a process seeds them from `data/` if they are empty. |
| `data/pauv_master_list.csv` | The pricing reference. Read-only, re-read on every pricing, so an edit shows up on the next deploy without a migration. |
| `data/pauv_peer_lines.csv`, `data/pauv_priced.csv` | Seeds only: the standalone's standing lines and test history. Once the tables exist the DB is the source of truth and these are never read again. |
| `types.ts` | The event shapes the page renders. Client-safe. |

The page is `src/app/components/pricer/PricerSection.tsx` (kept mounted by StudioShell so a run survives a
tab switch). The routes are under `src/app/api/pricer/`.

## Routes

All behind the site gate (`middleware.ts`), like every `/api/*` route.

| Route | Returns |
|---|---|
| `GET /api/pricer/config` | Master-list size, the three models, credits rate, news window. |
| `GET /api/pricer/price?name=…&hint=…` | One pricing as a server-sent-event stream: `info` → `step` (running / done / error per step) → `done`, or `error`. Open for 30 s to 5 min. Closing it aborts the run's API calls. |
| `GET /api/pricer/log` | Every completed pricing as `pauv_priced.csv`. |

Each run spends about $0.14 in API calls. There is no queue, throttle or cache: every submit runs everything.

## Environment (root `.env`)

| Variable | Required | Notes |
|---|---|---|
| `GEMINI_API_KEY` | yes | Bio, news and industry steps, and the peer lines. |
| `ANTHROPIC_API_KEY` | yes | Social step (Haiku 4.5 with web search) and the judge (Sonnet 5). |
| `DATABASE_PUBLIC_URL` | yes | The store. |
| `PRICER_GEMINI_MODEL` | no | Default `gemini-3.8-flash`. Deliberately **not** the site's `GEMINI_MODEL`, which is the caption model; the pricer was calibrated on 3.8 Flash. |
| `JUDGE_EFFORT`, `JUDGE_CACHE_TTL`, `SOCIAL_MODEL`, `PAUV_CREDITS_PER_USD`, `NEWS_WINDOW_DAYS`, `ONLINE_CELEB_DISCOUNT` | no | As documented in HOW_IT_WORKS.md. |

## Changing the master list

Edit `data/pauv_master_list.csv` and deploy. Anyone new gets their standing line written on the first
pricing in their subindustry (a minute extra on that run, 20 people per grounded call). The standalone's
`--build-peers` bulk step has no equivalent here; lines are written on demand, as they always were during a
pricing.

## Hosting notes

- The price route sets `maxDuration = 300`. Vercel Hobby caps functions lower than that; Pro honours it. A
  proxy in front of Node must not buffer the response (the route already sends `x-accel-buffering: no`).
- `next.config.ts` lists `data/*.csv` in `outputFileTracingIncludes` so Vercel ships them with the routes.
- Google News's feed sometimes blocks cloud IPs. The news step then falls back to Gemini searching for itself
  and the page says so.
