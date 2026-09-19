<!-- Carried verbatim from the standalone pricer. In the Studio the pipeline is ./pipeline.js, the master list is
     ./data/pauv_master_list.csv, and the peer lines and the pricing log live in Railway Postgres (./store) rather
     than CSVs beside the code; see ./README.md. The "Run", "Putting it on a server" and "Files" sections below
     describe the standalone only. -->

# Pauv AI Pricer

Prices a new person in six steps. Gemini writes the bio (2) and the industry comparison (5) and
prices the recent news (4) from a dated headline list pulled from Google News, Claude Haiku 4.5
with web search does the social step (3), and Claude Sonnet 5 is the judge (step 6). The only pricing reference is the master list (`pauv_master_list.csv`). Live pauv
credit prices are never used, and the models never see credits.

No answer is cached. Every pricing runs every step from scratch, and the result is appended to
`pauv_priced.csv`. If a name has been priced before, the page says so and shows the earlier price,
but nothing is reused. (The two Claude calls use prompt caching, which lowers the token bill
without changing what the models see or say; see "What it costs" below.)

## Run

```
npm install        # once, for the Anthropic SDK
node server.mjs
```

or double-click `start.cmd`, then open http://localhost:3000.

Needs Node 20.12+ and `GEMINI_API_KEY` and `ANTHROPIC_API_KEY`, either in `.env` next to
`server.mjs` or in the environment.

### Putting it on a server

- Set `APP_PASSWORD`. Every pricing spends real API money, so without it anyone with the URL can
  run the pricer. The page asks for the password once and remembers it in that browser.
- The server listens on all interfaces (`HOST`, default `0.0.0.0`) on `PORT` (default 3000), so a
  host's proxy can reach it. Put HTTPS in front of it.
- `pauv_peer_lines.csv` ships with the code and must be deployed alongside `server.mjs`.
- `pauv_priced.csv` is written next to `server.mjs`. On hosts whose disk resets on deploy
  (Render, Railway, Fly without a volume), download it from the page's **Download pricing log**
  link before redeploying, or give the app a persistent volume.

## The six steps

1. **Name** — type a name, plus a disambiguation hint if the name is ambiguous ("NBA guard, Boston Celtics").
2. **Bio** — one-page factual report (who they are, accomplishments, what they're known as). No stats, no recent news, no opinion. Google-grounded. Also classifies into the master list's industry/subindustry taxonomy and reports two search contexts (company and product, team and sport) for the news step.
3. **Social media price** — Claude Haiku 4.5 with web search looks up the person's accounts and reports a percentile band per account (fixed anchors, not raw counts) plus an engagement signal. It runs on Claude rather than Gemini because Gemini searched for accounts in about one run in five while Claude searched in every test, with more accounts found and engagement figures cited from trackers. **It does not choose the price.** The price is computed from what it found by a fixed table (below), so the same footprint always gives the same number.
4. **Recent news price** — ONLY news from the past 90 days, positive and negative. The stories come from Google News's search feed (dated headlines with outlets, see below); Gemini prices from that list and never searches for itself. **Little or no news is bad news:** a quiet window prices the person below the baseline their bio suggests (a silent month for a well-known person costs at least one tier band). Heavy coverage from the person's own field confirms that baseline; only coverage that reaches general-interest outlets lifts them above it. Confidence reflects how clear the coverage picture is, so "confirmed quiet" is a high-confidence finding, not a missing one.
5. **Industry price** — compares against the master list (minus the subject's own row, if they are already on it). Same-subindustry peers come with a **standing line** (one or two grounded sentences on who they are and where they stand, written under the same rules as the bio: no stats, nothing from the last 3 months); the rest of the industry is price-only. The analyst is told to compare only on the bio and those lines, never on its own memory of the peers. No web access at run time.
6. **Final price** — Claude Sonnet 5 weighs the three by confidence and picks one price, to the cent. The scale runs from $0.01 (the default for a nobody) to $70.

Steps 3–5 run in parallel. Each analyst returns a price, a confidence score (`high` / `medium` / `low` / `none`), a two-paragraph rationale, and its evidence.

### The search check

Gemini decides for itself whether to use its search tool, and it often answers from memory
instead; Claude reports an exact search count in its response. When a grounded step comes back
with no searches, the same request is sent once more with searching made mandatory. If it still
does not search:

- **Bio:** kept, but marked "did not search" on the page.
- **Social:** kept, with its confidence capped at `low`, because bands from memory are unverified.
  The judge's one-band rule then limits how far it can move the price.
- **News:** only relevant when the Google News feed is unavailable and the model has to search
  for itself. If it then still does not search, the step is discarded: a news picture written
  from memory is either invented or a false "quiet window", and the judge is told to give it no
  weight.

The page shows whether each step searched, and `pauv_priced.csv` records it per analyst.

### The tier ladder

Every analyst and the judge get this table verbatim. The bottom two bands are priced in cents;
$0.01 is the default for someone essentially nobody has heard of.

| Tier | Range | Who |
|---|---|---|
| MAJOR global icons | $55–70 | Musk, Trump, Ronaldo, Swift, Messi, LeBron |
| Household names worldwide | $42–52 | Bieber, Rihanna, Obama, DiCaprio, MrBeast, Jordan, Brady |
| A-list | $30–42 | Most top actors, chart artists, superstar athletes, major politicians |
| Mainstream recognizable | $20–30 | Stars within their field with real crossover |
| Known in their field | $10–20 | Starters, charting artists, mid-size creators |
| Niche or rising | $4–10 | Prospects, role players, small creators |
| Obscure but real | $2–4 | Fringe players and minor candidates: a real, if marginal, professional standing |
| Barely known | $0.10–2 | Socially active, or an additive member of a niche: early-stage founders, tiny creators, local figures |
| Unknown | $0.01–0.10 | Private individuals and anyone with no press, no audience and no standing beyond existing |

The master list has nobody below $3 ($2 after the draw-down), so the news and industry analysts and the judge are told
explicitly that two bands exist beneath the cheapest comparable and that $2 is not the floor.
The ladder is `TIERS` at the top of `server.mjs`.

### Master-list draw-down

The pricer reads the list's prices through a curve before showing them to the industry analyst:
$32 and above are unchanged; below that the price is multiplied by a factor that slides on a log
scale from 1.0 at $32 down to 0.6 at $5 and below, rounded to the nearest 50 cents. So $20 reads
as $18, $16 as $13.50, $10 as $7.50, $8 as $5.50, $5 as $3 and $3 as $2. The CSV itself is never
changed; when a name is already on the list the page shows both the listed and the read price.
The curve is `DRAWDOWN` at the top of `server.mjs` (set `min` to 1 to disable it). The judge's
calibration notes were measured before the draw-down, against the listed prices.

### The social price table

The best band an account falls in sets the base price. Each additional account in that band adds
12% (up to three counted), each account one band below adds 5% (up to three), and the engagement
of the best-band accounts moves it ±10% (strong / weak). Clamped to $0.01–70; no accounts at all
gives $0.01.

| Band | Followers | Base |
|---|---|---|
| top 0.0001% | 100M+ | $52 |
| top 0.001% | 10M–100M | $30 |
| top 0.01% | 1M–10M | $15 |
| top 0.1% | 100K–1M | $8 |
| top 1% | 10K–100K | $4 |
| top 10% | 1K–10K | $1.00 |
| below top 10% | <1K | $0.20 |

The table and the percentages are constants at the top of `server.mjs` (`SOCIAL_BANDS`,
`SOCIAL_EXTRA_SAME_BAND`, `SOCIAL_EXTRA_NEXT_BAND`, `SOCIAL_ENGAGEMENT`). The page shows the
arithmetic under the social price. Tune it against known names.

**Which platforms the analyst searches.** Instagram, TikTok, YouTube and X/Twitter, plus one more
when the biography says that is where the audience actually lives (Twitch or Kick for a streamer,
Weibo or Douyin for a Chinese-language audience). Any other account — Facebook, Threads, Snapchat
— is reported when it turns up in results the analyst already has, and still counts toward the
additional-account percentages above, but no search is ever spent on one. Until 2026-09-18 the
prompt listed nine platforms and the cap was 8 searches; the base price comes from the single best
band, and that account is on one of the four for all but a handful of people, so the wider sweep
was mostly buying the ±12% / 5% adjustments at $0.01 a search. Worth revisiting if a subject whose
largest audience is somewhere else (a Facebook-first public figure, say) starts coming in low.

### Online-celebrity discount

Streamers, gamers and internet-native famous people are priced **25% below** what the analysts
recommend. The judge decides who qualifies, as a judgement about what a person actually *is* from
the analysts' evidence — not from their row in the reference list, and not from follower count,
since nearly everyone priced here has a large following. The test is where the fame itself comes from.

- **Discounted:** Twitch/Kick/YouTube streamers, gaming personalities, YouTubers,
  stream-and-podcast-native personalities, people famous mainly for going viral or a meme.
- **Not discounted:** actors, musicians, athletes, coaches, politicians, business figures and
  traditional media personalities — *including* ones with huge online followings, and including
  lifestyle, beauty and fashion influencers whose fame rests on modelling, reality TV or a consumer
  brand. Genuine borderline cases are not discounted.

The judge reports the **undiscounted** price and a boolean; the 25% is applied in `validateJudge`
so the arithmetic is exact. Because a cut can move someone down a band, the tier is re-derived
from the final price. Set `ONLINE_CELEB_DISCOUNT` to change or disable it (`0` turns it off).

Only quoted prices are discounted — `pauv_master_list.csv` is untouched.

### Judge rules

- Weight by confidence; `none` (or a failed analyst) carries no weight.
- **One-band rule:** a `low` or `none` estimate can't move the final price more than one tier band from where the medium/high estimates place the subject. If only one estimate is medium/high, anchor on it.
- **Audience rule:** a searched social estimate with medium or high confidence and at least one account at 100K+ followers rules out the bottom two bands. When the other two lanes' case for a low price is absence (a quiet window) or extrapolation (a price below the cheapest listed peer, which the judge is told about), the social price is the starting point and the other two move it within its band; a below-the-list industry estimate counts as a ceiling at the cheapest peer's price, not a point to average with. When the other lanes bracket the subject against real evidence, the judge weighs normally and a big social audience confirms the level rather than lifting the subject within the band. Added after Roy Lee (431K Instagram, 166K X, viral posts) priced at $1.85 because an empty feed and a below-the-list comparison outvoted the only measured evidence.
- Outputs price, tier, overall confidence, per-analyst weights, which analysts were anchors, and whether the one-band rule constrained the result.
- **Calibration notes:** the judge is told how each lane compared with the master list when ten listed people were priced in September 2026 (industry within one band with the subject's own row hidden; news about one band high for people under $20 and 15–35% high above that; social low for traditional figures and 2–3x high for creators before the discount, but the only lane that sees online-native people the list and the press miss), so it anchors the level on a confident industry estimate and uses news for direction. Re-measure and update that block in `JUDGE_SYSTEM` after changing an analyst.

## What each AI is given (and nothing else)

| Step | Gets | Web search | Model |
|---|---|---|---|
| Bio | name, hint, industry taxonomy | yes | Gemini |
| Social | bio, percentile anchors, rubric | yes (up to 5 searches) | Claude Haiku 4.5 |
| News | bio, tiers, rubric, 90-day date window, the dated headline list from Google News (up to 100), the "silence is negative" rule | no (the feed is fetched by code) | Gemini |
| Industry | bio, tiers, rubric, same-subindustry peers with standing lines, rest of industry with prices | **no** | Gemini |
| Judge | name, tiers, tier bands, the 3 prices + confidences + rationales, the social accounts found | no | Claude Sonnet 5 |

Every Gemini call and the social call are a single user message with no system prompt and no
history. The judge gets its fixed instructions (the tier table, the bands, the calibration notes
and the rules) as a system prompt and the subject's three reports as the user message. Nothing
is carried between steps or between pricings. Every Gemini call runs at temperature 0, and so
does the Haiku social call; the judge runs adaptive thinking at effort `medium` (`JUDGE_EFFORT`).
The tier table is passed verbatim in dollars to the news, industry and judge steps.

### What it costs

About $0.14 per pricing. The judge and Gemini rows below were measured in September 2026 at that
month's rates; the social row is projected from the same measurement after the search cap dropped from
8 to 5 on 2026-09-18, and has not been re-measured.

| Call | Model | Per pricing | What drives it |
|---|---|---|---|
| Social | Claude Haiku 4.5 | ~$0.08 (projected) | Up to 5 web searches at $0.01 each, plus the results Claude reads. At the old cap of 8 this was $0.13 on about 68K input tokens: the loop re-reads the growing conversation before every search, so each result is billed again on every later search and the context grows faster than the search count. Cutting the cap takes back both the fees and, more than proportionally, those re-reads |
| Judge | Claude Sonnet 5 | $0.012–0.016 | 2,700 tokens of fixed instructions (cached), 1,700–2,000 tokens of analyst reports, 700–1,000 tokens of thinking and answer. About $0.023 for the first run in an hour, which writes the cache. It was Claude Opus 5 until 2026-09-18, at $0.03–0.04 a run: Sonnet 5's rates are exactly 40% of Opus 5's on every line — input, output, cache read and cache write |
| Bio, news, industry | Gemini 3.8 Flash | ~$0.04 together | Prompts of 1.5K–15K tokens; the industry prompt grows with the subindustry (Basketball's 133 peers make it the largest). Gemini's introductory rates double on 1 January 2027 |

Both Claude calls use prompt caching. The judge's fixed instructions are cached for an hour
(`JUDGE_CACHE_TTL`); a run inside that window reads them at a tenth of the input price. The
social call sends a cache marker, so the API caches the search results as they accumulate and the
loop's re-reads bill at a tenth of the rate: measured at $0.131 instead of $0.146 for a
seven-search run, at the old cap of 8. Haiku fires several searches in parallel, so there are only two or three
re-reads and the saving is modest. Caching changes only the bill: the prompt, the model, the
searches and the answer are the same. The server prints the token usage of every social and judge
call (the `social:` and `judge:` lines). The Gemini prompts are not cached: Gemini's implicit
cache needs a shared prefix of at least 4,096 tokens, which only the industry prompt for the
largest subindustries has, and reordering that prompt to qualify would save under a cent.

Industry and news (Gemini, no grounding) and the judge (Claude) run in schema-enforced JSON
mode. The bio uses Google grounding and the social step uses Claude's web search, neither of
which can be combined with JSON mode, so those return a JSON block that is validated; if
validation fails, a schema-enforced Gemini call restructures the text.

## Recent news

The news analyst does not search. Code fetches Google News's search feed for the person, limited
to the window, and hands the analyst the dated headline list:

- Every search is a name plus a context, so a common name does not drown in namesakes ("Roy Lee"
  alone returns mostly obituaries; "Roy Lee" + Cluely returns the right story). The names are the
  bio's canonical name, its aliases (a stage name or gamertag the bio step reports; short or generic
  ones like "T1" are dropped in code) and the name as typed. The contexts are the pieces of your
  hint (comma-separated), then the two search contexts the bio step reports (two different angles
  on the person, such as their company and their product, or their team and their sport), then the
  subindustry if there is nothing else. Every context is searched with the canonical name before
  any alias is tried, so the cap of 8 searches drops alias searches rather than angles. The
  searches run in parallel and are merged with duplicates removed, so a noisy pair cannot crowd
  the others out of the 100-item cap.
- Death notices from funeral homes and obituary sites are dropped in code; they are almost always
  a namesake. The page shows how many were dropped.
- The hint therefore does double duty: it disambiguates the bio and narrows the news search. Keep
  it to a few words, and comma-separate alternatives ("NBA guard, Boston Celtics").
- Each story arrives with its date, outlet and headline. Items outside the window are dropped;
  the analyst sees up to 60, newest first, and the total. The feed itself stops at 100, which the
  analyst is told means "at least this much".
- The analyst uses the bio to discard stories about someone else with the same name or passing
  mentions, then prices from what remains. The page shows the story count and the query, and
  lists the headlines under Sources.

The feed is unofficial and free, and Google sometimes blocks cloud-hosted IPs. If it fails or does
not return a feed, the step falls back to the previous behaviour (Gemini searches for itself, with
the search check), and the page says so.

## Peer standing lines

`pauv_peer_lines.csv`: one row per master-list person (name, industry, subindustry, identified,
line, model, written_at). Built 20 people per grounded Gemini call, 5 calls in parallel.

- A pricing run writes any missing lines for its own subindustry before comparing, so new
  master-list additions are covered automatically.
- To write them all up front: `node server.mjs --build-peers` (add `--force` to rewrite
  everything). This also tidies the file to master-list order and drops people no longer on the
  list. The server prints how many are written when it starts.

## Model fallback

Google serves `503 "high demand"` on popular models for minutes at a time. When the configured
model says so, it is retried after 3 s and again after 8 s. If it is still swamped it is parked
for five minutes and the call moves down the chain: `gemini-3.6-flash`, `gemini-3.5-flash`,
`gemini-3.1-flash-lite`, `gemini-2.5-flash`. A full 90-second timeout moves down the chain at
once. When a fallback answers, the step is flagged on the page and the model is recorded in the
pricing log. The chain, waits, timeout, attempts and cooldown are constants at the top of `server.mjs`.

The social step has its own safety net: if the Claude call fails outright (the SDK already
retries twice), the step runs on Gemini instead and the page shows which model answered. The news
step likewise falls back to Gemini searching for itself when the Google News feed is unavailable.

## Config (`.env` or environment, all optional except the two keys)

```
GEMINI_API_KEY=...                    # required
ANTHROPIC_API_KEY=...                 # required
APP_PASSWORD=                         # set before exposing the server
GEMINI_MODEL=gemini-3.8-flash         # research steps
JUDGE_EFFORT=medium                   # judge thinking depth: low | medium | high | xhigh | max
JUDGE_CACHE_TTL=1h                    # how long the judge's fixed prompt stays cached: 5m or 1h
SOCIAL_MODEL=claude-haiku-4-5         # social step, with web search
PAUV_CREDITS_PER_USD=                 # set to also show the final price in credits
NEWS_WINDOW_DAYS=90                   # how far back the news analyst looks
ONLINE_CELEB_DISCOUNT=0.25            # streamers/gamers/online celebrities; 0 disables
HOST=0.0.0.0
PORT=3000
```

The judge's model is not in that list. It is hard-coded in `pipeline.js` (`claude-sonnet-5`) so that moving
the final decision to another model is a code change reviewed with everything else, never an environment
variable edited in the deployment. `JUDGE_EFFORT` and `JUDGE_CACHE_TTL` stay configurable.

## Files

- `pauv_master_list.csv` — the pricing reference (yours; the server only reads it).
- `pauv_peer_lines.csv` — standing lines for master-list people (built by the server; deploy it with the code).
- `pauv_priced.csv` — one row per completed pricing: the bio, each analyst's price, confidence, whether it searched, its evidence and rationale, the judge's weights and verdict, and which models answered. Download it from the page header.
