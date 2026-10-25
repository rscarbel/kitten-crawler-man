/**
 * The Marching Boots on the cat crawler: four little hard-soled leather boots,
 * one on each paw, laced up the lower leg. The near-black sole is what parts
 * a boot from a dark paw at the tile, so it is drawn thick across the bottom
 * of every paw, with the hobnails catching the light along it.
 *
 * Painted over each paw as it is painted, clipped to the paw's own outline,
 * and up the lower leg in profile and the bottom of the leg column head-on,
 * so the shaft rises from the boot.
 */

import type { CatLegFrame } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import { clipToOutline, fabricFill, shadeOver, type FabricRamp } from './clothInk';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;

/**
 * A mid brown, well above the human's near-black boot: on a cat with black
 * paws a dark boot is no boot at all at the tile. The cuff is the pale rolled
 * top that marks where the boot ends up her leg.
 */
const BOOT_LEATHER: FabricRamp = {
  shadow: '#3e2c22',
  base: '#6a4c3a',
  light: '#97735c',
  edge: '#c9a27c',
};
const SOLE = '#120d0b';
const HOBNAIL = '#c8c7cc';
const HOBNAIL_RADIUS = 0.008;
const HOBNAIL_COUNT = 3;
/** The sole covers the paw below this share of its half-height under its centre. */
const SOLE_FROM = 0.6;
/** The shaft rises this share of a profile lower leg's length up from the paw, and of a head-on column's. */
const SHAFT_SHARE = 0.4;
const CUFF_WIDTH = 0.022;
/** Room past a piece's radii the fill and clips give, as a share of them. */
const SPREAD = 2;

function paintBoot(ctx: Ctx, frame: CatLegFrame): void {
  if (frame.piece !== 'paw') return;
  const { radiusX: rx, radiusY: ry, shade } = frame;
  ctx.save();
  clipToOutline(ctx, frame.envelope);
  ctx.fillStyle = fabricFill(ctx, BOOT_LEATHER, { x: -rx, y: -ry }, { x: rx, y: ry });
  ctx.fillRect(-rx * SPREAD, -ry * SPREAD, rx * SPREAD * 2, ry * SPREAD * 2);
  ctx.fillStyle = SOLE;
  ctx.fillRect(-rx * SPREAD, ry * SOLE_FROM, rx * SPREAD * 2, ry * SPREAD);
  shadeOver(ctx, shade, -rx * SPREAD, -ry * SPREAD, rx * SPREAD * 2, ry * SPREAD * 2);
  ctx.fillStyle = HOBNAIL;
  for (let nail = 0; nail < HOBNAIL_COUNT; nail++) {
    const x = rx * ((nail + 1) / (HOBNAIL_COUNT + 1) - 1 / 2) * SPREAD;
    ctx.beginPath();
    ctx.arc(x, ry * ((SOLE_FROM + 1) / 2), HOBNAIL_RADIUS, 0, FULL_TURN);
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The shaft over the bottom of the leg piece that ends at the paw, cuffed at
 * its top: a column, a lower leg, or a hock bone — never the shank above a
 * hock, or a hocked leg would wear two bands.
 */
function paintShaft(ctx: Ctx, frame: CatLegFrame): void {
  if (frame.piece === 'paw' || frame.piece === 'upper' || frame.piece === 'shank') return;
  const top = frame.length * (1 - SHAFT_SHARE);
  const half = frame.halfWidth * SPREAD;
  ctx.save();
  clipToOutline(ctx, frame.envelope);
  ctx.fillStyle = fabricFill(ctx, BOOT_LEATHER, { x: -half, y: top }, { x: half, y: frame.length });
  ctx.fillRect(-half, top, half * 2, frame.length * SPREAD);
  ctx.fillStyle = BOOT_LEATHER.edge;
  ctx.fillRect(-half, top, half * 2, CUFF_WIDTH);
  shadeOver(ctx, frame.shade, -half, top, half * 2, frame.length * SPREAD);
  ctx.restore();
}

function paintLeg(ctx: Ctx, frame: CatLegFrame): void {
  if (frame.piece === 'paw') paintBoot(ctx, frame);
  else paintShaft(ctx, frame);
}

const EVERY_VIEW = withViewFallback(
  { front: paintLeg, side: paintLeg, back: paintLeg },
  CAT_VIEW_FALLBACK,
);

export const CAT_BOOTS = defineGarment({
  id: 'cat_boots',
  name: 'Marching Boots',
  wearer: 'cat',
  material: 'leather',
  layer: 'outer',
  region: ['foreleg', 'hindleg'],
  paint: { foreleg: EVERY_VIEW, hindleg: EVERY_VIEW },
});
