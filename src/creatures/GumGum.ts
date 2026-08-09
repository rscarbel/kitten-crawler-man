import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawGumGumSprite } from '../sprites/gumGumSprite';
import { scaleHumanoidBox } from '../sprites/humanoidScale';
import {
  drawQuestMarker,
  questMarkerColorFor,
  QUEST_MARKER_GOLD,
  QUEST_MARKER_GREEN,
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
   * frame from its phase. Her beacon and her glyph both branch on this and on
   * nothing else, so the two can never disagree about whether she has anything
   * left to tell you.
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
      // Her own tile, not her enlarged sprite box: `tileSize` is the unit the
      // beacon measures its near-fade in, so handing it the 1.8× box scales that
      // radius too and blanks the column over the last four tiles — precisely
      // the approach where the player is looking for her.
      drawQuestBeacon(
        ctx,
        this.x - camX,
        this.y - camY,
        tileSize,
        camX,
        camY,
        performance.now(),
        markerColor,
      );
    }
    drawGumGumSprite(ctx, box.sx, box.sy, box.s, this.walkFrame, this.isMoving, this.facingX);
    // `drawQuestMarker` sizes the glyph and its lift off screen as a fraction
    // of whatever box it is given, so her enlarged sprite box bloated the
    // glyph itself — the same mistake her beacon call above was fixed to
    // avoid. But her plain tile position is not her head either: her sprite
    // grows upward from a fixed feet line, so `box.sy` (not `this.y`) is
    // where her actual head starts. `scaleHumanoidBox` keeps every box
    // horizontally centred on the same point regardless of scale, so passing
    // plain `this.x` alongside a plain `tileSize` still centres correctly.
    if (this.markerType === 'exclamation') {
      drawQuestMarker(ctx, this.x - camX, box.sy, tileSize, '!', QUEST_MARKER_GOLD);
    } else if (this.markerType === 'question') {
      drawQuestMarker(ctx, this.x - camX, box.sy, tileSize, '?', QUEST_MARKER_GREEN);
    }
  }

  private spriteBox(camX: number, camY: number, tileSize: number) {
    return scaleHumanoidBox(this.x - camX, this.y - camY, tileSize, GUMGUM_SCALE);
  }
}
