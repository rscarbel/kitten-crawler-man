/**
 * The one painter for the clogged bathroom's pipe board: the recessed wall
 * panel, every tile, the leaks and puddles, the toilets and sinks round the
 * edge, the water main and its pressure gauge. The board surface, the
 * explainer's illustrations and the review renders all paint through it, so
 * the pictures that teach the puzzle cannot drift from the puzzle.
 *
 * It paints a {@link PipeBoardPicture}: a plain description of one frame,
 * already animated by whoever built it. It keeps no state and reads no
 * clock of its own beyond the picture's `timeMs`.
 *
 * Every state reads without colour. A dry bore is nearly black and still; a
 * wet one is bright and carries bands travelling downstream. A leak sprays
 * moving droplets over a spreading puddle and wears a droplet badge. A dry
 * fixture is greyed with a ✕ and a tag; a full one swirls and wears a ✓.
 */

import type { Rect } from '../core/geom';
import { mix } from '../theme/color';
import { UI_FONT_STACK } from '../theme/fonts';
import { pipeInk } from '../theme/pipeInk';
import { worldText } from '../world/worldText';
import type {
  FixtureKind,
  PipeFixture,
  PipeTileKind,
} from '../../systems/cloggedBathroom/pipeBoard';

// ── Pictures ─────────────────────────────────────────────────────────────────

/** One tile as it should look this frame. */
export interface PipeCellPicture {
  readonly kind: PipeTileKind;
  /** The tile's connections as it now stands (`currentMask`). */
  readonly mask: number;
  /**
   * Quarter turns still to play before the drawing reaches `mask`: -1 is a
   * clockwise turn that has just begun. Zero once it has settled.
   */
  readonly spin: number;
  readonly bolted: boolean;
  /**
   * How far water has got through the tile: 0 dry, 0.5 at the hub, 1 out to
   * every end. While `draining`, how much is left in the bore.
   */
  readonly water: number;
  readonly draining: boolean;
  /** The sides water comes in by, as a connection mask. */
  readonly inflow: number;
  /** Steps from the main along the flow; sets where the downstream bands sit. */
  readonly distance: number;
  /** The sides spraying water, as a connection mask. */
  readonly leaks: number;
  /** 0..1: how hard the leaks spray (they build up as the water arrives). */
  readonly spray: number;
  /** 0..1: a bolted tile shaking off a turn. */
  readonly shake: number;
  /** 0..1: the solved board's surge passing through. */
  readonly surge: number;
}

/** One toilet or sink as it should look this frame. */
export interface PipeFixturePicture {
  readonly fixture: PipeFixture;
  /** 0 dry and out of order, 1 full and working. */
  readonly full: number;
  /** 0..1 through a one-shot ring as it fills or flushes; 0 when quiet. */
  readonly pulse: number;
}

/** A puddle spreading under a leaking end. */
export interface PipePuddlePicture {
  readonly cell: number;
  /** Connection bit of the leaking side. */
  readonly side: number;
  /** 0..1 grown. */
  readonly size: number;
}

export interface PipeBoardPicture {
  readonly cols: number;
  readonly rows: number;
  /** The row of the left-edge cell the water main feeds. */
  readonly inletRow: number;
  /** Row-major, `cols` × `rows`. */
  readonly cells: readonly PipeCellPicture[];
  readonly fixtures: readonly PipeFixturePicture[];
  readonly puddles: readonly PipePuddlePicture[];
  /** Where the gauge needle points, 0..1 round the dial; null hides the gauge. */
  readonly gauge: number | null;
  /** 0..1: the main's own surge glow. */
  readonly mainSurge: number;
  /** Milliseconds, for the travelling bands, spray and swirls. */
  readonly timeMs: number;
}

// ── Geometry ─────────────────────────────────────────────────────────────────

/** What the layout needs to know about a board. */
export interface PipeBoardShape {
  readonly cols: number;
  readonly rows: number;
  readonly inletRow: number;
  readonly fixtures: readonly PipeFixture[];
}

export interface PipeGaugeSpot {
  readonly cx: number;
  readonly cy: number;
  readonly r: number;
}

/** Where everything sits once a board is fitted into a rect. */
export interface PipeBoardGeometry {
  readonly cols: number;
  readonly rows: number;
  readonly inletRow: number;
  /** Side of one tile. */
  readonly cell: number;
  /** The tiles. */
  readonly grid: Rect;
  /** The whole wall panel, margins and all. */
  readonly frame: Rect;
  /** The water main's slot, in the left margin beside the inlet row. */
  readonly inlet: Rect;
  readonly gauge: PipeGaugeSpot | null;
  /** How deep the fixture margins are. */
  readonly fixtureDepth: number;
}

/** The margins round the grid, in tiles: left holds the main and gauge, the rest hold fixtures. */
interface MarginPlan {
  readonly left: number;
  readonly fixture: number;
}

/** Room enough for the fixtures to wear their paper tags. */
const ROOMY_MARGINS: MarginPlan = { left: 1.2, fixture: 1.3 };
/** The least a fixture and the main can be drawn in, for a phone. */
const TIGHT_MARGINS: MarginPlan = { left: 0.8, fixture: 0.6 };

export interface PipeBoardFit {
  /** The tile size it never grows past. */
  readonly maxCell: number;
  /** Below this the margins tighten so the tiles stay this large if they can. */
  readonly minCell: number;
  /** How far the panel may spill sideways past `area`, into a container's own padding. */
  readonly sideOverhang?: number;
  readonly gauge: boolean;
  /** Always the tight margins, for a board with nothing round its edge but the main. */
  readonly tight?: boolean;
}

function cellFor(area: Rect, shape: PipeBoardShape, plan: MarginPlan, overhang: number): number {
  const across = shape.cols + plan.left + plan.fixture;
  const down = shape.rows + plan.fixture * 2;
  return Math.min((area.w + overhang * 2) / across, area.h / down);
}

/** The panel's size for a tile size, for asking a container for room. */
export function pipeBoardExtent(
  shape: Pick<PipeBoardShape, 'cols' | 'rows'>,
  cell: number,
  roomy: boolean,
): { readonly w: number; readonly h: number } {
  const plan = roomy ? ROOMY_MARGINS : TIGHT_MARGINS;
  return {
    w: (shape.cols + plan.left + plan.fixture) * cell,
    h: (shape.rows + plan.fixture * 2) * cell,
  };
}

/** The largest tile that fits `area`, tightening the margins before shrinking the tiles. */
export function fittedPipeCell(area: Rect, shape: PipeBoardShape, fit: PipeBoardFit): number {
  const overhang = fit.sideOverhang ?? 0;
  const roomy = Math.min(fit.maxCell, cellFor(area, shape, ROOMY_MARGINS, overhang));
  if (fit.tight !== true && roomy >= fit.minCell) return roomy;
  return Math.min(fit.maxCell, cellFor(area, shape, TIGHT_MARGINS, overhang));
}

const GAUGE_LEFT_SHARE = 0.55;
const GAUGE_MARGIN_RADIUS = 0.42;
const GAUGE_CELL_RADIUS = 0.44;

/** Fits a board into `area`, centred, tiles as large as `fit` allows. */
export function fitPipeBoard(
  area: Rect,
  shape: PipeBoardShape,
  fit: PipeBoardFit,
): PipeBoardGeometry {
  const overhang = fit.sideOverhang ?? 0;
  const roomyCell = Math.min(fit.maxCell, cellFor(area, shape, ROOMY_MARGINS, overhang));
  const roomy = fit.tight !== true && roomyCell >= fit.minCell;
  const plan = roomy ? ROOMY_MARGINS : TIGHT_MARGINS;
  const cell = roomy ? roomyCell : Math.min(fit.maxCell, cellFor(area, shape, plan, overhang));
  const extent = pipeBoardExtent(shape, cell, roomy);
  const frame: Rect = {
    x: area.x + (area.w - extent.w) / 2,
    y: area.y + (area.h - extent.h) / 2,
    w: extent.w,
    h: extent.h,
  };
  const leftW = plan.left * cell;
  const depth = plan.fixture * cell;
  const grid: Rect = {
    x: frame.x + leftW,
    y: frame.y + depth,
    w: shape.cols * cell,
    h: shape.rows * cell,
  };
  const inlet: Rect = { x: frame.x, y: grid.y + shape.inletRow * cell, w: leftW, h: cell };
  const gaugeRow = shape.inletRow > 0 ? shape.inletRow - 1 : shape.inletRow + 1;
  const gauge: PipeGaugeSpot | null = fit.gauge
    ? {
        cx: frame.x + leftW * GAUGE_LEFT_SHARE,
        cy: grid.y + (gaugeRow + HALF) * cell,
        r: Math.min(leftW * GAUGE_MARGIN_RADIUS, cell * GAUGE_CELL_RADIUS),
      }
    : null;
  return {
    cols: shape.cols,
    rows: shape.rows,
    inletRow: shape.inletRow,
    cell,
    grid,
    frame,
    inlet,
    gauge,
    fixtureDepth: depth,
  };
}

export function pipeCellRect(geometry: PipeBoardGeometry, cell: number): Rect {
  const x = cell % geometry.cols;
  const y = Math.floor(cell / geometry.cols);
  return {
    x: geometry.grid.x + x * geometry.cell,
    y: geometry.grid.y + y * geometry.cell,
    w: geometry.cell,
    h: geometry.cell,
  };
}

/** The cell under a point, or null off the grid. */
export function pipeCellAt(geometry: PipeBoardGeometry, px: number, py: number): number | null {
  const x = Math.floor((px - geometry.grid.x) / geometry.cell);
  const y = Math.floor((py - geometry.grid.y) / geometry.cell);
  if (x < 0 || y < 0 || x >= geometry.cols || y >= geometry.rows) return null;
  return y * geometry.cols + x;
}

export function pipeFixtureRect(geometry: PipeBoardGeometry, fixture: PipeFixture): Rect {
  const { grid, cell, fixtureDepth } = geometry;
  switch (fixture.edge) {
    case 'top':
      return {
        x: grid.x + fixture.index * cell,
        y: grid.y - fixtureDepth,
        w: cell,
        h: fixtureDepth,
      };
    case 'bottom':
      return { x: grid.x + fixture.index * cell, y: grid.y + grid.h, w: cell, h: fixtureDepth };
    case 'right':
      return { x: grid.x + grid.w, y: grid.y + fixture.index * cell, w: fixtureDepth, h: cell };
  }
}

// ── Shared measures ──────────────────────────────────────────────────────────

const HALF = 0.5;
const QUARTER_TURN = Math.PI / 2;
const THREE_QUARTER_TURN = Math.PI + QUARTER_TURN;
/** Lines thinner than this vanish on a phone. */
const MIN_STROKE = 1.5;
const FULL_TURN = Math.PI * 2;
const MS_PER_SECOND = 1000;

interface Side {
  readonly bit: number;
  readonly dx: number;
  readonly dy: number;
}

const SIDES: readonly Side[] = [
  { bit: 1, dx: 0, dy: -1 },
  { bit: 2, dx: 1, dy: 0 },
  { bit: 4, dx: 0, dy: 1 },
  { bit: 8, dx: -1, dy: 0 },
];

function sideOf(bit: number): Side {
  return SIDES.find((side) => side.bit === bit) ?? SIDES[0];
}

/** The PVC tube's width, as a share of the tile. */
const PIPE_WIDTH = 0.38;
/** The bore's width, as a share of the tile. */
const BORE_WIDTH = 0.145;
const OUTLINE_WIDTH = 0.035;
const COLLAR_LENGTH = 0.13;
const COLLAR_SWELL = 1.24;
/** Where the coupling sits along an arm, as a share of the half tile. */
const COLLAR_AT = 0.84;
const SHADE_OFFSET = 0.27;
const SHADE_WIDTH = 0.22;
const HIGHLIGHT_OFFSET = 0.26;
const HIGHLIGHT_WIDTH = 0.09;
const HIGHLIGHT_ALPHA = 0.75;
const DRY_DUST_SHARE = 0.18;
const SHADOW_OFFSET = 0.05;
const SHADOW_ALPHA = 0.35;

/** Downstream band spacing along a wet bore, in tiles. */
const BAND_PERIOD = 0.5;
const BAND_ON_SHARE = 0.36;
const BAND_WIDTH_SHARE = 0.55;
const BAND_ALPHA = 0.85;
/** How fast the bands travel downstream, in tiles per second. */
const BAND_SPEED = 1.4;
/** A draining bore keeps at least this share of its width while it empties. */
const DRAIN_MIN_WIDTH = 0.35;

const SHAKE_AMPLITUDE = 0.07;
/** Radians of shake per millisecond. */
const SHAKE_RATE = 0.09;

// ── The panel ────────────────────────────────────────────────────────────────

const PANEL_RADIUS = 0.2;
const RECESS_PAD = 0.06;
const RIM_WIDTH = 0.04;
const SOCKET_WIDTH = 0.02;
const PANEL_SCREW_INSET = 0.16;
const PANEL_SCREW_RADIUS = 0.055;

function roundRect(ctx: CanvasRenderingContext2D, r: Rect, radius: number): void {
  const rad = Math.max(0, Math.min(radius, r.w / 2, r.h / 2));
  ctx.beginPath();
  ctx.moveTo(r.x + rad, r.y);
  ctx.lineTo(r.x + r.w - rad, r.y);
  ctx.arcTo(r.x + r.w, r.y, r.x + r.w, r.y + rad, rad);
  ctx.lineTo(r.x + r.w, r.y + r.h - rad);
  ctx.arcTo(r.x + r.w, r.y + r.h, r.x + r.w - rad, r.y + r.h, rad);
  ctx.lineTo(r.x + rad, r.y + r.h);
  ctx.arcTo(r.x, r.y + r.h, r.x, r.y + r.h - rad, rad);
  ctx.lineTo(r.x, r.y + rad);
  ctx.arcTo(r.x, r.y, r.x + rad, r.y, rad);
  ctx.closePath();
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, color: string): void {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0, r), 0, FULL_TURN);
  ctx.fillStyle = color;
  ctx.fill();
}

function line(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  width: number,
  color: string,
): void {
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.lineWidth = Math.max(0, width);
  ctx.strokeStyle = color;
  ctx.stroke();
}

/** The wall panel the pipes sit in: wall, recess, tile sockets, rim and screws. */
export function paintPipePanel(ctx: CanvasRenderingContext2D, geometry: PipeBoardGeometry): void {
  const { frame, grid, cell } = geometry;
  const ink = pipeInk.panel;
  ctx.save();
  roundRect(ctx, frame, cell * PANEL_RADIUS);
  ctx.fillStyle = ink.wall;
  ctx.fill();
  ctx.lineWidth = cell * RIM_WIDTH;
  ctx.strokeStyle = ink.rimDark;
  ctx.stroke();
  const pad = cell * RECESS_PAD;
  const recess: Rect = {
    x: grid.x - pad,
    y: grid.y - pad,
    w: grid.w + pad * 2,
    h: grid.h + pad * 2,
  };
  roundRect(ctx, recess, pad * 2);
  ctx.fillStyle = ink.recess;
  ctx.fill();
  ctx.lineWidth = cell * RIM_WIDTH;
  ctx.strokeStyle = ink.rimDark;
  ctx.beginPath();
  ctx.moveTo(recess.x, recess.y + recess.h);
  ctx.lineTo(recess.x, recess.y);
  ctx.lineTo(recess.x + recess.w, recess.y);
  ctx.stroke();
  ctx.strokeStyle = ink.rimLight;
  ctx.beginPath();
  ctx.moveTo(recess.x + recess.w, recess.y);
  ctx.lineTo(recess.x + recess.w, recess.y + recess.h);
  ctx.lineTo(recess.x, recess.y + recess.h);
  ctx.stroke();
  ctx.lineWidth = Math.max(1, cell * SOCKET_WIDTH);
  ctx.strokeStyle = ink.socket;
  ctx.beginPath();
  for (let col = 1; col < geometry.cols; col++) {
    ctx.moveTo(grid.x + col * cell, grid.y);
    ctx.lineTo(grid.x + col * cell, grid.y + grid.h);
  }
  for (let row = 1; row < geometry.rows; row++) {
    ctx.moveTo(grid.x, grid.y + row * cell);
    ctx.lineTo(grid.x + grid.w, grid.y + row * cell);
  }
  ctx.stroke();
  const inset = cell * PANEL_SCREW_INSET;
  const screwR = cell * PANEL_SCREW_RADIUS;
  for (const [sx, sy] of [
    [frame.x + inset, frame.y + inset],
    [frame.x + frame.w - inset, frame.y + inset],
    [frame.x + inset, frame.y + frame.h - inset],
    [frame.x + frame.w - inset, frame.y + frame.h - inset],
  ] as const) {
    disc(ctx, sx, sy, screwR, ink.screw);
    line(ctx, sx - screwR * HALF, sy, sx + screwR * HALF, sy, screwR * HALF, ink.rimDark);
  }
  ctx.restore();
}

// ── Tiles ────────────────────────────────────────────────────────────────────

interface TubeColours {
  readonly outline: string;
  readonly body: string;
  readonly shade: string;
  readonly highlight: string;
  readonly collar: string;
}

function tubeColours(kind: PipeTileKind, dry: boolean): TubeColours {
  if (kind === 'cross') {
    const brass = pipeInk.brass;
    return {
      outline: brass.dark,
      body: brass.base,
      shade: brass.dark,
      highlight: brass.light,
      collar: brass.light,
    };
  }
  const pvc = pipeInk.pvc;
  const dust = dry ? DRY_DUST_SHARE : 0;
  return {
    outline: pvc.outline,
    body: mix(pvc.body, pvc.dust, dust),
    shade: mix(pvc.shade, pvc.dust, dust),
    highlight: pvc.highlight,
    collar: mix(pvc.collar, pvc.dust, dust),
  };
}

function armsOf(mask: number): readonly Side[] {
  return SIDES.filter((side) => (mask & side.bit) !== 0);
}

/** The tube of a tile, centred on the origin: outline, body, shading, couplings. */
function paintTube(
  ctx: CanvasRenderingContext2D,
  arms: readonly Side[],
  c: number,
  colours: TubeColours,
  hub: boolean,
): void {
  const h = c * HALF;
  const tube = c * PIPE_WIDTH;
  const outline = c * OUTLINE_WIDTH;
  ctx.lineCap = 'butt';
  for (const arm of arms) {
    line(ctx, 0, 0, arm.dx * h, arm.dy * h, tube + outline * 2, colours.outline);
  }
  if (hub) disc(ctx, 0, 0, tube * HALF + outline, colours.outline);
  for (const arm of arms) line(ctx, 0, 0, arm.dx * h, arm.dy * h, tube, colours.body);
  if (hub) disc(ctx, 0, 0, tube * HALF, colours.body);
  for (const arm of arms) {
    const ox = Math.abs(arm.dy) * tube * SHADE_OFFSET;
    const oy = Math.abs(arm.dx) * tube * SHADE_OFFSET;
    line(ctx, ox, oy, arm.dx * h + ox, arm.dy * h + oy, tube * SHADE_WIDTH, colours.shade);
    ctx.save();
    ctx.globalAlpha *= HIGHLIGHT_ALPHA;
    const hx = -Math.abs(arm.dy) * tube * HIGHLIGHT_OFFSET;
    const hy = -Math.abs(arm.dx) * tube * HIGHLIGHT_OFFSET;
    line(ctx, hx, hy, arm.dx * h + hx, arm.dy * h + hy, tube * HIGHLIGHT_WIDTH, colours.highlight);
    ctx.restore();
  }
  for (const arm of arms) {
    const cx = arm.dx * h * COLLAR_AT;
    const cy = arm.dy * h * COLLAR_AT;
    const along = c * COLLAR_LENGTH;
    const across = tube * COLLAR_SWELL;
    const w = arm.dx !== 0 ? along : across;
    const hh = arm.dx !== 0 ? across : along;
    const collar: Rect = { x: cx - w / 2, y: cy - hh / 2, w, h: hh };
    ctx.fillStyle = colours.collar;
    ctx.fillRect(collar.x, collar.y, collar.w, collar.h);
    ctx.lineWidth = outline;
    ctx.strokeStyle = colours.outline;
    ctx.strokeRect(collar.x, collar.y, collar.w, collar.h);
  }
}

/** Light bands along a wet stretch of bore, phased to the flow so they travel downstream. */
function paintBands(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  c: number,
  flowAtStart: number,
  timeMs: number,
  width: number,
): void {
  const period = c * BAND_PERIOD;
  const travelled = (timeMs / MS_PER_SECOND) * BAND_SPEED * c;
  ctx.save();
  ctx.setLineDash([period * BAND_ON_SHARE, period * (1 - BAND_ON_SHARE)]);
  ctx.lineDashOffset = flowAtStart * c - travelled;
  ctx.globalAlpha *= BAND_ALPHA;
  line(ctx, x0, y0, x1, y1, width * BAND_WIDTH_SHARE, pipeInk.water.band);
  ctx.restore();
}

function waterColour(surge: number): string {
  return mix(pipeInk.water.base, pipeInk.water.surge, surge);
}

/**
 * The bore, dry or wet. Water comes in at an inflow end and reaches the hub
 * at `water` 0.5, then runs out along the other arms to reach their ends at 1.
 */
function paintBore(
  ctx: CanvasRenderingContext2D,
  picture: PipeCellPicture,
  arms: readonly Side[],
  c: number,
  timeMs: number,
): void {
  const h = c * HALF;
  const bore = c * BORE_WIDTH;
  const ink = pipeInk.pvc;
  ctx.lineCap = 'butt';
  for (const arm of arms) line(ctx, 0, 0, arm.dx * h, arm.dy * h, bore, ink.boreDry);
  disc(ctx, 0, 0, bore * HALF, ink.boreDry);
  for (const arm of arms) {
    line(ctx, 0, 0, arm.dx * h, arm.dy * h, bore * HALF, ink.boreDryInner);
  }
  if (picture.water <= 0) return;
  const colour = waterColour(picture.surge);
  if (picture.draining) {
    const width = bore * (DRAIN_MIN_WIDTH + (1 - DRAIN_MIN_WIDTH) * picture.water);
    ctx.save();
    ctx.globalAlpha *= picture.water;
    for (const arm of arms) line(ctx, 0, 0, arm.dx * h, arm.dy * h, width, colour);
    disc(ctx, 0, 0, width * HALF, colour);
    ctx.restore();
    return;
  }
  const level = Math.min(1, picture.water);
  const inbound = Math.min(1, level / HALF);
  const outbound = Math.max(0, (level - HALF) / HALF);
  const flowIn = picture.distance;
  const flowHub = picture.distance + HALF;
  for (const arm of arms) {
    const isInflow = (picture.inflow & arm.bit) !== 0;
    if (isInflow) {
      const reach = h * (1 - inbound);
      const x0 = arm.dx * h;
      const y0 = arm.dy * h;
      const x1 = arm.dx * reach;
      const y1 = arm.dy * reach;
      line(ctx, x0, y0, x1, y1, bore, colour);
      paintBands(ctx, x0, y0, x1, y1, c, flowIn, timeMs, bore);
    } else if (outbound > 0) {
      const x1 = arm.dx * h * outbound;
      const y1 = arm.dy * h * outbound;
      line(ctx, 0, 0, x1, y1, bore, colour);
      paintBands(ctx, 0, 0, x1, y1, c, flowHub, timeMs, bore);
    }
  }
  if (inbound >= 1) disc(ctx, 0, 0, bore * HALF, colour);
}

/** The cap sits over the hub end of its one arm, a little wider than the tube. */
const CAP_BACK = 0.1;
const CAP_FRONT = 0.16;
const CAP_SWELL = 1.5;
const CAP_RADIUS = 0.05;
const CAP_KNURLS = 4;
const CAP_KNURL_WIDTH = 0.07;
const CAP_DOME = 0.3;

/** The chunky screw cap that closes a dead end on purpose: knurled, wider than the pipe, domed. */
function paintScrewCap(ctx: CanvasRenderingContext2D, c: number, arm: Side): void {
  const ink = pipeInk.pvc;
  const tube = c * PIPE_WIDTH;
  const across = tube * CAP_SWELL;
  const outline = c * OUTLINE_WIDTH;
  ctx.save();
  ctx.rotate(Math.atan2(arm.dy, arm.dx));
  const body: Rect = { x: -c * CAP_BACK, y: -across / 2, w: c * (CAP_BACK + CAP_FRONT), h: across };
  ctx.beginPath();
  ctx.ellipse(body.x, 0, across * CAP_DOME, across / 2, 0, QUARTER_TURN, THREE_QUARTER_TURN);
  ctx.fillStyle = ink.capBody;
  ctx.fill();
  ctx.lineWidth = outline;
  ctx.strokeStyle = ink.outline;
  ctx.stroke();
  roundRect(ctx, body, c * CAP_RADIUS);
  ctx.fillStyle = ink.capBody;
  ctx.fill();
  ctx.stroke();
  for (let knurl = 1; knurl <= CAP_KNURLS; knurl++) {
    const kx = body.x + (body.w * knurl) / (CAP_KNURLS + 1);
    line(
      ctx,
      kx,
      body.y + outline,
      kx,
      body.y + body.h - outline,
      c * CAP_KNURL_WIDTH * HALF,
      ink.capRidge,
    );
  }
  line(
    ctx,
    body.x,
    body.y + across * HIGHLIGHT_OFFSET,
    body.x + body.w,
    body.y + across * HIGHLIGHT_OFFSET,
    tube * HIGHLIGHT_WIDTH,
    ink.capHighlight,
  );
  ctx.restore();
}

const COLLAR_SIDE_CROSS = 0.56;
const COLLAR_SIDE_HINT = 0.48;
const COLLAR_RADIUS = 0.08;
const BOLT_INSET = 0.2;
const BOLT_RADIUS = 0.065;
const BOLT_GLINT = 0.4;

/** The brass collar and its four bolt heads that mark a tile bolted down. */
function paintBoltCollar(ctx: CanvasRenderingContext2D, c: number, kind: PipeTileKind): void {
  const ink = pipeInk.brass;
  const side = c * (kind === 'cross' ? COLLAR_SIDE_CROSS : COLLAR_SIDE_HINT);
  const r: Rect = { x: -side / 2, y: -side / 2, w: side, h: side };
  roundRect(ctx, r, c * COLLAR_RADIUS);
  ctx.fillStyle = ink.base;
  ctx.fill();
  ctx.lineWidth = c * OUTLINE_WIDTH;
  ctx.strokeStyle = ink.dark;
  ctx.stroke();
  ctx.save();
  ctx.globalAlpha *= HIGHLIGHT_ALPHA;
  line(
    ctx,
    r.x + side * BOLT_INSET,
    r.y + side * BOLT_INSET * HALF,
    r.x + side * (1 - BOLT_INSET),
    r.y + side * BOLT_INSET * HALF,
    c * OUTLINE_WIDTH,
    ink.light,
  );
  ctx.restore();
  const inset = side * BOLT_INSET;
  const boltR = c * BOLT_RADIUS;
  for (const [bx, by] of [
    [r.x + inset, r.y + inset],
    [r.x + side - inset, r.y + inset],
    [r.x + inset, r.y + side - inset],
    [r.x + side - inset, r.y + side - inset],
  ] as const) {
    disc(ctx, bx, by, boltR + c * OUTLINE_WIDTH * HALF, ink.dark);
    disc(ctx, bx, by, boltR, ink.bolt);
    disc(
      ctx,
      bx - boltR * BOLT_GLINT,
      by - boltR * BOLT_GLINT,
      boltR * BOLT_GLINT,
      ink.boltHighlight,
    );
  }
}

/** One tile, drawn into its cell rect. */
export function paintPipeTile(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  picture: PipeCellPicture,
  timeMs: number,
): void {
  if (picture.mask === 0) return;
  const c = rect.w;
  const arms = armsOf(picture.mask);
  const dry = picture.water <= 0;
  const shakeX = Math.sin(timeMs * SHAKE_RATE) * picture.shake * SHAKE_AMPLITUDE * c;
  ctx.save();
  ctx.translate(rect.x + c * HALF + shakeX, rect.y + c * HALF);
  ctx.rotate(picture.spin * QUARTER_TURN);
  const hub = picture.kind !== 'straight';
  ctx.save();
  ctx.globalAlpha *= SHADOW_ALPHA;
  ctx.translate(c * SHADOW_OFFSET, c * SHADOW_OFFSET);
  const shadowColours: TubeColours = {
    outline: pipeInk.shadow,
    body: pipeInk.shadow,
    shade: pipeInk.shadow,
    highlight: pipeInk.shadow,
    collar: pipeInk.shadow,
  };
  paintTube(ctx, arms, c, shadowColours, hub);
  ctx.restore();
  paintTube(ctx, arms, c, tubeColours(picture.kind, dry), hub);
  paintBore(ctx, picture, arms, c, timeMs);
  if (picture.kind === 'cap' && arms.length > 0) paintScrewCap(ctx, c, arms[0]);
  if (picture.bolted) paintBoltCollar(ctx, c, picture.kind);
  ctx.restore();
}

// ── Leaks ────────────────────────────────────────────────────────────────────

const SPRAY_DROPLETS = 13;
const SPRAY_PERIOD_MS = 620;
const SPRAY_REACH = 0.8;
const SPRAY_FAN = 1.15;
const SPRAY_DROP_RADIUS = 0.07;
const SPRAY_GRAVITY = 0.35;
const SPRAY_MIST_RADIUS = 0.42;
const SPRAY_MIST_ALPHA = 0.4;
/** A fixed scatter of droplet angles and phases, so the spray looks random but never flickers. */
const SPRAY_SCATTER = Array.from({ length: SPRAY_DROPLETS }, (_unused, index) => {
  const golden = 0.618034;
  const fraction = (index * golden) % 1;
  return { angle: (fraction - HALF) * SPRAY_FAN, phase: (index / SPRAY_DROPLETS) % 1 };
});

function sideEnd(rect: Rect, side: Side): { readonly x: number; readonly y: number } {
  return {
    x: rect.x + rect.w * HALF + side.dx * rect.w * HALF,
    y: rect.y + rect.h * HALF + side.dy * rect.h * HALF,
  };
}

/** Droplets bursting out of an open end, arcing down under gravity, with a mist behind them. */
export function paintLeakSpray(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  sideBit: number,
  strength: number,
  timeMs: number,
): void {
  if (strength <= 0) return;
  const c = rect.w;
  const side = sideOf(sideBit);
  const end = sideEnd(rect, side);
  const base = Math.atan2(side.dy, side.dx);
  const ink = pipeInk.water;
  ctx.save();
  ctx.globalAlpha *= strength * SPRAY_MIST_ALPHA;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.arc(end.x, end.y, c * SPRAY_MIST_RADIUS, base - SPRAY_FAN * HALF, base + SPRAY_FAN * HALF);
  ctx.closePath();
  ctx.fillStyle = ink.spray;
  ctx.fill();
  ctx.restore();
  for (const drop of SPRAY_SCATTER) {
    const progress = (timeMs / SPRAY_PERIOD_MS + drop.phase) % 1;
    const angle = base + drop.angle;
    const reach = c * SPRAY_REACH * progress;
    const x = end.x + Math.cos(angle) * reach;
    const y = end.y + Math.sin(angle) * reach + c * SPRAY_GRAVITY * progress * progress;
    ctx.save();
    ctx.globalAlpha *= strength * (1 - progress);
    disc(ctx, x, y, c * SPRAY_DROP_RADIUS * (1 - progress * HALF), ink.spray);
    ctx.restore();
  }
}

const PUDDLE_DROP = 0.2;
const PUDDLE_RADIUS = 0.55;
const PUDDLE_FLATTEN = 0.6;
/** Puddles lie over the pipes, so the tile beneath still shows through. */
const PUDDLE_ALPHA = 0.62;
const PUDDLE_EDGE_WIDTH = 0.03;
const PUDDLE_RIPPLE_MS = 900;
const PUDDLE_RIPPLE_SHARE = 0.8;
const PUDDLE_WOBBLE = 0.04;
const PUDDLE_WOBBLE_RATE = 0.004;

/** The puddle spreading on the panel under a leaking end, with drips rippling it. */
export function paintPuddle(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  sideBit: number,
  size: number,
  timeMs: number,
): void {
  if (size <= 0) return;
  const c = rect.w;
  const end = sideEnd(rect, sideOf(sideBit));
  const cx = end.x;
  const cy = end.y + c * PUDDLE_DROP;
  const wobble = 1 + Math.sin(timeMs * PUDDLE_WOBBLE_RATE) * PUDDLE_WOBBLE;
  const rx = c * PUDDLE_RADIUS * size * wobble;
  const ry = rx * PUDDLE_FLATTEN;
  const ink = pipeInk.water;
  ctx.save();
  ctx.globalAlpha *= PUDDLE_ALPHA;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, FULL_TURN);
  ctx.fillStyle = ink.puddle;
  ctx.fill();
  ctx.lineWidth = c * PUDDLE_EDGE_WIDTH;
  ctx.strokeStyle = ink.puddleEdge;
  ctx.stroke();
  const ripple = (timeMs % PUDDLE_RIPPLE_MS) / PUDDLE_RIPPLE_MS;
  ctx.globalAlpha *= 1 - ripple;
  ctx.beginPath();
  ctx.ellipse(
    cx,
    cy,
    rx * ripple * PUDDLE_RIPPLE_SHARE,
    ry * ripple * PUDDLE_RIPPLE_SHARE,
    0,
    0,
    FULL_TURN,
  );
  ctx.stroke();
  ctx.restore();
}

/** A droplet: a round belly drawing up to a point. */
function dropletPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number): void {
  const tipRise = 1.9;
  const shoulder = 0.35;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r * tipRise);
  ctx.quadraticCurveTo(cx + r, cy - r * shoulder, cx + r, cy);
  ctx.arc(cx, cy, r, 0, Math.PI);
  ctx.quadraticCurveTo(cx - r, cy - r * shoulder, cx, cy - r * tipRise);
  ctx.closePath();
}

const BADGE_AT = 0.8;
const BADGE_RADIUS = 0.11;
const BADGE_MIN_RADIUS = 3.5;
const BADGE_EDGE = 0.3;

/** The small red droplet a leaking tile wears in its corner. */
export function paintLeakBadge(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
): void {
  dropletPath(ctx, cx, cy, r);
  ctx.fillStyle = pipeInk.leak.badge;
  ctx.fill();
  ctx.lineWidth = Math.max(1, r * BADGE_EDGE);
  ctx.strokeStyle = pipeInk.leak.badgeEdge;
  ctx.stroke();
}

function paintTileBadge(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const r = Math.max(BADGE_MIN_RADIUS, rect.w * BADGE_RADIUS);
  paintLeakBadge(ctx, rect.x + rect.w * BADGE_AT, rect.y + rect.h * (1 - BADGE_AT) + r, r);
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

interface Porcelain {
  readonly body: string;
  readonly shade: string;
  readonly outline: string;
  readonly tap: string;
}

/** Fixtures grey out while they are out of order. */
const OUT_OF_ORDER_GREY = 0.5;

function porcelainFor(full: number): Porcelain {
  const ink = pipeInk.fixture;
  const grey = OUT_OF_ORDER_GREY * (1 - full);
  return {
    body: mix(ink.porcelain, ink.outOfOrderTint, grey),
    shade: mix(ink.shade, ink.outOfOrderTint, grey),
    outline: ink.outline,
    tap: mix(ink.tap, ink.outOfOrderTint, grey),
  };
}

const FIXTURE_ICON_SHARE = 0.92;
/**
 * A fixture may be drawn wider than the one tile it faces: no two fixtures
 * sit on neighbouring edge cells, so there is room beside it.
 */
const FIXTURE_ICON_SPAN = 1.45;
const STUB_SWELL = 1;

/** The icon square inside a fixture slot, pushed to its outer side so the stub can reach the grid. */
function fixtureIcon(
  rect: Rect,
  fixture: PipeFixture,
  cell: number,
): {
  readonly icon: Rect;
  readonly stubFrom: { x: number; y: number };
  readonly stubTo: { x: number; y: number };
} {
  const depth = fixture.edge === 'right' ? rect.w : rect.h;
  const s = Math.min(depth, cell * FIXTURE_ICON_SPAN) * FIXTURE_ICON_SHARE;
  const cx = rect.x + rect.w * HALF;
  const cy = rect.y + rect.h * HALF;
  const icon: Rect = { x: cx - s * HALF, y: cy - s * HALF, w: s, h: s };
  switch (fixture.edge) {
    case 'top':
      return { icon, stubFrom: { x: cx, y: cy }, stubTo: { x: cx, y: rect.y + rect.h } };
    case 'bottom':
      return { icon, stubFrom: { x: cx, y: cy }, stubTo: { x: cx, y: rect.y } };
    case 'right':
      return { icon, stubFrom: { x: cx, y: cy }, stubTo: { x: rect.x, y: cy } };
  }
}

const TANK_LEFT = 0.2;
const TANK_RIGHT = 0.8;
const TANK_TOP = 0.04;
const TANK_BOTTOM = 0.36;
const TANK_RADIUS = 0.06;
const LINE_SHARE = 0.045;
const RIM_Y = 0.5;
const RIM_RX = 0.4;
const RIM_RY = 0.12;
const BOWL_BOTTOM = 0.84;
const BOWL_FOOT_LEFT = 0.34;
const BOWL_FOOT_RIGHT = 0.66;
const PEDESTAL_TOP = 0.82;
const PEDESTAL_BOTTOM = 0.97;
const WATER_RX = 0.3;
const WATER_RY = 0.08;
const HANDLE_X = 0.28;
const HANDLE_Y = 0.12;
const HANDLE_W = 0.12;
const SWIRL_RATE = 0.006;
const SWIRL_ARCS = 2;
const SWIRL_SWEEP = 1.9;
const SWIRL_SCALE = 0.7;
const SWIRL_WIDTH = 0.035;

function paintBowlWater(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
  full: number,
  timeMs: number,
  s: number,
): void {
  const ink = pipeInk;
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, FULL_TURN);
  ctx.fillStyle = ink.fixture.bowlEmpty;
  ctx.fill();
  if (full <= 0) return;
  ctx.save();
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx * full, ry * full, 0, 0, FULL_TURN);
  ctx.fillStyle = ink.water.base;
  ctx.fill();
  const spin = timeMs * SWIRL_RATE;
  ctx.lineCap = 'round';
  ctx.lineWidth = Math.max(1, s * SWIRL_WIDTH);
  ctx.strokeStyle = ink.water.band;
  for (let arc = 0; arc < SWIRL_ARCS; arc++) {
    const start = spin + (arc / SWIRL_ARCS) * FULL_TURN;
    ctx.beginPath();
    ctx.ellipse(
      cx,
      cy,
      rx * full * SWIRL_SCALE,
      ry * full * SWIRL_SCALE,
      0,
      start,
      start + SWIRL_SWEEP,
    );
    ctx.stroke();
  }
  ctx.restore();
}

function paintToilet(
  ctx: CanvasRenderingContext2D,
  icon: Rect,
  porcelain: Porcelain,
  full: number,
  timeMs: number,
): void {
  const s = icon.w;
  const x = (share: number): number => icon.x + share * s;
  const y = (share: number): number => icon.y + share * s;
  const outline = Math.max(1, s * LINE_SHARE);
  ctx.lineWidth = outline;
  ctx.strokeStyle = porcelain.outline;
  const pedestal: Rect = {
    x: x(BOWL_FOOT_LEFT + LINE_SHARE),
    y: y(PEDESTAL_TOP),
    w: s * (BOWL_FOOT_RIGHT - BOWL_FOOT_LEFT - LINE_SHARE * 2),
    h: s * (PEDESTAL_BOTTOM - PEDESTAL_TOP),
  };
  ctx.fillStyle = porcelain.body;
  ctx.fillRect(pedestal.x, pedestal.y, pedestal.w, pedestal.h);
  ctx.strokeRect(pedestal.x, pedestal.y, pedestal.w, pedestal.h);
  ctx.beginPath();
  ctx.moveTo(x(HALF - RIM_RX), y(RIM_Y));
  ctx.quadraticCurveTo(x(HALF - RIM_RX), y(BOWL_BOTTOM), x(BOWL_FOOT_LEFT), y(BOWL_BOTTOM));
  ctx.lineTo(x(BOWL_FOOT_RIGHT), y(BOWL_BOTTOM));
  ctx.quadraticCurveTo(x(HALF + RIM_RX), y(BOWL_BOTTOM), x(HALF + RIM_RX), y(RIM_Y));
  ctx.closePath();
  ctx.fillStyle = porcelain.body;
  ctx.fill();
  ctx.stroke();
  roundRect(
    ctx,
    {
      x: x(TANK_LEFT),
      y: y(TANK_TOP),
      w: s * (TANK_RIGHT - TANK_LEFT),
      h: s * (TANK_BOTTOM - TANK_TOP),
    },
    s * TANK_RADIUS,
  );
  ctx.fillStyle = porcelain.body;
  ctx.fill();
  ctx.stroke();
  line(
    ctx,
    x(HANDLE_X),
    y(HANDLE_Y),
    x(HANDLE_X + HANDLE_W),
    y(HANDLE_Y),
    outline * 2,
    porcelain.shade,
  );
  ctx.beginPath();
  ctx.ellipse(x(HALF), y(RIM_Y), s * RIM_RX, s * RIM_RY, 0, 0, FULL_TURN);
  ctx.fillStyle = porcelain.shade;
  ctx.fill();
  ctx.lineWidth = outline;
  ctx.strokeStyle = porcelain.outline;
  ctx.stroke();
  paintBowlWater(ctx, x(HALF), y(RIM_Y), s * WATER_RX, s * WATER_RY, full, timeMs, s);
}

const BASIN_TOP = 0.46;
const BASIN_LEFT = 0.08;
const BASIN_RIGHT = 0.92;
const BASIN_BOTTOM = 0.8;
const BASIN_RIM = 0.08;
const SINK_PEDESTAL_LEFT = 0.42;
const SINK_PEDESTAL_RIGHT = 0.58;
const TAP_X = 0.5;
const TAP_TOP = 0.16;
const TAP_SPOUT_X = 0.66;
const TAP_SPOUT_Y = 0.3;
const TAP_WIDTH = 0.07;
const TAP_HANDLE_W = 0.22;
const STREAM_PERIOD = 0.12;
/** How fast the tap's stream runs, in icon widths per second. */
const STREAM_SPEED = 1.2;
const STREAM_WIDTH = 0.05;

function paintSink(
  ctx: CanvasRenderingContext2D,
  icon: Rect,
  porcelain: Porcelain,
  full: number,
  timeMs: number,
): void {
  const s = icon.w;
  const x = (share: number): number => icon.x + share * s;
  const y = (share: number): number => icon.y + share * s;
  const outline = Math.max(1, s * LINE_SHARE);
  ctx.lineWidth = outline;
  ctx.strokeStyle = porcelain.outline;
  const pedestal: Rect = {
    x: x(SINK_PEDESTAL_LEFT),
    y: y(BASIN_BOTTOM),
    w: s * (SINK_PEDESTAL_RIGHT - SINK_PEDESTAL_LEFT),
    h: s * (PEDESTAL_BOTTOM - BASIN_BOTTOM),
  };
  ctx.fillStyle = porcelain.body;
  ctx.fillRect(pedestal.x, pedestal.y, pedestal.w, pedestal.h);
  ctx.strokeRect(pedestal.x, pedestal.y, pedestal.w, pedestal.h);
  ctx.lineCap = 'round';
  line(
    ctx,
    x(TAP_X),
    y(TAP_TOP),
    x(TAP_X),
    y(BASIN_TOP),
    s * TAP_WIDTH + outline * 2,
    porcelain.outline,
  );
  line(
    ctx,
    x(TAP_X),
    y(TAP_SPOUT_Y),
    x(TAP_SPOUT_X),
    y(TAP_SPOUT_Y),
    s * TAP_WIDTH + outline * 2,
    porcelain.outline,
  );
  line(ctx, x(TAP_X), y(TAP_TOP), x(TAP_X), y(BASIN_TOP), s * TAP_WIDTH, porcelain.tap);
  line(ctx, x(TAP_X), y(TAP_SPOUT_Y), x(TAP_SPOUT_X), y(TAP_SPOUT_Y), s * TAP_WIDTH, porcelain.tap);
  line(
    ctx,
    x(TAP_X - TAP_HANDLE_W * HALF),
    y(TAP_TOP),
    x(TAP_X + TAP_HANDLE_W * HALF),
    y(TAP_TOP),
    s * TAP_WIDTH,
    porcelain.outline,
  );
  ctx.beginPath();
  ctx.moveTo(x(BASIN_LEFT), y(BASIN_TOP));
  ctx.lineTo(x(BASIN_RIGHT), y(BASIN_TOP));
  ctx.quadraticCurveTo(x(BASIN_RIGHT), y(BASIN_BOTTOM), x(HALF), y(BASIN_BOTTOM));
  ctx.quadraticCurveTo(x(BASIN_LEFT), y(BASIN_BOTTOM), x(BASIN_LEFT), y(BASIN_TOP));
  ctx.closePath();
  ctx.fillStyle = porcelain.body;
  ctx.fill();
  ctx.lineWidth = outline;
  ctx.strokeStyle = porcelain.outline;
  ctx.stroke();
  const basinCx = x(HALF);
  const basinCy = y(BASIN_TOP + BASIN_RIM * HALF);
  paintBowlWater(ctx, basinCx, basinCy, s * RIM_RX, s * BASIN_RIM, full, timeMs, s);
  if (full <= 0) return;
  ctx.save();
  ctx.globalAlpha *= full;
  const top = y(TAP_SPOUT_Y);
  const bottom = basinCy;
  line(ctx, x(TAP_SPOUT_X), top, x(TAP_SPOUT_X), bottom, s * STREAM_WIDTH, pipeInk.water.base);
  ctx.setLineDash([s * STREAM_PERIOD * HALF, s * STREAM_PERIOD * HALF]);
  ctx.lineDashOffset = -(timeMs / MS_PER_SECOND) * STREAM_SPEED * s;
  line(
    ctx,
    x(TAP_SPOUT_X),
    top,
    x(TAP_SPOUT_X),
    bottom,
    s * STREAM_WIDTH * HALF,
    pipeInk.water.band,
  );
  ctx.restore();
}

const MARK_AT_X = 0.86;
const MARK_AT_Y = 0.14;
const MARK_RADIUS = 0.2;
const MARK_MIN_RADIUS = 5;
const MARK_STROKE = 0.28;
const MARK_ARM = 0.45;
const TICK_SHORT_X = -0.45;
const TICK_SHORT_Y = 0;
const TICK_CORNER_X = -0.12;
const TICK_CORNER_Y = 0.32;
const TICK_LONG_X = 0.48;
const TICK_LONG_Y = -0.34;

/** The tag mark: a red ✕ while broken, a green ✓ once working. Shape tells them apart without colour. */
export function paintFixtureMark(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  working: boolean,
): void {
  const ink = pipeInk.fixture;
  disc(ctx, cx, cy, r + Math.max(1, r * MARK_STROKE * HALF), ink.outline);
  disc(ctx, cx, cy, r, working ? ink.working : ink.broken);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.lineWidth = Math.max(MIN_STROKE, r * MARK_STROKE);
  ctx.strokeStyle = ink.markInk;
  ctx.beginPath();
  if (working) {
    ctx.moveTo(cx + r * TICK_SHORT_X, cy + r * TICK_SHORT_Y);
    ctx.lineTo(cx + r * TICK_CORNER_X, cy + r * TICK_CORNER_Y);
    ctx.lineTo(cx + r * TICK_LONG_X, cy + r * TICK_LONG_Y);
  } else {
    const arm = r * MARK_ARM;
    ctx.moveTo(cx - arm, cy - arm);
    ctx.lineTo(cx + arm, cy + arm);
    ctx.moveTo(cx + arm, cy - arm);
    ctx.lineTo(cx - arm, cy + arm);
  }
  ctx.stroke();
  ctx.restore();
}

/** Below this icon size the paper tag's words cannot be read, so only the ✕ is drawn. */
const TAG_TEXT_MIN_ICON = 46;
const TAG_TILT = -0.18;
/** The tag hangs off the fixture's lower left, clear of the ✕ at its upper right. */
const TAG_X = 0.3;
const TAG_Y = 0.72;
const TAG_W = 0.62;
const TAG_H = 0.4;
const TAG_TEXT_SIZE = 0.135;
const TAG_LINE_GAP = 0.15;
const TAG_HOLE = 0.035;
const TAG_LINES = ['OUT OF', 'ORDER'] as const;

/** The paper "OUT OF ORDER" tag hung on a dry fixture. */
function paintOutOfOrderTag(ctx: CanvasRenderingContext2D, icon: Rect): void {
  const s = icon.w;
  const ink = pipeInk.fixture;
  ctx.save();
  ctx.translate(icon.x + s * TAG_X, icon.y + s * TAG_Y);
  ctx.rotate(TAG_TILT);
  const tag: Rect = { x: -s * TAG_W * HALF, y: -s * TAG_H * HALF, w: s * TAG_W, h: s * TAG_H };
  const thin = Math.max(1, s * LINE_SHARE * HALF);
  line(ctx, 0, tag.y, s * TAG_W * HALF, tag.y - s * TAG_H, thin, ink.tagString);
  ctx.fillStyle = ink.tagPaper;
  ctx.fillRect(tag.x, tag.y, tag.w, tag.h);
  ctx.lineWidth = thin;
  ctx.strokeStyle = ink.outline;
  ctx.strokeRect(tag.x, tag.y, tag.w, tag.h);
  disc(ctx, 0, tag.y + s * TAG_HOLE * 2, s * TAG_HOLE, ink.outline);
  const size = Math.round(s * TAG_TEXT_SIZE);
  TAG_LINES.forEach((words, index) => {
    worldText(ctx, words, {
      x: 0,
      y: s * TAG_LINE_GAP * (index - HALF) + s * TAG_HOLE,
      size,
      bold: true,
      color: ink.tagInk,
      family: UI_FONT_STACK,
      align: 'center',
      baseline: 'middle',
    });
  });
  ctx.restore();
}

const PULSE_GROWTH = 0.5;
const PULSE_RADIUS = 0.55;
const PULSE_WIDTH = 0.06;

/** One toilet or sink in its slot, joined to its edge cell by a stub of pipe. */
export function paintPipeFixture(
  ctx: CanvasRenderingContext2D,
  slot: Rect,
  picture: PipeFixturePicture,
  cell: number,
  timeMs: number,
): void {
  const { icon, stubFrom, stubTo } = fixtureIcon(slot, picture.fixture, cell);
  const tube = cell * PIPE_WIDTH * STUB_SWELL;
  const outline = cell * OUTLINE_WIDTH;
  const pvc = pipeInk.pvc;
  const working = picture.full >= 1;
  ctx.save();
  ctx.lineCap = 'butt';
  line(ctx, stubFrom.x, stubFrom.y, stubTo.x, stubTo.y, tube + outline * 2, pvc.outline);
  line(
    ctx,
    stubFrom.x,
    stubFrom.y,
    stubTo.x,
    stubTo.y,
    tube,
    mix(pvc.body, pvc.dust, picture.full > 0 ? 0 : DRY_DUST_SHARE),
  );
  line(
    ctx,
    stubFrom.x,
    stubFrom.y,
    stubTo.x,
    stubTo.y,
    cell * BORE_WIDTH,
    picture.full > 0 ? pipeInk.water.base : pvc.boreDry,
  );
  const kind: FixtureKind = picture.fixture.kind;
  const porcelain = porcelainFor(picture.full);
  if (kind === 'toilet') paintToilet(ctx, icon, porcelain, picture.full, timeMs);
  else paintSink(ctx, icon, porcelain, picture.full, timeMs);
  if (!working && icon.w >= TAG_TEXT_MIN_ICON) paintOutOfOrderTag(ctx, icon);
  const markR = Math.max(MARK_MIN_RADIUS, icon.w * MARK_RADIUS);
  paintFixtureMark(ctx, icon.x + icon.w * MARK_AT_X, icon.y + icon.w * MARK_AT_Y, markR, working);
  if (picture.pulse > 0) {
    ctx.globalAlpha *= 1 - picture.pulse;
    ctx.beginPath();
    ctx.arc(
      icon.x + icon.w * HALF,
      icon.y + icon.h * HALF,
      icon.w * PULSE_RADIUS * (1 + picture.pulse * PULSE_GROWTH),
      0,
      FULL_TURN,
    );
    ctx.lineWidth = Math.max(MIN_STROKE, icon.w * PULSE_WIDTH);
    ctx.strokeStyle = pipeInk.fixture.working;
    ctx.stroke();
  }
  ctx.restore();
}

// ── The water main and gauge ─────────────────────────────────────────────────

const MAIN_WIDTH = 0.5;
const MAIN_BORE = 0.22;
const FLANGE_W = 0.12;
const FLANGE_H = 0.7;
const VALVE_AT = 0.24;
const VALVE_RISE = 0.27;
const VALVE_RADIUS = 0.15;
const VALVE_SPOKES = 4;
const VALVE_RIM = 0.32;

/** The water main coming in from the left, always running, with its shutoff wheel. */
export function paintWaterMain(
  ctx: CanvasRenderingContext2D,
  geometry: PipeBoardGeometry,
  surge: number,
  timeMs: number,
): void {
  const { inlet, cell } = geometry;
  const ink = pipeInk.main;
  const cy = inlet.y + inlet.h * HALF;
  const x0 = inlet.x;
  const x1 = inlet.x + inlet.w;
  const width = cell * MAIN_WIDTH;
  const outline = cell * OUTLINE_WIDTH;
  ctx.save();
  ctx.lineCap = 'butt';
  const valveX = x0 + inlet.w * VALVE_AT;
  const valveY = cy - cell * VALVE_RISE;
  line(ctx, valveX, cy, valveX, valveY, cell * BORE_WIDTH * HALF, ink.ironDark);
  line(ctx, x0, cy, x1, cy, width + outline * 2, ink.ironDark);
  line(ctx, x0, cy, x1, cy, width, ink.iron);
  line(
    ctx,
    x0,
    cy - width * SHADE_OFFSET,
    x1,
    cy - width * SHADE_OFFSET,
    width * HIGHLIGHT_WIDTH,
    ink.ironLight,
  );
  const bore = cell * MAIN_BORE;
  line(ctx, x0, cy, x1, cy, bore, waterColour(surge));
  paintBands(ctx, x0, cy, x1, cy, cell, -inlet.w / cell, timeMs, bore);
  const flange: Rect = {
    x: x1 - cell * FLANGE_W,
    y: cy - cell * FLANGE_H * HALF,
    w: cell * FLANGE_W,
    h: cell * FLANGE_H,
  };
  ctx.fillStyle = ink.iron;
  ctx.fillRect(flange.x, flange.y, flange.w, flange.h);
  ctx.lineWidth = outline;
  ctx.strokeStyle = ink.ironDark;
  ctx.strokeRect(flange.x, flange.y, flange.w, flange.h);
  const r = cell * VALVE_RADIUS;
  ctx.beginPath();
  ctx.arc(valveX, valveY, r, 0, FULL_TURN);
  ctx.lineWidth = r * VALVE_RIM;
  ctx.strokeStyle = ink.valve;
  ctx.stroke();
  for (let spoke = 0; spoke < VALVE_SPOKES; spoke++) {
    const angle = (spoke / VALVE_SPOKES) * Math.PI;
    line(
      ctx,
      valveX - Math.cos(angle) * r,
      valveY - Math.sin(angle) * r,
      valveX + Math.cos(angle) * r,
      valveY + Math.sin(angle) * r,
      r * VALVE_RIM * HALF,
      ink.valveDark,
    );
  }
  disc(ctx, valveX, valveY, r * VALVE_RIM, ink.valveDark);
  ctx.restore();
}

/** Where the dial's sweep starts and how far it runs, clockwise from the left-bottom. */
const DIAL_START = THREE_QUARTER_TURN / 2;
const DIAL_SWEEP = THREE_QUARTER_TURN;
/** The share of the dial painted red; the green beyond it is reached only by a solved board. */
export const GAUGE_RED_SHARE = 0.8;
const GAUGE_RIM = 0.14;
const GAUGE_ZONE_RADIUS = 0.74;
const GAUGE_ZONE_WIDTH = 0.2;
const GAUGE_TICKS = 6;
const GAUGE_TICK_INNER = 0.52;
const GAUGE_TICK_OUTER = 0.62;
const GAUGE_NEEDLE = 0.78;
const GAUGE_NEEDLE_WIDTH = 0.09;
const GAUGE_HUB = 0.15;
const GAUGE_STEM_WIDTH = 0.12;

/** The pressure gauge on the main: the needle sits in the red until the board is solved. */
export function paintPressureGauge(
  ctx: CanvasRenderingContext2D,
  spot: PipeGaugeSpot,
  value: number,
  stemToY: number | null,
): void {
  const ink = pipeInk.gauge;
  const { cx, cy, r } = spot;
  ctx.save();
  if (stemToY !== null) {
    ctx.lineCap = 'butt';
    line(ctx, cx, cy + r, cx, stemToY, r * GAUGE_STEM_WIDTH * 2, pipeInk.main.ironDark);
  }
  disc(ctx, cx, cy, r, ink.rimDark);
  disc(ctx, cx, cy, r * (1 - GAUGE_RIM * HALF), ink.rim);
  disc(ctx, cx, cy, r * (1 - GAUGE_RIM), ink.face);
  ctx.lineCap = 'butt';
  ctx.lineWidth = r * GAUGE_ZONE_WIDTH;
  const redEnd = DIAL_START + DIAL_SWEEP * GAUGE_RED_SHARE;
  ctx.beginPath();
  ctx.arc(cx, cy, r * GAUGE_ZONE_RADIUS, DIAL_START, redEnd);
  ctx.strokeStyle = ink.redZone;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, r * GAUGE_ZONE_RADIUS, redEnd, DIAL_START + DIAL_SWEEP);
  ctx.strokeStyle = ink.greenZone;
  ctx.stroke();
  for (let tick = 0; tick <= GAUGE_TICKS; tick++) {
    const angle = DIAL_START + (tick / GAUGE_TICKS) * DIAL_SWEEP;
    line(
      ctx,
      cx + Math.cos(angle) * r * GAUGE_TICK_INNER,
      cy + Math.sin(angle) * r * GAUGE_TICK_INNER,
      cx + Math.cos(angle) * r * GAUGE_TICK_OUTER,
      cy + Math.sin(angle) * r * GAUGE_TICK_OUTER,
      Math.max(1, r * GAUGE_NEEDLE_WIDTH * HALF),
      ink.tick,
    );
  }
  const clamped = Math.min(1, Math.max(0, value));
  const angle = DIAL_START + clamped * DIAL_SWEEP;
  ctx.lineCap = 'round';
  line(
    ctx,
    cx,
    cy,
    cx + Math.cos(angle) * r * GAUGE_NEEDLE,
    cy + Math.sin(angle) * r * GAUGE_NEEDLE,
    Math.max(MIN_STROKE, r * GAUGE_NEEDLE_WIDTH),
    ink.needle,
  );
  disc(ctx, cx, cy, r * GAUGE_HUB, ink.needle);
  ctx.restore();
}

// ── The whole board ──────────────────────────────────────────────────────────

/** Paints a whole board frame: panel, puddles, main, tiles, sprays, fixtures, badges and gauge. */
export function paintPipeBoard(
  ctx: CanvasRenderingContext2D,
  geometry: PipeBoardGeometry,
  picture: PipeBoardPicture,
): void {
  const { timeMs } = picture;
  paintPipePanel(ctx, geometry);
  for (const fixture of picture.fixtures) {
    paintPipeFixture(
      ctx,
      pipeFixtureRect(geometry, fixture.fixture),
      fixture,
      geometry.cell,
      timeMs,
    );
  }
  paintWaterMain(ctx, geometry, picture.mainSurge, timeMs);
  picture.cells.forEach((cell, index) => {
    paintPipeTile(ctx, pipeCellRect(geometry, index), cell, timeMs);
  });
  for (const puddle of picture.puddles) {
    paintPuddle(ctx, pipeCellRect(geometry, puddle.cell), puddle.side, puddle.size, timeMs);
  }
  picture.cells.forEach((cell, index) => {
    if (cell.leaks === 0 || cell.spray <= 0) return;
    const rect = pipeCellRect(geometry, index);
    for (const side of SIDES) {
      if ((cell.leaks & side.bit) !== 0) paintLeakSpray(ctx, rect, side.bit, cell.spray, timeMs);
    }
  });
  picture.cells.forEach((cell, index) => {
    if (cell.leaks !== 0 && cell.spray > 0) paintTileBadge(ctx, pipeCellRect(geometry, index));
  });
  if (geometry.gauge !== null && picture.gauge !== null) {
    paintPressureGauge(
      ctx,
      geometry.gauge,
      picture.gauge,
      geometry.inlet.y + geometry.inlet.h * HALF,
    );
  }
}

// ── The win banner and the status icons ──────────────────────────────────────

const RIBBON_TAIL = 0.6;
const RIBBON_NOTCH = 0.35;
const RIBBON_DROP = 0.22;
const RIBBON_EDGE = 0.06;

/** The ribbon the "PLUMBING FIXED!" banner sits on; its words are set by the caller. */
export function paintPipeBanner(ctx: CanvasRenderingContext2D, rect: Rect): void {
  const ink = pipeInk.banner;
  const tail = rect.h * RIBBON_TAIL;
  const drop = rect.h * RIBBON_DROP;
  ctx.save();
  for (const sideSign of [-1, 1] as const) {
    const edge = sideSign < 0 ? rect.x : rect.x + rect.w;
    const outer = edge + sideSign * tail;
    ctx.beginPath();
    ctx.moveTo(edge, rect.y + drop);
    ctx.lineTo(outer, rect.y + drop);
    ctx.lineTo(outer - sideSign * tail * RIBBON_NOTCH, rect.y + drop + rect.h * HALF);
    ctx.lineTo(outer, rect.y + drop + rect.h);
    ctx.lineTo(edge, rect.y + drop + rect.h);
    ctx.closePath();
    ctx.fillStyle = ink.ribbonDark;
    ctx.fill();
  }
  ctx.fillStyle = ink.ribbon;
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.lineWidth = Math.max(1, rect.h * RIBBON_EDGE);
  ctx.strokeStyle = ink.ribbonEdge;
  const inset = rect.h * RIBBON_EDGE * 2;
  ctx.strokeRect(rect.x + inset, rect.y + inset, rect.w - inset * 2, rect.h - inset * 2);
  ctx.restore();
}

export type PipeCounterIcon = 'fixtures' | 'leaks';

const ICON_DROP_RADIUS = 0.26;
const ICON_DROP_Y = 0.6;

/** The pictures on the status strip's counters, drawn with the board's own art. */
export function paintPipeCounterIcon(
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  icon: PipeCounterIcon,
  atGoal: boolean,
): void {
  const s = Math.min(rect.w, rect.h);
  const square: Rect = { x: rect.x + (rect.w - s) / 2, y: rect.y + (rect.h - s) / 2, w: s, h: s };
  switch (icon) {
    case 'fixtures':
      paintToilet(ctx, square, porcelainFor(atGoal ? 1 : 0), atGoal ? 1 : 0, 0);
      return;
    case 'leaks':
      paintLeakBadge(ctx, square.x + s * HALF, square.y + s * ICON_DROP_Y, s * ICON_DROP_RADIUS);
      return;
  }
}

/** A tile picture with no water and nothing happening, for building pictures from. */
export function quietCellPicture(
  kind: PipeTileKind,
  mask: number,
  bolted: boolean,
): PipeCellPicture {
  return {
    kind,
    mask,
    spin: 0,
    bolted,
    water: 0,
    draining: false,
    inflow: 0,
    distance: 0,
    leaks: 0,
    spray: 0,
    shake: 0,
    surge: 0,
  };
}
