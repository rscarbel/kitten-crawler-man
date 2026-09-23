import { Goblin } from './Goblin';
import type { GoblinWeapon } from '../sprites/goblinSprite';
import type { Player } from '../Player';
import type { TacticsTrait } from './tactics/tacticsTraits';

const TUTORIAL_HP = 1;
const TUTORIAL_TACTICS: readonly TacticsTrait[] = [];

/** A goblin with 1 HP that never deals damage — used in the tutorial. */
export class TutorialGoblin extends Goblin {
  /** When true the goblin doesn't move or attack at all. */
  private readonly isStationary: boolean;
  /** When true the goblin stands still but still attacks targets in melee range. */
  private readonly defenseOnly: boolean;

  override readonly harmless = true;

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    weapon: GoblinWeapon = 'mace',
    stationary = false,
    defenseOnly = false,
  ) {
    super(tileX, tileY, tileSize, weapon);
    this.hp = TUTORIAL_HP;
    this.setFixedMaxHp(TUTORIAL_HP);
    this.isStationary = stationary;
    this.defenseOnly = defenseOnly;
  }

  /**
   * None of the goblin's tactics. A tutorial goblin exists to be hit, and a
   * guard on the blow that is meant to teach the attack key teaches nothing.
   */
  protected override get tacticsEligibility(): readonly TacticsTrait[] {
    return TUTORIAL_TACTICS;
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
