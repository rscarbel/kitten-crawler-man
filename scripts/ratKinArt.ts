/**
 * The Rat Kin — Mordecai's rodent form, the safe-room changeling who paces his
 * room and gives the player advice.
 *
 * A Rat Kin is *not* a rat. He stands and walks on two legs, wears clothes and
 * gestures with his hands, so he is built on the same rig every other bipedal
 * figure in this repo uses. What makes him read as a rodent rather than as a
 * furry human is three things, in descending order of how much they matter at a
 * 32px tile:
 *
 *   1. A **digitigrade** leg. The hock — what reads as a backward-bending knee —
 *      is the strongest rodent cue in the silhouette, and it is why this module
 *      solves a three-segment leg where `carlArt.ts` solves two.
 *   2. A long **tail** counterbalancing behind him, the one part of the outline
 *      that is unambiguously not human.
 *   3. A long **muzzle** and big round **ears** breaking the head's circle.
 *
 * Everything else — arm swing as FK, the pelvis dropping at contact, IK slack
 * discipline — is Carl's, because Carl is the only figure in this game whose
 * movement convinces.
 *
 * This module knows nothing about animation: it paints one pose. The
 * choreography lives in `scripts/generate-rat-kin-sprite.ts`.
 *
 * Three views: head-on, edge-on and from behind. Head-on and edge-on are not one
 * figure with a multiplier — a profile needs two separate lateral factors, its
 * own head, its own foot, and a leg whose joints bend in the picture plane
 * rather than away from the camera. The `VIEWS` table is where every one of
 * those differences lives.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

// The scalar helpers are Carl's, imported rather than copied: they are pure
// maths with no Carl in them, and a fourth transcription of `lerp` in this repo
// is a fourth place for it to drift.
import { type Pt, clamp01, deg, lerp, mix, rgba } from './carlArt.js';

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
/** Midpoint of a span, for shapes built symmetrically about their centre. */
const MIDPOINT = 0.5;

function pt(x: number, y: number): Pt {
  return { x, y };
}

function offset(base: Pt, dx: number, dy: number): Pt {
  return { x: base.x + dx, y: base.y + dy };
}

function mixPt(a: Pt, b: Pt, t: number): Pt {
  return { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
}

function rotate(p: Pt, angle: number): Pt {
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

function angleBetween(from: Pt, to: Pt): number {
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** A three-stop value ramp for one material. */
interface Ramp {
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
}

// ── Palette ──────────────────────────────────────────────────────────────────

const OUTLINE = '#160f0a';

/** Dusty brown-grey back and limbs, the colour a sewer rat actually is. */
const FUR: Ramp = { dark: '#3b3128', mid: '#6c5b49', light: '#93806a' };
/** The paler underside: throat, chest, belly, cheek, underjaw. */
const BELLY_FUR: Ramp = { dark: '#6a5b4c', mid: '#9d8c77', light: '#c0af98' };
/** Bare rodent skin — ear membranes, paws, toes, nose. */
const SKIN: Ramp = { dark: '#7d5551', mid: '#ab7d78', light: '#cb9c93' };
/**
 * The tail is duskier than the rest of his bare skin. Painted at the ear's own
 * pink it is the brightest thing in the frame and the eye goes to it before it
 * goes to his face — which is the wrong way round for a figure the player is
 * meant to walk up to and talk to.
 */
const TAIL_SKIN: Ramp = { dark: '#6a4b47', mid: '#93706a', light: '#b18a82' };
/** A mossy, much-mended tunic. Light enough to hold its own on a dark floor. */
const TUNIC: Ramp = { dark: '#26382e', mid: '#405f4b', light: '#5a8064' };
/** Belt, satchel strap and pouch. */
const LEATHER: Ramp = { dark: '#3a2a1c', mid: '#6c4a2e', light: '#916a41' };

const EYE_BEAD = '#140d09';
const EYE_GLINT = '#e2d8c4';
/** Rodent incisors: not white, and the pair is the muzzle's whole punchline. */
const INCISOR = '#f2e8cf';
const WHISKER = '#ded4c0';
const CLAW = '#241b14';
const BUCKLE = '#c2a24e';

/** Cool bounce light along the figure's back edge, unifying the parts. */
const RIM_LIGHT = '#d6c6a6';
const RIM_ALPHA = 0.2;
const RIM_WIDTH = 0.015;
const SHEEN_ALPHA = 0.28;
const CONTACT_SHADOW_ALPHA = 0.38;

/** Unit vector the key light arrives from, in figure space. */
const LIGHT: Pt = { x: -0.6, y: -0.8 };

// ── Proportions ──────────────────────────────────────────────────────────────

/**
 * Origin sits between the feet with +Y down, so every height below is negative.
 * Heights are pinned first and bone lengths derived from them, never the other
 * way round.
 */
export const GROUND_Y = 0;
const HIP_Y = -1;
const WAIST_Y = -1.2;
const CHEST_Y = -1.42;
const SHOULDER_Y = -1.52;
const NECK_BASE_Y = -1.58;
const HEAD_CENTRE_Y = -1.74;

/**
 * The digitigrade leg, in three segments. A rodent's femur is short and its
 * tibia and metatarsus long, and it is the *metatarsus* — standing clear of the
 * ground with the hock up near a third of the figure's height — that reads as
 * the backward knee.
 */
const THIGH_LENGTH = 0.34;
const SHANK_LENGTH = 0.48;
const METATARSUS_LENGTH = 0.42;
/** Ball of the foot forward to the claw tips, flat on the ground. */
const TOE_LENGTH = 0.17;
/** The stub of heel behind the ball; a digitigrade foot has almost none. */
const HEEL_LENGTH = 0.045;

const UPPER_ARM_LENGTH = 0.28;
const FOREARM_LENGTH = 0.26;
/** Shoulder to wrist. A relaxed arm hangs at very nearly this. */
const ARM_LENGTH = UPPER_ARM_LENGTH + FOREARM_LENGTH;
/** The shoulder joint hangs below the shoulder line, where the deltoid is. */
const SHOULDER_JOINT_DROP = 0.045;

/**
 * Half the distance between the two limb roots, head-on. Edge-on both are cut
 * down by `ViewSpec.lateral` and `ViewSpec.armSpread`: the two legs then differ
 * fore-and-aft by a token amount, enough to read as depth and not enough to read
 * as a stance.
 */
const LEG_ROOT_HALF = 0.1;
const ARM_ROOT_HALF = 0.145;
/**
 * How far forward of the spine both shoulders sit, edge-on. Without it the arm
 * hangs down the middle of the torso and is swallowed by the tunic's own
 * silhouette; with it the arm clears the garment's front edge and reads as a
 * limb. Head-on that offset points at the camera and projects to nothing.
 */
const PROFILE_ARM_ROOT_FORWARD = 0.045;

/**
 * How far the torso reaches either side of the spine at each height, per view.
 * `lead` is the +X side of the drawing and `trail` the −X side, so edge-on they
 * are the belly and the rump and head-on they are simply his right and left.
 *
 * They are separate tables because a body is not as wide as it is deep. Edge-on
 * a hunched rodent is a pear — shallow across the shoulders, deep through the
 * belly, deepest at the rump where the tail roots. Head-on he is narrower than
 * that and very nearly symmetric.
 */
interface TorsoSpan {
  readonly shoulderLead: number;
  readonly shoulderTrail: number;
  readonly chestLead: number;
  readonly chestTrail: number;
  readonly waistLead: number;
  readonly waistTrail: number;
  readonly hipLead: number;
  readonly hipTrail: number;
}

const PROFILE_TORSO: TorsoSpan = {
  shoulderLead: 0.125,
  shoulderTrail: 0.145,
  chestLead: 0.168,
  chestTrail: 0.155,
  waistLead: 0.152,
  waistTrail: 0.172,
  hipLead: 0.125,
  hipTrail: 0.198,
};

/**
 * Symmetric, and narrower than the profile is deep. The shoulders stay the
 * widest thing on him and the hips come in under them: hips wider than shoulders
 * reads as a barrel however carefully the rest is drawn.
 */
const FACING_TORSO: TorsoSpan = {
  shoulderLead: 0.176,
  shoulderTrail: 0.176,
  chestLead: 0.184,
  chestTrail: 0.184,
  waistLead: 0.142,
  waistTrail: 0.142,
  hipLead: 0.134,
  hipTrail: 0.134,
};

/**
 * Thick, and the head sits low on it. A long bare neck is the single strongest
 * "human in a rat mask" signal there is — a rodent's skull sits more or less
 * straight on the shoulder mass, so head and body have to read as one silhouette
 * rather than as two shapes joined by a stalk.
 */
const NECK_WIDTH = 0.094;
const NECK_TAPER = 0.9;
/** How far the neck capsule buries itself in the skull, as a share of its radius. */
const NECK_INTO_SKULL = 0.62;
/** How far the neck's shadow is lifted toward the fur it sits between. */
const NECK_SHADE_LIFT = 0.55;
/** The throat is narrower than the shoulders where the neck leaves the torso. */
const NECK_NARROW = 0.78;

/** How far the chest swells at a full breath, as a share of its own span. */
const CHEST_SWELL = 0.055;

/** The torso's spans with the chest expanded by `breath`. */
function breathed(span: TorsoSpan, breath: number): TorsoSpan {
  if (breath === 0) return span;
  const swell = 1 + breath * CHEST_SWELL;
  return {
    ...span,
    shoulderLead: span.shoulderLead * swell,
    shoulderTrail: span.shoulderTrail * swell,
    chestLead: span.chestLead * swell,
    chestTrail: span.chestTrail * swell,
  };
}

const THIGH_WIDTH = 0.105;
const KNEE_WIDTH = 0.062;
/**
 * The shank's widest point, just below the knee. This swell is the drumstick
 * every scurrying animal has, and dropping it turns the leg into a bent stick.
 */
const SHANK_BELLY_WIDTH = 0.079;
const SHANK_BELLY_AT = 0.26;
const HOCK_WIDTH = 0.04;
const METATARSUS_WIDTH = 0.034;

const UPPER_ARM_WIDTH = 0.052;
const ELBOW_WIDTH = 0.042;
const WRIST_WIDTH = 0.031;
const FOREARM_BELLY_AT = 0.25;

/**
 * The skull alone, without the muzzle: a rodent braincase is small and round,
 * and everything that makes the head long hangs off the front of it.
 */
const SKULL_RX = 0.152;
const SKULL_RY = 0.134;

/**
 * The pinna. Big for a head this size — he is a rat kin, not a rat — but a disc
 * much past two thirds of the cranium's own diameter reads as Mickey Mouse.
 */
const EAR_R = 0.094;

// ── Views ────────────────────────────────────────────────────────────────────

export type RatKinView = 'front' | 'side' | 'away';

interface ViewSpec {
  readonly torso: TorsoSpan;
  /** Multiplier on every lateral (x) body offset — where the limbs root. */
  readonly lateral: number;
  /**
   * How much of the torso's lean the view can show sideways.
   *
   * Zero head-on, and that is not a simplification: his lean is *forward*, which
   * head-on points straight at the camera. Carried into the picture plane it
   * slides his whole upper body off to one side, and every head-on frame comes
   * out tipping over. What a head-on lean legitimately does is make him a little
   * shorter, and the cosine term does that on its own.
   */
  readonly leanProjection: number;
  /** How far apart the two shoulder joints are drawn. */
  readonly armSpread: number;
  /**
   * How much of the metatarsus' fore-aft lean projects into the picture. Head-on
   * a foot points at the camera, so the segment that carries the hock backward
   * shows almost none of its travel and the leg reads as a vertical column.
   */
  readonly footProjection: number;
  /** How much of the toes' length is visible; head-on a foot is mostly toe caps. */
  readonly toeProjection: number;
  /** True when the figure is seen edge-on rather than head-on. */
  readonly profile: boolean;
  readonly showsFace: boolean;
  readonly showsBack: boolean;
}

/** Side-on, the limbs gather toward the centreline instead of splaying wide. */
const PROFILE_LATERAL = 0.32;
const PROFILE_ARM_SPREAD = 0.15;
const FACING_FOOT_PROJECTION = 0.14;
const FACING_TOE_PROJECTION = 0.45;

const VIEWS: Record<RatKinView, ViewSpec> = {
  front: {
    torso: FACING_TORSO,
    lateral: 1,
    leanProjection: 0,
    armSpread: 1,
    footProjection: FACING_FOOT_PROJECTION,
    toeProjection: FACING_TOE_PROJECTION,
    profile: false,
    showsFace: true,
    showsBack: false,
  },
  side: {
    torso: PROFILE_TORSO,
    lateral: PROFILE_LATERAL,
    leanProjection: 1,
    armSpread: PROFILE_ARM_SPREAD,
    footProjection: 1,
    toeProjection: 1,
    profile: true,
    showsFace: true,
    showsBack: false,
  },
  away: {
    torso: FACING_TORSO,
    lateral: 1,
    leanProjection: 0,
    armSpread: 1,
    footProjection: FACING_FOOT_PROJECTION,
    toeProjection: FACING_TOE_PROJECTION,
    profile: false,
    showsFace: false,
    showsBack: true,
  },
};

// ── Pose ─────────────────────────────────────────────────────────────────────

/**
 * One foot of a digitigrade leg.
 *
 * The authored point is the **ball**, where the weight actually goes, not an
 * ankle: on this leg the ankle is the hock and it hangs in mid-air. `pitch` is
 * the metatarsus' lean off vertical, and it does double duty — it sets the
 * foot's angle *and*, because the hock is derived from it, how high the hock
 * rides. A small pitch is up on the toes; a large one settles the hock down and
 * back.
 */
export interface FootPose {
  /** Ground contact point. A y below 0 lifts the whole foot clear of the floor. */
  readonly ball: Pt;
  /** Metatarsus lean off vertical, radians. 0 stands the foot straight up. */
  readonly pitch: number;
  /** Which way the knee breaks; 1 forward, as every walking leg's does. */
  readonly kneeBreak: number;
  /** 0 flat toes, 1 fully curled under — what a foot in mid-swing does. */
  readonly toeCurl: number;
  /**
   * Rotation of the toes about the ball, radians, positive pitching them down.
   *
   * This is the toe-off. A digitigrade animal finishes each step by rocking the
   * ball up off the floor and pushing from the toe pads alone, and the pitch of
   * the metatarsus above cannot express that on its own — the foot below it stays
   * flat on the ground for the whole stance, which is precisely how a leg with a
   * perfect hock still reads as plantigrade.
   */
  readonly toeRoll: number;
  /**
   * How much the leg is pointed at the camera rather than across it, 0 to 1. At
   * 1 the knee and the hock are pulled onto the hip→ball line and the leg is a
   * straight column that only gets shorter as the foot rises.
   *
   * Head-on there is no direction for a joint to break into: a real knee hinges
   * away from the viewer, so it hides behind the shin instead of throwing the
   * leg into a visible angle. Both legs of a head-on pose want the same value —
   * a straight swing leg beside a bowed stance leg makes the bow flicker on and
   * off every step, which reads as a wiggle rather than as a walk.
   */
  readonly foreshorten: number;
  /**
   * How much nearer the camera this leg's shin is than its thigh, 0 to 1, which
   * is what the raised leg of a head-on step actually is. Unlike `foreshorten`
   * this differs between the two legs by design: it only changes widths, so it
   * cues depth without moving a joint.
   */
  readonly nearness: number;
}

/**
 * Where an arm's two segments point, in radians from hanging straight down.
 * Positive swings forward, which is +X in the profile the figure is drawn in.
 *
 * An arm placed by its *hand* cannot swing correctly: nearly all of a walking
 * arm's travel belongs to the shoulder, and IK from a hand target forces both
 * segments to sweep together until the forearm flails. Walk arms are therefore
 * FK; hand targets stay for everything a hand actually reaches for.
 */
export interface ArmAngles {
  readonly upper: number;
  readonly fore: number;
  /**
   * Fraction of its true length the forearm is drawn at, for a limb swinging
   * toward or away from the camera. A 2D arm has no other way to foreshorten,
   * and without it a hand swung at the viewer stays pinned at one height instead
   * of riding up the body as the forearm turns out of the picture plane.
   */
  readonly foreScale: number;
}

/**
 * The tail, as a whip rather than a fixed curve: `base` aims the root, `curl` is
 * how much the whole length bends over its span, and `wave` and `phase` run a
 * travelling sine down it so the tip lags the hips the way a real tail does.
 */
export interface TailPose {
  /** Direction the root leaves the rump, radians, screen-space (+Y is down). */
  readonly base: number;
  /** Total bend accumulated from root to tip, radians. */
  readonly curl: number;
  /** Amplitude of the travelling wave, radians per segment. */
  readonly wave: number;
  /** Where the wave sits along the tail, in radians. */
  readonly phase: number;
}

/**
 * One frame of the Rat Kin, seen edge-on and facing +X.
 *
 * `near` is the side toward the camera, `far` the side away from it. There is no
 * left and right because there is no view in which they would differ.
 */
export interface RatKinPose {
  /** Whole-body vertical offset; positive drops the pelvis. */
  bob: number;
  /** Torso lean in radians; positive tips the shoulders forward, over +X. */
  lean: number;
  /** 0 stands as tall as he ever does, 1 sinks into a crouch. */
  crouch: number;
  /** Head pitch in radians; positive noses down. */
  headPitch: number;
  /** How far the muzzle is thrust forward past the neck, in tile units. */
  headReach: number;
  /** 0 eyes open, 1 shut. */
  blink: number;
  /** 0 still, 1 mid-sniff: muzzle lifted, whiskers fanned, jaw cracked open. */
  sniff: number;
  /** Ear rotations about their own roots, radians; positive lays them back. */
  earNear: number;
  earFar: number;
  nearFoot: FootPose;
  farFoot: FootPose;
  /** FK angles win over that arm's hand target when set. */
  nearArmAngles: ArmAngles | null;
  farArmAngles: ArmAngles | null;
  nearHand: Pt;
  farHand: Pt;
  /** 0 open paw, 1 curled, per hand. */
  nearPaw: number;
  farPaw: number;
  /** Elbows swing behind the body at 1 and in front of it at −1. */
  elbowFlare: number;
  /**
   * Whether an arm is on the far side of the torso and so drawn before it. Only
   * consulted head-on; edge-on the far arm is always behind the body. Walking
   * away from the camera this is what hides the forward half of an arm swing,
   * which is where a real arm spends most of its travel.
   */
  nearArmBehind: boolean;
  farArmBehind: boolean;
  tail: TailPose;
  /** How far the tunic hem kicks out from the body, −1 to 1. */
  hemSway: number;
  /**
   * Chest expansion, −1 to 1.
   *
   * A breath is the ribcage *changing shape*, not the whole figure moving up and
   * down: lift alone is a rigid body being translated, and at a 32px tile a body
   * rising a percent of its own height is sub-pixel and reads as a statue. The
   * chest swelling changes the silhouette's area, which survives the downsample.
   */
  breath: number;
}

/**
 * He stands hunched. A rodent that stands up straight is a person in a costume,
 * and the forward lean is what puts his head out over his toes, where the muzzle
 * is seen against the floor rather than against his own chest.
 */
const REST_LEAN = deg(9);
/**
 * The metatarsus' resting lean. Together with {@link METATARSUS_LENGTH} this
 * sets the hock's standing height, so it is the number to move if the
 * backward-knee read comes out too weak or too broken.
 */
export const REST_FOOT_PITCH = deg(41);
/**
 * Edge-on the feet are staggered fore-and-aft. Too close together and the two
 * shanks overlap into one thick leg with a seam down it; too far and no pair of
 * legs this bent can cover both without the crotch splitting.
 */
const REST_FOOT_LEAD = 0.098;
/** The far foot settles a shade flatter, which separates it from the near one. */
const REST_FAR_FOOT_PITCH = REST_FOOT_PITCH + deg(3);
/**
 * The tail leaves the rump pointing back and slightly *up* and then arcs down
 * behind him toward the floor, so the curl is negative. Carried the other way it
 * sweeps up over his own back like a scorpion's, which is the first thing the
 * initial bake did.
 */
export const REST_TAIL_BASE = deg(188);
export const REST_TAIL_CURL = deg(-118);
/** How far behind the shoulder a relaxed hand hangs. */
const REST_HAND_BEHIND = 0.035;
/** The far hand hangs further back, which reads as depth rather than as reach. */
const FAR_HAND_EXTRA_BEHIND = 2;
const REST_PAW_CURL = 0.3;
/**
 * Edge-on the elbow must break backward; forward it crosses his own belly.
 *
 * Positive, because `elbowBend` maps a non-negative flare to `bendSign` +1, and
 * +1 on a downward-hanging limb throws the joint toward −X — behind him.
 */
const REST_ELBOW_FLARE = 0.4;

/**
 * A relaxed arm reaches nearly its full length, measured from the shoulder
 * *joint*. Measuring from the shoulder line instead leaves the IK a sliver of
 * slack, which it spends throwing the elbow sideways into a visible kink.
 */
const HAND_HANG_DROP = SHOULDER_JOINT_DROP + ARM_LENGTH * 0.99;

function restingFoot(lead: number, pitch = REST_FOOT_PITCH): FootPose {
  return {
    ball: pt(lead, GROUND_Y),
    pitch,
    kneeBreak: 1,
    toeCurl: 0,
    toeRoll: 0,
    foreshorten: 0,
    nearness: 0,
  };
}

/** A relaxed standing pose. Every animation is written as edits to this. */
export function restingPose(): RatKinPose {
  const shoulderX = Math.sin(REST_LEAN) * Math.abs(SHOULDER_Y - HIP_Y);
  const handY = SHOULDER_Y + HAND_HANG_DROP;
  return {
    bob: 0,
    lean: REST_LEAN,
    crouch: 0,
    headPitch: 0,
    headReach: 0,
    blink: 0,
    sniff: 0,
    earNear: 0,
    earFar: 0,
    nearFoot: restingFoot(REST_FOOT_LEAD),
    farFoot: restingFoot(-REST_FOOT_LEAD, REST_FAR_FOOT_PITCH),
    nearArmAngles: null,
    farArmAngles: null,
    nearHand: pt(shoulderX - REST_HAND_BEHIND, handY),
    farHand: pt(shoulderX - REST_HAND_BEHIND * FAR_HAND_EXTRA_BEHIND, handY),
    nearPaw: REST_PAW_CURL,
    farPaw: REST_PAW_CURL,
    elbowFlare: REST_ELBOW_FLARE,
    nearArmBehind: false,
    farArmBehind: false,
    tail: { base: REST_TAIL_BASE, curl: REST_TAIL_CURL, wave: 0, phase: 0 },
    hemSway: 0,
    breath: 0,
  };
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

interface BoneChain {
  readonly root: Pt;
  readonly joint: Pt;
  readonly end: Pt;
}

/**
 * Keeps a fully extended limb from locking into a straight, lifeless line.
 *
 * Tiny, because the joint's sideways travel grows as the *square root* of it: a
 * percent of slack is a visible kink on a limb that should read as straight.
 */
const JOINT_SLACK = 0.0004;

/**
 * Places a two-segment limb so its end sits on `target`. `bendSign` picks which
 * side the joint pops out to: for a limb hanging downward, +1 pushes the joint
 * toward *−X* and −1 toward +X. (The joint is offset along the target
 * direction's normal, which for a downward limb points backward — which is why
 * `KNEE_FORWARD` is −1 despite naming a forward bend.)
 */
function solveTwoBone(
  root: Pt,
  target: Pt,
  upper: number,
  lower: number,
  bendSign: number,
): BoneChain {
  const dx = target.x - root.x;
  const dy = target.y - root.y;
  const raw = Math.hypot(dx, dy);
  const dirX = raw === 0 ? 0 : dx / raw;
  const dirY = raw === 0 ? 1 : dy / raw;

  const minReach = Math.abs(upper - lower) + JOINT_SLACK;
  const maxReach = upper + lower - JOINT_SLACK;
  const dist = Math.min(Math.max(raw, minReach), maxReach);

  const end = { x: root.x + dirX * dist, y: root.y + dirY * dist };
  const along = (dist * dist + upper * upper - lower * lower) / (2 * dist);
  const out = Math.sqrt(Math.max(0, upper * upper - along * along));
  const joint = {
    x: root.x + dirX * along - dirY * out * bendSign,
    y: root.y + dirY * along + dirX * out * bendSign,
  };
  return { root, joint, end };
}

/** How far hip→hock can stretch before the solver starts clamping the leg. */
export const LEG_REACH_LIMIT = THIGH_LENGTH + SHANK_LENGTH - JOINT_SLACK;

/**
 * The hock for a foot planted at `ball`: back up the metatarsus from the ball.
 *
 * This is the whole digitigrade rig in one expression. The choreography places
 * the ball and the pitch; where the hock ends up — and therefore how folded the
 * leg above it is — falls out of them.
 *
 * `projection` is how much of the metatarsus' fore-aft lean the view can show.
 * Head-on it is nearly nothing: the segment leans at the camera, so the hock
 * draws almost directly above the ball and the leg reads as a column rather than
 * as a zig-zag seen from the wrong side.
 */
function hockFor(foot: FootPose, projection = 1): Pt {
  return offset(
    foot.ball,
    -Math.sin(foot.pitch) * METATARSUS_LENGTH * projection,
    -Math.cos(foot.pitch) * METATARSUS_LENGTH,
  );
}

/** How much of the hip height a full crouch removes. */
const CROUCH_DROP = 0.24;

function hipPoint(pose: RatKinPose): Pt {
  return pt(0, -(Math.abs(HIP_Y) - pose.crouch * CROUCH_DROP) + pose.bob);
}

/**
 * Offset from the hip to a point `height` up the leaning spine.
 *
 * `projection` scales only the sideways component. The vertical one is left
 * alone on purpose: a leaning figure really is shorter, in every view.
 */
function spinePoint(hip: Pt, height: number, lean: number, projection: number): Pt {
  const rotated = rotate({ x: 0, y: -height }, lean);
  return offset(hip, rotated.x * projection, rotated.y);
}

/**
 * Facing +X, a knee that bends toward +X is bending forward. Both knees take the
 * same sign: "knees break away from the centreline" is a head-on rule, and
 * applied edge-on it hinges one leg backward, which no leg does.
 */
const KNEE_FORWARD = -1;

/** Where the knee falls along a straight, unbent leg. */
const KNEE_ALONG_LEG = THIGH_LENGTH / (THIGH_LENGTH + SHANK_LENGTH);

/**
 * Pulls a solved leg's knee back onto the hip→hock line by `amount`, so the leg
 * reads as a column shortening toward the viewer rather than as a hinge swinging
 * sideways. See `FootPose.foreshorten`.
 */
function foreshortenLeg(chain: BoneChain, amount: number): BoneChain {
  if (amount <= 0) return chain;
  const straightKnee = mixPt(chain.root, chain.end, KNEE_ALONG_LEG);
  return { ...chain, joint: mixPt(chain.joint, straightKnee, clamp01(amount)) };
}

interface Skeleton {
  readonly hip: Pt;
  readonly waist: Pt;
  readonly chest: Pt;
  readonly shoulder: Pt;
  readonly neck: Pt;
  readonly headCentre: Pt;
  readonly nearLeg: BoneChain;
  readonly farLeg: BoneChain;
  readonly nearArm: BoneChain;
  readonly farArm: BoneChain;
}

function armFromAngles(shoulder: Pt, angles: ArmAngles): BoneChain {
  const upper = rotate({ x: 0, y: UPPER_ARM_LENGTH }, -angles.upper);
  const joint = offset(shoulder, upper.x, upper.y);
  const fore = rotate({ x: 0, y: FOREARM_LENGTH * angles.foreScale }, -angles.fore);
  return { root: shoulder, joint, end: offset(joint, fore.x, fore.y) };
}

function elbowBend(flare: number): number {
  return flare < 0 ? -1 : 1;
}

function legChain(hipRoot: Pt, foot: FootPose, view: ViewSpec): BoneChain {
  return foreshortenLeg(
    solveTwoBone(
      hipRoot,
      hockFor(foot, view.footProjection),
      THIGH_LENGTH,
      SHANK_LENGTH,
      KNEE_FORWARD * foot.kneeBreak,
    ),
    foot.foreshorten,
  );
}

function armChain(shoulder: Pt, angles: ArmAngles | null, hand: Pt, flare: number): BoneChain {
  if (angles !== null) return armFromAngles(shoulder, angles);
  return solveTwoBone(shoulder, hand, UPPER_ARM_LENGTH, FOREARM_LENGTH, elbowBend(flare));
}

function buildSkeleton(pose: RatKinPose, view: ViewSpec): Skeleton {
  const hip = hipPoint(pose);
  const tilt = view.leanProjection;
  const waist = spinePoint(hip, Math.abs(WAIST_Y - HIP_Y), pose.lean, tilt);
  const chest = spinePoint(hip, Math.abs(CHEST_Y - HIP_Y), pose.lean, tilt);
  const shoulder = spinePoint(hip, Math.abs(SHOULDER_Y - HIP_Y), pose.lean, tilt);
  const neck = spinePoint(hip, Math.abs(NECK_BASE_Y - HIP_Y), pose.lean, tilt);
  const headCentre = offset(
    spinePoint(hip, Math.abs(HEAD_CENTRE_Y - HIP_Y), pose.lean, tilt),
    pose.headReach * tilt,
    0,
  );

  // Edge-on only: head-on the shoulders' forward offset points at the camera.
  const armForward = view.profile ? PROFILE_ARM_ROOT_FORWARD : 0;
  const armHalf = ARM_ROOT_HALF * view.armSpread;
  const legHalf = LEG_ROOT_HALF * view.lateral;
  const nearShoulder = offset(shoulder, armForward + armHalf, SHOULDER_JOINT_DROP);
  const farShoulder = offset(shoulder, armForward - armHalf, SHOULDER_JOINT_DROP);

  return {
    hip,
    waist,
    chest,
    shoulder,
    neck,
    headCentre,
    nearLeg: legChain(offset(hip, legHalf, 0), pose.nearFoot, view),
    farLeg: legChain(offset(hip, -legHalf, 0), pose.farFoot, view),
    nearArm: armChain(nearShoulder, pose.nearArmAngles, pose.nearHand, pose.elbowFlare),
    farArm: armChain(farShoulder, pose.farArmAngles, pose.farHand, pose.elbowFlare),
  };
}

/** What a bake gate needs to know about one leg, without exposing the rig. */
export interface LegMeasure {
  /** Distance the thigh and shank have to span to reach the hock. */
  readonly hipToHock: number;
  /** Where this leg roots, so a gate can sign the knee against the hip→hock line. */
  readonly hip: Pt;
  readonly hock: Pt;
  readonly knee: Pt;
}

/**
 * Measures both legs of a pose, for the reach-headroom and foot-slide gates.
 *
 * A stride that clamps on even one frame reads as a hop: the leg locks dead
 * straight, the foot hangs above the floor, and the next frame's tuck snaps the
 * knee back in. Checking it numerically is the only way to catch it.
 */
export function measureLegs(
  pose: RatKinPose,
  viewName: RatKinView = 'side',
): { near: LegMeasure; far: LegMeasure } {
  const view = VIEWS[viewName];
  const hip = hipPoint(pose);
  const legHalf = LEG_ROOT_HALF * view.lateral;
  const measure = (root: Pt, foot: FootPose): LegMeasure => {
    const hock = hockFor(foot, view.footProjection);
    return {
      hipToHock: Math.hypot(hock.x - root.x, hock.y - root.y),
      hip: root,
      hock,
      knee: legChain(root, foot, view).joint,
    };
  };
  return {
    near: measure(offset(hip, legHalf, 0), pose.nearFoot),
    far: measure(offset(hip, -legHalf, 0), pose.farFoot),
  };
}

// ── Low-level painting ───────────────────────────────────────────────────────

/** Traces a capsule: a quad between two circles, with both caps rounded. */
function traceCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  const normal = angleBetween(a, b) + HALF_PI;
  const nx = Math.cos(normal);
  const ny = Math.sin(normal);
  ctx.beginPath();
  ctx.arc(a.x, a.y, wa, normal, normal + Math.PI);
  ctx.lineTo(b.x - nx * wb, b.y - ny * wb);
  ctx.arc(b.x, b.y, wb, normal + Math.PI, normal + TWO_PI);
  ctx.lineTo(a.x + nx * wa, a.y + ny * wa);
  ctx.closePath();
}

function fillCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number, fill: string): void {
  traceCapsule(ctx, a, b, wa, wb);
  ctx.fillStyle = fill;
  ctx.fill();
}

/** Dark silhouette laid under a form so it separates from what is behind it. */
const OUTLINE_BLEED = 0.013;

function outlineCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  fillCapsule(ctx, a, b, wa + OUTLINE_BLEED, wb + OUTLINE_BLEED, OUTLINE);
}

const SHEEN_OFFSET = 0.45;
const SHEEN_WIDTH = 0.34;
const SHEEN_TAPER = 0.7;

/** Runs a light stroke down the lit side of a segment. */
function sheenSegment(ctx: Ctx, a: Pt, b: Pt, width: number, colour: string, alpha: number): void {
  const normal = angleBetween(a, b) + HALF_PI;
  const facing = Math.cos(normal) * LIGHT.x + Math.sin(normal) * LIGHT.y;
  const push = width * SHEEN_OFFSET * (facing >= 0 ? 1 : -1);
  const nx = Math.cos(normal) * push;
  const ny = Math.sin(normal) * push;
  ctx.save();
  ctx.globalAlpha = alpha;
  fillCapsule(
    ctx,
    offset(a, nx, ny),
    offset(b, nx, ny),
    width * SHEEN_WIDTH,
    width * SHEEN_WIDTH * SHEEN_TAPER,
    colour,
  );
  ctx.restore();
}

/**
 * Strokes then fills a closed path, so the outline shows only where the fill
 * does not cover it — half the stroke width, all the way round the silhouette.
 */
function fillOutlined(ctx: Ctx, trace: () => void, fill: string, outlineWidth: number): void {
  ctx.save();
  trace();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = outlineWidth;
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

const BODY_OUTLINE_WIDTH = 0.026;
const DETAIL_OUTLINE_WIDTH = 0.016;

const SHADOW_RX = 0.34;
const SHADOW_FLATTEN = 0.34;
/** How much of the stance's own sideways travel the shadow tracks. */
const SHADOW_FOLLOW = 0.5;

/**
 * Below this an alpha serialises in exponent notation (`5e-17`), which
 * node-canvas silently discards along with the whole `rgba()` — baking a solid
 * black smear where a shadow should have faded out.
 */
const MIN_VISIBLE_ALPHA = 1e-4;

/** Soft elliptical shadow under the figure. */
function drawGroundShadow(ctx: Ctx, centreX: number, radiusX: number, alpha: number): void {
  if (alpha < MIN_VISIBLE_ALPHA) return;
  // A gradient resolves in the user space it is painted in, not the one it was
  // built in, so the transform has to be in place before the gradient is made.
  ctx.save();
  ctx.translate(centreX, GROUND_Y);
  ctx.scale(radiusX, radiusX * SHADOW_FLATTEN);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  gradient.addColorStop(0, rgba(OUTLINE, alpha));
  gradient.addColorStop(1, rgba(OUTLINE, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

/**
 * The far-side limbs sit in the body's shade so the near ones read forward. Only
 * a true profile earns this: it is the one view where the far limb really is
 * behind the body rather than beside it.
 */
const FAR_LIMB_SHADE = 0.34;
const UNSHADED = 0;

/**
 * Walks a fur edge from `a` to `b`, bowed out by `bulge` and broken into
 * `tufts` shallow scallops. `outward` is +1 to bow toward the *right* of the
 * a→b direction and −1 toward its left — screen space has +Y down, so adding a
 * quarter turn rotates clockwise on screen, not anticlockwise.
 *
 * Fur is one soft mass with an uneven edge, not a ring of spikes: many shallow
 * scallops read as fur, few tall ones read as a crown of thorns. The path must
 * already sit on `a`.
 */
function traceFurEdge(
  ctx: Ctx,
  a: Pt,
  b: Pt,
  bulge: number,
  tufts: number,
  tuft: number,
  outward: number,
): void {
  const along = angleBetween(a, b);
  const outX = Math.cos(along + HALF_PI) * outward;
  const outY = Math.sin(along + HALF_PI) * outward;
  const swell = (t: number): number => bulge * Math.sin(t * Math.PI);
  for (let i = 1; i <= tufts; i++) {
    const t = i / tufts;
    const midT = (i - MIDPOINT) / tufts;
    const anchor = mixPt(a, b, t);
    const control = mixPt(a, b, midT);
    ctx.quadraticCurveTo(
      control.x + outX * (swell(midT) + tuft),
      control.y + outY * (swell(midT) + tuft),
      anchor.x + outX * swell(t),
      anchor.y + outY * swell(t),
    );
  }
}

// ── Limbs ────────────────────────────────────────────────────────────────────

/** The four widths a limb is drawn from, root to tip. */
interface LimbShape {
  readonly root: number;
  readonly joint: number;
  /** Widest point of the lower segment — the shank's swell, or the forearm's. */
  readonly belly: number;
  readonly tip: number;
  /** Where the belly sits along the lower segment, 0 at the joint, 1 at the tip. */
  readonly bellyAt: number;
}

const ARM_SHAPE: LimbShape = {
  root: UPPER_ARM_WIDTH,
  joint: ELBOW_WIDTH,
  belly: ELBOW_WIDTH,
  tip: WRIST_WIDTH,
  bellyAt: FOREARM_BELLY_AT,
};

const LEG_SHAPE: LimbShape = {
  root: THIGH_WIDTH,
  joint: KNEE_WIDTH,
  belly: SHANK_BELLY_WIDTH,
  tip: HOCK_WIDTH,
  bellyAt: SHANK_BELLY_AT,
};

/**
 * A leg swung toward the camera, drawn head-on. Everything below the knee is
 * nearer the viewer than the thigh is, so it reads *larger*, not smaller: the
 * knee stops pinching and the shank and hock gain a little. The shank's widest
 * point also slides down it, because a segment tipped toward the viewer projects
 * its swell closer to the foot.
 */
const NEAR_LEG_SHAPE: LimbShape = {
  root: THIGH_WIDTH,
  joint: THIGH_WIDTH,
  belly: SHANK_BELLY_WIDTH * 1.15,
  tip: HOCK_WIDTH * 1.2,
  bellyAt: 0.48,
};

function legShapeFor(nearness: number): LimbShape {
  const t = clamp01(nearness);
  if (t <= 0) return LEG_SHAPE;
  return {
    root: lerp(LEG_SHAPE.root, NEAR_LEG_SHAPE.root, t),
    joint: lerp(LEG_SHAPE.joint, NEAR_LEG_SHAPE.joint, t),
    belly: lerp(LEG_SHAPE.belly, NEAR_LEG_SHAPE.belly, t),
    tip: lerp(LEG_SHAPE.tip, NEAR_LEG_SHAPE.tip, t),
    bellyAt: lerp(LEG_SHAPE.bellyAt, NEAR_LEG_SHAPE.bellyAt, t),
  };
}

/**
 * Paints a solved limb: outline, then fur, then a sheen down the lit edge.
 *
 * The lower segment is drawn in two pieces so the joint can pinch in and the
 * belly swell back out below it. Drawn as one taper a limb is a traffic cone.
 */
function drawLimb(ctx: Ctx, chain: BoneChain, shape: LimbShape, ramp: Ramp, shade: number): void {
  const belly = mixPt(chain.joint, chain.end, shape.bellyAt);
  const fur = mix(ramp.mid, OUTLINE, shade);
  const furLight = mix(ramp.light, OUTLINE, shade);

  outlineCapsule(ctx, chain.root, chain.joint, shape.root, shape.joint);
  outlineCapsule(ctx, chain.joint, belly, shape.joint, shape.belly);
  outlineCapsule(ctx, belly, chain.end, shape.belly, shape.tip);

  fillCapsule(ctx, chain.root, chain.joint, shape.root, shape.joint, fur);
  fillCapsule(ctx, chain.joint, belly, shape.joint, shape.belly, fur);
  fillCapsule(ctx, belly, chain.end, shape.belly, shape.tip, fur);
  sheenSegment(ctx, chain.root, chain.joint, shape.root, furLight, SHEEN_ALPHA);
  sheenSegment(ctx, chain.joint, chain.end, shape.belly, furLight, SHEEN_ALPHA);
}

// ── Feet ─────────────────────────────────────────────────────────────────────

/** How far the toes sit below the ball, which is the sole's own thickness. */
const FOOT_DEPTH = 0.05;
const TOE_COUNT = 3;
/** Toes splay fore-and-aft, which is the only direction a profile can show. */
const TOE_SPREAD = 0.055;
const TOE_TIP_WIDTH = 0.017;
const CLAW_LENGTH = 0.032;
const CLAW_WIDTH = 0.009;
const CLAW_RISE = 0.55;
/** How much of the toes' length a full curl folds away under the foot. */
const TOE_CURL_FOLD = 0.62;
const TOE_CURL_LIFT = 0.5;
const HEEL_RISE = 0.4;
const HEEL_WIDTH = 0.028;

/**
 * Height the toe pads rest at, which is the sole's own thickness below the ball.
 *
 * Exported so the foot-slide gate can check a *rolling* contact: once the ball
 * lifts at toe-off the ball is no longer the contact point, and a gate that only
 * knows about the ball would read the roll as the foot leaving the floor early.
 */
export function toeContactHeight(foot: FootPose): number {
  const curl = clamp01(foot.toeCurl);
  const reach = TOE_LENGTH * (1 - curl * TOE_CURL_FOLD);
  const drop = FOOT_DEPTH * (1 - curl);
  const lifted = drop - clamp01(foot.toeCurl) * TOE_CURL_LIFT * TOE_LENGTH;
  const rolled = rotate(pt(reach, lifted), foot.toeRoll);
  return foot.ball.y + rolled.y;
}

/** The height those pads sit at with the foot flat — what a stance must hold. */
export const FLAT_TOE_CONTACT_HEIGHT = FOOT_DEPTH;

/**
 * How far the ball has to rise for a given toe-off roll to leave the pads
 * exactly where they were.
 *
 * Derived here rather than in the choreography because it is a fact about the
 * *shape* of the foot: the pads swing up by `reach·sin(roll)` as the toes pitch
 * down, but the sole's own thickness also shortens to `depth·cos(roll)` in the
 * process, and a lift that forgets the second term rocks the whole foot a
 * millimetre off the floor through the push-off.
 */
export function ballLiftForRoll(roll: number): number {
  return TOE_LENGTH * Math.sin(roll) - FOOT_DEPTH * (1 - Math.cos(roll));
}

/** Head-on the toes splay across the screen, since fore-and-aft shows nothing. */
const TOE_SPLAY_FACING = 0.075;
/** How far the claws of a foot pointed away from the camera stay hidden. */
const AWAY_CLAW_SHARE = 0.25;

/**
 * `outward` is +1 for the figure's right foot and −1 for its left, and only
 * matters head-on: a foot pointed at the camera turns out in the *ground* plane,
 * which a 2D rotation cannot express — rotating it rolls him onto the outer edge
 * of both soles. The toe end leads outward instead and the sole stays level.
 */
function drawFootFacing(
  ctx: Ctx,
  hock: Pt,
  foot: FootPose,
  view: ViewSpec,
  outward: number,
  ramp: Ramp,
  shade: number,
): void {
  const ball = foot.ball;
  const fur = mix(ramp.mid, OUTLINE, shade);
  const furLight = mix(ramp.light, OUTLINE, shade);
  const skin = mix(SKIN.mid, OUTLINE, shade);

  outlineCapsule(ctx, hock, ball, HOCK_WIDTH, METATARSUS_WIDTH);
  fillCapsule(ctx, hock, ball, HOCK_WIDTH, METATARSUS_WIDTH, fur);
  sheenSegment(ctx, hock, ball, METATARSUS_WIDTH, furLight, SHEEN_ALPHA);

  const curl = clamp01(foot.toeCurl);
  const reach = TOE_LENGTH * view.toeProjection * (1 - curl * TOE_CURL_FOLD);
  const drop = FOOT_DEPTH * (1 - curl);
  for (let i = 0; i < TOE_COUNT; i++) {
    const splay = (i / (TOE_COUNT - 1) - MIDPOINT) * TOE_SPLAY_FACING;
    const tip = offset(
      ball,
      splay + outward * reach * TOE_LEAD_OUT,
      drop + reach * TOE_FACING_DROP_SHARE,
    );
    outlineCapsule(ctx, ball, tip, METATARSUS_WIDTH, TOE_TIP_WIDTH);
    fillCapsule(ctx, ball, tip, METATARSUS_WIDTH, TOE_TIP_WIDTH, skin);
    // Seen from behind the claws are on the far side of his own toes.
    const clawReach = CLAW_LENGTH * (1 - curl) * (view.showsBack ? AWAY_CLAW_SHARE : 1);
    fillCapsule(ctx, tip, offset(tip, 0, clawReach), CLAW_WIDTH, 0, CLAW);
  }
}

/** How far the toe end leads outward as it turns out in the ground plane. */
const TOE_LEAD_OUT = 0.35;
/**
 * How much of the toes' length shows as *downward* travel head-on.
 *
 * A toe pointed at the camera does project a little down the screen, but not its
 * whole length: at 1 the head-on sole paints a full toe below the profile's and
 * the two views disagree about where the floor is — he sinks a pixel and a half
 * every time he turns to face you. Matched to the profile's own sole depth.
 */
const TOE_FACING_DROP_SHARE = 0.28;

/**
 * The metatarsus and the toes. Drawn from the hock down to the ball and then
 * forward along the ground, because that fore-aft L is the shape a digitigrade
 * foot makes and the part of it a viewer reads as "not a human foot".
 */
function drawFootProfile(ctx: Ctx, hock: Pt, foot: FootPose, ramp: Ramp, shade: number): void {
  const ball = foot.ball;
  const fur = mix(ramp.mid, OUTLINE, shade);
  const furLight = mix(ramp.light, OUTLINE, shade);
  const skin = mix(SKIN.mid, OUTLINE, shade);

  outlineCapsule(ctx, hock, ball, HOCK_WIDTH, METATARSUS_WIDTH);
  fillCapsule(ctx, hock, ball, HOCK_WIDTH, METATARSUS_WIDTH, fur);
  sheenSegment(ctx, hock, ball, METATARSUS_WIDTH, furLight, SHEEN_ALPHA);

  const heel = offset(ball, -HEEL_LENGTH, -FOOT_DEPTH * HEEL_RISE);
  outlineCapsule(ctx, ball, heel, METATARSUS_WIDTH, HEEL_WIDTH);
  fillCapsule(ctx, ball, heel, METATARSUS_WIDTH, HEEL_WIDTH, fur);

  // The toes lie along the ground, not along the metatarsus: a planted foot is
  // flat however the leg above it is angled.
  const curl = clamp01(foot.toeCurl);
  const reach = TOE_LENGTH * (1 - curl * TOE_CURL_FOLD);
  const drop = FOOT_DEPTH * (1 - curl);
  const roll = foot.toeRoll;
  for (let i = 0; i < TOE_COUNT; i++) {
    const spread = (i / (TOE_COUNT - 1) - MIDPOINT) * TOE_SPREAD;
    // Rotated about the ball, so a lifted ball leaves the pads where they were.
    const flat = pt(reach + spread, drop - curl * TOE_CURL_LIFT * TOE_LENGTH);
    const rolled = rotate(flat, roll);
    const tip = offset(ball, rolled.x, rolled.y);
    outlineCapsule(ctx, ball, tip, METATARSUS_WIDTH, TOE_TIP_WIDTH);
    // The hindmost toe stays furred; the two the viewer sees are bare skin, so
    // the foot ends in a pale point rather than fading into the shadow.
    fillCapsule(ctx, ball, tip, METATARSUS_WIDTH, TOE_TIP_WIDTH, i === 0 ? fur : skin);
    const claw = rotate(pt(CLAW_LENGTH * (1 - curl), -CLAW_LENGTH * CLAW_RISE), roll);
    fillCapsule(ctx, tip, offset(tip, claw.x, claw.y), CLAW_WIDTH, 0, CLAW);
  }
}

// ── Paws ─────────────────────────────────────────────────────────────────────

const PAW_LENGTH = FOREARM_LENGTH * 0.4;
/** A paw as narrow as its own wrist reads as a stick, not as a hand. */
const PAW_WIDTH = PAW_LENGTH * 0.74;
const FINGER_COUNT = 3;
const FINGER_LENGTH = 0.055;
const FINGER_WIDTH = 0.014;
const FINGER_TAPER = 0.7;
const FINGER_FAN = 0.5;
const THUMB_AT = 0.35;
const THUMB_LENGTH = 0.038;
const THUMB_FAN = 1.1;
const THUMB_TUCK = 0.35;
/** How far a full curl folds the digits back toward the palm. */
const PAW_CURL_FOLD = 0.72;
/** A curled paw also shortens its own palm as the knuckles come over. */
const PAW_CURL_PALM = 0.18;
const PAW_CLAW_LENGTH = 0.018;

/**
 * A four-digit rodent hand. Every digit reads `curl`: a thumb pinned at its open
 * fan throws a stub sideways out of a closed paw that reads as a spare finger.
 */
function drawPaw(ctx: Ctx, wrist: Pt, angle: number, curl: number, shade: number): void {
  const closed = clamp01(curl);
  const palmReach = PAW_LENGTH * (1 - closed * PAW_CURL_PALM);
  const palmEnd = offset(wrist, Math.cos(angle) * palmReach, Math.sin(angle) * palmReach);
  const skin = mix(SKIN.mid, OUTLINE, shade);

  outlineCapsule(ctx, wrist, palmEnd, WRIST_WIDTH, PAW_WIDTH / 2);
  fillCapsule(ctx, wrist, palmEnd, WRIST_WIDTH, PAW_WIDTH / 2, skin);

  const reach = FINGER_LENGTH * (1 - closed * PAW_CURL_FOLD);
  for (let i = 0; i < FINGER_COUNT; i++) {
    const fan = (i / (FINGER_COUNT - 1) - MIDPOINT) * FINGER_FAN;
    const tip = offset(palmEnd, Math.cos(angle + fan) * reach, Math.sin(angle + fan) * reach);
    outlineCapsule(ctx, palmEnd, tip, FINGER_WIDTH, FINGER_WIDTH * FINGER_TAPER);
    fillCapsule(ctx, palmEnd, tip, FINGER_WIDTH, FINGER_WIDTH * FINGER_TAPER, skin);
    const clawReach = PAW_CLAW_LENGTH * (1 - closed);
    const clawTip = offset(
      tip,
      Math.cos(angle + fan) * clawReach,
      Math.sin(angle + fan) * clawReach,
    );
    fillCapsule(ctx, tip, clawTip, CLAW_WIDTH, 0, CLAW);
  }

  const thumbRoot = mixPt(wrist, palmEnd, THUMB_AT);
  const thumbAngle = angle - THUMB_FAN * (1 - closed) + THUMB_TUCK * closed;
  const thumbReach = THUMB_LENGTH * (1 - closed * PAW_CURL_FOLD);
  const thumbTip = offset(
    thumbRoot,
    Math.cos(thumbAngle) * thumbReach,
    Math.sin(thumbAngle) * thumbReach,
  );
  outlineCapsule(ctx, thumbRoot, thumbTip, FINGER_WIDTH, FINGER_WIDTH * FINGER_TAPER);
  fillCapsule(ctx, thumbRoot, thumbTip, FINGER_WIDTH, FINGER_WIDTH * FINGER_TAPER, skin);
}

/**
 * A hand does not take the full angle of its forearm — the wrist holds it close
 * to the line of the arm as a whole, which is why a walking figure's hands read
 * as rigid while the forearm swings under them.
 */
const WRIST_FOLLOW = 0.3;

function wristAngle(chain: BoneChain): number {
  const alongArm = angleBetween(chain.root, chain.end);
  const alongForearm = angleBetween(chain.joint, chain.end);
  return lerp(alongArm, alongForearm, WRIST_FOLLOW);
}

/** How far down the upper arm the tunic's cap sleeve reaches. */
const SLEEVE_END = 0.55;
/** The sleeve is padded over the arm inside it, which is what makes it cloth. */
const SLEEVE_BULK = 0.012;
const SLEEVE_TAPER = 0.75;

/**
 * The arm, with the tunic's cap sleeve over the top of it.
 *
 * The sleeve is drawn here rather than with the garment because it has to follow
 * the arm through its swing: without it the shoulder is an unbroken column of
 * fur running out of a green shape, and the eye reads no arm at all.
 */
function drawArm(ctx: Ctx, chain: BoneChain, curl: number, shade: number): void {
  drawLimb(ctx, chain, ARM_SHAPE, FUR, shade);
  drawPaw(ctx, chain.end, wristAngle(chain), curl, shade);

  const cuff = mixPt(chain.root, chain.joint, SLEEVE_END);
  const rootWidth = ARM_SHAPE.root + SLEEVE_BULK;
  const cuffWidth = lerp(ARM_SHAPE.root, ARM_SHAPE.joint, SLEEVE_END) + SLEEVE_BULK * SLEEVE_TAPER;
  outlineCapsule(ctx, chain.root, cuff, rootWidth, cuffWidth);
  fillCapsule(ctx, chain.root, cuff, rootWidth, cuffWidth, mix(TUNIC.mid, OUTLINE, shade));
  sheenSegment(ctx, chain.root, cuff, rootWidth, mix(TUNIC.light, OUTLINE, shade), SHEEN_ALPHA);
}

function drawLeg(
  ctx: Ctx,
  chain: BoneChain,
  foot: FootPose,
  view: ViewSpec,
  outward: number,
  shade: number,
): void {
  drawLimb(ctx, chain, legShapeFor(foot.nearness), FUR, shade);
  if (view.profile) drawFootProfile(ctx, chain.end, foot, FUR, shade);
  else drawFootFacing(ctx, chain.end, foot, view, outward, FUR, shade);
}

// ── Tail ─────────────────────────────────────────────────────────────────────

const TAIL_LENGTH = 1.02;
const TAIL_SEGMENTS = 14;
/**
 * A tail is a rope, not a limb. At half again this width the first pass baked a
 * pink slab as thick as his own thigh, which read as a trunk rather than as a
 * tail however well it was posed — the taper is the whole shape.
 */
const TAIL_ROOT_WIDTH = 0.036;
const TAIL_TIP_WIDTH = 0.006;
/** Radians of the travelling wave packed into the tail's own length. */
const TAIL_WAVE_TURNS = 1.6;
/**
 * How much harder the tip bends than the root. A tail leaves the rump nearly
 * straight and does its curving toward the end; spread evenly the root becomes a
 * hook growing out of his back.
 */
const TAIL_TIP_BEND_RATIO = 2;
/** Faint rings down the tail; a bare rodent tail is scaled, not smooth. */
const TAIL_RINGS = 9;
const TAIL_RING_ALPHA = 0.3;
const TAIL_RING_WIDTH = 0.006;
const TAIL_RING_START = 0.18;
/** Where on the rump the tail roots, relative to the hip. */
const TAIL_ROOT_BACK = PROFILE_TORSO.hipTrail * 0.9;
/**
 * Level with the hip, which puts the root under the tunic's back hem: the tail
 * emerges from beneath the garment rather than sprouting off the top of it.
 */
const TAIL_ROOT_RISE = 0;

/**
 * How the tail is carried in one view.
 *
 * It cannot be one shape scaled: edge-on the tail is the longest thing in the
 * silhouette, head-on it is behind him and barely shows, and from behind it
 * hangs down the middle over his own legs. Only the sway carries across, which
 * is why `base` is an absolute direction the pose's own deviation is added to
 * rather than a value the pose supplies outright.
 */
interface TailCarriage {
  readonly root: Pt;
  readonly base: number;
  readonly curlScale: number;
  readonly lengthScale: number;
  /**
   * How much of its own thickness it keeps.
   *
   * A tail swung toward the camera is shorter *and* fatter, and the second half
   * matters more: at its profile width the head-on tail came out one screen
   * pixel across, in a brown indistinguishable from the leg beside it, and it
   * dropped below a pixel entirely for half of every cycle.
   */
  readonly girth: number;
  /**
   * How much of the stride's own tail swing this view shows. Head-on the swing
   * is mostly toward and away from the camera, so applying it in full rotates
   * the tail across the picture instead and its drawn area doubles and halves
   * once a cycle — a flicker, not a sway.
   */
  readonly baseSwingScale: number;
}

const TAIL_CARRIAGE: Record<RatKinView, TailCarriage> = {
  side: {
    root: { x: -TAIL_ROOT_BACK, y: -TAIL_ROOT_RISE },
    base: REST_TAIL_BASE,
    curlScale: 1,
    lengthScale: 1,
    girth: 1,
    baseSwingScale: 1,
  },
  // Head-on it swings out past one hip and hangs clear of both legs. Two rules,
  // both learned the hard way: it must never be routed *down the midline* — a
  // pale tapering shape hanging between the legs of a naked-tailed biped reads
  // as something else entirely — and it must never be so short it disappears,
  // because then two of his four facings have no rodent cue below the neck.
  front: {
    root: { x: -0.055, y: 0.06 },
    base: deg(146),
    curlScale: 0.5,
    lengthScale: 0.62,
    girth: 1.7,
    baseSwingScale: 0.35,
  },
  // From behind, swept out to the same side and drawn *behind* the legs, for the
  // same two reasons as the front. Hanging it down the centre over his own legs
  // is anatomically defensible and completely unusable.
  away: {
    root: { x: 0.05, y: 0.06 },
    base: deg(34),
    // Negative, because this view aims the tail out to the *right* while the
    // other two aim it left: the curl has to arc downward from wherever the base
    // points, and "downward" is a turn of the opposite sign on the opposite side.
    curlScale: -0.62,
    lengthScale: 0.68,
    girth: 1.7,
    baseSwingScale: 0.35,
  },
};

/** The points down the tail's spine, root first. */
function tailSpine(root: Pt, tail: TailPose, lengthScale: number): Pt[] {
  const step = (TAIL_LENGTH * lengthScale) / TAIL_SEGMENTS;
  // Normalised so the accumulated bend comes to `curl` whatever the bias is.
  const meanWeight = (1 + TAIL_TIP_BEND_RATIO) / 2;
  const points: Pt[] = [root];
  let here = root;
  let angle = tail.base;
  for (let i = 0; i < TAIL_SEGMENTS; i++) {
    // Midpoint sampling, so the weights average exactly `meanWeight` and the
    // accumulated bend comes to `curl`. Sampling at the segment's near edge
    // instead lands the mean low and the tail curls a couple of percent short.
    const t = (i + MIDPOINT) / TAIL_SEGMENTS;
    const weight = 1 + t * (TAIL_TIP_BEND_RATIO - 1);
    angle +=
      (tail.curl / TAIL_SEGMENTS) * (weight / meanWeight) +
      Math.sin(tail.phase + t * TAIL_WAVE_TURNS * TWO_PI) * tail.wave;
    here = offset(here, Math.cos(angle) * step, Math.sin(angle) * step);
    points.push(here);
  }
  return points;
}

function drawTail(ctx: Ctx, root: Pt, tail: TailPose, carriage: TailCarriage): void {
  const spine = tailSpine(root, tail, carriage.lengthScale);
  const lastIndex = spine.length - 1;
  const widthAt = (i: number): number =>
    lerp(TAIL_ROOT_WIDTH, TAIL_TIP_WIDTH, i / lastIndex) * carriage.girth;

  for (let i = 0; i < lastIndex; i++) {
    outlineCapsule(ctx, spine[i], spine[i + 1], widthAt(i), widthAt(i + 1));
  }
  for (let i = 0; i < lastIndex; i++) {
    fillCapsule(ctx, spine[i], spine[i + 1], widthAt(i), widthAt(i + 1), TAIL_SKIN.mid);
  }
  sheenSegment(
    ctx,
    spine[0],
    spine[Math.floor(lastIndex / 2)],
    widthAt(0),
    TAIL_SKIN.light,
    SHEEN_ALPHA,
  );

  ctx.save();
  ctx.globalAlpha = TAIL_RING_ALPHA;
  ctx.strokeStyle = TAIL_SKIN.dark;
  ctx.lineWidth = TAIL_RING_WIDTH;
  for (let i = 0; i < TAIL_RINGS; i++) {
    const t = TAIL_RING_START + (i / TAIL_RINGS) * (1 - TAIL_RING_START);
    const index = Math.min(lastIndex - 1, Math.floor(t * lastIndex));
    const here = spine[index];
    const normal = angleBetween(here, spine[index + 1]) + HALF_PI;
    const half = widthAt(index);
    ctx.beginPath();
    ctx.moveTo(here.x + Math.cos(normal) * half, here.y + Math.sin(normal) * half);
    ctx.lineTo(here.x - Math.cos(normal) * half, here.y - Math.sin(normal) * half);
    ctx.stroke();
  }
  ctx.restore();
}

// ── Torso ────────────────────────────────────────────────────────────────────

const CHEST_RUFF_TUFTS = 5;
const CHEST_RUFF_TUFT = 0.014;
const CHEST_RUFF_BULGE = 0.036;
const RUMP_TUFTS = 4;
const RUMP_TUFT = 0.016;
const RUMP_BULGE = 0.03;
/**
 * A rodent is countershaded, and the pale band up the front is what stops the
 * torso reading as one brown slab at tile size.
 */
const BELLY_ALPHA = 0.85;
const BELLY_INSET = 0.32;
/** A fur edge is bowed to the left of its own direction of travel. */
const BOW_LEFT = -1;

/**
 * The bare torso under the tunic: throat, chest, belly and rump, so the tunic's
 * neck and hem open onto fur rather than onto nothing.
 */
function drawTorsoFur(ctx: Ctx, skeleton: Skeleton, pose: RatKinPose, view: ViewSpec): void {
  const { hip, waist, chest, neck } = skeleton;
  const span = breathed(view.torso, pose.breath);
  const throatFront = pt(neck.x + span.shoulderLead * NECK_NARROW, neck.y);
  const throatBack = pt(neck.x - span.shoulderTrail * NECK_NARROW, neck.y);
  const bellyFront = pt(hip.x + span.hipLead, hip.y);
  const rumpBack = pt(hip.x - span.hipTrail, hip.y);

  fillOutlined(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(throatFront.x, throatFront.y);
      traceFurEdge(
        ctx,
        throatFront,
        bellyFront,
        CHEST_RUFF_BULGE,
        CHEST_RUFF_TUFTS,
        CHEST_RUFF_TUFT,
        BOW_LEFT,
      );
      ctx.lineTo(rumpBack.x, rumpBack.y);
      traceFurEdge(ctx, rumpBack, throatBack, RUMP_BULGE, RUMP_TUFTS, RUMP_TUFT, BOW_LEFT);
      ctx.closePath();
    },
    FUR.mid,
    BODY_OUTLINE_WIDTH,
  );

  ctx.save();
  ctx.globalAlpha = BELLY_ALPHA;
  ctx.beginPath();
  ctx.moveTo(throatFront.x, throatFront.y);
  ctx.quadraticCurveTo(chest.x + span.chestLead, chest.y, waist.x + span.waistLead, waist.y);
  ctx.quadraticCurveTo(bellyFront.x, bellyFront.y, hip.x + span.hipLead * BELLY_INSET, hip.y);
  ctx.quadraticCurveTo(waist.x + span.waistLead * BELLY_INSET, waist.y, chest.x, chest.y);
  ctx.closePath();
  ctx.fillStyle = BELLY_FUR.mid;
  ctx.fill();
  ctx.restore();
}

const TUNIC_HEM_DROP = 0.3;
const TUNIC_COLLAR_RISE = 0.045;
const TUNIC_HEM_FLARE = 1.24;
const TUNIC_HEM_SWAY = 0.05;
const TUNIC_HEM_SAG = 0.03;
/** A shadow down the far side, so the tunic wraps a body instead of facing one. */
const TUNIC_SHADE_ALPHA = 0.55;
const TUNIC_SHADE_WIDTH = 0.055;
const STRAP_WIDTH = 0.024;
const STRAP_AT = 0.5;
const STRAP_DROP = 0.06;
const BELT_AT = 0.52;
const BELT_HEIGHT = 0.042;
const BUCKLE_WIDTH = 0.045;
const BUCKLE_INSET = 0.62;
const POUCH_WIDTH = 0.075;
const POUCH_HEIGHT = 0.085;
const POUCH_BACK = 0.1;
const POUCH_ROUND = 0.3;

/** Traces a rounded rectangle; `roundRect` is not on node-canvas' context. */
function traceRoundRect(
  ctx: Ctx,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number,
): void {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

/** A patched, belted tunic ending above the knee so the legs stay legible. */
function drawTunic(ctx: Ctx, skeleton: Skeleton, pose: RatKinPose, view: ViewSpec): void {
  const { hip, waist, chest, shoulder } = skeleton;
  const span = breathed(view.torso, pose.breath);
  const hemY = hip.y + TUNIC_HEM_DROP;
  const sway = pose.hemSway * TUNIC_HEM_SWAY;
  const hemFront = hip.x + span.hipLead * TUNIC_HEM_FLARE + sway;
  const hemBack = hip.x - span.hipTrail * TUNIC_HEM_FLARE + sway;
  const collarY = shoulder.y - TUNIC_COLLAR_RISE;

  fillOutlined(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(shoulder.x + span.shoulderLead, collarY);
      ctx.quadraticCurveTo(chest.x + span.chestLead, chest.y, waist.x + span.waistLead, waist.y);
      ctx.lineTo(hemFront, hemY);
      ctx.quadraticCurveTo(hip.x + sway, hemY + TUNIC_HEM_SAG, hemBack, hemY);
      ctx.lineTo(waist.x - span.waistTrail, waist.y);
      ctx.quadraticCurveTo(
        chest.x - span.chestTrail,
        chest.y,
        shoulder.x - span.shoulderTrail,
        collarY,
      );
      ctx.closePath();
    },
    TUNIC.mid,
    BODY_OUTLINE_WIDTH,
  );

  ctx.save();
  ctx.globalAlpha = TUNIC_SHADE_ALPHA;
  ctx.beginPath();
  ctx.moveTo(shoulder.x - span.shoulderTrail, shoulder.y);
  ctx.quadraticCurveTo(chest.x - span.chestTrail, chest.y, waist.x - span.waistTrail, waist.y);
  ctx.lineTo(hemBack, hemY);
  ctx.lineTo(hemBack + TUNIC_SHADE_WIDTH, hemY);
  ctx.quadraticCurveTo(
    chest.x - span.chestTrail + TUNIC_SHADE_WIDTH,
    chest.y,
    shoulder.x - span.shoulderTrail + TUNIC_SHADE_WIDTH,
    shoulder.y,
  );
  ctx.closePath();
  ctx.fillStyle = TUNIC.dark;
  ctx.fill();
  ctx.restore();

  // Mirrored from behind: the shoulder the strap crosses from is a fixed side of
  // his body, so it has to appear on the opposite side of the screen when the
  // camera goes round him. Left alone it reads as the strap jumping shoulders.
  const strapSide = view.showsBack ? -1 : 1;
  const strapTop = offset(shoulder, span.shoulderLead * STRAP_AT * strapSide, 0);
  const strapBottom = pt(waist.x - span.waistTrail * STRAP_AT * strapSide, waist.y + STRAP_DROP);
  outlineCapsule(ctx, strapTop, strapBottom, STRAP_WIDTH, STRAP_WIDTH);
  fillCapsule(ctx, strapTop, strapBottom, STRAP_WIDTH, STRAP_WIDTH, LEATHER.mid);

  const beltY = lerp(waist.y, hemY, BELT_AT);
  const beltFront = lerp(waist.x + span.waistLead, hemFront, BELT_AT);
  const beltBack = lerp(waist.x - span.waistTrail, hemBack, BELT_AT);
  fillOutlined(
    ctx,
    () => {
      ctx.beginPath();
      ctx.rect(beltBack, beltY - BELT_HEIGHT / 2, beltFront - beltBack, BELT_HEIGHT);
    },
    LEATHER.mid,
    DETAIL_OUTLINE_WIDTH,
  );
  ctx.fillStyle = BUCKLE;
  ctx.fillRect(
    beltFront - BUCKLE_WIDTH,
    beltY - (BELT_HEIGHT * BUCKLE_INSET) / 2,
    BUCKLE_WIDTH,
    BELT_HEIGHT * BUCKLE_INSET,
  );

  fillOutlined(
    ctx,
    () =>
      traceRoundRect(
        ctx,
        beltBack + POUCH_BACK,
        beltY,
        POUCH_WIDTH,
        POUCH_HEIGHT,
        POUCH_HEIGHT * POUCH_ROUND,
      ),
    LEATHER.dark,
    DETAIL_OUTLINE_WIDTH,
  );
}

// ── Head ─────────────────────────────────────────────────────────────────────

/**
 * The muzzle, measured forward from the skull's centre. This length is the whole
 * reason the head does not read as a cat's or a bear's, so it is the first thing
 * to move if the species is being misread.
 */
const MUZZLE_LENGTH = 0.3;
const MUZZLE_DROP = 0.048;
const MUZZLE_ROOT_HALF = 0.098;
const MUZZLE_TIP_HALF = 0.031;
/** Where along the skull's own radius the muzzle takes over the silhouette. */
const MUZZLE_ROOT_AT = 0.62;
/** Where the bridge's control point sits along the muzzle. */
const MUZZLE_BRIDGE = 0.72;
/** The bridge dips: a straight top line reads as a beak, not as a snout. */
const MUZZLE_BRIDGE_HALF = 1.5;
const SKULL_BROW_ARC = 0.9;
const SKULL_CHEEK_ARC = 0.9;
const CHEEK_BAND = 0.042;

const NOSE_R = 0.028;
/**
 * Forward of the skull's centre and barely above it, which is where a rodent's
 * eye actually sits — far enough down the head that the ear above it cannot
 * reach, and far enough forward to read against the muzzle rather than the ear.
 */
const EYE_X = 0.055;
const EYE_Y = -0.012;
const EYE_R = 0.033;
const EYE_GLINT_R = 0.011;
const EYE_GLINT_OFFSET = 0.011;
const EYE_SHUT_THRESHOLD = 0.25;
const EYE_LID_WIDTH = 0.011;

/**
 * The ears sit high on the back of the skull, and how high is load-bearing: at
 * the crown's own height the near ear covered the eye outright, and a rat kin
 * with no eye reads as a headless lump wearing a snout.
 */
const EAR_X = -0.06;
/**
 * Matched to the head-on pair's own crown clearance. Perched much higher than
 * they are, the figure visibly grows a pixel or two the moment he turns to
 * profile — the ear is the topmost ink in both views, so it sets his height.
 */
const EAR_Y = -0.152;
const EAR_FLATTEN = 0.92;
const EAR_LEAN = deg(-18);
/**
 * The membrane, as a share of the ear. Much past this the pink swallows the ear
 * whole and it stops reading as an ear at all — it becomes a bubble stuck to his
 * head. The fur rim outside it is what says "ear".
 */
/**
 * The membrane, as a share of the ear. Kept well under half the disc's area: it
 * is the brightest value on the whole figure and it sits at the very top of it,
 * so a large one drags the eye to his scalp and away from his face.
 */
const EAR_INNER = 0.46;
/** The membrane sits low and forward, where the ear canal is. */
const EAR_INNER_DROP = 0.18;
const EAR_INNER_LEAD = 0.1;
const EAR_RIM_WIDTH = 0.012;
const EAR_RIM_ALPHA = 0.45;
const EAR_RIM_AT = 0.86;
const EAR_RIM_FROM = deg(120);
const EAR_RIM_TO = deg(330);
/**
 * How much smaller, darker and further back the far ear is drawn.
 *
 * The offset has to clear the near ear's own radius or the far one hides behind
 * it completely and he reads as having one ear — which is exactly what half the
 * near ear's radius produced. What should show is a crescent, and that crescent
 * is the only depth the head has.
 */
const FAR_EAR_SHRINK = 0.82;
const FAR_EAR_SHADE = 0.42;
/**
 * Far enough back to show a crescent, near enough that the near ear and the
 * skull still hide most of it. Clear of both, the pair draws as two whole discs
 * side by side above the cranium — a topknot rather than a head with ears.
 */
const FAR_EAR_BACK = 0.062;
const FAR_EAR_RISE = 0.016;

const INCISOR_LENGTH = 0.033;
const INCISOR_WIDTH = 0.013;
/** Half the gap between the two chisels, along the jawline. */
const INCISOR_SPLIT = 0.013;
const INCISOR_TAPER = 0.55;
/**
 * How far along the underjaw, from the cheek to the nose, the incisors sit.
 *
 * Right at the tip. Set back even a seventh of the muzzle's length the pair
 * reads as a boar's tusk hanging out of the side of his face rather than as the
 * chisel a rodent has at the very front of its jaw.
 */
const INCISOR_AT = 0.965;
const INCISOR_LEAN = deg(24);
const JAW_DROP = 0.05;

const WHISKER_COUNT = 2;
const WHISKER_LENGTH = 0.19;
const WHISKER_FAN = deg(26);
/**
 * Faint on purpose. At full value the fan survives the downsample to a 32px tile
 * as a solid bright bar off the nose, which lengthens the snout by a couple of
 * game pixels and gives it a blunt paddle end.
 */
const WHISKER_ALPHA = 0.38;
const WHISKER_WIDTH = 0.005;
const WHISKER_DROOP = 0.035;
const WHISKER_ROOT_AT = 0.62;

const SNIFF_REACH = 0.012;
const SNIFF_LIFT = 0.022;

/** One ear: an outer disc, an inner membrane, and a rim of fur outside it. */
function drawEar(
  ctx: Ctx,
  centre: Pt,
  tilt: number,
  scale: number,
  shade: number,
  membraneAlpha = 1,
): void {
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(tilt);
  ctx.scale(scale, scale);
  fillOutlined(
    ctx,
    () => {
      ctx.beginPath();
      ctx.ellipse(0, 0, EAR_R, EAR_R * EAR_FLATTEN, EAR_LEAN, 0, TWO_PI);
    },
    mix(FUR.mid, OUTLINE, shade),
    BODY_OUTLINE_WIDTH,
  );
  ctx.beginPath();
  ctx.ellipse(
    EAR_INNER_LEAD * EAR_R,
    EAR_INNER_DROP * EAR_R,
    EAR_R * EAR_INNER,
    EAR_R * EAR_FLATTEN * EAR_INNER,
    EAR_LEAN,
    0,
    TWO_PI,
  );
  ctx.save();
  ctx.globalAlpha = membraneAlpha;
  ctx.fillStyle = mix(SKIN.mid, OUTLINE, shade);
  ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.globalAlpha = EAR_RIM_ALPHA;
  ctx.strokeStyle = mix(FUR.light, OUTLINE, shade);
  ctx.lineWidth = EAR_RIM_WIDTH;
  ctx.beginPath();
  ctx.ellipse(
    0,
    0,
    EAR_R * EAR_RIM_AT,
    EAR_R * EAR_FLATTEN * EAR_RIM_AT,
    EAR_LEAN,
    EAR_RIM_FROM,
    EAR_RIM_TO,
  );
  ctx.stroke();
  ctx.restore();
  ctx.restore();
}

/**
 * The head seen edge-on, painted about its own centre with +X forward. Rotating
 * and placing it is the caller's job.
 */
function drawHeadProfile(ctx: Ctx, pose: RatKinPose): void {
  const sniff = clamp01(pose.sniff);
  const noseX = MUZZLE_LENGTH + sniff * SNIFF_REACH;
  const noseY = MUZZLE_DROP - sniff * SNIFF_LIFT;
  const muzzleRootX = SKULL_RX * MUZZLE_ROOT_AT;
  const jawY = MUZZLE_ROOT_HALF + MUZZLE_DROP;
  // One control point for the jawline, shared by the silhouette and the pale
  // band inside it. Opening the jaw in only one of them slides a wedge of back
  // fur out from under the countershading every time he sniffs.
  const jawControlY = noseY + MUZZLE_TIP_HALF + JAW_DROP * sniff;

  drawEar(
    ctx,
    pt(EAR_X - FAR_EAR_BACK, EAR_Y - FAR_EAR_RISE),
    pose.earFar,
    FAR_EAR_SHRINK,
    FAR_EAR_SHADE,
  );

  // Skull and muzzle as one silhouette: an outline that stops between them cuts
  // the head in two at tile size, where the seam is a whole pixel wide.
  fillOutlined(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(0, -SKULL_RY);
      ctx.quadraticCurveTo(
        SKULL_RX * SKULL_BROW_ARC,
        -SKULL_RY,
        muzzleRootX,
        -MUZZLE_ROOT_HALF + MUZZLE_DROP,
      );
      ctx.quadraticCurveTo(
        noseX * MUZZLE_BRIDGE,
        noseY - MUZZLE_TIP_HALF * MUZZLE_BRIDGE_HALF,
        noseX,
        noseY - MUZZLE_TIP_HALF,
      );
      ctx.quadraticCurveTo(noseX + MUZZLE_TIP_HALF, noseY, noseX, noseY + MUZZLE_TIP_HALF);
      ctx.quadraticCurveTo(noseX * MUZZLE_BRIDGE, jawControlY, muzzleRootX, jawY);
      ctx.quadraticCurveTo(SKULL_RX * SKULL_CHEEK_ARC, SKULL_RY, 0, SKULL_RY);
      ctx.quadraticCurveTo(-SKULL_RX, SKULL_RY, -SKULL_RX, 0);
      ctx.quadraticCurveTo(-SKULL_RX, -SKULL_RY, 0, -SKULL_RY);
      ctx.closePath();
    },
    FUR.mid,
    BODY_OUTLINE_WIDTH,
  );

  // A paler cheek and underjaw, matching the torso's countershading.
  ctx.save();
  ctx.globalAlpha = BELLY_ALPHA;
  ctx.beginPath();
  ctx.moveTo(muzzleRootX, jawY);
  ctx.quadraticCurveTo(noseX * MUZZLE_BRIDGE, jawControlY, noseX, noseY + MUZZLE_TIP_HALF);
  ctx.quadraticCurveTo(
    noseX * MUZZLE_BRIDGE,
    noseY + MUZZLE_TIP_HALF - CHEEK_BAND,
    muzzleRootX,
    jawY - CHEEK_BAND,
  );
  ctx.closePath();
  ctx.fillStyle = BELLY_FUR.mid;
  ctx.fill();
  ctx.restore();

  // Incisors before the nose, so the nose caps the muzzle's tip cleanly.
  const incisorRoot = pt(
    lerp(muzzleRootX, noseX, INCISOR_AT),
    lerp(jawY, noseY + MUZZLE_TIP_HALF, INCISOR_AT),
  );
  const incisorTip = offset(
    incisorRoot,
    Math.sin(INCISOR_LEAN) * INCISOR_LENGTH,
    Math.cos(INCISOR_LEAN) * INCISOR_LENGTH,
  );
  // A *pair*, with a dark split down the middle. One block reads as a boar's
  // tusk or as a chip of bone stuck to his lip; the split is what says rodent.
  for (const side of [-1, 1]) {
    // Square to the tooth's own axis, not to the jawline: offset along anything
    // else slides the two chisels down each other's length and they merge.
    const acrossX = Math.cos(INCISOR_LEAN) * INCISOR_SPLIT * side;
    const acrossY = -Math.sin(INCISOR_LEAN) * INCISOR_SPLIT * side;
    const root = offset(incisorRoot, acrossX, acrossY);
    const tip = offset(incisorTip, acrossX, acrossY);
    outlineCapsule(ctx, root, tip, INCISOR_WIDTH, INCISOR_WIDTH * INCISOR_TAPER);
    fillCapsule(ctx, root, tip, INCISOR_WIDTH, INCISOR_WIDTH * INCISOR_TAPER, INCISOR);
  }

  ctx.beginPath();
  ctx.arc(noseX, noseY, NOSE_R, 0, TWO_PI);
  ctx.fillStyle = SKIN.dark;
  ctx.fill();

  ctx.save();
  ctx.globalAlpha = WHISKER_ALPHA;
  ctx.strokeStyle = WHISKER;
  ctx.lineWidth = WHISKER_WIDTH;
  ctx.lineCap = 'round';
  const whiskerRoot = pt(
    lerp(muzzleRootX, noseX, WHISKER_ROOT_AT),
    lerp(jawY, noseY, WHISKER_ROOT_AT),
  );
  for (let i = 0; i < WHISKER_COUNT; i++) {
    const fan = (i / (WHISKER_COUNT - 1) - MIDPOINT) * WHISKER_FAN * (1 + sniff);
    const droop = WHISKER_DROOP * (1 - sniff);
    ctx.beginPath();
    ctx.moveTo(whiskerRoot.x, whiskerRoot.y);
    ctx.quadraticCurveTo(
      whiskerRoot.x + Math.cos(fan) * WHISKER_LENGTH * MIDPOINT,
      whiskerRoot.y + Math.sin(fan) * WHISKER_LENGTH * MIDPOINT + droop * MIDPOINT,
      whiskerRoot.x + Math.cos(fan) * WHISKER_LENGTH,
      whiskerRoot.y + Math.sin(fan) * WHISKER_LENGTH + droop,
    );
    ctx.stroke();
  }
  ctx.restore();

  const open = 1 - clamp01(pose.blink);
  if (open > EYE_SHUT_THRESHOLD) {
    ctx.beginPath();
    ctx.ellipse(EYE_X, EYE_Y, EYE_R, EYE_R * open, 0, 0, TWO_PI);
    ctx.fillStyle = EYE_BEAD;
    ctx.fill();
    ctx.beginPath();
    ctx.arc(EYE_X - EYE_GLINT_OFFSET, EYE_Y - EYE_GLINT_OFFSET, EYE_GLINT_R * open, 0, TWO_PI);
    ctx.fillStyle = EYE_GLINT;
    ctx.fill();
  } else {
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = EYE_LID_WIDTH;
    ctx.beginPath();
    ctx.moveTo(EYE_X - EYE_R, EYE_Y);
    ctx.lineTo(EYE_X + EYE_R, EYE_Y);
    ctx.stroke();
  }

  drawEar(ctx, pt(EAR_X, EAR_Y), pose.earNear, 1, UNSHADED);
}

/**
 * Head-on, the skull is narrower than it is deep and the muzzle points at the
 * camera — so it draws as a short wedge hanging *down* off the face rather than
 * as the long snout the profile shows. Two radii, not one: a round head makes
 * any muzzle under it read as a bulge on a ball.
 */
const SKULL_FACING_RX = 0.126;
/** How much of its length the muzzle keeps once it is pointed at the viewer. */
const MUZZLE_FACING_LENGTH = MUZZLE_LENGTH * 0.42;
const MUZZLE_FACING_HALF = 0.062;
const MUZZLE_FACING_TIP_HALF = 0.03;
const EYE_FACING_X = 0.062;
const EYE_FACING_Y = -0.022;
/**
 * Head-on the ears sit on the *sides* of the skull, not on top of it.
 *
 * Two rules, and they pull against each other. Rise above the cranium's crown
 * line with a dip between and the pair collapses at a 32px tile into a valentine
 * heart. Sit at eye level and they read as earmuffs. What satisfies both is
 * *wide and flush*: rooted out past the skull's half width, with their tops level
 * with the crown, so the silhouette is a dome with a lobe either side and the
 * skull — drawn over them — hides their inner halves before they reach the eyes.
 */
const EAR_FACING_X = 0.126;
const EAR_FACING_Y = -0.079;
/**
 * Smaller head-on, where the pair has to share the head's own width.
 *
 * The disc's diameter against the cranium's is the whole read: much past two
 * thirds and they stop being ears and become a mouse's, or a koala's. Placed
 * *high* and almost touching, so the crown is one dome with a bump either side —
 * wide apart at eye level they read as earmuffs, and wide apart with a dip
 * between them they read as a valentine heart.
 */
const EAR_FACING_SCALE = 0.78;
/** The ears splay outward, so each is rotated away from the centreline. */
const EAR_FACING_SPLAY = deg(21);
/** Which side of the drawing each ear is on, head-on. */
const FACING_RIGHT_EAR = 1;
const FACING_LEFT_EAR = -1;
const WHISKER_FACING_LENGTH = 0.14;
const WHISKER_FACING_FAN = deg(20);
/** Seen from behind, the ear shows its furred back rather than its membrane. */
const EAR_BACK_MEMBRANE_ALPHA = 0.2;
const NAPE_TUFTS = 5;
const NAPE_TUFT = 0.013;
const NAPE_BULGE = 0.018;

/**
 * The head seen head-on or from behind. `toward` is +1 for the face and −1 for
 * the back of the head, and it is what mirrors the parts that are not symmetric.
 */
function drawHeadFacing(ctx: Ctx, pose: RatKinPose, view: ViewSpec): void {
  const sniff = clamp01(pose.sniff);
  const muzzleTipY = SKULL_RY * MUZZLE_FACING_DROP + MUZZLE_FACING_LENGTH - sniff * SNIFF_LIFT;

  // Each ear takes its own rotation. Driving both from `earNear` throws away
  // `earFar` outright, and a pair that twitches as one rigid unit reads as a
  // hairband rather than as two ears.
  for (const side of [FACING_RIGHT_EAR, FACING_LEFT_EAR]) {
    const tilt = side === FACING_RIGHT_EAR ? pose.earNear : pose.earFar;
    drawEar(
      ctx,
      pt(EAR_FACING_X * side, EAR_FACING_Y),
      (tilt + EAR_FACING_SPLAY) * side,
      EAR_FACING_SCALE,
      UNSHADED,
      view.showsBack ? EAR_BACK_MEMBRANE_ALPHA : 1,
    );
  }

  fillOutlined(
    ctx,
    () => {
      ctx.beginPath();
      ctx.moveTo(0, -SKULL_RY);
      ctx.quadraticCurveTo(SKULL_FACING_RX, -SKULL_RY, SKULL_FACING_RX, 0);
      if (view.showsFace) {
        // The muzzle hangs off the front of the face, so the jawline runs into it
        // instead of closing the skull's own oval.
        ctx.quadraticCurveTo(
          SKULL_FACING_RX,
          SKULL_RY * SKULL_CHEEK_ARC,
          MUZZLE_FACING_HALF,
          SKULL_RY * MUZZLE_FACING_DROP,
        );
        ctx.lineTo(MUZZLE_FACING_TIP_HALF, muzzleTipY);
        ctx.quadraticCurveTo(
          0,
          muzzleTipY + MUZZLE_FACING_TIP_HALF,
          -MUZZLE_FACING_TIP_HALF,
          muzzleTipY,
        );
        ctx.lineTo(-MUZZLE_FACING_HALF, SKULL_RY * MUZZLE_FACING_DROP);
        ctx.quadraticCurveTo(-SKULL_FACING_RX, SKULL_RY * SKULL_CHEEK_ARC, -SKULL_FACING_RX, 0);
      } else {
        // From behind the head is one soft mass, and the nape is where the fur
        // breaks it — a clean oval reads as a helmet.
        ctx.quadraticCurveTo(SKULL_FACING_RX, SKULL_RY, 0, SKULL_RY);
        traceFurEdge(
          ctx,
          pt(0, SKULL_RY),
          pt(-SKULL_FACING_RX, 0),
          NAPE_BULGE,
          NAPE_TUFTS,
          NAPE_TUFT,
          BOW_LEFT,
        );
      }
      ctx.quadraticCurveTo(-SKULL_FACING_RX, -SKULL_RY, 0, -SKULL_RY);
      ctx.closePath();
    },
    FUR.mid,
    BODY_OUTLINE_WIDTH,
  );

  if (!view.showsFace) return;

  // The pale muzzle and throat, matching the torso's countershading.
  ctx.save();
  ctx.globalAlpha = BELLY_ALPHA;
  ctx.beginPath();
  ctx.moveTo(MUZZLE_FACING_HALF, SKULL_RY * MUZZLE_FACING_DROP);
  ctx.lineTo(MUZZLE_FACING_TIP_HALF, muzzleTipY);
  ctx.quadraticCurveTo(0, muzzleTipY + MUZZLE_FACING_TIP_HALF, -MUZZLE_FACING_TIP_HALF, muzzleTipY);
  ctx.lineTo(-MUZZLE_FACING_HALF, SKULL_RY * MUZZLE_FACING_DROP);
  ctx.closePath();
  ctx.fillStyle = BELLY_FUR.mid;
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = WHISKER_ALPHA;
  ctx.strokeStyle = WHISKER;
  ctx.lineWidth = WHISKER_WIDTH;
  ctx.lineCap = 'round';
  const whiskerY = lerp(SKULL_RY * MUZZLE_FACING_DROP, muzzleTipY, WHISKER_ROOT_AT);
  for (const side of [-1, 1]) {
    for (let i = 0; i < WHISKER_COUNT; i++) {
      const fan = (i / (WHISKER_COUNT - 1) - MIDPOINT) * WHISKER_FACING_FAN * (1 + sniff);
      ctx.beginPath();
      ctx.moveTo(MUZZLE_FACING_TIP_HALF * side, whiskerY);
      ctx.lineTo(
        (MUZZLE_FACING_TIP_HALF + Math.cos(fan) * WHISKER_FACING_LENGTH) * side,
        whiskerY + Math.sin(fan) * WHISKER_FACING_LENGTH + WHISKER_DROOP * (1 - sniff),
      );
      ctx.stroke();
    }
  }
  ctx.restore();

  const incisorTop = muzzleTipY - MUZZLE_FACING_TIP_HALF * INCISOR_FACING_LIFT;
  for (const side of [-1, 1]) {
    const x = (INCISOR_WIDTH + INCISOR_FACING_SPLIT) * side;
    const root = pt(x, incisorTop);
    const tip = pt(x, incisorTop + INCISOR_LENGTH);
    // Outlined like every other detail: against the pale muzzle band an
    // unoutlined tooth is a low-contrast smudge once the sheet is halved.
    outlineCapsule(ctx, root, tip, INCISOR_WIDTH, INCISOR_WIDTH * INCISOR_TAPER);
    fillCapsule(ctx, root, tip, INCISOR_WIDTH, INCISOR_WIDTH * INCISOR_TAPER, INCISOR);
  }

  ctx.beginPath();
  ctx.ellipse(
    0,
    muzzleTipY - NOSE_R * NOSE_FACING_LIFT,
    NOSE_R,
    NOSE_R * NOSE_FACING_FLATTEN,
    0,
    0,
    TWO_PI,
  );
  ctx.fillStyle = SKIN.dark;
  ctx.fill();

  const open = 1 - clamp01(pose.blink);
  for (const side of [-1, 1]) {
    const eyeX = EYE_FACING_X * side;
    if (open > EYE_SHUT_THRESHOLD) {
      ctx.beginPath();
      ctx.ellipse(eyeX, EYE_FACING_Y, EYE_R, EYE_R * open, 0, 0, TWO_PI);
      ctx.fillStyle = EYE_BEAD;
      ctx.fill();
      ctx.beginPath();
      ctx.arc(
        eyeX - EYE_GLINT_OFFSET,
        EYE_FACING_Y - EYE_GLINT_OFFSET,
        EYE_GLINT_R * open,
        0,
        TWO_PI,
      );
      ctx.fillStyle = EYE_GLINT;
      ctx.fill();
    } else {
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = EYE_LID_WIDTH;
      ctx.beginPath();
      ctx.moveTo(eyeX - EYE_R, EYE_FACING_Y);
      ctx.lineTo(eyeX + EYE_R, EYE_FACING_Y);
      ctx.stroke();
    }
  }
}

/** How far down the skull the muzzle takes over the silhouette, head-on. */
const MUZZLE_FACING_DROP = 0.52;
/** Half the dark gap between the two chisels, head-on. */
const INCISOR_FACING_SPLIT = 0.004;
const INCISOR_FACING_LIFT = 0.3;
const NOSE_FACING_LIFT = 0.5;
const NOSE_FACING_FLATTEN = 0.8;

// ── Figure ───────────────────────────────────────────────────────────────────

/** How much of the torso's lean the head copies; a level head reads alert. */
const HEAD_LEAN_FOLLOW = 0.35;

/**
 * Rim light down the figure's trailing edge, unifying the parts into one body.
 *
 * It traces the *tunic's* outline, not the bare torso's. Drawn after the garment
 * but measured off the body underneath, the highlight lands somewhere in the
 * middle of the cloth — a stripe rather than a rim — because the hem is flared
 * and the collar raised.
 */
function drawRimLight(ctx: Ctx, skeleton: Skeleton, pose: RatKinPose, view: ViewSpec): void {
  const span = view.torso;
  const { hip, chest, shoulder } = skeleton;
  const sway = pose.hemSway * TUNIC_HEM_SWAY;
  ctx.save();
  ctx.globalAlpha = RIM_ALPHA;
  ctx.strokeStyle = RIM_LIGHT;
  ctx.lineWidth = RIM_WIDTH;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(shoulder.x - span.shoulderTrail, shoulder.y - TUNIC_COLLAR_RISE);
  ctx.quadraticCurveTo(
    chest.x - span.chestTrail,
    chest.y,
    hip.x - span.hipTrail * TUNIC_HEM_FLARE + sway,
    hip.y + TUNIC_HEM_DROP,
  );
  ctx.stroke();
  ctx.restore();
}

/** Feet turn outward, away from the centreline, on both sides. */
const NEAR_FOOT_OUT = 1;
const FAR_FOOT_OUT = -1;

/**
 * The Rat Kin in one view.
 *
 * Draw order is depth order. Edge-on: the tail behind everything, then the far
 * limbs, the near leg over them, the clothed torso over the thighs, the head
 * over the collar, and the near arm last so it hangs in front of the tunic.
 * Head-on *both* arms hang in front of the torso — drawing the far one early,
 * which is correct in profile, makes him look one-armed. Walking away, both go
 * behind the back, which is what hides the forward half of an arm swing.
 */
function drawFigure(ctx: Ctx, view: ViewSpec, pose: RatKinPose): void {
  const skeleton = buildSkeleton(pose, view);
  // Centred between his feet, which is where his weight is. The hip is not a
  // candidate: it never moves sideways in any pose this figure has, so a
  // hip-following shadow is a constant dressed as a variable.
  //
  // Constant alpha, deliberately. An earlier version faded it as the feet left
  // the floor, which the ground-contact gate makes unreachable — he always has a
  // foot down — so the fade was a branch that could never run.
  const stanceCentre = (pose.nearFoot.ball.x + pose.farFoot.ball.x) / 2;
  drawGroundShadow(ctx, stanceCentre * SHADOW_FOLLOW, SHADOW_RX, CONTACT_SHADOW_ALPHA);

  const carriage = TAIL_CARRIAGE[viewNameOf(view)];
  // The sway is carried across from the pose as a *deviation* from its own rest,
  // so a view that aims the tail differently still gets the same motion.
  const tail: TailPose = {
    base: carriage.base + (pose.tail.base - REST_TAIL_BASE) * carriage.baseSwingScale,
    curl: pose.tail.curl * carriage.curlScale,
    wave: pose.tail.wave,
    phase: pose.tail.phase,
  };
  // Behind everything, in every view. From directly behind him a tail really
  // does hang between the viewer and his legs, but drawn that way it crosses
  // both of them and stops reading as a tail — so all three views sweep it out
  // to one side, where the body never occludes it in the first place.
  drawTail(ctx, offset(skeleton.hip, carriage.root.x, carriage.root.y), tail, carriage);

  // Edge-on the far arm is genuinely behind the body; head-on it is beside it.
  const farBehind = view.profile || pose.farArmBehind;
  const nearBehind = !view.profile && pose.nearArmBehind;
  const farArmShade = view.profile ? FAR_LIMB_SHADE : UNSHADED;
  if (farBehind) drawArm(ctx, skeleton.farArm, pose.farPaw, farArmShade);
  if (nearBehind) drawArm(ctx, skeleton.nearArm, pose.nearPaw, UNSHADED);

  // No depth shade on a head-on limb: it does not read as depth, it reads as two
  // different colours of fur. Only a true profile puts one limb behind the body.
  const farLegShade = view.profile ? FAR_LIMB_SHADE : UNSHADED;
  drawLeg(ctx, skeleton.farLeg, pose.farFoot, view, FAR_FOOT_OUT, farLegShade);
  drawLeg(ctx, skeleton.nearLeg, pose.nearFoot, view, NEAR_FOOT_OUT, UNSHADED);

  drawTorsoFur(ctx, skeleton, pose, view);
  drawTunic(ctx, skeleton, pose, view);
  drawRimLight(ctx, skeleton, pose, view);

  // The neck is drawn after the tunic so its fur sits over the collar, which is
  // what a head thrust forward out of a garment actually does.
  const neckTop = offset(skeleton.headCentre, 0, SKULL_RY * NECK_INTO_SKULL);
  outlineCapsule(ctx, skeleton.neck, neckTop, NECK_WIDTH, NECK_WIDTH * NECK_TAPER);
  // Part-way to the fur's own mid, not the full shadow: painted at `FUR.dark`
  // the collar is far darker than anything around it and punches a hole between
  // head and body at tile size, which reads as a detached head.
  fillCapsule(
    ctx,
    skeleton.neck,
    neckTop,
    NECK_WIDTH,
    NECK_WIDTH * NECK_TAPER,
    mix(FUR.dark, FUR.mid, NECK_SHADE_LIFT),
  );

  ctx.save();
  ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
  // Only the profile can show a nod or a lean: head-on both are rotations about
  // an axis pointing at the camera, and applying them there tips his whole head
  // sideways instead.
  if (view.profile) {
    ctx.rotate(pose.headPitch + pose.lean * HEAD_LEAN_FOLLOW);
    drawHeadProfile(ctx, pose);
  } else {
    drawHeadFacing(ctx, pose, view);
  }
  ctx.restore();

  if (!farBehind) drawArm(ctx, skeleton.farArm, pose.farPaw, farArmShade);
  if (!nearBehind) drawArm(ctx, skeleton.nearArm, pose.nearPaw, UNSHADED);
}

/** Which entry of `VIEWS` a spec came from, for the tables keyed by view name. */
function viewNameOf(view: ViewSpec): RatKinView {
  if (view.profile) return 'side';
  return view.showsBack ? 'away' : 'front';
}

/** The Rat Kin walking toward the camera. */
export function drawRatKinFront(ctx: Ctx, pose: RatKinPose): void {
  drawFigure(ctx, VIEWS.front, pose);
}

/** The Rat Kin walking away from the camera. */
export function drawRatKinAway(ctx: Ctx, pose: RatKinPose): void {
  drawFigure(ctx, VIEWS.away, pose);
}

/** The Rat Kin edge-on, always drawn facing +X; the runtime mirrors for the left. */
export function drawRatKinSide(ctx: Ctx, pose: RatKinPose): void {
  drawFigure(ctx, VIEWS.side, pose);
}
