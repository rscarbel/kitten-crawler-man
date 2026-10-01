/**
 * Draw wrapper for the city elf cultist: picks a row of
 * `CITY_ELF_CULTIST_FIGURE` from what the cultist is doing and which way it
 * faces, and a frame from the ground it has covered, the cast's progress or
 * the clock, and blits it through the shared figure cache.
 */

import { progressFrameIndex, walkFrameIndex } from '../core/SpriteRenderer';
import { TILE_SIZE } from '../core/constants';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { figureFrameCount } from './figure/figureDef';
import {
  CITY_ELF_CULTIST_FIGURE,
  CULTIST_HEIGHT_SCALE,
  CULTIST_ROLES,
  CULTIST_VIEWS,
  type CultistRole,
  type CultistView,
  cultistStateName,
} from './art/cityElfCultistFigure';
import { WALK_GROUND_PER_CYCLE_PX } from './art/human/locomotion';
import { idleFrameAtSeconds } from './art/human/timing';

/**
 * Every state this wrapper can ask the figure for. The harness holds it
 * against what the figure paints: the draw call returns silently on a state
 * it cannot find, so a name that drifts is an invisible cultist and no log line.
 */
export const CITY_ELF_CULTIST_DRAWN_STATES: readonly string[] = CULTIST_ROLES.flatMap((role) =>
  CULTIST_VIEWS.map((view) => cultistStateName(role, view)),
);

/**
 * Tiles one walk cycle covers: Carl's own walk, whose rows these are, on a
 * figure scaled up by the elf's height. Pace the walk by distance with this
 * and the planted foot holds still.
 */
export const CITY_ELF_CULTIST_TILES_PER_WALK_CYCLE =
  (WALK_GROUND_PER_CYCLE_PX * CULTIST_HEIGHT_SCALE) / TILE_SIZE;

/**
 * Warms every row a cultist can play. Called when a cultist is stood up —
 * a hideout, a tower guard post, a confrontation — which is the moment the
 * encounter is scheduled: it idles until the party arrives, then walks and
 * casts, and every one of those rows is in reach within seconds.
 */
export function prewarmCityElfCultist(): void {
  for (const state of CITY_ELF_CULTIST_DRAWN_STATES) {
    prewarmFigureState(CITY_ELF_CULTIST_FIGURE, state);
  }
}

/** Views split on whichever axis it is facing hardest along. */
function viewFor(facingX: number, facingY: number): CultistView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function roleOf(isMoving: boolean, castAnim: number): CultistRole {
  if (castAnim > 0) return 'cast';
  return isMoving ? 'walk' : 'idle';
}

const MS_PER_SECOND = 1000;

function frameFor(
  role: CultistRole,
  walkPhase: number,
  castAnim: number,
  frames: number,
  idleOffsetSeconds: number,
): number {
  if (role === 'walk') return walkFrameIndex(walkPhase, frames);
  if (role === 'cast') return progressFrameIndex(castAnim, frames);
  return idleFrameAtSeconds(performance.now() / MS_PER_SECOND + idleOffsetSeconds);
}

/**
 * Draw a city elf cultist — a tall, pale elf in a hooded violet robe, its
 * pointed ears thrust out through the cowl, eyes smouldering under the brim,
 * the cult's winged-eye sigil on its chest and a skyfowl feather tied at its
 * girdle. They believe the skyfowl are angels; the murders are their tithe.
 *
 * @param walkFrame walk-cycle angle in radians, advanced by the ground covered.
 * @param castAnim 0–1 progress through the soul-bolt cast (0 = idle/walk).
 * @param facingX +1 faces right, −1 left.
 * @param facingY +1 faces toward the camera, −1 away, 0 neither.
 * @param idleOffsetSeconds offset into the breathing loop, so a crowd does not breathe in unison.
 */
export function drawCityElfCultistSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  walkFrame = 0,
  isMoving = false,
  castAnim = 0,
  facingX = 1,
  facingY = 0,
  idleOffsetSeconds = 0,
): void {
  const view = viewFor(facingX, facingY);
  const role = roleOf(isMoving, castAnim);
  const key = cultistStateName(role, view);
  const frames = figureFrameCount(CITY_ELF_CULTIST_FIGURE, key);
  if (frames === 0) return;
  const frame = frameFor(role, walkFrame, castAnim, frames, idleOffsetSeconds);
  const flipX = view === 'side' && facingX < 0;
  drawFigureCached(ctx, CITY_ELF_CULTIST_FIGURE, key, frame, sx, sy, s, { flipX });
}
