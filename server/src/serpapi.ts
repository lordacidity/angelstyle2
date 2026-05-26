// Thin SerpAPI client. Used for Google Images search to find candidate photos
// for a person when `profiles.photo_url` is empty.

const SERPAPI_KEY = process.env.SERPAPI_KEY ?? "";

export interface Photo {
  url: string;        // original / full-resolution URL
  thumbnail: string;  // small preview URL
  title?: string;
  source?: string;    // domain that hosts it
  width?: number;
  height?: number;
}

interface SerpImage {
  original?: string;
  thumbnail?: string;
  title?: string;
  source?: string;
  original_width?: number;
  original_height?: number;
}

interface SerpResponse {
  images_results?: SerpImage[];
  error?: string;
}

export async function imageSearch(
  query: string,
  count = 3,
  offset = 0,
): Promise<Photo[]> {
  if (!SERPAPI_KEY) throw new Error("SERPAPI_KEY not set");
  // Google Images via SerpAPI returns ~100 images per `ijn` page. Walk pages
  // as the caller's offset grows so "reload" can pull genuinely different
  // photos instead of the same first 100 over and over.
  const PAGE_SIZE = 100;
  const page = Math.floor(offset / PAGE_SIZE);
  const within = offset % PAGE_SIZE;

  const url = new URL("https://serpapi.com/search.json");
  url.searchParams.set("engine", "google_images");
  url.searchParams.set("q", query);
  url.searchParams.set("api_key", SERPAPI_KEY);
  url.searchParams.set("ijn", String(page));

  const res = await fetch(url);
  if (!res.ok) throw new Error(`serpapi ${res.status}: ${await res.text()}`);
  const json = (await res.json()) as SerpResponse;
  if (json.error) throw new Error(`serpapi: ${json.error}`);
  const images = (json.images_results ?? []).filter(isUsableImage);
  return images.slice(within, within + count).map((i) => ({
    url: i.original!,
    thumbnail: i.thumbnail ?? i.original!,
    title: i.title,
    source: i.source,
    width: i.original_width,
    height: i.original_height,
  }));
}

// Drop garbage results from Google's image search — branded UI artifacts,
// tiny icons, etc. — so the photo strip only contains things that actually
// look like photos of the person.
function isUsableImage(i: SerpImage): boolean {
  if (!i.original) return false;
  const url = i.original.toLowerCase();
  const source = (i.source ?? "").toLowerCase();
  // Filter Google's own infrastructure URLs (logos, icons, app branding).
  const BANNED_HOSTS = [
    "google.com/logos",
    "gstatic.com",
    "googleusercontent.com/proxy",
    "google.com/imgres",
    "google.com/url",
    "ssl.gstatic.com",
    "lh3.googleusercontent.com/d/", // Drive file thumbnails
  ];
  if (BANNED_HOSTS.some((p) => url.includes(p))) return false;
  if (source.endsWith("google.com") || source === "google") return false;
  // Filter SVG icons — they're almost always logos.
  if (url.endsWith(".svg") || url.includes(".svg?")) return false;
  // Filter tiny thumbnails (favicon-sized). Real portrait photos are 200×200+.
  if (i.original_width != null && i.original_width < 200) return false;
  if (i.original_height != null && i.original_height < 200) return false;
  return true;
}
