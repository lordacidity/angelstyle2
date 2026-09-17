// Drives Studio > News in a real browser: type a name, search, pick the first
// result from the outlet asked for, wait for the page to be drawn, and save the
// PNG the section made.
//   node drive.mjs <cdpPort> <appPort> <outlet> <name> <out.png>
import { writeFileSync } from 'node:fs';

const [, , port, app, outlet, name, out] = process.argv;
const wait = ms => new Promise(r => setTimeout(r, ms));

const tab = await (await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: 'PUT' })).json();
const ws = new WebSocket(tab.webSocketDebuggerUrl);
let id = 0;
const waiting = new Map();
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data);
  if (m.id && waiting.has(m.id)) {
    const { resolve, reject } = waiting.get(m.id);
    waiting.delete(m.id);
    m.error ? reject(new Error(m.error.message)) : resolve(m.result);
  }
});
await new Promise((res, rej) => { ws.addEventListener('open', res); ws.addEventListener('error', rej); });
const send = (method, params = {}) => new Promise((resolve, reject) => {
  const n = ++id;
  waiting.set(n, { resolve, reject });
  ws.send(JSON.stringify({ id: n, method, params }));
});
const evalIn = async (expression, awaitPromise = false) => {
  const r = await send('Runtime.evaluate', { expression, awaitPromise, returnByValue: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? ''));
  return r.result.value;
};

await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url: `http://127.0.0.1:${app}/news` });
await wait(3000);

// Wait for React to put the section on the page.
for (let i = 0; i < 40; i++) {
  const ready = await evalIn(`!!document.querySelector('input[type="search"], input[placeholder]')`);
  if (ready) break;
  await wait(1000);
}
console.log('section up:', await evalIn(`document.querySelectorAll('input').length + ' inputs'`));

// Only the outlet under test, the name typed in, then Search.
await evalIn(`(() => {
  const setup = { query: ${JSON.stringify(name)}, outlets: [${JSON.stringify(outlet)}], range: '30d', nameInTitle: false };
  localStorage.setItem('studio-news-setup-v1', JSON.stringify(setup));
})()`);
await send('Page.navigate', { url: `http://127.0.0.1:${app}/news` });
await wait(4000);
for (let i = 0; i < 40; i++) {
  if (await evalIn(`!!document.querySelector('input')`)) break;
  await wait(1000);
}

const clicked = await evalIn(`(() => {
  const btn = [...document.querySelectorAll('button')].find(b => /^search$/i.test(b.textContent.trim()));
  if (!btn) return 'no search button';
  btn.click();
  return 'searching';
})()`);
console.log(clicked);

let results = 0;
for (let i = 0; i < 60; i++) {
  results = await evalIn(`document.querySelectorAll('[data-hit], li button, article button').length`);
  const pickable = await evalIn(`[...document.querySelectorAll('button')].filter(b => /use this one/i.test(b.textContent)).length`);
  if (pickable > 0) { console.log('results listed'); break; }
  await wait(1000);
}

const picked = await evalIn(`(() => {
  const b = [...document.querySelectorAll('button')].find(b => /use this one/i.test(b.textContent));
  if (!b) return 'no pick button (' + document.body.innerText.slice(0, 200) + ')';
  b.click();
  return 'picked';
})()`);
console.log(picked);

// The page PNG lands in an <img> once it is drawn.
let ok = false;
for (let i = 0; i < 120; i++) {
  const state = await evalIn(`(() => {
    const img = [...document.querySelectorAll('img')].find(i => i.src.startsWith('blob:') && i.naturalWidth > 800);
    return img ? 'png ' + img.naturalWidth + 'x' + img.naturalHeight : (document.body.innerText.match(/(Finding photos|Drawing the page|Reading the story)[^\\n]*/) || ['waiting'])[0];
  })()`);
  if (String(state).startsWith('png')) { console.log(state); ok = true; break; }
  if (i % 5 === 0) console.log(' ', state);
  await wait(1000);
}
if (!ok) { console.log('the page was never drawn'); console.log(await evalIn(`document.body.innerText.slice(0, 900)`)); process.exit(2); }

// Save the PNG the section made.
const dataUrl = await evalIn(`(async () => {
  const img = [...document.querySelectorAll('img')].find(i => i.src.startsWith('blob:') && i.naturalWidth > 800);
  const blob = await (await fetch(img.src)).blob();
  return await new Promise(r => { const f = new FileReader(); f.onload = () => r(String(f.result)); f.readAsDataURL(blob); });
})()`, true);
writeFileSync(out, Buffer.from(String(dataUrl).split(',')[1], 'base64'));
console.log('wrote', out);
process.exit(0);
