import { useEffect, useRef } from 'react';

import { GREEN, RED, GOLD, HEART, PIXEL, mix, spriteW, rand, pick,
  MIDS, EXITS, CLICK_REACTS, CLICK_SET, REST_BEATS, MID_SET, RARES, SPECIALS, DRAG_ACTIONS } from './pixelTroll/constants';
import {
  POSES, STAND, BOOT, Z_GLYPH, NOTE_GLYPH, STAR_GLYPH, HEART_GLYPH,
  UFO, UFO2, CHUTE, MEAT_PIXEL, MEAT_COLORS, MEATS,
  LADY, DOG, DOG2, DOG_OPEN, COP_SCALE, COP_COLORS, POLICE, POLICE_WRITE,
  GIFT_PIXEL, GIFT_ART, DIG_FINDS, LOVE_GIFTS,
  MONSTER, MONSTER_WALK_A, MONSTER_WALK_B, MONSTER_COLORS, MONSTER_SCALE,
  POTION, POTION_COLORS, MONSTER_CORPSE, SKELETON, SKELETON_COLORS,
  RABBIT, RABBIT_HOP, RABBIT_COLORS, DEER_WALK_A, DEER_WALK_B, DEER_COLORS,
} from './pixelTroll/sprites';
import { SPEECH, POLICE_TROLL, POLICE_COP, SPEECH_FED, SPEECH_GRABBED, SPEECH_POKED } from './pixelTroll/speech';

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
 * off-screen, gets the hiccups, takes a static shock, melts into a puddle,
 * bursts into tears, blows hearts, hits the jackpot, blows a raspberry, drops
 * into the splits, and more. Eighteen poke-reactions, one picked at random per
 * click — a single spaced-out poke warms him up, while jabbing fast just annoys
 * him. He can flush green→red and fade out, so a `color`/`alpha` pair rides
 * alongside `pose` for tinting and dissolving.
 *
 * And he's grabbable: click-and-hold and you can drag him around — he dangles
 * from the cursor kicking and fighting, riding OVER the floating widgets. Let go
 * and he either floats down under a little parachute, just falls, or (10% of the
 * time) bursts into blood and sinks into the ground. Right-click him and he's
 * shot dead — he bursts into pieces and blood splatters clear across the screen
 * (over everything), runs in drips, then fades, with a few green bits in the spray.
 *
 * And he's feedable: shift+click blank space and a small Minecraft-style cut of
 * meat — a chop on the bone, a marbled steak, a drumstick, a T-bone — appears right
 * where you clicked and drops to his floor; wherever he is (even off-screen) he
 * comes running, chomps it down bite by bite, and looks pleased. Shift+RIGHT-click
 * instead drops a BIG cut he can't resist — it summons him out on the spot, and
 * when he's mad he won't come clean: he peeks around the corner and up from the
 * ground, then bursts out, snatches it in a blur, and bolts (so it's hard to hit).
 *
 * And he has FEELINGS about you that build over time (persisted in localStorage,
 * slowly drifting back to neutral). Feeding him and the occasional friendly poke
 * warm him up; dragging him around, shooting him, and spamming pokes sour him. The
 * happier he is, the more he visits and the longer he stays; the more he hates you,
 * the more he's gone — and his visits get short and grumpy. Every so often he pipes
 * up in a little white speech bubble, and what he says tracks his mood: praise when
 * he loves you, lots of casual hanging-out small talk in the middle, and — when
 * you've really earned it — crude, explicit abuse. (In-house easter egg; the
 * profanity is intentional.)
 *
 * And if you win him ALL the way to the top (+100 love — feed him, be kind), he
 * throws a little celebration: he turns heart-pink, bounces for joy, blows "I LOVE
 * YOU!" and pours out a fountain of hearts under a big pulsing heart overhead.
 *
 * And if you push him ALL the way to the bottom, he stops coming alone — he shows
 * up, dead-center, with a blue-uniformed police officer, points at you and reels
 * off his complaints while the cop stands there taking notes. You can right-click
 * (shoot) the troll OR the cop individually: whichever you hit bursts, and the
 * other one panics and bolts. Either kill ends the whole thing — everything else
 * stops and his saved mood is wiped — but it's not the end of him.
 *
 * Because if you gun down EITHER one in front of the cop, two minutes later he
 * claws his way back — strolls in, downs a potion, shakes himself
 * apart, and erupts into a giant horned red beast with glowing eyes and fangs that
 * stomps around shoving and smashing the floating widgets. Right-click bursts him
 * in a screen-wide splatter, but he only reforms angrier; it takes five shots to
 * finally drop him. And when he falls it turns gentle: his crumpled corpse slowly
 * rots to a skeleton over a few minutes as wildflowers bloom and butterflies
 * gather, then the skeleton sinks into the earth — and the flowers stay. From there
 * a whole meadow keeps creeping outward over ~15 minutes until the screen is dotted
 * with pockets of forest (grass, bushes, vine-draped trees, rocks, butterfly
 * clouds) with the odd rabbit or deer crossing through. (Debug: Shift+M summons the
 * monster now; Shift+K drops him now; Shift+D jumps to just after he's sunk;
 * Shift+G fast-forwards the garden.)
 *
 * Pure canvas, one green color (red when riled) — the only exceptions are the meat
 * (a few food hues), the policeman's blue uniform, and the speech bubbles. No images.
 */

export default function PixelTroll({ hidden = false, floorSelector = '', obstacleSelector = '', zIndex = 30 }) {
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
      lady: null, hearts: [], heartSent: false, landed: false, pool: null, ufo: null, dog: null, boot: null, flick: null, friend: null,
      grab: null, drop: null, dropSeed: null, splats: [], shotAt: null,
      meats: [], feast: null, widget: null,
      gifts: [], giftT: rand(20000, 35000),       // collectibles on the floor + a timer for love-gifts
      // getting dropped or whacked makes him bolt — and bolt FASTER the more it
      // keeps happening (the streak only resets once he gets a visit in peace).
      // furyT just animates the rage cloud when he really can't stand you.
      pendingFlee: false, fleeStreak: 0, furyT: 0, petMoodT: 0, weatherT: 0,
      // how he feels about you (−100 hate … +100 love). Drifts toward 0 over time;
      // food / gentle pokes warm him, dragging / shooting / poke-spam sour him.
      mood: loadMood(), speech: null, lastSpoke: 0, nextChatter: rand(6000, 13000), moodSaveT: 0,
      // the police scene (super-furious) + the permanent banish it can trigger.
      // policePending latches the moment he bottoms out at −100 so his mood can
      // drift back up while he's away without him forgetting to bring the cop.
      cop: null, copSpeech: null, policeStopX: 0, banished: false, policePending: false, policeKill: null,
      // kill either one in front of the cop and, 2 minutes later, he claws back as a
      // horned monster (startMonster). Shoot THAT five times and the gentle death/bloom
      // scene takes over (T.death). Both are in-memory only — a reload clears them.
      monster: null, monsterReturnAt: 0, death: null,
      // latched when he's won all the way to +100 → his next free beat is a big
      // heart-pouring love celebration (mirror of policePending at the bottom).
      lovePending: false,
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

    // ── Mood + speech ──────────────────────────────────────────────────────────
    // His feelings toward you persist across sessions in localStorage and drift
    // back toward neutral over time, so a morning of abuse (or kindness) lingers
    // but doesn't last forever.
    const MOOD_KEY = 'phonedeck_troll_mood';
    function loadMood() {
      try { const v = parseFloat(window.localStorage.getItem(MOOD_KEY)); return Number.isFinite(v) ? Math.max(-100, Math.min(100, v)) : 0; }
      catch { return 0; }
    }
    function saveMood() { try { window.localStorage.setItem(MOOD_KEY, String(Math.round(T.mood))); } catch { /* private mode / SSR — skip */ } }
    // A running count of the gifts you've collected, persisted in localStorage.
    const GIFT_KEY = 'phonedeck_troll_gifts';
    let giftCount = (() => { try { const v = parseInt(window.localStorage.getItem(GIFT_KEY), 10); return Number.isFinite(v) ? v : 0; } catch { return 0; } })();
    const saveGiftCount = () => { try { window.localStorage.setItem(GIFT_KEY, String(giftCount)); } catch { /* skip */ } };
    // His shades / crown now follow his CURRENT mood (see drawGear) rather than being
    // a permanent unlock, so clear any tier left stuck in old caches (that's what was
    // making him wear the crown forever once he'd hit +100 just once).
    try { window.localStorage.removeItem('phonedeck_troll_gear'); } catch { /* skip */ }
    function bumpMood(d) {
      const before = T.mood;
      T.mood = Math.max(-100, Math.min(100, before + d));
      if (T.mood <= -100 && before > -100) { T.policePending = true; T.lovePending = false; }  // hit the bottom → a cop next
      if (T.mood >= 100 && before < 100) { T.lovePending = true; T.policePending = false; }     // hit the top → a love celebration
      saveMood();
    }
    function moodTier() {
      const m = T.mood;
      if (m >= 55) return 'loved';
      if (m >= 18) return 'liked';
      if (m > -18) return 'neutral';
      if (m > -52) return 'disliked';
      if (m > -82) return 'hated';
      return 'furious';                                  // really mad → the explicit stuff
    }
    // Put up a white speech bubble. Duration scales with length so longer lines
    // stay readable. Angry lines come through red, adoring ones green.
    function say(text, color) {
      if (!text) return;
      T.speech = { text, t: 0, dur: Math.max(2400, 1100 + text.length * 95), color: color || '#1c1c1c' };
      T.lastSpoke = performance.now();
    }
    function sayAmbient() {
      const tier = moodTier();
      const col = (tier === 'hated' || tier === 'furious') ? '#d22' : tier === 'loved' ? '#159a52' : '#1c1c1c';
      say(pick(SPEECH[tier]), col);
    }
    function sayEvent(pool) {                             // good/bad variant chosen by mood
      const bad = T.mood <= -18;
      say(pick(bad ? pool.bad : pool.good), bad ? '#d22' : '#1c1c1c');
    }
    // The longer he's soured on you, the longer he stays gone between visits.
    function awayDelay() {
      const m = T.mood / 100;                            // −1 (hate) … +1 (love)
      const mult = m < 0 ? 1 + (-m) * 2.6 : 1 - m * 0.45;
      return rand(14000, 34000) * mult;
    }
    // Pushed past furious, all the way to the bottom → he shows up with a cop.
    function superMad() { return T.mood <= -96; }
    // A separate bubble for the cop (anchored over the cop, not the troll).
    function sayCop(text) { if (text) T.copSpeech = { text, t: 0, dur: Math.max(1800, 900 + text.length * 80), color: '#1c1c1c' }; }

    // ── Widget collisions (used while he's flicked across the screen) ──────────
    // Snapshot the on-screen "obstacle" elements (the floating Studio panels) as
    // solid rectangles in canvas coords. Read once at launch so a mid-flight
    // jiggle/drag doesn't feed back into the physics.
    function readObstacles() {
      if (!obstacleSelector) return [];
      const canvasTop = window.innerHeight - canvas.height; // canvas sits at bottom:0
      const out = [];
      document.querySelectorAll(obstacleSelector).forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width < 8 || r.height < 8) return;            // hidden / collapsed
        if (r.bottom < 0 || r.top > window.innerHeight) return; // off-screen
        out.push({ el, left: r.left, right: r.right, top: r.top - canvasTop, bottom: r.bottom - canvasTop });
      });
      return out;
    }

    // A quick wobble on a widget when he smacks into it. Animates the INDEPENDENT
    // translate/rotate CSS props (not `transform`) so we don't stomp the panel's
    // own transform-based centering. Throttled so repeated taps don't stack.
    function bumpWidget(el, vx, vy) {
      if (!el || typeof el.animate !== 'function') return;
      const now = performance.now();
      if (el.__trollBumpT && now - el.__trollBumpT < 200) return;
      el.__trollBumpT = now;
      const dx = Math.max(-8, Math.min(8, vx / 80));
      const dy = Math.max(-8, Math.min(8, -vy / 80));        // a hit from below nudges it up
      const rot = Math.max(-3, Math.min(3, dx * 0.5));
      try {
        el.animate(
          [
            { translate: '0px 0px', rotate: '0deg' },
            { translate: `${dx}px ${dy}px`, rotate: `${rot}deg`, offset: 0.35 },
            { translate: '0px 0px', rotate: '0deg' },
          ],
          { duration: 280, easing: 'cubic-bezier(.36,.07,.19,.97)' },
        );
      } catch { /* WAAPI not available — skip the flourish */ }
    }

    // Resolve the flying troll against each obstacle: find the overlap, push him
    // out along the shallower axis, reflect that velocity component, and bump the
    // widget. Top hits set `grounded` so he can briefly perch / roll along a panel.
    function collideObstacles(F) {
      const obs = F.obs;
      if (!obs || !obs.length) return;
      const px = PIXEL * T.scale;
      const bw = spriteW(STAND) * px * 0.8, bh = STAND.length * px;
      for (let i = 0; i < obs.length; i++) {
        const r = obs[i];
        const feetCY = groundY() - F.h;
        const bx0 = T.x - bw / 2, bx1 = T.x + bw / 2;
        const by1 = feetCY, by0 = feetCY - bh;
        const ox = Math.min(bx1, r.right) - Math.max(bx0, r.left);
        const oy = Math.min(by1, r.bottom) - Math.max(by0, r.top);
        if (ox <= 0 || oy <= 0) continue;                  // no overlap
        if (ox < oy) {                                     // shallower on x → ricochet off a side, hard
          if (T.x < (r.left + r.right) / 2) { T.x -= ox; F.vx = -Math.abs(F.vx) * 0.85 - 40; }
          else { T.x += ox; F.vx = Math.abs(F.vx) * 0.85 + 40; }
          F.vy += rand(40, 200);                           // a side smack also pops him upward
          bumpWidget(r.el, F.vx, 0);
        } else {                                           // shallower on y
          const bodyCy = (by0 + by1) / 2;
          if (bodyCy < (r.top + r.bottom) / 2) {           // landed on TOP of the panel — trampoline off it
            F.h = groundY() - r.top;
            if (F.vy < -90) { F.vy = -F.vy * 0.72; bumpWidget(r.el, 0, F.vy); }
            else { F.vy = 0; }
            F.grounded = true;
          } else {                                         // bonked the UNDERSIDE
            F.h = groundY() - (r.bottom + bh);
            if (F.vy > 0) F.vy = -F.vy * 0.6;
            bumpWidget(r.el, 0, F.vy);
          }
        }
      }
    }

    function planVisit() {
      // pushed all the way to the bottom (now, or latched when he hit −100 earlier)
      // → this whole visit is the police scene, even if his mood has since drifted up.
      if ((T.policePending || superMad()) && !T.banished) { T.policePending = false; T.queue = ['police']; return; }
      if (T.lovePending) { T.lovePending = false; T.queue = ['lovefest']; return; }   // won all the way to +100 → a celebration
      const tier = moodTier();
      const sour = tier === 'disliked' || tier === 'hated' || tier === 'furious';
      const entrance = pick(['walkIn', 'walkIn', 'emerge']);
      // The more he likes you, the longer he hangs around; when he's soured on you
      // he barely shows his face — one quick beat and he's gone.
      const n = tier === 'furious' || tier === 'hated' ? 1
        : tier === 'disliked' ? 1 + Math.floor(Math.random() * 2)
        : tier === 'neutral' ? 2 + Math.floor(Math.random() * 2)
        : 2 + Math.floor(Math.random() * 3);                 // liked / loved: a proper visit
      const seq = [entrance];
      for (let i = 0; i < n; i++) {
        if (!sour && Math.random() < 0.7) seq.push(pick(REST_BEATS)); // breather before the trick
        seq.push(pick(MIDS));
      }
      if (!sour && Math.random() < 0.6) seq.push(pick(REST_BEATS));   // settle a beat before leaving
      seq.push(sour ? pick(['runOff', 'blinkOut', 'burrow', 'runOff']) : pick(EXITS)); // grumpy → he bolts
      T.queue = seq;
    }

    function beginNext(now) {
      // a pressed key always wins, even if he was mid-exit — cancel the departure.
      if (T.userQueue.length) { T.leaving = false; T.idleStreak = 0; startAction(T.userQueue.shift(), now); return; }
      // just got dropped or whacked → he scrambles off (faster the more it keeps
      // happening). This is a real exit: he actually leaves, then returns later.
      if (T.pendingFlee) { T.pendingFlee = false; T.idleStreak = 0; startAction('pflee', now); return; }
      // just finished an exit (or fled) → he's gone; don't idle back into view.
      if (T.leaving) {
        if (T.action !== 'pflee') T.fleeStreak = 0;   // left in peace / died → the escalation resets
        T.leaving = false; T.idleStreak = 0; T.mode = 'away'; T.speech = null;
        // if he's owed a police visit or a love celebration, he's back fast for it;
        // otherwise the usual mood-scaled wait (the madder he is, the longer he's gone).
        T.nextVisit = now + ((T.policePending || T.lovePending) ? rand(2500, 5000) : awayDelay()); return;
      }
      if (T.queue.length) {
        T.idleStreak = 0;
        const nx = T.queue.shift();
        // ultra-rare: swap a normal trick for a scripted cameo (~1% each).
        if (MID_SET.has(nx) && Math.random() < 0.05) { startAction(pick(RARES), now); return; }
        startAction(nx, now); return;
      }
      if (T.idleStreak < 2) { T.idleStreak++; startAction('idle', now); return; }
      // He NEVER just blinks out flat — when there's nothing left to do, he still
      // leaves the proper way, on one of the random exits.
      T.idleStreak = 0; startAction(pick(EXITS), now);
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

    // Screen-wide blood splatter (the right-click "shot"). Each blob sticks where
    // it lands ON the whole canvas — over widgets and all — holds, runs a drip
    // downward, then fades out. A few are green (bits of him in the spray).
    function spawnSplats(cx, cy, bitColor = GREEN) {
      const add = (x, y, size, green) => {
        const big = size > 7;
        T.splats.push({
          x, y, size, color: green ? bitColor : RED,
          hold: rand(60, 520), drip: 0,
          dripMax: big ? rand(18, 150) : 0, dripV: rand(26, 80),
          life: rand(3200, 6200), fade: rand(800, 1700),
        });
      };
      // dense gut-cluster right where he was hit — red, with a good share of green
      for (let i = 0; i < 16; i++) {
        const ang = rand(0, Math.PI * 2), rad = rand(0, 130);
        add(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * 0.7, rand(5, 15), Math.random() < 0.32);
      }
      // an extra burst of green bits of him, splattered close by
      for (let i = 0; i < 20; i++) {
        const ang = rand(0, Math.PI * 2), rad = rand(0, 110);
        add(cx + Math.cos(ang) * rad, cy + Math.sin(ang) * rad * 0.7, rand(3, 11), true);
      }
      // a wide spray flung across the screen — far-reaching droplets
      for (let i = 0; i < 40; i++) {
        const ang = rand(-Math.PI, 0), rad = rand(60, Math.max(W(), canvas.height) * 0.6);
        const x = Math.max(4, Math.min(W() - 4, cx + Math.cos(ang) * rad));
        const y = Math.max(4, Math.min(canvas.height - 4, cy + Math.sin(ang) * rad - rand(0, 80)));
        add(x, y, rand(2, 9), Math.random() < 0.12);
      }
    }

    // ── Food (shift+click = small cut, shift+right-click = BIG cut) ──────────
    // The nearest hunk of meat still on the board — what he'll lope toward next.
    function nearestMeat() {
      let best = null, bd = Infinity;
      for (const m of T.meats) {
        if (m.gone) continue;
        const d = Math.abs(m.x - T.x);
        if (d < bd) { bd = d; best = m; }
      }
      return best;
    }
    // Shift+click conjures a cut of meat right where the cursor is. It then drops
    // under gravity to his floor and waits there to be eaten. (If you click at or
    // below the floor it just lands immediately.) `big` (shift + right-click)
    // makes a double-size cut that's drawn bigger and summons him on the spot.
    function spawnMeat(clientX, clientY, big = false) {
      if (T.meats.length >= 5) return;                  // don't let the plate pile up forever
      const kind = pick(MEATS);
      const canvasTop = window.innerHeight - canvas.height;
      const floor = groundY();
      const y = Math.min(floor, Math.max(0, clientY - canvasTop)); // its BOTTOM, at the click point
      const margin = big ? 44 : 20;
      T.meats.push({
        kind, rows: kind.rows, big, px: big ? MEAT_PIXEL * 2 : MEAT_PIXEL,
        x: Math.max(margin, Math.min(W() - margin, clientX)),   // keep it on-screen
        y, vy: 0,
        landed: y >= floor, gone: false, claimed: false,
        eat: 0, biteSide: 1, life: 0,
      });
    }

    // ── Collectibles (gifts he leaves / treasure he digs up) ────────────────
    // A little item pops onto the floor with a toss; it sparkles, and you click it
    // to collect (bumps a saved tally). `pop` gives it some upward launch.
    function spawnGift(kind, x, pop) {
      if (T.gifts.length >= 6) return;
      T.gifts.push({ kind, x: Math.max(16, Math.min(W() - 16, x)), y: groundY() - (pop ? 4 : 0), vy: pop ? -rand(180, 320) : 0, vx: rand(-40, 40), landed: !pop, life: 0, sparkleT: 0 });
    }
    // Click on a gift to collect it. Returns true if one was hit (so the click
    // doesn't fall through to a poke). Coords are canvas-space.
    function collectGiftAt(gx, gy) {
      for (let i = T.gifts.length - 1; i >= 0; i--) {
        const g = T.gifts[i];
        const art = GIFT_ART[g.kind], w = spriteW(art.rows) * GIFT_PIXEL, h = art.rows.length * GIFT_PIXEL;
        if (gx >= g.x - w / 2 - 8 && gx <= g.x + w / 2 + 8 && gy >= g.y - h - 8 && gy <= g.y + 8) {
          for (let j = 0; j < 12; j++) { const ang = rand(-Math.PI, 0), sp = rand(80, 220);   // a little collect sparkle
            T.confetti.push({ x: g.x, y: g.y - h / 2, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: rand(300, 700), size: Math.round(rand(2, 4)), color: art.color }); }
          T.gifts.splice(i, 1); giftCount++; saveGiftCount();
          return true;
        }
      }
      return false;
    }

    function startAction(name, now) {
      T.mode = 'active'; T.action = name; T.t = 0;
      T.yOffset = 0; T.scale = 1; T.shakeX = 0; T.mirror = false; T.color = GREEN; T.alpha = 1;
      T.leaving = false; // only exits / flee re-assert this below
      T.lady = null; T.pool = null; T.ufo = null; T.dog = null; T.boot = null; T.flick = null; T.friend = null; // clear any lingering cameo props
      T.feast = null; // (the meal sets this up again in its own case)
      if (name !== 'police') { T.cop = null; T.copSpeech = null; } // the police scene sets these up itself
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
        case 'dig': T.dur = rand(2600, 3600); T.poseT = 0; T.sneezed = false; break;   // sneezed flag = "already unearthed a find"
        case 'faint': T.dur = rand(2400, 3200); break;
        case 'headbang': T.dur = rand(1800, 2800); break;
        case 'kick': T.dir = T.x < W() / 2 ? 1 : -1; T.dur = 1100; break;
        case 'trampoline': T.dur = rand(2600, 3600); break;
        case 'dazed': T.dur = 1500; T.zTimer = 0; break;

        case 'feast': {                                 // someone dropped food — go wolf it down
          const m = nearestMeat();
          const big = !!(m && m.big);
          const sneaky = big && T.mood <= -18;          // a mad troll won't stroll up to a BIG meal — he sneaks
          T.feast = {
            meat: m, big, sneaky, phase: sneaky ? 'peek' : 'go',
            ate: false, sided: false, biteT: 0, afterT: 0, wait: 0, burped: false, peekT: 0, peekN: 0,
          };
          if (m) { m.claimed = true; T.dir = m.x > T.x ? 1 : -1; }
          T.speed = sneaky ? rand(680, 900) : rand(165, 245);   // a sneaky snatch is a blur; else an eager trot
          T.dur = 22000;                                // hard cap; really ends when the plate's clean
          break;
        }

        case 'lovefest':                                // MAX LOVE (+100) → he turns pink and showers you in hearts
          T.dur = 6000; T.heartSent = false; T.landed = false; T.sneezed = false; T.zTimer = 0; T.poseT = 0;
          break;

        // ---- cursor affection (hover / nearby pointer) ----
        case 'pet': T.dur = 600000; T.petMoodT = 0; T.zTimer = 0; break;   // held while you hover gently over him
        case 'tickle': T.dur = 600000; T.petMoodT = 0; T.zTimer = 0; break;
        case 'chase': T.dur = 9000; T.poseT = 0; break;                    // bats at / creeps toward the cursor
        case 'flinch': T.dur = 700; break;                                 // soured → recoils from the cursor

        // ---- he uses the floating Studio panels ----
        case 'napWidget': {                             // climb onto a panel and sleep on top
          const obs = readObstacles().filter((r) => r.top > Math.max(30, groundY() - 320) && r.top < groundY() - 30 && (r.right - r.left) > 60);
          if (!obs.length) { startAction('pause', now); return; }          // no usable ledge → just pause
          let best = obs[0], bd = Infinity;
          for (const r of obs) { const cx = (r.left + r.right) / 2, d = Math.abs(cx - T.x); if (d < bd) { bd = d; best = r; } }
          T.widget = { cx: (best.left + best.right) / 2, top: best.top, el: best.el, up: false, climbT: 0 };
          T.speed = rand(70, 110); T.dur = rand(6500, 9500); T.zTimer = 0;
          break;
        }
        case 'leanWidget': {                            // walk to a panel's side, lean on it, give it a shove
          const obs = readObstacles().filter((r) => (r.right - r.left) > 50);
          if (!obs.length) { startAction('pause', now); return; }
          let best = obs[0], bd = Infinity;
          for (const r of obs) { const cx = (r.left + r.right) / 2, d = Math.abs(cx - T.x); if (d < bd) { bd = d; best = r; } }
          const half = spriteW(STAND) * PIXEL * 0.5;
          const onLeft = T.x < (best.left + best.right) / 2;               // approach the nearer side
          T.widget = { el: best.el, standX: onLeft ? best.left - half + 4 : best.right + half - 4, lean: onLeft ? 1 : -1 };
          T.speed = rand(60, 95); T.dur = rand(3200, 5200); T.poseT = 0;
          break;
        }

        // ---- app-driven reactions + boredom ----
        case 'cheer': T.dur = 2600; T.heartSent = false; T.sneezed = false; break;   // something good happened
        case 'fret': T.dur = 2200; T.heartSent = false; T.poseT = 0; break;          // something went wrong
        case 'bored': T.dur = 2800; T.heartSent = false; break;                       // you've ignored him

        // ---- click reactions (poke responses) ----
        case 'pstartle': T.dur = 900; break;
        case 'pshakeHead': T.dur = 1200; T.poseT = 0; break;
        case 'pflee':                                   // bolts off-screen, scared — quicker each time he's harassed in a row
          T.leaving = true; T.dir = T.x < W() / 2 ? -1 : 1;
          T.speed = Math.min(1200, rand(430, 600) + Math.max(0, T.fleeStreak - 1) * 175);
          break;
        case 'pangry': T.dur = 1700; T.poseT = 0; break;
        case 'pspin': T.dur = 1500; T.poseT = 0; T.zTimer = 0; break;
        case 'psplat': T.dur = 760; break;
        case 'pbounce': T.dur = 1500; break;
        case 'ptantrum': T.dur = 1700; T.poseT = 0; T.legT = 0; break;
        case 'pblush': T.dur = 1300; break;
        case 'phiccup': T.dur = 2100; T.poseT = 0; break;
        case 'pzap': T.dur = 1300; T.poseT = 0; break;
        case 'pmelt': T.dur = 2200; T.sneezed = false; break;
        case 'pcry': T.dur = 2400; T.poseT = 0; break;
        case 'plove': T.dur = 1800; T.legT = 0; break;
        case 'pjackpot': T.dur = 1800; T.sneezed = false; break;
        case 'praspberry': T.dur = 1700; T.sneezed = false; break;
        case 'psplit': T.dur = 1600; break;
        case 'pflick': {                                // double-click WHACK → he goes flying, tumbling, bouncing
          const dir = Math.random() < 0.5 ? -1 : 1;
          T.flick = {
            vx: dir * rand(700, 1550),                  // sideways launch — sends him clear across the screen
            vy: rand(1050, 1950),                       // straight up — he rockets off the top
            h: 0, bounces: 0, spin: 0, rest: 0, grounded: false,
            obs: readObstacles(),                       // the widgets he'll ricochet off
          };
          T.dur = 9000;                                 // hard cap; really ends when he finally settles
          for (let i = 0; i < 24; i++) {                // big *THWACK* burst at the point of contact
            const ang = rand(-Math.PI, 0), sp = rand(160, 560);
            T.confetti.push({
              x: T.x + rand(-8, 8), y: groundY() - STAND_H * 0.5,
              vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
              life: rand(300, 800), size: Math.round(rand(2, 6)),
            });
          }
          break;
        }

        // ---- drag & drop (started by the mouse handlers, not the queue) ----
        case 'grab': {                                  // picked up — held at the cursor, kicking & fighting
          T.grab = {
            cx: T.x, cy: groundY() + T.yOffset - STAND_H * 0.5,
            vx: 0, vy: 0, struggleT: 0, puffT: 0,
            lastClientX: 0, lastClientY: 0, lastT: now,
          };
          T.dur = 600000;                               // effectively until released
          break;
        }
        case 'dropChute':
        case 'dropFall':
        case 'dropSplat': {                             // let go — floats / falls / bursts (position carried over)
          const seed = T.dropSeed || { x: T.x, h: STAND_H, vx: 0, vy: 0 };
          T.dropSeed = null;
          T.x = seed.x;
          T.drop = {
            kind: name, h: Math.max(0, seed.h), vx: seed.vx, vy: seed.vy,
            spin: 0, sway: 0, restT: 0, bounces: 0, landed: false, grounded: false, exploded: false,
          };
          T.yOffset = -T.drop.h;
          T.dur = 12000;                                // hard cap; really ends when he settles
          if (name === 'dropSplat') { T.leaving = true; T.pool = null; T.sneezed = false; }
          break;
        }
        case 'shot':                                    // right-click execution — bursts, blood everywhere
          T.leaving = true; T.dur = 700; T.landed = false;
          T.drop = null; T.grab = null;                 // kill any parachute / grab in progress
          if (T.shotAt) { T.x = T.shotAt.x; T.yOffset = T.shotAt.yOff; T.shotAt = null; } // burst where he was (mid-air is fine)
          break;

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
        case 'friend': {                                // a buddy troll drops by and they play
          T.dur = 8000;
          const fromRight = T.x < W() / 2;              // friend comes from the far side
          const dirIn = fromRight ? -1 : 1;
          const stopX = Math.max(60, Math.min(W() - 60, T.x + (fromRight ? 1 : -1) * 72));
          const startX = fromRight ? W() + off : -off;
          T.friend = {
            x: startX, stopX, dir: dirIn, speed: Math.max(200, Math.abs(startX - stopX) / 1.4),
            pose: 'walkA', mirror: dirIn < 0, yOff: 0, legT: 0, legFlip: false, gone: false,
            act: pick(['highfive', 'dance', 'tag']),
          };
          T.sneezed = false; T.poseT = 0;
          break;
        }
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

        case 'police': {                                // super-furious → he marches in WITH a cop to report you
          T.dur = 30000; T.leaving = true;              // hard cap; really ends once they've both walked off
          const fromLeft = Math.random() < 0.5;
          const dir = fromLeft ? 1 : -1;                // travel direction across the screen
          T.dir = dir;
          T.x = fromLeft ? -off : W() + off;            // troll enters from this edge
          T.policeStopX = W() / 2 + dir * 46;           // confrontation centered: troll just past center, cop ~46px the other side
          const exitDist = (dir === 1 ? (W() - T.policeStopX) : T.policeStopX) + off + 110;
          T.cop = { x: T.x - dir * 80, dir, yOff: 0, legT: 0, legFlip: false, writeT: 0, writing: false, mirror: dir < 0, exitSpeed: Math.max(170, exitDist / 3.0) };
          T.copSpeech = null; T.speech = null; T.poseT = 0; T.policeKill = null;
          break;
        }

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
          if (!T.sneezed) {                              // ...and about half the time, he's struck something
            T.sneezed = true;
            if (Math.random() < 0.5) spawnGift(pick(DIG_FINDS), T.x, true);
          }
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

      // ---- feeding (shift+click drops meat) ------------------------------
      if (a === 'feast') {                              // trots to the meat, chomps it down, looks pleased
        const F = T.feast;
        if (!F) return true;

        // Sneaky big-meal approach (only when he's mad): he won't walk up to it —
        // he peeks around the screen edge and pokes his head up out of the ground
        // to case it, then BURSTS out, snatches it in a blur, and bolts. All of it
        // is deliberately hard to land a shot on.
        if (F.sneaky && F.phase === 'peek') {
          const m = F.meat;
          if (!m || m.gone) return true;                // food vanished before he committed
          const edge = m.x < W() / 2 ? 'left' : 'right';
          const dirToFood = edge === 'left' ? 1 : -1;
          const PEEK = 1500;                            // one peek cycle (rise → watch → duck back)
          const k = F.peekT / PEEK;
          T.scale = 1; T.shakeX = 0;
          if (F.peekN % 2 === 1) {                      // ...pokes his head up out of the ground, scanning
            const spot = m.x - dirToFood * (off * 1.4 + (F.peekN * 23) % 70);
            T.x = Math.max(off * 0.5, Math.min(W() - off * 0.5, spot));
            const headPeek = 6 * PIXEL, down = STAND_H - headPeek;
            if (k < 0.25) T.yOffset = STAND_H - (k / 0.25) * headPeek;            // rise to peek
            else if (k < 0.75) { T.yOffset = down; T.pose = (Math.floor(F.peekT / 200) % 2) ? 'lookL' : 'lookR'; }
            else T.yOffset = down + ((k - 0.75) / 0.25) * headPeek;               // sink back under
            T.mirror = m.x < T.x;
          } else {                                      // ...leans in around the screen edge, just his head showing
            const hidden = edge === 'left' ? -off * 0.55 : W() + off * 0.55;
            const shown  = edge === 'left' ? -off * 0.16 : W() + off * 0.16;
            T.yOffset = 0; T.mirror = edge === 'right'; // face inward, toward the food
            T.pose = (Math.floor(F.peekT / 200) % 2) ? 'lookL' : 'lookR';
            if (k < 0.25) T.x = hidden + (shown - hidden) * (k / 0.25);
            else if (k < 0.75) T.x = shown;
            else T.x = shown + (hidden - shown) * ((k - 0.75) / 0.25);
          }
          F.peekT += dt;
          if (F.peekT >= PEEK) { F.peekT = 0; F.peekN++; }
          if (F.peekN >= 3) {                           // done casing it → explode out of hiding
            F.phase = 'dash';
            T.x = edge === 'left' ? -off : W() + off;   // start the sprint fully off the near edge
            T.yOffset = 0; T.dir = dirToFood;
          }
          return false;
        }

        if (F.ate) {                                    // belly full
          if (F.sneaky) {                               // snatched it — no victory dance, just GONE
            T.leaving = true; T.mirror = T.dir < 0;
            T.x += T.dir * Math.max(T.speed, 760) * dt / 1000;
            animLegs(dt, 'walkA', 'walkB', 50);
            return T.x < -off || T.x > W() + off;
          }
          F.afterT += dt;                               // happy little jig, one content burp
          if (F.afterT < 900) {
            T.pose = (Math.floor(F.afterT / 160) % 2) ? 'wave' : 'jump';
            T.yOffset = -Math.abs(Math.sin(F.afterT / 130)) * 8;
            if (!F.burped && F.afterT > 360) {          // a satisfied *hrrp* — heart + a little puff
              F.burped = true;
              T.hearts.push({ x: T.x + rand(-8, 8), y: groundY() - STAND_H * 0.85, vx: rand(-12, 12), vy: rand(-34, -20), life: 1200, maxLife: 1200, sc: 0.5 });
              for (let i = 0; i < 4; i++) T.confetti.push({
                x: T.x + T.dir * 8, y: groundY() - STAND_H * 0.7,
                vx: rand(-30, 30), vy: rand(-60, -20), life: rand(300, 600), size: Math.round(rand(2, 4)),
              });
            }
          } else { T.pose = 'stand'; T.yOffset = 0; }
          return F.afterT >= 1300;
        }
        const m = F.meat;
        if (!m || m.gone) { F.ate = true; F.afterT = 0; return false; }  // food vanished out from under him → just wrap up
        const reach = spriteW(STAND) * PIXEL * T.scale * 0.5 + 8 + (F.big ? 12 : 0);
        const dx = m.x - T.x;
        if (Math.abs(dx) > reach) {                     // hustle / sprint over to it
          T.dir = dx > 0 ? 1 : -1; T.mirror = T.dir < 0;
          T.x += T.dir * T.speed * dt / 1000;
          animLegs(dt, 'walkA', 'walkB', F.sneaky ? 45 : 80);   // a blur when he's snatching, else eager steps
          T.yOffset = 0;
          return false;
        }
        T.mirror = m.x < T.x;                           // face the food
        if (!m.landed) {                                // still falling — look up, hop, mouth agape, wait for it
          F.wait += dt;
          T.pose = (Math.floor(F.wait / 150) % 2) ? 'pointUp' : 'stretch';
          T.yOffset = -Math.abs(Math.sin(F.wait / 120)) * 4;
          return false;
        }
        if (!F.sided) { F.sided = true; m.biteSide = (T.x <= m.x) ? 1 : -1; }  // eat from whichever side he reached it on
        F.biteT += dt;
        const period = F.sneaky ? 95 : 220;             // a frantic snatch vs an unhurried meal
        const bite = F.sneaky ? 0.34 : 0.2;
        if (F.biteT >= period) {                        // a bite comes off every chomp
          F.biteT -= period;
          m.eat = Math.min(1, m.eat + bite);            // ~5 unhurried bites, or ~3 frantic gulps
          for (let i = 0; i < 6; i++) T.confetti.push({ // crumbs / juice spray off the bite
            x: m.x + rand(-6, 6), y: groundY() - rand(2, 14),
            vx: rand(-90, 90), vy: rand(-150, -40), life: rand(300, 700), size: Math.round(rand(2, 4)),
            color: pick(['#cf4b3e', '#7c3c20', '#f1cbb9']),
          });
          if (m.eat >= 1) {                             // last bite — full belly, warms to you
            m.gone = true; F.ate = true; F.afterT = 0;
            bumpMood(F.sneaky ? 8 : 15);                // a stolen meal mellows him a little; a calm one, a lot
            if (!F.sneaky && Math.random() < 0.5) sayEvent(SPEECH_FED);  // only comments on the food about half the time
          }
        }
        const biting = F.biteT < period * 0.45;
        T.pose = biting ? 'headDown' : 'sit';           // duck down to bite, sit up to chew
        T.yOffset = 0; T.shakeX = biting ? rand(-1.5, 1.5) : 0;
        return false;
      }

      // ---- max-love celebration (+100) -----------------------------------
      if (a === 'lovefest') {                           // turns heart-pink and showers you in hearts
        T.color = HEART; T.shakeX = 0;
        T.pose = (Math.floor(T.t / 150) % 2) ? 'wave' : 'jump';   // overjoyed bouncing
        T.yOffset = -Math.abs(Math.sin(T.t / 110)) * 14;
        T.mirror = (Math.floor(T.t / 300) % 2) === 0;
        if (!T.heartSent && T.t > 250) { T.heartSent = true; say('I LOVE YOU!', '#e0418f'); }
        if (!T.sneezed && T.t > 3200) { T.sneezed = true; say(pick(["you're my favorite!", "best human ever!", "i'm so happy!"]), '#159a52'); }
        T.zTimer += dt;
        if (T.zTimer > 60) {                            // a continuous fountain of hearts pouring up out of him
          T.zTimer = 0;
          for (let i = 0, n = 2 + Math.floor(rand(0, 3)); i < n; i++) {
            const ang = rand(-Math.PI * 0.85, -Math.PI * 0.15), sp = rand(70, 250);
            T.hearts.push({
              x: T.x + rand(-16, 16), y: groundY() - STAND_H * 0.7,
              vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
              life: rand(1400, 2600), maxLife: 2600, sc: rand(0.4, 1.0),
            });
          }
        }
        if (!T.landed && T.t > T.dur - 500) {           // one last big burst as it wraps up
          T.landed = true;
          for (let i = 0; i < 22; i++) {
            const ang = rand(-Math.PI, 0), sp = rand(120, 360);
            T.hearts.push({
              x: T.x + rand(-10, 10), y: groundY() - STAND_H * 0.6,
              vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: rand(1200, 2200), maxLife: 2200, sc: rand(0.5, 1.1),
            });
          }
        }
        return T.t >= T.dur;
      }

      // ---- cursor affection ----------------------------------------------
      if (a === 'pet') {                                // hover gently over him → he leans in, content, warming up
        T.color = GREEN; T.scale = 1; T.shakeX = 0;
        T.mirror = cur.x < T.x;                         // leans toward the cursor
        T.pose = (Math.floor(T.t / 520) % 3 === 0) ? 'lookR' : 'sit';
        T.yOffset = -Math.abs(Math.sin(T.t / 360)) * 2;
        T.petMoodT += dt;
        if (T.petMoodT > 850) { T.petMoodT = 0; bumpMood(1); }   // gradual, gentle warming
        T.zTimer += dt;
        if (T.zTimer > 700) {                           // the odd contented little heart
          T.zTimer = 0;
          T.hearts.push({ x: T.x + rand(-8, 8), y: groundY() - STAND_H * 0.8, vx: rand(-8, 8), vy: rand(-24, -14), life: 1200, maxLife: 1200, sc: 0.4 });
        }
        return !cursorOverTroll(22) || cur.speed > 270 || T.t >= T.dur;  // cursor left or started jiggling → done
      }
      if (a === 'tickle') {                            // jiggle the cursor on him → he cracks up
        T.color = GREEN; T.scale = 1;
        T.pose = (Math.floor(T.t / 90) % 2) ? 'ball' : 'ball2';
        T.yOffset = -Math.abs(Math.sin(T.t / 80)) * 6; T.shakeX = rand(-3, 3);
        T.petMoodT += dt;
        if (T.petMoodT > 650) { T.petMoodT = 0; bumpMood(1); }
        if (!T.speech && Math.random() < 0.012) say(pick(['hehe!', 'haha stop!', 'that tickles!', 'eee!']), '#159a52');
        T.zTimer += dt;
        if (T.zTimer > 480) { T.zTimer = 0; T.hearts.push({ x: T.x + rand(-10, 10), y: groundY() - STAND_H * 0.7, vx: rand(-14, 14), vy: rand(-30, -16), life: 1000, maxLife: 1000, sc: 0.4 }); }
        return !cursorOverTroll(24) || cur.speed < 80 || T.t >= T.dur;   // stopped jiggling / left → done
      }
      if (a === 'chase') {                             // pointer hovering nearby → he bats at it / creeps to sniff it
        T.color = GREEN; T.scale = 1;
        if (cursorOverTroll(10)) return true;           // cursor came onto him → let pet/tickle take over
        if (!cursorNearTroll(120)) return true;         // cursor wandered off → give up
        T.mirror = cur.x < T.x;
        const dx = cur.x - T.x, stillMs = performance.now() - cur.lastT;
        if (Math.abs(dx) > 46 && stillMs > 350) {       // parked nearby → creep over to investigate
          T.dir = dx > 0 ? 1 : -1;
          T.x += T.dir * 72 * dt / 1000; animLegs(dt, 'walkA', 'walkB', 120); T.yOffset = 0;
        } else {                                        // bat at it like a cat
          T.pose = (Math.floor(T.t / 120) % 2) ? 'wave' : 'kick';
          T.yOffset = -Math.abs(Math.sin(T.t / 100)) * 4; T.shakeX = rand(-1, 1);
        }
        return T.t >= T.dur;
      }
      if (a === 'flinch') {                            // soured → wary recoil away from the cursor
        T.color = mix(0.3); T.scale = 1;
        const away = cur.x < T.x ? 1 : -1;
        if (T.t < 250) { T.pose = 'jump'; T.yOffset = -Math.sin(Math.PI * T.t / 250) * 10; T.x += away * 65 * dt / 1000; }
        else { T.pose = (Math.floor(T.t / 100) % 2) ? 'lookL' : 'lookR'; T.shakeX = rand(-2, 2); T.yOffset = 0; }
        T.mirror = cur.x < T.x;                          // keeps a wary eye on the cursor
        return T.t >= T.dur;
      }

      // ---- panel interactions --------------------------------------------
      if (a === 'napWidget') {                          // climb onto a panel and snooze on top
        const Wd = T.widget;
        if (!Wd) return true;
        const sitY = Wd.top - groundY();                // negative → lifts his feet up onto the ledge
        if (!Wd.up && Math.abs(T.x - Wd.cx) >= 8) {      // walk over along the floor
          T.dir = Wd.cx > T.x ? 1 : -1; T.mirror = T.dir < 0;
          T.x += T.dir * T.speed * dt / 1000; animLegs(dt, 'walkA', 'walkB', 130); T.yOffset = 0;
          return false;
        }
        if (!Wd.up) { Wd.up = true; Wd.climbT = 0; T.x = Wd.cx; }
        Wd.climbT += dt;
        if (Wd.climbT < 380) {                          // hop up onto it
          T.pose = 'jump'; T.mirror = false;
          T.yOffset = sitY * (Wd.climbT / 380) - Math.sin(Math.PI * Wd.climbT / 380) * 12;
          return false;
        }
        T.yOffset = sitY;
        if (T.t < T.dur - 520) {                         // curl up and sleep, little Z's drifting off the ledge
          T.pose = 'laydown'; T.shakeX = 0;
          T.zTimer += dt;
          if (T.zTimer > 820) { T.zTimer = 0; T.zzz.push({ x: T.x + rand(6, 26), y: Wd.top - 30, vx: rand(5, 16), vy: rand(-54, -42), life: 1900, maxLife: 1900 }); }
          return false;
        }
        const k = (T.t - (T.dur - 520)) / 520;          // hop back down
        T.pose = 'jump'; T.yOffset = sitY * (1 - k) - Math.sin(Math.PI * k) * 10;
        return T.t >= T.dur;
      }
      if (a === 'leanWidget') {                         // lean against a panel's side and shove it
        const Wd = T.widget;
        if (!Wd) return true;
        if (Math.abs(T.x - Wd.standX) >= 6 && T.t < T.dur - 600) {  // amble over to the side
          T.dir = Wd.standX > T.x ? 1 : -1; T.mirror = T.dir < 0;
          T.x += T.dir * T.speed * dt / 1000; animLegs(dt, 'walkA', 'walkB', 130); T.yOffset = 0;
          if (Math.abs(T.x - Wd.standX) < 6) T.x = Wd.standX;
          return false;
        }
        T.x = Wd.standX; T.mirror = Wd.lean < 0;         // face into the panel
        T.pose = 'stretch'; T.yOffset = 0; T.shakeX = Math.sin(T.t / 280);
        T.poseT += dt;
        if (T.poseT > 1100) { T.poseT = 0; bumpWidget(Wd.el, Wd.lean * 220, 0); T.shakeX = rand(-2, 2); }  // a lazy shove → it wobbles
        return T.t >= T.dur;
      }

      // ---- app-driven reactions + boredom --------------------------------
      if (a === 'cheer') {                              // the app says something good happened → he celebrates
        T.color = GREEN; T.scale = 1;
        T.pose = (Math.floor(T.t / 150) % 2) ? 'wave' : 'jump';
        T.yOffset = -Math.abs(Math.sin(T.t / 120)) * 12; T.mirror = (Math.floor(T.t / 300) % 2) === 0;
        if (!T.sneezed && T.t > 120) {                  // a confetti pop
          T.sneezed = true;
          for (let i = 0; i < 24; i++) { const ang = rand(-Math.PI * 0.9, -Math.PI * 0.1), sp = rand(150, 360);
            T.confetti.push({ x: T.x + rand(-8, 8), y: groundY() - STAND_H * 0.7, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: rand(800, 1500), size: Math.round(rand(3, 6)), color: pick([GREEN, GOLD, HEART, '#7fd3ff']) }); }
        }
        if (!T.heartSent && T.t > 160) { T.heartSent = true; say(pick(['nice!', "let's go!", 'woohoo!', 'great work!', 'we did it!']), '#159a52'); }
        return T.t >= T.dur;
      }
      if (a === 'fret') {                               // the app says something went wrong → he frets
        T.color = mix(0.2); T.scale = 1;
        T.pose = (Math.floor(T.t / 110) % 2) ? 'lookL' : 'lookR'; T.shakeX = rand(-2, 2);
        T.yOffset = -Math.abs(Math.sin(T.t / 140)) * 3;
        if (!T.heartSent && T.t > 160) { T.heartSent = true; say(pick(['uh oh', 'yikes', 'oh no', "that's not good", 'eep!']), '#d22'); }
        T.poseT += dt;
        if (T.poseT > 220) {                            // little anxious sweat drops
          T.poseT = 0;
          for (let i = 0; i < 2; i++) T.confetti.push({ x: T.x + rand(-12, 12), y: groundY() - STAND_H * 0.9, vx: rand(-30, 30), vy: rand(-60, -20), life: rand(300, 600), size: Math.round(rand(2, 4)), color: '#7fd3ff' });
        }
        return T.t >= T.dur;
      }
      if (a === 'bored') {                              // you've ignored him a while → he angles for attention
        T.color = GREEN; T.scale = 1; T.mirror = false;
        const m = T.t % 1600;
        if (m < 600) { T.pose = 'pointUp'; T.yOffset = 0; T.shakeX = rand(-1, 1); }        // *tap tap* the glass
        else if (m < 1100) { T.pose = 'stretch'; T.yOffset = -Math.min(6, (m - 600) / 60); T.shakeX = 0; }  // yawn / stretch
        else { T.pose = (Math.floor(m / 130) % 2) ? 'lookL' : 'lookR'; T.yOffset = 0; }    // peer around for you
        if (!T.heartSent && T.t > 200) { T.heartSent = true; say(pick(['you still there?', 'helloo?', '*taps glass*', 'bored...', 'hey, look at me!']), '#1c1c1c'); }
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
      if (a === 'friend') {                             // a buddy troll runs in, they play, he heads off
        const F = T.friend;
        if (!F) return T.t >= T.dur;
        const ENTER = 2000, PLAY_END = 6200;
        if (T.t < ENTER) {                              // friend hustles in; troll turns and waves
          const reached = F.dir === -1 ? F.x <= F.stopX : F.x >= F.stopX;
          if (!reached) { F.x += F.dir * F.speed * dt / 1000; F.legT += dt; if (F.legT > 70) { F.legT = 0; F.legFlip = !F.legFlip; } F.pose = F.legFlip ? 'walkB' : 'walkA'; F.mirror = F.dir < 0; }
          else { F.pose = 'stand'; F.mirror = T.x < F.x; }
          T.pose = 'wave'; T.mirror = F.x < T.x; T.yOffset = 0; T.shakeX = 0;
        } else if (T.t < PLAY_END) {                    // ...the activity
          F.mirror = T.x < F.x; T.mirror = F.x < T.x;   // face each other
          const pt = T.t - ENTER;
          if (F.act === 'highfive') {                   // both leap up and slap hands
            const phase = (pt % 950) / 950, up = -Math.sin(Math.PI * phase) * 22;
            T.yOffset = up; F.yOff = up;
            T.pose = up < -6 ? 'pointUp' : 'stand'; F.pose = up < -6 ? 'pointUp' : 'stand';
            if (phase > 0.46 && phase < 0.54) for (let i = 0; i < 2; i++) T.confetti.push({ x: (T.x + F.x) / 2 + rand(-6, 6), y: groundY() + up - STAND_H * 0.9, vx: rand(-60, 60), vy: rand(-80, -20), life: rand(250, 500), size: Math.round(rand(2, 4)), color: GOLD });
          } else if (F.act === 'dance') {               // a little dance-off, notes flying
            const fr = ['pointUp', 'wave', 'headDown', 'jump'];
            T.pose = fr[Math.floor(pt / 180) % fr.length]; F.pose = fr[Math.floor((pt + 90) / 180) % fr.length];
            T.yOffset = -Math.abs(Math.sin(pt / 130)) * 8; F.yOff = -Math.abs(Math.sin((pt + 200) / 130)) * 8;
            if (Math.random() < 0.05) T.zzz.push({ x: (T.x + F.x) / 2 + rand(-30, 30), y: groundY() - STAND_H * 0.95, vx: rand(-22, 22), vy: rand(-52, -40), life: 1500, maxLife: 1500, glyph: NOTE_GLYPH });
          } else {                                      // tag: they bounce around each other
            const phase = (pt % 760) / 760;
            T.yOffset = -Math.abs(Math.sin(Math.PI * phase)) * 16; T.pose = T.yOffset < -5 ? 'jump' : 'squash';
            F.yOff = -Math.abs(Math.sin(Math.PI * ((pt + 380) % 760) / 760)) * 16; F.pose = F.yOff < -5 ? 'jump' : 'squash';
          }
        } else {                                        // friend waves and runs back off
          if (!T.sneezed) { T.sneezed = true; bumpMood(5); }   // that was fun → warms him a little
          F.dir = F.x >= T.x ? 1 : -1;
          F.x += F.dir * Math.max(F.speed, 280) * dt / 1000;
          F.legT += dt; if (F.legT > 70) { F.legT = 0; F.legFlip = !F.legFlip; }
          F.pose = F.legFlip ? 'walkB' : 'walkA'; F.mirror = F.dir < 0; F.yOff = 0;
          T.pose = 'wave'; T.mirror = F.x < T.x; T.yOffset = 0;
          if (F.x < -off - 40 || F.x > W() + off + 40) F.gone = true;
        }
        const done = T.t >= T.dur || F.gone;
        if (done) T.friend = null;
        return done;
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
      if (a === 'police') {                             // marches in with a cop, rants while the cop takes notes, both leave
        const ENTER = 2400, RANT_END = 11500;
        const C = T.cop;
        if (!C && !T.policeKill) return T.t >= T.dur;

        // Someone got shot mid-scene → the survivor panics and bolts, then it ends.
        if (T.policeKill === 'troll') {                 // troll's dead (gore already out) → cop flees, troll's banished
          T.alpha = 0;                                  // body gone; only the gore remains
          if (C) {
            const fd = C.x < W() / 2 ? -1 : 1;
            C.mirror = fd < 0; C.writing = false;
            C.x += fd * 600 * dt / 1000;
            C.legT += dt; if (C.legT > 65) { C.legT = 0; C.legFlip = !C.legFlip; }
            C.yOff = -Math.abs(Math.sin(T.t / 60)) * 3; // panicked little hops
            if (C.x > -off - 70 && C.x < W() + off + 70 && T.t < T.dur) return false;
          }
          T.cop = null; T.copSpeech = null; T.banished = true;  // cop's clear (or timed out) → he's gone for good
          return true;
        }
        if (T.policeKill === 'cop') {                   // cop's dead → troll bolts, then returns as the monster
          T.cop = null; T.copSpeech = null;
          T.leaving = true; T.color = GREEN;
          const fd = T.x < W() / 2 ? -1 : 1;
          T.mirror = fd < 0; T.x += fd * 650 * dt / 1000;
          animLegs(dt, 'walkA', 'walkB', 50);
          T.yOffset = 0; T.shakeX = rand(-2, 2);        // scared
          const done = T.x < -off || T.x > W() + off || T.t >= T.dur;
          // Bolted off-screen → everything stops; the monster claws back in 2 min
          // (monsterReturnAt was set in killInScene) via the banished branch.
          if (done) { T.cop = null; T.copSpeech = null; T.banished = true; }
          return done;
        }

        const dir = T.dir, trollStop = T.policeStopX, copStop = trollStop - dir * 92;
        if (T.t < ENTER) {                              // the two of them march in
          const reachedT = dir === 1 ? T.x >= trollStop : T.x <= trollStop;
          if (!reachedT) { T.x += dir * 125 * dt / 1000; animLegs(dt, 'walkA', 'walkB', 120); } else T.pose = 'stand';
          T.mirror = dir < 0; T.color = GREEN; T.yOffset = 0;
          const reachedC = dir === 1 ? C.x >= copStop : C.x <= copStop;
          if (!reachedC) { C.x += dir * 115 * dt / 1000; C.yOff = -Math.abs(Math.sin(T.t / 120)) * 2; } else C.yOff = 0;
          C.legT += dt; if (C.legT > 150) { C.legT = 0; C.legFlip = !C.legFlip; }
          C.mirror = dir < 0;
        } else if (T.t < RANT_END) {                    // he points and shouts; the cop stands and scribbles
          T.mirror = C.x < T.x; C.mirror = T.x > C.x;   // face each other
          T.color = mix(0.72);                          // red in the face
          const fr = ['pointUp', 'wave', 'headDown', 'pointUp', 'jump'];
          T.pose = fr[Math.floor(T.t / 190) % fr.length];
          T.yOffset = -Math.abs(Math.sin(T.t / 150)) * 5; T.shakeX = rand(-2, 2);
          T.poseT += dt;
          if (T.poseT > 2700 && !T.speech) { T.poseT = 0; say(pick(POLICE_TROLL), '#d22'); }  // a fresh accusation
          C.writeT += dt;
          if (C.writeT > 1400) {                        // the cop nods, jots a note, mutters
            C.writeT = 0; C.writing = !C.writing;
            if (C.writing && Math.random() < 0.6 && !T.copSpeech) sayCop(pick(POLICE_COP));
          }
          C.yOff = C.writing ? -Math.abs(Math.sin(T.t / 80)) * 1.5 : 0;
        } else {                                        // both walk off the far side
          T.color = mix(0.45); T.mirror = dir < 0; C.mirror = dir < 0;
          const sp = C.exitSpeed;
          T.x += dir * sp * dt / 1000; animLegs(dt, 'walkA', 'walkB', 110); T.yOffset = 0; T.shakeX = 0;
          C.x += dir * sp * dt / 1000;
          C.legT += dt; if (C.legT > 150) { C.legT = 0; C.legFlip = !C.legFlip; } C.yOff = 0;
        }
        // ends when the trailing one (the cop) has cleared the exit edge.
        const gone = T.t >= T.dur || (T.t > RANT_END && (dir === 1 ? C.x > W() + off + 50 : C.x < -off - 50));
        if (gone) { T.cop = null; T.copSpeech = null; T.speech = null; }
        return gone;
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
      if (a === 'phiccup') {                            // a fit of the hiccups — involuntary *hic* jolts
        const period = 440;
        T.poseT += dt;
        if (T.poseT >= period) {                        // a fresh hiccup → little puff of air
          T.poseT -= period;
          for (let i = 0; i < 3; i++) T.confetti.push({
            x: T.x + rand(-6, 6), y: groundY() - STAND_H * 0.9,
            vx: rand(-30, 30), vy: rand(-90, -40),
            life: rand(400, 700), size: Math.round(rand(2, 4)),
          });
        }
        const ph = T.poseT;
        if (ph < 110) { T.pose = 'jump'; T.yOffset = -Math.sin(Math.PI * ph / 110) * 24; T.shakeX = rand(-2, 2); }
        else { T.pose = (Math.floor(T.t / 220) % 2) ? 'lookL' : 'lookR'; T.yOffset = 0; T.shakeX = 0; }
        return T.t >= T.dur;
      }
      if (a === 'pzap') {                               // static shock — rigid, crackling, flickering
        if (T.t < T.dur - 300) {
          T.pose = (Math.floor(T.t / 60) % 2) ? 'stretch' : 'pointUp';   // jolted bolt-upright
          T.yOffset = -Math.abs(Math.sin(T.t / 50)) * 4;
          T.shakeX = rand(-6, 6);
          T.color = (Math.floor(T.t / 90) % 2) ? RED : GREEN;            // crackle
          T.alpha = (Math.floor(T.t / 45) % 5 === 0) ? 0.4 : 1;          // flicker
          T.poseT += dt;
          if (T.poseT > 70) {                                           // sparks fly off
            T.poseT = 0;
            for (let i = 0; i < 4; i++) T.confetti.push({
              x: T.x + rand(-14, 14), y: groundY() - STAND_H * rand(0.4, 1.1),
              vx: rand(-140, 140), vy: rand(-160, -40),
              life: rand(200, 500), size: Math.round(rand(2, 4)),
              color: Math.random() < 0.5 ? GOLD : GREEN,
            });
          }
        } else { T.pose = 'stand'; T.color = GREEN; T.alpha = 1; T.shakeX = rand(-1, 1); }
        return T.t >= T.dur;
      }
      if (a === 'pmelt') {                              // melts into a puddle, then reforms
        const downEnd = T.dur * 0.5, holdEnd = T.dur * 0.62;
        if (T.t < downEnd) {                            // sags and slumps down flat
          const k = T.t / downEnd;
          T.pose = k < 0.4 ? 'squash' : 'pancake';
          T.yOffset = k * 10;
          if (!T.sneezed && k > 0.9) {                  // a couple of drips spread out
            T.sneezed = true;
            for (let i = 0; i < 5; i++) T.confetti.push({
              x: T.x + rand(-14, 14), y: groundY() - 8,
              vx: rand(-30, 30), vy: rand(-10, 10), life: rand(500, 900), size: Math.round(rand(2, 4)),
            });
          }
        } else if (T.t < holdEnd) {                     // a flat puddle for a beat
          T.pose = 'pancake'; T.yOffset = 10;
        } else {                                        // reforms and springs back up
          const k = (T.t - holdEnd) / (T.dur - holdEnd);
          T.pose = k < 0.4 ? 'pancake' : k < 0.7 ? 'squash' : 'stretch';
          T.yOffset = 10 * (1 - k) - (k > 0.7 ? Math.sin(Math.PI * (k - 0.7) / 0.3) * 8 : 0);
        }
        return T.t >= T.dur;
      }
      if (a === 'pcry') {                               // bursts into tears, sobs, sniffles it off
        if (T.t < T.dur - 400) {
          T.pose = (Math.floor(T.t / 200) % 2) ? 'headDown' : 'sit';     // shoulders heaving
          T.shakeX = rand(-2, 2);
          T.poseT += dt;
          if (T.poseT > 130) {                                          // tears spurt out both sides
            T.poseT = 0;
            for (const s of [-1, 1]) T.confetti.push({
              x: T.x + s * 8, y: groundY() - STAND_H * 0.55,
              vx: s * rand(40, 90), vy: rand(-120, -60),
              life: rand(600, 1000), size: Math.round(rand(2, 4)),
            });
          }
        } else { T.pose = 'stand'; T.shakeX = 0; T.yOffset = 0; }
        return T.t >= T.dur;
      }
      if (a === 'plove') {                              // loves the attention — happy bounce + hearts
        T.pose = (Math.floor(T.t / 180) % 2) ? 'wave' : 'jump';
        T.yOffset = -Math.abs(Math.sin(T.t / 130)) * 12;
        T.legT += dt;
        if (T.legT > 200) {
          T.legT = 0;
          T.hearts.push({
            x: T.x + rand(-12, 12), y: groundY() - STAND_H * 0.8,
            vx: rand(-18, 18), vy: rand(-40, -24), life: 1300, maxLife: 1300, sc: rand(0.4, 0.6),
          });
        }
        if (T.t > T.dur - 200) { T.pose = 'stand'; T.yOffset = 0; }
        return T.t >= T.dur;
      }
      if (a === 'pjackpot') {                           // JACKPOT — pops, gold coins erupt and rain
        if (!T.sneezed && T.t > 200) {
          T.sneezed = true;
          for (let i = 0; i < 30; i++) {
            const ang = rand(-Math.PI * 0.95, -Math.PI * 0.05), sp = rand(150, 420);
            T.confetti.push({
              x: T.x + rand(-8, 8), y: groundY() - STAND_H * 0.7,
              vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
              life: rand(800, 1500), size: Math.round(rand(3, 6)), color: GOLD,
            });
          }
        }
        if (T.t < 200) { T.pose = 'squash'; }
        else if (T.t < 500) { T.pose = 'jump'; T.yOffset = -Math.sin(Math.PI * (T.t - 200) / 300) * 30; }
        else {                                          // dances on his winnings
          T.pose = (Math.floor(T.t / 150) % 2) ? 'pointUp' : 'wave';
          T.yOffset = -Math.abs(Math.sin(T.t / 120)) * 6;
          T.mirror = (Math.floor(T.t / 150) % 2) === 0;
        }
        if (T.t > T.dur - 150) { T.pose = 'stand'; T.yOffset = 0; T.mirror = false; }
        return T.t >= T.dur;
      }
      if (a === 'praspberry') {                         // puffs up indignant, then blows a raspberry
        const puffEnd = 700, blowEnd = 1100;
        if (T.t < puffEnd) {                            // inflates, cheeks fit to burst
          const k = T.t / puffEnd;
          T.scale = 1 + k * 0.5; T.pose = 'squash'; T.shakeX = k > 0.7 ? rand(-2, 2) : 0;
        } else if (T.t < blowEnd) {                     // ...pfffbbt — spit flies
          T.scale = 1.5; T.pose = 'stretch'; T.shakeX = rand(-4, 4);
          if (!T.sneezed) {
            T.sneezed = true;
            for (let i = 0; i < 14; i++) {
              const ang = rand(-0.6, 0.6), sp = rand(120, 320);
              T.confetti.push({
                x: T.x + 12, y: groundY() - STAND_H * 0.5,
                vx: Math.cos(ang) * sp + 60, vy: Math.sin(ang) * sp,
                life: rand(400, 800), size: Math.round(rand(2, 5)),
              });
            }
          }
        } else {                                        // deflates back to normal
          const k = (T.t - blowEnd) / (T.dur - blowEnd);
          T.scale = 1.5 - 0.5 * k; T.pose = k < 0.6 ? 'squash' : 'stand';
          T.shakeX = rand(-3, 3) * (1 - k);
        }
        return T.t >= T.dur;
      }
      if (a === 'psplit') {                             // startled clean into the splits, scrambles up
        if (T.t < 140) { T.pose = 'jump'; T.yOffset = -Math.sin(Math.PI * T.t / 140) * 22; }
        else if (T.t < T.dur - 300) { T.pose = 'splits'; T.yOffset = 0; T.shakeX = T.t < 400 ? rand(-2, 2) : 0; }
        else { T.pose = 'stand'; T.yOffset = -Math.sin(Math.PI * (T.t - (T.dur - 300)) / 300) * 6; }
        return T.t >= T.dur;
      }
      if (a === 'pflick') {                             // flicked like a bug — arcs, ricochets off widgets, settles
        const F = T.flick;
        if (!F) return true;
        const sec = dt / 1000, g = 2050;                // floatier gravity → longer, wilder arcs
        F.grounded = false;
        // integrate: vy>0 is upward, gravity bleeds it off; h is height above the floor
        F.vy -= g * sec;
        F.h += F.vy * sec;
        T.x += F.vx * sec;

        if (F.h <= 0) {                                 // hit the floor
          F.h = 0;
          if (F.vy < -90) {                             // a real landing → big bouncy rebound + dust
            F.vy = -F.vy * 0.74;                        // keeps most of his energy — superball physics
            F.vx = F.vx * 0.9 + rand(-140, 140);        // scrub a little, add chaotic english
            F.bounces++;
            for (let i = 0; i < 12; i++) T.confetti.push({
              x: T.x + rand(-12, 12), y: groundY() - 6,
              vx: rand(-200, 200), vy: rand(-240, -30),
              life: rand(300, 800), size: Math.round(rand(2, 6)),
            });
          } else { F.vy = 0; F.grounded = true; }       // too slow to bounce → rest on the floor
        }

        // walls don't just stop him — they kick him back AND fling him upward, so
        // he keeps caroming around instead of dying in a corner.
        if (T.x < off) { T.x = off; F.vx = Math.abs(F.vx) * 0.82; F.vy += rand(120, 360); F.bounces++; }
        else if (T.x > W() - off) { T.x = W() - off; F.vx = -Math.abs(F.vx) * 0.82; F.vy += rand(120, 360); F.bounces++; }

        collideObstacles(F);                            // ...and off the floating widgets

        T.yOffset = -F.h;
        T.mirror = F.vx < 0;

        const airborne = !F.grounded && (F.h > 4 || Math.abs(F.vy) > 70);
        if (airborne) {                                 // full tumble through the air — faster the faster he goes
          F.spin += dt * (1 + Math.min(2.5, (Math.abs(F.vx) + Math.abs(F.vy)) / 700));
          const frames = ['ball', 'cartX', 'ball2', 'cartPlus'];
          T.pose = frames[Math.floor(F.spin / 45) % frames.length];
          F.rest = 0;
        } else if (Math.abs(F.vx) > 55) {               // skidding along a surface (floor or panel top)
          F.spin += dt;
          T.pose = (Math.floor(F.spin / 70) % 2) ? 'ball' : 'ball2';
          F.vx -= F.vx * Math.min(1, 5 * sec);          // surface friction
          F.rest = 0;
        } else if (F.h > 8) {                           // perched atop a widget, out of steam → roll off the nearer edge
          F.vx += (T.x < W() / 2 ? -1 : 1) * 260 * sec;
          F.spin += dt;
          T.pose = (Math.floor(F.spin / 90) % 2) ? 'sit' : 'ball';
          F.rest = 0;
        } else {                                        // come to rest on the floor → flop, sit up, stand
          F.rest += dt; T.yOffset = 0;
          T.pose = F.rest < 200 ? 'squash' : F.rest < 360 ? 'sit' : 'stand';
        }
        return F.rest > 440 || T.t > T.dur;
      }

      // ---- drag & drop ----------------------------------------------------
      if (a === 'grab') {                               // dangling from the cursor, kicking & flailing
        const G = T.grab;
        if (!G) return true;
        T.scale = 1; T.color = GREEN; T.alpha = 1;
        T.x = G.cx;
        T.yOffset = (G.cy + STAND_H * 0.5) - groundY(); // center pinned to the pointer
        G.struggleT += dt;
        if (T.mood >= 40) {                             // he trusts you → just dangles happily, no fight
          T.pose = (Math.floor(G.struggleT / 260) % 2) ? 'wave' : 'sit';
          T.shakeX = Math.sin(G.struggleT / 200) * 1.5; T.mirror = cur.x < T.x;
          G.puffT += dt;
          if (G.puffT > 900) { G.puffT = 0; T.hearts.push({ x: T.x + rand(-8, 8), y: groundY() + T.yOffset - STAND_H * 0.5, vx: rand(-8, 8), vy: rand(-22, -12), life: 1100, maxLife: 1100, sc: 0.4 }); }
          return false;
        }
        const fr = ['kick', 'jump', 'wave', 'pointUp', 'stretch', 'kick', 'headDown'];
        T.pose = fr[Math.floor(G.struggleT / 80) % fr.length];
        T.shakeX = rand(-5, 5);
        T.mirror = (Math.floor(G.struggleT / 80) % 2) === 0;
        G.puffT += dt;
        if (G.puffT > 150) {                            // little scuffle bits as he thrashes
          G.puffT = 0;
          for (let i = 0; i < 2; i++) T.confetti.push({
            x: T.x + rand(-12, 12), y: groundY() + T.yOffset - STAND_H * rand(0.2, 0.7),
            vx: rand(-70, 70), vy: rand(-40, 60), life: rand(250, 500), size: Math.round(rand(2, 4)),
          });
        }
        return false;                                   // ends only when the mouse handlers release him
      }
      if (a === 'dropChute') {                          // a little parachute — drifts gently down, over the widgets
        const D = T.drop, sec = dt / 1000;
        D.vy -= 720 * sec;                              // light gravity
        if (D.vy < -150) D.vy = -150;                   // gentle terminal descent
        D.h += D.vy * sec;
        D.sway += dt;
        D.vx *= Math.max(0, 1 - 1.5 * sec);             // shed the throw
        T.x += (D.vx + Math.sin(D.sway / 300) * 34) * sec;   // carry + lazy side-to-side drift
        if (T.x < off) T.x = off; if (T.x > W() - off) T.x = W() - off;
        T.mirror = Math.sin(D.sway / 300) < 0;
        if (D.h > 0) {
          T.pose = (Math.floor(T.t / 220) % 2) ? 'sit' : 'stand';
          T.yOffset = -D.h; T.shakeX = Math.sin(D.sway / 110) * 2;
          return false;
        }
        D.h = 0; D.landed = true; T.yOffset = 0; T.shakeX = 0;    // touchdown — canopy collapses
        if (!D.grounded) {
          D.grounded = true;
          for (let i = 0; i < 8; i++) T.confetti.push({
            x: T.x + rand(-10, 10), y: groundY() - 5,
            vx: rand(-70, 70), vy: rand(-60, -10), life: rand(300, 600), size: Math.round(rand(2, 4)),
          });
        }
        D.restT += dt;
        T.pose = D.restT < 160 ? 'squash' : D.restT < 320 ? 'stretch' : 'stand';
        const done = D.restT > 420;
        if (done) T.drop = null;
        return done;
      }
      if (a === 'dropFall') {                           // no chute — just drops and thumps down
        const D = T.drop, sec = dt / 1000, g = 2400;
        D.vy -= g * sec; D.h += D.vy * sec; T.x += D.vx * sec;
        if (T.x < off) { T.x = off; D.vx = Math.abs(D.vx) * 0.6; }
        else if (T.x > W() - off) { T.x = W() - off; D.vx = -Math.abs(D.vx) * 0.6; }
        if (D.h <= 0) {
          D.h = 0;
          if (D.vy < -300 && D.bounces < 1) {           // one lazy bounce on a hard landing
            D.vy = -D.vy * 0.45; D.vx *= 0.7; D.bounces++;
            for (let i = 0; i < 12; i++) T.confetti.push({
              x: T.x + rand(-12, 12), y: groundY() - 6,
              vx: rand(-180, 180), vy: rand(-200, -30), life: rand(300, 700), size: Math.round(rand(2, 5)),
            });
          } else { D.vy = 0; D.grounded = true; }
        }
        T.yOffset = -D.h;
        if (!D.grounded && (D.h > 4 || Math.abs(D.vy) > 80)) {   // tumbling through the air
          D.spin += dt * 1.6;
          const frames = ['ball', 'cartX', 'ball2', 'cartPlus'];
          T.pose = frames[Math.floor(D.spin / 45) % frames.length];
          T.mirror = D.vx < 0; D.restT = 0;
        } else {                                        // down → flop, sit up, stand
          D.restT += dt; T.yOffset = 0;
          T.pose = D.restT < 170 ? 'squash' : D.restT < 340 ? 'sit' : 'stand';
        }
        const done = (D.grounded && D.restT > 420) || T.t > T.dur;
        if (done) T.drop = null;
        return done;
      }
      if (a === 'dropSplat') {                          // bad luck (10%) — bursts into blood, sinks into the ground
        const D = T.drop, sec = dt / 1000;
        if (!D.exploded) {                              // plummets, flailing
          D.vy -= 2600 * sec; D.h += D.vy * sec; T.x += D.vx * sec;
          if (T.x < off) T.x = off; if (T.x > W() - off) T.x = W() - off;
          D.spin += dt * 1.8;
          const frames = ['ball', 'cartX', 'ball2', 'cartPlus'];
          T.pose = frames[Math.floor(D.spin / 40) % frames.length];
          T.mirror = D.vx < 0; T.yOffset = -D.h;
          if (D.h <= 0) {                               // SPLAT — he ruptures
            D.exploded = true; D.restT = 0;
            T.color = RED; T.alpha = 0;                 // body gone, only the gore is left
            T.pool = { x: T.x, grow: 0, sink: 0 };
            for (let i = 0; i < 56; i++) {              // blood + little pieces fly out
              const ang = rand(-Math.PI, 0), sp = rand(80, 460);
              T.confetti.push({
                x: T.x + rand(-14, 14), y: groundY() - 8,
                vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp,
                life: rand(500, 1400), size: Math.round(rand(2, 7)),
                color: Math.random() < 0.12 ? GREEN : RED,
              });
            }
          }
          return false;
        }
        T.alpha = 0; D.restT += dt;                     // aftermath: pool spreads, then sinks under
        T.pool.grow = Math.min(1, D.restT / 280);
        if (D.restT > 800) T.pool.sink = Math.min(1, (D.restT - 800) / 1200);
        const done = D.restT > 2200;
        if (done) { T.drop = null; T.pool = null; }
        return done;
      }
      if (a === 'shot') {                               // right-click — shot dead, blood across the whole screen
        if (!T.landed) {
          T.landed = true;
          T.color = RED;
          const oy = groundY() + T.yOffset - STAND_H * 0.5;
          spawnSplats(T.x, oy);
          for (let i = 0; i < 64; i++) {                // chunky burst at the point of impact
            const ang = rand(-Math.PI, Math.PI), sp = rand(90, 560);
            T.confetti.push({
              x: T.x + rand(-10, 10), y: oy,
              vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 80,
              life: rand(600, 1500), size: Math.round(rand(2, 8)),
              color: Math.random() < 0.28 ? GREEN : RED,
            });
          }
          for (let i = 0; i < 22; i++) {                // a close spray of green bits of him
            const ang = rand(-Math.PI, Math.PI), sp = rand(40, 240);
            T.confetti.push({
              x: T.x + rand(-8, 8), y: oy,
              vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 40,
              life: rand(500, 1100), size: Math.round(rand(2, 6)), color: GREEN,
            });
          }
        }
        if (T.t < 110) { T.pose = 'squash'; T.shakeX = rand(-6, 6); }  // a single violent jolt
        else { T.alpha = 0; }                                          // then he's just gone
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

    // The meat blitter — like blit, but each char keys into a colour, and a
    // growing bite is taken out of the side he's eating from (m.eat: 0→1).
    function drawMeat(m) {
      const rows = m.rows, w = spriteW(rows), h = rows.length;
      const px = m.px || MEAT_PIXEL, size = Math.ceil(px);   // big cut = double-size pixels
      const left = m.x - (w * px) / 2, top = m.y - h * px;
      const eaten = Math.round(m.eat * w);
      for (let r = 0; r < h; r++) {
        const row = rows[r];
        for (let c = 0; c < row.length; c++) {
          const ch = row[c];
          if (ch === '.' || ch === ' ') continue;
          if (m.biteSide > 0 ? c < eaten : c >= w - eaten) continue;  // already chomped away
          ctx.fillStyle = MEAT_COLORS[ch] || '#fff';
          ctx.fillRect(Math.round(left + c * px), Math.round(top + r * px), size, size);
        }
      }
    }

    // The cop blitter — like blit, but each char keys into a colour (his blue
    // uniform, gold badge, green troll skin), with mirror + scale like the troll.
    function drawCop(rows, cx, feetY, scale, mirror, yOff = 0) {
      const w = spriteW(rows), h = rows.length, px = PIXEL * scale, size = Math.ceil(px);
      const left = cx - (w * px) / 2, top = feetY - h * px + yOff;
      for (let r = 0; r < h; r++) {
        const row = rows[r];
        for (let c = 0; c < row.length; c++) {
          const ch = row[c];
          if (ch === '.' || ch === ' ') continue;
          const cc = mirror ? (w - 1 - c) : c;
          ctx.fillStyle = COP_COLORS[ch] || GREEN;
          ctx.fillRect(Math.round(left + cc * px), Math.round(top + r * px), size, size);
        }
      }
    }

    // A smooth (non-pixelated) heart, for the big max-love heart — a blocky glyph
    // scaled up just reads as a square, so this one's drawn with curves. (cx, topY)
    // is the top-center; w is the width, height a touch less.
    function drawHeart(cx, topY, w, color) {
      const h = w * 0.9;
      ctx.save();
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(cx, topY + h * 0.27);
      ctx.bezierCurveTo(cx, topY, cx - w * 0.5, topY, cx - w * 0.5, topY + h * 0.32);          // left lobe
      ctx.bezierCurveTo(cx - w * 0.5, topY + h * 0.62, cx - w * 0.18, topY + h * 0.8, cx, topY + h);  // down to the point
      ctx.bezierCurveTo(cx + w * 0.18, topY + h * 0.8, cx + w * 0.5, topY + h * 0.62, cx + w * 0.5, topY + h * 0.32);
      ctx.bezierCurveTo(cx + w * 0.5, topY, cx, topY, cx, topY + h * 0.27);                    // right lobe
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }

    // Collectibles on the floor: each falls in, sits with a little bob and a
    // blinking shine, and fades after a minute if you don't click it.
    function drawGifts(dt) {
      for (let i = T.gifts.length - 1; i >= 0; i--) {
        const g = T.gifts[i];
        if (!g.landed) {
          g.vy += 1400 * dt / 1000; g.y += g.vy * dt / 1000; g.x += g.vx * dt / 1000; g.vx *= 0.98;
          if (g.y >= groundY()) { g.y = groundY(); g.landed = true; g.vy = 0; }
        } else { g.life += dt; if (g.life > 60000) { T.gifts.splice(i, 1); continue; } }
        const art = GIFT_ART[g.kind], rows = art.rows, w = spriteW(rows), h = rows.length, px = GIFT_PIXEL, size = Math.ceil(px);
        const bob = g.landed ? Math.sin(g.life / 260) * 1.5 : 0;
        const left = g.x - (w * px) / 2, top = g.y - h * px + bob;
        ctx.globalAlpha = g.life > 56000 ? Math.max(0, 1 - (g.life - 56000) / 4000) : 1;
        ctx.fillStyle = art.color;
        for (let r = 0; r < h; r++) for (let c = 0; c < rows[r].length; c++) if (rows[r][c] === '#') ctx.fillRect(Math.round(left + c * px), Math.round(top + r * px), size, size);
        if (g.landed && Math.floor(g.life / 480) % 4 === 0) { ctx.fillStyle = '#ffffff'; ctx.fillRect(Math.round(left + w * px - 2), Math.round(top), 2, 2); }   // blinking shine
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = GREEN;
    }

    // Accessories that track his CURRENT mood (not a permanent unlock): shades when
    // he's smitten (+60), a gold crown only when he's right at the top (+96…+100).
    // Drawn on his head for the upright face-poses, like the angry brows.
    function drawGear(cx, feetY, scale, yOff) {
      const tier = T.mood >= 96 ? 2 : T.mood >= 60 ? 1 : 0;
      if (!tier) return;
      const rows = POSES[T.pose] || STAND, px = PIXEL * scale, size = Math.ceil(px);
      const w = spriteW(rows), h = rows.length, left = cx - (w * px) / 2, top = feetY - h * px + yOff;
      const eyeRow = T.pose === 'stretch' ? 5 : 4;
      const seg = (c, r, col) => { ctx.fillStyle = col; ctx.fillRect(Math.round(left + c * px), Math.round(top + r * px), size, size); };
      if (tier === 1) { for (let c = 1; c <= 10; c++) seg(c, eyeRow, '#0e1a2a'); }   // sunglasses bar over the eyes
      else { seg(3, -1, GOLD); seg(5, -1, GOLD); seg(7, -1, GOLD); for (let c = 3; c <= 7; c++) seg(c, 0, GOLD); }  // little crown
    }

    // Weather that tracks his mood: a drizzly gray cloud when he's down, a warm
    // sun + drifting petals when he's smitten with you. (cx, headTop) in canvas px.
    function drawRain(cx, headTop) {
      const cloudY = headTop - 16;
      ctx.fillStyle = '#8a93a0';
      for (const [dx, pw, ph] of [[-11, 9, 6], [0, 12, 7], [10, 9, 6]]) ctx.fillRect(Math.round(cx + dx - pw / 2), Math.round(cloudY - ph / 2), pw, ph);
      ctx.fillStyle = '#7fb6e8';
      for (let i = 0; i < 5; i++) { const rx = cx - 14 + i * 7, phase = (T.weatherT / 300 + i * 0.37) % 1; ctx.fillRect(Math.round(rx), Math.round(cloudY + 6 + phase * 22), 2, 5); }
      ctx.fillStyle = GREEN;
    }
    function drawSun(cx, headTop) {
      const sx = cx + 24, sunY = headTop - 22;
      ctx.fillStyle = '#ffe08a';
      ctx.fillRect(Math.round(sx - 6), Math.round(sunY - 6), 12, 12);
      for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + T.weatherT / 1200; ctx.fillRect(Math.round(sx + Math.cos(a) * 11 - 1), Math.round(sunY + Math.sin(a) * 11 - 1), 2, 2); }
      if (Math.random() < 0.025) T.confetti.push({ x: cx + rand(-30, 30), y: headTop - 28, vx: rand(-12, 12), vy: rand(8, 20), life: rand(1400, 2200), size: 3, color: pick(['#ff9ec4', '#ffd24a', '#9be7b4']) });
      ctx.fillStyle = GREEN;
    }

    // Poses where his face is upright with the eyes at their usual row — the only
    // ones we paint angry brows / a rage cloud onto. (Skip tumbles, balls,
    // pancakes, lying-down and splits, where a forehead overlay would look wrong.)
    const FACE_POSES = new Set(['stand', 'lookL', 'lookR', 'walkA', 'walkB', 'wave', 'jump', 'stretch', 'sit', 'pointUp', 'kick']);

    // Angry eyebrows — two red strokes slanting down toward the bridge of his
    // nose, on his green forehead just above the eyes. Drawn in red so they read
    // even before he's flushed red.
    function drawBrows(cx, feetY, scale, yOff) {
      const rows = POSES[T.pose] || STAND;
      const px = PIXEL * scale, size = Math.ceil(px);
      const w = spriteW(rows), h = rows.length;
      const left = cx - (w * px) / 2, top = feetY - h * px + yOff;
      const eyeRow = T.pose === 'stretch' ? 5 : 4;   // row the eyes sit on in this pose
      const br = eyeRow - 2;                          // brow band: just above them
      const seg = (c, r) => ctx.fillRect(Math.round(left + c * px), Math.round(top + r * px), size, size);
      ctx.fillStyle = RED;
      seg(1, br); seg(2, br); seg(3, br + 1);        // left brow: high outside → low toward the center
      seg(10, br); seg(9, br); seg(8, br + 1);       // right brow (mirrored)
      ctx.fillStyle = T.color;
    }

    // The rage cloud — a churning red storm that hangs over his head when he
    // REALLY can't stand you, bobbing and flashing the odd little bolt.
    function drawFury(cx, headTopY) {
      const t = T.furyT, cloudY = headTopY - 16;
      ctx.fillStyle = RED;
      const puffs = [[-13, 1, 9, 6], [-2, -3, 12, 7], [10, 0, 10, 6], [2, 4, 9, 5]];
      for (const [dx, dy, pw, ph] of puffs) {
        const jx = Math.sin((t + dx * 40) / 130) * 2.5;
        const jy = Math.cos((t + dy * 40) / 160) * 2;
        ctx.fillRect(Math.round(cx + dx + jx - pw / 2), Math.round(cloudY + dy + jy - ph / 2), pw, ph);
      }
      if (Math.floor(t / 140) % 4 === 0) {        // a flickering bolt jabbing down out of the cloud
        ctx.fillStyle = GOLD;
        const bx = cx + Math.sin(t / 90) * 8;
        ctx.fillRect(Math.round(bx), Math.round(cloudY + 5), 2, 4);
        ctx.fillRect(Math.round(bx - 2), Math.round(cloudY + 9), 2, 4);
        ctx.fillRect(Math.round(bx), Math.round(cloudY + 13), 2, 3);
      }
      ctx.fillStyle = T.color;
    }

    function drawEntities(dt) {
      ctx.fillStyle = GREEN;

      drawGifts(dt);            // collectibles on the floor (gifts he leaves / treasure he digs up)

      // food (shift+click): each cut falls from the sky, lands on his floor, and
      // sits waiting to be eaten. Drawn over him so a chomped piece reads in front.
      for (let i = T.meats.length - 1; i >= 0; i--) {
        const m = T.meats[i];
        if (m.gone) { T.meats.splice(i, 1); continue; }
        if (!m.landed) {                                // tumble down under gravity
          m.vy += 1500 * dt / 1000; m.y += m.vy * dt / 1000;
          if (m.y >= groundY()) {                       // touchdown — a puff of dust
            m.y = groundY(); m.vy = 0; m.landed = true;
            for (let j = 0; j < 6; j++) T.confetti.push({
              x: m.x + rand(-8, 8), y: groundY() - 4,
              vx: rand(-70, 70), vy: rand(-70, -10), life: rand(250, 500), size: Math.round(rand(2, 4)), color: '#9a7b50',
            });
          }
        } else {
          m.life += dt;                                 // sat too long uneaten → fades away
          if (m.life > 26000) { m.gone = true; T.meats.splice(i, 1); continue; }  // gone flag lets a mid-approach feast wrap up
        }
        ctx.globalAlpha = m.life > 24000 ? Math.max(0, 1 - (m.life - 24000) / 2000) : 1;
        drawMeat(m);
        ctx.globalAlpha = 1;
      }
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

      // the buddy troll (friend cameo) — a lighter green so you can tell them apart
      if (T.friend && !T.friend.gone) {
        ctx.fillStyle = '#5be0a0';
        blit(POSES[T.friend.pose] || STAND, T.friend.x, groundY(), 1, T.friend.mirror, T.friend.yOff || 0);
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

      // floating hearts (kiss + swoon + giggle + the max-love fountain)
      ctx.fillStyle = HEART;
      for (let i = T.hearts.length - 1; i >= 0; i--) {
        const p = T.hearts[i];
        p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.life -= dt;
        if (p.life <= 0) { T.hearts.splice(i, 1); continue; }
        const sc = (p.sc || 0.5) * (0.7 + 0.3 * (p.life / p.maxLife));
        blit(HEART_GLYPH, p.x, p.y, sc, false);
      }
      // max-love celebration: a big smooth pulsing heart floating over his head
      if (T.action === 'lovefest' && T.mode === 'active') {
        const pulse = 1 + Math.sin(T.t / 160) * 0.14;
        const w = 80 * pulse, h = w * 0.9;
        const bottomY = groundY() + T.yOffset - STAND_H * 1.15;   // the point hovers just above his head
        drawHeart(T.x, bottomY - h, w, HEART);
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
        blit(sprite, D.x, groundY(), 1.35, D.dir < 0, 0);
        if (D.full) ctx.fillRect(Math.round(D.x - 16), Math.round(groundY() - 52), 32, 18); // full belly bulge
      }

      // the policeman (super-furious "report you" cameo) — a blue-uniformed troll
      // cop, drawn over the troll
      if (T.cop) {
        const C = T.cop;
        drawCop(C.writing ? POLICE_WRITE : POLICE, C.x, groundY(), COP_SCALE, C.mirror, C.yOff || 0);
        ctx.fillStyle = GREEN;
      }

      // ( shift+x cameo ) — drawn over him
      if (T.boot && T.boot.shown) {
        ctx.fillStyle = GREEN;
        blit(BOOT, T.x, T.boot.y, 2.6, false, 0);
      }

      // little parachute (drop cameo) — canopy + strings above him as he floats down
      if (T.drop && T.drop.kind === 'dropChute' && !T.drop.landed) {
        const cx = T.x, feetY = groundY() + T.yOffset, headY = feetY - STAND_H;
        const sc = 1.5, canopyBaseY = headY - 4;
        const half = (spriteW(CHUTE) * PIXEL * sc) / 2;
        ctx.strokeStyle = GREEN; ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(cx - half + 4, canopyBaseY); ctx.lineTo(cx - 7, headY + 3);
        ctx.moveTo(cx + half - 4, canopyBaseY); ctx.lineTo(cx + 7, headY + 3);
        ctx.stroke();
        ctx.fillStyle = GREEN;
        blit(CHUTE, cx, canopyBaseY, sc, false, 0);
      }

      // blood splatter (the right-click shot) — sticks on the screen over everything,
      // holds, runs a drip downward, then fades out. Drawn last so it covers all.
      for (let i = T.splats.length - 1; i >= 0; i--) {
        const s = T.splats[i];
        s.life -= dt;
        if (s.life <= 0) { T.splats.splice(i, 1); continue; }
        if (s.hold > 0) s.hold -= dt;
        else if (s.drip < s.dripMax) s.drip = Math.min(s.dripMax, s.drip + s.dripV * dt / 1000);
        ctx.globalAlpha = s.life < s.fade ? Math.max(0, s.life / s.fade) : 1;
        ctx.fillStyle = s.color;
        const z = s.size;
        ctx.fillRect(Math.round(s.x - z / 2), Math.round(s.y - z / 2), Math.ceil(z), Math.ceil(z));
        ctx.fillRect(Math.round(s.x - z * 0.15), Math.round(s.y - z * 0.7), Math.ceil(z * 0.5), Math.ceil(z * 0.5));
        ctx.fillRect(Math.round(s.x + z * 0.1), Math.round(s.y + z * 0.15), Math.ceil(z * 0.45), Math.ceil(z * 0.55));
        if (s.drip > 0) {
          ctx.fillRect(Math.round(s.x - 1.5), Math.round(s.y), 3, Math.round(s.drip));
          ctx.fillRect(Math.round(s.x - 2), Math.round(s.y + s.drip - 2), 4, 4); // the running drop at the tip
        }
      }
      ctx.globalAlpha = 1;

      drawSpeech(dt);            // his little white speech bubble, on top of everything
    }

    // A rounded-rect path (manual, so it works without ctx.roundRect support).
    function roundRectPath(x, y, w, h, r) {
      const rr = Math.min(r, w / 2, h / 2);
      ctx.beginPath();
      ctx.moveTo(x + rr, y);
      ctx.arcTo(x + w, y, x + w, y + h, rr);
      ctx.arcTo(x + w, y + h, x, y + h, rr);
      ctx.arcTo(x, y + h, x, y, rr);
      ctx.arcTo(x, y, x + w, y, rr);
      ctx.closePath();
    }

    // One white bubble: rounded box + a little down-tail, fading by `alpha`,
    // anchored above (cx, headTopY) and clamped on-screen.
    function drawBubble(text, color, alpha, cx, headTopY) {
      ctx.save();
      ctx.font = '600 14px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.textBaseline = 'middle';
      const padX = 10, padY = 6, lineH = 18;
      const lines = text.split('\n');
      let tw = 0;
      for (const ln of lines) tw = Math.max(tw, ctx.measureText(ln).width);
      const bw = Math.ceil(tw) + padX * 2, bh = lines.length * lineH + padY * 2;
      const bx = Math.max(6, Math.min(W() - bw - 6, cx - bw / 2));
      let by = headTopY - 16 - bh;
      if (by < 6) by = 6;
      ctx.globalAlpha = alpha;
      const tailX = Math.max(bx + 12, Math.min(bx + bw - 12, cx));
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.moveTo(tailX - 7, by + bh - 2); ctx.lineTo(tailX + 7, by + bh - 2); ctx.lineTo(tailX, by + bh + 9);
      ctx.closePath(); ctx.fill();
      roundRectPath(bx, by, bw, bh, 8);
      ctx.fillStyle = '#ffffff'; ctx.fill();
      ctx.lineWidth = 2; ctx.strokeStyle = 'rgba(0,0,0,0.16)'; ctx.stroke();
      ctx.fillStyle = color || '#1c1c1c';
      for (let i = 0; i < lines.length; i++) ctx.fillText(lines[i], bx + padX, by + padY + lineH / 2 + i * lineH);
      ctx.restore();
    }
    const bubbleAlpha = (s) => Math.min(1, s.t / 130) * (s.t > s.dur - 220 ? Math.max(0, (s.dur - s.t) / 220) : 1);

    // His bubble (and, during the police scene, the cop's), on top of everything.
    function drawSpeech(dt) {
      const s = T.speech;
      if (s) {
        if (T.mode !== 'active') { T.speech = null; }      // he's gone → drop it
        else { s.t += dt; if (s.t >= s.dur) T.speech = null; else drawBubble(s.text, s.color, bubbleAlpha(s), T.x + T.shakeX, groundY() + T.yOffset - STAND_H * T.scale); }
      }
      const c = T.copSpeech;
      if (c) {
        if (!T.cop) { T.copSpeech = null; }
        else { c.t += dt; if (c.t >= c.dur) T.copSpeech = null; else drawBubble(c.text, c.color, bubbleAlpha(c), T.cop.x, groundY() + (T.cop.yOff || 0) - POLICE.length * PIXEL * COP_SCALE); }
      }
    }

    // Shift+A → a small bottom-right meter showing exactly how he feels about you,
    // from −100 (seething) to +100 (adoring): a number, a word, and a center-out bar.
    function drawScore() {
      const m = Math.round(T.mood);
      const tier = moodTier();
      const label = { loved: 'adores you', liked: 'likes you', neutral: 'neutral', disliked: 'annoyed', hated: 'hates you', furious: 'FURIOUS' }[tier];
      const accent = (tier === 'loved' || tier === 'liked') ? GREEN : tier === 'neutral' ? '#cfcfcf' : RED;
      const boxW = 172, boxH = 60, pad = 12;
      const x = W() - boxW - 14, y = canvas.height - boxH - 14;
      ctx.save();
      roundRectPath(x, y, boxW, boxH, 9);
      ctx.fillStyle = 'rgba(18,18,20,0.86)'; ctx.fill();
      ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(255,255,255,0.16)'; ctx.stroke();
      ctx.textBaseline = 'middle';
      ctx.font = '600 11px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = 'rgba(255,255,255,0.6)';
      ctx.fillText('TROLL MOOD', x + pad, y + 14);
      if (giftCount > 0) { ctx.textAlign = 'right'; ctx.fillStyle = 'rgba(255,210,74,0.85)'; ctx.fillText(`${giftCount} gifts`, x + boxW - pad, y + 14); ctx.textAlign = 'left'; }
      ctx.font = '700 16px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillStyle = accent;
      ctx.fillText(`${m > 0 ? '+' : ''}${m}`, x + pad, y + 33);
      ctx.font = '600 12px ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif';
      ctx.fillText(label, x + pad + 48, y + 33);
      // center-out bar: green to the right of neutral, red to the left
      const barX = x + pad, barY = y + boxH - 13, barW = boxW - pad * 2, barH = 6, mid = barX + barW / 2;
      ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(barX, barY, barW, barH);
      const frac = Math.max(-1, Math.min(1, m / 100)), span = (barW / 2) * frac;
      ctx.fillStyle = accent;
      if (span >= 0) ctx.fillRect(mid, barY, span, barH); else ctx.fillRect(mid + span, barY, -span, barH);
      ctx.fillStyle = 'rgba(255,255,255,0.45)'; ctx.fillRect(mid - 1, barY - 2, 2, barH + 4);
      ctx.restore();
    }

    // ════════════════════════════════════════════════════════════════════════
    // THE MONSTER + the death/bloom scene. Kill the troll OR the cop in front of
    // the cop and, two minutes later, he claws back: strolls in, downs a potion, shakes
    // himself apart, and erupts into a giant horned red beast that stomps around
    // shoving and smashing the floating widgets. Right-click bursts him in a
    // screen-wide splatter — but he just reforms angrier; it takes FIVE shots to
    // finally drop him. When he falls it turns beautiful: his crumpled corpse rots
    // to a skeleton over five minutes while wildflowers bloom and butterflies
    // gather, then the skeleton spends three minutes sinking into the earth and the
    // flowers stay. As it sinks the meadow takes over (growGarden / stepCritters):
    // over ~15 minutes it creeps out to both edges as clustered pockets of forest —
    // grass, bushes, vine-draped trees, rocks, butterfly clouds — with the odd rabbit
    // or deer crossing through. (Debug: Shift+M summons him; Shift+K drops him;
    // Shift+G fast-forwards the garden.)
    // ════════════════════════════════════════════════════════════════════════
    const HITSTUN_MS = 300;           // a shot reels him this long (he flashes + reels, doesn't vanish)
    const MONSTER_HP = 5;
    const DEATH_FALL_MS = 1080;       // his pixels come apart and rain down into the corpse pose
    const DEATH_BODY_SCALE = 1.7;     // the wide sprawled corpse / skeleton
    const DEATH_CORPSE_MS = 300000;   // 5 min: corpse rots to a skeleton, flowers bloom in
    const DEATH_SINK_MS = 180000;     // 3 min: the skeleton sinks under; the flowers remain
    const FLOWER_COLORS = ['#ff6b9d', '#ffd24a', '#b46bff', '#ff8a5c', '#7ad0ff', '#ff5c8a', '#fff1a8'];
    const BFLY_COLORS = ['#ff6b9d', '#ffd24a', '#b46bff', '#7ad0ff', '#ff8a5c', '#9d7bff'];
    // Once the skeleton starts to sink, the wildflowers don't just stay — a whole
    // meadow creeps outward from where he fell and, over a quarter of an hour, fills
    // the screen edge to edge with clustered pockets of forest: grass, more flowers,
    // bushes, rocks, vine-draped trees, drifting clouds of butterflies, and the odd
    // rabbit or deer ambling across. (See growGarden / stepCritters / drawDeath.)
    const GARDEN_SPREAD_MS = 900000;  // 15 min: the green tide reaches both edges
    const GRASS_GREENS = ['#2faa5e', '#39b86a', '#268f4f', '#46c277', '#1f8a48'];
    const BUSH_GREENS = ['#2c9b54', '#247f46', '#34a862', '#1d723e'];
    const TREE_GREENS = ['#2f9d57', '#268a4b', '#3aa866', '#1f7a42', '#43b56f'];
    const TREE_DARKS = ['#1c6e3c', '#175e33', '#21794a', '#155a30'];   // canopy shadow side
    const TREE_LITES = ['#5ccb86', '#6fd897', '#4fc07c', '#7ee0a4'];   // sun-struck highlight
    const PINE_GREENS = ['#1f7a46', '#176237', '#268a4f', '#14653a'];  // cooler evergreen needles
    const PINE_DARKS = ['#114e2c', '#0d4426', '#155a33'];
    const VINE_GREENS = ['#2faa5e', '#3aa866', '#268a4b'];
    const TRUNK_BROWNS = ['#6b4a2a', '#5a3d22', '#7a5733'];
    const TRUNK_DARKS = ['#4a3119', '#3d2814', '#553c20'];
    const BLOSSOM_COLORS = ['#ffd1e6', '#ffe6a8', '#ffc9b0', '#f6d6ff'];
    const ROCK_GREYS = ['#9a9aa2', '#80808a', '#b0b0b8', '#6c6c76'];
    const BERRY_COLORS = ['#ff5c8a', '#ff8a5c', '#b46bff', '#7ad0ff', '#ffd24a'];
    const MOUNT_COLORS = ['#7b8a9c', '#6e7d90', '#8895a6', '#74839a'];
    const MOUNT_SHADES = ['#5d6b7d', '#566375', '#637084'];
    const SNOW_WHITE = '#f4f7fb';
    const shovedEls = new Set();      // widgets he's shoved out of place (reset on unmount)

    // Persistently nudge a widget across the screen (accumulating), with a little
    // tilt — clamped so it never flies fully off. Uses the independent translate /
    // rotate props (like bumpWidget) so it doesn't stomp the panel's own transform.
    function shoveWidget(el, dx, dy) {
      if (!el) return;
      const maxX = window.innerWidth * 0.6, maxY = window.innerHeight * 0.45;
      const sx = Math.max(-maxX, Math.min(maxX, (el.__trollShoveX || 0) + dx));
      const sy = Math.max(-maxY, Math.min(maxY, (el.__trollShoveY || 0) + dy));
      el.__trollShoveX = sx; el.__trollShoveY = sy;
      const rot = Math.max(-14, Math.min(14, sx * 0.04));
      try { el.style.translate = `${Math.round(sx)}px ${Math.round(sy)}px`; el.style.rotate = `${rot.toFixed(1)}deg`; } catch { /* gone */ }
      shovedEls.add(el);
    }

    // Send every shoved widget back to its home spot — eases it in (animating from
    // where it sits now to zero) and clears the inline nudge so it's exactly as it
    // was. Called when the monster dies and again on unmount.
    function restoreWidgets() {
      shovedEls.forEach((el) => {
        const sx = el.__trollShoveX || 0, sy = el.__trollShoveY || 0;
        const rot = Math.max(-14, Math.min(14, sx * 0.04));
        try {
          el.style.translate = ''; el.style.rotate = '';           // home position
          if ((sx || sy) && typeof el.animate === 'function') {    // ease back from where he left it
            el.animate(
              [
                { translate: `${Math.round(sx)}px ${Math.round(sy)}px`, rotate: `${rot.toFixed(1)}deg` },
                { translate: '0px 0px', rotate: '0deg' },
              ],
              { duration: 600, easing: 'cubic-bezier(.22,1,.36,1)' },
            );
          }
        } catch { /* gone */ }
        el.__trollShoveX = 0; el.__trollShoveY = 0;
      });
      shovedEls.clear();
    }

    // Any widget he walks into while rampaging gets shoved + showered in debris.
    // (Obstacle rects are re-snapshotted a few times a second, not every frame.)
    function smashWidgets(m, dt) {
      m._obsT = (m._obsT || 0) + dt;
      if (!m._obs || m._obsT > 150) { m._obs = readObstacles(); m._obsT = 0; }
      const obs = m._obs; if (!obs.length) return;
      const px = PIXEL * m.scale;
      const bw = spriteW(MONSTER) * px * 0.6, bh = MONSTER.length * px;
      const bx0 = m.x - bw / 2, bx1 = m.x + bw / 2, feetY = groundY();
      const by0 = feetY - bh, by1 = feetY, now = performance.now();
      for (const r of obs) {
        if (Math.min(bx1, r.right) - Math.max(bx0, r.left) <= 0) continue;
        if (Math.min(by1, r.bottom) - Math.max(by0, r.top) <= 0) continue;
        if (r.el.__trollSmashT && now - r.el.__trollSmashT < 260) continue;
        r.el.__trollSmashT = now;
        shoveWidget(r.el, m.dir * rand(28, 64), -rand(0, 26));
        m.smashPulse = 1;
        const dcx = (Math.max(bx0, r.left) + Math.min(bx1, r.right)) / 2;
        for (let i = 0; i < 10; i++) {
          const ang = rand(-Math.PI, 0), sp = rand(120, 360);
          T.confetti.push({ x: dcx, y: r.top, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: rand(400, 900), size: Math.round(rand(2, 6)), color: Math.random() < 0.5 ? '#c2241f' : '#9a9a9a' });
        }
      }
    }

    function spawnMonsterBurst(cx, cy) {
      for (let i = 0; i < 50; i++) {
        const ang = rand(-Math.PI, Math.PI), sp = rand(120, 520);
        T.confetti.push({ x: cx, y: cy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 60, life: rand(600, 1300), size: Math.round(rand(3, 9)), color: Math.random() < 0.5 ? '#c2241f' : '#2b2b33' });
      }
    }

    // Bring him back as the monster: enters → drinks the potion → transforms → rampages.
    function startMonster() {
      const dir = Math.random() < 0.5 ? 1 : -1;
      T.monster = {
        phase: 'arrive', t: 0, dir, mirror: dir < 0, x: dir === 1 ? -off : W() + off,
        scale: 1, legT: 0, legFlip: false, shakeX: 0, yOff: 0,
        trollPose: 'stand', flush: 0, potionT: 0, target: W() / 2 + rand(-W() * 0.1, W() * 0.1),
        hp: MONSTER_HP, spd: 240, smashPulse: 0, roarT: 1500, exploding: 0, hitFlash: 0, kb: 0, speech: null,
      };
    }

    function stepMonster(dt) {
      const m = T.monster; m.t += dt;
      if (m.speech) { m.speech.t += dt; if (m.speech.t >= m.speech.dur) m.speech = null; }

      if (m.phase === 'arrive') {                         // strolls back in (still a plain green troll)
        m.mirror = m.dir < 0;
        const reached = m.dir === 1 ? m.x >= m.target : m.x <= m.target;
        if (!reached) {
          m.x += m.dir * 150 * dt / 1000;
          m.legT += dt; if (m.legT > 120) { m.legT = 0; m.legFlip = !m.legFlip; }
          m.trollPose = m.legFlip ? 'walkB' : 'walkA';
        } else { m.trollPose = 'stand'; if (m.t > 1400) { m.phase = 'potion'; m.t = 0; m.potionT = 0; } }
        return;
      }
      if (m.phase === 'potion') {                         // raises a potion and glugs it
        m.trollPose = 'stand'; m.mirror = false;
        m.potionT = Math.min(1, m.t / 700);
        if (m.t > 900) m.shakeX = rand(-2, 2);
        if (m.t >= 2100) { m.phase = 'transform'; m.t = 0; }
        return;
      }
      if (m.phase === 'transform') {                      // shakes harder and harder, flushes red, swells up
        const k = Math.min(1, m.t / 1900);
        m.flush = k;
        m.shakeX = rand(-1, 1) * (4 + k * 18);
        m.scale = 1 + k * (MONSTER_SCALE - 1);
        m._smokeT = (m._smokeT || 0) + dt;
        if (m._smokeT > 70) {
          m._smokeT = 0;
          T.confetti.push({ x: m.x + rand(-22, 22), y: groundY() - rand(20, 130), vx: rand(-60, 60), vy: rand(-150, -40), life: rand(500, 1100), size: Math.round(rand(3, 7)), color: Math.random() < 0.5 ? '#7a1f1f' : '#2b2b33' });
        }
        if (m.t >= 1900) {                                // ...POP. The beast is out.
          m.phase = 'rampage'; m.t = 0; m.scale = MONSTER_SCALE;
          m.target = rand(off, W() - off); m.dir = m.target > m.x ? 1 : -1; m.roarT = 300;
          spawnMonsterBurst(m.x, groundY() - MONSTER.length * PIXEL * MONSTER_SCALE * 0.5);
          m.speech = { text: 'RRRAAAGH', color: '#ff4d4d', t: 0, dur: 1600 };
        }
        return;
      }
      // ── rampage ──
      if (m.exploding > 0) {                              // hit-stun: he reels and is knocked back, but stays up
        m.exploding -= dt;
        m.hitFlash = Math.max(0, m.hitFlash - dt / 200);
        m.shakeX = rand(-9, 9);
        if (m.kb) { m.x += m.kb * dt / 1000; m.kb *= Math.pow(0.86, dt / 16); if (Math.abs(m.kb) < 12) m.kb = 0; }
        m.x = Math.max(off * 0.4, Math.min(W() - off * 0.4, m.x));
        if (m.exploding <= 0) { m.exploding = 0; m.spd = Math.min(560, m.spd * 1.1); }  // shakes it off — faster, angrier
        return;
      }
      if (m.hitFlash > 0) m.hitFlash = Math.max(0, m.hitFlash - dt / 200);
      m.scale = MONSTER_SCALE + (m.smashPulse > 0 ? m.smashPulse * 0.18 : 0);
      if (m.smashPulse > 0) m.smashPulse = Math.max(0, m.smashPulse - dt / 180);
      const reached = m.dir === 1 ? m.x >= m.target : m.x <= m.target;
      if (reached) { m.target = rand(off, W() - off); m.dir = m.target > m.x ? 1 : -1; }
      m.mirror = m.dir < 0;
      m.x += m.dir * m.spd * dt / 1000;
      m.legT += dt; if (m.legT > 140) { m.legT = 0; m.legFlip = !m.legFlip; m.shakeX = rand(-4, 4); }  // ground-shaking stomp
      smashWidgets(m, dt);
      m.roarT -= dt;
      if (m.roarT <= 0) { m.roarT = rand(2600, 5200); if (!m.speech) m.speech = { text: pick(['RRRAAAGH', 'GRAAAH!', '*SMASH*', 'MINE NOW']), color: '#ff4d4d', t: 0, dur: 1500 }; }
    }

    // A right-click hit while he rampages. Blood flies, he flashes white, reels,
    // and is knocked back — but he does NOT vanish; he just wears the damage and
    // keeps coming. Five hits and he finally drops.
    function explodeMonster(clientX, clientY) {
      const m = T.monster; if (!m) return;
      const canvasTop = window.innerHeight - canvas.height;
      const gx = clientX, gy = clientY - canvasTop;
      spawnSplats(gx, gy, '#c2241f');                     // a wound-spray of gore at the hit
      for (let i = 0; i < 44; i++) {
        const ang = rand(-Math.PI, Math.PI), sp = rand(90, 520);
        T.confetti.push({ x: gx, y: gy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 80, life: rand(500, 1300), size: Math.round(rand(2, 8)), color: Math.random() < 0.35 ? '#2b2b33' : '#c2241f' });
      }
      m.hp -= 1;
      if (m.hp <= 0) { killMonster(m.x, gy); return; }
      m.hitFlash = 1; m.exploding = HITSTUN_MS;           // flash + reel (stays on his feet)
      m.kb = (gx <= m.x ? 1 : -1) * 240;                  // knocked away from the shot
      m.speech = { text: pick(['RRAAGH!', 'is that ALL?', "can't kill me", 'AGAIN. again.']), color: '#ff4d4d', t: 0, dur: 1400 };
    }

    // The lethal (fifth) hit: he reels, then CRUMPLES — the standing beast comes apart
    // into its own pixels, which tumble and rain down, each settling EXACTLY onto its
    // spot in the corpse pose. He collapses in place (no sideways topple), so the rot,
    // flowers and butterflies all centre on him.
    function killMonster(cx, cy) {
      const m = T.monster;
      restoreWidgets();                                  // he's down → the widgets he shoved ease back home
      spawnSplats(cx, cy, '#c2241f');                    // the fatal shot
      const scale = (m && m.scale) || MONSTER_SCALE;
      const fallSign = m ? (m.dir >= 0 ? 1 : -1) : 1;     // which way the slumped heap faces
      const corpseHalf = spriteW(MONSTER_CORPSE) * PIXEL * DEATH_BODY_SCALE / 2;
      const margin = corpseHalf + 14;
      const landX = Math.max(margin, Math.min(W() - margin, (m && m.x) || cx));  // crumples in place
      const dir = -fallSign, mirror = m ? m.mirror : false;
      // build the pixel crumple: standing pixels → corpse pixels (driven by the corpse
      // set, so the last frame is the corpse exactly). Top pixels let go a touch later
      // and fall further; each tumbles down with a little gravity arc + sideways jitter.
      const src = spriteCells(MONSTER, MONSTER_COLORS, landX, groundY(), scale, mirror);
      const tgt = spriteCells(MONSTER_CORPSE, MONSTER_COLORS, landX, groundY(), DEATH_BODY_SCALE, dir < 0);
      const bodyH = MONSTER.length * PIXEL * scale;
      const crumble = tgt.map((t, i) => {
        const s = src[(i * 7919) % src.length];           // spread the mapping around the body
        const high = Math.max(0, Math.min(1, (groundY() - s.y) / bodyH));   // 0 at feet … 1 at the horns
        return {
          x0: s.x, y0: s.y, tx: t.x, ty: t.y, color: t.color, px: t.px,
          delay: high * 240 + rand(0, 160),              // higher bits hold on, then drop
          dur: rand(420, 620), pop: rand(8, 40) * high,  // a small upward kick before gravity wins
          jit: rand(-1, 1),
        };
      });
      T.death = {
        phase: 'fall', t: 0, x: landX, standX: landX, scale, fallSign, crumble,
        uprightMirror: mirror, dir,                       // corpse keeps his facing
        landed: false, decomp: 0, sink: 0, flowers: [], butterflies: [], motes: [],
        flowerT: 0, flutterT: 0, moteT: 0,
        // the long meadow→forest spread (kicks in once the skeleton starts sinking)
        gardenOn: false, gardenT: 0, patchT: 0, critterT: 0, pockets: [],
        grass: [], bushes: [], trees: [], vines: [], rocks: [], critters: [], mountains: [],
      };
      T.monster = null;
    }

    function hitMonster(e) {
      const m = T.monster; if (!m) return false;
      const px = PIXEL * m.scale;
      const w = spriteW(MONSTER) * px, h = MONSTER.length * px;
      const canvasTop = window.innerHeight - canvas.height, cx = m.x + (m.shakeX || 0);
      return e.clientX >= cx - w / 2 - 10 && e.clientX <= cx + w / 2 + 10
        && e.clientY >= canvasTop + (groundY() - h + (m.yOff || 0)) - 10
        && e.clientY <= canvasTop + groundY() + 10;
    }

    // A char-keyed blitter (like drawCop) but taking any colour map — used for the
    // monster, his potion, the corpse, and the skeleton.
    function blitKeyed(rows, colors, cx, feetY, scale, mirror, yOff = 0) {
      const w = spriteW(rows), h = rows.length, px = PIXEL * scale, size = Math.ceil(px);
      const left = cx - (w * px) / 2, top = feetY - h * px + yOff;
      for (let r = 0; r < h; r++) {
        const row = rows[r];
        for (let c = 0; c < row.length; c++) {
          const ch = row[c];
          if (ch === '.' || ch === ' ') continue;
          const cc = mirror ? (w - 1 - c) : c;
          ctx.fillStyle = colors[ch] || GREEN;
          ctx.fillRect(Math.round(left + cc * px), Math.round(top + r * px), size, size);
        }
      }
    }

    // Every painted cell of a char-keyed sprite as a flat list of {x, y, color, px}
    // in canvas coords — same placement maths as blitKeyed. Used to build the death
    // crumple: the standing beast's pixels are the start points, the corpse sprite's
    // pixels the targets, so the scatter lands EXACTLY in his death pose.
    function spriteCells(rows, colors, cx, feetY, scale, mirror) {
      const w = spriteW(rows), h = rows.length, px = PIXEL * scale, left = cx - (w * px) / 2, top = feetY - h * px;
      const out = [];
      for (let r = 0; r < h; r++) {
        const row = rows[r];
        for (let c = 0; c < row.length; c++) {
          const ch = row[c];
          if (ch === '.' || ch === ' ') continue;
          const cc = mirror ? (w - 1 - c) : c;
          out.push({ x: left + cc * px, y: top + r * px, color: colors[ch] || GREEN, px });
        }
      }
      return out;
    }

    function drawPotion(m) {
      const headY = groundY() - STAND_H;
      blitKeyed(POTION, POTION_COLORS, m.x + 16 - m.potionT * 12, headY + 12 - m.potionT * 4, 1.2, false, 0);
    }
    // Like blit, but fills EVERY non-empty cell with the current fillStyle (used to
    // paint a one-colour overlay of a char-keyed sprite — the damage bruise + the
    // white hit-flash that ride on top of the monster's normal colours).
    function blitMask(rows, cx, feetY, scale, mirror, yOff = 0) {
      const w = spriteW(rows), h = rows.length, px = PIXEL * scale, size = Math.ceil(px);
      const left = cx - (w * px) / 2, top = feetY - h * px + yOff;
      for (let r = 0; r < h; r++) {
        const row = rows[r];
        for (let c = 0; c < row.length; c++) {
          if (row[c] === '.' || row[c] === ' ') continue;
          const cc = mirror ? (w - 1 - c) : c;
          ctx.fillRect(Math.round(left + cc * px), Math.round(top + r * px), size, size);
        }
      }
    }
    function drawMonsterBody(m) {
      const rows = m.phase === 'rampage' ? (m.legFlip ? MONSTER_WALK_B : MONSTER_WALK_A) : MONSTER;
      const cx = m.x + m.shakeX, fy = groundY(), yo = m.yOff || 0;
      blitKeyed(rows, MONSTER_COLORS, cx, fy, m.scale, m.mirror, yo);
      const dmg = m.hp != null ? (MONSTER_HP - m.hp) / MONSTER_HP : 0;
      if (dmg > 0) {                                       // darkens / bruises as the hits pile up
        ctx.globalAlpha = dmg * 0.5; ctx.fillStyle = '#3d0808';
        blitMask(rows, cx, fy, m.scale, m.mirror, yo); ctx.globalAlpha = 1;
      }
      if (m.hitFlash > 0) {                                // the white pop the instant he's shot
        ctx.globalAlpha = Math.min(1, m.hitFlash); ctx.fillStyle = '#ffffff';
        blitMask(rows, cx, fy, m.scale, m.mirror, yo); ctx.globalAlpha = 1;
      }
    }
    function drawMonster() {
      const m = T.monster; if (!m) return;
      if (m.phase === 'arrive' || m.phase === 'potion') {
        ctx.fillStyle = GREEN; ctx.globalAlpha = 1;
        blit(POSES[m.trollPose] || STAND, m.x + m.shakeX, groundY(), 1, m.mirror, 0);
        ctx.globalAlpha = 1;
        if (m.phase === 'potion') drawPotion(m);
      } else if (m.phase === 'transform') {
        if ((m.flush || 0) < 0.7) {                       // troll flushing red + swelling...
          ctx.fillStyle = mix((m.flush || 0) / 0.7); ctx.globalAlpha = 1;
          blit(STAND, m.x + m.shakeX, groundY(), m.scale, false, 0);
          ctx.globalAlpha = 1;
        } else { drawMonsterBody(m); }                    // ...then it's the beast
      } else { drawMonsterBody(m); }                      // rampage (incl. hit-stun) — always visible now
      if (m.speech) {
        const headTop = (m.phase === 'arrive' || m.phase === 'potion')
          ? groundY() - STAND_H
          : groundY() - MONSTER.length * PIXEL * m.scale + (m.yOff || 0);
        drawBubble(m.speech.text, m.speech.color, 1, m.x + m.shakeX, headTop);
      }
    }

    // ── the death / bloom scene ──────────────────────────────────────────────
    function addFlower(D, x) {
      const fx = x != null ? x : D.x + rand(-130, 130);
      D.flowers.push({
        x: Math.max(6, Math.min(W() - 6, fx)), h: rand(22, 62), grow: 0, t: 0,
        color: pick(FLOWER_COLORS), petals: Math.floor(rand(5, 7)), spin: rand(0, Math.PI), phase: rand(0, Math.PI * 2),
      });
    }
    function addButterfly(D, x) {
      const cx = x != null ? x : D.x;
      const baseY = groundY() - rand(60, 190);
      D.butterflies.push({ x: cx + rand(-30, 30), cx, y: baseY, baseY, t: rand(0, 1000), vx: rand(-30, 30), range: x != null ? rand(40, 110) : rand(50, 150), driftPhase: rand(0, Math.PI * 2), color: pick(BFLY_COLORS), color2: pick(BFLY_COLORS) });
    }

    // ── the meadow→forest spread ───────────────────────────────────────────────
    // Each piece grows from nothing (grow 0→1 at its own rate) so the forest visibly
    // springs up rather than popping in. They cluster into "pockets" that creep
    // outward from where he fell until, ~15 min on, they reach both screen edges.
    function addGrass(D, x) {
      const blades = [];
      const n = Math.floor(rand(4, 9));
      for (let i = 0; i < n; i++) blades.push({ dx: rand(-8, 8), h: rand(7, 19), lean: rand(-3, 3), shade: pick(GRASS_GREENS) });
      D.grass.push({ x, grow: 0, rate: 1 / rand(1400, 2800), t: rand(0, 1000), blades });
    }
    function addBush(D, x) {
      D.bushes.push({
        x, grow: 0, rate: 1 / rand(7000, 14000), t: rand(0, 1000), r: rand(13, 24),
        color: pick(BUSH_GREENS), color2: pick(BUSH_GREENS),
        berries: Math.random() < 0.5 ? Math.floor(rand(2, 6)) : 0, berryColor: pick(BERRY_COLORS), seed: Math.floor(rand(0, 360)),
      });
    }
    function addTree(D, x) {
      const pine = Math.random() < 0.32;                   // a few are evergreens
      const tall = pine ? rand(120, 215) : rand(95, 185);
      D.trees.push({
        kind: pine ? 'pine' : 'leafy', x, grow: 0, rate: 1 / rand(22000, 46000), t: rand(0, 1000),
        h: tall, w: pine ? rand(34, 50) : rand(36, 58),
        trunk: pick(TRUNK_BROWNS), trunkDark: pick(TRUNK_DARKS),
        canopy: pick(pine ? PINE_GREENS : TREE_GREENS), canopy2: pick(pine ? PINE_GREENS : TREE_GREENS),
        canopyDark: pick(pine ? PINE_DARKS : TREE_DARKS), canopyLite: pick(TREE_LITES),
        blossom: !pine && Math.random() < 0.4 ? pick(BLOSSOM_COLORS) : null,
        // evergreens slowly gather a snow dusting on their tiers (some of them)
        snow: 0, snowRate: pine && Math.random() < 0.55 ? 1 / rand(360000, 600000) : 0, seed: Math.floor(rand(0, 999)),
      });
      if (!pine && Math.random() < 0.55) addVine(D, x + rand(-16, 16), tall);   // a vine trailing from a leafy tree
    }
    function addMountain(D) {
      const h = rand(120, 215);                            // about as tall as the trees — no monoliths
      const w = h * rand(1.3, 2.0);
      const n = Math.floor(rand(4, 8));                    // a jagged ridge of several peaks
      const ridge = [];
      for (let i = 0; i <= n; i++) ridge.push(rand(0.45, 0.92));
      ridge[Math.floor(rand(1, n))] = 1;                   // one dominant summit
      ridge[0] = rand(0.12, 0.3); ridge[n] = rand(0.12, 0.3);  // taper down to the foothills at the edges
      D.mountains.push({
        x: rand(W() * 0.08, W() * 0.92), grow: 0, rate: 1 / rand(150000, 280000),   // rises very slowly (~2.5–4.5 min)
        snow: 0, snowRate: 1 / rand(360000, 660000),                                 // snow creeps in slower still
        h, w, ridge, base: pick(MOUNT_COLORS), shade: pick(MOUNT_SHADES),
      });
    }
    function addVine(D, x, fromH) {
      D.vines.push({ x, grow: 0, rate: 1 / rand(9000, 18000), t: rand(0, 1000), len: rand(40, Math.max(54, fromH * 0.7)), top: fromH * rand(0.5, 0.82), sway: rand(0, Math.PI * 2), color: pick(VINE_GREENS), leaves: Math.floor(rand(3, 7)) });
    }
    function addRock(D, x) {
      D.rocks.push({ x, grow: 0, rate: 1 / rand(900, 2000), t: 0, w: rand(11, 27), h: rand(7, 16), color: pick(ROCK_GREYS), color2: pick(ROCK_GREYS) });
    }

    // One growth tick: expand the reach a little, then either open a fresh pocket out
    // toward the frontier or thicken an existing one with the next piece of foliage.
    function growGarden(D, dt) {
      D.gardenT = Math.min(GARDEN_SPREAD_MS, D.gardenT + dt);
      const prog = D.gardenT / GARDEN_SPREAD_MS;
      const reach = 80 + prog * (W() * 0.95);                 // creeps out to cover the whole width
      const dens = Math.max(0.6, Math.min(2.2, W() / 1366));  // bigger screens → a richer forest
      const CAP = { grass: Math.round(72 * dens), flower: Math.round(96 * dens), bush: Math.round(26 * dens), rock: Math.round(20 * dens), tree: Math.round(13 * dens), bfly: Math.round(22 * dens) };
      // a few small jagged peaks rise far off in the back, staggered across the spread
      const wantMtn = prog > 0.7 ? 4 : prog > 0.5 ? 3 : prog > 0.32 ? 2 : prog > 0.2 ? 1 : 0;
      if (D.mountains.length < wantMtn && Math.random() < 0.5) addMountain(D);
      D.patchT += dt;
      if (D.patchT < rand(1500, 2700)) return;                // spaced out so it eases in over the 15 min
      D.patchT = 0;

      let pk;                                                 // open a new pocket at the frontier, or thicken one
      if (!D.pockets.length || Math.random() < 0.34) {
        const side = Math.random() < 0.5 ? -1 : 1;
        const px = Math.max(20, Math.min(W() - 20, D.x + side * rand(reach * 0.4, reach)));
        pk = { x: px, n: 0 }; D.pockets.push(pk);
      } else { pk = pick(D.pockets); }
      const x = Math.max(8, Math.min(W() - 8, pk.x + rand(-60, 60)));
      pk.n++;

      const roll = Math.random();
      if (roll < 0.30 && D.grass.length < CAP.grass) addGrass(D, x);
      else if (roll < 0.58 && D.flowers.length < CAP.flower) addFlower(D, x);
      else if (roll < 0.72 && D.bushes.length < CAP.bush) addBush(D, x);
      else if (roll < 0.82 && D.rocks.length < CAP.rock) addRock(D, x);
      else if (roll < 0.90 && D.trees.length < CAP.tree) addTree(D, x);
      else { const k = Math.floor(rand(2, 5)); for (let i = 0; i < k && D.butterflies.length < CAP.bfly; i++) addButterfly(D, x); }  // a pocket of butterflies
      if (pk.n <= 2 && D.grass.length < CAP.grass) addGrass(D, x + rand(-22, 22));   // never leave a pocket on bare dirt
    }

    // The occasional rabbit (hopping) or deer (trotting) that crosses the meadow.
    function spawnCritter(D) {
      const kind = Math.random() < 0.62 ? 'rabbit' : 'deer';
      const dir = Math.random() < 0.5 ? 1 : -1;
      const x = dir === 1 ? -70 : W() + 70;
      if (kind === 'rabbit') D.critters.push({ kind, x, dir, speed: rand(150, 215), hopT: rand(0, 760), yOff: 0, t: 0, airborne: false });
      else D.critters.push({ kind, x, dir, speed: rand(90, 145), legT: 0, legFlip: false, t: 0 });
    }
    function stepCritters(D, dt) {
      D.critterT -= dt;
      if (D.critterT <= 0 && D.critters.length < 2 && D.gardenT > 30000) { D.critterT = rand(45000, 100000); spawnCritter(D); }
      for (let i = D.critters.length - 1; i >= 0; i--) {
        const c = D.critters[i]; c.t += dt;
        if (c.kind === 'rabbit') {
          const period = 760; c.hopT += dt; if (c.hopT >= period) c.hopT -= period;
          const ph = c.hopT / period;
          c.yOff = -Math.sin(Math.PI * ph) * 26;             // up over the top of each hop
          c.airborne = c.yOff < -3;
          c.x += c.dir * c.speed * dt / 1000 * (0.35 + Math.sin(Math.PI * ph) * 0.95);  // springs forward mid-leap
        } else {
          c.x += c.dir * c.speed * dt / 1000;
          c.legT += dt; if (c.legT > 165) { c.legT = 0; c.legFlip = !c.legFlip; }
        }
        if ((c.dir > 0 && c.x > W() + 90) || (c.dir < 0 && c.x < -90)) D.critters.splice(i, 1);
      }
    }
    function addMote(D) {
      D.motes.push({ x: D.x + rand(-220, 220), y: groundY() - rand(0, 24), vx: rand(-10, 10), vy: -rand(8, 28), life: rand(3200, 6200), size: Math.round(rand(1, 3)), color: pick(['#fff6c8', '#ffe14d', '#bfe9d6', '#ffd9ec']) });
    }

    function stepDeath(dt) {
      const D = T.death; D.t += dt;
      for (const f of D.flowers) { f.t += dt; if (f.grow < 1) f.grow = Math.min(1, f.grow + dt / 4200); }
      for (const b of D.butterflies) {
        const home = b.cx != null ? b.cx : D.x;
        b.t += dt; b.x += b.vx * dt / 1000;
        if (b.x < home - b.range) b.vx = Math.abs(b.vx);
        else if (b.x > home + b.range) b.vx = -Math.abs(b.vx);
        if (Math.random() < 0.01) b.vx = rand(-34, 34);
        b.y = b.baseY + Math.sin(b.t / 700 + b.driftPhase) * 16;
      }
      for (let i = D.motes.length - 1; i >= 0; i--) {
        const p = D.motes[i]; p.x += p.vx * dt / 1000; p.y += p.vy * dt / 1000; p.life -= dt;
        if (p.life <= 0) D.motes.splice(i, 1);
      }
      D.moteT += dt; if (D.moteT > 520 && D.motes.length < 44) { D.moteT = 0; addMote(D); }

      // once the spread has begun, keep growing the meadow and crossing the critters,
      // and ease every fresh sprout up from nothing.
      if (D.gardenOn) {
        growGarden(D, dt);
        stepCritters(D, dt);
        for (const g of D.grass) { g.t += dt; if (g.grow < 1) g.grow = Math.min(1, g.grow + g.rate * dt); }
        for (const b of D.bushes) { b.t += dt; if (b.grow < 1) b.grow = Math.min(1, b.grow + b.rate * dt); }
        for (const tr of D.trees) { tr.t += dt; if (tr.grow < 1) tr.grow = Math.min(1, tr.grow + tr.rate * dt); if (tr.snowRate && tr.snow < 1) tr.snow = Math.min(1, tr.snow + tr.snowRate * dt); }
        for (const v of D.vines) { v.t += dt; if (v.grow < 1) v.grow = Math.min(1, v.grow + v.rate * dt); }
        for (const rk of D.rocks) { if (rk.grow < 1) rk.grow = Math.min(1, rk.grow + rk.rate * dt); }
        for (const mt of D.mountains) { if (mt.grow < 1) mt.grow = Math.min(1, mt.grow + mt.rate * dt); if (mt.snow < 1) mt.snow = Math.min(1, mt.snow + mt.snowRate * dt); }
      }

      if (D.phase === 'fall') {                            // pixels rain down, hit the ground, settle into the corpse
        if (!D.landed && D.t >= DEATH_FALL_MS * 0.72) {    // the THUD — dust + a last spray of gore as they pile up
          D.landed = true;
          for (let i = 0; i < 22; i++) {
            const ang = rand(-Math.PI, 0), sp = rand(80, 300);
            T.confetti.push({ x: D.x + rand(-50, 50), y: groundY() - 4, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp, life: rand(300, 750), size: Math.round(rand(2, 6)), color: Math.random() < 0.45 ? '#c2241f' : '#8a7a5a' });
          }
        }
        if (D.t >= DEATH_FALL_MS) { D.phase = 'corpse'; D.t = 0; }
        return;
      }
      if (D.phase === 'corpse') {                          // 5 min: rot to a skeleton; flowers + butterflies move in
        D.decomp = Math.min(1, D.t / DEATH_CORPSE_MS);
        if (D.decomp > 0.28) { D.flowerT += dt; if (D.flowerT > 2600 && D.flowers.length < 20) { D.flowerT = 0; addFlower(D); } }
        if (D.decomp > 0.5) { D.flutterT += dt; if (D.flutterT > 4200 && D.butterflies.length < 8) { D.flutterT = 0; addButterfly(D); } }
        if (D.t >= DEATH_CORPSE_MS) { D.phase = 'sink'; D.t = 0; D.gardenOn = true; D.critterT = rand(22000, 48000); }
      } else if (D.phase === 'sink') {                     // 3 min: the skeleton sinks under; the meadow spreads out
        D.sink = Math.min(1, D.t / DEATH_SINK_MS);
        if (D.t >= DEATH_SINK_MS) { D.phase = 'rest'; D.t = 0; }
      }
    }

    function drawFlower(f) {
      const baseY = groundY(), sway = Math.sin(f.t / 600 + f.phase) * 2 * f.grow;
      const bx = f.x + sway, topY = baseY - f.h * f.grow, stemH = f.h * f.grow;
      ctx.fillStyle = '#2faa5e';
      ctx.fillRect(Math.round(bx - 1), Math.round(topY), 2, Math.round(baseY - topY));
      if (f.grow > 0.5) {                                  // a couple of leaves on the stem
        ctx.fillRect(Math.round(bx - 5), Math.round(baseY - stemH * 0.55), 5, 2);
        ctx.fillRect(Math.round(bx + 1), Math.round(baseY - stemH * 0.4), 5, 2);
      }
      const s = 3 * f.grow;
      ctx.fillStyle = f.color;
      for (let i = 0; i < f.petals; i++) {                 // a ring of petals...
        const a = (i / f.petals) * Math.PI * 2 + f.spin;
        ctx.fillRect(Math.round(bx + Math.cos(a) * s * 1.4 - s / 2), Math.round(topY + Math.sin(a) * s * 1.4 - s / 2), Math.ceil(s), Math.ceil(s));
      }
      ctx.fillStyle = '#ffe14d';                           // ...around a golden centre
      ctx.fillRect(Math.round(bx - s / 2), Math.round(topY - s / 2), Math.ceil(s), Math.ceil(s));
    }
    function drawButterfly(b) {
      const flap = Math.abs(Math.sin(b.t / 90)), wx = 2 + flap * 4;
      ctx.fillStyle = '#2a2a2a';
      ctx.fillRect(Math.round(b.x - 1), Math.round(b.y - 3), 2, 7);
      ctx.fillStyle = b.color;
      ctx.fillRect(Math.round(b.x - 1 - wx), Math.round(b.y - 3), Math.round(wx), 4);
      ctx.fillRect(Math.round(b.x + 1), Math.round(b.y - 3), Math.round(wx), 4);
      ctx.fillStyle = b.color2;
      ctx.fillRect(Math.round(b.x - 1 - wx * 0.8), Math.round(b.y + 1), Math.round(wx * 0.8), 3);
      ctx.fillRect(Math.round(b.x + 1), Math.round(b.y + 1), Math.round(wx * 0.8), 3);
    }

    // ── garden flora (blocky, to sit beside the pixel flowers) ──────────────────
    // A chunky pixel disc — the leaf-clump primitive bushes and tree canopies are
    // built from. Stepped on a 4px grid so it reads as pixel art, not a smooth circle.
    function fillBlob(cx, cy, r) {
      const step = 5, r2 = r * r;
      for (let yy = -r; yy <= r; yy += step)
        for (let xx = -r; xx <= r; xx += step)
          if (xx * xx + yy * yy <= r2) ctx.fillRect(Math.round(cx + xx), Math.round(cy + yy), step, step);
    }
    function drawGrass(gr) {
      if (gr.grow <= 0) return;
      const baseY = groundY();
      for (const bl of gr.blades) {
        const h = bl.h * gr.grow, x0 = gr.x + bl.dx;
        const sway = Math.sin(gr.t / 520 + bl.dx) * 1.5 * gr.grow;
        ctx.fillStyle = bl.shade;
        for (let s = 0; s < 3; s++) {                        // three segments → a little curve/lean
          const t0 = s / 3, yy = baseY - h * (t0 + 1 / 3);
          const xx = x0 + (sway + bl.lean) * (t0 + 0.2);
          ctx.fillRect(Math.round(xx), Math.round(yy), 2, Math.ceil(h / 3) + 1);
        }
      }
    }
    function drawBush(b) {
      if (b.grow <= 0) return;
      const r = b.r * b.grow, baseY = groundY(), cy = baseY - r * 0.7;
      const breeze = Math.sin(b.t / 1500 + b.seed) * 1.5 * b.grow;
      ctx.fillStyle = b.color; fillBlob(b.x - r * 0.5 + breeze, cy, r * 0.8);
      ctx.fillStyle = b.color2; fillBlob(b.x + r * 0.5 + breeze, cy, r * 0.8);
      ctx.fillStyle = b.color; fillBlob(b.x + breeze, cy - r * 0.4, r * 0.85);
      if (b.berries) {                                       // a few berries tucked in
        ctx.fillStyle = b.berryColor;
        for (let i = 0; i < b.berries; i++) {
          const a = ((b.seed + i * 97) % 360) * Math.PI / 180, rr = r * 0.6;
          ctx.fillRect(Math.round(b.x + breeze + Math.cos(a) * rr), Math.round(cy + Math.sin(a) * rr * 0.7), 3, 3);
        }
      }
    }
    // A blocky filled triangle (apex at top), used for the evergreen tiers and the
    // mountains — stepped on the pixel grid so it matches the rest of the scene.
    function fillTri(apexX, apexY, halfW, baseY, step = 5) {
      const hgt = baseY - apexY; if (hgt <= 0) return;
      for (let yy = 0; yy <= hgt; yy += step) {
        const hw = halfW * (yy / hgt), y = apexY + yy;
        ctx.fillRect(Math.round(apexX - hw), Math.round(y), Math.max(step, Math.round(hw * 2)), step);
      }
    }
    function drawTree(tr) {
      if (tr.grow <= 0) return;
      const baseY = groundY(), h = tr.h * tr.grow, w = tr.w * tr.grow;
      const sway = Math.sin(tr.t / 1600 + tr.x) * 3 * tr.grow, cx = tr.x + sway;
      if (tr.kind === 'pine') {                              // layered evergreen on a short trunk
        const trunkW = Math.max(4, Math.round(w * 0.16)), trunkH = h * 0.14;
        ctx.fillStyle = tr.trunk; ctx.fillRect(Math.round(tr.x - trunkW / 2), Math.round(baseY - trunkH), trunkW, Math.round(trunkH));
        ctx.fillStyle = tr.trunkDark; ctx.fillRect(Math.round(tr.x + trunkW / 2 - 2), Math.round(baseY - trunkH), 2, Math.round(trunkH));
        const topY = baseY - h, botY = baseY - trunkH * 0.6, tiers = 4, span = botY - topY;
        for (let i = 0; i < tiers; i++) {                    // wide skirt at the bottom up to a point
          const apexY = topY + span * (i / tiers) * 0.82;
          const tierBaseY = topY + span * ((i + 1) / tiers);
          const halfW = (w / 2) * (0.34 + (i / (tiers - 1)) * 0.66);
          ctx.fillStyle = i % 2 ? tr.canopy2 : tr.canopy;
          fillTri(cx, apexY, halfW, tierBaseY);
          ctx.fillStyle = tr.canopyDark;                     // a shaded underside to each tier
          fillTri(cx + halfW * 0.35, tierBaseY - span / tiers * 0.5, halfW * 0.5, tierBaseY);
          if (tr.snow > 0.02) {                              // a slow dusting of snow on the tier tops
            ctx.fillStyle = SNOW_WHITE; ctx.globalAlpha = Math.min(1, tr.snow);
            fillTri(cx, apexY, halfW * (0.4 + tr.snow * 0.3), apexY + span / tiers * 0.5);
            ctx.globalAlpha = 1;
          }
        }
        return;
      }
      // leafy tree: a shaded trunk, then three tonal passes over a clump of leaves
      const trunkW = Math.max(5, Math.round(w * 0.2)), trunkTop = baseY - h * 0.6;
      ctx.fillStyle = tr.trunk; ctx.fillRect(Math.round(tr.x - trunkW / 2), Math.round(trunkTop), trunkW, Math.round(baseY - trunkTop));
      ctx.fillStyle = tr.trunkDark; ctx.fillRect(Math.round(tr.x + trunkW / 2 - 2), Math.round(trunkTop), 2, Math.round(baseY - trunkTop));
      ctx.fillStyle = tr.trunk;                              // a branch stub each side, reaching up into the leaves
      ctx.fillRect(Math.round(tr.x - trunkW / 2 - 6), Math.round(trunkTop + 6), 8, 3);
      ctx.fillRect(Math.round(tr.x + trunkW / 2 - 2), Math.round(trunkTop + 14), 8, 3);
      const cMid = baseY - h + h * 0.32;
      const blobs = [[0, -h * 0.04, 1], [-w * 0.34, h * 0.1, 0.72], [w * 0.34, h * 0.1, 0.72], [-w * 0.16, h * 0.26, 0.66], [w * 0.18, h * 0.24, 0.66], [0, h * 0.2, 0.86]];
      for (let i = 0; i < blobs.length; i++) {               // base fill
        ctx.fillStyle = i % 2 ? tr.canopy2 : tr.canopy;
        fillBlob(cx + blobs[i][0], cMid + blobs[i][1], w * 0.42 * blobs[i][2]);
      }
      ctx.fillStyle = tr.canopyDark;                         // shadow gathers low and to the right
      fillBlob(cx + w * 0.2, cMid + h * 0.22, w * 0.3);
      fillBlob(cx + w * 0.04, cMid + h * 0.28, w * 0.26);
      ctx.fillStyle = tr.canopyLite;                         // sun catches the upper-left
      fillBlob(cx - w * 0.22, cMid - h * 0.08, w * 0.26);
      fillBlob(cx - w * 0.02, cMid - h * 0.12, w * 0.2);
      if (tr.blossom) {                                      // a sprinkle of blossom / fruit
        ctx.fillStyle = tr.blossom;
        for (let i = 0; i < 10; i++) {
          const a = ((tr.seed + i * 137) % 360) * Math.PI / 180, rr = w * 0.4 * (0.4 + (i % 4) * 0.18);
          ctx.fillRect(Math.round(cx + Math.cos(a) * rr), Math.round(cMid + Math.sin(a) * rr * 0.8), 3, 3);
        }
      }
    }
    // The far peaks — small, atmospheric, jagged (a ridge of several summits, not a
    // single triangle), rising very slowly with snow that creeps down the tips over
    // many minutes. Drawn behind everything else. Traces the ridge as a polygon, then
    // re-fills the upper band clipped white for the snow caps so it follows the jags.
    function ridgePath(mt, h) {
      const baseY = groundY(), lx = mt.x - mt.w / 2, n = mt.ridge.length - 1;
      ctx.beginPath(); ctx.moveTo(lx, baseY);
      for (let i = 0; i <= n; i++) ctx.lineTo(lx + (mt.w * i) / n, baseY - h * mt.ridge[i]);
      ctx.lineTo(lx + mt.w, baseY); ctx.closePath();
    }
    function drawMountain(mt) {
      if (mt.grow <= 0) return;
      const baseY = groundY(), h = mt.h * mt.grow;
      ctx.globalAlpha = 0.9;
      ctx.fillStyle = mt.base; ridgePath(mt, h); ctx.fill();
      ctx.strokeStyle = mt.shade; ctx.lineWidth = 2; ridgePath(mt, h); ctx.stroke();  // a little ridge definition
      if (mt.snow > 0.01) {                                  // snow caps the jagged tips, creeping down
        const snowLine = baseY - h * (0.6 + Math.min(1, mt.snow) * 0.22);
        ctx.save();
        ctx.beginPath(); ctx.rect(mt.x - mt.w / 2, 0, mt.w, Math.max(0, snowLine)); ctx.clip();
        ctx.fillStyle = SNOW_WHITE; ridgePath(mt, h); ctx.fill();
        ctx.restore();
      }
      ctx.globalAlpha = 1;
    }
    function drawVine(v) {
      if (v.grow <= 0) return;
      const baseY = groundY(), topY = baseY - v.top, len = v.len * v.grow;
      const segs = Math.max(4, Math.round(len / 6)), every = Math.max(1, Math.round(segs / v.leaves));
      ctx.fillStyle = v.color;
      for (let s = 0; s < segs; s++) {
        const t0 = s / segs, yy = topY + len * t0;
        const xx = v.x + Math.sin(t0 * 6 + v.t / 900 + v.sway) * 6 * v.grow;
        ctx.fillRect(Math.round(xx - 1), Math.round(yy), 3, 4);
        if (s % every === 0) { ctx.fillRect(Math.round(xx + 2), Math.round(yy), 4, 3); ctx.fillRect(Math.round(xx - 5), Math.round(yy + 2), 4, 3); }
      }
    }
    function drawRock(rk) {
      if (rk.grow <= 0) return;
      const baseY = groundY(), w = rk.w * rk.grow, h = rk.h * rk.grow, step = 5;
      for (let yy = -h; yy <= 0; yy += step)
        for (let xx = -w; xx <= w; xx += step) {
          const ex = xx / w, ey = yy / h;
          if (ex * ex + ey * ey <= 1) { ctx.fillStyle = yy < -h * 0.5 ? rk.color2 : rk.color; ctx.fillRect(Math.round(rk.x + xx), Math.round(baseY + yy - step), step, step); }
        }
    }
    function drawCritter(c) {
      if (c.kind === 'rabbit') blitKeyed(c.airborne ? RABBIT_HOP : RABBIT, RABBIT_COLORS, c.x, groundY(), 0.9, c.dir < 0, c.yOff || 0);
      else blitKeyed(c.legFlip ? DEER_WALK_B : DEER_WALK_A, DEER_COLORS, c.x, groundY(), 1.25, c.dir < 0, 0);
    }

    // The death crumple: every pixel of the standing beast falls from where it was to
    // where it belongs in the corpse pose. Each holds for its delay, then travels over
    // its own duration with a little upward kick, gravity-accelerated drop and a touch
    // of sideways tumble — so it reads as the body coming apart and raining into a
    // heap, and the final frame is the corpse EXACTLY.
    function drawMonsterCrumble(D) {
      for (const p of D.crumble) {
        const k = Math.max(0, Math.min(1, (D.t - p.delay) / p.dur));
        const ex = k * (2 - k);                          // ease-out for the horizontal slide
        const ey = k * k;                                 // ease-in (gravity) for the fall
        const x = p.x0 + (p.tx - p.x0) * ex + (k > 0 && k < 1 ? Math.sin(D.t / 50 + p.x0) * p.jit * (1 - k) : 0);
        const y = p.y0 + (p.ty - p.y0) * ey - Math.sin(Math.PI * k) * p.pop;
        ctx.fillStyle = p.color;
        ctx.fillRect(Math.round(x), Math.round(y), Math.ceil(p.px), Math.ceil(p.px));
      }
    }

    function drawDeath() {
      const D = T.death;
      if (D.phase !== 'fall') {                            // a soft warm halo, once he's down and resting
        const gx = D.x, gy = groundY() - 70;
        const grd = ctx.createRadialGradient(gx, gy, 8, gx, gy, 300);
        grd.addColorStop(0, 'rgba(255,238,200,0.12)'); grd.addColorStop(1, 'rgba(255,238,200,0)');
        ctx.fillStyle = grd; ctx.fillRect(0, 0, W(), canvas.height);
      }
      // the far mountains sit furthest back, then the tall foliage (trees → their
      // vines → bushes → rocks)
      for (const mt of D.mountains) drawMountain(mt);
      for (const tr of D.trees) drawTree(tr);
      for (const v of D.vines) drawVine(v);
      for (const b of D.bushes) drawBush(b);
      for (const rk of D.rocks) drawRock(rk);
      for (const p of D.motes) {                          // drifting light motes / pollen
        ctx.globalAlpha = Math.max(0, Math.min(0.7, p.life / 1500)) * 0.7;
        ctx.fillStyle = p.color; ctx.fillRect(Math.round(p.x), Math.round(p.y), p.size, p.size);
      }
      ctx.globalAlpha = 1;
      if (D.phase === 'fall') {                            // his pixels rain down into the corpse pose
        drawMonsterCrumble(D);
      } else if (D.phase !== 'rest') {                     // corpse cross-fades to skeleton, then sinks under
        const sinkPx = (D.sink || 0) * (SKELETON.length * PIXEL * DEATH_BODY_SCALE + 36);
        const feetY = groundY() + sinkPx, alphaSink = Math.max(0, 1 - (D.sink || 0) * 0.92);
        const skelK = Math.min(1, Math.max(0, (D.decomp - 0.25) / 0.55));
        ctx.globalAlpha = (1 - skelK) * alphaSink;
        if (ctx.globalAlpha > 0.01) blitKeyed(MONSTER_CORPSE, MONSTER_COLORS, D.x, feetY, DEATH_BODY_SCALE, D.dir < 0, 0);
        ctx.globalAlpha = skelK * alphaSink;
        if (ctx.globalAlpha > 0.01) blitKeyed(SKELETON, SKELETON_COLORS, D.x, feetY, DEATH_BODY_SCALE, D.dir < 0, 0);
        ctx.globalAlpha = 1;
      }
      // foreground: grass at his feet, then the flowers, the wandering critters, and
      // the butterflies drifting over the top of it all.
      for (const g of D.grass) drawGrass(g);
      for (const f of D.flowers) drawFlower(f);
      for (const c of D.critters) drawCritter(c);
      for (const b of D.butterflies) drawButterfly(b);
      ctx.fillStyle = GREEN; ctx.globalAlpha = 1;
    }

    // ── Cursor affection ───────────────────────────────────────────────────
    // Where the pointer is (in canvas coords), how fast it's moving, and how long
    // it's lingered over / near him. Drives petting, tickling, and batting at the
    // cursor — see the bookkeeping block in the loop and the pet/tickle/chase/flinch
    // actions. Updated on every mousemove (not just while dragging).
    const cur = { x: -1e4, y: -1e4, has: false, lastT: 0, speed: 0, overT: 0, nearT: 0, cdUntil: 0 };
    const CURSOR_ACTS = new Set(['pet', 'tickle', 'chase', 'flinch']);
    function cursorOverTroll(pad = 14) {
      if (!cur.has) return false;
      const rows = POSES[T.pose] || STAND, px = PIXEL * T.scale;
      const w = spriteW(rows) * px, h = rows.length * px, cx = T.x + T.shakeX, feetY = groundY();
      return cur.x >= cx - w / 2 - pad && cur.x <= cx + w / 2 + pad
        && cur.y >= feetY - h + T.yOffset - pad && cur.y <= feetY + pad;
    }
    function cursorNearTroll(rad) {
      if (!cur.has) return false;
      const cx = T.x + T.shakeX, cy = groundY() + T.yOffset - STAND_H * T.scale * 0.5;
      return Math.hypot(cur.x - cx, cur.y - cy) < rad;
    }

    // App-driven reactions: the app dispatches `window` CustomEvents like
    //   window.dispatchEvent(new CustomEvent('pixeltroll', { detail: { type: 'posted' } }))
    // and he cheers (good) or frets (anything matching error/fail/warn). And if you
    // haven't engaged HIM in a long while, he gets bored and tries to get noticed.
    let pendingReact = null, lastInteractT = performance.now(), boredCdUntil = 0;

    let raf, last = performance.now();
    let showScore = false;   // toggled by Shift+A
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

      // Banished (you shot the troll OR the cop during the police scene): the ordinary
      // troll is gone for this session. But two minutes on he claws back as the MONSTER —
      // and once that's been shot down, the gentle death/bloom scene plays out. All
      // of it lives off in its own branch; only a hard reload truly resets it.
      if (T.banished) {
        if (!T.monster && !T.death && T.monsterReturnAt && now >= T.monsterReturnAt) startMonster(now);
        if (T.monster || T.death) {
          if (canvas.style.zIndex !== '60') canvas.style.zIndex = '60';  // ride over the widgets
          if (T.monster) { stepMonster(dt, now); drawMonster(dt); }
          else { stepDeath(dt, now); drawDeath(dt); }
          drawEntities(dt);                              // gore / debris from his bursts, on top
          if (showScore) drawScore();
          raf = requestAnimationFrame(loop);
          return;
        }
        const zw = String(T.splats.length ? 60 : zIndex);
        if (canvas.style.zIndex !== zw) canvas.style.zIndex = zw;
        drawEntities(dt);
        if (showScore) drawScore();
        raf = requestAnimationFrame(loop);
        return;
      }

      // Mood eases back toward neutral over time (slow — a grudge or a soft spot
      // lasts a good while), and we persist it every so often so it survives reloads.
      if (T.mood !== 0) {
        T.mood += (0 - T.mood) * Math.min(1, dt / 1000 * 0.0025);
        if (Math.abs(T.mood) < 0.05) T.mood = 0;
      }
      T.moodSaveT += dt;
      if (T.moodSaveT > 12000) { T.moodSaveT = 0; saveMood(); }

      // While he's dragged / dropping — or while blood is on the screen — lift the
      // whole canvas above the floating widgets (z-40) so he/the gore ride OVER
      // them; otherwise sit back at the normal layer behind them.
      const onLedge = T.action === 'napWidget' && T.widget && T.widget.up;   // up on a panel → ride over it
      const zWant = String((DRAG_ACTIONS.has(T.action) && T.mode === 'active') || T.splats.length || onLedge ? 60 : zIndex);
      if (canvas.style.zIndex !== zWant) canvas.style.zIndex = zWant;

      // Food on the floor lures him over: it interrupts his idle wandering and
      // even calls him in from off-screen, but never breaks a scripted cameo, a
      // poke reaction, a drag/drop/shot, an exit already underway, or a meal in
      // progress. Re-arms each frame until he's actually on the 'feast' action.
      // Those things only block him while he's actually ON-SCREEN — once he's away
      // he's always fair game, so food reliably summons him even right after he
      // fled or snatched the last cut (when T.action is still a stale poke/feast).
      const lure = T.meats.find((m) => !m.gone);
      const protectedAct = SPECIALS.has(T.action) || DRAG_ACTIONS.has(T.action)
        || CLICK_SET.has(T.action) || T.action === 'feast';
      const busy = T.mode === 'active' && (protectedAct || T.leaving);
      if (lure && !busy) {
        // A BIG cut + a mad mood = a sneaky approach. If he's out and about when it
        // lands, he doesn't blink into a peek (looks like he vanishes) — he exits
        // properly first, then creeps back for it from off-screen.
        const wantsSneaky = T.mood <= -18 && T.meats.some((m) => !m.gone && m.big);
        if (wantsSneaky && T.mode === 'active') {
          startAction(pick(['runOff', 'burrow']), now);  // duck out the proper way, then sneak back
        } else {
          if (T.mode === 'away') T.x = lure.x < W() / 2 ? -off : W() + off;  // stroll in from the near edge
          startAction('feast', now);
        }
      }

      // Ambient chatter — every so often, while he's just hanging around (not mid
      // cameo, poke, drag, meal, or exit), he pipes up with a line that fits his
      // mood. Re-checks his action here since the lure above may have started a meal.
      const calm = !(SPECIALS.has(T.action) || DRAG_ACTIONS.has(T.action) || CLICK_SET.has(T.action) || T.action === 'feast');
      if (T.mode === 'active' && calm && !T.leaving && !T.speech && now - T.lastSpoke > T.nextChatter) {
        sayAmbient();
        T.nextChatter = rand(18000, 33000);            // chatty — a line every ~20-30s while he's around
      }

      // Maxed-out love → the moment he's free (not mid-cameo/poke/drag/meal/exit) he
      // bursts into a heart-pouring celebration right where he stands.
      if (T.lovePending && T.mode === 'active' && calm && !T.leaving) {
        T.lovePending = false;
        startAction('lovefest', now);
      }

      // ── Cursor affection: hover over him (still = pet, jiggle = tickle) or just
      // nearby (he bats at / investigates the cursor). A soured troll won't have it —
      // he flinches away instead. Only when he's free (calm, on-screen, settled).
      const stillMs = now - cur.lastT;
      if (stillMs > 80) cur.speed *= Math.pow(0.9, dt / 16);  // bleed speed toward 0 when the pointer's idle
      const overHim = cursorOverTroll(16), nearHim = !overHim && cursorNearTroll(74);
      if (overHim) { cur.overT += dt; cur.nearT = 0; }
      else if (nearHim) { cur.nearT += dt; cur.overT = 0; }
      else { cur.overT = 0; cur.nearT = 0; }
      if (T.mode === 'active' && calm && !T.leaving && !CURSOR_ACTS.has(T.action)) {
        const wary = T.mood <= -40;                     // doesn't trust you → recoils from the cursor
        if (wary && (overHim || nearHim) && now > cur.cdUntil) { cur.cdUntil = now + 1400; startAction('flinch', now); }
        else if (!wary && overHim && cur.speed > 240) startAction('tickle', now);
        else if (!wary && overHim && cur.overT > 220 && cur.speed < 130) startAction('pet', now);
        else if (!wary && nearHim && cur.nearT > 500) startAction('chase', now);
      }
      if (overHim || nearHim) lastInteractT = now;      // engaging him resets his boredom

      // App-event reaction (cheer / fret) — fires when he's on-screen and free; a
      // stale event (>4s) is dropped. Then: boredom if you've ignored him for ~52s.
      if (pendingReact) {
        if (now - pendingReact.t > 4000) pendingReact = null;
        else if (T.mode === 'active' && calm && !T.leaving) {
          startAction(pendingReact.kind === 'bad' ? 'fret' : 'cheer', now);
          pendingReact = null;
        }
      } else if (T.mode === 'active' && calm && !T.leaving && now - lastInteractT > 52000 && now > boredCdUntil) {
        boredCdUntil = now + 30000;                     // don't nag constantly
        startAction('bored', now);
      }

      // Smitten with you (mood high) → he periodically leaves you a little gift.
      if (T.mood >= 55 && T.mode === 'active' && calm && !T.leaving) {
        T.giftT -= dt;
        if (T.giftT <= 0) {
          T.giftT = rand(22000, 40000);
          spawnGift(pick(LOVE_GIFTS), T.x + rand(-20, 20), true);
          if (!T.speech && Math.random() < 0.6) say(pick(['for you!', 'a little something', 'here!', 'i found this!']), '#159a52');
        }
      }

      if (T.mode === 'away') {
        if (now >= T.nextVisit) { planVisit(); beginNext(now); }
      } else {
        if (T.action === 'grab' && !drag) releaseDrag();   // grab abandoned (e.g. page nav) → let him drop
        const done = stepAction(dt);
        ctx.fillStyle = T.color;
        ctx.globalAlpha = T.alpha;
        blit(POSES[T.pose] || STAND, T.x + T.shakeX, groundY(), T.scale, T.mirror, T.yOffset);
        ctx.globalAlpha = 1;
        // His mood shows on his face: angry brows once he's soured on you, plus a
        // churning red rage-cloud overhead when he REALLY hates you. Only on
        // upright face-poses, and never mid-cameo / drag / death.
        const mood = T.mood;
        const facey = FACE_POSES.has(T.pose) && T.alpha > 0.4
          && !SPECIALS.has(T.action) && !DRAG_ACTIONS.has(T.action) && T.action !== 'shot';
        const cx = T.x + T.shakeX, feetY = groundY();
        if (facey) drawGear(cx, feetY, T.scale, T.yOffset);   // shades / crown he's earned
        if (facey && mood <= -18) {                   // angry brows when soured; rage cloud when he really hates you
          T.furyT += dt;
          drawBrows(cx, feetY, T.scale, T.yOffset);
          if (mood <= -82) drawFury(cx, feetY - (POSES[T.pose] || STAND).length * PIXEL * T.scale + T.yOffset);
        }
        if (facey) {                                  // mood weather: drizzle when down, sun + petals when smitten
          T.weatherT += dt;
          const headTop = feetY - (POSES[T.pose] || STAND).length * PIXEL * T.scale + T.yOffset;
          if (mood <= -30 && mood > -82) drawRain(cx, headTop);
          else if (mood >= 55) drawSun(cx, headTop);
        }
        if (done) beginNext(now);
      }

      drawEntities(dt);
      if (showScore) drawScore();
      raf = requestAnimationFrame(loop);
    }
    raf = requestAnimationFrame(loop);

    // Click the troll → he busts out one of his random poke-reactions (topples
    // over dazed, hiccups, gets zapped, melts, hits the jackpot, ...). A single,
    // spaced-out poke is friendly and warms him; jabbing fast just annoys him.
    // Works anytime (not gated to generating). The canvas stays pointer-events:none
    // so the page underneath keeps its clicks; we just hit-test his bounding box.
    let pokeStreak = 0, lastPoke = 0;
    // Click-and-hold drag: a press that lands on him arms a *potential* drag; it
    // only becomes a real grab once the pointer actually moves (so plain clicks
    // still poke and double-clicks still flick). `suppressClick` swallows the
    // trailing click the browser fires at the end of a drag.
    let drag = null, suppressClick = false;

    // Is this pointer event landing on the troll's bounding box (+ padding)?
    function hitTroll(e, pad) {
      const rows = POSES[T.pose] || STAND;
      const px = PIXEL * T.scale;
      const w = spriteW(rows) * px, h = rows.length * px;
      const cx = T.x + T.shakeX, feetY = groundY();
      const canvasTop = window.innerHeight - canvas.height; // canvas sits at bottom:0
      const left = cx - w / 2 - pad, right = cx + w / 2 + pad;
      const vTop = canvasTop + (feetY - h + T.yOffset) - pad;
      const vBottom = canvasTop + feetY + pad;
      return e.clientX >= left && e.clientX <= right && e.clientY >= vTop && e.clientY <= vBottom;
    }
    const clearSelection = () => { const s = window.getSelection && window.getSelection(); if (s) s.removeAllRanges(); };

    function onClick(e) {
      if (suppressClick) { suppressClick = false; return; }           // trailing click after a drag — ignore
      if (hiddenRef.current) return;
      if (collectGiftAt(e.clientX, e.clientY - (window.innerHeight - canvas.height))) return;  // clicked a gift → pocket it
      if (T.mode === 'away') return;
      if (SPECIALS.has(T.action) || DRAG_ACTIONS.has(T.action)) return; // never interrupt a cameo / drag
      if (!hitTroll(e, 14)) return;

      const now = performance.now();
      pokeStreak = (now - lastPoke < 1100) ? pokeStreak + 1 : 1;
      lastPoke = now;
      // an occasional, spaced-out poke is friendly (warms him); jabbing fast barely
      // counts and just annoys him.
      bumpMood(pokeStreak === 1 ? 6 : pokeStreak <= 3 ? 1 : -2);
      if (Math.random() < 0.45) sayEvent(SPEECH_POKED);
      if (CLICK_SET.has(T.action)) return;         // mid-reaction: the poke counted, but don't restart it
      startAction(pick(CLICK_REACTS), now);
    }
    window.addEventListener('click', onClick);

    // The canvas is pointer-events:none, so a double-click passes through to the
    // page text underneath and the browser selects (and the OS may copy) a word.
    // The selection actually starts on the SECOND mousedown — so we cancel it
    // there whenever a multi-click is landing on him, before it ever happens.
    // A primary press that lands on him also arms a potential drag (see above).
    function onMouseDown(e) {
      if (hiddenRef.current || T.mode === 'away') return;
      if (e.detail >= 2 && hitTroll(e, 22)) { e.preventDefault(); clearSelection(); }
      if (e.button === 0 && !SPECIALS.has(T.action)
          && !DRAG_ACTIONS.has(T.action) && hitTroll(e, 18)) {
        drag = { startX: e.clientX, startY: e.clientY, grabbing: false };
      }
    }
    window.addEventListener('mousedown', onMouseDown);

    // Drag him around: once the press crosses a small movement threshold he's
    // grabbed — pinned to the cursor, kicking and fighting — and rides OVER the
    // widgets (the canvas is lifted; no collision while held). Releasing drops him.
    function onMouseMove(e) {
      // Track the pointer for the cursor-affection behaviors (always, even when not
      // dragging). Canvas sits at bottom:0 full-height, so canvas coords == client.
      const nowM = performance.now();
      const cyl = e.clientY - (window.innerHeight - canvas.height);
      if (cur.has) {
        const dtm = Math.max(1, nowM - cur.lastT);
        cur.speed = cur.speed * 0.6 + (Math.hypot(e.clientX - cur.x, cyl - cur.y) / dtm * 1000) * 0.4;
      }
      cur.x = e.clientX; cur.y = cyl; cur.has = true; cur.lastT = nowM;

      if (!drag) return;
      if (hiddenRef.current || T.mode === 'away') { drag = null; return; }
      if (!drag.grabbing) {
        if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < 6) return;
        drag.grabbing = true;
        startAction('grab', performance.now());
        bumpMood(T.mood >= 40 ? 0 : -4); sayEvent(SPEECH_GRABBED);   // if he trusts you, being picked up is fine; else it sours him
        const G0 = T.grab;
        if (G0) { G0.cx = e.clientX; G0.cy = e.clientY; G0.lastClientX = e.clientX; G0.lastClientY = e.clientY; G0.lastT = performance.now(); }
      }
      e.preventDefault(); clearSelection();
      const G = T.grab; if (!G) return;
      const now = performance.now(), dtm = now - G.lastT;
      if (dtm > 0) {                                     // track a (smoothed) throw velocity for the release
        const ivx = (e.clientX - G.lastClientX) / dtm * 1000;
        const ivy = (e.clientY - G.lastClientY) / dtm * 1000;
        G.vx = G.vx * 0.6 + ivx * 0.4; G.vy = G.vy * 0.6 + ivy * 0.4;
        G.lastClientX = e.clientX; G.lastClientY = e.clientY; G.lastT = now;
      }
      G.cx = e.clientX; G.cy = e.clientY;
    }
    window.addEventListener('mousemove', onMouseMove);

    // Each drop / whack winds him up to bolt once it's over — and to bolt FASTER
    // the more times it happens before he gets a calm visit (beginNext resets the
    // streak when he finally leaves in peace).
    function bumpFlee() { T.fleeStreak = Math.min(8, T.fleeStreak + 1); T.pendingFlee = true; }

    // Let go → he either floats down under a little parachute, just falls, or
    // (10%) bursts into blood and sinks into the ground. Either way he passes
    // over the widgets on the way down — and if he survives it, he scrambles off.
    function releaseDrag() {
      const G = T.grab;
      const feetY = G ? (G.cy + STAND_H * 0.5) : groundY();
      const clamp = (v, m) => Math.max(-m, Math.min(m, v));
      T.dropSeed = {
        x: G ? G.cx : T.x,
        h: Math.max(0, groundY() - feetY),
        vx: clamp(G ? G.vx : 0, 900),
        vy: clamp(G ? -G.vy : 0, 1600),                  // screen-down velocity → upward-positive
      };
      const r = Math.random();
      const outcome = r < 0.10 ? 'dropSplat' : (r < 0.55 ? 'dropChute' : 'dropFall');
      bumpMood(outcome === 'dropSplat' ? -14 : outcome === 'dropFall' ? -5 : -2);  // a hard drop hurts more than a soft chute
      if (outcome !== 'dropSplat') bumpFlee();           // survived the drop → he'll bolt the moment he lands
      startAction(outcome, performance.now());
    }
    function onMouseUp(e) {
      if (!drag) return;
      const wasGrabbing = drag.grabbing;
      drag = null;
      if (!wasGrabbing) return;                          // never moved → it was a click; let onClick poke
      suppressClick = true;                              // a real drag ended → swallow the trailing click
      e.preventDefault(); clearSelection();
      releaseDrag();
    }
    window.addEventListener('mouseup', onMouseUp);

    // If the pointer leaves the window mid-grab, drop him where he is.
    function onDocLeave() {
      cur.has = false; cur.overT = 0; cur.nearT = 0;       // pointer's gone → no cursor affection
      if (drag && drag.grabbing) { drag = null; suppressClick = true; releaseDrag(); }
      else drag = null;
    }
    document.addEventListener('mouseleave', onDocLeave);

    // Is this event landing on the cop (during the police scene)?
    function hitCop(e) {
      const C = T.cop;
      if (!C) return false;
      const px = PIXEL * COP_SCALE;
      const w = spriteW(POLICE) * px, h = POLICE.length * px;
      const canvasTop = window.innerHeight - canvas.height;
      const left = C.x - w / 2 - 16, right = C.x + w / 2 + 16;
      const vTop = canvasTop + (groundY() - h + (C.yOff || 0)) - 16, vBottom = canvasTop + groundY() + 16;
      return e.clientX >= left && e.clientX <= right && e.clientY >= vTop && e.clientY <= vBottom;
    }
    // During the police scene you can pick off the troll OR the cop, individually.
    // Whichever you hit bursts in a screen-wide splatter (green bits for the troll,
    // blue for the cop); the police-scene choreography then makes the OTHER one
    // panic and bolt. Either kill ends the troll for this session (mood wiped) and
    // stops everything else — then, 2 minutes later, he returns as the monster.
    function killInScene(target, clientX, clientY) {
      const canvasTop = window.innerHeight - canvas.height;
      const gx = clientX, gy = clientY - canvasTop;
      const bit = target === 'cop' ? COP_COLORS.u : GREEN;   // bits of whoever was hit
      spawnSplats(gx, gy, bit);                          // a gory exit, screen-wide
      for (let i = 0; i < 44; i++) {
        const ang = rand(-Math.PI, Math.PI), sp = rand(80, 460);
        T.confetti.push({ x: gx, y: gy, vx: Math.cos(ang) * sp, vy: Math.sin(ang) * sp - 70, life: rand(600, 1400), size: Math.round(rand(2, 7)), color: Math.random() < 0.3 ? bit : RED });
      }
      T.policeKill = target; T.speech = null;            // the police step now runs the survivor's escape
      // Kill EITHER one in front of the cop and the whole thing is over — the
      // troll's gone for this session and everything else stops. But 2 minutes
      // later he claws back as the monster (the survivor's bolt sets `banished`,
      // and the banished branch fires startMonster once monsterReturnAt lands).
      T.mood = 0; T.policePending = false;
      try { window.localStorage.setItem(MOOD_KEY, '0'); } catch { /* ignore */ }
      T.monsterReturnAt = performance.now() + 120000;
    }

    // Right-click him → he's shot dead: bursts into pieces, blood splatters across
    // the whole screen (over the widgets and all), then drips down and fades. A
    // few green bits fly in the spray. Overrides any poke / flick / drag — and
    // works mid-air too, so you can pick him off while he floats down the chute.
    // DURING the police scene you instead pick off the troll OR the cop individually
    // (whichever you hit) and the other one bolts. Shift + right-click drops big food.
    function onContextMenu(e) {
      if (hiddenRef.current) return;
      // Monster rampage: right-click bursts him in a screen-wide splatter — but he
      // just reforms, angrier. It takes five hits to finally drop him. Handled
      // first, since during the monster T.mode/T.action are stale (he's "banished").
      if (T.monster) {
        if (T.monster.phase !== 'rampage' || T.monster.exploding > 0) return;
        if (!hitMonster(e)) return;
        e.preventDefault(); clearSelection();
        explodeMonster(e.clientX, e.clientY);
        return;
      }
      // Shift + right-click → drop a BIG cut of meat. Works even while he's away
      // (it summons him out), so it's handled before the away/shot guards below.
      if (e.shiftKey && !T.banished) {
        const el = e.target;
        if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return; // don't fight real editing
        e.preventDefault(); clearSelection();
        spawnMeat(e.clientX, e.clientY, true);
        return;
      }
      if (T.mode === 'away') return;
      if (T.action === 'shot') return;
      if (T.action === 'police') {                       // the climax: pick off the troll or the cop — the other bolts
        if (T.policeKill) return;                        // a kill's already underway
        const onTroll = hitTroll(e, 18), onCop = hitCop(e);
        if (!onTroll && !onCop) return;
        e.preventDefault(); clearSelection();
        drag = null; pokeStreak = 0;
        const dTroll = Math.abs(e.clientX - (T.x + T.shakeX));
        const dCop = T.cop ? Math.abs(e.clientX - T.cop.x) : Infinity;
        const target = (onCop && (!onTroll || dCop <= dTroll)) ? 'cop' : 'troll';
        killInScene(target, e.clientX, e.clientY);
        return;
      }
      if (!hitTroll(e, 18)) return;
      e.preventDefault(); clearSelection();
      drag = null; pokeStreak = 0;                       // (right-click emits no `click`, so nothing to suppress)
      // A kill hits his mood: if he's not yet badly soured (above −50) it drops him
      // straight to −70; once he's already at/below −50, each shot gouges off another
      // −30 — so repeated kills march him down toward the police scene.
      T.mood = T.mood <= -50 ? Math.max(-100, T.mood - 30) : -70;
      if (T.mood <= -100) { T.policePending = true; T.lovePending = false; }  // bottomed out → he WILL be back with a cop
      saveMood();
      T.speech = null;
      T.shotAt = { x: T.x, yOff: T.yOffset };            // burst right where he is now (even falling / dangling)
      startAction('shot', performance.now());
    }
    window.addEventListener('contextmenu', onContextMenu);

    // Double-click him → a WHACK that sends him flying: he launches off in a
    // random direction, tumbles through the air, and bounces off the floor,
    // walls, and widgets until he settles somewhere new — like flicking a bug.
    // A flick overrides whatever poke he's mid-way through (but not a cameo).
    function onDblClick(e) {
      if (hiddenRef.current || T.mode === 'away') return;
      if (SPECIALS.has(T.action) || DRAG_ACTIONS.has(T.action)) return; // not mid-cameo / drag
      if (!hitTroll(e, 22)) return;                    // a touch more forgiving than a poke
      e.preventDefault(); clearSelection();            // belt-and-suspenders: kill any word selection
      pokeStreak = 0;                                  // a flick resets the poke streak
      bumpMood(-12);                                   // getting whacked across the room makes him MAD (a lone poke never does)
      bumpFlee();                                      // ...and once he stops tumbling, he bolts — faster each time
      startAction('pflick', performance.now());
    }
    window.addEventListener('dblclick', onDblClick);

    // Shift+click blank space → a chunk of meat appears right where you clicked,
    // drops to his floor, and (wherever he is) he comes running to wolf it down.
    // Clicking HIM with shift held isn't a feed — that still falls through to a
    // poke. We preventDefault so the shift+click doesn't select/highlight the page
    // text around it, but we leave real text fields alone so editing still works.
    function onFeed(e) {
      if (hiddenRef.current || T.banished) return;
      if (!e.shiftKey || e.button !== 0) return;
      const el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return; // don't fight real editing
      if (hitTroll(e, 14)) return;
      e.preventDefault();                                // stop shift+click from highlighting page text
      clearSelection();                                  // and drop anything already selected
      spawnMeat(e.clientX, e.clientY);
    }
    window.addEventListener('mousedown', onFeed);

    // Shift+A toggles the mood meter; Shift+M / Shift+K are debug triggers for the
    // monster (summon / drop). Shift+D jumps straight to the moment the skeleton has
    // just sunk (the bare flower cluster) and Shift+G fast-forwards the garden's
    // 15-min spread. Ignored while you're typing in a field (and on key auto-repeat)
    // so they don't fight real input or flicker.
    function onKeyDown(e) {
      if (e.repeat || !e.shiftKey) return;
      const el = e.target;
      if (el && (el.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName))) return;
      const code = e.code, key = e.key;
      if (code === 'KeyM' || key === 'M' || key === 'm') {       // debug: summon the monster right now
        if (!T.monster) {
          T.banished = true; T.death = null; T.cop = null; T.copSpeech = null; T.policeKill = null; T.speech = null;
          startMonster();
        }
        return;
      }
      if (code === 'KeyK' || key === 'K' || key === 'k') {       // debug: drop the monster (start the bloom scene)
        if (T.monster && T.monster.phase === 'rampage' && !T.monster.exploding) {
          killMonster(T.monster.x, groundY() - MONSTER.length * PIXEL * T.monster.scale * 0.5);
        }
        return;
      }
      if (code === 'KeyD' || key === 'D' || key === 'd') {       // debug: jump to right after the skeleton has sunk
        T.banished = true; T.monster = null; T.cop = null; T.copSpeech = null; T.policeKill = null; T.speech = null;
        restoreWidgets();                                        // skip the kill, but still un-shove any widgets
        const x = W() / 2;
        const D = {
          phase: 'rest', t: 0, x, standX: x, scale: MONSTER_SCALE, fallSign: 1,
          uprightMirror: false, dir: -1, landed: true, decomp: 1, sink: 1,
          flowers: [], butterflies: [], motes: [], flowerT: 0, flutterT: 0, moteT: 0,
          gardenOn: true, gardenT: 0, patchT: 0, critterT: rand(8000, 20000), pockets: [],
          grass: [], bushes: [], trees: [], vines: [], rocks: [], critters: [], mountains: [],
        };
        for (let i = 0; i < 14; i++) { addFlower(D); D.flowers[D.flowers.length - 1].grow = 1; }   // the cluster he left behind
        for (let i = 0; i < 6; i++) addButterfly(D);
        T.death = D;
        return;
      }
      if (code === 'KeyG' || key === 'G' || key === 'g') {       // debug: fast-forward the meadow→forest spread
        const D = T.death;
        if (D) {
          if (D.phase === 'fall' || D.phase === 'corpse') { D.phase = 'sink'; D.t = 0; D.decomp = 1; }
          D.gardenOn = true; D.gardenT = Math.min(GARDEN_SPREAD_MS, D.gardenT + 150000); // jump ~2.5 min on
          for (let i = 0; i < 26; i++) { D.patchT = 9999; growGarden(D, 16); }            // and sprout a fresh wave at once
        }
        return;
      }
      if (code === 'KeyA' || key === 'A' || key === 'a') showScore = !showScore;
    }
    window.addEventListener('keydown', onKeyDown);

    // App hook: dispatch `new CustomEvent('pixeltroll', { detail: { type } })` from
    // anywhere in the app and he reacts — cheers for good news, frets for anything
    // matching error/fail/warn. Ignored while hidden or banished.
    function onAppEvent(e) {
      const type = e && e.detail && e.detail.type;
      if (!type || hiddenRef.current || T.banished) return;
      pendingReact = { kind: /error|fail|warn|bad/i.test(type) ? 'bad' : 'good', t: performance.now() };
    }
    window.addEventListener('pixeltroll', onAppEvent);

    return () => {
      saveMood();                                        // keep his latest feelings across reloads
      shovedEls.forEach((el) => { try { el.style.translate = ''; el.style.rotate = ''; } catch { /* gone */ } });
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('click', onClick);
      window.removeEventListener('mousedown', onFeed);
      window.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
      document.removeEventListener('mouseleave', onDocLeave);
      window.removeEventListener('contextmenu', onContextMenu);
      window.removeEventListener('dblclick', onDblClick);
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('pixeltroll', onAppEvent);
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
