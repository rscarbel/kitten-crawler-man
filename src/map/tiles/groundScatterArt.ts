/**
 * Painters for the walkable ground scatter that is baked into the chunk over
 * its own ground: weeds on field grass, worn patches on the dirt tracks, loose
 * rubble, and the soil a boulder sits in.
 *
 * Every value a painter draws comes from `scatterHash01`, never from a linear
 * expression such as `(tx*31 + ty*17) % 97`. A linear hash steps by a constant
 * as either coordinate steps, so neighbouring tiles draw the same motif shifted
 * along one diagonal, and at map scale every scatter type lines up into
 * stripes. Each tile and salt is avalanched separately, so two values drawn for
 * one tile are independent of each other and of every neighbour's.
 */

import { UINT32_SPAN } from '../../core/WorldRandom';
import { HIGHLAND_GRASS, positionHash, SCREE, type TileContent } from '../tileTypes';

/** Spreads a salt across all 32 bits before it is mixed with the tile's hash. */
const SALT_MIX = 0x9e3779b1;

/**
 * The separate quantities one element of a scatter draws: where it sits
 * across and down the tile, its size on each axis, and its turn. Each is its
 * own stream, so no quantity is a function of another.
 */
const ACROSS = 0;
const DOWN = 1;
const SIZE = 2;
const SECOND_SIZE = 3;
const TURN = 4;
const QUANTITY_SLOTS = 5;

/** Stable value in [0, 1) for one quantity of element `index` of a scatter `salt` on one tile. */
export function scatterHash01(
  tx: number,
  ty: number,
  salt: number,
  index = 0,
  quantity = ACROSS,
): number {
  const stream = Math.imul(salt * QUANTITY_SLOTS + quantity, SALT_MIX);
  return positionHash(positionHash(tx, ty) ^ stream, index) / UINT32_SPAN;
}

/** `scatterHash01` scaled to [low, high). */
function hashBetween(
  tx: number,
  ty: number,
  salt: number,
  index: number,
  quantity: number,
  low: number,
  high: number,
): number {
  return low + scatterHash01(tx, ty, salt, index, quantity) * (high - low);
}

const FULL_TURN = Math.PI * 2;

// ── weeds on field grass ──────────────────────────────────────────────────

const WEED_SALT_TUFT_X = 11;
const WEED_SALT_TUFT_Y = 12;
const WEED_SALT_YELLOW = 13;
const WEED_SALT_PURPLE = 14;
const WEED_SALT_FLOWER_X = 15;
const WEED_SALT_FLOWER_Y = 16;

const WEED_TUFT_INSET_PX = 4;
const WEED_TUFT_SPREAD_MARGIN_PX = 12;
/**
 * The blade colours track the generated grass material, which is olive; the
 * second tuft is the darker one so a pair reads as near and far.
 */
const WEED_TUFT_COLORS = ['#6b7f35', '#55692a'] as const;
const WEED_BLADE_WIDTH_PX = 2;
/** Centre blade, then the two side blades, which start lower and lean out. */
const WEED_CENTRE_BLADE_PX = [7, 5] as const;
const WEED_SIDE_BLADE_PX = [5, 3] as const;
const WEED_SIDE_OFFSET_PX = [3, 2] as const;
const WEED_SIDE_DROP_PX = [3, 2] as const;

/** About one weed tile in nine carries a yellow bloom, one in thirteen a purple one. */
const WEED_YELLOW_FLOWER_CHANCE = 1 / 9;
const WEED_PURPLE_FLOWER_CHANCE = 1 / 13;
const WEED_FLOWER_INSET_PX = 5;
const WEED_YELLOW_PETAL_COLOR = '#f0e040';
const WEED_YELLOW_EYE_COLOR = '#e06010';
const WEED_YELLOW_PETAL_RADIUS_PX = 3;
const WEED_YELLOW_EYE_RADIUS_PX = 1.5;
const WEED_PURPLE_PETAL_COLOR = '#c060d8';
const WEED_PURPLE_EYE_COLOR = '#f0d000';
const WEED_PURPLE_PETAL_RADIUS_PX = 2.5;
const WEED_PURPLE_EYE_RADIUS_PX = 1;

function drawBloom(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  petalColor: string,
  petalRadius: number,
  eyeColor: string,
  eyeRadius: number,
): void {
  ctx.fillStyle = petalColor;
  ctx.beginPath();
  ctx.arc(x, y, petalRadius, 0, FULL_TURN);
  ctx.fill();
  ctx.fillStyle = eyeColor;
  ctx.beginPath();
  ctx.arc(x, y, eyeRadius, 0, FULL_TURN);
  ctx.fill();
}

/** Two grass tufts and the occasional bloom, over ground already drawn. */
export function drawGrassyWeedArt(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const spread = ts - WEED_TUFT_SPREAD_MARGIN_PX;
  WEED_TUFT_COLORS.forEach((color, tuft) => {
    const x = sx + WEED_TUFT_INSET_PX + scatterHash01(tx, ty, WEED_SALT_TUFT_X, tuft) * spread;
    const y = sy + WEED_TUFT_INSET_PX + scatterHash01(tx, ty, WEED_SALT_TUFT_Y, tuft) * spread;
    const side = WEED_SIDE_BLADE_PX[tuft];
    const offset = WEED_SIDE_OFFSET_PX[tuft];
    const drop = WEED_SIDE_DROP_PX[tuft];
    ctx.fillStyle = color;
    ctx.fillRect(x, y, WEED_BLADE_WIDTH_PX, WEED_CENTRE_BLADE_PX[tuft]);
    ctx.fillRect(x - offset, y + drop, WEED_BLADE_WIDTH_PX, side);
    ctx.fillRect(x + offset, y + drop, WEED_BLADE_WIDTH_PX, side);
  });

  const flowerSpread = ts - WEED_FLOWER_INSET_PX * 2;
  const flowerAt = (index: number) => ({
    x: sx + WEED_FLOWER_INSET_PX + scatterHash01(tx, ty, WEED_SALT_FLOWER_X, index) * flowerSpread,
    y: sy + WEED_FLOWER_INSET_PX + scatterHash01(tx, ty, WEED_SALT_FLOWER_Y, index) * flowerSpread,
  });
  if (scatterHash01(tx, ty, WEED_SALT_YELLOW) < WEED_YELLOW_FLOWER_CHANCE) {
    const { x, y } = flowerAt(0);
    drawBloom(
      ctx,
      x,
      y,
      WEED_YELLOW_PETAL_COLOR,
      WEED_YELLOW_PETAL_RADIUS_PX,
      WEED_YELLOW_EYE_COLOR,
      WEED_YELLOW_EYE_RADIUS_PX,
    );
  }
  if (scatterHash01(tx, ty, WEED_SALT_PURPLE) < WEED_PURPLE_FLOWER_CHANCE) {
    const { x, y } = flowerAt(1);
    drawBloom(
      ctx,
      x,
      y,
      WEED_PURPLE_PETAL_COLOR,
      WEED_PURPLE_PETAL_RADIUS_PX,
      WEED_PURPLE_EYE_COLOR,
      WEED_PURPLE_EYE_RADIUS_PX,
    );
  }
}

// ── worn patches on the dirt tracks ───────────────────────────────────────

const DIRT_SALT_BLOTCH = 21;
const DIRT_SALT_SECOND_BLOTCH = 22;
const DIRT_SALT_PEBBLE = 23;
const DIRT_SALT_HIGHLIGHT = 24;
const DIRT_SALT_CRACK = 25;

const DIRT_BLOTCH_COLOR = 'rgba(70,38,8,0.28)';
const DIRT_SECOND_BLOTCH_COLOR = 'rgba(60,30,5,0.18)';
const DIRT_PEBBLE_COLOR = '#8a6030';
const DIRT_HIGHLIGHT_COLOR = '#c8a070';
const DIRT_CRACK_COLOR = 'rgba(55,28,5,0.32)';

/** Each blotch's centre stays this far inside the tile, so the ellipse rarely meets the edge. */
const DIRT_BLOTCH_INSET_PX = 9;
const DIRT_BLOTCH_RADIUS_X_PX = [5, 9] as const;
const DIRT_BLOTCH_RADIUS_Y_PX = [3, 6] as const;
const DIRT_SECOND_BLOTCH_INSET_PX = 10;
const DIRT_SECOND_BLOTCH_RADIUS_X_PX = [3, 5] as const;
const DIRT_SECOND_BLOTCH_RADIUS_Y_PX = [2, 3] as const;
const DIRT_SECOND_BLOTCH_CHANCE = 2 / 3;
/** Half a turn covers every orientation an ellipse can have. */
const HALF_TURN = Math.PI;

const DIRT_PEBBLE_COUNT = 3;
const DIRT_PEBBLE_INSET_PX = 4;
const DIRT_PEBBLE_RADIUS_PX = 1.5;
const DIRT_HIGHLIGHT_COUNT = 2;
const DIRT_HIGHLIGHT_INSET_PX = 6;
const DIRT_HIGHLIGHT_RADIUS_PX = 1;

const DIRT_CRACK_CHANCE = 1 / 7;
const DIRT_CRACK_INSET_PX = 5;
const DIRT_CRACK_WIDTH_PX = 1;
const DIRT_CRACK_DOWN_PX = [5, 11] as const;
const DIRT_CRACK_ACROSS_PX = [4, 9] as const;

function fillEllipse(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radiusX: number,
  radiusY: number,
  rotation: number,
): void {
  ctx.beginPath();
  ctx.ellipse(x, y, radiusX, radiusY, rotation, 0, FULL_TURN);
  ctx.fill();
}

function scatterDots(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
  salt: number,
  count: number,
  inset: number,
  radius: number,
): void {
  const spread = ts - inset * 2;
  for (let i = 0; i < count; i++) {
    const x = sx + inset + scatterHash01(tx, ty, salt, i, ACROSS) * spread;
    const y = sy + inset + scatterHash01(tx, ty, salt, i, DOWN) * spread;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, FULL_TURN);
    ctx.fill();
  }
}

/** Darker soil, a few pebbles and the odd crack on a track, over ground already drawn. */
export function drawDirtPatchArt(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const blotchSpread = ts - DIRT_BLOTCH_INSET_PX * 2;
  ctx.fillStyle = DIRT_BLOTCH_COLOR;
  fillEllipse(
    ctx,
    sx + DIRT_BLOTCH_INSET_PX + scatterHash01(tx, ty, DIRT_SALT_BLOTCH) * blotchSpread,
    sy + DIRT_BLOTCH_INSET_PX + scatterHash01(tx, ty, DIRT_SALT_BLOTCH, 0, DOWN) * blotchSpread,
    hashBetween(tx, ty, DIRT_SALT_BLOTCH, 0, SIZE, ...DIRT_BLOTCH_RADIUS_X_PX),
    hashBetween(tx, ty, DIRT_SALT_BLOTCH, 0, SECOND_SIZE, ...DIRT_BLOTCH_RADIUS_Y_PX),
    scatterHash01(tx, ty, DIRT_SALT_BLOTCH, 0, TURN) * HALF_TURN,
  );
  if (scatterHash01(tx, ty, DIRT_SALT_SECOND_BLOTCH) < DIRT_SECOND_BLOTCH_CHANCE) {
    const spread = ts - DIRT_SECOND_BLOTCH_INSET_PX * 2;
    ctx.fillStyle = DIRT_SECOND_BLOTCH_COLOR;
    fillEllipse(
      ctx,
      sx +
        DIRT_SECOND_BLOTCH_INSET_PX +
        scatterHash01(tx, ty, DIRT_SALT_SECOND_BLOTCH, 0, ACROSS) * spread,
      sy +
        DIRT_SECOND_BLOTCH_INSET_PX +
        scatterHash01(tx, ty, DIRT_SALT_SECOND_BLOTCH, 0, DOWN) * spread,
      hashBetween(tx, ty, DIRT_SALT_SECOND_BLOTCH, 0, SIZE, ...DIRT_SECOND_BLOTCH_RADIUS_X_PX),
      hashBetween(
        tx,
        ty,
        DIRT_SALT_SECOND_BLOTCH,
        0,
        SECOND_SIZE,
        ...DIRT_SECOND_BLOTCH_RADIUS_Y_PX,
      ),
      scatterHash01(tx, ty, DIRT_SALT_SECOND_BLOTCH, 0, TURN) * HALF_TURN,
    );
  }

  ctx.fillStyle = DIRT_PEBBLE_COLOR;
  scatterDots(
    ctx,
    sx,
    sy,
    ts,
    tx,
    ty,
    DIRT_SALT_PEBBLE,
    DIRT_PEBBLE_COUNT,
    DIRT_PEBBLE_INSET_PX,
    DIRT_PEBBLE_RADIUS_PX,
  );
  ctx.fillStyle = DIRT_HIGHLIGHT_COLOR;
  scatterDots(
    ctx,
    sx,
    sy,
    ts,
    tx,
    ty,
    DIRT_SALT_HIGHLIGHT,
    DIRT_HIGHLIGHT_COUNT,
    DIRT_HIGHLIGHT_INSET_PX,
    DIRT_HIGHLIGHT_RADIUS_PX,
  );

  if (scatterHash01(tx, ty, DIRT_SALT_CRACK) < DIRT_CRACK_CHANCE) {
    const spread = ts - DIRT_CRACK_INSET_PX * 2 - DIRT_CRACK_ACROSS_PX[1];
    const x = sx + DIRT_CRACK_INSET_PX + scatterHash01(tx, ty, DIRT_SALT_CRACK, 0, ACROSS) * spread;
    const y = sy + DIRT_CRACK_INSET_PX + scatterHash01(tx, ty, DIRT_SALT_CRACK, 0, DOWN) * spread;
    ctx.fillStyle = DIRT_CRACK_COLOR;
    ctx.fillRect(
      x,
      y,
      DIRT_CRACK_WIDTH_PX,
      hashBetween(tx, ty, DIRT_SALT_CRACK, 0, SIZE, ...DIRT_CRACK_DOWN_PX),
    );
    ctx.fillRect(
      x,
      y,
      hashBetween(tx, ty, DIRT_SALT_CRACK, 0, SECOND_SIZE, ...DIRT_CRACK_ACROSS_PX),
      DIRT_CRACK_WIDTH_PX,
    );
  }
}

// ── loose rubble ──────────────────────────────────────────────────────────

const RUBBLE_SALT_BED = 31;
const RUBBLE_SALT_CHUNK = 32;
const RUBBLE_SALT_GRIT = 33;
const RUBBLE_SALT_TUFT = 34;

/**
 * The soil a heap of broken stone has settled into: a few soft, overlapping
 * blots rather than one disc. A single dark disc the same size on every tile
 * would be the one shape a scatter of rubble shared, and at map scale the eye
 * finds that shape before it finds the stones.
 */
const RUBBLE_BED_BLOTS = 3;
const RUBBLE_BED_INSET_PX = 9;
const RUBBLE_BED_RADIUS_PX = [4, 8] as const;
const RUBBLE_BED_COLOR = 'rgba(58,52,44,0.3)';
const RUBBLE_BED_EDGE_COLOR = 'rgba(58,52,44,0)';
/** Where in a blot's radius the soft edge starts to fade. */
const RUBBLE_BED_CORE_SHARE = 0.35;

const RUBBLE_CHUNK_COUNT = 4;
const RUBBLE_CHUNK_INSET_PX = 6;
const RUBBLE_CHUNK_SIZE_PX = [2, 5] as const;
const RUBBLE_CHUNK_COLORS = ['#6a655a', '#7a6f5e', '#5f5a50'] as const;
const RUBBLE_CHUNK_LIT_EDGE_COLOR = '#8a8476';
const RUBBLE_CHUNK_SHADE_COLOR = 'rgba(20,18,14,0.35)';
const RUBBLE_EDGE_PX = 1;

const RUBBLE_GRIT_COUNT = 6;
const RUBBLE_GRIT_INSET_PX = 7;
const RUBBLE_GRIT_COLOR = 'rgba(0,0,0,0.18)';
const RUBBLE_GRIT_PX = 1;

/**
 * Blades poking up between the stones, so the heap reads as half-swallowed by
 * the turf around it. The meadow's olive on field grass, the straw of the
 * upland turf on the highland, and none on bare scree, where there is no turf
 * to swallow it.
 */
const RUBBLE_TUFT_COUNT = 3;
const RUBBLE_TUFT_INSET_PX = 4;
const RUBBLE_TUFT_HEIGHT_PX = 6;
const RUBBLE_TUFT_SHORT_HEIGHT_PX = 4;
const RUBBLE_TUFT_GAP_PX = 3;
const RUBBLE_TUFT_STEP_DOWN_PX = 2;
const RUBBLE_TUFT_WIDTH_PX = 2;
const MEADOW_TUFT_COLOR = '#6b7f35';
const HIGHLAND_TUFT_COLOR = '#7d7a44';

function rubbleTuftColor(groundType: number | undefined): string | undefined {
  if (groundType === SCREE) return undefined;
  if (groundType === HIGHLAND_GRASS) return HIGHLAND_TUFT_COLOR;
  return MEADOW_TUFT_COLOR;
}

/** Broken stone settled into its own ground, which the caller has already drawn. */
export function drawRubbleArt(
  ctx: CanvasRenderingContext2D,
  structure: TileContent[][],
  sx: number,
  sy: number,
  ts: number,
  tx: number,
  ty: number,
): void {
  const bedSpread = ts - RUBBLE_BED_INSET_PX * 2;
  for (let blot = 0; blot < RUBBLE_BED_BLOTS; blot++) {
    const x =
      sx + RUBBLE_BED_INSET_PX + scatterHash01(tx, ty, RUBBLE_SALT_BED, blot, ACROSS) * bedSpread;
    const y =
      sy + RUBBLE_BED_INSET_PX + scatterHash01(tx, ty, RUBBLE_SALT_BED, blot, DOWN) * bedSpread;
    const radius = hashBetween(tx, ty, RUBBLE_SALT_BED, blot, SIZE, ...RUBBLE_BED_RADIUS_PX);
    const soft = ctx.createRadialGradient(x, y, radius * RUBBLE_BED_CORE_SHARE, x, y, radius);
    soft.addColorStop(0, RUBBLE_BED_COLOR);
    soft.addColorStop(1, RUBBLE_BED_EDGE_COLOR);
    ctx.fillStyle = soft;
    ctx.fillRect(x - radius, y - radius, radius * 2, radius * 2);
  }

  const chunkSpread = ts - RUBBLE_CHUNK_INSET_PX * 2;
  for (let i = 0; i < RUBBLE_CHUNK_COUNT; i++) {
    const x =
      sx +
      RUBBLE_CHUNK_INSET_PX +
      scatterHash01(tx, ty, RUBBLE_SALT_CHUNK, i, ACROSS) * chunkSpread;
    const y =
      sy + RUBBLE_CHUNK_INSET_PX + scatterHash01(tx, ty, RUBBLE_SALT_CHUNK, i, DOWN) * chunkSpread;
    const width = Math.round(
      hashBetween(tx, ty, RUBBLE_SALT_CHUNK, i, SIZE, ...RUBBLE_CHUNK_SIZE_PX),
    );
    const height = Math.round(
      hashBetween(tx, ty, RUBBLE_SALT_CHUNK, i, SECOND_SIZE, ...RUBBLE_CHUNK_SIZE_PX),
    );
    ctx.fillStyle = RUBBLE_CHUNK_SHADE_COLOR;
    ctx.fillRect(x + RUBBLE_EDGE_PX, y + RUBBLE_EDGE_PX, width, height);
    ctx.fillStyle = RUBBLE_CHUNK_COLORS[i % RUBBLE_CHUNK_COLORS.length];
    ctx.fillRect(x, y, width, height);
    ctx.fillStyle = RUBBLE_CHUNK_LIT_EDGE_COLOR;
    ctx.fillRect(x, y, width, RUBBLE_EDGE_PX);
  }

  ctx.fillStyle = RUBBLE_GRIT_COLOR;
  const gritSpread = ts - RUBBLE_GRIT_INSET_PX * 2;
  for (let i = 0; i < RUBBLE_GRIT_COUNT; i++) {
    const x =
      sx + RUBBLE_GRIT_INSET_PX + scatterHash01(tx, ty, RUBBLE_SALT_GRIT, i, ACROSS) * gritSpread;
    const y =
      sy + RUBBLE_GRIT_INSET_PX + scatterHash01(tx, ty, RUBBLE_SALT_GRIT, i, DOWN) * gritSpread;
    ctx.fillRect(x, y, RUBBLE_GRIT_PX, RUBBLE_GRIT_PX);
  }

  const tuftColor = rubbleTuftColor(structure[ty]?.[tx]?.groundType);
  if (tuftColor === undefined) return;
  ctx.fillStyle = tuftColor;
  const tuftSpreadX = ts - RUBBLE_TUFT_INSET_PX * 2 - RUBBLE_TUFT_GAP_PX - RUBBLE_TUFT_WIDTH_PX;
  const tuftSpreadY = ts - RUBBLE_TUFT_INSET_PX * 2 - RUBBLE_TUFT_HEIGHT_PX;
  for (let i = 0; i < RUBBLE_TUFT_COUNT; i++) {
    const x =
      sx + RUBBLE_TUFT_INSET_PX + scatterHash01(tx, ty, RUBBLE_SALT_TUFT, i, ACROSS) * tuftSpreadX;
    const y =
      sy + RUBBLE_TUFT_INSET_PX + scatterHash01(tx, ty, RUBBLE_SALT_TUFT, i, DOWN) * tuftSpreadY;
    ctx.fillRect(x, y, RUBBLE_TUFT_WIDTH_PX, RUBBLE_TUFT_HEIGHT_PX);
    ctx.fillRect(
      x + RUBBLE_TUFT_GAP_PX,
      y + RUBBLE_TUFT_STEP_DOWN_PX,
      RUBBLE_TUFT_WIDTH_PX,
      RUBBLE_TUFT_SHORT_HEIGHT_PX,
    );
  }
}

// ── boulder contact ───────────────────────────────────────────────────────

/**
 * The soil a boulder has settled into, darkened under it so the rock sits *in*
 * the ground rather than on it. Baked into the ground under the rock, on its
 * own tile only — the rock's art carries its own hard contact shadow, and this
 * is the broad, soft occlusion around it that the art cannot reach.
 *
 * Centred low in the tile, where the rock's base is, and wider than tall, as a
 * patch of ground seen from the camera's angle is.
 */
const BOULDER_CONTACT_CENTRE_Y_SHARE = 0.68;
const BOULDER_CONTACT_RADIUS_SHARE = 0.5;
const BOULDER_CONTACT_SQUASH = 0.62;
const BOULDER_CONTACT_COLOR = 'rgba(16,14,8,0.45)';
const BOULDER_CONTACT_EDGE_COLOR = 'rgba(16,14,8,0)';
const BOULDER_CONTACT_CORE_SHARE = 0.4;
const TILE_CENTRE_SHARE = 0.5;

export function drawBoulderContactShade(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  ts: number,
): void {
  const x = sx + ts * TILE_CENTRE_SHARE;
  const y = sy + ts * BOULDER_CONTACT_CENTRE_Y_SHARE;
  const radius = ts * BOULDER_CONTACT_RADIUS_SHARE;
  ctx.save();
  ctx.beginPath();
  ctx.rect(sx, sy, ts, ts);
  ctx.clip();
  ctx.translate(x, y);
  ctx.scale(1, BOULDER_CONTACT_SQUASH);
  const soft = ctx.createRadialGradient(0, 0, radius * BOULDER_CONTACT_CORE_SHARE, 0, 0, radius);
  soft.addColorStop(0, BOULDER_CONTACT_COLOR);
  soft.addColorStop(1, BOULDER_CONTACT_EDGE_COLOR);
  ctx.fillStyle = soft;
  ctx.fillRect(-radius, -radius, radius * 2, radius * 2);
  ctx.restore();
}
