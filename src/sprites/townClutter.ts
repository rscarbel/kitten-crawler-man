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
import { rgb } from './art/town/townArt';
import { getTownRamp } from './art/town/townPalette';

const TWO_PI = Math.PI * 2;

/**
 * Shared materials, from the town's own `iron_black`/`oc_stone` ramps
 * (`src/sprites/art/town/townPalette.ts`) — cool and always darkened for
 * iron, quarried ashlar for stone, so a hitching post's hardware and an
 * anvil block match the buildings behind them.
 */
const OC_IRON = getTownRamp('iron_black');
const OC_STONE = getTownRamp('oc_stone');
const IRON = rgb(OC_IRON.mid);
const IRON_LIGHT = rgb(OC_IRON.light);
const STONE = rgb(OC_STONE.mid);
const STONE_DARK = rgb(OC_STONE.shadow);
const WATER = '#4a7f96';
const WATER_LIGHT = '#7fb0c4';
const STRAW = '#c9a94e';
const STRAW_DARK = '#96792f';
const SACKCLOTH = '#b0a077';
const SACKCLOTH_DARK = '#8a7a55';
const COAL = '#2a2723';
const COAL_LIGHT = '#46413a';
const LEAF = '#6f8f45';
const LEAF_DARK = '#4d6930';
const BLOSSOM = '#d2687f';
const LINEN = '#dcd6c4';
const ROPE = '#a08a5e';
const SOIL = '#5a4632';
const SOIL_DARK = '#3f3123';
const VEG_ROOT = '#c9762f';
const VEG_LEAF_LIGHT = '#8ab35c';

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
/**
 * The kinds in the order their art occupies frames of `town_clutter.png`.
 *
 * The union is derived from this array rather than declared beside it because
 * the sheet is addressed by frame index: a kind that existed only in the union
 * would have no frame, and one listed only here would have no painter. Deriving
 * makes both halves impossible to get out of step, and appending is the only
 * safe edit — reordering repoints every baked frame at the wrong picture.
 */
export const TOWN_CLUTTER_KINDS = [
  'handcart',
  'wagon_wheel',
  'crate_stack',
  'barrel_stack',
  'sacks',
  'hay_bale',
  'water_trough',
  'hitching_post',
  'chicken_coop',
  'anvil_block',
  'coal_pile',
  'quench_barrel',
  'tool_rack',
  'garden_pump',
  'planter',
  'hay_rack',
  'vegetable_row',
  'herb_rack',
  'timber_stack',
  'feed_bin',
  'milking_stool',
  'drill_pell',
  'garden_bench',
  'street_tree',
  'birdbath',
  'hedge_row',
  'weapon_rack',
  'grain_bin',
] as const;

export type TownClutterKind = (typeof TOWN_CLUTTER_KINDS)[number];

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
 * Wider than it is tall, and the lumps sit *on* the mound rather than inside
 * it — overlapping discs of similar size merge into one circle and read as a
 * cannonball, while a pile is recognised by its silhouette being flat-bottomed
 * and ragged on top, not by being dark.
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

const RACK_POST_TOP = 0.2;
const RACK_POST_BOTTOM = 0.9;
const RACK_POST_WIDTH_PX = 3;
const RACK_POST_INSET = 0.1;
const RACK_RAIL_FRACTIONS = [0.34, 0.56] as const;
const RACK_RAIL_HEIGHT_PX = 2;
/** How far the loose straw tufts poke above the top rail. */
const RACK_TUFT_TOP = 0.14;
const RACK_TUFT_COUNT = 5;

/**
 * A hay rack: two posts, two crossbars, and loose straw resting in the frame —
 * fodder kept up off the ground, rather than a loose bale dropped on it.
 */
const drawHayRack: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const left = sx + ts * RACK_POST_INSET;
  const right = sx + ts * (1 - RACK_POST_INSET);
  const top = sy + ts * RACK_POST_TOP;
  const bottom = sy + ts * RACK_POST_BOTTOM;
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(left, top, RACK_POST_WIDTH_PX, bottom - top);
  ctx.fillRect(right - RACK_POST_WIDTH_PX, top, RACK_POST_WIDTH_PX, bottom - top);
  ctx.fillStyle = WOOD;
  for (const fraction of RACK_RAIL_FRACTIONS) {
    const railY = sy + ts * fraction;
    ctx.fillRect(left, railY, right - left, RACK_RAIL_HEIGHT_PX);
  }
  ctx.fillStyle = STRAW;
  for (let tuft = 0; tuft < RACK_TUFT_COUNT; tuft++) {
    const tx = left + ((right - left) * (tuft + 0.5)) / RACK_TUFT_COUNT;
    const tuftTop = sy + ts * (RACK_TUFT_TOP + (tuft % 2) * 0.03);
    const tuftBottom = sy + ts * RACK_RAIL_FRACTIONS[1];
    ctx.fillStyle = tuft % 2 === 0 ? STRAW : STRAW_DARK;
    ctx.fillRect(tx - 1, tuftTop, 2, tuftBottom - tuftTop);
  }
};

/**
 * A kitchen-garden bed: soil rows behind a dressed-stone kerb, each row staked
 * with a plant marker. The kerb is what keeps this reading as a tended plot
 * inside a stone-and-plaster town rather than a bare patch of dirt — the same
 * edging a planter box gives its own foliage.
 */
const ROW_BED_LEFT = 0.06;
const ROW_BED_TOP = 0.5;
const ROW_BED_WIDTH = 0.88;
const ROW_BED_HEIGHT = 0.34;
const ROW_KERB_PX = 3;
const ROW_COUNT = 3;
const ROW_STAKE_HEIGHT_PX = 5;

const drawVegetableRow: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const left = sx + ts * ROW_BED_LEFT;
  const top = sy + ts * ROW_BED_TOP;
  const width = ts * ROW_BED_WIDTH;
  const height = ts * ROW_BED_HEIGHT;
  ctx.fillStyle = STONE_DARK;
  ctx.fillRect(left - ROW_KERB_PX, top - ROW_KERB_PX, width + ROW_KERB_PX * 2, ROW_KERB_PX);
  ctx.fillStyle = STONE;
  ctx.fillRect(left - ROW_KERB_PX, top - ROW_KERB_PX, ROW_KERB_PX, height + ROW_KERB_PX * 2);
  ctx.fillRect(left + width, top - ROW_KERB_PX, ROW_KERB_PX, height + ROW_KERB_PX * 2);
  ctx.fillStyle = SOIL;
  ctx.fillRect(left, top, width, height);
  for (let row = 0; row < ROW_COUNT; row++) {
    const rowY = top + (height * (row + 0.5)) / ROW_COUNT;
    ctx.fillStyle = SOIL_DARK;
    ctx.fillRect(left, rowY, width, 1);
    const leafColor = row % 2 === 0 ? LEAF : VEG_LEAF_LIGHT;
    for (let plant = 0; plant < 3; plant++) {
      const plantX = left + (width * (plant + 0.5)) / 3;
      ctx.fillStyle = leafColor;
      fillCircle(ctx, plantX, rowY - 1, 2.2);
      ctx.fillStyle = VEG_ROOT;
      ctx.fillRect(plantX - 0.5, rowY, 1, 1.5);
    }
  }
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(left + 2, top);
  ctx.lineTo(left + 2, top - ROW_STAKE_HEIGHT_PX);
  ctx.stroke();
};

/** A wall-mounted rack of drying herb bundles over a small mortar shelf. */
const HERB_RACK_LEFT = 0.14;
const HERB_RACK_TOP = 0.16;
const HERB_RACK_WIDTH = 0.72;
const HERB_SHELF_HEIGHT_PX = 3;
const HERB_BUNDLES = 4;
const HERB_BUNDLE_DROP = 0.32;
const HERB_BUNDLE_COLORS = [LEAF, LEAF_DARK, VEG_LEAF_LIGHT, LEAF] as const;

const drawHerbRack: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const left = sx + ts * HERB_RACK_LEFT;
  const width = ts * HERB_RACK_WIDTH;
  const shelfY = sy + ts * HERB_RACK_TOP;
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(left, shelfY, width, HERB_SHELF_HEIGHT_PX);
  ctx.fillStyle = IRON;
  ctx.fillRect(left - 1, shelfY - 1, 2, ts * 0.1);
  ctx.fillRect(left + width - 1, shelfY - 1, 2, ts * 0.1);
  for (let bundle = 0; bundle < HERB_BUNDLES; bundle++) {
    const bx = left + (width * (bundle + 0.5)) / HERB_BUNDLES;
    const topY = shelfY + HERB_SHELF_HEIGHT_PX;
    const bottomY = topY + ts * HERB_BUNDLE_DROP;
    ctx.strokeStyle = ROPE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(bx, topY);
    ctx.lineTo(bx, bottomY - 2);
    ctx.stroke();
    ctx.fillStyle = HERB_BUNDLE_COLORS[bundle % HERB_BUNDLE_COLORS.length];
    ctx.beginPath();
    ctx.moveTo(bx, bottomY - 2);
    ctx.lineTo(bx - 3, bottomY + 4);
    ctx.lineTo(bx + 3, bottomY + 4);
    ctx.closePath();
    ctx.fill();
  }
  // A mortar on the ground below breaks the rack's own symmetry, so it reads as
  // apothecary stock rather than a gateway.
  const mortarCx = left + width * 0.5;
  const mortarY = sy + ts * 0.86;
  ctx.fillStyle = STONE;
  ctx.beginPath();
  ctx.ellipse(mortarCx, mortarY, ts * 0.1, ts * 0.05, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = STONE_DARK;
  ctx.beginPath();
  ctx.ellipse(mortarCx, mortarY - 1, ts * 0.07, ts * 0.03, 0, 0, TWO_PI);
  ctx.fill();
};

/** Squared, stacked timber with a sawhorse — a builder's neat stock, not a woodpile. */
const STACK_LEFT = 0.08;
const STACK_TOP = 0.56;
const STACK_WIDTH = 0.5;
const STACK_BEAM_HEIGHT_PX = 4;
const STACK_BEAMS = 3;
const HORSE_LEFT = 0.62;
const HORSE_TOP_Y = 0.58;
const HORSE_LEG_SPAN = 0.16;
const HORSE_LEG_HEIGHT = 0.28;

const drawTimberStack: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const left = sx + ts * STACK_LEFT;
  const width = ts * STACK_WIDTH;
  let beamY = sy + ts * STACK_TOP;
  for (let beam = 0; beam < STACK_BEAMS; beam++) {
    beamY -= STACK_BEAM_HEIGHT_PX;
    ctx.fillStyle = beam % 2 === 0 ? WOOD : WOOD_LIGHT;
    ctx.fillRect(left, beamY, width, STACK_BEAM_HEIGHT_PX - 1);
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(left, beamY, width, 1);
    ctx.fillRect(left + width - 3, beamY, 3, STACK_BEAM_HEIGHT_PX - 1);
  }
  const hx = sx + ts * HORSE_LEFT;
  const hy = sy + ts * HORSE_TOP_Y;
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(hx, hy);
  ctx.lineTo(hx + ts * (STACK_WIDTH - 0.06), hy - ts * 0.04);
  ctx.stroke();
  for (const along of [0.15, 0.5, 0.85]) {
    const legX = hx + ts * (STACK_WIDTH - 0.06) * along;
    ctx.beginPath();
    ctx.moveTo(legX - ts * HORSE_LEG_SPAN * 0.5, hy - ts * 0.02 + ts * HORSE_LEG_HEIGHT);
    ctx.lineTo(legX, hy);
    ctx.lineTo(legX + ts * HORSE_LEG_SPAN * 0.5, hy - ts * 0.02 + ts * HORSE_LEG_HEIGHT);
    ctx.stroke();
  }
};

/** A stone-plinthed, iron-banded feed bin with a hinged plank lid. */
const BIN_LEFT = 0.2;
const BIN_TOP = 0.44;
const BIN_WIDTH = 0.6;
const BIN_HEIGHT = 0.42;
const BIN_BAND_FRACTIONS = [0.3, 0.7] as const;

const drawFeedBin: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const left = sx + ts * BIN_LEFT;
  const top = sy + ts * BIN_TOP;
  const width = ts * BIN_WIDTH;
  const height = ts * BIN_HEIGHT;
  ctx.fillStyle = STONE_DARK;
  ctx.fillRect(left - 2, top + height, width + 4, 3);
  ctx.fillStyle = WOOD;
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = WOOD_DARK;
  for (const fraction of BIN_BAND_FRACTIONS) {
    ctx.fillRect(left, top + height * fraction, width, 2);
  }
  ctx.fillStyle = WOOD_LIGHT;
  ctx.fillRect(left, top - 3, width, 3);
  ctx.fillStyle = IRON;
  ctx.fillRect(left + width * 0.42, top - 3, 3, 3);
};

/** A three-legged stool and an iron-banded pail — Wendell's dairy tools, neatly kept. */
const STOOL_SEAT_Y = 0.6;
const STOOL_SEAT_HALF = 0.16;
const STOOL_LEG_SPREAD = 0.14;
const STOOL_LEG_DROP = 0.24;
const PAIL_LEFT = 0.56;
const PAIL_TOP = 0.5;
const PAIL_WIDTH = 0.3;
const PAIL_HEIGHT = 0.3;

const drawMilkingStool: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const cx = sx + ts * 0.28;
  const seatY = sy + ts * STOOL_SEAT_Y;
  ctx.fillStyle = WOOD;
  ctx.fillRect(cx - ts * STOOL_SEAT_HALF, seatY, ts * STOOL_SEAT_HALF * 2, 3);
  ctx.strokeStyle = WOOD_DARK;
  ctx.lineWidth = 2;
  for (const dir of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + dir * ts * STOOL_LEG_SPREAD, seatY + ts * STOOL_LEG_DROP);
    ctx.lineTo(cx + dir * ts * STOOL_LEG_SPREAD * 0.3, seatY + 2);
    ctx.stroke();
  }
  const pailLeft = sx + ts * PAIL_LEFT;
  const pailTop = sy + ts * PAIL_TOP;
  const pailWidth = ts * PAIL_WIDTH;
  const pailHeight = ts * PAIL_HEIGHT;
  ctx.fillStyle = IRON_LIGHT;
  ctx.beginPath();
  ctx.moveTo(pailLeft, pailTop);
  ctx.lineTo(pailLeft + pailWidth, pailTop);
  ctx.lineTo(pailLeft + pailWidth - 2, pailTop + pailHeight);
  ctx.lineTo(pailLeft + 2, pailTop + pailHeight);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = IRON;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.arc(pailLeft + pailWidth / 2, pailTop - 1, pailWidth / 2 - 1, Math.PI, TWO_PI);
  ctx.stroke();
};

/** A drill-yard pell: a padded post on an iron collar, ringed with practice bands. */
const PELL_TOP = 0.16;
const PELL_BOTTOM = 0.9;
const PELL_WIDTH_PX = 6;
const PELL_COLLAR_FRACTIONS = [0.3, 0.5, 0.7] as const;

const drawDrillPell: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const cx = sx + ts / 2;
  const top = sy + ts * PELL_TOP;
  const bottom = sy + ts * PELL_BOTTOM;
  ctx.fillStyle = STONE_DARK;
  ctx.beginPath();
  ctx.ellipse(cx, bottom, ts * 0.16, ts * 0.05, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = WOOD;
  ctx.fillRect(cx - PELL_WIDTH_PX / 2, top, PELL_WIDTH_PX, bottom - top);
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(cx - PELL_WIDTH_PX / 2, top, 1, bottom - top);
  for (const fraction of PELL_COLLAR_FRACTIONS) {
    ctx.fillStyle = IRON;
    ctx.fillRect(cx - PELL_WIDTH_PX / 2 - 1, sy + ts * fraction, PELL_WIDTH_PX + 2, 2);
  }
};

/** A stone-slab bench on iron legs — the town's own civic seating, in a smaller yard size. */
const BENCH_LEFT = 0.06;
const BENCH_TOP = 0.62;
const BENCH_WIDTH = 0.88;
const BENCH_SEAT_HEIGHT_PX = 4;
const BENCH_LEG_INSET = 0.1;
const BENCH_LEG_HEIGHT_PX = 6;

const drawGardenBench: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const left = sx + ts * BENCH_LEFT;
  const width = ts * BENCH_WIDTH;
  const seatY = sy + ts * BENCH_TOP;
  ctx.fillStyle = IRON;
  ctx.fillRect(left + ts * BENCH_LEG_INSET, seatY + BENCH_SEAT_HEIGHT_PX, 2, BENCH_LEG_HEIGHT_PX);
  ctx.fillRect(
    left + width - ts * BENCH_LEG_INSET - 2,
    seatY + BENCH_SEAT_HEIGHT_PX,
    2,
    BENCH_LEG_HEIGHT_PX,
  );
  ctx.fillStyle = STONE;
  ctx.fillRect(left, seatY, width, BENCH_SEAT_HEIGHT_PX);
  ctx.fillStyle = STONE_DARK;
  ctx.fillRect(left, seatY + BENCH_SEAT_HEIGHT_PX - 1, width, 1);
};

/** A small tree in a dressed-stone planter box — urban street greenery. */
const TREE_BOX_LEFT = 0.28;
const TREE_BOX_TOP = 0.72;
const TREE_BOX_WIDTH = 0.44;
const TREE_BOX_HEIGHT = 0.2;
const TREE_TRUNK_WIDTH_PX = 3;
const TREE_CANOPY_LOBES: ReadonlyArray<readonly [number, number, number]> = [
  [0.32, 0.38, 0.2],
  [0.5, 0.27, 0.22],
  [0.68, 0.4, 0.19],
];

const drawStreetTree: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const boxLeft = sx + ts * TREE_BOX_LEFT;
  const boxTop = sy + ts * TREE_BOX_TOP;
  const boxWidth = ts * TREE_BOX_WIDTH;
  const boxHeight = ts * TREE_BOX_HEIGHT;
  ctx.fillStyle = STONE_DARK;
  ctx.fillRect(boxLeft, boxTop, boxWidth, boxHeight);
  ctx.fillStyle = STONE;
  ctx.fillRect(boxLeft, boxTop, boxWidth, 2);
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(
    sx + ts / 2 - TREE_TRUNK_WIDTH_PX / 2,
    boxTop - ts * 0.14,
    TREE_TRUNK_WIDTH_PX,
    ts * 0.14,
  );
  for (const [cx, cy, radius] of TREE_CANOPY_LOBES) {
    ctx.fillStyle = LEAF_DARK;
    fillCircle(ctx, sx + ts * cx, sy + ts * cy, ts * radius);
  }
  for (const [cx, cy, radius] of TREE_CANOPY_LOBES) {
    ctx.fillStyle = LEAF;
    fillCircle(
      ctx,
      sx + ts * (cx - radius * 0.25),
      sy + ts * (cy - radius * 0.25),
      ts * radius * 0.65,
    );
  }
};

/** A dressed-stone birdbath: a fluted pedestal and a shallow basin. */
const BATH_PEDESTAL_TOP = 0.56;
const BATH_PEDESTAL_BOTTOM = 0.9;
const BATH_PEDESTAL_WIDTH_PX = 5;
const BATH_BASIN_CY = 0.5;
const BATH_BASIN_RX = 0.3;
const BATH_BASIN_RY = 0.1;

const drawBirdbath: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const cx = sx + ts / 2;
  ctx.fillStyle = STONE_DARK;
  ctx.fillRect(
    cx - BATH_PEDESTAL_WIDTH_PX / 2,
    sy + ts * BATH_PEDESTAL_TOP,
    BATH_PEDESTAL_WIDTH_PX,
    ts * (BATH_PEDESTAL_BOTTOM - BATH_PEDESTAL_TOP),
  );
  ctx.fillStyle = STONE;
  const basinCy = sy + ts * BATH_BASIN_CY;
  ctx.beginPath();
  ctx.ellipse(cx, basinCy, ts * BATH_BASIN_RX, ts * BATH_BASIN_RY, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = WATER;
  ctx.beginPath();
  ctx.ellipse(cx, basinCy, ts * BATH_BASIN_RX * 0.72, ts * BATH_BASIN_RY * 0.6, 0, 0, TWO_PI);
  ctx.fill();
  ctx.fillStyle = WATER_LIGHT;
  fillCircle(ctx, cx - ts * BATH_BASIN_RX * 0.2, basinCy - 1, 1.2);
};

/** A low clipped hedge, framing a yard or a street edge without a full fence. */
const HEDGE_CY = 0.76;
const HEDGE_RX = 0.48;
const HEDGE_RY = 0.13;
const HEDGE_LOBES: ReadonlyArray<readonly [number, number]> = [
  [0.14, 0.13],
  [0.34, 0.16],
  [0.54, 0.14],
  [0.74, 0.16],
  [0.9, 0.12],
];

const drawHedgeRow: ClutterPainter = (ctx, sx, sy, ts) => {
  const cy = sy + ts * HEDGE_CY;
  ctx.fillStyle = LEAF_DARK;
  ctx.beginPath();
  ctx.ellipse(sx + ts / 2, cy, ts * HEDGE_RX, ts * HEDGE_RY, 0, 0, TWO_PI);
  ctx.fill();
  for (const [cx, radius] of HEDGE_LOBES) {
    ctx.fillStyle = LEAF;
    fillCircle(ctx, sx + ts * cx, cy - ts * radius * 0.3, ts * radius);
  }
};

/** A weapon rack: practice spears and a wooden sword racked for a drill yard. */
const WRACK_LEFT = 0.14;
const WRACK_TOP = 0.16;
const WRACK_WIDTH = 0.72;
const WRACK_HEIGHT = 0.7;
const WRACK_FRAME_PX = 3;
const WRACK_WEAPON_X = [0.22, 0.5, 0.78] as const;

const drawWeaponRack: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const left = sx + ts * WRACK_LEFT;
  const top = sy + ts * WRACK_TOP;
  const width = ts * WRACK_WIDTH;
  const height = ts * WRACK_HEIGHT;
  ctx.fillStyle = WOOD_DARK;
  ctx.fillRect(left, top, width, WRACK_FRAME_PX);
  ctx.fillRect(left, top + height - WRACK_FRAME_PX, width, WRACK_FRAME_PX);
  for (const along of WRACK_WEAPON_X) {
    const x = left + width * along;
    ctx.strokeStyle = WOOD;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(x, top + height - WRACK_FRAME_PX);
    ctx.lineTo(x, top + 2);
    ctx.stroke();
    ctx.fillStyle = IRON_LIGHT;
    ctx.beginPath();
    ctx.moveTo(x, top);
    ctx.lineTo(x - 3, top + 6);
    ctx.lineTo(x + 3, top + 6);
    ctx.closePath();
    ctx.fill();
  }
};

/** A grain bin: a broad stave-built cylinder with a conical cap, for a mill yard. */
const GBIN_LEFT = 0.14;
const GBIN_TOP = 0.36;
const GBIN_WIDTH = 0.72;
const GBIN_HEIGHT = 0.5;
const GBIN_CAP_RISE = 0.18;
const GBIN_STAVE_COUNT = 5;

const drawGrainBin: ClutterPainter = (ctx, sx, sy, ts) => {
  shadow(ctx, sx, sy, ts);
  const left = sx + ts * GBIN_LEFT;
  const top = sy + ts * GBIN_TOP;
  const width = ts * GBIN_WIDTH;
  const height = ts * GBIN_HEIGHT;
  ctx.fillStyle = WOOD;
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = WOOD_DARK;
  for (let stave = 1; stave < GBIN_STAVE_COUNT; stave++) {
    const x = left + (width * stave) / GBIN_STAVE_COUNT;
    ctx.fillRect(x, top, 1, height);
  }
  ctx.fillStyle = IRON;
  ctx.fillRect(left, top + height * 0.66, width, 2);
  ctx.fillStyle = WOOD_DARK;
  ctx.beginPath();
  ctx.moveTo(left - 2, top);
  ctx.lineTo(sx + ts / 2, top - ts * GBIN_CAP_RISE);
  ctx.lineTo(left + width + 2, top);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = WOOD_LIGHT;
  ctx.fillRect(left, top, width, 1);
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
  hay_rack: drawHayRack,
  vegetable_row: drawVegetableRow,
  herb_rack: drawHerbRack,
  timber_stack: drawTimberStack,
  feed_bin: drawFeedBin,
  milking_stool: drawMilkingStool,
  drill_pell: drawDrillPell,
  garden_bench: drawGardenBench,
  street_tree: drawStreetTree,
  birdbath: drawBirdbath,
  hedge_row: drawHedgeRow,
  weapon_rack: drawWeaponRack,
  grain_bin: drawGrainBin,
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
 * a building wall, so with nothing at the ends the rope reads as trailing off
 * into the open instead of strung between two fixed points.
 */
const LINE_POLE_WIDTH_PX = 2;
const LINE_POLE_FOOT = 0.42;

/**
 * How many distinct points of its swing a laundry line is drawn at.
 *
 * The sheets sway 0.07 rad about a hem half a tile long — a couple of pixels end
 * to end — so eight steps are already finer than the eye resolves, and unlike the
 * continuous swing it replaced it is a finite number of pictures, which is what
 * lets the whole line be baked into a sprite sheet instead of redrawn per frame.
 *
 * All four sheets share one period and differ only in phase, so quantizing the
 * cycle position quantizes the whole line coherently.
 */
export const LAUNDRY_SWAY_STEPS = 8;

/** Which of the `LAUNDRY_SWAY_STEPS` points of its swing the line is at. */
export function laundryLineSwayStep(frame: number): number {
  const cyclePosition = positiveMod(frame, SHEET_SWAY_PERIOD_FRAMES) / SHEET_SWAY_PERIOD_FRAMES;
  return Math.min(LAUNDRY_SWAY_STEPS - 1, Math.floor(cyclePosition * LAUNDRY_SWAY_STEPS));
}

/**
 * The frame to draw to land exactly on one of the quantized steps. The offline
 * generator is the only caller — it bakes one frame per step, and this is what
 * makes the picture it bakes the picture `laundryLineSwayStep` asks for.
 */
export function laundryLineFrameForStep(step: number): number {
  return (step / LAUNDRY_SWAY_STEPS) * SHEET_SWAY_PERIOD_FRAMES;
}

function positiveMod(value: number, modulus: number): number {
  return ((value % modulus) + modulus) % modulus;
}

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
