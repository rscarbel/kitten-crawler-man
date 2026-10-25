/**
 * The Issue Kettle Helm on the cat crawler: the garrison's wide-brimmed iron pot, made
 * over for a cat. The dome has two rounded pockets her ears go up into, so it
 * hides her ears rather than having them poke through the iron; the brim
 * stands out past her cheek ruffs and shades her brow, and a leather strap
 * runs down under her chin. Somebody else's dent is still in the crown.
 *
 * Painted once the whole head is on. At her in-game size the helm is the
 * biggest thing on her head, so its read is the silhouette — a broad brim
 * under a dome with two ear bumps — in hard-banded iron.
 */

import type { CatHeadFrame, CatHeadLandmarks } from '../../art/catParts';
import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, type GarmentFrameContext, withViewFallback } from '../garmentDef';
import { fitHatToSkull, type HatFit, hatFitFor, lyingTipBack } from './headwear';
import { IRON, metalFill, type MetalRamp } from './metalInk';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;
const HALF_TURN = Math.PI;

const STRAP = '#6b4423';
const STRAP_WIDTH = 0.022;
const DENT_SHADOW = '#22262b';
const DENT_ALPHA = 0.75;
const BRIM_UNDERSIDE = '#1b1e22';
const RIM_LIGHT_WIDTH = 0.014;
/**
 * The dome's crown catches the key light from its left shoulder to just past
 * its top, as radians in from either end of its upper half: the line that
 * keeps it apart from her dark fur from behind.
 */
const DOME_RIM_FROM = 0.35;
const DOME_RIM_TO = 1.2;

/** Head-on, in head units, measured from the top of her skull. */
const BRIM_DROP = 0.13;
const BRIM_HALF_WIDTH = 0.31;
const BRIM_HALF_DEPTH = 0.06;
/** The brim's underside shows as a dark lip this thick below its rim. */
const BRIM_LIP = 0.025;
const DOME_HALF_WIDTH = 0.225;
const DOME_HEIGHT = 0.17;
/** The ear pockets, either side of the dome's top. */
const POCKET_SPREAD = 0.11;
const POCKET_RISE = 0.125;
const POCKET_HALF_WIDTH = 0.07;
const POCKET_HEIGHT = 0.06;
/** The dent, up on the dome toward the light. */
const DENT_X = -0.07;
const DENT_RISE = 0.11;
const DENT_RADIUS_X = 0.04;
const DENT_RADIUS_Y = 0.025;
const DENT_TILT = -0.4;
/** The strap leaves the brim at its sides and meets under her chin. */
const STRAP_OUT = 0.21;
const STRAP_CHIN_Y = 0.17;
const STRAP_SAG = 0.06;
/** How far a turned head slides the helm across the skull, head-on. */
const TURN_SLIDE = 0.04;

/** In profile: the brim seen nearly edge-on, the dome sitting back over her skull. */
const PROFILE_BRIM_HALF_WIDTH = 0.26;
const PROFILE_BRIM_HALF_DEPTH = 0.035;
const PROFILE_BRIM_BACK = 0.02;
const PROFILE_DOME_HALF_WIDTH = 0.19;
const PROFILE_DOME_BACK = 0.03;
/** The near ear pocket, and the far one peeking behind it. */
const PROFILE_NEAR_POCKET_X = -0.05;
const PROFILE_FAR_POCKET_X = -0.13;
const PROFILE_FAR_POCKET_DROP = 0.02;
const PROFILE_STRAP_X = 0.02;
const PROFILE_STRAP_CHIN: { readonly x: number; readonly y: number } = { x: 0.06, y: 0.12 };
/** The brim tips forward over her brow, the way a pot helm rides on a sloped head. */
const PROFILE_TILT = 0.08;
/** In profile the brim rides higher than head-on, clear of the near eye. */
const PROFILE_BRIM_LIFT = 0.04;

interface HelmLook {
  readonly cx: number;
  readonly brimY: number;
  readonly brimHalfWidth: number;
  readonly brimHalfDepth: number;
  readonly domeCx: number;
  readonly domeHalfWidth: number;
  /** Ear pockets as x offsets from the dome's centre, with how far each sits down; far ones first. */
  readonly pockets: readonly {
    readonly dx: number;
    readonly drop: number;
    readonly far: boolean;
  }[];
  readonly metal: MetalRamp;
}

function domePath(ctx: Ctx, look: HelmLook): void {
  ctx.beginPath();
  ctx.ellipse(look.domeCx, look.brimY, look.domeHalfWidth, DOME_HEIGHT, 0, HALF_TURN, FULL_TURN);
  ctx.closePath();
}

function paintPocket(ctx: Ctx, look: HelmLook, dx: number, drop: number, shaded: boolean): void {
  const x = look.domeCx + dx;
  const y = look.brimY - POCKET_RISE + drop;
  ctx.beginPath();
  ctx.ellipse(x, y, POCKET_HALF_WIDTH, POCKET_HEIGHT, 0, 0, FULL_TURN);
  ctx.fillStyle = shaded
    ? look.metal.shadow
    : metalFill(
        ctx,
        look.metal,
        x - POCKET_HALF_WIDTH,
        y - POCKET_HEIGHT,
        x + POCKET_HALF_WIDTH,
        y,
      );
  ctx.fill();
}

function paintBrim(ctx: Ctx, look: HelmLook): void {
  const { cx, brimY, brimHalfWidth, brimHalfDepth, metal } = look;
  ctx.beginPath();
  ctx.ellipse(cx, brimY + BRIM_LIP, brimHalfWidth, brimHalfDepth, 0, 0, FULL_TURN);
  ctx.fillStyle = BRIM_UNDERSIDE;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(cx, brimY, brimHalfWidth, brimHalfDepth, 0, 0, FULL_TURN);
  ctx.fillStyle = metalFill(
    ctx,
    metal,
    cx - brimHalfWidth,
    brimY - brimHalfDepth,
    cx + brimHalfWidth,
    brimY + brimHalfDepth,
  );
  ctx.fill();
}

function paintHelm(ctx: Ctx, look: HelmLook): void {
  const { metal } = look;
  for (const pocket of look.pockets) {
    if (pocket.far) paintPocket(ctx, look, pocket.dx, pocket.drop, true);
  }
  paintBrim(ctx, look);
  domePath(ctx, look);
  ctx.fillStyle = metalFill(
    ctx,
    metal,
    look.domeCx - look.domeHalfWidth,
    look.brimY - DOME_HEIGHT,
    look.domeCx + look.domeHalfWidth,
    look.brimY,
  );
  ctx.fill();
  for (const pocket of look.pockets) {
    if (!pocket.far) paintPocket(ctx, look, pocket.dx, pocket.drop, false);
  }

  ctx.beginPath();
  ctx.ellipse(
    look.domeCx,
    look.brimY,
    look.domeHalfWidth,
    DOME_HEIGHT,
    0,
    HALF_TURN + DOME_RIM_FROM,
    FULL_TURN - DOME_RIM_TO,
  );
  ctx.strokeStyle = metal.light;
  ctx.lineWidth = RIM_LIGHT_WIDTH;
  ctx.stroke();

  // The rim of the brim catches the key light along its front edge.
  ctx.beginPath();
  ctx.ellipse(look.cx, look.brimY, look.brimHalfWidth, look.brimHalfDepth, 0, 0, HALF_TURN);
  ctx.strokeStyle = metal.light;
  ctx.lineWidth = RIM_LIGHT_WIDTH;
  ctx.stroke();

  ctx.save();
  ctx.translate(look.domeCx + DENT_X, look.brimY - DENT_RISE);
  ctx.rotate(DENT_TILT);
  ctx.beginPath();
  ctx.ellipse(0, 0, DENT_RADIUS_X, DENT_RADIUS_Y, 0, 0, FULL_TURN);
  ctx.globalAlpha = DENT_ALPHA;
  ctx.fillStyle = DENT_SHADOW;
  ctx.fill();
  ctx.restore();
}

/** The brim's height in the fitted frame, from the fitted skull's top. */
function brimYOf(fit: HatFit): number {
  return fit.skullTop + BRIM_DROP;
}

function strokeStrap(
  ctx: Ctx,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
  sag: number,
): void {
  ctx.beginPath();
  ctx.moveTo(fromX, fromY);
  ctx.quadraticCurveTo((fromX + toX) / 2 - sag, (fromY + toY) / 2, toX, toY);
  ctx.strokeStyle = STRAP;
  ctx.lineWidth = STRAP_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
}

function headOnLook(landmarks: CatHeadLandmarks, fit: HatFit): HelmLook {
  const cx = landmarks.skull.cx + landmarks.turn * TURN_SLIDE;
  return {
    cx,
    brimY: brimYOf(fit),
    brimHalfWidth: BRIM_HALF_WIDTH,
    brimHalfDepth: BRIM_HALF_DEPTH,
    domeCx: cx,
    domeHalfWidth: DOME_HALF_WIDTH,
    pockets: [
      { dx: -POCKET_SPREAD, drop: 0, far: false },
      { dx: POCKET_SPREAD, drop: 0, far: false },
    ],
    metal: IRON,
  };
}

function paintFront(ctx: Ctx, frame: CatHeadFrame): void {
  if (frame.piece !== 'top') return;
  const fit = hatFitFor(frame.landmarks, 'headOn');
  const look = headOnLook(frame.landmarks, fit);
  ctx.save();
  fitHatToSkull(ctx, frame.landmarks, fit);
  for (const side of [-1, 1]) {
    strokeStrap(
      ctx,
      look.cx + side * STRAP_OUT,
      look.brimY,
      look.cx,
      STRAP_CHIN_Y,
      side * STRAP_SAG,
    );
  }
  paintHelm(ctx, look);
  ctx.restore();
}

function paintBack(ctx: Ctx, frame: CatHeadFrame): void {
  if (frame.piece !== 'top') return;
  const fit = hatFitFor(frame.landmarks, 'headOn');
  const look = headOnLook(frame.landmarks, fit);
  ctx.save();
  fitHatToSkull(ctx, frame.landmarks, fit);
  paintHelm(ctx, look);
  ctx.restore();
}

function paintSide(ctx: Ctx, frame: CatHeadFrame, context: GarmentFrameContext<'cat'>): void {
  if (frame.piece !== 'top') return;
  const { landmarks } = frame;
  const fit = hatFitFor(landmarks, 'profile');
  const brimY = brimYOf(fit) - PROFILE_BRIM_LIFT;
  const cx = landmarks.skull.cx - PROFILE_BRIM_BACK;
  const look: HelmLook = {
    cx,
    brimY,
    brimHalfWidth: PROFILE_BRIM_HALF_WIDTH,
    brimHalfDepth: PROFILE_BRIM_HALF_DEPTH,
    domeCx: landmarks.skull.cx - PROFILE_DOME_BACK,
    domeHalfWidth: PROFILE_DOME_HALF_WIDTH,
    pockets: [
      { dx: PROFILE_FAR_POCKET_X + PROFILE_DOME_BACK, drop: PROFILE_FAR_POCKET_DROP, far: true },
      { dx: PROFILE_NEAR_POCKET_X + PROFILE_DOME_BACK, drop: 0, far: false },
    ],
    metal: IRON,
  };
  ctx.save();
  fitHatToSkull(ctx, landmarks, fit);
  strokeStrap(ctx, PROFILE_STRAP_X, brimY, PROFILE_STRAP_CHIN.x, PROFILE_STRAP_CHIN.y, 0);
  ctx.translate(cx, brimY);
  ctx.rotate(PROFILE_TILT - lyingTipBack(context));
  ctx.translate(-cx, -brimY);
  paintHelm(ctx, look);
  ctx.restore();
}

export const CAT_KETTLE_HELM = defineGarment({
  id: 'cat_kettle_helm',
  name: 'Issue Kettle Helm',
  wearer: 'cat',
  material: 'metal',
  layer: 'outer',
  region: ['head'],
  hides: [{ kind: 'feature', feature: 'ears' }],
  paint: {
    head: withViewFallback(
      { front: paintFront, side: paintSide, back: paintBack },
      CAT_VIEW_FALLBACK,
    ),
  },
});
