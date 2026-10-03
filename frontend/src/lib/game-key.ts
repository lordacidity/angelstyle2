// The one link that opens /game. The page lives outside the site password
// (middleware lets /game through when ?k= carries this exact key) and shows
// nothing at all without it, so the game is reachable from this address and
// no other. Change the key, change the link.
//
// Shared by middleware (edge) and the page (server), so nothing but a string
// lives here.
export const GAME_KEY = 'redline-7h2q-citadel';
export const GAME_PATH = `/game?k=${GAME_KEY}`;
