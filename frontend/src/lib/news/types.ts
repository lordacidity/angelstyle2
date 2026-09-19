// Shapes shared by the News section's server routes and the page templates.
//
// The rule the whole section is built around: nothing on a rendered page is
// made up. Every headline, byline, date and paragraph in a NewsArticle was read
// from the outlet itself (its page, or its own public feed for that article),
// and anything the outlet didn't give us is left null/empty, never guessed.

export type OutletId = 'espn' | 'cnn' | 'fox' | 'nyt' | 'tmz' | 'bbc' | 'people' | 'imdb';

/** One search result: a real story Google News lists for an approved outlet. */
export interface NewsHit {
  outlet: OutletId;
  title: string;
  /** ISO timestamp from the feed, or null when it had none. */
  publishedAt: string | null;
  /** Google News' wrapped link. */
  link: string;
  /** The outlet's own URL for the story, already checked to be an article page. */
  url: string;
  /** Whether the headline has the searched name in it — whole, or one of the
   *  short forms the press uses for them (lib/news/name-forms). */
  named: boolean;
  /** Which of those it is — "Vladimir Putin", or "Putin". Only when named. */
  namedAs?: string;
}

/** Somebody on Pauv a headline or a story names (lib/news/roster-match). */
export interface NamedPerson {
  name: string;
  ticker: string;
  /** "Sports", "Music", "Politics"… as Pauv files them. */
  industry: string;
  /** The finer grain under it — "Basketball", "Rap", "Cycling" — or null where
   *  Pauv files them under the industry alone. What a typed category matches
   *  against first (lib/news/categories). */
  subcategory: string | null;
}

/** Who a story read off an outlet names, for a link nobody searched for:
 *  the ones in the headline first, then by how often the story says them. */
export interface StoryPerson extends NamedPerson {
  inHeadline: boolean;
  mentions: number;
}

/** How far back the trending list looks. */
export type TrendWindow = '1h' | '6h' | '24h' | '7d';

/** One row of the trending list: a fresh story from an approved outlet whose
 *  headline names somebody on Pauv (lib/news/trending). */
export interface TrendingHit extends NewsHit {
  /** Everyone on Pauv the headline names, in the order it names them. Never
   *  empty. `named` is always true and `namedAs` is the first of them. */
  people: NamedPerson[];
  /** A politics story: a politician in the headline, the outlet's politics
   *  desk in the link, or the AI's reading of the headline. */
  politics: boolean;
  /** How hard the headline would stop somebody scrolling, 0–100, as the AI
   *  read it — how big, shocking or talked-about, not how important. Null
   *  when the AI didn't read this one. */
  heat: number | null;
  /** The hook in a few words ("traded to the lakers"), with the heat. */
  why: string | null;
  /** How many of the window's headlines name the most-named of `people`. */
  buzz: number;
}

/** How the trending list is ordered: by heat, or by the clock. */
export type TrendSort = 'hot' | 'new';

export interface TrendingResponse {
  /** Newest first; the form sorts. The hottest, the hottest politics and the
   *  newest — more than are shown, so either order, with politics hidden or
   *  not, fills the list. */
  hits: TrendingHit[];
  /** How many fresh headlines were read to find them, and how many of those
   *  named somebody. */
  scanned: number;
  matched: number;
  /** Whether the AI read every one (false: name matches as they fell,
   *  politics by the person and the link alone, some or all with no heat). */
  ai: boolean;
  /** The category this list was read for, when it was read for one — the
   *  headlines were asked of Google with it, rather than filtered after. Null
   *  for the ordinary list, which is everything the outlets put out. */
  topic: string | null;
}

/** One category the form can be asked for: an industry Pauv files people
 *  under, or one of the finer grains beneath it, with how many are in it.
 *  What the box suggests as you type (lib/news/categories). */
export interface NewsCategory {
  label: string;
  kind: 'industry' | 'subcategory';
  /** The industry this sits under, for a subcategory; its own name for an
   *  industry. Shown beside the suggestion so "Rap" reads as Music's. */
  under: string;
  count: number;
}

/** The verified article a page is rendered from. */
export interface NewsArticle {
  outlet: OutletId;
  /** The outlet's own URL for the story (tracking parameters removed). */
  url: string;
  /** The headline exactly as the outlet prints it on the page. */
  headline: string;
  /** TMZ splits its display headline into three lines; null everywhere else. */
  headlineParts: { kicker: string | null; main: string; sub: string | null } | null;
  /** IMDb doesn't write its news: every item is an excerpt of someone else's
   *  story, and the page credits them. The publisher IMDb credits; null for
   *  every outlet that writes its own. */
  sourceName: string | null;
  /** The summary line under the headline, when the outlet shows one. */
  dek: string | null;
  /** Author names as the outlet credits them. */
  authors: string[];
  /** The byline as the outlet writes it when it gives one as text (ESPN, NYT),
   *  else the author names joined. */
  byline: string;
  /** Full publish timestamp, when the outlet gives one. */
  publishedAt: string | null;
  /** YYYY-MM-DD, when the outlet only gives the day (NYT's feed). */
  publishedDate: string | null;
  updatedAt: string | null;
  /** The desk or league the story sits under (e.g. "NFL", "Politics"). */
  section: string | null;
  /** The article text, paragraph by paragraph, word for word (up to 60). */
  paragraphs: string[];
  /** People puts a NEED TO KNOW box above the story on some articles; these
   *  are its bullets, as People writes them. Empty everywhere else. */
  keyPoints: string[];
  live: boolean;
  /** Anything the reader should know about what could and couldn't be read. */
  notes: string[];
}

/** A photo a page may use: a free one from Wikimedia Commons (with what its
 *  licence asks us to credit), or a profile photo from pauv.com. */
export interface NewsPhoto {
  source: 'commons' | 'pauv';
  /** Up to 1600px wide. */
  url: string;
  /** Size of the original file. */
  width: number;
  height: number;
  title: string;
  creator: string;
  /** "CC BY-SA 4.0", "CC0", "Public domain". */
  license: string;
  licenseUrl: string;
  /** The file's Commons page, where the licence can be checked. */
  page: string;
}

/** A photo of the person searched, with where their face is (fractions of the
 *  image, 0–1) when the AI found it. */
export interface PersonPhoto extends NewsPhoto {
  face: { x: number; y: number; w: number; h: number } | null;
}

export interface PersonPhotosResponse {
  /** Best first. Empty when no usable free photo was found. */
  photos: PersonPhoto[];
  /** Whether the AI picked and located the faces (false: plain search order, centred crops). */
  ai: boolean;
  note: string | null;
}

export interface ThumbPhotosResponse {
  /** One per headline asked about, in order; null where nothing suitable turned up. */
  photos: (NewsPhoto | null)[];
  ai: boolean;
}

/** A real recent headline from the same outlet, for the page's side column. */
export interface RailItem {
  title: string;
  publishedAt: string | null;
  /** Who wrote it, when the outlet's list credits one (IMDb does). */
  byline?: string | null;
  /** The list it came from, when the outlet's page shows its lists under
   *  their own headings (IMDb: "Top news", "Celebrity news"). */
  group?: string | null;
}
