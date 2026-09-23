/**
 * The Crocodilian — one painter for two very different bodies.
 *
 * Bucket Boy is a young, skinny croc in a neon-pink band tee, clutching a tin
 * bucket; Clarabelle is the club's broad-shouldered door bouncer in a dark
 * security suit. They share every bone, every stroke and every view, and differ
 * only in the {@link CrocBuild} handed in: proportions, palette, what they wear,
 * and whether the Meat Shields armband is painted on.
 *
 * What makes a biped read as a crocodile at a 32px tile, in descending order:
 *
 *   1. **Teeth on a lipline.** A long tapering muzzle on its own reads as a
 *      bill. What says crocodile is the mouth line running the jaw's whole
 *      length with a row of ivory teeth interlocking over it — visible with the
 *      mouth shut, which no other animal does. The teeth are drawn larger than
 *      life on purpose: at tile size a realistic tooth is a third of a pixel.
 *   2. **A thick, heavy tail** dragging behind him on the floor, banded, with a
 *      ridge of scutes along its top.
 *   3. **Eyes on top of the head**, in raised orbits under a heavy brow, and a
 *      nostril bump at the very tip of the snout.
 *
 * Head-on, a snout pointed at the camera projects to a stub that reads as any
 * animal at all, so the head-on views turn the head: the profile skull is
 * drawn squashed by the sine of its yaw, which is exactly what a turn about the
 * vertical axis looks like, over a head-on braincase that does not lose its
 * width when it turns. The away view is the front view mirrored and painted
 * from behind — mirroring puts the bucket and the armband in the figure's
 * *left* hand in both, which is where they belong.
 *
 * This module knows nothing about animation: it paints one pose. The
 * choreography lives in `src/sprites/art/crocodilianFigure.ts`.
 */

import { type Pt, clamp01, deg, lerp, mix, rgba } from './carlArt';

type Ctx = CanvasRenderingContext2D;

const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
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

function along(from: Pt, angle: number, distance: number): Pt {
  return offset(from, Math.cos(angle) * distance, Math.sin(angle) * distance);
}

// ── Palette ──────────────────────────────────────────────────────────────────

/** A three-stop value ramp for one material. */
export interface Ramp {
  readonly dark: string;
  readonly mid: string;
  readonly light: string;
}

const OUTLINE = '#131a14';
/** The inside of a crocodile's mouth is pale pink-yellow, not red. */
const MOUTH = '#b8707a';
const MOUTH_DEEP = '#5a2830';
/**
 * Tooth ivory. Exported so the teeth gate measures the colour the painter
 * uses; no other colour on the head is within a few steps of it.
 */
export const TOOTH = '#f4ecd2';
const EYE_IRIS = '#d9c43a';
const EYE_SLIT = '#1a1208';
/** Pure white, well clear of the tooth ivory, so a glint is never counted as a tooth. */
const EYE_GLINT = '#ffffff';
const CLAW = '#2a2418';
/** The Meat Shields zone colour. Only a hireling carries it. */
const ARMBAND = '#e06040';

/** Unit vector the key light arrives from, in screen space. */
const LIGHT_X = -0.6;
const LIGHT_Y = -0.8;
const SHEEN_ALPHA = 0.3;
const CONTACT_SHADOW_ALPHA = 0.4;

/** Everything a build paints in colour. */
export interface CrocPalette {
  /** Back, flanks, limbs and the top of the head. */
  readonly scales: Ramp;
  /** Throat, underjaw, belly and the underside of the tail. */
  readonly belly: Ramp;
  /** The tail's dark crossbands and the dorsal scutes. */
  readonly band: string;
  /** Rim light along the trailing edge, which is what separates a dark figure from a dark floor. */
  readonly rim: string;
  readonly rimAlpha: number;
}

// ── Builds ───────────────────────────────────────────────────────────────────

/** How far the torso reaches either side of the spine at each height. */
export interface TorsoSpan {
  readonly shoulderLead: number;
  readonly shoulderTrail: number;
  readonly chestLead: number;
  readonly chestTrail: number;
  readonly waistLead: number;
  readonly waistTrail: number;
  readonly hipLead: number;
  readonly hipTrail: number;
}

/** A limb's half-widths, root to tip. */
interface LimbShape {
  readonly root: number;
  readonly joint: number;
  readonly belly: number;
  readonly tip: number;
  /** Where the belly sits along the lower segment, 0 at the joint. */
  readonly bellyAt: number;
}

/** What the figure wears. */
export type CrocOutfit = 'band_tee' | 'security_suit';

/**
 * Everything that differs between Bucket Boy and Clarabelle. Every length is in
 * tiles, with the origin between the feet and +Y down, so heights are negative.
 *
 * Heights are pinned first and bone lengths chosen to span them with a little
 * slack, never the other way round: a leg exactly as long as the hip is high
 * locks straight and hangs its foot in the air the moment the pelvis drops.
 */
export interface CrocBuild {
  readonly id: string;
  readonly hipY: number;
  readonly waistY: number;
  readonly chestY: number;
  readonly shoulderY: number;
  readonly neckBaseY: number;
  /** Crown to chin. Everything on the head is painted in units of this. */
  readonly headHeight: number;
  /** How far up and forward of the neck base the skull's centre sits. */
  readonly headRise: number;
  readonly headForward: number;
  /** Snout tip, forward of the skull's centre, in head heights. */
  readonly snoutLength: number;
  /** Depth of the lower jaw below the lipline, in head heights. */
  readonly jawDepth: number;
  /** Radius of the eye, in head heights. A young face has a bigger eye. */
  readonly eyeRadius: number;
  readonly thigh: number;
  readonly shin: number;
  /** The ankle joint's height over a flat sole. */
  readonly ankleHeight: number;
  /** Ankle to the ball of the foot, and the ball on to the claw tips. */
  readonly footToBall: number;
  readonly toeLength: number;
  readonly heelLength: number;
  readonly upperArm: number;
  readonly forearm: number;
  readonly handLength: number;
  readonly legRootHalf: number;
  readonly armRootHalf: number;
  readonly facingTorso: TorsoSpan;
  readonly profileTorso: TorsoSpan;
  readonly arm: LimbShape;
  readonly leg: LimbShape;
  readonly neckWidth: number;
  readonly tailLength: number;
  readonly tailRootWidth: number;
  readonly tailTipWidth: number;
  /** Forward stoop of the whole trunk at rest. */
  readonly restLean: number;
  /** Resting head pitch: a timid kid ducks his snout, a bouncer lifts her chin. */
  readonly restHeadPitch: number;
  /** Head-on stance width, as a share of the leg roots' spread. */
  readonly footSpreadShare: number;
  /** A knee-length pencil skirt over the suit trousers' place. */
  readonly skirt: boolean;
  /** Lashes over the eyes and a pearl at the jaw — how the art says "she". */
  readonly feminine: boolean;
  readonly outfit: CrocOutfit;
  /** The Meat Shields armband: every hireling wears one; the club's door staff do not. */
  readonly armband: boolean;
  readonly palette: CrocPalette;
  /** Scales every outline and detail stroke with the body, so a big figure is not drawn in hairlines. */
  readonly strokeScale: number;
}

/**
 * Young, skinny and short — a head and a half shorter than Carl — with a big
 * head on a narrow frame, because a big head over thin limbs is what reads as
 * young at any size. The stoop is nerves, not age.
 */
export const BUCKET_BOY_BUILD: CrocBuild = {
  id: 'bucket_boy',
  hipY: -0.48,
  waistY: -0.6,
  chestY: -0.71,
  shoulderY: -0.8,
  neckBaseY: -0.83,
  headHeight: 0.3,
  headRise: 0.07,
  headForward: 0.05,
  snoutLength: 1.02,
  jawDepth: 0.22,
  eyeRadius: 0.15,
  thigh: 0.232,
  shin: 0.224,
  ankleHeight: 0.035,
  footToBall: 0.065,
  toeLength: 0.05,
  heelLength: 0.028,
  upperArm: 0.175,
  forearm: 0.16,
  handLength: 0.06,
  legRootHalf: 0.058,
  armRootHalf: 0.112,
  facingTorso: {
    shoulderLead: 0.118,
    shoulderTrail: 0.118,
    chestLead: 0.108,
    chestTrail: 0.108,
    waistLead: 0.094,
    waistTrail: 0.094,
    hipLead: 0.098,
    hipTrail: 0.098,
  },
  profileTorso: {
    shoulderLead: 0.066,
    shoulderTrail: 0.078,
    chestLead: 0.082,
    chestTrail: 0.074,
    waistLead: 0.076,
    waistTrail: 0.068,
    hipLead: 0.07,
    hipTrail: 0.088,
  },
  arm: { root: 0.028, joint: 0.022, belly: 0.025, tip: 0.018, bellyAt: 0.3 },
  leg: { root: 0.043, joint: 0.03, belly: 0.034, tip: 0.023, bellyAt: 0.28 },
  neckWidth: 0.064,
  tailLength: 0.68,
  tailRootWidth: 0.07,
  tailTipWidth: 0.008,
  restLean: deg(12),
  restHeadPitch: deg(9),
  footSpreadShare: 0.8,
  skirt: false,
  feminine: false,
  outfit: 'band_tee',
  armband: true,
  palette: {
    scales: { dark: '#34443a', mid: '#5e7563', light: '#88a08a' },
    belly: { dark: '#8c8a64', mid: '#bab68c', light: '#dcd8ae' },
    band: '#2a352d',
    rim: '#c8dcc4',
    rimAlpha: 0.22,
  },
  strokeScale: 1,
};

/**
 * Big, broad and upright: shoulders twice his width, a head that is a smaller
 * share of her height, and hands and feet that stay a human share of it —
 * oversized extremities on a large figure read as a toddler, not as a bouncer.
 */
export const CLARABELLE_BUILD: CrocBuild = {
  id: 'clarabelle',
  hipY: -0.82,
  waistY: -1.06,
  chestY: -1.32,
  shoulderY: -1.52,
  neckBaseY: -1.57,
  headHeight: 0.46,
  headRise: 0.1,
  headForward: 0.05,
  snoutLength: 0.9,
  jawDepth: 0.27,
  eyeRadius: 0.12,
  thigh: 0.405,
  shin: 0.395,
  ankleHeight: 0.05,
  footToBall: 0.1,
  toeLength: 0.07,
  heelLength: 0.045,
  upperArm: 0.34,
  forearm: 0.31,
  handLength: 0.1,
  legRootHalf: 0.11,
  armRootHalf: 0.34,
  facingTorso: {
    shoulderLead: 0.37,
    shoulderTrail: 0.37,
    chestLead: 0.34,
    chestTrail: 0.34,
    waistLead: 0.22,
    waistTrail: 0.22,
    hipLead: 0.27,
    hipTrail: 0.27,
  },
  profileTorso: {
    shoulderLead: 0.16,
    shoulderTrail: 0.17,
    chestLead: 0.21,
    chestTrail: 0.16,
    waistLead: 0.19,
    waistTrail: 0.14,
    hipLead: 0.14,
    hipTrail: 0.17,
  },
  arm: { root: 0.078, joint: 0.062, belly: 0.066, tip: 0.048, bellyAt: 0.3 },
  leg: { root: 0.1, joint: 0.07, belly: 0.08, tip: 0.05, bellyAt: 0.28 },
  neckWidth: 0.125,
  tailLength: 0.78,
  tailRootWidth: 0.1,
  tailTipWidth: 0.012,
  restLean: deg(3),
  restHeadPitch: deg(-4),
  footSpreadShare: 1.25,
  skirt: true,
  feminine: true,
  outfit: 'security_suit',
  armband: false,
  palette: {
    scales: { dark: '#2e3b2c', mid: '#526747', light: '#7a9066' },
    belly: { dark: '#86845c', mid: '#b0ab80', light: '#d2cda2' },
    band: '#253024',
    rim: '#b8c8d8',
    rimAlpha: 0.34,
  },
  strokeScale: 1.35,
};

// ── Garment palettes ─────────────────────────────────────────────────────────

/**
 * Neon pink, and it has to be loud: the tee is the one thing on him the player
 * picks out from across a room, and it is what makes a timid green lizard read
 * as a club kid rather than as one more dungeon reptile.
 */
const TEE: Ramp = { dark: '#b8286f', mid: '#ff4fac', light: '#ff96cf' };
/** A logo, not a word: a pale badge with a dark bar where the lettering would sit. */
const TEE_LOGO = '#fff2c4';
const TEE_LOGO_BAR = '#8a1a55';
const TEE_LOGO_STAR = '#ffd23c';
/** Faded denim, so the shorts separate from both the pink and the green. */
const SHORTS: Ramp = { dark: '#2e3a56', mid: '#4b5d82', light: '#7385a8' };
const SHORTS_FRAY = '#a8b4cc';
/**
 * Charcoal rather than black. A black suit on a dark club floor is a hole in the
 * picture at tile size; this is the darkest value that still separates.
 */
const SUIT: Ramp = { dark: '#1d1f27', mid: '#34374a', light: '#565b74' };
const SHIRT = '#e2ded2';
/** A shade under the jacket, so the skirt reads as its own garment and not as a longer coat. */
const SKIRT = '#2a2c38';
const TIE = '#7a1f2c';
const BADGE = '#e3b640';
const EARPIECE = '#8d93a0';
/** Blue-white, well clear of the tooth ivory beside it. */
const PEARL = '#e8eef8';

const TIN: Ramp = { dark: '#56606a', mid: '#98a2ac', light: '#dbe3ea' };
const TIN_INSIDE = '#3d444c';
const BAIL = '#6d747c';

/** Triage's green, painted additively over the hands. */
const GLOW_CORE = '#eaffd8';
const GLOW_MID = '#6cf07a';
const GLOW_EDGE = '#1ea84a';

// ── Views ────────────────────────────────────────────────────────────────────

export type CrocView = 'front' | 'side' | 'away';

interface ViewSpec {
  readonly name: CrocView;
  readonly profile: boolean;
  readonly showsFace: boolean;
  readonly showsBack: boolean;
  /** Multiplier on how far apart the two legs root; edge-on they nearly overlap. */
  readonly lateral: number;
  readonly armSpread: number;
  /** How much of the trunk's forward lean the view can show sideways. */
  readonly leanProjection: number;
  /** How much of a foot's fore-and-aft length shows. */
  readonly footProjection: number;
  /**
   * The head's turn about the vertical axis. A quarter turn is the true profile;
   * head-on views hold it well short of square, because a snout pointed at the
   * camera cannot be drawn so that it reads as a snout.
   */
  readonly headYaw: number;
  /** Paint everything reflected in X — the away view is the front view from behind. */
  readonly mirrored: boolean;
}

/**
 * How far the head-on views keep the head turned. Below about 0.6 of the
 * profile's length the skull is a narrow vertical smear with a pinched eye.
 */
const FACING_HEAD_YAW = deg(46);
/**
 * From behind, turned further away, so only the tip of the snout clears the
 * back of the skull.
 */
const AWAY_HEAD_YAW = deg(146);
const PROFILE_LATERAL = 0.35;
const PROFILE_ARM_SPREAD = 0.2;
const FACING_FOOT_PROJECTION = 0.35;

const VIEWS: Record<CrocView, ViewSpec> = {
  front: {
    name: 'front',
    profile: false,
    showsFace: true,
    showsBack: false,
    lateral: 1,
    armSpread: 1,
    leanProjection: 0,
    footProjection: FACING_FOOT_PROJECTION,
    headYaw: FACING_HEAD_YAW,
    mirrored: false,
  },
  side: {
    name: 'side',
    profile: true,
    showsFace: true,
    showsBack: false,
    lateral: PROFILE_LATERAL,
    armSpread: PROFILE_ARM_SPREAD,
    leanProjection: 1,
    footProjection: 1,
    headYaw: HALF_PI,
    mirrored: false,
  },
  away: {
    name: 'away',
    profile: false,
    showsFace: false,
    showsBack: true,
    lateral: 1,
    armSpread: 1,
    leanProjection: 0,
    footProjection: FACING_FOOT_PROJECTION,
    headYaw: AWAY_HEAD_YAW,
    mirrored: true,
  },
};

// ── Pose ─────────────────────────────────────────────────────────────────────

/**
 * One plantigrade foot. The authored point is the **ball**, where the weight
 * goes; the ankle is derived from it by rolling the foot about the ball, so a
 * heel rising off the floor at push-off leaves the ball exactly where it was.
 */
export interface CrocFootPose {
  /** Ground contact under the ball. A y below 0 lifts the foot clear. */
  readonly ball: Pt;
  /** Heel lift about the ball, radians; positive raises the heel, negative the toes. */
  readonly heelLift: number;
  /**
   * Which way the knee breaks, +1 toward +X. Edge-on both knees break forward;
   * head-on a deep crouch splays each knee away from the centreline.
   */
  readonly kneeBreak: number;
  /** 0 to 1: pulls the knee onto the hip→ankle line, for a knee pointed at the camera. */
  readonly foreshorten: number;
  /** 0 to 1: how much nearer the camera the shin is than the thigh; only changes widths. */
  readonly nearness: number;
}

/** Joint angles for an arm, radians from hanging straight down; positive swings toward +X. */
export interface ArmAngles {
  readonly upper: number;
  readonly fore: number;
  /** Fraction of its length the forearm is drawn at — the only way a 2D arm foreshortens. */
  readonly foreScale: number;
}

export interface CrocArmPose {
  /** FK angles win over the hand target when set. Walking arms are FK; reaching arms are not. */
  readonly angles: ArmAngles | null;
  /** Wrist target, when the arm is placed by its hand. */
  readonly hand: Pt;
  /** Which side the elbow pops out to: +1 down or back for a figure facing +X. */
  readonly bend: number;
  /** 0 open hand, 1 fist. */
  readonly curl: number;
  /** Absolute direction the fingers point, or null to follow the forearm. */
  readonly handAngle: number | null;
  /** Head-on only: drawn behind the torso rather than in front of it. */
  readonly behind: boolean;
  /** Shows the pale palm pad to the viewer — an open hand held up, palm out. */
  readonly palmOut: boolean;
}

/** Where the tin bucket is. */
export type BucketPose =
  /** Hanging by its bail from the near hand, swung this far off plumb. */
  | { readonly kind: 'hang'; readonly swing: number }
  /** Somewhere absolute — on the floor, held overhead, flying loose. */
  | {
      readonly kind: 'placed';
      /** Centre of the bucket's body, in figure units. */
      readonly centre: Pt;
      readonly tilt: number;
      /** Mouth down, as when it is held over the head as a shield. */
      readonly inverted: boolean;
      /** Drawn over the body rather than behind it. */
      readonly front: boolean;
    }
  | { readonly kind: 'none' };

export interface CrocPose {
  /** Whole-body vertical offset; positive drops the pelvis. */
  bob: number;
  /** Sideways shift of the pelvis, in tiles — a head-on weight shift. */
  sway: number;
  /** Forward lean of the trunk, radians; shows edge-on. */
  lean: number;
  /** Sideways tilt of the trunk in the picture plane, radians; shows head-on. */
  roll: number;
  /** Chest expansion, −1 to 1. */
  breath: number;
  /** Head pitch, radians; positive noses down. */
  headPitch: number;
  /**
   * The head's rotation in the picture plane, in every view — a skull lolling
   * over on a limp neck, which a pitch cannot express head-on.
   */
  headRoll: number;
  /** Added to the view's own head turn; positive turns the snout further toward +X. */
  headYaw: number;
  /** 0 closed, 1 fully agape. */
  jaw: number;
  /** 0 eyes open, 1 shut. */
  blink: number;
  near: CrocFootPose;
  far: CrocFootPose;
  nearArm: CrocArmPose;
  farArm: CrocArmPose;
  /** How far the tail's root swings off its rest line, radians. */
  tailSwing: number;
  /** Extra bend along the tail, radians; positive curls the tip down. */
  tailCurl: number;
  bucket: BucketPose;
  /** Triage's glow on both hands, 0 to 1. */
  glow: number;
  /**
   * The whole body tipping over about a point on the floor, for the death row.
   * The shadow and a loose bucket stay on the floor; everything else rotates.
   */
  topple: number;
  /** Pivot of the topple, in figure units. */
  toppleAt: Pt;
  /** How far the toppled body is lifted back up off the floor, so it lies on it rather than in it. */
  toppleLift: number;
  /** A motion smear trailing the far hand, 0 to 1, for the frame a swing lands. */
  smear: number;
  /** How far back along its arc the smear trails, radians; the sign is the swing's direction. */
  smearSweep: number;
}

/** A relaxed arm hangs this share of its full reach, measured from the shoulder joint. */
const ARM_HANG_REACH = 0.97;
/** How far behind the shoulder a relaxed hand hangs, edge-on. */
const REST_HAND_BEHIND = 0.02;
const REST_HAND_CURL = 0.45;
/** Edge-on the feet stagger fore-and-aft so the two shins do not merge into one. */
const REST_FOOT_STAGGER = 0.045;

/** The ball of a standing foot, relative to the leg root above it. */
export function restFoot(build: CrocBuild, lead: number): CrocFootPose {
  return {
    ball: pt(lead + ankleUnderHip(build), 0),
    heelLift: 0,
    kneeBreak: 1,
    foreshorten: 0,
    nearness: 0,
  };
}

/**
 * How far forward of the leg root an edge-on foot's ball sits so the ankle,
 * not the ball, stands under the hip. Planted by the ball, the whole leg slants
 * back to an ankle behind the pelvis and the figure reads as leaning backward.
 */
export function ankleUnderHip(build: CrocBuild): number {
  return build.footToBall * ANKLE_UNDER_HIP_SHARE;
}

const ANKLE_UNDER_HIP_SHARE = 0.45;

/** A relaxed standing pose for a build. Every animation is written as edits to this. */
export function restingPose(build: CrocBuild): CrocPose {
  const shoulderDrop = shoulderJointDrop(build);
  const reach = (build.upperArm + build.forearm) * ARM_HANG_REACH;
  const shoulderX = Math.sin(build.restLean) * (build.shoulderY - build.hipY) * -1;
  const handY = build.shoulderY + shoulderDrop + reach;
  const hangingArm = (x: number): CrocArmPose => ({
    angles: null,
    hand: pt(x, handY),
    bend: 1,
    curl: REST_HAND_CURL,
    handAngle: null,
    behind: false,
    palmOut: false,
  });
  return {
    bob: 0,
    sway: 0,
    lean: build.restLean,
    roll: 0,
    breath: 0,
    headPitch: build.restHeadPitch,
    headYaw: 0,
    headRoll: 0,
    jaw: 0,
    blink: 0,
    near: restFoot(build, REST_FOOT_STAGGER),
    far: restFoot(build, -REST_FOOT_STAGGER),
    nearArm: hangingArm(shoulderX - REST_HAND_BEHIND),
    farArm: hangingArm(shoulderX - REST_HAND_BEHIND * 2),
    tailSwing: 0,
    tailCurl: 0,
    bucket: { kind: 'none' },
    glow: 0,
    topple: 0,
    toppleAt: pt(0, 0),
    toppleLift: 0,
    smear: 0,
    smearSweep: 0,
  };
}

/** Head-on standing feet, under the hips. */
export function facingRestFeet(build: CrocBuild): { near: CrocFootPose; far: CrocFootPose } {
  const spread = build.legRootHalf * build.footSpreadShare;
  const column = (x: number): CrocFootPose => ({
    ball: pt(x, 0),
    heelLift: 0,
    kneeBreak: 1,
    foreshorten: 1,
    nearness: 0,
  });
  return { near: column(spread), far: column(-spread) };
}

// ── Skeleton ─────────────────────────────────────────────────────────────────

export interface BoneChain {
  readonly root: Pt;
  readonly joint: Pt;
  readonly end: Pt;
}

/**
 * Keeps a fully extended limb from locking into a straight line. Tiny, because
 * the joint's sideways travel grows as the square root of it.
 */
const JOINT_SLACK = 0.0004;

/**
 * Places a two-segment limb so its end sits on `target`. `bendSign` +1 throws
 * the joint to the right of the root→target direction as drawn — down for a
 * limb reaching toward +X, toward −X for one hanging straight down.
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
  const end = pt(root.x + dirX * dist, root.y + dirY * dist);
  const alongDist = (dist * dist + upper * upper - lower * lower) / (2 * dist);
  const out = Math.sqrt(Math.max(0, upper * upper - alongDist * alongDist));
  const joint = pt(
    root.x + dirX * alongDist - dirY * out * bendSign,
    root.y + dirY * alongDist + dirX * out * bendSign,
  );
  return { root, joint, end };
}

/** How far hip→ankle can stretch before the solver clamps the leg straight. */
export function legReachLimit(build: CrocBuild): number {
  return build.thigh + build.shin - JOINT_SLACK;
}

/** The shoulder joint hangs below the shoulder line, where the deltoid is. */
function shoulderJointDrop(build: CrocBuild): number {
  return (build.neckBaseY - build.shoulderY) * -1 + build.arm.root * MIDPOINT;
}

/** The ankle above a foot, rolled about the ball by the heel lift. */
export function ankleFor(build: CrocBuild, foot: CrocFootPose, projection: number): Pt {
  const back = rotate(pt(-build.footToBall * projection, -build.ankleHeight), foot.heelLift);
  return offset(foot.ball, back.x, back.y);
}

interface Skeleton {
  readonly hip: Pt;
  readonly waist: Pt;
  readonly chest: Pt;
  readonly shoulder: Pt;
  readonly neck: Pt;
  readonly headCentre: Pt;
  /** Unit vector up the spine, hip toward shoulder. */
  readonly up: Pt;
  /** Unit vector square to the spine, toward the +X side. */
  readonly across: Pt;
  readonly nearLeg: BoneChain;
  readonly farLeg: BoneChain;
  readonly nearArm: BoneChain;
  readonly farArm: BoneChain;
}

function hipPoint(build: CrocBuild, pose: CrocPose, view: ViewSpec): Pt {
  return pt(view.profile ? 0 : pose.sway, build.hipY + pose.bob);
}

/** Spine direction: forward lean shows edge-on, roll shows head-on. */
function spineUp(pose: CrocPose, view: ViewSpec): Pt {
  const lean = pose.lean;
  const upright = pt(Math.sin(lean) * view.leanProjection, -Math.cos(lean));
  const rolled = view.profile ? upright : rotate(upright, pose.roll);
  const length = Math.hypot(rolled.x, rolled.y);
  return pt(rolled.x / length, rolled.y / length);
}

function spinePoint(hip: Pt, up: Pt, pose: CrocPose, height: number, view: ViewSpec): Pt {
  // A lean toward the camera shortens the trunk head-on; the direction vector
  // above has already dropped its sideways part, so only the length changes.
  const shortening = view.profile ? 1 : Math.cos(pose.lean);
  return offset(hip, up.x * height * shortening, up.y * height * shortening);
}

function foreshortenLeg(build: CrocBuild, chain: BoneChain, amount: number): BoneChain {
  if (amount <= 0) return chain;
  const kneeAlong = build.thigh / (build.thigh + build.shin);
  const straightKnee = mixPt(chain.root, chain.end, kneeAlong);
  return { ...chain, joint: mixPt(chain.joint, straightKnee, clamp01(amount)) };
}

function legChain(build: CrocBuild, root: Pt, foot: CrocFootPose, view: ViewSpec): BoneChain {
  const ankle = ankleFor(build, foot, view.footProjection);
  return foreshortenLeg(
    build,
    solveTwoBone(root, ankle, build.thigh, build.shin, -foot.kneeBreak),
    foot.foreshorten,
  );
}

function armFromAngles(build: CrocBuild, shoulder: Pt, angles: ArmAngles): BoneChain {
  const upper = rotate(pt(0, build.upperArm), -angles.upper);
  const joint = offset(shoulder, upper.x, upper.y);
  const fore = rotate(pt(0, build.forearm * angles.foreScale), -angles.fore);
  return { root: shoulder, joint, end: offset(joint, fore.x, fore.y) };
}

function armChain(build: CrocBuild, shoulder: Pt, arm: CrocArmPose): BoneChain {
  if (arm.angles !== null) return armFromAngles(build, shoulder, arm.angles);
  return solveTwoBone(shoulder, arm.hand, build.upperArm, build.forearm, arm.bend);
}

/** Edge-on, both shoulders sit forward of the spine so the arm clears the chest. */
const PROFILE_ARM_FORWARD = 0.25;

/** The two shoulder joints of a pose, for a choreography placing hands relative to them. */
export function shoulderJoints(
  build: CrocBuild,
  pose: CrocPose,
  viewName: CrocView,
): { near: Pt; far: Pt } {
  const skeleton = buildSkeleton(build, pose, VIEWS[viewName]);
  return { near: skeleton.nearArm.root, far: skeleton.farArm.root };
}

function buildSkeleton(build: CrocBuild, pose: CrocPose, view: ViewSpec): Skeleton {
  const hip = hipPoint(build, pose, view);
  const up = spineUp(pose, view);
  const across = pt(-up.y, up.x);
  const rise = (y: number): number => build.hipY - y;
  const waist = spinePoint(hip, up, pose, rise(build.waistY), view);
  const chest = spinePoint(hip, up, pose, rise(build.chestY), view);
  const shoulder = spinePoint(hip, up, pose, rise(build.shoulderY), view);
  const neck = spinePoint(hip, up, pose, rise(build.neckBaseY), view);
  const headForward = view.profile ? build.headForward : 0;
  const headCentre = offset(neck, headForward, -build.headRise);

  const drop = shoulderJointDrop(build);
  const armHalf = build.armRootHalf * view.armSpread;
  const forward = view.profile ? build.profileTorso.shoulderLead * PROFILE_ARM_FORWARD : 0;
  const shoulderAt = (side: number): Pt =>
    offset(shoulder, across.x * armHalf * side + forward, across.y * armHalf * side + drop);
  const legHalf = build.legRootHalf * view.lateral;
  const legRoot = (side: number): Pt => offset(hip, legHalf * side, 0);

  return {
    hip,
    waist,
    chest,
    shoulder,
    neck,
    headCentre,
    up,
    across,
    nearLeg: legChain(build, legRoot(1), pose.near, view),
    farLeg: legChain(build, legRoot(-1), pose.far, view),
    nearArm: armChain(build, shoulderAt(1), pose.nearArm),
    farArm: armChain(build, shoulderAt(-1), pose.farArm),
  };
}

/** What a gate needs to know about one leg without seeing the rig. */
export interface LegMeasure {
  readonly hipToAnkle: number;
  readonly hip: Pt;
  readonly ankle: Pt;
  readonly knee: Pt;
}

/** Both legs of a pose, measured, for the reach-headroom and foot-slide gates. */
export function measureLegs(
  build: CrocBuild,
  pose: CrocPose,
  viewName: CrocView,
): { near: LegMeasure; far: LegMeasure } {
  const view = VIEWS[viewName];
  const skeleton = buildSkeleton(build, pose, view);
  const measure = (chain: BoneChain, foot: CrocFootPose): LegMeasure => {
    const ankle = ankleFor(build, foot, view.footProjection);
    return {
      hipToAnkle: Math.hypot(ankle.x - chain.root.x, ankle.y - chain.root.y),
      hip: chain.root,
      ankle,
      knee: chain.joint,
    };
  };
  return {
    near: measure(skeleton.nearLeg, pose.near),
    far: measure(skeleton.farLeg, pose.far),
  };
}

/** The landmarks a choreography places props and hands against. */
export function skeletonLandmarks(
  build: CrocBuild,
  pose: CrocPose,
  viewName: CrocView,
): { headCentre: Pt; chest: Pt; waist: Pt; nearHand: Pt; farHand: Pt } {
  const skeleton = buildSkeleton(build, pose, VIEWS[viewName]);
  return {
    headCentre: skeleton.headCentre,
    chest: skeleton.chest,
    waist: skeleton.waist,
    nearHand: skeleton.nearArm.end,
    farHand: skeleton.farArm.end,
  };
}

/** Where both wrists land, for the gates that check a reach or a grip. */
export function measureHands(
  build: CrocBuild,
  pose: CrocPose,
  viewName: CrocView,
): { near: BoneChain; far: BoneChain } {
  const skeleton = buildSkeleton(build, pose, VIEWS[viewName]);
  return { near: skeleton.nearArm, far: skeleton.farArm };
}

// ── Low-level painting ───────────────────────────────────────────────────────

/** Painting context: the stroke widths scale with the build. */
interface Paint {
  readonly ctx: Ctx;
  readonly build: CrocBuild;
  readonly view: ViewSpec;
  /** The light's x in the space being painted; a mirrored view flips it back. */
  readonly lightX: number;
}

const BODY_OUTLINE = 0.018;
const DETAIL_OUTLINE = 0.011;
const OUTLINE_BLEED = 0.009;

function outlineWidth(paint: Paint): number {
  return BODY_OUTLINE * paint.build.strokeScale;
}

function bleed(paint: Paint): number {
  return OUTLINE_BLEED * paint.build.strokeScale;
}

function traceCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number): void {
  const normal = angleBetween(a, b) + HALF_PI;
  const nx = Math.cos(normal);
  const ny = Math.sin(normal);
  ctx.beginPath();
  ctx.arc(a.x, a.y, Math.max(wa, 0), normal, normal + Math.PI);
  ctx.lineTo(b.x - nx * wb, b.y - ny * wb);
  ctx.arc(b.x, b.y, Math.max(wb, 0), normal + Math.PI, normal + TWO_PI);
  ctx.lineTo(a.x + nx * wa, a.y + ny * wa);
  ctx.closePath();
}

function fillCapsule(ctx: Ctx, a: Pt, b: Pt, wa: number, wb: number, fill: string): void {
  traceCapsule(ctx, a, b, wa, wb);
  ctx.fillStyle = fill;
  ctx.fill();
}

function outlineCapsule(paint: Paint, a: Pt, b: Pt, wa: number, wb: number): void {
  const extra = bleed(paint);
  fillCapsule(paint.ctx, a, b, wa + extra, wb + extra, OUTLINE);
}

const SHEEN_OFFSET = 0.42;
const SHEEN_WIDTH = 0.34;
const SHEEN_TAPER = 0.7;

/** A light stroke down the lit side of a segment. */
function sheenSegment(paint: Paint, a: Pt, b: Pt, width: number, colour: string): void {
  const { ctx } = paint;
  const normal = angleBetween(a, b) + HALF_PI;
  const facing = Math.cos(normal) * paint.lightX + Math.sin(normal) * LIGHT_Y;
  const push = width * SHEEN_OFFSET * (facing >= 0 ? 1 : -1);
  const nx = Math.cos(normal) * push;
  const ny = Math.sin(normal) * push;
  ctx.save();
  ctx.globalAlpha *= SHEEN_ALPHA;
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

/** Strokes then fills a closed path, so the outline shows only outside the fill. */
function fillOutlined(paint: Paint, trace: () => void, fill: string, width?: number): void {
  const { ctx } = paint;
  ctx.save();
  trace();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = width ?? outlineWidth(paint);
  ctx.lineJoin = 'round';
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.restore();
}

/** Below this an alpha serialises in exponent notation and node-canvas drops the colour. */
const MIN_VISIBLE_ALPHA = 1e-4;

const SHADOW_FLATTEN = 0.3;
const SHADOW_RX_SHARE = 1.25;

/** Soft elliptical contact shadow on the floor. */
function drawGroundShadow(ctx: Ctx, centreX: number, radiusX: number, alpha: number): void {
  if (alpha < MIN_VISIBLE_ALPHA) return;
  ctx.save();
  ctx.translate(centreX, 0);
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

/** Far limbs sit in the body's shade, edge-on only. */
const FAR_LIMB_SHADE = 0.32;
const UNSHADED = 0;

// ── Limbs ────────────────────────────────────────────────────────────────────

/** What covers a limb segment. */
interface Covering {
  readonly ramp: Ramp;
  /** Added to every half-width, because cloth sits outside the limb. */
  readonly bulk: number;
}

function drawLimb(
  paint: Paint,
  chain: BoneChain,
  shape: LimbShape,
  covering: Covering,
  shade: number,
): void {
  const belly = mixPt(chain.joint, chain.end, shape.bellyAt);
  const fill = mix(covering.ramp.mid, OUTLINE, shade);
  const light = mix(covering.ramp.light, OUTLINE, shade);
  const w = (width: number): number => width + covering.bulk;
  outlineCapsule(paint, chain.root, chain.joint, w(shape.root), w(shape.joint));
  outlineCapsule(paint, chain.joint, belly, w(shape.joint), w(shape.belly));
  outlineCapsule(paint, belly, chain.end, w(shape.belly), w(shape.tip));
  fillCapsule(paint.ctx, chain.root, chain.joint, w(shape.root), w(shape.joint), fill);
  fillCapsule(paint.ctx, chain.joint, belly, w(shape.joint), w(shape.belly), fill);
  fillCapsule(paint.ctx, belly, chain.end, w(shape.belly), w(shape.tip), fill);
  sheenSegment(paint, chain.root, chain.joint, w(shape.root), light);
  sheenSegment(paint, chain.joint, chain.end, w(shape.belly), light);
}

/** A leg swung at the camera draws wider below the knee, which is what says nearer. */
const NEAR_SHIN_GROWTH = 0.18;

function legShapeFor(shape: LimbShape, nearness: number): LimbShape {
  const t = clamp01(nearness);
  if (t <= 0) return shape;
  return {
    ...shape,
    joint: lerp(shape.joint, shape.root, t),
    belly: shape.belly * (1 + NEAR_SHIN_GROWTH * t),
    tip: shape.tip * (1 + NEAR_SHIN_GROWTH * t),
  };
}

// ── Feet ─────────────────────────────────────────────────────────────────────

const TOE_COUNT = 3;
const TOE_FAN = deg(26);
const TOE_WIDTH_SHARE = 0.34;
const CLAW_SHARE = 0.45;
/** Head-on, the toes fan across the screen, since fore-and-aft shows nothing. */
const FACING_TOE_SPREAD = 0.9;
const FACING_TOE_DROP = 0.35;

/** A broad, flat, three-clawed foot seen edge-on. */
function drawFootProfile(
  paint: Paint,
  ankle: Pt,
  foot: CrocFootPose,
  skin: Ramp,
  shade: number,
): void {
  const { ctx, build } = paint;
  const fill = mix(skin.mid, OUTLINE, shade);
  const ball = foot.ball;
  // The sole runs heel to ball; a peeled heel tips it down toward the toes.
  const soleAngle = foot.heelLift;
  const heelBack = rotate(pt(-build.heelLength, build.ankleHeight * MIDPOINT), soleAngle);
  const heel = offset(ankle, heelBack.x, heelBack.y);
  const width = build.leg.tip;
  outlineCapsule(paint, heel, ball, width * 0.8, width * 0.85);
  outlineCapsule(paint, ankle, ball, width, width * 0.85);
  fillCapsule(ctx, heel, ball, width * 0.8, width * 0.85, fill);
  fillCapsule(ctx, ankle, ball, width, width * 0.85, fill);

  const toeWidth = width * TOE_WIDTH_SHARE * 2;
  for (let i = 0; i < TOE_COUNT; i++) {
    const fan = (i / (TOE_COUNT - 1) - MIDPOINT) * TOE_FAN;
    // Toes stay flat on the floor through a heel peel; only raised toes rotate.
    const toeAngle = Math.min(0, soleAngle) + fan * MIDPOINT;
    const tip = along(ball, toeAngle, build.toeLength);
    outlineCapsule(paint, ball, tip, toeWidth, toeWidth * 0.7);
    fillCapsule(
      ctx,
      ball,
      tip,
      toeWidth,
      toeWidth * 0.7,
      i === 0 ? mix(fill, OUTLINE, 0.25) : fill,
    );
    const claw = along(tip, toeAngle + deg(20), build.toeLength * CLAW_SHARE);
    fillCapsule(ctx, tip, claw, toeWidth * 0.55, 0, CLAW);
  }
}

/**
 * Head-on the foot points at the camera: a short wedge under the ankle with the
 * toes fanned across the screen and turned out a little, sole kept level.
 */
function drawFootFacing(
  paint: Paint,
  ankle: Pt,
  foot: CrocFootPose,
  outward: number,
  skin: Ramp,
): void {
  const { ctx, build } = paint;
  const ball = foot.ball;
  const width = build.leg.tip;
  const fill = skin.mid;
  outlineCapsule(paint, ankle, ball, width, width * 1.15);
  fillCapsule(ctx, ankle, ball, width, width * 1.15, fill);
  const toeWidth = width * TOE_WIDTH_SHARE * 2;
  for (let i = 0; i < TOE_COUNT; i++) {
    const spread = (i / (TOE_COUNT - 1) - MIDPOINT) * width * 2 * FACING_TOE_SPREAD;
    const tip = offset(
      ball,
      spread + outward * build.toeLength * 0.3,
      build.toeLength * FACING_TOE_DROP,
    );
    outlineCapsule(paint, offset(ball, spread * MIDPOINT, 0), tip, toeWidth, toeWidth * 0.75);
    fillCapsule(ctx, offset(ball, spread * MIDPOINT, 0), tip, toeWidth, toeWidth * 0.75, fill);
    if (!paint.view.showsBack) {
      fillCapsule(ctx, tip, offset(tip, spread * 0.2, toeWidth * 1.4), toeWidth * 0.5, 0, CLAW);
    }
  }
}

function drawLeg(
  paint: Paint,
  chain: BoneChain,
  foot: CrocFootPose,
  outward: number,
  shade: number,
): void {
  const { build, view } = paint;
  const skin = build.palette.scales;
  const shape = legShapeFor(build.leg, foot.nearness);
  // Trouser legs cover the whole leg down to the ankle; shorts and a skirt leave it bare.
  const suit = build.outfit === 'security_suit' && !build.skirt;
  drawLimb(
    paint,
    chain,
    shape,
    suit ? { ramp: SUIT, bulk: shape.root * 0.12 } : { ramp: skin, bulk: 0 },
    shade,
  );
  if (!suit) drawLegScutes(paint, chain, shape, shade);
  if (view.profile) drawFootProfile(paint, chain.end, foot, skin, shade);
  else drawFootFacing(paint, chain.end, foot, outward, skin);
  if (suit) drawTrouserHem(paint, chain, shape, shade);
}

const SCUTE_BAND_ALPHA = 0.32;

/** A few dark crossbands down a bare shin: at tile size that is what scales read as. */
function drawLegScutes(paint: Paint, chain: BoneChain, shape: LimbShape, shade: number): void {
  const { ctx } = paint;
  const bands = [0.35, 0.62, 0.85];
  ctx.save();
  ctx.globalAlpha *= SCUTE_BAND_ALPHA;
  ctx.strokeStyle = mix(paint.build.palette.band, OUTLINE, shade);
  ctx.lineWidth = DETAIL_OUTLINE * paint.build.strokeScale;
  const dir = angleBetween(chain.joint, chain.end) + HALF_PI;
  for (const t of bands) {
    const at = mixPt(chain.joint, chain.end, t);
    const half = lerp(shape.joint, shape.tip, t);
    ctx.beginPath();
    ctx.moveTo(at.x + Math.cos(dir) * half, at.y + Math.sin(dir) * half);
    ctx.lineTo(at.x - Math.cos(dir) * half, at.y - Math.sin(dir) * half);
    ctx.stroke();
  }
  ctx.restore();
}

/** A trouser hem breaking over the top of the foot. */
function drawTrouserHem(paint: Paint, chain: BoneChain, shape: LimbShape, shade: number): void {
  const hemTop = mixPt(chain.joint, chain.end, 0.8);
  const bulk = shape.root * 0.2;
  outlineCapsule(paint, hemTop, chain.end, shape.tip + bulk, shape.tip + bulk);
  fillCapsule(
    paint.ctx,
    hemTop,
    chain.end,
    shape.tip + bulk,
    shape.tip + bulk,
    mix(SUIT.mid, OUTLINE, shade),
  );
}

// ── Hands ────────────────────────────────────────────────────────────────────

const FINGER_COUNT = 3;
const FINGER_FAN = deg(40);
const FINGER_LENGTH_SHARE = 0.55;
const FINGER_WIDTH_SHARE = 0.2;
/** A hand as narrow as its wrist reads as a stick; this clears it by a margin. */
const PALM_WIDTH_SHARE = 1.35;
const THUMB_ANGLE = deg(55);
const HAND_CURL_FOLD = 0.75;
/** A hand does not take the full angle of its forearm; the wrist holds it to the whole arm's line. */
const WRIST_FOLLOW = 0.3;

function wristAngle(chain: BoneChain): number {
  const alongArm = angleBetween(chain.root, chain.end);
  const alongForearm = angleBetween(chain.joint, chain.end);
  return lerp(alongArm, alongForearm, WRIST_FOLLOW);
}

function drawHand(
  paint: Paint,
  wrist: Pt,
  angle: number,
  curl: number,
  shade: number,
  palmOut = false,
): void {
  const { ctx, build } = paint;
  const closed = clamp01(curl);
  const skin = mix(build.palette.scales.mid, OUTLINE, shade);
  const palmLength = build.handLength * (1 - closed * 0.3);
  const palmEnd = along(wrist, angle, palmLength * 0.55);
  const palmHalf = build.arm.tip * PALM_WIDTH_SHARE;
  outlineCapsule(paint, wrist, palmEnd, build.arm.tip, palmHalf);
  fillCapsule(ctx, wrist, palmEnd, build.arm.tip, palmHalf, skin);

  // Held up palm-out the fingers spread wide and long; bunched, an open hand
  // at tile size is a fist.
  const spread = palmOut ? PALM_OUT_SPREAD : 1;
  const fingerLength =
    build.handLength * FINGER_LENGTH_SHARE * (1 - closed * HAND_CURL_FOLD) * spread;
  const fingerWidth = build.handLength * FINGER_WIDTH_SHARE;
  for (let i = 0; i < FINGER_COUNT; i++) {
    const fan = (i / (FINGER_COUNT - 1) - MIDPOINT) * FINGER_FAN * (1 - closed * MIDPOINT) * spread;
    const root = along(palmEnd, angle + fan + HALF_PI, (i - 1) * fingerWidth * 0.6);
    const tip = along(root, angle + fan + closed * deg(70), fingerLength);
    outlineCapsule(paint, root, tip, fingerWidth, fingerWidth * 0.7);
    fillCapsule(ctx, root, tip, fingerWidth, fingerWidth * 0.7, skin);
    if (closed < MIDPOINT) {
      const claw = along(tip, angle + fan, fingerWidth * 1.3);
      fillCapsule(ctx, tip, claw, fingerWidth * 0.45, 0, CLAW);
    }
  }
  const thumbRoot = mixPt(wrist, palmEnd, MIDPOINT);
  const thumbTip = along(
    thumbRoot,
    angle - THUMB_ANGLE * (1 - closed * 0.6),
    fingerLength * 0.9 + fingerWidth,
  );
  outlineCapsule(paint, thumbRoot, thumbTip, fingerWidth, fingerWidth * 0.7);
  fillCapsule(ctx, thumbRoot, thumbTip, fingerWidth, fingerWidth * 0.7, skin);
  if (palmOut) {
    // The pale pad of the palm turned to the viewer: without it an open hand
    // held up reads as a pointing fist.
    const pad = mixPt(wrist, palmEnd, PALM_PAD_AT);
    ctx.beginPath();
    ctx.arc(pad.x, pad.y, palmHalf * PALM_PAD_SIZE, 0, TWO_PI);
    ctx.fillStyle = mix(build.palette.belly.mid, OUTLINE, shade);
    ctx.fill();
  }
}

const PALM_PAD_AT = 0.7;
const PALM_OUT_SPREAD = 1.45;
const PALM_PAD_SIZE = 0.8;

/** How far down the upper arm the tee's short sleeve reaches. */
const SLEEVE_END = 0.48;
const SLEEVE_BULK = 0.014;
/** The armband sits just below the sleeve, where it cannot be mistaken for the sleeve's hem. */
const ARMBAND_FROM = 0.62;
const ARMBAND_TO = 0.88;
const ARMBAND_BULK = 0.008;
const SHIRT_CUFF_FROM = 0.84;
const SHIRT_CUFF_TO = 0.93;

function drawArm(
  paint: Paint,
  chain: BoneChain,
  arm: CrocArmPose,
  shade: number,
  wearsArmband: boolean,
): void {
  const { ctx, build } = paint;
  const suit = build.outfit === 'security_suit';
  const skin = build.palette.scales;
  const angle = arm.handAngle ?? wristAngle(chain);

  if (suit) {
    const bulk = build.arm.root * 0.18;
    drawLimb(paint, chain, build.arm, { ramp: SUIT, bulk }, shade);
    // A sliver of white cuff at the wrist: the one thing that says "suit" on an
    // arm. It stops short of the wrist, so the scaled hand comes out of it.
    const cuffFrom = mixPt(chain.joint, chain.end, SHIRT_CUFF_FROM);
    const cuffTo = mixPt(chain.joint, chain.end, SHIRT_CUFF_TO);
    const cuffWidth = build.arm.tip + bulk * 0.6;
    fillCapsule(ctx, cuffFrom, cuffTo, cuffWidth, cuffWidth, mix(SHIRT, OUTLINE, shade));
    drawHand(paint, chain.end, angle, arm.curl, shade, arm.palmOut);
    return;
  }

  drawLimb(paint, chain, build.arm, { ramp: skin, bulk: 0 }, shade);
  drawHand(paint, chain.end, angle, arm.curl, shade, arm.palmOut);

  const sleeveEnd = mixPt(chain.root, chain.joint, SLEEVE_END);
  const rootWidth = build.arm.root + SLEEVE_BULK;
  const endWidth = lerp(build.arm.root, build.arm.joint, SLEEVE_END) + SLEEVE_BULK;
  outlineCapsule(paint, chain.root, sleeveEnd, rootWidth, endWidth);
  fillCapsule(ctx, chain.root, sleeveEnd, rootWidth, endWidth, mix(TEE.mid, OUTLINE, shade));
  sheenSegment(paint, chain.root, sleeveEnd, rootWidth, mix(TEE.light, OUTLINE, shade));

  if (wearsArmband) {
    const from = mixPt(chain.root, chain.joint, ARMBAND_FROM);
    const to = mixPt(chain.root, chain.joint, ARMBAND_TO);
    const width = lerp(build.arm.root, build.arm.joint, ARMBAND_FROM) + ARMBAND_BULK;
    outlineCapsule(paint, from, to, width, width);
    fillCapsule(ctx, from, to, width, width, mix(ARMBAND, OUTLINE, shade));
  }
}

/**
 * From behind, an arm hangs at the body's side, so its upper half shows past
 * the back even when its hand is round the front — crossed arms included.
 */
function drawUpperArmFromBehind(paint: Paint, chain: BoneChain, wearsArmband: boolean): void {
  const { ctx, build } = paint;
  const upper: BoneChain = {
    root: chain.root,
    joint: mixPt(chain.root, chain.joint, 0.5),
    end: chain.joint,
  };
  const shape: LimbShape = {
    ...build.arm,
    belly: build.arm.joint,
    tip: build.arm.joint,
    bellyAt: MIDPOINT,
  };
  if (build.outfit === 'security_suit') {
    drawLimb(paint, upper, shape, { ramp: SUIT, bulk: build.arm.root * 0.18 }, UNSHADED);
    return;
  }
  drawLimb(paint, upper, shape, { ramp: build.palette.scales, bulk: 0 }, UNSHADED);
  const sleeveEnd = mixPt(chain.root, chain.joint, SLEEVE_END);
  const rootWidth = build.arm.root + SLEEVE_BULK;
  const endWidth = lerp(build.arm.root, build.arm.joint, SLEEVE_END) + SLEEVE_BULK;
  outlineCapsule(paint, chain.root, sleeveEnd, rootWidth, endWidth);
  fillCapsule(ctx, chain.root, sleeveEnd, rootWidth, endWidth, TEE.mid);
  if (wearsArmband) {
    const from = mixPt(chain.root, chain.joint, ARMBAND_FROM);
    const to = mixPt(chain.root, chain.joint, ARMBAND_TO);
    const width = lerp(build.arm.root, build.arm.joint, ARMBAND_FROM) + ARMBAND_BULK;
    outlineCapsule(paint, from, to, width, width);
    fillCapsule(ctx, from, to, width, width, ARMBAND);
  }
}

// ── Glow ─────────────────────────────────────────────────────────────────────

const GLOW_RADIUS = 0.11;
const GLOW_CORE_SHARE = 0.25;

/** Triage's green light cupped in a hand. Additive, so it lifts what is under it. */
function drawHandGlow(ctx: Ctx, at: Pt, amount: number, scale: number): void {
  const strength = clamp01(amount);
  if (strength < MIN_VISIBLE_ALPHA) return;
  const radius = GLOW_RADIUS * scale * (MIDPOINT + strength * MIDPOINT);
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  const gradient = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius);
  gradient.addColorStop(0, rgba(GLOW_CORE, strength));
  gradient.addColorStop(GLOW_CORE_SHARE, rgba(GLOW_MID, strength * 0.85));
  gradient.addColorStop(1, rgba(GLOW_EDGE, 0));
  ctx.fillStyle = gradient;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

// ── Tail ─────────────────────────────────────────────────────────────────────

const TAIL_SEGMENTS = 12;
const TAIL_BANDS = 4;
const TAIL_BAND_ALPHA = 0.55;
const TAIL_SCUTE_EVERY = 2;

/**
 * How the tail is carried in one view.
 *
 * Edge-on it is the longest line in the silhouette, leaving the rump level and
 * drooping to drag its back half along the floor. Head-on it sweeps out from
 * behind one hip, and from behind it sweeps out the other way, in front of the
 * legs: hung down the middle it crosses both legs and stops reading as a tail.
 */
interface TailCarriage {
  /** Root, relative to the hip, as shares of the torso's trailing hip span and the hip height. */
  readonly rootBack: number;
  readonly rootDrop: number;
  readonly base: number;
  /** Total bend root to tip. */
  readonly curl: number;
  readonly lengthScale: number;
  readonly girth: number;
}

const TAIL_CARRIAGE: Record<CrocView, TailCarriage> = {
  side: {
    rootBack: -0.8,
    rootDrop: 0.3,
    base: deg(118),
    curl: deg(52),
    lengthScale: 1,
    girth: 1,
  },
  front: {
    rootBack: -0.4,
    rootDrop: 0.2,
    base: deg(112),
    curl: deg(55),
    lengthScale: 0.8,
    girth: 1.1,
  },
  away: {
    rootBack: -0.15,
    rootDrop: 0.8,
    base: deg(122),
    curl: deg(50),
    lengthScale: 0.85,
    girth: 1.15,
  },
};

function tailSpine(root: Pt, base: number, curl: number, length: number, floorY: number): Pt[] {
  const step = length / TAIL_SEGMENTS;
  const points: Pt[] = [root];
  let here = root;
  let angle = base;
  for (let i = 0; i < TAIL_SEGMENTS; i++) {
    const t = (i + MIDPOINT) / TAIL_SEGMENTS;
    // Most of the bend is toward the tip: a tail leaves the rump nearly straight.
    angle += (curl / TAIL_SEGMENTS) * (MIDPOINT + t);
    let next = along(here, angle, step);
    if (next.y > floorY) {
      // The floor takes the weight: the tail flattens along it rather than
      // sinking through, which is what makes it read as heavy.
      next = pt(here.x + Math.sign(Math.cos(angle)) * step, floorY);
      angle = Math.cos(angle) >= 0 ? 0 : Math.PI;
    }
    points.push(next);
    here = next;
  }
  return points;
}

/**
 * The topple's transform, body frame to floor frame and back: the tail is laid
 * along the floor in the floor's own frame, then drawn in the body's.
 */
function toppleToWorld(pose: CrocPose, p: Pt): Pt {
  const r = rotate(pt(p.x - pose.toppleAt.x, p.y - pose.toppleAt.y), pose.topple);
  return pt(r.x + pose.toppleAt.x, r.y + pose.toppleAt.y - pose.toppleLift);
}

function toppleToBody(pose: CrocPose, p: Pt): Pt {
  const r = rotate(
    pt(p.x - pose.toppleAt.x, p.y - pose.toppleAt.y + pose.toppleLift),
    -pose.topple,
  );
  return pt(r.x + pose.toppleAt.x, r.y + pose.toppleAt.y);
}

/** The tail's centreline rests this share of its root width above the floor, so it lies on it rather than half in it. */
const TAIL_FLOOR_CLEARANCE = 0.5;

function drawTail(paint: Paint, skeleton: Skeleton, pose: CrocPose): void {
  const { ctx, build, view } = paint;
  const carriage = TAIL_CARRIAGE[view.name];
  const span = view.profile ? build.profileTorso : build.facingTorso;
  const root = offset(
    skeleton.hip,
    span.hipTrail * carriage.rootBack,
    (build.waistY - build.hipY) * -carriage.rootDrop,
  );
  // Laid out in the floor's frame, so a toppling body's tail still drags on
  // the floor instead of swinging down through it.
  const worldSpine = tailSpine(
    toppleToWorld(pose, root),
    carriage.base + pose.tailSwing + pose.topple,
    carriage.curl + pose.tailCurl,
    build.tailLength * carriage.lengthScale,
    -build.tailRootWidth * TAIL_FLOOR_CLEARANCE,
  );
  const spine = worldSpine.map((p) => toppleToBody(pose, p));
  const last = spine.length - 1;
  const widthAt = (i: number): number =>
    lerp(build.tailRootWidth, build.tailTipWidth, i / last) * carriage.girth;
  const palette = build.palette;

  for (let i = 0; i < last; i++)
    outlineCapsule(paint, spine[i], spine[i + 1], widthAt(i), widthAt(i + 1));
  for (let i = 0; i < last; i++) {
    fillCapsule(ctx, spine[i], spine[i + 1], widthAt(i), widthAt(i + 1), palette.scales.mid);
  }
  // The pale underside, edge-on only: the lower edge of the tail is belly.
  if (view.profile) {
    for (let i = 0; i < last; i++) {
      const normal = angleBetween(spine[i], spine[i + 1]) + HALF_PI;
      const down = Math.sin(normal) >= 0 ? 1 : -1;
      const shift = (i: number, sign: number): Pt =>
        offset(
          spine[i],
          Math.cos(normal) * widthAt(i) * 0.55 * sign,
          Math.sin(normal) * widthAt(i) * 0.55 * sign,
        );
      fillCapsule(
        ctx,
        shift(i, down),
        shift(i + 1, down),
        widthAt(i) * 0.4,
        widthAt(i + 1) * 0.4,
        palette.belly.mid,
      );
    }
  }
  sheenSegment(paint, spine[0], spine[Math.floor(last / 2)], widthAt(0), palette.scales.light);

  // Crossbands: a crocodile's tail is ringed dark, and at tile size the rings
  // are what separate it from a limb.
  ctx.save();
  ctx.globalAlpha *= TAIL_BAND_ALPHA;
  for (let b = 0; b < TAIL_BANDS; b++) {
    const t = (b + 1) / (TAIL_BANDS + 1);
    const i = Math.min(last - 1, Math.floor(t * last));
    const a = spine[i];
    const c = spine[i + 1];
    fillCapsule(
      ctx,
      mixPt(a, c, 0.2),
      mixPt(a, c, 0.75),
      widthAt(i) * 0.95,
      widthAt(i + 1) * 0.95,
      palette.band,
    );
  }
  ctx.restore();

  // A ridge of scutes along the top, edge-on and from behind.
  if (view.profile || view.showsBack) {
    for (let i = 1; i < last - 1; i += TAIL_SCUTE_EVERY) {
      const a = spine[i];
      const c = spine[i + 1];
      const normal = angleBetween(a, c) - HALF_PI;
      const up = Math.sin(normal) <= 0 ? 1 : -1;
      const w = widthAt(i);
      const baseMid = offset(
        mixPt(a, c, MIDPOINT),
        Math.cos(normal) * w * 0.8 * up,
        Math.sin(normal) * w * 0.8 * up,
      );
      const peak = offset(
        baseMid,
        Math.cos(normal) * w * 0.55 * up,
        Math.sin(normal) * w * 0.55 * up,
      );
      ctx.beginPath();
      ctx.moveTo(a.x + Math.cos(normal) * w * 0.8 * up, a.y + Math.sin(normal) * w * 0.8 * up);
      ctx.lineTo(peak.x, peak.y);
      ctx.lineTo(c.x + Math.cos(normal) * w * 0.8 * up, c.y + Math.sin(normal) * w * 0.8 * up);
      ctx.closePath();
      ctx.fillStyle = palette.band;
      ctx.fill();
    }
  }
}

// ── Torso ────────────────────────────────────────────────────────────────────

const CHEST_SWELL = 0.05;

function breathed(span: TorsoSpan, breath: number): TorsoSpan {
  if (breath === 0) return span;
  const swell = 1 + breath * CHEST_SWELL;
  return { ...span, chestLead: span.chestLead * swell, chestTrail: span.chestTrail * swell };
}

/** A point `lead` along the across-spine direction from a spine point. */
function side(p: Pt, skeleton: Skeleton, amount: number): Pt {
  return offset(p, skeleton.across.x * amount, skeleton.across.y * amount);
}

interface TorsoOutline {
  readonly collarLead: Pt;
  readonly collarTrail: Pt;
  readonly chestLead: Pt;
  readonly chestTrail: Pt;
  readonly waistLead: Pt;
  readonly waistTrail: Pt;
  readonly hemLead: Pt;
  readonly hemTrail: Pt;
  readonly hemMid: Pt;
}

/**
 * The torso's outline at a given looseness and hem drop. Built square to the
 * spine, so a stooped trunk tapers along its own axis rather than shearing.
 */
function torsoOutline(
  skeleton: Skeleton,
  span: TorsoSpan,
  loose: number,
  hemDrop: number,
  hemFlare: number,
): TorsoOutline {
  const { hip, waist, chest, shoulder, up } = skeleton;
  const hem = offset(hip, -up.x * hemDrop, -up.y * hemDrop);
  return {
    collarLead: side(shoulder, skeleton, span.shoulderLead * loose),
    collarTrail: side(shoulder, skeleton, -span.shoulderTrail * loose),
    chestLead: side(chest, skeleton, span.chestLead * loose),
    chestTrail: side(chest, skeleton, -span.chestTrail * loose),
    waistLead: side(waist, skeleton, span.waistLead * loose),
    waistTrail: side(waist, skeleton, -span.waistTrail * loose),
    hemLead: side(hem, skeleton, span.hipLead * loose * hemFlare),
    hemTrail: side(hem, skeleton, -span.hipTrail * loose * hemFlare),
    hemMid: hem,
  };
}

function traceTorso(ctx: Ctx, o: TorsoOutline, sag: number): void {
  ctx.beginPath();
  ctx.moveTo(o.collarLead.x, o.collarLead.y);
  ctx.quadraticCurveTo(o.chestLead.x, o.chestLead.y, o.waistLead.x, o.waistLead.y);
  ctx.lineTo(o.hemLead.x, o.hemLead.y);
  ctx.quadraticCurveTo(o.hemMid.x, o.hemMid.y + sag, o.hemTrail.x, o.hemTrail.y);
  ctx.lineTo(o.waistTrail.x, o.waistTrail.y);
  ctx.quadraticCurveTo(o.chestTrail.x, o.chestTrail.y, o.collarTrail.x, o.collarTrail.y);
  ctx.closePath();
}

/** The shade down the far side of a garment, so it wraps a body instead of facing one. */
function shadeTrailingEdge(paint: Paint, o: TorsoOutline, colour: string, width: number): void {
  const { ctx } = paint;
  // Head-on the shaded side is the one away from the light.
  const trailing = paint.lightX < 0;
  const edge = trailing
    ? [o.collarLead, o.chestLead, o.waistLead, o.hemLead]
    : [o.collarTrail, o.chestTrail, o.waistTrail, o.hemTrail];
  const inward = trailing ? -width : width;
  ctx.save();
  ctx.globalAlpha *= 0.5;
  ctx.beginPath();
  ctx.moveTo(edge[0].x, edge[0].y);
  ctx.quadraticCurveTo(edge[1].x, edge[1].y, edge[2].x, edge[2].y);
  ctx.lineTo(edge[3].x, edge[3].y);
  ctx.lineTo(edge[3].x + inward, edge[3].y);
  ctx.lineTo(edge[2].x + inward, edge[2].y);
  ctx.quadraticCurveTo(edge[1].x + inward, edge[1].y, edge[0].x + inward, edge[0].y);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  ctx.restore();
}

// The band tee and shorts ─────────────────────────────────────────────────────

const TEE_LOOSE = 1.14;
const TEE_HEM_DROP = 0.05;
const TEE_HEM_FLARE = 1.08;
const TEE_HEM_SAG = 0.012;
const SHORTS_WAIST_RISE = 0.035;
/** How far down each thigh the shorts' cuff reaches. */
const SHORTS_CUFF_AT = 0.5;
const SHORTS_BULK = 0.012;

/**
 * Each leg of the shorts is a cuff wrapped round its own thigh, so a raised leg
 * stays covered at any angle; the seat is a band across the pelvis joining them.
 */
function drawShorts(
  paint: Paint,
  skeleton: Skeleton,
  shade: number,
  which: 'near' | 'far' | 'seat',
): void {
  const { ctx, build, view } = paint;
  const span = view.profile ? build.profileTorso : build.facingTorso;
  if (which === 'seat') {
    const top = offset(
      skeleton.hip,
      -skeleton.up.x * -SHORTS_WAIST_RISE * 2,
      -skeleton.up.y * -SHORTS_WAIST_RISE * 2,
    );
    const lead = side(top, skeleton, span.hipLead * 1.1);
    const trail = side(top, skeleton, -span.hipTrail * 1.1);
    const crotch = offset(skeleton.hip, 0, build.leg.root * 1.3);
    const nearCuff = mixPt(skeleton.nearLeg.root, skeleton.nearLeg.joint, SHORTS_CUFF_AT * 0.7);
    const farCuff = mixPt(skeleton.farLeg.root, skeleton.farLeg.joint, SHORTS_CUFF_AT * 0.7);
    fillOutlined(
      paint,
      () => {
        ctx.beginPath();
        ctx.moveTo(trail.x, trail.y);
        ctx.lineTo(lead.x, lead.y);
        ctx.lineTo(
          view.profile ? nearCuff.x + build.leg.root : nearCuff.x + build.leg.root,
          nearCuff.y,
        );
        ctx.lineTo(crotch.x, crotch.y);
        ctx.lineTo(farCuff.x - build.leg.root, farCuff.y);
        ctx.closePath();
      },
      mix(SHORTS.mid, OUTLINE, shade),
    );
    return;
  }
  const chain = which === 'near' ? skeleton.nearLeg : skeleton.farLeg;
  const legShade = which === 'far' && view.profile ? FAR_LIMB_SHADE : shade;
  const cuff = mixPt(chain.root, chain.joint, SHORTS_CUFF_AT);
  const root = build.leg.root + SHORTS_BULK;
  const end = lerp(build.leg.root, build.leg.joint, SHORTS_CUFF_AT) + SHORTS_BULK * 1.4;
  outlineCapsule(paint, chain.root, cuff, root, end);
  fillCapsule(ctx, chain.root, cuff, root, end, mix(SHORTS.mid, OUTLINE, legShade));
  sheenSegment(paint, chain.root, cuff, root, mix(SHORTS.light, OUTLINE, legShade));
  // A frayed hem: a pale broken line square to the thigh.
  const normal = angleBetween(chain.root, chain.joint) + HALF_PI;
  ctx.save();
  ctx.strokeStyle = SHORTS_FRAY;
  ctx.lineWidth = DETAIL_OUTLINE;
  ctx.globalAlpha *= 0.7;
  ctx.setLineDash([end * 0.35, end * 0.25]);
  ctx.beginPath();
  ctx.moveTo(cuff.x + Math.cos(normal) * end * 0.9, cuff.y + Math.sin(normal) * end * 0.9);
  ctx.lineTo(cuff.x - Math.cos(normal) * end * 0.9, cuff.y - Math.sin(normal) * end * 0.9);
  ctx.stroke();
  ctx.restore();
}

const LOGO_RADIUS = 0.052;
const LOGO_DROP = 0.35;
const LOGO_BAR_HEIGHT = 0.2;
const LOGO_STAR_POINTS = 5;
const LOGO_STAR_INNER = 0.45;

function traceStar(ctx: Ctx, centre: Pt, radius: number, inner: number): void {
  ctx.beginPath();
  for (let i = 0; i < LOGO_STAR_POINTS * 2; i++) {
    const r = i % 2 === 0 ? radius : radius * inner;
    const a = -HALF_PI + (i / (LOGO_STAR_POINTS * 2)) * TWO_PI;
    const p = along(centre, a, r);
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
}

/**
 * The venue logo: a pale badge with a starburst and a dark bar where the name
 * would be. No lettering — at tile size lettering is noise, and a badge on a
 * loud tee is already what a band shirt looks like.
 */
function drawLogo(paint: Paint, centre: Pt, squash: number, onBack: boolean): void {
  const { ctx } = paint;
  const r = LOGO_RADIUS * (onBack ? 0.8 : 1);
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.scale(squash, 1);
  fillOutlined(
    paint,
    () => {
      ctx.beginPath();
      ctx.ellipse(0, 0, r, r * 0.92, 0, 0, TWO_PI);
    },
    TEE_LOGO,
    DETAIL_OUTLINE,
  );
  if (!onBack) {
    traceStar(ctx, pt(0, -r * 0.2), r * 0.62, LOGO_STAR_INNER);
    ctx.fillStyle = TEE_LOGO_STAR;
    ctx.fill();
  }
  ctx.fillStyle = TEE_LOGO_BAR;
  ctx.fillRect(-r * 0.85, r * 0.18, r * 1.7, r * LOGO_BAR_HEIGHT * 2);
  ctx.restore();
}

function drawBandTee(paint: Paint, skeleton: Skeleton, pose: CrocPose): void {
  const { ctx, build, view } = paint;
  const span = breathed(view.profile ? build.profileTorso : build.facingTorso, pose.breath);
  const o = torsoOutline(skeleton, span, TEE_LOOSE, TEE_HEM_DROP, TEE_HEM_FLARE);
  fillOutlined(paint, () => traceTorso(ctx, o, TEE_HEM_SAG), TEE.mid);
  shadeTrailingEdge(paint, o, TEE.dark, span.chestLead * 0.35);

  // Round neckline, darker ribbing.
  const neckR = build.neckWidth * 1.15;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(skeleton.neck.x, skeleton.neck.y + neckR * 0.2, neckR, neckR * 0.55, 0, 0, TWO_PI);
  ctx.fillStyle = TEE.dark;
  ctx.fill();
  ctx.restore();

  if (view.profile) {
    // Edge-on the badge wraps round the chest: a sliver at the front.
    const at = mixPt(skeleton.chest, o.chestLead, 0.62);
    drawLogo(paint, offset(at, 0, (skeleton.waist.y - skeleton.chest.y) * LOGO_DROP), 0.45, false);
  } else {
    // The print is on the front only: a badge on his back beside the tail
    // makes the back view read as a front.
    if (view.showsFace) drawLogo(paint, mixPt(skeleton.chest, skeleton.waist, LOGO_DROP), 1, false);
  }
}

const SKIRT_HEM_ABOVE_KNEE = 0.02;
const SKIRT_HEM_MARGIN = 2.3;
const SKIRT_HEM_LIGHT = 0.4;
const SKIRT_HIP_EASE = 1.06;

/**
 * A pencil skirt, from the waist to just above the knee. It follows both knees,
 * so a stride stretches it rather than a leg stepping out through it.
 */
function drawSkirt(paint: Paint, skeleton: Skeleton): void {
  const { ctx, build, view } = paint;
  const span = view.profile ? build.profileTorso : build.facingTorso;
  const knees = [skeleton.nearLeg.joint, skeleton.farLeg.joint];
  const margin = build.leg.joint * SKIRT_HEM_MARGIN;
  const hemY = Math.min(...knees.map((k) => k.y)) - SKIRT_HEM_ABOVE_KNEE;
  const hemLead = Math.max(...knees.map((k) => k.x)) + margin;
  const hemTrail = Math.min(...knees.map((k) => k.x)) - margin;
  const lead = side(skeleton.waist, skeleton, span.waistLead * SKIRT_HIP_EASE);
  const trail = side(skeleton.waist, skeleton, -span.waistTrail * SKIRT_HIP_EASE);
  const hipLead = side(skeleton.hip, skeleton, span.hipLead * SKIRT_HIP_EASE);
  const hipTrail = side(skeleton.hip, skeleton, -span.hipTrail * SKIRT_HIP_EASE);
  fillOutlined(
    paint,
    () => {
      ctx.beginPath();
      ctx.moveTo(trail.x, trail.y);
      ctx.lineTo(lead.x, lead.y);
      ctx.quadraticCurveTo(hipLead.x, hipLead.y, hemLead, hemY);
      ctx.lineTo(hemTrail, hemY);
      ctx.quadraticCurveTo(hipTrail.x, hipTrail.y, trail.x, trail.y);
      ctx.closePath();
    },
    SKIRT,
  );
  // A lit edge along the hem: without it the skirt reads as the bottom of the jacket.
  ctx.save();
  ctx.globalAlpha *= SKIRT_HEM_LIGHT;
  ctx.strokeStyle = SUIT.light;
  ctx.lineWidth = DETAIL_OUTLINE * build.strokeScale;
  ctx.beginPath();
  ctx.moveTo(hemTrail, hemY - DETAIL_OUTLINE);
  ctx.lineTo(hemLead, hemY - DETAIL_OUTLINE);
  ctx.stroke();
  ctx.restore();
}

// The security suit ───────────────────────────────────────────────────────────

const SUIT_LOOSE = 1.08;
/** The jacket runs well past the hip, which is what makes it a suit jacket and not a shirt. */
const SUIT_HEM_DROP = 0.13;
const SUIT_HEM_FLARE = 1.02;
const LAPEL_DEPTH = 0.62;
const LAPEL_WIDTH = 0.42;
const TIE_WIDTH = 0.045;
const BADGE_RADIUS = 0.028;

function drawSuit(paint: Paint, skeleton: Skeleton, pose: CrocPose): void {
  const { ctx, build, view } = paint;
  const span = breathed(view.profile ? build.profileTorso : build.facingTorso, pose.breath);
  const o = torsoOutline(skeleton, span, SUIT_LOOSE, SUIT_HEM_DROP, SUIT_HEM_FLARE);
  fillOutlined(paint, () => traceTorso(ctx, o, 0), SUIT.mid);
  shadeTrailingEdge(paint, o, SUIT.dark, span.chestLead * 0.3);

  const collarY = skeleton.shoulder;
  const vBottom = mixPt(skeleton.shoulder, skeleton.waist, LAPEL_DEPTH);
  if (view.showsBack) {
    // From behind: a centre vent and a collar band.
    ctx.save();
    ctx.strokeStyle = SUIT.dark;
    ctx.lineWidth = DETAIL_OUTLINE * build.strokeScale;
    ctx.beginPath();
    ctx.moveTo(o.hemMid.x, o.hemMid.y);
    ctx.lineTo(
      o.hemMid.x + (skeleton.waist.x - o.hemMid.x) * 0.4,
      o.hemMid.y + (skeleton.waist.y - o.hemMid.y) * 0.4,
    );
    ctx.stroke();
    ctx.restore();
    fillCapsule(
      ctx,
      side(collarY, skeleton, -build.neckWidth),
      side(collarY, skeleton, build.neckWidth),
      build.neckWidth * 0.5,
      build.neckWidth * 0.5,
      SUIT.dark,
    );
    return;
  }

  if (view.profile) {
    // Edge-on: the shirt front shows as a wedge at the lapel's leading edge.
    const lapelTop = side(collarY, skeleton, span.shoulderLead * 0.9);
    const lapelLow = side(vBottom, skeleton, span.chestLead * 0.95);
    fillOutlined(
      paint,
      () => {
        ctx.beginPath();
        ctx.moveTo(lapelTop.x, lapelTop.y);
        ctx.lineTo(side(collarY, skeleton, span.shoulderLead * 0.45).x, lapelTop.y);
        ctx.lineTo(lapelLow.x, lapelLow.y);
        ctx.closePath();
      },
      SHIRT,
      DETAIL_OUTLINE * build.strokeScale,
    );
    fillCapsule(
      ctx,
      side(collarY, skeleton, span.shoulderLead * 0.8),
      side(vBottom, skeleton, span.chestLead * 0.88),
      TIE_WIDTH * 0.35,
      TIE_WIDTH * 0.45,
      TIE,
    );
    // The lapel's fold line.
    ctx.save();
    ctx.strokeStyle = SUIT.dark;
    ctx.lineWidth = DETAIL_OUTLINE * build.strokeScale;
    ctx.beginPath();
    ctx.moveTo(side(collarY, skeleton, span.shoulderLead * 0.3).x, collarY.y);
    ctx.lineTo(lapelLow.x, lapelLow.y);
    ctx.stroke();
    ctx.restore();
    return;
  }

  // Head-on: the white shirt V between the lapels, and the tie down its middle.
  const vHalf = span.shoulderLead * LAPEL_WIDTH;
  const vLeft = side(collarY, skeleton, -vHalf);
  const vRight = side(collarY, skeleton, vHalf);
  fillOutlined(
    paint,
    () => {
      ctx.beginPath();
      ctx.moveTo(vLeft.x, vLeft.y);
      ctx.lineTo(vRight.x, vRight.y);
      ctx.lineTo(vBottom.x, vBottom.y);
      ctx.closePath();
    },
    SHIRT,
    DETAIL_OUTLINE * build.strokeScale,
  );
  const knot = offset(collarY, skeleton.up.x * -TIE_WIDTH * 0.8, skeleton.up.y * -TIE_WIDTH * 0.8);
  fillCapsule(ctx, knot, mixPt(knot, vBottom, 0.92), TIE_WIDTH * 0.55, TIE_WIDTH * 0.75, TIE);
  // Lapels: darker wedges either side of the V.
  for (const s of [-1, 1]) {
    const top = side(collarY, skeleton, s * vHalf);
    const outer = side(mixPt(collarY, vBottom, 0.35), skeleton, s * vHalf * 1.9);
    ctx.beginPath();
    ctx.moveTo(top.x, top.y);
    ctx.lineTo(outer.x, outer.y);
    ctx.lineTo(vBottom.x, vBottom.y);
    ctx.closePath();
    ctx.fillStyle = SUIT.dark;
    ctx.fill();
  }
  // Two buttons and the gold security badge on the chest.
  for (const t of [0.2, 0.55]) {
    const b = mixPt(vBottom, o.hemMid, t);
    ctx.beginPath();
    ctx.arc(b.x, b.y, BADGE_RADIUS * 0.35, 0, TWO_PI);
    ctx.fillStyle = SUIT.dark;
    ctx.fill();
  }
  const badge = side(
    mixPt(skeleton.shoulder, skeleton.chest, 0.7),
    skeleton,
    -span.chestLead * 0.55,
  );
  fillOutlined(
    paint,
    () => {
      traceStar(ctx, badge, BADGE_RADIUS, 0.55);
    },
    BADGE,
    DETAIL_OUTLINE * build.strokeScale,
  );
}

// ── Head ─────────────────────────────────────────────────────────────────────

/*
 * The head is drawn in its own units: one unit is the build's head height,
 * the origin is the skull's centre, and +X is forward along the snout. The
 * profile is authored once; head-on views squash its X by the sine of the yaw.
 */

const CRANIUM_BACK = -0.42;
const CRANIUM_TOP = -0.38;
/** The eye rides in a raised orbit on top of the skull — the most crocodilian thing about the head. */
const EYE_X = 0.1;
const EYE_Y = -0.27;
const ORBIT_RISE = 0.1;
const ORBIT_HALF = 0.19;
/** Snout depth at its root and tip, above the lipline. */
const SNOUT_ROOT_TOP = -0.3;
const SNOUT_TIP_TOP = -0.13;
const NOSTRIL_RISE = 0.07;
const NOSTRIL_BACK = 0.1;
const LIPLINE_Y = 0.02;
/** The croc smile: the mouth line rises toward the back of the jaw, under the eye. */
const LIP_CORNER_X = -0.2;
const LIP_CORNER_Y = -0.08;
const JAW_HINGE_X = -0.24;
const JAW_HINGE_Y = -0.04;
const THROAT_BACK_X = -0.38;
const JAW_OPEN_ANGLE = deg(30);
const TOOTH_EVERY = 0.13;
const TOOTH_HEIGHT = 0.17;
const TOOTH_HALF_WIDTH = 0.052;
/** The ivory band's depth between two teeth, and how far it tucks up under the lip. */
const TOOTH_GUM_DEPTH = 0.045;
const TOOTH_ROOT_TUCK = 0.02;
/** The big fourth tooth near the front of the lower jaw that shows over the upper lip. */
const FANG_AT = 0.86;
const FANG_HEIGHT = 0.17;
const TYMPANUM_X = -0.28;
const TYMPANUM_Y = -0.2;
const TYMPANUM_R = 0.05;
const NAPE_SCUTES = 3;
const BACK_LIPLINE_ALPHA = 0.35;
/** Head-on the braincase is a disc about as wide as the head is tall. */
const BRAINCASE_RX = 0.36;
const BRAINCASE_RY = 0.4;
/** How far apart the two eyes sit across the top of the skull. */
const EYE_SEPARATION = 0.3;
/** The far eye is smaller: it is further away and turned from the camera. */
const FAR_EYE_SIZE = 0.8;
/**
 * How far round the head must be turned before its far side shows. A true
 * profile's cosine is a rounding error above zero, and drawing the far orbit
 * there perches a knob on top of the skull that reads as a cap.
 */
const FAR_SIDE_VISIBLE = 0.05;
const EYE_SHUT = 0.35;

/** The upper jaw and skull, as one silhouette, with the lipline as its lower edge. */
function traceUpperHead(ctx: Ctx, snout: number): void {
  const tip = snout;
  ctx.beginPath();
  ctx.moveTo(THROAT_BACK_X, JAW_HINGE_Y);
  ctx.quadraticCurveTo(CRANIUM_BACK - 0.04, CRANIUM_TOP * 0.3, CRANIUM_BACK + 0.06, CRANIUM_TOP);
  ctx.lineTo(EYE_X - ORBIT_HALF, CRANIUM_TOP);
  // The orbit bump.
  ctx.quadraticCurveTo(
    EYE_X,
    CRANIUM_TOP - ORBIT_RISE * 1.6,
    EYE_X + ORBIT_HALF,
    SNOUT_ROOT_TOP - 0.02,
  );
  // Down the snout to the nostril bump.
  ctx.quadraticCurveTo(tip * 0.55, SNOUT_ROOT_TOP + 0.04, tip - NOSTRIL_BACK * 1.6, SNOUT_TIP_TOP);
  ctx.quadraticCurveTo(
    tip - NOSTRIL_BACK * 0.7,
    SNOUT_TIP_TOP - NOSTRIL_RISE * 1.6,
    tip - 0.01,
    SNOUT_TIP_TOP + 0.01,
  );
  // The blunt, rounded tip.
  ctx.quadraticCurveTo(
    tip + 0.05,
    (SNOUT_TIP_TOP + LIPLINE_Y) * MIDPOINT,
    tip - 0.02,
    LIPLINE_Y + 0.02,
  );
  // Back along the lipline, with a scallop behind the tip where the big tooth sits.
  ctx.quadraticCurveTo(tip * FANG_AT, LIPLINE_Y - 0.05, tip * 0.7, LIPLINE_Y + 0.01);
  ctx.quadraticCurveTo(tip * 0.3, LIPLINE_Y + 0.03, 0, LIPLINE_Y);
  ctx.quadraticCurveTo(LIP_CORNER_X * 0.6, LIPLINE_Y - 0.01, LIP_CORNER_X, LIP_CORNER_Y);
  ctx.lineTo(JAW_HINGE_X, JAW_HINGE_Y);
  ctx.closePath();
}

/** The lower jaw, closed, hinged at the back of the mouth. */
function traceLowerJaw(ctx: Ctx, snout: number, depth: number): void {
  const tip = snout - 0.05;
  ctx.beginPath();
  ctx.moveTo(JAW_HINGE_X, JAW_HINGE_Y);
  ctx.lineTo(LIP_CORNER_X, LIP_CORNER_Y + 0.02);
  ctx.quadraticCurveTo(LIP_CORNER_X * 0.6, LIPLINE_Y + 0.01, 0, LIPLINE_Y + 0.01);
  ctx.quadraticCurveTo(tip * 0.5, LIPLINE_Y + 0.03, tip, LIPLINE_Y + 0.03);
  ctx.quadraticCurveTo(tip + 0.03, LIPLINE_Y + depth * 0.35, tip - 0.06, LIPLINE_Y + depth * 0.55);
  ctx.quadraticCurveTo(tip * 0.45, LIPLINE_Y + depth * 0.75, 0, LIPLINE_Y + depth);
  ctx.quadraticCurveTo(
    THROAT_BACK_X * 0.6,
    LIPLINE_Y + depth * 1.05,
    THROAT_BACK_X,
    JAW_HINGE_Y + depth * 0.6,
  );
  ctx.quadraticCurveTo(THROAT_BACK_X - 0.03, JAW_HINGE_Y + depth * 0.2, JAW_HINGE_X, JAW_HINGE_Y);
  ctx.closePath();
}

/** Points along the lipline from just behind the tip back to the mouth corner. */
function liplineAt(snout: number, t: number): Pt {
  // Matches the lipline curve closely enough for teeth to sit on it.
  const x = lerp(snout * 0.93, LIP_CORNER_X * 0.4, t);
  const y =
    LIPLINE_Y +
    0.01 -
    (x > snout * 0.75 ? 0.02 : 0) +
    (x < 0 ? (x / LIP_CORNER_X) * (LIP_CORNER_Y - LIPLINE_Y) * 0.4 : 0);
  return pt(x, y);
}

function drawTooth(
  ctx: Ctx,
  base: Pt,
  height: number,
  halfWidth: number,
  pointsDown: boolean,
): void {
  const dir = pointsDown ? 1 : -1;
  ctx.beginPath();
  ctx.moveTo(base.x - halfWidth, base.y);
  ctx.lineTo(base.x, base.y + height * dir);
  ctx.lineTo(base.x + halfWidth, base.y);
  ctx.closePath();
  ctx.fill();
}

interface HeadLook {
  /** Sine of the yaw: 1 is the true profile. */
  readonly turn: number;
  /** Cosine of the yaw, signed: how far the far side of the head shows. */
  readonly depth: number;
}

/**
 * The croc head, edge-on or turned. The caller has translated to the skull's
 * centre and scaled so one unit is one head height.
 */
function drawHead(paint: Paint, pose: CrocPose, look: HeadLook, unit: number): void {
  const { ctx, build, view } = paint;
  const palette = build.palette;
  const snout = build.snoutLength;
  const jawAngle = clamp01(pose.jaw) * JAW_OPEN_ANGLE;
  const stroke = (BODY_OUTLINE * build.strokeScale) / unit;
  const detail = (DETAIL_OUTLINE * build.strokeScale) / unit;
  const headPaint: Paint = { ...paint, build: { ...build, strokeScale: build.strokeScale / unit } };

  // The braincase behind the turned skull, head-on from the front only: a skull
  // keeps its width when it turns. From behind the turned skull alone is right.
  if (!view.profile && view.showsFace) {
    fillOutlined(
      headPaint,
      () => {
        ctx.beginPath();
        ctx.ellipse(-look.depth * 0.05, -0.08, BRAINCASE_RX, BRAINCASE_RY, 0, 0, TWO_PI);
      },
      palette.scales.mid,
      stroke,
    );
  }

  ctx.save();
  ctx.scale(look.turn, 1);

  // The far eye's orbit, poking above the skull's top line beside the near one.
  if (look.depth > FAR_SIDE_VISIBLE) {
    const farX = EYE_X + (EYE_SEPARATION * look.depth) / Math.max(look.turn, MIDPOINT);
    fillOutlined(
      headPaint,
      () => {
        ctx.beginPath();
        ctx.ellipse(farX, EYE_Y - 0.02, ORBIT_HALF * 0.8, ORBIT_RISE * 1.1, 0, 0, TWO_PI);
      },
      mix(palette.scales.mid, OUTLINE, 0.18),
      stroke,
    );
  }

  if (jawAngle > deg(2)) {
    // The open mouth: the upper jaw's palate over the dark throat.
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(JAW_HINGE_X, JAW_HINGE_Y);
    ctx.lineTo(snout * 0.95, LIPLINE_Y);
    const lowerTip = rotate(
      pt(snout * 0.95 - JAW_HINGE_X, LIPLINE_Y + 0.03 - JAW_HINGE_Y),
      jawAngle,
    );
    ctx.lineTo(JAW_HINGE_X + lowerTip.x, JAW_HINGE_Y + lowerTip.y);
    ctx.closePath();
    ctx.fillStyle = MOUTH;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(JAW_HINGE_X, JAW_HINGE_Y);
    ctx.lineTo(snout * 0.35, LIPLINE_Y + 0.01);
    ctx.lineTo(JAW_HINGE_X + lowerTip.x * 0.4, JAW_HINGE_Y + lowerTip.y * 0.4);
    ctx.closePath();
    ctx.fillStyle = MOUTH_DEEP;
    ctx.fill();
    ctx.restore();
  }

  // The lower jaw, swung open about its hinge.
  ctx.save();
  ctx.translate(JAW_HINGE_X, JAW_HINGE_Y);
  ctx.rotate(jawAngle);
  ctx.translate(-JAW_HINGE_X, -JAW_HINGE_Y);
  fillOutlined(
    headPaint,
    () => traceLowerJaw(ctx, snout, build.jawDepth),
    // From behind the pale throat is on the far side; a cream band there reads
    // as a face looking down.
    view.showsBack ? palette.scales.mid : palette.belly.mid,
    stroke,
  );
  // The jaw's flank is scaled like the rest of him; only the underside is pale.
  ctx.save();
  traceLowerJaw(ctx, snout, build.jawDepth);
  ctx.clip();
  ctx.beginPath();
  ctx.rect(JAW_HINGE_X - 0.2, LIPLINE_Y - 0.1, snout + 0.4, build.jawDepth * 0.55 + 0.1);
  ctx.fillStyle = palette.scales.mid;
  ctx.fill();
  ctx.restore();
  // From behind, the tooth rows are on the far side of the jaw.
  if (!view.showsBack) {
    // Lower teeth, pointing up; seen over the upper lip when the mouth is shut.
    ctx.fillStyle = TOOTH;
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = detail * 0.4;
    ctx.lineJoin = 'round';
    const toothCount = Math.max(3, Math.round((snout - LIP_CORNER_X * 0.4) / TOOTH_EVERY));
    for (let i = 0; i < toothCount; i++) {
      const t = (i + 0.75) / toothCount;
      const base = liplineAt(snout, t);
      const fang = i === 0;
      drawTooth(
        ctx,
        offset(base, 0, 0.02),
        fang ? FANG_HEIGHT : TOOTH_HEIGHT * 0.85,
        TOOTH_HALF_WIDTH,
        false,
      );
    }
  }
  ctx.restore();

  fillOutlined(headPaint, () => traceUpperHead(ctx, snout), palette.scales.mid, stroke);

  // Value: a lighter flank below the orbit, darker along the top of the snout.
  ctx.save();
  traceUpperHead(ctx, snout);
  ctx.clip();
  ctx.fillStyle = palette.scales.dark;
  ctx.globalAlpha *= 0.55;
  ctx.beginPath();
  ctx.moveTo(CRANIUM_BACK, CRANIUM_TOP - 0.2);
  ctx.lineTo(snout + 0.1, SNOUT_TIP_TOP - 0.2);
  ctx.lineTo(snout + 0.1, SNOUT_TIP_TOP + 0.035);
  ctx.quadraticCurveTo(snout * 0.5, SNOUT_ROOT_TOP + 0.1, CRANIUM_BACK, CRANIUM_TOP + 0.1);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  if (!view.showsBack) {
    // Upper teeth, pointing down over the lower jaw: one ivory band with a
    // sawtooth lower edge rather than separate triangles. Separate triangles
    // a pixel or two across blend into the scales on the bake and vanish; the
    // band keeps a solid run of ivory under the lip at any size.
    const upperCount = Math.max(3, Math.round((snout - LIP_CORNER_X * 0.4) / TOOTH_EVERY));
    ctx.beginPath();
    const first = liplineAt(snout, 0);
    ctx.moveTo(first.x, first.y - TOOTH_ROOT_TUCK);
    for (let i = 0; i <= upperCount * 2; i++) {
      const at = liplineAt(snout, i / (upperCount * 2));
      const drop = i % 2 === 1 ? TOOTH_HEIGHT : TOOTH_GUM_DEPTH;
      ctx.lineTo(at.x, at.y + drop);
    }
    for (let i = upperCount * 2; i >= 0; i--) {
      const at = liplineAt(snout, i / (upperCount * 2));
      ctx.lineTo(at.x, at.y - TOOTH_ROOT_TUCK);
    }
    ctx.closePath();
    ctx.fillStyle = TOOTH;
    ctx.fill();
  }

  // The lipline itself, dark, down the full length of the jaw — on the side
  // facing the camera only.
  ctx.save();
  if (view.showsBack) ctx.globalAlpha *= BACK_LIPLINE_ALPHA;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = detail;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(snout - 0.02, LIPLINE_Y + 0.02);
  ctx.quadraticCurveTo(snout * FANG_AT, LIPLINE_Y - 0.05, snout * 0.7, LIPLINE_Y + 0.01);
  ctx.quadraticCurveTo(snout * 0.3, LIPLINE_Y + 0.03, 0, LIPLINE_Y);
  ctx.quadraticCurveTo(LIP_CORNER_X * 0.6, LIPLINE_Y - 0.01, LIP_CORNER_X, LIP_CORNER_Y);
  ctx.stroke();
  ctx.restore();

  if (build.feminine && view.showsFace) drawLipstick(ctx, snout, detail);

  // Nostril at the tip of the snout.
  ctx.beginPath();
  ctx.ellipse(
    snout - NOSTRIL_BACK * 0.75,
    SNOUT_TIP_TOP - NOSTRIL_RISE * 0.3,
    0.03,
    0.02,
    0,
    0,
    TWO_PI,
  );
  ctx.fillStyle = OUTLINE;
  ctx.fill();

  // Nape scutes: a short row of bumps behind the skull, edge-on and from behind.
  if (view.profile || view.showsBack) {
    ctx.fillStyle = palette.band;
    for (let i = 0; i < NAPE_SCUTES; i++) {
      const x = CRANIUM_BACK + 0.04 - i * 0.07;
      const y = CRANIUM_TOP + 0.06 + i * 0.1;
      ctx.beginPath();
      ctx.moveTo(x + 0.05, y);
      ctx.lineTo(x - 0.01, y - 0.07);
      ctx.lineTo(x - 0.05, y + 0.03);
      ctx.closePath();
      ctx.fill();
    }
  }

  // The tympanum: a small dark slit behind the eye.
  ctx.beginPath();
  ctx.ellipse(TYMPANUM_X, TYMPANUM_Y, TYMPANUM_R * 1.3, TYMPANUM_R * 0.55, deg(-20), 0, TWO_PI);
  ctx.fillStyle = mix(palette.scales.dark, OUTLINE, 0.4);
  ctx.fill();

  // Edge-on only: head-on the cord runs down the cheek and reads as a tear.
  if (build.outfit === 'security_suit' && view.profile) drawEarpiece(ctx, build.jawDepth, detail);
  if (build.feminine && view.showsFace) drawPearl(ctx);

  drawEye(paint, pose, detail, view.showsFace);
  // Turned toward the camera, the far eye shows too, further along the snout:
  // two eyes are what stop the orbit reading as a lamp on a helmet.
  if (!view.profile && view.showsFace && look.depth > FAR_SIDE_VISIBLE) {
    const farX = EYE_X + (EYE_SEPARATION * look.depth) / Math.max(look.turn, MIDPOINT);
    drawEye(paint, pose, detail, true, farX, FAR_EYE_SIZE);
  }
  ctx.restore();
}

const LIPSTICK = '#b8405e';
/** How far back from the tip the colour runs along the lip. */
const LIPSTICK_REACH = 0.55;

/** A berry line along the front of the lip: a jaw cannot pout, but it can wear colour. */
function drawLipstick(ctx: Ctx, snout: number, detail: number): void {
  ctx.save();
  ctx.strokeStyle = LIPSTICK;
  ctx.lineWidth = detail * 1.6;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(snout - 0.03, LIPLINE_Y + 0.02);
  ctx.quadraticCurveTo(
    snout * FANG_AT,
    LIPLINE_Y - 0.04,
    snout * (1 - LIPSTICK_REACH),
    LIPLINE_Y + 0.02,
  );
  ctx.stroke();
  ctx.restore();
}

const PEARL_X = -0.3;
const PEARL_Y = 0.12;
const PEARL_R = 0.07;

/** A pearl earring hanging below the jaw hinge. */
function drawPearl(ctx: Ctx): void {
  ctx.beginPath();
  ctx.arc(PEARL_X, PEARL_Y, PEARL_R, 0, TWO_PI);
  ctx.fillStyle = PEARL;
  ctx.fill();
}

const EARPIECE_BUD = 0.045;
const EARPIECE_DROP = 0.55;

/** The security earpiece: a bud in the ear slit and its coiled lead down into the collar. */
function drawEarpiece(ctx: Ctx, jawDepth: number, detail: number): void {
  ctx.save();
  ctx.strokeStyle = EARPIECE;
  ctx.lineWidth = detail * 0.8;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(TYMPANUM_X, TYMPANUM_Y);
  ctx.quadraticCurveTo(
    TYMPANUM_X - 0.12,
    TYMPANUM_Y + EARPIECE_DROP * 0.5,
    TYMPANUM_X - 0.04,
    jawDepth + EARPIECE_DROP,
  );
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(TYMPANUM_X, TYMPANUM_Y, EARPIECE_BUD, 0, TWO_PI);
  ctx.fillStyle = EARPIECE;
  ctx.fill();
  ctx.restore();
}

const LASH_COUNT = 3;
const LASH_LENGTH = 0.9;

/** Three dark lashes flicked up and back off the top of the eye. */
function drawLashes(ctx: Ctx, eyeX: number, r: number, detail: number): void {
  ctx.save();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = detail;
  ctx.lineCap = 'round';
  for (let i = 0; i < LASH_COUNT; i++) {
    const a = -HALF_PI - deg(20) - i * deg(28);
    const from = pt(eyeX + Math.cos(a) * r * 0.9, EYE_Y + Math.sin(a) * r * 0.9);
    ctx.beginPath();
    ctx.moveTo(from.x, from.y);
    ctx.lineTo(from.x + Math.cos(a) * r * LASH_LENGTH, from.y + Math.sin(a) * r * LASH_LENGTH);
    ctx.stroke();
  }
  ctx.restore();
}

function drawEye(
  paint: Paint,
  pose: CrocPose,
  detail: number,
  showsIris: boolean,
  eyeX = EYE_X,
  size = 1,
): void {
  const { ctx, build } = paint;
  const r = build.eyeRadius * size;
  const open = 1 - clamp01(pose.blink);
  // Heavy brow: a dark ridge over the eye, which is what makes it read as a lid
  // on a raised orbit rather than a dot painted on the head.
  ctx.save();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = detail * 1.2;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(eyeX - r * 1.35, EYE_Y - r * 0.55);
  ctx.quadraticCurveTo(eyeX, EYE_Y - r * 1.45, eyeX + r * 1.45, EYE_Y - r * 0.45);
  ctx.stroke();
  ctx.restore();
  if (!showsIris) return;
  if (open <= EYE_SHUT) {
    ctx.save();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = detail * 1.2;
    ctx.beginPath();
    ctx.moveTo(eyeX - r, EYE_Y);
    ctx.quadraticCurveTo(eyeX, EYE_Y + r * 0.4, eyeX + r, EYE_Y);
    ctx.stroke();
    ctx.restore();
    return;
  }
  ctx.beginPath();
  ctx.ellipse(eyeX, EYE_Y, r, r * open, 0, 0, TWO_PI);
  ctx.fillStyle = EYE_IRIS;
  ctx.fill();
  ctx.lineWidth = detail;
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  ctx.beginPath();
  ctx.ellipse(eyeX + r * 0.1, EYE_Y, r * 0.24, r * 0.85 * open, 0, 0, TWO_PI);
  ctx.fillStyle = EYE_SLIT;
  ctx.fill();
  ctx.beginPath();
  ctx.arc(eyeX - r * 0.35, EYE_Y - r * 0.35 * open, r * 0.22, 0, TWO_PI);
  ctx.fillStyle = EYE_GLINT;
  ctx.fill();
  if (build.feminine) drawLashes(ctx, eyeX, r, detail);
  // The upper lid comes down over the top of the eye, a scaled hood. Clipped
  // to the skull: past its outline the hood is a knob that reads as a cap.
  ctx.save();
  traceUpperHead(ctx, build.snoutLength);
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(eyeX, EYE_Y - r * (1.35 - 0.6 * (1 - open)), r * 1.15, r * 0.7, 0, 0, TWO_PI);
  ctx.fillStyle = build.palette.scales.mid;
  ctx.fill();
  ctx.restore();
}

// ── Bucket ───────────────────────────────────────────────────────────────────

const BUCKET_HEIGHT = 0.15;
const BUCKET_TOP_R = 0.072;
const BUCKET_BOTTOM_R = 0.056;
const BUCKET_RIM_FLATTEN = 0.32;
/** The bail's height over the rim when it is pulled taut by a carrying hand. */
const BAIL_RISE = 0.06;
const BUCKET_RIBS = 2;

/**
 * A tin pail, drawn about its body's centre with its mouth toward −Y. Seen a
 * little from above, so the rim is an ellipse and its inside shows dark.
 */
function drawBucketBody(paint: Paint, inverted: boolean, bailTaut: boolean): void {
  const { ctx } = paint;
  const h = BUCKET_HEIGHT;
  const top = -h / 2;
  const bottom = h / 2;
  const topR = BUCKET_TOP_R;
  const bottomR = BUCKET_BOTTOM_R;
  const rimRy = topR * BUCKET_RIM_FLATTEN;
  const stroke = DETAIL_OUTLINE;

  if (!inverted && bailTaut) {
    // The bail behind the body is drawn first; its front half comes after.
    ctx.save();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = stroke * 1.8;
    ctx.beginPath();
    ctx.moveTo(-topR, top);
    ctx.quadraticCurveTo(0, top - BAIL_RISE * 2, topR, top);
    ctx.stroke();
    ctx.strokeStyle = BAIL;
    ctx.lineWidth = stroke;
    ctx.stroke();
    ctx.restore();
  }

  fillOutlined(
    paint,
    () => {
      ctx.beginPath();
      ctx.moveTo(-topR, top);
      ctx.lineTo(-bottomR, bottom);
      ctx.ellipse(0, bottom, bottomR, bottomR * BUCKET_RIM_FLATTEN, 0, Math.PI, 0, true);
      ctx.lineTo(topR, top);
      ctx.ellipse(0, top, topR, rimRy, 0, 0, Math.PI, true);
      ctx.closePath();
    },
    TIN.mid,
    stroke * 1.4,
  );
  // A vertical highlight on the lit side, a shade on the other: what says metal.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-topR * 0.55, top + rimRy);
  ctx.lineTo(-bottomR * 0.55, bottom);
  ctx.lineTo(-bottomR * 0.2, bottom);
  ctx.lineTo(-topR * 0.2, top + rimRy);
  ctx.closePath();
  ctx.fillStyle = TIN.light;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(topR * 0.55, top + rimRy);
  ctx.lineTo(bottomR * 0.6, bottom);
  ctx.lineTo(bottomR, bottom);
  ctx.lineTo(topR, top);
  ctx.closePath();
  ctx.fillStyle = TIN.dark;
  ctx.fill();
  ctx.restore();
  // Two pressed ribs round the body.
  ctx.save();
  ctx.strokeStyle = TIN.dark;
  ctx.lineWidth = stroke * 0.7;
  for (let i = 1; i <= BUCKET_RIBS; i++) {
    const y = lerp(top, bottom, i / (BUCKET_RIBS + 1));
    const r = lerp(topR, bottomR, i / (BUCKET_RIBS + 1));
    ctx.beginPath();
    ctx.ellipse(0, y, r, r * BUCKET_RIM_FLATTEN, 0, 0, Math.PI);
    ctx.stroke();
  }
  ctx.restore();
  // The rim; inverted, the viewer sees the base instead of the dark inside.
  const mouthY = inverted ? bottom : top;
  const mouthR = inverted ? bottomR : topR;
  ctx.beginPath();
  ctx.ellipse(0, mouthY, mouthR, mouthR * BUCKET_RIM_FLATTEN, 0, 0, TWO_PI);
  ctx.fillStyle = inverted ? TIN.mid : TIN_INSIDE;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = stroke;
  ctx.stroke();

  if (!inverted && bailTaut) {
    ctx.save();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = stroke * 1.8;
    ctx.beginPath();
    ctx.moveTo(-topR, top);
    ctx.quadraticCurveTo(0, top - BAIL_RISE * 2 + rimRy * 2, topR, top);
    ctx.stroke();
    ctx.strokeStyle = BAIL;
    ctx.lineWidth = stroke;
    ctx.stroke();
    ctx.restore();
  }
}

/** The bucket hanging from a hand by its bail, swung `swing` off plumb about the grip. */
function drawHangingBucket(paint: Paint, grip: Pt, swing: number): void {
  const { ctx } = paint;
  ctx.save();
  ctx.translate(grip.x, grip.y);
  ctx.rotate(swing);
  ctx.translate(0, BAIL_RISE + BUCKET_HEIGHT / 2);
  drawBucketBody(paint, false, true);
  ctx.restore();
}

function drawPlacedBucket(paint: Paint, centre: Pt, tilt: number, inverted: boolean): void {
  const { ctx } = paint;
  ctx.save();
  ctx.translate(centre.x, centre.y);
  ctx.rotate(tilt);
  drawBucketBody(paint, inverted, false);
  ctx.restore();
}

/** Where the centre of the bucket sits when it is set upright on the floor. */
export const BUCKET_REST_HEIGHT = BUCKET_HEIGHT / 2 + BUCKET_BOTTOM_R * BUCKET_RIM_FLATTEN;

// ── Figure ───────────────────────────────────────────────────────────────────

/** How much of the trunk's lean the head copies; the rest it holds level to see. */
const HEAD_LEAN_FOLLOW = 0.45;
const NECK_TAPER = 0.85;
const RIM_WIDTH = 0.014;

function drawNeck(paint: Paint, skeleton: Skeleton): void {
  const { build } = paint;
  const top = offset(skeleton.headCentre, 0, build.headHeight * 0.1);
  outlineCapsule(paint, skeleton.neck, top, build.neckWidth, build.neckWidth * NECK_TAPER);
  fillCapsule(
    paint.ctx,
    skeleton.neck,
    top,
    build.neckWidth,
    build.neckWidth * NECK_TAPER,
    build.palette.scales.mid,
  );
  // The pale throat on the facing side.
  if (paint.view.showsFace) {
    const throatShift = paint.view.profile ? build.neckWidth * 0.45 : 0;
    fillCapsule(
      paint.ctx,
      offset(skeleton.neck, throatShift, 0),
      offset(top, throatShift, build.headHeight * 0.1),
      build.neckWidth * 0.55,
      build.neckWidth * 0.45,
      build.palette.belly.mid,
    );
  }
}

function drawHeadAt(paint: Paint, skeleton: Skeleton, pose: CrocPose): void {
  const { ctx, build, view } = paint;
  const unit = build.headHeight;
  const yaw = view.profile ? HALF_PI + pose.headYaw : view.headYaw + pose.headYaw;
  const look: HeadLook = {
    turn: Math.max(Math.abs(Math.sin(yaw)), MIDPOINT),
    depth: Math.cos(yaw),
  };
  ctx.save();
  ctx.translate(skeleton.headCentre.x, skeleton.headCentre.y);
  const pitch = pose.headPitch + (view.profile ? pose.lean * HEAD_LEAN_FOLLOW : 0);
  // Head-on a pitch nods the snout toward the camera, which shows as the head
  // dropping a little, not as a rotation in the picture plane.
  if (view.profile) ctx.rotate(pitch + pose.headRoll);
  else ctx.rotate(pose.roll * MIDPOINT + pitch * 0.35 + pose.headRoll);
  ctx.scale(unit, unit);
  drawHead(paint, pose, look, unit);
  ctx.restore();
}

function drawRim(paint: Paint, skeleton: Skeleton): void {
  const { ctx, build, view } = paint;
  const span = view.profile ? build.profileTorso : build.facingTorso;
  const loose = build.outfit === 'band_tee' ? TEE_LOOSE : SUIT_LOOSE;
  const hemDrop = build.outfit === 'band_tee' ? TEE_HEM_DROP : SUIT_HEM_DROP;
  const o = torsoOutline(skeleton, span, loose, hemDrop, 1);
  const lit = paint.lightX < 0;
  const edge = lit
    ? [o.collarTrail, o.chestTrail, o.waistTrail]
    : [o.collarLead, o.chestLead, o.waistLead];
  ctx.save();
  ctx.globalAlpha *= build.palette.rimAlpha;
  ctx.strokeStyle = build.palette.rim;
  ctx.lineWidth = RIM_WIDTH * build.strokeScale;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(edge[0].x, edge[0].y);
  ctx.quadraticCurveTo(edge[1].x, edge[1].y, edge[2].x, edge[2].y);
  ctx.stroke();
  ctx.restore();
}

function drawTorso(paint: Paint, skeleton: Skeleton, pose: CrocPose): void {
  if (paint.build.outfit === 'band_tee') {
    drawShorts(paint, skeleton, UNSHADED, 'seat');
    drawBandTee(paint, skeleton, pose);
  } else {
    if (paint.build.skirt) drawSkirt(paint, skeleton);
    drawSuit(paint, skeleton, pose);
  }
  drawRim(paint, skeleton);
}

/** Feet turn outward, away from the centreline. */
const NEAR_OUT = 1;
const FAR_OUT = -1;

/** The armband is on the near (left) arm in every view — the bucket hand. */
function drawNearArm(paint: Paint, skeleton: Skeleton, pose: CrocPose): void {
  drawArm(paint, skeleton.nearArm, pose.nearArm, UNSHADED, paint.build.armband);
  if (pose.bucket.kind === 'hang') {
    const grip = skeleton.nearArm.end;
    const angle = pose.nearArm.handAngle ?? wristAngle(skeleton.nearArm);
    drawHangingBucket(paint, along(grip, angle, paint.build.handLength * 0.45), pose.bucket.swing);
    // The fist goes back over the bail, or the bucket hangs from nothing.
    drawHand(paint, grip, angle, 1, UNSHADED);
  }
}

function drawBody(paint: Paint, pose: CrocPose): void {
  const { build, view } = paint;
  const skeleton = buildSkeleton(build, pose, view);

  if (view.profile) {
    // Edge-on the swatting arm is the far one, so its smear is behind the body
    // too; over the head it merges with the open jaw into one pale block.
    drawSmear(paint, skeleton.farArm, pose.smear, pose.smearSweep);
    drawArm(paint, skeleton.farArm, pose.farArm, FAR_LIMB_SHADE, false);
    drawLeg(paint, skeleton.farLeg, pose.far, FAR_OUT, FAR_LIMB_SHADE);
    if (build.outfit === 'band_tee') drawShorts(paint, skeleton, FAR_LIMB_SHADE, 'far');
    drawTail(paint, skeleton, pose);
    drawLeg(paint, skeleton.nearLeg, pose.near, NEAR_OUT, UNSHADED);
    if (build.outfit === 'band_tee') drawShorts(paint, skeleton, UNSHADED, 'near');
    drawTorso(paint, skeleton, pose);
    drawNeck(paint, skeleton);
    drawHeadAt(paint, skeleton, pose);
    drawPlacedFront(paint, pose);
    drawNearArm(paint, skeleton, pose);
    drawGlows(paint, skeleton, pose);
    return;
  }

  const fromBehind = view.showsBack;
  if (!fromBehind) drawTail(paint, skeleton, pose);
  // From behind the arms swing behind the back; head-on they hang in front.
  if (pose.farArm.behind || fromBehind)
    drawArm(paint, skeleton.farArm, pose.farArm, UNSHADED, false);
  if (pose.nearArm.behind || fromBehind) drawNearArm(paint, skeleton, pose);
  // From behind, his hands and their light are on the far side of his body:
  // the glow shows only as a halo round its edges.
  if (fromBehind) drawGlows(paint, skeleton, pose);
  drawLeg(paint, skeleton.farLeg, pose.far, FAR_OUT, UNSHADED);
  drawLeg(paint, skeleton.nearLeg, pose.near, NEAR_OUT, UNSHADED);
  if (build.outfit === 'band_tee') {
    drawShorts(paint, skeleton, UNSHADED, 'far');
    drawShorts(paint, skeleton, UNSHADED, 'near');
  }
  drawTorso(paint, skeleton, pose);
  if (fromBehind) {
    drawUpperArmFromBehind(paint, skeleton.farArm, false);
    drawUpperArmFromBehind(paint, skeleton.nearArm, build.armband);
  }
  drawNeck(paint, skeleton);
  drawHeadAt(paint, skeleton, pose);
  // From behind, the tail is the nearest thing to the camera.
  if (fromBehind) drawTail(paint, skeleton, pose);
  drawPlacedFront(paint, pose);
  if (!(pose.farArm.behind || fromBehind))
    drawArm(paint, skeleton.farArm, pose.farArm, UNSHADED, false);
  if (!(pose.nearArm.behind || fromBehind)) drawNearArm(paint, skeleton, pose);
  if (!fromBehind) drawGlows(paint, skeleton, pose);
}

function drawPlacedFront(paint: Paint, pose: CrocPose): void {
  if (pose.bucket.kind === 'placed' && pose.bucket.front) {
    drawPlacedBucket(paint, pose.bucket.centre, pose.bucket.tilt, pose.bucket.inverted);
  }
}

const SMEAR_ALPHA = 0.55;
const SMEAR_WIDTH = 0.05;
const SMEAR_COLOUR = '#f4f0e0';

/**
 * A pale arc trailing the far hand along the swing that brought it here. One
 * frame of it sells a swat that is otherwise two poses a frame apart.
 */
function drawSmear(paint: Paint, chain: BoneChain, amount: number, sweep: number): void {
  if (amount < MIN_VISIBLE_ALPHA || sweep === 0) return;
  const { ctx, build } = paint;
  const radius = Math.hypot(chain.end.x - chain.root.x, chain.end.y - chain.root.y);
  const at = angleBetween(chain.root, chain.end);
  ctx.save();
  ctx.globalAlpha *= SMEAR_ALPHA * amount;
  ctx.strokeStyle = SMEAR_COLOUR;
  ctx.lineCap = 'round';
  const steps = 4;
  for (let i = 0; i < steps; i++) {
    // Tapering: widest at the hand, thinning back along the arc.
    ctx.lineWidth = SMEAR_WIDTH * build.strokeScale * (1 - i / steps);
    ctx.beginPath();
    ctx.arc(
      chain.root.x,
      chain.root.y,
      radius,
      at + (sweep * i) / steps,
      at + (sweep * (i + 1)) / steps,
      sweep < 0,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function drawGlows(paint: Paint, skeleton: Skeleton, pose: CrocPose): void {
  if (!paint.view.profile) drawSmear(paint, skeleton.farArm, pose.smear, pose.smearSweep);
  if (pose.glow <= 0) return;
  const scale = paint.build.headHeight / BUCKET_BOY_BUILD.headHeight;
  drawHandGlow(paint.ctx, skeleton.nearArm.end, pose.glow, scale);
  drawHandGlow(paint.ctx, skeleton.farArm.end, pose.glow, scale);
}

/**
 * Paints a crocodilian of the given build in one view, in figure units: origin
 * between the feet, one unit per tile, +Y down.
 */
export function drawCrocodilian(
  ctx: Ctx,
  build: CrocBuild,
  viewName: CrocView,
  pose: CrocPose,
): void {
  const view = VIEWS[viewName];
  ctx.save();
  if (view.mirrored) ctx.scale(-1, 1);
  const paint: Paint = { ctx, build, view, lightX: view.mirrored ? -LIGHT_X : LIGHT_X };

  // The floor and anything lying loose on it stay put while the body topples.
  const toppled = Math.abs(Math.sin(pose.topple));
  const stanceCentre = (pose.near.ball.x + pose.far.ball.x) / 2;
  const bodyLength = build.neckBaseY * -1;
  const shadowX = lerp(
    stanceCentre,
    pose.toppleAt.x + Math.sign(pose.topple) * bodyLength * MIDPOINT,
    toppled,
  );
  const shadowRx =
    build.facingTorso.shoulderLead * SHADOW_RX_SHARE + toppled * bodyLength * MIDPOINT;
  drawGroundShadow(ctx, shadowX, shadowRx, CONTACT_SHADOW_ALPHA);
  if (pose.bucket.kind === 'placed' && !pose.bucket.front) {
    drawPlacedBucket(paint, pose.bucket.centre, pose.bucket.tilt, pose.bucket.inverted);
  }

  ctx.save();
  if (pose.topple !== 0 || pose.toppleLift !== 0) {
    ctx.translate(pose.toppleAt.x, pose.toppleAt.y - pose.toppleLift);
    ctx.rotate(pose.topple);
    ctx.translate(-pose.toppleAt.x, -pose.toppleAt.y);
  }
  drawBody(paint, pose);
  ctx.restore();
  ctx.restore();
}
