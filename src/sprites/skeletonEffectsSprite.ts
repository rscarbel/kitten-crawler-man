import { progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';
import { figureFrameCount } from './figure/figureDef';
import {
  drawFigureCached,
  drawFigureCachedRotatedCenter,
  prewarmFigureState,
} from './figure/figureFrameCache';
import {
  SKELETON_BONE_ARROW_FIGURE,
  SKELETON_GRASPING_HANDS_FIGURE,
  SKELETON_SOUL_BOLT_FIGURE,
  SKELETON_SOUL_BURST_FIGURE,
} from './art/skeletonEffectsFigure';

/**
 * Draw wrappers for the four effects the Skeleton Lord's attacks are made of.
 *
 * Painted at runtime from `src/sprites/art/skeletonEffectsArt.ts` through the
 * figure cache; reviewed with `npm run render:skeleton-effects`.
 *
 * **Anchor convention:** `sx`/`sy` are the screen pixels of the effect's own
 * centre — the world position minus the camera offset, exactly as
 * `LavaBallSystem` passes `bolt.x - camX, bolt.y - camY`. Every figure's anchor
 * is its cell centre, so the effect lands where the simulation put it and the
 * caller never has to know the cell size.
 *
 * For the grasping-hands patch, "centre" means the centre of the *patch*: the
 * soil line sits a little below it and the hands reach above it, which is what
 * lets the cone be filled by drawing one instance per tile centre.
 */

/** Frames per second the game loop runs at; the art is timed against it. */
const FRAMES_PER_SECOND = 60;

/** Loop speed of the churn on the bolt's surface. */
const BOLT_FPS = 12;

const BOLT_STATE = 'fly';
const BURST_STATE = 'burst';
const ARROW_STATE = 'fly';
const HANDS_STATE = 'erupt';

/**
 * Warms the two rows a soul-bolt cast will draw.
 *
 * Called where the cast is *telegraphed* rather than where the bolt is
 * constructed: the burst in particular is a whole flight away, which is all the
 * lead the row needs.
 */
export function prewarmSoulBoltCast(): void {
  prewarmFigureState(SKELETON_SOUL_BOLT_FIGURE, BOLT_STATE);
  prewarmFigureState(SKELETON_SOUL_BURST_FIGURE, BURST_STATE);
}

/** Warms the impact row on its own, for a burst with no bolt in front of it. */
export function prewarmSoulBurst(): void {
  prewarmFigureState(SKELETON_SOUL_BURST_FIGURE, BURST_STATE);
}

/**
 * Warms every row the tower fight draws.
 *
 * The fight opens on the frame a dialog closes, so its own telegraphs are the
 * only lead the rows would otherwise get and the first of each attack would be
 * painted directly. Called once from the reveal, which is minutes of lead ahead
 * of most of it and seconds ahead of the materialising burst.
 */
export function prewarmLichFightEffects(): void {
  prewarmSoulBoltCast();
  prewarmBoneArrow();
  prewarmGraspingHands();
}

/** Warms the arrow's single cell as the archer draws. */
export function prewarmBoneArrow(): void {
  prewarmFigureState(SKELETON_BONE_ARROW_FIGURE, ARROW_STATE);
}

/** Warms the eruption's row while the cone it fills is still being telegraphed. */
export function prewarmGraspingHands(): void {
  prewarmFigureState(SKELETON_GRASPING_HANDS_FIGURE, HANDS_STATE);
}

/**
 * A soul bolt in flight, centred on (sx, sy).
 *
 * The cell is not rotated: a ball of witch-light has no nose, and the motion
 * lives inside the loop instead.
 *
 * @param age  the projectile's age in game frames
 */
export function drawSoulBolt(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  age: number,
): void {
  const seconds = age / FRAMES_PER_SECOND;
  const frameCount = figureFrameCount(SKELETON_SOUL_BOLT_FIGURE, BOLT_STATE);
  drawFigureCached(
    ctx,
    SKELETON_SOUL_BOLT_FIGURE,
    BOLT_STATE,
    timeFrameIndex(seconds, BOLT_FPS, frameCount),
    sx,
    sy,
    tileSize,
  );
}

/**
 * The burst where a soul bolt lands, centred on (sx, sy).
 *
 * `progress` runs 0 on the frame of impact to 1 on the last frame.
 */
export function drawSoulBurst(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  progress: number,
): void {
  const frameCount = figureFrameCount(SKELETON_SOUL_BURST_FIGURE, BURST_STATE);
  drawFigureCached(
    ctx,
    SKELETON_SOUL_BURST_FIGURE,
    BURST_STATE,
    progressFrameIndex(progress, frameCount),
    sx,
    sy,
    tileSize,
  );
}

/** Full opacity; the arrow has no fade state of its own. */
const ARROW_ALPHA = 1;

/** The arrow's flight row is a single pose; there is no frame to advance. */
const ARROW_FRAME = 0;

/**
 * A bone arrow in flight, spinning about its own ink centre at (sx, sy).
 *
 * `headingRad` is the direction of travel. The art points along +X, so heading
 * 0 flies right and the sprite needs no other correction.
 */
export function drawBoneArrow(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  headingRad: number,
): void {
  drawFigureCachedRotatedCenter(
    ctx,
    SKELETON_BONE_ARROW_FIGURE,
    ARROW_STATE,
    ARROW_FRAME,
    sx,
    sy,
    headingRad,
    tileSize,
    ARROW_ALPHA,
  );
}

/**
 * One patch of hands erupting from the ground, centred on (sx, sy).
 *
 * `progress` runs 0 to 1 over the patch's whole life rather than being clock
 * driven, so a cone filled with several patches can stagger them and read as a
 * wave crossing the ground rather than as one animated texture.
 */
export function drawGraspingHands(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  progress: number,
): void {
  const frameCount = figureFrameCount(SKELETON_GRASPING_HANDS_FIGURE, HANDS_STATE);
  drawFigureCached(
    ctx,
    SKELETON_GRASPING_HANDS_FIGURE,
    HANDS_STATE,
    progressFrameIndex(progress, frameCount),
    sx,
    sy,
    tileSize,
  );
}
