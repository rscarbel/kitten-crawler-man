/**
 * Every line a Bopca Protector says, built fresh for one attendant's name.
 *
 * The character lives or dies on this table. A Bopca is contractually obliged
 * to feed a crawler and resents every plate of it, so the human hears clipped,
 * insulted, passive-aggressive lines; the cat hears the same Bopca turn into a
 * doting grandparent. Playing the same request twice, once as each character,
 * should be legible as a joke without any explanation.
 *
 * Every `Just chatting` answer has to stand on its own. The player picks a topic
 * from a button and then sees only the reply, so a line that reads as the second
 * half of a conversation — "Not permitted. And I would not tell you if it were."
 * — lands as the Bopca answering a question that was never on screen. Each answer
 * restates enough of its own question to be legible cold.
 */

import type { DialogLine, NonEmpty } from '../line';
import { transientSpeaker } from '../line';

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

/** Every topic except `serving`, which alone needs the served dish's name. */
export type SpokenBopcaTopic = Exclude<BopcaTopic, 'serving'>;

interface BopcaToneLines {
  readonly greeting: NonEmpty<DialogLine>;
  readonly orderFood: NonEmpty<DialogLine>;
  readonly serving: NonEmpty<(args: { readonly dish: string }) => DialogLine>;
  readonly thanked: NonEmpty<DialogLine>;
  readonly dishLeftCold: NonEmpty<DialogLine>;
  readonly aboutSafeRoom: NonEmpty<DialogLine>;
  readonly aboutDungeon: NonEmpty<DialogLine>;
  readonly aboutSelf: NonEmpty<DialogLine>;
  readonly repeatOrder: NonEmpty<DialogLine>;
}

/**
 * A state-sensitive line, tried before the general pool for its tone and
 * topic. Only `greeting` and `orderFood` have any — this is what stops the
 * Bopca reading as a random-line machine for the moments that matter most.
 */
export interface BopcaContextualLine {
  readonly tone: BopcaTone;
  readonly topic: 'greeting' | 'orderFood';
  readonly applies: (ctx: BopcaDialogContext) => boolean;
  readonly line: DialogLine;
}

/** Below this fraction of max HP the Bopca notices the state you walked in in. */
const LOW_HP_FRACTION = 0.35;
/** At or above this fraction the Bopca points out that you did not need feeding. */
const FULL_HP_FRACTION = 0.99;

export interface BopcaDialogContext {
  readonly tone: BopcaTone;
  readonly topic: SpokenBopcaTopic;
  /** Active character's HP as a fraction of max. */
  readonly hpFraction: number;
  /** True when the *other* character is standing within earshot of the counter. */
  readonly companionNearby: boolean;
  /** True the first time the party speaks to any Bopca in the run. */
  readonly firstBopcaEncounter: boolean;
  /** True if this exact safe room has been visited before. */
  readonly returningToThisRoom: boolean;
  /** True if the last dish served here was left to go cold. */
  readonly lastDishWentCold: boolean;
  /** How many dishes this Bopca has served since the party walked in. */
  readonly servesThisVisit: number;
}

export interface BopcaScript {
  readonly lines: Record<BopcaTone, BopcaToneLines>;
  readonly contextual: ReadonlyArray<BopcaContextualLine>;
}

/** Builds one attendant's full script — every line it can say, in its own voice. */
export function bopcaScript(name: string): BopcaScript {
  const say = transientSpeaker(name, 'bopca');
  const lines: Record<BopcaTone, BopcaToneLines> = {
    toHuman: {
      greeting: [
        say.line('Yes. You. Standing there. What.'),
        say.line("Safe room's safe. Food's free. Nothing else is your business."),
        say.line('Every floor. Every floor there is one of you, and it is always hungry.'),
        say.line('I am obliged to greet you. Consider yourself greeted.'),
        say.line('Do not touch the counter. I just did the counter.'),
        say.line('You want something, or are you just breathing at me?'),
        say.line('I have read the contract. It says I feed you. It does not say I enjoy it.'),
      ],
      orderFood: [
        say.line("Food. Of course. Never 'good evening', never 'how is the counter'. Food."),
        say.line('It is free. It has always been free. You still ask as though it were a favour.'),
        say.line('Fine. Sit down. Do not hover. Hovering does not cook it faster.'),
        say.line('One portion. One. I am counting, whatever the contract says.'),
        say.line('The stock has been on since the last of you. It never gets to rest either.'),
        say.line("I'll make it. I'll make it well, because I'm not a savage. Do not thank me."),
      ],
      serving: [
        say.fn<{ dish: string }>(({ dish }) => `${dish}. Eat it. Do not look at it, eat it.`),
        say.fn<{ dish: string }>(
          ({ dish }) => `${dish}. Twenty-one years I've made that, and it is wasted on you.`,
        ),
        say.fn<{ dish: string }>(
          ({ dish }) => `There. ${dish}. Hot. It will not be hot for long, and that is on you.`,
        ),
        say.fn<{ dish: string }>(
          ({ dish }) => `${dish}. I would explain the reduction, but you would not follow it.`,
        ),
        say.fn<{ dish: string }>(
          ({ dish }) =>
            `${dish}. Yes, I know it looks like that. Taste it before you make that face.`,
        ),
        say.fn<{ dish: string }>(
          ({ dish }) => `${dish}, and it is the best thing that will happen to you on this floor.`,
        ),
      ],
      thanked: [
        say.line('Mm.'),
        say.line('Do not.'),
        say.line('You ate it. That is thanks enough and more than I expected.'),
        say.line('Say nothing. Just put the bowl back on the counter when you are done with it.'),
        say.line('I am not moved. I want you to know that I am not moved.'),
        say.line('Fine. It was good. I knew it was good before you told me.'),
      ],
      dishLeftCold: [
        say.line('It is going cold. I can see it going cold from here.'),
        say.line('That took me half an hour of stock and you have left it to congeal.'),
        say.line('You asked for it. It is there. It is getting worse by the second.'),
        say.line('The aspic sets. That is what aspic does when it is ignored.'),
        say.line('I will not make another. I will, because I must, and I will hate it.'),
        say.line('Cold food. On my counter. In front of me.'),
      ],
      aboutSafeRoom: [
        say.line('This room? Nothing gets into it. Not a mob, not a boss, not one of your ideas.'),
        say.line(
          'The bed in the corner is for sleeping in. My floor is for walking on. I have had to say that before.',
        ),
        say.line('You may rest here, eat here, and then leave here. In that order, and quickly.'),
        say.line(
          'Safe rooms I am permitted to discuss. So: it is a room, and it is safe. There is your discussion.',
        ),
        say.line(
          'Every safe room has one of us in it, and every one of them is cleaner than you deserve.',
        ),
        say.line(
          'A room of your own you buy on the fourth floor — a Personal Space. Bring money and stop asking me.',
        ),
      ],
      aboutDungeon: [
        say.line(
          'You want to know about the Dungeon. I may not tell you, and I would not if I could.',
        ),
        say.line(
          'I am a non-combatant. Non-combatants do not brief crawlers on what is waiting downstairs.',
        ),
        say.line(
          'Take that question to the one in the tuxedo. He is paid to enjoy answering it. I am not.',
        ),
        say.line(
          'The contract lists what I may talk about. The Dungeon is not on the list. The soup is.',
        ),
        say.line(
          'All I get is the newsletter, and the newsletter is advertisements and a crossword. No maps.',
        ),
        say.line('No. And before you ask the same thing in a different voice: still no.'),
      ],
      aboutSelf: [
        say.line(
          'What I am is a Bopca, and what a Bopca does is keep a safe room. That is the whole of the job.',
        ),
        say.line(
          'We Bopcas signed with the Syndicate. Our worlds are still standing. Yours is not. Work it out.',
        ),
        say.line(
          'Yes, I cook without washing my hands. Twenty-one years, and nobody has died of it yet.',
        ),
        say.line(
          'I am level fifty-one, since you have asked. It would do you no good at all to know that.',
        ),
        say.line(
          'The wet moss you can smell is me. Every Bopca smells of it. No Bopca wants it mentioned.',
        ),
        say.line(
          'I own a newsletter, a counter and a contract. It is enough, and it is more than you own.',
        ),
      ],
      repeatOrder: [
        say.line('Again. Of course again.'),
        say.line('That is two. I want it on the record that that is two.'),
        say.line('You are not a crawler, you are a mouth with a sword.'),
        say.line('The larder is not infinite. It is, in fact. That is not the point.'),
        say.line('I will make it. I will make it grudgingly and it will still be excellent.'),
        say.line('Do you eat like this at home? Did you have a home?'),
      ],
    },
    toCat: {
      greeting: [
        say.line('Oh! Oh, look at you. Come here, come right up to the counter.'),
        say.line('There she is. There is the good one.'),
        say.line('My whiskers. My small friend. Sit, sit, the stone is warm just there.'),
        say.line('You came back. You came all the way back to see me.'),
        say.line('Hello, sweetling. Mind the hot side, mind the hot side.'),
        say.line('The only decent thing on this floor and it walks in on four feet.'),
      ],
      orderFood: [
        say.line('Food? Say no more, my heart. Say nothing at all, I am already moving.'),
        say.line('Hungry? Of course you are hungry, you are all bones and opinions.'),
        say.line('For you I will open the good crock. The good one, mind.'),
        say.line("You'll have the fish. Do not argue with me, you'll have the fish."),
        say.line('Sit. Sit there where I can see you. This takes no time at all.'),
        say.line('Anything. Anything you like, lambkin, and a little extra.'),
      ],
      serving: [
        say.fn<{ dish: string }>(
          ({ dish }) => `${dish}, my dear, and I put the garnish on for you.`,
        ),
        say.fn<{ dish: string }>(
          ({ dish }) => `Here. ${dish}. I made it small so it stays hot in your paws.`,
        ),
        say.fn<{ dish: string }>(({ dish }) => `${dish}. Blow on it first, precious, I mean it.`),
        say.fn<{ dish: string }>(
          ({ dish }) => `For you: ${dish}. I have been saving that stock since the last floor.`,
        ),
        say.fn<{ dish: string }>(
          ({ dish }) => `${dish}. And there is more where that came from, and it is all yours.`,
        ),
        say.fn<{ dish: string }>(({ dish }) => `${dish}, and none for the one with the hammer.`),
      ],
      thanked: [
        say.line('Oh, hush. Hush, you lovely thing.'),
        say.line('You are welcome. You are extremely welcome. Come back within the hour.'),
        say.line('Listen to her. Listen to those manners. Some people could learn.'),
        say.line('That is what I like. That is exactly what I like.'),
        say.line('Any time, sweetling. Any time at all, and I mean that.'),
        say.line('Now you have made my whole episode.'),
      ],
      dishLeftCold: [
        say.line('It is going cold, dearest. Was it not right? Tell me and I will do another.'),
        say.line('Oh no. Oh, you have not touched it. Are you unwell?'),
        say.line('I can warm it through in a moment. It is no trouble, it is never trouble.'),
        say.line('Do you not like the aspic? Nobody likes the aspic. I will make the fish.'),
        say.line('Come back to it, precious. Come back to it while it is worth eating.'),
        say.line('If somebody put you off your food I would very much like to know who.'),
      ],
      aboutSafeRoom: [
        say.line(
          'This room, little one? Nothing gets into it. Nothing. I would know about it first.',
        ),
        say.line(
          "The bed is as much yours as anybody's. Curl up on it and I will keep the noise down.",
        ),
        say.line('It is my room to keep, and you are welcome in it at any hour you please.'),
        say.line('Rest here as long as you want, sweetling. I have all the time there is.'),
        say.line(
          'A room of your own you can buy on the fourth floor. I will tell you which are the good ones.',
        ),
        say.line(
          'I scrub every stone of this room twice. For you, mostly, if I am honest about it.',
        ),
      ],
      aboutDungeon: [
        say.line(
          'The Dungeon, sweetling? That I may not talk about. Not even to you, and it grieves me.',
        ),
        say.line(
          'The contract has teeth, my dear. Ask me about this room instead and I will talk all night.',
        ),
        say.line(
          'I would tell you what is waiting downstairs if I could. I would tell you first, before anyone.',
        ),
        say.line('Safe rooms, yes. Personal Spaces, yes. What is on the floors below us, no.'),
        say.line(
          'I only get the newsletter, precious, and the newsletter is mostly advertisements.',
        ),
        say.line(
          'Do not ask me about the Dungeon where the tall one can hear you. Do not ask me at all, really.',
        ),
      ],
      aboutSelf: [
        say.line(
          'I am a Bopca, my dear. A caretaker. I keep this room and I cook in it, and that is my life.',
        ),
        say.line(
          'We Bopcas signed contracts, and our worlds were spared for it. It was not a hard choice.',
        ),
        say.line('No, I never wash my hands, and no, you do not mind. You are perfect.'),
        say.line(
          'Level fifty-one, for whatever that is worth — which in this room is nothing at all.',
        ),
        say.line(
          'The wet-moss smell is me, sweetling. My mother smelled of it too, and hers before her.',
        ),
        say.line(
          'I had a counter and a newsletter, and now I have you as well. It is a good arrangement.',
        ),
      ],
      repeatOrder: [
        say.line('Again? Again. Good. Growing girl.'),
        say.line('You eat as much as you want and you let me worry about the budget.'),
        say.line('That is the second, and I hope it will not be the last.'),
        say.line('Take your time, my heart. The stove is not going anywhere.'),
        say.line('Oh, I like feeding you. Do not tell the corporation.'),
        say.line('More? More. Here, sit closer.'),
      ],
    },
  };

  const contextual: ReadonlyArray<BopcaContextualLine> = [
    {
      tone: 'toHuman',
      topic: 'greeting',
      applies: (c) => c.hpFraction < LOW_HP_FRACTION,
      line: say.line(
        'You are dripping on my floor. Sit down before you fall down, and I will get the stock on.',
      ),
    },
    {
      tone: 'toCat',
      topic: 'greeting',
      applies: (c) => c.hpFraction < LOW_HP_FRACTION,
      line: say.line(
        'Oh — oh, no. Look at the state of you. Up on the stool, sweetling, I am already cooking.',
      ),
    },
    {
      tone: 'toHuman',
      topic: 'greeting',
      applies: (c) => c.firstBopcaEncounter,
      line: say.line(
        'You have not met one of us before. It shows. I am the caretaker. Do not lean on that.',
      ),
    },
    {
      tone: 'toCat',
      topic: 'greeting',
      applies: (c) => c.firstBopcaEncounter,
      line: say.line(
        'A new one! And such a small new one. Come in, come in, you are among friends. Friend.',
      ),
    },
    {
      tone: 'toHuman',
      topic: 'greeting',
      applies: (c) => c.lastDishWentCold,
      line: say.line(
        'Back again. The last bowl is still where you left it, going quietly to jelly.',
      ),
    },
    {
      tone: 'toCat',
      topic: 'greeting',
      applies: (c) => c.returningToThisRoom,
      line: say.line('You remembered which room was mine. You remembered. Sit down at once.'),
    },
    {
      tone: 'toHuman',
      topic: 'greeting',
      applies: (c) => c.returningToThisRoom,
      line: say.line('You again. Same room, same counter, same face on you.'),
    },
    {
      tone: 'toCat',
      topic: 'orderFood',
      applies: (c) => c.companionNearby,
      line: say.line(
        'Something to eat? For you, anything. For the one breathing behind you, we shall see.',
      ),
    },
    {
      tone: 'toHuman',
      topic: 'orderFood',
      applies: (c) => c.companionNearby,
      line: say.line('The cat asks nicely. You bark. Same kitchen, very different service.'),
    },
    {
      tone: 'toHuman',
      topic: 'orderFood',
      applies: (c) => c.hpFraction >= FULL_HP_FRACTION,
      line: say.line('You are not even hurt. You are eating out of habit. Wonderful.'),
    },
    {
      tone: 'toCat',
      topic: 'orderFood',
      applies: (c) => c.hpFraction >= FULL_HP_FRACTION,
      line: say.line('Not a scratch on you and still hungry. Good. That is how it should be.'),
    },
  ];

  return { lines, contextual };
}

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
  private readonly lastTextByKey = new Map<string, string>();

  /** The line to say for a topic other than `serving`. */
  pick(script: BopcaScript, ctx: BopcaDialogContext): DialogLine {
    const key = `${ctx.tone}:${ctx.topic}`;
    const contextual = script.contextual.find(
      (candidate) =>
        candidate.tone === ctx.tone && candidate.topic === ctx.topic && candidate.applies(ctx),
    );
    // The no-immediate-repeat rule has to cover contextual lines too, not just
    // the pool. A contextual condition like "has visited this room before"
    // holds forever once it holds, so letting the contextual line win
    // unconditionally would mean a returning player hears the same single
    // greeting for the rest of the run and the pool is never reached at all.
    const useContextual =
      contextual !== undefined && this.lastTextByKey.get(key) !== contextual.line.paragraphs[0];
    const line = useContextual
      ? contextual.line
      : this.pickFromPool(script.lines[ctx.tone][ctx.topic], key);
    this.lastTextByKey.set(key, line.paragraphs[0]);
    return line;
  }

  /** The line to say for `serving`, which alone needs the dish's name. */
  pickServing(script: BopcaScript, tone: BopcaTone, dish: string): DialogLine {
    const key = `${tone}:serving`;
    const build = this.pickFromPool(script.lines[tone].serving, key);
    return build({ dish });
  }

  private pickFromPool<T>(pool: NonEmpty<T>, key: string): T {
    const previous = this.lastIndexByKey.get(key);
    let index = Math.floor(Math.random() * pool.length);
    // One nudge rather than a retry loop: with six or more lines per pair a
    // single step is enough to guarantee a different line and cannot spin.
    if (index === previous) index = (index + 1) % pool.length;
    this.lastIndexByKey.set(key, index);
    const picked: T | undefined = pool[index];
    if (picked === undefined) {
      throw new Error('BopcaLinePicker: index out of range');
    }
    return picked;
  }
}
