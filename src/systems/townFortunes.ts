/**
 * The fortune teller's repertoire. Pure data + selection: given a snapshot of
 * quest progress, `drawFortune` returns one reading. Most draws are whimsical
 * general fortunes; some are quest-reactive omens that nod at what the player is
 * (or should be) doing, so the mystic feels like she actually sees the town's
 * troubles. The `TownPropSystem` fortune-teller prop and `FortuneTellerPanel`
 * own the prop, coin cost, and card flip — this module only picks the words.
 */

import type { TownDialogContext } from './townDialog';

const GENERAL_FORTUNES: ReadonlyArray<string> = [
  'A coin spent today returns threefold in a fortnight. Or so the cards say.',
  'Great danger walks beside great reward. You court both, I think.',
  'The crossed blades reversed — an old rival will offer an unlikely hand.',
  'I see a long road, a warm hearth at its end, and mud in between.',
  'Beware the third door you open. Or was it the second? The mists are thick today.',
  'A creature of many legs guards something you will want. Tread lightly.',
  'You will laugh before nightfall. At what, even the cards decline to say.',
  'Fortune favors the bold — and occasionally the merely lucky. Which are you?',
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
      'The tower burns in my vision — its heart beats far too fast. Still it, or we are all cinders.',
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
  const applicable = REACTIVE_FORTUNES.filter((f) => f.when(ctx));
  if (applicable.length > 0 && Math.random() < REACTIVE_DRAW_CHANCE) {
    return pick(pick(applicable).lines);
  }
  return pick(GENERAL_FORTUNES);
}
