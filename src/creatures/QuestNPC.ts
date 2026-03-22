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
}
