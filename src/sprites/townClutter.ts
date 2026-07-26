/**
 * The town's clutter — carts, crates, barrels, troughs and yard gear. None of it
 * does anything; all of it is the difference between a yard and a rectangle of
 * gravel.
 *
 * Every piece is drawn from the anchor tile's top-left in fractions of a tile,
 * standing on the tile and reaching upward, so the scene's Y-sort puts a player
 * walking past in front of it. Nothing here reaches more than a tile and a half
 * above its own anchor, which keeps every prop inside `RenderPipeline`'s cull
 * margin without that margin having to grow.
 *
 * The palette is deliberately narrow and shared with `townPalette` where a piece
 * is made of the same timber as the benches and the notice board. The recurring
 * defect of this codebase's art has been a colour picked from memory of a
 * retired tileset, so a new tone is only introduced where a piece is genuinely
 * made of something else — iron, straw, sackcloth, coal.
 */

import { WOOD, WOOD_DARK, WOOD_LIGHT } from './townPalette';

const TWO_PI = Math.PI * 2;

/** Shared materials. */
const IRON = '#4a4640';
const IRON_LIGHT = '#6d675e';
const STONE = '#8b8578';
const STONE_DARK = '#5f5b52';
const WATER = '#4a7f96';
const WATER_LIGHT = '#7fb0c4';
const STRAW = '#c9a94e';
const STRAW_DARK = '#96792f';
const SACKCLOTH = '#b0a077';
const SACKCLOTH_DARK = '#8a7a55';
const COAL = '#2a2723';
const COAL_LIGHT = '#46413a';
const LEAF = '#6f8f45';
const BLOSSOM = '#d2687f';
const LINEN = '#dcd6c4';
const ROPE = '#a08a5e';

/** The soft contact shadow every piece of clutter sits in. */
const SHADOW_COLOR = 'rgba(0,0,0,0.24)';
const SHADOW_HALF_WIDTH = 0.34;
const SHADOW_HEIGHT = 0.08;
const SHADOW_Y = 0.9;

/**
 * Every kind of clutter the town places. A flat union rather than a hierarchy
 * because the only thing a caller ever does with one is draw it and ask whether
 * it blocks — and `Record<TownClutterKind, …>` then makes a kind with no art or
 * no walkability a compile error rather than a blank tile.
 */
export type TownClutterKind =
  | 'handcart'
  | 'wagon_wheel'
  | 'crate_stack'
  | 'barrel_stack'
  | 'sacks'
  | 'hay_bale'
  | 'water_trough'
  | 'hitching_post'
  | 'chicken_coop'
  | 'anvil_block'
  | 'coal_pile'
  | 'quench_barrel'
  | 'tool_rack'
  | 'garden_pump'
  | 'planter';

type ClutterPainter = (ctx: CanvasRenderingContext2D, sx: number, sy: number, ts: number) => void;

function shadow(ctx: CanvasRenderingContext2D, sx: number, sy: number, ts: number): void {
  ctx.fillStyle = SHADOW_COLOR;
  ctx.beginPath();
  ctx.ellipse(
    sx + ts / 2,
    sy + ts * SHADOW_Y,
    ts * SHADOW_HALF_WIDTH,
    ts * SHADOW_HEIGHT,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
}

function fillCircle(ctx: CanvasRenderingContext2D, x: number, y: number, r: number): void {
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TWO_PI);
  ctx.fill();
}

/**
 * A spoked wheel, seen side-on: the piece both the cart and the leaning wheel need.
 *
 * Each iteration strokes a full **diameter** across a half-turn sweep, so the count
 * is spoke *pairs*: six here is twelve spokes on the wheel.
 */
const WHEEL_DIAMETER_COUNT = 6;
const WHEEL_RIM_WIDTH_PX = 2;
const WHEEL_HUB_RADIUS_FRACTION = 0.2;

function drawWheel(ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number): void {
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = WHEEL_RIM_WIDTH_PX;
  for (let spoke = 0; spoke < WHEEL_DIAMETER_COUNT; spoke++) {
    const angle = (spoke / WHEEL_DIAMETER_COUNT) * Math.PI;
    ctx.beginPath();
    ctx.moveTo(cx - Math.cos(angle) * radius, cy - Math.sin(angle) * radius);
    ctx.lineTo(cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius);
    ctx.stroke();
  }
  ctx.strokeStyle = WOOD;
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, TWO_PI);
  ctx.stroke();
  ctx.fillStyle = WOOD_DARK;
  fillCircle(ctx, cx, cy, radius * WHEEL_HUB_RADIUS_FRACTION);
}

/** A barrel seen from the side, with two iron hoops. */
const BARREL_HOOP_FRACTIONS = [0.26, 0.72] as const;
const BARREL_HOOP_HEIGHT_PX = 2;
const BARREL_BULGE_PX = 2;

function drawBarrelBody(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  height: number,
): void {
  ctx.fillStyle = WOOD;
  ctx.beginPath();
  ctx.moveTo(left, top);
  ctx.quadraticCurveTo(left - BARREL_BULGE_PX, top + height / 2, left, top + height);
  ctx.lineTo(left + width, top + height);
  ctx.quadraticCurveTo(left + width + BARREL_BULGE_PX, top + height / 2, left + width, top);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = WOOD_LIGHT;
  ctx.fillRect(left, top, width, BARREL_HOOP_HEIGHT_PX);
  ctx.fillStyle = IRON;
  for (const fraction of BARREL_HOOP_FRACTIONS) {
    ctx.fillRect(left - 1, top + height * fraction, width + 2, BARREL_HOOP_HEIGHT_PX);
  }
}

const CART_BED_TOP = 0.3;
const CART_BED_HEIGHT = 0.22;
const CART_BED_INSET = 0.1;
const CART_WHEEL_CY = 0.66;
const CART_WHEEL_RADIUS = 0.2;
const CART_SHAFT_WIDTH_PX = 2;
const CART_SHAFT_END_X = 1.02;
const CART_SHAFT_END_Y = 0.44;
const CART_SIDEBOARD_HEIGHT = 0.12;

const drawHandcart: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const left = sx + ts * CART_BED_INSET;
  const width = ts * (1 - CART_BED_INSET * 2);
  const bedTop = sy + ts * CART_BED_TOP;
  const bedHeight = ts * CART_BED_HEIGHT;

  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = CART_SHAFT_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(left + width, bedTop + bedHeight / 2);
  ctx.lineTo(sx + ts * CART_SHAFT_END_X, sy + ts * CART_SHAFT_END_Y);
  ctx.stroke();

  drawWheel(ctx, sx + ts / 2, sy + ts * CART_WHEEL_CY, ts * CART_WHEEL_RADIUS);

  ctx.fillStyle = WOOD;
  ctx.fillRect(left, bedTop, width, bedHeight);
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(left, bedTop - ts * CART_SIDEBOARD_HEIGHT, width, ts * CART_SIDEBOARD_HEIGHT);
  ctx.fillStyle = WOOD_LIGHT;
  ctx.fillRect(left, bedTop, width, 1);
};

const LEANING_WHEEL_CX = 0.46;
const LEANING_WHEEL_CY = 0.56;
const LEANING_WHEEL_RADIUS = 0.36;
const LEANING_WHEEL_TILT_RAD = 0.22;

const drawWagonWheel: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  ctx.save();
  ctx.translate(sx + ts * LEANING_WHEEL_CX, sy + ts * LEANING_WHEEL_CY);
  ctx.rotate(LEANING_WHEEL_TILT_RAD);
  drawWheel(ctx, 0, 0, ts * LEANING_WHEEL_RADIUS);
  ctx.restore();
};

/** Crate faces, as [left, top, size] fractions of a tile. */
const CRATE_BOXES: ReadonlyArray<readonly [number, number, number]> = [
  [0.08, 0.5, 0.4],
  [0.5, 0.56, 0.34],
  [0.2, 0.2, 0.32],
];
const CRATE_PLANK_INSET_PX = 2;

const drawCrateStack: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  for (const [left, top, size] of CRATE_BOXES) {
    const x = sx + ts * left;
    const y = sy + ts * top;
    const s = ts * size;
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(x, y, s, s);
    ctx.fillStyle = WOOD;
    ctx.fillRect(
      x + CRATE_PLANK_INSET_PX,
      y + CRATE_PLANK_INSET_PX,
      s - CRATE_PLANK_INSET_PX * 2,
      s - CRATE_PLANK_INSET_PX * 2,
    );
    ctx.fillStyle = WOOD_LIGHT;
    ctx.fillRect(x + CRATE_PLANK_INSET_PX, y + s / 2 - 1, s - CRATE_PLANK_INSET_PX * 2, 2);
  }
};

/** Barrels, as [left, top, width, height] fractions of a tile. */
const BARREL_BODIES: ReadonlyArray<readonly [number, number, number, number]> = [
  [0.06, 0.46, 0.36, 0.44],
  [0.5, 0.5, 0.36, 0.4],
  [0.26, 0.14, 0.34, 0.36],
];

const drawBarrelStack: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  for (const [left, top, width, height] of BARREL_BODIES) {
    drawBarrelBody(ctx, sx + ts * left, sy + ts * top, ts * width, ts * height);
  }
};

/** Sacks, as [centre x, centre y, radius] fractions of a tile. */
const SACK_BODIES: ReadonlyArray<readonly [number, number, number]> = [
  [0.3, 0.68, 0.24],
  [0.68, 0.72, 0.2],
  [0.48, 0.4, 0.22],
];
const SACK_NECK_WIDTH_PX = 3;
const SACK_NECK_HEIGHT_PX = 4;

const drawSacks: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  for (const [cx, cy, radius] of SACK_BODIES) {
    const x = sx + ts * cx;
    const y = sy + ts * cy;
    const r = ts * radius;
    ctx.fillStyle = SACKCLOTH_DARK;
    ctx.beginPath();
    ctx.ellipse(x, y, r, r * 1.1, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = SACKCLOTH;
    ctx.beginPath();
    ctx.ellipse(x, y, r * 0.78, r * 0.9, 0, 0, TWO_PI);
    ctx.fill();
    ctx.fillStyle = SACKCLOTH_DARK;
    ctx.fillRect(
      x - SACK_NECK_WIDTH_PX / 2,
      y - r * 1.1 - SACK_NECK_HEIGHT_PX + 1,
      SACK_NECK_WIDTH_PX,
      SACK_NECK_HEIGHT_PX,
    );
  }
};

const BALE_LEFT = 0.1;
const BALE_TOP = 0.34;
const BALE_WIDTH = 0.8;
const BALE_HEIGHT = 0.54;
const BALE_STRAW_LINES = 5;
const BALE_TWINE_FRACTIONS = [0.32, 0.68] as const;
const BALE_TWINE_WIDTH_PX = 2;

const drawHayBale: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const left = sx + ts * BALE_LEFT;
  const top = sy + ts * BALE_TOP;
  const width = ts * BALE_WIDTH;
  const height = ts * BALE_HEIGHT;
  ctx.fillStyle = STRAW_DARK;
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = STRAW;
  ctx.fillRect(left + 1, top + 1, width - 2, height - 2);
  ctx.fillStyle = STRAW_DARK;
  for (let line = 1; line <= BALE_STRAW_LINES; line++) {
    const y = top + (height * line) / (BALE_STRAW_LINES + 1);
    ctx.fillRect(left + 2, y, width - 4, 1);
  }
  ctx.fillStyle = ROPE;
  for (const fraction of BALE_TWINE_FRACTIONS) {
    ctx.fillRect(left + width * fraction, top, BALE_TWINE_WIDTH_PX, height);
  }
};

const TROUGH_LEFT = 0.06;
const TROUGH_TOP = 0.42;
const TROUGH_WIDTH = 0.88;
const TROUGH_HEIGHT = 0.44;
const TROUGH_WALL_PX = 3;

const drawWaterTrough: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const left = sx + ts * TROUGH_LEFT;
  const top = sy + ts * TROUGH_TOP;
  const width = ts * TROUGH_WIDTH;
  const height = ts * TROUGH_HEIGHT;
  ctx.fillStyle = STONE_DARK;
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = STONE;
  ctx.fillRect(left, top, width, TROUGH_WALL_PX);
  ctx.fillStyle = WATER;
  ctx.fillRect(
    left + TROUGH_WALL_PX,
    top + TROUGH_WALL_PX,
    width - TROUGH_WALL_PX * 2,
    height - TROUGH_WALL_PX * 2,
  );
  ctx.fillStyle = WATER_LIGHT;
  ctx.fillRect(left + TROUGH_WALL_PX * 2, top + TROUGH_WALL_PX + 1, width * 0.3, 1);
};

const HITCH_POST_TOP = 0.18;
const HITCH_POST_BOTTOM = 0.88;
const HITCH_POST_WIDTH_PX = 4;
const HITCH_RING_CY = 0.3;
const HITCH_RING_RADIUS_PX = 3;
const HITCH_ROPE_END_X = 0.86;
const HITCH_ROPE_END_Y = 0.82;
const HITCH_ROPE_WIDTH_PX = 1;

const drawHitchingPost: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const cx = sx + ts * 0.34;
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(
    cx - HITCH_POST_WIDTH_PX / 2,
    sy + ts * HITCH_POST_TOP,
    HITCH_POST_WIDTH_PX,
    ts * (HITCH_POST_BOTTOM - HITCH_POST_TOP),
  );
  ctx.fillStyle = WOOD;
  ctx.fillRect(
    cx - HITCH_POST_WIDTH_PX / 2,
    sy + ts * HITCH_POST_TOP,
    1,
    ts * (HITCH_POST_BOTTOM - HITCH_POST_TOP),
  );
  ctx.strokeStyle = IRON_LIGHT;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(cx, sy + ts * HITCH_RING_CY, HITCH_RING_RADIUS_PX, 0, TWO_PI);
  ctx.stroke();
  // A rope trailing to the ground, so the post reads as in use rather than as a
  // stray stake — the same complaint the town's lone gate cheeks drew.
  ctx.strokeStyle = ROPE;
  ctx.lineWidth = HITCH_ROPE_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(cx, sy + ts * HITCH_RING_CY + HITCH_RING_RADIUS_PX);
  ctx.quadraticCurveTo(
    sx + ts * 0.6,
    sy + ts * 0.78,
    sx + ts * HITCH_ROPE_END_X,
    sy + ts * HITCH_ROPE_END_Y,
  );
  ctx.stroke();
};

const COOP_LEFT = 0.1;
const COOP_BODY_TOP = 0.44;
const COOP_WIDTH = 0.8;
const COOP_BODY_HEIGHT = 0.44;
const COOP_ROOF_TOP = 0.2;
const COOP_ROOF_OVERHANG = 0.06;
const COOP_DOOR_WIDTH = 0.2;
const COOP_DOOR_HEIGHT = 0.24;
const COOP_MESH_STEP_PX = 4;

const drawChickenCoop: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const left = sx + ts * COOP_LEFT;
  const width = ts * COOP_WIDTH;
  const bodyTop = sy + ts * COOP_BODY_TOP;
  const bodyHeight = ts * COOP_BODY_HEIGHT;

  ctx.fillStyle = WOOD;
  ctx.fillRect(left, bodyTop, width, bodyHeight);
  ctx.fillStyle = WOOD_DARK;
  ctx.beginPath();
  ctx.moveTo(left - ts * COOP_ROOF_OVERHANG, bodyTop);
  ctx.lineTo(left + width + ts * COOP_ROOF_OVERHANG, bodyTop);
  ctx.lineTo(sx + ts / 2, sy + ts * COOP_ROOF_TOP);
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = COAL;
  const doorX = left + width - ts * COOP_DOOR_WIDTH - 2;
  ctx.fillRect(
    doorX,
    bodyTop + bodyHeight - ts * COOP_DOOR_HEIGHT,
    ts * COOP_DOOR_WIDTH,
    ts * COOP_DOOR_HEIGHT,
  );

  ctx.strokeStyle = IRON_LIGHT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = left + COOP_MESH_STEP_PX; x < doorX - 1; x += COOP_MESH_STEP_PX) {
    ctx.moveTo(x, bodyTop + 2);
    ctx.lineTo(x, bodyTop + bodyHeight - 2);
  }
  ctx.stroke();
};

const ANVIL_STUMP_TOP = 0.6;
const ANVIL_STUMP_HALF = 0.22;
const ANVIL_STUMP_HEIGHT = 0.3;
const ANVIL_FACE_TOP = 0.42;
const ANVIL_FACE_HEIGHT = 0.1;
const ANVIL_FACE_HALF = 0.24;
const ANVIL_HORN_REACH = 0.4;
const ANVIL_WAIST_HALF = 0.08;

const drawAnvilBlock: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const cx = sx + ts / 2;
  const stumpTop = sy + ts * ANVIL_STUMP_TOP;
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(
    cx - ts * ANVIL_STUMP_HALF,
    stumpTop,
    ts * ANVIL_STUMP_HALF * 2,
    ts * ANVIL_STUMP_HEIGHT,
  );
  ctx.fillStyle = WOOD;
  ctx.fillRect(cx - ts * ANVIL_STUMP_HALF, stumpTop, ts * ANVIL_STUMP_HALF * 2, 2);

  const faceTop = sy + ts * ANVIL_FACE_TOP;
  const faceBottom = faceTop + ts * ANVIL_FACE_HEIGHT;
  ctx.fillStyle = IRON;
  ctx.beginPath();
  ctx.moveTo(cx - ts * ANVIL_FACE_HALF, faceTop);
  ctx.lineTo(cx + ts * ANVIL_FACE_HALF, faceTop);
  ctx.quadraticCurveTo(cx + ts * ANVIL_HORN_REACH, faceTop, cx + ts * ANVIL_HORN_REACH, faceBottom);
  ctx.lineTo(cx + ts * ANVIL_WAIST_HALF, faceBottom);
  ctx.lineTo(cx + ts * ANVIL_WAIST_HALF, stumpTop);
  ctx.lineTo(cx - ts * ANVIL_WAIST_HALF, stumpTop);
  ctx.lineTo(cx - ts * ANVIL_WAIST_HALF, faceBottom);
  ctx.lineTo(cx - ts * ANVIL_FACE_HALF, faceBottom);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(cx - ts * ANVIL_FACE_HALF, faceTop, ts * ANVIL_FACE_HALF * 2, 1);
};

/**
 * A heap of coal: a flat mound with lumps breaking its top edge.
 *
 * Wider than it is tall, and the lumps sit *on* the mound rather than inside it.
 * A first cut stacked four overlapping discs of similar size, which merged into
 * one circle and read as a cannonball — a pile is recognised by its silhouette
 * being flat-bottomed and ragged on top, not by being dark.
 */
const COAL_MOUND_CY = 0.76;
const COAL_MOUND_RX = 0.42;
const COAL_MOUND_RY = 0.2;
/** Lumps on the heap, as [centre x, centre y, radius] fractions of a tile. */
const COAL_LUMPS: ReadonlyArray<readonly [number, number, number]> = [
  [0.24, 0.66, 0.1],
  [0.44, 0.58, 0.12],
  [0.64, 0.63, 0.09],
  [0.78, 0.7, 0.07],
];
const COAL_GLINT_OFFSET = 0.32;
const COAL_GLINT_RADIUS_FRACTION = 0.3;

const drawCoalPile: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  ctx.fillStyle = COAL;
  ctx.beginPath();
  ctx.ellipse(
    sx + ts / 2,
    sy + ts * COAL_MOUND_CY,
    ts * COAL_MOUND_RX,
    ts * COAL_MOUND_RY,
    0,
    0,
    TWO_PI,
  );
  ctx.fill();
  for (const [cx, cy, radius] of COAL_LUMPS) {
    fillCircle(ctx, sx + ts * cx, sy + ts * cy, ts * radius);
  }
  ctx.fillStyle = COAL_LIGHT;
  for (const [cx, cy, radius] of COAL_LUMPS) {
    fillCircle(
      ctx,
      sx + ts * (cx - radius * COAL_GLINT_OFFSET),
      sy + ts * (cy - radius * COAL_GLINT_OFFSET),
      ts * radius * COAL_GLINT_RADIUS_FRACTION,
    );
  }
};

const QUENCH_LEFT = 0.2;
const QUENCH_TOP = 0.42;
const QUENCH_WIDTH = 0.56;
const QUENCH_HEIGHT = 0.46;
const STEAM_WISPS = 3;
const STEAM_RISE = 0.34;
const STEAM_RADIUS_PX = 3;
const STEAM_COLOR = 'rgba(230, 235, 238, 0.4)';

const drawQuenchBarrel: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const left = sx + ts * QUENCH_LEFT;
  const top = sy + ts * QUENCH_TOP;
  drawBarrelBody(ctx, left, top, ts * QUENCH_WIDTH, ts * QUENCH_HEIGHT);
  ctx.fillStyle = WATER;
  ctx.fillRect(left + 2, top + 1, ts * QUENCH_WIDTH - 4, 3);
  ctx.fillStyle = STEAM_COLOR;
  for (let wisp = 0; wisp < STEAM_WISPS; wisp++) {
    const along = (wisp + 1) / (STEAM_WISPS + 1);
    fillCircle(
      ctx,
      left + ts * QUENCH_WIDTH * along,
      top - ts * STEAM_RISE * (0.4 + along * 0.6),
      STEAM_RADIUS_PX,
    );
  }
};

const RACK_LEFT = 0.12;
const RACK_TOP = 0.24;
const RACK_WIDTH = 0.76;
const RACK_HEIGHT = 0.62;
const RACK_FRAME_PX = 3;
/** Tool heads hanging on the rack, as [x fraction, head colour]. */
const RACK_TOOLS: ReadonlyArray<readonly [number, string]> = [
  [0.28, IRON],
  [0.5, IRON_LIGHT],
  [0.72, IRON],
];
const RACK_TOOL_SHAFT_WIDTH_PX = 2;
const RACK_TOOL_HEAD_WIDTH_PX = 6;
const RACK_TOOL_HEAD_HEIGHT_PX = 4;

const drawToolRack: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const left = sx + ts * RACK_LEFT;
  const top = sy + ts * RACK_TOP;
  const width = ts * RACK_WIDTH;
  const height = ts * RACK_HEIGHT;
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(left, top, width, RACK_FRAME_PX);
  ctx.fillRect(left, top, RACK_FRAME_PX, height);
  ctx.fillRect(left + width - RACK_FRAME_PX, top, RACK_FRAME_PX, height);
  for (const [along, headColor] of RACK_TOOLS) {
    const x = left + width * along;
    ctx.fillStyle = WOOD;
    ctx.fillRect(x - RACK_TOOL_SHAFT_WIDTH_PX / 2, top, RACK_TOOL_SHAFT_WIDTH_PX, height * 0.8);
    ctx.fillStyle = headColor;
    ctx.fillRect(
      x - RACK_TOOL_HEAD_WIDTH_PX / 2,
      top + height * 0.8 - RACK_TOOL_HEAD_HEIGHT_PX,
      RACK_TOOL_HEAD_WIDTH_PX,
      RACK_TOOL_HEAD_HEIGHT_PX,
    );
  }
};

const PUMP_BASE_TOP = 0.66;
const PUMP_BASE_HALF = 0.26;
const PUMP_BASE_HEIGHT = 0.22;
const PUMP_COLUMN_TOP = 0.18;
const PUMP_COLUMN_WIDTH_PX = 4;
const PUMP_SPOUT_Y = 0.36;
const PUMP_SPOUT_REACH = 0.22;
const PUMP_SPOUT_WIDTH_PX = 3;
const PUMP_HANDLE_Y = 0.24;
const PUMP_HANDLE_REACH = 0.24;
const PUMP_HANDLE_WIDTH_PX = 3;

const drawGardenPump: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const cx = sx + ts * 0.44;
  ctx.fillStyle = STONE_DARK;
  ctx.fillRect(
    cx - ts * PUMP_BASE_HALF,
    sy + ts * PUMP_BASE_TOP,
    ts * PUMP_BASE_HALF * 2,
    ts * PUMP_BASE_HEIGHT,
  );
  ctx.fillStyle = WATER;
  ctx.fillRect(
    cx - ts * PUMP_BASE_HALF + 2,
    sy + ts * PUMP_BASE_TOP + 2,
    ts * PUMP_BASE_HALF * 2 - 4,
    3,
  );

  ctx.fillStyle = IRON;
  ctx.fillRect(
    cx - PUMP_COLUMN_WIDTH_PX / 2,
    sy + ts * PUMP_COLUMN_TOP,
    PUMP_COLUMN_WIDTH_PX,
    ts * (PUMP_BASE_TOP - PUMP_COLUMN_TOP),
  );
  ctx.fillRect(cx, sy + ts * PUMP_SPOUT_Y, ts * PUMP_SPOUT_REACH, PUMP_SPOUT_WIDTH_PX);
  ctx.fillStyle = IRON_LIGHT;
  ctx.fillRect(
    cx - ts * PUMP_HANDLE_REACH,
    sy + ts * PUMP_HANDLE_Y,
    ts * PUMP_HANDLE_REACH,
    PUMP_HANDLE_WIDTH_PX,
  );
};

const PLANTER_LEFT = 0.12;
const PLANTER_TOP = 0.6;
const PLANTER_WIDTH = 0.76;
const PLANTER_HEIGHT = 0.28;
const PLANTER_RIM_PX = 2;
/** Foliage, as [x fraction, y fraction, radius fraction] of a tile. */
const PLANTER_FOLIAGE: ReadonlyArray<readonly [number, number, number]> = [
  [0.28, 0.5, 0.16],
  [0.5, 0.42, 0.18],
  [0.72, 0.52, 0.15],
];
const PLANTER_BLOSSOM_RADIUS_PX = 2;

const drawPlanter: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  for (const [cx, cy, radius] of PLANTER_FOLIAGE) {
    ctx.fillStyle = LEAF;
    fillCircle(ctx, sx + ts * cx, sy + ts * cy, ts * radius);
  }
  for (const [cx, cy, radius] of PLANTER_FOLIAGE) {
    ctx.fillStyle = BLOSSOM;
    fillCircle(ctx, sx + ts * cx, sy + ts * (cy - radius * 0.5), PLANTER_BLOSSOM_RADIUS_PX);
  }
  const left = sx + ts * PLANTER_LEFT;
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(left, sy + ts * PLANTER_TOP, ts * PLANTER_WIDTH, ts * PLANTER_HEIGHT);
  ctx.fillStyle = WOOD;
  ctx.fillRect(left, sy + ts * PLANTER_TOP, ts * PLANTER_WIDTH, PLANTER_RIM_PX);
};

/**
 * Every piece, keyed by the union. A `Record` rather than a switch, so a kind
 * added without art fails to compile.
 */
const CLUTTER_PAINTERS: Record<TownClutterKind, ClutterPainter> = {
  handcart: drawHandcart,
  wagon_wheel: drawWagonWheel,
  crate_stack: drawCrateStack,
  barrel_stack: drawBarrelStack,
  sacks: drawSacks,
  hay_bale: drawHayBale,
  water_trough: drawWaterTrough,
  hitching_post: drawHitchingPost,
  chicken_coop: drawChickenCoop,
  anvil_block: drawAnvilBlock,
  coal_pile: drawCoalPile,
  quench_barrel: drawQuenchBarrel,
  tool_rack: drawToolRack,
  garden_pump: drawGardenPump,
  planter: drawPlanter,
};

/** Draws one piece of clutter standing on the tile whose top-left is (sx, sy). */
export function drawTownClutter(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  kind: TownClutterKind,
): void {
  // Several painters set `lineWidth` and `lineCap`; props render back to back
  // with no reset between them, so each one restores what it touched.
  ctx.save();
  CLUTTER_PAINTERS[kind](ctx, sx, sy, ts);
  ctx.restore();
}

/**
 * A laundry line strung between two points, sagging under wet linen.
 *
 * Not part of the clutter record because it is the one prop that is not a thing
 * standing on a tile: it spans the gap between two, and its anchor tile is only
 * one end of it. It is drawn from the same module because it is made of the same
 * rope and hangs in the same alleys.
 */
const LINE_SAG_FRACTION = 0.22;
const LINE_HEIGHT = -1.1;
const LINE_WIDTH_PX = 1;
const SHEETS_PER_LINE = 4;
const SHEET_WIDTH = 0.22;
const SHEET_HEIGHT = 0.5;
const SHEET_HEM_PX = 2;
/** How far a sheet's own sway lags the one before it, in radians. */
const SHEET_SWAY_PHASE_STRIDE_RAD = 0.9;
const SHEET_SWAY_PERIOD_FRAMES = 130;
const SHEET_SWAY_AMPLITUDE_RAD = 0.07;
/**
 * The poles the line is strung between.
 *
 * Drawn rather than assumed: the alleys' flanking ground is verge and street, not
 * a building wall, so with nothing at the ends the rope read as trailing off into
 * the open — which is exactly what the placement doc used to claim it did not.
 */
const LINE_POLE_WIDTH_PX = 2;
const LINE_POLE_FOOT = 0.42;

export function drawLaundryLine(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  spanTiles: number,
  frame: number,
): void {
  ctx.save();
  const startX = sx + ts / 2;
  const endX = startX + ts * spanTiles;
  const lineY = sy + ts * LINE_HEIGHT;
  // The control point is twice the sag below the ends, because a quadratic
  // Bézier's midpoint sits halfway to its control point — so the rope's deepest
  // point lands exactly `LINE_SAG_FRACTION` of a tile below the line.
  const controlY = lineY + ts * LINE_SAG_FRACTION * 2;

  // Two explicit draws rather than iterating a literal: `[startX, endX]` depends
  // on the arguments so it cannot be hoisted to a constant, and this runs once per
  // line per frame.
  const poleTop = lineY;
  const poleHeight = sy + ts * LINE_POLE_FOOT - lineY;
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(startX - LINE_POLE_WIDTH_PX / 2, poleTop, LINE_POLE_WIDTH_PX, poleHeight);
  ctx.fillRect(endX - LINE_POLE_WIDTH_PX / 2, poleTop, LINE_POLE_WIDTH_PX, poleHeight);

  ctx.strokeStyle = ROPE;
  ctx.lineWidth = LINE_WIDTH_PX;
  ctx.beginPath();
  ctx.moveTo(startX, lineY);
  ctx.quadraticCurveTo((startX + endX) / 2, controlY, endX, lineY);
  ctx.stroke();

  for (let sheet = 0; sheet < SHEETS_PER_LINE; sheet++) {
    const along = (sheet + 1) / (SHEETS_PER_LINE + 1);
    const x = startX + (endX - startX) * along;
    // The rope's own quadratic, evaluated so a sheet hangs from the line rather
    // than from the chord between its ends.
    const hangY =
      (1 - along) * (1 - along) * lineY +
      2 * (1 - along) * along * controlY +
      along * along * lineY;
    const sway =
      Math.sin((frame / SHEET_SWAY_PERIOD_FRAMES) * TWO_PI + sheet * SHEET_SWAY_PHASE_STRIDE_RAD) *
      SHEET_SWAY_AMPLITUDE_RAD;
    ctx.save();
    ctx.translate(x, hangY);
    ctx.rotate(sway);
    ctx.fillStyle = LINEN;
    ctx.fillRect(-ts * SHEET_WIDTH * 0.5, 0, ts * SHEET_WIDTH, ts * SHEET_HEIGHT);
    ctx.fillStyle = SACKCLOTH_DARK;
    ctx.fillRect(
      -ts * SHEET_WIDTH * 0.5,
      ts * SHEET_HEIGHT - SHEET_HEM_PX,
      ts * SHEET_WIDTH,
      SHEET_HEM_PX,
    );
    ctx.restore();
  }
  ctx.restore();
}
