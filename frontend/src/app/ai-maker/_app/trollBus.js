// Tiny shared signal: is the app mid-generation right now?
//
// The PixelTroll lives at the app shell (every page) and wanders on his own,
// but his keyboard controls are only meant to work while a generation is
// running — something to fiddle with during the wait. ProgressOverlay only
// renders while Wizard is busy, so it flips this flag on mount/unmount and the
// troll reads it. Kept out of React state on purpose: the troll's animation
// loop is plain canvas, not a component re-render.

let generating = false;
let activeCount = 0; // refcount: multiple project slots can generate at once
const listeners = new Set();

// Called true on each overlay mount, false on unmount. With two project slots
// both able to generate simultaneously, track a count rather than a bare bool so
// one slot finishing doesn't clear the flag while the other is still running.
export function setGenerating(v) {
  activeCount = Math.max(0, activeCount + (v ? 1 : -1));
  const next = activeCount > 0;
  if (next === generating) return;
  generating = next;
  listeners.forEach((fn) => fn(generating));
}

export function getGenerating() {
  return generating;
}

export function onGeneratingChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}
