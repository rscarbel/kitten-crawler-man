/**
 * The Clogged Bathroom: Grubnik the plumber, who has the hat but not the
 * knowledge, and the line of goblins waiting on a bathroom that does not
 * work. Goblins are not smart; every queue line is about one thing.
 */

import { pickLine, speakerLines } from '../../line';
import type { BarkLine, DialogLine, NonEmpty } from '../../line';
import type { BathroomPlumbing } from '../../../map/bathroomLayout';

const plumber = speakerLines('bathroomPlumber');
const queue = speakerLines('queueGoblin');

export const PLUMBER_LINES: {
  /** One conversation ending in `close`; the plumber's '!' marker clears once it is read. */
  readonly firstTalk: NonEmpty<DialogLine>;
  /** One of these per talk while the plumbing is still broken. */
  readonly repeatPool: NonEmpty<DialogLine>;
  /** Played once after the solve; reading it clears the gold '?' and completes the quest. */
  readonly thanks: NonEmpty<DialogLine>;
  /** One of these per talk once the thank-you has been read. */
  readonly afterPool: NonEmpty<DialogLine>;
} = {
  firstTalk: [
    plumber.line(
      "Oi! Crawler! See this line? Bathroom's busted. Nothing goes down, nothing comes out.",
    ),
    plumber.line(
      "I'm the plumber. I got the hat and everything. Problem is, I don't know how pipes work. Water goes in the pipe, then... more pipe? Then magic?",
    ),
    plumber.line(
      'The pipes are behind that panel on the wall. You fix the plumbing, the line moves. Line moves, you get through. Everybody wins. Mostly me.',
    ),
  ],
  repeatPool: [
    plumber.line(
      "Panel's right there. Turn the pipes till the water goes everywhere and nothing leaks. That's what I'd do. If I knew how.",
    ),
    plumber.line("I been hitting the pipes with my wrench. Doesn't help. Feels good though."),
    plumber.line("Don't look at me. I'm management now."),
  ],
  thanks: [
    plumber.line("You did it! I'm gonna tell everybody I did it."),
    plumber.line(
      "Go on, the stalls are free. You earned it. Wash your hands. Or don't. I'm not your mom.",
    ),
  ],
  afterPool: [
    plumber.line("Best plumber in the dungeon. That's me. Because of you. But me."),
    plumber.line('If anybody asks, it was a very hard job and I charged a lot.'),
  ],
};

export const QUEUE_GOBLIN_LINES: {
  /** Chatter while the bathroom is out of order. */
  readonly beforeSolvePool: NonEmpty<BarkLine>;
  /** Chatter once the line has cleared; also the relieved line a goblin says walking off to loiter. */
  readonly afterSolvePool: NonEmpty<BarkLine>;
  /** The satisfied bubble over a goblin stepping out of a stall after the solve. */
  readonly stallSighPool: NonEmpty<BarkLine>;
  /** Said by a random goblin in line when a crawler tries an out-of-order stall. */
  readonly noCutting: BarkLine;
} = {
  beforeSolvePool: [
    queue.bark('No cutting. I been here since breakfast. Maybe last breakfast.'),
    queue.bark("You see this dance? This is the important dance. Don't make me stop the dance."),
    queue.bark(
      "Why is the line not moving. Lines are supposed to move. That's the whole thing about lines.",
    ),
    queue.bark("Don't talk to me. Talking makes it worse."),
    queue.bark('I drank a whole bucket of swamp water for this. Worth it. Probably.'),
    queue.bark("Everybody's behind me except Grek. I hate Grek now."),
    queue.bark("I could go in the corner. But Mom says we got a bathroom now. We're civilized."),
    queue.bark("Is it my turn? ...It's not my turn."),
    queue.bark('Thinking about waterfalls. No. Stop. Stop thinking about waterfalls.'),
    queue.bark("The plumber's here. He's got a hat. Hat means he's good."),
    queue.bark("My legs are crossed so hard they're stuck like this."),
    queue.bark('I came down here to fight crawlers. Now I just want the toilet.'),
    queue.bark("Five more minutes and I'm using the sink."),
    queue.bark("Shh. I'm concentrating."),
    queue.bark("You smell like crawler. Go away. Unless you're a plumber. Are you a plumber?"),
    queue.bark('Ate the glowing mushrooms. Big mistake. BIG mistake.'),
    queue.bark("Line's this long 'cause Zog brought a book in there last time."),
    queue.bark('Somebody flushed and nothing happened. Then everybody got sad.'),
    queue.bark("Don't say 'drip.' Nobody say 'drip.'"),
    queue.bark("If you're gonna stand there, stand there quieter."),
  ],
  afterSolvePool: [
    queue.bark('Ahhhhh. Much better.'),
    queue.bark('Best day of my life. Top three. Top one.'),
    queue.bark("I'm gonna name my kid Plumbing."),
    queue.bark('I forgot what I was mad about. Oh yeah, you. Nah. Too relaxed.'),
    queue.bark('Wash my hands? With what? Oh. The water. Huh.'),
    queue.bark("You fixed the pipes? I still don't like you. But I like pipes."),
  ],
  stallSighPool: [
    queue.bark('Ahhhh...'),
    queue.bark("Ohhh, that's the stuff."),
    queue.bark('Sweet relief.'),
    queue.bark('Like a whole new goblin.'),
  ],
  noCutting: queue.bark('Hey! No cutting!'),
};

/** Speech-bubble reactions to a blow; the plumber and the queue each say them in their own voice. */
export const BATHROOM_HIT_BARKS: {
  readonly queue: NonEmpty<BarkLine>;
  readonly plumber: NonEmpty<BarkLine>;
} = {
  queue: [queue.bark('Ow!'), queue.bark('Ouch!'), queue.bark('Oof!')],
  plumber: [plumber.bark('Ow!'), plumber.bark('Ouch!'), plumber.bark('Oof!')],
};

/** Interaction prompt labels for the bathroom's fixtures. */
export const BATHROOM_PROMPTS = {
  useStall: 'Use the bathroom',
  stallOutOfOrder: 'Out of order',
  fixPipes: 'Fix the pipes',
} as const;

/** Odd 32-bit constants from the golden ratio and MurmurHash3's finaliser: spread consecutive seeds far apart. */
const SALT_MULTIPLIER = 0x9e3779b1;
const AVALANCHE_MULTIPLIER = 0x85ebca6b;
const AVALANCHE_SHIFT = 16;

/**
 * Combines a per-goblin seed with its talk counter so that neighbours whose
 * seeds differ by one still land on unrelated lines. Always non-negative.
 */
function saltSeed(seed: number, salt: number): number {
  let hash = Math.imul(seed ^ Math.imul(salt, SALT_MULTIPLIER), AVALANCHE_MULTIPLIER);
  hash ^= hash >>> AVALANCHE_SHIFT;
  return hash >>> 0;
}

/**
 * Picks a line from `pool` for one speaker's `talkCount`-th utterance,
 * deterministic in `speakerSeed` and `talkCount`. Never returns `previous`
 * (the line that speaker said last, compared by identity) unless the pool
 * holds nothing else, so the caller keeps the returned line as the next
 * call's `previous`.
 */
export function pickFreshLine<T>(
  pool: NonEmpty<T>,
  speakerSeed: number,
  talkCount: number,
  previous: T | null,
): T {
  const seed = saltSeed(speakerSeed, talkCount);
  const picked = pickLine(pool, seed);
  const repeatsLastLine = pool.length > 1 && picked === previous;
  return repeatsLastLine ? pickLine(pool, seed + 1) : picked;
}

/** A queue goblin's chatter for one talk, from the pool that matches the plumbing. */
export function pickQueueLine(
  plumbing: BathroomPlumbing,
  goblinSeed: number,
  talkCount: number,
  previous: BarkLine | null,
): BarkLine {
  const pool =
    plumbing === 'broken' ? QUEUE_GOBLIN_LINES.beforeSolvePool : QUEUE_GOBLIN_LINES.afterSolvePool;
  return pickFreshLine(pool, goblinSeed, talkCount, previous);
}
