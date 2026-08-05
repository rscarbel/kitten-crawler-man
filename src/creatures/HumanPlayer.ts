import { Player, WALK_FRAME_SPEED, type StatName, type StatusFigureBox } from '../Player';
import { TILE_SIZE } from '../core/constants';

/**
 * How far the top of his hair sits above the tile anchor at the in-game tile
 * size. Measured off the generated sheet: the standing rows top out 22px above
 * the anchor. Re-measure it whenever `HUMAN_SCALE` in the generator changes.
 */
const HUMAN_SPRITE_TOP_ABOVE_TILE = 22;

/** Where his soles land, in tile fractions — a hair short of the tile's foot. */
const HUMAN_SOLE_BELOW_TILE_TOP = 0.98;

/**
 * Half his shoulder-to-shoulder width in tile fractions. He is a narrow figure:
 * flames or drips spread across the full tile would visibly miss him.
 */
const HUMAN_HALF_WIDTH_TILES = 0.3;

/**
 * Carl's ink, measured off `src/images/characters/human.png` against the
 * manifest's tile anchor. Exported so `StatusPreviewScene` reviews effects on
 * the same box the game paints them on — a harness using its own numbers can
 * only prove that the harness's numbers work.
 */
export const HUMAN_STATUS_FIGURE_BOX: StatusFigureBox = {
  centerX: 0.5,
  top: -HUMAN_SPRITE_TOP_ABOVE_TILE / TILE_SIZE,
  bottom: HUMAN_SOLE_BELOW_TILE_TOP,
  halfWidth: HUMAN_HALF_WIDTH_TILES,
};
import type { Mob } from './Mob';
import {
  drawHumanSprite,
  SMUSH_FRAME_COUNT,
  SMUSH_IMPACT_FRAME,
  type HumanAttackPhase,
} from '../sprites/humanSprite';
import { drawActivePlayerMarker } from '../sprites/activePlayerMarker';
import type { AbilityManager } from '../core/AbilityManager';
import { getSmushStats } from '../abilities/smush';
import { ITEM_DEF } from '../core/ItemDefs';
import type { CrawlerKind } from '../core/SkillManager';

/** Single source for this class's crawler identity — used by the UI and by skill eligibility. */
const HUMAN_CRAWLER_KIND: CrawlerKind = 'human';
import { PUGILISM_DAMAGE_PER_LEVEL } from '../core/SkillManager';

/** Short label the level-up flash shows for Explosives Handling. */
const EXPLOSIVES_HANDLING_CODE = 'EXP';

/** The human alone can invest points in Explosives Handling. */
export type HumanSpendableStat = StatName | 'explosivesHandling';

/**
 * This is a playable character.
 * The human has the power "brawl"
 * which is a powerful short range attack
 * it can be a punch of a stomp called "smush"
 */
export class HumanPlayer extends Player {
  /** Which half of the skill roster this crawler is eligible for. */
  readonly crawlerKind = HUMAN_CRAWLER_KIND;
  /** Increases dynamite damage and throw distance. */
  explosivesHandling = 1;

  private abilityManager: AbilityManager | null = null;

  attackPhase: HumanAttackPhase = null;
  attackTimer = 0;
  readonly ATTACK_FRAMES = 18;
  private nextSideType: 'punch_side' | 'kick_side' = 'punch_side';
  private autoAttackCooldown = 0;
  private readonly AUTO_ATTACK_COOLDOWN = 90;

  smushTimer = 0;
  smushCooldown = 0;
  readonly SMUSH_FRAMES = 44;
  /**
   * The tick the stamp lands on, derived from where the impact sits in the
   * animation rather than hard-coded: `drawHumanSprite` picks its frame from
   * `1 - smushTimer / SMUSH_FRAMES`, so the timer that shows the impact frame
   * is the one the blast has to fire on. It floors rather than rounds because
   * `progressFrameIndex` floors — rounding lets the blast drift a frame ahead
   * of the sole the moment either constant changes.
   */
  private readonly SMUSH_HIT_TIMER = Math.floor(
    this.SMUSH_FRAMES * (1 - SMUSH_IMPACT_FRAME / SMUSH_FRAME_COUNT),
  );

  /** The mob the human will automatically fight when not player-controlled. */
  autoTarget: Mob | null = null;

  /** Species HP floor: 8 + CON 1 × 2 = 10 starting max HP. */
  private static readonly HUMAN_BASE_HP_OFFSET = 8;
  /** An ordinary human is not especially nimble. */
  private static readonly HUMAN_STARTING_DEXTERITY = 2;
  private static readonly STARTING_POTIONS = 10;
  private static readonly FACING_Y_THRESHOLD = 0.5;
  private static readonly MELEE_RANGE_MULTIPLIER = 1.95;
  private static readonly ACTIVE_SPHERE_RADIUS = 4;
  /** Distance above the sprite so the sphere sits just below the health bar. */
  private static readonly ACTIVE_SPHERE_GAP = 3;
  /** The marker and health bar are stacked from the top of his hair. */
  private static readonly SPRITE_TOP_ABOVE_TILE = HUMAN_SPRITE_TOP_ABOVE_TILE;
  /** Extra lift from the marker sphere's centre up to the health bar's anchor. */
  private static readonly BAR_LIFT_ABOVE_SPHERE = 7;
  /** Offset from tile anchor so sphere sits in the gap between head top and health bar bottom. */
  private static readonly ACTIVE_SPHERE_SPRITE_TOP = HumanPlayer.SPRITE_TOP_ABOVE_TILE;
  private static readonly HEALTH_BAR_Y_OFFSET =
    HumanPlayer.SPRITE_TOP_ABOVE_TILE + HumanPlayer.BAR_LIFT_ABOVE_SPHERE;
  /**
   * Waist height. His standing figure spans `SPRITE_TOP_ABOVE_TILE + TILE_SIZE`
   * = 54 px from sole to hair, and a waist sits at about half a person's height.
   */
  /** How much faster than the shared default his cycle turns over. */
  private static readonly GAIT_RATE = 1.3;
  readonly waterlineAboveFootPx = 27;
  /**
   * His stride is short — a stride the leg can actually reach — so the cycle has
   * to turn over faster than the shared default to match the ground he covers.
   */
  protected override walkFrameSpeed = WALK_FRAME_SPEED * HumanPlayer.GAIT_RATE;
  private static readonly SPRITE_HORIZONTAL_OFFSET = 0.5;
  private static readonly SPRITE_VERTICAL_OFFSET = 0.5;

  /**
   * He stands two thirds of a tile taller than his own tile and is only three
   * fifths of one wide. Status effects are painted over this box, so a burn
   * spread across his tile instead would pile up around his shins and never
   * reach his chest.
   */
  protected override get statusFigureBox(): StatusFigureBox {
    return HUMAN_STATUS_FIGURE_BOX;
  }

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, {
      baseHpOffset: HumanPlayer.HUMAN_BASE_HP_OFFSET,
      baseStats: { dexterity: HumanPlayer.HUMAN_STARTING_DEXTERITY },
      crawlerKind: HUMAN_CRAWLER_KIND,
    });
    // Pre-equip Enchanted BigBoi Boxers — adds +2 CON (+4 maxHp)
    this.inventory.addItem('enchanted_bigboi_boxers', 1);
    this.inventory.equipByItemId('enchanted_bigboi_boxers');
    this.syncHpToMaxHp();
    // Pre-equip Smush tome in hotbar slot 0
    this.inventory.actionBar.slots[0] = { ...ITEM_DEF.smush_tome, quantity: 1 };
    // Move starting potions from bag to hotbar slot 1 for quick access
    this.inventory.removeItems('health_potion', HumanPlayer.STARTING_POTIONS);
    this.inventory.actionBar.slots[1] = {
      ...ITEM_DEF.health_potion,
      quantity: HumanPlayer.STARTING_POTIONS,
    };
  }

  setAbilityManager(manager: AbilityManager): void {
    this.abilityManager = manager;
  }

  getProtectiveShellLevel(): number {
    return this.abilityManager?.getLevel('protective_shell') ?? 1;
  }

  getSmushLevel(): number {
    return this.abilityManager?.getLevel('smush') ?? 1;
  }

  getSmushCooldownMax(): number {
    return getSmushStats(this.getSmushLevel()).cooldownFrames;
  }

  spendPoint(stat: HumanSpendableStat): void {
    if (stat === 'explosivesHandling') {
      if (!this.consumePointFor(EXPLOSIVES_HANDLING_CODE)) return;
      this.explosivesHandling++;
      return;
    }
    super.spendPoint(stat);
  }

  /** Crawlers dodge; the mobs they fight do not. */
  protected override get canDodge(): boolean {
    return true;
  }

  getMeleeDamage(): number {
    const pugilismBonus = PUGILISM_DAMAGE_PER_LEVEL * this.skills.getLevel('pugilism');
    return 1 + this.strength + this.statusMeleeDamageBonus + pugilismBonus;
  }

  triggerAttack() {
    if (this.attackTimer > 0 || this.smushTimer > 0) return;
    if (Math.abs(this.facingY) > HumanPlayer.FACING_Y_THRESHOLD) {
      this.attackPhase = this.facingY < 0 ? 'punch_up' : 'kick_down';
    } else {
      this.attackPhase = this.nextSideType;
      this.nextSideType = this.nextSideType === 'punch_side' ? 'kick_side' : 'punch_side';
    }
    this.attackTimer = this.ATTACK_FRAMES;
  }

  triggerSmush(): boolean {
    if (this.smushCooldown > 0 || this.smushTimer > 0 || this.attackTimer > 0) return false;
    this.smushTimer = this.SMUSH_FRAMES;
    return true;
  }

  updateAttack() {
    if (this.attackTimer > 0) this.attackTimer--;
    this.smushCooldown = this.tickCooldown(this.smushCooldown);
    if (this.smushTimer > 0) {
      this.smushTimer--;
      if (this.smushTimer === 0) {
        this.smushCooldown = getSmushStats(this.getSmushLevel()).cooldownFrames;
      }
    }
  }

  /** Returns true on the single frame when the melee hit connects (peak of the swing). */
  isAttackPeak(): boolean {
    return this.attackTimer === Math.ceil(this.ATTACK_FRAMES / 2);
  }

  /** Returns true on the single frame when the stamp lands and the blast goes off. */
  isSmushPeak(): boolean {
    return this.smushTimer === this.SMUSH_HIT_TIMER;
  }

  getMeleeRange(): number {
    return this.tileSize * HumanPlayer.MELEE_RANGE_MULTIPLIER;
  }

  /**
   * Clears mid-swing/cooldown state so a checkpoint restore doesn't resume an
   * attack frozen mid-animation from the encounter that killed the player.
   * Several of these fields are private, so `DungeonScene` can't clear them
   * directly and needs this entry point.
   */
  resetCombatState(): void {
    this.attackPhase = null;
    this.attackTimer = 0;
    this.smushTimer = 0;
    this.smushCooldown = 0;
    this.autoAttackCooldown = 0;
    this.autoTarget = null;
  }

  /**
   * Called every frame when the human is the follower and has an autoTarget.
   * Faces the target and attacks when in melee range.
   */
  autoFightTick() {
    if (!this.autoTarget?.isAlive) {
      this.autoTarget = null;
      return;
    }

    const dx =
      this.autoTarget.x +
      this.tileSize * HumanPlayer.SPRITE_HORIZONTAL_OFFSET -
      (this.x + this.tileSize * HumanPlayer.SPRITE_HORIZONTAL_OFFSET);
    const dy =
      this.autoTarget.y +
      this.tileSize * HumanPlayer.SPRITE_VERTICAL_OFFSET -
      (this.y + this.tileSize * HumanPlayer.SPRITE_VERTICAL_OFFSET);
    const dist = Math.hypot(dx, dy);
    if (dist > 0) {
      this.facingX = dx / dist;
      this.facingY = dy / dist;
    }

    if (dist <= this.getMeleeRange()) {
      if (this.autoAttackCooldown > 0) {
        this.autoAttackCooldown--;
      } else {
        this.triggerAttack();
        this.autoAttackCooldown = this.AUTO_ATTACK_COOLDOWN;
      }
    }
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ) {
    const sx = this.x - camX;
    const sy = this.y - camY;
    const s = tileSize;

    if (this.isActive) {
      const r = HumanPlayer.ACTIVE_SPHERE_RADIUS;
      const sphereCX = sx + s * HumanPlayer.SPRITE_HORIZONTAL_OFFSET;
      const sphereCY =
        sy - HumanPlayer.ACTIVE_SPHERE_SPRITE_TOP - HumanPlayer.ACTIVE_SPHERE_GAP - r;
      drawActivePlayerMarker(ctx, sphereCX, sphereCY, r);
    }

    drawHumanSprite(ctx, sx, sy, s, {
      attackPhase: this.attackPhase,
      attackTimer: this.attackTimer,
      attackFrames: this.ATTACK_FRAMES,
      smushTimer: this.smushTimer,
      smushFrames: this.SMUSH_FRAMES,
      walkFrame: this.walkFrame,
      isMoving: this.isMoving,
      facingX: this.facingX,
      facingY: this.facingY,
    });

    this.renderHealthBar(ctx, sx, sy - HumanPlayer.HEALTH_BAR_Y_OFFSET);
    this.renderKnockedOutOverlay(ctx, sx, sy);
  }
}
