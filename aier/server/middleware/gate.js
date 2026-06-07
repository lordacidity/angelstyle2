import crypto from 'node:crypto';

// Site password gate for Aier (the public Railway backend). Aier is a SEPARATE origin from
// Studio, so the money-spending endpoints here must be protected independently — a password
// on the Vercel app alone does nothing for `ai.<domain>/api/generate`.
//
// Two ways in:
//   1. A one-time `?t=<token>` handoff minted by Studio (already-unlocked users land straight
//      in — no retype). Verified with the shared AUTH_SECRET.
//   2. The shared SITE_PASSWORD typed into the unlock page served below.
// Either sets a long-lived signed `aier_auth` cookie checked on every request.
//
// The token scheme MUST match frontend/src/lib/auth.ts (HMAC-SHA256 over the base64url
// payload string). Fail-open if SITE_PASSWORD is unset so a misconfig can't lock you out.

const COOKIE_NAME = 'aier_auth';
const SITE_SCOPE = 'aier'; // Aier's own session cookie
const HANDOFF_SCOPE = 'handoff'; // token minted by Studio
const COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function b64urlToBuf(s) {
  const t = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = t.length % 4 ? '='.repeat(4 - (t.length % 4)) : '';
  return Buffer.from(t + pad, 'base64');
}
export function signToken(payload, secret) {
  const payloadB64 = b64url(Buffer.from(JSON.stringify(payload), 'utf8'));
  const sig = crypto.createHmac('sha256', secret).update(payloadB64).digest();
  return `${payloadB64}.${b64url(sig)}`;
}
export function verifyToken(token, secret, scope) {
  if (!token || !secret) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  try {
    const expected = crypto.createHmac('sha256', secret).update(payloadB64).digest();
    const got = b64urlToBuf(sigB64);
    if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) return null;
    const payload = JSON.parse(b64urlToBuf(payloadB64).toString('utf8'));
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    if (scope && payload.scope !== scope) return null;
    return payload;
  } catch {
    return null;
  }
}
function parseCookies(header) {
  const out = {};
  (header || '').split(';').forEach((p) => {
    const i = p.indexOf('=');
    if (i > 0) out[p.slice(0, i).trim()] = decodeURIComponent(p.slice(i + 1).trim());
  });
  return out;
}
function setAuthCookie(res, token, secure) {
  const parts = [
    `${COOKIE_NAME}=${token}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    `Max-Age=${Math.floor(COOKIE_TTL_MS / 1000)}`,
  ];
  if (secure) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

const UNLOCK_HTML = (err) => `<!doctype html><html lang="en"><head>
<meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Enter password</title>
<style>
  :root { color-scheme: dark; }
  body { margin:0; min-height:100vh; display:flex; align-items:center; justify-content:center;
    background:#09090b; font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif; }
  form { width:100%; max-width:22rem; margin:1rem; padding:2rem; border:1px solid #27272a;
    border-radius:1rem; background:rgba(24,24,27,.6); display:flex; flex-direction:column; gap:1rem; }
  h1 { color:#fff; font-size:1.125rem; margin:0; text-align:center; }
  p.sub { color:#71717a; font-size:.875rem; margin:0; text-align:center; }
  input { width:100%; box-sizing:border-box; padding:.625rem .75rem; border-radius:.5rem;
    border:1px solid #3f3f46; background:#09090b; color:#fff; font-size:.875rem; outline:none; }
  input:focus { border-color:#71717a; }
  button { width:100%; padding:.625rem; border:0; border-radius:.5rem; background:#fff;
    color:#09090b; font-size:.875rem; font-weight:500; cursor:pointer; }
  button:disabled { opacity:.4; cursor:default; }
  .err { color:#f87171; font-size:.875rem; margin:0; }
</style></head><body>
<form id="f">
  <h1>Enter password</h1>
  <p class="sub">This site is private.</p>
  <input id="p" type="password" placeholder="Password" autofocus autocomplete="current-password">
  <p class="err" id="e" style="display:${err ? 'block' : 'none'}">${err || ''}</p>
  <button id="b" type="submit">Unlock</button>
</form>
<script>
  const f=document.getElementById('f'),p=document.getElementById('p'),e=document.getElementById('e'),b=document.getElementById('b');
  f.addEventListener('submit', async (ev)=>{
    ev.preventDefault(); b.disabled=true; e.style.display='none';
    try{
      const r=await fetch('/unlock',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({password:p.value})});
      if(r.ok){ location.href='/'; return; }
      e.textContent='Incorrect password'; e.style.display='block'; b.disabled=false;
    }catch(_){ e.textContent='Something went wrong'; e.style.display='block'; b.disabled=false; }
  });
</script></body></html>`;

export function gate() {
  const PASSWORD = process.env.SITE_PASSWORD;
  const SECRET = process.env.AUTH_SECRET || '';
  const isProd = process.env.NODE_ENV === 'production';
  // Disabled unless BOTH are set — fail-open so a partial misconfig can't lock you out.
  const disabled = !PASSWORD || !SECRET;

  if (disabled) {
    console.warn('  ⚠ SITE_PASSWORD/AUTH_SECRET not both set — Aier is UNGATED (anyone can reach the API).');
  }

  return (req, res, next) => {
    if (disabled) return next();

    // Railway healthcheck has no cookie — always allow it.
    if (req.path === '/api/health') return next();

    const cookies = parseCookies(req.headers.cookie);

    // 1) Valid session cookie.
    if (verifyToken(cookies[COOKIE_NAME], SECRET, SITE_SCOPE)) return next();

    // 2) One-time handoff token from Studio (?t=...).
    const t = req.query.t;
    if (t && verifyToken(String(t), SECRET, HANDOFF_SCOPE)) {
      setAuthCookie(res, signToken({ scope: SITE_SCOPE, exp: Date.now() + COOKIE_TTL_MS }, SECRET), isProd);
      const clean = req.path === '/unlock' ? '/' : (req.originalUrl.split('?')[0] || '/');
      return res.redirect(clean);
    }

    // 3) Unlock form submit.
    if (req.method === 'POST' && req.path === '/unlock') {
      const submitted = req.body && typeof req.body.password === 'string' ? req.body.password : '';
      const a = Buffer.from(submitted);
      const bpw = Buffer.from(PASSWORD);
      if (a.length === bpw.length && crypto.timingSafeEqual(a, bpw)) {
        setAuthCookie(res, signToken({ scope: SITE_SCOPE, exp: Date.now() + COOKIE_TTL_MS }, SECRET), isProd);
        return res.json({ ok: true });
      }
      return res.status(401).json({ error: 'wrong password' });
    }

    // 4) Blocked: JSON 401 for API/media, the unlock page for browser navigations.
    if (req.path.startsWith('/api/') || req.path.startsWith('/media/')) {
      return res.status(401).json({ error: 'locked' });
    }
    return res.status(200).type('html').send(UNLOCK_HTML());
  };
}
