// The trending list, kept — so that once anybody has read the news, everybody
// after them gets it at once (lib/kept).
//
// A read (lib/news/trending) is twenty-odd feed fetches, up to eight Gemini
// calls side by side and a round of link resolving: fifteen to twenty
// seconds, and the same for every clipper who opens the tab. Nothing about it
// is personal, so one read serves everyone: each list — one per window (1h,
// 6h, 24h, 7d), one per widened category — is kept, and handed to the next
// reader with how old it is.
//
// How old is too old is the window's business, and it is kept short enough
// that new news is caught: a list is FRESH for a few minutes of its window,
// after which the next reader still gets it at once but sets a new read going
// behind the reply — and the form, told the list was stale, asks again a
// little later and puts the new one up (Vids2Form). Past the window itself —
// a "past hour" list from five hours ago says nothing about this hour — the
// reader waits for a new read instead. The form's ↻ asks for a fresh read
// outright.

import { kept, type KeptPolicy } from '@/lib/kept';
import { trendingNews } from './trending';
import type { TrendingResponse, TrendWindow } from './types';

const MIN = 60_000;
const HOUR = 60 * MIN;

/** Per window: how long a list is handed over without a refresh being
 *  started, and how long a stale one is still handed over (with a refresh
 *  behind it) before the reader waits for a new one — the window itself, a
 *  day at most. */
const POLICY: Record<TrendWindow, KeptPolicy> = {
  '1h': { freshMs: 5 * MIN, staleMaxMs: HOUR },
  '6h': { freshMs: 10 * MIN, staleMaxMs: 6 * HOUR },
  '24h': { freshMs: 15 * MIN, staleMaxMs: 24 * HOUR },
  '7d': { freshMs: HOUR, staleMaxMs: 24 * HOUR },
};
/** A widened read (a category typed, Search wider) looks back a week whatever
 *  the window, so it keeps longer. */
const TOPIC_POLICY: KeptPolicy = { freshMs: HOUR, staleMaxMs: 24 * HOUR };

/** One list per window, and one per widened category — a category is read
 *  for a week whatever window the form is on, so the window is not in its key. */
const keyOf = (window: TrendWindow, topic: string) => {
  const t = topic.trim().toLowerCase().replace(/\s+/g, ' ');
  return t ? `news|topic|${t}` : `news|window|${window}`;
};

/** What a reader gets: the list, and — when it was handed over stale — the
 *  refresh to run once the reply is on its way (the route puts it through
 *  after()). Null refresh means nothing is owed. */
export interface TrendingHandout {
  response: TrendingResponse;
  refresh: (() => Promise<void>) | null;
}

/** The trending list for a window (or a widened category): from the cache
 *  when there is one young enough, read afresh otherwise — and read afresh
 *  outright when `fresh` asks for it (the form's ↻). See the header. */
export async function getTrending(window: TrendWindow, topic = '', fresh = false): Promise<TrendingHandout> {
  const forTopic = !!topic.trim();
  const k = await kept(keyOf(window, topic), () => trendingNews(window, topic), forTopic ? TOPIC_POLICY : POLICY[window], fresh);
  return { response: { ...k.value, asOf: k.asOf, stale: k.stale }, refresh: k.refresh };
}
