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
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import { drawMordecaiForLevel } from '../sprites/mordecaiSprite';
import { RAT_KIN_TILES_PER_WALK_CYCLE } from '../sprites/ratKinSprite';
import { MordecaiWanderer } from './mordecaiWander';
import { drawSafeRoomBed, restedPulse } from '../sprites/safeRoomBed';
import { drawStoveSteam } from '../sprites/safeRoomDecor';
import { drawSpeechBubble } from '../sprites/speechBubble';
import type { InteriorFigure } from '../core/InteriorFigure';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { randomFromArray, clamp, frameTime } from '../utils';
import { drawText, TEXT_PRESETS } from '../ui/TextBox';
import { DialogBox } from '../ui/DialogBox';
import type { AudioManager } from '../audio/AudioManager';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawRadialGlow, type GlowStop } from '../sprites/radialGlow';

/** Identity of the safe room a player is standing in. */
export interface SafeRoomInfo {
  centre: { x: number; y: number };
  guardsBossType?: string;
}

interface SafeRoomEntry {
  bounds: { x: number; y: number; w: number; h: number };
  centre: { x: number; y: number };
  /** Boss this room is the last stop before, when it guards one. */
  guardsBossType?: string;
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

  private _mordecaiDialogOpen = false;
  private _awaitingResponse = false;
  /** Pages of a scripted Mordecai dialog, or null while the AI path is in use. */
  private _pages: ReadonlyArray<string> | null = null;
  private _pageIndex = 0;
  private readonly _dialogBox: DialogBox | null;
  private _isSleeping = false;
  private sleepTimer = 0;
  private sleepHealed = false;

  private readonly SLEEP_TOTAL = 150;
  private readonly SLEEP_FADEIN = 30;
  private readonly SLEEP_HOLD = 90;

  // Magic number constants
  /**
   * Pixels of floor one full walk cycle of the sprite sheet covers. The sheet's
   * stance foot is planted, so the cycle has to advance with the distance he
   * travels or he skates along his own path.
   */
  private static readonly WANDER_PIXELS_PER_WALK_CYCLE = RAT_KIN_TILES_PER_WALK_CYCLE * TILE_SIZE;
  private static readonly TILE_CENTER = 0.5;
  private static readonly MORDECAI_NEAR_DISTANCE = 2.5;
  private static readonly BED_NEAR_DISTANCE = 1.8;
  private static readonly SLEEP_HEAL_TRIGGER = 5;
  /** Reach and strength of one standing lantern's pool of light. */
  private static readonly LANTERN_LIGHT_RADIUS_TILES = 3.2;
  private static readonly LANTERN_LIGHT_ALPHA = 0.16;
  private static readonly LANTERN_LIGHT_COLOR = '255,204,128';
  private static readonly SLEEP_FRAMES_DEDUCTED = 10800;
  private static readonly BANNER_TEXT_SIZE = 10;
  private static readonly BANNER_TILE_Y_OFFSET = -1;
  private static readonly BANNER_Y_BASELINE_OFFSET = 0.65;
  private static readonly BANNER_TEXT_TOP_OFFSET = 8;
  private static readonly HUD_BANNER_SIZE = 12;
  private static readonly HUD_BANNER_Y_OFFSET = 18;
  private static readonly HUD_BANNER_TEXT_TOP_OFFSET = 10;
  private static readonly HUD_BANNER_ALPHA = 0.85;
  private static readonly SLEEP_TEXT_Y_OFFSET = 10;
  private static readonly SLEEP_TEXT_TOP_OFFSET = 21;
  private static readonly ZZZ_Y_OFFSET = 18;
  private static readonly ZZZ_TEXT_TOP_OFFSET = 11;

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
    private readonly levelId = 'level1',
    audio?: AudioManager | null,
  ) {
    this._dialogBox =
      audio !== null && audio !== undefined
        ? new DialogBox(audio, { speakerName: 'Mordecai', revealMode: 'sentence' })
        : null;
    this.entries = [];

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

  get isSleeping(): boolean {
    return this._isSleeping;
  }

  get mordecaiDialogOpen(): boolean {
    return this._mordecaiDialogOpen;
  }

  set mordecaiDialogOpen(v: boolean) {
    this._mordecaiDialogOpen = v;
    if (!v) {
      this._awaitingResponse = false;
      this._pages = null;
      this._dialogBox?.hide();
    }
  }

  /** Open the dialog and populate it with the async AI response. */
  openMordecaiDialog(responsePromise: Promise<string>): void {
    this._mordecaiDialogOpen = true;
    this._awaitingResponse = true;
    this._pages = null;
    this._dialogBox?.show('...');
    void responsePromise.then((text) => {
      this._awaitingResponse = false;
      if (this._mordecaiDialogOpen) {
        this._dialogBox?.show(text);
      }
    });
  }

  /**
   * Open the dialog on a multi-page script Mordecai already knows — the floor
   * advice, which needs no server and so has nothing to wait for.
   *
   * Separate from `openMordecaiDialog` rather than a `Promise<string[]>` version
   * of it: a resolved promise would still take a frame to land, so the box would
   * flash `'...'` before text that was available all along.
   */
  openMordecaiPages(pages: ReadonlyArray<string>): void {
    if (pages.length === 0) return;
    this._mordecaiDialogOpen = true;
    this._awaitingResponse = false;
    this._pages = pages;
    this._pageIndex = 0;
    this.showCurrentPage();
  }

  private showCurrentPage(): void {
    const pages = this._pages;
    if (pages === null) return;
    this._dialogBox?.show(pages[this._pageIndex], {
      pageIndicator: { current: this._pageIndex + 1, total: pages.length },
    });
  }

  /**
   * Skip the typing animation if in progress, turn to the next page if there is
   * one, or close the dialog. Call from Space / click handlers.
   * While the AI response is still loading, Space does nothing.
   */
  advanceMordecaiDialog(): void {
    if (!this._mordecaiDialogOpen) return;
    if (this._awaitingResponse) return;
    if (this._dialogBox !== null && !this._dialogBox.isFullyRevealed()) {
      this._dialogBox.skipToEnd();
      return;
    }
    const pages = this._pages;
    if (pages !== null && this._pageIndex < pages.length - 1) {
      this._pageIndex++;
      this.showCurrentPage();
      return;
    }
    this.mordecaiDialogOpen = false;
  }

  /** Advance the dialog animation without requiring a full SystemContext. */
  tickDialog(): void {
    this._dialogBox?.update();
  }

  update(ctx: SystemContext): void {
    this._dialogBox?.update();
    this.evictMobs(ctx.mobs, ctx.mobGrid);
    this.updateWander();
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
      if (this._mordecaiDialogOpen) entry.wanderer.hold();
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
    return { centre: entry.centre, guardsBossType: entry.guardsBossType };
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

  isNearBed(entity: { x: number; y: number }): boolean {
    return this.entries.some((e) => this.isNearThisBed(e, entity));
  }

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
        if (!mob.isAlive) continue;
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

  startSleep(): void {
    this._isSleeping = true;
    this.sleepTimer = this.SLEEP_TOTAL;
    this.sleepHealed = false;
  }

  /** Returns frames to deduct from the level timer when sleep ends (10800), else 0. */
  updateSleep(human: HumanPlayer, cat: CatPlayer): number {
    this.sleepTimer--;

    if (
      !this.sleepHealed &&
      this.sleepTimer <= this.SLEEP_HOLD + this.SLEEP_FADEIN - SafeRoomSystem.SLEEP_HEAL_TRIGGER
    ) {
      human.hp = human.maxHp;
      cat.hp = cat.maxHp;
      this.sleepHealed = true;
    }

    if (this.sleepTimer <= 0) {
      this._isSleeping = false;
      return SafeRoomSystem.SLEEP_FRAMES_DEDUCTED; // 3 minutes at 60 fps
    }
    return 0;
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
      const showBubble = SafeRoomSystem.isNearThisMordecai(e, active) && !this._mordecaiDialogOpen;
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
          if (showBubble) drawSpeechBubble(ctx, msx, msy, ts, speechBubblePulse);
        },
      });
    }
    return this.sortedFigures;
  }

  /**
   * Safe-room HUD: the room banner, plus the `Sleep` / `Talk` world prompts.
   *
   * `suppressWorldPrompt` exists because a safe room now holds three things worth
   * pressing Space at — the bed, Mordecai, and the Bopca's counter — and in a
   * small room two of them can be in range at once. The Bopca has first claim on
   * Space, so the scene silences this system's prompt when the counter is in
   * reach; without it the player saw two `Talk` prompts and only one of them did
   * anything.
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
      // Sleep prompt near bed
      if (
        e.showBed &&
        this.isEntityInSafeRoom(active) &&
        this.isNearBed(active) &&
        !this._isSleeping
      ) {
        const bsx = e.bedTileX * TILE_SIZE - camX;
        const bsy = e.bedTileY * TILE_SIZE - camY;
        drawInteractionPrompt(ctx, bsx, bsy, TILE_SIZE, 'Sleep');
        break; // only prompt for the first nearby bed
      }

      // Talk prompt near Mordecai
      const wander = e.wanderer.state;
      const mx = wander.x - camX;
      const my = wander.y - camY;
      const nearThis =
        this.isEntityInSafeRoom(active) &&
        SafeRoomSystem.isNearThisMordecai(e, active) &&
        !this._mordecaiDialogOpen;
      if (nearThis) {
        drawInteractionPrompt(ctx, mx, my, TILE_SIZE, 'Talk');
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

  renderMordecaiDialog(ctx: CanvasRenderingContext2D): void {
    this._dialogBox?.render(ctx);
  }

  renderSleepOverlay(ctx: CanvasRenderingContext2D): void {
    const t = this.sleepTimer;
    const fadeIn = this.SLEEP_FADEIN;
    const hold = this.SLEEP_HOLD;

    let alpha: number;
    if (t > hold + fadeIn) {
      alpha = 1 - (t - hold - fadeIn) / fadeIn;
    } else if (t > fadeIn) {
      alpha = 1;
    } else {
      alpha = t / fadeIn;
    }

    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, viewportWidth(), viewportHeight());
    ctx.restore();

    if (t > fadeIn && t <= hold + fadeIn) {
      // "Sleeping..." size=26, old baseline = canvas.height/2 - 10
      // top = (canvas.height/2 - 10) - round(26*0.8) = (canvas.height/2 - 10) - 21
      drawText(ctx, 'Sleeping...', {
        x: viewportWidth() / 2,
        y:
          viewportHeight() / 2 -
          SafeRoomSystem.SLEEP_TEXT_Y_OFFSET -
          SafeRoomSystem.SLEEP_TEXT_TOP_OFFSET,
        size: 26,
        bold: true,
        color: '#e2e8f0',
        align: 'center',
      });
      // "zZz" size=14, old baseline = canvas.height/2 + 18
      // top = (canvas.height/2 + 18) - round(14*0.8) = (canvas.height/2 + 18) - 11
      drawText(ctx, 'zZz', {
        x: viewportWidth() / 2,
        y: viewportHeight() / 2 + SafeRoomSystem.ZZZ_Y_OFFSET - SafeRoomSystem.ZZZ_TEXT_TOP_OFFSET,
        size: 14,
        color: '#94a3b8',
        align: 'center',
      });
    }
  }
}
