import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawGumGumSprite } from '../sprites/gumGumSprite';
import { scaleHumanoidBox } from '../sprites/humanoidScale';
import {
  drawQuestMarker,
  questMarkerColorFor,
  QUEST_MARKER_GOLD,
  type QuestMarkerState,
} from '../sprites/questNPCSprite';
import { drawQuestBeacon } from '../sprites/questBeacon';

const GUMGUM_HP = 30;
const GUMGUM_SPEED = 0;

/**
 * A step above the shared humanoid NPC scale: GumGum is a quest hook, and at
 * crowd size the figure got lost in the street traffic outside the club.
 */
const GUMGUM_SCALE = 1.8;

/**
 * GumGum — the jittery street elf whose plea opens "The Krasue Murders".
 * A stationary, non-combatant hook NPC: MurderMysteryQuestSystem owns her
 * dialog and removes her once the hook is heard (her corpse prop takes over
 * from there). Non-hostile, so player attacks pass through her.
 */
export class GumGum extends Mob {
  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'GumGum';
  description = 'A nervous street elf clutching her coat, watching the crowd for something.';

  /**
   * Whether she has something to say, set by `MurderMysteryQuestSystem` each
   * frame from its phase.
   *
   * Her glyph is drawn by the system in the overlay pass while her beacon is
   * drawn here in the Y-sorted one, so the state they share has to live
   * somewhere both can read — otherwise a column of light stands over an elf
   * with nothing left to tell you.
   */
  markerType: QuestMarkerState = 'none';

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, GUMGUM_HP, GUMGUM_SPEED);
  }

  /** GumGum is a bystander — never hostile, never targetable by player attacks. */
  override get isHostile(): boolean {
    return false;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(_targets: Player[]): void {
    this.isMoving = false;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive) return;
    const box = this.spriteBox(camX, camY, tileSize);
    // Beacon first, so the column stands behind her rather than across her.
    const markerColor = questMarkerColorFor(this.markerType);
    if (markerColor !== undefined) {
      drawQuestBeacon(ctx, box.sx, box.sy, box.s, camX, camY, performance.now(), markerColor);
    }
    drawGumGumSprite(ctx, box.sx, box.sy, box.s, this.walkFrame, this.isMoving, this.facingX);
  }

  /**
   * Draws the "talk to me" marker above GumGum's head. Called by
   * MurderMysteryQuestSystem only while the murder quest is unstarted, so the
   * marker disappears the moment the hook dialog is heard.
   */
  renderQuestMarker(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive) return;
    const box = this.spriteBox(camX, camY, tileSize);
    drawQuestMarker(ctx, box.sx, box.sy, box.s, '!', QUEST_MARKER_GOLD);
  }

  private spriteBox(camX: number, camY: number, tileSize: number) {
    return scaleHumanoidBox(this.x - camX, this.y - camY, tileSize, GUMGUM_SCALE);
  }
}
