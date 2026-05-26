/** Icon-only square button (9×9) — dark zinc style */
export const BTN_ICON =
  'flex items-center justify-center w-9 h-9 rounded-md bg-zinc-950 border border-zinc-800 text-zinc-400 hover:text-zinc-200 hover:border-zinc-600 transition-colors disabled:opacity-30 disabled:cursor-not-allowed';

/** Text/label button with horizontal padding — dark zinc style */
export const BTN_TEXT =
  'flex items-center gap-1 h-9 px-2.5 rounded-md text-[10px] font-medium border transition-colors disabled:opacity-30 disabled:cursor-not-allowed';

/** Inline style object for the dot-grid page background */
export const GRID_BG_STYLE: React.CSSProperties = {
  backgroundImage:
    'linear-gradient(rgba(255,255,255,0.07) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.07) 1px, transparent 1px)',
  backgroundSize: '96px 96px',
};
