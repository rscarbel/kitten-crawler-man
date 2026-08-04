/**
 * Drawing engine for the rock golem — the Sledge's kind.
 *
 * A golem only reads as *rock* when it reads as an **assembly of separate
 * stones**. Every part painted here is therefore an independently jittered
 * polygon with its own fixed seed, drawn with a hard-edged lit facet and a
 * hard-edged shadow facet, a dark seam around it, and strata scratched across
 * it. Nothing here is a smooth curve or a gradient: the moment a limb becomes a
 * tapered capsule the figure turns into a grey man in a costume, which is the
 * one failure this art has to avoid.
 *
 * Two variants share the whole rig (`regular` and `boss`); the boss is the same
 * creature with a hotter core, lichen on its weathered upper surfaces and a
 * broken stone crown, so the club's bouncers and the bounty target read as one
 * species.
 *
 * Poses are authored in **body space** — a lateral axis, a fore/aft axis and a
 * vertical axis — and each view projects them onto the screen. That is what lets
 * one "raise both fists overhead" pose read correctly head-on *and* in profile:
 * a view multiplier on a single swing angle would flatten the overhead raise to
 * nothing in the front view.
 *
 * Coordinates are tile units. The painters translate to {@link GROUND_Y} first,
 * so every shape below is authored in a **figure frame** whose origin is the
 * point between the feet with +Y pointing down the screen — heights above the
 * ground are negative, exactly as in `carlArt.ts`. The caller translates to the
 * frame origin and scales by one tile before calling a painter.
 *
 * Light comes from the upper left, matching every other prop in the repo.
 */

import type { CanvasRenderingContext2D as Ctx } from 'canvas';

// ── Maths helpers ────────────────────────────────────────────────────────────

export const TWO_PI = Math.PI * 2;

export interface Pt {
  readonly x: number;
  readonly y: number;
}

export function deg(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp01(t: number): number {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}

export function easeInOut(t: number): number {
  const x = clamp01(t);
  return x * x * (3 - 2 * x);
}

export function easeOut(t: number): number {
  const x = clamp01(t);
  return 1 - (1 - x) * (1 - x);
}

export function easeIn(t: number): number {
  const x = clamp01(t);
  return x * x;
}

/** 0 → 1 → 0 across [0,1]; the shape of a single lift. */
export function hump(t: number): number {
  return Math.sin(clamp01(t) * Math.PI);
}

/** Normalises `value` to 0..1 across the window [start, end]. */
export function ramp(value: number, start: number, end: number): number {
  if (end === start) return value >= end ? 1 : 0;
  return clamp01((value - start) / (end - start));
}

const HASH_SCALE_A = 127.1;
const HASH_SCALE_B = 311.7;
const HASH_MAGNITUDE = 43758.5453;

/**
 * Stable 0..1 noise. Every stone's silhouette is jittered by this keyed on a
 * per-part seed, and the seed must never involve the frame index: re-rolling the
 * jitter each frame makes the whole surface boil like television static.
 */
export function hash2(a: number, b: number): number {
  const s = Math.sin(a * HASH_SCALE_A + b * HASH_SCALE_B) * HASH_MAGNITUDE;
  return s - Math.floor(s);
}

/** Symmetric noise in -1..1. */
function snoise(a: number, b: number): number {
  return hash2(a, b) * 2 - 1;
}

const HEX_RADIX = 16;
const HEX_PAIR = 2;
const RGB_MAX = 255;

interface Rgb {
  readonly r: number;
  readonly g: number;
  readonly b: number;
}

function hexToRgb(hex: string): Rgb {
  const body = hex.replace('#', '');
  return {
    r: parseInt(body.slice(0, HEX_PAIR), HEX_RADIX),
    g: parseInt(body.slice(HEX_PAIR, HEX_PAIR * 2), HEX_RADIX),
    b: parseInt(body.slice(HEX_PAIR * 2, HEX_PAIR * 3), HEX_RADIX),
  };
}

function channel(value: number): string {
  const clamped = Math.max(0, Math.min(RGB_MAX, Math.round(value)));
  return clamped.toString(HEX_RADIX).padStart(HEX_PAIR, '0');
}

export function mix(a: string, b: string, t: number): string {
  const from = hexToRgb(a);
  const to = hexToRgb(b);
  return `#${channel(lerp(from.r, to.r, t))}${channel(lerp(from.g, to.g, t))}${channel(lerp(from.b, to.b, t))}`;
}

/**
 * node-canvas silently drops an entire `rgba()` string when a computed alpha
 * serialises in exponent form (`5e-17`), which bakes a solid smear where a fade
 * was meant. Fixing the decimal count makes that unrepresentable.
 */
const ALPHA_DECIMALS = 4;

export function rgba(hex: string, alpha: number): string {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${clamp01(alpha).toFixed(ALPHA_DECIMALS)})`;
}

// ── Palette ──────────────────────────────────────────────────────────────────

/**
 * The greys are lifted from `drawStoneGolem` in `src/sprites/clubNpcSprite.ts`
 * so the bounty golem and the club's bouncers read as one species.
 */
const STONE_BASE = '#6a6f78';
const STONE_LIGHT = '#868c96';
const STONE_HILITE = '#a9afb9';
const STONE_DARK = '#3f434b';
const STONE_DEEP = '#23252b';
const SEAM = '#1b1d22';
const EYE = '#ffc23a';
const EYE_GLOW = '#ffb000';

/** The dull amber a normal golem's joints leak. */
const CORE_WARM = '#c07a1e';
const CORE_WARM_HOT = '#f0b24a';
/** The boss runs hot: his seams are open lava rather than a banked ember. */
const CORE_MOLTEN = '#e8471a';
const CORE_MOLTEN_HOT = '#ffcf5a';
const MOSS = '#436b2f';
const MOSS_LIGHT = '#77a04b';

/** Direction light arrives from, in figure-frame units. */
const LIGHT: Pt = { x: -0.66, y: -0.75 };

const FACET_LIGHT_ALPHA = 0.42;
const FACET_SHADOW_ALPHA = 0.42;
const STRATA_ALPHA = 0.22;
const SEAM_ALPHA = 0.9;
const CONTACT_SHADOW_ALPHA = 0.34;

export type GolemVariant = 'regular' | 'boss';

interface VariantSpec {
  /** Colour leaking from the joint gaps and the chest core. */
  readonly core: string;
  readonly coreHot: string;
  /** How brightly the joints glow. */
  readonly seamGlow: number;
  /** Lichen on the up-facing weathered surfaces. */
  readonly lichen: boolean;
  /** The broken stone crown that marks the bounty target. */
  readonly crown: boolean;
  /** Multiplier on every lateral dimension — the boss is broader, not just taller. */
  readonly bulk: number;
  /** Extra jitter on every silhouette: the boss is the more badly weathered one. */
  readonly weathering: number;
}

const VARIANTS: Record<GolemVariant, VariantSpec> = {
  regular: {
    core: CORE_WARM,
    coreHot: CORE_WARM_HOT,
    seamGlow: 0.3,
    lichen: false,
    crown: false,
    bulk: 1,
    weathering: 1,
  },
  boss: {
    core: CORE_MOLTEN,
    coreHot: CORE_MOLTEN_HOT,
    seamGlow: 0.65,
    lichen: true,
    crown: true,
    bulk: 1.08,
    weathering: 1.25,
  },
};

// ── Proportions ──────────────────────────────────────────────────────────────

/**
 * Where the feet sit relative to the painter's origin. The origin is the centre
 * of the logical tile the sprite anchors on, so the ground line is half a tile
 * below it.
 */
export const GROUND_Y = 0.5;

/**
 * Total standing height, crown of the head-stone to the ground. A golem is not
 * a tall man — it is a *wide* one, and the silhouette that sells that at a 32 px
 * tile is a low broad trapezoid rather than a column.
 */
export const FIGURE_HEIGHT = 2.23;

const ANKLE_Y = -0.13;
const KNEE_Y = -0.43;
const HIP_Y = -0.78;
export const SHOULDER_Y = -1.5;
const HEAD_CENTRE_Y = -1.92;
const NECK_Y = -1.64;

/**
 * The bones are longer than the joint heights they connect, so a standing golem
 * already carries a deep bend in its knee — which is the stance the creature
 * wants anyway. Sizing them to the standing span instead locks the leg dead
 * straight and leaves a stride of almost nothing: at full extension every step
 * is a reach-headroom violation. The surplus below buys both the stride and the
 * squat the rock pick-up needs.
 */
const STANDING_LEG_SPAN = Math.abs(HIP_Y - ANKLE_Y);
const LEG_BEND_ALLOWANCE = 0.035;
export const THIGH_REACH = Math.abs(HIP_Y - KNEE_Y) + LEG_BEND_ALLOWANCE * 0.5;
export const SHIN_REACH =
  STANDING_LEG_SPAN + LEG_BEND_ALLOWANCE - Math.abs(HIP_Y - KNEE_Y) - LEG_BEND_ALLOWANCE * 0.5;

/**
 * Arms are long — a golem's knuckles hang near its knees. That is most of what
 * separates its idle silhouette from a person's at tile size.
 */
export const UPPER_ARM_LENGTH = 0.42;
export const FOREARM_LENGTH = 0.38;

/**
 * A golem is a *wide* thing, not a tall one. These are deliberately far past
 * human ratios: shoulders nearly two thirds of the figure's height across, hips
 * almost as broad, and no waist worth the name. Narrow any of them toward a
 * person's and the silhouette stops reading as a pile of rock at a 32 px tile.
 */
const SHOULDER_HALF = 0.56;
const LEG_ROOT_HALF = 0.2;

const THIGH_HALF_W = 0.21;
const SHIN_HALF_W = 0.19;
const FOOT_HALF_W = 0.22;
const FOOT_HEIGHT = 0.17;

const UPPER_ARM_HALF_W = 0.145;
const FOREARM_HALF_W = 0.155;
export const FIST_RADIUS = 0.19;
const SHOULDER_BOULDER_R = 0.3;
const ELBOW_BOULDER_R = 0.14;
const KNEE_BOULDER_R = 0.155;
const NECK_RX = 0.17;
const NECK_RY = 0.13;

const HEAD_RX = 0.34;
const HEAD_RY = 0.31;

/** Gap left between two adjacent stones so a seam reads as a joint, not a line. */
const JOINT_GAP = 0.035;

// ── View table ───────────────────────────────────────────────────────────────

export type GolemView = 'front' | 'side' | 'back';

interface ViewSpec {
  /**
   * Projects a body-space offset onto screen x. `lateral` is across the body
   * (the golem's own right is positive), `fore` is the direction it faces.
   */
  readonly project: (lateral: number, fore: number) => number;
  /** Multiplier on the torso's drawn width; a golem is nearly as deep as wide. */
  readonly girth: number;
  /** How far apart the two shoulder joints are drawn. */
  readonly armSpread: number;
  /**
   * Fore/aft stagger between the two shoulders. Edge-on both arms land on the
   * body's centreline and disappear into the torso; pushing the near one
   * forward and the far one back is what keeps them readable as arms.
   */
  readonly armStagger: number;
  /** The same trick at the hips, so a standing profile has two legs, not one. */
  readonly legStagger: number;
  /** How much of the IK knee offset is kept; head-on a knee barely moves sideways. */
  readonly kneeProject: number;
  /** True when the figure is seen edge-on rather than head-on. */
  readonly profile: boolean;
  /** True when the eye slots face the camera. */
  readonly showsFace: boolean;
}

/**
 * Residual lateral separation kept in profile. At zero the two legs land on
 * exactly the same screen x and the figure reads as one-legged whenever it
 * stands still.
 */
const PROFILE_LATERAL = 0.2;
const PROFILE_GIRTH = 0.95;
const PROFILE_ARM_SPREAD = 0.16;
const PROFILE_ARM_STAGGER = 0.12;
/** Fore/aft stagger between the two hips in profile, for the same reason. */
const PROFILE_LEG_STAGGER = 0.1;
const AXIAL_KNEE_PROJECT = 0.24;

const VIEWS: Record<GolemView, ViewSpec> = {
  front: {
    project: (lateral) => lateral,
    girth: 1,
    armSpread: 1,
    armStagger: 0,
    legStagger: 0,
    kneeProject: AXIAL_KNEE_PROJECT,
    profile: false,
    showsFace: true,
  },
  back: {
    // Seen from behind, the body's own right hand is on the viewer's left.
    project: (lateral) => -lateral,
    girth: 1,
    armSpread: 1,
    armStagger: 0,
    legStagger: 0,
    kneeProject: AXIAL_KNEE_PROJECT,
    profile: false,
    showsFace: false,
  },
  side: {
    project: (lateral, fore) => fore + lateral * PROFILE_LATERAL,
    girth: PROFILE_GIRTH,
    armSpread: PROFILE_ARM_SPREAD,
    armStagger: PROFILE_ARM_STAGGER,
    legStagger: PROFILE_LEG_STAGGER,
    kneeProject: 1,
    profile: true,
    showsFace: true,
  },
};

// ── Pose ─────────────────────────────────────────────────────────────────────

export interface GolemArmPose {
  /**
   * Rotation of the arm in the fore/aft plane, radians from straight down.
   * Positive drives the fist forward; past ±90° it swings overhead.
   */
  readonly swing: number;
  /** Elbow bend in radians; 0 is a straight arm, positive folds the fist inward. */
  readonly bend: number;
  /** Abduction away from the ribs in the frontal plane, radians. */
  readonly flare: number;
  /** 0 = open slab hand, 1 = clenched fist. */
  readonly clench: number;
}

export interface GolemLegPose {
  /** Fore/aft travel of the foot from its hip root, in tile units. */
  readonly fore: number;
  /** Lateral travel of the foot away from its hip root, in tile units. */
  readonly splay: number;
  /** Height of the sole above the ground, in tile units. */
  readonly lift: number;
}

export interface GolemPose {
  /** Vertical offset of the whole body; negative lifts it. */
  readonly bob: number;
  /** Lateral offset of the whole body, in body space. */
  readonly sway: number;
  /** Fore/aft lean of everything above the hips, in radians. */
  readonly lean: number;
  /** Vertical scale of the body about the ground line. */
  readonly squash: number;
  /**
   * How far the hips drop into a squat, in tile units, with the feet staying
   * planted. This is a real crouch — everything above the hips moves down and
   * the knees fold to absorb it — which is what lets the golem's fists reach the
   * ground for the rock pick-up. Squashing the whole figure instead just makes
   * a flattened golem.
   */
  readonly crouch: number;
  /** Shoulder rotation about the vertical axis, -1..1. */
  readonly twist: number;
  readonly headTurn: number;
  readonly headPitch: number;
  /** 0 = neck extended, 1 = head pulled down between the shoulders. */
  readonly headSink: number;
  readonly eyeGlow: number;
  /** Brightness of the chest core and the joint seams, 0..1. */
  readonly coreGlow: number;
  readonly armL: GolemArmPose;
  readonly armR: GolemArmPose;
  readonly legL: GolemLegPose;
  readonly legR: GolemLegPose;
  /**
   * Radius of the boulder gripped between the two fists, in tile units; 0 for
   * empty hands. Placing it on the fists rather than on a path of its own is
   * what keeps the grip correct in all three views for free.
   */
  readonly rockRadius: number;
  /** How far the figure has collapsed onto its own hips, 0..1 (the stun). */
  readonly slump: number;
  /** Impact dust at each sole, 0..1. */
  readonly dustL: number;
  readonly dustR: number;
  /** Debris ring spinning around a stunned head, 0..1. */
  readonly daze: number;
  /** Cycle phase; drives anything that must not be frame-index driven. */
  readonly time: number;
}

const REST_ARM: GolemArmPose = { swing: 0, bend: deg(14), flare: deg(10), clench: 0.7 };
const REST_LEG: GolemLegPose = { fore: 0, splay: 0, lift: 0 };

export function restPose(): GolemPose {
  return {
    bob: 0,
    sway: 0,
    lean: 0,
    squash: 1,
    crouch: 0,
    twist: 0,
    headTurn: 0,
    headPitch: 0,
    headSink: 0.35,
    eyeGlow: 1,
    coreGlow: 0.5,
    armL: REST_ARM,
    armR: REST_ARM,
    legL: REST_LEG,
    legR: REST_LEG,
    rockRadius: 0,
    slump: 0,
    dustL: 0,
    dustR: 0,
    daze: 0,
    time: 0,
  };
}

// ── Stone primitives ─────────────────────────────────────────────────────────

interface StoneShape {
  readonly seed: number;
  readonly cx: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly sides: number;
  /** Fraction of the radius each vertex may be pulled in by. */
  readonly jitter: number;
  readonly rotate: number;
  /** How many vertices are knocked in hard, as though a corner had spalled off. */
  readonly chips: number;
}

const MIN_STONE_SIDES = 5;
const CHIP_DEPTH = 0.32;

/**
 * An irregular polygon. Every stone in the figure is one of these: the jitter is
 * what stops two adjacent boulders reading as one moulded mass.
 */
function stonePolygon(shape: StoneShape): Pt[] {
  const sides = Math.max(MIN_STONE_SIDES, Math.round(shape.sides));
  const chipAt = new Set<number>();
  for (let c = 0; c < shape.chips; c++) {
    chipAt.add(Math.floor(hash2(shape.seed, 90 + c) * sides));
  }
  const pts: Pt[] = [];
  for (let i = 0; i < sides; i++) {
    const angle = (i / sides) * TWO_PI + shape.rotate;
    const radius = 1 - shape.jitter * hash2(shape.seed, i) - (chipAt.has(i) ? CHIP_DEPTH : 0);
    pts.push({
      x: shape.cx + Math.cos(angle) * shape.rx * radius,
      y: shape.cy + Math.sin(angle) * shape.ry * radius,
    });
  }
  return pts;
}

/** A four-cornered slab between two joints, jittered so it is not a rectangle. */
function slabPolygon(
  seed: number,
  from: Pt,
  to: Pt,
  halfFrom: number,
  halfTo: number,
  jitter: number,
): Pt[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const nx = -dy / length;
  const ny = dx / length;
  const lips = [
    { at: from, half: halfFrom, sign: 1 },
    { at: to, half: halfTo, sign: 1 },
    { at: to, half: halfTo, sign: -1 },
    { at: from, half: halfFrom, sign: -1 },
  ] as const;
  return lips.map((lip, index) => {
    const wobble = 1 + jitter * snoise(seed, index);
    return {
      x: lip.at.x + nx * lip.half * lip.sign * wobble,
      y: lip.at.y + ny * lip.half * lip.sign * wobble,
    };
  });
}


function traceOutline(ctx: Ctx, pts: readonly Pt[]): void {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
  ctx.closePath();
}

function centroidOf(pts: readonly Pt[]): Pt {
  let x = 0;
  let y = 0;
  for (const p of pts) {
    x += p.x;
    y += p.y;
  }
  return { x: x / pts.length, y: y / pts.length };
}

interface StonePaint {
  /** 0 = the near, fully lit stone; 1 = the far side of the body, in shadow. */
  readonly depth: number;
  /** Shifts the whole stone lighter (+) or darker (-) before shading. */
  readonly tone: number;
  readonly strata: number;
  /** Jagged fissures scratched across the stone's face. */
  readonly cracks: number;
  readonly seamWidth: number;
  /** Lichen coverage on this stone's up-facing edge, 0..1. */
  readonly lichen: number;
}

const DEFAULT_PAINT: StonePaint = {
  depth: 0,
  tone: 0,
  strata: 2,
  cracks: 2,
  seamWidth: 0.02,
  lichen: 0,
};

const DEPTH_SHADE = 0.55;
const TONE_RANGE = 0.5;

function stoneFill(paint: StonePaint): string {
  const toned =
    paint.tone >= 0
      ? mix(STONE_BASE, STONE_HILITE, paint.tone * TONE_RANGE)
      : mix(STONE_BASE, STONE_DARK, -paint.tone * TONE_RANGE);
  return mix(toned, STONE_DEEP, paint.depth * DEPTH_SHADE);
}

/**
 * Paints one stone: flat base, one hard-edged lit facet, one hard-edged shadow
 * facet, strata scratches, and a dark seam all the way round.
 *
 * The facets are polygons rather than gradients on purpose — a gradient across a
 * boulder is what makes it look inflated, and the hard facet edges are the whole
 * reason the figure still reads as chiselled rock at 32 px.
 */
function paintStone(ctx: Ctx, pts: readonly Pt[], options?: Partial<StonePaint>): void {
  const paint: StonePaint = { ...DEFAULT_PAINT, ...options };
  const base = stoneFill(paint);
  const centre = centroidOf(pts);

  traceOutline(ctx, pts);
  ctx.fillStyle = base;
  ctx.fill();

  paintFacet(ctx, pts, centre, mix(base, STONE_HILITE, 0.55), FACET_LIGHT_ALPHA, 1);
  paintFacet(ctx, pts, centre, mix(base, STONE_DEEP, 0.5), FACET_SHADOW_ALPHA, -1);

  if (paint.strata > 0) paintStrata(ctx, pts, centre, paint);
  if (paint.cracks > 0) paintCracks(ctx, pts, centre, paint);
  if (paint.lichen > 0) paintLichen(ctx, pts, centre, paint);

  ctx.strokeStyle = rgba(SEAM, SEAM_ALPHA);
  ctx.lineWidth = paint.seamWidth;
  ctx.lineJoin = 'round';
  traceOutline(ctx, pts);
  ctx.stroke();
}

/**
 * The run of edges whose outward normal faces (or opposes) the light, closed
 * back through the centroid. Two of these give the classic two-value rock read.
 */
function paintFacet(
  ctx: Ctx,
  pts: readonly Pt[],
  centre: Pt,
  color: string,
  alpha: number,
  towardLight: number,
): void {
  const faces: Pt[][] = [];
  let run: Pt[] = [];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const midX = (a.x + b.x) / 2 - centre.x;
    const midY = (a.y + b.y) / 2 - centre.y;
    if ((midX * LIGHT.x + midY * LIGHT.y) * towardLight > 0) {
      if (run.length === 0) run.push(a);
      run.push(b);
    } else {
      if (run.length > 1) faces.push(run);
      run = [];
    }
  }
  if (run.length > 1) faces.push(run);
  ctx.fillStyle = rgba(color, alpha);
  for (const face of faces) {
    ctx.beginPath();
    ctx.moveTo(centre.x, centre.y);
    for (const p of face) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.fill();
  }
}

const STRATA_TILT = 0.1;
const STRATA_MIN_WIDTH = 0.008;

/** Sedimentary banding — the cheapest cue that a shape is stone and not metal. */
function paintStrata(ctx: Ctx, pts: readonly Pt[], centre: Pt, paint: StonePaint): void {
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
  const span = maxX - minX;
  const height = maxY - minY;
  if (span <= 0 || height <= 0) return;

  ctx.save();
  traceOutline(ctx, pts);
  ctx.clip();
  ctx.strokeStyle = rgba(STONE_DEEP, STRATA_ALPHA);
  ctx.lineWidth = Math.max(height * 0.035, STRATA_MIN_WIDTH);
  const lines = Math.round(paint.strata);
  for (let i = 0; i < lines; i++) {
    const at = (i + 1) / (lines + 1);
    const y = minY + height * at + height * 0.12 * snoise(centre.x * 100 + i, centre.y * 100);
    ctx.beginPath();
    ctx.moveTo(minX - span * 0.1, y - span * STRATA_TILT * 0.5);
    ctx.lineTo(maxX + span * 0.1, y + span * STRATA_TILT * 0.5);
    ctx.stroke();
  }
  ctx.restore();
}

const CRACK_SEGMENTS = 4;
const CRACK_WANDER = 0.22;
const CRACK_ALPHA = 0.4;
const CRACK_HIGHLIGHT_ALPHA = 0.3;

/**
 * Fissures across a stone's face, each shadowed on one side by a hairline
 * highlight so it reads as a groove rather than as a drawn-on line.
 *
 * This is what breaks a big slab up. Facet shading alone leaves one enormous
 * lit triangle across the chest, which reads as flat-shaded low-poly geometry —
 * the exact "grey man in a costume" failure, only faceted.
 */
function paintCracks(ctx: Ctx, pts: readonly Pt[], centre: Pt, paint: StonePaint): void {
  const key = centre.x * 613 + centre.y * 271;
  ctx.save();
  traceOutline(ctx, pts);
  ctx.clip();
  const count = Math.round(paint.cracks);
  for (let c = 0; c < count; c++) {
    const from = pts[Math.floor(hash2(key, c * 3) * pts.length)];
    const far = pts[Math.floor(hash2(key, c * 3 + 1) * pts.length)];
    // Cracks run from an edge to somewhere inside rather than clean across:
    // a fissure that splits a boulder end to end reads as the stone being cut
    // in two, which is a seam, not weathering.
    const reach = lerp(0.35, 0.8, hash2(key, c * 3 + 2));
    const to = { x: lerp(from.x, far.x, reach), y: lerp(from.y, far.y, reach) };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    if (Math.hypot(dx, dy) < 1e-4) continue;
    const path: Pt[] = [];
    for (let i = 0; i <= CRACK_SEGMENTS; i++) {
      const t = i / CRACK_SEGMENTS;
      const wander = i === 0 || i === CRACK_SEGMENTS ? 0 : CRACK_WANDER * snoise(key + c, i);
      path.push({ x: from.x + dx * t - dy * wander, y: from.y + dy * t + dx * wander });
    }
    const width = Math.max(paint.seamWidth * 0.6, 0.006);
    ctx.lineWidth = width;
    ctx.strokeStyle = rgba(STONE_HILITE, CRACK_HIGHLIGHT_ALPHA);
    ctx.beginPath();
    ctx.moveTo(path[0].x - width, path[0].y - width);
    for (const p of path) ctx.lineTo(p.x - width, p.y - width);
    ctx.stroke();
    ctx.strokeStyle = rgba(SEAM, CRACK_ALPHA);
    ctx.beginPath();
    ctx.moveTo(path[0].x, path[0].y);
    for (const p of path) ctx.lineTo(p.x, p.y);
    ctx.stroke();
  }
  ctx.restore();
}

const LICHEN_PATCHES = 4;
const LICHEN_MIN_R = 0.018;
const LICHEN_R_RANGE = 0.026;

/** Moss only ever grows on the up-facing edge, which is what sells it as moss. */
function paintLichen(ctx: Ctx, pts: readonly Pt[], centre: Pt, paint: StonePaint): void {
  const top = pts.reduce((best, p) => (p.y < best.y ? p : best), pts[0]);
  ctx.save();
  traceOutline(ctx, pts);
  ctx.clip();
  for (let i = 0; i < LICHEN_PATCHES; i++) {
    const along = hash2(centre.x * 71 + i, centre.y * 53);
    const target = pts[Math.floor(along * pts.length)];
    const x = lerp(top.x, target.x, hash2(centre.x * 31 + i, 7) * 0.8);
    const y = lerp(top.y, Math.min(target.y, centre.y), hash2(centre.x * 17 + i, 11) * 0.6);
    const r = (LICHEN_MIN_R + LICHEN_R_RANGE * hash2(centre.x * 13 + i, 3)) * paint.lichen;
    ctx.fillStyle = rgba(i % 2 === 0 ? MOSS : MOSS_LIGHT, 0.75);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TWO_PI);
    ctx.fill();
  }
  ctx.restore();
}

const GLOW_LAYERS = 3;

/**
 * The molten light that shows through a joint gap. Drawn as a stack of shrinking
 * discs rather than a radial gradient — node-canvas gradients at tiny radii are
 * where the exponent-alpha bug bites.
 */
function paintGlow(ctx: Ctx, at: Pt, radius: number, spec: VariantSpec, intensity: number): void {
  if (intensity <= 0 || radius <= 0) return;
  for (let i = 0; i < GLOW_LAYERS; i++) {
    const t = i / (GLOW_LAYERS - 1);
    ctx.fillStyle = rgba(mix(spec.core, spec.coreHot, t), intensity * lerp(0.35, 0.95, t));
    ctx.beginPath();
    ctx.arc(at.x, at.y, radius * lerp(1, 0.35, t), 0, TWO_PI);
    ctx.fill();
  }
}

// ── Kinematics ───────────────────────────────────────────────────────────────

/**
 * Unit direction of an arm segment in body space, as (lateral, down, fore).
 * Starting from straight down, `flare` abducts it sideways and `swing` rotates
 * it through the fore/aft plane.
 */
function armDirection(swing: number, flare: number, side: number): [number, number, number] {
  return [
    Math.sin(flare) * side,
    Math.cos(flare) * Math.cos(swing),
    Math.cos(flare) * Math.sin(swing),
  ];
}

/**
 * Two-bone IK. `bendSign` picks which side the knee breaks toward; the caller
 * scales that offset by the view so a head-on knee reads as the leg narrowing
 * rather than as an angle stuck out sideways.
 */
function solveMidJoint(root: Pt, endPt: Pt, upper: number, lower: number, bendSign: number): Pt {
  const dx = endPt.x - root.x;
  const dy = endPt.y - root.y;
  const distance = Math.max(Math.hypot(dx, dy), 1e-4);
  const reach = Math.min(distance, upper + lower);
  const ux = dx / distance;
  const uy = dy / distance;
  const along = (upper * upper - lower * lower + reach * reach) / (2 * reach);
  const outward = Math.sqrt(Math.max(0, upper * upper - along * along));
  return {
    x: root.x + ux * along + uy * outward * bendSign,
    y: root.y + uy * along - ux * outward * bendSign,
  };
}

export interface ArmChain {
  readonly shoulder: Pt;
  readonly elbow: Pt;
  readonly fist: Pt;
}

function solveArm(shoulder: Pt, arm: GolemArmPose, side: number, view: ViewSpec): ArmChain {
  const [ux, uy, uz] = armDirection(arm.swing, arm.flare, side);
  const elbow = {
    x: shoulder.x + view.project(ux, uz) * UPPER_ARM_LENGTH,
    y: shoulder.y + uy * UPPER_ARM_LENGTH,
  };
  // The forearm keeps the flare of the upper arm and adds the elbow's bend to
  // its swing, so a folded arm stays in the plane the shoulder set.
  const [fx, fy, fz] = armDirection(arm.swing + arm.bend, arm.flare, side);
  const fist = {
    x: elbow.x + view.project(fx, fz) * FOREARM_LENGTH,
    y: elbow.y + fy * FOREARM_LENGTH,
  };
  return { shoulder, elbow, fist };
}

/** The solved arm, exposed so bake gates can measure grips and swing arcs. */
export function golemArmChain(
  view: GolemView,
  pose: GolemPose,
  side: number,
  variant: GolemVariant,
): ArmChain {
  const d: DrawCtx = { view: VIEWS[view], spec: VARIANTS[variant], pose };
  return solveArm(shoulderAt(d, side), side < 0 ? pose.armL : pose.armR, side, d.view);
}

/** Where the sole of a foot lands on screen, exposed for the foot-slide gate. */
export function golemFootPoint(
  view: GolemView,
  pose: GolemPose,
  side: number,
  variant: GolemVariant,
): Pt {
  const d: DrawCtx = { view: VIEWS[view], spec: VARIANTS[variant], pose };
  return ankleOf(d, side < 0 ? pose.legL : pose.legR, side);
}

/** Where a hip roots on screen, exposed for the leg-reach gate. */
export function golemHipPoint(
  view: GolemView,
  pose: GolemPose,
  side: number,
  variant: GolemVariant,
): Pt {
  return hipOf({ view: VIEWS[view], spec: VARIANTS[variant], pose }, side);
}

// ── Body parts ───────────────────────────────────────────────────────────────

interface DrawCtx {
  readonly view: ViewSpec;
  readonly spec: VariantSpec;
  readonly pose: GolemPose;
}

const ARM_SEEDS: Record<'left' | 'right', number> = { left: 11, right: 29 };
const LEG_SEEDS: Record<'left' | 'right', number> = { left: 41, right: 59 };
const TORSO_SEED = 7;
const HEAD_SEED = 211;
const SHOULDER_SEEDS: Record<'left' | 'right', number> = { left: 101, right: 103 };

function shortenToward(from: Pt, toward: Pt, amount: number): Pt {
  const dx = toward.x - from.x;
  const dy = toward.y - from.y;
  const length = Math.hypot(dx, dy) || 1;
  const t = Math.min(amount / length, 0.4);
  return { x: from.x + dx * t, y: from.y + dy * t };
}

function drawArm(
  ctx: Ctx,
  d: DrawCtx,
  arm: GolemArmPose,
  side: number,
  chain: ArmChain,
  depth: number,
): void {
  const seed = side < 0 ? ARM_SEEDS.left : ARM_SEEDS.right;
  const jitter = 0.28 * d.spec.weathering;
  const paint: Partial<StonePaint> = { depth, strata: 1 };

  paintGlow(ctx, chain.elbow, FOREARM_HALF_W * 1.1, d.spec, d.pose.coreGlow * d.spec.seamGlow);

  const upperEnd = shortenToward(chain.elbow, chain.shoulder, JOINT_GAP);
  paintStone(
    ctx,
    slabPolygon(seed, chain.shoulder, upperEnd, UPPER_ARM_HALF_W * 1.15, UPPER_ARM_HALF_W, jitter),
    { ...paint, tone: -0.15 },
  );

  const foreStart = shortenToward(chain.elbow, chain.fist, JOINT_GAP);
  paintStone(
    ctx,
    slabPolygon(seed + 1, foreStart, chain.fist, FOREARM_HALF_W, FOREARM_HALF_W * 1.1, jitter),
    { ...paint, tone: 0.05 },
  );

  // A boulder at the elbow rather than a bare hinge: the joints are where a
  // golem most obviously stops being a person and starts being a stack.
  paintStone(
    ctx,
    stonePolygon({
      seed: seed + 3,
      cx: chain.elbow.x,
      cy: chain.elbow.y,
      rx: ELBOW_BOULDER_R,
      ry: ELBOW_BOULDER_R * 0.92,
      sides: 6,
      jitter: 0.24 * d.spec.weathering,
      rotate: seed * 0.4,
      chips: 1,
    }),
    { ...paint, tone: -0.05 },
  );

  const fistRadius = FIST_RADIUS * lerp(0.86, 1.06, arm.clench);
  paintStone(
    ctx,
    stonePolygon({
      seed: seed + 2,
      cx: chain.fist.x,
      cy: chain.fist.y,
      rx: fistRadius,
      ry: fistRadius * lerp(1.1, 0.94, arm.clench),
      sides: 7,
      jitter: 0.2 * d.spec.weathering,
      rotate: seed,
      chips: 1,
    }),
    { ...paint, tone: 0.12 },
  );
}

function legRootX(d: DrawCtx, side: number): number {
  return d.view.project(LEG_ROOT_HALF * side * d.spec.bulk, side * d.view.legStagger);
}

const SLUMP_HIP_DROP = 0.45;

function hipOf(d: DrawCtx, side: number): Pt {
  return {
    x: legRootX(d, side),
    y: HIP_Y + d.pose.crouch + d.pose.slump * (ANKLE_Y - HIP_Y) * SLUMP_HIP_DROP,
  };
}

function ankleOf(d: DrawCtx, leg: GolemLegPose, side: number): Pt {
  return {
    x: legRootX(d, side) + d.view.project(leg.splay * side, leg.fore),
    y: ANKLE_Y - leg.lift,
  };
}

function drawLeg(ctx: Ctx, d: DrawCtx, leg: GolemLegPose, side: number, depth: number): void {
  const seed = side < 0 ? LEG_SEEDS.left : LEG_SEEDS.right;
  const jitter = 0.18 * d.spec.weathering;
  const hip = hipOf(d, side);
  const ankle = ankleOf(d, leg, side);
  const solved = solveMidJoint(hip, ankle, THIGH_REACH, SHIN_REACH, 1);
  const straight: Pt = { x: (hip.x + ankle.x) / 2, y: solved.y };
  const knee: Pt = {
    x: lerp(straight.x, solved.x, d.view.kneeProject),
    y: solved.y,
  };

  paintGlow(ctx, knee, SHIN_HALF_W * 0.85, d.spec, d.pose.coreGlow * d.spec.seamGlow);

  const thighEnd = shortenToward(knee, hip, JOINT_GAP);
  paintStone(ctx, slabPolygon(seed, hip, thighEnd, THIGH_HALF_W * 1.2, THIGH_HALF_W, jitter), {
    depth,
    tone: -0.1,
    strata: 1,
  });

  paintStone(
    ctx,
    stonePolygon({
      seed: seed + 3,
      cx: knee.x,
      cy: knee.y,
      rx: KNEE_BOULDER_R,
      ry: KNEE_BOULDER_R * 0.9,
      sides: 6,
      jitter: 0.22 * d.spec.weathering,
      rotate: seed * 0.6,
      chips: 1,
    }),
    { depth, tone: -0.02 },
  );

  const shinStart = shortenToward(knee, ankle, JOINT_GAP);
  paintStone(ctx, slabPolygon(seed + 1, shinStart, ankle, SHIN_HALF_W, SHIN_HALF_W * 1.05, jitter), {
    depth,
    strata: 1,
  });

  // A block of a foot, longer fore-aft in profile than it is wide across.
  const footHalfW = FOOT_HALF_W * (d.view.profile ? 1.25 : 1);
  paintStone(
    ctx,
    stonePolygon({
      seed: seed + 2,
      cx: ankle.x + (d.view.profile ? footHalfW * 0.3 : 0),
      cy: ankle.y + FOOT_HEIGHT * 0.35,
      rx: footHalfW,
      ry: FOOT_HEIGHT * 0.75,
      sides: 6,
      jitter: 0.14 * d.spec.weathering,
      rotate: seed * 0.7,
      chips: 1,
    }),
    { depth, tone: -0.25, strata: 1 },
  );
}

const TWIST_SHIFT = 0.05;

interface TorsoStone {
  readonly seed: number;
  /** Offset across the body. */
  readonly cx: number;
  /**
   * Offset along the direction the golem faces. Without this every torso stone
   * collapses onto one screen x in profile and the body becomes a thin column —
   * a golem is very nearly as deep as it is wide, and the flank boulders that
   * spread it sideways head-on are the same ones that spread it fore-and-aft
   * edge-on.
   */
  readonly fore: number;
  readonly cy: number;
  readonly rx: number;
  readonly ry: number;
  readonly sides: number;
  readonly tone: number;
  /** Up-facing stones catch the lichen; the ones tucked under do not. */
  readonly weathered: boolean;
}

/**
 * The torso is a cairn, not a trunk: half a dozen boulders of deliberately
 * unequal size piled off the centreline, each with its own seam.
 *
 * Stacking two or three symmetric slabs instead — which is what this was first —
 * reads as a segmented robot however rocky the individual outlines are. The
 * asymmetry is doing the work; do not tidy these numbers into a symmetric set.
 */
const TORSO_STONES: readonly TorsoStone[] = [
  {
    seed: 71,
    cx: -0.02,
    fore: -0.06,
    cy: -0.86,
    rx: 0.44,
    ry: 0.22,
    sides: 8,
    tone: -0.2,
    weathered: false,
  },
  {
    seed: 73,
    cx: 0.31,
    fore: 0.2,
    cy: -0.93,
    rx: 0.2,
    ry: 0.17,
    sides: 6,
    tone: -0.1,
    weathered: false,
  },
  {
    seed: 79,
    cx: 0.05,
    fore: 0.12,
    cy: -1.09,
    rx: 0.38,
    ry: 0.22,
    sides: 7,
    tone: -0.06,
    weathered: false,
  },
  {
    seed: 83,
    cx: -0.06,
    fore: 0,
    cy: -1.34,
    rx: 0.52,
    ry: 0.28,
    sides: 9,
    tone: 0.12,
    weathered: true,
  },
  {
    seed: 89,
    cx: 0.38,
    fore: 0.26,
    cy: -1.42,
    rx: 0.29,
    ry: 0.21,
    sides: 7,
    tone: 0.2,
    weathered: true,
  },
  {
    seed: 97,
    cx: -0.4,
    fore: -0.18,
    cy: -1.28,
    rx: 0.24,
    ry: 0.2,
    sides: 6,
    tone: 0.02,
    weathered: true,
  },
];

/** Which torso stone the chest vent is cut into. */
const CORE_VENT_STONE = 3;

function drawTorso(ctx: Ctx, d: DrawCtx): void {
  const girth = d.view.girth * d.spec.bulk;
  const jitter = 0.24 * d.spec.weathering;
  const twist = d.pose.twist * TWIST_SHIFT;

  TORSO_STONES.forEach((stone, index) => {
    // Stones higher up the pile carry more of the shoulder twist, which is what
    // makes the torso read as flexing rather than as one rigid block.
    const twistAt = twist * ramp(stone.cy, HIP_Y, SHOULDER_Y);
    const cx = d.view.project(stone.cx * girth + twistAt, stone.fore * girth);
    paintStone(
      ctx,
      stonePolygon({
        seed: stone.seed,
        cx,
        cy: stone.cy,
        rx: stone.rx * girth,
        ry: stone.ry,
        sides: stone.sides,
        jitter,
        rotate: stone.seed,
        chips: 2,
      }),
      {
        tone: stone.tone,
        strata: 2,
        cracks: 3,
        lichen: d.spec.lichen && stone.weathered ? 1 : 0,
      },
    );
    if (index === CORE_VENT_STONE) drawCoreVent(ctx, d, cx, stone.cy);
  });
}

const CORE_VENT_SIDES = 7;
const CORE_VENT_RX = 0.13;
const PROFILE_VENT_FORWARD = 0.3;

/** The cracked-open slot in the chest the golem's heat comes out of. */
function drawCoreVent(ctx: Ctx, d: DrawCtx, cx: number, cy: number): void {
  // Only the chest the player is looking at is cut open; a vent on the back too
  // makes the two views impossible to tell apart at tile size.
  if (!d.view.showsFace) return;
  // Edge-on the vent belongs on the leading face of the chest, not floating in
  // the middle of the body's depth.
  const at = { x: cx + (d.view.profile ? PROFILE_VENT_FORWARD : 0), y: cy };
  traceOutline(
    ctx,
    stonePolygon({
      seed: TORSO_SEED + 3,
      cx: at.x,
      cy: at.y,
      rx: CORE_VENT_RX * (d.view.profile ? 0.7 : 1),
      ry: CORE_VENT_RX * 1.2,
      sides: CORE_VENT_SIDES,
      jitter: 0.3,
      rotate: 0.6,
      chips: 2,
    }),
  );
  ctx.fillStyle = rgba(SEAM, 0.95);
  ctx.fill();
  paintGlow(ctx, at, CORE_VENT_RX * 0.9, d.spec, 0.35 + 0.55 * d.pose.coreGlow);
}

const SHOULDER_ASYMMETRY: Record<'left' | 'right', number> = { left: 1.12, right: 0.94 };
const SLUMP_SHOULDER_DROP = 0.14;

function shoulderAt(d: DrawCtx, side: number): Pt {
  const spread = SHOULDER_HALF * d.view.armSpread * d.spec.bulk;
  return {
    x: d.view.project(side * spread + d.pose.twist * TWIST_SHIFT * side, side * d.view.armStagger),
    y: SHOULDER_Y + d.pose.crouch + d.pose.slump * SLUMP_SHOULDER_DROP,
  };
}

function drawShoulderBoulder(ctx: Ctx, d: DrawCtx, at: Pt, side: number, depth: number): void {
  // Asymmetric on purpose: two matched pauldrons read as armour, one lump bigger
  // than the other reads as an accident of geology.
  const key = side < 0 ? 'left' : 'right';
  const radius = SHOULDER_BOULDER_R * d.spec.bulk * SHOULDER_ASYMMETRY[key];
  paintStone(
    ctx,
    stonePolygon({
      seed: SHOULDER_SEEDS[key],
      cx: at.x,
      cy: at.y,
      rx: radius,
      ry: radius * 0.88,
      sides: 8,
      jitter: 0.22 * d.spec.weathering,
      rotate: side,
      chips: 2,
    }),
    { depth, tone: 0.18, lichen: d.spec.lichen ? 1 : 0 },
  );
}

const HEAD_SINK_DEPTH = 0.07;
const HEAD_SLUMP_DROP = 0.1;
const EYE_HALF_SPREAD = 0.105;
const EYE_RADIUS = 0.046;
const BROW_OVERHANG = 0.062;
const PROFILE_HEAD_SETBACK = -0.07;

function headCentre(d: DrawCtx): Pt {
  return {
    x: d.view.project(d.pose.headTurn * HEAD_RX * 0.45 + d.pose.twist * TWIST_SHIFT, 0),
    y:
      HEAD_CENTRE_Y +
      d.pose.crouch +
      d.pose.headSink * HEAD_SINK_DEPTH +
      d.pose.slump * HEAD_SLUMP_DROP,
  };
}

function drawHead(ctx: Ctx, d: DrawCtx): void {
  const centre = headCentre(d);
  drawNeck(ctx, d, centre);
  const rx = HEAD_RX * (d.view.profile ? 0.86 : 1) * d.spec.bulk;
  // Edge-on the skull sits slightly back over the shoulders; centred on the
  // body's depth it hangs out in front of the chest with a hole behind it.
  const centreX = centre.x + (d.view.profile ? PROFILE_HEAD_SETBACK : 0);
  const ry = HEAD_RY * d.spec.bulk;
  const skull = stonePolygon({
    seed: HEAD_SEED,
    cx: centreX,
    cy: centre.y,
    rx,
    ry,
    sides: 7,
    jitter: 0.2 * d.spec.weathering,
    rotate: 0.4,
    chips: 1,
  });
  paintStone(ctx, skull, { tone: 0.16, lichen: d.spec.lichen ? 1 : 0 });

  // A heavy brow shelf: the overhang is what gives the eye slots their pit.
  ctx.save();
  traceOutline(ctx, skull);
  ctx.clip();
  ctx.fillStyle = rgba(STONE_DEEP, 0.55);
  ctx.fillRect(centreX - rx, centre.y - BROW_OVERHANG, rx * 2, BROW_OVERHANG * 1.6);
  ctx.restore();

  const painted = { x: centreX, y: centre.y };
  if (d.view.showsFace) drawEyes(ctx, d, painted, rx);
  if (d.spec.crown) drawBrokenCrown(ctx, d, painted, rx, ry);
}

function drawEyes(ctx: Ctx, d: DrawCtx, centre: Pt, rx: number): void {
  const eyeY = centre.y + d.pose.headPitch * HEAD_RY * 0.5;
  const glow = d.pose.eyeGlow;
  for (const side of [-1, 1]) {
    // In profile only the near eye is visible; drawing both puts one on the back
    // of the skull.
    if (d.view.profile && side < 0) continue;
    const x = d.view.profile
      ? centre.x + rx * 0.45
      : centre.x + EYE_HALF_SPREAD * d.spec.bulk * side + d.view.project(d.pose.headTurn * rx * 0.2, 0);
    ctx.fillStyle = rgba(SEAM, 0.9);
    ctx.beginPath();
    ctx.arc(x, eyeY, EYE_RADIUS * 1.7, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = rgba(EYE_GLOW, 0.5 * glow);
    ctx.beginPath();
    ctx.arc(x, eyeY, EYE_RADIUS * 1.5, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = rgba(EYE, glow);
    ctx.beginPath();
    ctx.arc(x, eyeY, EYE_RADIUS, 0, TWO_PI);
    ctx.fill();
  }
}

/**
 * A short thick pillar of stone under the head. Without it the head-boulder
 * floats above the shoulders with a hole where a neck should be — the single
 * loudest defect in the first bake of this figure.
 */
function drawNeck(ctx: Ctx, d: DrawCtx, head: Pt): void {
  const y = NECK_Y + d.pose.crouch + d.pose.slump * HEAD_SLUMP_DROP * 0.6;
  paintGlow(ctx, { x: head.x, y }, NECK_RX * 0.8, d.spec, d.pose.coreGlow * d.spec.seamGlow);
  paintStone(
    ctx,
    stonePolygon({
      seed: HEAD_SEED + 11,
      cx: lerp(head.x, 0, 0.4),
      cy: y,
      rx: NECK_RX * d.spec.bulk,
      ry: NECK_RY * d.spec.bulk,
      sides: 6,
      jitter: 0.2 * d.spec.weathering,
      rotate: 1.1,
      chips: 1,
    }),
    { tone: -0.25, strata: 1, cracks: 1 },
  );
}

const CROWN_POINTS = 5;
const CROWN_HEIGHT = 0.13;
const CROWN_SNAP_CHANCE = 0.45;
/** How far across the skull the spires reach, as a fraction of its radius. */
const CROWN_SPREAD = 0.72;
/** How far up the dome the spires are seated, so their bases sink into stone. */
const CROWN_SEAT = 0.95;
/** How far around the dome the outermost spire is allowed to sit. */
const CROWN_ARC_LIMIT = 0.72;

/** A ring of broken spires — half of them snapped off, which is the whole idea. */
function drawBrokenCrown(ctx: Ctx, d: DrawCtx, centre: Pt, rx: number, ry: number): void {
  for (let i = 0; i < CROWN_POINTS; i++) {
    // Never quite reaching the skull's equator: a spire seated there sits at
    // eye level and reads as a bar sticking out of the side of his head.
    const across = lerp(-CROWN_ARC_LIMIT, CROWN_ARC_LIMIT, i / (CROWN_POINTS - 1));
    const x = centre.x + across * rx * CROWN_SPREAD;
    // Seated on the skull's actual dome rather than on a flat line across it:
    // the head is an ellipse, so a flat base leaves the outer spires floating
    // in the gap above its shoulders.
    const baseY = centre.y - ry * CROWN_SEAT * Math.sqrt(Math.max(0, 1 - across * across));
    const snapped = hash2(HEAD_SEED + 5, i) < CROWN_SNAP_CHANCE;
    const height = CROWN_HEIGHT * (snapped ? 0.32 : 1) * d.spec.bulk;
    const halfWidth = rx * 0.16;
    paintStone(
      ctx,
      [
        { x: x - halfWidth, y: baseY },
        { x: x - halfWidth * 0.5, y: baseY - height },
        { x: x + halfWidth * (snapped ? 0.9 : 0.35), y: baseY - height * (snapped ? 0.8 : 1.05) },
        { x: x + halfWidth, y: baseY },
      ],
      { tone: 0.24, strata: 0, seamWidth: 0.012 },
    );
  }
}

// ── Effects ──────────────────────────────────────────────────────────────────

const DUST_PUFFS = 5;
const DUST_ALPHA = 0.45;
const DUST_MIN_R = 0.02;
const DUST_MAX_R = 0.07;

function drawDust(ctx: Ctx, at: Pt, amount: number): void {
  if (amount <= 0) return;
  for (let i = 0; i < DUST_PUFFS; i++) {
    const spread = lerp(0.05, 0.3, amount) * (1 + hash2(i, 3));
    const side = i % 2 === 0 ? -1 : 1;
    const x = at.x + side * spread * (0.4 + hash2(i, 5));
    const y = at.y - lerp(0, 0.1, amount) * hash2(i, 7);
    const r = lerp(DUST_MIN_R, DUST_MAX_R, amount) * (0.6 + hash2(i, 11));
    ctx.fillStyle = rgba(STONE_LIGHT, DUST_ALPHA * amount * (1 - i / DUST_PUFFS));
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TWO_PI);
    ctx.fill();
  }
}

const DAZE_CHIPS = 6;
const DAZE_RING_RX = 0.34;
const DAZE_RING_RY = 0.11;
const DAZE_RING_LIFT = 1.5;
const DAZE_CHIP_MIN_R = 0.018;
const DAZE_CHIP_MAX_R = 0.032;

/** Chips of the golem's own body orbiting a stunned head — the "seeing stars" beat. */
function drawDazeRing(ctx: Ctx, d: DrawCtx, centre: Pt): void {
  if (d.pose.daze <= 0) return;
  for (let i = 0; i < DAZE_CHIPS; i++) {
    const angle = d.pose.time * TWO_PI + (i / DAZE_CHIPS) * TWO_PI;
    const near = (Math.sin(angle) + 1) / 2;
    const r = lerp(DAZE_CHIP_MIN_R, DAZE_CHIP_MAX_R, near) * d.pose.daze;
    paintStone(
      ctx,
      stonePolygon({
        seed: 300 + i,
        cx: centre.x + Math.cos(angle) * DAZE_RING_RX,
        cy: centre.y - HEAD_RY * DAZE_RING_LIFT + Math.sin(angle) * DAZE_RING_RY,
        rx: r,
        ry: r * 0.85,
        sides: 5,
        jitter: 0.3,
        rotate: angle,
        chips: 0,
      }),
      { tone: 0.1, strata: 0, seamWidth: 0.01, depth: 1 - near },
    );
  }
}

const CONTACT_SHADOW_FLATTEN = 0.24;
const CONTACT_SHADOW_SPREAD = 0.95;

/**
 * How far the ground shadow spills below the soles, in tile units. The anchor
 * gate needs this: the lowest ink in a standing frame is the shadow, not the
 * feet, and without the allowance the gate reads a correct anchor as drift.
 */
export function contactShadowDrop(variant: GolemVariant): number {
  return SHOULDER_HALF * VARIANTS[variant].bulk * CONTACT_SHADOW_SPREAD * CONTACT_SHADOW_FLATTEN;
}

function drawContactShadow(ctx: Ctx, spec: VariantSpec): void {
  const rx = SHOULDER_HALF * spec.bulk * CONTACT_SHADOW_SPREAD;
  ctx.fillStyle = rgba(STONE_DEEP, CONTACT_SHADOW_ALPHA);
  ctx.beginPath();
  ctx.ellipse(0, 0, rx, rx * CONTACT_SHADOW_FLATTEN, 0, 0, TWO_PI);
  ctx.fill();
}

const HELD_ROCK_SIDES = 8;

/**
 * The boulder is placed on the midpoint of the two fists rather than on a path
 * of its own, so the grip is correct in every view by construction and no gate
 * has to police it.
 */
function drawHeldRock(ctx: Ctx, d: DrawCtx, left: ArmChain, right: ArmChain): void {
  const radius = d.pose.rockRadius;
  if (radius <= 0) return;
  paintStone(
    ctx,
    stonePolygon({
      seed: 401,
      cx: (left.fist.x + right.fist.x) / 2,
      cy: (left.fist.y + right.fist.y) / 2,
      rx: radius,
      ry: radius * 0.92,
      sides: HELD_ROCK_SIDES,
      jitter: 0.24,
      rotate: d.pose.time * TWO_PI,
      chips: 2,
    }),
    { tone: -0.05 },
  );
}

// ── The figure ───────────────────────────────────────────────────────────────

/**
 * The near/far assignment in profile. The sheet is always drawn facing +X and
 * mirrored at runtime, so "near" is the limb on the camera side — its pair is
 * drawn first and shaded back so the two never merge into one limb.
 */
const FAR_LIMB_DEPTH = 1;
const NEAR_LIMB_DEPTH = 0;
/** Head-on there is no real occlusion, only enough shading to separate the pair. */
const AXIAL_FAR_DEPTH = 0.3;

function drawGolemFigure(ctx: Ctx, view: GolemView, pose: GolemPose, variant: GolemVariant): void {
  const spec = VARIANTS[variant];
  const d: DrawCtx = { view: VIEWS[view], spec, pose };

  ctx.save();
  ctx.translate(0, GROUND_Y);
  ctx.lineCap = 'round';

  drawContactShadow(ctx, spec);

  ctx.translate(d.view.project(pose.sway, 0), pose.bob);
  ctx.scale(1, pose.squash);

  const armL = solveArm(shoulderAt(d, -1), pose.armL, -1, d.view);
  const armR = solveArm(shoulderAt(d, 1), pose.armR, 1, d.view);

  // In profile the golem's far side is its left, because the sheet always faces
  // +X; head-on the choice only decides which of two symmetric limbs is shaded.
  const farSide = -1;
  const farDepth = d.view.profile ? FAR_LIMB_DEPTH : AXIAL_FAR_DEPTH;

  drawLeg(ctx, d, pose.legL, farSide, farDepth);
  drawArm(ctx, d, pose.armL, farSide, armL, farDepth);

  ctx.save();
  ctx.translate(0, pose.crouch);
  ctx.translate(0, HIP_Y);
  // A head-on lean is pure foreshortening, which a rotation would misread as
  // the torso toppling sideways.
  ctx.rotate(d.view.profile ? pose.lean : 0);
  ctx.translate(0, -HIP_Y);
  drawTorso(ctx, d);
  ctx.restore();

  drawLeg(ctx, d, pose.legR, -farSide, NEAR_LIMB_DEPTH);

  drawShoulderBoulder(ctx, d, armL.shoulder, farSide, farDepth);
  drawHead(ctx, d);
  drawShoulderBoulder(ctx, d, armR.shoulder, -farSide, NEAR_LIMB_DEPTH);

  drawArm(ctx, d, pose.armR, -farSide, armR, NEAR_LIMB_DEPTH);

  drawHeldRock(ctx, d, armL, armR);
  drawDazeRing(ctx, d, headCentre(d));

  drawDust(ctx, { x: ankleOf(d, pose.legL, -1).x, y: 0 }, pose.dustL);
  drawDust(ctx, { x: ankleOf(d, pose.legR, 1).x, y: 0 }, pose.dustR);

  ctx.restore();
}

export function drawGolemFront(ctx: Ctx, pose: GolemPose, variant: GolemVariant): void {
  drawGolemFigure(ctx, 'front', pose, variant);
}

export function drawGolemBack(ctx: Ctx, pose: GolemPose, variant: GolemVariant): void {
  drawGolemFigure(ctx, 'back', pose, variant);
}

export function drawGolemSide(ctx: Ctx, pose: GolemPose, variant: GolemVariant): void {
  drawGolemFigure(ctx, 'side', pose, variant);
}

export function drawGolem(
  ctx: Ctx,
  view: GolemView,
  pose: GolemPose,
  variant: GolemVariant,
): void {
  drawGolemFigure(ctx, view, pose, variant);
}

// ── The boulder form ─────────────────────────────────────────────────────────

export interface BallPose {
  /** Rotation of the whole boulder, radians. */
  readonly spin: number;
  /** 0 = the shell is absent, 1 = fully closed over the tucked figure. */
  readonly closed: number;
  /** Radius of the ball in tile units. */
  readonly radius: number;
  /** Grit and chips thrown off the contact patch, 0..1. */
  readonly debris: number;
}

const BALL_PLATES = 9;
const BALL_PLATE_SIDES = 6;
const BALL_DEBRIS_CHIPS = 7;
const BALL_OPEN_DISTANCE = 1.35;
const BALL_CLOSED_DISTANCE = 0.62;

/**
 * The rolled-up boss: a ring of stone plates swung shut over a molten core.
 *
 * The plates are individual stones rather than one circle for the same reason
 * the body is — a smooth ball reads as a cannonball, and the point is that this
 * is the golem with its own slabs folded over it.
 */
export function drawGolemBall(ctx: Ctx, ball: BallPose, variant: GolemVariant): void {
  const spec = VARIANTS[variant];
  ctx.save();
  ctx.translate(0, GROUND_Y);

  ctx.fillStyle = rgba(STONE_DEEP, CONTACT_SHADOW_ALPHA);
  ctx.beginPath();
  ctx.ellipse(0, 0, ball.radius * 0.95, ball.radius * CONTACT_SHADOW_FLATTEN, 0, 0, TWO_PI);
  ctx.fill();

  ctx.save();
  ctx.translate(0, -ball.radius);

  // The core shows between the plates while they are still closing.
  paintGlow(ctx, { x: 0, y: 0 }, ball.radius * 0.78, spec, lerp(0.6, 0.34, ball.closed));

  for (let i = 0; i < BALL_PLATES; i++) {
    const angle = ball.spin + (i / BALL_PLATES) * TWO_PI;
    // Plates swing in from outside as the golem closes, so the curl reads as
    // armour folding shut rather than as a shape fading in.
    const distance =
      ball.radius * lerp(BALL_OPEN_DISTANCE, BALL_CLOSED_DISTANCE, easeOut(ball.closed));
    const plateR = ball.radius * lerp(0.3, 0.46, ball.closed);
    paintStone(
      ctx,
      stonePolygon({
        seed: 500 + i,
        cx: Math.cos(angle) * distance,
        cy: Math.sin(angle) * distance,
        rx: plateR,
        ry: plateR * 0.92,
        sides: BALL_PLATE_SIDES,
        jitter: 0.22 * spec.weathering,
        rotate: angle,
        chips: 1,
      }),
      { tone: lerp(-0.2, 0.2, (Math.cos(angle) + 1) / 2), strata: 1 },
    );
  }
  ctx.restore();

  for (let i = 0; i < BALL_DEBRIS_CHIPS && ball.debris > 0; i++) {
    const x = lerp(-ball.radius * 1.5, ball.radius * 1.5, hash2(600 + i, 1));
    const y = -hash2(600 + i, 2) * ball.radius * 0.7 * ball.debris;
    const r = ball.radius * 0.11 * (0.5 + hash2(600 + i, 3)) * ball.debris;
    ctx.fillStyle = rgba(STONE_LIGHT, 0.7 * ball.debris);
    ctx.beginPath();
    ctx.arc(x, y, r, 0, TWO_PI);
    ctx.fill();
  }

  ctx.restore();
}

/**
 * The curl and its reverse: the tucked figure fading out under the shell as the
 * plates swing shut. A crossfade rather than a true per-stone morph — at 32 px
 * the plates closing over is what reads, and mapping every body stone onto a
 * shell plate buys nothing a viewer can see.
 */
export function drawGolemCurled(
  ctx: Ctx,
  view: GolemView,
  pose: GolemPose,
  ball: BallPose,
  variant: GolemVariant,
): void {
  const fade = 1 - easeIn(ball.closed);
  if (fade > 0) {
    ctx.save();
    ctx.globalAlpha = fade;
    drawGolemFigure(ctx, view, pose, variant);
    ctx.restore();
  }
  if (ball.closed > 0) drawGolemBall(ctx, ball, variant);
}

// ── Rubble "gore" ────────────────────────────────────────────────────────────

export interface RubblePiece {
  /** Manifest state name, e.g. `gore_head`. */
  readonly state: string;
  /** Painted in tile units about its own origin; the bake re-centres each cell. */
  readonly paint: (ctx: Ctx, variant: GolemVariant) => void;
}

const FRACTURE_TEETH = 7;

/**
 * The broken face of a stone: a jagged inner edge with the core's heat still in
 * it. A golem does not bleed, so this is the entire read of a severed part —
 * bright, fractured, and clearly the inside of something that was solid. It is
 * why these pieces do not go through `goreWound.ts`, whose muscle, blood and
 * bone vocabulary has nothing a rock can use.
 */
function paintFractureFace(
  ctx: Ctx,
  from: Pt,
  to: Pt,
  depth: number,
  seed: number,
  spec: VariantSpec,
): void {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const pts: Pt[] = [from];
  for (let i = 1; i < FRACTURE_TEETH; i++) {
    const t = i / FRACTURE_TEETH;
    const bite = depth * (0.35 + 0.65 * hash2(seed, i)) * (i % 2 === 0 ? 1 : 0.35);
    pts.push({ x: from.x + dx * t - dy * bite, y: from.y + dy * t + dx * bite });
  }
  pts.push(to);
  traceOutline(ctx, pts);
  ctx.fillStyle = rgba(SEAM, 0.95);
  ctx.fill();
  paintGlow(ctx, centroidOf(pts), Math.hypot(dx, dy) * 0.28, spec, 0.85);
}

function rubbleStone(seed: number, rx: number, ry: number, sides: number, chips: number): Pt[] {
  return stonePolygon({ seed, cx: 0, cy: 0, rx, ry, sides, jitter: 0.26, rotate: seed, chips });
}

const HEAD_PIECE_R = 0.24;
const FIST_PIECE_R = 0.19;
const SLAB_PIECE_RX = 0.32;
const SLAB_PIECE_RY = 0.24;
const LIMB_PIECE_RX = 0.34;
const LIMB_PIECE_RY = 0.12;
const SCATTER_PIECE_R = 0.13;
const SCATTER_STONES = 4;

/**
 * The eight rubble pieces a dying golem comes apart into. They have to be
 * nameable from a 16 px thumbnail, which is why the set is built from four
 * clearly different silhouettes — round head, blocky fist, wide slab, long limb
 * — rather than eight variations on a lump.
 */
export function rockGolemRubblePieces(): readonly RubblePiece[] {
  return [
    {
      state: 'gore_head',
      paint: (ctx, variant) => {
        const spec = VARIANTS[variant];
        paintStone(ctx, rubbleStone(HEAD_SEED, HEAD_PIECE_R, HEAD_PIECE_R * 0.9, 7, 1), {
          tone: 0.16,
          lichen: spec.lichen ? 1 : 0,
        });
        // The eye slots are what keep this nameable as the head at thumbnail size.
        for (const side of [-1, 1]) {
          ctx.fillStyle = rgba(EYE, 0.85);
          ctx.beginPath();
          ctx.arc(side * HEAD_PIECE_R * 0.34, -HEAD_PIECE_R * 0.06, EYE_RADIUS, 0, TWO_PI);
          ctx.fill();
        }
        paintFractureFace(
          ctx,
          { x: -HEAD_PIECE_R * 0.8, y: HEAD_PIECE_R * 0.5 },
          { x: HEAD_PIECE_R * 0.8, y: HEAD_PIECE_R * 0.42 },
          0.22,
          HEAD_SEED,
          spec,
        );
      },
    },
    {
      state: 'gore_core',
      paint: (ctx, variant) => {
        const spec = VARIANTS[variant];
        paintStone(ctx, rubbleStone(TORSO_SEED + 2, SLAB_PIECE_RX, SLAB_PIECE_RY, 8, 2), {
          tone: 0.05,
          strata: 3,
          lichen: spec.lichen ? 1 : 0,
        });
        // The chest slab cracked open around the core it was hiding.
        traceOutline(
          ctx,
          rubbleStone(TORSO_SEED + 9, SLAB_PIECE_RX * 0.42, SLAB_PIECE_RY * 0.5, 6, 2),
        );
        ctx.fillStyle = rgba(SEAM, 0.95);
        ctx.fill();
        paintGlow(ctx, { x: 0, y: 0 }, SLAB_PIECE_RX * 0.4, spec, 1);
      },
    },
    {
      state: 'gore_fist_left',
      paint: (ctx, variant) => {
        const spec = VARIANTS[variant];
        paintStone(ctx, rubbleStone(ARM_SEEDS.left + 2, FIST_PIECE_R, FIST_PIECE_R * 0.94, 7, 1), {
          tone: 0.12,
          strata: 1,
        });
        paintFractureFace(
          ctx,
          { x: -FIST_PIECE_R * 0.7, y: FIST_PIECE_R * 0.55 },
          { x: FIST_PIECE_R * 0.55, y: FIST_PIECE_R * 0.7 },
          0.2,
          ARM_SEEDS.left,
          spec,
        );
      },
    },
    {
      state: 'gore_fist_right',
      paint: (ctx, variant) => {
        const spec = VARIANTS[variant];
        paintStone(ctx, rubbleStone(ARM_SEEDS.right + 2, FIST_PIECE_R * 1.08, FIST_PIECE_R, 6, 2), {
          tone: 0.14,
          strata: 1,
        });
        paintFractureFace(
          ctx,
          { x: -FIST_PIECE_R * 0.6, y: -FIST_PIECE_R * 0.7 },
          { x: FIST_PIECE_R * 0.75, y: -FIST_PIECE_R * 0.4 },
          0.2,
          ARM_SEEDS.right,
          spec,
        );
      },
    },
    {
      state: 'gore_arm',
      paint: (ctx, variant) => {
        const spec = VARIANTS[variant];
        paintStone(ctx, rubbleStone(ARM_SEEDS.right, LIMB_PIECE_RX, LIMB_PIECE_RY, 7, 1), {
          tone: -0.1,
          strata: 1,
        });
        paintFractureFace(
          ctx,
          { x: -LIMB_PIECE_RX * 0.9, y: -LIMB_PIECE_RY * 0.6 },
          { x: -LIMB_PIECE_RX * 0.75, y: LIMB_PIECE_RY * 0.7 },
          0.3,
          ARM_SEEDS.right + 5,
          spec,
        );
      },
    },
    {
      state: 'gore_leg',
      paint: (ctx, variant) => {
        const spec = VARIANTS[variant];
        paintStone(
          ctx,
          rubbleStone(LEG_SEEDS.left, LIMB_PIECE_RX * 0.9, LIMB_PIECE_RY * 1.35, 6, 2),
          { tone: -0.18 },
        );
        paintFractureFace(
          ctx,
          { x: LIMB_PIECE_RX * 0.8, y: -LIMB_PIECE_RY },
          { x: LIMB_PIECE_RX * 0.7, y: LIMB_PIECE_RY },
          0.3,
          LEG_SEEDS.left + 5,
          spec,
        );
      },
    },
    {
      state: 'gore_shoulder',
      paint: (ctx, variant) => {
        const spec = VARIANTS[variant];
        paintStone(
          ctx,
          rubbleStone(SHOULDER_SEEDS.left, SLAB_PIECE_RX * 0.72, SLAB_PIECE_RY * 0.92, 8, 2),
          { tone: 0.2, lichen: spec.lichen ? 1 : 0 },
        );
        // Without this it reads as an intact boulder someone left lying about
        // rather than as a piece torn off something. Every other rubble piece
        // carries its break; this one was the exception.
        paintFractureFace(
          ctx,
          { x: -SLAB_PIECE_RX * 0.5, y: SLAB_PIECE_RY * 0.62 },
          { x: SLAB_PIECE_RX * 0.55, y: SLAB_PIECE_RY * 0.48 },
          0.24,
          SHOULDER_SEEDS.left + 7,
          spec,
        );
      },
    },
    {
      state: 'gore_scatter',
      paint: (ctx, variant) => {
        const spec = VARIANTS[variant];
        for (let i = 0; i < SCATTER_STONES; i++) {
          const angle = (i / SCATTER_STONES) * TWO_PI + 0.4;
          ctx.save();
          ctx.translate(
            Math.cos(angle) * SCATTER_PIECE_R * 1.15,
            Math.sin(angle) * SCATTER_PIECE_R * 0.8,
          );
          paintStone(ctx, rubbleStone(700 + i, SCATTER_PIECE_R * 0.7, SCATTER_PIECE_R * 0.6, 5, 1), {
            tone: lerp(-0.2, 0.2, i / SCATTER_STONES),
            strata: 0,
            seamWidth: 0.012,
          });
          ctx.restore();
        }
        paintGlow(ctx, { x: 0, y: 0 }, SCATTER_PIECE_R * 0.5, spec, 0.5);
      },
    },
  ];
}

// ── The thrown boulder and its impact ────────────────────────────────────────

const THROWN_ROCK_SIDES = 8;
const THROWN_ROCK_SEED = 811;

/** The projectile itself, drawn about its own centre. */
export function drawThrownRock(ctx: Ctx, radius: number, spin: number): void {
  paintStone(
    ctx,
    stonePolygon({
      seed: THROWN_ROCK_SEED,
      cx: 0,
      cy: 0,
      rx: radius,
      ry: radius * 0.94,
      sides: THROWN_ROCK_SIDES,
      jitter: 0.26,
      rotate: spin,
      chips: 2,
    }),
    { tone: -0.05, strata: 2 },
  );
}

const BURST_SHARDS = 9;
const BURST_DUST_PUFFS = 6;

/** The rubble burst a thrown rock breaks into, `progress` 0..1 across the shatter. */
export function drawRockBurst(ctx: Ctx, radius: number, progress: number): void {
  const spread = easeOut(progress);
  const fade = 1 - easeIn(progress);

  for (let i = 0; i < BURST_DUST_PUFFS; i++) {
    const angle = (i / BURST_DUST_PUFFS) * TWO_PI + 0.3;
    const distance = radius * lerp(0.2, 1.5, spread);
    ctx.fillStyle = rgba(STONE_LIGHT, 0.4 * fade);
    ctx.beginPath();
    ctx.arc(
      Math.cos(angle) * distance,
      Math.sin(angle) * distance * 0.7,
      radius * lerp(0.25, 0.6, spread),
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  ctx.save();
  ctx.globalAlpha = fade;
  for (let i = 0; i < BURST_SHARDS; i++) {
    const angle = (i / BURST_SHARDS) * TWO_PI + hash2(THROWN_ROCK_SEED, i);
    const distance = radius * lerp(0.15, 1.7, spread) * (0.6 + hash2(THROWN_ROCK_SEED + 1, i));
    const shardR = radius * lerp(0.34, 0.16, spread) * (0.6 + hash2(THROWN_ROCK_SEED + 2, i));
    paintStone(
      ctx,
      stonePolygon({
        seed: 900 + i,
        cx: Math.cos(angle) * distance,
        cy: Math.sin(angle) * distance * 0.8,
        rx: shardR,
        ry: shardR * 0.85,
        sides: 5,
        jitter: 0.3,
        rotate: angle + spread * TWO_PI * 0.4,
        chips: 1,
      }),
      { tone: lerp(-0.2, 0.2, hash2(THROWN_ROCK_SEED + 3, i)), strata: 0, seamWidth: 0.012 },
    );
  }
  ctx.restore();
}
