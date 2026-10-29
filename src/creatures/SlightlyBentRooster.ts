import { RoosterMinion, type RoosterMinionBuild } from './RoosterMinion';

/**
 * Tougher and slower than Little Rooster, and the more likely of the pair to
 * lead with the fist.
 */
export const SLIGHTLY_BENT_ROOSTER: RoosterMinionBuild = {
  maxHp: 65,
  speed: 0.6,
  xpValue: 24,
  peckShare: 0.25,
  art: 'bent',
};

/** A battered old rooster who guards Big Rooster's gym door and punches first. */
export class SlightlyBentRooster extends RoosterMinion {
  displayName = 'Slightly Bent Rooster';
  description = 'Took a few too many to the comb. Still throws a mean right.';

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, SLIGHTLY_BENT_ROOSTER);
  }
}
