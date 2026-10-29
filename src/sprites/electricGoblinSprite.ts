import { drawFigureCached, prewarmFigureState } from './figure/figureFrameCache';
import type { EyePlacement } from './eyePlacement';
import { profileEyes } from './goblinGuardSprite';
import {
  ELECTRIC_GOBLIN_FIGURE,
  ELECTRIC_GOBLIN_GORE_PARTS,
  ELECTRIC_GOBLIN_ROW_NAMES,
  electricGoblinFrame,
  type ElectricGoblinRow,
} from './art/electricGoblinFigure';
import { ELECTRIC_GOBLIN_SCALE, electricGoblinStyle } from './art/electricGoblinArt';
import { goblinEyeAnchor } from './art/goblinGuardFigure';

export {
  ELECTRIC_GOBLIN_FIGURE,
  ELECTRIC_GOBLIN_GORE_PARTS,
  ELECTRIC_GOBLIN_ROWS,
  ELECTRIC_GOBLIN_ROW_NAMES,
  GRENADE_RELEASE_FRAME,
  PLUNGE_IMPACT_FRAME,
  SLAM_IMPACT_FRAME,
  SWIPE_IMPACT_FRAME,
  electricGoblinBallAnchor,
  electricGoblinTellFrame,
  type ElectricGoblinRow,
} from './art/electricGoblinFigure';

/** Where and how to draw one electric goblin frame; `x`/`y` is his tile's top-left. */
interface ElectricGoblinSpriteState {
  readonly x: number;
  readonly y: number;
  readonly tileSize: number;
  readonly facingX: number;
  readonly row: ElectricGoblinRow;
  readonly frame: number;
}

/** Draw the electric goblin. The figure faces +X, so the runtime mirrors it. */
export function drawElectricGoblinSprite(
  ctx: CanvasRenderingContext2D,
  sprite: ElectricGoblinSpriteState,
): void {
  drawFigureCached(
    ctx,
    ELECTRIC_GOBLIN_FIGURE,
    sprite.row,
    sprite.frame,
    sprite.x,
    sprite.y,
    sprite.tileSize,
    { flipX: sprite.facingX < 0 },
  );
}

/** Warms the given rows, or every row when none are named. */
export function prewarmElectricGoblin(
  rows: readonly ElectricGoblinRow[] = ELECTRIC_GOBLIN_ROW_NAMES,
): void {
  for (const row of rows) prewarmFigureState(ELECTRIC_GOBLIN_FIGURE, row);
}

/** The gore field's key for the pieces he comes apart into. */
export const ELECTRIC_GOBLIN_BODY_PART_KEY = 'electric_goblin';

/** Warms the pieces he comes apart into, so his death paints nothing in the frame. */
export function prewarmElectricGoblinGore(): void {
  for (const part of ELECTRIC_GOBLIN_GORE_PARTS) prewarmFigureState(ELECTRIC_GOBLIN_FIGURE, part);
}

/** His eyes at rest, for `eyePlacement`: drawn only in profile, like every goblin. */
export const ELECTRIC_GOBLIN_EYES: EyePlacement = profileEyes(
  goblinEyeAnchor(
    electricGoblinStyle({ spin: 0, charge: 0 }),
    electricGoblinFrame('idle', 0).pose,
    ELECTRIC_GOBLIN_SCALE,
  ),
);
