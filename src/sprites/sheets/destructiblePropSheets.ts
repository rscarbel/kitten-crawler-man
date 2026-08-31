/**
 * Which pictures the dungeon's smashable furniture carries.
 *
 * Six sheets — barrel, fallen barrel, crate, bookshelf, torch and brazier — all
 * painted by one prop engine (`src/sprites/art/destructiblePropArt.ts`) from one
 * warm-oak ramp and one cool-iron ramp, so a room full of them reads as
 * furniture from a single workshop.
 *
 * Every sheet carries the same four rows in the same order: the intact pose, the
 * damaged one, the six-frame break, and the flat wreckage the tile is left with.
 * The two burning props animate their first two rows instead of holding a single
 * pose, because a torch that stopped flickering once it was struck would read as
 * a bug rather than as damage.
 *
 * `fountain`, `stairwell` and `treasure_chests` share the props' manifest but
 * not this plan: they are still baked PNGs and keep their `path`.
 */

/**
 * The brazier's ember glow is wider than the frame it sits in, and that is fine.
 *
 * Its halo has a radius a little past the cell's half-width, so in the sheet
 * this replaced — which composited every frame onto one canvas without clipping
 * — each brazier frame carried a sliver of the *next* phase's glow. The game
 * draws one frame at a time, so that sliver was foreign light in the frame being
 * shown. Clipping each frame to its own cell removes it, and the frame that is
 * drawn is now only its own glow. Measured against the replaced sheet: 2172
 * pixels change in opacity by at most 7 parts in 255 — a three-percent halo —
 * and 1383 change in colour where anything is actually drawn, by at most 22.
 * Invisible at any size, which is why a parity check reports the brazier and
 * nothing else.
 */

import {
  drawProp,
  BRAZIER_FLAME_FRAMES,
  FLAME_FRAMES,
  SHATTER_FRAMES,
  type PropKind,
  type PropState,
} from '../art/destructiblePropArt';
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

interface Envelope {
  readonly frameWidth: number;
  readonly frameHeight: number;
  readonly tileX: number;
  readonly tileY: number;
}

/** Boxy props sit inside their own tile, so a uniform margin is all they need. */
const BOXED_ENVELOPE: Envelope = {
  frameWidth: DESTRUCTIBLE_PROP_TILE_SCALE + DEBRIS_MARGIN * 2,
  frameHeight: DESTRUCTIBLE_PROP_TILE_SCALE + DEBRIS_MARGIN * 2,
  tileX: DEBRIS_MARGIN,
  tileY: DEBRIS_MARGIN,
};

/** The props whose art climbs above their own tile: a haft, or a bed of coals. */
const BURNING_KINDS: ReadonlySet<PropKind> = new Set<PropKind>(['torch', 'brazier']);

/**
 * Headroom above a burning prop's tile, for the flame and its smoke.
 *
 * Exactly one tile, not one tile plus a debris margin: `unregisteredDecorationExtents`
 * in TileRenderer assumes a sprite-drawn decoration with no registered tile type
 * reaches at most one tile past its own square, and registering these props to
 * buy them more would also hand them a frame-derived Y-sort anchor a quarter-tile
 * below their actual foot. Flames and shatter bursts are sized to fit inside this.
 */
const BURNING_HEADROOM = DESTRUCTIBLE_PROP_TILE_SCALE;
const BURNING_ENVELOPE: Envelope = {
  frameWidth: DESTRUCTIBLE_PROP_TILE_SCALE + DEBRIS_MARGIN * 2,
  frameHeight: BURNING_HEADROOM + DESTRUCTIBLE_PROP_TILE_SCALE + DEBRIS_MARGIN,
  tileX: DEBRIS_MARGIN,
  tileY: BURNING_HEADROOM,
};

function envelopeFor(kind: PropKind): Envelope {
  return BURNING_KINDS.has(kind) ? BURNING_ENVELOPE : BOXED_ENVELOPE;
}

interface StatePlan {
  readonly state: PropState;
  readonly frames: number;
}

/** The boxy props hold a single pose per wear stage. */
const STATIC_STATES: ReadonlyArray<StatePlan> = [
  { state: 'idle', frames: 1 },
  { state: 'damaged', frames: 1 },
  { state: 'shatter', frames: SHATTER_FRAMES },
  { state: 'remains', frames: 1 },
];

/** The torch keeps burning at both wear stages, so both loop. */
const TORCH_STATES: ReadonlyArray<StatePlan> = [
  { state: 'idle', frames: FLAME_FRAMES },
  { state: 'damaged', frames: FLAME_FRAMES },
  { state: 'shatter', frames: SHATTER_FRAMES },
  { state: 'remains', frames: 1 },
];

/** The brazier's coal bed burns at both wear stages too, on a shorter loop. */
const BRAZIER_STATES: ReadonlyArray<StatePlan> = [
  { state: 'idle', frames: BRAZIER_FLAME_FRAMES },
  { state: 'damaged', frames: BRAZIER_FLAME_FRAMES },
  { state: 'shatter', frames: SHATTER_FRAMES },
  { state: 'remains', frames: 1 },
];

function statesFor(kind: PropKind): ReadonlyArray<StatePlan> {
  if (kind === 'torch') return TORCH_STATES;
  if (kind === 'brazier') return BRAZIER_STATES;
  return STATIC_STATES;
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

function rowsFor(kind: PropKind, seedTerm: number): PropSheetRow[] {
  return statesFor(kind).map((plan) => {
    const frames: FramePainter[] = [];
    for (let frame = 0; frame < plan.frames; frame++) {
      const paint: FramePainter = (ctx, originX, originY) => {
        drawProp(
          ctx,
          kind,
          plan.state,
          frame,
          originX,
          originY,
          DESTRUCTIBLE_PROP_TILE_SCALE,
          seedTerm,
        );
      };
      frames.push(paint);
    }
    return { state: plan.state, frames };
  });
}

function destructiblePropSheet(kind: PropKind & SpriteKey, seedTerm: number): PropSheetPlan {
  return {
    key: kind,
    file: `${kind}.png`,
    tileScale: DESTRUCTIBLE_PROP_TILE_SCALE,
    ...envelopeFor(kind),
    rows: rowsFor(kind, seedTerm),
  };
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
