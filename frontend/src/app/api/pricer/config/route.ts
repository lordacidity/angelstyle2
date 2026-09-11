// GET /api/pricer/config — what the Pricer page shows in its header: the master-list size, the three models, the
// credits rate and the news window. Behind the site gate like every /api/* route (middleware.ts).

import { NextResponse } from 'next/server';
import { loadMaster, GEMINI_MODEL, SOCIAL_MODEL, JUDGE_MODEL, CREDITS_PER_USD, NEWS_WINDOW_DAYS } from '@/lib/pricer/pipeline';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    return NextResponse.json(
      {
        count: loadMaster().length,
        models: { fast: GEMINI_MODEL, social: SOCIAL_MODEL, judge: JUDGE_MODEL },
        creditsPerUsd: CREDITS_PER_USD,
        newsWindowDays: NEWS_WINDOW_DAYS,
      },
      { headers: { 'cache-control': 'no-store' } },
    );
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : 'unexpected error' }, { status: 500 });
  }
}
