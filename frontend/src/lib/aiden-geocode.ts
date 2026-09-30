// Where a place is, for the map.
//
// Places are typed as he says them: "SF", "Austin", "Novi". The map needs a
// point. OpenStreetMap's Nominatim turns a name into one, free, on the terms
// that requests identify the app and arrive no faster than one a second. The
// short names he uses are spelled out first (ALIASES), because "SF" means
// nothing to a geocoder and "Novi" alone might find the wrong one. What comes
// back is saved on the place, so each is looked up once; a place that lands
// wrong is fixed by telling it what to look up as (its `geoQuery`).
//
// Server-only: the request carries our User-Agent, and the pacing has to be
// one process-wide queue.

export interface GeoHit {
  lat: number;
  lng: number;
  label: string;
}

const ALIASES: Record<string, string> = {
  sf: 'San Francisco, California',
  'san fran': 'San Francisco, California',
  'san francisco': 'San Francisco, California',
  'bay area': 'San Francisco, California',
  'south bay': 'San Jose, California',
  'palo alto': 'Palo Alto, California',
  'menlo park': 'Menlo Park, California',
  'mountain view': 'Mountain View, California',
  sj: 'San Jose, California',
  la: 'Los Angeles, California',
  'los angeles': 'Los Angeles, California',
  sd: 'San Diego, California',
  nyc: 'New York City',
  ny: 'New York City',
  'new york': 'New York City',
  brooklyn: 'Brooklyn, New York',
  dc: 'Washington, District of Columbia',
  'washington dc': 'Washington, District of Columbia',
  'washington, dc': 'Washington, District of Columbia',
  'washington, d.c.': 'Washington, District of Columbia',
  atx: 'Austin, Texas',
  austin: 'Austin, Texas',
  dfw: 'Dallas, Texas',
  dallas: 'Dallas, Texas',
  houston: 'Houston, Texas',
  htx: 'Houston, Texas',
  'san antonio': 'San Antonio, Texas',
  bos: 'Boston, Massachusetts',
  boston: 'Boston, Massachusetts',
  cambridge: 'Cambridge, Massachusetts',
  chi: 'Chicago, Illinois',
  chicago: 'Chicago, Illinois',
  philly: 'Philadelphia, Pennsylvania',
  atl: 'Atlanta, Georgia',
  atlanta: 'Atlanta, Georgia',
  mia: 'Miami, Florida',
  miami: 'Miami, Florida',
  nashville: 'Nashville, Tennessee',
  nash: 'Nashville, Tennessee',
  sea: 'Seattle, Washington',
  seattle: 'Seattle, Washington',
  pdx: 'Portland, Oregon',
  portland: 'Portland, Oregon',
  slc: 'Salt Lake City, Utah',
  denver: 'Denver, Colorado',
  boulder: 'Boulder, Colorado',
  phoenix: 'Phoenix, Arizona',
  detroit: 'Detroit, Michigan',
  'ann arbor': 'Ann Arbor, Michigan',
  novi: 'Novi, Michigan',
  'grand rapids': 'Grand Rapids, Michigan',
  columbus: 'Columbus, Ohio',
  pittsburgh: 'Pittsburgh, Pennsylvania',
  minneapolis: 'Minneapolis, Minnesota',
  'st louis': 'St. Louis, Missouri',
  'st. louis': 'St. Louis, Missouri',
  'kansas city': 'Kansas City, Missouri',
  raleigh: 'Raleigh, North Carolina',
  charlotte: 'Charlotte, North Carolina',
  'salt lake': 'Salt Lake City, Utah',
  vegas: 'Las Vegas, Nevada',
  'las vegas': 'Las Vegas, Nevada',
  oakland: 'Oakland, California',
  berkeley: 'Berkeley, California',
  'santa monica': 'Santa Monica, California',
  irvine: 'Irvine, California',
  sacramento: 'Sacramento, California',
  tampa: 'Tampa, Florida',
  orlando: 'Orlando, Florida',
  provo: 'Provo, Utah',
  cleveland: 'Cleveland, Ohio',
  cincinnati: 'Cincinnati, Ohio',
  indianapolis: 'Indianapolis, Indiana',
  indy: 'Indianapolis, Indiana',
  milwaukee: 'Milwaukee, Wisconsin',
  baltimore: 'Baltimore, Maryland',
  'new orleans': 'New Orleans, Louisiana',
  nola: 'New Orleans, Louisiana',
  montreal: 'Montreal, Quebec',
  'mexico city': 'Mexico City',
  cdmx: 'Mexico City',
  dublin: 'Dublin, Ireland',
  amsterdam: 'Amsterdam, Netherlands',
  zurich: 'Zurich, Switzerland',
  stockholm: 'Stockholm, Sweden',
  lisbon: 'Lisbon, Portugal',
  madrid: 'Madrid, Spain',
  seoul: 'Seoul, South Korea',
  nairobi: 'Nairobi, Kenya',
  'sao paulo': 'Sao Paulo, Brazil',
  toronto: 'Toronto, Ontario',
  vancouver: 'Vancouver, British Columbia',
  london: 'London, England',
  uk: 'London, England',
  paris: 'Paris, France',
  berlin: 'Berlin, Germany',
  singapore: 'Singapore',
  'hong kong': 'Hong Kong',
  tokyo: 'Tokyo, Japan',
  sydney: 'Sydney, Australia',
  dubai: 'Dubai, United Arab Emirates',
  'tel aviv': 'Tel Aviv, Israel',
  bangalore: 'Bengaluru, India',
  bengaluru: 'Bengaluru, India',
  mumbai: 'Mumbai, India',
  lagos: 'Lagos, Nigeria',
};

// Where the spelled-out places are, so the usual ones need no lookup at all.
// City centers, to about a mile, which is all a map of a network needs.
const CITIES: Record<string, [number, number]> = {
  'San Francisco, California': [37.7749, -122.4194],
  'San Jose, California': [37.3382, -121.8863],
  'Palo Alto, California': [37.4419, -122.143],
  'Menlo Park, California': [37.453, -122.1817],
  'Mountain View, California': [37.3861, -122.0839],
  'Oakland, California': [37.8044, -122.2712],
  'Berkeley, California': [37.8716, -122.2727],
  'Los Angeles, California': [34.0522, -118.2437],
  'Santa Monica, California': [34.0195, -118.4912],
  'San Diego, California': [32.7157, -117.1611],
  'Irvine, California': [33.6846, -117.8265],
  'Sacramento, California': [38.5816, -121.4944],
  'New York City': [40.7128, -74.006],
  'Brooklyn, New York': [40.6782, -73.9442],
  'Washington, District of Columbia': [38.9072, -77.0369],
  'Austin, Texas': [30.2672, -97.7431],
  'Dallas, Texas': [32.7767, -96.797],
  'Houston, Texas': [29.7604, -95.3698],
  'San Antonio, Texas': [29.4241, -98.4936],
  'Boston, Massachusetts': [42.3601, -71.0589],
  'Cambridge, Massachusetts': [42.3736, -71.1097],
  'Chicago, Illinois': [41.8781, -87.6298],
  'Philadelphia, Pennsylvania': [39.9526, -75.1652],
  'Pittsburgh, Pennsylvania': [40.4406, -79.9959],
  'Atlanta, Georgia': [33.749, -84.388],
  'Miami, Florida': [25.7617, -80.1918],
  'Tampa, Florida': [27.9506, -82.4572],
  'Orlando, Florida': [28.5383, -81.3792],
  'Nashville, Tennessee': [36.1627, -86.7816],
  'Seattle, Washington': [47.6062, -122.3321],
  'Portland, Oregon': [45.5152, -122.6784],
  'Salt Lake City, Utah': [40.7608, -111.891],
  'Provo, Utah': [40.2338, -111.6585],
  'Denver, Colorado': [39.7392, -104.9903],
  'Boulder, Colorado': [40.015, -105.2705],
  'Phoenix, Arizona': [33.4484, -112.074],
  'Las Vegas, Nevada': [36.1699, -115.1398],
  'Detroit, Michigan': [42.3314, -83.0458],
  'Ann Arbor, Michigan': [42.2808, -83.743],
  'Novi, Michigan': [42.4806, -83.4755],
  'Grand Rapids, Michigan': [42.9634, -85.6681],
  'Columbus, Ohio': [39.9612, -82.9988],
  'Cleveland, Ohio': [41.4993, -81.6944],
  'Cincinnati, Ohio': [39.1031, -84.512],
  'Indianapolis, Indiana': [39.7684, -86.1581],
  'Minneapolis, Minnesota': [44.9778, -93.265],
  'Milwaukee, Wisconsin': [43.0389, -87.9065],
  'St. Louis, Missouri': [38.627, -90.1994],
  'Kansas City, Missouri': [39.0997, -94.5786],
  'Raleigh, North Carolina': [35.7796, -78.6382],
  'Charlotte, North Carolina': [35.2271, -80.8431],
  'Baltimore, Maryland': [39.2904, -76.6122],
  'New Orleans, Louisiana': [29.9511, -90.0715],
  'Toronto, Ontario': [43.6532, -79.3832],
  'Vancouver, British Columbia': [49.2827, -123.1207],
  'Montreal, Quebec': [45.5017, -73.5673],
  'Mexico City': [19.4326, -99.1332],
  'London, England': [51.5074, -0.1278],
  'Dublin, Ireland': [53.3498, -6.2603],
  'Paris, France': [48.8566, 2.3522],
  'Berlin, Germany': [52.52, 13.405],
  'Amsterdam, Netherlands': [52.3676, 4.9041],
  'Zurich, Switzerland': [47.3769, 8.5417],
  'Stockholm, Sweden': [59.3293, 18.0686],
  'Lisbon, Portugal': [38.7223, -9.1393],
  'Madrid, Spain': [40.4168, -3.7038],
  'Tel Aviv, Israel': [32.0853, 34.7818],
  'Dubai, United Arab Emirates': [25.2048, 55.2708],
  'Singapore': [1.3521, 103.8198],
  'Hong Kong': [22.3193, 114.1694],
  'Tokyo, Japan': [35.6762, 139.6503],
  'Seoul, South Korea': [37.5665, 126.978],
  'Sydney, Australia': [-33.8688, 151.2093],
  'Bengaluru, India': [12.9716, 77.5946],
  'Mumbai, India': [19.076, 72.8777],
  'Lagos, Nigeria': [6.5244, 3.3792],
  'Nairobi, Kenya': [-1.2921, 36.8219],
  'Sao Paulo, Brazil': [-23.5505, -46.6333],
};

/** Places that are nowhere: a name like this is never looked up. */
const NOWHERE = /^(remote|online|virtual|zoom|internet|worldwide|global|anywhere|n\/a|none|tbd|unknown)$/i;

const key = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ');

/** What to look a place up as, or null for a place that is nowhere. */
export function geoQueryFor(name: string): string | null {
  const k = key(name);
  if (!k || NOWHERE.test(k)) return null;
  return ALIASES[k] ?? name.trim();
}

// ── Nominatim, one request a second, process-wide ─────────────────────────────
const SPACING_MS = 1100;
const TIMEOUT_MS = 12_000;

const g = globalThis as unknown as { __aidenGeoQueue?: Promise<unknown>; __aidenGeoLast?: number };

interface NominatimRow {
  lat?: string;
  lon?: string;
  display_name?: string;
}

async function ask(query: string): Promise<GeoHit | null> {
  const url = new URL('https://nominatim.openstreetmap.org/search');
  url.searchParams.set('q', query);
  url.searchParams.set('format', 'jsonv2');
  url.searchParams.set('limit', '1');
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: {
        'User-Agent': 'angelstyle-studio-aiden/1.0 (a private networking log; a few lookups a day)',
        'Accept-Language': 'en',
      },
    });
    if (!res.ok) throw new Error(`nominatim ${res.status}`);
    const rows = (await res.json()) as NominatimRow[];
    const hit = rows[0];
    const lat = Number(hit?.lat);
    const lng = Number(hit?.lon);
    if (!hit || !Number.isFinite(lat) || !Number.isFinite(lng)) return null;
    return { lat, lng, label: hit.display_name ?? query };
  } finally {
    clearTimeout(timer);
  }
}

/** A place this file already knows, without asking anyone. */
function known(query: string): GeoHit | null {
  const k = key(query);
  const label = ALIASES[k] ?? Object.keys(CITIES).find((c) => key(c) === k || key(c.split(',')[0]) === k);
  const at = label ? CITIES[label] : undefined;
  return at && label ? { lat: at[0], lng: at[1], label } : null;
}

/** Looks a query up: the cities known here first, without a request; then
 *  Nominatim, in turn behind any lookup already waiting, never faster than
 *  one a second. Null when nothing was found; throws when the service could
 *  not be reached. */
export function geocode(query: string): Promise<GeoHit | null> {
  const hit = known(query);
  if (hit) return Promise.resolve(hit);
  const run = async (): Promise<GeoHit | null> => {
    const wait = (g.__aidenGeoLast ?? 0) + SPACING_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));
    try {
      return await ask(query);
    } finally {
      g.__aidenGeoLast = Date.now();
    }
  };
  const next = (g.__aidenGeoQueue ?? Promise.resolve()).then(run, run);
  g.__aidenGeoQueue = next.catch(() => undefined);
  return next;
}
