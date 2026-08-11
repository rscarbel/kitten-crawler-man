import { Mob } from './Mob';
import type { Player } from '../Player';
import { drawCityElfCultistSprite } from '../sprites/cityElfCultistSprite';
import { type SoulBolt, fireSoulBolt, advanceSoulBolts, renderSoulBolts } from './soulBolt';

const CULTIST_HP = 22;
const CULTIST_SPEED = 1.15;

/**
 * How far a cultist notices from. Exported for the same reason Miss Quill's cast
 * range is: the tower confrontation's spawn offsets are only correct relative to
 * this number, and a gate holding them to a copy of it would go green the day it
 * moved.
 */
export const CITY_ELF_CULTIST_AGGRO_RANGE_TILES = 8;
/** Cultists keep their distance and cast from afar. */
const CAST_RANGE_TILES = 5.5;
/**
 * Below this the cultist backs off rather than standing its ground — without a
 * floor under the cast band, a player who simply walks up gets an enemy that
 * plants its feet and eats hits, which is the opposite of "keeps its distance".
 */
const CAST_RANGE_MIN_TILES = 3;
/** How long one retreat lasts, and how long before the next one can start. */
const RETREAT_MAX_FRAMES = 70;
const RETREAT_COOLDOWN_FRAMES = 150;
/** Frames between soul-bolt casts (~2.3 s at 60 fps). */
const CAST_COOLDOWN = 140;
const CAST_ANIM_FRAMES = 24;
const BOLT_DAMAGE = 5;
const COIN_DROP_MIN = 2;
const COIN_DROP_MAX = 5;
const CENTER_OFFSET = 0.5;
const FOLLOW_STOP_RANGE_TILES = 1.5;
const FOLLOW_CLOSE_RANGE_RATIO = 0.85;

/**
 * A city elf cultist — one of Miss Quill's hooded faithful, who believe the
 * skyfowl circling the Over City are angels. A ranged caster that holds its
 * distance and hurls soul bolts (pattern: Lava Llama's spit cycle).
 */
export class CityElfCultist extends Mob {
  readonly xpValue = 14;
  protected coinDropMin = COIN_DROP_MIN;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'City Elf Cultist';
  description = 'A hooded elf hurling bolts of harvested soul-stuff for the angels above.';

  private bolts: SoulBolt[] = [];

  override clearAirborneAttacks(): void {
    this.bolts.length = 0;
  }
  private castCooldown = 0;
  private castAnimTimer = 0;
  private isAggro = false;
  private retreatFrames = 0;
  private retreatCooldown = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, CULTIST_HP, CULTIST_SPEED);
  }

  override resetToSpawn(): void {
    super.resetToSpawn();
    this.bolts = [];
    this.castCooldown = 0;
    this.castAnimTimer = 0;
    this.isAggro = false;
    this.retreatFrames = 0;
    this.retreatCooldown = 0;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.castCooldown > 0) this.castCooldown--;
    if (this.castAnimTimer > 0) this.castAnimTimer--;
    if (this.retreatCooldown > 0) this.retreatCooldown--;

    this.bolts = advanceSoulBolts(this.bolts, this.map, this.tileSize, targets, (t) =>
      this.dealRangedDamage(t, BOLT_DAMAGE),
    );

    const aggroRangePx = this.tileSize * CITY_ELF_CULTIST_AGGRO_RANGE_TILES;
    const castRangePx = this.tileSize * CAST_RANGE_TILES;
    const castRangeMinPx = this.tileSize * CAST_RANGE_MIN_TILES;
    const nearest = this.acquireTarget(targets, aggroRangePx);

    this.currentTarget = nearest;

    if (!nearest) {
      this.isAggro = false;
      this.retreatFrames = 0;
      this.clearAStarPath();
      // A cultist posted by an encounter carries a `homePoint` and a leash, and
      // only this path consults them: an idle drift of a tile or two is nothing
      // in a hideout and is the whole margin in a room where the party's
      // arrival tile sits just outside this aggro range.
      this.returnHomeOrWander();
      return;
    }
    this.isAggro = true;
    const nearestDist = this.distanceTo(nearest);

    const handX = this.x + this.tileSize * CENTER_OFFSET;
    const handY = this.y + this.tileSize * CENTER_OFFSET;
    const targetCX = nearest.x + this.tileSize * CENTER_OFFSET;
    const targetCY = nearest.y + this.tileSize * CENTER_OFFSET;
    const hasLOS = this.map ? this.map.hasLineOfSight(handX, handY, targetCX, targetCY) : true;

    if (hasLOS) {
      this.lastKnownTargetX = nearest.x;
      this.lastKnownTargetY = nearest.y;
    }

    const isCrowded = hasLOS && nearestDist < castRangeMinPx;
    if (isCrowded && this.retreatFrames === 0 && this.retreatCooldown === 0) {
      this.retreatFrames = RETREAT_MAX_FRAMES;
      this.retreatCooldown = RETREAT_COOLDOWN_FRAMES;
    }

    if (this.retreatFrames > 0) {
      this.retreatFrames--;
      if (nearestDist >= castRangeMinPx) {
        this.retreatFrames = 0;
        this.isMoving = false;
      } else {
        this.backAwayFrom(nearest);
      }
    } else if (!hasLOS) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.tileSize * FOLLOW_STOP_RANGE_TILES,
      );
    } else if (nearestDist > castRangePx) {
      this.followTargetAStar(
        nearest.x,
        nearest.y,
        this.speed,
        castRangePx * FOLLOW_CLOSE_RANGE_RATIO,
      );
    } else {
      this.isMoving = false;
      this.facingX = targetCX >= handX ? 1 : -1;
    }

    if (hasLOS && nearestDist <= castRangePx && this.castCooldown === 0) {
      this.bolts.push(fireSoulBolt(handX, handY, targetCX, targetCY));
      this.castCooldown = CAST_COOLDOWN;
      this.castAnimTimer = CAST_ANIM_FRAMES;
      this.projectileSoundPending = true;
    }
  }

  /**
   * Retreats directly away from a target that has closed inside the cast band.
   *
   * Straight-line rather than pathfound, same as the goblin archer's kite: a
   * cultist that A*s its way backwards around a corner spends the whole
   * retreat facing its own path and never casts.
   */
  private backAwayFrom(target: Player): void {
    const dx = this.x - target.x;
    const dy = this.y - target.y;
    const distance = Math.hypot(dx, dy);
    if (distance === 0) return;
    this.moveWithCollision((dx / distance) * this.speed, (dy / distance) * this.speed);
    this.isMoving = true;
    this.facingX = target.x >= this.x ? 1 : -1;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive) return;

    renderSoulBolts(ctx, this.bolts, camX, camY);

    const sx = this.x - camX;
    const sy = this.y - camY;

    if (this.isAggro) {
      this.renderAggroIndicator(ctx, sx, sy, tileSize);
    }

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    const castAnim = this.castAnimTimer > 0 ? 1 - this.castAnimTimer / CAST_ANIM_FRAMES : 0;
    drawCityElfCultistSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.walkFrame,
      this.isMoving,
      castAnim,
      this.facingX,
    );

    if (this.damageFlash > 0) ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
