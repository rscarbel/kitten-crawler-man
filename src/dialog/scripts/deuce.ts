/**
 * Deuce's banter, keyed by the beat that triggers it.
 *
 * Deuce deals the Desperado Club's blackjack table: unfailingly courteous,
 * entirely unbothered by either outcome, quietly delighted when someone plays
 * well. The house wins eventually and Deuce knows it, so there is nothing to
 * gloat about — a dealer who taunts on a loss turns a losing streak from a story
 * into an insult. Every line is written to fit one rendered row at the compact
 * panel width.
 */

import { pickLine, speakerLines } from '../line';
import type { BarkLine, NonEmpty } from '../line';

const say = speakerLines('deuce');

export type BanterTrigger =
  | 'first_sit'
  | 'player_blackjack'
  | 'player_bust'
  | 'dealer_bust'
  | 'push'
  | 'big_win'
  | 'reshuffle'
  | 'turned_away'
  | 'long_session';

export const DEUCE_LINES: Record<BanterTrigger, NonEmpty<BarkLine>> = {
  first_sit: [
    say.bark('"Deuce. I deal, you decide. Rules button\'s there if you want them."'),
    say.bark('"Evening. Stack your chips on the felt and I\'ll deal you in."'),
    say.bark('"Welcome to my table. Never played? Tap the rules — no shame in it."'),
  ],
  player_blackjack: [
    say.bark('"Blackjack. Pays three to two — my pleasure."'),
    say.bark('"There it is. Twenty-one off the deal. Beautiful."'),
    say.bark('"Natural. I do like watching that land."'),
  ],
  player_bust: [
    say.bark('"Over the top. Happens to the best hands."'),
    say.bark('"Twenty-two. One pip the wrong side of it."'),
    say.bark('"Bust. The card was there — it just wasn\'t yours."'),
  ],
  dealer_bust: [
    say.bark('"And I break. Serves me right for chasing it."'),
    say.bark('"Over I go. The house does that sometimes."'),
    say.bark('"Busted myself. Pay the man."'),
  ],
  push: [
    say.bark('"Push. Nobody moves."'),
    say.bark('"Even hands. Your stake stays where it is."'),
    say.bark('"A tie. We go again."'),
  ],
  big_win: [
    say.bark('"That is a genuine result. Well played."'),
    say.bark('"Nicely done. The rack feels that one."'),
    say.bark('"You read that hand right. Credit where it\'s due."'),
  ],
  reshuffle: [
    say.bark('"Fresh deck. Everything you counted just went back in."'),
    say.bark('"Shuffling up. Fifty-two again, all of it live."'),
    say.bark('"New shoe. Clean slate for both of us."'),
  ],
  turned_away: [
    say.bark('"House minimum\'s ten, friend. Table\'s here whenever you are."'),
    say.bark('"Come back with a few coins and I\'ll deal you in — seat\'s yours."'),
    say.bark('"No stake, no hand. No hurry either. I\'ll keep the seat warm."'),
  ],
  long_session: [
    say.bark('"You\'ve been here a while. Suits me — good company."'),
    say.bark('"Twenty hands in and still sharp. I notice these things."'),
    say.bark('"Long session. Say the word if you want a fresh deck."'),
  ],
};

function poolFor(trigger: BanterTrigger): NonEmpty<BarkLine> {
  switch (trigger) {
    case 'first_sit':
      return DEUCE_LINES.first_sit;
    case 'player_blackjack':
      return DEUCE_LINES.player_blackjack;
    case 'player_bust':
      return DEUCE_LINES.player_bust;
    case 'dealer_bust':
      return DEUCE_LINES.dealer_bust;
    case 'push':
      return DEUCE_LINES.push;
    case 'big_win':
      return DEUCE_LINES.big_win;
    case 'reshuffle':
      return DEUCE_LINES.reshuffle;
    case 'turned_away':
      return DEUCE_LINES.turned_away;
    case 'long_session':
      return DEUCE_LINES.long_session;
  }
}

/** `fresh`, as a `NonEmpty` pool, or `fallback` when filtering left nothing. */
function freshOrFallback(
  fresh: readonly BarkLine[],
  fallback: NonEmpty<BarkLine>,
): NonEmpty<BarkLine> {
  if (fresh.length === 0) return fallback;
  const [first, ...rest] = fresh;
  return [first, ...rest];
}

/**
 * A random line for `trigger` that is not `lastLine`, so the same words never
 * fire twice running.
 */
export function pickDeuceLine(trigger: BanterTrigger, lastLine: string | null): string {
  const pool = poolFor(trigger);
  const fresh = pool.filter((line) => line.paragraphs[0] !== lastLine);
  const candidates = freshOrFallback(fresh, pool);
  return pickLine(candidates, Math.random() * candidates.length).paragraphs[0];
}
