/**
 * The Padded Gambeson on the cat crawler: twenty layers of unbleached linen
 * quilted flat and cut like a dog's coat, over her chest and back down to
 * her hips, its padding ridged into channels by the quilting seams and tied
 * down the front of her chest. At the tile it is a pale tan saddle over her
 * dark coat, striped by its seams.
 */

import type { CatEllipse } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import type { CardinalView } from '../../facingView';
import { defineGarment, withViewFallback } from '../garmentDef';
import type { FabricRamp } from './clothInk';
import { torsoCoverPainters } from './torsoCover';

type Ctx = CanvasRenderingContext2D;

/** The human's linen, as a cat's coat: a pale tan well above her coat's value. */
const LINEN: FabricRamp = {
  shadow: '#8f7f5e',
  base: '#d3c39e',
  light: '#efe3c4',
  edge: '#6f5f42',
};
const SEAM = 'rgba(96,78,48,0.75)';
const SEAM_WIDTH = 0.014;
/** The quilting channels' width, as a share of the piece's half-width. */
const CHANNEL_STEP = 0.36;
const TIE = '#4a3322';
const TIE_WIDTH = 0.018;
/** Head-on, the ties down her chest: how many, and how far apart as a share of its half-height. */
const TIE_COUNT = 3;
const TIE_STEP = 0.34;
const TIE_HALF_LENGTH = 0.025;
const HEM_WIDTH = 0.03;

/**
 * Seams run down her head-on and from behind, and across her barrel in
 * profile: the channels go round her body, front to back.
 */
function paintQuilting(ctx: Ctx, area: CatEllipse, view: CardinalView): void {
  ctx.strokeStyle = SEAM;
  ctx.lineWidth = SEAM_WIDTH;
  for (let offset = -area.rx; offset <= area.rx; offset += area.rx * CHANNEL_STEP) {
    ctx.beginPath();
    ctx.moveTo(area.cx + offset, area.cy - area.ry);
    ctx.lineTo(area.cx + offset, area.cy + area.ry);
    ctx.stroke();
  }
  if (view !== 'front') return;
  ctx.strokeStyle = TIE;
  ctx.lineWidth = TIE_WIDTH;
  ctx.lineCap = 'round';
  for (let tie = 0; tie < TIE_COUNT; tie++) {
    const y = area.cy - area.ry * TIE_STEP + tie * area.ry * TIE_STEP;
    ctx.beginPath();
    ctx.moveTo(area.cx - TIE_HALF_LENGTH, y);
    ctx.lineTo(area.cx + TIE_HALF_LENGTH, y);
    ctx.stroke();
  }
}

export const CAT_GAMBESON = defineGarment({
  id: 'cat_gambeson',
  name: 'Padded Gambeson',
  wearer: 'cat',
  material: 'cloth',
  layer: 'over',
  region: ['body'],
  paint: {
    body: withViewFallback(
      torsoCoverPainters({ fabric: LINEN, hemWidth: HEM_WIDTH, detail: paintQuilting }),
      CAT_VIEW_FALLBACK,
    ),
  },
});
