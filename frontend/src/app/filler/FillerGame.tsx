'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  COLOR_COUNT, N, START, W,
  botMove, colorOf, isOver, legalColors, newGame, play,
  type Difficulty, type Player, type State,
} from './engine';

const PALETTE = ['#e8485e', '#9fd05a', '#f6d84a', '#47a3ec', '#6a4ea6', '#3b3b40'];
// Claimed tiles show as white (you) and black (bot); the color you pick still decides what you take.
const OWN_YOU = '#ffffff';
const OWN_BOT = '#000000';
const NAMES = ['Red', 'Green', 'Yellow', 'Blue', 'Purple', 'Black'];
const LEVELS: Difficulty[] = ['easy', 'medium', 'hard'];
const STATS_KEY = 'filler:stats';
const PREFS_KEY = 'filler:prefs';

type Stats = Record<Difficulty, { w: number; l: number; t: number }>;
const emptyStats = (): Stats => ({ easy: { w: 0, l: 0, t: 0 }, medium: { w: 0, l: 0, t: 0 }, hard: { w: 0, l: 0, t: 0 } });

function load<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? { ...fallback, ...JSON.parse(raw) } : fallback;
  } catch {
    return fallback;
  }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

// Rendered on the client only (see FillerClient.tsx): the board is random and
// the preferences live in localStorage, so there is nothing to prerender.
export default function FillerGame() {
  const [prefs] = useState(() => load(PREFS_KEY, { level: 'hard' as Difficulty, botFirst: false }));
  const [game, setGame] = useState<State>(() => newGame());
  const [turn, setTurn] = useState<Player>(prefs.botFirst ? 2 : 1);
  const [level, setLevel] = useState<Difficulty>(prefs.level);
  const [botFirst, setBotFirst] = useState(prefs.botFirst);
  const [ripple, setRipple] = useState<Map<number, number>>(new Map());
  const [lastBot, setLastBot] = useState<number | null>(null);
  const [stats, setStats] = useState<Stats>(() => load(STATS_KEY, emptyStats()));
  const [menu, setMenu] = useState(false);
  const [offline, setOffline] = useState(false);

  const start = useCallback((first: Player) => {
    setGame(newGame());
    setTurn(first);
    setRipple(new Map());
    setLastBot(null);
  }, []);

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/filler-sw.js', { scope: '/filler' }).then(
      () => navigator.serviceWorker.ready.then((reg) => {
        // Files this visit loaded before the worker took over (the game's own
        // lazy chunk among them) never passed through it. Hand it the list.
        const urls = performance.getEntriesByType('resource')
          .map((e) => e.name)
          .filter((u) => u.startsWith(`${location.origin}/_next/static/`) || u.startsWith(`${location.origin}/filler/`));
        reg.active?.postMessage({ type: 'cache', urls });
        setOffline(true);
      }),
      () => {},
    );
  }, []);

  const apply = useCallback((p: Player, c: number) => {
    const { state, gained } = play(game, p, c);
    setGame(state);
    setRipple(new Map(gained.map((i, k) => [i, k])));
    setTurn(p === 1 ? 2 : 1);
    if (!isOver(state)) return;
    const you = state.score[1], bot = state.score[2];
    const key = you > bot ? 'w' : bot > you ? 'l' : 't';
    setStats((s) => {
      const next = { ...s, [level]: { ...s[level], [key]: s[level][key] + 1 } };
      save(STATS_KEY, next);
      return next;
    });
  }, [game, level]);

  // Bot's turn: let the player's ripple land, then think.
  useEffect(() => {
    if (turn !== 2 || isOver(game)) return;
    const id = setTimeout(() => {
      const c = botMove(game, 2, level);
      setLastBot(c);
      apply(2, c);
    }, 550);
    return () => clearTimeout(id);
  }, [game, turn, level, apply]);

  const over = isOver(game);
  const you = game.score[1];
  const bot = game.score[2];
  const result = !over ? null : you > bot ? 'win' : bot > you ? 'loss' : 'tie';

  const changeLevel = (l: Difficulty) => {
    setLevel(l);
    save(PREFS_KEY, { level: l, botFirst });
    start(botFirst ? 2 : 1);
    setMenu(false);
  };
  const changeFirst = (b: boolean) => {
    setBotFirst(b);
    save(PREFS_KEY, { level, botFirst: b });
    start(b ? 2 : 1);
    setMenu(false);
  };

  const legal = legalColors(game);
  const myColor = colorOf(game, 1);
  const botColor = colorOf(game, 2);
  const rec = stats[level];

  return (
    <main className="filler">
      <header className="filler-top">
        <h1>Filler</h1>
        <button className="filler-ghost" onClick={() => setMenu((m) => !m)} aria-expanded={menu}>
          {level[0].toUpperCase() + level.slice(1)} bot ▾
        </button>
      </header>

      {menu && (
        <div className="filler-menu">
          <div className="filler-menu-row">
            <span>Bot</span>
            <div className="filler-seg">
              {LEVELS.map((l) => (
                <button key={l} className={l === level ? 'on' : ''} onClick={() => changeLevel(l)}>
                  {l[0].toUpperCase() + l.slice(1)}
                </button>
              ))}
            </div>
          </div>
          <div className="filler-menu-row">
            <span>First move</span>
            <div className="filler-seg">
              <button className={!botFirst ? 'on' : ''} onClick={() => changeFirst(false)}>You</button>
              <button className={botFirst ? 'on' : ''} onClick={() => changeFirst(true)}>Bot</button>
            </div>
          </div>
          <p className="filler-note">Changing either starts a new game.</p>
        </div>
      )}

      <section className="filler-scores">
        <div className={`filler-score ${turn === 1 && !over ? 'active' : ''}`}>
          <span className="dot" style={{ background: PALETTE[myColor] }} />
          <span className="who">You</span>
          <b>{you}</b>
        </div>
        <div className={`filler-score right ${turn === 2 && !over ? 'active' : ''}`}>
          <b>{bot}</b>
          <span className="who">Bot</span>
          <span className="dot" style={{ background: PALETTE[botColor] }} />
        </div>
      </section>

      <div className="filler-board-wrap">
        <div className="filler-board" style={{ gridTemplateColumns: `repeat(${W}, 1fr)` }}>
          {Array.from({ length: N }, (_, i) => {
            const order = ripple.get(i);
            const owner = game.owner[i];
            return (
              <div
                key={`${i}-${order === undefined ? 's' : game.score[1] + game.score[2]}`}
                className={`tile ${owner ? `own p${owner}` : ''} ${order !== undefined ? 'pop' : ''} ${i === START[0] || i === START[1] ? 'home' : ''}`}
                style={{
                  background: owner === 1 ? OWN_YOU : owner === 2 ? OWN_BOT : PALETTE[game.color[i]],
                  animationDelay: order !== undefined ? `${Math.min(order * 28, 500)}ms` : undefined,
                }}
              />
            );
          })}
        </div>

        {result && (
          <div className="filler-over">
            <div className="filler-card">
              <div className="big">{result === 'win' ? 'You win!' : result === 'loss' ? 'Bot wins' : 'Tie game'}</div>
              <div className="final">{you} – {bot}</div>
              <div className="rec">
                {level[0].toUpperCase() + level.slice(1)} record: {rec.w}W · {rec.l}L{rec.t ? ` · ${rec.t}T` : ''}
              </div>
              <button className="filler-primary" onClick={() => start(botFirst ? 2 : 1)}>Play again</button>
            </div>
          </div>
        )}
      </div>

      <p className="filler-status" aria-live="polite">
        {over
          ? ' '
          : turn === 2
            ? 'Bot is thinking…'
            : lastBot !== null
              ? `Bot picked ${NAMES[lastBot].toLowerCase()}. Your turn.`
              : 'Your turn. Pick a color.'}
      </p>

      <nav className="filler-picker" aria-label="Colors">
        {Array.from({ length: COLOR_COUNT }, (_, c) => {
          const allowed = legal.includes(c);
          const tag = c === myColor ? 'You' : c === botColor ? 'Bot' : '';
          const gain = allowed && turn === 1 && !over ? play(game, 1, c).gained.length : 0;
          return (
            <button
              key={c}
              className={`swatch ${allowed ? '' : 'off'}`}
              style={{ background: PALETTE[c] }}
              disabled={!allowed || turn !== 1 || over}
              onClick={() => apply(1, c)}
              aria-label={`${NAMES[c]}${tag ? ` (${tag.toLowerCase()})` : ''}`}
            >
              {tag ? <span className="tag">{tag}</span> : gain > 0 ? <span className="gain">+{gain}</span> : null}
            </button>
          );
        })}
      </nav>

      <footer className="filler-foot">
        <button className="filler-ghost" onClick={() => start(botFirst ? 2 : 1)}>New game</button>
        <span>
          {rec.w}W · {rec.l}L{rec.t ? ` · ${rec.t}T` : ''}
          {offline ? ' · Works offline' : ''}
        </span>
      </footer>
    </main>
  );
}
