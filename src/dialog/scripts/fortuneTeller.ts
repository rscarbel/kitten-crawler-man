/**
 * The town's two readings. Given a snapshot of quest progress, a reader draws
 * one fortune. Most draws are whimsical general fortunes; some are
 * quest-reactive omens that nod at what the player is (or should be) doing,
 * so the mystic feels like she actually sees the town's troubles.
 * `FortuneTable` owns the coin cost and the card flip — this module only
 * picks the words.
 *
 * Two people read in this town and they are not the same act. Madame Voss works
 * the plaza with cards and showmanship. Old Lori reads in her own kitchen for
 * less, has no cards, and tells you what she actually sees — which is mostly
 * about the curse, the ruins and the thing humming under the tower.
 */

import { pickLine, speakerLines } from '../line';
import type { BarkLine, NonEmpty } from '../line';
import type { TownDialogContext } from '../../systems/townDialog';

const voss = speakerLines('voss');
const lori = speakerLines('lori');

interface ReactiveFortune {
  readonly when: (ctx: TownDialogContext) => boolean;
  readonly lines: NonEmpty<BarkLine>;
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

export const VOSS_REACTIVE_FORTUNES: ReadonlyArray<ReactiveFortune> = [
  {
    when: (ctx) => ctx.doomsday === 'containment' || ctx.doomsday === 'escape',
    lines: [
      voss.bark(
        'The tower burns in my vision, dear, and its heart beats far too fast. Still it, or we are all cinders together.',
      ),
      voss.bark(
        'No cards tonight — only the smell of smoke and the ticking of some terrible clock. Run, child, if you have any sense left in you.',
      ),
    ],
  },
  {
    when: (ctx) => ctx.murder === 'night_attack' || ctx.murder === 'cult_hideout',
    lines: [
      voss.bark(
        'A friendly face hides a hungry blade tonight, dear. Trust slowly, if you would keep your throat.',
      ),
      voss.bark(
        'Blood on the cobbles, and more of it coming. The killer is nearer than this town believes.',
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
      voss.bark(
        'The knife has a name at last, dear. Cut the thread before it wraps the whole town round its fist.',
      ),
    ],
  },
  {
    when: (ctx) => ctx.doomsday === 'complete',
    lines: [
      voss.bark(
        'I see a hero where a stranger once stood. The cards have never once shown me anything so bright, child.',
      ),
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

export const LORI_REACTIVE_READINGS: ReadonlyArray<ReactiveFortune> = [
  {
    when: (ctx) => ctx.doomsday === 'containment' || ctx.doomsday === 'escape',
    lines: [
      lori.bark(
        'The humming has stopped, dearie. Forty years it hummed and now it has not. Whatever you are going to do, do it running.',
      ),
      lori.bark('No reading tonight. Get out of my kitchen and get up that tower.'),
    ],
  },
  {
    when: (ctx) => ctx.doomsday === 'complete',
    lines: [
      lori.bark(
        'It hums again, quieter now. Whatever you put back in that box, dearie, it is sleeping.',
      ),
      lori.bark(
        'First time in forty years I have nothing to warn you about, and I do not rightly know what to do with my hands.',
      ),
    ],
  },
  {
    when: (ctx) => ctx.murder === 'confrontation',
    lines: [
      lori.bark(
        'She has a name now, dearie, and a name is a handle. Take hold of it before she sets it back down.',
      ),
      lori.bark(
        'The one doing the killing is not the one who wants it done. Do not stop at the knife.',
      ),
    ],
  },
  {
    when: (ctx) =>
      ctx.murder === 'night_attack' ||
      ctx.murder === 'cult_hideout' ||
      ctx.murder === 'investigation',
    lines: [
      lori.bark(
        'No beast leaves heads without bodies, dearie. That takes a recipe, and somebody down there is following it proper.',
      ),
      lori.bark(
        'Look to the low streets, not the plaza, dearie. The plaza never had anything worth taking.',
      ),
    ],
  },
];

/** Lori's reading — the same machinery, a darker and more specific voice. */
export function drawLoriReading(ctx: TownDialogContext): string {
  return drawFrom(LORI_GENERAL_READINGS, LORI_REACTIVE_READINGS, ctx);
}
