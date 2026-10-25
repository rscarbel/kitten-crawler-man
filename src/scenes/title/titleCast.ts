/**
 * Who appears on the title screen and in which rows, kept in one place so the
 * layers that draw the cast and the boot code that warms it can never
 * disagree: a row drawn on the title that boot did not warm is painted on the
 * frame it first shows, which is a stutter in the middle of the reveal.
 */

import type { CatState } from '../../sprites/catSprite';
import { prewarmGoblinBystander, type GoblinArchetype } from '../../sprites/goblinSprite';
import { prewarmMongoWalk, type MongoStage } from '../../sprites/mongoSprite';
import type { HumanRowName } from '../../sprites/art/humanFigure';

/** The human crawler stands facing the camera, breathing. */
export const HUMAN_IDLE_ROW = 'idle' satisfies HumanRowName;

/**
 * His stance shifts: small, head-on gestures that read as a man waiting for a
 * show to start, never as a man about to throw a punch.
 */
export const HUMAN_FIDGET_ROWS = [
  'fidget_glance',
  'fidget_knuckles',
  'fidget_neck',
] as const satisfies readonly HumanRowName[];

/** The cat crawler sits head-on; her tail flicks through the idle loop itself. */
export const CAT_IDLE_ROW = 'idle' satisfies CatState;

/** Her idle breaks, every one drawn head-on. */
export const CAT_BREAK_ROWS = [
  'groom_paw',
  'groom_flank',
  'look_around',
] as const satisfies readonly CatState[];

/** The goblin that peeks into the light: the plain cleaver goblin every crawler meets first. */
export const PEEKING_GOBLIN: GoblinArchetype = 'sword';

/** Mongo as the show knows him: fully grown. */
export const TITLE_MONGO_STAGE: MongoStage = 'adult';

/**
 * Queues every row the title draws from the shared figure cache for baking.
 * Called during the boot loading screen so the first title frame finds them
 * warm, and again when the title lays out, since a scene re-entered from a run
 * may have let some go. The two heroes are not among them: the title paints
 * them into cells of its own (`TitleHeroCells`).
 */
export function prewarmTitleCast(): void {
  prewarmGoblinBystander(PEEKING_GOBLIN);
  prewarmMongoWalk(TITLE_MONGO_STAGE);
}

/**
 * The box each hero's art reaches inside its cell across every row above, in
 * cell pixels, with a margin round it: wider at the cat's sides, where her
 * tail sweeps. The title paints its heroes at screen density, where a whole
 * cell is mostly empty and costs several times this; a new pose or a new look
 * that reaches past its box is clipped on the title alone.
 */
export const HUMAN_HERO_CROP = { left: 76, top: 67, width: 80, height: 145 } as const;
export const CAT_HERO_CROP = { left: 54, top: 50, width: 70, height: 70 } as const;
