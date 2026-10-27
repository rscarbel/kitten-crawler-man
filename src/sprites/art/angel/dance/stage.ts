/**
 * The stage she dances on, in figure units, with the pole at the origin: world
 * x runs to screen right and world z toward the camera. The pole stands at her
 * figure's tile anchor, so her cell is placed by the pole's tile.
 */

import { DANCE_POLE_HEIGHT_TILES, DANCE_POLE_RADIUS_TILES } from '../../dancePole/dancePole';
import { FIGURE_SCALE, FOOT_Y } from '../proportions';

/** The shared stage pole's thickness, in her figure units. */
export const POLE_RADIUS = DANCE_POLE_RADIUS_TILES / FIGURE_SCALE;
const POLE_HEIGHT = DANCE_POLE_HEIGHT_TILES / FIGURE_SCALE;
export const POLE_TOP_Y = FOOT_Y - POLE_HEIGHT;

/**
 * The stage floor is seen from above at the same scale as the rest of the
 * world, so a step toward the camera moves her down the screen one for one.
 */
export const STAGE_DEPTH_SCALE = 1;

/** Height above the floor, in figure units, as a figure-space y. */
export function heightToY(height: number): number {
  return FOOT_Y - height;
}

/** Figure units to game tiles. */
export function figureUnitsToTiles(units: number): number {
  return units * FIGURE_SCALE;
}
