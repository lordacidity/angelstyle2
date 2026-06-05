// Shared palette, the green↔red flush math, tiny stateless helpers, and the
// troll's "vocabulary" — the lists/sets of action names the wander loop, poke
// handler, and exits pick from. Pure data + pure functions only; nothing here
// touches the canvas or the live `T` state. (Sprite art lives in ./sprites, the
// speech-bubble text in ./speech, and the animation engine in ../PixelTroll.)

export const GREEN = '#00e676';
export const RED = '#ff4d4d';
export const GOLD = '#ffd24a';   // the ultra-rare lady troll
export const HEART = '#ff6b9d';  // her blown kiss + swoon hearts
export const PIXEL = 5;

// green ↔ red, so he can flush angry/embarrassed and fade back (0 = green, 1 = red).
const G_RGB = [0, 230, 118];
const R_RGB = [255, 77, 77];
export const mix = (k) => {
  const t = Math.max(0, Math.min(1, k));
  const c = (i) => Math.round(G_RGB[i] + (R_RGB[i] - G_RGB[i]) * t);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
};

export const spriteW = (rows) => Math.max(...rows.map((r) => r.length));
export const rand = (a, b) => a + Math.random() * (b - a);
export const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

export const MIDS = [
  'walk', 'run', 'jump', 'wave', 'sit', 'stretch', 'look',
  'backflip', 'splits', 'cartwheel', 'sleep', 'shake', 'giant', 'walk', 'jump',
  'moonwalk', 'disco', 'roll', 'dig', 'headbang', 'kick', 'trampoline',
  'breakdance', 'faint', 'sneeze',
];

// He never just disappears — every visit ends on one of these, picked at random.
export const EXITS = [
  'walkOff', 'runOff', 'burrow', 'fadeShake', 'shrinkOut',
  'cartwheelOff', 'rollOff', 'hopOff', 'rocketOff', 'blinkOut',
];

// Poke responses — none are bound to keys or to the idle wander loop, so they
// fire ONLY when you actually click the little guy. One chosen at random.
export const CLICK_REACTS = [
  'dazed', 'pstartle', 'pshakeHead', 'pflee', 'pangry',
  'pspin', 'psplat', 'pbounce', 'ptantrum', 'pblush',
  'phiccup', 'pzap', 'pmelt', 'pcry', 'plove', 'pjackpot', 'praspberry', 'psplit',
];
// 'pmeltdown' isn't in the random pool — it only fires when you poke him past
// his limit (see onClick) — but it still belongs in the set so a click can't
// interrupt it once it starts.
export const CLICK_SET = new Set([...CLICK_REACTS, 'pmeltdown', 'pflick']);

// Breathers slotted between his tricks so he doesn't fire them back-to-back:
// mostly just stand around a few (randomized) seconds, sometimes amble a bit.
export const REST_BEATS = ['pause', 'pause', 'mosey'];

// Ultra-rare cameos: ~1% each, swapped in for a normal trick. Cinematic, scripted,
// and never interruptible by a click. See stepAction for the choreography.
export const MID_SET = new Set(MIDS);
export const RARES = ['smitten', 'bloodDeath', 'ufo', 'dog', 'stomp'];
// 'police' is scripted like the rares (uninterruptible) but never random — it only
// fires when he's pushed past furious (see planVisit / superMad).
export const SPECIALS = new Set([...RARES, 'police']);

// Drag-and-drop set: while he's grabbed or mid-drop he rides OVER the floating
// widgets (canvas lifted above them) and isn't pokeable/flickable. 'shot' is the
// right-click execution — also handled here so a poke/flick can't interrupt it.
export const DRAG_ACTIONS = new Set(['grab', 'dropChute', 'dropFall', 'dropSplat', 'shot']);
