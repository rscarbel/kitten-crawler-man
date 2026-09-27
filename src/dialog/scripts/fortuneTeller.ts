/**
 * The town's two readings. Given a snapshot of quest progress, a reader draws
 * one fortune. Most draws are whimsical general fortunes; some are
 * quest-reactive omens that nod at what the player is (or should be) doing,
 * so the mystic feels like she actually sees the town's troubles.
 * `FortuneTellerPanel` owns the coin cost and the card flip — this module only
 * picks the words.
 *
 * Two people read in this town and they are not the same act. Madame Voss works
 * the plaza with cards and showmanship. Old Hilda reads in her own kitchen for
 * less, has no cards, and tells you what she actually sees — which is mostly
 * about the curse, the ruins and the thing humming under the tower.
 */

import { pickLine, speakerLines } from '../line';
import type { BarkLine, NonEmpty } from '../line';
import { isCircusResolvedStage } from '../../core/CircusQuestProgress';
import type { TownDialogContext } from '../../systems/townDialog';

const voss = speakerLines('voss');
const hilda = speakerLines('hilda');

interface ReactiveFortune {
  readonly when: (ctx: TownDialogContext) => boolean;
  readonly lines: NonEmpty<BarkLine>;
}

export const VOSS_GENERAL_FORTUNES: NonEmpty<BarkLine> = [
  voss.bark('A coin spent today returns threefold in a fortnight. Or so the cards say.'),
  voss.bark('Great danger walks beside great reward. You court both, I think.'),
  voss.bark('The crossed blades, reversed. An old rival will offer an unlikely hand.'),
  voss.bark('I see a long road, a warm hearth at its end, and mud in between.'),
  voss.bark('Beware the third door you open. Or was it the second? The mists are thick today.'),
  voss.bark('A creature of many legs guards something you will want. Tread lightly.'),
  voss.bark('You will laugh before nightfall. At what, even the cards decline to say.'),
  voss.bark('Fortune favors the bold, and occasionally the merely lucky. Which are you?'),
  voss.bark('The moon shows me coins. Yours, leaving your purse. Toward me, perhaps.'),
  voss.bark('A small kindness you forget will be remembered by one you never meet again.'),
];

export const VOSS_REACTIVE_FORTUNES: ReadonlyArray<ReactiveFortune> = [
  {
    when: (ctx) => ctx.doomsday === 'containment' || ctx.doomsday === 'escape',
    lines: [
      voss.bark(
        'The tower burns in my vision. Its heart beats far too fast. Still it, or we are all cinders.',
      ),
      voss.bark(
        'No cards tonight. Only the smell of smoke and the ticking of a clock. RUN, if you have any sense.',
      ),
    ],
  },
  {
    when: (ctx) => ctx.murder === 'night_attack' || ctx.murder === 'cult_hideout',
    lines: [
      voss.bark(
        'A friendly face hides a hungry blade. Trust slowly, if you would keep your throat.',
      ),
      voss.bark(
        'Blood on the cobbles, and more to come. The killer is nearer than the town believes.',
      ),
    ],
  },
  {
    // The stage alone, not `quillNamed`. That flag latches when the letter
    // naming the schoolteacher is read on the street, and only a checkpoint
    // rewind clears it, so a fortune keyed to it would keep urging the player
    // after a woman they have already killed — every stage past
    // `confrontation` is a stage where she is dead.
    when: (ctx) => ctx.murder === 'confrontation',
    lines: [
      voss.bark('The knife has a name at last. Cut the thread before it wraps the whole town.'),
    ],
  },
  {
    when: (ctx) =>
      ctx.circus === 'ritual_defense' ||
      ctx.circus === 'heather_hunt' ||
      ctx.circus === 'assault' ||
      ctx.circus === 'bigtop_ready',
    lines: [
      voss.bark(
        'A caged bird sings beneath the striped canvas. Free it, and a daughter’s grief with it.',
      ),
      voss.bark('The ringmaster smiles with too many teeth. His grip will not loosen on its own.'),
    ],
  },
  {
    when: (ctx) => ctx.doomsday === 'complete',
    lines: [
      voss.bark('I see a hero where a stranger once stood. The cards have never been so bright.'),
    ],
  },
  {
    when: (ctx) =>
      isCircusResolvedStage(ctx.circus) &&
      (ctx.murder === 'complete' || ctx.murder === 'lich_slain'),
    lines: [
      voss.bark('Two shadows lifted, and your hand behind both. Fortune knows your face now.'),
    ],
  },
];

// Roughly half of readings reach for a quest-reactive omen when one applies; the
// rest are whimsical, so the mystic doesn't parrot the same warning every draw.
const REACTIVE_DRAW_CHANCE = 0.5;

function drawFrom(
  general: NonEmpty<BarkLine>,
  reactive: ReadonlyArray<ReactiveFortune>,
  ctx: TownDialogContext,
): string {
  const applicable = reactive.filter((fortune) => fortune.when(ctx));
  if (applicable.length > 0 && Math.random() < REACTIVE_DRAW_CHANCE) {
    const [first, ...rest] = applicable;
    const pool: NonEmpty<ReactiveFortune> = [first, ...rest];
    const chosen = pickLine(pool, Math.random() * pool.length);
    return pickLine(chosen.lines, Math.random() * chosen.lines.length).paragraphs[0];
  }
  return pickLine(general, Math.random() * general.length).paragraphs[0];
}

/** Draw a single fortune for the current world state. */
export function drawFortune(ctx: TownDialogContext): string {
  return drawFrom(VOSS_GENERAL_FORTUNES, VOSS_REACTIVE_FORTUNES, ctx);
}

// -- Old Hilda's kitchen reading --------------------------------------------

export const HILDA_GENERAL_READINGS: NonEmpty<BarkLine> = [
  hilda.bark(
    'Sit. Hands on the table. ...You are going to be fine, which is more than I usually get to say.',
  ),
  hilda.bark(
    'There is a door you have not opened because it looked like a wall. It is not a wall.',
  ),
  hilda.bark(
    'Something you are carrying was made by someone who is dead now. Most things are. This one minds.',
  ),
  hilda.bark(
    'You will be offered a bargain by someone who is smiling. Take it. Just read it twice.',
  ),
  hilda.bark(
    'The ruins remember the street plan even where the streets are gone. Walk the old lines and you will not get lost.',
  ),
  hilda.bark(
    'You have killed something this week that had a name. Nothing to be done about it now.',
  ),
  hilda.bark(
    'Water first, then whatever you were going to do. You are no good to anyone dried out.',
  ),
  hilda.bark(
    'I see the number three, and I have no idea what it means, and I am not going to invent something.',
  ),
  hilda.bark('Someone in this town is lying to you kindly. Let them. It costs you nothing yet.'),
  hilda.bark('Old bones tell weather, not futures. Rain by evening. That is my honest reading.'),
];

export const HILDA_REACTIVE_READINGS: ReadonlyArray<ReactiveFortune> = [
  {
    when: (ctx) => ctx.doomsday === 'containment' || ctx.doomsday === 'escape',
    lines: [
      hilda.bark(
        'The humming has stopped. Forty years it hummed. Whatever you are going to do, do it running.',
      ),
      hilda.bark('No reading. Get out of my kitchen and get up that tower.'),
    ],
  },
  {
    when: (ctx) => ctx.doomsday === 'complete',
    lines: [
      hilda.bark('It hums again. Quieter. Whatever you put back in that box, it is sleeping.'),
      hilda.bark(
        'I have nothing to warn you about for the first time in forty years. I do not know what to do with my hands.',
      ),
    ],
  },
  {
    when: (ctx) => ctx.murder === 'confrontation',
    lines: [
      hilda.bark(
        'She has a name now, and a name is a handle. Take hold of it before she puts it down.',
      ),
      hilda.bark(
        'The one doing the killing is not the one who wants the killing done. Do not stop at the knife.',
      ),
    ],
  },
  {
    when: (ctx) =>
      ctx.murder === 'night_attack' ||
      ctx.murder === 'cult_hideout' ||
      ctx.murder === 'investigation',
    lines: [
      hilda.bark(
        'Heads without bodies. That is not a beast, that is a recipe, and somebody is following it.',
      ),
      hilda.bark(
        'Look at the low streets, not the plaza. The plaza never had anything worth taking.',
      ),
    ],
  },
  {
    when: (ctx) =>
      ctx.circus === 'ritual_defense' ||
      ctx.circus === 'heather_hunt' ||
      ctx.circus === 'assault' ||
      ctx.circus === 'bigtop_ready',
    lines: [
      hilda.bark(
        'The vine under that tent is not keeping them alive. It is keeping them from finishing dying.',
      ),
      hilda.bark(
        'You will want to swing at it. Do not. What is under that bark was somebody once, and still answers to it.',
      ),
    ],
  },
  {
    when: (ctx) => isCircusResolvedStage(ctx.circus),
    lines: [
      hilda.bark(
        'The lights are out over the Big Top. I had forgotten what that side of the sky looked like.',
      ),
    ],
  },
];

/** Hilda's reading — the same machinery, a darker and more specific voice. */
export function drawHildaReading(ctx: TownDialogContext): string {
  return drawFrom(HILDA_GENERAL_READINGS, HILDA_REACTIVE_READINGS, ctx);
}
