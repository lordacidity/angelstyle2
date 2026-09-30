// /api/aiden/chat — DeepSeek, with the whole log in front of it.
//   GET    the running thread, oldest first
//   POST   { content } → saves the message, answers it, saves the answer
//   DELETE clears the thread
//
// Every answer is written against a fresh read of the log, so a person added a
// minute ago is already known to it.
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { aidenLocked, isAidenUnlocked } from '@/lib/aiden-auth';
import { buildAidenSystemPrompt } from '@/lib/aiden-context';
import { addChat, clearChat, listChat, readSnapshot } from '@/lib/aiden-db';
import { deepseekChat, type ChatMessage } from '@/lib/deepseek';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

// How much of the thread rides along with each question. The log itself is
// sent whole every time; this only bounds the back-and-forth.
const HISTORY_TURNS = 24;

const Body = z.object({
  content: z.string().trim().min(1).max(8000),
});

export async function GET(req: NextRequest) {
  if (!(await isAidenUnlocked(req))) return aidenLocked();
  try {
    return NextResponse.json(await listChat());
  } catch (err) {
    console.error('[aiden chat GET]', err);
    return NextResponse.json({ error: 'failed to load the chat' }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  if (!(await isAidenUnlocked(req))) return aidenLocked();

  const parsed = Body.safeParse(await req.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json({ error: 'say something first' }, { status: 400 });
  }

  try {
    const [snap, history] = await Promise.all([readSnapshot(), listChat(HISTORY_TURNS)]);
    const today = new Date().toLocaleDateString('en-US', {
      weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
    });

    const messages: ChatMessage[] = [
      { role: 'system', content: buildAidenSystemPrompt(snap, today) },
      ...history.map((m) => ({ role: m.role, content: m.content })),
      { role: 'user', content: parsed.data.content },
    ];

    const user = await addChat('user', parsed.data.content);
    let answer: string;
    try {
      // No token cap: these are reasoning models, and their thinking is counted
      // against it. A cap sized for the answer can be spent before the answer starts.
      answer = (await deepseekChat(messages, { temperature: 0.6, timeoutMs: 110_000 })).trim();
    } catch (err) {
      console.error('[aiden chat deepseek]', err);
      const why = err instanceof Error ? err.message : 'unknown error';
      // The question is kept, so it is still on the page to be asked again.
      return NextResponse.json({ error: `DeepSeek did not answer: ${why}`, user }, { status: 502 });
    }
    if (!answer) {
      return NextResponse.json({ error: 'DeepSeek came back empty', user }, { status: 502 });
    }
    const assistant = await addChat('assistant', answer);
    return NextResponse.json({ user, assistant });
  } catch (err) {
    console.error('[aiden chat POST]', err);
    return NextResponse.json({ error: 'failed to answer' }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest) {
  if (!(await isAidenUnlocked(req))) return aidenLocked();
  try {
    await clearChat();
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[aiden chat DELETE]', err);
    return NextResponse.json({ error: 'failed to clear' }, { status: 500 });
  }
}
