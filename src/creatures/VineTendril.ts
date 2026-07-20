import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawVineTendrilSprite } from '../sprites/vineTendrilSprite';

const TENDRIL_HP = 50;
/** Tendrils are rooted in place — they never move or attack. */
const TENDRIL_SPEED = 0;
const SWAY_SPEED = 0.03;

/**
 * A vine tendril — one of Ringmaster Grimaldi's destructible root
 * sub-entities. While any tendril is alive, Grimaldi's core is invulnerable
 * and his fallen performers keep resurrecting; tendrils must be destroyed
 * first. Rooted in place, they never move or attack.
 */
export class VineTendril extends Mob {
  readonly xpValue = 40;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'Massive Root';
  description =
    "One of the Pestiferous Vine's massive roots — destroy them all to expose the trunk.";

  private swayPhase = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, TENDRIL_HP, TENDRIL_SPEED);
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(_targets: Player[]): void {
    if (!this.isAlive) return;
    this.swayPhase += SWAY_SPEED;
    this.isMoving = false;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive) return;
    const sx = this.x - camX;
    const sy = this.y - camY;

    ctx.save();
    if (this.damageFlash > 0) {
      ctx.filter = 'brightness(3)';
    }

    drawVineTendrilSprite(ctx, sx, sy, tileSize, this.swayPhase, this.hp / this.maxHp);

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
