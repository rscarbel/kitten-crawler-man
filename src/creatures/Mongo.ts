import { Mob } from './Mob';
import { Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import { drawMongoSprite } from '../sprites/mongoSprite';
import type { GameMap } from '../map/GameMap';
import type { LootDrop } from './Mob';

/**
 * Mongo — a blue velociraptor with pink feathers, summoned by the cat
 * after defeating the Krakaren Clone boss.
 *
 * He targets hostile mobs within a 10-tile radius of his owner (the cat).
 * When his HP reaches 0 he runs back to the cat and despawns.
 */

// Base stats (floor 2 — small raptor)
const BASE_HP = 20;
const BASE_SPEED = 2.0;
const BASE_DAMAGE = 2;

const AGGRO_RADIUS_TILES = 12;
const BITE_RANGE_TILES = 0.9;
const ATTACK_COOLDOWN = 50; // frames (~0.83s)
const ATTACK_ANIM_FRAMES = 12;

// Leash: stays within this many tiles of the cat
const LEASH_RADIUS_TILES = 12;

export type MongoSize = 'small' | 'medium' | 'large';

/** Returns Mongo stats scaled by floor. */
export function mongoStatsForFloor(levelId: string): {
  hp: number;
  speed: number;
  damage: number;
  size: MongoSize;
  scale: number;
} {
  if (levelId === 'level3') {
    return { hp: 35, speed: 2.4, damage: 4, size: 'medium', scale: 1.0 };
  }
  if (levelId >= 'level4') {
    return { hp: 60, speed: 2.8, damage: 7, size: 'large', scale: 1.5 };
  }
  // level2 or default — small
  return {
    hp: BASE_HP,
    speed: BASE_SPEED,
    damage: BASE_DAMAGE,
    size: 'small',
    scale: 0.7,
  };
}

export class Mongo extends Mob {
  readonly xpValue = 0; // ally — no XP on death
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'Mongo';
  description = 'A loyal blue velociraptor with pink feathers.';

  /** The cat player who owns this summon. */
  owner: Player;
  /** All mobs in the scene — set each frame by DungeonScene. */
  allMobs: Mob[] = [];
  /** Damage per bite, scaled by floor. */
  biteDamage: number;
  /** Visual scale factor (0.7 = small, 1.0 = medium, 1.5 = large). */
  readonly visualScale: number;
  readonly mongoSize: MongoSize;

  private attackCooldown = 0;
  private attackAnimTimer = 0;
  private aggroRangePx: number;
  private biteRangePx: number;
  private leashPx: number;

  /** When true, Mongo is running back to the cat before despawning. */
  recalling = false;

  constructor(tileX: number, tileY: number, tileSize: number, owner: Player, levelId: string) {
    const stats = mongoStatsForFloor(levelId);
    super(tileX, tileY, tileSize, stats.hp, stats.speed);
    this.owner = owner;
    this.biteDamage = stats.damage;
    this.visualScale = stats.scale;
    this.mongoSize = stats.size;
    this.aggroRangePx = tileSize * AGGRO_RADIUS_TILES;
    this.biteRangePx = tileSize * BITE_RANGE_TILES;
    this.leashPx = tileSize * LEASH_RADIUS_TILES;
  }

  /** Mongo is an ally — never hostile to players. */
  override get isHostile(): boolean {
    return false;
  }

  /** No loot on death. */
  protected override rollLootItems(): LootDrop['items'] {
    return [];
  }

  override setMap(map: GameMap) {
    super.setMap(map);
  }

  /**
   * AI: Mongo's targets argument is ignored — he builds his own target list
   * from allMobs. He chases hostile mobs within aggro range of the cat,
   * but won't stray further than leashPx from the cat.
   */
  updateAI(_targets: Player[]): void {
    if (!this.isAlive) return;

    if (this.attackCooldown > 0) this.attackCooldown--;
    if (this.attackAnimTimer > 0) this.attackAnimTimer--;

    // If recalling, run to cat and do nothing else
    if (this.recalling) {
      const dist = Math.hypot(this.owner.x - this.x, this.owner.y - this.y);
      if (dist < TILE_SIZE * 1.5) {
        // Close enough — signal done
        this.hp = 0;
        return;
      }
      this.followTargetAStar(this.owner.x, this.owner.y, this.speed * 1.5, TILE_SIZE * 0.5);
      return;
    }

    // Find nearest hostile mob within aggro range of the cat
    const catCx = this.owner.x + TILE_SIZE * 0.5;
    const catCy = this.owner.y + TILE_SIZE * 0.5;
    let nearest: Mob | null = null;
    let nearestDist = Infinity;

    for (const mob of this.allMobs) {
      if (mob === this || !mob.isAlive || !mob.isHostile) continue;
      // Must be within aggro radius of the cat
      const dCat = Math.hypot(mob.x + TILE_SIZE * 0.5 - catCx, mob.y + TILE_SIZE * 0.5 - catCy);
      if (dCat > this.aggroRangePx) continue;
      const d = Math.hypot(mob.x - this.x, mob.y - this.y);
      if (d < nearestDist) {
        nearestDist = d;
        nearest = mob;
      }
    }

    // Check leash: if we're too far from the cat, return
    const distToCat = Math.hypot(this.x - this.owner.x, this.y - this.owner.y);
    if (!nearest || distToCat > this.leashPx) {
      // Return toward cat
      if (distToCat > TILE_SIZE * 1.5) {
        this.followTargetAStar(this.owner.x, this.owner.y, this.speed, TILE_SIZE * 1);
      } else {
        this.isMoving = false;
        this.doWander();
      }
      return;
    }

    // Chase the target
    this.updateLastKnown(nearest as unknown as Player);
    if (nearestDist > this.biteRangePx) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        this.biteRangePx * 0.7,
      );
    } else {
      this.isMoving = false;
      // Face target
      const dx = nearest.x - this.x;
      const dy = nearest.y - this.y;
      const d = Math.hypot(dx, dy);
      if (d > 0) {
        this.facingX = dx / d;
        this.facingY = dy / d;
      }
    }

    // Bite attack — deals damage directly to the mob, credited to the cat
    if (nearest && nearestDist <= this.biteRangePx * 1.2 && this.attackCooldown === 0) {
      nearest.takeDamageFrom(this.biteDamage, this.owner, 'melee');
      this.attackCooldown = ATTACK_COOLDOWN;
      this.attackAnimTimer = ATTACK_ANIM_FRAMES;
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    const attackAmt =
      this.attackAnimTimer > 0
        ? Math.sin((1 - this.attackAnimTimer / ATTACK_ANIM_FRAMES) * Math.PI)
        : 0;

    drawMongoSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.walkFrame,
      this.isMoving,
      this.facingX,
      this.facingY,
      attackAmt,
      this.visualScale,
    );

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
