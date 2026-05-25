// Small notification helpers — desktop notification + a generated "ding" via Web Audio.

let audioCtx: AudioContext | null = null;

function getCtx(): AudioContext | null {
  if (audioCtx) return audioCtx;
  try {
    const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    audioCtx = new Ctor();
    return audioCtx;
  } catch {
    return null;
  }
}

export function playDing(): void {
  const ctx = getCtx();
  if (!ctx) return;
  // Browsers suspend AudioContext until a user gesture. If the page hasn't
  // been clicked yet, .resume() will fail silently and we just skip the ding.
  if (ctx.state === "suspended") {
    ctx.resume().catch(() => undefined);
  }
  // A pleasant two-note chime: E5 then G5.
  const now = ctx.currentTime;
  const tones: Array<[number, number]> = [
    [659.25, now],         // E5 at t=0
    [783.99, now + 0.12],  // G5 at t=120ms
  ];
  for (const [freq, start] of tones) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = freq;
    osc.connect(gain);
    gain.connect(ctx.destination);
    gain.gain.setValueAtTime(0.0001, start);
    gain.gain.exponentialRampToValueAtTime(0.18, start + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.25);
    osc.start(start);
    osc.stop(start + 0.26);
  }
}

export async function ensureNotificationPermission(): Promise<NotificationPermission> {
  if (!("Notification" in window)) return "denied";
  if (Notification.permission === "default") {
    try {
      return await Notification.requestPermission();
    } catch {
      return "denied";
    }
  }
  return Notification.permission;
}

export function showDesktopNotification(title: string, body: string, tag?: string): void {
  if (!("Notification" in window) || Notification.permission !== "granted") return;
  try {
    new Notification(title, { body, tag, silent: true });
  } catch {
    // Some Chromium builds throw on Windows when running over HTTP; just ignore.
  }
}
