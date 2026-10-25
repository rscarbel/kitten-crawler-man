/**
 * The rooster's trunk and plumage: the barrel of the body with its puffed
 * breast, the hackle cape falling from the head over the shoulders, the saddle
 * hanging over the tail's root, the tail fountain, and what he wears on his
 * body — the lifting belt round his middle, a sweatband round his neck.
 */

import { clamp01, deg, lerp, mix, rgba } from '../bipedArt';
import { hash1 } from '../ratArt';
import type { Ramp, RoosterBuildSpec } from './builds';
import {
  type Ctx,
  appendCapsule,
  appendEllipse,
  appendPolygon,
  appendQuill,
  appendSmoothLoop,
  clipped,
  fillTrace,
  quadAt,
  roundGradient,
  softSpot,
} from './paint';
import {
  BODY_DEPTH_RADIUS,
  BODY_HALF_WIDTH,
  BODY_HEIGHT_RADIUS,
  BODY_TILT,
  BREAST_HALF_WIDTH,
  BREAST_RADIUS,
  type Pt,
  type RoosterPose,
  type RoosterSkeleton,
  VIEWS,
  type ViewSpec,
  NECK_VECTOR,
  add,
  angleOf,
  distance,
  mixPt,
  pt,
  rotate,
  yawAhead,
  yawFacingSign,
  yawedHalfWidth,
} from './rig';

const MIDPOINT = 0.5;

// ── Shape factors ────────────────────────────────────────────────────────────

const QUILL_STEPS = 6;
const TUFT_STEPS = 4;
/** Tufts and tips vary in length between this share of their own and that plus the variation. */
const TUFT_SHORTEST = 0.7;
const TUFT_VARIATION = 0.6;
/**
 * Head-on the barrel stands a little shorter than it is in profile: at full
 * height its round bottom hangs down over the thighs between the arms, and
 * that block of plumage under the belt reads as shorts or a kilt.
 */
const HEAD_ON_BODY_STRETCH = 0.9;
/**
 * Head-on the breast is a big round ball, the widest thing under the
 * shoulders: a bird's body seen from the front. Drawn at its profile size it
 * leaves a square torso above two legs, which reads as a man in shorts.
 */
const HEAD_ON_BREAST_GROWTH = 1.2;
/** The belly fluff hangs from this far down the trunk, curving up toward the flanks. */
const FLUFF_SPLAY = 0.03;
const FLUFF_HALF = 0.05;
const FLUFF_SEED_STEP = 5.3;
/** Breast scallops: rows laid over the breast's middle, small arcs open downward. */
const BREAST_FEATHERS_FROM = 0.55;
const BREAST_FEATHERS_SPAN = 1.4;
const SCALLOP_RADIUS = 0.2;
const SCALLOP_FROM = 0.15;
const SCALLOP_TO = 0.85;
const SCALLOP_LIT_ALPHA = 0.45;
const SCALLOP_SHADE_ALPHA = 0.4;
const SCALLOP_LINE = 0.018;
/** Where a battered bird has lost feathers, in body units from the trunk's centre. */
const BALD_PATCHES: readonly Pt[] = [pt(-0.2, -0.06), pt(0.14, 0.2)];
const BALD_PATCH_RADIUS = 0.07;
const BALD_PATCH_VARIATION = 0.03;
const BALD_PATCH_SQUASH = 0.75;
const BALD_PATCH_SEED_STEP = 2.7;
/**
 * A plucked patch is goose-pimpled skin with feather stubs in it and the
 * surrounding feathers lying over its rim. A smooth pink oval with a dark
 * shadow under it reads as a sore, which makes him pitiable rather than scruffy.
 */
const BALD_STUBS = 3;
const BALD_STUB_RADIUS = 0.012;
const BALD_STUB_SPREAD = 0.55;
const BALD_STUB = '#9a7458';
const BALD_RIM_TIPS = 5;
const BALD_RIM_TIP_LENGTH = 0.06;
const BALD_RIM_TIP_HALF = 0.022;
const BALD_RIM_TIP_STEPS = 3;
/** Hackle tips vary in length so the cape's lower edge is ragged rather than a saw. */
const CAPE_TIP_SHORTEST = 0.75;
const CAPE_TIP_VARIATION = 0.5;
const CAPE_TIP_SEED_STEP = 3.3;
const CAPE_TIP_SEED_OFFSET = 0.7;
/** Each hackle strand starts a quarter of the way down from the head and bows a little. */
const STRAND_START = 0.25;
const STRAND_BEND_AT = 0.45;
const STRAND_HALF = 0.035;
const STRAND_ALPHA = 0.45;
/** The cape is lit across its middle, darkening toward its tips and into the shadow under the head. */
const CAPE_SHADE_DEPTH = 0.4;
const CAPE_LIT_STOP = 0.5;
const CAPE_MID_STOP = 0.85;
const CAPE_SHADOW_AT = pt(0.18, 0.1);
const CAPE_SHADOW_RX = 0.18;
const CAPE_SHADOW_RY = 0.28;
const CAPE_SHADOW_ALPHA = 0.4;
/** The hackles over a shoulder: rooted up in the cape, sweeping down across the deltoid's top. */
const SHOULDER_HACKLE_LEAN = 0.04;
const SHOULDER_HACKLE_RISE = 0.3;
const SHOULDER_HACKLE_SHORTEST = 0.8;
const SHOULDER_HACKLE_VARIATION = 0.4;
const SHOULDER_HACKLE_SEED_STEP = 4.1;
const SHOULDER_HACKLE_SWEEP = 0.06;
const SHOULDER_HACKLE_BOW = 0.02;
/** The belt follows part of the trunk's tilt edge-on, so it rides round the barrel rather than across it. */
const BELT_TILT_SHARE = 0.6;
const BELT_LIT_STOP = 0.35;
/** The band is drawn long and clipped to the trunk. */
const BELT_HALF_SPAN = 1.2;
const HEAD_ON_BELT_BOW = 0.07;
const PROFILE_BELT_BOW = 0.05;
const BELT_EDGE_ALPHA = 0.4;
const BELT_STITCH = 0.012;
const BELT_CREASE_ALPHA = 0.6;
const BELT_CREASES = 6;
const BELT_CREASE_STEP = 0.17;
const BELT_CREASE_FROM = 0.3;
const BELT_CREASE_LENGTH = 0.6;
/** Edge-on the buckle sits at the front of the barrel. */
const PROFILE_BUCKLE_FORWARD = 0.5;
const BUCKLE_HALF = 0.075;
const BUCKLE_RISE = 0.62;
const BUCKLE_FACE_HALF = 0.06;
const BUCKLE_HOLE_HALF = 0.03;
/** The sweatband sits a third of the way up the neck, round it, with a stripe and frayed threads. */
const SWEATBAND_AT = 0.42;
const SWEATBAND_PROFILE_HALF = 0.17;
const SWEATBAND_HEAD_ON_HALF = 0.19;
const SWEATBAND_HALF_HEIGHT = 0.05;
const SWEATBAND_PROFILE_TILT = -0.35;
const SWEATBAND_ROLL = 1.4;
const SWEATBAND_FRAYS = 4;
const SWEATBAND_FRAY_SPAN = 1.6;
const SWEATBAND_FRAY_DROP = 1.2;
const SWEATBAND_FRAY_BEND = pt(0.01, 0.02);
const SWEATBAND_FRAY_SPLAY = 0.012;
const SWEATBAND_FRAY_LENGTH = 0.05;
const SWEATBAND_FRAY_HALF = 0.012;
const SWEATBAND_FRAY_STEPS = 3;
/** A sickle and its sheen: the green runs along its upper edge, the glint along its crest's first half. */
const SICKLE_STEPS = 12;
/** A sickle is a broad blade that narrows to its point only near the end. */
const SICKLE_TAPER = 0.4;
const SHEEN_ROOT_LIFT = 0.3;
const SHEEN_ARCH_LIFT = 0.5;
const SHEEN_WIDTH = 0.6;
const GLINT_ROOT_LIFT = 0.2;
const GLINT_ARCH_LIFT = 0.25;
const GLINT_WIDTH = 0.16;
const GLINT_STEPS = 8;
/** Edge-on the fan pitches with half the trunk's lean and a quarter of its own swing. */
const TAIL_FOLLOWS_LEAN = 0.5;
const TAIL_SWING_TURN = 0.25;
/** The sickles root one above another, and arch from a point part way back. */
const SICKLE_ROOT_STACK = 0.02;
const SNAPPED_VARIATION = 0.15;
/** Points sampled along each arc the fountain's dark body is filled between. */
const FOUNTAIN_SAMPLES = 12;
/** A short tail's sickles keep most of their girth: thinned with their length they vanish at the tile. */
const SICKLE_GIRTH_FLOOR = 0.3;

// ── Trunk ────────────────────────────────────────────────────────────────────

/** A full puff swells the breast by this share of its radius. */
const PUFF_SWELL = 0.22;
/** The belly's fluff: soft feather tips along the underside, between the drumsticks. */
const FLUFF_TIPS = 15;
/** The stretch of the underside the fluff runs along, as angles round the egg (down is a quarter turn). */
const FLUFF_ARC_FROM = deg(15);
const FLUFF_ARC_TO = deg(165);
/** Where along the egg's radius each tip roots, and how much it hangs down past pointing straight out. */
const FLUFF_ROOT = 0.9;
const FLUFF_DROOP = 0.6;
/**
 * In profile the fluff is short: the whole underside edge-on in long even tips
 * is a sawtooth hem, a tutu under a round shield.
 */
const PROFILE_FLUFF_SHARE = 0.45;
const FLUFF_LENGTH = 0.14;
/** Rows of breast feathers head-on, each a run of scallops. */
const BREAST_ROWS = 4;
const BREAST_TIPS_PER_ROW = 5;

/** The trunk's two masses, traced as one union so they clip and fill together. */
function traceTrunk(
  ctx: Ctx,
  skeleton: RoosterSkeleton,
  pose: RoosterPose,
  build: RoosterBuildSpec,
): void {
  const girth = build.proportions.bodyGirth;
  const spec = VIEWS[skeleton.view];
  const swell = 1 + pose.chestPuff * PUFF_SWELL;
  if (spec.profile) {
    appendEllipse(
      ctx,
      skeleton.bodyCentre,
      BODY_DEPTH_RADIUS * girth * PROFILE_BODY_LENGTH,
      BODY_HEIGHT_RADIUS * girth * PROFILE_BODY_DEPTH,
      BODY_TILT + PROFILE_BACK_RISE + skeleton.bodyAngle,
    );
    appendBreast(ctx, skeleton, spec, girth, swell);
    return;
  }
  appendEllipse(
    ctx,
    skeleton.bodyCentre,
    yawedHalfWidth(spec, BODY_DEPTH_RADIUS, BODY_HALF_WIDTH) * girth,
    BODY_HEIGHT_RADIUS * girth * HEAD_ON_BODY_STRETCH,
    skeleton.bodyAngle + headOnTilt(spec),
  );
  appendBreast(ctx, skeleton, spec, girth, swell);
}

/**
 * In profile the breast is an egg standing on end and leaning forward, its
 * top pushed out ahead of the shoulders: a round breast in profile is a disc,
 * a shield strapped to his front.
 */
const PROFILE_BREAST_DEPTH = 0.92;
/**
 * In profile the egg lies a little flatter than its own nose-up tilt: tipped
 * further, its front end rises beside the neck as a hump over the breast and
 * the trunk's outline closes into a disc behind the arm.
 */
const PROFILE_BACK_RISE = deg(8);
/**
 * In profile the trunk is a long egg, not a ball: as round as it is tall it
 * reads as a disc.
 */
const PROFILE_BODY_LENGTH = 1.12;
const PROFILE_BODY_DEPTH = 0.9;
const PROFILE_BREAST_HEIGHT = 1.18;
/**
 * In profile the breast runs up into the neck as one teardrop, from a
 * neck-wide root to the breast's full depth: a breast with a round top of its
 * own is a disc behind the arm, a round shield.
 */
const PROFILE_NECK_ROOT_HALF = 0.13;
const PROFILE_BREAST_LEAN = deg(28);
/**
 * Head-on a chest puff swells the breast's height in full but its width only
 * this share as much: swollen both ways, a puffed breast with the arms raised
 * clear of it is a beach ball wider than his shoulders.
 */
const HEAD_ON_PUFF_WIDTH_SHARE = 0.35;

function appendBreast(
  ctx: Ctx,
  skeleton: RoosterSkeleton,
  spec: ViewSpec,
  girth: number,
  swell: number,
): void {
  const radius = BREAST_RADIUS * girth * swell;
  if (spec.profile) {
    appendCapsule(
      ctx,
      skeleton.neckBase,
      skeleton.breastCentre,
      PROFILE_NECK_ROOT_HALF * girth,
      radius * PROFILE_BREAST_DEPTH,
    );
    appendEllipse(
      ctx,
      skeleton.breastCentre,
      radius * PROFILE_BREAST_DEPTH,
      radius * PROFILE_BREAST_HEIGHT,
      skeleton.bodyAngle + PROFILE_BREAST_LEAN,
    );
    return;
  }
  appendEllipse(
    ctx,
    skeleton.breastCentre,
    headOnBreastHalf(spec, girth, swell),
    radius * HEAD_ON_BREAST_GROWTH,
    skeleton.bodyAngle,
  );
}

/** Head-on, the egg's nose-up tilt as much of it as shows once he is turned. */
function headOnTilt(spec: ViewSpec): number {
  return BODY_TILT * yawAhead(spec) * yawFacingSign(spec);
}

function headOnBreastHalf(spec: ViewSpec, girth: number, swell: number): number {
  const widthSwell = 1 + (swell - 1) * HEAD_ON_PUFF_WIDTH_SHARE;
  return (
    yawedHalfWidth(spec, BREAST_RADIUS, BREAST_HALF_WIDTH) *
    girth *
    widthSwell *
    HEAD_ON_BREAST_GROWTH
  );
}

/**
 * The belly's fluff: soft tips standing off the round underside all the way
 * along its curve. Gathered in a row across the middle, between the legs, they
 * are a garment's hem — shorts, or a fringed kilt under the belt; following
 * the curve they keep the bottom of the body round.
 */
function drawBellyFluff(
  ctx: Ctx,
  skeleton: RoosterSkeleton,
  ramp: Ramp,
  halfWidth: number,
  halfHeight: number,
  tilt: number,
  lengthShare: number,
): void {
  for (let i = 0; i < FLUFF_TIPS; i++) {
    const angle = lerp(FLUFF_ARC_FROM, FLUFF_ARC_TO, i / (FLUFF_TIPS - 1));
    const onEgg = rotate(
      pt(Math.cos(angle) * halfWidth * FLUFF_ROOT, Math.sin(angle) * halfHeight * FLUFF_ROOT),
      tilt,
    );
    const out = rotate(pt(Math.cos(angle), Math.sin(angle) + FLUFF_DROOP), tilt);
    const start = add(skeleton.bodyCentre, onEgg.x, onEgg.y);
    const length =
      FLUFF_LENGTH *
      lengthShare *
      (TUFT_SHORTEST + hash1(i * FLUFF_SEED_STEP + 1) * TUFT_VARIATION);
    const tip = add(start, out.x * length, out.y * length);
    ctx.beginPath();
    appendQuill(ctx, start, mixPt(start, tip, MIDPOINT), tip, FLUFF_HALF, TUFT_STEPS);
    ctx.fillStyle = i % 2 === 0 ? ramp.mid : ramp.light;
    ctx.fill();
  }
}

/**
 * Feather tips breaking the breast's front and underside edge-on, laid under
 * the breast so only their points stand proud: a clean round breast reads as a
 * shield strapped to him rather than as puffed feathers.
 */
const BREAST_EDGE_TIPS = 7;
const BREAST_EDGE_FROM = deg(-35);
const BREAST_EDGE_TO = deg(115);
const BREAST_EDGE_ROOT = 0.85;
const BREAST_EDGE_LENGTH = 0.11;
const BREAST_EDGE_HALF = 0.05;
const BREAST_EDGE_SEED_STEP = 1.7;

function drawBreastEdge(ctx: Ctx, skeleton: RoosterSkeleton, radius: number, ramp: Ramp): void {
  const rx = radius * PROFILE_BREAST_DEPTH;
  const ry = radius * PROFILE_BREAST_HEIGHT;
  const lean = skeleton.bodyAngle + PROFILE_BREAST_LEAN;
  for (let i = 0; i < BREAST_EDGE_TIPS; i++) {
    const angle = lerp(BREAST_EDGE_FROM, BREAST_EDGE_TO, i / (BREAST_EDGE_TIPS - 1));
    const onEgg = rotate(pt(Math.cos(angle) * rx, Math.sin(angle) * ry), lean);
    const out = rotate(pt(Math.cos(angle), Math.sin(angle)), lean);
    const root = add(skeleton.breastCentre, onEgg.x * BREAST_EDGE_ROOT, onEgg.y * BREAST_EDGE_ROOT);
    const reach = Math.hypot(onEgg.x, onEgg.y);
    const length =
      reach * (1 - BREAST_EDGE_ROOT) +
      BREAST_EDGE_LENGTH * (TUFT_SHORTEST + hash1(i * BREAST_EDGE_SEED_STEP) * TUFT_VARIATION);
    const tip = add(root, out.x * length, (out.y + MIDPOINT) * length);
    ctx.beginPath();
    appendQuill(ctx, root, mixPt(root, tip, MIDPOINT), tip, BREAST_EDGE_HALF, TUFT_STEPS);
    ctx.fillStyle = i % 2 === 0 ? ramp.mid : ramp.dark;
    ctx.fill();
  }
}

/** Scallops of breast feathers, lit on the light side, laid in rows down the breast. */
function drawBreastFeathers(
  ctx: Ctx,
  centre: Pt,
  halfWidth: number,
  height: number,
  ramp: Ramp,
): void {
  for (let row = 0; row < BREAST_ROWS; row++) {
    const y =
      centre.y -
      height * BREAST_FEATHERS_FROM +
      (row + MIDPOINT) * ((height * BREAST_FEATHERS_SPAN) / BREAST_ROWS);
    const rowShift = row % 2 === 0 ? 0 : MIDPOINT;
    for (let k = 0; k < BREAST_TIPS_PER_ROW; k++) {
      const x =
        centre.x + ((k + rowShift + MIDPOINT) / BREAST_TIPS_PER_ROW - MIDPOINT) * 2 * halfWidth;
      const lit = x < centre.x;
      ctx.beginPath();
      ctx.arc(x, y, halfWidth * SCALLOP_RADIUS, SCALLOP_FROM * Math.PI, SCALLOP_TO * Math.PI);
      ctx.strokeStyle = rgba(
        lit ? ramp.light : ramp.deep,
        lit ? SCALLOP_LIT_ALPHA : SCALLOP_SHADE_ALPHA,
      );
      ctx.lineWidth = SCALLOP_LINE;
      ctx.stroke();
    }
  }
}

/** Bare skin through the feathers, for a bird that has lost some in fights. */
function drawBaldPatches(ctx: Ctx, skeleton: RoosterSkeleton, build: RoosterBuildSpec): void {
  if (!build.plumage.baldPatches) return;
  const patches = BALD_PATCHES;
  for (const [i, offset] of patches.entries()) {
    const at = add(skeleton.bodyCentre, offset.x, offset.y);
    const r = BALD_PATCH_RADIUS + hash1(i * BALD_PATCH_SEED_STEP) * BALD_PATCH_VARIATION;
    fillTrace(
      ctx,
      () => appendEllipse(ctx, at, r, r * BALD_PATCH_SQUASH, hash1(i) * Math.PI),
      build.palette.bareSkin,
    );
    ctx.fillStyle = BALD_STUB;
    for (let k = 0; k < BALD_STUBS; k++) {
      const turn = (k / BALD_STUBS + hash1(i + k)) * Math.PI * 2;
      ctx.beginPath();
      ctx.arc(
        at.x + Math.cos(turn) * r * BALD_STUB_SPREAD,
        at.y + Math.sin(turn) * r * BALD_STUB_SPREAD * BALD_PATCH_SQUASH,
        BALD_STUB_RADIUS,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    // The upper rim's feathers hang down over the bare skin.
    ctx.fillStyle = build.palette.chest.mid;
    for (let k = 0; k < BALD_RIM_TIPS; k++) {
      const across = (k / (BALD_RIM_TIPS - 1) - MIDPOINT) * 2 * r;
      const root = add(at, across, -r * BALD_PATCH_SQUASH);
      ctx.beginPath();
      appendQuill(
        ctx,
        root,
        add(root, 0, BALD_RIM_TIP_LENGTH * MIDPOINT),
        add(
          root,
          across * MIDPOINT * MIDPOINT,
          BALD_RIM_TIP_LENGTH * (1 + hash1(i * BALD_RIM_TIPS + k)),
        ),
        BALD_RIM_TIP_HALF,
        BALD_RIM_TIP_STEPS,
      );
      ctx.fill();
    }
  }
}

/** The trunk: back plumage, the breast over it, the belly fluff under. */
export function drawTrunk(
  ctx: Ctx,
  skeleton: RoosterSkeleton,
  pose: RoosterPose,
  build: RoosterBuildSpec,
): void {
  const spec = VIEWS[skeleton.view];
  const girth = build.proportions.bodyGirth;
  const { palette } = build;
  const bodyRadius =
    (spec.profile
      ? BODY_DEPTH_RADIUS * PROFILE_BODY_LENGTH
      : yawedHalfWidth(spec, BODY_DEPTH_RADIUS, BODY_HALF_WIDTH)) * girth;
  drawBellyFluff(
    ctx,
    skeleton,
    palette.fluff,
    bodyRadius,
    BODY_HEIGHT_RADIUS * girth * (spec.profile ? PROFILE_BODY_DEPTH : HEAD_ON_BODY_STRETCH),
    spec.profile
      ? BODY_TILT + PROFILE_BACK_RISE + skeleton.bodyAngle
      : skeleton.bodyAngle + headOnTilt(spec),
    spec.profile ? PROFILE_FLUFF_SHARE : 1,
  );
  fillTrace(
    ctx,
    () => traceTrunk(ctx, skeleton, pose, build),
    roundGradient(ctx, skeleton.bodyCentre, bodyRadius, palette.back),
  );
  const swell = 1 + pose.chestPuff * PUFF_SWELL;
  const breastHalf = spec.profile
    ? BREAST_RADIUS * girth * swell
    : headOnBreastHalf(spec, girth, swell);
  if (spec.showsFace) {
    const breastTrace = (): void => appendBreast(ctx, skeleton, spec, girth, swell);
    if (spec.profile) drawBreastEdge(ctx, skeleton, breastHalf, palette.chest);
    fillTrace(
      ctx,
      breastTrace,
      roundGradient(ctx, skeleton.breastCentre, breastHalf, palette.chest),
    );
    clipped(ctx, breastTrace, () =>
      drawBreastFeathers(
        ctx,
        skeleton.breastCentre,
        breastHalf,
        BREAST_RADIUS * girth * swell,
        palette.chest,
      ),
    );
  }
  clipped(
    ctx,
    () => traceTrunk(ctx, skeleton, pose, build),
    () => {
      drawUndersideFluff(ctx, skeleton, girth, palette.fluff);
      drawBaldPatches(ctx, skeleton, build);
    },
  );
}

/** Where the underside's fluff starts to show, as a share of the body's half height below its centre. */
const UNDERSIDE_FROM = 0.15;
const UNDERSIDE_ALPHA = 0.9;

/**
 * The underside lightens into the thighs' fluff by degrees. A dark breast that
 * stops at a hard edge above lighter thighs is a garment's hem; one value
 * running from the belt down through the thighs is a pair of shorts.
 */
function drawUndersideFluff(ctx: Ctx, skeleton: RoosterSkeleton, girth: number, ramp: Ramp): void {
  const halfHeight = BODY_HEIGHT_RADIUS * girth;
  const top = add(skeleton.bodyCentre, 0, halfHeight * UNDERSIDE_FROM);
  const bottom = add(skeleton.bodyCentre, 0, halfHeight);
  const gradient = ctx.createLinearGradient(top.x, top.y, bottom.x, bottom.y);
  gradient.addColorStop(0, rgba(ramp.mid, 0));
  gradient.addColorStop(1, rgba(ramp.mid, UNDERSIDE_ALPHA));
  ctx.fillStyle = gradient;
  ctx.fillRect(
    skeleton.bodyCentre.x - halfHeight * 2,
    top.y,
    halfHeight * 4,
    bottom.y - top.y + halfHeight,
  );
  drawUndersideTips(ctx, skeleton, halfHeight, ramp);
}

/**
 * Rows of soft feather tips over the underside, each a lit tip over a dark
 * gap. A smooth wash below the belt is cloth at the tile; broken into tips it
 * is plumage.
 */
const UNDERSIDE_TIP_ROWS = 3;
const UNDERSIDE_TIPS_PER_ROW = 6;
const UNDERSIDE_ROWS_FROM = 0.2;
const UNDERSIDE_ROW_STEP = 0.24;
const UNDERSIDE_TIP_SPAN = 0.95;
const UNDERSIDE_TIP_LENGTH = 0.13;
const UNDERSIDE_TIP_HALF = 0.05;
const UNDERSIDE_GAP_DROP = 0.03;
const UNDERSIDE_TIP_SEED_STEP = 3.7;
/**
 * Each tip strays from its grid place by up to this share of the spacing, and
 * its shadow is soft: laid on an even grid with hard shadows, the rows read
 * as scales.
 */
const UNDERSIDE_JITTER = 0.5;
const UNDERSIDE_GAP_ALPHA = 0.45;

function drawUndersideTips(
  ctx: Ctx,
  skeleton: RoosterSkeleton,
  halfHeight: number,
  ramp: Ramp,
): void {
  for (let row = 0; row < UNDERSIDE_TIP_ROWS; row++) {
    const y = skeleton.bodyCentre.y + halfHeight * (UNDERSIDE_ROWS_FROM + row * UNDERSIDE_ROW_STEP);
    const shift = row % 2 === 0 ? 0 : MIDPOINT;
    for (let k = 0; k < UNDERSIDE_TIPS_PER_ROW; k++) {
      const across = ((k + shift) / (UNDERSIDE_TIPS_PER_ROW - 1) - MIDPOINT) * 2;
      const seed = hash1((row * UNDERSIDE_TIPS_PER_ROW + k) * UNDERSIDE_TIP_SEED_STEP);
      const jitter = hash1(seed * UNDERSIDE_TIP_SEED_STEP) - MIDPOINT;
      const x =
        skeleton.bodyCentre.x +
        (across + jitter * UNDERSIDE_JITTER) * halfHeight * UNDERSIDE_TIP_SPAN;
      const length = UNDERSIDE_TIP_LENGTH * (TUFT_SHORTEST + seed * TUFT_VARIATION);
      const root = pt(x, y + jitter * UNDERSIDE_JITTER * UNDERSIDE_ROW_STEP * halfHeight);
      const tip = add(root, across * FLUFF_SPLAY, length);
      ctx.beginPath();
      appendQuill(
        ctx,
        add(root, 0, UNDERSIDE_GAP_DROP),
        mixPt(root, tip, MIDPOINT),
        add(tip, 0, UNDERSIDE_GAP_DROP),
        UNDERSIDE_TIP_HALF,
        TUFT_STEPS,
      );
      ctx.fillStyle = rgba(ramp.deep, UNDERSIDE_GAP_ALPHA);
      ctx.fill();
      ctx.beginPath();
      appendQuill(ctx, root, mixPt(root, tip, MIDPOINT), tip, UNDERSIDE_TIP_HALF, TUFT_STEPS);
      ctx.fillStyle = (row + k) % 2 === 0 ? ramp.light : ramp.mid;
      ctx.fill();
    }
  }
}

// ── Hackle cape and saddle ───────────────────────────────────────────────────

/** How far each pointed hackle tip hangs past the edge it grows from. */
const CAPE_TIP_DEPTH = 0.15;
/**
 * Head-on the cape is a collar of hackles, not a bib: it flares only part way
 * across the barrel and dips a little down the breast, so the puffed breast
 * shows under it and the arms' roots stand clear beside it.
 */
const HEAD_ON_CAPE_FLARE = 0.62;
const HEAD_ON_CAPE_DIP = 0.22;
const AWAY_CAPE_DIP = 0.26;
/** Raised hackles stand this much further off the neck at full lift. */
const HACKLE_LIFT_GROWTH = 0.3;

interface CapeShape {
  /** The whole outline, neck to tips and back. */
  readonly outline: readonly Pt[];
  /** The hackle tips along the lower edge, each the end of one strand. */
  readonly tips: readonly Pt[];
  /** Where every strand starts: just under the head. */
  readonly top: Pt;
}

/**
 * Pointed tips hung off an edge: between each pair of edge points a feather
 * tip pushed out along `drape`, so the lower edge of the cape is a row of
 * points rather than a cut line.
 */
function tippedEdge(
  edge: readonly Pt[],
  drape: (at: Pt) => Pt,
  depth: number,
): { edge: Pt[]; tips: Pt[] } {
  const out: Pt[] = [];
  const tips: Pt[] = [];
  for (let i = 0; i < edge.length - 1; i++) {
    out.push(edge[i]);
    const mid = mixPt(edge[i], edge[i + 1], MIDPOINT);
    const direction = drape(mid);
    const reach =
      depth *
      (CAPE_TIP_SHORTEST +
        hash1(i * CAPE_TIP_SEED_STEP + CAPE_TIP_SEED_OFFSET) * CAPE_TIP_VARIATION);
    const tip = add(mid, direction.x * reach, direction.y * reach);
    out.push(tip);
    tips.push(tip);
  }
  out.push(edge[edge.length - 1]);
  return { edge: out, tips };
}

function unit(from: Pt, to: Pt): Pt {
  const length = Math.hypot(to.x - from.x, to.y - from.y) || 1;
  return pt((to.x - from.x) / length, (to.y - from.y) / length);
}

/**
 * The hackle cape. A neck of hackle feathers, narrow under the head, that
 * flares over the shoulders into a cape of long pointed feathers: edge-on it
 * runs down the front of the neck to the breast and sweeps back over the
 * shoulder to the top of the back; head-on it flares past the neck either side
 * over the arms' roots and dips in a point down the breast.
 */
/** Where the hackles start: just under the head. */
const CAPE_TOP_DROP = 0.06;
/** Edge-on the cape's front edge: under the beak, down the front of the neck, onto the breast. */
const PROFILE_CAPE_THROAT = pt(0.09, 0.1);
const PROFILE_CAPE_NECK_FRONT = pt(0.12, 0);
const PROFILE_CAPE_NECK_FRONT_AT = 0.55;
const PROFILE_CAPE_BREAST = pt(0.24, 0.1);
/** Edge-on the cape's lower edge, from the breast back over the shoulder, against the neck's base. */
const PROFILE_CAPE_LOWER: readonly Pt[] = [
  pt(0.22, 0.06),
  pt(0.14, 0.2),
  pt(-0.02, 0.26),
  pt(-0.2, 0.24),
  pt(-0.34, 0.14),
  pt(-0.38, 0.02),
];
/** Edge-on the cape's back edge, from the top of the back up the nape. */
const PROFILE_CAPE_BACK = pt(-0.3, -0.08);
const PROFILE_CAPE_NAPE = pt(-0.15, 0);
const PROFILE_CAPE_NAPE_AT = 0.5;
const PROFILE_CAPE_SKULL = pt(-0.13, 0.03);
/** The point the hackles hang from, behind and above the neck's base: their tips point away from it. */
const PROFILE_CAPE_DRAPE_FROM = pt(-0.05, -0.1);
const HEAD_ON_CAPE_DRAPE_FROM = pt(0, -0.25);
/** Head-on the lower edge is laid along this many steps and sits this far under the neck's base. */
const HEAD_ON_CAPE_STEPS = 6;
const HEAD_ON_CAPE_DROP = 0.1;
/** Head-on the hackled neck: its half-width under the head, swelling to here part way down. */
const HEAD_ON_NECK_HALF = 0.13;
const HEAD_ON_NECK_UNDER_HEAD = 0.08;
const HEAD_ON_NECK_SWELL = 1.3;
const HEAD_ON_NECK_SWELL_AT = 0.6;
/** Head-on the neck meets the shoulders this share of the way out to the cape's flare. */
const HEAD_ON_CAPE_SHOULDER_SHARE = 0.75;

/**
 * The hackle cape. A neck of hackle feathers, narrow under the head, that
 * flares over the shoulders into a cape of long pointed feathers: edge-on it
 * runs down the front of the neck to the breast and sweeps back over the
 * shoulder to the top of the back; head-on it flares past the neck either side
 * over the arms' roots and dips in a point down the breast.
 */
function capeShape(skeleton: RoosterSkeleton, pose: RoosterPose, girth: number): CapeShape {
  const spec = VIEWS[skeleton.view];
  const head = skeleton.headCentre;
  const base = skeleton.neckBase;
  const lift = 1 + pose.hackleLift * HACKLE_LIFT_GROWTH;
  const top = add(head, 0, CAPE_TOP_DROP);
  if (spec.profile) {
    const at = (p: Pt): Pt => add(base, p.x * lift * girth, p.y * lift);
    // The neck's thickness is written for a neck standing up; it turns with
    // the neck, or a neck stretched out level in a peck pinches to nothing.
    const neckTurn = angleOf(base, head) - Math.atan2(NECK_VECTOR.y, NECK_VECTOR.x);
    const acrossNeck = (from: Pt, offset: Pt): Pt => {
      const turned = rotate(offset, neckTurn);
      return add(from, turned.x, turned.y);
    };
    const front = [
      add(head, PROFILE_CAPE_THROAT.x, PROFILE_CAPE_THROAT.y),
      acrossNeck(mixPt(head, base, PROFILE_CAPE_NECK_FRONT_AT), PROFILE_CAPE_NECK_FRONT),
      at(PROFILE_CAPE_BREAST),
    ];
    const back = [
      at(PROFILE_CAPE_BACK),
      acrossNeck(mixPt(head, base, PROFILE_CAPE_NAPE_AT), PROFILE_CAPE_NAPE),
      add(head, PROFILE_CAPE_SKULL.x, PROFILE_CAPE_SKULL.y),
    ];
    const drapeFrom = add(base, PROFILE_CAPE_DRAPE_FROM.x, PROFILE_CAPE_DRAPE_FROM.y);
    const hang = tippedEdge(
      PROFILE_CAPE_LOWER.map(at),
      (mid) => unit(drapeFrom, mid),
      CAPE_TIP_DEPTH,
    );
    return { outline: [...front, ...hang.edge.slice(1), ...back], tips: hang.tips, top };
  }
  const flare = BODY_HALF_WIDTH * HEAD_ON_CAPE_FLARE * girth * lift;
  const dip = spec.showsFace ? HEAD_ON_CAPE_DIP : AWAY_CAPE_DIP;
  const lower = Array.from({ length: HEAD_ON_CAPE_STEPS + 1 }, (_unused, i) => {
    const t = i / HEAD_ON_CAPE_STEPS;
    return add(
      base,
      lerp(-flare, flare, t),
      HEAD_ON_CAPE_DROP + Math.sin(t * Math.PI) * dip * MIDPOINT,
    );
  });
  const drapeFrom = add(base, HEAD_ON_CAPE_DRAPE_FROM.x, HEAD_ON_CAPE_DRAPE_FROM.y);
  const hang = tippedEdge(lower, (mid) => unit(drapeFrom, mid), CAPE_TIP_DEPTH);
  const neckSide = (side: number): Pt[] => [
    add(head, side * HEAD_ON_NECK_HALF, HEAD_ON_NECK_UNDER_HEAD),
    add(mixPt(head, base, HEAD_ON_NECK_SWELL_AT), side * HEAD_ON_NECK_HALF * HEAD_ON_NECK_SWELL, 0),
    add(base, side * flare * HEAD_ON_CAPE_SHOULDER_SHARE, 0),
  ];
  return {
    outline: [...neckSide(-1), ...hang.edge, ...neckSide(1).reverse()],
    tips: hang.tips,
    top,
  };
}

/** Long glossy strands from under the head to each hackle tip, alternating lit and shadowed. */
function drawCapeStrands(ctx: Ctx, cape: CapeShape, ramp: Ramp): void {
  cape.tips.forEach((tip, i) => {
    const start = mixPt(cape.top, tip, STRAND_START);
    ctx.beginPath();
    appendQuill(ctx, tip, mixPt(start, tip, STRAND_BEND_AT), start, STRAND_HALF, QUILL_STEPS);
    ctx.fillStyle = rgba(i % 2 === 0 ? ramp.rim : ramp.dark, STRAND_ALPHA);
    ctx.fill();
  });
}

export function drawCape(
  ctx: Ctx,
  skeleton: RoosterSkeleton,
  pose: RoosterPose,
  build: RoosterBuildSpec,
): void {
  const cape = capeShape(skeleton, pose, build.proportions.bodyGirth);
  const ramp = build.palette.hackle;
  const trace = (): void => appendPolygon(ctx, cape.outline);
  const bottom = add(skeleton.neckBase, 0, CAPE_SHADE_DEPTH);
  const gradient = ctx.createLinearGradient(cape.top.x, cape.top.y, bottom.x, bottom.y);
  gradient.addColorStop(0, ramp.mid);
  gradient.addColorStop(CAPE_LIT_STOP, ramp.light);
  gradient.addColorStop(CAPE_MID_STOP, ramp.mid);
  gradient.addColorStop(1, ramp.dark);
  fillTrace(ctx, trace, gradient);
  clipped(ctx, trace, () => {
    drawCapeStrands(ctx, cape, ramp);
    softSpot(
      ctx,
      add(skeleton.neckBase, CAPE_SHADOW_AT.x, CAPE_SHADOW_AT.y),
      CAPE_SHADOW_RX,
      CAPE_SHADOW_RY,
      0,
      ramp.deep,
      CAPE_SHADOW_ALPHA,
    );
  });
}

/** The hackle tips that fall over the top of a deltoid. */
const SHOULDER_HACKLES = 4;
const HEAD_ON_SHOULDER_HACKLES = 2;
const SHOULDER_HACKLE_LENGTH = 0.3;
const SHOULDER_HACKLE_SPREAD = 0.16;
const SHOULDER_HACKLE_HALF = 0.04;

/**
 * A few long hackle tips falling from the cape over the top of a shoulder. The
 * arm is painted over the cape so all of its muscle shows; these tips, laid
 * over its root, are what make it grow out of the feathers rather than sit on
 * top of them.
 */
export function drawShoulderHackles(
  ctx: Ctx,
  skeleton: RoosterSkeleton,
  shoulder: Pt,
  build: RoosterBuildSpec,
): void {
  const ramp = build.palette.hackle;
  const inward = Math.sign(skeleton.neckBase.x - shoulder.x) || 1;
  const spec = VIEWS[skeleton.view];
  const lean = spec.profile ? -1 : inward;
  // Head-on only the inner half of the shoulder takes tips, falling off the
  // collar: laid across the whole cap they read as a fringed epaulette.
  const count = spec.profile ? SHOULDER_HACKLES : HEAD_ON_SHOULDER_HACKLES;
  for (let i = 0; i < count; i++) {
    const t = spec.profile ? i / (count - 1) - MIDPOINT : inward * (i / count) * MIDPOINT;
    const root = add(
      shoulder,
      lean * SHOULDER_HACKLE_LEAN + t * SHOULDER_HACKLE_SPREAD,
      -SHOULDER_HACKLE_RISE,
    );
    const length =
      SHOULDER_HACKLE_LENGTH *
      (SHOULDER_HACKLE_SHORTEST +
        hash1(i * SHOULDER_HACKLE_SEED_STEP + 2) * SHOULDER_HACKLE_VARIATION);
    const tip = add(root, -lean * SHOULDER_HACKLE_SWEEP + t * SHOULDER_HACKLE_SWEEP, length);
    ctx.beginPath();
    appendQuill(
      ctx,
      root,
      add(mixPt(root, tip, MIDPOINT), -lean * SHOULDER_HACKLE_BOW, 0),
      tip,
      SHOULDER_HACKLE_HALF,
      QUILL_STEPS,
    );
    ctx.fillStyle = i % 2 === 0 ? ramp.light : ramp.mid;
    ctx.fill();
  }
}

// ── Kit ──────────────────────────────────────────────────────────────────────

const BELT_HEIGHT = 0.16;
/** The belt sits low on the barrel, over the drumsticks' roots. */
const BELT_DROP = pt(0.04, -0.5);
const BELT_RAMP: Ramp = {
  deep: '#1c0e06',
  dark: '#3a2010',
  mid: '#6a4222',
  light: '#94683a',
  rim: '#c0965c',
};
const BUCKLE_FILL = '#cfc4a0';
const BUCKLE_SHADE = '#6a6046';

/** A worn leather lifting belt, cinched round the middle and clipped to the trunk. */
export function drawBelt(
  ctx: Ctx,
  skeleton: RoosterSkeleton,
  pose: RoosterPose,
  build: RoosterBuildSpec,
): void {
  if (!build.kit.liftingBelt) return;
  const spec = VIEWS[skeleton.view];
  const angle = skeleton.bodyAngle + (spec.profile ? BODY_TILT * BELT_TILT_SHARE : 0);
  const drop = rotate(spec.profile ? BELT_DROP : pt(0, BELT_DROP.y), skeleton.bodyAngle);
  const centre = add(skeleton.hip, drop.x, drop.y);
  clipped(
    ctx,
    () => traceTrunk(ctx, skeleton, pose, build),
    () => {
      ctx.save();
      ctx.translate(centre.x, centre.y);
      ctx.rotate(angle);
      const gradient = ctx.createLinearGradient(0, -BELT_HEIGHT / 2, 0, BELT_HEIGHT / 2);
      gradient.addColorStop(0, BELT_RAMP.light);
      gradient.addColorStop(BELT_LIT_STOP, BELT_RAMP.mid);
      gradient.addColorStop(1, BELT_RAMP.deep);
      ctx.fillStyle = gradient;
      // The belt rings the ball of his body, so it bows down at its middle as
      // a ring below eye level does: straight head-on it is a waistband, and
      // straight in profile a strap across a round shield.
      const bow = spec.profile ? PROFILE_BELT_BOW : HEAD_ON_BELT_BOW;
      const bowAt = (x: number): number => bow * (1 - (x / BELT_HALF_SPAN) ** 2);
      const edge = (y: number): void => {
        ctx.moveTo(-BELT_HALF_SPAN, y);
        ctx.quadraticCurveTo(0, y + 2 * bow, BELT_HALF_SPAN, y);
      };
      ctx.beginPath();
      edge(-BELT_HEIGHT / 2);
      ctx.lineTo(BELT_HALF_SPAN, BELT_HEIGHT / 2);
      ctx.quadraticCurveTo(0, BELT_HEIGHT / 2 + 2 * bow, -BELT_HALF_SPAN, BELT_HEIGHT / 2);
      ctx.closePath();
      ctx.fill();
      ctx.strokeStyle = rgba(BELT_RAMP.rim, BELT_EDGE_ALPHA);
      ctx.lineWidth = BELT_STITCH;
      ctx.beginPath();
      edge(-BELT_HEIGHT / 2 + BELT_STITCH);
      ctx.stroke();
      ctx.fillStyle = rgba(BELT_RAMP.deep, BELT_CREASE_ALPHA);
      for (let i = -BELT_CREASES; i <= BELT_CREASES; i++) {
        ctx.fillRect(
          i * BELT_CREASE_STEP,
          -BELT_HEIGHT * BELT_CREASE_FROM + bowAt(i * BELT_CREASE_STEP),
          BELT_STITCH,
          BELT_HEIGHT * BELT_CREASE_LENGTH,
        );
      }
      if (spec.showsFace) {
        const buckleX =
          PROFILE_BUCKLE_FORWARD * (spec.profile ? 1 : yawAhead(spec) * yawFacingSign(spec));
        ctx.translate(0, bowAt(buckleX));
        ctx.fillStyle = BUCKLE_SHADE;
        ctx.fillRect(
          buckleX - BUCKLE_HALF,
          -BELT_HEIGHT * BUCKLE_RISE,
          BUCKLE_HALF * 2,
          BELT_HEIGHT * BUCKLE_RISE * 2,
        );
        ctx.fillStyle = BUCKLE_FILL;
        ctx.fillRect(
          buckleX - BUCKLE_FACE_HALF,
          -BELT_HEIGHT / 2,
          BUCKLE_FACE_HALF * 2,
          BELT_HEIGHT,
        );
        ctx.fillStyle = BUCKLE_SHADE;
        ctx.fillRect(
          buckleX - BUCKLE_HOLE_HALF,
          -BELT_HEIGHT / 4,
          BUCKLE_HOLE_HALF * 2,
          BELT_HEIGHT / 2,
        );
      }
      ctx.restore();
    },
  );
}

/**
 * Plain purple terry: a gym sweatband. White reads as a bandage at his
 * throat, and any stripe or check across it as a knotted bandana.
 */
const SWEATBAND_RAMP: Ramp = {
  deep: '#2a0e3a',
  dark: '#4c1a6a',
  mid: '#7a2ea8',
  light: '#a456d4',
  rim: '#cc90f0',
};

/** A frayed terry sweatband round the base of the neck. */
export function drawSweatband(ctx: Ctx, skeleton: RoosterSkeleton, build: RoosterBuildSpec): void {
  if (!build.kit.neckSweatband) return;
  const spec = VIEWS[skeleton.view];
  const centre = mixPt(skeleton.neckBase, skeleton.headCentre, SWEATBAND_AT);
  const halfWidth = spec.profile ? SWEATBAND_PROFILE_HALF : SWEATBAND_HEAD_ON_HALF;
  const halfHeight = SWEATBAND_HALF_HEIGHT;
  const tilt = spec.profile ? SWEATBAND_PROFILE_TILT : skeleton.headRoll * MIDPOINT;
  const trace = (): void =>
    appendEllipse(ctx, centre, halfWidth, halfHeight * SWEATBAND_ROLL, tilt);
  fillTrace(ctx, trace, roundGradient(ctx, centre, halfWidth, SWEATBAND_RAMP));
  for (let i = 0; i < SWEATBAND_FRAYS; i++) {
    const at = add(
      centre,
      (i / (SWEATBAND_FRAYS - 1) - MIDPOINT) * halfWidth * SWEATBAND_FRAY_SPAN,
      halfHeight * SWEATBAND_FRAY_DROP,
    );
    ctx.beginPath();
    appendQuill(
      ctx,
      at,
      add(at, SWEATBAND_FRAY_BEND.x, SWEATBAND_FRAY_BEND.y),
      add(at, SWEATBAND_FRAY_SPLAY * (i - (SWEATBAND_FRAYS - 1) / 2), SWEATBAND_FRAY_LENGTH),
      SWEATBAND_FRAY_HALF,
      SWEATBAND_FRAY_STEPS,
    );
    ctx.fillStyle = SWEATBAND_RAMP.dark;
    ctx.fill();
  }
}

// ── Tail ─────────────────────────────────────────────────────────────────────

interface SickleShape {
  /** How high the arc rises above the root. */
  readonly peak: number;
  /** How far back the tip lands. */
  readonly reach: number;
  /** How far below the root the tip hangs. */
  readonly drop: number;
  /** Where along its reach the arc turns over: further back, the tip hangs more steeply. */
  readonly archAt: number;
  /** How strongly the green sheen catches this sickle. */
  readonly sheen: number;
}

/**
 * The fountain, tallest feather first. Real sickles cascade: the top ones
 * arch highest and hang their tips lowest, the lesser ones are shorter and
 * flatter, and none of them sits at an even step from its neighbour. Evenly
 * stepped arcs with tips on one line read as the bands of a striped shell.
 */
const SICKLES: readonly SickleShape[] = [
  { peak: 1.12, reach: 0.92, drop: 0.6, archAt: 0.42, sheen: 1 },
  { peak: 0.98, reach: 0.7, drop: -0.12, archAt: 0.34, sheen: 0.3 },
  { peak: 0.8, reach: 0.88, drop: 0.32, archAt: 0.4, sheen: 0.75 },
  { peak: 0.64, reach: 0.52, drop: -0.18, archAt: 0.3, sheen: 0.25 },
  { peak: 0.5, reach: 0.74, drop: 0.12, archAt: 0.36, sheen: 0.6 },
  { peak: 0.34, reach: 0.4, drop: -0.08, archAt: 0.26, sheen: 0.25 },
];
/**
 * Seen head-on the fountain is end-on: its cascade runs away from the camera,
 * where its irregular tips cannot show, and what reads is the two sprays'
 * outline round his shoulders. These evenly stepped sickles keep each spray a
 * compact arch.
 */
const HEAD_ON_SICKLES: readonly SickleShape[] = [
  { peak: 0.98, reach: 0.96, drop: 0.5, archAt: 0.42, sheen: 1 },
  { peak: 0.88, reach: 0.95, drop: 0.3, archAt: 0.36, sheen: 0.45 },
  { peak: 0.66, reach: 0.9, drop: 0.42, archAt: 0.4, sheen: 0.85 },
  { peak: 0.6, reach: 0.92, drop: 0.16, archAt: 0.3, sheen: 0.35 },
  { peak: 0.4, reach: 0.76, drop: 0.3, archAt: 0.34, sheen: 0.7 },
  { peak: 0.32, reach: 0.64, drop: 0.08, archAt: 0.26, sheen: 0.3 },
];
/**
 * How far along each sickle the fountain's dark body reaches. Past it the
 * tips hang free as separate points; a body filled to the tips ends every
 * feather on one straight cut.
 */
const FOUNTAIN_BODY_ENDS = 0.72;
/**
 * In profile the body stops sooner, under the arch's crown, and the sickles'
 * broad, shadowed blades carry the mass from there: filled to most of their
 * length the fountain is one dark fan with stripes on it.
 */
const PROFILE_FOUNTAIN_BODY_ENDS = 0.45;
/** In profile the coverts massed under the sickles shrink with the body, for the same reason. */
const PROFILE_COVERT_SCALE = 0.6;
/** How much shorter than that a middle sickle's share of the body may stop, so its edge is ragged. */
const FOUNTAIN_RAGGED = 0.14;
const FOUNTAIN_RAGGED_SEED_STEP = 2.3;
/**
 * The fountain's body sits part way from the sickles' dark toward their green:
 * near-black, it vanishes against the dungeon floor at the tile and only the
 * sheen lines survive, a set of bright stripes.
 */
const FOUNTAIN_BODY_LIFT = 0.5;
/** The fewest whole sickles in a spray whose space between is filled into a mass. */
const FOUNTAIN_MIN_WHOLE = 3;
const SICKLE_ROOT_HALF = 0.13;
/** How far below a sickle its shadow falls, against the sickle's half-width. */
const SICKLE_SHADOW_DROP = 0.9;
/**
 * Head-on the sprays' sickles stay slim and unshadowed: broad overlapping
 * blades arching past his shoulder are a wing's primaries.
 */
const HEAD_ON_SICKLE_GIRTH = 0.77;
/**
 * Which sickles are snapped: every other one from the tallest down, so the
 * top of the fountain is a broken stub with its end hanging, the kink that
 * says "broken" in silhouette, and whole sickles still arch between the stubs,
 * so the tail is a broken fountain rather than a shorter one.
 */
function isSnappedSickle(index: number, snapped: number): boolean {
  return index % 2 === 0 && index / 2 < snapped;
}

/** Where along its length a snapped sickle ends. */
const SNAPPED_AT = 0.45;
/** The coverts: the short broad feathers massed under the sickles. */
const COVERT_OUTLINE: readonly Pt[] = [
  pt(0.05, 0.02),
  pt(-0.02, -0.55),
  pt(-0.22, -0.82),
  pt(-0.5, -0.78),
  pt(-0.72, -0.52),
  pt(-0.8, -0.18),
  pt(-0.66, 0.14),
  pt(-0.24, 0.18),
];
/** Head-on, how far across the picture a full swing carries a sickle's tip, per unit of its reach. */
const HEAD_ON_SWAY = 0.12;
/**
 * Head-on, how far out to its own side each spray of sickles arches, per unit
 * of its reach: the spray toward the side he faces, and the one away from it.
 */
const FACING_TAIL_SPRAY = { ahead: 0.85, behind: 0.45 } as const;
/**
 * From behind the fountain is seen end-on, a narrow plume standing off his
 * rump: parted as wide as from the front, the two sprays flank his shoulders
 * as a pair of wings.
 */
const AWAY_TAIL_SPRAY = { ahead: 0.4, behind: 0.25 } as const;
/**
 * Head-on, the share of a sickle's fall below its root that shows. The tips
 * fall away behind him, mostly in depth; drawn at full fall they hang beside
 * the arms at shoulder height and the two sprays read as a pair of wings.
 */
const HEAD_ON_TAIL_FALL_SHARE = 0.2;
/**
 * Head-on, the share of the fountain's run back from his rump that shows across
 * the picture. The sickles fall away from the camera as much as to the side, so
 * most of that run is depth; shown at full turn the whole fountain lies off to
 * one side of him and reads as a single raised wing.
 */
const HEAD_ON_TAIL_BACK_SHARE = 0.3;

/** The green sheen down a sickle's upper edge, and the glint on its crest. */
const SICKLE_SHEEN_ALPHA = 0.7;
const SICKLE_GLINT_ALPHA = 0.55;
/** Only a sickle catching at least this much sheen carries a glint on its crest. */
const SICKLE_GLINT_FROM = 0.8;

function splitSickle(root: Pt, control: Pt, tip: Pt, at: number): [Pt, Pt] {
  return [mixPt(root, control, at), quadAt(root, control, tip, at)];
}

/** Paints one sickle: the dark quill, then a green sheen down its upper edge. */
function drawSickle(
  ctx: Ctx,
  root: Pt,
  control: Pt,
  tip: Pt,
  half: number,
  sheen: number,
  ramp: Ramp,
  shingled: boolean,
): void {
  // A shadow under each sickle's lower edge, cast onto the one beneath it, is
  // what separates the overlapping feathers in profile; without it the
  // fountain is one blade with stripes painted on.
  if (shingled) {
    ctx.beginPath();
    appendQuill(
      ctx,
      add(root, 0, half * SICKLE_SHADOW_DROP),
      add(control, 0, half * SICKLE_SHADOW_DROP),
      add(tip, 0, half * SICKLE_SHADOW_DROP),
      half,
      SICKLE_STEPS,
      SICKLE_TAPER,
    );
    ctx.fillStyle = ramp.deep;
    ctx.fill();
  }
  ctx.beginPath();
  appendQuill(ctx, root, control, tip, half, SICKLE_STEPS, SICKLE_TAPER);
  ctx.fillStyle = ramp.mid;
  ctx.fill();
  const sheenRoot = add(root, 0, -half * SHEEN_ROOT_LIFT);
  const sheenControl = add(control, 0, -half * SHEEN_ARCH_LIFT);
  ctx.beginPath();
  appendQuill(ctx, sheenRoot, sheenControl, tip, half * SHEEN_WIDTH, SICKLE_STEPS, SICKLE_TAPER);
  ctx.fillStyle = rgba(ramp.light, SICKLE_SHEEN_ALPHA * sheen);
  ctx.fill();
  if (sheen < SICKLE_GLINT_FROM) return;
  // The glint runs along the sickle's own first half; a curve drawn through
  // the whole feather's control point floats above it as a separate line.
  const [glintControl, glintEnd] = splitSickle(root, control, tip, MIDPOINT);
  ctx.beginPath();
  appendQuill(
    ctx,
    add(sheenRoot, 0, -half * GLINT_ROOT_LIFT),
    add(glintControl, 0, -half * (SHEEN_ARCH_LIFT + GLINT_ARCH_LIFT)),
    add(glintEnd, 0, -half * GLINT_ARCH_LIFT),
    half * GLINT_WIDTH,
    GLINT_STEPS,
  );
  ctx.fillStyle = rgba(ramp.rim, SICKLE_GLINT_ALPHA);
  ctx.fill();
}

/**
 * The tail fountain: the sickles arch up and back from the root and fall away
 * behind him, the biggest shape in his outline. Head-on his body is turned, so
 * the same fountain sweeps away to the side behind him, foreshortened, and
 * swings across the picture with his tail.
 */
export function drawTail(
  ctx: Ctx,
  skeleton: RoosterSkeleton,
  pose: RoosterPose,
  build: RoosterBuildSpec,
): void {
  const spec = VIEWS[skeleton.view];
  const ramp = build.palette.tail;
  const count = Math.min(build.proportions.sickles, SICKLES.length);
  const scale = build.proportions.tailLength;
  const root = skeleton.tailRoot;
  const snapped = build.plumage.snappedSickles;

  // Edge-on every sickle lies in one plane. Head-on they part into two
  // sprays, alternate sickles arching out to either side of the tail's
  // midline as they fall: one fan swept off to one side reads as a wing.
  // The spray falling toward the side he faces arches wider, to clear his head
  // and neck: kept as narrow as the other it hides behind them.
  const facing = yawFacingSign(spec);
  const spread = spec.showsFace ? FACING_TAIL_SPRAY : AWAY_TAIL_SPRAY;
  const sprayOf = (i: number): number => {
    if (spec.profile) return 0;
    return i % 2 === 0 ? facing * spread.ahead : -facing * spread.behind;
  };
  const place = ((): ((p: Pt, spray: number) => Pt) => {
    if (spec.profile) {
      const turn =
        pose.tailLift + skeleton.bodyAngle * TAIL_FOLLOWS_LEAN + pose.tailSwing * TAIL_SWING_TURN;
      return (p) => {
        const turned = rotate(pt(p.x * scale, p.y * scale), turn);
        return add(root, turned.x, turned.y);
      };
    }
    const backward = yawAhead(spec) * facing * HEAD_ON_TAIL_BACK_SHARE;
    const sway = pose.tailSwing * HEAD_ON_SWAY;
    const rump = pt(lerp(skeleton.bodyCentre.x, root.x, HEAD_ON_TAIL_BACK_SHARE), root.y);
    return (p, spray) => {
      const fall = p.y > 0 ? p.y * HEAD_ON_TAIL_FALL_SHARE : p.y;
      const turned = rotate(pt(p.x * scale, fall * scale), pose.tailLift);
      const outward = (spray + sway) * -p.x * scale;
      return add(rump, turned.x * backward + outward, turned.y);
    };
  })();

  const bodyEnds = spec.profile ? PROFILE_FOUNTAIN_BODY_ENDS : FOUNTAIN_BODY_ENDS;
  const covertScale = spec.profile ? PROFILE_COVERT_SCALE : 1;
  fillTrace(
    ctx,
    () =>
      appendSmoothLoop(
        ctx,
        COVERT_OUTLINE.map((p) => place(pt(p.x * covertScale, p.y * covertScale), 0)),
      ),
    ramp.dark,
  );
  const shapes = spec.profile ? SICKLES : HEAD_ON_SICKLES;
  const girthShare = spec.profile ? 1 : HEAD_ON_SICKLE_GIRTH;
  const sickleCurve = (i: number): [Pt, Pt, Pt] => {
    const shape = shapes[i];
    const spray = sprayOf(i);
    return [
      place(pt(0, -SICKLE_ROOT_STACK * i), spray),
      place(pt(-shape.reach * shape.archAt, -shape.peak * 2), spray),
      place(pt(-shape.reach, shape.drop), spray),
    ];
  };
  // Each spray's body: the space between its top sickle and its lowest one
  // filled dark, so the tail is a mass at the tile rather than a few strokes.
  const arcOf = (i: number): Pt[] => {
    const [start, control, tip] = sickleCurve(i);
    return Array.from({ length: FOUNTAIN_SAMPLES + 1 }, (_unused, k) =>
      quadAt(start, control, tip, (k / FOUNTAIN_SAMPLES) * bodyEnds),
    );
  };
  const bodyEndOf = (i: number): Pt => {
    const [start, control, tip] = sickleCurve(i);
    const ragged = bodyEnds - hash1(i * FOUNTAIN_RAGGED_SEED_STEP) * FOUNTAIN_RAGGED;
    return quadAt(start, control, tip, ragged);
  };
  const indices = Array.from({ length: count }, (_unused, i) => i);
  const sprays = spec.profile
    ? [indices]
    : [indices.filter((i) => sprayOf(i) > 0), indices.filter((i) => sprayOf(i) < 0)];
  for (const spray of sprays) {
    const whole = spray.filter((i) => !isSnappedSickle(i, snapped));
    if (spray.length === 0) continue;
    const low = spray[spray.length - 1];
    const top = whole.length > 0 ? whole[0] : low;
    // Two whole sickles with the gap between them filled are one broad blade, a flag.
    if (whole.length < FOUNTAIN_MIN_WHOLE) continue;
    const topArc = arcOf(top);
    const lowArc = arcOf(low);
    const between = spray
      .filter((i) => i > top && i < low && !isSnappedSickle(i, snapped))
      .map(bodyEndOf);
    fillTrace(
      ctx,
      () => appendPolygon(ctx, [...topArc, ...between, ...lowArc.reverse()]),
      mix(ramp.dark, ramp.mid, FOUNTAIN_BODY_LIFT),
    );
  }
  const sickleHalf = SICKLE_ROOT_HALF * girthShare * clamp01(scale + SICKLE_GIRTH_FLOOR);
  for (let i = count - 1; i >= 0; i--) {
    const [start, fullControl, fullTip] = sickleCurve(i);
    const isSnapped = isSnappedSickle(i, snapped);
    const [control, tip] = isSnapped
      ? splitSickle(start, fullControl, fullTip, SNAPPED_AT + hash1(i) * SNAPPED_VARIATION)
      : [fullControl, fullTip];
    drawSickle(ctx, start, control, tip, sickleHalf, shapes[i].sheen, ramp, spec.profile);
    if (isSnapped && hash1(i * SNAPPED_DANGLE_SEED_STEP) < SNAPPED_DANGLE_SHARE) {
      drawDanglingEnd(ctx, control, tip, distance(start, fullTip) * scale, sickleHalf, ramp);
    }
  }
}

/**
 * A snapped sickle's broken-off end, still hanging by the shaft from the
 * break: the kink is what says "broken" at the tile. A feather that merely
 * stops short reads as a shorter feather.
 */
const SNAPPED_DANGLE_SHARE = 0.7;
const SNAPPED_DANGLE_SEED_STEP = 3.1;
const SNAPPED_DANGLE_LENGTH = 0.32;
/** How far the hanging end swings from the stub's own line toward straight down. */
const SNAPPED_DANGLE_DROOP = 0.8;
const SNAPPED_DANGLE_GIRTH = 0.6;

function drawDanglingEnd(
  ctx: Ctx,
  control: Pt,
  breakAt: Pt,
  sickleLength: number,
  half: number,
  ramp: Ramp,
): void {
  const along = angleOf(control, breakAt);
  const straightDown = Math.PI / 2;
  // Swung the short way round, so a stub pointing back and up falls back and down.
  const towardDown = Math.atan2(Math.sin(straightDown - along), Math.cos(straightDown - along));
  const hang = along + towardDown * SNAPPED_DANGLE_DROOP;
  const length = sickleLength * SNAPPED_DANGLE_LENGTH;
  const end = add(breakAt, Math.cos(hang) * length, Math.sin(hang) * length);
  ctx.beginPath();
  appendQuill(
    ctx,
    breakAt,
    mixPt(breakAt, end, MIDPOINT),
    end,
    half * SNAPPED_DANGLE_GIRTH,
    SICKLE_STEPS,
    SICKLE_TAPER,
  );
  ctx.fillStyle = ramp.mid;
  ctx.fill();
}
