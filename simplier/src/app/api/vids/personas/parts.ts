// Shared body-parsing for the persona routes. Kept out of route.ts because a
// Next.js route file may only export handlers and the route config.
import { isUuid, type PersonaPatch } from '@/lib/vids-db';
import { PERSONA_PARTS } from '@/lib/vids-types';

/** Reads one clip id off a request body: absent → leave alone, null → clear the
 *  part, otherwise it must be a video id. Returns a message when it is neither. */
export function readPart(v: unknown, label: string): { value?: string | null; error?: string } {
  if (v === undefined) return {};
  if (v === null) return { value: null };
  if (!isUuid(v)) return { error: `${label} must be a video id or null` };
  return { value: v };
}

/** Folds startId / topAId / topBId out of a body into a patch, or returns the
 *  first complaint. `patch` is mutated so callers can seed it with the name. */
export function readParts(body: Record<string, unknown>, patch: PersonaPatch): string | null {
  for (const part of PERSONA_PARTS) {
    const { value, error } = readPart(body[part], part);
    if (error) return error;
    if (value !== undefined) patch[part] = value;
  }
  return null;
}
