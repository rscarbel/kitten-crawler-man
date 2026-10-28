/**
 * The Energy Shield's three effects as painted figures: the human's shield,
 * the cat's mini-shield, and the expiry shockwave.
 *
 * Painting lives in `energyShieldArt.ts`; this module is the cell geometry,
 * the frame counts and the choreography — which parameter each row sweeps, and
 * over what range — lifted from the generator that used to bake these sheets.
 *
 * The cells and anchors are the numbers the sheets were baked with rather than
 * a rule these three happen to follow: their paddings differ (40, 32 and 16
 * pixels of clear space around the widest ring, before the haloes stacked
 * outside it), because each was sized to its own effect by hand.
 * `scripts/gates-energy-shield.ts` re-measures the ink against each declared
 * cell, which is what says the padding is still real.
 *
 * Every row sweeps its parameter across the closed interval [0, 1] — the
 * `sweepRow` sampling the generator used — so the endpoints are painted rather
 * than approached. The consequence that is gated is the fade: the three rows
 * that fade to nothing reach alpha 0 on their outermost frame, and the blank
 * table below is what says so. The other consequence is not a gated claim but a
 * cost — a looping row's closing frame lands back on its opening one, so
 * `active` spends one frame of each loop held still.
 */

import { type FigureDef, figureStates } from '../figure/figureDef';
import {
  type ShieldVariant,
  drawEnergyShieldActive,
  drawEnergyShieldAppear,
  drawEnergyShieldExpire,
  drawEnergyShieldMini,
  drawEnergyShieldShockwave,
} from './energyShieldArt';

/**
 * Cell pixels per tile. These effects were baked at the game's own tile size,
 * so one cell pixel is one screen pixel at the default zoom.
 */
export const TILE_SCALE = 32;

/** Every row of every shield sheet is eight frames. */
export const SHIELD_FRAME_COUNT = 8;

/**
 * The sweep the generator's `sweepRow` produced: frame 0 sits at 0 and the last
 * frame at 1, so a cycle's closing frame lands back on its opening one and a
 * one-shot's last frame is the end of the motion rather than a step short of it.
 */
export function sweepFraction(frame: number, frameCount: number): number {
  return frameCount === 1 ? 0 : frame / (frameCount - 1);
}

/** The rows the human's shield paints, and the variant each one is drawn in. */
export const SHIELD_ACTIVE_STATE = 'active';
export const SHIELD_FULL_POWER_STATE = 'full_power';
export const SHIELD_APPEAR_STATE = 'appear';
export const SHIELD_APPEAR_FULL_POWER_STATE = 'appear_full_power';
export const SHIELD_EXPIRE_STATE = 'expire';

/** The cat mini-shield's one row. */
export const MINI_SHIELD_STATE = 'active';

/** The shockwave's one row. */
export const SHOCKWAVE_STATE = 'expand';

/** A cell is scaled so its full width covers the effect's diameter. */
const CELL_SPANS_DIAMETER = 2;

const FIRST_FRAME = 0;
const LAST_FRAME = SHIELD_FRAME_COUNT - 1;

const SHIELD_CELL = 400;
const MINI_CELL = 192;
const SHOCKWAVE_CELL = 480;

type ShieldRowPainter = (
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  tilePx: number,
  sweep: number,
) => void;

function variantPainter(
  paint: (
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    tilePx: number,
    variant: ShieldVariant,
    sweep: number,
  ) => void,
  variant: ShieldVariant,
): ShieldRowPainter {
  return (ctx, cx, cy, tilePx, sweep) => {
    paint(ctx, cx, cy, tilePx, variant, sweep);
  };
}

const SHIELD_ROWS: ReadonlyMap<string, ShieldRowPainter> = new Map([
  [SHIELD_ACTIVE_STATE, variantPainter(drawEnergyShieldActive, 'standard')],
  [SHIELD_FULL_POWER_STATE, variantPainter(drawEnergyShieldActive, 'full_power')],
  [SHIELD_APPEAR_STATE, variantPainter(drawEnergyShieldAppear, 'standard')],
  [SHIELD_APPEAR_FULL_POWER_STATE, variantPainter(drawEnergyShieldAppear, 'full_power')],
  [SHIELD_EXPIRE_STATE, drawEnergyShieldExpire],
]);

/**
 * Builds a figure whose cell is square and whose anchor is its centre.
 *
 * The anchor is the shield's centre — the player's tile centre — and not a tile
 * corner, which is why `tileX` and `tileY` are half the cell rather than the
 * offset a standing creature would use.
 */
function centredFigure(
  id: string,
  cell: number,
  rows: ReadonlyMap<string, ShieldRowPainter>,
): FigureDef {
  const anchor = cell / 2;
  const frameCounts: Record<string, number> = {};
  for (const state of rows.keys()) frameCounts[state] = SHIELD_FRAME_COUNT;
  return {
    id,
    frameWidth: cell,
    frameHeight: cell,
    tileX: anchor,
    tileY: anchor,
    tileScale: TILE_SCALE,
    states: figureStates(frameCounts),
    paintFrame: (ctx, state, frame) => {
      const paint = rows.get(state);
      if (paint === undefined) return;
      paint(ctx, anchor, anchor, TILE_SCALE, sweepFraction(frame, SHIELD_FRAME_COUNT));
    },
  };
}

export const ENERGY_SHIELD_FIGURE = centredFigure('energy_shield', SHIELD_CELL, SHIELD_ROWS);

export const ENERGY_SHIELD_MINI_FIGURE = centredFigure(
  'energy_shield_mini',
  MINI_CELL,
  new Map([[MINI_SHIELD_STATE, drawEnergyShieldMini]]),
);

export const ENERGY_SHIELD_SHOCKWAVE_FIGURE = centredFigure(
  'energy_shield_shockwave',
  SHOCKWAVE_CELL,
  new Map([[SHOCKWAVE_STATE, drawEnergyShieldShockwave]]),
);

/**
 * The `tileSize` at which a shield figure's whole cell spans `2 * radiusPx`.
 *
 * The cell, not the ring: every one of these cells is padded beyond the widest
 * ring painted into it, so the ring lands *inside* the gameplay radius by that
 * padding — the human's shield draws its border at four fifths of the radius it
 * actually pushes mobs out of. That is how the effect shipped, and scaling the
 * ring onto the radius instead would visibly grow all three of them.
 */
export function shieldTileSizeFor(def: FigureDef, radiusPx: number): number {
  return (radiusPx * CELL_SPANS_DIAMETER * TILE_SCALE) / def.frameWidth;
}

/**
 * The frames that legitimately paint nothing at all.
 *
 * Three rows run their fade to a true zero rather than stopping just short of
 * it, because the sweep paints both endpoints: an appearing shield is invisible
 * on the frame it starts from, and an expiring shield and a spent shockwave are
 * invisible on the frame they end on. That is the shipped art, so the structural
 * gate is told to expect exactly these four cells and to fail on a blank cell
 * anywhere else — a frame that paints nothing is otherwise how a NaN in the
 * choreography looks.
 */
export const SHIELD_BLANK_FRAMES: ReadonlyMap<
  string,
  ReadonlyMap<string, ReadonlySet<number>>
> = new Map([
  [
    ENERGY_SHIELD_FIGURE.id,
    new Map([
      [SHIELD_APPEAR_STATE, new Set([FIRST_FRAME])],
      [SHIELD_APPEAR_FULL_POWER_STATE, new Set([FIRST_FRAME])],
      [SHIELD_EXPIRE_STATE, new Set([LAST_FRAME])],
    ]),
  ],
  [ENERGY_SHIELD_MINI_FIGURE.id, new Map()],
  [ENERGY_SHIELD_SHOCKWAVE_FIGURE.id, new Map([[SHOCKWAVE_STATE, new Set([LAST_FRAME])]])],
]);

/** All three shield figures, for the gates and the review harness. */
export const ENERGY_SHIELD_FIGURES: readonly FigureDef[] = [
  ENERGY_SHIELD_FIGURE,
  ENERGY_SHIELD_MINI_FIGURE,
  ENERGY_SHIELD_SHOCKWAVE_FIGURE,
];
