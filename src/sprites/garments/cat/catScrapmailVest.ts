/**
 * The Scrapmail Vest on the cat crawler: bottle caps, can lids and washers
 * wired together in overlapping rows like scales, cut as a short dog's vest
 * over her chest and shoulders. At the tile it is a speckled tin saddle,
 * dotted red, blue and yellow by the painted caps, ending well forward of
 * her haunches.
 */

import type { CatEllipse } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import type { FabricRamp } from './clothInk';
import { IRON, SILVER, metalFill, paintGlint, type MetalRamp } from './metalInk';
import { torsoCoverPainters } from './torsoCover';

type Ctx = CanvasRenderingContext2D;

/** The tin and wire the caps are strung on, showing between them. */
const WIRED_TIN: FabricRamp = {
  shadow: IRON.shadow,
  base: IRON.base,
  light: IRON.light,
  edge: '#16181c',
};

/** Painted bottle caps: each a saturated face with a dark crimped rim. */
const CAP_RED: MetalRamp = {
  shadow: '#4a0c0c',
  base: '#d83a2c',
  light: '#ff8a70',
  glint: '#fff0e8',
};
const CAP_BLUE: MetalRamp = {
  shadow: '#0c1e4a',
  base: '#3a72d8',
  light: '#8ab8ff',
  glint: '#eef6ff',
};
const CAP_YELLOW: MetalRamp = {
  shadow: '#4a3a06',
  base: '#f0c832',
  light: '#fff09a',
  glint: '#fffdf0',
};
/** The cycle the caps run through: tin lids and washers between the painted ones. */
const CAP_CYCLE: readonly MetalRamp[] = [
  SILVER,
  CAP_RED,
  IRON,
  SILVER,
  IRON,
  SILVER,
  CAP_BLUE,
  IRON,
  SILVER,
  CAP_YELLOW,
];
/** Steps through the cycle per column and per row, coprime to its length so no colour lines up. */
const CYCLE_STEP_COLUMN = 1;
const CYCLE_STEP_ROW = 3;

const CAP_RADIUS = 0.044;
const CAP_RIM = 0.012;
/** Rows overlap like scales: each row sits this far below the last, its caps this far apart. */
const ROW_STEP = 0.062;
const COLUMN_STEP = 0.08;
/** A cap's lit face sits up and to the left of its centre, toward the key light. */
const CAP_LIGHT_OFFSET = 0.35;
const CAP_GLINT_REACH = 0.7;
const FULL_TURN = Math.PI * 2;
const HEM_WIDTH = 0.03;

/** A vest, not a coat: shorter than a dog's coat in every view. */
const VEST_FRONT_HEM = 0.35;
const VEST_BACK_HEM = 0.3;
const VEST_PROFILE_BACK_EDGE = -0.2;

/** A cap in hard metal bands, lit on its upper left; the bare tin and washers catch a glint. */
function paintCap(ctx: Ctx, metal: MetalRamp, x: number, y: number): void {
  ctx.beginPath();
  ctx.arc(x, y, CAP_RADIUS, 0, FULL_TURN);
  ctx.fillStyle = metalFill(
    ctx,
    metal,
    x - CAP_RADIUS,
    y - CAP_RADIUS,
    x + CAP_RADIUS,
    y + CAP_RADIUS,
  );
  ctx.fill();
  ctx.strokeStyle = WIRED_TIN.edge;
  ctx.lineWidth = CAP_RIM;
  ctx.stroke();
  if (metal !== SILVER) return;
  paintGlint(
    ctx,
    metal,
    x - CAP_RADIUS * CAP_LIGHT_OFFSET,
    y - CAP_RADIUS * CAP_LIGHT_OFFSET,
    CAP_RADIUS * CAP_GLINT_REACH,
  );
}

/** Rows of caps from the top of `area` down, each row offset half a cap and lapping over the one above. */
function paintCaps(ctx: Ctx, area: CatEllipse): void {
  const left = area.cx - area.rx;
  const top = area.cy - area.ry;
  const rows = Math.ceil((area.ry * 2) / ROW_STEP) + 1;
  const columns = Math.ceil((area.rx * 2) / COLUMN_STEP) + 2;
  for (let row = 0; row < rows; row++) {
    const offset = row % 2 === 0 ? 0 : COLUMN_STEP / 2;
    for (let column = -1; column < columns; column++) {
      const cycleAt = column * CYCLE_STEP_COLUMN + row * CYCLE_STEP_ROW;
      const wrapped = ((cycleAt % CAP_CYCLE.length) + CAP_CYCLE.length) % CAP_CYCLE.length;
      const metal = CAP_CYCLE[wrapped] ?? SILVER;
      paintCap(ctx, metal, left + column * COLUMN_STEP + offset, top + row * ROW_STEP);
    }
  }
}

export const CAT_SCRAPMAIL_VEST = defineGarment({
  id: 'cat_scrapmail_vest',
  name: 'Scrapmail Vest',
  wearer: 'cat',
  material: 'metal',
  layer: 'over',
  region: ['body'],
  paint: {
    body: withViewFallback(
      torsoCoverPainters({
        fabric: WIRED_TIN,
        hemWidth: HEM_WIDTH,
        detail: paintCaps,
        cut: {
          frontHem: VEST_FRONT_HEM,
          backHem: VEST_BACK_HEM,
          profileBackEdge: VEST_PROFILE_BACK_EDGE,
        },
      }),
      CAT_VIEW_FALLBACK,
    ),
  },
});
