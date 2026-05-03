import bossesManifest from '../images/bosses/manifest.json';
import charactersManifest from '../images/characters/manifest.json';
import effectsManifest from '../images/effects/manifest.json';
import enemiesManifest from '../images/enemies/manifest.json';
import environmentManifest from '../images/environment/manifest.json';
import npcsManifest from '../images/npcs/manifest.json';
import { TILE_SIZE } from './constants';

const manifestJson = {
  ...bossesManifest,
  ...charactersManifest,
  ...effectsManifest,
  ...enemiesManifest,
  ...environmentManifest,
  ...npcsManifest,
} as const;

export interface SpriteStateDef {
  readonly row: number;
  readonly frameCount: number;
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
  /** Tile offsets (relative to this sprite's tile) that should also be non-walkable. */
  readonly blockedTileOffsets?: ReadonlyArray<TileOffset>;
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

for (const entry of Object.values(_manifest)) {
  if (entry.tileTypeId === undefined) continue;
  const allBlockedOffsets: TileOffset[] = [];
  if (entry.blockedTileOffsets !== undefined) {
    allBlockedOffsets.push(...entry.blockedTileOffsets);
  }
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
