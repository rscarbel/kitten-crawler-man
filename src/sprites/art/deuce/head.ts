/**
 * Deuce's head. Painted in its own frame: origin at the centre of the eye
 * line, one unit = half the head's height from eye line to chin, +y down.
 *
 * His face is built to be nobody else's. He is sixty: a bald crown shining
 * through an open-topped eyeshade, grey hair clipped close over the ears, a
 * pear-shaped face that widens into jowls and a soft double chin, heavy hooded
 * eyes with bags under them, a long hooked nose with a drinker's bulb, deep
 * folds from nose to mouth, and a clipped grey chevron moustache. None of it
 * shares a contour with the crawlers' young, square-jawed faces.
 */

import { mix, type Pt } from '../carlArt';
import {
  type Ctx,
  type Trace,
  type FormShading,
  devicePixel,
  fillTrace,
  outlineTrace,
  paintForm,
  pt,
  strokeLine,
  traceEllipse,
  traceSmoothLoop,
  tracePolygon,
  withinTrace,
} from './paint';
import {
  BROW,
  EYE_WHITE,
  FLUSH,
  GOLD,
  HAIR,
  IRIS,
  LIP,
  LIP_DARK,
  OUTLINE,
  PUPIL,
  SKIN,
  VISOR_BAND,
  VISOR_GLASS,
  VISOR_GLASS_SHADOW,
} from './palette';

export interface DeuceExpression {
  /** 1 is his natural heavy-lidded look; 0 shut; above 1 the lids lift in surprise. */
  lidOpen: number;
  /** −1 a scowl, 0 at rest, 1 both brows high. */
  browRaise: number;
  /** Raises his left brow (screen right) over his right: the sceptic's one-brow lift. */
  browSkew: number;
  /** −1 corners down, 1 corners up. */
  mouthCurve: number;
  /** 0 closed, 1 dropped open. */
  mouthOpen: number;
  /** Raises one mouth corner only (screen right), for a smirk. */
  smirk: number;
  /** Where the eyes look, −1→1 on each axis. */
  lookX: number;
  lookY: number;
}

/**
 * How much of the face is drawn. `world` is the 12-pixel head on the club
 * floor and the phone header's bust: fine lines drop out and the features
 * that carry identity at that size — brim, nose, moustache, brows — are drawn
 * heavier.
 */
export type HeadDetail = 'portrait' | 'world';

// ── Proportion tables, in head units ────────────────────────────────────────

/** Crown, temples, cheekbones, the jowls the face widens into, a broad chin. */
const FACE_OUTLINE: readonly Pt[] = [
  pt(0, -1.2),
  pt(0.64, -1.02),
  pt(0.76, -0.45),
  pt(0.78, 0.08),
  pt(0.82, 0.58),
  pt(0.6, 0.95),
  pt(0.24, 1.08),
  pt(-0.24, 1.08),
  pt(-0.6, 0.95),
  pt(-0.82, 0.58),
  pt(-0.78, 0.08),
  pt(-0.76, -0.45),
  pt(-0.64, -1.02),
];
const traceFace: Trace = (ctx) => traceSmoothLoop(ctx, FACE_OUTLINE);
const FACE_SHADING: FormShading = { shadow: 0.16, highlight: 0.05 };
/** The jaw's underside turns away from the light into a hard band. */
const JAW_UNDERSIDE = { x: 0.06, y: 1.16, rx: 0.7, ry: 0.2 } as const;
/** The chin's second fold, below and behind the jaw. */
const DOUBLE_CHIN = { y: 1.02, rx: 0.46, ry: 0.17 } as const;
const DOUBLE_CHIN_SHADING: FormShading = { shadow: 0.07 };
/** The bald crown's shine: one hard-edged lit shape, not a glow. */
const SCALP_SHINE = { x: -0.28, y: -1.0, rx: 0.2, ry: 0.07, rotation: -0.35 } as const;
const SCALP_SHINE_COLOR = 'rgba(255, 236, 214, 0.55)';
const CHEEK_FLUSH = { x: 0.5, y: 0.32, rx: 0.17, ry: 0.1 } as const;
const CHEEK_FLUSH_COLOR = 'rgba(194, 94, 82, 0.22)';

const EAR = { x: 0.8, y: 0.08, rx: 0.15, ry: 0.3, tilt: 0.12 } as const;
const EAR_SHADING: FormShading = { shadow: 0.06 };
/** The ear's inner rim, as a C. */
const EAR_RIM: readonly Pt[] = [pt(0.83, -0.12), pt(0.76, 0.05), pt(0.81, 0.26)];

/** Close-cropped grey over the ears, the fringe a bald man keeps; his left side, mirrored. */
const SIDE_HAIR: readonly Pt[] = [
  pt(0.58, -0.7),
  pt(0.82, -0.66),
  pt(0.86, -0.22),
  pt(0.8, -0.14),
  pt(0.7, -0.3),
  pt(0.62, -0.58),
];
const SIDE_HAIR_SHADING: FormShading = { shadow: 0.06, highlight: 0.02 };
const SIDE_HAIR_STRANDS: ReadonlyArray<readonly Pt[]> = [
  [pt(0.66, -0.62), pt(0.8, -0.3)],
  [pt(0.72, -0.64), pt(0.84, -0.4)],
];

const EYE = {
  x: 0.33,
  halfWidth: 0.15,
  /** Height of the opening above the eye line at his resting, hooded look. */
  top: 0.085,
  bottom: 0.075,
  iris: 0.07,
  pupil: 0.036,
  lookRangeX: 0.055,
  lookRangeY: 0.03,
  /** The iris rides a touch high, tucked under the hood. */
  irisLift: 0.01,
  /** A gaze down drops the upper lid with it: half of what reads as looking at the table. */
  lidDropLookingDown: 0.3,
  /** The lower lid never closes up past this share of its height. */
  lowerLidFloor: 0.15,
  /** Below this the eye is shut: no white, just the lash line. */
  shutBelow: 0.12,
} as const;
/**
 * Under a hooded lid an upward glance shows white below the iris and reads as
 * eye-rolling, so looking up moves the iris far less than looking down.
 */
const UPWARD_GAZE_SHARE = 0.25;
/**
 * The opening's bezier handles. The hood droops toward the outer corner: the
 * high point sits inboard of centre, an old man's eye rather than a round one.
 */
const OPENING = {
  upperInnerX: 0.05,
  upperInnerRise: 1.5,
  upperCentreX: 0.04,
  upperCentreRise: 1.4,
  outerCornerY: 0.01,
  lowerCentreX: 0.06,
  lowerCentreDepth: 1.3,
  lowerInnerX: 0.06,
  lowerInnerDepth: 1.2,
} as const;
/** The hollow between brow and lid. */
const SOCKET = { offsetX: 0.02, y: -0.07, rx: 0.22, ry: 0.13, depth: 0.6 } as const;
/** The upper lid's shade on the top of the eyeball. */
const LID_SHADE = { y: -0.11, rx: 0.2, ry: 0.07 } as const;
const LID_SHADE_COLOR = 'rgba(60, 30, 20, 0.35)';
const GLINT = { offset: 0.03, radius: 0.017 } as const;
const GLINT_COLOR = 'rgba(255, 250, 235, 0.9)';

type EyeAnchor = 'inner' | 'centre' | 'outer';
/** A point on an eye: an anchor, an offset outward from it (toward the ear), and a height. */
interface EyeMark {
  at: EyeAnchor;
  out: number;
  y: number;
}
/** The lash line, its rise as a share of the opening's top. */
const LASH: ReadonlyArray<{ at: EyeAnchor; out: number; rise: number }> = [
  { at: 'inner', out: 0, rise: 0 },
  { at: 'inner', out: 0.06, rise: 1.15 },
  { at: 'centre', out: 0.05, rise: 1.05 },
  { at: 'outer', out: 0, rise: -0.12 },
];
/** The hood's fold, measured down from the lid crease. */
const HOOD_GAP = 0.05;
const HOOD: readonly EyeMark[] = [
  { at: 'inner', out: 0.02, y: 0.02 },
  { at: 'centre', out: 0, y: -0.015 },
  { at: 'outer', out: 0.03, y: 0.05 },
];
const LOWER_LID: readonly EyeMark[] = [
  { at: 'inner', out: 0.03, y: 0.05 },
  { at: 'centre', out: 0, y: 0.085 },
  { at: 'outer', out: -0.02, y: 0.04 },
];
const EYE_BAG: readonly EyeMark[] = [
  { at: 'inner', out: 0.05, y: 0.15 },
  { at: 'centre', out: 0.02, y: 0.19 },
  { at: 'outer', out: 0.02, y: 0.12 },
];
const EYE_BAG_DEPTH = 0.55;
const CROWS_FEET: ReadonlyArray<readonly EyeMark[]> = [
  [
    { at: 'outer', out: 0.04, y: -0.01 },
    { at: 'outer', out: 0.13, y: -0.05 },
  ],
  [
    { at: 'outer', out: 0.04, y: 0.03 },
    { at: 'outer', out: 0.12, y: 0.06 },
  ],
];

const BROW_SHAPE = {
  y: -0.3,
  raiseRange: 0.13,
  /** A one-brow lift drops the other a little. */
  otherSideShare: 0.4,
  /** A scowl pulls the inner end down harder than the outer. */
  scowlInnerDrop: 0.05,
  inner: { x: 0.1, raiseShare: 0.8 },
  arch: { x: 0.34, rise: 0.06 },
  outer: { x: 0.58, drop: 0.03, raiseShare: 0.7 },
  thickInner: 0.085,
  thickOuter: 0.04,
  /** Where along its thickness each edge of the wedge sits, top and bottom. */
  innerTop: 0.5,
  innerBottom: 0.55,
  archTop: 0.45,
  archBottom: 0.4,
  /** At world size the brows are drawn heavier: they carry the expression. */
  worldWeight: 1.35,
} as const;
/** Wiry white hairs through the grey: from the inner end to the arch. */
const BROW_HAIR = { innerX: 0.16, innerLift: 0.01, archX: 0.42, archDrop: 0.005 } as const;

const NOSE_TIP_Y = 0.47;
/** The side plane away from the key: the one shape that stands the nose off the face. */
const NOSE_SIDE_PLANE: readonly Pt[] = [
  pt(0.05, -0.16),
  pt(0.09, 0.08),
  pt(0.17, 0.32),
  pt(0.2, 0.47),
  pt(0.06, 0.5),
  pt(0.05, 0.1),
];
const NOSE_BULB = { x: 0.02, y: -0.02, rx: 0.125, ry: 0.1 } as const;
const NOSE_WINGS = { leftX: -0.13, rightX: 0.16, y: 0.03, rx: 0.075, ry: 0.065 } as const;
/** How far the drinker's flush reaches into the bulb's light and shade. */
const BULB_FLUSH = { base: 0.32, shade: 0.25 } as const;
const BULB_SHADING: FormShading = { shadow: 0.06, highlight: 0.03 };
const WING_SHADING: FormShading = { shadow: 0.04 };
/** The hook: a lit ridge down the bridge with a kink where the bone ends. */
const NOSE_RIDGE: readonly Pt[] = [pt(-0.01, -0.14), pt(-0.02, 0.06), pt(0, 0.14), pt(-0.03, 0.36)];
const NOSTRILS = { leftX: -0.07, rightX: 0.1, y: 0.075, rx: 0.035, ry: 0.02, tilt: 0.3 } as const;
const NOSTRIL_DEPTH = 0.4;

/** The chevron moustache; `droop` points follow the mouth's corners. */
const MOUSTACHE: ReadonlyArray<{ x: number; y: number; droops: boolean; thickens: boolean }> = [
  { x: -0.44, y: 0.74, droops: true, thickens: false },
  { x: -0.2, y: 0.58, droops: false, thickens: false },
  { x: 0, y: 0.6, droops: false, thickens: false },
  { x: 0.2, y: 0.58, droops: false, thickens: false },
  { x: 0.44, y: 0.74, droops: true, thickens: false },
  { x: 0.36, y: 0.76, droops: true, thickens: false },
  { x: 0.16, y: 0.7, droops: false, thickens: true },
  { x: 0, y: 0.71, droops: false, thickens: true },
  { x: -0.16, y: 0.7, droops: false, thickens: true },
  { x: -0.36, y: 0.76, droops: true, thickens: false },
];
const MOUSTACHE_DROOP = 0.04;
const MOUSTACHE_DROOP_PER_CURVE = 0.03;
const MOUSTACHE_LOWER_EDGE = 0.03;
const MOUSTACHE_WORLD_THICKEN = 1.25;
const MOUSTACHE_SHADING: FormShading = { shadow: 0.05, highlight: 0.02 };
/** Hair strands, combed down and out from under the nose. */
const MOUSTACHE_STRANDS = {
  xs: [-0.3, -0.18, -0.07, 0.07, 0.18, 0.3],
  rootSpread: 0.8,
  tipSpread: 1.05,
  rootY: 0.61,
  tipY: 0.7,
} as const;

const MOUTH = {
  y: 0.83,
  halfWidth: 0.21,
  cornerLift: 0.06,
  centreDrop: 0.03,
  smirkWiden: 0.03,
  smirkLift: 0.08,
  openDepth: 0.12,
  /** Open less than this and the mouth is just a line. */
  openThreshold: 0.005,
  openUpper: 0.4,
  openLower: 1.4,
} as const;
const LOWER_LIP = { drop: 0.05, widthShare: 0.7, ry: 0.04 } as const;
const UNDER_LIP_SHADOW = { drop: 0.13, halfWidth: 0.12 } as const;

/** Nose-to-mouth folds, which pull up as he smiles, and the jowl creases. */
const NASOLABIAL: readonly Pt[] = [pt(0.22, 0.48), pt(0.38, 0.66), pt(0.4, 0.92)];
const FOLD_PULL_PER_CURVE = 0.04;
const FOLD_DEPTH = 0.35;
const JOWL_CREASE: readonly Pt[] = [pt(0.56, 0.8), pt(0.5, 0.98)];

/** The eyeshade: a band round the skull and a celluloid brim angled down over the brow. */
const SHADE = {
  bandTopY: -0.9,
  bandBottomY: -0.66,
  bandHalfWidth: 0.8,
  /** The band narrows a little toward its top edge, following the skull. */
  bandTopTaper: 0.97,
  /** How far the band's ends sit below its middle: it wraps round the head. */
  bandWrap: 0.08,
  bandArch: 0.1,
  bandTopArch: 0.12,
  brimHalfWidth: 1.1,
  brimDropY: -0.36,
  /** The brim hangs from just under the band's bottom edge. */
  brimRootDrop: 0.12,
  /** The brim's green shadow falls to here on the forehead. */
  shadowReach: 0.22,
  shadowUnderBand: 0.1,
} as const;
/** Gold piping along the band's top edge. */
const SHADE_PIPING = { inset: 0.95, endDrop: 0.1, middleRise: 0.03 } as const;
const BAND_SHADING: FormShading = { shadow: 0.04, highlight: 0.02 };

/** Line weights in device pixels: portrait, then the heavier world/bust weight where it differs. */
const LINE = {
  outline: 2,
  lash: { portrait: 1.8, world: 1.2 },
  hood: 1.2,
  crease: 1,
  fold: 1.3,
  earRim: 1.2,
  hair: 0.8,
  ridge: { portrait: 1.4, world: 1 },
  mouth: { portrait: 1.5, world: 1 },
  piping: { portrait: 1.2, world: 0.8 },
  brim: { portrait: 1.6, world: 1.2 },
} as const;

// ── Painters ────────────────────────────────────────────────────────────────

function gazeY(lookY: number): number {
  return lookY < 0 ? lookY * UPWARD_GAZE_SHARE : lookY;
}

function anchorX(side: number, at: EyeAnchor): number {
  const centre = side * EYE.x;
  if (at === 'centre') return centre;
  return centre + side * EYE.halfWidth * (at === 'outer' ? 1 : -1);
}

function eyePoint(side: number, mark: EyeMark, lift = 0): Pt {
  return pt(anchorX(side, mark.at) + side * mark.out, mark.y + lift);
}

/** The top of the opening above the eye line, for this openness and gaze. */
function openingTop(lidOpen: number, lookDown: number): number {
  return EYE.top * Math.max(0, lidOpen) * (1 - lookDown * EYE.lidDropLookingDown);
}

function eyeOpeningTrace(side: number, lidOpen: number, lookDown: number): Trace {
  const cx = side * EYE.x;
  const top = openingTop(lidOpen, lookDown);
  const bottom = EYE.bottom * Math.min(1, Math.max(EYE.lowerLidFloor, lidOpen));
  const inner = anchorX(side, 'inner');
  const outer = anchorX(side, 'outer');
  return (ctx) => {
    ctx.moveTo(inner, 0);
    ctx.bezierCurveTo(
      inner + side * OPENING.upperInnerX,
      -top * OPENING.upperInnerRise,
      cx + side * OPENING.upperCentreX,
      -top * OPENING.upperCentreRise,
      outer,
      OPENING.outerCornerY,
    );
    ctx.bezierCurveTo(
      cx + side * OPENING.lowerCentreX,
      bottom * OPENING.lowerCentreDepth,
      inner + side * OPENING.lowerInnerX,
      bottom * OPENING.lowerInnerDepth,
      inner,
      0,
    );
    ctx.closePath();
  };
}

function paintEyeball(
  ctx: Ctx,
  side: number,
  expression: DeuceExpression,
  detail: HeadDetail,
): void {
  const cx = side * EYE.x;
  const lookDown = Math.max(0, expression.lookY);
  const opening = eyeOpeningTrace(side, expression.lidOpen, lookDown);
  fillTrace(ctx, opening, EYE_WHITE);
  withinTrace(ctx, opening, () => {
    const irisX = cx + expression.lookX * EYE.lookRangeX;
    const irisY = gazeY(expression.lookY) * EYE.lookRangeY - EYE.irisLift;
    fillTrace(ctx, (c) => traceEllipse(c, irisX, irisY, EYE.iris, EYE.iris), IRIS);
    fillTrace(ctx, (c) => traceEllipse(c, irisX, irisY, EYE.pupil, EYE.pupil), PUPIL);
    fillTrace(
      ctx,
      (c) => traceEllipse(c, cx, LID_SHADE.y, LID_SHADE.rx, LID_SHADE.ry),
      LID_SHADE_COLOR,
    );
    if (detail === 'portrait') {
      const glintX = irisX - GLINT.offset;
      const glintY = irisY - GLINT.offset;
      fillTrace(
        ctx,
        (c) => traceEllipse(c, glintX, glintY, GLINT.radius, GLINT.radius),
        GLINT_COLOR,
      );
    }
  });
}

function paintEye(ctx: Ctx, side: number, expression: DeuceExpression, detail: HeadDetail): void {
  const cx = side * EYE.x;
  const lookDown = Math.max(0, expression.lookY);
  fillTrace(
    ctx,
    (c) => traceEllipse(c, cx + side * SOCKET.offsetX, SOCKET.y, SOCKET.rx, SOCKET.ry),
    mix(SKIN.base, SKIN.shade, SOCKET.depth),
  );
  if (expression.lidOpen > EYE.shutBelow) paintEyeball(ctx, side, expression, detail);

  // Lash line: the eye's strongest dark, heaviest along the top.
  const top = openingTop(expression.lidOpen, lookDown);
  const lash = LASH.map((mark) => pt(anchorX(side, mark.at) + side * mark.out, -top * mark.rise));
  strokeLine(ctx, lash, OUTLINE, LINE.lash[detail], true);
  if (detail === 'world') return;

  // The hood: a fold of skin lying over the lid crease, heaviest at the outer corner.
  const hoodLift = -top - HOOD_GAP;
  strokeLine(
    ctx,
    HOOD.map((mark) => eyePoint(side, mark, hoodLift)),
    SKIN.deep,
    LINE.hood,
    true,
  );
  strokeLine(
    ctx,
    LOWER_LID.map((mark) => eyePoint(side, mark)),
    SKIN.shade,
    LINE.crease,
    true,
  );
  strokeLine(
    ctx,
    EYE_BAG.map((mark) => eyePoint(side, mark)),
    mix(SKIN.base, SKIN.deep, EYE_BAG_DEPTH),
    LINE.crease,
    true,
  );
  for (const line of CROWS_FEET) {
    strokeLine(
      ctx,
      line.map((mark) => eyePoint(side, mark)),
      SKIN.shade,
      LINE.crease,
    );
  }
}

function browRaiseFor(side: number, expression: DeuceExpression): number {
  const skew = side > 0 ? expression.browSkew : -expression.browSkew * BROW_SHAPE.otherSideShare;
  return expression.browRaise + skew;
}

function paintBrow(ctx: Ctx, side: number, expression: DeuceExpression, detail: HeadDetail): void {
  const raise = browRaiseFor(side, expression) * BROW_SHAPE.raiseRange;
  const innerDrop =
    expression.browRaise < 0 ? -expression.browRaise * BROW_SHAPE.scowlInnerDrop : 0;
  const weight = detail === 'world' ? BROW_SHAPE.worldWeight : 1;
  const inner = pt(
    side * BROW_SHAPE.inner.x,
    BROW_SHAPE.y - raise * BROW_SHAPE.inner.raiseShare + innerDrop,
  );
  const arch = pt(side * BROW_SHAPE.arch.x, BROW_SHAPE.y - BROW_SHAPE.arch.rise - raise);
  const outer = pt(
    side * BROW_SHAPE.outer.x,
    BROW_SHAPE.y + BROW_SHAPE.outer.drop - raise * BROW_SHAPE.outer.raiseShare,
  );
  const thickInner = BROW_SHAPE.thickInner * weight;
  const thickOuter = BROW_SHAPE.thickOuter * weight;
  const shape: Trace = (c) =>
    tracePolygon(c, [
      pt(inner.x, inner.y - thickInner * BROW_SHAPE.innerTop),
      pt(arch.x, arch.y - thickInner * BROW_SHAPE.archTop),
      pt(outer.x, outer.y - thickOuter / 2),
      pt(outer.x, outer.y + thickOuter / 2),
      pt(arch.x, arch.y + thickInner * BROW_SHAPE.archBottom),
      pt(inner.x, inner.y + thickInner * BROW_SHAPE.innerBottom),
    ]);
  fillTrace(ctx, shape, BROW);
  if (detail === 'portrait') {
    strokeLine(
      ctx,
      [
        pt(side * BROW_HAIR.innerX, inner.y - BROW_HAIR.innerLift),
        pt(side * BROW_HAIR.archX, arch.y + BROW_HAIR.archDrop),
      ],
      HAIR.light ?? HAIR.base,
      LINE.hair,
    );
  }
}

function paintNose(ctx: Ctx, detail: HeadDetail): void {
  fillTrace(ctx, (c) => traceSmoothLoop(c, NOSE_SIDE_PLANE), SKIN.shade);
  const bulbRamp = {
    light: SKIN.light,
    base: mix(SKIN.base, FLUSH, BULB_FLUSH.base),
    shade: mix(SKIN.shade, FLUSH, BULB_FLUSH.shade),
    deep: SKIN.deep,
  };
  const wingY = NOSE_TIP_Y + NOSE_WINGS.y;
  const wing =
    (x: number): Trace =>
    (c) =>
      traceEllipse(c, x, wingY, NOSE_WINGS.rx, NOSE_WINGS.ry);
  paintForm(ctx, wing(NOSE_WINGS.leftX), bulbRamp, WING_SHADING);
  paintForm(
    ctx,
    wing(NOSE_WINGS.rightX),
    { ...bulbRamp, base: bulbRamp.shade, shade: SKIN.deep },
    WING_SHADING,
  );
  const bulb: Trace = (c) =>
    traceEllipse(c, NOSE_BULB.x, NOSE_TIP_Y + NOSE_BULB.y, NOSE_BULB.rx, NOSE_BULB.ry);
  paintForm(ctx, bulb, bulbRamp, BULB_SHADING);
  strokeLine(ctx, NOSE_RIDGE, SKIN.light ?? SKIN.base, LINE.ridge[detail]);
  const nostril = mix(SKIN.deep, OUTLINE, NOSTRIL_DEPTH);
  const nostrilY = NOSE_TIP_Y + NOSTRILS.y;
  fillTrace(
    ctx,
    (c) => traceEllipse(c, NOSTRILS.leftX, nostrilY, NOSTRILS.rx, NOSTRILS.ry, NOSTRILS.tilt),
    nostril,
  );
  fillTrace(
    ctx,
    (c) => traceEllipse(c, NOSTRILS.rightX, nostrilY, NOSTRILS.rx, NOSTRILS.ry, -NOSTRILS.tilt),
    nostril,
  );
}

function paintMoustache(ctx: Ctx, expression: DeuceExpression, detail: HeadDetail): void {
  const droop = MOUSTACHE_DROOP - expression.mouthCurve * MOUSTACHE_DROOP_PER_CURVE;
  const thicken = detail === 'world' ? MOUSTACHE_WORLD_THICKEN : 1;
  const points = MOUSTACHE.map((p) => {
    const lower = p.thickens ? MOUSTACHE_LOWER_EDGE * thicken : 0;
    return pt(p.x, p.y + (p.droops ? droop : 0) + lower);
  });
  paintForm(ctx, (c) => traceSmoothLoop(c, points), HAIR, MOUSTACHE_SHADING);
  if (detail === 'world') return;
  for (const x of MOUSTACHE_STRANDS.xs) {
    strokeLine(
      ctx,
      [
        pt(x * MOUSTACHE_STRANDS.rootSpread, MOUSTACHE_STRANDS.rootY),
        pt(x * MOUSTACHE_STRANDS.tipSpread, MOUSTACHE_STRANDS.tipY),
      ],
      HAIR.shade,
      LINE.hair,
    );
  }
}

function paintMouth(ctx: Ctx, expression: DeuceExpression, detail: HeadDetail): void {
  const curve = expression.mouthCurve;
  const cornerY = MOUTH.y - curve * MOUTH.cornerLift;
  const leftCorner = pt(-MOUTH.halfWidth, cornerY);
  const rightCorner = pt(
    MOUTH.halfWidth + expression.smirk * MOUTH.smirkWiden,
    cornerY - expression.smirk * MOUTH.smirkLift,
  );
  const centreY = MOUTH.y + curve * MOUTH.centreDrop;
  const open = expression.mouthOpen * MOUTH.openDepth;
  if (open > MOUTH.openThreshold) {
    fillTrace(
      ctx,
      (c) => {
        c.moveTo(leftCorner.x, leftCorner.y);
        c.quadraticCurveTo(0, centreY - open * MOUTH.openUpper, rightCorner.x, rightCorner.y);
        c.quadraticCurveTo(0, centreY + open * MOUTH.openLower, leftCorner.x, leftCorner.y);
        c.closePath();
      },
      LIP_DARK,
    );
  }
  // The lower lip: a small full shape under a thin mouth line, older lips.
  fillTrace(
    ctx,
    (c) =>
      traceEllipse(
        c,
        0,
        centreY + open + LOWER_LIP.drop,
        MOUTH.halfWidth * LOWER_LIP.widthShare,
        LOWER_LIP.ry,
      ),
    LIP,
  );
  strokeLine(ctx, [leftCorner, pt(0, centreY), rightCorner], LIP_DARK, LINE.mouth[detail], true);
  if (detail === 'world') return;
  const shadowY = centreY + open + UNDER_LIP_SHADOW.drop;
  strokeLine(
    ctx,
    [pt(-UNDER_LIP_SHADOW.halfWidth, shadowY), pt(UNDER_LIP_SHADOW.halfWidth, shadowY)],
    SKIN.shade,
    LINE.crease,
    true,
  );
}

/** Nose-to-mouth folds and the jowl creases, which carry most of his age. */
function paintFolds(ctx: Ctx, expression: DeuceExpression): void {
  const pull = expression.mouthCurve * FOLD_PULL_PER_CURVE;
  for (const side of [-1, 1]) {
    strokeLine(
      ctx,
      NASOLABIAL.map((p, i) => pt(side * p.x, p.y - (i === 0 ? 0 : pull))),
      mix(SKIN.shade, SKIN.deep, FOLD_DEPTH),
      LINE.fold,
      true,
    );
    strokeLine(
      ctx,
      JOWL_CREASE.map((p) => pt(side * p.x, p.y)),
      SKIN.shade,
      LINE.crease,
      true,
    );
  }
}

function paintEars(ctx: Ctx): void {
  for (const side of [-1, 1]) {
    const ear: Trace = (c) => traceEllipse(c, side * EAR.x, EAR.y, EAR.rx, EAR.ry, side * EAR.tilt);
    outlineTrace(ctx, ear, LINE.outline);
    paintForm(ctx, ear, SKIN, EAR_SHADING);
    strokeLine(
      ctx,
      EAR_RIM.map((p) => pt(side * p.x, p.y)),
      SKIN.deep,
      LINE.earRim,
      true,
    );
  }
}

function paintSideHair(ctx: Ctx, detail: HeadDetail): void {
  for (const side of [-1, 1]) {
    const patch = SIDE_HAIR.map((p) => pt(side * p.x, p.y));
    paintForm(ctx, (c) => traceSmoothLoop(c, patch), HAIR, SIDE_HAIR_SHADING);
    if (detail === 'world') continue;
    for (const strand of SIDE_HAIR_STRANDS) {
      strokeLine(
        ctx,
        strand.map((p) => pt(side * p.x, p.y)),
        HAIR.shade,
        LINE.hair,
      );
    }
  }
}

function paintDoubleChin(ctx: Ctx): void {
  const fold: Trace = (c) => traceEllipse(c, 0, DOUBLE_CHIN.y, DOUBLE_CHIN.rx, DOUBLE_CHIN.ry);
  outlineTrace(ctx, fold, LINE.outline);
  paintForm(ctx, fold, SKIN, DOUBLE_CHIN_SHADING);
}

function brimEdge(c: Ctx): void {
  const rootY = SHADE.bandBottomY + SHADE.brimRootDrop;
  c.moveTo(-SHADE.brimHalfWidth, rootY);
  c.quadraticCurveTo(0, SHADE.brimDropY + SHADE.brimRootDrop, SHADE.brimHalfWidth, rootY);
}

function paintEyeshade(ctx: Ctx, detail: HeadDetail): void {
  const band: Trace = (c) => {
    const bottomEnds = SHADE.bandBottomY + SHADE.bandWrap;
    const topEnds = SHADE.bandTopY + SHADE.bandWrap;
    const topHalf = SHADE.bandHalfWidth * SHADE.bandTopTaper;
    c.moveTo(-SHADE.bandHalfWidth, bottomEnds);
    c.quadraticCurveTo(0, SHADE.bandBottomY - SHADE.bandArch, SHADE.bandHalfWidth, bottomEnds);
    c.lineTo(topHalf, topEnds);
    c.quadraticCurveTo(0, SHADE.bandTopY - SHADE.bandTopArch, -topHalf, topEnds);
    c.closePath();
  };
  const brim: Trace = (c) => {
    const rootY = SHADE.bandBottomY + SHADE.brimRootDrop;
    brimEdge(c);
    c.quadraticCurveTo(0, SHADE.bandBottomY - SHADE.brimRootDrop, -SHADE.brimHalfWidth, rootY);
    c.closePath();
  };
  // The brim's green shade falls across the forehead down to the brows.
  withinTrace(ctx, traceFace, () => {
    fillTrace(
      ctx,
      (c) => {
        c.moveTo(-1, SHADE.bandBottomY);
        c.quadraticCurveTo(0, SHADE.brimDropY + SHADE.shadowReach, 1, SHADE.bandBottomY);
        c.lineTo(1, SHADE.bandBottomY - SHADE.shadowUnderBand);
        c.lineTo(-1, SHADE.bandBottomY - SHADE.shadowUnderBand);
        c.closePath();
      },
      VISOR_GLASS_SHADOW,
    );
  });
  outlineTrace(ctx, band, LINE.outline);
  paintForm(ctx, band, VISOR_BAND, BAND_SHADING);
  const pipingEnds = SHADE.bandTopY + SHADE_PIPING.endDrop;
  const pipingHalf = SHADE.bandHalfWidth * SHADE_PIPING.inset;
  strokeLine(
    ctx,
    [
      pt(-pipingHalf, pipingEnds),
      pt(0, SHADE.bandTopY - SHADE_PIPING.middleRise),
      pt(pipingHalf, pipingEnds),
    ],
    GOLD.base,
    LINE.piping[detail],
    true,
  );
  fillTrace(ctx, brim, VISOR_GLASS);
  ctx.strokeStyle = VISOR_BAND.shade;
  ctx.lineWidth = devicePixel(ctx) * LINE.brim[detail];
  ctx.beginPath();
  brimEdge(ctx);
  ctx.stroke();
}

/** Paints Deuce's head with `expression`, in head units centred on the eye line. */
export function paintDeuceHead(ctx: Ctx, expression: DeuceExpression, detail: HeadDetail): void {
  paintDoubleChin(ctx);
  paintEars(ctx);
  outlineTrace(ctx, traceFace, LINE.outline);
  paintForm(ctx, traceFace, SKIN, FACE_SHADING);
  withinTrace(ctx, traceFace, () => {
    fillTrace(
      ctx,
      (c) =>
        traceEllipse(
          c,
          SCALP_SHINE.x,
          SCALP_SHINE.y,
          SCALP_SHINE.rx,
          SCALP_SHINE.ry,
          SCALP_SHINE.rotation,
        ),
      SCALP_SHINE_COLOR,
    );
    for (const side of [-1, 1]) {
      fillTrace(
        ctx,
        (c) => traceEllipse(c, side * CHEEK_FLUSH.x, CHEEK_FLUSH.y, CHEEK_FLUSH.rx, CHEEK_FLUSH.ry),
        CHEEK_FLUSH_COLOR,
      );
    }
    fillTrace(
      ctx,
      (c) => traceEllipse(c, JAW_UNDERSIDE.x, JAW_UNDERSIDE.y, JAW_UNDERSIDE.rx, JAW_UNDERSIDE.ry),
      SKIN.shade,
    );
  });
  paintSideHair(ctx, detail);
  if (detail === 'portrait') paintFolds(ctx, expression);
  for (const side of [-1, 1]) paintEye(ctx, side, expression, detail);
  for (const side of [-1, 1]) paintBrow(ctx, side, expression, detail);
  paintNose(ctx, detail);
  paintMouth(ctx, expression, detail);
  paintMoustache(ctx, expression, detail);
  paintEyeshade(ctx, detail);
}
