import {
  drawSpriteKey,
  walkFrameIndex,
  progressFrameIndex,
  timeFrameIndex,
} from '../core/SpriteRenderer';
import { getSpriteDefByKey, type SpriteStates } from '../core/SpriteLoader';

/**
 * The Evil Clown — the bounty troupe's giant, three tiles of stretched clown.
 *
 * Three viewpoints rather than the one the rest of Grimaldi's clowns use: he is
 * tall enough that a mirrored profile walking straight down the screen reads as
 * a man sliding sideways. Only the profile rows are mirrored; flipping a head-on
 * row would swap his hands every time he changed heading.
 *
 * Sheet is produced by `npx tsx scripts/generate-clown-sprites.ts`; review it
 * with `npx tsx scripts/render-clowns.ts --clown=evil`, or `?evilclown` in a
 * dev build to see it move.
 */

type EvilClownState = SpriteStates['evil_clown'];

/** Which of the sheet's three viewpoints a facing vector selects. */
type EvilClownView = 'toward' | 'side' | 'away';

/**
 * How many frames a row actually holds, read from the sheet the game loaded.
 *
 * Not a hand-copied table: `drawSprite` *clamps* the frame index, so a row that
 * got shorter in a rebake would silently freeze on its last frame rather than
 * throw.
 */
function frameCountOf(state: EvilClownState): number {
  return getSpriteDefByKey('evil_clown')?.states.get(state)?.frameCount ?? 1;
}

/** Idle and laugh are clock-driven rather than timer-driven. */
const IDLE_FPS = 5;
const MS_PER_SECOND = 1000;

/**
 * Frames on the sheet's idle row.
 *
 * The one hand-copied count in this file, and only because the loop length
 * below is a module constant read at import time, before `loadSprites()` has
 * put anything in the manifest cache. Everything drawn goes through
 * {@link frameCountOf} instead. Keep in step with the `idle` state in
 * src/images/enemies/manifest.json.
 */
const IDLE_ROW_FRAMES = 6;

/** Length of one idle loop, so a staged encounter can stagger its members. */
export const EVIL_CLOWN_IDLE_LOOP_SECONDS = IDLE_ROW_FRAMES / IDLE_FPS;

/**
 * The six pieces the Evil Clown comes apart into, in the order they spawn.
 *
 * The runtime half of the list `scripts/clownGore.ts` paints; the generator's
 * manifest gate holds the sheet to that same order, and `BodyPartGoreSystem`
 * spawns them in it. These names must match the sheet's `gore_*` states.
 */
export const EVIL_CLOWN_GORE_PARTS: ReadonlyArray<string> = [
  'gore_head',
  'gore_ruff',
  'gore_torso',
  'gore_arm',
  'gore_shoe',
  'gore_vials',
];

/** The `BodyPartGoreSystem` registry key a dead Evil Clown's pieces come from. */
export const EVIL_CLOWN_BODY_PART_KEY = 'evil_clown';

/**
 * What the clown is doing this frame. `cycle` is the walk angle in radians (a
 * full stride loop is 2π); `progress` runs 0→1 across a one-shot beat.
 */
export type EvilClownAnimation =
  | { readonly kind: 'idle'; readonly phaseOffsetSeconds: number }
  | { readonly kind: 'walk'; readonly cycle: number }
  | { readonly kind: 'juggle_walk'; readonly cycle: number }
  | { readonly kind: 'swipe'; readonly progress: number }
  | { readonly kind: 'laugh'; readonly progress: number };

/** Views split on whichever axis the clown is facing hardest along. */
function viewFor(facingX: number, facingY: number): EvilClownView {
  if (Math.abs(facingY) <= Math.abs(facingX)) return 'side';
  return facingY < 0 ? 'away' : 'toward';
}

function stateFor(animation: EvilClownAnimation, view: EvilClownView): EvilClownState {
  // The laugh is drawn head-on only: it is a telegraph the player has to read,
  // and a telegraph seen from behind is not one.
  if (animation.kind === 'laugh') return 'laugh';
  const base = animation.kind;
  if (view === 'side') return `${base}_side`;
  if (view === 'away') return `${base}_away`;
  return base;
}

function frameFor(animation: EvilClownAnimation, state: EvilClownState): number {
  const count = frameCountOf(state);
  switch (animation.kind) {
    case 'idle':
      return timeFrameIndex(
        performance.now() / MS_PER_SECOND + animation.phaseOffsetSeconds,
        IDLE_FPS,
        count,
      );
    case 'walk':
    case 'juggle_walk':
      return walkFrameIndex(animation.cycle, count);
    case 'swipe':
    case 'laugh':
      return progressFrameIndex(animation.progress, count);
  }
}

export function drawEvilClownSprite(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  tileSize: number,
  facingX: number,
  facingY: number,
  animation: EvilClownAnimation,
): void {
  const view = viewFor(facingX, facingY);
  const state = stateFor(animation, view);
  // Only the profile art is mirrored, and never the head-on laugh, whatever the
  // clown happens to be facing while he plays it.
  const flipX = view === 'side' && facingX < 0 && animation.kind !== 'laugh';
  drawSpriteKey(ctx, 'evil_clown', state, frameFor(animation, state), sx, sy, tileSize, {
    flipX,
  });
}
