#!/usr/bin/env tsx
/**
 * Generates the `spider` sprite sheet — the small hunting spiders bred by the
 * life machines in the floor-2 spider lab.
 *
 * The spider is drawn top-down facing "north" (toward -Y) and is rotated to its
 * facing direction at runtime, so a single orientation covers every heading.
 *
 * Anatomy is modelled on a real ground-hunting spider (Lycosidae): a pear-shaped
 * prosoma carrying the eye group and chelicerae, a narrow pedicel, an ovoid
 * opisthosoma with a scalloped folium, and eight legs of four segments whose
 * knees break outward the way a real spider's do.
 *
 * Rows (see the `spider` entry in src/images/enemies/manifest.json):
 *   0 walk         — alternating-tetrapod skitter, one full gait cycle
 *   1 idle         — planted stance, breathing abdomen, twitching pedipalps
 *   2 crouch       — attack wind-up: body hunkers, rear legs load for the leap
 *   3 pounce       — the hop: launch, airborne splay, hard landing, recovery
 *   4 death_curl   — legs fail, the body rolls onto its back and curls
 *   5 death_spasm  — thrashing seizure, then the roll and curl
 *   6 death_flip   — knocked spinning, lands on its back, bounces, curls
 *
 * Every death row ends on the same pose: on its back with the legs curled over
 * the belly. The creature holds that final frame as its corpse.
 *
 * Run: npx tsx scripts/generate-spider-sprite.ts
 */

import { createCanvas, type CanvasRenderingContext2D as Ctx } from 'canvas';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

// ── Sheet geometry (must match the manifest entry) ───────────────────────────

// 192px leaves clearance for the airborne pounce frames, where the body scales
// up and the forelegs are thrown a full body-length ahead.
const FRAME_W = 192;
const FRAME_H = 192;
/** Tile size the art is drawn at; the runtime scales by tileSize / TILE_SCALE. */
const TILE_SCALE = 64;
/** Rotation pivot within each frame — the spider's body centre. */
const PIVOT_X = FRAME_W / 2;
const PIVOT_Y = FRAME_H / 2;
/** Frames are rendered at this multiple and downsampled for smoother edges. */
const SUPERSAMPLE = 2;

const WALK_FRAMES = 8;
const IDLE_FRAMES = 6;
const CROUCH_FRAMES = 6;
const POUNCE_FRAMES = 10;
const DEATH_FRAMES = 12;

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
const DEGREES_PER_RADIAN = 180 / Math.PI;

function deg(degrees: number): number {
  return degrees / DEGREES_PER_RADIAN;
}

/** Smooth 0→1 ease used for limb swings and body transitions. */
function easeInOut(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));
  return clamped * clamped * (3 - 2 * clamped);
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Maps a value from one range to a clamped 0→1 progress. */
function ramp(value: number, start: number, end: number): number {
  return Math.min(1, Math.max(0, (value - start) / (end - start)));
}

/** Deterministic pseudo-random in [0,1) so re-runs produce identical art. */
function hashRandom(seed: number): number {
  const HASH_MULTIPLIER = 12.9898;
  const HASH_SCALE = 43758.5453;
  const x = Math.sin(seed * HASH_MULTIPLIER) * HASH_SCALE;
  return x - Math.floor(x);
}

// ── Palette ──────────────────────────────────────────────────────────────────

const CARAPACE_HIGHLIGHT = '#7a4f28';
const CARAPACE_MID = '#4d2e17';
const CARAPACE_EDGE = '#26150b';
const CARAPACE_RIM = '#150b05';
const CARAPACE_MARGIN_BAND = '#8a6237';

const ABDOMEN_HIGHLIGHT = '#5c3b1f';
const ABDOMEN_MID = '#3a2413';
const ABDOMEN_EDGE = '#1d1108';
const ABDOMEN_FOLIUM = '#120a04';
const ABDOMEN_PALE = '#967549';

const LEG_DARK = '#1e1209';
const LEG_MID = '#38210f';
const LEG_SHEEN = '#6b4423';
const LEG_BAND = '#7d5a30';
const SETA_COLOR = 'rgba(24,14,7,0.55)';
const SPINE_COLOR = 'rgba(14,8,4,0.85)';

const EYE_DARK = '#080604';
const EYE_RING = '#241408';
const EYE_GLINT = 'rgba(255,246,232,0.9)';
const EYE_SHINE_COLOR = 'rgba(214,132,54,0.85)';

const FANG_BASE = '#432414';
const FANG_TIP = '#1a0c05';

const VENTRAL_STERNUM = '#b19064';
const VENTRAL_STERNUM_EDGE = '#6d5230';
const VENTRAL_COXA = '#8a6d44';
const VENTRAL_BELLY = '#8e7148';
const VENTRAL_BELLY_EDGE = '#4a3620';
const VENTRAL_BOOK_LUNG = '#c9ad7d';
const VENTRAL_FURROW = '#3d2c17';
const VENTRAL_LEG_TINT = '#2a1a0c';
const VENTRAL_LEG_MID = '#5c3f22';

const SHADOW_COLOR = 'rgba(0,0,0,0.42)';

// ── Body geometry, in tile units (1.0 === TILE_SCALE px) ─────────────────────

const PROSOMA_FRONT_Y = -0.245;
const PROSOMA_REAR_Y = 0.1;
const PROSOMA_HALF_WIDTH = 0.168;
const ABDOMEN_FRONT_Y = 0.0;
const ABDOMEN_REAR_Y = 0.56;
const ABDOMEN_HALF_WIDTH = 0.235;
const ABDOMEN_WIDEST_Y = 0.24;
const PEDICEL_HALF_WIDTH = 0.038;

/**
 * One leg, described on the spider's right side; the left side mirrors it.
 * Angles are degrees from +X with +Y pointing toward the spider's rear, so a
 * negative angle reaches forward.
 */
interface LegDef {
  readonly attachX: number;
  readonly attachY: number;
  readonly femurAngle: number;
  readonly tibiaAngle: number;
  readonly tarsusAngle: number;
  readonly femur: number;
  readonly tibia: number;
  readonly tarsus: number;
}

/**
 * Front → rear. Leg IV is the longest and leg III the shortest, and the front
 * pair reaches forward while the rear pair trails back — the split that reads
 * as "spider" rather than "insect".
 *
 * Each femur runs close to the body's long axis and the tibia breaks hard
 * outward from it: that sharp knee, well clear of the body, is the single most
 * recognisable thing about a spider seen from above.
 */
const LEGS: readonly LegDef[] = [
  {
    attachX: 0.13,
    attachY: -0.16,
    femurAngle: -92,
    tibiaAngle: -46,
    tarsusAngle: -24,
    femur: 0.3,
    tibia: 0.3,
    tarsus: 0.17,
  },
  {
    attachX: 0.15,
    attachY: -0.06,
    femurAngle: -66,
    tibiaAngle: -4,
    tarsusAngle: 14,
    femur: 0.28,
    tibia: 0.28,
    tarsus: 0.15,
  },
  {
    attachX: 0.15,
    attachY: 0.04,
    femurAngle: 58,
    tibiaAngle: 8,
    tarsusAngle: 32,
    femur: 0.24,
    tibia: 0.24,
    tarsus: 0.13,
  },
  {
    attachX: 0.13,
    attachY: 0.13,
    femurAngle: 94,
    tibiaAngle: 48,
    tarsusAngle: 34,
    femur: 0.3,
    tibia: 0.31,
    tarsus: 0.17,
  },
];

const LEG_COUNT_PER_SIDE = LEGS.length;
const TOTAL_LEGS = LEG_COUNT_PER_SIDE * 2;
/** Legs 0–3 are the right side, 4–7 the left. */
const FIRST_LEFT_LEG = LEG_COUNT_PER_SIDE;

const FEMUR_HALF_WIDTH = 0.034;
const KNEE_HALF_WIDTH = 0.026;
const TIBIA_TIP_HALF_WIDTH = 0.019;
const TARSUS_TIP_HALF_WIDTH = 0.009;

// ── Pose model ───────────────────────────────────────────────────────────────

interface LegPose {
  readonly femurAngle: number;
  readonly tibiaAngle: number;
  readonly tarsusAngle: number;
  /** 0 planted, 1 fully raised mid-swing. */
  readonly lift: number;
  /** Scales every segment; below 1 pulls the leg in toward the body. */
  readonly reach: number;
}

interface SpiderPose {
  readonly legs: readonly LegPose[];
  /** Uniform scale — larger reads as closer to the camera, i.e. airborne. */
  readonly bodyScale: number;
  /** In-plane rotation, radians. */
  readonly spin: number;
  /** Roll about the long axis: 0 upright, π fully on its back. */
  readonly roll: number;
  readonly abdomenSway: number;
  readonly abdomenScale: number;
  /** Pulls the prosoma back toward the abdomen when the spider hunkers down. */
  readonly prosomaSink: number;
  readonly fangOpen: number;
  readonly palpSwing: number;
  readonly shadowScale: number;
  readonly shadowAlpha: number;
  readonly eyeShine: number;
}

const DEFAULT_SHADOW_ALPHA = 1;

function restLeg(def: LegDef): LegPose {
  return {
    femurAngle: def.femurAngle,
    tibiaAngle: def.tibiaAngle,
    tarsusAngle: def.tarsusAngle,
    lift: 0,
    reach: 1,
  };
}

function basePose(legs: readonly LegPose[]): SpiderPose {
  return {
    legs,
    bodyScale: 1,
    spin: 0,
    roll: 0,
    abdomenSway: 0,
    abdomenScale: 1,
    prosomaSink: 0,
    fangOpen: 0,
    palpSwing: 0,
    shadowScale: 1,
    shadowAlpha: DEFAULT_SHADOW_ALPHA,
    eyeShine: 0,
  };
}

/**
 * Straightens a leg out along `targetDegrees`, keeping a shallow residual bend.
 * A spider in flight extends its legs almost rigid instead of holding the deep
 * standing crouch, so the airborne frames need a target pose, not a rotation.
 */
function reachLeg(
  leg: LegPose,
  targetDegrees: number,
  bendDegrees: number,
  amount: number,
): LegPose {
  return {
    femurAngle: lerp(leg.femurAngle, targetDegrees - bendDegrees, amount),
    tibiaAngle: lerp(leg.tibiaAngle, targetDegrees, amount),
    tarsusAngle: lerp(leg.tarsusAngle, targetDegrees + bendDegrees * 0.6, amount),
    lift: leg.lift,
    reach: leg.reach,
  };
}

/** Rotates a leg's whole chain — used for strides, splays and flails. */
function swingLeg(leg: LegPose, degrees: number, lift = 0, reach = 1): LegPose {
  return {
    femurAngle: leg.femurAngle + degrees,
    tibiaAngle: leg.tibiaAngle + degrees,
    tarsusAngle: leg.tarsusAngle + degrees,
    lift: Math.max(leg.lift, lift),
    reach: leg.reach * reach,
  };
}

// A dead spider's legs curl because losing hydraulic pressure lets the flexors
// win. Two things happen at once: the femora pull in off their walking stance
// into an even radial fan, and everything past the knee folds back on itself.
// The result is the familiar rosette — knees at the outside, tarsi converging
// over the belly.
const CURL_FOLD_DEG = 120;
/** Femur headings the fan settles into, front → rear pair, on the right side. */
const CURL_FAN_DEG: readonly number[] = [-68, -26, 26, 68];
const CURL_REACH = 0.94;

function curlLeg(pair: number, leg: LegPose, amount: number): LegPose {
  const fanAngle = CURL_FAN_DEG[pair];
  // Fold back toward the body's long axis so no leg sweeps across to the
  // opposite side: forward-fanned legs curl rearward and vice versa.
  const fold = (fanAngle < 0 ? 1 : -1) * CURL_FOLD_DEG;
  return {
    femurAngle: lerp(leg.femurAngle, fanAngle, amount),
    tibiaAngle: lerp(leg.tibiaAngle, fanAngle + fold, amount),
    tarsusAngle: lerp(leg.tarsusAngle, fanAngle + fold * 2, amount),
    lift: leg.lift,
    reach: leg.reach * lerp(1, CURL_REACH, amount),
  };
}

// ── Low-level drawing helpers ────────────────────────────────────────────────

/**
 * Draws a limb segment as a tapered capsule: a quad between two half-widths
 * with a disc at each joint so consecutive segments meet without a seam.
 */
function taperedSegment(
  ctx: Ctx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  halfWidth1: number,
  halfWidth2: number,
  color: string,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const length = Math.hypot(dx, dy);
  if (length < Number.EPSILON) return;
  const nx = -dy / length;
  const ny = dx / length;

  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1 + nx * halfWidth1, y1 + ny * halfWidth1);
  ctx.lineTo(x2 + nx * halfWidth2, y2 + ny * halfWidth2);
  ctx.lineTo(x2 - nx * halfWidth2, y2 - ny * halfWidth2);
  ctx.lineTo(x1 - nx * halfWidth1, y1 - ny * halfWidth1);
  ctx.closePath();
  ctx.fill();

  ctx.beginPath();
  ctx.arc(x1, y1, halfWidth1, 0, TWO_PI);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(x2, y2, halfWidth2, 0, TWO_PI);
  ctx.fill();
}

/** The specular ridge along the top of a rounded segment. */
function segmentSheen(
  ctx: Ctx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  width: number,
  alpha: number,
): void {
  ctx.save();
  ctx.globalAlpha = alpha;
  ctx.strokeStyle = LEG_SHEEN;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
  ctx.restore();
}

const SETAE_PER_SEGMENT = 4;
const SETA_ANGLE_DEG = 58;
const SETA_LENGTH_JITTER = 0.4;

/** Fine bristles along a segment — the detail that sells "real spider". */
function drawSetae(
  ctx: Ctx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  length: number,
  seed: number,
  width: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const axis = Math.atan2(dy, dx);

  ctx.save();
  ctx.strokeStyle = SETA_COLOR;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  for (let i = 0; i < SETAE_PER_SEGMENT; i++) {
    const t = (i + 1) / (SETAE_PER_SEGMENT + 1);
    const bx = x1 + dx * t;
    const by = y1 + dy * t;
    for (const side of [-1, 1]) {
      const jitter = hashRandom(seed + i * 7 + (side + 1) * 31);
      const hairLength = length * (1 - SETA_LENGTH_JITTER + jitter * SETA_LENGTH_JITTER * 2);
      const angle = axis + side * deg(SETA_ANGLE_DEG) + (jitter - 0.5) * deg(20);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(angle) * hairLength, by + Math.sin(angle) * hairLength);
      ctx.stroke();
    }
  }
  ctx.restore();
}

const TIBIAL_SPINE_COUNT = 2;
const TIBIAL_SPINE_ANGLE_DEG = 42;

function drawTibialSpines(
  ctx: Ctx,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  length: number,
  width: number,
): void {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const axis = Math.atan2(dy, dx);

  ctx.save();
  ctx.strokeStyle = SPINE_COLOR;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  for (let i = 0; i < TIBIAL_SPINE_COUNT; i++) {
    const t = (i + 1) / (TIBIAL_SPINE_COUNT + 1);
    const bx = x1 + dx * t;
    const by = y1 + dy * t;
    for (const side of [-1, 1]) {
      const angle = axis + side * deg(TIBIAL_SPINE_ANGLE_DEG);
      ctx.beginPath();
      ctx.moveTo(bx, by);
      ctx.lineTo(bx + Math.cos(angle) * length, by + Math.sin(angle) * length);
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ── Legs ─────────────────────────────────────────────────────────────────────

/** A lifted leg foreshortens as it swings up out of the ground plane. */
const LIFT_FORESHORTEN = 0.12;
const LIFT_BRIGHTEN = 0.35;
const JOINT_NUB_SCALE = 1.15;
const CLAW_LENGTH = 0.035;
const CLAW_SPREAD_DEG = 26;

function drawLeg(ctx: Ctx, ts: number, side: number, def: LegDef, pose: LegPose, ventral: boolean) {
  ctx.save();
  ctx.scale(side, 1);

  const reach = pose.reach * (1 - pose.lift * LIFT_FORESHORTEN);
  const ax = def.attachX * ts;
  const ay = def.attachY * ts;

  const femurAngle = deg(pose.femurAngle);
  const tibiaAngle = deg(pose.tibiaAngle);
  const tarsusAngle = deg(pose.tarsusAngle);

  const kneeX = ax + Math.cos(femurAngle) * def.femur * ts * reach;
  const kneeY = ay + Math.sin(femurAngle) * def.femur * ts * reach;
  const bendX = kneeX + Math.cos(tibiaAngle) * def.tibia * ts * reach;
  const bendY = kneeY + Math.sin(tibiaAngle) * def.tibia * ts * reach;
  const tipX = bendX + Math.cos(tarsusAngle) * def.tarsus * ts * reach;
  const tipY = bendY + Math.sin(tarsusAngle) * def.tarsus * ts * reach;

  const femurHalf = FEMUR_HALF_WIDTH * ts;
  const kneeHalf = KNEE_HALF_WIDTH * ts;
  const tibiaTipHalf = TIBIA_TIP_HALF_WIDTH * ts;
  const tarsusTipHalf = TARSUS_TIP_HALF_WIDTH * ts;

  const baseColor = ventral ? VENTRAL_LEG_TINT : LEG_DARK;
  const midColor = ventral ? VENTRAL_LEG_MID : LEG_MID;

  taperedSegment(ctx, ax, ay, kneeX, kneeY, femurHalf, kneeHalf, midColor);
  taperedSegment(ctx, kneeX, kneeY, bendX, bendY, kneeHalf, tibiaTipHalf, baseColor);
  taperedSegment(ctx, bendX, bendY, tipX, tipY, tibiaTipHalf, tarsusTipHalf, baseColor);

  const sheenAlpha = (ventral ? 0.18 : 0.32) + pose.lift * LIFT_BRIGHTEN;
  segmentSheen(ctx, ax, ay, kneeX, kneeY, femurHalf * 0.7, sheenAlpha);
  segmentSheen(ctx, kneeX, kneeY, bendX, bendY, kneeHalf * 0.6, sheenAlpha * 0.8);

  // Pale annulations mark the joints the way banded hunting spiders' legs do.
  ctx.fillStyle = LEG_BAND;
  ctx.globalAlpha = ventral ? 0.35 : 0.7;
  ctx.beginPath();
  ctx.arc(kneeX, kneeY, kneeHalf * JOINT_NUB_SCALE, 0, TWO_PI);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(bendX, bendY, tibiaTipHalf * JOINT_NUB_SCALE, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 1;

  ctx.fillStyle = baseColor;
  ctx.beginPath();
  ctx.arc(kneeX, kneeY, kneeHalf * 0.75, 0, TWO_PI);
  ctx.fill();

  const setaLength = ts * 0.05;
  const hairWidth = Math.max(0.6, ts * 0.006);
  drawSetae(ctx, ax, ay, kneeX, kneeY, setaLength, def.femurAngle * 3 + side, hairWidth);
  drawSetae(
    ctx,
    kneeX,
    kneeY,
    bendX,
    bendY,
    setaLength * 0.8,
    def.tibiaAngle * 5 + side,
    hairWidth,
  );
  drawTibialSpines(ctx, kneeX, kneeY, bendX, bendY, ts * 0.055, hairWidth * 1.6);

  // Two tarsal claws at the tip.
  const clawAxis = Math.atan2(tipY - bendY, tipX - bendX);
  ctx.strokeStyle = baseColor;
  ctx.lineWidth = Math.max(0.7, ts * 0.008);
  ctx.lineCap = 'round';
  for (const clawSide of [-1, 1]) {
    const angle = clawAxis + clawSide * deg(CLAW_SPREAD_DEG);
    ctx.beginPath();
    ctx.moveTo(tipX, tipY);
    ctx.lineTo(
      tipX + Math.cos(angle) * ts * CLAW_LENGTH,
      tipY + Math.sin(angle) * ts * CLAW_LENGTH,
    );
    ctx.stroke();
  }

  ctx.restore();
}

// ── Prosoma (cephalothorax) ──────────────────────────────────────────────────

/** Builds the pear-shaped carapace outline, front-narrow and rear-broad. */
function prosomaPath(ctx: Ctx, ts: number): void {
  const w = PROSOMA_HALF_WIDTH * ts;
  const front = PROSOMA_FRONT_Y * ts;
  const rear = PROSOMA_REAR_Y * ts;

  ctx.beginPath();
  ctx.moveTo(0, front);
  ctx.bezierCurveTo(w * 0.72, front + ts * 0.005, w * 1.02, front + ts * 0.09, w, -ts * 0.1);
  ctx.bezierCurveTo(w * 0.98, -ts * 0.02, w * 0.78, rear - ts * 0.03, w * 0.38, rear);
  ctx.bezierCurveTo(w * 0.18, rear + ts * 0.012, -w * 0.18, rear + ts * 0.012, -w * 0.38, rear);
  ctx.bezierCurveTo(-w * 0.78, rear - ts * 0.03, -w * 0.98, -ts * 0.02, -w, -ts * 0.1);
  ctx.bezierCurveTo(-w * 1.02, front + ts * 0.09, -w * 0.72, front + ts * 0.005, 0, front);
  ctx.closePath();
}

const PROSOMA_GROOVE_COUNT = 4;

function drawProsomaDorsal(ctx: Ctx, ts: number): void {
  prosomaPath(ctx, ts);
  const gradient = ctx.createRadialGradient(0, -ts * 0.12, ts * 0.02, 0, -ts * 0.08, ts * 0.24);
  gradient.addColorStop(0, CARAPACE_HIGHLIGHT);
  gradient.addColorStop(0.55, CARAPACE_MID);
  gradient.addColorStop(1, CARAPACE_EDGE);
  ctx.fillStyle = gradient;
  ctx.fill();

  // Pale marginal band just inside the rim.
  ctx.save();
  ctx.clip();
  ctx.globalAlpha = 0.28;
  ctx.strokeStyle = CARAPACE_MARGIN_BAND;
  ctx.lineWidth = ts * 0.022;
  prosomaPath(ctx, ts);
  ctx.stroke();
  ctx.restore();

  // Raised cephalic region carrying the eyes.
  ctx.save();
  ctx.globalAlpha = 0.3;
  ctx.fillStyle = CARAPACE_HIGHLIGHT;
  ctx.beginPath();
  ctx.ellipse(0, -ts * 0.175, ts * 0.088, ts * 0.062, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();

  // Thoracic fovea and the grooves radiating from it toward each coxa.
  ctx.save();
  ctx.globalAlpha = 0.45;
  ctx.strokeStyle = CARAPACE_RIM;
  ctx.lineWidth = ts * 0.012;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(0, -ts * 0.045);
  ctx.lineTo(0, ts * 0.015);
  ctx.stroke();
  ctx.globalAlpha = 0.22;
  ctx.lineWidth = ts * 0.008;
  for (let i = 0; i < PROSOMA_GROOVE_COUNT; i++) {
    const spread = deg(38 + i * 30);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(0, -ts * 0.01);
      ctx.quadraticCurveTo(
        side * Math.cos(spread) * ts * 0.07,
        -ts * 0.01 + Math.sin(spread) * ts * 0.02 - ts * 0.03,
        side * Math.cos(spread) * ts * 0.15,
        -ts * 0.06 + Math.sin(spread) * ts * 0.06,
      );
      ctx.stroke();
    }
  }
  ctx.restore();

  ctx.strokeStyle = CARAPACE_RIM;
  ctx.lineWidth = ts * 0.014;
  prosomaPath(ctx, ts);
  ctx.stroke();
}

const STERNUM_HALF_WIDTH = 0.062;
const STERNUM_FRONT_Y = -0.16;
const STERNUM_REAR_Y = 0.04;
const VENTRAL_COXA_COUNT = 4;

function drawProsomaVentral(ctx: Ctx, ts: number): void {
  prosomaPath(ctx, ts);
  ctx.fillStyle = VENTRAL_STERNUM_EDGE;
  ctx.fill();
  ctx.strokeStyle = CARAPACE_RIM;
  ctx.lineWidth = ts * 0.014;
  ctx.stroke();

  // Coxae ring the sternum where the legs socket in.
  ctx.fillStyle = VENTRAL_COXA;
  for (let i = 0; i < VENTRAL_COXA_COUNT; i++) {
    const def = LEGS[i];
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(
        side * def.attachX * ts * 0.72,
        def.attachY * ts * 0.9,
        ts * 0.042,
        ts * 0.03,
        side * deg(20),
        0,
        TWO_PI,
      );
      ctx.fill();
    }
  }

  // Sternum: the pale heart-shaped plate, pointed toward the rear.
  const halfWidth = STERNUM_HALF_WIDTH * ts;
  const front = STERNUM_FRONT_Y * ts;
  const rear = STERNUM_REAR_Y * ts;
  ctx.beginPath();
  ctx.moveTo(0, rear);
  ctx.bezierCurveTo(halfWidth * 0.9, rear - ts * 0.06, halfWidth, front + ts * 0.05, 0, front);
  ctx.bezierCurveTo(-halfWidth, front + ts * 0.05, -halfWidth * 0.9, rear - ts * 0.06, 0, rear);
  ctx.closePath();
  ctx.fillStyle = VENTRAL_STERNUM;
  ctx.fill();
  ctx.globalAlpha = 0.5;
  ctx.strokeStyle = VENTRAL_STERNUM_EDGE;
  ctx.lineWidth = ts * 0.01;
  ctx.stroke();
  ctx.globalAlpha = 1;

  // Labium and mouthparts at the front of the sternum.
  ctx.fillStyle = VENTRAL_STERNUM_EDGE;
  ctx.beginPath();
  ctx.ellipse(0, front - ts * 0.03, ts * 0.032, ts * 0.026, 0, 0, TWO_PI);
  ctx.fill();
}

// ── Abdomen (opisthosoma) ────────────────────────────────────────────────────

function abdomenPath(ctx: Ctx, ts: number): void {
  const w = ABDOMEN_HALF_WIDTH * ts;
  const front = ABDOMEN_FRONT_Y * ts;
  const rear = ABDOMEN_REAR_Y * ts;
  const widest = ABDOMEN_WIDEST_Y * ts;

  ctx.beginPath();
  ctx.moveTo(0, front);
  ctx.bezierCurveTo(w * 0.62, front + ts * 0.02, w, widest - ts * 0.09, w, widest);
  ctx.bezierCurveTo(w, widest + ts * 0.16, w * 0.52, rear - ts * 0.02, 0, rear);
  ctx.bezierCurveTo(-w * 0.52, rear - ts * 0.02, -w, widest + ts * 0.16, -w, widest);
  ctx.bezierCurveTo(-w, widest - ts * 0.09, -w * 0.62, front + ts * 0.02, 0, front);
  ctx.closePath();
}

const FOLIUM_LOBE_COUNT = 4;
const FOLIUM_FRONT_Y = 0.06;
const FOLIUM_REAR_Y = 0.5;
const FOLIUM_HALF_WIDTH = 0.115;
const SIGILLA_COUNT = 3;
const CHEVRON_COUNT = 3;
const ABDOMEN_HAIR_COUNT = 30;

/** The scalloped leaf-shaped dorsal mark almost every ground spider carries. */
function drawFolium(ctx: Ctx, ts: number): void {
  const front = FOLIUM_FRONT_Y * ts;
  const rear = FOLIUM_REAR_Y * ts;
  const span = rear - front;

  ctx.beginPath();
  ctx.moveTo(0, front);
  for (const side of [1, -1]) {
    const points: Array<[number, number]> = [];
    for (let i = 0; i <= FOLIUM_LOBE_COUNT; i++) {
      const t = i / FOLIUM_LOBE_COUNT;
      const taper = Math.sin(Math.PI * Math.pow(t, 0.7));
      const lobe = i % 2 === 0 ? 1 : 0.55;
      points.push([side * FOLIUM_HALF_WIDTH * ts * taper * lobe, front + span * t]);
    }
    if (side === 1) {
      for (const [px, py] of points) ctx.lineTo(px, py);
    } else {
      for (let i = points.length - 1; i >= 0; i--) ctx.lineTo(points[i][0], points[i][1]);
    }
  }
  ctx.closePath();

  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.fillStyle = ABDOMEN_FOLIUM;
  ctx.fill();
  ctx.restore();
}

function drawAbdomenDorsal(ctx: Ctx, ts: number): void {
  abdomenPath(ctx, ts);
  const gradient = ctx.createRadialGradient(0, ts * 0.18, ts * 0.02, 0, ts * 0.24, ts * 0.32);
  gradient.addColorStop(0, ABDOMEN_HIGHLIGHT);
  gradient.addColorStop(0.6, ABDOMEN_MID);
  gradient.addColorStop(1, ABDOMEN_EDGE);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.save();
  ctx.clip();

  drawFolium(ctx, ts);

  // Pale cardiac mark riding the front of the folium.
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = ABDOMEN_PALE;
  ctx.beginPath();
  ctx.moveTo(0, ts * 0.05);
  ctx.quadraticCurveTo(ts * 0.03, ts * 0.12, 0, ts * 0.21);
  ctx.quadraticCurveTo(-ts * 0.03, ts * 0.12, 0, ts * 0.05);
  ctx.closePath();
  ctx.fill();

  // Sigilla — the paired muscle-attachment dimples.
  ctx.globalAlpha = 0.7;
  ctx.fillStyle = ABDOMEN_EDGE;
  for (let i = 0; i < SIGILLA_COUNT; i++) {
    const y = ts * (0.14 + i * 0.09);
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * ts * 0.048, y, ts * 0.013, ts * 0.009, 0, 0, TWO_PI);
      ctx.fill();
    }
  }

  // Pale chevrons stacked toward the spinnerets.
  ctx.globalAlpha = 0.4;
  ctx.strokeStyle = ABDOMEN_PALE;
  ctx.lineWidth = ts * 0.012;
  ctx.lineCap = 'round';
  for (let i = 0; i < CHEVRON_COUNT; i++) {
    const y = ts * (0.35 + i * 0.06);
    const halfWidth = ts * (0.105 - i * 0.022);
    ctx.beginPath();
    ctx.moveTo(-halfWidth, y);
    ctx.lineTo(0, y - ts * 0.05);
    ctx.lineTo(halfWidth, y);
    ctx.stroke();
  }
  ctx.restore();

  // Bristles standing off the silhouette.
  ctx.save();
  ctx.strokeStyle = SETA_COLOR;
  ctx.lineWidth = Math.max(0.6, ts * 0.007);
  ctx.lineCap = 'round';
  for (let i = 0; i < ABDOMEN_HAIR_COUNT; i++) {
    const angle = (i / ABDOMEN_HAIR_COUNT) * TWO_PI;
    const rx = ABDOMEN_HALF_WIDTH * ts;
    const ry = ((ABDOMEN_REAR_Y - ABDOMEN_FRONT_Y) / 2) * ts;
    const cy = ((ABDOMEN_REAR_Y + ABDOMEN_FRONT_Y) / 2) * ts;
    const px = Math.cos(angle) * rx;
    const py = cy + Math.sin(angle) * ry;
    const hairLength = ts * (0.035 + hashRandom(i * 13) * 0.03);
    ctx.beginPath();
    ctx.moveTo(px * 0.94, cy + (py - cy) * 0.94);
    ctx.lineTo(px + Math.cos(angle) * hairLength, py + Math.sin(angle) * hairLength);
    ctx.stroke();
  }
  ctx.restore();

  ctx.strokeStyle = CARAPACE_RIM;
  ctx.lineWidth = ts * 0.012;
  abdomenPath(ctx, ts);
  ctx.stroke();
}

const BOOK_LUNG_Y = 0.11;
const EPIGASTRIC_FURROW_Y = 0.15;

function drawAbdomenVentral(ctx: Ctx, ts: number): void {
  abdomenPath(ctx, ts);
  const gradient = ctx.createRadialGradient(0, ts * 0.2, ts * 0.02, 0, ts * 0.24, ts * 0.32);
  gradient.addColorStop(0, VENTRAL_BELLY);
  gradient.addColorStop(1, VENTRAL_BELLY_EDGE);
  ctx.fillStyle = gradient;
  ctx.fill();

  ctx.save();
  ctx.clip();

  // Book-lung covers flanking the epigastric furrow.
  ctx.fillStyle = VENTRAL_BOOK_LUNG;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(side * ts * 0.095, ts * BOOK_LUNG_Y, ts * 0.045, ts * 0.03, 0, 0, TWO_PI);
    ctx.fill();
  }

  ctx.strokeStyle = VENTRAL_FURROW;
  ctx.lineWidth = ts * 0.014;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(-ts * 0.14, ts * EPIGASTRIC_FURROW_Y);
  ctx.quadraticCurveTo(0, ts * (EPIGASTRIC_FURROW_Y + 0.02), ts * 0.14, ts * EPIGASTRIC_FURROW_Y);
  ctx.stroke();

  ctx.globalAlpha = 0.35;
  ctx.lineWidth = ts * 0.01;
  ctx.beginPath();
  ctx.moveTo(0, ts * (EPIGASTRIC_FURROW_Y + 0.02));
  ctx.lineTo(0, ts * 0.5);
  ctx.stroke();
  ctx.restore();

  ctx.strokeStyle = CARAPACE_RIM;
  ctx.lineWidth = ts * 0.012;
  abdomenPath(ctx, ts);
  ctx.stroke();
}

const SPINNERET_PAIRS: readonly (readonly [number, number, number, number])[] = [
  [0.028, 0.555, 0.02, 0.038],
  [0.062, 0.525, 0.016, 0.03],
];

function drawSpinnerets(ctx: Ctx, ts: number, ventral: boolean): void {
  ctx.fillStyle = ventral ? VENTRAL_BELLY_EDGE : ABDOMEN_EDGE;
  for (const [offsetX, offsetY, halfWidth, length] of SPINNERET_PAIRS) {
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(
        side * offsetX * ts,
        offsetY * ts,
        halfWidth * ts,
        length * ts,
        side * deg(14),
        0,
        TWO_PI,
      );
      ctx.fill();
    }
  }
}

function drawPedicel(ctx: Ctx, ts: number, ventral: boolean): void {
  ctx.fillStyle = ventral ? VENTRAL_BELLY_EDGE : CARAPACE_EDGE;
  ctx.beginPath();
  ctx.ellipse(0, ts * 0.04, PEDICEL_HALF_WIDTH * ts, ts * 0.05, 0, 0, TWO_PI);
  ctx.fill();
}

// ── Eyes, chelicerae, pedipalps ──────────────────────────────────────────────

interface EyeDef {
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/**
 * Lycosid eye group: a front row of four small eyes, a pair of large posterior
 * median eyes above them, and two posterior laterals set wide on the carapace.
 */
const EYES: readonly EyeDef[] = [
  { x: 0.021, y: -0.216, r: 0.0115 },
  { x: 0.056, y: -0.208, r: 0.0105 },
  { x: 0.042, y: -0.166, r: 0.0245 },
  { x: 0.078, y: -0.118, r: 0.0165 },
];

function drawEyes(ctx: Ctx, ts: number, shine: number): void {
  for (const eye of EYES) {
    for (const side of [-1, 1]) {
      const ex = side * eye.x * ts;
      const ey = eye.y * ts;
      const er = eye.r * ts;

      ctx.fillStyle = EYE_RING;
      ctx.beginPath();
      ctx.arc(ex, ey, er * 1.22, 0, TWO_PI);
      ctx.fill();

      if (shine > 0) {
        ctx.save();
        ctx.globalAlpha = shine;
        ctx.fillStyle = EYE_SHINE_COLOR;
        ctx.beginPath();
        ctx.arc(ex, ey, er * 1.05, 0, TWO_PI);
        ctx.fill();
        ctx.restore();
      }

      ctx.fillStyle = EYE_DARK;
      ctx.beginPath();
      ctx.arc(ex, ey, er * (shine > 0 ? 0.78 : 1), 0, TWO_PI);
      ctx.fill();

      ctx.fillStyle = EYE_GLINT;
      ctx.beginPath();
      ctx.arc(ex - er * 0.3, ey - er * 0.32, er * 0.28, 0, TWO_PI);
      ctx.fill();
    }
  }
}

const CHELICERA_ATTACH_X = 0.052;
const CHELICERA_ATTACH_Y = -0.185;
const CHELICERA_LENGTH = 0.088;
const CHELICERA_HALF_WIDTH = 0.042;
const CHELICERA_REST_ANGLE_DEG = -84;
const CHELICERA_SPREAD_DEG = 26;
/** How far the whole jaw pushes out past the carapace when it gapes. */
const CHELICERA_EXTEND = 0.045;
const FANG_LENGTH = 0.07;
const FANG_REST_FOLD = 0.3;
const FANG_SWING_DEG = 96;

function drawChelicerae(ctx: Ctx, ts: number, open: number): void {
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);

    const baseX = CHELICERA_ATTACH_X * ts;
    const baseY = (CHELICERA_ATTACH_Y - CHELICERA_EXTEND * open) * ts;
    const angle = deg(CHELICERA_REST_ANGLE_DEG + open * CHELICERA_SPREAD_DEG);
    const tipX = baseX + Math.cos(angle) * CHELICERA_LENGTH * ts;
    const tipY = baseY + Math.sin(angle) * CHELICERA_LENGTH * ts;

    taperedSegment(
      ctx,
      baseX,
      baseY,
      tipX,
      tipY,
      CHELICERA_HALF_WIDTH * ts,
      CHELICERA_HALF_WIDTH * ts * 0.62,
      FANG_BASE,
    );
    segmentSheen(ctx, baseX, baseY, tipX, tipY, CHELICERA_HALF_WIDTH * ts * 0.5, 0.28);

    // At rest the fang folds back under the chelicera; opening swings it out.
    const fangAngle = angle + deg(FANG_SWING_DEG * (1 - open));
    const fangLength = FANG_LENGTH * ts * lerp(FANG_REST_FOLD, 1, open);
    const jointX = tipX;
    const jointY = tipY;
    const curveX = jointX + Math.cos(fangAngle - deg(18)) * fangLength * 0.6;
    const curveY = jointY + Math.sin(fangAngle - deg(18)) * fangLength * 0.6;
    const fangTipX = jointX + Math.cos(fangAngle) * fangLength;
    const fangTipY = jointY + Math.sin(fangAngle) * fangLength;

    taperedSegment(
      ctx,
      jointX,
      jointY,
      curveX,
      curveY,
      CHELICERA_HALF_WIDTH * ts * 0.5,
      CHELICERA_HALF_WIDTH * ts * 0.3,
      FANG_TIP,
    );
    taperedSegment(
      ctx,
      curveX,
      curveY,
      fangTipX,
      fangTipY,
      CHELICERA_HALF_WIDTH * ts * 0.3,
      ts * 0.004,
      FANG_TIP,
    );

    ctx.restore();
  }
}

const PALP_ATTACH_X = 0.078;
const PALP_ATTACH_Y = -0.175;
const PALP_FEMUR = 0.058;
const PALP_TARSUS = 0.048;
const PALP_FEMUR_ANGLE_DEG = -104;
const PALP_TARSUS_ANGLE_DEG = -74;

function drawPedipalps(ctx: Ctx, ts: number, swingDegrees: number): void {
  for (const side of [-1, 1]) {
    ctx.save();
    ctx.scale(side, 1);

    const baseX = PALP_ATTACH_X * ts;
    const baseY = PALP_ATTACH_Y * ts;
    const femurAngle = deg(PALP_FEMUR_ANGLE_DEG + swingDegrees);
    const kneeX = baseX + Math.cos(femurAngle) * PALP_FEMUR * ts;
    const kneeY = baseY + Math.sin(femurAngle) * PALP_FEMUR * ts;
    const tarsusAngle = deg(PALP_TARSUS_ANGLE_DEG + swingDegrees * 1.4);
    const tipX = kneeX + Math.cos(tarsusAngle) * PALP_TARSUS * ts;
    const tipY = kneeY + Math.sin(tarsusAngle) * PALP_TARSUS * ts;

    taperedSegment(ctx, baseX, baseY, kneeX, kneeY, ts * 0.019, ts * 0.015, LEG_MID);
    taperedSegment(ctx, kneeX, kneeY, tipX, tipY, ts * 0.015, ts * 0.017, LEG_DARK);
    drawSetae(ctx, kneeX, kneeY, tipX, tipY, ts * 0.03, side * 97, Math.max(0.6, ts * 0.006));

    ctx.restore();
  }
}

// ── Whole-spider assembly ────────────────────────────────────────────────────

const SHADOW_RX = 0.32;
const SHADOW_RY = 0.36;
const SHADOW_CENTER_Y = 0.1;
/** Never squash the body to nothing while it rolls edge-on. */
const MIN_ROLL_SCALE = 0.07;

function drawShadow(ctx: Ctx, ts: number, pose: SpiderPose): void {
  if (pose.shadowAlpha <= 0) return;
  const rx = SHADOW_RX * ts * pose.shadowScale;
  const ry = SHADOW_RY * ts * pose.shadowScale;
  const gradient = ctx.createRadialGradient(
    0,
    SHADOW_CENTER_Y * ts,
    0,
    0,
    SHADOW_CENTER_Y * ts,
    ry,
  );
  gradient.addColorStop(0, SHADOW_COLOR);
  gradient.addColorStop(0.6, 'rgba(0,0,0,0.22)');
  gradient.addColorStop(1, 'rgba(0,0,0,0)');

  ctx.save();
  ctx.globalAlpha = pose.shadowAlpha;
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(0, SHADOW_CENTER_Y * ts, rx, ry, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

function drawSpider(ctx: Ctx, cx: number, cy: number, ts: number, pose: SpiderPose): void {
  ctx.save();
  ctx.translate(cx, cy);

  drawShadow(ctx, ts, pose);

  ctx.rotate(pose.spin);
  const rollScaleX = Math.max(MIN_ROLL_SCALE, Math.abs(Math.cos(pose.roll)));
  ctx.scale(rollScaleX * pose.bodyScale, pose.bodyScale);

  const ventral = pose.roll > HALF_PI;

  const drawLegs = () => {
    for (let i = 0; i < TOTAL_LEGS; i++) {
      const side = i < FIRST_LEFT_LEG ? 1 : -1;
      drawLeg(ctx, ts, side, LEGS[i % LEG_COUNT_PER_SIDE], pose.legs[i], ventral);
    }
  };

  // Upright, the legs socket in under the carapace; on its back the curled legs
  // fold over the belly and read in front of it.
  if (!ventral) drawLegs();

  ctx.save();
  ctx.translate(pose.abdomenSway * ts, 0);
  ctx.scale(pose.abdomenScale, pose.abdomenScale);
  if (ventral) drawAbdomenVentral(ctx, ts);
  else drawAbdomenDorsal(ctx, ts);
  drawSpinnerets(ctx, ts, ventral);
  ctx.restore();

  drawPedicel(ctx, ts, ventral);

  ctx.save();
  ctx.translate(0, pose.prosomaSink * ts);
  if (ventral) {
    drawProsomaVentral(ctx, ts);
  } else {
    // Mouthparts go down before the carapace so it overlaps their bases the way
    // a real spider's does — only the working ends clear the front edge.
    drawPedipalps(ctx, ts, pose.palpSwing);
    drawChelicerae(ctx, ts, pose.fangOpen);
    drawProsomaDorsal(ctx, ts);
    drawEyes(ctx, ts, pose.eyeShine);
  }
  ctx.restore();

  if (ventral) drawLegs();

  ctx.restore();
}

// ── Pose builders, one per animation row ─────────────────────────────────────

/** Fraction of the gait cycle a leg spends in the air. */
const SWING_FRACTION = 0.32;
const STRIDE_DEG = 14;
const WALK_YAW_RAD = 0.035;
const WALK_BOB = 0.018;
const WALK_ABDOMEN_SWAY = 0.016;

interface GaitSample {
  /** -1 fully forward, +1 fully rearward. */
  readonly stride: number;
  readonly lift: number;
}

function gaitSample(phase: number): GaitSample {
  const p = phase - Math.floor(phase);
  if (p < SWING_FRACTION) {
    const t = p / SWING_FRACTION;
    return { stride: 1 - 2 * easeInOut(t), lift: Math.sin(t * Math.PI) };
  }
  const t = (p - SWING_FRACTION) / (1 - SWING_FRACTION);
  return { stride: -1 + 2 * t, lift: 0 };
}

/**
 * Alternating tetrapod: legs L1, R2, L3, R4 swing while R1, L2, R3, L4 hold the
 * ground, then the two sets trade — the gait that makes a spider look skittery
 * rather than marching.
 */
function gaitGroupOffset(legIndex: number): number {
  const side = legIndex < FIRST_LEFT_LEG ? 0 : 1;
  const pair = legIndex % LEG_COUNT_PER_SIDE;
  return (pair + side) % 2 === 0 ? 0 : 0.5;
}

function walkPose(cyclePhase: number): SpiderPose {
  const legs: LegPose[] = [];
  for (let i = 0; i < TOTAL_LEGS; i++) {
    const { stride, lift } = gaitSample(cyclePhase + gaitGroupOffset(i));
    legs.push(swingLeg(restLeg(LEGS[i % LEG_COUNT_PER_SIDE]), stride * STRIDE_DEG, lift));
  }

  const yaw = Math.sin(cyclePhase * TWO_PI) * WALK_YAW_RAD;
  return {
    ...basePose(legs),
    spin: yaw,
    bodyScale: 1 + Math.sin(cyclePhase * TWO_PI * 2) * WALK_BOB,
    abdomenSway: -Math.sin(cyclePhase * TWO_PI) * WALK_ABDOMEN_SWAY,
    palpSwing: Math.sin(cyclePhase * TWO_PI * 2) * 6,
  };
}

const IDLE_TREMOR_DEG = 1.8;
const IDLE_BREATH = 0.014;
const IDLE_PALP_SWING_DEG = 9;

function idlePose(cyclePhase: number): SpiderPose {
  const legs: LegPose[] = [];
  for (let i = 0; i < TOTAL_LEGS; i++) {
    const tremorPhase = cyclePhase * TWO_PI + i * 1.7;
    legs.push(
      swingLeg(restLeg(LEGS[i % LEG_COUNT_PER_SIDE]), Math.sin(tremorPhase) * IDLE_TREMOR_DEG),
    );
  }
  return {
    ...basePose(legs),
    abdomenScale: 1 + Math.sin(cyclePhase * TWO_PI) * IDLE_BREATH,
    palpSwing: Math.sin(cyclePhase * TWO_PI * 3) * IDLE_PALP_SWING_DEG,
  };
}

// Wind-up: the front pair rocks back and lifts clear while the rear pair loads.
const CROUCH_FRONT_PULL_DEG = 26;
const CROUCH_REAR_LOAD_DEG = -18;
const CROUCH_FRONT_REACH = 0.78;
const CROUCH_REAR_REACH = 1.06;
const CROUCH_BODY_SCALE = 0.93;
const CROUCH_SINK = 0.03;
const CROUCH_FANG_OPEN = 0.45;

function crouchPose(progress: number): SpiderPose {
  const t = easeInOut(progress);
  const legs: LegPose[] = [];
  for (let i = 0; i < TOTAL_LEGS; i++) {
    const pair = i % LEG_COUNT_PER_SIDE;
    const isFrontPair = pair < 2;
    const rest = restLeg(LEGS[pair]);
    const sweep = isFrontPair ? CROUCH_FRONT_PULL_DEG : CROUCH_REAR_LOAD_DEG;
    const reach = lerp(1, isFrontPair ? CROUCH_FRONT_REACH : CROUCH_REAR_REACH, t);
    legs.push(swingLeg(rest, sweep * t, isFrontPair ? t * 0.5 : 0, reach));
  }
  return {
    ...basePose(legs),
    bodyScale: lerp(1, CROUCH_BODY_SCALE, t),
    prosomaSink: CROUCH_SINK * t,
    abdomenSway: 0,
    fangOpen: CROUCH_FANG_OPEN * t,
    palpSwing: -8 * t,
    shadowScale: lerp(1, 1.06, t),
    eyeShine: t * 0.5,
  };
}

// The hop: an explosive launch, an airborne splay, then a hard four-point
// landing. Height reads as scale because the camera looks straight down.
const POUNCE_LAUNCH_END = 0.18;
const POUNCE_AIRBORNE_END = 0.6;
const POUNCE_IMPACT_END = 0.78;
const POUNCE_PEAK_SCALE = 1.26;
const POUNCE_LANDING_SQUASH = 0.94;
/**
 * Airborne direction per leg pair, front → rear. Fanning the four out to
 * separate headings keeps them from collapsing into two parallel lines: the
 * forelegs reach ahead like grapples, the hind pair trails from the kick.
 */
const POUNCE_AIR_TARGET_DEG: readonly number[] = [-62, -26, 30, 64];
const POUNCE_AIR_BEND_DEG = 18;
const POUNCE_SPLAY_DEG = 20;
const POUNCE_AIR_SHADOW_SCALE = 0.55;
const POUNCE_AIR_SHADOW_ALPHA = 0.5;

function pouncePose(progress: number): SpiderPose {
  const launch = ramp(progress, 0, POUNCE_LAUNCH_END);
  const airborne = ramp(progress, POUNCE_LAUNCH_END, POUNCE_AIRBORNE_END);
  const impact = ramp(progress, POUNCE_AIRBORNE_END, POUNCE_IMPACT_END);
  const recover = ramp(progress, POUNCE_IMPACT_END, 1);

  // Height rises through the launch and falls away as the impact lands.
  const height = Math.min(launch, 1) * (1 - impact);
  const airPose = launch * (1 - impact);

  const legs: LegPose[] = [];
  for (let i = 0; i < TOTAL_LEGS; i++) {
    const pair = i % LEG_COUNT_PER_SIDE;
    const isFrontPair = pair < 2;
    const rest = restLeg(LEGS[pair]);

    const airReach = isFrontPair ? 1.12 : 1.1;
    const splay = impact * (1 - recover) * POUNCE_SPLAY_DEG * (isFrontPair ? -1 : 1);
    const reach = lerp(1, airReach, airPose) * lerp(1, 1.08, impact * (1 - recover));

    const extended = reachLeg(rest, POUNCE_AIR_TARGET_DEG[pair], POUNCE_AIR_BEND_DEG, airPose);
    legs.push(swingLeg(extended, splay, airPose * (isFrontPair ? 0.8 : 0.4), reach));
  }

  const scale =
    lerp(1, POUNCE_PEAK_SCALE, easeInOut(height)) *
    lerp(1, POUNCE_LANDING_SQUASH, impact * (1 - recover));

  return {
    ...basePose(legs),
    bodyScale: scale,
    abdomenScale: lerp(1, 1.05, airborne * (1 - impact)),
    fangOpen: Math.max(CROUCH_FANG_OPEN, Math.min(1, launch * 1.6)) * (1 - recover * 0.6),
    palpSwing: -18 * airPose,
    shadowScale: lerp(1, POUNCE_AIR_SHADOW_SCALE, height),
    shadowAlpha: lerp(DEFAULT_SHADOW_ALPHA, POUNCE_AIR_SHADOW_ALPHA, height),
    eyeShine: Math.max(0.5, 1 - recover),
  };
}

// ── Death poses ──────────────────────────────────────────────────────────────

const DEATH_ROLL_TARGET = Math.PI;
const DEATH_LIMP_DROOP_DEG = 9;
const DEATH_FINAL_TWITCH_DEG = 4;

/**
 * The pose every death converges on: on its back, legs folded tight over the
 * belly. Shared so all three rows end on an identical corpse frame.
 */
function corpsePose(curl: number, roll: number, spin: number, extraDeg = 0): SpiderPose {
  const legs: LegPose[] = [];
  for (let i = 0; i < TOTAL_LEGS; i++) {
    const pair = i % LEG_COUNT_PER_SIDE;
    // Jitter rides on top of the curl so the settling twitch still shows once
    // the legs have fully folded.
    const jitter = extraDeg * (hashRandom(i * 29) - 0.5) * 2;
    legs.push(swingLeg(curlLeg(pair, restLeg(LEGS[pair]), curl), jitter));
  }
  return {
    ...basePose(legs),
    roll,
    spin,
    bodyScale: lerp(1, 0.98, curl),
    fangOpen: lerp(0.35, 0, curl),
    palpSwing: 12 * curl,
    shadowScale: lerp(1, 0.88, curl),
    shadowAlpha: lerp(DEFAULT_SHADOW_ALPHA, 0.78, curl),
  };
}

const CURL_LIMP_END = 0.22;
const CURL_ROLL_START = 0.2;
const CURL_ROLL_END = 0.62;
const CURL_TIGHTEN_START = 0.45;

/** The slow collapse: the legs give out, the body rolls over, the legs fold. */
function deathCurlPose(progress: number): SpiderPose {
  const limp = ramp(progress, 0, CURL_LIMP_END);
  const roll = easeInOut(ramp(progress, CURL_ROLL_START, CURL_ROLL_END)) * DEATH_ROLL_TARGET;
  const curl = easeInOut(ramp(progress, CURL_TIGHTEN_START, 1));
  // One last twitch as the legs settle.
  const twitch = Math.sin(ramp(progress, 0.82, 0.95) * Math.PI) * DEATH_FINAL_TWITCH_DEG;

  const pose = corpsePose(curl, roll, 0, twitch);
  const legs = pose.legs.map((leg) => swingLeg(leg, DEATH_LIMP_DROOP_DEG * limp * (1 - curl)));
  return { ...pose, legs };
}

const SPASM_BEATS: readonly (readonly [number, number])[] = [
  [0.0, 34],
  [0.16, -26],
  [0.3, 22],
  [0.42, -14],
];
const SPASM_ROLL_START = 0.46;
const SPASM_ROLL_END = 0.74;
const SPASM_CURL_START = 0.6;
const SPASM_SPIN_RAD = 0.22;

/** The seizure: rigid legs snap in and out in decaying beats, then it folds. */
function deathSpasmPose(progress: number): SpiderPose {
  let thrash = 0;
  for (const [start, amplitude] of SPASM_BEATS) {
    const beat = ramp(progress, start, start + 0.14);
    thrash += Math.sin(beat * Math.PI) * amplitude;
  }

  const roll = easeInOut(ramp(progress, SPASM_ROLL_START, SPASM_ROLL_END)) * DEATH_ROLL_TARGET;
  const curl = easeInOut(ramp(progress, SPASM_CURL_START, 1));
  const spin = Math.sin(ramp(progress, 0, SPASM_ROLL_END) * Math.PI) * SPASM_SPIN_RAD;

  const pose = corpsePose(curl, roll, spin);
  const legs = pose.legs.map((leg, i) =>
    swingLeg(leg, thrash * (1 - curl) * (i % 2 === 0 ? 1 : -0.7)),
  );
  return { ...pose, legs, bodyScale: pose.bodyScale * (1 + Math.sin(thrash * 0.06) * 0.03) };
}

const FLIP_TUMBLE_END = 0.46;
const FLIP_SPIN_RAD = 1.9;
const FLIP_BOUNCE_START = 0.46;
const FLIP_BOUNCE_END = 0.66;
const FLIP_CURL_START = 0.58;
const FLIP_AIR_SCALE = 1.18;
const FLIP_FLAIL_DEG = 30;

/** Knocked clean off its feet: it tumbles, slams down on its back, and curls. */
function deathFlipPose(progress: number): SpiderPose {
  const tumble = ramp(progress, 0, FLIP_TUMBLE_END);
  const bounce = ramp(progress, FLIP_BOUNCE_START, FLIP_BOUNCE_END);
  const curl = easeInOut(ramp(progress, FLIP_CURL_START, 1));

  // Two rotations of roll settle onto the back; the spin unwinds to zero so the
  // corpse matches the other death rows.
  const roll = Math.min(DEATH_ROLL_TARGET, easeInOut(tumble) * DEATH_ROLL_TARGET);
  const spin = Math.sin(tumble * Math.PI) * FLIP_SPIN_RAD * (1 - curl);

  const airborne = Math.sin(tumble * Math.PI);
  const flail = Math.sin(progress * TWO_PI * 2) * FLIP_FLAIL_DEG * (1 - curl);
  const bounceKick = Math.sin(bounce * Math.PI) * FLIP_FLAIL_DEG * 0.6;

  const pose = corpsePose(curl, roll, spin);
  const legs = pose.legs.map((leg, i) =>
    swingLeg(leg, (flail + bounceKick) * (i % 2 === 0 ? 1 : -1), airborne * 0.6),
  );

  return {
    ...pose,
    legs,
    bodyScale:
      pose.bodyScale *
      lerp(1, FLIP_AIR_SCALE, airborne) *
      lerp(1, 0.93, Math.sin(bounce * Math.PI)),
    shadowScale: lerp(pose.shadowScale, 0.6, airborne),
    shadowAlpha: lerp(pose.shadowAlpha, 0.45, airborne),
  };
}

// ── Sheet assembly ───────────────────────────────────────────────────────────

interface RowSpec {
  readonly name: string;
  readonly frameCount: number;
  readonly pose: (frame: number) => SpiderPose;
}

/** Loops sample the cycle evenly; one-shots sample the middle of each frame. */
function cyclePhase(frame: number, frameCount: number): number {
  return frame / frameCount;
}

function shotProgress(frame: number, frameCount: number): number {
  return (frame + 0.5) / frameCount;
}

const ROWS: readonly RowSpec[] = [
  {
    name: 'walk',
    frameCount: WALK_FRAMES,
    pose: (f) => walkPose(cyclePhase(f, WALK_FRAMES)),
  },
  {
    name: 'idle',
    frameCount: IDLE_FRAMES,
    pose: (f) => idlePose(cyclePhase(f, IDLE_FRAMES)),
  },
  {
    name: 'crouch',
    frameCount: CROUCH_FRAMES,
    pose: (f) => crouchPose(shotProgress(f, CROUCH_FRAMES)),
  },
  {
    name: 'pounce',
    frameCount: POUNCE_FRAMES,
    pose: (f) => pouncePose(shotProgress(f, POUNCE_FRAMES)),
  },
  {
    name: 'death_curl',
    frameCount: DEATH_FRAMES,
    pose: (f) => deathCurlPose(shotProgress(f, DEATH_FRAMES)),
  },
  {
    name: 'death_spasm',
    frameCount: DEATH_FRAMES,
    pose: (f) => deathSpasmPose(shotProgress(f, DEATH_FRAMES)),
  },
  {
    name: 'death_flip',
    frameCount: DEATH_FRAMES,
    pose: (f) => deathFlipPose(shotProgress(f, DEATH_FRAMES)),
  },
];

function renderSheet(): Buffer {
  const cols = Math.max(...ROWS.map((r) => r.frameCount));
  const sheet = createCanvas(cols * FRAME_W, ROWS.length * FRAME_H);
  const sheetCtx = sheet.getContext('2d');

  const frame = createCanvas(FRAME_W * SUPERSAMPLE, FRAME_H * SUPERSAMPLE);
  const frameCtx = frame.getContext('2d');

  for (let row = 0; row < ROWS.length; row++) {
    const spec = ROWS[row];
    for (let col = 0; col < spec.frameCount; col++) {
      frameCtx.clearRect(0, 0, frame.width, frame.height);
      drawSpider(
        frameCtx,
        PIVOT_X * SUPERSAMPLE,
        PIVOT_Y * SUPERSAMPLE,
        TILE_SCALE * SUPERSAMPLE,
        spec.pose(col),
      );
      sheetCtx.drawImage(
        frame,
        0,
        0,
        frame.width,
        frame.height,
        col * FRAME_W,
        row * FRAME_H,
        FRAME_W,
        FRAME_H,
      );
    }
  }

  return sheet.toBuffer('image/png');
}

const outPath = resolve('src/images/enemies/spider.png');

console.log(
  `Generating spider sprite sheet (${FRAME_W}×${FRAME_H}px frames, tileScale=${TILE_SCALE})…`,
);
writeFileSync(outPath, renderSheet());

const cols = Math.max(...ROWS.map((r) => r.frameCount));
console.log(`  → ${outPath}`);
console.log(
  `  → ${cols * FRAME_W}×${ROWS.length * FRAME_H}px  (${ROWS.length} rows × ${cols} cols)`,
);
ROWS.forEach((r, i) => {
  console.log(`     row ${i}: ${r.name} (${r.frameCount} frames)`);
});
console.log(`tileX=${PIVOT_X}  tileY=${PIVOT_Y}  tileScale=${TILE_SCALE}`);
