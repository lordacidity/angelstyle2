// Reads a laid-out News page — the hidden iframe rasterize.ts draws it from,
// fonts loaded and photos decoded — for what the news recording
// (components/news/news-video.ts) needs to know about it: where the person's
// name sits, where the photos are, and where there is text at all. Everything
// is in the page's own CSS px from its top-left corner.

export interface Rect { x: number; y: number; w: number; h: number }

export interface NameMark {
  /** What gets selected, in reading order, one box per character: the name
   *  and, when one follows it, the space after — the way a hand drags. */
  chars: Rect[];
  text: string;
  /** In the headline, or the first time the story mentions it. */
  where: 'headline' | 'story';
  /** True when the name was nowhere on the page and the start of the headline
   *  stands in. */
  standIn: boolean;
}

export interface PageMeasure {
  /** The page's background, as CSS gives it (`rgb(…)`). */
  background: string;
  /** The photos (the main one and the side column's), in page order. */
  photos: Rect[];
  /** Every box with text in it: where the pointer is an I-beam. */
  text: Rect[];
  /** Null only for a page with nothing on it at all. */
  name: NameMark | null;
}

type Mapped = { s: string; nodes: Text[]; starts: number[] };

/** All the text under `scope` as one string, with each character traceable
 *  back to its text node. A break goes in between elements, so a match can't
 *  run across two of them. */
function mapText(scope: Element): Mapped {
  const walker = scope.ownerDocument.createTreeWalker(scope, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let s = '';
  let lastParent: Node | null = null;
  for (let n = walker.nextNode() as Text | null; n; n = walker.nextNode() as Text | null) {
    if (!n.data) continue;
    if (lastParent && n.parentNode !== lastParent) s += '\n';
    lastParent = n.parentNode;
    starts.push(s.length);
    nodes.push(n);
    s += n.data;
  }
  return { s, nodes, starts };
}

function nodeAt(m: Mapped, i: number): [Text, number] | null {
  let k = m.starts.length - 1;
  while (k >= 0 && m.starts[k] > i) k--;
  if (k < 0) return null;
  const off = i - m.starts[k];
  return off < m.nodes[k].data.length ? [m.nodes[k], off] : null;
}

const wordChar = (c: string | undefined) => !!c && /[\p{L}\p{N}]/u.test(c);

/** The first whole-word occurrence of `needle` in the mapped text, or -1. */
function findWord(m: Mapped, needle: string): number {
  const hay = m.s.toLowerCase();
  const n = needle.toLowerCase();
  let from = 0;
  for (;;) {
    const i = hay.indexOf(n, from);
    if (i < 0) return -1;
    if (!wordChar(m.s[i - 1]) && !wordChar(m.s[i + n.length])) return i;
    from = i + 1;
  }
}

function rel(r: DOMRect, base: DOMRect): Rect {
  return { x: r.left - base.left, y: r.top - base.top, w: r.width, h: r.height };
}

/** One box per character of m.s[i, i+len), plus the space after when there
 *  is one; characters that take no room (a collapsed break) are left out. */
function charBoxes(m: Mapped, i: number, len: number, base: DOMRect): Rect[] | null {
  const doc = m.nodes[0]?.ownerDocument;
  if (!doc) return null;
  const out: Rect[] = [];
  const end = i + len + (m.s[i + len] === ' ' ? 1 : 0);
  for (let k = i; k < end; k++) {
    const at = nodeAt(m, k);
    if (!at) return null;
    const range = doc.createRange();
    range.setStart(at[0], at[1]);
    range.setEnd(at[0], at[1] + 1);
    const r = range.getBoundingClientRect();
    if (r.width > 0 && r.height > 0) out.push(rel(r, base));
  }
  return out.length ? out : null;
}

/** The name as the page might print it: whole, then the short form the search
 *  found in the headline when there is one ("AOC"), then the surname, then
 *  the first name — a headline says "Trump", the story says "Donald Trump". */
function candidates(name: string, namedAs?: string): string[] {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const out = [words.join(' ')];
  if (namedAs?.trim()) out.push(namedAs.trim());
  if (words.length > 1) {
    const last = words[words.length - 1];
    const first = words[0];
    if (last.length >= 3) out.push(last);
    if (first.length >= 3) out.push(first);
  }
  return [...new Set(out.filter(Boolean))];
}

function findIn(scopes: Element[], needles: string[], base: DOMRect): { chars: Rect[]; text: string } | null {
  for (const scope of scopes) {
    const m = mapText(scope);
    if (!m.s.trim()) continue;
    for (const needle of needles) {
      const i = findWord(m, needle);
      if (i < 0) continue;
      const chars = charBoxes(m, i, needle.length, base);
      if (chars) return { chars, text: m.s.slice(i, i + needle.length) };
    }
  }
  return null;
}

export function measureNewsPage(root: HTMLElement, name: string, namedAs?: string): PageMeasure {
  const base = root.getBoundingClientRect();
  const win = root.ownerDocument.defaultView ?? window;
  const background = win.getComputedStyle(root).backgroundColor;

  const photos = [...root.querySelectorAll<HTMLElement>('img.np-img')]
    .map(el => rel(el.getBoundingClientRect(), base))
    .filter(r => r.w > 0 && r.h > 0);

  const text: Rect[] = [];
  for (const el of root.querySelectorAll<HTMLElement>('*')) {
    let has = false;
    for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE && /\S/.test((n as Text).data)) { has = true; break; }
    if (!has) continue;
    const r = rel(el.getBoundingClientRect(), base);
    if (r.w > 0 && r.h > 0) text.push(r);
  }

  // The headline first (TMZ's is three pieces), then the story, then anywhere.
  const headline = [...root.querySelectorAll<HTMLElement>('h1, .kicker, .subhead')];
  const story = [...root.querySelectorAll<HTMLElement>('.dek, .body')];
  const needles = candidates(name, namedAs);
  let mark: NameMark | null = null;
  if (needles.length) {
    const inHead = findIn(headline, needles, base);
    if (inHead) mark = { ...inHead, where: 'headline', standIn: false };
    else {
      const inStory = findIn(story, needles, base) ?? findIn([root], needles, base);
      if (inStory) mark = { ...inStory, where: 'story', standIn: false };
    }
  }
  if (!mark) {
    // Nowhere on the page: the first couple of words of the headline stand in,
    // so the clip still has something to drag across.
    for (const h of headline) {
      const m = mapText(h);
      const words = m.s.match(/\S+/g);
      if (!words?.length) continue;
      const stand = words.slice(0, 2).join(' ');
      const i = m.s.indexOf(stand);
      const chars = i >= 0 ? charBoxes(m, i, stand.length, base) : null;
      if (chars) { mark = { chars, text: stand, where: 'headline', standIn: true }; break; }
    }
  }
  return { background, photos, text, name: mark };
}
