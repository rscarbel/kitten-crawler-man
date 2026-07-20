import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawCityElfCultistSprite } from '../sprites/cityElfCultistSprite';
import { type SoulBolt, fireSoulBolt, advanceSoulBolts, renderSoulBolts } from './soulBolt';
import { AGGRO_PERSIST_MULTIPLIER } from '../core/constants';

const CULTIST_HP = 22;
const CULTIST_SPEED = 1.15;

const AGGRO_RANGE_TILES = 8;
/** Cultists keep their distance and cast from afar. */
const CAST_RANGE_TILES = 5.5;
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
  private castCooldown = 0;
  private castAnimTimer = 0;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, CULTIST_HP, CULTIST_SPEED);
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.castCooldown > 0) this.castCooldown--;
    if (this.castAnimTimer > 0) this.castAnimTimer--;

    this.bolts = advanceSoulBolts(this.bolts, this.map, this.tileSize, targets, (t) =>
      this.dealDamage(t, BOLT_DAMAGE),
    );

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const castRangePx = this.tileSize * CAST_RANGE_TILES;
    const aggroScanRange = this.isAggro ? aggroRangePx * AGGRO_PERSIST_MULTIPLIER : aggroRangePx;

    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const dist = Math.hypot(t.x - this.x, t.y - this.y);
      if (dist < aggroScanRange && dist < nearestDist) {
        nearestDist = dist;
        nearest = t;
      }
    }

    this.currentTarget = nearest;

    if (!nearest) {
      this.isAggro = false;
      this.clearAStarPath();
      this.doWander();
      return;
    }
    this.isAggro = true;

    const handX = this.x + this.tileSize * CENTER_OFFSET;
    const handY = this.y + this.tileSize * CENTER_OFFSET;
    const targetCX = nearest.x + this.tileSize * CENTER_OFFSET;
    const targetCY = nearest.y + this.tileSize * CENTER_OFFSET;
    const hasLOS = this.map ? this.map.hasLineOfSight(handX, handY, targetCX, targetCY) : true;

    if (hasLOS) {
      this.lastKnownTargetX = nearest.x;
      this.lastKnownTargetY = nearest.y;
    }

    if (!hasLOS) {
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

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
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

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
