import type { SoundId } from '../audio/sounds';

/**
 * Something a scripted interior needs done by the scene that holds it: raised
 * by the encounter's own update, drained by the scene once a frame and carried
 * out in the order given.
 *
 * - `party_reset` — the encounter has moved both crawlers itself. The scene
 *   parks both where they now stand, brings the companions along and drops any
 *   exit offer made where the party no longer is.
 * - `party_release` — both crawlers come off the anchors the encounter parked
 *   them on and go back to following.
 * - `sound` — a cue played on the scene's audio.
 * - `coin_drop` — coins owed to the human crawler, dropped at a tile so they
 *   fall and land before they are collected.
 */
export type InteriorEncounterRequest =
  | { readonly kind: 'party_reset' }
  | { readonly kind: 'party_release' }
  | { readonly kind: 'sound'; readonly id: SoundId; readonly volume?: number }
  | {
      readonly kind: 'coin_drop';
      readonly tile: { readonly x: number; readonly y: number };
      readonly coins: number;
    };

/** A conversation an encounter opens on the scene's shared box, which Escape may close. */
export interface InteriorEncounterDialog {
  isOpen(): boolean;
  /** Closes the encounter's box; true when one was closed. */
  dismiss(): boolean;
}
