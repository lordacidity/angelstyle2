// What Pauv is, in the words it is allowed to be described in, for every Vids
// route that has the model write something a viewer will read — captions, the
// title of a finished build. The model has no reliable knowledge of Pauv, so
// every fact it may state comes from here, and the banned words hold everywhere.
// Pure strings: safe to import from either side, though only routes need it.

/** Never in any form — it is trading on public sentiment, nothing else. */
export const BANNED_WORDS: readonly string[] = [
  'investment', 'invest', 'investing', 'investor', 'stock', 'stocks', 'shares', 'stock market',
  'portfolio', 'asset',
];

export const PAUV_BRIEF = `Pauv (pauv.com) is a platform that lets you trade on the public sentiment of people — how people feel about people.
Trade UP on someone if you think they will get more popular or more culturally relevant.
Trade DOWN on someone if you think they will fall off or become more unpopular.
Anyone is searchable and anyone is tradable.
How it works: sign up, deposit funds, start trading.

BANNED WORDS — never use any of these, in any form: ${BANNED_WORDS.map((w) => `"${w}"`).join(', ')}. It is trading on public sentiment. Nothing else.`;
