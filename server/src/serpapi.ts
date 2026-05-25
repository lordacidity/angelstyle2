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
  const images = (json.images_results ?? []).filter((i) => i.original);
  return images.slice(within, within + count).map((i) => ({
    url: i.original!,
    thumbnail: i.thumbnail ?? i.original!,
    title: i.title,
    source: i.source,
    width: i.original_width,
    height: i.original_height,
  }));
}
