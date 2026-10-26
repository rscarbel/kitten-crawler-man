/**
 * The Hearthguard Quilted Vest on the cat crawler: the garrison's linen
 * quilted flat in diamonds and cut like a dog's coat, over her chest and back
 * down to her hips, bound at the hem in the garrison's brown. At the tile it is
 * a pale oat saddle over her coat, its stitching a faint lattice.
 */

import type { CatEllipse } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import type { FabricRamp } from './clothInk';
import { torsoCoverPainters } from './torsoCover';

type Ctx = CanvasRenderingContext2D;

/** Oat linen, well above either coat's value so the saddle reads on a black cat and a ginger one. */
const QUILTED_LINEN: FabricRamp = {
  shadow: '#8a7a5a',
  base: '#cdbd96',
  light: '#ece0c0',
  edge: '#5a3e26',
};
const STITCH = 'rgba(90,70,44,0.7)';
const STITCH_WIDTH = 0.012;
/** The quilting's diamond pitch, as a share of the piece's half-width. */
const DIAMOND_STEP = 0.5;
/** The hem binding is the garrison's brown, wide enough to frame the saddle at the tile. */
const HEM_WIDTH = 0.034;

/** Two families of diagonal seams crossing into the diamonds of flat quilting. */
function paintDiamondQuilting(ctx: Ctx, area: CatEllipse): void {
  const step = area.rx * DIAMOND_STEP;
  const reach = area.rx + area.ry;
  ctx.strokeStyle = STITCH;
  ctx.lineWidth = STITCH_WIDTH;
  for (let offset = -reach; offset <= reach; offset += step) {
    for (const slope of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(area.cx + offset - slope * area.ry, area.cy - area.ry);
      ctx.lineTo(area.cx + offset + slope * area.ry, area.cy + area.ry);
      ctx.stroke();
    }
  }
}

export const CAT_HEARTHGUARD_QUILTED_VEST = defineGarment({
  id: 'cat_hearthguard_quilted_vest',
  name: 'Hearthguard Quilted Vest',
  wearer: 'cat',
  material: 'cloth',
  layer: 'over',
  region: ['body'],
  paint: {
    body: withViewFallback(
      torsoCoverPainters({
        fabric: QUILTED_LINEN,
        hemWidth: HEM_WIDTH,
        detail: paintDiamondQuilting,
      }),
      CAT_VIEW_FALLBACK,
    ),
  },
});
