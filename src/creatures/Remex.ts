import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawRemexSprite } from '../sprites/remexSprite';

const REMEX_HP = 140;
/** Rooted in place — a capacitor does not walk. */
const REMEX_SPEED = 0;

/**
 * Remex — Miss Quill's husband, willingly transformed into a living soul
 * capacitor. The static objective of the tower confrontation: while he
 * stands, his stored souls shield Quill from all harm. He never moves or
 * attacks (pattern: VineTendril).
 */
export class Remex extends Mob {
  readonly xpValue = 120;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'Remex, the Living Capacitor';
  description =
    "A column of fused flesh threaded with glowing soul conduits — destroy it to break Quill's shield.";

  private phase = 0;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, REMEX_HP, REMEX_SPEED);
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(_targets: Player[]): void {
    if (!this.isAlive) return;
    this.phase++;
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

    drawRemexSprite(ctx, sx, sy, tileSize, this.phase, this.hp / this.maxHp);

    ctx.filter = 'none';
    ctx.restore();

    this.renderMobHealthBar(ctx, sx, sy);
    this.renderDamageFlash(ctx, sx, sy);
  }
}
