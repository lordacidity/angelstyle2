// One-off look at the running app: open a URL and print what the DOM has.
//   node probe.mjs <cdpPort> <url> "<js expression>"
const [, , port, url, expr] = process.argv;
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
await send('Page.enable');
await send('Runtime.enable');
await send('Emulation.setDeviceMetricsOverride', { width: 1500, height: 1000, deviceScaleFactor: 1, mobile: false });
await send('Page.navigate', { url });
await wait(6000);
const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true });
console.log(r.exceptionDetails ? 'ERR ' + r.exceptionDetails.text + ' ' + (r.exceptionDetails.exception?.description ?? '') : JSON.stringify(r.result.value, null, 1));
process.exit(0);
