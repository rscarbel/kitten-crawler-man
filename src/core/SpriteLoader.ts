import bossesManifest from '../images/bosses/manifest.json';
import charactersManifest from '../images/characters/manifest.json';
import effectsManifest from '../images/effects/manifest.json';
import enemiesManifest from '../images/enemies/manifest.json';
import environmentManifest from '../images/environment/manifest.json';
import npcsManifest from '../images/npcs/manifest.json';
import grotesqueSpiderManifest from '../images/bosses/grotesque_spider/manifest.json';
import { TILE_SIZE } from './constants';

const manifestJson = {
  ...bossesManifest,
  ...grotesqueSpiderManifest,
  ...charactersManifest,
  ...effectsManifest,
  ...enemiesManifest,
  ...environmentManifest,
  ...npcsManifest,
} as const;

export interface SpriteStateDef {
  readonly row: number;
  /** Column start offset within the row (0-based). Defaults to 0. */
  readonly colOffset?: number;
  readonly frameCount: number;
  /**
   * Total columns per row in the sheet. When set, frames past the last column
   * wrap onto the following row(s) instead of reading past the row's edge —
   * lets an animation's frames span multiple rows of the sprite sheet.
   */
  readonly colsPerRow?: number;
}

export interface TileOffset {
  readonly dx: number;
  readonly dy: number;
}

export interface SpriteManifestEntry {
  readonly path: string;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  /** Tile type ID this sprite represents (enables collision lookup via getBlockedTileOffsets). */
  readonly tileTypeId?: number;
  /**
   * Pixel-space rectangles (in sprite image coordinates) that should be non-walkable.
   * Converted to tile offsets at load time using ≥50% overlap threshold.
   */
  readonly blockedRegions?: ReadonlyArray<{
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
  }>;
  readonly states: Readonly<Record<string, SpriteStateDef>>;
}

// Type-checked view of the manifest — verifies JSON shape without changing
// the inferred literal type used by SpriteKey / SpriteStates below.
const _manifest: Readonly<Record<string, SpriteManifestEntry>> = manifestJson;

/** Union of all known sprite keys, inferred from the manifest JSON. */
export type SpriteKey = keyof typeof manifestJson;

/** Maps each SpriteKey to the union of its valid state name strings. */
export type SpriteStates = {
  [K in SpriteKey]: keyof (typeof manifestJson)[K]['states'] & string;
};

/** Runtime sprite data: loaded image + dimensions from the manifest. */
export interface SpriteDef {
  readonly img: HTMLImageElement;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly states: ReadonlyMap<string, SpriteStateDef>;
}

const _defs = new Map<string, SpriteDef>();
let _loadPromise: Promise<void> | null = null;

/**
 * Load all sprite sheets listed in the manifest.
 * Safe to call multiple times — subsequent calls return the same promise.
 * Missing files are silently skipped so procedural fallbacks can fill in.
 *
 * @param base  URL prefix prepended to each manifest path (default: 'src/images/')
 */
export async function loadSprites(base = 'src/images/'): Promise<void> {
  if (_loadPromise) return _loadPromise;

  _loadPromise = Promise.all(
    Object.entries(_manifest).map(([key, entry]) => {
      return new Promise<void>((resolve) => {
        const img = new Image();
        img.onload = () => {
          const statesMap = new Map<string, SpriteStateDef>();
          for (const [name, sd] of Object.entries(entry.states)) {
            statesMap.set(name, sd);
          }
          _defs.set(key, {
            img,
            frameWidth: entry.frameWidth,
            frameHeight: entry.frameHeight,
            tileX: entry.tileX,
            tileY: entry.tileY,
            tileScale: entry.tileScale,
            states: statesMap,
          });
          resolve();
        };
        img.onerror = () => resolve(); // Missing file — skip silently
        img.src = base + entry.path;
      });
    }),
  ).then(() => undefined);

  return _loadPromise;
}

/** Returns the loaded SpriteDef for the given key, or undefined if not yet loaded. */
export function getSpriteDef(key: SpriteKey): SpriteDef | undefined {
  return _defs.get(key);
}

// Both maps below are built synchronously from manifest JSON — no image loading required.

const _tileBlockedOffsets = new Map<number, ReadonlyArray<TileOffset>>();
const _tileSortYAnchorPx = new Map<number, number>();
const _tileSpriteOverheadPx = new Map<number, number>();
/** Per-sprite-key tiles the authored `blockedRegions` cover, before the footprint is filled in. */
const _spriteKeyRegionBlockedOffsets = new Map<string, ReadonlyArray<TileOffset>>();
/** Per-sprite-key blocked tile offsets, for sprite buildings without a fixed tileTypeId. */
const _spriteKeyBlockedOffsets = new Map<string, ReadonlyArray<TileOffset>>();

function computeBlockedOffsetsFromRegions(
  regions: ReadonlyArray<{
    readonly x1: number;
    readonly y1: number;
    readonly x2: number;
    readonly y2: number;
  }>,
  tileX: number,
  tileY: number,
  tileScale: number,
): TileOffset[] {
  const seen = new Set<string>();
  const result: TileOffset[] = [];
  const halfTileArea = (tileScale * tileScale) / 2;
  for (const region of regions) {
    const dxMin = Math.floor((region.x1 - tileX) / tileScale) - 1;
    const dxMax = Math.ceil((region.x2 - tileX) / tileScale) + 1;
    const dyMin = Math.floor((region.y1 - tileY) / tileScale) - 1;
    const dyMax = Math.ceil((region.y2 - tileY) / tileScale) + 1;
    for (let dy = dyMin; dy <= dyMax; dy++) {
      for (let dx = dxMin; dx <= dxMax; dx++) {
        const key = `${dx},${dy}`;
        if (seen.has(key)) continue;
        const tileLeft = tileX + dx * tileScale;
        const tileTop = tileY + dy * tileScale;
        const overlapX = Math.max(
          0,
          Math.min(tileLeft + tileScale, region.x2) - Math.max(tileLeft, region.x1),
        );
        const overlapY = Math.max(
          0,
          Math.min(tileTop + tileScale, region.y2) - Math.max(tileTop, region.y1),
        );
        if (overlapX * overlapY >= halfTileArea) {
          seen.add(key);
          result.push({ dx, dy });
        }
      }
    }
  }
  return result;
}

// Build per-key region-derived offsets for SPRITE_BUILDING variants (no tileTypeId
// required). The exported blocked set is widened to the whole footprint further down.
for (const [key, entry] of Object.entries(_manifest)) {
  if (entry.blockedRegions !== undefined && entry.blockedRegions.length > 0) {
    _spriteKeyRegionBlockedOffsets.set(
      key,
      computeBlockedOffsetsFromRegions(
        entry.blockedRegions,
        entry.tileX,
        entry.tileY,
        entry.tileScale,
      ),
    );
  }
}

for (const entry of Object.values(_manifest)) {
  if (entry.tileTypeId === undefined) continue;
  const allBlockedOffsets: TileOffset[] = [];

  if (entry.blockedRegions !== undefined) {
    allBlockedOffsets.push(
      ...computeBlockedOffsetsFromRegions(
        entry.blockedRegions,
        entry.tileX,
        entry.tileY,
        entry.tileScale,
      ),
    );
  }
  if (allBlockedOffsets.length > 0) {
    _tileBlockedOffsets.set(entry.tileTypeId, allBlockedOffsets);
  }
  const scale = TILE_SIZE / entry.tileScale;
  // Sort Y anchor: how far below the tile's top edge the sprite's visual foot sits.
  const anchorPx = (entry.frameHeight - entry.tileY) * scale;
  _tileSortYAnchorPx.set(entry.tileTypeId, anchorPx);
  // Overhead: how many game-pixels above the tile's top-left corner the sprite extends.
  _tileSpriteOverheadPx.set(entry.tileTypeId, entry.tileY * scale);
}

/**
 * Returns the extra blocked tile offsets (relative to a tile's own position)
 * declared in the manifest for the given tile type ID. Empty array if none.
 */
export function getBlockedTileOffsets(tileTypeId: number): ReadonlyArray<TileOffset> {
  return _tileBlockedOffsets.get(tileTypeId) ?? [];
}

/**
 * Returns the SpriteDef for any manifest key by string lookup.
 * Use this for runtime lookups where the key is not statically known (e.g. SPRITE_BUILDING).
 * Returns undefined if the sprite has not been loaded yet.
 */
export function getSpriteDefByKey(key: string): SpriteDef | undefined {
  return _defs.get(key);
}

/**
 * Returns the blocked tile offsets for a sprite-building variant by manifest key.
 * Used to compute collision for SPRITE_BUILDING tiles with per-variant footprints.
 *
 * This is the sprite's whole footprint minus its doorway, not just the tiles its
 * `blockedRegions` cover: the art is opaque across the full frame, so any tile
 * under it that stayed walkable would be a pocket the player and townsfolk can
 * vanish into behind the facade.
 */
export function getBlockedTileOffsetsByKey(key: string): ReadonlyArray<TileOffset> {
  return _spriteKeyBlockedOffsets.get(key) ?? [];
}

/** Tile-space rectangle a map sprite occupies, relative to its anchor tile. */
export interface SpriteFootprint {
  readonly dx: number;
  readonly dy: number;
  readonly w: number;
  readonly h: number;
}

/** A sprite building's entrance: the gap its facade leaves in its blocked base row. */
export interface SpriteDoorway extends TileOffset {
  /** Leftmost column of the gap; `dx` is its centre. */
  readonly dx0: number;
  /** How many tiles wide the gap is, so road stubs can match the opening. */
  readonly width: number;
}

const _spriteKeyFootprints = new Map<string, SpriteFootprint>();
const _spriteKeyDoorways = new Map<string, SpriteDoorway>();

for (const [key, entry] of Object.entries(_manifest)) {
  // The anchor tile's top-left corner sits at (tileX, tileY) in sprite pixels, so
  // the art can extend both above/left of the anchor and below/right of it.
  const dx = -Math.ceil(entry.tileX / entry.tileScale);
  const dy = -Math.ceil(entry.tileY / entry.tileScale);
  const right = Math.ceil((entry.frameWidth - entry.tileX) / entry.tileScale);
  const bottom = Math.ceil((entry.frameHeight - entry.tileY) / entry.tileScale);
  _spriteKeyFootprints.set(key, { dx, dy, w: right - dx, h: bottom - dy });
}

/**
 * Derive a sprite building's doorway from the gap its `blockedRegions` leave in the
 * base of the facade: take the bottom-most blocked row, find the longest run of
 * unblocked columns inside the building's overall column span, and use its centre.
 *
 * The doorway is then pushed down to the sprite's front row. Decorations Y-sort on
 * `tileY * TILE_SIZE + frameHeight` while players sort on `y + TILE_SIZE`, so a
 * door tile above the sprite's visual foot would draw the player *behind* the
 * facade they are standing in front of.
 *
 * Sprites without blocked regions get no doorway.
 */
function computeDoorway(
  offsets: ReadonlyArray<TileOffset>,
  footprintBottomDy: number,
): SpriteDoorway | undefined {
  if (offsets.length === 0) return undefined;
  let minDx = offsets[0].dx;
  let maxDx = offsets[0].dx;
  let maxDy = offsets[0].dy;
  for (const o of offsets) {
    if (o.dx < minDx) minDx = o.dx;
    if (o.dx > maxDx) maxDx = o.dx;
    if (o.dy > maxDy) maxDy = o.dy;
  }
  const blockedInBaseRow = new Set<number>();
  for (const o of offsets) {
    if (o.dy === maxDy) blockedInBaseRow.add(o.dx);
  }
  let bestStart = -1;
  let bestLength = 0;
  let runStart = -1;
  for (let dx = minDx; dx <= maxDx + 1; dx++) {
    const isGap = dx <= maxDx && !blockedInBaseRow.has(dx);
    if (isGap) {
      if (runStart === -1) runStart = dx;
      continue;
    }
    if (runStart !== -1) {
      const runLength = dx - runStart;
      if (runLength > bestLength) {
        bestLength = runLength;
        bestStart = runStart;
      }
      runStart = -1;
    }
  }
  if (bestLength === 0) return undefined;
  return {
    dx: bestStart + Math.floor((bestLength - 1) / 2),
    dx0: bestStart,
    dy: Math.max(maxDy, footprintBottomDy),
    width: bestLength,
  };
}

for (const [key, regionOffsets] of _spriteKeyRegionBlockedOffsets) {
  const footprint = _spriteKeyFootprints.get(key);
  if (footprint === undefined) continue;
  const doorway = computeDoorway(regionOffsets, footprint.dy + footprint.h - 1);
  if (doorway === undefined) continue;
  _spriteKeyDoorways.set(key, doorway);

  const blocked: TileOffset[] = [];
  for (let dy = footprint.dy; dy < footprint.dy + footprint.h; dy++) {
    for (let dx = footprint.dx; dx < footprint.dx + footprint.w; dx++) {
      const isDoorway = dy === doorway.dy && dx >= doorway.dx0 && dx < doorway.dx0 + doorway.width;
      if (!isDoorway) blocked.push({ dx, dy });
    }
  }
  _spriteKeyBlockedOffsets.set(key, blocked);
}

/** Returns the tile-space rectangle a map sprite covers, relative to its anchor tile. */
export function getSpriteFootprintByKey(key: string): SpriteFootprint | undefined {
  return _spriteKeyFootprints.get(key);
}

/**
 * Returns the anchor-relative doorway a sprite building's facade leaves in its
 * blocked base row. Undefined when the sprite declares no blocked regions or its
 * base row is fully blocked.
 */
export function getSpriteDoorwayByKey(key: string): SpriteDoorway | undefined {
  return _spriteKeyDoorways.get(key);
}

/** Names of every non-`idle` animation state a sprite declares, in manifest order. */
const _spriteKeyOverlayStates = new Map<string, ReadonlyArray<string>>();
for (const [key, entry] of Object.entries(_manifest)) {
  const overlays = Object.keys(entry.states).filter((name) => name !== 'idle');
  if (overlays.length > 0) _spriteKeyOverlayStates.set(key, overlays);
}

/**
 * Returns the non-`idle` states of a sprite building, which the map renderer
 * composites on top of the base facade (e.g. the blacksmith's forge flames).
 */
export function getSpriteOverlayStatesByKey(key: string): ReadonlyArray<string> {
  return _spriteKeyOverlayStates.get(key) ?? [];
}

/**
 * Returns how many game-pixels below the tile's top edge the sprite's visual
 * foot sits, used as the Y-sort anchor for the decoration overlay pass.
 * Returns undefined for tile types not registered in the manifest.
 */
export function getSortYAnchorPx(tileTypeId: number): number | undefined {
  return _tileSortYAnchorPx.get(tileTypeId);
}

/**
 * Returns how many game-pixels above the tile's top-left corner the sprite
 * extends. Used to expand viewport culling bounds so tall sprites (e.g. the
 * tower) aren't culled when the player is north of the tile but the sprite
 * top is still on screen.
 * Returns 0 for tile types not registered in the manifest.
 */
export function getSpriteOverheadPx(tileTypeId: number): number {
  return _tileSpriteOverheadPx.get(tileTypeId) ?? 0;
}

/** How far (game-pixels) map sprites can extend beyond their anchor tile's square, per direction. */
export interface MapSpriteExtentsPx {
  left: number;
  right: number;
  up: number;
  down: number;
}

// Worst-case overhang of any environment sprite beyond its anchor tile.
// drawSprite renders at (anchor - tileX·scale, anchor - tileY·scale) with size
// (frameWidth·scale, frameHeight·scale), so a sprite can overhang in all four
// directions — viewport culling must widen its tile scan by these amounts or
// buildings pop out of existence when their anchor tile leaves the screen.
const _mapSpriteExtentsPx: MapSpriteExtentsPx = { left: 0, right: 0, up: 0, down: 0 };
for (const entry of Object.values(environmentManifest)) {
  const scale = TILE_SIZE / entry.tileScale;
  _mapSpriteExtentsPx.left = Math.max(_mapSpriteExtentsPx.left, entry.tileX * scale);
  _mapSpriteExtentsPx.up = Math.max(_mapSpriteExtentsPx.up, entry.tileY * scale);
  _mapSpriteExtentsPx.right = Math.max(
    _mapSpriteExtentsPx.right,
    (entry.frameWidth - entry.tileX) * scale - TILE_SIZE,
  );
  _mapSpriteExtentsPx.down = Math.max(
    _mapSpriteExtentsPx.down,
    (entry.frameHeight - entry.tileY) * scale - TILE_SIZE,
  );
}

/** Returns the worst-case sprite overhang beyond an anchor tile, for culling margins. */
export function getMapSpriteExtentsPx(): Readonly<MapSpriteExtentsPx> {
  return _mapSpriteExtentsPx;
}
