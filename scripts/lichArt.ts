/**
 * Drawing engine for The Lich.
 *
 * The rig is the Skeleton Lord's — the same {@link SkeletonPose}, the same joint
 * heights, the same IK/FK contract — so the two creatures share a row vocabulary
 * and the choreography transfers between them without being re-derived. What is
 * entirely different is what gets painted over those joints.
 *
 * The Skeleton Lord's design is *open*: a robe framing a lit ribcage, and the
 * negative space between the ribs is the whole read. The Lich is the opposite —
 * a closed, near-black column of cloth with nothing showing but a jaw, two eye
 * points and a pair of hands. It has spent weeks impersonating a dead skyfowl
 * magistrate, signing his letters, and it still wears the office: a clerk's
 * stole down the chest, a frayed sash, a wax seal on a cord, cuffs stained with
 * the ink it forges in.
 *
 * Because it is near-black and fought indoors, **a rim light is not decoration,
 * it is the silhouette** — but the rim is deliberately *not* painted here. Every
 * form in this file is drawn with the same warm near-black outline the rest of
 * the repo uses, and the generator lays one cold edge light around the finished
 * figure's own alpha. Painted per form instead, as the first version did, the
 * rim lands on every internal seam and the creature reads as a neon sign in the
 * shape of a robe.
 *
 * Coordinates are tile units with the origin between the feet and +Y down the
 * screen, so heights above the ground are negative. The caller translates to
 * that ground point and scales by one tile before calling a painter. Three
 * viewpoints read the same pose: `front` (toward the camera), `back` (away) and
 * `side` (profile, always facing +X so the runtime can mirror it).
 *
 * The choreography that fills the pose lives in
 * `scripts/generate-lich-sprites.ts`.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

import {
  BONE,
  CAVITY,
  OUTLINE,
  TWO_PI,
  WITCH_BRIGHT,
  WITCH_CORE,
  clamp01,
  deg,
  fillCapsule,
  fillDisc,
  lerp,
  mix,
  outlineCapsule,
  outlineDisc,
  paintGlow,
  paintLongBone,
  rgba,
  type Pt,
  type SkeletonPose,
} from './skeletonArt.js';

const HALF_PI = Math.PI / 2;

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

// ── Colour ───────────────────────────────────────────────────────────────────

/** A five-stop value ramp, the shape `paintLongBone` expects. */
interface Ramp {
  readonly shadow: string;
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
  readonly rim: string;
}

/**
 * Rotted magistrate's wool. Near-black with a cold blue-green cast, because a
 * true black has nowhere left to go when a fold has to be darker than the plane
 * beside it.
 */
const CLOTH: Ramp = {
  shadow: '#0a0e12',
  dark: '#18212a',
  mid: '#232f39',
  light: '#35454f',
  rim: '#4d666d',
};

/**
 * The clerk's stole, sash and cuffs: old vellum, gone grey.
 *
 * The one mid-value on the figure, and deliberately dim: at the first pass this
 * was two bright bars down a black chest and the creature read as wearing a
 * ladder. It has to be findable, not the loudest thing on the sprite.
 */
const VELLUM: Ramp = {
  shadow: '#22231c',
  dark: '#383a2f',
  mid: '#545647',
  light: '#767762',
  rim: '#93937c',
};

/**
 * The inside of the cowl — the darkest value anywhere on the sheet.
 *
 * It has to be darker than the cloth around it by a clear margin, or the two
 * eye points sit on a grey patch and the hood reads as having a face in it.
 * There is no face; there is a hole with something burning at the back of it.
 */
const VOID = '#020304';

/** Iron-gall ink, blue-black, on the cuffs and blotted down the stole. */
const INK = '#131832';

/** The magistrate's seal, still on its cord: dull oxblood wax. */
const WAX_DARK = '#3f111a';
const WAX_MID = '#71212d';
const WAX_LIGHT = '#963a47';

/** Bone shows in exactly three places: the jaw, the hands and the feet. */
const LICH_BONE: Ramp = {
  shadow: mix(BONE.shadow, '#4d5145', 0.5),
  dark: mix(BONE.dark, '#6f7364', 0.5),
  mid: mix(BONE.mid, '#9ea08c', 0.45),
  light: mix(BONE.light, '#c3c4ad', 0.45),
  rim: mix(BONE.rim, '#dfe0c8', 0.45),
};

/**
 * The edge light the generator lays around the finished silhouette.
 *
 * Cold witch-green rather than white: the same light that burns in the eye
 * points, so the figure reads as lit by its own magic rather than by a lamp
 * nobody put in the room.
 */
export const LICH_RIM_EDGE = '#9df0ae';

const SHEEN_ALPHA = 0.32;
const CONTACT_SHADOW_ALPHA = 0.4;

/** Unit vector the key light arrives from, matching every other prop in the repo. */
const LIGHT: Pt = { x: -0.62, y: -0.78 };

/** Runs a light stroke down the lit side of a segment. */
function sheenSegment(ctx: Ctx, a: Pt, b: Pt, width: number, colour: string, alpha: number): void {
  const angle = angleBetween(a, b);
  const normal = angle + HALF_PI;
  const facing = Math.cos(normal) * LIGHT.x + Math.sin(normal) * LIGHT.y;
  const push = width * 0.42 * (facing >= 0 ? 1 : -1);
  const nx = Math.cos(normal) * push;
  const ny = Math.sin(normal) * push;
  fillCapsule(
    ctx,
    offset(a, nx, ny),
    offset(b, nx, ny),
    width * 0.3,
    width * 0.22,
    rgba(colour, alpha),
  );
}

// ── Proportions ──────────────────────────────────────────────────────────────
// Heights are negative: the origin sits between the feet and +Y runs down the
// screen. The rig is authored once at this height and the generator scales it at
// bake time — scaling the table instead silently redraws the choreography.

/** Authored standing height, crown of the hood to the floor. */
export const LICH_FIGURE_HEIGHT = 2.03;

const LEG_SLACK = 1.004;
const JOINT_SLACK = 0.0003;

const ANKLE_Y = -0.075;
const KNEE_Y = -0.55;
const HIP_Y = -LICH_FIGURE_HEIGHT / 2;
const WAIST_Y = -1.19;
export const LICH_SHOULDER_Y = -1.64;
const HEAD_CENTRE_Y = -1.88;

const THIGH_LENGTH = Math.abs(HIP_Y - KNEE_Y) * LEG_SLACK;
const SHIN_LENGTH = Math.abs(KNEE_Y - ANKLE_Y) * LEG_SLACK;
const UPPER_ARM_LENGTH = 0.35;
const FOREARM_LENGTH = 0.31;
/** Shoulder to wrist. A relaxed arm hangs at very nearly this. */
export const LICH_ARM_LENGTH = UPPER_ARM_LENGTH + FOREARM_LENGTH;
/** The arm's root hangs this far below the shoulder line, not on it. */
export const LICH_SHOULDER_JOINT_DROP = 0.05;

/**
 * Narrower across than the Skeleton Lord's clavicle span.
 *
 * Height alone does not read as gaunt — a taller figure at the same width is
 * simply a bigger one. The width has to come off with it, and the shoulders are
 * where the eye measures a bipedal figure's build.
 */
const SHOULDER_HALF = 0.225;
const FACING_SHOULDER_SPREAD = 1.14;
const LEG_ROOT_HALF = 0.09;
const ARM_INSET = 0.94;
const ARM_ROOT_HALF = SHOULDER_HALF * ARM_INSET;

/** Side-on the limbs gather onto the centreline while the trunk stays deep. */
const PROFILE_LATERAL = 0.3;
const PROFILE_GIRTH = 0.84;
const PROFILE_ARM_SPREAD = 0.14;

// ── Views ────────────────────────────────────────────────────────────────────

export type LichView = 'front' | 'back' | 'side';

interface ViewSpec {
  /** Multiplier on every lateral (x) body offset — where the limbs root. */
  readonly lateral: number;
  /** Multiplier on the drawn width of the robe, sash and hood. */
  readonly girth: number;
  /** How far apart the two shoulder joints are drawn. */
  readonly armSpread: number;
  readonly profile: boolean;
  /** True when the cowl's opening — jaw and eye points — faces the camera. */
  readonly showsFace: boolean;
  readonly showsBack: boolean;
}

const VIEWS: Record<LichView, ViewSpec> = {
  front: { lateral: 1, girth: 1, armSpread: 1, profile: false, showsFace: true, showsBack: false },
  back: { lateral: 1, girth: 1, armSpread: 1, profile: false, showsFace: false, showsBack: true },
  side: {
    lateral: PROFILE_LATERAL,
    girth: PROFILE_GIRTH,
    armSpread: PROFILE_ARM_SPREAD,
    profile: true,
    showsFace: true,
    showsBack: false,
  },
};

// ── Rig ──────────────────────────────────────────────────────────────────────

interface BoneChain {
  root: Pt;
  joint: Pt;
  end: Pt;
}

/**
 * Places a two-segment limb so its end sits on `target`. `bendSign` picks which
 * side the joint pops out to.
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

  const along = (dist * dist + upper * upper - lower * lower) / (2 * dist);
  const out = Math.sqrt(Math.max(0, upper * upper - along * along));
  return {
    root,
    joint: {
      x: root.x + dirX * along - dirY * out * bendSign,
      y: root.y + dirY * along + dirX * out * bendSign,
    },
    end: { x: root.x + dirX * dist, y: root.y + dirY * dist },
  };
}

/** Forward kinematics for an arm: shoulder angle, then elbow angle. */
function armFromAngles(
  shoulder: Pt,
  angles: NonNullable<SkeletonPose['leftArmAngles']>,
): BoneChain {
  const upper = rotate({ x: 0, y: UPPER_ARM_LENGTH }, -angles.upper);
  const joint = offset(shoulder, upper.x, upper.y);
  const fore = rotate({ x: 0, y: FOREARM_LENGTH * angles.foreScale }, -angles.fore);
  return { root: shoulder, joint, end: offset(joint, fore.x, fore.y) };
}

const KNEE_ALONG_LEG = THIGH_LENGTH / (THIGH_LENGTH + SHIN_LENGTH);

function foreshortenLeg(chain: BoneChain, amount: number): BoneChain {
  if (amount <= 0) return chain;
  const straightKnee = mixPt(chain.root, chain.end, KNEE_ALONG_LEG);
  return { ...chain, joint: mixPt(chain.joint, straightKnee, clamp01(amount)) };
}

interface Rig {
  hip: Pt;
  waist: Pt;
  chest: Pt;
  shoulderCentre: Pt;
  headCentre: Pt;
  leftShoulder: Pt;
  rightShoulder: Pt;
  leftLeg: BoneChain;
  rightLeg: BoneChain;
  leftArm: BoneChain;
  rightArm: BoneChain;
  shoulderHalf: number;
}

/** How much of the hip height a full crouch removes. */
const CROUCH_DROP = 0.3;
/** Facing +X, a knee that bends toward +X is bending forward. */
const PROFILE_KNEE_FORWARD = -1;
const TWIST_WIDTH_GAIN = 0.16;
const TWIST_SHOULDER_SHIFT = 0.06;

/** Offset from the hip to a point `height` up the leaning spine. */
function spinePoint(hip: Pt, height: number, lean: number): Pt {
  const rotated = rotate({ x: 0, y: -height }, lean);
  return offset(hip, rotated.x, rotated.y);
}

/** The ankle for a foot planted at `target`: up the leg by the foot's height. */
function ankleFor(target: Pt, pitch: number): Pt {
  const lifted = rotate({ x: 0, y: ANKLE_Y }, -pitch);
  return offset(target, lifted.x, lifted.y);
}

function elbowBend(flare: number): number {
  return flare < 0 ? -1 : 1;
}

function buildRig(pose: SkeletonPose, view: ViewSpec): Rig {
  const hipHeight = Math.abs(HIP_Y) - pose.crouch * CROUCH_DROP;
  const hip = pt(pose.sway * view.lateral, -hipHeight + pose.bob);

  const waist = spinePoint(hip, Math.abs(WAIST_Y - HIP_Y), pose.lean);
  const chest = spinePoint(hip, Math.abs(LICH_SHOULDER_Y - HIP_Y) * 0.72, pose.lean);
  const shoulderCentre = spinePoint(hip, Math.abs(LICH_SHOULDER_Y - HIP_Y), pose.lean);
  const headCentre = offset(
    spinePoint(hip, Math.abs(HEAD_CENTRE_Y - HIP_Y), pose.lean),
    pose.headTurn * COWL_HALF * view.lateral * 0.45,
    0,
  );

  const spread = view.profile ? 1 : FACING_SHOULDER_SPREAD;
  const shoulderHalf = SHOULDER_HALF * view.girth * spread;
  const twistShift = pose.twist * TWIST_SHOULDER_SHIFT * view.lateral;
  const armRoot = ARM_ROOT_HALF * view.armSpread * spread;
  const leftHalf = armRoot * (1 - pose.twist * TWIST_WIDTH_GAIN);
  const rightHalf = armRoot * (1 + pose.twist * TWIST_WIDTH_GAIN);

  const leftShoulder = offset(shoulderCentre, -leftHalf + twistShift, LICH_SHOULDER_JOINT_DROP);
  const rightShoulder = offset(shoulderCentre, rightHalf + twistShift, LICH_SHOULDER_JOINT_DROP);
  const hipHalf = LEG_ROOT_HALF * view.lateral;

  const leftAngles = pose.leftArmAngles;
  const rightAngles = pose.rightArmAngles;

  return {
    hip,
    waist,
    chest,
    shoulderCentre,
    headCentre,
    leftShoulder,
    rightShoulder,
    shoulderHalf,
    leftLeg: foreshortenLeg(
      solveTwoBone(
        offset(hip, -hipHalf, 0),
        ankleFor(pose.leftFoot, pose.leftFootPitch),
        THIGH_LENGTH,
        SHIN_LENGTH,
        view.profile ? PROFILE_KNEE_FORWARD * pose.leftKneeBreak : pose.leftKneeBreak,
      ),
      pose.leftForeshorten,
    ),
    rightLeg: foreshortenLeg(
      solveTwoBone(
        offset(hip, hipHalf, 0),
        ankleFor(pose.rightFoot, pose.rightFootPitch),
        THIGH_LENGTH,
        SHIN_LENGTH,
        view.profile ? PROFILE_KNEE_FORWARD * pose.rightKneeBreak : -pose.rightKneeBreak,
      ),
      pose.rightForeshorten,
    ),
    leftArm:
      leftAngles === null
        ? solveTwoBone(
            leftShoulder,
            pose.leftHand,
            UPPER_ARM_LENGTH,
            FOREARM_LENGTH,
            elbowBend(pose.elbowFlare),
          )
        : armFromAngles(leftShoulder, leftAngles),
    rightArm:
      rightAngles === null
        ? solveTwoBone(
            rightShoulder,
            pose.rightHand,
            UPPER_ARM_LENGTH,
            FOREARM_LENGTH,
            -elbowBend(pose.elbowFlare),
          )
        : armFromAngles(rightShoulder, rightAngles),
  };
}

interface PaintContext {
  readonly ctx: Ctx;
  readonly pose: SkeletonPose;
  readonly view: ViewSpec;
  readonly rig: Rig;
  /** Witch-light burning in the eye points and under the hood, 0 to 1. */
  readonly glow: number;
}

// ── Legs and feet ────────────────────────────────────────────────────────────

const FEMUR_WIDTH = 0.038;
const TIBIA_WIDTH = 0.03;
const FEMUR_KNOB = 0.05;
const KNEE_KNOB = 0.042;
const ANKLE_KNOB = 0.03;
/** How far the shin's value is pushed toward shadow, 0 to 1. */
const SHIN_DEPTH_SHADE = 0.65;
const FOOT_LENGTH = 0.09;
const FOOT_WIDTH = 0.04;
const TOE_COUNT = 3;
const TOE_WIDTH = 0.011;
/** How far outboard the toe end of a head-on foot leads. */
const FOOT_SPLAY = deg(22);
/** How much of its length a foot pointed at the camera shows. */
const FOOT_FORESHORTEN = 0.62;

/**
 * A bare skeletal foot.
 *
 * A foot pointed at the camera is not splayed by rotating it — that rolls the
 * figure onto the outside edges of both soles. The toe end leads outward while
 * the foot itself is drawn shorter.
 */
function paintFoot(paint: PaintContext, ankle: Pt, pitch: number, side: number): void {
  const { ctx, view } = paint;
  const toeAim = view.profile ? -pitch : HALF_PI - side * FOOT_SPLAY;
  const length = FOOT_LENGTH * (view.profile ? 1 : FOOT_FORESHORTEN);
  const toeBase = offset(
    ankle,
    Math.cos(toeAim) * length * 0.75,
    Math.sin(toeAim) * length * 0.75 + FOOT_WIDTH * 0.3,
  );
  outlineCapsule(ctx, ankle, toeBase, FOOT_WIDTH * 0.55, FOOT_WIDTH * 0.45);
  fillCapsule(ctx, ankle, toeBase, FOOT_WIDTH * 0.55, FOOT_WIDTH * 0.45, LICH_BONE.shadow);

  for (let i = 0; i < TOE_COUNT; i++) {
    const fan = (i / (TOE_COUNT - 1) - 0.5) * 2;
    const angle = toeAim + fan * FOOT_SPLAY;
    const tip = offset(toeBase, Math.cos(angle) * length * 0.36, Math.sin(angle) * length * 0.36);
    outlineCapsule(ctx, toeBase, tip, TOE_WIDTH, TOE_WIDTH * 0.75);
    fillCapsule(ctx, toeBase, tip, TOE_WIDTH, TOE_WIDTH * 0.75, LICH_BONE.dark);
  }
}

/**
 * One leg. Everything above the hem is covered by the robe a moment later, so
 * this exists for the shin and the foot that show under it — but the whole leg
 * is solved and drawn, because a stride swings the knee out past the hem.
 */
function paintLeg(paint: PaintContext, chain: BoneChain, pitch: number, side: number): void {
  const { ctx } = paint;
  paintLongBone(ctx, chain.root, chain.joint, FEMUR_WIDTH, FEMUR_KNOB, KNEE_KNOB, LICH_BONE, 0);
  // The shin is the only bone that shows under the hem, and it is deliberately
  // held down in value. At the mid tone the two shins were the brightest thing
  // on the sprite after the eyes and read as a pair of talons hanging out of the
  // robe — the legs are meant to be found, not looked at.
  paintLongBone(
    ctx,
    chain.joint,
    chain.end,
    TIBIA_WIDTH,
    KNEE_KNOB * 0.8,
    ANKLE_KNOB,
    LICH_BONE,
    SHIN_DEPTH_SHADE,
  );
  paintFoot(paint, chain.end, pitch, side);
}

// ── Hands ────────────────────────────────────────────────────────────────────

/**
 * Long clawed fingers — half again the length a proportionate hand would carry.
 *
 * The hands are one of only three places bone shows, and the only place the
 * silhouette has anything sharp in it. Everything else about this creature is a
 * soft dark column, so the read of "it can reach you" lives entirely here.
 */
const FINGER_COUNT = 4;
const FINGER_LENGTH = 0.088;
const FINGER_WIDTH = 0.012;
const PALM_RADIUS = 0.023;
const FINGER_SPREAD_MIN = deg(7);
const FINGER_SPREAD_MAX = deg(31);
/** How far a curled fingertip hooks past the knuckle's own direction. */
const FINGER_HOOK = deg(58);

function paintHand(paint: PaintContext, wrist: Pt, aim: number, claw: number, glow: number): void {
  const { ctx } = paint;
  const spread = lerp(FINGER_SPREAD_MIN, FINGER_SPREAD_MAX, clamp01(claw));
  const reach = FINGER_LENGTH * lerp(0.62, 1, clamp01(claw));
  const palm = offset(wrist, Math.cos(aim) * PALM_RADIUS, Math.sin(aim) * PALM_RADIUS);

  if (glow > 0) paintGlow(ctx, palm, PALM_RADIUS * 5.5, glow);

  outlineDisc(ctx, palm, PALM_RADIUS);
  for (let i = 0; i < FINGER_COUNT; i++) {
    const fan = (i / (FINGER_COUNT - 1) - 0.5) * 2;
    const angle = aim + fan * spread;
    const knuckle = offset(palm, Math.cos(angle) * reach * 0.5, Math.sin(angle) * reach * 0.5);
    // A curled hand does not just shorten its fingers, it hooks them: the tip
    // segment turns further in than the base one.
    const hookAngle = angle + (1 - clamp01(claw)) * FINGER_HOOK;
    const tip = offset(
      knuckle,
      Math.cos(hookAngle) * reach * 0.5,
      Math.sin(hookAngle) * reach * 0.5,
    );
    outlineCapsule(ctx, palm, knuckle, FINGER_WIDTH, FINGER_WIDTH);
    outlineCapsule(ctx, knuckle, tip, FINGER_WIDTH, FINGER_WIDTH * 0.45);
    fillCapsule(ctx, palm, knuckle, FINGER_WIDTH, FINGER_WIDTH, LICH_BONE.light);
    fillCapsule(ctx, knuckle, tip, FINGER_WIDTH, FINGER_WIDTH * 0.45, LICH_BONE.mid);
  }

  const thumbAngle = aim - HALF_PI * lerp(0.35, 0.85, clamp01(claw));
  const thumbTip = offset(
    palm,
    Math.cos(thumbAngle) * reach * 0.7,
    Math.sin(thumbAngle) * reach * 0.7,
  );
  outlineCapsule(ctx, palm, thumbTip, FINGER_WIDTH * 1.1, FINGER_WIDTH * 0.6);
  fillCapsule(ctx, palm, thumbTip, FINGER_WIDTH * 1.1, FINGER_WIDTH * 0.6, LICH_BONE.light);

  fillDisc(ctx, palm, PALM_RADIUS, LICH_BONE.mid);
  fillDisc(
    ctx,
    offset(palm, -PALM_RADIUS * 0.3, -PALM_RADIUS * 0.3),
    PALM_RADIUS * 0.5,
    LICH_BONE.light,
  );
  if (glow > 0) paintGlow(ctx, palm, PALM_RADIUS * 2.6, glow);
}

// ── Sleeves ──────────────────────────────────────────────────────────────────

const SLEEVE_SHOULDER_WIDTH = 0.05;
const SLEEVE_ELBOW_WIDTH = 0.043;
/** The cuff's mouth, which hangs wide enough to swallow the wrist. */
const SLEEVE_CUFF_WIDTH = 0.056;
/** Fraction of the forearm the sleeve stops short of the wrist. */
const SLEEVE_WRIST_GAP = 0.3;
const CUFF_BAND_LENGTH = 0.16;
const FOREARM_BONE_WIDTH = 0.018;
const INK_BLOT_COUNT = 3;

/**
 * A sleeve, and the ink-stained cuff at the end of it.
 *
 * The cuff stops well short of the wrist so a length of bare forearm shows
 * before the hand. Run all the way down, the sleeve and the hand share an edge
 * and the claw reads as growing out of the cloth.
 */
function paintSleeve(paint: PaintContext, chain: BoneChain, shade: number): void {
  const { ctx } = paint;
  const cuffAt = mixPt(chain.joint, chain.end, 1 - SLEEVE_WRIST_GAP);
  const body = shade > 0 ? mix(CLOTH.dark, CLOTH.shadow, shade) : CLOTH.dark;

  outlineCapsule(ctx, chain.root, chain.joint, SLEEVE_SHOULDER_WIDTH, SLEEVE_ELBOW_WIDTH);
  outlineCapsule(ctx, chain.joint, cuffAt, SLEEVE_ELBOW_WIDTH, SLEEVE_CUFF_WIDTH);
  fillCapsule(ctx, chain.root, chain.joint, SLEEVE_SHOULDER_WIDTH, SLEEVE_ELBOW_WIDTH, body);
  fillCapsule(ctx, chain.joint, cuffAt, SLEEVE_ELBOW_WIDTH, SLEEVE_CUFF_WIDTH, body);
  sheenSegment(ctx, chain.root, chain.joint, SLEEVE_SHOULDER_WIDTH, CLOTH.light, SHEEN_ALPHA);

  // Bare forearm bridging cuff to wrist, so the hand is attached to something
  // rather than floating past the end of a sleeve.
  outlineCapsule(ctx, cuffAt, chain.end, FOREARM_BONE_WIDTH, FOREARM_BONE_WIDTH * 0.85);
  fillCapsule(ctx, cuffAt, chain.end, FOREARM_BONE_WIDTH, FOREARM_BONE_WIDTH * 0.85, LICH_BONE.mid);

  const bandFrom = mixPt(chain.joint, chain.end, 1 - SLEEVE_WRIST_GAP - CUFF_BAND_LENGTH);
  fillCapsule(ctx, bandFrom, cuffAt, SLEEVE_CUFF_WIDTH * 0.92, SLEEVE_CUFF_WIDTH, VELLUM.dark);
  const cuffAngle = angleBetween(chain.joint, chain.end);
  const acrossX = Math.cos(cuffAngle + HALF_PI);
  const acrossY = Math.sin(cuffAngle + HALF_PI);
  for (let i = 0; i < INK_BLOT_COUNT; i++) {
    const across = (i / (INK_BLOT_COUNT - 1) - 0.5) * 2 * SLEEVE_CUFF_WIDTH * 0.55;
    const along = mixPt(bandFrom, cuffAt, 0.4 + (i % 2) * 0.35);
    fillDisc(ctx, offset(along, acrossX * across, acrossY * across), SLEEVE_CUFF_WIDTH * 0.2, INK);
  }
}

// ── Robe ─────────────────────────────────────────────────────────────────────

/**
 * The hem stops high enough to show ankle and foot.
 *
 * A robe run to the floor turns the walk into a bell sliding along the ground —
 * with no feet there is no gait, whatever the legs underneath are doing.
 */
const ROBE_HEM_Y = -0.16;
const ROBE_HEM_HALF = 0.215;
const ROBE_CHEST_HALF = 0.125;
/** Extra front-to-back reach the robe gets edge-on, over its profile girth. */
const PROFILE_ROBE_REACH = 1.4;
const ROBE_FOLD_COUNT = 5;
const ROBE_FOLD_WIDTH = 0.018;

/**
 * The hem is torn, not scalloped.
 *
 * An even row of notches is decoration — it reads as the trim on a gown, which
 * is exactly what the first pass of this robe looked like. Real rot takes
 * uneven bites: most of the edge barely moves, a few places have torn most of
 * the way up the shin, and the two sides do not match. These depths are a fixed
 * irregular table rather than a sine, because a periodic function cannot
 * produce that however its phase is chosen.
 */
const ROBE_TATTER_DEPTHS: readonly number[] = [0.1, 0.03, 0.18, 0.05, 0.02, 0.23, 0.08, 0.13, 0.04];
/** How much the tear depths breathe as the robe swings, as a share of themselves. */
const ROBE_TATTER_SWAY = 0.18;

/**
 * The robe: a narrow column from the chest to just above the ankle, torn along
 * the hem.
 *
 * Hung from the chest rather than the hip. The Skeleton Lord's robe starts at
 * the hip because his lit ribcage above it is the design; the Lich has nothing
 * to show there, and a closed column from the chest down is what makes it one
 * unbroken vertical shape instead of a torso balanced on a skirt.
 */
function paintRobe(paint: PaintContext): void {
  const { ctx, rig, pose, view } = paint;
  const top = mixPt(rig.hip, rig.chest, 0.78);
  const flare = lerp(0.85, 1.2, clamp01(pose.robeFlare));
  // A robe is nearly as deep front-to-back as it is wide, and edge-on the walk's
  // stride is depth rather than width: at the profile girth alone the swinging
  // leg steps clean out of the front of the robe and a bare shin hangs in the
  // air beside it.
  const depth = view.profile ? PROFILE_ROBE_REACH : 1;
  const hemHalf = ROBE_HEM_HALF * view.girth * flare * depth;
  const chestHalf = ROBE_CHEST_HALF * view.girth * depth;
  const hemY = ROBE_HEM_Y + pose.bob * 0.4;
  const sway = pose.robeSway * hemHalf * 0.22;

  const HEM_STEPS = ROBE_TATTER_DEPTHS.length - 1;
  const hemPoint = (i: number): Pt => {
    const t = i / HEM_STEPS;
    const x = lerp(-hemHalf, hemHalf, t) + sway;
    // The tears breathe with the frame's own phase rather than being stamped on,
    // so the rags move when the robe swings — but they keep their own uneven
    // lengths, which is what stops the edge reading as trim.
    const breathe = 1 + ROBE_TATTER_SWAY * Math.sin(pose.time * TWO_PI + i);
    return { x, y: hemY - ROBE_TATTER_DEPTHS[i] * breathe };
  };

  const trace = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(top.x - chestHalf - grow, top.y - grow);
    const first = hemPoint(0);
    ctx.lineTo(first.x - grow, first.y + grow);
    for (let i = 1; i <= HEM_STEPS; i++) {
      // Each rag hangs to a point at full length between two tears. A curve
      // between the two tear depths rounds every one of them into a scallop,
      // which is trim rather than damage.
      const previous = hemPoint(i - 1);
      const p = hemPoint(i);
      ctx.lineTo((previous.x + p.x) / 2, hemY + grow);
      ctx.lineTo(p.x, p.y + grow);
    }
    ctx.lineTo(top.x + chestHalf + grow, top.y - grow);
    ctx.closePath();
  };

  const OUTLINE_BLEED = 0.011;
  trace(OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  trace(0);
  ctx.fillStyle = CLOTH.dark;
  ctx.fill();

  ctx.save();
  trace(0);
  ctx.clip();
  // A broad wash down the lit side before any fold goes on. Value structure at
  // this size is carried by big soft areas, not by lines: without it the robe is
  // one flat black trapezoid and the folds read as scratches on a wall.
  const wash = ctx.createLinearGradient(top.x - hemHalf, 0, top.x + hemHalf, 0);
  wash.addColorStop(0, rgba(CLOTH.light, 0.55));
  wash.addColorStop(0.45, rgba(CLOTH.light, 0.1));
  wash.addColorStop(1, rgba(CLOTH.shadow, 0.5));
  ctx.fillStyle = wash;
  ctx.fillRect(top.x - hemHalf, top.y, hemHalf * 2, Math.abs(hemY - top.y) + ROBE_TATTER_DEPTHS[0]);
  // Folds fanning from the chest, which is the only thing that gives a flat dark
  // shape any read of volume at tile size.
  for (let i = 0; i < ROBE_FOLD_COUNT; i++) {
    const t = (i + 0.5) / ROBE_FOLD_COUNT;
    const p = hemPoint(t);
    ctx.beginPath();
    ctx.moveTo(lerp(top.x - chestHalf * 0.6, top.x + chestHalf * 0.6, t), top.y);
    ctx.lineTo(p.x, p.y);
    ctx.lineWidth = ROBE_FOLD_WIDTH;
    ctx.strokeStyle = rgba(i % 2 === 0 ? CLOTH.shadow : CLOTH.light, 0.7);
    ctx.stroke();
  }
  if (paint.glow > 0) {
    paintGlow(ctx, { x: top.x + sway, y: hemY - 0.03 }, hemHalf * 0.55, paint.glow * 0.25);
  }
  ctx.restore();
}

/** How far below the shoulder line the shoulder mantle hangs. */
const MANTLE_DROP = 0.16;
const MANTLE_POINT_DIP = 0.06;
const MANTLE_TATTER_COUNT = 5;
const MANTLE_TATTER_DEPTH = 0.03;

/** The short mantle over the shoulders, torn along its own hem. */
function paintMantle(paint: PaintContext): void {
  const { ctx, rig, pose } = paint;
  const half = rig.shoulderHalf * 1.16;
  const top = offset(rig.shoulderCentre, 0, -0.03);
  const hemY = rig.shoulderCentre.y + MANTLE_DROP;
  const hemHalf = half * 0.9;
  const point = hemY + MANTLE_POINT_DIP;

  const tatterAt = (t: number): number => {
    const notch = Math.sin(t * MANTLE_TATTER_COUNT * Math.PI + pose.time * TWO_PI) * 0.5 + 0.5;
    return notch * MANTLE_TATTER_DEPTH;
  };

  const trace = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(top.x - half * 0.45 - grow, top.y - grow);
    ctx.quadraticCurveTo(
      top.x - half - grow,
      top.y + 0.02,
      top.x - hemHalf - grow,
      hemY + grow + tatterAt(0.15),
    );
    ctx.quadraticCurveTo(top.x - hemHalf * 0.4, point + grow, top.x, point + grow + tatterAt(0.5));
    ctx.quadraticCurveTo(
      top.x + hemHalf * 0.4,
      point + grow,
      top.x + hemHalf + grow,
      hemY + grow + tatterAt(0.85),
    );
    ctx.quadraticCurveTo(
      top.x + half + grow,
      top.y + 0.02,
      top.x + half * 0.45 + grow,
      top.y - grow,
    );
    ctx.closePath();
  };

  const OUTLINE_BLEED = 0.011;
  trace(OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  trace(0);
  ctx.fillStyle = CLOTH.dark;
  ctx.fill();

  ctx.save();
  trace(0);
  ctx.clip();
  ctx.fillStyle = rgba(CLOTH.rim, 0.3);
  ctx.beginPath();
  ctx.moveTo(top.x - half * 0.45, top.y);
  ctx.quadraticCurveTo(top.x - half * 0.9, top.y + 0.02, top.x - hemHalf * 0.9, point);
  ctx.lineTo(top.x - hemHalf * 0.5, point);
  ctx.quadraticCurveTo(top.x - half * 0.55, top.y + 0.02, top.x - half * 0.25, top.y);
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}

// ── The office ───────────────────────────────────────────────────────────────

const STOLE_HALF_WIDTH = 0.028;
/** How far forward of the spine the band sits when seen edge-on. */
const STOLE_PROFILE_FORWARD = 0.05;
/** How far down the robe the two bands of the stole hang. */
const STOLE_DROP = 0.44;
const STOLE_INK_COUNT = 2;
const SASH_HALF_HEIGHT = 0.013;
const SEAL_RADIUS = 0.031;
const SEAL_CORD_DROP = 0.11;
const SEAL_CORD_WIDTH = 0.008;

/**
 * The clerk's stole.
 *
 * This is most of what stops the silhouette being a generic hooded skeleton. Two
 * narrow vellum bands down a near-black chest read at tile size where any amount
 * of embroidery does not; the ink blots on them are what a player finds on the
 * second look, not the first.
 */
function paintStole(paint: PaintContext): void {
  const { ctx, rig, view } = paint;
  // One band down the centre, not two down the sides.
  //
  // Two bands were tried both parallel and splayed, and read as a ladder and
  // then as a pair of braces: at this size any repeated vertical pair on a
  // chest becomes a structure. A single strip is unambiguous, and it is what a
  // scribe's scapular actually is.
  const top = offset(
    rig.shoulderCentre,
    view.profile ? STOLE_PROFILE_FORWARD : 0,
    MANTLE_DROP * 0.5,
  );
  const bottom = offset(top, 0, STOLE_DROP);
  const half = STOLE_HALF_WIDTH * (view.profile ? 0.5 : 1);
  outlineCapsule(ctx, top, bottom, half, half * 1.15);
  fillCapsule(ctx, top, bottom, half, half * 1.15, VELLUM.dark);
  sheenSegment(ctx, top, bottom, half * 2, VELLUM.light, SHEEN_ALPHA);
  for (let i = 0; i < STOLE_INK_COUNT; i++) {
    const along = mixPt(top, bottom, 0.45 + i * 0.3);
    fillDisc(ctx, offset(along, half * (i % 2 === 0 ? -0.3 : 0.35), 0), half * 0.5, INK);
  }
}

/** The frayed sash at the waist, and the magistrate's seal hanging off it. */
function paintSashAndSeal(paint: PaintContext): void {
  const { ctx, rig, view, pose } = paint;
  const half = ROBE_CHEST_HALF * view.girth * 1.15;
  const centre = mixPt(rig.hip, rig.waist, 0.45);
  const left = offset(centre, -half, 0);
  const right = offset(centre, half, 0);
  outlineCapsule(ctx, left, right, SASH_HALF_HEIGHT, SASH_HALF_HEIGHT);
  fillCapsule(ctx, left, right, SASH_HALF_HEIGHT, SASH_HALF_HEIGHT, VELLUM.shadow);
  sheenSegment(ctx, left, right, SASH_HALF_HEIGHT * 2, VELLUM.light, SHEEN_ALPHA);

  // The seal swings off the sash rather than being pinned to it — a fixed one
  // reads as a button, and this is the thing that stamps the forged letters.
  const swing = pose.robeSway * 0.03 + Math.sin(pose.time * TWO_PI) * 0.01;
  const anchor = offset(centre, half * 0.5, SASH_HALF_HEIGHT);
  const seal = offset(anchor, swing, SEAL_CORD_DROP);
  outlineCapsule(ctx, anchor, seal, SEAL_CORD_WIDTH, SEAL_CORD_WIDTH);
  fillCapsule(ctx, anchor, seal, SEAL_CORD_WIDTH, SEAL_CORD_WIDTH, VELLUM.dark);
  outlineDisc(ctx, seal, SEAL_RADIUS);
  fillDisc(ctx, seal, SEAL_RADIUS, WAX_MID);
  fillDisc(
    ctx,
    offset(seal, -SEAL_RADIUS * 0.28, -SEAL_RADIUS * 0.28),
    SEAL_RADIUS * 0.5,
    WAX_LIGHT,
  );
  // The impression in the wax: a cross of shadow, which at this size is all a
  // stamped device can ever be.
  ctx.strokeStyle = rgba(WAX_DARK, 0.9);
  ctx.lineWidth = SEAL_RADIUS * 0.26;
  ctx.beginPath();
  ctx.moveTo(seal.x - SEAL_RADIUS * 0.45, seal.y);
  ctx.lineTo(seal.x + SEAL_RADIUS * 0.45, seal.y);
  ctx.moveTo(seal.x, seal.y - SEAL_RADIUS * 0.45);
  ctx.lineTo(seal.x, seal.y + SEAL_RADIUS * 0.45);
  ctx.stroke();
}

// ── Cowl, jaw and eyes ───────────────────────────────────────────────────────

/**
 * The hood.
 *
 * Deliberately narrow and peaked. A hood is the fastest way to inflate a head,
 * and a head that grows makes a tall figure read as a child in a costume rather
 * than as a gaunt one — the height has to be bought at the crown, not across.
 */
const COWL_HALF = 0.15;
const COWL_RISE = 0.2;
/**
 * How far the crown slumps past the dome.
 *
 * Small. A tall point on a hood is a wizard hat or a ghost sheet, and the first
 * pass of this cowl was both — the shape has to read as cloth draped over a
 * skull, which means a low crown that leans forward and falls to the shoulders,
 * not a cone.
 */
const COWL_PEAK = 0.018;
/** Where the drape gathers across the base of the hood, between the two falls. */
const COWL_BASE_Y = 0.13;
/** How far the drape falls past the jaw on each side, onto the shoulders. */
const COWL_DRAPE_NEAR = 0.19;
const COWL_DRAPE_FAR = 0.26;
/** The keyhole opening in the front of the hood. */
const COWL_MOUTH_HALF = 0.077;
const COWL_MOUTH_TOP = -0.125;
const COWL_MOUTH_BOTTOM = 0.1;
/** The folded edge of cloth round that opening, which is what names it a cowl. */
const COWL_LIP_WIDTH = 0.017;
/** Edge-on the hood is deeper than it is wide, and the occiput sits behind. */
const COWL_DEPTH_BACK = 0.18;
const COWL_DEPTH_FRONT = 0.16;

const EYE_SPREAD = 0.042;
const EYE_Y = -0.03;
/** Share of the eye point that burns white rather than green. */
const EYE_WHITE_SHARE = 0.45;
const EYE_CORE_RADIUS = 0.014;
const EYE_HALO_RADIUS = 0.052;

const JAW_TOP_Y = 0.048;
const JAW_HALF = 0.038;
const JAW_DEPTH = 0.05;
const JAW_MAX_OPEN = 0.045;
const TOOTH_COUNT = 5;
const TOOTH_WIDTH = 0.009;
const TOOTH_HEIGHT = 0.016;

/**
 * The exposed mandible under the cowl, and the tooth row above it.
 *
 * Drawn in head-local space, so the head tilt carries it. The mandible hangs
 * below the hood's front edge and the upper teeth stay inside the hood's
 * shadow — that overhang is the entire face this creature has, so it is kept
 * small and mid-valued. Drawn pale and full width it reads as a bandaged chin.
 */
function paintJaw(paint: PaintContext, forward: number): void {
  const { ctx, pose, view } = paint;
  const drop = pose.jaw * JAW_MAX_OPEN;
  const half = JAW_HALF * (view.profile ? 0.78 : 1);

  const trace = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(forward - half - grow, JAW_TOP_Y);
    ctx.quadraticCurveTo(
      forward - half * 0.92,
      JAW_TOP_Y + JAW_DEPTH + drop + grow,
      forward,
      JAW_TOP_Y + JAW_DEPTH * 1.1 + drop + grow,
    );
    ctx.quadraticCurveTo(
      forward + half * 0.92,
      JAW_TOP_Y + JAW_DEPTH + drop + grow,
      forward + half + grow,
      JAW_TOP_Y,
    );
    ctx.closePath();
  };
  const OUTLINE_BLEED = 0.009;
  trace(OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  trace(0);
  ctx.fillStyle = LICH_BONE.dark;
  ctx.fill();

  if (drop > 0.004) {
    ctx.beginPath();
    ctx.moveTo(forward - half * 0.66, JAW_TOP_Y);
    ctx.lineTo(forward + half * 0.66, JAW_TOP_Y);
    ctx.lineTo(forward + half * 0.42, JAW_TOP_Y + drop);
    ctx.lineTo(forward - half * 0.42, JAW_TOP_Y + drop);
    ctx.closePath();
    ctx.fillStyle = CAVITY;
    ctx.fill();
  }

  const span = half * (view.profile ? 0.45 : 0.66);
  for (let i = 0; i < TOOTH_COUNT; i++) {
    const t = i / (TOOTH_COUNT - 1) - 0.5;
    ctx.fillStyle = LICH_BONE.light;
    ctx.fillRect(
      forward + t * span * 2 - TOOTH_WIDTH * 0.5,
      JAW_TOP_Y - TOOTH_HEIGHT,
      TOOTH_WIDTH,
      TOOTH_HEIGHT,
    );
  }
}

/**
 * Two points of witch-light in the dark of the hood — the only face there is.
 *
 * A halo with a hard bright core inside it, not a filled disc: a disc at this
 * size is a headlamp, and what has to read is a *point* with the dark of the
 * cowl still around it.
 */
function paintEyes(paint: PaintContext, forward: number): void {
  const { ctx, view, glow } = paint;
  if (glow <= 0) return;
  const sides = view.profile ? [1] : [-1, 1];
  for (const side of sides) {
    const centre = pt(forward + side * (view.profile ? 0 : EYE_SPREAD), EYE_Y);
    paintGlow(ctx, centre, EYE_HALO_RADIUS, glow * 0.9);
    fillDisc(ctx, centre, EYE_CORE_RADIUS, rgba(WITCH_CORE, 0.95 * glow));
    // A white-hot centre inside the green. At a 32px tile the eye is two pixels
    // and a pure green one averages into the hood; the white is what survives.
    fillDisc(ctx, centre, EYE_CORE_RADIUS * EYE_WHITE_SHARE, rgba('#ffffff', 0.9 * glow));
  }
}

function paintCowl(paint: PaintContext, centre: Pt): void {
  const { ctx, view, pose } = paint;
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(pose.headTilt);

  const back = view.profile ? COWL_DEPTH_BACK : COWL_HALF;
  const front = view.profile ? COWL_DEPTH_FRONT : COWL_HALF;
  const faceShift = view.profile ? front * 0.34 : 0;

  // The two sides of the drape hang to different lengths. A symmetrical hood is
  // a garment on a mannequin; an uneven one has been worn.
  const nearDrape = view.showsBack ? COWL_DRAPE_FAR : COWL_DRAPE_NEAR;
  const farDrape = view.showsBack ? COWL_DRAPE_NEAR : COWL_DRAPE_FAR;

  const trace = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(-back - grow, farDrape + grow);
    ctx.quadraticCurveTo(
      -back * 1.04 - grow,
      -COWL_RISE * 0.5,
      -back * 0.42,
      -COWL_RISE - COWL_PEAK - grow,
    );
    // The crown leans forward over the opening: cloth draped on a skull, with
    // the weight of the hood pulling the front of it down.
    ctx.quadraticCurveTo(
      front * 0.24,
      -COWL_RISE - COWL_PEAK * 1.4 - grow,
      front * 0.86 + grow,
      -COWL_RISE * 0.5,
    );
    ctx.quadraticCurveTo(front * 1.1 + grow, -COWL_RISE * 0.02, front + grow, nearDrape + grow);
    // The gathered fold across the base, where the drape meets the mantle.
    ctx.quadraticCurveTo(0, COWL_BASE_Y * 0.55 + grow, -back - grow, farDrape + grow);
    ctx.closePath();
  };
  const OUTLINE_BLEED = 0.011;
  trace(OUTLINE_BLEED);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  trace(0);
  ctx.fillStyle = CLOTH.mid;
  ctx.fill();

  if (view.showsBack) {
    // From behind there is no opening — just the fold of the hood down the back
    // of the neck, which is the only structure the shape has from this side.
    ctx.strokeStyle = rgba(CLOTH.shadow, 0.9);
    ctx.lineWidth = 0.014;
    ctx.beginPath();
    ctx.moveTo(0, -COWL_RISE * 0.7);
    ctx.lineTo(0, COWL_BASE_Y * 0.8);
    ctx.stroke();
    ctx.strokeStyle = rgba(CLOTH.rim, 0.4);
    ctx.lineWidth = 0.012;
    ctx.beginPath();
    ctx.moveTo(-back * 0.55, -COWL_RISE * 0.5);
    ctx.quadraticCurveTo(0, -COWL_RISE * 0.82, back * 0.55, -COWL_RISE * 0.5);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // The opening, filled with the darkest value on the figure. This is the one
  // place the art wants a hole rather than an edge.
  const mouthHalf = COWL_MOUTH_HALF * (view.profile ? 0.78 : 1);
  const traceMouth = (grow: number): void => {
    ctx.beginPath();
    ctx.moveTo(faceShift - mouthHalf - grow, COWL_MOUTH_BOTTOM + grow);
    ctx.quadraticCurveTo(
      faceShift - (mouthHalf + grow) * 1.05,
      COWL_MOUTH_TOP * 0.55,
      faceShift,
      COWL_MOUTH_TOP - grow,
    );
    ctx.quadraticCurveTo(
      faceShift + (mouthHalf + grow) * 1.05,
      COWL_MOUTH_TOP * 0.55,
      faceShift + mouthHalf + grow,
      COWL_MOUTH_BOTTOM + grow,
    );
    ctx.closePath();
  };
  // The folded lip of cloth round the opening. Without it the hole is punched
  // through a flat shape and the hood reads as a mask rather than as a garment
  // with an inside.
  traceMouth(COWL_LIP_WIDTH);
  ctx.fillStyle = CLOTH.light;
  ctx.fill();
  traceMouth(COWL_LIP_WIDTH * 0.45);
  ctx.fillStyle = CLOTH.shadow;
  ctx.fill();
  traceMouth(0);
  ctx.fillStyle = VOID;
  ctx.fill();

  paintJaw(paint, faceShift);
  paintEyes(paint, faceShift);

  // A breath of the eye-light escaping the hood, which is what stops the opening
  // reading as a flat black hole punched in a shape.
  if (paint.glow > 0) {
    const spill = ctx.createLinearGradient(0, COWL_MOUTH_TOP, 0, COWL_MOUTH_BOTTOM);
    spill.addColorStop(0, rgba(WITCH_BRIGHT, 0.2 * paint.glow));
    spill.addColorStop(1, rgba(WITCH_BRIGHT, 0));
    ctx.fillStyle = spill;
    traceMouth(0);
    ctx.fill();
  }

  ctx.restore();
}

// ── Ground ───────────────────────────────────────────────────────────────────

const CONTACT_SHADOW_HALF = 0.28;

/**
 * The soft contact shadow the figure casts on the tile under it.
 *
 * Painted by the caller *before* the figure rather than as part of it: the
 * generator builds the edge light by dilating the figure's own alpha, and a
 * shadow inside that alpha would hand the creature a second halo out at the
 * shadow's radius with nothing casting it.
 */
export function drawLichContactShadow(ctx: Ctx, pose: SkeletonPose): void {
  const lift = clamp01(-pose.bob * 4);
  const alpha = CONTACT_SHADOW_ALPHA * (1 - lift * 0.5);
  const gradient = ctx.createRadialGradient(0, 0, 0, 0, 0, CONTACT_SHADOW_HALF);
  gradient.addColorStop(0, rgba('#000000', alpha));
  gradient.addColorStop(1, rgba('#000000', 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.ellipse(0, 0, CONTACT_SHADOW_HALF, CONTACT_SHADOW_HALF * 0.3, 0, 0, TWO_PI);
  ctx.fill();
}

// ── Painters ─────────────────────────────────────────────────────────────────

/** Depth shade applied to a limb genuinely behind the body, in profile only. */
const FAR_LIMB_SHADE = 0.5;

/** Witch-light the Lich burns even on a pose that asks for none. */
const AMBIENT_GLOW = 0.5;

function paintFigure(ctx: Ctx, pose: SkeletonPose, viewName: LichView): void {
  const view = VIEWS[viewName];
  const rig = buildRig(pose, view);
  const glow = clamp01(AMBIENT_GLOW * lerp(0.75, 1, pose.glow) + pose.glow * (1 - AMBIENT_GLOW));
  const paint: PaintContext = { ctx, pose, view, rig, glow };

  // Which arms go behind the trunk. Head-on both normally belong in front — an
  // arm drawn behind the robe makes the figure look one-armed — but a pose seen
  // from the back says so explicitly, and both flags have to be honoured.
  const drawLeftArmFirst = view.profile || pose.leftArmBehind;
  const drawRightArmFirst = !view.profile && pose.rightArmBehind;

  const paintWholeArm = (chain: BoneChain, claw: number, palmGlow: number, shade: number): void => {
    paintSleeve(paint, chain, shade);
    paintHand(paint, chain.end, angleBetween(chain.joint, chain.end), claw, palmGlow);
  };

  if (drawLeftArmFirst) {
    paintWholeArm(rig.leftArm, pose.leftClaw, pose.leftPalmGlow, view.profile ? FAR_LIMB_SHADE : 0);
  }
  if (drawRightArmFirst) {
    paintWholeArm(rig.rightArm, pose.rightClaw, pose.rightPalmGlow, 0);
  }

  paintLeg(paint, rig.leftLeg, pose.leftFootPitch, -1);
  paintLeg(paint, rig.rightLeg, pose.rightFootPitch, 1);

  paintRobe(paint);
  if (!view.showsBack) paintSashAndSeal(paint);
  paintMantle(paint);
  if (!view.showsBack) paintStole(paint);
  paintCowl(paint, rig.headCentre);

  if (!drawLeftArmFirst) paintWholeArm(rig.leftArm, pose.leftClaw, pose.leftPalmGlow, 0);
  if (!drawRightArmFirst) paintWholeArm(rig.rightArm, pose.rightClaw, pose.rightPalmGlow, 0);
}

/**
 * How wide apart the leg roots are drawn in a given view, as a fraction of the
 * head-on spacing. The bake gate needs it to judge a profile pose's reach with
 * the roots it will actually be solved against.
 */
export function lichLateralFor(view: LichView): number {
  return VIEWS[view].lateral;
}

/**
 * How much slack a pose leaves in its longer leg, in tile units.
 *
 * Positive means the IK can reach the foot without clamping. This is the one
 * thing about a pose that cannot be judged from the baked picture: a leg the
 * solver had to clamp is drawn as a perfectly straight line with the foot
 * hanging off the floor, which looks deliberate until the row plays and the
 * figure hops.
 */
export function lichLegReachHeadroom(pose: SkeletonPose, lateral: number): number {
  const maxReach = THIGH_LENGTH + SHIN_LENGTH - JOINT_SLACK;
  const hipHeight = Math.abs(HIP_Y) - pose.crouch * CROUCH_DROP;
  const hip = pt(pose.sway * lateral, -hipHeight + pose.bob);
  const rootHalf = LEG_ROOT_HALF * lateral;
  const legs: ReadonlyArray<readonly [Pt, number, number]> = [
    [pose.leftFoot, pose.leftFootPitch, -rootHalf],
    [pose.rightFoot, pose.rightFootPitch, rootHalf],
  ];
  let worst = maxReach;
  for (const [foot, pitch, rootOffset] of legs) {
    const root = offset(hip, rootOffset, 0);
    const ankle = ankleFor(foot, pitch);
    worst = Math.min(worst, maxReach - Math.hypot(ankle.x - root.x, ankle.y - root.y));
  }
  return worst;
}

/** Paints the Lich head-on, toward the camera. */
export function drawLichFront(ctx: Ctx, pose: SkeletonPose): void {
  paintFigure(ctx, pose, 'front');
}

/** Paints the Lich from behind, walking away from the camera. */
export function drawLichBack(ctx: Ctx, pose: SkeletonPose): void {
  paintFigure(ctx, pose, 'back');
}

/** Paints the Lich in profile, always facing +X so the runtime can mirror it. */
export function drawLichSide(ctx: Ctx, pose: SkeletonPose): void {
  paintFigure(ctx, pose, 'side');
}

/**
 * How far a full crouch sinks the hips, in tile units.
 *
 * Exported because a pose that sinks the body has to sink the hand targets with
 * it: the hands are absolute, so a crouch that leaves them where they were pulls
 * both arms straight and the figure hangs off its own shoulders.
 */
export const LICH_CROUCH_DROP = CROUCH_DROP;

/** The wool the robe is made of, for the torn scraps on the gore row. */
export const LICH_CLOTH = CLOTH;
/** The outline colour those scraps are drawn against. */
export const LICH_OUTLINE = OUTLINE;
