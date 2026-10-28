/**
 * Who the player's human crawler is this run. There is only one player, and
 * every picture and line of them must agree, so the identity is held here
 * once, the same way the human's resident look is held in `humanSprite.ts`.
 *
 * This module holds data only: the look follows the identity through
 * {@link followPlayerIdentity}, which the human's sprite subscribes to, so the
 * name can be read (by item text, saves, the server's save check) without
 * loading any art.
 */

import type { PlayerName } from '../core/naming/playerName';
import type { Complexion, CrawlerBody } from './crawlerChoices';

/** What the player chose at character creation; the run's only source of the human's name and look. */
export interface PlayerIdentity {
  /** Only `parsePlayerName` makes one. */
  readonly name: PlayerName;
  readonly body: CrawlerBody;
  readonly complexion: Complexion;
}

type IdentityFollower = (identity: PlayerIdentity) => void;

let current: PlayerIdentity | null = null;
const followers: IdentityFollower[] = [];

/** Makes `identity` the run's, and tells everything following it, so its look becomes the human's only resident one. */
export function setPlayerIdentity(identity: PlayerIdentity): void {
  current = identity;
  for (const follower of followers) follower(identity);
}

/**
 * Calls `follower` with every identity the run is given from now on, and at
 * once with the current one when there is one, so a follower that loads after
 * the identity was set still sees it.
 */
export function followPlayerIdentity(follower: IdentityFollower): void {
  followers.push(follower);
  if (current !== null) follower(current);
}

/**
 * The run's identity. Throws when none is set, so a module that reads the
 * name when it loads, before any run has one, fails on its first run instead
 * of baking a stale name into its text.
 */
export function playerIdentity(): PlayerIdentity {
  if (current === null) {
    throw new Error('playerIdentity() read before setPlayerIdentity: no run has an identity yet');
  }
  return current;
}

/** The run's identity, or null before a fresh player has made one. For the title screen alone. */
export function maybePlayerIdentity(): PlayerIdentity | null {
  return current;
}
