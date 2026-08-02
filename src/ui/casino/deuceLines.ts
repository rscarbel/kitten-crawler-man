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

export const DEUCE_LINES: Record<BanterTrigger, ReadonlyArray<string>> = {
  first_sit: [
    '"Deuce. I deal, you decide. Rules button\'s there if you want them."',
    '"Evening. Stack your chips on the felt and I\'ll deal you in."',
    '"Welcome to my table. Never played? Tap the rules — no shame in it."',
  ],
  player_blackjack: [
    '"Blackjack. Pays three to two — my pleasure."',
    '"There it is. Twenty-one off the deal. Beautiful."',
    '"Natural. I do like watching that land."',
  ],
  player_bust: [
    '"Over the top. Happens to the best hands."',
    '"Twenty-two. One pip the wrong side of it."',
    '"Bust. The card was there — it just wasn\'t yours."',
  ],
  dealer_bust: [
    '"And I break. Serves me right for chasing it."',
    '"Over I go. The house does that sometimes."',
    '"Busted myself. Pay the man."',
  ],
  push: [
    '"Push. Nobody moves."',
    '"Even hands. Your stake stays where it is."',
    '"A tie. We go again."',
  ],
  big_win: [
    '"That is a genuine result. Well played."',
    '"Nicely done. The rack feels that one."',
    '"You read that hand right. Credit where it\'s due."',
  ],
  reshuffle: [
    '"Fresh deck. Everything you counted just went back in."',
    '"Shuffling up. Fifty-two again, all of it live."',
    '"New shoe. Clean slate for both of us."',
  ],
  turned_away: [
    '"House minimum\'s ten, friend. Table\'s here whenever you are."',
    '"Come back with a few coins and I\'ll deal you in — seat\'s yours."',
    '"No stake, no hand. No hurry either. I\'ll keep the seat warm."',
  ],
  long_session: [
    '"You\'ve been here a while. Suits me — good company."',
    '"Twenty hands in and still sharp. I notice these things."',
    '"Long session. Say the word if you want a fresh deck."',
  ],
};

/**
 * A random line for `trigger` that is not `lastLine`, so the same words never
 * fire twice running.
 */
export function pickDeuceLine(trigger: BanterTrigger, lastLine: string | null): string {
  const pool = DEUCE_LINES[trigger];
  const fresh = pool.filter((line) => line !== lastLine);
  const candidates = fresh.length > 0 ? fresh : pool;
  return candidates[Math.floor(Math.random() * candidates.length)];
}
