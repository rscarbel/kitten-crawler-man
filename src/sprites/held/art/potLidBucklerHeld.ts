/**
 * The pot-lid buckler: a dented stockpot lid with a black knob at its crown
 * and a leather strap riveted across it for the fist. At the tile it has
 * to read as a round grey plate with a dark centre and a bright rolled rim, so
 * the silhouette is a plain disc and every detail sits inside it.
 *
 * Painted round the grip point: the fist closes on the strap just above the
 * knob, so the lid spreads round the hand. Item-local +X runs along the strap;
 * the lid's face is square to the palm, so a palm turned to or away from the
 * camera shows the whole lid and one turned across it shows only its rim.
 */

import { mix, rgba } from '../../art/bipedArt';
import { defineHeldVisual, type HeldHandleGeometry, type HeldLook } from '../heldVisualDef';
import { heldShade, outlineAndFill } from '../heldPaint';
import { paintBladeEdgeGlint, seenOnEdge } from './bladeEdge';

type Ctx = CanvasRenderingContext2D;

const FULL_TURN = Math.PI * 2;

const STRAP_LENGTH = 0.12;
const GRIP_POINT = 0.5;
/** A stockpot lid half again as wide as his head: big enough to read as a plate at the tile. */
const LID_RADIUS = 0.19;
/**
 * The lid's centre lies this far along the strap past his fist: the strap is
 * riveted above the knob, so the fist sits high on the lid and the knob shows
 * below it, and carried in profile the lid stands out ahead of his thigh.
 */
const LID_CENTRE_PAST_FIST = 0.1;
const LID_SPAN = LID_RADIUS * 2;

const STEEL = '#8f969c';
const STEEL_LIGHT_MIX = 0.45;
const STEEL_SHADE_MIX = 0.4;
const STEEL_LIGHT = '#ffffff';
const STEEL_SHADE = '#2a2f36';
const STRAP_LEATHER = '#5b3a24';
const KNOB_BLACK = '#1d1b1c';
const KNOB_SHINE = '#9a9496';

/**
 * The rolled lip, a shaded groove just inside the outline. The light lives on
 * the dome inside it: a bright ring round a darker middle reads as a washer
 * or a weight plate, a bright crown inside a dark rim as a lid.
 */
const LIP_INSET = 0.022;
const LIP_WIDTH = 0.026;
/**
 * The dome: a lit cap toward the key light over a shaded one away from it,
 * each a disc pushed off the centre by this share of the lid.
 */
const DOME_RADIUS_SHARE = 0.74;
const DOME_OFFSET_SHARE = 0.16;
const DOME_LIGHT_ALPHA = 0.85;
const DOME_SHADE_ALPHA = 0.3;
/**
 * The dent knocked into one side of the face: a dark hollow with a lit lip
 * on its far wall, fixed to the lid so it turns with it.
 */
const DENT_ANGLE = 2.4;
const DENT_DISTANCE_SHARE = 0.55;
const DENT_RX = 0.04;
const DENT_RY = 0.026;
const DENT_LIP_OFFSET = 0.012;
const DENT_LIP_WIDTH = 0.012;
const DENT_SHADE_ALPHA = 0.7;
const DENT_LIP_ALPHA = 0.8;
/** The knob, bakelite black with one hard shine: the lid's dark centre. */
const KNOB_RADIUS = 0.04;
const KNOB_SHINE_RADIUS = 0.011;
const KNOB_SHINE_OFFSET_SHARE = 0.4;
/** A small hard glint on the rim on the lit side. */
const RIM_GLINT_RADIUS = 0.016;
const RIM_GLINT_ALPHA = 0.85;
const RIM_GLINT_REACH_SHARE = 0.78;

function traceLid(ctx: Ctx, radius: number): void {
  ctx.beginPath();
  ctx.arc(0, 0, radius, 0, FULL_TURN);
}

function fillDisc(ctx: Ctx, x: number, y: number, radius: number, fill: string): void {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, FULL_TURN);
  ctx.fillStyle = fill;
  ctx.fill();
}

function paintLidFace(ctx: Ctx, look: HeldLook): void {
  const steel = heldShade(STEEL, look);
  const { light } = look;
  traceLid(ctx, LID_RADIUS);
  outlineAndFill(ctx, steel);

  ctx.save();
  traceLid(ctx, LID_RADIUS - LIP_INSET);
  ctx.clip();
  const domeRadius = LID_RADIUS * DOME_RADIUS_SHARE;
  const domeOffset = LID_RADIUS * DOME_OFFSET_SHARE;
  fillDisc(
    ctx,
    -light.x * domeOffset,
    -light.y * domeOffset,
    domeRadius,
    rgba(mix(steel, STEEL_SHADE, STEEL_SHADE_MIX), DOME_SHADE_ALPHA),
  );
  fillDisc(
    ctx,
    light.x * domeOffset,
    light.y * domeOffset,
    domeRadius,
    rgba(mix(steel, STEEL_LIGHT, STEEL_LIGHT_MIX), DOME_LIGHT_ALPHA),
  );
  const dentX = Math.cos(DENT_ANGLE) * LID_RADIUS * DENT_DISTANCE_SHARE;
  const dentY = Math.sin(DENT_ANGLE) * LID_RADIUS * DENT_DISTANCE_SHARE;
  ctx.beginPath();
  ctx.ellipse(dentX, dentY, DENT_RX, DENT_RY, DENT_ANGLE, 0, FULL_TURN);
  ctx.fillStyle = rgba(STEEL_SHADE, DENT_SHADE_ALPHA);
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    dentX + light.x * DENT_LIP_OFFSET,
    dentY + light.y * DENT_LIP_OFFSET,
    DENT_RX,
    DENT_RY,
    DENT_ANGLE,
    0,
    Math.PI,
  );
  ctx.strokeStyle = rgba(mix(steel, STEEL_LIGHT, STEEL_LIGHT_MIX), DENT_LIP_ALPHA);
  ctx.lineWidth = DENT_LIP_WIDTH;
  ctx.stroke();
  ctx.restore();

  traceLid(ctx, LID_RADIUS - LIP_INSET);
  ctx.strokeStyle = mix(steel, STEEL_SHADE, STEEL_SHADE_MIX);
  ctx.lineWidth = LIP_WIDTH;
  ctx.stroke();
  fillDisc(
    ctx,
    light.x * LID_RADIUS * RIM_GLINT_REACH_SHARE,
    light.y * LID_RADIUS * RIM_GLINT_REACH_SHARE,
    RIM_GLINT_RADIUS,
    rgba(STEEL_LIGHT, RIM_GLINT_ALPHA),
  );

  traceLid(ctx, KNOB_RADIUS);
  outlineAndFill(ctx, heldShade(KNOB_BLACK, look));
  fillDisc(
    ctx,
    light.x * KNOB_RADIUS * KNOB_SHINE_OFFSET_SHARE,
    light.y * KNOB_RADIUS * KNOB_SHINE_OFFSET_SHARE,
    KNOB_SHINE_RADIUS,
    heldShade(KNOB_SHINE, look),
  );
}

/** The strap the fist closes on, across the inside of the lid; the lid covers all of it but its ends. */
function paintStrap(ctx: Ctx, look: HeldLook, handle: HeldHandleGeometry): void {
  ctx.beginPath();
  ctx.rect(handle.buttX, -handle.halfWidth, handle.headBase - handle.buttX, handle.halfWidth * 2);
  outlineAndFill(ctx, heldShade(STRAP_LEATHER, look));
}

function paintLid(ctx: Ctx, look: HeldLook): void {
  ctx.save();
  ctx.translate(LID_CENTRE_PAST_FIST, 0);
  paintLidFace(ctx, look);
  ctx.restore();
}

export const POT_LID_BUCKLER_HELD = defineHeldVisual({
  id: 'pot_lid_buckler',
  name: 'Pot-Lid Buckler',
  archetype: 'offHandHeld',
  weight: 'light',
  handle: { length: STRAP_LENGTH, radius: 'thin' },
  head: { length: LID_SPAN, width: LID_SPAN },
  gripPoint: GRIP_POINT,
  phases: 1,
  paintHandle: paintStrap,
  paintHead: (ctx, look) => {
    if (look.facing === 'flat') {
      paintLid(ctx, look);
      return;
    }
    seenOnEdge(ctx, () => paintLid(ctx, look));
    paintBladeEdgeGlint(
      ctx,
      LID_CENTRE_PAST_FIST - LID_RADIUS,
      LID_CENTRE_PAST_FIST + LID_RADIUS,
      STEEL_LIGHT,
    );
  },
});
