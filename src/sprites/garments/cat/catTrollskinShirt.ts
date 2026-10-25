/**
 * The Enchanted Trollskin Shirt of Pummeling on the cat crawler: a close knit
 * of dark navy cut like a dog's coat, over her chest and back down to her
 * hips. At the tile it is a cool blue patch over her warm coat; a few lighter
 * ribs of knit catch the light so it reads as cloth, not shadow.
 */

import type { CatEllipse } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import type { CardinalView } from '../../facingView';
import { defineGarment, withViewFallback } from '../garmentDef';
import type { FabricRamp } from './clothInk';
import { torsoCoverPainters } from './torsoCover';

type Ctx = CanvasRenderingContext2D;

/** The human's shirt navy, lit a step brighter: any darker sinks into a black coat at the tile. */
const TROLLSKIN: FabricRamp = {
  shadow: '#151a2a',
  base: '#26304f',
  light: '#44558a',
  edge: '#0e1220',
};
const RIB = 'rgba(120,140,200,0.35)';
const RIB_WIDTH = 0.012;
/** The knit's ribs run round her, this far apart, as shares of the piece's half-height. */
const RIB_STEP = 0.32;
const HEM_WIDTH = 0.026;

/** Ribs across the piece head-on and from behind, down it in profile, the way a knit rings a body. */
function paintRibs(ctx: Ctx, area: CatEllipse, view: CardinalView): void {
  ctx.strokeStyle = RIB;
  ctx.lineWidth = RIB_WIDTH;
  const across = view !== 'side';
  const reach = across ? area.ry : area.rx;
  for (let offset = -reach; offset <= reach; offset += reach * RIB_STEP) {
    ctx.beginPath();
    if (across) {
      ctx.moveTo(area.cx - area.rx, area.cy + offset);
      ctx.lineTo(area.cx + area.rx, area.cy + offset);
    } else {
      ctx.moveTo(area.cx + offset, area.cy - area.ry);
      ctx.lineTo(area.cx + offset, area.cy + area.ry);
    }
    ctx.stroke();
  }
}

export const CAT_TROLLSKIN_SHIRT = defineGarment({
  id: 'cat_trollskin_shirt',
  name: 'Enchanted Trollskin Shirt of Pummeling',
  wearer: 'cat',
  material: 'cloth',
  layer: 'over',
  region: ['body'],
  paint: {
    body: withViewFallback(
      torsoCoverPainters({ fabric: TROLLSKIN, hemWidth: HEM_WIDTH, detail: paintRibs }),
      CAT_VIEW_FALLBACK,
    ),
  },
});
