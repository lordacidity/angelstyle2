export async function GET() {
  return Response.json({ ok: true, fal: !!process.env.FAL_KEY, gemini: !!process.env.GEMINI_API_KEY });
}
