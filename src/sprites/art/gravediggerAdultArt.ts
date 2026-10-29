/**
 * The painter library behind the adult Gravedigger Beetle — a sexton beetle
 * the size of a dog, always on the wing.
 *
 * What makes the shape read as *this* beetle rather than as a generic bug:
 *
 *   - a **glossy black armoured body** — a domed pronotum shield, a small head
 *     tucked under its front edge, a heavy segmented abdomen;
 *   - **two jagged orange-red bands** across each wing case, the sexton
 *     beetle's own warning colours and the one thing on it that is not black;
 *   - **orange club tips** on the short antennae;
 *   - **oversized, curved mandibles** like shears, which are its bite and the
 *     first thing the eye finds;
 *   - in flight the **wing cases are raised** off the back and the membranous
 *     hind wings beneath them are a **blur**, never solid paddles.
 *
 * Skin is painted through `paintChitin` (from `mantidArt.ts`), the generic
 * directional-gradient engine every insect in the game shares.
 *
 * Coordinates are tile units, +Y down, origin at the tile centre. The side
 * view faces +X (head foremost); the runtime mirrors it for the other
 * direction.
 */

import {
  TWO_PI,
  clamp01,
  deg,
  easeInOut,
  lerp,
  ovalOutline,
  paintChitin,
  ramp,
  rgba,
  segmentOutline,
  traceOutline,
  type MantidBuild,
  type Pt,
} from './mantidArt';

type Ctx = CanvasRenderingContext2D;

export type { Pt };

// ── Palette ──────────────────────────────────────────────────────────────────

export interface BeetlePalette {
  readonly shell: string;
  readonly shellDark: string;
  readonly shellLight: string;
  readonly shellRim: string;
  readonly ink: string;
  readonly band: string;
  readonly bandDark: string;
  readonly bandLight: string;
  readonly club: string;
  readonly wing: string;
  readonly eye: string;
  /** The fire gathering in its mouth before it spits. */
  readonly glow: string;
  readonly glowCore: string;
}

export const GRAVEDIGGER_PALETTE: BeetlePalette = {
  shell: '#1c1a21',
  shellDark: '#050407',
  shellLight: '#77738a',
  shellRim: '#a6abc8',
  ink: '#030203',
  band: '#dc561c',
  bandDark: '#7e240a',
  bandLight: '#ff9a4a',
  club: '#f08a2a',
  wing: '#d9c9a4',
  eye: '#2a1e1a',
  glow: '#ff7a1e',
  glowCore: '#fff0a8',
};

const SEED = 21.4;

function shellBuild(palette: BeetlePalette): MantidBuild {
  return {
    palette: {
      base: palette.shell,
      dark: palette.shellDark,
      light: palette.shellLight,
      rim: palette.shellRim,
      ink: palette.ink,
      sheen: palette.shellRim,
      eye: palette.eye,
      eyeDark: palette.ink,
      membrane: palette.wing,
      spine: palette.shellLight,
    },
    wingWear: 0,
    scarring: 0,
    heft: 0,
    iridescence: 0.35,
    seed: SEED,
  };
}

const SHELL = shellBuild(GRAVEDIGGER_PALETTE);

// ── Anatomy (tile units) ─────────────────────────────────────────────────────

/** The ground line beneath the hovering beetle; scale is applied about it. */
export const GROUND_Y = 0.4;
/** How high above the ground the body hovers at rest. */
const HOVER_HEIGHT = 0.4;
const BODY_Y = GROUND_Y - HOVER_HEIGHT;

const PRONOTUM_X = 0.06;
const PRONOTUM_RX = 0.085;
const PRONOTUM_RY = 0.068;
export const HEAD_X = 0.165;
const HEAD_Y_OFFSET = 0.022;
export const HEAD_RADIUS = 0.045;
export const EYE_RADIUS = 0.016;
const ABDOMEN_ROOT_X = -0.02;
const ABDOMEN_TIP_X = -0.24;
const ABDOMEN_HALF_ROOT = 0.07;
const ABDOMEN_HALF_TIP = 0.035;
const ABDOMEN_DROOP = 0.035;
const ABDOMEN_SEGMENTS = 5;

/** Mandibles: oversized and curved, the creature's signature. */
export const MANDIBLE_LENGTH = 0.15;
const MANDIBLE_ROOT_HALF = 0.026;
const MANDIBLE_TIP_HALF = 0.004;
const MANDIBLE_BOW = 0.045;
const MANDIBLE_CLOSED_SPREAD = deg(8);
const MANDIBLE_OPEN_SPREAD = deg(46);
/**
 * In profile both jaws lie almost on top of each other, both curving up at the
 * tip like one great shear; a gape splits them, the far one up and the near one
 * down, by this share of the spread each.
 */
const SIDE_MANDIBLE_SPLIT = 0.6;

const ELYTRON_HINGE: Pt = { x: 0.0, y: -0.035 };
const ELYTRON_LENGTH = 0.26;
const ELYTRON_HALF_ROOT = 0.05;
const ELYTRON_HALF_MID = 0.075;
/** Raised in flight: the angle a wing case lifts off the back, above horizontal. */
const ELYTRON_FLIGHT_LIFT = deg(38);
/** The two jagged bands across each wing case, as fractions of its length. */
const BAND_POSITIONS: readonly number[] = [0.28, 0.66];
const BAND_WIDTH_SHARE = 0.17;
const BAND_TEETH = 9;
const BAND_JAG_SHARE = 0.18;

const WING_ROOT: Pt = { x: -0.01, y: -0.03 };
export const WING_LENGTH = 0.36;
const WING_HALF = 0.1;
const WING_BEAT_RANGE = deg(55);
const WING_REST_ANGLE = deg(-140);
const WING_BLUR_ALPHA = 0.22;
const WING_MAIN_ALPHA = 0.55;
const WING_BLUR_SPREAD = 0.45;

const ANTENNA_LENGTH = 0.11;
const ANTENNA_WIDTH = 0.008;
const CLUB_RADIUS = 0.019;

const LEG_ROOTS_X: readonly number[] = [0.08, 0.04, 0.0];
const LEG_ROOT_Y = 0.04;
const LEG_UPPER = 0.09;
const LEG_LOWER = 0.1;
const LEG_HALF_ROOT = 0.013;
const LEG_HALF_TIP = 0.005;
const LEG_PAIR_FAN = deg(18);

const GLOW_RADIUS = 0.07;
const SHELL_GLOSS = 1;
const LIMB_GLOSS = 0.3;
const LIMB_CONTOUR = 0.7;
const FAR_SIDE_SHADE = 0.45;

// ── Pose ─────────────────────────────────────────────────────────────────────

export interface LegDangle {
  readonly swing: number;
  readonly tuck: number;
}

export interface BeetlePose {
  readonly bob: number;
  /** Body pitch, radians; negative rears the head up. */
  readonly lean: number;
  /** How far the whole body drives forward along its facing. */
  readonly lunge: number;
  readonly headPitch: number;
  /** 0 mandibles shut, 1 gaping wide. */
  readonly mandibleOpen: number;
  /** 0 no fire in the mouth, 1 full glow just before it spits. */
  readonly mouthGlow: number;
  /** 0–1 phase of the wingbeat. */
  readonly wingbeat: number;
  /** Extra lift on the wing cases over the flight rest. */
  readonly elytraLift: number;
  readonly legs: readonly [LegDangle, LegDangle, LegDangle];
  readonly time: number;
}

const REST_LEG: LegDangle = { swing: 0, tuck: 0 };

export function restBeetlePose(): BeetlePose {
  return {
    bob: 0,
    lean: 0,
    lunge: 0,
    headPitch: 0,
    mandibleOpen: 0,
    mouthGlow: 0,
    wingbeat: 0,
    elytraLift: 0,
    legs: [REST_LEG, REST_LEG, REST_LEG],
    time: 0,
  };
}

// ── Shared parts ─────────────────────────────────────────────────────────────

function wingBlade(ctx: Ctx, root: Pt, angle: number, side: number, alpha: number): void {
  const tip: Pt = {
    x: root.x + Math.cos(angle) * WING_LENGTH,
    y: root.y + Math.sin(angle) * WING_LENGTH,
  };
  const outline = segmentOutline(root, tip, WING_HALF * 0.25, WING_HALF, 0.04 * side);
  ctx.save();
  ctx.globalAlpha *= alpha;
  traceOutline(ctx, outline);
  ctx.fillStyle = rgba(GRAVEDIGGER_PALETTE.wing, 0.6);
  ctx.fill();
  ctx.strokeStyle = rgba(GRAVEDIGGER_PALETTE.ink, 0.45);
  ctx.lineWidth = 0.005;
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(root.x, root.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.strokeStyle = rgba(GRAVEDIGGER_PALETTE.bandDark, 0.4);
  ctx.lineWidth = 0.004;
  ctx.stroke();
  ctx.restore();
}

/** One hind wing as a blur: the beat's two extremes faint, its current angle firmer. */
function blurredWing(ctx: Ctx, root: Pt, restAngle: number, beat: number, side: number): void {
  const swing = Math.sin(beat * TWO_PI);
  for (const offset of [-1, 1]) {
    wingBlade(
      ctx,
      root,
      restAngle + side * offset * WING_BEAT_RANGE * WING_BLUR_SPREAD,
      side,
      WING_BLUR_ALPHA,
    );
  }
  wingBlade(ctx, root, restAngle + side * swing * WING_BEAT_RANGE * 0.5, side, WING_MAIN_ALPHA);
}

/** A wing case's outline: a domed shell from its hinge out to a rounded tip. */
function elytronOutline(hinge: Pt, angle: number, length: number, widthScale: number): Pt[] {
  const tip: Pt = { x: hinge.x + Math.cos(angle) * length, y: hinge.y + Math.sin(angle) * length };
  const mid: Pt = { x: (hinge.x + tip.x) / 2, y: (hinge.y + tip.y) / 2 };
  const root = segmentOutline(
    hinge,
    mid,
    ELYTRON_HALF_ROOT * widthScale,
    ELYTRON_HALF_MID * widthScale,
    0,
    8,
  );
  const end = segmentOutline(
    mid,
    tip,
    ELYTRON_HALF_MID * widthScale,
    ELYTRON_HALF_ROOT * 0.4 * widthScale,
    0,
    8,
  );
  return mergeCapsules(root, end);
}

/** Joins two capsules end to end into one outline: the first's near side, the second, the first's far side. */
function mergeCapsules(first: readonly Pt[], second: readonly Pt[]): Pt[] {
  const half = Math.floor(first.length / 2);
  const otherHalf = Math.floor(second.length / 2);
  return [
    ...first.slice(0, half),
    ...second.slice(0, otherHalf),
    ...second.slice(otherHalf),
    ...first.slice(half),
  ];
}

/** The two jagged orange bands across a wing case, clipped to its outline. */
function drawBands(
  ctx: Ctx,
  outline: readonly Pt[],
  hinge: Pt,
  angle: number,
  length: number,
  widthScale: number,
  shade: number,
): void {
  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  const ax = Math.cos(angle);
  const ay = Math.sin(angle);
  const nx = -ay;
  const ny = ax;
  const reach = ELYTRON_HALF_MID * widthScale * 1.6;
  const bandWidth = length * BAND_WIDTH_SHARE;
  for (const position of BAND_POSITIONS) {
    const centre = length * position;
    const front: Pt[] = [];
    const back: Pt[] = [];
    for (let i = 0; i <= BAND_TEETH; i++) {
      const across = lerp(-reach, reach, i / BAND_TEETH);
      const jag = (i % 2 === 0 ? 1 : -1) * bandWidth * BAND_JAG_SHARE;
      const along0 = centre - bandWidth / 2 + jag;
      const along1 = centre + bandWidth / 2 - jag;
      front.push({
        x: hinge.x + ax * along0 + nx * across,
        y: hinge.y + ay * along0 + ny * across,
      });
      back.push({ x: hinge.x + ax * along1 + nx * across, y: hinge.y + ay * along1 + ny * across });
    }
    const band = [...front, ...back.reverse()];
    ctx.beginPath();
    ctx.moveTo(band[0].x, band[0].y);
    for (const p of band) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    paintChitinPath(ctx, band, shade);
  }
  ctx.restore();
}

function paintChitinPath(ctx: Ctx, band: readonly Pt[], shade: number): void {
  // A jagged edge is the point of the band, so it is filled as a polygon
  // rather than smoothed through the chitin engine's curve tracer.
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of band) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  const gradient = ctx.createLinearGradient(minX, minY, maxX, maxY);
  const { band: mid, bandLight, bandDark } = GRAVEDIGGER_PALETTE;
  gradient.addColorStop(0, shade > 0 ? mid : bandLight);
  gradient.addColorStop(0.55, shade > 0 ? bandDark : mid);
  gradient.addColorStop(1, bandDark);
  ctx.fillStyle = gradient;
  ctx.fill();
}

function drawElytron(
  ctx: Ctx,
  hinge: Pt,
  angle: number,
  length: number,
  widthScale: number,
  shade: number,
): void {
  const outline = elytronOutline(hinge, angle, length, widthScale);
  paintChitin(ctx, { outline, build: SHELL, gloss: SHELL_GLOSS, shade });
  drawBands(ctx, outline, hinge, angle, length, widthScale, shade);
  traceOutline(ctx, outline);
  ctx.strokeStyle = rgba(GRAVEDIGGER_PALETTE.ink, 0.9);
  ctx.lineWidth = 0.009;
  ctx.stroke();
}

function drawAntenna(ctx: Ctx, root: Pt, angle: number, elbow: number): void {
  const mid: Pt = {
    x: root.x + Math.cos(angle) * ANTENNA_LENGTH * 0.5,
    y: root.y + Math.sin(angle) * ANTENNA_LENGTH * 0.5,
  };
  const tipAngle = angle + elbow;
  const tip: Pt = {
    x: mid.x + Math.cos(tipAngle) * ANTENNA_LENGTH * 0.5,
    y: mid.y + Math.sin(tipAngle) * ANTENNA_LENGTH * 0.5,
  };
  ctx.beginPath();
  ctx.moveTo(root.x, root.y);
  ctx.lineTo(mid.x, mid.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.strokeStyle = GRAVEDIGGER_PALETTE.ink;
  ctx.lineWidth = ANTENNA_WIDTH;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(tip.x, tip.y, CLUB_RADIUS, CLUB_RADIUS * 0.75, tipAngle, 0, TWO_PI);
  ctx.fillStyle = GRAVEDIGGER_PALETTE.club;
  ctx.fill();
  ctx.strokeStyle = rgba(GRAVEDIGGER_PALETTE.bandDark, 0.9);
  ctx.lineWidth = 0.005;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(tip.x - CLUB_RADIUS * 0.3, tip.y - CLUB_RADIUS * 0.3, CLUB_RADIUS * 0.35, 0, TWO_PI);
  ctx.fillStyle = rgba(GRAVEDIGGER_PALETTE.glowCore, 0.6);
  ctx.fill();
}

/** One curved mandible from `root`, its tip hooking back toward `hookSign`. */
function drawMandible(ctx: Ctx, root: Pt, angle: number, hookSign: number, shade: number): void {
  const tip: Pt = {
    x: root.x + Math.cos(angle) * MANDIBLE_LENGTH,
    y: root.y + Math.sin(angle) * MANDIBLE_LENGTH,
  };
  const outline = segmentOutline(
    root,
    tip,
    MANDIBLE_ROOT_HALF,
    MANDIBLE_TIP_HALF,
    MANDIBLE_BOW * hookSign,
    14,
  );
  paintChitin(ctx, { outline, build: SHELL, gloss: 0.8, shade, contour: 1 });
}

function drawGlow(ctx: Ctx, at: Pt, strength: number): void {
  if (strength <= 0) return;
  const radius = GLOW_RADIUS * (0.5 + strength * 0.5);
  const glow = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius);
  glow.addColorStop(0, rgba(GRAVEDIGGER_PALETTE.glowCore, strength));
  glow.addColorStop(0.4, rgba(GRAVEDIGGER_PALETTE.glow, strength * 0.8));
  glow.addColorStop(1, rgba(GRAVEDIGGER_PALETTE.glow, 0));
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, TWO_PI);
  ctx.fill();
}

function drawLegSegment(
  ctx: Ctx,
  root: Pt,
  kneeAngle: number,
  dangle: LegDangle,
  footBend: number,
  shade: number,
): void {
  const upper = LEG_UPPER * (1 - dangle.tuck * 0.3);
  const lower = LEG_LOWER * (1 - dangle.tuck * 0.5);
  const knee: Pt = {
    x: root.x + Math.cos(kneeAngle) * upper,
    y: root.y + Math.sin(kneeAngle) * upper,
  };
  const footAngle = kneeAngle + footBend;
  const foot: Pt = {
    x: knee.x + Math.cos(footAngle) * lower,
    y: knee.y + Math.sin(footAngle) * lower,
  };
  paintChitin(ctx, {
    outline: segmentOutline(root, knee, LEG_HALF_ROOT, LEG_HALF_ROOT * 0.7, 0.006),
    build: SHELL,
    gloss: LIMB_GLOSS,
    contour: LIMB_CONTOUR,
    shade,
  });
  paintChitin(ctx, {
    outline: segmentOutline(knee, foot, LEG_HALF_ROOT * 0.65, LEG_HALF_TIP, -0.005),
    build: SHELL,
    gloss: LIMB_GLOSS,
    contour: LIMB_CONTOUR,
    shade,
  });
}

// ── Side view ────────────────────────────────────────────────────────────────

function sideLegs(ctx: Ctx, pose: BeetlePose, fan: number, shade: number): void {
  pose.legs.forEach((dangle, i) => {
    const root: Pt = { x: LEG_ROOTS_X[i], y: BODY_Y + LEG_ROOT_Y };
    drawLegSegment(ctx, root, deg(70) + dangle.swing + fan + i * deg(14), dangle, deg(45), shade);
  });
}

function drawAbdomenSide(ctx: Ctx): void {
  const root: Pt = { x: ABDOMEN_ROOT_X, y: BODY_Y + 0.01 };
  const tip: Pt = { x: ABDOMEN_TIP_X, y: BODY_Y + ABDOMEN_DROOP };
  const outline = segmentOutline(root, tip, ABDOMEN_HALF_ROOT, ABDOMEN_HALF_TIP, -0.015);
  paintChitin(ctx, { outline, build: SHELL, gloss: 0.5 });
  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  ctx.strokeStyle = rgba(GRAVEDIGGER_PALETTE.shellLight, 0.35);
  ctx.lineWidth = 0.006;
  for (let s = 1; s < ABDOMEN_SEGMENTS; s++) {
    const t = s / ABDOMEN_SEGMENTS;
    const x = lerp(root.x, tip.x, t);
    const y = lerp(root.y, tip.y, t);
    ctx.beginPath();
    ctx.moveTo(x + 0.01, y - ABDOMEN_HALF_ROOT);
    ctx.quadraticCurveTo(x - 0.012, y, x + 0.01, y + ABDOMEN_HALF_ROOT);
    ctx.stroke();
  }
  ctx.restore();
}

function headCentreSide(pose: BeetlePose): Pt {
  return { x: HEAD_X, y: BODY_Y + HEAD_Y_OFFSET + pose.headPitch };
}

function drawHeadSide(ctx: Ctx, pose: BeetlePose): void {
  const head = headCentreSide(pose);
  const spread = lerp(MANDIBLE_CLOSED_SPREAD, MANDIBLE_OPEN_SPREAD, pose.mandibleOpen);
  const mandibleRoot: Pt = { x: head.x + HEAD_RADIUS * 0.6, y: head.y + HEAD_RADIUS * 0.35 };
  // The far mandible, behind the head, swings up; the near one swings down.
  drawMandible(ctx, mandibleRoot, -spread * SIDE_MANDIBLE_SPLIT, -1, FAR_SIDE_SHADE);
  drawAntenna(
    ctx,
    { x: head.x + HEAD_RADIUS * 0.1, y: head.y - HEAD_RADIUS * 0.8 },
    deg(-75),
    deg(55),
  );
  const outline = ovalOutline(head.x, head.y, HEAD_RADIUS, HEAD_RADIUS * 0.85, deg(10), SEED);
  paintChitin(ctx, { outline, build: SHELL, gloss: SHELL_GLOSS });
  ctx.beginPath();
  ctx.arc(
    head.x + SIDE_EYE.x - HEAD_X,
    head.y + SIDE_EYE.y - BODY_Y - HEAD_Y_OFFSET,
    EYE_RADIUS,
    0,
    TWO_PI,
  );
  ctx.fillStyle = GRAVEDIGGER_PALETTE.eye;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(head.x + HEAD_RADIUS * 0.18, head.y - HEAD_RADIUS * 0.25, EYE_RADIUS * 0.35, 0, TWO_PI);
  ctx.fillStyle = rgba(GRAVEDIGGER_PALETTE.shellRim, 0.8);
  ctx.fill();
  drawGlow(ctx, { x: mandibleRoot.x + MANDIBLE_LENGTH * 0.25, y: mandibleRoot.y }, pose.mouthGlow);
  drawMandible(ctx, mandibleRoot, spread * SIDE_MANDIBLE_SPLIT, -1, 0);
  drawAntenna(
    ctx,
    { x: head.x + HEAD_RADIUS * 0.35, y: head.y - HEAD_RADIUS * 0.7 },
    deg(-55),
    deg(60),
  );
}

function drawSideView(ctx: Ctx, pose: BeetlePose): void {
  const lift = ELYTRON_FLIGHT_LIFT + pose.elytraLift;
  const elytronAngle = Math.PI + lift;
  const hinge: Pt = { x: ELYTRON_HINGE.x, y: BODY_Y + ELYTRON_HINGE.y };
  const wingRoot: Pt = { x: WING_ROOT.x, y: BODY_Y + WING_ROOT.y };

  blurredWing(ctx, wingRoot, WING_REST_ANGLE - deg(10), pose.wingbeat + 0.5, 1);
  drawElytron(
    ctx,
    { x: hinge.x + 0.015, y: hinge.y - 0.012 },
    elytronAngle - deg(10),
    ELYTRON_LENGTH,
    0.8,
    FAR_SIDE_SHADE,
  );
  sideLegs(ctx, pose, -LEG_PAIR_FAN, FAR_SIDE_SHADE);
  drawAbdomenSide(ctx);
  const pronotum = ovalOutline(PRONOTUM_X, BODY_Y, PRONOTUM_RX, PRONOTUM_RY, deg(-8), SEED);
  paintChitin(ctx, { outline: pronotum, build: SHELL, gloss: SHELL_GLOSS });
  drawHeadSide(ctx, pose);
  sideLegs(ctx, pose, LEG_PAIR_FAN, 0);
  blurredWing(ctx, wingRoot, WING_REST_ANGLE, pose.wingbeat, 1);
  drawElytron(ctx, hinge, elytronAngle, ELYTRON_LENGTH, 1, 0);
}

// ── End-on views ─────────────────────────────────────────────────────────────

const AXIAL_PRONOTUM_RX = 0.1;
const AXIAL_PRONOTUM_RY = 0.065;
const AXIAL_HEAD_DROP = 0.05;
const AXIAL_ELYTRON_HINGE_X = 0.03;
const AXIAL_ELYTRON_LENGTH = 0.2;
const AXIAL_ELYTRON_SPREAD = deg(-48);
const AXIAL_WING_ROOT_X = 0.04;
const AXIAL_WING_REST = deg(-25);
const AXIAL_LEG_HIP_X = 0.03;
const AXIAL_LEG_SPLAY = deg(28);
const AXIAL_ABDOMEN_RX = 0.075;
const AXIAL_ABDOMEN_RY = 0.085;
const AXIAL_ABDOMEN_DROP = 0.05;

/** Where the side view's eye is painted, at rest. */
export const SIDE_EYE: Pt = {
  x: HEAD_X + HEAD_RADIUS * 0.25,
  y: BODY_Y + HEAD_Y_OFFSET - HEAD_RADIUS * 0.15,
};
/** Where the head-on view's right eye is painted, at rest; the left mirrors it. */
export const FRONT_EYE: Pt = {
  x: HEAD_RADIUS * 0.7,
  y: BODY_Y + AXIAL_HEAD_DROP - HEAD_RADIUS * 0.15,
};

function axialLegs(ctx: Ctx, pose: BeetlePose): void {
  pose.legs.forEach((dangle, i) => {
    for (const sign of [-1, 1]) {
      const root: Pt = { x: sign * AXIAL_LEG_HIP_X, y: BODY_Y + LEG_ROOT_Y + i * 0.01 };
      const kneeAngle = Math.PI / 2 - sign * (AXIAL_LEG_SPLAY + i * deg(8)) + dangle.swing * sign;
      drawLegSegment(ctx, root, kneeAngle, dangle, sign * deg(30), i * 0.2);
    }
  });
}

function axialWings(ctx: Ctx, pose: BeetlePose): void {
  for (const side of [-1, 1]) {
    const root: Pt = { x: side * AXIAL_WING_ROOT_X, y: BODY_Y - 0.03 };
    const rest = side > 0 ? AXIAL_WING_REST : Math.PI - AXIAL_WING_REST;
    blurredWing(ctx, root, rest, pose.wingbeat + (side > 0 ? 0 : 0.5), -side);
  }
}

function axialElytra(ctx: Ctx, pose: BeetlePose, shade: number): void {
  for (const side of [-1, 1]) {
    const hinge: Pt = { x: side * AXIAL_ELYTRON_HINGE_X, y: BODY_Y - 0.03 };
    const lift = AXIAL_ELYTRON_SPREAD - pose.elytraLift;
    const angle = side > 0 ? lift : Math.PI - lift;
    drawElytron(ctx, hinge, angle, AXIAL_ELYTRON_LENGTH, 0.85, shade);
  }
}

function drawFrontView(ctx: Ctx, pose: BeetlePose): void {
  axialWings(ctx, pose);
  axialElytra(ctx, pose, FAR_SIDE_SHADE);
  axialLegs(ctx, pose);
  const pronotum = ovalOutline(0, BODY_Y - 0.01, AXIAL_PRONOTUM_RX, AXIAL_PRONOTUM_RY, 0, SEED);
  paintChitin(ctx, { outline: pronotum, build: SHELL, gloss: SHELL_GLOSS });
  const head: Pt = { x: 0, y: BODY_Y + AXIAL_HEAD_DROP + pose.headPitch };
  for (const sign of [-1, 1]) {
    drawAntenna(
      ctx,
      { x: sign * HEAD_RADIUS * 0.6, y: head.y - HEAD_RADIUS * 0.5 },
      -Math.PI / 2 + sign * deg(40),
      sign * deg(35),
    );
  }
  const outline = ovalOutline(head.x, head.y, HEAD_RADIUS * 1.1, HEAD_RADIUS * 0.85, 0, SEED);
  paintChitin(ctx, { outline, build: SHELL, gloss: SHELL_GLOSS });
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(head.x + sign * FRONT_EYE.x, FRONT_EYE.y + pose.headPitch, EYE_RADIUS, 0, TWO_PI);
    ctx.fillStyle = GRAVEDIGGER_PALETTE.eye;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(
      head.x + sign * HEAD_RADIUS * 0.62,
      head.y - HEAD_RADIUS * 0.25,
      EYE_RADIUS * 0.35,
      0,
      TWO_PI,
    );
    ctx.fillStyle = rgba(GRAVEDIGGER_PALETTE.shellRim, 0.8);
    ctx.fill();
  }
  const mouth: Pt = { x: head.x, y: head.y + HEAD_RADIUS * 0.7 };
  drawGlow(ctx, { x: mouth.x, y: mouth.y + 0.02 }, pose.mouthGlow);
  const spread = lerp(MANDIBLE_CLOSED_SPREAD, MANDIBLE_OPEN_SPREAD, pose.mandibleOpen);
  for (const sign of [-1, 1]) {
    const root: Pt = { x: mouth.x + sign * HEAD_RADIUS * 0.45, y: mouth.y - 0.005 };
    // Hinged at the sides of the mouth and curving in toward each other.
    drawMandible(ctx, root, Math.PI / 2 - sign * (deg(20) + spread), sign, 0);
  }
}

function drawAwayView(ctx: Ctx, pose: BeetlePose): void {
  axialLegs(ctx, pose);
  for (const sign of [-1, 1]) {
    drawAntenna(
      ctx,
      { x: sign * HEAD_RADIUS * 0.6, y: BODY_Y - 0.04 },
      -Math.PI / 2 + sign * deg(45),
      sign * deg(35),
    );
  }
  const pronotum = ovalOutline(0, BODY_Y - 0.02, AXIAL_PRONOTUM_RX, AXIAL_PRONOTUM_RY, 0, SEED);
  paintChitin(ctx, { outline: pronotum, build: SHELL, gloss: SHELL_GLOSS });
  const abdomen = ovalOutline(
    0,
    BODY_Y + AXIAL_ABDOMEN_DROP,
    AXIAL_ABDOMEN_RX,
    AXIAL_ABDOMEN_RY,
    0,
    SEED,
  );
  paintChitin(ctx, { outline: abdomen, build: SHELL, gloss: 0.5 });
  ctx.save();
  traceOutline(ctx, abdomen);
  ctx.clip();
  ctx.strokeStyle = rgba(GRAVEDIGGER_PALETTE.shellLight, 0.35);
  ctx.lineWidth = 0.006;
  for (let s = 1; s < ABDOMEN_SEGMENTS; s++) {
    const y =
      BODY_Y +
      AXIAL_ABDOMEN_DROP -
      AXIAL_ABDOMEN_RY +
      (2 * AXIAL_ABDOMEN_RY * s) / ABDOMEN_SEGMENTS;
    ctx.beginPath();
    ctx.moveTo(-AXIAL_ABDOMEN_RX, y - 0.01);
    ctx.quadraticCurveTo(0, y + 0.012, AXIAL_ABDOMEN_RX, y - 0.01);
    ctx.stroke();
  }
  ctx.restore();
  axialWings(ctx, pose);
  axialElytra(ctx, pose, 0);
}

export type BeetleView = 'front' | 'side' | 'away';

export function drawGravediggerBeetle(ctx: Ctx, pose: BeetlePose, view: BeetleView): void {
  ctx.save();
  ctx.translate(
    view === 'side' ? pose.lunge : 0,
    pose.bob + (view === 'side' ? 0 : pose.lunge * 0.4),
  );
  // Pitch about the body's centre, so rearing lifts the head rather than the whole animal.
  ctx.translate(0, BODY_Y);
  if (view === 'side') ctx.rotate(pose.lean);
  else ctx.scale(1, 1 + pose.lean * 0.6);
  ctx.translate(0, -BODY_Y);
  if (view === 'side') drawSideView(ctx, pose);
  else if (view === 'front') drawFrontView(ctx, pose);
  else drawAwayView(ctx, pose);
  ctx.restore();
}

// ── Poses ────────────────────────────────────────────────────────────────────

const HOVER_BOB = 0.014;
const HOVER_LEG_SWING = deg(5);
/** Wingbeats painted per hover cycle; the blur reads as fast at any whole number. */
const HOVER_BEATS_PER_CYCLE = 2;

export function hoverPose(phase: number): BeetlePose {
  const angle = phase * TWO_PI;
  return {
    ...restBeetlePose(),
    bob: Math.sin(angle) * HOVER_BOB,
    lean: Math.sin(angle) * deg(2),
    wingbeat: (phase * HOVER_BEATS_PER_CYCLE) % 1,
    elytraLift: Math.sin(angle * HOVER_BEATS_PER_CYCLE) * deg(4),
    mandibleOpen: (1 + Math.sin(angle)) * 0.08,
    legs: [
      { swing: Math.sin(angle) * HOVER_LEG_SWING, tuck: 0 },
      { swing: Math.sin(angle + 1) * HOVER_LEG_SWING, tuck: 0 },
      { swing: Math.sin(angle + 2) * HOVER_LEG_SWING, tuck: 0 },
    ],
    time: phase,
  };
}

/** End of the gape: the mandibles wide, the body drawn back. */
const BITE_GAPE_END = 0.4;
/** The progress the jaws close on: the moment the bite lands. */
export const BITE_SNAP_END = 0.55;
const BITE_HOLD_END = 0.7;
const BITE_LUNGE = 0.08;
const BITE_DRAW_BACK = 0.03;

export function bitePose(progress: number): BeetlePose {
  const gape = easeInOut(ramp(progress, 0, BITE_GAPE_END));
  const snap = easeInOut(ramp(progress, BITE_GAPE_END, BITE_SNAP_END));
  const recover = easeInOut(ramp(progress, BITE_HOLD_END, 1));
  const driven = snap * (1 - recover);
  const cocked = gape * (1 - snap);
  return {
    ...hoverPose(progress),
    lunge: BITE_LUNGE * driven - BITE_DRAW_BACK * cocked,
    lean: deg(-10) * cocked + deg(12) * driven,
    mandibleOpen: clamp01(cocked),
    elytraLift: deg(10) * cocked,
    legs: [
      { swing: deg(-30) * driven, tuck: 0.3 * cocked },
      { swing: deg(-15) * driven, tuck: 0.3 * cocked },
      { swing: 0, tuck: 0.2 * cocked },
    ],
    time: progress,
  };
}

const SPIT_REAR = deg(-28);
const SPIT_WHIP = deg(16);
const SPIT_REAR_RISE = -0.03;

/**
 * The spit: it rears up with fire gathering in its mouth, whips forward on the
 * release, and settles back into the hover. `thrustStart` and `thrustEnd` are
 * the window, in progress, the forward whip occupies.
 */
export function spitPose(progress: number, thrustStart: number, thrustEnd: number): BeetlePose {
  const rear = easeInOut(ramp(progress, 0, thrustStart));
  const whip = easeInOut(ramp(progress, thrustStart, thrustEnd));
  const settle = easeInOut(ramp(progress, thrustEnd, 1));
  const reared = rear * (1 - whip);
  const whipped = whip * (1 - settle);
  return {
    ...hoverPose(progress),
    bob: SPIT_REAR_RISE * reared,
    lean: SPIT_REAR * reared + SPIT_WHIP * whipped,
    headPitch: -0.015 * reared,
    lunge: 0.04 * whipped,
    mandibleOpen: clamp01(0.4 * reared + whipped),
    mouthGlow: clamp01(rear * (1 - whip * 0.85)),
    elytraLift: deg(12) * reared,
    time: progress,
  };
}
