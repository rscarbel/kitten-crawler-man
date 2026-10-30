/**
 * The sewer's fittings, painted at runtime: a sluice's valve wheel on its
 * post, the rat nest choking the sump, the iron ladder up to the street
 * grate, the bars of a street grate's shadow on the walkway, the cistern
 * culvert's mouth and the spillway's outfall pipe.
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
 * runs from 1, whole, to 0, carried off by the water.
 */
export function paintRatNestTile(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  ts: number,
  tx: number,
  ty: number,
  presence: number,
): void {
  if (presence <= 0) return;
  ctx.save();
  ctx.globalAlpha = presence;
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
