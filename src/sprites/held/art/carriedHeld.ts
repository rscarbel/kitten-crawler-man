/**
 * The quest things the cat crawler carries in her jaws while one is in her
 * pack, each held across her mouth by its middle: the prison's gold key and
 * Tikka's rolled blueprints. At her size a thing in her jaws is a few pixels,
 * so each keeps the one feature that names it — the key's gold bow and bit,
 * the paper's blueprint blue and the string round it.
 */

import { drawPrisonKeyShape } from '../../art/prisonKeyArt';
import { defineHeldVisual, type HeldHandlePainter, type HeldLook } from '../heldVisualDef';
import { heldShade, outlineAndFill } from '../heldPaint';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;
const QUARTER_TURN = Math.PI / 2;

/** For a thing whose head painter draws it whole. */
const PAINTED_WHOLE: HeldHandlePainter = () => undefined;

/**
 * The key as its painter draws it, in its own units: from the top of its bow
 * to the foot of its bit, and the bit's foot. It is painted upright; carried,
 * its bow is the butt and its bit the head.
 */
const KEY_BOW_TOP = -0.52;
const KEY_UNITS_TALL = 0.96;
/** The carried key's bow and shaft, then its bit, rig units. */
const KEY_HANDLE_LENGTH = 0.32;
const KEY_BIT_LENGTH = 0.12;
const KEY_BIT_WIDTH = 0.16;
/** The jaws close on the shaft just under the bow. */
const KEY_GRIP_POINT = 0.55;
/** Edge-on, the key's face is turned this far toward the camera, so it shows as more than a line. */
const KEY_EDGE_FACE = 0.3;

const KEY_HEIGHT = KEY_HANDLE_LENGTH + KEY_BIT_LENGTH;
const KEY_SCALE = KEY_HEIGHT / KEY_UNITS_TALL;

function paintKey(ctx: Ctx, look: HeldLook, buttX: number): void {
  ctx.save();
  // Upright, the key's length runs down its painter's +Y; carried, it runs along item-local +X.
  ctx.rotate(-QUARTER_TURN);
  const face = look.facing === 'edge' ? KEY_EDGE_FACE : 1;
  drawPrisonKeyShape(ctx, 0, buttX - KEY_BOW_TOP * KEY_SCALE, KEY_SCALE, face, 0);
  ctx.restore();
}

export const CARRIED_PRISON_KEY_HELD = defineHeldVisual({
  id: 'carried_prison_key',
  name: 'The Key (carried)',
  archetype: 'mouthCarry',
  weight: 'light',
  handle: { length: KEY_HANDLE_LENGTH, radius: 'thin' },
  head: { length: KEY_BIT_LENGTH, width: KEY_BIT_WIDTH },
  gripPoint: KEY_GRIP_POINT,
  phases: 1,
  paintHandle: PAINTED_WHOLE,
  paintHead: (ctx, look, handle) => paintKey(ctx, look, handle.buttX),
});

/** Blueprint paper: the blue it is printed on, its lit edge and its rolled ends. */
const BLUEPRINT = '#2f5fa8';
const BLUEPRINT_LIT = '#6f9ad8';
const BLUEPRINT_END = '#dfe8f6';
const STRING = '#b89a5c';
/** The roll's length and its half-width across, rig units, and where she holds it. */
const ROLL_LENGTH = 0.38;
const ROLL_HALF_WIDTH = 0.05;
const ROLL_GRIP_POINT = 0.5;
/** Its ends show as pale spirals this share of the roll's half-width deep along it. */
const ROLL_END_DEPTH = 0.6;
/** The lit band along the top of the roll, as a share of its width. */
const ROLL_LIT_SHARE = 0.35;
/** The string tied round it, as a share of its length from the butt, and its width. */
const STRING_AT = 0.62;
const STRING_WIDTH = 0.022;
/** A roll is all handle: the blueprint has no head beyond the paper. */
const ROLL_HEAD_LENGTH = 0;
const ROLL_HEAD_WIDTH = ROLL_HALF_WIDTH * 2;

function traceRoll(ctx: Ctx, buttX: number): void {
  ctx.beginPath();
  ctx.rect(buttX, -ROLL_HALF_WIDTH, ROLL_LENGTH, ROLL_HALF_WIDTH * 2);
}

function paintRoll(ctx: Ctx, look: HeldLook, buttX: number): void {
  traceRoll(ctx, buttX);
  outlineAndFill(ctx, heldShade(BLUEPRINT, look));
  ctx.save();
  traceRoll(ctx, buttX);
  ctx.clip();
  const litTop = look.light.y <= 0;
  const litWidth = ROLL_HALF_WIDTH * 2 * ROLL_LIT_SHARE;
  ctx.fillStyle = heldShade(BLUEPRINT_LIT, look);
  ctx.fillRect(
    buttX,
    litTop ? -ROLL_HALF_WIDTH : ROLL_HALF_WIDTH - litWidth,
    ROLL_LENGTH,
    litWidth,
  );
  ctx.fillStyle = heldShade(BLUEPRINT_END, look);
  for (const end of [buttX, buttX + ROLL_LENGTH]) {
    ctx.beginPath();
    ctx.ellipse(end, 0, ROLL_HALF_WIDTH * ROLL_END_DEPTH, ROLL_HALF_WIDTH, 0, 0, FULL_TURN);
    ctx.fill();
  }
  ctx.fillStyle = heldShade(STRING, look);
  ctx.fillRect(
    buttX + ROLL_LENGTH * STRING_AT - STRING_WIDTH / 2,
    -ROLL_HALF_WIDTH,
    STRING_WIDTH,
    ROLL_HALF_WIDTH * 2,
  );
  ctx.restore();
}

export const CARRIED_BLUEPRINTS_HELD = defineHeldVisual({
  id: 'carried_blueprints',
  name: "Tikka's Blueprints (carried)",
  archetype: 'mouthCarry',
  weight: 'light',
  handle: { length: ROLL_LENGTH, radius: 'standard' },
  head: { length: ROLL_HEAD_LENGTH, width: ROLL_HEAD_WIDTH },
  gripPoint: ROLL_GRIP_POINT,
  phases: 1,
  paintHandle: PAINTED_WHOLE,
  paintHead: (ctx, look, handle) => paintRoll(ctx, look, handle.buttX),
});
