import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import type { EyePlacement } from './eyePlacement';
import {
  GOBLIN_GATE_GUARD_FIGURE,
  GOBLIN_GUARD_EYE_ANCHOR,
  GOBLIN_GUARD_FIGURE,
  GOBLIN_PRISONER_EYE_ANCHOR,
  GOBLIN_PRISONER_FIGURE,
  type TileAnchor,
} from './art/goblinGuardFigure';
import type { FigureDef } from './figure/figureDef';

export {
  GOBLIN_GUARD_WALK_GROUND_PER_CYCLE_TILES,
  guardLensAnchor,
  type GuardLens,
} from './art/goblinGuardFigure';

/** Every row a patrol guard is drawn in. */
export type GoblinGuardState = 'walk' | 'idle' | 'sweep' | 'alert' | 'flinch';
/** Every row the gate guard is drawn in. */
export type GoblinGateGuardState = 'walk' | 'idle' | 'talk' | 'flinch';
/** Every row a prisoner is drawn in. */
export type GoblinPrisonerState = 'idle' | 'rattle' | 'lean' | 'heckle';

/**
 * Each figure's row names as the runtime asks for them. The art gates feed
 * these to `missingStateFailures`, because `drawFigureCached` returns silently
 * on a state the figure does not paint.
 */
export const GOBLIN_GUARD_STATES: ReadonlyArray<GoblinGuardState> = [
  'walk',
  'idle',
  'sweep',
  'alert',
  'flinch',
];
export const GOBLIN_GATE_GUARD_STATES: ReadonlyArray<GoblinGateGuardState> = [
  'walk',
  'idle',
  'talk',
  'flinch',
];
export const GOBLIN_PRISONER_STATES: ReadonlyArray<GoblinPrisonerState> = [
  'idle',
  'rattle',
  'lean',
  'heckle',
];

/** Where and how to draw one prison goblin frame; `x`/`y` is its tile's top-left. */
export interface PrisonGoblinSpriteState<S extends string> {
  readonly x: number;
  readonly y: number;
  readonly tileSize: number;
  readonly facingX: number;
  readonly state: S;
  readonly frame: number;
}

function drawPrisonFigure(
  ctx: CanvasRenderingContext2D,
  figure: FigureDef,
  sprite: PrisonGoblinSpriteState<string>,
): void {
  drawFigureCached(ctx, figure, sprite.state, sprite.frame, sprite.x, sprite.y, sprite.tileSize, {
    flipX: sprite.facingX < 0,
  });
}

/** Draw a patrol guard. Every figure faces +X, so the runtime mirrors it. */
export function drawGoblinGuardSprite(
  ctx: CanvasRenderingContext2D,
  sprite: PrisonGoblinSpriteState<GoblinGuardState>,
): void {
  drawPrisonFigure(ctx, GOBLIN_GUARD_FIGURE, sprite);
}

/** Draw the gate guard. */
export function drawGoblinGateGuardSprite(
  ctx: CanvasRenderingContext2D,
  sprite: PrisonGoblinSpriteState<GoblinGateGuardState>,
): void {
  drawPrisonFigure(ctx, GOBLIN_GATE_GUARD_FIGURE, sprite);
}

/** Draw a prisoner. */
export function drawGoblinPrisonerSprite(
  ctx: CanvasRenderingContext2D,
  sprite: PrisonGoblinSpriteState<GoblinPrisonerState>,
): void {
  drawPrisonFigure(ctx, GOBLIN_PRISONER_FIGURE, sprite);
}

/**
 * Warms every row of the three prison figures. They are placed with the
 * interior rather than arriving, so the whole set is warmed behind its
 * loading screen.
 */
export function prewarmPrisonGoblins(): void {
  for (const state of GOBLIN_GUARD_STATES) prewarmFigureState(GOBLIN_GUARD_FIGURE, state);
  for (const state of GOBLIN_GATE_GUARD_STATES) {
    prewarmFigureState(GOBLIN_GATE_GUARD_FIGURE, state);
  }
  for (const state of GOBLIN_PRISONER_STATES) prewarmFigureState(GOBLIN_PRISONER_FIGURE, state);
}

/** The gap between a goblin's two eyes, in tiles; the far one is half hidden in profile. */
const EYE_SPACING_TILES = 0.08;
const TILE_CENTRE = 0.5;

/** A profile-only figure's eye placement from where its rig paints the eyes. */
function profileEyes(anchor: TileAnchor): EyePlacement {
  const forward = anchor.x - TILE_CENTRE;
  return {
    sideForward: forward,
    sideHeight: anchor.y,
    sideSpacing: EYE_SPACING_TILES,
    frontMirrors: true,
    frontAcross: forward,
    frontHeight: anchor.y,
    frontSpacing: EYE_SPACING_TILES,
  };
}

/** Both guards' eyes, for `PrisonGoblin.eyePlacement`: drawn only in profile, like every goblin. */
export const GOBLIN_GUARD_EYES: EyePlacement = profileEyes(GOBLIN_GUARD_EYE_ANCHOR);
/** A prisoner's eyes. */
export const GOBLIN_PRISONER_EYES: EyePlacement = profileEyes(GOBLIN_PRISONER_EYE_ANCHOR);
