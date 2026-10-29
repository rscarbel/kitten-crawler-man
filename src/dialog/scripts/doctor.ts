/**
 * Every line a safe room's doctor says, built fresh for one doctor's name.
 *
 * The doctors are people. Before Caroline each one practised medicine
 * somewhere; offered any work in the world, they asked to keep doing the one
 * thing they were good at, and she gave them a corner behind a door nothing
 * comes through. They are calm, brisk and competent, with a dry gallows humour
 * and a short bedside manner. They have seen every wound the floor makes and
 * talk about injuries clinically, with one practical tip at most, and they know
 * nothing about bosses or the floor's layout. With the cat they are a
 * reluctant, earnest vet.
 *
 * Lines are keyed by topic, not by which crawler is listening: both crawlers
 * hear the same doctor, and a few contextual lines cover the cat.
 *
 * Every chat answer has to stand on its own. The player picks a topic from a
 * button and then sees only the reply, so each answer restates enough of its
 * own question to be legible cold.
 */

import type { DialogLine, NonEmpty } from '../line';
import { transientSpeaker } from '../line';

/** What a treatment did, which decides how the doctor sums it up. */
export type TreatmentOutcome = 'healed' | 'cured' | 'healedAndCured' | 'revived';

export type DoctorTopic =
  'greeting' | 'repeatVisit' | 'nothingToTreat' | 'aboutSafeRoom' | 'aboutSelf' | 'aboutDungeon';

/** Every topic a contextual line can stand in for. */
type ContextualTopic = 'greeting' | 'repeatVisit' | 'nothingToTreat';

interface DoctorLines {
  readonly greeting: NonEmpty<DialogLine>;
  readonly repeatVisit: NonEmpty<DialogLine>;
  readonly nothingToTreat: NonEmpty<DialogLine>;
  readonly aboutSafeRoom: NonEmpty<DialogLine>;
  readonly aboutSelf: NonEmpty<DialogLine>;
  readonly aboutDungeon: NonEmpty<DialogLine>;
  readonly treated: Readonly<Record<TreatmentOutcome, NonEmpty<DialogLine>>>;
}

/** Below this fraction of max HP the doctor notices the state you walked in in. */
const LOW_HP_FRACTION = 0.35;
/** At or above this fraction the doctor notices there is nothing to mend. */
const FULL_HP_FRACTION = 0.99;

export interface DoctorDialogContext {
  readonly topic: DoctorTopic;
  /** Active character's HP as a fraction of max. */
  readonly hpFraction: number;
  /** True when the *other* character is standing within earshot of the doctor. */
  readonly companionNearby: boolean;
  /** True the first time the party speaks to any doctor in the run. */
  readonly firstDoctorEncounter: boolean;
  /** True if this exact safe room has been visited before. */
  readonly returningToThisRoom: boolean;
  /** True while the active character carries an ailment the doctor can cure. */
  readonly carryingAilment: boolean;
  /** True when the cat is the one doing the talking. */
  readonly talkingToCat: boolean;
}

/**
 * A state-sensitive line, tried before the general pool for its topic. This is
 * what stops the doctor reading as a random-line machine for the moments that
 * matter most.
 */
export interface DoctorContextualLine {
  readonly topic: ContextualTopic;
  readonly applies: (ctx: DoctorDialogContext) => boolean;
  readonly line: DialogLine;
}

export interface DoctorScript {
  readonly lines: DoctorLines;
  readonly contextual: ReadonlyArray<DoctorContextualLine>;
}

/** Builds one doctor's full script — every line they can say, in their own voice. */
export function doctorScript(name: string): DoctorScript {
  const say = transientSpeaker(name, 'doctor');
  const lines: DoctorLines = {
    greeting: [
      say.line("Sit on the crate. It's the examination table. Today, it's the examination table."),
      say.line('Burned, bitten, poisoned. Pick one and I’ll pretend it was the only one.'),
      say.line('Come in. Mind the bag. Tell me where it hurts, roughly.'),
      say.line("You're upright, which is a good start. Let's see what else you've brought me."),
      say.line('Afternoon. Or morning. Down here it is always clinic hours.'),
      say.line("Hands where I can see them. I'm checking for bites, not weapons."),
    ],
    repeatVisit: [
      say.line('Back again. I kept your chair warm. That was a joke; there is no chair.'),
      say.line('You again. Good. The ones who come back are the ones who listened.'),
      say.line('Same corner, same doctor, new bruises. Let me see.'),
      say.line("Welcome back. I've seen worse than you today. I've seen worse than you this hour."),
      say.line('Ah. A returning patient. My favourite kind, and the rarest.'),
      say.line("Back so soon? Don't answer that. Sit."),
    ],
    nothingToTreat: [
      say.line("You're fine. Annoyingly fine. Go on."),
      say.line('Nothing to mend. Come back when you’ve been careless.'),
      say.line('Clean bill of health. Frame it. It won’t last.'),
      say.line("I've looked you over twice. You're whole. Stop limping for sympathy."),
      say.line('Not a scratch worth my time. Drink water. Nobody ever drinks water.'),
      say.line("You're in better shape than I am. Off you go."),
    ],
    aboutSafeRoom: [
      say.line(
        "Nothing comes through that door. So whatever's wrong with you, you brought in yourself.",
      ),
      say.line(
        'This room? Sleep in it, eat in it, bleed in it if you must. Nothing out there follows you in.',
      ),
      say.line(
        "The bed's for sleeping, not for bleeding on. If you're bleeding, that's what I'm for.",
      ),
      say.line(
        'Every safe room has a doctor in the corner. Some of us have better lamps than others.',
      ),
      say.line(
        "The room's quiet because nothing hunts in here. Use the quiet. Rest is half my job done for me.",
      ),
      say.line(
        'About this room: the cabinet is mine, the floor is yours, and the door stays shut.',
      ),
    ],
    aboutSelf: [
      say.line(
        'Caroline asked what I wanted to do with the rest of forever. I said the same thing, with better lighting.',
      ),
      say.line(
        'Who am I? A doctor. I was one before all this, and I asked to stay one. She gave me a corner.',
      ),
      say.line(
        'I ran a ward once. Forty beds and a broken lift. This is quieter, and the patients are more interesting.',
      ),
      say.line(
        "Do I mind the work? I've had worse shifts. At least here nobody asks me to fill in forms.",
      ),
      say.line(
        'What do I do all day? Sort the cabinet, write notes, wait. Then someone like you walks in.',
      ),
      say.line(
        'You want to know about me? I sleep badly and I stitch well. That’s the whole file.',
      ),
    ],
    aboutDungeon: [
      say.line('Bosses? No idea. I only meet what they leave behind.'),
      say.line(
        "The Dungeon past that door? I couldn't draw you a map of it. I could draw you its bite marks.",
      ),
      say.line(
        'What waits downstairs? I know the wounds, not the faces. Burns mean fire. Holes mean teeth.',
      ),
      say.line(
        'Ask me about the floor and I’ll tell you what it does to people. Mostly it does it to their feet.',
      ),
      say.line(
        "The layout out there? Never seen it. I've seen what it does to ankles, though. Watch the stairs.",
      ),
      say.line("What's out there is your department. What's in you afterwards is mine."),
    ],
    treated: {
      healed: [
        say.line("Hold still. This won't hurt. That was a lie, but it's over."),
        say.line('Stitched, wrapped, done. Try to keep the blood on the inside this time.'),
        say.line('There. Good as new, or close enough that nobody will check.'),
        say.line('All patched. The bandage comes off by itself. So does the bruise, eventually.'),
        say.line("That's you sorted. Next time, block with the shield, not the face."),
        say.line('Full marks. The holes are closed. Go and collect some more, apparently.'),
      ],
      cured: [
        say.line(
          "Something in your blood that shouldn't be. Was. There, it's gone. Don't lick anything green.",
        ),
        say.line('Your colour’s coming back. It was a very interesting colour. Not a good one.'),
        say.line('That was festering. It isn’t now. You’re welcome.'),
        say.line(
          "Flushed it out. You'll feel strange for a minute, then normal. Normal is the goal.",
        ),
        say.line('Cured. Whatever you touched, wash your hands before you touch it again.'),
        say.line('Next time, step out of the puddle first. Then come and see me.'),
      ],
      healedAndCured: [
        say.line('Cut, scorched and poisoned. You were busy. All of it’s handled.'),
        say.line('I closed the wounds and cleaned out the rest. You were a whole case file.'),
        say.line(
          "Patched you and purged you. Two treatments, one patient, no charge. Don't make it a habit.",
        ),
        say.line(
          "That's the bleeding stopped and the poison gone. You can thank me by not coming back like that.",
        ),
        say.line('Everything’s mended and nothing’s spreading. Eat something that isn’t a potion.'),
        say.line('Wounds shut, blood clean. You’re fit to make it all worse again.'),
      ],
      revived: [
        say.line('Up you get. You were further gone than I’d like. Breathe. Good.'),
        say.line("Back with us? Good. Don't make me do that twice in one day."),
        say.line("I've stood you back up. Your legs will argue for a minute. Let them."),
        say.line('There’s a pulse, and now there’s a patient. Sit up slowly.'),
        say.line('You were on the floor. Now you’re not. That’s the whole of medicine, really.'),
        say.line('Awake? Don’t thank me. Thank the other one for dragging you in here.'),
      ],
    },
  };

  const contextual: ReadonlyArray<DoctorContextualLine> = [
    {
      topic: 'greeting',
      applies: (c) => c.talkingToCat && c.firstDoctorEncounter,
      line: say.line("I'm not a vet. Today I'm a vet. Paw, please."),
    },
    {
      topic: 'greeting',
      applies: (c) => c.talkingToCat && c.hpFraction < LOW_HP_FRACTION,
      line: say.line(
        'Oh, you poor thing. On the crate. No, the crate. Good cat. I’ll be gentle, mostly.',
      ),
    },
    {
      topic: 'greeting',
      applies: (c) => c.hpFraction < LOW_HP_FRACTION,
      line: say.line("You're dripping on my floor. Sit before you fall, and we'll start there."),
    },
    {
      topic: 'greeting',
      applies: (c) => c.carryingAilment,
      line: say.line("You've got that look. Something's in your blood. I can fix that."),
    },
    {
      topic: 'greeting',
      applies: (c) => c.firstDoctorEncounter,
      line: say.line(
        "New patient. I'm the doctor in this corner. Free, quick, and I've seen worse.",
      ),
    },
    {
      topic: 'greeting',
      applies: (c) => c.companionNearby && c.talkingToCat,
      line: say.line('You brought the tall one. Good. I’ll look at you both. You first, whiskers.'),
    },
    {
      topic: 'repeatVisit',
      applies: (c) => c.talkingToCat,
      line: say.line('The cat again. Let me see the paws. I check the paws first now.'),
    },
    {
      topic: 'repeatVisit',
      applies: (c) => c.hpFraction < LOW_HP_FRACTION,
      line: say.line('Back, and worse than last time. Sit. We’ll talk about your choices after.'),
    },
    {
      topic: 'repeatVisit',
      applies: (c) => c.companionNearby,
      line: say.line("Both of you again. One at a time, or both at once. I'm quick either way."),
    },
    {
      topic: 'nothingToTreat',
      applies: (c) => c.talkingToCat && c.hpFraction >= FULL_HP_FRACTION,
      line: say.line(
        'Healthy cat. Shiny coat, clear eyes, a deep contempt for me. All normal. Off you go.',
      ),
    },
  ];

  return { lines, contextual };
}

/**
 * Picks lines at random while refusing to repeat the line it just used for the
 * same topic.
 *
 * Stateful, so it lives as an object rather than a free function: the "no
 * immediate repeats" rule is the difference between a character and a slot
 * machine, and it needs somewhere to remember.
 */
export class DoctorLinePicker {
  private readonly lastIndexByKey = new Map<string, number>();
  private readonly lastTextByKey = new Map<string, string>();

  /** The line to say on a conversational topic. */
  pick(script: DoctorScript, ctx: DoctorDialogContext): DialogLine {
    const key = ctx.topic;
    const contextual = script.contextual.find(
      (candidate) => candidate.topic === ctx.topic && candidate.applies(ctx),
    );
    // The no-immediate-repeat rule has to cover contextual lines too, not just
    // the pool. A contextual condition like "is the cat" holds forever once it
    // holds, so letting the contextual line win unconditionally would mean the
    // cat hears the same single line for the rest of the run.
    const useContextual =
      contextual !== undefined && this.lastTextByKey.get(key) !== contextual.line.paragraphs[0];
    const line = useContextual ? contextual.line : this.pickFromPool(script.lines[ctx.topic], key);
    this.lastTextByKey.set(key, line.paragraphs[0]);
    return line;
  }

  /** The doctor's summing-up after a treatment, chosen by what was done. */
  pickTreated(script: DoctorScript, outcome: TreatmentOutcome): DialogLine {
    return this.pickFromPool(script.lines.treated[outcome], `treated:${outcome}`);
  }

  private pickFromPool<T>(pool: NonEmpty<T>, key: string): T {
    const previous = this.lastIndexByKey.get(key);
    let index = Math.floor(Math.random() * pool.length);
    // One nudge rather than a retry loop: with six lines per pool a single step
    // is enough to guarantee a different line and cannot spin.
    if (index === previous) index = (index + 1) % pool.length;
    this.lastIndexByKey.set(key, index);
    const picked: T | undefined = pool[index];
    if (picked === undefined) {
      throw new Error('DoctorLinePicker: index out of range');
    }
    return picked;
  }
}
