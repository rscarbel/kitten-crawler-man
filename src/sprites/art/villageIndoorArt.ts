/**
 * Briar Hollow's furniture and fittings: everything that stands inside a
 * building.
 *
 * Each painter receives the footprint's bottom-left tile as its origin; see
 * `VillagePropFrame` in `villageArt.ts` for the contract.
 *
 * Every measurement here is in tiles, and vertical positions are "up" — tiles
 * above the footprint's bottom edge — because that is how the 3/4 view reads
 * height: a point at ground depth `d` on a surface raised `h` is drawn `d + h`
 * up. A table top 0.5 high whose front edge stands 0.15 into its tile starts
 * at up 0.65. Writing the geometry that way keeps each prop's numbers
 * comparable with the live overlay anchors, which use the same convention.
 *
 * Indoor props stand on a dark oiled plank floor, so every silhouette carries
 * an ink outline and a lit top edge; without them the walnut furniture
 * dissolves into the boards it stands on.
 */

import { range, type Rng } from '../person/rng';
import { fillSoftEllipse } from './softShade';
import {
  BRASS,
  CLOTH,
  COOKING_CHIMNEY_TOP,
  COOKING_FIRE,
  COOKING_POT,
  FLAME,
  FORGE_CHIMNEY_TOP,
  FORGE_COALS,
  HALL_HEARTH_CHIMNEY_TOP,
  HALL_HEARTH_FIRE,
  INK,
  IRON,
  LOG,
  STONE,
  TOOL_RACK_AXE_TOP,
  TOOL_RACK_PICK_TOP,
  WOOD,
  drawBriarKnot,
  drawContactShadow,
  drawFieldstones,
  drawLogEnd,
  drawPlanks,
  footprintBox,
  forkRng,
  inkOutline,
  jitter,
  type ClothColour,
  type Ctx,
  type IndoorPropId,
  type PlankDirection,
  type VillagePropArt,
  type VillagePropFrame,
  type VillagePropPainter,
} from './villageArt';

// ── Local palette ─────────────────────────────────────────────────────────────

/** Fired clay: bowls, crocks, mugs and jars. */
const CLAY = { dark: '#4e2e20', body: '#83503a', light: '#a87052', glaze: '#c8906a' } as const;
const PARCHMENT = { dark: '#9c8a62', body: '#d2c294', light: '#ece0bc' } as const;
const BURLAP = { dark: '#5e4a2c', body: '#8c7448', light: '#ae9462' } as const;
const HERB = { dark: '#34401e', body: '#56642e', light: '#7c8a44', bloom: '#7c5c8a' } as const;
const GLASS = { dark: '#2e4a3e', body: '#4e7262', light: '#8cb09a' } as const;
const COAL = { body: '#1a1817', lump: '#34302e', glint: '#56504c' } as const;
/** Guardhouse issue: blue-grey wool. */
const GUARD_WOOL = { dark: '#243a58', body: '#44506a', light: '#5e6a82' } as const;

/** Three tones of one material, darkest first. */
interface Tone {
  readonly dark: string;
  readonly body: string;
  readonly light: string;
}
const SOOT = '#141110';
/** Plain black for shadows that are cast rather than contact shadows. */
const SHADE = '#000000';
/** Fresh-laundered linen, a step brighter than `CLOTH.linen.light`: pillows and bandage faces. */
const BLEACHED_LINEN = '#f2ead6';
/** A forge's quench water: black with soot, a dull oily sheen on top. */
const QUENCH_WATER = { body: '#161c1c', sheen: '#34403e', oilSlick: '#3a2a40' } as const;
const WASH_WATER = { body: '#5a6c70', light: '#8ea2a4' } as const;
/** Tikka's blue sheet is woad-dyed paper, dull and a little foxed, not a modern cyanotype. */
const BLUEPRINT = { paper: '#384e66', foxing: '#8a7a50', line: '#c4ccce' } as const;
/** Stew in a pot or a bowl: brown broth with a pale fleck of fat. */
const STEW = { body: '#6a4020', light: '#a0703a' } as const;
const BREAD = { dark: '#7a4a1e', body: '#b07a3a', light: '#d4a462' } as const;
/** Spilled lamp oil soaked into the floor. */
const OIL_STAIN = '#0c0a08';

// ── The pen: tile-unit drawing ────────────────────────────────────────────────

/** Outline width, in tiles: about 1.8 px at the sheet's 64 px a tile. */
const OUTLINE_TILES = 0.028;
/** Interior line work (seams, straps, rungs) is lighter than the silhouette's. */
const DETAIL_OUTLINE_SHARE = 0.7;

interface Pen {
  readonly ctx: Ctx;
  readonly rng: Rng;
  /** Pixel x of a point `tiles` right of the footprint's left edge. */
  x(tiles: number): number;
  /** Pixel y of a point `up` tiles above the footprint's bottom edge. */
  y(up: number): number;
  /** A length in tiles, as pixels. */
  s(tiles: number): number;
  readonly outline: number;
  readonly detail: number;
}

function makePen(ctx: Ctx, frame: VillagePropFrame, rng: Rng): Pen {
  const box = footprintBox(frame);
  const tile = frame.tileScale;
  const outline = Math.max(1, tile * OUTLINE_TILES);
  return {
    ctx,
    rng,
    x: (tiles) => box.left + tiles * tile,
    y: (up) => box.bottom - up * tile,
    s: (tiles) => tiles * tile,
    outline,
    detail: outline * DETAIL_OUTLINE_SHARE,
  };
}

/** The detail line width, in tiles, for passing to a tile-unit stroke. */
function detailTiles(p: Pen): number {
  return p.detail / p.s(1);
}

/** Wraps a pen-based body as a sheet painter, restoring canvas state whatever it does. */
function painter(body: (pen: Pen, variant: number) => void): VillagePropPainter {
  return (ctx, frame, variant, rng) => {
    ctx.save();
    try {
      body(makePen(ctx, frame, rng), variant);
    } finally {
      ctx.restore();
    }
  };
}

/** A point in tiles: `[x, up]`. */
type Point = readonly [number, number];

const TAU = Math.PI * 2;

function tracePolygon(p: Pen, points: ReadonlyArray<Point>): void {
  p.ctx.beginPath();
  points.forEach(([x, up], index) => {
    if (index === 0) p.ctx.moveTo(p.x(x), p.y(up));
    else p.ctx.lineTo(p.x(x), p.y(up));
  });
  p.ctx.closePath();
}

function fillPolygon(
  p: Pen,
  points: ReadonlyArray<Point>,
  colour: string,
  outlineWidth: number | null = p.outline,
): void {
  tracePolygon(p, points);
  p.ctx.fillStyle = colour;
  p.ctx.fill();
  if (outlineWidth !== null) inkOutline(p.ctx, outlineWidth);
}

function traceRect(p: Pen, x0: number, x1: number, up0: number, up1: number): void {
  p.ctx.beginPath();
  p.ctx.rect(p.x(x0), p.y(up1), p.s(x1 - x0), p.s(up1 - up0));
}

function fillRect(
  p: Pen,
  x0: number,
  x1: number,
  up0: number,
  up1: number,
  colour: string,
  outlineWidth: number | null = p.outline,
): void {
  traceRect(p, x0, x1, up0, up1);
  p.ctx.fillStyle = colour;
  p.ctx.fill();
  if (outlineWidth !== null) inkOutline(p.ctx, outlineWidth);
}

function fillRounded(
  p: Pen,
  x0: number,
  x1: number,
  up0: number,
  up1: number,
  radius: number,
  colour: string,
  outlineWidth: number | null = p.outline,
): void {
  const width = p.s(x1 - x0);
  const height = p.s(up1 - up0);
  p.ctx.beginPath();
  p.ctx.roundRect(p.x(x0), p.y(up1), width, height, Math.min(p.s(radius), width / 2, height / 2));
  p.ctx.fillStyle = colour;
  p.ctx.fill();
  if (outlineWidth !== null) inkOutline(p.ctx, outlineWidth);
}

function fillEllipse(
  p: Pen,
  cx: number,
  cUp: number,
  rx: number,
  ry: number,
  colour: string,
  outlineWidth: number | null = p.outline,
): void {
  p.ctx.beginPath();
  p.ctx.ellipse(p.x(cx), p.y(cUp), p.s(rx), p.s(ry), 0, 0, TAU);
  p.ctx.fillStyle = colour;
  p.ctx.fill();
  if (outlineWidth !== null) inkOutline(p.ctx, outlineWidth);
}

function strokePath(
  p: Pen,
  points: ReadonlyArray<Point>,
  widthTiles: number,
  colour: string,
  cap: CanvasLineCap = 'round',
): void {
  const { ctx } = p;
  ctx.strokeStyle = colour;
  ctx.lineWidth = p.s(widthTiles);
  ctx.lineCap = cap;
  ctx.lineJoin = 'round';
  ctx.beginPath();
  points.forEach(([x, up], index) => {
    if (index === 0) ctx.moveTo(p.x(x), p.y(up));
    else ctx.lineTo(p.x(x), p.y(up));
  });
  ctx.stroke();
}

/** A stroked rod with an ink edge: the stroke is laid twice, ink first and wider. */
function inkedRod(
  p: Pen,
  points: ReadonlyArray<Point>,
  widthTiles: number,
  colour: string,
  cap: CanvasLineCap = 'round',
): void {
  const inkWidthTiles = widthTiles + (p.outline * 2) / p.s(1);
  strokePath(p, points, inkWidthTiles, INK, cap);
  strokePath(p, points, widthTiles, colour, cap);
}

/** An ellipse stroked as a ring rather than filled: a rope coil, the spiral on a cloth bolt. */
function strokeEllipse(
  p: Pen,
  cx: number,
  cUp: number,
  rx: number,
  ry: number,
  colour: string,
  lineWidth: number,
): void {
  p.ctx.beginPath();
  p.ctx.ellipse(p.x(cx), p.y(cUp), p.s(rx), p.s(ry), 0, 0, TAU);
  p.ctx.strokeStyle = colour;
  p.ctx.lineWidth = lineWidth;
  p.ctx.stroke();
}

function withAlpha(p: Pen, alpha: number, paint: () => void): void {
  const previous = p.ctx.globalAlpha;
  p.ctx.globalAlpha = previous * alpha;
  try {
    paint();
  } finally {
    p.ctx.globalAlpha = previous;
  }
}

function clipTo(p: Pen, trace: () => void, paint: () => void): void {
  p.ctx.save();
  try {
    trace();
    p.ctx.clip();
    paint();
  } finally {
    p.ctx.restore();
  }
}

/** Nail chance for a panel whose nails would be clutter: a hob, a board face, a bed end. */
const NO_NAILS = 0;
/** Nail chance for a board where every end is nailed: a rack's tray front. */
const ALL_NAILED = 1;
const DEFAULT_PANEL_NAIL_CHANCE = 0.25;

function planks(
  p: Pen,
  x0: number,
  x1: number,
  up0: number,
  up1: number,
  direction: PlankDirection,
  boardTiles: number,
  base: string = WOOD.body,
  nailChance = DEFAULT_PANEL_NAIL_CHANCE,
): void {
  drawPlanks(p.ctx, p.x(x0), p.y(up1), p.s(x1 - x0), p.s(up1 - up0), forkRng(p.rng), {
    direction,
    boardPx: p.s(boardTiles),
    base,
    nailChance,
  });
}

/** A fieldstone panel filling a rectangle, outlined. */
function stones(
  p: Pen,
  x0: number,
  x1: number,
  up0: number,
  up1: number,
  stoneTiles: number,
): void {
  drawFieldstones(
    p.ctx,
    p.x(x0),
    p.y(up1),
    p.s(x1 - x0),
    p.s(up1 - up0),
    forkRng(p.rng),
    p.s(stoneTiles),
  );
  calmStone(p, () => traceRect(p, x0, x1, up0, up1));
  traceRect(p, x0, x1, up0, up1);
  inkOutline(p.ctx, p.outline);
}

/**
 * The shared fieldstone is laid for sunlit outside walls; indoors, in a mass
 * as big as a chimney breast, its light stones out-shout everything in the
 * room. A dark wash pulls it back to a backdrop.
 */
function calmStone(p: Pen, trace: () => void): void {
  withAlpha(p, STONE_CALM_ALPHA, () => {
    trace();
    p.ctx.fillStyle = STONE.deep;
    p.ctx.fill();
  });
}
const STONE_CALM_ALPHA = 0.3;

/** Fieldstone laid inside an arbitrary outline: a hood, a chimney breast. */
function stonesInPolygon(p: Pen, points: ReadonlyArray<Point>, stoneTiles: number): void {
  const xs = points.map(([x]) => x);
  const ups = points.map(([, up]) => up);
  const x0 = Math.min(...xs);
  const x1 = Math.max(...xs);
  const up0 = Math.min(...ups);
  const up1 = Math.max(...ups);
  clipTo(
    p,
    () => tracePolygon(p, points),
    () =>
      drawFieldstones(
        p.ctx,
        p.x(x0),
        p.y(up1),
        p.s(x1 - x0),
        p.s(up1 - up0),
        forkRng(p.rng),
        p.s(stoneTiles),
      ),
  );
  calmStone(p, () => tracePolygon(p, points));
  tracePolygon(p, points);
  inkOutline(p.ctx, p.outline);
}

function shadow(p: Pen, cx: number, cUp: number, rx: number, ry: number, alpha?: number): void {
  drawContactShadow(p.ctx, p.x(cx), p.y(cUp), p.s(rx), p.s(ry), alpha);
}

/** A soft dark bloom: soot on stone, a damp patch, a stain on the floor. */
function stain(
  p: Pen,
  cx: number,
  cUp: number,
  rx: number,
  ry: number,
  colour: string,
  alpha: number,
): void {
  fillSoftEllipse(p.ctx, p.x(cx), p.y(cUp), p.s(rx), p.s(ry), colour, alpha, 0, STAIN_CORE);
}
const STAIN_CORE = 0.3;

/** The middle of a one-tile-wide footprint, where a single prop's shadow centres. */
const TILE_MIDDLE = 0.5;
/** The middle of a two-tile-wide footprint. */
const PAIR_MIDDLE = 1;
/** Height of a contact shadow on the floor under most props. */
const FLOOR_SHADOW_RY = 0.08;
/** A slimmer floor shadow for props that stand on legs or a narrow base. */
const SLIM_SHADOW_RY = 0.07;
/** Half-width of the floor shadow under a prop filling a two-tile footprint. */
const PAIR_SHADOW_RX = 0.9;

// ── Furniture parts ───────────────────────────────────────────────────────────

/** The board width of every table, desk and counter top. */
const TOP_BOARD_TILES = 0.16;
/** How much of a slab's front edge catches the light. */
const LIP_TILES = 0.022;
const LIP_ALPHA = 0.55;
const TOP_SEAM_ALPHA = 0.6;

interface SlabSpec {
  readonly x0: number;
  readonly x1: number;
  /** Up of the top face's front edge. */
  readonly topFront: number;
  /** Up of the top face's back edge. */
  readonly topBack: number;
  /** Height of the front apron below the top face. */
  readonly apron: number;
  readonly top?: string;
  readonly front?: string;
}

/**
 * A raised wooden surface in 3/4 view: a planked top face above a darker
 * front apron, one outline round both, the front edge lit.
 */
function slab(p: Pen, spec: SlabSpec): void {
  const apronBottom = spec.topFront - spec.apron;
  planks(
    p,
    spec.x0,
    spec.x1,
    spec.topFront,
    spec.topBack,
    'horizontal',
    TOP_BOARD_TILES,
    spec.top ?? WOOD.mid,
  );
  fillRect(p, spec.x0, spec.x1, apronBottom, spec.topFront, spec.front ?? WOOD.dark, null);
  litLip(p, spec.x0, spec.x1, spec.topFront, WOOD.highlight);
  withAlpha(p, TOP_SEAM_ALPHA, () =>
    strokePath(
      p,
      [
        [spec.x0, spec.topFront],
        [spec.x1, spec.topFront],
      ],
      detailTiles(p),
      INK,
      'butt',
    ),
  );
  traceRect(p, spec.x0, spec.x1, apronBottom, spec.topBack);
  inkOutline(p.ctx, p.outline);
}

/** The thin lit strip along a front edge at `edgeUp`. */
function litLip(p: Pen, x0: number, x1: number, edgeUp: number, colour: string): void {
  withAlpha(p, LIP_ALPHA, () => fillRect(p, x0, x1, edgeUp - LIP_TILES, edgeUp, colour, null));
}

const LEG_LIGHT_SHARE = 0.3;

/** A square wooden leg with its lit left face. */
function leg(p: Pen, cx: number, width: number, up0: number, up1: number): void {
  const x0 = cx - width / 2;
  const x1 = cx + width / 2;
  fillRect(p, x0, x1, up0, up1, WOOD.dark);
  fillRect(p, x0, x0 + width * LEG_LIGHT_SHARE, up0, up1, WOOD.body, null);
}

/** A worn, polished patch where hands, elbows and tails rest. */
function wornSpot(p: Pen, cx: number, cUp: number, rx: number, ry: number): void {
  fillSoftEllipse(p.ctx, p.x(cx), p.y(cUp), p.s(rx), p.s(ry), WOOD.worn, WORN_ALPHA);
}
const WORN_ALPHA = 0.22;

/** A log-ended post: a dark upright capped with its cut end. */
function postWithEnd(
  p: Pen,
  cx: number,
  half: number,
  up0: number,
  up1: number,
  colour: string,
): void {
  fillRect(p, cx - half, cx + half, up0, up1, colour);
  drawLogEnd(p.ctx, p.x(cx), p.y(up1), p.s(half), p.s(half * RIM_SQUASH));
}

// ── Small objects ─────────────────────────────────────────────────────────────

/** How deep a bowl's body hangs below its rim, as a share of its radius. */
const BOWL_DEPTH_SHARE = 0.7;
/** The rim ellipse's height, as a share of its width, in the 3/4 view. */
const RIM_SQUASH = 0.36;
const CONTENT_INSET_SHARE = 0.78;

function bowl(
  p: Pen,
  cx: number,
  upRim: number,
  rx: number,
  contents: string | null,
  colour: string = CLAY.body,
): void {
  const { ctx } = p;
  ctx.beginPath();
  ctx.ellipse(p.x(cx), p.y(upRim), p.s(rx), p.s(rx * BOWL_DEPTH_SHARE), 0, 0, Math.PI);
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  inkOutline(ctx, p.outline);
  fillEllipse(p, cx, upRim, rx, rx * RIM_SQUASH, CLAY.light, p.detail);
  fillEllipse(
    p,
    cx,
    upRim - rx * RIM_SQUASH * (1 - CONTENT_INSET_SHARE),
    rx * CONTENT_INSET_SHARE,
    rx * RIM_SQUASH * CONTENT_INSET_SHARE,
    contents ?? CLAY.dark,
    null,
  );
}

const PLATE_WELL_SHARE = 0.62;

function plate(p: Pen, cx: number, cUp: number, rx: number): void {
  fillEllipse(p, cx, cUp, rx, rx * RIM_SQUASH, CLAY.glaze, p.detail);
  fillEllipse(
    p,
    cx,
    cUp,
    rx * PLATE_WELL_SHARE,
    rx * RIM_SQUASH * PLATE_WELL_SHARE,
    CLAY.light,
    null,
  );
}

const MUG_HANDLE_SHARE = 0.34;

function mug(p: Pen, cx: number, upBase: number, width: number, height: number): void {
  const half = width / 2;
  const handleRadius = height * MUG_HANDLE_SHARE;
  p.ctx.beginPath();
  p.ctx.arc(p.x(cx + half), p.y(upBase + height / 2), p.s(handleRadius), -Math.PI / 2, Math.PI / 2);
  p.ctx.strokeStyle = INK;
  p.ctx.lineWidth = p.s(width * MUG_HANDLE_SHARE);
  p.ctx.stroke();
  fillRect(p, cx - half, cx + half, upBase, upBase + height, WOOD.light);
  fillEllipse(p, cx, upBase + height, half, half * RIM_SQUASH, WOOD.deep, p.detail);
}

/** How narrow a jar's neck is, and how tall, as shares of its body. */
const JAR_NECK_SHARE = 0.62;
const JAR_NECK_HEIGHT_SHARE = 0.14;
const JAR_LID_HEIGHT_SHARE = 0.14;
const JAR_SHINE_SHARE = 0.18;
const JAR_SHINE_ALPHA = 0.45;
const JAR_LABEL_SHARE = 0.34;

interface JarSpec {
  readonly cx: number;
  readonly upBase: number;
  readonly width: number;
  readonly height: number;
  readonly body: string;
  readonly lid: string;
  readonly label?: boolean;
}

function jar(p: Pen, spec: JarSpec): void {
  const { cx, upBase, width, height } = spec;
  const half = width / 2;
  const neckHalf = half * JAR_NECK_SHARE;
  const shoulder = upBase + height * (1 - JAR_NECK_HEIGHT_SHARE - JAR_LID_HEIGHT_SHARE);
  const neckTop = upBase + height * (1 - JAR_LID_HEIGHT_SHARE);
  fillRect(p, cx - neckHalf, cx + neckHalf, shoulder, neckTop, spec.body);
  fillRounded(p, cx - half, cx + half, upBase, shoulder, half * JAR_NECK_SHARE, spec.body);
  withAlpha(p, JAR_SHINE_ALPHA, () =>
    fillRounded(
      p,
      cx - half * (1 - JAR_SHINE_SHARE),
      cx - half * (1 - JAR_SHINE_SHARE * 2),
      upBase + height * JAR_SHINE_SHARE,
      shoulder - height * JAR_SHINE_SHARE,
      width,
      GLASS.light,
      null,
    ),
  );
  if (spec.label === true) {
    const labelHeight = (shoulder - upBase) * JAR_LABEL_SHARE;
    const labelBase = upBase + (shoulder - upBase - labelHeight) / 2;
    fillRect(
      p,
      cx - half * JAR_NECK_SHARE,
      cx + half * JAR_NECK_SHARE,
      labelBase,
      labelBase + labelHeight,
      PARCHMENT.body,
      p.detail,
    );
  }
  fillRounded(
    p,
    cx - neckHalf * (1 + JAR_SHINE_SHARE),
    cx + neckHalf * (1 + JAR_SHINE_SHARE),
    neckTop,
    upBase + height,
    neckHalf,
    spec.lid,
    p.detail,
  );
}

const CANDLE = {
  width: 0.05,
  dishRx: 0.07,
  flameRx: 0.024,
  flameRy: 0.045,
  /** The flame's hot core sits low in the flame, as a share of its height. */
  coreLiftShare: 0.62,
} as const;

/** A tallow candle in a brass dish. The flame is tiny and baked: it does not need to move. */
function candle(p: Pen, cx: number, upBase: number, height: number): void {
  const half = CANDLE.width / 2;
  fillEllipse(p, cx, upBase, CANDLE.dishRx, CANDLE.dishRx * RIM_SQUASH, BRASS.body);
  fillRect(p, cx - half, cx + half, upBase, upBase + height, CLOTH.linen.light, p.detail);
  fillEllipse(
    p,
    cx,
    upBase + height + CANDLE.flameRy,
    CANDLE.flameRx,
    CANDLE.flameRy,
    FLAME.mid,
    null,
  );
  fillEllipse(
    p,
    cx,
    upBase + height + CANDLE.flameRy * CANDLE.coreLiftShare,
    CANDLE.flameRx / 2,
    CANDLE.flameRy / 2,
    FLAME.core,
    null,
  );
}

const LOAF = {
  scores: 3,
  crustShiftShare: 0.18,
  crustLiftShare: 0.34,
  crustRxShare: 0.6,
  crustRyShare: 0.4,
  scoreSpanShare: 1.4,
  scoreSlantShare: 0.12,
  scoreLengthShare: 0.35,
} as const;

function loaf(p: Pen, cx: number, cUp: number, rx: number): void {
  const ry = rx * BOWL_DEPTH_SHARE;
  fillEllipse(p, cx, cUp, rx, ry, BREAD.body);
  fillEllipse(
    p,
    cx - rx * LOAF.crustShiftShare,
    cUp + ry * LOAF.crustLiftShare,
    rx * LOAF.crustRxShare,
    ry * LOAF.crustRyShare,
    BREAD.light,
    null,
  );
  for (let score = 0; score < LOAF.scores; score++) {
    const sx = cx + ((score + 1) / (LOAF.scores + 1) - 0.5) * rx * LOAF.scoreSpanShare;
    strokePath(
      p,
      [
        [sx - rx * LOAF.scoreSlantShare, cUp - ry * LOAF.scoreLengthShare],
        [sx + rx * LOAF.scoreSlantShare, cUp + ry * LOAF.scoreLengthShare],
      ],
      detailTiles(p),
      BREAD.dark,
    );
  }
}

const PAPER = {
  writingLines: 3,
  lineStartShare: 0.7,
  lineEndShare: 0.6,
  /** The last line of writing stops short, the way a paragraph does. */
  lastLineEndShare: 0.1,
  writingAlpha: 0.45,
} as const;

/** A sheet of paper lying on a surface, slightly askew. */
function paper(p: Pen, cx: number, cUp: number, halfW: number, halfH: number, skew: number): void {
  fillPolygon(
    p,
    [
      [cx - halfW + skew, cUp + halfH],
      [cx + halfW + skew, cUp + halfH],
      [cx + halfW - skew, cUp - halfH],
      [cx - halfW - skew, cUp - halfH],
    ],
    PARCHMENT.light,
    p.detail,
  );
  const lines = PAPER.writingLines;
  for (let line = 1; line <= lines; line++) {
    const lineUp = cUp + halfH - (line / (lines + 1)) * halfH * 2;
    withAlpha(p, PAPER.writingAlpha, () =>
      strokePath(
        p,
        [
          [cx - halfW * PAPER.lineStartShare, lineUp],
          [cx + halfW * (line === lines ? PAPER.lastLineEndShare : PAPER.lineEndShare), lineUp],
        ],
        detailTiles(p),
        INK,
        'butt',
      ),
    );
  }
}

// ── Fire, embers and flues ────────────────────────────────────────────────────

const EMBER = {
  spots: 7,
  spotTiles: 0.035,
  dimAlpha: 0.55,
  hotAlpha: 0.4,
  glowShare: 0.9,
  angleJitter: 0.4,
  reachMin: 0.2,
  reachMax: 0.75,
  spotSquash: 0.7,
  hotRxShare: 0.7,
  hotRyShare: 0.4,
  hotLiftShare: 0.5,
  /** Every other ember carries a hot orange cap. */
  hotEvery: 2,
} as const;

/**
 * A bed of banked embers, painted dim and dark red: the live flicker is laid
 * over it, so a baked-bright fire would double up and blow out.
 */
function emberBed(p: Pen, cx: number, cUp: number, rx: number, ry: number): void {
  fillEllipse(p, cx, cUp, rx, ry, COAL.body, null);
  stain(p, cx, cUp, rx * EMBER.glowShare, ry * EMBER.glowShare, FLAME.ember, EMBER.dimAlpha);
  const rng = forkRng(p.rng);
  for (let spot = 0; spot < EMBER.spots; spot++) {
    const angle = (spot / EMBER.spots) * TAU + jitter(rng, EMBER.angleJitter);
    const reach = range(rng, EMBER.reachMin, EMBER.reachMax);
    const sx = cx + Math.cos(angle) * rx * reach;
    const sUp = cUp + Math.sin(angle) * ry * reach;
    fillEllipse(p, sx, sUp, EMBER.spotTiles, EMBER.spotTiles * EMBER.spotSquash, COAL.lump, null);
    if (spot % EMBER.hotEvery === 0) {
      withAlpha(p, EMBER.hotAlpha, () =>
        fillEllipse(
          p,
          sx,
          sUp - EMBER.spotTiles * EMBER.hotLiftShare,
          EMBER.spotTiles * EMBER.hotRxShare,
          EMBER.spotTiles * EMBER.hotRyShare,
          FLAME.edge,
          null,
        ),
      );
    }
  }
}

const CHARRED_LOGS = {
  rodShare: 0.32,
  firstDropShare: 0.4,
  firstReachShare: 0.4,
  firstRiseShare: 0.5,
  secondDropShare: 0.3,
  secondReachShare: 0.3,
  secondRiseShare: 0.6,
} as const;

/** Two charred log stubs crossed in a firebox. */
function charredLogs(p: Pen, cx: number, cUp: number, halfSpan: number): void {
  const rod = halfSpan * CHARRED_LOGS.rodShare;
  inkedRod(
    p,
    [
      [cx - halfSpan, cUp - rod * CHARRED_LOGS.firstDropShare],
      [cx + halfSpan * CHARRED_LOGS.firstReachShare, cUp + rod * CHARRED_LOGS.firstRiseShare],
    ],
    rod,
    LOG.barkDark,
  );
  inkedRod(
    p,
    [
      [cx + halfSpan, cUp - rod * CHARRED_LOGS.secondDropShare],
      [cx - halfSpan * CHARRED_LOGS.secondReachShare, cUp + rod * CHARRED_LOGS.secondRiseShare],
    ],
    rod,
    LOG.barkDark,
  );
}

const FLUE_CAP_HEIGHT_TILES = 0.1;
const FLUE_MOUTH_SHARE = 0.72;
const FLUE_RIM_SQUASH = 0.28;

/**
 * A chimney stack's capstone with its dark mouth centred on `mouthUp` — the
 * overlay anchor the smoke starts from.
 */
function flueCap(p: Pen, cx: number, mouthUp: number, halfW: number): void {
  const rimRy = halfW * FLUE_RIM_SQUASH;
  fillRect(p, cx - halfW, cx + halfW, mouthUp - FLUE_CAP_HEIGHT_TILES, mouthUp, STONE.light);
  fillEllipse(p, cx, mouthUp, halfW, rimRy, STONE.highlight);
  fillEllipse(p, cx, mouthUp, halfW * FLUE_MOUTH_SHARE, rimRy * FLUE_MOUTH_SHARE, SOOT, null);
}

/** Round-topped firebox opening with a soot-black throat. */
function traceArch(p: Pen, cx: number, halfW: number, up0: number, spring: number): void {
  const { ctx } = p;
  ctx.beginPath();
  ctx.moveTo(p.x(cx - halfW), p.y(up0));
  ctx.lineTo(p.x(cx - halfW), p.y(spring));
  ctx.ellipse(p.x(cx), p.y(spring), p.s(halfW), p.s(halfW), 0, Math.PI, TAU);
  ctx.lineTo(p.x(cx + halfW), p.y(up0));
  ctx.closePath();
}

const FIREBOX_GLOW = { alpha: 0.4, widthShare: 1.1, heightShare: 0.9 } as const;

function firebox(p: Pen, cx: number, halfW: number, up0: number, spring: number): void {
  traceArch(p, cx, halfW, up0, spring);
  p.ctx.fillStyle = SOOT;
  p.ctx.fill();
  clipTo(
    p,
    () => traceArch(p, cx, halfW, up0, spring),
    () =>
      stain(
        p,
        cx,
        up0,
        halfW * FIREBOX_GLOW.widthShare,
        (spring - up0) * FIREBOX_GLOW.heightShare,
        FLAME.ember,
        FIREBOX_GLOW.alpha,
      ),
  );
  traceArch(p, cx, halfW, up0, spring);
  inkOutline(p.ctx, p.outline);
}

/** How deep a fire's ember bed sits below its overlay anchor, and the logs on it. */
const HEARTH_EMBERS = {
  bedDrop: 0.1,
  logDrop: 0.06,
  bedWidthShare: 0.75,
  logSpanShare: 0.6,
  /** A small hearth's ember bed hangs this far above its floor. */
  firebox: 0.04,
} as const;

/** A wooden mantel beam with its lit top edge. */
function mantel(p: Pen, x0: number, x1: number, up0: number, up1: number): void {
  fillRect(p, x0, x1, up0, up1, WOOD.body);
  fillRect(p, x0, x1, up1 - MANTEL_LIT_TILES, up1, WOOD.light, null);
}
const MANTEL_LIT_TILES = 0.03;

// ── Racks ─────────────────────────────────────────────────────────────────────

const RACK = {
  postLeft: 0.1,
  postRight: 0.9,
  postWidth: 0.1,
  postBase: 0.2,
  postLightShare: 0.3,
  trayX0: 0.12,
  trayX1: 0.88,
  trayBottom: 0.14,
  trayTop: 0.32,
  trayBack: 0.5,
  handleWidth: 0.065,
  handleBase: 0.38,
  handleShineX0Share: 0.5,
  handleShineX1Share: 0.05,
  barWidthTiles: 0.08,
  barLightShare: 0.4,
  notchWidthShare: 1.6,
  shadowRx: 0.42,
} as const;

/** The two log posts and the floor tray every rack stands on; the backboard is optional. */
function rackFrame(p: Pen, postTop: number, backboard: { up0: number; up1: number } | null): void {
  shadow(p, TILE_MIDDLE, RACK.trayBottom, RACK.shadowRx, FLOOR_SHADOW_RY);
  const postHalf = RACK.postWidth / 2;
  for (const cx of [RACK.postLeft + postHalf, RACK.postRight - postHalf]) {
    fillRect(p, cx - postHalf, cx + postHalf, RACK.postBase, postTop, LOG.bark);
    fillRect(
      p,
      cx - postHalf,
      cx - postHalf * RACK.postLightShare,
      RACK.postBase,
      postTop,
      LOG.barkLight,
      null,
    );
    drawLogEnd(p.ctx, p.x(cx), p.y(postTop), p.s(postHalf), p.s(postHalf * RIM_SQUASH));
  }
  if (backboard !== null) {
    planks(
      p,
      RACK.postLeft + RACK.postWidth,
      RACK.postRight - RACK.postWidth,
      backboard.up0,
      backboard.up1,
      'horizontal',
      TOP_BOARD_TILES,
      WOOD.dark,
    );
    traceRect(
      p,
      RACK.postLeft + RACK.postWidth,
      RACK.postRight - RACK.postWidth,
      backboard.up0,
      backboard.up1,
    );
    inkOutline(p.ctx, p.detail);
  }
  fillRect(p, RACK.trayX0, RACK.trayX1, RACK.trayTop, RACK.trayBack, WOOD.deep);
}

/** The tray's front board, drawn after the tools so their feet sit inside it. */
function rackTrayFront(p: Pen): void {
  planks(
    p,
    RACK.trayX0,
    RACK.trayX1,
    RACK.trayBottom,
    RACK.trayTop,
    'horizontal',
    RACK.trayTop - RACK.trayBottom,
    WOOD.body,
    ALL_NAILED,
  );
  traceRect(p, RACK.trayX0, RACK.trayX1, RACK.trayBottom, RACK.trayBack);
  inkOutline(p.ctx, p.outline);
}

/** A notched crossbar that holds the handles upright; drawn over them. */
function rackBar(p: Pen, barUp: number, handleXs: ReadonlyArray<number>): void {
  const half = RACK.barWidthTiles / 2;
  fillRect(p, RACK.postLeft, RACK.postRight, barUp - half, barUp + half, WOOD.body);
  fillRect(
    p,
    RACK.postLeft,
    RACK.postRight,
    barUp + half * RACK.barLightShare,
    barUp + half,
    WOOD.light,
    null,
  );
  for (const hx of handleXs) {
    const notch = (RACK.handleWidth * RACK.notchWidthShare) / 2;
    fillRect(p, hx - notch, hx + notch, barUp - half, barUp + half, WOOD.deep, p.detail);
  }
}

/** A plain wooden tool handle, standing in the tray. */
function handle(p: Pen, cx: number, top: number, colour: string = WOOD.light): void {
  const half = RACK.handleWidth / 2;
  fillRounded(p, cx - half, cx + half, RACK.handleBase, top, half, colour);
  fillRect(
    p,
    cx - half * RACK.handleShineX0Share,
    cx - half * RACK.handleShineX1Share,
    RACK.handleBase,
    top - half,
    WOOD.highlight,
    null,
  );
}

// ── Forge ─────────────────────────────────────────────────────────────────────

const FORGE = {
  blockLeft: 0.06,
  blockRight: 1.94,
  blockBottom: 0.08,
  topFront: 0.58,
  topBack: 1.48,
  wallLeft: 0.12,
  wallRight: 1.88,
  wallBottom: 1.36,
  wallShoulder: 2.3,
  stackHalfW: 0.3,
  stackBottom: 2.95,
  /** The stack's stones are laid a little smaller than the hood's, so it reads as narrower. */
  stackStoneShare: 0.85,
  /** How far the hood's shoulders overhang the stack on each side. */
  shoulderOverhang: 0.04,
  capHalfW: 0.37,
  bandUp: 3.7,
  bandHeight: 0.07,
  bandLitShare: 0.55,
  hoodHalfW: 0.5,
  hoodSpring: 1.68,
  bedRx: 0.46,
  bedRy: 0.24,
  bedWellLiftShare: 0.2,
  bedWellRxShare: 0.88,
  bedWellRyShare: 0.7,
  coalsRx: 0.37,
  coalsRy: 0.17,
  slabJoints: [0.62, 1.38],
  slabShadeTiles: 0.12,
  slabShadeAlpha: 0.5,
  panSootRxShare: 1.5,
  panSootRyShare: 1.7,
  panSootAlpha: 0.7,
  frontScorchRxShare: 1.6,
  frontScorchRy: 0.3,
  stoneTiles: 0.17,
  bellowsNozzleX: 1.34,
  bellowsTailX: 1.9,
  bellowsUp: 1.0,
  bellowsHalfW: 0.17,
  scorchUp: 2.15,
  scorchRx: 0.62,
  scorchRy: 0.5,
  scorchAlpha: 0.75,
} as const;

/** The spare coal kept at the hearth's back left, and the hammer laid in front of it. */
const FORGE_CLUTTER = {
  coalLumps: 6,
  coalX: 0.3,
  coalUp: 1.22,
  coalXJitter: 0.1,
  coalUpJitter: 0.06,
  coalRx: 0.05,
  coalRy: 0.035,
  hammerHandle: [
    [0.18, 0.74],
    [0.46, 0.96],
  ],
  hammerHandleWidth: 0.045,
  hammerHead: [
    [0.42, 1.06],
    [0.56, 0.92],
    [0.6, 0.97],
    [0.47, 1.11],
  ],
} as const;

const LEATHER = { dark: '#3a2418', body: '#5e3a24' } as const;

const BELLOWS = {
  handleTiles: 0.1,
  nozzleShare: 0.16,
  pleatShare: 0.4,
  pleats: 5,
  handleRootInset: 0.04,
  handleTipInset: 0.02,
  handleRootSpread: 0.45,
  handleTipSpread: 0.55,
  handleWidth: 0.04,
  noseSpread: 0.3,
  widestAlong: 0.55,
  tailSpread: 0.6,
  zigzagStartShare: 0.2,
  zigzagSpanShare: 0.75,
  zigzagDropShare: 0.85,
  zigzagInnerShare: 0.25,
  zigzagOuterShare: 0.85,
  shineStartShare: 0.2,
  shineNoseSpread: 0.3,
  shinePeakSpread: 0.7,
  shineTailInset: 0.03,
  shineTailSpread: 0.4,
  nozzleDropShare: 0.4,
  nozzleRootDropShare: 0.3,
  nozzleOverlap: 0.02,
  nozzleWidth: 0.05,
} as const;

/**
 * The forge bellows lying on the hearth, nozzle into the coals: a teardrop
 * board over a pleated leather body, two handles at the wide end.
 */
function paintBellows(p: Pen): void {
  const { bellowsNozzleX: nozzle, bellowsTailX: tail, bellowsUp: cUp, bellowsHalfW: half } = FORGE;
  const bodyStart = nozzle + (tail - nozzle) * BELLOWS.nozzleShare;
  const bodyEnd = tail - BELLOWS.handleTiles;
  const length = bodyEnd - bodyStart;
  for (const side of [-1, 1]) {
    inkedRod(
      p,
      [
        [bodyEnd - BELLOWS.handleRootInset, cUp + side * half * BELLOWS.handleRootSpread],
        [tail - BELLOWS.handleTipInset, cUp + side * half * BELLOWS.handleTipSpread],
      ],
      BELLOWS.handleWidth,
      WOOD.light,
    );
  }
  const board = (lift: number): Point[] => [
    [bodyStart, cUp + half * BELLOWS.noseSpread + lift],
    [bodyStart + length * BELLOWS.widestAlong, cUp + half + lift],
    [bodyEnd, cUp + half * BELLOWS.tailSpread + lift],
    [bodyEnd, cUp - half * BELLOWS.tailSpread + lift],
    [bodyStart + length * BELLOWS.widestAlong, cUp - half + lift],
    [bodyStart, cUp - half * BELLOWS.noseSpread + lift],
  ];
  const pleatDrop = half * BELLOWS.pleatShare;
  fillPolygon(p, board(-pleatDrop), LEATHER.body);
  const zigzag: Point[] = [];
  const folds = BELLOWS.pleats * 2;
  for (let fold = 0; fold <= folds; fold++) {
    const fx =
      bodyStart +
      length * BELLOWS.zigzagStartShare +
      (fold / folds) * length * BELLOWS.zigzagSpanShare;
    const foldDepth =
      fold % 2 === 0 ? pleatDrop * BELLOWS.zigzagInnerShare : pleatDrop * BELLOWS.zigzagOuterShare;
    zigzag.push([fx, cUp - half * BELLOWS.zigzagDropShare - foldDepth]);
  }
  strokePath(p, zigzag, detailTiles(p), LEATHER.dark);
  fillPolygon(p, board(0), WOOD.mid);
  fillPolygon(
    p,
    [
      [bodyStart + length * BELLOWS.shineStartShare, cUp + half * BELLOWS.shineNoseSpread],
      [bodyStart + length * BELLOWS.widestAlong, cUp + half * BELLOWS.shinePeakSpread],
      [bodyEnd - BELLOWS.shineTailInset, cUp + half * BELLOWS.shineTailSpread],
    ],
    WOOD.highlight,
    null,
  );
  inkedRod(
    p,
    [
      [nozzle, cUp - pleatDrop * BELLOWS.nozzleDropShare],
      [bodyStart + BELLOWS.nozzleOverlap, cUp - pleatDrop * BELLOWS.nozzleRootDropShare],
    ],
    BELLOWS.nozzleWidth,
    BRASS.body,
    'butt',
  );
}

/** The stack, hood and back wall, which the hearth in front of them overlaps. */
function paintForgeChimney(p: Pen): void {
  const cx = FORGE_COALS.x;
  const stackX0 = FORGE_CHIMNEY_TOP.x - FORGE.stackHalfW;
  const stackX1 = FORGE_CHIMNEY_TOP.x + FORGE.stackHalfW;
  stones(
    p,
    stackX0,
    stackX1,
    FORGE.stackBottom - FORGE.stoneTiles,
    FORGE_CHIMNEY_TOP.up - FLUE_CAP_HEIGHT_TILES,
    FORGE.stoneTiles * FORGE.stackStoneShare,
  );
  fillRect(p, stackX0, stackX1, FORGE.bandUp, FORGE.bandUp + FORGE.bandHeight, BRASS.dark);
  fillRect(
    p,
    stackX0,
    stackX1,
    FORGE.bandUp + FORGE.bandHeight * FORGE.bandLitShare,
    FORGE.bandUp + FORGE.bandHeight,
    BRASS.light,
    null,
  );
  flueCap(p, FORGE_CHIMNEY_TOP.x, FORGE_CHIMNEY_TOP.up, FORGE.capHalfW);
  const hoodShoulderLeft = FORGE_CHIMNEY_TOP.x - FORGE.stackHalfW - FORGE.shoulderOverhang;
  const hoodShoulderRight = FORGE_CHIMNEY_TOP.x + FORGE.stackHalfW + FORGE.shoulderOverhang;
  stonesInPolygon(
    p,
    [
      [FORGE.wallLeft, FORGE.wallBottom],
      [FORGE.wallLeft, FORGE.wallShoulder],
      [hoodShoulderLeft, FORGE.stackBottom],
      [hoodShoulderRight, FORGE.stackBottom],
      [FORGE.wallRight, FORGE.wallShoulder],
      [FORGE.wallRight, FORGE.wallBottom],
    ],
    FORGE.stoneTiles,
  );
  clipTo(
    p,
    () => traceRect(p, FORGE.wallLeft, FORGE.wallRight, FORGE.wallBottom, FORGE.stackBottom + 1),
    () => stain(p, cx, FORGE.scorchUp, FORGE.scorchRx, FORGE.scorchRy, SOOT, FORGE.scorchAlpha),
  );
  firebox(p, cx, FORGE.hoodHalfW, FORGE.wallBottom, FORGE.hoodSpring);
}

/**
 * The hearth's top is one smooth dressed slab, unlike the laid fieldstone
 * front below it: the change of texture is what makes the top read as
 * horizontal and the coal pan as sitting in it rather than on the face.
 */
function paintForgeSlab(p: Pen): void {
  const cx = FORGE_COALS.x;
  fillRect(p, FORGE.blockLeft, FORGE.blockRight, FORGE.topFront, FORGE.topBack, STONE.body, null);
  withAlpha(p, FORGE.slabShadeAlpha, () =>
    fillRect(
      p,
      FORGE.blockLeft,
      FORGE.blockRight,
      FORGE.topBack - FORGE.slabShadeTiles,
      FORGE.topBack,
      STONE.deep,
      null,
    ),
  );
  for (const jointX of FORGE.slabJoints) {
    strokePath(
      p,
      [
        [jointX, FORGE.topFront],
        [jointX, FORGE.topBack],
      ],
      detailTiles(p),
      STONE.deep,
      'butt',
    );
  }
  stain(
    p,
    cx,
    FORGE_COALS.up,
    FORGE.bedRx * FORGE.panSootRxShare,
    FORGE.bedRy * FORGE.panSootRyShare,
    SOOT,
    FORGE.panSootAlpha,
  );
  traceRect(p, FORGE.blockLeft, FORGE.blockRight, FORGE.topFront, FORGE.topBack);
  inkOutline(p.ctx, p.outline);

  fillEllipse(p, cx, FORGE_COALS.up, FORGE.bedRx, FORGE.bedRy, STONE.dark);
  fillEllipse(
    p,
    cx,
    FORGE_COALS.up + FORGE.bedRy * FORGE.bedWellLiftShare,
    FORGE.bedRx * FORGE.bedWellRxShare,
    FORGE.bedRy * FORGE.bedWellRyShare,
    STONE.deep,
    null,
  );
  emberBed(p, cx, FORGE_COALS.up, FORGE.coalsRx, FORGE.coalsRy);
}

function paintForgeCoalAndHammer(p: Pen): void {
  const clutter = FORGE_CLUTTER;
  const coalRng = forkRng(p.rng);
  for (let lump = 0; lump < clutter.coalLumps; lump++) {
    fillEllipse(
      p,
      clutter.coalX + jitter(coalRng, clutter.coalXJitter),
      clutter.coalUp + jitter(coalRng, clutter.coalUpJitter),
      clutter.coalRx,
      clutter.coalRy,
      lump % 2 === 0 ? COAL.lump : COAL.body,
      p.detail,
    );
  }
  inkedRod(p, clutter.hammerHandle, clutter.hammerHandleWidth, WOOD.light);
  fillPolygon(p, clutter.hammerHead, IRON.body);
}

function paintForgeHearth(p: Pen): void {
  const cx = FORGE_COALS.x;
  shadow(p, cx, FORGE.blockBottom, PAIR_SHADOW_RX, FLOOR_SHADOW_RY);
  paintForgeChimney(p);
  paintForgeSlab(p);
  paintForgeCoalAndHammer(p);
  paintBellows(p);
  stones(p, FORGE.blockLeft, FORGE.blockRight, FORGE.blockBottom, FORGE.topFront, FORGE.stoneTiles);
  clipTo(
    p,
    () => traceRect(p, FORGE.blockLeft, FORGE.blockRight, FORGE.blockBottom, FORGE.topFront),
    () =>
      stain(
        p,
        cx,
        FORGE.topFront,
        FORGE.bedRx * FORGE.frontScorchRxShare,
        FORGE.frontScorchRy,
        SOOT,
        FORGE.scorchAlpha,
      ),
  );
  litLip(p, FORGE.blockLeft, FORGE.blockRight, FORGE.topFront, STONE.highlight);
}

// ── Anvil ─────────────────────────────────────────────────────────────────────

const ANVIL = {
  stumpX0: 0.28,
  stumpX1: 0.72,
  stumpBottom: 0.12,
  stumpTop: 0.5,
  stumpRy: 0.09,
  furrows: 4,
  furrowJitter: 0.02,
  furrowTopInset: 0.04,
  furrowBottomDrop: 0.02,
  footX0: 0.33,
  footX1: 0.67,
  footSink: 0.02,
  footTop: 0.6,
  waistX0: 0.41,
  waistX1: 0.59,
  waistTop: 0.7,
  faceX0: 0.3,
  faceX1: 0.8,
  faceFront: 0.7,
  faceTop: 0.84,
  faceBack: 0.94,
  hornTip: 0.08,
  hornDroop: 0.02,
  hornFaceInset: 0.04,
  heelFlare: 0.04,
  glintX0: 0.04,
  glintX1: 0.22,
  glintInset: 0.03,
  shadowRx: 0.36,
} as const;

function paintAnvil(p: Pen): void {
  const { ctx } = p;
  shadow(p, TILE_MIDDLE, ANVIL.stumpBottom, ANVIL.shadowRx, FLOOR_SHADOW_RY);
  const stumpCx = (ANVIL.stumpX0 + ANVIL.stumpX1) / 2;
  const stumpRx = (ANVIL.stumpX1 - ANVIL.stumpX0) / 2;
  ctx.beginPath();
  ctx.moveTo(p.x(ANVIL.stumpX0), p.y(ANVIL.stumpTop));
  ctx.lineTo(p.x(ANVIL.stumpX0), p.y(ANVIL.stumpBottom));
  ctx.ellipse(
    p.x(stumpCx),
    p.y(ANVIL.stumpBottom),
    p.s(stumpRx),
    p.s(ANVIL.stumpRy),
    0,
    Math.PI,
    0,
    true,
  );
  ctx.lineTo(p.x(ANVIL.stumpX1), p.y(ANVIL.stumpTop));
  ctx.closePath();
  ctx.fillStyle = LOG.bark;
  ctx.fill();
  inkOutline(ctx, p.outline);
  const barkRng = forkRng(p.rng);
  for (let furrow = 0; furrow < ANVIL.furrows; furrow++) {
    const fx =
      ANVIL.stumpX0 +
      stumpRx * 2 * ((furrow + 0.5) / ANVIL.furrows) +
      jitter(barkRng, ANVIL.furrowJitter);
    strokePath(
      p,
      [
        [fx, ANVIL.stumpTop - ANVIL.furrowTopInset],
        [fx + jitter(barkRng, ANVIL.furrowJitter), ANVIL.stumpBottom - ANVIL.furrowBottomDrop],
      ],
      detailTiles(p),
      furrow === 0 ? LOG.barkLight : LOG.barkDark,
    );
  }
  drawLogEnd(ctx, p.x(stumpCx), p.y(ANVIL.stumpTop), p.s(stumpRx), p.s(ANVIL.stumpRy));
  ctx.beginPath();
  ctx.ellipse(p.x(stumpCx), p.y(ANVIL.stumpTop), p.s(stumpRx), p.s(ANVIL.stumpRy), 0, 0, TAU);
  inkOutline(ctx, p.detail);

  const footBase = ANVIL.stumpTop - ANVIL.footSink;
  fillPolygon(
    p,
    [
      [ANVIL.footX0, footBase],
      [ANVIL.footX1, footBase],
      [ANVIL.waistX1, ANVIL.footTop],
      [ANVIL.waistX1, ANVIL.waistTop],
      [ANVIL.waistX0, ANVIL.waistTop],
      [ANVIL.waistX0, ANVIL.footTop],
    ],
    IRON.dark,
  );
  const heelX = ANVIL.faceX1 + ANVIL.heelFlare;
  fillPolygon(
    p,
    [
      [ANVIL.hornTip, ANVIL.faceTop - ANVIL.hornDroop],
      [ANVIL.faceX0, ANVIL.faceFront],
      [ANVIL.faceX1, ANVIL.faceFront],
      [heelX, ANVIL.faceBack],
      [ANVIL.faceX0, ANVIL.faceBack],
    ],
    IRON.body,
  );
  fillPolygon(
    p,
    [
      [ANVIL.hornTip + ANVIL.hornFaceInset, ANVIL.faceTop],
      [ANVIL.faceX0, ANVIL.faceTop],
      [ANVIL.faceX1, ANVIL.faceTop],
      [heelX, ANVIL.faceBack],
      [ANVIL.faceX0, ANVIL.faceBack],
    ],
    IRON.light,
    p.detail,
  );
  fillRect(
    p,
    ANVIL.faceX0 + ANVIL.glintX0,
    ANVIL.faceX0 + ANVIL.glintX1,
    ANVIL.faceTop + ANVIL.glintInset,
    ANVIL.faceBack - ANVIL.glintInset,
    IRON.glint,
    null,
  );
}

// ── Quench trough ─────────────────────────────────────────────────────────────

const TROUGH = {
  x0: 0.1,
  x1: 1.9,
  bottom: 0.1,
  rimFront: 0.48,
  rimBack: 1.1,
  wall: 0.07,
  innerWallHeight: 0.1,
  innerWallBoard: 0.05,
  waterBackInset: 0.08,
  frontBoard: 0.13,
  frontNailChance: 0.5,
  bandXs: [0.36, 1.64],
  bandWidth: 0.06,
} as const;

/** The quench water's oily sheen: a few pale streaks and one purple slick of scale. */
const QUENCH_SHEEN = {
  alpha: 0.55,
  streaks: 4,
  firstX: 0.15,
  spacing: 0.4,
  xJitter: 0.06,
  firstUp: 0.1,
  staggerUp: 0.16,
  upJitter: 0.03,
  length: 0.22,
  tilt: 0.01,
  width: 0.025,
  slickX: 1.35,
  slickUp: 0.22,
  slickRx: 0.2,
  slickRy: 0.08,
  slickAlpha: 0.35,
} as const;

function paintQuenchWater(
  p: Pen,
  x0: number,
  x1: number,
  waterFront: number,
  waterBack: number,
): void {
  planks(
    p,
    x0,
    x1,
    waterBack - TROUGH.innerWallHeight,
    waterBack,
    'horizontal',
    TROUGH.innerWallBoard,
    WOOD.deep,
    NO_NAILS,
  );
  fillRect(p, x0, x1, waterFront, waterBack - TROUGH.waterBackInset, QUENCH_WATER.body, p.detail);
  const sheenRng = forkRng(p.rng);
  withAlpha(p, QUENCH_SHEEN.alpha, () => {
    for (let streak = 0; streak < QUENCH_SHEEN.streaks; streak++) {
      const sx =
        x0 +
        QUENCH_SHEEN.firstX +
        streak * QUENCH_SHEEN.spacing +
        jitter(sheenRng, QUENCH_SHEEN.xJitter);
      const sUp =
        waterFront +
        QUENCH_SHEEN.firstUp +
        (streak % 2) * QUENCH_SHEEN.staggerUp +
        jitter(sheenRng, QUENCH_SHEEN.upJitter);
      strokePath(
        p,
        [
          [sx, sUp],
          [sx + QUENCH_SHEEN.length, sUp + QUENCH_SHEEN.tilt],
        ],
        QUENCH_SHEEN.width,
        QUENCH_WATER.sheen,
      );
    }
  });
  stain(
    p,
    QUENCH_SHEEN.slickX,
    waterFront + QUENCH_SHEEN.slickUp,
    QUENCH_SHEEN.slickRx,
    QUENCH_SHEEN.slickRy,
    QUENCH_WATER.oilSlick,
    QUENCH_SHEEN.slickAlpha,
  );
}

function paintQuenchTrough(p: Pen): void {
  shadow(p, PAIR_MIDDLE, TROUGH.bottom, PAIR_SHADOW_RX, FLOOR_SHADOW_RY);
  planks(
    p,
    TROUGH.x0,
    TROUGH.x1,
    TROUGH.rimFront,
    TROUGH.rimBack,
    'horizontal',
    TROUGH.wall,
    WOOD.body,
    NO_NAILS,
  );
  paintQuenchWater(
    p,
    TROUGH.x0 + TROUGH.wall,
    TROUGH.x1 - TROUGH.wall,
    TROUGH.rimFront + TROUGH.wall,
    TROUGH.rimBack - TROUGH.wall,
  );
  traceRect(p, TROUGH.x0, TROUGH.x1, TROUGH.rimFront, TROUGH.rimBack);
  inkOutline(p.ctx, p.outline);

  paintTongs(p);

  planks(
    p,
    TROUGH.x0,
    TROUGH.x1,
    TROUGH.bottom,
    TROUGH.rimFront,
    'horizontal',
    TROUGH.frontBoard,
    WOOD.dark,
    TROUGH.frontNailChance,
  );
  for (const bx of TROUGH.bandXs) {
    fillRect(
      p,
      bx - TROUGH.bandWidth / 2,
      bx + TROUGH.bandWidth / 2,
      TROUGH.bottom,
      TROUGH.rimFront,
      IRON.body,
      p.detail,
    );
  }
  litLip(p, TROUGH.x0, TROUGH.x1, TROUGH.rimFront, WOOD.highlight);
  traceRect(p, TROUGH.x0, TROUGH.x1, TROUGH.bottom, TROUGH.rimBack);
  inkOutline(p.ctx, p.outline);
}

const TONGS = {
  rivet: [0.86, 1.0],
  reinA: [0.46, 0.5],
  jawA: [0.96, 1.16],
  reinB: [0.62, 0.48],
  jawB: [0.82, 1.18],
  width: 0.035,
  rivetRadius: 0.028,
} as const;

/** Smith's tongs left across the trough: two reins meeting at a rivet, short jaws crossing past it. */
function paintTongs(p: Pen): void {
  inkedRod(p, [TONGS.reinA, TONGS.rivet, TONGS.jawA], TONGS.width, IRON.body);
  inkedRod(p, [TONGS.reinB, TONGS.rivet, TONGS.jawB], TONGS.width, IRON.light);
  fillEllipse(
    p,
    TONGS.rivet[0],
    TONGS.rivet[1],
    TONGS.rivetRadius,
    TONGS.rivetRadius,
    BRASS.light,
    p.detail,
  );
}

// ── Tool rack ─────────────────────────────────────────────────────────────────

const TOOL_RACK = {
  postTop: 2.36,
  boardBottom: 0.7,
  boardTop: 2.22,
  barUp: 1.34,
} as const;

/** Oren's rack: two bare handles whose heads — the tier he sells next — are drawn live. */
function paintToolRack(p: Pen): void {
  rackFrame(p, TOOL_RACK.postTop, { up0: TOOL_RACK.boardBottom, up1: TOOL_RACK.boardTop });
  handle(p, TOOL_RACK_AXE_TOP.x, TOOL_RACK_AXE_TOP.up);
  handle(p, TOOL_RACK_PICK_TOP.x, TOOL_RACK_PICK_TOP.up, WOOD.mid);
  rackBar(p, TOOL_RACK.barUp, [TOOL_RACK_AXE_TOP.x, TOOL_RACK_PICK_TOP.x]);
  rackTrayFront(p);
}

// ── Coal bin ──────────────────────────────────────────────────────────────────

const BIN = {
  x0: 0.14,
  x1: 0.86,
  bottom: 0.1,
  rimFront: 0.46,
  rimBack: 0.88,
  shadowRx: 0.38,
  backWallInset: 0.05,
  backWallBottom: 0.1,
  backWallTop: 0.04,
  backWallBoard: 0.06,
  frontBoard: 0.12,
  frontNailChance: 0.4,
  strapInset: 0.03,
  strapHalfW: 0.03,
} as const;

const COAL_HEAP = {
  outline: [
    [0.18, 0.48],
    [0.24, 0.78],
    [0.4, 0.97],
    [0.56, 1.02],
    [0.7, 0.88],
    [0.82, 0.54],
  ],
  lumps: 14,
  lumpX0: 0.24,
  lumpX1: 0.76,
  peakX: 0.52,
  /** How fast the heap falls away from its peak, per tile sideways. */
  slope: 1.6,
  lumpBase: 0.56,
  peakRise: 0.36,
  lumpRx: 0.045,
  lumpRy: 0.032,
  glintEvery: 3,
  spilled: [
    { x: 0.26, up: 0.07, rx: 0.04, ry: 0.025 },
    { x: 0.34, up: 0.05, rx: 0.03, ry: 0.02 },
  ],
} as const;

const COAL_SHOVEL = {
  shaft: [
    [0.6, 0.86],
    [0.74, 1.46],
  ],
  shaftWidth: 0.045,
  grip: [
    [0.68, 1.46],
    [0.8, 1.46],
  ],
  gripWidth: 0.04,
} as const;

function paintCoalHeap(p: Pen): void {
  fillPolygon(p, COAL_HEAP.outline, COAL.body);
  const lumpRng = forkRng(p.rng);
  for (let lump = 0; lump < COAL_HEAP.lumps; lump++) {
    const lx = range(lumpRng, COAL_HEAP.lumpX0, COAL_HEAP.lumpX1);
    const peak = 1 - Math.abs(lx - COAL_HEAP.peakX) * COAL_HEAP.slope;
    const lUp = range(lumpRng, COAL_HEAP.lumpBase, COAL_HEAP.lumpBase + peak * COAL_HEAP.peakRise);
    fillEllipse(
      p,
      lx,
      lUp,
      COAL_HEAP.lumpRx,
      COAL_HEAP.lumpRy,
      lump % COAL_HEAP.glintEvery === 0 ? COAL.glint : COAL.lump,
      null,
    );
  }
  inkedRod(p, COAL_SHOVEL.shaft, COAL_SHOVEL.shaftWidth, WOOD.light);
  inkedRod(p, COAL_SHOVEL.grip, COAL_SHOVEL.gripWidth, WOOD.mid);
}

function paintCoalBin(p: Pen): void {
  shadow(p, TILE_MIDDLE, BIN.bottom, BIN.shadowRx, SLIM_SHADOW_RY);
  fillRect(p, BIN.x0, BIN.x1, BIN.rimFront, BIN.rimBack, WOOD.deep);
  planks(
    p,
    BIN.x0 + BIN.backWallInset,
    BIN.x1 - BIN.backWallInset,
    BIN.rimBack - BIN.backWallBottom,
    BIN.rimBack - BIN.backWallTop,
    'horizontal',
    BIN.backWallBoard,
    WOOD.dark,
    NO_NAILS,
  );
  paintCoalHeap(p);
  planks(
    p,
    BIN.x0,
    BIN.x1,
    BIN.bottom,
    BIN.rimFront,
    'horizontal',
    BIN.frontBoard,
    WOOD.body,
    BIN.frontNailChance,
  );
  for (const sx of [BIN.x0 + BIN.strapInset, BIN.x1 - BIN.strapInset]) {
    fillRect(
      p,
      sx - BIN.strapHalfW,
      sx + BIN.strapHalfW,
      BIN.bottom,
      BIN.rimFront,
      IRON.body,
      p.detail,
    );
  }
  litLip(p, BIN.x0, BIN.x1, BIN.rimFront, WOOD.highlight);
  traceRect(p, BIN.x0, BIN.x1, BIN.bottom, BIN.rimBack);
  inkOutline(p.ctx, p.outline);
  for (const lump of COAL_HEAP.spilled) {
    fillEllipse(p, lump.x, lump.up, lump.rx, lump.ry, COAL.lump, null);
  }
}

// ── Cooking hearth ────────────────────────────────────────────────────────────

const COOK = {
  breastX0: 0.1,
  breastX1: 1.2,
  bottom: 0.08,
  breastTop: 1.3,
  stackHalfW: 0.22,
  shoulderUp: 1.66,
  capHalfW: 0.28,
  archHalfW: 0.3,
  archSpring: 0.62,
  /** The soot bloom sits just above the arch's crown. */
  sootAboveArch: 0.1,
  sootRx: 0.34,
  sootRy: 0.3,
  sootAlpha: 0.7,
  emberRy: 0.07,
  mantelBottom: 0.98,
  mantelTop: 1.1,
  mantelLeftOverhang: 0.04,
  mantelRightInset: 0.02,
  hobX0: 1.1,
  hobX1: 1.92,
  hobFront: 0.44,
  hobBack: 1.02,
  hobSlabTiles: 0.2,
  potRx: 0.23,
  potBodyRy: 0.19,
  stoneTiles: 0.16,
} as const;

/** A brass ladle and a string of onions hung from the cookhouse mantel. */
const MANTEL_HANGINGS = {
  ladleX: 0.2,
  ladleBowlUp: 0.72,
  ladleRimUp: 0.7,
  ladleRx: 0.07,
  ladleHandleWidth: 0.03,
  onions: 3,
  onionX: 1.04,
  onionSwing: 0.04,
  onionFirstDrop: 0.08,
  onionSpacing: 0.1,
  onionRx: 0.05,
  onionRy: 0.045,
} as const;

/** The iron pot: a bail handle over a round body, a rim, and stew inside. */
const POT = {
  centreDropShare: 0.9,
  shadowDropShare: 0.8,
  shadowRy: 0.05,
  shadowAlpha: 0.5,
  bailLift: 0.02,
  bailRadiusShare: 0.9,
  bailWidth: 0.03,
  shineXShare: 0.4,
  shineUpShare: 0.3,
  shineSizeShare: 0.3,
  rimShare: 0.86,
  stewDrop: 0.005,
  stewRxShare: 0.7,
  stewRyShare: 0.66,
  fatX: 0.04,
  fatLift: 0.01,
  fatRx: 0.04,
  fatRy: 0.015,
} as const;

/** The hob's spare bowls and a wooden spoon. */
const HOB_CLUTTER = {
  bowlX: 1.76,
  bowlRims: [0.74, 0.8],
  bowlRx: 0.1,
  spoon: [
    [1.62, 0.56],
    [1.86, 0.62],
  ],
  spoonWidth: 0.03,
} as const;

function paintCookingChimney(p: Pen): void {
  const fireX = COOKING_FIRE.x;
  const flueTop = COOKING_CHIMNEY_TOP.up - FLUE_CAP_HEIGHT_TILES;
  const stackX0 = COOKING_CHIMNEY_TOP.x - COOK.stackHalfW;
  const stackX1 = COOKING_CHIMNEY_TOP.x + COOK.stackHalfW;
  stonesInPolygon(
    p,
    [
      [COOK.breastX0, COOK.bottom],
      [COOK.breastX0, COOK.breastTop],
      [stackX0, COOK.shoulderUp],
      [stackX0, flueTop],
      [stackX1, flueTop],
      [stackX1, COOK.shoulderUp],
      [COOK.breastX1, COOK.breastTop],
      [COOK.breastX1, COOK.bottom],
    ],
    COOK.stoneTiles,
  );
  clipTo(
    p,
    () => traceRect(p, COOK.breastX0, COOK.breastX1, COOK.bottom, COOKING_CHIMNEY_TOP.up),
    () =>
      stain(
        p,
        fireX,
        COOK.archSpring + COOK.archHalfW + COOK.sootAboveArch,
        COOK.sootRx,
        COOK.sootRy,
        SOOT,
        COOK.sootAlpha,
      ),
  );
  flueCap(p, COOKING_CHIMNEY_TOP.x, COOKING_CHIMNEY_TOP.up, COOK.capHalfW);
  firebox(p, fireX, COOK.archHalfW, COOK.bottom + HEARTH_EMBERS.firebox, COOK.archSpring);
  emberBed(
    p,
    fireX,
    COOKING_FIRE.up - HEARTH_EMBERS.bedDrop,
    COOK.archHalfW * HEARTH_EMBERS.bedWidthShare,
    COOK.emberRy,
  );
  charredLogs(
    p,
    fireX,
    COOKING_FIRE.up - HEARTH_EMBERS.logDrop,
    COOK.archHalfW * HEARTH_EMBERS.logSpanShare,
  );
}

function paintMantelHangings(p: Pen): void {
  const hang = MANTEL_HANGINGS;
  mantel(
    p,
    COOK.breastX0 - COOK.mantelLeftOverhang,
    COOK.breastX1 - COOK.mantelRightInset,
    COOK.mantelBottom,
    COOK.mantelTop,
  );
  strokePath(
    p,
    [
      [hang.ladleX, COOK.mantelBottom],
      [hang.ladleX, hang.ladleBowlUp],
    ],
    hang.ladleHandleWidth,
    BRASS.body,
  );
  bowl(p, hang.ladleX, hang.ladleRimUp, hang.ladleRx, null, BRASS.dark);
  for (let onion = 0; onion < hang.onions; onion++) {
    fillEllipse(
      p,
      hang.onionX + (onion % 2) * hang.onionSwing,
      COOK.mantelBottom - hang.onionFirstDrop - onion * hang.onionSpacing,
      hang.onionRx,
      hang.onionRy,
      onion === 1 ? BREAD.light : BREAD.body,
      p.detail,
    );
  }
}

function paintStewPot(p: Pen): void {
  const potX = COOKING_POT.x;
  const potRim = COOKING_POT.up;
  const potBodyCentre = potRim - COOK.potBodyRy * POT.centreDropShare;
  shadow(
    p,
    potX,
    potBodyCentre - COOK.potBodyRy * POT.shadowDropShare,
    COOK.potRx,
    POT.shadowRy,
    POT.shadowAlpha,
  );
  p.ctx.beginPath();
  p.ctx.arc(
    p.x(potX),
    p.y(potRim + POT.bailLift),
    p.s(COOK.potRx * POT.bailRadiusShare),
    Math.PI,
    TAU,
  );
  p.ctx.strokeStyle = INK;
  p.ctx.lineWidth = p.s(POT.bailWidth);
  p.ctx.stroke();
  fillEllipse(p, potX, potBodyCentre, COOK.potRx, COOK.potBodyRy, IRON.dark);
  fillEllipse(
    p,
    potX - COOK.potRx * POT.shineXShare,
    potBodyCentre + COOK.potBodyRy * POT.shineUpShare,
    COOK.potRx * POT.shineSizeShare,
    COOK.potBodyRy * POT.shineSizeShare,
    IRON.body,
    null,
  );
  fillEllipse(
    p,
    potX,
    potRim,
    COOK.potRx * POT.rimShare,
    COOK.potRx * RIM_SQUASH * POT.rimShare,
    IRON.body,
  );
  fillEllipse(
    p,
    potX,
    potRim - POT.stewDrop,
    COOK.potRx * POT.stewRxShare,
    COOK.potRx * RIM_SQUASH * POT.stewRyShare,
    STEW.body,
    null,
  );
  fillEllipse(p, potX - POT.fatX, potRim + POT.fatLift, POT.fatRx, POT.fatRy, STEW.light, null);
}

function paintCookingHearth(p: Pen): void {
  shadow(p, PAIR_MIDDLE, COOK.bottom, PAIR_SHADOW_RX, FLOOR_SHADOW_RY);
  paintCookingChimney(p);
  paintMantelHangings(p);

  planks(
    p,
    COOK.hobX0,
    COOK.hobX1,
    COOK.hobFront,
    COOK.hobBack,
    'horizontal',
    COOK.hobSlabTiles,
    STONE.light,
    NO_NAILS,
  );
  traceRect(p, COOK.hobX0, COOK.hobX1, COOK.hobFront, COOK.hobBack);
  inkOutline(p.ctx, p.outline);
  stones(p, COOK.hobX0, COOK.hobX1, COOK.bottom, COOK.hobFront, COOK.stoneTiles);

  paintStewPot(p);
  for (const rimUp of HOB_CLUTTER.bowlRims)
    bowl(p, HOB_CLUTTER.bowlX, rimUp, HOB_CLUTTER.bowlRx, null);
  inkedRod(p, HOB_CLUTTER.spoon, HOB_CLUTTER.spoonWidth, WOOD.light);
}

// ── Serving counter ───────────────────────────────────────────────────────────

const COUNTER = {
  x0: 0.06,
  x1: 2.94,
  bottom: 0.1,
  topFront: 0.66,
  topBack: 1.26,
  apron: 0.08,
  kick: 0.08,
  frontBoard: 0.24,
  frontNailChance: 0.4,
  middle: 1.5,
  shadowRx: 1.42,
  wornX: 1.5,
  wornUp: 0.84,
  wornRx: 0.36,
  wornRy: 0.1,
} as const;

/** The cookhouse end of the counter: a stack of clean bowls, a full one, a loaf. */
const COUNTER_KITCHEN = {
  stackX: 0.34,
  stackRims: [1.0, 1.07, 1.14],
  stackRx: 0.13,
  fullX: 0.78,
  fullRim: 0.9,
  fullRx: 0.15,
  fatX: 0.74,
  fatUp: 0.92,
  fatRx: 0.03,
  fatRy: 0.012,
  loafX: 1.2,
  loafUp: 0.96,
  loafRx: 0.15,
} as const;

/** The store end of the counter: two jars and a tied sack of meal. */
const COUNTER_STORE = {
  crock: { cx: 1.92, upBase: 0.9, width: 0.2, height: 0.34 },
  bottle: { cx: 2.2, upBase: 1.0, width: 0.16, height: 0.3 },
  sack: { cx: 2.58, upBase: 0.86, halfW: 0.22, height: 0.4 },
} as const;

function paintCounterKitchenEnd(p: Pen): void {
  const kitchen = COUNTER_KITCHEN;
  for (const rimUp of kitchen.stackRims) bowl(p, kitchen.stackX, rimUp, kitchen.stackRx, null);
  bowl(p, kitchen.fullX, kitchen.fullRim, kitchen.fullRx, STEW.body);
  fillEllipse(p, kitchen.fatX, kitchen.fatUp, kitchen.fatRx, kitchen.fatRy, STEW.light, null);
  loaf(p, kitchen.loafX, kitchen.loafUp, kitchen.loafRx);
}

function paintCounterStoreEnd(p: Pen): void {
  const store = COUNTER_STORE;
  jar(p, { ...store.crock, body: CLAY.body, lid: WOOD.dark, label: true });
  jar(p, { ...store.bottle, body: GLASS.body, lid: LOG.cut });
  sack(p, store.sack.cx, store.sack.upBase, store.sack.halfW, store.sack.height, BURLAP);
}

function paintServingCounter(p: Pen): void {
  shadow(p, COUNTER.middle, COUNTER.bottom, COUNTER.shadowRx, FLOOR_SHADOW_RY);
  planks(
    p,
    COUNTER.x0,
    COUNTER.x1,
    COUNTER.bottom,
    COUNTER.topFront - COUNTER.apron,
    'vertical',
    COUNTER.frontBoard,
    WOOD.body,
    COUNTER.frontNailChance,
  );
  fillRect(
    p,
    COUNTER.x0,
    COUNTER.x1,
    COUNTER.bottom,
    COUNTER.bottom + COUNTER.kick,
    WOOD.deep,
    null,
  );
  traceRect(p, COUNTER.x0, COUNTER.x1, COUNTER.bottom, COUNTER.topFront);
  inkOutline(p.ctx, p.outline);
  slab(p, {
    x0: COUNTER.x0,
    x1: COUNTER.x1,
    topFront: COUNTER.topFront,
    topBack: COUNTER.topBack,
    apron: COUNTER.apron,
  });
  wornSpot(p, COUNTER.wornX, COUNTER.wornUp, COUNTER.wornRx, COUNTER.wornRy);
  paintCounterKitchenEnd(p);
  paintCounterStoreEnd(p);
}

// ── Sacks ─────────────────────────────────────────────────────────────────────

type SackCloth = typeof BURLAP;

const SACK = {
  neckUpShare: 0.78,
  neckHalfShare: 0.34,
  bellyUpShare: 0.6,
  bellyOutShare: 1.1,
  baseOutShare: 1.15,
  baseFlatShare: 0.4,
  shineXShare: 0.35,
  shineUpShare: 0.4,
  shineRxShare: 0.45,
  shineRyShare: 0.28,
  shineAlpha: 0.7,
  creaseX0Share: 0.1,
  creaseUp0Share: 0.12,
  creaseX1Share: 0.35,
  creaseUp1Share: 0.5,
  tuftLeftShare: 1.8,
  tuftRightShare: 1.6,
  tuftRightUpShare: 0.98,
  tieShare: 1.1,
  tieDrop: 0.02,
  tieRise: 0.03,
} as const;

/** A stuffed sack tied at the neck: a lumpy pear with a tuft above the tie. */
function sack(
  p: Pen,
  cx: number,
  upBase: number,
  halfW: number,
  height: number,
  cloth: SackCloth,
): void {
  const neckUp = upBase + height * SACK.neckUpShare;
  const neckHalf = halfW * SACK.neckHalfShare;
  const { ctx } = p;
  ctx.beginPath();
  ctx.moveTo(p.x(cx - neckHalf), p.y(neckUp));
  ctx.bezierCurveTo(
    p.x(cx - halfW * SACK.bellyOutShare),
    p.y(upBase + height * SACK.bellyUpShare),
    p.x(cx - halfW * SACK.baseOutShare),
    p.y(upBase),
    p.x(cx - halfW * SACK.baseFlatShare),
    p.y(upBase),
  );
  ctx.lineTo(p.x(cx + halfW * SACK.baseFlatShare), p.y(upBase));
  ctx.bezierCurveTo(
    p.x(cx + halfW * SACK.baseOutShare),
    p.y(upBase),
    p.x(cx + halfW * SACK.bellyOutShare),
    p.y(upBase + height * SACK.bellyUpShare),
    p.x(cx + neckHalf),
    p.y(neckUp),
  );
  ctx.closePath();
  ctx.fillStyle = cloth.body;
  ctx.fill();
  inkOutline(ctx, p.outline);
  stain(
    p,
    cx - halfW * SACK.shineXShare,
    upBase + height * SACK.shineUpShare,
    halfW * SACK.shineRxShare,
    height * SACK.shineRyShare,
    cloth.light,
    SACK.shineAlpha,
  );
  strokePath(
    p,
    [
      [cx + halfW * SACK.creaseX0Share, upBase + height * SACK.creaseUp0Share],
      [cx + halfW * SACK.creaseX1Share, upBase + height * SACK.creaseUp1Share],
    ],
    detailTiles(p),
    cloth.dark,
  );
  fillPolygon(
    p,
    [
      [cx - neckHalf, neckUp],
      [cx - neckHalf * SACK.tuftLeftShare, upBase + height],
      [cx + neckHalf * SACK.tuftRightShare, upBase + height * SACK.tuftRightUpShare],
      [cx + neckHalf, neckUp],
    ],
    cloth.body,
    p.detail,
  );
  fillRect(
    p,
    cx - neckHalf * SACK.tieShare,
    cx + neckHalf * SACK.tieShare,
    neckUp - SACK.tieDrop,
    neckUp + SACK.tieRise,
    cloth.dark,
    p.detail,
  );
}

// ── Tables and desks ──────────────────────────────────────────────────────────

const TABLE = {
  x0: 0.1,
  x1: 1.9,
  topFront: 0.66,
  topBack: 1.28,
  apron: 0.1,
  legWidth: 0.08,
  legInset: 0.1,
  floor: 0.12,
  /** The floor shadow stops short of the table's ends so it never reaches its footprint's edge. */
  shadowInset: 0.04,
} as const;

/** Where the plain table is worn pale by elbows and tails. */
const TABLE_WEAR = [
  { x: 0.7, up: 0.9, rx: 0.22, ry: 0.08 },
  { x: 1.36, up: 1.02, rx: 0.16, ry: 0.06 },
] as const;

/** Two places laid for a meal, a shared bowl and a crock between them. */
const TABLE_MEAL = {
  plates: [
    { x: 0.46, up: 0.88 },
    { x: 1.48, up: 0.88 },
  ],
  plateRx: 0.21,
  loafLift: 0.06,
  loafRx: 0.12,
  stewLift: 0.08,
  stewRx: 0.13,
  sharedBowl: { x: 1.0, rim: 1.1, rx: 0.16 },
  mugs: [
    { x: 0.84, upBase: 0.78 },
    { x: 1.76, upBase: 1.0 },
  ],
  mugWidth: 0.11,
  mugHeight: 0.17,
  crock: { cx: 1.16, upBase: 0.78, width: 0.16, height: 0.28 },
} as const;

function tableBody(p: Pen, x0: number, x1: number, legXs: ReadonlyArray<number>): void {
  const middle = (x0 + x1) / 2;
  shadow(p, middle, TABLE.floor, (x1 - x0) / 2 - TABLE.shadowInset, FLOOR_SHADOW_RY);
  for (const lx of legXs) leg(p, lx, TABLE.legWidth, TABLE.floor, TABLE.topFront - TABLE.apron);
  slab(p, { x0, x1, topFront: TABLE.topFront, topBack: TABLE.topBack, apron: TABLE.apron });
}

function paintMeal(p: Pen): void {
  const meal = TABLE_MEAL;
  const [breadPlace, stewPlace] = meal.plates;
  plate(p, breadPlace.x, breadPlace.up, meal.plateRx);
  loaf(p, breadPlace.x, breadPlace.up + meal.loafLift, meal.loafRx);
  plate(p, stewPlace.x, stewPlace.up, meal.plateRx);
  bowl(p, stewPlace.x, stewPlace.up + meal.stewLift, meal.stewRx, STEW.body);
  bowl(p, meal.sharedBowl.x, meal.sharedBowl.rim, meal.sharedBowl.rx, STEW.body);
  for (const cup of meal.mugs) mug(p, cup.x, cup.upBase, meal.mugWidth, meal.mugHeight);
  jar(p, { ...meal.crock, body: CLAY.body, lid: CLAY.dark });
}

function paintTable(p: Pen, variant: number): void {
  tableBody(p, TABLE.x0, TABLE.x1, [TABLE.x0 + TABLE.legInset, TABLE.x1 - TABLE.legInset]);
  if (variant === 0) {
    for (const wear of TABLE_WEAR) wornSpot(p, wear.x, wear.up, wear.rx, wear.ry);
    return;
  }
  paintMeal(p);
}

const LONG_TABLE = {
  x0: 0.08,
  x1: 3.92,
  legs: [0.2, 1.4, 2.6, 3.8],
  candleHeight: 0.2,
  candles: [0.95, 3.05],
  candleUp: 0.98,
  papers: [
    { cx: 1.72, cUp: 0.96, halfW: 0.2, halfH: 0.14, skew: 0.03 },
    { cx: 2.18, cUp: 1.0, halfW: 0.18, halfH: 0.13, skew: -0.025 },
    { cx: 2.02, cUp: 0.9, halfW: 0.16, halfH: 0.12, skew: 0.015 },
  ],
  mugs: [
    { x: 0.46, upBase: 0.82 },
    { x: 3.5, upBase: 0.82 },
    { x: 2.72, upBase: 1.02 },
  ],
  mugWidth: 0.09,
  mugHeight: 0.14,
  ledger: { x0: 1.18, x1: 1.44, up0: 0.84, up1: 0.96, pageEdge: 0.93 },
} as const;

/** The hall's meeting table: candles, the papers under discussion, everyone's mug, the ledger. */
function paintLongTable(p: Pen): void {
  const table = LONG_TABLE;
  tableBody(p, table.x0, table.x1, table.legs);
  for (const cx of table.candles) candle(p, cx, table.candleUp, table.candleHeight);
  for (const sheet of table.papers)
    paper(p, sheet.cx, sheet.cUp, sheet.halfW, sheet.halfH, sheet.skew);
  for (const cup of table.mugs) mug(p, cup.x, cup.upBase, table.mugWidth, table.mugHeight);
  const { ledger } = table;
  fillRect(p, ledger.x0, ledger.x1, ledger.up0, ledger.up1, CLOTH.madder.dark);
  fillRect(p, ledger.x0, ledger.x1, ledger.pageEdge, ledger.up1, PARCHMENT.light, null);
}

const DESK = {
  pedestalX0: 0.12,
  pedestalX1: 0.74,
  drawerBoard: 0.23,
  drawerSplit: 0.35,
  knobUps: [0.24, 0.46],
  knobRadius: 0.03,
} as const;

/** The mayor's desk top: a ledger, papers, an inkpot with its quill, a candle. */
const DESK_TOP = {
  ledger: { x0: 0.2, x1: 0.62, up0: 0.82, up1: 1.08, pageEdge: 1.04 },
  papers: [
    { cx: 1.0, cUp: 0.94, halfW: 0.19, halfH: 0.15, skew: 0.03 },
    { cx: 1.1, cUp: 1.0, halfW: 0.18, halfH: 0.14, skew: -0.02 },
  ],
  inkpot: { x: 1.46, up: 0.98, rx: 0.07, ry: 0.04, neckX0: 1.42, neckX1: 1.5, neckTop: 1.06 },
  quill: [
    [1.48, 1.04],
    [1.58, 1.38],
  ],
  quillWidth: 0.02,
  vane: [
    [1.55, 1.24],
    [1.64, 1.42],
    [1.58, 1.4],
  ],
  candleX: 1.74,
  candleUp: 1.02,
  candleHeight: 0.16,
} as const;

function paintDeskPedestal(p: Pen): void {
  const pedestalTop = TABLE.topFront - TABLE.apron;
  planks(
    p,
    DESK.pedestalX0,
    DESK.pedestalX1,
    TABLE.floor,
    pedestalTop,
    'horizontal',
    DESK.drawerBoard,
    WOOD.body,
    NO_NAILS,
  );
  traceRect(p, DESK.pedestalX0, DESK.pedestalX1, TABLE.floor, pedestalTop);
  inkOutline(p.ctx, p.outline);
  strokePath(
    p,
    [
      [DESK.pedestalX0, DESK.drawerSplit],
      [DESK.pedestalX1, DESK.drawerSplit],
    ],
    p.outline / p.s(1),
    INK,
    'butt',
  );
  const pedestalMiddle = (DESK.pedestalX0 + DESK.pedestalX1) / 2;
  for (const knobUp of DESK.knobUps) {
    fillEllipse(p, pedestalMiddle, knobUp, DESK.knobRadius, DESK.knobRadius, BRASS.light, p.detail);
  }
}

function paintDeskTop(p: Pen): void {
  const { ledger, inkpot } = DESK_TOP;
  fillRect(p, ledger.x0, ledger.x1, ledger.up0, ledger.up1, CLOTH.woad.dark);
  fillRect(p, ledger.x0, ledger.x1, ledger.pageEdge, ledger.up1, PARCHMENT.light, null);
  for (const sheet of DESK_TOP.papers) {
    paper(p, sheet.cx, sheet.cUp, sheet.halfW, sheet.halfH, sheet.skew);
  }
  fillEllipse(p, inkpot.x, inkpot.up, inkpot.rx, inkpot.ry, GLASS.dark);
  fillRect(p, inkpot.neckX0, inkpot.neckX1, inkpot.up, inkpot.neckTop, GLASS.dark, p.detail);
  inkedRod(p, DESK_TOP.quill, DESK_TOP.quillWidth, CLOTH.linen.light);
  fillPolygon(p, DESK_TOP.vane, CLOTH.linen.light, p.detail);
  candle(p, DESK_TOP.candleX, DESK_TOP.candleUp, DESK_TOP.candleHeight);
}

function paintDesk(p: Pen): void {
  shadow(p, PAIR_MIDDLE, TABLE.floor, PAIR_SHADOW_RX, FLOOR_SHADOW_RY);
  leg(p, TABLE.x1 - TABLE.legInset, TABLE.legWidth, TABLE.floor, TABLE.topFront - TABLE.apron);
  paintDeskPedestal(p);
  slab(p, {
    x0: TABLE.x0,
    x1: TABLE.x1,
    topFront: TABLE.topFront,
    topBack: TABLE.topBack,
    apron: TABLE.apron,
  });
  paintDeskTop(p);
}

// ── Beds ──────────────────────────────────────────────────────────────────────

const BED = {
  x0: 0.08,
  x1: 0.92,
  floor: 0.08,
  /** Where the bed's back end meets the floor; the headboard and its posts rise from here. */
  headFloor: 1.9,
  mattressFront: 0.44,
  mattressBack: 2.22,
  mattressInset: 0.02,
  mattressOverhang: 0.1,
  headboardTop: 2.72,
  headboardShoulderDrop: 0.12,
  headboardCrownRise: 0.1,
  headboardBoard: 0.2,
  knotDrop: 0.2,
  knotRadius: 0.08,
  knotLine: 0.022,
  headPostTop: 2.82,
  footboardTop: 0.58,
  footboardBoard: 0.13,
  footPostRise: 0.06,
  footboardLift: 0.06,
  postWidth: 0.1,
  pillowX0: 0.2,
  pillowX1: 0.8,
  pillowFront: 1.86,
  pillowBackInset: 0.04,
  pillowRadius: 0.08,
  pillowSeamX0: 0.3,
  pillowSeamX1: 0.7,
  pillowSeamLift: 0.12,
  pillowSeamAlpha: 0.5,
  sheetFoldFront: 1.72,
  sheetFoldDepth: 0.1,
  sheetFoldLift: 0.02,
  quiltInset: 0.04,
  quiltOverhang: 0.14,
  /** A soft shade across the middle of the bed, where the sleeper's weight hollows it. */
  hollowUp: 1.1,
  hollowRx: 0.26,
  hollowRy: 0.4,
  hollowAlpha: 0.12,
  shadowRx: 0.42,
} as const;

/** The bed's quilt colour per variant; the renderer picks the variant by the household's colour. */
const BED_QUILTS: ReadonlyArray<ClothColour> = ['madder', 'woad', 'weld'];
const QUILT_SQUARE_TILES = 0.21;
/** Patchwork is a pattern in the quilt, not a chessboard: the patches sit close to the ground colour. */
const QUILT_PATCH_ALPHA = 0.55;
/** One patch in four is the light tone, the rest dark, so the pattern is not a strict alternation. */
const QUILT_LIGHT_EVERY = 4;

function paintHeadboard(p: Pen, postHalf: number): void {
  const { ctx } = p;
  for (const px of [BED.x0 + postHalf, BED.x1 - postHalf]) {
    postWithEnd(p, px, postHalf, BED.headFloor, BED.headPostTop, WOOD.dark);
  }
  const shoulderUp = BED.headboardTop - BED.headboardShoulderDrop;
  const traceHeadboard = (): void => {
    ctx.beginPath();
    ctx.moveTo(p.x(BED.x0 + BED.postWidth), p.y(BED.headFloor));
    ctx.lineTo(p.x(BED.x0 + BED.postWidth), p.y(shoulderUp));
    ctx.quadraticCurveTo(
      p.x(TILE_MIDDLE),
      p.y(BED.headboardTop + BED.headboardCrownRise),
      p.x(BED.x1 - BED.postWidth),
      p.y(shoulderUp),
    );
    ctx.lineTo(p.x(BED.x1 - BED.postWidth), p.y(BED.headFloor));
    ctx.closePath();
  };
  clipTo(p, traceHeadboard, () =>
    planks(
      p,
      BED.x0,
      BED.x1,
      BED.headFloor,
      BED.headboardTop + BED.headboardCrownRise,
      'vertical',
      BED.headboardBoard,
      WOOD.body,
      NO_NAILS,
    ),
  );
  traceHeadboard();
  inkOutline(ctx, p.outline);
  drawBriarKnot(
    ctx,
    p.x(TILE_MIDDLE),
    p.y(BED.headboardTop - BED.knotDrop),
    p.s(BED.knotRadius),
    WOOD.highlight,
    p.s(BED.knotLine),
  );
}

function paintMattressAndPillow(p: Pen): void {
  fillRect(
    p,
    BED.x0 + BED.mattressInset,
    BED.x1 - BED.mattressInset,
    BED.mattressFront - BED.mattressOverhang,
    BED.mattressBack,
    CLOTH.linen.body,
  );
  fillRounded(
    p,
    BED.pillowX0,
    BED.pillowX1,
    BED.pillowFront,
    BED.mattressBack - BED.pillowBackInset,
    BED.pillowRadius,
    CLOTH.linen.light,
  );
  withAlpha(p, BED.pillowSeamAlpha, () =>
    strokePath(
      p,
      [
        [BED.pillowSeamX0, BED.pillowFront + BED.pillowSeamLift],
        [BED.pillowSeamX1, BED.pillowFront + BED.pillowSeamLift],
      ],
      detailTiles(p),
      CLOTH.linen.dark,
    ),
  );
}

/** Patchwork in the household colour, the sheet turned back over its top edge. */
function paintQuilt(p: Pen, quilt: (typeof CLOTH)[ClothColour]): void {
  const quiltX0 = BED.x0 + BED.quiltInset;
  const quiltX1 = BED.x1 - BED.quiltInset;
  const quiltBottom = BED.mattressFront - BED.quiltOverhang;
  fillRect(p, quiltX0, quiltX1, quiltBottom, BED.sheetFoldFront, quilt.body);
  clipTo(
    p,
    () => traceRect(p, quiltX0, quiltX1, quiltBottom, BED.sheetFoldFront),
    () => {
      const columns = Math.ceil((quiltX1 - quiltX0) / QUILT_SQUARE_TILES);
      const rows = Math.ceil((BED.sheetFoldFront - quiltBottom) / QUILT_SQUARE_TILES);
      for (let row = 0; row < rows; row++) {
        for (let column = 0; column < columns; column++) {
          if ((row + column) % 2 === 0) continue;
          const sx = quiltX0 + column * QUILT_SQUARE_TILES;
          const sUp = quiltBottom + row * QUILT_SQUARE_TILES;
          withAlpha(p, QUILT_PATCH_ALPHA, () =>
            fillRect(
              p,
              sx,
              sx + QUILT_SQUARE_TILES,
              sUp,
              sUp + QUILT_SQUARE_TILES,
              (row + column) % QUILT_LIGHT_EVERY === 1 ? quilt.light : quilt.dark,
              null,
            ),
          );
        }
      }
    },
  );
  traceRect(p, quiltX0, quiltX1, quiltBottom, BED.sheetFoldFront);
  inkOutline(p.ctx, p.outline);
  fillRect(
    p,
    quiltX0,
    quiltX1,
    BED.sheetFoldFront - BED.sheetFoldDepth,
    BED.sheetFoldFront + BED.sheetFoldLift,
    CLOTH.linen.light,
  );
  stain(p, TILE_MIDDLE, BED.hollowUp, BED.hollowRx, BED.hollowRy, SHADE, BED.hollowAlpha);
}

function paintFootboard(p: Pen, postHalf: number): void {
  for (const px of [BED.x0 + postHalf, BED.x1 - postHalf]) {
    postWithEnd(p, px, postHalf, BED.floor, BED.footboardTop + BED.footPostRise, WOOD.dark);
  }
  const boardX0 = BED.x0 + BED.postWidth;
  const boardX1 = BED.x1 - BED.postWidth;
  const boardBottom = BED.floor + BED.footboardLift;
  planks(
    p,
    boardX0,
    boardX1,
    boardBottom,
    BED.footboardTop,
    'horizontal',
    BED.footboardBoard,
    WOOD.body,
    NO_NAILS,
  );
  traceRect(p, boardX0, boardX1, boardBottom, BED.footboardTop);
  inkOutline(p.ctx, p.outline);
}

function paintBed(p: Pen, variant: number): void {
  const quilt = CLOTH[BED_QUILTS[variant % BED_QUILTS.length] ?? 'madder'];
  const postHalf = BED.postWidth / 2;
  shadow(p, TILE_MIDDLE, BED.floor, BED.shadowRx, FLOOR_SHADOW_RY);
  paintHeadboard(p, postHalf);
  paintMattressAndPillow(p);
  paintQuilt(p, quilt);
  paintFootboard(p, postHalf);
}

const COT = {
  railX0: 0.12,
  railX1: 0.88,
  railWidth: 0.07,
  railLitShare: 0.2,
  capRxShare: 1.1,
  capRyShare: 0.6,
  front: 0.4,
  back: 2.18,
  floor: 0.1,
  legTopDrop: 0.02,
  legWidth: 0.04,
  canvasFront: 0.44,
  canvasOverhang: 0.06,
  canvasBackInset: 0.02,
  sheetInset: 0.04,
  sheetBackInset: 0.06,
  creaseUps: [1.2, 1.5],
  creasePoints: [
    [0.24, 0],
    [0.5, 0.04],
    [0.74, -0.02],
  ],
  creaseAlpha: 0.35,
  pillow: { x0: 0.24, x1: 0.76, up0: 1.8, up1: 2.06, radius: 0.08 },
  blanketInset: 0.03,
  blanketLift: 0.02,
  blanketTop: 0.8,
  blanketFoldDepth: 0.1,
  stripeLow: 0.08,
  stripeHigh: 0.12,
  bandageX: 0.62,
  bandageUp: 1.06,
  shadowRx: 0.42,
} as const;

const BANDAGE = {
  halfW: 0.09,
  radius: 0.06,
  tail: 0.14,
  tailRootShare: 0.4,
  tailSlopeShare: 0.4,
  tailTipBackX: 0.03,
  tailTipDrop: 0.05,
  tailJoinDrop: 0.02,
  cornerShare: 0.5,
  faceRxShare: 0.45,
  coreRxShare: 0.12,
  coreRyShare: 0.25,
} as const;

/** A roll of linen bandage lying on its side, its loose end trailing. */
function bandageRoll(p: Pen, cx: number, cUp: number): void {
  const { halfW, radius, tail } = BANDAGE;
  const tailRoot = cx - halfW * BANDAGE.tailRootShare;
  const tailSlope = tail * BANDAGE.tailSlopeShare;
  fillPolygon(
    p,
    [
      [tailRoot, cUp - radius],
      [tailRoot - tail, cUp - radius - tailSlope],
      [tailRoot - tail + BANDAGE.tailTipBackX, cUp - radius - tailSlope - BANDAGE.tailTipDrop],
      [cx, cUp - radius - BANDAGE.tailJoinDrop],
    ],
    CLOTH.linen.light,
    p.detail,
  );
  fillRounded(
    p,
    cx - halfW,
    cx + halfW,
    cUp - radius,
    cUp + radius,
    radius * BANDAGE.cornerShare,
    CLOTH.linen.light,
  );
  fillEllipse(p, cx + halfW, cUp, radius * BANDAGE.faceRxShare, radius, BLEACHED_LINEN);
  fillEllipse(
    p,
    cx + halfW,
    cUp,
    radius * BANDAGE.coreRxShare,
    radius * BANDAGE.coreRyShare,
    CLOTH.linen.dark,
    null,
  );
}

function paintCotSheet(p: Pen): void {
  fillRect(
    p,
    COT.railX0,
    COT.railX1,
    COT.canvasFront - COT.canvasOverhang,
    COT.back - COT.canvasBackInset,
    CLOTH.linen.dark,
  );
  fillRect(
    p,
    COT.railX0 + COT.sheetInset,
    COT.railX1 - COT.sheetInset,
    COT.canvasFront,
    COT.back - COT.sheetBackInset,
    CLOTH.linen.light,
    null,
  );
  withAlpha(p, COT.creaseAlpha, () => {
    for (const creaseUp of COT.creaseUps) {
      strokePath(
        p,
        COT.creasePoints.map(([x, rise]): Point => [x, creaseUp + rise]),
        detailTiles(p),
        CLOTH.linen.dark,
      );
    }
  });
  const { pillow } = COT;
  fillRounded(p, pillow.x0, pillow.x1, pillow.up0, pillow.up1, pillow.radius, BLEACHED_LINEN);
}

/** A madder blanket folded at the cot's foot, a linen stripe woven across it. */
function paintCotBlanket(p: Pen): void {
  const x0 = COT.railX0 + COT.blanketInset;
  const x1 = COT.railX1 - COT.blanketInset;
  const bottom = COT.canvasFront + COT.blanketLift;
  fillRect(p, x0, x1, bottom, COT.blanketTop, CLOTH.madder.dark);
  fillRect(
    p,
    x0,
    x1,
    COT.blanketTop - COT.blanketFoldDepth,
    COT.blanketTop,
    CLOTH.madder.body,
    null,
  );
  fillRect(
    p,
    x0,
    x1,
    COT.canvasFront + COT.stripeLow,
    COT.canvasFront + COT.stripeHigh,
    CLOTH.linen.light,
    null,
  );
  traceRect(p, x0, x1, bottom, COT.blanketTop);
  inkOutline(p.ctx, p.detail);
}

/** Sella's cot: a plain camp bed, crisp linen, a folded blanket — nothing of a household about it. */
function paintCot(p: Pen): void {
  shadow(p, TILE_MIDDLE, COT.floor, COT.shadowRx, SLIM_SHADOW_RY);
  const railHalf = COT.railWidth / 2;
  const leftRail = COT.railX0 + railHalf;
  const rightRail = COT.railX1 - railHalf;
  for (const [from, to] of [
    [leftRail, rightRail],
    [rightRail, leftRail],
  ] as const) {
    inkedRod(
      p,
      [
        [from, COT.floor],
        [to, COT.front - COT.legTopDrop],
      ],
      COT.legWidth,
      WOOD.body,
    );
  }
  paintCotSheet(p);
  paintCotBlanket(p);
  bandageRoll(p, COT.bandageX, COT.bandageUp);
  for (const rx of [leftRail, rightRail]) {
    fillRect(p, rx - railHalf, rx + railHalf, COT.front, COT.back, WOOD.mid);
    fillRect(
      p,
      rx - railHalf,
      rx - railHalf * COT.railLitShare,
      COT.front,
      COT.back,
      WOOD.highlight,
      null,
    );
    fillEllipse(
      p,
      rx,
      COT.front,
      railHalf * COT.capRxShare,
      railHalf * COT.capRyShare,
      BRASS.body,
      p.detail,
    );
  }
}

const BUNK = {
  x0: 0.08,
  x1: 0.92,
  postWidth: 0.09,
  postLitShare: 0.3,
  floor: 0.06,
  frontPostTop: 1.18,
  backPostBottom: 1.9,
  backPostTop: 2.9,
  headRailDrop: 0.02,
  headRailRise: 0.1,
  lowerTop: 0.34,
  /** Depth of each tier's front rail, below its mattress. */
  railDepth: 0.1,
  upperFront: 1.0,
  upperBack: 2.74,
  apron: 0.12,
  blanketInset: 0.06,
  blanketFold: 0.06,
  upperBlanketTop: 2.2,
  pillow: { x0: 0.22, x1: 0.78, backDrop: 0.3, backInset: 0.06, radius: 0.07 },
  underShadowRx: 0.5,
  underShadowTiles: 0.07,
  underShadowAlpha: 0.5,
  ladderX0: 0.6,
  ladderX1: 0.8,
  ladderFootLift: 0.02,
  ladderTopRise: 0.08,
  ladderRailWidth: 0.035,
  rungUps: [0.3, 0.58],
  rungWidth: 0.03,
  shadowRx: 0.42,
} as const;

function bunkBlanket(p: Pen, up0: number, up1: number, cloth: Tone): void {
  fillRect(p, BUNK.x0 + BUNK.blanketInset, BUNK.x1 - BUNK.blanketInset, up0, up1, cloth.body);
  fillRect(
    p,
    BUNK.x0 + BUNK.blanketInset,
    BUNK.x1 - BUNK.blanketInset,
    up1 - BUNK.blanketFold,
    up1,
    cloth.light,
    null,
  );
}

/** Only the lower tier's front shows under the upper one. */
function paintLowerBunk(p: Pen): void {
  fillRect(p, BUNK.x0, BUNK.x1, BUNK.lowerTop - BUNK.railDepth, BUNK.upperFront, CLOTH.linen.dark);
  // The same blanket on both tiers is what makes the stack read as two beds.
  bunkBlanket(p, BUNK.lowerTop, BUNK.upperFront - BUNK.apron, GUARD_WOOL);
  stain(
    p,
    TILE_MIDDLE,
    BUNK.upperFront - BUNK.apron,
    BUNK.underShadowRx,
    BUNK.underShadowTiles,
    SHADE,
    BUNK.underShadowAlpha,
  );
  fillRect(p, BUNK.x0, BUNK.x1, BUNK.lowerTop - BUNK.railDepth, BUNK.lowerTop, WOOD.body);
  litLip(p, BUNK.x0, BUNK.x1, BUNK.lowerTop, WOOD.highlight);
}

function paintUpperBunk(p: Pen): void {
  fillRect(p, BUNK.x0, BUNK.x1, BUNK.upperFront, BUNK.upperBack, CLOTH.linen.body);
  const { pillow } = BUNK;
  fillRounded(
    p,
    pillow.x0,
    pillow.x1,
    BUNK.upperBack - pillow.backDrop,
    BUNK.upperBack - pillow.backInset,
    pillow.radius,
    CLOTH.linen.light,
  );
  bunkBlanket(p, BUNK.upperFront, BUNK.upperBlanketTop, GUARD_WOOL);
  fillRect(p, BUNK.x0, BUNK.x1, BUNK.upperFront - BUNK.apron, BUNK.upperFront, WOOD.body);
  litLip(p, BUNK.x0, BUNK.x1, BUNK.upperFront, WOOD.highlight);
  traceRect(p, BUNK.x0, BUNK.x1, BUNK.upperFront - BUNK.apron, BUNK.upperBack);
  inkOutline(p.ctx, p.outline);
}

function paintBunkLadder(p: Pen): void {
  for (const lx of [BUNK.ladderX0, BUNK.ladderX1]) {
    inkedRod(
      p,
      [
        [lx, BUNK.floor + BUNK.ladderFootLift],
        [lx, BUNK.upperFront + BUNK.ladderTopRise],
      ],
      BUNK.ladderRailWidth,
      WOOD.light,
      'butt',
    );
  }
  for (const rungUp of BUNK.rungUps) {
    inkedRod(
      p,
      [
        [BUNK.ladderX0, rungUp],
        [BUNK.ladderX1, rungUp],
      ],
      BUNK.rungWidth,
      WOOD.mid,
      'butt',
    );
  }
}

/** The guardhouse bunk: a two-high frame, grey wool, a ladder up the front. */
function paintBunk(p: Pen): void {
  const postHalf = BUNK.postWidth / 2;
  shadow(p, TILE_MIDDLE, BUNK.floor, BUNK.shadowRx, SLIM_SHADOW_RY);
  const postXs = [BUNK.x0 + postHalf, BUNK.x1 - postHalf];
  for (const px of postXs) {
    postWithEnd(p, px, postHalf, BUNK.backPostBottom, BUNK.backPostTop, WOOD.dark);
  }
  fillRect(
    p,
    BUNK.x0 + postHalf,
    BUNK.x1 - postHalf,
    BUNK.upperBack - BUNK.headRailDrop,
    BUNK.upperBack + BUNK.headRailRise,
    WOOD.body,
  );
  paintLowerBunk(p);
  paintUpperBunk(p);
  for (const px of postXs) {
    fillRect(p, px - postHalf, px + postHalf, BUNK.floor, BUNK.frontPostTop, WOOD.dark);
    fillRect(
      p,
      px - postHalf,
      px - postHalf * BUNK.postLitShare,
      BUNK.floor,
      BUNK.frontPostTop,
      WOOD.mid,
      null,
    );
    drawLogEnd(p.ctx, p.x(px), p.y(BUNK.frontPostTop), p.s(postHalf), p.s(postHalf * RIM_SQUASH));
  }
  paintBunkLadder(p);
}

// ── Shelves ───────────────────────────────────────────────────────────────────

const SHELF = {
  x0: 0.08,
  x1: 0.92,
  side: 0.07,
  sideLitShare: 0.35,
  base: 0.22,
  plinth: 0.1,
  top: 2.7,
  topDepth: 0.1,
  board: 0.06,
  backBoard: 0.21,
  backShadeAlpha: 0.4,
  /** The up of each shelf board's surface, bottom to top. */
  surfaces: [0.32, 0.92, 1.52, 2.12],
  shadowRx: 0.42,
} as const;

/** Which shelf is which, by index into `SHELF.surfaces`. */
const SHELF_BOTTOM = 0;
const SHELF_LOW = 1;
const SHELF_HIGH = 2;
const SHELF_TOP = 3;

const SHELF_INNER_X0 = SHELF.x0 + SHELF.side;
const SHELF_INNER_X1 = SHELF.x1 - SHELF.side;

/** The carcass of a tall open shelf; `stock` paints what stands on shelf `index`. */
function shelfUnit(p: Pen, stock: (index: number, surface: number) => void): void {
  shadow(p, TILE_MIDDLE, SHELF.base, SHELF.shadowRx, SLIM_SHADOW_RY);
  planks(
    p,
    SHELF.x0,
    SHELF.x1,
    SHELF.base,
    SHELF.top,
    'vertical',
    SHELF.backBoard,
    WOOD.deep,
    NO_NAILS,
  );
  withAlpha(p, SHELF.backShadeAlpha, () =>
    fillRect(p, SHELF.x0, SHELF.x1, SHELF.base, SHELF.top, SHADE, null),
  );
  SHELF.surfaces.forEach((surface, index) => {
    fillRect(p, SHELF.x0, SHELF.x1, surface - SHELF.board, surface, WOOD.body, null);
    fillRect(p, SHELF.x0, SHELF.x1, surface - LIP_TILES, surface, WOOD.highlight, null);
    stock(index, surface);
  });
  const plinthBottom = SHELF.base - SHELF.plinth;
  for (const [x0, x1] of [
    [SHELF.x0, SHELF.x0 + SHELF.side],
    [SHELF.x1 - SHELF.side, SHELF.x1],
  ] as const) {
    fillRect(p, x0, x1, plinthBottom, SHELF.top, WOOD.body);
    fillRect(
      p,
      x0,
      x0 + SHELF.side * SHELF.sideLitShare,
      plinthBottom,
      SHELF.top,
      WOOD.light,
      null,
    );
  }
  fillRect(p, SHELF.x0, SHELF.x1, SHELF.top, SHELF.top + SHELF.topDepth, WOOD.mid);
  fillRect(p, SHELF.x0, SHELF.x1, plinthBottom, SHELF.base, WOOD.dark);
  traceRect(p, SHELF.x0, SHELF.x1, plinthBottom, SHELF.top + SHELF.topDepth);
  inkOutline(p.ctx, p.outline);
}

/** The underside of the shelf above `index`: where things hang from. */
function shelfCeiling(index: number): number {
  const aboveIndex = index + 1;
  return aboveIndex < SHELF.surfaces.length ? SHELF.surfaces[aboveIndex] - SHELF.board : SHELF.top;
}

const SPINE_COLOURS = [
  CLOTH.madder.dark,
  CLOTH.woad.dark,
  WOOD.body,
  CLOTH.weld.dark,
  LOG.bark,
  CLOTH.madder.body,
] as const;

const SPINE = {
  widthMin: 0.06,
  widthMax: 0.09,
  heightMin: 0.36,
  heightMax: 0.46,
  bandLowShare: 0.72,
  bandHighShare: 0.78,
} as const;

function spines(p: Pen, x0: number, surface: number, count: number, rng: Rng): number {
  let cursor = x0;
  for (let book = 0; book < count; book++) {
    const width = range(rng, SPINE.widthMin, SPINE.widthMax);
    const height = range(rng, SPINE.heightMin, SPINE.heightMax);
    const colour = SPINE_COLOURS[book % SPINE_COLOURS.length];
    fillRect(p, cursor, cursor + width, surface, surface + height, colour, p.detail);
    fillRect(
      p,
      cursor,
      cursor + width,
      surface + height * SPINE.bandLowShare,
      surface + height * SPINE.bandHighShare,
      BRASS.body,
      null,
    );
    cursor += width;
  }
  return cursor;
}

const SCROLL = {
  shineShare: 0.6,
  endRxShare: 0.6,
  endRyShare: 0.9,
  ribbonHalfW: 0.015,
} as const;

function scroll(p: Pen, x0: number, x1: number, cUp: number, radius: number): void {
  fillRounded(p, x0, x1, cUp - radius, cUp + radius, radius, PARCHMENT.body);
  fillRect(
    p,
    x0 + radius,
    x1 - radius,
    cUp,
    cUp + radius * SCROLL.shineShare,
    PARCHMENT.light,
    null,
  );
  fillEllipse(
    p,
    x1 - radius * SCROLL.endRxShare,
    cUp,
    radius * SCROLL.endRxShare,
    radius * SCROLL.endRyShare,
    PARCHMENT.dark,
    p.detail,
  );
  const middle = (x0 + x1) / 2;
  fillRect(
    p,
    middle - SCROLL.ribbonHalfW,
    middle + SCROLL.ribbonHalfW,
    cUp - radius,
    cUp + radius,
    CLOTH.madder.body,
    null,
  );
}

/** Mayor's records, shelf by shelf: flat ledgers, upright books, a scroll pyramid, a jar of rolls. */
const RECORDS = {
  flatLedgers: 4,
  ledgerX0: 0.2,
  ledgerX1: 0.62,
  ledgerThickness: 0.08,
  ledgerJitter: 0.03,
  pageInset: 0.02,
  pageLow: 0.05,
  pageHigh: 0.07,
  box: { x0: 0.66, x1: 0.84, height: 0.2 },
  uprightBooks: 6,
  firstSpineInset: 0.02,
  leaningBook: {
    footWidth: 0.08,
    topRightInset: 0.02,
    topRightUp: 0.36,
    topLeftInset: 0.1,
    topLeftUp: 0.38,
  },
  scrollRows: 3,
  scrollRadius: 0.06,
  scrollX0: 0.17,
  scrollX1: 0.83,
  scrollStepIn: 0.02,
  scrollStackShare: 1.9,
  rollJar: { cx: 0.32, width: 0.2, height: 0.26 },
  rolls: [
    { x: 0.26, lean: -0.04 },
    { x: 0.33, lean: 0.01 },
    { x: 0.38, lean: 0.05 },
  ],
  rollFoot: 0.2,
  rollTop: 0.46,
  rollWidth: 0.04,
  looseSheets: [
    { cx: 0.66, lift: 0.08, halfW: 0.14, halfH: 0.07, skew: 0.01 },
    { cx: 0.66, lift: 0.14, halfW: 0.13, halfH: 0.06, skew: -0.01 },
  ],
} as const;

function paintFlatLedgers(p: Pen, surface: number, rng: Rng): void {
  for (let ledger = 0; ledger < RECORDS.flatLedgers; ledger++) {
    const up0 = surface + ledger * RECORDS.ledgerThickness;
    const inset = jitter(rng, RECORDS.ledgerJitter);
    fillRect(
      p,
      RECORDS.ledgerX0 + inset,
      RECORDS.ledgerX1 + inset,
      up0,
      up0 + RECORDS.ledgerThickness,
      SPINE_COLOURS[ledger],
      p.detail,
    );
    fillRect(
      p,
      RECORDS.ledgerX0 + RECORDS.pageInset + inset,
      RECORDS.ledgerX1 - RECORDS.pageInset + inset,
      up0 + RECORDS.pageLow,
      up0 + RECORDS.pageHigh,
      PARCHMENT.light,
      null,
    );
  }
  fillRect(p, RECORDS.box.x0, RECORDS.box.x1, surface, surface + RECORDS.box.height, WOOD.mid);
}

function paintUprightBooks(p: Pen, surface: number, rng: Rng): void {
  const end = spines(
    p,
    SHELF_INNER_X0 + RECORDS.firstSpineInset,
    surface,
    RECORDS.uprightBooks,
    rng,
  );
  const lean = RECORDS.leaningBook;
  fillPolygon(
    p,
    [
      [end, surface],
      [end + lean.footWidth, surface],
      [SHELF_INNER_X1 - lean.topRightInset, surface + lean.topRightUp],
      [SHELF_INNER_X1 - lean.topLeftInset, surface + lean.topLeftUp],
    ],
    CLOTH.woad.body,
    p.detail,
  );
}

function paintScrollPyramid(p: Pen, surface: number): void {
  const radius = RECORDS.scrollRadius;
  for (let row = 0; row < RECORDS.scrollRows; row++) {
    scroll(
      p,
      RECORDS.scrollX0 + row * RECORDS.scrollStepIn,
      RECORDS.scrollX1 - row * RECORDS.scrollStepIn,
      surface + radius + row * radius * RECORDS.scrollStackShare,
      radius,
    );
  }
}

function paintRollsAndSheets(p: Pen, surface: number): void {
  jar(p, { ...RECORDS.rollJar, upBase: surface, body: CLAY.body, lid: CLAY.dark });
  for (const roll of RECORDS.rolls) {
    inkedRod(
      p,
      [
        [roll.x, surface + RECORDS.rollFoot],
        [roll.x + roll.lean, surface + RECORDS.rollTop],
      ],
      RECORDS.rollWidth,
      PARCHMENT.light,
    );
  }
  for (const sheet of RECORDS.looseSheets) {
    paper(p, sheet.cx, surface + sheet.lift, sheet.halfW, sheet.halfH, sheet.skew);
  }
}

function paintShelfRecords(p: Pen): void {
  const rng = forkRng(p.rng);
  shelfUnit(p, (index, surface) => {
    if (index === SHELF_BOTTOM) paintFlatLedgers(p, surface, rng);
    else if (index === SHELF_LOW) paintUprightBooks(p, surface, rng);
    else if (index === SHELF_HIGH) paintScrollPyramid(p, surface);
    else paintRollsAndSheets(p, surface);
  });
}

const HERB_BUNDLE = {
  stringLength: 0.06,
  stringWidth: 0.015,
  stemHalfW: 0.025,
  fanRight: 0.09,
  fanRightDropShare: 0.75,
  tipRight: 0.03,
  tipLeft: 0.04,
  tipLeftDropShare: 0.96,
  fanLeft: 0.09,
  fanLeftDropShare: 0.7,
  ribTopDrop: 0.1,
  ribLean: 0.02,
  ribDropShare: 0.8,
  tieHalfW: 0.03,
  tieBottomDrop: 0.09,
} as const;

/** A bundle of drying herbs hung head-down: tied stems at the top, a leafy fan below. */
function herbBundle(p: Pen, cx: number, hangUp: number, length: number, leaf: string): void {
  const bundle = HERB_BUNDLE;
  const stemUp = hangUp - bundle.stringLength;
  strokePath(
    p,
    [
      [cx, hangUp],
      [cx, stemUp],
    ],
    bundle.stringWidth,
    PARCHMENT.dark,
  );
  fillPolygon(
    p,
    [
      [cx - bundle.stemHalfW, stemUp],
      [cx + bundle.stemHalfW, stemUp],
      [cx + bundle.fanRight, hangUp - length * bundle.fanRightDropShare],
      [cx + bundle.tipRight, hangUp - length],
      [cx - bundle.tipLeft, hangUp - length * bundle.tipLeftDropShare],
      [cx - bundle.fanLeft, hangUp - length * bundle.fanLeftDropShare],
    ],
    leaf,
    p.detail,
  );
  strokePath(
    p,
    [
      [cx, hangUp - bundle.ribTopDrop],
      [cx - bundle.ribLean, hangUp - length * bundle.ribDropShare],
    ],
    detailTiles(p),
    HERB.dark,
  );
  fillRect(
    p,
    cx - bundle.tieHalfW,
    cx + bundle.tieHalfW,
    hangUp - bundle.tieBottomDrop,
    stemUp,
    CLOTH.madder.body,
    null,
  );
}

/** Sella's infirmary shelf, top to bottom: drying herbs, remedy jars, mortar and bandages, linen. */
const HERB_SHELF = {
  bundles: [
    { x: 0.26, length: 0.4, leaf: HERB.body },
    { x: 0.44, length: 0.34, leaf: HERB.light },
    { x: 0.6, length: 0.42, leaf: HERB.bloom },
    { x: 0.76, length: 0.36, leaf: HERB.body },
  ],
  jars: [
    { cx: 0.24, width: 0.16, height: 0.3, body: GLASS.body, lid: LOG.cut, label: false },
    { cx: 0.44, width: 0.18, height: 0.36, body: GLASS.dark, lid: LOG.cut, label: true },
    { cx: 0.64, width: 0.15, height: 0.26, body: HERB.dark, lid: LOG.cut, label: false },
    { cx: 0.8, width: 0.12, height: 0.22, body: CLAY.body, lid: CLAY.dark, label: false },
  ],
  lowBundle: { x: 0.8, length: 0.3 },
  mortar: { x: 0.3, rimLift: 0.14, rx: 0.12 },
  pestleTip: { x: 0.42, lift: 0.34 },
  pestleWidth: 0.04,
  standingRolls: 2,
  rollX: 0.56,
  rollSpacing: 0.12,
  rollHalfW: 0.05,
  rollHeight: 0.14,
  rollCorner: 0.03,
  rollTopRy: 0.02,
  lyingRolls: [
    { x: 0.3, stack: 1 },
    { x: 0.3, stack: 3 },
    { x: 0.52, stack: 1 },
  ],
  linenFolds: 3,
  linenX0: 0.64,
  linenX1: 0.86,
  linenFold: 0.08,
} as const;

function paintDryingHerbs(p: Pen, ceiling: number): void {
  for (const bundle of HERB_SHELF.bundles)
    herbBundle(p, bundle.x, ceiling, bundle.length, bundle.leaf);
}

function paintRemedyJars(p: Pen, surface: number): void {
  for (const remedy of HERB_SHELF.jars) jar(p, { ...remedy, upBase: surface });
}

function paintMortarAndRolls(p: Pen, surface: number, ceiling: number): void {
  const shelf = HERB_SHELF;
  herbBundle(p, shelf.lowBundle.x, ceiling, shelf.lowBundle.length, HERB.light);
  bowl(p, shelf.mortar.x, surface + shelf.mortar.rimLift, shelf.mortar.rx, HERB.body, STONE.body);
  inkedRod(
    p,
    [
      [shelf.mortar.x, surface + shelf.mortar.rimLift],
      [shelf.pestleTip.x, surface + shelf.pestleTip.lift],
    ],
    shelf.pestleWidth,
    STONE.light,
  );
  for (let roll = 0; roll < shelf.standingRolls; roll++) {
    const rx = shelf.rollX + roll * shelf.rollSpacing;
    fillRounded(
      p,
      rx - shelf.rollHalfW,
      rx + shelf.rollHalfW,
      surface,
      surface + shelf.rollHeight,
      shelf.rollCorner,
      CLOTH.linen.light,
    );
    fillEllipse(
      p,
      rx,
      surface + shelf.rollHeight,
      shelf.rollHalfW,
      shelf.rollTopRy,
      CLOTH.linen.body,
      p.detail,
    );
  }
}

/** The infirmary's own stock sits at hand height: bandage rolls and folded linen. */
function paintBandageStock(p: Pen, surface: number): void {
  const shelf = HERB_SHELF;
  for (const roll of shelf.lyingRolls)
    bandageRoll(p, roll.x, surface + BANDAGE.radius * roll.stack);
  for (let fold = 0; fold < shelf.linenFolds; fold++) {
    const up0 = surface + fold * shelf.linenFold;
    fillRect(
      p,
      shelf.linenX0,
      shelf.linenX1,
      up0,
      up0 + shelf.linenFold,
      fold === 1 ? CLOTH.linen.body : CLOTH.linen.light,
      p.detail,
    );
  }
}

function paintShelfHerbs(p: Pen): void {
  shelfUnit(p, (index, surface) => {
    const ceiling = shelfCeiling(index);
    if (index === SHELF_TOP) paintDryingHerbs(p, ceiling);
    else if (index === SHELF_HIGH) paintRemedyJars(p, surface);
    else if (index === SHELF_LOW) paintMortarAndRolls(p, surface, ceiling);
    else paintBandageStock(p, surface);
  });
}

/** Vetch's stock, top to bottom: jars, folded cloth, a cheese and a sack, a crock and bowls. */
const GOODS_SHELF = {
  jars: [
    { cx: 0.26, width: 0.2, height: 0.32, body: CLAY.body, lid: CLAY.dark, label: false },
    { cx: 0.5, width: 0.18, height: 0.28, body: CLAY.light, lid: WOOD.dark, label: true },
    { cx: 0.74, width: 0.16, height: 0.24, body: GLASS.body, lid: LOG.cut, label: false },
  ],
  clothStacks: ['madder', 'woad', 'weld'],
  clothFirstX: 0.25,
  clothSpacing: 0.25,
  clothHalfW: 0.1,
  clothFolds: 3,
  clothFold: 0.09,
  cheese: {
    x: 0.34,
    x0: 0.14,
    x1: 0.54,
    rx: 0.2,
    topRy: 0.08,
    bottomRy: 0.06,
    bottomLift: 0.02,
    topLift: 0.14,
  },
  sack: { cx: 0.7, halfW: 0.12, height: 0.34 },
  crock: { cx: 0.3, width: 0.28, height: 0.4 },
  bowlX: 0.66,
  bowlLifts: [0.14, 0.2],
  bowlRx: 0.14,
} as const;

function paintGoodsJars(p: Pen, surface: number): void {
  for (const goods of GOODS_SHELF.jars) jar(p, { ...goods, upBase: surface });
}

function paintClothStacks(p: Pen, surface: number): void {
  const shelf = GOODS_SHELF;
  shelf.clothStacks.forEach((colour, column) => {
    const cx = shelf.clothFirstX + column * shelf.clothSpacing;
    for (let fold = 0; fold < shelf.clothFolds; fold++) {
      const up0 = surface + fold * shelf.clothFold;
      fillRect(
        p,
        cx - shelf.clothHalfW,
        cx + shelf.clothHalfW,
        up0,
        up0 + shelf.clothFold,
        fold === 1 ? CLOTH[colour].light : CLOTH[colour].body,
        p.detail,
      );
    }
  });
}

function paintCheeseAndSack(p: Pen, surface: number): void {
  const { cheese, sack: meal } = GOODS_SHELF;
  const topUp = surface + cheese.topLift;
  const bottomUp = surface + cheese.bottomLift;
  fillEllipse(p, cheese.x, topUp, cheese.rx, cheese.topRy, CLOTH.weld.light);
  fillRect(p, cheese.x0, cheese.x1, bottomUp, topUp, CLOTH.weld.body, null);
  fillEllipse(p, cheese.x, bottomUp, cheese.rx, cheese.bottomRy, CLOTH.weld.dark, null);
  traceRect(p, cheese.x0, cheese.x1, bottomUp, topUp);
  inkOutline(p.ctx, p.detail);
  fillEllipse(p, cheese.x, topUp, cheese.rx, cheese.topRy, CLOTH.weld.light, p.detail);
  sack(p, meal.cx, surface, meal.halfW, meal.height, BURLAP);
}

function paintCrockAndBowls(p: Pen, surface: number): void {
  const shelf = GOODS_SHELF;
  jar(p, { ...shelf.crock, upBase: surface, body: CLAY.dark, lid: WOOD.body });
  for (const lift of shelf.bowlLifts) bowl(p, shelf.bowlX, surface + lift, shelf.bowlRx, null);
}

function paintShelfGoods(p: Pen): void {
  shelfUnit(p, (index, surface) => {
    if (index === SHELF_TOP) paintGoodsJars(p, surface);
    else if (index === SHELF_HIGH) paintClothStacks(p, surface);
    else if (index === SHELF_LOW) paintCheeseAndSack(p, surface);
    else paintCrockAndBowls(p, surface);
  });
}

// ── Banner ────────────────────────────────────────────────────────────────────

const BANNER = {
  post: 0.5,
  postWidth: 0.07,
  footX0: 0.2,
  footX1: 0.8,
  foot: 0.14,
  footWidth: 0.07,
  postTop: 2.74,
  finialLift: 0.04,
  finialRadius: 0.05,
  barUp: 2.54,
  barX0: 0.12,
  barX1: 0.88,
  barWidth: 0.06,
  barCapRx: 0.035,
  barCapRy: 0.045,
  clothX0: 0.2,
  clothX1: 0.8,
  clothTop: 2.5,
  clothSide: 1.1,
  clothPoint: 0.82,
  border: 0.05,
  borderTopShare: 1.4,
  borderSideShare: 0.3,
  borderPointShare: 1.3,
  borderLine: 0.022,
  knotUp: 1.78,
  knotRadius: 0.19,
  knotInkLine: 0.06,
  knotLine: 0.035,
  folds: 4,
  foldShadeAtShare: 0.85,
  foldShadeUp: 1.7,
  foldShadeRxShare: 0.3,
  foldShadeRy: 1.2,
  foldShadeAlpha: 0.5,
  sheenInset: 0.08,
  sheenUp: 1.9,
  sheenRx: 0.08,
  sheenRy: 1.0,
  sheenAlpha: 0.45,
  tabInset: 0.1,
  tabHalfW: 0.04,
  tabDrop: 0.02,
  tabRise: 0.06,
  shadowRx: 0.34,
} as const;

function paintBannerStand(p: Pen): void {
  inkedRod(
    p,
    [
      [BANNER.footX0, BANNER.foot],
      [BANNER.footX1, BANNER.foot],
    ],
    BANNER.footWidth,
    LOG.bark,
  );
  fillRect(
    p,
    BANNER.post - BANNER.postWidth / 2,
    BANNER.post + BANNER.postWidth / 2,
    BANNER.foot,
    BANNER.postTop,
    WOOD.dark,
  );
  fillEllipse(
    p,
    BANNER.post,
    BANNER.postTop + BANNER.finialLift,
    BANNER.finialRadius,
    BANNER.finialRadius,
    BRASS.light,
  );
  inkedRod(
    p,
    [
      [BANNER.barX0, BANNER.barUp],
      [BANNER.barX1, BANNER.barUp],
    ],
    BANNER.barWidth,
    WOOD.body,
    'butt',
  );
  for (const ex of [BANNER.barX0, BANNER.barX1]) {
    fillEllipse(p, ex, BANNER.barUp, BANNER.barCapRx, BANNER.barCapRy, BRASS.body, p.detail);
  }
}

function paintBannerCloth(p: Pen, outline: ReadonlyArray<Point>): void {
  const cloth = CLOTH.madder;
  fillPolygon(p, outline, cloth.body);
  clipTo(
    p,
    () => tracePolygon(p, outline),
    () => {
      const foldWidth = (BANNER.clothX1 - BANNER.clothX0) / BANNER.folds;
      for (let fold = 0; fold < BANNER.folds; fold++) {
        const fx = BANNER.clothX0 + fold * foldWidth;
        stain(
          p,
          fx + foldWidth * BANNER.foldShadeAtShare,
          BANNER.foldShadeUp,
          foldWidth * BANNER.foldShadeRxShare,
          BANNER.foldShadeRy,
          cloth.dark,
          BANNER.foldShadeAlpha,
        );
      }
      stain(
        p,
        BANNER.clothX0 + BANNER.sheenInset,
        BANNER.sheenUp,
        BANNER.sheenRx,
        BANNER.sheenRy,
        cloth.light,
        BANNER.sheenAlpha,
      );
    },
  );
  const inset = BANNER.border;
  tracePolygon(p, [
    [BANNER.clothX0 + inset, BANNER.clothTop - inset * BANNER.borderTopShare],
    [BANNER.clothX1 - inset, BANNER.clothTop - inset * BANNER.borderTopShare],
    [BANNER.clothX1 - inset, BANNER.clothSide + inset * BANNER.borderSideShare],
    [BANNER.post, BANNER.clothPoint + inset * BANNER.borderPointShare],
    [BANNER.clothX0 + inset, BANNER.clothSide + inset * BANNER.borderSideShare],
  ]);
  p.ctx.strokeStyle = CLOTH.weld.body;
  p.ctx.lineWidth = p.s(BANNER.borderLine);
  p.ctx.stroke();
  tracePolygon(p, outline);
  inkOutline(p.ctx, p.outline);
}

function paintBanner(p: Pen): void {
  shadow(p, BANNER.post, BANNER.foot, BANNER.shadowRx, SLIM_SHADOW_RY);
  paintBannerStand(p);
  const outline: Point[] = [
    [BANNER.clothX0, BANNER.clothTop],
    [BANNER.clothX1, BANNER.clothTop],
    [BANNER.clothX1, BANNER.clothSide],
    [BANNER.post, BANNER.clothPoint],
    [BANNER.clothX0, BANNER.clothSide],
  ];
  paintBannerCloth(p, outline);
  for (const [colour, line] of [
    [INK, BANNER.knotInkLine],
    [CLOTH.weld.light, BANNER.knotLine],
  ] as const) {
    drawBriarKnot(
      p.ctx,
      p.x(BANNER.post),
      p.y(BANNER.knotUp),
      p.s(BANNER.knotRadius),
      colour,
      p.s(line),
    );
  }
  for (const tx of [BANNER.clothX0 + BANNER.tabInset, BANNER.clothX1 - BANNER.tabInset]) {
    fillRect(
      p,
      tx - BANNER.tabHalfW,
      tx + BANNER.tabHalfW,
      BANNER.clothTop - BANNER.tabDrop,
      BANNER.clothTop + BANNER.tabRise,
      CLOTH.madder.dark,
      p.detail,
    );
  }
}

// ── Hall hearth ───────────────────────────────────────────────────────────────

const HALL_HEARTH = {
  x0: 0.06,
  x1: 0.94,
  bottom: 0.08,
  breastTop: 1.26,
  mantelBottom: 1.26,
  mantelTop: 1.38,
  mantelOverhang: 0.03,
  stackHalfW: 0.2,
  shoulderUp: 1.6,
  capHalfW: 0.26,
  archHalfW: 0.25,
  archSpring: 0.56,
  sootRx: 0.3,
  sootRy: 0.25,
  sootAlpha: 0.7,
  emberRy: 0.06,
  plaqueUp: 2.06,
  plaqueRadius: 0.12,
  knotShare: 0.72,
  knotLine: 0.025,
  stoneTiles: 0.15,
  candleX: 0.2,
  candleHeight: 0.16,
  jar: { cx: 0.8, width: 0.12, height: 0.2 },
  shadowRx: 0.44,
} as const;

function paintHallChimney(p: Pen): void {
  const flueTop = HALL_HEARTH_CHIMNEY_TOP.up - FLUE_CAP_HEIGHT_TILES;
  const stackX0 = HALL_HEARTH_CHIMNEY_TOP.x - HALL_HEARTH.stackHalfW;
  const stackX1 = HALL_HEARTH_CHIMNEY_TOP.x + HALL_HEARTH.stackHalfW;
  stonesInPolygon(
    p,
    [
      [HALL_HEARTH.x0, HALL_HEARTH.bottom],
      [HALL_HEARTH.x0, HALL_HEARTH.breastTop],
      [stackX0, HALL_HEARTH.shoulderUp],
      [stackX0, flueTop],
      [stackX1, flueTop],
      [stackX1, HALL_HEARTH.shoulderUp],
      [HALL_HEARTH.x1, HALL_HEARTH.breastTop],
      [HALL_HEARTH.x1, HALL_HEARTH.bottom],
    ],
    HALL_HEARTH.stoneTiles,
  );
  flueCap(p, HALL_HEARTH_CHIMNEY_TOP.x, HALL_HEARTH_CHIMNEY_TOP.up, HALL_HEARTH.capHalfW);
}

/** The village's knot in brass on the hall's chimney breast: this is the hearth of the whole village. */
function paintHallPlaque(p: Pen): void {
  const cx = HALL_HEARTH_FIRE.x;
  fillEllipse(
    p,
    cx,
    HALL_HEARTH.plaqueUp,
    HALL_HEARTH.plaqueRadius,
    HALL_HEARTH.plaqueRadius,
    BRASS.dark,
  );
  drawBriarKnot(
    p.ctx,
    p.x(cx),
    p.y(HALL_HEARTH.plaqueUp),
    p.s(HALL_HEARTH.plaqueRadius * HALL_HEARTH.knotShare),
    BRASS.light,
    p.s(HALL_HEARTH.knotLine),
  );
}

function paintHallFire(p: Pen): void {
  const cx = HALL_HEARTH_FIRE.x;
  clipTo(
    p,
    () =>
      traceRect(p, HALL_HEARTH.x0, HALL_HEARTH.x1, HALL_HEARTH.bottom, HALL_HEARTH.mantelBottom),
    () =>
      stain(
        p,
        cx,
        HALL_HEARTH.archSpring + HALL_HEARTH.archHalfW,
        HALL_HEARTH.sootRx,
        HALL_HEARTH.sootRy,
        SOOT,
        HALL_HEARTH.sootAlpha,
      ),
  );
  firebox(
    p,
    cx,
    HALL_HEARTH.archHalfW,
    HALL_HEARTH.bottom + HEARTH_EMBERS.firebox,
    HALL_HEARTH.archSpring,
  );
  emberBed(
    p,
    cx,
    HALL_HEARTH_FIRE.up - HEARTH_EMBERS.bedDrop,
    HALL_HEARTH.archHalfW * HEARTH_EMBERS.bedWidthShare,
    HALL_HEARTH.emberRy,
  );
  charredLogs(
    p,
    cx,
    HALL_HEARTH_FIRE.up - HEARTH_EMBERS.logDrop,
    HALL_HEARTH.archHalfW * HEARTH_EMBERS.logSpanShare,
  );
}

function paintHallHearth(p: Pen): void {
  shadow(p, TILE_MIDDLE, HALL_HEARTH.bottom, HALL_HEARTH.shadowRx, SLIM_SHADOW_RY);
  paintHallChimney(p);
  paintHallPlaque(p);
  paintHallFire(p);
  mantel(
    p,
    HALL_HEARTH.x0 - HALL_HEARTH.mantelOverhang,
    HALL_HEARTH.x1 + HALL_HEARTH.mantelOverhang,
    HALL_HEARTH.mantelBottom,
    HALL_HEARTH.mantelTop,
  );
  candle(p, HALL_HEARTH.candleX, HALL_HEARTH.mantelTop, HALL_HEARTH.candleHeight);
  jar(p, {
    ...HALL_HEARTH.jar,
    upBase: HALL_HEARTH.mantelTop,
    body: CLAY.body,
    lid: CLAY.dark,
  });
}

// ── Drafting table and model ──────────────────────────────────────────────────

const DRAFT = {
  boardX0: 0.12,
  boardX1: 1.88,
  boardFront: 0.74,
  boardBack: 1.9,
  boardPlank: 0.2,
  ledge: 0.07,
  foxingAlpha: 0.35,
  foxing: [
    { corner: 'frontRight', rx: 0.3, ry: 0.2 },
    { corner: 'backLeft', rx: 0.22, ry: 0.16 },
  ],
  paperX0: 0.34,
  paperX1: 1.6,
  paperFront: 0.88,
  paperBack: 1.78,
  paperShadowShift: 0.03,
  paperShadowRx: 0.66,
  paperShadowRy: 0.48,
  paperShadowAlpha: 0.25,
  tackInset: 0.03,
  tackRadius: 0.025,
  line: 0.024,
  trestleXs: [0.24, 1.76],
  trestleSplay: 0.1,
  trestleFoot: 0.1,
  trestleWidth: 0.05,
  stretcherUp: 0.34,
  stretcherWidth: 0.045,
  setSquare: [
    [1.66, 0.92],
    [1.82, 0.92],
    [1.66, 1.3],
  ],
  pencil: { x0: 0.4, x1: 0.78, lift: 0.02, width: 0.03 },
  shadowFloor: 0.1,
} as const;

/**
 * The trebuchet on Tikka's sheet, as fractions of the sheet: `[across, up]`.
 * Frame border, base rail, A-frame, throwing arm, counterweight, sling line,
 * pivot, and a few dimension ticks.
 */
const BLUEPRINT_LINES = {
  border: [
    [0.06, 0.08],
    [0.94, 0.08],
    [0.94, 0.92],
    [0.06, 0.92],
    [0.06, 0.08],
  ],
  base: [
    [0.18, 0.2],
    [0.72, 0.2],
  ],
  aFrame: [
    [0.28, 0.2],
    [0.45, 0.62],
    [0.62, 0.2],
  ],
  arm: [
    [0.2, 0.3],
    [0.45, 0.62],
    [0.86, 0.84],
  ],
  weightHanger: [
    [0.2, 0.3],
    [0.2, 0.2],
  ],
  weight: { x0: 0.14, x1: 0.26, up0: 0.3, up1: 0.46 },
  sling: [
    [0.86, 0.84],
    [0.8, 0.6],
  ],
  pivot: [0.45, 0.62],
  pivotRadius: 0.03,
  ticks: [
    [
      [0.78, 0.2],
      [0.9, 0.2],
    ],
    [
      [0.78, 0.3],
      [0.88, 0.3],
    ],
    [
      [0.78, 0.4],
      [0.9, 0.4],
    ],
  ],
  tickAlpha: 0.6,
} as const;

/** Tikka's trebuchet, drawn in pale line on a blue sheet inside `x0..x1, up0..up1`. */
function blueprintDrawing(p: Pen, x0: number, x1: number, up0: number, up1: number): void {
  const w = x1 - x0;
  const h = up1 - up0;
  const at = ([fx, fy]: Point): Point => [x0 + fx * w, up0 + fy * h];
  const line = (points: ReadonlyArray<Point>): void =>
    strokePath(p, points.map(at), DRAFT.line, BLUEPRINT.line);
  const plan = BLUEPRINT_LINES;
  line(plan.border);
  line(plan.base);
  line(plan.aFrame);
  line(plan.arm);
  line(plan.weightHanger);
  fillRect(
    p,
    x0 + w * plan.weight.x0,
    x0 + w * plan.weight.x1,
    up0 + h * plan.weight.up0,
    up0 + h * plan.weight.up1,
    BLUEPRINT.line,
    null,
  );
  line(plan.sling);
  fillEllipse(
    p,
    x0 + w * plan.pivot[0],
    up0 + h * plan.pivot[1],
    plan.pivotRadius,
    plan.pivotRadius,
    BLUEPRINT.line,
    null,
  );
  withAlpha(p, plan.tickAlpha, () => {
    for (const tick of plan.ticks) line(tick);
  });
}

function paintDraftingTrestles(p: Pen): void {
  for (const lx of DRAFT.trestleXs) {
    inkedRod(
      p,
      [
        [lx - DRAFT.trestleSplay, DRAFT.trestleFoot],
        [lx, DRAFT.boardFront],
        [lx + DRAFT.trestleSplay, DRAFT.trestleFoot],
      ],
      DRAFT.trestleWidth,
      WOOD.dark,
    );
  }
  const [leftTrestle, rightTrestle] = DRAFT.trestleXs;
  inkedRod(
    p,
    [
      [leftTrestle, DRAFT.stretcherUp],
      [rightTrestle, DRAFT.stretcherUp],
    ],
    DRAFT.stretcherWidth,
    WOOD.dark,
    'butt',
  );
}

function paintBlueprintSheet(p: Pen): void {
  shadow(
    p,
    (DRAFT.paperX0 + DRAFT.paperX1) / 2 + DRAFT.paperShadowShift,
    (DRAFT.paperFront + DRAFT.paperBack) / 2 - DRAFT.paperShadowShift,
    DRAFT.paperShadowRx,
    DRAFT.paperShadowRy,
    DRAFT.paperShadowAlpha,
  );
  fillRect(
    p,
    DRAFT.paperX0,
    DRAFT.paperX1,
    DRAFT.paperFront,
    DRAFT.paperBack,
    BLUEPRINT.paper,
    p.detail,
  );
  clipTo(
    p,
    () => traceRect(p, DRAFT.paperX0, DRAFT.paperX1, DRAFT.paperFront, DRAFT.paperBack),
    () => {
      for (const spot of DRAFT.foxing) {
        const frontRight = spot.corner === 'frontRight';
        stain(
          p,
          frontRight ? DRAFT.paperX1 : DRAFT.paperX0,
          frontRight ? DRAFT.paperFront : DRAFT.paperBack,
          spot.rx,
          spot.ry,
          BLUEPRINT.foxing,
          DRAFT.foxingAlpha,
        );
      }
    },
  );
  blueprintDrawing(p, DRAFT.paperX0, DRAFT.paperX1, DRAFT.paperFront, DRAFT.paperBack);
  for (const [tx, tUp] of [
    [DRAFT.paperX0 + DRAFT.tackInset, DRAFT.paperBack - DRAFT.tackInset],
    [DRAFT.paperX1 - DRAFT.tackInset, DRAFT.paperBack - DRAFT.tackInset],
    [DRAFT.paperX0 + DRAFT.tackInset, DRAFT.paperFront + DRAFT.tackInset],
    [DRAFT.paperX1 - DRAFT.tackInset, DRAFT.paperFront + DRAFT.tackInset],
  ] as const) {
    fillEllipse(p, tx, tUp, DRAFT.tackRadius, DRAFT.tackRadius, BRASS.light, null);
  }
}

function paintDraftingTable(p: Pen): void {
  shadow(p, PAIR_MIDDLE, DRAFT.shadowFloor, PAIR_SHADOW_RX, FLOOR_SHADOW_RY);
  paintDraftingTrestles(p);
  planks(
    p,
    DRAFT.boardX0,
    DRAFT.boardX1,
    DRAFT.boardFront,
    DRAFT.boardBack,
    'horizontal',
    DRAFT.boardPlank,
    WOOD.light,
    NO_NAILS,
  );
  traceRect(p, DRAFT.boardX0, DRAFT.boardX1, DRAFT.boardFront, DRAFT.boardBack);
  inkOutline(p.ctx, p.outline);
  paintBlueprintSheet(p);
  fillPolygon(p, DRAFT.setSquare, WOOD.worn, p.detail);
  fillRect(
    p,
    DRAFT.boardX0,
    DRAFT.boardX1,
    DRAFT.boardFront - DRAFT.ledge,
    DRAFT.boardFront,
    WOOD.body,
  );
  const { pencil } = DRAFT;
  inkedRod(
    p,
    [
      [pencil.x0, DRAFT.boardFront + pencil.lift],
      [pencil.x1, DRAFT.boardFront + pencil.lift],
    ],
    pencil.width,
    LOG.cut,
  );
}

const MODEL = {
  standX0: 0.2,
  standX1: 0.8,
  standBottom: 0.08,
  standTop: 0.36,
  standBack: 0.66,
  standPlank: 0.15,
  topOverhang: 0.03,
  topApron: 0.05,
  apexX: 0.46,
  apexUp: 1.08,
  footLeft: 0.3,
  footRight: 0.62,
  footUp: 0.5,
  /** The far rail and far A-frame sit behind the near ones, offset up and right. */
  farRailLift: 0.06,
  farRailLeft: 0.06,
  farRailRight: 0.08,
  farFrameShift: 0.04,
  farFrameLift: 0.12,
  farApexShift: 0.02,
  farRodShare: 0.8,
  nearRailLeft: 0.08,
  nearRailRight: 0.1,
  armTipX: 0.16,
  armTipUp: 1.64,
  weightX: 0.66,
  weightUp: 0.9,
  weightHalfW: 0.07,
  weightDrop: 0.12,
  weightRise: 0.02,
  weightLitX1: 0.03,
  weightTopDrop: 0.07,
  weightTopRy: 0.035,
  wheelRadius: 0.07,
  wheelSink: 0.01,
  wheelLeftShift: 0.02,
  wheelRightShift: 0.06,
  hubShare: 0.35,
  pivotRadius: 0.03,
  slingDrift: 0.04,
  slingDrop: 0.22,
  slingWidth: 0.014,
  pouchDrift: 0.045,
  pouchDrop: 0.25,
  pouchRx: 0.03,
  pouchRy: 0.025,
  rod: 0.035,
  shadowRx: 0.36,
} as const;

function paintModelStand(p: Pen): void {
  planks(
    p,
    MODEL.standX0,
    MODEL.standX1,
    MODEL.standBottom,
    MODEL.standTop,
    'vertical',
    MODEL.standPlank,
    WOOD.body,
    NO_NAILS,
  );
  slab(p, {
    x0: MODEL.standX0 - MODEL.topOverhang,
    x1: MODEL.standX1 + MODEL.topOverhang,
    topFront: MODEL.standTop,
    topBack: MODEL.standBack,
    apron: MODEL.topApron,
  });
  traceRect(p, MODEL.standX0, MODEL.standX1, MODEL.standBottom, MODEL.standTop - MODEL.topApron);
  inkOutline(p.ctx, p.outline);
}

function paintModelFarSide(p: Pen): void {
  const farRailUp = MODEL.footUp + MODEL.farRailLift;
  inkedRod(
    p,
    [
      [MODEL.footLeft - MODEL.farRailLeft, farRailUp],
      [MODEL.footRight + MODEL.farRailRight, farRailUp],
    ],
    MODEL.rod,
    LOG.cut,
    'butt',
  );
  const farFootUp = MODEL.footUp + MODEL.farFrameLift;
  inkedRod(
    p,
    [
      [MODEL.footLeft + MODEL.farFrameShift, farFootUp],
      [MODEL.apexX + MODEL.farApexShift, MODEL.apexUp],
      [MODEL.footRight + MODEL.farFrameShift, farFootUp],
    ],
    MODEL.rod * MODEL.farRodShare,
    LOG.cutDark,
  );
}

function paintModelCounterweight(p: Pen): void {
  const x0 = MODEL.weightX - MODEL.weightHalfW;
  const up0 = MODEL.weightUp - MODEL.weightDrop;
  const up1 = MODEL.weightUp + MODEL.weightRise;
  fillEllipse(
    p,
    MODEL.weightX,
    MODEL.weightUp - MODEL.weightTopDrop,
    MODEL.weightHalfW,
    MODEL.weightTopRy,
    BRASS.dark,
    null,
  );
  fillRect(p, x0, MODEL.weightX + MODEL.weightHalfW, up0, up1, BRASS.body);
  fillRect(p, x0, MODEL.weightX - MODEL.weightLitX1, up0, up1, BRASS.light, null);
}

function paintModelNearSide(p: Pen): void {
  inkedRod(
    p,
    [
      [MODEL.weightX, MODEL.weightUp],
      [MODEL.apexX, MODEL.apexUp],
      [MODEL.armTipX, MODEL.armTipUp],
    ],
    MODEL.rod,
    LOG.cut,
  );
  inkedRod(
    p,
    [
      [MODEL.footLeft, MODEL.footUp],
      [MODEL.apexX, MODEL.apexUp],
      [MODEL.footRight, MODEL.footUp],
    ],
    MODEL.rod,
    LOG.cut,
  );
  inkedRod(
    p,
    [
      [MODEL.footLeft - MODEL.nearRailLeft, MODEL.footUp],
      [MODEL.footRight + MODEL.nearRailRight, MODEL.footUp],
    ],
    MODEL.rod,
    LOG.cut,
    'butt',
  );
}

function paintTrebuchetModel(p: Pen): void {
  shadow(p, TILE_MIDDLE, MODEL.standBottom, MODEL.shadowRx, SLIM_SHADOW_RY);
  paintModelStand(p);
  paintModelFarSide(p);
  paintModelCounterweight(p);
  paintModelNearSide(p);
  // Wheels on the base frame: the one cue that says "siege engine" rather than "hoist".
  const wheelUp = MODEL.footUp - MODEL.wheelSink;
  for (const wheelX of [
    MODEL.footLeft - MODEL.wheelLeftShift,
    MODEL.footRight + MODEL.wheelRightShift,
  ]) {
    fillEllipse(p, wheelX, wheelUp, MODEL.wheelRadius, MODEL.wheelRadius, WOOD.dark);
    fillEllipse(
      p,
      wheelX,
      wheelUp,
      MODEL.wheelRadius * MODEL.hubShare,
      MODEL.wheelRadius * MODEL.hubShare,
      BRASS.body,
      null,
    );
  }
  fillEllipse(p, MODEL.apexX, MODEL.apexUp, MODEL.pivotRadius, MODEL.pivotRadius, BRASS.light);
  strokePath(
    p,
    [
      [MODEL.armTipX, MODEL.armTipUp],
      [MODEL.armTipX + MODEL.slingDrift, MODEL.armTipUp - MODEL.slingDrop],
    ],
    MODEL.slingWidth,
    PARCHMENT.dark,
  );
  fillEllipse(
    p,
    MODEL.armTipX + MODEL.pouchDrift,
    MODEL.armTipUp - MODEL.pouchDrop,
    MODEL.pouchRx,
    MODEL.pouchRy,
    LOG.bark,
    p.detail,
  );
}

// ── Workbench and gear crate ──────────────────────────────────────────────────

const BENCH = {
  x0: 0.06,
  x1: 1.94,
  topFront: 0.62,
  topBack: 1.24,
  apron: 0.13,
  legWidth: 0.11,
  legXs: [0.18, 1.82],
  floor: 0.1,
  shelfX0: 0.24,
  shelfX1: 1.76,
  shelfUp: 0.24,
  shelfThickness: 0.08,
  stockBoards: 2,
  stockX0: 0.4,
  stockX1: 1.5,
  stockStepIn: 0.1,
  stockStepBack: 0.06,
  stockThickness: 0.06,
  sawdust: { x: 1.1, up: 0.16, rx: 0.5, ry: 0.08, alpha: 0.6, fade: 0.5 },
} as const;

const SHAVING = {
  arcStart: 0.3,
  arcEnd: 1.7,
  width: 0.022,
  onTop: { curls: 5, x: 1.3, spacing: 0.1, xJitter: 0.02, up: 1.08, upJitter: 0.05, radius: 0.035 },
  onFloor: {
    curls: 3,
    x: 0.7,
    spacing: 0.3,
    xJitter: 0.03,
    up: 0.12,
    upJitter: 0.02,
    radius: 0.03,
  },
} as const;

const VISE = {
  x0: 0.1,
  x1: 0.36,
  jawDrop: 0.2,
  jawRise: 0.06,
  screwX0: 0.14,
  screwX1: 0.32,
  screwDrop: 0.1,
  screwWidth: 0.03,
} as const;

/** The tools left out on the bench top: a saw, a mallet, a chisel. */
const BENCH_TOOLS = {
  sawBlade: [
    [0.52, 0.98],
    [1.08, 0.98],
    [1.08, 0.88],
    [0.56, 0.93],
  ],
  sawHandle: { x0: 1.06, x1: 1.22, up0: 0.84, up1: 1.02, radius: 0.04 },
  malletHandle: [
    [1.3, 0.78],
    [1.56, 0.84],
  ],
  malletHandleWidth: 0.04,
  malletHead: { x0: 1.52, x1: 1.72, up0: 0.76, up1: 0.96, radius: 0.04 },
  chiselBlade: [
    [0.62, 1.12],
    [0.86, 1.14],
  ],
  chiselBladeWidth: 0.03,
  chiselHandle: { x0: 0.86, x1: 0.96, up0: 1.1, up1: 1.18 },
} as const;

function shaving(p: Pen, cx: number, cUp: number, radius: number): void {
  p.ctx.beginPath();
  p.ctx.arc(p.x(cx), p.y(cUp), p.s(radius), SHAVING.arcStart, Math.PI * SHAVING.arcEnd);
  p.ctx.strokeStyle = LOG.cut;
  p.ctx.lineWidth = p.s(SHAVING.width);
  p.ctx.lineCap = 'round';
  p.ctx.stroke();
}

function paintBenchUnderside(p: Pen): void {
  const { sawdust } = BENCH;
  withAlpha(p, sawdust.fade, () =>
    stain(p, sawdust.x, sawdust.up, sawdust.rx, sawdust.ry, LOG.cut, sawdust.alpha),
  );
  for (const lx of BENCH.legXs)
    leg(p, lx, BENCH.legWidth, BENCH.floor, BENCH.topFront - BENCH.apron);
  const shelfTop = BENCH.shelfUp + BENCH.shelfThickness;
  planks(
    p,
    BENCH.shelfX0,
    BENCH.shelfX1,
    BENCH.shelfUp,
    shelfTop,
    'horizontal',
    BENCH.shelfThickness,
    WOOD.body,
    NO_NAILS,
  );
  traceRect(p, BENCH.shelfX0, BENCH.shelfX1, BENCH.shelfUp, shelfTop);
  inkOutline(p.ctx, p.detail);
  for (let board = 0; board < BENCH.stockBoards; board++) {
    const up0 = shelfTop + board * BENCH.stockThickness;
    fillRect(
      p,
      BENCH.stockX0 + board * BENCH.stockStepIn,
      BENCH.stockX1 - board * BENCH.stockStepBack,
      up0,
      up0 + BENCH.stockThickness,
      board === 0 ? LOG.cutDark : LOG.cut,
      p.detail,
    );
  }
}

function paintVise(p: Pen): void {
  fillRect(
    p,
    VISE.x0,
    VISE.x1,
    BENCH.topFront - VISE.jawDrop,
    BENCH.topFront + VISE.jawRise,
    WOOD.mid,
  );
  inkedRod(
    p,
    [
      [VISE.screwX0, BENCH.topFront - VISE.screwDrop],
      [VISE.screwX1, BENCH.topFront - VISE.screwDrop],
    ],
    VISE.screwWidth,
    IRON.light,
    'butt',
  );
}

function paintBenchTools(p: Pen): void {
  const tools = BENCH_TOOLS;
  fillPolygon(p, tools.sawBlade, IRON.light);
  const { sawHandle, malletHead, chiselHandle } = tools;
  fillRounded(
    p,
    sawHandle.x0,
    sawHandle.x1,
    sawHandle.up0,
    sawHandle.up1,
    sawHandle.radius,
    WOOD.body,
  );
  inkedRod(p, tools.malletHandle, tools.malletHandleWidth, WOOD.light);
  fillRounded(
    p,
    malletHead.x0,
    malletHead.x1,
    malletHead.up0,
    malletHead.up1,
    malletHead.radius,
    LOG.bark,
  );
  inkedRod(p, tools.chiselBlade, tools.chiselBladeWidth, IRON.body, 'butt');
  fillRect(
    p,
    chiselHandle.x0,
    chiselHandle.x1,
    chiselHandle.up0,
    chiselHandle.up1,
    WOOD.body,
    p.detail,
  );
}

function paintShavings(p: Pen): void {
  const shavingRng = forkRng(p.rng);
  for (const scatter of [SHAVING.onTop, SHAVING.onFloor]) {
    for (let curl = 0; curl < scatter.curls; curl++) {
      shaving(
        p,
        scatter.x + curl * scatter.spacing + jitter(shavingRng, scatter.xJitter),
        scatter.up + jitter(shavingRng, scatter.upJitter),
        scatter.radius,
      );
    }
  }
}

function paintWorkbench(p: Pen): void {
  shadow(p, PAIR_MIDDLE, BENCH.floor, PAIR_SHADOW_RX, FLOOR_SHADOW_RY);
  paintBenchUnderside(p);
  slab(p, {
    x0: BENCH.x0,
    x1: BENCH.x1,
    topFront: BENCH.topFront,
    topBack: BENCH.topBack,
    apron: BENCH.apron,
    top: WOOD.light,
  });
  paintVise(p);
  paintBenchTools(p);
  paintShavings(p);
}

const GEAR = {
  toothDepthShare: 0.2,
  hubShare: 0.26,
  axleShare: 0.4,
  /** Each tooth is four path steps: two out at the tip, two in at the root. */
  stepsPerTooth: 4,
  tipSteps: 2,
  shineShiftShare: 0.2,
  shineRxShare: 0.55,
  shineRyShare: 0.45,
  recessShare: 0.62,
} as const;

/** A wooden cog seen face-on: a toothed disc with a hub and four spokes cut out. */
function gear(
  p: Pen,
  cx: number,
  cUp: number,
  radius: number,
  teeth: number,
  colour: string,
): void {
  const { ctx } = p;
  const inner = radius * (1 - GEAR.toothDepthShare);
  ctx.beginPath();
  const steps = teeth * GEAR.stepsPerTooth;
  for (let step = 0; step <= steps; step++) {
    const angle = (step / steps) * TAU;
    const reach = step % GEAR.stepsPerTooth < GEAR.tipSteps ? radius : inner;
    const px = p.x(cx) + Math.cos(angle) * p.s(reach);
    const py = p.y(cUp) + Math.sin(angle) * p.s(reach);
    if (step === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = colour;
  ctx.fill();
  inkOutline(ctx, p.outline);
  fillEllipse(
    p,
    cx - radius * GEAR.shineShiftShare,
    cUp + radius * GEAR.shineShiftShare,
    inner * GEAR.shineRxShare,
    inner * GEAR.shineRyShare,
    LOG.cut,
    null,
  );
  fillEllipse(
    p,
    cx,
    cUp,
    inner * GEAR.recessShare,
    inner * GEAR.recessShare,
    LOG.cutDark,
    p.detail,
  );
  fillEllipse(p, cx, cUp, radius * GEAR.hubShare, radius * GEAR.hubShare, colour, p.detail);
  fillEllipse(
    p,
    cx,
    cUp,
    radius * GEAR.hubShare * GEAR.axleShare,
    radius * GEAR.hubShare * GEAR.axleShare,
    INK,
    null,
  );
}

const CRATE = {
  x0: 0.12,
  x1: 0.88,
  bottom: 0.08,
  rimFront: 0.48,
  rimBack: 0.9,
  frontBoard: 0.13,
  frontNailChance: 0.6,
  battenInset: 0.04,
  battenHalfW: 0.04,
  gears: [
    { x: 0.38, up: 0.74, radius: 0.27, teeth: 9, colour: LOG.cut },
    { x: 0.68, up: 0.62, radius: 0.19, teeth: 7, colour: LOG.ring },
  ],
  shadowRx: 0.4,
} as const;

function paintGearCrate(p: Pen): void {
  shadow(p, TILE_MIDDLE, CRATE.bottom, CRATE.shadowRx, SLIM_SHADOW_RY);
  fillRect(p, CRATE.x0, CRATE.x1, CRATE.rimFront, CRATE.rimBack, WOOD.deep);
  for (const cog of CRATE.gears) gear(p, cog.x, cog.up, cog.radius, cog.teeth, cog.colour);
  planks(
    p,
    CRATE.x0,
    CRATE.x1,
    CRATE.bottom,
    CRATE.rimFront,
    'horizontal',
    CRATE.frontBoard,
    WOOD.mid,
    CRATE.frontNailChance,
  );
  for (const bx of [CRATE.x0 + CRATE.battenInset, CRATE.x1 - CRATE.battenInset]) {
    fillRect(
      p,
      bx - CRATE.battenHalfW,
      bx + CRATE.battenHalfW,
      CRATE.bottom,
      CRATE.rimFront,
      WOOD.dark,
      p.detail,
    );
  }
  litLip(p, CRATE.x0, CRATE.x1, CRATE.rimFront, WOOD.highlight);
  traceRect(p, CRATE.x0, CRATE.x1, CRATE.bottom, CRATE.rimFront);
  inkOutline(p.ctx, p.outline);
  traceRect(p, CRATE.x0, CRATE.x1, CRATE.rimFront, CRATE.rimBack);
  inkOutline(p.ctx, p.outline);
}

// ── Weapon, hoe and pick racks; tool pegs ─────────────────────────────────────

const WEAPON_RACK = {
  postTop: 2.0,
  barUp: 1.4,
  shaftXs: [0.26, 0.42, 0.58, 0.74],
  shaftTop: 2.42,
  headLength: 0.36,
  headHalfW: 0.055,
  /** Where the leaf blade is widest, as a share of its length. */
  headWidestShare: 0.38,
  socketHalfShare: 0.45,
  socketDrop: 0.04,
  socketRise: 0.03,
  ridgeTopShare: 0.9,
  ridgeFoot: 0.04,
} as const;

function spearHead(p: Pen, cx: number, base: number): void {
  const { headLength: length, headHalfW: half } = WEAPON_RACK;
  const socketHalf = half * WEAPON_RACK.socketHalfShare;
  fillRect(
    p,
    cx - socketHalf,
    cx + socketHalf,
    base - WEAPON_RACK.socketDrop,
    base + WEAPON_RACK.socketRise,
    BRASS.body,
    p.detail,
  );
  const widestUp = base + length * WEAPON_RACK.headWidestShare;
  fillPolygon(
    p,
    [
      [cx, base + length],
      [cx + half, widestUp],
      [cx, base],
      [cx - half, widestUp],
    ],
    IRON.light,
  );
  strokePath(
    p,
    [
      [cx, base + length * WEAPON_RACK.ridgeTopShare],
      [cx, base + WEAPON_RACK.ridgeFoot],
    ],
    detailTiles(p),
    IRON.dark,
  );
}

function paintWeaponRack(p: Pen): void {
  rackFrame(p, WEAPON_RACK.postTop, null);
  WEAPON_RACK.shaftXs.forEach((sx, index) => {
    handle(p, sx, WEAPON_RACK.shaftTop, index % 2 === 0 ? WOOD.mid : WOOD.light);
    spearHead(p, sx, WEAPON_RACK.shaftTop);
  });
  rackBar(p, WEAPON_RACK.barUp, WEAPON_RACK.shaftXs);
  rackTrayFront(p);
}

const HOE_RACK = {
  postTop: 1.9,
  barUp: 1.3,
  handleXs: [0.27, 0.5, 0.73],
  /** The rake sits lower so its head passes under the two hoe blades beside it. */
  handleTops: [2.34, 2.06, 2.34],
  neck: 0.06,
  neckReach: 0.07,
  neckBendShare: 0.4,
  neckOverlap: 0.02,
  neckWidth: 0.03,
  bladeWidth: 0.09,
  bladeTopShare: 0.7,
  bladeRootLift: 0.01,
  bladeRootInset: 0.01,
  bladeLength: 0.2,
  bladeLean: 0.03,
  edgeLift: 0.01,
  edgeWidth: 0.02,
  rakeHalfW: 0.17,
  rakeTines: 5,
  rakeBarShare: 0.5,
  tineSpreadShare: 0.85,
  tineLength: 0.08,
  tineWidth: 0.022,
  rakeBarWidth: 0.04,
} as const;

/** Which handle on the hoe rack carries the rake; the two beside it carry hoes. */
const RAKE_SLOT = 1;
const LEFT_HOE_SLOT = 0;
const RIGHT_HOE_SLOT = 2;

/**
 * A hoe hung head up, seen side on: a gooseneck bends off the handle's top and
 * the blade hangs back down beside it — the hook shape that says "hoe" rather
 * than "hammer" at a glance.
 */
function hoeHead(p: Pen, cx: number, top: number, facing: 1 | -1): void {
  const neckX = cx + facing * HOE_RACK.neckReach;
  const neckUp = top + HOE_RACK.neck;
  inkedRod(
    p,
    [
      [cx, top - HOE_RACK.neckOverlap],
      [cx + facing * HOE_RACK.neckReach * HOE_RACK.neckBendShare, neckUp + HOE_RACK.neckOverlap],
      [neckX, neckUp],
    ],
    HOE_RACK.neckWidth,
    IRON.body,
  );
  const bladeTop = neckUp + HOE_RACK.bladeRootLift;
  const bladeBottom = bladeTop - HOE_RACK.bladeLength;
  const lean = facing * HOE_RACK.bladeLean;
  const rootX = neckX - facing * HOE_RACK.bladeRootInset;
  fillPolygon(
    p,
    [
      [rootX, bladeTop],
      [neckX + facing * HOE_RACK.bladeWidth * HOE_RACK.bladeTopShare, bladeTop],
      [neckX + facing * HOE_RACK.bladeWidth + lean, bladeBottom],
      [rootX + lean, bladeBottom],
    ],
    IRON.body,
  );
  strokePath(
    p,
    [
      [neckX + facing * HOE_RACK.bladeWidth + lean, bladeBottom + HOE_RACK.edgeLift],
      [neckX + lean, bladeBottom + HOE_RACK.edgeLift],
    ],
    HOE_RACK.edgeWidth,
    IRON.glint,
    'butt',
  );
}

/** A rake hung head up, its tines pointing at the ceiling. */
function rakeHead(p: Pen, cx: number, top: number): void {
  const half = HOE_RACK.rakeHalfW;
  const barUp = top + HOE_RACK.neck * HOE_RACK.rakeBarShare;
  for (let tine = 0; tine < HOE_RACK.rakeTines; tine++) {
    const tx =
      cx -
      half * HOE_RACK.tineSpreadShare +
      (tine / (HOE_RACK.rakeTines - 1)) * half * HOE_RACK.tineSpreadShare * 2;
    inkedRod(
      p,
      [
        [tx, barUp],
        [tx, barUp + HOE_RACK.tineLength],
      ],
      HOE_RACK.tineWidth,
      IRON.light,
    );
  }
  inkedRod(
    p,
    [
      [cx - half, barUp],
      [cx + half, barUp],
    ],
    HOE_RACK.rakeBarWidth,
    IRON.body,
  );
}

function paintHoeRack(p: Pen): void {
  rackFrame(p, HOE_RACK.postTop, null);
  HOE_RACK.handleXs.forEach((hx, index) => {
    const top = HOE_RACK.handleTops[index] ?? HOE_RACK.handleTops[0];
    handle(p, hx, top, index === RAKE_SLOT ? WOOD.mid : WOOD.light);
  });
  rakeHead(p, HOE_RACK.handleXs[RAKE_SLOT], HOE_RACK.handleTops[RAKE_SLOT]);
  hoeHead(p, HOE_RACK.handleXs[LEFT_HOE_SLOT], HOE_RACK.handleTops[LEFT_HOE_SLOT], -1);
  hoeHead(p, HOE_RACK.handleXs[RIGHT_HOE_SLOT], HOE_RACK.handleTops[RIGHT_HOE_SLOT], 1);
  rackBar(p, HOE_RACK.barUp, HOE_RACK.handleXs);
  rackTrayFront(p);
}

const PICK_RACK = {
  postTop: 1.9,
  barUp: 1.3,
  handleXs: [0.32, 0.68],
  handleTop: 2.34,
  /** Each pick hangs a little lower than the one before, so the heads overlap instead of colliding. */
  headStagger: 0.14,
  headHalfSpan: 0.19,
  headDroop: 0.12,
  headThickness: 0.07,
  crownShare: 1.2,
  undersideShare: 0.2,
  eyeHalfW: 0.045,
  eyeHalfH: 0.06,
  glintStartShare: 0.7,
  glintStartDroopShare: 0.1,
  glintEndShare: 0.2,
  glintEndRiseShare: 0.35,
} as const;

function pickHead(p: Pen, cx: number, top: number): void {
  const { headHalfSpan: span, headDroop: droop, headThickness: thick } = PICK_RACK;
  const { ctx } = p;
  ctx.beginPath();
  ctx.moveTo(p.x(cx - span), p.y(top - droop));
  ctx.quadraticCurveTo(
    p.x(cx),
    p.y(top + thick * PICK_RACK.crownShare),
    p.x(cx + span),
    p.y(top - droop),
  );
  ctx.quadraticCurveTo(
    p.x(cx),
    p.y(top - thick * PICK_RACK.undersideShare),
    p.x(cx - span),
    p.y(top - droop),
  );
  ctx.closePath();
  ctx.fillStyle = IRON.body;
  ctx.fill();
  inkOutline(ctx, p.outline);
  fillRect(
    p,
    cx - PICK_RACK.eyeHalfW,
    cx + PICK_RACK.eyeHalfW,
    top - PICK_RACK.eyeHalfH,
    top + PICK_RACK.eyeHalfH,
    IRON.dark,
    p.detail,
  );
  strokePath(
    p,
    [
      [cx - span * PICK_RACK.glintStartShare, top - droop * PICK_RACK.glintStartDroopShare],
      [cx - span * PICK_RACK.glintEndShare, top + thick * PICK_RACK.glintEndRiseShare],
    ],
    detailTiles(p),
    IRON.glint,
  );
}

function paintPickRack(p: Pen): void {
  rackFrame(p, PICK_RACK.postTop, null);
  PICK_RACK.handleXs.forEach((hx, index) => {
    handle(p, hx, PICK_RACK.handleTop, index === 0 ? WOOD.light : WOOD.mid);
  });
  PICK_RACK.handleXs.forEach((hx, index) =>
    pickHead(p, hx, PICK_RACK.handleTop - index * PICK_RACK.headStagger),
  );
  rackBar(p, PICK_RACK.barUp, PICK_RACK.handleXs);
  rackTrayFront(p);
}

const PEGS = {
  postTop: 2.5,
  boardBottom: 0.9,
  boardTop: 2.36,
  pegRadius: 0.025,
  pegWidthShare: 1.3,
} as const;

const HUNG_SAW = {
  peg: [0.3, 2.18],
  blade: [
    [0.22, 2.08],
    [0.38, 2.08],
    [0.36, 1.24],
    [0.28, 1.3],
  ],
  grip: { x0: 0.2, x1: 0.4, up0: 2.04, up1: 2.22, radius: 0.05 },
  gripHole: { x0: 0.26, x1: 0.34, up0: 2.1, up1: 2.16, radius: 0.02 },
} as const;

const HUNG_HAMMER = {
  peg: [0.56, 2.14],
  x: 0.56,
  handleBottom: 1.5,
  handleTop: 2.08,
  handleWidth: 0.04,
  head: { x0: 0.48, x1: 0.66, up0: 2.04, up1: 2.14 },
} as const;

const HUNG_ROPE = {
  peg: [0.72, 1.82],
  x: 0.72,
  up: 1.6,
  rx: 0.11,
  ry: 0.17,
  inkWidth: 0.07,
  width: 0.045,
} as const;

const HUNG_TONGS = {
  peg: [0.36, 1.12],
  hinge: [0.36, 1.1],
  jawLeft: [0.26, 0.96],
  jawRight: [0.46, 0.96],
  width: 0.025,
} as const;

function peg(p: Pen, [cx, cUp]: Point): void {
  fillEllipse(
    p,
    cx,
    cUp,
    PEGS.pegRadius * PEGS.pegWidthShare,
    PEGS.pegRadius,
    BRASS.body,
    p.detail,
  );
}

function paintHungSaw(p: Pen): void {
  const { grip, gripHole } = HUNG_SAW;
  peg(p, HUNG_SAW.peg);
  fillPolygon(p, HUNG_SAW.blade, IRON.light);
  fillRounded(p, grip.x0, grip.x1, grip.up0, grip.up1, grip.radius, WOOD.body);
  fillRounded(
    p,
    gripHole.x0,
    gripHole.x1,
    gripHole.up0,
    gripHole.up1,
    gripHole.radius,
    WOOD.deep,
    null,
  );
}

function paintHungHammer(p: Pen): void {
  const { head } = HUNG_HAMMER;
  peg(p, HUNG_HAMMER.peg);
  inkedRod(
    p,
    [
      [HUNG_HAMMER.x, HUNG_HAMMER.handleBottom],
      [HUNG_HAMMER.x, HUNG_HAMMER.handleTop],
    ],
    HUNG_HAMMER.handleWidth,
    WOOD.light,
  );
  fillRect(p, head.x0, head.x1, head.up0, head.up1, IRON.body);
}

function paintHungRope(p: Pen): void {
  const rope = HUNG_ROPE;
  peg(p, rope.peg);
  strokeEllipse(p, rope.x, rope.up, rope.rx, rope.ry, INK, p.s(rope.inkWidth));
  p.ctx.strokeStyle = PARCHMENT.dark;
  p.ctx.lineWidth = p.s(rope.width);
  p.ctx.stroke();
}

function paintHungTongs(p: Pen): void {
  peg(p, HUNG_TONGS.peg);
  inkedRod(p, [HUNG_TONGS.hinge, HUNG_TONGS.jawLeft], HUNG_TONGS.width, IRON.body);
  inkedRod(p, [HUNG_TONGS.hinge, HUNG_TONGS.jawRight], HUNG_TONGS.width, IRON.body);
}

function paintToolPegs(p: Pen): void {
  rackFrame(p, PEGS.postTop, { up0: PEGS.boardBottom, up1: PEGS.boardTop });
  paintHungSaw(p);
  paintHungHammer(p);
  paintHungRope(p);
  paintHungTongs(p);
  rackTrayFront(p);
}

// ── Lamp shelf ────────────────────────────────────────────────────────────────

const LAMP = {
  width: 0.2,
  height: 0.34,
  capShare: 0.2,
  ringShare: 0.55,
  ringWidth: 0.02,
  glassShare: 0.85,
  baseCapShare: 0.7,
  flameShare: 0.4,
  flameTopShare: 0.4,
  glintX0Share: 0.6,
  glintX1Share: 0.25,
  glintTopShare: 0.3,
  hoodTopShare: 0.4,
  capGlintX0Share: 0.8,
  capGlintX1Share: 0.4,
  capGlintLift: 0.01,
  capGlintShare: 0.6,
  unlitGlass: '#6a5530',
  unlitGlint: '#a88a4c',
} as const;

/** A standing brass lantern for sale: cap, glass, base and a carrying ring. */
function standingLantern(p: Pen, cx: number, upBase: number, lit: boolean): void {
  const half = LAMP.width / 2;
  const cap = LAMP.height * LAMP.capShare;
  const glassTop = upBase + LAMP.height - cap;
  p.ctx.beginPath();
  p.ctx.arc(p.x(cx), p.y(upBase + LAMP.height), p.s(half * LAMP.ringShare), Math.PI, TAU);
  p.ctx.strokeStyle = BRASS.dark;
  p.ctx.lineWidth = p.s(LAMP.ringWidth);
  p.ctx.stroke();
  fillRect(
    p,
    cx - half * LAMP.glassShare,
    cx + half * LAMP.glassShare,
    upBase + cap * LAMP.baseCapShare,
    glassTop,
    lit ? FLAME.mid : LAMP.unlitGlass,
  );
  if (lit)
    fillRect(
      p,
      cx - half * LAMP.flameShare,
      cx + half * LAMP.flameShare,
      upBase + cap,
      glassTop - cap * LAMP.flameTopShare,
      FLAME.core,
      null,
    );
  else
    fillRect(
      p,
      cx - half * LAMP.glintX0Share,
      cx - half * LAMP.glintX1Share,
      upBase + cap,
      glassTop - cap * LAMP.glintTopShare,
      LAMP.unlitGlint,
      null,
    );
  fillPolygon(
    p,
    [
      [cx - half, glassTop],
      [cx + half, glassTop],
      [cx + half * LAMP.hoodTopShare, upBase + LAMP.height],
      [cx - half * LAMP.hoodTopShare, upBase + LAMP.height],
    ],
    BRASS.body,
  );
  fillRect(p, cx - half, cx + half, upBase, upBase + cap * LAMP.baseCapShare, BRASS.dark);
  fillRect(
    p,
    cx - half * LAMP.capGlintX0Share,
    cx - half * LAMP.capGlintX1Share,
    glassTop + LAMP.capGlintLift,
    glassTop + cap * LAMP.capGlintShare,
    BRASS.glint,
    null,
  );
}

const OIL_LAMP = {
  handleX: 0.08,
  handleUp: 0.06,
  handleRadius: 0.035,
  handleWidth: 0.02,
  body: [
    [-0.08, 0.02],
    [0.04, 0.02],
    [0.12, 0.09],
    [0.02, 0.1],
    [-0.08, 0.1],
  ],
  fillerX: 0.03,
  fillerUp: 0.1,
  fillerRx: 0.05,
  fillerRy: 0.02,
  footX0: 0.05,
  footX1: 0.03,
  footHeight: 0.025,
} as const;

/** A small brass oil lamp: a squat body with a spout and a loop handle. */
function oilLamp(p: Pen, cx: number, surface: number): void {
  const lamp = OIL_LAMP;
  p.ctx.beginPath();
  p.ctx.arc(
    p.x(cx - lamp.handleX),
    p.y(surface + lamp.handleUp),
    p.s(lamp.handleRadius),
    Math.PI / 2,
    Math.PI * (3 / 2),
  );
  p.ctx.strokeStyle = BRASS.dark;
  p.ctx.lineWidth = p.s(lamp.handleWidth);
  p.ctx.stroke();
  fillPolygon(
    p,
    lamp.body.map(([dx, lift]): Point => [cx + dx, surface + lift]),
    BRASS.body,
  );
  fillEllipse(
    p,
    cx - lamp.fillerX,
    surface + lamp.fillerUp,
    lamp.fillerRx,
    lamp.fillerRy,
    BRASS.light,
    p.detail,
  );
  fillRect(
    p,
    cx - lamp.footX0,
    cx + lamp.footX1,
    surface,
    surface + lamp.footHeight,
    BRASS.dark,
    p.detail,
  );
}

/** Midge's stock, top to bottom: a lit lantern beside an unlit one, lanterns, oil lamps, oil. */
const LAMP_SHELF = {
  topLanterns: [
    { x: 0.3, lit: true },
    { x: 0.66, lit: false },
  ],
  highLanterns: [0.3, 0.68],
  oilLamps: [
    { x: 0.28, lift: 0 },
    { x: 0.56, lift: 0 },
    /** A hair's lift keeps the third lamp's outline from merging with the shelf's lit lip. */
    { x: 0.78, lift: 0.001 },
  ],
  oilCan: { cx: 0.3, width: 0.18, height: 0.3 },
  wickBox: {
    x0: 0.54,
    x1: 0.82,
    height: 0.14,
    radius: 0.03,
    clothX0: 0.58,
    clothX1: 0.78,
    clothDepth: 0.04,
  },
} as const;

function paintLampShelf(p: Pen): void {
  const stock = LAMP_SHELF;
  shelfUnit(p, (index, surface) => {
    if (index === SHELF_TOP) {
      for (const lantern of stock.topLanterns) standingLantern(p, lantern.x, surface, lantern.lit);
    } else if (index === SHELF_HIGH) {
      for (const x of stock.highLanterns) standingLantern(p, x, surface, false);
    } else if (index === SHELF_LOW) {
      for (const lamp of stock.oilLamps) oilLamp(p, lamp.x, surface + lamp.lift);
    } else {
      const { oilCan: can, wickBox: box } = stock;
      oilCan(p, can.cx, surface, can.width, can.height, BRASS);
      const boxTop = surface + box.height;
      fillRounded(p, box.x0, box.x1, surface, boxTop, box.radius, WOOD.mid);
      fillRect(
        p,
        box.clothX0,
        box.clothX1,
        boxTop - box.clothDepth,
        boxTop,
        CLOTH.linen.body,
        null,
      );
    }
  });
}

// ── Oil cans, seed sacks, washbasin, stool, fabric bolts ──────────────────────

const OIL_CAN = {
  shoulderShare: 0.78,
  spoutRootShare: 0.5,
  spoutTipShare: 1.05,
  spoutTipUpShare: 1.02,
  spoutWidth: 0.025,
  handleShiftShare: 0.2,
  handleRadiusShare: 0.6,
  handleStart: 1.05,
  handleEnd: 1.95,
  handleInkWidth: 0.04,
  handleWidth: 0.022,
  shoulderSlope: 0.03,
  shoulderInShare: 0.5,
  shineX0Share: 0.7,
  shineX1Share: 0.35,
  shineBottomShare: 0.12,
  shineTopDrop: 0.04,
  bandLowShare: 0.3,
  bandHighShare: 0.36,
  capRxShare: 0.28,
  capRyShare: 0.12,
} as const;

function oilCan(
  p: Pen,
  cx: number,
  upBase: number,
  width: number,
  height: number,
  metal: Tone,
): void {
  const can = OIL_CAN;
  const half = width / 2;
  const shoulder = upBase + height * can.shoulderShare;
  inkedRod(
    p,
    [
      [cx + half * can.spoutRootShare, shoulder],
      [cx + half * can.spoutTipShare, upBase + height * can.spoutTipUpShare],
    ],
    can.spoutWidth,
    metal.body,
  );
  p.ctx.beginPath();
  p.ctx.arc(
    p.x(cx - half * can.handleShiftShare),
    p.y(shoulder),
    p.s(half * can.handleRadiusShare),
    Math.PI * can.handleStart,
    Math.PI * can.handleEnd,
  );
  p.ctx.strokeStyle = INK;
  p.ctx.lineWidth = p.s(can.handleInkWidth);
  p.ctx.stroke();
  p.ctx.strokeStyle = metal.dark;
  p.ctx.lineWidth = p.s(can.handleWidth);
  p.ctx.stroke();
  const capUp = shoulder + can.shoulderSlope;
  fillPolygon(
    p,
    [
      [cx - half, upBase],
      [cx + half, upBase],
      [cx + half, shoulder - can.shoulderSlope],
      [cx + half * can.shoulderInShare, capUp],
      [cx - half * can.shoulderInShare, capUp],
      [cx - half, shoulder - can.shoulderSlope],
    ],
    metal.body,
  );
  fillRect(
    p,
    cx - half * can.shineX0Share,
    cx - half * can.shineX1Share,
    upBase + height * can.shineBottomShare,
    shoulder - can.shineTopDrop,
    metal.light,
    null,
  );
  fillRect(
    p,
    cx - half,
    cx + half,
    upBase + height * can.bandLowShare,
    upBase + height * can.bandHighShare,
    metal.dark,
    null,
  );
  fillEllipse(p, cx, capUp, half * can.capRxShare, half * can.capRyShare, metal.dark, p.detail);
}

/** A copper can beside the brass ones: the village's metalwork stays warm. */
const COPPER = { dark: '#5a2e1a', body: '#9a5634', light: '#c88258' } as const;

const OIL_CANS = {
  shadowUp: 0.12,
  shadowRx: 0.4,
  spill: { x: 0.66, up: 0.1, rx: 0.18, ry: 0.05, alpha: 0.5 },
  tall: { cx: 0.4, upBase: 0.36, width: 0.34, height: 0.56 },
  copper: { cx: 0.68, upBase: 0.14, width: 0.26, height: 0.44 },
  small: { cx: 0.24, upBase: 0.1, width: 0.22, height: 0.32 },
} as const;

function paintOilCans(p: Pen): void {
  const { spill, tall, copper, small } = OIL_CANS;
  shadow(p, TILE_MIDDLE, OIL_CANS.shadowUp, OIL_CANS.shadowRx, FLOOR_SHADOW_RY);
  stain(p, spill.x, spill.up, spill.rx, spill.ry, OIL_STAIN, spill.alpha);
  oilCan(p, tall.cx, tall.upBase, tall.width, tall.height, BRASS);
  oilCan(p, copper.cx, copper.upBase, copper.width, copper.height, COPPER);
  oilCan(p, small.cx, small.upBase, small.width, small.height, BRASS);
}

const SEED_SACKS = {
  floor: 0.1,
  shadowRx: 0.42,
  tied: { cx: 0.36, upBase: 0.38, halfW: 0.22, height: 0.56 },
  pouch: { cx: 0.2, upBase: 0.06, halfW: 0.1, height: 0.24 },
} as const;

/** The open seed sack: its mouth rolled down over the seed, a scoop left in it. */
const OPEN_SACK = {
  cx: 0.62,
  base: 0.1,
  half: 0.22,
  rimUp: 0.46,
  hipLift: 0.1,
  hipLeftShare: 1.1,
  hipRightShare: 1.05,
  footShare: 0.7,
  shineXShare: 0.4,
  shineLift: 0.18,
  shineRxShare: 0.4,
  shineRy: 0.12,
  shineAlpha: 0.6,
  mouthRyShare: 0.36,
  seedLift: 0.01,
  seedRxShare: 0.8,
  seedRyShare: 0.28,
  seeds: 8,
  seedXJitterShare: 0.6,
  seedUpJitterShare: 0.18,
  seedRx: 0.018,
  seedRy: 0.012,
  rollDrop: 0.07,
  rollTop: 0.01,
  scoopHandle: { x0: 0.02, lift0: 0.02, x1: 0.14, lift1: 0.2, width: 0.035 },
  scoopBowl: { dx: -0.02, lift: 0.04, rx: 0.06 },
} as const;

function paintOpenSeedSack(p: Pen): void {
  const sackSpec = OPEN_SACK;
  const { cx, base, half, rimUp } = sackSpec;
  fillPolygon(
    p,
    [
      [cx - half, rimUp],
      [cx - half * sackSpec.hipLeftShare, base + sackSpec.hipLift],
      [cx - half * sackSpec.footShare, base],
      [cx + half * sackSpec.footShare, base],
      [cx + half * sackSpec.hipRightShare, base + sackSpec.hipLift],
      [cx + half, rimUp],
    ],
    BURLAP.body,
  );
  stain(
    p,
    cx - half * sackSpec.shineXShare,
    base + sackSpec.shineLift,
    half * sackSpec.shineRxShare,
    sackSpec.shineRy,
    BURLAP.light,
    sackSpec.shineAlpha,
  );
  fillEllipse(p, cx, rimUp, half, half * sackSpec.mouthRyShare, BURLAP.dark);
  const seedUp = rimUp + sackSpec.seedLift;
  fillEllipse(
    p,
    cx,
    seedUp,
    half * sackSpec.seedRxShare,
    half * sackSpec.seedRyShare,
    CLOTH.weld.body,
    null,
  );
  const seedRng = forkRng(p.rng);
  for (let seed = 0; seed < sackSpec.seeds; seed++) {
    fillEllipse(
      p,
      cx + jitter(seedRng, half * sackSpec.seedXJitterShare),
      seedUp + jitter(seedRng, half * sackSpec.seedUpJitterShare),
      sackSpec.seedRx,
      sackSpec.seedRy,
      seed % 2 === 0 ? CLOTH.weld.light : CLOTH.weld.dark,
      null,
    );
  }
  fillRect(
    p,
    cx - half,
    cx + half,
    rimUp - sackSpec.rollDrop,
    rimUp - sackSpec.rollTop,
    BURLAP.light,
    p.detail,
  );
  const { scoopHandle: scoop, scoopBowl } = sackSpec;
  inkedRod(
    p,
    [
      [cx + scoop.x0, rimUp + scoop.lift0],
      [cx + scoop.x1, rimUp + scoop.lift1],
    ],
    scoop.width,
    WOOD.light,
  );
  bowl(p, cx + scoopBowl.dx, rimUp + scoopBowl.lift, scoopBowl.rx, CLOTH.weld.body, WOOD.light);
}

function paintSeedSacks(p: Pen): void {
  const { tied, pouch } = SEED_SACKS;
  shadow(p, TILE_MIDDLE, SEED_SACKS.floor, SEED_SACKS.shadowRx, FLOOR_SHADOW_RY);
  sack(p, tied.cx, tied.upBase, tied.halfW, tied.height, BURLAP);
  paintOpenSeedSack(p);
  sack(p, pouch.cx, pouch.upBase, pouch.halfW, pouch.height, BURLAP);
}

const BASIN = {
  x0: 0.16,
  x1: 0.84,
  topFront: 0.54,
  topBack: 0.94,
  apron: 0.07,
  floor: 0.1,
  legXs: [0.22, 0.78],
  legWidth: 0.06,
  stretcherUp: 0.24,
  stretcherWidth: 0.035,
  bowlX: 0.42,
  bowlRim: 0.84,
  bowlRx: 0.22,
  glintShift: 0.06,
  glintLift: 0.015,
  glintRx: 0.06,
  glintRy: 0.018,
  shadowRx: 0.38,
} as const;

const EWER = {
  x: 0.72,
  base: 0.78,
  handleShift: 0.07,
  handleLift: 0.18,
  handleRadius: 0.06,
  handleWidth: 0.035,
  outline: [
    [-0.07, 0],
    [0.07, 0],
    [0.08, 0.16],
    [0.05, 0.3],
    [-0.09, 0.33],
    [-0.05, 0.26],
    [-0.08, 0.16],
  ],
  shine: { x0: -0.05, x1: -0.02, lift0: 0.04, lift1: 0.22 },
} as const;

const TOWEL = {
  x0: 0.26,
  x1: 0.46,
  drop: 0.28,
  rise: 0.02,
  stripeLow: 0.22,
  stripeHigh: 0.18,
} as const;

function paintEwer(p: Pen): void {
  p.ctx.beginPath();
  p.ctx.arc(
    p.x(EWER.x + EWER.handleShift),
    p.y(EWER.base + EWER.handleLift),
    p.s(EWER.handleRadius),
    -Math.PI / 2,
    Math.PI / 2,
  );
  p.ctx.strokeStyle = INK;
  p.ctx.lineWidth = p.s(EWER.handleWidth);
  p.ctx.stroke();
  fillPolygon(
    p,
    EWER.outline.map(([dx, lift]): Point => [EWER.x + dx, EWER.base + lift]),
    CLAY.glaze,
  );
  const { shine } = EWER;
  fillRect(
    p,
    EWER.x + shine.x0,
    EWER.x + shine.x1,
    EWER.base + shine.lift0,
    EWER.base + shine.lift1,
    CLAY.light,
    null,
  );
}

function paintTowel(p: Pen): void {
  const bottom = BASIN.topFront - TOWEL.drop;
  const top = BASIN.topFront + TOWEL.rise;
  fillRect(p, TOWEL.x0, TOWEL.x1, bottom, top, CLOTH.linen.light);
  fillRect(
    p,
    TOWEL.x0,
    TOWEL.x1,
    BASIN.topFront - TOWEL.stripeLow,
    BASIN.topFront - TOWEL.stripeHigh,
    CLOTH.woad.body,
    null,
  );
  traceRect(p, TOWEL.x0, TOWEL.x1, bottom, top);
  inkOutline(p.ctx, p.detail);
}

function paintWashbasin(p: Pen): void {
  shadow(p, TILE_MIDDLE, BASIN.floor, BASIN.shadowRx, SLIM_SHADOW_RY);
  for (const lx of BASIN.legXs)
    leg(p, lx, BASIN.legWidth, BASIN.floor, BASIN.topFront - BASIN.apron);
  const [leftLeg, rightLeg] = BASIN.legXs;
  inkedRod(
    p,
    [
      [leftLeg, BASIN.stretcherUp],
      [rightLeg, BASIN.stretcherUp],
    ],
    BASIN.stretcherWidth,
    WOOD.dark,
    'butt',
  );
  slab(p, {
    x0: BASIN.x0,
    x1: BASIN.x1,
    topFront: BASIN.topFront,
    topBack: BASIN.topBack,
    apron: BASIN.apron,
  });
  bowl(p, BASIN.bowlX, BASIN.bowlRim, BASIN.bowlRx, WASH_WATER.body, CLAY.glaze);
  fillEllipse(
    p,
    BASIN.bowlX - BASIN.glintShift,
    BASIN.bowlRim + BASIN.glintLift,
    BASIN.glintRx,
    BASIN.glintRy,
    WASH_WATER.light,
    null,
  );
  paintEwer(p);
  paintTowel(p);
}

const STOOL = {
  cx: 0.5,
  seatUp: 0.44,
  seatRx: 0.25,
  seatRy: 0.12,
  thickness: 0.06,
  floor: 0.1,
  shadowLift: 0.02,
  shadowRx: 0.32,
  backLegRootDrop: 0.04,
  backLegLean: 0.02,
  backLegFoot: 0.14,
  backLegWidth: 0.05,
  frontLegRootShare: 0.55,
  frontLegFootShare: 0.95,
  frontLegWidth: 0.055,
  wornShift: 0.03,
  wornLift: 0.02,
  wornRx: 0.13,
  wornRy: 0.06,
  /** A stool seat is sat on far more than a table top, so its polish is much stronger. */
  wornAlpha: 0.7,
} as const;

function paintStool(p: Pen): void {
  const { cx, seatUp, seatRx, seatRy, thickness, floor } = STOOL;
  shadow(p, cx, floor + STOOL.shadowLift, STOOL.shadowRx, FLOOR_SHADOW_RY);
  const underside = seatUp - thickness;
  inkedRod(
    p,
    [
      [cx, underside + STOOL.backLegRootDrop],
      [cx + STOOL.backLegLean, floor + STOOL.backLegFoot],
    ],
    STOOL.backLegWidth,
    WOOD.dark,
  );
  for (const side of [-1, 1]) {
    inkedRod(
      p,
      [
        [cx + side * seatRx * STOOL.frontLegRootShare, underside],
        [cx + side * seatRx * STOOL.frontLegFootShare, floor],
      ],
      STOOL.frontLegWidth,
      WOOD.body,
    );
  }
  const { ctx } = p;
  ctx.beginPath();
  ctx.ellipse(p.x(cx), p.y(underside), p.s(seatRx), p.s(seatRy), 0, 0, Math.PI);
  ctx.lineTo(p.x(cx - seatRx), p.y(seatUp));
  ctx.ellipse(p.x(cx), p.y(seatUp), p.s(seatRx), p.s(seatRy), 0, Math.PI, 0, true);
  ctx.closePath();
  ctx.fillStyle = WOOD.dark;
  ctx.fill();
  inkOutline(ctx, p.outline);
  fillEllipse(p, cx, seatUp, seatRx, seatRy, WOOD.mid);
  fillSoftEllipse(
    ctx,
    p.x(cx - STOOL.wornShift),
    p.y(seatUp + STOOL.wornLift),
    p.s(STOOL.wornRx),
    p.s(STOOL.wornRy),
    WOOD.worn,
    STOOL.wornAlpha,
  );
}

const BOLT = {
  rimSquash: 0.42,
  /** How far down the bolt its loose end hangs: an unrolled tail is what says "cloth" rather than "can". */
  tailEndShare: 0.3,
  shineX0Share: 0.7,
  shineX1Share: 0.3,
  shadeX0Share: 0.55,
  tailX0Share: 0.05,
  tailX1Share: 0.85,
  tailFlareShare: 0.15,
  tailPointShiftShare: 0.1,
  tailPointDropShare: 0.25,
  tailBackShare: 0.05,
  spiralShare: 0.55,
  coreShare: 0.18,
} as const;

/** A bolt of cloth standing on end: a wound cylinder with its spiral showing on top. */
function uprightBolt(
  p: Pen,
  cx: number,
  upBase: number,
  halfW: number,
  height: number,
  cloth: ClothColour,
): void {
  const tone = CLOTH[cloth];
  const ry = halfW * BOLT.rimSquash;
  const top = upBase + height;
  const { ctx } = p;
  ctx.beginPath();
  ctx.moveTo(p.x(cx - halfW), p.y(top));
  ctx.lineTo(p.x(cx - halfW), p.y(upBase));
  ctx.ellipse(p.x(cx), p.y(upBase), p.s(halfW), p.s(ry), 0, Math.PI, 0, true);
  ctx.lineTo(p.x(cx + halfW), p.y(top));
  ctx.closePath();
  ctx.fillStyle = tone.body;
  ctx.fill();
  inkOutline(ctx, p.outline);
  fillRect(
    p,
    cx - halfW * BOLT.shineX0Share,
    cx - halfW * BOLT.shineX1Share,
    upBase,
    top,
    tone.light,
    null,
  );
  fillRect(p, cx + halfW * BOLT.shadeX0Share, cx + halfW, upBase, top, tone.dark, null);
  const tailX0 = cx + halfW * BOLT.tailX0Share;
  const tailX1 = cx + halfW * BOLT.tailX1Share;
  const tailEnd = upBase + height * BOLT.tailEndShare;
  fillPolygon(
    p,
    [
      [tailX0, top],
      [tailX1, top],
      [tailX1 + halfW * BOLT.tailFlareShare, tailEnd],
      [
        (tailX0 + tailX1) / 2 + halfW * BOLT.tailPointShiftShare,
        tailEnd + halfW * BOLT.tailPointDropShare,
      ],
      [tailX0 - halfW * BOLT.tailBackShare, tailEnd - halfW * BOLT.tailBackShare],
    ],
    tone.light,
    p.detail,
  );
  fillEllipse(p, cx, top, halfW, ry, tone.light);
  strokeEllipse(p, cx, top, halfW * BOLT.spiralShare, ry * BOLT.spiralShare, tone.dark, p.detail);
  fillEllipse(p, cx, top, halfW * BOLT.coreShare, ry * BOLT.coreShare, WOOD.dark, null);
}

const FABRIC_BOLTS = {
  floor: 0.1,
  shadowRx: 0.42,
  upright: [
    { cx: 0.34, upBase: 0.5, halfW: 0.13, height: 0.62, cloth: 'woad' },
    { cx: 0.64, upBase: 0.46, halfW: 0.12, height: 0.5, cloth: 'weld' },
  ],
  lying: {
    x0: 0.12,
    endX: 0.8,
    up: 0.24,
    radius: 0.13,
    shineX0: 0.2,
    shineX1: 0.74,
    shineLowShare: 0.25,
    shineHighShare: 0.65,
    endRxShare: 0.55,
    spiralRxShare: 0.3,
    spiralRyShare: 0.55,
    coreRxShare: 0.1,
    coreRyShare: 0.18,
  },
} as const;

/** A bolt of madder lying across the front, its wound end facing the room. */
function paintLyingBolt(p: Pen): void {
  const bolt = FABRIC_BOLTS.lying;
  const { up, radius, endX } = bolt;
  fillRounded(p, bolt.x0, endX, up - radius, up + radius, radius, CLOTH.madder.body);
  fillRect(
    p,
    bolt.shineX0,
    bolt.shineX1,
    up + radius * bolt.shineLowShare,
    up + radius * bolt.shineHighShare,
    CLOTH.madder.light,
    null,
  );
  fillEllipse(p, endX, up, radius * bolt.endRxShare, radius, CLOTH.madder.light);
  strokeEllipse(
    p,
    endX,
    up,
    radius * bolt.spiralRxShare,
    radius * bolt.spiralRyShare,
    CLOTH.madder.dark,
    p.detail,
  );
  fillEllipse(p, endX, up, radius * bolt.coreRxShare, radius * bolt.coreRyShare, WOOD.dark, null);
}

function paintFabricBolts(p: Pen): void {
  shadow(p, TILE_MIDDLE, FABRIC_BOLTS.floor, FABRIC_BOLTS.shadowRx, FLOOR_SHADOW_RY);
  for (const bolt of FABRIC_BOLTS.upright) {
    uprightBolt(p, bolt.cx, bolt.upBase, bolt.halfW, bolt.height, bolt.cloth);
  }
  paintLyingBolt(p);
}

// ── Loom ──────────────────────────────────────────────────────────────────────

const LOOM = {
  postX0: 0.1,
  postX1: 1.9,
  postWidth: 0.1,
  postLitShare: 0.3,
  floor: 0.1,
  postTop: 2.3,
  topBeamUp: 2.14,
  heddleUp: 1.66,
  reedUp: 1.3,
  /** The heddle bar and reed hang inside the posts rather than resting on them. */
  barInset: 0.06,
  barRadius: 0.035,
  clothX0: 0.28,
  clothX1: 1.72,
  clothBottom: 0.78,
  stripeLitShare: 0.7,
  breastUp: 0.72,
  breastExtra: 0.02,
  beamRadius: 0.06,
  beamLitLowShare: 0.2,
  beamLitHighShare: 0.6,
  warpSpacing: 0.09,
  warpWidth: 0.016,
  warpAlpha: 0.75,
  treadleXs: [0.7, 0.92, 1.14],
  treadleFoot: 0.16,
  treadleTop: 0.4,
  treadleLean: 0.12,
  treadleWidth: 0.045,
  rollDrop: 0.06,
  rollRise: 0.1,
  rollRadius: 0.06,
  rollShineInset: 0.04,
  rollShineLow: 0.03,
  rollShineHigh: 0.06,
} as const;

/** Nella's shuttle parked on the fell of the cloth, a bobbin of weld yarn in it. */
const SHUTTLE = {
  outline: [
    [1.1, 0.06],
    [1.2, 0.1],
    [1.44, 0.1],
    [1.54, 0.06],
    [1.44, 0.02],
    [1.2, 0.02],
  ],
  bobbin: { x0: 1.24, x1: 1.4, lift0: 0.05, lift1: 0.07 },
} as const;

/** Stripes woven so far, front to back: every household's colour runs through Nella's cloth. */
const LOOM_STRIPES: ReadonlyArray<ClothColour> = ['madder', 'weld', 'woad', 'madder', 'linen'];

function beam(p: Pen, x0: number, x1: number, cUp: number, radius: number, colour: string): void {
  fillRounded(p, x0, x1, cUp - radius, cUp + radius, radius, colour);
  fillRect(
    p,
    x0 + radius,
    x1 - radius,
    cUp + radius * LOOM.beamLitLowShare,
    cUp + radius * LOOM.beamLitHighShare,
    WOOD.light,
    null,
  );
}

function paintLoomFrame(p: Pen): void {
  const postHalf = LOOM.postWidth / 2;
  for (const px of [LOOM.postX0 + postHalf, LOOM.postX1 - postHalf]) {
    fillRect(p, px - postHalf, px + postHalf, LOOM.floor, LOOM.postTop, WOOD.dark);
    fillRect(
      p,
      px - postHalf,
      px - postHalf * LOOM.postLitShare,
      LOOM.floor,
      LOOM.postTop,
      WOOD.body,
      null,
    );
    drawLogEnd(p.ctx, p.x(px), p.y(LOOM.postTop), p.s(postHalf), p.s(postHalf * RIM_SQUASH));
  }
  beam(p, LOOM.postX0, LOOM.postX1, LOOM.topBeamUp, LOOM.beamRadius, WOOD.body);
  withAlpha(p, LOOM.warpAlpha, () => {
    for (let wx = LOOM.clothX0 + LOOM.warpSpacing / 2; wx < LOOM.clothX1; wx += LOOM.warpSpacing) {
      strokePath(
        p,
        [
          [wx, LOOM.topBeamUp - LOOM.beamRadius],
          [wx, LOOM.reedUp],
        ],
        LOOM.warpWidth,
        CLOTH.linen.light,
        'butt',
      );
    }
  });
  beam(
    p,
    LOOM.postX0 + LOOM.barInset,
    LOOM.postX1 - LOOM.barInset,
    LOOM.heddleUp,
    LOOM.barRadius,
    WOOD.mid,
  );
}

function paintWovenCloth(p: Pen): void {
  const stripeHeight = (LOOM.reedUp - LOOM.clothBottom) / LOOM_STRIPES.length;
  LOOM_STRIPES.forEach((colour, index) => {
    const up0 = LOOM.clothBottom + index * stripeHeight;
    fillRect(p, LOOM.clothX0, LOOM.clothX1, up0, up0 + stripeHeight, CLOTH[colour].body, null);
    fillRect(
      p,
      LOOM.clothX0,
      LOOM.clothX1,
      up0 + stripeHeight * LOOM.stripeLitShare,
      up0 + stripeHeight,
      CLOTH[colour].light,
      null,
    );
  });
  traceRect(p, LOOM.clothX0, LOOM.clothX1, LOOM.clothBottom, LOOM.reedUp);
  inkOutline(p.ctx, p.detail);
  beam(
    p,
    LOOM.postX0 + LOOM.barInset,
    LOOM.postX1 - LOOM.barInset,
    LOOM.reedUp,
    LOOM.barRadius,
    WOOD.mid,
  );
  fillPolygon(
    p,
    SHUTTLE.outline.map(([x, lift]): Point => [x, LOOM.reedUp + lift]),
    WOOD.worn,
  );
  const { bobbin } = SHUTTLE;
  fillRect(
    p,
    bobbin.x0,
    bobbin.x1,
    LOOM.reedUp + bobbin.lift0,
    LOOM.reedUp + bobbin.lift1,
    CLOTH.weld.body,
    null,
  );
}

/** The treadles underfoot and the finished cloth wound onto the breast beam. */
function paintLoomFront(p: Pen): void {
  for (const tx of LOOM.treadleXs) {
    inkedRod(
      p,
      [
        [tx, LOOM.treadleFoot],
        [tx + LOOM.treadleLean, LOOM.treadleTop],
      ],
      LOOM.treadleWidth,
      WOOD.body,
    );
  }
  beam(p, LOOM.postX0, LOOM.postX1, LOOM.breastUp, LOOM.beamRadius + LOOM.breastExtra, WOOD.body);
  fillRounded(
    p,
    LOOM.clothX0,
    LOOM.clothX1,
    LOOM.breastUp - LOOM.rollDrop,
    LOOM.breastUp + LOOM.rollRise,
    LOOM.rollRadius,
    CLOTH.madder.dark,
  );
  fillRect(
    p,
    LOOM.clothX0 + LOOM.rollShineInset,
    LOOM.clothX1 - LOOM.rollShineInset,
    LOOM.breastUp + LOOM.rollShineLow,
    LOOM.breastUp + LOOM.rollShineHigh,
    CLOTH.madder.light,
    null,
  );
}

function paintLoom(p: Pen): void {
  shadow(p, PAIR_MIDDLE, LOOM.floor, PAIR_SHADOW_RX, FLOOR_SHADOW_RY);
  paintLoomFrame(p);
  paintWovenCloth(p);
  paintLoomFront(p);
}

// ── The table ─────────────────────────────────────────────────────────────────

export const INDOOR_PROP_ART: Record<IndoorPropId, VillagePropArt> = {
  forge_hearth: { variants: 1, paint: painter(paintForgeHearth) },
  anvil: { variants: 1, paint: painter(paintAnvil) },
  quench_trough: { variants: 1, paint: painter(paintQuenchTrough) },
  tool_rack: { variants: 1, paint: painter(paintToolRack) },
  coal_bin: { variants: 1, paint: painter(paintCoalBin) },
  cooking_hearth: { variants: 1, paint: painter(paintCookingHearth) },
  serving_counter: { variants: 1, paint: painter(paintServingCounter) },
  table: { variants: 2, paint: painter(paintTable) },
  long_table: { variants: 1, paint: painter(paintLongTable) },
  cot: { variants: 1, paint: painter(paintCot) },
  bed: { variants: BED_QUILTS.length, paint: painter(paintBed) },
  shelf_records: { variants: 1, paint: painter(paintShelfRecords) },
  shelf_herbs: { variants: 1, paint: painter(paintShelfHerbs) },
  shelf_goods: { variants: 1, paint: painter(paintShelfGoods) },
  desk: { variants: 1, paint: painter(paintDesk) },
  banner: { variants: 1, paint: painter(paintBanner) },
  hearth: { variants: 1, paint: painter(paintHallHearth) },
  drafting_table: { variants: 1, paint: painter(paintDraftingTable) },
  trebuchet_model: { variants: 1, paint: painter(paintTrebuchetModel) },
  workbench: { variants: 1, paint: painter(paintWorkbench) },
  gear_crate: { variants: 1, paint: painter(paintGearCrate) },
  weapon_rack: { variants: 1, paint: painter(paintWeaponRack) },
  bunk: { variants: 1, paint: painter(paintBunk) },
  loom: { variants: 1, paint: painter(paintLoom) },
  washbasin: { variants: 1, paint: painter(paintWashbasin) },
  stool: { variants: 1, paint: painter(paintStool) },
  fabric_bolts: { variants: 1, paint: painter(paintFabricBolts) },
  tool_pegs: { variants: 1, paint: painter(paintToolPegs) },
  lamp_shelf: { variants: 1, paint: painter(paintLampShelf) },
  oil_cans: { variants: 1, paint: painter(paintOilCans) },
  seed_sacks: { variants: 1, paint: painter(paintSeedSacks) },
  hoe_rack: { variants: 1, paint: painter(paintHoeRack) },
  pick_rack: { variants: 1, paint: painter(paintPickRack) },
};
