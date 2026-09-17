// Free photos for News pages, from Wikimedia Commons (no key; every file
// carries its licence and author). Server only.
//
//   personPhotos(name)       photos of the person searched, for the article's
//                            main photo. Gemini looks at the candidates, drops
//                            anything that isn't a clean photograph of one
//                            person, and says where the face is so the page can
//                            centre it. Shots from a little way back win over
//                            tight headshots.
//   thumbPhotos(outlet, hl)  the side column's thumbnails: about half are
//                            people from Pauv's roster (see the section below
//                            for who may go where), the rest stock scenes
//                            matched to each headline's topic (stadiums, the
//                            Capitol, a concert stage…). Gemini drops any scene
//                            with a recognisable person in it.
//
// Only CC0, public domain, CC BY and CC BY-SA files are used; the page prints
// the main photo's credit and the Studio lists every credit. Without a Gemini
// key (or when it fails) both still work, in search order with centred crops.

import { extractGeminiJson, geminiGenerate, type GeminiPart } from '@/lib/gemini';
import { pauvPeople, type PauvPerson } from './pauv-people';
import type { NewsPhoto, OutletId, PersonPhoto, PersonPhotosResponse, ThumbPhotosResponse } from './types';

// Wikimedia asks every API client to say who it is.
const UA = 'PauvStudio/1.0 (https://pauv.com)';
const FULL_WIDTH = 1600;   // what the page is cut from
const LOOK_WIDTH = 640;    // what Gemini looks at, and the thumbnails
const PERSON_CANDIDATES = 10;
const CACHE_MS = 60 * 60_000;

interface CommonsFile extends NewsPhoto {
  pageid: number;
  look: string;
  mime: string;
  description: string;
  year: number | null;
}

interface WmPage {
  pageid: number;
  title: string;
  index: number;
  imageinfo?: {
    url: string; descriptionurl: string; thumburl?: string; width: number; height: number; mime: string;
    extmetadata?: Record<string, { value: string }>;
  }[];
}

/** Commons' metadata fields are HTML; the first non-empty line, as text. */
function plain(html: string | undefined, max = 200): string {
  return (html ?? '')
    .replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;/g, "'").replace(/&nbsp;/g, ' ')
    .split('\n').map(s => s.trim()).find(Boolean)?.slice(0, max) ?? '';
}

/** The licences the pages can use: free for any use, credit at most. */
function usableLicense(name: string): boolean {
  // Ported licences carry a country code ("CC BY-SA 3.0 de").
  return /^(cc0\b|public domain\b|pd\b|cc by(-sa)?( \d(\.\d)?)?( [a-z]{2,3})?$)/i.test(name.trim());
}

async function searchCommons(search: string, limit: number, widths: { full: number; look: number }): Promise<CommonsFile[]> {
  const ask = async (width: number) => {
    const url = new URL('https://commons.wikimedia.org/w/api.php');
    url.search = new URLSearchParams({
      action: 'query', format: 'json',
      generator: 'search', gsrnamespace: '6', gsrlimit: String(limit), gsrsearch: `${search} filetype:bitmap`,
      prop: 'imageinfo', iiprop: 'url|size|mime|extmetadata', iiurlwidth: String(width),
      iiextmetadatafilter: 'LicenseShortName|LicenseUrl|Artist|ImageDescription|DateTimeOriginal',
    }).toString();
    const res = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' }, signal: AbortSignal.timeout(12_000), cache: 'no-store' });
    if (!res.ok) throw new Error(`Wikimedia Commons answered ${res.status}`);
    return ((await res.json()) as { query?: { pages?: Record<string, WmPage> } }).query?.pages ?? {};
  };
  // Commons renders a thumbnail at whatever width the API is asked for, but a
  // hand-edited width in a thumbnail URL answers 400, so ask once per width.
  const [full, look] = widths.full === widths.look
    ? await ask(widths.full).then(p => [p, p])
    : await Promise.all([ask(widths.full), ask(widths.look)]);
  return Object.values(full)
    .sort((a, b) => a.index - b.index)
    .flatMap(p => {
      const ii = p.imageinfo?.[0];
      const small = look[p.pageid]?.imageinfo?.[0];
      if (!ii || !/^image\/(jpeg|png|webp)$/.test(ii.mime)) return [];
      const md = ii.extmetadata ?? {};
      const license = plain(md.LicenseShortName?.value, 40);
      if (!usableLicense(license)) return [];
      const year = plain(md.DateTimeOriginal?.value).match(/\b(19|20)\d{2}\b/)?.[0];
      return [{
        source: 'commons' as const,
        pageid: p.pageid,
        url: ii.width > widths.full && ii.thumburl ? ii.thumburl : ii.url,
        look: ii.width > widths.look && small?.thumburl ? small.thumburl : ii.url,
        width: ii.width,
        height: ii.height,
        mime: ii.mime,
        title: p.title.replace(/^File:/, '').replace(/\.[a-z0-9]+$/i, ''),
        description: plain(md.ImageDescription?.value, 400),
        creator: plain(md.Artist?.value, 80),
        license,
        licenseUrl: md.LicenseUrl?.value ?? '',
        page: ii.descriptionurl,
        year: year ? Number(year) : null,
      }];
    });
}

function fold(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/** Every word of the name appears as a word ("Swift, Taylor (2007)" counts). */
function mentionsName(text: string, name: string): boolean {
  const hay = ` ${fold(text).replace(/[^a-z0-9]+/g, ' ')} `;
  return fold(name).split(/[^a-z0-9]+/).filter(Boolean).every(w => hay.includes(` ${w} `));
}

// Files named like these are rarely a usable photo of the person.
const NOT_A_PORTRAIT = /\b(logo|signature|autograph|album|cover|poster|ticket|wax|tussauds|statue|sculpture|mural|graffiti|drawing|illustration|caricature|cartoon|collection|merch|screenshot|screen shot|map|chart|flag|walk of fame|star on)\b/i;

// ── Gemini ─────────────────────────────────────────────────────────────────

async function lookAt(files: { look: string }[]): Promise<({ mime: string; data: string } | null)[]> {
  return Promise.all(files.map(async f => {
    try {
      const res = await fetch(f.look, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(10_000), cache: 'no-store' });
      const mime = (res.headers.get('content-type') ?? '').split(';')[0];
      if (!res.ok || !/^image\/(jpeg|png|webp)$/.test(mime)) return null;
      return { mime, data: Buffer.from(await res.arrayBuffer()).toString('base64') };
    } catch {
      return null;
    }
  }));
}

/** Ask Gemini about a set of images; `answers[i]` is its report on files[i], or
 *  null when it said nothing about that one. Throws when Gemini can't be used. */
async function askGemini<T>(prompt: string, files: { title: string; look: string }[]): Promise<(T | null)[]> {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  const images = await lookAt(files);
  const shown: number[] = [];
  const parts: GeminiPart[] = [{ text: prompt }];
  images.forEach((img, i) => {
    if (!img) return;
    shown.push(i);
    parts.push({ text: `Image ${shown.length} (Commons file "${files[i].title}")` });
    parts.push({ inline_data: { mime_type: img.mime, data: img.data } });
  });
  if (shown.length === 0) throw new Error("couldn't download any of the photos to check");
  const raw = await geminiGenerate(parts, { temperature: 0, maxOutputTokens: 2000, timeoutMs: 45_000, thinkingLevel: 'minimal' });
  const parsed = JSON.parse(extractGeminiJson(raw)) as { images?: (T & { image?: unknown })[] };
  const out: (T | null)[] = files.map(() => null);
  for (const r of parsed.images ?? []) {
    const n = Number(r?.image);
    if (Number.isInteger(n) && n >= 1 && n <= shown.length) out[shown[n - 1]] = r;
  }
  return out;
}

const messageOf = (err: unknown) => (err instanceof Error ? err.message : String(err));

// ── Photos of the person ───────────────────────────────────────────────────

interface PersonReport {
  kind?: unknown;
  people?: unknown;
  face?: unknown;
  problems?: unknown;
}

function personPrompt(name: string): string {
  return `You are choosing a photo of ${name} to go at the top of a news article about them.
Each image below is a file from Wikimedia Commons whose title or description says it shows ${name}. Don't try to recognise anyone from their face: the file title is how you know who is pictured, and when one person clearly dominates the frame, treat them as ${name}.

For every image report:
- "kind": "photo" for a real photograph of a person; otherwise one of "drawing", "logo", "text", "wax_figure", "statue", "screenshot", "collage", "object", "other".
- "people": how many people are clearly visible (in focus and in the foreground; ignore a distant crowd).
- "face": the main subject's face as [ymin, xmin, ymax, xmax], each from 0 to 1000 relative to the image; null when their face isn't visible (turned away, hidden, cut off by the edge).
- "problems": any of "blurry", "dark", "watermark", "text_overlay", "border", "face_covered", "eyes_closed", "odd_angle"; an empty list if none.

Answer with JSON only, in exactly this shape, one entry per image:
{"images":[{"image":1,"kind":"photo","people":1,"face":[120,430,260,540],"problems":[]}]}`;
}

/** Face box from Gemini's [ymin, xmin, ymax, xmax] on a 0–1000 scale. */
function faceBox(v: unknown): PersonPhoto['face'] {
  if (!Array.isArray(v) || v.length !== 4 || !v.every(n => typeof n === 'number' && n >= 0 && n <= 1000)) return null;
  const [ymin, xmin, ymax, xmax] = v as number[];
  if (ymax - ymin < 5 || xmax - xmin < 5) return null;
  return { x: xmin / 1000, y: ymin / 1000, w: (xmax - xmin) / 1000, h: (ymax - ymin) / 1000 };
}

function personScore(f: CommonsFile, rank: number, face: NonNullable<PersonPhoto['face']>, people: number, problems: string[]): number {
  let s = 0;
  // A little way back: the face a tenth to a fifth of the frame's height.
  const fh = face.h;
  if (fh < 0.04) s -= 40;
  else if (fh < 0.08) s -= 8;
  else if (fh <= 0.22) s += 20;
  else if (fh <= 0.35) s -= 5;
  else s -= 30;
  s -= (Math.min(people, 4) - 1) * 12;
  for (const p of problems) s -= p === 'blurry' || p === 'dark' ? 15 : 8;
  // Every page's photo box is landscape; wide photos crop without blurred sides.
  const ratio = f.width / f.height;
  if (ratio >= 1.3) s += 10;
  else if (ratio < 0.9) s -= 5;
  if (f.width < 900) s -= 12;
  if (f.year) s += Math.max(-10, Math.min(10, (f.year - (new Date().getFullYear() - 8)) * 1.5));
  return s - rank * 0.5;
}

/** The order to use when Gemini isn't available: landscape, larger, newer. */
function plainScore(f: CommonsFile, rank: number): number {
  let s = f.width / f.height >= 1.2 ? 10 : 0;
  if (f.mime !== 'image/jpeg') s -= 5;
  if (f.width < 900) s -= 10;
  if (f.year) s += Math.max(-10, Math.min(10, (f.year - (new Date().getFullYear() - 8)) * 1.5));
  return s - rank * 0.5;
}

function toPhoto(f: CommonsFile, face: PersonPhoto['face']): PersonPhoto {
  return { source: 'commons', url: f.url, width: f.width, height: f.height, title: f.title, creator: f.creator, license: f.license, licenseUrl: f.licenseUrl, page: f.page, face };
}

const personCache = new Map<string, { at: number; value: Promise<PersonPhotosResponse> }>();

export function personPhotos(name: string): Promise<PersonPhotosResponse> {
  const key = fold(name.trim());
  const hit = personCache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value;
  const value = findPersonPhotos(name.trim());
  personCache.set(key, { at: Date.now(), value });
  value.then(r => { if (r.photos.length === 0 || !r.ai) personCache.delete(key); }, () => personCache.delete(key));
  return value;
}

async function findPersonPhotos(name: string): Promise<PersonPhotosResponse> {
  const found = await searchCommons(name, 40, { full: FULL_WIDTH, look: LOOK_WIDTH });
  // Many files come in sets from one shoot; keep a few from each so the choice varies.
  const perShoot = new Map<string, number>();
  const candidates = found.filter(f => {
    if (Math.min(f.width, f.height) < 400) return false;
    if (!mentionsName(`${f.title} ${f.description}`, name) || NOT_A_PORTRAIT.test(f.title)) return false;
    const shoot = `${f.creator}|${f.year ?? ''}`;
    const n = perShoot.get(shoot) ?? 0;
    perShoot.set(shoot, n + 1);
    return n < 3;
  }).slice(0, PERSON_CANDIDATES);
  if (candidates.length === 0) {
    return { photos: [], ai: false, note: `No free photo of ${name} on Wikimedia Commons, so the page keeps a placeholder.` };
  }

  let reports: (PersonReport | null)[];
  try {
    reports = await askGemini<PersonReport>(personPrompt(name), candidates);
  } catch (err) {
    const photos = candidates
      .map((f, i) => ({ f, s: plainScore(f, i) }))
      .sort((a, b) => b.s - a.s)
      .slice(0, 6)
      .map(({ f }) => toPhoto(f, null));
    return { photos, ai: false, note: `The AI couldn't check the photos (${messageOf(err)}), so they're in search order and centred, not framed on the face.` };
  }

  const ranked = candidates.flatMap((f, i) => {
    const r = reports[i];
    if (!r || r.kind !== 'photo') return [];
    const face = faceBox(r.face);
    if (!face) return [];
    const problems = Array.isArray(r.problems) ? r.problems.filter((p): p is string => typeof p === 'string') : [];
    if (problems.some(p => p === 'watermark' || p === 'text_overlay' || p === 'face_covered')) return [];
    const people = typeof r.people === 'number' && r.people >= 1 ? Math.round(r.people) : 1;
    return [{ photo: toPhoto(f, face), score: personScore(f, i, face, people, problems) }];
  }).sort((a, b) => b.score - a.score);

  if (ranked.length === 0) {
    return { photos: [], ai: true, note: `None of the free photos of ${name} were a clear photo of them, so the page keeps a placeholder.` };
  }
  return { photos: ranked.slice(0, 6).map(r => r.photo), ai: true, note: null };
}

// ── Side-column thumbnails ─────────────────────────────────────────────────
//
// About half show a person from Pauv's roster (pauv.com's own profile photos),
// the rest a stock scene. A headline that names someone on Pauv gets that
// person. Otherwise a person may be picked at random from the headline's field
// (an NBA headline gets a basketball player), but only when the headline has a
// clear sports or entertainment topic, doesn't seem to name someone else, and
// isn't about politics, crime, death, injury, lawsuits or a feud: a random real
// face there would read as them being part of the story.

type PeopleFor = { industry: string; subcategory?: string } | false;

// First match wins. `search` is the scene; `people` is who may stand in for it
// (false: scenes only).
const TOPICS: { test: RegExp; search: string; people: PeopleFor }[] = [
  { test: /\b(nfl|quarterback|touchdown|super bowl|chiefs|patriots|cowboys|eagles|packers|49ers|steelers|ravens|bills)\b/i, search: 'American football stadium', people: { industry: 'Sports', subcategory: 'American Football' } },
  { test: /\b(nba|wnba|basketball|lakers|celtics|knicks|warriors)\b/i, search: 'basketball arena', people: { industry: 'Sports', subcategory: 'Basketball' } },
  { test: /\b(mlb|baseball|yankees|dodgers|mets|home run|pitcher|world series)\b/i, search: 'baseball stadium', people: { industry: 'Sports', subcategory: 'Baseball' } },
  { test: /\b(nhl|hockey|stanley cup)\b/i, search: 'ice hockey arena', people: { industry: 'Sports' } },
  { test: /\b(soccer|mls|premier league|champions league|fifa|world cup)\b/i, search: 'football stadium', people: { industry: 'Sports', subcategory: 'Football (Soccer)' } },
  { test: /\b(golf|pga|liv)\b/i, search: 'golf course', people: { industry: 'Sports', subcategory: 'Golf' } },
  { test: /\b(tennis|wimbledon)\b/i, search: 'tennis court', people: { industry: 'Sports', subcategory: 'Tennis' } },
  { test: /\b(f1|formula 1|nascar|grand prix|indycar)\b/i, search: 'race track', people: { industry: 'Sports', subcategory: 'Racing' } },
  { test: /\b(boxing|ufc|mma|fight night)\b/i, search: 'boxing ring', people: { industry: 'Sports', subcategory: 'Martial Arts' } },
  { test: /\b(football|college football|ncaa)\b/i, search: 'American football stadium', people: { industry: 'Sports', subcategory: 'American Football' } },
  { test: /\b(congress|senate|senators?|lawmakers?|the house|house (speaker|votes?|passe[sd]|leaves|republicans|democrats|gop|floor|committee)|capitol|republicans?|democrats?|gop|impeach\w*|elections?|governor|mayor)\b/i, search: 'United States Capitol', people: false },
  { test: /\b(white house|president|trump|biden|administration|executive order)\b/i, search: 'White House', people: false },
  { test: /\b(court|judge|trial|lawsuit|jury|verdict|sues?|sued|attorneys?)\b/i, search: 'courthouse', people: false },
  { test: /\b(police|arrest(ed)?|shooting|suspect|charged|fbi|crime)\b/i, search: 'police car', people: false },
  { test: /\b(hurricane|storm|flood(ing)?|wildfire|tornado|earthquake|weather|heat wave)\b/i, search: 'storm clouds', people: false },
  { test: /\b(stocks?|wall street|economy|tariffs?|inflation|the fed|interest rates?|markets?)\b/i, search: 'Wall Street', people: false },
  { test: /\b(ai|tech|apple|google|microsoft|meta|openai|nvidia|anthropic|chips?)\b/i, search: 'data center', people: false },
  { test: /\b(hospital|doctors?|vaccines?|cancer|health|medical|fda)\b/i, search: 'hospital building', people: false },
  { test: /\b(flights?|airport|airlines?|plane|faa)\b/i, search: 'airport', people: false },
  { test: /\b(movies?|films?|box office|oscars?|emmys?|netflix|hbo|disney|tv series|sitcom|actors?|actress)\b/i, search: 'movie theater', people: { industry: 'Film and TV' } },
  { test: /\b(concert|tour|album|songs?|singer|rapper|music|grammys?|festival)\b/i, search: 'concert stage', people: { industry: 'Music' } },
  { test: /\b(comedian|comedy|stand-up)\b/i, search: 'comedy club stage', people: { industry: 'Comedy' } },
  { test: /\b(tiktok|youtuber?|influencers?|streamer|podcast)\b/i, search: 'recording studio microphone', people: { industry: 'Influencers' } },
  { test: /\b(weddings?|married|engaged|engagement|divorce)\b/i, search: 'wedding rings', people: false },
  { test: /\b(mansion|real estate|home|house)\b/i, search: 'mansion', people: false },
];

const NICHE: Record<OutletId, string[]> = {
  espn: ['sports stadium', 'basketball arena', 'baseball stadium'],
  cnn: ['New York City skyline', 'Washington, D.C.', 'city street'],
  fox: ['United States Capitol', 'American flag', 'Washington, D.C.'],
  tmz: ['Hollywood Sign', 'Los Angeles skyline', 'concert stage', 'Sunset Boulevard'],
  nyt: ['New York City skyline'],
  bbc: ['London skyline'],
  people: ['red carpet event', 'Hollywood Sign', 'New York City skyline'],
  imdb: ['movie theater', 'film set', 'Hollywood Sign'],
};

const SENSITIVE = /\b(arrest\w*|charg(ed|es)|indict\w*|kill\w*|dead|dies|died|death|murder\w*|shoot\w*|shot|stabb\w*|assault\w*|abus\w*|rape\w*|sexual\w*|accus\w*|alleg\w*|lawsuits?|sues|sued|scandal\w*|fraud\w*|prison|jail\w*|convict\w*|guilty|sentenc\w*|crash\w*|overdos\w*|drugs?|dui|suspects?|victims?|investigat\w*|probe|fired|banned|suspen\w*|racis\w*|antisemit\w*|terror\w*|war|missiles?|attack\w*|hostages?|kidnap\w*|missing|funeral|obituar\w*|cancer|hospitali[sz]ed|injur\w*|affair|divorc\w*|cheat\w*|robbe\w*|stolen|theft|police|court|trial|judge|verdict|feud\w*|slam\w*|blast\w*|rips?|backlash|controvers\w*|outrage\w*|apolog\w*|harass\w*|misconduct|split|breakup|palestin\w*|israel\w*|gaza|drilled|hit by|scary|hurt|carted|collaps\w*|surger\w*|torn|acl|concussion)\b/i;

// Capitalised pairs that aren't people.
const NOT_A_NAME = /^(Super Bowl|White House|World Series|World Cup|Premier League|Champions League|Stanley Cup|Grand Prix|Box Office|Hall Of Fame|New York|Los Angeles|San Francisco|Las Vegas|New Orleans|United States|Supreme Court|Wall Street|Golden Globes|Academy Awards|Kennedy Center|Madison Square)$/i;

/** Whether a headline looks like it names a person (someone not on Pauv, since
 *  those were matched already). A first name Pauv knows followed by a
 *  capitalised word counts anywhere; in sentence-case headlines any capitalised
 *  pair after the first word counts. Title Case headlines (TMZ) can only be
 *  judged by the first-name check. */
function mayNameSomeone(headline: string, firstNames: Set<string>): boolean {
  const words = headline.split(/\s+/).map(w => w.replace(/[^A-Za-z'-]/g, '').replace(/'s$/, ''));
  const titleCase = words.filter(w => /^[A-Z]/.test(w)).length >= words.length * 0.6;
  for (let i = 0; i < words.length - 1; i++) {
    const [a, b] = [words[i], words[i + 1]];
    if (!/^[A-Z][a-z]+$/.test(a) || !/^[A-Z][a-z]/.test(b) || NOT_A_NAME.test(`${a} ${b}`)) continue;
    if (firstNames.has(a.toLowerCase())) return true;
    if (!titleCase && i > 0) return true;
  }
  return false;
}

function topicFor(headline: string): (typeof TOPICS)[number] | null {
  return TOPICS.find(t => t.test.test(headline)) ?? null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** The person on Pauv a headline names, if any (the longest name wins). */
function namedOnPauv(headline: string, roster: PauvPerson[]): PauvPerson | null {
  const hay = ` ${fold(headline).replace(/[^a-z0-9]+/g, ' ')} `;
  let best: PauvPerson | null = null;
  for (const p of roster) {
    const words = fold(p.name).split(/[^a-z0-9]+/).filter(Boolean);
    if (words.length === 0 || !hay.includes(` ${words.join(' ')} `)) continue;
    if (words.length === 1) {
      // One-word names ("Drake", "Future") only when plainly used as the name:
      // capitalised, not the headline's first word, and not followed by a
      // capitalised word (that's someone else, like Drake Maye).
      const m = headline.match(new RegExp(`(^|[^A-Za-z0-9])${escapeRe(p.name)}(?![A-Za-z0-9])(\\s+[A-Z][a-z])?`));
      if (!m || m.index === 0 && m[1] === '' || m[2]) continue;
    }
    if (!best || p.name.length > best.name.length) best = p;
  }
  return best;
}

function randomPerson(headline: string, outlet: OutletId, roster: PauvPerson[], taken: Set<string>, exclude: string): PauvPerson | null {
  const people = topicFor(headline)?.people;
  if (!people) return null;
  const free = roster.filter(p => !taken.has(p.ticker) && fold(p.name) !== exclude && p.industry === people.industry);
  const exact = people.subcategory ? free.filter(p => p.subcategory === people.subcategory) : free;
  const pool = exact.length >= 5 ? exact : free;
  return pool.length ? pool[hash(`${outlet}|${headline}`) % pool.length] : null;
}

function pauvPhoto(p: PauvPerson): NewsPhoto {
  return {
    source: 'pauv', url: p.photoUrl, width: 512, height: 512, title: p.name,
    creator: 'Pauv', license: 'Pauv profile photo', licenseUrl: '', page: `https://pauv.com/profile/${p.ticker}`,
  };
}

interface SceneReport { clean?: unknown; recognisable_person?: unknown }

const SCENE_PROMPT = `These are stock photos for small thumbnails beside news headlines.
For each image report:
- "clean": true when it is a real photograph with no text overlay, watermark, border, collage or diagram.
- "recognisable_person": true when anyone in it is close enough to be recognised (a distant crowd or a blurred passer-by doesn't count).

Answer with JSON only, in exactly this shape, one entry per image:
{"images":[{"image":1,"clean":true,"recognisable_person":false}]}`;

const PEOPLE_WORDS = /\b(portrait|people|person|man|woman|boy|girl|crowd|fans|players?|team|celebrat\w*|selfie)\b/i;

const sceneCache = new Map<string, { at: number; value: Promise<CommonsFile[]> }>();

/** Scene photos for one search, landscape, good size, in search order. */
function scenes(search: string): Promise<CommonsFile[]> {
  const hit = sceneCache.get(search);
  if (hit && Date.now() - hit.at < CACHE_MS * 6) return hit.value;
  const value = (async () => {
    const keep = (files: CommonsFile[]) => files.filter(f => f.width / f.height >= 1.25 && f.width / f.height <= 2.2 && f.width >= 800 && !PEOPLE_WORDS.test(f.title));
    // Commons' Quality images are sharp and well framed; fall back to everything.
    let files = keep(await searchCommons(`${search} incategory:Quality_images`, 20, { full: LOOK_WIDTH, look: LOOK_WIDTH }));
    if (files.length < 3) files = [...files, ...keep(await searchCommons(search, 20, { full: LOOK_WIDTH, look: LOOK_WIDTH }))];
    const seen = new Set<number>();
    return files.filter(f => !seen.has(f.pageid) && seen.add(f.pageid)).slice(0, 5);
  })();
  sceneCache.set(search, { at: Date.now(), value });
  value.then(v => { if (v.length === 0) sceneCache.delete(search); }, () => sceneCache.delete(search));
  return value;
}

const checked = new Map<string, boolean>();

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return h >>> 0;
}

/** One thumbnail per headline. `exclude` is the page's own subject, kept out of
 *  the random picks. */
export async function thumbPhotos(outlet: OutletId, headlines: string[], exclude = ''): Promise<ThumbPhotosResponse> {
  const photos: (NewsPhoto | null)[] = headlines.map(() => null);

  // People first: whoever a headline names, then random picks up to about half.
  const roster = await pauvPeople().catch(() => [] as PauvPerson[]);
  const taken = new Set<string>();
  const firstNames = new Set(roster.map(p => p.name.split(/\s+/)).filter(w => w.length >= 2 && w[0].length >= 3).map(w => w[0].toLowerCase()));
  headlines.forEach((h, i) => {
    const p = namedOnPauv(h, roster);
    if (p && !taken.has(p.ticker)) { photos[i] = pauvPhoto(p); taken.add(p.ticker); }
  });
  let wanted = Math.round(headlines.length / 2) - photos.filter(Boolean).length;
  const order = headlines.map((_, i) => i).sort((a, b) => hash(headlines[a]) - hash(headlines[b]));
  for (const i of order) {
    if (wanted <= 0) break;
    if (photos[i] || SENSITIVE.test(headlines[i]) || mayNameSomeone(headlines[i], firstNames)) continue;
    const p = randomPerson(headlines[i], outlet, roster, taken, fold(exclude.trim()));
    if (p) { photos[i] = pauvPhoto(p); taken.add(p.ticker); wanted--; }
  }

  // Scenes for the rest.
  const sceneSlots = headlines.map((_, i) => i).filter(i => !photos[i]);
  if (sceneSlots.length === 0) return { photos, ai: true };
  const topics = sceneSlots.map(i => topicFor(headlines[i])?.search ?? NICHE[outlet][i % NICHE[outlet].length]);
  const pools = new Map<string, CommonsFile[]>();
  await Promise.all([...new Set([...topics, ...NICHE[outlet]])].map(async s => { pools.set(s, await scenes(s).catch(() => [])); }));

  // One Gemini look at every scene not checked before.
  let ai = true;
  const unchecked = [...new Map([...pools.values()].flat().filter(f => !checked.has(f.url)).map(f => [f.url, f])).values()];
  if (unchecked.length > 0) {
    try {
      const reports = await askGemini<SceneReport>(SCENE_PROMPT, unchecked);
      unchecked.forEach((f, k) => {
        const r = reports[k];
        if (r) checked.set(f.url, r.clean === true && r.recognisable_person === false);
      });
    } catch {
      ai = false;
    }
  }
  const usable = (f: CommonsFile) => checked.get(f.url) ?? !ai;

  const used = new Set<string>();
  sceneSlots.forEach((i, k) => {
    for (const search of [topics[k], ...NICHE[outlet]]) {
      const pool = (pools.get(search) ?? []).filter(f => usable(f) && !used.has(f.url));
      if (pool.length === 0) continue;
      const f = pool[hash(headlines[i]) % pool.length];
      used.add(f.url);
      photos[i] = { source: 'commons', url: f.url, width: f.width, height: f.height, title: f.title, creator: f.creator, license: f.license, licenseUrl: f.licenseUrl, page: f.page };
      return;
    }
  });
  return { photos, ai };
}
