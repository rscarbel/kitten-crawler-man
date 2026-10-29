/**
 * The painter library behind the gravedigger beetle's two ground stages: the
 * larva that hatches out of a corpse and the pupa it seals itself into.
 *
 * The adult has its own painter, `gravediggerAdultArt.ts`, because it shares
 * nothing with these two but the palette engine: a flying, armoured, six-legged
 * animal is a different drawing from a curled grub or a sac on the floor.
 *
 * **The larva** is a sexton-beetle grub: pale cream, soft, C-curled, with a
 * dark brown head capsule tucked into the inside of the curl and a faint wet
 * sheen along its back. What makes the shape read as a grub at 32 px:
 *
 *   - the **curl** — a tube bent into a C that rests on both ends, never a
 *     straight worm and never a closed ring;
 *   - visible **rings** cut across the tube, the cue that turns a smooth
 *     crescent into a segmented larva;
 *   - the **head capsule**, the one dark thing on a pale body, which is also
 *     the only cue to which way it faces;
 *   - a **wriggle** that travels: the crawl is a swelling running along the
 *     body from tail to head while the curl loosens and tightens, never the
 *     whole crescent rocking as one rigid piece;
 *   - the dark gut showing through the pale skin at the tail end.
 *
 * Seen end-on (front and away) the curl is projected rather than redrawn:
 * each ring is placed by its height on the C and its depth behind the near
 * end, so the head-on larva is a mound of rings with the head capsule at its
 * foot and the away larva the same mound with the tail end nearest.
 *
 * **The pupa** is a leathery, veined, mottled egg sac with the folded beetle a
 * dark shape inside it. It pulses, and something with mandibles pushes at the
 * membrane; its hatch splits the sac open from the crown down.
 *
 * Skin is painted through `paintChitin` (from `mantidArt.ts`), the generic
 * directional-gradient engine every insect in the game shares.
 *
 * Coordinates are tile units, +Y down, origin at the tile centre. The larva's
 * side view faces +X (head foremost); the runtime mirrors it for the other
 * direction. The pupa has one view and is never mirrored.
 */

import {
  TWO_PI,
  clamp01,
  deg,
  easeInOut,
  hash1,
  hump,
  lerp,
  ovalOutline,
  paintChitin,
  ramp,
  rgba,
  traceOutline,
  type MantidBuild,
  type Pt,
} from './mantidArt';

type Ctx = CanvasRenderingContext2D;

export type { Pt };

/** The line both ground stages rest on. */
export const GROUND_Y = 0.42;

// ── Palettes ─────────────────────────────────────────────────────────────────

interface SkinPalette {
  readonly base: string;
  readonly dark: string;
  readonly light: string;
  readonly rim: string;
  readonly ink: string;
}

const LARVA_SKIN: SkinPalette = {
  base: '#e6d9b8',
  dark: '#9c8660',
  light: '#fbf5e2',
  rim: '#fffaea',
  ink: '#4a3a22',
};

const LARVA_HEAD: SkinPalette = {
  base: '#6a3c18',
  dark: '#2a1407',
  light: '#b07a42',
  rim: '#d8a468',
  ink: '#1a0c04',
};

/** The gut and droppings seen through the pale skin at the tail end. */
const LARVA_GUT = '#5e5242';
const LARVA_SHEEN = '#ffffff';
const LARVA_LEG = '#8a5a2a';

const PUPA_SKIN: SkinPalette = {
  base: '#9a8862',
  dark: '#4a3e2c',
  light: '#cdbf96',
  rim: '#e6dcb8',
  ink: '#241c12',
};

const PUPA_MOTTLE_DARK = '#5c4c34';
const PUPA_MOTTLE_LIGHT = '#bdb08a';
const PUPA_VEIN = '#5e2a1e';
/** The folded beetle inside, glimpsed through the membrane. */
const PUPA_INNER = '#14110f';
const PUPA_INNER_BAND = '#c4501c';
/** The fluid that wets a split sac. */
const PUPA_FLUID = '#d9cf8a';
const ADULT_SHELL = '#16141a';
const ADULT_SHELL_LIGHT = '#6c6878';
const ADULT_BAND = '#de5a1e';
const ADULT_BAND_LIGHT = '#ff9a48';

/** Reshapes a skin palette into the generic chitin engine's shape. */
function chitinBuild(skin: SkinPalette, seed: number): MantidBuild {
  return {
    palette: {
      base: skin.base,
      dark: skin.dark,
      light: skin.light,
      rim: skin.rim,
      ink: skin.ink,
      sheen: skin.light,
      eye: skin.ink,
      eyeDark: skin.ink,
      membrane: skin.light,
      spine: skin.light,
    },
    wingWear: 0,
    scarring: 0,
    heft: 0,
    iridescence: 0,
    seed,
  };
}

const LARVA_SEED = 3.7;
const PUPA_SEED = 8.3;
const LARVA_SKIN_BUILD = chitinBuild(LARVA_SKIN, LARVA_SEED);
const LARVA_HEAD_BUILD = chitinBuild(LARVA_HEAD, LARVA_SEED);
const PUPA_SKIN_BUILD = chitinBuild(PUPA_SKIN, PUPA_SEED);

// ── Larva anatomy (tile units) ───────────────────────────────────────────────

/** Radius of the curl's centreline. */
const CURL_RADIUS = 0.125;
/**
 * Where the head and the tail sit on the curl, as angles round its centre
 * (0 is straight ahead, +90° straight down). The open side of the C is the
 * bottom, between the two ends, so the larva rests on both.
 */
const CURL_HEAD_ANGLE = deg(58);
const CURL_TAIL_ANGLE = deg(122) - TWO_PI;
/** How much the curl opens up at the loosest point of the wriggle. */
const CURL_LOOSEN = deg(26);
const BODY_HALF_HEAD = 0.05;
const BODY_HALF_MID = 0.07;
const BODY_HALF_TAIL = 0.04;
/** Where along the body (head 0, tail 1) it is fattest. */
const BODY_FATTEST_AT = 0.45;
export const LARVA_SEGMENT_COUNT = 9;
/** How far a swelling bulges the body as it runs along it. */
const WRIGGLE_SWELL = 0.022;
/** How far the swelling lifts the back off the curl as it passes. */
const WRIGGLE_LIFT = 0.02;
/** Width of the travelling swelling, as a share of the body. */
const WRIGGLE_WIDTH = 0.3;
const BREATHE_SWELL = 0.05;
const HEAD_CAPSULE_RADIUS = 0.045;
const HEAD_CAPSULE_SQUASH = 0.86;
/** How far the head capsule sits beyond the end of the body tube. */
const HEAD_CAPSULE_REACH = 0.6;
const MANDIBLE_STUB = 0.022;
const MANDIBLE_WIDTH = 0.009;
const LARVA_LEG_LENGTH = 0.03;
const LARVA_LEG_WIDTH = 0.008;
const LARVA_LEG_COUNT = 3;
/** Where the three pairs of stubby legs sit along the body, just behind the head. */
const LARVA_LEG_FIRST_T = 0.08;
const LARVA_LEG_SPACING_T = 0.05;
const SPIRACLE_RADIUS_RATIO = 0.12;
const SPIRACLE_OFFSET_RATIO = 0.55;
const SPIRACLE_ALPHA = 0.5;
const CREASE_ALPHA = 0.32;
const CREASE_WIDTH = 0.006;
const CREASE_REACH = 1.08;
/** The tail-end share of the body the gut shows through. */
const GUT_FROM_T = 0.62;
const GUT_ALPHA = 0.3;
const GUT_WIDTH_RATIO = 0.5;
const SHEEN_ALPHA = 0.55;
const SHEEN_WIDTH = 0.012;
const SHEEN_FROM_T = 0.2;
const SHEEN_TO_T = 0.75;
/** How far the sheen rides up toward the outer edge of the back. */
const SHEEN_OFFSET_RATIO = 0.55;
const LARVA_SKIN_GLOSS = 0.7;
const LARVA_HEAD_GLOSS = 0.9;
const SHADOW_ALPHA = 0.28;
const LARVA_SHADOW_RX = 0.2;
const LARVA_SHADOW_RY = 0.04;
const TUBE_STEPS = 32;

// ── Larva pose ───────────────────────────────────────────────────────────────

export interface LarvaPose {
  /** 0–1: where the swelling running from tail to head has got to. */
  readonly crawlPhase: number;
  /** 0 curled at rest, 1 opened out at the loosest point of a wriggle. */
  readonly loosen: number;
  /** Side-to-side rock, mostly visible end-on. */
  readonly sway: number;
  readonly breathe: number;
  /** The phase the row was sampled at; a loop advances it by exactly one turn. */
  readonly time: number;
}

export function restLarvaPose(): LarvaPose {
  return { crawlPhase: 0, loosen: 0, sway: 0, breathe: 0, time: 0 };
}

// ── Larva body ───────────────────────────────────────────────────────────────

interface RingSample {
  readonly point: Pt;
  /** Direction `t` increases in, radians. */
  readonly angle: number;
  readonly half: number;
  /** Height above the ground line, for the end-on projections. */
  readonly height: number;
  /** Distance ahead of the curl's centre along the facing, for the end-on projections. */
  readonly ahead: number;
}

function bodyHalfAt(t: number): number {
  if (t < BODY_FATTEST_AT) return lerp(BODY_HALF_HEAD, BODY_HALF_MID, t / BODY_FATTEST_AT);
  return lerp(BODY_HALF_MID, BODY_HALF_TAIL, (t - BODY_FATTEST_AT) / (1 - BODY_FATTEST_AT));
}

/** How strongly the travelling swelling covers a point along the body, 0–1. */
function swellingAt(t: number, pose: LarvaPose): number {
  // The swelling runs tail (1) to head (0) as the phase advances, wrapping so
  // the row closes. Measured round the wrap so it never jumps at the seam.
  const centre = 1 - pose.crawlPhase;
  const raw = Math.abs(t - centre);
  const distance = Math.min(raw, 1 - raw);
  return hump(clamp01(0.5 - distance / WRIGGLE_WIDTH));
}

/**
 * The curl's centre sits so that the lowest point of the body, at its fattest
 * resting curl, lies on the ground line.
 */
const CURL_CENTRE_Y = GROUND_Y - CURL_RADIUS * Math.sin(CURL_HEAD_ANGLE) - BODY_HALF_HEAD;

function sampleRing(t: number, pose: LarvaPose): RingSample {
  const clamped = clamp01(t);
  const loosen = pose.loosen * CURL_LOOSEN;
  // Loosening opens both ends away from the gap under the curl.
  const headAngle = CURL_HEAD_ANGLE - loosen;
  const tailAngle = CURL_TAIL_ANGLE + loosen;
  const theta = lerp(headAngle, tailAngle, clamped);
  const swell = swellingAt(clamped, pose);
  const radius = CURL_RADIUS + swell * WRIGGLE_LIFT;
  const point: Pt = {
    x: Math.cos(theta) * radius + pose.sway,
    y: CURL_CENTRE_Y + Math.sin(theta) * radius,
  };
  // The tangent along increasing `t` runs the way theta decreases.
  const angle = theta - Math.PI / 2;
  const half = (bodyHalfAt(clamped) + swell * WRIGGLE_SWELL) * (1 + pose.breathe * BREATHE_SWELL);
  return {
    point,
    angle,
    half,
    height: GROUND_Y - point.y,
    ahead: Math.cos(theta) * radius,
  };
}

function normalOf(angle: number): Pt {
  return { x: -Math.sin(angle), y: Math.cos(angle) };
}

function tubeOutline(pose: LarvaPose): Pt[] {
  const outer: Pt[] = [];
  const inner: Pt[] = [];
  for (let i = 0; i <= TUBE_STEPS; i++) {
    const ring = sampleRing(i / TUBE_STEPS, pose);
    const n = normalOf(ring.angle);
    outer.push({ x: ring.point.x + n.x * ring.half, y: ring.point.y + n.y * ring.half });
    inner.push({ x: ring.point.x - n.x * ring.half, y: ring.point.y - n.y * ring.half });
  }
  return [...outer, ...inner.reverse()];
}

function drawShadow(ctx: Ctx, cx: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, GROUND_Y, rx, ry, 0, 0, TWO_PI);
  ctx.fillStyle = rgba(LARVA_SKIN.ink, SHADOW_ALPHA);
  ctx.fill();
}

function drawRingCreases(ctx: Ctx, pose: LarvaPose): void {
  ctx.lineWidth = CREASE_WIDTH;
  ctx.strokeStyle = rgba(LARVA_SKIN.ink, CREASE_ALPHA);
  for (let s = 1; s < LARVA_SEGMENT_COUNT; s++) {
    const ring = sampleRing(s / LARVA_SEGMENT_COUNT, pose);
    const n = normalOf(ring.angle);
    const reach = ring.half * CREASE_REACH;
    ctx.beginPath();
    ctx.moveTo(ring.point.x - n.x * reach, ring.point.y - n.y * reach);
    ctx.lineTo(ring.point.x + n.x * reach, ring.point.y + n.y * reach);
    ctx.stroke();
  }
}

function drawSpiracles(ctx: Ctx, pose: LarvaPose): void {
  ctx.fillStyle = rgba(LARVA_SKIN.ink, SPIRACLE_ALPHA);
  for (let s = 1; s < LARVA_SEGMENT_COUNT; s++) {
    const ring = sampleRing((s + 0.5) / LARVA_SEGMENT_COUNT, pose);
    const n = normalOf(ring.angle);
    ctx.beginPath();
    ctx.arc(
      ring.point.x + n.x * ring.half * SPIRACLE_OFFSET_RATIO,
      ring.point.y + n.y * ring.half * SPIRACLE_OFFSET_RATIO,
      ring.half * SPIRACLE_RADIUS_RATIO,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}

/** The dark gut showing through the pale skin of the tail segments. */
function drawGut(ctx: Ctx, pose: LarvaPose, outline: readonly Pt[]): void {
  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(LARVA_GUT, GUT_ALPHA);
  const steps = TUBE_STEPS / 2;
  for (let i = 0; i < steps; i++) {
    const from = sampleRing(lerp(GUT_FROM_T, 1, i / steps), pose);
    const to = sampleRing(lerp(GUT_FROM_T, 1, (i + 1) / steps), pose);
    ctx.lineWidth = from.half * GUT_WIDTH_RATIO * 2;
    ctx.beginPath();
    ctx.moveTo(from.point.x, from.point.y);
    ctx.lineTo(to.point.x, to.point.y);
    ctx.stroke();
  }
  ctx.restore();
}

/** The wet highlight running along the outer curve of the back. */
function drawSheen(ctx: Ctx, pose: LarvaPose): void {
  ctx.beginPath();
  const steps = TUBE_STEPS / 2;
  for (let i = 0; i <= steps; i++) {
    const ring = sampleRing(lerp(SHEEN_FROM_T, SHEEN_TO_T, i / steps), pose);
    const n = normalOf(ring.angle);
    const x = ring.point.x + n.x * ring.half * SHEEN_OFFSET_RATIO;
    const y = ring.point.y + n.y * ring.half * SHEEN_OFFSET_RATIO;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.strokeStyle = rgba(LARVA_SHEEN, SHEEN_ALPHA);
  ctx.lineWidth = SHEEN_WIDTH;
  ctx.lineCap = 'round';
  ctx.stroke();
}

/** The three pairs of stubby legs tucked into the inside of the curl behind the head. */
function drawLarvaLegs(ctx: Ctx, pose: LarvaPose): void {
  ctx.strokeStyle = LARVA_LEG;
  ctx.lineWidth = LARVA_LEG_WIDTH;
  ctx.lineCap = 'round';
  for (let i = 0; i < LARVA_LEG_COUNT; i++) {
    const ring = sampleRing(LARVA_LEG_FIRST_T + i * LARVA_LEG_SPACING_T, pose);
    const inward = normalOf(ring.angle);
    const rootX = ring.point.x - inward.x * ring.half;
    const rootY = ring.point.y - inward.y * ring.half;
    const kick = Math.sin((pose.crawlPhase + i / LARVA_LEG_COUNT) * TWO_PI) * deg(20);
    const legAngle = Math.atan2(-inward.y, -inward.x) + kick;
    ctx.beginPath();
    ctx.moveTo(rootX, rootY);
    ctx.lineTo(
      rootX + Math.cos(legAngle) * LARVA_LEG_LENGTH,
      rootY + Math.sin(legAngle) * LARVA_LEG_LENGTH,
    );
    ctx.stroke();
  }
}

/** The dark head capsule and its stubby mandibles, at the head end of the curl. */
function drawHeadCapsule(ctx: Ctx, centre: Pt, facing: number, radius: number): void {
  const outline = ovalOutline(
    centre.x,
    centre.y,
    radius,
    radius * HEAD_CAPSULE_SQUASH,
    facing,
    LARVA_SEED,
  );
  paintChitin(ctx, { outline, build: LARVA_HEAD_BUILD, gloss: LARVA_HEAD_GLOSS });
  ctx.strokeStyle = LARVA_HEAD.ink;
  ctx.lineWidth = MANDIBLE_WIDTH;
  ctx.lineCap = 'round';
  for (const sign of [-1, 1]) {
    const angle = facing + sign * deg(22);
    const rootX = centre.x + Math.cos(facing) * radius * 0.7;
    const rootY = centre.y + Math.sin(facing) * radius * 0.7;
    ctx.beginPath();
    ctx.moveTo(rootX, rootY);
    ctx.lineTo(rootX + Math.cos(angle) * MANDIBLE_STUB, rootY + Math.sin(angle) * MANDIBLE_STUB);
    ctx.stroke();
  }
}

function drawLarvaSideView(ctx: Ctx, pose: LarvaPose): void {
  drawShadow(ctx, pose.sway, LARVA_SHADOW_RX, LARVA_SHADOW_RY);
  const outline = tubeOutline(pose);
  drawLarvaLegs(ctx, pose);
  paintChitin(ctx, { outline, build: LARVA_SKIN_BUILD, gloss: LARVA_SKIN_GLOSS });
  drawGut(ctx, pose, outline);
  drawRingCreases(ctx, pose);
  drawSpiracles(ctx, pose);
  drawSheen(ctx, pose);
  const head = sampleRing(0, pose);
  // The head faces back along the tube, out of the end of the curl.
  const facing = head.angle + Math.PI;
  const centre: Pt = {
    x: head.point.x + Math.cos(facing) * HEAD_CAPSULE_RADIUS * HEAD_CAPSULE_REACH,
    y: head.point.y + Math.sin(facing) * HEAD_CAPSULE_RADIUS * HEAD_CAPSULE_REACH,
  };
  drawHeadCapsule(ctx, centre, facing, HEAD_CAPSULE_RADIUS);
}

// ── Larva end-on ─────────────────────────────────────────────────────────────

/** How much higher on screen a ring sits per tile of depth behind the near end. */
const END_ON_DEPTH_RISE = 0.2;
/**
 * How much of a ring's height on the curl survives seen end-on. Kept low so
 * the curl reads as a squat mound rather than a column of rings.
 */
const END_ON_HEIGHT_SHARE = 0.45;
/** A ring's contour seen end-on: soft, so the rings read as creases in one body, not stacked discs. */
const END_ON_RING_CONTOUR = 0.35;
/** How a ring's ellipse is squashed seen end-on: wider than it is tall. */
const END_ON_RING_SQUASH = 0.72;
/** How much wider a ring reads end-on than its half-width, for the body's roundness. */
const END_ON_RING_WIDEN = 1.7;
const END_ON_RINGS = 12;
const END_ON_SWAY_SCALE = 1.6;
const END_ON_RING_GLOSS = 0.5;
/** Rings beyond this far round the curl are hidden behind the near ones. */
const FRONT_VISIBLE_T = 0.62;
const AWAY_VISIBLE_FROM_T = 0.38;

function endOnRingCentre(
  ring: RingSample,
  nearAhead: number,
  pose: LarvaPose,
  view: 'front' | 'away',
): Pt {
  const depth = view === 'front' ? nearAhead - ring.ahead : ring.ahead - nearAhead;
  return {
    x: pose.sway * END_ON_SWAY_SCALE * (1 - ring.height),
    y:
      GROUND_Y -
      ring.half * END_ON_RING_WIDEN * END_ON_RING_SQUASH -
      (ring.height - ring.half) * END_ON_HEIGHT_SHARE -
      depth * END_ON_DEPTH_RISE,
  };
}

function drawEndOnRing(ctx: Ctx, centre: Pt, ring: RingSample, shade: number): void {
  const outline = ovalOutline(
    centre.x,
    centre.y,
    ring.half * END_ON_RING_WIDEN,
    ring.half * END_ON_RING_WIDEN * END_ON_RING_SQUASH,
    0,
    LARVA_SEED,
  );
  paintChitin(ctx, {
    outline,
    build: LARVA_SKIN_BUILD,
    gloss: END_ON_RING_GLOSS,
    shade,
    contour: END_ON_RING_CONTOUR,
  });
}

/**
 * The larva seen along its length: the near end at the foot of a mound of
 * rings, each placed by how high it sits on the curl and how far behind the
 * near end it lies, drawn far to near so the near ones cover the far.
 */
function drawLarvaEndOn(ctx: Ctx, pose: LarvaPose, view: 'front' | 'away'): void {
  drawShadow(ctx, pose.sway, LARVA_SHADOW_RX * END_ON_RING_SQUASH, LARVA_SHADOW_RY);
  const nearT = view === 'front' ? 0 : 1;
  const near = sampleRing(nearT, pose);
  const fromT = view === 'front' ? FRONT_VISIBLE_T : AWAY_VISIBLE_FROM_T;
  for (let i = 0; i <= END_ON_RINGS; i++) {
    const t = lerp(fromT, nearT, i / END_ON_RINGS);
    const ring = sampleRing(t, pose);
    const centre = endOnRingCentre(ring, near.ahead, pose, view);
    const shade = (1 - i / END_ON_RINGS) * 0.4;
    drawEndOnRing(ctx, centre, ring, shade);
  }
  if (view === 'front') {
    const centre = endOnRingCentre(near, near.ahead, pose, view);
    drawHeadCapsule(
      ctx,
      { x: centre.x, y: centre.y + near.half * END_ON_RING_SQUASH * 0.4 },
      Math.PI / 2,
      HEAD_CAPSULE_RADIUS,
    );
  }
}

export type LarvaView = 'front' | 'side' | 'away';

export function drawLarva(ctx: Ctx, pose: LarvaPose, view: LarvaView): void {
  if (view === 'side') drawLarvaSideView(ctx, pose);
  else drawLarvaEndOn(ctx, pose, view);
}

/** A larva's crawl, sampled at `phase` (0–1) of one cycle. */
export function larvaCrawlPose(phase: number): LarvaPose {
  return {
    crawlPhase: phase,
    loosen: hump(phase),
    sway: Math.sin(phase * TWO_PI) * LARVA_CRAWL_SWAY,
    breathe: 0,
    time: phase,
  };
}

const LARVA_CRAWL_SWAY = 0.012;
const LARVA_IDLE_BREATHE = 0.6;

/** The one frame a stopped larva holds: the rest curl with a breath in it. */
export function larvaIdlePose(): LarvaPose {
  return { ...restLarvaPose(), breathe: LARVA_IDLE_BREATHE };
}

// ── Pupa ─────────────────────────────────────────────────────────────────────

const PUPA_CENTRE_Y = GROUND_Y - 0.2;
const PUPA_RX = 0.15;
const PUPA_RY = 0.2;
/** How much fuller the sac is at its base than its crown. */
const PUPA_BASE_FULLNESS = 0.18;
const PUPA_OUTLINE_STEPS = 40;
const PUPA_WOBBLE = 0.025;
const PUPA_PULSE_SWELL = 0.11;
/** How far the thing inside pushes the membrane out at the height of a push. */
const PUPA_PUSH_BULGE = 0.06;
/** Angular width of the bulge a push raises, radians either side of its centre. */
const PUPA_PUSH_SPREAD = deg(38);
const PUPA_SHADOW_RX = 0.17;
const PUPA_SHADOW_RY = 0.045;
const PUPA_GLOSS = 0.45;
const PUPA_MOTTLES = 22;
const PUPA_MOTTLE_MIN = 0.012;
const PUPA_MOTTLE_MAX = 0.03;
const PUPA_MOTTLE_ALPHA = 0.35;
const PUPA_VEINS = 6;
const PUPA_VEIN_ALPHA = 0.55;
const PUPA_VEIN_WIDTH = 0.006;
const PUPA_VEIN_BRANCH_WIDTH = 0.0035;
const PUPA_INNER_ALPHA = 0.42;
const PUPA_INNER_RX = 0.085;
const PUPA_INNER_RY = 0.135;
const PUPA_INNER_HEAD_RADIUS = 0.045;
const PUPA_MANDIBLE_LENGTH = 0.05;
const PUPA_MANDIBLE_WIDTH = 0.012;
const PUPA_SHEEN_ALPHA = 0.4;

/** The crack's half-width at the crown when the sac is fully split. */
const SPLIT_GAPE = deg(30);
/** How much of the hatch the beetle has already pushed its head out by. */
const SPLIT_EMERGE_FROM = 0.35;
const SPLIT_EMERGE_RISE = 0.11;
const SPLIT_CRACK_TEETH = 7;
const SPLIT_CRACK_JAG = 0.018;
const SPLIT_FLUID_RUNS = 5;
const SPLIT_FLUID_ALPHA = 0.7;
const SPLIT_FLUID_LENGTH = 0.09;
const SPLIT_FLUID_WIDTH = 0.008;
const EMERGED_HEAD_RADIUS = 0.07;
const EMERGED_MANDIBLE_LENGTH = 0.085;
const EMERGED_MANDIBLE_WIDTH = 0.016;
const EMERGED_BAND_WIDTH = 0.026;

export interface PupaPose {
  /** 0–1 how swollen the sac is in its pulse. */
  readonly pulse: number;
  /** 0–1 how hard the thing inside is pushing the membrane out. */
  readonly push: number;
  /** Where round the sac the push lands, radians (−90° is the crown). */
  readonly pushAngle: number;
  /** 0 sealed, 1 split open from the crown with the beetle's head out. */
  readonly split: number;
  readonly time: number;
}

/** The sac's outline, as a function of the angle round its centre. */
function pupaRadiusAt(angle: number, pose: PupaPose): { rx: number; ry: number } {
  const swell = 1 + pose.pulse * PUPA_PULSE_SWELL;
  // Fuller below the equator: a sac settled by its own weight.
  const fullness = 1 + Math.max(0, Math.sin(angle)) * PUPA_BASE_FULLNESS;
  const wobble =
    1 +
    PUPA_WOBBLE * Math.sin(angle * 3 + PUPA_SEED) +
    PUPA_WOBBLE * 0.5 * Math.sin(angle * 5 - PUPA_SEED);
  let offset = angle - pose.pushAngle;
  offset = Math.atan2(Math.sin(offset), Math.cos(offset));
  const bulge = pose.push * PUPA_PUSH_BULGE * hump(clamp01(0.5 - offset / (PUPA_PUSH_SPREAD * 2)));
  return {
    rx: (PUPA_RX * fullness * wobble + bulge) * swell,
    ry: (PUPA_RY * wobble + bulge) * swell,
  };
}

function pupaPointAt(angle: number, pose: PupaPose): Pt {
  const { rx, ry } = pupaRadiusAt(angle, pose);
  const swell = 1 + pose.pulse * PUPA_PULSE_SWELL;
  // Swelling is about the base, so the sac stays on the ground as it pulses.
  const centreY = GROUND_Y - (GROUND_Y - PUPA_CENTRE_Y) * swell;
  return { x: Math.cos(angle) * rx, y: centreY + Math.sin(angle) * ry };
}

/** The sac's outline between two angles, for the whole sac or one half of a split one. */
function pupaArc(fromAngle: number, toAngle: number, pose: PupaPose): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i <= PUPA_OUTLINE_STEPS; i++) {
    pts.push(pupaPointAt(lerp(fromAngle, toAngle, i / PUPA_OUTLINE_STEPS), pose));
  }
  return pts;
}

function drawMottles(ctx: Ctx): void {
  for (let i = 0; i < PUPA_MOTTLES; i++) {
    const angle = hash1(PUPA_SEED + i * 2.7) * TWO_PI;
    const reach = Math.sqrt(hash1(PUPA_SEED + i * 5.3));
    const radius = lerp(PUPA_MOTTLE_MIN, PUPA_MOTTLE_MAX, hash1(PUPA_SEED + i * 1.9));
    ctx.beginPath();
    ctx.ellipse(
      Math.cos(angle) * PUPA_RX * reach,
      PUPA_CENTRE_Y + Math.sin(angle) * PUPA_RY * reach,
      radius,
      radius * 0.7,
      angle,
      0,
      TWO_PI,
    );
    ctx.fillStyle = rgba(i % 3 === 0 ? PUPA_MOTTLE_LIGHT : PUPA_MOTTLE_DARK, PUPA_MOTTLE_ALPHA);
    ctx.fill();
  }
}

/** Branching veins climbing the membrane from the base. */
function drawVeins(ctx: Ctx, pose: PupaPose): void {
  ctx.lineCap = 'round';
  for (let i = 0; i < PUPA_VEINS; i++) {
    const baseAngle = lerp(deg(40), deg(140), (i + 0.5) / PUPA_VEINS);
    const start = pupaPointAt(baseAngle, pose);
    const end: Pt = {
      x: start.x * lerp(0.1, 0.5, hash1(PUPA_SEED + i * 4.1)),
      y: PUPA_CENTRE_Y - PUPA_RY * lerp(0.2, 0.8, hash1(PUPA_SEED + i * 6.7)),
    };
    const bend: Pt = {
      x: (start.x + end.x) / 2 + (hash1(PUPA_SEED + i * 3.3) - 0.5) * 0.06,
      y: (start.y + end.y) / 2,
    };
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.quadraticCurveTo(bend.x, bend.y, end.x, end.y);
    ctx.strokeStyle = rgba(PUPA_VEIN, PUPA_VEIN_ALPHA * (0.7 + pose.pulse * 0.3));
    ctx.lineWidth = PUPA_VEIN_WIDTH;
    ctx.stroke();
    const branchSign = i % 2 === 0 ? 1 : -1;
    ctx.beginPath();
    ctx.moveTo(bend.x, bend.y);
    ctx.lineTo(bend.x + branchSign * 0.035, bend.y - 0.03);
    ctx.lineWidth = PUPA_VEIN_BRANCH_WIDTH;
    ctx.stroke();
  }
}

/** The folded beetle inside, a dark shape behind the membrane with its mandibles drawn up. */
function drawFoldedBeetle(ctx: Ctx, pose: PupaPose, alpha: number): void {
  const swell = 1 + pose.pulse * PUPA_PULSE_SWELL;
  const cy = GROUND_Y - (GROUND_Y - PUPA_CENTRE_Y) * swell;
  // The head leans toward wherever it is pushing.
  const lean = Math.cos(pose.pushAngle) * pose.push * 0.03;
  ctx.save();
  ctx.globalAlpha *= alpha;
  ctx.beginPath();
  ctx.ellipse(lean * 0.5, cy + 0.03, PUPA_INNER_RX, PUPA_INNER_RY, 0, 0, TWO_PI);
  ctx.fillStyle = PUPA_INNER;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(lean * 0.5, cy + 0.05, PUPA_INNER_RX * 0.9, 0.018, 0, 0, TWO_PI);
  ctx.fillStyle = PUPA_INNER_BAND;
  ctx.fill();
  const headY = cy - PUPA_INNER_RY * 0.8;
  ctx.beginPath();
  ctx.arc(lean, headY, PUPA_INNER_HEAD_RADIUS, 0, TWO_PI);
  ctx.fillStyle = PUPA_INNER;
  ctx.fill();
  ctx.strokeStyle = PUPA_INNER;
  ctx.lineWidth = PUPA_MANDIBLE_WIDTH;
  ctx.lineCap = 'round';
  for (const sign of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(lean + sign * PUPA_INNER_HEAD_RADIUS * 0.5, headY - PUPA_INNER_HEAD_RADIUS * 0.6);
    ctx.quadraticCurveTo(
      lean + sign * PUPA_MANDIBLE_LENGTH * 0.9,
      headY - PUPA_MANDIBLE_LENGTH,
      lean + sign * PUPA_MANDIBLE_LENGTH * 0.15,
      headY - PUPA_MANDIBLE_LENGTH * 1.25,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawPupaSheen(ctx: Ctx, pose: PupaPose): void {
  const crown = pupaPointAt(deg(-125), pose);
  ctx.beginPath();
  ctx.ellipse(crown.x + 0.03, crown.y + 0.05, 0.022, 0.06, deg(30), 0, TWO_PI);
  ctx.fillStyle = rgba(PUPA_SKIN.rim, PUPA_SHEEN_ALPHA);
  ctx.fill();
}

/** Paints one whole or half sac: membrane, mottles, the beetle inside, veins, sheen. */
function paintSac(ctx: Ctx, outline: readonly Pt[], pose: PupaPose, innerAlpha: number): void {
  paintChitin(ctx, { outline, build: PUPA_SKIN_BUILD, gloss: PUPA_GLOSS });
  ctx.save();
  traceOutline(ctx, outline);
  ctx.clip();
  drawMottles(ctx);
  drawFoldedBeetle(ctx, pose, innerAlpha);
  drawVeins(ctx, pose);
  drawPupaSheen(ctx, pose);
  ctx.restore();
  traceOutline(ctx, outline);
  ctx.strokeStyle = rgba(PUPA_SKIN.ink, 0.85);
  ctx.lineWidth = 0.01;
  ctx.stroke();
}

/** A jagged crack down from the crown, one tooth per step. */
function crackEdge(fromAngle: number, pose: PupaPose, sign: number): Pt[] {
  const crown = pupaPointAt(fromAngle, pose);
  const pts: Pt[] = [];
  const depthY = lerp(crown.y, GROUND_Y - 0.04, pose.split);
  for (let i = 0; i <= SPLIT_CRACK_TEETH; i++) {
    const t = i / SPLIT_CRACK_TEETH;
    const jag = (i % 2 === 0 ? 1 : -1) * SPLIT_CRACK_JAG * sign;
    pts.push({ x: crown.x * (1 - t) + jag, y: lerp(crown.y, depthY, t) });
  }
  return pts;
}

/** The beetle's head and mandibles pushing up out of a split sac. */
function drawEmergingBeetle(ctx: Ctx, pose: PupaPose): void {
  const emerge = easeInOut(ramp(pose.split, SPLIT_EMERGE_FROM, 1));
  const headY = PUPA_CENTRE_Y - PUPA_RY * 0.35 - emerge * SPLIT_EMERGE_RISE;
  ctx.beginPath();
  ctx.ellipse(0, headY + EMERGED_HEAD_RADIUS * 1.6, PUPA_RX * 0.7, PUPA_RY * 0.55, 0, 0, TWO_PI);
  ctx.fillStyle = ADULT_SHELL;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(0, headY + EMERGED_HEAD_RADIUS * 2, PUPA_RX * 0.62, EMERGED_BAND_WIDTH, 0, 0, TWO_PI);
  ctx.fillStyle = ADULT_BAND;
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    -PUPA_RX * 0.2,
    headY + EMERGED_HEAD_RADIUS * 1.9,
    PUPA_RX * 0.18,
    EMERGED_BAND_WIDTH * 0.4,
    0,
    0,
    TWO_PI,
  );
  ctx.fillStyle = rgba(ADULT_BAND_LIGHT, 0.7);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(0, headY, EMERGED_HEAD_RADIUS, 0, TWO_PI);
  ctx.fillStyle = ADULT_SHELL;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(
    -EMERGED_HEAD_RADIUS * 0.3,
    headY - EMERGED_HEAD_RADIUS * 0.35,
    EMERGED_HEAD_RADIUS * 0.3,
    0,
    TWO_PI,
  );
  ctx.fillStyle = rgba(ADULT_SHELL_LIGHT, 0.8);
  ctx.fill();
  ctx.strokeStyle = ADULT_SHELL;
  ctx.lineWidth = EMERGED_MANDIBLE_WIDTH;
  ctx.lineCap = 'round';
  const gape = lerp(deg(10), deg(34), emerge);
  for (const sign of [-1, 1]) {
    const rootX = sign * EMERGED_HEAD_RADIUS * 0.45;
    const rootY = headY - EMERGED_HEAD_RADIUS * 0.7;
    const angle = -Math.PI / 2 + sign * gape;
    ctx.beginPath();
    ctx.moveTo(rootX, rootY);
    ctx.quadraticCurveTo(
      rootX + Math.cos(angle) * EMERGED_MANDIBLE_LENGTH,
      rootY + Math.sin(angle) * EMERGED_MANDIBLE_LENGTH,
      rootX + sign * EMERGED_MANDIBLE_LENGTH * 0.2,
      rootY - EMERGED_MANDIBLE_LENGTH * 0.95,
    );
    ctx.stroke();
  }
}

function drawFluid(ctx: Ctx, pose: PupaPose): void {
  ctx.lineCap = 'round';
  for (let i = 0; i < SPLIT_FLUID_RUNS; i++) {
    const angle = lerp(deg(-150), deg(-30), (i + 0.5) / SPLIT_FLUID_RUNS);
    const start = pupaPointAt(angle, pose);
    const length = SPLIT_FLUID_LENGTH * pose.split * lerp(0.5, 1, hash1(PUPA_SEED + i * 2.2));
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(start.x * 1.05, start.y + length);
    ctx.strokeStyle = rgba(PUPA_FLUID, SPLIT_FLUID_ALPHA);
    ctx.lineWidth = SPLIT_FLUID_WIDTH;
    ctx.stroke();
  }
}

export function drawPupa(ctx: Ctx, pose: PupaPose): void {
  ctx.beginPath();
  ctx.ellipse(0, GROUND_Y, PUPA_SHADOW_RX, PUPA_SHADOW_RY, 0, 0, TWO_PI);
  ctx.fillStyle = rgba(PUPA_SKIN.ink, SHADOW_ALPHA);
  ctx.fill();

  if (pose.split <= 0) {
    paintSac(ctx, pupaArc(0, TWO_PI, pose), pose, PUPA_INNER_ALPHA);
    return;
  }

  // Split: the two halves peel apart about the base from a crack at the
  // crown, and the beetle's head comes up between them.
  const gape = SPLIT_GAPE * easeInOut(pose.split);
  const crownAngle = -Math.PI / 2;
  drawEmergingBeetle(ctx, pose);
  for (const sign of [-1, 1]) {
    const rim = pupaArc(crownAngle, crownAngle + sign * Math.PI, pose);
    const crack = crackEdge(crownAngle, pose, sign).reverse();
    const half = [...rim, ...crack];
    ctx.save();
    ctx.translate(0, GROUND_Y);
    ctx.rotate(sign * gape);
    ctx.translate(0, -GROUND_Y);
    paintSac(ctx, half, pose, PUPA_INNER_ALPHA * (1 - pose.split));
    ctx.restore();
  }
  drawFluid(ctx, pose);
}

/** One pulse of the sealed sac, sampled at `phase` (0–1) of one cycle. */
export function pupaPulsePose(phase: number): PupaPose {
  const angle = phase * TWO_PI;
  return {
    pulse: (1 - Math.cos(angle)) / 2,
    // The push lands late in the swell, as if the thing inside is using it.
    push: (1 - Math.cos(angle - PUPA_PUSH_LAG)) / 2,
    pushAngle: deg(-60) + Math.sin(angle) * deg(30),
    split: 0,
    time: phase,
  };
}

/** How far behind the swell the push from inside lands, as a phase angle. */
const PUPA_PUSH_LAG = deg(70);

/** The hatch: the sac splits from the crown and the beetle's head comes up out of it. */
export function pupaHatchPose(progress: number): PupaPose {
  return {
    pulse: 1 - progress,
    push: 1 - progress,
    pushAngle: -Math.PI / 2,
    split: easeInOut(progress),
    time: progress,
  };
}
