import { Player } from '../Player';
import { Mob } from './Mob';
import type { LootDrop } from './Mob';
import { TILE_SIZE } from '../core/constants';
import { randomInt } from '../utils';
import { drawHoarderSprite } from '../sprites/hoarderSprite';

const HOARDER_HP = 80;
const HOARDER_SPEED = 0.45;
const HOARDER_SPEED_ENRAGED = 0.75;
const AGGRO_RANGE_PX = TILE_SIZE * 10;
const ATTACK_RANGE_PX = TILE_SIZE * 1.8;
const ATTACK_DAMAGE = 1;
const ATTACK_COOLDOWN = 150;
const VOMIT_INTERVAL = 480; // 8 s @ 60 fps
const VOMIT_INTERVAL_ENRAGED = 240; // 4 s @ 60 fps
const ENRAGE_THRESHOLD = 0.5; // below 50% HP

export class TheHoarder extends Mob {
  readonly xpValue = 500;
  protected coinDropMin = 50;
  protected coinDropMax = 100;
  displayName = 'The Hoarder';
  description = 'A hulking boss that guards its pile of junk with vile fury.';

  private attackCooldown = 60;
  private vomitTimer = VOMIT_INTERVAL;
  isEnraged = false;

  /**
   * Pending cockroach spawn positions. DungeonScene drains this each frame
   * and creates Cockroach mobs at each position.
   */
  cockroachSpawns: Array<{ x: number; y: number }> = [];

  /** Vomit animation timer (frames remaining to show green glow). */
  private vomitFlash = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, HOARDER_HP, HOARDER_SPEED);
    this.isBoss = true;
  }

  updateAI(targets: Player[]): void {
    if (!this.isAlive) return;

    // Enrage check
    if (!this.isEnraged && this.hp / this.maxHp < ENRAGE_THRESHOLD) {
      this.isEnraged = true;
      this.speed = HOARDER_SPEED_ENRAGED;
    }

    // Tick vomit flash
    if (this.vomitFlash > 0) this.vomitFlash--;

    // Find nearest living target
    let nearest: Player | null = null;
    let nearestDist = Infinity;
    for (const t of targets) {
      if (!t.isAlive) continue;
      const d = Math.hypot(t.x - this.x, t.y - this.y);
      if ((this.forceAggro || d < AGGRO_RANGE_PX) && d < nearestDist) {
        nearestDist = d;
        nearest = t;
      }
    }

    this.currentTarget = nearest;
    if (this.attackCooldown > 0) this.attackCooldown--;

    // Vomit timer ticks regardless of target
    this.vomitTimer--;
    const interval = this.isEnraged ? VOMIT_INTERVAL_ENRAGED : VOMIT_INTERVAL;
    if (this.vomitTimer <= 0) {
      this.vomitTimer = interval;
      this.triggerVomit();
    }

    if (!nearest) {
      // Guard the spawn — slowly return if far
      const toHome = Math.hypot(this.x - this.spawnX, this.y - this.spawnY);
      if (toHome > TILE_SIZE * 2) {
        this.followTargetCollide(this.spawnX, this.spawnY, this.speed * 0.6, TILE_SIZE);
      } else {
        this.isMoving = false;
      }
      return;
    }

    this.updateLastKnown(nearest);

    // Melee attack
    if (nearestDist <= ATTACK_RANGE_PX && this.attackCooldown <= 0) {
      this.dealDamage(nearest, ATTACK_DAMAGE);
      nearest.damageFlash = 8;
      this.attackCooldown = ATTACK_COOLDOWN;
      this.isMoving = false;
      return;
    }

    // Pursue via A*
    this.followTargetAStar(
      this.lastKnownTargetX,
      this.lastKnownTargetY,
      this.speed,
      ATTACK_RANGE_PX * 0.9,
      40,
    );
  }

  private triggerVomit(): void {
    this.vomitFlash = 40;
    // Spawn 3–5 cockroaches in a scatter around the boss
    const count = randomInt(3, 5);
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * Math.PI * 2;
      const dist = TILE_SIZE * (0.5 + Math.random() * 1.5);
      this.cockroachSpawns.push({
        x: this.x + TILE_SIZE * 0.5 + Math.cos(angle) * dist,
        y: this.y + TILE_SIZE * 0.5 + Math.sin(angle) * dist,
      });
    }
  }

  protected rollLootItems(killer: Player | null): LootDrop['items'] {
    const items = super.rollLootItems(killer);
    // Guaranteed boss drop: Enchanted Trollskin Shirt of Pummeling
    items.push({ id: 'trollskin_shirt', quantity: 1 });
    return items;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    ctx.save();

    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    drawHoarderSprite(
      ctx,
      sx,
      sy,
      tileSize,
      this.isEnraged,
      this.facingX,
      this.facingY,
      this.vomitFlash,
    );

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
  }
}
