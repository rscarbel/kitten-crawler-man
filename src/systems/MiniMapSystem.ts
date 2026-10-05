import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { GameSystem } from './GameSystem';
import { frameTime } from '../utils';
import { worldText } from '../ui/world/worldText';
import { worldPalette } from '../ui/theme/worldInk';
import type { Rect } from '../ui/core/geom';
import { TREE, TREE_STAGE_CHARRED, FloorTypeValue } from '../map/tileTypes';
import { MINIMAP_MARKER_COLORS, minimapTileColor } from '../ui/theme/minimapColors';
import type { ProcessingStationKind } from './briarHollow/processingStations';
import { drawRopeCoilGlyph, drawSawBladeGlyph } from '../ui/icons/stationGlyphs';
import { SERVICE_DECAL_TILE_TYPES } from '../map/serviceLevelProps';
import { CELLAR_FLAT_DECAL_TILE_TYPES, CELLAR_STANDING_DECAL_TILE_TYPES } from '../map/cellarProps';

/**
 * The dungeon's walkable dressing. A minimap is read for a way through, so
 * each of these draws as the floor it lies on. Solid dressing takes the
 * default colour, the same as a barrel or a crate.
 */
const DUNGEON_WALKABLE_DECAL_TILE_TYPES: ReadonlySet<number> = new Set([
  ...SERVICE_DECAL_TILE_TYPES,
  ...CELLAR_FLAT_DECAL_TILE_TYPES,
  ...CELLAR_STANDING_DECAL_TILE_TYPES,
]);

/** Half of TILE_SIZE — used to find the center of a tile from its top-left corner. */
const HALF_TILE = TILE_SIZE / 2;
/** Radar range for showing enemy dots on the minimap (in pixels). */
const MOB_RADAR_TILES = 20;
/** Pixels per tile in expanded mode. */
const EXPANDED_PX_PER_TILE = 1;
/** Pixels per tile in normal mode. */
const NORMAL_PX_PER_TILE = 2;
/** Player dot radius on minimap. */
const PLAYER_DOT_RADIUS = 2.5;
/** Companion dot radius on minimap. */
const COMPANION_DOT_RADIUS = 2;
/** Mob dot radius on minimap. */
const MOB_DOT_RADIUS = 1.5;
/** Mordecai dot radius on minimap. */
const MORDECAI_DOT_RADIUS = 1.5;
/** Pet dot radius on minimap. Under the companion's — he is party, but not a crawler. */
const PET_DOT_RADIUS = 1.75;
/** Quest marker pulse speed (radians per frame-time unit). */
const QUEST_MARKER_PULSE_SPEED = 5;
const QUEST_MARKER_FONT_SIZE = 8;
const QUEST_MARKER_PULSE_BASE = 0.7;
const QUEST_MARKER_PULSE_RANGE = 0.3;
/** Quest marker X line arm length (pixels). */
const QUEST_MARKER_X_ARM = 3;
/** X marker line width. */
const QUEST_MARKER_LINE_WIDTH = 1.5;
/** Radius of the elite marker's white circle (pixels). */
const ELITE_MARKER_RADIUS = 4;
/** Half-length of the elite marker's black cross arms (pixels). */
const ELITE_MARKER_CROSS_ARM = 2.5;

/** Minimap quest-marker glyphs; 'elite' is the book's black-cross-in-white-circle elite mark. */
export type QuestMarkerType = 'exclamation' | 'question' | 'red_x' | 'elite';
/** Stairwell icon half-size (extra pixels beyond pxPerTile). */
const STAIRWELL_ICON_HALF_EXTRA = 1;
/** The escape stairwell spans two tiles each way, and its icon is drawn a little proud of them. */
const ESCAPE_MARKER_TILES = 2;
const ESCAPE_MARKER_HALF_EXTRA = 1;
const ESCAPE_MARKER_PULSE_BASE = 0.75;
const ESCAPE_MARKER_PULSE_RANGE = 0.25;
/** Extra tiles revealed around boss room bounds. */
const BOSS_REVEAL_EXTRA_TILES = 15;
/** Fog radius revealed around the nearest stairwell once the floor's last gauntlet boss dies. */
const STAIRWELL_REVEAL_RADIUS_TILES = 8;
/** Corpse marker arm length (pixels). */
const CORPSE_MARKER_ARM = 2;
/** Corpse marker TTL in frames. */
const CORPSE_MARKER_TTL = 1800;
/** District names on the expanded minimap: small, warm, and outlined so they read over any tile. */
const DISTRICT_LABEL_FONT_SIZE = 9;

/** A processing station's glyph on the minimap: a saw blade for the mill, a coil for the rope walk. */
const STATION_MARKER_GLYPH: Readonly<
  Record<
    ProcessingStationKind,
    (ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) => void
  >
> = {
  boards: drawSawBladeGlyph,
  rope: drawRopeCoilGlyph,
};
/** Glyph radius for a processing station's minimap marker (pixels). */
const STATION_MARKER_GLYPH_RADIUS = 4;
/** Radius of the dark backing disc behind a station glyph, so it reads over any tile colour. */
const STATION_MARKER_BACKING_RADIUS = 5;

/** `$` marker over anyone who sells something. */
const VENDOR_MARKER_FONT_SIZE = 8;
/** Lifts the `$` a little above the dot a plain NPC or mob marker would sit on. */
const VENDOR_MARKER_Y_OFFSET = -4;

/** Sentinel for "no fog reveal has happened yet" — no real tile coord is negative. */
const TILE_NEVER_REVEALED = -1;

/** One "you died here" X on the map, in world pixels, with its remaining life in frames. */
export interface CorpseMarker {
  x: number;
  y: number;
  ttl: number;
}

/**
 * Corpse markers only.
 *
 * The fog of war is deliberately absent, and so is everything derived from it —
 * `lastRevealTileX/Y` and the tile cache. Explored map stays explored: a death
 * rewinds what the player *did*, not what they know.
 */
export interface MiniMapCheckpoint {
  corpseMarkers: ReadonlyArray<CorpseMarker>;
}

export class MiniMapSystem implements GameSystem {
  private fogOfWar: Uint8Array;
  private _expanded = false;
  private _scrollTX = 0;
  private _scrollTY = 0;
  private corpseMarkers: CorpseMarker[] = [];
  /**
   * The doomsday escape stairwell, set by the scene each frame while the finale
   * is live. Its own marker rather than an entry in `stairwellTiles`, which would
   * make it a floor exit, and drawn through the fog: it is the one tile the
   * player must be able to find from anywhere on the map.
   */
  escapeMarkerTile: { x: number; y: number } | null = null;
  /** Reused result set for the radar's neighbour query. */
  private readonly _radarQuery = new Set<Mob>();
  /** Tile the fog was last revealed around; TILE_NEVER_REVEALED until the first reveal. */
  private lastRevealTileX = TILE_NEVER_REVEALED;
  private lastRevealTileY = TILE_NEVER_REVEALED;

  private readonly REVEAL_RADIUS = 10;

  /** Offscreen canvas caching revealed tile colors (1px per tile). */
  private _tileCache: OffscreenCanvas | HTMLCanvasElement;
  private _tileCacheCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

  constructor(private readonly gameMap: GameMap) {
    const sz = gameMap.structure.length;
    this.fogOfWar = new Uint8Array(sz * sz);

    if (typeof OffscreenCanvas !== 'undefined') {
      const c = new OffscreenCanvas(sz, sz);
      const tctx = c.getContext('2d');
      if (!tctx) throw new Error('Failed to get 2D context for minimap');
      this._tileCache = c;
      this._tileCacheCtx = tctx;
    } else {
      const c = document.createElement('canvas');
      c.width = sz;
      c.height = sz;
      const tctx = c.getContext('2d');
      if (!tctx) throw new Error('Failed to get 2D context for minimap');
      this._tileCache = c;
      this._tileCacheCtx = tctx;
    }
    this._tileCacheCtx.fillStyle = worldPalette.minimap.unexplored;
    this._tileCacheCtx.fillRect(0, 0, sz, sz);
  }

  get isExpanded(): boolean {
    return this._expanded;
  }

  setExpanded(expanded: boolean): void {
    if (expanded !== this._expanded) this.toggle();
  }

  toggle(): void {
    this._expanded = !this._expanded;
    this._scrollTX = 0;
    this._scrollTY = 0;
  }

  /**
   * Pan the expanded minimap by a screen-pixel delta.
   * Only has effect when expanded (1 px = 1 tile at that scale).
   */
  pan(deltaX: number, deltaY: number): void {
    if (!this._expanded) return;
    const mapSize = this.gameMap.structure.length;
    // Dragging right moves the view left (standard map-pan convention)
    this._scrollTX -= deltaX;
    this._scrollTY -= deltaY;
    this._scrollTX = Math.max(-mapSize, Math.min(mapSize, this._scrollTX));
    this._scrollTY = Math.max(-mapSize, Math.min(mapSize, this._scrollTY));
  }

  revealAround(tileX: number, tileY: number): void {
    if (tileX === this.lastRevealTileX && tileY === this.lastRevealTileY) return;
    this.lastRevealTileX = tileX;
    this.lastRevealTileY = tileY;

    const mapSize = this.gameMap.structure.length;
    const r = this.REVEAL_RADIUS;
    const r2 = r * r;
    const cctx = this._tileCacheCtx;
    for (let dy = -r; dy <= r; dy++) {
      for (let dx = -r; dx <= r; dx++) {
        if (dx * dx + dy * dy > r2) continue;
        const tx = tileX + dx;
        const ty = tileY + dy;
        if (tx >= 0 && tx < mapSize && ty >= 0 && ty < mapSize) {
          const idx = ty * mapSize + tx;
          if (this.fogOfWar[idx] === 0) {
            this.fogOfWar[idx] = 1;
            const tile = this.gameMap.structure[ty][tx];
            cctx.fillStyle = this.minimapColorAt(tx, ty, tile.type);
            cctx.fillRect(tx, ty, 1, 1);
          }
        }
      }
    }
  }

  /**
   * Repaints one already-revealed tile whose type or state has changed.
   *
   * The tile cache is otherwise written exactly once per tile, at the moment fog
   * lifts off it, and never again — but the map changes after generation: a
   * felled tree turns to grass and a burnt one turns to charcoal, both of them well inside the reveal radius, so
   * without this the minimap keeps showing forest green over open ground and a
   * stand the player set alight is indistinguishable from a living one.
   *
   * A no-op on a tile still under fog: that tile will be painted correctly the
   * first time it is revealed.
   */
  markTileChanged(tileX: number, tileY: number): void {
    const mapSize = this.gameMap.structure.length;
    if (tileX < 0 || tileX >= mapSize || tileY < 0 || tileY >= mapSize) return;
    if (this.fogOfWar[tileY * mapSize + tileX] === 0) return;
    this._tileCacheCtx.fillStyle = this.minimapColorAt(
      tileX,
      tileY,
      this.gameMap.structure[tileY][tileX].type,
    );
    this._tileCacheCtx.fillRect(tileX, tileY, 1, 1);
  }

  /** Shared clamp/loop/fog-set/fill body behind every neighborhood reveal. */
  private revealNeighborhood(bounds: Rect): void {
    const mapSize = this.gameMap.structure.length;
    const x1 = Math.max(0, bounds.x);
    const y1 = Math.max(0, bounds.y);
    const x2 = Math.min(mapSize - 1, bounds.x + bounds.w);
    const y2 = Math.min(mapSize - 1, bounds.y + bounds.h);
    const cctx = this._tileCacheCtx;
    for (let ty = y1; ty <= y2; ty++) {
      for (let tx = x1; tx <= x2; tx++) {
        const idx = ty * mapSize + tx;
        if (this.fogOfWar[idx] === 0) {
          this.fogOfWar[idx] = 1;
          const tile = this.gameMap.structure[ty][tx];
          cctx.fillStyle = this.minimapColorAt(tx, ty, tile.type);
          cctx.fillRect(tx, ty, 1, 1);
        }
      }
    }
  }

  revealBossNeighborhood(bounds: Rect): void {
    const extra = BOSS_REVEAL_EXTRA_TILES;
    this.revealNeighborhood({
      x: bounds.x - extra,
      y: bounds.y - extra,
      w: bounds.w + extra * 2,
      h: bounds.h + extra * 2,
    });
  }

  /**
   * The post-boss map hint: reveal a `STAIRWELL_REVEAL_RADIUS_TILES`-tile pool
   * of fog around a stairwell, so the minimap's white-square pass (in
   * `render()`) can show it without the player having walked anywhere near it.
   */
  revealStairwellNeighborhood(tile: { x: number; y: number }): void {
    const r = STAIRWELL_REVEAL_RADIUS_TILES;
    this.revealNeighborhood({ x: tile.x - r, y: tile.y - r, w: r * 2, h: r * 2 });
  }

  addCorpseMarker(x: number, y: number): void {
    this.corpseMarkers.push({ x, y, ttl: CORPSE_MARKER_TTL });
  }

  /**
   * Snapshots the corpse markers so the X left by a death the player has since
   * rewound past does not outlive the run it belonged to.
   *
   * The markers are copied on the way out and again on the way back in
   * (`restoreCheckpoint`) — one snapshot serves every death against the same
   * checkpoint, and `tickCorpseMarkers` decrements each marker's `ttl` in place,
   * so a shared object would be counted down by the first restored run and
   * expire out of the snapshot.
   */
  captureCheckpoint(): MiniMapCheckpoint {
    return { corpseMarkers: this.corpseMarkers.map((marker) => ({ ...marker })) };
  }

  restoreCheckpoint(snapshot: MiniMapCheckpoint): void {
    this.corpseMarkers = snapshot.corpseMarkers.map((marker) => ({ ...marker }));
  }

  tickCorpseMarkers(): void {
    for (let i = this.corpseMarkers.length - 1; i >= 0; i--) {
      if (--this.corpseMarkers[i].ttl <= 0) {
        this.corpseMarkers[i] = this.corpseMarkers[this.corpseMarkers.length - 1];
        this.corpseMarkers.pop();
      }
    }
  }

  /**
   * The town's quarters, written across the expanded minimap.
   *
   * Expanded only. At the normal size the map is 160 px across and two pixels a
   * tile, so it shows 80 tiles — barely wider than the 55-tile town — and the
   * captions would cover most of it. Expanded is one pixel a tile over 240, which
   * is where a name is a caption rather than an obstruction.
   *
   * Each label waits for its own tile to come out of the fog, so the map names
   * the parts of town you have actually walked into.
   */
  private renderDistrictLabels(
    ctx: CanvasRenderingContext2D,
    expanded: boolean,
    mmX: number,
    mmY: number,
    pxPerTile: number,
    viewCenterTX: number,
    viewCenterTY: number,
    halfTiles: number,
  ): void {
    if (!expanded) return;
    // Briar Hollow's labels are read beside the town's rather than folded into
    // `townPlan.districts`: that list is the town's own, and the village is a
    // separate place with its own record.
    const labels: Array<{ readonly name: string; readonly tile: { x: number; y: number } }> = [];
    for (const district of this.gameMap.townPlan?.districts ?? []) {
      labels.push({ name: district.name, tile: district.label });
    }
    for (const district of this.gameMap.briarHollow?.districts ?? []) {
      if (district.label !== null) labels.push({ name: district.label, tile: district.labelTile });
    }
    const mapSize = this.gameMap.structure.length;
    for (const label of labels) {
      if (!this.fogOfWar[label.tile.y * mapSize + label.tile.x]) continue;
      worldText(ctx, label.name, {
        x: mmX + (label.tile.x - viewCenterTX + halfTiles) * pxPerTile,
        y: mmY + (label.tile.y - viewCenterTY + halfTiles) * pxPerTile,
        size: DISTRICT_LABEL_FONT_SIZE,
        color: worldPalette.minimap.districtLabel,
        outline: MINIMAP_MARKER_COLORS.outline,
        align: 'center',
      });
    }
  }

  /** Paints the map's data into `rect`, centred on the active crawler (or the pan). */
  render(
    ctx: CanvasRenderingContext2D,
    rect: Rect,
    active: { x: number; y: number },
    companion: { x: number; y: number },
    mobGrid: SpatialGrid<Mob>,
    mordecaiPositions: Array<{ x: number; y: number }>,
    questMarkers: Array<{ x: number; y: number; type: QuestMarkerType }> = [],
    pet: { x: number; y: number } | null = null,
    resourceStations: Array<{ x: number; y: number; kind: ProcessingStationKind }> = [],
    vendors: Array<{ x: number; y: number }> = [],
  ): void {
    const mapSize = this.gameMap.structure.length;
    const expanded = this._expanded;
    const mmSize = Math.min(rect.w, rect.h);
    const pxPerTile = expanded ? EXPANDED_PX_PER_TILE : NORMAL_PX_PER_TILE;
    const tilesInView = Math.floor(mmSize / pxPerTile);
    const halfTiles = Math.floor(tilesInView / 2);

    const mmX = rect.x;
    const mmY = rect.y;

    const playerTX = Math.floor((active.x + HALF_TILE) / TILE_SIZE);
    const playerTY = Math.floor((active.y + HALF_TILE) / TILE_SIZE);

    // When expanded, honour scroll offset so the user can pan to explored areas.
    const viewCenterTX = expanded ? playerTX + this._scrollTX : playerTX;
    const viewCenterTY = expanded ? playerTY + this._scrollTY : playerTY;

    ctx.save();
    ctx.beginPath();
    ctx.rect(mmX, mmY, mmSize, mmSize);
    ctx.clip();

    // Tiles — blit from offscreen cache (1px per tile → scaled by pxPerTile)
    const srcX = Math.max(0, Math.floor(viewCenterTX - halfTiles));
    const srcY = Math.max(0, Math.floor(viewCenterTY - halfTiles));
    const srcW = Math.min(mapSize - srcX, tilesInView);
    const srcH = Math.min(mapSize - srcY, tilesInView);
    const destOffX = (srcX - (viewCenterTX - halfTiles)) * pxPerTile;
    const destOffY = (srcY - (viewCenterTY - halfTiles)) * pxPerTile;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(
      this._tileCache,
      srcX,
      srcY,
      srcW,
      srcH,
      mmX + destOffX,
      mmY + destOffY,
      srcW * pxPerTile,
      srcH * pxPerTile,
    );
    ctx.imageSmoothingEnabled = true;

    // Stairwells — white squares (always visible if revealed)
    for (const st of this.gameMap.stairwellTiles) {
      if (!this.fogOfWar[st.y * mapSize + st.x]) continue;
      const sx = mmX + (st.x - viewCenterTX + halfTiles) * pxPerTile - STAIRWELL_ICON_HALF_EXTRA;
      const sy = mmY + (st.y - viewCenterTY + halfTiles) * pxPerTile - STAIRWELL_ICON_HALF_EXTRA;
      ctx.fillStyle = worldPalette.minimap.stairwell;
      ctx.fillRect(
        sx,
        sy,
        pxPerTile + STAIRWELL_ICON_HALF_EXTRA * 2,
        pxPerTile + STAIRWELL_ICON_HALF_EXTRA * 2,
      );
    }

    const escapeTile = this.escapeMarkerTile;
    if (escapeTile !== null) {
      const ex = mmX + (escapeTile.x - viewCenterTX + halfTiles) * pxPerTile;
      const ey = mmY + (escapeTile.y - viewCenterTY + halfTiles) * pxPerTile;
      const escapePulse =
        ESCAPE_MARKER_PULSE_BASE +
        ESCAPE_MARKER_PULSE_RANGE * Math.sin(frameTime * QUEST_MARKER_PULSE_SPEED);
      ctx.save();
      ctx.globalAlpha = escapePulse;
      ctx.fillStyle = worldPalette.minimap.escape;
      ctx.fillRect(
        ex - ESCAPE_MARKER_HALF_EXTRA,
        ey - ESCAPE_MARKER_HALF_EXTRA,
        pxPerTile * ESCAPE_MARKER_TILES + ESCAPE_MARKER_HALF_EXTRA * 2,
        pxPerTile * ESCAPE_MARKER_TILES + ESCAPE_MARKER_HALF_EXTRA * 2,
      );
      ctx.restore();
    }

    ctx.strokeStyle = worldPalette.minimap.corpse;
    ctx.lineWidth = 1;
    for (const corpse of this.corpseMarkers) {
      const ctx2TX = Math.floor(corpse.x / TILE_SIZE);
      const ctx2TY = Math.floor(corpse.y / TILE_SIZE);
      if (!this.fogOfWar[ctx2TY * mapSize + ctx2TX]) continue;
      const cx = mmX + (ctx2TX - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      const cy = mmY + (ctx2TY - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      ctx.beginPath();
      ctx.moveTo(cx - CORPSE_MARKER_ARM, cy - CORPSE_MARKER_ARM);
      ctx.lineTo(cx + CORPSE_MARKER_ARM, cy + CORPSE_MARKER_ARM);
      ctx.moveTo(cx + CORPSE_MARKER_ARM, cy - CORPSE_MARKER_ARM);
      ctx.lineTo(cx - CORPSE_MARKER_ARM, cy + CORPSE_MARKER_ARM);
      ctx.stroke();
    }

    // Mobs — red dots (only within radar range)
    const MOB_RADAR_PX = TILE_SIZE * MOB_RADAR_TILES;
    ctx.fillStyle = worldPalette.minimap.hostile;
    this._radarQuery.clear();
    const mobsOnRadar = mobGrid.queryCircle(active.x, active.y, MOB_RADAR_PX, this._radarQuery);
    for (const mob of mobsOnRadar) {
      if (!mob.isAlive) continue;
      const mobTX = Math.floor((mob.x + HALF_TILE) / TILE_SIZE);
      const mobTY = Math.floor((mob.y + HALF_TILE) / TILE_SIZE);
      if (!this.fogOfWar[mobTY * mapSize + mobTX]) continue;
      const mmDotX =
        mmX + (mobTX - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      const mmDotY =
        mmY + (mobTY - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      ctx.beginPath();
      ctx.arc(mmDotX, mmDotY, MOB_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    const compTX = Math.floor((companion.x + HALF_TILE) / TILE_SIZE);
    const compTY = Math.floor((companion.y + HALF_TILE) / TILE_SIZE);
    const compSX =
      mmX + (compTX - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
    const compSY =
      mmY + (compTY - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
    ctx.fillStyle = MINIMAP_MARKER_COLORS.companion;
    ctx.beginPath();
    ctx.arc(compSX, compSY, COMPANION_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    // Mongo — his own colour, and no fog test, exactly like the companion above:
    // he is party, and a party member you cannot find is the bug this answers.
    if (pet !== null) {
      const petTX = Math.floor((pet.x + HALF_TILE) / TILE_SIZE);
      const petTY = Math.floor((pet.y + HALF_TILE) / TILE_SIZE);
      const petSX =
        mmX + (petTX - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      const petSY =
        mmY + (petTY - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      // Pink for his feathers, apart from every other dot: red is a hostile,
      // blue the companion, white Mordecai and the stairs.
      ctx.fillStyle = MINIMAP_MARKER_COLORS.pet;
      ctx.beginPath();
      ctx.arc(petSX, petSY, PET_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mordecai — white dot per safe room if revealed
    ctx.fillStyle = worldPalette.minimap.mordecai;
    for (const pos of mordecaiPositions) {
      if (!this.fogOfWar[pos.y * mapSize + pos.x]) continue;
      const msx = mmX + (pos.x - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      const msy = mmY + (pos.y - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      ctx.beginPath();
      ctx.arc(msx, msy, MORDECAI_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    this.renderDistrictLabels(
      ctx,
      expanded,
      mmX,
      mmY,
      pxPerTile,
      viewCenterTX,
      viewCenterTY,
      halfTiles,
    );

    for (const qm of questMarkers) {
      if (!this.fogOfWar[qm.y * mapSize + qm.x]) continue;
      const qsx = mmX + (qm.x - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      const qsy = mmY + (qm.y - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      const pulse =
        QUEST_MARKER_PULSE_BASE +
        QUEST_MARKER_PULSE_RANGE * Math.sin(frameTime * QUEST_MARKER_PULSE_SPEED);
      if (qm.type === 'exclamation') {
        worldText(ctx, '!', {
          x: qsx,
          y: qsy - QUEST_MARKER_X_ARM,
          size: QUEST_MARKER_FONT_SIZE,
          bold: true,
          color: worldPalette.minimap.questOffer,
          alpha: pulse,
          align: 'center',
        });
      } else if (qm.type === 'question') {
        worldText(ctx, '?', {
          x: qsx,
          y: qsy - QUEST_MARKER_X_ARM,
          size: QUEST_MARKER_FONT_SIZE,
          bold: true,
          color: worldPalette.minimap.questTurnIn,
          alpha: pulse,
          align: 'center',
        });
      } else if (qm.type === 'elite') {
        // The book's elite marker: a black cross inside a white circle.
        ctx.save();
        ctx.fillStyle = worldPalette.minimap.eliteDisc;
        ctx.beginPath();
        ctx.arc(qsx, qsy, ELITE_MARKER_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = worldPalette.minimap.eliteCross;
        ctx.lineWidth = QUEST_MARKER_LINE_WIDTH;
        ctx.beginPath();
        ctx.moveTo(qsx - ELITE_MARKER_CROSS_ARM, qsy);
        ctx.lineTo(qsx + ELITE_MARKER_CROSS_ARM, qsy);
        ctx.moveTo(qsx, qsy - ELITE_MARKER_CROSS_ARM);
        ctx.lineTo(qsx, qsy + ELITE_MARKER_CROSS_ARM);
        ctx.stroke();
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalAlpha = pulse;
        ctx.strokeStyle = worldPalette.minimap.questTarget;
        ctx.lineWidth = QUEST_MARKER_LINE_WIDTH;
        ctx.beginPath();
        ctx.moveTo(qsx - QUEST_MARKER_X_ARM, qsy - QUEST_MARKER_X_ARM);
        ctx.lineTo(qsx + QUEST_MARKER_X_ARM, qsy + QUEST_MARKER_X_ARM);
        ctx.moveTo(qsx + QUEST_MARKER_X_ARM, qsy - QUEST_MARKER_X_ARM);
        ctx.lineTo(qsx - QUEST_MARKER_X_ARM, qsy + QUEST_MARKER_X_ARM);
        ctx.stroke();
        ctx.restore();
      }
    }

    // Processing stations — a saw blade for the mill, a rope coil for the frame, over a dark backing disc.
    for (const station of resourceStations) {
      if (!this.fogOfWar[station.y * mapSize + station.x]) continue;
      const ssx =
        mmX + (station.x - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      const ssy =
        mmY + (station.y - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      ctx.beginPath();
      ctx.arc(ssx, ssy, STATION_MARKER_BACKING_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = worldPalette.minimap.stationBacking;
      ctx.fill();
      STATION_MARKER_GLYPH[station.kind](ctx, ssx, ssy, STATION_MARKER_GLYPH_RADIUS);
    }

    // Vendors — a `$` over anyone who sells something, derived from the shops themselves.
    for (const vendor of vendors) {
      const vendorTX = Math.floor((vendor.x + HALF_TILE) / TILE_SIZE);
      const vendorTY = Math.floor((vendor.y + HALF_TILE) / TILE_SIZE);
      if (!this.fogOfWar[vendorTY * mapSize + vendorTX]) continue;
      const vsx =
        mmX + (vendorTX - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      const vsy =
        mmY +
        (vendorTY - viewCenterTY + halfTiles) * pxPerTile +
        Math.floor(pxPerTile / 2) +
        VENDOR_MARKER_Y_OFFSET;
      worldText(ctx, '$', {
        x: vsx,
        y: vsy,
        size: VENDOR_MARKER_FONT_SIZE,
        bold: true,
        color: worldPalette.minimap.vendor,
        outline: worldPalette.minimap.vendorOutline,
        align: 'center',
      });
    }

    // Active player — green dot (at centre when unscrolled; offset when panned)
    const playerSX =
      mmX + (playerTX - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
    const playerSY =
      mmY + (playerTY - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
    ctx.fillStyle = MINIMAP_MARKER_COLORS.player;
    ctx.beginPath();
    ctx.arc(playerSX, playerSY, PLAYER_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();
  }

  /**
   * Colour for one minimap pixel. Sprite buildings only mark their anchor tile
   * with SPRITE_BUILDING, so the whole footprint is resolved via the map rather
   * than the tile type — otherwise the town's biggest landmarks would each show
   * up as a single dot.
   */
  private minimapColorAt(tx: number, ty: number, type: number): string {
    if (this.gameMap.isSpriteBuildingTile(tx, ty)) return worldPalette.minimap.spriteBuilding;
    // A burnt-out tree is still a `TREE` tile, so its colour cannot come from
    // the type alone. Worth the special case: the map is how a player finds
    // their way back to a stand they set alight, and charcoal drawn in forest
    // green makes that impossible.
    if (type === TREE && this.gameMap.structure[ty][tx].treeStage === TREE_STAGE_CHARRED) {
      return worldPalette.minimap.charredTree;
    }
    if (DUNGEON_WALKABLE_DECAL_TILE_TYPES.has(type)) {
      const floorUnder = this.gameMap.structure[ty][tx].groundType ?? FloorTypeValue.tile_floor;
      return minimapTileColor(floorUnder);
    }
    return minimapTileColor(type);
  }

  dispose(): void {
    /* no-op — satisfies GameSystem interface */
  }
}
