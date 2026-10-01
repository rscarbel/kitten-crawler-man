/**
 * The painter behind the Former Circus Lemur.
 *
 * A ring-tailed lemur is recognised from a short list of cues, and at a 32 px
 * tile every one of them has to survive a halving:
 *
 *   - the **tail**: longer than the whole animal, banded in hard black and
 *     white, carried high in a question-mark curve. It is the largest and most
 *     contrasty shape on the figure, so it is painted first and painted loudest;
 *   - the **face**: a pale mask with a black, fox-like snout and black eye
 *     triangles around huge amber eyes. The eye is the one warm accent in a grey
 *     animal, so it is the brightest saturated colour on the head;
 *   - a **haunch-high** stance: the hind legs are longer than the fore, so the
 *     rump rides above the shoulders and the back slopes down to the neck;
 *   - long, dark, naked-looking **hands and feet**.
 *
 * The circus touch — a red fez with a gold tassel and a matching collar — is
 * kept small and sits on top of the anatomy, never in place of it.
 *
 * Only a profile is painted: the creature mirrors left and right and has no
 * head-on or away rows, so the side view faces +X and the runtime flips it.
 *
 * Coordinates are tile units with the origin at the centre of the logical tile
 * and +Y pointing down the screen.
 */

import { TWO_PI, clamp01, hash2, lerp, mix, rgba, type Pt } from './ratArt';
import { fillSoftEllipse, withClip } from './softShade';

type Ctx = CanvasRenderingContext2D;

// ── Palette ──────────────────────────────────────────────────────────────────

/**
 * The coat is a cool grey on the limbs and crown warming to a brownish grey
 * along the back. The belly is cream rather than white so the pure white of
 * the tail bands and the face mask stays the brightest thing on the animal.
 */
const COAT = {
  dorsum: '#7a6150',
  flank: '#8b8580',
  flankLight: '#aaa5a0',
  belly: '#d8d0c2',
  limb: '#7d7874',
  crown: '#5d5957',
} as const;

const MASK_WHITE = '#efebe4';
const MASK_SHADE = '#b9b3aa';
const SNOUT_BLACK = '#1f1c1c';
const SNOUT_SHEEN = '#4a4545';
const NOSE_BLACK = '#0c0a0a';
const EYE_PATCH = '#171414';
const IRIS_OUTER = '#c2560c';
const IRIS_INNER = '#ffb52e';
const PUPIL = '#0a0807';
const GLINT = '#ffffff';
const MOUTH_DARK = '#3d1418';
const TONGUE = '#c56a72';
const TOOTH = '#f6f1e6';
const HAND_DARK = '#2c2827';
const HAND_SHEEN = '#55504d';

const TAIL_WHITE = '#ece7de';
const TAIL_BLACK = '#1b1818';

const FEZ_RED = '#b3232b';
const FEZ_DARK = '#6e1016';
const FEZ_LIGHT = '#e0535a';
const GOLD = '#e3b347';
const GOLD_DARK = '#8a6418';
const COLLAR_RED = '#a81f27';

const INK = '#0d0a09';
const BLADE = '#d3d8e0';
const BLADE_EDGE = '#8a93a0';
const HANDLE = '#5a3218';

/** Width of the dark contour around every silhouette group. */
const INK_WIDTH = 0.022;
/** The far legs sit in the body's shadow; this much ink is mixed into them. */
const FAR_LIMB_SHADE = 0.38;

// ── Ground ───────────────────────────────────────────────────────────────────

/** Where the soles rest. */
export const GROUND_Y = 0.36;
const SHADOW_DROP = 0.025;
const SHADOW_RX = 0.32;
const SHADOW_RY = 0.065;
const SHADOW_ALPHA = 0.45;

// ── Rig ──────────────────────────────────────────────────────────────────────

/** Hip joint to shoulder joint, along the spine. */
export const SPINE_LENGTH = 0.27;
/** The rest slope of the back: hind legs are longer, so the rump rides higher. */
export const REST_PITCH = 0.16;

/** Where the head's centre sits relative to the shoulder, in the spine's frame. */
const NECK_REACH = { x: 0.13, y: -0.1 };
/** How much of the body's pitch the neck passes on; the rest the head levels out. */
const NECK_PITCH_SHARE = 0.55;

const HIND_SOCKET = { x: 0.01, y: 0.05 };
const FORE_SOCKET = { x: 0.0, y: 0.06 };
const THIGH = 0.14;
const SHANK = 0.15;
const UPPER_ARM = 0.1;
const FOREARM = 0.105;
const HIND_FOOT = 0.1;
const HAND = 0.07;

/** Rest positions of the ankles and wrists, relative to the hip, on flat ground. */
export const HIND_ANKLE_REST_DX = -0.03;
export const FORE_WRIST_REST_DX = SPINE_LENGTH + 0.03;
/** An ankle rides this far above the sole line because the heel pad is under it. */
export const ANKLE_HEIGHT = 0.025;
export const WRIST_HEIGHT = 0.018;
/** The far pair is set back and up a touch so it reads behind the near pair. */
export const FAR_LIMB_OFFSET: Pt = { x: -0.025, y: -0.012 };

/** Rest hip, chosen so a level-ground stance plants every foot. */
export const REST_HIP: Pt = { x: -0.12, y: 0.035 };

// ── Pose ─────────────────────────────────────────────────────────────────────

export interface LimbTarget {
  /** Where the ankle (hind) or wrist (fore) is, in tile units. */
  readonly x: number;
  readonly y: number;
  /** 0 planted, 1 fully raised; a raised foot points its toes at the ground. */
  readonly lift: number;
}

export interface ThrowArm {
  /** Upper-arm angle in screen radians (0 points forward, -π/2 straight up). */
  readonly shoulderAngle: number;
  /** Elbow bend added to the upper arm's angle for the forearm. */
  readonly elbowBend: number;
  /** Whether the knife is still in the hand. */
  readonly holdingKnife: boolean;
}

export interface LemurPose {
  readonly hip: Pt;
  /** Spine angle: 0 level, positive drops the shoulders, negative rears up. */
  readonly pitch: number;
  /** Extra head rotation on top of what the neck passes on. */
  readonly headTilt: number;
  /** 0 shut, 1 gaping. */
  readonly jaw: number;
  /** 0–1 chest swell. */
  readonly breathe: number;
  readonly hindNear: LimbTarget;
  readonly hindFar: LimbTarget;
  readonly foreNear: LimbTarget;
  readonly foreFar: LimbTarget;
  /** When set, the near forelimb is a throwing arm instead of a leg. */
  readonly throwArm: ThrowArm | null;
  /** Lateral wave travelling up the tail, in radians of bend. */
  readonly tailSway: number;
  /** 0–1 where along its loop the sway currently is. */
  readonly tailPhase: number;
  /** Ears pinned back (0 relaxed, 1 flat). */
  readonly earsBack: number;
}

function planted(x: number, height: number): LimbTarget {
  return { x, y: GROUND_Y - height, lift: 0 };
}

export function restLemurPose(): LemurPose {
  const hip = REST_HIP;
  return {
    hip,
    pitch: REST_PITCH,
    headTilt: 0,
    jaw: 0,
    breathe: 0,
    hindNear: planted(hip.x + HIND_ANKLE_REST_DX, ANKLE_HEIGHT),
    hindFar: planted(hip.x + HIND_ANKLE_REST_DX + FAR_LIMB_OFFSET.x, ANKLE_HEIGHT),
    foreNear: planted(hip.x + FORE_WRIST_REST_DX, WRIST_HEIGHT),
    foreFar: planted(hip.x + FORE_WRIST_REST_DX + FAR_LIMB_OFFSET.x, WRIST_HEIGHT),
    throwArm: null,
    tailSway: 0,
    tailPhase: 0,
    earsBack: 0,
  };
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

function rotate(p: Pt, angle: number): Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

/** A point given in the spine's own frame (origin hip, +X toward the shoulder). */
function inSpine(hip: Pt, pitch: number, local: Pt): Pt {
  return add(hip, rotate(local, pitch));
}

/**
 * Smallest reach any limb solve works with. A coincident root and target would
 * make the law-of-cosines solve 0/0, and the clamp after it cannot absorb a NaN.
 */
const MIN_REACH = 0.001;
/** A fully straight limb reads as a stilt; the solve always leaves this much bend. */
const LOCK_MARGIN = 0.004;

/** Two-bone solve; `bend` (±1) picks which side the joint breaks toward. */
function solveJoint(root: Pt, target: Pt, l1: number, l2: number, bend: number): Pt {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const reach = Math.max(MIN_REACH, Math.min(Math.hypot(dx, dy), l1 + l2 - LOCK_MARGIN));
  const base = Math.atan2(dy, dx);
  const cosA = (reach * reach + l1 * l1 - l2 * l2) / (2 * reach * l1);
  const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));
  const jointAngle = base + angle * bend;
  return { x: root.x + Math.cos(jointAngle) * l1, y: root.y + Math.sin(jointAngle) * l1 };
}

/**
 * Adds a tapered capsule from `a` (radius `ra`) to `b` (radius `rb`) to the
 * current path. Several of these in one path fill as their union, which is
 * what lets one contour stroke run around a whole limb without seams.
 */
function capsule(ctx: Ctx, a: Pt, b: Pt, ra: number, rb: number): void {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  ctx.moveTo(a.x + nx * ra, a.y + ny * ra);
  ctx.lineTo(b.x + nx * rb, b.y + ny * rb);
  ctx.arc(b.x, b.y, rb, angle + Math.PI / 2, angle - Math.PI / 2, true);
  ctx.lineTo(a.x - nx * ra, a.y - ny * ra);
  ctx.arc(a.x, a.y, ra, angle - Math.PI / 2, angle + Math.PI / 2, true);
  ctx.closePath();
}

function ellipsePath(ctx: Ctx, c: Pt, rx: number, ry: number, rotation: number): void {
  ctx.moveTo(c.x + Math.cos(rotation) * rx, c.y + Math.sin(rotation) * rx);
  ctx.ellipse(c.x, c.y, rx, ry, rotation, 0, TWO_PI);
}

/** Strokes the union outline in ink, then fills the union in `fill` over it. */
function inkedFill(ctx: Ctx, trace: () => void, fill: string | CanvasGradient): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = INK_WIDTH * 2;
  ctx.beginPath();
  trace();
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

/**
 * Short directional hair strokes scattered inside the current clip. At tile
 * size these average into a mottled coat rather than individual hairs, which is
 * the point: a flat fill is what made the old lemur read as a cut-out.
 */
function furStrokes(
  ctx: Ctx,
  seed: number,
  centre: Pt,
  rx: number,
  ry: number,
  angle: number,
  count: number,
  light: string,
  dark: string,
): void {
  const HAIR_LENGTH = 0.03;
  const HAIR_WIDTH = 0.007;
  const HAIR_JITTER = 0.5;
  const LIGHT_SHARE = 0.45;
  const HAIR_ALPHA = 0.55;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineWidth = HAIR_WIDTH;
  for (let i = 0; i < count; i++) {
    const u = hash2(seed + i, i * 1.7) * 2 - 1;
    const v = hash2(i * 2.3, seed - i) * 2 - 1;
    const local = rotate({ x: u * rx, y: v * ry }, angle);
    const x = centre.x + local.x;
    const y = centre.y + local.y;
    const roll = hash2(seed * 3 + i, i);
    const dir = angle + Math.PI + (hash2(i, seed * 5) - 0.5) * HAIR_JITTER;
    ctx.strokeStyle = rgba(roll < LIGHT_SHARE ? light : dark, HAIR_ALPHA);
    ctx.beginPath();
    ctx.moveTo(x, y);
    ctx.lineTo(x + Math.cos(dir) * HAIR_LENGTH, y + Math.sin(dir) * HAIR_LENGTH);
    ctx.stroke();
  }
  ctx.restore();
}

// ── Tail ─────────────────────────────────────────────────────────────────────

const TAIL_SEGMENTS = 40;
const TAIL_LENGTH = 0.84;
/** The tail leaves the rump angled up and back. */
const TAIL_BASE_HEADING = -Math.PI * 0.8;
/** The stem straightens toward vertical over its first stretch… */
const TAIL_STEM_TURN = 0.95;
/** …then the top hooks over toward the head: the question mark. */
const TAIL_HOOK_START = 0.5;
const TAIL_HOOK_TURN = 2.5;
const TAIL_BASE_WIDTH = 0.095;
const TAIL_TIP_WIDTH = 0.07;
/** Ring-tailed lemurs carry thirteen or so black bands; the last is the tip. */
const TAIL_BANDS = 21;
const TAIL_ROOT: Pt = { x: -0.08, y: -0.08 };
/** How many of the bands the sway wave spans, so the tip lags the base. */
const TAIL_SWAY_WAVELENGTH = 1.4;

interface TailPoint {
  readonly p: Pt;
  readonly heading: number;
  readonly s: number;
}

function buildTail(pose: LemurPose): TailPoint[] {
  const root = inSpine(pose.hip, pose.pitch, TAIL_ROOT);
  // The heading ignores the body's pitch: a lemur rearing up keeps its tail
  // carried high behind it rather than swinging it out flat along the ground.
  const baseHeading = TAIL_BASE_HEADING;
  const points: TailPoint[] = [];
  const step = TAIL_LENGTH / TAIL_SEGMENTS;
  let p = root;
  for (let i = 0; i <= TAIL_SEGMENTS; i++) {
    const s = i / TAIL_SEGMENTS;
    const stem = TAIL_STEM_TURN * Math.min(s, TAIL_HOOK_START);
    const hookProgress = clamp01((s - TAIL_HOOK_START) / (1 - TAIL_HOOK_START));
    const hook = TAIL_HOOK_TURN * hookProgress * hookProgress;
    const wave = Math.sin((s / TAIL_SWAY_WAVELENGTH - pose.tailPhase) * TWO_PI) * pose.tailSway * s;
    const heading = baseHeading + stem + hook + wave;
    points.push({ p, heading, s });
    p = { x: p.x + Math.cos(heading) * step, y: p.y + Math.sin(heading) * step };
  }
  return points;
}

function tailWidth(s: number): number {
  return lerp(TAIL_BASE_WIDTH, TAIL_TIP_WIDTH, s);
}

function traceTailRun(ctx: Ctx, pts: readonly TailPoint[], from: number, to: number): void {
  let started = false;
  for (const point of pts) {
    if (point.s < from || point.s > to) continue;
    if (!started) {
      ctx.moveTo(point.p.x, point.p.y);
      started = true;
    } else {
      ctx.lineTo(point.p.x, point.p.y);
    }
  }
}

/** A banded tube: ink, then each band, then a shade and a highlight running its length. */
function drawTail(ctx: Ctx, pose: LemurPose): void {
  const pts = buildTail(pose);
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  ctx.strokeStyle = INK;
  for (const width of [TAIL_BASE_WIDTH, TAIL_TIP_WIDTH]) {
    ctx.lineWidth = width + INK_WIDTH * 2;
    ctx.beginPath();
    traceTailRun(ctx, pts, width === TAIL_BASE_WIDTH ? 0 : 0.5, 1);
    ctx.stroke();
  }

  const bandLength = 1 / TAIL_BANDS;
  // A round cap overlaps the band before it, which keeps the rings tight on
  // the curve; a butt cap opens a wedge-shaped gap on the outside of the hook.
  for (let band = 0; band < TAIL_BANDS; band++) {
    const from = band * bandLength;
    const to = Math.min(1, from + bandLength + bandLength * 0.35);
    const isBlack = band % 2 === 1 || band === TAIL_BANDS - 1;
    ctx.strokeStyle = isBlack ? TAIL_BLACK : TAIL_WHITE;
    ctx.lineWidth = tailWidth(from + bandLength / 2);
    ctx.lineCap = band === TAIL_BANDS - 1 ? 'round' : 'butt';
    ctx.beginPath();
    traceTailRun(ctx, pts, from, to);
    ctx.stroke();
  }

  // Shade on the side away from the light, highlight on the side toward it,
  // so the bands wrap round a tube instead of lying flat as stripes.
  const SHADE_ALPHA = 0.32;
  const HIGHLIGHT_ALPHA = 0.28;
  const SIDE_OFFSET = 0.32;
  const SIDE_WIDTH = 0.4;
  const LIGHT: Pt = { x: -0.45, y: -0.9 };
  for (const [sign, color, alpha] of [
    [1, INK, SHADE_ALPHA],
    [-1, '#ffffff', HIGHLIGHT_ALPHA],
  ] as const) {
    ctx.strokeStyle = rgba(color, alpha);
    ctx.lineCap = 'round';
    ctx.lineWidth = TAIL_TIP_WIDTH * SIDE_WIDTH;
    ctx.beginPath();
    pts.forEach((point, index) => {
      const nx = -Math.sin(point.heading);
      const ny = Math.cos(point.heading);
      // Which side of the tube faces the light turns over with the hook; a
      // continuous facing slides the shade across instead of snapping it.
      const facing = nx * LIGHT.x + ny * LIGHT.y;
      const offset = tailWidth(point.s) * SIDE_OFFSET * sign * -facing;
      const x = point.p.x + nx * offset;
      const y = point.p.y + ny * offset;
      if (index === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }

  // Guard hairs along the tube break the edge, so it reads as a bushy tail
  // rather than a painted pipe.
  const TUFT_EVERY = 2;
  const TUFT_LENGTH = 0.022;
  ctx.lineWidth = 0.008;
  ctx.lineCap = 'round';
  for (let i = 1; i < pts.length - 1; i += TUFT_EVERY) {
    const point = pts[i];
    const band = Math.floor(point.s * TAIL_BANDS);
    const isBlack = band % 2 === 1 || band >= TAIL_BANDS - 1;
    ctx.strokeStyle = isBlack ? TAIL_BLACK : TAIL_WHITE;
    for (const side of [-1, 1]) {
      const jitter = (hash2(i, side) - 0.5) * 0.6;
      const angle = point.heading + (side * Math.PI) / 2 + jitter - side * 0.5;
      const half = tailWidth(point.s) / 2;
      const nx = -Math.sin(point.heading) * side;
      const ny = Math.cos(point.heading) * side;
      const base = { x: point.p.x + nx * half * 0.8, y: point.p.y + ny * half * 0.8 };
      ctx.beginPath();
      ctx.moveTo(base.x, base.y);
      ctx.lineTo(base.x + Math.cos(angle) * TUFT_LENGTH, base.y + Math.sin(angle) * TUFT_LENGTH);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ── Limbs ────────────────────────────────────────────────────────────────────

const THIGH_ROOT_R = 0.072;
const KNEE_R = 0.036;
const ANKLE_R = 0.024;
const SHOULDER_R = 0.05;
const ELBOW_R = 0.028;
const WRIST_R = 0.02;
const FOOT_TOE_R = 0.014;
const HAND_TIP_R = 0.012;
/** How far a lifted sole tips its toes down toward the ground. */
const LIFT_TOE_DROP = 1.1;
const DIGIT_COUNT = 3;
const DIGIT_SPREAD = 0.012;
/**
 * Each limb's fur seed. Fixed per limb rather than derived from the pose, so a
 * stepping leg does not reshuffle its hairs every frame while a planted one
 * holds still.
 */
const LIMB_SEEDS = { nearHind: 3, nearFore: 5, farHind: 7, farFore: 13, throwingArm: 41 } as const;

interface LimbChain {
  readonly root: Pt;
  readonly mid: Pt;
  readonly end: Pt;
  readonly tip: Pt;
}

function hindChain(pose: LemurPose, target: LimbTarget, offset: Pt): LimbChain {
  const root = add(inSpine(pose.hip, pose.pitch, HIND_SOCKET), offset);
  // The lemur's knee points forward, the way a squatting person's does.
  const mid = solveJoint(root, target, THIGH, SHANK, -1);
  const toeAngle = target.lift * LIFT_TOE_DROP;
  const tip = add(target, rotate({ x: HIND_FOOT, y: ANKLE_HEIGHT * 0.6 }, toeAngle));
  return { root, mid, end: target, tip };
}

function foreChain(pose: LemurPose, target: LimbTarget, offset: Pt): LimbChain {
  const shoulder = inSpine(pose.hip, pose.pitch, { x: SPINE_LENGTH, y: 0 });
  const root = add(add(shoulder, rotate(FORE_SOCKET, pose.pitch)), offset);
  // The elbow points back.
  const mid = solveJoint(root, target, UPPER_ARM, FOREARM, 1);
  const toeAngle = target.lift * LIFT_TOE_DROP;
  const tip = add(target, rotate({ x: HAND, y: WRIST_HEIGHT * 0.6 }, toeAngle));
  return { root, mid, end: target, tip };
}

function drawDigits(ctx: Ctx, from: Pt, to: Pt, width: number, color: string): void {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const nx = -Math.sin(angle);
  const ny = Math.cos(angle);
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.lineWidth = width;
  for (let i = 0; i < DIGIT_COUNT; i++) {
    const spread = (i - (DIGIT_COUNT - 1) / 2) * DIGIT_SPREAD;
    ctx.beginPath();
    ctx.moveTo(lerp(from.x, to.x, 0.55), lerp(from.y, to.y, 0.55));
    ctx.lineTo(to.x + nx * spread, to.y + ny * spread);
    ctx.stroke();
  }
  ctx.restore();
}

/**
 * One leg: furred upper segments over a dark naked hand or foot. `shade` mixes
 * in ink for the far side.
 */
function drawLimb(
  ctx: Ctx,
  chain: LimbChain,
  rootR: number,
  midR: number,
  endR: number,
  tipR: number,
  shade: number,
  seed: number,
): void {
  const furTop = mix(COAT.flank, INK, shade);
  const furLow = mix(COAT.limb, INK, shade);
  const hand = mix(HAND_DARK, INK, shade * 0.5);

  inkedFill(
    ctx,
    () => {
      capsule(ctx, chain.end, chain.tip, endR * 0.9, tipR);
    },
    hand,
  );

  const grad = ctx.createLinearGradient(chain.root.x, chain.root.y, chain.end.x, chain.end.y);
  grad.addColorStop(0, furTop);
  grad.addColorStop(1, furLow);
  const trace = (): void => {
    capsule(ctx, chain.root, chain.mid, rootR, midR);
    capsule(ctx, chain.mid, chain.end, midR, endR);
  };
  inkedFill(ctx, trace, grad);
  withClip(
    ctx,
    () => {
      ctx.beginPath();
      trace();
    },
    () => {
      const mid = {
        x: lerp(chain.root.x, chain.mid.x, 0.5),
        y: lerp(chain.root.y, chain.mid.y, 0.5),
      };
      fillSoftEllipse(
        ctx,
        mid.x - rootR * 0.3,
        mid.y - rootR * 0.4,
        rootR,
        rootR * 0.8,
        '#ffffff',
        LIMB_HIGHLIGHT_ALPHA * (1 - shade),
      );
      const angle = Math.atan2(chain.mid.y - chain.root.y, chain.mid.x - chain.root.x);
      furStrokes(ctx, seed, mid, rootR, THIGH / 2, angle, LIMB_FUR_STROKES, COAT.flankLight, INK);
    },
  );
  drawDigits(ctx, chain.end, chain.tip, tipR * 0.9, mix(HAND_SHEEN, INK, shade));
}

// ── Body ─────────────────────────────────────────────────────────────────────

/** The torso as three overlapping masses in the spine's frame. */
const RUMP = { x: -0.005, y: 0.0, rx: 0.13, ry: 0.12 };
const BARREL = { x: 0.13, y: 0.02, rx: 0.15, ry: 0.092 };
const CHEST = { x: SPINE_LENGTH - 0.015, y: 0.025, rx: 0.1, ry: 0.11 };
const BREATHE_SWELL = 0.012;
const NECK_ROOT: Pt = { x: 0, y: -0.01 };
const NECK_ROOT_R = 0.075;
const NECK_TOP_R = 0.06;
const LIMB_FUR_STROKES = 14;
const BODY_FUR_STROKES = 70;
const LIMB_HIGHLIGHT_ALPHA = 0.18;
/** Fixed so the coat's hairs hold still from frame to frame. */
const BODY_FUR_SEED = 11;

function traceBody(ctx: Ctx, pose: LemurPose): void {
  const swell = pose.breathe * BREATHE_SWELL;
  for (const mass of [RUMP, BARREL, CHEST]) {
    const c = inSpine(pose.hip, pose.pitch, { x: mass.x, y: mass.y });
    const extra = mass === RUMP ? 0 : swell;
    ellipsePath(ctx, c, mass.rx + extra * 0.5, mass.ry + extra, pose.pitch);
  }
  // The neck: a thick stalk from the chest to the back of the skull.
  const shoulder = inSpine(pose.hip, pose.pitch, { x: SPINE_LENGTH, y: 0 });
  const head = headCentre(pose);
  capsule(ctx, add(shoulder, rotate(NECK_ROOT, pose.pitch)), head, NECK_ROOT_R, NECK_TOP_R);
}

function drawBody(ctx: Ctx, pose: LemurPose): void {
  const back = inSpine(pose.hip, pose.pitch, { x: BARREL.x, y: -BARREL.ry });
  const belly = inSpine(pose.hip, pose.pitch, { x: BARREL.x, y: BARREL.ry + BARREL.y });
  const grad = ctx.createLinearGradient(back.x, back.y, belly.x, belly.y);
  grad.addColorStop(0, COAT.dorsum);
  grad.addColorStop(0.38, COAT.flank);
  grad.addColorStop(0.7, COAT.flank);
  grad.addColorStop(0.92, COAT.belly);
  grad.addColorStop(1, COAT.belly);
  const trace = (): void => traceBody(ctx, pose);
  inkedFill(ctx, trace, grad);

  withClip(
    ctx,
    () => {
      ctx.beginPath();
      trace();
    },
    () => {
      // The pale throat and chest bib continue the face mask down the front.
      const bib = inSpine(pose.hip, pose.pitch, { x: SPINE_LENGTH + 0.06, y: 0.05 });
      fillSoftEllipse(ctx, bib.x, bib.y, 0.07, 0.1, COAT.belly, 0.9, pose.pitch);
      const rump = inSpine(pose.hip, pose.pitch, { x: RUMP.x, y: RUMP.y });
      const barrel = inSpine(pose.hip, pose.pitch, { x: BARREL.x, y: BARREL.y });
      furStrokes(
        ctx,
        BODY_FUR_SEED,
        barrel,
        BARREL.rx + RUMP.rx / 2,
        BARREL.ry,
        pose.pitch,
        BODY_FUR_STROKES,
        COAT.flankLight,
        INK,
      );
      // The haunch is its own mass: lit on top, dark where it meets the barrel.
      fillSoftEllipse(ctx, rump.x - 0.02, rump.y - 0.05, 0.1, 0.06, '#ffffff', 0.2, pose.pitch);
      fillSoftEllipse(ctx, rump.x + 0.1, rump.y + 0.02, 0.04, 0.1, INK, 0.25, pose.pitch);
      const top = inSpine(pose.hip, pose.pitch, { x: BARREL.x, y: -0.05 });
      fillSoftEllipse(ctx, top.x, top.y, 0.18, 0.05, '#ffffff', 0.14, pose.pitch);
      const under = inSpine(pose.hip, pose.pitch, { x: BARREL.x, y: BARREL.ry + 0.02 });
      fillSoftEllipse(ctx, under.x, under.y, 0.2, 0.05, INK, 0.3, pose.pitch);
    },
  );
}

// ── Head ─────────────────────────────────────────────────────────────────────

/** The head is painted in its own frame, centred on the skull, facing +X. */
const SKULL = { rx: 0.085, ry: 0.075 };
const SNOUT_TIP: Pt = { x: 0.16, y: 0.022 };
const EYE: Pt = { x: 0.045, y: -0.012 };
const EYE_R = 0.033;
const JAW_HINGE: Pt = { x: 0.02, y: 0.035 };
const JAW_OPEN_ANGLE = 0.55;
const EAR_BASE: Pt = { x: -0.045, y: -0.055 };
const EAR_LENGTH = 0.085;
const EAR_WIDTH = 0.05;
/**
 * The head is drawn larger than life. At a 32 px tile a true-to-scale lemur
 * head is six pixels long, and the mask, the eye and the snout — everything
 * that says "lemur" rather than "cat" — merge into one grey dot.
 */
const HEAD_SCALE = 1.3;
const EAR_REST_ANGLE = -Math.PI * 0.62;
const EAR_PIN_ANGLE = -0.7;

function headCentre(pose: LemurPose): Pt {
  const shoulder = inSpine(pose.hip, pose.pitch, { x: SPINE_LENGTH, y: 0 });
  return add(shoulder, rotate(NECK_REACH, pose.pitch * NECK_PITCH_SHARE));
}

function headAngle(pose: LemurPose): number {
  return pose.pitch * (1 - NECK_PITCH_SHARE) * 0.4 + pose.headTilt;
}

function traceUpperHead(ctx: Ctx): void {
  ellipsePath(ctx, { x: 0, y: 0 }, SKULL.rx, SKULL.ry, 0);
  // A long fox-like snout from brow to nose.
  ctx.moveTo(0.0, -0.06);
  ctx.quadraticCurveTo(0.08, -0.045, SNOUT_TIP.x, SNOUT_TIP.y - 0.012);
  ctx.quadraticCurveTo(
    SNOUT_TIP.x + 0.012,
    SNOUT_TIP.y + 0.008,
    SNOUT_TIP.x - 0.008,
    SNOUT_TIP.y + 0.018,
  );
  ctx.quadraticCurveTo(0.08, 0.04, 0.0, 0.055);
  ctx.closePath();
}

function traceJaw(ctx: Ctx): void {
  ctx.moveTo(JAW_HINGE.x - 0.03, JAW_HINGE.y - 0.01);
  ctx.quadraticCurveTo(0.08, 0.04, SNOUT_TIP.x - 0.02, SNOUT_TIP.y + 0.018);
  ctx.quadraticCurveTo(SNOUT_TIP.x - 0.025, SNOUT_TIP.y + 0.034, 0.08, 0.062);
  ctx.quadraticCurveTo(0.03, 0.075, JAW_HINGE.x - 0.035, 0.06);
  ctx.closePath();
}

function drawEar(ctx: Ctx, pose: LemurPose, shade: number, dx: number): void {
  const angle = lerp(EAR_REST_ANGLE, EAR_REST_ANGLE + EAR_PIN_ANGLE, pose.earsBack);
  const base = { x: EAR_BASE.x + dx, y: EAR_BASE.y };
  const tip = add(base, rotate({ x: EAR_LENGTH, y: 0 }, angle));
  const side = rotate({ x: 0, y: EAR_WIDTH / 2 }, angle);
  const trace = (): void => {
    ctx.moveTo(base.x - side.x, base.y - side.y);
    ctx.quadraticCurveTo(tip.x - side.x * 1.3, tip.y - side.y * 1.3, tip.x, tip.y);
    ctx.quadraticCurveTo(
      tip.x + side.x * 1.3,
      tip.y + side.y * 1.3,
      base.x + side.x,
      base.y + side.y,
    );
    ctx.closePath();
  };
  inkedFill(ctx, trace, mix(MASK_WHITE, INK, shade));
  // The inner ear is grey; the white is the fringe round its rim.
  const inner = add(base, rotate({ x: EAR_LENGTH * 0.42, y: 0 }, angle));
  fillSoftEllipse(
    ctx,
    inner.x,
    inner.y,
    EAR_LENGTH * 0.38,
    EAR_WIDTH * 0.28,
    mix(COAT.crown, INK, shade),
    0.95,
    angle,
    0.7,
  );
}

function drawEye(ctx: Ctx): void {
  // The black eye triangle: a teardrop running down and forward toward the snout.
  ctx.save();
  ctx.fillStyle = EYE_PATCH;
  ctx.beginPath();
  ctx.moveTo(EYE.x - EYE_R * 1.6, EYE.y - EYE_R * 0.6);
  ctx.quadraticCurveTo(EYE.x, EYE.y - EYE_R * 2.0, EYE.x + EYE_R * 1.7, EYE.y - EYE_R * 0.2);
  ctx.quadraticCurveTo(
    EYE.x + EYE_R * 2.6,
    EYE.y + EYE_R * 1.4,
    EYE.x + EYE_R * 1.2,
    EYE.y + EYE_R * 1.9,
  );
  ctx.quadraticCurveTo(
    EYE.x - EYE_R * 1.2,
    EYE.y + EYE_R * 1.6,
    EYE.x - EYE_R * 1.6,
    EYE.y - EYE_R * 0.6,
  );
  ctx.fill();

  const iris = ctx.createRadialGradient(EYE.x, EYE.y, 0, EYE.x, EYE.y, EYE_R);
  iris.addColorStop(0, IRIS_INNER);
  iris.addColorStop(0.6, IRIS_INNER);
  iris.addColorStop(1, IRIS_OUTER);
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.arc(EYE.x, EYE.y, EYE_R, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = PUPIL;
  ctx.beginPath();
  ctx.arc(EYE.x + EYE_R * 0.15, EYE.y, EYE_R * 0.42, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = GLINT;
  ctx.beginPath();
  ctx.arc(EYE.x - EYE_R * 0.25, EYE.y - EYE_R * 0.35, EYE_R * 0.24, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** The fez sits on the crown just ahead of the ears, tipped rakishly forward. */
const FEZ_BASE: Pt = { x: -0.022, y: -0.08 };
const FEZ_TILT = 0.1;
const FEZ_HEIGHT = 0.066;
const FEZ_BOTTOM_HALF = 0.038;
const FEZ_TOP_HALF = 0.027;

function drawFez(ctx: Ctx, pose: LemurPose): void {
  ctx.save();
  ctx.translate(FEZ_BASE.x, FEZ_BASE.y);
  ctx.rotate(FEZ_TILT);
  const trace = (): void => {
    ctx.moveTo(-FEZ_BOTTOM_HALF, 0.006);
    ctx.lineTo(-FEZ_TOP_HALF, -FEZ_HEIGHT);
    ctx.quadraticCurveTo(0, -FEZ_HEIGHT - 0.01, FEZ_TOP_HALF, -FEZ_HEIGHT);
    ctx.lineTo(FEZ_BOTTOM_HALF, 0.006);
    ctx.quadraticCurveTo(0, 0.018, -FEZ_BOTTOM_HALF, 0.006);
    ctx.closePath();
  };
  const grad = ctx.createLinearGradient(-FEZ_BOTTOM_HALF, 0, FEZ_BOTTOM_HALF, 0);
  grad.addColorStop(0, FEZ_LIGHT);
  grad.addColorStop(0.45, FEZ_RED);
  grad.addColorStop(1, FEZ_DARK);
  inkedFill(ctx, trace, grad);
  // Gold band round the brim.
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 0.012;
  ctx.beginPath();
  ctx.moveTo(-FEZ_BOTTOM_HALF * 0.95, -0.006);
  ctx.quadraticCurveTo(0, 0.004, FEZ_BOTTOM_HALF * 0.95, -0.006);
  ctx.stroke();
  // The tassel swings off the crown and hangs down the back.
  const swing = Math.sin(pose.tailPhase * TWO_PI) * 0.15 - pose.pitch * 0.4;
  const top = { x: 0, y: -FEZ_HEIGHT - 0.004 };
  const end = add(top, rotate({ x: -0.03, y: 0.055 }, swing - FEZ_TILT));
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.02;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(top.x, top.y);
  ctx.quadraticCurveTo(-0.03, top.y - 0.005, end.x, end.y);
  ctx.stroke();
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 0.009;
  ctx.stroke();
  ctx.fillStyle = GOLD_DARK;
  ctx.beginPath();
  ctx.ellipse(end.x, end.y + 0.01, 0.012, 0.02, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.beginPath();
  ctx.ellipse(end.x - 0.003, end.y + 0.006, 0.007, 0.013, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function drawHead(ctx: Ctx, pose: LemurPose): void {
  const centre = headCentre(pose);
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(headAngle(pose));
  ctx.scale(HEAD_SCALE, HEAD_SCALE);

  drawEar(ctx, pose, FAR_LIMB_SHADE, 0.03);

  // Lower jaw first, so the upper head closes over its hinge.
  const jawAngle = pose.jaw * JAW_OPEN_ANGLE;
  if (pose.jaw > 0) {
    ctx.save();
    ctx.fillStyle = MOUTH_DARK;
    ctx.beginPath();
    ctx.moveTo(JAW_HINGE.x - 0.02, JAW_HINGE.y);
    ctx.lineTo(SNOUT_TIP.x - 0.01, SNOUT_TIP.y + 0.01);
    const jawTip = add(
      JAW_HINGE,
      rotate({ x: SNOUT_TIP.x - JAW_HINGE.x - 0.02, y: 0.02 }, jawAngle),
    );
    ctx.lineTo(jawTip.x, jawTip.y);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = TONGUE;
    ctx.beginPath();
    ctx.ellipse(0.07, 0.045 + pose.jaw * 0.02, 0.035, 0.012, jawAngle * 0.5, 0, TWO_PI);
    ctx.fill();
    ctx.restore();
  }
  ctx.save();
  ctx.translate(JAW_HINGE.x, JAW_HINGE.y);
  ctx.rotate(jawAngle);
  ctx.translate(-JAW_HINGE.x, -JAW_HINGE.y);
  inkedFill(ctx, () => traceJaw(ctx), MASK_WHITE);
  if (pose.jaw > 0) drawFangs(ctx, 1);
  ctx.restore();

  const grad = ctx.createLinearGradient(0, -SKULL.ry, 0, SKULL.ry);
  grad.addColorStop(0, COAT.crown);
  grad.addColorStop(0.35, COAT.flank);
  grad.addColorStop(0.6, MASK_WHITE);
  grad.addColorStop(1, MASK_WHITE);
  inkedFill(ctx, () => traceUpperHead(ctx), grad);

  withClip(
    ctx,
    () => {
      ctx.beginPath();
      traceUpperHead(ctx);
    },
    () => {
      // White brow band over the eye, below the dark crown.
      fillSoftEllipse(ctx, EYE.x - 0.01, EYE.y - 0.04, 0.06, 0.022, MASK_WHITE, 0.95, -0.15, 0.55);
      // The black snout: everything forward of the eye, lit along its ridge.
      ctx.fillStyle = SNOUT_BLACK;
      ctx.beginPath();
      ctx.moveTo(EYE.x + 0.025, -0.06);
      ctx.lineTo(SNOUT_TIP.x + 0.03, -0.06);
      ctx.lineTo(SNOUT_TIP.x + 0.03, SNOUT_TIP.y + 0.012);
      ctx.quadraticCurveTo(0.1, 0.03, EYE.x + 0.045, 0.026);
      ctx.quadraticCurveTo(EYE.x + 0.02, 0.0, EYE.x + 0.025, -0.06);
      ctx.fill();
      fillSoftEllipse(ctx, 0.11, -0.022, 0.05, 0.009, SNOUT_SHEEN, 0.9, 0.2);
      fillSoftEllipse(ctx, -0.04, -0.03, 0.05, 0.04, '#ffffff', 0.12);
      fillSoftEllipse(ctx, -0.06, 0.04, 0.05, 0.035, MASK_SHADE, 0.6);
    },
  );
  drawEye(ctx);
  ctx.fillStyle = NOSE_BLACK;
  ctx.beginPath();
  ctx.ellipse(SNOUT_TIP.x - 0.004, SNOUT_TIP.y - 0.002, 0.014, 0.011, 0.3, 0, TWO_PI);
  ctx.fill();

  drawEar(ctx, pose, 0, 0);
  drawFez(ctx, pose);
  ctx.restore();
}

function drawFangs(ctx: Ctx, open: number): void {
  ctx.fillStyle = TOOTH;
  for (const x of [0.1, 0.13]) {
    ctx.beginPath();
    ctx.moveTo(x, 0.036);
    ctx.lineTo(x + 0.008, 0.036 - 0.022 * open);
    ctx.lineTo(x + 0.014, 0.036);
    ctx.closePath();
    ctx.fill();
  }
}

/** The upper canines, shown only while the mouth is open. */
function drawUpperFangs(ctx: Ctx, pose: LemurPose): void {
  if (pose.jaw <= 0) return;
  const centre = headCentre(pose);
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(headAngle(pose));
  ctx.scale(HEAD_SCALE, HEAD_SCALE);
  ctx.fillStyle = TOOTH;
  ctx.beginPath();
  ctx.moveTo(0.118, 0.03);
  ctx.lineTo(0.124, 0.03 + 0.03 * pose.jaw);
  ctx.lineTo(0.132, 0.03);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── Collar ───────────────────────────────────────────────────────────────────

function drawCollar(ctx: Ctx, pose: LemurPose): void {
  const shoulder = inSpine(pose.hip, pose.pitch, { x: SPINE_LENGTH, y: 0 });
  const head = headCentre(pose);
  const neck = { x: lerp(shoulder.x, head.x, 0.55), y: lerp(shoulder.y, head.y, 0.55) };
  const along = Math.atan2(head.y - shoulder.y, head.x - shoulder.x);
  const across = rotate({ x: 0, y: 0.068 }, along);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = 0.04;
  const trace = (): void => {
    ctx.beginPath();
    ctx.moveTo(neck.x - across.x, neck.y - across.y);
    ctx.quadraticCurveTo(
      neck.x + across.y * 0.25,
      neck.y - across.x * 0.25,
      neck.x + across.x,
      neck.y + across.y,
    );
  };
  trace();
  ctx.stroke();
  ctx.strokeStyle = COLLAR_RED;
  ctx.lineWidth = 0.024;
  trace();
  ctx.stroke();
  // A brass bell under the chin.
  const bell = { x: neck.x + across.x * 0.95, y: neck.y + across.y * 0.95 + 0.012 };
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(bell.x, bell.y, 0.024, 0, TWO_PI);
  ctx.fill();
  const shine = ctx.createRadialGradient(bell.x - 0.006, bell.y - 0.006, 0, bell.x, bell.y, 0.017);
  shine.addColorStop(0, '#fff2b8');
  shine.addColorStop(0.5, GOLD);
  shine.addColorStop(1, GOLD_DARK);
  ctx.fillStyle = shine;
  ctx.beginPath();
  ctx.arc(bell.x, bell.y, 0.016, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

// ── Knife ────────────────────────────────────────────────────────────────────

const KNIFE_BLADE = 0.17;
const KNIFE_HALF_WIDTH = 0.02;
const KNIFE_HANDLE = 0.06;
/** The knife sits cocked a little off the line of the forearm, as a fist holds it. */
const KNIFE_GRIP_ANGLE = 0.25;

/**
 * A throwing knife drawn along +X from its grip at the origin: handle behind,
 * blade ahead. Shared by the knife in the paw and the knife in flight.
 */
export function drawKnife(ctx: Ctx): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.strokeStyle = INK;
  ctx.lineWidth = INK_WIDTH * 1.4;
  ctx.fillStyle = BLADE;
  ctx.beginPath();
  ctx.moveTo(0.01, -KNIFE_HALF_WIDTH);
  ctx.lineTo(KNIFE_BLADE * 0.75, -KNIFE_HALF_WIDTH * 0.9);
  ctx.lineTo(KNIFE_BLADE, 0);
  ctx.lineTo(0.01, KNIFE_HALF_WIDTH);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
  ctx.strokeStyle = BLADE_EDGE;
  ctx.lineWidth = 0.008;
  ctx.beginPath();
  ctx.moveTo(0.02, KNIFE_HALF_WIDTH * 0.35);
  ctx.lineTo(KNIFE_BLADE * 0.9, KNIFE_HALF_WIDTH * 0.15);
  ctx.stroke();
  ctx.fillStyle = HANDLE;
  ctx.strokeStyle = INK;
  ctx.lineWidth = INK_WIDTH;
  ctx.beginPath();
  ctx.rect(-KNIFE_HANDLE, -KNIFE_HALF_WIDTH * 0.7, KNIFE_HANDLE, KNIFE_HALF_WIDTH * 1.4);
  ctx.stroke();
  ctx.fill();
  ctx.fillStyle = GOLD;
  ctx.fillRect(-0.006, -KNIFE_HALF_WIDTH * 1.4, 0.014, KNIFE_HALF_WIDTH * 2.8);
  ctx.restore();
}

function drawThrowArm(ctx: Ctx, pose: LemurPose, arm: ThrowArm): void {
  const shoulder = inSpine(pose.hip, pose.pitch, { x: SPINE_LENGTH, y: 0 });
  const root = add(shoulder, rotate(FORE_SOCKET, pose.pitch));
  const elbow = add(root, rotate({ x: UPPER_ARM, y: 0 }, arm.shoulderAngle));
  const forearmAngle = arm.shoulderAngle + arm.elbowBend;
  const wrist = add(elbow, rotate({ x: FOREARM, y: 0 }, forearmAngle));
  const tip = add(wrist, rotate({ x: HAND * 0.8, y: 0 }, forearmAngle));

  drawLimb(
    ctx,
    { root, mid: elbow, end: wrist, tip },
    SHOULDER_R,
    ELBOW_R,
    WRIST_R,
    HAND_TIP_R,
    0,
    LIMB_SEEDS.throwingArm,
  );
  if (arm.holdingKnife) {
    ctx.save();
    ctx.translate(lerp(wrist.x, tip.x, 0.5), lerp(wrist.y, tip.y, 0.5));
    // The blade points on past the fingers so the knife stays readable
    // against the fur instead of hiding along the forearm.
    ctx.rotate(forearmAngle + KNIFE_GRIP_ANGLE);
    drawKnife(ctx);
    ctx.restore();
  }
}

// ── Whole figure ─────────────────────────────────────────────────────────────

function drawGroundShadow(ctx: Ctx, pose: LemurPose): void {
  const cx = pose.hip.x + SPINE_LENGTH / 2;
  const cy = GROUND_Y + SHADOW_DROP;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.scale(1, SHADOW_RY / SHADOW_RX);
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, SHADOW_RX);
  grad.addColorStop(0, rgba(INK, SHADOW_ALPHA));
  grad.addColorStop(1, rgba(INK, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(0, 0, SHADOW_RX, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/** Paints a lemur in profile facing +X. */
export function drawLemurSide(ctx: Ctx, pose: LemurPose): void {
  drawGroundShadow(ctx, pose);

  const farHind = hindChain(pose, pose.hindFar, FAR_LIMB_OFFSET);
  const farFore = foreChain(pose, pose.foreFar, FAR_LIMB_OFFSET);
  drawLimb(
    ctx,
    farHind,
    THIGH_ROOT_R,
    KNEE_R,
    ANKLE_R,
    FOOT_TOE_R,
    FAR_LIMB_SHADE,
    LIMB_SEEDS.farHind,
  );
  drawLimb(
    ctx,
    farFore,
    SHOULDER_R,
    ELBOW_R,
    WRIST_R,
    HAND_TIP_R,
    FAR_LIMB_SHADE,
    LIMB_SEEDS.farFore,
  );

  drawTail(ctx, pose);
  drawBody(ctx, pose);

  const nearHind = hindChain(pose, pose.hindNear, { x: 0, y: 0 });
  drawLimb(ctx, nearHind, THIGH_ROOT_R, KNEE_R, ANKLE_R, FOOT_TOE_R, 0, LIMB_SEEDS.nearHind);
  if (pose.throwArm === null) {
    const nearFore = foreChain(pose, pose.foreNear, { x: 0, y: 0 });
    drawLimb(ctx, nearFore, SHOULDER_R, ELBOW_R, WRIST_R, HAND_TIP_R, 0, LIMB_SEEDS.nearFore);
  }

  drawCollar(ctx, pose);
  drawHead(ctx, pose);
  drawUpperFangs(ctx, pose);
  if (pose.throwArm !== null) drawThrowArm(ctx, pose, pose.throwArm);
}
