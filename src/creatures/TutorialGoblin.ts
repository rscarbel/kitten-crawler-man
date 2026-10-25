import { Goblin } from './Goblin';
import { prewarmGoblin, prewarmGoblinCombat, type GoblinWeapon } from '../sprites/goblinSprite';
import type { Player } from '../Player';
import type { PlayerDamageType } from './Mob';
import type { TacticsTrait } from './tactics/tacticsTraits';
import { drawQuestBeacon } from '../sprites/questBeacon';
import { QUEST_MARKER_GOLD } from '../sprites/questNPCSprite';

const TUTORIAL_HP = 1;
const TUTORIAL_TACTICS: readonly TacticsTrait[] = [];
const MISSILE_DAMAGE_TYPE = 'missile' satisfies PlayerDamageType;
/**
 * Every tutorial goblin's kill XP, whatever the difficulty or level, because
 * the tutorial teaches spending a stat point on exactly one level-up: the human's
 * on the smush. At the dealer's 85% share goblin A pays him 4 of the 10 his
 * first level costs and the first guard 4 more, so it is the second guard,
 * dying in the same smush, that carries him over. The cat's small shares and
 * goblin B leave her short of a level the tutorial never explains.
 */
const TUTORIAL_GOBLIN_KILL_XP = 5;

/** A goblin with 1 HP that never deals damage — used in the tutorial. */
export class TutorialGoblin extends Goblin {
  /** When true the goblin doesn't move or attack at all. */
  private readonly isStationary: boolean;
  /** When true the goblin stands still but still attacks targets in melee range. */
  private readonly defenseOnly: boolean;
  /**
   * When true only a Magic Missile can hurt it. Goblin B exists to teach the
   * cat's spell, and Smush hits everything in its blast with no regard for
   * walls, so without this the human could take the lesson from her.
   */
  private readonly missileOnly: boolean;

  override readonly harmless = true;

  /**
   * Set by the tutorial while this goblin is the step's target, so it stands
   * in the same quest beam a new player will later follow to every quest giver.
   */
  isCurrentObjective = false;

  constructor(
    tileX: number,
    tileY: number,
    tileSize: number,
    weapon: GoblinWeapon = 'mace',
    stationary = false,
    defenseOnly = false,
    missileOnly = false,
  ) {
    super(tileX, tileY, tileSize, weapon);
    this.hp = TUTORIAL_HP;
    this.setFixedMaxHp(TUTORIAL_HP);
    this.isStationary = stationary;
    this.defenseOnly = defenseOnly;
    this.missileOnly = missileOnly;
    // Placed with the tutorial map, behind its loading screen, and the first
    // of them stands in the opening view waiting to be hit: its blows and its
    // flinch are as much its opening rows as its stance.
    prewarmGoblin(weapon);
    prewarmGoblinCombat(weapon);
  }

  protected override admitsPlayerDamage(damageType: PlayerDamageType | null): boolean {
    if (this.missileOnly) return damageType === MISSILE_DAMAGE_TYPE;
    return super.admitsPlayerDamage(damageType);
  }

  override get scaledXpValue(): number {
    return TUTORIAL_GOBLIN_KILL_XP;
  }

  /**
   * None of the goblin's tactics. A tutorial goblin exists to be hit, and a
   * guard on the blow that is meant to teach the attack key teaches nothing.
   */
  protected override get tacticsEligibility(): readonly TacticsTrait[] {
    return TUTORIAL_TACTICS;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (this.isAlive && this.isCurrentObjective) {
      const sx = this.x - camX;
      const sy = this.y - camY;
      drawQuestBeacon(ctx, sx, sy, tileSize, camX, camY, performance.now(), QUEST_MARKER_GOLD);
    }
    super.drawSelf(ctx, camX, camY, tileSize);
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
