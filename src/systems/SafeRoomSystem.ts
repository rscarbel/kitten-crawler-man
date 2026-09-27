import type { GameMap } from '../map/GameMap';
import { planSafeRoomCounters } from '../map/safeRoomCounterLayout';
import {
  planSafeRoomDecor,
  safeRoomDecorTiles,
  type SafeRoomDecorPlan,
} from '../map/safeRoomDecorLayout';
import { SAFE_ROOM_LANTERN, SAFE_ROOM_STOVE } from '../map/tileTypes';
import { mordecaiAndBedTiles } from '../map/safeRoomFixtures';
import { TILE_SIZE } from '../core/constants';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import {
  drawMordecaiForLevel,
  mordecaiHeadTop,
  mordecaiOverheadLift,
  prewarmMordecaiForLevel,
} from '../sprites/mordecaiSprite';
import { RAT_KIN_TILES_PER_WALK_CYCLE } from '../sprites/ratKinSprite';
import { MordecaiWanderer } from './mordecaiWander';
import { drawSafeRoomBed, restedPulse } from '../sprites/safeRoomBed';
import { drawStoveSteam } from '../sprites/safeRoomDecor';
import { drawSpeechBubble } from '../sprites/speechBubble';
import {
  drawQuestMarker,
  questMarkerAnchorAbove,
  questMarkerColorFor,
  type QuestMarkerState,
} from '../sprites/questNPCSprite';
import type { InteriorFigure } from '../core/InteriorFigure';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawInteractionPrompt, interactionPromptTop } from '../ui/InteractionPrompt';
import { randomFromArray, frameTime } from '../utils';
import { drawText, TEXT_PRESETS } from '../ui/TextBox';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawRadialGlow, type GlowStop } from '../sprites/radialGlow';
import type { Conversation } from '../dialog/Conversation';
import type { DialogLine, NonEmpty } from '../dialog/line';
import type { ConversationHandle, ConversationRequest, PendingLine } from '../dialog/request';
import { MORDECAI_SPEAKER_REF } from '../dialog/scripts/mordecai';

/** Identity of the safe room a player is standing in. */
export interface SafeRoomInfo {
  centre: { x: number; y: number };
  guardsBossType?: string;
  followsBossType?: string;
}

interface MordecaiMinimapMarker {
  x: number;
  y: number;
  type: Exclude<QuestMarkerState, 'none'>;
}

/** Keeps boss kills and the players' bags out of this system. */
export type MordecaiMarkerSource = (room: SafeRoomInfo) => QuestMarkerState;

interface SafeRoomEntry {
  bounds: { x: number; y: number; w: number; h: number };
  centre: { x: number; y: number };
  /** Boss this room is the last stop before, when it guards one. */
  guardsBossType?: string;
  followsBossType?: string;
  marker: QuestMarkerState;
  /** Tiles holding a standing lantern — the room's light sources. */
  lanternTiles: ReadonlyArray<{ x: number; y: number }>;
  /** Tiles holding a stove, whose steam has to be drawn per frame. */
  stoveTiles: ReadonlyArray<{ x: number; y: number }>;
  mordecaiHomeTileX: number;
  mordecaiHomeTileY: number;
  /** Owns Mordecai's position outright, which is what keeps him in his room. */
  wanderer: MordecaiWanderer;
  bedTileX: number;
  bedTileY: number;
  showBed: boolean;
}

/**
 * Every tile a safe room reserves for its own fixtures: Mordecai, the sleeping
 * bed, and the whole Bopca counter run including the galley strip behind it.
 *
 * Exported so interior layouts and occupant placement can keep clear of them
 * instead of duplicating the offset maths. The counter tiles are already
 * non-walkable, but the galley strip is not — it is sealed by geometry rather
 * than walkability — so an occupant placer working from walkability alone would
 * happily stand a townsperson inside the Bopca's kitchen.
 */
export function safeRoomAnchorTiles(map: GameMap): Array<{ x: number; y: number }> {
  const tiles: Array<{ x: number; y: number }> = [];
  for (const sr of map.safeRooms) {
    tiles.push(...mordecaiAndBedTiles(sr));
  }
  for (const layout of planSafeRoomCounters(map)) {
    tiles.push(...layout.counterTiles, ...layout.backTiles, ...layout.galleyTiles);
  }
  // The furnishings too: the stove and the table are as solid as the counter, and
  // an occupant placer working from walkability alone would happily stand a
  // townsperson inside the firebox.
  tiles.push(...safeRoomDecorTiles(map));
  return tiles;
}

function propTilesOfType(
  plan: SafeRoomDecorPlan | undefined,
  type: number,
): ReadonlyArray<{ x: number; y: number }> {
  return (plan?.props ?? [])
    .filter((prop) => prop.type === type)
    .map((prop) => ({ x: prop.x, y: prop.y }));
}

export class SafeRoomSystem implements GameSystem {
  private readonly entries: SafeRoomEntry[];

  /** The handle the open Mordecai conversation was returned, if any — `conversation.isActive` on it is what `_mordecaiOwned` reads. */
  private _mordecaiHandle: ConversationHandle | null = null;
  /**
   * The Mordecai the open dialog belongs to, so walking away is measured against
   * the one being spoken to rather than the nearest one anywhere on the floor.
   *
   * Resolved synchronously by every `open*` call from the position it is
   * handed, since that call is reached from a Space handler that already
   * knows where the player is standing.
   */
  private _speakingEntry: SafeRoomEntry | null = null;
  /**
   * Whether the player has been genuinely inside a safe room at any point during
   * the open conversation.
   *
   * The room test is a tile-in-bounds check that excludes the wall ring and the
   * doorway, while talk range is measured from Mordecai's wandered position — so
   * a player who opens the dialog from the doorway is already "outside" the room
   * and the box would close on the frame it opened, having eaten the interact
   * key. Arming the test only once they are actually in the room fixes that
   * without weakening the walk-out rule.
   */
  private _hasBeenInSafeRoom = false;
  private markerSource: MordecaiMarkerSource | null = null;

  // Magic number constants
  /**
   * Pixels of floor one full walk cycle of his art covers. The choreography's
   * stance foot is planted, so the cycle has to advance with the distance he
   * travels or he skates along his own path.
   */
  private static readonly WANDER_PIXELS_PER_WALK_CYCLE = RAT_KIN_TILES_PER_WALK_CYCLE * TILE_SIZE;
  private static readonly TILE_CENTER = 0.5;
  private static readonly MORDECAI_NEAR_DISTANCE = 2.5;
  /**
   * How far from the Mordecai he is talking to the player may get before the
   * conversation ends itself. His dialog is a floating claim — the player is
   * free to walk while it is open — so without this the box outlives the
   * conversation.
   *
   * Derived from the radius that opens a conversation rather than borrowed from
   * the townsfolk one: a crawler who starts talking at the edge of his 2.5-tile
   * hearing needs room to shift about while reading, and the townsfolk number
   * only feels generous next to their much tighter 1.1-tile approach.
   */
  private static readonly MORDECAI_WALK_AWAY_MULTIPLE = 2.4;
  private static readonly MORDECAI_WALK_AWAY_DISTANCE =
    SafeRoomSystem.MORDECAI_NEAR_DISTANCE * SafeRoomSystem.MORDECAI_WALK_AWAY_MULTIPLE;
  private static readonly BED_NEAR_DISTANCE = 1.8;
  private static readonly MARKER_GAP_PX = 3;
  /** Reach and strength of one standing lantern's pool of light. */
  private static readonly LANTERN_LIGHT_RADIUS_TILES = 3.2;
  private static readonly LANTERN_LIGHT_ALPHA = 0.16;
  private static readonly LANTERN_LIGHT_COLOR = '255,204,128';
  private static readonly BANNER_TEXT_SIZE = 10;
  private static readonly BANNER_TILE_Y_OFFSET = -1;
  private static readonly BANNER_Y_BASELINE_OFFSET = 0.65;
  private static readonly BANNER_TEXT_TOP_OFFSET = 8;
  private static readonly HUD_BANNER_SIZE = 12;
  private static readonly HUD_BANNER_Y_OFFSET = 18;
  private static readonly HUD_BANNER_TEXT_TOP_OFFSET = 10;
  private static readonly HUD_BANNER_ALPHA = 0.85;

  /**
   * Free-running frame counter. Drives the bed's rested pulse and the two
   * procedural Mordecai variants, which animate straight off elapsed frames.
   */
  private wanderTime = 0;

  /** Reused between frames so the sorted pass does not allocate per safe room. */
  private readonly sortedFigures: InteriorFigure[] = [];

  constructor(
    private readonly gameMap: GameMap,
    _startTileX: number,
    _startTileY: number,
    private readonly conversation: Conversation,
    private readonly levelId = 'level1',
  ) {
    this.entries = [];

    // Warmed as the room is built rather than on his first draw: he is standing
    // in it the frame it exists, and the player can walk in from any side.
    prewarmMordecaiForLevel(levelId);

    const decorPlans = planSafeRoomDecor(gameMap);
    // Everything the room has already spoken for. He may amble across his own
    // home tile, but not into the bed, the counter, the galley or the stove.
    const reserved = new Set(
      safeRoomAnchorTiles(gameMap).map((tile) => SafeRoomSystem.tileKey(tile.x, tile.y)),
    );
    if (gameMap.safeRooms.length > 0) {
      gameMap.safeRooms.forEach((sr, safeRoomIndex) => {
        const [mordecai, bed] = mordecaiAndBedTiles(sr);
        const plan = decorPlans.find((candidate) => candidate.safeRoomIndex === safeRoomIndex);
        const canStand = (tileX: number, tileY: number): boolean => {
          if (tileX === mordecai.x && tileY === mordecai.y) return true;
          if (reserved.has(SafeRoomSystem.tileKey(tileX, tileY))) return false;
          return gameMap.isWalkable(tileX, tileY);
        };
        this.entries.push({
          bounds: sr.bounds,
          centre: sr.centre,
          guardsBossType: sr.guardsBossType,
          followsBossType: sr.followsBossType,
          marker: 'none',
          lanternTiles: propTilesOfType(plan, SAFE_ROOM_LANTERN),
          stoveTiles: propTilesOfType(plan, SAFE_ROOM_STOVE),
          mordecaiHomeTileX: mordecai.x,
          mordecaiHomeTileY: mordecai.y,
          wanderer: new MordecaiWanderer(
            sr.bounds,
            mordecai,
            SafeRoomSystem.WANDER_PIXELS_PER_WALK_CYCLE,
            canStand,
          ),
          bedTileX: bed.x,
          bedTileY: bed.y,
          showBed: sr.showBed ?? true,
        });
      });
    }
  }

  private static tileKey(tileX: number, tileY: number): string {
    return `${tileX},${tileY}`;
  }

  /**
   * All Mordecai home tile positions (for the minimap).
   *
   * His *home* tile rather than where he is standing: the minimap marker is a
   * landmark the player navigates by, and one that drifts around its room every
   * few seconds is harder to steer toward than one that stays put.
   */
  get mordecaiPositions(): Array<{ x: number; y: number }> {
    return this.entries.map((e) => ({
      x: e.mordecaiHomeTileX,
      y: e.mordecaiHomeTileY,
    }));
  }

  get mordecaiMarkers(): MordecaiMinimapMarker[] {
    const markers: MordecaiMinimapMarker[] = [];
    for (const e of this.entries) {
      if (e.marker === 'none') continue;
      markers.push({ x: e.mordecaiHomeTileX, y: e.mordecaiHomeTileY, type: e.marker });
    }
    return markers;
  }

  setMarkerSource(source: MordecaiMarkerSource): void {
    this.markerSource = source;
  }

  /** Whether the shared conversation currently open belongs to this system's Mordecai, rather than to whatever else can open it. */
  private get _mordecaiOwned(): boolean {
    return this._mordecaiHandle !== null && this.conversation.isActive(this._mordecaiHandle);
  }

  get mordecaiDialogOpen(): boolean {
    return this._mordecaiOwned;
  }

  /** Ends this system's Mordecai conversation outright, with no side effect. Esc and a forced switch both use this. */
  closeMordecaiDialog(): void {
    if (!this._mordecaiOwned) return;
    this.conversation.close();
    this.forgetMordecaiConversation();
  }

  private forgetMordecaiConversation(): void {
    this._mordecaiHandle = null;
    this._speakingEntry = null;
    this._hasBeenInSafeRoom = false;
  }

  /** The entry `active` is standing in talk range of, or null if none. */
  private findSpeakingEntry(active: { x: number; y: number }): SafeRoomEntry | null {
    return this.entries.find((e) => SafeRoomSystem.isNearThisMordecai(e, active)) ?? null;
  }

  private mordecaiRequest(
    lines: NonEmpty<DialogLine | PendingLine>,
    entry: SafeRoomEntry,
  ): ConversationRequest {
    return {
      lines,
      reward: null,
      questRelated: false,
      ending: { kind: 'close', onClosed: () => this.forgetMordecaiConversation() },
      dismiss: { kind: 'allowed', onDismissed: () => this.forgetMordecaiConversation() },
      haltsWorld: false,
      anchor: {
        position: () => entry.wanderer.state,
        radius: SafeRoomSystem.MORDECAI_WALK_AWAY_DISTANCE,
      },
      // A dialog the player pages through, over a floor that keeps running.
      locksKeyboard: false,
    };
  }

  private beginMordecaiConversation(entry: SafeRoomEntry): void {
    this._speakingEntry = entry;
    this._hasBeenInSafeRoom = false;
  }

  /**
   * Talking to the same Mordecai again while his conversation is already the
   * one on screen chains onto it with `play` rather than calling `open`
   * again: `Conversation.open` dismisses whatever request it supersedes, and
   * that would run this very system's own `onDismissed` — clearing
   * `_speakingEntry` — a moment after `beginMordecaiConversation` just set it
   * for the turn that is about to show.
   */
  private openOrContinueMordecai(request: ConversationRequest): void {
    if (this._mordecaiOwned && this._mordecaiHandle !== null) {
      this._mordecaiHandle.play(request);
      return;
    }
    this._mordecaiHandle = this.conversation.open(request);
  }

  /** Open the dialog and populate it with the async AI response. */
  openMordecaiDialog(active: { x: number; y: number }, responsePromise: Promise<string>): void {
    const entry = this.findSpeakingEntry(active);
    if (entry === null) return;
    this.beginMordecaiConversation(entry);
    this.openOrContinueMordecai(
      this.mordecaiRequest([{ speaker: MORDECAI_SPEAKER_REF, text: responsePromise }], entry),
    );
  }

  /**
   * Open the dialog on a line Mordecai already knows — the floor advice or the
   * post-boss debrief, which needs no server and so has nothing to wait for.
   */
  openMordecaiLine(active: { x: number; y: number }, line: DialogLine): void {
    const entry = this.findSpeakingEntry(active);
    if (entry === null) return;
    this.beginMordecaiConversation(entry);
    this.openOrContinueMordecai(this.mordecaiRequest([line], entry));
  }

  update(ctx: SystemContext): void {
    this.tickMordecaiWalkAway(ctx.active);
    this.evictMobs(ctx.roster.mobs, ctx.roster.grid);
    this.updateWander();
    this.refreshMarkers();
  }

  /**
   * The Mordecai-conversation half of `update()`, callable on its own by a
   * scene (the building interior) that drives this system's wander and
   * dialog but not its mob eviction or quest markers.
   */
  tickMordecaiWalkAway(active: { x: number; y: number }): void {
    this.closeMordecaiDialogIfLeftRoom(active);
  }

  /** Once per update, not per draw: the answer walks both crawlers' bags. */
  private refreshMarkers(): void {
    const source = this.markerSource;
    for (const entry of this.entries) {
      entry.marker = source === null ? 'none' : source(SafeRoomSystem.infoOf(entry));
    }
  }

  private static infoOf(entry: SafeRoomEntry): SafeRoomInfo {
    return {
      centre: entry.centre,
      guardsBossType: entry.guardsBossType,
      followsBossType: entry.followsBossType,
    };
  }

  /**
   * Ends the conversation the instant the player leaves the safe room, having
   * genuinely been inside it — the stricter of the dialog's two walk-away
   * rules. The shared conversation's own anchor radius covers the gentler
   * one, drifting too far from the speaker inside a large room, since that is
   * a plain distance check any conversation can make; leaving the room
   * outright is a boundary only this system knows.
   */
  private closeMordecaiDialogIfLeftRoom(active: { x: number; y: number }): void {
    if (!this._mordecaiOwned) return;
    if (this.isEntityInSafeRoom(active)) {
      this._hasBeenInSafeRoom = true;
      return;
    }
    if (this._hasBeenInSafeRoom) {
      this.closeMordecaiDialog();
    }
  }

  // Wander update

  updateWander(): void {
    this.wanderTime++;
    for (const entry of this.entries) {
      // He holds still while he is talking to you: a 2.5-tile talk radius and an
      // NPC who keeps ambling is an NPC who walks out of his own conversation.
      // `hold` *instead of* `update`, not as well as it — stepping the wanderer
      // in the same frame runs the hold's own pause straight back down to zero,
      // which leaves him reading as walking and re-picking a target every frame.
      if (this._mordecaiOwned) entry.wanderer.hold();
      else entry.wanderer.update();
    }
  }

  // Queries

  isEntityInSafeRoom(entity: { x: number; y: number }): boolean {
    const ts = TILE_SIZE;
    const tx = Math.floor((entity.x + ts * SafeRoomSystem.TILE_CENTER) / ts);
    const ty = Math.floor((entity.y + ts * SafeRoomSystem.TILE_CENTER) / ts);
    return this.entries.some(
      (e) =>
        tx >= e.bounds.x &&
        tx < e.bounds.x + e.bounds.w &&
        ty >= e.bounds.y &&
        ty < e.bounds.y + e.bounds.h,
    );
  }

  /**
   * Which safe room `entity` is standing in, or null if it is in none.
   *
   * Mordecai's floor advice measures its bearings from the room's own centre, so
   * a floor's safe rooms genuinely point in different directions at the same
   * boss, and pins boss-specific dialog to the room that guards that boss.
   */
  safeRoomInfoAt(entity: { x: number; y: number }): SafeRoomInfo | null {
    const ts = TILE_SIZE;
    const tx = Math.floor((entity.x + ts * SafeRoomSystem.TILE_CENTER) / ts);
    const ty = Math.floor((entity.y + ts * SafeRoomSystem.TILE_CENTER) / ts);
    const entry = this.entries.find(
      (e) =>
        tx >= e.bounds.x &&
        tx < e.bounds.x + e.bounds.w &&
        ty >= e.bounds.y &&
        ty < e.bounds.y + e.bounds.h,
    );
    if (entry === undefined) return null;
    return SafeRoomSystem.infoOf(entry);
  }

  /**
   * Where the Mordecai the crawler is talking to is standing, while that
   * conversation is open — so the crawler can be turned to face him. Null
   * with no conversation, or before the speaker has been picked out.
   */
  get speakingMordecaiPosition(): { x: number; y: number } | null {
    if (!this._mordecaiOwned) return null;
    return this._speakingEntry?.wanderer.state ?? null;
  }

  isNearMordecai(entity: { x: number; y: number }): boolean {
    return this.entries.some((e) => SafeRoomSystem.isNearThisMordecai(e, entity));
  }

  /** Talk range is measured from where he is standing, not from his home tile. */
  private static isNearThisMordecai(
    entry: SafeRoomEntry,
    entity: { x: number; y: number },
  ): boolean {
    const { x, y } = entry.wanderer.state;
    return (
      Math.hypot(entity.x - x, entity.y - y) < TILE_SIZE * SafeRoomSystem.MORDECAI_NEAR_DISTANCE
    );
  }

  private showsTalkPrompt(entry: SafeRoomEntry, active: { x: number; y: number }): boolean {
    return (
      this.isEntityInSafeRoom(active) &&
      SafeRoomSystem.isNearThisMordecai(entry, active) &&
      !this._mordecaiOwned
    );
  }

  /** Whether the bed's rested pulse should animate — purely cosmetic, no gameplay hangs off it. */
  private isNearThisBed(entry: SafeRoomEntry, entity: { x: number; y: number }): boolean {
    if (!entry.showBed) return false;
    const bx = entry.bedTileX * TILE_SIZE;
    const by = entry.bedTileY * TILE_SIZE;
    return Math.hypot(entity.x - bx, entity.y - by) < TILE_SIZE * SafeRoomSystem.BED_NEAR_DISTANCE;
  }

  evictMobs(_mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    const fallback =
      this.gameMap.mobSpawnPoints.length > 0
        ? this.gameMap.mobSpawnPoints
        : this.gameMap.hallwaySpawnPoints;
    if (fallback.length === 0) return;

    const ts = TILE_SIZE;
    for (const e of this.entries) {
      const b = e.bounds;
      const candidates = mobGrid.queryRect(
        b.x * ts - ts,
        b.y * ts - ts,
        b.w * ts + ts * 2,
        b.h * ts + ts * 2,
      );
      for (const mob of candidates) {
        // Only threats are turned out. Mongo and a hired mercenary follow the
        // party in, and flinging an ally to a random spawn point every frame
        // makes Mongo's rescue snap him straight back — a teleport loop that
        // never settles while the party stands inside.
        if (!mob.isAlive || !mob.isHostile) continue;
        if (this.isEntityInSafeRoom(mob)) {
          const ox = mob.x,
            oy = mob.y;
          const pt = randomFromArray(fallback);
          mob.x = pt.x * ts;
          mob.y = pt.y * ts;
          mobGrid.move(mob, ox, oy);
        }
      }
    }
  }

  renderObjects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: { x: number; y: number },
  ): void {
    const ts = TILE_SIZE;

    for (const e of this.entries) {
      const b = e.bounds;

      // "SAFE ROOM" banner (world-space label above the room)
      // size=10, old baseline = bsy + ts*0.65; top = baseline - round(10*0.8) = baseline - 8
      const bannerTileY = b.y + SafeRoomSystem.BANNER_TILE_Y_OFFSET;
      const bannerTileX = b.x + Math.floor(b.w / 2);
      const bsx = bannerTileX * ts - camX;
      const bsy = bannerTileY * ts - camY;
      drawText(ctx, 'SAFE ROOM', {
        ...TEXT_PRESETS.label,
        x: bsx,
        y:
          bsy +
          ts * SafeRoomSystem.BANNER_Y_BASELINE_OFFSET -
          SafeRoomSystem.BANNER_TEXT_TOP_OFFSET,
        size: SafeRoomSystem.BANNER_TEXT_SIZE,
        bold: true,
        color: '#f0e4c8',
        align: 'center',
      });

      // Lantern pools first, so the bed and Mordecai are lit by them rather than
      // washed out under them.
      this.renderLanternLight(ctx, e, camX, camY);
      // The stove tile itself is baked into the static chunk cache, so its steam
      // has to be drawn here or it would freeze at whatever second the bake ran.
      for (const stove of e.stoveTiles) {
        drawStoveSteam(ctx, stove.x * ts - camX, stove.y * ts - camY, ts, frameTime);
      }

      if (e.showBed) {
        const bedSx = e.bedTileX * ts - camX;
        const bedSy = e.bedTileY * ts - camY;
        // Per entry, not `isNearBed`: with two safe rooms on a floor that would
        // set both beds breathing whenever the player stood at either one.
        const pulse = this.isNearThisBed(e, active) ? restedPulse(this.wanderTime) : 0;
        drawSafeRoomBed(ctx, bedSx, bedSy, ts, pulse);
      }
    }
  }

  /**
   * Mordecai, as a figure for the scene's Y-sorted pass.
   *
   * He is *not* drawn with the room's other fixtures, and the Bopca's counter is
   * why. That counter's front face is repainted after the world pass so it
   * occludes the cook standing behind it, which means anything drawn in the
   * world pass is behind the counter too — Mordecai walking along the near side
   * of it disappeared behind it. The players avoid that by being in the sorted
   * pass; putting him there gives him the same depth against the counter, the
   * table, the stove and the braziers, for the same reason.
   *
   * Always drawing over the counter is not merely parity, it is correct: the run
   * is stamped against the room's north wall and its own tiles are reserved, so
   * there is no floor he can reach that is behind it.
   */
  sortedRenderables(
    active: { x: number; y: number },
    speechBubblePulse: number,
  ): ReadonlyArray<InteriorFigure> {
    this.sortedFigures.length = 0;
    for (const e of this.entries) {
      const wander = e.wanderer.state;
      const markerColor = this._mordecaiOwned ? undefined : questMarkerColorFor(e.marker);
      // Unlike the bubble, the marker shows at any distance to pull the player over.
      const showBubble =
        markerColor === undefined &&
        SafeRoomSystem.isNearThisMordecai(e, active) &&
        !this._mordecaiOwned;
      const markerGlyph = e.marker === 'question' ? '?' : '!';
      const promptShown = this.showsTalkPrompt(e, active);
      this.sortedFigures.push({
        y: wander.y,
        render: (ctx, camX, camY, ts) => {
          const msx = wander.x - camX;
          const msy = wander.y - camY;
          drawMordecaiForLevel(
            ctx,
            msx,
            msy,
            ts,
            {
              walkTime: this.wanderTime,
              walkPhase: wander.walkPhase,
              isWalking: wander.isWalking,
              facingX: wander.facingX,
              facingY: wander.facingY,
              lastHorizontalFacing: wander.lastHorizontalFacing,
              idleOffsetSeconds: wander.idleOffsetSeconds,
            },
            this.levelId,
          );
          const overheadY = msy - mordecaiOverheadLift(this.levelId, ts);
          if (markerColor !== undefined) {
            const headTop = mordecaiHeadTop(this.levelId, msy, ts);
            const clearOf = promptShown
              ? Math.min(headTop, interactionPromptTop(overheadY))
              : headTop;
            const markerY = questMarkerAnchorAbove(clearOf - SafeRoomSystem.MARKER_GAP_PX, ts);
            drawQuestMarker(ctx, msx, markerY, ts, markerGlyph, markerColor);
          } else if (showBubble) {
            drawSpeechBubble(ctx, msx, overheadY, ts, speechBubblePulse);
          }
        },
      });
    }
    return this.sortedFigures;
  }

  /**
   * Safe-room HUD: the room banner, plus the `Talk` world prompt.
   *
   * `suppressWorldPrompt` exists because a safe room now holds two things worth
   * pressing Space at — Mordecai and the Bopca's counter — and in a small room
   * both can be in range at once. The Bopca has first claim on Space, so the
   * scene silences this system's prompt when the counter is in reach; without it
   * the player saw two `Talk` prompts and only one of them did anything.
   */
  renderUI(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: { x: number; y: number },
    suppressWorldPrompt = false,
  ): void {
    // Guards the prompt loop only — the HUD banner below it still draws when the
    // Bopca's counter has claimed Space.
    for (const e of suppressWorldPrompt ? [] : this.entries) {
      // Talk prompt near Mordecai
      const wander = e.wanderer.state;
      const mx = wander.x - camX;
      const promptY = wander.y - camY - mordecaiOverheadLift(this.levelId, TILE_SIZE);
      if (this.showsTalkPrompt(e, active)) {
        drawInteractionPrompt(ctx, mx, promptY, TILE_SIZE, 'Talk');
        break; // only prompt once
      }
    }

    // "~ Safe Room ~" HUD banner when player is inside
    // size=12, old baseline = canvas.height - 18; top = baseline - round(12*0.8) = baseline - 10
    if (this.isEntityInSafeRoom(active)) {
      drawText(ctx, '~ Safe Room ~', {
        x: viewportWidth() / 2,
        y:
          viewportHeight() -
          SafeRoomSystem.HUD_BANNER_Y_OFFSET -
          SafeRoomSystem.HUD_BANNER_TEXT_TOP_OFFSET,
        size: SafeRoomSystem.HUD_BANNER_SIZE,
        bold: true,
        color: '#f0e4c8',
        alpha: SafeRoomSystem.HUD_BANNER_ALPHA,
        align: 'center',
      });
    }
  }

  /**
   * The pools of warm light the room's standing lanterns throw.
   *
   * Drawn in `renderObjects` rather than baked into the tile cache because it
   * composites over the floor *and* under the sprites standing on it — a lantern
   * pool baked into the ground would be covered by every prop drawn after it.
   *
   * Deliberately cheap: this runs every frame, unlike the ground passes. A
   * handful of radial gradients per room is affordable; a per-pixel falloff is
   * not.
   */
  private renderLanternLight(
    ctx: CanvasRenderingContext2D,
    entry: SafeRoomEntry,
    camX: number,
    camY: number,
  ): void {
    const radius = TILE_SIZE * SafeRoomSystem.LANTERN_LIGHT_RADIUS_TILES;
    const stops: GlowStop[] = [
      {
        offset: 0,
        color: `rgba(${SafeRoomSystem.LANTERN_LIGHT_COLOR},${SafeRoomSystem.LANTERN_LIGHT_ALPHA})`,
      },
      { offset: 1, color: `rgba(${SafeRoomSystem.LANTERN_LIGHT_COLOR},0)` },
    ];
    for (const lantern of entry.lanternTiles) {
      const cx = lantern.x * TILE_SIZE + TILE_SIZE / 2 - camX;
      const cy = lantern.y * TILE_SIZE + TILE_SIZE / 2 - camY;
      drawRadialGlow(ctx, cx, cy, radius, stops);
    }
  }
}
