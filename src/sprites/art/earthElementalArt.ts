/**
 * Drawing engine for the Earth Elementals — seven-foot sapient rock monsters.
 * Two of them are hired bodyguards in working gear: Crush, a quarryman in a
 * leather harness with rope-wrapped forearms, and Hammer Hands, a smith in a
 * heavy apron, iron bracers and a sooty headscarf.
 *
 * An Earth Elemental has to read as two things at once at a 32 px tile: **rock**, and
 * **dressed**. The hires show bare stone from the belt up, chiselled into
 * slabs, with their gear strapped over it. The
 * silhouette does the heavy lifting: a blocky faceted head sunk between the
 * shoulders, fists and feet that are chiselled stones rather than hands and
 * shoes, and shards breaking up through the shoulders. Every
 * stone is a jittered polygon with a hard lit facet and a hard shadow facet;
 * nothing stone is a smooth curve or a gradient, because the moment a head
 * becomes an oval the figure is a grey man in a costume.
 *
 * Size is read by head count, not by drawn height: a big figure drawn at a
 * game character's five heads reads as a doll. An Earth Elemental is seven heads tall on
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
 * {@link drawEarthElemental}. Light comes from the upper left, like every other figure.
 */

import { type Pt, clamp01, deg, easeInOut, hump, lerp, mix, rgba } from './bipedArt';
import { fillSoftEllipse } from './softShade';
import { MERCENARY_ARMBAND } from '../mercenaryArmband';

type Ctx = CanvasRenderingContext2D;

export const TWO_PI = Math.PI * 2;

// ── Variants and palette ─────────────────────────────────────────────────────

/** The two Earth Elementals. */
export type EarthElementalVariant = 'crush' | 'hammer_hands';

export const EARTH_ELEMENTAL_VARIANTS: readonly EarthElementalVariant[] = ['crush', 'hammer_hands'];

/** Which views a figure is painted from. */
export type EarthElementalView = 'front' | 'side' | 'away';

interface StoneRamp {
  readonly deep: string;
  readonly shadow: string;
  readonly base: string;
  readonly light: string;
  readonly hilite: string;
}

/** Head silhouettes: the cheapest way to tell two grey bodies apart. */
type HeadShape = 'block' | 'round';

type StoneGrain = 'none' | 'strata';

/**
 * What an Earth Elemental wears: `quarryman` (a leather harness and wide belt
 * over bare stone, rope round the forearms) or `smith` (a heavy apron, iron
 * bracers and a headscarf), the two hires' working gear. Both are hires, so
 * both wear the mercenary armband that tells a hire from a hostile.
 */
type EarthElementalOutfit = 'quarryman' | 'smith';

interface VariantSpec {
  readonly stone: StoneRamp;
  /**
   * The rock's grain: sandstone's level strata, or none. Texture is what separates stone from grey skin at a glance; a smooth
   * tone, however faceted, reads as flesh.
   */
  readonly grain: StoneGrain;
  readonly head: HeadShape;
  readonly outfit: EarthElementalOutfit;
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

const VARIANTS: Record<EarthElementalVariant, VariantSpec> = {
  crush: {
    stone: COOL_GREY,
    grain: 'none',
    head: 'block',
    outfit: 'quarryman',
  },
  hammer_hands: {
    stone: OCHRE_SANDSTONE,
    grain: 'strata',
    head: 'round',
    outfit: 'smith',
  },
};

interface ClothRamp {
  readonly deep: string;
  readonly shadow: string;
  readonly base: string;
  readonly light: string;
  readonly rim: string;
}

/** Crush's harness and belt: a mid tan, a full step off his cool grey in hue and value. */
const HARNESS_LEATHER: ClothRamp = {
  deep: '#2b190d',
  shadow: '#4c2f1b',
  base: '#7a5131',
  light: '#9e7149',
  rim: '#c69b6e',
};

/** The hemp rope round Crush's forearms: paler and yellower than the harness. */
const ROPE: ClothRamp = {
  deep: '#2b2213',
  shadow: '#6e5c3a',
  base: '#968157',
  light: '#b29e73',
  rim: '#cdbc93',
};

/** Hammer Hands' apron: a dark oxblood hide, well under his ochre so the bib reads as a shape. */
const APRON_LEATHER: ClothRamp = {
  deep: '#1c100b',
  shadow: '#341f17',
  base: '#553528',
  light: '#744e3b',
  rim: '#9c705a',
};

/** Forged iron for his bracers: cold blue-grey against the warm sandstone, a step above his dark trousers. */
const IRON: ClothRamp = {
  deep: '#1c1f24',
  shadow: '#3a4048',
  base: '#5c646e',
  light: '#8a94a0',
  rim: '#c0c8d2',
};

/**
 * The soot-dark headscarf: a sooty grey-brown, a step above the outline, so
 * its folds and hem show and it reads as cloth rather than black hair.
 */
const SOOT_CLOTH: ClothRamp = {
  deep: '#24201e',
  shadow: '#3a3330',
  base: '#524945',
  light: '#6e645e',
  rim: '#9a8e85',
};

/** Work trousers: drab olive canvas for the quarryman, soot-stained brown-grey for the smith. */
const QUARRY_TROUSERS: ClothRamp = {
  deep: '#19160f',
  shadow: '#29241b',
  base: '#3d372a',
  light: '#575040',
  rim: '#7c7462',
};

const FORGE_TROUSERS: ClothRamp = {
  deep: '#161412',
  shadow: '#26221d',
  base: '#3b362f',
  light: '#544d44',
  rim: '#7a7166',
};

const TROUSERS_BY_OUTFIT: Record<EarthElementalOutfit, ClothRamp> = {
  quarryman: QUARRY_TROUSERS,
  smith: FORGE_TROUSERS,
};

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
 * brown depth. The human crawler's Protective Shell is blue, or at full power a saturated
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
 * Crown of the head to the sole, in tiles. The human crawler stands about 1.46
 * tiles on screen, so this is a head and a half taller than him — a seven-foot figure,
 * pushed a little further so it reads as towering at 32 px.
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
 * wide and short in the leg, and long legs in trousers read as a tall man.
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

const FORE_SLEEVE_HALF = 0.088;
const DELTOID_RADIUS = 0.13;
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
  readonly id: EarthElementalView;
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

const VIEWS: Record<EarthElementalView, ViewSpec> = {
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

export interface EarthElementalArmPose {
  /** Fore/aft rotation from straight down, radians; positive drives the fist forward. */
  readonly swing: number;
  /** Abduction away from the ribs, radians; 90° holds the upper arm out level. */
  readonly flare: number;
  /** Elbow fold, radians; 0 is a straight arm. */
  readonly bend: number;
  /** 0 an open slab hand, 1 a clenched fist. */
  readonly clench: number;
}

export interface EarthElementalLegPose {
  /** Fore/aft travel of the ankle from its hip root, tiles. */
  readonly fore: number;
  /** Height of the sole above the ground, tiles. */
  readonly lift: number;
  /** Lateral travel of the ankle away from its hip root, tiles. */
  readonly splay: number;
}

export interface EarthElementalPose {
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
  readonly armL: EarthElementalArmPose;
  readonly armR: EarthElementalArmPose;
  readonly legL: EarthElementalLegPose;
  readonly legR: EarthElementalLegPose;
  /** The cast glyph's strength, 0..1. */
  readonly glyph: number;
  /** Dust at the feet, 0..1. */
  readonly dust: number;
  /** The burst at the right fist as a punch lands, 0..1. */
  readonly impact: number;
  /** Fissures opening across the stone, 0..1 (the death). */
  readonly cracks: number;
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
export const REST_ARM: EarthElementalArmPose = {
  swing: 0,
  flare: REST_ARM_FLARE,
  bend: REST_ARM_BEND,
  clench: REST_FIST_CLENCH,
};
export const REST_LEG: EarthElementalLegPose = { fore: 0, lift: 0, splay: 0 };

export function restPose(): EarthElementalPose {
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

function hipHeight(pose: EarthElementalPose): number {
  return HIP_Y + pose.drop;
}

/**
 * Carries a point authored on the upright body into the posed body: twisted
 * about the spine (in proportion to its height above the hips, so the pelvis
 * stays square while the shoulders turn), tilted and leant about the hips, then
 * dropped with them.
 */
function posed(pose: EarthElementalPose, p: V3): V3 {
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
function upperArmDirection(arm: EarthElementalArmPose, side: number): [number, number, number] {
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
 * toward the forward hint made perpendicular to it. Folding in the swing plane
 * instead (adding the bend to the swing) folds an arm raised overhead backward.
 */
function forearmDirection(arm: EarthElementalArmPose, side: number): [number, number, number] {
  const [ux, uy, uz] = upperArmDirection(arm, side);
  const along = FOLD_HINT[0] * ux + FOLD_HINT[1] * uy + FOLD_HINT[2] * uz;
  const [fx, fy, fz] = normalise(
    FOLD_HINT[0] - along * ux,
    FOLD_HINT[1] - along * uy,
    FOLD_HINT[2] - along * uz,
  );
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

export function earthElementalArmChain(pose: EarthElementalPose, side: number): ArmChain3 {
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

export function earthElementalLegChain(pose: EarthElementalPose, side: number): LegChain3 {
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
 * Sandstone's level bands, each a dark line with a
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
  const slope = STRATA_MAX_SLOPE * signedHash(seed, GRAIN_SLOPE_SALT);
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
  readonly pose: EarthElementalPose;
}

// ── Legs and feet ────────────────────────────────────────────────────────────

/** How much of a head-on leg's knee depth becomes screen height. */
const KNEE_DEPTH_SHARE = 0.5;
/** The thigh's lower end is a touch wider than the shin it meets, so the knee reads as a joint. */
const KNEE_FLARE = 1.05;
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
  const chain = earthElementalLegChain(d.pose, side);
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
  const cloth = TROUSERS_BY_OUTFIT[d.spec.outfit];
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
            shadeTube(ctx, leg.hip, leg.knee, thighHalf, cloth, receded);
          },
        );
        clipTo(
          ctx,
          (c) => {
            c.beginPath();
            addPolygon(c, bandPolygon(leg.knee, leg.ankle, shinHalf, hemHalf));
          },
          () => {
            shadeTube(ctx, leg.knee, leg.ankle, shinHalf, cloth, receded);
          },
        );
        ctx.strokeStyle = rgba(cloth.deep, KNEE_CREASE_ALPHA);
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
 * The torso's front silhouette, one side, from the collar round to the hem, as
 * (lateral, height). Mirrored across the spine for the other side.
 *
 * Shoulders nearly half the figure's height across, a big barrel chest, and a
 * waist barely narrower: a boulder. Hips must never be wider than the
 * shoulders or the figure reads as a barrel.
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
 * The torso edge-on, facing +fore: from the nape down the hunched back to the
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

function torsoOutline(d: DrawCtx): Pt[] {
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

/** How far forward of the spine the shirt front sits; what makes a twist slide the V across. */
const CHEST_FRONT_DEPTH = 0.3;

function unhandledOutfit(outfit: never): never {
  throw new Error(`Unhandled Earth Elemental outfit: ${String(outfit)}`);
}

// ── The bare stone torso ─────────────────────────────────────────────────────

/**
 * The slabs the bare torso is cut into, as polygons in (across, height) on the
 * chest or back face, or (fore, height) on the spine plane edge-on. Hard-faceted
 * blocks with dark seams between them are what keep a bare stone chest from
 * reading as grey skin. Neighbours share their edges, and no seam runs straight
 * down the spine: a gap or a straight centre seam reads as a quilted coat.
 */
type SlabQuad = readonly (readonly [number, number])[];

const FRONT_SLABS: readonly SlabQuad[] = [
  [
    [-0.46, -1.6],
    [0.0, -1.66],
    [0.03, -1.24],
    [-0.4, -1.18],
  ],
  [
    [0.0, -1.66],
    [0.46, -1.6],
    [0.4, -1.2],
    [0.03, -1.24],
  ],
  [
    [-0.4, -1.18],
    [0.03, -1.24],
    [0.12, -0.94],
    [-0.36, -0.92],
  ],
  [
    [0.03, -1.24],
    [0.4, -1.2],
    [0.36, -0.96],
    [0.12, -0.94],
  ],
  [
    [-0.36, -0.92],
    [0.12, -0.94],
    [0.36, -0.96],
    [0.36, -0.66],
    [-0.36, -0.66],
  ],
];

const BACK_SLABS: readonly SlabQuad[] = [
  [
    [-0.47, -1.58],
    [-0.1, -1.68],
    [-0.04, -1.4],
    [-0.44, -1.3],
  ],
  [
    [-0.1, -1.68],
    [0.47, -1.58],
    [0.45, -1.44],
    [0.16, -1.36],
    [-0.04, -1.4],
  ],
  [
    [-0.44, -1.3],
    [-0.04, -1.4],
    [0.06, -1.08],
    [-0.41, -1.02],
  ],
  [
    [-0.04, -1.4],
    [0.16, -1.36],
    [0.45, -1.44],
    [0.42, -1.1],
    [0.06, -1.08],
  ],
  [
    [-0.41, -1.02],
    [0.06, -1.08],
    [-0.06, -0.66],
    [-0.37, -0.66],
  ],
  [
    [0.06, -1.08],
    [0.42, -1.1],
    [0.37, -0.66],
    [-0.06, -0.66],
  ],
];

const PROFILE_SLABS: readonly SlabQuad[] = [
  [
    [0.04, -1.68],
    [0.36, -1.52],
    [0.43, -1.22],
    [0.04, -1.17],
  ],
  [
    [-0.04, -1.69],
    [-0.31, -1.53],
    [-0.33, -1.17],
    [-0.04, -1.2],
  ],
  [
    [0.02, -1.13],
    [0.41, -1.08],
    [0.33, -0.7],
    [0.02, -0.72],
  ],
  [
    [-0.02, -1.15],
    [-0.3, -1.12],
    [-0.27, -0.7],
    [-0.02, -0.72],
  ],
];

const TORSO_SEED = 401;
const SLAB_SEED_STEP = 13;
/** How far a slab's fill moves toward its ramp's light or shadow step, between these shares: no two blocks are one tone. */
const SLAB_TONE_RANGE = 0.6;
const SLAB_MIN_TONE_SHIFT = 0.25;
const SLABS_PER_COURSE = 2;
/** How far each corner of the bare torso's silhouette is knocked in or out, tiles: a chipped block, not a box. */
const TORSO_CHIP = 0.022;
/** Weathering pits across a slab: how many, how big, and how dark. */
const SLAB_PITS = 5;
const SLAB_PIT_RADIUS = 0.011;
const SLAB_PIT_ALPHA = 0.55;
/** Pits stay inside this share of a slab, from its centre to its edges. */
const SLAB_PIT_REACH = 0.7;
const SLAB_PIT_SALT = 31;
/** A slab on the far side of the body from the light sits up to this far into shadow. */
const SLAB_TURN_SHADE = 0.45;
const SLAB_SEAM_ALPHA = 0.75;
const SLAB_CRACK_SALT = 23;
/** How far in from each edge a slab's chiselled bevel runs, as a share of edge-to-centre. */
const SLAB_BEVEL_SHARE = 0.12;

/** Small dark pits scattered over a slab, so its face reads as weathered rock rather than a smooth board. */
function paintPits(ctx: Ctx, pts: readonly Pt[], ramp: StoneRamp, seed: number): void {
  const centre = centroidOf(pts);
  ctx.fillStyle = rgba(ramp.deep, SLAB_PIT_ALPHA);
  for (let i = 0; i < SLAB_PITS; i++) {
    const corner = pts[i % pts.length];
    const reach = hash2(seed + i, SLAB_PIT_SALT) * SLAB_PIT_REACH;
    const toward = pts[(i + 2) % pts.length];
    const along = hash2(seed + i, SLAB_PIT_SALT + 1);
    const edgePoint = { x: lerp(corner.x, toward.x, along), y: lerp(corner.y, toward.y, along) };
    ctx.beginPath();
    ctx.arc(
      lerp(centre.x, edgePoint.x, reach),
      lerp(centre.y, edgePoint.y, reach),
      SLAB_PIT_RADIUS,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
}

/** How strongly a slab's lit and shadowed planes are washed over its fill. */
const SLAB_LIT_PLANE_ALPHA = 0.32;
const SLAB_SHADOW_PLANE_ALPHA = 0.3;

/**
 * Splits a slab across the light into two hard planes, the half facing the
 * light washed toward its light step and the far half toward its deep step.
 * A flat-toned block reads as a quilted panel; a block with a lit face and a
 * shadow face reads as chiselled rock.
 */
function paintSlabPlanes(ctx: Ctx, pts: readonly Pt[], ramp: StoneRamp): void {
  if (pts.length < 3) return;
  const centre = centroidOf(pts);
  const across = { x: -LIGHT.y, y: LIGHT.x };
  const along = (p: Pt, axis: Pt): number => (p.x - centre.x) * axis.x + (p.y - centre.y) * axis.y;
  let first = 0;
  let last = 0;
  pts.forEach((p, i) => {
    if (along(p, across) > along(pts[first], across)) first = i;
    if (along(p, across) < along(pts[last], across)) last = i;
  });
  const chain = (from: number, to: number): Pt[] => {
    const out: Pt[] = [];
    for (let i = from; ; i = (i + 1) % pts.length) {
      out.push(pts[i]);
      if (i === to) break;
    }
    return out;
  };
  const halves = [chain(first, last), chain(last, first)];
  for (const half of halves) {
    if (half.length < 3) continue;
    const facesLight = along(centroidOf(half), LIGHT) > 0;
    ctx.fillStyle = facesLight
      ? rgba(ramp.light, SLAB_LIT_PLANE_ALPHA)
      : rgba(ramp.deep, SLAB_SHADOW_PLANE_ALPHA);
    tracePolygon(ctx, half);
    ctx.fill();
  }
}

/**
 * A dressed block's chiselled edge: a narrow bevel round a flat face, lit
 * along the edges that face the light and shadowed along the rest. Facets
 * meeting at the centre of a big flat slab read as quilting.
 */
function paintBevel(ctx: Ctx, pts: readonly Pt[], ramp: StoneRamp, receded: number): void {
  const centre = centroidOf(pts);
  const inset = (p: Pt): Pt => ({
    x: lerp(p.x, centre.x, SLAB_BEVEL_SHARE),
    y: lerp(p.y, centre.y, SLAB_BEVEL_SHARE),
  });
  const lit = mix(ramp.light, ramp.shadow, receded);
  const dark = mix(ramp.shadow, ramp.deep, receded);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const mx = (a.x + b.x) / 2 - centre.x;
    const my = (a.y + b.y) / 2 - centre.y;
    const facesLight = mx * LIGHT.x + my * LIGHT.y > 0;
    ctx.fillStyle = facesLight ? rgba(lit, FACET_LIGHT_ALPHA) : rgba(dark, FACET_SHADOW_ALPHA);
    tracePolygon(ctx, [a, b, inset(b), inset(a)]);
    ctx.fill();
  }
}
const SLAB_SEAM_WIDTH = 0.018;

/** How far behind the spine the torso's back surface sits. */
const BACK_DEPTH = -0.3;

function slabPoints(d: DrawCtx, quad: SlabQuad): Pt[] {
  return quad.map(([a, y]) => {
    if (d.view.profile) return project(d.view, posed(d.pose, v3(0, y, a)));
    const depth = d.view.id === 'away' ? BACK_DEPTH : CHEST_FRONT_DEPTH;
    return project(d.view, posed(d.pose, v3(a, y, depth)));
  });
}

function slabsFor(view: ViewSpec): readonly SlabQuad[] {
  if (view.profile) return PROFILE_SLABS;
  return view.id === 'away' ? BACK_SLABS : FRONT_SLABS;
}

function boundsOf(pts: readonly Pt[]): { minX: number; maxX: number; minY: number; maxY: number } {
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
  return { minX, maxX, minY, maxY };
}

/**
 * The hires' bare torso: the shared silhouette cut as a chiselled polygon,
 * filled in stone and split into hard-faceted slabs. Each slab sits further
 * into shadow the further it is round the body from the light, so the chest
 * turns in steps, never in a gradient. Their gear is painted over it.
 */
function stoneTorsoPart(d: DrawCtx): Part {
  const outline = torsoOutline(d).map((p, i) => ({
    x: p.x + signedHash(TORSO_SEED, i) * TORSO_CHIP,
    y: p.y + signedHash(TORSO_SEED + 1, i) * TORSO_CHIP,
  }));
  const trace = (ctx: Ctx): void => {
    tracePolygon(ctx, outline);
  };
  return {
    outlined: true,
    trace,
    paint: (ctx) => {
      clipTo(ctx, trace, () => {
        const ramp = d.spec.stone;
        ctx.fillStyle = ramp.shadow;
        trace(ctx);
        ctx.fill();
        paintGrain(ctx, outline, d.spec, TORSO_SEED);
        const body = boundsOf(outline);
        const centreX = (body.minX + body.maxX) / 2;
        const halfWidth = Math.max((body.maxX - body.minX) / 2, 1e-6);
        slabsFor(d.view).forEach((quad, i) => {
          const seed = TORSO_SEED + SLAB_SEED_STEP * (i + 1);
          const pts = slabPoints(d, quad);
          const turn = clamp01((centroidOf(pts).x - centreX) / halfWidth);
          // Neighbouring slabs alternate lighter and darker in a checker (the
          // slab lists run in left/right pairs, course by course), so the
          // blocks always spread in value; one even tone across the back reads
          // as a quilted coat.
          const course = Math.floor(i / SLABS_PER_COURSE);
          const toneSign = (i + course) % 2 === 0 ? 1 : -1;
          const toneShift = toneSign * lerp(SLAB_MIN_TONE_SHIFT, SLAB_TONE_RANGE, hash2(seed, 1));
          const tone =
            toneShift >= 0
              ? mix(ramp.base, ramp.light, toneShift)
              : mix(ramp.base, ramp.shadow, -toneShift);
          ctx.fillStyle = mix(tone, ramp.shadow, turn * SLAB_TURN_SHADE);
          tracePolygon(ctx, pts);
          ctx.fill();
          // No grain on the slabs: strata running edge to edge across big
          // flat blocks read as planks or a crate.
          paintPits(ctx, pts, ramp, seed);
          paintSlabPlanes(ctx, pts, ramp);
          paintBevel(ctx, pts, ramp, turn * SLAB_TURN_SHADE);
          paintCrack(
            ctx,
            pts[Math.floor(hash2(seed, SLAB_CRACK_SALT) * pts.length)],
            centroidOf(pts),
            seed,
            STONE_CRACK_WIDTH,
            ramp,
          );
          ctx.strokeStyle = rgba(ramp.deep, SLAB_SEAM_ALPHA);
          ctx.lineWidth = SLAB_SEAM_WIDTH;
          ctx.lineJoin = 'round';
          tracePolygon(ctx, pts);
          ctx.stroke();
        });
        paintBedding(ctx, d, body);
        paintTorsoGear(ctx, d);
      });
    },
  };
}

/** The trouser waist runs up under the belt, past the torso's hem, so no stone shows between them. */
const WAIST_REACH = 0.6;
const WAIST_HEM_OVERLAP = 0.06;

function paintTrouserWaist(ctx: Ctx, d: DrawCtx): void {
  const top = BELT_FOOT_Y;
  const foot = JACKET_HEM_Y + WAIST_HEM_OVERLAP;
  const corners = d.view.profile
    ? [
        onSpinePlane(d, -WAIST_REACH, top),
        onSpinePlane(d, WAIST_REACH, top),
        onSpinePlane(d, WAIST_REACH, foot),
        onSpinePlane(d, -WAIST_REACH, foot),
      ]
    : [
        onFace(d, -WAIST_REACH, top),
        onFace(d, WAIST_REACH, top),
        onFace(d, WAIST_REACH, foot),
        onFace(d, -WAIST_REACH, foot),
      ];
  ctx.fillStyle = TROUSERS_BY_OUTFIT[d.spec.outfit].shadow;
  tracePolygon(ctx, corners);
  ctx.fill();
}

/**
 * Sandstone's bedding: a few wavy dark bands running right across the bare
 * torso, through the slab seams. Without them a sandstone body cut into
 * blocks reads as a quilted coat; slate and granite have no bedding.
 */
const BEDDING_HEIGHTS: readonly number[] = [-1.47, -1.22, -0.98];
const BEDDING_SEED = 457;
const BEDDING_WIDTH = 0.026;
const BEDDING_ALPHA = 0.7;
const BEDDING_LIP_ALPHA = 0.35;
/** How far the bands run past the torso's edges, tiles; the clip trims them. */
const BEDDING_OVERRUN = 0.1;

function paintBedding(ctx: Ctx, d: DrawCtx, body: { minX: number; maxX: number }): void {
  if (d.spec.grain !== 'strata') return;
  const ramp = d.spec.stone;
  BEDDING_HEIGHTS.forEach((height, i) => {
    const centre = d.view.profile ? onSpinePlane(d, 0, height) : onFace(d, 0, height);
    const from = { x: body.minX - BEDDING_OVERRUN, y: centre.y };
    const to = { x: body.maxX + BEDDING_OVERRUN, y: centre.y };
    paintCrack(ctx, from, to, BEDDING_SEED + i, BEDDING_WIDTH, {
      ...ramp,
      deep: mix(ramp.shadow, ramp.deep, BEDDING_ALPHA),
      hilite: mix(ramp.light, ramp.hilite, BEDDING_LIP_ALPHA),
    });
  });
}

function paintTorsoGear(ctx: Ctx, d: DrawCtx): void {
  switch (d.spec.outfit) {
    case 'quarryman':
      paintTrouserWaist(ctx, d);
      paintHarness(ctx, d);
      return;
    case 'smith':
      paintTrouserWaist(ctx, d);
      paintApronStraps(ctx, d);
      return;
    default:
      unhandledOutfit(d.spec.outfit);
  }
}

// ── Straps ───────────────────────────────────────────────────────────────────

/** A strap's dark edge stands this far past its face either side, tiles. */
const STRAP_EDGE = 0.012;
const STRAP_LIT_ALPHA = 0.7;
/** The lit line along a strap's upper edge, as a share of its width. */
const STRAP_LIT_WIDTH_SHARE = 0.3;
const STRAP_LIT_OFFSET_SHARE = 0.3;

/**
 * A leather strap along a path: a dark edge, the face, and a lit line along
 * its upper side, so it reads as a band lying on the stone rather than a stripe
 * painted on it.
 */
function paintStrap(ctx: Ctx, path: readonly Pt[], width: number, ramp: ClothRamp): void {
  if (path.length < 2) return;
  const trace = (dy: number): void => {
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y + dy);
    for (let i = 1; i < path.length; i++) ctx.lineTo(path[i].x, path[i].y + dy);
  };
  ctx.lineCap = 'butt';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = ramp.deep;
  ctx.lineWidth = width + STRAP_EDGE * 2;
  trace(0);
  ctx.stroke();
  ctx.strokeStyle = ramp.base;
  ctx.lineWidth = width;
  trace(0);
  ctx.stroke();
  ctx.strokeStyle = rgba(ramp.light, STRAP_LIT_ALPHA);
  ctx.lineWidth = width * STRAP_LIT_WIDTH_SHARE;
  trace(-width * STRAP_LIT_OFFSET_SHARE);
  ctx.stroke();
}

/** An iron ring where straps meet: a dark disc with a lit arc on its upper left. */
const RING_RADIUS = 0.042;
const RING_HOLE_SHARE = 0.45;
const RING_LIT_FROM = Math.PI * 0.9;
const RING_LIT_TO = Math.PI * 1.6;
const RING_LIT_WIDTH = 0.014;

function paintRing(ctx: Ctx, at: Pt): void {
  ctx.fillStyle = IRON.deep;
  ctx.beginPath();
  ctx.arc(at.x, at.y, RING_RADIUS, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = IRON.base;
  ctx.beginPath();
  ctx.arc(at.x, at.y, RING_RADIUS - STRAP_EDGE, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = IRON.deep;
  ctx.beginPath();
  ctx.arc(at.x, at.y, RING_RADIUS * RING_HOLE_SHARE, 0, TWO_PI);
  ctx.fill();
  ctx.strokeStyle = IRON.rim;
  ctx.lineWidth = RING_LIT_WIDTH;
  ctx.beginPath();
  ctx.arc(at.x, at.y, RING_RADIUS - STRAP_EDGE, RING_LIT_FROM, RING_LIT_TO);
  ctx.stroke();
}

function onFace(d: DrawCtx, lat: number, y: number): Pt {
  const depth = d.view.id === 'away' ? BACK_DEPTH : CHEST_FRONT_DEPTH;
  return project(d.view, posed(d.pose, v3(lat, y, depth)));
}

function onSpinePlane(d: DrawCtx, fore: number, y: number): Pt {
  return project(d.view, posed(d.pose, v3(0, y, fore)));
}

/**
 * Crush's harness: two straps over the shoulders crossing at an iron ring on
 * the breastbone, and again between the shoulder blades, each running down to
 * the belt on the far side.
 */
const HARNESS_STRAP_WIDTH = 0.075;
const HARNESS_SHOULDER: readonly [number, number] = [0.3, -1.67];
const HARNESS_CROSS_Y = -1.3;
const HARNESS_FOOT: readonly [number, number] = [0.34, -0.84];
/**
 * Edge-on the cross shows as one strap running diagonally over the flank,
 * from behind the shoulder down to the front of the belt: two straps edge-on
 * read as suspenders.
 */
const HARNESS_PROFILE_STRAPS: readonly (readonly (readonly [number, number])[])[] = [
  [
    [-0.22, -1.64],
    [0.06, -1.28],
    [0.3, -0.84],
  ],
];
const HARNESS_PROFILE_RING_AT = 1;

function paintHarness(ctx: Ctx, d: DrawCtx): void {
  if (d.view.profile) {
    for (const strap of HARNESS_PROFILE_STRAPS) {
      const path = strap.map(([fore, y]) => onSpinePlane(d, fore, y));
      paintStrap(ctx, path, HARNESS_STRAP_WIDTH, HARNESS_LEATHER);
      paintRing(ctx, path[HARNESS_PROFILE_RING_AT]);
    }
    return;
  }
  const cross = onFace(d, 0, HARNESS_CROSS_Y);
  for (const side of [-1, 1]) {
    paintStrap(
      ctx,
      [
        onFace(d, HARNESS_SHOULDER[0] * side, HARNESS_SHOULDER[1]),
        cross,
        onFace(d, -HARNESS_FOOT[0] * side, HARNESS_FOOT[1]),
      ],
      HARNESS_STRAP_WIDTH,
      HARNESS_LEATHER,
    );
  }
  paintRing(ctx, cross);
}

/**
 * The apron's straps over bare stone: a loop round the back of the neck from
 * the bib's corners. From behind the loop is under the scarf's tails and only
 * the waist tie shows: straps down the back read as suspenders or as Crush's
 * harness, and a loop across the nape as a mouth. The bib itself is its own
 * part, over the legs.
 */
const APRON_STRAP_WIDTH = 0.045;
const APRON_NECK_STRAP: readonly (readonly [number, number])[] = [
  [0.15, -1.49],
  [0.19, -1.62],
  [0.2, -1.74],
];
const APRON_PROFILE_NECK_STRAP: readonly (readonly [number, number])[] = [
  [0.33, -1.48],
  [0.18, -1.62],
  [-0.02, -1.72],
];
/** The waist tie's knot on the belt behind, and where its two ends hang to. */
const APRON_TIE_KNOT: readonly [number, number] = [0, -0.74];
const APRON_TIE_ENDS: readonly (readonly [number, number])[] = [
  [-0.09, -0.56],
  [0.07, -0.58],
];

function paintApronStraps(ctx: Ctx, d: DrawCtx): void {
  if (d.view.profile) {
    paintStrap(
      ctx,
      APRON_PROFILE_NECK_STRAP.map(([fore, y]) => onSpinePlane(d, fore, y)),
      APRON_STRAP_WIDTH,
      APRON_LEATHER,
    );
    return;
  }
  if (d.view.id === 'away') return;
  for (const side of [-1, 1]) {
    paintStrap(
      ctx,
      APRON_NECK_STRAP.map(([lat, y]) => onFace(d, lat * side, y)),
      APRON_STRAP_WIDTH,
      APRON_LEATHER,
    );
  }
}

/**
 * The apron's waist tie from behind: two leather ends hanging from a knot on
 * the belt. Its own part over the belt, since the torso is painted under it.
 */
function apronTiePart(d: DrawCtx): Part | null {
  if (d.view.id !== 'away') return null;
  const knot = onFace(d, APRON_TIE_KNOT[0], APRON_TIE_KNOT[1]);
  const ends = APRON_TIE_ENDS.map(([lat, y]) => onFace(d, lat, y));
  return {
    outlined: false,
    trace: (ctx) => {
      ctx.beginPath();
    },
    paint: (ctx) => {
      for (const end of ends) paintStrap(ctx, [knot, end], APRON_STRAP_WIDTH, APRON_LEATHER);
      paintRing(ctx, knot);
    },
  };
}

// ── Belt ─────────────────────────────────────────────────────────────────────

/**
 * A belt's lower edge sits just above the hips, so the whole belt leans with
 * the torso: an edge below them stays put while the top leans, and the belt
 * shears out of the body.
 */
const BELT_HIP_CLEARANCE = 0.01;
const BELT_FOOT_Y = HIP_Y - BELT_HIP_CLEARANCE;
/** Each working outfit's belt: its top and foot, and the leather it is cut from. */
const BELTS: Record<EarthElementalOutfit, { top: number; foot: number; ramp: ClothRamp }> = {
  quarryman: { top: -0.86, foot: BELT_FOOT_Y, ramp: HARNESS_LEATHER },
  smith: { top: -0.8, foot: BELT_FOOT_Y, ramp: APRON_LEATHER },
};
/** The belt stands a touch proud of the torso either side, so it reads as wrapped round it. */
const BELT_HALF_WIDTH = 0.395;
const BELT_PROFILE_BACK = -0.29;
const BELT_PROFILE_FRONT = 0.34;
const BELT_EDGE_ALPHA = 0.8;
const BELT_EDGE_WIDTH = 0.014;
const BUCKLE_HALF = 0.06;
const BUCKLE_FRAME = 0.018;

function beltPart(d: DrawCtx, outfit: EarthElementalOutfit): Part {
  const belt = BELTS[outfit];
  const corners = d.view.profile
    ? [
        onSpinePlane(d, BELT_PROFILE_BACK, belt.top),
        onSpinePlane(d, BELT_PROFILE_FRONT, belt.top),
        onSpinePlane(d, BELT_PROFILE_FRONT, belt.foot),
        onSpinePlane(d, BELT_PROFILE_BACK, belt.foot),
      ]
    : [
        project(d.view, posed(d.pose, v3(-BELT_HALF_WIDTH, belt.top, 0))),
        project(d.view, posed(d.pose, v3(BELT_HALF_WIDTH, belt.top, 0))),
        project(d.view, posed(d.pose, v3(BELT_HALF_WIDTH, belt.foot, 0))),
        project(d.view, posed(d.pose, v3(-BELT_HALF_WIDTH, belt.foot, 0))),
      ];
  const trace = (ctx: Ctx): void => {
    tracePolygon(ctx, corners);
  };
  return {
    outlined: true,
    trace,
    paint: (ctx) => {
      clipTo(ctx, trace, () => {
        shadePanel(ctx, corners, belt.ramp);
        rimStroke(ctx, corners[0], corners[1], belt.ramp.rim, BELT_EDGE_ALPHA, BELT_EDGE_WIDTH);
        rimStroke(ctx, corners[3], corners[2], belt.ramp.deep, BELT_EDGE_ALPHA, BELT_EDGE_WIDTH);
        if (outfit !== 'quarryman' || d.view.id === 'away') return;
        // Edge-on the buckle sits just inside the belt's front end, not astride it.
        const centre = d.view.profile
          ? onSpinePlane(d, BELT_PROFILE_FRONT - BUCKLE_HALF, (belt.top + belt.foot) / 2)
          : onFace(d, 0, (belt.top + belt.foot) / 2);
        ctx.fillStyle = IRON.light;
        ctx.fillRect(
          centre.x - BUCKLE_HALF,
          centre.y - BUCKLE_HALF,
          BUCKLE_HALF * 2,
          BUCKLE_HALF * 2,
        );
        ctx.fillStyle = belt.ramp.shadow;
        ctx.fillRect(
          centre.x - BUCKLE_HALF + BUCKLE_FRAME,
          centre.y - BUCKLE_HALF + BUCKLE_FRAME,
          (BUCKLE_HALF - BUCKLE_FRAME) * 2,
          (BUCKLE_HALF - BUCKLE_FRAME) * 2,
        );
      });
    },
  };
}

// ── The smith's apron ────────────────────────────────────────────────────────

/**
 * The apron head-on, as (across, height): bib and waist, down the figure's
 * right then up its left. The skirt's hem corners follow the knees and are
 * added per pose.
 */
const APRON_FRONT_RIGHT: SlabQuad = [
  [-0.16, -1.5],
  [0.16, -1.5],
  [0.21, -1.28],
  [0.31, -0.96],
  [0.34, -0.66],
];
const APRON_FRONT_LEFT: SlabQuad = [
  [-0.34, -0.66],
  [-0.31, -0.96],
  [-0.21, -1.28],
];
const APRON_HEM_HALF = 0.36;
/** The apron sits just proud of the chest face. */
const APRON_PROUD = 0.03;
/** Edge-on: the bib lies on the chest; its outer and inner faces, as (fore, height). */
/** Edge-on the bib lies flat on the chest, barely proud of it. */
const APRON_PROFILE_OUTER: SlabQuad = [
  [0.39, -1.5],
  [0.445, -1.28],
  [0.415, -1.06],
  [0.34, -0.8],
  [0.33, -0.62],
];
/** The inner face sits inside the torso, so the bib lies on the chest with no gap behind it. */
const APRON_PROFILE_INNER: SlabQuad = [
  [0.22, -0.62],
  [0.28, -0.8],
  [0.3, -1.06],
  [0.32, -1.28],
  [0.26, -1.5],
];
/**
 * The skirt hangs from the waist to just below the knees, pushed forward by a
 * forward knee: a hem at a fixed height drags on the floor as he kneels.
 */
const APRON_HEM_BELOW_KNEE = 0.03;
/** The hem lies on the front of the forward thigh: its knee plus the thigh's half-depth. */
const APRON_MIN_SKIRT_FORE = 0.3;
const APRON_KNEE_CLEARANCE = 0.16;
/** Edge-on the skirt hangs straight and thin, a little past the knee. */
const APRON_SKIRT_OUTER = 0.03;
const APRON_SKIRT_INNER = 0.04;
/** A pocket across the skirt with a stitched divider, the one detail that says "work apron". */
const APRON_POCKET_Y = -0.58;
const APRON_POCKET_HALF = 0.24;
const APRON_POCKET_DEPTH = 0.12;
const APRON_SEAM_ALPHA = 0.8;
const APRON_SEAM_WIDTH = 0.016;
/** Scorches on the hide where sparks landed, as (across, height, radius). */
const APRON_SCORCHES: readonly (readonly [number, number, number])[] = [
  [-0.12, -1.08, 0.035],
  [0.18, -0.82, 0.028],
  [-0.22, -0.46, 0.03],
];
const SCORCH_ALPHA = 0.55;

function apronPart(d: DrawCtx): Part | null {
  if (d.view.id === 'away') return null;
  const kneeL = earthElementalLegChain(d.pose, -1).knee;
  const kneeR = earthElementalLegChain(d.pose, 1).knee;
  // Below the hips the pose only drops a point, so a knee's height comes back
  // to the upright body by taking the drop off.
  const hemAt = (kneeY: number): number => kneeY - d.pose.drop + APRON_HEM_BELOW_KNEE;
  let pts: Pt[];
  if (d.view.profile) {
    const forwardKnee = kneeL.fore > kneeR.fore ? kneeL : kneeR;
    const hem = hemAt(Math.max(kneeL.y, kneeR.y));
    const skirt = Math.max(APRON_MIN_SKIRT_FORE, forwardKnee.fore + APRON_KNEE_CLEARANCE);
    // Over the top of the forward knee: standing it is just under the waist,
    // kneeling it lays the skirt across the thigh instead of hanging a strap
    // from the belly to the floor.
    const overKnee = hemAt(forwardKnee.y) - APRON_HEM_BELOW_KNEE - THIGH_HALF;
    const outer = APRON_PROFILE_OUTER.map(([fore, y]) => onSpinePlane(d, fore, y));
    const inner = APRON_PROFILE_INNER.map(([fore, y]) => onSpinePlane(d, fore, y));
    pts = [
      ...outer,
      onSpinePlane(d, skirt + APRON_SKIRT_OUTER, overKnee),
      onSpinePlane(d, skirt + APRON_SKIRT_OUTER, hem),
      onSpinePlane(d, skirt - APRON_SKIRT_INNER, hem),
      onSpinePlane(d, skirt - APRON_SKIRT_INNER, overKnee + APRON_SKIRT_INNER),
      ...inner,
    ];
  } else {
    const onApron = ([lat, y]: readonly [number, number]): Pt =>
      project(d.view, posed(d.pose, v3(lat, y, CHEST_FRONT_DEPTH + APRON_PROUD)));
    pts = [
      ...APRON_FRONT_RIGHT.map(onApron),
      onApron([APRON_HEM_HALF, hemAt(kneeR.y)]),
      onApron([-APRON_HEM_HALF, hemAt(kneeL.y)]),
      ...APRON_FRONT_LEFT.map(onApron),
    ];
  }
  const trace = (ctx: Ctx): void => {
    tracePolygon(ctx, pts);
  };
  return {
    outlined: true,
    trace,
    paint: (ctx) => {
      clipTo(ctx, trace, () => {
        shadePanel(ctx, pts, APRON_LEATHER);
        if (d.view.profile) return;
        for (const [lat, y, r] of APRON_SCORCHES) {
          const at = onFace(d, lat, y);
          ctx.fillStyle = rgba(APRON_LEATHER.deep, SCORCH_ALPHA);
          ctx.beginPath();
          ctx.arc(at.x, at.y, r, 0, TWO_PI);
          ctx.fill();
        }
        const pocketL = onFace(d, -APRON_POCKET_HALF, APRON_POCKET_Y);
        const pocketR = onFace(d, APRON_POCKET_HALF, APRON_POCKET_Y);
        const divTop = onFace(d, 0, APRON_POCKET_Y);
        const divFoot = onFace(d, 0, APRON_POCKET_Y + APRON_POCKET_DEPTH);
        rimStroke(ctx, pocketL, pocketR, APRON_LEATHER.deep, APRON_SEAM_ALPHA, APRON_SEAM_WIDTH);
        rimStroke(ctx, divTop, divFoot, APRON_LEATHER.deep, APRON_SEAM_ALPHA, APRON_SEAM_WIDTH);
        rimStroke(ctx, pts[0], pts[1], APRON_LEATHER.rim, APRON_SEAM_ALPHA, APRON_SEAM_WIDTH);
      });
      // Edge-on its inner face is buried in the torso; a line there would
      // draw a gap between the bib and the chest.
      if (d.view.profile) return;
      ctx.strokeStyle = rgba(OUTLINE, OUTLINE_ALPHA);
      ctx.lineWidth = OUTLINE_HALF_WIDTH;
      ctx.lineJoin = 'round';
      trace(ctx);
      ctx.stroke();
    },
  };
}

/**
 * The shards breaking up through the shoulders, and most of what makes the silhouette read as rock rather than as a big man.
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

/** How far a shard stands proud of the shoulder it breaks through, per unit of its radius. */
const SHARD_HEIGHT = 1.7;

/**
 * A shard of rock breaking up through the shoulder: a broad base and
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
  const chain = earthElementalArmChain(d.pose, side);
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
/** The band stands a little proud of the arm it wraps. */
const ARMBAND_BULK = 1.15;
/** How far into its shadow tone a receded band goes, at most. */
const ARMBAND_RECEDED_SHADE = 0.6;
const ARMBAND_LIT_ALPHA = 0.7;
/** The upper sleeve's lower end is a touch wider than the forearm it meets. */
const ELBOW_FLARE = 1.05;

function armParts(d: DrawCtx, side: number, receded: number): Part[] {
  const arm = side < 0 ? d.pose.armL : d.pose.armR;
  const drawn = drawnArm(d, side);
  const hand = handPart(d, drawn, arm, side, receded);
  const wearsBand = side > 0;
  switch (d.spec.outfit) {
    case 'quarryman':
      return [
        ...stoneArmParts(d, drawn, side, receded, wearsBand),
        ropeWrapPart(drawn, side, receded),
        hand,
      ];
    case 'smith':
      return [
        ...stoneArmParts(d, drawn, side, receded, wearsBand),
        bracerPart(drawn, receded),
        hand,
      ];
    default:
      return unhandledOutfit(d.spec.outfit);
  }
}

/** A bare stone limb is a touch heavier than a sleeve: nothing hides how thick the rock is. */
const STONE_UPPER_ARM_HALF = 0.11;
const STONE_FOREARM_HALF = 0.1;
/** How far each end of a limb slab is bevelled past its joint, as a share of its half-width. */
const LIMB_CAP_SHARE = 0.55;
/** The cap's shoulders sit this share of the cap back from its point. */
const LIMB_CAP_SHOULDER = 0.3;
/** A slab bulges this much at its middle. */
const LIMB_BULGE = 1.06;
/** How far each corner of a limb slab is knocked in or out, tiles. */
const LIMB_CHIP = 0.012;
const UPPER_ARM_SEEDS: Record<'left' | 'right', number> = { left: 521, right: 541 };
const FOREARM_SEED_OFFSET = 7;
const DELTOID_SEED_OFFSET = 3;
const DELTOID_SIDES = 7;
const DELTOID_CHIP = 0.15;

/**
 * A limb as one chiselled slab: bevelled ends, a slight swell at the middle,
 * every corner chipped. Shaded by {@link stonePart}'s hard facets, it reads as
 * a block of rock with a lit face and a shadow face, never a tube.
 */
function limbSlab(a: Pt, b: Pt, halfA: number, halfB: number, seed: number): Pt[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.max(Math.hypot(dx, dy), 1e-6);
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;
  const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  const midHalf = ((halfA + halfB) / 2) * LIMB_BULGE;
  const capA = halfA * LIMB_CAP_SHARE;
  const capB = halfB * LIMB_CAP_SHARE;
  const raw: Pt[] = [
    { x: a.x - ux * capA, y: a.y - uy * capA },
    {
      x: a.x + nx * halfA - ux * capA * LIMB_CAP_SHOULDER,
      y: a.y + ny * halfA - uy * capA * LIMB_CAP_SHOULDER,
    },
    { x: mid.x + nx * midHalf, y: mid.y + ny * midHalf },
    {
      x: b.x + nx * halfB + ux * capB * LIMB_CAP_SHOULDER,
      y: b.y + ny * halfB + uy * capB * LIMB_CAP_SHOULDER,
    },
    { x: b.x + ux * capB, y: b.y + uy * capB },
    {
      x: b.x - nx * halfB + ux * capB * LIMB_CAP_SHOULDER,
      y: b.y - ny * halfB + uy * capB * LIMB_CAP_SHOULDER,
    },
    { x: mid.x - nx * midHalf, y: mid.y - ny * midHalf },
    {
      x: a.x - nx * halfA - ux * capA * LIMB_CAP_SHOULDER,
      y: a.y - ny * halfA - uy * capA * LIMB_CAP_SHOULDER,
    },
  ];
  return raw.map((p, i) => ({
    x: p.x + nx * signedHash(seed, i) * LIMB_CHIP,
    y: p.y + ny * signedHash(seed, i) * LIMB_CHIP,
  }));
}

/**
 * A hire's bare stone arm: the round of the shoulder, the upper arm and the
 * forearm as three chiselled stones, the forearm last so the elbow reads as one
 * block passing in front of the other. The armband wraps the upper arm.
 */
function stoneArmParts(
  d: DrawCtx,
  drawn: DrawnArm,
  side: number,
  receded: number,
  wearsBand: boolean,
): Part[] {
  const seed = side < 0 ? UPPER_ARM_SEEDS.left : UPPER_ARM_SEEDS.right;
  const raised = clamp01((drawn.shoulder.y - drawn.elbow.y) / UPPER_ARM_LENGTH);
  const deltoidRadius = lerp(DELTOID_RADIUS, STONE_UPPER_ARM_HALF, raised);
  const deltoid = stonePart(
    stonePolygon({
      seed: seed + DELTOID_SEED_OFFSET,
      cx: drawn.shoulder.x,
      cy: drawn.shoulder.y,
      rx: deltoidRadius,
      ry: deltoidRadius,
      sides: DELTOID_SIDES,
      jitter: DELTOID_CHIP,
      rotate: seed,
    }),
    d.spec,
    seed + DELTOID_SEED_OFFSET,
    receded,
    0,
    'light',
  );
  const upperPts = limbSlab(
    drawn.shoulder,
    drawn.elbow,
    STONE_UPPER_ARM_HALF,
    STONE_FOREARM_HALF * ELBOW_FLARE,
    seed,
  );
  const upperStone = stonePart(upperPts, d.spec, seed, receded, 0);
  const upper: Part = {
    outlined: true,
    trace: upperStone.trace,
    paint: (ctx) => {
      upperStone.paint(ctx);
      if (!wearsBand) return;
      clipTo(ctx, upperStone.trace, () => {
        paintArmband(ctx, drawn, STONE_UPPER_ARM_HALF, receded);
      });
    },
  };
  const forearm = stonePart(
    limbSlab(
      drawn.elbow,
      drawn.wrist,
      STONE_FOREARM_HALF,
      STONE_FOREARM_HALF * drawn.fistScale,
      seed + FOREARM_SEED_OFFSET,
    ),
    d.spec,
    seed + FOREARM_SEED_OFFSET,
    receded,
    0,
  );
  return [deltoid, upper, forearm];
}

interface ForearmBand {
  readonly from: Pt;
  readonly to: Pt;
  readonly halfFrom: number;
  readonly halfTo: number;
}

/** A wrap round the forearm between two shares of elbow to wrist, standing proud of the stone. */
function forearmBand(drawn: DrawnArm, from: number, to: number, bulk: number): ForearmBand {
  const at = (t: number): Pt => ({
    x: lerp(drawn.elbow.x, drawn.wrist.x, t),
    y: lerp(drawn.elbow.y, drawn.wrist.y, t),
  });
  const half = (t: number): number => STONE_FOREARM_HALF * lerp(1, drawn.fistScale, t) * bulk;
  return { from: at(from), to: at(to), halfFrom: half(from), halfTo: half(to) };
}

/** Crush's rope runs from just below the elbow to the wrist, in coils this far apart. */
const ROPE_FROM = 0.22;
const ROPE_TO = 1;
const ROPE_BULK = 1.14;
const ROPE_COIL_SPACING = 0.062;
/** The loose end below the wrist: its length, sideways drift, and thickness, tiles. */
const ROPE_TAIL_LENGTH = 0.09;
const ROPE_TAIL_DRIFT = 0.02;
const ROPE_TAIL_HALF = 0.014;
const ROPE_TAIL_TAPER = 0.7;
/** Each coil runs across the arm on a slant, as a share of its spacing. */
const ROPE_COIL_SLANT = 1.8;
const ROPE_COIL_ALPHA = 1;
const ROPE_COIL_WIDTH = 0.018;
const ROPE_LIT_ALPHA = 0.5;
const ROPE_LIT_WIDTH = 0.008;

/**
 * Rope wound round the forearm: a hemp sleeve proud of the stone, a few thick
 * slanted turns with a mid-tone groove and a lit lip on each, and on one arm a
 * loose end. Many thin turns with black grooves read as a coil spring.
 */
function ropeWrapPart(drawn: DrawnArm, side: number, receded: number): Part {
  const band = forearmBand(drawn, ROPE_FROM, ROPE_TO, ROPE_BULK);
  const pts = bandPolygon(band.from, band.to, band.halfFrom, band.halfTo);
  // One wrap's loose end hangs from the wrist: a tail is what says rope
  // rather than a striped cuff.
  const tailRoot: Pt = { x: band.to.x, y: band.to.y };
  const tail =
    side < 0
      ? bandPolygon(
          tailRoot,
          { x: tailRoot.x + ROPE_TAIL_DRIFT, y: tailRoot.y + ROPE_TAIL_LENGTH },
          ROPE_TAIL_HALF,
          ROPE_TAIL_HALF * ROPE_TAIL_TAPER,
        )
      : null;
  const trace = (ctx: Ctx): void => {
    ctx.beginPath();
    addPolygon(ctx, pts);
    if (tail !== null) addPolygon(ctx, tail);
  };
  const traceBand = (ctx: Ctx): void => {
    tracePolygon(ctx, pts);
  };
  return {
    outlined: true,
    trace,
    paint: (ctx) => {
      if (tail !== null) {
        ctx.fillStyle = mix(ROPE.base, ROPE.shadow, receded);
        tracePolygon(ctx, tail);
        ctx.fill();
      }
      clipTo(ctx, traceBand, () => {
        shadeTube(ctx, band.from, band.to, band.halfFrom, ROPE, receded);
        const dx = band.to.x - band.from.x;
        const dy = band.to.y - band.from.y;
        const length = Math.max(Math.hypot(dx, dy), 1e-6);
        const ux = dx / length;
        const uy = dy / length;
        const reach = Math.max(band.halfFrom, band.halfTo) * 2;
        const slant = ROPE_COIL_SPACING * ROPE_COIL_SLANT;
        ctx.lineCap = 'butt';
        for (let along = 0; along <= length + slant; along += ROPE_COIL_SPACING) {
          const cx = band.from.x + ux * along;
          const cy = band.from.y + uy * along;
          for (const [color, alpha, width, shift] of [
            [ROPE.shadow, ROPE_COIL_ALPHA, ROPE_COIL_WIDTH, 0],
            [ROPE.rim, ROPE_LIT_ALPHA * (1 - receded), ROPE_LIT_WIDTH, ROPE_COIL_WIDTH],
          ] as const) {
            ctx.strokeStyle = rgba(color, alpha);
            ctx.lineWidth = width;
            ctx.beginPath();
            ctx.moveTo(cx + ux * shift - uy * reach, cy + uy * shift + ux * reach);
            ctx.lineTo(
              cx + ux * (shift - slant) + uy * reach,
              cy + uy * (shift - slant) - ux * reach,
            );
            ctx.stroke();
          }
        }
      });
    },
  };
}

/**
 * Hammer Hands' bracers: forged iron from mid-forearm to the wrist, barely
 * wider than the stone they wrap, with one rolled lip at the elbow end. Lit
 * lips at both ends, on a band much wider than the arm, read as a held can.
 */
const BRACER_FROM = 0.3;
const BRACER_TO = 1;
const BRACER_BULK = 1.08;
/** Where along the bracer its rolled lips sit. */
const BRACER_LIPS: readonly number[] = [0.1];
const BRACER_LIP_ALPHA = 0.6;
const BRACER_LIP_WIDTH = 0.02;
const BRACER_GROOVE_ALPHA = 0.7;
const BRACER_GROOVE_WIDTH = 0.012;
/** The groove under each lip sits this far toward the bracer's middle. */
const BRACER_GROOVE_OFFSET = 0.08;

function bracerPart(drawn: DrawnArm, receded: number): Part {
  const band = forearmBand(drawn, BRACER_FROM, BRACER_TO, BRACER_BULK);
  const pts = bandPolygon(band.from, band.to, band.halfFrom, band.halfTo);
  const trace = (ctx: Ctx): void => {
    tracePolygon(ctx, pts);
  };
  return {
    outlined: true,
    trace,
    paint: (ctx) => {
      clipTo(ctx, trace, () => {
        shadeTube(ctx, band.from, band.to, band.halfFrom, IRON, receded);
        const dx = band.to.x - band.from.x;
        const dy = band.to.y - band.from.y;
        const reach = Math.max(band.halfFrom, band.halfTo) * 2;
        const length = Math.max(Math.hypot(dx, dy), 1e-6);
        const nx = -dy / length;
        const ny = dx / length;
        const across = (t: number, color: string, alpha: number, width: number): void => {
          const cx = band.from.x + dx * t;
          const cy = band.from.y + dy * t;
          rimStroke(
            ctx,
            { x: cx - nx * reach, y: cy - ny * reach },
            { x: cx + nx * reach, y: cy + ny * reach },
            color,
            alpha,
            width,
          );
        };
        for (const lip of BRACER_LIPS) {
          const inward = lip < 1 / 2 ? BRACER_GROOVE_OFFSET : -BRACER_GROOVE_OFFSET;
          across(lip + inward, IRON.deep, BRACER_GROOVE_ALPHA, BRACER_GROOVE_WIDTH);
          across(lip, IRON.rim, BRACER_LIP_ALPHA * (1 - receded), BRACER_LIP_WIDTH);
        }
      });
    },
  };
}

function paintArmband(ctx: Ctx, drawn: DrawnArm, armHalf: number, receded: number): void {
  const at: Pt = {
    x: lerp(drawn.shoulder.x, drawn.elbow.x, ARMBAND_AT),
    y: lerp(drawn.shoulder.y, drawn.elbow.y, ARMBAND_AT),
  };
  const dx = drawn.elbow.x - drawn.shoulder.x;
  const dy = drawn.elbow.y - drawn.shoulder.y;
  const length = Math.max(Math.hypot(dx, dy), 1e-6);
  const ux = dx / length;
  const uy = dy / length;
  const half = armHalf * ARMBAND_BULK;
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
  ctx.fillStyle = mix(
    MERCENARY_ARMBAND.base,
    MERCENARY_ARMBAND.shadow,
    receded * ARMBAND_RECEDED_SHADE,
  );
  tracePolygon(ctx, band);
  ctx.fill();
  // A lit edge on the side facing the light, so the band reads as wrapped round.
  ctx.fillStyle = rgba(MERCENARY_ARMBAND.light, ARMBAND_LIT_ALPHA * (1 - receded));
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
  arm: EarthElementalArmPose,
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
  // The stone wrist between the cuff or wrap and the fist: what keeps the fist
  // from reading as a grey glove.
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
};

/** Head half-width head-on, in tiles, and edge-on depth. */
const HEAD_HALF_WIDTH: Record<HeadShape, number> = { block: 0.22, round: 0.222 };
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
    ry: HEAD_RY,
  };
}

/** The chipped head outline in head radii, before it is carried into the drawn frame. */
function headUnitOutline(d: DrawCtx): Pt[] {
  let unit: readonly [number, number][];
  if (d.view.profile) {
    unit = HEAD_PROFILE[d.spec.head];
  } else {
    const half = HEAD_FRONT[d.spec.head];
    unit = [...half, ...[...half].reverse().map(([x, y]): [number, number] => [-x, y])];
  }
  return unit.map(([ux, uy], i) => ({
    x: ux + signedHash(HEAD_SEED, i) * HEAD_CHIP,
    y: uy + signedHash(HEAD_SEED + 1, i) * HEAD_CHIP,
  }));
}

function headOutline(d: DrawCtx, frame: HeadFrame): Pt[] {
  return headUnitOutline(d).map((p) => onHead(frame, p.x, p.y));
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
const EYE_SPREAD: Record<HeadShape, number> = { block: 0.42, round: 0.4 };
const EYE_Y = -0.1;
const BROW_Y = -0.34;
/** The brow slab: its width, the narrower shadowed underside, and how far down that falls. */
const BROW_HALF = 0.92;
const BROW_UNDER_HALF = 0.8;
const BROW_DEPTH = 0.22;
const BROW_SHADOW_ALPHA = 0.6;
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
  const at = ([ux, uy]: readonly [number, number]): Pt => onHead(frame, ux, uy);

  const browL = onHead(frame, -BROW_HALF + turn, BROW_Y);
  const browR = onHead(frame, BROW_HALF + turn, BROW_Y);
  const underL = onHead(frame, -BROW_UNDER_HALF + turn, BROW_Y + BROW_DEPTH);
  const underR = onHead(frame, BROW_UNDER_HALF + turn, BROW_Y + BROW_DEPTH);
  ctx.fillStyle = rgba(ramp.deep, BROW_SHADOW_ALPHA);
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
  const mouthL = onHead(frame, -MOUTH_HALF + turn, MOUTH_Y);
  const mouthR = onHead(frame, MOUTH_HALF + turn, MOUTH_Y);
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
const PROFILE_EYE: readonly [number, number] = [0.66, -0.12];
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
  const at = ([ux, uy]: readonly [number, number]): Pt => onHead(frame, ux, uy);
  ctx.fillStyle = rgba(ramp.deep, PROFILE_BROW_SHADOW_ALPHA);
  tracePolygon(ctx, PROFILE_BROW_SHADOW.map(at));
  ctx.fill();
  const eye = at(PROFILE_EYE);
  ctx.fillStyle = EYE_DARK;
  ctx.beginPath();
  ctx.ellipse(
    eye.x,
    eye.y,
    PROFILE_EYE_HALF_WIDTH,
    lerp(PROFILE_EYE_OPEN_HALF_HEIGHT, EYE_SHUT_HALF_HEIGHT, d.pose.blink),
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  if (d.pose.blink < GLINT_BLINK_LIMIT) {
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

// ── The smith's headscarf ────────────────────────────────────────────────────

/** The scarf sits this much proud of the skull, in head radii, so its edge breaks the silhouette. */
const SCARF_INFLATE = 1.13;
/**
 * The scarf's lower edge in head radii, +Y down: head-on just over the brow,
 * edge-on sloping from the brow down to the nape, and from behind wrapping the
 * whole skull to the nape: bare stone under a dark band reads as a face.
 */
const SCARF_EDGE_FRONT_Y = -0.28;
const SCARF_EDGE_PROFILE_MID_Y = -0.08;
const SCARF_EDGE_PROFILE_SLOPE = -0.32;
const SCARF_EDGE_BACK_Y = 0.78;
/** The knot and its two tails, in head radii: at the back edge-on, at the nape from behind. */
const SCARF_KNOT_PROFILE: Pt = { x: -1.04, y: -0.04 };
/**
 * Head-on the knot sits at the side of the head with its tails flaring past
 * the silhouette: without them a dark crown reads as a cap or hair.
 */
const SCARF_KNOT_FRONT: Pt = { x: 1.0, y: -0.38 };
const SCARF_KNOT_BACK: Pt = { x: 0.04, y: 0.6 };
const SCARF_KNOT_RADIUS = 0.3;
const SCARF_KNOT_SIDES = 7;
const SCARF_KNOT_CHIP = 0.2;
const SCARF_SEED = 613;
const SCARF_TAILS_PROFILE: readonly (readonly Pt[])[] = [
  [
    { x: -1.12, y: -0.02 },
    { x: -1.62, y: 0.62 },
    { x: -1.3, y: 0.76 },
    { x: -0.9, y: 0.12 },
  ],
  [
    { x: -1.0, y: 0.08 },
    { x: -1.18, y: 0.92 },
    { x: -0.88, y: 0.96 },
    { x: -0.8, y: 0.14 },
  ],
];
/** Head-on one tail of the knot shows past the side of the head. */
const SCARF_TAILS_FRONT: readonly (readonly Pt[])[] = [
  [
    { x: 1.0, y: -0.42 },
    { x: 1.6, y: 0.08 },
    { x: 1.42, y: 0.28 },
    { x: 0.94, y: -0.2 },
  ],
  [
    { x: 1.06, y: -0.3 },
    { x: 1.28, y: 0.46 },
    { x: 1.06, y: 0.52 },
    { x: 0.94, y: -0.14 },
  ],
];
const SCARF_TAILS_BACK: readonly (readonly Pt[])[] = [
  [
    { x: -0.08, y: 0.62 },
    { x: -0.5, y: 1.75 },
    { x: -0.2, y: 1.85 },
    { x: 0.1, y: 0.7 },
  ],
  [
    { x: 0.1, y: 0.62 },
    { x: 0.32, y: 1.7 },
    { x: 0.62, y: 1.6 },
    { x: 0.24, y: 0.58 },
  ],
];
/**
 * Head-on, folds pulled across the crown toward the knot, in a lighter step
 * of the cloth so they show on it. A lit line along the brow reads as a cap's
 * brim, so the edge gets none.
 */
const SCARF_FOLDS: readonly (readonly [Pt, Pt])[] = [
  [
    { x: -0.6, y: -0.62 },
    { x: 0.9, y: -0.46 },
  ],
  [
    { x: -0.3, y: -0.88 },
    { x: 0.88, y: -0.56 },
  ],
];
const SCARF_FOLD_LIT_ALPHA = 0.75;
const SCARF_FOLD_ALPHA = 0.7;
const SCARF_FOLD_WIDTH = 0.014;
/** Head-on the edge dips toward the knot's side, as cloth pulled into a knot does. */
const SCARF_EDGE_FRONT_SLOPE = 0.1;

/** The scarf's lower edge at a point across the head, in head radii. */
function scarfEdgeY(view: ViewSpec, x: number): number {
  if (view.profile) return SCARF_EDGE_PROFILE_MID_Y + SCARF_EDGE_PROFILE_SLOPE * x;
  return view.id === 'away' ? SCARF_EDGE_BACK_Y : SCARF_EDGE_FRONT_Y + SCARF_EDGE_FRONT_SLOPE * x;
}

/** Keeps the part of a closed polygon above a line, Sutherland–Hodgman against one half-plane. */
function clipAbove(pts: readonly Pt[], edgeY: (x: number) => number): Pt[] {
  const out: Pt[] = [];
  const inside = (p: Pt): boolean => p.y <= edgeY(p.x);
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const aIn = inside(a);
    const bIn = inside(b);
    if (aIn) out.push(a);
    if (aIn === bIn) continue;
    const fa = a.y - edgeY(a.x);
    const fb = b.y - edgeY(b.x);
    const t = fa / (fa - fb);
    out.push({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) });
  }
  return out;
}

/**
 * Hammer Hands' soot-dark headscarf: a cap of cloth over the crown, a rolled
 * hem across the brow, and a knot with two short tails at the back. Built on
 * the head's own outline, so it fits whichever head it sits on.
 */
function scarfPart(d: DrawCtx, frame: HeadFrame): Part {
  const edge = (x: number): number => scarfEdgeY(d.view, x);
  const inflated = headUnitOutline(d).map((p) => ({
    x: p.x * SCARF_INFLATE,
    y: p.y * SCARF_INFLATE,
  }));
  const cap = clipAbove(inflated, edge).map((p) => onHead(frame, p.x, p.y));
  const knotAt =
    d.view.id === 'front'
      ? SCARF_KNOT_FRONT
      : d.view.profile
        ? SCARF_KNOT_PROFILE
        : SCARF_KNOT_BACK;
  const tails =
    d.view.id === 'front'
      ? SCARF_TAILS_FRONT
      : d.view.profile
        ? SCARF_TAILS_PROFILE
        : SCARF_TAILS_BACK;
  const tailPolys = tails.map((tail) => tail.map((p) => onHead(frame, p.x, p.y)));
  const knot = stonePolygon({
    seed: SCARF_SEED,
    cx: knotAt.x,
    cy: knotAt.y,
    rx: SCARF_KNOT_RADIUS,
    ry: SCARF_KNOT_RADIUS,
    sides: SCARF_KNOT_SIDES,
    jitter: SCARF_KNOT_CHIP,
    rotate: 0,
  }).map((p) => onHead(frame, p.x, p.y));
  const pieces = [cap, ...tailPolys, knot];
  const trace = (ctx: Ctx): void => {
    ctx.beginPath();
    for (const piece of pieces) addPolygon(ctx, piece);
  };
  return {
    outlined: true,
    trace,
    paint: (ctx) => {
      for (const piece of pieces) {
        clipTo(
          ctx,
          (c) => {
            tracePolygon(c, piece);
          },
          () => {
            shadePanel(ctx, piece, SOOT_CLOTH);
          },
        );
        // Tails and knot lie over the cap in the same cloth; only an edge
        // tells them apart from it.
        if (piece === cap) continue;
        ctx.strokeStyle = rgba(SOOT_CLOTH.deep, SCARF_FOLD_ALPHA);
        ctx.lineWidth = SCARF_FOLD_WIDTH;
        ctx.lineJoin = 'round';
        tracePolygon(ctx, piece);
        ctx.stroke();
      }
      clipTo(
        ctx,
        (c) => {
          tracePolygon(c, cap);
        },
        () => {
          if (d.view.id !== 'front') return;
          for (const [from, to] of SCARF_FOLDS) {
            rimStroke(
              ctx,
              onHead(frame, from.x, from.y),
              onHead(frame, to.x, to.y),
              SOOT_CLOTH.rim,
              SCARF_FOLD_LIT_ALPHA,
              SCARF_FOLD_WIDTH,
            );
          }
        },
      );
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
/** The glyph's centre is never lower than this gap over the crown, so it sits between the hands. */
const GLYPH_CROWN_CLEARANCE = 0.1;
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
  // A dark ring under the bright one, so the glyph stands off a sandstone
  // head rather than melting into it.
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
 * Paints one Earth Elemental in one pose from one view.
 *
 * The caller has translated to the ground point between the feet and scaled
 * by one tile.
 */
export function drawEarthElemental(
  ctx: Ctx,
  view: EarthElementalView,
  pose: EarthElementalPose,
  variant: EarthElementalVariant,
): void {
  const d: DrawCtx = { view: VIEWS[view], spec: VARIANTS[variant], pose };
  drawContactShadow(ctx, 1);
  drawDust(ctx, pose.dust, CONTACT_SHADOW_RX, FOOT_DUST_SEED);

  const parts: Part[] = [];
  const head = headPart(d);
  const frame = headFrame(d);
  const outfit = outfitParts(d, frame);

  if (view === 'side') {
    parts.push(...armParts(d, -1, FAR_ARM_RECEDED));
    parts.push(...legParts(d, -1, FAR_LEG_RECEDED));
    parts.push(...legParts(d, 1, 0));
    parts.push(stoneTorsoPart(d));
    parts.push(...outfit.overBody);
    parts.push(...shoulderRockParts(d));
    parts.push(head);
    parts.push(...outfit.overHead);
    parts.push(...armParts(d, 1, 0));
  } else if (view === 'front') {
    parts.push(...legParts(d, -1, 0));
    parts.push(...legParts(d, 1, 0));
    parts.push(stoneTorsoPart(d));
    parts.push(...outfit.overBody);
    parts.push(head);
    parts.push(...outfit.overHead);
    // Head-on both arms belong in front of the torso; drawing the far one
    // behind makes the figure look one-armed.
    parts.push(...armParts(d, -1, 0));
    parts.push(...armParts(d, 1, 0));
    // Over the arms: the rock breaks up through the shoulders.
    parts.push(...shoulderRockParts(d));
  } else {
    parts.push(...legParts(d, -1, 0));
    parts.push(...legParts(d, 1, 0));
    // From behind the arms hang at the sides of a back wider than they are
    // spread, so they go behind it — and a punch thrown away from the camera
    // disappears behind the shoulders as it should.
    parts.push(...armParts(d, -1, BACK_ARM_RECEDED));
    parts.push(...armParts(d, 1, BACK_ARM_RECEDED));
    parts.push(stoneTorsoPart(d));
    parts.push(...outfit.overBody);
    parts.push(...shoulderRockParts(d));
    parts.push(head);
    parts.push(...outfit.overHead);
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
    // Between the hands and clear of the head: over the crown it merges with
    // the head at 32 px.
    const at = {
      x: (left.x + right.x) / 2,
      y: Math.min(
        Math.min(left.y, right.y) - GLYPH_RADIUS * GLYPH_OVER_HANDS,
        HEAD_CENTRE_Y - HEAD_RY - GLYPH_CROWN_CLEARANCE - GLYPH_RADIUS,
      ),
    };
    drawGlyph(ctx, at, pose.glyph, pose.time);
  }
}

/**
 * What each outfit adds over the body (between the torso and the head) and
 * over the head.
 */
function outfitParts(d: DrawCtx, frame: HeadFrame): { overBody: Part[]; overHead: Part[] } {
  switch (d.spec.outfit) {
    case 'quarryman':
      return { overBody: [beltPart(d, 'quarryman')], overHead: [] };
    case 'smith': {
      const apron = apronPart(d);
      const tie = apronTiePart(d);
      return {
        // The belt goes over the apron: it is what ties it at the waist.
        overBody: [
          ...(apron === null ? [] : [apron]),
          beltPart(d, 'smith'),
          ...(tie === null ? [] : [tie]),
        ],
        overHead: [scarfPart(d, frame)],
      };
    }
    default:
      return unhandledOutfit(d.spec.outfit);
  }
}

/**
 * Fissures running across the torso as it gives way. Bare stone simply splits
 * dark, a wide line with a narrower core over it: a lit edge along a wandering
 * tear reads as a chain laid over the body.
 */
function drawBodyCracks(ctx: Ctx, d: DrawCtx): void {
  const outline = torsoOutline(d);
  const tearColor = d.spec.stone.deep;
  ctx.save();
  ctx.globalAlpha *= clamp01(d.pose.cracks);
  clipTo(
    ctx,
    (c) => {
      traceSmooth(c, outline);
    },
    () => {
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
        for (const width of [TEAR_WIDTH, TEAR_WIDTH * TEAR_CORE_SHARE]) {
          ctx.strokeStyle = tearColor;
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
/** A tear runs from the torso's edge through its centre and a little past. */
const TEAR_REACH = 1.15;
const TEAR_WANDER = 0.2;
/** A tear's core is narrower than the line round it. */
const TEAR_CORE_SHARE = 0.45;

// ── Rubble: the death's end ──────────────────────────────────────────────────

/**
 * One piece of a collapsed Earth Elemental: where it starts on the body and
 * where it comes to rest in the pile.
 */
interface RubbleChunk {
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
/** Where the scraps of clothing start: across the kneeling chest, between the stones. */
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
interface ScrapSpec {
  readonly ramp: ClothRamp;
  readonly x: number;
  readonly y: number;
  readonly r: number;
}

/** A scrap of clothing on the heap: a chunk with the cloth it is cut from. */
interface ScrapChunk extends RubbleChunk {
  readonly ramp: ClothRamp;
}

/** What each outfit leaves draped over the heap, where it lands, and how big it is. */
const OUTFIT_SCRAPS: Record<EarthElementalOutfit, readonly ScrapSpec[]> = {
  // Strips at different heights and sizes: a matched pair side by side reads as goggles.
  quarryman: [
    { ramp: HARNESS_LEATHER, x: -0.2, y: -0.36, r: 0.15 },
    { ramp: HARNESS_LEATHER, x: 0.32, y: -0.12, r: 0.1 },
    { ramp: ROPE, x: 0.06, y: -0.42, r: 0.07 },
  ],
  smith: [
    { ramp: APRON_LEATHER, x: -0.12, y: -0.3, r: 0.22 },
    { ramp: APRON_LEATHER, x: 0.24, y: -0.2, r: 0.12 },
  ],
};
const SCRAP_SEED = 1301;
const SCRAP_SEED_STEP = 11;
const SCRAP_SPIN_SALT = 919;
/** Scraps start a little inboard of where they land, and fall just after the top course. */
const SCRAP_SOURCE_SPREAD = 0.9;
const SCRAP_LAG = 0.04;

/**
 * The collapse's pieces, laid out once. Each stone drops from roughly where it
 * sat on the kneeling body — the legs become the base, the chest the middle, the
 * shoulders the top — so the body comes down rather than bursting apart.
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
      seed: pebble.seed,
      from: pebble.to,
      to: pebble.to,
      r: pebble.r,
      delay: 0,
      spin: 0,
    });
  }
  return chunks;
}

/** The clothes do not vanish with the body; they fall just after the top course and settle draped over it. */
function scrapChunks(outfit: EarthElementalOutfit, stoneCount: number): ScrapChunk[] {
  return OUTFIT_SCRAPS[outfit].map((scrap, i) => {
    const seed = SCRAP_SEED + (stoneCount + i) * SCRAP_SEED_STEP;
    return {
      ramp: scrap.ramp,
      seed,
      from: { x: scrap.x * SCRAP_SOURCE_SPREAD, y: CLOTH_SOURCE_Y },
      to: { x: scrap.x, y: scrap.y },
      r: scrap.r,
      delay: COURSE_DELAY[COURSE_DELAY.length - 1] + SCRAP_LAG,
      spin: signedHash(SCRAP_SPIN_SALT, seed),
    };
  });
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
export function drawEarthElementalShedStones(
  ctx: Ctx,
  view: EarthElementalView,
  variant: EarthElementalVariant,
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
const RUBBLE_SCRAPS: Record<EarthElementalOutfit, readonly ScrapChunk[]> = {
  quarryman: scrapChunks('quarryman', RUBBLE.length),
  smith: scrapChunks('smith', RUBBLE.length),
};

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
/** A scrap of clothing is broader than the stone it lies on, and flattens as it settles. */
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
/** The armband on the floor beside the heap: where it lies, and its size and tilt. */
const FALLEN_BAND_AT: Pt = { x: 0.3, y: -0.06 };
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
export function drawEarthElementalRubble(
  ctx: Ctx,
  view: EarthElementalView,
  variant: EarthElementalVariant,
  fall: number,
  dust: number,
): void {
  const spec = VARIANTS[variant];
  const d: DrawCtx = { view: VIEWS[view], spec, pose: restPose() };
  drawContactShadow(ctx, lerp(PILE_SHADOW_START, PILE_SHADOW_END, fall));
  const parts: Part[] = [];
  const fallOf = (chunk: RubbleChunk): { t: number; x: number; y: number; rotate: number } => {
    const t = clamp01((fall - chunk.delay) / (1 - chunk.delay));
    // Gravity: the drop accelerates, a bounce lifts it once on landing.
    const drop = t * t;
    const bounce = hump(clamp01((t - LANDING_START) / LANDING_SPAN)) * LANDING_BOUNCE;
    return {
      t,
      x: lerp(chunk.from.x, chunk.to.x, easeInOut(t)),
      y: lerp(chunk.from.y, chunk.to.y, drop) - bounce,
      rotate: chunk.spin * (1 - t) + chunk.seed,
    };
  };
  for (const chunk of RUBBLE) {
    const { x, y, rotate } = fallOf(chunk);
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
  }
  for (const scrap of RUBBLE_SCRAPS[spec.outfit]) {
    const { t, x, y, rotate } = fallOf(scrap);
    // A scrap falls flatter than a stone and settles draped.
    const pts = stonePolygon({
      seed: scrap.seed,
      cx: x,
      cy: y,
      rx: scrap.r * SCRAP_BREADTH,
      ry: scrap.r * lerp(SCRAP_FALLING_DEPTH, SCRAP_SETTLED_DEPTH, t),
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
        c.fillStyle = scrap.ramp.base;
        traceSmooth(c, pts);
        c.fill();
        clipTo(
          c,
          (cc) => {
            traceSmooth(cc, pts);
          },
          () => {
            shadePanel(c, pts, scrap.ramp);
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
  const headPose: EarthElementalPose = { ...restPose(), blink: 1 };
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
  if (spec.outfit === 'smith') parts.push(scarfPart(headDraw, frame));
  // The band slips off the sagging arm before the body breaks, so it is
  // already on the floor: falling on the collapse's clock it hangs in the
  // air beside the heap.
  const band = FALLEN_BAND_AT;
  const traceBand = (c: Ctx): void => {
    c.beginPath();
    c.ellipse(band.x, band.y, FALLEN_BAND_RX, FALLEN_BAND_RY, FALLEN_BAND_TILT, 0, TWO_PI);
  };
  parts.push({
    outlined: true,
    trace: traceBand,
    paint: (c) => {
      c.fillStyle = MERCENARY_ARMBAND.base;
      traceBand(c);
      c.fill();
      c.fillStyle = rgba(MERCENARY_ARMBAND.light, ARMBAND_LIT_ALPHA);
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
