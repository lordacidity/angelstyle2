// How long a Download took, written down as the video lands — the browser's
// side of api/vids/timings.
//
// The clipper page is used on phones, and what a phone waits on is not what a
// desk does: this is what says whether it is the recordings, the words or the
// render, on which devices, and whether a change moved it. One row a video.
// Best effort throughout — a timing that can't be sent is not worth a word to
// anybody making a video.

import { withBase } from '@/lib/clipping';

export type TimingValue = number | string | boolean;

/** What the browser will say about the machine it is on. */
export function deviceInfo(): Record<string, TimingValue> {
  if (typeof navigator === 'undefined') return {};
  const nav = navigator as Navigator & {
    deviceMemory?: number;
    connection?: { effectiveType?: string; downlink?: number; saveData?: boolean };
  };
  const out: Record<string, TimingValue> = {
    ua: nav.userAgent,
    cores: nav.hardwareConcurrency ?? 0,
    touch: nav.maxTouchPoints > 0,
    screen: `${window.screen.width}x${window.screen.height}@${window.devicePixelRatio || 1}`,
  };
  if (nav.deviceMemory) out.memoryGb = nav.deviceMemory;
  if (nav.connection?.effectiveType) out.net = nav.connection.effectiveType;
  if (nav.connection?.downlink) out.downlinkMbps = nav.connection.downlink;
  if (nav.connection?.saveData) out.saveData = true;
  return out;
}

/** Send one video's timings. Never throws, never waited on. */
export function reportTiming(totalMs: number, stages: Record<string, TimingValue>): void {
  try {
    void fetch(withBase('/api/vids/timings'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ totalMs, stages, device: deviceInfo() }),
      // So one sent as the share sheet opens over the page still goes.
      keepalive: true,
    }).catch(() => { /* not sent */ });
  } catch { /* not sent */ }
}
