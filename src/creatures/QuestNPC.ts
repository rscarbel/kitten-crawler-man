import { Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import { drawQuestNPCSprite, drawExclamationMark } from '../sprites/questNPCSprite';

export type NPCMarkerType = 'exclamation' | 'question' | 'none';

/**
 * A non-combatant quest NPC (goblin mother in pink dress).
 * Extends Player so Bugaboos can target her via updateAI(targets).
 * She does NOT move and does NOT attack.
 */
export class QuestNPC extends Player {
  /** Flag for Bugaboos to identify her as the defend target. */
  readonly isDefendTarget = true;
  /** Current overhead marker — drives minimap and overhead icon. */
  markerType: NPCMarkerType = 'exclamation';
  /** Which quest this NPC belongs to. */
  readonly questId: string;
  /** Frames remaining on the persistent red damage box. Set to 308 on hit; box fades over final 8 frames. */
  private redBoxTimer = 0;

  constructor(tileX: number, tileY: number, questId: string) {
    super(tileX, tileY, TILE_SIZE, 40);
    this.questId = questId;
    // Clear the default 10 health potions — NPC doesn't use potions
    this.inventory.removeItems('health_potion', 10);
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number) {
    if (!this.isAlive) return;

    const sx = this.x - camX;
    const sy = this.y - camY;

    drawQuestNPCSprite(ctx, sx, sy, tileSize, this.facingX);

    // Overhead marker
    if (this.markerType === 'exclamation') {
      drawExclamationMark(ctx, sx, sy, tileSize, '#fbbf24');
    } else if (this.markerType === 'question') {
      drawExclamationMark(ctx, sx, sy, tileSize, '#4ade80');
    }

    // Health bar when damaged
    if (this.hp < this.maxHp) {
      this.renderHealthBar(ctx, sx, sy);
    }

    this.renderDamageFlash(ctx, sx, sy);
  }

  takeDamage(amount: number) {
    super.takeDamage(amount);
    if (amount > 0 && !this.isProtected) {
      this.redBoxTimer = 308; // 5 s at 60 fps + 8-frame fade
    }
  }

  tickTimers() {
    super.tickTimers();
    if (this.redBoxTimer > 0) this.redBoxTimer--;
  }

  protected renderDamageFlash(ctx: CanvasRenderingContext2D, sx: number, sy: number) {
    if (this.redBoxTimer <= 0) return;
    ctx.save();
    ctx.globalAlpha = Math.min(1, this.redBoxTimer / 8) * 0.9;
    ctx.strokeStyle = '#ff1f1f';
    ctx.lineWidth = 3;
    ctx.strokeRect(sx + 1, sy + 1, this.tileSize - 2, this.tileSize - 2);
    ctx.restore();
  }
}
