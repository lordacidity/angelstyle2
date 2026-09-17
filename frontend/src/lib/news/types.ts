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
  /** Whether the headline has the searched name in it. */
  named: boolean;
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
