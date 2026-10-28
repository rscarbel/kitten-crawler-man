import type { GameMap } from '../map/GameMap';
import type { TilePoint } from '../map/town/townPlan';
import type { SafeRoomService } from '../map/DungeonGenerator';
import { planSafeRoomCounters } from '../map/safeRoomCounterLayout';
import {
  planSafeRoomDecor,
  safeRoomDecorTiles,
  type SafeRoomDecorPlan,
} from '../map/safeRoomDecorLayout';
import { SAFE_ROOM_LANTERN, SAFE_ROOM_STOVE } from '../map/tileTypes';
import { isFieldStation, guideAndBedTiles } from '../map/safeRoomFixtures';
import { safeRoomIdIn, sameSafeRoom, type SafeRoomId, type SafeRoomScope } from '../map/safeRoomId';
import { TILE_SIZE } from '../core/constants';
import type { SpatialGrid } from '../core/world/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import { drawSafeRoomBed, restedPulse } from '../sprites/safeRoomBed';
import { drawStoveSteam } from '../sprites/safeRoomDecor';
import type { GameSystem, SystemContext } from './GameSystem';
import { randomFromArray, frameTime } from '../utils';
import { worldText } from '../ui/world/worldText';
import { worldPalette } from '../ui/theme/worldInk';
import { viewportWidth, viewportHeight } from '../core/rendering/Viewport';
import { drawRadialGlow, type GlowStop } from '../sprites/radialGlow';

/** Identity of the safe room a player is standing in. */
export interface SafeRoomInfo {
  readonly id: SafeRoomId;
  centre: { x: number; y: number };
  guardsBossType?: string;
  followsBossType?: string;
  servesSpecialRoom?: SafeRoomService;
}

/** Where Dave stands and walks in one safe room. */
export interface GuidePlacement {
  readonly id: SafeRoomId;
  /** Safe-room bounds in tiles. */
  readonly bounds: { x: number; y: number; w: number; h: number };
  /** The tile he arrives on and wanders around. */
  readonly home: TilePoint;
  /** Whether he may stand on a tile: his own home tile, or open floor nothing in the room has claimed. */
  readonly canStand: (tileX: number, tileY: number) => boolean;
}

interface SafeRoomEntry {
  readonly id: SafeRoomId;
  bounds: { x: number; y: number; w: number; h: number };
  centre: { x: number; y: number };
  /** Boss this room is the last stop before, when it guards one. */
  guardsBossType?: string;
  followsBossType?: string;
  servesSpecialRoom?: SafeRoomService;
  /** Tiles holding a standing lantern — the room's light sources. */
  lanternTiles: ReadonlyArray<{ x: number; y: number }>;
  /** Tiles holding a stove, whose steam has to be drawn per frame. */
  stoveTiles: ReadonlyArray<{ x: number; y: number }>;
  readonly guide: GuidePlacement;
  bedTileX: number;
  bedTileY: number;
  showBed: boolean;
}

/**
 * Every tile a safe room reserves for its own fixtures: Dave's arrival tile,
 * the sleeping bed, and the whole Bopca counter run including the galley strip
 * behind it.
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
    tiles.push(...guideAndBedTiles(sr));
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

  private static readonly TILE_CENTER = 0.5;
  private static readonly BED_NEAR_DISTANCE = 1.8;
  /** Reach and strength of one standing lantern's pool of light. */
  private static readonly LANTERN_LIGHT_RADIUS_TILES = 3.2;
  private static readonly BANNER_TEXT_SIZE = 10;
  private static readonly BANNER_TILE_Y_OFFSET = -1;
  private static readonly BANNER_Y_BASELINE_OFFSET = 0.65;
  private static readonly BANNER_TEXT_TOP_OFFSET = 8;
  private static readonly HUD_BANNER_SIZE = 12;
  private static readonly HUD_BANNER_Y_OFFSET = 18;
  private static readonly HUD_BANNER_TEXT_TOP_OFFSET = 10;
  private static readonly HUD_BANNER_ALPHA = 0.85;

  private bedPulseFrames = 0;

  constructor(
    private readonly gameMap: GameMap,
    scope: SafeRoomScope,
  ) {
    this.entries = [];

    const decorPlans = planSafeRoomDecor(gameMap);
    // Everything the room has already spoken for. Dave may amble across his own
    // home tile, but not into the bed, the counter, the galley or the stove.
    const reserved = new Set(
      safeRoomAnchorTiles(gameMap).map((tile) => SafeRoomSystem.tileKey(tile.x, tile.y)),
    );
    gameMap.safeRooms.forEach((sr, safeRoomIndex) => {
      const [home, bed] = guideAndBedTiles(sr);
      const plan = decorPlans.find((candidate) => candidate.safeRoomIndex === safeRoomIndex);
      const canStand = (tileX: number, tileY: number): boolean => {
        if (tileX === home.x && tileY === home.y) return true;
        if (reserved.has(SafeRoomSystem.tileKey(tileX, tileY))) return false;
        return gameMap.isWalkable(tileX, tileY);
      };
      const id = safeRoomIdIn(scope, safeRoomIndex);
      this.entries.push({
        id,
        bounds: sr.bounds,
        centre: sr.centre,
        guardsBossType: sr.guardsBossType,
        followsBossType: sr.followsBossType,
        servesSpecialRoom: sr.servesSpecialRoom,
        lanternTiles: propTilesOfType(plan, SAFE_ROOM_LANTERN),
        stoveTiles: propTilesOfType(plan, SAFE_ROOM_STOVE),
        guide: { id, bounds: sr.bounds, home, canStand },
        bedTileX: bed.x,
        bedTileY: bed.y,
        showBed: (sr.showBed ?? true) && !isFieldStation(sr),
      });
    });
  }

  private static tileKey(tileX: number, tileY: number): string {
    return `${tileX},${tileY}`;
  }

  /** Where Dave stands and walks in the room `id` names, or null when it is not on this map. */
  guidePlacement(id: SafeRoomId): GuidePlacement | null {
    return this.entries.find((e) => sameSafeRoom(e.id, id))?.guide ?? null;
  }

  /** The room `id` names, or null when it is not on this map. */
  safeRoomInfo(id: SafeRoomId): SafeRoomInfo | null {
    const entry = this.entries.find((e) => sameSafeRoom(e.id, id));
    return entry === undefined ? null : SafeRoomSystem.infoOf(entry);
  }

  update(ctx: SystemContext): void {
    this.bedPulseFrames++;
    this.evictMobs(ctx.roster.mobs, ctx.roster.grid);
  }

  /** The bed's rested pulse, for a scene that draws the room but evicts nothing. */
  tickBeds(): void {
    this.bedPulseFrames++;
  }

  private static infoOf(entry: SafeRoomEntry): SafeRoomInfo {
    return {
      id: entry.id,
      centre: entry.centre,
      guardsBossType: entry.guardsBossType,
      followsBossType: entry.followsBossType,
      servesSpecialRoom: entry.servesSpecialRoom,
    };
  }

  // Queries

  isEntityInSafeRoom(entity: { x: number; y: number }): boolean {
    return this.entries.some((e) => SafeRoomSystem.roomHolds(e, entity));
  }

  private static roomHolds(entry: SafeRoomEntry, entity: { x: number; y: number }): boolean {
    const ts = TILE_SIZE;
    const tx = Math.floor((entity.x + ts * SafeRoomSystem.TILE_CENTER) / ts);
    const ty = Math.floor((entity.y + ts * SafeRoomSystem.TILE_CENTER) / ts);
    const { bounds } = entry;
    return tx >= bounds.x && tx < bounds.x + bounds.w && ty >= bounds.y && ty < bounds.y + bounds.h;
  }

  /**
   * Which safe room `entity` is standing in, or null if it is in none.
   *
   * Dave's floor advice measures its bearings from the room's own centre, so
   * a floor's safe rooms genuinely point in different directions at the same
   * boss, and pins boss-specific dialog to the room that guards that boss.
   */
  safeRoomInfoAt(entity: { x: number; y: number }): SafeRoomInfo | null {
    const entry = this.entries.find((e) => SafeRoomSystem.roomHolds(e, entity));
    return entry === undefined ? null : SafeRoomSystem.infoOf(entry);
  }

  /** The room `entity` is standing in, or null if it is in none. */
  safeRoomAt(entity: { x: number; y: number }): SafeRoomId | null {
    return this.entries.find((e) => SafeRoomSystem.roomHolds(e, entity))?.id ?? null;
  }

  /** Whether the bed's rested pulse should animate — purely cosmetic, no gameplay hangs off it. */
  private isNearThisBed(entry: SafeRoomEntry, entity: { x: number; y: number }): boolean {
    if (!entry.showBed) return false;
    const bx = entry.bedTileX * TILE_SIZE;
    const by = entry.bedTileY * TILE_SIZE;
    return Math.hypot(entity.x - bx, entity.y - by) < TILE_SIZE * SafeRoomSystem.BED_NEAR_DISTANCE;
  }

  evictMobs(_mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    const fallback: ReadonlyArray<TilePoint> =
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
        // Only threats are turned out. Deinonychus and a hired mercenary follow the
        // party in, and flinging an ally to a random spawn point every frame
        // makes Deinonychus's rescue snap him straight back — a teleport loop that
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

      const bannerTileY = b.y + SafeRoomSystem.BANNER_TILE_Y_OFFSET;
      const bannerTileX = b.x + Math.floor(b.w / 2);
      const bsx = bannerTileX * ts - camX;
      const bsy = bannerTileY * ts - camY;
      worldText(ctx, 'SAFE ROOM', {
        style: 'label',
        x: bsx,
        y:
          bsy +
          ts * SafeRoomSystem.BANNER_Y_BASELINE_OFFSET -
          SafeRoomSystem.BANNER_TEXT_TOP_OFFSET,
        size: SafeRoomSystem.BANNER_TEXT_SIZE,
        bold: true,
        color: worldPalette.safeRoom.ink,
        align: 'center',
      });

      // Lantern pools first, so the bed and the people standing by it are lit
      // by them rather than washed out under them.
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
        const pulse = this.isNearThisBed(e, active) ? restedPulse(this.bedPulseFrames) : 0;
        drawSafeRoomBed(ctx, bedSx, bedSy, ts, pulse);
      }
    }
  }

  /** The room banner along the bottom of the screen, while `active` is inside a safe room. */
  renderUI(ctx: CanvasRenderingContext2D, active: { x: number; y: number }): void {
    if (this.isEntityInSafeRoom(active)) {
      worldText(ctx, '~ Safe Room ~', {
        x: viewportWidth() / 2,
        y:
          viewportHeight() -
          SafeRoomSystem.HUD_BANNER_Y_OFFSET -
          SafeRoomSystem.HUD_BANNER_TEXT_TOP_OFFSET,
        size: SafeRoomSystem.HUD_BANNER_SIZE,
        bold: true,
        color: worldPalette.safeRoom.ink,
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
      { offset: 0, color: worldPalette.safeRoom.lanternPool },
      { offset: 1, color: worldPalette.safeRoom.lanternPoolRim },
    ];
    for (const lantern of entry.lanternTiles) {
      const cx = lantern.x * TILE_SIZE + TILE_SIZE / 2 - camX;
      const cy = lantern.y * TILE_SIZE + TILE_SIZE / 2 - camY;
      drawRadialGlow(ctx, cx, cy, radius, stops);
    }
  }
}
