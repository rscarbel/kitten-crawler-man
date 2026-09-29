/**
 * The one rule for when a talk surface the player can walk around during —
 * a street conversation, a counter, a structure's menu — ends because the
 * player walked off.
 *
 * Every such surface is opened from within some range of the thing it belongs
 * to, and closes once the player is a fixed margin beyond that same range.
 * Deriving the close from the open, instead of each surface picking its own
 * number, is what keeps a menu from outliving the conversation: a player who
 * has turned to talk to someone else a couple of tiles away is done with the
 * first one, and generous per-surface radii (six tiles, or "until you leave the
 * room") left the old box up over the new speaker.
 *
 * The margin is also the hysteresis. Anywhere the surface could have been
 * opened from, plus a tile of shuffling while reading, never closes it; only a
 * step that genuinely leaves does.
 */

/** How far past a surface's open range, in tiles, the player may drift before it closes. */
export const WALK_AWAY_MARGIN_TILES = 1;

/** The distance, in tiles, at which a surface opened from within `openRangeTiles` closes itself. */
export function walkAwayRangeTiles(openRangeTiles: number): number {
  return openRangeTiles + WALK_AWAY_MARGIN_TILES;
}
