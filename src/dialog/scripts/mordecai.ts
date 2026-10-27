/**
 * Mordecai's words: the tutorial's two scripted talks and its state-keyed
 * reminders, the post-boss debrief's fixed prose, and the per-objective floor
 * advice. The flow that decides which of these to say, and the runtime data
 * (names, counts, item lists) they're built with, stays in
 * `mordecaiAdvice.ts` and `mordecaiDebrief.ts` — this file only holds what he
 * says once that choice has been made.
 */

import { crawlerName } from '../../characters/characters';
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
  'Every achievement pays out a reward chest the moment you earn it. And it looks like you have one waiting right now! Go ahead and open it before pressing on.',
]);

export const MORDECAI_TUTORIAL_FAREWELL: DialogLine = say.line(
  'Great job! Now I think you two are ready to take on the dungeon. Stay alive and find the stairwells to progress floors. You can find your first one just below this room. Good luck!',
);

export const MORDECAI_TUTORIAL_REMINDER_OPEN_ACHIEVEMENT: DialogLine = say.line(
  'Claim your achievement first. Open your reward chest.',
);
export const MORDECAI_TUTORIAL_REMINDER_SET_UP_ITEMS: DialogLine = say.line(
  'Set up your items from the inventory menu, then come find me.',
);
export const MORDECAI_TUTORIAL_REMINDER_SMUSH_GUARDS: DialogLine = say.line(
  'Head west to the iron gate and use Smush (slot 1) on the guards behind it.',
);
export const MORDECAI_TUTORIAL_REMINDER_SPEND_POINT: DialogLine = say.line(
  'You leveled up! Tap the +1 on your level badge and spend the point on any stat.',
);
export const MORDECAI_TUTORIAL_REMINDER_THROUGH_GATE: DialogLine = say.line(
  'The gate is up. Head through it. Your partner is waiting!',
);
export const MORDECAI_TUTORIAL_REMINDER_TREASURE_ROOM: DialogLine = say.line(
  'Head to the treasure room.',
);
export const MORDECAI_TUTORIAL_REMINDER_OPEN_CHEST: DialogLine = say.line('Open the chest!');
export const MORDECAI_TUTORIAL_REMINDER_EQUIP_ABILITIES: DialogLine = say.line(
  'Equip your new abilities from the inventory first.',
);
export const MORDECAI_TUTORIAL_REMINDER_FIRE_MISSILE: DialogLine = say.line(
  'Fire your magic missile over the fence at the goblin!',
);
export const MORDECAI_TUTORIAL_REMINDER_SWITCH_BACK: DialogLine = say.line(
  `Switch back to ${crawlerName('human')}. Use the Switch button, or the switch key on a keyboard.`,
);
export const MORDECAI_TUTORIAL_REMINDER_CALL_CAT: DialogLine = say.line(
  'Use the Follower button to call the cat to you first.',
);
export const MORDECAI_TUTORIAL_REMINDER_FIND_STAIRWELL: DialogLine = say.line(
  'Find the stairwell below this room and descend to begin!',
);

// ── Post-boss debrief ────────────────────────────────────────────────────────

export const MORDECAI_DEBRIEF_TRASH_GREMLIN_CONGRATS: Paragraphs = [
  "So. The Trash Gremlin is dead, and the two of you aren't. I'll admit I had my doubts.",
  "Don't let it go to your heads. It was king of a rubbish heap, and its subjects were bugs. The dungeon noticed all the same, and the dungeon doesn't reward being noticed.",
];

export const MORDECAI_DEBRIEF_BIG_ROOSTER_CONGRATS: Paragraphs = [
  "Big Rooster is down and the two of you are still standing. That's the right way round, and not the way I'd have bet it.",
  "He'll be crowing about his arms in whatever comes after for roosters. Don't you start. The dungeon saw that, and being seen down here is never the prize it sounds like.",
];

export const MORDECAI_DEBRIEF_KRAKAREN_CONGRATS: Paragraphs = [
  "You killed the Krakaren Clone. I'll admit I had my doubts. That was no neighborhood nuisance.",
  "It was only a copy. I'd keep that to yourselves if you ever meet anyone who remembers the original. And don't let it go to your heads. The dungeon noticed, and the dungeon doesn't reward being noticed.",
];

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
 * knows about. The gateway speeches (`trash_gremlin`, `big_rooster`, `krakaren_clone`,
 * `ball_of_swine`) carry no bearing: they are spoken in the room immediately
 * before their boss, so they say where it is themselves. Every other entry
 * with a bearing ends with the same "another crawler noticed it" framing,
 * phrased so it reads correctly for all eight bearings ("North East of here",
 * not "to the North East side").
 */
export const MORDECAI_ADVICE = {
  trash_gremlin: adviceLine([
    "There's a boss through the hallway {direction}. A gremlin that lives in a room full of garbage and thinks it's royalty. Once you enter its territory, the fight will begin. That's how the dungeon likes to do things.",
    "If you're looking for the stairwell, you'll have to deal with it. There may be other bosses waiting for you as well, but this is the one in your way.",
    "Two things. When its throat starts to glow, it's about to spit acid, so move. And when it shrieks, the roaches come out of the trash piles, not out of the gremlin. Mind which piles you're standing next to.",
    "Keep your head. Under the crown and the noise it's a small, scrawny thing that would rather run than fight. It shouldn't be too difficult.",
  ]),

  big_rooster: adviceLine([
    "There's a gym ahead, {direction} of here, and the boss who owns it is a rooster. A big one. With arms. If you're heading that way you'll be going through him.",
    "Two smaller roosters keep his door. They don't lift, but they peck and they punch. The neck goes back before a peck, so watch for it.",
    "Inside, he fights with a dumbbell. Get close and he swings it like a club, and the floor shows you where it'll pass before it does. Stay well back and he throws it instead.",
    'Anywhere in between, he walks you down. Pick a distance and keep it.',
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

  stealth_gate: adviceLine(
    [
      "There's a locked gate on the way forward, and a goblin guarding it who is far too pleased with himself. He won't open it without the key.",
      "The key is in a goblin prison next door. Sneaking is the only way through that place. You can't fight your way past the guards, so don't try.",
    ],
    'Another crawler spotted the gate {direction} of here.',
  ),

  spider_lab: adviceLine(
    [
      "There's a scientist hovering at the mouth of a taped-off hallway. Lab coat, big glasses, nerves like a wet cat. He's been waiting for a crawler to wander past.",
      'Whatever he wants is optional. Nothing on the way to the stairwell needs it done. Hear him out before you decide anything.',
    ],
    'Another crawler spotted him {direction} of here.',
  ),

  spider_lab_started: adviceLine(
    [
      "I see you ignored my advice and are pursuing Dr. Moult's Pest Control job anyway. The machines in his lab have been printing something, and it doesn't look fun.",
      'I think this may be one of the more difficult encounters on this floor, and nothing on the way to the stairwell needs it done. All I can say is that if the ground looks red, then get off of it.',
    ],
    'Another crawler spotted the lab {direction} of here.',
  ),

  spider_lab_station: adviceLine([
    "Oh, it's you. Have a seat, the cot is less comfortable than it looks. A research team set this place up before they ran out of researchers.",
    "There's a scientist who keeps running past my door screaming. Back and forth, back and forth. I've stopped getting up.",
    "Whatever he wants, it's at the end of that hallway. You don't have to go. I'd think about it, if I were you.",
  ]),

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

  krasue_murders: adviceLine(
    [
      "People have been turning up in pieces. Not necessarily the pieces they started with, either. The city guard thinks it's a wild animal. It isn't.",
      "I'd recommend staying away from it. Of course, I know better than to expect you to take that advice.",
    ],
    'The killings started {direction} of here, if you insist on looking into them.',
  ),

  shady_bounties: adviceLine(
    [
      "There's a man outside the tattoo parlour in the Low Quarter offering money for killing things out in the ruins. He doesn't give his name. That's probably for the best.",
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
