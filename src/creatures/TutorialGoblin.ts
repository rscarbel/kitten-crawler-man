import { Goblin } from './Goblin';
import type { GoblinWeapon } from './Goblin';
import type { Player } from '../Player';

const TUTORIAL_HP = 1;

/** A goblin with 1 HP that never deals damage — used in the tutorial. */
export class TutorialGoblin extends Goblin {
  /** When true the goblin doesn't move or attack at all. */
  private readonly isStationary: boolean;
  /** When true the goblin stands still but still attacks targets in melee range. */
  private readonly defenseOnly: boolean;

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    weapon: GoblinWeapon = 'club',
    skinColor = '#7a9c3c',
    eyeColor = '#1a1a1a',
    stationary = false,
    defenseOnly = false,
  ) {
    super(tileX, tileY, tileSize, weapon, skinColor, eyeColor);
    this.hp = TUTORIAL_HP;
    this.maxHp = TUTORIAL_HP;
    this.attackDamage = 0;
    this.isStationary = stationary;
    this.defenseOnly = defenseOnly;
  }

  override updateAI(targets: Player[]): void {
    if (this.isStationary) return;
    if (this.defenseOnly) {
      this.updateAIStandAndFight(targets);
      return;
    }
    super.updateAI(targets);
  }
}
