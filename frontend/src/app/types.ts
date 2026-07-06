/** Navigation sections in the sidebar */
export type AppSection = 'deck' | 'brandkit' | 'media' | 'carousel' | 'builder' | 'trending' | 'images' | 'board' | 'schedule' | 'prompts' | 'pricer';

export type SlideType = 'main' | 'supporting_1' | 'supporting_2';

/** One page of an AI-generated multi-page carousel (the "Trending (auto)" flow).
 *  Used to seed several carousel entries at once. */
export interface CarouselPage {
  slideType: SlideType;
  headline: string;
  subheadline: string;
  imageSrc?: string;
  articleUrl?: string;
}

/** Which slot a logo belongs to. 'favicon' is the small square avatar/icon (the
 *  current "normal" logo, e.g. the Pauv "p"); 'logo' is the separate full logo.
 *  Missing/legacy rows are treated as 'favicon'. */
export type BrandLogoKind = 'favicon' | 'logo';

export interface BrandLogo {
  id: string;
  url: string;
  label?: string;
  position: number;
  kind?: BrandLogoKind;
}

/** Talent category the brand promotes — drives the bio CTA wording
 *  ("pauv.com to trade Artists" vs "…Athletes" vs "…Gamers"). */
export type BrandCategory = 'artists' | 'athletes' | 'gamers';

/** Brand-kit data passed to canvas templates */
export interface BrandProps {
  /** Active favicon logo (the small square avatar/icon used on posts today). */
  logoSrc: string;
  /** Active full logo — stored in the Brand Kit; not yet wired into posts. */
  logoFullSrc: string;
  logos: BrandLogo[];
  displayName: string;
  handle: string;
  category: BrandCategory;
}

export interface Author {
  uniqueId: string;
  nickname: string;
  avatarThumb: string;
}

export interface VideoData {
  id: string;
  title: string;
  cover: string;
  author: Author;
  play: string;
  wmplay: string;
  hdplay: string;
  duration: number;
  size: number;
  images?: string[];
}

export type VideoMode = 'twitter' | 'caption' | 'carousel' | 'charts' | 'chartsimage';

export interface VideoEntry {
  id: string;
  url: string;
  caption: string;
  mode: VideoMode;
  data: VideoData | null;
  loading: boolean;
  error: string;
  videoFailed: boolean;
  // Free-form notes the user types as context for caption generation —
  // background, context, vibe, anything that shapes the resulting copy.
  context?: string;
  // local video upload (twitter/caption templates)
  localVideoSrc?: string;
  localVideoName?: string;
  // carousel-specific
  imageSrc?: string;
  headline?: string;
  subheadline?: string;
  // Optional link to the source article that this card was built from — shown
  // as small greyed-out text above the headline in the media tab.
  articleUrl?: string;
  carouselSubMode?: 'image' | 'video';
  carouselSlideType?: SlideType;
}
