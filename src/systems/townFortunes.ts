/**
 * The town's two readings. Pure data + selection: given a snapshot of quest
 * progress, a reader's `draw` returns one reading. Most draws are whimsical
 * general fortunes; some are quest-reactive omens that nod at what the player is
 * (or should be) doing, so the mystic feels like she actually sees the town's
 * troubles. `FortuneTellerPanel` owns the coin cost and the card flip — this
 * module only picks the words.
 *
 * Two people read in this town and they are not the same act. Madame Voss works
 * the plaza with cards and showmanship. Old Hilda reads in her own kitchen for
 * less, has no cards, and tells you what she actually sees — which is mostly
 * about the curse, the ruins and the thing humming under the tower.
 */

import type { TownDialogContext } from './townDialog';

const GENERAL_FORTUNES: ReadonlyArray<string> = [
  'A coin spent today returns threefold in a fortnight. Or so the cards say.',
  'Great danger walks beside great reward. You court both, I think.',
  'The crossed blades, reversed. An old rival will offer an unlikely hand.',
  'I see a long road, a warm hearth at its end, and mud in between.',
  'Beware the third door you open. Or was it the second? The mists are thick today.',
  'A creature of many legs guards something you will want. Tread lightly.',
  'You will laugh before nightfall. At what, even the cards decline to say.',
  'Fortune favors the bold, and occasionally the merely lucky. Which are you?',
  'The moon shows me coins. Yours, leaving your purse. Toward me, perhaps.',
  'A small kindness you forget will be remembered by one you never meet again.',
];

interface ReactiveFortune {
  when: (ctx: TownDialogContext) => boolean;
  lines: ReadonlyArray<string>;
}

const REACTIVE_FORTUNES: ReadonlyArray<ReactiveFortune> = [
  {
    when: (ctx) => ctx.doomsday === 'containment' || ctx.doomsday === 'escape',
    lines: [
      'The tower burns in my vision. Its heart beats far too fast. Still it, or we are all cinders.',
      'No cards tonight. Only the smell of smoke and the ticking of a clock. RUN, if you have any sense.',
    ],
  },
  {
    when: (ctx) => ctx.murder === 'night_attack' || ctx.murder === 'cult_hideout',
    lines: [
      'A friendly face hides a hungry blade. Trust slowly, if you would keep your throat.',
      'Blood on the cobbles, and more to come. The killer is nearer than the town believes.',
    ],
  },
  {
    when: (ctx) => ctx.murder === 'confrontation' || ctx.quillNamed,
    lines: ['The knife has a name at last. Cut the thread before it wraps the whole town.'],
  },
  {
    when: (ctx) =>
      ctx.circus === 'ritual_defense' ||
      ctx.circus === 'heather_hunt' ||
      ctx.circus === 'assault' ||
      ctx.circus === 'bigtop_ready',
    lines: [
      'A caged bird sings beneath the striped canvas. Free it, and a daughter’s grief with it.',
      'The ringmaster smiles with too many teeth. His grip will not loosen on its own.',
    ],
  },
  {
    when: (ctx) => ctx.doomsday === 'complete',
    lines: ['I see a hero where a stranger once stood. The cards have never been so bright.'],
  },
  {
    when: (ctx) =>
      (ctx.circus === 'complete' || ctx.circus === 'grimaldi_slain') &&
      (ctx.murder === 'complete' || ctx.murder === 'quill_slain'),
    lines: ['Two shadows lifted, and your hand behind both. Fortune knows your face now.'],
  },
];

// Roughly half of readings reach for a quest-reactive omen when one applies; the
// rest are whimsical, so the mystic doesn't parrot the same warning every draw.
const REACTIVE_DRAW_CHANCE = 0.5;

function pick<T>(pool: ReadonlyArray<T>): T {
  return pool[Math.floor(Math.random() * pool.length)];
}

/** Draw a single fortune for the current world state. */
export function drawFortune(ctx: TownDialogContext): string {
  return drawFrom(GENERAL_FORTUNES, REACTIVE_FORTUNES, ctx);
}

function drawFrom(
  general: ReadonlyArray<string>,
  reactive: ReadonlyArray<ReactiveFortune>,
  ctx: TownDialogContext,
): string {
  const applicable = reactive.filter((f) => f.when(ctx));
  if (applicable.length > 0 && Math.random() < REACTIVE_DRAW_CHANCE) {
    return pick(pick(applicable).lines);
  }
  return pick(general);
}

// -- Old Hilda's kitchen reading --------------------------------------------

const HILDA_GENERAL_READINGS: ReadonlyArray<string> = [
  'Sit. Hands on the table. ...You are going to be fine, which is more than I usually get to say.',
  'There is a door you have not opened because it looked like a wall. It is not a wall.',
  'Something you are carrying was made by someone who is dead now. Most things are. This one minds.',
  'You will be offered a bargain by someone who is smiling. Take it. Just read it twice.',
  'The ruins remember the street plan even where the streets are gone. Walk the old lines and you will not get lost.',
  'You have killed something this week that had a name. Nothing to be done about it now.',
  'Water first, then whatever you were going to do. You are no good to anyone dried out.',
  'I see the number three, and I have no idea what it means, and I am not going to invent something.',
  'Someone in this town is lying to you kindly. Let them. It costs you nothing yet.',
  'Old bones tell weather, not futures. Rain by evening. That is my honest reading.',
];

const HILDA_REACTIVE_READINGS: ReadonlyArray<ReactiveFortune> = [
  {
    when: (ctx) => ctx.doomsday === 'containment' || ctx.doomsday === 'escape',
    lines: [
      'The humming has stopped. Forty years it hummed. Whatever you are going to do, do it running.',
      'No reading. Get out of my kitchen and get up that tower.',
    ],
  },
  {
    when: (ctx) => ctx.doomsday === 'complete',
    lines: [
      'It hums again. Quieter. Whatever you put back in that box, it is sleeping.',
      'I have nothing to warn you about for the first time in forty years. I do not know what to do with my hands.',
    ],
  },
  {
    when: (ctx) => ctx.murder === 'confrontation' || ctx.quillNamed,
    lines: [
      'She has a name now, and a name is a handle. Take hold of it before she puts it down.',
      'The one doing the killing is not the one who wants the killing done. Do not stop at the knife.',
    ],
  },
  {
    when: (ctx) =>
      ctx.murder === 'night_attack' ||
      ctx.murder === 'cult_hideout' ||
      ctx.murder === 'investigation',
    lines: [
      'Heads without bodies. That is not a beast, that is a recipe, and somebody is following it.',
      'Look at the low streets, not the plaza. The plaza never had anything worth taking.',
    ],
  },
  {
    when: (ctx) =>
      ctx.circus === 'ritual_defense' ||
      ctx.circus === 'heather_hunt' ||
      ctx.circus === 'assault' ||
      ctx.circus === 'bigtop_ready',
    lines: [
      'The vine under that tent is not keeping them alive. It is keeping them from finishing dying.',
      'Kill the root, not the family. If you cannot tell which is which, wait until you can.',
    ],
  },
  {
    when: (ctx) => ctx.circus === 'grimaldi_slain' || ctx.circus === 'complete',
    lines: [
      'The lights are out over the Big Top. I had forgotten what that side of the sky looked like.',
    ],
  },
];

/** Hilda's reading — the same machinery, a darker and more specific voice. */
export function drawHildaReading(ctx: TownDialogContext): string {
  return drawFrom(HILDA_GENERAL_READINGS, HILDA_REACTIVE_READINGS, ctx);
}
