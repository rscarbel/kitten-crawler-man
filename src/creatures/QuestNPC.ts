import { Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import {
  drawQuestNPCSprite,
  drawQuestMarker,
  questMarkerColorFor,
  QUEST_MARKER_GOLD,
  QUEST_MARKER_GREEN,
  type QuestMarkerState,
} from '../sprites/questNPCSprite';
import { drawQuestBeacon } from '../sprites/questBeacon';

const NPC_MAX_HP = 40;
/** Initial health potion count to remove (NPC has no use for potions). */
const INITIAL_POTION_COUNT = 10;
/** Frames over which the hurt tint fades out. */
const HURT_FADE_FRAMES = 8;
/** Seconds the hurt tint holds at full strength before its fade begins. */
const HURT_HOLD_SECONDS = 5;
const FRAMES_PER_SECOND = 60;
const HURT_FRAMES = HURT_HOLD_SECONDS * FRAMES_PER_SECOND + HURT_FADE_FRAMES;
/** Share of a strike's flash intensity the sustained hurt tint carries. */
const HURT_FLASH_PROGRESS = 0.45;

export type NPCMarkerType = QuestMarkerState;

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
  /** Frames remaining on the persistent hurt tint; it fades over the final {@link HURT_FADE_FRAMES}. */
  private hurtTimer = 0;

  constructor(tileX: number, tileY: number, questId: string) {
    super(tileX, tileY, TILE_SIZE, { maxHp: NPC_MAX_HP });
    this.questId = questId;
    this.inventory.removeItems('health_potion', INITIAL_POTION_COUNT);
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ) {
    if (!this.isAlive) return;

    const sx = this.x - camX;
    const sy = this.y - camY;

    // Beacon first, so the column stands behind her rather than across her.
    // Both it and the glyph below branch on `markerType` and nothing else, so
    // the two can never disagree about whether she has something to say.
    const markerColor = questMarkerColorFor(this.markerType);
    if (markerColor !== undefined) {
      drawQuestBeacon(ctx, sx, sy, tileSize, camX, camY, performance.now(), markerColor);
    }

    drawQuestNPCSprite(ctx, sx, sy, tileSize, this.facingX, this.hurtTimer);

    if (this.markerType === 'exclamation') {
      drawQuestMarker(ctx, sx, sy, tileSize, '!', QUEST_MARKER_GOLD);
    } else if (this.markerType === 'question') {
      drawQuestMarker(ctx, sx, sy, tileSize, '?', QUEST_MARKER_GREEN);
    }

    // Health bar when damaged
    if (this.hp < this.maxHp) {
      this.renderHealthBar(ctx, sx, sy);
    }
  }

  takeDamage(amount: number): boolean {
    const connected = super.takeDamage(amount);
    if (connected) {
      this.hurtTimer = HURT_FRAMES;
    }
    return connected;
  }

  tickTimers() {
    super.tickTimers();
    if (this.hurtTimer > 0) this.hurtTimer--;
  }

  clearHurtState(): void {
    this.hurtTimer = 0;
  }

  /**
   * Her hurt state is a standing "she is being attacked" alarm rather than an
   * impact, so it holds for seconds at a fraction of a strike's intensity —
   * enough to keep her outlined in red without burning the sprite out.
   */
  protected override hitFlashProgress(): number {
    if (this.hurtTimer <= 0) return 0;
    const fade = Math.min(1, this.hurtTimer / HURT_FADE_FRAMES);
    return fade * HURT_FLASH_PROGRESS;
  }
}
