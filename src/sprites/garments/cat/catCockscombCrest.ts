/**
 * The Cockscomb Crest on the cat crawler: a rooster's comb in red enamel,
 * lobed and serrated along its top, standing up fore-and-aft along the top of
 * her head on a small iron band: iron rather than gold, so it is never taken
 * for the Showman's gold-banded red top hat. In profile it is the whole fan of lobes; head-on
 * and from behind it is seen nearly edge-on, a narrow red fin with its lobes
 * stepping up its crest.
 */

import { CAT_VIEW_FALLBACK } from '../../catViews';
import { defineGarment, withViewFallback } from '../garmentDef';
import { type HatSeat, hatPainters } from './headwear';
import { IRON, type MetalRamp, metalFill, paintGlint } from './metalInk';

type Ctx = CanvasRenderingContext2D;

/** Rooster red as a hard-banded enamel, so it reads as a fired finish rather than flesh. */
const RED_ENAMEL: MetalRamp = {
  shadow: '#5c0810',
  base: '#d41c26',
  light: '#ff6e5e',
  glint: '#fff0ea',
};

/** The band crosses her skull this far below its top. */
const BAND_DROP = 0.025;
const BAND_HALF_WIDTH = 0.14;
const BAND_HEIGHT = 0.035;
const BAND_SAG = 0.02;
interface Lobe {
  /** Its place along the comb, as a share of the comb's half-length, + toward her brow. */
  readonly along: number;
  readonly height: number;
}

/**
 * The comb's points from her brow back over her crown, tallest in the middle
 * as on a single comb. The notches between them run deep: at the tile it is
 * the serration, not the colour, that keeps it from reading as a red cap.
 */
const PROFILE_LOBES: readonly Lobe[] = [
  { along: 0.75, height: 0.17 },
  { along: 0.05, height: 0.22 },
  { along: -0.7, height: 0.18 },
];
/** Head-on the comb is seen nearly end-on: three points stepping up its narrow fin. */
const HEAD_ON_LOBES: readonly Lobe[] = [
  { along: 0.8, height: 0.18 },
  { along: 0, height: 0.27 },
  { along: -0.8, height: 0.2 },
];
/** The comb's half-length in profile along her skull, and its half-width head-on. */
const PROFILE_HALF_LENGTH = 0.17;
const HEAD_ON_HALF_WIDTH = 0.06;
/** How far up its neighbours the notch between two points stops. */
const NOTCH_SHARE = 0.3;
/** The lobes are rounded off by a stroke this wide in the fill colour: fleshy, not spiked. */
const TIP_ROUNDING = 0.04;
/**
 * In profile the lobes lean back over her crown, as a rooster's do: upright
 * points with a band under them read as a crown.
 */
const PROFILE_LOBE_LEAN = 0.03;
/**
 * The band goes across her head, so in profile it is seen end-on: a short
 * foot under the comb. Run along the comb's whole length it read as a crown's rim.
 */
const PROFILE_BAND_HALF_WIDTH = 0.05;
const PROFILE_TILT = 0.05;
const GLINT_REACH = 0.03;
/** The glint sits on the lit brow end of the comb, high on its points. */
const GLINT_ALONG = 0.4;
const GLINT_UP = 0.7;
const TURN_SLIDE = 0.04;

function combPath(
  ctx: Ctx,
  cx: number,
  baseY: number,
  halfLength: number,
  lobes: readonly Lobe[],
  lean: number,
): void {
  ctx.beginPath();
  ctx.moveTo(cx + halfLength, baseY);
  const lastIndex = lobes.length - 1;
  for (const [index, lobe] of lobes.entries()) {
    ctx.lineTo(cx + lobe.along * halfLength - lean, baseY - lobe.height);
    if (index === lastIndex) continue;
    const next = lobes[index + 1];
    const notchX = cx + ((lobe.along + next.along) / 2) * halfLength;
    const notchY = baseY - Math.min(lobe.height, next.height) * NOTCH_SHARE;
    ctx.lineTo(notchX, notchY);
  }
  ctx.lineTo(cx - halfLength, baseY);
  ctx.closePath();
}

function paintBand(ctx: Ctx, cx: number, bandY: number, halfWidth: number): void {
  const top = bandY - BAND_HEIGHT;
  ctx.beginPath();
  ctx.moveTo(cx - halfWidth, top);
  ctx.quadraticCurveTo(cx, top + BAND_SAG * 2, cx + halfWidth, top);
  ctx.lineTo(cx + halfWidth, bandY);
  ctx.quadraticCurveTo(cx, bandY + BAND_SAG * 2, cx - halfWidth, bandY);
  ctx.closePath();
  ctx.fillStyle = metalFill(ctx, IRON, cx - halfWidth, top, cx + halfWidth, bandY);
  ctx.fill();
}

function paintCrest(ctx: Ctx, seat: HatSeat): void {
  const profile = seat.view === 'side';
  const bandY = seat.skullTop + BAND_DROP;
  const halfLength = profile ? PROFILE_HALF_LENGTH : HEAD_ON_HALF_WIDTH;
  const lobes = profile ? PROFILE_LOBES : HEAD_ON_LOBES;
  const baseY = bandY - BAND_HEIGHT / 2;
  const tallest = Math.max(...lobes.map((lobe) => lobe.height));

  combPath(ctx, seat.cx, baseY, halfLength, lobes, profile ? PROFILE_LOBE_LEAN : 0);
  const fill = metalFill(
    ctx,
    RED_ENAMEL,
    seat.cx - halfLength,
    baseY - tallest,
    seat.cx + halfLength,
    baseY,
  );
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = fill;
  ctx.lineWidth = TIP_ROUNDING;
  ctx.lineJoin = 'round';
  ctx.stroke();

  paintBand(ctx, seat.cx, bandY, profile ? PROFILE_BAND_HALF_WIDTH : BAND_HALF_WIDTH);

  if (seat.view === 'back') return;
  paintGlint(
    ctx,
    RED_ENAMEL,
    seat.cx + halfLength * GLINT_ALONG,
    baseY - tallest * GLINT_UP,
    GLINT_REACH,
  );
}

export const CAT_COCKSCOMB_CREST = defineGarment({
  id: 'cat_cockscomb_crest',
  name: 'Cockscomb Crest',
  wearer: 'cat',
  material: 'metal',
  layer: 'overcoat',
  region: ['head'],
  paint: {
    head: withViewFallback(
      hatPainters({ paint: paintCrest, turnSlide: TURN_SLIDE, profileTilt: PROFILE_TILT }),
      CAT_VIEW_FALLBACK,
    ),
  },
});
