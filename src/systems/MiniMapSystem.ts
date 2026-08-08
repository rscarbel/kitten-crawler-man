import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/SpatialGrid';
import { platform } from '../core/Platform';
import type { GameSystem } from './GameSystem';
import { frameTime } from '../utils';
import { drawText } from '../ui/TextBox';
import {
  COBBLE_STREET,
  TREE,
  TREE_STAGE_CHARRED,
  FloorTypeValue,
  HORDER_BOSS_ROOM_FLOOR,
  LANE_STREET,
  PLAZA_STONE,
  FENCE,
  INTERIOR_BOARD_FLOOR,
  INTERIOR_RUSH_FLOOR,
  INTERIOR_EARTH_FLOOR,
  INTERIOR_FLAG_FLOOR,
  INTERIOR_INK_FLOOR,
  DRILL_SAND_FLOOR,
  INTERIOR_COUNTER,
  INTERIOR_STONE_FLOOR,
  INTERIOR_WALL,
  GARDEN_PLANTING,
  SAFE_ROOM_FLOOR,
  SAFE_ROOM_THRESHOLD,
  SAFE_ROOM_BANNER,
  SAFE_ROOM_HERB_RACK,
  SAFE_ROOM_LANTERN,
  SAFE_ROOM_LARDER,
  SAFE_ROOM_MENU_BOARD,
  SAFE_ROOM_RUG,
  SAFE_ROOM_STOOL,
  SAFE_ROOM_STOVE,
  SAFE_ROOM_TABLE,
  TOWN_WALL,
  VERGE_GRASS,
  VOID_TYPE,
  YARD_GRAVEL,
  HIGHLAND_GRASS,
  SCREE,
  WILDFLOWER_TUFT,
  PEBBLE_SCATTER,
  BRIDGE,
  RIVER_ROCK,
  BOULDER_SMALL,
  BOULDER_LARGE,
  CLIFF,
  CAMPFIRE,
  GOBLIN_TENT,
  DEN_HOLLOW,
} from '../map/tileTypes';
import { viewportWidth } from '../core/Viewport';

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
/**
 * Mongo's dot. Pink, for his feathers, and distinct from every other marker on
 * the map: red is a hostile, blue the companion, white Mordecai and stairs.
 */
const MINIMAP_PET_COLOR = '#f0abfc';
/** Quest marker pulse speed (radians per frame-time unit). */
const QUEST_MARKER_PULSE_SPEED = 5;
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
/** Pixels above minimap to render the expand hint text. */
const MINIMAP_HINT_OFFSET_Y = 3;
/** Margin from the canvas edge for minimap placement (pixels). */
const MINIMAP_MARGIN = 8;
/** Minimap hint font size. */
const MINIMAP_HINT_FONT_SIZE = 10;
/** Extra tiles revealed around boss room bounds. */
const BOSS_REVEAL_EXTRA_TILES = 15;
/** Corpse marker arm length (pixels). */
const CORPSE_MARKER_ARM = 2;
/** Corpse marker TTL in frames. */
const CORPSE_MARKER_TTL = 1800;
/** District names on the expanded minimap: small, warm, and outlined so they read over any tile. */
const DISTRICT_LABEL_FONT_SIZE = 9;
const DISTRICT_LABEL_COLOR = '#e8d9a0';
const DISTRICT_LABEL_OUTLINE_COLOR = '#000000';

/** Sprite-building footprints read as solid masonry on the minimap, like wall tiles. */
const SPRITE_BUILDING_MINIMAP_COLOR = '#3a3028';
/** Standing forest, a shade deeper than the grass it grows out of. */
const LIVING_TREE_MINIMAP_COLOR = '#2c5434';
/** A tree burnt down to charcoal, so a stand the player torched stays findable. */
const CHARRED_TREE_MINIMAP_COLOR = '#2a221e';

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
  /** Reused result set for the radar's neighbour query. */
  private readonly _radarQuery = new Set<Mob>();
  /** Tile the fog was last revealed around; TILE_NEVER_REVEALED until the first reveal. */
  private lastRevealTileX = TILE_NEVER_REVEALED;
  private lastRevealTileY = TILE_NEVER_REVEALED;

  private readonly REVEAL_RADIUS = 10;
  readonly NORMAL_SIZE = 160;
  readonly EXPANDED_SIZE = 240;

  /** Offscreen canvas caching revealed tile colors (1px per tile). */
  private _tileCache: OffscreenCanvas | HTMLCanvasElement;
  private _tileCacheCtx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D;

  constructor(private readonly gameMap: GameMap) {
    const sz = gameMap.structure.length;
    this.fogOfWar = new Uint8Array(sz * sz);

    // Create offscreen tile cache (1px per tile, pre-filled with fog color)
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
    this._tileCacheCtx.fillStyle = '#111';
    this._tileCacheCtx.fillRect(0, 0, sz, sz);
  }

  get isExpanded(): boolean {
    return this._expanded;
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
   * lifts off it, and never again — which was fine while the map was immutable
   * after generation. It no longer is: a felled tree turns to grass and a burnt
   * one turns to charcoal, both of them well inside the reveal radius, so
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

  revealBossNeighborhood(bounds: { x: number; y: number; w: number; h: number }): void {
    const mapSize = this.gameMap.structure.length;
    const extra = BOSS_REVEAL_EXTRA_TILES;
    const x1 = Math.max(0, bounds.x - extra);
    const y1 = Math.max(0, bounds.y - extra);
    const x2 = Math.min(mapSize - 1, bounds.x + bounds.w + extra);
    const y2 = Math.min(mapSize - 1, bounds.y + bounds.h + extra);
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
    const districts = this.gameMap.townPlan?.districts;
    if (districts === undefined) return;
    const mapSize = this.gameMap.structure.length;
    for (const district of districts) {
      if (!this.fogOfWar[district.label.y * mapSize + district.label.x]) continue;
      drawText(ctx, district.name, {
        x: mmX + (district.label.x - viewCenterTX + halfTiles) * pxPerTile,
        y: mmY + (district.label.y - viewCenterTY + halfTiles) * pxPerTile,
        size: DISTRICT_LABEL_FONT_SIZE,
        color: DISTRICT_LABEL_COLOR,
        outline: DISTRICT_LABEL_OUTLINE_COLOR,
        align: 'center',
      });
    }
  }

  render(
    ctx: CanvasRenderingContext2D,
    active: { x: number; y: number },
    companion: { x: number; y: number },
    mobGrid: SpatialGrid<Mob>,
    mordecaiPositions: Array<{ x: number; y: number }>,
    questMarkers: Array<{ x: number; y: number; type: QuestMarkerType }> = [],
    pet: { x: number; y: number } | null = null,
  ): void {
    const mapSize = this.gameMap.structure.length;
    const expanded = this._expanded;
    const mmSize = expanded ? this.EXPANDED_SIZE : this.NORMAL_SIZE;
    const pxPerTile = expanded ? EXPANDED_PX_PER_TILE : NORMAL_PX_PER_TILE;
    const tilesInView = Math.floor(mmSize / pxPerTile);
    const halfTiles = Math.floor(tilesInView / 2);

    const mmX = viewportWidth() - mmSize - MINIMAP_MARGIN;
    const mmY = MINIMAP_MARGIN;

    const playerTX = Math.floor((active.x + HALF_TILE) / TILE_SIZE);
    const playerTY = Math.floor((active.y + HALF_TILE) / TILE_SIZE);

    // When expanded, honour scroll offset so the user can pan to explored areas.
    const viewCenterTX = expanded ? playerTX + this._scrollTX : playerTX;
    const viewCenterTY = expanded ? playerTY + this._scrollTY : playerTY;

    // Background
    ctx.fillStyle = 'rgba(0,0,0,0.82)';
    ctx.fillRect(mmX, mmY, mmSize, mmSize);

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
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(sx, sy, pxPerTile + 2, pxPerTile + 2);
    }

    // Corpse markers — X
    ctx.strokeStyle = '#000000';
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
    ctx.fillStyle = '#ef4444';
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

    // Companion — blue dot
    const compTX = Math.floor((companion.x + HALF_TILE) / TILE_SIZE);
    const compTY = Math.floor((companion.y + HALF_TILE) / TILE_SIZE);
    const compSX =
      mmX + (compTX - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
    const compSY =
      mmY + (compTY - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
    ctx.fillStyle = '#60a5fa';
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
      ctx.fillStyle = MINIMAP_PET_COLOR;
      ctx.beginPath();
      ctx.arc(petSX, petSY, PET_DOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    // Mordecai — white dot per safe room if revealed
    ctx.fillStyle = '#ffffff';
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

    // Quest markers — yellow !, green ?, or red X
    // size=8 bold; old baseline was qsy+3; top = (qsy+3) - round(8*0.8) = (qsy+3) - 6 = qsy-3
    for (const qm of questMarkers) {
      if (!this.fogOfWar[qm.y * mapSize + qm.x]) continue;
      const qsx = mmX + (qm.x - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      const qsy = mmY + (qm.y - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
      const questPulseBase = 0.7;
      const questPulseRange = 0.3;
      const pulse =
        questPulseBase + questPulseRange * Math.sin(frameTime * QUEST_MARKER_PULSE_SPEED);
      if (qm.type === 'exclamation') {
        drawText(ctx, '!', {
          x: qsx,
          y: qsy - QUEST_MARKER_X_ARM,
          size: 8,
          bold: true,
          color: '#fbbf24',
          alpha: pulse,
          align: 'center',
        });
      } else if (qm.type === 'question') {
        drawText(ctx, '?', {
          x: qsx,
          y: qsy - QUEST_MARKER_X_ARM,
          size: 8,
          bold: true,
          color: '#4ade80',
          alpha: pulse,
          align: 'center',
        });
      } else if (qm.type === 'elite') {
        // The book's elite marker: a black cross inside a white circle.
        ctx.save();
        ctx.fillStyle = '#ffffff';
        ctx.beginPath();
        ctx.arc(qsx, qsy, ELITE_MARKER_RADIUS, 0, Math.PI * 2);
        ctx.fill();
        ctx.strokeStyle = '#000000';
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
        ctx.strokeStyle = '#ef4444';
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

    // Active player — green dot (at centre when unscrolled; offset when panned)
    const playerSX =
      mmX + (playerTX - viewCenterTX + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
    const playerSY =
      mmY + (playerTY - viewCenterTY + halfTiles) * pxPerTile + Math.floor(pxPerTile / 2);
    ctx.fillStyle = '#4ade80';
    ctx.beginPath();
    ctx.arc(playerSX, playerSY, PLAYER_DOT_RADIUS, 0, Math.PI * 2);
    ctx.fill();

    ctx.restore();

    // Border
    ctx.strokeStyle = '#475569';
    ctx.lineWidth = 1;
    ctx.strokeRect(mmX, mmY, mmSize, mmSize);

    const expandHint = platform.miniMapHint(expanded);
    drawText(ctx, expandHint, {
      x: mmX + mmSize / 2,
      y: mmY + mmSize + MINIMAP_HINT_OFFSET_Y,
      size: MINIMAP_HINT_FONT_SIZE,
      color: '#ffffff',
      outline: true,
      align: 'center',
    });
  }

  /**
   * Colour for one minimap pixel. Sprite buildings only mark their anchor tile
   * with SPRITE_BUILDING, so the whole footprint is resolved via the map rather
   * than the tile type — otherwise the town's biggest landmarks would each show
   * up as a single dot.
   */
  private minimapColorAt(tx: number, ty: number, type: number): string {
    if (this.gameMap.isSpriteBuildingTile(tx, ty)) return SPRITE_BUILDING_MINIMAP_COLOR;
    // A burnt-out tree is still a `TREE` tile, so its colour cannot come from
    // the type alone. Worth the special case: the map is how a player finds
    // their way back to a stand they set alight, and charcoal drawn in forest
    // green makes that impossible.
    if (type === TREE && this.gameMap.structure[ty][tx].treeStage === TREE_STAGE_CHARRED) {
      return CHARRED_TREE_MINIMAP_COLOR;
    }
    return this.tileColor(type);
  }

  private tileColor(type: number): string {
    switch (type) {
      case VOID_TYPE:
        return '#000000'; // void border
      case FloorTypeValue.wall:
        return '#3a3028'; // wall
      case FloorTypeValue.grass:
        return '#3a7040'; // grass
      case FloorTypeValue.road:
        return '#6a5040'; // road
      case FloorTypeValue.water:
        return '#1a6880'; // water
      case FloorTypeValue.concrete:
        return '#606060'; // concrete (hallway)
      case FloorTypeValue.tile_floor:
        return '#707070'; // tile floor
      case FloorTypeValue.carpet:
        return '#503030'; // carpet
      case FloorTypeValue.wood:
        return '#704030'; // wood
      case SAFE_ROOM_FLOOR:
      // A minimap is a floor plan, so the runner the player walks straight over
      // is the floor.
      case SAFE_ROOM_RUG:
        return '#8a7040'; // safe room floor
      case SAFE_ROOM_THRESHOLD:
        return '#7a6a4c'; // the worn band inside a safe room's doorways
      // The eight solid furnishings share one furniture tone rather than each
      // becoming a stray grey pixel from the default case.
      case SAFE_ROOM_MENU_BOARD:
      case SAFE_ROOM_HERB_RACK:
      case SAFE_ROOM_BANNER:
      case SAFE_ROOM_LANTERN:
      case SAFE_ROOM_STOVE:
      case SAFE_ROOM_TABLE:
      case SAFE_ROOM_STOOL:
      case SAFE_ROOM_LARDER:
        return '#5c4a2c'; // safe-room furniture
      case HORDER_BOSS_ROOM_FLOOR:
        return '#2a1808'; // boss room floor
      case TOWN_WALL:
        return '#8a8175'; // the town's wall ring
      case VERGE_GRASS:
        return '#4c6338'; // street verge — greener than a street, duller than field grass
      case YARD_GRAVEL:
        return '#6e685e';
      case LANE_STREET:
        return '#7a6448';
      case COBBLE_STREET:
        return '#8e7a5c'; // the two main streets, lighter so the spine reads at a glance
      case PLAZA_STONE:
        return '#a89c86';
      case GARDEN_PLANTING:
        return '#5f7a34'; // planted bed — a shade greener than the verge it sits on
      case FENCE:
        return '#6a5334'; // yard fence, in its own timber colour
      case TREE:
        return LIVING_TREE_MINIMAP_COLOR;
      // Town building interiors. This minimap does not draw one today — that is
      // the mobile HUD's — but the two tables answer the same question, and a
      // tile type known to one and not the other is how the mobile interior
      // minimap turned into a flat grey square when these types were added.
      case INTERIOR_WALL:
        return '#3a3028';
      case INTERIOR_BOARD_FLOOR:
        return '#6a4a30';
      case INTERIOR_STONE_FLOOR:
        return '#585860';
      case INTERIOR_RUSH_FLOOR:
        return '#7a5f3c';
      case INTERIOR_EARTH_FLOOR:
        return '#4a3e30';
      case INTERIOR_FLAG_FLOOR:
        return '#5e5850';
      case INTERIOR_INK_FLOOR:
        return '#6a5138';
      case DRILL_SAND_FLOOR:
        return '#8a7448';
      case INTERIOR_COUNTER:
        return '#4a3020';
      // The floor-3 wilderness. Every one of these needs an entry in this table,
      // in the mobile HUD's, and in `TownMapScene`'s — a type known to one and
      // not the others draws as the default grey, which is how a whole river or
      // a whole camp can vanish from one map and not the next.
      case HIGHLAND_GRASS:
        return '#6f7048'; // upland turf — drier and paler than field grass
      case SCREE:
        return '#6a6660';
      case WILDFLOWER_TUFT:
        return '#4a7a48';
      case PEBBLE_SCATTER:
        return '#787268';
      case BRIDGE:
        return '#8a6a44'; // timber, and lighter than the water it spans
      case RIVER_ROCK:
        return '#4a5a60';
      case BOULDER_SMALL:
      case BOULDER_LARGE:
        return '#6e6a64';
      case CLIFF:
        return '#57534c';
      case CAMPFIRE:
        return '#d07a2c';
      case GOBLIN_TENT:
        return '#7a5f3a';
      case DEN_HOLLOW:
        return '#2e2a26';
      default:
        return '#555555';
    }
  }

  dispose(): void {
    /* no-op — satisfies GameSystem interface */
  }
}
