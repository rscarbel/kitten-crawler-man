/**
 * The Briar Hollow recruiter — a lone militiaman posted in the Over City's own
 * town square, ahead of the village he serves. He carries none of a soldier's
 * standing orders (no follow, hold or patrol) and fights nothing: he exists to
 * say one of two lines and, the first time, to point the party at the Mayor.
 *
 * Reuses Hobb's look (`drawRatkinCastSprite` with his cast id) rather than
 * painting a new figure — the recruiter is one of the militia's own, simply
 * posted somewhere else.
 */

import type { AudioManager } from '../../audio/AudioManager';
import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import type { BriarHollowState } from '../../core/briarHollowState';
import { hasAcceptedMayorRequest } from '../../core/villageQuestPhase';
import type { GameMap } from '../../map/GameMap';
import { findNearbyWalkableTile } from '../../map/findWalkableTile';
import type { TilePoint } from '../../map/town/townPlan';
import { drawRatkinCastSprite } from '../../sprites/ratkinCastSprite';
import {
  drawQuestMarker,
  questMarkerAnchorAbove,
  questMarkerColorFor,
  type QuestMarkerState,
} from '../../sprites/questNPCSprite';
import { DialogBox } from '../../ui/DialogBox';
import { drawInteractionPrompt } from '../../ui/InteractionPrompt';
import type { Player } from '../../Player';
import type { OverlayInputClaim } from '../kits/OverlayClaims';
import type { TownPropRenderable } from '../townPropRenderable';
import { VILLAGER_HEAD_CLEARANCE_TILES } from './Villager';
import { BRIAR_HOLLOW_QUEST_ID, type VillageQuestSystem } from './VillageQuestSystem';

/** The recruiter's own name — a militiaman sent out on his own errand, not one of the four at the palisade. */
export const RECRUITER_NAME = 'Corporal Bristle';

/** Whose look he wears — reused wholesale, not repainted. */
const RECRUITER_SPRITE_ID = 'hobb';

const INTERACT_RANGE_TILES = 2;
const INTERACT_RANGE_PX = TILE_SIZE * INTERACT_RANGE_TILES;
/** How far from the square's centre a free tile may be found. */
const SPAWN_SEARCH_TILES = 6;
const OVERHEAD_GAP_PX = 2;
const TILE_CENTRE = 0.5;

const RECRUIT_LINE =
  'Please help us. Our small village nearby is in grave danger. Go and speak with our mayor for more details.';
const THANKS_LINE =
  "I'm in town looking for more recruits to help us. I got word that you're helping defend the town, thank you so much! We are very grateful!";

/** The recruiter's own drawn body — stationary, facing the square he stands in. */
class RecruiterNPC implements TownPropRenderable {
  x: number;
  y: number;
  marker: QuestMarkerState = 'exclamation';

  constructor(tile: TilePoint) {
    this.x = tile.x * TILE_SIZE;
    this.y = tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    const sx = this.x - camX;
    const sy = this.y - camY;
    drawRatkinCastSprite(ctx, RECRUITER_SPRITE_ID, sx, sy, tileSize, {
      action: 'idle',
      walkPhase: 0,
      facingX: 0,
      facingY: 1,
    });
    const markerColor = questMarkerColorFor(this.marker);
    if (markerColor === undefined) return;
    const headTop = sy - VILLAGER_HEAD_CLEARANCE_TILES * tileSize;
    const markerY = questMarkerAnchorAbove(headTop - OVERHEAD_GAP_PX, tileSize);
    drawQuestMarker(ctx, sx, markerY, tileSize, '!', markerColor);
  }
}

export interface RecruiterSystemDeps {
  readonly gameMap: GameMap;
  readonly bus: EventBus;
  readonly state: BriarHollowState;
  readonly audio: AudioManager | null;
  /** Moves the Mayor's own questline along and answers what it currently reads. */
  readonly quest: VillageQuestSystem;
}

export class RecruiterSystem {
  private readonly npc: RecruiterNPC | null;
  private readonly dialog: DialogBox;
  /** Who he is and where he stands, for the questline's tracker; null when no tile was free. */
  readonly post: { readonly name: string; readonly tile: TilePoint } | null;

  constructor(private readonly deps: RecruiterSystemDeps) {
    this.dialog = new DialogBox(deps.audio, { speakerName: RECRUITER_NAME, revealMode: 'word' });
    const centre = deps.gameMap.townSquareCentre;
    const tile =
      centre === undefined
        ? null
        : findNearbyWalkableTile(deps.gameMap, centre.x, centre.y, SPAWN_SEARCH_TILES);
    this.npc = tile === null ? null : new RecruiterNPC(tile);
    this.post = tile === null ? null : { name: RECRUITER_NAME, tile };
    this.syncMarker();
  }

  /**
   * His own '!' is only for the party's very first look at him — once they
   * have heard him out, whatever the Mayor's own questline does next is the
   * Mayor's marker to carry, not his.
   */
  private syncMarker(): void {
    if (this.npc === null) return;
    this.npc.marker = this.deps.state.quest.phase === 'unmet' ? 'exclamation' : 'none';
  }

  /** Runs every gameplay frame: keeps the marker current and the dialog's reveal animating. */
  update(): void {
    this.syncMarker();
    this.dialog.update();
  }

  renderEntities(): ReadonlyArray<TownPropRenderable> {
    return this.npc === null ? [] : [this.npc];
  }

  renderDialog(ctx: CanvasRenderingContext2D): void {
    this.dialog.render(ctx);
  }

  get isDialogOpen(): boolean {
    return this.dialog.isVisible();
  }

  private inRange(active: { readonly x: number; readonly y: number }): boolean {
    if (this.npc === null) return false;
    const dist = Math.hypot(
      active.x - (this.npc.x + TILE_SIZE * TILE_CENTRE),
      active.y - (this.npc.y + TILE_SIZE * TILE_CENTRE),
    );
    return dist <= INTERACT_RANGE_PX;
  }

  wouldInteract(active: Player): boolean {
    return !this.isDialogOpen && this.inRange(active);
  }

  /**
   * Whether world point (`worldX`, `worldY`) falls on his drawn body — the
   * same head-to-feet rect `soldierAtPoint`/`villagerAtPoint` hit-test, for a
   * mobile tap aimed at him specifically rather than at whoever is nearest.
   */
  atPoint(worldX: number, worldY: number): boolean {
    if (this.npc === null) return false;
    const top = this.npc.y - VILLAGER_HEAD_CLEARANCE_TILES * TILE_SIZE;
    return (
      worldX >= this.npc.x &&
      worldX <= this.npc.x + TILE_SIZE &&
      worldY >= top &&
      worldY <= this.npc.y + TILE_SIZE
    );
  }

  renderPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): boolean {
    if (this.isDialogOpen || this.npc === null || !this.inRange(active)) return false;
    drawInteractionPrompt(ctx, this.npc.x - camX, this.npc.y - camY, TILE_SIZE, 'Talk');
    return true;
  }

  /**
   * A press reaching him. The first time, before the Mayor's request has been
   * accepted, this is also what starts the questline from his end: the party
   * has not yet heard the Mayor out, but they have heard that he needs them,
   * which is enough for the Journal and the world arrow to point the way.
   */
  tryInteract(active: Player): boolean {
    if (this.isDialogOpen || !this.inRange(active)) return false;
    const alreadyAccepted = hasAcceptedMayorRequest(this.deps.state.quest.phase);
    if (!alreadyAccepted && this.deps.state.quest.phase === 'unmet') {
      this.deps.quest.setPhase('offered');
      this.deps.bus.emit('questStarted', { questId: BRIAR_HOLLOW_QUEST_ID });
    }
    this.dialog.show(alreadyAccepted ? THANKS_LINE : RECRUIT_LINE);
    return true;
  }

  /** Skips the reveal, or closes the dialog once fully shown. */
  private advance(): void {
    if (this.dialog.isFullyRevealed()) this.dialog.hide();
    else this.dialog.skipToEnd();
  }

  /** A click landing on his dialog box. Returns whether it did. */
  handleClick(mx: number, my: number): boolean {
    if (!this.isDialogOpen || !this.dialog.contains(mx, my)) return false;
    this.advance();
    return true;
  }

  dismissDialog(): boolean {
    if (!this.isDialogOpen) return false;
    this.dialog.hide();
    return true;
  }

  overlayClaim(): OverlayInputClaim {
    return {
      isOpen: this.isDialogOpen,
      space: { kind: 'advance', advance: () => this.advance() },
      focusContext: null,
      locksKeyboard: false,
      // A street conversation, like the village's own: it ends because the
      // player walked away or clicked through, not because anything paused.
      haltsWorld: false,
    };
  }
}
