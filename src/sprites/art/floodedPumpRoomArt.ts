/**
 * Drawing engine for the Kraken's flooded pump room.
 *
 * A service pump room that lost to the water: plank rafts lashed together from
 * whatever floated, three skid-mounted pumps still dumping the flood back in
 * through their outflow chutes, and the cellar's own barrels bobbing in it.
 * The shark she keeps is painted by `deadSharkArt.ts`. The water is murky runoff over concrete, so everything
 * wet here is painted in grey-green silt tones rather than a river's blue, and
 * nothing glints brighter than a dull highlight.
 *
 * Every measurement is a fraction of the caller's `ts` (the logical tile), and
 * every painter is handed the anchor tile's top-left corner. Light comes from
 * the upper left, as on every other prop.
 *
 * These paint prop-sheet cells once, at floor load, so gradients are fine here;
 * nothing in this file runs per frame.
 */

import { mulberry32, type Rng } from '../person/rng';
import { drawProp } from './destructiblePropArt';
import { contactShadow, lerp, PROP_VARIANT_COUNT, SHATTER_FRAMES } from './propPaint';

type Ctx = CanvasRenderingContext2D;

const TWO_PI = Math.PI * 2;
const HALF = 0.5;

// ── Frame counts every sheet plan and runtime frame pick agree on ────────────

/** Looks per raft piece; neighbouring tiles pick different ones so the deck never repeats. */
export const RAFT_PLANK_VARIANTS = PROP_VARIANT_COUNT;
export const PUMP_RUNNING_FRAMES = 4;
/** One sixth of a turn: the hand-wheel's six spokes make every sixth of a turn look the same. */
export const VALVE_TURN_FRAMES = 6;
export const VALVE_SPOKES = 6;
export const CHUTE_POUR_FRAMES = 4;
export const CHUTE_DRIP_FRAMES = 3;
export const BARREL_FLOAT_FRAMES = 4;
export const BARREL_SETTLED_VARIANTS = PROP_VARIANT_COUNT;
export const BARREL_SHATTER_FRAMES = SHATTER_FRAMES;
export const DRAIN_SWIRL_FRAMES = 4;

// ── Palette ──────────────────────────────────────────────────────────────────

/** Waterlogged deal planks: grey-brown, darker than the cellar's oak furniture. */
const PLANK_TONES = ['#6a5a45', '#5e503e', '#71614b', '#63543f'] as const;
const PLANK_SETTLED_TONES = ['#776a56', '#6c604e', '#7d705b', '#706452'] as const;
const PLANK_GAP = '#231b13';
const PLANK_LIP = 'rgba(214, 196, 158, 0.32)';
const PLANK_GRAIN = 'rgba(30, 22, 14, 0.1)';
const PLANK_END_GRAIN = '#3e3226';
const PLANK_FACE = '#3a2f23';
const PLANK_FACE_WET = '#1d1812';
const PLANK_WET_EDGE = 'rgba(18, 16, 10, 0.32)';
const PLANK_KNOT = '#3f3326';
const NAIL = 'rgba(30, 26, 22, 0.75)';
const NAIL_GLINT = 'rgba(170, 162, 148, 0.35)';
const ROPE = '#7d6c4a';
const ROPE_DARK = '#3f3422';
const SILT_FILM = 'rgba(112, 104, 84, 0.42)';
const SILT_DARK = 'rgba(58, 52, 40, 0.38)';
const TIDE_MARK = 'rgba(150, 140, 112, 0.55)';

/** Machine paint: the faded green every service pump leaves the factory in. */
const PAINT_DARK = '#25362b';
const PAINT_MID = '#3f5a46';
const PAINT_LIGHT = '#69866d';
const PAINT_SPEC = '#9db69c';
const RUST = 'rgba(122, 70, 36, 0.6)';
const RUST_STREAK = 'rgba(96, 54, 28, 0.45)';
const STEEL_EDGE = '#14181b';
const STEEL_DARK = '#2b3237';
const STEEL_MID = '#4b555c';
const STEEL_LIGHT = '#78838a';
const STEEL_SPEC = '#a7b0b4';
const GUARD_YELLOW = '#b89a34';
const GUARD_YELLOW_DARK = '#6e5a1c';
const LAMP_ON = '#7dff9e';
const LAMP_ON_HALO = 'rgba(125, 255, 158, 0.35)';
const LAMP_OFF = '#5a1c1a';
const GAUGE_FACE = '#d9d4c0';
const GAUGE_RED = '#b0322a';
const WHEEL_DARK = '#4e1410';
const WHEEL_MID = '#9a2b22';
const WHEEL_LIGHT = '#d05a48';

/** The flood itself, as it pours and churns: silty grey-green, never blue. */
const STREAM_BODY = 'rgba(132, 142, 122, 0.82)';
const STREAM_CORE = 'rgba(176, 184, 160, 0.75)';
const STREAM_STREAK = 'rgba(222, 226, 206, 0.8)';
const FOAM = 'rgba(214, 216, 198, 0.85)';
const FOAM_SOFT = 'rgba(200, 204, 186, 0.45)';
const RIPPLE = 'rgba(190, 196, 176, 0.6)';
const MURK = 'rgba(46, 54, 48, 0.62)';
const DRIP = 'rgba(176, 184, 160, 0.9)';

const CONCRETE_COLLAR = '#5a5850';
const CONCRETE_COLLAR_LIGHT = '#77746a';
const CONCRETE_COLLAR_DARK = '#38362f';
const IRON_DARK = '#1c1b19';
const IRON_MID = '#3b3934';
const IRON_LIGHT = '#66625a';
const DRAIN_STAIN = 'rgba(40, 36, 26, 0.3)';
const SWIRL_LINE = 'rgba(206, 212, 192, 0.6)';
const SWIRL_HOLE = 'rgba(16, 20, 16, 0.75)';

// ── Shared helpers ───────────────────────────────────────────────────────────

function fillEllipse(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, Math.max(0, rx), Math.max(0, ry), 0, 0, TWO_PI);
  ctx.fill();
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

/** A pipe run between two points, lit along its upper-left side. */
function pipe(ctx: Ctx, x0: number, y0: number, x1: number, y1: number, width: number): void {
  ctx.lineCap = 'butt';
  ctx.strokeStyle = STEEL_EDGE;
  ctx.lineWidth = width + PIPE_OUTLINE_PX;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.stroke();
  ctx.strokeStyle = STEEL_MID;
  ctx.lineWidth = width;
  ctx.stroke();
  const along = Math.atan2(y1 - y0, x1 - x0);
  // The lit side is whichever flank faces up and left.
  const normalX = Math.sin(along);
  const normalY = -Math.cos(along);
  const litSide = normalX + normalY < 0 ? 1 : -1;
  const offset = width * PIPE_SPEC_OFFSET * litSide;
  ctx.strokeStyle = STEEL_LIGHT;
  ctx.lineWidth = width * PIPE_SPEC_WIDTH;
  ctx.beginPath();
  ctx.moveTo(x0 + normalX * offset, y0 + normalY * offset);
  ctx.lineTo(x1 + normalX * offset, y1 + normalY * offset);
  ctx.stroke();
}
const PIPE_OUTLINE_PX = 1.5;
const PIPE_SPEC_OFFSET = 0.28;
const PIPE_SPEC_WIDTH = 0.28;

/** A bolted ring round a pipe, drawn across its run. */
function flange(
  ctx: Ctx,
  cx: number,
  cy: number,
  across: number,
  thick: number,
  vertical: boolean,
) {
  const w = vertical ? across : thick;
  const h = vertical ? thick : across;
  ctx.fillStyle = STEEL_EDGE;
  ctx.fillRect(cx - w / 2 - HALF, cy - h / 2 - HALF, w + 1, h + 1);
  ctx.fillStyle = STEEL_LIGHT;
  ctx.fillRect(cx - w / 2, cy - h / 2, w, h);
  ctx.fillStyle = STEEL_DARK;
  if (vertical) ctx.fillRect(cx - w / 2, cy + h / 2 - 1, w, 1);
  else ctx.fillRect(cx + w / 2 - 1, cy - h / 2, 1, h);
}

/** Splash spray: droplets thrown up and out of a churn, as a pure function of `phase`. */
function spray(
  ctx: Ctx,
  rng: Rng,
  cx: number,
  cy: number,
  spread: number,
  rise: number,
  count: number,
  phase: number,
  ts: number,
): void {
  ctx.fillStyle = DRIP;
  for (let i = 0; i < count; i++) {
    const offset = rng();
    const life = (phase + offset) % 1;
    const dir = rng() * 2 - 1;
    const height = rise * (HALF + rng() * HALF);
    const dx = dir * spread * life;
    const dy = -height * 4 * life * (1 - life);
    const r = ts * SPRAY_DROP_RADIUS * (1 - life * HALF);
    ctx.globalAlpha = 1 - life;
    fillEllipse(ctx, cx + dx, cy + dy, r, r);
  }
  ctx.globalAlpha = 1;
}
const SPRAY_DROP_RADIUS = 0.035;

// ── Rafts ────────────────────────────────────────────────────────────────────

/** Whether a raft is still afloat or has come to rest on the drained floor. */
export type RaftCondition = 'floating' | 'settled';

/** Where a tile sits in its raft: a corner, an edge, or the deck's centre. */
export type RaftPiece = 'nw' | 'n' | 'ne' | 'w' | 'c' | 'e' | 'sw' | 's' | 'se';

interface RaftEdges {
  readonly north: boolean;
  readonly south: boolean;
  readonly west: boolean;
  readonly east: boolean;
}

const RAFT_PIECE_EDGES = {
  nw: { north: true, south: false, west: true, east: false },
  n: { north: true, south: false, west: false, east: false },
  ne: { north: true, south: false, west: false, east: true },
  w: { north: false, south: false, west: true, east: false },
  c: { north: false, south: false, west: false, east: false },
  e: { north: false, south: false, west: false, east: true },
  sw: { north: false, south: true, west: true, east: false },
  s: { north: false, south: true, west: false, east: false },
  se: { north: false, south: true, west: false, east: true },
} as const satisfies Record<RaftPiece, RaftEdges>;

export const RAFT_PIECES: readonly RaftPiece[] = ['nw', 'n', 'ne', 'w', 'c', 'e', 'sw', 's', 'se'];
export const RAFT_CONDITIONS: readonly RaftCondition[] = ['floating', 'settled'];

/** Raft geometry in tile fractions. */
const RAFT = {
  planksPerTile: 4,
  /** How far an edge plank's sawn end may fall short of the tile's edge. */
  endRaggedMax: 0.12,
  endInsetMin: 0.04,
  northInset: 0.03,
  /** The deck's thickness, seen as a face below a south edge. */
  faceDepth: 0.16,
  faceWetShare: 0.45,
  /** A batten runs under every tile's middle; its nails show through the deck. */
  battenX: 0.5,
  nailSpread: 0.07,
  nailRadius: 0.032,
  jointChance: 0.2,
  jointMin: 0.15,
  jointMax: 0.85,
  grainStreaks: 1,
  knotChance: 0.12,
  knotRadius: 0.05,
  wetEdgeDepth: 0.18,
  lashTurns: 3,
  lashLength: 0.22,
  lashWidth: 0.045,
  siltBlots: 3,
  siltRadiusMin: 0.12,
  siltRadiusMax: 0.24,
} as const;

/** Each piece position seeds its own stream, so every looks distinct from its neighbours. */
const RAFT_PIECE_SALT: Record<RaftPiece, number> = {
  nw: 11,
  n: 23,
  ne: 37,
  w: 41,
  c: 53,
  e: 67,
  sw: 71,
  s: 83,
  se: 97,
};
const RAFT_SEED = 0x7af1;

/**
 * One tile of a plank raft: four planks running east to west, their sawn ends
 * ragged along a west or east edge, the deck's thickness showing below a south
 * edge, and rope lashing at the corners. Deck planks keep the same tone in a
 * row across the whole raft, so a raft of any size reads as one set of planks
 * rather than a grid of tiles; only joints, nails, knots and grime vary.
 */
export function paintRaftTile(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  piece: RaftPiece,
  condition: RaftCondition,
  variant: number,
): void {
  const edges = RAFT_PIECE_EDGES[piece];
  const rng = mulberry32(RAFT_SEED + RAFT_PIECE_SALT[piece] * (variant + 1));
  const plankH = ts / RAFT.planksPerTile;
  const tones = condition === 'floating' ? PLANK_TONES : PLANK_SETTLED_TONES;
  const top = oy + (edges.north ? ts * RAFT.northInset : 0);

  for (let row = 0; row < RAFT.planksPerTile; row++) {
    const y0 = oy + row * plankH;
    const y1 = y0 + plankH;
    const rowTop = Math.max(y0, top);
    const westInset = edges.west
      ? ts * (RAFT.endInsetMin + rng() * (RAFT.endRaggedMax - RAFT.endInsetMin))
      : 0;
    const eastInset = edges.east
      ? ts * (RAFT.endInsetMin + rng() * (RAFT.endRaggedMax - RAFT.endInsetMin))
      : 0;
    const x0 = ox + westInset;
    const x1 = ox + ts - eastInset;
    ctx.fillStyle = tones[row % tones.length] ?? tones[0];
    ctx.fillRect(x0, rowTop, x1 - x0, y1 - rowTop);

    ctx.fillStyle = PLANK_GRAIN;
    for (let s = 0; s < RAFT.grainStreaks; s++) {
      const gy = rowTop + 1 + rng() * (y1 - rowTop - 2);
      const gx = x0 + rng() * (x1 - x0) * HALF;
      ctx.fillRect(gx, gy, (x1 - x0) * (HALF + rng() * HALF) * HALF, 1);
    }
    if (rng() < RAFT.knotChance) {
      ctx.fillStyle = PLANK_KNOT;
      fillEllipse(
        ctx,
        lerp(x0, x1, RAFT.jointMin + rng() * (RAFT.jointMax - RAFT.jointMin)),
        (rowTop + y1) / 2,
        ts * RAFT.knotRadius * 1.6,
        ts * RAFT.knotRadius,
      );
    }

    ctx.fillStyle = PLANK_LIP;
    ctx.fillRect(x0, rowTop, x1 - x0, 1);
    ctx.fillStyle = PLANK_GAP;
    ctx.fillRect(x0, y1 - 1, x1 - x0, 1);

    if (rng() < RAFT.jointChance) {
      const jx = Math.round(lerp(x0, x1, RAFT.jointMin + rng() * (RAFT.jointMax - RAFT.jointMin)));
      ctx.fillStyle = PLANK_GAP;
      ctx.fillRect(jx, rowTop, 1, y1 - rowTop);
      ctx.fillStyle = PLANK_LIP;
      ctx.fillRect(jx + 1, rowTop, 1, y1 - rowTop);
    }

    const nailX = ox + ts * RAFT.battenX;
    {
      const nx = nailX + (row % 2 === 0 ? -1 : 1) * ts * RAFT.nailSpread;
      const ny = (rowTop + y1) / 2;
      ctx.fillStyle = NAIL;
      fillEllipse(ctx, nx, ny, ts * RAFT.nailRadius, ts * RAFT.nailRadius);
      ctx.fillStyle = NAIL_GLINT;
      ctx.fillRect(Math.round(nx - 1), Math.round(ny - 1), 1, 1);
    }

    for (const [onEdge, endX, dir] of [
      [edges.west, x0, 1],
      [edges.east, x1, -1],
    ] as const) {
      if (!onEdge) continue;
      ctx.fillStyle = PLANK_END_GRAIN;
      ctx.fillRect(dir > 0 ? endX : endX - 1, rowTop, 1, y1 - rowTop - 1);
    }
  }

  if (condition === 'floating') paintRaftWetEdges(ctx, ox, oy, ts, edges);
  else paintRaftSilt(ctx, rng, ox, oy, ts);

  if (edges.south) paintRaftFace(ctx, rng, ox, oy, ts, edges, condition);
  if (edges.north) {
    ctx.fillStyle = PLANK_LIP;
    ctx.fillRect(ox, top, ts, 1);
  }
  paintRaftLashing(ctx, ox, oy, ts, edges);
}

/** The planks darken where the water laps over them, so the raft sits in it rather than on it. */
function paintRaftWetEdges(ctx: Ctx, ox: number, oy: number, ts: number, edges: RaftEdges) {
  const depth = ts * RAFT.wetEdgeDepth;
  const bands: Array<[boolean, number, number, number, number]> = [
    [edges.north, ox, oy, ox, oy + depth],
    [edges.south, ox, oy + ts, ox, oy + ts - depth],
    [edges.west, ox, oy, ox + depth, oy],
    [edges.east, ox + ts, oy, ox + ts - depth, oy],
  ];
  for (const [onEdge, x0, y0, x1, y1] of bands) {
    if (!onEdge) continue;
    const grad = ctx.createLinearGradient(x0, y0, x1, y1);
    grad.addColorStop(0, PLANK_WET_EDGE);
    grad.addColorStop(1, 'rgba(18, 16, 10, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(ox, oy, ts, ts);
  }
}

/** Dried silt the flood left on a settled raft: a few wide soft blots, never speckle. */
function paintRaftSilt(ctx: Ctx, rng: Rng, ox: number, oy: number, ts: number) {
  for (let i = 0; i < RAFT.siltBlots; i++) {
    const r = ts * lerp(RAFT.siltRadiusMin, RAFT.siltRadiusMax, rng());
    const cx = ox + rng() * ts;
    const cy = oy + rng() * ts;
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, r);
    grad.addColorStop(0, i === 0 ? SILT_DARK : SILT_FILM);
    grad.addColorStop(1, 'rgba(112, 104, 84, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(ox, oy, ts, ts);
  }
}

/** The deck's thickness below a south edge: plank ends in shadow, black with water below. */
function paintRaftFace(
  ctx: Ctx,
  rng: Rng,
  ox: number,
  oy: number,
  ts: number,
  edges: RaftEdges,
  condition: RaftCondition,
) {
  const depth = ts * RAFT.faceDepth;
  const x0 = ox + (edges.west ? ts * RAFT.endInsetMin : 0);
  const x1 = ox + ts - (edges.east ? ts * RAFT.endInsetMin : 0);
  ctx.fillStyle = PLANK_FACE;
  ctx.fillRect(x0, oy + ts, x1 - x0, depth);
  if (condition === 'floating') {
    ctx.fillStyle = PLANK_FACE_WET;
    ctx.fillRect(x0, oy + ts + depth * (1 - RAFT.faceWetShare), x1 - x0, depth * RAFT.faceWetShare);
  } else {
    ctx.fillStyle = TIDE_MARK;
    ctx.fillRect(x0, oy + ts + depth * HALF, x1 - x0, 1);
  }
  ctx.fillStyle = PLANK_GAP;
  const seams = 2;
  for (let i = 0; i < seams; i++) {
    ctx.fillRect(Math.round(lerp(x0, x1, rng())), oy + ts, 1, depth);
  }
}

/** Rope wound round the corner planks, which is all that holds a scavenged raft together. */
function paintRaftLashing(ctx: Ctx, ox: number, oy: number, ts: number, edges: RaftEdges) {
  const corners: Array<[boolean, number, number]> = [
    [edges.north && edges.west, ox + ts * RAFT.lashLength, oy],
    [edges.north && edges.east, ox + ts * (1 - RAFT.lashLength), oy],
    [edges.south && edges.west, ox + ts * RAFT.lashLength, oy + ts],
    [edges.south && edges.east, ox + ts * (1 - RAFT.lashLength), oy + ts],
  ];
  const w = ts * RAFT.lashWidth;
  for (const [onCorner, cx, edgeY] of corners) {
    if (!onCorner) continue;
    const span = ts / RAFT.planksPerTile;
    const y0 = edgeY === oy ? oy : oy + ts - span;
    for (let turn = 0; turn < RAFT.lashTurns; turn++) {
      const x = cx + (turn - 1) * w * 1.2;
      ctx.fillStyle = ROPE_DARK;
      ctx.fillRect(x - w / 2, y0, w + 1, span);
      ctx.fillStyle = ROPE;
      ctx.fillRect(x - w / 2, y0, w, span - 1);
    }
  }
}

// ── Pump ─────────────────────────────────────────────────────────────────────

/**
 * Pump geometry in tile fractions from the anchor tile's top-left; negative is
 * above the tile. The pump blocks its anchor tile and overhangs half a tile
 * each side: a skid-mounted motor on the left driving a volute on the right of
 * centre, whose discharge riser climbs to the outflow pipe at
 * {@link OUTFLOW_PIPE_Y_TILES}.
 */
const PUMP = {
  skidLeft: -0.42,
  skidRight: 1.4,
  skidTop: 0.6,
  skidBottom: 0.86,
  motorLeft: -0.38,
  motorRight: 0.3,
  motorCy: 0.34,
  motorR: 0.25,
  motorFins: 6,
  motorBellRx: 0.08,
  boxLeft: -0.2,
  boxRight: 0.12,
  boxTop: -0.02,
  boxBottom: 0.1,
  lampX: -0.04,
  lampY: 0.04,
  lampR: 0.04,
  guardLeft: 0.28,
  guardRight: 0.42,
  guardHalfH: 0.13,
  voluteCx: 0.62,
  voluteCy: 0.36,
  voluteR: 0.26,
  voluteEyeR: 0.1,
  suctionX: 1.12,
  suctionWidth: 0.2,
  suctionTop: 0.34,
  /** The riser: from the volute's crown to the outflow elbow. */
  riserX: 0.62,
  riserWidth: 0.2,
  valveBodyHalfW: 0.17,
  valveBodyTop: -0.78,
  valveBodyBottom: -0.36,
  flangeThick: 0.07,
  flangeAcross: 0.3,
  gaugeX: 0.86,
  gaugeY: -0.12,
  gaugeR: 0.09,
  gaugeArm: 0.14,
  shake: 0.03,
  glandDrips: 4,
  rustBlots: 3,
} as const;

/**
 * Where the outflow pipe runs, in tiles above the pump's (and the outfall's)
 * anchor tile top. The pump's riser ends here and the chute's elbow begins
 * here, so the two sheets meet without either knowing the other's frame.
 */
export const OUTFLOW_PIPE_Y_TILES = -1.55;
/** Tiles from the pump's anchor tile to the tile its chute pours into, along the row. */
export const PUMP_OUTFALL_OFFSET_TILES = 2;
/** The hand-wheel's centre, in tiles from the pump's anchor tile top-left. */
export const PUMP_VALVE_CENTRE_TILES = { x: PUMP.riserX, y: -0.57 } as const;
const VALVE_WHEEL_RADIUS = 0.3;

/** A pump running or shut off. Running shudders and its lamp is lit. */
export function paintPump(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  running: boolean,
  frame: number,
) {
  const rng = mulberry32(PUMP_SEED);
  const shake = running && frame % 2 === 1 ? ts * PUMP.shake : 0;
  const X = (f: number) => ox + ts * f;
  const Y = (f: number) => oy + ts * f;

  contactShadow(ctx, X((PUMP.skidLeft + PUMP.skidRight) / 2), Y(PUMP.skidBottom), ts, 2.4);

  // Suction pipe down into the water at the wall's foot.
  pipe(ctx, X(PUMP.suctionX), Y(PUMP.suctionTop), X(PUMP.suctionX), Y(1), ts * PUMP.suctionWidth);
  pipe(
    ctx,
    X(PUMP.voluteCx),
    Y(PUMP.suctionTop),
    X(PUMP.suctionX),
    Y(PUMP.suctionTop),
    ts * PUMP.suctionWidth,
  );
  flange(
    ctx,
    X(PUMP.suctionX),
    Y(PUMP.skidTop),
    ts * PUMP.flangeAcross,
    ts * PUMP.flangeThick,
    true,
  );

  // Skid: a steel channel the whole machine is bolted to.
  ctx.fillStyle = STEEL_EDGE;
  ctx.fillRect(
    X(PUMP.skidLeft) - 1,
    Y(PUMP.skidTop) - 1,
    ts * (PUMP.skidRight - PUMP.skidLeft) + 2,
    ts * (PUMP.skidBottom - PUMP.skidTop) + 2,
  );
  const skidGrad = ctx.createLinearGradient(0, Y(PUMP.skidTop), 0, Y(PUMP.skidBottom));
  skidGrad.addColorStop(0, STEEL_LIGHT);
  skidGrad.addColorStop(HALF, STEEL_MID);
  skidGrad.addColorStop(1, STEEL_DARK);
  ctx.fillStyle = skidGrad;
  ctx.fillRect(
    X(PUMP.skidLeft),
    Y(PUMP.skidTop),
    ts * (PUMP.skidRight - PUMP.skidLeft),
    ts * (PUMP.skidBottom - PUMP.skidTop),
  );
  ctx.fillStyle = RUST_STREAK;
  ctx.fillRect(X(PUMP.skidLeft), Y(PUMP.skidBottom) - 2, ts * (PUMP.skidRight - PUMP.skidLeft), 2);

  // Riser up to the outflow pipe, with its gate valve.
  const riserTop = oy + ts * OUTFLOW_PIPE_Y_TILES;
  pipe(ctx, X(PUMP.riserX), Y(PUMP.voluteCy), X(PUMP.riserX), riserTop, ts * PUMP.riserWidth);
  flange(
    ctx,
    X(PUMP.riserX),
    Y(PUMP.valveBodyBottom) + ts * PUMP.flangeThick,
    ts * PUMP.flangeAcross,
    ts * PUMP.flangeThick,
    true,
  );
  flange(
    ctx,
    X(PUMP.riserX),
    Y(PUMP.valveBodyTop) - ts * PUMP.flangeThick,
    ts * PUMP.flangeAcross,
    ts * PUMP.flangeThick,
    true,
  );
  ctx.fillStyle = STEEL_EDGE;
  roundRect(
    ctx,
    X(PUMP.riserX - PUMP.valveBodyHalfW) - 1,
    Y(PUMP.valveBodyTop) - 1,
    ts * PUMP.valveBodyHalfW * 2 + 2,
    ts * (PUMP.valveBodyBottom - PUMP.valveBodyTop) + 2,
    ts * 0.06,
  );
  ctx.fill();
  const valveGrad = ctx.createLinearGradient(
    X(PUMP.riserX - PUMP.valveBodyHalfW),
    0,
    X(PUMP.riserX + PUMP.valveBodyHalfW),
    0,
  );
  valveGrad.addColorStop(0, PAINT_LIGHT);
  valveGrad.addColorStop(HALF, PAINT_MID);
  valveGrad.addColorStop(1, PAINT_DARK);
  ctx.fillStyle = valveGrad;
  roundRect(
    ctx,
    X(PUMP.riserX - PUMP.valveBodyHalfW),
    Y(PUMP.valveBodyTop),
    ts * PUMP.valveBodyHalfW * 2,
    ts * (PUMP.valveBodyBottom - PUMP.valveBodyTop),
    ts * 0.05,
  );
  ctx.fill();
  flange(
    ctx,
    X(PUMP.riserX),
    riserTop + ts * PUMP.flangeThick * 2,
    ts * PUMP.flangeAcross,
    ts * PUMP.flangeThick,
    true,
  );

  // Gauge on a short arm off the riser.
  ctx.strokeStyle = STEEL_DARK;
  ctx.lineWidth = Math.max(1, ts * 0.04);
  ctx.beginPath();
  ctx.moveTo(X(PUMP.riserX), Y(PUMP.gaugeY));
  ctx.lineTo(X(PUMP.gaugeX), Y(PUMP.gaugeY));
  ctx.stroke();
  ctx.fillStyle = STEEL_EDGE;
  fillEllipse(ctx, X(PUMP.gaugeX), Y(PUMP.gaugeY), ts * PUMP.gaugeR + 1, ts * PUMP.gaugeR + 1);
  ctx.fillStyle = GAUGE_FACE;
  fillEllipse(ctx, X(PUMP.gaugeX), Y(PUMP.gaugeY), ts * PUMP.gaugeR, ts * PUMP.gaugeR);
  const needleAngle = running ? GAUGE_RUNNING_ANGLE + (frame % 2) * GAUGE_JITTER : GAUGE_REST_ANGLE;
  ctx.strokeStyle = GAUGE_RED;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(X(PUMP.gaugeX), Y(PUMP.gaugeY));
  ctx.lineTo(
    X(PUMP.gaugeX) + Math.cos(needleAngle) * ts * PUMP.gaugeR * 0.85,
    Y(PUMP.gaugeY) + Math.sin(needleAngle) * ts * PUMP.gaugeR * 0.85,
  );
  ctx.stroke();

  ctx.save();
  ctx.translate(shake, 0);

  // Volute: the snail-shell casing the water is flung through.
  ctx.fillStyle = STEEL_EDGE;
  fillEllipse(
    ctx,
    X(PUMP.voluteCx),
    Y(PUMP.voluteCy),
    ts * PUMP.voluteR + 1,
    ts * PUMP.voluteR + 1,
  );
  const voluteGrad = ctx.createRadialGradient(
    X(PUMP.voluteCx - PUMP.voluteR * 0.4),
    Y(PUMP.voluteCy - PUMP.voluteR * 0.4),
    0,
    X(PUMP.voluteCx),
    Y(PUMP.voluteCy),
    ts * PUMP.voluteR,
  );
  voluteGrad.addColorStop(0, PAINT_LIGHT);
  voluteGrad.addColorStop(0.6, PAINT_MID);
  voluteGrad.addColorStop(1, PAINT_DARK);
  ctx.fillStyle = voluteGrad;
  fillEllipse(ctx, X(PUMP.voluteCx), Y(PUMP.voluteCy), ts * PUMP.voluteR, ts * PUMP.voluteR);
  ctx.strokeStyle = PAINT_DARK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(
    X(PUMP.voluteCx),
    Y(PUMP.voluteCy),
    ts * PUMP.voluteR * 0.7,
    Math.PI * 0.9,
    Math.PI * 2.3,
  );
  ctx.stroke();
  ctx.fillStyle = STEEL_DARK;
  fillEllipse(ctx, X(PUMP.voluteCx), Y(PUMP.voluteCy), ts * PUMP.voluteEyeR, ts * PUMP.voluteEyeR);
  ctx.fillStyle = STEEL_SPEC;
  fillEllipse(ctx, X(PUMP.voluteCx) - 1, Y(PUMP.voluteCy) - 1, 1, 1);

  // Coupling guard, in the warning yellow every rotating part is painted.
  ctx.fillStyle = GUARD_YELLOW_DARK;
  ctx.fillRect(
    X(PUMP.guardLeft) - 1,
    Y(PUMP.motorCy - PUMP.guardHalfH) - 1,
    ts * (PUMP.guardRight - PUMP.guardLeft) + 2,
    ts * PUMP.guardHalfH * 2 + 2,
  );
  ctx.fillStyle = GUARD_YELLOW;
  ctx.fillRect(
    X(PUMP.guardLeft),
    Y(PUMP.motorCy - PUMP.guardHalfH),
    ts * (PUMP.guardRight - PUMP.guardLeft),
    ts * PUMP.guardHalfH * 2,
  );

  // Motor: a finned cylinder lying on its side, its bell end toward the viewer's left.
  const motorTop = Y(PUMP.motorCy - PUMP.motorR);
  const motorH = ts * PUMP.motorR * 2;
  ctx.fillStyle = STEEL_EDGE;
  roundRect(
    ctx,
    X(PUMP.motorLeft) - 1,
    motorTop - 1,
    ts * (PUMP.motorRight - PUMP.motorLeft) + 2,
    motorH + 2,
    ts * 0.08,
  );
  ctx.fill();
  const motorGrad = ctx.createLinearGradient(0, motorTop, 0, motorTop + motorH);
  motorGrad.addColorStop(0, PAINT_SPEC);
  motorGrad.addColorStop(0.25, PAINT_LIGHT);
  motorGrad.addColorStop(0.6, PAINT_MID);
  motorGrad.addColorStop(1, PAINT_DARK);
  ctx.fillStyle = motorGrad;
  roundRect(
    ctx,
    X(PUMP.motorLeft),
    motorTop,
    ts * (PUMP.motorRight - PUMP.motorLeft),
    motorH,
    ts * 0.07,
  );
  ctx.fill();
  ctx.fillStyle = 'rgba(20, 30, 24, 0.45)';
  for (let fin = 1; fin < PUMP.motorFins; fin++) {
    const fx = Math.round(
      lerp(X(PUMP.motorLeft + PUMP.motorBellRx), X(PUMP.motorRight), fin / PUMP.motorFins),
    );
    ctx.fillRect(fx, motorTop + 2, 1, motorH - 4);
  }
  ctx.fillStyle = PAINT_DARK;
  fillEllipse(
    ctx,
    X(PUMP.motorLeft + PUMP.motorBellRx * HALF),
    Y(PUMP.motorCy),
    ts * PUMP.motorBellRx,
    ts * PUMP.motorR * 0.9,
  );
  if (running) {
    // A blur of fan blades behind the cowl's grille.
    ctx.strokeStyle = 'rgba(160, 180, 160, 0.45)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    const blurY = Y(PUMP.motorCy) + ((frame % PUMP_RUNNING_FRAMES) - 1.5) * ts * 0.06;
    ctx.moveTo(X(PUMP.motorLeft + 0.02), blurY);
    ctx.lineTo(X(PUMP.motorLeft + PUMP.motorBellRx), blurY);
    ctx.stroke();
  }
  for (let i = 0; i < PUMP.rustBlots; i++) {
    ctx.fillStyle = RUST;
    fillEllipse(
      ctx,
      X(lerp(PUMP.motorLeft, PUMP.motorRight, rng())),
      Y(PUMP.motorCy + PUMP.motorR * (rng() * 0.8)),
      ts * 0.05,
      ts * 0.025,
    );
  }

  // Terminal box and its lamp.
  ctx.fillStyle = STEEL_EDGE;
  ctx.fillRect(
    X(PUMP.boxLeft) - 1,
    Y(PUMP.boxTop) - 1,
    ts * (PUMP.boxRight - PUMP.boxLeft) + 2,
    ts * (PUMP.boxBottom - PUMP.boxTop) + 2,
  );
  ctx.fillStyle = PAINT_MID;
  ctx.fillRect(
    X(PUMP.boxLeft),
    Y(PUMP.boxTop),
    ts * (PUMP.boxRight - PUMP.boxLeft),
    ts * (PUMP.boxBottom - PUMP.boxTop),
  );
  ctx.fillStyle = PAINT_SPEC;
  ctx.fillRect(X(PUMP.boxLeft), Y(PUMP.boxTop), ts * (PUMP.boxRight - PUMP.boxLeft), 1);
  if (running) {
    ctx.fillStyle = LAMP_ON_HALO;
    fillEllipse(ctx, X(PUMP.lampX), Y(PUMP.lampY), ts * PUMP.lampR * 2.2, ts * PUMP.lampR * 2.2);
  }
  ctx.fillStyle = running ? LAMP_ON : LAMP_OFF;
  fillEllipse(ctx, X(PUMP.lampX), Y(PUMP.lampY), ts * PUMP.lampR, ts * PUMP.lampR);
  ctx.restore();

  // The gland under the volute weeps while it runs.
  if (running) {
    const dripRng = mulberry32(PUMP_SEED + 1);
    spray(
      ctx,
      dripRng,
      X(PUMP.voluteCx),
      Y(PUMP.voluteCy + PUMP.voluteR),
      ts * 0.12,
      ts * 0.1,
      PUMP.glandDrips,
      frame / PUMP_RUNNING_FRAMES,
      ts,
    );
  }
}
const PUMP_SEED = 0x9a11;
const GAUGE_RUNNING_ANGLE = -0.35;
const GAUGE_JITTER = 0.25;
const GAUGE_REST_ANGLE = Math.PI * 0.8;

// ── Valve hand-wheel ─────────────────────────────────────────────────────────

/**
 * The gate valve's red hand-wheel, centred in its cell, turned `frame` sixths
 * of a sixth of a turn: the six frames sweep one spoke's spacing, so any
 * number of turns loops through them seamlessly.
 */
export function paintValveWheel(ctx: Ctx, ox: number, oy: number, ts: number, frame: number) {
  const cx = ox + ts * HALF;
  const cy = oy + ts * HALF;
  const r = ts * VALVE_WHEEL_RADIUS;
  const turn = (frame / VALVE_TURN_FRAMES) * (TWO_PI / VALVE_SPOKES);
  ctx.strokeStyle = WHEEL_DARK;
  ctx.lineWidth = ts * 0.13;
  ctx.beginPath();
  ctx.arc(cx, cy + 1, r, 0, TWO_PI);
  ctx.stroke();
  ctx.lineWidth = ts * 0.06;
  ctx.lineCap = 'round';
  for (let spoke = 0; spoke < VALVE_SPOKES; spoke++) {
    const a = turn + (spoke / VALVE_SPOKES) * TWO_PI;
    ctx.strokeStyle = WHEEL_DARK;
    ctx.beginPath();
    ctx.moveTo(cx, cy + 1);
    ctx.lineTo(cx + Math.cos(a) * r, cy + 1 + Math.sin(a) * r);
    ctx.stroke();
    ctx.strokeStyle = WHEEL_MID;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r);
    ctx.stroke();
  }
  ctx.strokeStyle = WHEEL_MID;
  ctx.lineWidth = ts * 0.1;
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, TWO_PI);
  ctx.stroke();
  ctx.strokeStyle = WHEEL_LIGHT;
  ctx.lineWidth = ts * 0.04;
  ctx.beginPath();
  ctx.arc(cx, cy, r + ts * 0.01, Math.PI * 1.0, Math.PI * 1.6);
  ctx.stroke();
  ctx.fillStyle = STEEL_DARK;
  fillEllipse(ctx, cx, cy, ts * 0.07, ts * 0.07);
  ctx.fillStyle = STEEL_SPEC;
  ctx.fillRect(Math.round(cx - 1), Math.round(cy - 1), 1, 1);
}

// ── Outflow chute ────────────────────────────────────────────────────────────

/**
 * Chute geometry from the outfall tile's top-left: the pipe arrives at
 * {@link OUTFLOW_PIPE_Y_TILES} from the pump's riser two tiles to the west, and
 * a square trough mouth tips the flood down into the outfall tile.
 */
const CHUTE = {
  elbowX: PUMP.riserX - PUMP_OUTFALL_OFFSET_TILES,
  pipeWidth: PUMP.riserWidth,
  mouthLeft: 0.12,
  mouthRight: 0.68,
  mouthTop: -0.12,
  mouthBottom: 0.16,
  lipDrop: 0.1,
  bracketX: -0.9,
  /** Where the falling water lands, and where its churn is centred. */
  landX: 0.52,
  landY: 0.72,
  streamTopHalfW: 0.18,
  streamBottomHalfW: 0.26,
  streamStreaks: 5,
  churnRx: 0.52,
  churnRy: 0.2,
  rippleRings: 2,
  rippleMaxRx: 1.05,
  sprayCount: 10,
  sprayRise: 0.45,
  spraySpread: 0.55,
  dripX: 0.55,
} as const;

/**
 * The outflow chute, drawn from the tile its water lands in, with the pump
 * {@link PUMP_OUTFALL_OFFSET_TILES} tiles to the west (mirror it for a pump to
 * the east). Pouring, a thick silty stream falls into a churn of foam; shut
 * off, the trough only drips.
 */
export function paintChute(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  pouring: boolean,
  frame: number,
) {
  const X = (f: number) => ox + ts * f;
  const pipeY = oy + ts * OUTFLOW_PIPE_Y_TILES;
  const mouthY = (f: number) => pipeY + ts * f;

  if (pouring) paintOutfallChurn(ctx, ox, oy, ts, frame);
  else paintOutfallRipple(ctx, ox, oy, ts, frame);

  // Elbow over the riser's top, then the run east to the trough.
  ctx.fillStyle = STEEL_EDGE;
  fillEllipse(
    ctx,
    X(CHUTE.elbowX),
    pipeY,
    ts * CHUTE.pipeWidth * 0.75 + 1,
    ts * CHUTE.pipeWidth * 0.75 + 1,
  );
  pipe(ctx, X(CHUTE.elbowX), pipeY, X(CHUTE.mouthLeft), pipeY, ts * CHUTE.pipeWidth);
  ctx.fillStyle = STEEL_MID;
  fillEllipse(
    ctx,
    X(CHUTE.elbowX),
    pipeY,
    ts * CHUTE.pipeWidth * 0.75,
    ts * CHUTE.pipeWidth * 0.75,
  );
  ctx.fillStyle = STEEL_LIGHT;
  fillEllipse(
    ctx,
    X(CHUTE.elbowX) - 1,
    pipeY - 1,
    ts * CHUTE.pipeWidth * 0.35,
    ts * CHUTE.pipeWidth * 0.3,
  );
  flange(
    ctx,
    X(CHUTE.mouthLeft) - ts * 0.05,
    pipeY,
    ts * PUMP.flangeAcross,
    ts * PUMP.flangeThick,
    false,
  );
  // A wall bracket the pipe hangs from.
  ctx.fillStyle = STEEL_DARK;
  ctx.fillRect(X(CHUTE.bracketX) - 1, pipeY - ts * 0.32, 2, ts * 0.22);

  // The trough: an open steel box whose far lip is lower, so it reads as tipping toward the outfall.
  ctx.fillStyle = STEEL_EDGE;
  ctx.fillRect(
    X(CHUTE.mouthLeft) - 1,
    mouthY(CHUTE.mouthTop) - 1,
    ts * (CHUTE.mouthRight - CHUTE.mouthLeft) + 2,
    ts * (CHUTE.mouthBottom - CHUTE.mouthTop) + 2,
  );
  const troughGrad = ctx.createLinearGradient(
    0,
    mouthY(CHUTE.mouthTop),
    0,
    mouthY(CHUTE.mouthBottom),
  );
  troughGrad.addColorStop(0, STEEL_LIGHT);
  troughGrad.addColorStop(1, STEEL_DARK);
  ctx.fillStyle = troughGrad;
  ctx.fillRect(
    X(CHUTE.mouthLeft),
    mouthY(CHUTE.mouthTop),
    ts * (CHUTE.mouthRight - CHUTE.mouthLeft),
    ts * (CHUTE.mouthBottom - CHUTE.mouthTop),
  );
  ctx.fillStyle = STEEL_EDGE;
  ctx.fillRect(
    X(CHUTE.mouthLeft + 0.06),
    mouthY(CHUTE.mouthTop) + 1,
    ts * (CHUTE.mouthRight - CHUTE.mouthLeft - 0.12),
    ts * 0.06,
  );
  ctx.fillStyle = RUST_STREAK;
  ctx.fillRect(X(CHUTE.mouthRight - 0.18), mouthY(CHUTE.mouthBottom) - 1, ts * 0.12, ts * 0.2);

  if (pouring) paintStream(ctx, ox, oy, ts, mouthY(CHUTE.mouthBottom - CHUTE.lipDrop), frame);
  else paintChuteDrip(ctx, ox, oy, ts, mouthY(CHUTE.mouthBottom), frame);
}

function paintStream(ctx: Ctx, ox: number, oy: number, ts: number, lipY: number, frame: number) {
  const X = (f: number) => ox + ts * f;
  const landY = oy + ts * CHUTE.landY;
  const cx = X(CHUTE.landX);
  const topHalf = ts * CHUTE.streamTopHalfW;
  const bottomHalf = ts * CHUTE.streamBottomHalfW;
  ctx.fillStyle = STREAM_BODY;
  ctx.beginPath();
  ctx.moveTo(cx - topHalf, lipY);
  ctx.lineTo(cx + topHalf, lipY);
  ctx.quadraticCurveTo(cx + topHalf * 1.1, (lipY + landY) / 2, cx + bottomHalf, landY);
  ctx.lineTo(cx - bottomHalf, landY);
  ctx.quadraticCurveTo(cx - topHalf * 0.9, (lipY + landY) / 2, cx - topHalf, lipY);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = STREAM_CORE;
  ctx.fillRect(cx - topHalf * 0.55, lipY, topHalf * 0.6, landY - lipY);

  // Streaks fall down the stream a quarter of their spacing a frame, so the four frames loop.
  const fall = landY - lipY;
  const spacing = fall / 2;
  ctx.fillStyle = STREAM_STREAK;
  const rng = mulberry32(CHUTE_SEED);
  for (let s = 0; s < CHUTE.streamStreaks; s++) {
    const across = (rng() * 2 - 1) * topHalf * 0.8;
    const length = ts * (0.18 + rng() * 0.2);
    const offset = rng() * spacing;
    for (let k = -1; k < 3; k++) {
      const y = lipY + offset + k * spacing + (frame / CHUTE_POUR_FRAMES) * spacing;
      const y0 = Math.max(lipY, y);
      const y1 = Math.min(landY, y + length);
      if (y1 <= y0) continue;
      ctx.fillRect(Math.round(cx + across), y0, 1, y1 - y0);
    }
  }
  ctx.fillStyle = STREAM_STREAK;
  ctx.fillRect(cx - topHalf, lipY, topHalf * 2, 1);
}

function paintOutfallChurn(ctx: Ctx, ox: number, oy: number, ts: number, frame: number) {
  const cx = ox + ts * CHUTE.landX;
  const cy = oy + ts * CHUTE.landY;
  const phase = frame / CHUTE_POUR_FRAMES;
  ctx.fillStyle = MURK;
  fillEllipse(ctx, cx, cy, ts * CHUTE.churnRx * 1.25, ts * CHUTE.churnRy * 1.3);
  ctx.strokeStyle = RIPPLE;
  ctx.lineWidth = 1;
  for (let ring = 0; ring < CHUTE.rippleRings; ring++) {
    const life = (phase + ring / CHUTE.rippleRings) % 1;
    const rx = lerp(ts * CHUTE.churnRx, ts * CHUTE.rippleMaxRx, life);
    ctx.globalAlpha = 1 - life;
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, rx * (CHUTE.churnRy / CHUTE.churnRx), 0, 0, TWO_PI);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = FOAM_SOFT;
  fillEllipse(ctx, cx, cy, ts * CHUTE.churnRx, ts * CHUTE.churnRy);
  const rng = mulberry32(CHUTE_SEED + frame);
  ctx.fillStyle = FOAM;
  const blobs = 6;
  for (let i = 0; i < blobs; i++) {
    const a = rng() * TWO_PI;
    const d = rng() * 0.7;
    fillEllipse(
      ctx,
      cx + Math.cos(a) * d * ts * CHUTE.churnRx,
      cy + Math.sin(a) * d * ts * CHUTE.churnRy,
      ts * (0.06 + rng() * 0.07),
      ts * (0.03 + rng() * 0.03),
    );
  }
  spray(
    ctx,
    mulberry32(CHUTE_SEED + 7),
    cx,
    cy - ts * 0.05,
    ts * CHUTE.spraySpread,
    ts * CHUTE.sprayRise,
    CHUTE.sprayCount,
    phase,
    ts,
  );
}

function paintOutfallRipple(ctx: Ctx, ox: number, oy: number, ts: number, frame: number) {
  const cx = ox + ts * CHUTE.dripX;
  const cy = oy + ts * CHUTE.landY;
  const life = frame / CHUTE_DRIP_FRAMES;
  ctx.strokeStyle = RIPPLE;
  ctx.lineWidth = 1;
  ctx.globalAlpha = 1 - life;
  const rx = ts * lerp(0.05, 0.3, life);
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, rx * HALF, 0, 0, TWO_PI);
  ctx.stroke();
  ctx.globalAlpha = 1;
}

function paintChuteDrip(ctx: Ctx, ox: number, oy: number, ts: number, lipY: number, frame: number) {
  const cx = ox + ts * CHUTE.dripX;
  const landY = oy + ts * CHUTE.landY;
  const y = lerp(lipY, landY, frame / CHUTE_DRIP_FRAMES);
  ctx.fillStyle = DRIP;
  fillEllipse(ctx, cx, lipY + 1, ts * 0.03, ts * 0.04);
  fillEllipse(ctx, cx, y, ts * 0.025, ts * 0.05);
}
const CHUTE_SEED = 0x51de;

// ── Barrels ──────────────────────────────────────────────────────────────────

/**
 * The cellar's own barrels, so a barrel that topples into the flood is the
 * same barrel the crawler has been smashing all floor: the stack, the floating
 * and settled looks and the breakable rows are all painted over
 * `destructiblePropArt`'s upright and fallen barrel at its own tile scale.
 */
const BARREL_SEED_TERM = 0;
/** Pixels, at the barrel art's own 64 px tile, between one stacked barrel's base and the next's. */
export const BARREL_STACK_STEP_PX = 40;
export const BARREL_STACK_HEIGHTS = [3, 4] as const;
export type BarrelStackHeight = (typeof BARREL_STACK_HEIGHTS)[number];

/** An upright barrel: the tumbling sprite a toppling stack rotates. */
export function paintUprightBarrel(ctx: Ctx, ox: number, oy: number, ts: number) {
  drawProp(ctx, 'barrel', 'idle', 0, ox, oy, ts, BARREL_SEED_TERM);
}

/**
 * Barrels stood one on another on their seat. Each sits a little off the one
 * below, so the column reads as stacked by hand and ready to come down.
 */
export function paintBarrelStack(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  height: BarrelStackHeight,
) {
  for (let level = 0; level < height; level++) {
    const lean = STACK_LEANS[level] ?? 0;
    drawProp(
      ctx,
      'barrel',
      'idle',
      level % PROP_VARIANT_COUNT,
      ox + lean,
      oy - level * BARREL_STACK_STEP_PX,
      ts,
      BARREL_SEED_TERM,
    );
  }
}
const STACK_LEANS = [0, 2, -1, 3] as const;

/** Barrel-side geometry at its own 64 px tile: where its body sits for the waterline. */
const FLOAT = {
  waterlineFraction: 0.66,
  bobPx: 1.5,
  ringRx: 0.42,
  ringRy: 0.12,
  ringCx: 0.5,
} as const;

/**
 * A fallen barrel afloat: its lower third under the murky surface, the surface
 * line round it bobbing a pixel or two across the frames.
 */
export function paintFloatingBarrel(ctx: Ctx, ox: number, oy: number, ts: number, frame: number) {
  const bob = Math.sin((frame / BARREL_FLOAT_FRAMES) * TWO_PI) * FLOAT.bobPx;
  const waterY = oy + ts * FLOAT.waterlineFraction;
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox - ts, oy - ts, ts * 3, waterY - (oy - ts));
  ctx.clip();
  drawProp(
    ctx,
    'barrel_side',
    'idle',
    frame % PROP_VARIANT_COUNT,
    ox,
    oy + bob,
    ts,
    BARREL_SEED_TERM,
  );
  ctx.restore();
  ctx.save();
  ctx.beginPath();
  ctx.rect(ox - ts, waterY, ts * 3, ts * 2);
  ctx.clip();
  ctx.globalAlpha = SUBMERGED_ALPHA;
  drawProp(
    ctx,
    'barrel_side',
    'idle',
    frame % PROP_VARIANT_COUNT,
    ox,
    oy + bob,
    ts,
    BARREL_SEED_TERM,
  );
  ctx.restore();
  ctx.strokeStyle = RIPPLE;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.ellipse(ox + ts * FLOAT.ringCx, waterY, ts * FLOAT.ringRx, ts * FLOAT.ringRy, 0, 0, Math.PI);
  ctx.stroke();
  ctx.fillStyle = FOAM_SOFT;
  ctx.fillRect(
    ox + ts * (FLOAT.ringCx - FLOAT.ringRx * 0.8),
    waterY - 1,
    ts * FLOAT.ringRx * 1.6,
    2,
  );
}
const SUBMERGED_ALPHA = 0.28;

/**
 * A fallen barrel come to rest on the drained floor: silt to its waterline,
 * a dark wet band under it, and a tide mark where it floated.
 */
export function paintSettledBarrel(ctx: Ctx, ox: number, oy: number, ts: number, variant: number) {
  drawProp(ctx, 'barrel_side', 'idle', variant, ox, oy, ts, BARREL_SEED_TERM);
  paintSiltWash(ctx, ox, oy, ts);
}

/** The breakable rows of a settled barrel: the fallen barrel's own, under the same silt. */
export function paintSettledBarrelBreak(
  ctx: Ctx,
  ox: number,
  oy: number,
  ts: number,
  state: 'damaged' | 'shatter' | 'remains',
  frame: number,
) {
  drawProp(ctx, 'barrel_side', state, frame, ox, oy, ts, BARREL_SEED_TERM);
  if (state === 'damaged') paintSiltWash(ctx, ox, oy, ts);
}

function paintSiltWash(ctx: Ctx, ox: number, oy: number, ts: number) {
  const waterY = oy + ts * FLOAT.waterlineFraction;
  ctx.save();
  ctx.globalCompositeOperation = 'source-atop';
  const grad = ctx.createLinearGradient(0, waterY - ts * 0.04, 0, oy + ts);
  grad.addColorStop(0, 'rgba(110, 100, 78, 0)');
  grad.addColorStop(0.15, SILT_FILM);
  grad.addColorStop(1, SILT_DARK);
  ctx.fillStyle = grad;
  ctx.fillRect(ox - ts, waterY - ts * 0.04, ts * 3, ts);
  ctx.fillStyle = TIDE_MARK;
  ctx.fillRect(ox - ts, Math.round(waterY), ts * 3, 1);
  ctx.restore();
}

// ── Floor drain ──────────────────────────────────────────────────────────────

const DRAIN = {
  collarHalf: 0.38,
  grateR: 0.27,
  slots: 5,
  stainR: 0.6,
  swirlArms: 3,
  swirlTurns: 1.1,
} as const;

/** A cast-iron floor drain set in a square concrete collar, with the grime that runs to it. */
export function paintDrainGrate(ctx: Ctx, ox: number, oy: number, ts: number) {
  const cx = ox + ts * HALF;
  const cy = oy + ts * HALF;
  const stain = ctx.createRadialGradient(
    cx,
    cy,
    ts * DRAIN.collarHalf * 0.6,
    cx,
    cy,
    ts * DRAIN.stainR,
  );
  stain.addColorStop(0, DRAIN_STAIN);
  stain.addColorStop(1, 'rgba(40, 36, 26, 0)');
  ctx.fillStyle = stain;
  ctx.fillRect(ox, oy, ts, ts);
  const half = ts * DRAIN.collarHalf;
  ctx.fillStyle = CONCRETE_COLLAR_DARK;
  ctx.fillRect(cx - half - 1, cy - half - 1, half * 2 + 2, half * 2 + 2);
  ctx.fillStyle = CONCRETE_COLLAR;
  ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
  ctx.fillStyle = CONCRETE_COLLAR_LIGHT;
  ctx.fillRect(cx - half, cy - half, half * 2, 1);
  ctx.fillRect(cx - half, cy - half, 1, half * 2);
  const r = ts * DRAIN.grateR;
  ctx.fillStyle = IRON_DARK;
  fillEllipse(ctx, cx, cy, r + 1, r + 1);
  ctx.fillStyle = IRON_MID;
  fillEllipse(ctx, cx, cy, r, r);
  ctx.fillStyle = IRON_DARK;
  const slotW = Math.max(1, Math.round(ts * 0.05));
  for (let s = 0; s < DRAIN.slots; s++) {
    const sy = cy - r * 0.7 + (s / (DRAIN.slots - 1)) * r * 1.4;
    const halfChord = Math.sqrt(Math.max(0, r * r * 0.75 - (sy - cy) ** 2));
    ctx.fillRect(Math.round(cx - halfChord), Math.round(sy), Math.round(halfChord * 2), slotW);
  }
  ctx.strokeStyle = IRON_LIGHT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(cx, cy, r - HALF, Math.PI * 1.05, Math.PI * 1.55);
  ctx.stroke();
}

/** The whirlpool over a drain while the room empties, turning a quarter of an arm a frame. */
export function paintDrainSwirl(ctx: Ctx, ox: number, oy: number, ts: number, frame: number) {
  const cx = ox + ts * HALF;
  const cy = oy + ts * HALF;
  const spin = (frame / DRAIN_SWIRL_FRAMES) * (TWO_PI / DRAIN.swirlArms);
  ctx.fillStyle = SWIRL_HOLE;
  fillEllipse(ctx, cx, cy, ts * 0.12, ts * 0.08);
  ctx.strokeStyle = SWIRL_LINE;
  ctx.lineWidth = 1;
  const steps = 14;
  for (let arm = 0; arm < DRAIN.swirlArms; arm++) {
    ctx.beginPath();
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const a = spin + (arm / DRAIN.swirlArms) * TWO_PI + t * DRAIN.swirlTurns * TWO_PI;
      const radius = ts * lerp(0.1, 0.46, t);
      const x = cx + Math.cos(a) * radius;
      const y = cy + Math.sin(a) * radius * 0.6;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
}
