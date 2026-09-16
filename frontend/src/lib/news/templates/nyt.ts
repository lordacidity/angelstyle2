import type { NewsArticle, RailItem } from '../types';
import { esc, partsIn, photoBox, PHOTO_SLOTS, PLACEHOLDER_CSS, type PagePhotos, type RenderedPage } from './shared';

// New York Times article page. Layout from the approved mockup, reduced to
// what the Times' own feed gives: headline, summary, byline and date. The
// LIVE tag shows only on the Times' live pages; there is no article text.

const AP_MONTHS = ['Jan.', 'Feb.', 'March', 'April', 'May', 'June', 'July', 'Aug.', 'Sept.', 'Oct.', 'Nov.', 'Dec.'];

function nytDate(a: NewsArticle): string | null {
  if (a.publishedDate) {
    const [y, m, d] = a.publishedDate.split('-').map(Number);
    return `${AP_MONTHS[m - 1]} ${d}, ${y}`;
  }
  if (a.publishedAt) {
    const p = partsIn(a.publishedAt, 'America/New_York');
    return `${AP_MONTHS[p.month - 1]} ${p.day}, ${p.year}`;
  }
  return null;
}

const NAV = ['World', 'U.S.', 'Politics', 'New York', 'Business', 'Opinion', 'Arts', 'Sports'];

const CSS = `
.np { --ink: #121212; --grey: #5a5a5a; --line: #e2e2e2; --red: #d0021b;
  width: 1440px; background: #fff; color: var(--ink); font-family: "Libre Franklin", Arial, sans-serif; -webkit-font-smoothing: antialiased; padding-bottom: 90px; }
* { box-sizing: border-box; }
.top { position: relative; height: 50px; border-bottom: 1px solid var(--line); }
.top .icons { position: absolute; left: 24px; top: 16px; display: flex; gap: 32px; }
.top .logo { position: absolute; left: 50%; top: 11px; width: 230px; margin-left: -115px; display: block; }
.top .account { position: absolute; right: 24px; top: 15px; font-size: 14px; color: #333; display: flex; align-items: center; gap: 8px; }
.sub { position: relative; height: 64px; border-bottom: 1px solid var(--line); display: flex; align-items: center; justify-content: center; }
.sub .t { position: absolute; left: 27px; top: 18px; height: 28px; }
.sub nav { display: flex; align-items: center; gap: 26px; font-size: 15px; }
.sub nav b { font-size: 16px; font-weight: 700; }
.sub nav .div { width: 1px; height: 20px; background: #c7c7c7; margin: 0 -8px; }
.col { width: 705px; margin: 44px auto 0; }
.live { display: flex; align-items: center; gap: 12px; font-size: 14px; color: var(--red); margin-bottom: 12px; }
.live b { background: var(--red); color: #fff; font-weight: 700; padding: 6px 8px 5px; border-radius: 2px; letter-spacing: .3px; }
h1 { margin: 0; font: 700 47px/54px Newsreader, Georgia, serif; letter-spacing: -.4px; }
.dek { margin-top: 22px; font: 23.5px/35px Georgia, serif; color: #363636; }
.by { margin-top: 26px; font-size: 15px; line-height: 20px; }
.by b { font-weight: 700; }
.date { margin-top: 4px; font-size: 13px; color: var(--grey); }
.actions { display: flex; gap: 14px; margin-top: 20px; }
.pillb { height: 38px; border: 1px solid #dfdfdf; border-radius: 19px; display: inline-flex; align-items: center; gap: 8px; padding: 0 13px; font-size: 13px; }
.circ { width: 38px; height: 38px; border: 1px solid #dfdfdf; border-radius: 50%; display: grid; place-items: center; }
.credit { margin-top: 8px; font-size: 12px; line-height: 16px; color: var(--grey); letter-spacing: .1px; }
${PLACEHOLDER_CSS}
`;

export function renderNyt(a: NewsArticle, _rail: RailItem[], _now: Date, photos: PagePhotos): RenderedPage {
  const names = a.authors.length ? a.authors : [a.byline.replace(/^By\s+/i, '')];
  const byNames = names.map(n => `<b>${esc(n)}</b>`);
  const byJoined = byNames.length <= 1 ? byNames.join('') : `${byNames.slice(0, -1).join(', ')} and ${byNames[byNames.length - 1]}`;
  const date = nytDate(a);
  const nav = NAV.filter(n => n !== a.section);

  const html = `
<div class="np">
  <header class="top">
    <div class="icons">
      <svg width="18" height="16" viewBox="0 0 18 16"><path d="M0 2h18M0 8h18M0 14h18" stroke="#121212" stroke-width="2.4"/></svg>
      <svg width="17" height="17" viewBox="0 0 17 17" fill="none" stroke="#121212" stroke-width="2.4"><circle cx="6.8" cy="6.8" r="5"/><path d="m10.5 10.5 5.3 5.3"/></svg>
    </div>
    <img class="logo" src="/news/nyt.png" alt="The New York Times"/>
    <div class="account">Account <svg width="10" height="6" viewBox="0 0 10 6"><path d="m1 1 4 4 4-4" stroke="#999" fill="none" stroke-width="1.2"/></svg></div>
  </header>
  <div class="sub">
    <img class="t" src="/news/nyt-t.png" alt=""/>
    <nav>${a.section ? `<b>${esc(a.section)}</b><span class="div"></span>` : ''}${nav.map(n => `<span>${esc(n)}</span>`).join('')}</nav>
  </div>
  <article class="col">
    ${a.live ? `<div class="live"><b>LIVE</b></div>` : ''}
    <h1>${esc(a.headline)}</h1>
    ${a.dek ? `<div class="dek">${esc(a.dek)}</div>` : ''}
    <div class="by">By ${byJoined}</div>
    ${date ? `<div class="date">${date}</div>` : ''}
    <div class="actions">
      <span class="pillb"><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="#121212" stroke-width="1.3"><rect x="2" y="6" width="14" height="4"/><path d="M3 10v7h12v-7M9 6v11"/><path d="M9 6C7.5 2 4.5 2.5 5 4.5 5.3 5.7 9 6 9 6zM9 6c1.5-4 4.5-3.5 4-1.5C12.7 5.7 9 6 9 6z"/></svg>Share full article</span>
      <span class="circ"><svg width="20" height="16" viewBox="0 0 20 16" fill="none" stroke="#121212" stroke-width="1.4"><path d="M12 1l7 6-7 6V9.5C6.5 9.5 3.5 11 1 15c.8-6 4-9.5 11-10z"/></svg></span>
      <span class="circ"><svg width="13" height="17" viewBox="0 0 13 17" fill="none" stroke="#121212" stroke-width="1.4"><path d="M1 1h11v15l-5.5-4L1 16z"/></svg></span>
    </div>
    ${photoBox(photos.hero?.src, PHOTO_SLOTS.nyt.hero, 'margin-top:36px')}
    ${photos.hero ? `<div class="credit">Credit...${esc(photos.hero.credit)}</div>` : ''}
  </article>
</div>`;
  return {
    css: CSS,
    html,
    fontsHref: 'https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,700&family=Libre+Franklin:wght@400;500;600;700&display=swap',
  };
}
