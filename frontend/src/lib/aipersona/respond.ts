// How the /api/ai-persona/* routes say no. Two kinds of refusal are the
// caller's to fix and are told apart from a real failure by their class.
//
// Server-only.

import { NextResponse } from 'next/server';
import type { ErrorResponse } from './types';

/** A request that can't be carried out as asked. Answered with 400. */
export class PersonaInputError extends Error {}

/** A request that is fine in itself but not where things stand — approving
 *  frames that are still being made, say. Answered with 409. */
export class PersonaStateError extends Error {}

export const refuse = (error: string, status = 400) => NextResponse.json({ error } satisfies ErrorResponse, { status });

/** Turn whatever a route caught into its answer. */
export function fail(tag: string, err: unknown) {
  if (err instanceof PersonaInputError) return refuse(err.message, 400);
  if (err instanceof PersonaStateError) return refuse(err.message, 409);
  console.error(`[ai-persona ${tag}]`, err);
  return refuse(err instanceof Error ? err.message : String(err), 500);
}
