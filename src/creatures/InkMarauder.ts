import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawInkMarauderSprite } from '../sprites/inkMarauderSprite';

const MARAUDER_HP = 5;
const MARAUDER_SPEED = 1.8;
const AGGRO_RANGE_TILES = 9;
const BITE_RANGE_TILES = 0.8;
const BITE_DAMAGE = 3;
/** Frames between bites (~0.83 s at 60 fps). */
const ATTACK_COOLDOWN = 50;
/** How long the marauder persists before bleeding away (~8 s at 60 fps). */
const LIFESPAN_FRAMES = 480;
/** Lifespan remaining below which the marauder visibly fades out. */
const FADE_START_FRAMES = 90;
const CENTER_OFFSET = 0.5;
const FOLLOW_STOP_FRACTION = 0.8;

/**
 * An Ink Marauder — one of Tsarina Signet's tattoos torn from her skin and
 * given fangs. Fights alongside the crawlers, then bleeds back into ink
 * when its lifespan ends.
 */
export class InkMarauder extends Mob {
  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'Ink Marauder';
  description = "A tattoo torn from Signet's skin and given fangs.";

  /** All mobs in the scene — set each frame by the owning quest system. */
  allMobs: Mob[] = [];

  private attackCooldown = 0;
  private lifespanRemaining: number;
  private age = 0;

  constructor(tileX: number, tileY: number, tileSize: number, lifespanFrames = LIFESPAN_FRAMES) {
    super(tileX, tileY, tileSize, MARAUDER_HP, MARAUDER_SPEED);
    this.lifespanRemaining = lifespanFrames;
  }

  /** Ink Marauders are allies — never hostile to players. */
  override get isHostile(): boolean {
    return false;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(_targets: Player[]): void {
    if (!this.isAlive) return;

    this.age++;
    if (this.attackCooldown > 0) this.attackCooldown--;

    this.lifespanRemaining--;
    if (this.lifespanRemaining <= 0) {
      // Dissipate without granting XP/loot — bypass takeDamageFrom's kill-credit path.
      this.hp = 0;
      this.justDied = true;
      return;
    }

    const aggroRangePx = this.tileSize * AGGRO_RANGE_TILES;
    const biteRangePx = this.tileSize * BITE_RANGE_TILES;

    let nearest: Mob | null = null;
    let nearestDist = Infinity;
    for (const mob of this.allMobs) {
      if (mob === this || !mob.isAlive || !mob.isHostile) continue;
      const d = Math.hypot(
        mob.x + this.tileSize * CENTER_OFFSET - (this.x + this.tileSize * CENTER_OFFSET),
        mob.y + this.tileSize * CENTER_OFFSET - (this.y + this.tileSize * CENTER_OFFSET),
      );
      if (d < aggroRangePx && d < nearestDist) {
        nearestDist = d;
        nearest = mob;
      }
    }

    if (!nearest) {
      this.isMoving = false;
      return;
    }

    this.updateLastKnown(nearest);
    if (nearestDist > biteRangePx) {
      this.followTargetAStar(
        this.lastKnownTargetX,
        this.lastKnownTargetY,
        this.speed,
        biteRangePx * FOLLOW_STOP_FRACTION,
      );
    } else {
      this.isMoving = false;
    }

    if (nearestDist <= biteRangePx && this.attackCooldown === 0) {
      nearest.takeDamageFrom(BITE_DAMAGE, null, 'melee');
      this.attackCooldown = ATTACK_COOLDOWN;
    }
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    const lifeFraction =
      this.lifespanRemaining < FADE_START_FRAMES ? this.lifespanRemaining / FADE_START_FRAMES : 1;

    drawInkMarauderSprite(ctx, sx, sy, tileSize, this.age, lifeFraction);

    this.renderDamageFlash(ctx, sx, sy);
  }
}
