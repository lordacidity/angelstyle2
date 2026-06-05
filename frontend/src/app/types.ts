/** Navigation sections in the sidebar */
export type AppSection = 'deck' | 'brandkit' | 'media' | 'builder' | 'trending' | 'images' | 'board' | 'schedule' | 'ai';

export type SlideType = 'main' | 'supporting_1' | 'supporting_2';

export interface BrandLogo {
  id: string;
  url: string;
  label?: string;
  position: number;
}

/** Talent category the brand promotes — drives the bio CTA wording
 *  ("pauv.com to trade Artists" vs "…Athletes"). */
export type BrandCategory = 'artists' | 'athletes';

/** Brand-kit data passed to canvas templates */
export interface BrandProps {
  logoSrc: string;
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

export type VideoMode = 'twitter' | 'caption' | 'carousel';

export interface VideoEntry {
  id: string;
  url: string;
  caption: string;
  mode: VideoMode;
  data: VideoData | null;
  loading: boolean;
  error: string;
  videoFailed: boolean;
  // Free-form notes the user types to feed the social-caption generator —
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
