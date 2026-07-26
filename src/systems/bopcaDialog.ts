/**
 * Everything a Bopca says, and everything it serves. Pure data plus selectors —
 * no rendering, no game state mutation.
 *
 * The character lives or dies on these tables. A Bopca is contractually obliged
 * to feed a crawler and resents every plate of it, so the human hears clipped,
 * insulted, passive-aggressive lines; the cat hears the same Bopca turn into a
 * doting grandparent. Playing the same request twice, once as each character,
 * should be legible as a joke without any explanation.
 *
 * Canon anchored in the source material: they are genuinely good cooks and proud
 * of it, they never wash their hands, they get a physical newsletter rather than
 * the newsfeed, and they may discuss safe rooms but not the Dungeon at large.
 *
 * Every `Just chatting` answer has to stand on its own. The player picks a topic
 * from a button and then sees only the reply, so a line that reads as the second
 * half of a conversation — "Not permitted. And I would not tell you if it were."
 * — lands as the Bopca answering a question that was never on screen. Each answer
 * restates enough of its own question to be legible cold.
 */

import type { DishVisual } from '../sprites/safeRoomCounter';

/** Who the Bopca is currently talking to. */
export type BopcaTone = 'toHuman' | 'toCat';

export type BopcaTopic =
  | 'greeting'
  | 'orderFood'
  | 'serving'
  | 'thanked'
  | 'dishLeftCold'
  | 'aboutSafeRoom'
  | 'aboutDungeon'
  | 'aboutSelf'
  | 'repeatOrder';

/**
 * A line table that is provably non-empty, so indexing into it yields `string`
 * and never `string | undefined` — the type-safety note in the plan, enforced by
 * the type rather than by a `??` at every call site.
 */
type LineTable = readonly [string, ...string[]];

export type DishId =
  | 'moss_broth_stew'
  | 'root_and_bone_soup'
  | 'grub_skewers'
  | 'hard_yellow_cheese'
  | 'black_bread_and_dripping'
  | 'spiced_gruel'
  | 'fried_cave_fish'
  | 'honeyed_tubers'
  | 'pickled_eggs'
  | 'mushroom_hash'
  | 'green_aspic'
  | 'yesterdays_stew';

export interface DishDef {
  /** How the Bopca names it, dropped into the serving line. */
  name: string;
  visual: DishVisual;
}

/**
 * The dish table. Every dish heals the same amount — the variety is entirely
 * flavour, so a player can never feel they rolled a bad meal.
 *
 * Structured as a `Record<DishId, DishDef>` mirroring `ITEM_DEF`, which is also
 * what makes the union exhaustive: adding a `DishId` without a definition is a
 * compile error.
 */
export const DISH_DEF: Record<DishId, DishDef> = {
  moss_broth_stew: {
    name: 'moss-broth stew',
    visual: {
      shape: 'bowl',
      vesselColor: '#e0d7c0',
      contentColor: '#5f7a3c',
      garnishColor: '#9fc46a',
    },
  },
  root_and_bone_soup: {
    name: 'root-and-bone soup',
    visual: {
      shape: 'bowl',
      vesselColor: '#d8cdb4',
      contentColor: '#9a6a34',
      garnishColor: '#e2d2a8',
    },
  },
  grub_skewers: {
    name: 'grub skewers',
    visual: { shape: 'skewer', vesselColor: '#c9a86a', contentColor: '#c8a2a8' },
  },
  hard_yellow_cheese: {
    name: 'a wedge of hard yellow cheese',
    visual: { shape: 'wedge', vesselColor: '#8a6a42', contentColor: '#e0b743' },
  },
  black_bread_and_dripping: {
    name: 'black bread with dripping',
    visual: {
      shape: 'plate',
      vesselColor: '#cfc4ab',
      contentColor: '#4a3524',
      garnishColor: '#e8c877',
    },
  },
  spiced_gruel: {
    name: 'spiced gruel',
    visual: { shape: 'bowl', vesselColor: '#dcd2bb', contentColor: '#c2a06a' },
  },
  fried_cave_fish: {
    name: 'fried cave-fish',
    visual: {
      shape: 'plate',
      vesselColor: '#d4cbb6',
      contentColor: '#c88a48',
      garnishColor: '#7fa356',
    },
  },
  honeyed_tubers: {
    name: 'honeyed tubers',
    visual: {
      shape: 'plate',
      vesselColor: '#cfc0a2',
      contentColor: '#d59a3a',
      garnishColor: '#f0d68a',
    },
  },
  pickled_eggs: {
    name: 'pickled eggs',
    visual: { shape: 'bowl', vesselColor: '#c8cfc4', contentColor: '#eee4c8' },
  },
  mushroom_hash: {
    name: 'mushroom hash',
    visual: {
      shape: 'plate',
      vesselColor: '#d2c8b2',
      contentColor: '#7a5a3e',
      garnishColor: '#a8b878',
    },
  },
  green_aspic: {
    name: 'a wobbling green aspic',
    visual: { shape: 'plate', vesselColor: '#d6d0bc', contentColor: '#7fae62' },
  },
  yesterdays_stew: {
    name: "yesterday's stew, but better",
    visual: {
      shape: 'mug',
      vesselColor: '#b8916a',
      contentColor: '#6a4c2e',
    },
  },
};

const ALL_DISH_IDS: ReadonlyArray<DishId> = Object.keys(DISH_DEF).filter(isDishId);

function isDishId(candidate: string): candidate is DishId {
  return candidate in DISH_DEF;
}

/**
 * The names a safe room's attendant can be called, picked by room index.
 *
 * Cheap, and the single change that stops the Bopca reading as one repeated prop:
 * the attendant on floor two is Molvo, and Molvo is not Grennick.
 */
const BOPCA_NAMES: LineTable = [
  'Grennick',
  'Molvo',
  'Hessup',
  'Brannick',
  'Tolm',
  'Ospreth',
  'Durvo',
  'Grask',
  'Yennil',
  'Mubb',
];

/** The attendant's name for a given safe room, stable across visits. */
export function bopcaNameForRoom(roomIndex: number): string {
  return BOPCA_NAMES[Math.abs(Math.trunc(roomIndex)) % BOPCA_NAMES.length];
}

/**
 * `{dish}` is replaced with the served dish's name and `{name}` with the
 * attendant's own, so a line can be specific without the table needing one
 * variant per dish.
 */
const DISH_PLACEHOLDER = '{dish}';
const NAME_PLACEHOLDER = '{name}';

const LINES: Record<BopcaTone, Record<BopcaTopic, LineTable>> = {
  toHuman: {
    greeting: [
      'Yes. You. Standing there. What.',
      "Safe room's safe. Food's free. Nothing else is your business.",
      'Every floor. Every floor there is one of you, and it is always hungry.',
      'I am obliged to greet you. Consider yourself greeted.',
      'Do not touch the counter. I just did the counter.',
      'You want something, or are you just breathing at me?',
      'I have read the contract. It says I feed you. It does not say I enjoy it.',
    ],
    orderFood: [
      "Food. Of course. Never 'good evening', never 'how is the counter'. Food.",
      'It is free. It has always been free. You still ask as though it were a favour.',
      'Fine. Sit down. Do not hover. Hovering does not cook it faster.',
      'One portion. One. I am counting, whatever the contract says.',
      'The stock has been on since the last of you. It never gets to rest either.',
      "I'll make it. I'll make it well, because I'm not a savage. Do not thank me.",
    ],
    serving: [
      '{dish}. Eat it. Do not look at it, eat it.',
      "{dish}. Twenty-one years I've made that, and it is wasted on you.",
      'There. {dish}. Hot. It will not be hot for long, and that is on you.',
      '{dish}. I would explain the reduction, but you would not follow it.',
      '{dish}. Yes, I know it looks like that. Taste it before you make that face.',
      '{dish}, and it is the best thing that will happen to you on this floor.',
    ],
    thanked: [
      'Mm.',
      'Do not.',
      'You ate it. That is thanks enough and more than I expected.',
      'Say nothing. Just put the bowl back on the counter when you are done with it.',
      'I am not moved. I want you to know that I am not moved.',
      'Fine. It was good. I knew it was good before you told me.',
    ],
    dishLeftCold: [
      'It is going cold. I can see it going cold from here.',
      'That took me half an hour of stock and you have left it to congeal.',
      'You asked for it. It is there. It is getting worse by the second.',
      'The aspic sets. That is what aspic does when it is ignored.',
      'I will not make another. I will, because I must, and I will hate it.',
      'Cold food. On my counter. In front of me.',
    ],
    aboutSafeRoom: [
      'This room? Nothing gets into it. Not a mob, not a boss, not one of your ideas.',
      'The bed in the corner is for sleeping in. My floor is for walking on. I have had to say that before.',
      'You may rest here, eat here, and then leave here. In that order, and quickly.',
      'Safe rooms I am permitted to discuss. So: it is a room, and it is safe. There is your discussion.',
      'Every safe room has one of us in it, and every one of them is cleaner than you deserve.',
      'A room of your own you buy on the fourth floor — a Personal Space. Bring money and stop asking me.',
    ],
    aboutDungeon: [
      'You want to know about the Dungeon. I may not tell you, and I would not if I could.',
      'I am a non-combatant. Non-combatants do not brief crawlers on what is waiting downstairs.',
      'Take that question to the one in the tuxedo. He is paid to enjoy answering it. I am not.',
      'The contract lists what I may talk about. The Dungeon is not on the list. The soup is.',
      'All I get is the newsletter, and the newsletter is advertisements and a crossword. No maps.',
      'No. And before you ask the same thing in a different voice: still no.',
    ],
    aboutSelf: [
      'What I am is a Bopca, and what a Bopca does is keep a safe room. That is the whole of the job.',
      'We Bopcas signed with the Syndicate. Our worlds are still standing. Yours is not. Work it out.',
      'Yes, I cook without washing my hands. Twenty-one years, and nobody has died of it yet.',
      'I am level fifty-one, since you have asked. It would do you no good at all to know that.',
      'The wet moss you can smell is me. Every Bopca smells of it. No Bopca wants it mentioned.',
      'I own a newsletter, a counter and a contract. It is enough, and it is more than you own.',
    ],
    repeatOrder: [
      'Again. Of course again.',
      'That is two. I want it on the record that that is two.',
      'You are not a crawler, you are a mouth with a sword.',
      'The larder is not infinite. It is, in fact. That is not the point.',
      'I will make it. I will make it grudgingly and it will still be excellent.',
      'Do you eat like this at home? Did you have a home?',
    ],
  },
  toCat: {
    greeting: [
      'Oh! Oh, look at you. Come here, come right up to the counter.',
      'There she is. There is the good one.',
      'My whiskers. My small friend. Sit, sit, the stone is warm just there.',
      'You came back. You came all the way back to see me.',
      'Hello, sweetling. Mind the hot side, mind the hot side.',
      'The only decent thing on this floor and it walks in on four feet.',
    ],
    orderFood: [
      'Food? Say no more, my heart. Say nothing at all, I am already moving.',
      'Hungry? Of course you are hungry, you are all bones and opinions.',
      'For you I will open the good crock. The good one, mind.',
      "You'll have the fish. Do not argue with me, you'll have the fish.",
      'Sit. Sit there where I can see you. This takes no time at all.',
      'Anything. Anything you like, lambkin, and a little extra.',
    ],
    serving: [
      '{dish}, my dear, and I put the garnish on for you.',
      'Here. {dish}. I made it small so it stays hot in your paws.',
      '{dish}. Blow on it first, precious, I mean it.',
      'For you: {dish}. I have been saving that stock since the last floor.',
      '{dish}. And there is more where that came from, and it is all yours.',
      '{dish}, and none for the one with the hammer.',
    ],
    thanked: [
      'Oh, hush. Hush, you lovely thing.',
      'You are welcome. You are extremely welcome. Come back within the hour.',
      'Listen to her. Listen to those manners. Some people could learn.',
      'That is what I like. That is exactly what I like.',
      'Any time, sweetling. Any time at all, and I mean that.',
      'Now you have made my whole episode.',
    ],
    dishLeftCold: [
      'It is going cold, dearest. Was it not right? Tell me and I will do another.',
      'Oh no. Oh, you have not touched it. Are you unwell?',
      'I can warm it through in a moment. It is no trouble, it is never trouble.',
      'Do you not like the aspic? Nobody likes the aspic. I will make the fish.',
      'Come back to it, precious. Come back to it while it is worth eating.',
      'If somebody put you off your food I would very much like to know who.',
    ],
    aboutSafeRoom: [
      'This room, little one? Nothing gets into it. Nothing. I would know about it first.',
      "The bed is as much yours as anybody's. Curl up on it and I will keep the noise down.",
      'It is my room to keep, and you are welcome in it at any hour you please.',
      'Rest here as long as you want, sweetling. I have all the time there is.',
      'A room of your own you can buy on the fourth floor. I will tell you which are the good ones.',
      'I scrub every stone of this room twice. For you, mostly, if I am honest about it.',
    ],
    aboutDungeon: [
      'The Dungeon, sweetling? That I may not talk about. Not even to you, and it grieves me.',
      'The contract has teeth, my dear. Ask me about this room instead and I will talk all night.',
      'I would tell you what is waiting downstairs if I could. I would tell you first, before anyone.',
      'Safe rooms, yes. Personal Spaces, yes. What is on the floors below us, no.',
      'I only get the newsletter, precious, and the newsletter is mostly advertisements.',
      'Do not ask me about the Dungeon where the tall one can hear you. Do not ask me at all, really.',
    ],
    aboutSelf: [
      'I am a Bopca, my dear. A caretaker. I keep this room and I cook in it, and that is my life.',
      'We Bopcas signed contracts, and our worlds were spared for it. It was not a hard choice.',
      'No, I never wash my hands, and no, you do not mind. You are perfect.',
      'Level fifty-one, for whatever that is worth — which in this room is nothing at all.',
      'The wet-moss smell is me, sweetling. My mother smelled of it too, and hers before her.',
      'I had a counter and a newsletter, and now I have you as well. It is a good arrangement.',
    ],
    repeatOrder: [
      'Again? Again. Good. Growing girl.',
      'You eat as much as you want and you let me worry about the budget.',
      'That is the second, and I hope it will not be the last.',
      'Take your time, my heart. The stove is not going anywhere.',
      'Oh, I like feeding you. Do not tell the corporation.',
      'More? More. Here, sit closer.',
    ],
  },
};

/**
 * State-sensitive lines, tried before the general tables. Only used when the
 * condition holds — this is what stops the Bopca being a random-line machine.
 *
 * Ordered by specificity: the first entry whose condition holds wins, so a
 * badly-hurt crawler is commented on before a first-time visitor.
 */
interface ContextualLine {
  tone: BopcaTone;
  topic: BopcaTopic;
  applies(ctx: BopcaDialogContext): boolean;
  line: string;
}

/** Below this fraction of max HP the Bopca notices the state you walked in in. */
const LOW_HP_FRACTION = 0.35;
/** At or above this fraction the Bopca points out that you did not need feeding. */
const FULL_HP_FRACTION = 0.99;

export interface BopcaDialogContext {
  tone: BopcaTone;
  topic: BopcaTopic;
  /** Active character's HP as a fraction of max. */
  hpFraction: number;
  /** True when the *other* character is standing within earshot of the counter. */
  companionNearby: boolean;
  /** True the first time the party speaks to any Bopca in the run. */
  firstBopcaEncounter: boolean;
  /** True if this exact safe room has been visited before. */
  returningToThisRoom: boolean;
  /** True if the last dish served here was left to go cold. */
  lastDishWentCold: boolean;
  /** How many dishes this Bopca has served since the party walked in. */
  servesThisVisit: number;
  /** Name of the dish just served, when there is one. */
  dishName: string | null;
}

const CONTEXTUAL_LINES: ReadonlyArray<ContextualLine> = [
  {
    tone: 'toHuman',
    topic: 'greeting',
    applies: (c) => c.hpFraction < LOW_HP_FRACTION,
    line: 'You are dripping on my floor. Sit down before you fall down, and I will get the stock on.',
  },
  {
    tone: 'toCat',
    topic: 'greeting',
    applies: (c) => c.hpFraction < LOW_HP_FRACTION,
    line: 'Oh — oh, no. Look at the state of you. Up on the stool, sweetling, I am already cooking.',
  },
  {
    tone: 'toHuman',
    topic: 'greeting',
    applies: (c) => c.firstBopcaEncounter,
    line: 'You have not met one of us before. It shows. I am the caretaker. Do not lean on that.',
  },
  {
    tone: 'toCat',
    topic: 'greeting',
    applies: (c) => c.firstBopcaEncounter,
    line: 'A new one! And such a small new one. Come in, come in, you are among friends. Friend.',
  },
  {
    tone: 'toHuman',
    topic: 'greeting',
    applies: (c) => c.lastDishWentCold,
    line: 'Back again. The last bowl is still where you left it, going quietly to jelly.',
  },
  {
    tone: 'toCat',
    topic: 'greeting',
    applies: (c) => c.returningToThisRoom,
    line: 'You remembered which room was mine. You remembered. Sit down at once.',
  },
  {
    tone: 'toHuman',
    topic: 'greeting',
    applies: (c) => c.returningToThisRoom,
    line: 'You again. Same room, same counter, same face on you.',
  },
  {
    tone: 'toCat',
    topic: 'orderFood',
    applies: (c) => c.companionNearby,
    line: 'Something to eat? For you, anything. For the one breathing behind you, we shall see.',
  },
  {
    tone: 'toHuman',
    topic: 'orderFood',
    applies: (c) => c.companionNearby,
    line: 'The cat asks nicely. You bark. Same kitchen, very different service.',
  },
  {
    tone: 'toHuman',
    topic: 'orderFood',
    applies: (c) => c.hpFraction >= FULL_HP_FRACTION,
    line: 'You are not even hurt. You are eating out of habit. Wonderful.',
  },
  {
    tone: 'toCat',
    topic: 'orderFood',
    applies: (c) => c.hpFraction >= FULL_HP_FRACTION,
    line: 'Not a scratch on you and still hungry. Good. That is how it should be.',
  },
];

/**
 * Picks lines at random while refusing to repeat the line it just used for the
 * same tone and topic.
 *
 * Stateful, so it lives as an object rather than a free function: the "no
 * immediate repeats" rule is the difference between a character and a slot
 * machine, and it needs somewhere to remember.
 */
export class BopcaLinePicker {
  private readonly lastIndexByKey = new Map<string, number>();
  private readonly lastLineByKey = new Map<string, string>();

  /** The line to say for this context, with placeholders resolved. */
  pick(ctx: BopcaDialogContext, speakerName: string): string {
    const key = `${ctx.tone}:${ctx.topic}`;
    const contextual = CONTEXTUAL_LINES.find(
      (candidate) =>
        candidate.tone === ctx.tone && candidate.topic === ctx.topic && candidate.applies(ctx),
    );
    // The no-immediate-repeat rule has to cover contextual lines too, not just the
    // tables. A contextual condition like "has visited this room before" holds
    // forever once it holds, so letting the contextual line win unconditionally
    // meant a returning player heard the same single greeting for the rest of the
    // run and the general table was never reached at all.
    const useContextual =
      contextual !== undefined && this.lastLineByKey.get(key) !== contextual.line;
    const raw = useContextual ? contextual.line : this.pickFromTable(ctx.tone, ctx.topic);
    this.lastLineByKey.set(key, raw);
    return raw
      .split(DISH_PLACEHOLDER)
      .join(ctx.dishName ?? 'that')
      .split(NAME_PLACEHOLDER)
      .join(speakerName);
  }

  private pickFromTable(tone: BopcaTone, topic: BopcaTopic): string {
    const table = LINES[tone][topic];
    const key = `${tone}:${topic}`;
    const previous = this.lastIndexByKey.get(key);
    let index = Math.floor(Math.random() * table.length);
    // One nudge rather than a retry loop: with six or more lines per pair a
    // single step is enough to guarantee a different line and cannot spin.
    if (index === previous) index = (index + 1) % table.length;
    this.lastIndexByKey.set(key, index);
    return table[index];
  }
}

/** A dish at random. Every dish heals the same, so there is no weighting to do. */
export function randomDishId(): DishId {
  return ALL_DISH_IDS[Math.floor(Math.random() * ALL_DISH_IDS.length)];
}

/** Labels for the choices offered under the dialog box. */
export const BOPCA_CHOICE_LABELS = {
  askForFood: 'Ask for food',
  takeDish: 'Take the dish',
  leave: 'Leave',
} as const;

/** Topics the chat choice cycles through, so a second question gets a new answer. */
export const CHAT_TOPIC_ORDER = ['aboutSafeRoom', 'aboutSelf', 'aboutDungeon'] as const;

export type ChatTopic = (typeof CHAT_TOPIC_ORDER)[number];

/**
 * What the chat button says for each topic.
 *
 * The button carries the question, because nothing else on screen does: a single
 * `Just chatting` button left the player reading an answer with no idea what had
 * been asked, which is the whole reason the chat lines read as non-sequiturs.
 */
export const CHAT_TOPIC_LABELS: Record<ChatTopic, string> = {
  aboutSafeRoom: 'Ask about this room',
  aboutSelf: 'Ask about Bopcas',
  aboutDungeon: 'Ask about the Dungeon',
};
