import type { NewsArticle, RailItem } from '../types';
import { bodyHtml, esc, initials, MONTH_SHORT, partsIn, PHOTO_SLOTS, photoBox, PLACEHOLDER_CSS, wasUpdated, type PagePhotos, type RenderedPage } from './shared';

// CNN article page. Layout from the approved mockup; the right column lists
// CNN's latest real headlines.

const NAV: Record<string, string[]> = {
  Politics: ['Elections', 'Congress', 'Facts First', 'CNN Polls'],
  Entertainment: ['Movies', 'Television', 'Celebrity'],
  Sport: ['Football', 'Tennis', 'Golf', 'Motorsport'],
  Business: ['Tech', 'Media', 'Markets', 'Calculators'],
  Health: ['Life, But Better', 'Fitness', 'Food', 'Sleep'],
  World: ['Africa', 'Americas', 'Asia', 'Europe', 'Middle East'],
};
const DEFAULT_NAV = ['US', 'World', 'Politics', 'Business', 'Health'];

function cnnDay(iso: string): string {
  const p = partsIn(iso, 'America/New_York');
  return `${MONTH_SHORT[p.month - 1].toUpperCase()} ${p.day}, ${p.year}`;
}

const CHEVRON = `<svg width="11" height="7" viewBox="0 0 11 7"><path d="m1 1 4.5 4.5L10 1" stroke="#0c0c0c" fill="none" stroke-width="1.3"/></svg>`;

const CSS = `
.np { --red: #cc0000; --ink: #0c0c0c; --muted: #6e6e6e; --line: #e6e6e6;
  width: 1440px; background: #fff; color: var(--ink); font-family: Inter, Arial, sans-serif; -webkit-font-smoothing: antialiased; }
* { box-sizing: border-box; }
.container { width: 1250px; margin: 0 auto; }
.header { height: 70px; display: flex; align-items: center; border-bottom: 2px solid var(--ink); }
.burger { width: 20px; display: grid; gap: 4px; margin-right: 26px; }
.burger i { display: block; height: 2px; background: var(--ink); }
.burger i:nth-child(2) { width: 14px; }
.brand { display: flex; align-items: center; gap: 8px; margin-right: 24px; }
.brand img { width: 47px; display: block; }
.brand b { font-size: 18px; font-weight: 700; letter-spacing: -.2px; }
.nav { display: flex; gap: 24px; font-size: 15px; font-weight: 500; }
.nav span { display: inline-flex; align-items: center; gap: 6px; }
.tools { margin-left: auto; display: flex; align-items: center; gap: 24px; font-size: 15px; font-weight: 500; }
.tools span { display: inline-flex; align-items: center; gap: 7px; }
.dot { width: 7px; height: 7px; border-radius: 50%; background: var(--red); }
.btn { font: 700 14px/1 Inter, Arial, sans-serif; padding: 8px 12px; border-radius: 4px; }
.btn.sub { background: var(--red); color: #fff; margin-left: 12px; }
.btn.sign { border: 1px solid var(--line); margin-left: -8px; }
.head { padding-top: 46px; }
.kicker { font-size: 12.5px; letter-spacing: 1px; text-transform: uppercase; font-weight: 600; min-height: 16px; }
h1 { position: relative; margin: 20px 0 0; font-size: 58px; line-height: 68px; font-weight: 700; letter-spacing: -1.2px; max-width: 1180px; }
h1::before { content: ""; position: absolute; left: -95px; top: -3px; bottom: -3px; width: 12px; background: var(--red); }
.updated { margin-top: 34px; font-size: 12px; font-weight: 500; text-transform: uppercase; display: flex; align-items: center; gap: 6px; }
.byline { margin-top: 20px; display: flex; align-items: center; gap: 6px; font-size: 14px; flex-wrap: wrap; }
.avatar { width: 40px; height: 40px; border-radius: 50%; background: #dcdcdc; color: #555; display: grid; place-items: center; font-size: 13px; font-weight: 600; }
.byline a { font-weight: 600; text-decoration: underline; text-underline-offset: 3px; text-decoration-thickness: 1px; }
.row { display: grid; grid-template-columns: 810px 400px; gap: 40px; margin-top: 38px; padding-bottom: 70px; }
.body { width: 602px; margin: 30px 0 0 78px; font: 18.5px/32px "Source Serif 4", Georgia, serif; }
.body p { margin: 0 0 24px; }
.body h2 { margin: 36px 0 16px; font: 700 24px/30px Inter, Arial, sans-serif; letter-spacing: -.3px; color: var(--ink); }
.body ul, .body ol { margin: 0 0 24px; padding-left: 26px; }
.body li { margin: 0 0 8px; }
.body blockquote { margin: 0 0 24px; padding-left: 20px; border-left: 3px solid var(--red); font-style: italic; }
.rail-title { border-top: 2px solid var(--ink); padding-top: 12px; margin: 0 0 16px; font-size: 20px; font-weight: 700; letter-spacing: -.2px; }
.rail-title.second { margin-top: 38px; }
.lead { padding-bottom: 18px; border-bottom: 1px solid var(--line); }
.lead h4 { margin: 12px 0 0; font-size: 18px; line-height: 24px; font-weight: 700; letter-spacing: -.2px; }
.item { display: flex; gap: 14px; padding: 16px 0; border-bottom: 1px solid var(--line); }
.item h5 { margin: 0; font-size: 15px; line-height: 21px; font-weight: 600; }
.text-item { padding: 14px 0; border-bottom: 1px solid var(--line); font-size: 15px; line-height: 21px; font-weight: 600; }
.rail-title + .text-item { padding-top: 0; }
${PLACEHOLDER_CSS}
.lead .np-photo, .item .np-photo, .lead .np-img, .item .np-img { border-radius: 4px; }
.credit { margin-top: 8px; font-size: 12px; line-height: 16px; color: var(--muted); }
`;

export function renderCnn(a: NewsArticle, rail: RailItem[], _now: Date, photos: PagePhotos): RenderedPage {
  const slots = PHOTO_SLOTS.cnn;
  const section = a.section;
  const nav = (section && NAV[section]) || DEFAULT_NAV;
  const dateLine = a.publishedAt
    ? (wasUpdated(a.publishedAt, a.updatedAt) ? `Updated ${cnnDay(a.updatedAt!)}` : `Published ${cnnDay(a.publishedAt)}`)
    : '';
  const names = a.authors.length ? a.authors : [a.byline];
  const byNames = names.map(n => `<a>${esc(n)}</a>`);
  const byJoined = byNames.length <= 1 ? byNames.join('') : `${byNames.slice(0, -1).join(', ')} and ${byNames[byNames.length - 1]}`;
  const lead = rail[0];
  const withThumbs = rail.slice(1, 4);
  const textOnly = rail.slice(4, 11);

  const html = `
<div class="np">
  <div class="container">
    <header class="header">
      <div class="burger"><i></i><i></i><i></i></div>
      <div class="brand"><img src="/news/cnn.png" alt="CNN"/>${section ? `<b>${esc(section)}</b>` : ''}</div>
      <nav class="nav">${nav.map(n => `<span>${esc(n)}</span>`).join('')}<span>More ${CHEVRON}</span></nav>
      <div class="tools">
        <span><i class="dot"></i>Watch</span>
        <span><svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="#0c0c0c" stroke-width="1.5"><path d="M2.5 11V8a5.5 5.5 0 0 1 11 0v3"/><rect x="2" y="9.5" width="3" height="5" rx="1"/><rect x="11" y="9.5" width="3" height="5" rx="1"/></svg>Listen</span>
        <svg width="19" height="19" viewBox="0 0 20 20" fill="none" stroke="#0c0c0c" stroke-width="1.6"><circle cx="8.5" cy="8.5" r="6.5"/><path d="m13.5 13.5 5 5"/></svg>
        <span class="btn sub">Subscribe</span>
        <span class="btn sign">Sign in</span>
      </div>
    </header>
    <section class="head">
      <div class="kicker">${section ? esc(section) : ''}</div>
      <h1>${esc(a.headline)}</h1>
      ${dateLine ? `<div class="updated">${dateLine} ${CHEVRON}</div>` : ''}
      <div class="byline">By <span class="avatar">${esc(initials(names[0] ?? ''))}</span>${byJoined}</div>
    </section>
    <div class="row">
      <main>
        ${photoBox(photos.hero?.src, slots.hero, 'border-radius:6px')}
        ${photos.hero ? `<div class="credit">${esc(photos.hero.credit)}</div>` : ''}
        <div class="body">${bodyHtml(a)}</div>
      </main>
      <aside>
        ${lead ? `<h3 class="rail-title">Latest</h3>
        <div class="lead">${photoBox(photos.thumbs[0], slots.thumbs[0])}<h4>${esc(lead.title)}</h4></div>
        ${withThumbs.map((r, i) => `<div class="item">${photoBox(photos.thumbs[i + 1], slots.thumbs[i + 1])}<h5>${esc(r.title)}</h5></div>`).join('')}` : ''}
        ${textOnly.length ? `<h3 class="rail-title second">More from CNN</h3>${textOnly.map(r => `<div class="text-item">${esc(r.title)}</div>`).join('')}` : ''}
      </aside>
    </div>
  </div>
</div>`;
  return {
    css: CSS,
    html,
    fontsHref: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=Source+Serif+4:opsz,wght@8..60,400&display=swap',
  };
}
