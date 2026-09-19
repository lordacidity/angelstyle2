# `simpler/` — Vids 2's engine, under the old name

There is no Simpler section any more. It was deleted on 2026-09-18, along with
the Build page of Vids, because Vids 2 had become the only place anyone builds a
video. What was Simpler's build logic is now Vids 2's, and it was left where it
sat rather than moved — renaming `lib/simpler/*` would have touched every file in
`components/vids2` for no gain. So when you read "Simpler" in a comment here,
read "the engine Vids 2 builds with".

What is left in this folder is what `components/vids2` imports, and one spare:

- `VidsCaptionsRail.tsx` — the captions rail on the tuning page,
- `VidsPicker.tsx` — `Shell` and `Empty`, the popup frame — unused since the form put its personas on tiles (2026-09-18), kept for whatever wants a popup next,
- `EmojiPicker.tsx` — what the rail's fields open.

`SimplerSection.tsx`, `VidsBuilder.tsx`, `VidsBottom.tsx` and
`VidsPostCaption.tsx` went with the section. `lib/simpler/*` (`vidsPlan`,
`vidsCompose`, `vidsAudio`, `vidsBottom`, `vidsCaptions`, `vidsEdit`,
`vidsRecipe`, `vidsLocal`) is untouched and is what Vids 2 runs on.

## What Vids is now

`components/vids` (`/vids`) is the library and nothing else — two pages:

- **Edit & file** — footage in: personas, Bottom Bs, Ends; trim, cut, speed,
  sound; filed to Supabase Storage.
- **Clippers** — which personas, clips, songs and caption looks the clippers'
  app may use.

Its own `lib/vids*.ts` is down to what those two pages and the recording
renderers need: `vidsPlan` (slots, folders, trim and speed rules, encoder
settings), `vidsCaptions` (the caption looks the Clippers page lists),
`vidsEdit` (baking a trim into a file) and `vidsAudio`. `lib/vidsCompose.ts`,
`lib/vidsRecipe.ts` and `lib/vidsBottom.ts` were the Build page's and went with
it — `lib/simpler/` has the copies that are still in use.

Nothing in `components/vids` imports from here or from `lib/simpler`, and
nothing here imports from `components/vids`.

## The clip renderers, and which way they run

The screen recordings that go *into* a build are not forked and must not be.
Each has one home, and everybody renders from it:

| The recording | Lives in | Rendered by |
| --- | --- | --- |
| The ChatGPT search | `components/chatgpt/chatgpt-video.ts` | Studio > ChatGPT; Vids 2's intro |
| The Pauv trade | `components/trade/trade-video.ts` | Studio > Trade; Vids 2's Bottom B |
| The news story | `components/news/news-video.ts` | Studio > News; Vids 2's intro |

**A change to any of those files changes it everywhere.** None of them may
import from `components/vids`, `components/simpler` or `lib/simpler`; what each
caller does with the finished file (download it, file it, keep it in the tab)
belongs to the caller.

`chatgpt-video.ts` is the merged version of what were once two copies (folded
together 2026-09-16, Simpler's winning): 2× `RENDER_SCALE`, the `TYPE_RHYTHM`
model, no mouse clicks over the keyboard. `VIDEO_W`/`VIDEO_H` are the CSS grid
the drawing is laid out on; `FILE_W`/`FILE_H` are the size of the file that
comes out, and are what to show anyone being told what they will get.

## What everything shares

One API and one library — the same folders, the same clips, the same people.

- `/api/vids/*` — Vids and Vids 2 call the very same routes.
- `lib/vids-client.ts`, `lib/vids-types.ts`, `lib/vids-db.ts`,
  `app/hooks/useVidsLibrary.ts` — one copy each.
- `lib/emoji*`, `lib/icons`, `lib/ui-constants`, `lib/utils`.

Changes to those reach everything, so they have to stay additive. The fields a
build record carries for Vids 2 alone (`booms`, `boomLevel`, `captions.size` on
`VidBuildSpec`, and their counterparts in `api/vids/recipes/spec.ts`) are
optional for that reason, and `LocalClipMeta.theme` — which way Pauv was in a
Bottom B rendered in the tab rather than filed — likewise.

## Where it came from

The `simplier/` folder at the repo root: a standalone clone of the app with
everything but Vids removed. It became the Simpler section, the section became
Vids 2's engine, and that clone at the root has not been the thing that runs for
a long time.
