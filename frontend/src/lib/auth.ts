// Shared HMAC-signed token for the site password gate (middleware + /api/unlock) and the
// Studio→Aier handoff. Uses Web Crypto only, so it runs in BOTH the Edge middleware and
// Node route handlers.
//
// The SAME token scheme is reimplemented in aier/server/middleware/gate.js with node:crypto
// — keep the two in sync. Format:
//   token = base64url(utf8(JSON.stringify(payload))) + "." + base64url(HMAC_SHA256(payloadB64))
// signed over the base64url payload STRING with the shared AUTH_SECRET.

const enc = new TextEncoder();

function bytesToB64url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlToBytes(s: string): Uint8Array<ArrayBuffer> {
  const pad = s.length % 4 === 0 ? '' : '='.repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/') + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    enc.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export interface TokenPayload {
  scope: string;
  exp: number; // epoch ms
}

export async function signToken(payload: TokenPayload, secret: string): Promise<string> {
  const payloadB64 = bytesToB64url(enc.encode(JSON.stringify(payload)));
  const key = await hmacKey(secret);
  const sig = new Uint8Array(await crypto.subtle.sign('HMAC', key, enc.encode(payloadB64)));
  return `${payloadB64}.${bytesToB64url(sig)}`;
}

export async function verifyToken(
  token: string | undefined | null,
  secret: string,
  scope?: string,
): Promise<TokenPayload | null> {
  if (!token || !secret) return null;
  const dot = token.indexOf('.');
  if (dot < 0) return null;
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);
  try {
    const key = await hmacKey(secret);
    const ok = await crypto.subtle.verify('HMAC', key, b64urlToBytes(sigB64), enc.encode(payloadB64));
    if (!ok) return null;
    const payload = JSON.parse(new TextDecoder().decode(b64urlToBytes(payloadB64))) as TokenPayload;
    if (typeof payload.exp !== 'number' || payload.exp < Date.now()) return null;
    if (scope && payload.scope !== scope) return null;
    return payload;
  } catch {
    return null;
  }
}

// Constant-time string compare (avoids leaking the password via timing).
export function timingSafeEqualStr(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export const COOKIE_NAME = 'site_auth';
export const SITE_SCOPE = 'site';
export const HANDOFF_SCOPE = 'handoff';
export const COOKIE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
export const HANDOFF_TTL_MS = 2 * 60 * 1000; // 2 minutes
