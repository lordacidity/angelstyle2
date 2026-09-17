import type { NewsArticle, RailItem } from '../types';
import { esc, photoBox, PHOTO_SLOTS, PLACEHOLDER_CSS, type PagePhotos, type RenderedPage } from './shared';

// IMDb news page. Layout from the screenshot of the real page: the dark bar,
// the sponsored block, the story in a card on the left and IMDb's own news
// lists down the right.
//
// IMDb doesn't write the stories it lists — each one is an excerpt of someone
// else's, credited on the page and ending in a link to it, and that is how the
// card is drawn here: the excerpt as far as IMDb runs it, then "See full
// article at" whoever wrote it. The sponsored block the real page carries over
// the story is left out.

const EXT = (color: string) => `<svg class="ext" width="11" height="11" viewBox="0 0 12 12" fill="none" stroke="${color}" stroke-width="1.3"><path d="M4.5 1.5h-3v9h9v-3"/><path d="M7 1.5h3.5V5"/><path d="M10.2 1.8 5.6 6.4"/></svg>`;
const CHEV = `<svg width="8" height="13" viewBox="0 0 8 13" fill="none" stroke="#101010" stroke-width="2"><path d="m1.5 1.5 5 5-5 5"/></svg>`;

/** IMDb stamps its lists the short American way: 9/13/2026. */
function imdbDay(iso: string): string {
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
}

const CSS = `
.np { --yellow: #f5c518; --blue: #5799ef; --ink: #000; --grey: #767676; --line: #e3e3e3;
  width: 1440px; background: #fff; color: var(--ink); font-family: Roboto, Arial, sans-serif; -webkit-font-smoothing: antialiased; padding-bottom: 70px; }
* { box-sizing: border-box; }
.bar { width: 1160px; margin: 0 auto; }
.head { height: 56px; background: #121212; color: #fff; }
.head .bar { height: 56px; display: flex; align-items: center; gap: 22px; }
.head .logo { width: 64px; display: block; }
.menu { display: flex; align-items: center; gap: 9px; font-size: 14px; font-weight: 700; }
.menu i { display: block; width: 17px; height: 2px; background: #fff; box-shadow: 0 5px 0 #fff, 0 10px 0 #fff; margin-top: -10px; }
.find { flex: 1; height: 32px; border-radius: 4px; background: #515151; display: flex; align-items: center; overflow: hidden; }
.find .all { display: flex; align-items: center; gap: 7px; padding: 0 12px; height: 32px; font-size: 14px; font-weight: 500; border-right: 1px solid #6a6a6a; }
.find .ph { flex: 1; padding-left: 13px; font-size: 14px; color: #c9c9c9; }
.find .go { width: 38px; height: 28px; margin-right: 2px; border-radius: 3px; background: #fff; display: grid; place-items: center; }
.pro { font-size: 15px; font-weight: 700; letter-spacing: -.2px; }
.pro b { color: #1ea7fd; font-weight: 700; }
.head .sep { width: 1px; height: 26px; background: #4a4a4a; }
.head .act { display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 500; white-space: nowrap; }
.row { display: flex; padding-top: 24px; }
.card { width: 764px; border: 1px solid var(--line); border-radius: 10px; padding: 20px; }
h1 { margin: 0 0 14px; font-size: 17px; line-height: 23px; font-weight: 700; }
h1 .ext { margin-left: 4px; }
.body { margin-top: 16px; font-size: 15px; line-height: 24px; }
.body p { margin: 0 0 24px; }
.full { font-size: 15px; line-height: 24px; color: var(--blue); }
.meta { margin-top: 22px; display: flex; align-items: center; font-size: 13px; color: var(--grey); }
.dot { margin: 0 8px; }
.meta .src { color: var(--blue); }
.meta .kebab { margin-left: auto; width: 3px; height: 3px; border-radius: 50%; background: #5a5a5a; box-shadow: 0 -6px 0 #5a5a5a, 0 6px 0 #5a5a5a; }
.sec { display: flex; align-items: center; gap: 10px; margin: 38px 0 22px; font-size: 20px; font-weight: 700; }
.sec i { width: 4px; height: 24px; background: var(--yellow); }
.group { display: flex; align-items: center; gap: 7px; margin: 0 0 14px; font-size: 18px; font-weight: 700; }
.item { display: flex; height: 114px; border: 1px solid var(--line); border-radius: 8px; overflow: hidden; margin-bottom: 14px; }
.item .txt { flex: 1; padding: 16px 18px; }
.item h4 { margin: 0; font-size: 15px; line-height: 21px; font-weight: 400; }
.item .when { margin-top: 8px; font-size: 13px; color: var(--grey); display: flex; align-items: center; }
.rail { width: 351px; margin-left: 45px; }
.rail .item { height: 106px; margin-bottom: 12px; }
.rail .item .txt { padding: 13px 14px; }
.rail .item h4 { font-size: 14.5px; line-height: 20px; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-height: 40px; }
.rail .group { margin-top: 26px; }
${PLACEHOLDER_CSS}
`;

interface Group { label: string; items: { item: RailItem; i: number }[] }

/** IMDb's lists, in the order the rail gives them, each under its own name. */
function groupRail(rail: RailItem[]): Group[] {
  const out: Group[] = [];
  rail.forEach((item, i) => {
    const label = item.group ?? 'News';
    const last = out[out.length - 1];
    if (last && last.label === label) last.items.push({ item, i });
    else out.push({ label, items: [{ item, i }] });
  });
  return out;
}

export function renderImdb(a: NewsArticle, rail: RailItem[], _now: Date, photos: PagePhotos): RenderedPage {
  const slots = PHOTO_SLOTS.imdb;
  const groups = groupRail(rail);
  const similar = groups[0];
  const explore = groups.slice(1);
  const when = a.publishedAt ? imdbDay(a.publishedAt) : '';

  const card = (g: { item: RailItem; i: number }) => `<div class="item">
    <div class="txt">
      <h4>${esc(g.item.title)}</h4>
      <div class="when">${g.item.publishedAt ? imdbDay(g.item.publishedAt) : ''}${g.item.byline ? `<span class="dot">·</span>by ${esc(g.item.byline)}` : ''}</div>
    </div>
    ${photoBox(photos.thumbs[g.i], slots.thumbs[g.i] ?? slots.thumbs[slots.thumbs.length - 1])}
  </div>`;

  const html = `
<div class="np">
  <header class="head">
    <div class="bar">
      <img class="logo" src="/news/imdb.png" alt="IMDb"/>
      <span class="menu"><i></i>Menu</span>
      <div class="find">
        <span class="all">All <svg width="9" height="6" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6z" fill="#fff"/></svg></span>
        <span class="ph">Search IMDb</span>
        <span class="go"><svg width="17" height="17" viewBox="0 0 18 18" fill="none" stroke="#121212" stroke-width="2"><circle cx="7.5" cy="7.5" r="5.5"/><path d="m12 12 4.5 4.5"/></svg></span>
      </div>
      <span class="pro">IMDb<b>Pro</b></span>
      <i class="sep"></i>
      <span class="act"><svg width="16" height="19" viewBox="0 0 16 19" fill="#fff"><path d="M1 0h14v18l-7-5-7 5z"/><path d="M8 4v7M4.5 7.5h7" stroke="#121212" stroke-width="1.6"/></svg>Watchlist</span>
      <span class="act">Sign in</span>
      <span class="act">EN <svg width="9" height="6" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6z" fill="#fff"/></svg></span>
    </div>
  </header>
  <div class="bar row">
    <main>
      <div class="card">
        <h1>${esc(a.headline)}${EXT('#000')}</h1>
        ${photoBox(photos.hero?.src, slots.hero, 'border-radius:4px')}
        <div class="body">${a.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}</div>
        ${a.sourceName ? `<div class="full">See full article at ${esc(a.sourceName)}${EXT('#5799ef')}</div>` : ''}
        <div class="meta">
          ${when}<span class="dot">·</span>by ${esc(a.byline)}${a.sourceName ? `<span class="dot">·</span><span class="src">${esc(a.sourceName)}${EXT('#5799ef')}</span>` : ''}
          <i class="kebab"></i>
        </div>
      </div>
      ${similar ? `<div class="sec"><i></i>Similar News</div>
      <div class="group">${esc(similar.label)} ${CHEV}</div>
      ${similar.items.map(g => card(g)).join('')}` : ''}
    </main>
    <aside class="rail">
      ${explore.length ? `<div class="sec"><i></i>More to explore</div>` : ''}
      ${explore.map(g => `<div class="group">${esc(g.label)} ${CHEV}</div>${g.items.map(x => card(x)).join('')}`).join('')}
    </aside>
  </div>
</div>`;
  return {
    css: CSS,
    html,
    fontsHref: 'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700&display=swap',
  };
}
