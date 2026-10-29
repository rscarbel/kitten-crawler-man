/**
 * Where a wader's body goes under opaque dungeon water: a collar of murky
 * water lapping up round the cut, ringed with foam the churn keeps breaking
 * against the body, and a few flecks of spray thrown off it.
 *
 * Drawn straight over the clipped body as a pure function of the clock, so it
 * holds no state and no surfaces. Colours come from the floor's water plan, so
 * the collar is the same water the body is standing in.
 */

import { dungeonFloorTheme } from '../map/dungeon/floorTheme';
import { MAX_WATER_DEPTH } from '../map/tileTypes';
import { DUNGEON_WATER_PLANS, type WaterInk } from './sheets/dungeonWaterSheets';

const TWO_PI = Math.PI * 2;

/** The collar, about as wide as a crawler's body at the waist. */
const COLLAR_HALF_WIDTH_PX = 10;
/** The surface is seen at a tilt, so the collar is a flattened ring. */
const COLLAR_FLATTEN = 0.34;
const COLLAR_ALPHA = 0.78;

/** Foam beads round the collar's rim, circling and swelling as the water churns. */
const FOAM_BEADS = 9;
const FOAM_RIM_HALF_WIDTH_PX = 9.5;
const FOAM_TURNS_PER_SECOND = 0.2;
const FOAM_BEAD_RADIUS_PX = 0.9;
const FOAM_BEAD_SWELL_PX = 0.5;
const FOAM_SWELL_HZ = 2.3;
/** Spreads the beads' swells so neighbours are never in step. */
const FOAM_SWELL_PHASE_STEP = 1.9;
/** Beads on the far side of the body are seen past it and fainter. */
const FOAM_FRONT_ALPHA = 0.7;
const FOAM_BACK_ALPHA = 0.35;
const FOAM_RIM_ALPHA = 0.5;
const FOAM_RIM_WIDTH_PX = 1;

/** Spray: flecks thrown up off the collar and falling back. */
const SPRAY_FLECKS = 3;
const SPRAY_PERIOD_SECONDS = 0.7;
const SPRAY_RISE_PX = 5;
const SPRAY_SPREAD_PX = 7;
const SPRAY_RADIUS_PX = 0.8;
const SPRAY_ALPHA = 0.55;
/** Spreads the flecks across the collar and through the period. */
const SPRAY_SPREAD_STEP = 0.37;

function rgb(ink: WaterInk): string {
  return `rgb(${ink.r}, ${ink.g}, ${ink.b})`;
}

/**
 * The waterline at screen point (`sx`, `sy`), the centre of the cut through
 * the body, at the shared clock `timeSeconds`.
 */
export function drawDungeonWaterline(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  timeSeconds: number,
): void {
  const plan = DUNGEON_WATER_PLANS[dungeonFloorTheme().id];
  const deep = plan.byDepth[MAX_WATER_DEPTH];
  const foam = rgb(plan.surface.foam);
  const previousAlpha = ctx.globalAlpha;

  ctx.globalAlpha = previousAlpha * COLLAR_ALPHA;
  ctx.fillStyle = rgb(deep);
  ctx.beginPath();
  ctx.ellipse(sx, sy, COLLAR_HALF_WIDTH_PX, COLLAR_HALF_WIDTH_PX * COLLAR_FLATTEN, 0, 0, TWO_PI);
  ctx.fill();

  ctx.globalAlpha = previousAlpha * FOAM_RIM_ALPHA;
  ctx.strokeStyle = foam;
  ctx.lineWidth = FOAM_RIM_WIDTH_PX;
  ctx.beginPath();
  ctx.ellipse(
    sx,
    sy,
    FOAM_RIM_HALF_WIDTH_PX,
    FOAM_RIM_HALF_WIDTH_PX * COLLAR_FLATTEN,
    0,
    0,
    Math.PI,
  );
  ctx.stroke();

  ctx.fillStyle = foam;
  const spin = timeSeconds * FOAM_TURNS_PER_SECOND * TWO_PI;
  for (let bead = 0; bead < FOAM_BEADS; bead++) {
    const angle = (bead / FOAM_BEADS) * TWO_PI + spin;
    const isFront = Math.sin(angle) > 0;
    const swell = Math.sin(timeSeconds * FOAM_SWELL_HZ * TWO_PI + bead * FOAM_SWELL_PHASE_STEP);
    const radius = FOAM_BEAD_RADIUS_PX + swell * FOAM_BEAD_SWELL_PX;
    if (radius <= 0) continue;
    ctx.globalAlpha = previousAlpha * (isFront ? FOAM_FRONT_ALPHA : FOAM_BACK_ALPHA);
    ctx.beginPath();
    ctx.arc(
      sx + Math.cos(angle) * FOAM_RIM_HALF_WIDTH_PX,
      sy + Math.sin(angle) * FOAM_RIM_HALF_WIDTH_PX * COLLAR_FLATTEN,
      radius,
      0,
      TWO_PI,
    );
    ctx.fill();
  }

  for (let fleck = 0; fleck < SPRAY_FLECKS; fleck++) {
    const life = (timeSeconds / SPRAY_PERIOD_SECONDS + fleck * SPRAY_SPREAD_STEP) % 1;
    const across = ((fleck * SPRAY_SPREAD_STEP * FOAM_BEADS) % 1) * 2 - 1;
    const lift = Math.sin(life * Math.PI) * SPRAY_RISE_PX;
    ctx.globalAlpha = previousAlpha * SPRAY_ALPHA * (1 - life);
    ctx.beginPath();
    ctx.arc(sx + across * SPRAY_SPREAD_PX, sy - lift, SPRAY_RADIUS_PX, 0, TWO_PI);
    ctx.fill();
  }

  ctx.globalAlpha = previousAlpha;
}
