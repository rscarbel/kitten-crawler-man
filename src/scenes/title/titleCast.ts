/**
 * Who appears on the title screen and in which rows, kept in one place so the
 * layers that draw the cast and the boot code that warms it can never
 * disagree: a row drawn on the title that boot did not warm is painted on the
 * frame it first shows, which is a stutter in the middle of the reveal.
 */

import {
  activeHumanFigure,
  emptyHandedHumanFigure,
  prewarmHumanRow,
} from '../../sprites/humanSprite';
import { prewarmFigureState } from '../../sprites/figure/figureFrameCache';
import { prewarmCatSprite, type CatState } from '../../sprites/catSprite';
import { prewarmGoblinBystander, type GoblinArchetype } from '../../sprites/goblinSprite';
import { prewarmMongoWalk, type MongoStage } from '../../sprites/mongoSprite';
import type { HumanRowName } from '../../sprites/art/humanFigure';

/** Carl stands facing the camera, breathing. */
export const CARL_IDLE_ROW = 'idle' satisfies HumanRowName;

/**
 * His stance shifts: small, head-on gestures that read as a man waiting for a
 * show to start, never as a man about to throw a punch.
 */
export const CARL_FIDGET_ROWS = [
  'fidget_glance',
  'fidget_knuckles',
  'fidget_neck',
] as const satisfies readonly HumanRowName[];

/** Donut sits head-on; her tail flicks through the idle loop itself. */
export const DONUT_IDLE_ROW = 'idle' satisfies CatState;

/** Her idle breaks, every one drawn head-on. */
export const DONUT_BREAK_ROWS = [
  'groom_paw',
  'groom_flank',
  'look_around',
] as const satisfies readonly CatState[];

/** The goblin that peeks into the light: the plain cleaver goblin every crawler meets first. */
export const PEEKING_GOBLIN: GoblinArchetype = 'sword';

/** Mongo as the show knows him: fully grown. */
export const TITLE_MONGO_STAGE: MongoStage = 'adult';

/**
 * Queues every row the title draws for baking. Called during the boot loading
 * screen so the first title frame finds them warm, and again when the title
 * lays out, since a scene re-entered from a run may have let some go.
 */
export function prewarmTitleCast(): void {
  const carlRows: readonly HumanRowName[] = [CARL_IDLE_ROW, ...CARL_FIDGET_ROWS];
  for (const row of carlRows) prewarmHumanRow(row);
  // The title draws him empty-handed; back from a run with a weapon out, that
  // is a different figure from the one `prewarmHumanRow` warms.
  const emptyHanded = emptyHandedHumanFigure();
  if (emptyHanded.id !== activeHumanFigure().id) {
    for (const row of carlRows) prewarmFigureState(emptyHanded, row);
  }
  prewarmCatSprite();
  prewarmGoblinBystander(PEEKING_GOBLIN);
  prewarmMongoWalk(TITLE_MONGO_STAGE);
}

/**
 * The box each hero's art reaches inside its cell across every row above, in
 * cell pixels, with a margin round it. The title paints its heroes at screen
 * density, where a whole cell is mostly empty and costs several times this;
 * a new pose that reaches past its box is clipped on the title alone.
 */
export const CARL_HERO_CROP = { left: 52, top: 48, width: 84, height: 132 } as const;
export const DONUT_HERO_CROP = { left: 46, top: 46, width: 88, height: 86 } as const;
