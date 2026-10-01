import { Mob } from './Mob';
import type { Player } from '../Player';
import type { LootDrop } from './Mob';
import { drawGumGumSprite, GUMGUM_DRAW_SCALE, prewarmGumGumSprite } from '../sprites/gumGumSprite';
import { scaleHumanoidBox } from '../sprites/humanoidScale';
import {
  drawQuestMarker,
  questMarkerColorFor,
  type QuestMarkerState,
} from '../sprites/questNPCSprite';
import { drawQuestBeacon } from '../sprites/questBeacon';

const GUMGUM_HP = 30;
const GUMGUM_SPEED = 0;

/**
 * GumGum — the kindly orc whose plea opens "The Krasue Murders".
 * A stationary, non-combatant hook NPC: MurderMysteryQuestSystem owns her
 * dialog and removes her once the hook is heard (her corpse prop takes over
 * from there). Non-hostile, so player attacks pass through her.
 */
export class GumGum extends Mob {
  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'GumGum';
  description =
    'A stout, kindly orc in a patched coat and apron, watching the crowd for something.';

  /**
   * Whether she has something to say, set by `MurderMysteryQuestSystem` each
   * frame from its phase. Her beacon and her glyph both branch on this and on
   * nothing else, so the two can never disagree about whether she has anything
   * left to tell you.
   */
  markerType: QuestMarkerState = 'none';

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, GUMGUM_HP, GUMGUM_SPEED);
    prewarmGumGumSprite();
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
      // beacon measures its near-fade in, so handing it the enlarged box scales that
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
    const artTop = this.paintSpriteMeasuringTop(ctx, box.sy, () => {
      drawGumGumSprite(ctx, box.sx, box.sy, box.s, this.walkFrame, this.isMoving, this.facingX);
    });
    // Sized from her plain tile rather than her enlarged box, which would
    // bloat the glyph the way it would the beacon's fade radius above. Both
    // boxes share a horizontal centre, so the plain tile still centres it.
    if (markerColor !== undefined) {
      const glyph = this.markerType === 'question' ? '?' : '!';
      drawQuestMarker(ctx, this.x - camX, artTop, tileSize, glyph, markerColor);
    }
  }

  private spriteBox(camX: number, camY: number, tileSize: number) {
    return scaleHumanoidBox(this.x - camX, this.y - camY, tileSize, GUMGUM_DRAW_SCALE);
  }
}
