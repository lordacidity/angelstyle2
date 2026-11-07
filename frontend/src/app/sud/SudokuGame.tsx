'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { generate, fromString, toString, PEERS, type Difficulty, type Grid, type Puzzle } from './engine';

// ── Saved state ──────────────────────────────────────────────────────────────

const SAVE_KEY = 'sud.game.v1';
const NEXT_KEY = 'sud.next.v1';
const PREF_KEY = 'sud.prefs.v1';

interface Saved {
  givens: string;
  solution: string;
  difficulty: Difficulty;
  cells: string;
  notes: number[];
  elapsed: number;
}

function load<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}
function save(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* private mode */ }
}

type Mode = 'fill' | 'note';
type Snapshot = { cells: Grid; notes: number[] };

const bit = (d: number) => 1 << (d - 1);
const HOLD_MS = 380;

/** A puzzle for `difficulty`: the one made ahead of time if there is one,
 *  otherwise made now (a few milliseconds, tens at worst). */
function takePuzzle(difficulty: Difficulty): Puzzle {
  const bank = load<Record<string, { givens: string; solution: string }>>(NEXT_KEY) ?? {};
  const ready = bank[difficulty];
  if (ready) {
    delete bank[difficulty];
    save(NEXT_KEY, bank);
    return { givens: fromString(ready.givens), solution: fromString(ready.solution), difficulty };
  }
  return generate(difficulty);
}

/** Makes the next puzzle of each difficulty while the page is idle, so New is instant. */
function stockUp() {
  const run = () => {
    const bank = load<Record<string, { givens: string; solution: string }>>(NEXT_KEY) ?? {};
    let changed = false;
    for (const d of ['hard', 'expert'] as Difficulty[]) {
      if (bank[d]) continue;
      const p = generate(d);
      bank[d] = { givens: toString(p.givens), solution: toString(p.solution) };
      changed = true;
    }
    if (changed) save(NEXT_KEY, bank);
  };
  if ('requestIdleCallback' in window) (window as Window & { requestIdleCallback: (cb: () => void) => void }).requestIdleCallback(run);
  else setTimeout(run, 500);
}

function fresh(difficulty: Difficulty): { puzzle: Puzzle; cells: Grid; notes: number[] } {
  const puzzle = takePuzzle(difficulty);
  return { puzzle, cells: puzzle.givens.slice(), notes: new Array(81).fill(0) };
}

function fmt(seconds: number) {
  const m = Math.floor(seconds / 60), s = seconds % 60;
  return `${m}:${s < 10 ? '0' : ''}${s}`;
}

// ── Game ─────────────────────────────────────────────────────────────────────

export default function SudokuGame() {
  const [state] = useState(() => {
    const saved = load<Saved>(SAVE_KEY);
    const prefs = load<{ difficulty: Difficulty; mode: Mode }>(PREF_KEY);
    if (saved) {
      return {
        puzzle: { givens: fromString(saved.givens), solution: fromString(saved.solution), difficulty: saved.difficulty } as Puzzle,
        cells: fromString(saved.cells),
        notes: saved.notes,
        elapsed: saved.elapsed,
        mode: prefs?.mode ?? 'fill',
      };
    }
    const f = fresh(prefs?.difficulty ?? 'hard');
    return { ...f, elapsed: 0, mode: prefs?.mode ?? ('fill' as Mode) };
  });

  const [puzzle, setPuzzle] = useState<Puzzle>(state.puzzle);
  const [cells, setCells] = useState<Grid>(state.cells);
  const [notes, setNotes] = useState<number[]>(state.notes);
  const [elapsed, setElapsed] = useState(state.elapsed);
  const [mode, setMode] = useState<Mode>(state.mode);
  const [selected, setSelected] = useState<number | null>(null);
  const [highlight, setHighlight] = useState<number | null>(null);
  const [locked, setLocked] = useState<number | null>(null);
  const [history, setHistory] = useState<Snapshot[]>([]);
  const [confirmNew, setConfirmNew] = useState(false);

  const givens = puzzle.givens;
  const full = useMemo(() => cells.every((v) => v), [cells]);
  // Only ever judged once the whole grid is filled in. Until then a wrong
  // digit looks exactly like a right one.
  const solved = useMemo(() => full && cells.every((v, i) => v === puzzle.solution[i]), [full, cells, puzzle]);
  const wrong = useMemo(() => (full && !solved ? cells.map((v, i) => v !== puzzle.solution[i]) : null), [full, solved, cells, puzzle]);
  const started = useMemo(() => cells.some((v, i) => v && !givens[i]) || notes.some((n) => n), [cells, notes, givens]);

  // Persist on every change.
  useEffect(() => {
    save(SAVE_KEY, {
      givens: toString(givens), solution: toString(puzzle.solution), difficulty: puzzle.difficulty,
      cells: toString(cells), notes, elapsed,
    } satisfies Saved);
  }, [givens, puzzle, cells, notes, elapsed]);
  useEffect(() => { save(PREF_KEY, { difficulty: puzzle.difficulty, mode }); }, [puzzle.difficulty, mode]);

  // Clock: runs while the puzzle is open and the tab is visible.
  useEffect(() => {
    if (solved) return;
    const id = setInterval(() => { if (document.visibilityState === 'visible') setElapsed((e) => e + 1); }, 1000);
    return () => clearInterval(id);
  }, [solved]);

  // Offline: register the worker and hand it the files this visit already
  // loaded (the game's own lazy chunk among them), then stock the puzzle bank.
  useEffect(() => {
    stockUp();
    if (!('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sud-sw.js', { scope: '/sud' }).then(
      () => navigator.serviceWorker.ready.then((reg) => {
        const urls = performance.getEntriesByType('resource')
          .map((e) => e.name)
          .filter((u) => u.startsWith(`${location.origin}/_next/static/`) || u.startsWith(`${location.origin}/sud/`));
        reg.active?.postMessage({ type: 'cache', urls });
      }),
      () => {},
    );
  }, []);

  const pushHistory = useCallback(() => {
    setHistory((h) => [...h.slice(-199), { cells, notes }]);
  }, [cells, notes]);

  /** Puts digit d into cell i by the current mode. */
  const enter = useCallback((i: number, d: number) => {
    if (givens[i] || solved) return;
    pushHistory();
    if (mode === 'note') {
      if (cells[i]) return;
      setNotes((n) => { const next = n.slice(); next[i] ^= bit(d); return next; });
      return;
    }
    const next = cells.slice();
    next[i] = next[i] === d ? 0 : d;
    setCells(next);
    // A placed digit clears that digit's notes in the cells it sees.
    setNotes((n) => {
      const nn = n.slice();
      nn[i] = 0;
      if (cells[i] !== d) for (const p of PEERS[i]) nn[p] &= ~bit(d);
      return nn;
    });
    // The moment the last cell goes in right, let go of the lock and selection.
    if (next.every((v, k) => v === puzzle.solution[k])) { setLocked(null); setSelected(null); }
  }, [givens, solved, mode, cells, puzzle, pushHistory]);

  const erase = useCallback((i: number) => {
    if (givens[i] || solved || (!cells[i] && !notes[i])) return;
    pushHistory();
    setCells((c) => { const next = c.slice(); next[i] = 0; return next; });
    setNotes((n) => { const next = n.slice(); next[i] = 0; return next; });
  }, [givens, solved, cells, notes, pushHistory]);

  const undo = useCallback(() => {
    setHistory((h) => {
      const last = h[h.length - 1];
      if (!last) return h;
      setCells(last.cells);
      setNotes(last.notes);
      return h.slice(0, -1);
    });
  }, []);

  const onCell = useCallback((i: number) => {
    setSelected(i);
    if (locked !== null && !givens[i] && !solved) {
      enter(i, locked);
      setHighlight(locked);
      return;
    }
    if (cells[i]) setHighlight(cells[i]);
  }, [locked, givens, solved, enter, cells]);

  /** A tap on the pad. */
  const onDigit = useCallback((d: number) => {
    if (locked !== null) {
      // Tapping the locked digit frees it; tapping another moves the lock.
      setLocked(locked === d ? null : d);
      setHighlight(d);
      return;
    }
    setHighlight((h) => (selected !== null && !givens[selected] && !solved ? d : h === d ? null : d));
    if (selected !== null) enter(selected, d);
  }, [locked, selected, givens, solved, enter]);

  const newGame = useCallback((difficulty: Difficulty) => {
    const f = fresh(difficulty);
    setPuzzle(f.puzzle);
    setCells(f.cells);
    setNotes(f.notes);
    setElapsed(0);
    setSelected(null);
    setHighlight(null);
    setLocked(null);
    setHistory([]);
    setConfirmNew(false);
    stockUp();
  }, []);

  const askNew = useCallback((difficulty: Difficulty) => {
    if (!started || solved) { newGame(difficulty); return; }
    if (confirmNew) { newGame(difficulty); return; }
    setConfirmNew(true);
    setTimeout(() => setConfirmNew(false), 2500);
  }, [started, solved, confirmNew, newGame]);

  // Keyboard: digits enter, arrows move, backspace erases, N toggles notes.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key >= '1' && e.key <= '9') { onDigit(Number(e.key)); e.preventDefault(); return; }
      if (e.key === 'Backspace' || e.key === 'Delete' || e.key === '0') { if (selected !== null) erase(selected); e.preventDefault(); return; }
      if (e.key === 'n' || e.key === 'N') { setMode((m) => (m === 'fill' ? 'note' : 'fill')); return; }
      if (e.key === 'z' || e.key === 'Z') { undo(); return; }
      if (e.key === 'Escape') { setLocked(null); setHighlight(null); return; }
      const moves: Record<string, number> = { ArrowUp: -9, ArrowDown: 9, ArrowLeft: -1, ArrowRight: 1 };
      if (e.key in moves) {
        e.preventDefault();
        setSelected((s) => {
          const from = s ?? 0;
          const to = from + moves[e.key];
          if (to < 0 || to > 80) return from;
          if (moves[e.key] === -1 && from % 9 === 0) return from;
          if (moves[e.key] === 1 && from % 9 === 8) return from;
          return to;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onDigit, erase, selected, undo]);

  // Pad buttons: a tap enters, a hold locks.
  const hold = useRef<{ timer: number; fired: boolean } | null>(null);
  const padDown = (d: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    const timer = window.setTimeout(() => {
      if (hold.current) hold.current.fired = true;
      setLocked((l) => (l === d ? null : d));
      setHighlight(d);
      navigator.vibrate?.(12);
    }, HOLD_MS);
    hold.current = { timer, fired: false };
  };
  const padUp = (d: number) => (e: React.PointerEvent) => {
    e.preventDefault();
    const h = hold.current;
    hold.current = null;
    if (!h) return;
    clearTimeout(h.timer);
    if (!h.fired) onDigit(d);
  };
  const padCancel = () => {
    if (hold.current) clearTimeout(hold.current.timer);
    hold.current = null;
  };

  const counts = useMemo(() => {
    const n = new Array(10).fill(0);
    for (const v of cells) n[v]++;
    return n;
  }, [cells]);

  const selRow = selected === null ? -1 : Math.floor(selected / 9);
  const selCol = selected === null ? -1 : selected % 9;
  const selBox = selected === null ? -1 : Math.floor(selRow / 3) * 3 + Math.floor(selCol / 3);

  return (
    <div className="sud" data-locked={locked !== null || undefined}>
      <header className="sud-top">
        <div className="sud-seg" role="tablist" aria-label="Difficulty">
          {(['hard', 'expert'] as Difficulty[]).map((d) => (
            <button key={d} role="tab" aria-selected={puzzle.difficulty === d} className={puzzle.difficulty === d ? 'on' : ''}
              onClick={() => puzzle.difficulty !== d && askNew(d)}>
              {d === 'hard' ? 'Hard' : 'Expert'}
            </button>
          ))}
        </div>
        <div className="sud-clock" aria-live="off">{fmt(elapsed)}</div>
        <button className={`sud-new${confirmNew ? ' sure' : ''}`} onClick={() => askNew(puzzle.difficulty)}>
          {confirmNew ? 'Sure?' : 'New'}
        </button>
      </header>

      <div className={`sud-status${solved ? ' solved' : wrong ? ' wrong' : ''}`} aria-live="polite">
        {solved ? `Solved in ${fmt(elapsed)}` : wrong ? 'Something is off' : ''}
      </div>

      <div className="sud-board" role="grid" aria-label="Sudoku board">
        {cells.map((v, i) => {
          const r = Math.floor(i / 9), c = i % 9, b = Math.floor(r / 3) * 3 + Math.floor(c / 3);
          const cls = ['sud-cell'];
          if (givens[i]) cls.push('given');
          if (i === selected) cls.push('sel');
          else if (selected !== null && (r === selRow || c === selCol || b === selBox)) cls.push('near');
          if (highlight !== null && v === highlight) cls.push('hi');
          if (wrong?.[i]) cls.push('bad');
          if (c % 3 === 2 && c !== 8) cls.push('br');
          if (r % 3 === 2 && r !== 8) cls.push('bb');
          return (
            <button key={i} role="gridcell" className={cls.join(' ')} onPointerDown={(e) => { e.preventDefault(); onCell(i); }}
              aria-label={`Row ${r + 1} column ${c + 1}${v ? `, ${v}` : ''}`}>
              {v ? (
                <span className="sud-v">{v}</span>
              ) : notes[i] ? (
                <span className="sud-notes">
                  {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
                    <i key={d} className={notes[i] & bit(d) ? (highlight === d ? 'on hi' : 'on') : ''}>{notes[i] & bit(d) ? d : ''}</i>
                  ))}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>

      <div className="sud-tools">
        <div className="sud-seg" role="tablist" aria-label="Entry mode">
          <button role="tab" aria-selected={mode === 'fill'} className={mode === 'fill' ? 'on' : ''} onClick={() => setMode('fill')}>Fill</button>
          <button role="tab" aria-selected={mode === 'note'} className={mode === 'note' ? 'on' : ''} onClick={() => setMode('note')}>Note</button>
        </div>
        <div className="sud-seg">
          <button onClick={undo} disabled={!history.length}>Undo</button>
          <button onClick={() => selected !== null && erase(selected)} disabled={selected === null || !!givens[selected] || (!cells[selected] && !notes[selected])}>Erase</button>
        </div>
      </div>

      <div className="sud-pad" aria-label="Digits">
        {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((d) => (
          <button key={d}
            className={`sud-key${locked === d ? ' locked' : ''}${highlight === d ? ' hi' : ''}${counts[d] >= 9 ? ' done' : ''}`}
            onPointerDown={padDown(d)} onPointerUp={padUp(d)} onPointerCancel={padCancel} onPointerLeave={padCancel}
            onContextMenu={(e) => e.preventDefault()}
            aria-label={`${d}${locked === d ? ', locked' : ''}`} aria-pressed={locked === d}>
            {d}
          </button>
        ))}
      </div>
      <p className="sud-hint">{locked !== null ? `${locked} is locked. Tap cells to place it; tap ${locked} again to let go.` : 'Hold a number to lock it.'}</p>
    </div>
  );
}
