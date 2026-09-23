/**
 * One plank of a barricade, the board he braces while he nails it down: the
 * same golden pine as the boarded-up grates it becomes, so the board in his
 * hands and the barricade on the floor read as one material.
 *
 * Where it lies depends on the view, because it is always the board in front
 * of him that he is working on:
 *
 * - Head-on, from either side, it is held level across the front of him at the
 *   gripping hand's height, running from just outboard of that fist across
 *   toward his other hand. Neither view can show depth, so a board lying on
 *   the floor ahead of him would have to be drawn below his feet, where no
 *   hand of his can reach it on screen.
 * - In profile it lies on the floor ahead of him, at {@link FLOOR_BOARD}, and
 *   is not moved by the hand it is hung on at all. The hook only paints a prop
 *   in a gripping hand, and the board has to stay on the floor while both his
 *   hands come off it; the choreography aims his hands at `FLOOR_BOARD`
 *   instead.
 *
 * Flat fills and two edge bands rather than `shadeForm`: a plank is a slab
 * with one lit face, and a gradient over a strip two pixels deep at the tile
 * is paint cost buying nothing.
 */

import { mix } from '../../carlArt';
import { FAR_LIMB_SHADE, type Ramp, receded } from '../palette';
import type { HeldProp, PropGrip, PropPainter, PropReach } from '../props';
import type { ViewSpec } from '../rig';

/** The barricade sprite's two plank shades, `#8b6914` and `#9b7924`, as a ramp. */
const PINE: Ramp = {
  deep: '#3f2d07',
  shadow: '#5c440c',
  dark: '#745810',
  mid: '#8b6914',
  base: '#9b7924',
  light: '#b89537',
  rim: '#d8b75c',
};

/**
 * The board on the floor ahead of him in profile, in figure units from his
 * ground point (+X the way he faces). Its near end clears the toes of a foot
 * planted a step ahead of him, and it runs about a stride on from there — a
 * plank as long as the grate it covers is wide.
 */
export const FLOOR_BOARD = {
  nearX: 0.4,
  farX: 1.02,
  /** How high its top face stands off the floor. */
  thickness: 0.06,
} as const;

/**
 * The board on the floor just ahead of him seen head-on: ahead of him on the
 * floor is lower on the screen, so it lies across the tile below his knee,
 * in figure units from his ground point with his right side toward +X, the
 * way the choreography is authored.
 */
const FLOOR_BOARD_AHEAD = {
  left: -0.12,
  right: 0.66,
  /** Its far edge, just below his ground point. */
  top: 0.02,
  /** Its top face as the top-down floor shows it. */
  face: 0.11,
} as const;

/** A board held head-on: its length, and how far of it sticks out past the fist. */
const HELD_LENGTH = 0.86;
const HELD_OUTBOARD_OF_FIST = 0.1;
/** The width of its face, which head-on is what faces the camera. */
const HELD_FACE = 0.1;

/** Share of the board's depth given to the lit top edge and the shaded bottom edge. */
const LIT_EDGE_SHARE = 0.28;
const SHADED_EDGE_SHARE = 0.3;
/** The grain line runs along the middle of the face, a shade under the base. */
const GRAIN_WIDTH_SHARE = 0.12;
const GRAIN_TONE = 0.45;

/**
 * Which way the held board runs from the fist: toward +X from the left hand,
 * toward −X from the right, so it always lies across the front of him.
 */
const RIGHT_HAND_RUNS = -1;
const LEFT_HAND_RUNS = 1;

function paintSlab(
  ctx: CanvasRenderingContext2D,
  left: number,
  top: number,
  width: number,
  depth: number,
  wood: Ramp,
): void {
  ctx.fillStyle = wood.base;
  ctx.fillRect(left, top, width, depth);
  ctx.fillStyle = wood.light;
  ctx.fillRect(left, top, width, depth * LIT_EDGE_SHARE);
  ctx.fillStyle = wood.dark;
  ctx.fillRect(left, top + depth * (1 - SHADED_EDGE_SHARE), width, depth * SHADED_EDGE_SHARE);
  ctx.fillStyle = mix(wood.base, wood.dark, GRAIN_TONE);
  const grain = depth * GRAIN_WIDTH_SHARE;
  ctx.fillRect(left, top + (depth - grain) / 2, width, grain);
}

/** Where the board lies, in figure units, and whether it is held rather than on the floor. */
interface BoardPlacement {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly depth: number;
  readonly held: boolean;
}

function boardPlacement(grip: PropGrip, prop: HeldProp, view: ViewSpec): BoardPlacement {
  const scale = prop.scale ?? 1;
  if (view.profile) {
    const depth = FLOOR_BOARD.thickness * scale;
    const width = FLOOR_BOARD.farX - FLOOR_BOARD.nearX;
    return { left: FLOOR_BOARD.nearX, top: -depth, width, depth, held: false };
  }
  if (!view.showsBack) {
    const depth = FLOOR_BOARD_AHEAD.face * scale;
    const width = FLOOR_BOARD_AHEAD.right - FLOOR_BOARD_AHEAD.left;
    // Laid on the floor where his hands work it, so a mirrored view reflects it with them.
    const left = view.mirrored ? -FLOOR_BOARD_AHEAD.right : FLOOR_BOARD_AHEAD.left;
    return { left, top: FLOOR_BOARD_AHEAD.top, width, depth, held: false };
  }
  const length = HELD_LENGTH * scale;
  const face = HELD_FACE * scale;
  const runs = prop.hand === 'left' ? LEFT_HAND_RUNS : RIGHT_HAND_RUNS;
  const fistEnd = grip.centre.x - runs * HELD_OUTBOARD_OF_FIST * scale;
  const left = runs > 0 ? fistEnd : fistEnd - length;
  return { left, top: grip.centre.y - face / 2, width: length, depth: face, held: true };
}

export const drawBoard: PropPainter = (ctx, grip, prop, view, behindHand) => {
  const board = boardPlacement(grip, prop, view);
  // On the floor it is out in the open, not in the shade of the far arm.
  const wood = board.held ? receded(PINE, behindHand ? FAR_LIMB_SHADE : 0) : PINE;
  paintSlab(ctx, board.left, board.top, board.width, board.depth, wood);
};

export const boardReach: PropReach = (grip, prop, view) => {
  const board = boardPlacement(grip, prop, view);
  return [
    { x: board.left, y: board.top },
    { x: board.left + board.width, y: board.top + board.depth },
  ];
};
