import {
  drawSpriteKey,
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/SpriteRenderer';
import { getSpriteDefByKey, type SpriteStates } from '../core/SpriteLoader';
import { MAX_MOB_CULL_MARGIN_TILES } from '../core/constants';

/**
 * The two sheets baked from `scripts/mantidArt.ts`: the bounty boss and the
 * crony mantises that escort him. They are the same species and the same rows,
 * except that only the boss carries `flurry` and `rage_pause`.
 */
export type MantidSheet = 'mantid' | 'mantis';

type MantidState = SpriteStates['mantid'];
type MantisState = SpriteStates['mantis'];

/** Which of the sheet's three viewpoints a facing vector selects. */
type MantidView = 'front' | 'side' | 'away';

/** The action a mantis is showing, before it is resolved against a viewpoint. */
export type MantidAction = 'idle' | 'walk' | 'slash' | 'flurry' | 'rage_pause';

/**
 * How many frames a row actually holds, read from the sheet the game loaded.
 *
 * Not a hand-copied table: `drawSprite` *clamps* the frame index, so a row that
 * got shorter in a rebake would silently freeze on its last frame rather than
 * throw. There is nothing to notice until someone watches that one animation.
 */
function frameCountOf(sheet: MantidSheet, state: string): number {
  return getSpriteDefByKey(sheet)?.states.get(state)?.frameCount ?? 1;
}

/** Loop speed for the idle, which is driven by the clock rather than by a timer. */
const IDLE_FPS = 6;
/** The flurry loops far faster than the idle — it is three seconds of blender. */
const FLURRY_FPS = 14;
/** The rage pause holds for one second; its loop crawls so the tremble reads. */
const RAGE_FPS = 6;
const MS_PER_SECOND = 1000;

/** Everything the mantid sprite needs to pick a pose. All fields are optional. */
export interface MantidSpriteState {
  /** The walk cycle angle from `Player.walkFrame` (radians, 0–2π). */
  readonly walkFrame?: number;
  readonly isMoving?: boolean;
  readonly facingX?: number;
  readonly facingY?: number;
  /** 0 at the first frame of a slash, 1 at the last; null when not slashing. */
  readonly slashProgress?: number | null;
  /** True while the boss is mid-flurry. Outranks everything but the rage pause. */
  readonly isFlurrying?: boolean;
  /** True during the invincible second before the flurry. Outranks everything. */
  readonly isRaging?: boolean;
}

/** Views split on whichever axis the mantis is facing hardest along. */
function viewFor(facingX: number, facingY: number): MantidView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function stateFor(base: MantidAction, view: MantidView): string {
  // The rage pause is one pose from any angle: the animal has stopped and reared
  // straight up, so there is nothing for a viewpoint to change.
  if (base === 'rage_pause') return base;
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

/**
 * The eight pieces a mantis comes apart into, in the order they spawn.
 *
 * The single source of truth for the runtime side: `scripts/mantidGore.ts`
 * paints them in this order and `BodyPartGoreSystem` spawns them in it, so a
 * rename in one place is a missing body part rather than a silent no-op.
 */
export const MANTID_GORE_PARTS: ReadonlyArray<string> = [
  'gore_raptorial_arm',
  'gore_head',
  'gore_pronotum',
  'gore_abdomen',
  'gore_wing_case',
  'gore_leg',
  'gore_entrails',
  'gore_carapace',
];

/** Clearance kept between the top of the art and any glyph riding above it, in tiles. */
export const MANTID_OVERHEAD_CLEARANCE_TILES = 0.15;

/**
 * The creature's own tile, which the low-side cull edges must clear on top of
 * the overhang.
 *
 * `RenderPipeline` culls on `mob.x`/`mob.y` — the tile's *top-left corner* —
 * against one symmetric margin. Leaving the screen to the left or upward, the
 * art's far edge is a whole tile past that corner before the overhang even
 * starts, which is why the engine's own default margin is 1 rather than 0. A
 * margin computed from the overhang alone drops a creature while a chunk of it
 * is still on screen.
 */
const OWN_TILE_TILES = 1;

interface ArtExtent {
  /** Tiles the art rises above the tile its creature stands on. */
  readonly up: number;
  /**
   * The margin the art alone demands, largest over all four screen edges —
   * including the creature's own tile on the two edges that need it, so this is
   * a required *margin* and not an overhang. Conflating the two is what made the
   * first version of this cull too small.
   */
  readonly widest: number;
}

/** Cached per sheet: the manifest never changes after load, and this is read per frame. */
const artExtents = new Map<MantidSheet, ArtExtent>();

/**
 * How far a sheet's art reaches past the tile it is anchored to.
 *
 * Measured from the loaded manifest rather than hand-copied. Every one of these
 * numbers changes whenever a rebake resizes the cell, and a copied one goes
 * stale silently — the creature is simply sheared off at the screen edge, or a
 * marker detaches from its head, with nothing to catch it.
 */
function artExtentOf(sheet: MantidSheet): ArtExtent | null {
  const cached = artExtents.get(sheet);
  if (cached !== undefined) return cached;
  const def = getSpriteDefByKey(sheet);
  // Deliberately not cached: a missing def means the sheet has not finished
  // loading, and caching that would pin both creatures to their fallbacks for
  // the rest of the session.
  if (def === undefined) return null;
  const up = def.tileY / def.tileScale;
  const down = (def.frameHeight - def.tileY - def.tileScale) / def.tileScale;
  // Read from `tileX` rather than assumed centred. Every other number here comes
  // from the manifest precisely so a rebake cannot make it stale, and an anchor
  // the manifest already states is not a thing to re-derive.
  const side = Math.max(def.tileX, def.frameWidth - def.tileX - def.tileScale) / def.tileScale;
  const extent: ArtExtent = {
    up,
    widest: Math.max(up, OWN_TILE_TILES + down, OWN_TILE_TILES + side),
  };
  artExtents.set(sheet, extent);
  return extent;
}

/** How far above its tile origin to hang a glyph so it clears the art. */
export function mantidOverheadLiftTiles(sheet: MantidSheet, fallbackTiles: number): number {
  const extent = artExtentOf(sheet);
  if (extent === null) return fallbackTiles;
  return extent.up + MANTID_OVERHEAD_CLEARANCE_TILES;
}

/**
 * The cull margin a mantis of this build needs, in tiles.
 *
 * `extraOverheadTiles` is whatever the creature hangs above its own art — the
 * rage marker and the rising "Immune" labels reach further up than the animal
 * does, and a margin sized only to the art clips them at the screen edge.
 * Clamped because `RenderPipeline` queries a fixed maximum.
 */
export function mantidCullMarginTiles(
  sheet: MantidSheet,
  extraOverheadTiles: number,
  fallbackTiles: number,
): number {
  const extent = artExtentOf(sheet);
  if (extent === null) return fallbackTiles;
  const overhead = extent.up + MANTID_OVERHEAD_CLEARANCE_TILES + extraOverheadTiles;
  return Math.min(MAX_MOB_CULL_MARGIN_TILES, Math.max(extent.widest, overhead));
}

/** The `BodyPartGoreSystem` registry keys the two sheets' flying pieces come from. */
export const MANTID_BODY_PART_KEY = 'mantid';
export const MANTIS_BODY_PART_KEY = 'mantis';

/**
 * Draws a mantis of either build.
 *
 * Priority runs rage → flurry → slash → walk → idle, so the invincible second
 * always wins: it is the player's only warning, and a pose it can lose to is a
 * pose that sometimes fails to warn.
 */
export function drawMantidSprite(
  ctx: CanvasRenderingContext2D,
  sheet: MantidSheet,
  sx: number,
  sy: number,
  s: number,
  state: MantidSpriteState = {},
): void {
  const {
    walkFrame = 0,
    isMoving = false,
    facingX = 1,
    facingY = 0,
    slashProgress = null,
    isFlurrying = false,
    isRaging = false,
  } = state;
  const view = viewFor(facingX, facingY);
  // Only the profile art is mirrored: flipping the head-on views would put the
  // mantis's eyes and legs on the wrong sides every time it turned around.
  const flipX = view === 'side' && facingX < 0;
  const nowSeconds = performance.now() / MS_PER_SECOND;

  if (isRaging) {
    draw(
      ctx,
      sheet,
      'rage_pause',
      timeFrameIndex(nowSeconds, RAGE_FPS, frameCountOf(sheet, 'rage_pause')),
      sx,
      sy,
      s,
      false,
    );
    return;
  }

  if (isFlurrying) {
    const key = stateFor('flurry', view);
    draw(
      ctx,
      sheet,
      key,
      timeFrameIndex(nowSeconds, FLURRY_FPS, frameCountOf(sheet, key)),
      sx,
      sy,
      s,
      flipX,
    );
    return;
  }

  if (slashProgress !== null) {
    const key = stateFor('slash', view);
    draw(
      ctx,
      sheet,
      key,
      progressFrameIndex(slashProgress, frameCountOf(sheet, key)),
      sx,
      sy,
      s,
      flipX,
    );
    return;
  }

  if (isMoving) {
    const key = stateFor('walk', view);
    draw(ctx, sheet, key, walkFrameIndex(walkFrame, frameCountOf(sheet, key)), sx, sy, s, flipX);
    return;
  }

  const key = stateFor('idle', view);
  draw(
    ctx,
    sheet,
    key,
    timeFrameIndex(nowSeconds, IDLE_FPS, frameCountOf(sheet, key)),
    sx,
    sy,
    s,
    flipX,
  );
}

/**
 * Narrows a row name to whichever sheet's state union it belongs to.
 *
 * The two sheets have different state unions — only the boss has `flurry` and
 * `rage_pause` — so `drawSpriteKey`'s key-indexed signature cannot take a name
 * that was picked at runtime without this split. A crony can never reach the
 * boss-only branches because nothing sets `isFlurrying`/`isRaging` on one.
 */
function draw(
  ctx: CanvasRenderingContext2D,
  sheet: MantidSheet,
  state: string,
  frame: number,
  sx: number,
  sy: number,
  s: number,
  flipX: boolean,
): void {
  if (sheet === 'mantid') {
    if (!isMantidState(state)) return;
    drawSpriteKey(ctx, 'mantid', state, frame, sx, sy, s, { flipX });
    return;
  }
  if (!isMantisState(state)) return;
  drawSpriteKey(ctx, 'mantis', state, frame, sx, sy, s, { flipX });
}

function isMantidState(state: string): state is MantidState {
  return getSpriteDefByKey('mantid')?.states.has(state) === true;
}

function isMantisState(state: string): state is MantisState {
  return getSpriteDefByKey('mantis')?.states.has(state) === true;
}
