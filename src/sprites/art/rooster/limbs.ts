/**
 * The rooster's limbs: bird legs below, a man's arms above.
 *
 * The leg is feathered down to the backward-bending ankle and bare yellow
 * scale below it, with a spur on the back of the shank and four toes — three
 * forward, one back — each ending in a dark talon. The arm is a bodybuilder's:
 * a round deltoid cap, a peaked biceps, a thick forearm, covered in short close
 * copper feathers laid along the muscle, a ragged fringe off the back of the
 * upper arm where a wing's flight feathers would be, and a big hand of yellow
 * scaly skin with dark nails.
 */

import { clamp01, deg, lerp, mix, rgba } from '../carlArt';
import { hash1 } from '../ratArt';
import type { Ramp, RoosterBuildSpec } from './builds';
import {
  type Ctx,
  LIGHT,
  appendCapsule,
  appendEllipse,
  appendQuill,
  clipped,
  cylinderGradient,
  fillTrace,
  roundGradient,
  softLine,
  softSpot,
} from './paint';
import {
  type BoneChain,
  type LegChain,
  type Pt,
  VIEWS,
  add,
  angleOf,
  distance,
  mixPt,
  pt,
  yawAcross,
  yawAhead,
  yawFacingSign,
} from './rig';

// ── Shape factors ────────────────────────────────────────────────────────────

const MIDPOINT = 0.5;
const QUILL_STEPS = 6;
const TUFT_STEPS = 4;
const TALON_STEPS = 5;
/** A toe narrows to this share of its root at the tip; the talon springs from just above its end. */
const TOE_TIP_TAPER = 0.7;
const TALON_ROOT_LIFT = 0.3;
const TALON_BEND_AT = 0.4;
const TALON_ROOT_SHARE = 0.85;
/** The shank's scale rings: hairline strokes bowed a little down the leg. */
const SHANK_SCALE_LINE = 0.012;
const SHANK_SCALE_CURVE = 0.02;
/** The spur grows from inside the shank's back edge and droops as it points back. */
const SPUR_ROOT_INSET = 0.6;
const SPUR_DROP_SHARE = 0.4;
const SPUR_DROP = 0.02;
/** Spur horn is the talon's dark with some of the shank's own warmth in it. */
const SPUR_HORN_WARMTH = 0.35;
/** The hock fringe spans past the drumstick's narrow end and starts a little up it. */
const HOCK_FRINGE_SPAN = 2.6;
const HOCK_FRINGE_RISE = 0.06;
const HOCK_FRINGE_HALF = 0.03;
/** Feather tufts vary in length between this share of their own and that plus the variation. */
const TUFT_SHORTEST = 0.7;
const TUFT_VARIATION = 0.6;
const THIGH_TUFT_INSET = 0.7;
const THIGH_TUFT_SEED_STEP = 2.3;
/** Feather rows: three rows of three tips, starting part way down the segment, a touch irregular. */
const FEATHER_ROWS = 3;
const FEATHER_TIPS_PER_ROW = 3;
const FEATHER_ROW_START = 0.7;
const FEATHER_ROW_SPAN = 0.8;
const FEATHER_ROW_SEED_STEP = 7;
const FEATHER_JITTER = 0.03;
/** The arm fringe: tips rooted inside the triceps' edge, flaring back and sweeping toward the elbow. */
const FRINGE_ROOT_INSET = 0.8;
const FRINGE_SHORTEST = 0.75;
const FRINGE_VARIATION = 0.5;
const FRINGE_SEED_STEP = 3.1;
const FRINGE_FLARE = 0.55;
const FRINGE_SWEEP = 0.25;
const FRINGE_HALF = 0.045;
/** Tape stands proud of the wrist it wraps, with one seam between its two turns. */
const TAPE_BULK = 1.12;
const TAPE_SEAM_WIDTH = 1.6;
const TAPE_SEAM_ALPHA = 0.5;
/** A closed fist is shorter than an open hand and wider than its wrist. */
const FIST_LENGTH_SHARE = 0.78;
const OPEN_HAND_HALF_OF_WRIST = 1.25;
const KNUCKLES_AT = 0.72;
const PALM_HEEL_OFFSET = 0.3;
const PALM_HEEL_SHARE = 0.9;
const OPEN_FINGER_LENGTH = 0.42;
const OPEN_FINGER_ROOT = 0.24;
const OPEN_FINGER_TIP = 0.2;
const NAIL_LENGTH = 0.16;
const NAIL_WIDTH = 0.12;
const NAIL_REACH = 0.55;
const FIST_NAIL_LENGTH = 0.2;
const FIST_NAIL_WIDTH = 0.15;
const KNUCKLE_CREASE_WIDTH = 0.18;
const KNUCKLE_CREASE_ALPHA = 0.5;
/** The thumb roots on the fist's side and curls over its front as the hand closes. */
const THUMB_ROOT_OUT = 0.6;
const THUMB_CURL = 0.9;
const THUMB_LENGTH = 0.5;
const THUMB_ROOT_HALF = 0.32;
const THUMB_TIP_HALF = 0.26;
/** The biceps peak sits toward the front of the upper arm; the deltoid is a little flattened. */
const BICEPS_PEAK_FORWARD = 0.45;
const DELTOID_SQUASH = 0.92;
const DELTOID_FEATHERS_FROM = 0.6;
/** Each segment's feathers take their own offset into the seed, so no two segments repeat. */
const SEED_UPPER_ARM = 5;
const SEED_FOREARM = 11;
const SEED_DELTOID = 17;

// ── Legs ─────────────────────────────────────────────────────────────────────

/** The drumstick: thick and feathered where it leaves the body, slim at the ankle. */
const DRUMSTICK_ROOT_HALF = 0.17;
const DRUMSTICK_BELLY_HALF = 0.16;
const DRUMSTICK_BELLY_AT = 0.2;
const DRUMSTICK_HOCK_HALF = 0.055;
/** The bare shank: a slender rod, barely wider at the ankle than at the hock. */
const SHANK_TOP_HALF = 0.055;
const SHANK_BOTTOM_HALF = 0.048;
/** Scale rings across the shank, which is all the texture it can carry at the tile. */
const SHANK_SCALE_RINGS = 4;
const SHANK_SCALE_ALPHA = 0.55;
/** The spur sits low on the back of the shank and points back and down. */
const SPUR_AT = 0.62;
const SPUR_LENGTH = 0.1;
const SPUR_ROOT_HALF = 0.03;
const SPUR_DROOP = deg(28);
/** The feathered fringe that hangs over the top of the shank, a skirt of tips. */
const HOCK_FRINGE_TIPS = 4;
const HOCK_FRINGE_LENGTH = 0.09;

const FOOT_TOE_FORWARD = 0.3;
const FOOT_TOE_SIDE = 0.24;
const FOOT_TOE_BACK = 0.13;
const TOE_HALF = 0.032;
const TALON_LENGTH = 0.05;
/**
 * How far a talon hooks down off its toe. Small: the toe already slopes to the
 * floor, and a talon hooked further digs into it, so a standing bird's feet sit
 * below his own ground line.
 */
const TALON_HOOK = deg(8);
/** Edge-on, how far the side toes fan off the middle one in drawn height. */
const PROFILE_TOE_FAN = 0.02;
/** Head-on a toe pointing at the camera draws at this share of its length. */
const HEAD_ON_TOE_FORESHORTEN = 0.3;
/** Head-on the side toes splay this far across from the middle one. */
const HEAD_ON_TOE_SPLAY = 0.15;
/** A fully curled foot's toes reach this much less far. */
const TOE_CURL_SHORTEN = 0.5;
/** Edge-on, the far toe rides a little above the middle one and the near toe a little below. */
const FAR_TOE_SPLAY = deg(6);
const NEAR_TOE_SPLAY = deg(4);
/** The back toe points back and a little down, and curls less than the forward toes. */
const BACK_TOE_DROOP = deg(20);
const BACK_TOE_CURL_SHARE = 0.6;
/** A fully curled toe has turned this far down from flat. */
const TOE_CURL_TURN = deg(80);
/** A receding limb is the same material in less light. */
const FAR_LIMB_SHADE = 0.32;

function receded(ramp: Ramp, shade: number): Ramp {
  if (shade <= 0) return ramp;
  return {
    deep: ramp.deep,
    dark: mix(ramp.dark, ramp.deep, shade),
    mid: mix(ramp.mid, ramp.dark, shade),
    light: mix(ramp.light, ramp.mid, shade),
    rim: mix(ramp.rim, ramp.light, shade),
  };
}

export type LegFacing = 'forward' | 'camera' | 'away';

/** One toe from the ankle, as a tapered pointed capsule with a talon at its tip. */
function drawToe(
  ctx: Ctx,
  from: Pt,
  direction: number,
  length: number,
  ramp: Ramp,
  talon: string,
): void {
  const tip = add(from, Math.cos(direction) * length, Math.sin(direction) * length);
  fillTrace(
    ctx,
    () => appendCapsule(ctx, from, tip, TOE_HALF, TOE_HALF * TOE_TIP_TAPER),
    cylinderGradient(ctx, from, tip, TOE_HALF, ramp),
  );
  const clawTip = add(
    tip,
    Math.cos(direction + TALON_HOOK) * TALON_LENGTH,
    Math.sin(direction + TALON_HOOK) * TALON_LENGTH,
  );
  ctx.beginPath();
  appendQuill(
    ctx,
    add(tip, 0, -TOE_HALF * TALON_ROOT_LIFT),
    mixPt(tip, clawTip, TALON_BEND_AT),
    clawTip,
    TOE_HALF * TALON_ROOT_SHARE,
    TALON_STEPS,
  );
  ctx.fillStyle = talon;
  ctx.fill();
}

/**
 * The foot. Edge-on it is three long toes forward along the floor and one back;
 * head-on the forward toes come at the camera and draw short, fanned, the back
 * toe hidden behind the shank; from behind the back toe is the one that shows.
 */
function drawFoot(ctx: Ctx, leg: LegChain, facing: LegFacing, ramp: Ramp, talon: string): void {
  const curl = clamp01(leg.curl);
  const curlTurn = curl * TOE_CURL_TURN;
  const ankle = leg.ankle;
  if (facing === 'forward') {
    // Each toe slopes just enough to bring its own tip to the floor, so a
    // short side toe stands steeper than the long middle one; one shared angle
    // leaves the short toes hanging in the air when the ankle is raised.
    const floorBelow = leg.pad.y - ankle.y - TOE_HALF;
    const slopeFor = (length: number): number => Math.asin(clamp01(floorBelow / length));
    const toeTurn = slopeFor(FOOT_TOE_FORWARD) + curlTurn;
    const sideTurn = slopeFor(FOOT_TOE_SIDE) + curlTurn;
    const backTurn = Math.PI - BACK_TOE_DROOP - toeTurn * BACK_TOE_CURL_SHARE;
    const far = receded(ramp, FAR_LIMB_SHADE);
    drawToe(ctx, ankle, sideTurn - FAR_TOE_SPLAY, FOOT_TOE_SIDE, far, talon);
    drawToe(ctx, ankle, backTurn, FOOT_TOE_BACK, receded(ramp, FAR_LIMB_SHADE / 2), talon);
    drawToe(ctx, add(ankle, 0, PROFILE_TOE_FAN / 2), toeTurn, FOOT_TOE_FORWARD, ramp, talon);
    drawToe(
      ctx,
      add(ankle, 0, PROFILE_TOE_FAN),
      sideTurn + NEAR_TOE_SPLAY,
      FOOT_TOE_SIDE,
      ramp,
      talon,
    );
    return;
  }
  // Head-on each toe is laid out on the floor — splayed across, reaching
  // forward — and drawn as the floor is: its forward reach a share of itself
  // in screen height, down toward the camera, up away from it. A toe pointed
  // straight down the screen at its full foreshortening is a peg.
  // His body is turned, so the floor the toes lie on is too: a toe reaching
  // ahead of him runs partly across the picture toward the side he faces.
  const towardCamera = facing === 'camera' ? 1 : -1;
  const view = VIEWS[facing === 'camera' ? 'front' : 'back'];
  const ahead = yawAhead(view) * yawFacingSign(view);
  const across = yawAcross(view);
  const reachShare = 1 - curl * TOE_CURL_SHORTEN;
  const ankleDropToFloor = leg.pad.y - ankle.y;
  const toeOnFloor = (sideways: number, forward: number): { direction: number; length: number } => {
    const x = (sideways * across + forward * ahead) * reachShare;
    const y =
      ankleDropToFloor + towardCamera * forward * across * reachShare * HEAD_ON_TOE_FORESHORTEN;
    return { direction: Math.atan2(y, x), length: Math.hypot(x, y) };
  };
  const forwardToes = [
    toeOnFloor(-HEAD_ON_TOE_SPLAY, FOOT_TOE_SIDE),
    toeOnFloor(HEAD_ON_TOE_SPLAY, FOOT_TOE_SIDE),
    toeOnFloor(0, FOOT_TOE_FORWARD),
  ];
  const backToe = toeOnFloor(0, -FOOT_TOE_BACK);
  const side = receded(ramp, FAR_LIMB_SHADE / 2);
  if (facing === 'camera') {
    drawToe(ctx, ankle, backToe.direction, backToe.length, side, talon);
    forwardToes.forEach((toe, i) =>
      drawToe(
        ctx,
        ankle,
        toe.direction,
        toe.length,
        i === forwardToes.length - 1 ? ramp : side,
        talon,
      ),
    );
    return;
  }
  forwardToes.forEach((toe) => drawToe(ctx, ankle, toe.direction, toe.length, side, talon));
  drawToe(ctx, ankle, backToe.direction, backToe.length, ramp, talon);
}

/** The shank's scale rings: short curved bands, darker on the shaded side. */
function drawShankScales(ctx: Ctx, hock: Pt, ankle: Pt, ramp: Ramp): void {
  const angle = angleOf(hock, ankle);
  const nx = Math.cos(angle + Math.PI / 2);
  const ny = Math.sin(angle + Math.PI / 2);
  ctx.lineWidth = SHANK_SCALE_LINE;
  ctx.lineCap = 'round';
  for (let i = 1; i <= SHANK_SCALE_RINGS; i++) {
    const at = mixPt(hock, ankle, i / (SHANK_SCALE_RINGS + 1));
    ctx.strokeStyle = rgba(ramp.deep, SHANK_SCALE_ALPHA);
    ctx.beginPath();
    ctx.moveTo(at.x - nx * SHANK_TOP_HALF, at.y - ny * SHANK_TOP_HALF);
    ctx.quadraticCurveTo(
      at.x + Math.cos(angle) * SHANK_SCALE_CURVE,
      at.y + Math.sin(angle) * SHANK_SCALE_CURVE,
      at.x + nx * SHANK_TOP_HALF,
      at.y + ny * SHANK_TOP_HALF,
    );
    ctx.stroke();
  }
}

/**
 * The spur: a curved horn off the back of the shank. "Back" is away from the
 * toes edge-on; head-on it points away from the camera and only its root shows.
 */
function drawSpur(
  ctx: Ctx,
  hock: Pt,
  ankle: Pt,
  backward: number,
  ramp: Ramp,
  talon: string,
): void {
  const root = mixPt(hock, ankle, SPUR_AT);
  const base = add(root, Math.cos(backward) * SHANK_TOP_HALF * SPUR_ROOT_INSET, 0);
  const tipAngle = backward + (Math.cos(backward) > 0 ? SPUR_DROOP : -SPUR_DROOP);
  const tip = add(
    base,
    Math.cos(tipAngle) * SPUR_LENGTH,
    Math.sin(tipAngle) * SPUR_LENGTH * SPUR_DROP_SHARE + SPUR_DROP,
  );
  ctx.beginPath();
  appendQuill(ctx, base, mixPt(base, tip, MIDPOINT), tip, SPUR_ROOT_HALF, QUILL_STEPS);
  ctx.fillStyle = mix(talon, ramp.dark, SPUR_HORN_WARMTH);
  ctx.fill();
}

/** Feather tips hanging off the bottom of the drumstick over the shank's top. */
function drawHockFringe(ctx: Ctx, hock: Pt, root: Pt, ramp: Ramp, seed: number): void {
  const down = angleOf(root, hock);
  const across = down + Math.PI / 2;
  for (let i = 0; i < HOCK_FRINGE_TIPS; i++) {
    const t = (i + MIDPOINT) / HOCK_FRINGE_TIPS - MIDPOINT;
    const start = add(
      hock,
      Math.cos(across) * t * DRUMSTICK_HOCK_HALF * HOCK_FRINGE_SPAN -
        Math.cos(down) * HOCK_FRINGE_RISE,
      Math.sin(across) * t * DRUMSTICK_HOCK_HALF * HOCK_FRINGE_SPAN -
        Math.sin(down) * HOCK_FRINGE_RISE,
    );
    const length = HOCK_FRINGE_LENGTH * (TUFT_SHORTEST + hash1(seed + i) * TUFT_VARIATION);
    const tip = add(start, Math.cos(down) * length, Math.sin(down) * length);
    ctx.beginPath();
    appendQuill(ctx, start, mixPt(start, tip, MIDPOINT), tip, HOCK_FRINGE_HALF, TUFT_STEPS);
    ctx.fillStyle = i % 2 === 0 ? ramp.dark : ramp.mid;
    ctx.fill();
  }
}

/**
 * One leg: drumstick, shank, spur and foot. `shade` recedes the far leg in
 * profile; head-on neither leg takes one, because a depth shade on matching
 * limbs reads as two colours rather than as depth.
 */
export function drawLeg(
  ctx: Ctx,
  leg: LegChain,
  facing: LegFacing,
  build: RoosterBuildSpec,
  shade: number,
  seed: number,
): void {
  const feathers = receded(build.palette.fluff, shade);
  const scales = receded(build.palette.scales, shade);
  const talon = build.palette.talon;

  const shankBack = facing === 'forward' ? Math.PI : Math.PI / 2;
  const shankTrace = (): void =>
    appendCapsule(ctx, leg.hock, leg.ankle, SHANK_TOP_HALF, SHANK_BOTTOM_HALF);
  drawFoot(ctx, leg, facing, scales, talon);
  if (facing === 'forward') drawSpur(ctx, leg.hock, leg.ankle, shankBack, scales, talon);
  fillTrace(ctx, shankTrace, cylinderGradient(ctx, leg.hock, leg.ankle, SHANK_TOP_HALF, scales));
  clipped(ctx, shankTrace, () => drawShankScales(ctx, leg.hock, leg.ankle, scales));
  if (facing !== 'forward')
    drawSpur(ctx, leg.hock, leg.ankle, facing === 'away' ? -Math.PI / 2 : shankBack, scales, talon);

  const belly = mixPt(leg.root, leg.hock, DRUMSTICK_BELLY_AT);
  const drumstickTrace = (): void => {
    appendCapsule(ctx, leg.root, belly, DRUMSTICK_ROOT_HALF, DRUMSTICK_BELLY_HALF);
    appendCapsule(ctx, belly, leg.hock, DRUMSTICK_BELLY_HALF, DRUMSTICK_HOCK_HALF);
  };
  fillTrace(
    ctx,
    drumstickTrace,
    cylinderGradient(ctx, leg.root, leg.hock, DRUMSTICK_BELLY_HALF, feathers),
  );
  clipped(ctx, drumstickTrace, () =>
    drawFeatherRows(ctx, leg.root, leg.hock, DRUMSTICK_BELLY_HALF, feathers, seed, FEATHER_ROWS),
  );
  drawHockFringe(ctx, leg.hock, leg.root, feathers, seed);
  drawThighTufts(ctx, leg.root, leg.hock, feathers, seed);
}

/** Feather tips standing off both sides of the drumstick's lower half: a feathered thigh, not a trouser leg. */
const THIGH_TUFTS_PER_SIDE = 3;
const THIGH_TUFT_LENGTH = 0.1;
const THIGH_TUFT_FROM = 0.35;
const THIGH_TUFT_TO = 0.8;
const THIGH_TUFT_FLARE = 0.6;
const THIGH_TUFT_HALF = 0.035;

function drawThighTufts(ctx: Ctx, root: Pt, hock: Pt, ramp: Ramp, seed: number): void {
  const down = angleOf(root, hock);
  for (const side of [-1, 1]) {
    for (let i = 0; i < THIGH_TUFTS_PER_SIDE; i++) {
      const t = lerp(THIGH_TUFT_FROM, THIGH_TUFT_TO, i / (THIGH_TUFTS_PER_SIDE - 1));
      const centre = mixPt(root, hock, t);
      const half = lerp(DRUMSTICK_BELLY_HALF, DRUMSTICK_HOCK_HALF, t);
      const across = down + (side * Math.PI) / 2;
      const start = add(
        centre,
        Math.cos(across) * half * THIGH_TUFT_INSET,
        Math.sin(across) * half * THIGH_TUFT_INSET,
      );
      const heading = down + side * THIGH_TUFT_FLARE;
      const length =
        THIGH_TUFT_LENGTH *
        (TUFT_SHORTEST + hash1(seed + i * THIGH_TUFT_SEED_STEP + side) * TUFT_VARIATION);
      const tip = add(start, Math.cos(heading) * length, Math.sin(heading) * length);
      ctx.beginPath();
      appendQuill(ctx, start, mixPt(start, tip, MIDPOINT), tip, THIGH_TUFT_HALF, TUFT_STEPS);
      ctx.fillStyle = i % 2 === 0 ? ramp.dark : ramp.mid;
      ctx.fill();
    }
  }
}

/**
 * Rows of feather tips laid along a limb, pointing down it: scallops at the
 * scale the tile can carry, alternating a lit tip and a shadowed one so the
 * texture reads as overlapping feathers rather than as stripes.
 */
/** Feather tips are faint marks, not a printed pattern: the muscle under them carries the form. */
const FEATHER_TIP_HALF_SHARE = 0.22;
const FEATHER_LIT_ALPHA = 0.24;
const FEATHER_SHADE_ALPHA = 0.2;

function drawFeatherRows(
  ctx: Ctx,
  from: Pt,
  to: Pt,
  halfWidth: number,
  ramp: Ramp,
  seed: number,
  rows: number,
): void {
  const along = angleOf(from, to);
  const across = along + Math.PI / 2;
  const length = distance(from, to);
  const tipLength = length / (rows + 1);
  for (let row = 0; row < rows; row++) {
    const t = (row + FEATHER_ROW_START) / (rows + MIDPOINT);
    const centre = mixPt(from, to, t);
    const tipsInRow = FEATHER_TIPS_PER_ROW;
    for (let k = 0; k < tipsInRow; k++) {
      const offset =
        ((k + MIDPOINT) / tipsInRow - MIDPOINT) * 2 * halfWidth * FEATHER_ROW_SPAN +
        (hash1(seed + row * FEATHER_ROW_SEED_STEP + k) - MIDPOINT) * FEATHER_JITTER;
      const start = add(centre, Math.cos(across) * offset, Math.sin(across) * offset);
      const tip = add(start, Math.cos(along) * tipLength, Math.sin(along) * tipLength);
      const towardLight = Math.cos(across) * LIGHT.x + Math.sin(across) * LIGHT.y;
      const lit = offset * towardLight > 0;
      ctx.beginPath();
      appendQuill(
        ctx,
        start,
        mixPt(start, tip, MIDPOINT),
        tip,
        halfWidth * FEATHER_TIP_HALF_SHARE,
        TUFT_STEPS,
      );
      ctx.fillStyle = rgba(
        lit ? ramp.light : ramp.deep,
        lit ? FEATHER_LIT_ALPHA : FEATHER_SHADE_ALPHA,
      );
      ctx.fill();
    }
  }
}

// ── Arms ─────────────────────────────────────────────────────────────────────

/** The arm's outline as widths along its two bones, before the build's girth. */
const DELTOID_RADIUS = 0.21;
/** The deltoid's centre sits this share of its radius up and out from the joint. */
const DELTOID_LIFT = 0.35;
const UPPER_ROOT_HALF = 0.165;
const BICEPS_HALF = 0.19;
const BICEPS_AT = 0.45;
/** The biceps' peak: a soft lit swell on the front of the upper arm, longer than it is wide. */
const BICEPS_PEAK_LENGTH = 0.75;
const BICEPS_PEAK_WIDTH = 0.45;
const BICEPS_PEAK_ALPHA = 0.45;
const ELBOW_HALF = 0.11;
const FOREARM_ROOT_HALF = 0.125;
const FOREARM_BELLY_HALF = 0.15;
const FOREARM_BELLY_AT = 0.28;
const WRIST_HALF = 0.08;
/** The feathered fringe off the back of the upper arm: a few long ragged tips. */
const FRINGE_TIPS = 5;
/** From behind, alternate fringe tips splay this far either side of the arm's line. */
const FACING_AWAY_FRINGE_SPLAY = deg(14);
/** From behind, the triceps' flat tendon plate above the elbow, darker than the heads round it. */
const TRICEPS_PLATE_AT = 0.72;
const TRICEPS_PLATE_WIDTH = 0.9;
const TRICEPS_PLATE_LENGTH = 0.5;
const TRICEPS_PLATE_ALPHA = 0.4;
const FRINGE_LENGTH = 0.15;
const FRINGE_FROM = 0.15;
const FRINGE_TO = 0.85;
/** The wrist tape: two wraps of white cloth over the end of the forearm. */
const TAPE_LENGTH = 0.1;
const TAPE_RAMP: Ramp = {
  deep: '#6a6458',
  dark: '#a8a294',
  mid: '#e4dfd2',
  light: '#faf8f0',
  rim: '#ffffff',
};

export interface ArmPaint {
  readonly chain: BoneChain;
  /** Which side of the upper arm is its back, as a unit normal in the picture. */
  readonly backNormal: Pt;
  readonly fist: number;
  readonly shade: number;
  /**
   * The back of the arm is toward the camera, as seen from behind: the triceps
   * and the fringe show across its face and the biceps is out of sight.
   */
  readonly facesAway: boolean;
}

/**
 * The side of the upper arm the triceps and the fringe are on: the outside of
 * the elbow's bend. A straight arm has no bend to read, so it takes `fallback`.
 */
export function upperArmBack(chain: BoneChain, fallback: Pt): Pt {
  const axis = angleOf(chain.root, chain.joint);
  const nx = Math.cos(axis + Math.PI / 2);
  const ny = Math.sin(axis + Math.PI / 2);
  const fore = angleOf(chain.joint, chain.end);
  const bend = Math.cos(fore) * nx + Math.sin(fore) * ny;
  const STRAIGHT = 0.12;
  if (Math.abs(bend) < STRAIGHT) {
    const facing = fallback.x * nx + fallback.y * ny;
    return facing >= 0 ? pt(nx, ny) : pt(-nx, -ny);
  }
  return bend > 0 ? pt(-nx, -ny) : pt(nx, ny);
}

/** The ragged feather fringe along the back of the upper arm, pointing toward the elbow. */
function drawArmFringe(ctx: Ctx, arm: ArmPaint, girth: number, ramp: Ramp, seed: number): void {
  const { chain } = arm;
  // Seen from behind the fringe lies down the middle of the arm's face, its
  // tips splaying a little either way; otherwise it hangs off the arm's back edge.
  const backNormal = arm.facesAway ? pt(0, 0) : arm.backNormal;
  const down = angleOf(chain.root, chain.joint);
  for (let i = 0; i < FRINGE_TIPS; i++) {
    const t = lerp(FRINGE_FROM, FRINGE_TO, i / (FRINGE_TIPS - 1));
    const centre = mixPt(chain.root, chain.joint, t);
    const reach = lerp(UPPER_ROOT_HALF, ELBOW_HALF, t) * girth * FRINGE_ROOT_INSET;
    const start = add(centre, backNormal.x * reach, backNormal.y * reach);
    const length =
      FRINGE_LENGTH *
      girth *
      (FRINGE_SHORTEST + hash1(seed + i * FRINGE_SEED_STEP) * FRINGE_VARIATION);
    const out = FRINGE_FLARE;
    const splay = arm.facesAway ? (i % 2 === 0 ? 1 : -1) * FACING_AWAY_FRINGE_SPLAY : 0;
    const direction = pt(
      Math.cos(down + splay) * (1 - out) + backNormal.x * out,
      Math.sin(down + splay) * (1 - out) + backNormal.y * out,
    );
    const tip = add(start, direction.x * length, direction.y * length);
    const control = add(
      mixPt(start, tip, MIDPOINT),
      Math.cos(down) * length * FRINGE_SWEEP,
      Math.sin(down) * length * FRINGE_SWEEP,
    );
    ctx.beginPath();
    appendQuill(
      ctx,
      add(start, -backNormal.x * reach * MIDPOINT, -backNormal.y * reach * MIDPOINT),
      control,
      tip,
      FRINGE_HALF * girth,
      TALON_STEPS,
    );
    ctx.fillStyle = i % 2 === 0 ? ramp.dark : ramp.mid;
    ctx.fill();
  }
}

function drawTape(ctx: Ctx, chain: BoneChain, girth: number, shade: number): void {
  const length = distance(chain.joint, chain.end);
  const from = mixPt(chain.end, chain.joint, TAPE_LENGTH / length);
  const ramp = receded(TAPE_RAMP, shade);
  const half = WRIST_HALF * girth * TAPE_BULK;
  const trace = (): void => appendCapsule(ctx, from, chain.end, half, half);
  fillTrace(ctx, trace, cylinderGradient(ctx, from, chain.end, half, ramp));
  clipped(ctx, trace, () =>
    softLine(
      ctx,
      mixPt(from, chain.end, MIDPOINT),
      mixPt(from, chain.end, MIDPOINT),
      half * TAPE_SEAM_WIDTH,
      ramp.dark,
      TAPE_SEAM_ALPHA,
    ),
  );
}

/** Hand length against the forearm it ends; a hand is not sized off the head. */
const HAND_LENGTH_SHARE = 0.4;
/** The fist is wider than the wrist by a clear margin, or the arm ends in a stump. */
const FIST_HALF_OF_WRIST = 1.45;
/** A hand takes only part of its forearm's angle; aligned outright it waves as the arm swings. */
const HAND_FOLLOW = 0.3;
const NAIL_COUNT = 4;
/** The middle of a closed fist's painted skin, finger lobes and all, as a share of the hand's length past the wrist. */
const FIST_MIDDLE_SHARE = 0.58;
/** The fingers of a fist span this share of its half-width; the grooves between them run toward the nails. */
const FINGER_SPREAD = 1.7;
/** Where the finger lobes sit past the knuckle line, their size, and the shadow ring round each. */
const FINGER_LOBE_REACH = 0.45;
const FINGER_LOBE_RADIUS = 0.3;
const FINGER_LOBE_RIM = 1.25;
const FINGER_GROOVE_LENGTH = 0.9;
const FINGER_GROOVE_WIDTH = 0.12;
const FINGER_GROOVE_ALPHA = 0.7;

/**
 * The hand: yellow scale skin, dark nails. A fist is a rounded block with a
 * knuckle ridge and a thumb wrapped over it; an open hand is a palm with four
 * short fingers.
 */
function drawHand(ctx: Ctx, arm: ArmPaint, girth: number, build: RoosterBuildSpec): void {
  const { chain } = arm;
  const ramp = receded(build.palette.scales, arm.shade);
  const fist = clamp01(arm.fist);
  const blended = handAngle(chain);
  const length = handLength(chain, fist);
  const half = WRIST_HALF * girth * lerp(OPEN_HAND_HALF_OF_WRIST, FIST_HALF_OF_WRIST, fist);
  const wrist = chain.end;
  const tip = add(wrist, Math.cos(blended) * length, Math.sin(blended) * length);
  const knuckles = mixPt(wrist, tip, KNUCKLES_AT);
  const trace = (): void => {
    appendCapsule(
      ctx,
      add(
        wrist,
        Math.cos(blended) * half * PALM_HEEL_OFFSET,
        Math.sin(blended) * half * PALM_HEEL_OFFSET,
      ),
      knuckles,
      half * PALM_HEEL_SHARE,
      half,
    );
  };
  fillTrace(ctx, trace, cylinderGradient(ctx, wrist, tip, half, ramp));
  const across = blended + Math.PI / 2;
  if (fist < MIDPOINT) {
    for (let i = 0; i < NAIL_COUNT; i++) {
      const offset = ((i + MIDPOINT) / NAIL_COUNT - MIDPOINT) * half * FINGER_SPREAD;
      const base = add(knuckles, Math.cos(across) * offset, Math.sin(across) * offset);
      const fingerTip = add(
        base,
        Math.cos(blended) * length * OPEN_FINGER_LENGTH,
        Math.sin(blended) * length * OPEN_FINGER_LENGTH,
      );
      fillTrace(
        ctx,
        () => appendCapsule(ctx, base, fingerTip, half * OPEN_FINGER_ROOT, half * OPEN_FINGER_TIP),
        ramp.mid,
      );
      fillTrace(
        ctx,
        () => appendEllipse(ctx, fingerTip, half * NAIL_LENGTH, half * NAIL_WIDTH, blended),
        build.palette.talon,
      );
    }
  } else {
    // The curled fingers: four knuckled lobes across the end of the fist, each
    // ringed in shadow, so the fist's outline is bumped by fingers rather than
    // rounded off like a mitt.
    for (let i = 0; i < NAIL_COUNT; i++) {
      const offset = ((i + MIDPOINT) / NAIL_COUNT - MIDPOINT) * half * FINGER_SPREAD;
      const lobe = add(
        knuckles,
        Math.cos(across) * offset + Math.cos(blended) * half * FINGER_LOBE_REACH,
        Math.sin(across) * offset + Math.sin(blended) * half * FINGER_LOBE_REACH,
      );
      const radius = half * FINGER_LOBE_RADIUS;
      fillTrace(
        ctx,
        () => appendEllipse(ctx, lobe, radius * FINGER_LOBE_RIM, radius * FINGER_LOBE_RIM, 0),
        ramp.dark,
      );
      fillTrace(
        ctx,
        () => appendEllipse(ctx, lobe, radius, radius, 0),
        roundGradient(ctx, lobe, radius, ramp),
      );
    }
    clipped(ctx, trace, () => {
      for (let i = 0; i < NAIL_COUNT; i++) {
        const offset = ((i + MIDPOINT) / NAIL_COUNT - MIDPOINT) * half * FINGER_SPREAD;
        const nail = add(
          knuckles,
          Math.cos(across) * offset + Math.cos(blended) * half * NAIL_REACH,
          Math.sin(across) * offset + Math.sin(blended) * half * NAIL_REACH,
        );
        fillTrace(
          ctx,
          () => appendEllipse(ctx, nail, half * FIST_NAIL_LENGTH, half * FIST_NAIL_WIDTH, blended),
          build.palette.talon,
        );
      }
      softLine(
        ctx,
        add(knuckles, -Math.cos(across) * half, -Math.sin(across) * half),
        add(knuckles, Math.cos(across) * half, Math.sin(across) * half),
        half * KNUCKLE_CREASE_WIDTH,
        ramp.deep,
        KNUCKLE_CREASE_ALPHA,
      );
      // The grooves between the curled fingers, so a fist is four fingers and
      // not a mitt.
      for (let i = 1; i < NAIL_COUNT; i++) {
        const offset = (i / NAIL_COUNT - MIDPOINT) * half * FINGER_SPREAD;
        const from = add(knuckles, Math.cos(across) * offset, Math.sin(across) * offset);
        const to = add(
          from,
          Math.cos(blended) * half * FINGER_GROOVE_LENGTH,
          Math.sin(blended) * half * FINGER_GROOVE_LENGTH,
        );
        softLine(ctx, from, to, half * FINGER_GROOVE_WIDTH, ramp.deep, FINGER_GROOVE_ALPHA);
      }
    });
  }
  const thumbRoot = add(
    wrist,
    Math.cos(across) * half * THUMB_ROOT_OUT,
    Math.sin(across) * half * THUMB_ROOT_OUT,
  );
  const thumbTip = add(
    thumbRoot,
    Math.cos(blended + fist * THUMB_CURL) * length * THUMB_LENGTH,
    Math.sin(blended + fist * THUMB_CURL) * length * THUMB_LENGTH,
  );
  fillTrace(
    ctx,
    () => appendCapsule(ctx, thumbRoot, thumbTip, half * THUMB_ROOT_HALF, half * THUMB_TIP_HALF),
    ramp.light,
  );
}

/**
 * One arm, shoulder to hand. The deltoid is painted round over the arm's root
 * so the arm reads as hung from a shoulder rather than poked into the body.
 */
export function drawArm(ctx: Ctx, arm: ArmPaint, build: RoosterBuildSpec, seed: number): void {
  const girth = build.proportions.armGirth;
  const ramp = receded(build.palette.arm, arm.shade);
  const { chain } = arm;
  const bicepsAt = mixPt(chain.root, chain.joint, BICEPS_AT);
  const foreBelly = mixPt(chain.joint, chain.end, FOREARM_BELLY_AT);

  const fringeRamp = receded(build.palette.back, arm.shade);
  if (!arm.facesAway) drawArmFringe(ctx, arm, girth, fringeRamp, seed);

  const foreTrace = (): void => {
    appendCapsule(
      ctx,
      chain.joint,
      foreBelly,
      FOREARM_ROOT_HALF * girth,
      FOREARM_BELLY_HALF * girth,
    );
    appendCapsule(ctx, foreBelly, chain.end, FOREARM_BELLY_HALF * girth, WRIST_HALF * girth);
  };
  fillTrace(
    ctx,
    foreTrace,
    cylinderGradient(ctx, chain.joint, chain.end, FOREARM_BELLY_HALF * girth, ramp),
  );
  clipped(ctx, foreTrace, () =>
    drawFeatherRows(
      ctx,
      chain.joint,
      chain.end,
      FOREARM_BELLY_HALF * girth,
      ramp,
      seed + SEED_FOREARM,
      FEATHER_ROWS,
    ),
  );

  const upperTrace = (): void => {
    appendCapsule(ctx, chain.root, bicepsAt, UPPER_ROOT_HALF * girth, BICEPS_HALF * girth);
    appendCapsule(ctx, bicepsAt, chain.joint, BICEPS_HALF * girth, ELBOW_HALF * girth);
  };
  fillTrace(
    ctx,
    upperTrace,
    cylinderGradient(ctx, chain.root, chain.joint, BICEPS_HALF * girth, ramp),
  );
  clipped(ctx, upperTrace, () => {
    drawFeatherRows(
      ctx,
      chain.root,
      chain.joint,
      BICEPS_HALF * girth,
      ramp,
      seed + SEED_UPPER_ARM,
      FEATHER_ROWS,
    );
    if (arm.facesAway) {
      softSpot(
        ctx,
        mixPt(chain.root, chain.joint, TRICEPS_PLATE_AT),
        ELBOW_HALF * girth * TRICEPS_PLATE_WIDTH,
        BICEPS_HALF * girth * TRICEPS_PLATE_LENGTH,
        angleOf(chain.root, chain.joint) - Math.PI / 2,
        ramp.dark,
        TRICEPS_PLATE_ALPHA,
      );
      return;
    }
    const front = pt(-arm.backNormal.x, -arm.backNormal.y);
    const peak = add(
      bicepsAt,
      front.x * BICEPS_HALF * girth * BICEPS_PEAK_FORWARD,
      front.y * BICEPS_HALF * girth * BICEPS_PEAK_FORWARD,
    );
    softSpot(
      ctx,
      peak,
      BICEPS_HALF * girth * BICEPS_PEAK_LENGTH,
      BICEPS_HALF * girth * BICEPS_PEAK_WIDTH,
      angleOf(chain.root, chain.joint),
      ramp.light,
      BICEPS_PEAK_ALPHA,
    );
  });

  if (arm.facesAway) drawArmFringe(ctx, arm, girth, fringeRamp, seed);

  const deltoidCentre = add(chain.root, 0, -DELTOID_RADIUS * girth * DELTOID_LIFT);
  const deltoidTrace = (): void =>
    appendEllipse(
      ctx,
      deltoidCentre,
      DELTOID_RADIUS * girth,
      DELTOID_RADIUS * girth * DELTOID_SQUASH,
      angleOf(chain.root, chain.joint),
    );
  fillTrace(ctx, deltoidTrace, roundGradient(ctx, deltoidCentre, DELTOID_RADIUS * girth, ramp));
  clipped(ctx, deltoidTrace, () =>
    drawFeatherRows(
      ctx,
      add(deltoidCentre, 0, -DELTOID_RADIUS * girth * DELTOID_FEATHERS_FROM),
      add(deltoidCentre, 0, DELTOID_RADIUS * girth),
      DELTOID_RADIUS * girth,
      ramp,
      seed + SEED_DELTOID,
      2,
    ),
  );

  if (build.kit.wristTape) drawTape(ctx, chain, girth, arm.shade);
  drawHand(ctx, arm, girth, build);
}

/** The direction the fist points, so a held bar can lie across it. */
export function handAngle(chain: BoneChain): number {
  const foreAngle = angleOf(chain.joint, chain.end);
  const armAngle = angleOf(chain.root, chain.end);
  return Math.atan2(
    Math.sin(armAngle) * (1 - HAND_FOLLOW) + Math.sin(foreAngle) * HAND_FOLLOW,
    Math.cos(armAngle) * (1 - HAND_FOLLOW) + Math.cos(foreAngle) * HAND_FOLLOW,
  );
}

/** The hand's length past the wrist; a closing fist draws it shorter. */
function handLength(chain: BoneChain, fist: number): number {
  const armSpan = distance(chain.root, chain.joint) + distance(chain.joint, chain.end);
  return lerp(1, FIST_LENGTH_SHARE, fist) * HAND_LENGTH_SHARE * armSpan * MIDPOINT;
}

const CLOSED_FIST = 1;

/** Where the hand ends, for a held thing's anchor: the middle of the closed fist. */
export function fistCentre(chain: BoneChain): Pt {
  const angle = handAngle(chain);
  const reach = handLength(chain, CLOSED_FIST) * FIST_MIDDLE_SHARE;
  return add(chain.end, Math.cos(angle) * reach, Math.sin(angle) * reach);
}
