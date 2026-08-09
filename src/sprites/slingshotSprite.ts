import { TILE_SIZE } from '../core/constants';

/**
 * A stone in the air from the human's slingshot.
 *
 * Deliberately leaner than the cat's `Missile`: a rock neither homes, splashes,
 * nor explodes, so it carries no ability level and no detonation timer — it is
 * spent the moment it touches something.
 */
export interface SlingshotRock {
  x: number;
  y: number;
  vx: number;
  vy: number;
  distTraveled: number;
  maxDist: number;
  state: 'flying' | 'done';
  hit: boolean;
}

/** Frames between shots — roughly one stone every three quarters of a second. */
export const SLINGSHOT_COOLDOWN_FRAMES = 45;

/** How far a stone carries before it drops out of the air. */
export const SLINGSHOT_RANGE_TILES = 6;

/**
 * Pixels a stone covers per tick. Sits between the magic missile's base and
 * full-power speeds: a flung pebble should read as faster than a lobbed bottle
 * and slower than a bolt of magic.
 */
export const SLINGSHOT_SPEED = 6;

/** Damage a stone does before the thrower's strength is counted. */
export const SLINGSHOT_BASE_DAMAGE = 2;

/**
 * Share of strength a stone carries. A quarter rather than melee's full point
 * per rank: the slingshot buys reach, and it pays for it in damage.
 */
export const SLINGSHOT_STRENGTH_FRACTION = 0.25;

/** Radius a stone is tested against props, trees and mobs with. */
export const SLINGSHOT_HIT_RADIUS_FRACTION = 0.4;

/** Radius of the drawn pebble, as a fraction of a tile. */
const ROCK_RADIUS_FRACTION = 0.1;

/** How far behind the pebble its motion streak trails, in ticks of travel. */
const ROCK_TRAIL_TICKS = 2;

const ROCK_FILL = '#8b8378';
const ROCK_SHADE = '#5c554c';
const ROCK_HIGHLIGHT = 'rgba(226,222,214,0.85)';
const ROCK_TRAIL_COLOR = 'rgba(120,113,104,0.35)';

/** Where the lit facet sits on the pebble, as a fraction of its radius. */
const HIGHLIGHT_OFFSET_FRACTION = 0.35;
const HIGHLIGHT_RADIUS_FRACTION = 0.35;

/**
 * Paints every stone still in the air.
 *
 * @param s The tile size the world is being drawn at, so a pebble scales with
 *   the rest of the scene rather than staying a fixed pixel blob.
 */
export function drawSlingshotRocks(
  ctx: CanvasRenderingContext2D,
  rocks: readonly SlingshotRock[],
  camX: number,
  camY: number,
  s: number,
): void {
  const radius = s * ROCK_RADIUS_FRACTION;

  for (const rock of rocks) {
    if (rock.state !== 'flying') continue;
    const rx = rock.x - camX;
    const ry = rock.y - camY;

    ctx.save();

    ctx.strokeStyle = ROCK_TRAIL_COLOR;
    ctx.lineWidth = radius;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(rx - rock.vx * ROCK_TRAIL_TICKS, ry - rock.vy * ROCK_TRAIL_TICKS);
    ctx.lineTo(rx, ry);
    ctx.stroke();

    ctx.fillStyle = ROCK_FILL;
    ctx.strokeStyle = ROCK_SHADE;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(rx, ry, radius, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = ROCK_HIGHLIGHT;
    ctx.beginPath();
    ctx.arc(
      rx - radius * HIGHLIGHT_OFFSET_FRACTION,
      ry - radius * HIGHLIGHT_OFFSET_FRACTION,
      radius * HIGHLIGHT_RADIUS_FRACTION,
      0,
      Math.PI * 2,
    );
    ctx.fill();

    ctx.restore();
  }
}

/** Length of the Y-frame's forks, as a fraction of a tile. */
const FRAME_FORK_LENGTH_FRACTION = 0.16;
/** Length of the handle below the fork, as a fraction of a tile. */
const FRAME_HANDLE_LENGTH_FRACTION = 0.13;
/** Half the angle the two forks open to, in radians. */
const FRAME_FORK_HALF_ANGLE = 0.55;
/** How far in front of the wielder's centre the frame is held, in tile fractions. */
const FRAME_HOLD_DISTANCE_FRACTION = 0.42;
/** How far above the tile anchor the holding hand sits, in pixels at `TILE_SIZE`. */
const FRAME_HOLD_HEIGHT_PX = 14;

const FRAME_WOOD = '#6b4b2a';
const FRAME_BAND = 'rgba(40,26,14,0.9)';

/**
 * Draws the little Y-frame in the wielder's hand so a wielded slingshot is
 * visible in the world and not only on the hotbar.
 *
 * Drawn from the facing vector rather than from a sprite row: the human's sheet
 * has no armed poses, and a stick held out in front reads correctly from all
 * four views without one.
 */
export function drawSlingshotWield(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  facingX: number,
  facingY: number,
): void {
  const facingLength = Math.hypot(facingX, facingY);
  if (facingLength === 0) return;
  const dirX = facingX / facingLength;
  const dirY = facingY / facingLength;

  const holdHeight = (FRAME_HOLD_HEIGHT_PX / TILE_SIZE) * s;
  const centreX = sx + s / 2 + dirX * s * FRAME_HOLD_DISTANCE_FRACTION;
  const centreY = sy + s / 2 + dirY * s * FRAME_HOLD_DISTANCE_FRACTION - holdHeight;

  const forkLength = s * FRAME_FORK_LENGTH_FRACTION;
  const handleLength = s * FRAME_HANDLE_LENGTH_FRACTION;

  ctx.save();
  ctx.strokeStyle = FRAME_WOOD;
  ctx.lineWidth = Math.max(1, s * ROCK_RADIUS_FRACTION);
  ctx.lineCap = 'round';

  ctx.beginPath();
  ctx.moveTo(centreX, centreY + handleLength);
  ctx.lineTo(centreX, centreY);
  ctx.stroke();

  for (const side of [-1, 1]) {
    const angle = -Math.PI / 2 + side * FRAME_FORK_HALF_ANGLE;
    ctx.beginPath();
    ctx.moveTo(centreX, centreY);
    ctx.lineTo(centreX + Math.cos(angle) * forkLength, centreY + Math.sin(angle) * forkLength);
    ctx.stroke();
  }

  ctx.strokeStyle = FRAME_BAND;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(
    centreX + Math.cos(-Math.PI / 2 - FRAME_FORK_HALF_ANGLE) * forkLength,
    centreY + Math.sin(-Math.PI / 2 - FRAME_FORK_HALF_ANGLE) * forkLength,
  );
  ctx.lineTo(
    centreX + Math.cos(-Math.PI / 2 + FRAME_FORK_HALF_ANGLE) * forkLength,
    centreY + Math.sin(-Math.PI / 2 + FRAME_FORK_HALF_ANGLE) * forkLength,
  );
  ctx.stroke();

  ctx.restore();
}
