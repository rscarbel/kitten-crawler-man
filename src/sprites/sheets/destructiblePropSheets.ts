/**
 * Which pictures the cellars' smashable furniture carries.
 *
 * Six sheets — barrel, fallen barrel, crate, bookshelf, torch and brazier — all
 * painted by `src/sprites/art/destructiblePropArt.ts` from one warm-oak ramp and
 * one iron ramp, so a room full of them reads as furniture from a single
 * workshop.
 *
 * Every sheet carries the same four rows in the same order: the intact pose, the
 * damaged one, the six-frame break, and the flat wreckage the tile is left with.
 * A static prop's intact, damaged and wreckage rows hold one frame per look
 * (`PROP_VARIANT_COUNT`), and the draw site picks the look from the tile. The
 * two burning props animate their first two rows instead, because a torch that
 * stopped flickering once it was struck would read as a bug rather than damage.
 *
 * `fountain`, `stairwell` and `treasure_chests` share the props' manifest but
 * not this plan: they are still baked PNGs and keep their `path`.
 */

import {
  drawProp,
  BRAZIER_FLAME_FRAMES,
  FLAME_FRAMES,
  SHATTER_FRAMES,
  type PropKind,
  type PropState,
} from '../art/destructiblePropArt';
import { PROP_VARIANT_COUNT } from '../art/propPaint';
import type { PropSheetPlan, PropSheetRow, FramePainter } from './propSheetPlan';
import type { SpriteKey } from '../../core/SpriteLoader';

/**
 * Source pixels per game tile. Twice the game's own tile: the props are drawn
 * at 64 and downscaled by the renderer, which is what buys the wood grain and
 * the flame enough resolution to survive at 32.
 */
export const DESTRUCTIBLE_PROP_TILE_SCALE = 64;

/** Clearance around the logical tile for debris that flies past the footprint. */
const DEBRIS_MARGIN = 16;

/** A breakable prop's frame size and where its anchor tile sits inside the frame. */
export interface PropEnvelope {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

/** Boxy props sit inside their own tile, so a uniform margin is all they need. */
export const BOXED_PROP_ENVELOPE: PropEnvelope = {
  frameWidth: DESTRUCTIBLE_PROP_TILE_SCALE + DEBRIS_MARGIN * 2,
  frameHeight: DESTRUCTIBLE_PROP_TILE_SCALE + DEBRIS_MARGIN * 2,
  tileX: DEBRIS_MARGIN,
  tileY: DEBRIS_MARGIN,
};

/**
 * The props whose art climbs above their own tile: a torch's stand and flame,
 * a brazier's fire, and a bookshelf, which stands taller than a crawler.
 */
const TALL_KINDS: ReadonlySet<PropKind> = new Set<PropKind>(['torch', 'brazier', 'bookshelf']);

/**
 * Headroom above a tall prop's tile, for a flame and its smoke or the top of a case.
 *
 * Exactly one tile, not one tile plus a debris margin: `unregisteredDecorationExtents`
 * in TileRenderer assumes a sprite-drawn decoration with no registered tile type
 * reaches at most one tile past its own square, and registering these props to
 * buy them more would also hand them a frame-derived Y-sort anchor a quarter-tile
 * below their actual foot. Flames and shatter bursts are sized to fit inside this.
 */
const TALL_HEADROOM = DESTRUCTIBLE_PROP_TILE_SCALE;
export const TALL_PROP_ENVELOPE: PropEnvelope = {
  frameWidth: DESTRUCTIBLE_PROP_TILE_SCALE + DEBRIS_MARGIN * 2,
  frameHeight: TALL_HEADROOM + DESTRUCTIBLE_PROP_TILE_SCALE + DEBRIS_MARGIN,
  tileX: DEBRIS_MARGIN,
  tileY: TALL_HEADROOM,
};

function envelopeFor(kind: PropKind): PropEnvelope {
  return TALL_KINDS.has(kind) ? TALL_PROP_ENVELOPE : BOXED_PROP_ENVELOPE;
}

/** One row of a breakable prop's sheet: which wear stage, and how many frames. */
export interface PropStatePlan {
  readonly state: PropState;
  readonly frames: number;
}

/** The boxy props hold one pose per look at each wear stage. */
export const STATIC_PROP_STATES: ReadonlyArray<PropStatePlan> = [
  { state: 'idle', frames: PROP_VARIANT_COUNT },
  { state: 'damaged', frames: PROP_VARIANT_COUNT },
  { state: 'shatter', frames: SHATTER_FRAMES },
  { state: 'remains', frames: PROP_VARIANT_COUNT },
];

/** The torch keeps burning at both wear stages, so both loop. */
const TORCH_STATES: ReadonlyArray<PropStatePlan> = [
  { state: 'idle', frames: FLAME_FRAMES },
  { state: 'damaged', frames: FLAME_FRAMES },
  { state: 'shatter', frames: SHATTER_FRAMES },
  { state: 'remains', frames: 1 },
];

/** The brazier's coal bed burns at both wear stages too, on a shorter loop. */
export const BRAZIER_STATES: ReadonlyArray<PropStatePlan> = [
  { state: 'idle', frames: BRAZIER_FLAME_FRAMES },
  { state: 'damaged', frames: BRAZIER_FLAME_FRAMES },
  { state: 'shatter', frames: SHATTER_FRAMES },
  { state: 'remains', frames: 1 },
];

function statesFor(kind: PropKind): ReadonlyArray<PropStatePlan> {
  if (kind === 'torch') return TORCH_STATES;
  if (kind === 'brazier') return BRAZIER_STATES;
  return STATIC_PROP_STATES;
}

/** Paints one frame of a breakable prop: its wear stage, its frame within that row, and where. */
export type BreakablePropPainter = (
  ctx: CanvasRenderingContext2D,
  state: PropState,
  frame: number,
  originX: number,
  originY: number,
  ts: number,
) => void;

/** Builds a breakable prop's sheet plan from its envelope, its rows and one painter for every frame. */
export function breakablePropSheet(
  key: SpriteKey,
  envelope: PropEnvelope,
  states: ReadonlyArray<PropStatePlan>,
  paint: BreakablePropPainter,
): PropSheetPlan {
  const rows: PropSheetRow[] = states.map((plan) => {
    const frames: FramePainter[] = [];
    for (let frame = 0; frame < plan.frames; frame++) {
      frames.push((ctx, originX, originY) => {
        paint(ctx, plan.state, frame, originX, originY, DESTRUCTIBLE_PROP_TILE_SCALE);
      });
    }
    return { state: plan.state, frames };
  });
  return {
    key,
    file: `${key}.png`,
    tileScale: DESTRUCTIBLE_PROP_TILE_SCALE,
    ...envelope,
    rows,
  };
}

/** Every kind is its own manifest entry, and the key is the kind's own name. */
const KINDS: ReadonlyArray<PropKind & SpriteKey> = [
  'barrel',
  'barrel_side',
  'crate',
  'torch',
  'brazier',
  'bookshelf',
];

function destructiblePropSheet(kind: PropKind & SpriteKey, seedTerm: number): PropSheetPlan {
  return breakablePropSheet(
    kind,
    envelopeFor(kind),
    statesFor(kind),
    (ctx, state, frame, x, y, ts) => {
      drawProp(ctx, kind, state, frame, x, y, ts, seedTerm);
    },
  );
}

/**
 * Every destructible prop sheet, painted with `seedTerm` added to each kind's
 * own fixed seeds.
 *
 * The term is a parameter rather than read from the floor slot so a review bake
 * can paint the whole family at a candidate seed without pretending to be on a
 * floor. The shipped game passes zero — see `environmentSheets.ts`.
 */
export function destructiblePropSheetPlans(seedTerm: number): PropSheetPlan[] {
  return KINDS.map((kind) => destructiblePropSheet(kind, seedTerm));
}
