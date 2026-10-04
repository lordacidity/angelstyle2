'use client';
import { createClient, type RealtimeChannel, type SupabaseClient } from '@supabase/supabase-js';

// The room's wire. One Supabase Realtime channel per room code: presence
// says who is in it, broadcast carries the host's lobby, the start, every
// seat's orders to the host, and the host's snapshots back. The host's
// phone runs the game; the others run it too, and take the host's word
// once a second.

const URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_DIST_URL || '';
const KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

export const netAvailable = () => !!URL && !!KEY;

let client: SupabaseClient | null = null;
function sb(): SupabaseClient {
  if (!client) client = createClient(URL, KEY, { realtime: { params: { eventsPerSecond: 20 } } });
  return client;
}

export interface Peer { id: string; name: string; host: boolean; joined: number; meta?: Record<string, number> }
export type Msg =
  | { ev: 'start'; mode: 'team' | 'against'; seed: number; players: { id: string; name: string; meta?: Record<string, number> }[]; tier?: number }
  | { ev: 'act'; p: number; seq: number; a: unknown }
  | { ev: 'snap'; snap: unknown; acked: Record<number, number> }
  | { ev: 'end'; why: string };

/** Five letters, none that read as another. */
export function newCode(): string {
  const alpha = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
  let c = '';
  for (let i = 0; i < 5; i++) c += alpha[Math.floor(Math.random() * alpha.length)];
  return c;
}

export class Room {
  readonly code: string;
  readonly me: Peer;
  private ch: RealtimeChannel;
  peers: Peer[] = [];
  state: 'joining' | 'open' | 'closed' | 'error' = 'joining';
  onPeers: (peers: Peer[]) => void = () => {};
  onMsg: (m: Msg) => void = () => {};
  onState: (s: Room['state']) => void = () => {};

  constructor(code: string, name: string, host: boolean, meta: Record<string, number>) {
    this.code = code.toUpperCase();
    this.me = { id: Math.random().toString(36).slice(2, 10), name, host, joined: Date.now(), meta };
    this.ch = sb().channel(`redline-${this.code}`, { config: { broadcast: { self: false }, presence: { key: this.me.id } } });
    this.ch
      .on('presence', { event: 'sync' }, () => {
        const st = this.ch.presenceState<Peer>();
        const list: Peer[] = [];
        for (const k of Object.keys(st)) { const p = st[k][0]; if (p) list.push({ id: p.id, name: p.name, host: p.host, joined: p.joined, meta: p.meta }); }
        list.sort((a, b) => (b.host ? 1 : 0) - (a.host ? 1 : 0) || a.joined - b.joined);
        this.peers = list;
        this.onPeers(list);
      })
      .on('broadcast', { event: 'msg' }, ({ payload }) => { this.onMsg(payload as Msg); })
      .subscribe(async (status) => {
        if (status === 'SUBSCRIBED') {
          await this.ch.track(this.me);
          this.state = 'open'; this.onState('open');
        } else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') {
          this.state = 'error'; this.onState('error');
        } else if (status === 'CLOSED') {
          this.state = 'closed'; this.onState('closed');
        }
      });
  }

  send(m: Msg) { void this.ch.send({ type: 'broadcast', event: 'msg', payload: m }); }

  leave() {
    this.state = 'closed';
    void this.ch.untrack();
    void sb().removeChannel(this.ch);
  }
}
