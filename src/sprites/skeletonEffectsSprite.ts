import {
  drawSpriteKey,
  drawSpriteRotatedCenter,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/SpriteRenderer';
import {
  getSpriteDef,
  getSpriteDefByKey,
  type SpriteKey,
  type SpriteStates,
} from '../core/SpriteLoader';

/**
 * Draw wrappers for the four sheets the Skeleton Lord's attacks are made of.
 *
 * Baked by `npm run gen:skeleton-effects` from `scripts/skeletonEffectsArt.ts`.
 *
 * **Anchor convention:** `sx`/`sy` are the screen pixels of the effect's own
 * centre — the world position minus the camera offset, exactly as
 * `LavaBallSystem` passes `bolt.x - camX, bolt.y - camY`. Every sheet's
 * manifest anchor is its cell centre, so the effect lands where the simulation
 * put it and the caller never has to know the cell size.
 *
 * For the grasping-hands patch, "centre" means the centre of the *patch*: the
 * soil line sits a little below it and the hands reach above it, which is what
 * lets the cone be filled by drawing one instance per tile centre.
 */

/** Frames per second the game loop runs at; the sheets are timed against it. */
const FRAMES_PER_SECOND = 60;

/** Loop speed of the churn on the bolt's surface. */
const BOLT_FPS = 12;
/**
 * How many frames a state actually holds, read from the sheet the game loaded.
 *
 * Not a hand-copied table: `drawSprite` *clamps* the frame index, so a row that
 * got shorter in a rebake would silently freeze on its last frame rather than
 * throw. There is nothing to notice until someone watches that one animation.
 */
function frameCountOf<K extends SpriteKey>(key: K, state: SpriteStates[K]): number {
  return getSpriteDefByKey(key)?.states.get(state)?.frameCount ?? 1;
}

/**
 * A soul bolt in flight, centred on (sx, sy).
 *
 * The sheet is not rotated: a ball of witch-light has no nose, and the motion
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
  const frameCount = frameCountOf('skeleton_soul_bolt', 'fly');
  drawSpriteKey(
    ctx,
    'skeleton_soul_bolt',
    'fly',
    timeFrameIndex(seconds, BOLT_FPS, frameCount),
    sx,
    sy,
    tileSize,
    {},
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
  const frameCount = frameCountOf('skeleton_soul_burst', 'burst');
  drawSpriteKey(
    ctx,
    'skeleton_soul_burst',
    'burst',
    progressFrameIndex(progress, frameCount),
    sx,
    sy,
    tileSize,
    {},
  );
}

/** Full opacity; the arrow has no fade state of its own. */
const ARROW_ALPHA = 1;

/**
 * A bone arrow in flight, spinning about its own ink centre at (sx, sy).
 *
 * `headingRad` is the direction of travel. The sheet is drawn pointing along
 * +X, so heading 0 flies right and the sprite needs no other correction.
 */
export function drawBoneArrow(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  headingRad: number,
): void {
  const def = getSpriteDef('skeleton_bone_arrow');
  if (!def) return;
  const stateDef = def.states.get('fly');
  if (!stateDef) return;
  drawSpriteRotatedCenter(ctx, def, stateDef, sx, sy, headingRad, tileSize, ARROW_ALPHA);
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
  const frameCount = frameCountOf('skeleton_grasping_hands', 'erupt');
  drawSpriteKey(
    ctx,
    'skeleton_grasping_hands',
    'erupt',
    progressFrameIndex(progress, frameCount),
    sx,
    sy,
    tileSize,
    {},
  );
}
