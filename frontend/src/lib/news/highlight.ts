// Which form of a person's name a story's page prints — what the news
// recording drags over (lib/news/page-measure looks for it on the laid-out
// page; this decides what it looks for).
//
// A headline found for "RFK Jr." can open on a page whose own headline says
// "Kennedy": the Times' feed and the Times' page carry different headlines,
// and the roster spells him one way while the press spells him three. The
// headline is looked at first, for the whole name and then for the short
// forms the press uses for them (lib/news/name-forms) — "Trump" in a headline
// is the name in the headline, whatever the story says further down — and
// only then the story, the same way. The whole name in the headline settles
// it without asking for forms at all. Null when the page says them no way,
// and the recording falls back to the start of the headline.

import { headlineNames } from './google-news';
import { nameForms } from './name-forms';
import type { NameHighlight, NewsArticle } from './types';

export async function highlightFor(a: NewsArticle, name: string | undefined): Promise<NameHighlight | null> {
  const want = name?.trim();
  if (!want) return null;
  // The same pieces the recording reads as the headline (TMZ's is three).
  const headline = [a.headline, a.headlineParts?.kicker, a.headlineParts?.sub].filter(Boolean).join('\n');
  const story = [a.dek ?? '', ...a.keyPoints, ...a.body.map(b => b.text)].join('\n');
  const find = (forms: readonly string[]): NameHighlight | null => {
    for (const form of forms) if (headlineNames(headline, form)) return { form, where: 'headline' };
    for (const form of forms) if (headlineNames(story, form)) return { form, where: 'story' };
    return null;
  };
  if (headlineNames(headline, want)) return { form: want, where: 'headline' };
  const f = await nameForms(want);
  return find([want, ...f.search, ...f.headline]);
}
