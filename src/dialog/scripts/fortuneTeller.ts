/**
 * The town's two readings. A reader draws one fortune: most are their general
 * pool, and some are reactive readings that see what "A Cat Always Comes Back"
 * has come to, so a reader seems to know the town's trouble. Each reading
 * holds one fact. `FortuneTable` owns the coin cost and the card flip; this
 * module only picks the words.
 *
 * Two people read in this town and they are not the same act. Madame Voss works
 * the plaza with cards and showmanship. Old Lori reads in her own kitchen for
 * less, has no cards, and tells you what she actually sees, which is mostly
 * about the bad year and the ruins it left.
 */

import { pickLine, speakerLines } from '../line';
import type { BarkLine, NonEmpty } from '../line';
import type { TownDialogContext } from '../../systems/townDialog';
import { phaseReached } from '../../core/quests/missingCatsProgress';

const voss = speakerLines('voss');
const lori = speakerLines('lori');

interface ReactiveFortune {
  readonly when: (ctx: TownDialogContext) => boolean;
  readonly lines: NonEmpty<BarkLine>;
}

/** Whether the town's cats are still being taken: from the first one gone until the party is split. */
function catsBeingTaken(ctx: TownDialogContext): boolean {
  return !phaseReached(ctx.missingCats, 'captured');
}

/** Whether Belle is in the tower and the cats are not yet home. */
function belleInTheTower(ctx: TownDialogContext): boolean {
  return phaseReached(ctx.missingCats, 'captured') && !phaseReached(ctx.missingCats, 'aftermath');
}

function catsHome(ctx: TownDialogContext): boolean {
  return phaseReached(ctx.missingCats, 'aftermath');
}

export const VOSS_GENERAL_FORTUNES: NonEmpty<BarkLine> = [
  voss.bark(
    'A coin spent today returns threefold in a fortnight, or so the cards insist, my dear.',
  ),
  voss.bark('Great danger walks beside great reward, child, and you keep company with both.'),
  voss.bark('The crossed blades, reversed! An old rival will offer you an unlikely hand.'),
  voss.bark(
    'I see a long road, dear one, a warm hearth waiting at its end, and no small amount of mud between here and there.',
  ),
  voss.bark(
    'Beware the third door you open. Or was it the second? The mists are thick with me today.',
  ),
  voss.bark(
    'A creature of many legs guards something you will want badly. Tread lightly, my dear, and mind your feet.',
  ),
  voss.bark('You will laugh before nightfall, dear. At what, even the cards decline to say.'),
  voss.bark(
    'Fortune favours the bold, and now and then the merely lucky. Which are you, I wonder?',
  ),
  voss.bark(
    'The moon shows me coins, child. Yours, leaving your purse. Toward me, perhaps, if the moon has any say in the matter.',
  ),
  voss.bark(
    'A small kindness you forget will be remembered by someone you never meet again, dear — the cards are quite insistent on that point.',
  ),
];

const VOSS_REACTIVE_FORTUNES: ReadonlyArray<ReactiveFortune> = [
  {
    when: catsBeingTaken,
    lines: [
      voss.bark(
        'The Queen of Cups, with a feather lying across her. Something in this town is being carried off, dear, and it does not struggle.',
      ),
    ],
  },
  {
    when: (ctx) => ctx.missingCats.phase === 'blame',
    lines: [
      voss.bark(
        'Every card points down tonight, child. Cellars, drains, the dark under the street. Whether the guilty are down there, the cards decline to say.',
      ),
    ],
  },
  {
    when: (ctx) => ctx.missingCats.phase === 'stakeout',
    lines: [
      voss.bark(
        'Dusk, a counter, and wings over a roof. Sit very still, my dear, and you will see it.',
      ),
    ],
  },
  {
    when: belleInTheTower,
    lines: [
      voss.bark(
        'Your little cat is in the Tower card tonight, dear, curled at the foot of it, and the door is drawn shut.',
      ),
    ],
  },
  {
    when: catsHome,
    lines: [
      voss.bark(
        'Every cat in town sits on the Hearth card tonight, child. In thirty years I have never once drawn it full.',
      ),
    ],
  },
];

// Roughly half of readings reach for a reactive one when one applies; the
// rest come from the general pool, so a reader doesn't repeat the same omen every draw.
const REACTIVE_DRAW_CHANCE = 0.5;

function drawFrom(
  general: NonEmpty<BarkLine>,
  reactive: ReadonlyArray<ReactiveFortune>,
  ctx: TownDialogContext,
): string {
  const matching = reactive.filter((fortune) => fortune.when(ctx));
  if (matching.length > 0 && Math.random() < REACTIVE_DRAW_CHANCE) {
    const [first, ...rest] = matching;
    const applicable: NonEmpty<ReactiveFortune> = [first, ...rest];
    const chosen = pickLine(applicable, Math.random() * applicable.length);
    return pickLine(chosen.lines, Math.random() * chosen.lines.length).paragraphs[0];
  }
  return pickLine(general, Math.random() * general.length).paragraphs[0];
}

/** Draw a single fortune for the current world state. */
export function drawFortune(ctx: TownDialogContext): string {
  return drawFrom(VOSS_GENERAL_FORTUNES, VOSS_REACTIVE_FORTUNES, ctx);
}

// -- Old Lori's kitchen reading --------------------------------------------

export const LORI_GENERAL_READINGS: NonEmpty<BarkLine> = [
  lori.bark(
    'Sit, dearie, hands on the table.. You are going to be fine, which is more than I usually get to say.',
  ),
  lori.bark(
    'There is a door you have not opened because it looked like a wall, and it is not a wall, dearie, whatever it looks like.',
  ),
  lori.bark(
    'Something you are carrying was made by somebody who is dead now. Most things are, I suppose. This one minds, though.',
  ),
  lori.bark(
    'You will be offered a bargain by someone who is smiling. Take it, dearie, only read it twice first.',
  ),
  lori.bark(
    'The ruins remember the street plan even where the streets themselves are long gone. Walk the old lines and you will not get lost.',
  ),
  lori.bark(
    'You have killed something this week that had a name, I think. Nothing to be done about that now, dearie.',
  ),
  lori.bark(
    'Water first, then whatever it was you were about to do. You are no good to anyone dried out.',
  ),
  lori.bark(
    'I see the number three, and I have not the faintest idea what it means, and I am not going to invent something just to fill the silence.',
  ),
  lori.bark(
    'Someone in this town is lying to you kindly, dearie. Let them. It costs you nothing yet.',
  ),
  lori.bark(
    'Old bones tell weather, not futures. Rain by evening. That is my honest reading and I will not dress it up as more..',
  ),
];

const LORI_REACTIVE_READINGS: ReadonlyArray<ReactiveFortune> = [
  {
    when: catsBeingTaken,
    lines: [
      lori.bark(
        'I see a little window over a garden, dearie, and something with wings at it. The cards will not show me the rest.',
      ),
    ],
  },
  {
    when: (ctx) => ctx.missingCats.phase === 'blame',
    lines: [
      lori.bark('Look up, dearie. Everybody in this town is staring down a hole for those cats.'),
    ],
  },
  {
    when: belleInTheTower,
    lines: [
      lori.bark(
        'Your little one is up high and cross about it, dearie. She is not hurt. I would know.',
      ),
    ],
  },
  {
    when: catsHome,
    lines: [
      lori.bark(
        'Thimble is asleep on my reading cloth and I am not moving her for any fortune. You will be fine, dearie. Go on.',
      ),
    ],
  },
];

/** Lori's reading: the same draw, a darker and more specific voice. */
export function drawLoriReading(ctx: TownDialogContext): string {
  return drawFrom(LORI_GENERAL_READINGS, LORI_REACTIVE_READINGS, ctx);
}
