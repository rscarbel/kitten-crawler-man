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
  /**
   * Where the stone is drawn at launch relative to where it flies, in world
   * pixels: it leaves the fork of the sling in his raised fist, which stands
   * well above the ground line the stone is tested along. Drawing only; the
   * offset closes to nothing over {@link convergeDistance}.
   */
  launchOffsetX: number;
  launchOffsetY: number;
  /**
   * World pixels of flight over which the drawn stone closes onto its real
   * line: {@link ROCK_LAUNCH_CONVERGE_TILES}, cut short to the stone's last
   * step before a wall it will hit, so a stone that strikes a wall close by
   * vanishes where it struck rather than in the air off the fork.
   */
  convergeDistance: number;
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

/**
 * How far a stone flies, in tiles, before it is drawn on the line it actually
 * travels rather than coming off the fork. Short, so it reads as leaving his
 * hand and then as a stone skimming at the height of what it will hit.
 */
export const ROCK_LAUNCH_CONVERGE_TILES = 1.5;

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
    const launchShare =
      rock.convergeDistance > 0 ? Math.max(0, 1 - rock.distTraveled / rock.convergeDistance) : 0;
    const rx = rock.x + rock.launchOffsetX * launchShare - camX;
    const ry = rock.y + rock.launchOffsetY * launchShare - camY;

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
