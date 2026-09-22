import type { NewsArticle, RailItem } from '../types';
import { agoLong, bodyHtml, esc, GOOGLE_G, MONTH_LONG, partsIn, PHOTO_SLOTS, photoBox, PLACEHOLDER_CSS, type PagePhotos, type RenderedPage } from './shared';

// BBC article page. Layout from the approved mockup. The time is shown the
// BBC way: relative for the first week, then the date.

function bbcWhen(iso: string, now: Date): string {
  const days = (now.getTime() - Date.parse(iso)) / 86_400_000;
  if (days < 7) return agoLong(iso, now);
  const p = partsIn(iso, 'Europe/London');
  return `${p.day} ${MONTH_LONG[p.month - 1]} ${p.year}`;
}

const CSS = `
.np { --ink: #141414; --grey: #545658; --line: #e6e8ea; --blue: #0a6cff;
  width: 1440px; background: #fff; color: var(--ink); font-family: Figtree, Arial, sans-serif; -webkit-font-smoothing: antialiased; padding-bottom: 80px; }
* { box-sizing: border-box; }
.top { position: relative; height: 94px; border-bottom: 1px solid var(--line); }
.top .menu { position: absolute; left: 25px; top: 35px; }
.top .live { position: absolute; left: 103px; top: 34px; display: flex; align-items: center; gap: 8px; font-size: 16.5px; font-weight: 500; }
.top .logo { position: absolute; left: 50%; top: 23px; height: 48px; margin-left: -81px; display: block; }
.top .right { position: absolute; right: 35px; top: 27px; display: flex; align-items: center; gap: 40px; font-size: 18px; font-weight: 500; }
.top .sub { background: var(--blue); color: #fff; height: 40px; padding: 0 17px; display: flex; align-items: center; }
.nav { height: 48px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: center; gap: 19px; font-size: 16.5px; font-weight: 500; }
.nav .div { width: 1px; height: 34px; background: var(--line); margin: 0 -9px; }
.col { width: 882px; margin: 0 auto; }
h1 { margin: 30px 0 0; font: 500 44.5px/52px "Noto Serif", Georgia, serif; letter-spacing: -.3px; }
.meta { display: flex; align-items: flex-start; margin-top: 16px; }
.meta .ago { font-size: 14px; color: var(--grey); }
.meta .acts { margin-left: auto; margin-top: 4px; display: flex; align-items: center; gap: 26px; font-size: 15px; font-weight: 500; }
.meta .acts span { display: inline-flex; align-items: center; gap: 8px; }
.meta .acts .gpref { border: 1px solid #b9bcbf; border-radius: 3px; height: 38px; padding: 0 10px; gap: 9px; color: #3b3d40; font-weight: 400; margin-left: -8px; }
.author { margin-top: 12px; font-size: 17.5px; font-weight: 600; }
.hero { position: relative; width: 1084px; margin: 34px auto 0; }
.hero .credit { position: absolute; left: 0; bottom: 0; max-width: 70%; background: rgba(0,0,0,.72); color: #fff; font-size: 13px; line-height: 17px; padding: 4px 8px; }
.body { width: 632px; margin-top: 38px; font: 400 21px/31px "Noto Serif", Georgia, serif; color: var(--ink); }
.body p { margin: 0 0 19px; }
.body h2 { margin: 34px 0 14px; font: 600 26px/32px "Noto Serif", Georgia, serif; letter-spacing: -.2px; }
.body ul, .body ol { margin: 0 0 19px; padding-left: 26px; }
.body li { margin: 0 0 8px; }
.body blockquote { margin: 0 0 19px; padding-left: 18px; border-left: 4px solid var(--blue); font-style: italic; }
${PLACEHOLDER_CSS}
`;

export function renderBbc(a: NewsArticle, _rail: RailItem[], now: Date, photos: PagePhotos): RenderedPage {
  const html = `
<div class="np">
  <header class="top">
    <svg class="menu" width="47" height="22" viewBox="0 0 47 22" fill="none" stroke="#141414" stroke-width="2.6"><path d="M0 3h17M0 11h13M0 19h17"/><circle cx="31" cy="10" r="8"/><path d="m37 16 7 6"/></svg>
    <div class="live"><svg width="20" height="20" viewBox="0 0 20 20"><circle cx="10" cy="10" r="8.5" fill="none" stroke="#d4351c" stroke-width="2"/><circle cx="10" cy="10" r="5" fill="#d4351c"/></svg>Watch Live</div>
    <img class="logo" src="/news/bbc.png" alt="BBC"/>
    <div class="right"><span class="sub">Subscribe</span><span>Sign In</span></div>
  </header>
  <nav class="nav">
    <span>Home</span><span>News</span><span>Sport</span><span>Business</span><span>Technology</span><span>Health</span><span>Culture</span><span>Arts</span><span>Travel</span><span>Earth</span><span class="div"></span><span>Audio</span><span>Video</span><span>Live</span><span>Documentaries</span>
  </nav>
  <div class="col">
    <h1>${esc(a.headline)}</h1>
    <div class="meta">
      <div class="ago">${a.publishedAt ? bbcWhen(a.publishedAt, now) : ''}</div>
      <div class="acts">
        <span>Share <svg width="17" height="17" viewBox="0 0 17 17" fill="#141414"><circle cx="13.5" cy="3.5" r="2.6"/><circle cx="3.5" cy="8.5" r="2.6"/><circle cx="13.5" cy="13.5" r="2.6"/><path d="M13.5 3.5 3.5 8.5l10 5" stroke="#141414" stroke-width="1.8" fill="none"/></svg></span>
        <span>Save <svg width="14" height="18" viewBox="0 0 14 18" fill="none" stroke="#141414" stroke-width="2"><path d="M1.5 1.5h11v15l-5.5-4-5.5 4z"/></svg></span>
        <span class="gpref">${GOOGLE_G}Add as preferred on Google</span>
      </div>
    </div>
    <div class="author">${esc(a.byline)}</div>
  </div>
  <div class="hero">${photoBox(photos.hero?.src, PHOTO_SLOTS.bbc.hero)}${photos.hero ? `<span class="credit">${esc(photos.hero.credit)}</span>` : ''}</div>
  <div class="col">
    <div class="body">${bodyHtml(a)}</div>
  </div>
</div>`;
  return {
    css: CSS,
    html,
    fontsHref: 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;500;600&family=Noto+Serif:wght@300..600&display=swap',
  };
}
