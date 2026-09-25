/**
 * The painter behind every cow and calf, and the base any other bovine is built
 * on.
 *
 * What makes a cow read as a cow at 32 px is a short list of cues: a long,
 * deep, rectangular barrel with a straight back; a hip bone (the hook) and a
 * pin bone standing up at the rump; a big wedge head carried low, ending in a
 * broad, square, wet muzzle; ears that stick straight out sideways; a thin tail
 * hanging to the hocks and ending in a tuft; cloven hooves; and a coat that is
 * short and smooth — except on the highland dun, whose shag and forelock are
 * the whole point of it. Everything here exists to serve one of those.
 *
 * The head-on ears are the single most important of them. A face seen straight
 * on with its ears out wide is a cow; the same face with its ears tucked could
 * be a horse, a deer or a dog. `scripts/gates-cow.ts` holds the ratio.
 *
 * ## Reusing this painter
 *
 * Everything the drawing reads comes through two arguments:
 *
 * - a {@link CowPose} — how the animal is standing this frame, in tile units
 *   and radians, and nothing about what it looks like;
 * - a {@link CowLook} — what the animal looks like: its {@link CowBuild}
 *   (proportions), its {@link CowHide} (every colour), its horns, its shag and
 *   its markings, plus optional {@link CowDecorations} called with the context
 *   transformed into each part's own space.
 *
 * A new bovine (a bull, a raised undead one) is a new `CowLook` — a heavier
 * build, bigger horns, a rotten hide — plus decorations for anything a live cow
 * does not have (exposed ribs, a glowing eye). The pose, the views and the draw
 * order come for free. {@link drawCow} is the one entry point.
 *
 * Coordinates are tile units — the caller transforms the context so 1.0 is one
 * tile — with the origin at the centre of the animal's own tile and +Y down the
 * screen. The profile faces +X, with the animal's left side nearest the viewer;
 * the runtime mirrors it for the other direction.
 */

import { type Pt, clamp01, deg, lerp, mix, rgba } from './carlArt';
import { fillSoftEllipse } from './softShade';

type Ctx = CanvasRenderingContext2D;

// ── Small maths ──────────────────────────────────────────────────────────────

export const TWO_PI = Math.PI * 2;
const HALF_PI = Math.PI / 2;
/** Lengths below this are treated as degenerate; canvas rejects negative arcs. */
const MIN_LENGTH = 1e-4;

/** Deterministic pseudo-random in [0,1), so a re-run paints identical art. */
export function hash1(seed: number): number {
  const HASH_MULTIPLIER = 12.9898;
  const HASH_SCALE = 43758.5453;
  const x = Math.sin(seed * HASH_MULTIPLIER) * HASH_SCALE;
  return x - Math.floor(x);
}

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;
const UINT32_RANGE = 4294967296;
/** Spreads a text seed over a range the sine hash does not repeat inside. */
const TEXT_SEED_RANGE = 1000;

/**
 * A stable number for a piece of text. A coat's markings are seeded from its
 * name — never from a frame, a position or a counter — so a patch sits in the
 * same place on the hide in every cell ever painted, and cannot crawl.
 */
export function seedFromText(text: string): number {
  let h = FNV_OFFSET;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME);
  }
  return ((h >>> 0) / UINT32_RANGE) * TEXT_SEED_RANGE;
}

function rotatePt(p: Pt, angle: number): Pt {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  return { x: p.x * c - p.y * s, y: p.x * s + p.y * c };
}

function add(a: Pt, b: Pt): Pt {
  return { x: a.x + b.x, y: a.y + b.y };
}

function scalePt(p: Pt, k: number): Pt {
  return { x: p.x * k, y: p.y * k };
}

function fromAngle(angle: number, length: number): Pt {
  return { x: Math.cos(angle) * length, y: Math.sin(angle) * length };
}

// ── Paths ────────────────────────────────────────────────────────────────────

/** Lays a smooth closed curve through the points into the current path. */
function appendSmooth(ctx: Ctx, pts: readonly Pt[]): void {
  if (pts.length < 3) return;
  const last = pts[pts.length - 1];
  const first = pts[0];
  ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
  for (let i = 0; i < pts.length; i++) {
    const cur = pts[i];
    const next = pts[(i + 1) % pts.length];
    ctx.quadraticCurveTo(cur.x, cur.y, (cur.x + next.x) / 2, (cur.y + next.y) / 2);
  }
  ctx.closePath();
}

/** Opens a new path holding one smooth closed curve through the points. */
export function traceSmooth(ctx: Ctx, pts: readonly Pt[]): void {
  ctx.beginPath();
  appendSmooth(ctx, pts);
}

const OVAL_STEPS = 28;

/** A closed ellipse as points, rotated by `rot`, with a gentle seeded wobble. */
export function ovalPoints(
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  rot = 0,
  wobble = 0,
  seed = 0,
  steps = OVAL_STEPS,
): Pt[] {
  const WOBBLE_LOBES_MAJOR = 3;
  const WOBBLE_LOBES_MINOR = 5;
  const pts: Pt[] = [];
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  for (let i = 0; i < steps; i++) {
    const a = (i / steps) * TWO_PI;
    const k =
      1 +
      wobble *
        (0.6 * Math.sin(a * WOBBLE_LOBES_MAJOR + seed) +
          0.4 * Math.sin(a * WOBBLE_LOBES_MINOR - seed * 1.7));
    const lx = Math.cos(a) * rx * k;
    const ly = Math.sin(a) * ry * k;
    pts.push({ x: cx + lx * c - ly * s, y: cy + lx * s + ly * c });
  }
  return pts;
}

interface Box {
  readonly minX: number;
  readonly minY: number;
  readonly maxX: number;
  readonly maxY: number;
}

export function boundsOfPoints(pts: readonly Pt[]): Box {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pts) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  return { minX, minY, maxX, maxY };
}

// ── Look: build, hide, horns ─────────────────────────────────────────────────

/**
 * An animal's proportions, in tile units, for the profile facing +X.
 *
 * Every joint is authored as an absolute point rather than derived from a
 * head size: a stylised head is deliberately oversized, and a body hung off it
 * inflates. The barrel is the one exception — its silhouette is a shared
 * normalised shape stretched over `bodyHalfLength` × `bodyHalfDepth`, so a
 * calf, a cow and a bull all have the same brisket, flank and pin bone.
 */
export interface CowBuild {
  readonly bodyCx: number;
  readonly bodyCy: number;
  readonly bodyHalfLength: number;
  readonly bodyHalfDepth: number;
  /**
   * Where each leg pivots, inside the barrel. The foreleg swings from high on
   * the shoulder, as a real one does from the scapula: a pivot at the elbow
   * leaves a straight leg no reach at all, and the walk has to patter. The
   * hind leg pivots at the stifle, and its bent hock gives it reach.
   */
  readonly foreRoot: Pt;
  readonly hindRoot: Pt;
  /** Where a standing hoof rests, as an x on the ground line. */
  readonly foreFootX: number;
  readonly hindFootX: number;
  readonly foreUpper: number;
  readonly foreLower: number;
  readonly hindUpper: number;
  readonly hindLower: number;
  readonly legRootHalfWidth: number;
  /** A calf's knees are knobbly; this is the joint's half width. */
  readonly kneeHalfWidth: number;
  readonly cannonHalfWidth: number;
  readonly hoofHeight: number;
  readonly neckRoot: Pt;
  readonly neckLength: number;
  /** Radians from +X; negative carries the neck up and forward. */
  readonly neckRestAngle: number;
  readonly neckRootHalfWidth: number;
  readonly neckTipHalfWidth: number;
  /** How far the dewlap hangs below the throat line. */
  readonly dewlapDrop: number;
  readonly headLength: number;
  readonly headDepth: number;
  /** Radians below horizontal the face is carried at rest. */
  readonly headRestAngle: number;
  readonly headFrontHalfWidth: number;
  readonly eyeRadius: number;
  readonly earLength: number;
  readonly earHalfWidth: number;
  readonly tailRoot: Pt;
  readonly tailLength: number;
  readonly switchLength: number;
  /** Zero for an animal with no udder: a calf, a bull. */
  readonly udderRadius: number;
  readonly axialBodyHalfWidth: number;
  readonly axialForeTrack: number;
  readonly axialHindTrack: number;
  /** How far the barrel sinks when the animal lies down. */
  readonly lieDrop: number;
  /** Scale the severed pieces are painted at, relative to an adult's. */
  readonly goreScale: number;
}

/**
 * Every colour a bovine is painted in. Named by where it sits on the animal,
 * so a new coat is a new table and never a new painter.
 */
export interface CowHide {
  readonly base: string;
  readonly shadow: string;
  readonly light: string;
  /** Holstein black; null for a solid coat. */
  readonly patch: string | null;
  /** Share of the hide the patches cover, 0–1. */
  readonly patchCover: number;
  /** A paler underline and inner leg, or null. */
  readonly belly: string | null;
  /** Lower legs, from the knee down. */
  readonly points: string;
  /** A face darker than the coat (a Jersey's dish), or null. */
  readonly face: string | null;
  readonly muzzle: string;
  readonly nostril: string;
  /** A pale band behind the nose pad, or null. */
  readonly muzzleRing: string | null;
  /** Pale rings round the eyes, or null. */
  readonly eyeRing: string | null;
  readonly earInner: string;
  readonly horn: string;
  readonly hornTip: string;
  readonly hoof: string;
  readonly tailSwitch: string;
  readonly udder: string;
  readonly ink: string;
  readonly eye: string;
}

export type HornShape = 'stub' | 'upswept';

export interface HornSpec {
  readonly shape: HornShape;
  /** Horn length, in tile units. */
  readonly length: number;
  readonly baseHalfWidth: number;
  /**
   * How many dark cracks run across the horn, spaced along it; none when
   * absent. For an old or dead animal's split, weathered horn.
   */
  readonly cracks?: number;
}

/** A part a decoration can be attached to. */
export type CowPartName = 'body' | 'neck' | 'head' | 'foreleg' | 'hindleg' | 'tail';

/**
 * Extra paint laid over a finished part, called with the context in that part's
 * own space and clipped to nothing — decorations may break the silhouette.
 *
 * `outline` is the part's silhouette in the same space, for a decoration that
 * wants to clip itself to the hide. `near` is false for the far-side legs.
 */
export type CowDecoration = (
  ctx: Ctx,
  view: CowView,
  outline: readonly Pt[],
  near: boolean,
) => void;

export type CowDecorations = Partial<Readonly<Record<CowPartName, CowDecoration>>>;

/**
 * Everything that makes one bovine look like itself. A cached cell is keyed on
 * the figure, never on an instance, so a look is fixed per figure: a closed set
 * of coats is a closed set of figures.
 */
export interface CowLook {
  /** Seeds the markings, so they are a property of the coat and not of a frame. */
  readonly id: string;
  readonly build: CowBuild;
  readonly hide: CowHide;
  readonly horns: HornSpec | null;
  /** 0 for a sleek coat, 1 for a highland's shag. */
  readonly shag: number;
  /** 0 for a bare face, 1 for a fringe that hides the eyes. */
  readonly forelock: number;
  readonly decorations?: CowDecorations;
}

// ── Pose ─────────────────────────────────────────────────────────────────────

export type CowView = 'front' | 'side' | 'back';

/**
 * One hoof's displacement from where it rests.
 *
 * `dx` is along the body (forward positive), `dy` is up the screen (negative)
 * off the ground line. The axial views read `dx` as depth: a hoof reaching
 * forward is nearer the camera, so it lands lower on the screen.
 */
export interface CowFootPose {
  readonly dx: number;
  readonly dy: number;
  /** 0 planted, 1 at the top of its swing. */
  readonly lift: number;
}

export interface CowPose {
  /** Vertical offset of the whole body, in tiles; negative rises. */
  readonly bob: number;
  /** Sideways offset in the axial views, in tiles. */
  readonly sway: number;
  /** Forward offset of the body over the feet, in tiles. */
  readonly lunge: number;
  /** Body rotation about its centre; positive tips the nose down. */
  readonly pitch: number;
  /** Axial-view roll; positive leans toward screen right. */
  readonly roll: number;
  readonly breathe: number;
  /** Neck angle added to rest; positive lowers the head. */
  readonly neck: number;
  /** Head angle added to rest; positive tucks the nose. */
  readonly headPitch: number;
  /** Head yaw in the axial views, -1..1. */
  readonly headTurn: number;
  readonly headTilt: number;
  /** 0 shut, 1 fully dropped. */
  readonly jaw: number;
  /** Sideways grind of a chewing jaw, -1..1; only the head-on view shows it. */
  readonly jawSide: number;
  /** -1 pinned back, 0 out sideways, 1 perked forward. */
  readonly earL: number;
  readonly earR: number;
  /** 1 open, 0 shut into a content squint. */
  readonly eyeOpen: number;
  /** 0 hanging, 1 held straight out behind. */
  readonly tailLift: number;
  /** -1..1 swish across the rump. */
  readonly tailSwing: number;
  readonly frontL: CowFootPose;
  readonly frontR: CowFootPose;
  readonly hindL: CowFootPose;
  readonly hindR: CowFootPose;
  /** 0 standing, 1 forequarters down on the knees. */
  readonly lowerFore: number;
  /** 0 standing, 1 hindquarters down. */
  readonly lowerHind: number;
  /** Phase of the row this pose was sampled at, for loop gates. */
  readonly time: number;
}

const REST_FOOT: CowFootPose = { dx: 0, dy: 0, lift: 0 };

export function restCowPose(): CowPose {
  return {
    bob: 0,
    sway: 0,
    lunge: 0,
    pitch: 0,
    roll: 0,
    breathe: 0,
    neck: 0,
    headPitch: 0,
    headTurn: 0,
    headTilt: 0,
    jaw: 0,
    jawSide: 0,
    earL: 0,
    earR: 0,
    eyeOpen: 1,
    tailLift: 0,
    tailSwing: 0,
    frontL: REST_FOOT,
    frontR: REST_FOOT,
    hindL: REST_FOOT,
    hindR: REST_FOOT,
    lowerFore: 0,
    lowerHind: 0,
    time: 0,
  };
}

// ── Anatomy ──────────────────────────────────────────────────────────────────

/** Where the hooves meet the floor, in tile units. */
export const GROUND_Y = 0.46;

/**
 * The barrel's silhouette, as (u, v) in [-1, 1] from rear to front and from top
 * to bottom, clockwise from the point of the chest.
 *
 * A plain ellipse is a barrel on sticks. The things this outline carries that
 * an ellipse cannot are what say "cow": the hook bone and the pin bone standing
 * above a straight back, the rump sloping down to the tail head, the square
 * buttock, the flank tucked up in front of the stifle, and a deep brisket
 * dropping between the forelegs.
 */
const BARREL_SHAPE: readonly Pt[] = [
  { x: 1.04, y: 0.36 },
  { x: 0.96, y: -0.36 },
  { x: 0.74, y: -0.86 },
  { x: 0.42, y: -1.0 },
  { x: 0.0, y: -0.94 },
  { x: -0.46, y: -0.97 },
  { x: -0.72, y: -1.2 },
  { x: -0.86, y: -1.02 },
  { x: -1.04, y: -0.96 },
  { x: -1.15, y: -0.72 },
  { x: -1.2, y: -0.4 },
  { x: -1.14, y: -0.04 },
  { x: -1.0, y: 0.32 },
  { x: -0.86, y: 0.62 },
  { x: -0.72, y: 0.82 },
  { x: -0.56, y: 0.74 },
  { x: -0.36, y: 1.02 },
  { x: 0.1, y: 1.16 },
  { x: 0.5, y: 1.1 },
  { x: 0.84, y: 0.92 },
  { x: 1.04, y: 0.66 },
];

/** Where the hook and the pin bone sit, in the same (u, v) space. */
const HOOK_BONE: Pt = { x: -0.72, y: -1.08 };
const PIN_BONE: Pt = { x: -1.04, y: -0.88 };

function barrelOutline(b: CowBuild): Pt[] {
  return BARREL_SHAPE.map((p) => ({
    x: b.bodyCx + p.x * b.bodyHalfLength,
    y: b.bodyCy + p.y * b.bodyHalfDepth,
  }));
}

function barrelPoint(b: CowBuild, uv: Pt): Pt {
  return { x: b.bodyCx + uv.x * b.bodyHalfLength, y: b.bodyCy + uv.y * b.bodyHalfDepth };
}

// ── Markings ─────────────────────────────────────────────────────────────────

interface Patch {
  readonly x: number;
  readonly y: number;
  readonly rx: number;
  readonly ry: number;
  readonly rot: number;
  readonly seed: number;
  readonly color: string;
}

const PATCH_LOBES_MAJOR = 3;
const PATCH_LOBES_MINOR = 5;
const PATCH_STEPS = 22;

function patchOutline(p: Patch): Pt[] {
  const pts: Pt[] = [];
  const c = Math.cos(p.rot);
  const s = Math.sin(p.rot);
  for (let i = 0; i < PATCH_STEPS; i++) {
    const a = (i / PATCH_STEPS) * TWO_PI;
    const k =
      1 +
      0.28 * Math.sin(a * PATCH_LOBES_MAJOR + p.seed) +
      0.14 * Math.sin(a * PATCH_LOBES_MINOR - p.seed * 2.3);
    const lx = Math.cos(a) * p.rx * k;
    const ly = Math.sin(a) * p.ry * k;
    pts.push({ x: p.x + lx * c - ly * s, y: p.y + lx * s + ly * c });
  }
  return pts;
}

/**
 * Seeded markings inside a box, as irregular lobed patches.
 *
 * Built once per look from the look's own id and never at paint time: a patch
 * computed from anything a frame changes would drift across the hide as the
 * animal walks.
 */
function scatterPatches(
  seed: number,
  count: number,
  box: Box,
  size: number,
  color: string,
): Patch[] {
  const patches: Patch[] = [];
  const width = box.maxX - box.minX;
  const height = box.maxY - box.minY;
  for (let i = 0; i < count; i++) {
    const h = (k: number): number => hash1(seed + i * 17.31 + k * 3.7);
    patches.push({
      x: box.minX + width * (0.08 + 0.84 * h(1)),
      y: box.minY + height * (0.1 + 0.8 * h(2)),
      rx: size * (0.7 + 0.6 * h(3)),
      ry: size * (0.55 + 0.45 * h(4)),
      rot: (h(5) - 0.5) * Math.PI,
      seed: seed + i * 5.1,
      color,
    });
  }
  return patches;
}

/** Every marking a look carries, laid out per part and per view. */
interface Markings {
  readonly body: readonly Patch[];
  readonly neck: readonly Patch[];
  readonly headSide: readonly Patch[];
  readonly foreUpper: readonly Patch[];
  readonly hindUpper: readonly Patch[];
  readonly chest: readonly Patch[];
  readonly rump: readonly Patch[];
  readonly face: readonly Patch[];
}

const MARKINGS_BY_LOOK = new Map<string, Markings>();

/** Patches on the barrel, per full cover. */
const BODY_PATCHES = 6;
const AXIAL_PATCHES = 4;

function markingsOf(look: CowLook): Markings {
  const cached = MARKINGS_BY_LOOK.get(look.id);
  if (cached !== undefined) return cached;
  const { build: b, hide } = look;
  const seed = seedFromText(look.id);
  const patchColor = hide.patch;
  const none: readonly Patch[] = [];
  const faceTone = hide.face;
  const faceDish: Patch[] =
    faceTone === null
      ? []
      : [
          {
            x: 0,
            y: b.headLength * 0.34,
            rx: b.headFrontHalfWidth * 0.95,
            ry: b.headLength * 0.3,
            rot: 0,
            seed: seed + 9,
            color: faceTone,
          },
        ];
  if (patchColor === null) {
    const markings: Markings = {
      body: none,
      neck: none,
      headSide: faceTone === null ? none : faceSideShade(b, faceTone, seed),
      foreUpper: none,
      hindUpper: none,
      chest: none,
      rump: none,
      face: faceDish,
    };
    MARKINGS_BY_LOOK.set(look.id, markings);
    return markings;
  }
  const bodyBox: Box = {
    minX: b.bodyCx - b.bodyHalfLength,
    minY: b.bodyCy - b.bodyHalfDepth,
    maxX: b.bodyCx + b.bodyHalfLength,
    maxY: b.bodyCy + b.bodyHalfDepth * 0.7,
  };
  const count = Math.max(2, Math.round(BODY_PATCHES * hide.patchCover));
  const bodySize = b.bodyHalfDepth * (0.55 + 0.5 * hide.patchCover);
  const L = b.headLength;
  const D = b.headDepth;
  const W = b.headFrontHalfWidth;
  // A Holstein's head is black with a white blaze, which is the single most
  // recognisable dairy face there is: the head markings are laid out, not
  // scattered, and only their ragged edges come from the seed.
  const headSide: Patch[] = [
    { x: L * 0.3, y: -D * 0.12, rx: L * 0.42, ry: D * 0.46, rot: 0.1, seed, color: patchColor },
  ];
  const face: Patch[] = [
    { x: -W * 0.62, y: L * 0.24, rx: W * 0.55, ry: L * 0.26, rot: 0.2, seed, color: patchColor },
    {
      x: W * 0.62,
      y: L * 0.24,
      rx: W * 0.55,
      ry: L * 0.26,
      rot: -0.2,
      seed: seed + 3,
      color: patchColor,
    },
  ];
  const markings: Markings = {
    body: scatterPatches(seed, count, bodyBox, bodySize, patchColor),
    neck: scatterPatches(seed + 41, 1, neckBox(b), b.neckRootHalfWidth * 0.9, patchColor),
    headSide,
    foreUpper: scatterPatches(seed + 71, 1, legBox(b.foreUpper), b.legRootHalfWidth, patchColor),
    hindUpper: scatterPatches(seed + 83, 1, legBox(b.hindUpper), b.legRootHalfWidth, patchColor),
    chest: scatterPatches(
      seed + 97,
      Math.max(1, Math.round(AXIAL_PATCHES * hide.patchCover)),
      {
        minX: -b.axialBodyHalfWidth,
        minY: b.bodyCy - b.bodyHalfDepth,
        maxX: b.axialBodyHalfWidth,
        maxY: b.bodyCy + b.bodyHalfDepth * 0.5,
      },
      b.axialBodyHalfWidth * 0.5,
      patchColor,
    ),
    rump: scatterPatches(
      seed + 131,
      Math.max(1, Math.round(AXIAL_PATCHES * hide.patchCover)),
      {
        minX: -b.axialBodyHalfWidth,
        minY: b.bodyCy - b.bodyHalfDepth,
        maxX: b.axialBodyHalfWidth,
        maxY: b.bodyCy + b.bodyHalfDepth * 0.6,
      },
      b.axialBodyHalfWidth * 0.55,
      patchColor,
    ),
    face,
  };
  MARKINGS_BY_LOOK.set(look.id, markings);
  return markings;
}

function faceSideShade(b: CowBuild, tone: string, seed: number): Patch[] {
  return [
    {
      x: b.headLength * 0.62,
      y: -b.headDepth * 0.05,
      rx: b.headLength * 0.5,
      ry: b.headDepth * 0.5,
      rot: 0,
      seed,
      color: tone,
    },
  ];
}

/** The neck's own space: x along the neck from its root, y across it. */
function neckBox(b: CowBuild): Box {
  return {
    minX: b.neckLength * 0.1,
    minY: -b.neckRootHalfWidth * 0.8,
    maxX: b.neckLength * 0.8,
    maxY: b.neckRootHalfWidth * 0.8,
  };
}

/** An upper leg's own space: y down the bone from its root. */
function legBox(length: number): Box {
  return { minX: -0.02, minY: 0, maxX: 0.02, maxY: length * 0.6 };
}

// ── Hide painting ────────────────────────────────────────────────────────────

/** The ink ring round every silhouette, as a stroke width (half of it shows). */
const INK_WIDTH = 0.034;
const INK_ALPHA = 0.9;
/** How much the key light lifts the top of a form and the shade sinks its underside. */
const TOP_LIGHT_ALPHA = 0.32;
const UNDER_SHADE_ALPHA = 0.5;
const HAIR_ALPHA = 0.2;
const HAIR_WIDTH = 0.008;
const SHAG_WIDTH = 0.012;

interface HideFill {
  readonly outline: readonly Pt[];
  readonly patches: readonly Patch[];
  /** Extra darkening for the far side of the animal. */
  readonly shade: number;
  /** The base colour when the part is not the coat's own (a pale belly, a point). */
  readonly base?: string;
  /** Hair direction, radians. */
  readonly hairAngle: number;
  readonly hairCount: number;
  readonly hairLength: number;
  readonly seed: number;
  /** Length of the ragged locks a shaggy coat throws off the silhouette. */
  readonly shagLength: number;
  /** Extra marks painted inside the clip: creases, a hook-bone highlight. */
  readonly detail?: (ctx: Ctx) => void;
}

function inkOutline(ctx: Ctx, look: CowLook, outline: readonly Pt[]): void {
  traceSmooth(ctx, outline);
  ctx.strokeStyle = rgba(look.hide.ink, INK_ALPHA);
  ctx.lineWidth = INK_WIDTH;
  ctx.lineJoin = 'round';
  ctx.stroke();
}

/**
 * Fills one part of the hide: base, markings, form light and shade, hair, and
 * for a shaggy coat the locks that break its silhouette. The ink ring is laid
 * separately by {@link inkOutline}, so a group of overlapping parts can share
 * one outer contour with no seam where they join.
 */
function fillHide(ctx: Ctx, look: CowLook, fill: HideFill): void {
  const { hide } = look;
  const { outline } = fill;
  if (outline.length < 3) return;
  const bounds = boundsOfPoints(outline);
  const baseTone = mix(fill.base ?? hide.base, hide.shadow, clamp01(fill.shade));

  traceSmooth(ctx, outline);
  ctx.fillStyle = baseTone;
  ctx.fill();

  ctx.save();
  try {
    traceSmooth(ctx, outline);
    ctx.clip();
    for (const patch of fill.patches) {
      traceSmooth(ctx, patchOutline(patch));
      ctx.fillStyle = mix(patch.color, hide.shadow, clamp01(fill.shade) * 0.5);
      ctx.fill();
    }
    fill.detail?.(ctx);

    const light = ctx.createLinearGradient(0, bounds.minY, 0, bounds.maxY);
    light.addColorStop(0, rgba(hide.light, TOP_LIGHT_ALPHA));
    light.addColorStop(0.4, rgba(hide.light, 0));
    light.addColorStop(0.62, rgba(hide.shadow, 0));
    light.addColorStop(1, rgba(hide.shadow, UNDER_SHADE_ALPHA));
    ctx.fillStyle = light;
    ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);

    ctx.lineCap = 'round';
    ctx.lineWidth = HAIR_WIDTH * (1 + look.shag);
    const width = bounds.maxX - bounds.minX;
    const height = bounds.maxY - bounds.minY;
    const hairLength = fill.hairLength * (1 + look.shag * 1.6);
    for (let i = 0; i < fill.hairCount; i++) {
      const px = bounds.minX + hash1(fill.seed + i * 1.37) * width;
      const py = bounds.minY + hash1(fill.seed + i * 2.71 + 5) * height;
      const angle = fill.hairAngle + (hash1(fill.seed + i * 4.1) - 0.5) * 0.6;
      const len = hairLength * (0.6 + 0.8 * hash1(fill.seed + i * 3.3));
      ctx.strokeStyle = rgba(i % 3 === 0 ? hide.light : hide.shadow, HAIR_ALPHA);
      ctx.beginPath();
      ctx.moveTo(px, py);
      const bend = look.shag * len * 0.4 * Math.sin(fill.seed + i);
      ctx.quadraticCurveTo(
        px + Math.cos(angle) * len * 0.5 - Math.sin(angle) * bend,
        py + Math.sin(angle) * len * 0.5 + Math.cos(angle) * bend,
        px + Math.cos(angle) * len,
        py + Math.sin(angle) * len,
      );
      ctx.stroke();
    }
  } finally {
    ctx.restore();
  }

  if (look.shag > 0 && fill.shagLength > 0) paintShag(ctx, look, fill, baseTone, bounds);
}

/** Length of a highland's locks off the barrel, for an adult. */
const BODY_SHAG = 0.1;
/** The barrel depth shag lengths are authored against. */
const ADULT_BODY_HALF_DEPTH = 0.31;
/** Length of the locks hanging off a highland's legs. */
const LEG_SHAG = 0.04;
/**
 * The far horn is drawn shorter and set back, so its tip shows behind the near
 * one: a single horn in profile reads as a unicorn's.
 */
const FAR_HORN_SHARE = 0.7;
const FAR_HORN_OFFSET: Pt = { x: -0.03, y: -0.008 };
/** How much every lock is pulled toward hanging straight down, at the least. */
const SHAG_HANG = 0.7;
const SHAG_LOCK_HALF_WIDTH = 0.014;
/** How much of a highland's belly shag is pressed flat when it lies down. */
const LYING_SHAG_FLATTEN = 0.75;
/** Locks laid along each edge of a part's outline. */
const SHAG_LOCKS_PER_EDGE = 3;

/**
 * Locks hanging off the silhouette. A highland's coat reads at distance as a
 * ragged outline, not as texture inside it, so the locks are drawn outside the
 * clip and mostly downward — a coat hangs, it does not bristle.
 */
function paintShag(ctx: Ctx, look: CowLook, fill: HideFill, tone: string, bounds: Box): void {
  const { outline } = fill;
  const cx = (bounds.minX + bounds.maxX) / 2;
  const cy = (bounds.minY + bounds.maxY) / 2;
  interface Lock {
    readonly left: Pt;
    readonly right: Pt;
    readonly bend: Pt;
    readonly tip: Pt;
    readonly light: boolean;
  }
  const locks: Lock[] = [];
  for (let i = 0; i < outline.length; i++) {
    const a = outline[i];
    const b = outline[(i + 1) % outline.length];
    for (let k = 0; k < SHAG_LOCKS_PER_EDGE; k++) {
      const t = (k + 0.5) / SHAG_LOCKS_PER_EDGE;
      const here = { x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t) };
      const out = Math.atan2(here.y - cy, here.x - cx);
      const noise = hash1(fill.seed + i * 7.3 + k * 1.9);
      // Pulled hard toward straight down: a coat hangs off the animal, and a
      // lock standing straight out of a flank reads as straw, not hair.
      const angle = lerp(out, HALF_PI, SHAG_HANG + (1 - SHAG_HANG) * Math.max(0, Math.sin(out)));
      const len = fill.shagLength * look.shag * (0.55 + 0.9 * noise);
      const root = add(here, fromAngle(out + Math.PI, len * 0.3));
      const across = fromAngle(angle + HALF_PI, SHAG_LOCK_HALF_WIDTH * (0.7 + 0.6 * noise));
      const tip = add(here, fromAngle(angle + (noise - 0.5) * 0.4, len));
      const bend = add(
        scalePt(add(root, tip), 0.5),
        fromAngle(angle + HALF_PI, len * 0.18 * (noise - 0.5)),
      );
      locks.push({
        left: add(root, across),
        right: add(root, scalePt(across, -1)),
        bend,
        tip,
        light: noise > 0.62,
      });
    }
  }
  const traceLock = (lock: Lock): void => {
    ctx.beginPath();
    ctx.moveTo(lock.left.x, lock.left.y);
    ctx.quadraticCurveTo(lock.bend.x, lock.bend.y, lock.tip.x, lock.tip.y);
    ctx.quadraticCurveTo(lock.bend.x, lock.bend.y, lock.right.x, lock.right.y);
    ctx.closePath();
  };
  ctx.save();
  try {
    ctx.lineJoin = 'round';
    // A thin dark edge on every lock, so the fringe keeps its shape against
    // grass of nearly the same value.
    ctx.strokeStyle = rgba(look.hide.ink, 0.5);
    ctx.lineWidth = SHAG_WIDTH;
    for (const lock of locks) {
      traceLock(lock);
      ctx.stroke();
    }
    for (const lock of locks) {
      traceLock(lock);
      ctx.fillStyle = lock.light ? mix(tone, look.hide.light, 0.35) : tone;
      ctx.fill();
    }
  } finally {
    ctx.restore();
  }
}

/** A soft crease: a fold in the hide, not a line drawn on it. */
function crease(ctx: Ctx, color: string, width: number, alpha: number, pts: readonly Pt[]): void {
  if (pts.length < 2) return;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  for (const [scale, a] of [
    [2.6, 0.25],
    [1.6, 0.45],
    [1, 1],
  ] as const) {
    ctx.strokeStyle = rgba(color, alpha * a);
    ctx.lineWidth = width * scale;
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    if (pts.length === 3) ctx.quadraticCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y);
    else for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.stroke();
  }
  ctx.restore();
}

export function drawGroundShadow(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  if (rx <= MIN_LENGTH || ry <= MIN_LENGTH) return;
  ctx.save();
  const GROUND_SHADOW_ALPHA = 0.28;
  ctx.fillStyle = rgba('#120d09', GROUND_SHADOW_ALPHA);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  ctx.fill();
  ctx.restore();
}

// ── Legs ─────────────────────────────────────────────────────────────────────

/**
 * A joint exactly straight has an undefined bend direction and snaps between the
 * two as the hoof crosses the threshold.
 */
const JOINT_LOCK_MARGIN = 0.002;

/**
 * Two-bone solve. `bend` is -1 to break the joint toward +X (a knee) and +1 to
 * break it toward -X (a hock) when the leg hangs straight down.
 */
function solveJoint(root: Pt, foot: Pt, upper: number, lower: number, bend: number): Pt {
  const dx = foot.x - root.x;
  const dy = foot.y - root.y;
  const reach = Math.min(Math.hypot(dx, dy), upper + lower - JOINT_LOCK_MARGIN);
  const dist = Math.max(MIN_LENGTH, reach);
  const base = Math.atan2(dy, dx);
  const cosA = (dist * dist + upper * upper - lower * lower) / (2 * dist * upper);
  const angle = Math.acos(Math.max(-1, Math.min(1, cosA)));
  return add(root, fromAngle(base + angle * bend, upper));
}

/** Knees break forward, hocks backward — the one leg error that is invisible standing still. */
const KNEE_BEND = -1;
const HOCK_BEND = 1;

interface LegShape {
  readonly outline: Pt[];
  readonly joint: Pt;
  readonly fetlock: Pt;
  readonly foot: Pt;
  readonly angle: number;
}

/**
 * One leg's silhouette from its root to the fetlock, as a single outline so the
 * ink runs round the whole limb without a seam at the knee.
 */
function legShape(
  b: CowBuild,
  root: Pt,
  foot: Pt,
  upper: number,
  lower: number,
  bend: number,
  rootWidthScale = 1,
): LegShape {
  const joint = solveJoint(root, foot, upper, lower, bend);
  const fetlock = add(foot, { x: 0, y: -b.hoofHeight });
  const nOf = (a: Pt, c: Pt): Pt => {
    const len = Math.max(MIN_LENGTH, Math.hypot(c.x - a.x, c.y - a.y));
    return { x: -(c.y - a.y) / len, y: (c.x - a.x) / len };
  };
  const n1 = nOf(root, joint);
  const n2 = nOf(joint, fetlock);
  const nj = scalePt(add(n1, n2), 0.5);
  const upperMid = scalePt(add(root, joint), 0.5);
  const w = b.legRootHalfWidth * rootWidthScale;
  const k = b.kneeHalfWidth;
  const c = b.cannonHalfWidth;
  const outline: Pt[] = [
    add(root, scalePt(n1, w)),
    add(upperMid, scalePt(n1, lerp(w, k, 0.55))),
    add(joint, scalePt(nj, k)),
    add(fetlock, scalePt(n2, c)),
    add(fetlock, { x: 0, y: c * 0.6 }),
    add(fetlock, scalePt(n2, -c)),
    add(joint, scalePt(nj, -k)),
    add(upperMid, scalePt(n1, -lerp(w, k, 0.55))),
    add(root, scalePt(n1, -w)),
    add(root, { x: 0, y: -w }),
  ];
  const angle = Math.atan2(fetlock.y - joint.y, fetlock.x - joint.x) - HALF_PI;
  return { outline, joint, fetlock, foot, angle };
}

/** The cloven hoof: a dark wedge with the cleft showing. */
function drawHoof(ctx: Ctx, look: CowLook, leg: LegShape, lift: number, shade: number): void {
  const b = look.build;
  const h = b.hoofHeight;
  const w = b.cannonHalfWidth * 1.25;
  ctx.save();
  try {
    ctx.translate(leg.fetlock.x, leg.fetlock.y);
    // A lifted hoof tips its toe down as it leaves the ground and swings.
    ctx.rotate(leg.angle * 0.6 + lift * deg(22));
    const pts: Pt[] = [
      { x: -w * 0.95, y: 0 },
      { x: w * 0.95, y: 0 },
      { x: w * 1.35, y: h },
      { x: -w * 1.05, y: h },
    ];
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.strokeStyle = rgba(look.hide.ink, INK_ALPHA);
    ctx.lineWidth = INK_WIDTH * 0.8;
    ctx.lineJoin = 'round';
    ctx.stroke();
    ctx.fillStyle = mix(look.hide.hoof, '#000000', shade * 0.4);
    ctx.fill();
    ctx.strokeStyle = rgba('#000000', 0.55);
    ctx.lineWidth = INK_WIDTH * 0.35;
    ctx.beginPath();
    ctx.moveTo(w * 0.25, h * 0.2);
    ctx.lineTo(w * 0.3, h);
    ctx.stroke();
    ctx.fillStyle = rgba('#ffffff', 0.18);
    ctx.fillRect(-w * 0.8, h * 0.1, w * 0.6, h * 0.25);
  } finally {
    ctx.restore();
  }
}

function paintLeg(
  ctx: Ctx,
  look: CowLook,
  view: CowView,
  leg: LegShape,
  part: 'foreleg' | 'hindleg',
  patches: readonly Patch[],
  shade: number,
  lift: number,
  seed: number,
  withInk: boolean,
  shagScale = 1,
): void {
  const { hide } = look;
  if (withInk) inkOutline(ctx, look, leg.outline);
  fillHide(ctx, look, {
    outline: leg.outline,
    patches,
    shade,
    hairAngle: HALF_PI,
    hairCount: 10,
    hairLength: 0.03,
    seed,
    shagLength: LEG_SHAG * shagScale,
    detail: (c) => {
      // Points from the knee down: graded in rather than cut, or the lower leg
      // reads as a sock pulled over the hoof.
      const band = c.createLinearGradient(0, leg.joint.y - 0.02, 0, leg.fetlock.y);
      band.addColorStop(0, rgba(hide.points, 0));
      band.addColorStop(0.35, rgba(hide.points, 0.85));
      band.addColorStop(1, rgba(hide.points, 1));
      c.fillStyle = band;
      const minX = Math.min(leg.joint.x, leg.fetlock.x) - 0.1;
      c.fillRect(minX, leg.joint.y - 0.02, 0.2 + Math.abs(leg.joint.x - leg.fetlock.x), 0.6);
    },
  });
  drawHoof(ctx, look, leg, lift, shade);
  look.decorations?.[part]?.(ctx, view, leg.outline, shade === 0);
}

// ── Tail ─────────────────────────────────────────────────────────────────────

const TAIL_ROOT_HALF_WIDTH = 0.017;
const TAIL_TIP_HALF_WIDTH = 0.008;
/** How far a hanging tail bows out behind the root, as a share of its length. */
const TAIL_HANG_BOW = 0.14;
/** The tail length widths are authored against. */
const ADULT_TAIL_LENGTH = 0.55;

/**
 * The tail: a thin rope hanging from the tail head to the hocks, ending in the
 * switch. `swing` is the tip's sideways offset as the screen sees it; `lift`
 * raises the rope toward horizontal behind the animal (`backward` is the
 * direction "behind" is on screen, and `depth` foreshortens it in a rear view).
 */
function drawTail(
  ctx: Ctx,
  look: CowLook,
  view: CowView,
  root: Pt,
  lift: number,
  swing: number,
  backward: Pt,
): void {
  const b = look.build;
  const len = b.tailLength;
  const hang: Pt = { x: 0, y: 1 };
  const up: Pt = { x: 0, y: -1 };
  const side: Pt = { x: swing * len * 0.35, y: -Math.abs(swing) * len * 0.05 };
  // A raised tail is a pump handle, not a rod: the root section lifts up and
  // back and the rest of the rope still droops from it. Hanging, the rope
  // follows the round of the buttock down to the hocks.
  const bulge = add(
    root,
    add(
      scalePt(add(scalePt(backward, 0.55), scalePt(up, 0.35)), len * lift),
      add(
        scalePt(hang, len * 0.5 * (1 - lift)),
        scalePt(backward, len * TAIL_HANG_BOW * (1 - lift)),
      ),
    ),
  );
  const tip = add(
    add(root, add(scalePt(backward, len * 0.62 * lift), scalePt(hang, len * (1 - 0.72 * lift)))),
    side,
  );

  const pts: Pt[] = [];
  const left: Pt[] = [];
  const right: Pt[] = [];
  const STEPS = 8;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const p: Pt = {
      x: (1 - t) * (1 - t) * root.x + 2 * (1 - t) * t * bulge.x + t * t * tip.x,
      y: (1 - t) * (1 - t) * root.y + 2 * (1 - t) * t * bulge.y + t * t * tip.y,
    };
    const q: Pt = {
      x: 2 * (1 - t) * (bulge.x - root.x) + 2 * t * (tip.x - bulge.x),
      y: 2 * (1 - t) * (bulge.y - root.y) + 2 * t * (tip.y - bulge.y),
    };
    const qn = Math.max(MIN_LENGTH, Math.hypot(q.x, q.y));
    const n: Pt = { x: -q.y / qn, y: q.x / qn };
    const w =
      lerp(TAIL_ROOT_HALF_WIDTH, TAIL_TIP_HALF_WIDTH, t) *
      Math.sqrt(b.tailLength / ADULT_TAIL_LENGTH);
    left.push(add(p, scalePt(n, w)));
    right.push(add(p, scalePt(n, -w)));
  }
  pts.push(...left, ...right.reverse());
  inkOutline(ctx, look, pts);
  traceSmooth(ctx, pts);
  ctx.fillStyle = mix(look.hide.base, look.hide.shadow, 0.25);
  ctx.fill();

  const switchDir = Math.atan2(tip.y - bulge.y, tip.x - bulge.x);
  const tuft = ovalPoints(
    tip.x + Math.cos(switchDir) * b.switchLength * 0.35,
    tip.y + Math.sin(switchDir) * b.switchLength * 0.35,
    b.switchLength * 0.55,
    b.switchLength * 0.3,
    switchDir,
    0.12,
    3.1,
    18,
  );
  inkOutline(ctx, look, tuft);
  traceSmooth(ctx, tuft);
  ctx.fillStyle = look.hide.tailSwitch;
  ctx.fill();
  ctx.save();
  ctx.strokeStyle = rgba(look.hide.shadow, 0.5);
  ctx.lineWidth = HAIR_WIDTH;
  for (let i = 0; i < 4; i++) {
    const off = (i - 1.5) * b.switchLength * 0.12;
    const start = add(tip, fromAngle(switchDir + HALF_PI, off));
    const end = add(start, fromAngle(switchDir, b.switchLength * 0.8));
    ctx.beginPath();
    ctx.moveTo(start.x, start.y);
    ctx.lineTo(end.x, end.y);
    ctx.stroke();
  }
  ctx.restore();
  look.decorations?.tail?.(ctx, view, pts, true);
}

// ── Head parts ───────────────────────────────────────────────────────────────

/** A patched coat's ears are the patch colour: a Holstein's black ears are what frame its face. */
function earColor(hide: CowHide): string {
  return hide.patch ?? hide.face ?? hide.base;
}

/**
 * An ear, drawn in the space it hangs in. `angle` is where it points; `length`
 * is its visible length after foreshortening. The inner face is shown only
 * where the ear is turned toward the camera.
 */
function drawEar(
  ctx: Ctx,
  look: CowLook,
  base: Pt,
  angle: number,
  length: number,
  inner: number,
  shade: number,
): void {
  const b = look.build;
  if (length <= MIN_LENGTH) return;
  const outline = ovalPoints(length * 0.5, 0, length * 0.55, b.earHalfWidth, 0, 0.06, 1.3, 18);
  // The leaf narrows to its root, where it meets the poll.
  const leaf = outline.map((p) => ({ x: p.x, y: p.y * (0.45 + 0.55 * clamp01(p.x / length)) }));
  ctx.save();
  try {
    ctx.translate(base.x, base.y);
    ctx.rotate(angle);
    inkOutline(ctx, look, leaf);
    traceSmooth(ctx, leaf);
    ctx.fillStyle = mix(earColor(look.hide), look.hide.shadow, shade);
    ctx.fill();
    if (inner > 0) {
      const inside = ovalPoints(length * 0.55, 0, length * 0.36, b.earHalfWidth * 0.5, 0, 0, 0, 14);
      traceSmooth(ctx, inside);
      ctx.fillStyle = rgba(look.hide.earInner, clamp01(inner) * 0.85);
      ctx.fill();
    }
    if (look.shag > 0) {
      ctx.strokeStyle = rgba(look.hide.light, 0.6 * look.shag);
      ctx.lineWidth = SHAG_WIDTH;
      ctx.lineCap = 'round';
      for (let i = 0; i < 3; i++) {
        const x = length * (0.45 + i * 0.2);
        ctx.beginPath();
        ctx.moveTo(x, b.earHalfWidth * 0.6);
        ctx.lineTo(x + 0.01, b.earHalfWidth * 1.4);
        ctx.stroke();
      }
    }
  } finally {
    ctx.restore();
  }
}

/** A crack's stroke, as a share of the horn's own ink outline. */
const HORN_CRACK_INK_SHARE = 0.55;
/**
 * How far a crack's midpoint is skewed up the horn, as a share of the horn's
 * length, and how far back its far end returns: the zigzag that makes it a
 * split rather than a ring.
 */
const HORN_CRACK_SKEW = 0.06;
const HORN_CRACK_BACK_SKEW = 0.5;

/**
 * One horn as a tapered curve from `base`. `dir` is the direction it grows out
 * in, `curl` the direction its tip turns toward.
 */
function drawHorn(
  ctx: Ctx,
  look: CowLook,
  horns: HornSpec,
  base: Pt,
  dir: Pt,
  curl: Pt,
  length: number,
): void {
  if (length <= MIN_LENGTH) return;
  const bend = horns.shape === 'upswept' ? 0.75 : 0.45;
  const mid = add(base, scalePt(dir, length * 0.55));
  const tip = add(add(base, scalePt(dir, length * (1 - bend * 0.4))), scalePt(curl, length * bend));
  const left: Pt[] = [];
  const right: Pt[] = [];
  const STEPS = 6;
  for (let i = 0; i <= STEPS; i++) {
    const t = i / STEPS;
    const p: Pt = {
      x: (1 - t) * (1 - t) * base.x + 2 * (1 - t) * t * mid.x + t * t * tip.x,
      y: (1 - t) * (1 - t) * base.y + 2 * (1 - t) * t * mid.y + t * t * tip.y,
    };
    const q: Pt = {
      x: 2 * (1 - t) * (mid.x - base.x) + 2 * t * (tip.x - mid.x),
      y: 2 * (1 - t) * (mid.y - base.y) + 2 * t * (tip.y - mid.y),
    };
    const qn = Math.max(MIN_LENGTH, Math.hypot(q.x, q.y));
    const n: Pt = { x: -q.y / qn, y: q.x / qn };
    const w = horns.baseHalfWidth * (1 - t * 0.85);
    left.push(add(p, scalePt(n, w)));
    right.push(add(p, scalePt(n, -w)));
  }
  const outline = [...left, ...right.reverse()];
  ctx.save();
  try {
    ctx.beginPath();
    ctx.moveTo(outline[0].x, outline[0].y);
    for (const p of outline.slice(1)) ctx.lineTo(p.x, p.y);
    ctx.closePath();
    ctx.strokeStyle = rgba(look.hide.ink, INK_ALPHA);
    ctx.lineWidth = INK_WIDTH * 0.8;
    ctx.lineJoin = 'round';
    ctx.stroke();
    const grad = ctx.createLinearGradient(base.x, base.y, tip.x, tip.y);
    grad.addColorStop(0, look.hide.horn);
    grad.addColorStop(0.65, look.hide.horn);
    grad.addColorStop(1, look.hide.hornTip);
    ctx.fillStyle = grad;
    ctx.fill();
    const cracks = horns.cracks ?? 0;
    if (cracks > 0) {
      // Each crack is a short zigzag across the horn, skewed along it, so it
      // reads as a split in the horn rather than as a ring painted round it.
      ctx.strokeStyle = rgba(look.hide.ink, INK_ALPHA);
      ctx.lineWidth = INK_WIDTH * HORN_CRACK_INK_SHARE;
      ctx.lineCap = 'round';
      for (let c = 1; c <= cracks; c++) {
        const i = Math.min(STEPS, Math.round((c / (cracks + 1)) * STEPS));
        const a = left[i];
        const b = outline[outline.length - 1 - i];
        const along = {
          x: (tip.x - base.x) * HORN_CRACK_SKEW,
          y: (tip.y - base.y) * HORN_CRACK_SKEW,
        };
        const middle = { x: (a.x + b.x) / 2 + along.x, y: (a.y + b.y) / 2 + along.y };
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(middle.x, middle.y);
        ctx.lineTo(b.x - along.x * HORN_CRACK_BACK_SKEW, b.y - along.y * HORN_CRACK_BACK_SKEW);
        ctx.stroke();
      }
    }
  } finally {
    ctx.restore();
  }
}

/** A cow's eye: dark, round, with a glint and a lid that shuts into a content curve. */
function drawEye(ctx: Ctx, look: CowLook, x: number, y: number, r: number, open: number): void {
  const { hide } = look;
  const openness = clamp01(open);
  if (hide.eyeRing !== null) {
    ctx.fillStyle = hide.eyeRing;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 1.9, r * 1.6, 0, 0, TWO_PI);
    ctx.fill();
  }
  if (openness < 0.25) {
    // Shut: a curve bowed upward, the "happy squint" rather than a flat line.
    ctx.strokeStyle = rgba(hide.ink, 0.95);
    ctx.lineWidth = r * 0.7;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(x - r * 1.1, y + r * 0.2);
    ctx.quadraticCurveTo(x, y - r * 0.9, x + r * 1.1, y + r * 0.2);
    ctx.stroke();
    return;
  }
  ctx.fillStyle = hide.eye;
  ctx.beginPath();
  ctx.ellipse(x, y, r, r * openness, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = rgba('#fff8ec', 0.9 * openness);
  ctx.beginPath();
  ctx.arc(x - r * 0.35, y - r * 0.35 * openness, r * 0.32, 0, TWO_PI);
  ctx.fill();
  // The upper lid, heavy and drooped: a cow's eye is never fully round open.
  ctx.strokeStyle = rgba(hide.ink, 0.85);
  ctx.lineWidth = r * 0.45;
  ctx.beginPath();
  ctx.ellipse(x, y, r * 1.05, r * 1.05 * openness, 0, Math.PI * 1.05, Math.PI * 1.95);
  ctx.stroke();
}

/** A shaggy fringe hanging from the poll over the eyes. */
function drawForelock(
  ctx: Ctx,
  look: CowLook,
  from: Pt,
  to: Pt,
  hang: Pt,
  length: number,
  seed: number,
): void {
  if (look.forelock <= 0) return;
  ctx.save();
  ctx.lineCap = 'round';
  const LOCKS = 11;
  const strands: Array<{ start: Pt; end: Pt; sway: number; light: boolean }> = [];
  for (let i = 0; i < LOCKS; i++) {
    const t = i / (LOCKS - 1);
    const start = { x: lerp(from.x, to.x, t), y: lerp(from.y, to.y, t) };
    const len = length * look.forelock * (0.7 + 0.5 * hash1(seed + i * 2.2));
    const sway = (hash1(seed + i * 5.9) - 0.5) * 0.5;
    const end = add(start, add(scalePt(hang, len), { x: sway * len * 0.3, y: sway * len * 0.3 }));
    strands.push({ start, end, sway, light: i % 2 === 0 });
  }
  for (const pass of [0, 1]) {
    ctx.lineWidth = SHAG_WIDTH * (pass === 0 ? 2.8 : 1.6);
    for (const strand of strands) {
      ctx.strokeStyle =
        pass === 0
          ? rgba(look.hide.ink, 0.5)
          : strand.light
            ? mix(look.hide.base, look.hide.light, 0.4)
            : look.hide.base;
      ctx.beginPath();
      ctx.moveTo(strand.start.x, strand.start.y);
      ctx.quadraticCurveTo(
        strand.start.x + strand.sway * 0.03,
        (strand.start.y + strand.end.y) / 2,
        strand.end.x,
        strand.end.y,
      );
      ctx.stroke();
    }
  }
  ctx.restore();
}

// ── Head, in profile ─────────────────────────────────────────────────────────

/**
 * The profile head, in its own space: origin at the poll, +X down the face
 * toward the muzzle, +Y toward the throat.
 *
 * The muzzle is kept blunt and square. A long head tapering to a rounded point
 * is a bill whatever animal was meant, and at sprite size no interior detail
 * argues a viewer out of a silhouette.
 */
function headSideOutline(b: CowBuild, jaw: number): Pt[] {
  const L = b.headLength;
  const D = b.headDepth;
  const drop = jaw * D * 0.14;
  return [
    { x: -0.06 * L, y: -0.3 * D },
    { x: 0.06 * L, y: -0.52 * D },
    { x: 0.45 * L, y: -0.5 * D },
    { x: 0.82 * L, y: -0.46 * D },
    { x: 1.0 * L, y: -0.42 * D },
    { x: 1.08 * L, y: -0.22 * D },
    { x: 1.09 * L, y: 0.06 * D },
    { x: 1.04 * L, y: 0.3 * D + drop * 0.5 },
    { x: 0.9 * L, y: 0.42 * D + drop },
    { x: 0.62 * L, y: 0.44 * D + drop * 0.6 },
    { x: 0.34 * L, y: 0.56 * D },
    { x: 0.12 * L, y: 0.52 * D },
    { x: -0.04 * L, y: 0.26 * D },
  ];
}

interface HeadFrame {
  /** The poll, in the space the head is drawn into. */
  readonly poll: Pt;
  /** Radians of the face axis from +X. */
  readonly angle: number;
}

function headSideLocalToOuter(frame: HeadFrame, p: Pt): Pt {
  return add(frame.poll, rotatePt(p, frame.angle));
}

function drawHeadSide(ctx: Ctx, look: CowLook, pose: CowPose, frame: HeadFrame): void {
  const { build: b, hide } = look;
  const L = b.headLength;
  const D = b.headDepth;
  const marks = markingsOf(look);
  const earBase = headSideLocalToOuter(frame, { x: 0.12 * L, y: -0.18 * D });
  const earOf = (value: number, far: boolean): number => {
    // Out sideways a profile ear points back and a little down; perked it swings
    // up and forward; pinned it lies flat back along the neck.
    const rest = deg(166);
    const perked = deg(290);
    const pinned = deg(196);
    const a = value >= 0 ? lerp(rest, perked, value) : lerp(rest, pinned, -value);
    return a + (far ? deg(-10) : 0);
  };
  const earLengthOf = (value: number): number =>
    b.earLength * (value >= 0 ? lerp(1, 0.8, value) : lerp(1, 0.75, -value));

  // Far ear and far horn go behind the skull.
  drawEar(
    ctx,
    look,
    add(earBase, { x: 0.01, y: -0.012 }),
    earOf(pose.earR, true),
    earLengthOf(pose.earR),
    0,
    0.35,
  );
  const horns = look.horns;
  const hornBase = headSideLocalToOuter(frame, { x: 0.05 * L, y: -0.46 * D });
  const hornDir = horns?.shape === 'upswept' ? { x: 0.88, y: -0.48 } : { x: 0.1, y: -1 };
  const hornCurl = horns?.shape === 'upswept' ? { x: 0.05, y: -1 } : { x: 0.9, y: -0.2 };
  if (horns !== null) {
    drawHorn(
      ctx,
      look,
      horns,
      add(hornBase, FAR_HORN_OFFSET),
      hornDir,
      hornCurl,
      horns.length * FAR_HORN_SHARE,
    );
  }

  ctx.save();
  try {
    ctx.translate(frame.poll.x, frame.poll.y);
    ctx.rotate(frame.angle);
    const outline = headSideOutline(b, pose.jaw);
    inkOutline(ctx, look, outline);
    fillHide(ctx, look, {
      outline,
      patches: marks.headSide,
      shade: 0,
      hairAngle: 0,
      hairCount: 8,
      hairLength: 0.025,
      seed: 311,
      shagLength: 0.03,
      detail: (c) => {
        // The muzzle: broad, square and wet, set off from the face.
        const muzzle = ovalPoints(1.01 * L, -0.04 * D, 0.2 * L, 0.52 * D, 0, 0.03, 4.2, 20);
        if (hide.muzzleRing !== null) {
          traceSmooth(c, ovalPoints(0.94 * L, -0.04 * D, 0.26 * L, 0.6 * D, 0, 0.03, 4.2, 20));
          c.fillStyle = hide.muzzleRing;
          c.fill();
        }
        traceSmooth(c, muzzle);
        c.fillStyle = hide.muzzle;
        c.fill();
        c.fillStyle = rgba('#ffffff', 0.22);
        c.beginPath();
        c.ellipse(1.0 * L, -0.24 * D, 0.07 * L, 0.08 * D, 0, 0, TWO_PI);
        c.fill();
        // Nostril: a comma opening forward.
        c.fillStyle = hide.nostril;
        c.beginPath();
        c.ellipse(0.98 * L, -0.1 * D, 0.045 * L, 0.1 * D, deg(-25), 0, TWO_PI);
        c.fill();
        // Mouth line along the lower edge of the muzzle.
        c.strokeStyle = rgba(hide.ink, 0.8);
        c.lineWidth = INK_WIDTH * 0.4;
        c.beginPath();
        c.moveTo(1.02 * L, 0.18 * D);
        c.quadraticCurveTo(0.9 * L, 0.24 * D + pose.jaw * D * 0.1, 0.76 * L, 0.26 * D);
        c.stroke();
        // Cheek muscle: the jowl's roundness is what makes the head heavy.
        crease(c, hide.shadow, 0.006, 0.4, [
          { x: 0.22 * L, y: 0.46 * D },
          { x: 0.36 * L, y: 0.12 * D },
          { x: 0.62 * L, y: 0.3 * D },
        ]);
      },
    });
    drawEye(ctx, look, 0.3 * L, -0.24 * D, b.eyeRadius, pose.eyeOpen);
    drawForelock(
      ctx,
      look,
      { x: -0.02 * L, y: -0.5 * D },
      { x: 0.42 * L, y: -0.56 * D },
      // Hair hangs by gravity, whatever angle the head is carried at.
      rotatePt({ x: 0, y: 1 }, -frame.angle),
      D * 0.7,
      17,
    );
    look.decorations?.head?.(ctx, 'side', outline, true);
  } finally {
    ctx.restore();
  }

  drawEar(ctx, look, earBase, earOf(pose.earL, false), earLengthOf(pose.earL), 0.4, 0);
  if (horns !== null) drawHorn(ctx, look, horns, hornBase, hornDir, hornCurl, horns.length);
}

// ── Profile view ─────────────────────────────────────────────────────────────

/**
 * How far the far pair of legs sits behind the near pair. Too little and the far
 * pair hides entirely and the animal stands on two legs.
 */
const SIDE_FAR_OFFSET: Pt = { x: -0.045, y: -0.022 };
const FAR_SIDE_SHADE = 0.42;
/** Past this far down on its knees, a lying cow's folded foreleg shows in front of its chest. */
const FOLDED_KNEE_SHOWS = 0.5;
/** Half the side of a clip rectangle that is sure to hold the whole cell, in tiles. */
const CLIP_REACH = 4;
/** How far down the hindquarters are before the udder is hidden under the animal. */
const UDDER_HIDDEN_WHEN_LOWERED = 0.6;
/** The gaskin is the heaviest muscle on the leg; a hind leg as thin as a foreleg is a deer's. */
const GASKIN_WIDTH_SCALE = 1.55;
const BREATHE_DEPTH = 0.006;
const LIE_PITCH = deg(9);

interface BodyFrame {
  readonly centre: Pt;
  readonly offset: Pt;
  readonly angle: number;
}

function bodyFrameOf(b: CowBuild, pose: CowPose): BodyFrame {
  const drop = b.lieDrop * (pose.lowerFore + pose.lowerHind) * 0.5;
  return {
    centre: { x: b.bodyCx, y: b.bodyCy },
    offset: { x: pose.lunge, y: pose.bob + drop + pose.breathe * BREATHE_DEPTH },
    angle: pose.pitch + (pose.lowerFore - pose.lowerHind) * LIE_PITCH,
  };
}

function bodyToWorld(frame: BodyFrame, p: Pt): Pt {
  const rel = { x: p.x - frame.centre.x, y: p.y - frame.centre.y };
  return add(add(frame.centre, rotatePt(rel, frame.angle)), frame.offset);
}

/** Neck root, neck tip (the poll) and the face angle, in body space. */
interface NeckHead {
  readonly root: Pt;
  readonly tip: Pt;
  readonly angle: number;
  readonly headAngle: number;
}

function neckHeadOf(b: CowBuild, pose: CowPose): NeckHead {
  const angle = b.neckRestAngle + pose.neck;
  const tip = add(b.neckRoot, fromAngle(angle, b.neckLength));
  return {
    root: b.neckRoot,
    tip,
    angle,
    headAngle: b.headRestAngle + pose.headPitch + pose.neck * 0.5,
  };
}

function neckOutline(b: CowBuild, nh: NeckHead): Pt[] {
  const dir = fromAngle(nh.angle, 1);
  const n: Pt = { x: -dir.y, y: dir.x };
  const at = (t: number, side: number, extra = 0): Pt => {
    const p = add(nh.root, scalePt(dir, b.neckLength * t));
    const w = lerp(b.neckRootHalfWidth, b.neckTipHalfWidth, t) + extra;
    return add(p, scalePt(n, w * side));
  };
  // The dewlap: the loose fold under the throat that hangs lowest at the brisket.
  const sag = (t: number): Pt => ({ x: 0, y: b.dewlapDrop * Math.sin(t * Math.PI) * 0.9 });
  return [
    at(0, -1),
    at(0.5, -1),
    at(1, -1, 0.01),
    at(1.08, -0.2),
    at(1, 1),
    add(at(0.7, 1), sag(0.3)),
    add(at(0.4, 1), sag(0.6)),
    add(at(0.1, 1), sag(0.85)),
    at(-0.05, 1),
  ];
}

function footWorld(
  b: CowBuild,
  frame: BodyFrame,
  root: Pt,
  restX: number,
  foot: CowFootPose,
  lower: number,
  fold: Pt,
): Pt {
  const standing: Pt = { x: restX + foot.dx + frame.offset.x, y: GROUND_Y + foot.dy };
  const rootWorld = bodyToWorld(frame, root);
  const folded = add(rootWorld, fold);
  // Folded or not, a tucked hoof rests on the ground under the animal.
  const tucked: Pt = { x: folded.x, y: GROUND_Y - b.hoofHeight * 0.3 };
  return {
    x: lerp(standing.x, tucked.x, clamp01(lower)),
    y: lerp(standing.y, tucked.y, clamp01(lower)),
  };
}

/**
 * Folded under a lying cow the fore cannon tucks back beneath the chest with the
 * knee out in front of the brisket, and the hind hoof comes forward under the
 * belly with the hock behind it.
 */
function foldsOf(b: CowBuild): { fore: Pt; hind: Pt } {
  return { fore: { x: -b.foreLower * 0.5, y: 0 }, hind: { x: b.hindLower * 0.9, y: 0 } };
}

export type CowFootName = 'frontL' | 'frontR' | 'hindL' | 'hindR';

/** One profile leg as a pose places it: its pivot, its hoof, and how far it can reach. */
export interface CowSideLeg {
  readonly foot: CowFootName;
  readonly root: Pt;
  readonly hoof: Pt;
  /** Upper plus lower segment: the furthest the hoof can be from the pivot. */
  readonly length: number;
}

/**
 * Where a pose puts each profile leg's pivot and hoof, in tile units, through the
 * same body frame (bob, breathing, pitch, lying) the painter draws with. A hoof
 * further from its pivot than the leg is long is drawn with a stretched cannon,
 * so choreography and gates measure reach through this.
 */
export function cowSideLegs(pose: CowPose, b: CowBuild): readonly CowSideLeg[] {
  const frame = bodyFrameOf(b, pose);
  const folds = foldsOf(b);
  const legOf = (foot: CowFootName): CowSideLeg => {
    const isFore = foot === 'frontL' || foot === 'frontR';
    const rootBody = isFore ? b.foreRoot : b.hindRoot;
    const hoof = footWorld(
      b,
      frame,
      rootBody,
      isFore ? b.foreFootX : b.hindFootX,
      pose[foot],
      isFore ? pose.lowerFore : pose.lowerHind,
      isFore ? folds.fore : folds.hind,
    );
    return {
      foot,
      root: bodyToWorld(frame, rootBody),
      hoof,
      length: isFore ? b.foreUpper + b.foreLower : b.hindUpper + b.hindLower,
    };
  };
  return [legOf('frontL'), legOf('frontR'), legOf('hindL'), legOf('hindR')];
}

function drawCowSide(ctx: Ctx, pose: CowPose, look: CowLook): void {
  const b = look.build;
  const marks = markingsOf(look);
  const frame = bodyFrameOf(b, pose);
  const lying = (pose.lowerFore + pose.lowerHind) * 0.5;
  const airborne = Math.max(0, -pose.bob);
  const shadowScale = 1 / (1 + airborne * 4);
  drawGroundShadow(
    ctx,
    b.bodyCx + frame.offset.x + 0.02,
    GROUND_Y + 0.015,
    (b.bodyHalfLength * 1.15 + lying * 0.1) * shadowScale,
    0.07 * shadowScale,
  );

  const { fore: foreFold, hind: hindFold } = foldsOf(b);
  const legFor = (which: 'fore' | 'hind', foot: CowFootPose, far: boolean): LegShape => {
    const isFore = which === 'fore';
    const offset = far ? SIDE_FAR_OFFSET : { x: 0, y: 0 };
    const rootBody = isFore ? b.foreRoot : b.hindRoot;
    const lower = isFore ? pose.lowerFore : pose.lowerHind;
    const foot3 = footWorld(
      b,
      frame,
      rootBody,
      isFore ? b.foreFootX : b.hindFootX,
      foot,
      lower,
      isFore ? foreFold : hindFold,
    );
    return legShape(
      b,
      add(bodyToWorld(frame, rootBody), offset),
      add(foot3, offset),
      isFore ? b.foreUpper : b.hindUpper,
      isFore ? b.foreLower : b.hindLower,
      isFore ? KNEE_BEND : HOCK_BEND,
      isFore ? 1 : GASKIN_WIDTH_SCALE,
    );
  };

  // Far legs: the animal's right side, behind everything.
  const farHind = legFor('hind', pose.hindR, true);
  const farFore = legFor('fore', pose.frontR, true);
  // A lying animal's coat is pressed flat under it rather than hanging.
  const restingShag = 1 - lying * LYING_SHAG_FLATTEN;
  paintLeg(
    ctx,
    look,
    'side',
    farHind,
    'hindleg',
    none(),
    FAR_SIDE_SHADE,
    pose.hindR.lift,
    51,
    true,
    restingShag,
  );
  paintLeg(
    ctx,
    look,
    'side',
    farFore,
    'foreleg',
    none(),
    FAR_SIDE_SHADE,
    pose.frontR.lift,
    53,
    true,
    restingShag,
  );

  const nearHind = legFor('hind', pose.hindL, false);
  const nearFore = legFor('fore', pose.frontL, false);
  const nh = neckHeadOf(b, pose);
  const neck = neckOutline(b, nh);
  const barrel = barrelOutline(b);
  // Lying down, the udder is under the animal and out of sight.
  const udderShowing = b.udderRadius > 0 && pose.lowerHind < UDDER_HIDDEN_WHEN_LOWERED;
  const udder = udderShowing ? udderOutline(b) : null;
  const inBodySpace = (paint: () => void): void => {
    ctx.save();
    try {
      ctx.translate(frame.centre.x + frame.offset.x, frame.centre.y + frame.offset.y);
      ctx.rotate(frame.angle);
      ctx.translate(-frame.centre.x, -frame.centre.y);
      paint();
    } finally {
      ctx.restore();
    }
  };

  // One ink pass under the whole group, then the fills back to front. The near
  // legs are filled *under* the barrel: its fill buries their roots and their
  // fills bury its ink where they leave the belly, so the legs grow out of the
  // body instead of sitting on it, and the group shares one outer contour.
  const thigh = thighOutline(b);
  inBodySpace(() => {
    inkOutline(ctx, look, neck);
    inkOutline(ctx, look, thigh);
    inkOutline(ctx, look, barrel);
    if (udder !== null) inkOutline(ctx, look, udder);
  });
  inkOutline(ctx, look, nearHind.outline);
  inkOutline(ctx, look, nearFore.outline);

  if (udder !== null) inBodySpace(() => paintUdder(ctx, look, udder));
  paintLeg(
    ctx,
    look,
    'side',
    nearHind,
    'hindleg',
    marks.hindUpper.map((p) => legPatch(p, nearHind)),
    0,
    pose.hindL.lift,
    57,
    false,
    restingShag,
  );
  paintLeg(
    ctx,
    look,
    'side',
    nearFore,
    'foreleg',
    marks.foreUpper.map((p) => legPatch(p, nearFore)),
    0,
    pose.frontL.lift,
    59,
    false,
    restingShag,
  );
  inBodySpace(() => {
    fillHide(ctx, look, {
      outline: thigh,
      patches: marks.body,
      shade: 0,
      hairAngle: HALF_PI,
      hairCount: 10,
      hairLength: 0.03,
      seed: 67,
      shagLength: BODY_SHAG * 0.9 * restingShag,
    });
    paintNeck(ctx, look, neck, nh, marks.neck);
    look.decorations?.neck?.(ctx, 'side', neck, true);
    paintBarrel(ctx, look, barrel, marks.body, restingShag);
    look.decorations?.body?.(ctx, 'side', barrel, true);
  });

  if (pose.lowerFore > FOLDED_KNEE_SHOWS) {
    // Folded under a lying cow, the near foreleg's knee and cannon lie in front
    // of the brisket, not inside it. Repainted over the barrel but clipped to
    // outside it, so the fold shows without the forearm cutting across the chest.
    ctx.save();
    try {
      ctx.translate(frame.centre.x + frame.offset.x, frame.centre.y + frame.offset.y);
      ctx.rotate(frame.angle);
      ctx.translate(-frame.centre.x, -frame.centre.y);
      ctx.beginPath();
      ctx.rect(b.bodyCx - CLIP_REACH, b.bodyCy - CLIP_REACH, CLIP_REACH * 2, CLIP_REACH * 2);
      appendSmooth(ctx, barrel);
      ctx.clip('evenodd');
      ctx.translate(frame.centre.x, frame.centre.y);
      ctx.rotate(-frame.angle);
      ctx.translate(-frame.centre.x - frame.offset.x, -frame.centre.y - frame.offset.y);
      paintLeg(ctx, look, 'side', nearFore, 'foreleg', none(), 0, 0, 59, true, restingShag);
    } finally {
      ctx.restore();
    }
  }

  const tailRoot = bodyToWorld(frame, barrelPoint(b, b.tailRoot));
  drawTail(
    ctx,
    look,
    'side',
    tailRoot,
    pose.tailLift,
    pose.tailSwing * 0.3,
    rotatePt({ x: -1, y: 0 }, frame.angle),
  );

  const poll = bodyToWorld(frame, nh.tip);
  drawHeadSide(ctx, look, pose, { poll, angle: nh.headAngle + frame.angle });
}

function none(): readonly Patch[] {
  return [];
}

/** A patch authored in an upper leg's space, placed onto the leg as it stands this frame. */
function legPatch(p: Patch, leg: LegShape): Patch {
  const root = leg.outline[0];
  const other = leg.outline[leg.outline.length - 2];
  const top = scalePt(add(root, other), 0.5);
  const down = Math.atan2(leg.joint.y - top.y, leg.joint.x - top.x) - HALF_PI;
  const at = add(top, rotatePt({ x: p.x, y: p.y }, down));
  return { ...p, x: at.x, y: at.y, rot: p.rot + down };
}

/**
 * The thigh: the heavy muscle between the stifle and the pin bone, bulging
 * below and behind the barrel and tapering into the gaskin. Without it the hind
 * leg plugs into the bottom of a box like a table leg.
 */
function thighOutline(b: CowBuild): Pt[] {
  const centre = barrelPoint(b, { x: -0.9, y: 0.36 });
  return ovalPoints(
    centre.x,
    centre.y,
    b.bodyHalfLength * 0.3,
    b.bodyHalfDepth * 0.56,
    deg(-18),
    0.03,
    4.4,
    24,
  );
}

function barrelDetail(ctx: Ctx, look: CowLook): void {
  const b = look.build;
  const { hide } = look;
  // Hook and pin bones catch the light: a cow's rump is angular, and these two
  // highlights are what make it so at tile size.
  const hook = barrelPoint(b, HOOK_BONE);
  const pin = barrelPoint(b, PIN_BONE);
  ctx.fillStyle = rgba(hide.light, 0.35);
  ctx.beginPath();
  ctx.ellipse(hook.x, hook.y + 0.02, 0.05 * b.bodyHalfLength * 1.8, 0.03, 0, 0, TWO_PI);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(pin.x + 0.01, pin.y + 0.02, 0.03, 0.022, 0, 0, TWO_PI);
  ctx.fill();
  // The masses a barrel is built from: the shoulder and the round of the
  // thigh catch the light, the flank between them falls into shade. Soft, so
  // they read as form rather than as seams drawn across a flat body.
  const shoulder = barrelPoint(b, { x: 0.55, y: -0.2 });
  const thigh = barrelPoint(b, { x: -0.88, y: -0.1 });
  const flank = barrelPoint(b, { x: -0.52, y: 0.3 });
  fillSoftEllipse(
    ctx,
    shoulder.x,
    shoulder.y,
    b.bodyHalfLength * 0.3,
    b.bodyHalfDepth * 0.7,
    hide.light,
    0.3,
    deg(20),
  );
  fillSoftEllipse(
    ctx,
    thigh.x,
    thigh.y,
    b.bodyHalfLength * 0.3,
    b.bodyHalfDepth * 0.7,
    hide.light,
    0.3,
    deg(-15),
  );
  fillSoftEllipse(
    ctx,
    flank.x,
    flank.y,
    b.bodyHalfLength * 0.16,
    b.bodyHalfDepth * 0.6,
    hide.shadow,
    0.35,
    deg(10),
  );
  // A soft shadow down the belly: the barrel is round, not a cut-out.
  if (hide.belly !== null) {
    const belly = ovalPoints(
      b.bodyCx + b.bodyHalfLength * 0.1,
      b.bodyCy + b.bodyHalfDepth * 0.9,
      b.bodyHalfLength * 0.7,
      b.bodyHalfDepth * 0.28,
      0,
      0.05,
      1.2,
    );
    ctx.globalAlpha *= 0.7;
    traceSmooth(ctx, belly);
    ctx.fillStyle = hide.belly;
    ctx.fill();
    ctx.globalAlpha /= 0.7;
  }
}

function paintBarrel(
  ctx: Ctx,
  look: CowLook,
  barrel: readonly Pt[],
  patches: readonly Patch[],
  shagScale = 1,
): void {
  const b = look.build;
  fillHide(ctx, look, {
    outline: barrel,
    patches,
    shade: 0,
    hairAngle: HALF_PI * 0.8,
    hairCount: 44,
    hairLength: 0.03,
    seed: 71,
    shagLength: BODY_SHAG * (b.bodyHalfDepth / ADULT_BODY_HALF_DEPTH) * shagScale,
    detail: (c) => barrelDetail(c, look),
  });
}

function paintNeck(
  ctx: Ctx,
  look: CowLook,
  neck: readonly Pt[],
  nh: NeckHead,
  patches: readonly Patch[],
): void {
  const localToBody = (p: Patch): Patch => {
    const at = add(nh.root, rotatePt({ x: p.x, y: p.y }, nh.angle));
    return { ...p, x: at.x, y: at.y, rot: p.rot + nh.angle };
  };
  fillHide(ctx, look, {
    outline: neck,
    patches: patches.map(localToBody),
    shade: 0,
    hairAngle: nh.angle + Math.PI * 0.6,
    hairCount: 16,
    hairLength: 0.03,
    seed: 61,
    shagLength: BODY_SHAG,
    detail: (c) => {
      const b = look.build;
      const tip = nh.tip;
      // Throat shadow under the jaw: the head sits in front of the neck.
      c.fillStyle = rgba(look.hide.shadow, 0.35);
      c.beginPath();
      c.ellipse(
        tip.x,
        tip.y + b.neckTipHalfWidth * 0.6,
        b.neckTipHalfWidth * 1.1,
        b.neckTipHalfWidth * 0.8,
        nh.angle,
        0,
        TWO_PI,
      );
      c.fill();
    },
  });
}

function udderOutline(b: CowBuild): Pt[] {
  const r = b.udderRadius;
  const cx = b.bodyCx - b.bodyHalfLength * 0.55;
  const cy = b.bodyCy + b.bodyHalfDepth * 0.86;
  return ovalPoints(cx, cy + r * 0.35, r * 1.15, r * 0.95, deg(-6), 0.03, 2.2, 20);
}

/** Pink and restrained: a shape the eye reads as "dairy cow" and moves past. */
function paintUdder(ctx: Ctx, look: CowLook, outline: readonly Pt[]): void {
  const b = look.build;
  const bounds = boundsOfPoints(outline);
  const cx = (bounds.minX + bounds.maxX) / 2;
  const bottom = bounds.maxY;
  const TEAT_LENGTH = b.udderRadius * 0.45;
  const TEAT_HALF_WIDTH = b.udderRadius * 0.14;
  for (const dx of [-0.45, 0.35]) {
    const x = cx + dx * b.udderRadius;
    ctx.fillStyle = look.hide.udder;
    ctx.strokeStyle = rgba(look.hide.ink, INK_ALPHA * 0.7);
    ctx.lineWidth = INK_WIDTH * 0.5;
    ctx.beginPath();
    ctx.ellipse(
      x,
      bottom - TEAT_LENGTH * 0.1 + TEAT_LENGTH * 0.5,
      TEAT_HALF_WIDTH,
      TEAT_LENGTH * 0.5,
      0,
      0,
      TWO_PI,
    );
    ctx.stroke();
    ctx.fill();
  }
  traceSmooth(ctx, outline);
  ctx.fillStyle = look.hide.udder;
  ctx.fill();
  ctx.save();
  traceSmooth(ctx, outline);
  ctx.clip();
  const shade = ctx.createLinearGradient(0, bounds.minY, 0, bounds.maxY);
  shade.addColorStop(0, rgba(look.hide.shadow, 0.55));
  shade.addColorStop(0.5, rgba(look.hide.shadow, 0));
  shade.addColorStop(1, rgba('#7a3b44', 0.3));
  ctx.fillStyle = shade;
  ctx.fillRect(bounds.minX, bounds.minY, bounds.maxX - bounds.minX, bounds.maxY - bounds.minY);
  ctx.restore();
}

// ── Head, head-on ────────────────────────────────────────────────────────────

/**
 * The head-on skull, in its own space: origin at the middle of the poll, +Y
 * down the face. `height` is the face's visible length after foreshortening.
 */
function headFrontOutline(b: CowBuild, height: number, jaw: number): Pt[] {
  const W = b.headFrontHalfWidth;
  const H = height;
  const right: Pt[] = [
    { x: 0.5 * W, y: -0.05 * H },
    { x: 0.88 * W, y: 0.02 * H },
    { x: 1.0 * W, y: 0.2 * H },
    { x: 1.02 * W, y: 0.36 * H },
    { x: 0.84 * W, y: 0.56 * H },
    { x: 0.68 * W, y: 0.72 * H },
    { x: 0.74 * W, y: 0.88 * H },
    { x: 0.62 * W, y: (1.0 + jaw * 0.06) * H },
  ];
  const left = right.map((p) => ({ x: -p.x, y: p.y })).reverse();
  return [{ x: 0, y: -0.02 * H }, ...right, { x: 0, y: (1.04 + jaw * 0.08) * H }, ...left];
}

/** The muzzle's half width head-on, as a share of the skull's; the ear gate reads the ratio. */
export const FRONT_MUZZLE_SHARE = 0.74;

/**
 * Draws the head seen from in front, centred on `poll`.
 *
 * Exported so the ear-read gate can measure the head's silhouette on its own:
 * the chest behind the head at muzzle height would otherwise be measured as the
 * muzzle.
 */
export function drawCowFrontHead(
  ctx: Ctx,
  pose: CowPose,
  look: CowLook,
  poll: Pt,
  faceHeight: number,
): void {
  const { build: b, hide } = look;
  const marks = markingsOf(look);
  const W = b.headFrontHalfWidth;
  const H = faceHeight;
  ctx.save();
  try {
    ctx.translate(poll.x + pose.headTurn * W * 0.35, poll.y);
    ctx.rotate(pose.headTilt);

    const earY = 0.14 * H;
    const earFor = (
      value: number,
      side: number,
    ): { angle: number; length: number; inner: number } => {
      // Out sideways the ear is at its full length and droops a little; perked
      // forward it foreshortens and lifts; pinned back it lifts and narrows.
      const droop = deg(6);
      const lifted = deg(-28);
      const angle = value >= 0 ? lerp(droop, lifted * 0.6, value) : lerp(droop, lifted, -value);
      const length = b.earLength * (value >= 0 ? lerp(1, 0.72, value) : lerp(1, 0.6, -value));
      const outward = side > 0 ? angle : Math.PI - angle;
      return { angle: outward, length, inner: value >= 0 ? 0.9 : 0.3 };
    };
    for (const side of [-1, 1]) {
      const value = side < 0 ? pose.earR : pose.earL;
      const ear = earFor(value, side);
      drawEar(ctx, look, { x: side * W * 0.9, y: earY }, ear.angle, ear.length, ear.inner, 0);
    }

    const outline = headFrontOutline(b, H, pose.jaw);
    inkOutline(ctx, look, outline);
    fillHide(ctx, look, {
      outline,
      patches: marks.face.map((p) => ({ ...p, y: (p.y / b.headLength) * H })),
      shade: 0,
      hairAngle: HALF_PI,
      hairCount: 8,
      hairLength: 0.02,
      seed: 401,
      shagLength: 0.03,
      detail: (c) => {
        const mw = W * FRONT_MUZZLE_SHARE;
        const my = 0.86 * H;
        if (hide.muzzleRing !== null) {
          c.fillStyle = hide.muzzleRing;
          c.beginPath();
          c.ellipse(0, my - 0.06 * H, mw * 1.02, 0.2 * H, 0, 0, TWO_PI);
          c.fill();
        }
        c.fillStyle = hide.muzzle;
        c.beginPath();
        c.ellipse(pose.jawSide * W * 0.04, my + 0.02 * H, mw * 0.98, 0.17 * H, 0, 0, TWO_PI);
        c.fill();
        c.fillStyle = rgba('#ffffff', 0.22);
        c.beginPath();
        c.ellipse(0, my - 0.06 * H, mw * 0.5, 0.05 * H, 0, 0, TWO_PI);
        c.fill();
        c.fillStyle = hide.nostril;
        for (const side of [-1, 1]) {
          c.beginPath();
          c.ellipse(side * mw * 0.5, my, mw * 0.2, 0.07 * H, side * deg(30), 0, TWO_PI);
          c.fill();
        }
        c.strokeStyle = rgba(hide.ink, 0.75);
        c.lineWidth = INK_WIDTH * 0.4;
        c.beginPath();
        const mouthY = my + 0.13 * H + pose.jaw * 0.04 * H;
        c.moveTo(-mw * 0.7 + pose.jawSide * W * 0.08, mouthY);
        c.quadraticCurveTo(
          pose.jawSide * W * 0.1,
          mouthY + 0.03 * H,
          mw * 0.7 + pose.jawSide * W * 0.08,
          mouthY,
        );
        c.stroke();
      },
    });
    for (const side of [-1, 1]) {
      drawEye(ctx, look, side * W * 0.86, 0.34 * H, b.eyeRadius, pose.eyeOpen);
    }
    drawForelock(
      ctx,
      look,
      { x: -W * 0.85, y: 0.0 },
      { x: W * 0.85, y: 0.0 },
      { x: 0, y: 1 },
      H * 0.46,
      23,
    );
    const horns = look.horns;
    if (horns !== null) {
      for (const side of [-1, 1]) {
        const outward =
          horns.shape === 'upswept' ? { x: side * 0.94, y: -0.34 } : { x: side * 0.7, y: -0.72 };
        const curl =
          horns.shape === 'upswept' ? { x: side * 0.1, y: -1 } : { x: side * -0.2, y: -0.98 };
        drawHorn(
          ctx,
          look,
          horns,
          { x: side * W * 0.62, y: 0.02 * H },
          outward,
          curl,
          horns.length,
        );
      }
    }
    look.decorations?.head?.(ctx, 'front', outline, true);
  } finally {
    ctx.restore();
  }
}

/** The back of the head seen over the rump: poll, ear tips and horns only. */
function drawCowBackHead(ctx: Ctx, pose: CowPose, look: CowLook, poll: Pt): void {
  const b = look.build;
  const W = b.headFrontHalfWidth;
  for (const side of [-1, 1]) {
    const value = side < 0 ? pose.earL : pose.earR;
    const angle = lerp(deg(10), deg(-30), clamp01(Math.abs(value)));
    drawEar(
      ctx,
      look,
      { x: poll.x + side * W * 0.85, y: poll.y + 0.03 },
      side > 0 ? angle : Math.PI - angle,
      b.earLength * lerp(1, 0.75, Math.abs(value)),
      0,
      0.15,
    );
  }
  const skull = ovalPoints(poll.x, poll.y + 0.04, W * 0.95, 0.07, 0, 0.04, 5.2, 20);
  inkOutline(ctx, look, skull);
  traceSmooth(ctx, skull);
  ctx.fillStyle = mix(look.hide.face ?? look.hide.base, look.hide.shadow, 0.2);
  ctx.fill();
  const horns = look.horns;
  if (horns !== null) {
    for (const side of [-1, 1]) {
      const outward =
        horns.shape === 'upswept' ? { x: side * 0.94, y: -0.34 } : { x: side * 0.7, y: -0.72 };
      const curl =
        horns.shape === 'upswept' ? { x: side * 0.1, y: -1 } : { x: side * -0.2, y: -0.98 };
      drawHorn(
        ctx,
        look,
        horns,
        { x: poll.x + side * W * 0.6, y: poll.y + 0.01 },
        outward,
        curl,
        horns.length,
      );
    }
  }
}

// ── Axial views ──────────────────────────────────────────────────────────────

/**
 * How much of a hoof's forward reach shows as screen depth head-on. A hoof a
 * stride nearer the camera lands lower on the screen.
 */
const AXIAL_DEPTH = 0.35;
/** How much higher on the screen the far pair of hooves stands. */
const AXIAL_FAR_RISE = 0.05;
const AXIAL_FAR_SHADE = 0.45;
/** How far a lifted hoof tracks in under the chest as it swings. */
const AXIAL_TRACK_IN = 0.3;

/**
 * The head-on face height from the profile's own head angle, so the two views
 * agree about where the head is: a face pointing down at the grass is its full
 * length tall, one held up is foreshortened.
 */
function faceHeightOf(b: CowBuild, headAngle: number): number {
  return b.headLength * lerp(0.62, 1.0, clamp01(Math.sin(headAngle)));
}

/** How much narrower a leg's root is head-on, where the forearm is seen edge-on to its muscle. */
const AXIAL_LEG_ROOT_SCALE = 0.85;
/**
 * How much lower on the screen the head sits head-on than the poll's height
 * says. The camera looks down on the herd, so the head — the nearest thing to
 * it — drops in front of the shoulders, and the back shows behind it.
 */
const FRONT_HEAD_NEARNESS = 0.02;

interface AxialLeg {
  readonly shape: LegShape | null;
  /** Set instead of a shape when the leg is folded under a lying animal. */
  readonly knee: Pt[] | null;
  readonly part: 'foreleg' | 'hindleg';
  readonly shade: number;
  readonly lift: number;
  readonly seed: number;
}

/**
 * A head-on or rear leg. Seen end-on a leg is a post with the knee hidden in
 * front of the cannon, so it is solved as a straight column; when the animal
 * lies down there is too little of it left for a column, and it folds into a
 * knee.
 */
function axialLegOf(
  b: CowBuild,
  root: Pt,
  foot: Pt,
  part: 'foreleg' | 'hindleg',
  shade: number,
  lift: number,
  seed: number,
): AxialLeg {
  const length = Math.hypot(foot.x - root.x, foot.y - root.y);
  const usable = b.foreUpper + b.foreLower;
  if (length < usable * 0.4) {
    const knee = ovalPoints(
      foot.x,
      foot.y - b.kneeHalfWidth * 0.6,
      b.kneeHalfWidth * 1.7,
      b.kneeHalfWidth * 1.15,
      0,
      0.05,
      seed,
      16,
    );
    return { shape: null, knee, part, shade, lift, seed };
  }
  const upper = length * 0.55;
  const lower = length * 0.45 + JOINT_LOCK_MARGIN * 2;
  const shape = legShape(b, root, foot, upper, lower, KNEE_BEND, AXIAL_LEG_ROOT_SCALE);
  return { shape, knee: null, part, shade, lift, seed };
}

function inkAxialLeg(ctx: Ctx, look: CowLook, leg: AxialLeg): void {
  if (leg.shape !== null) inkOutline(ctx, look, leg.shape.outline);
  else if (leg.knee !== null) inkOutline(ctx, look, leg.knee);
}

function fillAxialLeg(ctx: Ctx, look: CowLook, view: CowView, leg: AxialLeg): void {
  if (leg.shape !== null) {
    paintLeg(ctx, look, view, leg.shape, leg.part, none(), leg.shade, leg.lift, leg.seed, false);
    return;
  }
  if (leg.knee === null) return;
  traceSmooth(ctx, leg.knee);
  ctx.fillStyle = mix(look.hide.points, look.hide.shadow, leg.shade);
  ctx.fill();
}

function drawCowAxial(ctx: Ctx, pose: CowPose, look: CowLook, toward: boolean): void {
  const b = look.build;
  const marks = markingsOf(look);
  const view: CowView = toward ? 'front' : 'back';
  const lying = (pose.lowerFore + pose.lowerHind) * 0.5;
  const drop = b.lieDrop * lying;
  const bodyY = b.bodyCy + pose.bob + drop + pose.breathe * BREATHE_DEPTH;
  const cx = pose.sway;
  const airborne = Math.max(0, -pose.bob);
  const shadowScale = 1 / (1 + airborne * 4);
  drawGroundShadow(
    ctx,
    cx,
    GROUND_Y + 0.01,
    (b.axialBodyHalfWidth * 1.2 + lying * 0.08) * shadowScale,
    0.07 * shadowScale,
  );

  const depthSign = toward ? 1 : -1;
  const W = b.axialBodyHalfWidth;
  const D = axialHalfDepth(b);
  const footAt = (
    side: number,
    track: number,
    foot: CowFootPose,
    far: boolean,
    lower: number,
  ): Pt => {
    const trackIn = foot.lift * AXIAL_TRACK_IN * track;
    const rise = far ? AXIAL_FAR_RISE : 0;
    const standing: Pt = {
      x: cx * 0.4 + side * (track - trackIn),
      y: GROUND_Y + foot.dy + foot.dx * AXIAL_DEPTH * depthSign - rise,
    };
    const folded: Pt = { x: side * track * 0.9 + cx, y: GROUND_Y - rise - 0.02 };
    return {
      x: lerp(standing.x, folded.x, clamp01(lower)),
      y: lerp(standing.y, folded.y, clamp01(lower)),
    };
  };
  const rootY = (far: boolean): number => bodyY + D * 0.6 - (far ? AXIAL_FAR_RISE : 0);

  const farPair = toward
    ? {
        feet: [pose.hindR, pose.hindL],
        track: b.axialHindTrack,
        part: 'hindleg' as const,
        lower: pose.lowerHind,
      }
    : {
        feet: [pose.frontL, pose.frontR],
        track: b.axialForeTrack * 0.85,
        part: 'foreleg' as const,
        lower: pose.lowerFore,
      };
  const nearPair = toward
    ? {
        feet: [pose.frontR, pose.frontL],
        track: b.axialForeTrack,
        part: 'foreleg' as const,
        lower: pose.lowerFore,
      }
    : {
        feet: [pose.hindL, pose.hindR],
        track: b.axialHindTrack,
        part: 'hindleg' as const,
        lower: pose.lowerHind,
      };

  // Head-on the animal's right is on screen left; from behind its left is.
  const sides = [-1, 1];
  const nh = neckHeadOf(b, pose);
  const pollY = bodyY - b.bodyCy + nh.tip.y;
  const faceHeight = faceHeightOf(b, nh.headAngle);

  if (!toward) drawCowBackHead(ctx, pose, look, { x: cx, y: backPollY(b, pose, bodyY) });

  farPair.feet.forEach((foot, i) => {
    const side = sides[i];
    const leg = axialLegOf(
      b,
      { x: cx + side * farPair.track * 0.85, y: rootY(true) },
      footAt(side, farPair.track, foot, true, farPair.lower),
      farPair.part,
      AXIAL_FAR_SHADE,
      foot.lift,
      61 + i,
    );
    inkAxialLeg(ctx, look, leg);
    fillAxialLeg(ctx, look, view, leg);
  });

  const nearLegs = nearPair.feet.map((foot, i) => {
    const side = sides[i];
    return axialLegOf(
      b,
      { x: cx + side * nearPair.track * 0.9, y: rootY(false) },
      footAt(side, nearPair.track, foot, false, nearPair.lower),
      nearPair.part,
      0,
      foot.lift,
      71 + i,
    );
  });

  const barrel = axialBarrelOutline(cx, bodyY, W, D, toward);
  const inBodySpace = (paint: () => void): void => {
    ctx.save();
    try {
      ctx.translate(cx, bodyY);
      ctx.rotate(pose.roll);
      ctx.translate(-cx, -bodyY);
      paint();
    } finally {
      ctx.restore();
    }
  };
  // As in profile: one ink pass, then the legs filled under the barrel so they
  // grow out of it rather than being stuck across its front.
  inBodySpace(() => inkOutline(ctx, look, barrel));
  for (const leg of nearLegs) inkAxialLeg(ctx, look, leg);
  for (const leg of nearLegs) fillAxialLeg(ctx, look, view, leg);
  inBodySpace(() => {
    fillHide(ctx, look, {
      outline: barrel,
      patches: (toward ? marks.chest : marks.rump).map((p) => ({
        ...p,
        x: p.x + cx,
        y: p.y - b.bodyCy + bodyY,
      })),
      shade: 0,
      hairAngle: HALF_PI,
      hairCount: 34,
      hairLength: 0.03,
      seed: toward ? 81 : 83,
      shagLength: BODY_SHAG * (D / ADULT_BODY_HALF_DEPTH),
      detail: (c) => axialBarrelDetail(c, look, cx, bodyY, toward),
    });
    look.decorations?.body?.(ctx, view, barrel, true);
  });

  if (!toward) {
    drawTail(
      ctx,
      look,
      'back',
      { x: cx, y: bodyY - D * 0.8 },
      pose.tailLift * 0.8,
      pose.tailSwing,
      { x: 0, y: -0.3 },
    );
  }

  if (toward) {
    const poll = { x: cx, y: pollY + frontHeadNearness(b) };
    const neck = frontNeckOutline(b, cx, bodyY, poll, faceHeight);
    inkOutline(ctx, look, neck);
    fillHide(ctx, look, {
      outline: neck,
      patches: [],
      shade: 0.15,
      hairAngle: HALF_PI,
      hairCount: 6,
      hairLength: 0.03,
      seed: 89,
      shagLength: BODY_SHAG * 0.6,
    });
    drawCowFrontHead(ctx, pose, look, poll, faceHeight);
  }
}

/** The adult head length the head-on nearness drop is authored against. */
const ADULT_HEAD_LENGTH = 0.36;

/**
 * The neck head-on: a wedge from the top of the chest to behind the face.
 * Hidden behind the head while it is held up, it is what keeps a grazing head
 * attached to the animal rather than floating under its back.
 */
function frontNeckOutline(
  b: CowBuild,
  cx: number,
  bodyY: number,
  poll: Pt,
  faceHeight: number,
): Pt[] {
  const topY = bodyY - b.bodyHalfDepth * 0.5;
  const rootHalf = b.axialBodyHalfWidth * 0.5;
  const tipHalf = b.headFrontHalfWidth * 0.8;
  const tipY = poll.y + faceHeight * 0.35;
  return [
    { x: cx - rootHalf, y: topY },
    { x: cx + rootHalf, y: topY },
    { x: poll.x + tipHalf, y: tipY },
    { x: poll.x - tipHalf, y: tipY },
  ];
}

/** How far the ear tips stand above the rump top from behind. */
const BACK_EARS_SHOW = 0.06;
/** Neck lowered past this and the head starts to sink out of sight behind the rump. */
const BACK_HEAD_SINK_START = 0.25;
const BACK_HEAD_SINK_RATE = 0.5;
/** A head tossed up rises this much per radian of neck raised. */
const BACK_HEAD_RISE_RATE = 0.25;

/**
 * The poll's height from behind. The head is at the far end of the animal, so
 * only the ear tips and horns show over the rump, and they must not flicker in
 * and out with the walk's head nod: the head sits at a fixed height above the
 * rump top, sinking out of sight only when the neck is really lowered (a
 * graze) and rising when it is tossed.
 */
function backPollY(b: CowBuild, pose: CowPose, bodyY: number): number {
  const rumpTop = bodyY - b.bodyHalfDepth * 0.96;
  const sink = Math.max(0, pose.neck - BACK_HEAD_SINK_START) * BACK_HEAD_SINK_RATE;
  const rise = Math.max(0, -pose.neck) * BACK_HEAD_RISE_RATE;
  return rumpTop - BACK_EARS_SHOW + sink - rise;
}

/**
 * How tall the barrel is drawn head-on and from behind, as a share of its
 * width at least. The camera looks down on the herd, so the back shows above
 * the chest and the body is deeper on screen than in profile; a calf drawn at
 * its profile depth head-on is a head on two stilts.
 */
const AXIAL_DEPTH_TO_WIDTH = 0.9;

function axialHalfDepth(b: CowBuild): number {
  return Math.max(b.bodyHalfDepth, b.axialBodyHalfWidth * AXIAL_DEPTH_TO_WIDTH);
}

function frontHeadNearness(b: CowBuild): number {
  return FRONT_HEAD_NEARNESS * (b.headLength / ADULT_HEAD_LENGTH);
}

function axialBarrelDetail(
  c: Ctx,
  look: CowLook,
  cx: number,
  bodyY: number,
  toward: boolean,
): void {
  const { hide } = look;
  const W = look.build.axialBodyHalfWidth;
  const D = axialHalfDepth(look.build);
  if (toward) {
    // The dewlap down the middle of the chest and the round of each shoulder
    // either side of it, as soft light rather than lines: drawn as creases
    // they read as seams on a bulb.
    fillSoftEllipse(c, cx, bodyY + D * 0.35, W * 0.2, D * 0.55, hide.light, 0.35);
    for (const side of [-1, 1]) {
      fillSoftEllipse(
        c,
        cx + side * W * 0.62,
        bodyY - D * 0.1,
        W * 0.3,
        D * 0.45,
        hide.light,
        0.25,
      );
    }
    return;
  }
  // Hook and pin bones: the angular rump that no other animal has.
  c.fillStyle = rgba(hide.light, 0.4);
  for (const side of [-1, 1]) {
    c.beginPath();
    c.ellipse(cx + side * W * 0.8, bodyY - D * 0.84, W * 0.16, D * 0.08, 0, 0, TWO_PI);
    c.fill();
    c.beginPath();
    c.ellipse(cx + side * W * 0.3, bodyY - D * 0.72, W * 0.1, D * 0.06, 0, 0, TWO_PI);
    c.fill();
    // The groove down the back of each thigh, either side of the tail.
    crease(c, hide.shadow, 0.012, 0.55, [
      { x: cx + side * W * 0.2, y: bodyY - D * 0.6 },
      { x: cx + side * W * 0.3, y: bodyY + D * 0.1 },
      { x: cx + side * W * 0.16, y: bodyY + D * 0.95 },
    ]);
  }
}

/**
 * The barrel head-on or from behind. From in front the shoulders slope away
 * from behind the head to a deep chest; from behind the rump is square, with
 * the hooks standing up at its top corners.
 */
function axialBarrelOutline(cx: number, cy: number, w: number, d: number, toward: boolean): Pt[] {
  if (toward) {
    // The shoulders fall away steeply from behind the poll, so the ears — the
    // key head-on read — stand out against the ground rather than the hide.
    return [
      { x: cx, y: cy - d * 0.62 },
      { x: cx + w * 0.45, y: cy - d * 0.58 },
      { x: cx + w * 0.85, y: cy - d * 0.25 },
      { x: cx + w * 1.0, y: cy + d * 0.15 },
      { x: cx + w * 0.92, y: cy + d * 0.62 },
      { x: cx + w * 0.62, y: cy + d * 1.0 },
      { x: cx + w * 0.2, y: cy + d * 1.14 },
      { x: cx - w * 0.2, y: cy + d * 1.14 },
      { x: cx - w * 0.62, y: cy + d * 1.0 },
      { x: cx - w * 0.92, y: cy + d * 0.62 },
      { x: cx - w * 1.0, y: cy + d * 0.15 },
      { x: cx - w * 0.85, y: cy - d * 0.25 },
      { x: cx - w * 0.45, y: cy - d * 0.58 },
    ];
  }
  return [
    { x: cx, y: cy - d * 0.9 },
    { x: cx + w * 0.55, y: cy - d * 0.9 },
    { x: cx + w * 1.0, y: cy - d * 0.96 },
    { x: cx + w * 1.04, y: cy - d * 0.4 },
    { x: cx + w * 0.98, y: cy + d * 0.3 },
    { x: cx + w * 0.85, y: cy + d * 0.8 },
    { x: cx + w * 0.3, y: cy + d * 1.0 },
    { x: cx - w * 0.3, y: cy + d * 1.0 },
    { x: cx - w * 0.85, y: cy + d * 0.8 },
    { x: cx - w * 0.98, y: cy + d * 0.3 },
    { x: cx - w * 1.04, y: cy - d * 0.4 },
    { x: cx - w * 1.0, y: cy - d * 0.96 },
    { x: cx - w * 0.55, y: cy - d * 0.9 },
  ];
}

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * Paints one bovine in one view, in tile units about the centre of its tile.
 * The caller owns the transform; the painter owns every other piece of context
 * state it touches and restores it.
 */
export function drawCow(ctx: Ctx, view: CowView, pose: CowPose, look: CowLook): void {
  ctx.save();
  try {
    if (view === 'side') drawCowSide(ctx, pose, look);
    else drawCowAxial(ctx, pose, look, view === 'front');
  } finally {
    ctx.restore();
  }
}

/**
 * The height of the poll above the ground line in a pose, in tiles — where the
 * head-on face starts. Exported for the ear-read gate and for anything that
 * hangs an effect over the head (the hearts a petted cow gives off).
 */
export function cowPollPoint(pose: CowPose, look: CowLook, view: CowView): Pt {
  const b = look.build;
  const nh = neckHeadOf(b, pose);
  if (view === 'side') {
    return bodyToWorld(bodyFrameOf(b, pose), nh.tip);
  }
  const lying = (pose.lowerFore + pose.lowerHind) * 0.5;
  const bodyY = b.bodyCy + pose.bob + b.lieDrop * lying + pose.breathe * BREATHE_DEPTH;
  const pollY = bodyY - b.bodyCy + nh.tip.y;
  if (view === 'back') return { x: pose.sway, y: backPollY(b, pose, bodyY) };
  return { x: pose.sway, y: pollY + frontHeadNearness(b) };
}

/** The head-on face height for a pose; see {@link faceHeightOf}. */
export function cowFrontFaceHeight(pose: CowPose, look: CowLook): number {
  return faceHeightOf(look.build, neckHeadOf(look.build, pose).headAngle);
}
