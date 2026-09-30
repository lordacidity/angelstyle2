// The ground under the map layout of the web: country outlines for the whole
// world and state lines for the US, from Natural Earth (public domain, at its
// 1:110m scale: enough to see where a city is, not what is in it), reduced to
// bare coordinates and bundled here so the map needs no tile server, no key
// and no network.
//
// Everything is projected once into the web's own coordinate space (Web
// Mercator, the world WORLD_W units wide, the equator and Greenwich at the
// origin) so the outlines, the places and the people all sit in one plane
// that the graph pans and zooms as one.

import world from '@/lib/aiden-geo/world-110m.json';
import states from '@/lib/aiden-geo/us-states-110m.json';

export const WORLD_W = 8000;

export function project(lat: number, lng: number): { x: number; y: number } {
  const x = ((lng + 180) / 360) * WORLD_W - WORLD_W / 2;
  const phi = (Math.max(-85, Math.min(85, lat)) * Math.PI) / 180;
  const y = ((1 - Math.log(Math.tan(Math.PI / 4 + phi / 2)) / Math.PI) / 2) * WORLD_W - WORLD_W / 2;
  return { x, y };
}

type Ring = [number, number][];
interface Feature {
  geometry: { type: 'Polygon'; coordinates: Ring[] } | { type: 'MultiPolygon'; coordinates: Ring[][] } | null;
}
interface Collection {
  features: Feature[];
}

function ringPath(ring: Ring): string {
  let d = '';
  for (let i = 0; i < ring.length; i++) {
    const p = project(ring[i][1], ring[i][0]);
    d += `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`;
  }
  return `${d}Z`;
}

/** Every outline in a collection as one SVG path. */
function toPath(fc: Collection): string {
  const parts: string[] = [];
  for (const f of fc.features) {
    const g = f.geometry;
    if (!g) continue;
    const polys = g.type === 'Polygon' ? [g.coordinates] : g.coordinates;
    for (const poly of polys) for (const ring of poly) parts.push(ringPath(ring));
  }
  return parts.join('');
}

let cache: { world: string; states: string } | null = null;

/** The outlines, projected. Built the first time they are asked for. */
export function outlines(): { world: string; states: string } {
  if (!cache) {
    cache = {
      world: toPath(world as unknown as Collection),
      states: toPath(states as unknown as Collection),
    };
  }
  return cache;
}
