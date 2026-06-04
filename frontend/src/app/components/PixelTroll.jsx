import { useEffect, useRef } from 'react';

/**
 * A very pixelated, all-green troll that lives along the very bottom edge of the
 * screen. He wanders in every so often and does random things — walk, run
 * edge-to-edge, jump, wave, sit, stretch, look around, backflip, splits,
 * cartwheel, sleep (with little green Z's), grow into a giant and stomp, or
 * shake until a baby troll bursts out, sprints around, and pops into confetti.
 * He takes his time about it — between tricks he'll stand around for a few
 * (randomized) seconds or amble a little way, rather than firing them off
 * back-to-back. When he's done he never just blinks out — he leaves a different way each time:
 * strolls or bolts off, burrows under, cartwheels / rolls / hops off the edge,
 * rockets straight up, shrinks to nothing, glitch-flickers away, or shivers
 * until he fades out. (Ten exits, one picked at random per visit.)
 *
 * ...plus a stash of newer, stranger tricks he busts out without warning — best
 * discovered by accident. (No spoilers here.) And on rare occasions, something
 * altogether bigger happens to him. You'll know it when you see it.
 *
 * And he's pokeable: click him and he reacts — keels over dazed, shakes his
 * head "no", flushes red and puffs up, throws a tantrum, splats flat, bolts
 * off-screen, and more. Ten poke-reactions, one picked at random per click.
 * He can flush green→red and fade out, so a `color`/`alpha` pair rides
 * alongside `pose` for tinting and dissolving.
 *
 * Pure canvas, single green color (red when riled), no images.
 */

const GREEN = '#00e676';
const RED = '#ff4d4d';
const GOLD = '#ffd24a';   // the ultra-rare lady troll
const HEART = '#ff6b9d';  // her blown kiss + swoon hearts
const PIXEL = 5;

// green ↔ red, so he can flush angry/embarrassed and fade back (0 = green, 1 = red).
const G_RGB = [0, 230, 118];
const R_RGB = [255, 77, 77];
const mix = (k) => {
  const t = Math.max(0, Math.min(1, k));
  const c = (i) => Math.round(G_RGB[i] + (R_RGB[i] - G_RGB[i]) * t);
  return `rgb(${c(0)},${c(1)},${c(2)})`;
};

// ---- sprite art (# = green) ----------------------------------------------
const EYE_C = '.##.####.##.';
const EYE_L = '.#.####.###.';
const EYE_R = '.###.####.#.';

const STAND = [
  '.#..#..#..#.', '..########..', '.##########.', '.##########.', EYE_C,
  '.##########.', '..########..', '#..######..#', '.##########.', '..########..',
  '...######...', '...#....#...', '...#....#...', '..##....##..',
];
const withEye = (row) => STAND.map((r, i) => (i === 4 ? row : r));
const legs = (a, b, c) => STAND.map((r, i) => (i === 11 ? a : i === 12 ? b : i === 13 ? c : r));

const POSES = {
  stand: STAND,
  lookL: withEye(EYE_L),
  lookR: withEye(EYE_R),
  walkA: legs('...##...#...', '..##....#...', '.##....##...'),
  walkB: legs('...#...##...', '...#....##..', '...##....##.'),
  wave: [
    '.#..#..#..#.', '..########..', '.##########.', '.##########.', EYE_C,
    '.##########.', '..########.#', '#..######.#.', '.##########.', '..########..',
    '...######...', '...#....#...', '...#....#...', '..##....##..',
  ],
  jump: [
    '#.#..#..#.#.', '..########..', '.##########.', '.##########.', EYE_C,
    '.##########.', '..########..', '#.########.#', '#.########.#', '..########..',
    '...######...', '..##....##..', '.##......##.', '............',
  ],
  stretch: [
    '#.#..#..#.#.', '#.########.#', '#.########.#', '.##########.', '.##########.',
    EYE_C, '.##########.', '..########..', '.##########.', '..########..',
    '...######...', '...#....#...', '...#....#...', '..##....##..',
  ],
  sit: [
    '.#..#..#..#.', '..########..', '.##########.', '.##########.', EYE_C,
    '.##########.', '..########..', '#.########.#', '.##########.', '##########..',
    '####....####',
  ],
  splits: [
    '......###......', '.....#####.....', '.....#####.....', '.....#.#.#.....',
    '.....#####.....', '......###......', '....#######....', '###############',
    '##...........##',
  ],
  ball: ['..####..', '.######.', '########', '##.##.##', '########', '.######.', '..####..'],
  ball2: ['..####..', '.##..##.', '########', '##.##.##', '########', '.##..##.', '..####..'],
  cartX: [
    '#.........#.', '.#.......#..', '..#.....#...', '...#...#....', '....###.....',
    '...#####....', '....###.....', '...#...#....', '..#.....#...', '.#.......#..', '#.........#.',
  ],
  cartPlus: [
    '.....#......', '.....#......', '.....#......', '..#######...', '#########...',
    '..#######...', '.....#......', '.....#......', '.....#......',
  ],
  laydown: [
    '......####......', '...###########..', '..#############.', '.###############',
    '..#############.', '...###.....###..',
  ],
  pointUp: [
    '.#..#..#..#.#', '..########.#.', '.##########..', '.##########.', EYE_C,
    '.##########.', '..########..', '#..######..#', '.##########.', '..########..',
    '...######...', '...#....#...', '...#....#...', '..##....##..',
  ],
  headDown: [
    '............', '............', '..########..', '.##########.', '.##########.',
    EYE_C, '.##########.', '..########..', '#..######..#', '.##########.',
    '..########..', '...######...', '...#....#...', '..##....##..',
  ],
  kick: [
    '.#..#..#..#.', '..########..', '.##########.', '.##########.', EYE_C,
    '.##########.', '..########..', '#..######..#', '.##########.', '..########..',
    '...######...', '...#....#...', '...#....####', '..##........',
  ],
  squash: ['.#..#..#..#.', '############', '##.####.####', '############', '############', '##........##'],
  pancake: ['.##############.', '################', '##.##.##.##.##.#'],
};

// (shift+x cameo prop)
const BOOT = [
  '.####......', '.####......', '.####......', '.####......', '.####......',
  '.#####.....', '.######....', '.#######...', '.########..', '.#########.',
  '.##########', '###########', '###########',
];

const Z_GLYPH = ['#####', '...#.', '..#..', '.#...', '#####'];
const NOTE_GLYPH = ['...##', '..#.#', '..#.#', '..#..', '###..', '###..'];
const STAR_GLYPH = ['..#..', '#.#.#', '.###.', '#.#.#', '..#..'];
const HEART_GLYPH = ['.#.#.', '#####', '#####', '.###.', '..#..'];

// flying saucer (two frames = blinking under-lights)
const UFO = [
  '....######....', '...########...', '..##########..', '##############', '#.#.#.#.#.#.#.',
];
const UFO2 = [
  '....######....', '...########...', '..##########..', '##############', '.#.#.#.#.#.#.#',
];

// ---- the golden lady troll (ultra-rare cameo): pigtails, lashes, a little dress ----
const LADY_STAND = [
  '...#..#..#...', '...#######...', '..#########..', '#.#########.#', '#.##.###.##.#',
  '..#########..', '...#######...', '.#.#######.#.', '..#########..', '...#######...',
  '..#########..', '.###########.', '#############', '...##...##...',
];
const ladyLegs = (row) => LADY_STAND.map((r, i) => (i === 13 ? row : r));
const LADY_KISS = [
  '...#..#..#...', '...#######...', '..#########..', '#.#########.#', '#.##.###.##.#',
  '..#########.#', '...#######.#.', '.#.########..', '..#########..', '...#######...',
  '..#########..', '.###########.', '#############', '...##...##...',
];
const LADY_GIGGLE = [
  '...#..#..#...', '...#######...', '..#########..', '#.#########.#', '#.#.###.#.#.#',
  '..#########..', '#.#######.#.#', '.#.#######.#.', '..#########..', '...#######...',
  '..#########..', '.###########.', '#############', '...##...##...',
];
const LADY = {
  stand: LADY_STAND,
  walkA: ladyLegs('..##....#....'),
  walkB: ladyLegs('....#....##..'),
  kiss: LADY_KISS,
  giggle: LADY_GIGGLE,
};

// ---- the big dog (ultra-rare cameo): runs in, eats him whole, trots off ----
// faces right (snout/nose on the right); mirror it to face left. 18 wide, 10 tall.
// curled tail (left), ear, eye gap, snout + nose, mouth line, four legs w/ paws.
const DOG = [
  '.#..........##....', '.##.......#####...', '##.......#######..', '..############.###',
  '.#################', '.###############.#', '.#############....', '..##.##...##.##...',
  '..##.##...##.##...', '.###.###..###.###.',
];
const DOG2 = [                                      // running — legs/paws shifted
  '.#..........##....', '.##.......#####...', '##.......#######..', '..############.###',
  '.#################', '.###############.#', '.#############....', '.##.##...##.##....',
  '.##.##...##.##....', '###.###...###.###.',
];
const DOG_OPEN = [                                  // jaws gaping at the snout
  '.#..........##....', '.##.......#####...', '##.......#######..', '..############.###',
  '.############..###', '.###########..####', '.#############....', '..##.##...##.##...',
  '..##.##...##.##...', '.###.###..###.###.',
];

const spriteW = (rows) => Math.max(...rows.map((r) => r.length));
const rand = (a, b) => a + Math.random() * (b - a);
const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

const MIDS = [
  'walk', 'run', 'jump', 'wave', 'sit', 'stretch', 'look',
  'backflip', 'splits', 'cartwheel', 'sleep', 'shake', 'giant', 'walk', 'jump',
  'moonwalk', 'disco', 'roll', 'dig', 'headbang', 'kick', 'trampoline',
  'breakdance', 'faint', 'sneeze',
];

// He never just disappears — every visit ends on one of these, picked at random.
const EXITS = [
  'walkOff', 'runOff', 'burrow', 'fadeShake', 'shrinkOut',
  'cartwheelOff', 'rollOff', 'hopOff', 'rocketOff', 'blinkOut',
];

// Poke responses — none are bound to keys or to the idle wander loop, so they
// fire ONLY when you actually click the little guy. One chosen at random.
const CLICK_REACTS = [
  'dazed', 'pstartle', 'pshakeHead', 'pflee', 'pangry',
  'pspin', 'psplat', 'pbounce', 'ptantrum', 'pblush',
];
const CLICK_SET = new Set(CLICK_REACTS);

// Breathers slotted between his tricks so he doesn't fire them back-to-back:
// mostly just stand around a few (randomized) seconds, sometimes amble a bit.
const REST_BEATS = ['pause', 'pause', 'mosey'];

// Ultra-rare cameos: ~1% each, swapped in for a normal trick. Cinematic, scripted,
// and never interruptible by a click. See stepAction for the choreography.
const MID_SET = new Set(MIDS);
const RARES = ['smitten', 'bloodDeath', 'ufo', 'dog', 'stomp'];
const SPECIALS = new Set(RARES);

export default function PixelTroll({ hidden = false, floorSelector = '', zIndex = 30 }) {
  const canvasRef = useRef(null);
  const hiddenRef = useRef(hidden);
  hiddenRef.current = hidden; // read by the animation loop without re-subscribing

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');

    const STAND_H = STAND.length * PIXEL;
    const resize = () => {
      canvas.width = window.innerWidth;
      // Full-viewport height: he may stand well above the bottom (atop the trim
      // bar), so he needs the whole column for headroom on giant / jumps.
      canvas.height = window.innerHeight;
    };
    resize();
    window.addEventListener('resize', resize);

    const T = {
      mode: 'away', x: 0, dir: 1, yOffset: 0, scale: 1, shakeX: 0,
      pose: 'stand', mirror: false, color: GREEN, alpha: 1, leaving: false,
      action: null, queue: [], userQueue: [], idleStreak: 0,
      t: 0, dur: 0, legT: 0, legFlip: false, poseT: 0, poseFlip: false,
      target: 0, speed: 0, babySpawned: false, sneezed: false, zTimer: 0,
      baby: null, confetti: [], zzz: [],
      lady: null, hearts: [], heartSent: false, landed: false, pool: null, ufo: null, dog: null, boot: null,
      nextVisit: performance.now() + rand(5000, 9000),
      floorY: canvas.height, // current floor, eased toward the trim bar / screen bottom
    };

    const W = () => canvas.width;
    // The floor he stands on. Default: the bottom of the canvas (screen bottom).
    // When a floorSelector element (the media trim bar) is on-screen, he stands
    // on its top edge instead — as if walking along the top of it. computeFloor()
    // reads layout; the loop eases T.floorY toward it once per frame and
    // groundY() just returns that cached value, so the many per-frame reads don't
    // each thrash layout.
    const computeFloor = () => {
      if (floorSelector) {
        const el = document.querySelector(floorSelector);
        if (el) {
          const r = el.getBoundingClientRect();
          const top = r.top - (window.innerHeight - canvas.height);
          if (r.height > 0 && top > PIXEL && top <= canvas.height) return top;
        }
      }
      return canvas.height;
    };
    const groundY = () => T.floorY;
    const off = spriteW(STAND) * PIXEL;

    function planVisit() {
      const entrance = pick(['walkIn', 'walkIn', 'emerge']);
      const n = 2 + Math.floor(Math.random() * 3);
      const seq = [entrance];
      for (let i = 0; i < n; i++) {
        if (Math.random() < 0.7) seq.push(pick(REST_BEATS)); // breather before the trick
        seq.push(pick(MIDS));
      }
      if (Math.random() < 0.6) seq.push(pick(REST_BEATS));   // settle a beat before leaving
      seq.push(pick(EXITS));
      T.queue = seq;
    }

    function beginNext(now) {
      // a pressed key always wins, even if he was mid-exit — cancel the departure.
      if (T.userQueue.length) { T.leaving = false; T.idleStreak = 0; startAction(T.userQueue.shift(), now); return; }
      // just finished an exit (or fled) → he's gone; don't idle back into view.
      if (T.leaving) { T.leaving = false; T.idleStreak = 0; T.mode = 'away'; T.nextVisit = now + rand(14000, 34000); return; }
      if (T.queue.length) {
        T.idleStreak = 0;
        const nx = T.queue.shift();
        // ultra-rare: swap a normal trick for a scripted cameo (~1% each).
        if (MID_SET.has(nx) && Math.random() < 0.05) { startAction(pick(RARES), now); return; }
        startAction(nx, now); return;
      }
      if (T.idleStreak < 2) { T.idleStreak++; startAction('idle', now); return; }
      T.mode = 'away'; T.idleStreak = 0; T.nextVisit = now + rand(14000, 34000);
    }

    function spawnBaby() {
      T.baby = {
        x: T.x, dir: Math.random() < 0.5 ? 1 : -1, t: 0,
        life: rand(2400, 3400), legT: 0, legFlip: false, speed: rand(330, 520),
      };
    }
    function spawnConfetti(x, y) {
      for (let i = 0; i < 26; i++) {
        const ang = rand(-Math.PI * 0.9, -Math.PI * 0.1);
        const sp = rand(120, 340);
        T.confetti.push({
          x, y, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
          life: rand(900, 1600), size: Math.round(rand(3, 7)),
        });
      }
    }

    function startAction(name, now) {
      T.mode = 'active'; T.action = name; T.t = 0;
      T.yOffset = 0; T.scale = 1; T.shakeX = 0; T.mirror = false; T.color = GREEN; T.alpha = 1;
      T.leaving = false; // only exits / flee re-assert this below
      T.lady = null; T.pool = null; T.ufo = null; T.dog = null; T.boot = null; // clear any lingering cameo props
      switch (name) {
        case 'walkIn':
          T.dir = Math.random() < 0.5 ? 1 : -1;
          T.x = T.dir === 1 ? -off : W() + off;
          T.target = rand(W() * 0.25, W() * 0.75); T.speed = rand(55, 80); T.pose = 'walkA';
          break;
        case 'emerge':
          T.x = rand(W() * 0.2, W() * 0.8); T.yOffset = STAND_H; T.dur = 2600; T.pose = 'stand';
          break;
        case 'walk':
          T.dir = Math.random() < 0.5 ? 1 : -1; T.dur = rand(1500, 3200); T.speed = rand(48, 78);
          break;
        case 'run':
          T.dir = T.x < W() / 2 ? 1 : -1; T.target = T.dir === 1 ? W() * 0.9 : W() * 0.1; T.speed = rand(360, 540);
          break;
        case 'jump': T.dur = rand(560, 700) * (Math.random() < 0.4 ? 2 : 1); break;
        case 'wave': T.dur = rand(1400, 2400); break;
        case 'sit': T.dur = rand(1800, 3600); break;
        case 'stretch': T.dur = rand(1500, 2600); break;
        case 'look': T.dur = rand(1600, 2800); break;
        case 'idle': T.dur = rand(3000, 4200); break;
        case 'pause': T.dur = rand(900, 3600); break;   // a few seconds of just... standing there
        case 'mosey': T.dir = Math.random() < 0.5 ? 1 : -1; T.dur = rand(900, 2400); T.speed = rand(36, 64); break;
        case 'backflip': T.dur = 1150; break;
        case 'splits': T.dur = rand(1800, 2600); break;
        case 'cartwheel':
          T.dir = T.x < W() / 2 ? 1 : -1; T.speed = rand(260, 380); T.dur = 1350;
          break;
        case 'sleep': T.dur = rand(4500, 6500); T.zTimer = 0; break;
        case 'shake': T.dur = 1600; T.babySpawned = false; break;
        case 'giant': T.dir = T.x < W() / 2 ? 1 : -1; T.dur = 5200; T.speed = 80; break;
        case 'moonwalk': T.dir = T.x < W() / 2 ? 1 : -1; T.dur = rand(2200, 3400); T.speed = rand(70, 110); break;
        case 'breakdance': T.dur = rand(1600, 2400); break;
        case 'disco': T.dur = rand(2600, 4200); T.poseT = 0; break;
        case 'sneeze': T.dir = T.x < W() / 2 ? 1 : -1; T.dur = 1700; T.sneezed = false; break;
        case 'roll':
          T.dir = T.x < W() / 2 ? 1 : -1; T.target = T.dir === 1 ? W() - off : off; T.speed = rand(300, 460);
          break;
        case 'dig': T.dur = rand(2600, 3600); T.poseT = 0; break;
        case 'faint': T.dur = rand(2400, 3200); break;
        case 'headbang': T.dur = rand(1800, 2800); break;
        case 'kick': T.dir = T.x < W() / 2 ? 1 : -1; T.dur = 1100; break;
        case 'trampoline': T.dur = rand(2600, 3600); break;
        case 'dazed': T.dur = 1500; T.zTimer = 0; break;

        // ---- click reactions (poke responses) ----
        case 'pstartle': T.dur = 900; break;
        case 'pshakeHead': T.dur = 1200; T.poseT = 0; break;
        case 'pflee': T.leaving = true; T.dir = T.x < W() / 2 ? -1 : 1; T.speed = rand(430, 600); break;
        case 'pangry': T.dur = 1700; T.poseT = 0; break;
        case 'pspin': T.dur = 1500; T.poseT = 0; T.zTimer = 0; break;
        case 'psplat': T.dur = 760; break;
        case 'pbounce': T.dur = 1500; break;
        case 'ptantrum': T.dur = 1700; T.poseT = 0; T.legT = 0; break;
        case 'pblush': T.dur = 1300; break;

        // ---- exits (every one sets `leaving` so he stays gone) ----
        case 'walkOff': T.leaving = true; T.dir = T.x < W() / 2 ? -1 : 1; T.speed = rand(55, 85); break;
        case 'runOff': T.leaving = true; T.dir = T.x < W() / 2 ? -1 : 1; T.speed = rand(380, 560); break;
        case 'burrow': T.leaving = true; T.dur = 1700; break;
        case 'fadeShake': T.leaving = true; T.dur = 1300; break;
        case 'shrinkOut': T.leaving = true; T.dur = 900; T.sneezed = false; break;
        case 'cartwheelOff': T.leaving = true; T.dir = T.x < W() / 2 ? -1 : 1; T.speed = rand(300, 440); T.poseT = 0; break;
        case 'rollOff': T.leaving = true; T.dir = T.x < W() / 2 ? -1 : 1; T.speed = rand(340, 520); T.poseT = 0; break;
        case 'hopOff': T.leaving = true; T.dir = T.x < W() / 2 ? -1 : 1; T.speed = rand(150, 230); break;
        case 'rocketOff': T.leaving = true; T.dur = 1500; T.poseT = 0; break;
        case 'blinkOut': T.leaving = true; T.dur = 1100; break;

        // ---- ultra-rare cameos ----
        case 'smitten': {                               // the golden lady visits
          T.dur = 9000;
          const fromRight = T.x < W() / 2;
          const dirIn = fromRight ? -1 : 1;
          const stopX = Math.max(60, Math.min(W() - 60, T.x + (fromRight ? 1 : -1) * rand(95, 135)));
          const ladyOff = 13 * PIXEL + 14;              // fully off the edge she enters from
          const startX = fromRight ? W() + ladyOff : -ladyOff;
          // walk speed scaled to distance so she arrives by the entrance cue on any width.
          const speed = Math.max(120, Math.abs(startX - stopX) / 1.7);
          T.lady = {
            x: startX, stopX, dir: dirIn, speed,
            pose: 'walkA', mirror: false, yOff: 0, legT: 0, legFlip: false, gone: false, runInit: false,
          };
          T.heartSent = false; T.landed = false; T.zTimer = 0;
          break;
        }
        case 'bloodDeath':                              // he retches blood and sinks away
          T.leaving = true; T.dur = 7500; T.poseT = 0; T.sneezed = false;
          T.dir = Math.random() < 0.5 ? 1 : -1; T.mirror = T.dir < 0;
          T.pool = { x: T.x, grow: 0, sink: 0 };
          break;
        case 'ufo': {                                   // abducted by a flying saucer
          T.leaving = true; T.dur = 6000;
          const dir = Math.random() < 0.5 ? 1 : -1;     // travels this way across the screen
          const startX = dir === 1 ? -110 : W() + 110;  // fully off the side it enters from
          const exitDist = (dir === 1 ? (W() - T.x) : T.x) + 130;
          const flySpeed = exitDist / 2.0;              // clears the far side within the fly-off window
          T.ufo = { x: startX, startX, y: 0, dir, beam: 0, blink: true, flySpeed };
          break;
        }
        case 'dog': {                                   // a big dog eats him whole
          T.leaving = true; T.dur = 5500;
          const dir = Math.random() < 0.5 ? 1 : -1;     // dog travels this way
          const dogHalf = 70;
          const stopX = T.x - dir * dogHalf;            // dog center so its mouth lands on the troll
          const startX = dir === 1 ? -dogHalf - 70 : W() + dogHalf + 70;
          const runSpeed = Math.max(280, Math.abs(startX - stopX) / 1.25);
          const exitDist = (dir === 1 ? (W() - stopX) : stopX) + dogHalf + 90;
          const awaySpeed = Math.max(340, exitDist / 1.9);
          T.dog = { x: startX, stopX, dir, legT: 0, legFlip: false, mouth: 'run', full: false, runSpeed, awaySpeed };
          T.poseT = 0;
          break;
        }
        case 'stomp':                                   // ( shift+x — best left a surprise )
          T.dur = 4500; T.boot = { y: -60, shown: false }; T.landed = false; T.zTimer = 0;
          break;

        default: T.dur = 800;
      }
    }

    function animLegs(dt, a, b, every = 140) {
      T.legT += dt;
      if (T.legT > every) { T.legT = 0; T.legFlip = !T.legFlip; }
      T.pose = T.legFlip ? b : a;
    }

    function stepAction(dt) {
      T.t += dt;
      const a = T.action;

      if (a === 'walkIn') {
        T.mirror = T.dir < 0; T.x += T.dir * T.speed * dt / 1000; animLegs(dt, 'walkA', 'walkB');
        return T.dir === 1 ? T.x >= T.target : T.x <= T.target;
      }
      if (a === 'emerge') {
        const headPeek = 7 * PIXEL, downHead = STAND_H - headPeek;
        if (T.t < 700) { T.yOffset = STAND_H - (T.t / 700) * headPeek; T.pose = 'stand'; }
        else if (T.t < 1900) {
          T.yOffset = downHead; T.poseT += dt;
          if (T.poseT > 420) { T.poseT = 0; T.poseFlip = !T.poseFlip; }
          T.pose = T.poseFlip ? 'lookL' : 'lookR';
        } else { T.yOffset = downHead * (1 - Math.min(1, (T.t - 1900) / 700)); T.pose = 'stand'; }
        return T.t >= T.dur;
      }
      if (a === 'walk') {
        T.mirror = T.dir < 0; T.x += T.dir * T.speed * dt / 1000;
        if (T.x < W() * 0.1) T.dir = 1; if (T.x > W() * 0.9) T.dir = -1;
        animLegs(dt, 'walkA', 'walkB'); return T.t >= T.dur;
      }
      if (a === 'run') {
        T.mirror = T.dir < 0; T.x += T.dir * T.speed * dt / 1000; animLegs(dt, 'walkA', 'walkB', 70);
        return T.dir === 1 ? T.x >= T.target : T.x <= T.target;
      }
      if (a === 'jump') {
        const phase = (T.t % 620) / 620;
        T.yOffset = -Math.sin(Math.PI * phase) * 34;
        T.pose = T.yOffset < -6 ? 'jump' : 'stand'; return T.t >= T.dur;
      }
      if (a === 'wave') {
        T.poseT += dt; if (T.poseT > 200) { T.poseT = 0; T.poseFlip = !T.poseFlip; }
        T.pose = T.poseFlip ? 'wave' : 'stand'; return T.t >= T.dur;
      }
      if (a === 'sit') { T.pose = 'sit'; return T.t >= T.dur; }
      if (a === 'stretch') { T.yOffset = -Math.min(6, T.t / 120); T.pose = 'stretch'; return T.t >= T.dur; }
      if (a === 'look') {
        const m = T.t % 1380; T.pose = m < 460 ? 'lookL' : m < 920 ? 'stand' : 'lookR'; return T.t >= T.dur;
      }
      if (a === 'idle') { T.pose = 'stand'; return T.t >= T.dur; }
      if (a === 'pause') {                              // a breather — mostly still, an occasional glance
        const m = T.t % 2600;
        T.pose = m < 1950 ? 'stand' : (Math.floor(m / 240) % 2 ? 'lookR' : 'lookL');
        return T.t >= T.dur;
      }
      if (a === 'mosey') {                              // amble a little way and stop
        T.mirror = T.dir < 0; T.x += T.dir * T.speed * dt / 1000;
        if (T.x < W() * 0.08) T.dir = 1; if (T.x > W() * 0.92) T.dir = -1;
        animLegs(dt, 'walkA', 'walkB', 170);
        return T.t >= T.dur;
      }
      if (a === 'backflip') {
        if (T.t < 150) T.pose = 'stand';
        else if (T.t < 950) {
          T.yOffset = -Math.sin(Math.PI * (T.t - 150) / 800) * 64;
          T.poseT += dt; if (T.poseT > 85) { T.poseT = 0; T.poseFlip = !T.poseFlip; }
          T.pose = T.poseFlip ? 'ball' : 'ball2';
        } else { T.yOffset = 0; T.pose = 'stand'; }
        return T.t >= T.dur;
      }
      if (a === 'splits') { T.pose = 'splits'; return T.t >= T.dur; }
      if (a === 'cartwheel') {
        T.x += T.dir * T.speed * dt / 1000;
        T.poseT += dt; if (T.poseT > 90) { T.poseT = 0; T.poseFlip = !T.poseFlip; }
        T.pose = T.poseFlip ? 'cartX' : 'cartPlus';
        if (T.x < off) T.dir = 1; if (T.x > W() - off) T.dir = -1;
        return T.t >= T.dur;
      }
      if (a === 'sleep') {
        T.pose = 'laydown';
        T.zTimer += dt;
        if (T.zTimer > 820) {
          T.zTimer = 0;
          T.zzz.push({
            x: T.x + rand(6, 26), y: groundY() - 30,
            vx: rand(5, 16), vy: rand(-54, -42),
            life: 1900, maxLife: 1900,
          });
        }
        return T.t >= T.dur;
      }
      if (a === 'shake') {
        T.shakeX = rand(-4, 4); T.pose = 'stand';
        if (T.t > 1200 && !T.babySpawned) { spawnBaby(); T.babySpawned = true; }
        return T.t >= T.dur;
      }
      if (a === 'giant') {
        if (T.t < 600) { T.scale = 1 + (T.t / 600) * 1.8; T.pose = 'stand'; }
        else if (T.t < 4400) {
          T.scale = 2.8; T.x += T.dir * T.speed * dt / 1000;
          if (T.x < W() * 0.18) T.dir = 1; if (T.x > W() * 0.82) T.dir = -1;
          const before = T.legFlip;
          animLegs(dt, 'walkA', 'walkB', 230);
          if (T.legFlip !== before) T.shakeX = rand(-7, 7); else T.shakeX *= 0.7;
        } else { T.scale = 2.8 - Math.min(1, (T.t - 4400) / 800) * 1.8; T.pose = 'stand'; T.shakeX = 0; }
        return T.t >= T.dur;
      }
      if (a === 'moonwalk') {
        T.mirror = T.dir < 0;
        T.x -= T.dir * T.speed * dt / 1000;          // glide opposite to where he faces
        animLegs(dt, 'walkA', 'walkB', 120);
        T.yOffset = -Math.abs(Math.sin(T.t / 110)) * 3;
        if (T.x < off) T.dir = -1; if (T.x > W() - off) T.dir = 1;
        return T.t >= T.dur;
      }
      if (a === 'breakdance') {
        const frames = ['cartPlus', 'cartX', 'ball', 'ball2'];
        T.pose = frames[Math.floor(T.t / 70) % frames.length];
        T.yOffset = -Math.abs(Math.sin(T.t / 90)) * 10;
        T.shakeX = rand(-2, 2);
        return T.t >= T.dur;
      }
      if (a === 'disco') {
        T.poseT += dt;
        if (T.poseT > 260) {
          T.poseT = 0; T.poseFlip = !T.poseFlip;
          if (Math.random() < 0.55) {                   // not every flip — keep notes spaced out
            T.zzz.push({
              x: T.x + rand(-24, 30), y: groundY() - STAND_H * 0.9,
              vx: rand(-22, 22), vy: rand(-58, -44),
              life: 1700, maxLife: 1700, glyph: NOTE_GLYPH,
            });
          }
        }
        T.mirror = T.poseFlip; T.pose = 'pointUp';
        T.yOffset = -Math.abs(Math.sin(T.t / 130)) * 8;
        return T.t >= T.dur;
      }
      if (a === 'sneeze') {
        T.mirror = T.dir < 0;
        if (T.t < 900) {                              // wind up — head back, quivering
          T.pose = 'stretch';
          T.yOffset = -Math.min(7, T.t / 130);
          T.shakeX = rand(-1.5, 1.5);
        } else {                                       // ...ACHOO
          if (!T.sneezed) {
            T.sneezed = true;
            for (let i = 0; i < 16; i++) {
              const ang = T.dir === 1 ? rand(-0.5, 0.4) : rand(Math.PI - 0.4, Math.PI + 0.5);
              const sp = rand(180, 420);
              T.confetti.push({
                x: T.x + T.dir * 14, y: groundY() - STAND_H * 0.55,
                vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 40,
                life: rand(500, 1000), size: Math.round(rand(2, 5)),
              });
            }
          }
          T.pose = 'ball'; T.yOffset = 0;
          T.shakeX = rand(-5, 5) * Math.max(0, 1 - (T.t - 900) / 400);
        }
        return T.t >= T.dur;
      }
      if (a === 'roll') {
        T.x += T.dir * T.speed * dt / 1000;
        T.poseT += dt; if (T.poseT > 60) { T.poseT = 0; T.poseFlip = !T.poseFlip; }
        T.pose = T.poseFlip ? 'ball' : 'ball2';
        return T.dir === 1 ? T.x >= T.target : T.x <= T.target;
      }
      if (a === 'dig') {
        T.poseT += dt;
        if (T.t < T.dur - 700) {
          T.pose = (T.t % 240 < 120) ? 'sit' : 'ball';
          T.yOffset = Math.min(STAND_H * 0.45, T.t / 14);    // sink into the ground
          if (T.poseT > 130) {                                // fling dirt
            T.poseT = 0;
            for (let i = 0; i < 4; i++) {
              T.confetti.push({
                x: T.x + rand(-6, 6), y: groundY() - 6,
                vx: rand(-60, 60), vy: rand(-260, -120),
                life: rand(500, 900), size: Math.round(rand(2, 4)),
              });
            }
          }
        } else {
          T.yOffset = Math.max(0, T.yOffset - dt * 0.4); T.pose = 'stand';   // pop back up
        }
        return T.t >= T.dur;
      }
      if (a === 'faint') {
        if (T.t < 500) {                               // dizzy wobble
          T.poseT += dt; if (T.poseT > 120) { T.poseT = 0; T.poseFlip = !T.poseFlip; }
          T.pose = T.poseFlip ? 'lookL' : 'lookR'; T.shakeX = rand(-3, 3);
        } else if (T.t < 900) { T.pose = 'sit'; T.shakeX = 0; }   // topple
        else if (T.t < T.dur - 500) { T.pose = 'laydown'; }       // out cold
        else { T.pose = 'stand'; T.yOffset = -Math.sin(Math.PI * (T.t - (T.dur - 500)) / 500) * 12; } // spring up
        return T.t >= T.dur;
      }
      if (a === 'headbang') {
        T.poseT += dt; if (T.poseT > 110) { T.poseT = 0; T.poseFlip = !T.poseFlip; }
        T.pose = T.poseFlip ? 'headDown' : 'stand';
        T.yOffset = -Math.abs(Math.sin(T.t / 80)) * 5;
        T.shakeX = rand(-2, 2);
        return T.t >= T.dur;
      }
      if (a === 'kick') {
        T.mirror = T.dir < 0;
        if (T.t < 300) { T.pose = 'sit'; }                          // crouch
        else if (T.t < 650) {                                       // flying kick
          T.pose = 'kick'; T.x += T.dir * 260 * dt / 1000;
          T.yOffset = -Math.sin(Math.PI * (T.t - 300) / 350) * 10;
        } else { T.pose = 'stand'; T.yOffset = 0; }                 // recover
        return T.t >= T.dur;
      }
      if (a === 'trampoline') {
        const phase = (T.t % 760) / 760;
        T.yOffset = -Math.sin(Math.PI * phase) * 80;                // big air
        if (T.yOffset < -8) T.pose = 'jump';
        else T.pose = (phase < 0.08 || phase > 0.92) ? 'squash' : 'stand';
        return T.t >= T.dur;
      }
      if (a === 'dazed') {
        if (T.t < 200) {                              // buckle and keel over
          T.pose = T.t < 100 ? 'sit' : 'laydown';
          T.shakeX = rand(-3, 3);
        } else if (T.t < T.dur - 450) {               // out cold, seeing stars
          T.pose = 'laydown'; T.shakeX = 0;
          T.zTimer += dt;
          if (T.zTimer > 300) {
            T.zTimer = 0;
            T.zzz.push({
              x: T.x + rand(-22, 22), y: groundY() - STAND_H * 0.35,
              vx: rand(-24, 24), vy: rand(-46, -30),
              life: 1100, maxLife: 1100, glyph: STAR_GLYPH,
            });
          }
        } else {                                       // shake it off, stand up
          const k = (T.t - (T.dur - 450)) / 450;
          T.pose = k < 0.5 ? 'sit' : 'stand';
          T.yOffset = -Math.sin(Math.PI * k) * 8;
        }
        return T.t >= T.dur;
      }

      // ---- ultra-rare cameos ---------------------------------------------
      if (a === 'smitten') {                            // golden lady: enters, kisses, he faints
        const ENTER = 2000, LOOK = 3400, KISS = 3900, LAND = 4900, GIG = 5400, RUN = 6600, WAKE = 7700;
        const L = T.lady;
        if (!L) return T.t >= T.dur;
        // --- her ---
        if (T.t >= RUN) {                               // giggle's over — she bolts away
          if (!L.runInit) {
            L.runInit = true; L.dir = L.x >= T.x ? 1 : -1;
            const exitDist = (L.dir === 1 ? (W() - L.x) : L.x) + 90;
            L.runSpeed = Math.max(260, exitDist / 2.0);  // off-screen before the scene ends
          }
          L.mirror = L.dir < 0; L.x += L.dir * L.runSpeed * dt / 1000; L.yOff = 0;
          L.legT += dt; if (L.legT > 70) { L.legT = 0; L.legFlip = !L.legFlip; }
          L.pose = L.legFlip ? 'walkB' : 'walkA';
          if (L.x < -80 || L.x > W() + 80) L.gone = true;
        } else if (T.t >= GIG) {                        // giggles, bouncing, little hearts
          L.pose = 'giggle'; L.mirror = T.x < L.x;
          L.yOff = -Math.abs(Math.sin((T.t - GIG) / 120)) * 6;
          L.legT += dt;
          if (L.legT > 240) {
            L.legT = 0;
            T.hearts.push({ x: L.x + rand(-8, 8), y: groundY() - STAND_H * 0.85, vx: rand(-12, 12), vy: rand(-26, -16), life: 1300, maxLife: 1300, sc: 0.45 });
          }
        } else if (T.t >= LOOK) {                       // blows him a kiss
          L.pose = 'kiss'; L.mirror = T.x < L.x;
          L.yOff = -Math.abs(Math.sin((T.t - LOOK) / 170)) * 3;
          if (!T.heartSent && T.t >= KISS) {
            T.heartSent = true;
            const d = Math.sign(T.x - L.x) || -1;
            T.hearts.push({ x: L.x + d * 10, y: groundY() - STAND_H * 0.7, vx: d * rand(110, 140), vy: rand(-12, -2), kiss: true, life: 4000, maxLife: 4000, sc: 0.85 });
          }
        } else if (T.t >= ENTER) {                      // arrives, glances around
          L.pose = 'stand'; L.yOff = 0;
          L.mirror = (Math.floor((T.t - ENTER) / 430) % 2) === 0;
        } else {                                        // walks in
          const reached = L.dir === -1 ? L.x <= L.stopX : L.x >= L.stopX;
          if (!reached) {
            L.x += L.dir * L.speed * dt / 1000;
            if (L.dir === -1 ? L.x < L.stopX : L.x > L.stopX) L.x = L.stopX; // don't overshoot
            L.legT += dt; if (L.legT > 130) { L.legT = 0; L.legFlip = !L.legFlip; }
            L.pose = L.legFlip ? 'walkB' : 'walkA'; L.mirror = L.dir < 0;
          } else { L.pose = 'stand'; L.mirror = T.x < L.x; }
          L.yOff = 0;
        }
        // the kiss lands → swoon burst (once)
        if (!T.landed && T.t >= LAND) {
          T.landed = true;
          T.hearts = T.hearts.filter((h) => !h.kiss);
          for (let i = 0; i < 6; i++) T.hearts.push({
            x: T.x + rand(-12, 12), y: groundY() - STAND_H * 0.6,
            vx: rand(-40, 40), vy: rand(-95, -45), life: rand(800, 1300), maxLife: 1300, sc: rand(0.4, 0.7),
          });
        }
        // --- him ---
        if (T.t < LAND) {                               // stands smitten, facing her
          T.pose = 'stand'; T.shakeX = 0; T.mirror = L.x < T.x;
          T.yOffset = T.t >= KISS ? -Math.abs(Math.sin((T.t - KISS) / 120)) * 3 : 0;
        } else if (T.t < WAKE) {                        // keels over, hearts for eyes
          const ft = T.t - LAND; T.mirror = L.x < T.x;
          if (ft < 220) { T.pose = ft < 110 ? 'stretch' : 'stand'; T.yOffset = -Math.min(8, ft / 18); T.shakeX = rand(-2, 2); }
          else if (ft < 520) { T.pose = 'sit'; T.shakeX = 0; T.yOffset = 0; }
          else if (ft < (WAKE - LAND) - 420) {
            T.pose = 'laydown'; T.yOffset = 0; T.zTimer += dt;
            if (T.zTimer > 380) {
              T.zTimer = 0;
              T.hearts.push({ x: T.x + rand(-10, 10), y: groundY() - STAND_H * 0.42, vx: rand(-10, 10), vy: rand(-30, -18), life: 1200, maxLife: 1200, sc: 0.5 });
            }
          } else { const k = (ft - ((WAKE - LAND) - 420)) / 420; T.pose = k < 0.5 ? 'sit' : 'stand'; T.yOffset = -Math.sin(Math.PI * k) * 8; }
        } else {                                        // up again, watches her go
          T.pose = 'stand'; T.yOffset = 0; T.shakeX = 0; T.mirror = L.x < T.x;
        }
        if (T.t >= T.dur) T.lady = null;
        return T.t >= T.dur;
      }
      if (a === 'bloodDeath') {                         // kneels, vomits blood, dies, sinks
        const KNEEL = 700, VOMIT = 3200, FALL = 3800, SINK = 4500;
        const dir = T.dir; T.mirror = dir < 0;
        if (T.t < KNEEL) {                              // stagger to his knees
          if (T.t < 300) { T.pose = 'stand'; T.shakeX = rand(-3, 3); }
          else { T.pose = 'sit'; T.shakeX = rand(-1.5, 1.5); }
        } else if (T.t < VOMIT) {                       // retch up LOTS of blood
          T.pose = ((T.t - KNEEL) % 320 < 160) ? 'headDown' : 'sit';
          T.shakeX = rand(-3.5, 3.5);
          const p = (T.t - KNEEL) / (VOMIT - KNEEL);
          T.color = mix(0.35 + p * 0.65);              // getting drenched
          if (T.pool) T.pool.grow = Math.min(1, p * 1.35);
          T.poseT += dt;
          if (T.poseT > 42) {
            T.poseT = 0;
            const n = 12 + Math.floor(rand(0, 12));
            for (let i = 0; i < n; i++) {
              if (Math.random() < 0.42) {              // droplets splattering all around him
                const ang = rand(-Math.PI, 0), sp = rand(70, 300);
                T.confetti.push({
                  x: T.x + rand(-16, 16), y: groundY() - STAND_H * rand(0.15, 0.6),
                  vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
                  life: rand(500, 1300), size: Math.round(rand(2, 6)), color: RED,
                });
              } else {                                  // the main gush out of his mouth
                T.confetti.push({
                  x: T.x + dir * rand(2, 20), y: groundY() - STAND_H * 0.5,
                  vx: dir * rand(70, 250) + rand(-50, 50), vy: rand(-210, 70),
                  life: rand(600, 1500), size: Math.round(rand(3, 7)), color: RED,
                });
              }
            }
          }
        } else if (T.t < FALL) {                        // topples over dead — a big splash
          const k = (T.t - VOMIT) / (FALL - VOMIT);
          T.pose = k < 0.5 ? 'sit' : 'laydown'; T.color = RED; T.shakeX = 0;
          if (T.pool) T.pool.grow = 1;
          if (!T.sneezed) {                             // blood bursts out as he hits the ground
            T.sneezed = true;
            for (let i = 0; i < 46; i++) {
              const ang = rand(-Math.PI, 0), sp = rand(60, 360);
              T.confetti.push({
                x: T.x + rand(-18, 18), y: groundY() - 8,
                vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
                life: rand(500, 1400), size: Math.round(rand(2, 7)), color: RED,
              });
            }
          }
        } else {                                        // lies in it, then sinks under
          T.pose = 'laydown'; T.color = RED; T.shakeX = 0;
          if (T.t > SINK) {
            const s = Math.min(1, (T.t - SINK) / (T.dur - SINK));
            T.yOffset = s * STAND_H * 1.2;
            if (T.pool) T.pool.sink = s;
          }
        }
        if (T.t >= T.dur) T.pool = null;
        return T.t >= T.dur;
      }
      if (a === 'ufo') {                                // flies in from the side, beams him up
        const FLYIN = 1700, BEAM = 2400, LIFT = 4000;
        const hoverY = groundY() - STAND_H * 2.4;
        const liftH = STAND_H * 1.5;
        const U = T.ufo;
        if (!U) return T.t >= T.dur;
        U.y = hoverY;
        U.blink = (Math.floor(T.t / 220) % 2) === 0;
        if (T.t < FLYIN) {                              // cruise in from off-screen to above him
          const p = T.t / FLYIN, e = 1 - (1 - p) * (1 - p);
          U.x = U.startX + (T.x - U.startX) * e; U.beam = 0;
          T.pose = 'stand'; T.yOffset = 0; T.shakeX = 0; T.mirror = U.x < T.x;
        } else if (T.t < BEAM) {                        // hovers, beam on, he panics
          U.x = T.x; U.beam = (T.t - FLYIN) / (BEAM - FLYIN);
          T.pose = (Math.floor(T.t / 120) % 2) ? 'jump' : 'stand';
          T.yOffset = -Math.abs(Math.sin(T.t / 100)) * 4; T.shakeX = rand(-3, 3);
        } else if (T.t < LIFT) {                        // hauled up the beam, arms flailing
          U.x = T.x; U.beam = 1;
          const p = (T.t - BEAM) / (LIFT - BEAM);
          T.yOffset = -p * liftH;
          const fr = ['wave', 'pointUp', 'jump', 'stretch'];
          T.pose = fr[Math.floor(T.t / 90) % fr.length];
          T.shakeX = rand(-4, 4); T.mirror = (Math.floor(T.t / 140) % 2) === 0;
        } else {                                        // saucer + troll cruise off the far side
          const p = (T.t - LIFT) / (T.dur - LIFT);
          U.beam = Math.max(0, 1 - p * 3);
          U.x += U.dir * U.flySpeed * dt / 1000;
          T.x = U.x;                                    // he rides off under the saucer
          T.yOffset = -liftH - Math.sin(Math.min(1, p) * Math.PI) * 6;
          const fr = ['wave', 'pointUp', 'jump'];
          T.pose = fr[Math.floor(T.t / 90) % fr.length]; T.shakeX = rand(-3, 3);
        }
        if (T.t >= T.dur) T.ufo = null;
        return T.t >= T.dur;
      }
      if (a === 'dog') {                                // dog charges in, eats him, runs off
        const RUNIN = 1400, CHOMP = 2700, GULP = 3150;
        const D = T.dog;
        if (!D) return T.t >= T.dur;
        const dir = D.dir;
        if (T.t < RUNIN) {                              // dog bolts in toward him
          const reached = dir === 1 ? D.x >= D.stopX : D.x <= D.stopX;
          if (!reached) {
            D.x += dir * D.runSpeed * dt / 1000;
            if (dir === 1 ? D.x > D.stopX : D.x < D.stopX) D.x = D.stopX;
          }
          D.legT += dt; if (D.legT > 60) { D.legT = 0; D.legFlip = !D.legFlip; }
          D.mouth = T.t > RUNIN - 350 ? 'open' : 'run';  // jaws gape as it closes in
          T.pose = (Math.floor(T.t / 110) % 2) ? 'lookL' : 'lookR';
          T.mirror = D.x < T.x; T.yOffset = 0;
          T.shakeX = T.t > RUNIN - 400 ? rand(-3, 3) : 0;
        } else if (T.t < CHOMP) {                        // chomped & thrashed — he fights back
          D.mouth = 'open'; D.x = D.stopX + rand(-4, 4); // dog whips him around
          const p = (T.t - RUNIN) / (CHOMP - RUNIN);
          T.x = D.stopX + dir * 58 + rand(-4, 4);        // gripped at the mouth, struggling
          T.scale = 1 - p * 0.4;
          const fr = ['wave', 'pointUp', 'jump', 'stretch', 'kick'];
          T.pose = fr[Math.floor(T.t / 70) % fr.length];
          T.mirror = dir > 0; T.shakeX = rand(-5, 5);
          T.yOffset = -Math.abs(Math.sin(T.t / 55)) * 7;
          T.poseT += dt;
          if (T.poseT > 90) {                            // scuffle dust
            T.poseT = 0;
            for (let i = 0; i < 3; i++) T.confetti.push({
              x: T.x + rand(-12, 12), y: groundY() - STAND_H * rand(0.3, 0.7),
              vx: rand(-90, 90), vy: rand(-120, -20), life: rand(400, 800), size: Math.round(rand(2, 4)),
            });
          }
        } else if (T.t < GULP) {                         // gulp — dragged in and swallowed whole
          D.mouth = 'closed'; D.x = D.stopX;
          const p = (T.t - CHOMP) / (GULP - CHOMP);
          T.x = (D.stopX + dir * 58) * (1 - p) + D.stopX * p; // mouth → into the belly
          T.scale = Math.max(0, 0.6 * (1 - p)); T.yOffset = 0; T.shakeX = rand(-2, 2);
          if (p > 0.5) D.full = true;
        } else {                                         // trots off with him in its belly
          D.full = true; D.mouth = 'closed';
          D.x += dir * D.awaySpeed * dt / 1000;
          D.legT += dt; if (D.legT > 70) { D.legT = 0; D.legFlip = !D.legFlip; }
          T.scale = 0;                                   // he's gone (inside the dog)
        }
        if (T.t >= T.dur) T.dog = null;
        return T.t >= T.dur;
      }
      if (a === 'stomp') {                              // ( shift+x — surprise )
        const LOOK = 450, DROP = 620, HOLD = 1450, LIFT = 2250;
        const B = T.boot;
        if (!B) return T.t >= T.dur;
        const soleY = groundY() - 12, topOff = -60;
        if (T.t < LOOK) {                               // just minding his business
          B.y = topOff; B.shown = false;
          T.pose = 'stand'; T.yOffset = 0; T.shakeX = 0;
        } else if (T.t < DROP) {                        // it SLAMS down out of nowhere
          const p = (T.t - LOOK) / (DROP - LOOK);
          B.y = topOff + (soleY - topOff) * (p * p); B.shown = true;
          T.pose = 'pointUp'; T.shakeX = rand(-1, 1);
        } else if (T.t < HOLD) {                        // flattened to a pancake
          B.y = soleY; B.shown = true;
          if (!T.landed) {                              // splat — dust kicks out both ways
            T.landed = true;
            for (let i = 0; i < 30; i++) {
              const s = Math.random() < 0.5 ? -1 : 1;
              T.confetti.push({ x: T.x + rand(-10, 10), y: groundY() - 6, vx: s * rand(60, 290), vy: rand(-130, -10), life: rand(400, 950), size: Math.round(rand(2, 5)) });
            }
          }
          T.pose = 'pancake'; T.yOffset = 0;
          T.shakeX = rand(-2, 2) * Math.max(0, 1 - (T.t - DROP) / 380);
        } else if (T.t < LIFT) {                        // boot peels back off the top
          const p = (T.t - HOLD) / (LIFT - HOLD);
          B.y = soleY + (topOff - soleY) * (p * p); B.shown = true;
          T.pose = 'pancake'; T.shakeX = 0; T.yOffset = 0;
        } else {                                        // he slowly re-inflates, sees stars
          B.shown = false;
          const r = (T.t - LIFT) / (T.dur - LIFT);
          if (r < 0.42) { T.pose = 'pancake'; T.yOffset = 0; }
          else if (r < 0.6) { T.pose = 'squash'; T.yOffset = 0; }
          else if (r < 0.74) { T.pose = 'sit'; T.yOffset = 0; }
          else if (r < 0.86) { T.pose = 'stretch'; T.yOffset = -Math.sin(Math.PI * (r - 0.74) / 0.12) * 11; }
          else { T.pose = 'stand'; T.yOffset = 0; }
          if (r > 0.42 && r < 0.84) {
            T.zTimer += dt;
            if (T.zTimer > 220) {
              T.zTimer = 0;
              T.zzz.push({ x: T.x + rand(-16, 16), y: groundY() - STAND_H * 0.5, vx: rand(-22, 22), vy: rand(-42, -26), life: 1000, maxLife: 1000, glyph: STAR_GLYPH });
            }
          }
        }
        if (T.t >= T.dur) T.boot = null;
        return T.t >= T.dur;
      }

      // ---- click reactions ------------------------------------------------
      if (a === 'pstartle') {                          // jolt: squash, big pop, land
        if (T.t < 120) { T.pose = 'squash'; }
        else if (T.t < 520) {
          T.pose = 'jump';
          T.yOffset = -Math.sin(Math.PI * (T.t - 120) / 400) * 56;
          T.shakeX = rand(-2, 2);
        } else if (T.t < 640) { T.pose = 'squash'; }
        else { T.pose = 'stand'; }
        return T.t >= T.dur;
      }
      if (a === 'pshakeHead') {                         // emphatic "no"
        T.poseT += dt; if (T.poseT > 90) { T.poseT = 0; T.poseFlip = !T.poseFlip; }
        T.pose = T.poseFlip ? 'lookL' : 'lookR';
        T.shakeX = (T.poseFlip ? -1 : 1) * 3;
        T.yOffset = -Math.abs(Math.sin(T.t / 70)) * 2;
        if (T.t > T.dur - 200) { T.pose = 'stand'; T.shakeX = 0; }
        return T.t >= T.dur;
      }
      if (a === 'pflee') {                              // startled, then bolts off-screen
        if (T.t < 200) { T.pose = 'jump'; T.yOffset = -Math.sin(Math.PI * T.t / 200) * 20; }
        else {
          T.mirror = T.dir < 0; T.x += T.dir * T.speed * dt / 1000;
          animLegs(dt, 'walkA', 'walkB', 55); T.yOffset = 0;
        }
        return T.x < -off || T.x > W() + off;
      }
      if (a === 'pangry') {                             // flush red, puff up, shake, fade back
        const ramp = 260, calm = 420;
        const k = T.t < ramp ? T.t / ramp
          : T.t < T.dur - calm ? 1 : Math.max(0, 1 - (T.t - (T.dur - calm)) / calm);
        T.color = mix(k); T.scale = 1 + k * 0.45; T.pose = 'stand';
        if (k > 0.6) {
          T.shakeX = rand(-5, 5);
          T.poseT += dt;
          if (T.poseT > 110) {                          // steam puffs off his head
            T.poseT = 0;
            for (let i = 0; i < 3; i++) T.confetti.push({
              x: T.x + rand(-18, 18), y: groundY() - STAND_H * 1.1,
              vx: rand(-40, 40), vy: rand(-160, -70),
              life: rand(500, 900), size: Math.round(rand(3, 6)), color: RED,
            });
          }
        } else { T.shakeX *= 0.7; }
        return T.t >= T.dur;
      }
      if (a === 'pspin') {                              // dizzy whirl, then see stars
        if (T.t < T.dur - 500) {
          T.pose = (Math.floor(T.t / 70) % 2) ? 'cartX' : 'cartPlus';
          T.yOffset = -Math.abs(Math.sin(T.t / 90)) * 4;
        } else {
          T.pose = 'stand'; T.zTimer += dt;
          if (T.zTimer > 320) {
            T.zTimer = 0;
            T.zzz.push({
              x: T.x + rand(-22, 22), y: groundY() - STAND_H * 0.9,
              vx: rand(-24, 24), vy: rand(-44, -30),
              life: 1000, maxLife: 1000, glyph: STAR_GLYPH,
            });
          }
        }
        return T.t >= T.dur;
      }
      if (a === 'psplat') {                             // bopped flat, boings back up
        if (T.t < 160) { T.pose = 'squash'; }
        else if (T.t < 360) { T.pose = 'stretch'; T.yOffset = -Math.sin(Math.PI * (T.t - 160) / 200) * 30; }
        else if (T.t < 520) { T.pose = 'squash'; }
        else { T.pose = 'stand'; }
        return T.t >= T.dur;
      }
      if (a === 'pbounce') {                            // knocked into a ball, bounces lower
        const period = 360, n = Math.floor(T.t / period), decay = Math.max(0.15, 1 - n * 0.28);
        const phase = (T.t % period) / period;
        T.yOffset = -Math.abs(Math.sin(Math.PI * phase)) * 60 * decay;
        T.pose = T.yOffset < -6 ? 'ball' : 'ball2';
        if (T.t > T.dur - 200) T.pose = 'stand';
        return T.t >= T.dur;
      }
      if (a === 'ptantrum') {                           // red-faced flailing fit, flings bits
        const calm = 450;
        const k = T.t < T.dur - calm ? 1 : Math.max(0, 1 - (T.t - (T.dur - calm)) / calm);
        T.color = mix(k * 0.9);
        const frames = ['wave', 'headDown', 'pointUp', 'jump'];
        T.pose = k > 0.2 ? frames[Math.floor(T.t / 80) % frames.length] : 'stand';
        T.shakeX = rand(-5, 5) * k;
        T.yOffset = -Math.abs(Math.sin(T.t / 60)) * 8 * k;
        T.legT += dt;
        if (k > 0.5 && T.legT > 120) {
          T.legT = 0;
          for (let i = 0; i < 3; i++) T.confetti.push({
            x: T.x + rand(-10, 10), y: groundY() - 6,
            vx: rand(-120, 120), vy: rand(-260, -120),
            life: rand(500, 900), size: Math.round(rand(2, 5)),
            color: Math.random() < 0.5 ? RED : GREEN,
          });
        }
        return T.t >= T.dur;
      }
      if (a === 'pblush') {                             // caught off guard — flushes, looks away
        const ramp = 300, calm = 400;
        const k = T.t < ramp ? T.t / ramp
          : T.t < T.dur - calm ? 0.8 : Math.max(0, 0.8 * (1 - (T.t - (T.dur - calm)) / calm));
        T.color = mix(k);
        T.pose = (Math.floor(T.t / 420) % 2 === 0) ? 'lookL' : 'lookR';
        T.yOffset = -Math.abs(Math.sin(T.t / 200)) * 2;
        return T.t >= T.dur;
      }

      if (a === 'walkOff' || a === 'runOff') {
        T.mirror = T.dir < 0; T.x += T.dir * T.speed * dt / 1000;
        animLegs(dt, 'walkA', 'walkB', a === 'runOff' ? 70 : 140);
        return T.x < -off || T.x > W() + off;
      }
      if (a === 'burrow') {
        T.pose = 'stand';
        if (T.t >= 500) T.yOffset = ((T.t - 500) / 1200) * STAND_H;
        return T.t >= T.dur;
      }
      if (a === 'fadeShake') {                          // shivers ever harder, then fades out
        const k = T.t / T.dur;
        T.pose = 'stand';
        T.shakeX = rand(-1, 1) * (3 + k * 14);
        T.yOffset = -Math.abs(Math.sin(T.t / 40)) * 3 * k;
        T.alpha = Math.max(0, 1 - k * k);
        return T.t >= T.dur;
      }
      if (a === 'shrinkOut') {                          // curls up and shrinks to a poof
        const k = T.t / T.dur;
        T.pose = k > 0.6 ? 'ball' : 'stand';
        T.scale = Math.max(0, 1 - k);
        T.yOffset = -Math.sin(Math.PI * k) * 6;
        if (k > 0.97 && !T.sneezed) { T.sneezed = true; spawnConfetti(T.x, groundY() - 6); }
        return T.t >= T.dur;
      }
      if (a === 'cartwheelOff') {                       // cartwheels off the nearest edge
        T.x += T.dir * T.speed * dt / 1000;
        T.poseT += dt; if (T.poseT > 90) { T.poseT = 0; T.poseFlip = !T.poseFlip; }
        T.pose = T.poseFlip ? 'cartX' : 'cartPlus';
        return T.x < -off || T.x > W() + off;
      }
      if (a === 'rollOff') {                            // balls up and rolls off the edge
        T.x += T.dir * T.speed * dt / 1000;
        T.poseT += dt; if (T.poseT > 55) { T.poseT = 0; T.poseFlip = !T.poseFlip; }
        T.pose = T.poseFlip ? 'ball' : 'ball2';
        return T.x < -off || T.x > W() + off;
      }
      if (a === 'hopOff') {                             // bunny-hops off the edge
        T.mirror = T.dir < 0; T.x += T.dir * T.speed * dt / 1000;
        const phase = (T.t % 360) / 360;
        T.yOffset = -Math.abs(Math.sin(Math.PI * phase)) * 26;
        T.pose = T.yOffset < -5 ? 'jump' : 'squash';
        return T.x < -off || T.x > W() + off;
      }
      if (a === 'rocketOff') {                          // crouch, then blast straight up
        if (T.t < 360) {
          T.pose = T.t < 180 ? 'sit' : 'squash'; T.shakeX = rand(-3, 3);
        } else {
          const k = (T.t - 360) / (T.dur - 360);
          T.pose = 'pointUp'; T.shakeX = rand(-2, 2);
          T.yOffset = -k * k * (canvas.height + 40);   // accelerate up and off the top
          T.poseT += dt;
          if (T.poseT > 40) {                           // exhaust trail under his feet
            T.poseT = 0;
            for (let i = 0; i < 4; i++) T.confetti.push({
              x: T.x + rand(-8, 8), y: groundY() + T.yOffset,   // at his feet as he climbs
              vx: rand(-50, 50), vy: rand(60, 200),
              life: rand(300, 700), size: Math.round(rand(2, 5)),
            });
          }
        }
        return T.t >= T.dur;
      }
      if (a === 'blinkOut') {                           // glitch-flickers and vanishes
        const k = T.t / T.dur;
        T.pose = 'stand';
        const blink = Math.sin(T.t / (60 - k * 45));    // strobe faster over time
        T.alpha = (blink > 0 && k < 0.96) ? Math.max(0, 1 - k) : 0;
        T.shakeX = blink > 0.9 ? rand(-10, 10) * k : 0;
        return T.t >= T.dur;
      }
      return true;
    }

    function blit(rows, cx, feetY, scale, mirror, yOff = 0) {
      const w = spriteW(rows), h = rows.length, px = PIXEL * scale, size = Math.ceil(px);
      const left = cx - (w * px) / 2, top = feetY - h * px + yOff;
      for (let r = 0; r < h; r++) {
        const row = rows[r];
        for (let c = 0; c < row.length; c++) {
          if (row[c] !== '#') continue;
          const cc = mirror ? (w - 1 - c) : c;
          ctx.fillRect(Math.round(left + cc * px), Math.round(top + r * px), size, size);
        }
      }
    }

    function drawEntities(dt) {
      ctx.fillStyle = GREEN;

      // baby troll
      if (T.baby) {
        const b = T.baby; b.t += dt; b.x += b.dir * b.speed * dt / 1000;
        if (b.x < 20) b.dir = 1; if (b.x > W() - 20) b.dir = -1;
        b.legT += dt; if (b.legT > 85) { b.legT = 0; b.legFlip = !b.legFlip; }
        blit(b.legFlip ? POSES.walkB : POSES.walkA, b.x, groundY(), 0.5, b.dir < 0);
        if (b.t >= b.life) { spawnConfetti(b.x, groundY() - STAND_H * 0.35); T.baby = null; }
      }

      // blood pool (bloodDeath) — a wide puddle that grows, then sinks into the ground
      if (T.pool) {
        ctx.fillStyle = RED;
        const hw = 74 * T.pool.grow, baseY = groundY() - 7 + T.pool.sink * STAND_H * 1.2;
        if (hw > 1) {
          ctx.fillRect(Math.round(T.pool.x - hw * 0.4), Math.round(baseY - 3), Math.round(hw * 0.8), 4);
          ctx.fillRect(Math.round(T.pool.x - hw), Math.round(baseY), Math.round(hw * 2), 7);
          ctx.fillRect(Math.round(T.pool.x - hw * 0.7), Math.round(baseY + 7), Math.round(hw * 1.4), 5);
          ctx.fillRect(Math.round(T.pool.x - hw - 11), Math.round(baseY + 2), 7, 5);
          ctx.fillRect(Math.round(T.pool.x + hw + 5), Math.round(baseY + 1), 7, 5);
        }
        ctx.fillStyle = GREEN;
      }

      // the golden lady (smitten cameo)
      if (T.lady && !T.lady.gone) {
        ctx.fillStyle = GOLD;
        blit(LADY[T.lady.pose] || LADY.stand, T.lady.x, groundY(), 1, T.lady.mirror, T.lady.yOff || 0);
        ctx.fillStyle = GREEN;
      }

      // confetti
      for (let i = T.confetti.length - 1; i >= 0; i--) {
        const p = T.confetti[i];
        p.vy += 720 * dt / 1000; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.life -= dt;
        if (p.life <= 0 || p.y > groundY() + 30) { T.confetti.splice(i, 1); continue; }
        ctx.fillStyle = p.color || GREEN;
        ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }

      // floating hearts (kiss + swoon + giggle)
      ctx.fillStyle = HEART;
      for (let i = T.hearts.length - 1; i >= 0; i--) {
        const p = T.hearts[i];
        p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.life -= dt;
        if (p.life <= 0) { T.hearts.splice(i, 1); continue; }
        const sc = (p.sc || 0.5) * (0.7 + 0.3 * (p.life / p.maxLife));
        blit(HEART_GLYPH, p.x, p.y, sc, false);
      }
      ctx.fillStyle = GREEN;

      // floating Z's / notes / stars — each drifts on its own velocity so they
      // fan apart instead of stacking, and they stay small.
      ctx.fillStyle = GREEN;
      for (let i = T.zzz.length - 1; i >= 0; i--) {
        const z = T.zzz[i];
        z.x += (z.vx ?? 12) * dt / 1000; z.y += (z.vy ?? -42) * dt / 1000; z.life -= dt;
        if (z.life <= 0) { T.zzz.splice(i, 1); continue; }
        const sc = 0.38 + (1 - z.life / z.maxLife) * 0.32;
        blit(z.glyph || Z_GLYPH, z.x, z.y, sc, false);
      }

      // UFO (abduction cameo): translucent tractor beam, then the saucer on top
      if (T.ufo) {
        const U = T.ufo;
        if (U.beam > 0) {
          ctx.globalAlpha = 0.16 * U.beam;
          ctx.fillStyle = '#bdf7d6';
          ctx.beginPath();
          ctx.moveTo(U.x - 11, U.y); ctx.lineTo(U.x + 11, U.y);
          ctx.lineTo(U.x + 36, groundY()); ctx.lineTo(U.x - 36, groundY());
          ctx.closePath(); ctx.fill();
          ctx.globalAlpha = 1;
        }
        ctx.fillStyle = GREEN;
        blit(U.blink ? UFO : UFO2, U.x, U.y, 1.6, false, 0);
      }

      // the big dog (eats-him-whole cameo) — drawn over the troll so he vanishes into it
      if (T.dog) {
        const D = T.dog;
        ctx.fillStyle = GREEN;
        const sprite = D.mouth === 'open' ? DOG_OPEN : (D.legFlip ? DOG2 : DOG);
        blit(sprite, D.x, groundY(), 1.8, D.dir < 0, 0);
        if (D.full) ctx.fillRect(Math.round(D.x - 14), Math.round(groundY() - 47), 28, 17); // full belly
      }

      // ( shift+x cameo ) — drawn over him
      if (T.boot && T.boot.shown) {
        ctx.fillStyle = GREEN;
        blit(BOOT, T.x, T.boot.y, 2.6, false, 0);
      }
    }

    let raf, last = performance.now();
    function loop(now) {
      const dt = Math.min(50, now - last); last = now;
      // On hidden pages (admin) the troll freezes in place — state carries over,
      // he just doesn't wander or draw until we're back on a visible page.
      if (hiddenRef.current) { raf = requestAnimationFrame(loop); return; }
      // Glide the floor toward its target (the trim bar's top edge when present,
      // else the screen bottom) so he rises / settles smoothly instead of snapping.
      const targetFloor = computeFloor();
      T.floorY += (targetFloor - T.floorY) * Math.min(1, dt / 120);
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      if (T.mode === 'away') {
        if (now >= T.nextVisit) { planVisit(); beginNext(now); }
      } else {
        const done = stepAction(dt);
        ctx.fillStyle = T.color;
        ctx.globalAlpha = T.alpha;
        blit(POSES[T.pose] || STAND, T.x + T.shakeX, groundY(), T.scale, T.mirror, T.yOffset);
        ctx.globalAlpha = 1;
        if (done) beginNext(now);
      }

      drawEntities(dt);
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    // Click the troll → he busts out one of ten random poke-reactions (topples
    // over dazed, shakes his head, flushes red, bolts off, splats flat, ...).
    // Works anytime (not gated to generating). The canvas stays pointer-events:none
    // so the page underneath keeps its clicks; we just hit-test his bounding box.
    function onClick(e) {
      if (hiddenRef.current || T.mode === 'away') return;
      if (CLICK_SET.has(T.action) || SPECIALS.has(T.action)) return; // don't interrupt a reaction or a cameo
      const rows = POSES[T.pose] || STAND;
      const px = PIXEL * T.scale;
      const w = spriteW(rows) * px, h = rows.length * px;
      const cx = T.x + T.shakeX, feetY = groundY();
      const canvasTop = window.innerHeight - canvas.height; // canvas sits at bottom:0
      const pad = 14;
      const left = cx - w / 2 - pad, right = cx + w / 2 + pad;
      const vTop = canvasTop + (feetY - h + T.yOffset) - pad;
      const vBottom = canvasTop + feetY + pad;
      if (e.clientX >= left && e.clientX <= right && e.clientY >= vTop && e.clientY <= vBottom) {
        startAction(pick(CLICK_REACTS), performance.now());
      }
    }
    window.addEventListener('click', onClick);

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('click', onClick);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed', left: 0, bottom: 0, width: '100vw', zIndex,
        pointerEvents: 'none', imageRendering: 'pixelated',
        display: hidden ? 'none' : 'block',
      }}
    />
  );
}
