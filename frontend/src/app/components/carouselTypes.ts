// ── Shared types, interfaces and constants for the Carousel feature ──────────

export const MAX_FONT = 88;
export const SUB_MAX  = 52;

export interface CarouselCanvasRef {
  startDownload: () => Promise<void>;
  cancelExport: () => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetTransform: () => void;
  setZoom: (s: number) => void;
  enterCropMode: () => void;
  toggleSplit: () => void;
  toggleBlur: () => void;
  // Video control (for VideoControlsBar in video sub-mode)
  play: () => void;
  pause: () => void;
  seekTo: (t: number) => void;
  setTrimRange: (start: number, end: number) => void;
  resetTrim: () => void;
  resetBox: () => void;
  centerBox: () => void;
  // Mute the source video's audio — drops the audio track from the export and
  // silences live preview. Persisted per-canvas (one instance per carousel page).
  setMuted: (muted: boolean) => void;
  getVideoElement: () => HTMLVideoElement | null;
  getTrimState: () => { trimStart: number; trimEnd: number; duration: number; muted?: boolean };
}

export type CarouselTextAlign  = 'left' | 'center' | 'right' | 'justify';
export type CarouselFontWeight = 300 | 400 | 500 | 600 | 700 | 900;

export const CAROUSEL_FONTS = [
  // Geometric / Modern Sans
  { label: 'Inter',                css: 'Inter, sans-serif',                          google: 'Inter:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Outfit',               css: '"Outfit", sans-serif',                       google: 'Outfit:wght@300;400;500;600;700;800;900' },
  { label: 'Poppins',              css: '"Poppins", sans-serif',                      google: 'Poppins:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Montserrat',           css: '"Montserrat", sans-serif',                   google: 'Montserrat:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Raleway',              css: '"Raleway", sans-serif',                      google: 'Raleway:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Plus Jakarta Sans',    css: '"Plus Jakarta Sans", sans-serif',            google: 'Plus+Jakarta+Sans:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;1,200;1,300;1,400;1,500;1,600;1,700;1,800' },
  { label: 'Figtree',              css: '"Figtree", sans-serif',                      google: 'Figtree:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Space Grotesk',        css: '"Space Grotesk", sans-serif',                google: 'Space+Grotesk:wght@300;400;500;600;700' },
  { label: 'Urbanist',             css: '"Urbanist", sans-serif',                     google: 'Urbanist:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Syne',                 css: '"Syne", sans-serif',                         google: 'Syne:wght@400;500;600;700;800' },
  { label: 'Unbounded',            css: '"Unbounded", sans-serif',                    google: 'Unbounded:wght@200;300;400;500;600;700;800;900' },
  // Humanist Sans
  { label: 'Open Sans',            css: '"Open Sans", sans-serif',                    google: 'Open+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400;1,500;1,600;1,700;1,800' },
  { label: 'Lato',                 css: '"Lato", sans-serif',                         google: 'Lato:ital,wght@0,300;0,400;0,700;0,900;1,300;1,400;1,700;1,900' },
  { label: 'Nunito',               css: '"Nunito", sans-serif',                       google: 'Nunito:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Work Sans',            css: '"Work Sans", sans-serif',                    google: 'Work+Sans:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Roboto',               css: '"Roboto", sans-serif',                       google: 'Roboto:ital,wght@0,300;0,400;0,500;0,700;0,900;1,300;1,400;1,500;1,700;1,900' },
  { label: 'DM Sans',              css: '"DM Sans", sans-serif',                      google: 'DM+Sans:ital,opsz,wght@0,9..40,300;0,9..40,400;0,9..40,500;0,9..40,600;0,9..40,700;0,9..40,800;0,9..40,900;1,9..40,300;1,9..40,400;1,9..40,500;1,9..40,600;1,9..40,700;1,9..40,800;1,9..40,900' },
  { label: 'Manrope',              css: '"Manrope", sans-serif',                      google: 'Manrope:wght@200;300;400;500;600;700;800' },
  { label: 'Karla',                css: '"Karla", sans-serif',                        google: 'Karla:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;1,300;1,400;1,500;1,600;1,700;1,800' },
  { label: 'Mulish',               css: '"Mulish", sans-serif',                       google: 'Mulish:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Jost',                 css: '"Jost", sans-serif',                         google: 'Jost:ital,wght@0,100;0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,100;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  // Grotesque / Neutral
  { label: 'Barlow',               css: '"Barlow", sans-serif',                       google: 'Barlow:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Archivo',              css: '"Archivo", sans-serif',                      google: 'Archivo:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Source Sans 3',        css: '"Source Sans 3", sans-serif',                google: 'Source+Sans+3:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'PT Sans',              css: '"PT Sans", sans-serif',                      google: 'PT+Sans:ital,wght@0,400;0,700;1,400;1,700' },
  { label: 'Overpass',             css: '"Overpass", sans-serif',                     google: 'Overpass:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  // Display / Condensed
  { label: 'Oswald',               css: '"Oswald", sans-serif',                       google: 'Oswald:wght@200;300;400;500;600;700' },
  { label: 'Bebas Neue',           css: '"Bebas Neue", sans-serif',                   google: 'Bebas+Neue' },
  { label: 'Anton',                css: '"Anton", sans-serif',                        google: 'Anton' },
  { label: 'Barlow Condensed',     css: '"Barlow Condensed", sans-serif',             google: 'Barlow+Condensed:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Fjalla One',           css: '"Fjalla One", sans-serif',                   google: 'Fjalla+One' },
  { label: 'Russo One',            css: '"Russo One", sans-serif',                    google: 'Russo+One' },
  { label: 'Black Han Sans',       css: '"Black Han Sans", sans-serif',               google: 'Black+Han+Sans' },
  { label: 'Exo 2',                css: '"Exo 2", sans-serif',                        google: 'Exo+2:ital,wght@0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Teko',                 css: '"Teko", sans-serif',                         google: 'Teko:wght@300;400;500;600;700' },
  { label: 'Big Shoulders Display',css: '"Big Shoulders Display", sans-serif',        google: 'Big+Shoulders+Display:wght@100;200;300;400;500;600;700;800;900' },
  { label: 'Orbitron',             css: '"Orbitron", sans-serif',                     google: 'Orbitron:wght@400;500;600;700;800;900' },
  { label: 'Chakra Petch',         css: '"Chakra Petch", sans-serif',                 google: 'Chakra+Petch:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700' },
  // Display — Bold / Expressive
  { label: 'Abril Fatface',        css: '"Abril Fatface", cursive',                   google: 'Abril+Fatface' },
  { label: 'Righteous',            css: '"Righteous", sans-serif',                    google: 'Righteous' },
  { label: 'Paytone One',          css: '"Paytone One", sans-serif',                  google: 'Paytone+One' },
  { label: 'Passion One',          css: '"Passion One", sans-serif',                  google: 'Passion+One:wght@400;700;900' },
  { label: 'Boogaloo',             css: '"Boogaloo", sans-serif',                     google: 'Boogaloo' },
  { label: 'Lilita One',           css: '"Lilita One", sans-serif',                   google: 'Lilita+One' },
  // Serif — Elegant
  { label: 'Playfair Display',     css: '"Playfair Display", serif',                  google: 'Playfair+Display:ital,wght@0,400;0,500;0,600;0,700;0,800;0,900;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Merriweather',         css: '"Merriweather", serif',                      google: 'Merriweather:ital,wght@0,300;0,400;0,700;0,900;1,300;1,400;1,700;1,900' },
  { label: 'Lora',                 css: '"Lora", serif',                              google: 'Lora:ital,wght@0,400;0,500;0,600;0,700;1,400;1,500;1,600;1,700' },
  { label: 'EB Garamond',          css: '"EB Garamond", serif',                       google: 'EB+Garamond:ital,wght@0,400;0,500;0,600;0,700;0,800;1,400;1,500;1,600;1,700;1,800' },
  { label: 'Cormorant',            css: '"Cormorant Garamond", serif',                google: 'Cormorant+Garamond:ital,wght@0,300;0,400;0,500;0,600;0,700;1,300;1,400;1,500;1,600;1,700' },
  { label: 'Libre Baskerville',    css: '"Libre Baskerville", serif',                 google: 'Libre+Baskerville:ital,wght@0,400;0,700;1,400' },
  { label: 'Crimson Pro',          css: '"Crimson Pro", serif',                       google: 'Crimson+Pro:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;0,900;1,200;1,300;1,400;1,500;1,600;1,700;1,800;1,900' },
  { label: 'Spectral',             css: '"Spectral", serif',                          google: 'Spectral:ital,wght@0,200;0,300;0,400;0,500;0,600;0,700;0,800;1,200;1,300;1,400;1,500;1,600;1,700;1,800' },
  { label: 'Domine',               css: '"Domine", serif',                            google: 'Domine:wght@400;500;600;700' },
  // Serif — Display
  { label: 'Bodoni Moda',          css: '"Bodoni Moda", serif',                       google: 'Bodoni+Moda:ital,opsz,wght@0,6..96,400;0,6..96,500;0,6..96,600;0,6..96,700;0,6..96,800;0,6..96,900;1,6..96,400;1,6..96,500;1,6..96,600;1,6..96,700;1,6..96,800;1,6..96,900' },
  { label: 'Cinzel',               css: '"Cinzel", serif',                            google: 'Cinzel:wght@400;500;600;700;800;900' },
  { label: 'DM Serif Display',     css: '"DM Serif Display", serif',                  google: 'DM+Serif+Display:ital,wght@0,400;1,400' },
  // Script / Decorative
  { label: 'Dancing Script',       css: '"Dancing Script", cursive',                  google: 'Dancing+Script:wght@400;500;600;700' },
  { label: 'Pacifico',             css: '"Pacifico", cursive',                        google: 'Pacifico' },
  { label: 'Lobster',              css: '"Lobster", cursive',                         google: 'Lobster' },
  // System
  { label: 'Georgia',              css: 'Georgia, serif',                             google: null },
  { label: 'Impact',               css: 'Impact, sans-serif',                         google: null },
] as const;

export type CarouselFontLabel = typeof CAROUSEL_FONTS[number]['label'];

export const CAROUSEL_WEIGHTS = [
  { label: 'Light',   value: 300 as CarouselFontWeight },
  { label: 'Regular', value: 400 as CarouselFontWeight },
  { label: 'Medium',  value: 500 as CarouselFontWeight },
  { label: 'Semi',    value: 600 as CarouselFontWeight },
  { label: 'Bold',    value: 700 as CarouselFontWeight },
  { label: 'XBold',   value: 900 as CarouselFontWeight },
];

// ── Tag system ────────────────────────────────────────────────────────────────

export interface ShadowStyle {
  enabled:  boolean;
  color:    string;
  blur:     number;
  offsetX:  number;
  offsetY:  number;
  opacity:  number;
  lift:     number;
}
export function defaultShadowStyle(): ShadowStyle {
  return { enabled: false, color: '#000000', blur: 16, offsetX: 0, offsetY: 6, opacity: 60, lift: 0 };
}

export interface TagStyle {
  bgColor:       string;
  bgOpacity:     number;   // 0-100
  borderColor:   string;
  borderWidth:   number;   // 0-8
  borderOpacity: number;   // 0-100
  cornerRadius:  number;   // 0-40
  textColor:     string;
  fontSize:      number;   // 8-36
  fontWeight:    CarouselFontWeight;
  italic:        boolean;
  fontLabel:     CarouselFontLabel;
  paddingX:      number;   // 0-32
  paddingY:      number;   // 0-20
  letterSpacing: number;   // 0-20 px
  textCase:      'none' | 'upper' | 'smallcaps';
  shadow?:       ShadowStyle;
}

export function defaultTagStyle(): TagStyle {
  return {
    bgColor: '#dc2626', bgOpacity: 100,
    borderColor: '#ffffff', borderWidth: 0, borderOpacity: 100,
    cornerRadius: 4,
    textColor: '#ffffff',
    fontSize: 13, fontWeight: 700, italic: false, fontLabel: 'Inter',
    paddingX: 10, paddingY: 4,
    letterSpacing: 0, textCase: 'none',
  };
}

export interface TagPreset { id: string; label: string; initStyle: Partial<TagStyle> }

export const TAG_PRESETS: TagPreset[] = [
  { id: 'breaking',   label: 'BREAKING',   initStyle: { bgColor: '#dc2626', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 3 } },
  { id: 'trending',   label: 'TRENDING',   initStyle: { bgColor: '#ea580c', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 3 } },
  { id: 'live',       label: '● LIVE',     initStyle: { bgColor: '#dc2626', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 20 } },
  { id: 'exclusive',  label: 'EXCLUSIVE',  initStyle: { bgColor: '#000000', bgOpacity: 90,  textColor: '#ffffff', fontWeight: 700, cornerRadius: 3, borderColor: '#ffffff', borderWidth: 1, borderOpacity: 60 } },
  { id: 'developing', label: 'DEVELOPING', initStyle: { bgColor: '#fbbf24', bgOpacity: 100, textColor: '#000000', fontWeight: 700, cornerRadius: 3 } },
  { id: 'new',        label: 'NEWS',       initStyle: { bgColor: '#16a34a', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 3 } },
  { id: 'alert',      label: 'ALERT',      initStyle: { bgColor: '#7c3aed', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 3 } },
  { id: 'update',     label: 'UPDATE',     initStyle: { bgColor: '#0284c7', bgOpacity: 100, textColor: '#ffffff', fontWeight: 700, cornerRadius: 3 } },
  { id: 'opinion',    label: 'OPINION',    initStyle: { bgColor: '#00000000', bgOpacity: 0,  textColor: '#ffffff', fontWeight: 700, cornerRadius: 3, borderColor: '#ffffff', borderWidth: 1, borderOpacity: 100 } },
];

export type SwipeArrowType = 'line' | 'triangle' | 'chevron' | 'double-chevron' | 'curved';
export type SwipeLayout = 'text-arrow' | 'arrow-text' | 'stacked' | 'arrow-only' | 'text-only';
export type SwipeDirection = 'left' | 'right';

export interface SwipeStyle {
  text: string;
  allCaps: boolean;
  fontLabel: CarouselFontLabel;
  fontWeight: CarouselFontWeight;
  fontSize: number;        // canvas px
  textColor: string;
  letterSpacing: number;   // canvas px
  arrowType: SwipeArrowType;
  arrowLength: number;     // canvas px (line length, 0 = head only)
  arrowColor: string;
  arrowWeight: number;     // stroke width canvas px
  arrowHeadSize: number;   // half-height of arrowhead canvas px
  direction: SwipeDirection;
  layout: SwipeLayout;
  gap: number;             // canvas px between text and arrow
  opacity: number;         // 0-100
  shadow?: ShadowStyle;
}

export function defaultSwipeStyle(): SwipeStyle {
  return {
    text: 'SWIPE', allCaps: true,
    fontLabel: 'Inter', fontWeight: 700,
    fontSize: 22, textColor: '#ffffff', letterSpacing: 3,
    arrowType: 'line', arrowLength: 60, arrowColor: '#ffffff',
    arrowWeight: 2, arrowHeadSize: 10,
    direction: 'right', layout: 'text-arrow', gap: 12, opacity: 100,
  };
}

export const SWIPE_PRESETS: { id: string; label: string; style: SwipeStyle }[] = [
  { id: 'swipe-right',      label: 'Swipe →',         style: { text: 'SWIPE', allCaps: true, fontLabel: 'Inter', fontWeight: 700, fontSize: 22, textColor: '#ffffff', letterSpacing: 3, arrowType: 'line', arrowLength: 55, arrowColor: '#ffffff', arrowWeight: 2, arrowHeadSize: 10, direction: 'right', layout: 'text-arrow', gap: 12, opacity: 100 } },
  { id: 'swipe-left',       label: '← Swipe',         style: { text: 'SWIPE', allCaps: true, fontLabel: 'Inter', fontWeight: 700, fontSize: 22, textColor: '#ffffff', letterSpacing: 3, arrowType: 'line', arrowLength: 55, arrowColor: '#ffffff', arrowWeight: 2, arrowHeadSize: 10, direction: 'left', layout: 'arrow-text', gap: 12, opacity: 100 } },
  { id: 'swipe-for-more',   label: 'Swipe for more',  style: { text: 'Swipe for more', allCaps: false, fontLabel: 'Inter', fontWeight: 400, fontSize: 17, textColor: '#a1a1aa', letterSpacing: 0, arrowType: 'chevron', arrowLength: 0, arrowColor: '#a1a1aa', arrowWeight: 1.5, arrowHeadSize: 8, direction: 'right', layout: 'text-arrow', gap: 8, opacity: 100 } },
  { id: 'swipe-to-end',     label: 'Swipe to the end', style: { text: 'Swipe to the end', allCaps: false, fontLabel: 'Inter', fontWeight: 300, fontSize: 16, textColor: '#ffffff', letterSpacing: 0, arrowType: 'chevron', arrowLength: 0, arrowColor: '#ffffff', arrowWeight: 1.5, arrowHeadSize: 8, direction: 'right', layout: 'text-arrow', gap: 6, opacity: 80 } },
  { id: 'explore-more',     label: 'Explore more',    style: { text: 'EXPLORE MORE', allCaps: true, fontLabel: 'Outfit', fontWeight: 500, fontSize: 16, textColor: '#ffffff', letterSpacing: 3, arrowType: 'line', arrowLength: 40, arrowColor: '#ffffff', arrowWeight: 1.5, arrowHeadSize: 8, direction: 'right', layout: 'text-arrow', gap: 10, opacity: 100 } },
  { id: 'double-chevron-r', label: '>>',              style: { text: '', allCaps: false, fontLabel: 'Inter', fontWeight: 400, fontSize: 18, textColor: '#ffffff', letterSpacing: 0, arrowType: 'double-chevron', arrowLength: 0, arrowColor: '#ffffff', arrowWeight: 2.5, arrowHeadSize: 18, direction: 'right', layout: 'arrow-only', gap: 0, opacity: 100 } },
  { id: 'double-chevron-l', label: '<<',              style: { text: '', allCaps: false, fontLabel: 'Inter', fontWeight: 400, fontSize: 18, textColor: '#ffffff', letterSpacing: 0, arrowType: 'double-chevron', arrowLength: 0, arrowColor: '#ffffff', arrowWeight: 2.5, arrowHeadSize: 18, direction: 'left', layout: 'arrow-only', gap: 0, opacity: 100 } },
  { id: 'long-arrow',       label: 'Long arrow',      style: { text: '', allCaps: false, fontLabel: 'Inter', fontWeight: 400, fontSize: 18, textColor: '#ffffff', letterSpacing: 0, arrowType: 'line', arrowLength: 120, arrowColor: '#ffffff', arrowWeight: 1.5, arrowHeadSize: 10, direction: 'right', layout: 'arrow-only', gap: 0, opacity: 100 } },
  { id: 'bold-swipe-left',  label: 'Bold ←',          style: { text: 'SWIPE LEFT', allCaps: true, fontLabel: 'Bebas Neue', fontWeight: 400, fontSize: 26, textColor: '#ffffff', letterSpacing: 4, arrowType: 'triangle', arrowLength: 0, arrowColor: '#ffffff', arrowWeight: 3, arrowHeadSize: 14, direction: 'left', layout: 'arrow-text', gap: 12, opacity: 100 } },
  { id: 'stacked-swipe',    label: 'Stacked',         style: { text: 'SWIPE', allCaps: true, fontLabel: 'Inter', fontWeight: 600, fontSize: 18, textColor: '#ffffff', letterSpacing: 5, arrowType: 'line', arrowLength: 60, arrowColor: '#ffffff', arrowWeight: 1.5, arrowHeadSize: 8, direction: 'right', layout: 'stacked', gap: 8, opacity: 100 } },
];

export interface TextSpan {
  text:    string;
  color?:  string;
  bold?:   boolean;
  italic?: boolean;
}

export type SlotContent = { type: 'image'; url: string };
export interface QuoteSlotContent { styleId: string }
export type LayerId = 'background' | 'circle' | 'circle2' | 'subject';

export interface SidebarElementData {
  type: 'divider' | 'tag' | 'logo' | 'quote' | 'swipe';
  id?: string;
  text?: string;
  style?: TagStyle;
  swipeStyle?: SwipeStyle;
}

export type DividerSubSlotContent =
  | { type: 'image'; url: string }
  | { type: 'tag'; text: string; style: TagStyle }
  | { type: 'swipe'; style: SwipeStyle };

export interface DividerStyleSettings {
  lineColor:      string;   // hex color
  lineOpacity:    number;   // 0-100 (primary line opacity; secondary ~64% of this)
  lineWeight:     number;   // 1-20 canvas px
  dashLen:        number;   // dashed: dash length (canvas px)
  dashGap:        number;   // dashed: gap between dashes (canvas px)
  dotSize:        number;   // dotted: dot diameter (canvas px)
  dotSpacing:     number;   // dotted: gap between dots (canvas px)
  doubleSpacing:  number;   // double / double-fade / tag-double: half-offset from center (canvas px)
  tripleSpacing:  number;   // triple: offset of outer lines from center (canvas px)
  centerWeight:   number;   // triple: center line weight (canvas px)
  dotRadius:      number;   // dot-center: dot radius (canvas px)
  dotGap:         number;   // dot-center: gap from dot edge to line start (canvas px)
  taperHeight:    number;   // taper / thick-taper: height as % of slot height (5-60)
  shortLength:    number;   // short-center: total length as % of slot width (10-90)
  waveAmplitude:  number;   // wave: amplitude as % of slot height (2-50)
  bracketWidth:   number;   // brackets: bracket arm width (canvas px)
  bracketMargin:  number;   // brackets: margin from slot edge (canvas px)
  contentGap:     number;   // tag-* / logo-*: gap between content and line ends (canvas px)
  fadeSpread:     number;   // fade dividers: 0-50 for symmetric (% each side), 0-100 for directional (% of width that fades)
  shadow?:        ShadowStyle;
}

export function defaultDividerSettings(divId?: string): DividerStyleSettings {
  return {
    lineColor:     '#ffffff',
    lineOpacity:   55,
    lineWeight:    divId === 'thick' ? 6 : 2,
    dashLen:       28,
    dashGap:       20,
    dotSize:       3,
    dotSpacing:    18,
    doubleSpacing: divId === 'tag-double' ? 10 : divId === 'double-fade' ? 7 : 8,
    tripleSpacing: 10,
    centerWeight:  5,
    dotRadius:     8,
    dotGap:        20,
    taperHeight:   divId === 'thick-taper' ? 35 : 25,
    shortLength:   33,
    waveAmplitude: 18,
    bracketWidth:  24,
    bracketMargin: 30,
    contentGap:    20,
    fadeSpread:
      divId === 'double-fade' ? 25 :
      divId === 'dashed-fade' || divId === 'taper-dashed' ? 20 :
      divId === 'logo-center-fade' || divId === 'tag-center-fade' ? 40 :
      divId === 'fade-left' || divId === 'logo-left-fade' || divId === 'tag-left-fade' ? 100 :
      30,
  };
}

export interface CarouselSettings {
  showFade: boolean;
  fadeReach: number;
  fadeIntensity: number;
  fadeFloor: number;
  showTopFade: boolean;
  topFadeReach: number;
  topFadeIntensity: number;
  topFadeFloor: number;
  fontSize: number;
  lSpacing: number;
  lHeight: number;
  fontLabel: CarouselFontLabel;
  fontWeight: CarouselFontWeight;
  italic: boolean;
  textAlign: CarouselTextAlign;
  allCaps: boolean;
  subFontSize: number;
  subLSpacing: number;
  subLHeight: number;
  subFontLabel: CarouselFontLabel;
  subFontWeight: CarouselFontWeight;
  subItalic: boolean;
  subTextAlign: CarouselTextAlign;
  subAllCaps: boolean;
  headSubGap: number;
  aboveLogoGap: number;
  logoOpacity: number;
  logoScale: number;
  logoCornerRadius: number;
  contentPadding: number;
  tagStyle: TagStyle;
  tagSlots:       ({ text: string; style: TagStyle } | null)[];
  tagSlotAligns?:  ('left' | 'center' | 'right')[];
  logoSlotAligns?: ('left' | 'center' | 'right')[];
  // Zone-level independent slots: 9 entries, index = row*3 + zone (0=left,1=center,2=right)
  tagZoneSlots?:   ({ text: string; style: TagStyle } | null)[];
  quoteZoneSlots?: (string | null)[];
  zoneLogoSlots?:  (string | null)[];      // 9 entries — logo URL per zone, null = empty
  logoRowSlots?:   (string | null)[];     // 3 entries — logo URL per row slot, null = empty
  swipeZoneSlots?: (SwipeStyle | null)[];  // 9 entries, row*3+zone
  bgBlurEnabled:  boolean;
  bgBlurAmount:   number;
  bgDarkenAmount: number;
  layerOrder:     LayerId[];
  circleBorderWidth:   number;
  circleBorderColor:   string;
  circleBorderOpacity: number;
  circleShadowEnabled: boolean;
  circleShadowBlur:    number;
  circleShadowOffsetX: number;
  circleShadowOffsetY: number;
  circleShadowColor:   string;
  circleShadowOpacity: number;
  circleLift:          number;
  // Circle images now live in settings (uploaded/pasted from the settings panel)
  // rather than via an on-canvas placeholder.
  circleImageSrc?:     string | null;
  circle2ImageSrc?:    string | null;
  quoteSlots:     (string | null)[];
  dividerSlots?:     (string | null)[];
  dividerSubSlots?:  (DividerSubSlotContent | null)[];
  dividerSettings?:  (Partial<DividerStyleSettings> | null)[];
  quoteColor:     string;
  quoteSize:      number;
  quoteOpacity:   number;
  quoteGap:       number;
  headlineColor:  string;
  subheadlineColor: string;
  headlineShadow?:    ShadowStyle;
  subShadow?:         ShadowStyle;
  logoShadow?:        ShadowStyle;
  quoteShadow?:       ShadowStyle;
  headlineSpans:  TextSpan[] | null;
  subSpans:       TextSpan[] | null;
  circle2BorderWidth:   number;
  circle2BorderColor:   string;
  circle2BorderOpacity: number;
  circle2ShadowEnabled: boolean;
  circle2ShadowBlur:    number;
  circle2ShadowOffsetX: number;
  circle2ShadowOffsetY: number;
  circle2ShadowColor:   string;
  circle2ShadowOpacity: number;
  circle2Lift:          number;
  // Base canvas fill, drawn beneath the image/video (shows where they don't cover).
  bgColor?:             string;
  // Solid band pinned to the bottom of the card — a hard section the text sits
  // in (instead of a fade over the photo). Sized to fit the text block, but
  // never shorter than ~1/5 of the card.
  bottomBandEnabled?:   boolean;
  bottomBandColor?:     string;
}

export function defaultCarouselSettings(): CarouselSettings {
  return {
    showFade: true, fadeReach: 40, fadeIntensity: 85, fadeFloor: 20,
    showTopFade: false, topFadeReach: 40, topFadeIntensity: 85, topFadeFloor: 20,
    fontSize: 68, lSpacing: 0, lHeight: 15,
    fontLabel: 'Inter', fontWeight: 700, italic: false, textAlign: 'left', allCaps: false,
    subFontSize: 32, subLSpacing: 0, subLHeight: 10,
    subFontLabel: 'Inter', subFontWeight: 400, subItalic: false, subTextAlign: 'left', subAllCaps: false,
    headSubGap: 20, aboveLogoGap: 8, logoOpacity: 100, logoScale: 100, logoCornerRadius: 0, contentPadding: 50,
    tagStyle: defaultTagStyle(),
    tagSlots: Array(3).fill(null),
    bgColor: '#111111',
    bgBlurEnabled: false, bgBlurAmount: 10, bgDarkenAmount: 0,
    layerOrder: ['background', 'circle', 'circle2', 'subject'] as LayerId[],
    circleBorderWidth: 10, circleBorderColor: '#ffffff', circleBorderOpacity: 100,
    circleShadowEnabled: false,
    circleShadowBlur: 20, circleShadowOffsetX: 0, circleShadowOffsetY: 8,
    circleShadowColor: '#000000', circleShadowOpacity: 50,
    circleLift: 0,
    quoteSlots:    Array(3).fill(null),
    quoteColor:    '#ffffff',
    quoteSize:     120,
    quoteOpacity:  100,
    quoteGap:      8,
    headlineColor: '#ffffff',
    subheadlineColor: '#ffffff',
    headlineSpans: null,
    subSpans:      null,
    circle2BorderWidth: 10, circle2BorderColor: '#ffffff', circle2BorderOpacity: 100,
    circle2ShadowEnabled: false,
    circle2ShadowBlur: 20, circle2ShadowOffsetX: 0, circle2ShadowOffsetY: 8,
    circle2ShadowColor: '#000000', circle2ShadowOpacity: 50,
    circle2Lift: 0,
  };
}

export interface CarouselBgLayerState {
  fgMaskReady: boolean;
  isBgProcessing: boolean;
  bgProcessError: boolean;
}

export interface CarouselSettingsPanelProps {
  settings: CarouselSettings;
  onChange: (partial: Partial<CarouselSettings>) => void;
  videoMode?: boolean;
}
