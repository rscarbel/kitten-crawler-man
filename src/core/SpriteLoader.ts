import bossesManifest from '../images/bosses/manifest.json';
import charactersManifest from '../images/characters/manifest.json';
import effectsManifest from '../images/effects/manifest.json';
import enemiesManifest from '../images/enemies/manifest.json';
import environmentBuildingsManifest from '../images/environment/buildings/manifest.json';
import environmentCircusManifest from '../images/environment/circus/manifest.json';
import environmentClubManifest from '../images/environment/club/manifest.json';
import environmentNatureManifest from '../images/environment/nature/manifest.json';
import environmentPropsManifest from '../images/environment/props/manifest.json';
import environmentTilesetsManifest from '../images/environment/tilesets/manifest.json';
import environmentTownscapeManifest from '../images/environment/townscape/manifest.json';
import environmentTreesManifest from '../images/environment/trees/manifest.json';
import environmentRocksManifest from '../images/environment/rocks/manifest.json';
import environmentCampManifest from '../images/environment/camp/manifest.json';
import environmentOverCityManifest from '../images/environment/towns/over_city/manifest.json';
import environmentWallsRoofsManifest from '../images/environment/walls_roofs/manifest.json';
import npcsManifest from '../images/npcs/manifest.json';
import interfacesManifest from '../images/interfaces/manifest.json';
import grotesqueSpiderManifest from '../images/bosses/grotesque_spider/manifest.json';
import { TILE_SIZE } from './constants';
import { ASSET_GROUPS, type AssetGroup } from './assetGroups';
import { settings } from './Settings';

const environmentManifest = {
  ...environmentBuildingsManifest,
  ...environmentCircusManifest,
  ...environmentClubManifest,
  ...environmentNatureManifest,
  ...environmentPropsManifest,
  ...environmentTilesetsManifest,
  // The town's street furniture. Both belong in the environment subset because
  // that is what `getMapSpriteExtentsPx` widens the map's cull margin by, and a
  // street lamp reaches four tiles above its own tile.
  ...environmentTownscapeManifest,
  ...environmentOverCityManifest,
  // The forest. Its own directory because `writeSheets` replaces a directory's
  // whole manifest, and `nature/` also holds assets no tree generator writes.
  ...environmentTreesManifest,
  // The wilderness's boulders. Their own directory for the same reason the trees
  // have one: `writeSheets` replaces a directory's whole manifest.
  ...environmentRocksManifest,
  // The goblin camp's tents and its fire, in their own directory for the same
  // reason: `writeSheets` replaces a directory's whole manifest.
  ...environmentCampManifest,
  ...environmentWallsRoofsManifest,
} as const;

const manifestJson = {
  ...bossesManifest,
  ...grotesqueSpiderManifest,
  ...charactersManifest,
  ...effectsManifest,
  ...enemiesManifest,
  ...environmentManifest,
  ...npcsManifest,
  ...interfacesManifest,
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
  /**
   * For generated ground materials: how many tiles across one seamless patch is.
   * Frames are ordered variant-major then row-major within the patch, so the
   * frame for map tile (tx, ty) is
   * `variant * patchTiles² + (ty mod patchTiles) * patchTiles + (tx mod patchTiles)`.
   * Absent or 1 means every frame stands alone.
   */
  readonly patchTiles?: number;
  /** Human-readable name, shown by the `?tiles` dev review route. */
  readonly label?: string;
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

/**
 * Runtime sprite data: loaded image + dimensions from the manifest.
 *
 * `img` is normally the decoded `HTMLImageElement` itself. On a low-end device
 * (see `shouldDownscaleForLowEndDevice`) it may instead be a half-size
 * offscreen `<canvas>` the sheet was resampled into at load time — every other
 * field on this def is halved to match, so nothing downstream needs to know
 * which one it got.
 */
export interface SpriteDef {
  readonly img: HTMLImageElement | HTMLCanvasElement;
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
  readonly tileScale: number;
  readonly states: ReadonlyMap<string, SpriteStateDef>;
}

const _defs = new Map<string, SpriteDef>();

/**
 * One promise per in-flight (or already-settled) image load, keyed by manifest
 * key. Lets a given key's load be awaited independently — `loadSprites`,
 * `loadGroups` and a lazy miss in `getSpriteDef` all share the same in-flight
 * promise instead of each kicking off its own `Image()`.
 */
const _loading = new Map<string, Promise<void>>();

/** URL prefix prepended to every manifest path, browser-side. */
const DEFAULT_IMAGE_BASE = 'src/images/';

// A missing sprite is otherwise invisible in every sense: onload/onerror both
// resolve silently and the getters below just return undefined, so a typo'd
// manifest path produces an invisible creature with zero console output.
const _missCounts = new Map<string, number>();

/** Logs once per key on its first miss — every miss after that would just be per-frame noise. */
function recordMiss(key: string): void {
  const priorCount = _missCounts.get(key) ?? 0;
  if (priorCount === 0) {
    console.warn(`[SpriteLoader] Miss: no loaded sprite for key "${key}"`);
  }
  _missCounts.set(key, priorCount + 1);
}

/**
 * Per-key miss counts for keys that are STILL unresolved right now, for the
 * `!assets` dev command. Empty in a healthy run.
 *
 * `_missCounts` alone can't answer that: because sprite groups load lazily,
 * every non-`core` sprite on the current floor is *expected* to miss once
 * while its group's `loadGroups` call is in flight — recording that as a permanent miss would
 * make a genuinely broken sheet indistinguishable from ordinary lazy-load
 * latency, defeating the point of this counter. Filtering to keys absent
 * from `_defs` at read time reports only sprites that never arrived.
 */
export function getSpriteMissCounts(): ReadonlyMap<string, number> {
  const unresolved = new Map<string, number>();
  for (const [key, count] of _missCounts) {
    if (!_defs.has(key)) unresolved.set(key, count);
  }
  return unresolved;
}

/** A sheet resampled to half size shrinks resident bitmap memory 4×. */
const DOWNSCALE_FACTOR = 0.5;

/**
 * Whether this device is low-end enough to trade sheet resolution for memory.
 *
 * Deliberately narrow and device-derived rather than a new setting of its own —
 * reuses the existing `RenderQuality` axis (`settings.quality`) and the
 * display's own pixel ratio. Must NEVER be true at DPR ≥ 2: those sheets are
 * baked 1:1 for a Retina display, and halving them there is a visible quality
 * regression, not an invisible memory win.
 */
function shouldDownscaleForLowEndDevice(): boolean {
  if (Math.round(window.devicePixelRatio) >= 2) return false;
  return settings.quality === 'performance' || Math.round(window.devicePixelRatio) <= 1;
}

/**
 * Resamples a loaded sheet into a half-size canvas and returns the geometry
 * to store alongside it, or `undefined` if the sheet is not a safe candidate
 * (already too small to halve without degenerating to zero).
 *
 * Every field that describes a pixel position in the sheet — `frameWidth`,
 * `frameHeight`, `tileX`, `tileY`, `tileScale` — is scaled by the exact same
 * `DOWNSCALE_FACTOR` as the bitmap, and deliberately left as the resulting
 * (possibly fractional) number rather than rounded to an integer. Rounding
 * each field independently would drift the computed frame origin
 * (`col * frameWidth` in `frameOrigin`) further from the bitmap's true frame
 * boundary with every column — invisible on frame 0, a visibly mis-cropped
 * frame by frame 7 of an 8-frame walk cycle. Keeping the scale factor exact
 * means every downstream `drawImage` sub-rect lands exactly where it would
 * have on an ideal (non-rounded) half-size image; only the canvas's own
 * backing-store dimensions round to whole device pixels, which is an
 * unavoidable and uniform sub-pixel stretch across the whole sheet, not a
 * per-frame misalignment.
 */
function downscaleSheet(
  img: HTMLImageElement,
  entry: SpriteManifestEntry,
):
  | {
      img: HTMLCanvasElement;
      frameWidth: number;
      frameHeight: number;
      tileX: number;
      tileY: number;
      tileScale: number;
    }
  | undefined {
  const halfFrameWidth = entry.frameWidth * DOWNSCALE_FACTOR;
  const halfFrameHeight = entry.frameHeight * DOWNSCALE_FACTOR;
  if (Math.round(halfFrameWidth) < 1 || Math.round(halfFrameHeight) < 1) return undefined;

  const halfImageWidth = Math.round(img.naturalWidth * DOWNSCALE_FACTOR);
  const halfImageHeight = Math.round(img.naturalHeight * DOWNSCALE_FACTOR);
  if (halfImageWidth < 1 || halfImageHeight < 1) return undefined;

  const canvas = document.createElement('canvas');
  canvas.width = halfImageWidth;
  canvas.height = halfImageHeight;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return undefined;
  ctx.drawImage(img, 0, 0, halfImageWidth, halfImageHeight);

  return {
    img: canvas,
    frameWidth: halfFrameWidth,
    frameHeight: halfFrameHeight,
    tileX: entry.tileX * DOWNSCALE_FACTOR,
    tileY: entry.tileY * DOWNSCALE_FACTOR,
    tileScale: entry.tileScale * DOWNSCALE_FACTOR,
  };
}

/**
 * Loads one manifest entry's image and populates `_defs` on success. Shared by
 * every loading path (`loadSprites`, `loadGroups`, and a lazy miss scheduled
 * from `getSpriteDef`/`getSpriteDefByKey`) so the `img.onerror` observability
 * only lives in one place.
 *
 * Returns the same promise to every caller for a given key while it's
 * in-flight, and a pre-resolved one once `_defs` already has the key — so
 * calling this on an already-loaded key is a cheap no-op, not a re-fetch.
 */
function ensureLoading(key: string, entry: SpriteManifestEntry, base: string): Promise<void> {
  if (_defs.has(key)) return Promise.resolve();
  const existing = _loading.get(key);
  if (existing) return existing;

  const promise = new Promise<void>((resolve) => {
    const img = new Image();
    img.onload = () => {
      const statesMap = new Map<string, SpriteStateDef>();
      for (const [name, sd] of Object.entries(entry.states)) {
        statesMap.set(name, sd);
      }
      const downscaled = shouldDownscaleForLowEndDevice() ? downscaleSheet(img, entry) : undefined;
      _defs.set(key, {
        img: downscaled?.img ?? img,
        frameWidth: downscaled?.frameWidth ?? entry.frameWidth,
        frameHeight: downscaled?.frameHeight ?? entry.frameHeight,
        tileX: downscaled?.tileX ?? entry.tileX,
        tileY: downscaled?.tileY ?? entry.tileY,
        tileScale: downscaled?.tileScale ?? entry.tileScale,
        states: statesMap,
      });
      resolve();
    };
    img.onerror = () => {
      console.warn(`[SpriteLoader] Failed to load "${key}" from "${img.src}"`);
      resolve(); // Skip — a procedural fallback may still cover this key.
    };
    img.src = base + entry.path;
  });

  _loading.set(key, promise);
  return promise;
}

/**
 * Manifest entry for an arbitrary string key, or undefined if it names nothing
 * in the manifest. `_manifest`'s declared type has no `undefined` in its index
 * signature (every `SpriteKey` is guaranteed present), but a plain `string`
 * from `getSpriteDefByKey` carries no such guarantee — the `in` check below is
 * what earns the `| undefined` in this function's own return type.
 */
function manifestEntryFor(key: string): SpriteManifestEntry | undefined {
  return key in _manifest ? _manifest[key] : undefined;
}

/**
 * Narrows a plain string key to `SpriteKey` when it names a real manifest
 * entry. Every key ever inserted into `_defs`/`_loading` came from a call that
 * already resolved a manifest entry for it (see `ensureLoading`'s callers), so
 * this is always true in practice — it exists to satisfy `releaseSpritesExcept`'s
 * `ReadonlySet<SpriteKey>` parameter without an `as` cast.
 */
function isSpriteKey(key: string): key is SpriteKey {
  return key in _manifest;
}

/**
 * Load every sprite sheet listed in the manifest, eagerly. Used by offline
 * render/review scripts that want the whole atlas resident, not by the
 * shipped game (see `loadGroups` for that) — safe to call repeatedly since
 * `ensureLoading` skips anything already loaded or in flight.
 *
 * @param base  URL prefix prepended to each manifest path (default: 'src/images/')
 * @param onProgress  Called once per key as it resolves (loaded, total).
 */
export async function loadSprites(
  base = DEFAULT_IMAGE_BASE,
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const entries = Object.entries(_manifest);
  let loaded = 0;
  await Promise.all(
    entries.map(([key, entry]) =>
      ensureLoading(key, entry, base).then(() => {
        loaded++;
        onProgress?.(loaded, entries.length);
      }),
    ),
  );
}

/**
 * Load every sprite sheet covered by the union of the given asset groups.
 * Skips any key already resolved in `_defs` or already in flight — repeated
 * or overlapping calls (e.g. re-entering a floor) are cheap.
 *
 * @param onProgress  Called once per key as it resolves (loaded, total) —
 *   drives the boot loading screen.
 */
export async function loadGroups(
  groups: readonly AssetGroup[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  const keys = new Set<SpriteKey>();
  for (const group of groups) {
    for (const key of ASSET_GROUPS[group]) keys.add(key);
  }
  const keyList = Array.from(keys);
  let loaded = 0;
  await Promise.all(
    keyList.map((key) =>
      ensureLoading(key, _manifest[key], DEFAULT_IMAGE_BASE).then(() => {
        loaded++;
        onProgress?.(loaded, keyList.length);
      }),
    ),
  );
}

// Reused across every `prewarmGroups` call rather than allocated per image —
// a 1×1 canvas is cheap either way, but there is no reason to churn one per sprite.
let _scratchCtx: CanvasRenderingContext2D | null = null;

function getScratchCtx(): CanvasRenderingContext2D | null {
  if (_scratchCtx === null) {
    const canvas = document.createElement('canvas');
    canvas.width = 1;
    canvas.height = 1;
    _scratchCtx = canvas.getContext('2d');
  }
  return _scratchCtx;
}

/**
 * Forces the browser to actually upload a loaded image as a GPU texture,
 * rather than leaving that for whatever frame first `drawImage()`s it.
 *
 * `img.decode()` resolving is not enough on its own — Chrome can still defer
 * the texture upload to the first real draw, which is exactly the hitch this
 * function exists to move earlier. Drawing the image into an off-screen canvas
 * forces that upload to happen now, while nothing is watching the frame time.
 *
 * `img` may be a `downscaleSheet`-produced `<canvas>` instead of an `<img>` —
 * `decode()` doesn't exist on `HTMLCanvasElement` (it was already rasterized
 * synchronously when `downscaleSheet` drew into it), so that step is skipped
 * for a canvas; the forcing draw below still applies to either source.
 */
async function forceGpuUpload(img: HTMLImageElement | HTMLCanvasElement): Promise<void> {
  if (img instanceof HTMLImageElement) {
    try {
      await img.decode();
    } catch {
      // A decode failure here just skips the pre-warm — the sprite falls back
      // to hitching on its first real draw, exactly as it would have before
      // this phase existed. Not worth surfacing as a miss: `ensureLoading`'s
      // `onerror` already covers genuinely broken sheets.
      return;
    }
  }
  const ctx = getScratchCtx();
  if (ctx === null) return;
  ctx.drawImage(img, 0, 0, 1, 1);
}

/**
 * Loads every sprite sheet covered by the given asset groups (same as
 * `loadGroups`), then forces each one's GPU texture upload while nothing is
 * watching the frame time — see `forceGpuUpload`. Callers decide when "now"
 * is: behind the boot loading screen, during a floor's fade-in, or the moment
 * a boss encounter is staged rather than when its fight actually starts. Safe
 * to call repeatedly or with overlapping groups — same coalescing as
 * `loadGroups`, plus `forceGpuUpload` on an already-uploaded image is just a
 * cheap redundant draw.
 */
export async function prewarmGroups(
  groups: readonly AssetGroup[],
  onProgress?: (loaded: number, total: number) => void,
): Promise<void> {
  await loadGroups(groups, onProgress);
  const keys = new Set<SpriteKey>();
  for (const group of groups) {
    for (const key of ASSET_GROUPS[group]) keys.add(key);
  }
  await Promise.all(
    Array.from(keys, (key) => {
      const def = _defs.get(key);
      return def === undefined ? Promise.resolve() : forceGpuUpload(def.img);
    }),
  );
}

/**
 * Returns the loaded SpriteDef for the given key, or undefined if not yet
 * loaded. A miss schedules that key's load (fire-and-forget) in addition to
 * recording it — the caller sees `undefined` and skips its draw for a frame
 * or two, exactly as an always-missing sprite already did before lazy
 * loading existed; `_loading`'s per-key guard means repeated calls for the
 * same still-loading key don't re-fetch.
 */
export function getSpriteDef(key: SpriteKey): SpriteDef | undefined {
  const def = _defs.get(key);
  if (def === undefined) {
    recordMiss(key);
    void ensureLoading(key, _manifest[key], DEFAULT_IMAGE_BASE);
  }
  return def;
}

/**
 * Drops every loaded sprite whose key is not in `keep`, so its decoded bitmap
 * can be reclaimed. Only touches `_defs`/`_loading` — every derived-metadata
 * map above (blocked tile offsets, footprints, doorways, extents) is built
 * synchronously from the manifest JSON at module load and stays eager
 * regardless of what's evicted here, since none of it reads pixels and none
 * of it costs the memory this eviction is trying to reclaim.
 *
 * Setting `img.src = ''` (rather than just letting the `HTMLImageElement` fall
 * out of `_defs`) is what actually releases the decoded bitmap — an `<img>`
 * with no other referrer would otherwise still be reachable from whatever
 * fired its `load` event closure until GC gets around to it, and Chrome does
 * not appear to drop the backing bitmap just because nothing on the page
 * currently points at the element.
 *
 * A key evicted here that's still needed shows up again exactly like a
 * never-loaded one: `getSpriteDef`/`getSpriteDefByKey` miss, log it once, and
 * reschedule its load — the same fail-safe lazy-load path every other miss
 * already relies on.
 *
 * Known trade-off: this only sweeps `_defs` (already-resolved keys) at the
 * instant of transition. A key the OUTGOING floor kicked off via `loadGroups`
 * but that hadn't resolved yet will still land in `_defs` when its fetch
 * completes a moment later, even though the new floor doesn't need it —
 * nothing revisits it until the *next* floor change's sweep. Bounded to at
 * most one extra floor's worth of stragglers, not an unbounded leak, so this
 * is accepted rather than solved with e.g. a generation counter.
 */
export function releaseSpritesExcept(keep: ReadonlySet<SpriteKey>): void {
  for (const [key, def] of _defs) {
    if (isSpriteKey(key) && keep.has(key)) continue;
    if (def.img instanceof HTMLImageElement) {
      // Detach the handlers before clearing `src` — an `HTMLImageElement` fires
      // `error` when pointed at `''` same as any other failed load, and the
      // `onerror` from `ensureLoading` would otherwise log this deliberate
      // eviction as an indistinguishable "Failed to load" miss.
      def.img.onload = null;
      def.img.onerror = null;
      def.img.src = '';
    } else {
      // A downscaled sheet (see `downscaleSheet`): a `<canvas>` has no `src` to
      // clear, so the equivalent release is shrinking its own backing store to
      // nothing — the decoded pixels it held are what actually cost memory,
      // and dropping the `_defs` entry below only frees the wrapper object.
      def.img.width = 0;
      def.img.height = 0;
    }
    _defs.delete(key);
    // Not expected to still be here (a resolved `_defs` entry means its
    // `_loading` promise already settled), but a stale in-flight promise for
    // an evicted key would otherwise sit around forever pointing at pixels
    // that are gone.
    _loading.delete(key);
  }
}

// Both maps below are built synchronously from manifest JSON — no image loading required.

const _tileBlockedOffsets = new Map<number, ReadonlyArray<TileOffset>>();
const _tileSortYAnchorPx = new Map<number, number>();
const _tileSpriteOverheadPx = new Map<number, number>();
const _tileSpriteExtentsPx = new Map<number, MapSpriteExtentsPx>();
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
  _tileSpriteExtentsPx.set(entry.tileTypeId, {
    left: entry.tileX * scale,
    up: entry.tileY * scale,
    right: (entry.frameWidth - entry.tileX) * scale - TILE_SIZE,
    down: (entry.frameHeight - entry.tileY) * scale - TILE_SIZE,
  });
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
 * Returns undefined if the sprite has not been loaded yet — same schedule-a-load-then-miss
 * behavior as `getSpriteDef`, see its doc comment. A key that names nothing in the
 * manifest at all (as opposed to one merely not loaded yet) records a miss but has
 * nothing to schedule.
 */
export function getSpriteDefByKey(key: string): SpriteDef | undefined {
  const def = _defs.get(key);
  if (def === undefined) {
    recordMiss(key);
    const entry = manifestEntryFor(key);
    if (entry !== undefined) void ensureLoading(key, entry, DEFAULT_IMAGE_BASE);
  }
  return def;
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
const _spriteKeyExtentsPx = new Map<string, MapSpriteExtentsPx>();

for (const [key, entry] of Object.entries(_manifest)) {
  // The anchor tile's top-left corner sits at (tileX, tileY) in sprite pixels, so
  // the art can extend both above/left of the anchor and below/right of it.
  const dx = -Math.ceil(entry.tileX / entry.tileScale);
  const dy = -Math.ceil(entry.tileY / entry.tileScale);
  const right = Math.ceil((entry.frameWidth - entry.tileX) / entry.tileScale);
  const bottom = Math.ceil((entry.frameHeight - entry.tileY) / entry.tileScale);
  _spriteKeyFootprints.set(key, { dx, dy, w: right - dx, h: bottom - dy });

  const scale = TILE_SIZE / entry.tileScale;
  _spriteKeyExtentsPx.set(key, {
    left: entry.tileX * scale,
    up: entry.tileY * scale,
    right: (entry.frameWidth - entry.tileX) * scale - TILE_SIZE,
    down: (entry.frameHeight - entry.tileY) * scale - TILE_SIZE,
  });
}

/**
 * Overhang of one named sprite beyond its anchor tile. Sprite buildings all
 * share a tile type, so their extents can only be resolved by key.
 */
export function getSpriteExtentsPxByKey(key: string): Readonly<MapSpriteExtentsPx> | undefined {
  return _spriteKeyExtentsPx.get(key);
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

/**
 * Overhang of one tile type's sprite, for culling that widens the viewport per
 * tile type rather than by the worst case in the whole manifest. Undefined for
 * tile types with no registered sprite.
 */
export function getSpriteExtentsPxForTileType(
  tileTypeId: number,
): Readonly<MapSpriteExtentsPx> | undefined {
  return _tileSpriteExtentsPx.get(tileTypeId);
}
