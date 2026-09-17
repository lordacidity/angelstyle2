// Screenshots a rendered news page: opens the HTML in headless Chrome at the
// page's own 1440px width and captures the whole thing.
//   node shoot.mjs <port> <file.html> <out.png> [maxHeight]
import { writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const [, , port, file, out, maxH, scaleArg] = process.argv;
const SCALE = scaleArg ? +scaleArg : 2;

const wait = ms => new Promise(r => setTimeout(r, ms));

async function target(p) {
  const res = await fetch(`http://127.0.0.1:${p}/json/new?about:blank`, { method: 'PUT' });
  return res.json();
}

function open(url) {
  const ws = new WebSocket(url);
  let id = 0;
  const waiting = new Map();
  const events = [];
  ws.addEventListener('message', e => {
    const m = JSON.parse(e.data);
    if (m.id && waiting.has(m.id)) {
      const { resolve, reject } = waiting.get(m.id);
      waiting.delete(m.id);
      m.error ? reject(new Error(m.error.message)) : resolve(m.result);
    } else if (m.method) events.push(m.method);
  });
  const ready = new Promise((res, rej) => {
    ws.addEventListener('open', res);
    ws.addEventListener('error', rej);
  });
  const send = (method, params = {}) => new Promise((resolve, reject) => {
    const n = ++id;
    waiting.set(n, { resolve, reject });
    ws.send(JSON.stringify({ id: n, method, params }));
  });
  return { ready, send, events, close: () => ws.close() };
}

const t = await target(port);
const c = open(t.webSocketDebuggerUrl);
await c.ready;
await c.send('Page.enable');
await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height: 1200, deviceScaleFactor: SCALE, mobile: false });
await c.send('Page.navigate', { url: pathToFileURL(file).href });
await wait(1200);
// Fonts and pictures, then a moment for the layout to settle.
await c.send('Runtime.evaluate', {
  expression: `(async () => { await document.fonts.ready; await Promise.all([...document.images].map(i => i.complete ? 0 : new Promise(r => { i.onload = i.onerror = r; }))); })()`,
  awaitPromise: true,
});
await wait(600);
const { result } = await c.send('Runtime.evaluate', {
  expression: `JSON.stringify({ h: document.documentElement.scrollHeight, w: document.documentElement.scrollWidth })`,
});
const size = JSON.parse(result.value);
const height = Math.min(size.h, maxH ? +maxH : 20000);
console.log('page', size.w + 'x' + size.h, '-> capture 1440x' + height);
await c.send('Emulation.setDeviceMetricsOverride', { width: 1440, height, deviceScaleFactor: SCALE, mobile: false });
await wait(400);
const shot = await Promise.race([
  c.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true }),
  new Promise((_, rej) => setTimeout(() => rej(new Error('captureScreenshot never answered')), 45000)),
]);
writeFileSync(out, Buffer.from(shot.data, 'base64'));
console.log('wrote', out);
c.close();
process.exit(0);
