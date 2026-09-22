import type { NewsArticle, RailItem } from '../types';
import { bodyHtml, esc, GOOGLE_G, MONTH_LONG, partsIn, PHOTO_SLOTS, photoBox, PLACEHOLDER_CSS, wasUpdated, type PagePhotos, type RenderedPage } from './shared';

// TMZ article page. Layout from the approved mockup. The big headline uses
// TMZ's own three-part split when the page has one. No EXCLUSIVE tag and no
// comment count (neither can be verified); the right column lists TMZ's
// latest real headlines.

function tmzDate(iso: string): string {
  const p = partsIn(iso, 'America/Los_Angeles');
  return `${MONTH_LONG[p.month - 1]} ${p.day}, ${p.year} ${p.hour}:${p.minute} ${p.dayPeriod} ${p.tz}`;
}

const CSS = `
.np { --red: #d8000f; --ink: #111; --grey: #9a9a9a;
  width: 1440px; background: #fff; color: var(--ink); font-family: "Fira Sans", Arial, sans-serif; -webkit-font-smoothing: antialiased; }
* { box-sizing: border-box; }
.header { height: 96px; background: #000; }
.header .inner { width: 1282px; margin-left: 85px; height: 96px; display: flex; align-items: center; }
.header .logo { width: 150px; display: block; margin-right: 44px; }
.nav { display: flex; gap: 40px; font: 33px/1 Anton, Impact, sans-serif; color: #fff; letter-spacing: .3px; }
.search { margin-left: auto; width: 217px; height: 48px; border-radius: 24px; background: #262626; display: flex; align-items: center; justify-content: flex-end; padding-right: 18px; }
.wrap { width: 1282px; margin: 0 0 0 85px; }
.row { display: grid; grid-template-columns: 870px 357px; gap: 55px; padding: 34px 0 80px; }
.kicker { font: 700 46px/50px "Fira Sans Condensed", Arial, sans-serif; text-transform: uppercase; }
h1 { margin: 6px 0 0; font: 800 88px/82px "Fira Sans Condensed", Arial, sans-serif; text-transform: uppercase; letter-spacing: 0; }
h1.long { font-size: 64px; line-height: 62px; }
.subhead { margin-top: 10px; font: 700 40px/44px "Fira Sans Condensed", Arial, sans-serif; }
.tools { display: flex; align-items: center; margin-top: 24px; }
.sq { width: 67px; height: 37px; display: grid; place-items: center; margin-right: 6px; }
.sq.fb { background: #3d85e6; }
.sq.x { background: #000; }
.sq.com { background: #e5001a; }
.gbtn { margin-left: auto; width: 222px; height: 55px; border-radius: 8px; padding: 2px; background: linear-gradient(90deg, #34a853, #fbbc05 40%, #ea4335 70%, #a142f4); }
.gbtn span { display: flex; align-items: center; gap: 12px; height: 100%; border-radius: 6px; background: #fff; padding-left: 10px; font: italic 700 13.5px/1 "Fira Sans", Arial, sans-serif; letter-spacing: .2px; color: #7b4fd6; }
.gbtn i { width: 28px; height: 28px; border-radius: 50%; box-shadow: 0 1px 3px rgba(0,0,0,.25); display: grid; place-items: center; }
.by { margin-top: 12px; font: italic 16px "Fira Sans", Arial, sans-serif; color: #777; }
.by b { color: var(--red); font-weight: 400; }
.dates { margin-top: 12px; font: italic 17px "Fira Sans", Arial, sans-serif; color: var(--grey); }
.dates .pipe { margin: 0 12px; }
.credit { margin-top: 6px; text-align: right; font: italic 13px "Fira Sans", Arial, sans-serif; color: var(--grey); }
.body { margin-top: 26px; font-size: 20px; line-height: 32px; letter-spacing: .25px; color: #222; text-align: justify; }
.body p { margin: 0 0 26px; }
.body h2 { margin: 30px 0 14px; font: 800 30px/34px "Fira Sans Condensed", Arial, sans-serif; text-transform: uppercase; text-align: left; letter-spacing: 0; }
.body ul, .body ol { margin: 0 0 26px; padding-left: 26px; text-align: left; }
.body li { margin: 0 0 8px; }
.body blockquote { margin: 0 0 26px; padding-left: 20px; border-left: 4px solid var(--red); font-style: italic; text-align: left; }
.popular { position: relative; height: 38px; margin: 0 6px 22px 10px; }
.popular .shadow { position: absolute; left: 0; top: 0; right: 0; bottom: 0; transform: translate(6px, 5px) skewX(-14deg); background: repeating-linear-gradient(135deg, #9b9b9b 0 1px, transparent 1px 3px); }
.popular .bar { position: absolute; left: 0; top: 0; right: 0; bottom: 0; transform: skewX(-14deg); background: #000; }
.popular span { position: relative; display: block; text-align: center; color: #fff; font: italic 800 22px/38px "Fira Sans Condensed", Arial, sans-serif; letter-spacing: .5px; }
.pop { display: flex; gap: 13px; margin-bottom: 16px; }
.pop h4 { margin: 8px 0 0; font: 500 17.5px/25px "Fira Sans", Arial, sans-serif; letter-spacing: -.1px; }
${PLACEHOLDER_CSS}
`;

export function renderTmz(a: NewsArticle, rail: RailItem[], _now: Date, photos: PagePhotos): RenderedPage {
  const slots = PHOTO_SLOTS.tmz;
  const parts = a.headlineParts;
  const main = parts?.main ?? a.headline;
  const dates = a.publishedAt
    ? `Published ${tmzDate(a.publishedAt)}${wasUpdated(a.publishedAt, a.updatedAt) ? `<span class="pipe">|</span>Updated ${tmzDate(a.updatedAt!)}` : ''}`
    : '';

  const html = `
<div class="np">
  <header class="header">
    <div class="inner">
      <img class="logo" src="/news/tmz.svg" alt="TMZ"/>
      <nav class="nav"><span>NEWS</span><span>SPORTS</span><span>PHOTOS</span><span>VIDEOS</span><span>PODS</span><span>TOURS</span><span>DEALS</span></nav>
      <div class="search"><svg width="22" height="22" viewBox="0 0 22 22" fill="none" stroke="#fff" stroke-width="2.8"><circle cx="9" cy="9" r="6.5"/><path d="m14 14 6 6"/></svg></div>
    </div>
  </header>
  <div class="wrap">
    <div class="row">
      <main>
        ${parts?.kicker ? `<div class="kicker">${esc(parts.kicker)}</div>` : ''}
        <h1${main.length > 70 ? ' class="long"' : ''}>${esc(main)}</h1>
        ${parts?.sub ? `<div class="subhead">${esc(parts.sub)}</div>` : ''}
        <div class="tools">
          <span class="sq fb"><svg width="11" height="20" viewBox="0 0 10 18"><path d="M6.5 18v-8h2.7l.4-3.1H6.5V4.9c0-.9.3-1.5 1.6-1.5H9.7V.6C9.4.6 8.4.5 7.3.5 4.9.5 3.3 1.9 3.3 4.6v2.3H.6V10h2.7v8z" fill="#fff"/></svg></span>
          <span class="sq x"><svg width="20" height="20" viewBox="0 0 16 16"><path d="M1 1h4.2l3.3 4.5L12.4 1h2.1L9.4 6.8 15 15h-4.2L7.2 10.1 3 15H.9l5.3-6.1z" fill="none" stroke="#fff" stroke-width=".9"/></svg></span>
          <span class="sq com"><svg width="24" height="22" viewBox="0 0 24 22"><path d="M12 1C5.9 1 1 4.9 1 9.8c0 2.6 1.4 5 3.7 6.6L3.5 21l5.2-3c1 .2 2.2.4 3.3.4 6.1 0 11-3.9 11-8.8S18.1 1 12 1z" fill="#fff"/></svg></span>
          <span class="gbtn"><span><i>${GOOGLE_G}</i>ADD TMZ ON GOOGLE</span></span>
        </div>
        <div class="by">By <b>${esc(a.byline.toUpperCase())}</b></div>
        ${dates ? `<div class="dates">${dates}</div>` : ''}
        ${photoBox(photos.hero?.src, slots.hero, 'margin-top:16px')}
        ${photos.hero ? `<div class="credit">${esc(photos.hero.credit)}</div>` : ''}
        <div class="body">${bodyHtml(a)}</div>
      </main>
      <aside>
        ${rail.length ? `<div class="popular"><i class="shadow"></i><i class="bar"></i><span>LATEST</span></div>
        ${rail.slice(0, 6).map((r, i) => `<div class="pop">${photoBox(photos.thumbs[i], slots.thumbs[i])}<h4>${esc(r.title)}</h4></div>`).join('')}` : ''}
      </aside>
    </div>
  </div>
</div>`;
  return {
    css: CSS,
    html,
    fontsHref: 'https://fonts.googleapis.com/css2?family=Anton&family=Fira+Sans:ital,wght@0,400;0,500;0,700;1,400;1,700&family=Fira+Sans+Condensed:ital,wght@0,700;0,800;1,800&display=swap',
  };
}
