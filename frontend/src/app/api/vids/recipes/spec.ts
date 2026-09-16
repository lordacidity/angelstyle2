// The shape of a build as it arrives to be written down (see VidBuildSpec).
// Kept beside the route rather than in it because a Next.js route file may only
// export handlers and the route config. Every number is bounded: the record is
// read straight back onto the stage, so nothing absurd may get in.
import { z } from 'zod';
import { isUuid } from '@/lib/vids-db';

const num = (lo: number, hi: number) => z.number().min(lo).max(hi);
const id = z.string().refine(isUuid, 'must be an id');

const Pick = z.object({
  videoId: id,
  videoName: z.string().max(200).default(''),
  storagePath: z.string().max(300).default(''),
  muted: z.boolean().default(true),
  fit: z.enum(['height', 'width']),
  align: z.enum(['start', 'center', 'end']),
  transform: z.object({ zoom: num(0.01, 100), dx: num(-1e5, 1e5), dy: num(-1e5, 1e5) }),
  trim: z.object({ start: num(0, 1e6), end: num(0, 1e6).nullable() }),
  speed: num(0.25, 4),
  // Bottom B dead centre rather than nudged left (SlotPick.centred). Only a
  // Vids 2 build sends it; every other record leaves it out and is nudged.
  centred: z.boolean().optional(),
});

const Line = z.object({
  text: z.string().max(300),
  oneLine: z.boolean().default(false),
  pos: z.object({ x: num(0, 1), y: num(0, 1) }).optional(),
  // Clip seconds, when the writer placed the line itself (Bottom A on Fast).
  at: num(0, 1e6).optional(),
});

export const BuildSpecSchema = z.object({
  persona: z.object({ id, name: z.string().max(120) }).nullable().default(null),
  picks: z.object({
    start: Pick.optional(),
    topA: Pick.optional(),
    topB: Pick.optional(),
    bottomA: Pick.optional(),
    bottomB: Pick.optional(),
    end: Pick.optional(),
  }),
  bars: z.object({
    middle: z.boolean(), middleSize: num(0, 4000), outer: z.boolean(), outerSize: num(0, 4000),
  }),
  // Missing from records written before Bottom A had a pace — those played it
  // at its own speed, which is what Normal is.
  bottomAPace: z.enum(['normal', 'fast']).default('normal'),
  roomTone: z.object({ on: z.boolean(), level: num(0, 2) }),
  // A record is read straight back onto the stage and its track fetched, so the
  // url may only ever be a path this app serves — never somewhere else's audio.
  music: z.object({
    url: z.string().max(300).startsWith('/', 'must be a path this app serves').nullable(),
    label: z.string().max(200).default(''),
    level: num(0, 1),
  }).default({ url: null, label: '', level: 0.7 }),
  clipLevel: num(0, 1),
  // Missing from records written before the BOOMs had a level of their own,
  // and from every Vids record — only Simpler lays them.
  boomLevel: num(0, 1).optional(),
  preset: z.string().max(16),
  // The BOOMs over the top of it, in the order they were laid. Missing from
  // every record written before there were any, and from every build without
  // one. `boom` is what a record written while only one was allowed called it,
  // and is still read so those records still parse.
  booms: z.array(z.object({
    videoId: id,
    videoName: z.string().max(200).default(''),
    at: num(0, 1e6),
    // Read straight back onto the stage like the music, so the same rule
    // holds: a path this app serves, never somebody else's audio.
    sound: z.object({
      url: z.string().max(300).startsWith('/', 'must be a path this app serves'),
      label: z.string().max(200).default(''),
    }).optional(),
    // False for one laid as its noise alone, with nothing drawn (BoomInsert
    // .picture). Left out by every other build, which is the ordinary kind.
    picture: z.boolean().optional(),
  })).max(64).optional(),
  boom: z.object({
    videoId: id,
    videoName: z.string().max(200).default(''),
    at: num(0, 1e6),
  }).optional(),
  captions: z.object({
    lines: z.object({
      start: Line,
      bottomA: z.array(Line).max(24),
      bottomB: z.array(Line).max(24),
      // End carries the comment line and nothing else. Records written while it
      // also held a pay-off still parse: the extra key is simply dropped.
      end: Line,
    }),
    styleId: z.string().max(32),
    // How big they were drawn against the look's own size. Missing from every
    // record written before the size could be moved, and from every Vids
    // record — those are all 1.
    size: num(0.1, 10).default(1),
    notes: z.string().max(500).default(''),
    emojis: z.boolean().default(true),
  }),
});

export const TitleBriefSchema = z.object({
  personaContext: z.string().max(600).default(''),
  bottomAContext: z.string().max(600).default(''),
  bottomBContext: z.string().max(600).default(''),
  endContext: z.string().max(600).default(''),
});

export const CreateRecipeSchema = z.object({
  build: BuildSpecSchema,
  brief: TitleBriefSchema,
});
