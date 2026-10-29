/**
 * The great white the Kraken keeps, stranded on the pump room's wet concrete
 * once the flood drains away.
 *
 * Every pose is drawn in the fish's own frame: `s` runs along it in tiles from
 * the middle of its trunk (positive toward the nose) and `d` runs across it in
 * tiles (negative toward its back on a fish lying on its side, toward its far
 * flank on one lying belly-up). A pose maps that frame onto the floor, bending
 * the spine for a curled carcass and foreshortening the floor's depth for the
 * camera's tilt, so fins, gills and teeth all follow the body wherever it lies.
 *
 * Shading is banded rather than graded: every tone change is a hard edge at a
 * fraction of the way across the body, so the fish reads as solid at the 32 px
 * tile instead of airbrushed. Light falls from the upper left as on every prop.
 *
 * Painted once into a prop-sheet cell at floor load.
 */

import { mulberry32, type Rng } from '../person/rng';
import { GREAT_WHITE_INK as INK } from './greatWhiteInk';
import { lerp, TWO_PI } from './propPaint';

type Ctx = CanvasRenderingContext2D;

interface Pt {
  readonly x: number;
  readonly y: number;
}

/** The ways the carcass can lie, one sheet frame each. */
export const DEAD_SHARK_POSES = ['onSide', 'bellyUp', 'curled'] as const;
export type DeadSharkPose = (typeof DEAD_SHARK_POSES)[number];
export const DEAD_SHARK_VARIANTS = DEAD_SHARK_POSES.length;

/**
 * Where the carcass sits in its cell, in tiles from the anchor tile's
 * top-left. The sheet's cell reaches one and a half tiles either side of the
 * anchor tile, half a tile above it and one below.
 */
const PLACEMENT = {
  /** The trunk's middle sits a touch east of the tile's centre, because the tail reaches further than the snout. */
  midX: 0.56,
  /** A curled tail swings its upper lobe out behind it, so the curled fish sits further east. */
  curledShiftX: 0.14,
  spineY: 0.42,
} as const;

/** The fish's outline, in tiles. */
const BODY = {
  nose: 1.6,
  peduncle: -1.18,
  /** Half the trunk's depth at its deepest, just behind the pectoral fins. */
  maxHalfDepth: 0.41,
  peduncleHalfDepth: 0.075,
  /** How far from the peduncle (0) to the nose (1) the trunk is deepest. */
  deepestAt: 0.54,
  /** How quickly the trunk narrows into the peduncle: above 1 keeps it full further back. */
  tailTaper: 1.35,
  /** The snout's taper: a heavy cone, blunt at the tip rather than pointed or round. */
  snoutConePower: 1.35,
  snoutConeRoundness: 0.9,
  /** The snout tip rides above the trunk's midline, with the mouth slung under it. */
  snoutLift: 0.1,
  snoutLiftFrom: 0.68,
  /** The weight of a fish out of water slumps its underside onto the floor. */
  bellySag: 0.06,
} as const;

/** Outline samples per edge; enough that a 4-tile curve shows no facets at 3×. */
const OUTLINE_SAMPLES = 56;

/** The floor's depth on screen, as a share of its width, for the camera's tilt. */
const FLOOR_FORESHORTEN = 0.74;

/**
 * How tightly a pose bends its spine, in radians per tile, ahead of the
 * trunk's middle and behind it. A dead fish stiffens head-first, so the curled
 * pose bows mostly through its tail.
 */
interface SpineBend {
  readonly front: number;
  readonly rear: number;
}
const STRAIGHT: SpineBend = { front: 0, rear: 0 };
const CURLED: SpineBend = { front: 0.2, rear: 0.36 };

/**
 * Banded tones across a fish lying on its side, as fractions from the back (0)
 * to the belly (1). The crown of the flank faces the light; the belly turns
 * away from it toward the floor.
 */
const SIDE_BANDS = {
  litFrom: 0.05,
  litTo: 0.2,
  bellyShadeFrom: 0.79,
  bellyDeepFrom: 0.92,
  /** The wet glints sit on the lit crown. */
  glintAt: 0.11,
} as const;

/**
 * The countershading line, as a fraction of the way from back to belly at
 * points along the fish (0 peduncle, 1 nose). It drops under the eye and
 * reaches down to the mouth's corner, as a great white's does.
 */
type CourseKnot = readonly [along: number, across: number];
const COUNTERSHADE_COURSE: readonly [CourseKnot, ...CourseKnot[]] = [
  [0, 0.5],
  [0.3, 0.56],
  [0.52, 0.5],
  [0.7, 0.5],
  [0.85, 0.6],
  [1, 0.74],
];
/** How ragged the line is: grey tongues reaching down into the white, and short white bites back. */
const COUNTERSHADE_TEETH = 30;
const COUNTERSHADE_TONGUE = 0.11;
const COUNTERSHADE_BITE = 0.035;

/** The fins of a fish on its side, in tiles and in shares along the fish. */
const SIDE_FINS = {
  dorsalFront: 0.63,
  dorsalRear: 0.47,
  dorsalApexAt: 0.51,
  dorsalHeight: 0.52,
  /** How far the apex sweeps back past its base. */
  dorsalSweep: 0.08,
  secondDorsalAt: 0.12,
  secondDorsalHeight: 0.09,
  analAt: 0.09,
  analHeight: 0.08,
  pelvicAt: 0.3,
  pelvicLength: 0.15,
  pectoralFront: 0.69,
  pectoralRear: 0.625,
  pectoralRootDepth: 0.62,
  /** The tip lies on the floor past the belly, swept back along the fish. */
  pectoralReachBack: 0.66,
  pectoralReachOut: 0.24,
  /** The black-tipped share of the fin. */
  pectoralTipShare: 0.26,
  farPectoralReachBack: 0.5,
  farPectoralReachOut: 0.16,
} as const;

/** A crescent tail with near-equal lobes, in tiles back from the peduncle. */
const TAIL = {
  upperReach: 0.6,
  upperSpread: 0.66,
  lowerReach: 0.52,
  lowerSpread: 0.58,
  notchReach: 0.24,
  /** The lateral keel along the peduncle's flank, as a share of the fish back from the peduncle. */
  keelLength: 0.09,
} as const;

/** The head's details, as shares along the fish and fractions across it. */
const HEAD = {
  gillCount: 5,
  gillFirst: 0.68,
  gillLast: 0.77,
  gillTop: 0.22,
  gillBottom: 0.7,
  gillBow: 0.03,
  eyeAt: 0.885,
  eyeDepth: 0.34,
  eyeRadius: 0.05,
  mouthCornerAt: 0.8,
  mouthCornerDepth: 0.7,
  upperJawTipAt: 0.972,
  upperJawTipDepth: 0.93,
  /** The jaw hangs a little open, the lower jaw dropped onto the floor. */
  jawDrop: 0.17,
  lowerJawTipAt: 0.945,
  upperTeeth: 8,
  lowerTeeth: 5,
  upperToothLength: 0.1,
  lowerToothLength: 0.07,
} as const;

/** The wet streaks along the lit crown, as spans along the fish. */
const SIDE_GLINTS: ReadonlyArray<readonly [number, number]> = [
  [0.16, 0.27],
  [0.31, 0.42],
  [0.66, 0.76],
  [0.83, 0.93],
];
const DROPLETS = 4;

/** The belly-up pose: how wide the body lies and how much of its near flank shows. */
const BELLY_UP = {
  /** Half the body's width, as a share of half its depth. */
  widthShare: 0.9,
  /** The near flank shows below the belly, as a share of half the depth. */
  nearFlankShare: 0.5,
  /** The white underside's share of the way across, before the near flank's grey. */
  whiteTo: 0.72,
  farRim: 0.1,
  shadeFrom: 0.5,
  flankDeepFrom: 0.9,
  pectoralFront: 0.7,
  pectoralRear: 0.63,
  pectoralReachBack: 0.78,
  pectoralReachOut: 0.46,
  pelvicAt: 0.3,
  pelvicReachBack: 0.14,
  pelvicReachOut: 0.16,
  analAt: 0.1,
  mouthCornerAt: 0.79,
  mouthApexAt: 0.905,
  mouthInnerApexAt: 0.85,
  mouthFrom: 0.07,
  mouthTo: 0.69,
  teeth: 8,
  toothLength: 0.06,
  gillFarFrom: 0.04,
  gillFarTo: 0.17,
  gillNearFrom: 0.58,
  gillNearTo: 0.7,
  eyeAt: 0.9,
  eyeAcross: 0.84,
  glintAcross: 0.17,
} as const;
const BELLY_UP_GLINTS: ReadonlyArray<readonly [number, number]> = [
  [0.22, 0.34],
  [0.4, 0.52],
  [0.72, 0.84],
];

/** The floor under the carcass. */
const GROUND = {
  stainBlobs: 7,
  stainReach: 0.48,
  stainDepth: 0.36,
  coreDepth: 0.22,
  /** The stain spreads past the fish's ends by this much, in tiles. */
  stainOverhang: 0.04,
  /** The last blob sits short of the nose, so the stain ends inside the cell. */
  stainNoseReach: 0.86,
  /** The chance each blob of the stain catches a streak of light. */
  sheenChance: 0.7,
  sheenLength: 0.22,
  contactDepth: 0.09,
  bloodAt: 0.84,
  bloodReach: 0.3,
  bloodDepth: 0.12,
} as const;

/** Wet floor and grounding tones: the drain's silty runoff darkening the concrete. */
const WET_STAIN = 'rgba(24, 28, 24, 0.34)';
const WET_CORE = 'rgba(12, 14, 12, 0.28)';
const PUDDLE_SHEEN = 'rgba(206, 214, 206, 0.38)';
const CONTACT = 'rgba(6, 8, 6, 0.55)';
const FIN_SHADOW = 'rgba(10, 12, 12, 0.38)';
const BLOOD_SEEP = 'rgba(112, 16, 22, 0.55)';
const BLOOD_CORE = 'rgba(84, 8, 14, 0.6)';

const POSE_SEEDS = {
  onSide: 0x5a4c,
  bellyUp: 0xb311,
  curled: 0xc0e1,
} as const satisfies Record<DeadSharkPose, number>;

// ── The fish's frame ─────────────────────────────────────────────────────────

/** 0 below `from`, 1 above `to`, eased between. */
function smoothstep(from: number, to: number, value: number): number {
  const t = Math.min(1, Math.max(0, (value - from) / (to - from)));
  return t * t * (3 - 2 * t);
}

/** Half the trunk's depth at `u`, 0 at the peduncle to 1 at the nose. */
function halfDepth(u: number): number {
  if (u <= BODY.deepestAt) {
    const t = u / BODY.deepestAt;
    const swell = Math.sin((t * Math.PI) / 2) ** BODY.tailTaper;
    return lerp(BODY.peduncleHalfDepth, BODY.maxHalfDepth, swell);
  }
  const t = (u - BODY.deepestAt) / (1 - BODY.deepestAt);
  return BODY.maxHalfDepth * Math.max(0, 1 - t ** BODY.snoutConePower) ** BODY.snoutConeRoundness;
}

function midline(u: number): number {
  return -BODY.snoutLift * smoothstep(BODY.snoutLiftFrom, 1, u);
}

const along = (u: number) => lerp(BODY.peduncle, BODY.nose, u);

function countershadeCourse(u: number): number {
  let previous = COUNTERSHADE_COURSE[0];
  for (const knot of COUNTERSHADE_COURSE) {
    if (u <= knot[0]) {
      const span = knot[0] - previous[0];
      return span > 0 ? lerp(previous[1], knot[1], (u - previous[0]) / span) : knot[1];
    }
    previous = knot;
  }
  return previous[1];
}
const HALF_WAY = 0.5;

/** How far the ragged line strays from its course at `u`. */
function jagAt(u: number, teeth: ReadonlyArray<number>): number {
  const position = Math.min(1, Math.max(0, u)) * (teeth.length - 1);
  const index = Math.min(Math.floor(position), teeth.length - 2);
  return lerp(teeth[index] ?? 0, teeth[index + 1] ?? 0, position - index);
}

/** The countershading line's fraction across the fish at `u`. */
function countershadeAt(u: number, teeth: ReadonlyArray<number>): number {
  return countershadeCourse(u) + jagAt(u, teeth);
}

/** Alternating tongues and bites, so the line has sharp points rather than waves. */
function countershadeTeeth(rng: Rng): number[] {
  return Array.from({ length: COUNTERSHADE_TEETH + 1 }, (_, i) =>
    i % 2 === 1 ? COUNTERSHADE_TONGUE * (0.35 + rng() * 0.65) : -COUNTERSHADE_BITE * rng(),
  );
}

/**
 * Maps the fish's frame onto the floor and the floor onto the cell. `edges`
 * give the fish's two outlines across it at each point along it; everything
 * else is placed as a fraction between them or as an offset in tiles.
 */
interface FishFrame {
  place(s: number, d: number): Pt;
  /** The near-side outline (0) and the far-side outline (1) across the fish at `u`. */
  edge(u: number, side: 0 | 1): number;
  at(u: number, across: number): Pt;
}

function fishFrame(
  cx: number,
  cy: number,
  ts: number,
  bend: SpineBend,
  edge: (u: number, side: 0 | 1) => number,
): FishFrame {
  const place = (s: number, d: number): Pt => {
    const curl = s >= 0 ? bend.front : bend.rear;
    if (curl === 0) return { x: cx + s * ts, y: cy + d * ts * FLOOR_FORESHORTEN };
    // Each half of the spine is an arc leaving the trunk's middle level, so the halves meet without a kink.
    const radius = 1 / curl;
    const angle = s * curl;
    const spineX = radius * Math.sin(angle);
    const spineY = radius * (1 - Math.cos(angle));
    const x = spineX - d * Math.sin(angle);
    const y = spineY + d * Math.cos(angle);
    return { x: cx + x * ts, y: cy + y * ts * FLOOR_FORESHORTEN };
  };
  return {
    place,
    edge,
    at: (u, across) => place(along(u), lerp(edge(u, 0), edge(u, 1), across)),
  };
}

// ── Path helpers ─────────────────────────────────────────────────────────────

const moveTo = (ctx: Ctx, p: Pt) => ctx.moveTo(p.x, p.y);
const lineTo = (ctx: Ctx, p: Pt) => ctx.lineTo(p.x, p.y);
const quadTo = (ctx: Ctx, c: Pt, p: Pt) => ctx.quadraticCurveTo(c.x, c.y, p.x, p.y);

/** The strip of the body between two fractions across it, over a span along it. */
function band(
  ctx: Ctx,
  fish: FishFrame,
  from: (u: number) => number,
  to: (u: number) => number,
  u0 = 0,
  u1 = 1,
): void {
  ctx.beginPath();
  for (let i = 0; i <= OUTLINE_SAMPLES; i++) {
    const u = lerp(u0, u1, i / OUTLINE_SAMPLES);
    const p = fish.at(u, from(u));
    if (i === 0) moveTo(ctx, p);
    else lineTo(ctx, p);
  }
  for (let i = OUTLINE_SAMPLES; i >= 0; i--) {
    const u = lerp(u0, u1, i / OUTLINE_SAMPLES);
    lineTo(ctx, fish.at(u, to(u)));
  }
  ctx.closePath();
}

const constant = (value: number) => () => value;

function strokeAlong(
  ctx: Ctx,
  fish: FishFrame,
  across: number,
  u0: number,
  u1: number,
  colour: string,
  width: number,
): void {
  ctx.strokeStyle = colour;
  ctx.lineWidth = width;
  ctx.lineCap = 'round';
  ctx.beginPath();
  const steps = Math.max(2, Math.ceil(OUTLINE_SAMPLES * (u1 - u0)));
  for (let i = 0; i <= steps; i++) {
    const p = fish.at(lerp(u0, u1, i / steps), across);
    if (i === 0) moveTo(ctx, p);
    else lineTo(ctx, p);
  }
  ctx.stroke();
}

/**
 * Paints a set of shapes as one silhouette: every outline first, then every
 * fill, so the dark rim runs round the whole fish and never across a join
 * where a fin meets the body.
 */
function silhouette(ctx: Ctx, shapes: ReadonlyArray<() => void>, fill: string): void {
  ctx.strokeStyle = INK.outline;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.lineJoin = 'round';
  for (const shape of shapes) {
    shape();
    ctx.stroke();
  }
  ctx.fillStyle = fill;
  for (const shape of shapes) {
    shape();
    ctx.fill();
  }
}
/** Stroked under the fill, so one pixel of it shows outside the shape. */
const OUTLINE_WIDTH = 2;

function fillShape(ctx: Ctx, shape: () => void, colour: string): void {
  ctx.fillStyle = colour;
  shape();
  ctx.fill();
}

function withClip(ctx: Ctx, shape: () => void, paint: () => void): void {
  ctx.save();
  try {
    shape();
    ctx.clip();
    paint();
  } finally {
    ctx.restore();
  }
}

// ── The floor under it ───────────────────────────────────────────────────────

/**
 * The damp the carcass sits in: an irregular stain of runoff darker than the
 * dry concrete, a wetter core under the body, a few bright streaks where the
 * standing water catches the light, and the blood still seeping from the gills.
 */
function paintGround(ctx: Ctx, fish: FishFrame, rng: Rng, ts: number, ventralSide: 0 | 1) {
  const blobs = Array.from({ length: GROUND.stainBlobs }, (_, i) => {
    const u = lerp(-GROUND.stainOverhang, GROUND.stainNoseReach, i / (GROUND.stainBlobs - 1));
    const clampedU = Math.min(1, Math.max(0, u));
    const centre = fish.place(along(u), fish.edge(clampedU, ventralSide) * HALF_WAY);
    return {
      centre,
      rx: ts * GROUND.stainReach * (0.7 + rng() * 0.5),
      ry: ts * GROUND.stainDepth * FLOOR_FORESHORTEN * (0.7 + rng() * 0.5),
    };
  });
  const blobPath = (shrink: number, depth: number) => {
    ctx.beginPath();
    for (const blob of blobs) {
      ctx.moveTo(blob.centre.x + blob.rx * shrink, blob.centre.y);
      ctx.ellipse(
        blob.centre.x,
        blob.centre.y + depth,
        blob.rx * shrink,
        blob.ry * shrink,
        0,
        0,
        TWO_PI,
      );
    }
  };
  ctx.fillStyle = WET_STAIN;
  blobPath(1, ts * GROUND.stainDepth * HALF_WAY);
  ctx.fill();
  ctx.fillStyle = WET_CORE;
  blobPath(GROUND.coreDepth / GROUND.stainDepth, ts * GROUND.coreDepth * HALF_WAY);
  ctx.fill();

  ctx.strokeStyle = PUDDLE_SHEEN;
  ctx.lineWidth = 1;
  ctx.lineCap = 'round';
  for (const blob of blobs) {
    if (rng() > GROUND.sheenChance) continue;
    const x = blob.centre.x + (rng() - HALF_WAY) * blob.rx;
    const y = blob.centre.y + ts * GROUND.stainDepth * HALF_WAY + blob.ry * (0.55 + rng() * 0.3);
    const length = ts * GROUND.sheenLength * (0.5 + rng() * 0.5);
    ctx.beginPath();
    ctx.moveTo(x - length / 2, y);
    ctx.lineTo(x + length / 2, y);
    ctx.stroke();
  }

  const blood = fish.place(along(GROUND.bloodAt), fish.edge(GROUND.bloodAt, ventralSide));
  ctx.fillStyle = BLOOD_SEEP;
  ctx.beginPath();
  ctx.ellipse(
    blood.x,
    blood.y + ts * GROUND.bloodDepth * HALF_WAY,
    ts * GROUND.bloodReach,
    ts * GROUND.bloodDepth,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.fillStyle = BLOOD_CORE;
  ctx.beginPath();
  ctx.ellipse(
    blood.x,
    blood.y + ts * GROUND.bloodDepth * HALF_WAY,
    ts * GROUND.bloodReach * HALF_WAY,
    ts * GROUND.bloodDepth * HALF_WAY,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
}

/** The hard shadow where the body's weight meets the floor. */
function paintContact(ctx: Ctx, fish: FishFrame, ts: number, side: 0 | 1) {
  ctx.fillStyle = CONTACT;
  ctx.beginPath();
  for (let i = 0; i <= OUTLINE_SAMPLES; i++) {
    const u = i / OUTLINE_SAMPLES;
    const p = fish.place(along(u), fish.edge(u, side));
    const drop = ts * GROUND.contactDepth * Math.sin(Math.PI * u) ** HALF_WAY;
    if (i === 0) ctx.moveTo(p.x, p.y + drop);
    else ctx.lineTo(p.x, p.y + drop);
  }
  for (let i = OUTLINE_SAMPLES; i >= 0; i--) {
    const u = i / OUTLINE_SAMPLES;
    lineTo(ctx, fish.at(u, side === 1 ? CONTACT_REACH_IN : 1 - CONTACT_REACH_IN));
  }
  ctx.closePath();
  ctx.fill();
}
/** How far up the body the contact shadow starts, hidden under the fill, so it has no gap at the rim. */
const CONTACT_REACH_IN = 0.8;

function paintDroplets(ctx: Ctx, fish: FishFrame, rng: Rng, from: number, to: number) {
  ctx.fillStyle = INK.wetSpecular;
  for (let i = 0; i < DROPLETS; i++) {
    const p = fish.at(DROPLET_SPAN_FROM + rng() * DROPLET_SPAN, lerp(from, to, rng()));
    ctx.fillRect(Math.round(p.x), Math.round(p.y), 1, 1);
  }
}
const DROPLET_SPAN_FROM = 0.1;
const DROPLET_SPAN = 0.8;

// ── Lying on its side ────────────────────────────────────────────────────────

function sideEdge(u: number, side: 0 | 1): number {
  if (side === 0) return midline(u) - halfDepth(u);
  return midline(u) + halfDepth(u) + BODY.bellySag * Math.sin(Math.PI * u);
}

/** The tail's crescent, both lobes lying flat on the floor. */
function tailShape(ctx: Ctx, fish: FishFrame): () => void {
  const root = BODY.peduncle;
  const mid = midline(0);
  const top = fish.edge(0, 0);
  const bottom = fish.edge(0, 1);
  const upperTip = fish.place(root - TAIL.upperReach, mid - TAIL.upperSpread);
  const lowerTip = fish.place(root - TAIL.lowerReach, mid + TAIL.lowerSpread);
  const notch = fish.place(root - TAIL.notchReach, mid);
  return () => {
    ctx.beginPath();
    moveTo(ctx, fish.place(root + TAIL_OVERLAP, top));
    quadTo(ctx, fish.place(root - TAIL.upperReach * 0.35, top - TAIL.upperSpread * 0.4), upperTip);
    quadTo(ctx, fish.place(root - TAIL.notchReach * 1.3, mid - TAIL.upperSpread * 0.25), notch);
    quadTo(ctx, fish.place(root - TAIL.notchReach * 1.3, mid + TAIL.lowerSpread * 0.25), lowerTip);
    quadTo(
      ctx,
      fish.place(root - TAIL.lowerReach * 0.35, bottom + TAIL.lowerSpread * 0.4),
      fish.place(root + TAIL_OVERLAP, bottom),
    );
    ctx.closePath();
  };
}
/** The tail's root tucks this far under the peduncle so no seam shows. */
const TAIL_OVERLAP = 0.04;

/** A small fin rising from one outline: second dorsal, anal or pelvic. */
function nubFin(
  ctx: Ctx,
  fish: FishFrame,
  at: number,
  length: number,
  height: number,
  side: 0 | 1,
): () => void {
  const outward = side === 0 ? -1 : 1;
  const front = at + length / (BODY.nose - BODY.peduncle);
  const rear = at - (length * NUB_REAR_SHARE) / (BODY.nose - BODY.peduncle);
  const tip = fish.place(along(rear) - length * NUB_SWEEP, fish.edge(at, side) + outward * height);
  return () => {
    ctx.beginPath();
    moveTo(ctx, fish.at(front, side === 0 ? NUB_ROOT_DEPTH : 1 - NUB_ROOT_DEPTH));
    lineTo(ctx, tip);
    lineTo(ctx, fish.at(rear, side === 0 ? NUB_ROOT_DEPTH : 1 - NUB_ROOT_DEPTH));
    ctx.closePath();
  };
}
const NUB_REAR_SHARE = 0.3;
const NUB_SWEEP = 0.6;
const NUB_ROOT_DEPTH = 0.06;

function dorsalShape(ctx: Ctx, fish: FishFrame): () => void {
  const front = fish.at(SIDE_FINS.dorsalFront, DORSAL_ROOT_DEPTH);
  const rear = fish.at(SIDE_FINS.dorsalRear, DORSAL_ROOT_DEPTH);
  const top = fish.edge(SIDE_FINS.dorsalApexAt, 0);
  const apexS = along(SIDE_FINS.dorsalApexAt) - SIDE_FINS.dorsalSweep;
  const apex = fish.place(apexS, top - SIDE_FINS.dorsalHeight);
  const leading = fish.place(
    along(SIDE_FINS.dorsalFront) - SIDE_FINS.dorsalSweep,
    top - SIDE_FINS.dorsalHeight * DORSAL_LEADING_BOW,
  );
  const trailing = fish.place(apexS + SIDE_FINS.dorsalSweep, top - SIDE_FINS.dorsalHeight * 0.25);
  return () => {
    ctx.beginPath();
    moveTo(ctx, front);
    quadTo(ctx, leading, apex);
    quadTo(ctx, trailing, rear);
    ctx.closePath();
  };
}
const DORSAL_ROOT_DEPTH = 0.08;
const DORSAL_LEADING_BOW = 0.75;

/** A long sickle fin from a root on the body, its tip swept back. */
function sickle(
  ctx: Ctx,
  rootFront: Pt,
  rootRear: Pt,
  tip: Pt,
  leadingControl: Pt,
  trailingControl: Pt,
): () => void {
  return () => {
    ctx.beginPath();
    moveTo(ctx, rootFront);
    quadTo(ctx, leadingControl, tip);
    quadTo(ctx, trailingControl, rootRear);
    ctx.closePath();
  };
}

function sidePectoral(ctx: Ctx, fish: FishFrame, near: boolean): () => void {
  const reachBack = near ? SIDE_FINS.pectoralReachBack : SIDE_FINS.farPectoralReachBack;
  const reachOut = near ? SIDE_FINS.pectoralReachOut : SIDE_FINS.farPectoralReachOut;
  const rootDepth = near ? SIDE_FINS.pectoralRootDepth : 1 - NUB_ROOT_DEPTH;
  const front = along(SIDE_FINS.pectoralFront);
  const belly = fish.edge(SIDE_FINS.pectoralRear, 1);
  const tip = fish.place(front - reachBack, belly + reachOut);
  return sickle(
    ctx,
    fish.at(SIDE_FINS.pectoralFront, rootDepth),
    fish.at(SIDE_FINS.pectoralRear, rootDepth + PECTORAL_ROOT_SLANT),
    tip,
    fish.place(front - reachBack * 0.3, belly + reachOut * 0.85),
    fish.place(front - reachBack * 0.62, belly - reachOut * 0.2),
  );
}
const PECTORAL_ROOT_SLANT = 0.04;

function paintFinTip(ctx: Ctx, shape: () => void, tip: Pt, reach: number) {
  withClip(ctx, shape, () => {
    ctx.fillStyle = INK.finTip;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, reach, 0, TWO_PI);
    ctx.fill();
  });
}

function paintGills(ctx: Ctx, fish: FishFrame, from: number, to: number) {
  ctx.strokeStyle = INK.gill;
  ctx.lineWidth = 1;
  ctx.lineCap = 'butt';
  for (let g = 0; g < HEAD.gillCount; g++) {
    const u = lerp(HEAD.gillFirst, HEAD.gillLast, g / (HEAD.gillCount - 1));
    // The rearmost slits are the longest, as on the fish.
    const length = lerp(GILL_SHORTEST, 1, g / (HEAD.gillCount - 1));
    const top = fish.at(u, lerp(to, from, length));
    const bottom = fish.at(u - GILL_SLANT, to);
    const bow = fish.at(u + HEAD.gillBow, lerp(from, to, HALF_WAY));
    ctx.beginPath();
    moveTo(ctx, top);
    quadTo(ctx, bow, bottom);
    ctx.stroke();
  }
}
const GILL_SHORTEST = 0.72;
const GILL_SLANT = 0.012;

function paintEye(ctx: Ctx, p: Pt, ts: number) {
  const r = Math.max(1, ts * HEAD.eyeRadius);
  ctx.fillStyle = INK.eye;
  ctx.beginPath();
  ctx.arc(p.x, p.y, r, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = INK.eyeGlint;
  ctx.fillRect(Math.round(p.x - r * HALF_WAY), Math.round(p.y - r * HALF_WAY), 1, 1);
}

/** A row of triangular teeth along a curve, pointing toward `toward`. */
function teethAlong(
  ctx: Ctx,
  from: Pt,
  control: Pt,
  to: Pt,
  count: number,
  length: number,
  toward: (t: number) => Pt,
) {
  const curve = (t: number): Pt => ({
    x: (1 - t) * (1 - t) * from.x + 2 * (1 - t) * t * control.x + t * t * to.x,
    y: (1 - t) * (1 - t) * from.y + 2 * (1 - t) * t * control.y + t * t * to.y,
  });
  ctx.fillStyle = INK.tooth;
  ctx.beginPath();
  for (let i = 0; i < count; i++) {
    const t0 = (i + TOOTH_MARGIN) / (count + TOOTH_MARGIN * 2);
    const t1 = (i + 1 + TOOTH_MARGIN) / (count + TOOTH_MARGIN * 2);
    const a = curve(t0);
    const b = curve(t1);
    const mid = curve((t0 + t1) / 2);
    const aim = toward((t0 + t1) / 2);
    const dx = aim.x - mid.x;
    const dy = aim.y - mid.y;
    const norm = Math.hypot(dx, dy) || 1;
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(mid.x + (dx / norm) * length, mid.y + (dy / norm) * length);
    ctx.lineTo(b.x, b.y);
  }
  ctx.fill();
}
const TOOTH_MARGIN = 0.4;

function paintSideMouth(ctx: Ctx, fish: FishFrame, ts: number) {
  const corner = fish.at(HEAD.mouthCornerAt, HEAD.mouthCornerDepth);
  const upperTip = fish.at(HEAD.upperJawTipAt, HEAD.upperJawTipDepth);
  const upperControl = fish.at(
    lerp(HEAD.mouthCornerAt, HEAD.upperJawTipAt, JAW_CONTROL_AT),
    lerp(HEAD.mouthCornerDepth, 1, JAW_CONTROL_AT),
  );
  const lowerTip = fish.place(
    along(HEAD.lowerJawTipAt),
    fish.edge(HEAD.lowerJawTipAt, 1) + HEAD.jawDrop,
  );
  const lowerControl = fish.place(
    along(lerp(HEAD.mouthCornerAt, HEAD.lowerJawTipAt, JAW_CONTROL_AT)),
    fish.edge(HEAD.mouthCornerAt, 1) + HEAD.jawDrop * HALF_WAY,
  );
  const chinBack = fish.at(HEAD.mouthCornerAt - CHIN_LENGTH, 1);
  const chinUnder = fish.place(
    along(lerp(HEAD.mouthCornerAt, HEAD.lowerJawTipAt, HALF_WAY)),
    fish.edge(HEAD.mouthCornerAt, 1) + HEAD.jawDrop * CHIN_DROP,
  );

  const chin = () => {
    ctx.beginPath();
    moveTo(ctx, corner);
    quadTo(ctx, lowerControl, lowerTip);
    quadTo(ctx, chinUnder, chinBack);
    ctx.closePath();
  };
  silhouette(ctx, [chin], INK.belly);
  withClip(ctx, chin, () => {
    fillShape(ctx, chinShade(ctx, fish, chinUnder, lowerTip, chinBack), INK.bellyShade);
  });

  const gap = () => {
    ctx.beginPath();
    moveTo(ctx, corner);
    quadTo(ctx, upperControl, upperTip);
    lineTo(ctx, lowerTip);
    quadTo(ctx, lowerControl, corner);
    ctx.closePath();
  };
  fillShape(ctx, gap, INK.mouth);
  teethAlong(ctx, corner, upperControl, upperTip, HEAD.upperTeeth, ts * HEAD.upperToothLength, () =>
    fish.place(along(HEAD.mouthCornerAt), fish.edge(HEAD.mouthCornerAt, 1) + 1),
  );
  teethAlong(ctx, corner, lowerControl, lowerTip, HEAD.lowerTeeth, ts * HEAD.lowerToothLength, () =>
    fish.at(HEAD.upperJawTipAt, 0),
  );
}
const JAW_CONTROL_AT = 0.55;
const CHIN_LENGTH = 0.05;
const CHIN_DROP = 1.1;

function chinShade(ctx: Ctx, fish: FishFrame, under: Pt, tip: Pt, back: Pt): () => void {
  const lifted = fish.at(HEAD.mouthCornerAt, CHIN_SHADE_FROM);
  return () => {
    ctx.beginPath();
    moveTo(ctx, lifted);
    lineTo(ctx, tip);
    quadTo(ctx, under, back);
    ctx.closePath();
  };
}
const CHIN_SHADE_FROM = 1.05;

function paintKeel(ctx: Ctx, fish: FishFrame) {
  const mid = (u: number) => {
    const top = fish.edge(u, 0);
    const bottom = fish.edge(u, 1);
    return (midline(u) - top) / (bottom - top);
  };
  ctx.lineWidth = 1;
  ctx.strokeStyle = INK.backShade;
  ctx.beginPath();
  for (let i = 0; i <= KEEL_STEPS; i++) {
    const u = (TAIL.keelLength * i) / KEEL_STEPS;
    const p = fish.at(u, mid(u) + KEEL_HALF_WIDTH);
    if (i === 0) moveTo(ctx, p);
    else lineTo(ctx, p);
  }
  ctx.stroke();
  ctx.strokeStyle = INK.backRim;
  ctx.beginPath();
  for (let i = 0; i <= KEEL_STEPS; i++) {
    const u = (TAIL.keelLength * i) / KEEL_STEPS;
    const p = fish.at(u, mid(u) - KEEL_HALF_WIDTH);
    if (i === 0) moveTo(ctx, p);
    else lineTo(ctx, p);
  }
  ctx.stroke();
}
const KEEL_STEPS = 4;
const KEEL_HALF_WIDTH = 0.12;

function paintOnSide(ctx: Ctx, fish: FishFrame, rng: Rng, ts: number) {
  const teeth = countershadeTeeth(rng);
  const countershade = (u: number) => countershadeAt(u, teeth);

  paintGround(ctx, fish, rng, ts, 1);
  paintContact(ctx, fish, ts, 1);

  const body = () => band(ctx, fish, constant(0), constant(1));
  const tail = tailShape(ctx, fish);
  const dorsal = dorsalShape(ctx, fish);
  const secondDorsal = nubFin(
    ctx,
    fish,
    SIDE_FINS.secondDorsalAt,
    NUB_LENGTH,
    SIDE_FINS.secondDorsalHeight,
    0,
  );
  const anal = nubFin(ctx, fish, SIDE_FINS.analAt, NUB_LENGTH, SIDE_FINS.analHeight, 1);
  const pelvic = nubFin(
    ctx,
    fish,
    SIDE_FINS.pelvicAt,
    SIDE_FINS.pelvicLength,
    SIDE_FINS.pelvicLength * HALF_WAY,
    1,
  );
  const farPectoral = sidePectoral(ctx, fish, false);

  silhouette(ctx, [farPectoral], INK.backShade);
  silhouette(ctx, [tail, dorsal, secondDorsal, anal, pelvic, body], INK.back);

  // The belly's white, under the countershading line.
  fillShape(ctx, () => band(ctx, fish, countershade, constant(1)), INK.belly);
  fillShape(
    ctx,
    () => band(ctx, fish, constant(SIDE_BANDS.bellyShadeFrom), constant(1)),
    INK.bellyShade,
  );
  fillShape(
    ctx,
    () => band(ctx, fish, constant(SIDE_BANDS.bellyDeepFrom), constant(1)),
    INK.bellyDeep,
  );
  fillShape(
    ctx,
    () => band(ctx, fish, constant(SIDE_BANDS.litFrom), constant(SIDE_BANDS.litTo)),
    INK.backLight,
  );
  fillShape(ctx, pelvic, INK.bellyShade);

  // The tail's lower lobe and the dorsal's trailing half turn away from the light.
  withClip(ctx, tail, () => {
    ctx.fillStyle = INK.backShade;
    const mid = fish.place(BODY.peduncle, midline(0));
    ctx.fillRect(mid.x - ts * TAIL.upperReach * 2, mid.y, ts * TAIL.upperReach * 2, ts);
  });
  withClip(ctx, dorsal, () => {
    const apex = fish.place(
      along(SIDE_FINS.dorsalApexAt) - SIDE_FINS.dorsalSweep,
      fish.edge(SIDE_FINS.dorsalApexAt, 0) - SIDE_FINS.dorsalHeight,
    );
    const base = fish.at(lerp(SIDE_FINS.dorsalRear, SIDE_FINS.dorsalFront, DORSAL_SHADE_SPLIT), 0);
    ctx.fillStyle = INK.backShade;
    ctx.beginPath();
    moveTo(ctx, apex);
    lineTo(ctx, base);
    lineTo(ctx, { x: base.x - ts, y: base.y });
    lineTo(ctx, { x: apex.x - ts, y: apex.y });
    ctx.closePath();
    ctx.fill();
  });
  paintKeel(ctx, fish);

  paintGills(ctx, fish, HEAD.gillTop, HEAD.gillBottom);

  // The near pectoral pressed flat along the flank, throwing its shadow on the body below it.
  const pectoral = sidePectoral(ctx, fish, true);
  ctx.save();
  ctx.translate(0, ts * FIN_SHADOW_DROP);
  fillShape(ctx, pectoral, FIN_SHADOW);
  ctx.restore();
  silhouette(ctx, [pectoral], INK.back);
  const pectoralTip = fish.place(
    along(SIDE_FINS.pectoralFront) - SIDE_FINS.pectoralReachBack,
    fish.edge(SIDE_FINS.pectoralRear, 1) + SIDE_FINS.pectoralReachOut,
  );
  paintFinTip(
    ctx,
    pectoral,
    pectoralTip,
    ts * SIDE_FINS.pectoralReachBack * SIDE_FINS.pectoralTipShare,
  );
  withClip(ctx, pectoral, () => {
    ctx.translate(0, -ts * FIN_LIT_EDGE);
    fillShape(ctx, pectoral, INK.backLight);
  });

  paintSideMouth(ctx, fish, ts);
  paintEye(ctx, fish.at(HEAD.eyeAt, HEAD.eyeDepth), ts);

  for (const [u0, u1] of SIDE_GLINTS) {
    strokeAlong(ctx, fish, SIDE_BANDS.glintAt, u0, u1, INK.wetSpecular, 1);
  }
  const dorsalGlintFrom = fish.at(SIDE_FINS.dorsalFront, 0);
  const dorsalGlintTo = fish.place(
    along(SIDE_FINS.dorsalApexAt) - SIDE_FINS.dorsalSweep * HALF_WAY,
    fish.edge(SIDE_FINS.dorsalApexAt, 0) - SIDE_FINS.dorsalHeight * DORSAL_GLINT_REACH,
  );
  ctx.beginPath();
  moveTo(ctx, { x: dorsalGlintFrom.x - 1, y: dorsalGlintFrom.y - 1 });
  lineTo(ctx, dorsalGlintTo);
  ctx.stroke();
  paintDroplets(ctx, fish, rng, SIDE_BANDS.litTo, countershade(HALF_WAY));
}
const NUB_LENGTH = 0.12;
const FIN_SHADOW_DROP = 0.07;
const FIN_LIT_EDGE = 0.05;
const DORSAL_SHADE_SPLIT = 0.45;
const DORSAL_GLINT_REACH = 0.6;

// ── Belly up ─────────────────────────────────────────────────────────────────

function bellyUpEdge(u: number, side: 0 | 1): number {
  const depth = halfDepth(u);
  if (side === 0) return -depth * BELLY_UP.widthShare;
  return depth * (BELLY_UP.widthShare + BELLY_UP.nearFlankShare);
}

function bellyUpPectoral(ctx: Ctx, fish: FishFrame, side: 0 | 1): { shape: () => void; tip: Pt } {
  const outward = side === 0 ? -1 : 1;
  const rootAcross = side === 0 ? NUB_ROOT_DEPTH : BELLY_UP.whiteTo;
  const front = along(BELLY_UP.pectoralFront);
  const edge = fish.edge(BELLY_UP.pectoralRear, side);
  const tip = fish.place(
    front - BELLY_UP.pectoralReachBack,
    edge + outward * BELLY_UP.pectoralReachOut,
  );
  return {
    tip,
    shape: sickle(
      ctx,
      fish.at(BELLY_UP.pectoralFront, rootAcross),
      fish.at(BELLY_UP.pectoralRear, rootAcross),
      tip,
      fish.place(
        front - BELLY_UP.pectoralReachBack * 0.25,
        edge + outward * BELLY_UP.pectoralReachOut * 0.8,
      ),
      fish.place(
        front - BELLY_UP.pectoralReachBack * 0.62,
        edge + outward * BELLY_UP.pectoralReachOut * 0.2,
      ),
    ),
  };
}

function bellyUpPelvic(ctx: Ctx, fish: FishFrame, side: 0 | 1): () => void {
  const outward = side === 0 ? -1 : 1;
  const across = side === 0 ? NUB_ROOT_DEPTH * 2 : BELLY_UP.whiteTo - NUB_ROOT_DEPTH;
  const front = BELLY_UP.pelvicAt + PELVIC_ROOT_SPAN;
  const tip = fish.place(
    along(BELLY_UP.pelvicAt) - BELLY_UP.pelvicReachBack,
    fish.edge(BELLY_UP.pelvicAt, side) + outward * BELLY_UP.pelvicReachOut,
  );
  return () => {
    ctx.beginPath();
    moveTo(ctx, fish.at(front, across));
    lineTo(ctx, tip);
    lineTo(ctx, fish.at(BELLY_UP.pelvicAt - PELVIC_ROOT_SPAN, across));
    ctx.closePath();
  };
}
const PELVIC_ROOT_SPAN = 0.03;

function paintBellyUpMouth(ctx: Ctx, fish: FishFrame, ts: number) {
  const mouthMid = lerp(BELLY_UP.mouthFrom, BELLY_UP.mouthTo, HALF_WAY);
  const farCorner = fish.at(BELLY_UP.mouthCornerAt, BELLY_UP.mouthFrom);
  const nearCorner = fish.at(BELLY_UP.mouthCornerAt, BELLY_UP.mouthTo);
  // A quadratic through its control reaches only halfway, so the control sits twice as far out as the apex.
  const outerControl = fish.at(
    BELLY_UP.mouthCornerAt + (BELLY_UP.mouthApexAt - BELLY_UP.mouthCornerAt) * 2,
    mouthMid,
  );
  const innerControl = fish.at(
    BELLY_UP.mouthCornerAt + (BELLY_UP.mouthInnerApexAt - BELLY_UP.mouthCornerAt) * 2,
    mouthMid,
  );
  ctx.fillStyle = INK.mouth;
  ctx.beginPath();
  moveTo(ctx, farCorner);
  quadTo(ctx, outerControl, nearCorner);
  quadTo(ctx, innerControl, farCorner);
  ctx.closePath();
  ctx.fill();
  const back = fish.at(BELLY_UP.mouthCornerAt - MOUTH_AIM_BACK, mouthMid);
  teethAlong(
    ctx,
    farCorner,
    outerControl,
    nearCorner,
    BELLY_UP.teeth,
    ts * BELLY_UP.toothLength,
    () => back,
  );
}
const MOUTH_AIM_BACK = 0.3;

function paintBellyUpGills(ctx: Ctx, fish: FishFrame) {
  ctx.strokeStyle = INK.gill;
  ctx.lineWidth = 1;
  for (const [from, to] of [
    [BELLY_UP.gillFarFrom, BELLY_UP.gillFarTo],
    [BELLY_UP.gillNearFrom, BELLY_UP.gillNearTo],
  ] as const) {
    for (let g = 0; g < HEAD.gillCount; g++) {
      const u = lerp(HEAD.gillFirst, HEAD.gillLast, g / (HEAD.gillCount - 1));
      ctx.beginPath();
      moveTo(ctx, fish.at(u, from));
      lineTo(ctx, fish.at(u - GILL_SLANT, to));
      ctx.stroke();
    }
  }
}

function paintBellyUp(ctx: Ctx, fish: FishFrame, rng: Rng, ts: number) {
  const teeth = countershadeTeeth(rng);
  const nearLine = (u: number) => BELLY_UP.whiteTo + jagAt(u, teeth) * HALF_WAY;
  const farLine = (u: number) => BELLY_UP.farRim + jagAt(u, teeth) * FAR_RIM_JAG;

  paintGround(ctx, fish, rng, ts, 1);
  paintContact(ctx, fish, ts, 1);

  const body = () => band(ctx, fish, constant(0), constant(1));
  const tail = tailShape(ctx, fish);
  const anal = nubFin(ctx, fish, BELLY_UP.analAt, NUB_LENGTH, SIDE_FINS.analHeight, 1);
  const farPectoral = bellyUpPectoral(ctx, fish, 0);
  const nearPectoral = bellyUpPectoral(ctx, fish, 1);
  const farPelvic = bellyUpPelvic(ctx, fish, 0);
  const nearPelvic = bellyUpPelvic(ctx, fish, 1);

  silhouette(ctx, [tail, anal, body], INK.back);
  fillShape(ctx, () => band(ctx, fish, farLine, nearLine), INK.belly);
  fillShape(ctx, () => band(ctx, fish, constant(BELLY_UP.shadeFrom), nearLine), INK.bellyShade);
  fillShape(
    ctx,
    () => band(ctx, fish, constant(BELLY_UP.flankDeepFrom), constant(1)),
    INK.backShade,
  );
  withClip(ctx, tail, () => {
    ctx.fillStyle = INK.backShade;
    const mid = fish.place(BODY.peduncle, midline(0));
    ctx.fillRect(mid.x - ts * TAIL.upperReach * 2, mid.y, ts * TAIL.upperReach * 2, ts);
  });

  // The fins' undersides are white, each pectoral with the black tip a great white is known by.
  for (const { shape, tip } of [farPectoral, nearPectoral]) {
    ctx.save();
    ctx.translate(0, ts * FIN_SHADOW_DROP);
    fillShape(ctx, shape, FIN_SHADOW);
    ctx.restore();
    silhouette(ctx, [shape], INK.belly);
    withClip(ctx, shape, () => {
      ctx.translate(0, ts * FIN_LIT_EDGE);
      fillShape(ctx, shape, INK.bellyShade);
    });
    paintFinTip(
      ctx,
      shape,
      tip,
      ts * BELLY_UP.pectoralReachBack * SIDE_FINS.pectoralTipShare * BELLY_UP_TIP_SCALE,
    );
  }
  silhouette(ctx, [farPelvic, nearPelvic], INK.belly);

  paintBellyUpGills(ctx, fish);
  paintBellyUpMouth(ctx, fish, ts);
  paintEye(ctx, fish.at(BELLY_UP.eyeAt, BELLY_UP.eyeAcross), ts);

  for (const [u0, u1] of BELLY_UP_GLINTS) {
    strokeAlong(ctx, fish, BELLY_UP.glintAcross, u0, u1, INK.backRim, 1);
  }
  for (const { tip } of [farPectoral, nearPectoral]) {
    ctx.fillStyle = INK.wetSpecular;
    ctx.fillRect(Math.round(tip.x + 1), Math.round(tip.y - 1), 1, 1);
  }
  paintDroplets(ctx, fish, rng, BELLY_UP.whiteTo, 1);
}
const FAR_RIM_JAG = 0.3;
const BELLY_UP_TIP_SCALE = 1.1;

// ── Entry point ──────────────────────────────────────────────────────────────

/**
 * A stranded great white across four tiles centred on the anchor tile at
 * (`ox`, `oy`), head to the east.
 */
export function paintDeadShark(ctx: Ctx, ox: number, oy: number, ts: number, pose: DeadSharkPose) {
  const cx = ox + ts * PLACEMENT.midX;
  const cy = oy + ts * PLACEMENT.spineY;
  const rng = mulberry32(POSE_SEEDS[pose]);
  ctx.save();
  try {
    switch (pose) {
      case 'onSide':
        paintOnSide(ctx, fishFrame(cx, cy, ts, STRAIGHT, sideEdge), rng, ts);
        break;
      case 'curled':
        paintOnSide(
          ctx,
          fishFrame(cx + ts * PLACEMENT.curledShiftX, cy, ts, CURLED, sideEdge),
          rng,
          ts,
        );
        break;
      case 'bellyUp':
        paintBellyUp(ctx, fishFrame(cx, cy, ts, STRAIGHT, bellyUpEdge), rng, ts);
        break;
      default: {
        const unhandled: never = pose;
        throw new Error(`Unhandled dead shark pose: ${String(unhandled)}`);
      }
    }
  } finally {
    ctx.restore();
  }
}
