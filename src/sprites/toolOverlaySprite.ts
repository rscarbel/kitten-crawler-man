/**
 * The axe or pick in Carl's fists while he works a resource node, and the
 * same tool in any other worker's hands.
 *
 * It cannot be a held prop painted inside his figure: a cell is shared by
 * every tier of tool, and the tier is what the player upgrades and expects to
 * see. It is drawn over (or, seen from behind, under) the finished figure
 * instead, along the line his two fists make on the drawn cell — from the
 * fist the row names as holding the butt (his left unless it says otherwise)
 * through the other — read off the same solved rig the painter draws, so the
 * tool can never drift out of his hands.
 */

import { allocCanvas, type CanvasSurface, surfaceContext } from '../core/canvasSurface';
import { type ToolKind, type ToolTier } from '../core/toolTiers';
import { type Pt } from './art/carlArt';
import type { BodySide } from './art/carl/rig';
import { HUMAN_CELL_PX_PER_UNIT, HUMAN_SCALE } from './art/human/figureScale';
import { TOOL_GRIP_SPACING } from './art/human/actionsGather';
import { handGripInTile } from './art/human/probe';
import {
  CHOP_ROWS,
  eventFrame,
  HUMAN_ROW_TABLE,
  type HumanRowMeta,
  type HumanRowName,
  MINE_ROWS,
} from './art/humanFigure';
import { paintTool, toolHalfBreadth, toolReachAlongHaft } from './art/toolArt';
import type { HumanRowSelection } from './humanSprite';

/** Where the tool goes on one drawn cell. */
export interface ToolOverlayPlacement {
  /** The butt fist's grip, in tile fractions from the sprite's tile origin. */
  readonly grip: Pt;
  /** The way the haft points from the butt toward the head, radians on screen (y down). */
  readonly haftAngle: number;
  /**
   * How much of the haft's length shows, 0–1: under 1 while it swings toward
   * or away from the camera, read off how close together the fists are drawn.
   */
  readonly lengthShare: number;
  /** Reflected across the haft, for a swing that turns anticlockwise on screen. */
  readonly mirrored: boolean;
  /** Drawn before the figure, which then covers it with his body. */
  readonly behindFigure: boolean;
}

/** Every row the overlay draws on. Any other row he plays shows no tool. */
const TOOL_ROWS: ReadonlySet<HumanRowName> = new Set([
  ...Object.values(CHOP_ROWS),
  ...Object.values(MINE_ROWS),
]);

/**
 * The least share of the haft ever drawn: a haft pointing straight at the
 * camera still shows its head, and a zero-length draw would make the head
 * vanish for a frame mid-swing.
 */
const MIN_LENGTH_SHARE = 0.3;
/** How far apart his grips are drawn, in tiles, with the haft lying flat in the picture. */
const FLAT_GRIP_SPACING_TILES = TOOL_GRIP_SPACING * HUMAN_SCALE;

interface CellHaft {
  readonly grip: Pt;
  readonly upper: Pt;
  readonly behind: boolean;
}

/** The fist at the butt on a row that names none. */
const DEFAULT_TOOL_BUTT: BodySide = 'left';

const haftByCell = new Map<string, CellHaft>();

function cellHaft(row: HumanRowName, frame: number, flipX: boolean): CellHaft {
  const cacheKey = `${row}:${frame}:${String(flipX)}`;
  const known = haftByCell.get(cacheKey);
  if (known !== undefined) return known;
  const meta: HumanRowMeta = HUMAN_ROW_TABLE[row];
  const buttSide = meta.toolButt?.[frame] ?? DEFAULT_TOOL_BUTT;
  const butt = handGripInTile(row, frame, flipX, buttSide);
  const upper = handGripInTile(row, frame, flipX, buttSide === 'left' ? 'right' : 'left');
  // The upper fist's arm decides the layer: in profile, with his left fist at
  // the butt, it is the near arm, over his body; from behind both arms are
  // flagged behind him.
  const found = { grip: butt.centre, upper: upper.centre, behind: upper.armBehind };
  haftByCell.set(cacheKey, found);
  return found;
}

function haftAngleOf(haft: CellHaft): number {
  return Math.atan2(haft.upper.y - haft.grip.y, haft.upper.x - haft.grip.x);
}

function spacingOf(haft: CellHaft): number {
  return Math.hypot(haft.upper.x - haft.grip.x, haft.upper.y - haft.grip.y);
}

interface RowHaft {
  /** Which way the head turns into the blow, which sets the side the blade leads on. */
  readonly anticlockwise: boolean;
}

const rowHaftCache = new Map<string, RowHaft>();

/** The smallest signed turn from angle `a` to angle `b`. */
function turnBetween(a: number, b: number): number {
  const full = Math.PI * 2;
  return ((((b - a + Math.PI) % full) + full) % full) - Math.PI;
}

function rowHaft(row: HumanRowName, flipX: boolean): RowHaft {
  const cacheKey = `${row}:${String(flipX)}`;
  const known = rowHaftCache.get(cacheKey);
  if (known !== undefined) return known;
  const meta = HUMAN_ROW_TABLE[row];
  const impact = eventFrame(row, 'impact') ?? 0;
  const before = (impact - 1 + meta.frameCount) % meta.frameCount;
  const turn = turnBetween(
    haftAngleOf(cellHaft(row, before, flipX)),
    haftAngleOf(cellHaft(row, impact, flipX)),
  );
  const found = { anticlockwise: turn < 0 };
  rowHaftCache.set(cacheKey, found);
  return found;
}

/**
 * Where the working tool goes on the cell being drawn, or null for a row that
 * is not a swing at a resource node.
 */
export function toolOverlayOf(selection: HumanRowSelection): ToolOverlayPlacement | null {
  if (!TOOL_ROWS.has(selection.row)) return null;
  const haft = cellHaft(selection.row, selection.frame, selection.flipX);
  const whole = rowHaft(selection.row, selection.flipX);
  const share = spacingOf(haft) / FLAT_GRIP_SPACING_TILES;
  return {
    grip: haft.grip,
    haftAngle: haftAngleOf(haft),
    lengthShare: Math.max(MIN_LENGTH_SHARE, Math.min(1, share)),
    mirrored: whole.anticlockwise,
    behindFigure: haft.behind,
  };
}

// ── Painting ─────────────────────────────────────────────────────────────────

/** Density the tool is cached at over a cell's own, so a two-pixel haft survives the rotated blit. */
const TOOL_SUPERSAMPLE = 2;
const SURFACE_UNITS_TO_PX = HUMAN_CELL_PX_PER_UNIT * TOOL_SUPERSAMPLE;

interface ToolSurface {
  readonly surface: CanvasSurface;
  /** Where the butt grip sits on the surface, in surface pixels. */
  readonly originX: number;
  readonly originY: number;
}

const surfaceByLook = new Map<string, ToolSurface>();

/** One tier of one tool, painted once and reused for every frame and every worker. */
function toolSurface(kind: ToolKind, tier: ToolTier): ToolSurface {
  const cacheKey = `${kind}:${tier}`;
  const known = surfaceByLook.get(cacheKey);
  if (known !== undefined) return known;
  const along = toolReachAlongHaft(tier);
  const breadth = toolHalfBreadth(tier);
  const width = Math.ceil((along.back + along.ahead) * SURFACE_UNITS_TO_PX);
  const height = Math.ceil(2 * breadth * SURFACE_UNITS_TO_PX);
  const surface = allocCanvas(width, height);
  const ctx = surfaceContext(surface);
  const originX = along.back * SURFACE_UNITS_TO_PX;
  const originY = height / 2;
  ctx.translate(originX, originY);
  ctx.scale(SURFACE_UNITS_TO_PX, SURFACE_UNITS_TO_PX);
  paintTool(ctx, kind, tier);
  const found = { surface, originX, originY };
  surfaceByLook.set(cacheKey, found);
  return found;
}

/**
 * Draws a tool with its butt grip at screen (`gripX`, `gripY`), the haft
 * pointing along `haftAngle` (radians, y down), at the size it is in Carl's
 * hands on a `tileSize`-pixel tile. `mirrored` puts the blade on the other
 * side of the haft, for a swing turning anticlockwise; `lengthShare` draws
 * the haft short, turned toward or away from the camera.
 */
export function drawToolAt(
  ctx: CanvasRenderingContext2D,
  kind: ToolKind,
  tier: ToolTier,
  gripX: number,
  gripY: number,
  haftAngle: number,
  tileSize: number,
  mirrored = false,
  lengthShare = 1,
): void {
  const tool = toolSurface(kind, tier);
  const pxPerSurfacePx = (HUMAN_SCALE * tileSize) / SURFACE_UNITS_TO_PX;
  ctx.save();
  ctx.translate(gripX, gripY);
  ctx.rotate(haftAngle);
  ctx.scale(pxPerSurfacePx * lengthShare, mirrored ? -pxPerSurfacePx : pxPerSurfacePx);
  ctx.drawImage(tool.surface, -tool.originX, -tool.originY);
  ctx.restore();
}

/**
 * Draws the working tool on the cell being drawn, with the sprite's tile
 * origin at (`sx`, `sy`) and a `tileSize`-pixel tile.
 */
export function drawToolOverlay(
  ctx: CanvasRenderingContext2D,
  kind: ToolKind,
  tier: ToolTier,
  placement: ToolOverlayPlacement,
  sx: number,
  sy: number,
  tileSize: number,
): void {
  drawToolAt(
    ctx,
    kind,
    tier,
    sx + placement.grip.x * tileSize,
    sy + placement.grip.y * tileSize,
    placement.haftAngle,
    tileSize,
    placement.mirrored,
    placement.lengthShare,
  );
}
