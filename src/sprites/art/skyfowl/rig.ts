/**
 * The skyfowl rig: a hawk-like bird-person, painted upright and bipedal like
 * every other figure in this repo, but built to read as avian rather than as
 * a person in a costume. Three things carry that read at a 32px tile, in
 * descending order of how much they matter:
 *
 *   1. A **digitigrade** leg with a reversed-reading hock, exactly the trap a
 *      rodent leg solves for (`ratKinArt.ts`) — this rig solves the same
 *      three-segment chain independently, because a skyfowl's proportions
 *      (long metatarsus, small hooked talon) are its own, not a rat's.
 *   2. A **hooked beak**, foreshortened and turned in the down view rather
 *      than drawn as a flat top-down triangle — see `drawHeadDown` for why.
 *   3. **Folded wings that double as arms.** The wing's wrist becomes a hand
 *      with three feathered fingers, so a shopkeeper can hold a ledger and a
 *      guard can grip a spear without inventing a second limb.
 *
 * This module knows nothing about animation: it paints one pose. Choreography
 * (walk, idle, talk, work, the combat rows) lives in `rows.ts`.
 *
 * Views: `down` (toward the camera), `side` (profile, facing +X; mirrored at
 * runtime for the opposite facing) and `up` (away from the camera). Down and
 * side are not one figure with a multiplier — a profile needs its own lateral
 * spread, its own head and its own leg silhouette, which is what `ViewSpec`
 * exists to hold.
 */

import { clamp01, easeInOut, lerp, type Pt } from '../carlArt';
import {
  HALF_PI,
  MIDPOINT,
  TWO_PI,
  BODY_OUTLINE_WIDTH,
  DETAIL_OUTLINE_WIDTH,
  MIN_VISIBLE_ALPHA,
  angleBetween,
  fillCapsule,
  fillOutlined,
  mixPt,
  offset,
  outlineCapsule,
  pt,
  rotate,
  shadeSegment,
  sheenSegment,
  traceFeatherEdge,
} from './paint';
import { fillSoftEllipse } from '../softShade';
import {
  BEAK,
  CERE,
  CONTACT_SHADOW_ALPHA,
  EYE_IRIS,
  EYE_PUPIL,
  LEG_SCALE,
  RIM_ALPHA,
  RIM_LIGHT,
  RIM_WIDTH,
  SKYFOWL_BUILDS,
  TALON,
  type PlumagePattern,
  type SkyfowlBuild,
  type SkyfowlBuildSpec,
} from './palette';
import type { SkyfowlOutfit } from './outfit';

type Ctx = CanvasRenderingContext2D;

// ── Proportions ──────────────────────────────────────────────────────────────
//
// Origin sits between the talons with +Y down; every height below is
// negative. Heights are pinned first and bone lengths derived from them,
// never a body part sized off the head (memory: never derive a part from the
// head — it is deliberately oversized).

export const GROUND_Y = 0;
const HOCK_Y = -0.3;
const KNEE_Y = -0.6;
const HIP_Y = -0.86;
const WAIST_Y = -0.98;
const CHEST_Y = -1.3;
const SHOULDER_Y = -1.42;
/**
 * A hawk's head is a much bigger fraction of its height than a human's —
 * bigger *and* fewer heads tall is how a stylised figure reads correctly
 * proportioned rather than as a doll (memory: head count is how size is
 * read). The head is sized after every other landmark, never the reverse.
 */
const HEAD_CENTRE_Y = -1.78;

/**
 * The thigh and shank are cut a little longer than the landmarks they span,
 * so a standing leg never reaches its full length: with the tarsus tipped
 * forward under the hip the knee keeps a soft forward break instead of
 * locking into one straight stilt from hip to foot.
 */
const LEG_SLACK = 1.06;
const THIGH_LENGTH = Math.abs(HIP_Y - KNEE_Y) * LEG_SLACK;
const SHANK_LENGTH = Math.abs(KNEE_Y - HOCK_Y) * LEG_SLACK;
const METATARSUS_LENGTH = Math.abs(HOCK_Y - GROUND_Y);
/** The longest the thigh and shank together are ever asked to span: never a locked knee. */
const LEG_MAX_REACH_SHARE = 0.985;
/** Hip to hock at the longest a pose may ask for. */
export const SKYFOWL_LEG_REACH = (THIGH_LENGTH + SHANK_LENGTH) * LEG_MAX_REACH_SHARE;
/** The hip's height over the ground when standing tall; every pose's `bob`/`crouch` is measured from it. */
export const SKYFOWL_STANDING_HIP = GROUND_Y - HIP_Y;
/** How far a full `crouch` lowers the hip. */
const CROUCH_DROP = 0.25;
const FRONT_TOE_LENGTH = 0.12;
const HALLUX_LENGTH = 0.06;

const UPPER_WING_LENGTH = 0.24;
const FOREWING_LENGTH = 0.2;
const HAND_LENGTH = 0.1;

// Widths, in tiles, before a build's multipliers are applied.
const HIP_HALF_WIDTH = 0.17;
const CHEST_HALF_WIDTH = 0.23;
const SHOULDER_HALF_WIDTH = 0.24;
/** The feathered "trouser" mass at the thigh — deliberately wide; the bare shank below it is not. */
const THIGH_WIDTH = 0.135;
/**
 * The bare leg is thin, as a bird's is, but held to about two pixels across
 * at the 32px tile: any thinner and a swinging tarsus flickers in and out,
 * which reads as the leg teleporting rather than stepping.
 */
const SHANK_WIDTH = 0.062;
const METATARSUS_WIDTH = 0.046;
const UPPER_WING_WIDTH = 0.095;
const FOREWING_WIDTH = 0.07;
const HAND_WIDTH = 0.045;

const HEAD_HALF_WIDTH = 0.21;
const HEAD_HALF_HEIGHT = 0.23;
const CREST_HEIGHT = 0.055;
const BEAK_LENGTH = 0.17;
const BEAK_BASE_HALF_WIDTH = 0.06;
const BEAK_HOOK_DROP = 0.05;
/** How much wider than its frontal silhouette the torso reads in profile. */
const SIDE_TORSO_WIDTH_BOOST = 1.6;

// ── Pose ─────────────────────────────────────────────────────────────────────

/**
 * One leg, placed by where its foot stands rather than by joint angles.
 *
 * The rig solves the chain up from the foot: the tarsus (the bare scaled
 * "shin" a bird walks on) is set down at `tarsusTilt` over the ball of the
 * foot, and the thigh and shank reach from the hip to the hock with the knee
 * breaking forward, hidden in the feathers. A foot placed this way stays
 * exactly where the choreography put it whatever the body above it does —
 * the only way a planted foot can hold its ground while the hips bob, crouch
 * and sway over it. Every distance is in rig units in the figure's own
 * travelling frame, independent of the view it is drawn in.
 */
export interface SkyfowlLegPose {
  /** Where the ball of the foot stands along the way the figure faces, from the hip; + ahead. */
  readonly footAhead: number;
  /** Sideways offset of the foot from its hip, head-on and from behind only; + away from the centreline. */
  readonly footOut: number;
  /** Height of the ball of the foot above the ground; 0 is planted. */
  readonly footLift: number;
  /**
   * The tarsus's angle from vertical, radians; + tips the foot ahead of the
   * hock (a leg reaching forward to land), − trails the foot behind it (a leg
   * pushing off, or folded up under the body in the swing).
   */
  readonly tarsusTilt: number;
  /** 0 toes spread flat on the ground, 1 curled under as the foot swings through. */
  readonly toeCurl: number;
}

/** One wing's joint targets, folded (arm-like) or spread. */
export interface SkyfowlWingPose {
  /** Swing at the shoulder: + is forward (a gesture, a carried prop), radians. */
  readonly shoulderSwing: number;
  /** How far the wing stands out from the body, radians; 0 is folded flat. */
  readonly shoulderSpread: number;
  /** Bend at the wrist-elbow, radians; larger folds the forewing back. */
  readonly elbowBend: number;
  /** 0 = fingers closed into the wing's leading edge, 1 = spread for a grip. */
  readonly handOpen: number;
  /**
   * 0 = the flight feathers folded away, 1 = fanned out long past the hand —
   * a wing flung open. Absent is folded.
   */
  readonly flare?: number;
}

/**
 * One frame of a skyfowl. The upper body — torso, garments, wings, head —
 * rides the hip; the legs are solved between the hip and wherever each foot
 * stands, so moving the hip never moves a planted foot.
 */
export interface SkyfowlPose {
  /** Hip height offset, rig units; negative lifts the body, positive sinks it. */
  readonly bob: number;
  /** Forward pitch of the upper body about the hip, radians: tipped in profile, foreshortened head-on. */
  readonly lean: number;
  /** 0 stands tall, 1 sinks the hip a full {@link CROUCH_DROP} into bent legs. */
  readonly crouch: number;
  /** Sideways shift of the hip and everything above it: a weight shift, not a step. */
  readonly sway: number;
  /** Head-on and from behind: the upper body tipped about the hip in the picture plane, radians. */
  readonly tilt: number;
  readonly nearLeg: SkyfowlLegPose;
  readonly farLeg: SkyfowlLegPose;
  readonly nearWing: SkyfowlWingPose;
  readonly farWing: SkyfowlWingPose;
  readonly headTurn: number;
  readonly headTilt: number;
  /** Profile only: the head carried ahead of (+) or behind (−) the shoulders, rig units. */
  readonly headAhead: number;
  /** The head dropped (+) or raised (−) against the shoulders, rig units. */
  readonly headDrop: number;
  readonly beakOpen: number;
}

/**
 * A standing tarsus is not vertical: it slopes up and back from the foot to
 * the hock, which is what puts the bird's "backwards knee" visibly behind the
 * foot. Straight, the leg reads as a stilt.
 */
export const SKYFOWL_STANDING_TARSUS_TILT = (10 * Math.PI) / 180;

/** A foot planted under its own hip. */
export const SKYFOWL_STANDING_LEG: SkyfowlLegPose = {
  footAhead: 0,
  footOut: 0,
  footLift: 0,
  tarsusTilt: SKYFOWL_STANDING_TARSUS_TILT,
  toeCurl: 0,
};

export function skyfowlRestingPose(): SkyfowlPose {
  const wing: SkyfowlWingPose = {
    shoulderSwing: 0,
    shoulderSpread: 0.05,
    elbowBend: -0.35,
    handOpen: 0,
  };
  return {
    bob: 0,
    lean: 0,
    crouch: 0,
    sway: 0,
    tilt: 0,
    nearLeg: SKYFOWL_STANDING_LEG,
    farLeg: SKYFOWL_STANDING_LEG,
    nearWing: wing,
    farWing: wing,
    headTurn: 0,
    headTilt: 0,
    headAhead: 0,
    headDrop: 0,
    beakOpen: 0,
  };
}

export type SkyfowlView = 'down' | 'side' | 'up';

/**
 * How a view departs from the base geometry. `lateral` scales any left/right
 * offset (hip stance, wing spread) that reads as depth in profile but as
 * side-to-side spacing head-on; `depthSign` says which way the figure's
 * "ahead" runs up or down the screen head-on (toward the camera is down).
 */
interface ViewSpec {
  readonly lateral: number;
  readonly depthSign: number;
}

const VIEWS: Readonly<Record<SkyfowlView, ViewSpec>> = {
  down: { lateral: 1, depthSign: 1 },
  side: { lateral: 0.22, depthSign: 0 },
  up: { lateral: 1, depthSign: -1 },
};

// ── Skeleton solve ───────────────────────────────────────────────────────────

/** A point in the figure's own travelling frame: ahead along its heading, and height off the ground. */
export interface GaitPoint {
  readonly ahead: number;
  readonly height: number;
}

/** Where the hock sits over a foot's ball with its tarsus at `tarsusTilt`. */
export function skyfowlHockOver(ball: GaitPoint, tarsusTilt: number): GaitPoint {
  return {
    ahead: ball.ahead - Math.sin(tarsusTilt) * METATARSUS_LENGTH,
    height: ball.height + Math.cos(tarsusTilt) * METATARSUS_LENGTH,
  };
}

/**
 * The highest a hip standing at `hipAhead` can ride while this foot stays
 * where it is, with the knee soft — what a gait's pelvis height is held
 * under so a planted foot is never pulled off the floor.
 */
export function skyfowlHipCeiling(leg: SkyfowlLegPose, hipAhead = 0): number {
  const hock = skyfowlHockOver({ ahead: leg.footAhead, height: leg.footLift }, leg.tarsusTilt);
  const across = hock.ahead - hipAhead;
  return hock.height + Math.sqrt(Math.max(0, SKYFOWL_LEG_REACH ** 2 - across * across));
}

interface GaitChain {
  readonly hip: GaitPoint;
  readonly knee: GaitPoint;
  readonly hock: GaitPoint;
  readonly ball: GaitPoint;
}

/**
 * The digitigrade chain from the ball of the foot up: tarsus to the hock at
 * the pose's tilt, then a two-bone reach from the hip to the hock with the
 * knee breaking forward. A foot the hip cannot reach is drawn where the
 * straightened leg leaves it, hanging — never a leg stretched past its
 * length; the gates catch a pose that asks for that.
 */
function solveGaitChain(hipHeight: number, leg: SkyfowlLegPose): GaitChain {
  const hip: GaitPoint = { ahead: 0, height: hipHeight };
  let ball: GaitPoint = { ahead: leg.footAhead, height: leg.footLift };
  let hock = skyfowlHockOver(ball, leg.tarsusTilt);
  const toHockAhead = hock.ahead - hip.ahead;
  const toHockHeight = hock.height - hip.height;
  const distance = Math.max(Math.hypot(toHockAhead, toHockHeight), Number.EPSILON);
  const unitAhead = toHockAhead / distance;
  const unitHeight = toHockHeight / distance;
  const span = Math.min(distance, SKYFOWL_LEG_REACH);
  if (span < distance) {
    const pullAhead = unitAhead * (span - distance);
    const pullHeight = unitHeight * (span - distance);
    hock = { ahead: hock.ahead + pullAhead, height: hock.height + pullHeight };
    ball = { ahead: ball.ahead + pullAhead, height: ball.height + pullHeight };
  }
  const along = (THIGH_LENGTH ** 2 - SHANK_LENGTH ** 2 + span * span) / (2 * span);
  const across = Math.sqrt(Math.max(0, THIGH_LENGTH ** 2 - along * along));
  // The perpendicular with a positive "ahead" component: the knee breaks forward.
  const perpAhead = -unitHeight;
  const perpHeight = unitAhead;
  const knee: GaitPoint = {
    ahead: hip.ahead + unitAhead * along + perpAhead * across,
    height: hip.height + unitHeight * along + perpHeight * across,
  };
  return { hip, knee, hock, ball };
}

/**
 * Head-on, how much of a point's "ahead" shows as screen height. The floor
 * is seen steeply from above, so a planted foot slides only a short way up
 * or down the screen as the body passes over it; higher up the leg the body
 * stands upright and depth does not show at all. Matched to Carl's head-on
 * floor so the two casts' feet travel the same way in the same room.
 */
const HEAD_ON_FLOOR_FORESHORTENING = 0.15;
const DEPTH_SHOWN_FULLY_BELOW = 0.06;
const DEPTH_HIDDEN_ABOVE = 0.6;

function depthShareAt(height: number): number {
  const span = DEPTH_HIDDEN_ABOVE - DEPTH_SHOWN_FULLY_BELOW;
  const upright = easeInOut(clamp01((height - DEPTH_SHOWN_FULLY_BELOW) / span));
  return HEAD_ON_FLOOR_FORESHORTENING * (1 - upright);
}

interface LegChain {
  readonly hip: Pt;
  readonly knee: Pt;
  readonly hock: Pt;
  /** The ball of the foot, where the toes spread from. */
  readonly toe: Pt;
  /** Where the foot would stand on the floor directly under the ball: the contact shadow's centre. */
  readonly ground: Pt;
  readonly toeCurl: number;
  readonly widthScale: number;
}

/**
 * Draws a solved chain into the screen for a view. Profile lays "ahead"
 * along +X; head-on it becomes a little screen height (see
 * {@link depthShareAt}) and the leg's sideways offset is eased in from the
 * hip to the foot.
 */
function projectLeg(
  chain: GaitChain,
  leg: SkyfowlLegPose,
  view: SkyfowlView,
  hipX: number,
  build: SkyfowlBuildSpec,
): LegChain {
  const spec = VIEWS[view];
  const project = (p: GaitPoint): Pt => {
    if (view === 'side') return pt(hipX + p.ahead, GROUND_Y - p.height);
    const outShare = clamp01(1 - p.height / Math.max(chain.hip.height, Number.EPSILON));
    const out = leg.footOut * outShare * Math.sign(hipX === 0 ? 1 : hipX);
    return pt(hipX + out, GROUND_Y - p.height + spec.depthSign * p.ahead * depthShareAt(p.height));
  };
  const ball = project(chain.ball);
  return {
    hip: project(chain.hip),
    knee: project(chain.knee),
    hock: project(chain.hock),
    toe: ball,
    ground: project({ ahead: chain.ball.ahead, height: 0 }),
    toeCurl: leg.toeCurl,
    widthScale: build.limbWidth,
  };
}

/** The hip's height off the ground for a pose on a build. */
function hipHeightOf(pose: SkyfowlPose, build: SkyfowlBuildSpec): number {
  return SKYFOWL_STANDING_HIP - CROUCH_DROP * (pose.crouch + build.crouch) - pose.bob;
}

interface WingChain {
  readonly shoulder: Pt;
  readonly elbow: Pt;
  readonly hand: Pt;
  readonly widthScale: number;
}

/**
 * Solves the folded wing from the shoulder, in the same straight-down-is-zero
 * convention the leg uses. A folded wing hangs at the figure's side and wraps
 * back toward the body as it bends — never up across the chest, which is what
 * hides the beak a crossed-arms pose would.
 */
function solveWing(
  shoulder: Pt,
  wing: SkyfowlWingPose,
  build: SkyfowlBuildSpec,
  side: number,
  lateral: number,
): WingChain {
  const outAngle = wing.shoulderSpread * side * lateral + wing.shoulderSwing;
  const elbow = offset(
    shoulder,
    Math.sin(outAngle) * UPPER_WING_LENGTH * build.wingSpan,
    Math.cos(outAngle) * UPPER_WING_LENGTH * build.wingSpan,
  );
  const handAngle = outAngle + wing.elbowBend * side * 0.5;
  const hand = offset(
    elbow,
    Math.sin(handAngle) * FOREWING_LENGTH * build.wingSpan,
    Math.cos(handAngle) * FOREWING_LENGTH * build.wingSpan,
  );
  return { shoulder, elbow, hand, widthScale: build.limbWidth };
}

// ── Body-part painters ───────────────────────────────────────────────────────

/**
 * The thigh is feathered — drawn in the body's own plumage, wide, tapering
 * fast — and only the shank and metatarsus are bare scaled leg. A leg painted
 * one uniform tone and width top to bottom is the "long uniform stilt" that
 * reads as a person on legwarmers rather than a bird's leg.
 */
function paintLeg(
  ctx: Ctx,
  chain: LegChain,
  ramp: PlumagePattern,
  shade: number,
  view: SkyfowlView,
): void {
  const thighW = THIGH_WIDTH * chain.widthScale;
  const shankW = SHANK_WIDTH * chain.widthScale;
  const metaW = METATARSUS_WIDTH * chain.widthScale;
  const feather = mixRamp(ramp.body, shade);
  const skin = mixRamp(LEG_SCALE, shade);
  outlineCapsule(ctx, chain.hip, chain.knee, thighW, shankW * 1.3);
  outlineCapsule(ctx, chain.knee, chain.hock, shankW, metaW);
  outlineCapsule(ctx, chain.hock, chain.toe, metaW, metaW * 0.75);
  fillCapsule(ctx, chain.hip, chain.knee, thighW, shankW * 1.3, feather.mid);
  fillCapsule(ctx, chain.knee, chain.hock, shankW, metaW, skin.mid);
  fillCapsule(ctx, chain.hock, chain.toe, metaW, metaW * 0.75, skin.mid);
  sheenSegment(ctx, chain.hip, chain.knee, thighW, feather.light, 0.22);
  sheenSegment(ctx, chain.knee, chain.hock, shankW, skin.light, 0.2);
  sheenSegment(ctx, chain.hock, chain.toe, metaW, skin.light, 0.2);
  shadeSegment(ctx, chain.hip, chain.knee, thighW, feather.dark, 0.3);
  shadeSegment(ctx, chain.knee, chain.hock, shankW, skin.dark, 0.28);
  shadeSegment(ctx, chain.hock, chain.toe, metaW, skin.dark, 0.32);
  // The hock is the joint a viewer reads as the bird's "backwards knee": a
  // small knuckle there keeps the bend legible when the tarsus swings.
  ctx.beginPath();
  ctx.arc(chain.hock.x, chain.hock.y, metaW * HOCK_KNUCKLE_SCALE, 0, TWO_PI);
  ctx.fillStyle = skin.dark;
  ctx.fill();
  paintFoot(ctx, chain, metaW, view, skin);
}

/** How much wider than the tarsus the hock's knuckle is drawn. */
const HOCK_KNUCKLE_SCALE = 1.25;
/** Profile: the far front toe is drawn this much above the near one, the only depth a flat foot shows edge-on. */
const PROFILE_FAR_TOE_RISE = 0.2;
/** How far a fully curled toe turns down from lying flat, radians. */
const TOE_CURL_TURN = 1.25;
/** How much of its length a fully curled toe still shows. */
const TOE_CURL_LENGTH_SHARE = 0.55;
/** Head-on, the three front toes fan this far either side of pointing at the camera, radians. */
const HEAD_ON_TOE_FAN = 0.62;
/** Head-on the toes point at the camera, so only this share of their length shows. */
const HEAD_ON_TOE_FORESHORTEN = 0.5;
/** From behind, the two outer front toes peek past the tarsus at this angle off vertical. */
const BACK_VIEW_TOE_PEEK = 1.05;
/** Profile: the far toe is foreshortened as it angles away from the camera. */
const PROFILE_FAR_TOE_SHARE = 0.85;
/** The hind toe curls less than the front toes do. */
const HALLUX_CURL_SHARE = 0.6;
/** How much of the head-on fan a fully curled foot draws in. */
const CURLED_FAN_CLOSE = 0.5;
const TOE_ROOT_WIDTH_SHARE = 0.62;
const TOE_TIP_WIDTH_SHARE = 0.22;
/** How much wider than a toe's tip its dark claw is drawn. */
const CLAW_SCALE = 1.4;

/**
 * The foot: three front toes and a hind toe spread from the ball, each tipped
 * with a dark claw, lying along the floor when planted and curling under as
 * the foot swings. Edge-on the toes run ahead along the ground; head-on they
 * fan toward the camera; from behind the hind toe points back at it.
 */
function paintFoot(
  ctx: Ctx,
  chain: LegChain,
  metaW: number,
  view: SkyfowlView,
  skin: { readonly dark: string; readonly mid: string },
): void {
  const curl = clamp01(chain.toeCurl);
  const lengthShare = lerp(1, TOE_CURL_LENGTH_SHARE, curl);
  const toes: { readonly angle: number; readonly length: number }[] = [];
  if (view === 'side') {
    const down = curl * TOE_CURL_TURN;
    toes.push({
      angle: -PROFILE_FAR_TOE_RISE + down,
      length: FRONT_TOE_LENGTH * PROFILE_FAR_TOE_SHARE,
    });
    toes.push({ angle: down, length: FRONT_TOE_LENGTH });
    toes.push({ angle: Math.PI - down * HALLUX_CURL_SHARE, length: HALLUX_LENGTH });
  } else if (view === 'down') {
    const length = FRONT_TOE_LENGTH * HEAD_ON_TOE_FORESHORTEN;
    for (const sign of [-1, 0, 1]) {
      toes.push({
        angle: HALF_PI + sign * HEAD_ON_TOE_FAN * (1 - curl * CURLED_FAN_CLOSE),
        length,
      });
    }
  } else {
    toes.push({ angle: HALF_PI, length: HALLUX_LENGTH });
    for (const sign of [-1, 1]) {
      toes.push({
        angle: -HALF_PI + sign * BACK_VIEW_TOE_PEEK,
        length: FRONT_TOE_LENGTH * HEAD_ON_TOE_FORESHORTEN,
      });
    }
  }
  const toeW = metaW * TOE_ROOT_WIDTH_SHARE;
  const tipW = metaW * TOE_TIP_WIDTH_SHARE;
  const tips = toes.map(({ angle, length }) =>
    offset(
      chain.toe,
      Math.cos(angle) * length * lengthShare,
      Math.sin(angle) * length * lengthShare,
    ),
  );
  for (const tip of tips) outlineCapsule(ctx, chain.toe, tip, toeW, tipW);
  for (const tip of tips) fillCapsule(ctx, chain.toe, tip, toeW, tipW, skin.mid);
  for (const tip of tips) {
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, tipW * CLAW_SCALE, 0, TWO_PI);
    ctx.fillStyle = TALON;
    ctx.fill();
  }
}

function paintWing(
  ctx: Ctx,
  chain: WingChain,
  ramp: PlumagePattern,
  shade: number,
  wing: SkyfowlWingPose,
): void {
  const upperW = UPPER_WING_WIDTH * chain.widthScale;
  const foreW = FOREWING_WIDTH * chain.widthScale;
  const handW = HAND_WIDTH * chain.widthScale;
  const body = mixRamp(ramp.body, shade);
  outlineCapsule(ctx, chain.shoulder, chain.elbow, upperW, foreW);
  outlineCapsule(ctx, chain.elbow, chain.hand, foreW, handW);
  fillCapsule(ctx, chain.shoulder, chain.elbow, upperW, foreW, body.mid);
  // Primaries: the outer wing feathers run darker than the covert feathers at
  // the shoulder — one of the plumage cues that survives a folded wing at 32px.
  fillCapsule(ctx, chain.elbow, chain.hand, foreW, handW, ramp.marking.dark);
  sheenSegment(ctx, chain.shoulder, chain.elbow, upperW, body.light, 0.24);
  shadeSegment(ctx, chain.shoulder, chain.elbow, upperW, body.dark, 0.3);
  shadeSegment(ctx, chain.elbow, chain.hand, foreW, ramp.marking.dark, 0.35);
  const flare = clamp01(wing.flare ?? 0);
  if (flare > 0) paintFlightFeathers(ctx, chain, flare, ramp);
  paintFeatherFingers(ctx, chain.hand, chain.elbow, handW, wing.handOpen, ramp.marking.dark);
}

/** How much longer than the hand the fanned primaries reach at a full flare, rig units. */
const FLARE_PRIMARY_LENGTH = 0.27;
const FLARE_PRIMARY_COUNT = 5;
/** Half the fan's angle at a full flare, radians. */
const FLARE_FAN_HALF_ANGLE = 0.55;
const FLARE_PRIMARY_ROOT_WIDTH = 0.034;
const FLARE_PRIMARY_TIP_WIDTH = 0.012;
/** The fan leans back off the wing's line, the way flight feathers trail the leading edge. */
const FLARE_TRAIL_ANGLE = 0.25;
/** The fan's outermost feathers are this much shorter than its middle one: a rounded wingtip. */
const FLARE_OUTER_SHORTEN = 0.5;
const FLARE_SHEEN_ALPHA = 0.3;

/**
 * A flung-open wing: the long flight feathers fan out past the hand, each a
 * tapered quill in the wing's dark primary colour with a paler edge — the
 * skyfowl's hands-in-the-air, reaching as far over its head as a human's arm
 * does over his.
 */
function paintFlightFeathers(
  ctx: Ctx,
  chain: WingChain,
  flare: number,
  ramp: PlumagePattern,
): void {
  const dir = angleBetween(chain.elbow, chain.hand);
  const trailSide = Math.sign(chain.hand.x - chain.shoulder.x) || 1;
  const length = FLARE_PRIMARY_LENGTH * flare * chain.widthScale;
  const tips: Pt[] = [];
  for (let i = 0; i < FLARE_PRIMARY_COUNT; i++) {
    const share = i / (FLARE_PRIMARY_COUNT - 1) - MIDPOINT;
    const angle =
      dir + share * 2 * FLARE_FAN_HALF_ANGLE * flare + trailSide * FLARE_TRAIL_ANGLE * flare;
    const reach = length * (1 - Math.abs(share) * FLARE_OUTER_SHORTEN);
    tips.push(offset(chain.hand, Math.cos(angle) * reach, Math.sin(angle) * reach));
  }
  const rootW = FLARE_PRIMARY_ROOT_WIDTH * chain.widthScale;
  const tipW = FLARE_PRIMARY_TIP_WIDTH * chain.widthScale;
  for (const tip of tips) outlineCapsule(ctx, chain.hand, tip, rootW, tipW);
  for (const tip of tips) fillCapsule(ctx, chain.hand, tip, rootW, tipW, ramp.marking.dark);
  for (const tip of tips) {
    sheenSegment(ctx, chain.hand, tip, rootW, ramp.body.light, FLARE_SHEEN_ALPHA);
  }
}

/** The wing's wrist doubles as a hand: three feathered fingers fan from it. */
function paintFeatherFingers(
  ctx: Ctx,
  hand: Pt,
  elbow: Pt,
  handW: number,
  handOpen: number,
  colour: string,
): void {
  const dir = angleBetween(elbow, hand);
  const fingerLength = HAND_LENGTH * (1.05 + handOpen * 0.4);
  const spread = 0.2 + handOpen * 0.42;
  for (const sign of [-1, 0, 1]) {
    const tip = offset(
      hand,
      Math.cos(dir + spread * sign) * fingerLength,
      Math.sin(dir + spread * sign) * fingerLength,
    );
    outlineCapsule(ctx, hand, tip, handW * 0.32, handW * 0.05);
    fillCapsule(ctx, hand, tip, handW * 0.32, handW * 0.05, colour);
  }
}

interface RampShade {
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
}

function mixRamp(ramp: RampShade, shade: number): RampShade {
  if (shade <= 0) return ramp;
  return { dark: ramp.dark, mid: ramp.dark, light: ramp.mid };
}

function paintTorso(
  ctx: Ctx,
  pose: SkyfowlPose,
  ramp: PlumagePattern,
  build: SkyfowlBuildSpec,
  lateral: number,
): void {
  const hipW = HIP_HALF_WIDTH * build.bodyWidth;
  const chestW = CHEST_HALF_WIDTH * build.bodyWidth;
  const shoulderW = SHOULDER_HALF_WIDTH * build.bodyWidth;
  const hip = pt(0, HIP_Y);
  const waist = pt(0, WAIST_Y);
  const chest = pt(build.stoop * 0.4, CHEST_Y);
  const shoulder = pt(build.stoop * 0.6, SHOULDER_Y);
  const traceTorso = (): void => {
    ctx.beginPath();
    ctx.moveTo(hip.x - hipW, hip.y);
    ctx.quadraticCurveTo(waist.x - chestW * 1.05, waist.y, chest.x - chestW, chest.y);
    ctx.quadraticCurveTo(shoulder.x - shoulderW, shoulder.y, shoulder.x, shoulder.y - 0.03);
    ctx.quadraticCurveTo(shoulder.x + shoulderW, shoulder.y, chest.x + chestW, chest.y);
    ctx.quadraticCurveTo(waist.x + chestW * 1.05, waist.y, hip.x + hipW, hip.y);
    ctx.quadraticCurveTo(hip.x, hip.y + 0.08, hip.x - hipW, hip.y);
    ctx.closePath();
  };
  fillOutlined(ctx, traceTorso, ramp.body.mid, BODY_OUTLINE_WIDTH);
  // Form shading: a soft shadow lower-right and a soft highlight upper-left,
  // clipped to the torso's own silhouette so the terminator follows the body
  // instead of ringing out from a shape's centre.
  ctx.save();
  traceTorso();
  ctx.clip();
  fillSoftEllipse(
    ctx,
    shoulder.x + shoulderW * 0.4,
    (shoulder.y + hip.y) / 2 + 0.05,
    shoulderW * 1.1,
    Math.abs(hip.y - shoulder.y) * 0.65,
    ramp.body.dark,
    0.32,
  );
  fillSoftEllipse(
    ctx,
    chest.x - chestW * 0.5,
    chest.y - 0.05,
    chestW * 0.8,
    Math.abs(chest.y - shoulder.y) * 1.4,
    ramp.body.light,
    0.28,
  );
  ctx.restore();
  // Countershaded breast: birds carry a paler keel than their back.
  ctx.save();
  ctx.globalAlpha = 0.85;
  fillCapsule(
    ctx,
    offset(waist, 0, 0.02),
    offset(chest, 0, -0.02),
    chestW * 0.62,
    chestW * 0.5,
    ramp.breast.mid,
  );
  ctx.restore();
  paintMarking(ctx, ramp, chestW, hip, chest, lateral);
  if (build.fluffy) paintDownFluff(ctx, ramp, chestW, hip, chest, lateral);
}

/** A scatter of pale down-tufts over the plumage — the fledgling's own texture, never an adult's. */
function paintDownFluff(
  ctx: Ctx,
  ramp: PlumagePattern,
  chestW: number,
  hip: Pt,
  chest: Pt,
  lateral: number,
): void {
  let seed = 41;
  const next = (): number => {
    seed = (seed * 1103515245 + 12345) % 2147483648;
    return seed / 2147483648;
  };
  ctx.save();
  ctx.globalAlpha = 0.55;
  ctx.fillStyle = ramp.breast.light;
  for (let i = 0; i < 14; i++) {
    const x = (next() * 2 - 1) * chestW * 0.85 * lateral;
    const y = hip.y + (chest.y - hip.y) * next();
    ctx.beginPath();
    ctx.arc(x, y, 0.016, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

function paintMarking(
  ctx: Ctx,
  ramp: PlumagePattern,
  chestW: number,
  hip: Pt,
  chest: Pt,
  lateral: number,
): void {
  if (ramp.markingStrength <= 0) return;
  ctx.save();
  ctx.globalAlpha = Math.max(MIN_VISIBLE_ALPHA, ramp.markingStrength * 0.6);
  if (ramp.markingStyle === 'barring') {
    const bars = 3;
    for (let i = 0; i < bars; i++) {
      const t = (i + 0.5) / bars;
      const y = hip.y + (chest.y - hip.y) * t;
      fillCapsule(
        ctx,
        pt(-chestW * 0.7 * lateral, y),
        pt(chestW * 0.7 * lateral, y),
        0.02,
        0.02,
        ramp.marking.mid,
      );
    }
  } else {
    let seed = 17;
    const next = (): number => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    for (let i = 0; i < 10; i++) {
      const x = (next() * 2 - 1) * chestW * 0.8 * lateral;
      const y = hip.y + (chest.y - hip.y) * next();
      ctx.beginPath();
      ctx.arc(x, y, 0.012, 0, Math.PI * 2);
      ctx.fillStyle = ramp.marking.mid;
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * The head, foreshortened and turned for the down view. A hawk-like beak
 * pointed straight at the camera reads as a flat triangle — the trap this
 * function exists to avoid. Instead the skull is drawn slightly tilted, and
 * the beak is a short, angled wedge that recedes toward its hooked tip rather
 * than lying flat across the face.
 */
function drawHeadDown(
  ctx: Ctx,
  pose: SkyfowlPose,
  ramp: PlumagePattern,
  build: SkyfowlBuildSpec,
): void {
  const cx = pose.headTurn * 0.05;
  const cy = HEAD_CENTRE_Y;
  const hw = HEAD_HALF_WIDTH * build.headScale;
  const hh = HEAD_HALF_HEIGHT * build.headScale;
  fillOutlined(
    ctx,
    () => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, hw, hh, 0, 0, Math.PI * 2);
    },
    ramp.body.mid,
    DETAIL_OUTLINE_WIDTH,
  );
  paintHeadShading(ctx, cx, cy, hw, hh, ramp);
  // Crest: three short feather tufts breaking the skull's round top.
  ctx.save();
  ctx.strokeStyle = ramp.body.dark;
  ctx.lineWidth = DETAIL_OUTLINE_WIDTH * 0.8;
  for (const dx of [-0.045, 0, 0.045]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx, cy - hh * 0.85);
    ctx.lineTo(cx + dx * 1.3, cy - hh - CREST_HEIGHT * build.headScale);
    ctx.stroke();
  }
  ctx.restore();
  // Beak: short and deep-based like the side view's, angled down and slightly
  // to the turn side so it reads as receding rather than a flat triangle.
  const beakLen = BEAK_LENGTH * build.headScale * 0.58;
  const baseW = BEAK_BASE_HALF_WIDTH * build.headScale * 1.5;
  const tipX = cx + pose.headTurn * 0.1;
  const tipY = cy + hh * 0.5 + beakLen;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(cx - baseW, cy + hh * 0.25);
  ctx.lineTo(cx + baseW, cy + hh * 0.25);
  ctx.quadraticCurveTo(tipX + baseW * 0.3, cy + hh * 0.45 + beakLen * 0.5, tipX, tipY);
  ctx.quadraticCurveTo(
    tipX - baseW * 0.3,
    cy + hh * 0.45 + beakLen * 0.5,
    cx - baseW,
    cy + hh * 0.25,
  );
  ctx.closePath();
  ctx.strokeStyle = '#160f0a';
  ctx.lineWidth = DETAIL_OUTLINE_WIDTH * 1.3;
  ctx.stroke();
  ctx.fillStyle = BEAK.light;
  ctx.fill();
  ctx.restore();
  // Hooked tip: a small dark cap, offset downward, so the beak's curve is legible.
  ctx.beginPath();
  ctx.arc(tipX, tipY + BEAK_HOOK_DROP * build.headScale * 0.9, baseW * 0.55, 0, Math.PI * 2);
  ctx.fillStyle = BEAK.dark;
  ctx.fill();
  ctx.fillStyle = CERE;
  ctx.beginPath();
  ctx.ellipse(cx, cy + hh * 0.25, baseW * 0.6, baseW * 0.32, 0, 0, Math.PI * 2);
  ctx.fill();
  // Brow ridge over each eye, and the malar stripe / throat bib the side view carries.
  ctx.save();
  ctx.strokeStyle = ramp.body.dark;
  ctx.lineWidth = DETAIL_OUTLINE_WIDTH * 1.6;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * hw * 0.3, cy - hh * 0.42);
    ctx.quadraticCurveTo(
      cx + side * hw * 0.62,
      cy - hh * 0.5,
      cx + side * hw * 0.78,
      cy - hh * 0.25,
    );
    ctx.stroke();
  }
  ctx.restore();
  drawEyes(ctx, cx, cy, hw, hh);
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = ramp.marking.dark;
  ctx.lineWidth = hh * 0.14;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * hw * 0.5, cy + hh * 0.05);
    ctx.lineTo(cx + side * hw * 0.35, cy + hh * 0.5);
    ctx.stroke();
  }
  ctx.restore();
  ctx.fillStyle = ramp.breast.light;
  ctx.beginPath();
  ctx.ellipse(cx, cy + hh * 0.9, hw * 0.35, hh * 0.24, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** Soft shadow lower-right and highlight upper-left, clipped to the skull's own ellipse. */
function paintHeadShading(
  ctx: Ctx,
  cx: number,
  cy: number,
  hw: number,
  hh: number,
  ramp: PlumagePattern,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, hw, hh, 0, 0, Math.PI * 2);
  ctx.clip();
  fillSoftEllipse(ctx, cx + hw * 0.35, cy + hh * 0.3, hw * 0.9, hh * 0.9, ramp.body.dark, 0.3);
  fillSoftEllipse(ctx, cx - hw * 0.4, cy - hh * 0.4, hw * 0.75, hh * 0.75, ramp.body.light, 0.3);
  ctx.restore();
}

function drawEyes(ctx: Ctx, cx: number, cy: number, hw: number, hh: number): void {
  for (const side of [-1, 1]) {
    const ex = cx + side * hw * 0.55;
    const ey = cy - hh * 0.1;
    ctx.beginPath();
    ctx.arc(ex, ey, hh * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = EYE_IRIS;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex, ey, hh * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = EYE_PUPIL;
    ctx.fill();
  }
}

/** The profile head: full beak length shown edge-on, the view a hooked beak reads best in. */
function drawHeadSide(
  ctx: Ctx,
  pose: SkyfowlPose,
  ramp: PlumagePattern,
  build: SkyfowlBuildSpec,
  facing: number,
): void {
  const cx = pose.headTurn * 0.03;
  const cy = HEAD_CENTRE_Y + pose.headTilt * 0.03;
  const hw = HEAD_HALF_WIDTH * build.headScale * 0.92;
  const hh = HEAD_HALF_HEIGHT * build.headScale;
  fillOutlined(
    ctx,
    () => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, hw, hh, 0, 0, Math.PI * 2);
    },
    ramp.body.mid,
    DETAIL_OUTLINE_WIDTH,
  );
  paintHeadShading(ctx, cx, cy, hw, hh, ramp);
  ctx.save();
  ctx.strokeStyle = ramp.body.dark;
  ctx.lineWidth = DETAIL_OUTLINE_WIDTH * 0.8;
  for (const t of [0.1, 0.4, 0.7]) {
    ctx.beginPath();
    ctx.moveTo(cx - facing * hw * (0.1 + t * 0.15), cy - hh * 0.9);
    ctx.lineTo(
      cx - facing * hw * (0.25 + t * 0.2),
      cy - hh - CREST_HEIGHT * build.headScale * (1 - t * 0.4),
    );
    ctx.stroke();
  }
  ctx.restore();
  // A hawk beak is short and deep at the base with a sharply hooked tip and a
  // notch just behind it — never a long tube of near-parallel edges, which is
  // what reads as a duck bill at 32px.
  const beakLen = BEAK_LENGTH * build.headScale * 0.62;
  const baseW = BEAK_BASE_HALF_WIDTH * build.headScale;
  const baseX = cx + facing * hw * 0.88;
  const baseTop = cy - hh * 0.12;
  const baseBottom = cy + hh * 0.42;
  const culminMidX = baseX + facing * beakLen * 0.55;
  const hookTipX = baseX + facing * beakLen;
  const hookTipY = cy + hh * 0.02 + BEAK_HOOK_DROP * build.headScale * 1.5;
  const notchX = hookTipX - facing * beakLen * 0.16;
  const notchY = cy + hh * 0.08;
  const lowerMidX = baseX + facing * beakLen * 0.3;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(baseX, baseTop);
  ctx.quadraticCurveTo(culminMidX, cy - hh * 0.14, hookTipX, hookTipY);
  ctx.lineTo(notchX, notchY);
  ctx.quadraticCurveTo(lowerMidX, cy + hh * 0.3, baseX, baseBottom);
  ctx.closePath();
  ctx.strokeStyle = '#160f0a';
  ctx.lineWidth = DETAIL_OUTLINE_WIDTH * 1.2;
  ctx.stroke();
  ctx.fillStyle = BEAK.mid;
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = CERE;
  ctx.beginPath();
  ctx.ellipse(
    baseX + facing * 0.015,
    baseTop + hh * 0.1,
    baseW * 0.55,
    baseW * 0.3,
    0,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  // Brow ridge: a heavy dark arc over the eye, the raptor's characteristic glare.
  ctx.save();
  ctx.strokeStyle = ramp.body.dark;
  ctx.lineWidth = DETAIL_OUTLINE_WIDTH * 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + facing * hw * 0.05, cy - hh * 0.42);
  ctx.quadraticCurveTo(
    cx + facing * hw * 0.4,
    cy - hh * 0.5,
    cx + facing * hw * 0.62,
    cy - hh * 0.3,
  );
  ctx.stroke();
  ctx.restore();
  const ex = cx + facing * hw * 0.35;
  const ey = cy - hh * 0.08;
  ctx.beginPath();
  ctx.arc(ex, ey, hh * 0.22, 0, Math.PI * 2);
  ctx.fillStyle = EYE_IRIS;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(ex + facing * hh * 0.06, ey, hh * 0.1, 0, Math.PI * 2);
  ctx.fillStyle = EYE_PUPIL;
  ctx.fill();
  // Malar stripe: a dark mark dropping from under the eye toward the beak, and
  // a pale throat bib below it — the two plumage cues that make a raptor's
  // face read as a face rather than a flat mask.
  ctx.save();
  ctx.globalAlpha = 0.85;
  ctx.strokeStyle = ramp.marking.dark;
  ctx.lineWidth = hh * 0.16;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + facing * hw * 0.3, cy + hh * 0.1);
  ctx.lineTo(cx + facing * hw * 0.55, cy + hh * 0.55);
  ctx.stroke();
  ctx.restore();
  ctx.fillStyle = ramp.breast.light;
  ctx.beginPath();
  ctx.ellipse(cx - facing * hw * 0.05, cy + hh * 0.85, hw * 0.4, hh * 0.28, 0, 0, Math.PI * 2);
  ctx.fill();
}

/** The back of the head: crest and the nape's plumage, no beak or eyes. */
function drawHeadUp(
  ctx: Ctx,
  pose: SkyfowlPose,
  ramp: PlumagePattern,
  build: SkyfowlBuildSpec,
): void {
  const cx = pose.headTurn * 0.02;
  const cy = HEAD_CENTRE_Y;
  const hw = HEAD_HALF_WIDTH * build.headScale;
  const hh = HEAD_HALF_HEIGHT * build.headScale;
  fillOutlined(
    ctx,
    () => {
      ctx.beginPath();
      ctx.ellipse(cx, cy, hw, hh, 0, 0, Math.PI * 2);
    },
    ramp.body.dark,
    DETAIL_OUTLINE_WIDTH,
  );
  paintHeadShading(ctx, cx, cy, hw, hh, ramp);
  ctx.save();
  ctx.strokeStyle = ramp.body.mid;
  ctx.lineWidth = DETAIL_OUTLINE_WIDTH;
  for (const dx of [-0.05, 0, 0.05]) {
    ctx.beginPath();
    ctx.moveTo(cx + dx, cy - hh * 0.8);
    ctx.lineTo(cx + dx * 1.4, cy - hh - CREST_HEIGHT * build.headScale * 1.1);
    ctx.stroke();
  }
  ctx.restore();
  // Nape feather ticks fan down the back of the skull, so the back of the
  // head reads as plumage rather than a flat, featureless disc.
  ctx.save();
  ctx.strokeStyle = ramp.marking.dark;
  ctx.globalAlpha = 0.7;
  ctx.lineWidth = DETAIL_OUTLINE_WIDTH * 0.9;
  ctx.lineCap = 'round';
  for (let i = -2; i <= 2; i++) {
    const t = i / 2;
    ctx.beginPath();
    ctx.moveTo(cx + t * hw * 0.55, cy - hh * 0.3);
    ctx.lineTo(cx + t * hw * 0.7, cy + hh * 0.55);
    ctx.stroke();
  }
  ctx.restore();
}

function paintTailFeathers(ctx: Ctx, ramp: PlumagePattern, build: SkyfowlBuildSpec): void {
  const base = pt(0, HIP_Y + 0.04);
  const spread = 0.14 * build.bodyWidth;
  const length = 0.22;
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(base.x - spread, base.y);
  traceFeatherEdge(ctx, base, pt(base.x, base.y + length), 0.05, 3, 0.02, 1);
  ctx.lineTo(base.x + spread, base.y);
  ctx.closePath();
  ctx.strokeStyle = '#160f0a';
  ctx.lineWidth = DETAIL_OUTLINE_WIDTH;
  ctx.stroke();
  ctx.fillStyle = ramp.body.dark;
  ctx.fill();
  ctx.restore();
}

function paintContactShadow(ctx: Ctx, near: LegChain, far: LegChain): void {
  const cx = (near.ground.x + far.ground.x) / 2;
  const cy = (near.ground.y + far.ground.y) / 2;
  const width = Math.abs(near.ground.x - far.ground.x) + CONTACT_SHADOW_PAD;
  ctx.save();
  ctx.globalAlpha = CONTACT_SHADOW_ALPHA * 0.5;
  ctx.beginPath();
  ctx.ellipse(cx, cy + CONTACT_SHADOW_DROP, width / 2, CONTACT_SHADOW_HALF_HEIGHT, 0, 0, TWO_PI);
  ctx.fillStyle = '#000000';
  ctx.fill();
  ctx.restore();
}

const CONTACT_SHADOW_PAD = 0.22;
const CONTACT_SHADOW_DROP = 0.01;
const CONTACT_SHADOW_HALF_HEIGHT = 0.045;

function paintRim(ctx: Ctx, chest: Pt, chestW: number): void {
  ctx.save();
  ctx.globalAlpha = RIM_ALPHA;
  ctx.strokeStyle = RIM_LIGHT;
  ctx.lineWidth = RIM_WIDTH;
  ctx.beginPath();
  ctx.moveTo(chest.x - chestW, chest.y);
  ctx.lineTo(chest.x - chestW * 1.1, chest.y - 0.15);
  ctx.stroke();
  ctx.restore();
}

// ── View entry points ───────────────────────────────────────────────────────

function buildOf(outfit: SkyfowlOutfit): SkyfowlBuildSpec {
  return SKYFOWL_BUILDS[outfit.build];
}

/**
 * Paints `paintBody` riding the hip: moved to where the pose puts the hip,
 * then pitched about it. Profile pitches in the picture plane; head-on and
 * from behind the pitch is toward or away from the camera, so it shows as the
 * body shortening onto the hip instead, and the sideways `tilt` is the
 * in-plane angle.
 */
function withBody(
  ctx: Ctx,
  view: SkyfowlView,
  pose: SkyfowlPose,
  hipHeight: number,
  paintBody: () => void,
): void {
  ctx.save();
  ctx.translate(pose.sway, GROUND_Y - hipHeight);
  if (view === 'side') {
    ctx.rotate(pose.lean);
  } else {
    ctx.rotate(pose.tilt);
    ctx.scale(1, Math.cos(pose.lean));
  }
  ctx.translate(0, -HIP_Y);
  paintBody();
  ctx.restore();
}

function paintLegGarments(
  ctx: Ctx,
  outfit: SkyfowlOutfit,
  pose: SkyfowlPose,
  build: SkyfowlBuildSpec,
  near: LegChain,
  far: LegChain,
): void {
  for (const layer of outfit.garments) layer.leg?.(ctx, pose, build, near, true);
  for (const layer of outfit.garments) layer.leg?.(ctx, pose, build, far, false);
}

/** Paints `paintHead` offset from the shoulders by the pose's head carriage. */
function withHead(ctx: Ctx, view: SkyfowlView, pose: SkyfowlPose, paintHead: () => void): void {
  ctx.save();
  ctx.translate(view === 'side' ? pose.headAhead : 0, pose.headDrop);
  paintHead();
  ctx.restore();
}

/** Both legs solved and drawn into a head-on or from-behind view, hips `hipStance` either side of the centreline. */
function headOnLegs(
  pose: SkyfowlPose,
  build: SkyfowlBuildSpec,
  view: SkyfowlView,
  hipHeight: number,
): { near: LegChain; far: LegChain } {
  const hipStance = HIP_HALF_WIDTH * build.bodyWidth * HEAD_ON_HIP_STANCE_SHARE;
  const near = projectLeg(
    solveGaitChain(hipHeight, pose.nearLeg),
    pose.nearLeg,
    view,
    pose.sway - hipStance,
    build,
  );
  const far = projectLeg(
    solveGaitChain(hipHeight, pose.farLeg),
    pose.farLeg,
    view,
    pose.sway + hipStance,
    build,
  );
  return { near, far };
}

/**
 * Legs converge toward the centreline rather than framing the torso like
 * chair legs: the hips sit well inside the torso's own width.
 */
const HEAD_ON_HIP_STANCE_SHARE = 0.4;

export function drawSkyfowlDown(ctx: Ctx, pose: SkyfowlPose, outfit: SkyfowlOutfit): void {
  const build = buildOf(outfit);
  const ramp = outfit.plumage;
  const view = VIEWS.down;
  const hipHeight = hipHeightOf(pose, build);
  // Both legs are painted in full *before* the torso and its garment, so the
  // thigh — the part that would otherwise read as a strut outside the body's
  // own outline — sits behind the torso/garment silhouette and only the
  // shank, tarsus and foot, which extend below it, stay visible.
  const { near, far } = headOnLegs(pose, build, 'down', hipHeight);
  paintContactShadow(ctx, near, far);
  paintLeg(ctx, far, ramp, 0.3, 'down');
  paintLeg(ctx, near, ramp, 0, 'down');
  withBody(ctx, 'down', pose, hipHeight, () => {
    paintTorso(ctx, pose, ramp, build, view.lateral);
    for (const layer of outfit.garments) layer.torso?.(ctx, pose, build, view.lateral, 'down');
  });
  // Leg garments are laid on the legs' own chains, which are solved in ground
  // space rather than on the body the hip carries.
  paintLegGarments(ctx, outfit, pose, build, near, far);
  withBody(ctx, 'down', pose, hipHeight, () => {
    const shoulderStance = SHOULDER_HALF_WIDTH * build.bodyWidth * view.lateral;
    const farWing = solveWing(pt(shoulderStance, SHOULDER_Y), pose.farWing, build, 1, view.lateral);
    const nearWing = solveWing(
      pt(-shoulderStance, SHOULDER_Y),
      pose.nearWing,
      build,
      -1,
      view.lateral,
    );
    paintWing(ctx, farWing, ramp, 0.3, pose.farWing);
    withHead(ctx, 'down', pose, () => {
      drawHeadDown(ctx, pose, ramp, build);
      for (const layer of outfit.garments) layer.head?.(ctx, pose, build);
    });
    paintWing(ctx, nearWing, ramp, 0, pose.nearWing);
    if (outfit.heldProp !== undefined) outfit.heldProp.draw(ctx, nearWing.hand, 'down');
    for (const layer of outfit.garments) layer.front?.(ctx, pose, build);
    paintRim(ctx, pt(0, CHEST_Y), CHEST_HALF_WIDTH * build.bodyWidth);
  });
}

/**
 * Profile: the far leg is drawn this far behind the near one, and the far
 * wing the same, so the two don't merge into a single dark mass that
 * swallows the torso between them — the "floating head, no body" failure a
 * too-thin, too-dark profile silhouette reads as.
 */
const PROFILE_FAR_DEPTH = 0.1;
const PROFILE_FAR_WING_ALPHA = 0.7;
/** Profile: how much of a wing's sideways spread still shows as it reaches toward or away from the camera. */
const PROFILE_WING_LATERAL = 0.4;

export function drawSkyfowlSide(ctx: Ctx, pose: SkyfowlPose, outfit: SkyfowlOutfit): void {
  const build = buildOf(outfit);
  const ramp = outfit.plumage;
  const facing = 1;
  const hipHeight = hipHeightOf(pose, build);
  const near = projectLeg(
    solveGaitChain(hipHeight, pose.nearLeg),
    pose.nearLeg,
    'side',
    pose.sway,
    build,
  );
  const far = projectLeg(
    solveGaitChain(hipHeight, pose.farLeg),
    pose.farLeg,
    'side',
    pose.sway - PROFILE_FAR_DEPTH,
    build,
  );
  paintContactShadow(ctx, near, far);
  // Both legs go under the torso and its garment, as head-on: a bird's thigh
  // is tucked into its body feathers, so only the bare leg below the hem
  // shows. Painted over the body, the near thigh reads as a strut strapped
  // across the front of the clothes.
  paintLeg(ctx, far, ramp, 0.35, 'side');
  paintLeg(ctx, near, ramp, 0, 'side');
  withBody(ctx, 'side', pose, hipHeight, () => {
    paintTailFeathers(ctx, ramp, build);
    // The torso is widened here only, about its own centreline: a profile's
    // chest-to-back depth is not the same number as its frontal width, and
    // drawing the frontal torso shape unscaled in profile reads as a too-thin
    // vertical strip beneath a proportionally much wider head.
    ctx.save();
    ctx.scale(SIDE_TORSO_WIDTH_BOOST, 1);
    paintTorso(ctx, pose, ramp, build, 0.6);
    for (const layer of outfit.garments) layer.torso?.(ctx, pose, build, 0.6, 'side');
    ctx.restore();
  });
  paintLegGarments(ctx, outfit, pose, build, near, far);
  withBody(ctx, 'side', pose, hipHeight, () => {
    const farWing = solveWing(
      pt(-PROFILE_FAR_DEPTH, SHOULDER_Y),
      pose.farWing,
      build,
      facing,
      PROFILE_WING_LATERAL,
    );
    const nearWing = solveWing(
      pt(0, SHOULDER_Y),
      pose.nearWing,
      build,
      facing,
      PROFILE_WING_LATERAL,
    );
    ctx.save();
    ctx.globalAlpha *= PROFILE_FAR_WING_ALPHA;
    paintWing(ctx, farWing, ramp, 0.5, pose.farWing);
    ctx.restore();
    withHead(ctx, 'side', pose, () => {
      drawHeadSide(ctx, pose, ramp, build, facing);
      for (const layer of outfit.garments) layer.head?.(ctx, pose, build);
    });
    paintWing(ctx, nearWing, ramp, 0, pose.nearWing);
    if (outfit.heldProp !== undefined) outfit.heldProp.draw(ctx, nearWing.hand, 'side');
    for (const layer of outfit.garments) layer.front?.(ctx, pose, build);
    paintRim(ctx, pt(0, CHEST_Y), CHEST_HALF_WIDTH * build.bodyWidth);
  });
}

export function drawSkyfowlUp(ctx: Ctx, pose: SkyfowlPose, outfit: SkyfowlOutfit): void {
  const build = buildOf(outfit);
  const ramp = outfit.plumage;
  const view = VIEWS.up;
  const hipHeight = hipHeightOf(pose, build);
  const { near, far } = headOnLegs(pose, build, 'up', hipHeight);
  paintContactShadow(ctx, near, far);
  const shoulderStance = SHOULDER_HALF_WIDTH * build.bodyWidth;
  const farWing = solveWing(pt(shoulderStance, SHOULDER_Y), pose.farWing, build, 1, view.lateral);
  const nearWing = solveWing(
    pt(-shoulderStance, SHOULDER_Y),
    pose.nearWing,
    build,
    -1,
    view.lateral,
  );
  withBody(ctx, 'up', pose, hipHeight, () => {
    paintWing(ctx, farWing, ramp, 0.15, pose.farWing);
    paintWing(ctx, nearWing, ramp, 0.15, pose.nearWing);
  });
  paintLeg(ctx, far, ramp, 0.15, 'up');
  paintLeg(ctx, near, ramp, 0.05, 'up');
  withBody(ctx, 'up', pose, hipHeight, () => {
    paintTailFeathers(ctx, ramp, build);
    paintTorso(ctx, pose, ramp, build, 1);
    for (const layer of outfit.garments) layer.torso?.(ctx, pose, build, 1, 'up');
  });
  paintLegGarments(ctx, outfit, pose, build, near, far);
  withBody(ctx, 'up', pose, hipHeight, () => {
    withHead(ctx, 'up', pose, () => {
      drawHeadUp(ctx, pose, ramp, build);
      for (const layer of outfit.garments) layer.head?.(ctx, pose, build);
    });
    // No `front` pass here: every current front-slot detail (a pouch, a tabard
    // seam, a cloak's front trim) belongs on the side of the body a player
    // never sees from behind.
  });
}

/** Where each foot's ball is drawn for a pose in a view, in figure units — what a foot-lock gate reads. */
export interface SkyfowlFeetProbe {
  readonly near: Pt;
  readonly far: Pt;
}

/**
 * The balls of both feet as the painter places them, from the same solve and
 * projection it paints with, so a gate measuring foot travel measures the
 * drawn foot rather than a copy of the arithmetic.
 */
export function probeSkyfowlFeet(
  view: SkyfowlView,
  pose: SkyfowlPose,
  build: SkyfowlBuild,
): SkyfowlFeetProbe {
  const spec = SKYFOWL_BUILDS[build];
  const hipHeight = hipHeightOf(pose, spec);
  if (view === 'side') {
    const near = projectLeg(
      solveGaitChain(hipHeight, pose.nearLeg),
      pose.nearLeg,
      'side',
      pose.sway,
      spec,
    );
    const far = projectLeg(
      solveGaitChain(hipHeight, pose.farLeg),
      pose.farLeg,
      'side',
      pose.sway - PROFILE_FAR_DEPTH,
      spec,
    );
    return { near: near.toe, far: far.toe };
  }
  const { near, far } = headOnLegs(pose, spec, view, hipHeight);
  return { near: near.toe, far: far.toe };
}

export function drawSkyfowl(
  ctx: Ctx,
  view: SkyfowlView,
  pose: SkyfowlPose,
  outfit: SkyfowlOutfit,
): void {
  if (view === 'down') drawSkyfowlDown(ctx, pose, outfit);
  else if (view === 'side') drawSkyfowlSide(ctx, pose, outfit);
  else drawSkyfowlUp(ctx, pose, outfit);
}

// Re-export so downstream modules (rows.ts, gates) need one import surface.
export type { SkyfowlBuild };
export { rotate, mixPt, angleBetween };
