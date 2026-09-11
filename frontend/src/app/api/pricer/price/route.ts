// GET /api/pricer/price?name=…&hint=… — one pricing, as a server-sent-event stream. Stays open for the whole run
// (30 s to 5 min): a comment ping every 15 s keeps proxies from closing it, and when the browser goes away (Stop,
// tab closed) the stream's cancel fires and the pipeline's AbortSignal stops the API calls, so nothing is billed
// for a run nobody is watching.
//
// Events, in order: info → step (running/done/error, per step) → done, or error if the pipeline itself failed.
// Shapes are in src/lib/pricer/types.ts. Behind the site gate like every /api/* route (middleware.ts).
//
// Each run spends real API money (about $0.22). There is no queue, throttle or cache — every submit runs it all.

import { NextRequest, NextResponse } from 'next/server';
import { runPipeline } from '@/lib/pricer/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
// A heavily covered name takes 3–4 minutes. Vercel Hobby caps this lower; Pro honours it.
export const maxDuration = 300;

export async function GET(req: NextRequest) {
  const name = (req.nextUrl.searchParams.get('name') || '').trim();
  const hint = (req.nextUrl.searchParams.get('hint') || '').trim();
  if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });

  const enc = new TextEncoder();
  const ctrl = new AbortController();
  let open = true;
  let ping: ReturnType<typeof setInterval> | null = null;
  const stop = () => { open = false; ctrl.abort(); if (ping) { clearInterval(ping); ping = null; } };

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const write = (s: string) => {
        if (!open) return;
        try { controller.enqueue(enc.encode(s)); } catch { stop(); }
      };
      const emit = (event: string, data: unknown) => write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
      write(': connected\n\n');
      ping = setInterval(() => write(': ping\n\n'), 15_000);
      req.signal.addEventListener('abort', stop);

      const t0 = Date.now();
      console.log(`[pricer] ${new Date().toLocaleTimeString()} pricing "${name}"${hint ? ` (${hint})` : ''}`);
      (async () => {
        try {
          await runPipeline({ name, hint }, emit, ctrl.signal);
          console.log(`[pricer]   done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);
        } catch (e) {
          const message = e instanceof Error ? e.message : String(e);
          if (ctrl.signal.aborted) console.log('[pricer]   cancelled by client');
          else { console.error('[pricer]   failed:', message); emit('error', { message }); }
        } finally {
          req.signal.removeEventListener('abort', stop);
          const wasOpen = open;
          stop();
          if (wasOpen) { try { controller.close(); } catch { /* already closed */ } }
        }
      })();
    },
    cancel() { stop(); },
  });

  return new Response(stream, {
    headers: {
      'content-type': 'text/event-stream; charset=utf-8',
      'cache-control': 'no-cache, no-transform',
      connection: 'keep-alive',
      'x-accel-buffering': 'no',
    },
  });
}
