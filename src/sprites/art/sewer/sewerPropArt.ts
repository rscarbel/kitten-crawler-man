/**
 * The sewer's fittings, painted at runtime: a sluice's valve wheel on its
 * post, the rat nest choking the sump, the iron ladder up to the street
 * grate, the bars of a street grate's shadow on the walkway, the cistern
 * culvert's mouth, the spillway's outfall pipe, the outlet pipe over a
 * sump, pouring or dry, and the drain in the sump's floor the nest is
 * washed down.
 *
 * Every measure is a share of the tile, so a fitting draws at any scale.
 * Light comes from the upper left, as everywhere else in the game.
 */

const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

// ── Valve wheel ─────────────────────────────────────────────────────────────
const POST_WIDTH = 0.22;
const POST_HEIGHT = 0.55;
const POST_IRON = '#2f3438';
const POST_LIGHT = '#59626a';
const POST_FOOT = 'rgba(0,0,0,0.45)';
const POST_FOOT_RADIUS_X = 0.3;
const POST_FOOT_RADIUS_Y = 0.12;
const WHEEL_RADIUS = 0.3;
const WHEEL_RIM_WIDTH = 0.07;
const WHEEL_RIM = '#7a3d24';
const WHEEL_RIM_LIGHT = '#a4583a';
const WHEEL_SPOKES = 4;
const WHEEL_SPOKE_WIDTH = 0.045;
const WHEEL_HUB_RADIUS = 0.06;
const WHEEL_HUB = '#c8b48a';
/** Where the wheel's hub sits above the post's foot, as a share of the tile. */
const WHEEL_LIFT = 0.62;
/** The wheel is seen a little from above, so its circle is squashed to this. */
const WHEEL_TILT = 0.55;

/** Paints a valve wheel on its post, standing on the tile whose top-left is (x, y); `turns` spins it. */
export function paintValveWheel(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  turns: number,
): void {
  const cx = x + ts * HALF;
  const footY = y + ts * (1 - POST_FOOT_RADIUS_Y);
  ctx.save();
  ctx.fillStyle = POST_FOOT;
  ctx.beginPath();
  ctx.ellipse(cx, footY, ts * POST_FOOT_RADIUS_X, ts * POST_FOOT_RADIUS_Y, 0, 0, FULL_TURN);
  ctx.fill();
  const postW = ts * POST_WIDTH;
  const postTop = footY - ts * POST_HEIGHT;
  ctx.fillStyle = POST_IRON;
  ctx.fillRect(cx - postW * HALF, postTop, postW, footY - postTop);
  ctx.fillStyle = POST_LIGHT;
  ctx.fillRect(cx - postW * HALF, postTop, postW * HALF * HALF, footY - postTop);

  const hubY = footY - ts * WHEEL_LIFT;
  ctx.translate(cx, hubY);
  ctx.scale(1, WHEEL_TILT);
  const radius = ts * WHEEL_RADIUS;
  ctx.lineCap = 'round';
  ctx.strokeStyle = WHEEL_RIM;
  ctx.lineWidth = ts * WHEEL_SPOKE_WIDTH;
  const angle = turns * FULL_TURN;
  for (let spoke = 0; spoke < WHEEL_SPOKES; spoke++) {
    const a = angle + (spoke / WHEEL_SPOKES) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(Math.cos(a) * radius, Math.sin(a) * radius);
    ctx.lineTo(-Math.cos(a) * radius, -Math.sin(a) * radius);
    ctx.stroke();
  }
  ctx.lineWidth = ts * WHEEL_RIM_WIDTH;
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, FULL_TURN);
  ctx.stroke();
  ctx.strokeStyle = WHEEL_RIM_LIGHT;
  ctx.beginPath();
  ctx.arc(0, 0, radius, Math.PI, Math.PI * (1 + HALF));
  ctx.stroke();
  ctx.fillStyle = WHEEL_HUB;
  ctx.beginPath();
  ctx.arc(0, 0, ts * WHEEL_HUB_RADIUS, 0, FULL_TURN);
  ctx.fill();
  ctx.restore();
}

// ── Rat nest ────────────────────────────────────────────────────────────────
const NEST_DARK = '#2a2117';
const NEST_MID = '#4a3b28';
const NEST_STRAW = 'rgba(150,124,78,0.75)';
const NEST_RAG = 'rgba(92,86,74,0.8)';
const NEST_CLUMPS_PER_TILE = 5;
const NEST_CLUMP_MIN = 0.22;
const NEST_CLUMP_SPREAD = 0.2;
const NEST_STRAWS_PER_TILE = 7;
const NEST_STRAW_LENGTH = 0.35;
const NEST_STRAW_WIDTH = 0.04;
const NEST_RAGS_PER_TILE = 2;
const NEST_RAG_SIZE = 0.18;
/** How far toward the drain a washed-out nest's clumps have slid by the time they are gone, as a share of the way. */
const NEST_DRIFT_SHARE = 0.6;
const HASH_A = 12.9898;
const HASH_B = 78.233;
const HASH_SCALE = 43758.5453;

/** A deterministic 0..1 value from two numbers. */
function hash01(a: number, b: number): number {
  const v = Math.sin(a * HASH_A + b * HASH_B) * HASH_SCALE;
  return v - Math.floor(v);
}

/**
 * Paints one tile of the rat nest: a heap of straw, rag and muck. `presence`
 * runs from 1, whole, to 0, carried off by the water; as it falls the heap
 * slides toward `drain`, the world-pixel point the water carries it down,
 * when there is one.
 */
export function paintRatNestTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  tx: number,
  ty: number,
  presence: number,
  drain: { readonly x: number; readonly y: number } | null,
): void {
  if (presence <= 0) return;
  ctx.save();
  ctx.globalAlpha = presence;
  if (drain !== null) {
    const drift = (1 - presence) * NEST_DRIFT_SHARE;
    const tileCentreX = x + ts * HALF;
    const tileCentreY = y + ts * HALF;
    ctx.translate((drain.x - tileCentreX) * drift, (drain.y - tileCentreY) * drift);
  }
  for (let i = 0; i < NEST_CLUMPS_PER_TILE; i++) {
    const px = x + ts * hash01(tx * NEST_CLUMPS_PER_TILE + i, ty);
    const py = y + ts * hash01(ty * NEST_CLUMPS_PER_TILE + i, tx + 1);
    const r = ts * (NEST_CLUMP_MIN + NEST_CLUMP_SPREAD * hash01(i, tx + ty));
    ctx.fillStyle = i % 2 === 0 ? NEST_DARK : NEST_MID;
    ctx.beginPath();
    ctx.ellipse(px, py, r, r * HALF + r * HALF * HALF, 0, 0, FULL_TURN);
    ctx.fill();
  }
  ctx.fillStyle = NEST_RAG;
  for (let i = 0; i < NEST_RAGS_PER_TILE; i++) {
    const px = x + ts * hash01(tx + i, ty * NEST_RAGS_PER_TILE + 2);
    const py = y + ts * hash01(ty + i, tx * NEST_RAGS_PER_TILE + 3);
    ctx.fillRect(px, py, ts * NEST_RAG_SIZE, ts * NEST_RAG_SIZE * HALF);
  }
  ctx.strokeStyle = NEST_STRAW;
  ctx.lineWidth = ts * NEST_STRAW_WIDTH;
  ctx.lineCap = 'round';
  for (let i = 0; i < NEST_STRAWS_PER_TILE; i++) {
    const px = x + ts * hash01(tx * NEST_STRAWS_PER_TILE + i, ty + 4);
    const py = y + ts * hash01(ty * NEST_STRAWS_PER_TILE + i, tx + 5);
    const a = FULL_TURN * hash01(i, tx * ty + 6);
    const length = ts * NEST_STRAW_LENGTH;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(a) * length, py + Math.sin(a) * length * HALF);
    ctx.stroke();
  }
  ctx.restore();
}

// ── Ladder ──────────────────────────────────────────────────────────────────
const LADDER_RAIL = '#3b4045';
const LADDER_RAIL_LIGHT = '#6e7780';
const LADDER_RUNG = '#545b62';
const LADDER_RAIL_INSET = 0.24;
const LADDER_RAIL_WIDTH = 0.07;
const LADDER_RUNG_HEIGHT = 0.05;
/** How far up out of the tile the ladder climbs before the dark takes it, in tiles. */
const LADDER_RISE_TILES = 2.6;
const LADDER_RUNGS_PER_TILE = 3;
const LADDER_FADE = 'rgba(4,6,6,0.85)';

/** Paints the iron ladder climbing from the tile at (x, y) up through the wall above. */
export function paintSewerLadder(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
): void {
  const top = y + ts - ts * LADDER_RISE_TILES;
  const bottom = y + ts * (1 - LADDER_RUNG_HEIGHT);
  const left = x + ts * LADDER_RAIL_INSET;
  const right = x + ts * (1 - LADDER_RAIL_INSET);
  const railW = ts * LADDER_RAIL_WIDTH;
  ctx.save();
  ctx.fillStyle = LADDER_RUNG;
  const rungs = Math.round(LADDER_RISE_TILES * LADDER_RUNGS_PER_TILE);
  for (let rung = 0; rung < rungs; rung++) {
    const ry = bottom - (rung + HALF) * (ts / LADDER_RUNGS_PER_TILE);
    ctx.fillRect(left, ry, right - left, ts * LADDER_RUNG_HEIGHT);
  }
  ctx.fillStyle = LADDER_RAIL;
  ctx.fillRect(left - railW, top, railW, bottom - top);
  ctx.fillRect(right, top, railW, bottom - top);
  ctx.fillStyle = LADDER_RAIL_LIGHT;
  ctx.fillRect(left - railW, top, railW * HALF, bottom - top);
  const fade = ctx.createLinearGradient(0, top, 0, top + ts);
  fade.addColorStop(0, LADDER_FADE);
  fade.addColorStop(1, 'rgba(4,6,6,0)');
  ctx.fillStyle = fade;
  ctx.fillRect(left - railW, top, right - left + railW * 2, ts);
  ctx.restore();
}

// ── Street grate's shadow ───────────────────────────────────────────────────
const GRATE_LIGHT = 'rgba(214,226,222,0.12)';
const GRATE_BAR_SHADOW = 'rgba(8,12,12,0.28)';
const GRATE_LIGHT_SIZE = 1.6;
const GRATE_BARS = 4;
const GRATE_BAR_WIDTH = 0.06;

/**
 * The square of daylight a street grate throws on the walkway beneath it,
 * crossed by its bars' shadows. Drawn on the floor, under every figure.
 */
export function paintGrateLightOnFloor(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
): void {
  const size = ts * GRATE_LIGHT_SIZE;
  const left = x + ts * HALF - size * HALF;
  const top = y + ts * HALF - size * HALF;
  ctx.save();
  ctx.fillStyle = GRATE_LIGHT;
  ctx.fillRect(left, top, size, size);
  ctx.fillStyle = GRATE_BAR_SHADOW;
  const barW = ts * GRATE_BAR_WIDTH;
  for (let bar = 1; bar < GRATE_BARS; bar++) {
    const along = (bar / GRATE_BARS) * size;
    ctx.fillRect(left + along - barW * HALF, top, barW, size);
    ctx.fillRect(left, top + along - barW * HALF, size, barW);
  }
  ctx.restore();
}

// ── Culvert mouth ───────────────────────────────────────────────────────────
const CULVERT_RING = '#4b4a44';
const CULVERT_RING_LIGHT = '#77746a';
const CULVERT_BORE = '#050606';
const CULVERT_RING_WIDTH = 0.16;
const CULVERT_BORE_INSET = 0.08;
const CULVERT_DEPTH_SHADE = 'rgba(22,30,30,0.6)';

/**
 * Paints the cistern culvert's mouth, a round pipe `spanTiles` tall, set in
 * the wall whose tiles begin at (x, y): the bore is black, and the brick ring
 * catches the light from the upper left.
 */
export function paintCulvertMouth(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  spanTiles: number,
): void {
  const cx = x + ts * HALF;
  const cy = y + ts * spanTiles * HALF;
  const radius = ts * spanTiles * HALF;
  ctx.save();
  ctx.fillStyle = CULVERT_RING;
  ctx.beginPath();
  ctx.ellipse(cx, cy, radius * HALF, radius, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.strokeStyle = CULVERT_RING_LIGHT;
  ctx.lineWidth = ts * CULVERT_RING_WIDTH * HALF;
  ctx.beginPath();
  ctx.ellipse(cx, cy, radius * HALF, radius, 0, Math.PI, Math.PI * (1 + HALF));
  ctx.stroke();
  ctx.fillStyle = CULVERT_BORE;
  ctx.beginPath();
  const inset = ts * (CULVERT_RING_WIDTH + CULVERT_BORE_INSET);
  ctx.ellipse(cx, cy, Math.max(1, radius * HALF - inset * HALF), radius - inset, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = CULVERT_DEPTH_SHADE;
  ctx.fillRect(x, y + ts * spanTiles - ts * CULVERT_RING_WIDTH, ts, ts * CULVERT_RING_WIDTH);
  ctx.restore();
}

// ── Spillway outfall ────────────────────────────────────────────────────────
const OUTFALL_PIPE = '#3e403c';
const OUTFALL_LIP = '#6c6c62';
const OUTFALL_BORE = '#0a0d0d';
const OUTFALL_WIDTH_TILES = 1.6;
const OUTFALL_HEIGHT = 0.55;
const OUTFALL_LIP_HEIGHT = 0.1;
const OUTFALL_POUR = 'rgba(120,138,118,0.55)';
const OUTFALL_POUR_WIDTH = 0.9;

/**
 * Paints the pipe the spillway pours from, at the foot of the wall above the
 * spillway's first row (whose left tile's top-left is (x, y)). `pouring` is
 * whether its sluice still lets water through.
 */
export function paintSpillwayOutfall(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  pouring: boolean,
): void {
  const width = ts * OUTFALL_WIDTH_TILES;
  const left = x + ts - width * HALF;
  const top = y - ts * OUTFALL_HEIGHT;
  ctx.save();
  ctx.fillStyle = OUTFALL_PIPE;
  ctx.fillRect(left, top, width, ts * OUTFALL_HEIGHT);
  ctx.fillStyle = OUTFALL_BORE;
  ctx.fillRect(
    left + width * HALF * HALF,
    top + ts * OUTFALL_LIP_HEIGHT,
    width * HALF,
    ts * OUTFALL_HEIGHT,
  );
  ctx.fillStyle = OUTFALL_LIP;
  ctx.fillRect(left, top, width, ts * OUTFALL_LIP_HEIGHT);
  if (pouring) {
    ctx.fillStyle = OUTFALL_POUR;
    const pourW = width * HALF * OUTFALL_POUR_WIDTH;
    ctx.fillRect(
      left + (width - pourW) * HALF,
      top + ts * OUTFALL_LIP_HEIGHT,
      pourW,
      ts * OUTFALL_HEIGHT,
    );
  }
  ctx.restore();
}

// ── Outlet pipe over a sump ─────────────────────────────────────────────────
const OUTLET_FLANGE = '#4a4d48';
const OUTLET_FLANGE_LIGHT = '#7b7f76';
const OUTLET_BOLT = '#2a2c2a';
const OUTLET_PIPE = '#3a3d39';
const OUTLET_PIPE_LIGHT = '#686c63';
const OUTLET_BORE = '#070909';
const OUTLET_DRIP_STAIN = 'rgba(70,84,62,0.45)';
/** The flange plate bolted to the wall face, as shares of the tile. */
const OUTLET_FLANGE_WIDTH = 0.66;
const OUTLET_FLANGE_TOP = 0.34;
const OUTLET_FLANGE_HEIGHT = 0.2;
const OUTLET_BOLT_RADIUS = 0.035;
const OUTLET_BOLT_INSET = 0.06;
/** The pipe comes down the wall face from the top of the tile, through its collar, to its open mouth. */
const OUTLET_PIPE_WIDTH = 0.46;
const OUTLET_PIPE_TOP = 0;
const OUTLET_MOUTH_Y = 0.82;
const OUTLET_MOUTH_HEIGHT = 0.16;
const OUTLET_BORE_INSET = 0.05;
const OUTLET_PIPE_LIGHT_SHARE = 0.25;
/** The stain the pipe has left down the wall under it. */
const OUTLET_STAIN_WIDTH = 0.28;
/** How far below the mouth the stream lands: the middle of the sump row under the wall. */
const OUTLET_FALL_TILES = 0.72;
/** The stream reaches the water once the pipe is this far open; below it, it falls short of the sump. */
const OUTLET_FLOW_TO_REACH_WATER = 0.5;
const OUTLET_STREAM_WIDTH = 0.34;
const OUTLET_STREAM_BODY = 'rgba(150,182,164,0.85)';
const OUTLET_STREAM_EDGE = 'rgba(222,238,228,0.75)';
const OUTLET_STREAKS = 4;
const OUTLET_STREAK_LENGTH = 0.16;
const OUTLET_STREAK_WIDTH = 0.03;
/** How fast the streaks run down the stream, in tiles per second. */
const OUTLET_STREAK_SPEED_TILES = 1.6;
const OUTLET_SPLASH = 'rgba(214,232,220,0.7)';
const OUTLET_SPLASH_RINGS = 3;
const OUTLET_SPLASH_RADIUS = 0.42;
const OUTLET_SPLASH_FLATTEN = 0.32;
/** One splash ring spreads and fades over this long. */
const OUTLET_SPLASH_PERIOD_MS = 900;
const MS_PER_SECOND = 1000;

/**
 * Paints the outlet pipe in the wall tile whose top-left is (x, y), over the
 * sump on the row beneath: a pipe down the wall face, through a bolted
 * collar, ending in an open mouth over the water. `flow` runs from 0, dry, to 1, pouring full: the stream thins
 * and shortens from the mouth as the pipe is shut. `nowMs`, the section's own clock, moves the water.
 */
export function paintWallOutlet(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  flow: number,
  nowMs: number,
): void {
  const cx = x + ts * HALF;
  ctx.save();
  const stainW = ts * OUTLET_STAIN_WIDTH;
  ctx.fillStyle = OUTLET_DRIP_STAIN;
  ctx.fillRect(cx - stainW * HALF, y + ts * OUTLET_MOUTH_Y, stainW, ts * (1 - OUTLET_MOUTH_Y));

  const pipeW = ts * OUTLET_PIPE_WIDTH;
  const pipeLeft = cx - pipeW * HALF;
  const pipeTop = y + ts * OUTLET_PIPE_TOP;
  const mouthY = y + ts * OUTLET_MOUTH_Y;
  ctx.fillStyle = OUTLET_PIPE;
  ctx.fillRect(pipeLeft, pipeTop, pipeW, mouthY - pipeTop);
  ctx.fillStyle = OUTLET_PIPE_LIGHT;
  ctx.fillRect(pipeLeft, pipeTop, pipeW * OUTLET_PIPE_LIGHT_SHARE, mouthY - pipeTop);
  const flangeW = ts * OUTLET_FLANGE_WIDTH;
  const flangeLeft = cx - flangeW * HALF;
  const flangeTop = y + ts * OUTLET_FLANGE_TOP;
  const flangeH = ts * OUTLET_FLANGE_HEIGHT;
  ctx.fillStyle = OUTLET_FLANGE;
  ctx.fillRect(flangeLeft, flangeTop, flangeW, flangeH);
  ctx.fillStyle = OUTLET_FLANGE_LIGHT;
  ctx.fillRect(flangeLeft, flangeTop, flangeW, ts * OUTLET_BOLT_RADIUS);
  ctx.fillStyle = OUTLET_BOLT;
  const boltInset = ts * OUTLET_BOLT_INSET;
  for (const boltX of [flangeLeft + boltInset, flangeLeft + flangeW - boltInset]) {
    for (const boltY of [flangeTop + boltInset, flangeTop + flangeH - boltInset]) {
      ctx.beginPath();
      ctx.arc(boltX, boltY, ts * OUTLET_BOLT_RADIUS, 0, FULL_TURN);
      ctx.fill();
    }
  }

  const mouthHalfH = ts * OUTLET_MOUTH_HEIGHT * HALF;
  ctx.fillStyle = OUTLET_PIPE_LIGHT;
  ctx.beginPath();
  ctx.ellipse(cx, mouthY, pipeW * HALF, mouthHalfH, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = OUTLET_BORE;
  const boreInset = ts * OUTLET_BORE_INSET;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    mouthY,
    pipeW * HALF - boreInset,
    Math.max(1, mouthHalfH - boreInset * HALF),
    0,
    0,
    FULL_TURN,
  );
  ctx.fill();

  if (flow > 0) paintOutletStream(ctx, cx, mouthY, ts, flow, nowMs);
  ctx.restore();
}

function paintOutletStream(
  ctx: CanvasRenderingContext2D,
  cx: number,
  mouthY: number,
  ts: number,
  flow: number,
  nowMs: number,
): void {
  const width = ts * OUTLET_STREAM_WIDTH * flow;
  const landY = mouthY + ts * (1 - OUTLET_MOUTH_Y + OUTLET_FALL_TILES);
  const fallLength = (landY - mouthY) * Math.min(1, flow / OUTLET_FLOW_TO_REACH_WATER);
  const bottom = mouthY + fallLength;
  ctx.fillStyle = OUTLET_STREAM_BODY;
  ctx.fillRect(cx - width * HALF, mouthY, width, fallLength);
  ctx.fillStyle = OUTLET_STREAM_EDGE;
  const edgeW = Math.max(1, width * OUTLET_PIPE_LIGHT_SHARE * HALF);
  ctx.fillRect(cx - width * HALF, mouthY, edgeW, fallLength);

  const streakLength = ts * OUTLET_STREAK_LENGTH;
  const runPx = ((nowMs / MS_PER_SECOND) * OUTLET_STREAK_SPEED_TILES * ts) % fallLength;
  ctx.fillStyle = OUTLET_STREAM_EDGE;
  for (let streak = 0; streak < OUTLET_STREAKS; streak++) {
    const along = (runPx + (streak / OUTLET_STREAKS) * fallLength) % fallLength;
    const streakX = cx - width * HALF + width * ((streak + HALF) / OUTLET_STREAKS);
    const streakTop = mouthY + along;
    const streakBottom = Math.min(bottom, streakTop + streakLength);
    ctx.fillRect(streakX, streakTop, ts * OUTLET_STREAK_WIDTH, streakBottom - streakTop);
  }

  if (fallLength < landY - mouthY) return;
  ctx.strokeStyle = OUTLET_SPLASH;
  ctx.lineWidth = Math.max(1, ts * OUTLET_STREAK_WIDTH);
  for (let ring = 0; ring < OUTLET_SPLASH_RINGS; ring++) {
    const phase = (((nowMs / OUTLET_SPLASH_PERIOD_MS + ring / OUTLET_SPLASH_RINGS) % 1) + 1) % 1;
    const radius = ts * OUTLET_SPLASH_RADIUS * flow * (HALF + phase * HALF);
    ctx.globalAlpha = 1 - phase;
    ctx.beginPath();
    ctx.ellipse(cx, landY, radius, radius * OUTLET_SPLASH_FLATTEN, 0, 0, FULL_TURN);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

// ── Sump drain ──────────────────────────────────────────────────────────────
const DRAIN_SILT_STAIN = 'rgba(34,28,18,0.55)';
const DRAIN_SILT_CLEAR = 'rgba(34,28,18,0)';
const DRAIN_SILT_STAIN_RADIUS = 1.1;
const DRAIN_SILT = 'rgba(38,32,22,0.28)';
const DRAIN_SILT_STREAKS = 14;
const DRAIN_SILT_INNER = 0.5;
const DRAIN_SILT_OUTER = 1.05;
const DRAIN_SILT_WIDTH = 0.05;
/** Each scour line curls this far round, as a share of a turn, the way the water ran in. */
const DRAIN_SILT_CURL = 0.06;
const DRAIN_FRAME = '#3c3f3b';
const DRAIN_FRAME_LIGHT = '#71756c';
const DRAIN_FRAME_RADIUS = 0.5;
const DRAIN_FRAME_WIDTH = 0.1;
const DRAIN_BORE = '#030404';
const DRAIN_BORE_RADIUS = 0.4;
/** The mouth is seen a little from above, so its circle is squashed to this. */
const DRAIN_TILT = 0.72;
const DRAIN_BAR = '#2b2e2b';
const DRAIN_BAR_LIGHT = '#5d6159';
const DRAIN_BAR_WIDTH = 0.06;
const DRAIN_BAR_SPACING = 0.15;
/** The grate's bars, by offset from the centre in bar spacings; the gap is the one the water broke out. */
const DRAIN_BAR_OFFSETS = [-2, -1, 1, 2] as const;
/** The broken bar's stub, as a share of the bore it once crossed. */
const DRAIN_BROKEN_STUB = 0.3;
const DRAIN_WATER_VEIL = 'rgba(52,74,66,0.55)';
const DRAIN_SWIRL = 'rgba(206,226,214,0.7)';
const DRAIN_SWIRL_ARCS = 3;
const DRAIN_SWIRL_INNER = 0.22;
const DRAIN_SWIRL_OUTER = 0.75;
/** Each swirl arc spans this share of a full turn. */
const DRAIN_SWIRL_SPAN = 0.3;
const DRAIN_SWIRL_WIDTH = 0.045;
/** Turns a second a drain's swirl makes at full pull. */
export const SUMP_DRAIN_SWIRL_TURNS_PER_SECOND = 0.7;
const DRAIN_RESIDUE_STRAWS = 3;
const DRAIN_RESIDUE_LENGTH = 0.42;
const DRAIN_DEBRIS_BITS = 18;
/** How far out a bit starts its spiral in, in tiles: the far edge of the nest round the drain. */
const DRAIN_DEBRIS_REACH_TILES = 1.45;
const DRAIN_DEBRIS_PERIOD_MS = 2200;
const DRAIN_DEBRIS_SPIRAL_TURNS = 1.25;
const DRAIN_DEBRIS_SIZE = 0.2;
/** A bit fades in over this first share of its run, so none pops into being. */
const DRAIN_DEBRIS_FADE_IN = 0.15;
const DRAIN_DEBRIS_COLOURS = [NEST_DARK, NEST_MID, NEST_RAG, NEST_STRAW] as const;

/** What the sump's water is doing at a drain mouth this frame. */
export interface SumpDrainState {
  /** How deep the water stands over the mouth, 0 dry to 1 as deep as water goes. */
  readonly water: number;
  /** How hard the water goes down it, 0 still to 1 the basin emptying: how strongly the swirl shows. */
  readonly pull: number;
  /**
   * How far the swirl has turned, in turns, run up tick by tick at the pace
   * `pull` sets. Accumulated rather than worked out from the clock, so a
   * change of pull eases the swirl's speed instead of leaping it round.
   */
  readonly swirlTurns: number;
  /** How much of the nest is being drawn in, 0 none to 1 the whole wash under way. */
  readonly debris: number;
  /** Whether the nest has gone down it, leaving straw caught in the grate. */
  readonly residue: boolean;
}

/**
 * Paints a drain mouth in a sump's floor, on the tile whose top-left is
 * (x, y): an iron-framed round hole with one bar of its grate burst out,
 * silt scoured in toward it from every side, and, under water, a swirl
 * turning over it. (tx, ty), the drain's world tile, seeds the silt and straw
 * so they hold still while the camera moves.
 */
export function paintSumpDrain(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  tx: number,
  ty: number,
  state: SumpDrainState,
): void {
  const cx = x + ts * HALF;
  const cy = y + ts * HALF;
  ctx.save();
  const stainR = ts * DRAIN_SILT_STAIN_RADIUS;
  const stain = ctx.createRadialGradient(cx, cy, 0, cx, cy, stainR);
  stain.addColorStop(0, DRAIN_SILT_STAIN);
  stain.addColorStop(1, DRAIN_SILT_CLEAR);
  ctx.fillStyle = stain;
  ctx.beginPath();
  ctx.ellipse(cx, cy, stainR, stainR * DRAIN_TILT, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.strokeStyle = DRAIN_SILT;
  ctx.lineWidth = ts * DRAIN_SILT_WIDTH;
  ctx.lineCap = 'round';
  for (let streak = 0; streak < DRAIN_SILT_STREAKS; streak++) {
    const a = FULL_TURN * ((streak + hash01(streak, tx)) / DRAIN_SILT_STREAKS);
    const curled = a + FULL_TURN * DRAIN_SILT_CURL;
    const outer = ts * (DRAIN_SILT_OUTER - DRAIN_SILT_INNER * hash01(ty, streak) * HALF);
    const inner = ts * DRAIN_SILT_INNER;
    ctx.beginPath();
    ctx.moveTo(cx + Math.cos(a) * outer, cy + Math.sin(a) * outer * DRAIN_TILT);
    ctx.lineTo(cx + Math.cos(curled) * inner, cy + Math.sin(curled) * inner * DRAIN_TILT);
    ctx.stroke();
  }

  const frameR = ts * DRAIN_FRAME_RADIUS;
  ctx.fillStyle = DRAIN_FRAME;
  ctx.beginPath();
  ctx.ellipse(cx, cy, frameR, frameR * DRAIN_TILT, 0, 0, FULL_TURN);
  ctx.fill();
  ctx.strokeStyle = DRAIN_FRAME_LIGHT;
  ctx.lineWidth = ts * DRAIN_FRAME_WIDTH * HALF;
  ctx.beginPath();
  ctx.ellipse(cx, cy, frameR, frameR * DRAIN_TILT, 0, Math.PI, Math.PI * (1 + HALF));
  ctx.stroke();
  const boreR = ts * DRAIN_BORE_RADIUS;
  ctx.fillStyle = DRAIN_BORE;
  ctx.beginPath();
  ctx.ellipse(cx, cy, boreR, boreR * DRAIN_TILT, 0, 0, FULL_TURN);
  ctx.fill();

  paintDrainGrate(ctx, cx, cy, ts, boreR);
  if (state.residue) paintDrainResidue(ctx, cx, cy, ts, tx + ty);
  if (state.water > 0) {
    ctx.fillStyle = DRAIN_WATER_VEIL;
    ctx.globalAlpha = state.water;
    ctx.beginPath();
    ctx.ellipse(cx, cy, frameR, frameR * DRAIN_TILT, 0, 0, FULL_TURN);
    ctx.fill();
    ctx.globalAlpha = 1;
    if (state.pull > 0) paintDrainSwirl(ctx, cx, cy, ts, state);
  }
  ctx.restore();
}

function paintDrainGrate(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  boreR: number,
): void {
  const barW = ts * DRAIN_BAR_WIDTH;
  const spacing = ts * DRAIN_BAR_SPACING;
  for (const offset of DRAIN_BAR_OFFSETS) {
    const barX = cx + offset * spacing;
    const across = Math.abs(barX - cx) / boreR;
    const halfLength = boreR * DRAIN_TILT * Math.sqrt(Math.max(0, 1 - across * across));
    ctx.fillStyle = DRAIN_BAR;
    ctx.fillRect(barX - barW * HALF, cy - halfLength, barW, halfLength * 2);
    ctx.fillStyle = DRAIN_BAR_LIGHT;
    ctx.fillRect(barX - barW * HALF, cy - halfLength, barW * HALF, halfLength * 2);
  }
  const stubLength = boreR * DRAIN_TILT * DRAIN_BROKEN_STUB;
  ctx.fillStyle = DRAIN_BAR;
  ctx.fillRect(cx - barW * HALF, cy - boreR * DRAIN_TILT, barW, stubLength);
}

function paintDrainResidue(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  seed: number,
): void {
  ctx.strokeStyle = NEST_STRAW;
  ctx.lineWidth = ts * NEST_STRAW_WIDTH;
  ctx.lineCap = 'round';
  const length = ts * DRAIN_RESIDUE_LENGTH;
  for (let straw = 0; straw < DRAIN_RESIDUE_STRAWS; straw++) {
    const a = Math.PI * hash01(straw, seed);
    const shift = ts * DRAIN_BAR_SPACING * (straw - 1);
    ctx.beginPath();
    ctx.moveTo(cx + shift - Math.cos(a) * length * HALF, cy - Math.sin(a) * length * HALF * HALF);
    ctx.lineTo(cx + shift + Math.cos(a) * length * HALF, cy + Math.sin(a) * length * HALF * HALF);
    ctx.stroke();
  }
}

function paintDrainSwirl(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  state: SumpDrainState,
): void {
  const spin = state.swirlTurns * FULL_TURN;
  ctx.strokeStyle = DRAIN_SWIRL;
  ctx.lineWidth = Math.max(1, ts * DRAIN_SWIRL_WIDTH);
  ctx.lineCap = 'round';
  ctx.globalAlpha = state.water * state.pull;
  for (let arc = 0; arc < DRAIN_SWIRL_ARCS; arc++) {
    const share = arc / DRAIN_SWIRL_ARCS;
    const radius = ts * (DRAIN_SWIRL_INNER + (DRAIN_SWIRL_OUTER - DRAIN_SWIRL_INNER) * share);
    // The inner rings turn faster, as water does nearer a plughole.
    const start = spin * (1 + (1 - share)) + share * FULL_TURN;
    ctx.beginPath();
    ctx.ellipse(
      cx,
      cy,
      radius,
      radius * DRAIN_TILT,
      0,
      start,
      start + FULL_TURN * DRAIN_SWIRL_SPAN,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

/**
 * Paints the bits of a washing-out nest drawn round and down into the drain
 * at (cx, cy), the drain tile's centre: each spirals in from the nest's
 * edge and is gone at the mouth. `amount` runs from 0, none, to 1, the wash
 * at its height. `seed`, from the drain's world tile, fixes each bit's path
 * so the camera moving does not reshuffle them. Drawn over the nest.
 */
export function paintDrainDebris(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  ts: number,
  seed: number,
  amount: number,
  nowMs: number,
): void {
  if (amount <= 0) return;
  ctx.save();
  for (let bit = 0; bit < DRAIN_DEBRIS_BITS; bit++) {
    const run = (nowMs / DRAIN_DEBRIS_PERIOD_MS + bit / DRAIN_DEBRIS_BITS) % 1;
    const remaining = 1 - run;
    const radius = ts * DRAIN_DEBRIS_REACH_TILES * remaining;
    const a = FULL_TURN * (hash01(bit, seed) + run * DRAIN_DEBRIS_SPIRAL_TURNS);
    const size = ts * DRAIN_DEBRIS_SIZE * (HALF + remaining * HALF);
    const fadeIn = Math.min(1, run / DRAIN_DEBRIS_FADE_IN);
    ctx.globalAlpha = amount * fadeIn;
    ctx.fillStyle = DRAIN_DEBRIS_COLOURS[bit % DRAIN_DEBRIS_COLOURS.length] ?? NEST_DARK;
    ctx.save();
    ctx.translate(cx + Math.cos(a) * radius, cy + Math.sin(a) * radius * DRAIN_TILT);
    ctx.rotate(a);
    ctx.fillRect(-size * HALF, -size * HALF * HALF, size, size * HALF);
    ctx.restore();
  }
  ctx.restore();
}
