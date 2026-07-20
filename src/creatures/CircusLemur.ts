import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawCircusLemurSprite, drawThrownKnife } from '../sprites/circusLemurSprite';
import { normalize } from '../utils';
import { AGGRO_PERSIST_MULTIPLIER } from '../core/constants';

interface ThrownKnife {
  x: number;
  y: number;
  vx: number;
  vy: number;
  rotation: number;
}

const LEMUR_HP = 6;
const LEMUR_SPEED = 2.6;
const AGGRO_RANGE_TILES = 7;
const MELEE_RANGE_TILES = 0.9;
/** Frames between nip attacks (~0.67 s at 60 fps) — fast, weak swarm bites. */
const MELEE_COOLDOWN = 40;
/** Frames the nip lunge animation plays. */
const MELEE_ANIM_FRAMES = 14;
const MELEE_DAMAGE = 3;
/** Knife act — the lemurs' old sideshow trick, now aimed at crawlers. */
const KNIFE_RANGE_TILES = 5;
const KNIFE_SPEED = 3.2;
const KNIFE_DAMAGE = 3;
/** Frames between throws (~1.8 s at 60 fps). */
const THROW_COOLDOWN = 110;
const THROW_ANIM_FRAMES = 16;
const KNIFE_SPIN_SPEED = 0.45;
const KNIFE_HIT_RADIUS_RATIO = 0.3;
/** Preferred throwing distance — the lemur holds here rather than closing in. */
const KITE_STOP_RANGE_TILES = 3.5;
const COIN_DROP_MAX = 1;
const CENTER_OFFSET = 0.5;

/**
 * A Former Circus Lemur — one of Grimaldi's mutated sideshow performers.
 * The knife-throwing act survived the transformation: it kites at range
 * hurling knives, falling back to quick nips when cornered.
 */
export class CircusLemur extends Mob {
  readonly xpValue = 6;
  protected coinDropMin = 0;
  protected coinDropMax = COIN_DROP_MAX;
  displayName = 'Former Circus Lemur';
  description = 'A mutated circus lemur that still remembers its knife-throwing act.';
  override readonly audioTag = 'lemur';

  private knives: ThrownKnife[] = [];
  private meleeCooldown = 0;
  private meleeAnimTimer = 0;
  private throwCooldown = 0;
  private throwAnimTimer = 0;
  private isAggro = false;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, LEMUR_HP, LEMUR_SPEED);
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.meleeCooldown > 0) this.meleeCooldown--;
    if (this.meleeAnimTimer > 0) this.meleeAnimTimer--;
    if (this.throwCooldown > 0) this.throwCooldown--;
    if (this.throwAnimTimer > 0) this.throwAnimTimer--;

    this.updateKnives(targets);

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const meleeRangePx = this.tileSize * MELEE_RANGE_TILES;
    const knifeRangePx = this.tileSize * KNIFE_RANGE_TILES;
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
    this.updateLastKnown(nearest);
    const hasLOS = this.hasLOS(nearest) || this.onSameTile(nearest);

    if (!hasLOS || nearestDist > knifeRangePx) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.tileSize * KITE_STOP_RANGE_TILES,
      );
    } else {
      this.isMoving = false;
      this.facingX = nearest.x >= this.x ? 1 : -1;
    }

    if (nearestDist <= meleeRangePx && this.meleeCooldown === 0 && hasLOS) {
      // Cornered — bite instead of throwing.
      this.dealDamage(nearest, MELEE_DAMAGE);
      this.meleeCooldown = MELEE_COOLDOWN;
      this.meleeAnimTimer = MELEE_ANIM_FRAMES;
      return;
    }

    if (
      nearestDist > meleeRangePx &&
      nearestDist <= knifeRangePx &&
      hasLOS &&
      this.throwCooldown === 0
    ) {
      const originX = this.x + this.tileSize * CENTER_OFFSET;
      const originY = this.y + this.tileSize * CENTER_OFFSET;
      const n = normalize(
        nearest.x + this.tileSize * CENTER_OFFSET - originX,
        nearest.y + this.tileSize * CENTER_OFFSET - originY,
      );
      this.knives.push({
        x: originX,
        y: originY,
        vx: n.x * KNIFE_SPEED,
        vy: n.y * KNIFE_SPEED,
        rotation: 0,
      });
      this.throwCooldown = THROW_COOLDOWN;
      this.throwAnimTimer = THROW_ANIM_FRAMES;
      this.projectileSoundPending = true;
    }
  }

  private updateKnives(targets: Player[]): void {
    const survivors: ThrownKnife[] = [];
    for (const knife of this.knives) {
      knife.x += knife.vx;
      knife.y += knife.vy;
      knife.rotation += KNIFE_SPIN_SPEED;

      if (this.map) {
        const tx = Math.floor(knife.x / this.tileSize);
        const ty = Math.floor(knife.y / this.tileSize);
        if (!this.map.isWalkable(tx, ty)) continue;
      }

      let hit = false;
      for (const t of targets) {
        if (!t.isAlive) continue;
        const cx = t.x + this.tileSize * CENTER_OFFSET;
        const cy = t.y + this.tileSize * CENTER_OFFSET;
        if (Math.hypot(knife.x - cx, knife.y - cy) < this.tileSize * KNIFE_HIT_RADIUS_RATIO) {
          this.dealDamage(t, KNIFE_DAMAGE);
          hit = true;
          break;
        }
      }
      if (!hit) survivors.push(knife);
    }
    this.knives = survivors;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    for (const knife of this.knives) {
      drawThrownKnife(ctx, knife.x - camX, knife.y - camY, tileSize, knife.rotation);
    }

    if (this.isAggro) {
      this.renderAggroIndicator(ctx, sx, sy, tileSize);
    }

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    const attackAnim = this.meleeAnimTimer > 0 ? 1 - this.meleeAnimTimer / MELEE_ANIM_FRAMES : 0;
    const throwAnim = this.throwAnimTimer > 0 ? 1 - this.throwAnimTimer / THROW_ANIM_FRAMES : 0;

    drawCircusLemurSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.walkFrame,
      this.isMoving,
      attackAnim,
      this.facingX,
      throwAnim,
    );

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
