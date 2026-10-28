/**
 * Who appears on the title screen and in which rows, kept in one place so the
 * layers that draw the cast and the boot code that warms it can never
 * disagree: a row drawn on the title that boot did not warm is painted on the
 * frame it first shows, which is a stutter in the middle of the reveal.
 */

import type { CatState } from '../../sprites/catSprite';
import { prewarmGoblinBystander, type GoblinArchetype } from '../../sprites/goblinSprite';
import { prewarmDeinonychusWalk, type DeinonychusStage } from '../../sprites/deinonychusSprite';
import type { HumanRowName } from '../../sprites/art/humanFigure';
import { humanFigureFor } from '../../sprites/art/human/appearance';
import { outfitOf } from '../../sprites/garments/outfit';
import type { HumanLook } from '../../sprites/looks/humanLook';
import type { FigureDef } from '../../sprites/figure/figureDef';
import { HUMAN_CRAWLER_LOOKS } from '../../characters/humanCrawlerLooks';
import { lookIdOf } from '../../characters/crawlerChoices';
import { maybePlayerIdentity } from '../../characters/playerIdentity';

/**
 * The look the title paints before a player has made a crawler: the cover
 * art is composed around it.
 */
const TITLE_DEFAULT_HUMAN_LOOK = HUMAN_CRAWLER_LOOKS.male_light;

/** Asked for every frame a hero is drawn, so each look's figure is worked out once. */
const bareFigures = new WeakMap<HumanLook, FigureDef>();

/** `look` in nothing but its own clothes, holding nothing: how a crawler is shown before a run dresses them. */
export function bareHumanFigure(look: HumanLook): FigureDef {
  const known = bareFigures.get(look);
  if (known !== undefined) return known;
  const figure = humanFigureFor(look, outfitOf(look, []), null).def;
  bareFigures.set(look, figure);
  return figure;
}

/** The human hero the title shows: the run's look once there is one, the cover's look before. */
export function titleHumanFigure(): FigureDef {
  const identity = maybePlayerIdentity();
  const look =
    identity === null ? TITLE_DEFAULT_HUMAN_LOOK : HUMAN_CRAWLER_LOOKS[lookIdOf(identity)];
  return bareHumanFigure(look);
}

/** The human crawler stands facing the camera, breathing. */
export const HUMAN_IDLE_ROW = 'idle' satisfies HumanRowName;

/**
 * The crawler's stance shifts: small, head-on gestures that read as someone
 * waiting for a show to start, never as someone about to throw a punch.
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

/** The Deinonychus fully grown, the stage the title cast shows. */
export const TITLE_DEINONYCHUS_STAGE: DeinonychusStage = 'adult';

/**
 * Queues every row the title draws from the shared figure cache for baking.
 * Called during the boot loading screen so the first title frame finds them
 * warm, and again when the title lays out, since a scene re-entered from a run
 * may have let some go. The two heroes are not among them: the title paints
 * them into cells of its own (`TitleHeroCells`).
 */
export function prewarmTitleCast(): void {
  prewarmGoblinBystander(PEEKING_GOBLIN);
  prewarmDeinonychusWalk(TITLE_DEINONYCHUS_STAGE);
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
