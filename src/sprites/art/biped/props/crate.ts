/**
 * A carry case, held in both hands by its sides: the box a piece of gym
 * equipment is carried in before it is set down and stood up where it goes.
 *
 * One case for all three pieces. A cell is shared by every placement, so a
 * dumbbell, a bench and a treadmill would each need a row of their own, and
 * none of them has a two-handed carry that reads at the tile the way a box
 * does. Painted slate grey, not wood: held against a brown leather jacket a
 * brown box has no edge left at 32 px.
 *
 * A box is carried level whatever the wrists do, so it is always drawn square
 * to the floor and never turns with the grip. Head-on it hangs between the
 * two hands, from the one it is hung on across to the other; in profile the
 * near hand holds the middle of its near side.
 */

import { FAR_LIMB_SHADE, type Ramp, receded } from '../palette';
import type { HeldProp, PropGrip, PropPainter, PropReach } from '../props';
import type { ViewSpec } from '../rig';

const CASE: Ramp = {
  deep: '#1d2228',
  shadow: '#2c343c',
  dark: '#3d4750',
  mid: '#4f5b66',
  base: '#5f6c78',
  light: '#7f8d99',
  rim: '#a9b6c0',
};

/** Head-on it is wider than his jacket, so its ends show either side of him from behind too. */
const FACE_WIDTH = 0.7;
/** Edge-on it is a shorter box: the case is deeper across than it is front to back. */
const PROFILE_WIDTH = 0.46;
const CASE_HEIGHT = 0.46;
/**
 * The fists close on its sides halfway down, where the handles are, so it is
 * carried against his belly rather than hanging in front of his thighs.
 */
const CASE_GRIP_BELOW_LID = 0.23;
/**
 * Head-on the fist it hangs from sits over the case's edge rather than beside
 * it: the fingers wrap round the side.
 */
const FIST_OVER_EDGE = 0.04;
/**
 * Which way the case runs across the screen from the fist it hangs from, by
 * the pose's hand fields: the left ones are drawn on the screen's left, the
 * right ones on its right, so it always spans the front of him.
 */
const RUNS_FROM_LEFT_HAND = 1;
const RUNS_FROM_RIGHT_HAND = -1;

/** The lid, a lighter band across the top: what says "box" rather than "slab". */
const LID_SHARE = 0.18;
/** The shaded underside band. */
const BASE_SHARE = 0.16;
/** A handle slot centred under the lid on the face, as wide as a hand. */
const HANDLE_WIDTH_SHARE = 0.34;
const HANDLE_DEPTH_SHARE = 0.08;
const HANDLE_BELOW_LID_SHARE = 0.12;

/** The case's box, in figure units. */
interface CaseBox {
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
}

function caseBox(grip: PropGrip, prop: HeldProp, view: ViewSpec): CaseBox {
  const scale = prop.scale ?? 1;
  const height = CASE_HEIGHT * scale;
  const width = (view.profile ? PROFILE_WIDTH : FACE_WIDTH) * scale;
  const top = grip.centre.y - CASE_GRIP_BELOW_LID * scale;
  const runs = prop.hand === 'left' ? RUNS_FROM_LEFT_HAND : RUNS_FROM_RIGHT_HAND;
  const fistEdge = grip.centre.x - runs * FIST_OVER_EDGE * scale;
  const headOnLeft = runs > 0 ? fistEdge : fistEdge - width;
  const left = view.profile ? grip.centre.x - width / 2 : headOnLeft;
  return { left, top, width, height };
}

export const drawCrate: PropPainter = (ctx, grip, prop, view, behindHand) => {
  const colours = receded(CASE, behindHand ? FAR_LIMB_SHADE : 0);
  const { left, top, width, height } = caseBox(grip, prop, view);

  ctx.fillStyle = colours.base;
  ctx.fillRect(left, top, width, height);
  ctx.fillStyle = colours.light;
  ctx.fillRect(left, top, width, height * LID_SHARE);
  ctx.fillStyle = colours.dark;
  ctx.fillRect(left, top + height * (1 - BASE_SHARE), width, height * BASE_SHARE);
  ctx.fillStyle = colours.shadow;
  const handleWidth = width * HANDLE_WIDTH_SHARE;
  ctx.fillRect(
    left + (width - handleWidth) / 2,
    top + height * (LID_SHARE + HANDLE_BELOW_LID_SHARE),
    handleWidth,
    height * HANDLE_DEPTH_SHARE,
  );
};

export const crateReach: PropReach = (grip, prop, view) => {
  const box = caseBox(grip, prop, view);
  return [
    { x: box.left, y: box.top },
    { x: box.left + box.width, y: box.top + box.height },
  ];
};
