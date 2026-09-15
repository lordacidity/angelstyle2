// Palette, type stacks and the wordmark helper shared by every X Photo
// generator — the price strip (./render.ts) and the 3:2 cards (./card.ts).
// One place to tune, so the cards can't drift apart. Canvas can't read CSS
// variables, so these are the resolved Pauv theme values.

export type CardTheme = 'dark' | 'light';

export interface CardPalette {
  card: string;
  hairline: string;
  logo: string;
  primary: string;
  secondary: string;
  muted: string;
  up: string;
  down: string;
}

// Mirrors the Pauv app's theme tokens (background, border-default,
// text-primary/secondary/muted, chart-up/down). The wordmark is grey on dark
// and black on light, same as the app's per-theme logo files.
export const PALETTES: Record<CardTheme, CardPalette> = {
  dark: {
    card: '#0A0A0A',
    hairline: '#27272A',
    logo: '#A1A1AA',
    primary: '#FFFFFF',
    secondary: '#A1A1AA',
    muted: '#71717A',
    up: '#0CDF9D',
    down: '#FF4B4B',
  },
  light: {
    card: '#FFFFFF',
    hairline: '#D4D4D8',
    logo: '#0A0A0A',
    primary: '#0A0A0A',
    secondary: '#52525B',
    muted: '#71717A',
    up: '#03C88C',
    down: '#DC2626',
  },
};

// The strip is dark only (it is drawn straight onto X's dark timeline).
export const COLOR_CARD = PALETTES.dark.card;
export const COLOR_LOGO = PALETTES.dark.logo;
export const COLOR_WHITE = PALETTES.dark.primary;
export const COLOR_MUTED = PALETTES.dark.muted;
export const COLOR_UP = PALETTES.dark.up;
export const COLOR_DOWN = PALETTES.dark.down;

// Pulled from Google Fonts by family name (see loadFonts in XPhotoSection):
// next/font registers the app's own copies under hashed names the canvas
// can't address.
export const SANS = '"Inter", "Geist", system-ui, -apple-system, "Segoe UI", sans-serif';
export const MONO = '"JetBrains Mono", "Geist Mono", ui-monospace, SFMono-Regular, Menlo, monospace';

// Recolour the white wordmark: draw it on an offscreen canvas at the target
// pixel size, then 'source-in' fill so only the logo's own pixels take the tint.
export function drawTintedLogo(ctx: CanvasRenderingContext2D, logo: HTMLImageElement, x: number, y: number, w: number, h: number, color: string) {
  const s = ctx.getTransform().a || 1;
  const pw = Math.max(1, Math.round(w * s));
  const ph = Math.max(1, Math.round(h * s));
  const off = document.createElement('canvas');
  off.width = pw;
  off.height = ph;
  const octx = off.getContext('2d');
  if (!octx) return;
  octx.drawImage(logo, 0, 0, pw, ph);
  octx.globalCompositeOperation = 'source-in';
  octx.fillStyle = color;
  octx.fillRect(0, 0, pw, ph);
  ctx.drawImage(off, x, y, w, h);
}
