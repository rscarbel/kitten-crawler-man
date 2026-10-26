/**
 * The Hearthguard Cap on the human crawler: the garrison's padded wool arming
 * cap in its brown, quilted in ribs over his skull and coming down in flaps
 * over both ears, its face edge rolled in the garrison's oat linen. At the
 * tile it is a brown hood-like cap framing his face, the pale rolled edge
 * across his forehead and down his cheeks; from behind it covers the back of
 * his head to the nape.
 */

import type { CardinalView } from '../../facingView';
import { type FabricRamp, fabricFill } from '../cat/clothInk';
import { defineGarment } from '../garmentDef';
import {
  fillHatPath,
  hatUnits,
  hatViews,
  type PathCommand,
  strokeHatLine,
  traceHatPath,
  type Units,
} from './headwear';

type Ctx = CanvasRenderingContext2D;

/**
 * Garrison wool a shade more olive than the cat's cap: the cat's own brown is
 * the colour of his hair, and on him a cap that colour reads as hair.
 */
const GARRISON_WOOL: FabricRamp = {
  shadow: '#433b22',
  base: '#7b6c42',
  light: '#a8975f',
  edge: '#262010',
};
const BAND_LINEN = '#d8c8a0';
const SEAM = 'rgba(36,20,8,0.85)';
const SEAM_WIDTH = 0.016;
/**
 * The quilting is stitched in the band's linen thread: dark seams on brown wool
 * read as the partings of a head of brown hair at the tile, pale ones as a
 * padded cap.
 */
const STITCH = 'rgba(216,200,160,0.75)';
const STITCH_WIDTH = 0.022;
/** The rolled linen edge round his face, thick enough to stay a pixel wide at the tile. */
const BAND_WIDTH = 0.05;
const BAND_EDGE_WIDTH = 0.072;

/**
 * Head-on: the quilted dome over the crown, the flaps down over the ears to
 * the line of the jaw, and the face opening cut across the forehead well
 * clear of the brows.
 */
const CAP_FRONT: readonly PathCommand[] = [
  ['M', -1.14, 0.46],
  ['Q', -1.42, -1.78, 0, -1.76],
  ['Q', 1.42, -1.78, 1.14, 0.46],
  ['Q', 1.0, 0.62, 0.86, 0.46],
  ['L', 0.9, -0.34],
  ['Q', 0.74, -0.76, 0, -0.74],
  ['Q', -0.74, -0.76, -0.9, -0.34],
  ['L', -0.86, 0.46],
  ['Q', -1.0, 0.62, -1.14, 0.46],
];
/** The rolled edge head-on: down one flap, across the brow and down the other. */
const EDGE_FRONT: readonly number[] = [
  -0.86, 0.46, -0.9, -0.34, -0.66, -0.68, 0, -0.74, 0.66, -0.68, 0.9, -0.34, 0.86, 0.46,
];
/** The flaps' lower hems. */
const HEMS_FRONT: readonly (readonly number[])[] = [
  [-1.14, 0.46, -1.0, 0.56, -0.86, 0.46],
  [0.86, 0.46, 1.0, 0.56, 1.14, 0.46],
];
/** The quilting head-on: ribs from the brow edge up over the crown, and one across each flap. */
const SEAMS_FRONT: readonly (readonly number[])[] = [
  [0, -0.74, 0, -1.64],
  [-0.48, -0.74, -0.62, -1.2, -0.34, -1.6],
  [0.48, -0.74, 0.62, -1.2, 0.34, -1.6],
  [-1.14, -0.08, -0.9, -0.1],
  [0.9, -0.1, 1.14, -0.08],
];

/**
 * Edge-on: the dome from his brow back over the crown and down to the nape,
 * the flap hanging over his ear to the jaw, its front edge running up past
 * the sideburn to the temple.
 */
const CAP_SIDE: readonly PathCommand[] = [
  ['M', 0.86, -0.74],
  ['Q', 1.04, -1.86, -0.1, -1.82],
  ['Q', -1.42, -1.74, -1.28, -0.36],
  ['Q', -1.16, 0.3, -0.92, 0.52],
  ['Q', -0.4, 0.62, 0.16, 0.6],
  ['Q', 0.36, 0.54, 0.34, 0.3],
  ['L', 0.3, -0.24],
  ['Q', 0.5, -0.58, 0.86, -0.74],
];
const EDGE_SIDE: readonly number[] = [0.86, -0.74, 0.5, -0.58, 0.3, -0.24, 0.34, 0.3, 0.2, 0.58];
const HEM_SIDE: readonly number[] = [0.16, 0.6, -0.4, 0.62, -0.92, 0.52];
const SEAMS_SIDE: readonly (readonly number[])[] = [
  [0.86, -0.9, 0.2, -1.64],
  [0.5, -0.66, 0.1, -1.24, -0.6, -1.6],
  [0.3, -0.36, -0.4, -0.9, -1.12, -1.06],
  [0.3, 0, -0.4, -0.06, -1.18, -0.2],
];

/** From behind: the whole back of his head, down over the nape, the flaps' hems at its corners. */
const CAP_BACK: readonly PathCommand[] = [
  ['M', -1.18, 0.46],
  ['Q', -1.44, -1.78, 0, -1.76],
  ['Q', 1.44, -1.78, 1.18, 0.46],
  ['Q', 0, 0.82, -1.18, 0.46],
];
const HEM_BACK: readonly number[] = [-1.18, 0.46, -0.6, 0.64, 0, 0.68, 0.6, 0.64, 1.18, 0.46];
const SEAMS_BACK: readonly (readonly number[])[] = [
  [0, 0.66, 0, -1.64],
  [-0.56, 0.6, -0.66, -0.6, -0.36, -1.6],
  [0.56, 0.6, 0.66, -0.6, 0.36, -1.6],
  [-1.18, -0.1, 1.18, -0.1],
];

/** The wool's lit fill: the key light from the upper left, the shadow down and to the right. */
const LIGHT_FROM_X = -1.1;
const LIGHT_FROM_Y = -1.6;
const SHADOW_TO_X = 1.1;
const SHADOW_TO_Y = 0.6;

function woolFill(ctx: Ctx, units: Units): CanvasGradient {
  return fabricFill(
    ctx,
    GARRISON_WOOL,
    { x: LIGHT_FROM_X * units.x, y: LIGHT_FROM_Y * units.y },
    { x: SHADOW_TO_X * units.x, y: SHADOW_TO_Y * units.y },
  );
}

/** The quilting is stitched through the padding: each seam clipped to the cap, so it ends at its edge. */
function paintSeams(
  ctx: Ctx,
  units: Units,
  outline: readonly PathCommand[],
  seams: readonly (readonly number[])[],
): void {
  ctx.save();
  traceHatPath(ctx, outline, units);
  ctx.clip();
  for (const seam of seams) {
    strokeHatLine(ctx, seam, units, SEAM, STITCH_WIDTH + SEAM_WIDTH);
    strokeHatLine(ctx, seam, units, STITCH, STITCH_WIDTH);
  }
  ctx.restore();
}

/** The rolled edge: a dark wool line under a pale linen roll, so it holds on fair or dark skin. */
function paintRolledEdge(ctx: Ctx, units: Units, edge: readonly number[]): void {
  strokeHatLine(ctx, edge, units, GARRISON_WOOL.edge, BAND_EDGE_WIDTH);
  strokeHatLine(ctx, edge, units, BAND_LINEN, BAND_WIDTH);
}

function paintCap(
  ctx: Ctx,
  units: Units,
  outline: readonly PathCommand[],
  seams: readonly (readonly number[])[],
): void {
  fillHatPath(ctx, outline, units, woolFill(ctx, units));
  paintSeams(ctx, units, outline, seams);
}

function paintFront(ctx: Ctx, view: CardinalView): void {
  const units = hatUnits(view);
  paintCap(ctx, units, CAP_FRONT, SEAMS_FRONT);
  for (const hem of HEMS_FRONT) strokeHatLine(ctx, hem, units, GARRISON_WOOL.edge, SEAM_WIDTH);
  paintRolledEdge(ctx, units, EDGE_FRONT);
}

function paintSide(ctx: Ctx, view: CardinalView): void {
  const units = hatUnits(view);
  paintCap(ctx, units, CAP_SIDE, SEAMS_SIDE);
  strokeHatLine(ctx, HEM_SIDE, units, GARRISON_WOOL.edge, SEAM_WIDTH);
  paintRolledEdge(ctx, units, EDGE_SIDE);
}

function paintBack(ctx: Ctx, view: CardinalView): void {
  const units = hatUnits(view);
  paintCap(ctx, units, CAP_BACK, SEAMS_BACK);
  strokeHatLine(ctx, HEM_BACK, units, GARRISON_WOOL.edge, SEAM_WIDTH);
}

export const HEARTHGUARD_CAP = defineGarment({
  id: 'human_hearthguard_cap',
  name: 'Hearthguard Cap',
  wearer: 'human',
  material: 'cloth',
  layer: 'overcoat',
  region: ['head'],
  paint: { head: hatViews({ front: paintFront, side: paintSide, back: paintBack }) },
});
