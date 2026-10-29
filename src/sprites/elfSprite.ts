/**
 * Draw wrapper for the elf: picks a row of `ELF_FIGURE` from what the elf is
 * doing and which way it faces, and a frame from the ground it has covered, the cast's progress or
 * the clock, and blits it through the shared figure cache.
 */

import { progressFrameIndex, walkFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { TILE_SIZE } from '../core/constants';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { figureFrameCount } from './figure/figureDef';
import {
  ELF_FIGURE,
  ELF_HEIGHT_SCALE,
  ELF_ROLES,
  ELF_VIEWS,
  type ElfRole,
  type ElfView,
  elfStateName,
} from './art/elfFigure';
import { RIG_WALK_GROUND_PER_CYCLE_PX } from './art/human/locomotion';
import { idleFrameAtSeconds } from './art/human/timing';

/**
 * Every state this wrapper can ask the figure for. The harness holds it
 * against what the figure paints: the draw call returns silently on a state
 * it cannot find, so a name that drifts is an invisible elf and no log line.
 */
export const ELF_DRAWN_STATES: readonly string[] = ELF_ROLES.flatMap((role) =>
  ELF_VIEWS.map((view) => elfStateName(role, view)),
);

/**
 * Tiles one walk cycle covers: the figure's own walk, whose rows these are, on a
 * figure scaled up by the elf's height. Pace the walk by distance with this
 * and the planted foot holds still.
 */
export const ELF_TILES_PER_WALK_CYCLE =
  (RIG_WALK_GROUND_PER_CYCLE_PX * ELF_HEIGHT_SCALE) / TILE_SIZE;

/**
 * Warms every row an elf can play. Called when an elf is stood up —
 * a hideout, a tower guard post, a confrontation — which is the moment the
 * encounter is scheduled: it idles until the party arrives, then walks and
 * casts, and every one of those rows is in reach within seconds.
 */
export function prewarmElf(): void {
  for (const state of ELF_DRAWN_STATES) {
    prewarmFigureState(ELF_FIGURE, state);
  }
}

/** Views split on whichever axis it is facing hardest along. */
function viewFor(facingX: number, facingY: number): ElfView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'front';
}

function roleOf(isMoving: boolean, castAnim: number): ElfRole {
  if (castAnim > 0) return 'cast';
  return isMoving ? 'walk' : 'idle';
}

const MS_PER_SECOND = 1000;

function frameFor(
  role: ElfRole,
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
 * Draw an elf of the cult: tall and pale in a hooded violet robe, its pointed
 * ears thrust out through the cowl, eyes smouldering under the brim, the
 * cult's eye-over-a-cupped-hand mark on its chest and a bone token on a cord
 * at its girdle.
 *
 * @param walkFrame walk-cycle angle in radians, advanced by the ground covered.
 * @param castAnim 0–1 progress through the bolt's cast (0 = idle/walk).
 * @param facingX +1 faces right, −1 left.
 * @param facingY +1 faces toward the camera, −1 away, 0 neither.
 * @param idleOffsetSeconds offset into the breathing loop, so a crowd does not breathe in unison.
 */
export function drawElfSprite(
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
  const key = elfStateName(role, view);
  const frames = figureFrameCount(ELF_FIGURE, key);
  if (frames === 0) return;
  const frame = frameFor(role, walkFrame, castAnim, frames, idleOffsetSeconds);
  const flipX = view === 'side' && facingX < 0;
  drawFigureCached(ctx, ELF_FIGURE, key, frame, sx, sy, s, { flipX });
}
