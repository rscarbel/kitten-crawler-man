/**
 * The Protective Shell's three effects as painted figures: the human's shell,
 * the cat's mini-shield, and the expiry shockwave.
 *
 * Painting lives in `protectiveShellArt.ts`; this module is the cell geometry,
 * the frame counts and the choreography — which parameter each row sweeps, and
 * over what range — lifted from the generator that used to bake these sheets.
 *
 * The cells and anchors are the numbers the sheets were baked with rather than
 * a rule these three happen to follow: their paddings differ (40, 32 and 16
 * pixels of clear space around the widest ring, before the haloes stacked
 * outside it), because each was sized to its own effect by hand.
 * `scripts/gates-protective-shell.ts` re-measures the ink against each declared
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
  type ShellVariant,
  drawProtectiveShellActive,
  drawProtectiveShellAppear,
  drawProtectiveShellExpire,
  drawProtectiveShellMini,
  drawProtectiveShellShockwave,
} from './protectiveShellArt';

/**
 * Cell pixels per tile. These effects were baked at the game's own tile size,
 * so one cell pixel is one screen pixel at the default zoom.
 */
export const TILE_SCALE = 32;

/** Every row of every shell sheet is eight frames. */
export const SHELL_FRAME_COUNT = 8;

/**
 * The sweep the generator's `sweepRow` produced: frame 0 sits at 0 and the last
 * frame at 1, so a cycle's closing frame lands back on its opening one and a
 * one-shot's last frame is the end of the motion rather than a step short of it.
 */
export function sweepFraction(frame: number, frameCount: number): number {
  return frameCount === 1 ? 0 : frame / (frameCount - 1);
}

/** The rows the human's shell paints, and the variant each one is drawn in. */
export const SHELL_ACTIVE_STATE = 'active';
export const SHELL_FULL_POWER_STATE = 'full_power';
export const SHELL_APPEAR_STATE = 'appear';
export const SHELL_APPEAR_FULL_POWER_STATE = 'appear_full_power';
export const SHELL_EXPIRE_STATE = 'expire';

/** The cat mini-shield's one row. */
export const MINI_SHELL_STATE = 'active';

/** The shockwave's one row. */
export const SHOCKWAVE_STATE = 'expand';

/** A cell is scaled so its full width covers the effect's diameter. */
const CELL_SPANS_DIAMETER = 2;

const FIRST_FRAME = 0;
const LAST_FRAME = SHELL_FRAME_COUNT - 1;

const SHELL_CELL = 400;
const MINI_CELL = 192;
const SHOCKWAVE_CELL = 480;

type ShellRowPainter = (
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
    variant: ShellVariant,
    sweep: number,
  ) => void,
  variant: ShellVariant,
): ShellRowPainter {
  return (ctx, cx, cy, tilePx, sweep) => {
    paint(ctx, cx, cy, tilePx, variant, sweep);
  };
}

const SHELL_ROWS: ReadonlyMap<string, ShellRowPainter> = new Map([
  [SHELL_ACTIVE_STATE, variantPainter(drawProtectiveShellActive, 'standard')],
  [SHELL_FULL_POWER_STATE, variantPainter(drawProtectiveShellActive, 'full_power')],
  [SHELL_APPEAR_STATE, variantPainter(drawProtectiveShellAppear, 'standard')],
  [SHELL_APPEAR_FULL_POWER_STATE, variantPainter(drawProtectiveShellAppear, 'full_power')],
  [SHELL_EXPIRE_STATE, drawProtectiveShellExpire],
]);

/**
 * Builds a figure whose cell is square and whose anchor is its centre.
 *
 * The anchor is the shell's centre — the player's tile centre — and not a tile
 * corner, which is why `tileX` and `tileY` are half the cell rather than the
 * offset a standing creature would use.
 */
function centredFigure(
  id: string,
  cell: number,
  rows: ReadonlyMap<string, ShellRowPainter>,
): FigureDef {
  const anchor = cell / 2;
  const frameCounts: Record<string, number> = {};
  for (const state of rows.keys()) frameCounts[state] = SHELL_FRAME_COUNT;
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
      paint(ctx, anchor, anchor, TILE_SCALE, sweepFraction(frame, SHELL_FRAME_COUNT));
    },
  };
}

export const PROTECTIVE_SHELL_FIGURE = centredFigure('protective_shell', SHELL_CELL, SHELL_ROWS);

export const PROTECTIVE_SHELL_MINI_FIGURE = centredFigure(
  'protective_shell_mini',
  MINI_CELL,
  new Map([[MINI_SHELL_STATE, drawProtectiveShellMini]]),
);

export const PROTECTIVE_SHELL_SHOCKWAVE_FIGURE = centredFigure(
  'protective_shell_shockwave',
  SHOCKWAVE_CELL,
  new Map([[SHOCKWAVE_STATE, drawProtectiveShellShockwave]]),
);

/**
 * The `tileSize` at which a shell figure's whole cell spans `2 * radiusPx`.
 *
 * The cell, not the ring: every one of these cells is padded beyond the widest
 * ring painted into it, so the ring lands *inside* the gameplay radius by that
 * padding — the human's shell draws its border at four fifths of the radius it
 * actually pushes mobs out of. That is how the effect shipped, and scaling the
 * ring onto the radius instead would visibly grow all three of them.
 */
export function shellTileSizeFor(def: FigureDef, radiusPx: number): number {
  return (radiusPx * CELL_SPANS_DIAMETER * TILE_SCALE) / def.frameWidth;
}

/**
 * The frames that legitimately paint nothing at all.
 *
 * Three rows run their fade to a true zero rather than stopping just short of
 * it, because the sweep paints both endpoints: an appearing shell is invisible
 * on the frame it starts from, and an expiring shell and a spent shockwave are
 * invisible on the frame they end on. That is the shipped art, so the structural
 * gate is told to expect exactly these four cells and to fail on a blank cell
 * anywhere else — a frame that paints nothing is otherwise how a NaN in the
 * choreography looks.
 */
export const SHELL_BLANK_FRAMES: ReadonlyMap<
  string,
  ReadonlyMap<string, ReadonlySet<number>>
> = new Map([
  [
    PROTECTIVE_SHELL_FIGURE.id,
    new Map([
      [SHELL_APPEAR_STATE, new Set([FIRST_FRAME])],
      [SHELL_APPEAR_FULL_POWER_STATE, new Set([FIRST_FRAME])],
      [SHELL_EXPIRE_STATE, new Set([LAST_FRAME])],
    ]),
  ],
  [PROTECTIVE_SHELL_MINI_FIGURE.id, new Map()],
  [PROTECTIVE_SHELL_SHOCKWAVE_FIGURE.id, new Map([[SHOCKWAVE_STATE, new Set([LAST_FRAME])]])],
]);

/** All three shell figures, for the gates and the review harness. */
export const PROTECTIVE_SHELL_FIGURES: readonly FigureDef[] = [
  PROTECTIVE_SHELL_FIGURE,
  PROTECTIVE_SHELL_MINI_FIGURE,
  PROTECTIVE_SHELL_SHOCKWAVE_FIGURE,
];
