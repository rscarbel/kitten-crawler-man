/**
 * What each hired mercenary says, and when.
 *
 * The lines are written for each character: The Barracks Mercenaries' hires
 * are professionals, competent and a little wry, with any edge aimed at the
 * dungeon and never at the player. The lines mention nothing beyond what the
 * game has shown by the third floor, when the party can hire them.
 *
 * `MercenaryBarker` (`src/creatures/mercenaries/MercenaryBarker.ts`) reads
 * every one of these pools generically, through `MercenaryLines` and
 * `linesFor` — never by trigger name against this file — so a bark that goes
 * unread here is a bark nobody will ever hear.
 */

import { crawlerDisplayName } from '../../characters/characters';
import { speakerLines, type BarkLine, type NonEmpty } from '../line';
import type { MercenaryLines } from '../roles';
import type { ErrandVoice, MercenaryVoice } from '../../creatures/mercenaries/mercenaryVoices';

/** A quarryman: few words, all of them load-bearing. */
const crush = speakerLines('crush');

export const CRUSH_LINES = {
  hired: [
    crush.bark('Signed and here. Point me at the heavy part.'),
    crush.bark(
      () => `I'll walk with ${crawlerDisplayName('cat')}. The small ones get leaned on first.`,
    ),
    crush.bark('Crush. Eleven years in the quarry. Lead on.'),
    crush.bark('Contract says the floor. I read it twice.'),
  ],
  idle: [
    crush.bark('Good stone in these walls. Somebody cut it right.'),
    crush.bark('Quiet. I trust quiet about as far as I can throw it. Which is far.'),
    crush.bark('You learn to listen for the crack before the fall.'),
    crush.bark(() => `${crawlerDisplayName('cat')}, stay where I can see you.`),
  ],
  engage: [
    crush.bark('Here it comes.'),
    crush.bark('Behind me.'),
    crush.bark('That one. Mine.'),
    crush.bark('Hold. I have it.'),
  ],
  kill: [
    crush.bark('Down.'),
    crush.bark("That one won't get up."),
    crush.bark('Next.'),
    crush.bark('Split along the grain.'),
  ],
  lowHp: [
    crush.bark('Chipped. Not cracked.'),
    crush.bark('That one went in deep.'),
    crush.bark('Still standing. Mostly.'),
    crush.bark('I have been hit by worse. A mountain, once.'),
  ],
  special: [
    crush.bark(() => `Ward's up, ${crawlerDisplayName('cat')}. Stay under it.`),
    crush.bark('Shield. Inside the light.'),
    crush.bark('Stand in the glow.'),
    crush.bark('Warded. Go.'),
  ],
  ownerHurt: [
    crush.bark('I saw that.'),
    crush.bark('Step back. Let me take the next one.'),
    crush.bark('You are bleeding. Move behind me.'),
    crush.bark('Easy. I am coming.'),
  ],
  catHurt: [
    crush.bark(() => `${crawlerDisplayName('cat')}. Behind me, now.`),
    crush.bark('Wrong one to touch.'),
    crush.bark(() => `Nobody lays a hand on ${crawlerDisplayName('cat')} twice.`),
    crush.bark('You picked the small one. Pick again.'),
  ],
  downed: [
    crush.bark('I am down. Lift with your legs.'),
    crush.bark('Floor got me. Give me a hand.'),
    crush.bark('Not done. Just down. Help me up.'),
    crush.bark('Heavy, I know. Pull anyway.'),
  ],
  revived: [
    crush.bark('Up. Thank you.'),
    crush.bark('Good hands. I owe you one.'),
    crush.bark('Back on my feet. Where were we.'),
  ],
  potion: [
    crush.bark('Tastes like gravel. Works.'),
    crush.bark('Drinking. Cover me a breath.'),
    crush.bark('One swallow. Fine now.'),
  ],
  death: [
    crush.bark(() => `Get ${crawlerDisplayName('cat')} out.`),
    crush.bark('Good... stone.'),
    crush.bark('Held as long as I could.'),
    crush.bark('Tell the desk... I held.'),
  ],
  talk: [
    crush.bark('Quarry work is mostly waiting for a rock to tell you where it breaks.'),
    crush.bark('I do not talk much. This is most of it.'),
    crush.bark('You paid. I stay. That is the whole arrangement.'),
    crush.bark(
      () => `I watch ${crawlerDisplayName('cat')} because nobody else watches the small ones.`,
    ),
  ],
  floorEnd: [
    crush.bark('Floor done. Contract done. Good work.'),
    crush.bark('Stairs are yours. My paper ends here.'),
    crush.bark(() => `Look after ${crawlerDisplayName('cat')}.`),
    crush.bark('You lived. That was the job.'),
  ],
  loanEnd: [
    crush.bark("Tower's done. Loan's done. I'm due back at the desk."),
    crush.bark('Sydney lent me for the tower. Tower is finished. So am I.'),
  ],
} satisfies MercenaryLines;

/** A forge hand: warm, practical, talks about his work like it is the weather. */
const hammerHands = speakerLines('hammerHands');

export const HAMMER_HANDS_LINES = {
  hired: [
    hammerHands.bark('Hammer Hands, at your service. Fresh off the anvil, more or less.'),
    hammerHands.bark('Good choice. I mend people the way I mended steel: quick and hot.'),
    hammerHands.bark("Ward spell's charged. Point me at whoever looks worst."),
    hammerHands.bark("Lead on. I'll keep the sparks off you."),
  ],
  idle: [
    hammerHands.bark('Forge taught me patience. Then it taught me to stop being patient.'),
    hammerHands.bark('Smell that? Old iron. Somebody bled here a while back.'),
    hammerHands.bark("Quiet stretch. I'll take it."),
    hammerHands.bark('Every wall down here wants repointing. Not my job today.'),
  ],
  engage: [
    hammerHands.bark('Hot work. Stand clear.'),
    hammerHands.bark('Behind me, please.'),
    hammerHands.bark('Here we go. Mind the swing.'),
    hammerHands.bark("That one's coming for you. Not if I'm there first."),
  ],
  kill: [
    hammerHands.bark('Flattened.'),
    hammerHands.bark('Struck true.'),
    hammerHands.bark('One more off the pile.'),
    hammerHands.bark('Quenched.'),
  ],
  lowHp: [
    hammerHands.bark("I've taken a crack. Still holding."),
    hammerHands.bark('That one rang me like a bell.'),
    hammerHands.bark('Running hot. Give me a moment.'),
    hammerHands.bark('Not broken. Bent.'),
  ],
  special: [
    hammerHands.bark("Ward's on you. Don't waste it."),
    hammerHands.bark('Shield up. Stay inside it.'),
    hammerHands.bark("There. That'll take a hit for you."),
    hammerHands.bark('Covered. Keep fighting.'),
  ],
  ownerHurt: [
    hammerHands.bark("You're hurt. Get behind me."),
    hammerHands.bark("I'm stepping in. Fall back a pace."),
    hammerHands.bark("Easy, easy. I've got the front."),
    hammerHands.bark("That's enough of that."),
  ],
  catHurt: [
    hammerHands.bark(() => `${crawlerDisplayName('cat')}, back to me!`),
    hammerHands.bark(() => `Hold on, ${crawlerDisplayName('cat')}.`),
    hammerHands.bark('Leave the cat alone.'),
    hammerHands.bark(() => `I see it, ${crawlerDisplayName('cat')}. Coming.`),
  ],
  downed: [
    hammerHands.bark("I'm down. Come and get me, would you?"),
    hammerHands.bark("Floor's cold. Hand up, please."),
    hammerHands.bark('Knocked flat. Not finished.'),
    hammerHands.bark("Give me a pull and I'll be back in it."),
  ],
  revived: [
    hammerHands.bark('Up again. Thank you kindly.'),
    hammerHands.bark('Back on the line.'),
    hammerHands.bark('Good as new. Close enough.'),
  ],
  potion: [
    hammerHands.bark('Bitter. Like forge water.'),
    hammerHands.bark('Down the hatch.'),
    hammerHands.bark("That's the stuff."),
  ],
  death: [
    hammerHands.bark("Fire's... going out."),
    hammerHands.bark('Keep the others... warded.'),
    hammerHands.bark('Should have... stayed at the forge.'),
    hammerHands.bark("Go on. Don't wait for me."),
  ],
  talk: [
    hammerHands.bark(
      'Spent twenty years at a forge. Turns out people need mending more than kettles.',
    ),
    hammerHands.bark('The ward is just heat, pointed. Same as a weld.'),
    hammerHands.bark('Crush and I came off the same quarry road. He talks less. I make up for it.'),
    hammerHands.bark("Scarf's for the soot. Old habit."),
  ],
  floorEnd: [
    hammerHands.bark("Floor's done. Fine work, all of you."),
    hammerHands.bark("Contract's run out. I'll bank the fire."),
    hammerHands.bark("You came through. That's what I like to see."),
    hammerHands.bark('Off you go. Mind the stairs.'),
  ],
  loanEnd: [
    hammerHands.bark("That's the tower seen to. Sydney wants me back by supper."),
    hammerHands.bark("Loan's over. Tell the cats I said goodbye."),
  ],
} satisfies MercenaryLines;

/** A ranger: dry, quick, counts her arrows. */
const ivyAshgrove = speakerLines('ivyAshgrove');

export const IVY_ASHGROVE_LINES = {
  hired: [
    ivyAshgrove.bark("Ivy Ashgrove. I stand back and I don't miss. Much."),
    ivyAshgrove.bark("Contract's signed. Keep them off me and I'll keep them off you."),
    ivyAshgrove.bark("String's fresh, quiver's full. Where to?"),
    ivyAshgrove.bark("You lead. I'll be the one behind you, aiming past your ear."),
  ],
  idle: [
    ivyAshgrove.bark("Twenty-two arrows. I count when it's quiet."),
    ivyAshgrove.bark('Long sightlines down here. Somebody built this for archers.'),
    ivyAshgrove.bark("I'd rather be in a tree. I'm not, but I'd rather."),
    ivyAshgrove.bark('Listen. No, that was me. Carry on.'),
  ],
  engage: [
    ivyAshgrove.bark('Got it. Drawing.'),
    ivyAshgrove.bark('Stay out of my line.'),
    ivyAshgrove.bark('Contact. Give me room.'),
    ivyAshgrove.bark('That one first.'),
  ],
  kill: [
    ivyAshgrove.bark('Down.'),
    ivyAshgrove.bark('Clean shot.'),
    ivyAshgrove.bark('One less.'),
    ivyAshgrove.bark("I'll want that arrow back."),
  ],
  lowHp: [
    ivyAshgrove.bark("I'm hit. Still shooting."),
    ivyAshgrove.bark('That one got close. Too close.'),
    ivyAshgrove.bark('Bleeding. Keep them off me.'),
    ivyAshgrove.bark('Not my best day.'),
  ],
  special: [
    ivyAshgrove.bark('Loose.'),
    ivyAshgrove.bark('Watch this one.'),
    ivyAshgrove.bark('Steady...'),
  ],
  ownerHurt: [
    ivyAshgrove.bark("You're hit. Back toward me."),
    ivyAshgrove.bark('I see it. Covering you.'),
    ivyAshgrove.bark("Step left. I've got a line."),
    ivyAshgrove.bark("Hold on. Next one's for whoever did that."),
  ],
  catHurt: [
    ivyAshgrove.bark(() => `${crawlerDisplayName('cat')}! Clear the line!`),
    ivyAshgrove.bark(() => `I've got the one on ${crawlerDisplayName('cat')}.`),
    ivyAshgrove.bark('Off the cat. Now.'),
    ivyAshgrove.bark(() => `Move, ${crawlerDisplayName('cat')}, I can't shoot through you.`),
  ],
  downed: [
    ivyAshgrove.bark("I'm down. Somebody, please."),
    ivyAshgrove.bark("Can't draw lying flat. Help me up."),
    ivyAshgrove.bark('Still breathing. Come get me.'),
    ivyAshgrove.bark("I'll owe you an arrow. Hurry."),
  ],
  revived: [
    ivyAshgrove.bark('Thanks. Back to it.'),
    ivyAshgrove.bark('Up. Where did it go?'),
    ivyAshgrove.bark("I'll pretend that didn't happen."),
  ],
  potion: [
    ivyAshgrove.bark('Drinking. Two seconds.'),
    ivyAshgrove.bark('Ugh. Better.'),
    ivyAshgrove.bark("That's the last of that flask. Joking."),
  ],
  death: [
    ivyAshgrove.bark('Out of... arrows.'),
    ivyAshgrove.bark('Should have... stayed in the trees.'),
    ivyAshgrove.bark('Keep your distance... from them.'),
    ivyAshgrove.bark('Tell the desk... I hit it.'),
  ],
  talk: [
    ivyAshgrove.bark('Rule one: never stand where you can be reached. Rule two: see rule one.'),
    ivyAshgrove.bark("Ashgrove is a place. Was. I'm what's left that still has a bow."),
    ivyAshgrove.bark(
      "People ask about the arrows. Yes, they're in the fee. No, you can't borrow one.",
    ),
    ivyAshgrove.bark('I keep four tiles back. You keep in front. It works if we both do it.'),
  ],
  floorEnd: [
    ivyAshgrove.bark("That's the floor. Nice shooting, if I say so."),
    ivyAshgrove.bark("Contract's up. Go on, I'll find my arrows."),
    ivyAshgrove.bark('You stayed alive. Makes my job look good.'),
    ivyAshgrove.bark('Off you go. Watch the corners.'),
  ],
  loanEnd: [
    ivyAshgrove.bark("That was the tower. Sydney only lent me for the tower, so I'm off."),
    ivyAshgrove.bark('Loan paper ends at the Warden. Glad I was here for it.'),
  ],
} satisfies MercenaryLines;

/** A monk: unhurried, kind, with a dry sense of what he has seen. */
const brotherAnselm = speakerLines('brotherAnselm');

export const BROTHER_ANSELM_LINES = {
  hired: [
    brotherAnselm.bark('Brother Anselm. I mend; I do not fight. Mostly I do not fight.'),
    brotherAnselm.bark('Peace to you. Bring me your bruises.'),
    brotherAnselm.bark('I will stay close. Not so close that I am in the way.'),
    brotherAnselm.bark('Lead on. I will keep you in one piece where I can.'),
  ],
  idle: [
    brotherAnselm.bark('A quiet corridor is a small mercy. I take it as one.'),
    brotherAnselm.bark('The order taught me to sit still. This place taught me to stop sitting.'),
    brotherAnselm.bark('Breathe in. Breathe out. Check the ceiling.'),
    brotherAnselm.bark('I have mended worse than whatever is ahead. I tell myself that.'),
  ],
  engage: [
    brotherAnselm.bark('Trouble. I will be behind you.'),
    brotherAnselm.bark('Go carefully. I am watching your back.'),
    brotherAnselm.bark('Something comes. I will keep my distance.'),
    brotherAnselm.bark('Ah. Here we are again.'),
  ],
  kill: [
    brotherAnselm.bark('Forgive me. It gave me no choice.'),
    brotherAnselm.bark('Rest, then.'),
    brotherAnselm.bark('The staff is for walking. Usually.'),
    brotherAnselm.bark('That was not my intention. It was my result.'),
  ],
  lowHp: [
    brotherAnselm.bark('Physician, heal thyself. I am trying.'),
    brotherAnselm.bark('I am wounded. Do not wait on me.'),
    brotherAnselm.bark('That one found me. I will manage.'),
    brotherAnselm.bark('A little help, if anyone can spare it.'),
  ],
  special: [
    brotherAnselm.bark('Be still. This will close it.'),
    brotherAnselm.bark('There. Mended.'),
    brotherAnselm.bark('Hold. Let it knit.'),
    brotherAnselm.bark('Breathe. The worst of it is passing.'),
  ],
  ownerHurt: [
    brotherAnselm.bark('You are hurt. Come to me when you can.'),
    brotherAnselm.bark('I see the wound. Give me a moment.'),
    brotherAnselm.bark('Steady. Help is coming.'),
    brotherAnselm.bark('That needs tending. Soon.'),
  ],
  catHurt: [
    brotherAnselm.bark(() => `${crawlerDisplayName('cat')}, come here, little one.`),
    brotherAnselm.bark(() => `I see you, ${crawlerDisplayName('cat')}. Hold on.`),
    brotherAnselm.bark('The cat is bleeding. I am coming.'),
    brotherAnselm.bark(() => `Easy, ${crawlerDisplayName('cat')}. Easy.`),
  ],
  downed: [
    brotherAnselm.bark('I have fallen. A hand, please.'),
    brotherAnselm.bark('Help me up. I cannot mend anyone from down here.'),
    brotherAnselm.bark('Still with you. Only lower.'),
    brotherAnselm.bark('Patience is a virtue. Speed would also be welcome.'),
  ],
  revived: [
    brotherAnselm.bark('Bless you. Truly.'),
    brotherAnselm.bark('Back on my feet. Thank you.'),
    brotherAnselm.bark('There is grace in a helping hand.'),
  ],
  potion: [
    brotherAnselm.bark('Even a healer needs a draught.'),
    brotherAnselm.bark('Mm. The abbey brewed it stronger.'),
    brotherAnselm.bark('A sip, and on.'),
  ],
  death: [
    brotherAnselm.bark('Go... in peace.'),
    brotherAnselm.bark('I have... no more to give.'),
    brotherAnselm.bark('Mend each other... when I cannot.'),
    brotherAnselm.bark('It is... all right.'),
  ],
  talk: [
    brotherAnselm.bark('The order sent me out to do good. The pay is how I keep doing it.'),
    brotherAnselm.bark('The staff is oak. It has walked further than most pilgrims.'),
    brotherAnselm.bark('Everyone asks if I pray before a fight. I pray during.'),
    brotherAnselm.bark('Mending is mostly attention. Most people only need someone to notice.'),
  ],
  floorEnd: [
    brotherAnselm.bark('The floor is done, and so is my contract. Go well.'),
    brotherAnselm.bark('You are whole. That is enough for today.'),
    brotherAnselm.bark('Peace go with you down the stairs.'),
    brotherAnselm.bark('Rest when you can. You will not, but you should.'),
  ],
  loanEnd: [
    brotherAnselm.bark(
      'The desk lent me for the tower, and the tower is quiet now. I will go back.',
    ),
    brotherAnselm.bark('My loan ends here. Take the cats home gently.'),
  ],
} satisfies MercenaryLines;

const tumbledown = speakerLines('tumbledown');

/**
 * The desk's equipment rental. It has no words, only the golem's stone
 * grunts (see `TUMBLEDOWN_GRUNTS` in `mercenaryVoices.ts`) — and a few things
 * a person could say about it, set in italics.
 */
export const TUMBLEDOWN_ACTIONS = {
  hired: [tumbledown.bark('Tumbledown lumbers into step behind you.')],
  talk: [
    tumbledown.bark('Tumbledown regards you with the warmth of a quarry.'),
    tumbledown.bark('Tumbledown shifts its weight. Somewhere, gravel settles.'),
    tumbledown.bark('Tumbledown says nothing, loudly.'),
    tumbledown.bark('Tumbledown blinks. It takes a while.'),
  ],
  downed: [tumbledown.bark('Tumbledown slumps into a heap. Something in it still grinds.')],
  revived: [tumbledown.bark('Tumbledown heaves itself back together.')],
  death: [tumbledown.bark('Tumbledown comes apart, one boulder at a time.')],
  floorEnd: [tumbledown.bark('Tumbledown turns and trudges back toward the Barracks.')],
  loanEnd: [
    tumbledown.bark('Tumbledown stops, looks at the dark circle, and turns for the Barracks.'),
  ],
} satisfies MercenaryLines;

/**
 * What each hire says on the tower errand in place of its small talk: the
 * cats, the climb and the Warden, and nothing about its own life. While the
 * cat is held in the tower the hire talks of getting her back; once she has
 * rejoined, of the climb with her to the cats still held at the top.
 */
const CRUSH_TOWER_TALK = [
  crush.bark('You find the cats. I keep things off you.'),
  crush.bark('The Warden is at the top. We go up.'),
  crush.bark('Stay close. This place was built to keep people out.'),
] as const satisfies NonEmpty<BarkLine>;

const CRUSH_TOWER_ERRAND = {
  cat_taken: {
    lines: {
      hired: [
        crush.bark('Under the tower, then up. Lead on.'),
        crush.bark(() => `We get ${crawlerDisplayName('cat')} back. Then the rest.`),
      ],
      idle: [
        crush.bark('Cats are up there somewhere. Keep moving.'),
        crush.bark('Stairs go up. So do we.'),
        crush.bark(() => `${crawlerDisplayName('cat')} is waiting. Not far now.`),
      ],
      talk: CRUSH_TOWER_TALK,
    },
  },
  party_whole: {
    lines: {
      hired: [
        crush.bark('Both of you, then. Good. Up we go.'),
        crush.bark(() => `${crawlerDisplayName('cat')} is back. Now the rest of the cats.`),
      ],
      idle: [
        crush.bark('The other cats are still up there. Keep moving.'),
        crush.bark('Stairs go up. So do we.'),
        crush.bark(() => `Stay near, ${crawlerDisplayName('cat')}. Not losing you twice.`),
      ],
      talk: CRUSH_TOWER_TALK,
    },
  },
} satisfies ErrandVoice;

const HAMMER_HANDS_TOWER_TALK = [
  hammerHands.bark("You lead us to the cats. I'll keep you standing."),
  hammerHands.bark("Whoever this Warden is, I'd like a word."),
  hammerHands.bark("Mind your step. This tower doesn't want us here."),
] as const satisfies NonEmpty<BarkLine>;

const HAMMER_HANDS_TOWER_ERRAND = {
  cat_taken: {
    lines: {
      hired: [
        hammerHands.bark("The tower it is. Let's fetch those cats home."),
        hammerHands.bark(() => `Let's go get ${crawlerDisplayName('cat')}. I'll keep you warded.`),
      ],
      idle: [
        hammerHands.bark('Cats first. Sightseeing later.'),
        hammerHands.bark('Every floor up is one closer to the cats.'),
        hammerHands.bark(() => `Hang on, ${crawlerDisplayName('cat')}. We're coming.`),
      ],
      talk: HAMMER_HANDS_TOWER_TALK,
    },
  },
  party_whole: {
    lines: {
      hired: [
        hammerHands.bark("Both of you in one piece. Let's fetch the rest of those cats."),
        hammerHands.bark(
          () => `Good to see you, ${crawlerDisplayName('cat')}. I'll keep you both warded.`,
        ),
      ],
      idle: [
        hammerHands.bark('Cats first. Sightseeing later.'),
        hammerHands.bark('Every floor up is one closer to the cats.'),
        hammerHands.bark(
          () => `Glad you're back with us, ${crawlerDisplayName('cat')}. Now for the others.`,
        ),
      ],
      talk: HAMMER_HANDS_TOWER_TALK,
    },
  },
} satisfies ErrandVoice;

const IVY_ASHGROVE_TOWER_TALK = [
  ivyAshgrove.bark("You find the cats. I'll cover you."),
  ivyAshgrove.bark("The Warden's at the top. I'd like a clear shot."),
  ivyAshgrove.bark('Quiet steps. No sense telling the tower we are here.'),
] as const satisfies NonEmpty<BarkLine>;

const IVY_ASHGROVE_TOWER_ERRAND = {
  cat_taken: {
    lines: {
      hired: [
        ivyAshgrove.bark("The tower, is it? Fine. Let's go get the cats."),
        ivyAshgrove.bark(
          () => `${crawlerDisplayName('cat')}'s up there? Then that's where we're going.`,
        ),
      ],
      idle: [
        ivyAshgrove.bark("Keep going. The cats won't free themselves."),
        ivyAshgrove.bark("Up's the way. I'll watch behind."),
        ivyAshgrove.bark(() => `We'll find ${crawlerDisplayName('cat')}. Keep moving.`),
      ],
      talk: IVY_ASHGROVE_TOWER_TALK,
    },
  },
  party_whole: {
    lines: {
      hired: [
        ivyAshgrove.bark("Both of you? Good. Let's go get the rest of the cats."),
        ivyAshgrove.bark(() => `Welcome back, ${crawlerDisplayName('cat')}. Now we go up.`),
      ],
      idle: [
        ivyAshgrove.bark("Keep going. The cats won't free themselves."),
        ivyAshgrove.bark("Up's the way. I'll watch behind."),
        ivyAshgrove.bark(() => `Eyes open, ${crawlerDisplayName('cat')}. They took you once.`),
      ],
      talk: IVY_ASHGROVE_TOWER_TALK,
    },
  },
} satisfies ErrandVoice;

const BROTHER_ANSELM_TOWER_TALK = [
  brotherAnselm.bark('Go to the cats. I will keep you mended on the way.'),
  brotherAnselm.bark('Whatever the Warden wants with them, the Warden will not keep them.'),
  brotherAnselm.bark('We rest when we are out. Not before.'),
] as const satisfies NonEmpty<BarkLine>;

const BROTHER_ANSELM_TOWER_ERRAND = {
  cat_taken: {
    lines: {
      hired: [
        brotherAnselm.bark('The tower, then. Let us bring the cats home.'),
        brotherAnselm.bark(() => `We will find ${crawlerDisplayName('cat')}. Lead on.`),
      ],
      idle: [
        brotherAnselm.bark('Somewhere above us, the cats are waiting.'),
        brotherAnselm.bark('One storey at a time. We will get there.'),
        brotherAnselm.bark(() => `Courage. ${crawlerDisplayName('cat')} is not far.`),
      ],
      talk: BROTHER_ANSELM_TOWER_TALK,
    },
  },
  party_whole: {
    lines: {
      hired: [
        brotherAnselm.bark('Together again. Let us bring the other cats home.'),
        brotherAnselm.bark(
          () => `Thank heaven, ${crawlerDisplayName('cat')}. Lead on, both of you.`,
        ),
      ],
      idle: [
        brotherAnselm.bark('Somewhere above us, the other cats are waiting.'),
        brotherAnselm.bark('One storey at a time. We will get there.'),
        brotherAnselm.bark(
          () => `Stay close, ${crawlerDisplayName('cat')}. We go up together now.`,
        ),
      ],
      talk: BROTHER_ANSELM_TOWER_TALK,
    },
  },
} satisfies ErrandVoice;

const TUMBLEDOWN_TOWER_ERRAND = {
  cat_taken: {
    lines: {},
    actions: {
      hired: [tumbledown.bark('Tumbledown lumbers into step behind you, facing the tower.')],
      talk: [
        tumbledown.bark('Tumbledown looks up, toward the top of the tower.'),
        tumbledown.bark('Tumbledown waits for you to lead on.'),
      ],
    },
  },
  party_whole: {
    lines: {},
    actions: {
      hired: [
        tumbledown.bark(
          'Tumbledown lumbers into step behind the two of you, facing the stairs up.',
        ),
      ],
      talk: [
        tumbledown.bark('Tumbledown looks up, toward the top of the tower.'),
        tumbledown.bark('Tumbledown looks down at the cat, then waits for you to lead on.'),
      ],
    },
  },
} satisfies ErrandVoice;

export const CRUSH = {
  lines: CRUSH_LINES,
  towerErrand: CRUSH_TOWER_ERRAND,
} satisfies MercenaryVoice;
export const HAMMER_HANDS = {
  lines: HAMMER_HANDS_LINES,
  towerErrand: HAMMER_HANDS_TOWER_ERRAND,
} satisfies MercenaryVoice;
export const IVY_ASHGROVE = {
  lines: IVY_ASHGROVE_LINES,
  towerErrand: IVY_ASHGROVE_TOWER_ERRAND,
} satisfies MercenaryVoice;
export const BROTHER_ANSELM = {
  lines: BROTHER_ANSELM_LINES,
  towerErrand: BROTHER_ANSELM_TOWER_ERRAND,
} satisfies MercenaryVoice;
export const TUMBLEDOWN_BASE = {
  lines: {},
  actions: TUMBLEDOWN_ACTIONS,
  towerErrand: TUMBLEDOWN_TOWER_ERRAND,
} satisfies MercenaryVoice;
