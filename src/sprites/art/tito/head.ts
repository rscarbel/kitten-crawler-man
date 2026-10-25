/**
 * Tito's head. Painted in its own frame: origin at the centre of the eye line,
 * one unit = half the head's height from eye line to chin, +y down.
 *
 * His face is built around the smile. It is a lean, long face with high
 * cheekbones and a narrow pointed chin, black hair combed straight back under
 * pomade with a hard side part, thin arched brows sitting high, half-lidded
 * almond eyes, a pencil moustache, and a mouth that runs nearly out to the
 * cheekbones — a full row of teeth on show, one of them gold. At the club
 * floor's 12-pixel size the smile, the moustache and the slick black crown are
 * what survive, so those are drawn heavier there.
 */

import { lerp, type Pt } from '../bipedArt';
import {
  type Ctx,
  type FormShading,
  type Trace,
  devicePixel,
  fillTrace,
  outlineTrace,
  paintForm,
  pt,
  strokeLine,
  strokeScaled,
  traceEllipse,
  tracePolygon,
  traceSmoothLoop,
  withinTrace,
} from '../deuce/paint';
import {
  BROW,
  CHEEK_CREASE,
  EYE_WHITE,
  GOLD,
  HAIR,
  HAIR_SHINE,
  IRIS,
  LIP,
  MOUSTACHE,
  MOUTH_DARK,
  PUPIL,
  SKIN,
  TEETH,
  TEETH_SHADE,
} from './palette';

export interface TitoExpression {
  /** 1 is his natural half-lidded look; 0 shut; above 1 the lids lift wide. */
  lidOpen: number;
  /** 0→1 the cheeks push the lower lids up: smiling eyes, and at 1 shut crescents. */
  squint: number;
  /** −1 a villain's V, 0 at rest, 1 both brows high. */
  browRaise: number;
  /** Cocks his left brow (screen right) above his right. */
  browSkew: number;
  /** 0→1 shuts his left eye (screen right) alone. */
  wink: number;
  /** 0 his resting smile, already too wide; 1 the full, ear-ward grin. */
  grin: number;
  /** 0 teeth together, 1 jaw dropped. */
  mouthOpen: number;
  /** Where the eyes look, −1→1 on each axis. */
  lookX: number;
  lookY: number;
}

export const RESTING_EXPRESSION: TitoExpression = {
  lidOpen: 1,
  squint: 0.2,
  browRaise: 0,
  browSkew: 0.25,
  wink: 0,
  grin: 0.3,
  mouthOpen: 0,
  lookX: 0,
  lookY: 0,
};

/** `portrait` for the wheel screen's bust; `world` for the club floor's 12-pixel head. */
export type TitoHeadDetail = 'portrait' | 'world';

// ── Proportion tables, in head units ────────────────────────────────────────

const FACE_OUTLINE: readonly Pt[] = [
  pt(0, -1.24),
  pt(0.6, -1.08),
  pt(0.72, -0.5),
  pt(0.73, 0.05),
  pt(0.71, 0.5),
  pt(0.6, 0.84),
  pt(0.34, 1.07),
  pt(0.1, 1.17),
  pt(-0.1, 1.17),
  pt(-0.34, 1.07),
  pt(-0.6, 0.84),
  pt(-0.71, 0.5),
  pt(-0.73, 0.05),
  pt(-0.72, -0.5),
  pt(-0.6, -1.08),
];
const traceFace: Trace = (ctx) => traceSmoothLoop(ctx, FACE_OUTLINE);
const FACE_SHADING: FormShading = { shadow: 0.15, highlight: 0.05 };
/** The hollow under the cheekbone that makes the face lean, on the side away from the light. */
const CHEEK_HOLLOW = { x: 0.5, y: 0.42, rx: 0.13, ry: 0.22, rotation: -0.2 } as const;
const CHEEK_HOLLOW_COLOR = 'rgba(90, 40, 20, 0.22)';
/** The lit apple of each cheek, raised by the grin. */
const CHEEK_APPLE = { x: 0.4, y: 0.22, rx: 0.15, ry: 0.09, liftPerGrin: 0.05 } as const;
const CHEEK_APPLE_COLOR = 'rgba(255, 200, 160, 0.18)';
const CHIN_SHADOW = { y: 1.02, rx: 0.18, ry: 0.07 } as const;
const CHIN_SHADOW_COLOR = 'rgba(80, 36, 18, 0.3)';
const STUBBLE_COLOR = 'rgba(40, 46, 60, 0.12)';
const STUBBLE_JAW: readonly Pt[] = [
  pt(-0.7, 0.55),
  pt(-0.58, 0.88),
  pt(-0.32, 1.09),
  pt(0, 1.18),
  pt(0.32, 1.09),
  pt(0.58, 0.88),
  pt(0.7, 0.55),
  pt(0.5, 0.86),
  pt(0, 0.98),
  pt(-0.5, 0.86),
];

const EAR = { x: 0.74, y: 0.02, rx: 0.12, ry: 0.26, tilt: 0.12 } as const;
const EAR_SHADING: FormShading = { shadow: 0.05 };
const EAR_RIM: readonly Pt[] = [pt(0.77, -0.16), pt(0.71, 0.02), pt(0.76, 0.2)];

/** The slicked crown, from the hairline over the top and down behind each temple. */
const HAIR_MASS: readonly Pt[] = [
  pt(-0.64, -0.34),
  pt(-0.8, -0.82),
  pt(-0.62, -1.3),
  pt(-0.2, -1.46),
  pt(0.24, -1.45),
  pt(0.64, -1.28),
  pt(0.8, -0.82),
  pt(0.66, -0.34),
  pt(0.62, -0.58),
  pt(0.44, -0.76),
  pt(0.14, -0.74),
  pt(0, -0.64),
  pt(-0.14, -0.74),
  pt(-0.44, -0.78),
  pt(-0.62, -0.58),
];
const HAIR_SHADING: FormShading = { shadow: 0.08, highlight: 0.04 };
/** A thin sideburn, painted unstroked so its outline does not turn it into a spike. */
const SIDEBURN: readonly Pt[] = [pt(0.63, -0.42), pt(0.69, -0.4), pt(0.68, -0.12), pt(0.655, -0.1)];
/** The comb's grooves, swept straight back from the hairline. */
const COMB_LINES: ReadonlyArray<readonly Pt[]> = [
  [pt(-0.5, -0.74), pt(-0.6, -1.0), pt(-0.5, -1.28)],
  [pt(-0.2, -0.74), pt(-0.24, -1.06), pt(-0.16, -1.38)],
  [pt(0.16, -0.74), pt(0.18, -1.08), pt(0.12, -1.4)],
  [pt(0.46, -0.76), pt(0.56, -1.04), pt(0.5, -1.3)],
];
/** The hard side part, on his right (screen left). */
const SIDE_PART: readonly Pt[] = [pt(-0.36, -0.77), pt(-0.4, -1.05), pt(-0.34, -1.36)];
const SHINE_STREAKS: ReadonlyArray<readonly Pt[]> = [
  [pt(-0.24, -0.88), pt(-0.3, -1.12), pt(-0.22, -1.32)],
  [pt(0.04, -0.82), pt(0.04, -1.1), pt(0.02, -1.36)],
];

const EYE = {
  x: 0.3,
  halfWidth: 0.145,
  top: 0.075,
  bottom: 0.055,
  outerLift: 0.025,
  iris: 0.062,
  pupil: 0.03,
  lookRangeX: 0.055,
  lookRangeY: 0.025,
  lidDropLookingDown: 0.3,
  /** A wide-open eye shows white all round the iris; the pupil pinches to sell the mania. */
  widePupilShrink: 0.6,
  /** Below this opening height the eye reads as shut. */
  shutBelow: 0.02,
  creaseRise: 0.06,
  lashPixels: 1.8,
  lashScaled: 0.03,
  lashOverhang: 0.03,
} as const;
const GLINT = { offset: 0.024, radius: 0.016 } as const;
const GLINT_COLOR = 'rgba(255, 250, 235, 0.92)';
/** How far the upper lid's bezier handle rises per unit of opening: an almond, not a circle. */
const LID_HANDLE = 1.6;
/** Past this squint a shut eye is a laughing crescent rather than a blink. */
const HAPPY_SHUT_SQUINT = 0.5;
/** The happy, shut crescent of a laughing eye bows upward by this much. */
const CRESCENT_RISE = 0.07;

const BROW_SHAPE = {
  inner: pt(0.1, -0.33),
  peak: pt(0.3, -0.45),
  outer: pt(0.49, -0.37),
  samples: 8,
  raise: 0.09,
  /** A scowl drops the inner end much further than the outer. */
  scowlInner: 0.12,
  scowlOuter: 0.02,
  outerRaiseShare: 0.6,
  skew: 0.1,
  width: 0.04,
  minPixels: 1.4,
} as const;

const NOSE = {
  shadowSide: [pt(0.05, -0.18), pt(0.11, 0.14), pt(0.14, 0.32), pt(0.06, 0.36)],
  tipLight: { x: -0.01, y: 0.27, rx: 0.045, ry: 0.035 },
  nostrilX: 0.07,
  nostrilY: 0.36,
  nostrilRx: 0.035,
  nostrilRy: 0.02,
  wingEndY: 0.4,
  wingX: 0.12,
  wingY: 0.32,
} as const;
const NOSE_SHADOW_COLOR = 'rgba(90, 40, 20, 0.35)';
const NOSE_TIP_COLOR = 'rgba(255, 224, 196, 0.5)';

/** The mouth, its half-width growing with the grin until the corners nearly meet the cheekbones. */
const MOUTH = {
  y: 0.62,
  halfWidth: 0.42,
  halfWidthPerGrin: 0.1,
  cornerLift: 0.1,
  cornerLiftPerGrin: 0.08,
  /** The lower edge's dip at rest: teeth together still show a band. */
  depth: 0.11,
  depthPerGrin: 0.04,
  depthPerOpen: 0.22,
  upperDip: 0.015,
  teethDepth: 0.075,
  lowerTeethDepth: 0.05,
  toothCount: 8,
  goldTooth: 5,
  lipPixels: 1.4,
  worldLipPixels: 1,
  upperBow: 0.6,
  cornerTeethShare: 0.5,
} as const;
const MOUSTACHE_SHAPE = {
  y: 0.43,
  gap: 0.03,
  width: 0.05,
  minPixels: 1.6,
  reach: 0.82,
  liftShare: 0.85,
  midLiftShare: 0.3,
} as const;
const SMILE_LINE = {
  fromX: 0.15,
  fromY: 0.36,
  outset: 0.07,
  drop: 0.1,
  pixels: 1.2,
  alphaAtRest: 0.45,
  midOutsetShare: 0.6,
  midRiseShare: 0.3,
} as const;
const CHIN_CLEFT: readonly Pt[] = [pt(0, 0.98), pt(0, 1.06)];

const OUTLINE_PIXELS = 2;
const SIDE_PART_PIXELS = 1.4;
const SHINE_PIXELS = { world: 1.5, portrait: 2.2 } as const;
/** A blink's shut lid sags a little below the line instead of arching like a laugh. */
const BLINK_SAG_SHARE = 0.4;
/** The lower lid's faint line, as shares of the opening below the eye line. */
const LOWER_LID_LINE = { inner: 0.4, centre: 1.3, outer: 0.3 } as const;
/** The gold tooth and its glint, as shares of a tooth's width and the teeth's depth. */
const GOLD_TOOTH = {
  inset: 0.08,
  width: 0.84,
  depth: 2,
  glintInset: 0.2,
  glintWidth: 0.22,
  glintDepth: 0.7,
} as const;
const WORLD_OUTLINE_PIXELS = 1.5;
const DETAIL_PIXELS = 1;
/** On the club floor a feature is a pixel or two: strokes widen so they stay. */
const WORLD_STROKE_SCALE = 1.6;

function mirrored(points: readonly Pt[], side: number): Pt[] {
  return points.map((p) => pt(p.x * side, p.y));
}

function paintEars(ctx: Ctx, detail: TitoHeadDetail): void {
  for (const side of [-1, 1]) {
    const ear: Trace = (c) => traceEllipse(c, EAR.x * side, EAR.y, EAR.rx, EAR.ry, EAR.tilt * side);
    outlineTrace(ctx, ear, detail === 'world' ? WORLD_OUTLINE_PIXELS : OUTLINE_PIXELS);
    paintForm(ctx, ear, SKIN, EAR_SHADING);
    if (detail === 'portrait')
      strokeLine(ctx, mirrored(EAR_RIM, side), SKIN.deep, DETAIL_PIXELS, true);
  }
}

function paintFaceForm(ctx: Ctx, expression: TitoExpression, detail: TitoHeadDetail): void {
  outlineTrace(ctx, traceFace, detail === 'world' ? WORLD_OUTLINE_PIXELS : OUTLINE_PIXELS);
  paintForm(ctx, traceFace, SKIN, FACE_SHADING);
  withinTrace(ctx, traceFace, () => {
    if (detail === 'portrait') {
      fillTrace(ctx, (c) => tracePolygon(c, STUBBLE_JAW), STUBBLE_COLOR);
    }
    fillTrace(
      ctx,
      (c) =>
        traceEllipse(
          c,
          CHEEK_HOLLOW.x,
          CHEEK_HOLLOW.y,
          CHEEK_HOLLOW.rx,
          CHEEK_HOLLOW.ry,
          CHEEK_HOLLOW.rotation,
        ),
      CHEEK_HOLLOW_COLOR,
    );
    const appleY = CHEEK_APPLE.y - CHEEK_APPLE.liftPerGrin * expression.grin;
    for (const side of [-1, 1]) {
      fillTrace(
        ctx,
        (c) => traceEllipse(c, CHEEK_APPLE.x * side, appleY, CHEEK_APPLE.rx, CHEEK_APPLE.ry),
        CHEEK_APPLE_COLOR,
      );
    }
    fillTrace(
      ctx,
      (c) => traceEllipse(c, 0, CHIN_SHADOW.y, CHIN_SHADOW.rx, CHIN_SHADOW.ry),
      CHIN_SHADOW_COLOR,
    );
  });
  if (detail === 'portrait') strokeLine(ctx, CHIN_CLEFT, SKIN.shade, DETAIL_PIXELS);
}

function paintHair(ctx: Ctx, detail: TitoHeadDetail): void {
  for (const side of [-1, 1]) {
    fillTrace(ctx, (c) => tracePolygon(c, mirrored(SIDEBURN, side)), HAIR.base);
  }
  const mass: Trace = (c) => traceSmoothLoop(c, HAIR_MASS);
  outlineTrace(ctx, mass, detail === 'world' ? WORLD_OUTLINE_PIXELS : OUTLINE_PIXELS);
  paintForm(ctx, mass, HAIR, HAIR_SHADING);
  withinTrace(ctx, mass, () => {
    if (detail === 'portrait') {
      for (const line of COMB_LINES) strokeLine(ctx, line, HAIR.deep, DETAIL_PIXELS, true);
      strokeLine(ctx, SIDE_PART, HAIR.light ?? HAIR.base, SIDE_PART_PIXELS, true);
    }
    const shineWidth = detail === 'world' ? SHINE_PIXELS.world : SHINE_PIXELS.portrait;
    for (const streak of SHINE_STREAKS) strokeLine(ctx, streak, HAIR_SHINE, shineWidth, true);
  });
}

/** The opening's two heights above and below the eye line, after lids and cheeks. */
function eyeOpening(expression: TitoExpression, side: number): { top: number; bottom: number } {
  const lookingDownDrop = Math.max(0, expression.lookY) * EYE.lidDropLookingDown;
  const wink = side > 0 ? expression.wink : 0;
  const top = EYE.top * Math.max(0, expression.lidOpen - lookingDownDrop) * (1 - wink);
  const bottom = EYE.bottom * (1 - Math.max(expression.squint, wink));
  return { top, bottom };
}

function paintEye(
  ctx: Ctx,
  side: number,
  expression: TitoExpression,
  detail: TitoHeadDetail,
): void {
  const cx = EYE.x * side;
  const inner = pt(cx - EYE.halfWidth * side, 0);
  const outer = pt(cx + EYE.halfWidth * side, -EYE.outerLift);
  const { top, bottom } = eyeOpening(expression, side);
  const squint = side > 0 ? Math.max(expression.squint, expression.wink) : expression.squint;
  const lashWidth = detail === 'world' ? EYE.lashScaled * WORLD_STROKE_SCALE : EYE.lashScaled;

  if (top + bottom < EYE.shutBelow) {
    const shutDip = squint > HAPPY_SHUT_SQUINT ? -CRESCENT_RISE : CRESCENT_RISE * BLINK_SAG_SHARE;
    strokeScaled(
      ctx,
      [inner, pt(cx, shutDip - EYE.outerLift / 2), outer],
      BROW,
      lashWidth,
      EYE.lashPixels,
    );
    return;
  }

  const opening: Trace = (c) => {
    c.moveTo(inner.x, inner.y);
    c.quadraticCurveTo(cx, -top * LID_HANDLE, outer.x, outer.y);
    c.quadraticCurveTo(cx, bottom * LID_HANDLE, inner.x, inner.y);
    c.closePath();
  };
  fillTrace(ctx, opening, EYE_WHITE);
  withinTrace(ctx, opening, () => {
    const wide = Math.max(0, expression.lidOpen - 1);
    const irisX = cx + expression.lookX * EYE.lookRangeX;
    const irisY = expression.lookY * EYE.lookRangeY;
    fillTrace(ctx, (c) => traceEllipse(c, irisX, irisY, EYE.iris, EYE.iris), IRIS);
    const pupil = EYE.pupil * (1 - wide * EYE.widePupilShrink);
    fillTrace(ctx, (c) => traceEllipse(c, irisX, irisY, pupil, pupil), PUPIL);
    if (detail === 'portrait') {
      fillTrace(
        ctx,
        (c) =>
          traceEllipse(c, irisX - GLINT.offset, irisY - GLINT.offset, GLINT.radius, GLINT.radius),
        GLINT_COLOR,
      );
    }
  });
  const lashEnd = pt(outer.x + EYE.lashOverhang * side, outer.y - EYE.lashOverhang / 2);
  ctx.save();
  ctx.strokeStyle = BROW;
  ctx.lineWidth = Math.max(lashWidth, devicePixel(ctx) * EYE.lashPixels);
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(inner.x, inner.y);
  ctx.quadraticCurveTo(cx, -top * LID_HANDLE, outer.x, outer.y);
  ctx.lineTo(lashEnd.x, lashEnd.y);
  ctx.stroke();
  ctx.restore();
  if (detail === 'portrait') {
    const creaseY = -top - EYE.creaseRise;
    strokeLine(
      ctx,
      [
        pt(inner.x, -EYE.creaseRise / 2),
        pt(cx, creaseY),
        pt(outer.x, outer.y - EYE.creaseRise / 2),
      ],
      SKIN.deep,
      DETAIL_PIXELS,
      true,
    );
    strokeLine(
      ctx,
      [
        pt(inner.x, bottom * LOWER_LID_LINE.inner),
        pt(cx, bottom * LOWER_LID_LINE.centre),
        pt(outer.x, outer.y + bottom * LOWER_LID_LINE.outer),
      ],
      SKIN.shade,
      DETAIL_PIXELS,
      true,
    );
  }
}

/**
 * Samples the quadratic that passes through `start`, `peak` and `end`, so a
 * brow is one smooth arch rather than a chevron bent at its peak.
 */
function arcThrough([start, peak, end]: readonly [Pt, Pt, Pt]): Pt[] {
  const control = pt(peak.x * 2 - (start.x + end.x) / 2, peak.y * 2 - (start.y + end.y) / 2);
  return Array.from({ length: BROW_SHAPE.samples + 1 }, (_, i) => {
    const t = i / BROW_SHAPE.samples;
    const u = 1 - t;
    return pt(
      u * u * start.x + 2 * u * t * control.x + t * t * end.x,
      u * u * start.y + 2 * u * t * control.y + t * t * end.y,
    );
  });
}

function paintBrows(ctx: Ctx, expression: TitoExpression, detail: TitoHeadDetail): void {
  const scowl = Math.max(0, -expression.browRaise);
  const lift = Math.max(0, expression.browRaise) * BROW_SHAPE.raise;
  const width = detail === 'world' ? BROW_SHAPE.width * WORLD_STROKE_SCALE : BROW_SHAPE.width;
  for (const side of [-1, 1]) {
    const skewLift = side > 0 ? expression.browSkew * BROW_SHAPE.skew : 0;
    const raise = lift + skewLift;
    const points: [Pt, Pt, Pt] = [
      pt(BROW_SHAPE.inner.x * side, BROW_SHAPE.inner.y - raise + scowl * BROW_SHAPE.scowlInner),
      pt(BROW_SHAPE.peak.x * side, BROW_SHAPE.peak.y - raise),
      pt(
        BROW_SHAPE.outer.x * side,
        BROW_SHAPE.outer.y - raise * BROW_SHAPE.outerRaiseShare + scowl * BROW_SHAPE.scowlOuter,
      ),
    ];
    strokeScaled(ctx, arcThrough(points), BROW, width, BROW_SHAPE.minPixels);
  }
}

function paintNose(ctx: Ctx, detail: TitoHeadDetail): void {
  fillTrace(ctx, (c) => traceSmoothLoop(c, NOSE.shadowSide), NOSE_SHADOW_COLOR);
  if (detail === 'world') return;
  fillTrace(
    ctx,
    (c) => traceEllipse(c, NOSE.tipLight.x, NOSE.tipLight.y, NOSE.tipLight.rx, NOSE.tipLight.ry),
    NOSE_TIP_COLOR,
  );
  for (const side of [-1, 1]) {
    fillTrace(
      ctx,
      (c) => traceEllipse(c, NOSE.nostrilX * side, NOSE.nostrilY, NOSE.nostrilRx, NOSE.nostrilRy),
      SKIN.deep,
    );
  }
  strokeLine(
    ctx,
    [pt(-NOSE.wingX, NOSE.wingY), pt(-NOSE.nostrilX, NOSE.wingEndY)],
    SKIN.shade,
    DETAIL_PIXELS,
  );
}

interface MouthGeometry {
  halfWidth: number;
  cornerY: number;
  upperMidY: number;
  lowerMidY: number;
}

function mouthGeometry(expression: TitoExpression): MouthGeometry {
  const halfWidth = MOUTH.halfWidth + MOUTH.halfWidthPerGrin * expression.grin;
  const cornerY = MOUTH.y - MOUTH.cornerLift - MOUTH.cornerLiftPerGrin * expression.grin;
  const upperMidY = MOUTH.y - MOUTH.upperDip;
  const lowerMidY =
    MOUTH.y +
    MOUTH.depth +
    MOUTH.depthPerGrin * expression.grin +
    MOUTH.depthPerOpen * expression.mouthOpen;
  return { halfWidth, cornerY, upperMidY, lowerMidY };
}

/** The upper edge's bezier handle: it bows down below the corners by a share of their lift. */
function upperControlY(m: MouthGeometry): number {
  return m.upperMidY + (m.upperMidY - m.cornerY) * MOUTH.upperBow;
}

/** Upper edge from corner to corner, then the lower edge back: the grin's whole opening. */
function mouthTrace(m: MouthGeometry): Trace {
  return (c) => {
    c.moveTo(-m.halfWidth, m.cornerY);
    c.quadraticCurveTo(0, upperControlY(m), m.halfWidth, m.cornerY);
    c.quadraticCurveTo(0, m.lowerMidY * 2 - m.cornerY, -m.halfWidth, m.cornerY);
    c.closePath();
  };
}

/** The grin's upper edge at `x`, for laying the moustache and the teeth along it. */
function upperEdgeY(m: MouthGeometry, x: number): number {
  const t = (x / m.halfWidth + 1) / 2;
  const controlY = upperControlY(m);
  const u = 1 - t;
  return u * u * m.cornerY + 2 * u * t * controlY + t * t * m.cornerY;
}

function paintMouth(ctx: Ctx, expression: TitoExpression, detail: TitoHeadDetail): void {
  const m = mouthGeometry(expression);
  const mouth = mouthTrace(m);

  const smileAlpha = lerp(SMILE_LINE.alphaAtRest, 1, expression.grin);
  if (detail === 'portrait') {
    ctx.save();
    ctx.globalAlpha *= smileAlpha;
    for (const side of [-1, 1]) {
      strokeLine(
        ctx,
        [
          pt(SMILE_LINE.fromX * side, SMILE_LINE.fromY),
          pt(
            (m.halfWidth + SMILE_LINE.outset * SMILE_LINE.midOutsetShare) * side,
            m.cornerY - SMILE_LINE.drop * SMILE_LINE.midRiseShare,
          ),
          pt((m.halfWidth + SMILE_LINE.outset) * side, m.cornerY + SMILE_LINE.drop),
        ],
        CHEEK_CREASE,
        SMILE_LINE.pixels,
        true,
      );
    }
    ctx.restore();
  }

  fillTrace(ctx, mouth, MOUTH_DARK);
  withinTrace(ctx, mouth, () => {
    const teethTop = Math.min(m.cornerY, m.upperMidY) - MOUTH.teethDepth;
    const teethBottom = m.upperMidY + MOUTH.teethDepth;
    const upperTeeth: Trace = (c) => {
      c.moveTo(-m.halfWidth, teethTop);
      c.lineTo(m.halfWidth, teethTop);
      c.lineTo(m.halfWidth, m.cornerY + MOUTH.teethDepth * MOUTH.cornerTeethShare);
      c.quadraticCurveTo(
        0,
        teethBottom * 2 - m.cornerY,
        -m.halfWidth,
        m.cornerY + MOUTH.teethDepth * MOUTH.cornerTeethShare,
      );
      c.closePath();
    };
    fillTrace(ctx, upperTeeth, TEETH);
    if (expression.mouthOpen > 0) {
      const lowerTop = m.lowerMidY - MOUTH.lowerTeethDepth;
      fillTrace(
        ctx,
        (c) => {
          c.moveTo(-m.halfWidth, lowerTop);
          c.quadraticCurveTo(
            0,
            lowerTop * 2 - m.cornerY + MOUTH.lowerTeethDepth,
            m.halfWidth,
            lowerTop,
          );
          c.lineTo(m.halfWidth, m.lowerMidY + MOUTH.lowerTeethDepth);
          c.lineTo(-m.halfWidth, m.lowerMidY + MOUTH.lowerTeethDepth);
          c.closePath();
        },
        TEETH_SHADE,
      );
    }
    if (detail === 'world') return;
    const toothWidth = (m.halfWidth * 2) / MOUTH.toothCount;
    for (let i = 1; i < MOUTH.toothCount; i++) {
      const x = -m.halfWidth + toothWidth * i;
      const y0 = upperEdgeY(m, x);
      strokeLine(ctx, [pt(x, y0), pt(x, y0 + MOUTH.teethDepth)], TEETH_SHADE, DETAIL_PIXELS);
    }
    const goldLeft = -m.halfWidth + toothWidth * MOUTH.goldTooth;
    const goldTop = upperEdgeY(m, goldLeft + toothWidth / 2);
    fillTrace(
      ctx,
      (c) =>
        c.rect(
          goldLeft + toothWidth * GOLD_TOOTH.inset,
          goldTop - MOUTH.teethDepth,
          toothWidth * GOLD_TOOTH.width,
          MOUTH.teethDepth * GOLD_TOOTH.depth,
        ),
      GOLD.base,
    );
    fillTrace(
      ctx,
      (c) =>
        c.rect(
          goldLeft + toothWidth * GOLD_TOOTH.glintInset,
          goldTop,
          toothWidth * GOLD_TOOTH.glintWidth,
          MOUTH.teethDepth * GOLD_TOOTH.glintDepth,
        ),
      GOLD.light ?? GOLD.base,
    );
  });
  ctx.save();
  ctx.strokeStyle = LIP;
  ctx.lineWidth = devicePixel(ctx) * (detail === 'world' ? MOUTH.worldLipPixels : MOUTH.lipPixels);
  ctx.beginPath();
  mouth(ctx);
  ctx.stroke();
  ctx.restore();

  const lift = (MOUTH.y - m.cornerY) * MOUSTACHE_SHAPE.liftShare;
  const width =
    detail === 'world' ? MOUSTACHE_SHAPE.width * WORLD_STROKE_SCALE : MOUSTACHE_SHAPE.width;
  for (const side of [-1, 1]) {
    const reach = m.halfWidth * MOUSTACHE_SHAPE.reach;
    strokeScaled(
      ctx,
      [
        pt(MOUSTACHE_SHAPE.gap * side, MOUSTACHE_SHAPE.y),
        pt((reach / 2) * side, MOUSTACHE_SHAPE.y - lift * MOUSTACHE_SHAPE.midLiftShare),
        pt(reach * side, MOUSTACHE_SHAPE.y - lift),
      ],
      MOUSTACHE,
      width,
      MOUSTACHE_SHAPE.minPixels,
    );
  }
}

/** Paints the whole head in head units at the current transform. */
export function paintTitoHead(ctx: Ctx, expression: TitoExpression, detail: TitoHeadDetail): void {
  paintEars(ctx, detail);
  paintFaceForm(ctx, expression, detail);
  paintHair(ctx, detail);
  paintNose(ctx, detail);
  for (const side of [-1, 1]) paintEye(ctx, side, expression, detail);
  paintBrows(ctx, expression, detail);
  paintMouth(ctx, expression, detail);
}
