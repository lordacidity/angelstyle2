import type { NewsArticle, RailItem } from '../types';
import { agoShort, esc, MONTH_SHORT, partsIn, photoBox, PHOTO_SLOTS, PLACEHOLDER_CSS, type PagePhotos, type RenderedPage } from './shared';

// ESPN story page. Layout from the approved mockup; every word of article text
// comes from the NewsArticle, and the left column lists the story itself plus
// ESPN's latest real headlines.

function espnDate(iso: string): string {
  const p = partsIn(iso, 'America/New_York');
  return `${MONTH_SHORT[p.month - 1]} ${p.day}, ${p.year}, ${p.hour.padStart(2, '0')}:${p.minute} ${p.dayPeriod} ET`;
}

const CSS = `
.np { --red: #d00; --bar: #2b2c2d; --page: #e8e9ea; --rail: #f4f5f6; --ink: #121213; --muted: #6c6d6f; --line: #dcdddf;
  width: 1440px; background: var(--page); font-family: Roboto, Arial, sans-serif; color: var(--ink); -webkit-font-smoothing: antialiased; padding-bottom: 60px; }
* { box-sizing: border-box; }
.top { position: relative; height: 60px; background: var(--bar); }
.brand { position: absolute; left: 0; top: 0; height: 60px; width: 236px; background: var(--red); clip-path: polygon(0 0, 100% 0, 88% 100%, 0 100%); display: flex; align-items: center; gap: 30px; padding-left: 22px; }
.burger { width: 27px; display: grid; gap: 6px; }
.burger i { display: block; height: 3px; background: #fff; border-radius: 1px; }
.logo { display: block; width: 108px; height: auto; }
.top-icons { position: absolute; right: 26px; top: 0; height: 60px; display: flex; align-items: center; gap: 26px; }
.nav { height: 60px; background: #fff; display: flex; align-items: center; box-shadow: 0 1px 0 var(--line), 0 2px 4px rgba(0,0,0,.08); position: relative; z-index: 1; }
.league { display: flex; align-items: center; gap: 14px; padding: 0 22px 0 20px; height: 34px; border-right: 1px solid var(--line); }
.league b { font-size: 18px; font-weight: 700; letter-spacing: .2px; }
.links { display: flex; gap: 21px; padding-left: 20px; font-size: 17px; font-weight: 300; color: #222; }
.links span { display: inline-flex; align-items: center; gap: 4px; }
.wrap { width: 1308px; margin: 16px auto 0; display: flex; align-items: stretch; }
.rail { width: 400px; background: var(--rail); }
.story { padding: 18px 30px 20px; border-bottom: 1px solid var(--line); border-left: 5px solid transparent; }
.story.on { background: #fff; border-left-color: var(--red); }
.story h3 { margin: 0 0 8px; font-size: 17px; line-height: 22px; font-weight: 700; }
.meta { font: 12.5px/1 Georgia, serif; color: var(--muted); letter-spacing: 1.4px; text-transform: uppercase; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.meta em { font: 13px Roboto, Arial, sans-serif; letter-spacing: 0; text-transform: none; font-style: normal; margin-left: 6px; }
.meta em.solo { margin-left: 0; }
.rail-head { padding: 26px 30px 12px 35px; font: 700 13px/1 Roboto, Arial, sans-serif; letter-spacing: 1.2px; text-transform: uppercase; color: #48494b; border-bottom: 1px solid var(--line); }
.main { flex: 1; background: #fff; padding: 30px 54px 60px; }
h1 { margin: 0 0 26px; font-size: 50px; line-height: 58px; font-weight: 700; letter-spacing: -.3px; max-width: 800px; }
.credit { margin-top: 10px; font-size: 13px; line-height: 18px; color: var(--muted); }
.by { margin-top: 40px; font-size: 16px; font-weight: 500; }
.when { margin-top: 6px; font-size: 14px; color: var(--muted); }
.body { margin-top: 30px; width: 800px; font: 22px/35px Georgia, serif; color: #1d1d1e; }
.body p { margin: 0 0 28px; }
${PLACEHOLDER_CSS}
`;

const CHEVRON = `<svg width="10" height="6" viewBox="0 0 10 6"><path d="m1 1 4 4 4-4" stroke="#222" fill="none" stroke-width="1.4"/></svg>`;

export function renderEspn(a: NewsArticle, rail: RailItem[], now: Date, photos: PagePhotos): RenderedPage {
  const league = a.section ?? 'ESPN';
  const firstMeta = [a.publishedAt ? agoShort(a.publishedAt, now) : null, a.byline || null].filter(Boolean).join(' - ');
  const railStory = (r: RailItem) => `
    <div class="story"><h3>${esc(r.title)}</h3>${r.publishedAt ? `<div class="meta"><em class="solo">${agoShort(r.publishedAt, now)}</em></div>` : ''}</div>`;
  const firstGroup = rail.slice(0, 3).map(railStory).join('');
  const rest = rail.slice(3);

  const html = `
<div class="np">
  <header class="top">
    <div class="brand"><div class="burger"><i></i><i></i><i></i></div><img class="logo" src="/news/espn.png" alt="ESPN"/></div>
    <div class="top-icons">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2"><circle cx="10" cy="10" r="7"/><path d="M15.5 15.5 22 22"/></svg>
      <svg width="26" height="26" viewBox="0 0 26 26"><circle cx="13" cy="13" r="12" fill="#fff"/><circle cx="13" cy="10" r="4.2" fill="#2b2c2d"/><path d="M5.5 21c1.6-3.6 4.4-5.4 7.5-5.4s5.9 1.8 7.5 5.4" fill="#2b2c2d"/></svg>
    </div>
  </header>
  <nav class="nav">
    <div class="league">
      <svg width="24" height="30" viewBox="0 0 26 32"><path d="M13 1 2 4v13c0 8 5.5 12 11 14 5.5-2 11-6 11-14V4z" fill="#fff" stroke="#48494b" stroke-width="2"/><path d="M4 11h18v6c0 6-4 9.5-9 11.3C8 26.5 4 23 4 17z" fill="#48494b"/></svg>
      <b>${esc(league)}</b>
    </div>
    <div class="links">
      <span>Home</span><span>Scores</span><span>Schedule ${CHEVRON}</span><span>Standings</span><span>Stats</span><span>Teams</span><span>Odds</span><span>More ${CHEVRON}</span>
    </div>
  </nav>
  <div class="wrap">
    <aside class="rail">
      <div class="story on"><h3>${esc(a.headline)}</h3>${firstMeta ? `<div class="meta">${esc(league)} <em>${esc(firstMeta)}</em></div>` : ''}</div>
      ${firstGroup}
      ${rest.length ? `<div class="rail-head">Latest</div>${rest.map(railStory).join('')}` : ''}
    </aside>
    <main class="main">
      <h1>${esc(a.headline)}</h1>
      ${photoBox(photos.hero?.src, PHOTO_SLOTS.espn.hero)}
      ${photos.hero ? `<div class="credit">${esc(photos.hero.credit)}</div>` : ''}
      <div class="by">${esc(a.byline)}</div>
      ${a.publishedAt ? `<div class="when">${espnDate(a.publishedAt)}</div>` : ''}
      <div class="body">${a.paragraphs.map(p => `<p>${esc(p)}</p>`).join('')}</div>
    </main>
  </div>
</div>`;
  return {
    css: CSS,
    html,
    fontsHref: 'https://fonts.googleapis.com/css2?family=Roboto:wght@300;400;500;700&display=swap',
  };
}
