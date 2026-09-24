/**
 * Icons for the axe and pickaxe upgrade ladders.
 *
 * One silhouette painter per kind, parameterised by the tier's {@link ToolTierLook}
 * so all six rungs share a shape and differ only in what the look table says —
 * the same table the in-world tool overlay reads, so the icon and the tool a
 * crawler is carrying always agree.
 */

import type { ItemId } from '../../core/ItemDefs';
import {
  TOOL_TIER_BASIC,
  TOOL_TIER_DEEPWOOD,
  TOOL_TIER_GRAVEYARD,
  TOOL_TIER_HARDENED,
  TOOL_TIER_LONG_HAFT,
  TOOL_TIER_RATKIN_FORGE,
  TOOL_TIER_LOOKS,
  type ToolKind,
  type ToolTier,
  type ToolTierLook,
} from '../../core/toolTiers';

/** The twelve tool ids this module can draw. Closed, so a new tier cannot ship iconless. */
export type ToolIconId =
  | 'basic_axe'
  | 'hardened_axe'
  | 'lumberjacks_axe'
  | 'ratkin_forge_axe'
  | 'deepwood_cleaver'
  | 'graveyards_bane'
  | 'basic_pickaxe'
  | 'hardened_pickaxe'
  | 'quarrymans_pick'
  | 'ratkin_forge_pick'
  | 'stonebreaker'
  | 'worldscar_pick';

const TOOL_ICON_INFO: Record<ToolIconId, { kind: ToolKind; tier: ToolTier }> = {
  basic_axe: { kind: 'axe', tier: TOOL_TIER_BASIC },
  hardened_axe: { kind: 'axe', tier: TOOL_TIER_HARDENED },
  lumberjacks_axe: { kind: 'axe', tier: TOOL_TIER_LONG_HAFT },
  ratkin_forge_axe: { kind: 'axe', tier: TOOL_TIER_RATKIN_FORGE },
  deepwood_cleaver: { kind: 'axe', tier: TOOL_TIER_DEEPWOOD },
  graveyards_bane: { kind: 'axe', tier: TOOL_TIER_GRAVEYARD },
  basic_pickaxe: { kind: 'pickaxe', tier: TOOL_TIER_BASIC },
  hardened_pickaxe: { kind: 'pickaxe', tier: TOOL_TIER_HARDENED },
  quarrymans_pick: { kind: 'pickaxe', tier: TOOL_TIER_LONG_HAFT },
  ratkin_forge_pick: { kind: 'pickaxe', tier: TOOL_TIER_RATKIN_FORGE },
  stonebreaker: { kind: 'pickaxe', tier: TOOL_TIER_DEEPWOOD },
  worldscar_pick: { kind: 'pickaxe', tier: TOOL_TIER_GRAVEYARD },
};

/** Every id this module can draw, the single source of truth for the id set below and for the icon bake gate. */
export const TOOL_ICON_ID_LIST: readonly ToolIconId[] = [
  'basic_axe',
  'hardened_axe',
  'lumberjacks_axe',
  'ratkin_forge_axe',
  'deepwood_cleaver',
  'graveyards_bane',
  'basic_pickaxe',
  'hardened_pickaxe',
  'quarrymans_pick',
  'ratkin_forge_pick',
  'stonebreaker',
  'worldscar_pick',
];

const TOOL_ICON_IDS: ReadonlySet<string> = new Set<ToolIconId>(TOOL_ICON_ID_LIST);

/** Whether `id` is a tool, and so drawable by {@link drawToolIcon}. */
export function isToolIconId(id: ItemId): id is ToolIconId {
  return TOOL_ICON_IDS.has(id);
}

const FULL_CIRCLE = Math.PI * 2;
const OUTLINE = '#1c1712';
const OUTLINE_WIDTH = 1;
const THIN_LINE_WIDTH = 1;
/**
 * A pale, low-alpha rim stroked wider than the dark outline and under it. The
 * darkest tiers (deepwood, graveyard) come close to whatever background the
 * icon sits on, and without this the head all but disappears at hotbar size.
 */
const RIM_COLOR = 'rgba(226,232,240,0.4)';
const RIM_LINE_WIDTH = 2.5;

/** Fills the current path, then outlines it with the pale rim followed by the dark outline. */
function fillAndOutline(ctx: CanvasRenderingContext2D, fill: string): void {
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = RIM_COLOR;
  ctx.lineWidth = RIM_LINE_WIDTH;
  ctx.stroke();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = OUTLINE_WIDTH;
  ctx.stroke();
}

/**
 * Haft geometry, in local space with the origin at the haft's bottom end and
 * +x running up the handle. Shorter than the head is wide, on purpose — the
 * head is the part that has to be identified at hotbar size, so it is the
 * dominant shape rather than a small cap on a long thin line.
 */
const HAFT_LENGTH = 0.46;
/**
 * Tier 2's long-handled variants reach further up the icon. The delta has to
 * be large enough to read as "a longer handle" at hotbar size on its own,
 * since tier 2 shares its head colour with tier 1 and length is its only cue.
 */
const HAFT_LENGTH_LONG = 0.58;
const HAFT_WIDTH = 0.08;
/**
 * Radians the whole tool leans off vertical. Close to vertical rather than the
 * ~30° a held tool actually rakes at, because the head's own reach beyond the
 * haft's tip pushes the tip corner outward again — a shallower lean is what
 * keeps that corner inside the icon square instead of clipped by its own cell.
 */
const TOOL_LEAN = -1.15;
const ORIGIN_X = 0.5;
const ORIGIN_Y = 0.86;

/** A small knot mark near the head mount, for a tier whose look sets `accent`. */
const ACCENT_OFFSET_X = -0.02;
const ACCENT_OFFSET_Y = 0.03;
const ACCENT_R = 0.045;

const GLOW_BLUR = 5;
/** The glow line covers the haft's last stretch below the head, not its full length. */
const GLOW_STROKE_START_FRACTION = 0.6;

// Axe head: a straight-edged wedge, flat where it meets the haft.
const AXE_HEAD_BACK_INSET = 0.025;
const AXE_HEAD_BACK_TOP_Y = 0.225;
const AXE_HEAD_BACK_BOTTOM_Y = 0.15;
const AXE_HEAD_TIP_X = 0.275;
const AXE_HEAD_TIP_Y = 0.025;
/** The shoulder is the wedge's widest corner, between the back and the tip. */
const AXE_HEAD_TOP_CONTROL_X = 0.25;
const AXE_HEAD_TOP_CONTROL_Y = 0.3;
const AXE_EDGE_WIDTH_FRACTION = 0.07;

/**
 * Pick head: one curved bar mounted crosswise on the haft — perpendicular to
 * it in local space, so the rotated icon reads as a head crossing the handle
 * rather than as a second segment continuing the handle's own line. It tapers
 * to a point at each end and bulges forward (the same direction the axe's
 * wedge points) in the middle, the shape that reads as "pick" rather than
 * "double-bitted axe" even when the two silhouettes are drawn at the same
 * head colour and mount point.
 */
const PICK_HEAD_HALF_SPAN = 0.31;
/** How far the curve's leading (outer) edge bulges forward from the mount, at the head's midpoint. */
const PICK_HEAD_OUTER_BULGE = 0.24;
/** How far the trailing (inner) edge bulges, giving the bar its thickness without meeting the outer edge except at the tips. */
const PICK_HEAD_INNER_BULGE = 0.075;
/** Bezier control points sit this fraction of the half-span out from each tip, tuning how full the curve reads. */
const PICK_HEAD_CONTROL_FRACTION = 0.55;
const PICK_SOCKET_R = 0.075;
const PICK_EDGE_WIDTH_FRACTION = 0.06;

function drawHaft(
  ctx: CanvasRenderingContext2D,
  length: number,
  width: number,
  color: string,
): void {
  ctx.beginPath();
  ctx.moveTo(0, -width);
  ctx.lineTo(length, -width);
  ctx.lineTo(length, width);
  ctx.lineTo(0, width);
  ctx.closePath();
  fillAndOutline(ctx, color);
}

function drawAxeHead(
  ctx: CanvasRenderingContext2D,
  mountX: number,
  look: ToolTierLook,
  scale: number,
): void {
  // Straight edges rather than a curved bulge: a triangular wedge keeps its
  // point crisp when downsampled to hotbar size, where a shallow quadratic
  // curve softens into a blob and the axe stops reading as pointed at all.
  const backTop = { x: mountX - scale * AXE_HEAD_BACK_INSET, y: -scale * AXE_HEAD_BACK_TOP_Y };
  const backBottom = {
    x: mountX - scale * AXE_HEAD_BACK_INSET,
    y: scale * AXE_HEAD_BACK_BOTTOM_Y,
  };
  const tip = { x: mountX + scale * AXE_HEAD_TIP_X, y: -scale * AXE_HEAD_TIP_Y };
  const shoulder = {
    x: mountX + scale * AXE_HEAD_TOP_CONTROL_X,
    y: -scale * AXE_HEAD_TOP_CONTROL_Y,
  };

  ctx.beginPath();
  ctx.moveTo(backTop.x, backTop.y);
  ctx.lineTo(shoulder.x, shoulder.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.lineTo(backBottom.x, backBottom.y);
  ctx.closePath();
  fillAndOutline(ctx, look.headColor);

  // The sharpened edge: a thin sliver along the shoulder-to-tip edge.
  ctx.strokeStyle = look.edgeColor;
  ctx.lineWidth = Math.max(THIN_LINE_WIDTH, scale * AXE_EDGE_WIDTH_FRACTION);
  ctx.beginPath();
  ctx.moveTo(shoulder.x, shoulder.y);
  ctx.lineTo(tip.x, tip.y);
  ctx.stroke();
}

/**
 * The pick head: a single curved bar spanning `±half` in local `y` from the
 * mount, tapering to a point at each tip and bulging forward in `+x` at its
 * midpoint. Traced as two bezier curves sharing the same tips — the outer
 * (leading) curve and the inner (trailing) curve — so the bar has visible
 * thickness at its middle and none at its points, the shape a real pick's
 * head profile makes.
 */
function drawPickHead(
  ctx: CanvasRenderingContext2D,
  mountX: number,
  look: ToolTierLook,
  scale: number,
): void {
  const half = scale * PICK_HEAD_HALF_SPAN;
  const outerBulge = scale * PICK_HEAD_OUTER_BULGE;
  const innerBulge = scale * PICK_HEAD_INNER_BULGE;
  const controlY = half * PICK_HEAD_CONTROL_FRACTION;
  const topTip = { x: mountX, y: -half };
  const bottomTip = { x: mountX, y: half };

  ctx.beginPath();
  ctx.moveTo(topTip.x, topTip.y);
  ctx.bezierCurveTo(
    mountX + outerBulge,
    -controlY,
    mountX + outerBulge,
    controlY,
    bottomTip.x,
    bottomTip.y,
  );
  ctx.bezierCurveTo(
    mountX + innerBulge,
    controlY,
    mountX + innerBulge,
    -controlY,
    topTip.x,
    topTip.y,
  );
  ctx.closePath();
  fillAndOutline(ctx, look.headColor);

  // The sharpened leading edge, traced again as a highlight over the outer curve.
  ctx.strokeStyle = look.edgeColor;
  ctx.lineWidth = Math.max(THIN_LINE_WIDTH, scale * PICK_EDGE_WIDTH_FRACTION);
  ctx.beginPath();
  ctx.moveTo(topTip.x, topTip.y);
  ctx.bezierCurveTo(
    mountX + outerBulge,
    -controlY,
    mountX + outerBulge,
    controlY,
    bottomTip.x,
    bottomTip.y,
  );
  ctx.stroke();

  ctx.fillStyle = OUTLINE;
  ctx.beginPath();
  ctx.arc(
    mountX + innerBulge * PICK_HEAD_CONTROL_FRACTION,
    0,
    scale * PICK_SOCKET_R,
    0,
    FULL_CIRCLE,
  );
  ctx.fill();
}

function drawTool(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  kind: ToolKind,
  look: ToolTierLook,
): void {
  const haftLength = size * (look.longHaft === true ? HAFT_LENGTH_LONG : HAFT_LENGTH);
  const haftWidth = size * HAFT_WIDTH;

  ctx.save();
  ctx.translate(x + size * ORIGIN_X, y + size * ORIGIN_Y);
  ctx.rotate(TOOL_LEAN);

  drawHaft(ctx, haftLength, haftWidth, look.hafColor);

  if (look.glow !== undefined) {
    ctx.save();
    ctx.shadowColor = look.glow;
    ctx.shadowBlur = GLOW_BLUR;
    ctx.strokeStyle = look.glow;
    ctx.lineWidth = THIN_LINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(haftLength * GLOW_STROKE_START_FRACTION, -haftWidth);
    ctx.lineTo(haftLength, -haftWidth);
    ctx.stroke();
    ctx.restore();
  }

  if (kind === 'axe') drawAxeHead(ctx, haftLength, look, size);
  else drawPickHead(ctx, haftLength, look, size);

  if (look.accent !== undefined) {
    ctx.fillStyle = look.accent;
    ctx.beginPath();
    ctx.arc(
      haftLength + size * ACCENT_OFFSET_X,
      size * ACCENT_OFFSET_Y,
      size * ACCENT_R,
      0,
      FULL_CIRCLE,
    );
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = OUTLINE_WIDTH;
    ctx.stroke();
  }

  ctx.restore();
}

/** Draws one tool's icon into a square icon region at `x`,`y`. */
export function drawToolIcon(
  ctx: CanvasRenderingContext2D,
  id: ToolIconId,
  x: number,
  y: number,
  size: number,
): void {
  const { kind, tier } = TOOL_ICON_INFO[id];
  const look = TOOL_TIER_LOOKS[tier];

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  drawTool(ctx, x, y, size, kind, look);
  ctx.restore();
}
