import { createClient } from '@supabase/supabase-js';
import { NextRequest, NextResponse } from 'next/server';

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SECRET_KEY!,
  { auth: { autoRefreshToken: false, persistSession: false } }
);

export async function POST(req: NextRequest) {
  const { email } = await req.json();
  if (!email) return NextResponse.json({ error: 'Email required' }, { status: 400 });

  const { data, error } = await admin.auth.admin.generateLink({
    type: 'magiclink',
    email,
  });

  if (error) return NextResponse.json({ error: error.message }, { status: 400 });

  return NextResponse.json({ token_hash: data.properties.hashed_token });
}
