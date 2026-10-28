/**
 * Ivy Ashgrove's look as a hireling: picks a row of `IVY_ASHGROVE_FIGURE`
 * from what her kit asks for and which way she faces, and a frame from the
 * ground she has covered, the clock or the kit's progress through a one-shot
 * row, and blits it through the shared figure cache.
 */

import { progressFrameIndex, walkFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import { TILE_SIZE } from '../core/constants';
import { isKitRow, type ArcherRow } from '../creatures/mercenaries/MercenaryKit';
import type { EyePlacement } from './eyePlacement';
import type { CardinalView, FacingSelection } from './facingView';
import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import { figureFrameCount } from './figure/figureDef';
import { FIGURE_HEIGHT } from './art/biped/proportions';
import { HUMAN_SCALE } from './art/human/figureScale';
import { RIG_WALK_GROUND_PER_CYCLE_PX } from './art/human/locomotion';
import { idleFrameAtSeconds, TICKS_PER_SECOND, WALK_FRAMES } from './art/human/timing';
import {
  IVY_ASHGROVE_FIGURE,
  IVY_HEIGHT_SCALE,
  IVY_ROLE_VIEWS,
  IVY_ROLES,
  IVY_TILE_SCALE,
  type IvyRole,
  type IvyView,
  ivyStateName,
} from './art/ivyAshgroveFigure';
import { IVY_DEATH_DURATION_MS } from './ivyAshgroveTiming';
import type { MercenaryArt } from './mercenaryArt';

/**
 * Every state the art can ask the figure for. The harness holds it against
 * what the figure paints: the draw call returns silently on a state it cannot
 * find, so a name that drifts is an invisible hireling and no log line.
 */
export const IVY_DRAWN_STATES: readonly string[] = IVY_ROLES.flatMap((role) =>
  IVY_ROLE_VIEWS[role].map((view) => ivyStateName(role, view)),
);

/** The row she paints for each row her kit asks for. */
const IVY_ROWS: Readonly<Record<ArcherRow, IvyRole>> = {
  idle: 'idle',
  walk: 'walk',
  shoot: 'shoot',
  hurt: 'hurt',
  death: 'death',
};

/** Walking away from the Barracks desk she stands and walks, in any view. */
const APPROACH_ROLES: readonly IvyRole[] = ['idle', 'walk'];
/** In the order a fight asks for them: the shot first, the flinch and the fall after. */
const FIGHT_ROLES: readonly IvyRole[] = ['shoot', 'hurt', 'death'];

function prewarmRoles(roles: readonly IvyRole[]): void {
  for (const role of roles) {
    for (const view of IVY_ROLE_VIEWS[role]) {
      prewarmFigureState(IVY_ASHGROVE_FIGURE, ivyStateName(role, view));
    }
  }
}

const IVY_VIEW_OF: Readonly<Record<CardinalView, IvyView>> = {
  front: 'front',
  side: 'side',
  back: 'away',
};

/** The fall is painted in profile only, so a role without the facing's view turns to it. */
function viewFor(role: IvyRole, facing: FacingSelection<CardinalView>): IvyView {
  const wanted = IVY_VIEW_OF[facing.view];
  return IVY_ROLE_VIEWS[role].includes(wanted) ? wanted : 'side';
}

const FULL_TURN = Math.PI * 2;
const MS_PER_SECOND = 1000;
const DEATH_TICKS = Math.round((IVY_DEATH_DURATION_MS * TICKS_PER_SECOND) / MS_PER_SECOND);

/** Her cell's furthest reach past her own tile on any side, rounded up to whole tiles. */
const CULL_MARGIN_TILES = Math.ceil(
  Math.max(
    IVY_ASHGROVE_FIGURE.tileX,
    IVY_ASHGROVE_FIGURE.tileY,
    IVY_ASHGROVE_FIGURE.frameWidth - IVY_ASHGROVE_FIGURE.tileX - IVY_TILE_SCALE,
    IVY_ASHGROVE_FIGURE.frameHeight - IVY_ASHGROVE_FIGURE.tileY - IVY_TILE_SCALE,
  ) / IVY_TILE_SCALE,
);

/** Her feet stand on her tile's bottom edge, one tile below its top. */
const TILE_HEIGHT_TILES = 1;
/** Crown to sole on screen, less the tile she stands in: how far her head clears the tile's top. */
const HEAD_ABOVE_TILE_TILES = FIGURE_HEIGHT * IVY_HEIGHT_SCALE * HUMAN_SCALE - TILE_HEIGHT_TILES;

/**
 * Where her eyes are, in tiles from her tile's top-left, measured off her
 * solved idle skeleton (the head's eye line, the eyes toward the face); `npm run verify:eye-shine` holds them to the art.
 */
const IVY_EYES: EyePlacement = {
  sideForward: 0.07,
  sideHeight: -0.3,
  sideSpacing: 0.05,
  frontMirrors: false,
  frontAcross: 0,
  frontHeight: -0.29,
  frontSpacing: 0.07,
};

/** World pixels one walk cycle covers at the standard tile: the rig's own stride at her height. */
const PIXELS_PER_WALK_CYCLE = RIG_WALK_GROUND_PER_CYCLE_PX * IVY_HEIGHT_SCALE;

/**
 * Ivy Ashgrove's painted figure. One-shot rows are drawn at the kit's
 * `progress` through them, so the string is loosed on screen on the tick the
 * kit looses the arrow; the idle breathes on the hireling's own clock. Her
 * fall ends lying still on the floor, which a progress of 1 selects, so the
 * shell's hold-and-fade shows her where she fell.
 */
export const IVY_ASHGROVE_ART: MercenaryArt = {
  draw(ctx, sx, sy, tileSize, frame) {
    const { row, progress } = frame.state;
    const fallback: IvyRole = frame.isMoving ? 'walk' : 'idle';
    const role = isKitRow(IVY_ROWS, row) ? IVY_ROWS[row] : fallback;
    const view = viewFor(role, frame.cardinalFacing);
    const state = ivyStateName(role, view);
    const frames = figureFrameCount(IVY_ASHGROVE_FIGURE, state);
    if (frames === 0) return;
    let index: number;
    if (role === 'walk') index = walkFrameIndex(frame.walkFrame, frames);
    else if (role === 'idle') index = idleFrameAtSeconds(frame.clock / TICKS_PER_SECOND);
    else index = progressFrameIndex(progress, frames);
    const turnedToProfile = view === 'side' && frame.cardinalFacing.view !== 'side';
    const flipX = turnedToProfile ? frame.facingX < 0 : frame.cardinalFacing.flipX;
    drawFigureCached(ctx, IVY_ASHGROVE_FIGURE, state, index, sx, sy, tileSize, { flipX });
  },
  cullMarginTiles: CULL_MARGIN_TILES,
  headLiftTiles: HEAD_ABOVE_TILE_TILES,
  eyes: IVY_EYES,
  deathFrames: DEATH_TICKS,
  prewarm: () => prewarmRoles(APPROACH_ROLES),
  prewarmForFight: () => prewarmRoles(FIGHT_ROLES),
  gait: {
    radiansPerPixel: (tileSize) => FULL_TURN / ((PIXELS_PER_WALK_CYCLE * tileSize) / TILE_SIZE),
    maxRadiansPerTick: FULL_TURN / WALK_FRAMES,
  },
};
