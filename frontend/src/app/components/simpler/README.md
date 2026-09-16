# Simpler

Vids, cut down to the bare minimum of making one video. Same builder, with as
many of the controls and configs taken out as could go: no Edit & file, no
Clippers, no Simple/Advanced switch, no bars, no timeline, no Bring a build
back. What is left is the four decisions and the export.

It sits under Vids in the left sidebar and lives at `/simpler`.

## It is a second copy, on purpose

Simpler is not a mode of Vids and shares none of its build logic. It has

- its own components here in `components/simpler/`, and
- its own build logic in `lib/simpler/` (`vidsPlan`, `vidsCompose`,
  `vidsAudio`, `vidsBottom`, `vidsCaptions`, `vidsEdit`, `vidsRecipe`,
  `vidsLocal`).

`components/vids/` and `lib/vids*.ts` are Vids'. Neither side imports the
other's, so a change to one cannot move the other by accident.

## The clip renderers are the exception, and they run the other way

The screen recordings that go *into* a build are not forked and must not be.
Each has one home, and everybody renders from it:

| The recording | Lives in | Rendered by |
| --- | --- | --- |
| The ChatGPT search | `components/chatgpt/chatgpt-video.ts` | Studio > ChatGPT, Vids' Bottom card, Simpler's Bottom card |
| The Pauv trade | `components/trade/trade-video.ts` | Studio > Trade today; the Vids and Simpler builders when they come to lay one in |

**A change to either of those files changes it for all of them** — the opposite
of the rule above, and deliberately so. Neither file may import from
`components/vids`, `components/simpler` or `lib/simpler`; what each caller does
with the finished file (download it, file it under Bottom A, keep it in the tab)
belongs to the caller.

Simpler used to carry its own copy of `chatgpt-video.ts`. It was folded back in
on 2026-09-16 and its version won outright, so the ChatGPT section and Vids now
render at 2× (`RENDER_SCALE`), type on the `TYPE_RHYTHM` model, and no longer
lay mouse clicks over the keyboard. `VIDEO_W`/`VIDEO_H` are the CSS grid the
drawing is laid out on; `FILE_W`/`FILE_H` are the size of the file that comes
out, and are what to show anyone being told what they will get.

**So: a change to the logic of Vids is meant to be made to Simpler too, by
hand.** Nothing propagates on its own — that is the whole point of the split,
and the cost of it. The two have already diverged in both directions: Simpler
has BOOMs, a caption size slider, a question writer and clips kept in the tab
rather than filed, none of which Vids has.

## What the two do share

One API and one library — the same folders, the same clips, the same people.

- `/api/vids/*` — Simpler's client calls the very same routes.
- `lib/vids-client.ts`, `lib/vids-types.ts`, `lib/vids-db.ts`,
  `app/hooks/useVidsLibrary.ts` — one copy each.
- `lib/emoji*`, `lib/icons`, `lib/ui-constants`, `lib/utils`.

Changes to any of those DO reach both, so they have to stay additive. The
fields Simpler needs that Vids has no use for (`booms`, `boomLevel`,
`captions.size` on `VidBuildSpec`, and their counterparts in
`api/vids/recipes/spec.ts`) are all optional for exactly that reason: a Vids
record that leaves them out still parses, and a Simpler record keeps them.

Recipes are shared too. A build Simpler saved opens in Vids without its BOOMs
or its caption size — Vids has nothing to show them with — and saving it back
from there drops them.

## Vids 2 reads from here, and is not another fork

`components/vids2` (`/vids-2`) is a form plus a tuning page, and it is built on
this folder rather than on a copy of it. It imports

- the whole of `lib/simpler/*` — plan, compose, audio, captions, edit, recipe,
  local clips — as its build logic, and
- `VidsCaptionsRail`, `VidsPostCaption` and `VidsPicker` from here.

`Vids2Builder.tsx` is a fork of `VidsBuilder.tsx` (the deciding taken out, a
summary of the form's answers where the two cards were), so **that** one still
has to be kept in step by hand. Everything else in the list above does not: a
change to it is a change to Vids 2 as well, which is the deal that folder is
built on. See `components/vids2/README.md`.

`LocalClipMeta` grew an optional `theme` for it — a Bottom B carries which way
Pauv was, and Vids 2 renders its own rather than filing one. Optional, so a
Simpler clip that leaves it out is unchanged.

## Where it came from

The `simplier/` folder at the repo root: a standalone clone of the app with
everything but Vids removed. This is that clone folded into Studio as a
section. The folder is still there and is no longer the thing that runs.
