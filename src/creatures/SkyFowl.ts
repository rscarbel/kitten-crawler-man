import { Mob } from './Mob';
import { Player } from '../Player';
import {
  drawSkyFowlSprite,
  SKY_FOWL_PALETTES,
  type SkyFowlClothColors,
} from '../sprites/skyFowlSprite';
import type { LootDrop } from './Mob';

const FOWL_HP = 14;
const FOWL_SPEED_NEUTRAL = 0.55;
const FOWL_SPEED_AGGRO = 1.5;

/** How far (in tiles) the fowl wanders from its spawn point when neutral. */
const WANDER_RADIUS_TILES = 10;

/** Tile range within which a peck can land. */
const PECK_RANGE_TILES = 0.9;
const PECK_DAMAGE = 3;
/** Frames between peck attacks (~1.4 s at 60 fps). */
const PECK_COOLDOWN = 85;
/** Frames the peck lunge animation plays. */
const PECK_ANIM_FRAMES = 12;

export class SkyFowl extends Mob {
  readonly xpValue = 8;
  protected coinDropMin = 0;
  protected coinDropMax = 2;

  /** Clothing palette chosen at construction — stays the same for this fowl's lifetime. */
  readonly cloth: SkyFowlClothColors;

  private isAggressive = false;
  private peckCooldown = 0;
  private peckAnimTimer = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, FOWL_HP, FOWL_SPEED_NEUTRAL);
    this.cloth =
      SKY_FOWL_PALETTES[Math.floor(Math.random() * SKY_FOWL_PALETTES.length)];
  }

  /** Sky Fowls are peaceful citizens — they carry no dungeon loot. */
  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  /**
   * Any hit turns this fowl aggressive for the rest of its life.
   * Also bumps movement speed to the angry sprint value.
   */
  takeDamageFrom(
    amount: number,
    attacker: Player | null,
    damageType: 'melee' | 'missile' = 'melee',
  ) {
    super.takeDamageFrom(amount, attacker, damageType);
    if (amount > 0 && !this.isAggressive) {
      this.isAggressive = true;
      this.speed = FOWL_SPEED_AGGRO;
    }
  }

  /**
   * Wide-radius wander — uses the same logic as Mob.doWander() but allows
   * roaming up to WANDER_RADIUS_TILES from the spawn point so they can
   * meander across the whole town square rather than hovering in one spot.
   */
  private doWiderWander(): void {
    if (this.wanderTimer > 0) {
      this.wanderTimer--;
    } else {
      if (Math.random() < 0.35) {
        // Pause and look around
        this.wanderDx = 0;
        this.wanderDy = 0;
      } else {
        const angle = Math.random() * Math.PI * 2;
        const spd = this.speed * 0.4;
        this.wanderDx = Math.cos(angle) * spd;
        this.wanderDy = Math.sin(angle) * spd;
      }
      // Slightly longer pauses between direction changes than dungeon mobs
      this.wanderTimer = 110 + Math.floor(Math.random() * 200);
    }

    if (this.wanderDx !== 0 || this.wanderDy !== 0) {
      // Gently steer back toward spawn when too far
      const dx = this.spawnX - this.x;
      const dy = this.spawnY - this.y;
      const distToSpawn = Math.hypot(dx, dy);
      const maxPx = this.tileSize * WANDER_RADIUS_TILES;
      if (distToSpawn > maxPx) {
        const nx = dx / distToSpawn;
        const ny = dy / distToSpawn;
        this.wanderDx = nx * this.speed * 0.45;
        this.wanderDy = ny * this.speed * 0.45;
      }
      this.moveWithCollision(this.wanderDx, this.wanderDy);
      this.isMoving = true;
    } else {
      this.isMoving = false;
    }
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.peckCooldown > 0) this.peckCooldown--;
    if (this.peckAnimTimer > 0) this.peckAnimTimer--;

    // Neutral — just wander peacefully, ignore players entirely
    if (!this.isAggressive) {
      this.doWiderWander();
      return;
    }

    // Aggressive — chase nearest living target and peck it
    const peckRangePx = this.tileSize * PECK_RANGE_TILES;
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = t;
      }
    }
    this.currentTarget = nearest;

    if (!nearest) {
      this.doWiderWander();
      return;
    }

    this.updateLastKnown(nearest);

    if (nearestDist > peckRangePx) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        FOWL_SPEED_AGGRO,
        peckRangePx * 0.7,
      );
    } else {
      this.isMoving = false;
      // Face the target while in peck range
      const dx = nearest.x - this.x;
      const dy = nearest.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 0) {
        this.facingX = dx / d;
        this.facingY = dy / d;
      }
    }

    // Peck attack
    if (
      nearestDist <= peckRangePx * 1.2 &&
      this.peckCooldown === 0 &&
      (this.hasLOS(nearest) || this.onSameTile(nearest))
    ) {
      nearest.takeDamage(PECK_DAMAGE);
      this.peckCooldown = PECK_COOLDOWN;
      this.peckAnimTimer = PECK_ANIM_FRAMES;
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    const peckAmt =
      this.peckAnimTimer > 0
        ? Math.sin((1 - this.peckAnimTimer / PECK_ANIM_FRAMES) * Math.PI)
        : 0;

    drawSkyFowlSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.walkFrame,
      this.isMoving,
      this.isAggressive,
      this.facingX,
      this.facingY,
      this.cloth,
      peckAmt,
    );

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
