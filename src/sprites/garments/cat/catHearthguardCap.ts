/**
 * The Hearthguard Cap on the cat crawler: the garrison's padded wool cap in
 * its brown, a low quilted dome over the top of her skull with a rolled band
 * round its edge and her ears up through holes either side. At the tile it is
 * a brown dome capping her head, ribbed by its padding seams.
 */

import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import { type FabricRamp, fabricFill } from './clothInk';
import { type HatSeat, hatPainters } from './headwear';

type Ctx = CanvasRenderingContext2D;

const HALF_TURN = Math.PI;
const FULL_TURN = Math.PI * 2;

/**
 * Garrison brown, a cool, deep brown: lighter than a black coat and darker
 * and duller than a ginger one, so the dome holds on either.
 */
const GARRISON_WOOL: FabricRamp = {
  shadow: '#2e1e12',
  base: '#5a3c26',
  light: '#86603e',
  edge: '#24160a',
};
/** The rolled band is the garrison's oat linen, the light rim that frames the dome on any coat. */
const BAND_LINEN = '#d8c8a0';
/** The padding seams are sewn in the band's linen thread, so the quilting shows as ribs at the tile. */
const SEAM = 'rgba(216,200,160,0.75)';
const SEAM_WIDTH = 0.02;

/** The rolled band sits this far below the top of her skull, round her head at the ear roots. */
const BAND_DROP = 0.11;
const DOME_HALF_WIDTH = 0.23;
const DOME_HEIGHT = 0.19;
const BAND_HEIGHT = 0.055;
/** The band's front edge bows toward the camera. */
const BAND_SAG = 0.025;
/** The padding seams, as shares of the dome's half-width either side of its middle. */
const SEAMS = [-0.5, 0, 0.5] as const;
/** In profile the cap sits back on her skull, over the crown rather than the brow. */
const PROFILE_BACK = 0.04;
const PROFILE_HALF_WIDTH = 0.18;
const PROFILE_TILT = -0.1;
const TURN_SLIDE = 0.04;

function paintCap(ctx: Ctx, seat: HatSeat): void {
  const profile = seat.view === 'side';
  const cx = profile ? seat.cx - PROFILE_BACK : seat.cx;
  const halfWidth = profile ? PROFILE_HALF_WIDTH : DOME_HALF_WIDTH;
  const bandY = seat.skullTop + BAND_DROP;
  const top = bandY - DOME_HEIGHT;

  ctx.beginPath();
  ctx.ellipse(cx, bandY, halfWidth, DOME_HEIGHT, 0, HALF_TURN, FULL_TURN);
  ctx.quadraticCurveTo(cx, bandY + BAND_SAG * 2, cx - halfWidth, bandY);
  ctx.closePath();
  ctx.fillStyle = fabricFill(
    ctx,
    GARRISON_WOOL,
    { x: cx - halfWidth, y: top },
    { x: cx + halfWidth, y: bandY },
  );
  ctx.fill();

  ctx.save();
  ctx.clip();
  ctx.strokeStyle = SEAM;
  ctx.lineWidth = SEAM_WIDTH;
  for (const share of SEAMS) {
    const x = cx + share * halfWidth;
    ctx.beginPath();
    ctx.moveTo(cx + share * halfWidth * BAND_SAG, top);
    ctx.quadraticCurveTo(x, top + DOME_HEIGHT / 2, x, bandY + BAND_SAG);
    ctx.stroke();
  }
  ctx.restore();

  const bandTop = bandY - BAND_HEIGHT;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, bandTop);
  ctx.quadraticCurveTo(cx, bandTop + BAND_SAG * 2, cx + halfWidth, bandTop);
  ctx.lineTo(cx + halfWidth, bandY);
  ctx.quadraticCurveTo(cx, bandY + BAND_SAG * 2, cx - halfWidth, bandY);
  ctx.closePath();
  ctx.fillStyle = BAND_LINEN;
  ctx.fill();
  ctx.strokeStyle = GARRISON_WOOL.edge;
  ctx.lineWidth = SEAM_WIDTH;
  ctx.stroke();
}

export const CAT_HEARTHGUARD_CAP = defineGarment({
  id: 'cat_hearthguard_cap',
  name: 'Hearthguard Cap',
  wearer: 'cat',
  material: 'cloth',
  layer: 'overcoat',
  region: ['head'],
  paint: {
    head: withViewFallback(
      hatPainters({ paint: paintCap, turnSlide: TURN_SLIDE, profileTilt: PROFILE_TILT }),
      CAT_VIEW_FALLBACK,
    ),
  },
});
