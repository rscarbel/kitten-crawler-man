/**
 * The axe and the pick a crawler works a resource node with, painted in the
 * rig units Carl is authored in, for every tier's look.
 *
 * Painted in one canonical frame: the butt fist's grip at the origin, the
 * haft running along +X to the head, and the side of the head that leads a
 * clockwise swing — the axe's blade, the pick's point — toward +Y. Whoever
 * draws it rotates that frame onto a fist and reflects it for a swing that
 * turns the other way.
 *
 * Silhouette first: at the 32 px tile the haft is two pixels and the head six
 * or seven, so the tiers are told apart by the head's size and its colours
 * (and tier 2's longer haft), never by detail inside the head.
 */

import { type ToolKind, type ToolTier, TOOL_TIER_LOOKS } from '../../core/toolTiers';
import { mix, rgba } from './carlArt';

type Ctx = CanvasRenderingContext2D;

/** Haft from the butt fist to the head, rig units. */
const HAFT_LENGTH = 0.84;
/** Tier 2's felling axe and quarry pick are long-handled. */
const LONG_HAFT_LENGTH = 1.0;
/** How far the haft runs on below the butt fist, ending in a swelled knob. */
export const TOOL_KNOB_LENGTH = 0.05;
const KNOB_HALF = 0.03;
const HAFT_HALF = 0.026;
/**
 * Each tier's head is drawn this much bigger than the last: the one cue that
 * survives the tile when two tiers' colours sit close together.
 */
const HEAD_GROWTH_PER_TIER = 0.06;

/**
 * The axe head: a bearded blade. Its top runs nearly square off the eye, its
 * beard sweeps back down toward the fists, and the edge between them bellies
 * out — the asymmetry is what says axe at the tile; a blade flaring evenly
 * from the eye reads as a bell.
 */
const AXE_EYE_HALF = 0.045;
const AXE_BLADE_REACH = 0.22;
/** How far the edge's top corner stands ahead of the eye's centre, along the haft. */
const AXE_TOE_AHEAD = 0.075;
/** How far the beard's corner hangs back toward the fists. */
const AXE_BEARD_BACK = 0.2;
/** How far the edge bellies out past the line between its corners. */
const AXE_EDGE_BELLY = 0.05;
/** The beard's hollow: how far up the blade its curve is pulled in toward the eye. */
const AXE_BEARD_HOLLOW = 0.55;
/** The butt of the head behind the eye, on the trailing side. */
const AXE_POLL_REACH = 0.06;
/** Where the head sits, back from the haft's end. */
const HEAD_SET_BACK = 0.045;
/** The honed edge, stroked this wide along the blade's rim inside the head. */
const EDGE_BAND_WIDTH = 0.1;

/** The pick head: a bar across the haft, a point on the leading side and a chisel trailing. */
const PICK_POINT_REACH = 0.32;
const PICK_CHISEL_REACH = 0.22;
const PICK_BAR_HALF = 0.042;
/** Both arms of the head sweep back toward the fists, as a pick's do. */
const PICK_SWEEP = 0.08;
const PICK_CHISEL_HALF = 0.034;
/**
 * Control points of the pick head's curved flanks, as shares of the bar's
 * half-width and of each arm's reach: the arms taper from the eye to the tips.
 */
const PICK_CHISEL_FLANK_REACH = 0.6;
const PICK_CHISEL_INNER_REACH = 0.5;
const PICK_POINT_FLANK_REACH = 0.55;
const PICK_FRONT_FLANK_WIDTH = 0.6;
const PICK_POINT_FLANK_WIDTH = 0.8;

/** A dark rim round every part, so a steel head never dissolves into grey rock or a brown trunk. */
const TOOL_OUTLINE = '#1b120c';
const OUTLINE_WIDTH = 0.022;
const HAFT_HIGHLIGHT_ALPHA = 0.45;
const HAFT_HIGHLIGHT_OFFSET = -0.008;
const HAFT_HIGHLIGHT_WIDTH = 0.01;
/** The knob is the haft's wood a shade darker, worn by the hand. */
const KNOB_DARKEN = 0.35;
const DARK = '#000000';
const FULL_TURN = Math.PI * 2;
const LIGHT = '#ffffff';
/** The head's shaded half, and its lit rim. */
const HEAD_SHADE = 0.3;
const HEAD_RIM = 0.3;
const GLOW_ALPHA = 0.85;
const GLOW_WIDTH = 0.018;
const GLOW_HALO_WIDTH = 0.05;
const GLOW_HALO_ALPHA = 0.3;
/** The briar-knot notches of the forge tier, and the deep tier's sheen, laid on the head. */
const ACCENT_WIDTH = 0.02;
/** The two accent strokes cross the eye at these distances either side of the haft. */
const ACCENT_NEAR = 0.03;
const ACCENT_FAR = 0.12;
/** The shade fill is oversized so the head's clip, not the rectangle, is what ends it. */
const SHADE_OVERSIZE = 2;
const ACCENT_ALPHA = 0.9;

/** How long a tier's haft is, butt fist to head. */
export function toolHaftLength(tier: ToolTier): number {
  return TOOL_TIER_LOOKS[tier].longHaft === true ? LONG_HAFT_LENGTH : HAFT_LENGTH;
}

/**
 * The long-hafted felling tier carries a bigger head too: its haft alone is
 * too thin a difference to tell it from the basic tier at the tile.
 */
const LONG_HAFT_HEAD_BONUS = 0.14;

function headScale(tier: ToolTier): number {
  const longHaftBonus = TOOL_TIER_LOOKS[tier].longHaft === true ? LONG_HAFT_HEAD_BONUS : 0;
  return 1 + HEAD_GROWTH_PER_TIER * tier + longHaftBonus;
}

/**
 * The farthest any ink of the tool lies from its grip across the haft, in rig
 * units: what a surface it is cached on has to leave room for either side.
 */
export function toolHalfBreadth(tier: ToolTier): number {
  return (
    (Math.max(AXE_BLADE_REACH + AXE_EDGE_BELLY, PICK_POINT_REACH) + OUTLINE_WIDTH) * headScale(tier)
  );
}

/** The tool's full extent along the haft, from the knob's end to past the head. */
export function toolReachAlongHaft(tier: ToolTier): { back: number; ahead: number } {
  return {
    back: TOOL_KNOB_LENGTH + KNOB_HALF + OUTLINE_WIDTH,
    ahead: toolHaftLength(tier) + (AXE_TOE_AHEAD + OUTLINE_WIDTH) * headScale(tier),
  };
}

function strokeAndFill(ctx: Ctx, fill: string): void {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = TOOL_OUTLINE;
  // Stroked on the path's centre line, so half of it lies under the fill.
  ctx.lineWidth = OUTLINE_WIDTH + OUTLINE_WIDTH;
  ctx.stroke();
  ctx.fillStyle = fill;
  ctx.fill();
}

function paintHaft(ctx: Ctx, length: number, wood: string): void {
  const butt = -TOOL_KNOB_LENGTH;
  ctx.beginPath();
  ctx.moveTo(butt, -HAFT_HALF);
  ctx.lineTo(length, -HAFT_HALF);
  ctx.lineTo(length, HAFT_HALF);
  ctx.lineTo(butt, HAFT_HALF);
  ctx.closePath();
  ctx.moveTo(butt + KNOB_HALF, 0);
  ctx.arc(butt, 0, KNOB_HALF, 0, FULL_TURN);
  strokeAndFill(ctx, wood);
  // The knob again without its outline, so the haft's seam into it vanishes.
  ctx.beginPath();
  ctx.arc(butt, 0, KNOB_HALF, 0, FULL_TURN);
  ctx.fillStyle = mix(wood, DARK, KNOB_DARKEN);
  ctx.fill();
  ctx.fillStyle = wood;
  ctx.fillRect(butt, -HAFT_HALF, length - butt, HAFT_HALF + HAFT_HALF);
  ctx.strokeStyle = rgba(LIGHT, HAFT_HIGHLIGHT_ALPHA);
  ctx.lineWidth = HAFT_HIGHLIGHT_WIDTH;
  ctx.beginPath();
  ctx.moveTo(butt + KNOB_HALF, HAFT_HIGHLIGHT_OFFSET);
  ctx.lineTo(length, HAFT_HIGHLIGHT_OFFSET);
  ctx.stroke();
}

function traceAxeEdgeArc(ctx: Ctx, eyeX: number, s: number): void {
  const toe = { x: eyeX + AXE_TOE_AHEAD * s, y: AXE_BLADE_REACH * s };
  const beard = { x: eyeX - AXE_BEARD_BACK * s, y: AXE_BLADE_REACH * s };
  ctx.moveTo(toe.x, toe.y);
  ctx.quadraticCurveTo(
    (toe.x + beard.x) / 2,
    (AXE_BLADE_REACH + AXE_EDGE_BELLY + AXE_EDGE_BELLY) * s,
    beard.x,
    beard.y,
  );
}

function traceAxeHead(ctx: Ctx, eyeX: number, s: number): void {
  ctx.beginPath();
  ctx.moveTo(eyeX - AXE_EYE_HALF * s, -AXE_POLL_REACH * s);
  ctx.lineTo(eyeX + AXE_EYE_HALF * s, -AXE_POLL_REACH * s);
  ctx.lineTo(eyeX + AXE_EYE_HALF * s, 0);
  ctx.lineTo(eyeX + AXE_TOE_AHEAD * s, AXE_BLADE_REACH * s);
  ctx.quadraticCurveTo(
    eyeX - (AXE_BEARD_BACK * s) / 2,
    (AXE_BLADE_REACH + AXE_EDGE_BELLY + AXE_EDGE_BELLY) * s,
    eyeX - AXE_BEARD_BACK * s,
    AXE_BLADE_REACH * s,
  );
  ctx.quadraticCurveTo(
    eyeX - AXE_EYE_HALF * s,
    AXE_BLADE_REACH * s * AXE_BEARD_HOLLOW,
    eyeX - AXE_EYE_HALF * s,
    0,
  );
  ctx.closePath();
}

function tracePickHead(ctx: Ctx, eyeX: number, s: number): void {
  const pointY = PICK_POINT_REACH * s;
  const chiselY = -PICK_CHISEL_REACH * s;
  const bar = PICK_BAR_HALF * s;
  const sweep = PICK_SWEEP * s;
  ctx.beginPath();
  ctx.moveTo(eyeX + bar, -bar);
  ctx.quadraticCurveTo(
    eyeX + bar * PICK_FRONT_FLANK_WIDTH,
    chiselY * PICK_CHISEL_FLANK_REACH,
    eyeX - sweep + PICK_CHISEL_HALF * s,
    chiselY,
  );
  ctx.lineTo(eyeX - sweep - PICK_CHISEL_HALF * s, chiselY);
  ctx.quadraticCurveTo(eyeX - bar, chiselY * PICK_CHISEL_INNER_REACH, eyeX - bar, -bar);
  ctx.lineTo(eyeX - bar, bar);
  ctx.quadraticCurveTo(eyeX - bar, pointY * PICK_POINT_FLANK_REACH, eyeX - sweep, pointY);
  ctx.quadraticCurveTo(
    eyeX + bar * PICK_POINT_FLANK_WIDTH,
    pointY * PICK_POINT_FLANK_REACH,
    eyeX + bar,
    bar,
  );
  ctx.closePath();
}

/**
 * Paints one tool in rig units into `ctx`'s current frame (the canonical
 * frame described in the module doc). Deterministic in its arguments; sets
 * every style it uses.
 */
export function paintTool(ctx: Ctx, kind: ToolKind, tier: ToolTier): void {
  const look = TOOL_TIER_LOOKS[tier];
  const length = toolHaftLength(tier);
  const s = headScale(tier);
  const eyeX = length - HEAD_SET_BACK * s;
  ctx.save();
  paintHaft(ctx, length, look.hafColor);

  const traceHead = (): void => {
    if (kind === 'axe') traceAxeHead(ctx, eyeX, s);
    else tracePickHead(ctx, eyeX, s);
  };
  traceHead();
  strokeAndFill(ctx, look.headColor);
  // Light from the upper left of the canonical frame: the trailing half of the
  // head in shade, a lit rim along its leading face.
  ctx.save();
  traceHead();
  ctx.clip();
  ctx.fillStyle = rgba(mix(look.headColor, DARK, HEAD_SHADE), 1);
  const shadeReach = toolHalfBreadth(tier) * SHADE_OVERSIZE;
  ctx.fillRect(eyeX, -shadeReach, shadeReach, shadeReach + shadeReach);
  if (kind === 'axe') {
    ctx.beginPath();
    traceAxeEdgeArc(ctx, eyeX, s);
    ctx.strokeStyle = look.edgeColor;
    ctx.lineWidth = EDGE_BAND_WIDTH * s;
    ctx.stroke();
  } else {
    ctx.strokeStyle = mix(look.edgeColor, LIGHT, HEAD_RIM);
    ctx.lineWidth = OUTLINE_WIDTH;
    ctx.beginPath();
    ctx.moveTo(eyeX - PICK_BAR_HALF * s, -PICK_CHISEL_REACH * s);
    ctx.lineTo(eyeX - PICK_BAR_HALF * s, PICK_POINT_REACH * s);
    ctx.stroke();
  }
  if (look.accent !== undefined) {
    ctx.strokeStyle = rgba(look.accent, ACCENT_ALPHA);
    ctx.lineWidth = ACCENT_WIDTH * s;
    ctx.beginPath();
    ctx.moveTo(eyeX - AXE_EYE_HALF * s, ACCENT_NEAR * s);
    ctx.lineTo(eyeX + AXE_EYE_HALF * s, ACCENT_FAR * s);
    ctx.moveTo(eyeX - AXE_EYE_HALF * s, -ACCENT_NEAR * s);
    ctx.lineTo(eyeX + AXE_EYE_HALF * s, 0);
    ctx.stroke();
  }
  ctx.restore();

  if (look.glow !== undefined) {
    const tipY = (kind === 'axe' ? AXE_BLADE_REACH : PICK_POINT_REACH) * s;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(eyeX, 0);
    ctx.lineTo(eyeX, tipY);
    ctx.strokeStyle = rgba(look.glow, GLOW_HALO_ALPHA);
    ctx.lineWidth = GLOW_HALO_WIDTH * s;
    ctx.stroke();
    ctx.strokeStyle = rgba(look.glow, GLOW_ALPHA);
    ctx.lineWidth = GLOW_WIDTH * s;
    ctx.stroke();
  }
  ctx.restore();
}
