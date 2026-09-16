import type { NewsArticle, RailItem } from '../types';
import { esc, MONTH_LONG, partsIn, photoBox, PHOTO_SLOTS, PLACEHOLDER_CSS, wasUpdated, type PagePhotos, type RenderedPage } from './shared';

// Fox News article page. Layout from the approved mockup, minus the reaction
// counts (there is no real number to show); "More From Fox News" lists Fox's
// latest real headlines.

function foxDate(iso: string): string {
  const p = partsIn(iso, 'America/New_York');
  return `${MONTH_LONG[p.month - 1]} ${p.day}, ${p.year} ${p.hour}:${p.minute}${p.dayPeriod.toLowerCase()} ${p.tz}`;
}

const CSS = `
.np { --navy: #003366; --link: #1c4f8c; --red: #c20017; --ink: #1a1a1a; --muted: #666; --line: #e3e3e3;
  width: 1440px; background: #fff; color: var(--ink); font-family: Roboto, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
* { box-sizing: border-box; }
.redline { height: 5px; background: var(--red); }
.header { height: 95px; background: var(--navy); display: flex; align-items: center; padding: 0 38px; }
.logo { width: 56px; height: 56px; display: block; box-shadow: 0 0 0 2px #fff; margin-right: 36px; }
.nav { display: flex; gap: 33px; color: #fff; font-size: 16px; font-weight: 700; }
.nav span { display: inline-flex; align-items: center; gap: 9px; }
.caret { width: 0; height: 0; border-left: 4px solid transparent; border-right: 4px solid transparent; border-top: 6px solid #8ea6c4; }
.dots { display: grid; gap: 2px; }
.dots i { width: 3px; height: 3px; border-radius: 50%; background: #fff; }
.right { margin-left: auto; display: flex; align-items: center; gap: 14px; }
.btn { font: 700 15px/1 Roboto, Arial, sans-serif; color: #fff; padding: 9px 12px; border-radius: 3px; }
.btn.login { background: #24578f; margin-left: 16px; }
.btn.watch { background: #d8001d; }
.head { text-align: center; padding: 32px 90px 0; }
.pill { display: inline-block; background: var(--red); color: #fff; font-size: 14px; font-weight: 700; text-transform: uppercase; padding: 5px 7px 4px; border-radius: 4px; letter-spacing: .2px; }
h1 { margin: 14px auto 0; max-width: 1260px; font: 700 57px/67px "Roboto Condensed", Roboto, Arial, sans-serif; letter-spacing: -.3px; color: #1b1b1b; }
.dek { margin: 12px auto 0; max-width: 1180px; font-size: 28px; line-height: 34px; font-weight: 300; color: #2b2b2b; }
.byline { margin-top: 14px; font-size: 16px; color: var(--muted); }
.byline b { color: var(--navy); font-weight: 700; }
.byline .mid { margin: 0 6px; }
.dates { margin-top: 36px; font-size: 16px; color: var(--muted); }
.dates .pipe { margin: 0 14px; }
.row { display: grid; grid-template-columns: 1020px 352px; gap: 20px; padding: 0 19px 70px; margin-top: 16px; }
.shares { border-top: 1px solid var(--line); border-bottom: 1px solid var(--line); height: 76px; display: flex; align-items: center; justify-content: center; gap: 7px; }
.pillbtn { display: inline-flex; align-items: center; gap: 7px; height: 38px; padding: 0 14px; border-radius: 19px; background: var(--navy); color: #fff; font-size: 13px; font-weight: 700; }
.circle { width: 38px; height: 38px; border-radius: 50%; display: grid; place-items: center; }
.credit { margin-top: 10px; font-size: 14px; line-height: 20px; color: var(--muted); }
.body { margin-top: 30px; font-size: 21px; line-height: 33px; color: #222; }
.body p { margin: 0 0 26px; }
.rail h3 { margin: 0 0 10px; font-size: 21px; font-weight: 700; color: #1b1b1b; }
.card { margin-bottom: 26px; }
.card .img { position: relative; }
.card img.badge { position: absolute; top: 6px; left: 6px; width: 40px; height: 40px; box-shadow: 0 0 0 1.5px #fff; }
.card h4 { margin: 8px 0 0; color: var(--link); font-size: 18px; line-height: 26px; font-weight: 700; }
${PLACEHOLDER_CSS}
`;

export function renderFox(a: NewsArticle, rail: RailItem[], _now: Date, photos: PagePhotos): RenderedPage {
  const slots = PHOTO_SLOTS.fox;
  const authors = a.authors.length ? a.authors : [a.byline];
  const byNames = authors.map(n => `<b>${esc(n)}</b>`);
  const byJoined = byNames.length <= 1 ? byNames.join('') : `${byNames.slice(0, -1).join(', ')} and ${byNames[byNames.length - 1]}`;
  const dates = a.publishedAt
    ? `Published ${foxDate(a.publishedAt)}${wasUpdated(a.publishedAt, a.updatedAt) ? `<span class="pipe">|</span>Updated ${foxDate(a.updatedAt!)}` : ''}`
    : '';

  const html = `
<div class="np">
  <div class="redline"></div>
  <header class="header">
    <img class="logo" src="/news/fox.webp" alt="Fox News"/>
    <nav class="nav">
      <span>U.S. <i class="caret"></i></span><span>Politics <i class="caret"></i></span><span>World <i class="caret"></i></span><span>Opinion</span>
      <span>Media <i class="caret"></i></span><span>Entertainment <i class="caret"></i></span><span>Sports <i class="caret"></i></span>
      <span>More <span class="dots"><i></i><i></i><i></i></span></span>
    </nav>
    <div class="right">
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" stroke="#fff" stroke-width="2"><circle cx="8" cy="8" r="6"/><path d="m12.5 12.5 6 6"/></svg>
      <span class="btn login">Log In</span><span class="btn watch">Watch TV</span>
    </div>
  </header>
  <section class="head">
    ${a.section ? `<span class="pill">${esc(a.section)}</span>` : ''}
    <h1>${esc(a.headline)}</h1>
    ${a.dek ? `<div class="dek">${esc(a.dek)}</div>` : ''}
    <div class="byline">By ${byJoined}<span class="mid">&#183;</span><b>Fox News</b></div>
    ${dates ? `<div class="dates">${dates}</div>` : ''}
  </section>
  <div class="row">
    <main>
      <div class="shares">
        <span class="pillbtn"><svg width="16" height="15" viewBox="0 0 16 15"><path d="M8 1C4 1 1 3.4 1 6.5c0 1.7.9 3.2 2.4 4.2L2.7 14l3.5-2.1c.6.1 1.2.2 1.8.2 4 0 7-2.5 7-5.6S12 1 8 1z" fill="#fff"/></svg>Comments</span>
        <span class="circle" style="background:#3b5998"><svg width="10" height="18" viewBox="0 0 10 18"><path d="M6.5 18v-8h2.7l.4-3.1H6.5V4.9c0-.9.3-1.5 1.6-1.5H9.7V.6C9.4.6 8.4.5 7.3.5 4.9.5 3.3 1.9 3.3 4.6v2.3H.6V10h2.7v8z" fill="#fff"/></svg></span>
        <span class="circle" style="background:#000"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 1h4.2l3.3 4.5L12.4 1h2.1L9.4 6.8 15 15h-4.2L7.2 10.1 3 15H.9l5.3-6.1z" fill="#fff"/></svg></span>
        <span class="circle" style="background:#e12828"><svg width="16" height="16" viewBox="0 0 16 16"><path d="M1 1h14v4.7H10.3v4.6H5.7V15H1z" fill="#fff"/></svg></span>
        <span class="circle" style="background:#003366"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#fff" stroke-width="1.6"><path d="M4.5 6V1.5h9V6"/><rect x="1.5" y="6" width="15" height="7" rx="1.5"/><path d="M4.5 11h9v5.5h-9z" fill="#003366"/></svg></span>
        <span class="circle" style="background:#003366"><svg width="18" height="14" viewBox="0 0 18 14" fill="none" stroke="#fff" stroke-width="1.6"><rect x="1" y="1" width="16" height="12" rx="1.5"/><path d="m1.5 2 7.5 6 7.5-6"/></svg></span>
        <span class="pillbtn"><svg width="12" height="12" viewBox="0 0 12 12"><path d="M6 1v10M1 6h10" stroke="#fff" stroke-width="1.6"/></svg>Add Fox News on Google</span>
      </div>
      ${photoBox(photos.hero?.src, slots.hero, 'margin-top:40px')}
      ${photos.hero ? `<div class="credit">(${esc(photos.hero.credit)})</div>` : ''}
      <div class="body">${a.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}</div>
    </main>
    <aside class="rail">
      ${rail.length ? `<h3>More From Fox News</h3>${rail.slice(0, 4).map((r, i) => `
      <div class="card"><div class="img">${photoBox(photos.thumbs[i], slots.thumbs[i])}<img class="badge" src="/news/fox.webp" alt=""/></div><h4>${esc(r.title)} | Fox News</h4></div>`).join('')}` : ''}
    </aside>
  </div>
</div>`;
  return {
    css: CSS,
    html,
    fontsHref: 'https://fonts.googleapis.com/css2?family=Roboto+Condensed:wght@700&family=Roboto:wght@300;400;500;700&display=swap',
  };
}
