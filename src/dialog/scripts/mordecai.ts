/**
 * Mordecai's words: the tutorial's two scripted talks and its state-keyed
 * reminders, the post-boss debrief's fixed prose, and the per-objective floor
 * advice. The flow that decides which of these to say, and the runtime data
 * (names, counts, item lists) they're built with, stays in
 * `mordecaiAdvice.ts` and `mordecaiDebrief.ts` — this file only holds what he
 * says once that choice has been made.
 */

import type { CardinalDirection } from '../../utils';
import type { AdviceObjectiveId } from '../../systems/mordecaiAdvice';
import { speakerLines } from '../line';
import type { DialogLine, LineText, Paragraphs } from '../line';
import type { SpeakerRef } from '../speakers';

const say = speakerLines('mordecai');

/** The speaker of a `PendingLine` for the AI chat, which has no line of its own to build from. */
export const MORDECAI_SPEAKER_REF: SpeakerRef = { kind: 'cast', id: 'mordecai' };

// ── Tutorial ─────────────────────────────────────────────────────────────────

export const MORDECAI_TUTORIAL_WELCOME: DialogLine = say.line([
  'Welcome, adventurer! I am Mordecai, a changeling, and your guide through these dungeons. My form may shift from room to room, but I will be with you every step of your journey.',
  'You will find me in every safe room you encounter. While inside a safe room, you cannot be harmed by any new attacks. Any enemy that strikes at you here will be instantly teleported back outside.',
  'Walking into any safe room immediately saves your progress, so if you die, you will return to the state you were in when you last entered a safe room on that level.',
  'This is a rather new addition to the dungeon that we have never seen before in previous games. They said it has something to do with this being a videogame or whatever.',
  'Achievement rewards can only be opened inside a safe room. And it looks like you have one waiting right now! Go ahead and open it before pressing on.',
]);

export const MORDECAI_TUTORIAL_FAREWELL: DialogLine = say.line(
  'Great job! Now I think you two are ready to take on the dungeon. Stay alive and find the stairwells to progress floors. You can find your first one just below this room. Good luck!',
);

export const MORDECAI_TUTORIAL_REMINDER_OPEN_ACHIEVEMENT: DialogLine = say.line(
  'Open your achievement notification first — tap the 🏆 banner on the left!',
);
export const MORDECAI_TUTORIAL_REMINDER_SET_UP_ITEMS: DialogLine = say.line(
  'Set up your items from the inventory menu, then come find me.',
);
export const MORDECAI_TUTORIAL_REMINDER_SMUSH_GUARDS: DialogLine = say.line(
  'Head east and use Smush (slot 1) to clear the guards.',
);
export const MORDECAI_TUTORIAL_REMINDER_THROUGH_OPENING: DialogLine = say.line(
  'Head through the opening. Your partner is waiting!',
);
export const MORDECAI_TUTORIAL_REMINDER_TREASURE_ROOM: DialogLine = say.line(
  'Head to the treasure room.',
);
export const MORDECAI_TUTORIAL_REMINDER_OPEN_CHEST: DialogLine = say.line('Open the chest!');
export const MORDECAI_TUTORIAL_REMINDER_EQUIP_ABILITIES: DialogLine = say.line(
  'Equip your new abilities from the inventory first.',
);
export const MORDECAI_TUTORIAL_REMINDER_FIRE_MISSILE: DialogLine = say.line(
  'Fire your magic missile at the goblin through the gate!',
);
export const MORDECAI_TUTORIAL_REMINDER_CALL_CAT: DialogLine = say.line(
  'Use the Follower button to call the cat to you first.',
);
export const MORDECAI_TUTORIAL_REMINDER_FIND_STAIRWELL: DialogLine = say.line(
  'Find the stairwell below this room and descend to begin!',
);

// ── Post-boss debrief ────────────────────────────────────────────────────────

export const MORDECAI_DEBRIEF_HOARDER_CONGRATS: Paragraphs = [
  "So. The Hoarder is dead, and the two of you aren't. I'll admit I had my doubts.",
  "Don't let it go to your heads. She was a neighborhood boss. The dungeon noticed all the same, and the dungeon doesn't reward being noticed.",
];

export const MORDECAI_DEBRIEF_JUICER_CONGRATS: Paragraphs = [
  "The Juicer is dead. I'll admit I had my doubts about that one. He had help, and you still walked out.",
  "Don't let it go to your heads. The dungeon noticed, and the dungeon doesn't reward being noticed. If either of you is still carrying that poison, sit down for a while.",
];

export const MORDECAI_DEBRIEF_KRAKAREN_CONGRATS: Paragraphs = [
  "You killed the Krakaren Clone. I'll admit I had my doubts. That was no neighborhood nuisance.",
  "It was only a copy. I'd keep that to yourselves if you ever meet anyone who remembers the original. And don't let it go to your heads. The dungeon noticed, and the dungeon doesn't reward being noticed.",
];

export const MORDECAI_DEBRIEF_WHERE_BOXES_OPEN = "They're under Achievements in the menu.";

/** The line spoken when both crawlers are sitting on unopened loot boxes. */
export function mordecaiDebriefBothBoxesLine(): string {
  return `You both have loot boxes you haven't opened. You're in a safe room. This is the one place you can open them, so open them. ${MORDECAI_DEBRIEF_WHERE_BOXES_OPEN}`;
}

/** The line spoken when only one crawler is sitting on unopened loot boxes. */
export function mordecaiDebriefOneBoxLine(crawlerName: string, count: number): string {
  const sittingOn = count === 1 ? 'an unopened loot box' : 'unopened loot boxes';
  const pronoun = count === 1 ? 'it' : 'them';
  return `${crawlerName}, you're sitting on ${sittingOn}. Open ${pronoun} while you're somewhere nothing can kill you. ${MORDECAI_DEBRIEF_WHERE_BOXES_OPEN}`;
}

/** The sentence opening a crawler's unworn-gear list. */
export function mordecaiDebriefGearFirstSentence(
  crawlerName: string,
  possessive: string,
  itemList: string,
): string {
  return `${crawlerName} has ${itemList} in ${possessive} bag.`;
}

/** The sentence continuing a crawler's unworn-gear list onto a further page. */
export function mordecaiDebriefGearMoreSentence(crawlerName: string, itemList: string): string {
  return `${crawlerName} is also carrying ${itemList}.`;
}

export const MORDECAI_DEBRIEF_GEAR_CLOSING =
  "Wear what you're carrying. The stat boosts are the point. Gear in a bag does nothing for anyone.";

export const MORDECAI_DEBRIEF_HUSHED_ONLY_LINE =
  'Donut, it looks like you have some unequipped items in your bag.';
export const MORDECAI_DEBRIEF_HUSHED_ALSO_LINE =
  "Donut, there's something else unworn in your bag as well.";

/** Wraps a fully assembled sequence of debrief pages as one spoken `DialogLine`. */
export function mordecaiSpokenPages(pages: ReadonlyArray<string>): DialogLine | null {
  if (pages.length === 0) return null;
  const [first, ...rest] = pages;
  return say.line([first, ...rest]);
}

// ── Floor advice ─────────────────────────────────────────────────────────────

/** Substituted with the computed bearing before an advice line is shown. */
const DIRECTION_PLACEHOLDER = '{direction}';

function mapParagraphs(pages: Paragraphs, fn: (page: string, index: number) => string): Paragraphs {
  const [first, ...rest] = pages;
  return [fn(first, 0), ...rest.map((page, index) => fn(page, index + 1))];
}

function withDirection(pages: Paragraphs, direction: CardinalDirection): Paragraphs {
  return mapParagraphs(pages, (page) => page.split(DIRECTION_PLACEHOLDER).join(direction));
}

function appendToLastPage(pages: Paragraphs, suffix: string): Paragraphs {
  const lastIndex = pages.length - 1;
  return mapParagraphs(pages, (page, index) => (index === lastIndex ? `${page} ${suffix}` : page));
}

export interface MordecaiAdviceArgs {
  /** `null` when the objective has no target to take a bearing from — the pages are shown as authored, with no substitution. */
  readonly direction: CardinalDirection | null;
}

/**
 * Builds a templated advice line: `pages` with `{direction}` substituted, and
 * — when `bearing` is given — that sentence appended to the last page, also
 * substituted. Every advice entry below is one of these.
 */
function adviceLine(pages: Paragraphs, bearing?: string): (args: MordecaiAdviceArgs) => DialogLine {
  return say.fn((args: MordecaiAdviceArgs): LineText => {
    if (args.direction === null) return pages;
    const substituted = withDirection(pages, args.direction);
    if (bearing === undefined) return substituted;
    const bearingSentence = bearing.split(DIRECTION_PLACEHOLDER).join(args.direction);
    return appendToLastPage(substituted, bearingSentence);
  });
}

/**
 * Mordecai's floor-advice prose, one entry per objective `mordecaiAdvice.ts`
 * knows about. The gateway speeches (`the_hoarder`, `juicer`, `krakaren_clone`,
 * `ball_of_swine`) carry no bearing: they are spoken in the room immediately
 * before their boss, so they say where it is themselves. Every other entry
 * with a bearing ends with the same "another crawler noticed it" framing,
 * phrased so it reads correctly for all eight bearings ("North East of here",
 * not "to the North East side").
 */
export const MORDECAI_ADVICE = {
  the_hoarder: adviceLine([
    "There's a boss through the hallway {direction}. Once you enter her territory, the fight will begin. That's how the dungeon likes to do things.",
    "If you're looking for the stairwell, you'll have to deal with her. There may be other bosses waiting for you as well, but this is the one in your way.",
    "Keep your head. She's a neighborhood boss, which puts her toward the bottom of the food chain. She shouldn't be too difficult.",
  ]),

  juicer: adviceLine([
    "There's another boss ahead, {direction} of here. You won't be able to avoid him if you're heading that way. He's another neighborhood boss, though this one looks a little nastier.",
    "I can't give you much more than that. I can tell you to watch his minions, the Troglodytes.",
    "They attack with their tongues. The poison they carry is quite unpleasant. Getting hit isn't necessarily fatal, but I'd prefer not to find out how many hits you can take.",
    "They're slow. Keep moving and don't let them corner you.",
  ]),

  defend_goblin_mother: adviceLine(
    [
      "The way forward runs through a goblin nursery. There's a mother in there with her young, and something is coming up through the floor grates at them.",
      "You can walk straight past her or help. Do it or don't. Whatever crawls out of those grates is worth experience to somebody.",
    ],
    'Another crawler spotted the nursery {direction} of here.',
  ),

  krakaren_clone: adviceLine([
    "There's a Krakaren Clone just {direction} of here. It's a copy of the Krakaren who once existed in this dungeon. A copy is still dangerous, so don't make the mistake of treating it like one.",
    "Krakaren is loud and difficult to miss, but don't let that distract you from her attacks. Watch the floor. When a tentacle starts coming up, move. If the ground beneath you turns red, move faster.",
    "She'll summon smaller tentacles to protect herself. You'll see the floor crack before they appear. Kill those first. While they're alive, you're going to have a difficult time doing any real damage to her.",
    "Krakaren is also a rather... politically complicated figure. We don't have time for that conversation right now.",
  ]),

  spider_lab: adviceLine(
    [
      'Something has gone wrong with the Arachnid Experiments. You should probably deal with it before whatever is happening in that room finds a way to become your problem somewhere else.',
      "It's one of the more difficult encounters on this floor. Watch the ground. When you see red, don't stand in it.",
    ],
    'Another crawler spotted the lab {direction} of here.',
  ),

  ball_of_swine: adviceLine([
    "There's a borough boss ahead, {direction} of here. It's considerably tougher than the fights you've dealt with so far. You can avoid it, if you're willing to look for another way around.",
    "If you kill it, though, you'll be guaranteed a stairwell to the next floor.",
    "Every boss in this dungeon has a trick. This one is a wheel made from fused swine. It rolls fast enough to turn you into paste, and it doesn't get tired. Trying to beat it by simply staying out of its way won't work.",
    "That's all I'm going to tell you. I will say this, though: nothing is unstoppable when it has nowhere to go. And that arena is made of iron.",
  ]),

  ball_of_swine_distant: adviceLine(
    [
      'Somewhere in these halls is a large iron arena. Inside it is a borough boss, a wheel made from fused swine. Borough bosses are considerably tougher than anything else on their floor, but killing one guarantees a stairwell down.',
      "It's entirely optional. If you'd rather keep all your bones where they currently are, you're free to find another way.",
    ],
    'Another crawler marked the arena {direction} of here.',
  ),

  the_circus: adviceLine(
    [
      "The circus has come to town. Given the dungeon, I wouldn't assume that's good news.",
      "You can have a look if you want. Just be careful about getting involved in anything you don't understand.",
    ],
    "It's {direction} of here.",
  ),

  krasue_murders: adviceLine(
    [
      "People have been turning up in pieces. Not necessarily the pieces they started with, either. The city guard thinks it's a wild animal. It isn't.",
      "I'd recommend staying away from it. Of course, I know better than to expect you to take that advice.",
    ],
    'The killings started {direction} of here, if you insist on looking into them.',
  ),

  shady_bounties: adviceLine(
    [
      "There's a man by the notice board offering money for killing things out in the ruins. He doesn't give his name. That's probably for the best.",
      "The money is real, at least. The targets are out where nobody cares how much noise you make. By the standards of this place, it's practically honest work.",
    ],
    'He usually loiters {direction} of here.',
  ),

  anchor_offer: adviceLine(
    [
      "There's a fortune teller in the plaza who claims she can get you home faster than walking. If you're tired of the trip, you might want to hear what she has to say.",
    ],
    'Her table is {direction} of here.',
  ),

  anchor_stone: adviceLine([
    "That stone Madame Voss made for you isn't decorative. Use it somewhere in the city and it'll pull your entire party back to the town square. Use it in the square, and it'll take you back to wherever you were standing before.",
    "It needs a little time to recover between uses. Don't expect to bounce back and forth with it indefinitely.",
  ]),

  speed_fizz_tip: adviceLine(
    [
      "The tinker sells something called Speed Fizz. Drink it and you'll move twice as fast for twenty-five seconds. Try not to waste it.",
    ],
    'His stall is {direction} of here.',
  ),
} as const satisfies Record<AdviceObjectiveId, (args: MordecaiAdviceArgs) => DialogLine>;
