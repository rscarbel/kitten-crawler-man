/**
 * The painter behind the five fairies: one small winged humanoid body plan,
 * and five designs hung on it.
 *
 * What makes the shape read as a *fairy* at 32 px, rather than as a child, a
 * bug or a bird:
 *
 *   - **few heads of height.** Size is read by counting heads, so a creature
 *     meant to read as tiny is built chibi, at about three and a quarter, with
 *     every proportion derived from that and the height;
 *   - **two pairs of wings as the dominant silhouette**, wider than the body
 *     and beating, each kind's wing its own shape so the wing alone names the
 *     kind;
 *   - **nothing touches the ground.** Legs dangle with pointed toes, hands are
 *     small and never grip, and a ground shadow sits under a gap of air;
 *   - **pointed ears and glowing eyes**, the two face marks that survive at a
 *     head seven pixels tall.
 *
 * Limbs are posed in three dimensions (x to the fairy's right, y down, z
 * forward) and projected per view, so one pose reads correctly from the front,
 * the side and behind. The torso, head and costume are drawn per view.
 *
 * Every body layer is painted in two passes, an outline pass and then a fill
 * pass, so the limbs of one layer merge into one silhouette under one outline
 * while a later layer (an arm across the chest) still gets a line of its own.
 * The outline is one screen pixel at whatever density the cell is baked at,
 * read off the transform, and fine detail (veins, facets, petals) is skipped
 * when the figure is too small for it to be anything but noise.
 *
 * Coordinates are tile units, +Y down, origin at the tile centre. The side
 * view faces +X; the runtime mirrors it for the other direction.
 */

import { type Pt, clamp01, clampAlpha, deg, easeOut, lerp, mix, rgba } from './carlArt';
import { allocCanvas, surfaceContext } from '../../core/canvasSurface';
import { withClip } from './softShade';
import type { FairyKind } from './fairyTiming';

type Ctx = CanvasRenderingContext2D;

/**
 * The path calls a wing's outline is traced with. A canvas takes them, and so
 * does the bounds recorder behind {@link fairyPaintedTopY}, which measures the
 * wing from the very trace that paints it.
 */
type PathSink = Pick<
  Ctx,
  'moveTo' | 'lineTo' | 'quadraticCurveTo' | 'bezierCurveTo' | 'arc' | 'closePath'
>;

export type { Pt };

// ── Proportions ──────────────────────────────────────────────────────────────

/** Crown to pointed toe, in tiles, with the legs hanging straight. */
export const FAIRY_FIGURE_HEIGHT_TILES = 0.7;
/** Chibi on purpose: a creature meant to read as tiny is built from few, large heads. */
export const FAIRY_HEADS_TALL = 3.25;
/** One head height; every body measurement below is a multiple of it. */
const HEAD = FAIRY_FIGURE_HEIGHT_TILES / FAIRY_HEADS_TALL;

/** The ground line under the hovering fairy, where its shadow lies. */
export const GROUND_Y = 0.42;

const CROWN_TO_HIP_HEADS = 2.05;
/** How far below the hip joint the toes hang with the legs straight. */
const HIP_TO_TOE_TILES = FAIRY_FIGURE_HEIGHT_TILES - CROWN_TO_HIP_HEADS * HEAD;

// Measured from the hip (pelvis origin), in heads; negative is up.
const HEAD_CENTRE_Y = -1.55 * HEAD;
const HEAD_RADIUS_Y = 0.54 * HEAD;
const HEAD_RADIUS_X = 0.47 * HEAD;
const NECK_TOP_Y = -1.08 * HEAD;
const NECK_WIDTH = 0.16 * HEAD;
const SHOULDER_Y = -0.82 * HEAD;
const SHOULDER_HALF = 0.36 * HEAD;
const ARMPIT_Y = -0.6 * HEAD;
const ARMPIT_HALF = 0.28 * HEAD;
const WAIST_Y = -0.28 * HEAD;
const WAIST_HALF = 0.19 * HEAD;
const HIP_HALF = 0.27 * HEAD;
const CROTCH_Y = 0.14 * HEAD;

const ARM_ROOT_HALF = 0.31 * HEAD;
const ARM_ROOT_Y = -0.76 * HEAD;
const UPPER_ARM = 0.5 * HEAD;
const FOREARM = 0.44 * HEAD;
const UPPER_ARM_WIDTH = 0.18 * HEAD;
const FOREARM_WIDTH = 0.15 * HEAD;
const HAND_RADIUS = 0.1 * HEAD;

const LEG_ROOT_HALF = 0.14 * HEAD;
const LEG_ROOT_Y = 0.02 * HEAD;
/** Thigh + shin + pointed foot add up to the hip-to-toe drop the height leaves. */
const THIGH = HIP_TO_TOE_TILES * 0.45;
const SHIN = HIP_TO_TOE_TILES * 0.4;
const FOOT = HIP_TO_TOE_TILES * 0.15;
const THIGH_WIDTH = 0.26 * HEAD;
const SHIN_WIDTH = 0.17 * HEAD;
const FOOT_WIDTH = 0.1 * HEAD;
/** Toes point down and back: nothing this creature does ever plants a foot. */
const FOOT_POINT = deg(35);

const WING_ROOT_Y = -0.72 * HEAD;
const WING_ROOT_BACK = -0.12 * HEAD;
const WING_ROOT_HALF = 0.08 * HEAD;

const EAR_LENGTH = 0.32 * HEAD;
const EAR_ROOT_Y = -0.02 * HEAD;
const EYE_Y = 0.08 * HEAD;
const EYE_HALF_SPACING = 0.17 * HEAD;
const EYE_RADIUS = 0.095 * HEAD;
const EYE_GLOW_RADIUS = 0.2 * HEAD;

/**
 * The body's own measurements, from the constants that draw it: crown to
 * pointed toe with the legs hanging straight, and one head's height. The gates
 * re-derive the head count from these, so a head resized without its body
 * cannot drift the creature out of the size it is meant to read as.
 */
export function fairyBodyMeasure(): { readonly heightTiles: number; readonly headTiles: number } {
  const crown = HEAD_CENTRE_Y - HEAD_RADIUS_Y;
  const toe = LEG_ROOT_Y + THIGH + SHIN + FOOT;
  return { heightTiles: toe - crown, headTiles: HEAD_RADIUS_Y * 2 };
}

/** The chest, where the glow and every cast effect centres. */
const CHEST_Y = -0.55 * HEAD;
/** The neck starts a little below its nominal top, tucked under the torso's outline. */
const NECK_ROOT_DROP = 0.05 * HEAD;

// ── Rendering constants ──────────────────────────────────────────────────────

/** The silhouette outline, in screen pixels at whatever density the cell is baked. */
const OUTLINE_PX = 1;
/** The ink under an inked wing's edge: a pixel of it shows outside the edge colour. */
const WING_INK_PX = 3;
/** Below this many pixels tall a vein or a facet is under two pixels and reads as noise. */
export const DETAIL_MIN_FIGURE_PX = 34;
const DEGENERATE_DENSITY = 1e-6;

const SHADOW_RADIUS_X = 0.2;
const SHADOW_RADIUS_Y = 0.05;
const SHADOW_ALPHA = 0.45;
/** How much the shadow shrinks per tile of height, so a falling fairy's shadow grows to meet it. */
const SHADOW_SHRINK_PER_TILE = 0.9;
const SHADOW_MIN_SCALE = 0.45;

const GLOW_RADIUS = 0.36;
/** Where the glow's plateau ends, as a share of its radius, and how bright it still is there. */
const GLOW_CORE_SHARE = 0.25;
const GLOW_CORE_ALPHA = 0.7;

/** How hard a hurt flash drives the body toward its kind's hurt tint. */
const FLASH_STRENGTH = 0.6;
/** The far pair of limbs and wings sits in shadow. */
const FAR_SIDE_DARKEN = 0.3;

// ── Views ────────────────────────────────────────────────────────────────────

export type FairyView = 'front' | 'side' | 'away';

/**
 * What each view does that a multiplier cannot.
 *
 * A wing seen from the side is edge-on and nearly vanishes, which is honest and
 * unreadable: the wings are this creature's silhouette. The side view sweeps
 * them back further so they project as a wing rather than a line, and the
 * front and away views leave them spread in the back plane.
 */
interface ViewSpec {
  /** Torso width as a share of the front width. */
  readonly torsoGirth: number;
  /** Extra backward sweep on every wing, radians. */
  readonly wingSweepBias: number;
  /** Extra elevation on every wing, radians; negative lowers them toward the horizontal. */
  readonly wingElevationBias: number;
  /**
   * A lean into the direction of flight, radians. Only the profile can show
   * it: from the front or behind the same rotation would be a sideways roll.
   */
  readonly flightLean: number;
  /**
   * How far the far pair fans out beyond the near pair, radians: the forewing
   * higher, the hindwing lower. Seen side-on the two pairs otherwise land on
   * top of each other and four wings read as one lump.
   */
  readonly farWingFan: number;
  /** Wings root on the back, so from behind they cover the body. */
  readonly wingsInFront: boolean;
  readonly showsFace: boolean;
}

const VIEWS: ReadonlyMap<FairyView, ViewSpec> = new Map<FairyView, ViewSpec>([
  [
    'front',
    {
      torsoGirth: 1,
      wingSweepBias: 0,
      wingElevationBias: 0,
      flightLean: 0,
      farWingFan: 0,
      wingsInFront: false,
      showsFace: true,
    },
  ],
  [
    'side',
    {
      torsoGirth: 0.72,
      wingSweepBias: deg(68),
      wingElevationBias: deg(-12),
      flightLean: deg(9),
      farWingFan: deg(20),
      wingsInFront: false,
      showsFace: true,
    },
  ],
  [
    'away',
    {
      torsoGirth: 1,
      wingSweepBias: 0,
      wingElevationBias: 0,
      flightLean: 0,
      farWingFan: 0,
      wingsInFront: true,
      showsFace: false,
    },
  ],
]);

function viewSpec(view: FairyView): ViewSpec {
  const spec = VIEWS.get(view);
  if (spec === undefined) throw new Error(`no fairy view "${view}"`);
  return spec;
}

// ── Pose ─────────────────────────────────────────────────────────────────────

/**
 * A limb's angles, radians. `flex` swings it forward (toward the fairy's
 * front), `abduct` swings it out to the side, `bend` folds the second segment:
 * an elbow further forward, a knee backward.
 */
export interface LimbPose {
  readonly flex: number;
  readonly abduct: number;
  readonly bend: number;
}

/** Which spell effect the figure is painting in its hands, if any. */
export type FairyEffect = 'none' | 'ward' | 'heal' | 'beam' | 'lob' | 'raise' | 'push';

export interface FairyPose {
  /** How far the toes hang above the ground line, tiles. */
  readonly lift: number;
  /** Vertical offset of the whole body, tiles, + down. */
  readonly bob: number;
  /** Horizontal offset of the whole body, tiles: forward in the side view, screen-right otherwise. */
  readonly drift: number;
  /** Body rotation about the hip, radians: a forward lean from the side, a roll from front and back. */
  readonly tilt: number;
  /** 0–1 around one wingbeat. */
  readonly wingPhase: number;
  /** 1 spread for flight, 0 crumpled against the back. */
  readonly wingSpread: number;
  /** Multiplier on the beat's amplitude. */
  readonly wingFlap: number;
  readonly armRight: LimbPose;
  readonly armLeft: LimbPose;
  readonly legRight: LimbPose;
  readonly legLeft: LimbPose;
  readonly headTilt: number;
  readonly eyesShut: number;
  /** 0–1 hurt flash. */
  readonly flash: number;
  /** 0–1 opacity of the whole figure. */
  readonly fade: number;
  readonly effect: FairyEffect;
  /** 0–1 how strongly the effect is showing. */
  readonly effectAmount: number;
  /** 0–1 how far the gathering has come before the spell leaves (a bloom opening, a ring contracting). */
  readonly effectProgress: number;
  /** 0 until the release frame, then 0–1 through what the spell does as it leaves. */
  readonly effectRelease: number;
  /** 0–1 phase for anything that flickers: flames, embers, tatters, wisps. */
  readonly flicker: number;
  /** 0–1 how far the body has dissolved into motes. */
  readonly dissolve: number;
  /** 0–1 strength of the body glow: a dying fairy's light goes out as it falls. */
  readonly glow: number;
  /** 0–1 size of the star a blow leaves on the body, on the frames it lands. */
  readonly impact: number;
  /** 0–1 how far the puff of dust from a body hitting the ground has spread; 0 for none. */
  readonly dust: number;
  /**
   * 0–1 how far the whole figure, wings included, has gone to its kind's dead
   * colour: dulled steel, a withered leaf, frost, charcoal. It is what makes
   * a death read as that fairy's own ending rather than one fall recoloured.
   */
  readonly pallor: number;
  /**
   * 0–1 how far the shield fairy's buckler has fallen from its chest to stand
   * planted in the ground beside the body. Only a dying shield fairy sets it.
   */
  readonly sigilDrop: number;
}

const REST_ARM: LimbPose = { flex: deg(12), abduct: deg(16), bend: deg(28) };
/** Legs trail behind in flight: swung back at the hip and folded at the knee. */
const REST_LEG: LimbPose = { flex: deg(-16), abduct: deg(5), bend: deg(30) };

/** The fairy hanging in the air at the hover height, wings spread, doing nothing. */
export function restFairyPose(lift: number): FairyPose {
  return {
    lift,
    bob: 0,
    drift: 0,
    tilt: 0,
    wingPhase: 0,
    wingSpread: 1,
    wingFlap: 1,
    armRight: REST_ARM,
    armLeft: REST_ARM,
    legRight: REST_LEG,
    legLeft: REST_LEG,
    headTilt: 0,
    eyesShut: 0,
    flash: 0,
    fade: 1,
    effect: 'none',
    effectAmount: 0,
    effectProgress: 0,
    effectRelease: 0,
    flicker: 0,
    dissolve: 0,
    glow: 1,
    impact: 0,
    dust: 0,
    pallor: 0,
    sigilDrop: 0,
  };
}

// ── Designs ──────────────────────────────────────────────────────────────────

type WingKind = 'crystal' | 'leaf' | 'snowflake' | 'flame' | 'moth';

/**
 * The waveform of a kind's wingbeat, which is most of its temperament in
 * motion: every kind beats once per hover loop, so what tells them apart is
 * how the stroke is spent, not how fast it goes.
 */
type WingBeat =
  /** Holds at the top and bottom of the stroke and snaps between them: rigid plates, not membranes. */
  | 'stiff'
  /** A plain sine: an unhurried, even flutter. */
  | 'smooth'
  /** A quick, clean downstroke and a slower recovery. */
  | 'crisp'
  /** The stroke with faster harmonics laid over it, so no two frames of it rest. */
  | 'flicker'
  /** A heavy downstroke with a hitch on the way back up: torn wings that labour. */
  | 'ragged';
type WingPair = 'fore' | 'hind';

/** A face painted in its own tones rather than the body's. */
interface FaceTones {
  readonly light: string;
  readonly mid: string;
  readonly shade: string;
}

interface FairyPalette {
  readonly skin: string;
  readonly skinLight: string;
  readonly skinShade: string;
  /**
   * The face and ears, where they part from the body's skin; null paints them
   * in it. A face the same value as the wings behind it is lost at 32 px.
   */
  readonly face: FaceTones | null;
  /** The silhouette line. Light where the body is dark, so it reads as a rim. */
  readonly outline: string;
  readonly glow: string;
  readonly glowAlpha: number;
  readonly eye: string;
  readonly wingRoot: string;
  readonly wingTip: string;
  readonly wingEdge: string;
  readonly wingDetail: string;
  readonly wingAlpha: number;
  readonly hair: string;
  readonly hairShade: string;
  readonly accent: string;
  readonly accentShade: string;
  readonly accentBright: string;
  readonly hands: string;
  /**
   * The colour a blow flashes the body toward. Red, where the body is not
   * already red: a white flash that fades out reads as the creature
   * materialising, not as it being struck.
   */
  readonly hurtTint: string;
  /** The colour a dead fairy goes to; see {@link FairyPose.pallor}. */
  readonly pallorTint: string;
}

interface FairyDesign {
  readonly palette: FairyPalette;
  readonly wing: WingKind;
  /**
   * Lays a dark ink line under the wing's edge colour. A bright edge (gold,
   * say) is invisible on a pale floor and a dark one on a dark floor; ink
   * under gold reads on both. Off for a kind whose light edge is its rim
   * against the dark, which ink outside it would cut.
   */
  readonly wingInked: boolean;
  /**
   * The wing edge's width in screen pixels. The shield fairy's gold is its
   * whole identity against the ice fairy's blue, and a one-pixel line of it is
   * the first thing 32 px loses.
   */
  readonly wingEdgePx: number;
  /** Forewing and hindwing span, tiles. */
  readonly foreLength: number;
  readonly hindLength: number;
  /** Resting elevation of each pair above the horizontal, radians. */
  readonly foreElevation: number;
  readonly hindElevation: number;
  /** Degrees of beat: a crystal wing is rigid and barely moves, a moth's rows. */
  readonly flapElevation: number;
  readonly flapSweep: number;
  readonly beat: WingBeat;
}

const DESIGNS: ReadonlyMap<FairyKind, FairyDesign> = new Map<FairyKind, FairyDesign>([
  [
    'shield',
    {
      palette: {
        skin: '#3a66dc',
        skinLight: '#8aaef8',
        skinShade: '#1c348e',
        face: null,
        outline: '#070d2c',
        glow: '#72c6ff',
        glowAlpha: 0.5,
        eye: '#e6f7ff',
        wingRoot: '#2a64e0',
        wingTip: '#4a8cf4',
        wingEdge: '#ffd872',
        wingDetail: '#ffffff',
        wingAlpha: 0.9,
        hair: '#f0c95a',
        hairShade: '#9a6e1e',
        accent: '#f0c95a',
        accentShade: '#9a6e1e',
        accentBright: '#9fe0ff',
        hands: '#3a66dc',
        hurtTint: '#ff6a6a',
        pallorTint: '#8c95a8',
      },
      wing: 'crystal',
      wingEdgePx: 2,
      wingInked: true,
      foreLength: 0.46,
      hindLength: 0.31,
      foreElevation: deg(38),
      hindElevation: deg(-28),
      flapElevation: deg(14),
      flapSweep: deg(14),
      beat: 'stiff',
    },
  ],
  [
    'healer',
    {
      palette: {
        skin: '#4cb83e',
        skinLight: '#a6ec78',
        skinShade: '#2a7a28',
        face: null,
        outline: '#0b2610',
        glow: '#b4f58c',
        glowAlpha: 0.5,
        eye: '#fff6c8',
        wingRoot: '#8ed85c',
        wingTip: '#eaffc0',
        wingEdge: '#e2ffb6',
        wingDetail: '#2f7a26',
        wingAlpha: 0.84,
        hair: '#2a6a24',
        hairShade: '#16401a',
        accent: '#f6ecc6',
        accentShade: '#c8b886',
        accentBright: '#ff7fb4',
        hands: '#4cb83e',
        hurtTint: '#ff6a6a',
        pallorTint: '#8a6534',
      },
      wing: 'leaf',
      wingEdgePx: 1,
      wingInked: true,
      foreLength: 0.44,
      hindLength: 0.38,
      foreElevation: deg(26),
      hindElevation: deg(-66),
      flapElevation: deg(22),
      flapSweep: deg(30),
      beat: 'smooth',
    },
  ],
  [
    'ice',
    {
      palette: {
        // A breath of blue in the white, so the body keeps a value of its own on snow.
        skin: '#e0f0ff',
        skinLight: '#ffffff',
        skinShade: '#9cc4e8',
        face: null,
        outline: '#2c6cc0',
        glow: '#9ff0ff',
        glowAlpha: 0.55,
        eye: '#0a7fd4',
        wingRoot: '#a6e4fa',
        wingTip: '#ffffff',
        wingEdge: '#2c6cc0',
        wingDetail: '#ffffff',
        wingAlpha: 0.86,
        hair: '#dff1ff',
        hairShade: '#86b8e0',
        accent: '#9fdcff',
        accentShade: '#4d9ee0',
        accentBright: '#ffffff',
        hands: '#e0f0ff',
        hurtTint: '#ff6a8a',
        // Frozen solid, not bleached: a pale-blue corpse and its wings are the
        // colour of snow and vanish on it.
        pallorTint: '#7ab4e6',
      },
      wing: 'snowflake',
      wingEdgePx: 1,
      wingInked: false,
      foreLength: 0.54,
      hindLength: 0.3,
      foreElevation: deg(60),
      hindElevation: deg(-22),
      flapElevation: deg(20),
      flapSweep: deg(30),
      beat: 'crisp',
    },
  ],
  [
    'fire',
    {
      palette: {
        skin: '#dc2a30',
        skinLight: '#ff7858',
        skinShade: '#6a0c16',
        // A coal: soot-dark around the lit eyes, so the face stands out as a
        // dark hole in the blaze of hair and wings instead of red on orange.
        face: { light: '#6a1c14', mid: '#3a0c0c', shade: '#1c0506' },
        outline: '#240406',
        glow: '#ffa030',
        glowAlpha: 0.55,
        eye: '#fff4a0',
        wingRoot: '#e8401a',
        wingTip: '#ffe45a',
        wingEdge: '#b8300e',
        wingDetail: '#fff6b0',
        wingAlpha: 0.88,
        hair: '#ff6a14',
        hairShade: '#c02a10',
        accent: '#ffb428',
        accentShade: '#e04a14',
        accentBright: '#fff39a',
        hands: '#2a1a18',
        // A blow gutters a fire toward char. A pale flash on a body already
        // lit gold and orange bleaches the whole figure out.
        hurtTint: '#3a0a08',
        pallorTint: '#3a2c2a',
      },
      wing: 'flame',
      wingEdgePx: 1,
      wingInked: false,
      foreLength: 0.46,
      hindLength: 0.32,
      foreElevation: deg(40),
      hindElevation: deg(-24),
      flapElevation: deg(20),
      flapSweep: deg(30),
      beat: 'flicker',
    },
  ],
  [
    'necro',
    {
      palette: {
        skin: '#211b2a',
        skinLight: '#453a58',
        skinShade: '#0a080e',
        face: null,
        outline: '#b894f4',
        glow: '#8c5cff',
        glowAlpha: 0.35,
        eye: '#9dff6e',
        wingRoot: '#3c2a5c',
        wingTip: '#6c4e9c',
        wingEdge: '#b894f4',
        wingDetail: '#7ee070',
        wingAlpha: 1,
        hair: '#17121e',
        hairShade: '#0a080e',
        accent: '#e9e1cc',
        accentShade: '#a89c80',
        accentBright: '#9dff6e',
        hands: '#2b2436',
        hurtTint: '#ff5a8c',
        pallorTint: '#4a4058',
      },
      wing: 'moth',
      wingEdgePx: 1,
      wingInked: false,
      foreLength: 0.54,
      hindLength: 0.4,
      foreElevation: deg(30),
      hindElevation: deg(-32),
      flapElevation: deg(30),
      flapSweep: deg(24),
      beat: 'ragged',
    },
  ],
]);

function designOf(kind: FairyKind): FairyDesign {
  const design = DESIGNS.get(kind);
  if (design === undefined) throw new Error(`no fairy design "${kind}"`);
  return design;
}

/** The colours a figure's gates and effects need to agree with. */
export function fairyPaletteOf(kind: FairyKind): {
  readonly skin: string;
  readonly outline: string;
  readonly glow: string;
  readonly eye: string;
} {
  const { skin, outline, glow, eye } = designOf(kind).palette;
  return { skin, outline, glow, eye };
}

// ── Geometry helpers ─────────────────────────────────────────────────────────

interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

interface Projected extends Pt {
  readonly depth: number;
}

function v3(x: number, y: number, z: number): V3 {
  return { x, y, z };
}

function add3(a: V3, b: V3, scale: number): V3 {
  return v3(a.x + b.x * scale, a.y + b.y * scale, a.z + b.z * scale);
}

/** Projects a point of the fairy's own frame onto the view's picture plane. */
function project(p: V3, view: FairyView): Projected {
  if (view === 'front') return { x: -p.x, y: p.y, depth: p.z };
  if (view === 'away') return { x: p.x, y: p.y, depth: -p.z };
  return { x: p.z, y: p.y, depth: p.x };
}

/**
 * The direction of a limb segment hanging down, swung forward by `flex` and
 * out to `side` by `abduct`.
 */
function limbDirection(flex: number, abduct: number, side: number): V3 {
  return v3(
    side * Math.sin(abduct) * Math.cos(flex),
    Math.cos(abduct) * Math.cos(flex),
    Math.sin(flex),
  );
}

interface LimbChain {
  readonly root: Projected;
  readonly joint: Projected;
  readonly tip: Projected;
  /** The foot's toe, or the hand's centre. */
  readonly end: Projected;
  readonly depth: number;
}

/** The hand's centre sits this share of its radius past the wrist, so the fist covers the forearm's end. */
const HAND_REACH_SHARE = 0.6;
/** The shin and foot swing out less than the thigh: a dangling lower leg hangs back under the knee. */
const SHIN_ABDUCT_SHARE = 0.6;

function armChain(pose: LimbPose, side: number, view: FairyView): LimbChain {
  const root = v3(side * ARM_ROOT_HALF, ARM_ROOT_Y, 0);
  const elbow = add3(root, limbDirection(pose.flex, pose.abduct, side), UPPER_ARM);
  const wrist = add3(elbow, limbDirection(pose.flex + pose.bend, pose.abduct, side), FOREARM);
  const hand = add3(
    wrist,
    limbDirection(pose.flex + pose.bend, pose.abduct, side),
    HAND_RADIUS * HAND_REACH_SHARE,
  );
  const projected = [root, elbow, wrist, hand].map((p) => project(p, view));
  return {
    root: projected[0],
    joint: projected[1],
    tip: projected[2],
    end: projected[3],
    depth: (projected[1].depth + projected[2].depth) / 2,
  };
}

function legChain(pose: LimbPose, side: number, view: FairyView): LimbChain {
  const root = v3(side * LEG_ROOT_HALF, LEG_ROOT_Y, 0);
  const knee = add3(root, limbDirection(pose.flex, pose.abduct, side), THIGH);
  const shinFlex = pose.flex - pose.bend;
  const shinAbduct = pose.abduct * SHIN_ABDUCT_SHARE;
  const ankle = add3(knee, limbDirection(shinFlex, shinAbduct, side), SHIN);
  const toe = add3(ankle, limbDirection(shinFlex - FOOT_POINT, shinAbduct, side), FOOT);
  const projected = [root, knee, ankle, toe].map((p) => project(p, view));
  return {
    root: projected[0],
    joint: projected[1],
    tip: projected[2],
    end: projected[3],
    depth: (projected[1].depth + projected[2].depth) / 2,
  };
}

// ── Ink: the two-pass outline/fill painter ───────────────────────────────────

type Pass = 'outline' | 'fill';

interface Ink {
  readonly ctx: Ctx;
  readonly design: FairyDesign;
  readonly pose: FairyPose;
  readonly view: FairyView;
  /** One screen pixel, in the tile units the painter draws in. */
  readonly px: number;
  readonly detailed: boolean;
}

/** A colour gone toward the kind's dead colour by the pose's pallor. */
function pallid(ink: Ink, color: string): string {
  if (ink.pose.pallor <= 0) return color;
  return mix(color, ink.design.palette.pallorTint, clamp01(ink.pose.pallor));
}

/** A colour with the pallor and the hurt flash applied. */
function tinted(ink: Ink, color: string): string {
  const pale = pallid(ink, color);
  if (ink.pose.flash <= 0) return pale;
  return mix(pale, ink.design.palette.hurtTint, ink.pose.flash * FLASH_STRENGTH);
}

function segment(
  ink: Ink,
  pass: Pass,
  a: Pt,
  b: Pt,
  width: number,
  color: string,
  outline: string = ink.design.palette.outline,
): void {
  const { ctx } = ink;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  if (pass === 'outline') {
    ctx.strokeStyle = outline;
    ctx.lineWidth = width + ink.px * OUTLINE_PX * 2;
  } else {
    ctx.strokeStyle = tinted(ink, color);
    ctx.lineWidth = width;
  }
  ctx.stroke();
}

function blob(
  ink: Ink,
  pass: Pass,
  trace: () => void,
  fill: string | CanvasGradient,
  outline: string = ink.design.palette.outline,
): void {
  const { ctx } = ink;
  ctx.beginPath();
  trace();
  if (pass === 'outline') {
    ctx.lineJoin = 'round';
    ctx.strokeStyle = outline;
    ctx.lineWidth = ink.px * OUTLINE_PX * 2;
    ctx.stroke();
    ctx.fillStyle = outline;
    ctx.fill();
    return;
  }
  ctx.fillStyle = typeof fill === 'string' ? tinted(ink, fill) : fill;
  ctx.fill();
}

function dot(ctx: Ctx, x: number, y: number, radius: number, color: string): void {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.arc(x, y, Math.max(radius, DEGENERATE_DENSITY), 0, Math.PI * 2);
  ctx.fill();
}

/** The classic shader sine-hash constants: large, irrational-looking multipliers that scramble neighbouring integers. */
const HASH_INDEX_SCALE = 127.1;
const HASH_SALT_SCALE = 311.7;
const HASH_SPREAD = 43758.5453;

/** Deterministic 0–1 noise of an integer and a salt, for tatters, embers and sparkles. */
function hash01(index: number, salt: number): number {
  const s = Math.sin(index * HASH_INDEX_SCALE + salt * HASH_SALT_SCALE) * HASH_SPREAD;
  return s - Math.floor(s);
}

// ── Wings ────────────────────────────────────────────────────────────────────

/**
 * A wing's shape in its own unit frame: u runs root to tip along the span, v
 * across the chord with the leading edge at negative v. The painter maps that
 * frame onto the projected span and chord vectors with one affine transform,
 * so a wing sweeping away from the viewer foreshortens for free.
 */
function traceWing(
  ctx: PathSink,
  kind: WingKind,
  pair: WingPair,
  flicker: number,
  burn: number,
): void {
  if (kind === 'crystal') traceCrystalWing(ctx, pair);
  else if (kind === 'leaf') traceLeafWing(ctx, pair);
  else if (kind === 'snowflake') traceSnowflakeWing(ctx, pair);
  else if (kind === 'flame') traceFlameWing(ctx, pair, flicker, burn);
  else traceMothWing(ctx, pair, flicker);
}

function polygon(ctx: PathSink, points: readonly (readonly [number, number])[]): void {
  points.forEach(([u, v], index) => {
    if (index === 0) ctx.moveTo(u, v);
    else ctx.lineTo(u, v);
  });
  ctx.closePath();
}

/** Cut glass: straight edges and hard corners, nothing organic about it. */
const CRYSTAL_FORE: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.22, -0.26],
  [0.6, -0.4],
  [1, -0.3],
  [0.84, 0.02],
  [0.5, 0.2],
  [0.14, 0.14],
];
const CRYSTAL_HIND: readonly (readonly [number, number])[] = [
  [0, 0],
  [0.36, -0.2],
  [0.86, -0.14],
  [1, 0.14],
  [0.56, 0.3],
  [0.12, 0.14],
];
/** Facet lines: pairs of vertex indices in the matching outline above. */
const CRYSTAL_FORE_FACETS: readonly (readonly [number, number])[] = [
  [0, 2],
  [0, 4],
  [2, 5],
  [2, 4],
];
const CRYSTAL_HIND_FACETS: readonly (readonly [number, number])[] = [
  [0, 2],
  [2, 4],
  [0, 3],
];

function traceCrystalWing(ctx: PathSink, pair: WingPair): void {
  polygon(ctx, pair === 'fore' ? CRYSTAL_FORE : CRYSTAL_HIND);
}

/** A leaf wing's half-width in its unit frame; the hind pair is the broader. */
const LEAF_FORE_WIDTH = 0.5;
const LEAF_HIND_WIDTH = 0.58;
/**
 * The leaf's two edges as cubic control points, (u, share of the width): the
 * leading edge bellies out early and runs straight to the tip, the trailing
 * edge is fuller and rounder, so the leaf is not a symmetric lens.
 */
const LEAF_LEADING_CURVE = { first: [0.22, 1], second: [0.66, 0.8] } as const;
const LEAF_TRAILING_CURVE = { first: [0.68, 0.62], second: [0.24, 0.8] } as const;

/** A leaf: broad at the base, drawn to a point, with a midrib to hang veins off. */
function traceLeafWing(ctx: PathSink, pair: WingPair): void {
  const width = pair === 'fore' ? LEAF_FORE_WIDTH : LEAF_HIND_WIDTH;
  const lead = LEAF_LEADING_CURVE;
  const trail = LEAF_TRAILING_CURVE;
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(
    lead.first[0],
    -width * lead.first[1],
    lead.second[0],
    -width * lead.second[1],
    1,
    0,
  );
  ctx.bezierCurveTo(
    trail.first[0],
    width * trail.first[1],
    trail.second[0],
    width * trail.second[1],
    0,
    0,
  );
  ctx.closePath();
}

const SNOWFLAKE_TEETH = 7;
/** A frost wing's half-width in its unit frame: long and slim, the hind pair a little fuller. */
const SNOWFLAKE_FORE_WIDTH = 0.24;
const SNOWFLAKE_HIND_WIDTH = 0.32;
/** Which of a tooth's samples carries the tooth: the middle one, clear of both neighbours. */
const SNOWFLAKE_TOOTH_SAMPLE = 2;
/** The wing's midpoint along its span, which the teeth point away from. */
const SNOWFLAKE_CENTRE_U = 0.5;
const SNOWFLAKE_TOOTH_DEPTH = 0.12;
/** Samples per tooth: three rim points plus the tooth's own point. */
const SNOWFLAKE_SAMPLES_PER_TOOTH = 4;
/** How far around the taper's own half-cycle the rim's width swells before narrowing again. */
const SNOWFLAKE_RIM_TAPER_SHARE = 0.9;
/** Offsets the taper's phase so the rim already has width at the root instead of pinching to zero. */
const SNOWFLAKE_RIM_TAPER_PHASE = 0.2;
/** How far from the tooth's base the rim kinks outward into its shoulder, as a share of the tooth's own spread. */
const SNOWFLAKE_TOOTH_SHOULDER = 0.55;
/** Sideways nudge at each shoulder, in the wing's unit frame: without it the tooth reads as a plain triangle. */
const SNOWFLAKE_TOOTH_KINK = 0.05;

/** A long frost wing whose whole rim is crystal teeth, each with a branch of its own. */
function traceSnowflakeWing(ctx: PathSink, pair: WingPair): void {
  const width = pair === 'fore' ? SNOWFLAKE_FORE_WIDTH : SNOWFLAKE_HIND_WIDTH;
  const rim = (t: number): Pt => {
    // Around the teardrop: t 0 → 1 runs root, leading edge, tip, trailing edge, root.
    const angle = t * Math.PI * 2;
    const u = (1 - Math.cos(angle)) / 2;
    const v =
      -Math.sin(angle) *
      width *
      Math.sin(u * Math.PI * SNOWFLAKE_RIM_TAPER_SHARE + SNOWFLAKE_RIM_TAPER_PHASE);
    return { x: u, y: v };
  };
  const samples = SNOWFLAKE_TEETH * SNOWFLAKE_SAMPLES_PER_TOOTH;
  ctx.moveTo(0, 0);
  for (let i = 1; i <= samples; i++) {
    const t = i / samples;
    const p = rim(t);
    const isTooth = i % SNOWFLAKE_SAMPLES_PER_TOOTH === SNOWFLAKE_TOOTH_SAMPLE && i < samples - 1;
    if (!isTooth) {
      ctx.lineTo(p.x, p.y);
      continue;
    }
    const halfSample = 1 / (2 * samples);
    const before = rim(t - halfSample);
    const after = rim(t + halfSample);
    const cx = (before.x + after.x) / 2;
    const cy = (before.y + after.y) / 2;
    const outward = Math.hypot(p.x - SNOWFLAKE_CENTRE_U, p.y) || 1;
    const nx = (p.x - SNOWFLAKE_CENTRE_U) / outward;
    const ny = p.y / outward;
    const tipX = cx + nx * SNOWFLAKE_TOOTH_DEPTH;
    const tipY = cy + ny * SNOWFLAKE_TOOTH_DEPTH;
    ctx.lineTo(before.x, before.y);
    ctx.lineTo(
      lerp(cx, tipX, SNOWFLAKE_TOOTH_SHOULDER) - ny * SNOWFLAKE_TOOTH_KINK,
      lerp(cy, tipY, SNOWFLAKE_TOOTH_SHOULDER) + nx * SNOWFLAKE_TOOTH_KINK,
    );
    const midX = (cx + tipX) / 2;
    const midY = (cy + tipY) / 2;
    ctx.lineTo(midX, midY);
    ctx.lineTo(tipX, tipY);
    ctx.lineTo(midX, midY);
    ctx.lineTo(
      lerp(cx, tipX, SNOWFLAKE_TOOTH_SHOULDER) + ny * SNOWFLAKE_TOOTH_KINK,
      lerp(cy, tipY, SNOWFLAKE_TOOTH_SHOULDER) - nx * SNOWFLAKE_TOOTH_KINK,
    );
    ctx.lineTo(after.x, after.y);
  }
  ctx.closePath();
}

const FLAME_TONGUES = 4;
/** A flame wing's half-width in its unit frame. */
const FLAME_FORE_WIDTH = 0.3;
const FLAME_HIND_WIDTH = 0.34;
/**
 * The leading edge as cubic control points and end, (u, share of the width):
 * it bows out high and ends just past the span, slightly back, where the
 * trailing tongues begin.
 */
const FLAME_LEADING_CURVE = { first: [0.25, 1.2], second: [0.7, 1.1], tip: [1.02, 0.55] } as const;
/** The trailing edge runs from near the tip (outer) back toward the root (inner), in u, and down to this share of the width. */
const FLAME_TRAIL_OUTER_U = 0.92;
const FLAME_TRAIL_INNER_U = 0.18;
const FLAME_TRAIL_INNER_V = 0.55;
/** Tongue i flickers at (base + i) cycles a loop, so no two lick in step. */
const FLAME_TONGUE_BASE_RATE = 2;
const FLAME_TONGUE_SALT = 3;
/** How far a tongue's tip reaches out along the span and down across the width, and how much a lick varies each. */
const FLAME_TONGUE_REACH_U = 0.22;
const FLAME_TONGUE_LICK_U = 0.06;
const FLAME_TONGUE_REACH_V = 0.75;
const FLAME_TONGUE_LICK_V = 0.2;
/** Control-point offsets that curl each tongue: its leading side bends back, its trailing side swells out. */
const FLAME_TONGUE_LEAD_BEND = 0.02;
const FLAME_TONGUE_LEAD_LIFT = 0.25;
const FLAME_TONGUE_TRAIL_BEND = 0.05;

/** How short a guttered-out flame wing's tongues get, as a share of their full lick. */
const FLAME_GUTTERED_TONGUE = 0.25;

/**
 * A wing whose trailing edge is licking flame. The tongues' tips move with
 * `flicker` at different rates, so the edge burns rather than waves, and
 * shorten with `burn`, the body's glow, so a dying fire fairy's wings gutter.
 */
function traceFlameWing(ctx: PathSink, pair: WingPair, flicker: number, burn: number): void {
  const tongue = lerp(FLAME_GUTTERED_TONGUE, 1, clamp01(burn));
  const width = pair === 'fore' ? FLAME_FORE_WIDTH : FLAME_HIND_WIDTH;
  const lead = FLAME_LEADING_CURVE;
  ctx.moveTo(0, 0);
  ctx.bezierCurveTo(
    lead.first[0],
    -width * lead.first[1],
    lead.second[0],
    -width * lead.second[1],
    lead.tip[0],
    -width * lead.tip[1],
  );
  for (let i = 0; i < FLAME_TONGUES; i++) {
    const t0 = i / FLAME_TONGUES;
    const t1 = (i + 1) / FLAME_TONGUES;
    const baseU0 = lerp(FLAME_TRAIL_OUTER_U, FLAME_TRAIL_INNER_U, t0);
    const baseU1 = lerp(FLAME_TRAIL_OUTER_U, FLAME_TRAIL_INNER_U, t1);
    const baseV0 = lerp(0, width * FLAME_TRAIL_INNER_V, t0);
    const baseV1 = lerp(0, width * FLAME_TRAIL_INNER_V, t1);
    const beatsPerLoop = FLAME_TONGUE_BASE_RATE + i;
    const lick = Math.sin((flicker * beatsPerLoop + hash01(i, FLAME_TONGUE_SALT)) * Math.PI * 2);
    const reachU = FLAME_TONGUE_REACH_U + lick * FLAME_TONGUE_LICK_U;
    const reachV = FLAME_TONGUE_REACH_V + FLAME_TONGUE_LICK_V * lick;
    const tipU = (baseU0 + baseU1) / 2 + reachU * tongue;
    const tipV = (baseV0 + baseV1) / 2 + width * reachV * tongue;
    if (i === 0) ctx.lineTo(baseU0, baseV0);
    ctx.quadraticCurveTo(
      tipU - FLAME_TONGUE_LEAD_BEND,
      tipV - width * FLAME_TONGUE_LEAD_LIFT,
      tipU,
      tipV,
    );
    ctx.quadraticCurveTo(baseU1 + FLAME_TONGUE_TRAIL_BEND, (tipV + baseV1) / 2, baseU1, baseV1);
  }
  ctx.lineTo(0, 0);
  ctx.closePath();
}

const MOTH_RAGGED_NOTCHES = 5;
/**
 * A moth wing in its unit frame: the leading edge bows out to an apex just
 * short of the tip, the blunt outer edge drops away from it, and the ragged
 * trailing edge runs back in to end well down the wing. The forewing is tall
 * and triangular, the hindwing low and rounded.
 */
const MOTH_FORE_APEX_V = -0.48;
const MOTH_HIND_APEX_V = -0.16;
const MOTH_APEX_U = 0.92;
const MOTH_LEADING_BEND_U = 0.3;
const MOTH_LEADING_BULGE = 1.05;
const MOTH_OUTER_DROP = 0.14;
const MOTH_FORE_END_U = 0.52;
const MOTH_HIND_END_U = 0.4;
const MOTH_FORE_END_V = 0.4;
const MOTH_HIND_END_V = 0.5;
const MOTH_TRAILING_BEND_U = 0.2;
const MOTH_TRAILING_BULGE = 0.8;
/** Each rag is torn this deep, give or take its share of the variance, back and up into the wing. */
const MOTH_NOTCH_DEPTH = 0.08;
const MOTH_NOTCH_VARIANCE = 0.06;
const MOTH_NOTCH_BACK = 0.7;
const MOTH_NOTCH_UP = 0.3;
const MOTH_FORE_NOTCH_SALT = 5;
const MOTH_HIND_NOTCH_SALT = 7;
/** The rags flutter out of step with each other, a hair's width either way. */
const MOTH_FLUTTER_STAGGER = 0.3;
const MOTH_FLUTTER_REACH = 0.015;
/**
 * Where the holes are torn, as (u, v, radius) in the wing's unit frame. Placed
 * by hand, apart and off-axis: two holes one above the other read as the digit
 * 8 at 32 px.
 */
const MOTH_FORE_HOLES: readonly (readonly [number, number, number])[] = [
  [0.74, -0.24, 0.075],
  [0.42, 0.08, 0.05],
];
const MOTH_HIND_HOLES: readonly (readonly [number, number, number])[] = [[0.6, 0.18, 0.065]];

/**
 * A moth's wing, broad and blunt, gone to rags: a notched outer edge and holes
 * right through the membrane. The holes are sub-paths filled even-odd.
 */
function traceMothWing(ctx: PathSink, pair: WingPair, flicker: number): void {
  const fore = pair === 'fore';
  const apexV = fore ? MOTH_FORE_APEX_V : MOTH_HIND_APEX_V;
  const shoulderV = apexV + MOTH_OUTER_DROP;
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(MOTH_LEADING_BEND_U, apexV * MOTH_LEADING_BULGE, MOTH_APEX_U, apexV);
  ctx.lineTo(1, shoulderV);
  const endU = fore ? MOTH_FORE_END_U : MOTH_HIND_END_U;
  const endV = fore ? MOTH_FORE_END_V : MOTH_HIND_END_V;
  for (let i = 1; i <= MOTH_RAGGED_NOTCHES; i++) {
    const t = i / MOTH_RAGGED_NOTCHES;
    const u = lerp(1, endU, t);
    const v = lerp(shoulderV, endV, t);
    const salt = fore ? MOTH_FORE_NOTCH_SALT : MOTH_HIND_NOTCH_SALT;
    const notch = MOTH_NOTCH_DEPTH + MOTH_NOTCH_VARIANCE * hash01(i, salt);
    const flutter =
      Math.sin((flicker + i * MOTH_FLUTTER_STAGGER) * Math.PI * 2) * MOTH_FLUTTER_REACH;
    ctx.lineTo(u - notch * MOTH_NOTCH_BACK + flutter, v - notch * MOTH_NOTCH_UP);
    ctx.lineTo(u, v);
  }
  ctx.quadraticCurveTo(MOTH_TRAILING_BEND_U, endV * MOTH_TRAILING_BULGE, 0, 0);
  ctx.closePath();
  for (const [u, v, radius] of fore ? MOTH_FORE_HOLES : MOTH_HIND_HOLES) {
    ctx.moveTo(u + radius, v);
    ctx.arc(u, v, radius, 0, Math.PI * 2, true);
  }
}

/** Interior lines: facets, veins, frost spines. Traced in the wing's unit frame. */
function traceWingDetail(ctx: Ctx, kind: WingKind, pair: WingPair): void {
  if (kind === 'crystal') {
    const outline = pair === 'fore' ? CRYSTAL_FORE : CRYSTAL_HIND;
    const facets = pair === 'fore' ? CRYSTAL_FORE_FACETS : CRYSTAL_HIND_FACETS;
    for (const [from, to] of facets) {
      ctx.moveTo(outline[from][0], outline[from][1]);
      ctx.lineTo(outline[to][0], outline[to][1]);
    }
    return;
  }
  if (kind === 'leaf') {
    const midrib = LEAF_MIDRIB_CURVE;
    ctx.moveTo(0, 0);
    ctx.quadraticCurveTo(midrib.bend[0], midrib.bend[1], midrib.tip[0], midrib.tip[1]);
    for (const u of LEAF_VEIN_ROOTS) {
      ctx.moveTo(u, LEAF_VEIN_ROOT_V);
      ctx.lineTo(u + LEAF_VEIN_LEADING[0], LEAF_VEIN_LEADING[1]);
      ctx.moveTo(u, LEAF_VEIN_ROOT_V);
      ctx.lineTo(u + LEAF_VEIN_TRAILING[0], LEAF_VEIN_TRAILING[1]);
    }
    return;
  }
  if (kind === 'snowflake') {
    ctx.moveTo(FROST_SPINE_START_U, 0);
    ctx.lineTo(FROST_SPINE_END_U, 0);
    for (const u of FROST_BRANCH_ROOTS) {
      const arm = FROST_BRANCH_LENGTH * (FROST_BRANCH_ROOT_SCALE - u * FROST_BRANCH_TAPER);
      ctx.moveTo(u, 0);
      ctx.lineTo(u + arm, -arm);
      ctx.moveTo(u, 0);
      ctx.lineTo(u + arm, arm);
    }
    return;
  }
  if (kind === 'moth') {
    const [eyeU, eyeV] = pair === 'fore' ? MOTH_FORE_EYESPOT : MOTH_HIND_EYESPOT;
    ctx.moveTo(eyeU + MOTH_EYESPOT_RADIUS, eyeV);
    ctx.arc(eyeU, eyeV, MOTH_EYESPOT_RADIUS, 0, Math.PI * 2);
    return;
  }
  ctx.moveTo(FLAME_VEIN_START_U, 0);
  ctx.quadraticCurveTo(
    FLAME_VEIN_CURVE.bend[0],
    FLAME_VEIN_CURVE.bend[1],
    FLAME_VEIN_CURVE.tip[0],
    FLAME_VEIN_CURVE.tip[1],
  );
}

/** A leaf's midrib, bowing a little toward the leading edge, and its paired veins, (u, v) in the wing's unit frame. */
const LEAF_MIDRIB_CURVE = { bend: [0.5, -0.04], tip: [0.96, -0.02] } as const;
const LEAF_VEIN_ROOTS: readonly number[] = [0.3, 0.52, 0.72];
const LEAF_VEIN_ROOT_V = -0.02;
const LEAF_VEIN_LEADING = [0.14, -0.2] as const;
const LEAF_VEIN_TRAILING = [0.12, 0.17] as const;
/** A frost wing's spine and the V-branches off it, shortening toward the tip. */
const FROST_SPINE_START_U = 0.04;
const FROST_SPINE_END_U = 0.9;
const FROST_BRANCH_ROOTS: readonly number[] = [0.3, 0.55, 0.75];
const FROST_BRANCH_LENGTH = 0.1;
const FROST_BRANCH_ROOT_SCALE = 1.1;
const FROST_BRANCH_TAPER = 0.5;
/** The eyespot ring on each moth wing, (u, v), and its radius. */
const MOTH_FORE_EYESPOT = [0.62, -0.12] as const;
const MOTH_HIND_EYESPOT = [0.5, 0.1] as const;
const MOTH_EYESPOT_RADIUS = 0.09;
/** The one vein down a flame wing, rising gently toward its leading edge. */
const FLAME_VEIN_START_U = 0.05;
const FLAME_VEIN_CURVE = { bend: [0.5, -0.1], tip: [0.95, -0.12] } as const;

interface WingFrame {
  readonly root: Pt;
  readonly span: Pt;
  readonly chord: Pt;
  readonly depth: number;
}

/**
 * A wing's frame in the picture: its root and its span and chord vectors,
 * projected. The wing is laid out in the back plane at `elevation` above the
 * horizontal and then swept back about the vertical axis; a positive sweep
 * takes the tip behind the body.
 */
function wingFrame(
  side: number,
  length: number,
  elevation: number,
  sweep: number,
  view: FairyView,
): WingFrame {
  const root3 = v3(side * WING_ROOT_HALF, WING_ROOT_Y, WING_ROOT_BACK);
  const spanPlane = v3(side * Math.cos(elevation), -Math.sin(elevation), 0);
  const chordPlane = v3(side * Math.sin(elevation), Math.cos(elevation), 0);
  const swept = (p: V3): V3 => v3(p.x * Math.cos(sweep), p.y, -side * p.x * Math.sin(sweep));
  const span3 = swept(spanPlane);
  const chord3 = swept(chordPlane);
  const root = project(root3, view);
  const tip = project(add3(root3, span3, length), view);
  const chordEnd = project(add3(root3, chord3, length), view);
  return {
    root,
    span: { x: tip.x - root.x, y: tip.y - root.y },
    chord: { x: chordEnd.x - root.x, y: chordEnd.y - root.y },
    depth: (root.depth + tip.depth) / 2,
  };
}

function wingGradient(ink: Ink, frame: WingFrame, darken: number): CanvasGradient {
  const { ctx, design } = ink;
  const { palette } = design;
  const gradient = ctx.createLinearGradient(
    frame.root.x,
    frame.root.y,
    frame.root.x + frame.span.x,
    frame.root.y + frame.span.y,
  );
  // The hurt flash stays off the wings: bleached wings vanish on a pale floor,
  // and the silhouette is what says which fairy was hit.
  const root = mix(pallid(ink, palette.wingRoot), palette.outline, darken);
  const tip = mix(pallid(ink, palette.wingTip), palette.outline, darken);
  gradient.addColorStop(0, rgba(root, palette.wingAlpha));
  gradient.addColorStop(1, rgba(tip, palette.wingAlpha));
  return gradient;
}

function paintWing(ink: Ink, pair: WingPair, frame: WingFrame, darken: number): void {
  const { ctx, design, pose } = ink;
  const { palette } = design;
  ctx.save();
  ctx.transform(
    frame.span.x,
    frame.span.y,
    frame.chord.x,
    frame.chord.y,
    frame.root.x,
    frame.root.y,
  );
  ctx.beginPath();
  traceWing(ctx, design.wing, pair, pose.flicker, pose.glow);
  ctx.restore();
  ctx.fillStyle = wingGradient(ink, frame, darken);
  ctx.fill('evenodd');
  ctx.lineJoin = 'round';
  if (design.wingInked) {
    ctx.strokeStyle = palette.outline;
    ctx.lineWidth = ink.px * WING_INK_PX;
    ctx.stroke();
  }
  ctx.strokeStyle = mix(pallid(ink, palette.wingEdge), palette.outline, darken);
  ctx.lineWidth = ink.px * design.wingEdgePx;
  ctx.stroke();

  if (!ink.detailed) {
    if (design.wing === 'leaf') paintLeafMidrib(ink, frame, darken);
    return;
  }
  ctx.save();
  ctx.transform(
    frame.span.x,
    frame.span.y,
    frame.chord.x,
    frame.chord.y,
    frame.root.x,
    frame.root.y,
  );
  ctx.beginPath();
  traceWingDetail(ctx, design.wing, pair);
  ctx.restore();
  ctx.strokeStyle = rgba(mix(palette.wingDetail, palette.outline, darken), WING_DETAIL_ALPHA);
  ctx.lineWidth = ink.px * WING_DETAIL_PX;
  ctx.stroke();
}

/**
 * The leaf's midrib at sizes too small for veins: a dark line down each leaf
 * is what keeps four pale leaves from fusing into one pad at 32 px.
 */
function paintLeafMidrib(ink: Ink, frame: WingFrame, darken: number): void {
  const { ctx, design } = ink;
  ctx.strokeStyle = mix(design.palette.wingDetail, design.palette.outline, darken);
  ctx.lineWidth = ink.px;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(frame.root.x, frame.root.y);
  ctx.lineTo(
    frame.root.x + frame.span.x * LEAF_MIDRIB_REACH,
    frame.root.y + frame.span.y * LEAF_MIDRIB_REACH,
  );
  ctx.stroke();
}

const LEAF_MIDRIB_REACH = 0.85;
const WING_DETAIL_ALPHA = 0.7;
const WING_DETAIL_PX = 0.8;
/** Hindwings lag the forewings by this share of a beat, as a dragonfly's do. */
const HIND_WING_LAG = 0.18;
/** The fore-and-aft sweep swings half as far as the kind's full sweep: the beat is mostly up and down. */
const SWEEP_STROKE_SHARE = 0.5;
/** How far a crumpled wing droops, radians, at wingSpread 0. */
const CRUMPLED_DROOP = deg(70);
const CRUMPLED_SPAN = 0.55;

const STIFF_HOLD_EXPONENT = 0.3;
/** The quarter of the stroke a stiff wing still sweeps, against a membrane's full sweep. */
const STIFF_SWEEP_SHARE = 0.3;
/**
 * How far the crisp stroke's timing is warped toward a fast downstroke; under
 * 1 keeps it monotonic. The fast part falls mid-loop, away from the loop's seam.
 */
const CRISP_WARP = 0.65;
const FLICKER_THIRD = 0.4;
const FLICKER_FIFTH = 0.22;
const FLICKER_THIRD_PHASE = 0.9;
const FLICKER_FIFTH_PHASE = 2.1;
const FLICKER_SWEEP_SECOND = 0.35;
const FLICKER_SWEEP_PHASE = 0.4;
/** Turns the flicker's uneven stroke so its sharpest twitch falls mid-loop rather than on the loop's seam. */
const FLICKER_STROKE_OFFSET = Math.PI / 2;
const RAGGED_HITCH = 0.4;
const RAGGED_SWEEP_SHARE = 0.6;
const RAGGED_SWEEP_HITCH = 0.3;

/**
 * A wingbeat's shape at `angle` radians through the stroke: `rise` lifts the
 * wing, `sweep` swings it back, each roughly in -1…1. Only whole harmonics of
 * the stroke are used, so every waveform closes its loop.
 */
function wingStroke(
  beat: WingBeat,
  angle: number,
): { readonly rise: number; readonly sweep: number } {
  if (beat === 'stiff') {
    const s = Math.sin(angle);
    return {
      rise: Math.sign(s) * Math.abs(s) ** STIFF_HOLD_EXPONENT,
      sweep: Math.cos(angle) * STIFF_SWEEP_SHARE,
    };
  }
  if (beat === 'crisp') {
    const warped = angle - CRISP_WARP * Math.sin(angle);
    return { rise: Math.sin(warped), sweep: Math.cos(warped) };
  }
  if (beat === 'flicker') {
    const turned = angle + FLICKER_STROKE_OFFSET;
    return {
      rise:
        Math.sin(turned) +
        FLICKER_THIRD * Math.sin(3 * turned + FLICKER_THIRD_PHASE) +
        FLICKER_FIFTH * Math.sin(5 * turned + FLICKER_FIFTH_PHASE),
      sweep: Math.cos(turned) + FLICKER_SWEEP_SECOND * Math.cos(2 * turned + FLICKER_SWEEP_PHASE),
    };
  }
  if (beat === 'ragged') {
    return {
      rise: Math.sin(angle) - RAGGED_HITCH * Math.sin(2 * angle),
      sweep: Math.cos(angle) * RAGGED_SWEEP_SHARE + RAGGED_SWEEP_HITCH * Math.sin(2 * angle),
    };
  }
  return { rise: Math.sin(angle), sweep: Math.cos(angle) };
}

/** Every wing's frame for a pose and view, far pair and near pair alike. */
function wingFrames(
  design: FairyDesign,
  pose: FairyPose,
  view: FairyView,
): { frame: WingFrame; pair: WingPair }[] {
  const spec = viewSpec(view);
  const beat = pose.wingPhase * Math.PI * 2;
  const spread = clamp01(pose.wingSpread);
  const lengthScale = lerp(CRUMPLED_SPAN, 1, spread);
  const frames: { frame: WingFrame; pair: WingPair }[] = [];
  for (const side of [-1, 1]) {
    for (const pair of ['hind', 'fore'] as const) {
      const lag = pair === 'hind' ? HIND_WING_LAG * Math.PI * 2 : 0;
      const restElevation = pair === 'fore' ? design.foreElevation : design.hindElevation;
      const stroke = wingStroke(design.beat, beat - lag);
      const elevation =
        restElevation +
        spec.wingElevationBias +
        (side < 0 ? (pair === 'fore' ? spec.farWingFan : -spec.farWingFan) : 0) +
        stroke.rise * design.flapElevation * pose.wingFlap -
        (1 - spread) * CRUMPLED_DROOP;
      const sweep =
        spec.wingSweepBias + stroke.sweep * design.flapSweep * pose.wingFlap * SWEEP_STROKE_SHARE;
      const length = (pair === 'fore' ? design.foreLength : design.hindLength) * lengthScale;
      frames.push({ frame: wingFrame(side, length, elevation, sweep, view), pair });
    }
  }
  return frames;
}

function paintWings(ink: Ink, which: 'far' | 'near' | 'all'): void {
  const { design, pose, view } = ink;
  const sideView = view === 'side';
  for (const { frame, pair } of wingFrames(design, pose, view)) {
    const isFar = sideView && frame.depth < 0;
    if (which === 'far' && !isFar) continue;
    if (which === 'near' && isFar) continue;
    paintWing(ink, pair, frame, isFar ? FAR_SIDE_DARKEN : 0);
  }
}

// ── Body ─────────────────────────────────────────────────────────────────────

/**
 * The side torso's silhouette, in head-widths out from the spine at each named
 * landmark height, front of the body then back. A chest curves out further
 * than a back does, which is what a profile needs to read as a torso rather
 * than a flat plank.
 */
const SIDE_TORSO_NECK_FRONT = 0.06 * HEAD;
const SIDE_TORSO_SHOULDER_FRONT = 0.24 * HEAD;
const SIDE_TORSO_CHEST_FRONT = 0.2 * HEAD;
const SIDE_TORSO_WAIST_FRONT = 0.1 * HEAD;
const SIDE_TORSO_BELLY_FRONT = 0.14 * HEAD;
const SIDE_TORSO_HIP_FRONT = 0.12 * HEAD;
const SIDE_TORSO_HIP_BACK = 0.24 * HEAD;
const SIDE_TORSO_BELLY_BACK = 0.2 * HEAD;
const SIDE_TORSO_WAIST_BACK = 0.12 * HEAD;
const SIDE_TORSO_CHEST_BACK = 0.18 * HEAD;
const SIDE_TORSO_SHOULDER_BACK = 0.22 * HEAD;
const SIDE_TORSO_NECK_BACK = 0.08 * HEAD;

/** How far below the shoulder line the front-view shoulder curve's control point sits. */
const TORSO_SHOULDER_DIP = 0.04 * HEAD;
/** The curve bulges this far past the shoulder's own width before pulling in to the armpit. */
const TORSO_ARMPIT_BULGE = 0.02 * HEAD;
/** A waist or hip curve's control point sits this far above the point it leads into. */
const TORSO_VERTICAL_CURVE_RISE = 0.1 * HEAD;
/** How far the crotch curve's control point reaches toward the centreline, as a share of hip width. */
const TORSO_CROTCH_CURVE_SHARE = 0.7;

function traceTorso(ctx: Ctx, view: FairyView): void {
  const girth = viewSpec(view).torsoGirth;
  if (view === 'side') {
    ctx.moveTo(SIDE_TORSO_NECK_FRONT, NECK_TOP_Y);
    ctx.quadraticCurveTo(SIDE_TORSO_SHOULDER_FRONT, SHOULDER_Y, SIDE_TORSO_CHEST_FRONT, ARMPIT_Y);
    ctx.quadraticCurveTo(SIDE_TORSO_WAIST_FRONT, WAIST_Y, SIDE_TORSO_BELLY_FRONT, 0);
    ctx.quadraticCurveTo(SIDE_TORSO_HIP_FRONT, CROTCH_Y, 0, CROTCH_Y);
    ctx.quadraticCurveTo(-SIDE_TORSO_HIP_BACK, CROTCH_Y, -SIDE_TORSO_BELLY_BACK, 0);
    ctx.quadraticCurveTo(-SIDE_TORSO_WAIST_BACK, WAIST_Y, -SIDE_TORSO_CHEST_BACK, ARMPIT_Y);
    ctx.quadraticCurveTo(-SIDE_TORSO_SHOULDER_BACK, SHOULDER_Y, -SIDE_TORSO_NECK_BACK, NECK_TOP_Y);
    ctx.closePath();
    return;
  }
  const sh = SHOULDER_HALF * girth;
  const ap = ARMPIT_HALF * girth;
  const wa = WAIST_HALF * girth;
  const hp = HIP_HALF * girth;
  const neck = NECK_WIDTH / 2;
  ctx.moveTo(-neck, NECK_TOP_Y);
  ctx.quadraticCurveTo(-neck, SHOULDER_Y, -sh, SHOULDER_Y + TORSO_SHOULDER_DIP);
  ctx.quadraticCurveTo(-sh - TORSO_ARMPIT_BULGE, ARMPIT_Y, -ap, ARMPIT_Y);
  ctx.quadraticCurveTo(-wa, WAIST_Y - TORSO_VERTICAL_CURVE_RISE, -wa, WAIST_Y);
  ctx.quadraticCurveTo(-hp, -TORSO_VERTICAL_CURVE_RISE, -hp, 0);
  ctx.quadraticCurveTo(-hp * TORSO_CROTCH_CURVE_SHARE, CROTCH_Y, 0, CROTCH_Y);
  ctx.quadraticCurveTo(hp * TORSO_CROTCH_CURVE_SHARE, CROTCH_Y, hp, 0);
  ctx.quadraticCurveTo(hp, -TORSO_VERTICAL_CURVE_RISE, wa, WAIST_Y);
  ctx.quadraticCurveTo(wa, WAIST_Y - TORSO_VERTICAL_CURVE_RISE, ap, ARMPIT_Y);
  ctx.quadraticCurveTo(sh + TORSO_ARMPIT_BULGE, ARMPIT_Y, sh, SHOULDER_Y + TORSO_SHOULDER_DIP);
  ctx.quadraticCurveTo(neck, SHOULDER_Y, neck, NECK_TOP_Y);
  ctx.closePath();
}

function torsoFill(ink: Ink): CanvasGradient {
  const { ctx, design } = ink;
  const { palette } = design;
  const gradient = ctx.createLinearGradient(-SHOULDER_HALF, NECK_TOP_Y, SHOULDER_HALF, CROTCH_Y);
  gradient.addColorStop(0, tinted(ink, palette.skinLight));
  gradient.addColorStop(TORSO_MID_STOP, tinted(ink, palette.skin));
  gradient.addColorStop(1, tinted(ink, palette.skinShade));
  return gradient;
}

/** Where the torso's diagonal shading reaches the plain skin colour, lit shoulder to shaded hip. */
const TORSO_MID_STOP = 0.45;

function paintLeg(ink: Ink, pass: Pass, chain: LimbChain, darken: number): void {
  const { palette } = ink.design;
  const color = mix(palette.skin, palette.skinShade, darken);
  segment(ink, pass, chain.root, chain.joint, THIGH_WIDTH, color);
  segment(ink, pass, chain.joint, chain.tip, SHIN_WIDTH, color);
  segment(ink, pass, chain.tip, chain.end, FOOT_WIDTH, color);
}

function paintArm(ink: Ink, pass: Pass, chain: LimbChain, darken: number): void {
  const { palette } = ink.design;
  const skin = mix(palette.skin, palette.skinShade, darken);
  const hands = mix(palette.hands, palette.skinShade, darken);
  segment(ink, pass, chain.root, chain.joint, UPPER_ARM_WIDTH, skin);
  segment(ink, pass, chain.joint, chain.tip, FOREARM_WIDTH, hands === skin ? skin : hands);
  blob(ink, pass, () => ink.ctx.arc(chain.end.x, chain.end.y, HAND_RADIUS, 0, Math.PI * 2), hands);
}

/** A highlight down the lit side of a limb, when there are pixels to spare for it. */
function limbHighlight(ink: Ink, chain: LimbChain, width: number): void {
  if (!ink.detailed) return;
  const { ctx, design } = ink;
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(tinted(ink, design.palette.skinLight), LIMB_HIGHLIGHT_ALPHA);
  ctx.lineWidth = width * LIMB_HIGHLIGHT_WIDTH;
  const offset = -width * LIMB_HIGHLIGHT_OFFSET;
  ctx.beginPath();
  ctx.moveTo(chain.root.x + offset, chain.root.y);
  ctx.lineTo(chain.joint.x + offset, chain.joint.y);
  ctx.lineTo(chain.tip.x + offset, chain.tip.y);
  ctx.stroke();
}

const LIMB_HIGHLIGHT_ALPHA = 0.55;
const LIMB_HIGHLIGHT_WIDTH = 0.35;
const LIMB_HIGHLIGHT_OFFSET = 0.22;

// ── Head ─────────────────────────────────────────────────────────────────────

function headCentre(pose: FairyPose): Pt {
  const neck = { x: 0, y: NECK_TOP_Y };
  const dy = HEAD_CENTRE_Y - NECK_TOP_Y;
  return {
    x: neck.x - Math.sin(pose.headTilt) * dy,
    y: neck.y + Math.cos(pose.headTilt) * dy,
  };
}

function traceHead(ctx: Ctx, centre: Pt, view: FairyView, tilt: number): void {
  const rx = view === 'side' ? HEAD_RADIUS_X * SIDE_HEAD_DEPTH : HEAD_RADIUS_X;
  ctx.ellipse(centre.x, centre.y, rx, HEAD_RADIUS_Y, tilt, 0, Math.PI * 2);
}

/** A profile skull is deeper front to back than a face is wide. */
const SIDE_HEAD_DEPTH = 1.12;

/**
 * A pointed ear: rooted just inside the head's edge (just behind its centre in
 * profile), swept out and up to a tip. In profile it is a little shorter,
 * since it points partly away from the camera.
 */
const EAR_SIDE_ROOT_X = -0.05 * HEAD;
const EAR_ROOT_INSET = 0.92;
const EAR_SIDE_LENGTH_SHARE = 0.9;
const EAR_ROOT_HALF = 0.1 * HEAD;
const EAR_TIP_RISE = 0.55;

function traceEar(ctx: Ctx, centre: Pt, side: number, view: FairyView): void {
  const rootX = view === 'side' ? EAR_SIDE_ROOT_X : side * HEAD_RADIUS_X * EAR_ROOT_INSET;
  const tipX =
    view === 'side' ? rootX - EAR_LENGTH * EAR_SIDE_LENGTH_SHARE : rootX + side * EAR_LENGTH;
  const rootY = centre.y + EAR_ROOT_Y;
  ctx.moveTo(centre.x + rootX, rootY - EAR_ROOT_HALF);
  ctx.lineTo(centre.x + tipX, rootY - EAR_LENGTH * EAR_TIP_RISE);
  ctx.lineTo(centre.x + rootX, rootY + EAR_ROOT_HALF);
  ctx.closePath();
}

/** The face's highlight sits up and to the left of centre, as a share of the head's radii: lit from the upper left. */
const FACE_HIGHLIGHT_OFFSET = 0.35;
/** The face shading runs just past the head's edge, so the rim is shade and not flat colour. */
const FACE_SHADE_REACH = 1.1;
const FACE_MID_STOP = 0.6;

function paintHeadBase(ink: Ink, pass: Pass, centre: Pt): void {
  const { ctx, view, design, pose } = ink;
  const { palette } = design;
  const tones = palette.face ?? {
    light: palette.skinLight,
    mid: palette.skin,
    shade: palette.skinShade,
  };
  const ears = view === 'side' ? [1] : [-1, 1];
  for (const side of ears) {
    blob(ink, pass, () => traceEar(ctx, centre, side, view), tones.mid);
  }
  const face = ctx.createRadialGradient(
    centre.x - HEAD_RADIUS_X * FACE_HIGHLIGHT_OFFSET,
    centre.y - HEAD_RADIUS_Y * FACE_HIGHLIGHT_OFFSET,
    0,
    centre.x,
    centre.y,
    HEAD_RADIUS_Y * FACE_SHADE_REACH,
  );
  face.addColorStop(0, tinted(ink, tones.light));
  face.addColorStop(FACE_MID_STOP, tinted(ink, tones.mid));
  face.addColorStop(1, tinted(ink, tones.shade));
  blob(ink, pass, () => traceHead(ctx, centre, view, pose.headTilt), face);
}

function paintEyes(ink: Ink, centre: Pt): void {
  const { ctx, view, pose, design } = ink;
  if (!viewSpec(view).showsFace) return;
  const { palette } = design;
  const xs =
    view === 'side' ? [HEAD_RADIUS_X * EYE_SIDE_FORWARD] : [-EYE_HALF_SPACING, EYE_HALF_SPACING];
  const open = 1 - clamp01(pose.eyesShut);
  for (const x of xs) {
    const ex = centre.x + x;
    const ey = centre.y + EYE_Y;
    const glow = ctx.createRadialGradient(ex, ey, 0, ex, ey, EYE_GLOW_RADIUS);
    glow.addColorStop(0, rgba(palette.eye, EYE_GLOW_ALPHA * open));
    glow.addColorStop(1, rgba(palette.eye, 0));
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(ex, ey, EYE_GLOW_RADIUS, 0, Math.PI * 2);
    ctx.fill();
    if (open < EYE_SHUT_THRESHOLD) {
      ctx.strokeStyle = palette.outline;
      ctx.lineWidth = ink.px;
      ctx.beginPath();
      ctx.moveTo(ex - EYE_RADIUS, ey);
      ctx.lineTo(ex + EYE_RADIUS, ey);
      ctx.stroke();
      continue;
    }
    ctx.fillStyle = palette.eye;
    ctx.beginPath();
    ctx.ellipse(
      ex,
      ey,
      EYE_RADIUS * EYE_WIDTH_SHARE,
      EYE_RADIUS * EYE_HEIGHT_SHARE * open,
      0,
      0,
      Math.PI * 2,
    );
    ctx.fill();
  }
}

const EYE_GLOW_ALPHA = 0.6;
const EYE_SHUT_THRESHOLD = 0.35;
/** The one eye a profile shows sits toward the front of the head, as a share of its radius. */
const EYE_SIDE_FORWARD = 0.62;
/** Eyes are tall ovals: big and wide-set is what reads as a fairy rather than an imp. */
const EYE_WIDTH_SHARE = 0.9;
const EYE_HEIGHT_SHARE = 1.25;

// ── Kind costume ─────────────────────────────────────────────────────────────

/** Behind the body: long hair, a trailing shroud's back panel. */
function paintCostumeBack(ink: Ink, pass: Pass, head: Pt): void {
  const kind = ink.design.wing;
  if (kind === 'snowflake') paintIcicleHair(ink, pass, head, 'back');
}

/** Over the legs and torso, under the arms: skirts, robes, the sigil's shadow side. */
function paintCostumeBody(ink: Ink, pass: Pass): void {
  const kind = ink.design.wing;
  if (kind === 'leaf') paintPetalSkirt(ink, pass);
  else if (kind === 'snowflake') paintFrostDress(ink, pass);
  else if (kind === 'flame') paintFlameTunic(ink, pass);
  else if (kind === 'moth') paintShroud(ink, pass);
}

/** On the head: helm, crown, hair, hood and mask. */
function paintCostumeHead(ink: Ink, pass: Pass, head: Pt): void {
  const kind = ink.design.wing;
  if (kind === 'crystal') paintHelm(ink, pass, head);
  else if (kind === 'leaf') paintFlowerCrown(ink, pass, head);
  else if (kind === 'snowflake') paintIcicleHair(ink, pass, head, 'front');
  else if (kind === 'flame') paintFlameHair(ink, pass, head);
  else paintHoodAndMask(ink, pass, head);
}

/** In front of everything: the floating buckler, the embers. */
function paintCostumeFront(ink: Ink): void {
  const kind = ink.design.wing;
  if (kind === 'crystal') paintSigil(ink);
  else if (kind === 'flame') paintEmbers(ink);
}

function paintHelm(ink: Ink, pass: Pass, head: Pt): void {
  const { ctx, view, design } = ink;
  const { palette } = design;
  const rx = HEAD_RADIUS_X * HELM_WIDTH_SCALE;
  const ry = HEAD_RADIUS_Y * HELM_HEIGHT_SCALE;
  const brow = head.y - HELM_BROW_ABOVE_CENTRE;
  blob(
    ink,
    pass,
    () => {
      if (view === 'side') {
        // In profile: a cap with a brim over the brow and a neck guard
        // flaring down behind, stepped back up toward the ear.
        ctx.moveTo(head.x + rx * HELM_SIDE_BRIM, brow);
        ctx.ellipse(
          head.x - HELM_SIDE_SHIFT,
          head.y,
          rx * HELM_SIDE_DEPTH,
          ry,
          0,
          0,
          Math.PI,
          true,
        );
        ctx.lineTo(head.x - rx * HELM_GUARD_BACK, head.y + HELM_GUARD_DROP);
        ctx.lineTo(head.x - rx * HELM_GUARD_STEP_BACK, head.y + HELM_GUARD_STEP_DROP);
        ctx.lineTo(head.x - rx * HELM_GUARD_EAR_BACK, brow + HELM_GUARD_EAR_DROP);
        ctx.closePath();
        return;
      }
      // The cap's rim stays above the eyes: a cap that covers the face reads
      // as a dome, and paired with the striped buckler below it, as a bee.
      const back = view === 'away' ? HELM_NAPE : 0;
      ctx.moveTo(head.x + rx, brow + back);
      ctx.ellipse(head.x, head.y, rx, ry, 0, 0, Math.PI, true);
      ctx.lineTo(head.x - rx, brow + back);
      if (view === 'front') {
        ctx.lineTo(head.x - HELM_NOSE_GUARD, brow);
        ctx.lineTo(head.x, brow + HELM_NOSE_GUARD * 2);
        ctx.lineTo(head.x + HELM_NOSE_GUARD, brow);
      }
      ctx.closePath();
    },
    helmFill(ink, head),
  );
  const crestTop = head.y - ry - HELM_CREST_HEIGHT;
  blob(
    ink,
    pass,
    () => {
      const crestFoot = head.y - ry * HELM_CREST_FOOT;
      if (view === 'side') {
        // A swept-back fin rather than a spike: the crest streams behind.
        ctx.moveTo(head.x + rx * HELM_FIN_FRONT, crestFoot);
        ctx.quadraticCurveTo(
          head.x,
          crestTop - HELM_FIN_ARCH,
          head.x - rx * HELM_FIN_TAIL,
          crestTop + HELM_FIN_TAIL_DROP,
        );
        ctx.lineTo(head.x - rx * HELM_FIN_BACK, head.y - ry * HELM_FIN_BACK_FOOT);
        ctx.closePath();
        return;
      }
      ctx.moveTo(head.x - HELM_CREST_HALF, crestFoot);
      ctx.lineTo(head.x, crestTop);
      ctx.lineTo(head.x + HELM_CREST_HALF, crestFoot);
      ctx.closePath();
    },
    palette.accentBright,
  );
}

const HELM_CREST_HEIGHT = 0.32 * HEAD;
/** The cap's rim sits above the eyes, leaving the face bare. */
const HELM_BROW_ABOVE_CENTRE = 0.1 * HEAD;
const HELM_NOSE_GUARD = 0.07 * HEAD;
const HELM_NAPE = 0.3 * HEAD;
const HELM_CREST_HALF = 0.1 * HEAD;
/** The helm sits just proud of the skull. */
const HELM_WIDTH_SCALE = 1.08;
const HELM_HEIGHT_SCALE = 1.06;
/** The profile helm: brim forward, shell shifted back and deepened, the neck guard's three steps. */
const HELM_SIDE_BRIM = 0.9;
const HELM_SIDE_SHIFT = 0.04 * HEAD;
const HELM_SIDE_DEPTH = 1.12;
const HELM_GUARD_BACK = 1.05;
const HELM_GUARD_DROP = 0.3 * HEAD;
const HELM_GUARD_STEP_BACK = 0.4;
const HELM_GUARD_STEP_DROP = 0.22 * HEAD;
const HELM_GUARD_EAR_BACK = 0.1;
const HELM_GUARD_EAR_DROP = 0.08 * HEAD;
/** Where the crest meets the shell, as a share of the helm's height above centre. */
const HELM_CREST_FOOT = 0.9;
/** The profile fin: from just forward of the crown, arching over and trailing past the back of the helm. */
const HELM_FIN_FRONT = 0.5;
const HELM_FIN_ARCH = 0.04 * HEAD;
const HELM_FIN_TAIL = 1.2;
const HELM_FIN_TAIL_DROP = 0.1 * HEAD;
const HELM_FIN_BACK = 0.7;
const HELM_FIN_BACK_FOOT = 0.6;
/** The helm's gold ramps from a white glint at the crown, through gold, to shade below the brow. */
const HELM_GRADIENT_REACH = 0.4;
const HELM_GOLD_STOP = 0.4;

function helmFill(ink: Ink, head: Pt): CanvasGradient {
  const { ctx, design } = ink;
  const gradient = ctx.createLinearGradient(
    head.x - HEAD_RADIUS_X,
    head.y - HEAD_RADIUS_Y,
    head.x + HEAD_RADIUS_X,
    head.y + HEAD_RADIUS_Y * HELM_GRADIENT_REACH,
  );
  gradient.addColorStop(0, tinted(ink, '#ffffff'));
  gradient.addColorStop(HELM_GOLD_STOP, tinted(ink, design.palette.accent));
  gradient.addColorStop(1, tinted(ink, design.palette.accentShade));
  return gradient;
}

/**
 * The buckler's half-width. It is a heater shield — flat top, pointed foot —
 * and big enough to cover the torso: at 32 px the outline is the only thing
 * that says "shield", and a round disc reads as a medallion or a target.
 */
const SIGIL_RADIUS = 0.56 * HEAD;
/** Top edge to point, as a multiple of the half-width. */
const SIGIL_HEIGHT_SHARE = 2.6;
/** Share of the height above the centre: the broad top sits high, the point hangs low. */
const SIGIL_TOP_SHARE = 0.42;
/** How far the top edge bows upward, as a share of the half-width. */
const SIGIL_TOP_BOW = 0.18;
/** Share of the height down the straight sides before they curve in to the point. */
const SIGIL_SHOULDER_SHARE = 0.34;
/** Where the side curves' control point sits above the point, as a share of the height. */
const SIGIL_POINT_CURVE_SHARE = 0.3;
/** The field inside the gold rim, as a share of the shield's size. */
const SIGIL_FIELD = 0.72;
const SIGIL_BOSS = 0.2;
/** The shield hangs this far below the chest point at rest, so it covers chest and belly. */
const SIGIL_REST_DROP = 0.24 * HEAD;
const SIGIL_FORWARD = 0.34 * HEAD;
/** The buckler floats a little out of step with the body, so it reads as held by nothing. */
const SIGIL_FLOAT = 0.05 * HEAD;
/** Offsets the float's phase from the wingbeat's own, so the two never lock in step. */
const SIGIL_FLOAT_PHASE = 0.25;
/** How far the sigil lifts toward the chin as a ward fully flares. */
const SIGIL_FLARE_LIFT = 0.25 * HEAD;
/** Width from the side view, as a share of the sigil's own: it is held edge-on to the camera. */
const SIGIL_SIDE_WIDTH_SHARE = 0.42;
/** From behind, the shield is slung high on the back, between the wing roots. */
const SIGIL_BACK_RISE = 0.1 * HEAD;
/** The glow's radius at rest, and how much further a flare pushes it, as multiples of the sigil radius. */
const SIGIL_GLOW_BASE_SCALE = 1.8;
const SIGIL_GLOW_FLARE_SCALE = 2.2;
/** The glow's opacity at rest, and how much brighter a flare drives it. */
const SIGIL_GLOW_BASE_ALPHA = 0.45;
const SIGIL_GLOW_FLARE_ALPHA = 0.5;
/** How far a flare washes the field toward the bright accent. */
const SIGIL_FIELD_FLARE_TINT = 0.7;
/** The gold rim is drawn thicker than the body's outline: it is the shield's whole outline at 32 px. */
const SIGIL_RIM_INK_PX = 1.5;
/**
 * The field is parted per pale, silver on one half and cobalt on the other:
 * two tinctures split down the middle are the plainest heraldry there is, and
 * they survive at seven pixels where a charge would not.
 */
const SIGIL_SILVER = '#eef3fb';
/** Where a fallen shield stands planted, just where the slumping body comes to rest against it, tiles. */
const SIGIL_PLANT_X = 0.3;
/** How far the point of a planted shield has sunk into the ground, tiles. */
const SIGIL_PLANT_SINK = 0.02;
/** A planted shield leans a little, as one driven in by its fall would. */
const SIGIL_PLANT_LEAN = deg(-10);

function traceHeater(ctx: Ctx, halfWidth: number, height: number): void {
  const top = -height * SIGIL_TOP_SHARE;
  const point = height * (1 - SIGIL_TOP_SHARE);
  const shoulder = top + height * SIGIL_SHOULDER_SHARE;
  const curveY = point - height * SIGIL_POINT_CURVE_SHARE;
  ctx.moveTo(-halfWidth, top);
  ctx.quadraticCurveTo(0, top - halfWidth * SIGIL_TOP_BOW, halfWidth, top);
  ctx.lineTo(halfWidth, shoulder);
  ctx.quadraticCurveTo(halfWidth, curveY, 0, point);
  ctx.quadraticCurveTo(-halfWidth, curveY, -halfWidth, shoulder);
  ctx.closePath();
}

/** Where the shield hangs in the body's frame, and how wide it looks from this view. */
function sigilHeld(ink: Ink): { readonly at: Pt; readonly widthShare: number } {
  const { view, pose } = ink;
  const float = Math.sin((pose.wingPhase + SIGIL_FLOAT_PHASE) * Math.PI * 2) * SIGIL_FLOAT;
  const flare = pose.effect === 'ward' ? pose.effectAmount : 0;
  const y = CHEST_Y + SIGIL_REST_DROP + float - flare * SIGIL_FLARE_LIFT;
  if (view === 'side') return { at: { x: SIGIL_FORWARD, y }, widthShare: SIGIL_SIDE_WIDTH_SHARE };
  if (view === 'away') return { at: { x: 0, y: y - SIGIL_BACK_RISE }, widthShare: 1 };
  return { at: { x: 0, y }, widthShare: 1 };
}

/**
 * The shield fairy's heater shield: floating before its chest, slung on its
 * back from behind, and, as the fairy dies, falling free to stand planted in
 * the ground for the body to slump against.
 */
function paintSigil(ink: Ink): void {
  const { ctx, design, pose, view } = ink;
  const { palette } = design;
  const held = sigilHeld(ink);
  const drop = clamp01(pose.sigilDrop);
  const bodyTurn = pose.tilt + viewSpec(view).flightLean;
  const height = SIGIL_RADIUS * SIGIL_HEIGHT_SHARE;
  const heldInTile = {
    x: pose.drift + held.at.x * Math.cos(bodyTurn) - held.at.y * Math.sin(bodyTurn),
    y: pelvisY(pose) + held.at.x * Math.sin(bodyTurn) + held.at.y * Math.cos(bodyTurn),
  };
  const planted = {
    x: pose.drift + SIGIL_PLANT_X,
    y: GROUND_Y + SIGIL_PLANT_SINK - height * (1 - SIGIL_TOP_SHARE),
  };
  const halfWidth = SIGIL_RADIUS * lerp(held.widthShare, 1, drop);
  const flare = pose.effect === 'ward' ? pose.effectAmount : 0;
  ctx.save();
  try {
    // Out of the body's frame and into the tile's, so a dropped shield falls
    // under gravity rather than turning with the body it has left.
    ctx.rotate(-bodyTurn);
    ctx.translate(-pose.drift, -pelvisY(pose));
    ctx.translate(lerp(heldInTile.x, planted.x, drop), lerp(heldInTile.y, planted.y, drop));
    ctx.rotate(lerp(bodyTurn, SIGIL_PLANT_LEAN, drop));
    const glowRadius = SIGIL_RADIUS * (SIGIL_GLOW_BASE_SCALE + flare * SIGIL_GLOW_FLARE_SCALE);
    const glowAlpha = (SIGIL_GLOW_BASE_ALPHA + flare * SIGIL_GLOW_FLARE_ALPHA) * pose.glow;
    if (view !== 'away') radialGlow(ctx, 0, 0, glowRadius, palette.glow, glowAlpha);
    const inked = { ...ink, px: ink.px * SIGIL_RIM_INK_PX };
    for (const pass of ['outline', 'fill'] as const) {
      blob(inked, pass, () => traceHeater(ctx, halfWidth, height), palette.accent);
    }
    const fieldWidth = halfWidth * SIGIL_FIELD;
    const fieldHeight = height * SIGIL_FIELD;
    const cobalt = mix(palette.wingRoot, palette.accentBright, flare * SIGIL_FIELD_FLARE_TINT);
    const silver = mix(SIGIL_SILVER, '#ffffff', flare);
    withClip(
      ctx,
      () => {
        ctx.beginPath();
        traceHeater(ctx, fieldWidth, fieldHeight);
      },
      () => {
        ctx.fillStyle = tinted(ink, cobalt);
        ctx.fillRect(-fieldWidth, -fieldHeight, fieldWidth * 2, fieldHeight * 2);
        ctx.fillStyle = tinted(ink, silver);
        ctx.fillRect(-fieldWidth, -fieldHeight, fieldWidth, fieldHeight * 2);
      },
    );
    dot(ctx, 0, 0, SIGIL_RADIUS * SIGIL_BOSS, tinted(ink, palette.accent));
  } finally {
    ctx.restore();
  }
}

const PETALS = 6;

function paintPetalSkirt(ink: Ink, pass: Pass): void {
  const { ctx, view, design, pose } = ink;
  const { palette } = design;
  const sway = Math.sin(pose.wingPhase * Math.PI * 2) * PETAL_SWAY;
  const halfWidth = HIP_HALF * (view === 'side' ? PETAL_SIDE_GIRTH : PETAL_FRONT_GIRTH);
  const top = WAIST_Y + PETAL_WAIST_DROP;
  const hem = CROTCH_Y + PETAL_HEM_DROP;
  const trail = view === 'side' ? PETAL_SIDE_TRAIL : 0;
  for (let i = 0; i < PETALS; i++) {
    const t = (i + 0.5) / PETALS;
    const baseX = lerp(-halfWidth * PETAL_ROOT_SPREAD, halfWidth * PETAL_ROOT_SPREAD, t);
    const flare = (t - 0.5) * 2;
    const tipX = baseX + flare * PETAL_FLARE + sway - trail;
    const tipY = hem - Math.abs(flare) * PETAL_OUTER_RISE;
    const petalHalf = (halfWidth * PETAL_OVERLAP) / PETALS;
    // Pink stays on the crown: a pink skirt reads as a bare belly at 32 px.
    const color = i % 2 === 0 ? palette.accent : palette.wingRoot;
    blob(
      ink,
      pass,
      () => {
        ctx.moveTo(baseX - petalHalf, top);
        ctx.quadraticCurveTo(baseX - petalHalf * PETAL_BELLY, (top + tipY) / 2, tipX, tipY);
        ctx.quadraticCurveTo(
          baseX + petalHalf * PETAL_BELLY,
          (top + tipY) / 2,
          baseX + petalHalf,
          top,
        );
        ctx.closePath();
      },
      color,
    );
  }
  blob(
    ink,
    pass,
    () => ctx.ellipse(0, top, halfWidth * PETAL_BAND_WIDTH, PETAL_BAND_HEIGHT, 0, 0, Math.PI * 2),
    palette.accentShade,
  );
}

/** The skirt sways a little with the wingbeat. */
const PETAL_SWAY = 0.04 * HEAD;
/** Skirt width against the hips: flared from the front, slimmer side-on. */
const PETAL_FRONT_GIRTH = 1.25;
const PETAL_SIDE_GIRTH = 0.9;
/** The waistband sits just below the waist; the hem hangs to mid-thigh. */
const PETAL_WAIST_DROP = 0.02 * HEAD;
const PETAL_HEM_DROP = 0.48 * HEAD;
/** Side-on, the petals stream back behind the legs. */
const PETAL_SIDE_TRAIL = 0.12 * HEAD;
/** Petal roots span most of the skirt's width; each tip flares outward and the outer ones ride higher. */
const PETAL_ROOT_SPREAD = 0.8;
const PETAL_FLARE = 0.2 * HEAD;
const PETAL_OUTER_RISE = 0.1 * HEAD;
/** Each petal is wider than its share of the skirt, so they overlap; its sides belly out further still. */
const PETAL_OVERLAP = 1.6;
const PETAL_BELLY = 1.6;
/** The waistband's ellipse. */
const PETAL_BAND_WIDTH = 0.95;
const PETAL_BAND_HEIGHT = 0.09 * HEAD;

const FROST_DRESS_POINTS = 5;
const FROST_DRESS_ICE = '#a8f0f8';
const FROST_DRESS_DEEP = '#3cc0dc';

/**
 * A short dress of ice, armpit to thigh, hemmed in icicles. It gives a white
 * body a mid-blue mass, so the figure is two values rather than one and does
 * not dissolve into a pale floor.
 */
function paintFrostDress(ink: Ink, pass: Pass): void {
  const { ctx, view, pose } = ink;
  const girth = view === 'side' ? SIDE_DRESS_GIRTH : 1;
  const top = ARMPIT_Y + FROST_DRESS_TOP_DROP;
  const hem = CROTCH_Y + FROST_DRESS_HEM_DROP;
  const halfTop = ARMPIT_HALF * girth;
  const halfHem = HIP_HALF * FROST_DRESS_FLARE * girth;
  const trail = view === 'side' ? -FROST_DRESS_TRAIL : 0;
  const sway = Math.sin(pose.wingPhase * Math.PI * 2) * FROST_DRESS_SWAY;
  const g = ctx.createLinearGradient(0, top, 0, hem);
  g.addColorStop(0, tinted(ink, FROST_DRESS_ICE));
  g.addColorStop(1, tinted(ink, FROST_DRESS_DEEP));
  blob(
    ink,
    pass,
    () => {
      ctx.moveTo(-halfTop, top);
      ctx.quadraticCurveTo(-WAIST_HALF * girth, WAIST_Y, -halfHem + trail, hem);
      for (let i = 0; i < FROST_DRESS_POINTS; i++) {
        const x0 = lerp(-halfHem, halfHem, i / FROST_DRESS_POINTS) + trail;
        const x1 = lerp(-halfHem, halfHem, (i + 1) / FROST_DRESS_POINTS) + trail;
        const long = i % 2 === 0 ? 1 : FROST_DRESS_SHORT_POINT;
        ctx.lineTo((x0 + x1) / 2 + sway, hem + FROST_DRESS_POINT * long);
        ctx.lineTo(x1, hem);
      }
      ctx.quadraticCurveTo(WAIST_HALF * girth, WAIST_Y, halfTop, top);
      ctx.closePath();
    },
    g,
  );
}

const SIDE_DRESS_GIRTH = 0.8;
const FROST_DRESS_TOP_DROP = 0.04 * HEAD;
const FROST_DRESS_HEM_DROP = 0.3 * HEAD;
const FROST_DRESS_FLARE = 1.5;
const FROST_DRESS_TRAIL = 0.1 * HEAD;
const FROST_DRESS_SWAY = 0.03 * HEAD;
const FROST_DRESS_POINT = 0.22 * HEAD;
const FROST_DRESS_SHORT_POINT = 0.55;

const FLAME_TUNIC_TONGUES = 5;
const FLAME_TUNIC_TOP_RISE = 0.02 * HEAD;
const FLAME_TUNIC_HEM_DROP = 0.4 * HEAD;
const FLAME_TUNIC_FLARE = 1.85;
const FLAME_TUNIC_SHOULDER_WIDEN = 1.25;
/** The shoulder flames lick up past the shoulder line by this much. */
const FLAME_TUNIC_SHOULDER_LICK = 0.3 * HEAD;
const FLAME_TUNIC_TONGUE = 0.26 * HEAD;
const FLAME_TUNIC_FLICKER = 0.07 * HEAD;
const FLAME_TUNIC_TRAIL = 0.14 * HEAD;
const SIDE_TUNIC_GIRTH = 0.78;
/** How far a guttered-out tunic's hem tongues shrink, as a share of their full length. */
const FLAME_TUNIC_GUTTERED = 0.3;

/**
 * A tunic of fire from the shoulders to the thigh, flaring into licking
 * tongues at the hem and up over each shoulder. The limbs alone are sticks
 * under two broad flame wings; this is what gives the body a mass of its own
 * to hold them up, and the shoulder flames square it off.
 */
function paintFlameTunic(ink: Ink, pass: Pass): void {
  const { ctx, view, design, pose } = ink;
  const { palette } = design;
  const girth = view === 'side' ? SIDE_TUNIC_GIRTH : 1;
  const top = SHOULDER_Y - FLAME_TUNIC_TOP_RISE;
  const hem = CROTCH_Y + FLAME_TUNIC_HEM_DROP;
  const halfShoulder = SHOULDER_HALF * FLAME_TUNIC_SHOULDER_WIDEN * girth;
  const halfHem = HIP_HALF * FLAME_TUNIC_FLARE * girth;
  const trail = view === 'side' ? -FLAME_TUNIC_TRAIL : 0;
  const burn = lerp(FLAME_TUNIC_GUTTERED, 1, clamp01(pose.glow));
  const g = ctx.createLinearGradient(0, top, 0, hem + FLAME_TUNIC_TONGUE);
  g.addColorStop(0, tinted(ink, palette.hairShade));
  g.addColorStop(FLAME_TUNIC_BODY_STOP, tinted(ink, palette.hair));
  g.addColorStop(FLAME_TUNIC_GOLD_STOP, tinted(ink, palette.accent));
  g.addColorStop(1, tinted(ink, palette.accentBright));
  const lick = (i: number): number =>
    Math.sin(
      (pose.flicker * (FLAME_LICK_BASE_RATE + (i % FLAME_LICK_RATES)) +
        hash01(i, FLAME_TUNIC_SALT)) *
        Math.PI *
        2,
    );
  const shoulderTip = (side: number, salt: number): Pt => ({
    x: side * (halfShoulder + FLAME_TUNIC_FLICKER * lick(salt) * FLAME_SHOULDER_SWAY_SHARE),
    y: top - FLAME_TUNIC_SHOULDER_LICK * burn * flameReach(lick(salt)),
  });
  blob(
    ink,
    pass,
    () => {
      const left = shoulderTip(-1, LEFT_SHOULDER_SALT);
      const right = shoulderTip(1, RIGHT_SHOULDER_SALT);
      ctx.moveTo(-NECK_WIDTH, top);
      ctx.quadraticCurveTo(-halfShoulder * FLAME_SHOULDER_INNER, top, left.x, left.y);
      ctx.quadraticCurveTo(-halfShoulder * FLAME_SHOULDER_OUTER, top, -halfShoulder, ARMPIT_Y);
      ctx.quadraticCurveTo(-WAIST_HALF * girth, WAIST_Y, -halfHem + trail, hem);
      for (let i = 0; i < FLAME_TUNIC_TONGUES; i++) {
        const x0 = lerp(-halfHem, halfHem, i / FLAME_TUNIC_TONGUES) + trail;
        const x1 = lerp(-halfHem, halfHem, (i + 1) / FLAME_TUNIC_TONGUES) + trail;
        const mid =
          (x0 + x1) / 2 + lick(i) * FLAME_TUNIC_FLICKER + trail * FLAME_TONGUE_TRAIL_SHARE;
        const long = i % 2 === 0 ? 1 : FLAME_TUNIC_SHORT_TONGUE;
        const length = FLAME_TUNIC_TONGUE * burn * long * flameReach(lick(i));
        ctx.quadraticCurveTo(x0, hem + length * FLAME_TONGUE_LEAD_BODY, mid, hem + length);
        ctx.quadraticCurveTo(x1, hem + length * FLAME_TONGUE_TAIL_BODY, x1, hem);
      }
      ctx.quadraticCurveTo(WAIST_HALF * girth, WAIST_Y, halfShoulder, ARMPIT_Y);
      ctx.quadraticCurveTo(halfShoulder * FLAME_SHOULDER_OUTER, top, right.x, right.y);
      ctx.quadraticCurveTo(halfShoulder * FLAME_SHOULDER_INNER, top, NECK_WIDTH, top);
      ctx.closePath();
    },
    g,
  );
}

const LEFT_SHOULDER_SALT = 11;
const RIGHT_SHOULDER_SALT = 12;
const FLAME_TUNIC_SALT = 71;
const FLAME_TUNIC_SHORT_TONGUE = 0.6;
/** The tunic burns dark at the shoulders, through flame, to gold and a white-hot hem. */
const FLAME_TUNIC_BODY_STOP = 0.55;
const FLAME_TUNIC_GOLD_STOP = 0.85;
/** A flame's lick cycles at one of three rates, so neighbouring tongues never lick in step. */
const FLAME_LICK_BASE_RATE = 2;
const FLAME_LICK_RATES = 3;
/**
 * A flame's reach as its lick rises and falls: it never drops below this
 * share of its full length, so the fire flickers rather than going out.
 */
const FLAME_MIN_REACH = 0.85;

/** Share of its full length a flame reaches at a lick of -1 to 1. */
function flameReach(lick: number): number {
  return FLAME_MIN_REACH + (1 - FLAME_MIN_REACH) * lick;
}

/** The shoulder flames wave sideways half as far as the hem's tongues. */
const FLAME_SHOULDER_SWAY_SHARE = 0.5;
/** The shoulder line's control points, as shares of the half-shoulder: pulled in toward the neck, bowed just past the shoulder. */
const FLAME_SHOULDER_INNER = 0.6;
const FLAME_SHOULDER_OUTER = 1.05;
/** Side-on, each tongue trails half as far again as the hem it hangs from. */
const FLAME_TONGUE_TRAIL_SHARE = 0.5;
/** A tongue's two sides: the leading side full-bodied down most of its length, the trailing side curling in sooner. */
const FLAME_TONGUE_LEAD_BODY = 0.6;
const FLAME_TONGUE_TAIL_BODY = 0.3;

const CROWN_FLOWERS = 5;
/** Side-on only the near half of the crown shows. */
const SIDE_CROWN_FLOWERS = 3;
const FLOWER_RADIUS = 0.17 * HEAD;
/** The arc of the head the flowers sit around, radians: over the crown from ear to ear, or the near half in profile. */
const CROWN_ARC = [-2.7, -0.44] as const;
const SIDE_CROWN_ARC = [-2.4, -0.7] as const;
/** The ring the flowers sit on, as shares of the head's radii; deeper in profile, as the skull is. */
const CROWN_RING_WIDTH = 1.02;
const CROWN_RING_HEIGHT = 0.98;
const CROWN_SIDE_DEPTH = 1.1;
const FLOWER_VEIN_ALPHA = 0.7;
const FLOWER_VEIN_PX = 0.8;
const FLOWER_HEART_SHARE = 0.42;
const FLOWER_HEART = '#ffd84a';
/** The leafy cap of hair under the crown, just proud of the skull, hanging to the jaw from behind. */
const LEAF_HAIR_WIDTH = 1.06;
const LEAF_HAIR_HEIGHT = 1.04;
const LEAF_HAIR_HANG = 0.14 * HEAD;
const LEAF_HAIR_BACK_HANG = 0.36 * HEAD;
/** The fringe dips to a parting over the brow. */
const LEAF_FRINGE_CURVE = 0.6;
const LEAF_FRINGE_SIDE = 0.12 * HEAD;
const LEAF_FRINGE_PARTING = 0.18 * HEAD;
/** In profile the hairline steps from the temple to the brow. */
const LEAF_SIDE_TEMPLE = 0.2;
const LEAF_SIDE_TEMPLE_RISE = 0.1 * HEAD;
const LEAF_SIDE_BROW_RISE = 0.14 * HEAD;

function paintFlowerCrown(ink: Ink, pass: Pass, head: Pt): void {
  const { ctx, view, design } = ink;
  const { palette } = design;
  blob(
    ink,
    pass,
    () => {
      const rx = HEAD_RADIUS_X * LEAF_HAIR_WIDTH * (view === 'side' ? SIDE_HEAD_DEPTH : 1);
      const ry = HEAD_RADIUS_Y * LEAF_HAIR_HEIGHT;
      const hang = view === 'away' ? LEAF_HAIR_BACK_HANG : LEAF_HAIR_HANG;
      ctx.moveTo(head.x + rx, head.y + hang);
      ctx.ellipse(head.x, head.y, rx, ry, 0, 0, Math.PI, true);
      ctx.lineTo(head.x - rx, head.y + hang);
      if (view === 'front') {
        const fringe = head.y - LEAF_FRINGE_SIDE;
        const parting = head.y - LEAF_FRINGE_PARTING;
        ctx.quadraticCurveTo(head.x - rx * LEAF_FRINGE_CURVE, fringe, head.x, parting);
        ctx.quadraticCurveTo(head.x + rx * LEAF_FRINGE_CURVE, fringe, head.x + rx, head.y + hang);
      } else if (view === 'side') {
        ctx.lineTo(head.x + rx * LEAF_SIDE_TEMPLE, head.y - LEAF_SIDE_TEMPLE_RISE);
        ctx.lineTo(head.x + rx, head.y - LEAF_SIDE_BROW_RISE);
      }
      ctx.closePath();
    },
    palette.hair,
  );
  const sideView = view === 'side';
  const flowers = sideView ? SIDE_CROWN_FLOWERS : CROWN_FLOWERS;
  const [arcFrom, arcTo] = sideView ? SIDE_CROWN_ARC : CROWN_ARC;
  for (let i = 0; i < flowers; i++) {
    const t = (i + 0.5) / flowers;
    const angle = lerp(arcFrom, arcTo, t);
    const fx =
      head.x +
      Math.cos(angle) * HEAD_RADIUS_X * CROWN_RING_WIDTH * (sideView ? CROWN_SIDE_DEPTH : 1);
    const fy = head.y + Math.sin(angle) * HEAD_RADIUS_Y * CROWN_RING_HEIGHT;
    const petal = i % 2 === 0 ? palette.accentBright : palette.accent;
    blob(ink, pass, () => ctx.arc(fx, fy, FLOWER_RADIUS, 0, Math.PI * 2), petal);
    if (pass === 'fill') {
      if (ink.detailed) {
        ctx.strokeStyle = rgba(palette.accentShade, FLOWER_VEIN_ALPHA);
        ctx.lineWidth = ink.px * FLOWER_VEIN_PX;
        for (let p = 0; p < PETALS - 1; p++) {
          const a = (p / (PETALS - 1)) * Math.PI * 2;
          ctx.beginPath();
          ctx.moveTo(fx, fy);
          ctx.lineTo(fx + Math.cos(a) * FLOWER_RADIUS, fy + Math.sin(a) * FLOWER_RADIUS);
          ctx.stroke();
        }
      }
      dot(ctx, fx, fy, FLOWER_RADIUS * FLOWER_HEART_SHARE, FLOWER_HEART);
    }
  }
}

const ICICLE_POINTS = 4;

function paintIcicleHair(ink: Ink, pass: Pass, head: Pt, layer: 'back' | 'front'): void {
  const { ctx, view, design, pose } = ink;
  const { palette } = design;
  const rx = HEAD_RADIUS_X * ICE_HAIR_WIDTH * (view === 'side' ? SIDE_HEAD_DEPTH : 1);
  const ry = HEAD_RADIUS_Y * ICE_HAIR_HEIGHT;
  const sway = Math.sin(pose.wingPhase * Math.PI * 2) * ICE_HAIR_SWAY;
  const hairGradient = (): CanvasGradient => {
    const g = ctx.createLinearGradient(head.x, head.y - ry, head.x, WAIST_Y);
    g.addColorStop(0, tinted(ink, palette.hair));
    g.addColorStop(1, tinted(ink, palette.hairShade));
    return g;
  };
  const traceFall = (left: number, right: number, bottom: number): void => {
    const crown = head.y - ICE_HAIR_PARTING_RISE;
    const notch = bottom - ICICLE_LENGTH * ICICLE_NOTCH_SHARE;
    ctx.moveTo(left, crown);
    ctx.lineTo(left + sway * ICE_HAIR_EDGE_SWAY, notch);
    for (let i = 0; i < ICICLE_POINTS; i++) {
      const x0 = lerp(left, right, i / ICICLE_POINTS) + sway;
      const x1 = lerp(left, right, (i + 1) / ICICLE_POINTS) + sway;
      const middle = i > 0 && i < ICICLE_POINTS - 1;
      const long = middle ? 1 : ICICLE_OUTER_SHARE;
      ctx.lineTo((x0 + x1) / 2, bottom + ICICLE_LENGTH * long);
      ctx.lineTo(x1, notch);
    }
    ctx.lineTo(right, crown);
    ctx.ellipse(
      head.x + (left + right) / 2 - head.x,
      head.y,
      (right - left) / 2,
      ry,
      0,
      0,
      Math.PI,
      true,
    );
    ctx.closePath();
  };
  if (layer === 'back') {
    if (view === 'away') return;
    if (view === 'side') {
      blob(
        ink,
        pass,
        () =>
          traceFall(head.x - rx * ICE_HAIR_SIDE_BACK, head.x + rx * ICE_HAIR_SIDE_FRONT, WAIST_Y),
        hairGradient(),
      );
      return;
    }
    blob(
      ink,
      pass,
      () => traceFall(head.x - rx, head.x + rx, ARMPIT_Y + ICE_HAIR_FRONT_DROP),
      hairGradient(),
    );
    return;
  }
  if (view === 'away') {
    blob(
      ink,
      pass,
      () => traceFall(head.x - rx, head.x + rx, WAIST_Y - ICE_HAIR_BACK_RISE),
      hairGradient(),
    );
    return;
  }
  blob(
    ink,
    pass,
    () => {
      const temple = head.y + ICE_FRINGE_TEMPLE_DROP;
      ctx.moveTo(head.x + rx, temple);
      ctx.ellipse(head.x, head.y, rx, ry, 0, 0, Math.PI, true);
      ctx.lineTo(head.x - rx, temple);
      if (view === 'side') {
        ctx.lineTo(head.x + rx * ICE_SIDE_FRINGE_BACK, head.y - ICE_SIDE_FRINGE_RISE);
        ctx.lineTo(head.x + rx * ICE_SIDE_FRINGE_FRONT, head.y - ICE_SIDE_BROW_RISE);
      } else {
        const fringeHalf = rx * ICE_FRINGE_SPAN;
        for (let i = 0; i <= ICICLE_POINTS; i++) {
          const x = lerp(head.x - fringeHalf, head.x + fringeHalf, i / ICICLE_POINTS);
          const y = head.y - (i % 2 === 0 ? ICE_FRINGE_HIGH : ICE_FRINGE_LOW);
          ctx.lineTo(x, y);
        }
      }
      ctx.closePath();
    },
    hairGradient(),
  );
}

const ICICLE_LENGTH = 0.22 * HEAD;
/** The two middle icicles hang longest; the outer ones this share as long. */
const ICICLE_OUTER_SHARE = 0.65;
/** The notches between icicles ride this share of an icicle's length above the hair's bottom line. */
const ICICLE_NOTCH_SHARE = 0.3;
/** Long straight hair, a little fuller than the skull, swaying with the wingbeat. */
const ICE_HAIR_WIDTH = 1.1;
const ICE_HAIR_HEIGHT = 1.06;
const ICE_HAIR_SWAY = 0.03 * HEAD;
/** The hair's outer edges sway half as far as its ends. */
const ICE_HAIR_EDGE_SWAY = 0.5;
const ICE_HAIR_PARTING_RISE = 0.1 * HEAD;
/** Where the fall of hair ends: at the armpits from the front, the waist from behind and in profile. */
const ICE_HAIR_FRONT_DROP = 0.1 * HEAD;
const ICE_HAIR_BACK_RISE = 0.04 * HEAD;
/** In profile the fall hangs behind the head, from well behind the skull to just forward of its centre. */
const ICE_HAIR_SIDE_BACK = 1.1;
const ICE_HAIR_SIDE_FRONT = 0.2;
/** The front of the hair: a zigzag fringe of little icicles across the brow. */
const ICE_FRINGE_TEMPLE_DROP = 0.05 * HEAD;
const ICE_FRINGE_SPAN = 0.8;
const ICE_FRINGE_HIGH = 0.16 * HEAD;
const ICE_FRINGE_LOW = 0.02 * HEAD;
const ICE_SIDE_FRINGE_BACK = 0.3;
const ICE_SIDE_FRINGE_RISE = 0.12 * HEAD;
const ICE_SIDE_FRINGE_FRONT = 0.95;
const ICE_SIDE_BROW_RISE = 0.05 * HEAD;
const FLAME_HAIR_TONGUES = 5;
const FLAME_HAIR_HEIGHT = 0.8 * HEAD;
/** What is left of the flame hair, as a share of its height, once the glow has gone out. */
const FLAME_HAIR_GUTTERED = 0.2;
const FLAME_HAIR_SALT = 29;
/** The cap the flames rise from, just proud of the skull; in profile the flames stream back. */
const FLAME_HAIR_WIDTH = 1.04;
const FLAME_HAIR_CAP_HEIGHT = 1.02;
const FLAME_HAIR_SIDE_LEAN = 0.18 * HEAD;
const FLAME_HAIRLINE_DROP = 0.04 * HEAD;
/** Dark at the scalp, through flame and gold, to a white-hot tip. */
const FLAME_HAIR_BODY_STOP = 0.45;
const FLAME_HAIR_GOLD_STOP = 0.8;
/** The outermost flames stand nearly as tall as the middle one: a ragged crown, where a single tall point would read as the necro's hood. */
const FLAME_HAIR_OUTER_SHARE = 0.8;
/** Each flame's tip leans in over the crown and sways with its lick. */
const FLAME_HAIR_TIP_INSET = 0.8;
const FLAME_HAIR_LICK_SWAY = 0.06 * HEAD;
/** A flame's sides: flaring out at the root and full-bodied up its leading side, curling in on the trailing one. */
const FLAME_HAIR_ROOT_FLARE = 1.1;
const FLAME_HAIR_LEAD_BODY = 0.5;
const FLAME_HAIR_TAIL_BODY = 0.2;
/** The hairline arches over the brow from the front; in profile it steps down to the brow. */
const FLAME_HAIR_BROW_ARCH = 0.36 * HEAD;
const FLAME_HAIR_SIDE_BROW = 0.4;
const FLAME_HAIR_SIDE_BROW_RISE = 0.2 * HEAD;

function paintFlameHair(ink: Ink, pass: Pass, head: Pt): void {
  const { ctx, view, design, pose } = ink;
  const { palette } = design;
  const rx = HEAD_RADIUS_X * FLAME_HAIR_WIDTH * (view === 'side' ? SIDE_HEAD_DEPTH : 1);
  const ry = HEAD_RADIUS_Y * FLAME_HAIR_CAP_HEIGHT;
  const lean = view === 'side' ? -FLAME_HAIR_SIDE_LEAN : 0;
  const gradient = ctx.createLinearGradient(
    head.x,
    head.y,
    head.x,
    head.y - ry - FLAME_HAIR_HEIGHT,
  );
  gradient.addColorStop(0, tinted(ink, palette.hairShade));
  gradient.addColorStop(FLAME_HAIR_BODY_STOP, tinted(ink, palette.hair));
  gradient.addColorStop(FLAME_HAIR_GOLD_STOP, tinted(ink, palette.accent));
  gradient.addColorStop(1, tinted(ink, palette.accentBright));
  const hairline = head.y + FLAME_HAIRLINE_DROP;
  blob(
    ink,
    pass,
    () => {
      ctx.moveTo(head.x - rx, hairline);
      for (let i = 0; i < FLAME_HAIR_TONGUES; i++) {
        const a0 = lerp(Math.PI, Math.PI * 2, i / FLAME_HAIR_TONGUES);
        const a1 = lerp(Math.PI, Math.PI * 2, (i + 1) / FLAME_HAIR_TONGUES);
        const mid = (a0 + a1) / 2;
        const rate = FLAME_LICK_BASE_RATE + (i % FLAME_LICK_RATES);
        const lick = Math.sin((pose.flicker * rate + hash01(i, FLAME_HAIR_SALT)) * Math.PI * 2);
        const centreWeight = 1 - Math.abs(i - (FLAME_HAIR_TONGUES - 1) / 2) / FLAME_HAIR_TONGUES;
        const height =
          FLAME_HAIR_HEIGHT *
          (FLAME_HAIR_OUTER_SHARE + (1 - FLAME_HAIR_OUTER_SHARE) * centreWeight) *
          flameReach(lick) *
          lerp(FLAME_HAIR_GUTTERED, 1, clamp01(pose.glow));
        const tipX =
          head.x + Math.cos(mid) * rx * FLAME_HAIR_TIP_INSET + lean + lick * FLAME_HAIR_LICK_SWAY;
        const tipY = head.y + Math.sin(mid) * ry - height;
        const x1 = head.x + Math.cos(a1) * rx;
        const y1 = head.y + Math.sin(a1) * ry;
        ctx.quadraticCurveTo(
          head.x + Math.cos(a0) * rx * FLAME_HAIR_ROOT_FLARE,
          tipY + height * FLAME_HAIR_LEAD_BODY,
          tipX,
          tipY,
        );
        ctx.quadraticCurveTo(
          (tipX + x1) / 2,
          (tipY + y1) / 2 + height * FLAME_HAIR_TAIL_BODY,
          x1,
          y1,
        );
      }
      ctx.lineTo(head.x + rx, hairline);
      if (view === 'front') {
        ctx.quadraticCurveTo(head.x, head.y - FLAME_HAIR_BROW_ARCH, head.x - rx, hairline);
      } else if (view === 'side') {
        ctx.lineTo(head.x + rx * FLAME_HAIR_SIDE_BROW, head.y - FLAME_HAIR_SIDE_BROW_RISE);
      }
      ctx.closePath();
    },
    gradient,
  );
}

const EMBERS = 4;

function paintEmbers(ink: Ink): void {
  const { ctx, design, pose } = ink;
  const { palette } = design;
  for (let i = 0; i < EMBERS; i++) {
    const rise = (pose.flicker + hash01(i, EMBER_RISE_SALT)) % 1;
    const x =
      (hash01(i, EMBER_SPREAD_SALT) - 0.5) * EMBER_SPREAD * 2 +
      Math.sin(rise * Math.PI * EMBER_WEAVE_HALF_TURNS + i) * EMBER_WEAVE;
    const y = lerp(CROTCH_Y, HEAD_CENTRE_Y - HEAD, rise);
    const fade = Math.sin(rise * Math.PI) * clamp01(pose.glow);
    dot(ctx, x, y, ink.px * EMBER_PX, rgba(mix(palette.accentBright, palette.accent, rise), fade));
  }
}

const EMBER_PX = 0.9;
const EMBER_RISE_SALT = 31;
const EMBER_SPREAD_SALT = 37;
/** Embers rise anywhere within this far either side of the body, weaving a little as they go. */
const EMBER_SPREAD = 0.7 * HEAD;
const EMBER_WEAVE = 0.05 * HEAD;
const EMBER_WEAVE_HALF_TURNS = 4;

function paintHoodAndMask(ink: Ink, pass: Pass, head: Pt): void {
  const { ctx, view, design } = ink;
  const { palette } = design;
  const rx = HEAD_RADIUS_X * HOOD_WIDTH * (view === 'side' ? SIDE_HEAD_DEPTH : 1);
  const ry = HEAD_RADIUS_Y * HOOD_HEIGHT;
  const peakX = view === 'side' ? head.x - rx * HOOD_SIDE_PEAK_BACK : head.x;
  const hoodFoot = head.y + HOOD_DROP;
  const peakY = head.y - ry - HOOD_PEAK;
  blob(
    ink,
    pass,
    () => {
      ctx.moveTo(head.x - rx, hoodFoot);
      ctx.quadraticCurveTo(
        head.x - rx * HOOD_BELLY,
        head.y - ry * HOOD_LEFT_SHOULDER,
        peakX,
        peakY,
      );
      ctx.quadraticCurveTo(
        head.x + rx * HOOD_BELLY,
        head.y - ry * HOOD_RIGHT_SHOULDER,
        head.x + rx,
        hoodFoot,
      );
      ctx.closePath();
    },
    palette.hair,
  );
  if (view === 'away') return;
  const sideView = view === 'side';
  const maskX = sideView ? head.x + HEAD_RADIUS_X * MASK_SIDE_FORWARD : head.x;
  const maskRx = HEAD_RADIUS_X * (sideView ? MASK_SIDE_HALF_WIDTH : MASK_HALF_WIDTH);
  const maskTop = head.y - HEAD_RADIUS_Y * MASK_TOP;
  const chin = head.y + HEAD_RADIUS_Y * MASK_CHIN;
  const jawControlY = chin - MASK_JAW_LIFT;
  blob(
    ink,
    pass,
    () => {
      ctx.moveTo(maskX - maskRx, head.y);
      ctx.quadraticCurveTo(maskX - maskRx, maskTop, maskX, maskTop);
      ctx.quadraticCurveTo(maskX + maskRx, maskTop, maskX + maskRx, head.y);
      ctx.quadraticCurveTo(maskX + maskRx * MASK_JAW_TAPER, jawControlY, maskX, chin);
      ctx.quadraticCurveTo(maskX - maskRx * MASK_JAW_TAPER, jawControlY, maskX - maskRx, head.y);
      ctx.closePath();
    },
    palette.accent,
    palette.skinShade,
  );
  if (pass !== 'fill') return;
  const socketY = head.y + EYE_Y * SOCKET_DROP;
  const socketRx = maskRx * SOCKET_WIDTH;
  const sockets = sideView
    ? [maskX + maskRx * SOCKET_SIDE_OFFSET]
    : [maskX - maskRx * SOCKET_SPACING, maskX + maskRx * SOCKET_SPACING];
  for (const sx of sockets) {
    ctx.fillStyle = palette.skinShade;
    ctx.beginPath();
    ctx.ellipse(sx, socketY, socketRx, HEAD_RADIUS_Y * SOCKET_HEIGHT, 0, 0, Math.PI * 2);
    ctx.fill();
    radialGlow(ctx, sx, socketY, socketRx * SOCKET_GLOW_SCALE, palette.eye, SOCKET_GLOW_ALPHA);
    dot(ctx, sx, socketY, EYE_RADIUS * SOCKET_PUPIL_SHARE, palette.eye);
  }
  if (sideView) return;
  const noseY = head.y + HEAD_RADIUS_Y * MASK_NOSE_Y;
  ctx.fillStyle = palette.skinShade;
  ctx.beginPath();
  ctx.moveTo(maskX - MASK_NOSE_HALF, noseY);
  ctx.lineTo(maskX + MASK_NOSE_HALF, noseY);
  ctx.lineTo(maskX, noseY + MASK_NOSE_HALF * 2);
  ctx.closePath();
  ctx.fill();
  if (!ink.detailed) return;
  const teethY = lerp(noseY, chin, MASK_TEETH_DEPTH);
  const teethHalf = maskRx * MASK_TEETH_HALF;
  ctx.strokeStyle = palette.skinShade;
  ctx.lineWidth = ink.px;
  ctx.beginPath();
  ctx.moveTo(maskX - teethHalf, teethY);
  ctx.lineTo(maskX + teethHalf, teethY);
  for (let i = 1; i < MASK_TEETH; i++) {
    const x = lerp(maskX - teethHalf, maskX + teethHalf, i / MASK_TEETH);
    ctx.moveTo(x, teethY - MASK_TOOTH_HEIGHT);
    ctx.lineTo(x, teethY + MASK_TOOTH_HEIGHT);
  }
  ctx.stroke();
}

/**
 * The bone mask, as shares of the head's radii: a skull face that fills the
 * hood's opening, pointed at the jaw, pushed to the front of the head in
 * profile.
 */
const MASK_HALF_WIDTH = 0.92;
const MASK_SIDE_HALF_WIDTH = 0.62;
const MASK_SIDE_FORWARD = 0.45;
const MASK_TOP = 0.7;
const MASK_CHIN = 0.95;
/** How far in the jaw's curve pulls toward the chin, and how far up its control point sits. */
const MASK_JAW_TAPER = 0.6;
const MASK_JAW_LIFT = 0.1 * HEAD;
/**
 * Big black sockets with a green point burning in each: two dark holes in a
 * pale face are what make it a skull. A glow the size of the whole eye washes
 * the bone green and it reads as a green face instead.
 */
const SOCKET_SPACING = 0.42;
const SOCKET_SIDE_OFFSET = 0.3;
const SOCKET_WIDTH = 0.36;
const SOCKET_HEIGHT = 0.32;
/** Sockets sit a little higher on the mask than an ordinary fairy's eyes sit on its face. */
const SOCKET_DROP = 0.6;
const SOCKET_PUPIL_SHARE = 0.8;
/** A skull's nose is a dark notch between the sockets and the teeth. */
const MASK_NOSE_Y = 0.36;
const MASK_NOSE_HALF = 0.05 * HEAD;
/** The teeth: a seam across the jaw with ticks, drawn only when there are pixels for it. */
const MASK_TEETH = 4;
const MASK_TEETH_DEPTH = 0.55;
const MASK_TEETH_HALF = 0.45;
const MASK_TOOTH_HEIGHT = 0.04 * HEAD;

const HOOD_PEAK = 0.6 * HEAD;
/** The hood stands well off the skull and drops to the jaw; in profile its peak flops back. */
const HOOD_WIDTH = 1.2;
const HOOD_HEIGHT = 1.12;
const HOOD_DROP = 0.42 * HEAD;
const HOOD_SIDE_PEAK_BACK = 1.1;
/** The hood's sides bell out; one side sits a touch lower, so the peak is not a perfect cone. */
const HOOD_BELLY = 1.1;
const HOOD_LEFT_SHOULDER = 0.6;
const HOOD_RIGHT_SHOULDER = 0.7;
/**
 * The glow in each socket reaches just past its rim, and burns near full
 * strength: in a black hood over a black robe the eyes are the first thing
 * that finds the figure on a dark floor.
 */
const SOCKET_GLOW_SCALE = 1.3;
const SOCKET_GLOW_ALPHA = 0.95;
const SHROUD_TATTERS = 5;
/** The robe: shoulder-wide at the top, belling out past the hips to a hem most of the way to the toes. */
const SHROUD_SHOULDERS = 1.05;
const SHROUD_SIDE_SHOULDERS = 0.8;
const SHROUD_HEM = 2.1;
const SHROUD_SIDE_HEM = 1.7;
const SHROUD_LENGTH = 0.92;
const SHROUD_BELLY = 1.1;
/** In profile the robe hangs a little back and its hem streams behind. */
const SHROUD_SIDE_SHIFT = 0.02 * HEAD;
const SHROUD_SIDE_TRAIL = 0.35 * HEAD;
/** Each tatter hangs this deep in heads, give or take its variance, and lengthens and sways as it flaps. */
const SHROUD_TATTER_DEPTH = 0.24;
const SHROUD_TATTER_VARIANCE = 0.12;
const SHROUD_TATTER_SALT = 41;
const SHROUD_TATTER_LICK = 0.25;
const SHROUD_TATTER_SWAY = 0.04 * HEAD;
const SHROUD_TATTER_STAGGER = 0.23;
/** Tatter tips stream back less than the hem they hang from. */
const SHROUD_TATTER_TRAIL = 0.4;
/** The notch between tatters rides just above the hem line. */
const SHROUD_NOTCH_RISE = 0.04 * HEAD;

/** A robe from the shoulders past the feet, its hem torn into tatters that stream behind. */
function paintShroud(ink: Ink, pass: Pass): void {
  const { ctx, view, design, pose } = ink;
  const { palette } = design;
  const sideView = view === 'side';
  const trail = sideView ? -SHROUD_SIDE_TRAIL : 0;
  const halfTop = SHOULDER_HALF * (sideView ? SHROUD_SIDE_SHOULDERS : SHROUD_SHOULDERS);
  const halfHem = HIP_HALF * (sideView ? SHROUD_SIDE_HEM : SHROUD_HEM);
  const hem = CROTCH_Y + HIP_TO_TOE_TILES * SHROUD_LENGTH;
  const gradient = ctx.createLinearGradient(0, SHOULDER_Y, 0, hem);
  gradient.addColorStop(0, tinted(ink, palette.skinLight));
  gradient.addColorStop(SHROUD_BODY_STOP, tinted(ink, palette.skin));
  gradient.addColorStop(SHROUD_DARKEST_STOP, tinted(ink, palette.skinShade));
  gradient.addColorStop(1, tinted(ink, mix(palette.skinShade, palette.glow, SHROUD_HEM_GLOW)));
  const tatterTips: Pt[] = [];
  blob(
    { ...ink, px: ink.px * SHROUD_RIM_INK_PX },
    pass,
    () => {
      const cx = sideView ? -SHROUD_SIDE_SHIFT : 0;
      ctx.moveTo(cx - halfTop, SHOULDER_Y);
      ctx.quadraticCurveTo(cx - halfTop * SHROUD_BELLY, WAIST_Y, cx - halfHem + trail, hem);
      for (let i = 0; i < SHROUD_TATTERS; i++) {
        const x0 = lerp(cx - halfHem, cx + halfHem, i / SHROUD_TATTERS) + trail;
        const x1 = lerp(cx - halfHem, cx + halfHem, (i + 1) / SHROUD_TATTERS) + trail;
        const lick = Math.sin((pose.flicker + i * SHROUD_TATTER_STAGGER) * Math.PI * 2);
        const depth =
          (SHROUD_TATTER_DEPTH + SHROUD_TATTER_VARIANCE * hash01(i, SHROUD_TATTER_SALT)) *
          HEAD *
          (1 + SHROUD_TATTER_LICK * lick);
        const tip = {
          x: (x0 + x1) / 2 + lick * SHROUD_TATTER_SWAY + trail * SHROUD_TATTER_TRAIL,
          y: hem + depth,
        };
        tatterTips.push(tip);
        ctx.lineTo(tip.x, tip.y);
        ctx.lineTo(x1, hem - SHROUD_NOTCH_RISE);
      }
      ctx.quadraticCurveTo(cx + halfTop * SHROUD_BELLY, WAIST_Y, cx + halfTop, SHOULDER_Y);
      ctx.closePath();
    },
    gradient,
  );
  if (pass === 'fill') paintShroudWisps(ink, tatterTips);
}

/** How far down the robe it is still its body colour, and where it is darkest before the hem glows. */
const SHROUD_BODY_STOP = 0.35;
const SHROUD_DARKEST_STOP = 0.7;
/**
 * The tatters smoulder with the kind's own light. A near-black robe is lost
 * on the darkest floor, and a glowing hem gives it a lower edge without
 * lifting the robe out of black.
 */
const SHROUD_HEM_GLOW = 0.45;
/** The shroud's violet rim is drawn thicker than the body's outline: it is what separates the robe from a black floor. */
const SHROUD_RIM_INK_PX = 1.6;
/** Every other tatter sheds a wisp. */
const SHROUD_WISP_EVERY = 2;
/**
 * Wisps curl up and out from the tatters rather than dropping below them: the
 * hem is the figure's lowest point, and a light hanging under it would read
 * as a foot reaching for the ground.
 */
const SHROUD_WISP_RISE = 0.5 * HEAD;
const SHROUD_WISP_OUT = 0.3 * HEAD;
const SHROUD_WISP_BACK = 0.35 * HEAD;
const SHROUD_WISP_GLOW = 0.2 * HEAD;
const SHROUD_WISP_CORE = 0.07 * HEAD;
const SHROUD_WISP_ALPHA = 0.8;
/** Staggers each wisp's cycle so they never leave the hem together. */
const SHROUD_WISP_STAGGER = 0.37;

/**
 * Wisps of the fairy's own soul-light peeling off its tatters and trailing
 * away from it: a moving light below a dark body is what finds the necro
 * fairy on a black floor.
 */
function paintShroudWisps(ink: Ink, tips: readonly Pt[]): void {
  const { ctx, design, pose, view } = ink;
  const { palette } = design;
  const middle = (tips.length - 1) / 2;
  tips.forEach((tip, i) => {
    if (i % SHROUD_WISP_EVERY !== 0) return;
    const cycle = (pose.flicker + i * SHROUD_WISP_STAGGER) % 1;
    const alpha = Math.sin(cycle * Math.PI) * SHROUD_WISP_ALPHA * pose.glow;
    if (clampAlpha(alpha) === 0) return;
    const outward = view === 'side' ? -SHROUD_WISP_BACK : Math.sign(i - middle) * SHROUD_WISP_OUT;
    const x = tip.x + outward * cycle;
    const y = tip.y - SHROUD_WISP_RISE * cycle;
    radialGlow(ctx, x, y, SHROUD_WISP_GLOW, palette.eye, alpha);
    dot(ctx, x, y, SHROUD_WISP_CORE, rgba(mix(palette.eye, '#ffffff', alpha), alpha));
  });
}

// ── Cast effects ─────────────────────────────────────────────────────────────

function handsMidpoint(right: LimbChain, left: LimbChain): Pt {
  return { x: (right.end.x + left.end.x) / 2, y: (right.end.y + left.end.y) / 2 };
}

function radialGlow(
  ctx: Ctx,
  x: number,
  y: number,
  radius: number,
  color: string,
  alpha: number,
): void {
  const safe = clampAlpha(Math.min(1, alpha));
  if (safe === 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, rgba(color, safe));
  g.addColorStop(1, rgba(color, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** A ring stroked twice: a wide soft halo under a thin bright core. */
function haloStroke(
  ink: Ink,
  trace: () => void,
  halo: string,
  core: string,
  alpha: number,
  fill: string | null = null,
): void {
  const { ctx } = ink;
  ctx.lineJoin = 'round';
  if (fill !== null) {
    ctx.fillStyle = fill;
    ctx.beginPath();
    trace();
    ctx.fill();
  }
  // The ink line under the pale core is what keeps a ring of light on snow,
  // where the glow and the core are both the floor's own value.
  for (const [width, color, share] of [
    [ink.px * HALO_STROKE_PX, halo, HALO_STROKE_ALPHA],
    [ink.px * (CORE_STROKE_PX + HALO_INK_PX), ink.design.palette.outline, HALO_INK_ALPHA],
    [ink.px * CORE_STROKE_PX, core, 1],
  ] as const) {
    ctx.strokeStyle = rgba(color, alpha * share);
    ctx.lineWidth = width;
    ctx.beginPath();
    trace();
    ctx.stroke();
  }
}

/**
 * A small solid ball of light with a dark rim: the one effect shape that
 * survives 32 px, where a glow alone is a smear the colour of the body.
 */
function heldOrb(ink: Ink, at: Pt, radius: number, fill: string, rim: string): void {
  if (radius <= ink.px * HELD_ORB_MIN_PX) return;
  const { ctx } = ink;
  ctx.fillStyle = rim;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius + ink.px, 0, Math.PI * 2);
  ctx.fill();
  const g = ctx.createRadialGradient(at.x, at.y, 0, at.x, at.y, radius);
  g.addColorStop(0, '#ffffff');
  g.addColorStop(HELD_ORB_CORE_SHARE, fill);
  g.addColorStop(1, fill);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  ctx.fill();
}

const HELD_ORB_RADIUS = 0.3 * HEAD;
const HELD_ORB_MIN_PX = 0.4;
const HELD_ORB_CORE_SHARE = 0.35;
const HALO_STROKE_PX = 3.5;
const HALO_STROKE_ALPHA = 0.55;
const CORE_STROKE_PX = 1.6;
/** The ink either side of the core: a pixel each way, a little translucent so it rims rather than cuts. */
const HALO_INK_PX = 2;
const HALO_INK_ALPHA = 0.8;
const HEX_SIDES = 6;
const HAND_GLOW_RADIUS = 0.3 * HEAD;

/**
 * The ward: light gathers in both raised hands and the sigil flares; on
 * release the sigil throws off a hexagon that climbs and widens as it goes to
 * its target.
 */
function paintWardEffect(ink: Ink, right: LimbChain, left: LimbChain): void {
  const { ctx, design, pose, view } = ink;
  const { palette } = design;
  for (const chain of [right, left]) {
    radialGlow(ctx, chain.end.x, chain.end.y, HAND_GLOW_RADIUS, palette.glow, pose.effectAmount);
    heldOrb(
      ink,
      chain.end,
      HELD_ORB_RADIUS * WARD_ORB_SHARE * pose.effectAmount,
      '#ffffff',
      palette.skinShade,
    );
  }
  const split = pose.effectRelease;
  if (split <= 0) return;
  const squash = view === 'side' ? SIDE_RING_SQUASH : 1;
  const cx = view === 'side' ? SIGIL_FORWARD + split * WARD_GLYPH_DRIFT : 0;
  const cy = CHEST_Y - WARD_GLYPH_START_RISE - split * WARD_GLYPH_RISE;
  const radius = lerp(SIGIL_RADIUS * WARD_GLYPH_START_SCALE, WARD_GLYPH_RADIUS, split);
  haloStroke(
    ink,
    () => {
      for (let i = 0; i <= HEX_SIDES; i++) {
        const a = (i / HEX_SIDES) * Math.PI * 2 + Math.PI / HEX_SIDES;
        const x = cx + Math.cos(a) * radius * squash;
        const y = cy + Math.sin(a) * radius * RING_TILT;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
    },
    palette.glow,
    '#ffffff',
    1 - split * WARD_GLYPH_FADE,
    rgba(palette.glow, WARD_GLYPH_FILL_ALPHA * (1 - split * WARD_GLYPH_FADE)),
  );
  // Bright corners are what make a pale hexagon a barrier and not a haze.
  for (let i = 0; i < HEX_SIDES; i++) {
    const a = (i / HEX_SIDES) * Math.PI * 2 + Math.PI / HEX_SIDES;
    dot(
      ctx,
      cx + Math.cos(a) * radius * squash,
      cy + Math.sin(a) * radius * RING_TILT,
      WARD_VERTEX_RADIUS,
      rgba(palette.accent, 1 - split * WARD_GLYPH_FADE),
    );
  }
}

const WARD_GLYPH_FILL_ALPHA = 0.32;
/** The light in each raised hand is smaller than a held spell: the sigil is the ward's focus, not the hands. */
const WARD_ORB_SHARE = 0.7;
const WARD_VERTEX_RADIUS = 0.13 * HEAD;

const SIDE_RING_SQUASH = 0.45;
/** A ring lying roughly in the ground plane, seen from the game's high camera. */
const RING_TILT = 0.8;
const WARD_GLYPH_DRIFT = 0.2 * HEAD;
/**
 * The hexagon opens centred low enough to ring the fairy's whole body, not
 * just its head: a barrier has to enclose what it protects, not sit on top of
 * it like a hat.
 */
const WARD_GLYPH_START_RISE = 0.3 * HEAD;
const WARD_GLYPH_RISE = 0.25 * HEAD;
const WARD_GLYPH_RADIUS = 2.1 * HEAD;
const WARD_GLYPH_START_SCALE = 1.4;
const WARD_GLYPH_FADE = 0.5;

const BLOOM_PETALS = 6;
const BLOOM_LIFT = 0.12 * HEAD;
const BLOOM_MIN_PETAL = 0.1 * HEAD;
const BLOOM_MAX_PETAL = 0.8 * HEAD;
const BLOOM_FAN = Math.PI * 1.6;
const BLOOM_HEART = 0.09 * HEAD;
const BLOOM_GLOW = 0.6 * HEAD;
/** The bloom's glow, heart and petal fan while it is still a bud, as shares of their size once open. */
const BLOOM_GLOW_BUD_SHARE = 0.6;
const BLOOM_HEART_BUD_SHARE = 0.5;
const BLOOM_BUD_FAN_SHARE = 0.2;
const BLOOM_HEART_COLOR = '#fff2a0';
const HEAL_BURST_MIN_RADIUS = 0.9 * HEAD;
const HEAL_BURST_RADIUS = 2.3 * HEAD;
/** How much of its opacity the burst ring has lost by the row's last frame. */
const HEAL_BURST_FADE = 0.6;
/**
 * Plus-shaped sparks that rise off the bloom as it releases: the one mark of
 * healing that survives 32 px, where a ring alone could be any spell.
 */
const HEAL_SPARKS = 3;
const HEAL_SPARK_ARM = 0.55 * HEAD;
/** A cross's bar thickness as a share of its arm: stout, so it reads as a plus and not a star. */
const HEAL_CROSS_BAR_SHARE = 0.5;
const HEAL_SPARK_RISE = 1.1 * HEAD;
const HEAL_SPARK_SPREAD = 2.3 * HEAD;
const HEAL_SPARK_OUTLINE_PX = 2;
const HEAL_SPARK_COLOR = '#f4ffe8';
const HEAL_MOTES = 3;
const HEAL_MOTE_SWAY = 0.3 * HEAD;
const HEAL_MOTE_RISE = 1.4 * HEAD;
/**
 * The crosses rise from above the head, not from the bloom: the cupped hands
 * sit under the chin, and a white cross over the face reads as X-eyes.
 */
const HEAL_MOTE_START_LIFT = 1.1 * HEAD;
const HEAL_MOTE_RADIUS = 0.4 * HEAD;

/** The heal: a flower opens between cupped hands, and on release bursts into a ring of light. */
function paintHealEffect(ink: Ink, right: LimbChain, left: LimbChain): void {
  const { ctx, design, pose } = ink;
  const { palette } = design;
  const mid = handsMidpoint(right, left);
  const cy = mid.y - BLOOM_LIFT;
  const open = clamp01(pose.effectProgress + pose.effectRelease);
  radialGlow(
    ctx,
    mid.x,
    cy,
    BLOOM_GLOW * (BLOOM_GLOW_BUD_SHARE + open),
    palette.glow,
    pose.effectAmount,
  );
  const petalLength = lerp(BLOOM_MIN_PETAL, BLOOM_MAX_PETAL, open);
  const fan = lerp(BLOOM_BUD_FAN_SHARE, 1, open) * BLOOM_FAN;
  for (let i = 0; i < BLOOM_PETALS; i++) {
    const a = -Math.PI / 2 + ((i - (BLOOM_PETALS - 1) / 2) / BLOOM_PETALS) * fan;
    const tx = mid.x + Math.cos(a) * petalLength;
    const ty = cy + Math.sin(a) * petalLength;
    ctx.fillStyle = tinted(ink, i % 2 === 0 ? palette.accentBright : palette.accent);
    ctx.strokeStyle = palette.outline;
    ctx.lineWidth = ink.px;
    ctx.beginPath();
    ctx.ellipse(
      (mid.x + tx) / 2,
      (cy + ty) / 2,
      petalLength / 2,
      petalLength * PETAL_WIDTH_SHARE,
      a,
      0,
      Math.PI * 2,
    );
    ctx.stroke();
    ctx.fill();
  }
  dot(ctx, mid.x, cy, BLOOM_HEART * (BLOOM_HEART_BUD_SHARE + open), BLOOM_HEART_COLOR);
  for (let i = 0; i < HEAL_MOTES; i++) {
    const rise = (pose.effectProgress + i / HEAL_MOTES) % 1;
    const x = mid.x + Math.sin((rise + i) * Math.PI * 2) * HEAL_MOTE_SWAY;
    const y = cy - HEAL_MOTE_START_LIFT - rise * HEAL_MOTE_RISE;
    paintHealCross(ink, x, y, HEAL_MOTE_RADIUS * Math.sin(rise * Math.PI) * pose.effectAmount);
  }
  if (pose.effectRelease <= 0) return;
  const burst = pose.effectRelease;
  const ring = lerp(HEAL_BURST_MIN_RADIUS, HEAL_BURST_RADIUS, burst);
  haloStroke(
    ink,
    () => ctx.ellipse(mid.x, cy, ring, ring * RING_TILT, 0, 0, Math.PI * 2),
    palette.glow,
    palette.wingTip,
    1 - burst * HEAL_BURST_FADE,
  );
  for (let i = 0; i < HEAL_SPARKS; i++) {
    const across = (i - (HEAL_SPARKS - 1) / 2) / Math.max(1, HEAL_SPARKS - 1);
    const x = mid.x + across * HEAL_SPARK_SPREAD;
    const y = cy - HEAL_SPARK_RISE * (burst + (i % 2) * HEAL_SPARK_STAGGER);
    paintHealCross(ink, x, y, HEAL_SPARK_ARM * (i % 2 === 0 ? 1 : HEAL_SPARK_SMALL));
  }
}

/**
 * A plus sign, the one mark every player reads as healing: near-white, so it
 * stands off the healer's green body, and inked dark so it holds against its
 * pale wings and on snow.
 * Its bar is a fixed share of its arm, so a small rising cross is still a
 * cross and not a dot.
 */
function paintHealCross(ink: Ink, x: number, y: number, arm: number): void {
  if (arm <= ink.px) return;
  const { ctx, design } = ink;
  const width = arm * HEAL_CROSS_BAR_SHARE;
  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(x - arm, y);
  ctx.lineTo(x + arm, y);
  ctx.moveTo(x, y - arm);
  ctx.lineTo(x, y + arm);
  ctx.strokeStyle = design.palette.outline;
  ctx.lineWidth = width + ink.px * HEAL_SPARK_OUTLINE_PX;
  ctx.stroke();
  ctx.strokeStyle = HEAL_SPARK_COLOR;
  ctx.lineWidth = width;
  ctx.stroke();
}

/** Every other spark rises a little ahead of its neighbours and is drawn smaller. */
const HEAL_SPARK_STAGGER = 0.3;
const HEAL_SPARK_SMALL = 0.7;

const PETAL_WIDTH_SHARE = 0.28;
const LANCE_MIN_LENGTH = 0.12 * HEAD;
/** Long enough to read as ice at 32 px; the aiming line ahead of it carries the rest of the warning. */
const LANCE_MAX_LENGTH = 1.1 * HEAD;
const LANCE_HALF_WIDTH = 0.26 * HEAD;
/** The lance starts this share of its full width and thickens as frost gathers. */
const LANCE_START_WIDTH_SHARE = 0.5;
/**
 * A band of deep cyan down the held lance. White on a pale wing is lost at
 * 32 px; the saturated band is what shows the lance against the fairy's own
 * wings and a snowfield alike.
 */
const LANCE_DEEP_ICE_STOP = 0.45;
/** The fingertip glow's size and opacity before any frost has gathered, and how much gathering adds. */
const LANCE_GLOW_REST_SHARE = 0.5;
const LANCE_GLOW_REST_ALPHA = 0.35;
const LANCE_GLOW_GATHER_ALPHA = 0.5;
/** Seen from the front the arm points at the camera, so the lance is foreshortened too. */
const LANCE_FRONT_FORESHORTEN = 0.85;
const LANCE_GLOW = 0.5 * HEAD;
const LANCE_FLASH = 0.55 * HEAD;
/** A four-point glint at the fingertip, the one frost cue that survives 32 px on a pale wing. */
const LANCE_SPARKLE = 0.45 * HEAD;
const MIN_POINTING_REACH = 0.05 * HEAD;

/**
 * The ice cast: a lance of frost and its aiming line grow from the pointing
 * fingertip as the arm comes up, and on release a bolt leaves the fingertip in
 * a burst of frost — the same pale shard the bolt then flies as, so the frame
 * and the projectile beside it tell one story.
 */
function paintBeamEffect(ink: Ink, right: LimbChain): void {
  const { ctx, design, pose } = ink;
  const { palette } = design;
  const tip = right.end;
  const gather = pose.effectAmount;
  // The lance shoots out early and then thickens, so it reads from the row's
  // first frames rather than only its last.
  const grown = easeOut(gather);
  radialGlow(
    ctx,
    tip.x,
    tip.y,
    LANCE_GLOW * (LANCE_GLOW_REST_SHARE + gather),
    palette.eye,
    LANCE_GLOW_REST_ALPHA + gather * LANCE_GLOW_GATHER_ALPHA,
  );
  const dx = right.end.x - right.joint.x;
  const dy = right.end.y - right.joint.y;
  const reach = Math.hypot(dx, dy);
  const pointing = reach < MIN_POINTING_REACH ? { x: 0, y: 1 } : { x: dx / reach, y: dy / reach };
  const released = pose.effectRelease > 0;
  if (released) {
    paintLeavingBolt(ink, tip, pointing, pose.effectRelease);
  } else {
    paintLanceAndAim(ink, tip, pointing, grown, gather);
  }
  const sparkle = LANCE_SPARKLE * gather;
  if (sparkle > ink.px) {
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = ink.px;
    ctx.beginPath();
    ctx.moveTo(tip.x - sparkle, tip.y);
    ctx.lineTo(tip.x + sparkle, tip.y);
    ctx.moveTo(tip.x, tip.y - sparkle);
    ctx.lineTo(tip.x, tip.y + sparkle);
    ctx.stroke();
  }
  if (!released) return;
  // A hard-edged burst rather than a soft bloom: a glow the size of the
  // fairy washes the release frame into a haze at 32 px.
  radialGlow(ctx, tip.x, tip.y, LANCE_FLASH, palette.glow, LANCE_FLASH_ALPHA);
  const burst = LANCE_BURST * (1 - pose.effectRelease * LANCE_BURST_SHRINK);
  for (let i = 0; i < LANCE_BURST_SPIKES; i++) {
    const angle = (i / LANCE_BURST_SPIKES) * Math.PI * 2 + Math.atan2(pointing.y, pointing.x);
    shard(
      ctx,
      tip.x + Math.cos(angle) * burst * LANCE_BURST_SPIKE_REACH,
      tip.y + Math.sin(angle) * burst * LANCE_BURST_SPIKE_REACH,
      burst * (i % 2 === 0 ? LANCE_BURST_LONG_SPIKE : LANCE_BURST_SHORT_SPIKE),
      angle + Math.PI / 2,
      '#ffffff',
      palette.outline,
      1,
    );
  }
  dot(ctx, tip.x, tip.y, burst * LANCE_BURST_CORE, '#ffffff');
}

/**
 * The held lance: a spike of frost at the fingertip, growing as the arm
 * comes up, with a dashed aiming line running on ahead of it to where the
 * bolt will go. A spike alone reads as a sword being drawn; the line out in front
 * of it is what says "this is about to fire".
 */
function paintLanceAndAim(ink: Ink, tip: Pt, pointing: Pt, grown: number, gather: number): void {
  const { ctx, design, view } = ink;
  const { palette } = design;
  const foreshorten = view === 'front' ? LANCE_FRONT_FORESHORTEN : 1;
  const length = lerp(LANCE_MIN_LENGTH, LANCE_MAX_LENGTH, grown) * foreshorten;
  const half = LANCE_HALF_WIDTH * lerp(LANCE_START_WIDTH_SHARE, 1, gather);
  const aimLength = lerp(length, LANCE_AIM_REACH, grown);
  ctx.lineCap = 'butt';
  ctx.setLineDash([LANCE_AIM_DASH, LANCE_AIM_GAP]);
  ctx.lineDashOffset = 0;
  ctx.beginPath();
  ctx.moveTo(tip.x + pointing.x * length, tip.y + pointing.y * length);
  ctx.lineTo(tip.x + pointing.x * aimLength, tip.y + pointing.y * aimLength);
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = ink.px * LANCE_AIM_INK_PX;
  ctx.stroke();
  ctx.strokeStyle = tinted(ink, FROST_DRESS_ICE);
  ctx.lineWidth = ink.px * LANCE_AIM_PX;
  ctx.stroke();
  ctx.setLineDash([]);
  const nx = -pointing.y;
  const ny = pointing.x;
  const ice = ctx.createLinearGradient(
    tip.x,
    tip.y,
    tip.x + pointing.x * length,
    tip.y + pointing.y * length,
  );
  ice.addColorStop(0, tinted(ink, palette.eye));
  ice.addColorStop(LANCE_DEEP_ICE_STOP, tinted(ink, FROST_DRESS_DEEP));
  ice.addColorStop(1, tinted(ink, '#ffffff'));
  ctx.fillStyle = ice;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = ink.px * LANCE_OUTLINE_PX;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(tip.x - pointing.x * half, tip.y - pointing.y * half);
  ctx.lineTo(tip.x + nx * half, tip.y + ny * half);
  ctx.lineTo(tip.x + pointing.x * length, tip.y + pointing.y * length);
  ctx.lineTo(tip.x - nx * half, tip.y - ny * half);
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}

/**
 * The bolt just loosed: a pale shard pointing along the aim, clear of the
 * fingertip, with a short streak of frost-light back to the hand. The shard
 * leaves a gap at the fingertip because one touching the hand reads as a held
 * blade, not a thrown one, and it moves out along the aim over the frames
 * after the release as the real bolt does.
 */
function paintLeavingBolt(ink: Ink, tip: Pt, pointing: Pt, release: number): void {
  const { ctx, design } = ink;
  const { palette } = design;
  const centreReach = lerp(LEAVING_BOLT_START_REACH, LEAVING_BOLT_END_REACH, release);
  const centre = { x: tip.x + pointing.x * centreReach, y: tip.y + pointing.y * centreReach };
  const half = LEAVING_BOLT_LENGTH / 2;
  const tail = { x: centre.x - pointing.x * half, y: centre.y - pointing.y * half };
  const point = { x: centre.x + pointing.x * half, y: centre.y + pointing.y * half };
  const streakStart = {
    x: tip.x + pointing.x * LEAVING_BOLT_GAP,
    y: tip.y + pointing.y * LEAVING_BOLT_GAP,
  };
  ctx.lineCap = 'round';
  ctx.strokeStyle = rgba(palette.glow, LEAVING_BOLT_STREAK_ALPHA);
  ctx.lineWidth = LEAVING_BOLT_STREAK_WIDTH;
  ctx.beginPath();
  ctx.moveTo(streakStart.x, streakStart.y);
  ctx.lineTo(tail.x, tail.y);
  ctx.stroke();
  radialGlow(ctx, centre.x, centre.y, LEAVING_BOLT_HALO, palette.glow, LEAVING_BOLT_HALO_ALPHA);

  const nx = -pointing.y;
  const ny = pointing.x;
  const shoulderReach = -half + LEAVING_BOLT_LENGTH * LEAVING_BOLT_SHOULDER_SHARE;
  const side = LEAVING_BOLT_WIDTH / 2;
  const ice = ctx.createLinearGradient(tail.x, tail.y, point.x, point.y);
  ice.addColorStop(0, tinted(ink, FROST_DRESS_DEEP));
  ice.addColorStop(LANCE_DEEP_ICE_STOP, tinted(ink, palette.eye));
  ice.addColorStop(1, tinted(ink, '#ffffff'));
  ctx.fillStyle = ice;
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = ink.px * LANCE_OUTLINE_PX;
  ctx.lineJoin = 'miter';
  ctx.beginPath();
  ctx.moveTo(point.x, point.y);
  ctx.lineTo(
    centre.x + pointing.x * shoulderReach + nx * side,
    centre.y + pointing.y * shoulderReach + ny * side,
  );
  ctx.lineTo(tail.x, tail.y);
  ctx.lineTo(
    centre.x + pointing.x * shoulderReach - nx * side,
    centre.y + pointing.y * shoulderReach - ny * side,
  );
  ctx.closePath();
  ctx.stroke();
  ctx.fill();
}

/** The loosed bolt's shard: its size, and where its widest point sits from the tail. */
const LEAVING_BOLT_LENGTH = 0.8 * HEAD;
const LEAVING_BOLT_WIDTH = 0.38 * HEAD;
const LEAVING_BOLT_SHOULDER_SHARE = 0.35;
/** How far past the fingertip the shard's centre sits on the release, and by the row's end. */
const LEAVING_BOLT_START_REACH = 0.95 * HEAD;
const LEAVING_BOLT_END_REACH = 1.45 * HEAD;
/** The clear space between the fingertip and where the frost streak begins. */
const LEAVING_BOLT_GAP = 0.3 * HEAD;
const LEAVING_BOLT_STREAK_WIDTH = 0.22 * HEAD;
const LEAVING_BOLT_STREAK_ALPHA = 0.6;
const LEAVING_BOLT_HALO = 0.6 * HEAD;
const LEAVING_BOLT_HALO_ALPHA = 0.5;

/** How far the aiming line reaches past the fingertip: to the edge of the fairy's cell. */
const LANCE_AIM_REACH = 1.95 * HEAD;
const LANCE_AIM_DASH = 0.2 * HEAD;
const LANCE_AIM_GAP = 0.12 * HEAD;
const LANCE_AIM_PX = 2;
const LANCE_AIM_INK_PX = 4;
const LANCE_OUTLINE_PX = 2;
const LANCE_FLASH_ALPHA = 0.6;
/** The frost burst at the fingertip on the discharge: six ice spikes about a white core. */
const LANCE_BURST = 0.75 * HEAD;
const LANCE_BURST_SPIKES = 6;
/** Each spike is centred half the burst's radius out; long and short spikes alternate. */
const LANCE_BURST_SPIKE_REACH = 0.5;
const LANCE_BURST_LONG_SPIKE = 0.6;
const LANCE_BURST_SHORT_SPIKE = 0.4;
const LANCE_BURST_CORE = 0.35;
/** How much the burst has shrunk by the end of the frames after the release. */
const LANCE_BURST_SHRINK = 0.4;

const FIREBALL_MIN_RADIUS = 0.16 * HEAD;
const FIREBALL_MAX_RADIUS = 0.42 * HEAD;
const FIREBALL_GLOW_SCALE = 3;
/**
 * How far from the hand the ball has flown by the last frame of the row. It
 * has to leave the fairy's outline entirely: a ball that stays within reach
 * of the body reads as one it is juggling, never as one it threw.
 */
const FIREBALL_RELEASE_LEAD = 2.3 * HEAD;
/** Already this far out of the hand on the release frame itself, so that frame reads as let go. */
const FIREBALL_RELEASE_MIN_LEAD = 1.1 * HEAD;
/** The lob's launch direction: out past the throwing shoulder and up, from the front; forward and up, from the side. */
const LOB_FRONT_OUTWARD = 1.1;
const LOB_SIDE_FORWARD = 0.6;
/** The ball dwindles as it flies off, the last cue that it is going away. */
const FIREBALL_FLIGHT_SHRINK = 0.35;
/** Ember dots strung along the flight path behind the ball. */
const FIREBALL_TRAIL_EMBERS = 3;
const FIREBALL_TRAIL_EMBER_SHARE = 0.45;
const FIREBALL_STREAK_ALPHA = 0.8;
const FIREBALL_STREAK_WIDTH = 1.4;
const FIREBALL_OUTLINE_PX = 2;
/** The ball's white-hot spot sits up and left of centre, lit like the body; gold by halfway out, soot at the rim. */
const FIREBALL_HOT_SPOT = 0.3;
const FIREBALL_GOLD_STOP = 0.5;
const FIREBALL_CORE = '#fff6c0';

/** The lob: a fireball swells in the throwing hand, and on release is drawn just leaving it. */
function paintLobEffect(ink: Ink, right: LimbChain): void {
  const { ctx, design, pose, view } = ink;
  const { palette } = design;
  const released = pose.effectRelease > 0;
  if (!released && pose.effectAmount <= 0) return;
  const radius =
    lerp(FIREBALL_MIN_RADIUS, FIREBALL_MAX_RADIUS, pose.effectAmount) *
    (1 - pose.effectRelease * FIREBALL_FLIGHT_SHRINK);
  const leave = released
    ? lerp(FIREBALL_RELEASE_MIN_LEAD, FIREBALL_RELEASE_LEAD, pose.effectRelease)
    : 0;
  // A lob leaves rising: from the front the ball climbs past the throwing
  // shoulder, which is what tells a throw toward the camera from a ball
  // simply held out in front of the chest.
  // Read off the shoulder, not the hand: the follow-through carries the hand
  // across the body, and the ball must not change sides with it.
  const throwingSide = Math.sign(right.root.x) || 1;
  const forward =
    view === 'side'
      ? { x: LOB_SIDE_FORWARD, y: -1 }
      : { x: throwingSide * LOB_FRONT_OUTWARD, y: -1 };
  const reach = Math.hypot(forward.x, forward.y);
  const at = {
    x: right.end.x + (forward.x / reach) * leave,
    y: right.end.y + (forward.y / reach) * leave,
  };
  if (released) {
    // A streak back toward the hand is what makes the ball's frame a throw
    // rather than the ball simply appearing somewhere else.
    ctx.strokeStyle = rgba(palette.accent, FIREBALL_STREAK_ALPHA * (1 - pose.effectRelease));
    ctx.lineWidth = radius * FIREBALL_STREAK_WIDTH;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(
      lerp(right.end.x, at.x, pose.effectRelease),
      lerp(right.end.y, at.y, pose.effectRelease),
    );
    ctx.lineTo(at.x, at.y);
    ctx.stroke();
    for (let i = 1; i <= FIREBALL_TRAIL_EMBERS; i++) {
      const back = i / (FIREBALL_TRAIL_EMBERS + 1);
      dot(
        ctx,
        lerp(at.x, right.end.x, back),
        lerp(at.y, right.end.y, back),
        radius * FIREBALL_TRAIL_EMBER_SHARE * (1 - back),
        palette.accentBright,
      );
    }
  }
  radialGlow(ctx, at.x, at.y, radius * FIREBALL_GLOW_SCALE, palette.glow, pose.effectAmount);
  const g = ctx.createRadialGradient(
    at.x - radius * FIREBALL_HOT_SPOT,
    at.y - radius * FIREBALL_HOT_SPOT,
    0,
    at.x,
    at.y,
    radius,
  );
  g.addColorStop(0, FIREBALL_CORE);
  g.addColorStop(FIREBALL_GOLD_STOP, palette.accent);
  g.addColorStop(1, palette.hairShade);
  ctx.fillStyle = g;
  ctx.strokeStyle = palette.outline;
  // Two pixels of soot: the ball crosses the fairy's own orange wings, and a
  // one-pixel line lets it melt into them at 32 px.
  ctx.lineWidth = ink.px * FIREBALL_OUTLINE_PX;
  ctx.beginPath();
  ctx.arc(at.x, at.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fill();
}

const WISPS = 6;
const WISP_SALT = 43;
const WISP_RISE = 1.3 * HEAD;
const WISP_SWAY = 0.12 * HEAD;
const WISP_GLOW = 0.22 * HEAD;
const WISP_CORE = 0.12 * HEAD;
const RAISE_COLUMN_HEIGHT = 2.2 * HEAD;
const RAISE_COLUMN_HALF = 0.2 * HEAD;
const RAISE_COLUMN_ALPHA = 0.85;
/** How much of its strength a column has lost by the end of the row. */
const RAISE_COLUMN_FADE = 0.5;
/** A wisp weaves through this many half-turns as it climbs. */
const WISP_SWAY_HALF_TURNS = 3;
const RAISE_HAND_GLOW_SCALE = 1.2;
const RAISE_HAND_GLOW_ALPHA = 0.75;

/**
 * The raised dead, as the one unmistakable sign of what this spell does: a
 * skull either side of the fairy, rising out of the floor. Wisps and glows
 * alone read as a curse or a hex; a skull coming up out of the ground reads
 * as necromancy at any size.
 */
const RAISED_SKULL_RADIUS = 0.56 * HEAD;
/**
 * Share of the row by which a skull has clawed fully out of the floor. The
 * climb runs on the row's clock rather than the arms' eased lift, which
 * crawls through its first frames: a skull that spends three frames as a
 * sliver of dome is a pebble, not the dead coming up.
 */
const RAISED_SKULL_EMERGE_SHARE = 0.35;
/** How far either side of the fairy the skulls come up. */
const RAISED_SKULL_SPREAD = 1.15 * HEAD;
/** How high the cranium's centre has climbed above the floor once fully risen. */
const RAISED_SKULL_RISE = 0.75 * HEAD;
/** The jaw under the cranium, as shares of the cranium's radius. */
const RAISED_SKULL_JAW_WIDTH = 1.1;
const RAISED_SKULL_JAW_HEIGHT = 0.6;
const RAISED_SKULL_JAW_DROP = 0.55;
const RAISED_SKULL_EYE = 0.32;
const RAISED_SKULL_EYE_SPACING = 0.4;
const RAISED_SKULL_EYE_DROP = 0.1;
const RAISED_SKULL_INK_PX = 1.5;
/** The pool of grave-light each skull climbs out of, lying flat on the floor. */
const GRAVE_LIGHT_RADIUS = 0.75 * HEAD;
const GRAVE_LIGHT_FLATTEN = 0.4;
const GRAVE_LIGHT_ALPHA = 0.8;
/** How far past the floor the clip reaches downward, so the jaw is hidden until it clears the ground. */
const GRAVE_CLIP_REACH = 4 * HEAD;

function paintRisingSkulls(ink: Ink): void {
  const { ctx, design, pose, view } = ink;
  const { palette } = design;
  const amount = pose.effectAmount;
  if (amount <= 0) return;
  ctx.save();
  try {
    // Into a frame that keeps the body's position but not its lean, so the
    // floor the skulls rise from stays level.
    ctx.rotate(-(pose.tilt + viewSpec(view).flightLean));
    const floorY = GROUND_Y - pelvisY(pose);
    const emerged = easeOut(clamp01(pose.effectProgress / RAISED_SKULL_EMERGE_SHARE));
    const risen = floorY - lerp(-RAISED_SKULL_RADIUS, RAISED_SKULL_RISE, emerged);
    for (const side of [-1, 1]) {
      const x = side * RAISED_SKULL_SPREAD;
      ctx.save();
      ctx.translate(x, floorY);
      ctx.scale(1, GRAVE_LIGHT_FLATTEN);
      radialGlow(ctx, 0, 0, GRAVE_LIGHT_RADIUS, palette.eye, amount * GRAVE_LIGHT_ALPHA);
      ctx.restore();
      withClip(
        ctx,
        () => {
          ctx.beginPath();
          ctx.rect(
            x - GRAVE_CLIP_REACH,
            floorY - GRAVE_CLIP_REACH,
            GRAVE_CLIP_REACH * 2,
            GRAVE_CLIP_REACH,
          );
        },
        () => paintSkull(ink, x, risen),
      );
    }
  } finally {
    ctx.restore();
  }
}

function paintSkull(ink: Ink, x: number, y: number): void {
  const { ctx, design, pose } = ink;
  const { palette } = design;
  const r = RAISED_SKULL_RADIUS;
  const jawHalf = (r * RAISED_SKULL_JAW_WIDTH) / 2;
  const jawTop = y + r * RAISED_SKULL_JAW_DROP;
  const trace = (): void => {
    ctx.moveTo(x + r, y);
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.rect(x - jawHalf, jawTop, jawHalf * 2, r * RAISED_SKULL_JAW_HEIGHT);
  };
  const inked = { ...ink, px: ink.px * RAISED_SKULL_INK_PX };
  for (const pass of ['outline', 'fill'] as const) {
    blob(inked, pass, trace, palette.accent, palette.skinShade);
  }
  const eyeY = y + r * RAISED_SKULL_EYE_DROP;
  for (const side of [-1, 1]) {
    const eyeX = x + side * r * RAISED_SKULL_EYE_SPACING;
    dot(ctx, eyeX, eyeY, r * RAISED_SKULL_EYE, palette.skinShade);
    if (pose.effectRelease > 0) dot(ctx, eyeX, eyeY, ink.px, palette.eye);
  }
}

/**
 * The raise: violet and green wisps climb off upturned palms while skulls
 * claw up out of pools of grave-light on the ground either side, and on
 * release a column of wisps goes up from each hand.
 */
function paintRaiseEffect(ink: Ink, right: LimbChain, left: LimbChain): void {
  const { ctx, design, pose } = ink;
  const { palette } = design;
  const amount = pose.effectAmount;
  paintRisingSkulls(ink);
  for (const chain of [right, left]) {
    radialGlow(
      ctx,
      chain.end.x,
      chain.end.y,
      HAND_GLOW_RADIUS * RAISE_HAND_GLOW_SCALE,
      palette.eye,
      amount * RAISE_HAND_GLOW_ALPHA,
    );
  }
  for (let i = 0; i < WISPS; i++) {
    const rise = (pose.effectProgress + hash01(i, WISP_SALT)) % 1;
    const chain = i % 2 === 0 ? right : left;
    const x = chain.end.x + Math.sin(rise * Math.PI * WISP_SWAY_HALF_TURNS + i) * WISP_SWAY;
    const y = chain.end.y - rise * WISP_RISE;
    const alpha = Math.sin(rise * Math.PI) * amount;
    const color = i % 2 === 0 ? palette.eye : palette.glow;
    radialGlow(ctx, x, y, WISP_GLOW, color, alpha);
    dot(ctx, x, y, WISP_CORE, rgba(color, alpha));
  }
  if (pose.effectRelease <= 0) return;
  for (const chain of [right, left]) {
    const base = chain.end;
    const top = base.y - RAISE_COLUMN_HEIGHT * pose.effectRelease;
    const g = ctx.createLinearGradient(0, base.y, 0, top);
    g.addColorStop(
      0,
      rgba(palette.eye, RAISE_COLUMN_ALPHA * (1 - pose.effectRelease * RAISE_COLUMN_FADE)),
    );
    g.addColorStop(1, rgba(palette.glow, 0));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.moveTo(base.x - RAISE_COLUMN_HALF, base.y);
    ctx.quadraticCurveTo(base.x, top, base.x + RAISE_COLUMN_HALF, base.y);
    ctx.closePath();
    ctx.fill();
  }
}

/** The shockwave's radius on the thrust frame and at the end of the row. */
const PUSH_BURST_START = 1.9 * HEAD;
const PUSH_BURST_WIDEST = 3.4 * HEAD;
const PUSH_BURST_FADE = 0.5;
/** Seen side-on the ring is foreshortened toward its edge. */
const PUSH_SIDE_SQUASH = 0.55;
/** The ring stands in the plane of the thrust, only a little flattened: a flat ring at the waist reads as a hoop. */
const PUSH_RING_FLATTEN = 0.6;
/**
 * A second ring follows the first out, this share of its size: two rings
 * racing outward are a wave, where one ring on its own reads as a halo.
 */
const PUSH_ECHO_SHARE = 0.78;
/** The rings are stroked bolder than a halo: a thick violet band under a white core. */
const PUSH_RING_PX = 4;
const PUSH_RING_CORE_PX = 2;
/** The force gathering between the drawn-back palms, as a share of a held orb. */
const PUSH_ORB_SHARE = 1.1;

/**
 * The push: force gathers into a ball between the palms as they draw back,
 * and on the thrust it bursts outward as a pair of rings racing away, painted
 * by {@link paintPushRings} behind the body.
 */
function paintPushEffect(ink: Ink, right: LimbChain, left: LimbChain): void {
  const { ctx, design, pose } = ink;
  const { palette } = design;
  for (const chain of [right, left]) {
    radialGlow(ctx, chain.end.x, chain.end.y, HAND_GLOW_RADIUS, palette.glow, pose.effectAmount);
  }
  if (pose.effectRelease > 0) return;
  heldOrb(
    ink,
    handsMidpoint(right, left),
    HELD_ORB_RADIUS * PUSH_ORB_SHARE * pose.effectAmount,
    palette.glow,
    palette.skinShade,
  );
}

/**
 * The push's shockwave, laid behind the whole figure: at its peak the rings
 * are as big as the fairy, and drawn over it they turn the caster into a
 * target painted on its own chest.
 */
function paintPushRings(ink: Ink, right: LimbChain, left: LimbChain): void {
  const { ctx, design, pose, view } = ink;
  const { palette } = design;
  const burst = pose.effectRelease;
  if (pose.effect !== 'push' || burst <= 0) return;
  const mid = handsMidpoint(right, left);
  const alpha = 1 - burst * PUSH_BURST_FADE;
  const squash = view === 'side' ? PUSH_SIDE_SQUASH : 1;
  for (const share of [1, PUSH_ECHO_SHARE]) {
    const radius = lerp(PUSH_BURST_START, PUSH_BURST_WIDEST, easeOut(burst)) * share;
    const trace = (): void => {
      ctx.beginPath();
      ctx.ellipse(mid.x, mid.y, radius * squash, radius * PUSH_RING_FLATTEN, 0, 0, Math.PI * 2);
    };
    trace();
    ctx.strokeStyle = rgba(palette.glow, alpha);
    ctx.lineWidth = ink.px * PUSH_RING_PX;
    ctx.stroke();
    trace();
    ctx.strokeStyle = rgba('#ffffff', alpha);
    ctx.lineWidth = ink.px * PUSH_RING_CORE_PX;
    ctx.stroke();
  }
}

function paintEffect(ink: Ink, right: LimbChain, left: LimbChain): void {
  const { effect } = ink.pose;
  if (effect === 'none') return;
  if (effect === 'ward') paintWardEffect(ink, right, left);
  else if (effect === 'heal') paintHealEffect(ink, right, left);
  else if (effect === 'beam') paintBeamEffect(ink, right);
  else if (effect === 'lob') paintLobEffect(ink, right);
  else if (effect === 'raise') paintRaiseEffect(ink, right, left);
  else paintPushEffect(ink, right, left);
}

// ── Dissolve ─────────────────────────────────────────────────────────────────

const MOTES = 12;
const MOTE_START_SALT = 47;
const MOTE_SPREAD_SALT = 53;
const MOTE_HEIGHT_SALT = 59;
const MOTE_SIZE_SALT = 61;
/** Share of the fizzle before the last mote sets off, so they leave in a trickle. */
const MOTE_STAGGER = 0.4;
const MOTE_SPREAD = 1.8 * HEAD;
const MOTE_SIZE = 0.32 * HEAD;
const MOTE_RISE = 2.4 * HEAD;
const MOTE_FALL = 0.9 * HEAD;
const MOTE_SCATTER = 1.4 * HEAD;
const SMOKE_GROWTH = 0.8;
/** Each mote's size varies within this share of `MOTE_SIZE`, plus this much more at random. */
const MOTE_SIZE_MIN_SHARE = 0.7;
const MOTE_SIZE_VARIANCE = 0.6;
/** A mote starts already this far out from the body, as a share of its full scatter spread. */
const MOTE_START_SPREAD_SHARE = 0.4;
/** How much a crystal or ice shard's scatter outruns its start spread once fully thrown. */
const CRYSTAL_MOTE_SCATTER_RATE = 2;
/** Share of a shard's fall spent rising on its own arc before gravity takes it down. */
const SHARD_ARC_SHARE = 0.6;
const LEAF_MOTE_SWAY_FREQUENCY = 3;
const LEAF_MOTE_SQUASH = 0.5;
/** Share of the mote fall a loosed leaf first rises before it drifts down. */
const LEAF_MOTE_LIFT = 0.5;
/** Shards are drawn larger than other debris: a crystal break has to read as pieces, not dust. */
const SHARD_MOTE_SCALE = 1.35;
/**
 * The guardian breaks into only every other shard: beside the shield planted
 * next to it, a full spray of gold is more pieces than a 32 px cell can hold
 * apart, and reads as noise.
 */
const CRYSTAL_SHARD_EVERY = 2;
const SMOKE_LIGHTEN = 0.45;
/** The white flash of a crystal or ice body breaking, over the first share of its dissolve. */
const BREAK_FLASH_SPAN = 0.3;
const BREAK_FLASH_RADIUS = 1.1 * HEAD;
const FLAME_MOTE_SPREAD_SHARE = 0.6;
const FLAME_MOTE_SWAY_FREQUENCY = 4;
const FLAME_MOTE_SWAY_REACH_SHARE = 0.5;
const FLAME_MOTE_GLOW_SCALE = 2;
const FLAME_MOTE_GLOW_ALPHA_SHARE = 0.7;
const FLAME_MOTE_CORE_SHARE = 0.6;
const SMOKE_MOTE_RISE_SHARE = 0.8;
/** Every fourth puff is a wisp that climbs; the rest sink and pool on the floor. */
const SMOKE_WISP_EVERY = 4;
const SMOKE_WISP_SPREAD = 0.4;
const SMOKE_WISP_SIZE = 0.8;
/** The pool spreads this far past a mote's own spread, and lies this flat once settled. */
const SMOKE_POOL_SPREAD = 1.6;
const SMOKE_POOL_FLATTEN = 0.45;
const SMOKE_MOTE_GLOW_SCALE = 1.4;
const SMOKE_MOTE_ALPHA_SHARE = 0.9;
const SMOKE_SPARK_CORE_SHARE = 0.4;

/**
 * What a dying fairy comes apart into, each kind its own: crystal shards and
 * ice splinters that burst and drop, petals that drift down, embers that rise,
 * and smoke that climbs and spreads. The fall is shared; the fizzle is what
 * says which fairy it was.
 */
function paintMotes(ink: Ink): void {
  const { ctx, design, pose } = ink;
  if (pose.dissolve <= 0) return;
  const { palette } = design;
  // The debris leaves the chest wherever the fallen body has put it, not
  // where the chest would be if the body were still upright.
  const roll = pose.tilt + viewSpec(ink.view).flightLean;
  const chest = { x: -Math.sin(roll) * CHEST_Y, y: Math.cos(roll) * CHEST_Y };
  const floorY = GROUND_Y - pelvisY(pose);
  if (design.wing === 'crystal' || design.wing === 'snowflake') {
    paintBreakFlash(ctx, chest, pose.dissolve);
  }
  for (let i = 0; i < MOTES; i++) {
    if (design.wing === 'crystal' && i % CRYSTAL_SHARD_EVERY !== 0) continue;
    const start = hash01(i, MOTE_START_SALT) * MOTE_STAGGER;
    const t = clamp01((pose.dissolve - start) / (1 - start));
    if (t <= 0) continue;
    const spreadX = (hash01(i, MOTE_SPREAD_SALT) - 0.5) * MOTE_SPREAD;
    const alpha = Math.sin(t * Math.PI);
    const size = MOTE_SIZE * (MOTE_SIZE_MIN_SHARE + MOTE_SIZE_VARIANCE * hash01(i, MOTE_SIZE_SALT));
    const x0 = chest.x + spreadX * MOTE_START_SPREAD_SHARE;
    const y0 = chest.y + (hash01(i, MOTE_HEIGHT_SALT) - 0.5) * HEAD;
    const color = i % 2 === 0 ? palette.accentBright : palette.wingTip;
    if (design.wing === 'crystal' || design.wing === 'snowflake') {
      const x = x0 + spreadX * t * (MOTE_SCATTER / MOTE_SPREAD) * CRYSTAL_MOTE_SCATTER_RATE;
      const y = y0 - MOTE_FALL * Math.sin(t * Math.PI) * SHARD_ARC_SHARE + MOTE_FALL * t * t;
      shard(
        ctx,
        x,
        y,
        size * SHARD_MOTE_SCALE,
        t * Math.PI * 2 + i,
        // The guardian breaks into gold, the frost fairy into blue ice: one
        // shape language, told apart by the material. White ice is lost on snow.
        design.wing === 'crystal'
          ? palette.accent
          : i % 2 === 0
            ? palette.accent
            : palette.accentShade,
        palette.outline,
        alpha,
      );
    } else if (design.wing === 'leaf') {
      const x = x0 + spreadX * t + Math.sin(t * Math.PI * LEAF_MOTE_SWAY_FREQUENCY + i) * MOTE_SIZE;
      // Loose leaves, lifted a little by the puff and then drifting down: pink
      // petals scattered on the floor read as a splash of gore at 32 px.
      const y = y0 - MOTE_FALL * Math.sin(t * Math.PI) * LEAF_MOTE_LIFT + MOTE_FALL * t;
      ctx.beginPath();
      ctx.ellipse(x, y, size, size * LEAF_MOTE_SQUASH, t * Math.PI + i, 0, Math.PI * 2);
      ctx.strokeStyle = rgba(palette.outline, alpha);
      ctx.lineWidth = ink.px;
      ctx.stroke();
      ctx.fillStyle = rgba(i % 2 === 0 ? palette.wingRoot : palette.accent, alpha);
      ctx.fill();
    } else if (design.wing === 'flame') {
      const x =
        x0 +
        spreadX * t * FLAME_MOTE_SPREAD_SHARE +
        Math.sin(t * Math.PI * FLAME_MOTE_SWAY_FREQUENCY + i) *
          MOTE_SIZE *
          FLAME_MOTE_SWAY_REACH_SHARE;
      const y = y0 - MOTE_RISE * t;
      radialGlow(
        ctx,
        x,
        y,
        size * FLAME_MOTE_GLOW_SCALE,
        palette.glow,
        alpha * FLAME_MOTE_GLOW_ALPHA_SHARE,
      );
      dot(ctx, x, y, size * FLAME_MOTE_CORE_SHARE, rgba(color, alpha));
    } else {
      // The shade seeps down into the floor and spreads there as a flat pool,
      // with only a few thin wisps climbing out of it. Smoke that climbs and
      // swells stacks a round cap on the fallen body, which reads as a mushroom.
      const wisp = i % SMOKE_WISP_EVERY === 0;
      const settled = easeOut(t);
      const x = wisp
        ? x0 + spreadX * t * SMOKE_WISP_SPREAD
        : x0 + spreadX * settled * SMOKE_POOL_SPREAD;
      const y = wisp ? y0 - MOTE_RISE * t * SMOKE_MOTE_RISE_SHARE : lerp(y0, floorY, settled);
      const radius = wisp
        ? size * SMOKE_WISP_SIZE
        : size * (1 + t * SMOKE_GROWTH) * SMOKE_MOTE_GLOW_SCALE;
      ctx.save();
      try {
        ctx.translate(x, y);
        ctx.scale(1, wisp ? 1 : lerp(1, SMOKE_POOL_FLATTEN, settled));
        paintSmokePuff(ctx, 0, 0, radius, palette, alpha * SMOKE_MOTE_ALPHA_SHARE);
      } finally {
        ctx.restore();
      }
      if (wisp) {
        dot(ctx, x, y, size * SMOKE_SPARK_CORE_SHARE, rgba(palette.eye, alpha));
      }
    }
  }
}

/** Where the smoke's lit violet band sits between its dark core and its fading edge. */
const SMOKE_LIT_STOP = 0.55;
/** How much of the puff's opacity its dark core keeps. */
const SMOKE_CORE_ALPHA_SHARE = 0.75;

/**
 * A puff of shade-smoke: a dark core inside a band lit violet from within.
 * Each half carries it on the floor the other would vanish into — the lit band
 * on a black dungeon floor, the dark core on snow or sand, where a pale
 * violet haze is the floor's own value.
 */
function paintSmokePuff(
  ctx: Ctx,
  x: number,
  y: number,
  radius: number,
  palette: FairyPalette,
  alpha: number,
): void {
  const safe = clampAlpha(Math.min(1, alpha));
  if (safe === 0) return;
  const g = ctx.createRadialGradient(x, y, 0, x, y, radius);
  g.addColorStop(0, rgba(palette.skinShade, clampAlpha(safe * SMOKE_CORE_ALPHA_SHARE)));
  g.addColorStop(SMOKE_LIT_STOP, rgba(mix(palette.wingRoot, palette.outline, SMOKE_LIGHTEN), safe));
  g.addColorStop(1, rgba(palette.wingRoot, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/** The flash as a crystal or ice body breaks: bright at the first frame of the break, gone soon after. */
function paintBreakFlash(ctx: Ctx, at: Pt, dissolve: number): void {
  const flash = 1 - clamp01(dissolve / BREAK_FLASH_SPAN);
  if (flash <= 0) return;
  radialGlow(ctx, at.x, at.y, BREAK_FLASH_RADIUS, '#ffffff', flash);
}

/** A shard's half-width and ink line, as shares of its half-length: a thin splinter, boldly outlined. */
const SHARD_WIDTH = 0.4;
const SHARD_INK = 0.25;

/** A splinter: a thin diamond, outlined, at an angle. */
function shard(
  ctx: Ctx,
  x: number,
  y: number,
  size: number,
  angle: number,
  fill: string,
  outline: string,
  alpha: number,
): void {
  const safe = clampAlpha(alpha);
  if (safe === 0) return;
  ctx.save();
  try {
    ctx.translate(x, y);
    ctx.rotate(angle);
    ctx.beginPath();
    ctx.moveTo(0, -size);
    ctx.lineTo(size * SHARD_WIDTH, 0);
    ctx.lineTo(0, size);
    ctx.lineTo(-size * SHARD_WIDTH, 0);
    ctx.closePath();
    ctx.fillStyle = rgba(fill, safe);
    ctx.strokeStyle = rgba(outline, safe);
    ctx.lineWidth = size * SHARD_INK;
    ctx.stroke();
    ctx.fill();
  } finally {
    ctx.restore();
  }
}

const IMPACT_RADIUS = 0.75 * HEAD;
/** Share of the star's radius its inner corners sit at: a sharp, spiky star. */
const IMPACT_WAIST = 0.28;
const IMPACT_OFFSET = 0.25 * HEAD;

/**
 * Each kind's hit mark: the star is the universal sign of a blow, and its
 * points, colour and what flies off it say what was struck. Glass cracks,
 * leaves are knocked loose, ice spikes, a fire spits sparks, and a shade
 * gives off a puff of its own smoke.
 */
interface ImpactStyle {
  readonly points: number;
  readonly waist: number;
  readonly fill: string;
  readonly spin: number;
  /** The star's size against the common one: small where what flies off it is the point. */
  readonly scale: number;
}

const IMPACT_STYLES: ReadonlyMap<WingKind, ImpactStyle> = new Map<WingKind, ImpactStyle>([
  // Gold, not white: a long white spike across the blue body reads as a sword being drawn.
  ['crystal', { points: 4, waist: IMPACT_WAIST, fill: '#ffe27a', spin: deg(45), scale: 0.75 }],
  ['leaf', { points: 5, waist: 0.4, fill: '#fffbe0', spin: deg(-90), scale: 0.85 }],
  ['snowflake', { points: 6, waist: 0.22, fill: '#ffffff', spin: deg(-90), scale: 0.8 }],
  ['flame', { points: 8, waist: 0.5, fill: '#ffb428', spin: deg(11), scale: 0.35 }],
  ['moth', { points: 4, waist: IMPACT_WAIST, fill: '#eadcff', spin: deg(45), scale: 1 }],
]);

/** Cracks run past the star's points: as far again, in three kinked lines. */
const CRACK_REACH = 1.5;
const CRACK_LINES = 3;
const CRACK_ANGLE_SALT = 83;
const CRACK_KINK_SALT = 89;
const CRACK_KINK = 0.3;
const CRACK_OUTLINE_PX = 3;
const CRACK_PX = 1.4;
const LEAVES_KNOCKED = 5;
const KNOCKED_LEAF_SALT = 97;
const KNOCKED_LEAF_SIZE = 0.38 * HEAD;
const KNOCKED_LEAF_REACH = 1.9;
/** The leaves fly out over every side but straight down, where the body is. */
const KNOCKED_LEAF_FAN_START = deg(-150);
const KNOCKED_LEAF_FAN = deg(300);
const SMOKE_PUFF_SCALE = 1.7;
const SMOKE_PUFF_ALPHA = 0.8;
/**
 * The sparks spit out past the body's edge, where they read against the floor:
 * rays drawn across the body only bury it, and the fire is already the colour
 * of any spark.
 */
const SPARK_RAY_START = 1.25 * HEAD;
const SPARK_RAY_LENGTH = 0.55 * HEAD;
/** How much further out the sparks have flown on the frame after the blow, as the star shrinks. */
const SPARK_RAY_TRAVEL = 1.2;
/**
 * Where the sparks fly: out to either side, a little upward, clear of the head
 * and of the ground. A full ring of them round the body reads as a sunflower.
 */
const SPARK_RAY_ANGLES = [deg(-15), deg(-50), deg(15), deg(195), deg(230), deg(165)] as const;
const SPARK_RAY_PX = 2;
const SPARK_RAY_INK_PX = 4;

function paintImpact(ink: Ink): void {
  const { ctx, pose, design } = ink;
  if (pose.impact <= 0) return;
  const style = IMPACT_STYLES.get(design.wing);
  if (style === undefined) return;
  const { palette } = design;
  const radius = IMPACT_RADIUS * pose.impact * style.scale;
  const cx = -IMPACT_OFFSET;
  const cy = CHEST_Y;
  if (design.wing === 'moth') {
    paintSmokePuff(ctx, cx, cy, radius * SMOKE_PUFF_SCALE, palette, SMOKE_PUFF_ALPHA);
  }
  ctx.beginPath();
  for (let i = 0; i < style.points * 2; i++) {
    const a = (i / (style.points * 2)) * Math.PI * 2 + Math.PI / style.points / 2 + style.spin;
    const r = i % 2 === 0 ? radius : radius * style.waist;
    const x = cx + Math.cos(a) * r;
    const y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = palette.outline;
  ctx.lineWidth = ink.px * 2;
  ctx.stroke();
  ctx.fillStyle = style.fill;
  ctx.fill();
  if (design.wing === 'crystal') paintCracks(ink, cx, cy, radius);
  else if (design.wing === 'leaf') paintKnockedLeaves(ink, cx, cy, radius);
  else if (design.wing === 'flame') paintSparkRays(ink, cx, cy);
  else if (design.wing === 'snowflake') paintSplinters(ink, cx, cy, radius);
}

const SPLINTERS = 4;
const SPLINTER_SALT = 101;
const SPLINTER_REACH = 1.7;
const SPLINTER_SIZE = 0.2 * HEAD;
/** Turns the splinters off the star's own points, so they fly between them. */
const SPLINTER_SPIN = deg(20);

/** Ice chipped off by the blow, thrown clear of the star. */
function paintSplinters(ink: Ink, cx: number, cy: number, radius: number): void {
  const { ctx, design, pose } = ink;
  for (let i = 0; i < SPLINTERS; i++) {
    const a = (i / SPLINTERS) * Math.PI * 2 + SPLINTER_SPIN + hash01(i, SPLINTER_SALT);
    shard(
      ctx,
      cx + Math.cos(a) * radius * SPLINTER_REACH,
      cy + Math.sin(a) * radius * SPLINTER_REACH,
      SPLINTER_SIZE * pose.impact,
      a + Math.PI / 2,
      '#ffffff',
      design.palette.outline,
      1,
    );
  }
}

/** Glass cracking out from the blow, past the star, across the body. */
function paintCracks(ink: Ink, cx: number, cy: number, radius: number): void {
  const { ctx, design } = ink;
  ctx.beginPath();
  for (let i = 0; i < CRACK_LINES; i++) {
    const a = (i / CRACK_LINES) * Math.PI * 2 + hash01(i, CRACK_ANGLE_SALT) * CRACK_KINK;
    const kink = a + (hash01(i, CRACK_KINK_SALT) - 0.5) * CRACK_KINK * 2;
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius);
    ctx.lineTo(
      cx + Math.cos(kink) * radius * CRACK_REACH,
      cy + Math.sin(kink) * radius * CRACK_REACH,
    );
  }
  ctx.lineCap = 'round';
  ctx.lineJoin = 'miter';
  ctx.strokeStyle = design.palette.outline;
  ctx.lineWidth = ink.px * CRACK_OUTLINE_PX;
  ctx.stroke();
  ctx.strokeStyle = IMPACT_STYLES.get('crystal')?.fill ?? design.palette.accent;
  ctx.lineWidth = ink.px * CRACK_PX;
  ctx.stroke();
}

/** Leaves knocked loose, flung off the star's points. */
function paintKnockedLeaves(ink: Ink, cx: number, cy: number, radius: number): void {
  const { ctx, design } = ink;
  for (let i = 0; i < LEAVES_KNOCKED; i++) {
    const a =
      KNOCKED_LEAF_FAN_START +
      (i / LEAVES_KNOCKED) * KNOCKED_LEAF_FAN +
      hash01(i, KNOCKED_LEAF_SALT);
    const x = cx + Math.cos(a) * radius * KNOCKED_LEAF_REACH;
    const y = cy + Math.sin(a) * radius * KNOCKED_LEAF_REACH;
    const size = KNOCKED_LEAF_SIZE * ink.pose.impact;
    ctx.beginPath();
    ctx.ellipse(x, y, size, size * LEAF_MOTE_SQUASH, a, 0, Math.PI * 2);
    ctx.strokeStyle = design.palette.outline;
    ctx.lineWidth = ink.px * 2;
    ctx.stroke();
    // Crown petals among the leaves: green knocked off a green body is lost,
    // and the pink is the one colour on the healer that is not green.
    ctx.fillStyle = i % 2 === 0 ? design.palette.accentBright : design.palette.wingTip;
    ctx.fill();
  }
}

/** Sparks spat out either side of the struck body, flying further as the star fades. */
function paintSparkRays(ink: Ink, cx: number, cy: number): void {
  const { ctx, design, pose } = ink;
  const flown = 1 + (1 - pose.impact) * SPARK_RAY_TRAVEL;
  const start = SPARK_RAY_START * flown;
  const reach = start + SPARK_RAY_LENGTH * pose.impact;
  ctx.beginPath();
  for (const a of SPARK_RAY_ANGLES) {
    ctx.moveTo(cx + Math.cos(a) * start, cy + Math.sin(a) * start);
    ctx.lineTo(cx + Math.cos(a) * reach, cy + Math.sin(a) * reach);
  }
  ctx.lineCap = 'round';
  ctx.strokeStyle = design.palette.outline;
  ctx.lineWidth = ink.px * SPARK_RAY_INK_PX;
  ctx.stroke();
  ctx.strokeStyle = design.palette.accent;
  ctx.lineWidth = ink.px * SPARK_RAY_PX;
  ctx.stroke();
}

const DUST_PUFFS = 3;
const DUST_COLOR = '#b8ac98';
/** Translucent: a puff, not a body. The death gate reads solid ink as the body. */
const DUST_ALPHA = 0.55;
const DUST_REACH = 0.26;
const DUST_RADIUS = 0.06;
const DUST_RISE = 0.05;

/** Puffs thrown out either side where a falling body hits the ground. */
function paintDust(ctx: Ctx, pose: FairyPose): void {
  if (pose.dust <= 0) return;
  const alpha = clampAlpha(Math.sin(pose.dust * Math.PI) * DUST_ALPHA * pose.fade);
  if (alpha === 0) return;
  for (const side of [-1, 1]) {
    for (let i = 0; i < DUST_PUFFS; i++) {
      const reach = pose.dust * DUST_REACH * ((i + 1) / DUST_PUFFS);
      const x = pose.drift + side * reach;
      const y = GROUND_Y - pose.dust * DUST_RISE * (1 - i / DUST_PUFFS);
      const radius = DUST_RADIUS * (1 + pose.dust) * (1 - i / (DUST_PUFFS * 2));
      ctx.fillStyle = rgba(DUST_COLOR, alpha);
      ctx.beginPath();
      ctx.ellipse(x, y, radius, radius * RING_TILT, 0, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

// ── The figure ───────────────────────────────────────────────────────────────

function pixelsPerTile(ctx: Ctx): number {
  const m = ctx.getTransform();
  return Math.max(Math.hypot(m.a, m.b), DEGENERATE_DENSITY);
}

/** Hip height above the tile centre for a pose, before its tilt. */
function pelvisY(pose: FairyPose): number {
  return GROUND_Y - pose.lift - HIP_TO_TOE_TILES + pose.bob;
}

/**
 * Where a fairy's chest hangs for a pose, relative to the tile centre, in
 * tiles. Anything that leaves the fairy's hands — a tether, a thrown
 * fireball — should start here rather than at the ground point.
 */
export function fairyChestOffset(pose: FairyPose): Pt {
  return { x: pose.drift, y: pelvisY(pose) + CHEST_Y };
}

/**
 * The highest point a pose paints, in tiles about the tile centre (+Y down):
 * the top of the tallest of the kind's headwear and its four wings, before
 * any outline. Measured from the painter's own geometry — the headwear's
 * constants and the wings' own traces through their own frames — so a taller
 * crest or a steeper wing moves it with the art. Anything that must sit clear
 * above the figure, such as a health bar, hangs off this rather than off the
 * body's height, which the crest, hood and wings all reach past.
 */
export function fairyPaintedTopY(kind: FairyKind, view: FairyView, pose: FairyPose): number {
  const design = designOf(kind);
  const lean = pose.tilt + viewSpec(view).flightLean;
  const cos = Math.cos(lean);
  const sin = Math.sin(lean);
  let topY = Infinity;
  const reach = (x: number, y: number): void => {
    topY = Math.min(topY, x * sin + y * cos);
  };
  for (const point of headwearTops(design, view, pose)) reach(point.x, point.y);
  for (const { frame, pair } of wingFrames(design, pose, view)) {
    const inFrame = (u: number, v: number): void =>
      reach(
        frame.root.x + frame.span.x * u + frame.chord.x * v,
        frame.root.y + frame.span.y * u + frame.chord.y * v,
      );
    traceWing(pathBoundsSink(inFrame), design.wing, pair, pose.flicker, pose.glow);
  }
  return pelvisY(pose) + topY;
}

/**
 * A path sink that reports every point a trace names — ends and control
 * points alike, and an arc's whole bounding box. A curve never leaves the hull
 * of its control points, so the highest point reported is at or above the
 * highest point painted.
 */
function pathBoundsSink(report: (x: number, y: number) => void): PathSink {
  return {
    moveTo: report,
    lineTo: report,
    quadraticCurveTo: (cpx, cpy, x, y) => {
      report(cpx, cpy);
      report(x, y);
    },
    bezierCurveTo: (cp1x, cp1y, cp2x, cp2y, x, y) => {
      report(cp1x, cp1y);
      report(cp2x, cp2y);
      report(x, y);
    },
    arc: (x, y, radius) => {
      report(x - radius, y - radius);
      report(x + radius, y + radius);
    },
    // Closing returns to the subpath's start, a point already reported.
    closePath: () => undefined,
  };
}

/**
 * The top corners of the kind's headwear, in the body frame (about the pelvis,
 * before the body's lean): how far each costume rises above the head's centre,
 * read off the constants that paint it, across the skull's width so a lean
 * that raises one side is still covered. A curve's control point stands in
 * for the curve it bends, since the curve never rises past it.
 */
function headwearTops(design: FairyDesign, view: FairyView, pose: FairyPose): Pt[] {
  const head = headCentre(pose);
  const rise = headwearRise(design, view, pose);
  const peakX =
    design.wing === 'moth' && view === 'side'
      ? head.x - HEAD_RADIUS_X * HOOD_WIDTH * SIDE_HEAD_DEPTH * HOOD_SIDE_PEAK_BACK
      : head.x;
  const top = head.y - rise;
  return [
    { x: peakX, y: top },
    { x: head.x - HEAD_RADIUS_X, y: top },
    { x: head.x + HEAD_RADIUS_X, y: top },
  ];
}

/** How far above the head's centre a kind's headwear reaches, in tiles. */
function headwearRise(design: FairyDesign, view: FairyView, pose: FairyPose): number {
  const kind = design.wing;
  if (kind === 'crystal') {
    const finArch = view === 'side' ? HELM_FIN_ARCH : 0;
    return HEAD_RADIUS_Y * HELM_HEIGHT_SCALE + HELM_CREST_HEIGHT + finArch;
  }
  if (kind === 'leaf') {
    const crownFlowerTop = HEAD_RADIUS_Y * CROWN_RING_HEIGHT + FLOWER_RADIUS;
    return Math.max(HEAD_RADIUS_Y * LEAF_HAIR_HEIGHT, crownFlowerTop);
  }
  if (kind === 'snowflake') {
    return Math.max(HEAD_RADIUS_Y * ICE_HAIR_HEIGHT, ICE_HAIR_PARTING_RISE);
  }
  if (kind === 'flame') {
    const fullestLick = 1;
    const tallestTongue =
      FLAME_HAIR_HEIGHT *
      flameReach(fullestLick) *
      lerp(FLAME_HAIR_GUTTERED, 1, clamp01(pose.glow));
    return HEAD_RADIUS_Y * FLAME_HAIR_CAP_HEIGHT + tallestTongue;
  }
  return HEAD_RADIUS_Y * HOOD_HEIGHT + HOOD_PEAK;
}

function paintShadow(ctx: Ctx, pose: FairyPose): void {
  const height = Math.max(0, pose.lift);
  const scale = Math.max(SHADOW_MIN_SCALE, 1 - height * SHADOW_SHRINK_PER_TILE);
  const alpha = SHADOW_ALPHA * scale * pose.fade;
  const safe = clampAlpha(alpha);
  if (safe === 0) return;
  const g = ctx.createRadialGradient(0, 0, 0, 0, 0, 1);
  g.addColorStop(0, `rgba(0, 0, 0, ${safe})`);
  g.addColorStop(1, 'rgba(0, 0, 0, 0)');
  ctx.save();
  ctx.translate(pose.drift, GROUND_Y);
  ctx.scale(SHADOW_RADIUS_X * scale, SHADOW_RADIUS_Y * scale);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, 0, 1, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function paintGlow(ctx: Ctx, design: FairyDesign, strength: number): void {
  const safe = clampAlpha(strength * design.palette.glowAlpha);
  if (safe === 0) return;
  const radius = GLOW_RADIUS * strength;
  const g = ctx.createRadialGradient(0, CHEST_Y, 0, 0, CHEST_Y, radius);
  g.addColorStop(0, rgba(design.palette.glow, safe));
  g.addColorStop(GLOW_CORE_SHARE, rgba(design.palette.glow, safe * GLOW_CORE_ALPHA));
  g.addColorStop(1, rgba(design.palette.glow, 0));
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.arc(0, CHEST_Y, radius, 0, Math.PI * 2);
  ctx.fill();
}

/**
 * Paints one fairy, in tile units about the tile centre.
 *
 * Layer order, back to front: shadow, glow, wings (unless seen from behind),
 * back costume, far limbs, torso and legs, costume over the body, head and
 * costume on it, near arms, the floating front pieces, wings seen from behind,
 * the spell effect, and the dissolving motes.
 */
export function drawFairy(ctx: Ctx, kind: FairyKind, view: FairyView, pose: FairyPose): void {
  const pxPerTile = pixelsPerTile(ctx);
  const inkOn = (target: Ctx): Ink => ({
    ctx: target,
    design: designOf(kind),
    pose,
    view,
    px: 1 / pxPerTile,
    detailed: FAIRY_FIGURE_HEIGHT_TILES * pxPerTile >= DETAIL_MIN_FIGURE_PX,
  });
  ctx.save();
  try {
    paintShadow(ctx, pose);
    paintDust(ctx, pose);
    const fade = clamp01(pose.fade);
    ctx.save();
    if (fade >= 1) paintBody(inkOn(ctx));
    else paintFaded(ctx, pxPerTile, fade, (layer) => paintBody(inkOn(layer)));
    ctx.restore();
    // Outside the fade: the debris a fairy comes apart into is what is left
    // of it, and the star is the blow itself, not the body it lands on.
    ctx.translate(pose.drift, pelvisY(pose));
    const overlay = inkOn(ctx);
    paintMotes(overlay);
    paintImpact(overlay);
  } finally {
    ctx.restore();
  }
}

/**
 * The fading region, in tiles about the tile centre: the whole figure at any
 * pose, and nothing more, since the layer is allocated per faded cell.
 */
const FADE_LAYER_LEFT = -1;
const FADE_LAYER_TOP = -1.2;
const FADE_LAYER_WIDTH = 2;
const FADE_LAYER_HEIGHT = 1.8;

/**
 * Paints the figure on a layer of its own and lays that down once at `fade`.
 *
 * Fading every stroke instead would fade each of the figure's overlapping
 * layers — outline under fill, wing over glow, limb over torso — separately,
 * and a dozen layers at a sixth opacity stack back up to nearly solid: the
 * body would stay on screen as a dark smudge instead of fizzling out.
 */
function paintFaded(ctx: Ctx, pxPerTile: number, fade: number, paint: (layer: Ctx) => void): void {
  const width = Math.max(1, Math.ceil(FADE_LAYER_WIDTH * pxPerTile));
  const height = Math.max(1, Math.ceil(FADE_LAYER_HEIGHT * pxPerTile));
  const surface = allocCanvas(width, height);
  const layer = surfaceContext(surface);
  layer.setTransform(
    pxPerTile,
    0,
    0,
    pxPerTile,
    -FADE_LAYER_LEFT * pxPerTile,
    -FADE_LAYER_TOP * pxPerTile,
  );
  paint(layer);
  ctx.globalAlpha *= fade;
  ctx.drawImage(surface, FADE_LAYER_LEFT, FADE_LAYER_TOP, width / pxPerTile, height / pxPerTile);
}

/** Everything but the shadow, which stays on the ground while the body lifts, rolls and fades. */
function paintBody(ink: Ink): void {
  const { ctx, design, pose, view } = ink;
  const spec = viewSpec(view);
  ctx.save();
  try {
    ctx.translate(pose.drift, pelvisY(pose));
    ctx.rotate(pose.tilt + spec.flightLean);
    paintGlow(ctx, design, pose.glow);

    const armRight = armChain(pose.armRight, 1, view);
    const armLeft = armChain(pose.armLeft, -1, view);
    const legRight = legChain(pose.legRight, 1, view);
    const legLeft = legChain(pose.legLeft, -1, view);
    const head = headCentre(pose);
    const sideView = view === 'side';
    paintPushRings(ink, armRight, armLeft);
    const farArm = sideView ? armLeft : null;
    const farLeg = sideView ? legLeft : null;
    const nearArms = sideView ? [armRight] : [armRight, armLeft];
    const nearLegs = sideView ? [legRight] : [legRight, legLeft];

    if (!spec.wingsInFront) paintWings(ink, sideView ? 'far' : 'all');
    if (sideView) paintWings(ink, 'near');
    for (const pass of ['outline', 'fill'] as const) paintCostumeBack(ink, pass, head);

    if (farArm !== null && farLeg !== null) {
      for (const pass of ['outline', 'fill'] as const) {
        paintLeg(ink, pass, farLeg, FAR_SIDE_DARKEN);
        paintArm(ink, pass, farArm, FAR_SIDE_DARKEN);
      }
    }

    for (const pass of ['outline', 'fill'] as const) {
      for (const leg of nearLegs) paintLeg(ink, pass, leg, 0);
      segment(
        ink,
        pass,
        { x: 0, y: NECK_TOP_Y + NECK_ROOT_DROP },
        head,
        NECK_WIDTH,
        design.palette.skin,
      );
      blob(ink, pass, () => traceTorso(ctx, view), torsoFill(ink));
    }
    for (const leg of nearLegs) limbHighlight(ink, leg, THIGH_WIDTH);
    for (const pass of ['outline', 'fill'] as const) paintCostumeBody(ink, pass);

    for (const pass of ['outline', 'fill'] as const) paintHeadBase(ink, pass, head);
    paintEyes(ink, head);
    for (const pass of ['outline', 'fill'] as const) paintCostumeHead(ink, pass, head);

    const armsBehind = view === 'away';
    if (armsBehind) {
      for (const pass of ['outline', 'fill'] as const) {
        for (const arm of nearArms) paintArm(ink, pass, arm, 0);
      }
    }
    if (spec.wingsInFront) paintWings(ink, 'all');
    if (!armsBehind) {
      for (const arm of nearArms) {
        for (const pass of ['outline', 'fill'] as const) paintArm(ink, pass, arm, 0);
        limbHighlight(ink, arm, UPPER_ARM_WIDTH);
      }
    }
    paintCostumeFront(ink);
    paintEffect(ink, armRight, armLeft);
  } finally {
    ctx.restore();
  }
}
