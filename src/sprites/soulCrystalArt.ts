/**
 * The city's soul crystal, destabilized: a tall faceted violet bipyramid
 * hovering over a cracked, glowing patch of floor, with splinters of itself
 * orbiting it and arcs of energy jumping between them.
 *
 * It is the one thing the containment countdown asks the player to reach, so it
 * has to read as "the important object in this room" from across the office,
 * not as a decal. The silhouette carries most of that — nothing else indoors is
 * a tall floating gem — and the light does the rest: a pulsing core, a halo, a
 * glowing pool on the floor and cracks in the stone flickering brighter than the
 * facets around them.
 *
 * The body painter is shared with the inventory icon, so the thing the player
 * picks up is visibly the thing they walked to.
 *
 * Every glow is a fixed set of stops driven through `globalAlpha`, so the
 * pulse never keys a new texture in the radial-glow cache.
 */

import { drawRadialGlow, type GlowStop } from './radialGlow';

type Point = readonly [number, number];
type Facet = readonly Point[];

const FULL_CIRCLE = Math.PI * 2;
const HALF = 0.5;
/** Lines thinner than a device pixel render as faint grey; never go below this. */
const MIN_LINE_WIDTH = 1;

// ── Body geometry, as fractions of the crystal's height, about its centre ────

const TIP_TOP_Y = -0.5;
const TIP_TOP_X = 0.025;
const TIP_BOTTOM_Y = 0.5;
const TIP_BOTTOM_X = -0.015;
const UPPER_RING_Y = -0.2;
const LOWER_RING_Y = 0.2;
const OUTER_HALF_WIDTH = 0.23;
const FRONT_EDGE_X = 0.085;
/**
 * How much lower the two front-facing vertical edges sit than the side ones:
 * a ring seen slightly from above bows toward the viewer, which is what makes
 * the prism read as round rather than as a flat kite.
 */
const FRONT_EDGE_DROP = 0.045;

const UPPER_RING: readonly Point[] = [
  [-OUTER_HALF_WIDTH, UPPER_RING_Y],
  [-FRONT_EDGE_X, UPPER_RING_Y + FRONT_EDGE_DROP],
  [FRONT_EDGE_X, UPPER_RING_Y + FRONT_EDGE_DROP],
  [OUTER_HALF_WIDTH, UPPER_RING_Y],
];
const LOWER_RING: readonly Point[] = [
  [-OUTER_HALF_WIDTH, LOWER_RING_Y],
  [-FRONT_EDGE_X, LOWER_RING_Y + FRONT_EDGE_DROP],
  [FRONT_EDGE_X, LOWER_RING_Y + FRONT_EDGE_DROP],
  [OUTER_HALF_WIDTH, LOWER_RING_Y],
];
const TOP_TIP: Point = [TIP_TOP_X, TIP_TOP_Y];
const BOTTOM_TIP: Point = [TIP_BOTTOM_X, TIP_BOTTOM_Y];

function ringPoint(ring: readonly Point[], index: number): Point {
  return ring[index] ?? TOP_TIP;
}

const FACE_COUNT = 3;
const FACE_INDICES = [0, 1, 2] as const;

function crownFacet(face: number): Facet {
  return [TOP_TIP, ringPoint(UPPER_RING, face), ringPoint(UPPER_RING, face + 1)];
}
function bodyFacet(face: number): Facet {
  return [
    ringPoint(UPPER_RING, face),
    ringPoint(LOWER_RING, face),
    ringPoint(LOWER_RING, face + 1),
    ringPoint(UPPER_RING, face + 1),
  ];
}
function pavilionFacet(face: number): Facet {
  return [ringPoint(LOWER_RING, face), BOTTOM_TIP, ringPoint(LOWER_RING, face + 1)];
}

const SILHOUETTE: Facet = [
  TOP_TIP,
  ringPoint(UPPER_RING, FACE_COUNT),
  ringPoint(LOWER_RING, FACE_COUNT),
  BOTTOM_TIP,
  ringPoint(LOWER_RING, 0),
  ringPoint(UPPER_RING, 0),
];

/**
 * Facet tones, left to right, for light falling from the upper left. Separate
 * flat tones rather than one gradient: at icon size a smooth ramp collapses
 * into a single blob, and the hard steps between planes are what say "cut gem".
 */
const CROWN_TONES = ['#f3e4ff', '#d4a8ff', '#8f37e6'] as const;
const BODY_TONES = ['#b26cf7', '#8c3ae4', '#561596'] as const;
const PAVILION_TONES = ['#7a2ccc', '#5c18a6', '#360866'] as const;
const FALLBACK_TONE = '#6b21a8';

const OUTLINE_COLOR = '#1c0533';
const OUTLINE_WIDTH_FRACTION = 0.03;
const FACET_EDGE_COLOR = 'rgba(250, 232, 255, 0.55)';
const FACET_EDGE_WIDTH_FRACTION = 0.012;

// ── Inner light ─────────────────────────────────────────────────────────────

const CORE_GLOW_STOPS: readonly GlowStop[] = [
  { offset: 0, color: 'rgba(255, 236, 255, 1)' },
  { offset: 0.3, color: 'rgba(240, 130, 255, 0.75)' },
  { offset: 0.7, color: 'rgba(168, 70, 240, 0.25)' },
  { offset: 1, color: 'rgba(120, 40, 200, 0)' },
];
const CORE_CENTRE_Y = 0.04;
const CORE_RADIUS = 0.36;
const CORE_ALPHA_BASE = 0.62;
const CORE_ALPHA_SWING = 0.3;
/** Heartbeat-like: a quick double throb, then a rest. */
const HEARTBEAT_HZ = 1.1;
const HEARTBEAT_SECOND_BEAT_PHASE = 0.22;
/** How narrow each throb is: the beat decays by e every 1/this of a cycle. */
const HEARTBEAT_SHARPNESS = 30;

/** 0–1 throb, two quick beats per cycle — an unstable thing should not breathe evenly. */
export function soulCrystalHeartbeat(timeS: number): number {
  const phase = (timeS * HEARTBEAT_HZ) % 1;
  const beatAt = (centre: number): number =>
    Math.exp(-HEARTBEAT_SHARPNESS * Math.abs(phase - centre));
  return Math.min(1, beatAt(0) + beatAt(1) + beatAt(HEARTBEAT_SECOND_BEAT_PHASE));
}

// ── Cracks: the instability, flickering brighter than the stone ─────────────

/** Polylines in body units; each wanders from an edge toward the core. */
const CRACKS: readonly (readonly Point[])[] = [
  [
    [-0.2, -0.12],
    [-0.11, -0.05],
    [-0.08, 0.04],
    [0.01, 0.09],
  ],
  [
    [0.17, -0.27],
    [0.1, -0.16],
    [0.12, -0.05],
    [0.05, 0.02],
  ],
  [
    [0.02, 0.4],
    [0.06, 0.29],
    [-0.02, 0.2],
    [0.01, 0.1],
  ],
];
const CRACK_GLOW_COLOR = 'rgba(255, 120, 230, 0.55)';
const CRACK_CORE_COLOR = '#fff1ff';
const CRACK_GLOW_WIDTH_FRACTION = 0.045;
const CRACK_CORE_WIDTH_FRACTION = 0.014;
const CRACK_ALPHA_BASE = 0.55;
const CRACK_FLICKER_HZ = 7.3;
const CRACK_FLICKER_SWING = 0.3;
const CRACK_PHASE_STEP = 1.9;

// ── Specular ────────────────────────────────────────────────────────────────

const SHEEN: Facet = [
  [-0.17, -0.2],
  [-0.03, -0.42],
  [0.0, -0.39],
  [-0.12, -0.17],
];
const SHEEN_COLOR = 'rgba(255, 255, 255, 0.7)';
const BODY_SHEEN: Facet = [
  [-0.2, -0.14],
  [-0.15, -0.13],
  [-0.15, 0.14],
  [-0.2, 0.16],
];
const BODY_SHEEN_COLOR = 'rgba(255, 255, 255, 0.28)';

/** A star glint that crosses the tip once a cycle. */
const GLINT_PERIOD_S = 2.6;
const GLINT_DURATION_FRACTION = 0.16;
const GLINT_X = 0.03;
const GLINT_Y = -0.42;
const GLINT_LONG_ARM = 0.2;
const GLINT_SHORT_ARM = 0.1;
const GLINT_WAIST = 0.018;
const GLINT_COLOR = '#ffffff';

/** Unstable: a faint tremor that comes and goes rather than a constant buzz. */
const TREMOR_HZ = 23;
const TREMOR_ENVELOPE_HZ = 0.37;
const TREMOR_ENVELOPE_THRESHOLD = 0.55;
const TREMOR_AMPLITUDE = 0.012;

function tracePolygon(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  cx: number,
  cy: number,
  scale: number,
): void {
  ctx.beginPath();
  points.forEach(([px, py], index) => {
    const sx = cx + px * scale;
    const sy = cy + py * scale;
    if (index === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.closePath();
}

function strokePolyline(
  ctx: CanvasRenderingContext2D,
  points: readonly Point[],
  cx: number,
  cy: number,
  scale: number,
): void {
  ctx.beginPath();
  points.forEach(([px, py], index) => {
    const sx = cx + px * scale;
    const sy = cy + py * scale;
    if (index === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  });
  ctx.stroke();
}

function fillGlint(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  longArm: number,
  shortArm: number,
  waist: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x, y - longArm);
  ctx.lineTo(x + waist, y - waist);
  ctx.lineTo(x + shortArm, y);
  ctx.lineTo(x + waist, y + waist);
  ctx.lineTo(x, y + longArm);
  ctx.lineTo(x - waist, y + waist);
  ctx.lineTo(x - shortArm, y);
  ctx.lineTo(x - waist, y - waist);
  ctx.closePath();
  ctx.fill();
}

/**
 * The faceted body alone, centred on (cx, cy) and `height` pixels tall:
 * facets, core light, cracks, edges, sheen and the tip glint. No halo, no
 * shadow — those depend on where it is drawn.
 */
export function paintSoulCrystalBody(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  height: number,
  timeS: number,
): void {
  const tremorEnvelope = Math.max(
    0,
    Math.sin(timeS * FULL_CIRCLE * TREMOR_ENVELOPE_HZ) - TREMOR_ENVELOPE_THRESHOLD,
  );
  const tremor = Math.sin(timeS * FULL_CIRCLE * TREMOR_HZ) * tremorEnvelope * TREMOR_AMPLITUDE;
  const x = cx + tremor * height;

  ctx.save();
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';

  tracePolygon(ctx, SILHOUETTE, x, cy, height);
  ctx.strokeStyle = OUTLINE_COLOR;
  ctx.lineWidth = Math.max(MIN_LINE_WIDTH, height * OUTLINE_WIDTH_FRACTION) * 2;
  ctx.stroke();

  for (const face of FACE_INDICES) {
    tracePolygon(ctx, crownFacet(face), x, cy, height);
    ctx.fillStyle = CROWN_TONES[face] ?? FALLBACK_TONE;
    ctx.fill();
    tracePolygon(ctx, bodyFacet(face), x, cy, height);
    ctx.fillStyle = BODY_TONES[face] ?? FALLBACK_TONE;
    ctx.fill();
    tracePolygon(ctx, pavilionFacet(face), x, cy, height);
    ctx.fillStyle = PAVILION_TONES[face] ?? FALLBACK_TONE;
    ctx.fill();
  }

  tracePolygon(ctx, SILHOUETTE, x, cy, height);
  ctx.clip();

  const beat = soulCrystalHeartbeat(timeS);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = CORE_ALPHA_BASE + CORE_ALPHA_SWING * beat;
  drawRadialGlow(ctx, x, cy + CORE_CENTRE_Y * height, CORE_RADIUS * height, CORE_GLOW_STOPS);
  ctx.globalAlpha = 1;

  CRACKS.forEach((crack, index) => {
    const flicker =
      CRACK_ALPHA_BASE +
      CRACK_FLICKER_SWING *
        Math.sin(timeS * FULL_CIRCLE * CRACK_FLICKER_HZ + index * CRACK_PHASE_STEP) +
      CRACK_FLICKER_SWING * beat;
    ctx.globalAlpha = Math.max(0, Math.min(1, flicker));
    ctx.strokeStyle = CRACK_GLOW_COLOR;
    ctx.lineWidth = Math.max(MIN_LINE_WIDTH, height * CRACK_GLOW_WIDTH_FRACTION);
    strokePolyline(ctx, crack, x, cy, height);
    ctx.strokeStyle = CRACK_CORE_COLOR;
    ctx.lineWidth = Math.max(MIN_LINE_WIDTH * HALF, height * CRACK_CORE_WIDTH_FRACTION);
    strokePolyline(ctx, crack, x, cy, height);
  });
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';

  ctx.strokeStyle = FACET_EDGE_COLOR;
  ctx.lineWidth = Math.max(MIN_LINE_WIDTH * HALF, height * FACET_EDGE_WIDTH_FRACTION);
  for (const face of FACE_INDICES) {
    tracePolygon(ctx, bodyFacet(face), x, cy, height);
    ctx.stroke();
    tracePolygon(ctx, crownFacet(face), x, cy, height);
    ctx.stroke();
  }

  tracePolygon(ctx, SHEEN, x, cy, height);
  ctx.fillStyle = SHEEN_COLOR;
  ctx.fill();
  tracePolygon(ctx, BODY_SHEEN, x, cy, height);
  ctx.fillStyle = BODY_SHEEN_COLOR;
  ctx.fill();
  ctx.restore();

  const glintPhase = (timeS % GLINT_PERIOD_S) / GLINT_PERIOD_S;
  if (glintPhase < GLINT_DURATION_FRACTION) {
    const glintStrength = Math.sin((glintPhase / GLINT_DURATION_FRACTION) * Math.PI);
    ctx.save();
    ctx.globalAlpha *= glintStrength;
    ctx.fillStyle = GLINT_COLOR;
    fillGlint(
      ctx,
      x + GLINT_X * height,
      cy + GLINT_Y * height,
      GLINT_LONG_ARM * height * glintStrength,
      GLINT_SHORT_ARM * height * glintStrength,
      Math.max(MIN_LINE_WIDTH * HALF, GLINT_WAIST * height),
    );
    ctx.restore();
  }
}

// ── The world prop ──────────────────────────────────────────────────────────

/** Crystal height, in tiles. Taller than a crawler, so it stands out from them. */
const WORLD_CRYSTAL_HEIGHT_TILES = 1.3;
/** Gap between the floor and the crystal's lower tip, in tiles. */
const WORLD_HOVER_TILES = 0.32;
const WORLD_BOB_TILES = 0.06;
const WORLD_BOB_HZ = 0.45;

const HALO_STOPS: readonly GlowStop[] = [
  { offset: 0, color: 'rgba(214, 120, 255, 0.55)' },
  { offset: 0.45, color: 'rgba(160, 60, 240, 0.22)' },
  { offset: 1, color: 'rgba(110, 30, 200, 0)' },
];
const HALO_RADIUS_TILES = 1.35;
const HALO_ALPHA_BASE = 0.55;
const HALO_ALPHA_SWING = 0.35;

const FLOOR_POOL_STOPS: readonly GlowStop[] = [
  { offset: 0, color: 'rgba(230, 150, 255, 0.85)' },
  { offset: 0.35, color: 'rgba(170, 70, 250, 0.45)' },
  { offset: 1, color: 'rgba(100, 20, 180, 0)' },
];
const FLOOR_POOL_RADIUS_TILES = 1.25;
/** The floor is seen at a steep angle, so a round pool of light lies flat as an ellipse. */
const FLOOR_SQUASH = 0.42;
const FLOOR_POOL_ALPHA_BASE = 0.65;
const FLOOR_POOL_ALPHA_SWING = 0.35;

const SHADOW_COLOR = 'rgba(12, 0, 24, 0.5)';
const SHADOW_RADIUS_TILES = 0.34;
/** The shadow tightens as the crystal dips, the cue that it is hovering, not sitting. */
const SHADOW_BOB_SCALE = 1.6;

/** Fissures scorched into the floor beneath it, radiating from the shadow. */
const FISSURE_COUNT = 5;
const FISSURE_INNER_TILES = 0.34;
const FISSURE_OUTER_TILES = 0.9;
const FISSURE_LENGTH_JITTER = 0.45;
/** How far each fissure's bearing strays from an even spread, as a share of the spacing. */
const FISSURE_ANGLE_JITTER = 0.6;
const FISSURE_ANGLE_OFFSET = 0.4;
const FISSURE_SEGMENTS = 4;
/** Sideways wander of each joint, in radians: enough to read as a crack, not a spoke. */
const FISSURE_WANDER = 0.22;
/** The open, glowing part of a crack is near the crystal; it narrows to a hairline outward. */
const FISSURE_WIDE_SHARE = 0.5;
const FISSURE_DARK_COLOR = 'rgba(20, 4, 30, 0.5)';
const FISSURE_GLOW_COLOR = '#e879f9';
const FISSURE_DARK_WIDTH_TILES = 0.07;
const FISSURE_GLOW_WIDTH_TILES = 0.03;
const FISSURE_ALPHA_BASE = 0.45;
const FISSURE_ALPHA_SWING = 0.45;
const FISSURE_SEED = 17;

const SHARD_COUNT = 5;
const SHARD_ORBIT_RX_TILES = 0.78;
const SHARD_ORBIT_RY_TILES = 0.24;
const SHARD_ORBIT_HZ = 0.16;
const SHARD_HEIGHT_TILES = 0.24;
const SHARD_HEIGHT_JITTER = 0.5;
const SHARD_DRIFT_TILES = 0.08;
const SHARD_DRIFT_HZ = 0.7;
const SHARD_SPIN_HZ = 0.9;
/** Orbit heights vary so the shards read as a loose swarm, not a ring. */
const SHARD_LIFT_SPREAD_TILES = 0.42;
const SHARD_SEED = 41;
const SHARD_LIGHT = '#f0d9ff';
const SHARD_DARK = '#7e22ce';
const SHARD_EDGE = '#2a0a4a';
/** Shards behind the crystal are dimmer, which sells the orbit's depth. */
const SHARD_BACK_ALPHA = 0.6;
const SHARD_HALF_WIDTH_RATIO = 0.32;

const ARC_SLOTS = 3;
const ARC_RATE_HZ = 1.7;
const ARC_VISIBLE_FRACTION = 0.22;
const ARC_SEGMENTS = 6;
const ARC_JAG_TILES = 0.09;
const ARC_GLOW_COLOR = 'rgba(232, 121, 249, 0.6)';
const ARC_CORE_COLOR = '#fdf4ff';
const ARC_GLOW_WIDTH_TILES = 0.08;
const ARC_CORE_WIDTH_TILES = 0.025;
const ARC_SEED = 73;

const MOTE_COUNT = 7;
const MOTE_RISE_TILES = 1.8;
const MOTE_SPREAD_TILES = 0.5;
const MOTE_PERIOD_S = 2.2;
const MOTE_RADIUS_TILES = 0.025;
const MOTE_COLOR = '#e9a8ff';
const MOTE_SEED = 101;

const HASH_MULTIPLIER = 12.9898;
const HASH_SCALE = 43758.5453;

/** A stable pseudo-random value in [0, 1) for an integer key. */
function hash01(key: number): number {
  const scaled = Math.sin(key * HASH_MULTIPLIER) * HASH_SCALE;
  return scaled - Math.floor(scaled);
}

function signedHash(key: number): number {
  return hash01(key) * 2 - 1;
}

function drawFloorPool(
  ctx: CanvasRenderingContext2D,
  cx: number,
  groundY: number,
  tileSize: number,
  beat: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = FLOOR_POOL_ALPHA_BASE + FLOOR_POOL_ALPHA_SWING * beat;
  ctx.translate(cx, groundY);
  ctx.scale(1, FLOOR_SQUASH);
  drawRadialGlow(ctx, 0, 0, FLOOR_POOL_RADIUS_TILES * tileSize, FLOOR_POOL_STOPS);
  ctx.restore();
}

function drawFissures(
  ctx: CanvasRenderingContext2D,
  cx: number,
  groundY: number,
  tileSize: number,
  beat: number,
): void {
  const toScreen = (theta: number, radius: number): Point => [
    cx + Math.cos(theta) * radius * tileSize,
    groundY + Math.sin(theta) * radius * tileSize * FLOOR_SQUASH,
  ];
  const paths: Point[][] = [];
  const wideHeads: Point[][] = [];
  const spacing = FULL_CIRCLE / FISSURE_COUNT;
  for (let index = 0; index < FISSURE_COUNT; index++) {
    const seed = FISSURE_SEED + index * FISSURE_SEGMENTS * 2;
    const angle =
      index * spacing + FISSURE_ANGLE_OFFSET + signedHash(seed) * spacing * FISSURE_ANGLE_JITTER;
    const reach = FISSURE_OUTER_TILES * (1 - FISSURE_LENGTH_JITTER * hash01(seed + 1));
    const path: Point[] = [];
    for (let step = 0; step <= FISSURE_SEGMENTS; step++) {
      const along = step / FISSURE_SEGMENTS;
      const wander = step === 0 ? 0 : signedHash(seed + step + 1) * FISSURE_WANDER;
      path.push(
        toScreen(angle + wander, FISSURE_INNER_TILES + (reach - FISSURE_INNER_TILES) * along),
      );
    }
    paths.push(path);
    wideHeads.push(path.slice(0, Math.ceil(FISSURE_SEGMENTS * FISSURE_WIDE_SHARE) + 1));
  }
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = FISSURE_DARK_COLOR;
  ctx.lineWidth = Math.max(MIN_LINE_WIDTH, FISSURE_DARK_WIDTH_TILES * tileSize);
  for (const path of wideHeads) strokePolyline(ctx, path, 0, 0, 1);
  ctx.lineWidth = Math.max(MIN_LINE_WIDTH, FISSURE_DARK_WIDTH_TILES * tileSize * HALF);
  for (const path of paths) strokePolyline(ctx, path, 0, 0, 1);
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = FISSURE_ALPHA_BASE + FISSURE_ALPHA_SWING * beat;
  ctx.strokeStyle = FISSURE_GLOW_COLOR;
  ctx.lineWidth = Math.max(MIN_LINE_WIDTH, FISSURE_GLOW_WIDTH_TILES * tileSize);
  for (const path of wideHeads) strokePolyline(ctx, path, 0, 0, 1);
  ctx.restore();
}

interface ShardPlacement {
  readonly x: number;
  readonly y: number;
  readonly height: number;
  readonly spin: number;
  /** Positive in front of the crystal, negative behind it. */
  readonly depth: number;
}

function shardPlacements(
  cx: number,
  crystalCy: number,
  tileSize: number,
  timeS: number,
): ShardPlacement[] {
  const placements: ShardPlacement[] = [];
  for (let index = 0; index < SHARD_COUNT; index++) {
    const seed = SHARD_SEED + index;
    const angle = (index / SHARD_COUNT) * FULL_CIRCLE + timeS * FULL_CIRCLE * SHARD_ORBIT_HZ;
    const lift = signedHash(seed) * SHARD_LIFT_SPREAD_TILES;
    const drift =
      Math.sin(timeS * FULL_CIRCLE * SHARD_DRIFT_HZ + index) * SHARD_DRIFT_TILES * tileSize;
    placements.push({
      x: cx + Math.cos(angle) * SHARD_ORBIT_RX_TILES * tileSize,
      y: crystalCy + (Math.sin(angle) * SHARD_ORBIT_RY_TILES + lift) * tileSize + drift,
      height:
        SHARD_HEIGHT_TILES * tileSize * (1 - SHARD_HEIGHT_JITTER * hash01(seed + SHARD_COUNT)),
      spin: timeS * FULL_CIRCLE * SHARD_SPIN_HZ + index,
      depth: Math.sin(angle),
    });
  }
  return placements;
}

function drawShard(ctx: CanvasRenderingContext2D, shard: ShardPlacement): void {
  const halfHeight = shard.height * HALF;
  const widthSwing = Math.abs(Math.cos(shard.spin));
  const halfWidth = halfHeight * SHARD_HALF_WIDTH_RATIO * (HALF + HALF * widthSwing);
  const ridgeX = shard.x + Math.sin(shard.spin) * halfWidth * HALF;
  ctx.save();
  if (shard.depth < 0) ctx.globalAlpha *= SHARD_BACK_ALPHA;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(shard.x, shard.y - halfHeight);
  ctx.lineTo(shard.x + halfWidth, shard.y);
  ctx.lineTo(shard.x, shard.y + halfHeight);
  ctx.lineTo(shard.x - halfWidth, shard.y);
  ctx.closePath();
  ctx.strokeStyle = SHARD_EDGE;
  ctx.lineWidth = MIN_LINE_WIDTH * 2;
  ctx.stroke();
  ctx.fillStyle = SHARD_DARK;
  ctx.fill();
  ctx.beginPath();
  ctx.moveTo(shard.x, shard.y - halfHeight);
  ctx.lineTo(ridgeX, shard.y);
  ctx.lineTo(shard.x, shard.y + halfHeight);
  ctx.lineTo(shard.x - halfWidth, shard.y);
  ctx.closePath();
  ctx.fillStyle = SHARD_LIGHT;
  ctx.fill();
  ctx.restore();
}

function drawArcs(
  ctx: CanvasRenderingContext2D,
  cx: number,
  crystalCy: number,
  shards: readonly ShardPlacement[],
  tileSize: number,
  timeS: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  for (let slot = 0; slot < ARC_SLOTS; slot++) {
    const clock = timeS * ARC_RATE_HZ + slot / ARC_SLOTS;
    const phase = clock - Math.floor(clock);
    if (phase > ARC_VISIBLE_FRACTION) continue;
    const strike = Math.floor(clock) * ARC_SLOTS + slot + ARC_SEED;
    const target = shards[Math.floor(hash01(strike) * shards.length)];
    const path: Point[] = [];
    for (let step = 0; step <= ARC_SEGMENTS; step++) {
      const along = step / ARC_SEGMENTS;
      const isEnd = step === 0 || step === ARC_SEGMENTS;
      const jag = isEnd ? 0 : signedHash(strike * ARC_SEGMENTS + step) * ARC_JAG_TILES * tileSize;
      path.push([
        cx + (target.x - cx) * along + jag,
        crystalCy + (target.y - crystalCy) * along - jag,
      ]);
    }
    ctx.globalAlpha = 1 - phase / ARC_VISIBLE_FRACTION;
    ctx.strokeStyle = ARC_GLOW_COLOR;
    ctx.lineWidth = Math.max(MIN_LINE_WIDTH, ARC_GLOW_WIDTH_TILES * tileSize);
    strokePolyline(ctx, path, 0, 0, 1);
    ctx.strokeStyle = ARC_CORE_COLOR;
    ctx.lineWidth = Math.max(MIN_LINE_WIDTH, ARC_CORE_WIDTH_TILES * tileSize);
    strokePolyline(ctx, path, 0, 0, 1);
  }
  ctx.restore();
}

function drawMotes(
  ctx: CanvasRenderingContext2D,
  cx: number,
  crystalCy: number,
  tileSize: number,
  timeS: number,
): void {
  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.fillStyle = MOTE_COLOR;
  for (let index = 0; index < MOTE_COUNT; index++) {
    const seed = MOTE_SEED + index;
    const cycle = timeS / MOTE_PERIOD_S + hash01(seed);
    const life = cycle - Math.floor(cycle);
    const generation = Math.floor(cycle);
    const startX = signedHash(seed + generation * MOTE_COUNT) * MOTE_SPREAD_TILES * tileSize;
    ctx.globalAlpha = Math.sin(life * Math.PI);
    ctx.beginPath();
    ctx.arc(
      cx + startX,
      crystalCy - life * MOTE_RISE_TILES * tileSize,
      Math.max(MIN_LINE_WIDTH * HALF, MOTE_RADIUS_TILES * tileSize),
      0,
      FULL_CIRCLE,
    );
    ctx.fill();
  }
  ctx.restore();
}

/**
 * The soul crystal as it lies loose on the floor of the magistrate's office.
 *
 * @param cx       Screen-x of the tile's centre
 * @param groundY  Screen-y of the floor point the crystal hovers over
 * @param tileSize Tile size in pixels; every dimension scales against it
 * @param timeS    Monotonic clock, in seconds
 */
export function drawSoulCrystalProp(
  ctx: CanvasRenderingContext2D,
  cx: number,
  groundY: number,
  tileSize: number,
  timeS: number,
): void {
  const beat = soulCrystalHeartbeat(timeS);
  const bob = Math.sin(timeS * FULL_CIRCLE * WORLD_BOB_HZ);
  const height = WORLD_CRYSTAL_HEIGHT_TILES * tileSize;
  const hover = (WORLD_HOVER_TILES + bob * WORLD_BOB_TILES) * tileSize;
  const crystalCy = groundY - hover - height * HALF;

  drawFloorPool(ctx, cx, groundY, tileSize, beat);
  drawFissures(ctx, cx, groundY, tileSize, beat);

  const shadowRadius =
    SHADOW_RADIUS_TILES * tileSize * (1 - bob * WORLD_BOB_TILES * SHADOW_BOB_SCALE);
  ctx.save();
  ctx.fillStyle = SHADOW_COLOR;
  ctx.beginPath();
  ctx.ellipse(cx, groundY, shadowRadius, shadowRadius * FLOOR_SQUASH, 0, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalCompositeOperation = 'lighter';
  ctx.globalAlpha = HALO_ALPHA_BASE + HALO_ALPHA_SWING * beat;
  drawRadialGlow(ctx, cx, crystalCy, HALO_RADIUS_TILES * tileSize, HALO_STOPS);
  ctx.restore();

  const shards = shardPlacements(cx, crystalCy, tileSize, timeS);
  for (const shard of shards) if (shard.depth < 0) drawShard(ctx, shard);
  paintSoulCrystalBody(ctx, cx, crystalCy, height, timeS);
  for (const shard of shards) if (shard.depth >= 0) drawShard(ctx, shard);
  drawArcs(ctx, cx, crystalCy, shards, tileSize, timeS);
  drawMotes(ctx, cx, crystalCy, tileSize, timeS);
}

/** How far above the floor point the crystal's top reaches, in tiles — where a prompt can sit clear of it. */
export const SOUL_CRYSTAL_TOP_TILES =
  WORLD_HOVER_TILES + WORLD_BOB_TILES + WORLD_CRYSTAL_HEIGHT_TILES;
