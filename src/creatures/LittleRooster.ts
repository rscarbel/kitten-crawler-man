import { RoosterMinion, type RoosterMinionBuild } from './RoosterMinion';

/**
 * Lighter and quicker than Slightly Bent Rooster, and the more likely of the
 * pair to lead with the beak.
 */
export const LITTLE_ROOSTER: RoosterMinionBuild = {
  maxHp: 45,
  speed: 0.85,
  xpValue: 16,
  peckShare: 0.75,
  art: 'little',
};

/** A scrappy young cockerel who guards Big Rooster's gym door and pecks first. */
export class LittleRooster extends RoosterMinion {
  displayName = 'Little Rooster';
  description = 'A scrappy cockerel with new arms and something to prove.';

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, LITTLE_ROOSTER);
  }
}
