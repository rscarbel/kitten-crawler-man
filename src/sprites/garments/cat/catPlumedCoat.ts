/**
 * The Plumed Coat on the cat crawler: a light coat of bottle-green suede cut
 * long, like a dog's coat, from her chest back over her flank to a hem above
 * her haunch and bound in tan, with a crest of copper rooster hackles
 * standing along her spine and leaning toward her tail. The crest is what
 * names it: in profile it rises off her topline, from behind it fans either
 * side of her spine; head-on her head hides her back and only the coat's
 * green front and its binding show.
 *
 * Green because the hackles are copper and both her coats are warm: a red or
 * brown coat would swallow the crest, and the cock's own tail is green-black.
 */

import type { CatBodyFrame, CatEllipse } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import type { CardinalView } from '../../facingView';
import { defineGarment, withViewFallback } from '../garmentDef';
import { fabricFill, strokeCurve, type FabricRamp } from './clothInk';
import { torsoCoverPainters } from './torsoCover';

type Ctx = CanvasRenderingContext2D;
type Pt = { readonly x: number; readonly y: number };

/** Lifted well above her black and cooled away from her ginger, so the coat is a shape on either cat. */
const BOTTLE_GREEN_SUEDE: FabricRamp = {
  shadow: '#123a2c',
  base: '#2f7a5a',
  light: '#5fb08a',
  edge: '#d9b680',
};
/** The tan binding at its hems, the line that says a coat ends there. */
const HEM_WIDTH = 0.036;
/** Suede's nap shows as a few soft seams running round her, down the coat's panels. */
const PANEL_SEAM = 'rgba(10,40,28,0.55)';
const PANEL_SEAM_WIDTH = 0.012;
const PANEL_STEP = 0.6;
/**
 * Cut longer than the quilted coat: from behind it reaches down over her rump,
 * in profile back over her flank to above her haunch — a coat, not a vest.
 */
const PLUMED_CUT = { backHem: 0.6, profileBackEdge: -0.55 } as const;

/** Copper rooster hackles, bright at the tip where the light catches the barbs. */
const COPPER_FEATHER: FabricRamp = {
  shadow: '#5a1206',
  base: '#d2621f',
  light: '#ffc480',
  edge: '#1a0602',
};
const QUILL_WIDTH = 0.01;
const FEATHER_LENGTH = 0.18;
const FEATHER_HALF_WIDTH = 0.026;
/** The vane is widest this share of the way out from the root. */
const FEATHER_WIDEST = 0.45;
const FEATHER_OUTLINE_WIDTH = 0.016;
/** A feather's root sits this far inside her topline, so the quill is tucked under the strap. */
const FEATHER_ROOT_INSET = 0.05;

/** In profile: how many feathers stand along her back, and over what share of the barrel's half-length. */
const PROFILE_FEATHERS = 6;
const PROFILE_CREST_SPAN = 0.45;
/** The crest stands back from upright toward her tail, the way a rooster's hackles lie. */
const PROFILE_FEATHER_LEAN = 1.25;

/** From behind: how many feathers fan off her spine, from the top of her back down. */
const BACK_FEATHERS = 4;
/** The crest runs from this share of the barrel's half-height above its middle to that share below. */
const BACK_CREST_SPAN = 0.5;
/** Each feather fans this far out from straight up, alternating sides. */
const BACK_FEATHER_FAN = 0.7;

/** One feather from `root`, its quill pointing along `angle` (0 straight up, positive toward screen right). */
function paintFeather(ctx: Ctx, root: Pt, angle: number): void {
  ctx.save();
  ctx.translate(root.x, root.y);
  ctx.rotate(angle);
  const widest = -FEATHER_LENGTH * FEATHER_WIDEST;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(FEATHER_HALF_WIDTH * 2, widest, 0, -FEATHER_LENGTH);
  ctx.quadraticCurveTo(-FEATHER_HALF_WIDTH * 2, widest, 0, 0);
  ctx.closePath();
  ctx.fillStyle = fabricFill(ctx, COPPER_FEATHER, { x: 0, y: -FEATHER_LENGTH }, { x: 0, y: 0 });
  ctx.fill();
  ctx.strokeStyle = COPPER_FEATHER.edge;
  ctx.lineWidth = FEATHER_OUTLINE_WIDTH;
  ctx.stroke();
  strokeCurve(
    ctx,
    { x: 0, y: 0 },
    { x: 0, y: widest },
    { x: 0, y: -FEATHER_LENGTH },
    COPPER_FEATHER.shadow,
    QUILL_WIDTH,
  );
  ctx.restore();
}

/** The top of `area` at `x`: where her topline runs over the ellipse. */
function toplineAt(area: CatEllipse, x: number): number {
  const along = (x - area.cx) / area.rx;
  return area.cy - area.ry * Math.sqrt(Math.max(0, 1 - along * along));
}

function paintPanelSeams(ctx: Ctx, area: CatEllipse, view: CardinalView): void {
  if (view === 'front') return;
  ctx.strokeStyle = PANEL_SEAM;
  ctx.lineWidth = PANEL_SEAM_WIDTH;
  for (let offset = -area.rx; offset <= area.rx; offset += area.rx * PANEL_STEP) {
    ctx.beginPath();
    ctx.moveTo(area.cx + offset, area.cy - area.ry);
    ctx.lineTo(area.cx + offset, area.cy + area.ry);
    ctx.stroke();
  }
}

const COAT = torsoCoverPainters({
  fabric: BOTTLE_GREEN_SUEDE,
  hemWidth: HEM_WIDTH,
  detail: paintPanelSeams,
  cut: PLUMED_CUT,
});

function paintSide(ctx: Ctx, frame: CatBodyFrame): void {
  COAT.side(ctx, frame);
  if (frame.piece !== 'barrel') return;
  const { shape } = frame;
  for (let feather = PROFILE_FEATHERS - 1; feather >= 0; feather--) {
    const along = (feather / (PROFILE_FEATHERS - 1)) * 2 - 1;
    const x = shape.cx + along * shape.rx * PROFILE_CREST_SPAN;
    paintFeather(ctx, { x, y: toplineAt(shape, x) + FEATHER_ROOT_INSET }, -PROFILE_FEATHER_LEAN);
  }
}

function paintBack(ctx: Ctx, frame: CatBodyFrame): void {
  COAT.back(ctx, frame);
  if (frame.piece !== 'barrel') return;
  const { shape } = frame;
  for (let feather = BACK_FEATHERS - 1; feather >= 0; feather--) {
    const down = (feather / (BACK_FEATHERS - 1)) * 2 - 1;
    const side = feather % 2 === 0 ? -1 : 1;
    paintFeather(
      ctx,
      { x: shape.cx, y: shape.cy + down * shape.ry * BACK_CREST_SPAN },
      side * BACK_FEATHER_FAN,
    );
  }
}

export const CAT_PLUMED_COAT = defineGarment({
  id: 'cat_plumed_coat',
  name: 'Plumed Coat',
  wearer: 'cat',
  material: 'leather',
  layer: 'outer',
  region: ['body'],
  paint: {
    body: withViewFallback(
      { front: COAT.front, side: paintSide, back: paintBack },
      CAT_VIEW_FALLBACK,
    ),
  },
});
