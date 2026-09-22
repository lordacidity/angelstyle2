import type { NewsArticle, RailItem } from '../types';
import { bodyHtml, esc, MONTH_LONG, partsIn, PHOTO_SLOTS, photoBox, PLACEHOLDER_CSS, wasUpdated, type PagePhotos, type RenderedPage } from './shared';

// People article page. Layout from the screenshot of the real page: the
// wordmark, the section nav, the yellow "Top Stories" strip, then the story in
// a wide heading with a narrow measure under it and more of People's own
// headlines down the right.
//
// The real page carries a leaderboard ad over the headline and a column of ads
// beside the story; both are left out, and the right column carries more Top
// Stories instead. The comment count under the byline is left off as well: it
// can't be read from the story, and nothing on the page is invented. The NEED
// TO KNOW box is drawn only when People put one on the article, with People's
// own bullets.

/** "September 16, 2026 07:05PM EDT", the way People stamps a story. */
function peopleStamp(iso: string): string {
  const p = partsIn(iso, 'America/New_York');
  return `${MONTH_LONG[p.month - 1]} ${p.day}, ${p.year} ${p.hour.padStart(2, '0')}:${p.minute}${p.dayPeriod} ${p.tz}`;
}

const NAV = ['Entertainment', 'Crime', 'Human Interest', 'Lifestyle', 'Royals', 'Health', 'Shopping'];

const CARET = `<svg width="9" height="6" viewBox="0 0 9 6"><path d="M0 0h9L4.5 6z" fill="#101010"/></svg>`;

const CSS = `
.np { --blue: #20b1ea; --ink: #101010; --grey: #767676; --line: #e3e3e3; --yellow: #fff100;
  width: 1440px; background: #fff; color: var(--ink); font-family: Figtree, Arial, sans-serif; -webkit-font-smoothing: antialiased; padding-bottom: 90px; }
* { box-sizing: border-box; }
.bar { width: 1248px; margin: 0 auto; }
.top { display: flex; align-items: center; height: 88px; }
.top .logo { width: 122px; display: block; }
.tools { margin-left: auto; display: flex; align-items: center; gap: 22px; font-size: 15px; }
.tools .sep { width: 1px; height: 22px; background: var(--line); }
.tools span { display: inline-flex; align-items: center; gap: 7px; }
.nav { display: flex; align-items: center; height: 58px; font-size: 14px; font-weight: 700; letter-spacing: .6px; text-transform: uppercase; }
.nav .item { margin-right: 32px; }
.nav .sub { margin-left: auto; display: flex; align-items: center; gap: 14px; }
.nav .pipe { color: #c8c8c8; font-weight: 400; }
.nav .get { background: var(--yellow); height: 34px; display: flex; align-items: center; padding: 0 12px 0 10px; }
.nav .app { width: 52px; height: 52px; border-radius: 50%; background: var(--blue); color: #fff; display: grid; place-items: center; font-size: 19px; font-weight: 800; letter-spacing: -.3px; margin-left: -14px; }
.rule { height: 1px; background: var(--line); }
.strip { padding: 16px 0 18px; }
.tag { position: relative; display: inline-block; font-size: 22px; font-weight: 800; letter-spacing: -.4px; padding: 1px 9px 2px; background: var(--yellow); }
.tag i { position: absolute; right: -7px; bottom: -6px; width: 0; height: 0; border-left: 8px solid #e01b00; border-bottom: 7px solid transparent; transform: rotate(8deg); }
.tops { display: flex; margin-top: 14px; }
.tops .cell { width: 312px; display: flex; padding-right: 20px; }
.tops .cell + .cell { border-left: 1px solid var(--line); padding-left: 20px; width: 332px; }
.shot { position: relative; flex: none; }
.rank { position: absolute; left: 0; bottom: 0; min-width: 20px; height: 19px; padding: 0 5px; background: #fff; color: var(--blue); font-size: 14px; font-weight: 700; line-height: 19px; }
.tops h4 { margin: 0 0 0 12px; font-size: 15.5px; line-height: 22px; font-weight: 400; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; max-height: 88px; }
.row { display: flex; padding-top: 30px; }
.main { width: 800px; margin-left: 200px; }
h1 { margin: 0; font-size: 46px; line-height: 50px; font-weight: 800; letter-spacing: -.6px; }
.dek { margin-top: 16px; width: 600px; font-size: 17.5px; line-height: 25px; }
.by { margin-top: 18px; font-size: 15px; display: flex; align-items: center; gap: 9px; }
.by b { font-weight: 600; text-decoration: underline; text-underline-offset: 3px; }
.by .pipe { color: #c8c8c8; }
.by .when { color: #5a5a5a; font-size: 14.5px; }
.hero { margin-top: 26px; }
.credit { margin-top: 7px; width: 600px; font-size: 12.5px; line-height: 17px; color: var(--grey); }
.know { position: relative; width: 600px; margin: 34px 0 6px; }
.know .hatch { position: absolute; left: 9px; top: 9px; right: -9px; bottom: -9px; background: repeating-linear-gradient(135deg, #1a1a1a 0 1px, #fff 1px 4px); }
.know .box { position: relative; border: 1px solid #1a1a1a; background: #fff; padding: 34px 26px 26px; }
.know .head { position: absolute; top: -10px; left: 0; right: 0; text-align: center; }
.know .head span { background: #fff; padding: 0 16px; font-size: 16px; font-weight: 700; letter-spacing: 2px; }
.know ul { margin: 0; padding: 0; list-style: none; }
.know li { position: relative; padding-left: 20px; font-size: 19px; line-height: 27px; }
.know li + li { margin-top: 18px; }
.know li i { position: absolute; left: 0; top: 10px; width: 6px; height: 6px; border-radius: 50%; background: var(--blue); }
.body { width: 600px; margin-top: 30px; font-size: 19.5px; line-height: 27px; }
.body p { margin: 0 0 26px; }
.body h2 { margin: 32px 0 14px; font-size: 26px; line-height: 31px; font-weight: 800; letter-spacing: -.4px; }
.body ul, .body ol { margin: 0 0 26px; padding-left: 24px; }
.body li { margin: 0 0 8px; }
.body blockquote { margin: 0 0 26px; padding-left: 18px; border-left: 3px solid var(--blue); font-style: italic; }
.rail { width: 300px; margin-left: 44px; }
.rail .tag { font-size: 19px; }
.lead { margin-top: 16px; padding-bottom: 20px; border-bottom: 1px solid var(--line); }
.lead h4 { margin: 12px 0 0; font-size: 20px; line-height: 26px; font-weight: 700; letter-spacing: -.2px; }
.more { display: flex; padding: 18px 0; border-bottom: 1px solid var(--line); }
.more h4 { margin: 0 0 0 12px; font-size: 15.5px; line-height: 21px; font-weight: 400; display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; max-height: 84px; }
${PLACEHOLDER_CSS}
`;

export function renderPeople(a: NewsArticle, rail: RailItem[], _now: Date, photos: PagePhotos): RenderedPage {
  const slots = PHOTO_SLOTS.people;
  const stamp = a.publishedAt
    ? (wasUpdated(a.publishedAt, a.updatedAt) ? `Updated on ${peopleStamp(a.updatedAt!)}` : `Published on ${peopleStamp(a.publishedAt)}`)
    : '';
  const tops = rail.slice(0, 4);
  // The strip takes the first four headlines, the right column the next five.
  const more = rail.slice(4, 9);

  const html = `
<div class="np">
  <div class="bar">
    <header class="top">
      <img class="logo" src="/news/people.png" alt="People"/>
      <div class="tools">
        <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="#101010" stroke-width="1.8"><circle cx="8.5" cy="8.5" r="6"/><path d="m13 13 5 5"/></svg>
        <span><svg width="20" height="20" viewBox="0 0 20 20" fill="#101010"><circle cx="10" cy="10" r="9"/><circle cx="10" cy="8" r="3" fill="#fff"/><path d="M4.5 17a5.5 5.5 0 0 1 11 0z" fill="#fff"/></svg>Log In</span>
        <i class="sep"></i>
        <span>Magazine ${CARET}</span>
        <i class="sep"></i>
        <span>Newsletters</span>
        <span>Sweepstakes</span>
        <svg width="17" height="19" viewBox="0 0 17 19" fill="#101010"><path d="M8.5 0a2 2 0 0 1 2 2 6 6 0 0 1 4 5.6V12l2 3H.5l2-3V7.6A6 6 0 0 1 6.5 2a2 2 0 0 1 2-2zM6 16h5a2.5 2.5 0 0 1-5 0z"/></svg>
      </div>
    </header>
  </div>
  <div class="rule"></div>
  <div class="bar">
    <nav class="nav">
      ${NAV.map(n => `<span class="item">${esc(n)}</span>`).join('')}
      <span class="sub"><span>Subscribe</span><span class="pipe">|</span><span class="get">Get the</span><span class="app">APP</span></span>
    </nav>
  </div>
  <div class="rule"></div>
  ${tops.length ? `<div class="bar strip">
    <span class="tag">Top Stories<i></i></span>
    <div class="tops">
      ${tops.map((r, i) => `<div class="cell"><div class="shot">${photoBox(photos.thumbs[i], slots.thumbs[i])}<span class="rank">${i + 1}</span></div><h4>${esc(r.title)}</h4></div>`).join('')}
    </div>
  </div>` : ''}
  <div class="row">
    <main class="main">
      <h1>${esc(a.headline)}</h1>
      ${a.dek ? `<p class="dek">${esc(a.dek)}</p>` : ''}
      <div class="by">By <b>${esc(a.byline)}</b>${stamp ? `<span class="pipe">|</span><span class="when">${stamp}</span>` : ''}</div>
      <div class="hero">${photoBox(photos.hero?.src, slots.hero)}</div>
      ${photos.hero ? `<div class="credit">${esc(photos.hero.credit)}</div>` : ''}
      ${a.keyPoints.length ? `<div class="know">
        <i class="hatch"></i>
        <div class="box">
          <div class="head"><span>NEED TO KNOW</span></div>
          <ul>${a.keyPoints.map(k => `<li><i></i>${esc(k)}</li>`).join('')}</ul>
        </div>
      </div>` : ''}
      <div class="body">${bodyHtml(a)}</div>
    </main>
    <aside class="rail">
      ${more.length ? `<span class="tag">More Top Stories<i></i></span>
      <div class="lead">${photoBox(photos.thumbs[4], slots.thumbs[4])}<h4>${esc(more[0].title)}</h4></div>
      ${more.slice(1).map((r, i) => `<div class="more"><div class="shot">${photoBox(photos.thumbs[5 + i], slots.thumbs[5 + i])}</div><h4>${esc(r.title)}</h4></div>`).join('')}` : ''}
    </aside>
  </div>
</div>`;
  return {
    css: CSS,
    html,
    fontsHref: 'https://fonts.googleapis.com/css2?family=Figtree:wght@400;600;700;800&display=swap',
  };
}
