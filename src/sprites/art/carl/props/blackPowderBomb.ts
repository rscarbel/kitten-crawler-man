/**
 * A cast-iron black powder bomb held by its neck: the black ball hangs off the
 * butt end of the fist, the neck runs up through it and the twisted cord fuse
 * stands off the knuckles with — once lit — the same spark a stick's fuse
 * throws. It is the bomb `blackPowderBombSprite.ts` draws in the air, in the
 * same iron and cord, so what leaves his hand is what flies.
 *
 * Held by the neck rather than cupped, because the fingers are composited in
 * front of whatever the fist holds: a ball centred in the fist is hidden by
 * the hand and forearm on every frame the knuckles face the camera, and only
 * a fuse is left poking out of an empty hand. Clear of the fist, the ball
 * reads whole at the tile.
 *
 * The ball's light is the figure's upper-left key whatever angle the fist
 * holds it at; only the neck and fuse turn with the hand.
 */

import { FAR_LIMB_SHADE, OUTLINE, type Ramp, receded } from '../palette';
import type { PropPainter, PropReach } from '../props';
import type { Pt } from '../../carlArt';
import { FUSE_SPARK_REACH, paintFuseSpark } from './dynamite';
import { squareAround } from './reach';

/** The in-flight bomb's iron, as a ramp: `base` is its `IRON`. */
const IRON: Ramp = {
  deep: '#0b0c0e',
  shadow: '#16181b',
  dark: '#202328',
  mid: '#282b31',
  base: '#30343a',
  light: '#5a5f68',
  rim: '#8a929e',
};
const NECK_IRON = '#4a4f57';
const FUSE_CORD = '#b9965c';
/** Floor light bounced up under the ball: cool, and only a thin rim. */
const REFLECTED_LIGHT = '#6f7c8c';
const SPECULAR = '#e4ebf2';

/**
 * The ball's radius. Larger against him than a real bomb, as the stick is
 * longer than a real stick: at the 32 px tile this is about eight pixels
 * across, the least that reads as a ball rather than a dark smudge by the fist.
 */
const BALL_RADIUS = 0.13;
/** How much neck shows between the ball and the fist, along the bore. */
const NECK_SHOWN = 0.05;
/** Where the ball's centre sits along the bore: past the fist's butt end. */
const BALL_CENTRE_ALONG = -(BALL_RADIUS + NECK_SHOWN);
/** Where the neck's mouth comes out past the knuckles, along the bore. */
const NECK_MOUTH_ALONG = 0.06;
const NECK_HALF_WIDTH = 0.035;
/** The dark rim round the ball and neck, so black iron keeps an edge on his dark jacket. */
const IRON_OUTLINE = 0.016;
/** The lit side is the ball's own outline shifted toward the key, so the terminator is one curved line. */
const LIT_SHIFT_X = -0.3;
const LIT_SHIFT_Y = -0.36;
const TERMINATOR_WIDTH_SHARE = 0.14;
/** The bounce rim's cut-out, shifted a little toward the key so the rim stays thin. */
const RIM_SHIFT_X = -0.12;
const RIM_SHIFT_Y = -0.18;
const RIM_ALPHA = 0.5;
const SPECULAR_X = -0.42;
const SPECULAR_Y = -0.46;
const SPECULAR_RADIUS_SHARE = 0.2;

/** The cord off the neck's mouth, curling over: its bend and its tip, along and across the bore. */
const FUSE_CONTROL_ALONG = 0.06;
const FUSE_TIP_ALONG = 0.08;
const FUSE_TIP_ACROSS = 0.06;
const FUSE_WIDTH = 0.022;

const FULL_TURN = Math.PI * 2;

/** How far the ball's far side and the fuse's tip lie from the grip, per unit scale. */
const BALL_FAR_REACH = -BALL_CENTRE_ALONG + BALL_RADIUS + IRON_OUTLINE;
const FUSE_TIP_REACH = Math.hypot(NECK_MOUTH_ALONG + FUSE_TIP_ALONG, FUSE_TIP_ACROSS);

export const blackPowderBombReach: PropReach = (grip, prop) =>
  squareAround(
    grip.centre,
    Math.max(BALL_FAR_REACH, FUSE_TIP_REACH + FUSE_SPARK_REACH) * (prop.scale ?? 1),
  );

function paintBall(
  ctx: CanvasRenderingContext2D,
  centre: Pt,
  radius: number,
  outline: number,
  iron: Ramp,
  behindHand: boolean,
): void {
  const { x: cx, y: cy } = centre;
  const traceBall = (dx: number, dy: number): void => {
    ctx.beginPath();
    ctx.arc(cx + dx * radius, cy + dy * radius, radius, 0, FULL_TURN);
  };
  ctx.beginPath();
  ctx.arc(cx, cy, radius + outline, 0, FULL_TURN);
  ctx.fillStyle = OUTLINE;
  ctx.fill();
  traceBall(0, 0);
  ctx.fillStyle = iron.shadow;
  ctx.fill();

  ctx.save();
  traceBall(0, 0);
  ctx.clip();
  traceBall(LIT_SHIFT_X, LIT_SHIFT_Y);
  ctx.fillStyle = iron.base;
  ctx.fill();
  ctx.strokeStyle = iron.deep;
  ctx.lineWidth = radius * TERMINATOR_WIDTH_SHARE;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, FULL_TURN);
  ctx.arc(cx + RIM_SHIFT_X * radius, cy + RIM_SHIFT_Y * radius, radius, 0, FULL_TURN);
  ctx.globalAlpha = RIM_ALPHA;
  ctx.fillStyle = REFLECTED_LIGHT;
  ctx.fill('evenodd');
  ctx.globalAlpha = 1;
  ctx.beginPath();
  ctx.arc(
    cx + SPECULAR_X * radius,
    cy + SPECULAR_Y * radius,
    radius * SPECULAR_RADIUS_SHARE,
    0,
    FULL_TURN,
  );
  ctx.fillStyle = behindHand ? iron.rim : SPECULAR;
  ctx.fill();
  ctx.restore();
}

export const drawBlackPowderBomb: PropPainter = (ctx, grip, prop, _view, behindHand) => {
  const scale = prop.scale ?? 1;
  const iron = receded(IRON, behindHand ? FAR_LIMB_SHADE : 0);
  const angle = grip.haftAngle + (prop.angle ?? 0);
  const along = { x: Math.cos(angle), y: Math.sin(angle) };
  // The cord curls toward whichever side of the bore is up on screen, so it
  // stands off the knuckles rather than drooping across the fist.
  const upSide = along.x >= 0 ? -1 : 1;
  const across = { x: -along.y * upSide, y: along.x * upSide };
  const at = (alongBore: number, acrossBore = 0): Pt => ({
    x: grip.centre.x + (along.x * alongBore + across.x * acrossBore) * scale,
    y: grip.centre.y + (along.y * alongBore + across.y * acrossBore) * scale,
  });
  const ballCentre = at(BALL_CENTRE_ALONG);
  const mouth = at(NECK_MOUTH_ALONG);
  const control = at(NECK_MOUTH_ALONG + FUSE_CONTROL_ALONG);
  const tip = at(NECK_MOUTH_ALONG + FUSE_TIP_ALONG, FUSE_TIP_ACROSS);

  ctx.save();
  ctx.lineCap = 'round';
  const traceCord = (): void => {
    ctx.beginPath();
    ctx.moveTo(mouth.x, mouth.y);
    ctx.quadraticCurveTo(control.x, control.y, tip.x, tip.y);
  };
  traceCord();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = (FUSE_WIDTH + IRON_OUTLINE * 2) * scale;
  ctx.stroke();
  traceCord();
  ctx.strokeStyle = FUSE_CORD;
  ctx.lineWidth = FUSE_WIDTH * scale;
  ctx.stroke();

  ctx.lineCap = 'butt';
  ctx.beginPath();
  ctx.moveTo(ballCentre.x, ballCentre.y);
  ctx.lineTo(mouth.x, mouth.y);
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = (NECK_HALF_WIDTH + IRON_OUTLINE) * 2 * scale;
  ctx.stroke();
  ctx.strokeStyle = NECK_IRON;
  ctx.lineWidth = NECK_HALF_WIDTH * 2 * scale;
  ctx.stroke();

  paintBall(ctx, ballCentre, BALL_RADIUS * scale, IRON_OUTLINE * scale, iron, behindHand);
  ctx.restore();

  paintFuseSpark(ctx, tip, prop);
};
