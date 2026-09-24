/**
 * Painting for the Grotesque Spider's lab: the benches and their glassware, the
 * terminal the hack is run from, the specimen shelving, the egg sac she hatches
 * from, the cocooned staff, the ceiling light banks, regrowing web, and what is
 * left of the scientist.
 *
 * Everything is drawn at a 64px logical tile ({@link LAB_TILE_SCALE}) and
 * downscaled by the runtime, which is what lets a flask's neck and a beaker's
 * meniscus survive at the game's 32px tiles.
 *
 * Geometry convention: every painter takes the anchor tile's top-left corner.
 * The anchor tile is the prop's footprint — the floor it stands on and blocks —
 * and everything above it is height the prop rises into the tiles behind it.
 * A prop never inks past the sides of its footprint: art hanging over a
 * neighbouring tile reads as a surface a crawler could stand on.
 */

type Ctx = CanvasRenderingContext2D;

/** Source pixels per game tile the painters below are authored against. */
export const LAB_TILE_SCALE = 64;

const TWO_PI = Math.PI * 2;
const HALF = 0.5;

// ── Deterministic noise ─────────────────────────────────────────────────────
// Seeded, never Math.random: the sheet the game paints and the one a review
// bake writes have to be the same picture.

const LCG_MULTIPLIER = 1664525;
const LCG_INCREMENT = 1013904223;
const LCG_RANGE = 0x1_0000_0000;

function makeRng(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (Math.imul(state, LCG_MULTIPLIER) + LCG_INCREMENT) >>> 0;
    return state / LCG_RANGE;
  };
}

// ── Palette ─────────────────────────────────────────────────────────────────

const RESIN_TOP = '#23282c';
const RESIN_TOP_LIGHT = '#3a4146';
const RESIN_EDGE = '#6a737a';
const CABINET = '#8b9597';
const CABINET_DARK = '#667073';
const CABINET_SEAM = '#4a5255';
const CABINET_HANDLE = '#d3dadc';
const KICK_PLATE = '#1f2325';
const CONTACT_SHADOW = 'rgba(0,0,0,0.35)';
const GLASS_FILL = 'rgba(205,232,238,0.32)';
const GLASS_EDGE = 'rgba(225,244,248,0.9)';
const GLASS_GLINT = 'rgba(255,255,255,0.85)';
const LIQUIDS = ['#7fe36a', '#e0a33a', '#d04ec0', '#4fd0e0', '#9b1d24'] as const;
const PAPER = '#e8e4d6';
const PAPER_INK = '#7a7466';
const STEEL = '#a9b2b5';
const STEEL_DARK = '#5d6568';
const RUBBER = '#1b1d1f';
const SHARD = 'rgba(220,245,250,0.9)';
const SPILL_ALPHA = 0.55;

// ── Shared helpers ──────────────────────────────────────────────────────────

function roundRectPath(ctx: Ctx, x: number, y: number, w: number, h: number, r: number): void {
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

function verticalGradient(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  top: string,
  bottom: string,
): void {
  const grad = ctx.createLinearGradient(x, y, x, y + h);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(x, y, w, h);
}

function contactShadow(ctx: Ctx, cx: number, cy: number, rx: number, ry: number): void {
  ctx.fillStyle = CONTACT_SHADOW;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  ctx.fill();
}

// ── Glassware ───────────────────────────────────────────────────────────────
// Every piece is drawn standing on (cx, baseY) and sized by `h`, its height.

const FLASK_BODY_WIDTH = 0.8;
const FLASK_NECK_WIDTH = 0.22;
const FLASK_NECK_SHARE = 0.38;
const FLASK_FILL_SHARE = 0.45;

function drawErlenmeyer(ctx: Ctx, cx: number, baseY: number, h: number, liquid: string): void {
  const halfBase = (h * FLASK_BODY_WIDTH) / 2;
  const halfNeck = (h * FLASK_NECK_WIDTH) / 2;
  const shoulderY = baseY - h * (1 - FLASK_NECK_SHARE);
  const topY = baseY - h;
  contactShadow(ctx, cx, baseY, halfBase, h * CONTACT_SHADOW_DEPTH);
  const outline = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx - halfNeck, topY);
    ctx.lineTo(cx - halfNeck, shoulderY);
    ctx.lineTo(cx - halfBase, baseY);
    ctx.lineTo(cx + halfBase, baseY);
    ctx.lineTo(cx + halfNeck, shoulderY);
    ctx.lineTo(cx + halfNeck, topY);
    ctx.closePath();
  };
  outline();
  ctx.fillStyle = GLASS_FILL;
  ctx.fill();
  const fillY = baseY - h * FLASK_FILL_SHARE;
  const fillHalf = halfBase - (halfBase - halfNeck) * (FLASK_FILL_SHARE / (1 - FLASK_NECK_SHARE));
  ctx.fillStyle = liquid;
  ctx.beginPath();
  ctx.moveTo(cx - fillHalf, fillY);
  ctx.lineTo(cx - halfBase, baseY);
  ctx.lineTo(cx + halfBase, baseY);
  ctx.lineTo(cx + fillHalf, fillY);
  ctx.closePath();
  ctx.fill();
  outline();
  ctx.strokeStyle = GLASS_EDGE;
  ctx.lineWidth = GLASS_LINE_WIDTH;
  ctx.stroke();
  ctx.strokeStyle = GLASS_GLINT;
  ctx.beginPath();
  ctx.moveTo(cx - halfNeck * HALF, topY + h * GLINT_TOP_SHARE);
  ctx.lineTo(cx - halfBase * GLINT_SPREAD, baseY - h * GLINT_BOTTOM_SHARE);
  ctx.stroke();
}
const CONTACT_SHADOW_DEPTH = 0.12;
const GLASS_LINE_WIDTH = 1.4;
const GLINT_TOP_SHARE = 0.4;
const GLINT_BOTTOM_SHARE = 0.15;
const GLINT_SPREAD = 0.55;

const BEAKER_WIDTH = 0.72;
const BEAKER_FILL_SHARE = 0.55;
const BEAKER_TICKS = 3;

function drawBeaker(ctx: Ctx, cx: number, baseY: number, h: number, liquid: string): void {
  const w = h * BEAKER_WIDTH;
  const x = cx - w / 2;
  contactShadow(ctx, cx, baseY, w * HALF, h * CONTACT_SHADOW_DEPTH);
  ctx.fillStyle = GLASS_FILL;
  ctx.fillRect(x, baseY - h, w, h);
  ctx.fillStyle = liquid;
  ctx.fillRect(x, baseY - h * BEAKER_FILL_SHARE, w, h * BEAKER_FILL_SHARE);
  ctx.strokeStyle = GLASS_EDGE;
  ctx.lineWidth = GLASS_LINE_WIDTH;
  ctx.strokeRect(x, baseY - h, w, h);
  ctx.beginPath();
  for (let i = 1; i <= BEAKER_TICKS; i++) {
    const tickY = baseY - (h * i) / (BEAKER_TICKS + 1);
    ctx.moveTo(x + w * BEAKER_TICK_INSET, tickY);
    ctx.lineTo(x + w * BEAKER_TICK_REACH, tickY);
  }
  ctx.stroke();
  ctx.strokeStyle = GLASS_GLINT;
  ctx.beginPath();
  ctx.moveTo(x + w * BEAKER_GLINT_X, baseY - h * BEAKER_GLINT_TOP);
  ctx.lineTo(x + w * BEAKER_GLINT_X, baseY - h * BEAKER_GLINT_BOTTOM);
  ctx.stroke();
}
const BEAKER_TICK_INSET = 0.55;
const BEAKER_TICK_REACH = 0.85;
const BEAKER_GLINT_X = 0.2;
const BEAKER_GLINT_TOP = 0.88;
const BEAKER_GLINT_BOTTOM = 0.2;

const ROUND_FLASK_BULB = 0.36;
const ROUND_FLASK_NECK = 0.1;
const STAND_WIDTH = 0.8;

function drawRoundFlaskOnStand(
  ctx: Ctx,
  cx: number,
  baseY: number,
  h: number,
  liquid: string,
): void {
  const bulbR = h * ROUND_FLASK_BULB;
  const bulbY = baseY - h * ROUND_FLASK_BULB_HEIGHT;
  contactShadow(ctx, cx, baseY, h * STAND_WIDTH * HALF, h * CONTACT_SHADOW_DEPTH);
  // Tripod legs under the bulb, the burner's blue flame between them.
  ctx.strokeStyle = STEEL_DARK;
  ctx.lineWidth = STAND_LINE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(cx - h * STAND_WIDTH * HALF, baseY);
  ctx.lineTo(cx - bulbR * HALF, bulbY + bulbR * STAND_RING_DROP);
  ctx.moveTo(cx + h * STAND_WIDTH * HALF, baseY);
  ctx.lineTo(cx + bulbR * HALF, bulbY + bulbR * STAND_RING_DROP);
  ctx.moveTo(cx - bulbR, bulbY + bulbR * STAND_RING_DROP);
  ctx.lineTo(cx + bulbR, bulbY + bulbR * STAND_RING_DROP);
  ctx.stroke();
  ctx.fillStyle = BURNER_FLAME;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    baseY - h * BURNER_FLAME_HEIGHT,
    h * BURNER_FLAME_W,
    h * BURNER_FLAME_H,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.fillStyle = GLASS_FILL;
  ctx.beginPath();
  ctx.arc(cx, bulbY, bulbR, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = liquid;
  ctx.beginPath();
  ctx.arc(cx, bulbY, bulbR, 0, Math.PI);
  ctx.fill();
  ctx.fillStyle = GLASS_FILL;
  ctx.fillRect(
    cx - h * ROUND_FLASK_NECK * HALF,
    baseY - h,
    h * ROUND_FLASK_NECK,
    h - bulbR - (baseY - bulbY),
  );
  ctx.strokeStyle = GLASS_EDGE;
  ctx.lineWidth = GLASS_LINE_WIDTH;
  ctx.beginPath();
  ctx.arc(cx, bulbY, bulbR, 0, TWO_PI);
  ctx.stroke();
  ctx.strokeRect(
    cx - h * ROUND_FLASK_NECK * HALF,
    baseY - h,
    h * ROUND_FLASK_NECK,
    h - bulbR - (baseY - bulbY),
  );
  ctx.fillStyle = GLASS_GLINT;
  ctx.beginPath();
  ctx.arc(cx - bulbR * HALF, bulbY - bulbR * HALF, bulbR * GLINT_DOT, 0, TWO_PI);
  ctx.fill();
}
const ROUND_FLASK_BULB_HEIGHT = 0.52;
const STAND_LINE_WIDTH = 1.6;
const STAND_RING_DROP = 0.7;
const BURNER_FLAME = 'rgba(90,150,255,0.8)';
const BURNER_FLAME_HEIGHT = 0.1;
const BURNER_FLAME_W = 0.05;
const BURNER_FLAME_H = 0.09;
const GLINT_DOT = 0.22;

const RACK_TUBES = 5;
const RACK_WIDTH = 1.1;
const RACK_HEIGHT = 0.28;
const TUBE_HEIGHT = 0.95;
const TUBE_WIDTH = 0.12;

function drawTestTubeRack(ctx: Ctx, cx: number, baseY: number, h: number, rng: () => number): void {
  const w = h * RACK_WIDTH;
  const x = cx - w / 2;
  contactShadow(ctx, cx, baseY, w * HALF, h * CONTACT_SHADOW_DEPTH);
  const pitch = w / RACK_TUBES;
  for (let i = 0; i < RACK_TUBES; i++) {
    const tx = x + pitch * (i + HALF);
    const tubeH = h * TUBE_HEIGHT * (1 - rng() * TUBE_HEIGHT_JITTER);
    const tubeW = h * TUBE_WIDTH;
    const liquid = LIQUIDS[Math.floor(rng() * LIQUIDS.length)] ?? LIQUIDS[0];
    ctx.fillStyle = GLASS_FILL;
    ctx.fillRect(tx - tubeW / 2, baseY - tubeH, tubeW, tubeH);
    ctx.fillStyle = liquid;
    ctx.fillRect(tx - tubeW / 2, baseY - tubeH * TUBE_FILL_SHARE, tubeW, tubeH * TUBE_FILL_SHARE);
    ctx.strokeStyle = GLASS_EDGE;
    ctx.lineWidth = 1;
    ctx.strokeRect(tx - tubeW / 2, baseY - tubeH, tubeW, tubeH);
  }
  ctx.fillStyle = STEEL;
  ctx.fillRect(x, baseY - h * RACK_HEIGHT, w, h * RACK_HEIGHT * HALF);
  ctx.fillStyle = STEEL_DARK;
  ctx.fillRect(x, baseY - h * RACK_HEIGHT * HALF, w, h * RACK_HEIGHT * HALF);
}
const TUBE_HEIGHT_JITTER = 0.25;
const TUBE_FILL_SHARE = 0.5;

const SCOPE_BASE_W = 0.62;
const SCOPE_ARM_W = 0.16;

function drawMicroscope(ctx: Ctx, cx: number, baseY: number, h: number): void {
  contactShadow(ctx, cx, baseY, h * SCOPE_BASE_W * HALF, h * CONTACT_SHADOW_DEPTH);
  ctx.fillStyle = RUBBER;
  roundRectPath(
    ctx,
    cx - h * SCOPE_BASE_W * HALF,
    baseY - h * SCOPE_FOOT_H,
    h * SCOPE_BASE_W,
    h * SCOPE_FOOT_H,
    h * SCOPE_ROUND,
  );
  ctx.fill();
  // Curved arm.
  ctx.strokeStyle = CABINET_HANDLE;
  ctx.lineWidth = h * SCOPE_ARM_W;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(cx + h * SCOPE_ARM_X, baseY - h * SCOPE_FOOT_H);
  ctx.quadraticCurveTo(
    cx + h * SCOPE_ARM_BULGE,
    baseY - h * SCOPE_ARM_MID,
    cx,
    baseY - h * SCOPE_ARM_TOP,
  );
  ctx.stroke();
  // Stage and the angled tube with its eyepiece.
  ctx.fillStyle = STEEL_DARK;
  ctx.fillRect(
    cx - h * SCOPE_STAGE_W * HALF,
    baseY - h * SCOPE_STAGE_Y,
    h * SCOPE_STAGE_W,
    h * SCOPE_STAGE_H,
  );
  ctx.strokeStyle = RUBBER;
  ctx.lineWidth = h * SCOPE_TUBE_W;
  ctx.beginPath();
  ctx.moveTo(cx - h * SCOPE_TUBE_LEAN, baseY - h * SCOPE_OBJECTIVE_Y);
  ctx.lineTo(cx - h * SCOPE_TUBE_TOP_X, baseY - h);
  ctx.stroke();
  ctx.lineCap = 'butt';
  ctx.fillStyle = GLASS_GLINT;
  ctx.fillRect(
    cx - h * SCOPE_TUBE_TOP_X - h * SCOPE_TUBE_W * HALF,
    baseY - h,
    h * SCOPE_TUBE_W,
    h * SCOPE_EYE_H,
  );
}
const SCOPE_FOOT_H = 0.12;
const SCOPE_ROUND = 0.04;
const SCOPE_ARM_X = 0.14;
const SCOPE_ARM_BULGE = 0.34;
const SCOPE_ARM_MID = 0.55;
const SCOPE_ARM_TOP = 0.86;
const SCOPE_STAGE_W = 0.46;
const SCOPE_STAGE_Y = 0.42;
const SCOPE_STAGE_H = 0.06;
const SCOPE_TUBE_W = 0.14;
const SCOPE_TUBE_LEAN = 0.02;
const SCOPE_OBJECTIVE_Y = 0.48;
const SCOPE_TUBE_TOP_X = 0.18;
const SCOPE_EYE_H = 0.06;

const JAR_WIDTH = 0.66;
const JAR_LID_H = 0.12;

/** A specimen jar: murky preserving fluid with something curled up in it. */
function drawSpecimenJar(
  ctx: Ctx,
  cx: number,
  baseY: number,
  h: number,
  liquid: string,
  rng: () => number,
): void {
  const w = h * JAR_WIDTH;
  const x = cx - w / 2;
  contactShadow(ctx, cx, baseY, w * HALF, h * CONTACT_SHADOW_DEPTH);
  roundRectPath(ctx, x, baseY - h * (1 - JAR_LID_H), w, h * (1 - JAR_LID_H), w * JAR_ROUND);
  ctx.fillStyle = liquid;
  ctx.globalAlpha = JAR_FLUID_ALPHA;
  ctx.fill();
  ctx.globalAlpha = 1;
  // The specimen: a pale curled shape, a different one each time.
  ctx.fillStyle = SPECIMEN_FLESH;
  ctx.beginPath();
  const specimenY = baseY - h * SPECIMEN_Y;
  ctx.ellipse(
    cx + (rng() - HALF) * w * SPECIMEN_WANDER,
    specimenY,
    w * SPECIMEN_RX,
    h * SPECIMEN_RY,
    rng() * Math.PI,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.fillStyle = SPECIMEN_EYE;
  ctx.beginPath();
  ctx.arc(
    cx + (rng() - HALF) * w * SPECIMEN_WANDER,
    specimenY - h * SPECIMEN_EYE_RISE,
    w * SPECIMEN_EYE_R,
    0,
    TWO_PI,
  );
  ctx.fill();
  roundRectPath(ctx, x, baseY - h * (1 - JAR_LID_H), w, h * (1 - JAR_LID_H), w * JAR_ROUND);
  ctx.strokeStyle = GLASS_EDGE;
  ctx.lineWidth = GLASS_LINE_WIDTH;
  ctx.stroke();
  ctx.fillStyle = STEEL_DARK;
  ctx.fillRect(x - w * JAR_LID_LIP, baseY - h, w * (1 + JAR_LID_LIP * 2), h * JAR_LID_H);
  ctx.fillStyle = PAPER;
  ctx.fillRect(
    x + w * JAR_LABEL_INSET,
    baseY - h * JAR_LABEL_Y,
    w * (1 - JAR_LABEL_INSET * 2),
    h * JAR_LABEL_H,
  );
  ctx.strokeStyle = GLASS_GLINT;
  ctx.beginPath();
  ctx.moveTo(x + w * BEAKER_GLINT_X, baseY - h * JAR_GLINT_TOP);
  ctx.lineTo(x + w * BEAKER_GLINT_X, baseY - h * JAR_GLINT_BOTTOM);
  ctx.stroke();
}
const JAR_ROUND = 0.2;
const JAR_FLUID_ALPHA = 0.78;
const SPECIMEN_FLESH = '#d9b8a2';
const SPECIMEN_EYE = '#2a1a14';
const SPECIMEN_Y = 0.42;
const SPECIMEN_WANDER = 0.18;
const SPECIMEN_RX = 0.26;
const SPECIMEN_RY = 0.16;
const SPECIMEN_EYE_RISE = 0.05;
const SPECIMEN_EYE_R = 0.07;
const JAR_LID_LIP = 0.06;
const JAR_LABEL_INSET = 0.18;
const JAR_LABEL_Y = 0.3;
const JAR_LABEL_H = 0.14;
const JAR_GLINT_TOP = 0.78;
const JAR_GLINT_BOTTOM = 0.35;

const CLIPBOARD_W = 0.34;
const CLIPBOARD_H = 0.26;
const CLIPBOARD_LINES = 4;

/** Paperwork lying flat on the bench top, seen from above. */
function drawClipboard(ctx: Ctx, x: number, y: number, S: number, angle: number): void {
  const w = S * CLIPBOARD_W;
  const h = S * CLIPBOARD_H;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = CLIPBOARD_BACK;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = PAPER;
  ctx.fillRect(
    -w / 2 + CLIPBOARD_MARGIN,
    -h / 2 + CLIPBOARD_MARGIN,
    w - CLIPBOARD_MARGIN * 2,
    h - CLIPBOARD_MARGIN * 2,
  );
  ctx.strokeStyle = PAPER_INK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i <= CLIPBOARD_LINES; i++) {
    const lineY = -h / 2 + (h * i) / (CLIPBOARD_LINES + 1);
    ctx.moveTo(-w / 2 + CLIPBOARD_MARGIN * 2, lineY);
    ctx.lineTo(w / 2 - CLIPBOARD_MARGIN * 2, lineY);
  }
  ctx.stroke();
  ctx.fillStyle = STEEL;
  ctx.fillRect(
    -w * CLIP_W_SHARE,
    -h / 2 - CLIPBOARD_MARGIN,
    w * CLIP_W_SHARE * 2,
    CLIPBOARD_MARGIN * 2,
  );
  ctx.restore();
}
const CLIPBOARD_BACK = '#7a5a36';
const CLIPBOARD_MARGIN = 2;
const CLIP_W_SHARE = 0.18;

// ── Breakage ────────────────────────────────────────────────────────────────

const SHARD_COUNT = 9;
const SHARD_SIZE = 0.07;

/** Glass shards scattered over a patch, each a sliver catching the light. */
function drawShards(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  S: number,
  rng: () => number,
): void {
  ctx.fillStyle = SHARD;
  for (let i = 0; i < SHARD_COUNT; i++) {
    const sx = x + rng() * w;
    const sy = y + rng() * h;
    const size = S * SHARD_SIZE * (HALF + rng());
    const angle = rng() * TWO_PI;
    ctx.beginPath();
    ctx.moveTo(sx + Math.cos(angle) * size, sy + Math.sin(angle) * size);
    ctx.lineTo(
      sx + Math.cos(angle + SHARD_SPREAD) * size * SHARD_NARROW,
      sy + Math.sin(angle + SHARD_SPREAD) * size * SHARD_NARROW,
    );
    ctx.lineTo(
      sx + Math.cos(angle + Math.PI) * size * SHARD_TAIL,
      sy + Math.sin(angle + Math.PI) * size * SHARD_TAIL,
    );
    ctx.closePath();
    ctx.fill();
  }
}
const SHARD_SPREAD = 2.2;
const SHARD_NARROW = 0.5;
const SHARD_TAIL = 0.7;

/** A spilled pool with a drip running over the edge it reached. */
function drawSpill(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  color: string,
  dripToY: number | null,
): void {
  ctx.globalAlpha = SPILL_ALPHA;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  ctx.fill();
  if (dripToY !== null) {
    ctx.fillRect(cx + rx * SPILL_DRIP_X, cy, rx * SPILL_DRIP_W, dripToY - cy);
    ctx.beginPath();
    ctx.arc(
      cx + rx * SPILL_DRIP_X + (rx * SPILL_DRIP_W) / 2,
      dripToY,
      rx * SPILL_DRIP_W,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}
const SPILL_DRIP_X = 0.2;
const SPILL_DRIP_W = 0.18;

// ── Bench ───────────────────────────────────────────────────────────────────

/** Where a bench tile sits in its run, which decides which ends it closes. */
export type BenchSegment =
  'rowLeft' | 'rowMid' | 'rowRight' | 'rowSingle' | 'colTop' | 'colMid' | 'colBottom';

export const BENCH_SEGMENTS: readonly BenchSegment[] = [
  'rowLeft',
  'rowMid',
  'rowRight',
  'rowSingle',
  'colTop',
  'colMid',
  'colBottom',
];

/** A bench's working height, as a share of a tile: how far its top is lifted off its footprint. */
export const BENCH_HEIGHT_SHARE = 0.5;
/** How far the glassware on a bench may rise above the top, as a share of a tile. */
export const BENCH_HEADROOM_SHARE = 1;
const BENCH_END_INSET = 0.05;
const BENCH_CORNER = 0.08;
const BENCH_LIP = 0.06;
const BENCH_KICK = 0.1;
const BENCH_DOOR_INSET = 0.1;
const BENCH_HANDLE_W = 0.18;
const BENCH_HANDLE_H = 0.035;
const BENCH_COL_SIDE_INSET = 0.1;

interface SegmentShape {
  /** The top closes at the tile's left / right edge. */
  capLeft: boolean;
  capRight: boolean;
  /** The top starts at this tile's north edge (a column's first tile). */
  capTop: boolean;
  /** The front face shows under this tile (a row, or a column's last tile). */
  showsFront: boolean;
  /** A column runs north–south: its top is narrower, set in from both sides. */
  column: boolean;
}

function segmentShape(segment: BenchSegment): SegmentShape {
  switch (segment) {
    case 'rowLeft':
      return { capLeft: true, capRight: false, capTop: true, showsFront: true, column: false };
    case 'rowMid':
      return { capLeft: false, capRight: false, capTop: true, showsFront: true, column: false };
    case 'rowRight':
      return { capLeft: false, capRight: true, capTop: true, showsFront: true, column: false };
    case 'rowSingle':
      return { capLeft: true, capRight: true, capTop: true, showsFront: true, column: false };
    case 'colTop':
      return { capLeft: true, capRight: true, capTop: true, showsFront: false, column: true };
    case 'colMid':
      return { capLeft: true, capRight: true, capTop: false, showsFront: false, column: true };
    case 'colBottom':
      return { capLeft: true, capRight: true, capTop: false, showsFront: true, column: true };
  }
}

/**
 * One tile of a lab bench: a black resin top on steel cabinets, with whatever
 * the staff left on it — or, `broken`, what her slam left of that.
 */
export function drawLabBench(
  ctx: Ctx,
  ox: number,
  oy: number,
  S: number,
  segment: BenchSegment,
  variant: number,
  broken: boolean,
): void {
  const shape = segmentShape(segment);
  const lift = S * BENCH_HEIGHT_SHARE;
  const sideInset = shape.column ? S * BENCH_COL_SIDE_INSET : 0;
  const left = ox + (shape.capLeft ? S * BENCH_END_INSET : 0) + sideInset;
  const right = ox + S - (shape.capRight ? S * BENCH_END_INSET : 0) - sideInset;
  const topY = oy - lift + (shape.capTop ? S * BENCH_END_INSET : 0);
  const topBottom = oy + S - lift;
  const width = right - left;

  // Front face: cabinet doors over a kick plate.
  if (shape.showsFront) {
    verticalGradient(ctx, left, topBottom, width, lift, CABINET, CABINET_DARK);
    ctx.fillStyle = KICK_PLATE;
    ctx.fillRect(left, oy + S - S * BENCH_KICK, width, S * BENCH_KICK);
    ctx.strokeStyle = CABINET_SEAM;
    ctx.lineWidth = 1;
    const doorTop = topBottom + S * BENCH_LIP + S * BENCH_DOOR_INSET * HALF;
    const doorBottom = oy + S - S * BENCH_KICK - S * BENCH_DOOR_INSET * HALF;
    ctx.strokeRect(
      left + S * BENCH_DOOR_INSET * HALF,
      doorTop,
      width - S * BENCH_DOOR_INSET,
      doorBottom - doorTop,
    );
    ctx.fillStyle = CABINET_HANDLE;
    ctx.fillRect(
      left + width / 2 - (S * BENCH_HANDLE_W) / 2,
      doorTop + S * BENCH_DOOR_INSET * HALF,
      S * BENCH_HANDLE_W,
      S * BENCH_HANDLE_H,
    );
    if (shape.capLeft) {
      ctx.fillStyle = CABINET_SEAM;
      ctx.fillRect(left, topBottom, 1, lift);
    }
    if (shape.capRight) {
      ctx.fillStyle = CABINET_SEAM;
      ctx.fillRect(right - 1, topBottom, 1, lift);
    }
  }

  // Top.
  const corner = S * BENCH_CORNER;
  ctx.save();
  roundRectPath(
    ctx,
    left,
    topY,
    width,
    topBottom - topY + (shape.showsFront ? S * BENCH_LIP : corner),
    shape.capTop || shape.showsFront ? corner : 0,
  );
  ctx.clip();
  verticalGradient(
    ctx,
    left,
    topY,
    width,
    topBottom - topY + S * BENCH_LIP,
    RESIN_TOP_LIGHT,
    RESIN_TOP,
  );
  if (shape.showsFront) {
    ctx.fillStyle = RESIN_EDGE;
    ctx.fillRect(left, topBottom, width, S * BENCH_LIP);
  }
  ctx.restore();
  if (shape.column) {
    ctx.fillStyle = RESIN_EDGE;
    ctx.fillRect(left, topY, 1, topBottom - topY);
    ctx.fillRect(right - 1, topY, 1, topBottom - topY);
  }

  const rng = makeRng(BENCH_SEED + variant * BENCH_SEED_STRIDE + BENCH_SEGMENTS.indexOf(segment));
  const surfaceTop = topY + S * ITEM_MARGIN;
  const surfaceBottom = topBottom - S * ITEM_MARGIN;
  if (broken) {
    drawBrokenBenchTop(
      ctx,
      left,
      surfaceTop,
      width,
      surfaceBottom - surfaceTop,
      S,
      rng,
      shape.showsFront ? oy + S - S * BENCH_KICK : null,
    );
    if (shape.showsFront)
      drawShards(ctx, left, oy + S - S * FLOOR_SHARD_BAND, width, S * FLOOR_SHARD_BAND, S, rng);
    return;
  }
  drawBenchItems(ctx, left, surfaceTop, width, surfaceBottom - surfaceTop, S, variant, rng);
}
const BENCH_SEED = 0x1ab;
const BENCH_SEED_STRIDE = 97;
const ITEM_MARGIN = 0.08;
const FLOOR_SHARD_BAND = 0.14;

/** Heights of the glassware, as shares of a tile. */
const ITEM_HEIGHT = {
  flask: 0.5,
  beaker: 0.34,
  round: 0.62,
  rack: 0.4,
  scope: 0.66,
  jar: 0.46,
} as const;

function drawBenchItems(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  S: number,
  variant: number,
  rng: () => number,
): void {
  const liquid = (): string => LIQUIDS[Math.floor(rng() * LIQUIDS.length)] ?? LIQUIDS[0];
  const backY = y + h * ITEM_BACK_ROW;
  const frontY = y + h * ITEM_FRONT_ROW;
  switch (variant % BENCH_VARIANTS) {
    case 0:
      drawClipboard(ctx, x + w * ITEM_RIGHT, frontY, S, (rng() - HALF) * CLIPBOARD_TILT);
      drawErlenmeyer(ctx, x + w * ITEM_LEFT, backY, S * ITEM_HEIGHT.flask, liquid());
      drawBeaker(ctx, x + w * ITEM_MID, frontY, S * ITEM_HEIGHT.beaker, liquid());
      break;
    case 1:
      drawTestTubeRack(ctx, x + w * ITEM_MID, backY, S * ITEM_HEIGHT.rack, rng);
      drawMicroscope(ctx, x + w * ITEM_RIGHT, frontY, S * ITEM_HEIGHT.scope);
      break;
    default:
      drawRoundFlaskOnStand(ctx, x + w * ITEM_LEFT, backY, S * ITEM_HEIGHT.round, liquid());
      drawSpecimenJar(
        ctx,
        x + w * ITEM_RIGHT,
        frontY,
        S * ITEM_HEIGHT.jar,
        JAR_FLUIDS[Math.floor(rng() * JAR_FLUIDS.length)] ?? JAR_FLUIDS[0],
        rng,
      );
      break;
  }
}
/** How many different glassware arrangements a bench can carry. */
export const BENCH_VARIANTS = 3;
const ITEM_BACK_ROW = 0.35;
const ITEM_FRONT_ROW = 0.92;
const ITEM_LEFT = 0.3;
const ITEM_MID = 0.5;
const ITEM_RIGHT = 0.7;
const CLIPBOARD_TILT = 0.6;
const JAR_FLUIDS = ['#9aa84a', '#b8923e', '#6e8c7a'] as const;

function drawBrokenBenchTop(
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  S: number,
  rng: () => number,
  dripToY: number | null,
): void {
  const liquid = LIQUIDS[Math.floor(rng() * LIQUIDS.length)] ?? LIQUIDS[0];
  drawSpill(ctx, x + w * SPILL_X, y + h * SPILL_Y, w * SPILL_RX, h * SPILL_RY, liquid, dripToY);
  // The stump of a flask still standing, snapped off at the shoulder.
  const stumpX = x + w * (ITEM_LEFT + rng() * ITEM_LEFT);
  const stumpY = y + h * ITEM_BACK_ROW;
  const stumpHalf = S * STUMP_HALF_W;
  ctx.fillStyle = GLASS_FILL;
  ctx.beginPath();
  ctx.moveTo(stumpX - stumpHalf, stumpY);
  ctx.lineTo(stumpX - stumpHalf * STUMP_TOP, stumpY - S * STUMP_H);
  ctx.lineTo(stumpX - stumpHalf * STUMP_JAG, stumpY - S * STUMP_H * STUMP_JAG_DROP);
  ctx.lineTo(stumpX + stumpHalf * STUMP_JAG, stumpY - S * STUMP_H);
  ctx.lineTo(stumpX + stumpHalf, stumpY);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = GLASS_EDGE;
  ctx.lineWidth = GLASS_LINE_WIDTH;
  ctx.stroke();
  drawShards(ctx, x, y, w, h, S, rng);
}
const SPILL_X = 0.55;
const SPILL_Y = 0.6;
const SPILL_RX = 0.38;
const SPILL_RY = 0.3;
const STUMP_HALF_W = 0.12;
const STUMP_TOP = 0.7;
const STUMP_JAG = 0.2;
const STUMP_JAG_DROP = 0.55;
const STUMP_H = 0.16;

// ── Terminal ────────────────────────────────────────────────────────────────

/** The terminal's bench footprint, in tiles. */
export const TERMINAL_COLS = 3;
export const TERMINAL_ROWS = 2;
/** How far the monitor rises above the terminal's footprint, as a share of a tile. */
export const TERMINAL_HEADROOM_SHARE = 0.75;
const MONITOR_W = 1.15;
const MONITOR_H = 0.95;
const MONITOR_BEZEL = 0.08;
const SCREEN_BG = '#07140c';
const SCREEN_TEXT = '#4ff08a';
const SCREEN_ALERT = '#ff5a4a';
const SCREEN_LINES = 6;
const CASE_LIGHT = '#cfc8b4';
const CASE_DARK = '#8e8672';
const KEYBOARD = '#b8b09a';
const KEY_ROWS = 3;
const KEY_COLS = 10;

/**
 * The terminal the hack is run from: a double-depth bench with a chunky
 * monitor, keyboard, a server tower and the mess of a lab that left in a hurry.
 * Painted as one picture with its origin at the back-left tile's top-left;
 * each tile of the bench is a crop of it.
 */
export function drawLabTerminal(ctx: Ctx, ox: number, oy: number, S: number): void {
  const lift = S * BENCH_HEIGHT_SHARE;
  const w = S * TERMINAL_COLS;
  const d = S * TERMINAL_ROWS;
  const left = ox + S * BENCH_END_INSET;
  const right = ox + w - S * BENCH_END_INSET;
  const topY = oy - lift + S * BENCH_END_INSET;
  const topBottom = oy + d - lift;
  // Front cabinets: three bays.
  verticalGradient(ctx, left, topBottom, right - left, lift, CABINET, CABINET_DARK);
  ctx.fillStyle = KICK_PLATE;
  ctx.fillRect(left, oy + d - S * BENCH_KICK, right - left, S * BENCH_KICK);
  ctx.strokeStyle = CABINET_SEAM;
  ctx.lineWidth = 1;
  for (let bay = 0; bay < TERMINAL_COLS; bay++) {
    const bx = ox + bay * S + S * BENCH_DOOR_INSET;
    const doorTop = topBottom + S * BENCH_LIP + S * BENCH_DOOR_INSET * HALF;
    const doorBottom = oy + d - S * BENCH_KICK - S * BENCH_DOOR_INSET * HALF;
    ctx.strokeRect(bx, doorTop, S - S * BENCH_DOOR_INSET * 2, doorBottom - doorTop);
    ctx.fillStyle = CABINET_HANDLE;
    ctx.fillRect(
      bx + S * HALF - S * BENCH_HANDLE_W,
      doorTop + S * BENCH_DOOR_INSET * HALF,
      S * BENCH_HANDLE_W,
      S * BENCH_HANDLE_H,
    );
  }
  // Top.
  ctx.save();
  roundRectPath(ctx, left, topY, right - left, topBottom - topY + S * BENCH_LIP, S * BENCH_CORNER);
  ctx.clip();
  verticalGradient(
    ctx,
    left,
    topY,
    right - left,
    topBottom - topY + S * BENCH_LIP,
    RESIN_TOP_LIGHT,
    RESIN_TOP,
  );
  ctx.fillStyle = RESIN_EDGE;
  ctx.fillRect(left, topBottom, right - left, S * BENCH_LIP);
  ctx.restore();

  const rng = makeRng(TERMINAL_SEED);
  // Cables snaking off the back.
  ctx.strokeStyle = RUBBER;
  ctx.lineWidth = CABLE_WIDTH;
  ctx.beginPath();
  ctx.moveTo(ox + w * HALF, topY + S * CABLE_START);
  ctx.bezierCurveTo(
    ox + w * CABLE_BEND_A,
    topY,
    ox + w * CABLE_BEND_B,
    topY + S * CABLE_SAG,
    ox + w * CABLE_END,
    topY + S * CABLE_START,
  );
  ctx.stroke();

  // Server tower on the left, lights blinking.
  const towerX = left + S * TOWER_X;
  const towerBase = topBottom - S * TOWER_BASE;
  const towerW = S * TOWER_W;
  const towerH = S * TOWER_H;
  contactShadow(ctx, towerX + towerW / 2, towerBase, towerW * HALF, S * CONTACT_SHADOW_DEPTH);
  verticalGradient(ctx, towerX, towerBase - towerH, towerW, towerH, CASE_LIGHT, CASE_DARK);
  ctx.strokeStyle = CASE_DARK;
  ctx.strokeRect(towerX, towerBase - towerH, towerW, towerH);
  for (let i = 0; i < TOWER_LIGHTS; i++) {
    ctx.fillStyle = i % 2 === 0 ? SCREEN_TEXT : SCREEN_ALERT;
    ctx.fillRect(
      towerX + towerW * TOWER_LIGHT_X,
      towerBase - towerH + S * (TOWER_LIGHT_TOP + i * TOWER_LIGHT_PITCH),
      S * TOWER_LIGHT_SIZE,
      S * TOWER_LIGHT_SIZE,
    );
  }

  // Monitor: a deep CRT at the back middle, its screen scrolling green.
  const monW = S * MONITOR_W;
  const monH = S * MONITOR_H;
  const monX = ox + w * HALF - monW / 2;
  const monBase = topY + (topBottom - topY) * MONITOR_BASE_SHARE;
  contactShadow(ctx, monX + monW / 2, monBase, monW * HALF, S * CONTACT_SHADOW_DEPTH * 2);
  ctx.fillStyle = CASE_DARK;
  ctx.fillRect(
    monX + monW * MONITOR_NECK_X,
    monBase - S * MONITOR_NECK_H,
    monW * MONITOR_NECK_W,
    S * MONITOR_NECK_H,
  );
  roundRectPath(ctx, monX, monBase - S * MONITOR_NECK_H - monH, monW, monH, S * BENCH_CORNER);
  const caseGrad = ctx.createLinearGradient(monX, 0, monX + monW, 0);
  caseGrad.addColorStop(0, CASE_LIGHT);
  caseGrad.addColorStop(1, CASE_DARK);
  ctx.fillStyle = caseGrad;
  ctx.fill();
  const bezel = S * MONITOR_BEZEL;
  const screenX = monX + bezel;
  const screenY = monBase - S * MONITOR_NECK_H - monH + bezel;
  const screenW = monW - bezel * 2;
  const screenH = monH - bezel * 2 - S * MONITOR_CHIN;
  roundRectPath(ctx, screenX, screenY, screenW, screenH, bezel);
  ctx.fillStyle = SCREEN_BG;
  ctx.fill();
  ctx.fillStyle = SCREEN_TEXT;
  for (let i = 0; i < SCREEN_LINES; i++) {
    const lineW = screenW * (SCREEN_LINE_MIN + rng() * SCREEN_LINE_RANGE);
    ctx.fillRect(
      screenX + bezel * HALF,
      screenY + bezel * HALF + (i * (screenH - bezel)) / SCREEN_LINES,
      lineW,
      SCREEN_LINE_H,
    );
  }
  ctx.fillStyle = SCREEN_ALERT;
  ctx.fillRect(
    screenX + bezel * HALF,
    screenY + screenH - bezel,
    screenW * SCREEN_ALERT_W,
    SCREEN_LINE_H * 2,
  );
  ctx.fillStyle = SCREEN_GLARE;
  ctx.fillRect(screenX, screenY, screenW, screenH * HALF);

  // Keyboard in front of the monitor.
  const kbW = S * KEYBOARD_W;
  const kbH = S * KEYBOARD_H;
  const kbX = ox + w * HALF - kbW / 2;
  const kbY = topBottom - S * KEYBOARD_FROM_FRONT;
  ctx.fillStyle = KEYBOARD;
  roundRectPath(ctx, kbX, kbY, kbW, kbH, KEYBOARD_ROUND);
  ctx.fill();
  ctx.fillStyle = CASE_DARK;
  for (let r = 0; r < KEY_ROWS; r++) {
    for (let c = 0; c < KEY_COLS; c++) {
      ctx.fillRect(
        kbX + KEY_MARGIN + (c * (kbW - KEY_MARGIN * 2)) / KEY_COLS,
        kbY + KEY_MARGIN + (r * (kbH - KEY_MARGIN * 2)) / KEY_ROWS,
        KEY_SIZE,
        KEY_SIZE,
      );
    }
  }

  // Coffee left to go cold, and paperwork on the right.
  const mugX = right - S * MUG_X;
  const mugY = topBottom - S * MUG_FROM_FRONT;
  contactShadow(ctx, mugX, mugY, S * MUG_R, S * MUG_R * HALF);
  ctx.fillStyle = MUG;
  ctx.fillRect(mugX - S * MUG_R, mugY - S * MUG_H, S * MUG_R * 2, S * MUG_H);
  ctx.fillStyle = COFFEE;
  ctx.beginPath();
  ctx.ellipse(mugX, mugY - S * MUG_H, S * MUG_R, S * MUG_R * HALF, 0, 0, TWO_PI);
  ctx.fill();
  drawClipboard(ctx, right - S * PAPER_X, topY + (topBottom - topY) * PAPER_Y, S, PAPER_TILT);
  // The shutdown label every lab terminal carries.
  ctx.fillStyle = SCREEN_ALERT;
  ctx.fillRect(
    left + (right - left) * HALF - S * LABEL_W * HALF,
    oy + d - S * BENCH_KICK - S * LABEL_DROP,
    S * LABEL_W,
    S * LABEL_H,
  );
}
const TERMINAL_SEED = 0x7e41;
const CABLE_WIDTH = 2;
const CABLE_START = 0.2;
const CABLE_SAG = 0.4;
const CABLE_BEND_A = 0.6;
const CABLE_BEND_B = 0.78;
const CABLE_END = 0.9;
const TOWER_X = 0.12;
const TOWER_BASE = 0.35;
const TOWER_W = 0.42;
const TOWER_H = 0.9;
const TOWER_LIGHTS = 4;
const TOWER_LIGHT_X = 0.2;
const TOWER_LIGHT_TOP = 0.12;
const TOWER_LIGHT_PITCH = 0.08;
const TOWER_LIGHT_SIZE = 0.05;
const MONITOR_BASE_SHARE = 0.55;
const MONITOR_NECK_X = 0.4;
const MONITOR_NECK_W = 0.2;
const MONITOR_NECK_H = 0.12;
const MONITOR_CHIN = 0.1;
const SCREEN_LINE_MIN = 0.3;
const SCREEN_LINE_RANGE = 0.5;
const SCREEN_LINE_H = 2;
const SCREEN_ALERT_W = 0.45;
const SCREEN_GLARE = 'rgba(160,255,190,0.08)';
const KEYBOARD_W = 1.2;
const KEYBOARD_H = 0.3;
const KEYBOARD_FROM_FRONT = 0.42;
const KEYBOARD_ROUND = 3;
const KEY_MARGIN = 3;
const KEY_SIZE = 3;
const MUG = '#dddddd';
const COFFEE = '#3b2616';
const MUG_X = 0.45;
const MUG_FROM_FRONT = 0.3;
const MUG_R = 0.09;
const MUG_H = 0.16;
const PAPER_X = 0.45;
const PAPER_Y = 0.3;
const PAPER_TILT = 0.3;
const LABEL_W = 0.5;
const LABEL_H = 0.08;
const LABEL_DROP = 0.14;

// ── Specimen shelf ──────────────────────────────────────────────────────────

/** How tall a shelving unit stands above its footprint, as a share of a tile. */
export const SHELF_HEIGHT_SHARE = 1.25;
/** How many different loads a shelf can carry. */
export const SHELF_VARIANTS = 3;
const SHELF_LEVELS = 3;
const SHELF_POST_W = 0.07;
const SHELF_PLANK_H = 0.05;
const SHELF_BACK = '#2b3033';
const SHELF_BACK_DARK = '#1a1d1f';
const SHELF_JAR_FLUIDS = ['#8fb04a', '#c49a3e', '#6c9a88', '#a44a3e', '#7b8fd0'] as const;

/**
 * One tile of specimen shelving against a wall: steel posts and planks, and
 * rows of jars holding what the lab grew — tall enough to hide behind, which
 * is why they only ever stand against the walls.
 */
export function drawSpecimenShelf(
  ctx: Ctx,
  ox: number,
  oy: number,
  S: number,
  variant: number,
): void {
  const height = S * (SHELF_HEIGHT_SHARE - SHELF_TOP_CLEARANCE) + S;
  const top = oy + S - height;
  const left = ox + S * SHELF_EDGE_INSET;
  const right = ox + S - S * SHELF_EDGE_INSET;
  const w = right - left;
  contactShadow(
    ctx,
    ox + S * HALF,
    oy + S - S * SHELF_SHADOW_RISE,
    w * HALF,
    S * CONTACT_SHADOW_DEPTH,
  );
  verticalGradient(ctx, left, top, w, height, SHELF_BACK, SHELF_BACK_DARK);
  const rng = makeRng(SHELF_SEED + variant * BENCH_SEED_STRIDE);
  const levelH = (height - S * SHELF_TOP_H) / SHELF_LEVELS;
  for (let level = 0; level < SHELF_LEVELS; level++) {
    const plankY = top + S * SHELF_TOP_H + levelH * (level + 1) - S * SHELF_PLANK_H;
    const jars = SHELF_MIN_JARS + Math.floor(rng() * SHELF_JAR_SPREAD);
    for (let j = 0; j < jars; j++) {
      const jarH = levelH * (SHELF_JAR_MIN + rng() * SHELF_JAR_RANGE);
      const jarX = left + w * ((j + HALF) / jars);
      const fluid =
        SHELF_JAR_FLUIDS[Math.floor(rng() * SHELF_JAR_FLUIDS.length)] ?? SHELF_JAR_FLUIDS[0];
      if (rng() < SHELF_BOX_CHANCE) {
        ctx.fillStyle = SHELF_BOX;
        ctx.fillRect(
          jarX - jarH * HALF * SHELF_BOX_W,
          plankY - jarH * SHELF_BOX_H,
          jarH * SHELF_BOX_W,
          jarH * SHELF_BOX_H,
        );
        ctx.fillStyle = BIOHAZARD_LABEL;
        ctx.fillRect(
          jarX - jarH * SHELF_BOX_LABEL,
          plankY - jarH * SHELF_BOX_H * SHELF_BOX_LABEL_Y,
          jarH * SHELF_BOX_LABEL * 2,
          jarH * SHELF_BOX_LABEL,
        );
        continue;
      }
      drawSpecimenJar(ctx, jarX, plankY, jarH, fluid, rng);
    }
    ctx.fillStyle = STEEL;
    ctx.fillRect(left, plankY, w, S * SHELF_PLANK_H);
    ctx.fillStyle = STEEL_DARK;
    ctx.fillRect(left, plankY + S * SHELF_PLANK_H * HALF, w, S * SHELF_PLANK_H * HALF);
  }
  // Top plank and posts.
  ctx.fillStyle = STEEL;
  ctx.fillRect(left, top, w, S * SHELF_TOP_H);
  ctx.fillStyle = STEEL_DARK;
  ctx.fillRect(left, top, S * SHELF_POST_W, height);
  ctx.fillRect(right - S * SHELF_POST_W, top, S * SHELF_POST_W, height);
  ctx.fillStyle = STEEL;
  ctx.fillRect(left, top, S * SHELF_POST_W * HALF, height);
}
const SHELF_EDGE_INSET = 0.03;
/** Keeps the shelving's top plank a hair inside its frame. */
const SHELF_TOP_CLEARANCE = 0.05;
const SHELF_SHADOW_RISE = 0.04;
const SHELF_SEED = 0x51e1;
const SHELF_TOP_H = 0.07;
const SHELF_MIN_JARS = 2;
const SHELF_JAR_SPREAD = 2;
const SHELF_JAR_MIN = 0.55;
const SHELF_JAR_RANGE = 0.3;
const SHELF_BOX_CHANCE = 0.2;
const SHELF_BOX = '#c9b98e';
const SHELF_BOX_W = 1.3;
const SHELF_BOX_H = 0.8;
const SHELF_BOX_LABEL = 0.14;
const SHELF_BOX_LABEL_Y = 0.6;
const BIOHAZARD_LABEL = '#e0a526';

/**
 * One tile of specimen shelving running along a side wall, as the room sees
 * it: the rack's top, lifted by its height, with the jars on its top shelf
 * seen from above, and a sliver of its room-facing side showing the rows of
 * specimens down its length. `end` is the run's last tile, whose end panel
 * faces the camera. Painted against a west wall; an east wall's is mirrored.
 */
export function drawSpecimenShelfSide(
  ctx: Ctx,
  ox: number,
  oy: number,
  S: number,
  variant: number,
  end: boolean,
): void {
  const lift = S * (SHELF_HEIGHT_SHARE - SHELF_TOP_CLEARANCE);
  const left = ox + S * SHELF_EDGE_INSET;
  const depth = S * SIDE_RACK_DEPTH;
  const topY = oy - lift;
  const rng = makeRng(SHELF_SEED + variant * BENCH_SEED_STRIDE + SIDE_SEED_OFFSET);
  // The room-facing side: a strip of shelf ends with jar colours between them.
  const sideX = left + depth;
  const sideW = S * SIDE_STRIP_W;
  const sideBottom = end ? oy + S - lift * SIDE_END_SHARE : oy + S;
  verticalGradient(ctx, sideX, topY, sideW, sideBottom - topY, SHELF_BACK, SHELF_BACK_DARK);
  const levels = SHELF_LEVELS;
  const levelH = lift / levels;
  for (let level = 0; level < levels; level++) {
    const bandY = topY + S + level * levelH - S;
    for (let j = 0; j < SIDE_JARS_PER_BAND; j++) {
      const fluid =
        SHELF_JAR_FLUIDS[Math.floor(rng() * SHELF_JAR_FLUIDS.length)] ?? SHELF_JAR_FLUIDS[0];
      ctx.fillStyle = fluid;
      ctx.globalAlpha = JAR_FLUID_ALPHA;
      ctx.fillRect(
        sideX + 1,
        bandY + j * (S / SIDE_JARS_PER_BAND) + SIDE_JAR_GAP,
        sideW - 2,
        S / SIDE_JARS_PER_BAND - SIDE_JAR_GAP * 2,
      );
      ctx.globalAlpha = 1;
    }
  }
  ctx.fillStyle = STEEL_DARK;
  ctx.fillRect(sideX + sideW - 1, topY, 1, sideBottom - topY);
  // The top of the rack, and the lids of the jars on it.
  // Flat rather than shaded, so the run's tiles meet without a seam.
  ctx.fillStyle = SIDE_TOP;
  ctx.fillRect(left, topY, depth, S);
  for (let j = 0; j < SIDE_TOP_JARS; j++) {
    const cx = left + depth * HALF + (rng() - HALF) * depth * SIDE_JAR_WANDER;
    const cy = topY + (S * (j + HALF)) / SIDE_TOP_JARS;
    const r = depth * SIDE_LID_R;
    ctx.fillStyle =
      SHELF_JAR_FLUIDS[Math.floor(rng() * SHELF_JAR_FLUIDS.length)] ?? SHELF_JAR_FLUIDS[0];
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, TWO_PI);
    ctx.fill();
    ctx.strokeStyle = STEEL_DARK;
    ctx.lineWidth = SIDE_LID_RIM;
    ctx.stroke();
    ctx.fillStyle = GLASS_GLINT;
    ctx.beginPath();
    ctx.arc(cx - r * HALF, cy - r * HALF, r * GLINT_DOT, 0, TWO_PI);
    ctx.fill();
  }
  ctx.fillStyle = STEEL_DARK;
  ctx.fillRect(left, topY, 1, S);
  if (!end) return;
  // The run's end panel: the rack in section, facing the camera.
  const panelTop = topY + S;
  const panelH = oy + S - panelTop;
  verticalGradient(ctx, left, panelTop, depth + sideW, panelH, SHELF_BACK, SHELF_BACK_DARK);
  for (let level = 0; level <= levels; level++) {
    const plankY = panelTop + (panelH * level) / levels - S * SHELF_PLANK_H * HALF;
    ctx.fillStyle = STEEL;
    ctx.fillRect(left, Math.max(panelTop, plankY), depth + sideW, S * SHELF_PLANK_H);
  }
  ctx.fillStyle = STEEL_DARK;
  ctx.fillRect(left, panelTop, S * SHELF_POST_W, panelH);
  ctx.fillRect(left + depth + sideW - S * SHELF_POST_W, panelTop, S * SHELF_POST_W, panelH);
}
const SIDE_RACK_DEPTH = 0.62;
const SIDE_TOP = '#8c9598';
const SIDE_STRIP_W = 0.26;
const SIDE_END_SHARE = 0;
const SIDE_SEED_OFFSET = 31;
const SIDE_JARS_PER_BAND = 2;
const SIDE_JAR_GAP = 2;
const SIDE_TOP_JARS = 2;
const SIDE_JAR_WANDER = 0.3;
const SIDE_LID_R = 0.28;
const SIDE_LID_RIM = 1.5;

// ── Egg sac ─────────────────────────────────────────────────────────────────

/** The frames the egg sac tears open over, between whole and opened. */
export const EGG_OPENING_FRAMES = 4;
const EGG_RX = 0.68;
const EGG_RY = 0.78;
const EGG_BASE_RISE = 0.12;
const EGG_SKIN = '#cbbd96';
const EGG_SKIN_DARK = '#7d6a4a';
const EGG_VEIN = 'rgba(120,40,52,0.55)';
const EGG_SHADOW_FORM = '#3a2a1e';
const EGG_SLIME = 'rgba(170,200,110,0.6)';
const EGG_INSIDE = '#2c1d18';
const EGG_VEINS = 7;
const EGG_TETHERS = 6;

/**
 * The egg sac she hatches from: a veined, translucent bag with something
 * curled inside, tethered to the floor with silk. `opening` runs 0 → 1 over the
 * frames it tears; 1 is burst and emptied.
 */
export function drawEggSac(ctx: Ctx, ox: number, oy: number, S: number, opening: number): void {
  const cx = ox + S * HALF;
  const baseY = oy + S - S * EGG_BASE_RISE;
  const rx = S * EGG_RX;
  const ry = S * EGG_RY;
  const cy = baseY - ry;
  const rng = makeRng(EGG_SEED);
  contactShadow(ctx, cx, baseY, rx * EGG_SHADOW_W, S * EGG_SHADOW_H);
  // Silk tethers pinning it to the floor.
  ctx.strokeStyle = TETHER;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < EGG_TETHERS; i++) {
    const angle = Math.PI * (EGG_TETHER_SPREAD_START + (i / (EGG_TETHERS - 1)) * EGG_TETHER_SPREAD);
    ctx.moveTo(
      cx + Math.cos(angle) * rx * EGG_TETHER_FROM,
      cy + Math.sin(angle) * ry * EGG_TETHER_FROM,
    );
    ctx.lineTo(cx + Math.cos(angle) * rx * EGG_TETHER_TO, baseY + S * EGG_TETHER_DROP * rng());
  }
  ctx.stroke();

  const burst = opening >= 1;
  if (burst) {
    drawOpenedEgg(ctx, cx, cy, rx, ry, baseY, S, rng);
    return;
  }
  // The bag, lit from the upper left.
  const bag = ctx.createRadialGradient(
    cx - rx * EGG_LIGHT,
    cy - ry * EGG_LIGHT,
    rx * EGG_LIGHT_CORE,
    cx,
    cy,
    Math.max(rx, ry),
  );
  bag.addColorStop(0, EGG_SKIN);
  bag.addColorStop(1, EGG_SKIN_DARK);
  ctx.fillStyle = bag;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, TWO_PI);
  ctx.fill();
  // The thing inside, curled, pressing harder as it wakes.
  const press = opening * EGG_PRESS;
  ctx.fillStyle = EGG_SHADOW_FORM;
  ctx.globalAlpha = EGG_FORM_ALPHA + opening * EGG_FORM_ALPHA;
  ctx.beginPath();
  ctx.ellipse(
    cx + rx * press,
    cy + ry * EGG_FORM_DROP,
    rx * EGG_FORM_RX,
    ry * EGG_FORM_RY,
    EGG_FORM_TILT,
    0,
    TWO_PI,
  );
  ctx.fill();
  for (let leg = 0; leg < EGG_FORM_LEGS; leg++) {
    const angle = EGG_FORM_LEG_START + leg * EGG_FORM_LEG_STEP;
    ctx.strokeStyle = EGG_SHADOW_FORM;
    ctx.lineWidth = EGG_FORM_LEG_W;
    ctx.beginPath();
    ctx.moveTo(cx + rx * press, cy + ry * EGG_FORM_DROP);
    ctx.quadraticCurveTo(
      cx + Math.cos(angle) * rx * EGG_FORM_LEG_BEND,
      cy + Math.sin(angle) * ry * EGG_FORM_LEG_BEND,
      cx + Math.cos(angle + EGG_FORM_LEG_CURL) * rx * EGG_FORM_LEG_REACH,
      cy + Math.sin(angle + EGG_FORM_LEG_CURL) * ry * EGG_FORM_LEG_REACH,
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  // Veins.
  ctx.strokeStyle = EGG_VEIN;
  ctx.lineWidth = EGG_VEIN_W;
  for (let i = 0; i < EGG_VEINS; i++) {
    const startAngle = rng() * TWO_PI;
    ctx.beginPath();
    ctx.moveTo(
      cx + Math.cos(startAngle) * rx * EGG_VEIN_OUTER,
      cy + Math.sin(startAngle) * ry * EGG_VEIN_OUTER,
    );
    ctx.quadraticCurveTo(
      cx + Math.cos(startAngle + EGG_VEIN_TWIST) * rx * EGG_VEIN_MID,
      cy + Math.sin(startAngle + EGG_VEIN_TWIST) * ry * EGG_VEIN_MID,
      cx + Math.cos(startAngle + EGG_VEIN_TWIST * 2) * rx * EGG_VEIN_INNER,
      cy + Math.sin(startAngle + EGG_VEIN_TWIST * 2) * ry * EGG_VEIN_INNER,
    );
    ctx.stroke();
  }
  // Tears, growing as it opens.
  if (opening > 0) {
    ctx.strokeStyle = EGG_INSIDE;
    ctx.lineWidth = EGG_TEAR_W * (1 + opening * EGG_TEAR_GROW);
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const tearLength = opening * EGG_TEAR_REACH;
    ctx.moveTo(cx, cy - ry * EGG_TEAR_ORIGIN);
    ctx.lineTo(
      cx - rx * tearLength * EGG_TEAR_ZIG,
      cy - ry * EGG_TEAR_ORIGIN + ry * tearLength * EGG_TEAR_STEP,
    );
    ctx.lineTo(
      cx + rx * tearLength * EGG_TEAR_ZAG,
      cy - ry * EGG_TEAR_ORIGIN + ry * tearLength * EGG_TEAR_STEP * 2,
    );
    ctx.moveTo(cx, cy - ry * EGG_TEAR_ORIGIN);
    ctx.lineTo(
      cx + rx * tearLength * EGG_TEAR_BRANCH,
      cy - ry * EGG_TEAR_ORIGIN - ry * tearLength * EGG_TEAR_STEP * HALF,
    );
    ctx.stroke();
    ctx.fillStyle = EGG_SLIME;
    ctx.beginPath();
    ctx.ellipse(
      cx,
      baseY,
      rx * opening * EGG_SLIME_SPREAD,
      S * EGG_SHADOW_H * opening,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  // Wet highlight.
  ctx.fillStyle = EGG_GLOSS;
  ctx.beginPath();
  ctx.ellipse(
    cx - rx * EGG_GLOSS_X,
    cy - ry * EGG_GLOSS_Y,
    rx * EGG_GLOSS_RX,
    ry * EGG_GLOSS_RY,
    EGG_GLOSS_TILT,
    0,
    TWO_PI,
  );
  ctx.fill();
}
const EGG_SEED = 0xe99;
const TETHER = 'rgba(225,225,210,0.7)';
const EGG_SHADOW_W = 1.1;
const EGG_SHADOW_H = 0.14;
const EGG_TETHER_SPREAD_START = 0.1;
const EGG_TETHER_SPREAD = 0.8;
const EGG_TETHER_FROM = 0.8;
const EGG_TETHER_TO = 1.25;
const EGG_TETHER_DROP = 0.12;
const EGG_LIGHT = 0.35;
const EGG_LIGHT_CORE = 0.1;
const EGG_PRESS = 0.18;
const EGG_FORM_ALPHA = 0.35;
const EGG_FORM_DROP = 0.1;
const EGG_FORM_RX = 0.42;
const EGG_FORM_RY = 0.34;
const EGG_FORM_TILT = 0.4;
const EGG_FORM_LEGS = 6;
const EGG_FORM_LEG_START = 0.3;
const EGG_FORM_LEG_STEP = 1.05;
const EGG_FORM_LEG_W = 3;
const EGG_FORM_LEG_BEND = 0.62;
const EGG_FORM_LEG_CURL = 0.5;
const EGG_FORM_LEG_REACH = 0.55;
const EGG_VEIN_W = 1.5;
const EGG_VEIN_OUTER = 0.95;
const EGG_VEIN_MID = 0.7;
const EGG_VEIN_INNER = 0.45;
const EGG_VEIN_TWIST = 0.35;
const EGG_TEAR_W = 1.5;
const EGG_TEAR_GROW = 1.5;
const EGG_TEAR_REACH = 0.9;
const EGG_TEAR_ORIGIN = 0.55;
const EGG_TEAR_ZIG = 0.35;
const EGG_TEAR_ZAG = 0.2;
const EGG_TEAR_STEP = 0.45;
const EGG_TEAR_BRANCH = 0.4;
const EGG_SLIME_SPREAD = 1.3;
const EGG_GLOSS = 'rgba(255,250,230,0.45)';
const EGG_GLOSS_X = 0.38;
const EGG_GLOSS_Y = 0.45;
const EGG_GLOSS_RX = 0.18;
const EGG_GLOSS_RY = 0.26;
const EGG_GLOSS_TILT = -0.4;

function drawOpenedEgg(
  ctx: Ctx,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  baseY: number,
  S: number,
  rng: () => number,
): void {
  // Fluid spilled across the floor.
  ctx.fillStyle = EGG_SLIME;
  ctx.beginPath();
  ctx.ellipse(cx, baseY, rx * EGG_SLIME_SPREAD, S * EGG_SHADOW_H * 2, 0, 0, TWO_PI);
  ctx.fill();
  // The empty cup of the bag's lower half.
  ctx.fillStyle = EGG_INSIDE;
  ctx.beginPath();
  ctx.ellipse(cx, cy + ry * OPENED_CUP_DROP, rx * OPENED_CUP_W, ry * OPENED_CUP_H, 0, 0, TWO_PI);
  ctx.fill();
  // Petals of torn membrane peeled back and hanging.
  for (let i = 0; i < OPENED_PETALS; i++) {
    const angle = Math.PI * (OPENED_PETAL_START + (i / (OPENED_PETALS - 1)) * OPENED_PETAL_SPREAD);
    const tipX = cx + Math.cos(angle) * rx * (OPENED_PETAL_REACH + rng() * OPENED_PETAL_JITTER);
    const tipY = cy + ry * OPENED_CUP_DROP + Math.sin(angle) * ry * OPENED_PETAL_REACH;
    const rootLeft = cx + Math.cos(angle - OPENED_PETAL_ROOT) * rx * OPENED_CUP_W;
    const rootRight = cx + Math.cos(angle + OPENED_PETAL_ROOT) * rx * OPENED_CUP_W;
    const rootY = cy + ry * OPENED_CUP_DROP;
    ctx.fillStyle = i % 2 === 0 ? EGG_SKIN : EGG_SKIN_DARK;
    ctx.beginPath();
    ctx.moveTo(rootLeft, rootY);
    ctx.quadraticCurveTo(tipX, tipY - ry * OPENED_PETAL_CURL, tipX, tipY);
    ctx.quadraticCurveTo(tipX, tipY + ry * OPENED_PETAL_CURL * HALF, rootRight, rootY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = EGG_VEIN;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  // Strings of slime still spanning the opening.
  ctx.strokeStyle = EGG_SLIME;
  ctx.lineWidth = 1;
  for (let i = 0; i < OPENED_STRINGS; i++) {
    const x0 = cx - rx * OPENED_CUP_W + rng() * rx * OPENED_CUP_W * 2;
    ctx.beginPath();
    ctx.moveTo(x0, cy + ry * OPENED_CUP_DROP - ry * OPENED_CUP_H);
    ctx.quadraticCurveTo(
      x0 + rx * (rng() - HALF),
      cy + ry * OPENED_STRING_SAG,
      x0 + rx * (rng() - HALF) * HALF,
      cy + ry * OPENED_CUP_DROP + ry * OPENED_CUP_H,
    );
    ctx.stroke();
  }
}
const OPENED_CUP_DROP = 0.35;
const OPENED_CUP_W = 0.8;
const OPENED_CUP_H = 0.42;
const OPENED_PETALS = 5;
const OPENED_PETAL_START = 0.95;
const OPENED_PETAL_SPREAD = 1.1;
const OPENED_PETAL_REACH = 1.1;
const OPENED_PETAL_JITTER = 0.15;
const OPENED_PETAL_ROOT = 0.3;
const OPENED_PETAL_CURL = 0.4;
const OPENED_STRINGS = 4;
const OPENED_STRING_SAG = 0.45;

// ── Cocoon ──────────────────────────────────────────────────────────────────

/** A cocoon's poses, in sheet order within each row. */
export const COCOON_IDLE_FRAMES = 3;
export const COCOON_HATCH_FRAMES = 4;
const COCOON_W = 0.62;
const COCOON_TOP = 1.3;
const COCOON_BOTTOM = 0.08;
const COCOON_HEAD_R = 0.18;
const COCOON_SILK = '#d9d6c6';
const COCOON_SILK_DARK = '#8e8a78';
const COCOON_STAIN = 'rgba(110,22,28,0.55)';
const COCOON_WRAPS = 11;
const COCOON_STRANDS = 3;

/**
 * A lab worker wrapped and hung from the ceiling. `sway` leans the bundle for
 * the idle twitch; `hatch` runs 0 → 1 as something tears its way out; `burst`
 * is the torn, empty husk left hanging.
 */
export function drawCocoon(
  ctx: Ctx,
  ox: number,
  oy: number,
  S: number,
  pose: { sway: number; hatch: number; burst: boolean },
): void {
  const cx = ox + S * HALF;
  const bottom = oy + S - S * COCOON_BOTTOM;
  const top = oy + S - S * COCOON_TOP - S * COCOON_BOTTOM;
  const halfW = S * COCOON_W * HALF;
  const lean = pose.sway * S * COCOON_SWAY;
  contactShadow(
    ctx,
    cx,
    oy + S - S * COCOON_SHADOW_RISE,
    halfW * COCOON_SHADOW_W,
    S * CONTACT_SHADOW_DEPTH,
  );
  // Strands up to the ceiling, out of the top of the frame.
  ctx.strokeStyle = COCOON_SILK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 0; i < COCOON_STRANDS; i++) {
    const spread = (i - (COCOON_STRANDS - 1) / 2) * halfW * COCOON_STRAND_SPREAD;
    ctx.moveTo(cx + lean * HALF, top + S * COCOON_HEAD_R);
    ctx.lineTo(cx + spread, oy - S * COCOON_CEILING);
  }
  ctx.stroke();

  // A wrapped body: a rounded head, the bundle widest at the shoulders, and
  // tapering through the hips to the feet.
  const length = bottom - top;
  const shouldersY = top + length * COCOON_SHOULDER_SHARE;
  const hipsY = top + length * COCOON_HIPS_SHARE;
  const body = (): void => {
    ctx.beginPath();
    ctx.moveTo(cx + lean, top);
    ctx.bezierCurveTo(
      cx + lean + halfW * COCOON_HEAD_WIDTH,
      top,
      cx + lean + halfW,
      shouldersY - length * COCOON_SHOULDER_ROUND,
      cx + lean * HALF + halfW,
      shouldersY,
    );
    ctx.quadraticCurveTo(cx + halfW * COCOON_HIP, hipsY, cx + halfW * COCOON_FOOT, bottom);
    ctx.lineTo(cx - halfW * COCOON_FOOT, bottom);
    ctx.quadraticCurveTo(cx - halfW * COCOON_HIP, hipsY, cx + lean * HALF - halfW, shouldersY);
    ctx.bezierCurveTo(
      cx + lean - halfW,
      shouldersY - length * COCOON_SHOULDER_ROUND,
      cx + lean - halfW * COCOON_HEAD_WIDTH,
      top,
      cx + lean,
      top,
    );
    ctx.closePath();
  };
  if (pose.burst) {
    // The husk: split down the front and hanging open, a dark hollow inside.
    body();
    ctx.fillStyle = COCOON_SILK_DARK;
    ctx.fill();
    ctx.fillStyle = EGG_INSIDE;
    ctx.beginPath();
    ctx.ellipse(
      cx + lean * HALF,
      (top + bottom) / 2,
      halfW * COCOON_HOLLOW_W,
      (bottom - top) * COCOON_HOLLOW_H,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.strokeStyle = COCOON_SILK;
    ctx.lineWidth = COCOON_FLAP_W;
    ctx.beginPath();
    ctx.moveTo(cx - halfW * COCOON_FLAP_X, top + S * COCOON_FLAP_TOP);
    ctx.quadraticCurveTo(
      cx - halfW * COCOON_FLAP_OUT,
      (top + bottom) / 2,
      cx - halfW * COCOON_FLAP_X,
      bottom - S * COCOON_FLAP_BOTTOM,
    );
    ctx.moveTo(cx + halfW * COCOON_FLAP_X, top + S * COCOON_FLAP_TOP);
    ctx.quadraticCurveTo(
      cx + halfW * COCOON_FLAP_OUT,
      (top + bottom) / 2,
      cx + halfW * COCOON_FLAP_X,
      bottom - S * COCOON_FLAP_BOTTOM,
    );
    ctx.stroke();
    return;
  }
  const bulge = pose.hatch * S * COCOON_HATCH_BULGE;
  const silk = ctx.createLinearGradient(cx - halfW, 0, cx + halfW, 0);
  silk.addColorStop(0, COCOON_SILK_DARK);
  silk.addColorStop(COCOON_SILK_LIGHT_STOP, COCOON_SILK);
  silk.addColorStop(1, COCOON_SILK_DARK);
  body();
  ctx.fillStyle = silk;
  ctx.fill();
  if (bulge > 0) {
    ctx.fillStyle = COCOON_SILK;
    ctx.beginPath();
    ctx.ellipse(
      cx + lean * HALF,
      (top + bottom) / 2,
      halfW + bulge,
      (bottom - top) * COCOON_BULGE_H,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  // The head under the wrapping, and the wraps themselves.
  ctx.fillStyle = COCOON_SILK_DARK;
  ctx.globalAlpha = COCOON_HEAD_ALPHA;
  ctx.beginPath();
  ctx.arc(cx + lean, top + S * COCOON_HEAD_R * COCOON_HEAD_DROP, S * COCOON_HEAD_R, 0, TWO_PI);
  ctx.fill();
  ctx.globalAlpha = 1;
  ctx.strokeStyle = COCOON_SILK_DARK;
  ctx.lineWidth = 1;
  const rng = makeRng(COCOON_SEED);
  ctx.save();
  body();
  ctx.clip();
  ctx.beginPath();
  for (let i = 0; i < COCOON_WRAPS; i++) {
    const y = top + ((bottom - top) * (i + HALF)) / COCOON_WRAPS;
    const tilt = (rng() - HALF) * S * COCOON_WRAP_TILT;
    ctx.moveTo(cx - halfW - bulge, y - tilt);
    ctx.lineTo(cx + halfW + bulge, y + tilt);
  }
  ctx.stroke();
  // Old blood soaked through at the chest, and a shoe poking out of the bottom.
  ctx.fillStyle = COCOON_STAIN;
  ctx.beginPath();
  ctx.ellipse(
    cx + lean * HALF + halfW * COCOON_STAIN_X,
    top + (bottom - top) * COCOON_STAIN_Y,
    halfW * COCOON_STAIN_R,
    halfW * COCOON_STAIN_R * COCOON_STAIN_SQUASH,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = RUBBER;
  ctx.fillRect(
    cx - S * COCOON_SHOE_W * HALF,
    bottom - S * COCOON_SHOE_H,
    S * COCOON_SHOE_W,
    S * COCOON_SHOE_H,
  );
  if (pose.hatch > 0) {
    // Legs pushing through the split as it tears.
    ctx.strokeStyle = EGG_SHADOW_FORM;
    ctx.lineWidth = COCOON_LEG_W;
    ctx.lineCap = 'round';
    const legs = Math.ceil(pose.hatch * COCOON_HATCH_LEGS);
    for (let i = 0; i < legs; i++) {
      const side = i % 2 === 0 ? -1 : 1;
      const y = top + (bottom - top) * (COCOON_LEG_Y + (i >> 1) * COCOON_LEG_PITCH);
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.quadraticCurveTo(
        cx + side * halfW * COCOON_LEG_KNEE,
        y - S * COCOON_LEG_RISE,
        cx + side * (halfW + bulge + S * COCOON_LEG_REACH * pose.hatch),
        y + S * COCOON_LEG_RISE,
      );
      ctx.stroke();
    }
    ctx.lineCap = 'butt';
    ctx.strokeStyle = EGG_INSIDE;
    ctx.lineWidth = EGG_TEAR_W * (1 + pose.hatch);
    ctx.beginPath();
    ctx.moveTo(cx, top + (bottom - top) * COCOON_SPLIT_TOP);
    ctx.lineTo(
      cx + lean * HALF,
      top + (bottom - top) * (COCOON_SPLIT_TOP + pose.hatch * COCOON_SPLIT_REACH),
    );
    ctx.stroke();
  }
}
const COCOON_SWAY = 0.06;
const COCOON_SHADOW_RISE = 0.05;
const COCOON_SHADOW_W = 1.3;
const COCOON_CEILING = 0.9;
const COCOON_STRAND_SPREAD = 0.8;
const COCOON_HIP = 0.85;
const COCOON_FOOT = 0.32;
const COCOON_SHOULDER_SHARE = 0.3;
const COCOON_HIPS_SHARE = 0.68;
const COCOON_SHOULDER_ROUND = 0.12;
const COCOON_HEAD_WIDTH = 0.75;
const COCOON_HOLLOW_W = 0.55;
const COCOON_HOLLOW_H = 0.3;
const COCOON_FLAP_W = 3;
const COCOON_FLAP_X = 0.4;
const COCOON_FLAP_OUT = 1.6;
const COCOON_FLAP_TOP = 0.2;
const COCOON_FLAP_BOTTOM = 0.3;
const COCOON_HATCH_BULGE = 0.05;
const COCOON_SILK_LIGHT_STOP = 0.4;
const COCOON_BULGE_H = 0.22;
const COCOON_HEAD_ALPHA = 0.35;
const COCOON_HEAD_DROP = 1.1;
const COCOON_SEED = 0xc0c0;
const COCOON_WRAP_TILT = 0.06;
const COCOON_STAIN_X = 0.15;
const COCOON_STAIN_Y = 0.42;
const COCOON_STAIN_R = 0.55;
const COCOON_STAIN_SQUASH = 1.4;
const COCOON_SHOE_W = 0.14;
const COCOON_SHOE_H = 0.07;
const COCOON_LEG_W = 2.5;
const COCOON_HATCH_LEGS = 6;
const COCOON_LEG_Y = 0.35;
const COCOON_LEG_PITCH = 0.12;
const COCOON_LEG_KNEE = 1.4;
const COCOON_LEG_RISE = 0.1;
const COCOON_LEG_REACH = 0.08;
const COCOON_SPLIT_TOP = 0.3;
const COCOON_SPLIT_REACH = 0.5;

// ── Light bank ──────────────────────────────────────────────────────────────

/** A ceiling light bank's look: lit, a flicker's dim and dark beats, or blown out. */
export type LightBankLook = 'lit' | 'dim' | 'off' | 'dead';
export const LIGHT_BANK_LOOKS: readonly LightBankLook[] = ['lit', 'dim', 'off', 'dead'];
/** A light bank spans two tiles and hangs this far below the frame's top, in tiles. */
export const LIGHT_BANK_TILES = 2;
const HOUSING_H = 0.3;
const HOUSING_INSET = 0.05;
const TUBE_H = 0.07;
const HOUSING = '#3a3f43';
const HOUSING_RIM = '#6e767b';
const TUBE_LIT = '#f4fbff';
const TUBE_DIM = '#9fb3bb';
const TUBE_OFF = '#555d61';
const TUBE_DEAD = '#2c3033';
const BLOOM = 'rgba(210,240,255,0.22)';
const SCORCH = 'rgba(20,14,10,0.7)';

/** A fluorescent ceiling fixture of two tubes, `LIGHT_BANK_TILES` wide, anchored at its left tile. */
export function drawLightBank(
  ctx: Ctx,
  ox: number,
  oy: number,
  S: number,
  look: LightBankLook,
): void {
  const w = S * LIGHT_BANK_TILES;
  const x = ox + S * HOUSING_INSET;
  const width = w - S * HOUSING_INSET * 2;
  const y = oy + S * BANK_TOP;
  const h = S * HOUSING_H;
  if (look === 'lit') {
    ctx.fillStyle = BLOOM;
    roundRectPath(
      ctx,
      ox + BANK_RIM,
      oy + BANK_RIM,
      w - BANK_RIM * 2,
      S * BANK_BLOOM_H,
      S * BANK_BLOOM_ROUND,
    );
    ctx.fill();
  }
  ctx.fillStyle = HOUSING_RIM;
  roundRectPath(ctx, x, y, width, h, S * BANK_ROUND);
  ctx.fill();
  ctx.fillStyle = HOUSING;
  roundRectPath(
    ctx,
    x + BANK_RIM,
    y + BANK_RIM,
    width - BANK_RIM * 2,
    h - BANK_RIM * 2,
    S * BANK_ROUND,
  );
  ctx.fill();
  const tube =
    look === 'lit' ? TUBE_LIT : look === 'dim' ? TUBE_DIM : look === 'off' ? TUBE_OFF : TUBE_DEAD;
  const tubeW = width - S * BANK_TUBE_INSET * 2;
  for (let i = 0; i < BANK_TUBES; i++) {
    const tubeY = y + h * (BANK_TUBE_FIRST + i * BANK_TUBE_PITCH);
    ctx.fillStyle = tube;
    roundRectPath(ctx, x + S * BANK_TUBE_INSET, tubeY, tubeW, S * TUBE_H, S * TUBE_H * HALF);
    ctx.fill();
  }
  if (look === 'dead') {
    // A tube shattered out of its clips, and scorching round the ballast.
    ctx.fillStyle = SCORCH;
    ctx.beginPath();
    ctx.ellipse(
      x + width * BANK_SCORCH_X,
      y + h * HALF,
      width * BANK_SCORCH_R,
      h * HALF,
      0,
      0,
      TWO_PI,
    );
    ctx.fill();
    ctx.fillStyle = HOUSING;
    ctx.fillRect(
      x + width * BANK_GAP_X,
      y + h * BANK_TUBE_FIRST,
      width * BANK_GAP_W,
      S * TUBE_H * 2,
    );
  }
  // Diffuser grille.
  ctx.strokeStyle = HOUSING_RIM;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < BANK_GRILLE; i++) {
    const gx = x + (width * i) / BANK_GRILLE;
    ctx.moveTo(gx, y + BANK_RIM);
    ctx.lineTo(gx, y + h - BANK_RIM);
  }
  ctx.stroke();
}
const BANK_TOP = 0.15;
const BANK_BLOOM_H = 0.5;
const BANK_BLOOM_ROUND = 0.25;
const BANK_ROUND = 0.05;
const BANK_RIM = 2;
const BANK_TUBES = 2;
const BANK_TUBE_INSET = 0.1;
const BANK_TUBE_FIRST = 0.2;
const BANK_TUBE_PITCH = 0.42;
const BANK_SCORCH_X = 0.62;
const BANK_SCORCH_R = 0.22;
const BANK_GAP_X = 0.5;
const BANK_GAP_W = 0.2;
const BANK_GRILLE = 8;

// ── Web regrowth ────────────────────────────────────────────────────────────

/** Frames a cut web takes to spin back over a tile. */
export const WEB_GROWTH_FRAMES = 4;

/**
 * One tile of web spinning back, `growth` 0 → 1: a haze of silk thickening
 * over the floor, strands reaching out from the middle to the tile's edges,
 * then the spiral laid across them — the same web the floor bakes once it is done.
 */
export function drawWebGrowth(ctx: Ctx, ox: number, oy: number, S: number, growth: number): void {
  const cx = ox + S * HALF;
  const cy = oy + S * HALF;
  ctx.fillStyle = `rgba(${GROWTH_SILK_RGB},${(GROWTH_WASH_ALPHA * growth).toFixed(3)})`;
  ctx.fillRect(ox, oy, S, S);
  const reach = Math.min(1, growth * GROWTH_STRAND_SPEED);
  const anchors = GROWTH_ANCHORS.map(([ax, ay]) => ({ x: ox + ax * S, y: oy + ay * S }));
  ctx.strokeStyle = `rgba(${GROWTH_SILK_RGB},${GROWTH_STRAND_ALPHA})`;
  ctx.lineWidth = GROWTH_LINE_W;
  ctx.beginPath();
  for (const anchor of anchors) {
    ctx.moveTo(cx, cy);
    ctx.lineTo(cx + (anchor.x - cx) * reach, cy + (anchor.y - cy) * reach);
  }
  ctx.stroke();
  const spiral = Math.max(0, (growth - GROWTH_SPIRAL_START) / (1 - GROWTH_SPIRAL_START));
  const rings = Math.floor(spiral * GROWTH_RINGS);
  const ordered = anchors.map((a) => Math.atan2(a.y - cy, a.x - cx)).sort((a, b) => a - b);
  for (let r = 0; r < rings; r++) {
    const radius = S * (GROWTH_RING_MIN + r * GROWTH_RING_STEP);
    ctx.beginPath();
    ordered.forEach((angle, i) => {
      const px = cx + Math.cos(angle) * radius;
      const py = cy + Math.sin(angle) * radius;
      if (i === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    });
    ctx.closePath();
    ctx.stroke();
  }
}
const GROWTH_SILK_RGB = '222,224,214';
const GROWTH_WASH_ALPHA = 0.4;
const GROWTH_STRAND_ALPHA = 0.8;
const GROWTH_STRAND_SPEED = 1.6;
const GROWTH_SPIRAL_START = 0.45;
const GROWTH_RINGS = 3;
const GROWTH_RING_MIN = 0.1;
const GROWTH_RING_STEP = 0.1;
const GROWTH_LINE_W = 2.2;
/** Where a regrowing web's strands fix to its tile's edges, as shares of the tile. */
const GROWTH_ANCHORS: ReadonlyArray<readonly [number, number]> = [
  [0.3, 0],
  [0.72, 0],
  [1, 0.35],
  [1, 0.7],
  [0.65, 1],
  [0.25, 1],
  [0, 0.62],
  [0, 0.28],
];

// ── The scientist's remains ─────────────────────────────────────────────────

/** The scientist's own colours, so his remains are recognisably him. */
export interface RemainsColors {
  skin: string;
  hair: string;
  coat: string;
  trousers: string;
}

const BLOOD_POOL = '#5e0f12';
const BLOOD_FRESH = '#8e1a1c';

/**
 * What her spit leaves of the scientist: the torn lab coat and the rest of him
 * in a spreading pool, his head come to rest beside it. Two tiles wide,
 * anchored at the tile he died on.
 */
export function drawScientistRemains(
  ctx: Ctx,
  ox: number,
  oy: number,
  S: number,
  colors: RemainsColors,
): void {
  const cx = ox + S * HALF;
  const cy = oy + S * REMAINS_Y;
  const rng = makeRng(REMAINS_SEED);
  ctx.fillStyle = BLOOD_POOL;
  ctx.beginPath();
  ctx.ellipse(cx, cy, S * REMAINS_POOL_RX, S * REMAINS_POOL_RY, 0, 0, TWO_PI);
  ctx.fill();
  for (let i = 0; i < REMAINS_SPATTER; i++) {
    const angle = rng() * TWO_PI;
    const reach = S * (REMAINS_POOL_RX + rng() * REMAINS_SPATTER_REACH);
    ctx.fillStyle = BLOOD_FRESH;
    ctx.beginPath();
    ctx.arc(
      cx + Math.cos(angle) * reach,
      cy + Math.sin(angle) * reach * REMAINS_SQUASH,
      S * REMAINS_SPATTER_R * (HALF + rng()),
      0,
      TWO_PI,
    );
    ctx.fill();
  }
  // Torso in the torn coat, lying on its side.
  ctx.save();
  ctx.translate(cx - S * REMAINS_TORSO_X, cy);
  ctx.rotate(REMAINS_TORSO_TILT);
  ctx.fillStyle = colors.trousers;
  ctx.fillRect(
    S * REMAINS_TORSO_W * HALF,
    -S * REMAINS_LEG_H * HALF,
    S * REMAINS_LEG_W,
    S * REMAINS_LEG_H,
  );
  ctx.fillStyle = colors.coat;
  roundRectPath(
    ctx,
    -S * REMAINS_TORSO_W * HALF,
    -S * REMAINS_TORSO_H * HALF,
    S * REMAINS_TORSO_W,
    S * REMAINS_TORSO_H,
    S * REMAINS_ROUND,
  );
  ctx.fill();
  ctx.fillStyle = BLOOD_FRESH;
  ctx.beginPath();
  ctx.ellipse(
    -S * REMAINS_TORSO_W * REMAINS_WOUND_X,
    0,
    S * REMAINS_WOUND_R,
    S * REMAINS_WOUND_R * REMAINS_SQUASH,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  ctx.strokeStyle = COCOON_SILK_DARK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(-S * REMAINS_TORSO_W * HALF, -S * REMAINS_TORSO_H * REMAINS_TEAR_Y);
  ctx.lineTo(S * REMAINS_TORSO_W * REMAINS_TEAR_X, S * REMAINS_TORSO_H * REMAINS_TEAR_Y);
  ctx.stroke();
  ctx.restore();
  // His head, off to one side.
  const headX = cx + S * REMAINS_HEAD_X;
  const headY = cy - S * REMAINS_HEAD_Y;
  ctx.fillStyle = colors.skin;
  ctx.beginPath();
  ctx.arc(headX, headY, S * REMAINS_HEAD_R, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = colors.hair;
  ctx.beginPath();
  ctx.arc(
    headX,
    headY,
    S * REMAINS_HEAD_R,
    Math.PI * REMAINS_HAIR_START,
    Math.PI * REMAINS_HAIR_END,
  );
  ctx.fill();
  ctx.fillStyle = BLOOD_FRESH;
  ctx.beginPath();
  ctx.ellipse(
    headX + S * REMAINS_HEAD_R,
    headY + S * REMAINS_NECK_Y,
    S * REMAINS_NECK_R,
    S * REMAINS_NECK_R * HALF,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
}
const REMAINS_Y = 0.62;
const REMAINS_SEED = 0x5c1;
const REMAINS_POOL_RX = 0.62;
const REMAINS_POOL_RY = 0.3;
const REMAINS_SPATTER = 9;
const REMAINS_SPATTER_REACH = 0.28;
const REMAINS_SPATTER_R = 0.035;
const REMAINS_SQUASH = 0.6;
const REMAINS_TORSO_X = 0.12;
const REMAINS_TORSO_TILT = -0.25;
const REMAINS_TORSO_W = 0.5;
const REMAINS_TORSO_H = 0.3;
const REMAINS_LEG_W = 0.34;
const REMAINS_LEG_H = 0.2;
const REMAINS_ROUND = 0.06;
const REMAINS_WOUND_X = 0.1;
const REMAINS_WOUND_R = 0.12;
const REMAINS_TEAR_Y = 0.3;
const REMAINS_TEAR_X = 0.2;
const REMAINS_HEAD_X = 0.46;
const REMAINS_HEAD_Y = 0.18;
const REMAINS_HEAD_R = 0.13;
const REMAINS_HAIR_START = 1;
const REMAINS_HAIR_END = 1.9;
const REMAINS_NECK_Y = 0.05;
const REMAINS_NECK_R = 0.08;
