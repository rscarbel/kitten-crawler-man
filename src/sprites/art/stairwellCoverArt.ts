/**
 * A stairwell seal's cover as a solid object: built from boxes and prisms in
 * three dimensions, turned about its hinge, lit, and projected into the
 * game's three-quarter view for every angle it is drawn at.
 *
 * A cover tipping up changes its perspective, so no frame of it is the flat
 * picture bent into place. Each board, strap, rivet, bar and rib is a solid
 * whose corners are turned and projected on their own: an edge comes into
 * view as the cover lifts, the detail on its face compresses along the hinge
 * while what stands proud of it keeps its height, its underside (battens,
 * ribs, the back of the grate) appears past upright, every face is shaded by
 * how it faces the light, and the cover throws its shadow down into the
 * stairwell it is uncovering.
 *
 * Coordinates are fractions of the stairwell's footprint, like the seal it
 * belongs to: x east, y south, z up. A point at height z is drawn
 * `z * HEIGHT_TO_SCREEN` higher up the screen.
 */

import { withAlpha } from '../../ui/theme/color';
import { worldPalette } from '../../ui/theme/worldInk';
import type { StairwellStyleId } from './stairwellArt';

type Ctx = CanvasRenderingContext2D;
type Rgb = readonly [number, number, number];

interface V2 {
  readonly a: number;
  readonly b: number;
}

interface V3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Maps footprint fractions into the frame being painted. */
export interface CoverFrame {
  readonly ox: number;
  readonly oy: number;
  readonly s: number;
}

/** Where the closed cover lies: over the opening and the inner edge of its rim. */
const COVER = { left: 0.08, right: 0.92, top: 0.11, bottom: 0.92 } as const;
const COVER_W = COVER.right - COVER.left;
const COVER_H = COVER.bottom - COVER.top;

/** Screen rise per unit of height: the game's three-quarter view. */
const HEIGHT_TO_SCREEN = 0.45;

/** The direction faces turn toward to be lit: the game's key light, upper left and above. */
const LIGHT: V3 = normalize({ x: -0.45, y: -0.55, z: 0.7 });
/** The direction toward the viewer: moving along it leaves a point's picture where it was. */
const VIEW: V3 = normalize({ x: 0, y: HEIGHT_TO_SCREEN, z: 1 });
const AMBIENT = 0.5;
const DIFFUSE = 0.62;
/** A face this nearly edge-on to the viewer is skipped rather than drawn as a hairline. */
const FACING_EPSILON = 0.02;
const SHADOW_ALPHA = 0.38;
/** Every face is outlined a shade darker, so a thin edge still reads as an edge. */
const OUTLINE_SHADE = 0.55;
const OUTLINE_WIDTH = 0.004;
/** The thinnest line or dot painted on a cover, in pixels, so detail never vanishes at game size. */
const MIN_LINE_PX = 0.5;
const MIN_DOT_PX = 0.6;
/** The white catch-light on a rounded head. */
const GLINT_WHITE: Rgb = [255, 255, 255];
/** A stud's catch-light: toward the light by this share of its radius, this share of its size. */
const STUD_GLINT = { offset: 0.3, size: 0.4, alpha: 0.35 } as const;
const STUD_SIDES = 8;
const NAIL_SIDES = 6;
const CIRCLE_SIDES = 24;
const DEGREES_PER_HALF_TURN = 180;
const SMOOTHSTEP_CUBE = 3;

// ── Vectors ──────────────────────────────────────────────────────────────────

function normalize(v: V3): V3 {
  const length = Math.hypot(v.x, v.y, v.z);
  return { x: v.x / length, y: v.y / length, z: v.z / length };
}

function dot(a: V3, b: V3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function degrees(deg: number): number {
  return (deg * Math.PI) / DEGREES_PER_HALF_TURN;
}

function clamp01(t: number): number {
  return Math.max(0, Math.min(1, t));
}

function easeInOut(t: number): number {
  const c = clamp01(t);
  return c * c * (SMOOTHSTEP_CUBE - 2 * c);
}

// ── Poses ────────────────────────────────────────────────────────────────────

/**
 * A cover turned about a horizontal hinge: the hinge runs along `axis`
 * through `pivot`, and `angle` turns the cover's free edge up off the floor.
 * `drag` then slides the whole cover across the floor.
 */
interface Pose {
  readonly axis: 'x' | 'y';
  readonly pivot: V3;
  readonly angle: number;
  readonly drag: V3;
}

const CLOSED: Pose = {
  axis: 'x',
  pivot: { x: 0, y: 0, z: 0 },
  angle: 0,
  drag: { x: 0, y: 0, z: 0 },
};

function rotate(v: V3, pose: Pose): V3 {
  const c = Math.cos(pose.angle);
  const s = Math.sin(pose.angle);
  return pose.axis === 'x'
    ? { x: v.x, y: v.y * c - v.z * s, z: v.y * s + v.z * c }
    : { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

/** A point of the cover, given in its own closed coordinates (a east, b south, n up), placed by `pose`. */
function place(p: V3, pose: Pose): V3 {
  const closed = {
    x: COVER.left + p.x - pose.pivot.x,
    y: COVER.top + p.y - pose.pivot.y,
    z: p.z - pose.pivot.z,
  };
  const turned = rotate(closed, pose);
  return {
    x: turned.x + pose.pivot.x + pose.drag.x,
    y: turned.y + pose.pivot.y + pose.drag.y,
    z: turned.z + pose.pivot.z + pose.drag.z,
  };
}

function project(f: CoverFrame, p: V3): { x: number; y: number } {
  return { x: f.ox + p.x * f.s, y: f.oy + (p.y - p.z * HEIGHT_TO_SCREEN) * f.s };
}

// ── Solids ───────────────────────────────────────────────────────────────────

/** What draws on a face after it is filled, in the cover's own coordinates. */
interface DecorPen {
  readonly ctx: Ctx;
  /** Pixels per footprint unit, for line widths. */
  readonly px: number;
  /**
   * Traces a polyline (or polygon, with `close`) given in the cover's own
   * coordinates; `addTo` adds it to the path already begun, for a ring.
   */
  readonly trace: (points: readonly V3[], close?: boolean, addTo?: boolean) => void;
  /** Where a point given in the cover's own coordinates lands on the screen. */
  readonly project: (p: V3) => { x: number; y: number };
  /** `color` lit as the face it is drawn on is lit. */
  readonly lit: (color: Rgb, alpha?: number) => string;
}

type Decor = (pen: DecorPen) => void;

/** A prism standing on a polygon in the cover's own plane, from height `n0` to `n1`. */
interface Solid {
  readonly base: readonly V2[];
  readonly n0: number;
  readonly n1: number;
  readonly color: Rgb;
  readonly top?: Decor;
  readonly bottom?: Decor;
}

function box(
  a0: number,
  a1: number,
  b0: number,
  b1: number,
  n0: number,
  n1: number,
  color: Rgb,
  top?: Decor,
  bottom?: Decor,
): Solid {
  return {
    base: [
      { a: a0, b: b0 },
      { a: a1, b: b0 },
      { a: a1, b: b1 },
      { a: a0, b: b1 },
    ],
    n0,
    n1,
    color,
    top,
    bottom,
  };
}

/** A round head (a rivet, a nail, a rosette) as a short many-sided prism. */
function stud(
  a: number,
  b: number,
  radius: number,
  n0: number,
  height: number,
  color: Rgb,
  sides = STUD_SIDES,
): Solid {
  const base: V2[] = [];
  for (let side = 0; side < sides; side++) {
    const angle = (side / sides) * Math.PI * 2;
    base.push({ a: a + Math.cos(angle) * radius, b: b + Math.sin(angle) * radius });
  }
  return {
    base,
    n0,
    n1: n0 + height,
    color,
    top: (pen) => {
      const towardLight = radius * STUD_GLINT.offset;
      const glint = pen.project({ x: a - towardLight, y: b - towardLight, z: n0 + height });
      pen.ctx.beginPath();
      pen.ctx.arc(
        glint.x,
        glint.y,
        Math.max(MIN_DOT_PX, radius * STUD_GLINT.size * pen.px),
        0,
        Math.PI * 2,
      );
      pen.ctx.fillStyle = pen.lit(GLINT_WHITE, STUD_GLINT.alpha);
      pen.ctx.fill();
    },
  };
}

interface Face {
  readonly corners: readonly V3[];
  readonly local: readonly V3[];
  readonly normal: V3;
  readonly color: Rgb;
  readonly decor?: Decor;
}

function facesOf(solid: Solid): Face[] {
  const top = solid.base.map((p) => ({ x: p.a, y: p.b, z: solid.n1 }));
  const bottom = [...solid.base].reverse().map((p) => ({ x: p.a, y: p.b, z: solid.n0 }));
  const centerA = solid.base.reduce((sum, p) => sum + p.a, 0) / solid.base.length;
  const centerB = solid.base.reduce((sum, p) => sum + p.b, 0) / solid.base.length;
  const faces: Face[] = [
    {
      corners: top,
      local: top,
      normal: { x: 0, y: 0, z: 1 },
      color: solid.color,
      decor: solid.top,
    },
    {
      corners: bottom,
      local: bottom,
      normal: { x: 0, y: 0, z: -1 },
      color: solid.color,
      decor: solid.bottom,
    },
  ];
  solid.base.forEach((p, index) => {
    const q = solid.base[(index + 1) % solid.base.length];
    let nx = q.b - p.b;
    let ny = -(q.a - p.a);
    const midA = (p.a + q.a) / 2 - centerA;
    const midB = (p.b + q.b) / 2 - centerB;
    if (nx * midA + ny * midB < 0) {
      nx = -nx;
      ny = -ny;
    }
    const side = [
      { x: p.a, y: p.b, z: solid.n0 },
      { x: q.a, y: q.b, z: solid.n0 },
      { x: q.a, y: q.b, z: solid.n1 },
      { x: p.a, y: p.b, z: solid.n1 },
    ];
    faces.push({
      corners: side,
      local: side,
      normal: normalize({ x: nx, y: ny, z: 0 }),
      color: solid.color,
    });
  });
  return faces;
}

function shadeOf(normal: V3): number {
  return AMBIENT + DIFFUSE * Math.max(0, dot(normal, LIGHT));
}

function rgba(color: Rgb, light: number, alpha = 1): string {
  const channel = (value: number): number => Math.max(0, Math.min(255, Math.round(value * light)));
  return `rgba(${channel(color[0])},${channel(color[1])},${channel(color[2])},${alpha})`;
}

/** The convex hull of points on the screen, for a solid's shadow. */
function hull(points: readonly { x: number; y: number }[]): { x: number; y: number }[] {
  const sorted = [...points].sort((p, q) => p.x - q.x || p.y - q.y);
  const cross = (
    o: { x: number; y: number },
    a: { x: number; y: number },
    b: { x: number; y: number },
  ): number => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: { x: number; y: number }[] = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0)
      lower.pop();
    lower.push(p);
  }
  const upper: { x: number; y: number }[] = [];
  for (const p of [...sorted].reverse()) {
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0)
      upper.pop();
    upper.push(p);
  }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** Where a point's shadow falls on the floor, cast away from the key light. */
function onFloor(p: V3): V3 {
  const reach = p.z / LIGHT.z;
  return { x: p.x - LIGHT.x * reach, y: p.y - LIGHT.y * reach, z: 0 };
}

/** The middle of the shut cover, in its own coordinates. */
const PART_CENTER: V3 = { x: COVER_W / 2, y: COVER_H / 2, z: 0 };

/** One part of a cover, posed on its own hinge. */
interface Part {
  readonly solids: readonly Solid[];
  readonly pose: Pose;
}

/**
 * Lights, sorts and draws every part: the shadows first, down on the floor
 * and into the shaft, then each solid's faces turned toward the viewer, the
 * farthest solid first.
 */
function renderParts(ctx: Ctx, f: CoverFrame, parts: readonly Part[]): void {
  ctx.save();
  // A shadow lands only on the stairwell's own footprint: past it, a tall
  // cover's shadow would run off the frame it is painted in.
  ctx.beginPath();
  ctx.rect(f.ox, f.oy, f.s, f.s);
  ctx.clip();
  ctx.beginPath();
  for (const part of parts) {
    for (const solid of part.solids) {
      const corners = facesOf(solid).flatMap((face) =>
        face.corners.map((p) => project(f, onFloor(place(p, part.pose)))),
      );
      hull(corners).forEach((p, index) => {
        if (index === 0) ctx.moveTo(p.x, p.y);
        else ctx.lineTo(p.x, p.y);
      });
      ctx.closePath();
    }
  }
  ctx.fillStyle = withAlpha(worldPalette.shade, SHADOW_ALPHA);
  ctx.fill('nonzero');
  ctx.restore();

  // A cover is layers stacked on one plane, so its solids are drawn from the
  // layer farthest from the viewer to the nearest: bottom up while its top
  // faces the viewer, top down once its underside does. Two leaves are
  // ordered by how near each is, then their layers within.
  const drawn = parts.flatMap((part) => {
    const partDepth = dot(place(PART_CENTER, part.pose), VIEW);
    const topFacesViewer = dot(rotate({ x: 0, y: 0, z: 1 }, part.pose), VIEW) >= 0;
    return part.solids.map((solid) => {
      const middle = (solid.n0 + solid.n1) / 2;
      return {
        part,
        faces: facesOf(solid),
        partDepth,
        layer: topFacesViewer ? middle : -middle,
      };
    });
  });
  drawn.sort((p, q) => p.partDepth - q.partDepth || p.layer - q.layer);

  for (const { part, faces } of drawn) {
    const toScreen = (p: V3): { x: number; y: number } => project(f, place(p, part.pose));
    for (const face of faces) {
      const normal = rotate(face.normal, part.pose);
      if (dot(normal, VIEW) <= FACING_EPSILON) continue;
      const shade = shadeOf(normal);
      ctx.beginPath();
      face.corners.forEach((p, index) => {
        const q = toScreen(p);
        if (index === 0) ctx.moveTo(q.x, q.y);
        else ctx.lineTo(q.x, q.y);
      });
      ctx.closePath();
      ctx.fillStyle = rgba(face.color, shade);
      ctx.fill();
      ctx.strokeStyle = rgba(face.color, shade * OUTLINE_SHADE);
      ctx.lineWidth = Math.max(MIN_LINE_PX, OUTLINE_WIDTH * f.s);
      ctx.stroke();
      const decor = face.decor;
      if (decor === undefined) continue;
      const pen: DecorPen = {
        ctx,
        px: f.s,
        trace: (points, close = false, addTo = false) => {
          if (!addTo) ctx.beginPath();
          points.forEach((p, index) => {
            const q = toScreen(p);
            if (index === 0) ctx.moveTo(q.x, q.y);
            else ctx.lineTo(q.x, q.y);
          });
          if (close) ctx.closePath();
        },
        project: toScreen,
        lit: (color, alpha = 1) => rgba(color, shade, alpha),
      };
      ctx.save();
      decor(pen);
      ctx.restore();
    }
  }
}

// ── Materials ────────────────────────────────────────────────────────────────

const IRON: Rgb = [52, 50, 54];
const IRON_LIGHT: Rgb = [128, 126, 132];

const OAK = {
  plank: [126, 88, 52],
  batten: [100, 70, 42],
  grain: [74, 48, 28],
  knot: [56, 34, 18],
  thickness: 0.06,
  boards: 5,
  tones: [1.04, 0.93, 1.08, 0.97, 1.01],
  /** Grain lines along each board, each wandering a little across it. */
  grainLines: {
    lines: 4,
    steps: 10,
    wander: 0.06,
    phaseByBoard: 2.1,
    phaseByLine: 1.3,
    phaseByStep: 0.9,
    alpha: 0.55,
    width: 0.004,
  },
  /** One knot per board, placed along it by the board's number. */
  knotSpot: { from: 0.2, spread: 0.6, stride: 0.37, rx: 0.2, ry: 0.11, sides: 10, alpha: 0.7 },
  /** The worn, paler line along each board's north edge. */
  wear: { inset: 0.06, alpha: 0.35, width: 0.006 },
  /** Saw marks across the boards' undersides. */
  sawMarks: { from: 0.05, spacing: 0.07, slant: 0.03, inset: 0.02, alpha: 0.4 },
  /** The two battens nailed across the underside, and the nails through them. */
  battens: [
    [0.1, 0.18],
    [0.66, 0.74],
  ],
  battenInset: 0.03,
  battenDepth: 0.03,
  battenNails: [0.12, 0.4, 0.68],
  battenNailRadius: 0.008,
  battenNailAlpha: 0.9,
  strapRows: [0.25, 0.75],
  strapHalf: 0.036,
  strapProud: 0.012,
  nailRadius: 0.011,
  nailHeight: 0.008,
  nailSpacing: 0.11,
  bracketLength: 0.17,
  bracketThick: 0.06,
  bracketProud: 0.008,
  /** A bracket's nail near its far end, as a share of the bracket's length. */
  bracketFarNail: 0.8,
  /** Tips up to this angle over the first share of its time, then drags aside over the last. */
  liftDeg: 100,
  liftShare: 0.75,
  dragFrom: 0.55,
  drag: { x: 0.03, y: 0.02 },
} as const;

const STEEL = {
  plate: [128, 134, 138],
  underside: [98, 102, 106],
  latch: [70, 74, 78],
  rivet: [176, 182, 186],
  hazardYellow: [212, 166, 40],
  hazardBlack: [30, 28, 24],
  thickness: 0.035,
  band: 0.085,
  stripePeriod: 0.075,
  /** The row of rivets just inside the painted band, as a share of the band past its edge. */
  rivetLine: 1.3,
  rivetSpacing: 0.075,
  rivetRadius: 0.01,
  rivetHeight: 0.007,
  boltRadius: 0.024,
  boltHeight: 0.014,
  /** Raised diamond tread over the field: rows, staggered, each a short slanted bar. */
  tread: {
    start: 0.04,
    startA: 0.03,
    end: 0.02,
    spacing: 0.06,
    halfA: 0.015,
    halfB: 0.007,
    light: 1.3,
    width: 0.006,
  },
  /** Where feet and crates have worn the paint back to steel, each a small patch. */
  wornPatches: [
    [0.02, 0.03],
    [-0.05, 0.02],
    [0.03, -0.04],
    [-0.04, -0.05],
  ],
  /** One more worn patch along the south edge, at this share of its width. */
  wornSouth: { a: 0.45, b: -0.03 },
  wornPatch: { a1: 0.04, b1: 0.006, a2: 0.035, b2: 0.03, a3: -0.004, b3: 0.022, light: 0.85 },
  /** Hinge knuckles along the north edge, at these shares of its width. */
  knuckles: [0.22, 0.78],
  knuckle: { half: 0.06, north: -0.025, south: 0.035, below: -0.01, proud: 0.02 },
  ribDepth: 0.03,
  ribWidth: 0.04,
  /** The cross brace stops short of the flange's depth. */
  braceDepthShare: 0.8,
  /** The latch bar across the middle hangs lower than the ribs. */
  latchBar: {
    inset: 0.12,
    fromShare: 0.46,
    toShare: 0.54,
    depthShare: 1.4,
    boltRadius: 0.03,
    boltHeight: 0.012,
  },
  /** Swings up with gathering speed to this angle, then bounces back off its stop. */
  swingDeg: 100,
  slamShare: 0.88,
  bounce: 0.04,
} as const;

const BRONZE = {
  metal: [176, 124, 62],
  dark: [96, 62, 28],
  light: [226, 182, 110],
  verdigris: [84, 146, 124],
  thickness: 0.025,
  frame: 0.065,
  barSpacing: 0.08,
  barWidth: 0.024,
  railRows: [0.2, 0.8],
  railHalf: 0.014,
  /** The bars stand a little inside the frame's top and bottom faces. */
  barInset: 0.003,
  rosetteRadius: 0.02,
  rosetteHeight: 0.008,
  /** The inner stile at the seam is this share of the frame's width. */
  seamStile: 0.45,
  crest: { a: 0.5, b: 0.21, radius: 0.105 },
  /** The crest stands this far proud of the grate. */
  crestProud: 0.012,
  /** The crest's engraved ring, as a share of its radius. */
  crestRing: 0.84,
  crestRingWidth: 0.009,
  hawkAlpha: 0.9,
  /** Specks of verdigris on each leaf's north and south frame. */
  verdigrisSpecks: {
    count: 3,
    from: 0.2,
    step: 0.3,
    north: 0.4,
    south: 0.5,
    radius: 0.008,
    alpha: 0.6,
  },
  /** Each leaf's hasp beside the seam, where the padlock's shackle passes. */
  hasp: { b: 0.35, halfB: 0.05, width: 0.04, westGap: 0.05, eastGap: 0.01, proud: 0.012 },
  /** The shade the steps sit in under a shut grate, lifting as the grate opens. */
  underShade: 0.32,
  /** Each leaf folds back to this angle; the west leaf over the first half, the east the second. */
  foldDeg: 122,
  leafShare: 0.5,
} as const;

/** The rivet row just inside the steel hatch's painted band, shared by its rivets and its runes. */
const STEEL_RIVET_LINE = STEEL.band * STEEL.rivetLine;
const ROW_END_SLACK = 0.01;

// ── The oak slab ─────────────────────────────────────────────────────────────

function oakBoardTop(board: number, b0: number, b1: number): Decor {
  return (pen) => {
    const n = OAK.thickness;
    const height = b1 - b0;
    const grain = OAK.grainLines;
    pen.ctx.lineWidth = Math.max(MIN_LINE_PX, pen.px * grain.width);
    pen.ctx.strokeStyle = pen.lit(OAK.grain, grain.alpha);
    for (let line = 0; line < grain.lines; line++) {
      const b = b0 + height * ((line + 1 / 2) / grain.lines);
      const points: V3[] = [];
      for (let step = 0; step <= grain.steps; step++) {
        const phase =
          board * grain.phaseByBoard + line * grain.phaseByLine + step * grain.phaseByStep;
        points.push({
          x: (step / grain.steps) * COVER_W,
          y: b + Math.sin(phase) * height * grain.wander,
          z: n,
        });
      }
      pen.trace(points);
      pen.ctx.stroke();
    }
    const knotStyle = OAK.knotSpot;
    const knotA = COVER_W * (knotStyle.from + ((board * knotStyle.stride) % knotStyle.spread));
    const knot: V3[] = [];
    for (let i = 0; i < knotStyle.sides; i++) {
      const angle = (i / knotStyle.sides) * Math.PI * 2;
      knot.push({
        x: knotA + Math.cos(angle) * height * knotStyle.rx,
        y: (b0 + b1) / 2 + Math.sin(angle) * height * knotStyle.ry,
        z: n,
      });
    }
    pen.trace(knot, true);
    pen.ctx.fillStyle = pen.lit(OAK.knot, knotStyle.alpha);
    pen.ctx.fill();
    const wornB = b0 + height * OAK.wear.inset;
    pen.trace([
      { x: 0, y: wornB, z: n },
      { x: COVER_W, y: wornB, z: n },
    ]);
    pen.ctx.strokeStyle = pen.lit(OAK.plank, OAK.wear.alpha);
    pen.ctx.lineWidth = Math.max(MIN_LINE_PX, pen.px * OAK.wear.width);
    pen.ctx.stroke();
  };
}

/** The slab's underside: rough sawn boards, saw marks across them. */
const oakBoardBottom: Decor = (pen) => {
  const marks = OAK.sawMarks;
  pen.ctx.strokeStyle = pen.lit(OAK.grain, marks.alpha);
  pen.ctx.lineWidth = Math.max(MIN_LINE_PX, pen.px * OAK.grainLines.width);
  for (let a = marks.from; a < COVER_W; a += marks.spacing) {
    pen.trace([
      { x: a, y: marks.inset, z: 0 },
      { x: a + marks.slant, y: COVER_H - marks.inset, z: 0 },
    ]);
    pen.ctx.stroke();
  }
};

function oakSolids(): Solid[] {
  const solids: Solid[] = [];
  const boardH = COVER_H / OAK.boards;
  for (let board = 0; board < OAK.boards; board++) {
    const b0 = board * boardH;
    const b1 = b0 + boardH;
    const tone = OAK.tones[board] ?? 1;
    const color: Rgb = [OAK.plank[0] * tone, OAK.plank[1] * tone, OAK.plank[2] * tone];
    solids.push(
      box(0, COVER_W, b0, b1, 0, OAK.thickness, color, oakBoardTop(board, b0, b1), oakBoardBottom),
    );
  }
  for (const [a0, a1] of OAK.battens) {
    const nails: Decor = (pen) => {
      for (const b of OAK.battenNails) {
        const p = pen.project({ x: (a0 + a1) / 2, y: b, z: -OAK.battenDepth });
        pen.ctx.beginPath();
        pen.ctx.arc(p.x, p.y, Math.max(MIN_DOT_PX, pen.px * OAK.battenNailRadius), 0, Math.PI * 2);
        pen.ctx.fillStyle = pen.lit(IRON, OAK.battenNailAlpha);
        pen.ctx.fill();
      }
    };
    solids.push(
      box(
        a0,
        a1,
        OAK.battenInset,
        COVER_H - OAK.battenInset,
        -OAK.battenDepth,
        0,
        OAK.batten,
        undefined,
        nails,
      ),
    );
  }
  const top = OAK.thickness;
  const strapTop = top + OAK.strapProud;
  for (const row of OAK.strapRows) {
    const b0 = COVER_H * row - OAK.strapHalf;
    const b1 = COVER_H * row + OAK.strapHalf;
    solids.push(box(0, COVER_W, b0, b1, top, strapTop, IRON));
    // The strap runs on down the slab's ends, where it is nailed again.
    solids.push(box(-OAK.strapProud, 0, b0, b1, -OAK.battenDepth, strapTop, IRON));
    solids.push(box(COVER_W, COVER_W + OAK.strapProud, b0, b1, -OAK.battenDepth, strapTop, IRON));
    for (let a = OAK.nailSpacing / 2; a < COVER_W; a += OAK.nailSpacing) {
      solids.push(
        stud(a, COVER_H * row, OAK.nailRadius, strapTop, OAK.nailHeight, IRON_LIGHT, NAIL_SIDES),
      );
    }
  }
  const length = OAK.bracketLength;
  const thick = OAK.bracketThick;
  for (const [ca, cb, da, db] of [
    [0, 0, 1, 1],
    [COVER_W, 0, -1, 1],
    [0, COVER_H, 1, -1],
    [COVER_W, COVER_H, -1, -1],
  ] as const) {
    const along = (s: number, e: number): readonly [number, number] => [
      Math.min(s, e),
      Math.max(s, e),
    ];
    const [a0, a1] = along(ca, ca + da * length);
    const [b0, b1] = along(cb, cb + db * thick);
    const bracketTop = top + OAK.bracketProud;
    solids.push(box(a0, a1, b0, b1, top, bracketTop, IRON));
    const [c0, c1] = along(ca, ca + da * thick);
    const [d0, d1] = along(cb + db * thick, cb + db * length);
    solids.push(box(c0, c1, d0, d1, top, bracketTop, IRON));
    const corner = thick / 2;
    const far = length * OAK.bracketFarNail;
    for (const [na, nb] of [
      [corner, corner],
      [far, corner],
      [corner, far],
    ] as const) {
      solids.push(
        stud(
          ca + da * na,
          cb + db * nb,
          OAK.nailRadius,
          bracketTop,
          OAK.nailHeight,
          IRON_LIGHT,
          NAIL_SIDES,
        ),
      );
    }
  }
  return solids;
}

/** Tipped up on its east edge, past upright so its battens show, then dragged a little aside. */
function oakPose(t: number): Pose {
  const lift = easeInOut(t / OAK.liftShare);
  const drag = easeInOut((t - OAK.dragFrom) / (1 - OAK.dragFrom));
  return {
    axis: 'y',
    pivot: { x: COVER.right, y: 0, z: 0 },
    angle: degrees(OAK.liftDeg) * lift,
    drag: { x: OAK.drag.x * drag, y: OAK.drag.y * drag, z: 0 },
  };
}

// ── The steel hatch ─────────────────────────────────────────────────────────

const steelTop: Decor = (pen) => {
  const n = STEEL.thickness;
  const band = STEEL.band;
  const outer: V3[] = [
    { x: 0, y: 0, z: n },
    { x: COVER_W, y: 0, z: n },
    { x: COVER_W, y: COVER_H, z: n },
    { x: 0, y: COVER_H, z: n },
  ];
  const inner: V3[] = [
    { x: band, y: band, z: n },
    { x: COVER_W - band, y: band, z: n },
    { x: COVER_W - band, y: COVER_H - band, z: n },
    { x: band, y: COVER_H - band, z: n },
  ];
  const tread = STEEL.tread;
  pen.ctx.lineWidth = Math.max(MIN_LINE_PX, pen.px * tread.width);
  for (let b = band + tread.start; b < COVER_H - band; b += tread.spacing) {
    const stagger = (Math.round((b - band) / tread.spacing) % 2) * tread.startA;
    for (
      let a = band + tread.startA + stagger;
      a < COVER_W - band - tread.end;
      a += tread.spacing
    ) {
      pen.trace([
        { x: a - tread.halfA, y: b + tread.halfB, z: n },
        { x: a + tread.halfA, y: b - tread.halfB, z: n },
      ]);
      pen.ctx.strokeStyle = pen.lit(STEEL.plate, tread.light);
      pen.ctx.stroke();
    }
  }
  // Hazard paint round the edge, worn back to steel at the corners.
  const ctx = pen.ctx;
  ctx.save();
  pen.trace(outer, true);
  pen.trace(inner, true, true);
  ctx.clip('evenodd');
  pen.trace(outer, true);
  ctx.fillStyle = pen.lit(STEEL.hazardBlack);
  ctx.fill();
  ctx.fillStyle = pen.lit(STEEL.hazardYellow);
  const period = STEEL.stripePeriod;
  for (let offset = -COVER_H; offset < COVER_W + COVER_H; offset += period) {
    pen.trace(
      [
        { x: offset, y: 0, z: n },
        { x: offset + period / 2, y: 0, z: n },
        { x: offset + period / 2 - COVER_H, y: COVER_H, z: n },
        { x: offset - COVER_H, y: COVER_H, z: n },
      ],
      true,
    );
    ctx.fill();
  }
  const worn = STEEL.wornPatch;
  // A negative offset counts back from the far edge.
  const fromEdge = (offset: number, span: number): number => (offset < 0 ? span + offset : offset);
  const patches = [
    ...STEEL.wornPatches.map(([a, b]) => [fromEdge(a, COVER_W), fromEdge(b, COVER_H)] as const),
    [COVER_W * STEEL.wornSouth.a, fromEdge(STEEL.wornSouth.b, COVER_H)] as const,
  ];
  for (const [a, b] of patches) {
    pen.trace(
      [
        { x: a, y: b, z: n },
        { x: a + worn.a1, y: b + worn.b1, z: n },
        { x: a + worn.a2, y: b + worn.b2, z: n },
        { x: a + worn.a3, y: b + worn.b3, z: n },
      ],
      true,
    );
    ctx.fillStyle = pen.lit(STEEL.plate, worn.light);
    ctx.fill();
  }
  ctx.restore();
};

function steelSolids(): Solid[] {
  const solids: Solid[] = [box(0, COVER_W, 0, COVER_H, 0, STEEL.thickness, STEEL.plate, steelTop)];
  const top = STEEL.thickness;
  const inner = STEEL_RIVET_LINE;
  const rivet = (a: number, b: number): Solid =>
    stud(a, b, STEEL.rivetRadius, top, STEEL.rivetHeight, STEEL.rivet, NAIL_SIDES);
  // A hair of slack, so the last rivet of a row is not lost to rounding.
  const rowEnd = COVER_W - inner + STEEL.rivetSpacing * ROW_END_SLACK;
  for (let a = inner; a <= rowEnd; a += STEEL.rivetSpacing) {
    solids.push(rivet(a, inner), rivet(a, COVER_H - inner));
  }
  for (let b = inner + STEEL.rivetSpacing; b < COVER_H - inner; b += STEEL.rivetSpacing) {
    solids.push(rivet(inner, b), rivet(COVER_W - inner, b));
  }
  const half = STEEL.band / 2;
  for (const [a, b] of [
    [half, COVER_H / 2],
    [COVER_W - half, COVER_H / 2],
    [COVER_W / 2, COVER_H - half],
    [half, COVER_H - half],
    [COVER_W - half, COVER_H - half],
  ] as const) {
    solids.push(stud(a, b, STEEL.boltRadius, top, STEEL.boltHeight, STEEL.rivet, NAIL_SIDES));
  }
  // Hinge knuckles along the north edge, which the hatch turns on.
  const knuckle = STEEL.knuckle;
  for (const center of STEEL.knuckles) {
    const a = COVER_W * center;
    solids.push(
      box(
        a - knuckle.half,
        a + knuckle.half,
        knuckle.north,
        knuckle.south,
        knuckle.below,
        top + knuckle.proud,
        STEEL.underside,
      ),
    );
  }
  // The underside: a flange round the edge, a cross brace and the latch bar.
  const depth = -STEEL.ribDepth;
  const rib = STEEL.ribWidth;
  solids.push(box(0, COVER_W, 0, rib, depth, 0, STEEL.underside));
  solids.push(box(0, COVER_W, COVER_H - rib, COVER_H, depth, 0, STEEL.underside));
  solids.push(box(0, rib, rib, COVER_H - rib, depth, 0, STEEL.underside));
  solids.push(box(COVER_W - rib, COVER_W, rib, COVER_H - rib, depth, 0, STEEL.underside));
  for (const [from, to] of [
    [
      { a: rib, b: rib },
      { a: COVER_W - rib, b: COVER_H - rib },
    ],
    [
      { a: COVER_W - rib, b: rib },
      { a: rib, b: COVER_H - rib },
    ],
  ] as const) {
    const da = to.a - from.a;
    const db = to.b - from.b;
    const length = Math.hypot(da, db);
    const wa = (-db / length) * (rib / 2);
    const wb = (da / length) * (rib / 2);
    solids.push({
      base: [
        { a: from.a + wa, b: from.b + wb },
        { a: to.a + wa, b: to.b + wb },
        { a: to.a - wa, b: to.b - wb },
        { a: from.a - wa, b: from.b - wb },
      ],
      n0: depth * STEEL.braceDepthShare,
      n1: 0,
      color: STEEL.underside,
    });
  }
  const latch = STEEL.latchBar;
  const latchBottom = depth * latch.depthShare;
  solids.push(
    box(
      latch.inset,
      COVER_W - latch.inset,
      COVER_H * latch.fromShare,
      COVER_H * latch.toShare,
      latchBottom,
      0,
      STEEL.latch,
    ),
  );
  solids.push(
    stud(
      COVER_W / 2,
      COVER_H / 2,
      latch.boltRadius,
      latchBottom - latch.boltHeight,
      latch.boltHeight,
      STEEL.rivet,
      NAIL_SIDES,
    ),
  );
  return solids;
}

/** Swung up on its north hinges, gathering speed, and slammed back just past upright. */
function steelPose(t: number): Pose {
  const slam = STEEL.slamShare;
  const swing =
    t < slam ? (t / slam) ** 2 : 1 - Math.sin(((t - slam) / (1 - slam)) * Math.PI) * STEEL.bounce;
  return {
    axis: 'x',
    pivot: { x: 0, y: COVER.top, z: 0 },
    angle: degrees(STEEL.swingDeg) * swing,
    drag: { x: 0, y: 0, z: 0 },
  };
}

// ── The bronze grate ────────────────────────────────────────────────────────

/** Clips a polygon in the cover's plane to one side of the seam: `keepWest` keeps a < seam. */
function clipToSide(points: readonly V2[], seam: number, keepWest: boolean): V2[] {
  const inside = (p: V2): boolean => (keepWest ? p.a <= seam : p.a >= seam);
  const out: V2[] = [];
  points.forEach((p, index) => {
    const q = points[(index + 1) % points.length];
    if (inside(p)) out.push(p);
    if (inside(p) !== inside(q)) {
      const share = (seam - p.a) / (q.a - p.a);
      out.push({ a: seam, b: p.b + (q.b - p.b) * share });
    }
  });
  return out;
}

function circle(a: number, b: number, radius: number, sides: number): V2[] {
  const points: V2[] = [];
  for (let side = 0; side < sides; side++) {
    const angle = (side / sides) * Math.PI * 2;
    points.push({ a: a + Math.cos(angle) * radius, b: b + Math.sin(angle) * radius });
  }
  return points;
}

/**
 * Taloncrest's hawk, as shares of the crest's radius: each wing a fan of
 * feather tips from the shoulder out, the body a tall oval, the head, and a
 * tail spreading below.
 */
const HAWK = {
  feathers: 5,
  shoulder: { a: 0.08, b: -0.12 },
  tipFrom: { a: 0.22, b: -0.5 },
  tipReach: { a: 0.5, b: 0.62 },
  notchFrom: { a: 0.2, b: -0.32 },
  notchReach: { a: 0.42, b: 0.6 },
  wingRoot: { a: 0.1, b: 0.18 },
  body: { b: 0.05, radius: 0.14, stretch: 2, sides: 10 },
  head: { b: -0.32, radius: 0.11, sides: 8 },
  tail: { half: 0.1, top: 0.3, foot: 0.62 },
} as const;

/** Taloncrest's hawk, wings spread, as polygons on the crest's face. */
function hawkShapes(ca: number, cb: number, r: number): V2[][] {
  const shapes: V2[][] = [];
  for (const side of [-1, 1]) {
    const wing: V2[] = [{ a: ca + side * r * HAWK.shoulder.a, b: cb + r * HAWK.shoulder.b }];
    for (let feather = 0; feather <= HAWK.feathers; feather++) {
      const t = feather / HAWK.feathers;
      wing.push({
        a: ca + side * r * (HAWK.tipFrom.a + HAWK.tipReach.a * t),
        b: cb + r * (HAWK.tipFrom.b + HAWK.tipReach.b * t),
      });
      if (feather < HAWK.feathers) {
        wing.push({
          a: ca + side * r * (HAWK.notchFrom.a + HAWK.notchReach.a * t),
          b: cb + r * (HAWK.notchFrom.b + HAWK.notchReach.b * t),
        });
      }
    }
    wing.push({ a: ca + side * r * HAWK.wingRoot.a, b: cb + r * HAWK.wingRoot.b });
    shapes.push(side < 0 ? wing : [...wing].reverse());
  }
  const bodyB = cb + r * HAWK.body.b;
  shapes.push(
    circle(ca, bodyB, r * HAWK.body.radius, HAWK.body.sides).map((p) => ({
      a: p.a,
      b: bodyB + (p.b - bodyB) * HAWK.body.stretch,
    })),
  );
  shapes.push(circle(ca, cb + r * HAWK.head.b, r * HAWK.head.radius, HAWK.head.sides));
  shapes.push([
    { a: ca - r * HAWK.tail.half, b: cb + r * HAWK.tail.top },
    { a: ca, b: cb + r * HAWK.tail.foot },
    { a: ca + r * HAWK.tail.half, b: cb + r * HAWK.tail.top },
  ]);
  return shapes;
}

function bronzeLeafSolids(side: 'west' | 'east', haspSpread: number): Solid[] {
  const seam = COVER_W / 2;
  const a0 = side === 'west' ? 0 : seam;
  const a1 = side === 'west' ? seam : COVER_W;
  const n = BRONZE.thickness;
  const frame = BRONZE.frame;
  const keepWest = side === 'west';
  const solids: Solid[] = [];
  const verdigris = BRONZE.verdigrisSpecks;
  const specks: Decor = (pen) => {
    for (let i = 0; i < verdigris.count; i++) {
      const p = pen.project({
        x: a0 + (a1 - a0) * (verdigris.from + verdigris.step * i),
        y: i % 2 === 0 ? frame * verdigris.north : COVER_H - frame * verdigris.south,
        z: n,
      });
      pen.ctx.beginPath();
      pen.ctx.arc(p.x, p.y, Math.max(MIN_DOT_PX, pen.px * verdigris.radius), 0, Math.PI * 2);
      pen.ctx.fillStyle = pen.lit(BRONZE.verdigris, verdigris.alpha);
      pen.ctx.fill();
    }
  };
  solids.push(box(a0, a1, 0, frame, 0, n, BRONZE.metal, specks));
  solids.push(box(a0, a1, COVER_H - frame, COVER_H, 0, n, BRONZE.metal));
  const outerA = side === 'west' ? a0 : a1 - frame;
  solids.push(box(outerA, outerA + frame, frame, COVER_H - frame, 0, n, BRONZE.metal));
  const stileW = frame * BRONZE.seamStile;
  const stileA = side === 'west' ? seam - stileW : seam;
  solids.push(box(stileA, stileA + stileW, frame, COVER_H - frame, 0, n, BRONZE.metal));

  const innerA0 = side === 'west' ? a0 + frame : seam;
  const innerA1 = side === 'west' ? seam : a1 - frame;
  for (let bar = BRONZE.barSpacing; bar < COVER_W - frame; bar += BRONZE.barSpacing) {
    if (bar <= innerA0 + BRONZE.barWidth || bar >= innerA1 - BRONZE.barWidth) continue;
    solids.push(
      box(
        bar - BRONZE.barWidth / 2,
        bar + BRONZE.barWidth / 2,
        frame,
        COVER_H - frame,
        BRONZE.barInset,
        n - BRONZE.barInset,
        BRONZE.metal,
      ),
    );
  }
  for (const row of BRONZE.railRows) {
    const b = COVER_H * row;
    solids.push(
      box(innerA0, innerA1, b - BRONZE.railHalf, b + BRONZE.railHalf, 0, n, BRONZE.metal),
    );
    for (let bar = BRONZE.barSpacing; bar < COVER_W - frame; bar += BRONZE.barSpacing) {
      if (bar <= innerA0 + BRONZE.barWidth || bar >= innerA1 - BRONZE.barWidth) continue;
      solids.push(stud(bar, b, BRONZE.rosetteRadius, n, BRONZE.rosetteHeight, BRONZE.light));
    }
  }

  const crest = BRONZE.crest;
  const ca = COVER_W * crest.a;
  const cb = COVER_H * crest.b;
  const cr = COVER_W * crest.radius;
  const crestBase = clipToSide(circle(ca, cb, cr, CIRCLE_SIDES), seam, keepWest);
  const crestTop = n + BRONZE.crestProud;
  solids.push({
    base: crestBase,
    n0: 0,
    n1: crestTop,
    color: BRONZE.metal,
    top: (pen) => {
      const z = crestTop;
      pen.trace(
        clipToSide(circle(ca, cb, cr * BRONZE.crestRing, CIRCLE_SIDES), seam, keepWest).map(
          (p) => ({
            x: p.a,
            y: p.b,
            z,
          }),
        ),
      );
      pen.ctx.strokeStyle = pen.lit(BRONZE.dark);
      pen.ctx.lineWidth = Math.max(MIN_DOT_PX, pen.px * BRONZE.crestRingWidth);
      pen.ctx.stroke();
      for (const shape of hawkShapes(ca, cb, cr)) {
        const clipped = clipToSide(shape, seam, keepWest);
        if (clipped.length < 3) continue;
        pen.trace(
          clipped.map((p) => ({ x: p.a, y: p.b, z })),
          true,
        );
        pen.ctx.fillStyle = pen.lit(BRONZE.dark, BRONZE.hawkAlpha);
        pen.ctx.fill();
      }
    },
  });

  const hasp = BRONZE.hasp;
  const haspA =
    side === 'west' ? seam - hasp.westGap - haspSpread : seam + hasp.eastGap + haspSpread;
  solids.push(
    box(
      haspA,
      haspA + hasp.width,
      hasp.b - hasp.halfB,
      hasp.b + hasp.halfB,
      n,
      n + hasp.proud,
      BRONZE.light,
    ),
  );
  return solids;
}

/** Each leaf turned about its outer edge: the west leaf first, then the east, each folding back past upright. */
function bronzePoses(t: number): { west: Pose; east: Pose } {
  const fold = degrees(BRONZE.foldDeg);
  const leaf = BRONZE.leafShare;
  return {
    west: {
      axis: 'y',
      pivot: { x: COVER.left, y: 0, z: 0 },
      angle: -fold * easeInOut(t / leaf),
      drag: { x: 0, y: 0, z: 0 },
    },
    east: {
      axis: 'y',
      pivot: { x: COVER.right, y: 0, z: 0 },
      angle: fold * easeInOut((t - leaf) / (1 - leaf)),
      drag: { x: 0, y: 0, z: 0 },
    },
  };
}

/** The shade the steps sit in under a shut grate, lifting as it opens. */
function paintUnderShade(ctx: Ctx, f: CoverFrame, opening: number): void {
  const alpha = BRONZE.underShade * (1 - opening);
  if (alpha <= 0) return;
  const nw = project(f, { x: COVER.left, y: COVER.top, z: 0 });
  const se = project(f, { x: COVER.right, y: COVER.bottom, z: 0 });
  ctx.fillStyle = withAlpha(worldPalette.shade, alpha);
  ctx.fillRect(nw.x, nw.y, se.x - nw.x, se.y - nw.y);
}

/**
 * Paints a seal's cover `opening` of the way open (0 shut, 1 at rest open),
 * from the frame's footprint corner. `haspSpread` is how far the grate's
 * hasps have sprung apart once its padlock has gone.
 */
export function paintCoverModel(
  ctx: Ctx,
  f: CoverFrame,
  style: StairwellStyleId,
  opening: number,
  haspSpread: number,
): void {
  switch (style) {
    case 'cellars':
      renderParts(ctx, f, [
        { solids: oakSolids(), pose: opening <= 0 ? CLOSED : oakPose(opening) },
      ]);
      return;
    case 'service_level':
      renderParts(ctx, f, [
        { solids: steelSolids(), pose: opening <= 0 ? CLOSED : steelPose(opening) },
      ]);
      return;
    case 'street': {
      paintUnderShade(ctx, f, opening);
      const poses = opening <= 0 ? { west: CLOSED, east: CLOSED } : bronzePoses(opening);
      renderParts(ctx, f, [
        { solids: bronzeLeafSolids('west', haspSpread), pose: poses.west },
        { solids: bronzeLeafSolids('east', haspSpread), pose: poses.east },
      ]);
      return;
    }
    default: {
      const unhandled: never = style;
      return unhandled;
    }
  }
}

/** How far up the screen the shut cover's top face stands above the floor, as a footprint fraction. */
export function coverTopLift(style: StairwellStyleId): number {
  switch (style) {
    case 'cellars':
      return (OAK.thickness + OAK.strapProud) * HEIGHT_TO_SCREEN;
    case 'service_level':
      return STEEL.thickness * HEIGHT_TO_SCREEN;
    case 'street':
      return BRONZE.thickness * HEIGHT_TO_SCREEN;
    default: {
      const unhandled: never = style;
      return unhandled;
    }
  }
}

/** Traces the lines gold light races along on the shut cover, as drawn: straps, rivet rows, the crest. */
export function traceCoverRunes(ctx: Ctx, f: CoverFrame, style: StairwellStyleId): void {
  const at = (a: number, b: number, z: number): { x: number; y: number } =>
    project(f, place({ x: a, y: b, z }, CLOSED));
  const line = (points: readonly { x: number; y: number }[]): void => {
    points.forEach((p, index) => {
      if (index === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    });
  };
  switch (style) {
    case 'cellars': {
      const z = OAK.thickness + OAK.strapProud;
      for (const row of OAK.strapRows)
        line([at(0, COVER_H * row, z), at(COVER_W, COVER_H * row, z)]);
      const reach = OAK.bracketLength;
      const inset = OAK.bracketThick / 2;
      line([at(reach, inset, z), at(inset, inset, z), at(inset, reach, z)]);
      line([
        at(COVER_W - reach, inset, z),
        at(COVER_W - inset, inset, z),
        at(COVER_W - inset, reach, z),
      ]);
      line([
        at(reach, COVER_H - inset, z),
        at(inset, COVER_H - inset, z),
        at(inset, COVER_H - reach, z),
      ]);
      line([
        at(COVER_W - reach, COVER_H - inset, z),
        at(COVER_W - inset, COVER_H - inset, z),
        at(COVER_W - inset, COVER_H - reach, z),
      ]);
      return;
    }
    case 'service_level': {
      const z = STEEL.thickness;
      const inner = STEEL_RIVET_LINE;
      line([
        at(inner, inner, z),
        at(COVER_W - inner, inner, z),
        at(COVER_W - inner, COVER_H - inner, z),
        at(inner, COVER_H - inner, z),
        at(inner, inner, z),
      ]);
      return;
    }
    case 'street': {
      const z = BRONZE.thickness;
      const frame = BRONZE.frame;
      line([
        at(frame, frame, z),
        at(COVER_W - frame, frame, z),
        at(COVER_W - frame, COVER_H - frame, z),
        at(frame, COVER_H - frame, z),
        at(frame, frame, z),
      ]);
      for (const row of BRONZE.railRows)
        line([at(frame, COVER_H * row, z), at(COVER_W - frame, COVER_H * row, z)]);
      const crestZ = z + BRONZE.crestProud;
      const ring = circle(
        COVER_W * BRONZE.crest.a,
        COVER_H * BRONZE.crest.b,
        COVER_W * BRONZE.crest.radius * BRONZE.crestRing,
        CIRCLE_SIDES,
      );
      line([...ring, ring[0]].map((p) => at(p.a, p.b, crestZ)));
      line([at(COVER_W / 2, frame, z), at(COVER_W / 2, COVER_H - frame, z)]);
      return;
    }
    default: {
      const unhandled: never = style;
      return unhandled;
    }
  }
}
