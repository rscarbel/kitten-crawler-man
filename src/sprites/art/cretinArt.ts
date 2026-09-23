/**
 * Drawing engine for the Cretins — seven-foot sapient rock monsters in
 * tuxedos, the club's bodyguards and two of Meat Shields' hires.
 *
 * A Cretin has to read as two things at once at a 32 px tile: **rock**, and
 * **dressed**. The tux does the second job by itself — a black jacket, a white
 * shirt V and a bow tie are unmistakable at any size. Rock is the hard half,
 * because the tux covers most of the body. It is carried by the parts the tux
 * leaves bare and by the silhouette: a blocky faceted head sunk between the
 * shoulders, fists and feet that are chiselled stones rather than hands and
 * shoes, and boulders pushing up through the jacket's shoulder seams. Every
 * stone is a jittered polygon with a hard lit facet and a hard shadow facet;
 * nothing stone is a smooth curve or a gradient, because the moment a head
 * becomes an oval the figure is a grey man in a costume.
 *
 * Size is read by head count, not by drawn height: a big figure drawn at a
 * game character's five heads reads as a doll. A Cretin is seven heads tall on
 * a very broad frame, so its head is about the size of a person's while the
 * shoulders are twice as wide, and its fists and feet are held to a giant's
 * proportion rather than a toddler's.
 *
 * Poses are authored in **body space** — lateral (the figure's own right is
 * positive), vertical (+Y down, heights above the ground negative) and fore
 * (the direction it faces) — and each view projects them. The body above the
 * hips leans and twists as a rigid 3D frame, so a punch thrown from a twisting
 * torso reads in all three views from one pose.
 *
 * Handedness: every pose is authored from behind. Facing the camera the
 * figure's right is on the viewer's left, which the front view's projection
 * does by itself; nothing is mirrored after the fact.
 *
 * The outline is the silhouette only. Parts are collected into a list and
 * drawn in two passes — every outline first, then every fill over it — so the
 * line survives only where it lies outside every part. Drawn per part, every
 * arm over the chest would get an ink ring and the figure would read as a paper
 * doll.
 *
 * Coordinates are tile units with the origin on the ground between the feet;
 * the caller translates there and scales by one tile before calling
 * {@link drawCretin}. Light comes from the upper left, like every other figure.
 */

import { type Pt, clamp01, deg, easeInOut, hump, lerp, mix, rgba } from './carlArt';
import { fillSoftEllipse } from './softShade';

type Ctx = CanvasRenderingContext2D;

export const TWO_PI = Math.PI * 2;

// ── Variants and palette ─────────────────────────────────────────────────────

/** The four Cretins who appear in the club. */
export type CretinVariant = 'sledge' | 'bomo' | 'clayton' | 'very_sullen';

export const CRETIN_VARIANTS: readonly CretinVariant[] = [
  'sledge',
  'bomo',
  'clayton',
  'very_sullen',
];

/** Which views a figure is painted from. */
export type CretinView = 'front' | 'side' | 'away';

interface StoneRamp {
  readonly deep: string;
  readonly shadow: string;
  readonly base: string;
  readonly light: string;
  readonly hilite: string;
}

/** Head silhouettes: the cheapest way to tell four grey bodies apart. */
type HeadShape = 'block' | 'round' | 'narrow';

type StoneGrain = 'none' | 'strata' | 'cleave';

/** How a Cretin's eyes are painted. */
type EyeStyle = 'socket' | 'dot';

interface VariantSpec {
  readonly stone: StoneRamp;
  /** Mineral flecks painted over every bare stone, or none. */
  readonly speckle: readonly string[];
  /**
   * The rock's grain: sandstone's level strata, slate's diagonal cleavage, or
   * none. Texture is what separates stone from grey skin at a glance; a smooth
   * tone, however faceted, reads as flesh.
   */
  readonly grain: StoneGrain;
  readonly head: HeadShape;
  readonly eyes: EyeStyle;
  /** The Meat Shields armband: only the two Cretins the desk rents out wear it. */
  readonly armband: boolean;
  readonly hat: boolean;
  readonly boa: boolean;
  readonly button: boolean;
}

const COOL_GREY: StoneRamp = {
  deep: '#2c2e35',
  shadow: '#4a4d56',
  base: '#6f737c',
  light: '#969ba4',
  hilite: '#c2c6cc',
};

/** Ochre sandstone: yellowed away from any skin tone, and banded. */
const OCHRE_SANDSTONE: StoneRamp = {
  deep: '#3a2e17',
  shadow: '#654f2a',
  base: '#8f7640',
  light: '#b09a5c',
  hilite: '#d3c088',
};

const PINK_GRANITE: StoneRamp = {
  deep: '#4a3f42',
  shadow: '#7f6e71',
  base: '#b3a09e',
  light: '#cfbfba',
  hilite: '#ece0da',
};

const DARK_SLATE: StoneRamp = {
  deep: '#1f2530',
  shadow: '#434e5d',
  base: '#687687',
  light: '#8c9aab',
  hilite: '#b6c2cf',
};

/** Clay-ton's granite: the black mica and the white and rose feldspar. */
const GRANITE_FLECKS: readonly string[] = ['#1c1618', '#fbf6f2', '#a8584e', '#1c1618'];

const VARIANTS: Record<CretinVariant, VariantSpec> = {
  sledge: {
    stone: COOL_GREY,
    speckle: [],
    grain: 'none',
    head: 'block',
    eyes: 'socket',
    armband: true,
    hat: true,
    boa: true,
    button: true,
  },
  bomo: {
    stone: OCHRE_SANDSTONE,
    speckle: [],
    grain: 'strata',
    head: 'round',
    eyes: 'socket',
    armband: true,
    hat: false,
    boa: false,
    button: false,
  },
  clayton: {
    stone: PINK_GRANITE,
    speckle: GRANITE_FLECKS,
    grain: 'none',
    head: 'block',
    eyes: 'socket',
    armband: false,
    hat: false,
    boa: false,
    button: false,
  },
  very_sullen: {
    stone: DARK_SLATE,
    speckle: [],
    grain: 'cleave',
    head: 'narrow',
    eyes: 'dot',
    armband: false,
    hat: false,
    boa: false,
    button: false,
  },
};

/** Whether a variant wears the Meat Shields armband, for the gates. */
export function cretinWearsArmband(variant: CretinVariant): boolean {
  return VARIANTS[variant].armband;
}

interface ClothRamp {
  readonly deep: string;
  readonly shadow: string;
  readonly base: string;
  readonly light: string;
  readonly rim: string;
}

/**
 * The tux is charcoal rather than true black, with a cool rim on its lit edges:
 * a black jacket is darker than every floor it stands on, and without the rim
 * the body dissolves into the ground leaving a floating head and fists.
 */
const JACKET: ClothRamp = {
  deep: '#101016',
  shadow: '#1b1b25',
  base: '#2b2b39',
  light: '#44445a',
  rim: '#7a7a98',
};

const TROUSERS: ClothRamp = {
  deep: '#0e0e14',
  shadow: '#181822',
  base: '#262634',
  light: '#3c3c50',
  rim: '#6a6a86',
};

const SATIN = '#1d1d28';
const SATIN_SHEEN = '#8a8aac';

const SHIRT: ClothRamp = {
  deep: '#9d978c',
  shadow: '#c3bdb1',
  base: '#ebe6da',
  light: '#faf7ef',
  rim: '#ffffff',
};

const BOW_TIE = '#15151c';
const BOW_TIE_SHEEN = '#5c5c78';

/** The Meat Shields colour: the club's zone tint for the mercenary desk. */
export const MEAT_SHIELDS_ORANGE = '#e06040';
const ARMBAND_LIGHT = '#f39070';
const ARMBAND_SHADOW = '#a8432a';

const HAT: ClothRamp = {
  deep: '#4a2f18',
  shadow: '#7a5230',
  base: '#b1814c',
  light: '#d2a66c',
  rim: '#ecc991',
};
const HAT_BAND = '#3d2414';

const BOA_DEEP = '#a42a6e';
const BOA_SHADOW = '#d8429a';
const BOA_BASE = '#ff6fbf';
const BOA_LIGHT = '#ffb3de';

const BUTTON_FACE = '#f4efe2';
const BUTTON_RING = '#d23a3a';
const BUTTON_STAR = '#ffc933';

const EYE_DARK = '#110f12';
const EYE_GLINT = '#f4eedc';

const OUTLINE = '#140e14';
const OUTLINE_ALPHA = 0.92;
/** Half the silhouette line's width, in tiles: about one screen pixel at 32 px. */
const OUTLINE_HALF_WIDTH = 0.022;

const SHADOW_COLOR = '#000000';
const CONTACT_SHADOW_ALPHA = 0.32;

/**
 * The Shield's honey: a muted, darker amber with a pale cream highlight and a
 * brown depth. Carl's Protective Shell is blue, or at full power a saturated
 * orange-to-gold (#fd7c0a, #ff8c00, #fbbf24) that sits across the same hues
 * any amber does, so hue alone cannot tell the two apart. The honey keeps its
 * distance in saturation and value instead — at least 25 ΔE from every Shell
 * colour, where a bright amber sits under 10 from the Shell's gold — and the
 * gates hold it there.
 */
export const SHIELD_AMBER = '#d4a04a';
export const SHIELD_AMBER_HOT = '#fff1c9';
export const SHIELD_AMBER_DEEP = '#8f5518';

const LIGHT: Pt = { x: -0.66, y: -0.75 };

// ── Proportions ──────────────────────────────────────────────────────────────

/**
 * Crown of the head to the sole, in tiles. Carl stands about 1.46 tiles on
 * screen, so this is a head and a half taller than him — the seven feet of the
 * books, pushed a little further so it reads as towering at 32 px.
 */
export const FIGURE_HEIGHT = 2;
/**
 * Seven heads tall: fewer, bigger heads would make a giant read as a toddler,
 * and the brain sizes a humanoid by counting heads into it.
 */
const HEADS_TALL = 7;
const HEAD_HEIGHT = FIGURE_HEIGHT / HEADS_TALL;

export const ANKLE_Y = -0.075;
/**
 * Legs about a third of the height, not two fifths: a heavy brute stands low,
 * wide and short in the leg, and long legs under a tux read as a tall man.
 */
export const HIP_Y = -0.7;
/** The jacket's hem, just below the hip joints so it covers the seat. */
const JACKET_HEM_Y = HIP_Y + 0.06;
const WAIST_Y = -1.02;
export const SHOULDER_Y = -1.5;
/** The head is sunk between the shoulders: its chin sits below the shoulder tops. */
const CHIN_Y = -1.7;
export const HEAD_CENTRE_Y = CHIN_Y - HEAD_HEIGHT / 2;
/** The head juts forward of the shoulders: a hunched, heavy-necked carriage. */
const HEAD_FORE = 0.15;
const HEAD_RY = HEAD_HEIGHT / 2;

/**
 * The bones are two percent longer than the standing hip-to-ankle span, so a
 * standing leg carries a slight bend and has somewhere to put a stride. Any more
 * and the IK throws the surplus sideways into the knee as a square root.
 */
const LEG_SLACK = 1.02;
const STANDING_LEG_SPAN = Math.abs(HIP_Y - ANKLE_Y);
export const THIGH_LENGTH = (STANDING_LEG_SPAN * LEG_SLACK) / 2;
export const SHIN_LENGTH = (STANDING_LEG_SPAN * LEG_SLACK) / 2;
export const LEG_REACH = THIGH_LENGTH + SHIN_LENGTH;

/** Long arms: a brute's knuckles hang at the top of its thighs. */
export const UPPER_ARM_LENGTH = 0.4;
export const FOREARM_LENGTH = 0.36;

/** Shoulders nearly half the figure's height across, with barely any waist. */
const SHOULDER_JOINT_HALF = 0.4;
const LEG_ROOT_HALF = 0.2;

const UPPER_SLEEVE_HALF = 0.1;
const FORE_SLEEVE_HALF = 0.088;
const DELTOID_RADIUS = 0.13;
const CUFF_WIDTH = 0.035;
/**
 * A fist about eight percent of the figure's height: a giant's fist, big enough
 * to read as a weapon, well short of the oversized toddler hands a scaled-up
 * game figure gets.
 */
export const FIST_RADIUS = 0.1;
const THIGH_HALF = 0.158;
const SHIN_HALF = 0.142;
const HEM_HALF = 0.15;
const FOOT_LENGTH = 0.27;
const FOOT_HALF_WIDTH = 0.15;
const FOOT_HEIGHT = 0.1;
/** How far each foot's outer edge is turned out: a heavy thing stands splay-footed. */
const FOOT_TOE_OUT = 0.03;

/** How far a raised hand or foot's forward depth changes its drawn size head-on. */
const DEPTH_SIZE_SHARE = 0.35;
/**
 * The share of a foot's forward depth drawn as screen height head-on. The floor
 * is seen from above while the figure stands as if seen level, so depth is a
 * little height on the floor and nothing at the hip.
 */
const FLOOR_DEPTH_SHARE = 0.3;
const HAND_DEPTH_SIZE_SHARE = 0.6;

// ── Views ────────────────────────────────────────────────────────────────────

interface ViewSpec {
  readonly id: CretinView;
  /** Screen x per unit of body lateral. */
  readonly latToX: number;
  /** Screen x per unit of body fore. */
  readonly foreToX: number;
  /** Screen y per unit of foot depth (feet only). */
  readonly footDepthToY: number;
  /** Drawn size per unit of fore, for feet driven at the camera. */
  readonly depthSize: number;
  /**
   * The same for hands. Larger than for feet: a fist thrown at the camera is
   * the whole read of a head-on punch, and it has only its size to show it.
   */
  readonly handDepthSize: number;
  readonly profile: boolean;
}

/**
 * Residual lateral spread kept edge-on. At zero the two legs share one screen
 * column and a standing profile reads one-legged.
 */
const PROFILE_LATERAL = 0.2;

const VIEWS: Record<CretinView, ViewSpec> = {
  front: {
    id: 'front',
    latToX: -1,
    foreToX: 0,
    footDepthToY: FLOOR_DEPTH_SHARE,
    depthSize: DEPTH_SIZE_SHARE,
    handDepthSize: HAND_DEPTH_SIZE_SHARE,
    profile: false,
  },
  away: {
    id: 'away',
    latToX: 1,
    foreToX: 0,
    footDepthToY: -FLOOR_DEPTH_SHARE,
    depthSize: -DEPTH_SIZE_SHARE,
    handDepthSize: -DEPTH_SIZE_SHARE,
    profile: false,
  },
  side: {
    id: 'side',
    latToX: PROFILE_LATERAL,
    foreToX: 1,
    footDepthToY: 0,
    depthSize: 0,
    handDepthSize: 0,
    profile: true,
  },
};

// ── Pose ─────────────────────────────────────────────────────────────────────

export interface CretinArmPose {
  /** Fore/aft rotation from straight down, radians; positive drives the fist forward. */
  readonly swing: number;
  /** Abduction away from the ribs, radians; 90° holds the upper arm out level. */
  readonly flare: number;
  /** Elbow fold, radians; 0 is a straight arm. */
  readonly bend: number;
  /**
   * Which way the forearm folds about the upper arm, radians. 0 folds it
   * forward; a quarter turn folds it upward from an arm held out level.
   */
  readonly roll: number;
  /** 0 an open slab hand, 1 a clenched fist. */
  readonly clench: number;
}

export interface CretinLegPose {
  /** Fore/aft travel of the ankle from its hip root, tiles. */
  readonly fore: number;
  /** Height of the sole above the ground, tiles. */
  readonly lift: number;
  /** Lateral travel of the ankle away from its hip root, tiles. */
  readonly splay: number;
}

export interface CretinPose {
  /** Hip drop, tiles; positive moves the whole body down with the feet planted. */
  readonly drop: number;
  /** Lateral offset of everything above the hips, tiles. */
  readonly sway: number;
  /** Fore/aft lean above the hips, radians; positive tips forward. */
  readonly lean: number;
  /** Side-to-side tilt above the hips, radians; positive tips toward the figure's right. */
  readonly tilt: number;
  /** Shoulder rotation about the vertical, radians; positive brings the right shoulder forward. */
  readonly twist: number;
  /** Chest swell, 0..1. */
  readonly breathe: number;
  /**
   * The chest and shoulders lifting off the hips, tiles, with the feet and hips
   * where they are: a standing figure's only way to rise.
   */
  readonly rise: number;
  /** Chips of stone flying off the chest and a flash there: a blow taken, 0..1. */
  readonly chips: number;
  /** Head yaw, -1..1; positive looks toward the figure's right. */
  readonly headTurn: number;
  /** Head roll in the picture plane, radians. */
  readonly headRoll: number;
  /** Head nod, radians; positive pitches the face down. */
  readonly headPitch: number;
  readonly armL: CretinArmPose;
  readonly armR: CretinArmPose;
  readonly legL: CretinLegPose;
  readonly legR: CretinLegPose;
  /** The cast glyph's strength, 0..1. */
  readonly glyph: number;
  /** Dust at the feet, 0..1. */
  readonly dust: number;
  /** The burst at the right fist as a punch lands, 0..1. */
  readonly impact: number;
  /** Fissures opening across the stone, 0..1 (the death). */
  readonly cracks: number;
  /** How far the hat has jumped off the head, tiles (the flinch). */
  readonly hatHop: number;
  /** Lag of the boa's free ends behind the body, tiles; positive trails backward. */
  readonly boaLag: number;
  /** Eyes shut, 0..1. */
  readonly blink: number;
  /** Cycle or row progress; drives anything that must not key off the frame index. */
  readonly time: number;
}

/** At rest the arms hang out clear of the barrel of the body, elbows a little soft. */
const REST_ARM_FLARE = deg(15);
const REST_ARM_BEND = deg(14);
/** A loose fist: closed, but not clenched for a blow. */
const REST_FIST_CLENCH = 0.85;
/**
 * The hang both idle and walk share. A different rest for each makes the figure
 * visibly tuck its arms the moment it starts walking.
 */
export const REST_ARM: CretinArmPose = {
  swing: 0,
  flare: REST_ARM_FLARE,
  bend: REST_ARM_BEND,
  roll: 0,
  clench: REST_FIST_CLENCH,
};
export const REST_LEG: CretinLegPose = { fore: 0, lift: 0, splay: 0 };

export function restPose(): CretinPose {
  return {
    drop: 0,
    sway: 0,
    lean: 0,
    tilt: 0,
    twist: 0,
    breathe: 0,
    rise: 0,
    chips: 0,
    headTurn: 0,
    headRoll: 0,
    headPitch: 0,
    armL: REST_ARM,
    armR: REST_ARM,
    legL: REST_LEG,
    legR: REST_LEG,
    glyph: 0,
    dust: 0,
    impact: 0,
    cracks: 0,
    hatHop: 0,
    boaLag: 0,
    blink: 0,
    time: 0,
  };
}

// ── Body space ───────────────────────────────────────────────────────────────

/** A point in body space: across, down the screen, and forward. */
export interface V3 {
  readonly lat: number;
  readonly y: number;
  readonly fore: number;
}

function v3(lat: number, y: number, fore: number): V3 {
  return { lat, y, fore };
}

function hipHeight(pose: CretinPose): number {
  return HIP_Y + pose.drop;
}

/**
 * Carries a point authored on the upright body into the posed body: twisted
 * about the spine (in proportion to its height above the hips, so the pelvis
 * stays square while the shoulders turn), tilted and leant about the hips, then
 * dropped with them.
 */
function posed(pose: CretinPose, p: V3): V3 {
  const above = HIP_Y - p.y;
  const twistShare = clamp01(above / (HIP_Y - SHOULDER_Y));
  const twist = pose.twist * twistShare;
  const lat1 = p.lat * Math.cos(twist) + p.fore * Math.sin(twist);
  const fore1 = p.fore * Math.cos(twist) - p.lat * Math.sin(twist);
  const heightAbove = Math.max(0, above);
  const lat2 = lat1 * Math.cos(pose.tilt) + heightAbove * Math.sin(pose.tilt);
  const up2 = heightAbove * Math.cos(pose.tilt) - lat1 * Math.sin(pose.tilt);
  const fore3 = fore1 * Math.cos(pose.lean) + up2 * Math.sin(pose.lean);
  const up3 = up2 * Math.cos(pose.lean) - fore1 * Math.sin(pose.lean);
  const below = Math.min(0, above);
  return {
    lat: lat2 + pose.sway * twistShare,
    y: hipHeight(pose) - up3 - below - pose.rise * twistShare,
    fore: fore3,
  };
}

function project(view: ViewSpec, p: V3): Pt {
  return { x: p.lat * view.latToX + p.fore * view.foreToX, y: p.y };
}

// ── Kinematics ───────────────────────────────────────────────────────────────

function normalise(x: number, y: number, z: number): [number, number, number] {
  const length = Math.hypot(x, y, z);
  if (length < 1e-9) return [0, 1, 0];
  return [x / length, y / length, z / length];
}

/** Unit direction of the upper arm, as (lat, down, fore). */
function upperArmDirection(arm: CretinArmPose, side: number): [number, number, number] {
  return [
    Math.sin(arm.flare) * side,
    Math.cos(arm.flare) * Math.cos(arm.swing),
    Math.cos(arm.flare) * Math.sin(arm.swing),
  ];
}

/** Forward and a little up: the direction an elbow folds a forearm by default. */
const FOLD_HINT: readonly [number, number, number] = [0, -0.35, 1];

/**
 * Unit direction of the forearm: the upper arm rotated by the elbow's bend
 * toward a fold direction perpendicular to it.
 *
 * The fold is the forward hint made perpendicular to the upper arm, then
 * rolled about it. Folding in the swing plane instead (adding the bend to the
 * swing) cannot raise a forearm from an arm held out level, which is the robot
 * dance's whole vocabulary.
 */
function forearmDirection(arm: CretinArmPose, side: number): [number, number, number] {
  const [ux, uy, uz] = upperArmDirection(arm, side);
  const along = FOLD_HINT[0] * ux + FOLD_HINT[1] * uy + FOLD_HINT[2] * uz;
  const [wx, wy, wz] = normalise(
    FOLD_HINT[0] - along * ux,
    FOLD_HINT[1] - along * uy,
    FOLD_HINT[2] - along * uz,
  );
  const cx = uy * wz - uz * wy;
  const cy = uz * wx - ux * wz;
  const cz = ux * wy - uy * wx;
  const roll = arm.roll * side;
  const fx = wx * Math.cos(roll) + cx * Math.sin(roll);
  const fy = wy * Math.cos(roll) + cy * Math.sin(roll);
  const fz = wz * Math.cos(roll) + cz * Math.sin(roll);
  return normalise(
    ux * Math.cos(arm.bend) + fx * Math.sin(arm.bend),
    uy * Math.cos(arm.bend) + fy * Math.sin(arm.bend),
    uz * Math.cos(arm.bend) + fz * Math.sin(arm.bend),
  );
}

/** A solved arm in body space. */
export interface ArmChain3 {
  readonly shoulder: V3;
  readonly elbow: V3;
  readonly fist: V3;
}

export function cretinArmChain(pose: CretinPose, side: number): ArmChain3 {
  const arm = side < 0 ? pose.armL : pose.armR;
  const shoulder = posed(pose, v3(SHOULDER_JOINT_HALF * side, SHOULDER_Y, 0));
  const [ux, uy, uz] = upperArmDirection(arm, side);
  const elbow = v3(
    shoulder.lat + ux * UPPER_ARM_LENGTH,
    shoulder.y + uy * UPPER_ARM_LENGTH,
    shoulder.fore + uz * UPPER_ARM_LENGTH,
  );
  const [fx, fy, fz] = forearmDirection(arm, side);
  const fist = v3(
    elbow.lat + fx * FOREARM_LENGTH,
    elbow.y + fy * FOREARM_LENGTH,
    elbow.fore + fz * FOREARM_LENGTH,
  );
  return { shoulder, elbow, fist };
}

/** A solved leg in body space. */
export interface LegChain3 {
  readonly hip: V3;
  readonly knee: V3;
  readonly ankle: V3;
  /** Hip-to-ankle distance over the two bones; 1 is a leg locked straight. */
  readonly reachShare: number;
}

/** Across the body the knee sits midway between hip and ankle; its bend is all fore and aft. */
const KNEE_LATERAL_SHARE = 0.5;

export function cretinLegChain(pose: CretinPose, side: number): LegChain3 {
  const leg = side < 0 ? pose.legL : pose.legR;
  const hip = v3(LEG_ROOT_HALF * side, hipHeight(pose), 0);
  const ankle = v3(LEG_ROOT_HALF * side + leg.splay * side, ANKLE_Y - leg.lift, leg.fore);
  const dx = ankle.fore - hip.fore;
  const dy = ankle.y - hip.y;
  const distance = Math.max(Math.hypot(dx, dy), 1e-6);
  const reach = Math.min(distance, LEG_REACH);
  const along = reach / 2;
  const out = Math.sqrt(Math.max(0, THIGH_LENGTH * THIGH_LENGTH - along * along));
  const ux = dx / distance;
  const uy = dy / distance;
  // Both knees break forward, in every view: "knees away from the centreline"
  // is a head-on rule, and edge-on it hinges one leg backward.
  const kneeFore = hip.fore + ux * along + uy * out;
  const kneeY = hip.y + uy * along - ux * out;
  const knee = v3(lerp(hip.lat, ankle.lat, KNEE_LATERAL_SHARE), kneeY, kneeFore);
  return { hip, knee, ankle, reachShare: distance / LEG_REACH };
}

function footDepthPoint(view: ViewSpec, p: V3, share: number): Pt {
  const flat = project(view, p);
  return { x: flat.x, y: flat.y + p.fore * view.footDepthToY * share };
}

// ── Seeded noise ─────────────────────────────────────────────────────────────

const HASH_A = 127.1;
const HASH_B = 311.7;
const HASH_MAGNITUDE = 43758.5453;

export function hash2(a: number, b: number): number {
  const s = Math.sin(a * HASH_A + b * HASH_B) * HASH_MAGNITUDE;
  return s - Math.floor(s);
}

function signedHash(a: number, b: number): number {
  return hash2(a, b) * 2 - 1;
}

// ── Parts and the two-pass composition ───────────────────────────────────────

/**
 * One piece of the figure. `trace` builds its silhouette path; `paint` fills
 * and shades it. The outline pass strokes every outlined part's trace before
 * any part is painted, so only the line outside the whole figure survives.
 */
interface Part {
  readonly trace: (ctx: Ctx) => void;
  readonly paint: (ctx: Ctx) => void;
  readonly outlined: boolean;
}

function compose(ctx: Ctx, parts: readonly Part[]): void {
  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(OUTLINE, OUTLINE_ALPHA);
  ctx.fillStyle = rgba(OUTLINE, OUTLINE_ALPHA);
  ctx.lineWidth = OUTLINE_HALF_WIDTH * 2;
  for (const part of parts) {
    if (!part.outlined) continue;
    part.trace(ctx);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
  for (const part of parts) {
    ctx.save();
    try {
      part.paint(ctx);
    } finally {
      ctx.restore();
    }
  }
}

function clipTo(ctx: Ctx, trace: (ctx: Ctx) => void, paint: () => void): void {
  ctx.save();
  try {
    trace(ctx);
    ctx.clip();
    paint();
  } finally {
    ctx.restore();
  }
}

function tracePolygon(ctx: Ctx, pts: readonly Pt[]): void {
  ctx.beginPath();
  if (pts.length === 0) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

/** A closed curve through the points, smoothed by midpoint quadratics. */
function traceSmooth(ctx: Ctx, pts: readonly Pt[]): void {
  ctx.beginPath();
  const n = pts.length;
  if (n < 3) {
    tracePolygon(ctx, pts);
    return;
  }
  const mid = (a: Pt, b: Pt): Pt => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
  const start = mid(pts[n - 1], pts[0]);
  ctx.moveTo(start.x, start.y);
  for (let i = 0; i < n; i++) {
    const control = pts[i];
    const end = mid(pts[i], pts[(i + 1) % n]);
    ctx.quadraticCurveTo(control.x, control.y, end.x, end.y);
  }
  ctx.closePath();
}

/** Segments a traced circle is sampled into; enough to stay round at four times the game's tile. */
const CIRCLE_SEGMENTS = 20;
/** Segments per round cap of a limb. */
const CAP_SEGMENTS = 8;

function signedArea(pts: readonly Pt[]): number {
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/**
 * Adds a polygon to the current path wound the same way as every other.
 *
 * A part's silhouette is several overlapping pieces in one path — a sleeve's
 * two segments and its shoulder, a trouser leg's thigh and shin — filled and
 * clipped under the nonzero rule. Two pieces wound in opposite directions
 * cancel where they overlap, and the part is painted with a hole in it exactly
 * at its joints.
 */
function addPolygon(ctx: Ctx, pts: readonly Pt[]): void {
  if (pts.length < 3) return;
  const ordered = signedArea(pts) < 0 ? [...pts].reverse() : pts;
  ctx.moveTo(ordered[0].x, ordered[0].y);
  for (let i = 1; i < ordered.length; i++) ctx.lineTo(ordered[i].x, ordered[i].y);
  ctx.closePath();
}

function circlePolygon(centre: Pt, radius: number): Pt[] {
  return Array.from({ length: CIRCLE_SEGMENTS }, (_unused, i) => {
    const angle = (i / CIRCLE_SEGMENTS) * TWO_PI;
    return { x: centre.x + Math.cos(angle) * radius, y: centre.y + Math.sin(angle) * radius };
  });
}

/** A tapered segment with round ends, as one closed outline. */
function capsulePolygon(a: Pt, b: Pt, halfA: number, halfB: number): Pt[] {
  const angle = Math.atan2(b.y - a.y, b.x - a.x);
  const pts: Pt[] = [];
  for (let i = 0; i <= CAP_SEGMENTS; i++) {
    const t = angle - Math.PI / 2 + (i / CAP_SEGMENTS) * Math.PI;
    pts.push({ x: b.x + Math.cos(t) * halfB, y: b.y + Math.sin(t) * halfB });
  }
  for (let i = 0; i <= CAP_SEGMENTS; i++) {
    const t = angle + Math.PI / 2 + (i / CAP_SEGMENTS) * Math.PI;
    pts.push({ x: a.x + Math.cos(t) * halfA, y: a.y + Math.sin(t) * halfA });
  }
  return pts;
}

/** A straight-sided band between two points: a trouser shin, a sleeve's forearm. */
function bandPolygon(a: Pt, b: Pt, halfA: number, halfB: number): Pt[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(Math.hypot(dx, dy), 1e-6);
  const nx = -dy / length;
  const ny = dx / length;
  return [
    { x: a.x + nx * halfA, y: a.y + ny * halfA },
    { x: b.x + nx * halfB, y: b.y + ny * halfB },
    { x: b.x - nx * halfB, y: b.y - ny * halfB },
    { x: a.x - nx * halfA, y: a.y - ny * halfA },
  ];
}

function centroidOf(pts: readonly Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / Math.max(1, pts.length), y: y / Math.max(1, pts.length) };
}

// ── Cloth shading ────────────────────────────────────────────────────────────

/** How far along the light axis the lit band ends and the shadow band starts. */
const CLOTH_RIM_STOP = 0.1;
const CLOTH_LIT_STOP = 0.3;
const CLOTH_SHADOW_STOP = 0.68;
const CLOTH_DEEP_STOP = 0.9;
const CLOTH_BOUNCE_SHARE = 0.35;
/** The gradient spans a little past the tube's own edges so the rim lands on the silhouette. */
const TUBE_GRADIENT_REACH = 1.1;
/** How many gradient reaches past the tube's ends its shading is filled; the clip trims it. */
const TUBE_FILL_REACHES = 2;

/**
 * Shades a cloth tube across its own axis: lit on the side facing the light,
 * a terminator running along the tube, shadow beyond it and a cool rim on the
 * far edge so a black sleeve still separates from a black floor.
 */
function shadeTube(ctx: Ctx, a: Pt, b: Pt, half: number, ramp: ClothRamp, receded: number): void {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(Math.hypot(dx, dy), 1e-6);
  let nx = -dy / length;
  let ny = dx / length;
  if (nx * LIGHT.x + ny * LIGHT.y < 0) {
    nx = -nx;
    ny = -ny;
  }
  const cx = (a.x + b.x) / 2;
  const cy = (a.y + b.y) / 2;
  const reach = half * TUBE_GRADIENT_REACH;
  const gradient = ctx.createLinearGradient(
    cx + nx * reach,
    cy + ny * reach,
    cx - nx * reach,
    cy - ny * reach,
  );
  const dim = (color: string): string => mix(color, ramp.shadow, receded);
  gradient.addColorStop(0, dim(ramp.rim));
  gradient.addColorStop(CLOTH_RIM_STOP, dim(ramp.light));
  gradient.addColorStop(CLOTH_LIT_STOP, dim(ramp.base));
  gradient.addColorStop(CLOTH_SHADOW_STOP, dim(ramp.shadow));
  gradient.addColorStop(CLOTH_DEEP_STOP, dim(ramp.deep));
  // A faint cool bounce on the far edge, so a black limb still separates
  // from a black body and a dark floor.
  gradient.addColorStop(1, dim(mix(ramp.deep, ramp.rim, CLOTH_BOUNCE_SHARE)));
  ctx.fillStyle = gradient;
  ctx.fillRect(
    Math.min(a.x, b.x) - reach * TUBE_FILL_REACHES,
    Math.min(a.y, b.y) - reach * TUBE_FILL_REACHES,
    Math.abs(dx) + reach * TUBE_FILL_REACHES * 2,
    Math.abs(dy) + reach * TUBE_FILL_REACHES * 2,
  );
}

/** Where a panel's lit side turns to its base tone and its base to shadow, along the light. */
const PANEL_BASE_STOP = 0.35;
const PANEL_SHADOW_STOP = 0.78;
/** How far past its own extent a panel's shading is filled, tiles; the clip trims it. */
const PANEL_FILL_MARGIN = 0.1;

/** Shades a broad cloth panel along the light direction over its own extent. */
function shadePanel(ctx: Ctx, pts: readonly Pt[], ramp: ClothRamp, receded = 0): void {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const cx = (minX + maxX) / 2;
  const cy = (minY + maxY) / 2;
  const rx = (maxX - minX) / 2;
  const ry = (maxY - minY) / 2;
  const dim = (color: string): string => mix(color, ramp.shadow, receded);
  const gradient = ctx.createLinearGradient(
    cx + LIGHT.x * rx,
    cy + LIGHT.y * ry,
    cx - LIGHT.x * rx,
    cy - LIGHT.y * ry,
  );
  gradient.addColorStop(0, dim(ramp.light));
  gradient.addColorStop(PANEL_BASE_STOP, dim(ramp.base));
  gradient.addColorStop(PANEL_SHADOW_STOP, dim(ramp.shadow));
  gradient.addColorStop(1, dim(ramp.deep));
  ctx.fillStyle = gradient;
  ctx.fillRect(
    minX - PANEL_FILL_MARGIN,
    minY - PANEL_FILL_MARGIN,
    maxX - minX + PANEL_FILL_MARGIN * 2,
    maxY - minY + PANEL_FILL_MARGIN * 2,
  );
}

/** A thin sheen line along an edge of a cloth shape: the rim that keeps black off a black floor. */
function rimStroke(ctx: Ctx, from: Pt, to: Pt, color: string, alpha: number, width: number): void {
  ctx.strokeStyle = rgba(color, alpha);
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
}

// ── Stone shading ────────────────────────────────────────────────────────────

const FACET_LIGHT_ALPHA = 0.75;
/** How far toward each edge a facet stops, from the centre: a small flat face in the middle, hard planes round it. */
const FACET_INSET = 0.18;
const FACET_SHADOW_ALPHA = 0.7;
const CRACK_ALPHA = 0.55;
const SPECKLE_COUNT = 9;
const SPECKLE_RADIUS = 0.013;
/** Flecks per unit of a stone's bounding area, scaled so a head carries a handful. */
const SPECKLE_AREA_SCALE = 60;
const MIN_SPECKLES = 3;
const SPECKLE_MIN_SCALE = 0.7;
const SPECKLE_MAX_SCALE = 1.4;
/** Separate hash streams for a fleck's position and size, so they do not move together. */
const SPECKLE_X_SALT = 3;
const SPECKLE_Y_SALT = 7;
const SPECKLE_SIZE_SALT = 11;
const CRACK_SEGMENTS = 4;
/** How far a crack's joints wander off its straight line, as a share of its length. */
const CRACK_WANDER = 0.18;
const CRACK_LIP_ALPHA = 0.35;

interface StoneShape {
  readonly seed: number;
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly sides: number;
  readonly jitter: number;
  readonly rotate: number;
}

function stonePolygon(shape: StoneShape): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < shape.sides; i++) {
    const angle = (i / shape.sides) * TWO_PI + shape.rotate;
    const radius = 1 - shape.jitter * hash2(shape.seed, i);
    pts.push({
      x: shape.cx + Math.cos(angle) * shape.rx * radius,
      y: shape.cy + Math.sin(angle) * shape.ry * radius,
    });
  }
  return pts;
}

/**
 * Hard two-value facets: the run of edges facing the light closed through the
 * centroid in a lit tone, the run facing away in a shadow tone. Polygons, never
 * gradients — a gradient across a stone inflates it into a balloon.
 */
function paintFacets(ctx: Ctx, pts: readonly Pt[], ramp: StoneRamp, receded: number): void {
  const centre = centroidOf(pts);
  const lit = mix(ramp.light, ramp.shadow, receded);
  const dark = mix(ramp.shadow, ramp.deep, receded);
  for (const [color, alpha, sign] of [
    [lit, FACET_LIGHT_ALPHA, 1],
    [dark, FACET_SHADOW_ALPHA, -1],
  ] as const) {
    ctx.fillStyle = rgba(color, alpha);
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const mx = (a.x + b.x) / 2 - centre.x;
      const my = (a.y + b.y) / 2 - centre.y;
      if ((mx * LIGHT.x + my * LIGHT.y) * sign <= 0) continue;
      // Each facet stops short of the centre so the stone keeps a flat face.
      const inset: Pt = {
        x: lerp(centre.x, (a.x + b.x) / 2, FACET_INSET),
        y: lerp(centre.y, (a.y + b.y) / 2, FACET_INSET),
      };
      ctx.beginPath();
      ctx.moveTo(inset.x, inset.y);
      ctx.lineTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.closePath();
      ctx.fill();
    }
  }
}

function paintSpeckle(ctx: Ctx, pts: readonly Pt[], spec: VariantSpec, seed: number): void {
  if (spec.speckle.length === 0) return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const area = (maxX - minX) * (maxY - minY);
  const count = Math.max(MIN_SPECKLES, Math.round(SPECKLE_COUNT * area * SPECKLE_AREA_SCALE));
  for (let i = 0; i < count; i++) {
    ctx.fillStyle = spec.speckle[i % spec.speckle.length];
    const x = lerp(minX, maxX, hash2(seed + i, SPECKLE_X_SALT));
    const y = lerp(minY, maxY, hash2(seed + i, SPECKLE_Y_SALT));
    const r =
      SPECKLE_RADIUS *
      lerp(SPECKLE_MIN_SCALE, SPECKLE_MAX_SCALE, hash2(seed + i, SPECKLE_SIZE_SALT));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TWO_PI);
    ctx.fill();
  }
}

/** A fissure from one edge partway across, with a hairline highlight on its lit lip. */
function paintCrack(
  ctx: Ctx,
  from: Pt,
  to: Pt,
  seed: number,
  width: number,
  ramp: StoneRamp,
): void {
  const segments = CRACK_SEGMENTS;
  const path: Pt[] = [];
  for (let i = 0; i <= segments; i++) {
    const t = i / segments;
    const wander = i === 0 || i === segments ? 0 : CRACK_WANDER * signedHash(seed, i);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    path.push({ x: from.x + dx * t - dy * wander, y: from.y + dy * t + dx * wander });
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = width;
  ctx.strokeStyle = rgba(ramp.hilite, CRACK_LIP_ALPHA);
  ctx.beginPath();
  path.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x + width, p.y + width);
    else ctx.lineTo(p.x + width, p.y + width);
  });
  ctx.stroke();
  ctx.strokeStyle = rgba(ramp.deep, CRACK_ALPHA);
  ctx.beginPath();
  path.forEach((p, i) => {
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  });
  ctx.stroke();
}

const GRAIN_SPACING = 0.05;
const GRAIN_WIDTH = 0.012;
const GRAIN_ALPHA = 0.35;
const CLEAVE_SLOPE = 0.7;
/** Sandstone's strata are near level: at most this slope either way. */
const STRATA_MAX_SLOPE = 0.08;
const GRAIN_SLOPE_SALT = 1;
const GRAIN_OFFSET_SALT = 2;
/** Band spacing varies between these shares of the base spacing. */
const GRAIN_MIN_GAP = 0.8;
const GRAIN_MAX_GAP = 1.3;
/** Scales a band's height into the hash so neighbouring bands differ. */
const GRAIN_GAP_HASH_SCALE = 100;
/** The lit line under each band is fainter than the band. */
const GRAIN_LIP_SHARE = 0.6;
/** How far past the stone each band is drawn, tiles; the clip trims it. */
const GRAIN_OVERSHOOT = 0.02;

/**
 * Sandstone's level bands or slate's slanted cleavage, each a dark line with a
 * lit line under it so it reads as a ledge in the rock, not a stripe painted on.
 */
function paintGrain(ctx: Ctx, pts: readonly Pt[], spec: VariantSpec, seed: number): void {
  if (spec.grain === 'none') return;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  const slope =
    spec.grain === 'cleave' ? CLEAVE_SLOPE : STRATA_MAX_SLOPE * signedHash(seed, GRAIN_SLOPE_SALT);
  const spanX = maxX - minX;
  const start = minY - spanX * Math.abs(slope) + hash2(seed, GRAIN_OFFSET_SALT) * GRAIN_SPACING;
  ctx.lineWidth = GRAIN_WIDTH;
  for (
    let y = start;
    y < maxY + spanX * Math.abs(slope);
    y += GRAIN_SPACING * lerp(GRAIN_MIN_GAP, GRAIN_MAX_GAP, hash2(seed, y * GRAIN_GAP_HASH_SCALE))
  ) {
    for (const [color, offset, alpha] of [
      [spec.stone.deep, 0, GRAIN_ALPHA],
      [spec.stone.hilite, GRAIN_WIDTH, GRAIN_ALPHA * GRAIN_LIP_SHARE],
    ] as const) {
      ctx.strokeStyle = rgba(color, alpha);
      ctx.beginPath();
      ctx.moveTo(minX - GRAIN_OVERSHOOT, y + offset);
      ctx.lineTo(maxX + GRAIN_OVERSHOOT, y + offset + spanX * slope);
      ctx.stroke();
    }
  }
}

/** How far a lit stone's fill moves from its ramp's base toward its light step. */
const LIT_STONE_SHARE = 0.6;
const STONE_CRACK_SALT = 40;
/** A crack runs from an edge through the centre and this far on, as a share of edge-to-centre. */
const STONE_CRACK_REACH = 1.3;
const STONE_CRACK_WIDTH = 0.012;

/** Which step of its ramp a stone is filled from: a shard catching the light sits a step up. */
type StoneTone = 'base' | 'light';

function stonePart(
  pts: readonly Pt[],
  spec: VariantSpec,
  seed: number,
  receded: number,
  cracks: number,
  tone: StoneTone = 'base',
): Part {
  return {
    outlined: true,
    trace: (ctx) => {
      tracePolygon(ctx, pts);
    },
    paint: (ctx) => {
      clipTo(
        ctx,
        (c) => {
          tracePolygon(c, pts);
        },
        () => {
          const fill =
            tone === 'light'
              ? mix(spec.stone.base, spec.stone.light, LIT_STONE_SHARE)
              : spec.stone.base;
          ctx.fillStyle = mix(fill, spec.stone.shadow, receded);
          ctx.fill();
          paintGrain(ctx, pts, spec, seed);
          paintFacets(ctx, pts, spec.stone, receded);
          paintSpeckle(ctx, pts, spec, seed);
          const count = Math.round(cracks);
          const centre = centroidOf(pts);
          for (let c = 0; c < count; c++) {
            const from = pts[Math.floor(hash2(seed, STONE_CRACK_SALT + c) * pts.length)];
            const to = {
              x: lerp(from.x, centre.x, STONE_CRACK_REACH),
              y: lerp(from.y, centre.y, STONE_CRACK_REACH),
            };
            paintCrack(ctx, from, to, seed + c, STONE_CRACK_WIDTH, spec.stone);
          }
        },
      );
    },
  };
}

// ── Draw context ─────────────────────────────────────────────────────────────

interface DrawCtx {
  readonly view: ViewSpec;
  readonly spec: VariantSpec;
  readonly pose: CretinPose;
}

// ── Legs and feet ────────────────────────────────────────────────────────────

/** How much of a head-on leg's knee depth becomes screen height. */
const KNEE_DEPTH_SHARE = 0.5;
/** The thigh's lower end is a touch wider than the shin it meets, so the knee reads as a joint. */
const KNEE_FLARE = 1.05;
const TROUSER_STRIPE_ALPHA = 0.45;
const TROUSER_STRIPE_WIDTH = 0.02;
const KNEE_CREASE_ALPHA = 0.5;
const KNEE_CREASE_WIDTH = 0.014;
/** How far across the shin the knee crease runs, as a share of its half-width. */
const KNEE_CREASE_SPAN = 0.6;
/** The crease's ends and its lowest point below the knee, tiles: it sags as a fold does. */
const KNEE_CREASE_DROP = 0.01;
const KNEE_CREASE_SAG = 0.04;

interface DrawnLeg {
  readonly hip: Pt;
  readonly knee: Pt;
  readonly ankle: Pt;
  readonly depth: number;
}

function drawnLeg(d: DrawCtx, side: number): DrawnLeg {
  const chain = cretinLegChain(d.pose, side);
  const hip = project(d.view, chain.hip);
  const ankle = footDepthPoint(d.view, chain.ankle, 1);
  const knee = footDepthPoint(d.view, chain.knee, KNEE_DEPTH_SHARE);
  return { hip, knee, ankle, depth: chain.ankle.fore };
}

function legParts(d: DrawCtx, side: number, receded: number): Part[] {
  const leg = drawnLeg(d, side);
  const nearScale = 1 + leg.depth * d.view.depthSize;
  const thighHalf = THIGH_HALF;
  const shinHalf = SHIN_HALF * nearScale;
  const hemHalf = HEM_HALF * nearScale;
  const trouserTrace = (ctx: Ctx): void => {
    ctx.beginPath();
    addPolygon(ctx, capsulePolygon(leg.hip, leg.knee, thighHalf, shinHalf * KNEE_FLARE));
    // The shin is a straight-hemmed trouser leg, not a capsule: the hem is
    // squared off above the stone foot.
    addPolygon(ctx, bandPolygon(leg.knee, leg.ankle, shinHalf, hemHalf));
  };
  const trousers: Part = {
    outlined: true,
    trace: trouserTrace,
    paint: (ctx) => {
      clipTo(ctx, trouserTrace, () => {
        // Each segment is shaded across its own axis: a bent leg shaded along
        // the hip-to-ankle chord puts the knee in the gradient's padding.
        clipTo(
          ctx,
          (c) => {
            c.beginPath();
            addPolygon(c, capsulePolygon(leg.hip, leg.knee, thighHalf, shinHalf * KNEE_FLARE));
          },
          () => {
            shadeTube(ctx, leg.hip, leg.knee, thighHalf, TROUSERS, receded);
          },
        );
        clipTo(
          ctx,
          (c) => {
            c.beginPath();
            addPolygon(c, bandPolygon(leg.knee, leg.ankle, shinHalf, hemHalf));
          },
          () => {
            shadeTube(ctx, leg.knee, leg.ankle, shinHalf, TROUSERS, receded);
          },
        );
        // The satin stripe down a dress trouser's outer seam, visible edge-on.
        if (d.view.profile) {
          ctx.strokeStyle = rgba(SATIN_SHEEN, TROUSER_STRIPE_ALPHA * (1 - receded));
          ctx.lineWidth = TROUSER_STRIPE_WIDTH;
          ctx.beginPath();
          ctx.moveTo(leg.hip.x, leg.hip.y);
          ctx.lineTo(leg.knee.x, leg.knee.y);
          ctx.lineTo(leg.ankle.x, leg.ankle.y);
          ctx.stroke();
        }
        ctx.strokeStyle = rgba(TROUSERS.deep, KNEE_CREASE_ALPHA);
        ctx.lineWidth = KNEE_CREASE_WIDTH;
        ctx.beginPath();
        ctx.moveTo(leg.knee.x - shinHalf * KNEE_CREASE_SPAN, leg.knee.y + KNEE_CREASE_DROP);
        ctx.quadraticCurveTo(
          leg.knee.x,
          leg.knee.y + KNEE_CREASE_SAG,
          leg.knee.x + shinHalf * KNEE_CREASE_SPAN,
          leg.knee.y,
        );
        ctx.stroke();
      });
    },
  };
  return [trousers, footPart(d, leg, side, receded, nearScale)];
}

/**
 * The stone foot: a flat-soled block. Head-on it is a broad wedge seen toe-on;
 * edge-on a long block with a blunt, rounded toe; from behind, a heel.
 */
function footPart(d: DrawCtx, leg: DrawnLeg, side: number, receded: number, scale: number): Part {
  const seed = side < 0 ? LEFT_FOOT_SEED : RIGHT_FOOT_SEED;
  const sole = leg.ankle.y + FOOT_HEIGHT * FOOT_SOLE_DROP * scale;
  let pts: Pt[];
  if (d.view.profile) {
    const heel = leg.ankle.x - FOOT_LENGTH * FOOT_HEEL_SHARE;
    const toe = leg.ankle.x + FOOT_LENGTH * (1 - FOOT_HEEL_SHARE);
    pts = [
      { x: heel, y: sole },
      { x: heel - FOOT_HEEL_BULGE, y: sole - FOOT_HEIGHT * FOOT_HEEL_HEIGHT },
      { x: leg.ankle.x - FOOT_INSTEP_BACK, y: leg.ankle.y - FOOT_INSTEP_RISE },
      { x: leg.ankle.x + FOOT_INSTEP_FRONT, y: leg.ankle.y - FOOT_INSTEP_DIP },
      { x: toe - FOOT_TOE_SHOULDER, y: sole - FOOT_HEIGHT * FOOT_SOLE_DROP },
      { x: toe, y: sole - FOOT_HEIGHT * FOOT_TOE_HEIGHT },
      { x: toe - FOOT_TOE_TUCK, y: sole },
    ];
  } else {
    const half = FOOT_HALF_WIDTH * scale;
    const outward = d.view.latToX * side * FOOT_TOE_OUT;
    pts = [
      { x: leg.ankle.x - half + outward, y: sole },
      {
        x: leg.ankle.x - half * FOOT_SIDE_TAPER + outward,
        y: sole - FOOT_HEIGHT * FOOT_SIDE_HEIGHT * scale,
      },
      { x: leg.ankle.x - half * FOOT_TOP_SHARE, y: leg.ankle.y - FOOT_INSTEP_RISE },
      { x: leg.ankle.x + half * FOOT_TOP_SHARE, y: leg.ankle.y - FOOT_INSTEP_RISE },
      {
        x: leg.ankle.x + half * FOOT_SIDE_TAPER + outward,
        y: sole - FOOT_HEIGHT * FOOT_SIDE_HEIGHT * scale,
      },
      { x: leg.ankle.x + half + outward, y: sole },
    ];
  }
  const jittered = pts.map((p, i) => ({
    x: p.x + signedHash(seed, i) * FOOT_CHIP,
    y: p.y + (i === 0 || i === pts.length - 1 ? 0 : signedHash(seed + 1, i) * FOOT_CHIP),
  }));
  return stonePart(jittered, d.spec, seed, receded, 0);
}

const LEFT_FOOT_SEED = 71;
const RIGHT_FOOT_SEED = 83;
/** How far below the ankle the sole sits, as a share of the foot's height. */
const FOOT_SOLE_DROP = 0.75;
/** How much of the foot's length lies behind the ankle, edge-on. */
const FOOT_HEEL_SHARE = 0.28;
const FOOT_HEEL_BULGE = 0.015;
const FOOT_HEEL_HEIGHT = 0.7;
const FOOT_INSTEP_BACK = 0.02;
const FOOT_INSTEP_FRONT = 0.07;
/** How far the top of the foot rises over the ankle, and dips just in front of it, tiles. */
const FOOT_INSTEP_RISE = 0.035;
const FOOT_INSTEP_DIP = 0.01;
const FOOT_TOE_SHOULDER = 0.05;
const FOOT_TOE_HEIGHT = 0.4;
const FOOT_TOE_TUCK = 0.01;
/** Head-on the foot narrows up its sides to a top this share of its width. */
const FOOT_SIDE_TAPER = 0.95;
const FOOT_SIDE_HEIGHT = 0.6;
const FOOT_TOP_SHARE = 0.6;
/** How far each corner of a foot is knocked in or out, tiles. */
const FOOT_CHIP = 0.008;

// ── Torso ────────────────────────────────────────────────────────────────────

/**
 * The jacket's front silhouette, one side, from the collar round to the hem, as
 * (lateral, height). Mirrored across the spine for the other side.
 *
 * Shoulders nearly half the figure's height across, a big barrel chest, and a
 * waist barely narrower: a boulder with a jacket hauled over it. Hips must
 * never be wider than the shoulders or the figure reads as a barrel.
 */
const JACKET_FRONT_HALF: readonly [number, number][] = [
  [0.12, -1.71],
  [0.3, -1.66],
  [0.44, -1.6],
  [0.5, -1.48],
  [0.47, -1.32],
  [0.43, -1.16],
  [0.38, WAIST_Y],
  [0.38, -0.8],
  [0.36, JACKET_HEM_Y],
];

/**
 * The jacket edge-on, facing +fore: from the nape down the hunched back to the
 * seat, then up the front from the crotch over the belly and chest to the
 * throat. (fore, height).
 */
const JACKET_PROFILE: readonly [number, number][] = [
  [-0.05, -1.72],
  [-0.2, -1.67],
  [-0.31, -1.54],
  [-0.33, -1.36],
  [-0.29, -1.14],
  [-0.26, -0.9],
  [-0.29, -0.74],
  [-0.23, JACKET_HEM_Y + 0.02],
  [0.14, JACKET_HEM_Y],
  [0.32, -0.78],
  [0.4, -1.06],
  [0.43, -1.28],
  [0.38, -1.5],
  [0.24, -1.65],
  [0.13, -1.7],
];

const BREATHE_SWELL = 0.018;
/** The breath swells the chest four times as far as the rest of the jacket. */
const CHEST_BREATH_GAIN = 4;
/** Above this height the jacket is chest, and swells with the breath. */
const CHEST_SWELL_Y = -1.1;
/** Edge-on the chest front swells from this height up; the belly stays put. */
const PROFILE_SWELL_Y = -0.9;

function jacketOutline(d: DrawCtx): Pt[] {
  const swell = 1 + d.pose.breathe * BREATHE_SWELL * CHEST_BREATH_GAIN;
  if (d.view.profile) {
    return JACKET_PROFILE.map(([fore, y]) => {
      const front = fore > 0 && y < PROFILE_SWELL_Y ? fore * swell : fore;
      return project(d.view, posed(d.pose, v3(0, y, front)));
    });
  }
  const right = JACKET_FRONT_HALF.map(([lat, y]) =>
    v3(lat * (y < CHEST_SWELL_Y ? swell : 1), y, 0),
  );
  const left = [...JACKET_FRONT_HALF]
    .reverse()
    .map(([lat, y]) => v3(-lat * (y < CHEST_SWELL_Y ? swell : 1), y, 0));
  return [...right, ...left].map((p) => project(d.view, posed(d.pose, p)));
}

/** A point on the front of the chest, for the shirt, lapels and bow tie. */
function chestFront(d: DrawCtx, lat: number, y: number): Pt {
  return project(d.view, posed(d.pose, v3(lat, y, CHEST_FRONT_DEPTH)));
}

/** How far forward of the spine the shirt front sits; what makes a twist slide the V across. */
const CHEST_FRONT_DEPTH = 0.3;
const SHIRT_V_BOTTOM_Y = -1.2;
const COLLAR_Y = -1.7;
const COLLAR_HALF = 0.12;
const LAPEL_NOTCH_HALF = 0.25;
const LAPEL_NOTCH_Y = -1.5;
const JACKET_BUTTON_Y = -1.1;
const POCKET_Y = -0.86;
/** Where down the placket the shirt studs sit, as shares of collar to V. */
const SHIRT_STUD_AT: readonly number[] = [0.4, 0.7];
const SHIRT_STUD_RADIUS = 0.012;
/**
 * A lapel's outline between its collar, its notch and the V: the roll bulges out
 * past the collar-to-notch line, and the lower edge runs to the V's point.
 */
const LAPEL_ROLL_ACROSS = 0.55;
const LAPEL_ROLL_DOWN = 0.3;
const LAPEL_ROLL_LIFT = 0.02;
const LAPEL_FOOT_ACROSS = 0.5;
const LAPEL_FOOT_DOWN = 0.6;
/** The lapel facing away from the light keeps only this share of its sheen. */
const SHADED_LAPEL_SHEEN = 0.35;
const LAPEL_SHEEN_ALPHA = 0.5;
const LAPEL_SHEEN_WIDTH = 0.018;
/** The sheen stripe runs from this far along collar-to-notch to this far along notch-to-V. */
const LAPEL_SHEEN_FROM = 0.4;
const LAPEL_SHEEN_TO = 0.6;
const JACKET_BUTTON_RADIUS = 0.022;
const BUTTON_GLINT_OFFSET = 0.006;
const BUTTON_GLINT_RADIUS = 0.008;
const BUTTON_GLINT_ALPHA = 0.5;
/** The jacket's cutaway fronts: from under the button out to the hem either side of centre. */
const CUTAWAY_HEM_HALF = 0.1;
const CUTAWAY_START_DROP = 0.02;
const CUTAWAY_BOW = 0.02;
const CUTAWAY_BEND_AT = 0.6;
const SEAM_ALPHA = 0.8;
const SEAM_WIDTH = 0.016;
/** The hip pocket flaps: each side of centre, and how wide each flap is. */
const POCKET_CENTRE = 0.24;
const POCKET_HALF = 0.07;

function torsoPart(d: DrawCtx): Part {
  const outline = jacketOutline(d);
  const trace = (ctx: Ctx): void => {
    traceSmooth(ctx, outline);
  };
  return {
    outlined: true,
    trace,
    paint: (ctx) => {
      clipTo(ctx, trace, () => {
        shadePanel(ctx, outline, JACKET);
        if (d.view.id === 'front') paintJacketFront(ctx, d);
        else if (d.view.id === 'away') paintJacketBack(ctx, d, outline);
        else paintJacketProfile(ctx, d);
      });
    },
  };
}

function paintJacketFront(ctx: Ctx, d: DrawCtx): void {
  const collarL = chestFront(d, -COLLAR_HALF, COLLAR_Y);
  const collarR = chestFront(d, COLLAR_HALF, COLLAR_Y);
  const vBottom = chestFront(d, 0, SHIRT_V_BOTTOM_Y);
  const notchL = chestFront(d, -LAPEL_NOTCH_HALF, LAPEL_NOTCH_Y);
  const notchR = chestFront(d, LAPEL_NOTCH_HALF, LAPEL_NOTCH_Y);

  const shirt = [collarL, collarR, vBottom];
  ctx.fillStyle = SHIRT.base;
  tracePolygon(ctx, shirt);
  ctx.fill();
  clipTo(
    ctx,
    (c) => {
      tracePolygon(c, shirt);
    },
    () => {
      shadePanel(ctx, shirt, SHIRT);
    },
  );
  for (const along of SHIRT_STUD_AT) {
    const stud = chestFront(d, 0, lerp(COLLAR_Y, SHIRT_V_BOTTOM_Y, along));
    ctx.fillStyle = BOW_TIE;
    ctx.beginPath();
    ctx.arc(stud.x, stud.y, SHIRT_STUD_RADIUS, 0, TWO_PI);
    ctx.fill();
  }

  for (const [collar, notch, sheen] of [
    [collarL, notchL, 1],
    [collarR, notchR, SHADED_LAPEL_SHEEN],
  ] as const) {
    const lapel = [
      collar,
      {
        x: lerp(collar.x, notch.x, LAPEL_ROLL_ACROSS),
        y: lerp(collar.y, notch.y, LAPEL_ROLL_DOWN) - LAPEL_ROLL_LIFT,
      },
      notch,
      {
        x: lerp(notch.x, vBottom.x, LAPEL_FOOT_ACROSS),
        y: lerp(notch.y, vBottom.y, LAPEL_FOOT_DOWN),
      },
      vBottom,
    ];
    ctx.fillStyle = SATIN;
    tracePolygon(ctx, lapel);
    ctx.fill();
    // The screen-left lapel faces the light; its sheen is a stripe, not a glow.
    ctx.strokeStyle = rgba(SATIN_SHEEN, LAPEL_SHEEN_ALPHA * sheen);
    ctx.lineWidth = LAPEL_SHEEN_WIDTH;
    ctx.beginPath();
    ctx.moveTo(
      lerp(collar.x, notch.x, LAPEL_SHEEN_FROM),
      lerp(collar.y, notch.y, LAPEL_SHEEN_FROM),
    );
    ctx.lineTo(lerp(notch.x, vBottom.x, LAPEL_SHEEN_TO), lerp(notch.y, vBottom.y, LAPEL_SHEEN_TO));
    ctx.stroke();
  }

  const button = chestFront(d, 0, JACKET_BUTTON_Y);
  ctx.fillStyle = SATIN;
  ctx.beginPath();
  ctx.arc(button.x, button.y, JACKET_BUTTON_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = rgba(SATIN_SHEEN, BUTTON_GLINT_ALPHA);
  ctx.beginPath();
  ctx.arc(
    button.x - BUTTON_GLINT_OFFSET,
    button.y - BUTTON_GLINT_OFFSET,
    BUTTON_GLINT_RADIUS,
    0,
    TWO_PI,
  );
  ctx.fill();
  const hemL = chestFront(d, -CUTAWAY_HEM_HALF, JACKET_HEM_Y);
  const hemR = chestFront(d, CUTAWAY_HEM_HALF, JACKET_HEM_Y);
  ctx.strokeStyle = rgba(JACKET.deep, SEAM_ALPHA);
  ctx.lineWidth = SEAM_WIDTH;
  ctx.beginPath();
  ctx.moveTo(button.x, button.y + CUTAWAY_START_DROP);
  ctx.quadraticCurveTo(
    button.x - CUTAWAY_BOW,
    lerp(button.y, hemL.y, CUTAWAY_BEND_AT),
    hemL.x,
    hemL.y,
  );
  ctx.moveTo(button.x, button.y + CUTAWAY_START_DROP);
  ctx.quadraticCurveTo(
    button.x + CUTAWAY_BOW,
    lerp(button.y, hemR.y, CUTAWAY_BEND_AT),
    hemR.x,
    hemR.y,
  );
  ctx.stroke();

  // A pocket-flap line on each hip: where a jacket reads as tailored at a glance.
  for (const lat of [-POCKET_CENTRE, POCKET_CENTRE]) {
    const a = chestFront(d, lat - POCKET_HALF, POCKET_Y);
    const b = chestFront(d, lat + POCKET_HALF, POCKET_Y);
    rimStroke(ctx, a, b, JACKET.deep, SEAM_ALPHA, SEAM_WIDTH);
  }
}

/**
 * The shirt edge-on, as (height, fore) round its outline: a narrow strip down
 * the front edge from the collar to the V's point.
 */
const PROFILE_SHIRT: readonly [number, number][] = [
  [COLLAR_Y, 0.2],
  [COLLAR_Y + 0.02, 0.4],
  [-1.4, 0.4],
  [SHIRT_V_BOTTOM_Y, 0.4],
  [-1.4, 0.33],
];
/** The lapel's roll edge-on, as (height, fore) from collar through notch to foot. */
const PROFILE_LAPEL: readonly [number, number][] = [
  [COLLAR_Y + 0.02, 0.1],
  [LAPEL_NOTCH_Y, 0.16],
  [SHIRT_V_BOTTOM_Y, 0.3],
];
const PROFILE_LAPEL_ALPHA = 0.45;
const PROFILE_LAPEL_WIDTH = 0.022;
/** The side seam edge-on, from under the arm to the hem. */
const SIDE_SEAM_TOP: readonly [number, number] = [-1.36, -0.08];
const SIDE_SEAM_FOOT: readonly [number, number] = [JACKET_HEM_Y - 0.02, -0.06];
const SIDE_SEAM_ALPHA = 0.6;
const SIDE_SEAM_WIDTH = 0.014;
/** The pocket flap edge-on runs between these fores. */
const PROFILE_POCKET_BACK = 0.04;
const PROFILE_POCKET_FRONT = 0.2;

function paintJacketProfile(ctx: Ctx, d: DrawCtx): void {
  const onSpine = ([y, fore]: readonly [number, number]): Pt =>
    project(d.view, posed(d.pose, v3(0, y, fore)));
  // The shirt shows as a wedge down the front edge, with the lapel's roll
  // behind it and the bow tie's knot proud of the throat.
  const shirt = PROFILE_SHIRT.map(onSpine);
  ctx.fillStyle = SHIRT.shadow;
  tracePolygon(ctx, shirt);
  ctx.fill();
  const [lapelTop, lapelNotch, lapelFoot] = PROFILE_LAPEL.map(onSpine);
  ctx.strokeStyle = rgba(SATIN_SHEEN, PROFILE_LAPEL_ALPHA);
  ctx.lineWidth = PROFILE_LAPEL_WIDTH;
  ctx.beginPath();
  ctx.moveTo(lapelTop.x, lapelTop.y);
  ctx.lineTo(lapelNotch.x, lapelNotch.y);
  ctx.lineTo(lapelFoot.x, lapelFoot.y);
  ctx.stroke();
  rimStroke(
    ctx,
    onSpine(SIDE_SEAM_TOP),
    onSpine(SIDE_SEAM_FOOT),
    JACKET.deep,
    SIDE_SEAM_ALPHA,
    SIDE_SEAM_WIDTH,
  );
  rimStroke(
    ctx,
    onSpine([POCKET_Y, PROFILE_POCKET_BACK]),
    onSpine([POCKET_Y, PROFILE_POCKET_FRONT]),
    JACKET.deep,
    SEAM_ALPHA,
    SEAM_WIDTH,
  );
}

/** How far behind the spine the jacket's back surface sits. */
const BACK_DEPTH = -0.3;
const NAPE_Y = -1.68;
/** Where the back vent opens, above the hem. */
const VENT_TOP_Y = -0.84;
const BACK_SEAM_ALPHA = 0.7;
const VENT_ALPHA = 0.95;
const VENT_WIDTH = 0.02;
/** The collar band across the back of the neck: its ends, and how far it dips at the nape. */
const BACK_COLLAR_HALF = 0.16;
const BACK_COLLAR_Y = -1.69;
const BACK_COLLAR_DEPTH = -0.2;
const BACK_COLLAR_ALPHA = 0.9;
const BACK_COLLAR_WIDTH = 0.05;
const BACK_COLLAR_DIP = 0.02;
/** The folds over each shoulder blade: from high near the spine, out and down. */
const BLADE_FOLD_LAT = 0.22;
const BLADE_FOLD_INNER = 0.7;
const BLADE_FOLD_TOP_Y = -1.55;
const BLADE_FOLD_FOOT_Y = -1.3;
const BLADE_FOLD_ALPHA = 0.55;
const BLADE_FOLD_WIDTH = 0.018;
/** The rim of light across the top of the back, left of its highest point. */
const BACK_RIM_FROM: Pt = { x: -0.3, y: 0.06 };
const BACK_RIM_TO: Pt = { x: -0.1, y: 0.02 };
const BACK_RIM_ALPHA = 0.25;
const BACK_RIM_WIDTH = 0.02;

function paintJacketBack(ctx: Ctx, d: DrawCtx, outline: readonly Pt[]): void {
  // The centre seam and the vent: a tux from behind is a black slab, and these
  // two lines are what say "jacket" rather than "shell".
  const nape = project(d.view, posed(d.pose, v3(0, NAPE_Y, BACK_DEPTH)));
  const ventTop = project(d.view, posed(d.pose, v3(0, VENT_TOP_Y, BACK_DEPTH)));
  const hem = project(d.view, posed(d.pose, v3(0, JACKET_HEM_Y, BACK_DEPTH)));
  rimStroke(ctx, nape, ventTop, JACKET.deep, BACK_SEAM_ALPHA, SEAM_WIDTH);
  rimStroke(ctx, ventTop, hem, JACKET.deep, VENT_ALPHA, VENT_WIDTH);
  const collarL = project(
    d.view,
    posed(d.pose, v3(-BACK_COLLAR_HALF, BACK_COLLAR_Y, BACK_COLLAR_DEPTH)),
  );
  const collarR = project(
    d.view,
    posed(d.pose, v3(BACK_COLLAR_HALF, BACK_COLLAR_Y, BACK_COLLAR_DEPTH)),
  );
  ctx.strokeStyle = rgba(SATIN, BACK_COLLAR_ALPHA);
  ctx.lineWidth = BACK_COLLAR_WIDTH;
  ctx.beginPath();
  ctx.moveTo(collarL.x, collarL.y);
  ctx.quadraticCurveTo(nape.x, nape.y + BACK_COLLAR_DIP, collarR.x, collarR.y);
  ctx.stroke();
  // Shoulder-blade folds where the jacket strains over the boulders beneath.
  for (const lat of [-BLADE_FOLD_LAT, BLADE_FOLD_LAT]) {
    const a = project(
      d.view,
      posed(d.pose, v3(lat * BLADE_FOLD_INNER, BLADE_FOLD_TOP_Y, BACK_DEPTH)),
    );
    const b = project(d.view, posed(d.pose, v3(lat, BLADE_FOLD_FOOT_Y, BACK_DEPTH)));
    rimStroke(ctx, a, b, JACKET.deep, BLADE_FOLD_ALPHA, BLADE_FOLD_WIDTH);
  }
  const top = outline.reduce((best, p) => (p.y < best.y ? p : best), outline[0]);
  rimStroke(
    ctx,
    { x: top.x + BACK_RIM_FROM.x, y: top.y + BACK_RIM_FROM.y },
    { x: top.x + BACK_RIM_TO.x, y: top.y + BACK_RIM_TO.y },
    JACKET.rim,
    BACK_RIM_ALPHA,
    BACK_RIM_WIDTH,
  );
}

/**
 * The boulders pushing up through the jacket's shoulder seams — the one piece
 * of stone on the body the tux does not cover, and most of what makes the
 * silhouette read as rock rather than as a big man.
 */
const SHOULDER_ROCKS: readonly { lat: number; y: number; fore: number; r: number; seed: number }[] =
  [
    { lat: 0.2, y: -1.7, fore: 0.02, r: 0.06, seed: 301 },
    { lat: 0.34, y: -1.67, fore: -0.02, r: 0.08, seed: 307 },
    { lat: 0.48, y: -1.58, fore: 0.03, r: 0.07, seed: 309 },
    { lat: -0.21, y: -1.7, fore: 0.02, r: 0.058, seed: 311 },
    { lat: -0.35, y: -1.66, fore: -0.02, r: 0.082, seed: 313 },
    { lat: -0.49, y: -1.57, fore: 0.03, r: 0.066, seed: 315 },
    { lat: 0.1, y: -1.66, fore: -0.26, r: 0.07, seed: 317 },
    { lat: -0.12, y: -1.6, fore: -0.28, r: 0.065, seed: 319 },
    { lat: 0.02, y: -1.48, fore: -0.3, r: 0.055, seed: 323 },
  ];

/** How far a shard stands proud of the cloth it breaks through, per unit of its radius. */
const SHARD_HEIGHT = 1.7;

/**
 * A shard of rock breaking up through the jacket: a broad base in the cloth and
 * a chipped point leaning out from the spine. Round knobs along a shoulder line
 * read as epaulettes; angular points read as something underneath tearing
 * through.
 */
function shardPolygon(base: Pt, r: number, lean: number, seed: number): Pt[] {
  const up = { x: Math.sin(lean), y: -Math.cos(lean) };
  const across = { x: -up.y, y: up.x };
  const at = (u: number, v: number): Pt => ({
    x: base.x + across.x * u * r + up.x * v * r,
    y: base.y + across.y * u * r + up.y * v * r,
  });
  const peak = SHARD_HEIGHT * lerp(SHARD_MIN_PEAK, SHARD_MAX_PEAK, hash2(seed, 1));
  const wobble = (salt: number): number => SHARD_WOBBLE * signedHash(seed, salt);
  return [
    at(-1, 0),
    at(SHARD_BACK_SHOULDER[0], peak * SHARD_BACK_SHOULDER[1] + wobble(2)),
    at(SHARD_TIP_ACROSS + SHARD_TIP_WANDER * signedHash(seed, 3), peak),
    at(SHARD_NOTCH[0], peak * SHARD_NOTCH[1]),
    at(SHARD_FRONT_POINT[0], peak * SHARD_FRONT_POINT[1] + wobble(4)),
    at(SHARD_FRONT_FOOT[0], peak * SHARD_FRONT_FOOT[1]),
    at(1, 0),
    at(0, SHARD_ROOT_DEPTH),
  ];
}

/** Shard peaks vary between these shares of its standard height. */
const SHARD_MIN_PEAK = 0.8;
const SHARD_MAX_PEAK = 1.15;
/** How far a shard's shoulders jitter up or down, in its own radii. */
const SHARD_WOBBLE = 0.1;
/**
 * The shard's outline, as (across, share of peak) in its own radii: a back
 * shoulder, the tip, a notch, a second lower point, then down its front.
 */
const SHARD_BACK_SHOULDER: readonly [number, number] = [-0.75, 0.5];
const SHARD_TIP_ACROSS = -0.2;
const SHARD_TIP_WANDER = 0.2;
const SHARD_NOTCH: readonly [number, number] = [0.25, 0.62];
const SHARD_FRONT_POINT: readonly [number, number] = [0.55, 0.8];
const SHARD_FRONT_FOOT: readonly [number, number] = [0.95, 0.2];
/** The base dips below the cloth line, so the shard is seen to come up through it. */
const SHARD_ROOT_DEPTH = -0.3;
/** Shards behind the spine by more than this are on the back ridge. */
const BACK_RIDGE_DEPTH = -0.2;
/** How far a shard leans out from the spine: edge-on a fixed tilt, head-on by its distance out. */
const PROFILE_SHARD_LEAN = 0.4;
const SHARD_LEAN_PER_TILE = 1.4;

function shoulderRockParts(d: DrawCtx): Part[] {
  const parts: Part[] = [];
  for (const rock of SHOULDER_ROCKS) {
    // The ones on the back ridge only break the silhouette from behind and edge-on.
    if (d.view.id === 'front' && rock.fore < BACK_RIDGE_DEPTH) continue;
    const at = project(d.view, posed(d.pose, v3(rock.lat, rock.y, rock.fore)));
    const outward = d.view.profile
      ? -Math.sign(rock.fore) * PROFILE_SHARD_LEAN
      : rock.lat * d.view.latToX * SHARD_LEAN_PER_TILE;
    const pts = shardPolygon(at, rock.r, outward, rock.seed);
    parts.push(stonePart(pts, d.spec, rock.seed, 0, 0, 'light'));
  }
  return parts;
}

// ── Arms ─────────────────────────────────────────────────────────────────────

interface DrawnArm {
  readonly shoulder: Pt;
  readonly elbow: Pt;
  readonly wrist: Pt;
  readonly fist: Pt;
  readonly fistScale: number;
}

/** Where the sleeve ends down the forearm, as a share of elbow to fist centre. */
const SLEEVE_END_SHARE = 0.82;
/** A fist driven away from the camera never draws smaller than this share of its size. */
const MIN_FIST_SCALE = 0.7;

function drawnArm(d: DrawCtx, side: number): DrawnArm {
  const chain = cretinArmChain(d.pose, side);
  const shoulder = project(d.view, chain.shoulder);
  const elbow = project(d.view, chain.elbow);
  const fist = project(d.view, chain.fist);
  const wrist = {
    x: lerp(elbow.x, fist.x, SLEEVE_END_SHARE),
    y: lerp(elbow.y, fist.y, SLEEVE_END_SHARE),
  };
  const fistScale = Math.max(MIN_FIST_SCALE, 1 + chain.fist.fore * d.view.handDepthSize);
  return { shoulder, elbow, wrist, fist, fistScale };
}

/** Where down the upper arm the armband sits, as a share of its length. */
const ARMBAND_AT = 0.55;
const ARMBAND_HALF_LENGTH = 0.035;
/** The band stands a little proud of the sleeve it wraps. */
const ARMBAND_BULK = 1.15;
/** How far into its shadow tone a receded band goes, at most. */
const ARMBAND_RECEDED_SHADE = 0.6;
const ARMBAND_LIT_ALPHA = 0.7;
/** The upper sleeve's lower end is a touch wider than the forearm it meets. */
const ELBOW_FLARE = 1.05;
/** The shirt cuff stands a little proud of the sleeve end. */
const CUFF_BULK = 1.1;
const ELBOW_CREASE_ALPHA = 0.7;
const ELBOW_CREASE_WIDTH = 0.014;
/** The elbow crease's radius, as a share of the forearm sleeve's half-width. */
const ELBOW_CREASE_RADIUS = 0.8;

function armParts(d: DrawCtx, side: number, receded: number): Part[] {
  const arm = side < 0 ? d.pose.armL : d.pose.armR;
  const drawn = drawnArm(d, side);
  // The round of the shoulder tucks away as the arm goes up: left full-size
  // under a raised arm it is a dark disc on the chest the arm grows out of.
  const raised = clamp01((drawn.shoulder.y - drawn.elbow.y) / UPPER_ARM_LENGTH);
  const deltoid = lerp(DELTOID_RADIUS, UPPER_SLEEVE_HALF, raised);
  const sleeveTrace = (ctx: Ctx): void => {
    ctx.beginPath();
    addPolygon(
      ctx,
      capsulePolygon(
        drawn.shoulder,
        drawn.elbow,
        UPPER_SLEEVE_HALF,
        FORE_SLEEVE_HALF * ELBOW_FLARE,
      ),
    );
    addPolygon(
      ctx,
      bandPolygon(drawn.elbow, drawn.wrist, FORE_SLEEVE_HALF, FORE_SLEEVE_HALF * drawn.fistScale),
    );
    addPolygon(ctx, circlePolygon(drawn.shoulder, deltoid));
  };
  const sleeve: Part = {
    outlined: true,
    trace: sleeveTrace,
    paint: (ctx) => {
      clipTo(ctx, sleeveTrace, () => {
        // Each segment is shaded across its own axis, the forearm last so the
        // elbow's fold reads as one tube passing in front of the other.
        clipTo(
          ctx,
          (c) => {
            c.beginPath();
            addPolygon(
              c,
              capsulePolygon(
                drawn.shoulder,
                drawn.elbow,
                UPPER_SLEEVE_HALF,
                FORE_SLEEVE_HALF * ELBOW_FLARE,
              ),
            );
            addPolygon(c, circlePolygon(drawn.shoulder, deltoid));
          },
          () => {
            shadeTube(ctx, drawn.shoulder, drawn.elbow, deltoid, JACKET, receded);
          },
        );
        clipTo(
          ctx,
          (c) => {
            c.beginPath();
            addPolygon(
              c,
              bandPolygon(
                drawn.elbow,
                drawn.wrist,
                FORE_SLEEVE_HALF,
                FORE_SLEEVE_HALF * drawn.fistScale,
              ),
            );
          },
          () => {
            shadeTube(ctx, drawn.elbow, drawn.wrist, FORE_SLEEVE_HALF, JACKET, receded);
          },
        );
        const dx = drawn.wrist.x - drawn.elbow.x;
        const dy = drawn.wrist.y - drawn.elbow.y;
        const length = Math.max(Math.hypot(dx, dy), 1e-6);
        const ux = dx / length;
        const uy = dy / length;
        const cuffHalf = FORE_SLEEVE_HALF * drawn.fistScale * CUFF_BULK;
        ctx.strokeStyle = mix(SHIRT.base, SHIRT.shadow, receded);
        ctx.lineWidth = CUFF_WIDTH;
        ctx.lineCap = 'butt';
        ctx.beginPath();
        const cx = drawn.wrist.x - (ux * CUFF_WIDTH) / 2;
        const cy = drawn.wrist.y - (uy * CUFF_WIDTH) / 2;
        ctx.moveTo(cx - uy * cuffHalf, cy + ux * cuffHalf);
        ctx.lineTo(cx + uy * cuffHalf, cy - ux * cuffHalf);
        ctx.stroke();
        ctx.strokeStyle = rgba(JACKET.deep, ELBOW_CREASE_ALPHA);
        ctx.lineWidth = ELBOW_CREASE_WIDTH;
        ctx.beginPath();
        ctx.arc(drawn.elbow.x, drawn.elbow.y, FORE_SLEEVE_HALF * ELBOW_CREASE_RADIUS, 0, Math.PI);
        ctx.stroke();
        if (d.spec.armband && side > 0) paintArmband(ctx, drawn, receded);
      });
    },
  };
  return [sleeve, handPart(d, drawn, arm, side, receded)];
}

function paintArmband(ctx: Ctx, drawn: DrawnArm, receded: number): void {
  const at: Pt = {
    x: lerp(drawn.shoulder.x, drawn.elbow.x, ARMBAND_AT),
    y: lerp(drawn.shoulder.y, drawn.elbow.y, ARMBAND_AT),
  };
  const dx = drawn.elbow.x - drawn.shoulder.x;
  const dy = drawn.elbow.y - drawn.shoulder.y;
  const length = Math.max(Math.hypot(dx, dy), 1e-6);
  const ux = dx / length;
  const uy = dy / length;
  const half = UPPER_SLEEVE_HALF * ARMBAND_BULK;
  const band = [
    {
      x: at.x - ux * ARMBAND_HALF_LENGTH - uy * half,
      y: at.y - uy * ARMBAND_HALF_LENGTH + ux * half,
    },
    {
      x: at.x + ux * ARMBAND_HALF_LENGTH - uy * half,
      y: at.y + uy * ARMBAND_HALF_LENGTH + ux * half,
    },
    {
      x: at.x + ux * ARMBAND_HALF_LENGTH + uy * half,
      y: at.y + uy * ARMBAND_HALF_LENGTH - ux * half,
    },
    {
      x: at.x - ux * ARMBAND_HALF_LENGTH + uy * half,
      y: at.y - uy * ARMBAND_HALF_LENGTH - ux * half,
    },
  ];
  ctx.fillStyle = mix(MEAT_SHIELDS_ORANGE, ARMBAND_SHADOW, receded * ARMBAND_RECEDED_SHADE);
  tracePolygon(ctx, band);
  ctx.fill();
  // A lit edge on the side facing the light, so the band reads as wrapped round.
  ctx.fillStyle = rgba(ARMBAND_LIGHT, ARMBAND_LIT_ALPHA * (1 - receded));
  tracePolygon(ctx, [
    band[0],
    band[1],
    { x: at.x + ux * ARMBAND_HALF_LENGTH, y: at.y + uy * ARMBAND_HALF_LENGTH },
    { x: at.x - ux * ARMBAND_HALF_LENGTH, y: at.y - uy * ARMBAND_HALF_LENGTH },
  ]);
  ctx.fill();
}

const LEFT_HAND_SEED = 131;
const RIGHT_HAND_SEED = 149;
const WRIST_SEED_OFFSET = 5;
/** An open hand is this much bigger than the fist it opens from. */
const OPEN_HAND_SIZE = 1.15;
/** A fist's length and width in its radius; an open hand is a longer, flatter slab. */
const FIST_LENGTH = 1.05;
const FIST_WIDTH = 0.95;
const OPEN_HAND_LENGTH = 1.3;
const OPEN_HAND_WIDTH = 0.72;
const HAND_SIDES = 7;
const HAND_CHIP = 0.16;
/** The stone wrist sits this far from the cuff toward the fist, and is this big against the sleeve. */
const WRIST_AT = 0.35;
const WRIST_LENGTH = 0.95;
const WRIST_WIDTH = 0.85;
const WRIST_SIDES = 5;
const WRIST_CHIP = 0.3;
const FINGER_SPLITS = 3;
const KNUCKLE_ALPHA = 0.55;
const FINGER_SPLIT_ALPHA = 0.75;
const KNUCKLE_WIDTH = 0.011;
/** How far across the hand the grooves are spread, in its radius. */
const SPLIT_SPREAD = 0.6;
/** Knuckle grooves start part-way out; finger splits run back past the palm's centre. */
const KNUCKLE_START = 0.25;
const FINGER_SPLIT_START = -0.1;
const SPLIT_END = 0.95;

/**
 * A stone hand: a clenched fist is a squat chiselled block with a knuckle ridge;
 * an open hand is a broader, flatter slab with the finger splits cut into it.
 */
function handPart(
  d: DrawCtx,
  drawn: DrawnArm,
  arm: CretinArmPose,
  side: number,
  receded: number,
): Part {
  const seed = side < 0 ? LEFT_HAND_SEED : RIGHT_HAND_SEED;
  const radius = FIST_RADIUS * drawn.fistScale * lerp(OPEN_HAND_SIZE, 1, arm.clench);
  const dx = drawn.fist.x - drawn.wrist.x;
  const dy = drawn.fist.y - drawn.wrist.y;
  const angle = Math.atan2(dy, dx);
  const open = 1 - arm.clench;
  const pts = stonePolygon({
    seed,
    cx: drawn.fist.x,
    cy: drawn.fist.y,
    rx: radius * lerp(FIST_LENGTH, OPEN_HAND_LENGTH, open),
    ry: radius * lerp(FIST_WIDTH, OPEN_HAND_WIDTH, open),
    sides: HAND_SIDES,
    jitter: HAND_CHIP,
    rotate: angle,
  });
  // The stone wrist between cuff and fist: where rock shows through the
  // costume, and what keeps the fist from reading as a grey glove.
  const wristStone = stonePolygon({
    seed: seed + WRIST_SEED_OFFSET,
    cx: lerp(drawn.wrist.x, drawn.fist.x, WRIST_AT),
    cy: lerp(drawn.wrist.y, drawn.fist.y, WRIST_AT),
    rx: FORE_SLEEVE_HALF * WRIST_LENGTH * drawn.fistScale,
    ry: FORE_SLEEVE_HALF * WRIST_WIDTH * drawn.fistScale,
    sides: WRIST_SIDES,
    jitter: WRIST_CHIP,
    rotate: angle + seed,
  });
  const wrist = stonePart(wristStone, d.spec, seed + WRIST_SEED_OFFSET, receded, 0);
  const fist = stonePart(pts, d.spec, seed, receded, 1);
  const stone: Part = {
    outlined: true,
    trace: (ctx) => {
      ctx.beginPath();
      addPolygon(ctx, wristStone);
      addPolygon(ctx, pts);
    },
    paint: (ctx) => {
      wrist.paint(ctx);
      fist.paint(ctx);
    },
  };
  return {
    outlined: true,
    trace: stone.trace,
    paint: (ctx) => {
      stone.paint(ctx);
      const splits = FINGER_SPLITS;
      const ux = Math.cos(angle);
      const uy = Math.sin(angle);
      ctx.strokeStyle = rgba(d.spec.stone.deep, lerp(KNUCKLE_ALPHA, FINGER_SPLIT_ALPHA, open));
      ctx.lineWidth = KNUCKLE_WIDTH;
      ctx.lineCap = 'round';
      for (let i = 1; i <= splits; i++) {
        const across = lerp(-SPLIT_SPREAD, SPLIT_SPREAD, i / (splits + 1)) * radius;
        const from = lerp(KNUCKLE_START, FINGER_SPLIT_START, open) * radius;
        const to = radius * SPLIT_END;
        ctx.beginPath();
        ctx.moveTo(drawn.fist.x + ux * from - uy * across, drawn.fist.y + uy * from + ux * across);
        ctx.lineTo(drawn.fist.x + ux * to - uy * across, drawn.fist.y + uy * to + ux * across);
        ctx.stroke();
      }
    },
  };
}

// ── Head ─────────────────────────────────────────────────────────────────────

/**
 * Head silhouettes head-on, in head-radius units with +Y down, one side from
 * crown to chin (mirrored for the other). A flat top, a heavy brow and a jaw
 * that holds its width almost to the chin: a block that gives nothing away.
 */
const HEAD_FRONT: Record<HeadShape, readonly [number, number][]> = {
  block: [
    [0.05, -1.02],
    [0.72, -0.98],
    [0.97, -0.6],
    [1.02, -0.1],
    [0.98, 0.42],
    [0.78, 0.86],
    [0.3, 1.02],
  ],
  round: [
    [0.1, -1.0],
    [0.62, -0.9],
    [0.94, -0.5],
    [1.06, 0.0],
    [0.98, 0.5],
    [0.7, 0.88],
    [0.25, 1.02],
  ],
  narrow: [
    [0.05, -1.03],
    [0.6, -0.98],
    [0.8, -0.6],
    [0.82, -0.05],
    [0.76, 0.46],
    [0.56, 0.88],
    [0.2, 1.04],
  ],
};

/**
 * The head edge-on, facing +X: back of the skull, crown, a brow that juts, the
 * eye notch under it, a blunt nose block, the mouth, and a square chin.
 */
const HEAD_PROFILE: Record<HeadShape, readonly [number, number][]> = {
  block: [
    [-0.86, -0.62],
    [-0.5, -1.0],
    [0.4, -1.02],
    [0.8, -0.72],
    [0.98, -0.34],
    [0.84, -0.18],
    [1.08, 0.08],
    [0.9, 0.3],
    [0.94, 0.5],
    [0.88, 0.62],
    [0.96, 0.9],
    [0.56, 1.02],
    [-0.2, 0.9],
    [-0.62, 0.62],
    [-0.94, 0.12],
  ],
  round: [
    [-0.9, -0.5],
    [-0.5, -0.94],
    [0.3, -1.0],
    [0.8, -0.68],
    [0.96, -0.32],
    [0.86, -0.16],
    [1.04, 0.08],
    [0.92, 0.3],
    [0.96, 0.52],
    [0.86, 0.64],
    [0.88, 0.88],
    [0.5, 1.02],
    [-0.2, 0.92],
    [-0.66, 0.6],
    [-0.98, 0.1],
  ],
  narrow: [
    [-0.8, -0.66],
    [-0.46, -1.03],
    [0.36, -1.03],
    [0.72, -0.74],
    [0.9, -0.36],
    [0.78, -0.2],
    [1.0, 0.06],
    [0.84, 0.3],
    [0.86, 0.52],
    [0.8, 0.64],
    [0.84, 0.94],
    [0.46, 1.04],
    [-0.18, 0.92],
    [-0.58, 0.64],
    [-0.86, 0.12],
  ],
};

/** Head half-width head-on, in tiles, and edge-on depth. */
const HEAD_HALF_WIDTH: Record<HeadShape, number> = { block: 0.22, round: 0.222, narrow: 0.165 };
/**
 * Head height against the shared seven-head height: Very Sullen's thin face is
 * a tall one too, so its head is a column where the others are blocks.
 */
const HEAD_HEIGHT_SCALE: Record<HeadShape, number> = { block: 1, round: 1, narrow: 1.14 };
const HEAD_HALF_DEPTH = 0.15;
const HEAD_SEED = 211;
/** How far each corner of the head is knocked in or out, in head radii: a chipped block, not a moulded one. */
const HEAD_CHIP = 0.07;

/**
 * How far a nod carries the head forward edge-on (and half as far down
 * head-on), in head radii: it pivots on the neck, not its own centre.
 */
const HEAD_PITCH_SHIFT = 0.4;
/** The head follows half the body's lean, so a lean reads as a hunch rather than a tilted board. */
const HEAD_LEAN_FOLLOW = 0.5;

interface HeadFrame {
  readonly centre: Pt;
  readonly angle: number;
  readonly rx: number;
  readonly ry: number;
}

function headFrame(d: DrawCtx): HeadFrame {
  const centre3 = posed(d.pose, v3(0, HEAD_CENTRE_Y, HEAD_FORE));
  const centre = project(d.view, centre3);
  const pitchShift = Math.sin(d.pose.headPitch) * HEAD_RY * HEAD_PITCH_SHIFT;
  const angle =
    d.pose.headRoll +
    (d.view.profile
      ? d.pose.lean * HEAD_LEAN_FOLLOW + d.pose.headPitch
      : d.pose.tilt * d.view.latToX * -1);
  return {
    centre: {
      x: centre.x + (d.view.profile ? pitchShift : 0),
      y: centre.y + (d.view.profile ? 0 : pitchShift / 2),
    },
    angle,
    rx: d.view.profile ? HEAD_HALF_DEPTH : HEAD_HALF_WIDTH[d.spec.head],
    ry: HEAD_RY * HEAD_HEIGHT_SCALE[d.spec.head],
  };
}

function headOutline(d: DrawCtx, frame: HeadFrame): Pt[] {
  let unit: readonly [number, number][];
  if (d.view.profile) {
    unit = HEAD_PROFILE[d.spec.head];
  } else {
    const half = HEAD_FRONT[d.spec.head];
    unit = [...half, ...[...half].reverse().map(([x, y]): [number, number] => [-x, y])];
  }
  const cos = Math.cos(frame.angle);
  const sin = Math.sin(frame.angle);
  return unit.map(([ux, uy], i) => {
    const jx = ux + signedHash(HEAD_SEED, i) * HEAD_CHIP;
    const jy = uy + signedHash(HEAD_SEED + 1, i) * HEAD_CHIP;
    const x = jx * frame.rx;
    const y = jy * frame.ry;
    return { x: frame.centre.x + x * cos - y * sin, y: frame.centre.y + x * sin + y * cos };
  });
}

/** A point on the head in head-radius units, carried into the drawn frame. */
function onHead(frame: HeadFrame, ux: number, uy: number): Pt {
  const x = ux * frame.rx;
  const y = uy * frame.ry;
  const cos = Math.cos(frame.angle);
  const sin = Math.sin(frame.angle);
  return { x: frame.centre.x + x * cos - y * sin, y: frame.centre.y + x * sin + y * cos };
}

function headPart(d: DrawCtx): Part {
  const frame = headFrame(d);
  const outline = headOutline(d, frame);
  const trace = (ctx: Ctx): void => {
    tracePolygon(ctx, outline);
  };
  const stone = stonePart(outline, d.spec, HEAD_SEED, 0, 0);
  return {
    outlined: true,
    trace,
    paint: (ctx) => {
      stone.paint(ctx);
      clipTo(ctx, trace, () => {
        if (d.view.id === 'front') paintFace(ctx, d, frame);
        else if (d.view.id === 'side') paintProfileFace(ctx, d, frame);
        else paintBackOfHead(ctx, d, frame);
        if (d.pose.cracks > 0) paintHeadCracks(ctx, d, frame);
      });
    },
  };
}

const FACE_SHADOW_PLANE_ALPHA = 0.32;
const FACE_LIT_PLANE_ALPHA = 0.3;

/**
 * The face head-on, in head radii with +Y down. Everything on it slides across
 * by the head's turn; the nose, standing proud of the face, slides further.
 */
const FACE_TURN_SHIFT = 0.25;
const NOSE_TURN_GAIN = 1.3;
/** Eye spread, in head-radius units, per head shape. */
const EYE_SPREAD: Record<HeadShape, number> = { block: 0.42, round: 0.4, narrow: 0.36 };
const EYE_Y = -0.1;
const BROW_Y = -0.34;
/** The brow slab: its width, the narrower shadowed underside, and how far down that falls. */
const BROW_HALF = 0.92;
const BROW_UNDER_HALF = 0.8;
const BROW_DEPTH = 0.22;
/** Very Sullen's brow barely overhangs: nothing shadows eyes that give nothing away. */
const SULLEN_BROW_DEPTH = 0.1;
const BROW_SHADOW_ALPHA = 0.6;
const SULLEN_BROW_SHADOW_ALPHA = 0.35;
/** The brow's lit upper edge peaks at the middle, a little above the brow line. */
const BROW_CREST_RISE = 0.05;
const BROW_LIT_ALPHA = 0.6;
const FACE_LINE_WIDTH = 0.016;
/** The shadowed plane: from the nose ridge out past the right of the face and down past the chin. */
const RIDGE_TOP_ACROSS = 0.05;
const RIDGE_TOP_DROP = 0.05;
const RIDGE_FOOT_ACROSS = 0.12;
const RIDGE_FOOT_Y = 0.4;
const FACE_PLANE_OVERSHOOT = 1.2;
const SHADOW_PLANE_CHIN_ACROSS = 0.3;
/** The lit plane across the top-left of the brow. */
const LIT_PLANE: readonly [number, number][] = [
  [-0.95, -0.95],
  [0.1, -0.98],
  [-0.1, BROW_Y - 0.08],
  [-0.95, BROW_Y - 0.02],
];
const HEAD_CRACK_WIDTH = 0.016;
/** Two cracks across the face, as (from, to) in head radii, each with its own seed. */
const FACE_CRACKS: readonly {
  from: readonly [number, number];
  to: readonly [number, number];
  seed: number;
}[] = [
  { from: [-0.55, -1.02], to: [-0.3, BROW_Y - 0.05], seed: HEAD_SEED + 31 },
  { from: [1.02, 0.25], to: [0.55, 0.62], seed: HEAD_SEED + 37 },
];
/** Very Sullen's dot eyes, tiles. */
const SULLEN_EYE_RADIUS = 0.014;
/** A socket eye's half-width, and its half-height open and shut, tiles. */
const EYE_HALF_WIDTH = 0.03;
const EYE_OPEN_HALF_HEIGHT = 0.022;
const EYE_SHUT_HALF_HEIGHT = 0.006;
/** Past half-shut the glint is gone. */
const GLINT_BLINK_LIMIT = 0.5;
const EYE_GLINT_OFFSET: Pt = { x: -0.008, y: -0.006 };
const EYE_GLINT_RADIUS = 0.008;
/** The nose block: top under the brow, a base either side of centre. */
const NOSE_TOP_Y = -0.05;
const NOSE_HALF = 0.2;
const NOSE_BASE_Y = 0.3;
const NOSE_FACET_ALPHA = 0.55;
const NOSE_BASE_ALPHA = 0.6;
const NOSE_BASE_WIDTH = 0.012;
const NOSE_BASE_DROP = 0.01;
const MOUTH_HALF = 0.34;
const SULLEN_MOUTH_HALF = 0.22;
const MOUTH_Y = 0.58;
const MOUTH_ALPHA = 0.85;
/** The shadow under the jaw: from the jaw line down past the chin. */
const JAW_HALF = 0.9;
const JAW_Y = 0.75;
const JAW_SHADOW_ALPHA = 0.35;

function paintFace(ctx: Ctx, d: DrawCtx, frame: HeadFrame): void {
  const ramp = d.spec.stone;
  const turn = d.pose.headTurn * -d.view.latToX * FACE_TURN_SHIFT;
  const spread = EYE_SPREAD[d.spec.head];
  const sullen = d.spec.eyes === 'dot';
  const at = ([ux, uy]: readonly [number, number]): Pt => onHead(frame, ux, uy);

  const browL = onHead(frame, -BROW_HALF + turn, BROW_Y);
  const browR = onHead(frame, BROW_HALF + turn, BROW_Y);
  const browDepth = sullen ? SULLEN_BROW_DEPTH : BROW_DEPTH;
  const underL = onHead(frame, -BROW_UNDER_HALF + turn, BROW_Y + browDepth);
  const underR = onHead(frame, BROW_UNDER_HALF + turn, BROW_Y + browDepth);
  ctx.fillStyle = rgba(ramp.deep, sullen ? SULLEN_BROW_SHADOW_ALPHA : BROW_SHADOW_ALPHA);
  tracePolygon(ctx, [browL, browR, underR, underL]);
  ctx.fill();
  ctx.strokeStyle = rgba(ramp.hilite, BROW_LIT_ALPHA);
  ctx.lineWidth = FACE_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(browL.x, browL.y);
  const crest = onHead(frame, turn, BROW_Y - BROW_CREST_RISE);
  ctx.lineTo(crest.x, crest.y);
  ctx.lineTo(browR.x, browR.y);
  ctx.stroke();

  // The face is two planes meeting down the nose, with a hard edge between
  // them: a lit plane toward the light and one in shadow. A smooth fall-off
  // across the face is exactly what makes a grey head read as skin.
  const ridgeTop = onHead(frame, turn * NOSE_TURN_GAIN + RIDGE_TOP_ACROSS, BROW_Y + RIDGE_TOP_DROP);
  const ridgeFoot = onHead(frame, turn * NOSE_TURN_GAIN + RIDGE_FOOT_ACROSS, RIDGE_FOOT_Y);
  ctx.fillStyle = rgba(ramp.deep, FACE_SHADOW_PLANE_ALPHA);
  tracePolygon(ctx, [
    ridgeTop,
    onHead(frame, FACE_PLANE_OVERSHOOT, BROW_Y + RIDGE_TOP_DROP),
    onHead(frame, FACE_PLANE_OVERSHOOT, FACE_PLANE_OVERSHOOT),
    onHead(frame, turn + SHADOW_PLANE_CHIN_ACROSS, FACE_PLANE_OVERSHOOT),
    ridgeFoot,
  ]);
  ctx.fill();
  ctx.fillStyle = rgba(ramp.hilite, FACE_LIT_PLANE_ALPHA);
  tracePolygon(ctx, LIT_PLANE.map(at));
  ctx.fill();
  for (const crack of FACE_CRACKS) {
    paintCrack(ctx, at(crack.from), at(crack.to), crack.seed, HEAD_CRACK_WIDTH, ramp);
  }

  const shut = d.pose.blink;
  for (const side of [-1, 1]) {
    const eye = onHead(frame, side * spread + turn, EYE_Y);
    if (sullen) {
      // Very Sullen's eyes are tiny emotionless dots on an otherwise blank face.
      ctx.fillStyle = EYE_DARK;
      ctx.beginPath();
      ctx.arc(eye.x, eye.y, SULLEN_EYE_RADIUS, 0, TWO_PI);
      ctx.fill();
      continue;
    }
    ctx.fillStyle = EYE_DARK;
    ctx.beginPath();
    ctx.ellipse(
      eye.x,
      eye.y,
      EYE_HALF_WIDTH,
      lerp(EYE_OPEN_HALF_HEIGHT, EYE_SHUT_HALF_HEIGHT, shut),
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    if (shut < GLINT_BLINK_LIMIT) {
      ctx.fillStyle = EYE_GLINT;
      ctx.beginPath();
      ctx.arc(eye.x + EYE_GLINT_OFFSET.x, eye.y + EYE_GLINT_OFFSET.y, EYE_GLINT_RADIUS, 0, TWO_PI);
      ctx.fill();
    }
  }

  const noseTop = onHead(frame, turn * NOSE_TURN_GAIN, NOSE_TOP_Y);
  const noseL = onHead(frame, -NOSE_HALF + turn * NOSE_TURN_GAIN, NOSE_BASE_Y);
  const noseR = onHead(frame, NOSE_HALF + turn * NOSE_TURN_GAIN, NOSE_BASE_Y);
  ctx.fillStyle = rgba(ramp.hilite, NOSE_FACET_ALPHA);
  tracePolygon(ctx, [noseTop, noseL, { x: noseTop.x, y: noseL.y }]);
  ctx.fill();
  ctx.fillStyle = rgba(ramp.deep, NOSE_FACET_ALPHA);
  tracePolygon(ctx, [noseTop, { x: noseTop.x, y: noseR.y }, noseR]);
  ctx.fill();
  ctx.strokeStyle = rgba(ramp.deep, NOSE_BASE_ALPHA);
  ctx.lineWidth = NOSE_BASE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(noseL.x, noseL.y + NOSE_BASE_DROP);
  ctx.lineTo(noseR.x, noseR.y + NOSE_BASE_DROP);
  ctx.stroke();

  // The mouth: a flat line. It gives nothing away.
  const mouthHalf = sullen ? SULLEN_MOUTH_HALF : MOUTH_HALF;
  const mouthL = onHead(frame, -mouthHalf + turn, MOUTH_Y);
  const mouthR = onHead(frame, mouthHalf + turn, MOUTH_Y);
  ctx.strokeStyle = rgba(ramp.deep, MOUTH_ALPHA);
  ctx.lineWidth = FACE_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(mouthL.x, mouthL.y);
  ctx.lineTo(mouthR.x, mouthR.y);
  ctx.stroke();
  // The jaw's underside in shadow: what separates head from collar.
  ctx.fillStyle = rgba(ramp.deep, JAW_SHADOW_ALPHA);
  tracePolygon(ctx, [
    onHead(frame, -JAW_HALF, JAW_Y),
    onHead(frame, JAW_HALF, JAW_Y),
    onHead(frame, JAW_HALF, CHIN_SHADOW_Y),
    onHead(frame, -JAW_HALF, CHIN_SHADOW_Y),
  ]);
  ctx.fill();
}

/** How far below the head's centre the chin's shadow is carried, past the chin itself. */
const CHIN_SHADOW_Y = 1.1;

/** The profile face, in head radii facing +X. */
const PROFILE_BROW_SHADOW: readonly [number, number][] = [
  [0.98, -0.34],
  [0.84, -0.18],
  [0.45, -0.02],
  [0.35, -0.3],
];
const PROFILE_BROW_SHADOW_ALPHA = 0.55;
const SULLEN_PROFILE_BROW_SHADOW_ALPHA = 0.3;
const PROFILE_EYE: readonly [number, number] = [0.66, -0.12];
const SULLEN_PROFILE_EYE_RADIUS = 0.013;
const PROFILE_EYE_HALF_WIDTH = 0.022;
const PROFILE_EYE_OPEN_HALF_HEIGHT = 0.02;
const PROFILE_GLINT_OFFSET: Pt = { x: 0.006, y: -0.006 };
const PROFILE_GLINT_RADIUS = 0.007;
const PROFILE_MOUTH: readonly (readonly [number, number])[] = [
  [0.92, 0.56],
  [0.62, 0.58],
];
/** The shadow under the jaw and down the neck edge-on. */
const PROFILE_JAW_SHADOW: readonly [number, number][] = [
  [-0.4, 0.4],
  [0.3, 0.75],
  [0.3, 1.2],
  [-0.6, 1.2],
];
/** The ear: a chipped knob just behind the jaw hinge, with a lit fleck on it (tiles). */
const EAR_AT: readonly [number, number] = [-0.25, 0.05];
const EAR_HALF_WIDTH = 0.028;
const EAR_HALF_HEIGHT = 0.04;
const EAR_ALPHA = 0.9;
const EAR_LIT_OFFSET: Pt = { x: -0.008, y: -0.01 };
const EAR_LIT_HALF_WIDTH = 0.012;
const EAR_LIT_HALF_HEIGHT = 0.02;
const EAR_LIT_ALPHA = 0.7;

function paintProfileFace(ctx: Ctx, d: DrawCtx, frame: HeadFrame): void {
  const ramp = d.spec.stone;
  const sullen = d.spec.eyes === 'dot';
  const at = ([ux, uy]: readonly [number, number]): Pt => onHead(frame, ux, uy);
  ctx.fillStyle = rgba(
    ramp.deep,
    sullen ? SULLEN_PROFILE_BROW_SHADOW_ALPHA : PROFILE_BROW_SHADOW_ALPHA,
  );
  tracePolygon(ctx, PROFILE_BROW_SHADOW.map(at));
  ctx.fill();
  const eye = at(PROFILE_EYE);
  ctx.fillStyle = EYE_DARK;
  ctx.beginPath();
  if (sullen) ctx.arc(eye.x, eye.y, SULLEN_PROFILE_EYE_RADIUS, 0, TWO_PI);
  else {
    ctx.ellipse(
      eye.x,
      eye.y,
      PROFILE_EYE_HALF_WIDTH,
      lerp(PROFILE_EYE_OPEN_HALF_HEIGHT, EYE_SHUT_HALF_HEIGHT, d.pose.blink),
      0,
      0,
      TWO_PI,
    );
  }
  ctx.fill();
  if (!sullen && d.pose.blink < GLINT_BLINK_LIMIT) {
    ctx.fillStyle = EYE_GLINT;
    ctx.beginPath();
    ctx.arc(
      eye.x + PROFILE_GLINT_OFFSET.x,
      eye.y + PROFILE_GLINT_OFFSET.y,
      PROFILE_GLINT_RADIUS,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  const [mouthA, mouthB] = PROFILE_MOUTH.map(at);
  ctx.strokeStyle = rgba(ramp.deep, MOUTH_ALPHA);
  ctx.lineWidth = FACE_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(mouthA.x, mouthA.y);
  ctx.lineTo(mouthB.x, mouthB.y);
  ctx.stroke();
  ctx.fillStyle = rgba(ramp.deep, JAW_SHADOW_ALPHA);
  tracePolygon(ctx, PROFILE_JAW_SHADOW.map(at));
  ctx.fill();
  const ear = at(EAR_AT);
  ctx.fillStyle = rgba(ramp.shadow, EAR_ALPHA);
  ctx.beginPath();
  ctx.ellipse(ear.x, ear.y, EAR_HALF_WIDTH, EAR_HALF_HEIGHT, frame.angle, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = rgba(ramp.light, EAR_LIT_ALPHA);
  ctx.beginPath();
  ctx.ellipse(
    ear.x + EAR_LIT_OFFSET.x,
    ear.y + EAR_LIT_OFFSET.y,
    EAR_LIT_HALF_WIDTH,
    EAR_LIT_HALF_HEIGHT,
    frame.angle,
    0,
    TWO_PI,
  );
  ctx.fill();
}

/** Cracks across the back of the head, as (from, to) in head radii. */
const BACK_HEAD_CRACKS: readonly {
  from: readonly [number, number];
  to: readonly [number, number];
  seed: number;
}[] = [
  { from: [-0.3, -0.95], to: [0.1, -0.2], seed: HEAD_SEED + 5 },
  { from: [0.95, 0.2], to: [0.35, 0.5], seed: HEAD_SEED + 9 },
];
const BACK_HEAD_CRACK_WIDTH = 0.012;
/** The nape's shadow, from this far down the back of the head. */
const NAPE_SHADOW_Y = 0.6;

function paintBackOfHead(ctx: Ctx, d: DrawCtx, frame: HeadFrame): void {
  const ramp = d.spec.stone;
  const at = ([ux, uy]: readonly [number, number]): Pt => onHead(frame, ux, uy);
  for (const crack of BACK_HEAD_CRACKS) {
    paintCrack(ctx, at(crack.from), at(crack.to), crack.seed, BACK_HEAD_CRACK_WIDTH, ramp);
  }
  ctx.fillStyle = rgba(ramp.deep, JAW_SHADOW_ALPHA);
  tracePolygon(ctx, [
    onHead(frame, -1, NAPE_SHADOW_Y),
    onHead(frame, 1, NAPE_SHADOW_Y),
    onHead(frame, 1, FACE_PLANE_OVERSHOOT),
    onHead(frame, -1, FACE_PLANE_OVERSHOOT),
  ]);
  ctx.fill();
}

/** The cracks that open across the head as the body gives way, with their widths. */
const DEATH_HEAD_CRACKS: readonly {
  from: readonly [number, number];
  to: readonly [number, number];
  seed: number;
  width: number;
}[] = [
  { from: [0.2, -1.05], to: [-0.1, 0.3], seed: HEAD_SEED + 21, width: 0.02 },
  { from: [-1.0, 0.3], to: [-0.2, 0.1], seed: HEAD_SEED + 23, width: 0.018 },
];

function paintHeadCracks(ctx: Ctx, d: DrawCtx, frame: HeadFrame): void {
  const strength = clamp01(d.pose.cracks);
  const at = ([ux, uy]: readonly [number, number]): Pt => onHead(frame, ux, uy);
  ctx.save();
  ctx.globalAlpha *= strength;
  for (const crack of DEATH_HEAD_CRACKS) {
    paintCrack(ctx, at(crack.from), at(crack.to), crack.seed, crack.width, d.spec.stone);
  }
  ctx.restore();
}

// ── Sledge's gear ────────────────────────────────────────────────────────────

const HAT_BRIM_HALF = 0.28;
const HAT_BRIM_DEPTH = 0.045;
const HAT_CROWN_HALF = 0.14;
const HAT_CROWN_HEIGHT = 0.13;
/** Where the hat sits on the head, in head radii above its centre. */
const HAT_SEAT_Y = -0.78;
/** Edge-on the hat tips back a little, the way a cattleman wears it. */
const PROFILE_HAT_TIP = deg(-6);
/** How far the hat tilts per tile it hops off the head. */
const HAT_HOP_TILT = 2;
/** Edge-on the brim reads a touch shorter and the crown a touch longer than head-on. */
const PROFILE_BRIM_SHARE = 0.95;
const PROFILE_CROWN_SHARE = 1.1;
/** The brim's ends curl up hard head-on and barely edge-on, tiles. */
const PROFILE_BRIM_CURL = -0.01;
const FRONT_BRIM_CURL = -0.05;
/**
 * The brim round its rim, as (share of its half-width, share of its depth);
 * null depth marks an end, which takes the curl. Front edge first, then back.
 */
const BRIM_OUTLINE: readonly [number, number | null][] = [
  [-1, null],
  [-0.6, 0.3],
  [0, 1],
  [0.6, 0.3],
  [1, null],
  [0.6, -0.6],
  [0, -0.4],
  [-0.6, -0.6],
];
/** The brim points its lit upper lip runs between. */
const BRIM_LIP_FROM = 7;
const BRIM_LIP_TO = 6;
/**
 * The crown, as (share of its half-width, height): pinched in at the front
 * dent, two lobes either side of it.
 */
const CROWN_OUTLINE: readonly [number, (height: number, brim: number) => number][] = [
  [-1, (_h, brim) => -brim * 0.3],
  [-0.92, (h) => -h * 0.85],
  [-0.45, (h) => -h],
  [0, (h) => -h * 0.82],
  [0.45, (h) => -h],
  [0.92, (h) => -h * 0.85],
  [1, (_h, brim) => -brim * 0.3],
];
/** The hat band: a little wider than the crown, sat just above the brim. */
const HAT_BAND_BULK = 1.1;
const HAT_BAND_LIFT = 0.1;
const HAT_BAND_HEIGHT = 0.035;
/** The dent runs down the crown between these shares of its height. */
const HAT_DENT_TOP = 0.8;
const HAT_DENT_FOOT = 0.35;
const HAT_DENT_ALPHA = 0.6;
const HAT_DENT_WIDTH = 0.014;
const HAT_LIP_ALPHA = 0.55;
const HAT_LIP_WIDTH = 0.012;

function hatPart(d: DrawCtx, frame: HeadFrame): Part {
  const seat = onHead(frame, 0, HAT_SEAT_Y);
  const hop = d.pose.hatHop;
  const angle = frame.angle + (d.view.profile ? PROFILE_HAT_TIP : 0) + hop * HAT_HOP_TILT;
  const cx = seat.x;
  const cy = seat.y - hop;
  const brimHalf = d.view.profile ? HAT_BRIM_HALF * PROFILE_BRIM_SHARE : HAT_BRIM_HALF;
  const crownHalf = d.view.profile ? HAT_CROWN_HALF * PROFILE_CROWN_SHARE : HAT_CROWN_HALF;
  const local = (x: number, y: number): Pt => ({
    x: cx + x * Math.cos(angle) - y * Math.sin(angle),
    y: cy + x * Math.sin(angle) + y * Math.cos(angle),
  });
  // A cattleman crown: pinched front dent, flat-ish top, and a brim that curls
  // up at the sides head-on and dips front and back edge-on.
  const curl = d.view.profile ? PROFILE_BRIM_CURL : FRONT_BRIM_CURL;
  const brim = BRIM_OUTLINE.map(([across, depth]) =>
    local(brimHalf * across, depth === null ? curl : HAT_BRIM_DEPTH * depth),
  );
  const crown = CROWN_OUTLINE.map(([across, height]) =>
    local(crownHalf * across, height(HAT_CROWN_HEIGHT, HAT_BRIM_DEPTH)),
  );
  const trace = (ctx: Ctx): void => {
    ctx.beginPath();
    addPolygon(ctx, brim);
    addPolygon(ctx, crown);
  };
  const bandFoot = -HAT_BRIM_DEPTH * HAT_BAND_LIFT;
  return {
    outlined: true,
    trace,
    paint: (ctx) => {
      ctx.fillStyle = HAT.base;
      traceSmooth(ctx, brim);
      ctx.fill();
      clipTo(
        ctx,
        (c) => {
          traceSmooth(c, brim);
        },
        () => {
          shadePanel(ctx, brim, HAT);
        },
      );
      ctx.fillStyle = HAT.base;
      traceSmooth(ctx, crown);
      ctx.fill();
      clipTo(
        ctx,
        (c) => {
          traceSmooth(c, crown);
        },
        () => {
          shadePanel(ctx, crown, HAT);
          ctx.fillStyle = HAT_BAND;
          tracePolygon(ctx, [
            local(-crownHalf * HAT_BAND_BULK, bandFoot),
            local(crownHalf * HAT_BAND_BULK, bandFoot),
            local(crownHalf * HAT_BAND_BULK, bandFoot - HAT_BAND_HEIGHT),
            local(-crownHalf * HAT_BAND_BULK, bandFoot - HAT_BAND_HEIGHT),
          ]);
          ctx.fill();
          ctx.strokeStyle = rgba(HAT.deep, HAT_DENT_ALPHA);
          ctx.lineWidth = HAT_DENT_WIDTH;
          ctx.beginPath();
          const dentTop = local(0, -HAT_CROWN_HEIGHT * HAT_DENT_TOP);
          const dentFoot = local(0, -HAT_CROWN_HEIGHT * HAT_DENT_FOOT);
          ctx.moveTo(dentTop.x, dentTop.y);
          ctx.lineTo(dentFoot.x, dentFoot.y);
          ctx.stroke();
        },
      );
      ctx.strokeStyle = rgba(HAT.rim, HAT_LIP_ALPHA);
      ctx.lineWidth = HAT_LIP_WIDTH;
      ctx.beginPath();
      ctx.moveTo(brim[BRIM_LIP_FROM].x, brim[BRIM_LIP_FROM].y);
      ctx.lineTo(brim[BRIM_LIP_TO].x, brim[BRIM_LIP_TO].y);
      ctx.stroke();
    },
  };
}

/** Feather tufts per tile of boa, and their size. */
const BOA_TUFTS_PER_TILE = 70;
const BOA_TUFT_RADIUS = 0.034;
const BOA_SEED = 503;
/** How far a tuft wanders off its strand, as a share of its radius. */
const BOA_TUFT_WANDER = 0.5;
const BOA_TUFT_MIN_SIZE = 0.75;
const BOA_TUFT_MAX_SIZE = 1.15;
/** A strand behind the body is this far toward its shadow tone. */
const BOA_BACK_DIM = 0.35;
/** The lit fluff: offset toward the light and smaller than its tuft. */
const BOA_LIT_OFFSET = 0.25;
const BOA_LIT_SIZE = 0.7;
/** Every third tuft carries a bright feather tip, up and left of its centre. */
const BOA_TIP_EVERY = 3;
const BOA_TIP_ACROSS = 0.4;
const BOA_TIP_UP = 0.45;
const BOA_TIP_SIZE = 0.3;

/** A boa is a chain of feather tufts along a path, fluffier than any outline. */
function boaStrand(path: readonly Pt[], seed: number, back: boolean): Part {
  const samples: Pt[] = [];
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    const steps = Math.max(2, Math.round(Math.hypot(b.x - a.x, b.y - a.y) * BOA_TUFTS_PER_TILE));
    for (let s = 0; s < steps; s++)
      samples.push({ x: lerp(a.x, b.x, s / steps), y: lerp(a.y, b.y, s / steps) });
  }
  samples.push(path[path.length - 1]);
  const tufts = samples.map((p, i) => ({
    x: p.x + signedHash(seed, i) * BOA_TUFT_RADIUS * BOA_TUFT_WANDER,
    y: p.y + signedHash(seed + 1, i) * BOA_TUFT_RADIUS * BOA_TUFT_WANDER,
    r: BOA_TUFT_RADIUS * lerp(BOA_TUFT_MIN_SIZE, BOA_TUFT_MAX_SIZE, hash2(seed + 2, i)),
  }));
  const trace = (ctx: Ctx): void => {
    ctx.beginPath();
    for (const t of tufts) addPolygon(ctx, circlePolygon(t, t.r));
  };
  const dim = back ? BOA_BACK_DIM : 0;
  return {
    outlined: true,
    trace,
    paint: (ctx) => {
      ctx.fillStyle = mix(BOA_SHADOW, BOA_DEEP, dim);
      trace(ctx);
      ctx.fill();
      // Lit fluff offset toward the light, then a few bright feather tips: the
      // texture has to survive a 32 px tile as "fluffy", not as a pink tube.
      ctx.fillStyle = mix(BOA_BASE, BOA_SHADOW, dim);
      ctx.beginPath();
      for (const t of tufts) {
        ctx.moveTo(t.x - t.r * BOA_LIT_OFFSET + t.r * BOA_LIT_SIZE, t.y - t.r * BOA_LIT_OFFSET);
        ctx.arc(
          t.x - t.r * BOA_LIT_OFFSET,
          t.y - t.r * BOA_LIT_OFFSET,
          t.r * BOA_LIT_SIZE,
          0,
          TWO_PI,
        );
      }
      ctx.fill();
      ctx.fillStyle = mix(BOA_LIGHT, BOA_BASE, dim);
      ctx.beginPath();
      tufts.forEach((t, i) => {
        if (i % BOA_TIP_EVERY !== 0) return;
        ctx.moveTo(t.x - t.r * BOA_TIP_ACROSS + t.r * BOA_TIP_SIZE, t.y - t.r * BOA_TIP_UP);
        ctx.arc(t.x - t.r * BOA_TIP_ACROSS, t.y - t.r * BOA_TIP_UP, t.r * BOA_TIP_SIZE, 0, TWO_PI);
      });
      ctx.fill();
    },
  };
}

/** A point on a boa strand in body space: (lateral, height, fore). */
type BoaPoint = readonly [number, number, number];

/** Head-on: a loop behind the neck and two strands down the chest, one longer. */
const BOA_FRONT_LEFT: readonly BoaPoint[] = [
  [-0.21, -1.7, 0.2],
  [-0.25, -1.56, 0.3],
  [-0.24, -1.36, 0.32],
  [-0.2, -1.14, 0.3],
];
const BOA_FRONT_RIGHT: readonly BoaPoint[] = [
  [0.21, -1.7, 0.2],
  [0.24, -1.56, 0.3],
  [0.22, -1.4, 0.32],
  [0.19, -1.26, 0.3],
];
const BOA_FRONT_NECK: readonly BoaPoint[] = [
  [-0.21, -1.71, 0.12],
  [0, -1.75, 0.02],
  [0.21, -1.71, 0.12],
];
/** From behind: an arc across the nape, its ends trailing over each shoulder. */
const BOA_BACK_ARC: readonly BoaPoint[] = [
  [-0.2, -1.66, -0.1],
  [-0.08, -1.73, -0.22],
  [0.08, -1.73, -0.22],
  [0.2, -1.66, -0.1],
];
const BOA_BACK_END_LEFT: readonly BoaPoint[] = [
  [-0.2, -1.66, -0.1],
  [-0.27, -1.58, 0.05],
];
const BOA_BACK_END_RIGHT: readonly BoaPoint[] = [
  [0.2, -1.66, -0.1],
  [0.28, -1.56, 0.05],
];
/** Edge-on: over the top of the near shoulder, with the free ends swinging. */
const BOA_SIDE_LOOP: readonly BoaPoint[] = [
  [0, -1.7, -0.04],
  [0, -1.73, 0.1],
  [0, -1.66, 0.22],
];
const BOA_SIDE_HANG: readonly BoaPoint[] = [
  [0, -1.66, 0.22],
  [0, -1.54, 0.3],
  [0, -1.42, 0.27],
];
const BOA_SIDE_FAR_HANG: readonly BoaPoint[] = [
  [0, -1.68, 0.12],
  [0, -1.56, 0.2],
];
/** The free ends swing from this height, fully by the given drop below it. */
const BOA_SWING_TOP_Y = -1.66;
const BOA_SWING_FULL_DROP = 0.6;
const BOA_STRAND_SEED_STEP = 10;

/** The boa draped round Sledge's neck: back loop first, then what hangs in front. */
function boaParts(d: DrawCtx): { behind: Part[]; front: Part[] } {
  const lag = d.pose.boaLag;
  const sway = (y: number): number =>
    lag * clamp01((y + -BOA_SWING_TOP_Y) / -BOA_SWING_FULL_DROP) * -1;
  const strand = (points: readonly BoaPoint[], swings = false): Pt[] =>
    points.map(([lat, y, fore], i) =>
      project(d.view, posed(d.pose, v3(lat, y, swings && i > 0 ? fore + sway(y) : fore))),
    );
  const seed = (n: number): number => BOA_SEED + BOA_STRAND_SEED_STEP * n;
  if (d.view.id === 'front') {
    return {
      behind: [boaStrand(strand(BOA_FRONT_NECK), seed(0), true)],
      front: [
        boaStrand(strand(BOA_FRONT_LEFT), seed(1), false),
        boaStrand(strand(BOA_FRONT_RIGHT), seed(2), false),
      ],
    };
  }
  if (d.view.id === 'away') {
    return {
      behind: [],
      front: [
        boaStrand(strand(BOA_BACK_END_LEFT), seed(3), true),
        boaStrand(strand(BOA_BACK_END_RIGHT), seed(4), true),
        boaStrand(strand(BOA_BACK_ARC), seed(5), false),
      ],
    };
  }
  // Edge-on the boa is an open drape over the front shoulder, not a ring
  // round the chest: a closed loop hides the arm and the lapel, and at 32 px
  // reads as a handle.
  return {
    behind: [boaStrand(strand(BOA_SIDE_FAR_HANG, true), seed(6), true)],
    front: [
      boaStrand(strand(BOA_SIDE_LOOP), seed(7), false),
      boaStrand(strand(BOA_SIDE_HANG, true), seed(8), false),
    ],
  };
}

const BUTTON_RADIUS = 0.07;
/** Where the button is pinned: his left lapel, high on the chest. */
const BUTTON_AT: readonly [number, number] = [-0.24, -1.4];
const BUTTON_FACE_SHARE = 0.68;
/** The star on the button's face: points and its outer and inner radii, in button radii. */
const BUTTON_STAR_VERTICES = 10;
const BUTTON_STAR_OUTER = 0.5;
const BUTTON_STAR_INNER = 0.22;
/** A glint up and left on the button's dome. */
const BUTTON_GLINT_AT = 0.45;
const BUTTON_GLINT_SIZE = 0.18;
const BUTTON_DOME_GLINT_ALPHA = 0.6;
const BUTTON_GLINT_COLOR = '#ffffff';

/** The big pinback button on his left lapel. */
function buttonPart(d: DrawCtx): Part | null {
  if (d.view.id !== 'front') return null;
  const at = chestFront(d, BUTTON_AT[0], BUTTON_AT[1]);
  const trace = (ctx: Ctx): void => {
    ctx.beginPath();
    ctx.arc(at.x, at.y, BUTTON_RADIUS, 0, TWO_PI);
  };
  return {
    outlined: true,
    trace,
    paint: (ctx) => {
      ctx.fillStyle = BUTTON_RING;
      trace(ctx);
      ctx.fill();
      ctx.strokeStyle = rgba(OUTLINE, OUTLINE_ALPHA);
      ctx.lineWidth = OUTLINE_HALF_WIDTH;
      ctx.stroke();
      ctx.fillStyle = BUTTON_FACE;
      ctx.beginPath();
      ctx.arc(at.x, at.y, BUTTON_RADIUS * BUTTON_FACE_SHARE, 0, TWO_PI);
      ctx.fill();
      ctx.fillStyle = BUTTON_STAR;
      ctx.beginPath();
      for (let i = 0; i < BUTTON_STAR_VERTICES; i++) {
        const r = (i % 2 === 0 ? BUTTON_STAR_OUTER : BUTTON_STAR_INNER) * BUTTON_RADIUS;
        const a = (i / BUTTON_STAR_VERTICES) * TWO_PI - Math.PI / 2;
        const p = { x: at.x + Math.cos(a) * r, y: at.y + Math.sin(a) * r };
        if (i === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      }
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = rgba(BUTTON_GLINT_COLOR, BUTTON_DOME_GLINT_ALPHA);
      ctx.beginPath();
      ctx.arc(
        at.x - BUTTON_RADIUS * BUTTON_GLINT_AT,
        at.y - BUTTON_RADIUS * BUTTON_GLINT_AT,
        BUTTON_RADIUS * BUTTON_GLINT_SIZE,
        0,
        TWO_PI,
      );
      ctx.fill();
    },
  };
}

/** Edge-on, the bow tie sits this far below the collar, tucked against the throat. */
const PROFILE_BOW_DROP = 0.07;
const PROFILE_BOW_KNOT_FORE = 0.33;
const PROFILE_BOW_WING_FORE = 0.27;
const PROFILE_BOW_WING_HALF = 0.035;
const PROFILE_BOW_KNOT_HALF = 0.015;
const PROFILE_BOW_KNOT_PROUD = 0.012;
/** Head-on: the knot's height below the collar, each wing's reach and height. */
const BOW_DROP = 0.035;
const BOW_HALF = 0.085;
const BOW_TALL = 0.045;
/** The knot the wings pinch into, and how far the lower wing corners tuck in. */
const BOW_KNOT_HALF_WIDTH = 0.015;
const BOW_KNOT_HALF_HEIGHT = 0.012;
const BOW_LOWER_TUCK = 0.92;
const BOW_SHEEN_ALPHA = 0.7;
const BOW_SHEEN_REACH = 0.7;
const BOW_KNOT_RX = 0.022;
const BOW_KNOT_RY = 0.026;

/** The bow tie at the collar: every Cretin's, and the most legible thing on the body. */
function bowTiePart(d: DrawCtx): Part | null {
  if (d.view.id === 'away') return null;
  if (d.view.profile) {
    // Tucked against the throat below the jaw: standing proud of it, the
    // black knot reads as a beak edge-on.
    const knot = project(
      d.view,
      posed(d.pose, v3(0, COLLAR_Y + PROFILE_BOW_DROP, PROFILE_BOW_KNOT_FORE)),
    );
    const wing = project(
      d.view,
      posed(d.pose, v3(0, COLLAR_Y + PROFILE_BOW_DROP, PROFILE_BOW_WING_FORE)),
    );
    const pts = [
      { x: wing.x, y: wing.y - PROFILE_BOW_WING_HALF },
      { x: knot.x + PROFILE_BOW_KNOT_PROUD, y: knot.y - PROFILE_BOW_KNOT_HALF },
      { x: knot.x + PROFILE_BOW_KNOT_PROUD, y: knot.y + PROFILE_BOW_KNOT_HALF },
      { x: wing.x, y: wing.y + PROFILE_BOW_WING_HALF },
    ];
    return {
      outlined: true,
      trace: (ctx) => {
        tracePolygon(ctx, pts);
      },
      paint: (ctx) => {
        ctx.fillStyle = BOW_TIE;
        tracePolygon(ctx, pts);
        ctx.fill();
      },
    };
  }
  const centre = chestFront(d, 0, COLLAR_Y + BOW_DROP);
  const half = BOW_HALF;
  const tall = BOW_TALL;
  const wings = [
    { x: centre.x - half, y: centre.y - tall },
    { x: centre.x - BOW_KNOT_HALF_WIDTH, y: centre.y - BOW_KNOT_HALF_HEIGHT },
    { x: centre.x + BOW_KNOT_HALF_WIDTH, y: centre.y - BOW_KNOT_HALF_HEIGHT },
    { x: centre.x + half, y: centre.y - tall },
    { x: centre.x + half * BOW_LOWER_TUCK, y: centre.y + tall },
    { x: centre.x + BOW_KNOT_HALF_WIDTH, y: centre.y + BOW_KNOT_HALF_HEIGHT },
    { x: centre.x - BOW_KNOT_HALF_WIDTH, y: centre.y + BOW_KNOT_HALF_HEIGHT },
    { x: centre.x - half * BOW_LOWER_TUCK, y: centre.y + tall },
  ];
  return {
    outlined: false,
    trace: (ctx) => {
      tracePolygon(ctx, wings);
    },
    paint: (ctx) => {
      ctx.fillStyle = BOW_TIE;
      tracePolygon(ctx, wings);
      ctx.fill();
      ctx.fillStyle = rgba(BOW_TIE_SHEEN, BOW_SHEEN_ALPHA);
      tracePolygon(ctx, [
        wings[0],
        wings[1],
        wings[6],
        { x: centre.x - half * BOW_SHEEN_REACH, y: centre.y },
      ]);
      ctx.fill();
      ctx.fillStyle = BOW_TIE;
      ctx.beginPath();
      ctx.ellipse(centre.x, centre.y, BOW_KNOT_RX, BOW_KNOT_RY, 0, 0, TWO_PI);
      ctx.fill();
    },
  };
}

// ── Effects ──────────────────────────────────────────────────────────────────

const CONTACT_SHADOW_RX = 0.52;
const CONTACT_SHADOW_RY = 0.1;

function drawContactShadow(ctx: Ctx, spread: number): void {
  ctx.fillStyle = rgba(SHADOW_COLOR, CONTACT_SHADOW_ALPHA);
  ctx.beginPath();
  ctx.ellipse(0, 0, CONTACT_SHADOW_RX * spread, CONTACT_SHADOW_RY * spread, 0, 0, TWO_PI);
  ctx.fill();
}

const DUST_PUFFS = 9;
const DUST_COLOR = '#b9ad98';
const DUST_ALPHA = 0.28;
/** The cloud over a collapsing heap: enough to mask the break, thin enough to see the stones through. */
const PILE_DUST_ALPHA = 0.24;
/** Puffs shrink toward the ends of the spread by up to this share. */
const DUST_EDGE_FALLOFF = 0.6;
const DUST_MIN_RADIUS = 0.05;
const DUST_MAX_RADIUS = 0.11;
/** A puff's size at no dust, and how much it grows at full. */
const DUST_BASE_SIZE = 0.5;
const DUST_SIZE_GAIN = 0.7;
/** How high the dust hangs at full, tiles. */
const DUST_RISE = 0.06;
/** Puffs spread wider than they are tall, lying on the floor. */
const DUST_SPREAD = 1.3;

/**
 * Dust kicked up at the feet: soft puffs scattered along the ground, largest in
 * the middle. Evenly spaced puffs of one size read as a row of beads.
 */
function drawDust(ctx: Ctx, amount: number, spread: number, seed: number): void {
  if (amount <= 0) return;
  for (let i = 0; i < DUST_PUFFS; i++) {
    const across = signedHash(seed, i);
    const x = across * spread;
    const centreWeight = 1 - Math.abs(across) * DUST_EDGE_FALLOFF;
    const r =
      lerp(DUST_MIN_RADIUS, DUST_MAX_RADIUS, hash2(seed + 2, i)) *
      centreWeight *
      (DUST_BASE_SIZE + amount * DUST_SIZE_GAIN);
    const y = -r / 2 - hash2(seed + 1, i) * DUST_RISE * amount;
    fillSoftEllipse(ctx, x, y, r * DUST_SPREAD, r, DUST_COLOR, DUST_ALPHA * amount);
  }
}

const IMPACT_SPOKES = 7;
const IMPACT_RADIUS = 0.28;
/** How far out and down from a head-on fist its burst is centred, tiles. */
const IMPACT_FRONT_OFFSET = 0.2;
/** Turns the spokes off the vertical so none lines up with the arm. */
const IMPACT_SPOKE_ROTATION = 0.3;
/** Each spoke runs from this share of the burst's radius out to a varied length. */
const IMPACT_SPOKE_INNER = 0.55;
const IMPACT_SPOKE_MIN_OUTER = 0.9;
const IMPACT_SPOKE_MAX_OUTER = 1.25;
const IMPACT_SPOKE_SALT = 71;
const IMPACT_SPOKE_ALPHA = 0.9;
const IMPACT_SPOKE_WIDTH = 0.028;
const IMPACT_FLASH_SIZE = 0.7;
const IMPACT_FLASH_ALPHA = 0.5;
const IMPACT_COLOR = '#fff4d6';

/**
 * A star of short strokes and chips round the fist on the frame the punch
 * lands: the one frame a player should be able to point at as the hit.
 */
function drawImpactBurst(ctx: Ctx, at: Pt, strength: number): void {
  ctx.save();
  try {
    ctx.lineCap = 'round';
    for (let i = 0; i < IMPACT_SPOKES; i++) {
      const angle = (i / IMPACT_SPOKES) * TWO_PI + IMPACT_SPOKE_ROTATION;
      const inner = IMPACT_RADIUS * IMPACT_SPOKE_INNER;
      const outer =
        IMPACT_RADIUS *
        lerp(IMPACT_SPOKE_MIN_OUTER, IMPACT_SPOKE_MAX_OUTER, hash2(IMPACT_SPOKE_SALT, i));
      ctx.strokeStyle = rgba(IMPACT_COLOR, IMPACT_SPOKE_ALPHA * strength);
      ctx.lineWidth = IMPACT_SPOKE_WIDTH;
      ctx.beginPath();
      ctx.moveTo(at.x + Math.cos(angle) * inner, at.y + Math.sin(angle) * inner);
      ctx.lineTo(at.x + Math.cos(angle) * outer, at.y + Math.sin(angle) * outer);
      ctx.stroke();
    }
    fillSoftEllipse(
      ctx,
      at.x,
      at.y,
      IMPACT_RADIUS * IMPACT_FLASH_SIZE,
      IMPACT_RADIUS * IMPACT_FLASH_SIZE,
      IMPACT_COLOR,
      IMPACT_FLASH_ALPHA * strength,
    );
  } finally {
    ctx.restore();
  }
}

const CHIP_COUNT = 5;
const CHIP_RADIUS = 0.045;
const CHIP_FLIGHT = 0.4;
/** Where on the chest the chips fly from. */
const CHIP_SOURCE_Y = -1.3;
const CHIP_FLASH_SIZE = 0.6;
const CHIP_FLASH_ALPHA = 0.45;
/** The chips fan across the upper half-circle, from nearly level on one side to the other. */
const CHIP_FAN_FROM = 0.95;
const CHIP_FAN_TO = 0.05;
const CHIP_ANGLE_SALT = 97;
const CHIP_ANGLE_WANDER = 0.2;
const CHIP_REACH_SALT = 99;
const CHIP_MIN_FLIGHT = 0.6;
const CHIP_FLATTEN = 0.8;
const CHIP_SIDES = 5;
const CHIP_JITTER = 0.3;
const CHIP_EDGE_ALPHA = 0.8;
const CHIP_EDGE_WIDTH = 0.01;
const CHIP_SEED = 100;
const CHIP_TONE_SALT = 101;

/**
 * Stone chips knocked off the chest as a blow lands, flying back and up, with
 * a flash where it hit: at 32 px a flinch alone is a pixel or two, and the
 * chips are what say "that hurt".
 */
function drawChips(ctx: Ctx, d: DrawCtx, strength: number): void {
  const chest = project(d.view, posed(d.pose, v3(0, CHIP_SOURCE_Y, CHEST_FRONT_DEPTH)));
  fillSoftEllipse(
    ctx,
    chest.x,
    chest.y,
    IMPACT_RADIUS * CHIP_FLASH_SIZE,
    IMPACT_RADIUS * CHIP_FLASH_SIZE,
    IMPACT_COLOR,
    CHIP_FLASH_ALPHA * strength,
  );
  for (let i = 0; i < CHIP_COUNT; i++) {
    const angle =
      lerp(-Math.PI * CHIP_FAN_FROM, -Math.PI * CHIP_FAN_TO, i / (CHIP_COUNT - 1)) +
      signedHash(CHIP_ANGLE_SALT, i) * CHIP_ANGLE_WANDER;
    const reach = CHIP_FLIGHT * strength * lerp(CHIP_MIN_FLIGHT, 1, hash2(CHIP_REACH_SALT, i));
    const pts = stonePolygon({
      seed: CHIP_SEED + i,
      cx: chest.x + Math.cos(angle) * reach,
      cy: chest.y + Math.sin(angle) * reach,
      rx: CHIP_RADIUS,
      ry: CHIP_RADIUS * CHIP_FLATTEN,
      sides: CHIP_SIDES,
      jitter: CHIP_JITTER,
      rotate: i,
    });
    ctx.fillStyle = mix(d.spec.stone.light, d.spec.stone.base, hash2(CHIP_TONE_SALT, i));
    tracePolygon(ctx, pts);
    ctx.fill();
    ctx.strokeStyle = rgba(d.spec.stone.deep, CHIP_EDGE_ALPHA);
    ctx.lineWidth = CHIP_EDGE_WIDTH;
    ctx.stroke();
  }
}

const GLYPH_RADIUS = 0.25;
/** The glyph's centre is never lower than this: a hat's height clear of the crown. */
/** Room over the crown for Sledge's hat and a clear gap above it, tiles. */
const GLYPH_HAT_CLEARANCE = 0.3;
/** A bare crown needs only a gap, so the glyph sits down between the hands. */
const GLYPH_BARE_CLEARANCE = 0.1;
const GLYPH_TICKS = 12;

/**
 * The cast flare: an amber rune ring between the raised hands, the colour of
 * the shield it raises, so the cast and the bubble read as one spell.
 */
function drawGlyph(ctx: Ctx, at: Pt, strength: number, time: number): void {
  if (strength <= 0) return;
  const r = GLYPH_RADIUS * lerp(GLYPH_KINDLE_SIZE, 1, strength);
  const spin = time * TWO_PI * GLYPH_TURNS_PER_ROW;
  for (const [scale, alpha] of GLYPH_HALO) {
    ctx.fillStyle = rgba(SHIELD_AMBER, alpha * strength);
    ctx.beginPath();
    ctx.arc(at.x, at.y, r * scale * GLYPH_HALO_SCALE, 0, TWO_PI);
    ctx.fill();
  }
  ctx.lineCap = 'round';
  // A dark ring under the bright one, so the glyph stands off a tan hat or a
  // sandstone head rather than melting into it.
  ctx.strokeStyle = rgba(SHIELD_AMBER_DEEP, GLYPH_BACKING_ALPHA * strength);
  ctx.lineWidth = GLYPH_BACKING_WIDTH;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, TWO_PI);
  ctx.stroke();
  ctx.strokeStyle = rgba(SHIELD_AMBER, GLYPH_RING_ALPHA * strength);
  ctx.lineWidth = GLYPH_RING_WIDTH;
  ctx.beginPath();
  ctx.arc(at.x, at.y, r, 0, TWO_PI);
  ctx.stroke();
  ctx.strokeStyle = rgba(SHIELD_AMBER_HOT, GLYPH_RING_ALPHA * strength);
  ctx.lineWidth = GLYPH_HEX_WIDTH;
  ctx.beginPath();
  for (let i = 0; i < GLYPH_HEX_SIDES; i++) {
    const a = spin + (i / GLYPH_HEX_SIDES) * TWO_PI;
    const p = {
      x: at.x + Math.cos(a) * r * GLYPH_HEX_RADIUS,
      y: at.y + Math.sin(a) * r * GLYPH_HEX_RADIUS,
    };
    if (i === 0) ctx.moveTo(p.x, p.y);
    else ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.stroke();
  ctx.strokeStyle = rgba(SHIELD_AMBER_DEEP, GLYPH_TICK_ALPHA * strength);
  ctx.lineWidth = GLYPH_TICK_WIDTH;
  for (let i = 0; i < GLYPH_TICKS; i++) {
    const a = -spin + (i / GLYPH_TICKS) * TWO_PI;
    const inner = i % 2 === 0 ? GLYPH_LONG_TICK : GLYPH_SHORT_TICK;
    ctx.beginPath();
    ctx.moveTo(at.x + Math.cos(a) * r * inner, at.y + Math.sin(a) * r * inner);
    ctx.lineTo(at.x + Math.cos(a) * r, at.y + Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.fillStyle = rgba(SHIELD_AMBER_HOT, strength);
  ctx.beginPath();
  ctx.arc(at.x, at.y, r * GLYPH_CORE_SIZE, 0, TWO_PI);
  ctx.fill();
}

/** The glyph kindles from this share of its size. */
const GLYPH_KINDLE_SIZE = 0.55;
/** The hexagon turns one way and the ticks the other, half a turn over the row. */
const GLYPH_TURNS_PER_ROW = 0.5;
/** Glow discs behind the glyph, as (size, alpha), widest and faintest first. */
const GLYPH_HALO: readonly (readonly [number, number])[] = [
  [2.1, 0.12],
  [1.6, 0.18],
  [1.25, 0.26],
];
const GLYPH_HALO_SCALE = 0.6;
const GLYPH_BACKING_ALPHA = 0.8;
const GLYPH_BACKING_WIDTH = 0.05;
const GLYPH_RING_ALPHA = 0.95;
const GLYPH_RING_WIDTH = 0.022;
const GLYPH_HEX_WIDTH = 0.014;
const GLYPH_HEX_SIDES = 6;
const GLYPH_HEX_RADIUS = 0.62;
const GLYPH_TICK_ALPHA = 0.9;
const GLYPH_TICK_WIDTH = 0.012;
/** Rune ticks round the rim alternate long and short, starting this far in. */
const GLYPH_LONG_TICK = 0.78;
const GLYPH_SHORT_TICK = 0.86;
const GLYPH_CORE_SIZE = 0.18;

// ── The figure ───────────────────────────────────────────────────────────────

const FOOT_DUST_SEED = 17;
/** How far into shadow a limb on the body's far side is painted, edge-on. */
const FAR_ARM_RECEDED = 0.45;
const FAR_LEG_RECEDED = 0.4;
/** From behind the arms sit a little into the back's shadow. */
const BACK_ARM_RECEDED = 0.15;
/** The glyph's centre sits this many of its radii over the higher hand. */
const GLYPH_OVER_HANDS = 0.9;

/**
 * Paints one Cretin in one pose from one view.
 *
 * The caller has translated to the ground point between the feet and scaled
 * by one tile.
 */
export function drawCretin(
  ctx: Ctx,
  view: CretinView,
  pose: CretinPose,
  variant: CretinVariant,
): void {
  const d: DrawCtx = { view: VIEWS[view], spec: VARIANTS[variant], pose };
  drawContactShadow(ctx, 1);
  drawDust(ctx, pose.dust, CONTACT_SHADOW_RX, FOOT_DUST_SEED);

  const parts: Part[] = [];
  const head = headPart(d);
  const frame = headFrame(d);
  const boa = d.spec.boa ? boaParts(d) : { behind: [], front: [] };
  const bowTie = bowTiePart(d);
  const button = d.spec.button ? buttonPart(d) : null;
  const hat = d.spec.hat ? hatPart(d, frame) : null;

  if (view === 'side') {
    parts.push(...armParts(d, -1, FAR_ARM_RECEDED));
    parts.push(...legParts(d, -1, FAR_LEG_RECEDED));
    parts.push(...legParts(d, 1, 0));
    parts.push(...boa.behind);
    parts.push(torsoPart(d));
    parts.push(...shoulderRockParts(d));
    if (bowTie !== null) parts.push(bowTie);
    parts.push(head);
    if (hat !== null) parts.push(hat);
    parts.push(...boa.front);
    parts.push(...armParts(d, 1, 0));
  } else if (view === 'front') {
    parts.push(...legParts(d, -1, 0));
    parts.push(...legParts(d, 1, 0));
    parts.push(torsoPart(d));
    parts.push(...boa.behind);
    if (bowTie !== null) parts.push(bowTie);
    parts.push(head);
    if (hat !== null) parts.push(hat);
    parts.push(...boa.front);
    if (button !== null) parts.push(button);
    // Head-on both arms belong in front of the torso; drawing the far one
    // behind makes the figure look one-armed.
    parts.push(...armParts(d, -1, 0));
    parts.push(...armParts(d, 1, 0));
    // Over the sleeves: the rock breaks up through the shoulder seams.
    parts.push(...shoulderRockParts(d));
  } else {
    parts.push(...legParts(d, -1, 0));
    parts.push(...legParts(d, 1, 0));
    // From behind the arms hang at the sides of a back wider than they are
    // spread, so they go behind it — and a punch thrown away from the camera
    // disappears behind the shoulders as it should.
    parts.push(...armParts(d, -1, BACK_ARM_RECEDED));
    parts.push(...armParts(d, 1, BACK_ARM_RECEDED));
    parts.push(torsoPart(d));
    parts.push(...shoulderRockParts(d));
    parts.push(head);
    parts.push(...boa.front);
    if (hat !== null) parts.push(hat);
  }

  compose(ctx, parts);
  if (pose.cracks > 0) drawBodyCracks(ctx, d);
  if (pose.impact > 0 && view !== 'away') {
    // Head-on the fist is in front of the chest, so the burst goes just
    // beyond it, out and down, rather than over his own face; from behind it
    // would read as him being hit in the back.
    const fist = drawnArm(d, 1).fist;
    const at =
      view === 'front'
        ? { x: fist.x + IMPACT_FRONT_OFFSET * d.view.latToX, y: fist.y + IMPACT_FRONT_OFFSET }
        : fist;
    drawImpactBurst(ctx, at, pose.impact);
  }
  if (pose.chips > 0) drawChips(ctx, d, pose.chips);

  if (pose.glyph > 0) {
    const left = drawnArm(d, -1).fist;
    const right = drawnArm(d, 1).fist;
    // Between the hands and clear of the head and any hat: the glyph over a
    // tan hat brim merges with it at 32 px.
    const at = {
      x: (left.x + right.x) / 2,
      y: Math.min(
        Math.min(left.y, right.y) - GLYPH_RADIUS * GLYPH_OVER_HANDS,
        HEAD_CENTRE_Y -
          HEAD_RY -
          (d.spec.hat ? GLYPH_HAT_CLEARANCE : GLYPH_BARE_CLEARANCE) -
          GLYPH_RADIUS,
      ),
    };
    drawGlyph(ctx, at, pose.glyph, pose.time);
  }
}

/** Fissures running across the jacket and through the body as it gives way. */
function drawBodyCracks(ctx: Ctx, d: DrawCtx): void {
  const outline = jacketOutline(d);
  const ramp = d.spec.stone;
  ctx.save();
  ctx.globalAlpha *= clamp01(d.pose.cracks);
  clipTo(
    ctx,
    (c) => {
      traceSmooth(c, outline);
    },
    () => {
      // The jacket splits along jagged tears and the rock shows through them:
      // a dark hairline on black cloth is invisible, and a pale one reads as a
      // twig laid on the suit.
      const centre = centroidOf(outline);
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < BODY_TEARS; i++) {
        const from = outline[Math.floor(hash2(TEAR_SALT, i) * outline.length)];
        const to = {
          x: lerp(from.x, centre.x, TEAR_REACH),
          y: lerp(from.y, centre.y, TEAR_REACH),
        };
        const path: Pt[] = [];
        for (let k = 0; k <= TEAR_SEGMENTS; k++) {
          const t = k / TEAR_SEGMENTS;
          const wander =
            k === 0 || k === TEAR_SEGMENTS ? 0 : TEAR_WANDER * signedHash(TEAR_WANDER_SALT + i, k);
          path.push({
            x: lerp(from.x, to.x, t) - (to.y - from.y) * wander,
            y: lerp(from.y, to.y, t) + (to.x - from.x) * wander,
          });
        }
        for (const [color, width] of [
          [ramp.base, TEAR_WIDTH],
          [ramp.light, TEAR_WIDTH * TEAR_CORE_SHARE],
        ] as const) {
          ctx.strokeStyle = color;
          ctx.lineWidth = width;
          ctx.beginPath();
          path.forEach((p, k) => {
            if (k === 0) ctx.moveTo(p.x, p.y);
            else ctx.lineTo(p.x, p.y);
          });
          ctx.stroke();
        }
      }
    },
  );
  ctx.restore();
}

const BODY_TEARS = 4;
const TEAR_SEGMENTS = 4;
const TEAR_WIDTH = 0.04;
const TEAR_SALT = 701;
const TEAR_WANDER_SALT = 710;
/** A tear runs from the jacket's edge through its centre and a little past. */
const TEAR_REACH = 1.15;
const TEAR_WANDER = 0.2;
/** The lit rock at a tear's core is narrower than the rock showing round it. */
const TEAR_CORE_SHARE = 0.45;

// ── Rubble: the death's end ──────────────────────────────────────────────────

/**
 * One piece of a collapsed Cretin: where it starts on the body, where it comes
 * to rest in the pile, and what it is.
 */
interface RubbleChunk {
  readonly kind: 'stone' | 'cloth' | 'shirt';
  readonly seed: number;
  readonly from: Pt;
  readonly to: Pt;
  readonly r: number;
  /** When in the collapse this piece lets go, 0..1. */
  readonly delay: number;
  readonly spin: number;
}

/**
 * The pile, bottom course first: how many stones in each course, how wide the
 * course spreads, and the stone size there. Big blocks at the bottom and a few
 * smaller ones on top make a mound; a random scatter makes gravel.
 */
const RUBBLE_COURSES: readonly { count: number; halfWidth: number; r: number }[] = [
  { count: 6, halfWidth: 0.62, r: 0.17 },
  { count: 5, halfWidth: 0.46, r: 0.15 },
  { count: 3, halfWidth: 0.28, r: 0.14 },
  { count: 2, halfWidth: 0.12, r: 0.12 },
];
/** How high each course sits above the one below, as a share of its stones' radius. */
const COURSE_RISE = 0.95;
export const PILE_HALF_WIDTH = 0.7;
/**
 * How wide the stones start, against the heap they settle into: the kneeling
 * body with its arms out is wider than the mound it becomes.
 */
const RUBBLE_SOURCE_SPREAD = 1.15;
/** How far each stone settles off its course's even spacing, tiles. */
const RUBBLE_SCATTER = 0.07;
/** Where the tux scraps start: across the kneeling chest, between the stones. */
const CLOTH_SOURCE_Y = -0.85;
const RUBBLE_SHADE_SEED = 5;
/** How far into shadow the darkest stone in the heap sits. */
const RUBBLE_SHADE_RANGE = 0.45;
/** Stones hashing above this catch the light. */
const RUBBLE_LIT_SHARE = 0.72;
/** Where on the kneeling body each course's stones come from, bottom course first. */
const COURSE_SOURCE_Y: readonly number[] = [-0.18, -0.5, -0.85, -1.12];
/** How late each course lets go: the base slumps first, the shoulders come down on top. */
const COURSE_DELAY: readonly number[] = [0, 0.06, 0.12, 0.18];

/** The base course sits this far into the floor, as a share of its stones' radius. */
const BASE_COURSE_SINK = 0.6;
/** Each course nests into the gaps of the one below by this share of its rise. */
const COURSE_NESTING = 0.7;
const RUBBLE_SEED = 911;
const RUBBLE_COURSE_SEED_STEP = 37;
const RUBBLE_STONE_SEED_STEP = 7;
/** Stones vary between these shares of their course's size: a few big slabs among gravel. */
const RUBBLE_MIN_SIZE = 0.6;
const RUBBLE_MAX_SIZE = 1.35;
/** Separate hash streams for a stone's size, start, rest, delay and spin. */
const RUBBLE_SIZE_SALT = 903;
const RUBBLE_FROM_X_SALT = 905;
const RUBBLE_FROM_Y_SALT = 907;
const RUBBLE_TO_X_SALT = 909;
const RUBBLE_TO_Y_SALT = 913;
const RUBBLE_DELAY_SALT = 915;
const RUBBLE_SPIN_SALT = 917;
/** How far a stone's start wanders off the kneeling body's outline, tiles. */
const RUBBLE_SOURCE_JITTER_X = 0.04;
const RUBBLE_SOURCE_JITTER_Y = 0.1;
/** Stones settle further off true across the heap than up and down it. */
const RUBBLE_SETTLE_SHARE = 0.6;
const RUBBLE_DELAY_JITTER = 0.05;
/** How far a stone turns as it falls, radians. */
const RUBBLE_SPIN = 1.4;
/** The tux comes down over the stones: the jacket across the top of the heap, the shirt front on it. */
const TUX_SCRAPS: readonly { kind: RubbleChunk['kind']; x: number; y: number; r: number }[] = [
  { kind: 'cloth', x: -0.12, y: -0.3, r: 0.22 },
  { kind: 'cloth', x: 0.24, y: -0.2, r: 0.16 },
  { kind: 'shirt', x: -0.02, y: -0.36, r: 0.08 },
];
const SCRAP_SEED = 1301;
const SCRAP_SEED_STEP = 11;
const SCRAP_SPIN_SALT = 919;
/** Scraps start a little inboard of where they land, and fall just after the top course. */
const SCRAP_SOURCE_SPREAD = 0.9;
const SCRAP_LAG = 0.04;

/**
 * The collapse's pieces, laid out once. Each stone drops from roughly where it
 * sat on the kneeling body — the legs become the base, the chest the middle, the
 * shoulders the top — so the body comes down rather than bursting apart. A few
 * scraps of tux fall with them and settle draped over the stones.
 */
function rubbleChunks(): RubbleChunk[] {
  const chunks: RubbleChunk[] = [];
  let top = 0;
  RUBBLE_COURSES.forEach((course, level) => {
    const y =
      level === 0 ? -course.r * BASE_COURSE_SINK : top - course.r * COURSE_RISE * COURSE_NESTING;
    for (let i = 0; i < course.count; i++) {
      const seed = RUBBLE_SEED + level * RUBBLE_COURSE_SEED_STEP + i * RUBBLE_STONE_SEED_STEP;
      const across = lerp(
        -course.halfWidth,
        course.halfWidth,
        course.count === 1 ? 1 / 2 : i / (course.count - 1),
      );
      const r = course.r * lerp(RUBBLE_MIN_SIZE, RUBBLE_MAX_SIZE, hash2(RUBBLE_SIZE_SALT, seed));
      chunks.push({
        kind: 'stone',
        seed,
        from: {
          x:
            across * RUBBLE_SOURCE_SPREAD +
            signedHash(RUBBLE_FROM_X_SALT, seed) * RUBBLE_SOURCE_JITTER_X,
          y: COURSE_SOURCE_Y[level] + signedHash(RUBBLE_FROM_Y_SALT, seed) * RUBBLE_SOURCE_JITTER_Y,
        },
        // Settled a little off true: a heap, not masonry.
        to: {
          x: across + signedHash(RUBBLE_TO_X_SALT, seed) * RUBBLE_SCATTER,
          y: y + signedHash(RUBBLE_TO_Y_SALT, seed) * RUBBLE_SCATTER * RUBBLE_SETTLE_SHARE,
        },
        r,
        delay: COURSE_DELAY[level] + hash2(RUBBLE_DELAY_SALT, seed) * RUBBLE_DELAY_JITTER,
        spin: signedHash(RUBBLE_SPIN_SALT, seed) * RUBBLE_SPIN,
      });
    }
    top = y;
  });
  // The chips the body shed while it sagged are already on the floor.
  for (const pebble of SHED_STONES) {
    chunks.push({
      kind: 'stone',
      seed: pebble.seed,
      from: pebble.to,
      to: pebble.to,
      r: pebble.r,
      delay: 0,
      spin: 0,
    });
  }
  // The tux does not vanish with the body; it comes down on the heap.
  for (const scrap of TUX_SCRAPS) {
    const seed = SCRAP_SEED + chunks.length * SCRAP_SEED_STEP;
    chunks.push({
      kind: scrap.kind,
      seed,
      from: { x: scrap.x * SCRAP_SOURCE_SPREAD, y: CLOTH_SOURCE_Y },
      to: { x: scrap.x, y: scrap.y },
      r: scrap.r,
      delay: COURSE_DELAY[COURSE_DELAY.length - 1] + SCRAP_LAG,
      spin: signedHash(SCRAP_SPIN_SALT, seed),
    });
  }
  return chunks;
}

/**
 * Stones that break off the shoulders and arms and fall while the body is
 * still kneeling, before it comes apart: the in-between that keeps the
 * collapse from being a one-frame swap.
 */
const SHED_STONES: readonly { seed: number; from: Pt; to: Pt; r: number }[] = [
  { seed: 1201, from: { x: -0.5, y: -1.28 }, to: { x: -0.78, y: -0.05 }, r: 0.07 },
  { seed: 1207, from: { x: 0.52, y: -1.25 }, to: { x: 0.74, y: -0.05 }, r: 0.08 },
  { seed: 1213, from: { x: 0.56, y: -0.9 }, to: { x: 0.86, y: -0.04 }, r: 0.055 },
  { seed: 1217, from: { x: -0.2, y: -1.4 }, to: { x: -0.9, y: -0.04 }, r: 0.05 },
];

const SHED_FLATTEN = 0.8;
const SHED_SIDES = 6;
const SHED_JITTER = 0.3;
/** How far a shed stone turns on its way down, radians. */
const SHED_SPIN = 3;

/**
 * Paints the shed stones mid-fall over a kneeling body.
 *
 * @param fall 0 as they break off, 1 on the floor where the heap will find them.
 */
export function drawCretinShedStones(
  ctx: Ctx,
  view: CretinView,
  variant: CretinVariant,
  fall: number,
): void {
  const spec = VARIANTS[variant];
  const parts: Part[] = [];
  const flip = view === 'front' ? -1 : 1;
  for (const stone of SHED_STONES) {
    const t = clamp01(fall);
    const x = lerp(stone.from.x * flip, stone.to.x, t);
    const y = lerp(stone.from.y, stone.to.y, t * t);
    const pts = stonePolygon({
      seed: stone.seed,
      cx: x,
      cy: y,
      rx: stone.r,
      ry: stone.r * SHED_FLATTEN,
      sides: SHED_SIDES,
      jitter: SHED_JITTER,
      rotate: stone.seed + t * SHED_SPIN,
    });
    parts.push(stonePart(pts, spec, stone.seed, 0, 0, 'light'));
  }
  compose(ctx, parts);
}

const RUBBLE = rubbleChunks();

/** The mound's height, where the head comes to rest. */
const PILE_HEIGHT = 0.55;
/** How far proud of the heap's top the head settles, in head radii. */
const HEAD_REST_PROUD = 0.3;
/** Where the head comes to rest: on top of the pile, face out. */
const HEAD_REST: Pt = { x: 0.04, y: -PILE_HEIGHT - HEAD_RY * HEAD_REST_PROUD };
const HEAD_FROM: Pt = { x: 0.08, y: -1.36 };
const HEAD_FALL_DELAY = 0.05;
const HEAD_FALL_SPAN = 0.7;
/** The heap's shadow spreads as the stones fan out. */
const PILE_SHADOW_START = 0.9;
const PILE_SHADOW_END = 1.15;
/** Each stone bounces once on landing, over the last share of its fall. */
const LANDING_START = 0.8;
const LANDING_SPAN = 0.2;
const LANDING_BOUNCE = 0.03;
const RUBBLE_FLATTEN = 0.78;
const RUBBLE_SIDES = 6;
const RUBBLE_JITTER = 0.28;
/** A scrap of tux is broader than the stone it lies on, and flattens as it settles. */
const SCRAP_BREADTH = 1.3;
const SCRAP_FALLING_DEPTH = 0.8;
const SCRAP_SETTLED_DEPTH = 0.4;
const SCRAP_SIDES = 7;
const SCRAP_JITTER = 0.35;
/** Cloth barely spins as it falls; it flutters. */
const SCRAP_SPIN_SHARE = 0.3;
/** The head's own little bounce, over the last quarter of its fall. */
const HEAD_LANDING_START = 0.75;
const HEAD_LANDING_SPAN = 0.25;
const HEAD_LANDING_BOUNCE = 0.05;
/** The head tumbles from tipped back to tipped slightly forward as it falls. */
const HEAD_FALL_START_ANGLE = deg(-30);
const HEAD_REST_ANGLE = deg(8);
/** How far Sledge's hat hops off his head as it lands. */
const HAT_LANDING_HOP = 0.12;
const BOA_DRAPE_SEED = BOA_SEED + 90;
/** The boa's drape, each point falling from where it hung to where it lies on the heap. */
const BOA_DRAPE: readonly { fromX: number; toX: number; fromY: number; toY: number }[] = [
  { fromX: -0.1, toX: -0.36, fromY: -1.4, toY: -0.1 },
  { fromX: 0, toX: -0.2, fromY: -1.5, toY: -PILE_HEIGHT * 0.8 },
  { fromX: 0.1, toX: -0.02, fromY: -1.45, toY: -PILE_HEIGHT * 0.95 },
];
/** The armband on the heap: where it falls from and to, and its size and tilt. */
const FALLEN_BAND_X = 0.3;
const FALLEN_BAND_FROM_Y = -1.1;
const FALLEN_BAND_TO_Y = -0.06;
const FALLEN_BAND_RX = 0.075;
const FALLEN_BAND_RY = 0.03;
const FALLEN_BAND_TILT = deg(-12);
const FALLEN_BAND_LIT_OFFSET: Pt = { x: -0.02, y: -0.008 };
const FALLEN_BAND_LIT_RX = 0.04;
const FALLEN_BAND_LIT_RY = 0.012;
/** The dust across the heap spreads a little past its edges. */
const PILE_DUST_SPREAD = 1.2;
const PILE_DUST_SEED = 29;
/** Puffs of the cloud hanging over the heap, and their size range. */
const PILE_CLOUD_PUFFS = 5;
const PILE_CLOUD_MIN_RADIUS = 0.12;
const PILE_CLOUD_RADIUS_RANGE = 0.08;
const PILE_CLOUD_SIZE_SALT = 41;
const PILE_CLOUD_X_SALT = 31;
const PILE_CLOUD_Y_SALT = 37;
/** The cloud's puffs spread across the heap, jittered a little. */
const PILE_CLOUD_HALF_SPAN = 0.45;
const PILE_CLOUD_JITTER = 0.08;
/** The cloud hangs this high over the heap, spread over this much height, and billows higher. */
const PILE_CLOUD_Y = -0.25;
const PILE_CLOUD_DEPTH = 0.4;
const PILE_CLOUD_BILLOW_RISE = 0.55;
/** Puffs grow from these sizes to these as they billow. */
const PILE_CLOUD_WIDTH_SETTLED = 1.2;
const PILE_CLOUD_WIDTH_BILLOWED = 1.8;
const PILE_CLOUD_HEIGHT_BILLOWED = 1.6;

/**
 * Paints the collapse from the moment the body gives way.
 *
 * @param fall 0 as the body breaks, 1 settled.
 * @param dust Dust hanging over the pile, 0..1.
 */
export function drawCretinRubble(
  ctx: Ctx,
  view: CretinView,
  variant: CretinVariant,
  fall: number,
  dust: number,
): void {
  const spec = VARIANTS[variant];
  const d: DrawCtx = { view: VIEWS[view], spec, pose: restPose() };
  drawContactShadow(ctx, lerp(PILE_SHADOW_START, PILE_SHADOW_END, fall));
  const parts: Part[] = [];
  for (const chunk of RUBBLE) {
    const t = clamp01((fall - chunk.delay) / (1 - chunk.delay));
    // Gravity: the drop accelerates, a bounce lifts it once on landing.
    const drop = t * t;
    const bounce = hump(clamp01((t - LANDING_START) / LANDING_SPAN)) * LANDING_BOUNCE;
    const x = lerp(chunk.from.x, chunk.to.x, easeInOut(t));
    const y = lerp(chunk.from.y, chunk.to.y, drop) - bounce;
    const rotate = chunk.spin * (1 - t) + chunk.seed;
    if (chunk.kind === 'stone') {
      const pts = stonePolygon({
        seed: chunk.seed,
        cx: x,
        cy: y,
        rx: chunk.r,
        ry: chunk.r * RUBBLE_FLATTEN,
        sides: RUBBLE_SIDES,
        jitter: RUBBLE_JITTER,
        rotate,
      });
      // Two or three values across the heap, so it reads as broken rock rather
      // than a tray of identical tiles.
      const shade = hash2(chunk.seed, RUBBLE_SHADE_SEED);
      parts.push(
        stonePart(
          pts,
          spec,
          chunk.seed,
          shade * RUBBLE_SHADE_RANGE,
          1,
          shade > RUBBLE_LIT_SHARE ? 'light' : 'base',
        ),
      );
      continue;
    }
    const ramp = chunk.kind === 'cloth' ? JACKET : SHIRT;
    // A scrap of tux falls flatter than a stone and settles draped.
    const pts = stonePolygon({
      seed: chunk.seed,
      cx: x,
      cy: y,
      rx: chunk.r * SCRAP_BREADTH,
      ry: chunk.r * lerp(SCRAP_FALLING_DEPTH, SCRAP_SETTLED_DEPTH, t),
      sides: SCRAP_SIDES,
      jitter: SCRAP_JITTER,
      rotate: rotate * SCRAP_SPIN_SHARE,
    });
    parts.push({
      outlined: true,
      trace: (c) => {
        traceSmooth(c, pts);
      },
      paint: (c) => {
        c.fillStyle = ramp.base;
        traceSmooth(c, pts);
        c.fill();
        clipTo(
          c,
          (cc) => {
            traceSmooth(cc, pts);
          },
          () => {
            shadePanel(c, pts, ramp);
          },
        );
      },
    });
  }

  // The head drops with the shoulders it sat on, and lands before the dust
  // settles; hanging back, it floats over the heap.
  const headT = clamp01((fall - HEAD_FALL_DELAY) / HEAD_FALL_SPAN);
  const headAt = {
    x: lerp(HEAD_FROM.x, HEAD_REST.x, headT),
    y:
      lerp(HEAD_FROM.y, HEAD_REST.y, headT * headT) -
      hump(clamp01((headT - HEAD_LANDING_START) / HEAD_LANDING_SPAN)) * HEAD_LANDING_BOUNCE,
  };
  const headPose: CretinPose = { ...restPose(), blink: 1 };
  const headDraw: DrawCtx = { ...d, pose: headPose };
  const frame: HeadFrame = {
    centre: headAt,
    angle: lerp(HEAD_FALL_START_ANGLE, HEAD_REST_ANGLE, headT),
    rx: d.view.profile ? HEAD_HALF_DEPTH : HEAD_HALF_WIDTH[spec.head],
    ry: HEAD_RY,
  };
  const outline = headOutline(headDraw, frame);
  const stone = stonePart(outline, spec, HEAD_SEED, 0, 1);
  parts.push({
    outlined: true,
    trace: stone.trace,
    paint: (c) => {
      stone.paint(c);
      clipTo(
        c,
        (cc) => {
          tracePolygon(cc, outline);
        },
        () => {
          if (view === 'front') paintFace(c, headDraw, frame);
          else if (view === 'side') paintProfileFace(c, headDraw, frame);
          else paintBackOfHead(c, headDraw, frame);
        },
      );
    },
  });
  if (spec.hat)
    parts.push(
      hatPart({ ...headDraw, pose: { ...headPose, hatHop: (1 - headT) * HAT_LANDING_HOP } }, frame),
    );
  if (spec.boa) {
    const drape = BOA_DRAPE.map((p) => ({
      x: lerp(p.fromX, p.toX, headT),
      y: lerp(p.fromY, p.toY, headT * headT),
    }));
    parts.push(boaStrand(drape, BOA_DRAPE_SEED, false));
  }
  if (spec.armband) {
    const band = {
      x: lerp(FALLEN_BAND_X, FALLEN_BAND_X, headT),
      y: lerp(FALLEN_BAND_FROM_Y, FALLEN_BAND_TO_Y, headT * headT),
    };
    const traceBand = (c: Ctx): void => {
      c.beginPath();
      c.ellipse(band.x, band.y, FALLEN_BAND_RX, FALLEN_BAND_RY, FALLEN_BAND_TILT, 0, TWO_PI);
    };
    parts.push({
      outlined: true,
      trace: traceBand,
      paint: (c) => {
        c.fillStyle = MEAT_SHIELDS_ORANGE;
        traceBand(c);
        c.fill();
        c.fillStyle = rgba(ARMBAND_LIGHT, ARMBAND_LIT_ALPHA);
        c.beginPath();
        c.ellipse(
          band.x + FALLEN_BAND_LIT_OFFSET.x,
          band.y + FALLEN_BAND_LIT_OFFSET.y,
          FALLEN_BAND_LIT_RX,
          FALLEN_BAND_LIT_RY,
          FALLEN_BAND_TILT,
          0,
          TWO_PI,
        );
        c.fill();
      },
    });
  }
  compose(ctx, parts);
  drawDust(ctx, dust, PILE_HALF_WIDTH * PILE_DUST_SPREAD, PILE_DUST_SEED);
  if (dust > 0) {
    for (let i = 0; i < PILE_CLOUD_PUFFS; i++) {
      const r = PILE_CLOUD_MIN_RADIUS + PILE_CLOUD_RADIUS_RANGE * hash2(PILE_CLOUD_SIZE_SALT, i);
      // At the break the cloud billows at the height the body stood, masking
      // the moment it comes apart; it sinks and thins as the heap settles.
      const billow = dust * dust;
      fillSoftEllipse(
        ctx,
        lerp(-PILE_CLOUD_HALF_SPAN, PILE_CLOUD_HALF_SPAN, i / (PILE_CLOUD_PUFFS - 1)) +
          signedHash(PILE_CLOUD_X_SALT, i) * PILE_CLOUD_JITTER,
        PILE_CLOUD_Y -
          hash2(PILE_CLOUD_Y_SALT, i) * PILE_CLOUD_DEPTH -
          billow * PILE_CLOUD_BILLOW_RISE,
        r * lerp(PILE_CLOUD_WIDTH_SETTLED, PILE_CLOUD_WIDTH_BILLOWED, billow),
        r * lerp(1, PILE_CLOUD_HEIGHT_BILLOWED, billow),
        DUST_COLOR,
        PILE_DUST_ALPHA * dust,
      );
    }
  }
}
