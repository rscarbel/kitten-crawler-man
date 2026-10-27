/**
 * The slot machine's reel symbols as vector art: cherries, a lemon, a bell, a
 * BAR plate, Mongo on his disc, a jewelled tiara, a crawler's boots, a golden
 * 7, the gold dagger-seal wild and the glowing loot-box scatter. Painted into
 * a square cell; `ui/casino/slots/slotSymbols` bakes them per size so the
 * reels only ever blit.
 */

import { listAt } from '../../systems/casino/poker/npc/listAt';
import { HIDE, pt, type Pt } from './mongoArt';
import type { SlotSymbol } from '../../systems/casino/slots/slotSymbols';
import { UI_FONT_STACK } from '../../ui/theme/fonts';
import { slotsInk } from '../../ui/theme/slotsInk';
import { worldText } from '../../ui/world/worldText';

const ink = slotsInk.symbols;
/** Mongo's display feathers. */
const MONGO_CREST = ink.mongoCrest;

const HALF = 0.5;
const TWO_PI = Math.PI * 2;

/** Symbols sit inside the cell with this much air on every side, as a fraction of its short side. */
const SYMBOL_PADDING = 0.1;
const OUTLINE_WIDTH = 0.035;

type Painter = (ctx: CanvasRenderingContext2D, s: number) => void;

function outlined(ctx: CanvasRenderingContext2D, s: number, fill: string | CanvasGradient): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.lineWidth = s * OUTLINE_WIDTH;
  ctx.strokeStyle = ink.outline;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

function radial(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  stops: ReadonlyArray<readonly [number, string]>,
): CanvasGradient {
  const highlightOffset = 0.35;
  const g = ctx.createRadialGradient(
    x - r * highlightOffset,
    y - r * highlightOffset,
    r * OUTLINE_WIDTH,
    x,
    y,
    r,
  );
  for (const [at, color] of stops) g.addColorStop(at, color);
  return g;
}

function linear(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  stops: ReadonlyArray<readonly [number, string]>,
): CanvasGradient {
  const g = ctx.createLinearGradient(x0, y0, x1, y1);
  for (const [at, color] of stops) g.addColorStop(at, color);
  return g;
}

function shine(ctx: CanvasRenderingContext2D, x: number, y: number, rx: number, ry: number): void {
  const tilt = -0.6;
  ctx.save();
  ctx.fillStyle = ink.shine;
  ctx.beginPath();
  ctx.ellipse(x, y, rx, ry, tilt, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function dropShadow(ctx: CanvasRenderingContext2D, s: number): void {
  const shadowY = 0.43;
  const shadowRx = 0.3;
  const shadowRy = 0.05;
  ctx.save();
  ctx.fillStyle = ink.shadow;
  ctx.beginPath();
  ctx.ellipse(0, s * shadowY, s * shadowRx, s * shadowRy, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** A closed outline in unit coordinates, scaled by the symbol's side when traced. */
type UnitSegment =
  | { readonly line: Pt }
  | { readonly quad: readonly [control: Pt, to: Pt] }
  | { readonly cubic: readonly [first: Pt, second: Pt, to: Pt] };

interface UnitPath {
  readonly from: Pt;
  readonly segments: readonly UnitSegment[];
}

function traceUnitPath(ctx: CanvasRenderingContext2D, s: number, path: UnitPath): void {
  ctx.beginPath();
  ctx.moveTo(s * path.from.x, s * path.from.y);
  for (const segment of path.segments) {
    if ('line' in segment) {
      ctx.lineTo(s * segment.line.x, s * segment.line.y);
    } else if ('quad' in segment) {
      const [control, to] = segment.quad;
      ctx.quadraticCurveTo(s * control.x, s * control.y, s * to.x, s * to.y);
    } else {
      const [first, second, to] = segment.cubic;
      ctx.bezierCurveTo(s * first.x, s * first.y, s * second.x, s * second.y, s * to.x, s * to.y);
    }
  }
  ctx.closePath();
}

// ── Proportions, as shares of the symbol's side unless noted ─────────────────

const CHERRIES = {
  radius: 0.18,
  left: pt(-0.17, 0.2),
  right: pt(0.17, 0.15),
  stemTop: pt(0.06, -0.32),
  stemWidth: 0.045,
  /** Where a stem leaves its cherry, above the centre as a share of the cherry's radius. */
  stemRootRise: 0.8,
  /** How far the stem bows toward the middle, as a share of its cherry's offset. */
  stemBowShare: 0.4,
  stemBowY: -0.1,
  leafUpperBow: [pt(0.18, -0.44), pt(0.36, -0.36)],
  leafTip: pt(0.34, -0.22),
  leafLowerBow: [pt(0.22, -0.2), pt(0.1, -0.24)],
  /** The glint on each cherry, as shares of the cherry's radius. */
  shine: { left: 0.35, up: 0.4, rx: 0.28, ry: 0.14 },
} as const;

const LEMON = {
  rx: 0.36,
  ry: 0.26,
  /** The pointed ends reach past the body, as a share of its half-width. */
  tipReach: 1.08,
  /** The bezier handles overshoot the body's half-height by this share. */
  bulge: 1.35,
  leaf: { x: -0.05, lift: 0.04, rx: 0.11, ry: 0.045, tilt: -0.4 },
  /** The glint, as shares of the body's half-width and half-height. */
  shine: { x: -0.35, y: -0.45, rx: 0.3, ry: 0.16 },
} as const;

/** Bell proportions; the `…X` values are shares of the bell's half-width. */
const BELL = {
  halfWidth: 0.34,
  top: -0.36,
  rim: 0.24,
  crownKnob: { lift: 0.02, radius: 0.05 },
  shoulderX: 0.45,
  shoulderDrop: 0.08,
  crownBowX: 0.5,
  crownBowLift: 0.06,
  upperFlareX: 0.62,
  upperFlareRise: 0.16,
  lowerFlareX: 0.75,
  lowerFlareRise: 0.06,
  lipX: 1.05,
  lipDepth: 0.05,
  clapper: { drop: 0.08, radius: 0.065 },
  shine: { x: -0.35, drop: 0.2, rx: 0.05, ry: 0.12 },
} as const;

const BAR = {
  width: 0.82,
  height: 0.38,
  cornerRadius: 0.07,
  rimInset: 0.04,
  stripeHeight: 0.025,
  textDrop: 0.01,
  textSize: 0.24,
} as const;

/** Mongo's disc; the ring and clip are shares of the disc's radius. */
const MONGO_DISC = {
  radius: 0.42,
  ringRadius: 0.88,
  ringWidth: 0.03,
  clipRadius: 0.86,
} as const;

const MONGO_CREST_OUTLINE: UnitPath = {
  from: pt(-0.06, -0.26),
  segments: [
    { quad: [pt(-0.18, -0.38), pt(-0.24, -0.22)] },
    { quad: [pt(-0.32, -0.36), pt(-0.34, -0.12)] },
  ],
};

/** Neck, crown, snout and jaw, back to the neck. */
const MONGO_HEAD_OUTLINE: UnitPath = {
  from: pt(-0.3, 0.34),
  segments: [
    { quad: [pt(-0.36, -0.06), pt(-0.18, -0.24)] },
    { quad: [pt(0.04, -0.36), pt(0.2, -0.2)] },
    { quad: [pt(0.36, -0.12), pt(0.36, 0)] },
    { quad: [pt(0.36, 0.1), pt(0.22, 0.11)] },
    { line: pt(-0.02, 0.12) },
    { quad: [pt(-0.08, 0.2), pt(-0.06, 0.34)] },
  ],
};

const MONGO_HEAD = {
  hideTop: -0.3,
  hideBottom: 0.3,
  mouth: { from: pt(-0.02, 0.03), bow: pt(0.16, 0.1), to: pt(0.33, 0.02), width: 0.025 },
  teeth: {
    count: 4,
    firstX: 0.04,
    spacing: 0.065,
    gumY: 0.05,
    /** Each tooth sits a touch lower than the last, following the grin. */
    stepDown: 0.003,
    width: 0.03,
    tipX: 0.015,
    tipY: 0.1,
  },
  belly: { x: -0.13, y: 0.18, rx: 0.08, ry: 0.12 },
  eye: { x: 0.06, y: -0.13, radius: 0.075 },
  pupil: { x: 0.08, y: -0.13, radius: 0.038 },
  eyeShine: { x: 0.05, y: -0.16, rx: 0.018, ry: 0.012 },
  nostril: { x: 0.3, y: -0.07, radius: 0.012 },
} as const;

/** Tiara proportions; each spire's `x` is a share of the band's half-width. */
const TIARA = {
  halfWidth: 0.4,
  base: 0.2,
  spires: [
    { x: -1, peak: -0.02 },
    { x: -0.5, peak: -0.18 },
    { x: 0, peak: -0.36 },
    { x: 0.5, peak: -0.18 },
    { x: 1, peak: -0.02 },
  ],
  valleyRise: 0.14,
  bandSag: 0.1,
  metalTop: -0.36,
  pearlRadius: 0.035,
  gem: { lift: 0.05, top: 0.13, halfWidth: 0.08, bottom: 0.08, glowRadius: 0.1 },
  /** The side gems sit out along the band as a share of its half-width. */
  sideGem: { x: 0.55, drop: 0.01, radius: 0.045 },
  shine: { x: -0.02, lift: 0.06, rx: 0.02, ry: 0.035 },
} as const;

/** Shaft, instep, toe, sole and heel, back to the shaft. */
const BOOT_OUTLINE: UnitPath = {
  from: pt(-0.24, -0.4),
  segments: [
    { line: pt(0.06, -0.4) },
    { line: pt(0.08, -0.04) },
    { cubic: [pt(0.2, 0.02), pt(0.38, 0.06), pt(0.42, 0.2)] },
    { quad: [pt(0.44, 0.3), pt(0.36, 0.3)] },
    { line: pt(-0.26, 0.3) },
    { quad: [pt(-0.32, 0.12), pt(-0.26, -0.05)] },
  ],
};

const BOOT_TOE_CAP: UnitPath = {
  from: pt(0.22, 0.07),
  segments: [{ cubic: [pt(0.34, 0.09), pt(0.42, 0.14), pt(0.42, 0.22)] }, { line: pt(0.2, 0.22) }],
};

const BOOTS = {
  top: -0.4,
  sole: 0.3,
  leatherFrom: -0.3,
  leatherTo: 0.42,
  soleStrip: { x: -0.28, rise: 0.08, width: 0.72, height: 0.1, radius: 0.03 },
  cuff: { x: -0.26, lift: 0.02, width: 0.34, height: 0.08, radius: 0.02 },
  laces: {
    count: 4,
    width: 0.028,
    firstDrop: 0.14,
    spacing: 0.085,
    innerX: -0.04,
    innerDrop: 0.03,
    outerX: 0.08,
    /** Each lace reaches a little further out than the one above, following the instep. */
    outerStep: 0.015,
  },
  shine: { x: -0.14, drop: 0.24, rx: 0.03, ry: 0.13 },
} as const;

const SEVEN = {
  left: -0.3,
  right: 0.32,
  top: -0.36,
  barBottom: -0.2,
  stemFoot: 0.38,
  /** The bar's right end drops below the bar before the stem curves away. */
  barEndDrop: 0.02,
  stemFrontBow: pt(-0.02, 0.06),
  stemFrontFootX: -0.04,
  stemBackFootX: -0.24,
  stemBackBow: pt(-0.2, 0.02),
  barInnerX: 0.1,
  /** The serif notch under the bar's left end. */
  serif: { innerX: 0.08, outerX: 0.06, drop: 0.06 },
  rimWidth: 0.12,
  rimGlintWidth: 0.08,
  rimSpan: 0.4,
  faceTop: -0.36,
  faceBottom: 0.38,
  shine: { x: -0.12, y: -0.31, rx: 0.12, ry: 0.025 },
} as const;

/** The wild: a gold seal bearing a hooded figure, laid over two crossed daggers. */
const WILD_SEAL = {
  centreY: -0.05,
  radius: 0.2,
  rimWidth: 0.022,
  /** Each dagger lies this far off vertical, one each way. */
  daggerTilt: Math.PI / 4,
  tipReach: 0.47,
  bladeHalfWidth: 0.065,
  guardY: 0.22,
  guardHalfWidth: 0.12,
  guardThickness: 0.04,
  gripEndY: 0.36,
  gripHalfWidth: 0.03,
  pommelRadius: 0.045,
  hood: {
    peakY: -0.15,
    crownHalfWidth: 0.09,
    crownY: -0.06,
    shoulderHalfWidth: 0.18,
    shoulderY: 0.09,
    faceY: -0.03,
    faceRx: 0.04,
    faceRy: 0.055,
  },
  textY: 0.36,
  textSize: 0.15,
  textOutline: 0.04,
} as const;

const LOOT_BOX = {
  glowRadius: 0.5,
  width: 0.62,
  bodyTop: -0.08,
  bodyHeight: 0.4,
  lidHeight: 0.16,
  cornerRadius: 0.04,
  lidOverhang: 0.03,
  lidOverhangBothSides: 0.06,
  bandWidth: 0.09,
  bow: { x: 0.08, lift: 0.06, rx: 0.08, ry: 0.05, tilt: 0.5 },
  /** The label's height on the box, as a share of the body's height. */
  textAt: 0.62,
  textSize: 0.11,
  textOutline: 0.02,
} as const;

// ── Painters, each in a square of side `s` centred on the origin ─────────────

const paintCherries: Painter = (ctx, s) => {
  dropShadow(ctx, s);
  const r = s * CHERRIES.radius;
  const left = { x: s * CHERRIES.left.x, y: s * CHERRIES.left.y };
  const right = { x: s * CHERRIES.right.x, y: s * CHERRIES.right.y };
  const top = { x: s * CHERRIES.stemTop.x, y: s * CHERRIES.stemTop.y };
  const [upperBowA, upperBowB] = CHERRIES.leafUpperBow;
  const [lowerBowA, lowerBowB] = CHERRIES.leafLowerBow;
  const leafTip = { x: s * CHERRIES.leafTip.x, y: s * CHERRIES.leafTip.y };
  ctx.lineCap = 'round';
  ctx.strokeStyle = ink.stem;
  ctx.lineWidth = s * CHERRIES.stemWidth;
  for (const cherry of [left, right]) {
    ctx.beginPath();
    ctx.moveTo(cherry.x, cherry.y - r * CHERRIES.stemRootRise);
    ctx.quadraticCurveTo(cherry.x * CHERRIES.stemBowShare, s * CHERRIES.stemBowY, top.x, top.y);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.bezierCurveTo(
    s * upperBowA.x,
    s * upperBowA.y,
    s * upperBowB.x,
    s * upperBowB.y,
    leafTip.x,
    leafTip.y,
  );
  ctx.bezierCurveTo(
    s * lowerBowA.x,
    s * lowerBowA.y,
    s * lowerBowB.x,
    s * lowerBowB.y,
    top.x,
    top.y,
  );
  outlined(
    ctx,
    s,
    linear(ctx, top.x, top.y, leafTip.x, leafTip.y, [
      [0, ink.leafDark],
      [1, ink.leaf],
    ]),
  );
  const glint = CHERRIES.shine;
  for (const cherry of [left, right]) {
    ctx.beginPath();
    ctx.arc(cherry.x, cherry.y, r, 0, TWO_PI);
    outlined(
      ctx,
      s,
      radial(ctx, cherry.x, cherry.y, r, [
        [0, ink.cherryLight],
        [0.55, ink.cherry],
        [1, ink.cherryDark],
      ]),
    );
    shine(ctx, cherry.x - r * glint.left, cherry.y - r * glint.up, r * glint.rx, r * glint.ry);
  }
};

const paintLemon: Painter = (ctx, s) => {
  dropShadow(ctx, s);
  const rx = s * LEMON.rx;
  const ry = s * LEMON.ry;
  const tipX = rx * LEMON.tipReach;
  ctx.beginPath();
  ctx.moveTo(-tipX, 0);
  ctx.bezierCurveTo(-rx, -ry * LEMON.bulge, rx, -ry * LEMON.bulge, tipX, 0);
  ctx.bezierCurveTo(rx, ry * LEMON.bulge, -rx, ry * LEMON.bulge, -tipX, 0);
  outlined(
    ctx,
    s,
    radial(ctx, 0, 0, rx, [
      [0, ink.lemonLight],
      [0.6, ink.lemon],
      [1, ink.lemonDark],
    ]),
  );
  const leaf = LEMON.leaf;
  ctx.beginPath();
  ctx.ellipse(s * leaf.x, -ry - s * leaf.lift, s * leaf.rx, s * leaf.ry, leaf.tilt, 0, TWO_PI);
  outlined(ctx, s, ink.leaf);
  shine(ctx, rx * LEMON.shine.x, ry * LEMON.shine.y, rx * LEMON.shine.rx, ry * LEMON.shine.ry);
};

const paintBell: Painter = (ctx, s) => {
  dropShadow(ctx, s);
  const w = s * BELL.halfWidth;
  const top = s * BELL.top;
  const rim = s * BELL.rim;
  const shoulderY = top + s * BELL.shoulderDrop;
  const crownBowY = top - s * BELL.crownBowLift;
  const upperFlareY = rim - s * BELL.upperFlareRise;
  const lowerFlareY = rim - s * BELL.lowerFlareRise;
  ctx.beginPath();
  ctx.arc(0, top - s * BELL.crownKnob.lift, s * BELL.crownKnob.radius, 0, TWO_PI);
  outlined(ctx, s, ink.bellDark);
  ctx.beginPath();
  ctx.moveTo(-w * BELL.shoulderX, shoulderY);
  ctx.bezierCurveTo(
    -w * BELL.crownBowX,
    crownBowY,
    w * BELL.crownBowX,
    crownBowY,
    w * BELL.shoulderX,
    shoulderY,
  );
  ctx.bezierCurveTo(
    w * BELL.upperFlareX,
    upperFlareY,
    w * BELL.lowerFlareX,
    lowerFlareY,
    w * BELL.lipX,
    rim,
  );
  ctx.lineTo(-w * BELL.lipX, rim);
  ctx.bezierCurveTo(
    -w * BELL.lowerFlareX,
    lowerFlareY,
    -w * BELL.upperFlareX,
    upperFlareY,
    -w * BELL.shoulderX,
    shoulderY,
  );
  outlined(
    ctx,
    s,
    linear(ctx, -w, 0, w, 0, [
      [0, ink.bellDark],
      [0.3, ink.bellLight],
      [0.6, ink.bell],
      [1, ink.bellDark],
    ]),
  );
  ctx.beginPath();
  ctx.ellipse(0, rim, w * BELL.lipX, s * BELL.lipDepth, 0, 0, TWO_PI);
  outlined(ctx, s, ink.bell);
  ctx.beginPath();
  ctx.arc(0, rim + s * BELL.clapper.drop, s * BELL.clapper.radius, 0, TWO_PI);
  outlined(ctx, s, ink.clapper);
  shine(ctx, w * BELL.shine.x, top + s * BELL.shine.drop, s * BELL.shine.rx, s * BELL.shine.ry);
};

const paintBar: Painter = (ctx, s) => {
  dropShadow(ctx, s);
  const w = s * BAR.width;
  const h = s * BAR.height;
  const radius = s * BAR.cornerRadius;
  ctx.beginPath();
  ctx.roundRect(-w * HALF, -h * HALF, w, h, radius);
  outlined(
    ctx,
    s,
    linear(ctx, 0, -h * HALF, 0, h * HALF, [
      [0, ink.barRim],
      [0.5, ink.barRim],
      [1, ink.barRim],
    ]),
  );
  const innerInset = s * BAR.rimInset;
  ctx.beginPath();
  ctx.roundRect(
    -w * HALF + innerInset,
    -h * HALF + innerInset,
    w - innerInset * 2,
    h - innerInset * 2,
    radius * HALF,
  );
  ctx.fillStyle = ink.barPlate;
  ctx.fill();
  const stripeH = s * BAR.stripeHeight;
  ctx.fillStyle = ink.barStripe;
  ctx.fillRect(-w * HALF + innerInset, -h * HALF + innerInset * 2, w - innerInset * 2, stripeH);
  ctx.fillRect(
    -w * HALF + innerInset,
    h * HALF - innerInset * 2 - stripeH,
    w - innerInset * 2,
    stripeH,
  );
  worldText(ctx, 'BAR', {
    x: 0,
    y: s * BAR.textDrop,
    size: s * BAR.textSize,
    bold: true,
    color: ink.barText,
    family: UI_FONT_STACK,
    align: 'center',
    baseline: 'middle',
  });
};

const paintMongo: Painter = (ctx, s) => {
  dropShadow(ctx, s);
  const r = s * MONGO_DISC.radius;
  ctx.beginPath();
  ctx.arc(0, 0, r, 0, TWO_PI);
  outlined(
    ctx,
    s,
    radial(ctx, 0, 0, r, [
      [0, ink.mongoDiscLight],
      [0.65, ink.mongoDisc],
      [1, ink.mongoDiscDark],
    ]),
  );
  ctx.beginPath();
  ctx.arc(0, 0, r * MONGO_DISC.ringRadius, 0, TWO_PI);
  ctx.lineWidth = s * MONGO_DISC.ringWidth;
  ctx.strokeStyle = ink.sevenRim;
  ctx.stroke();
  ctx.save();
  ctx.beginPath();
  ctx.arc(0, 0, r * MONGO_DISC.clipRadius, 0, TWO_PI);
  ctx.clip();
  paintMongoHead(ctx, s);
  ctx.restore();
};

/** Mongo's head in profile, grinning: his own hide colours, his pink crest and a big bright eye. */
function paintMongoHead(ctx: CanvasRenderingContext2D, s: number): void {
  traceUnitPath(ctx, s, MONGO_CREST_OUTLINE);
  outlined(ctx, s, MONGO_CREST);
  traceUnitPath(ctx, s, MONGO_HEAD_OUTLINE);
  outlined(
    ctx,
    s,
    linear(ctx, 0, s * MONGO_HEAD.hideTop, 0, s * MONGO_HEAD.hideBottom, [
      [0, HIDE.light],
      [0.5, HIDE.base],
      [1, HIDE.back],
    ]),
  );
  const { mouth, teeth, belly, eye, pupil, eyeShine, nostril } = MONGO_HEAD;
  ctx.beginPath();
  ctx.moveTo(s * mouth.from.x, s * mouth.from.y);
  ctx.quadraticCurveTo(s * mouth.bow.x, s * mouth.bow.y, s * mouth.to.x, s * mouth.to.y);
  ctx.lineWidth = s * mouth.width;
  ctx.strokeStyle = ink.outline;
  ctx.stroke();
  ctx.fillStyle = ink.mongoTooth;
  for (let i = 0; i < teeth.count; i++) {
    const x = s * teeth.firstX + i * s * teeth.spacing;
    const gumY = s * teeth.gumY + i * s * teeth.stepDown;
    ctx.beginPath();
    ctx.moveTo(x, gumY);
    ctx.lineTo(x + s * teeth.width, gumY);
    ctx.lineTo(x + s * teeth.tipX, s * teeth.tipY);
    ctx.closePath();
    ctx.fill();
  }
  ctx.beginPath();
  ctx.ellipse(s * belly.x, s * belly.y, s * belly.rx, s * belly.ry, 0, 0, TWO_PI);
  ctx.fillStyle = HIDE.belly;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(s * eye.x, s * eye.y, s * eye.radius, 0, TWO_PI);
  outlined(ctx, s, ink.mongoEye);
  ctx.beginPath();
  ctx.arc(s * pupil.x, s * pupil.y, s * pupil.radius, 0, TWO_PI);
  ctx.fillStyle = ink.outline;
  ctx.fill();
  shine(ctx, s * eyeShine.x, s * eyeShine.y, s * eyeShine.rx, s * eyeShine.ry);
  ctx.beginPath();
  ctx.arc(s * nostril.x, s * nostril.y, s * nostril.radius, 0, TWO_PI);
  ctx.fillStyle = HIDE.dorsal;
  ctx.fill();
}

const paintTiara: Painter = (ctx, s) => {
  dropShadow(ctx, s);
  const w = s * TIARA.halfWidth;
  const base = s * TIARA.base;
  const points = TIARA.spires.map((spire) => ({ x: w * spire.x, peak: s * spire.peak }));
  ctx.beginPath();
  ctx.moveTo(-w, base);
  for (let i = 0; i < points.length; i++) {
    const p = points[i];
    ctx.lineTo(p.x, p.peak);
    const next = listAt(points, i + 1);
    if (next !== undefined) ctx.lineTo((p.x + next.x) * HALF, base - s * TIARA.valleyRise);
  }
  ctx.lineTo(w, base);
  ctx.quadraticCurveTo(0, base + s * TIARA.bandSag, -w, base);
  outlined(
    ctx,
    s,
    linear(ctx, 0, s * TIARA.metalTop, 0, base, [
      [0, ink.tiaraMetal],
      [0.6, ink.tiaraMetal],
      [1, ink.tiaraMetalDark],
    ]),
  );
  for (const p of points) {
    ctx.beginPath();
    ctx.arc(p.x, p.peak, s * TIARA.pearlRadius, 0, TWO_PI);
    outlined(ctx, s, ink.tiaraMetal);
  }
  const { gem, sideGem, shine: glint } = TIARA;
  const gemY = base - s * gem.lift;
  ctx.beginPath();
  ctx.moveTo(0, gemY - s * gem.top);
  ctx.lineTo(s * gem.halfWidth, gemY);
  ctx.lineTo(0, gemY + s * gem.bottom);
  ctx.lineTo(-s * gem.halfWidth, gemY);
  ctx.closePath();
  outlined(
    ctx,
    s,
    radial(ctx, 0, gemY, s * gem.glowRadius, [
      [0, ink.tiaraGemLight],
      [1, ink.tiaraGem],
    ]),
  );
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(side * w * sideGem.x, gemY + s * sideGem.drop, s * sideGem.radius, 0, TWO_PI);
    outlined(ctx, s, ink.tiaraSide);
  }
  shine(ctx, s * glint.x, gemY - s * glint.lift, s * glint.rx, s * glint.ry);
};

const paintBoots: Painter = (ctx, s) => {
  dropShadow(ctx, s);
  const top = s * BOOTS.top;
  const sole = s * BOOTS.sole;
  traceUnitPath(ctx, s, BOOT_OUTLINE);
  outlined(
    ctx,
    s,
    linear(ctx, s * BOOTS.leatherFrom, 0, s * BOOTS.leatherTo, 0, [
      [0, ink.bootDark],
      [0.3, ink.bootLight],
      [0.7, ink.boot],
      [1, ink.bootDark],
    ]),
  );
  traceUnitPath(ctx, s, BOOT_TOE_CAP);
  outlined(ctx, s, ink.bootToe);
  const { soleStrip, cuff, laces, shine: glint } = BOOTS;
  ctx.beginPath();
  ctx.roundRect(
    s * soleStrip.x,
    sole - s * soleStrip.rise,
    s * soleStrip.width,
    s * soleStrip.height,
    s * soleStrip.radius,
  );
  outlined(ctx, s, ink.bootSole);
  ctx.beginPath();
  ctx.roundRect(s * cuff.x, top - s * cuff.lift, s * cuff.width, s * cuff.height, s * cuff.radius);
  outlined(ctx, s, ink.bootDark);
  ctx.strokeStyle = ink.bootLace;
  ctx.lineWidth = s * laces.width;
  ctx.lineCap = 'round';
  for (let i = 0; i < laces.count; i++) {
    const y = top + s * laces.firstDrop + i * s * laces.spacing;
    ctx.beginPath();
    ctx.moveTo(s * laces.innerX, y + s * laces.innerDrop);
    ctx.lineTo(s * laces.outerX + i * s * laces.outerStep, y);
    ctx.stroke();
  }
  shine(ctx, s * glint.x, top + s * glint.drop, s * glint.rx, s * glint.ry);
};

/** A golden 7 drawn as a path, so it stays crisp at every size and owes nothing to a font. */
function sevenPath(ctx: CanvasRenderingContext2D, s: number): void {
  const left = s * SEVEN.left;
  const right = s * SEVEN.right;
  const top = s * SEVEN.top;
  const barBottom = s * SEVEN.barBottom;
  const stemFoot = s * SEVEN.stemFoot;
  const serifY = barBottom + s * SEVEN.serif.drop;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.lineTo(right, top);
  ctx.lineTo(right, barBottom + s * SEVEN.barEndDrop);
  ctx.quadraticCurveTo(
    s * SEVEN.stemFrontBow.x,
    s * SEVEN.stemFrontBow.y,
    s * SEVEN.stemFrontFootX,
    stemFoot,
  );
  ctx.lineTo(s * SEVEN.stemBackFootX, stemFoot);
  ctx.quadraticCurveTo(
    s * SEVEN.stemBackBow.x,
    s * SEVEN.stemBackBow.y,
    s * SEVEN.barInnerX,
    barBottom,
  );
  ctx.lineTo(left + s * SEVEN.serif.innerX, barBottom);
  ctx.lineTo(left + s * SEVEN.serif.outerX, serifY);
  ctx.lineTo(left, serifY);
  ctx.closePath();
}

const paintSeven: Painter = (ctx, s) => {
  dropShadow(ctx, s);
  sevenPath(ctx, s);
  ctx.lineJoin = 'round';
  ctx.lineWidth = s * SEVEN.rimWidth;
  ctx.strokeStyle = ink.sevenRimDark;
  ctx.stroke();
  ctx.lineWidth = s * SEVEN.rimGlintWidth;
  ctx.strokeStyle = linear(ctx, 0, -s * SEVEN.rimSpan, 0, s * SEVEN.rimSpan, [
    [0, ink.sealLight],
    [0.5, ink.sevenRim],
    [1, ink.sevenRimDark],
  ]);
  ctx.stroke();
  ctx.fillStyle = linear(ctx, 0, s * SEVEN.faceTop, 0, s * SEVEN.faceBottom, [
    [0, ink.sevenLight],
    [0.45, ink.seven],
    [1, ink.sevenDark],
  ]);
  ctx.fill();
  const glint = SEVEN.shine;
  shine(ctx, s * glint.x, s * glint.y, s * glint.rx, s * glint.ry);
};

/** One dagger lying along its own axis, tip up, centred on the seal. */
function paintDagger(ctx: CanvasRenderingContext2D, s: number, tilt: number): void {
  const d = WILD_SEAL;
  ctx.save();
  ctx.translate(0, s * d.centreY);
  ctx.rotate(tilt);
  ctx.beginPath();
  ctx.moveTo(0, -s * d.tipReach);
  ctx.lineTo(s * d.bladeHalfWidth, s * d.guardY);
  ctx.lineTo(-s * d.bladeHalfWidth, s * d.guardY);
  ctx.closePath();
  outlined(
    ctx,
    s,
    linear(ctx, -s * d.bladeHalfWidth, 0, s * d.bladeHalfWidth, 0, [
      [0, ink.daggerBlade],
      [1, ink.daggerBladeDark],
    ]),
  );
  ctx.beginPath();
  ctx.rect(
    -s * d.gripHalfWidth,
    s * d.guardY,
    s * d.gripHalfWidth * 2,
    s * (d.gripEndY - d.guardY),
  );
  outlined(ctx, s, ink.daggerGrip);
  ctx.beginPath();
  ctx.rect(
    -s * d.guardHalfWidth,
    s * (d.guardY - d.guardThickness * HALF),
    s * d.guardHalfWidth * 2,
    s * d.guardThickness,
  );
  outlined(ctx, s, ink.seal);
  ctx.beginPath();
  ctx.arc(0, s * d.gripEndY, s * d.pommelRadius, 0, TWO_PI);
  outlined(ctx, s, ink.seal);
  ctx.restore();
}

function hoodPath(ctx: CanvasRenderingContext2D, s: number): void {
  const h = WILD_SEAL.hood;
  const y0 = s * WILD_SEAL.centreY;
  ctx.beginPath();
  ctx.moveTo(0, y0 + s * h.peakY);
  ctx.quadraticCurveTo(
    s * h.crownHalfWidth,
    y0 + s * h.peakY,
    s * h.crownHalfWidth,
    y0 + s * h.crownY,
  );
  ctx.quadraticCurveTo(
    s * h.crownHalfWidth,
    y0 + s * h.shoulderY * HALF,
    s * h.shoulderHalfWidth,
    y0 + s * h.shoulderY,
  );
  ctx.lineTo(s * h.shoulderHalfWidth, y0 + s * WILD_SEAL.radius);
  ctx.lineTo(-s * h.shoulderHalfWidth, y0 + s * WILD_SEAL.radius);
  ctx.lineTo(-s * h.shoulderHalfWidth, y0 + s * h.shoulderY);
  ctx.quadraticCurveTo(
    -s * h.crownHalfWidth,
    y0 + s * h.shoulderY * HALF,
    -s * h.crownHalfWidth,
    y0 + s * h.crownY,
  );
  ctx.quadraticCurveTo(-s * h.crownHalfWidth, y0 + s * h.peakY, 0, y0 + s * h.peakY);
  ctx.closePath();
}

const paintWild: Painter = (ctx, s) => {
  const seal = WILD_SEAL;
  const cy = s * seal.centreY;
  const r = s * seal.radius;
  dropShadow(ctx, s);
  paintDagger(ctx, s, -seal.daggerTilt);
  paintDagger(ctx, s, seal.daggerTilt);

  ctx.beginPath();
  ctx.arc(0, cy, r, 0, TWO_PI);
  outlined(
    ctx,
    s,
    radial(ctx, 0, cy, r, [
      [0, ink.sealLight],
      [0.55, ink.seal],
      [1, ink.sealDark],
    ]),
  );

  ctx.save();
  ctx.beginPath();
  ctx.arc(0, cy, r - s * seal.rimWidth, 0, TWO_PI);
  ctx.clip();
  hoodPath(ctx, s);
  ctx.fillStyle = linear(ctx, 0, cy - r, 0, cy + r, [
    [0, ink.hoodLight],
    [1, ink.hood],
  ]);
  ctx.fill();
  const h = seal.hood;
  ctx.beginPath();
  ctx.ellipse(0, cy + s * h.faceY, s * h.faceRx, s * h.faceRy, 0, 0, TWO_PI);
  ctx.fillStyle = ink.outline;
  ctx.fill();
  ctx.restore();

  ctx.beginPath();
  ctx.arc(0, cy, r - s * seal.rimWidth, 0, TWO_PI);
  ctx.lineWidth = s * seal.rimWidth;
  ctx.strokeStyle = ink.sealDark;
  ctx.stroke();

  worldText(ctx, 'WILD', {
    x: 0,
    y: s * seal.textY,
    size: s * seal.textSize,
    bold: true,
    color: ink.sealText,
    outline: ink.sealLight,
    outlineWidth: s * seal.textOutline,
    family: UI_FONT_STACK,
    align: 'center',
    baseline: 'middle',
  });
};

const paintScatter: Painter = (ctx, s) => {
  const glowR = s * LOOT_BOX.glowRadius;
  ctx.fillStyle = radial(ctx, 0, 0, glowR, [
    [0, ink.boxGlow],
    [1, slotsInk.reel.curveFade],
  ]);
  ctx.fillRect(-s * HALF, -s * HALF, s, s);
  const w = s * LOOT_BOX.width;
  const bodyTop = s * LOOT_BOX.bodyTop;
  const bodyH = s * LOOT_BOX.bodyHeight;
  const lidH = s * LOOT_BOX.lidHeight;
  const corner = s * LOOT_BOX.cornerRadius;
  ctx.beginPath();
  ctx.roundRect(-w * HALF, bodyTop, w, bodyH, corner);
  outlined(
    ctx,
    s,
    linear(ctx, 0, bodyTop, 0, bodyTop + bodyH, [
      [0, ink.boxLight],
      [0.4, ink.box],
      [1, ink.boxDark],
    ]),
  );
  ctx.beginPath();
  ctx.roundRect(
    -w * HALF - s * LOOT_BOX.lidOverhang,
    bodyTop - lidH,
    w + s * LOOT_BOX.lidOverhangBothSides,
    lidH,
    corner,
  );
  outlined(ctx, s, ink.box);
  const band = s * LOOT_BOX.bandWidth;
  ctx.beginPath();
  ctx.rect(-band * HALF, bodyTop - lidH, band, bodyH + lidH);
  outlined(ctx, s, ink.boxBand);
  const bow = LOOT_BOX.bow;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(
      side * s * bow.x,
      bodyTop - lidH - s * bow.lift,
      s * bow.rx,
      s * bow.ry,
      side * bow.tilt,
      0,
      TWO_PI,
    );
    outlined(ctx, s, ink.boxBand);
  }
  worldText(ctx, 'FREE', {
    x: 0,
    y: bodyTop + bodyH * LOOT_BOX.textAt,
    size: s * LOOT_BOX.textSize,
    bold: true,
    color: ink.boxText,
    outline: ink.outline,
    outlineWidth: s * LOOT_BOX.textOutline,
    family: UI_FONT_STACK,
    align: 'center',
    baseline: 'middle',
  });
};

const PAINTERS: Readonly<Record<SlotSymbol, Painter>> = {
  cherries: paintCherries,
  lemon: paintLemon,
  bell: paintBell,
  bar: paintBar,
  mongo: paintMongo,
  tiara: paintTiara,
  boots: paintBoots,
  seven: paintSeven,
  wild: paintWild,
  scatter: paintScatter,
};

/** Paints `symbol` straight into `ctx`, centred in the given cell. For the rules sheet and previews. */
export function paintSlotSymbol(
  ctx: CanvasRenderingContext2D,
  symbol: SlotSymbol,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const side = Math.min(w, h) * (1 - SYMBOL_PADDING * 2);
  ctx.save();
  ctx.translate(x + w * HALF, y + h * HALF);
  PAINTERS[symbol](ctx, side);
  ctx.restore();
}
