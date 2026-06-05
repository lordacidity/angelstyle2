// All of the troll's pixel art, plus the two sprite-coupled scale constants
// (MEAT_PIXEL, COP_SCALE). '#' = a filled pixel; the colour is chosen at draw
// time over in ../PixelTroll. Pure data — nothing here reads component state.
// (Palette + helpers live in ./constants, speech-bubble text in ./speech.)
//
// To add a new pose: drop a name → rows entry into POSES, then drive it from a
// case in stepAction (../PixelTroll). Rows are equal-width strings; widths can
// differ between poses (spriteW handles it).

// ---- sprite art (# = green) ----------------------------------------------
const EYE_C = '.##.####.##.';
const EYE_L = '.#.####.###.';
const EYE_R = '.###.####.#.';

export const STAND = [
  '.#..#..#..#.', '..########..', '.##########.', '.##########.', EYE_C,
  '.##########.', '..########..', '#..######..#', '.##########.', '..########..',
  '...######...', '...#....#...', '...#....#...', '..##....##..',
];
const withEye = (row) => STAND.map((r, i) => (i === 4 ? row : r));
const legs = (a, b, c) => STAND.map((r, i) => (i === 11 ? a : i === 12 ? b : i === 13 ? c : r));

export const POSES = {
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
export const BOOT = [
  '.####......', '.####......', '.####......', '.####......', '.####......',
  '.#####.....', '.######....', '.#######...', '.########..', '.#########.',
  '.##########', '###########', '###########',
];

export const Z_GLYPH = ['#####', '...#.', '..#..', '.#...', '#####'];
export const NOTE_GLYPH = ['...##', '..#.#', '..#.#', '..#..', '###..', '###..'];
export const STAR_GLYPH = ['..#..', '#.#.#', '.###.', '#.#.#', '..#..'];
export const HEART_GLYPH = ['.#.#.', '#####', '#####', '.###.', '..#..'];

// flying saucer (two frames = blinking under-lights)
export const UFO = [
  '....######....', '...########...', '..##########..', '##############', '#.#.#.#.#.#.#.',
];
export const UFO2 = [
  '....######....', '...########...', '..##########..', '##############', '.#.#.#.#.#.#.#',
];

// a little parachute canopy (drawn above him, with strings, when he floats down)
export const CHUTE = [
  '...########...', '..##########..', '.############.', '##############', '#.##.##.##.##.',
];

// ---- food (shift+click → a chunk of meat appears right where you clicked and
// drops to the floor; he runs over and wolfs it down). These are the ONE thing
// he's drawn in more than one colour: small, detailed, Minecraft-style cuts —
// each a chunky lump with a dark outline ('o'), a top-left highlight, the body,
// and a bottom-right shadow. Every char keys into MEAT_COLORS; '.' is empty.
export const MEAT_PIXEL = 3;
export const MEAT_COLORS = {
  o: '#2e1a0f',                       // dark outline (shared)
  p: '#b06a38', P: '#d89154', q: '#7d4322',   // pork: body / highlight / shadow
  r: '#9c4530', R: '#bf6446', t: '#6c2a1d',   // beef (steak + t-bone): body / highlight / seared edge
  c: '#d3a55c', C: '#ecca84', v: '#a87a38',   // chicken: body / highlight / shadow
  f: '#e7c9a0',                       // fat / marbling streaks
  b: '#efe6cd', B: '#cdbf9b',         // bone: light / shadow
};
// Proper cuts, not blobs: a chop on the bone, a marbled slab, a drumstick, a T-bone.
const MEAT_PORKCHOP = [               // meat on a bone (ham-hock silhouette)
  '...oooo...', '..oPPppo..', '.oPPpppqo.', '.oPppppqo.', '.oppppqqo.',
  '.oqppqqqo.', '..oqpqqo..', '...obbo...', '..obBBbo..', '..obBBbo..', '...obbo...',
];
const MEAT_STEAK = [                  // marbled ribeye slab, seared edge
  '...oooooo...', '..otttttto..', '.ottRRRRtto.', '.otRrffrRto.', '.otRrffrRto.',
  '.otRrffrRto.', '.ottRRRRtto.', '..otttttto..', '...oooooo...',
];
const MEAT_DRUMSTICK = [              // chicken leg: meaty bulb + bone handle
  '...ooo....', '..oCCco...', '.oCCccvo..', '.oCccccvo.', '.oCcccvvo.',
  '.oqcccvo..', '..ovcvo...', '...obo....', '..obbbo...', '..obBbo...', '...ooo....',
];
const MEAT_TBONE = [                  // T-bone steak: a slab with the bone through it
  '.ooooooooo.', 'otbbbbbbbto', 'otrrrbrrrto', 'otRrrbrrRto', 'otrrrbrrrto',
  'otRrrbrrRto', 'ottrrbrrtto', '.ooooooooo.',
];
export const MEATS = [
  { name: 'porkchop', rows: MEAT_PORKCHOP },
  { name: 'steak', rows: MEAT_STEAK },
  { name: 'drumstick', rows: MEAT_DRUMSTICK },
  { name: 'tbone', rows: MEAT_TBONE },
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
export const LADY = {
  stand: LADY_STAND,
  walkA: ladyLegs('..##....#....'),
  walkB: ladyLegs('....#....##..'),
  kiss: LADY_KISS,
  giggle: LADY_GIGGLE,
};

// ---- the big dog (ultra-rare cameo): runs in, eats him whole, trots off ----
// faces right (snout/nose on the right); mirror it to face left. 24 wide, 14 tall.
// curled tail (left), pointed ear, eye gap, snout + nose, four legs w/ paws.
export const DOG = [
  '..##............###.....', '.####..........#####....', '.####.........#######...',
  '.#####..##############..', '.#################.####.', '.######################.',
  '.######################.', '.#####################..', '.###################....',
  '..###.###....###.###....', '..###.###....###.###....', '..###.###....###.###....',
  '..##..##.....##..##.....', '..##..##.....##..##.....',
];
export const DOG2 = [                                      // mid-run — legs swing fore/aft
  '..##............###.....', '.####..........#####....', '.####.........#######...',
  '.#####..##############..', '.#################.####.', '.######################.',
  '.######################.', '.#####################..', '.###################....',
  '...###..##.....###..##..', '..####..##....####..##..', '.###...###...###...###..',
  '.##....##....##....##...', '##.....##....##....##...',
];
export const DOG_OPEN = [                                  // jaws gaping open at the snout
  '..##............###.....', '.####..........#####....', '.####.........#######...',
  '.#####..##############..', '.#################.####.', '.####################.#.',
  '.##############....####.', '.################..###..', '.###################....',
  '..###.###....###.###....', '..###.###....###.###....', '..###.###....###.###....',
  '..##..##.....##..##.....', '..##..##.....##..##.....',
];

// ---- the policeman (shows up only when he's SUPER furious with you): a green
// troll cop in a blue uniform — peaked cap with a gold badge, a chest badge, and
// dark trousers/shoes. Takes notes while the troll complains. Faces left by
// default. ~12×15. Char-keyed (drawn via drawCop), so each char picks a colour
// from COP_COLORS; '.' is empty. k=cap, o=brim/belt/shoes, f=green face/hands,
// u=blue uniform, b=gold badge.
export const COP_SCALE = 1.1;
export const COP_COLORS = {
  o: '#0e1a3a',   // near-black navy: cap brim, belt, shoes
  k: '#1d2f5e',   // cap navy
  u: '#2f4d96',   // uniform blue
  b: '#ffd24a',   // badge / button gold
  f: '#00e676',   // green troll skin (face / hands)
};
export const POLICE = [
  '...kkkkkk...', '..kkkbbkkk..', '.oooooooooo.', '...ffffff...', '...f.ff.f...',
  '...ffffff...', '..uuuuuuuu..', '.uuu.buuu.u.', 'uu..uuuuuu..', 'uu..uuuuuu..',
  '.u..uuuuuu..', '....oooo....', '...uu..uu...', '...uu..uu...', '...oo..oo...',
];
export const POLICE_WRITE = [                              // pencil hand dips to scribble
  '...kkkkkk...', '..kkkbbkkk..', '.oooooooooo.', '...ffffff...', '...f.ff.f...',
  '...ffffff...', '..uuuuuuuu..', '.uubuu.uuu.u', 'uu..uuuuuu.u', 'uu..uuuuuu..',
  '.u..uuuuuu..', '....oooo....', '...uu..uu...', '...uu..uu...', '...oo..oo...',
];

// ---- collectibles: little items he digs up (bone / worm / chest / coin) or
// leaves you as gifts when he loves you (flower / heart / coin / star). Each is a
// tiny single-colour glyph; click one on the floor to collect it. (drawn via a
// mini blitter; '#' = the item's colour.)
export const GIFT_PIXEL = 4;
export const GIFT_ART = {
  coin:   { color: '#ffd24a', rows: ['.###.', '#####', '##.##', '#####', '.###.'] },
  flower: { color: '#ff6b9d', rows: ['.#.#.', '#####', '.###.', '..#..', '.###.'] },
  heart:  { color: '#ff6b9d', rows: ['.#.#.', '#####', '#####', '.###.', '..#..'] },
  star:   { color: '#ffd24a', rows: ['..#..', '#.#.#', '.###.', '#.#.#', '..#..'] },
  bone:   { color: '#efe6cd', rows: ['##.##', '#####', '..#..', '#####', '##.##'] },
  chest:  { color: '#c98a4b', rows: ['.####.', '######', '##.###', '######'] },
  worm:   { color: '#ff8fbf', rows: ['.##...', '####..', '.####.', '..####', '...##.'] },
};
export const DIG_FINDS = ['bone', 'worm', 'chest', 'coin'];     // what turns up when he digs
export const LOVE_GIFTS = ['flower', 'heart', 'coin', 'star'];  // what he leaves you when smitten with you

// ---- THE MONSTER (kill the troll in front of the cop and, three minutes later,
// he claws back: drinks a potion, shakes to pieces, and erupts into a giant
// horned red beast that rampages over the widgets). A big, detailed, hideous
// thing — char-keyed (drawn via blitKeyed): o=dark outline, r=body red,
// R=highlight, d=dark bruise/shadow, h=horn bone, H=horn shadow, e=glowing eye,
// p=pupil, t=fangs, m=mouth/maw, g=gums/tongue, k=back-/shoulder-spikes,
// c=claws/talons. 20 wide; the last four rows are the leg stance (swapped for the
// two walk frames). ----------------------------------------------------------------
export const MONSTER_SCALE = 2.2;
export const MONSTER_COLORS = {
  o: '#1d0606', r: '#c2241f', R: '#ec5a4c', d: '#7a1414',
  h: '#efe6cd', H: '#b39256', e: '#ffe14d', p: '#160404',
  t: '#fff8e6', m: '#2a0606', g: '#8a1f3a', k: '#2c1822', c: '#f2e8c8',
};
const M_BODY = [
  'h..................h', 'Hho..............ohH', 'oHho............ohHo', '.oHho..........ohHo.',
  '..oHho........ohHo..', '..oHhoo......oohHo..', '..ooorooooooorooo...', '..orrrrrrrrrrrrro...',
  '..orddddddddddddro..', '..oreeprrrrrrpeero..', '..orepprddddrppero..', '..orrRRRRRRRRRRrro..',
  '..orrrrrddddrrrrro..', '..orrrrrrrrrrrrrro..', '.oottttttttttttttoo.', '.otmtgtgtgtgtgtmto..',
  '.ottgmgmgmgmgmgtto..', '..ottttttttttttto...', '..ooooooooooooooo...', 'kkorrrrrrrrrrrroko..',
  'crrdRRRRRRRRRRdrrc..', '.crrrrddddddrrrrc...', '..orrddrrrrddrrro...', '..orrrrrrrrrrrrro...',
];
const M_LEGS_STAND = ['....orr......rro....', '....orr......rro....', '....crr......rrc....', '....ccc......ccc....'];
const M_LEGS_A = ['...orr........rro...', '...orr........rro...', '...crr........rrc...', '...ccc........ccc...'];
const M_LEGS_B = ['.....orr....rro.....', '.....orr....rro.....', '.....crr....rrc.....', '.....ccc....ccc.....'];
export const MONSTER = [...M_BODY, ...M_LEGS_STAND];
export const MONSTER_WALK_A = [...M_BODY, ...M_LEGS_A];
export const MONSTER_WALK_B = [...M_BODY, ...M_LEGS_B];

// the potion he downs right before the change (raised to his mouth, then glugged).
export const POTION_COLORS = { o: '#10231a', g: '#bfe9d6', l: '#b46bff', k: '#8a5a2b' };
export const POTION = ['..k..', '..k..', '.ggg.', '.glg.', 'glllg', 'glllg', '.ggg.'];

// ---- DEATH (shoot the monster five times and he finally drops): he keels over and
// lies on his SIDE — a deflated profile you can still read as him: horns up, a shut
// eye, the slack fanged jaw, a caved-in belly, limbs splayed, tail trailing. Over a
// few minutes he rots to a skeleton while wildflowers bloom and butterflies gather,
// then sinks into the earth as the flowers stay. The corpse reuses MONSTER_COLORS;
// the skeleton has its own bone palette. 30 wide, facing left. --------------------
export const MONSTER_CORPSE = [
  '..h.....h.....................', '..hH...Hh.....................', '.ohHrrrHho....................',
  '.orrrrrrro.......oooooo.......', '.oprrrrrro.....oorrrrrroo.....', 'oomggrttto..oorrrrrrrrrroo....',
  '.ottttoorrrrrrrrrrrrrrrrrro...', '.orrrrrrrrrddddddddrrrrrrro...', '.orrrrrrrrrrrrrrrrrrrrrrrro...',
  '.orrrrrrrrrrrrrrrrrrrrrrrro...', '.occooccooccooccooccooccco....',
];
export const SKELETON_COLORS = { o: '#3a352c', b: '#efe6cd', B: '#cdbf9b', h: '#d8c89a', e: '#1a1712' };
export const SKELETON = [
  '..h.....h.....................', '..bh...hb.....................', '.obbbbbbbo....................',
  '.obbeebbbo......bbbbbb........', '.obbbbbbbo...bbbbbbbbbbb......', 'oobbbobbbo.bb.b.b.b.b.b.bbb...',
  '.obbbbbo..bbbbbbbbbbbbbbbbb...', '..ooo...b.b.b.b.b.b.b.b.b.....', '........bbb..bbb..bbb..bbb....',
  '........bb...bb...bb...bb.....', '........oooooooooooooooooo....',
];

// ---- GARDEN WILDLIFE: the meadow that springs up after the beast falls grows for
// a quarter-hour into pockets of forest, and now and then a critter wanders across.
// Both are char-keyed (drawn via blitKeyed), facing RIGHT (mirrored when they head
// left). The rabbit hops (two poses — crouched on the ground, splayed mid-leap); the
// deer trots (two leg frames). w=fur/coat, g=fur shadow, e=eye, p=pink nose/ear,
// t=fluffy tail. ------------------------------------------------------------------
export const RABBIT_COLORS = { w: '#edece7', g: '#c3c0b7', e: '#1a1712', p: '#f2a6bd', t: '#f8f6f1' };
export const RABBIT = [               // crouched / landing
  '.......w.w', '.......p.p', '.......www', 'tt....wwwe',
  'twwwwwwwwp', '.wwwwwwww.', '.gg..gg...', '.gg..gg...',
];
export const RABBIT_HOP = [           // stretched out mid-leap, legs fore & aft
  '........ww', '........pp', '.......www', '.....wwwwe',
  'tt..wwwwwp', '.wwwwwwww.', 'gg......gg', '.g......g.',
];

// the deer — d=coat, D=back shadow, l=pale belly, o=legs/hoof/nose, e=eye, w=rump
// patch, h=little antlers. 16 wide; last three rows are the leg stance (two trot
// frames). Facing right.
export const DEER_COLORS = { d: '#a06a38', D: '#82542a', l: '#d8bb8c', o: '#4d3119', e: '#15110b', w: '#f2ece1', h: '#6b4a2a' };
const DEER_BODY = [
  '.............h.h', '..............h.', '.............dd.', '............dde.',
  '............ddo.', '...........dd...', '..wDDDDDDDDd....', '.wdddddddddd....',
  '.wddddddddddl...', '.oddddddddddl...',
];
const DEER_LEGS_A = ['...o.o....o.o...', '...o.o....o.o...', '..oo.oo..oo.oo..'];
const DEER_LEGS_B = ['..o..o...o...o..', '..o..o...o...o..', '.oo.oo...oo.oo..'];
export const DEER = [...DEER_BODY, ...DEER_LEGS_A];
export const DEER_WALK_A = DEER;
export const DEER_WALK_B = [...DEER_BODY, ...DEER_LEGS_B];
