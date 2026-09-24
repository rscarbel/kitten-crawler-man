import type { Player } from '../../Player';
import type { Mob } from '../Mob';
import {
  hpScaleForLevel,
  scaledCooldownFramesForLevel,
  SHARED_LEVELLED_CURVE,
  type LevelledCurve,
} from '../mobLevelScaling';
import { drawHealStream } from '../../sprites/art/fairyEffectsArt';
import {
  Fairy,
  type ActiveFairyCast,
  type FairyCast,
  type FairyCastIntent,
  type FairyPositioning,
} from './Fairy';
import type { FairyKind } from '../../sprites/art/fairyTiming';
import { applyFairyHeal } from './fairyHeal';
import {
  BOSS_HEAL_SCALE,
  HEAL_AMOUNT_CAP_BASE,
  HEAL_COOLDOWN_FRAMES,
  HEAL_COOLDOWN_MIN_FRAMES,
  HEAL_FRACTION_OF_TARGET_MAX_HP,
  HEAL_RANGE_TILES,
  HEAL_TRIGGER_HP_FRACTION,
  HEALER_PREFERRED_RANGE_TILES,
  HEALER_SUPPORT_LEASH_TILES,
} from './fairyTuning';

const POSITIONING: FairyPositioning = {
  preferredRangeTiles: HEALER_PREFERRED_RANGE_TILES,
  supportLeashTiles: HEALER_SUPPORT_LEASH_TILES,
};

/** Lands the frame it is chosen. */
export const HEAL_CAST: FairyCast = {
  id: 'heal',
  row: 'cast_heal',
  cooldownFrames: HEAL_COOLDOWN_FRAMES,
  minCooldownFrames: HEAL_COOLDOWN_MIN_FRAMES,
};

const HEALER_CASTS: readonly FairyCast[] = [HEAL_CAST];

const FRAMES_PER_SECOND = 60;

/** Frames the bloom on a healed ally lingers after the release. */
const RELEASE_FLASH_FRAMES = 24;

/** Where on a sprite's tile its centre of mass sits, as a share of a tile. */
const TILE_CENTRE = 0.5;

/**
 * How far above its tile centre the stream lands on the ally, in tiles: at the
 * chest, where a heal reads as landing on the body rather than its feet.
 */
const TARGET_CHEST_LIFT_TILES = 0.15;

/** Spread of per-fairy stream seeds, so two healers never shed identical sparkles. */
const STREAM_SEED_RANGE = 1_000_000;

/**
 * HP one heal restores on a target of `targetMaxHp` from a healer at `level`:
 * a share of the target's max HP (less on a boss), capped by a level-scaled
 * amount so a large body never turns that share into more healing than the
 * party can out-damage. The target's own heal ceiling clamps it again when it
 * lands.
 */
export function healingFairyHealAmount(
  level: number,
  targetMaxHp: number,
  isBoss: boolean,
  curve: LevelledCurve = SHARED_LEVELLED_CURVE,
): number {
  const bossScale = isBoss ? BOSS_HEAL_SCALE : 1;
  const shareOfTarget = targetMaxHp * HEAL_FRACTION_OF_TARGET_MAX_HP * bossScale;
  const levelledCap = HEAL_AMOUNT_CAP_BASE * hpScaleForLevel(level, curve);
  return Math.max(0, Math.min(shareOfTarget, levelledCap));
}

/** Frames between one heal and the next, at `level`. */
export function healingFairyCooldownFrames(level: number): number {
  const scaled = scaledCooldownFramesForLevel(HEAL_COOLDOWN_FRAMES, level);
  return Math.max(scaled, HEAL_COOLDOWN_MIN_FRAMES);
}

/**
 * The most HP per second one healer at `level` can restore to a single target
 * of `targetMaxHp`. Every heal is followed by the full cooldown, so the
 * cooldown is the shortest possible gap between two heals. Exported for the gate
 * that holds it under a share of the reference party's damage.
 */
export function healingFairyHealPerSecond(
  level: number,
  targetMaxHp: number,
  isBoss: boolean,
  curve: LevelledCurve = SHARED_LEVELLED_CURVE,
): number {
  const perHeal = healingFairyHealAmount(level, targetMaxHp, isBoss, curve);
  return (perHeal * FRAMES_PER_SECOND) / healingFairyCooldownFrames(level);
}

/** The green fairy: heals the most wounded ally, and releases a healing wave when it dies. */
export class HealingFairy extends Fairy {
  readonly kind: FairyKind = 'healer';
  protected readonly positioning = POSITIONING;
  readonly xpValue = 6;
  protected coinDropMin = 0;
  protected coinDropMax = 2;
  displayName = 'Healing Fairy';
  description = 'A leaf-green fairy that mends the wounded, and heals the whole room when it dies.';

  /** The ally the last heal landed on, for the bloom drawn after the release. */
  private flashTarget: Mob | null = null;
  private flashFramesLeft = 0;
  private readonly streamSeed = Math.floor(Math.random() * STREAM_SEED_RANGE);

  protected override get casts(): readonly FairyCast[] {
    return HEALER_CASTS;
  }

  /** Stays with the most wounded ally, so it is already in range when the heal comes off cooldown. */
  protected override get supportTarget(): Mob | null {
    return this.mostWoundedAlly(false);
  }

  /** How much one heal from this fairy restores to `target` before its ceiling. */
  healAmountFor(target: Mob): number {
    return healingFairyHealAmount(this.mobLevel, target.maxHp, target.isBoss, this.levelledCurve);
  }

  protected override chooseCast(_crawler: Player | null): FairyCastIntent | null {
    if (!this.isCastReady(HEAL_CAST)) return null;
    const target = this.mostWoundedAlly(true);
    if (target === null) return null;
    return { cast: HEAL_CAST, target, aimX: target.x, aimY: target.y };
  }

  protected override onCastReleased(cast: ActiveFairyCast): void {
    const target = this.allies.find((ally) => ally === cast.target);
    if (target === undefined) return;
    const healed = applyFairyHeal(target, this.healAmountFor(target));
    if (healed <= 0) return;
    this.flashTarget = target;
    this.flashFramesLeft = RELEASE_FLASH_FRAMES;
  }

  protected override clearEncounterPhase(): void {
    super.clearEncounterPhase();
    this.flashTarget = null;
    this.flashFramesLeft = 0;
  }

  override updateAI(targets: Player[]): void {
    if (this.flashFramesLeft > 0) this.flashFramesLeft--;
    super.updateAI(targets);
  }

  /**
   * The living ally with the lowest share of its max HP under
   * {@link HEAL_TRIGGER_HP_FRACTION} that a heal would actually raise. With
   * `castable`, only one within {@link HEAL_RANGE_TILES} and in clear sight —
   * a heal through a wall would read as the fairy cheating.
   */
  protected mostWoundedAlly(castable: boolean): Mob | null {
    const rangePx = this.tileSize * HEAL_RANGE_TILES;
    let best: Mob | null = null;
    let bestFraction = HEAL_TRIGGER_HP_FRACTION;
    for (const ally of this.allies) {
      if (!ally.isAlive || ally.hp <= 0 || ally.refusesDamage || ally.maxHp <= 0) continue;
      const fraction = ally.hp / ally.maxHp;
      if (fraction >= bestFraction) continue;
      const roomUnderCeiling = Math.min(ally.maxHp, ally.fairyHealCeiling) - ally.hp;
      if (roomUnderCeiling <= 0) continue;
      if (castable && (this.distanceTo(ally) > rangePx || !this.canSeeAlly(ally))) continue;
      best = ally;
      bestFraction = fraction;
    }
    return best;
  }

  protected canSeeAlly(ally: Mob): boolean {
    const map = this.map;
    if (map === null) return true;
    const centre = this.tileSize * TILE_CENTRE;
    return map.hasLineOfSight(this.x + centre, this.y + centre, ally.x + centre, ally.y + centre);
  }

  override drawAirEffects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    frame: number,
  ): void {
    const ts = this.tileSize;
    const hands = this.castOrigin;
    const handsX = hands.x - camX;
    const handsY = hands.y - camY;
    const flashTarget = this.flashTarget;
    if (this.flashFramesLeft > 0 && flashTarget !== null) {
      const flash = this.flashFramesLeft / RELEASE_FLASH_FRAMES;
      const { x, y } = allyChest(flashTarget, ts);
      drawHealStream(ctx, handsX, handsY, x - camX, y - camY, 0, frame, this.streamSeed, flash);
    }
  }
}

function allyChest(ally: Mob, tileSize: number): { x: number; y: number } {
  return {
    x: ally.x + tileSize * TILE_CENTRE,
    y: ally.y + tileSize * (TILE_CENTRE - TARGET_CHEST_LIFT_TILES),
  };
}
