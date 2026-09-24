/**
 * Icons for Briar Hollow's raw and refined resources.
 *
 * Wood and boards share a warm bark palette so the eye reads "timber family"
 * before it reads which stage of processing; stone is deliberately cooler and
 * angular so it never gets mistaken for either. Each painter is self-contained
 * fractions-of-`size` geometry, matching the rest of `src/ui/icons/`.
 */

import type { ItemId } from '../../core/ItemDefs';

/** The four resource ids this module can draw. Closed, so a new resource cannot ship iconless. */
export type ResourceIconId = 'wood' | 'stone' | 'wood_board' | 'rope';

/** Every id this module can draw, the single source of truth for the id set below and for the icon bake gate. */
export const RESOURCE_ICON_ID_LIST: readonly ResourceIconId[] = [
  'wood',
  'stone',
  'wood_board',
  'rope',
];

const RESOURCE_ICON_IDS: ReadonlySet<string> = new Set<ResourceIconId>(RESOURCE_ICON_ID_LIST);

/** Whether `id` is a resource, and so drawable by {@link drawResourceIcon}. */
export function isResourceIconId(id: ItemId): id is ResourceIconId {
  return RESOURCE_ICON_IDS.has(id);
}

const FULL_CIRCLE = Math.PI * 2;
const QUARTER_TURN = Math.PI / 2;
const OUTLINE = '#2a1a10';
const OUTLINE_WIDTH = 1;

// ── Wood: two crossed split logs ────────────────────────────────────────────

const LOG_CX = 0.5;
const LOG_CY = 0.55;
/** Half the log's length, so the full log spans `2 * LOG_HALF_LENGTH * size`. */
const LOG_HALF_LENGTH = 0.3;
const LOG_RADIUS = 0.12;
/** Radians off horizontal for the front log; the back log mirrors it. */
const LOG_ANGLE = 0.52;
const LOG_BARK = '#7a5230';
const LOG_BARK_BACK = '#5c3d22';
const LOG_BARK_DARK = '#4a3020';
const LOG_END_PALE = '#e6cfa4';
const LOG_END_RING = '#c4a26f';
const LOG_END_CORE = '#a9835a';
/** Bark grain strokes per log, evenly spaced along its length. */
const LOG_GRAIN_STROKES = 3;
/** How far each grain stroke runs up and down from the log's centreline. */
const LOG_GRAIN_HALF_HEIGHT_FRACTION = 0.7;
/** The end-grain rings, as fractions of the log's own radius. */
const LOG_END_RING_FRACTION = 0.62;
const LOG_END_CORE_FRACTION = 0.26;
const THIN_LINE_WIDTH = 1;

function drawLog(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
  angle: number,
  barkColor: string,
): void {
  const half = size * LOG_HALF_LENGTH;
  const radius = size * LOG_RADIUS;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate(angle);

  // Body: a capsule, so the log reads as a cylinder rather than a plank.
  ctx.fillStyle = barkColor;
  ctx.beginPath();
  ctx.moveTo(-half, -radius);
  ctx.lineTo(half, -radius);
  ctx.arc(half, 0, radius, -QUARTER_TURN, QUARTER_TURN);
  ctx.lineTo(-half, radius);
  ctx.arc(-half, 0, radius, QUARTER_TURN, -QUARTER_TURN);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();

  ctx.strokeStyle = LOG_BARK_DARK;
  ctx.lineWidth = THIN_LINE_WIDTH;
  ctx.beginPath();
  for (let stroke = 1; stroke <= LOG_GRAIN_STROKES; stroke++) {
    const sx = -half + (half * 2 * stroke) / (LOG_GRAIN_STROKES + 1);
    ctx.moveTo(sx, -radius * LOG_GRAIN_HALF_HEIGHT_FRACTION);
    ctx.lineTo(sx, radius * LOG_GRAIN_HALF_HEIGHT_FRACTION);
  }
  ctx.stroke();

  // Cut end: the pale end-grain ring facing the viewer.
  ctx.fillStyle = LOG_END_PALE;
  ctx.beginPath();
  ctx.arc(half, 0, radius, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.strokeStyle = LOG_END_RING;
  ctx.lineWidth = THIN_LINE_WIDTH;
  ctx.beginPath();
  ctx.arc(half, 0, radius * LOG_END_RING_FRACTION, 0, FULL_CIRCLE);
  ctx.stroke();
  ctx.fillStyle = LOG_END_CORE;
  ctx.beginPath();
  ctx.arc(half, 0, radius * LOG_END_CORE_FRACTION, 0, FULL_CIRCLE);
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.beginPath();
  ctx.arc(half, 0, radius, 0, FULL_CIRCLE);
  ctx.stroke();

  ctx.restore();
}

function drawWoodIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const cx = x + size * LOG_CX;
  const cy = y + size * LOG_CY;
  drawLog(ctx, cx, cy, size, -LOG_ANGLE, LOG_BARK_BACK);
  drawLog(ctx, cx, cy, size, LOG_ANGLE, LOG_BARK);
}

// ── Stone: an angular chunk with one lit facet and a crack ─────────────────

/**
 * The chunk's silhouette is a wobbled ring of straight edges, not a curve —
 * angular and few-sided on purpose. The thrown boulders and the environment's
 * rock props are rounded, so a hard-edged chunk reads as a different object
 * at a glance rather than a recolour of either.
 */
const STONE_CX = 0.5;
const STONE_CY = 0.52;
const STONE_RADIUS = 0.36;
/** Five, not six — an odd count means no two vertices sit opposite each other, so the wobble below can't average itself back toward round. */
const STONE_VERTEX_COUNT = 5;
const STONE_ROTATION = -0.3;
/**
 * Two sine terms whose steps do not divide the ring, so no facet repeats. The
 * amplitude is large relative to the radius on purpose — a smaller wobble
 * reads as a smooth polygon (round) rather than a broken chunk at icon size.
 */
const STONE_WOBBLE_PRIMARY_AMPLITUDE = 0.3;
const STONE_WOBBLE_PRIMARY_STEP = 2.6;
const STONE_WOBBLE_SECONDARY_AMPLITUDE = 0.16;
const STONE_WOBBLE_SECONDARY_STEP = 1.3;
const STONE_WOBBLE_PHASE = 0.5;
/** Fraction of the way from one edge's start vertex to its end, for the edge's facing angle. */
const EDGE_MIDPOINT_FRACTION = 0.5;

/** Up and to the left, matching the light direction every other icon in this repo uses. */
const STONE_LIGHT_ANGLE = -2.2;
const HALF_TURN = Math.PI;
/**
 * Light to dark, spanning near-white to near-black. A subtler ramp collapses
 * into one grey blob at icon size and the facets stop reading as separate
 * planes, which is what makes an angular chunk look like a rounded pebble.
 */
const STONE_TONES = ['#c7cfdc', '#8b95a8', '#5c6678', '#333c4a', '#1c222c'] as const;
const STONE_OUTLINE = '#12151c';
const STONE_OUTLINE_WIDTH = 1.5;
const STONE_CRACK = '#12151c';
const STONE_CRACK_WIDTH = 1.4;

/** The crack's waypoints, as offsets from the chunk's centre — a jog, not a straight cut. */
const STONE_CRACK_P1_X = 0.06;
const STONE_CRACK_P1_Y = -0.32;
const STONE_CRACK_P2_X = -0.08;
const STONE_CRACK_P2_Y = -0.08;
const STONE_CRACK_P3_X = 0.08;
const STONE_CRACK_P3_Y = 0.1;
const STONE_CRACK_P4_X = -0.06;
const STONE_CRACK_P4_Y = 0.32;

function stoneVertexAt(index: number): readonly [number, number] {
  const wrapped = index % STONE_VERTEX_COUNT;
  const angle = STONE_ROTATION + (wrapped / STONE_VERTEX_COUNT) * FULL_CIRCLE;
  const wobble =
    1 +
    Math.sin(wrapped * STONE_WOBBLE_PRIMARY_STEP + STONE_WOBBLE_PHASE) *
      STONE_WOBBLE_PRIMARY_AMPLITUDE +
    Math.sin(wrapped * STONE_WOBBLE_SECONDARY_STEP) * STONE_WOBBLE_SECONDARY_AMPLITUDE;
  return [
    STONE_CX + Math.cos(angle) * STONE_RADIUS * wobble,
    STONE_CY + Math.sin(angle) * STONE_RADIUS * wobble,
  ];
}

/** 0 where a facet faces straight into the light, 1 where it faces fully away. */
function stoneLitness(angle: number): number {
  const raw = Math.abs(angle - STONE_LIGHT_ANGLE) % FULL_CIRCLE;
  const shortest = raw > HALF_TURN ? FULL_CIRCLE - raw : raw;
  return shortest / HALF_TURN;
}

function drawStoneIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  // Each facet is the triangle between the centre and one silhouette edge, so
  // the facets tile the whole chunk with no gaps to fill separately.
  for (let facet = 0; facet < STONE_VERTEX_COUNT; facet++) {
    const [startFx, startFy] = stoneVertexAt(facet);
    const [endFx, endFy] = stoneVertexAt(facet + 1);
    const facingAngle =
      STONE_ROTATION + ((facet + EDGE_MIDPOINT_FRACTION) / STONE_VERTEX_COUNT) * FULL_CIRCLE;
    const toneIndex = Math.round(stoneLitness(facingAngle) * (STONE_TONES.length - 1));

    ctx.fillStyle = STONE_TONES[toneIndex] ?? STONE_TONES[STONE_TONES.length - 1];
    ctx.beginPath();
    ctx.moveTo(x + size * STONE_CX, y + size * STONE_CY);
    ctx.lineTo(x + size * startFx, y + size * startFy);
    ctx.lineTo(x + size * endFx, y + size * endFy);
    ctx.closePath();
    ctx.fill();
    // A seam between facets, so two adjacent tones that land close together
    // still show a hard corner instead of blurring into one rounded shape.
    ctx.strokeStyle = STONE_OUTLINE;
    ctx.lineWidth = THIN_LINE_WIDTH;
    ctx.stroke();
  }

  ctx.strokeStyle = STONE_OUTLINE;
  ctx.lineWidth = STONE_OUTLINE_WIDTH;
  ctx.beginPath();
  for (let index = 0; index < STONE_VERTEX_COUNT; index++) {
    const [vx, vy] = stoneVertexAt(index);
    if (index === 0) ctx.moveTo(x + size * vx, y + size * vy);
    else ctx.lineTo(x + size * vx, y + size * vy);
  }
  ctx.closePath();
  ctx.stroke();

  ctx.strokeStyle = STONE_CRACK;
  ctx.lineWidth = STONE_CRACK_WIDTH;
  ctx.beginPath();
  ctx.moveTo(x + size * (STONE_CX + STONE_CRACK_P1_X), y + size * (STONE_CY + STONE_CRACK_P1_Y));
  ctx.lineTo(x + size * (STONE_CX + STONE_CRACK_P2_X), y + size * (STONE_CY + STONE_CRACK_P2_Y));
  ctx.lineTo(x + size * (STONE_CX + STONE_CRACK_P3_X), y + size * (STONE_CY + STONE_CRACK_P3_Y));
  ctx.lineTo(x + size * (STONE_CX + STONE_CRACK_P4_X), y + size * (STONE_CY + STONE_CRACK_P4_Y));
  ctx.stroke();
}

// ── Boards of Wood: three stacked planks with nail dots ─────────────────────

const BOARD_COUNT = 3;
const BOARD_TOP = 0.22;
const BOARD_HEIGHT = 0.15;
const BOARD_GAP = 0.06;
const BOARD_LEFT = 0.12;
const BOARD_WIDTH = 0.76;
const BOARD_COLOR = '#c99a5e';
const BOARD_COLOR_DARK = '#93692f';
const BOARD_HIGHLIGHT = 'rgba(255,255,255,0.35)';
const NAIL_COLOR = '#3a2a1a';
const NAIL_INSET = 0.1;
const NAIL_R = 0.022;
const HIGHLIGHT_LINE_HEIGHT = 1;

function drawWoodBoardIcon(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
): void {
  const left = x + size * BOARD_LEFT;
  const width = size * BOARD_WIDTH;

  for (let board = 0; board < BOARD_COUNT; board++) {
    const top = y + size * (BOARD_TOP + board * (BOARD_HEIGHT + BOARD_GAP));
    const height = size * BOARD_HEIGHT;

    ctx.fillStyle = BOARD_COLOR;
    ctx.fillRect(left, top, width, height);
    ctx.strokeStyle = BOARD_COLOR_DARK;
    ctx.lineWidth = OUTLINE_WIDTH;
    ctx.strokeRect(left, top, width, height);
    ctx.fillStyle = BOARD_HIGHLIGHT;
    ctx.fillRect(left, top, width, HIGHLIGHT_LINE_HEIGHT);

    ctx.fillStyle = NAIL_COLOR;
    for (const nx of [left + size * NAIL_INSET, left + width - size * NAIL_INSET]) {
      ctx.beginPath();
      ctx.arc(nx, top + height / 2, size * NAIL_R, 0, FULL_CIRCLE);
      ctx.fill();
    }
  }
}

// ── Rope: a coiled tan hank, wound as a spiral ──────────────────────────────

/**
 * A single ring reads as a donut or a magnifying glass at icon size, whatever
 * is added to its rim. A spiral — a strand winding inward over multiple turns
 * — is the shape that is unambiguously "coiled rope" instead, the way a real
 * hank looks set down on a table.
 */
const ROPE_CX = 0.5;
const ROPE_CY = 0.52;
const ROPE_INNER_R = 0.06;
const ROPE_OUTER_R = 0.34;
const ROPE_TURNS = 2.1;
const ROPE_STEPS_PER_TURN = 24;
const ROPE_STRAND_WIDTH = 0.09;
const ROPE_COLOR = '#c9a86a';
const ROPE_SHADE = '#9c7a42';
/** How much thicker than the base strand the shaded outer-turn pass is drawn. */
const ROPE_SHADE_WIDTH_FRACTION = 1.15;
const ROPE_HIGHLIGHT = 'rgba(255,238,204,0.55)';
/** Where along the spiral (0 = centre, 1 = rim) the shine sits. */
const ROPE_HIGHLIGHT_TURN_FRACTION = 0.72;
const ROPE_HIGHLIGHT_R = 0.05;
const ROPE_HIGHLIGHT_SQUASH = 0.6;
const ROPE_HIGHLIGHT_TILT = -0.5;

/** One point on the spiral, `turn` fractions of the way from the centre (0) to the rim (1). */
function ropeSpiralPoint(cx: number, cy: number, turn: number): readonly [number, number] {
  const angle = turn * ROPE_TURNS * FULL_CIRCLE;
  const radius = ROPE_INNER_R + (ROPE_OUTER_R - ROPE_INNER_R) * turn;
  return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius];
}

function traceRopeSpiral(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  size: number,
): void {
  const steps = Math.round(ROPE_TURNS * ROPE_STEPS_PER_TURN);
  ctx.beginPath();
  for (let step = 0; step <= steps; step++) {
    const [px, py] = ropeSpiralPoint(cx, cy, step / steps);
    const sx = cx + (px - cx) * size;
    const sy = cy + (py - cy) * size;
    if (step === 0) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
}

function drawRopeIcon(ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void {
  const cx = x + size * ROPE_CX;
  const cy = y + size * ROPE_CY;

  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  traceRopeSpiral(ctx, cx, cy, size);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = size * ROPE_STRAND_WIDTH + OUTLINE_WIDTH * 2;
  ctx.stroke();

  traceRopeSpiral(ctx, cx, cy, size);
  ctx.strokeStyle = ROPE_COLOR;
  ctx.lineWidth = size * ROPE_STRAND_WIDTH;
  ctx.stroke();

  // A shorter, shaded pass over the spiral's outer turn separates it from the
  // turn beneath, so the coil reads as wound strand rather than a flat disc.
  ctx.beginPath();
  const outerStartStep = Math.round(ROPE_STEPS_PER_TURN * (ROPE_TURNS - 1));
  const totalSteps = Math.round(ROPE_TURNS * ROPE_STEPS_PER_TURN);
  for (let step = outerStartStep; step <= totalSteps; step++) {
    const [px, py] = ropeSpiralPoint(cx, cy, step / totalSteps);
    const sx = cx + (px - cx) * size;
    const sy = cy + (py - cy) * size;
    if (step === outerStartStep) ctx.moveTo(sx, sy);
    else ctx.lineTo(sx, sy);
  }
  ctx.strokeStyle = ROPE_SHADE;
  ctx.lineWidth = size * ROPE_STRAND_WIDTH * ROPE_SHADE_WIDTH_FRACTION;
  ctx.stroke();

  const [hx, hy] = ropeSpiralPoint(cx, cy, ROPE_HIGHLIGHT_TURN_FRACTION);
  ctx.fillStyle = ROPE_HIGHLIGHT;
  ctx.beginPath();
  ctx.ellipse(
    cx + (hx - cx) * size,
    cy + (hy - cy) * size,
    size * ROPE_HIGHLIGHT_R,
    size * ROPE_HIGHLIGHT_R * ROPE_HIGHLIGHT_SQUASH,
    ROPE_HIGHLIGHT_TILT,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();

  ctx.lineCap = 'butt';
  ctx.lineJoin = 'miter';
}

/** Draws one resource's icon into a square icon region at `x`,`y`. */
export function drawResourceIcon(
  ctx: CanvasRenderingContext2D,
  id: ResourceIconId,
  x: number,
  y: number,
  size: number,
): void {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();

  switch (id) {
    case 'wood':
      drawWoodIcon(ctx, x, y, size);
      break;
    case 'stone':
      drawStoneIcon(ctx, x, y, size);
      break;
    case 'wood_board':
      drawWoodBoardIcon(ctx, x, y, size);
      break;
    case 'rope':
      drawRopeIcon(ctx, x, y, size);
      break;
  }

  ctx.restore();
}
