/**
 * A pump-room shark as the crawler sees it: a dorsal fin cutting the churned,
 * opaque surface, and the wake it drags. Nothing of the fish below the
 * waterline shows; the fin is all the warning there is.
 *
 * Painted straight onto the canvas from a handful of paths, as a pure
 * function of position, heading and the world tick, so it holds no surfaces.
 * Every length is in tiles and scaled by the tile size it is drawn at.
 */

import { GREAT_WHITE_INK } from './art/greatWhiteInk';

const TWO_PI = Math.PI * 2;

/** Surface shapes are this much shorter than they are wide, for the camera's tilt. */
const PERSPECTIVE = 0.55;

const FIN = {
  /** Along the fish, at the waterline. */
  baseLength: 0.56,
  height: 0.62,
  /** How far behind the base's middle the tip leans. */
  sweep: 0.3,
  /** The fin's thickness when it is seen end on, swimming toward or away from the camera. */
  minBase: 0.1,
  /** The tip rises and dips this much as the fish swims. */
  bobTiles: 0.03,
  bobPeriodTicks: 36,
} as const;

/** The water the fin shoulders aside, heaped into a dark trough just behind it. */
const TROUGH = {
  length: 0.5,
  girth: 0.16,
  behindFin: 0.22,
} as const;

const WAKE = {
  /** Half the angle the two arms of the wake spread at. */
  spread: 0.32,
  patrolLength: 0.9,
  chaseLength: 1.7,
  dashes: 4,
  dashPeriodTicks: 20,
  bowRadius: 0.2,
  chaseBowRadius: 0.3,
} as const;

const INK = {
  fin: GREAT_WHITE_INK.back,
  finShade: GREAT_WHITE_INK.backShade,
  finEdge: GREAT_WHITE_INK.backRim,
  outline: GREAT_WHITE_INK.outline,
  trough: 'rgba(6, 12, 24, 0.35)',
  wake: 'rgba(196, 210, 224, 0.6)',
  bow: 'rgba(206, 218, 230, 0.7)',
  waterline: 'rgba(206, 218, 230, 0.75)',
} as const;

const HALF = 0.5;
const LINE_WIDTH_TILES = 1 / 22;

/** A screen-space direction, in the fish's surface plane flattened by the camera tilt. */
function surface(x: number, y: number): { x: number; y: number } {
  return { x, y: y * PERSPECTIVE };
}

/**
 * The shark at the surface point (`sx`, `sy`), swimming along (`headingX`,
 * `headingY`) in world space (it need not be a unit vector). `chasing` lengthens
 * the wake and piles the bow wave higher, so a shark that has broken off its
 * loop reads as coming at the crawler before it arrives.
 */
export function drawSharkFinSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  headingX: number,
  headingY: number,
  frame: number,
  chasing: boolean,
): void {
  const t = tileSize;
  const length = Math.hypot(headingX, headingY);
  const hx = length > 0 ? headingX / length : 1;
  const hy = length > 0 ? headingY / length : 0;
  const forward = surface(hx, hy);
  const across = surface(-hy, hx);
  const lineWidth = Math.max(1, t * LINE_WIDTH_TILES);

  ctx.save();

  const troughCx = sx - forward.x * TROUGH.behindFin * t;
  const troughCy = sy - forward.y * TROUGH.behindFin * t;
  ctx.fillStyle = INK.trough;
  ctx.beginPath();
  ctx.ellipse(
    troughCx,
    troughCy,
    (TROUGH.length / 2) * t * Math.max(PERSPECTIVE, Math.hypot(forward.x, forward.y)),
    (TROUGH.girth / 2) * t * Math.max(PERSPECTIVE, Math.hypot(across.x, across.y)),
    Math.atan2(forward.y, forward.x),
    0,
    TWO_PI,
  );
  ctx.fill();

  // Two arms of wake trailing back, broken into dashes that stream away from the fin.
  const wakeLength = (chasing ? WAKE.chaseLength : WAKE.patrolLength) * t;
  const drift = (frame % WAKE.dashPeriodTicks) / WAKE.dashPeriodTicks;
  ctx.strokeStyle = INK.wake;
  ctx.lineWidth = lineWidth;
  for (const side of [-1, 1] as const) {
    const angle = Math.atan2(-hy, -hx) + side * WAKE.spread;
    const arm = surface(Math.cos(angle), Math.sin(angle));
    for (let dash = 0; dash < WAKE.dashes; dash++) {
      const from = (dash + drift) / WAKE.dashes;
      const to = Math.min(1, from + HALF / WAKE.dashes);
      ctx.globalAlpha = 1 - from;
      ctx.beginPath();
      ctx.moveTo(sx + arm.x * wakeLength * from, sy + arm.y * wakeLength * from);
      ctx.lineTo(sx + arm.x * wakeLength * to, sy + arm.y * wakeLength * to);
      ctx.stroke();
    }
  }
  ctx.globalAlpha = 1;

  // The bow wave piling up ahead of the fin.
  const bowRadius = (chasing ? WAKE.chaseBowRadius : WAKE.bowRadius) * t;
  const bowAngle = Math.atan2(forward.y, forward.x);
  ctx.strokeStyle = INK.bow;
  ctx.lineWidth = lineWidth * (chasing ? 2 : 1);
  ctx.beginPath();
  ctx.ellipse(
    sx + forward.x * FIN.baseLength * HALF * t,
    sy + forward.y * FIN.baseLength * HALF * t,
    bowRadius,
    bowRadius * PERSPECTIVE,
    0,
    bowAngle - Math.PI / 2,
    bowAngle + Math.PI / 2,
  );
  ctx.stroke();

  // The fin: its base along the fish, its tip leaning back. Seen end on it narrows to a blade.
  const baseHalf = Math.max(FIN.minBase / 2, (FIN.baseLength / 2) * Math.abs(hx)) * t;
  const facing = hx >= 0 ? 1 : -1;
  const bob = Math.sin((frame / FIN.bobPeriodTicks) * TWO_PI) * FIN.bobTiles * t;
  const tipX = sx - facing * FIN.sweep * Math.abs(hx) * t;
  const tipY = sy - FIN.height * t + bob;
  const frontX = sx + facing * baseHalf;
  const backX = sx - facing * baseHalf;

  ctx.fillStyle = INK.outline;
  ctx.beginPath();
  ctx.moveTo(frontX + facing, sy + 1);
  ctx.quadraticCurveTo(sx + facing * baseHalf * HALF, tipY + t * 0.05, tipX, tipY - 1);
  ctx.quadraticCurveTo(
    backX + facing * baseHalf * 0.4,
    sy - FIN.height * t * 0.35,
    backX - facing,
    sy + 1,
  );
  ctx.closePath();
  ctx.fill();

  ctx.fillStyle = INK.fin;
  ctx.beginPath();
  ctx.moveTo(frontX, sy);
  ctx.quadraticCurveTo(sx + facing * baseHalf * HALF, tipY + t * 0.06, tipX, tipY);
  ctx.quadraticCurveTo(backX + facing * baseHalf * 0.4, sy - FIN.height * t * 0.35, backX, sy);
  ctx.closePath();
  ctx.fill();

  // The trailing half falls into shade; the leading edge catches the light.
  ctx.fillStyle = INK.finShade;
  ctx.beginPath();
  ctx.moveTo(sx, sy);
  ctx.lineTo(tipX, tipY);
  ctx.quadraticCurveTo(backX + facing * baseHalf * 0.4, sy - FIN.height * t * 0.35, backX, sy);
  ctx.closePath();
  ctx.fill();
  ctx.strokeStyle = INK.finEdge;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.moveTo(frontX, sy - 1);
  ctx.quadraticCurveTo(sx + facing * baseHalf * HALF, tipY + t * 0.06, tipX, tipY);
  ctx.stroke();

  // The surface closing round the fin's base.
  ctx.strokeStyle = INK.waterline;
  ctx.lineWidth = lineWidth;
  ctx.beginPath();
  ctx.ellipse(sx, sy, baseHalf * 1.3, baseHalf * 1.3 * PERSPECTIVE, 0, 0, Math.PI);
  ctx.stroke();

  ctx.restore();
}
