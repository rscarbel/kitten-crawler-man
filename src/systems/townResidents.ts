/**
 * The people who live in the Over City's buildings — named individuals layered
 * on top of the role system in `townDialog.ts` rather than replacing it.
 *
 * A role tells you what someone does for a living; a resident tells you who they
 * are. Street citizens and unnamed occupants keep the role path untouched, but
 * the anchor occupant of a named building — the innkeeper behind that bar, the
 * witch in that cottage — speaks as themselves, with:
 *
 *  - **ambient** — everyday lines in their own voice, rotated like the role pool;
 *  - **lore** — multi-page conversations told one per talk, in order, so a player
 *    who keeps coming back is rewarded with a story instead of a shuffled bark;
 *  - **reactive** — an optional pool gated on live quest flags, shown as the
 *    lead page so a resident can out-gossip the street about their own corner
 *    of the town.
 *
 * Pure data + selection: no rendering, no audio, no scene coupling. The lore is
 * sourced from the Over City as it appears in the books — Scolopendra's curse,
 * the skyfowl and their watchers, Featherfall's magistracy, Grimaldi's circus,
 * and the Syndicate's cameras — and from the game's own questlines, which the
 * `reactive` hooks read through the same `TownDialogContext` the street uses.
 */

import { dangerLine, isTownInDanger, type TownDialogContext } from './townDialog';
import { rotateLine } from './townServiceUtil';
import type { TownRole } from '../sprites/person/PersonAppearance';

export type ResidentId =
  | 'old_hilda'
  | 'brann_cartwright'
  | 'wendell'
  | 'marta_miller'
  | 'apothecary_fen'
  | 'deacon_aviel'
  | 'smith_varga'
  | 'innkeep_ossie'
  | 'innkeep_brend'
  | 'innkeep_marlow'
  | 'sgt_kessler'
  | 'corporal_pell'
  | 'tattooist_nim'
  | 'stock_clerk_wick';

export interface ResidentDef {
  readonly id: ResidentId;
  /** Shown as the dialog speaker in place of the role's job title. */
  readonly name: string;
  /** Appearance and voice base; also the fallback when the town is in danger. */
  readonly role: TownRole;
  /** The building this resident anchors, keyed by `entry.name` exactly. */
  readonly home: string;
  /** Everyday lines in this person's own voice — replaces the role pool. */
  readonly ambient: ReadonlyArray<string>;
  /** Multi-page conversations, told one per talk in order, then retired. */
  readonly lore: ReadonlyArray<ReadonlyArray<string>>;
  /**
   * Quest-reactive lines for the current world state, or `null` when this
   * resident has nothing timely to say. Returned as a pool so repeat talks
   * during a long-running stage still vary.
   */
  readonly reactive?: (ctx: TownDialogContext) => ReadonlyArray<string> | null;
}

function circusResolved(ctx: TownDialogContext): boolean {
  return ctx.circus === 'grimaldi_slain' || ctx.circus === 'complete';
}

function circusUnderway(ctx: TownDialogContext): boolean {
  return ctx.circus === 'heather_hunt' || ctx.circus === 'bigtop_ready';
}

function murderResolved(ctx: TownDialogContext): boolean {
  return ctx.murder === 'quill_slain' || ctx.murder === 'complete';
}

function murderOpen(ctx: TownDialogContext): boolean {
  return (
    ctx.murder === 'body_waiting' ||
    ctx.murder === 'investigation' ||
    ctx.murder === 'cult_hideout' ||
    ctx.murder === 'confrontation'
  );
}

const RESIDENT_DEFS: ReadonlyArray<ResidentDef> = [
  {
    id: 'old_hilda',
    name: 'Old Hilda',
    role: 'priest',
    home: "Old Hilda's Cottage",
    ambient: [
      'Mind the jars by the door, dearie. Two of them are still alive.',
      'Sit if you like. The stool only bites people who lie to me.',
      'You smell of the ruins. Wash it off before it decides to stay.',
      'I have no roof-tax and no god. Suits me and it suits the neighbours.',
      'Everyone wants a charm. Nobody wants to hear what it costs.',
      'Old woman, small house, long memory. That is the whole of me.',
    ],
    lore: [
      [
        'You want to know why the walls are so thick. Everybody does, eventually.',
        'This was a city once. Not a village hiding behind stone — a city, ten times over, running right out to where the ruins are now.',
        'Then the poison came up out of the ground. Scolopendra’s curse, the temple calls it. I just call it the bad year.',
        'The ones who breathed it did not die. That is the part nobody says out loud. They changed, and they wandered off, and some of them are still out there wearing the faces of my neighbours.',
      ],
      [
        'The things in the ruins — you have killed some, I imagine. Did you look at their hands?',
        'They keep the hands. Whatever else goes, the hands stay near enough human to be a problem.',
        'Baker on Low Street had a birthmark like a spilled cup. I saw it again on something with four legs, three winters back.',
        'So no, I do not weep for them. But I do not pretend I am killing monsters, either. Neither should you.',
      ],
      [
        'The tower does not sit on stone. It sits on a crystal, and the crystal is full of people.',
        'Souls, the deacon would say. The magistrate says "civic reserve" and changes the subject.',
        'Whatever it is, it hums. I have felt it in my teeth every night for forty years.',
        'If it ever stops humming, dearie, do not go and look. Run.',
      ],
    ],
    reactive: (ctx) => {
      if (ctx.doomsday === 'complete') {
        return [
          'The humming stopped. I sat here waiting to be ash — and instead the kettle boiled.',
          'You carried that thing out of the tower. I have no charm big enough to thank you with.',
        ];
      }
      if (circusResolved(ctx)) {
        return [
          'The lights over the Big Top went out. That is the first quiet night the ruins have given us in years.',
          'Grimaldi was a kind man before the vine had him. Whatever you did up there, you did it to a family, not a monster. Sit with that.',
        ];
      }
      if (circusUnderway(ctx)) {
        return [
          'Do not look at the lights over the old circus. Looking is how it starts.',
          ctx.heatherSlain
            ? 'You put the bear down. She used to ride a bicycle for the children, you know. Small mercies are still mercies.'
            : 'There is a bear out there that used to be somebody’s daughter. Be quick about it, for her sake.',
        ];
      }
      if (murderOpen(ctx)) {
        return [
          'Bodies by the well, and the guard calling it beasts. Beasts do not take only the head, dearie.',
          'Ask who benefits. It is always who benefits. The cards are just a slower way of saying so.',
        ];
      }
      if (murderResolved(ctx)) {
        return ['The night-killer is done. I slept through till dawn, first time since the frost.'];
      }
      return null;
    },
  },
  {
    id: 'brann_cartwright',
    name: 'Brann Cartwright',
    role: 'laborer',
    home: "Cartwright's Workshop",
    ambient: [
      'Wheel’s a circle. Anybody can draw one. Making it stay one — that is the trade.',
      'Mind the shavings. I sweep on feast days and it is not a feast day.',
      'If it rolls and it is not mine, I probably fixed it.',
      'You need an axle, I am your man. You need advice, go to the pub.',
      'Slow work, honest work. The two are usually the same work.',
    ],
    lore: [
      [
        'See that long wagon-bed against the wall? Painted red under the dust.',
        'I built eleven of those for Grimaldi, back when the circus still toured the villages instead of squatting in the ruins.',
        'He paid on the day, every time, and he asked after my knees. You do not forget the ones who ask after your knees.',
        'I have not been able to bring myself to burn it. Stupid, for a man who sells firewood.',
      ],
      [
        'I had an apprentice. Teodo. Good hands, no patience — the usual.',
        'He went out past the west gate on a dare. Boys do. Most of them come back with a story and a scraped elbow.',
        'The guards found his belt. Just the belt, hung neat on a fencepost, which is the part that keeps me up.',
        'So when I tell you the ruins are not a place to prove anything — I am not being careful. I am being specific.',
      ],
      [
        'You have noticed them, surely. The little floating eyes, out over the plaza.',
        'They follow the interesting people. That is you, crawler, before you ask.',
        'Whole world watching us die and calling it a season. Somebody somewhere is placing a wager on which of us goes first.',
        'I keep the shutters closed and I make wheels. Let them film a man making wheels. Serves them right.',
      ],
    ],
    reactive: (ctx) => {
      if (circusResolved(ctx)) {
        return [
          'They tell me the troupe walk free. Eleven wagons I built them, and not one to ride out on. I would build eleven more.',
          'If any of them want a cart to leave in, my yard is open and the price is nothing.',
        ];
      }
      if (circusUnderway(ctx)) {
        return [
          'You are going out to the circus. Take a lamp, take rope, and do not take the road I built — it goes where the wagons went.',
        ];
      }
      if (ctx.doomsday === 'complete') {
        return [
          'The whole street shook and the shelf held. That is the best review my joinery will ever get.',
        ];
      }
      return null;
    },
  },
  {
    id: 'wendell',
    name: 'Wendell',
    role: 'farmer',
    home: "Shepherd's Cabin",
    ambient: [
      'Forty-one head. Was forty-three. I count them twice now, out of spite.',
      'Dog’s better at this than I am. Do not tell him.',
      'You can sleep out there if you like. I will not, and I have the wall.',
      'Grass is greener past the wall. So is everything else, and that is the trouble.',
      'A shepherd who stops counting is a butcher who does not know it yet.',
    ],
    lore: [
      [
        'Lost two to the ruins in the spring. Everyone says that like it is weather.',
        'It is not weather. I walked the line after and there was no blood. None. Sheep make a mess when something eats them.',
        'These were taken tidy. Gate opened, gate closed. Whatever came through has hands and it has manners.',
        'I would rather it had been wolves. I know what to do about wolves.',
      ],
      [
        'Do not tell the guard I told you. They have started writing me down as "the excitable one".',
        'Two weeks back, near the south wall, past the last verge post. Moonlight, near enough.',
        'Something crossed the field on too many legs. Not a spider — I know spiders, we have them the size of dogs now.',
        'This one was long. It went over the rubble the way water goes over a step, and it did not hurry, and I have not slept right since.',
      ],
      [
        'The old boundary stones are out there still, half a day past the wall.',
        'My grandfather’s flock grazed all of it. There was a lane, and hedges, and a chapel with a bell.',
        'I have seen the bell. It is in a heap with a lot of other bells, and something built the heap on purpose.',
        'That is what I cannot get past. Something out there is tidying.',
      ],
    ],
    reactive: (ctx) => {
      if (murderOpen(ctx)) {
        return [
          'They are calling the killings beasts. I keep beasts. That was not beasts.',
          'A beast takes the soft parts and leaves the rest in the mud. Ask anyone who has actually buried a lamb.',
        ];
      }
      if (circusUnderway(ctx)) {
        return [
          'Whatever is stirring out at the old circus has the flock stupid with fright. They will not go near the south fence.',
        ];
      }
      if (ctx.doomsday === 'complete') {
        return ['Not one lost the night the tower nearly went. Not one. I counted twice.'];
      }
      return null;
    },
  },
  {
    id: 'marta_miller',
    name: 'Marta Miller',
    role: 'farmer',
    home: "Miller's Farm",
    ambient: [
      'Flour on everything. You get used to it or you leave.',
      'Eat something. You are all edges.',
      'Sixteen sacks a week to the Barracks and they still call it a favour.',
      'If the mill stops, the town eats its seed corn. So the mill does not stop.',
      'You want the price or you want the truth? They are different numbers.',
    ],
    lore: [
      [
        'You will hear the Barracks say they feed this town. They do not. I do.',
        'Sixteen sacks a week at a price the magistrate set in a year when there were roads.',
        'I do not argue. A walled town that goes hungry stops being a walled town very fast — it just becomes a wall.',
        'But do not let anyone tell you the garrison is what keeps us. It is grain. It is always grain.',
      ],
      [
        'My boy Corvin. Fifteen, and about as sensible as a barn cat.',
        'He watches the crawlers come up out of the stairwell and he thinks that is a life. Levels. Loot. A crowd somewhere cheering.',
        'I have told him what you all look like on the way back down. He hears it as a challenge, of course.',
        'So do me a kindness. If he asks you what it is like — do not make it sound good.',
      ],
      [
        'The south field used to run right out to where the ruins start.',
        'You can still see the furrows from the loft, under the rubble. Straight as a ruled line, forty rows of them.',
        'My great-grandmother sowed those. Now I farm a square of dirt inside a wall and call it the South Green.',
        'The curse did not just take people. It took the acreage, and nobody writes songs about acreage.',
      ],
    ],
    reactive: (ctx) => {
      if (ctx.doomsday === 'complete') {
        return [
          'Corvin watched the tower from the loft and cried. He has not asked about being a crawler since. Thank you for that, oddly.',
        ];
      }
      if (murderResolved(ctx)) {
        return ['The mill runs at night again. That is what your work bought, in flour.'];
      }
      if (murderOpen(ctx)) {
        return [
          'I have the girls sleeping in the mill house till this is done. Two doors and a bar on each.',
        ];
      }
      return null;
    },
  },
  {
    id: 'apothecary_fen',
    name: 'Apothecary Fen',
    role: 'merchant',
    home: 'Herb & Remedy',
    ambient: [
      'Everything on that shelf will help you. Some of it twice, in opposite directions.',
      'Coin on the counter, ailment out loud. I have heard worse than yours.',
      'No, I will not tell you what is in it. You would only worry.',
      'A potion is a promise with a shelf life. Read the date.',
      'I sell cures. Prevention is free and nobody takes it.',
    ],
    lore: [
      [
        'I trained in the tower roosts. Under the skyfowl, not beside them — they are very clear on the distinction.',
        'Nine years grinding for a healer who never once told me his name. Just "the work", and a claw pointing at the next thing.',
        'They mend better than we do. Faster, cleaner, and they will not say why.',
        'What I did learn, I learned by watching. That is most of medicine anyway.',
      ],
      [
        'You want my theory on the ruins? Everyone else has one, so here is mine.',
        'The poison is not gone. It settled. It is in the ground water east of the wall, and it comes up when it rains hard.',
        'That is why the changed things drift toward the low streets in wet weather, and why nobody ever cures one.',
        'You cannot cure a place. You can only stay upwind of it, which is a poor sort of medicine to sell.',
      ],
      [
        'Bring me anything you find out there in a stoppered jar and I will look at it. I mean that.',
        'Half my stock started as something horrible in a bottle that somebody braver than me carried home.',
        'The blue-veined moss under the ruin shells — that is two of the three things in your health potion.',
        'The third thing is honey, and it is honey because otherwise you would never drink it twice.',
      ],
    ],
    reactive: (ctx) => {
      if (murderOpen(ctx)) {
        return [
          'The bodies. I was asked to look at one, and I will say to you what I said to the guard: no beast does that.',
          'The cuts were placed. Placed, crawler. Somebody with an anatomy text and a steady hand.',
        ];
      }
      if (murderResolved(ctx)) {
        return [
          'Whoever was cutting has stopped. My hands stopped shaking about a day after. I notice these things professionally.',
        ];
      }
      if (circusUnderway(ctx)) {
        return [
          'If you are going to the circus, take twice what you think. Nobody has ever come back saying they brought too many potions.',
        ];
      }
      return null;
    },
  },
  {
    id: 'deacon_aviel',
    name: 'Deacon Aviel',
    role: 'priest',
    home: 'Temple of the Sky',
    ambient: [
      'The dome is new. The faith is not. Try not to confuse them.',
      'Kneel or do not. It is a roof either way.',
      'We take donations, not tithes. There is a difference and it is mostly dignity.',
      'You may look up in here. Most people forget they are allowed.',
      'I have buried more of this town than I have blessed. I am working on the ratio.',
    ],
    lore: [
      [
        'You will hear it said in the square: the skyfowl are not birds, they are watchers.',
        'People repeat it like a pleasantry. It is not a pleasantry. It is the whole of the doctrine and it is a warning.',
        'A watcher is not a guardian. A watcher observes, and records, and does not intervene, and is not sorry.',
        'We built them a dome anyway. That is what faith is, mostly — building for someone who is only taking notes.',
      ],
      [
        'There are elves in the low streets who have got it badly wrong.',
        'They have decided a watcher must be an angel, and that an angel must want something, and that they are the ones to give it.',
        'I have preached against it three seasons running. It only made them meet somewhere I am not.',
        'Doctrine you cannot correct becomes a cult. I have seen the shape of it before.',
      ],
      [
        'Magistrate Featherfall has not come to the dome in six weeks.',
        'He came every seventh day for thirty years. He is skyfowl; it is not devotion, it is habit, and their habits do not break.',
        'I sent word twice. I received back a very polite note in a hand that is not his.',
        'I am a deacon. I am not permitted to say what I think that means. But you are not a deacon.',
      ],
    ],
    reactive: (ctx) => {
      if (ctx.doomsday === 'complete') {
        return [
          'The watchers watched. You acted. I will be some time working out what to preach about that.',
          'The dome held. Half the town was under it. Whatever you did up there, it reached down here.',
        ];
      }
      if (ctx.murder === 'cult_hideout' || ctx.murder === 'confrontation' || ctx.quillNamed) {
        return [
          'So it was the elves after all, and worse than I feared. I warned the wrong people, in the wrong tone, for three years.',
          'When you find whoever taught them that a watcher wants blood — that is the one to end. The rest are just parishioners.',
        ];
      }
      if (murderResolved(ctx)) {
        return [
          'The dome is full again on the seventh day. Fear fills pews, but so does relief, and relief pays better.',
        ];
      }
      if (murderOpen(ctx)) {
        return [
          'They were taken from the low streets, all of them. The town notices a death by the temple and forgets one by the alley.',
          'Sit with me a moment before you go back out. No sermon. I would just rather you did not go straight there.',
        ];
      }
      return null;
    },
  },
  {
    id: 'smith_varga',
    name: 'Smith Varga',
    role: 'smith',
    home: 'The Rusty Anvil',
    ambient: [
      'Do not touch the black end. Everything here is the black end.',
      'Bring me the blade, not a description of the blade.',
      'Fifty years and the forge still tells me when I am rushing.',
      'A weapon is a tool that has to be right the first time. That is the entire difference.',
      'If it broke, it was going to. I can usually tell you when.',
    ],
    lore: [
      [
        'I shod horses for the garrison before the floor opened. Horses, crawler. There were horses.',
        'Then the stair came up in the middle of the Low Quarter and everything I know how to make went out of fashion in a week.',
        'Now it is edges. Everyone wants edges. Nobody wants a hinge.',
        'I still make hinges. Somebody has to, or the doors that keep the ruins out stop being doors.',
      ],
      [
        'Look at the anvil face. See the dish worn into it, deep as a thumb?',
        'That is not mine. That is three smiths of wear, and the first of them worked outside the wall, in a street that is rubble now.',
        'They carried it in on a sledge during the bad year. Left the house, left the tools, brought the anvil.',
        'When you next wonder what this town is — it is the people who chose the anvil.',
      ],
      [
        'The garrison sends me their steel back bent and I send it out straight and neither of us discusses where it got bent.',
        'But I read it. Every dent is a direction. A notch high on the left edge means something tall and quick came down at them.',
        'I have been reading a lot of high notches this season. That is a thing worth knowing before you go past the gate.',
        'Take that however you like. I am a smith. I only report the metal.',
      ],
    ],
    reactive: (ctx) => {
      if (circusUnderway(ctx)) {
        return [
          'Going to the circus, are you. Bring the blade by first — I would rather sharpen it than straighten it after.',
        ];
      }
      if (ctx.doomsday === 'complete') {
        return [
          'Forge went out when the tower shook. First time in nine years. Relighting it felt like a small argument won.',
        ];
      }
      if (murderResolved(ctx) || circusResolved(ctx)) {
        return [
          'Word gets to the forge eventually. Whatever you have been doing out there, the steel coming back is in better shape for it.',
        ];
      }
      return null;
    },
  },
  {
    id: 'innkeep_ossie',
    name: 'Innkeep Ossie',
    role: 'innkeeper',
    home: 'The Sleeping Cat Inn',
    ambient: [
      'Beds upstairs, stew downstairs, and no fighting on the rug.',
      'You look like a person who has not eaten sitting down in a while.',
      'We are the quiet house. The Stump is that way and good luck to you.',
      'Everything on the board heals something. Even the bread. Especially the bread.',
      'Travellers pay in coin. Story is a discount, though.',
    ],
    lore: [
      [
        'You are wondering about the sign. Everyone gets around to the sign.',
        'There was a cat. Came in off the ruins road about nine years back, sat on that stool, and would not be moved.',
        'Now — I am going to say this plainly and you may do what you like with it. That cat talked.',
        'Talked its way out of the ruins, talked its way into my kitchen, and talked me out of a very good ham. Then it left. I painted the sign the next morning.',
      ],
      [
        'People come in off the stair and they tell me things while the stew cools. That is the trade, really. The stew is a pretext.',
        'A woman last month swore the second floor has a shopping arcade in it. An actual arcade, with a fountain.',
        'A fellow the week before said there is a floor made of a single room, and the room is a mouth.',
        'I write them in the ledger. Half are drink. But I have never yet had one turn out to be entirely invented.',
      ],
      [
        'The upstairs rooms are all the same except the end one. That one has a bolt on the inside and one on the outside.',
        'It was for a crawler who came up in a bad state and asked to be locked in. Politely. With a written note.',
        'She was fine by morning. Ate two breakfasts and left a gold piece under the plate.',
        'I have never taken the outside bolt off. Some nights the offer is the kindest thing I keep.',
      ],
    ],
    reactive: (ctx) => {
      if (murderOpen(ctx)) {
        return [
          'I am not letting rooms after dark this week. Not to anyone. Say what you like about the coin.',
        ];
      }
      if (murderResolved(ctx)) {
        return [
          'Full house tonight, first time in a month. You did that. Sit down and I will make sure you never see a bill in here.',
        ];
      }
      if (circusResolved(ctx)) {
        return [
          'Two of the circus folk took a room. They slept nineteen hours and asked whether the war was over. I said near enough.',
        ];
      }
      if (ctx.doomsday === 'complete') {
        return ['The Sleeping Cat is still standing. So is everything else. Stew is free today.'];
      }
      return null;
    },
  },
  {
    id: 'innkeep_brend',
    name: 'Innkeep Brend',
    role: 'innkeeper',
    home: 'The Horned Flagon',
    ambient: [
      'The Flagon keeps a table. Mind which one you take.',
      'We do not water the mead and we do not extend credit. Both are policy.',
      'That is the guild corner. They will not thank you for sitting in it.',
      'Boots off the bench, please. It is older than your family line.',
      'I hear a great deal in here and repeat about a third of it.',
    ],
    lore: [
      [
        'This is the respectable house, which mostly means the arguments are quieter and the debts are larger.',
        'Guild factors, the magistrate’s clerks, two of the wool families. They all sit where they always sit.',
        'The seating chart in my head has not changed in twenty years. When it changes, something has happened in this town.',
        'It changed last month. I will leave it there for now.',
      ],
      [
        'There is a crawler guild recruiting through here. Brynhild’s Daughters — Hekla’s lot.',
        'They are not subtle. Hekla came in, looked at the room, and named a figure at a stranger inside a minute.',
        'She has her eye on the ones with a following. Anybody the little floating eyes crowd around.',
        'Which is to say: if a very tall woman buys you a mead, she is not buying you a mead.',
      ],
      [
        'The clerks stopped coming. All of them, the same week.',
        'Magistrate’s people drank here every seventh night for as long as I have had the lease. Then nothing.',
        'One did come back, alone, and paid for a room he did not sleep in, and left before light.',
        'I do not gossip about the magistracy. I am simply telling you about my custom, which is my own business to discuss.',
      ],
    ],
    reactive: (ctx) => {
      if (ctx.quillNamed || ctx.murder === 'confrontation') {
        return [
          'Quill. She sat at the guild corner twice and drank nothing both times. I remember it because nobody does that.',
          'If you are going after her, do it while the clerks are still frightened of her. Afterwards they will all have been suspicious of her from the start.',
        ];
      }
      if (murderResolved(ctx)) {
        return [
          'The clerks are back and the seating chart is nearly right again. That is my measure of a town at peace.',
        ];
      }
      if (murderOpen(ctx)) {
        return [
          'The good families have their people walking them home now. From the Flagon. Four streets.',
        ];
      }
      if (circusResolved(ctx)) {
        return [
          'The wool families have decided they always admired the circus folk. Wonderful how that works.',
        ];
      }
      return null;
    },
  },
  {
    id: 'innkeep_marlow',
    name: 'Innkeep Marlow',
    role: 'innkeeper',
    home: 'The Sunken Stump Pub',
    ambient: [
      'Ale’s cheap, the floor is level in one corner, and that is the whole pitch.',
      'You break it, you bought it. You bleed on it, that is free.',
      'Nobody in here is anybody. That is why they come.',
      'I have thrown out better than you and worse than you in the same hour.',
      'Do not go out the back way unless you know the back way.',
    ],
    lore: [
      [
        'The Stump has two doors and only one of them is on a street.',
        'The other goes into the service alley — runs behind the whole Low Quarter and comes out by the club.',
        'Nobody paved it, nobody lights it, and nobody official has walked it in years.',
        'Half this town’s business happens in that alley. So does the other half, the sort that leaves marks.',
      ],
      [
        'My custom is the low streets. Dockless porters, night girls, the fellows who carry things for the club.',
        'They are the ones who go missing, and they are the ones nobody puts a notice up for.',
        'Three from this room this season. The guard wrote "left town" and went back to the plaza.',
        'They did not leave town. Not one of them owed me money, and everyone who leaves town owes me money.',
      ],
      [
        'You want to know how the Low Quarter really works? Everything moves through the club.',
        'The Desperado takes anybody with a pass and asks nothing, which makes it the safest room in the city and the worst one to be seen in.',
        'Deals get struck there and settled out here in the dark. That is the arrangement and it has held for years.',
        'It has stopped holding. Somebody has started settling things that were never struck.',
      ],
    ],
    reactive: (ctx) => {
      if (ctx.murder === 'not_started') {
        return [
          'Three of my regulars gone this season and no notice on the board for any of them. Ask me again in a week and it will be four.',
          'Something is working the low streets and the guard will not hear it until it does a murder somewhere with cobbles.',
        ];
      }
      if (murderOpen(ctx)) {
        return [
          'Now they care. Now there is a body somewhere respectable and suddenly there is an investigation.',
          'Try the alley behind here. Whatever it is, it uses the alley — I have had the back door bolted for a fortnight.',
        ];
      }
      if (murderResolved(ctx)) {
        return [
          'You went and did it. For my lot, who nobody was counting. Your money is no good in the Stump, and I say that to nobody.',
        ];
      }
      if (ctx.doomsday === 'complete') {
        return ['Whole city nearly went and the Stump did not lose a single glass. Cursed place.'];
      }
      return null;
    },
  },
  {
    id: 'sgt_kessler',
    name: 'Sgt. Kessler',
    role: 'guard',
    home: 'Blackwood Lodge',
    ambient: [
      'Lodge is garrison ground. Be useful or be brief.',
      'Two of us, one alley, no relief. You do the arithmetic.',
      'I do not want your name. I want to know which way you came in.',
      'Watch rotation is eleven hours. Ask me again about morale.',
      'If you hear a whistle from this alley, go the other way and send someone.',
    ],
    lore: [
      [
        'You are asking why a garrison post sits at the arse end of a dead-end alley.',
        'Because the alley is not a dead end. Not underneath.',
        'Every cellar on this row connects, and the row runs under the north wall. Old drainage, older than the wall.',
        'The Lodge is not watching the alley, crawler. It is sitting on the lid.',
      ],
      [
        'We have had four postings here in six years and I am the only one on his second.',
        'The others transferred out. All requested it. All wrote the same phrase in the request: "unsuitable for continued duty".',
        'That is not a phrase soldiers use. That is a phrase someone gives soldiers to use.',
        'I stopped filing requests and started keeping a log instead. The log is not on the wall.',
      ],
      [
        'There were candles down there. Set out properly, in a ring, and burnt to stubs on a floor nobody is supposed to reach.',
        'Whoever met in that cellar met often and met quietly and did not leave in a hurry.',
        'I reported it up the chain twice. Both times the report came back marked resolved by an office that never sent anyone.',
        'So now I tell people like you instead. Do with it what the magistracy will not.',
      ],
    ],
    reactive: (ctx) => {
      if (ctx.murder === 'cult_hideout') {
        return [
          'You are going into the cellar. Good. Take the left branch — the right one floods and they know it.',
          'Whatever is written on those walls, read it before you burn it. That is the whole of my request.',
        ];
      }
      if (ctx.quillNamed) {
        return [
          'A name at last, and it came out of my cellar. Six years of reports marked resolved by an office that never sent anyone — and now I know which office.',
        ];
      }
      if (murderResolved(ctx)) {
        return [
          'They have finally sent me a second pair of boots for this post. That is what a win looks like at my rank.',
          'What we found in the cellar went to the temple, not the magistracy. Deacon Aviel insisted. So did I.',
        ];
      }
      if (murderOpen(ctx)) {
        return ['Doubled the alley watch. It is still two of us. I have doubled the walking.'];
      }
      return null;
    },
  },
  {
    id: 'corporal_pell',
    name: 'Corporal Pell',
    role: 'guard',
    home: 'The Barracks',
    ambient: [
      'Off duty. Talk quietly and I will pretend I am not listening.',
      'Bunk is warm, roof is whole. After a floor, that is a palace.',
      'You want advice, the old rat by the fire gives it better than I do.',
      'They let anybody up the stair into this room. That is the point of it.',
      'I have been down. I am not going back down. We can still be friends.',
    ],
    lore: [
      [
        'I ran the second floor. Whole thing, gate to gate, with eleven others.',
        'Four came up. Then two of those went back for reasons I have stopped asking about.',
        'The garrison took me on because I could describe a stairwell accurately. That is the whole of my qualification.',
        'So when I say a floor is survivable, understand what I am comparing it to.',
      ],
      [
        'The Barracks is a safe room. Actually safe — the system says so, and the system does not lie about that particular thing.',
        'Nothing hostile crosses that threshold. Not the changed, not the krasue, not whatever you dragged home on your boot.',
        'Every guard in here has slept through something outside that would have killed them awake.',
        'It is the only promise anybody on this floor has kept. We are all a bit sentimental about it.',
      ],
      [
        'Watch the timer, crawler. Everyone forgets the timer because the town has a market and a pub and it feels like a place.',
        'Twenty days, they say. It was twenty days on the last floor too, and then it was eight.',
        'They cut it when the audience gets bored. That is not a rumour, it is a schedule.',
        'Do the thing you are putting off. Whatever it is. Do it this week.',
      ],
    ],
    reactive: (ctx) => {
      if (ctx.doomsday === 'containment' || ctx.doomsday === 'escape') return null;
      if (ctx.doomsday === 'complete') {
        return [
          'Every guard in this room was ready to die in it. You made that unnecessary and none of us know how to say thank you for that.',
        ];
      }
      if (circusResolved(ctx) && murderResolved(ctx)) {
        return [
          'Two of the ugliest jobs on this floor, both closed, both you. The sergeants have started saying your name properly.',
        ];
      }
      if (murderOpen(ctx)) {
        return [
          'Half the garrison is on night patrol and the other half is pretending to sleep. Take somebody with you out there.',
        ];
      }
      return null;
    },
  },
  {
    id: 'stock_clerk_wick',
    name: 'Wick',
    role: 'commoner',
    home: 'General Store',
    ambient: [
      'Shopkeep is at the counter. I am the one who knows where anything is.',
      'Rope, lamp oil, chalk, a pot. That is the list. It is always the list.',
      'You want the good potions, go to the herbalist. I will not pretend otherwise.',
      'Everything on that top shelf is for people who have already made a mistake.',
      'I restock in the morning and by evening it is all gone again. Every day.',
    ],
    lore: [
      [
        'I have been counting what crawlers buy for two years. I could write a book.',
        'Week one off the stair, they buy rope, chalk and a lamp. Sensible. Careful.',
        'Week two they buy potions and nothing else. Every single one of them.',
        'There is no week three purchase. I want to be very clear that I am not being grim. I am reading the ledger.',
      ],
      [
        'The floating eyes come in here too. Three of them, usually over the potion shelf.',
        'They are not interested in the shop. They are interested in who is buying in a hurry.',
        'I worked out early that if the eyes crowd somebody at my counter, that person is having a day.',
        'So I give those ones an extra potion and put it down as breakage. Do not tell the shopkeep.',
      ],
      [
        'Somebody bought every lamp in the shop in one go. Six weeks back. Paid in old coin.',
        'Not a crawler. Town clothes, town accent, would not give a name for the book.',
        'Lamps, oil, and forty candles. Forty. For a house nobody in this town has ever been invited to.',
        'I have thought about it a lot since the killings started. I have not thought of anywhere good to take it.',
      ],
    ],
    reactive: (ctx) => {
      if (murderOpen(ctx)) {
        return [
          'Ask me about the candles. Everyone asks the guard things. Nobody asks the person who sold the candles.',
          'Whoever bought out my lamps six weeks ago did it in old coin and would not sign the book. Make of that what you like.',
        ];
      }
      if (murderResolved(ctx)) {
        return ['Nobody has bought a candle in bulk since. I check. I will always check now.'];
      }
      if (ctx.doomsday === 'complete') {
        return [
          'Sold out of everything in an hour that night and gave most of it away. The shopkeep has decided to be proud of me about it.',
        ];
      }
      return null;
    },
  },
  {
    id: 'tattooist_nim',
    name: 'Nim',
    role: 'merchant',
    home: "Signet's Ink",
    ambient: [
      'Sit. Do not watch the needle, watch the wall. Everyone thinks they are the exception.',
      'One mark per crawler. I have explained why. I will not explain again today.',
      'No, I cannot do a portrait. The ink gets ideas about faces.',
      'It will itch for a day and then it will start paying attention.',
      'The chair is comfortable. That is deliberate and it is the only kindness in here.',
    ],
    lore: [
      [
        'The shop is named for her, not run by her. Get that straight before you ask me for anything clever.',
        'Tsarina Signet wears her work. All of it, all at once, and it moves when she is thinking.',
        'She came through once, looked at my line, and corrected it with her thumbnail. Did not say a word.',
        'The line has been better ever since. I am not sure it is still mine.',
      ],
      [
        'Living ink is not decoration. It is a small agreement with something that wants a place to sit.',
        'That is why one mark per crawler. Two marks argue. I have seen two marks argue and I would like to stop seeing it.',
        'They argue about you, by the way. That is the part people are never ready for.',
        'Choose the one you want to be nagged by for the rest of your run.',
      ],
      [
        'The Syndicate loves this shop. Loves it. There are three of those little eyes in here right now.',
        'A crawler getting inked is good television — pain, a decision, and a shape the audience can recognise later.',
        'They put my chair on a highlight reel. My chair. I have never been paid and I have never been asked.',
        'So I have started doing very slow, very boring linework whenever the eyes get close. Small revenge. It is what I have.',
      ],
    ],
    reactive: (ctx) => {
      if (circusUnderway(ctx)) {
        return [
          'Signet is out at the circus and the ink in here has been restless for days. It knows where she is. I find that unpleasant.',
        ];
      }
      if (circusResolved(ctx)) {
        return [
          'The ink settled the night the Big Top went quiet. Whatever happened out there, her work knows it ended.',
          'She has not come back. I keep the chair clear anyway.',
        ];
      }
      if (ctx.doomsday === 'complete') {
        return [
          'Every mark in the shop turned to face the tower that night. Every one. I have not slept in the shop since.',
        ];
      }
      return null;
    },
  },
];

const RESIDENTS_BY_ID = new Map<ResidentId, ResidentDef>(RESIDENT_DEFS.map((def) => [def.id, def]));

/** The named resident with this id. */
export function residentById(id: ResidentId): ResidentDef {
  const def = RESIDENTS_BY_ID.get(id);
  if (def === undefined) throw new Error(`Unknown resident id: ${id}`);
  return def;
}

/** Every authored resident, for registries and validation sweeps. */
export function allResidents(): ReadonlyArray<ResidentDef> {
  return RESIDENT_DEFS;
}

/**
 * A named resident presented as the host of a priced menu: their name for the
 * menu's byline, and one of their own lines in place of the generic role bark.
 * Null for a service run by an unnamed occupant, which keeps its module default.
 */
export interface ResidentHost {
  readonly name: string;
  readonly line: string;
}

export function residentHost(def: ResidentDef | null, turn: number): ResidentHost | null {
  if (def === null) return null;
  return { name: def.name, line: rotateLine(def.ambient, turn) };
}

/**
 * Builds the lines for one conversation with a named resident.
 *
 * A reactive line leads when the world state has given this person something
 * timely to say. The body of the conversation is the next untold lore entry —
 * `turn` walks the list in order, so the first few talks are a story — and once
 * the list runs out it settles into their personal ambient rotation.
 *
 * @param def  The resident speaking.
 * @param turn How many times the player has already talked to them.
 * @param ctx  Live quest snapshot driving the reactive layer.
 */
export function buildResidentConversation(
  def: ResidentDef,
  turn: number,
  ctx: TownDialogContext,
): string[] {
  if (isTownInDanger(ctx)) return [dangerLine(def.role)];

  const lines: string[] = [];
  const reactivePool = def.reactive?.(ctx) ?? null;
  if (reactivePool !== null && reactivePool.length > 0) {
    lines.push(rotateLine(reactivePool, turn));
  }

  // `?? null` rather than a bare index: an out-of-range read yields `undefined`,
  // which a `!== null` guard waves through and `push(...undefined)` throws on.
  const untoldLore = turn < def.lore.length ? (def.lore[turn] ?? null) : null;
  if (untoldLore !== null) {
    lines.push(...untoldLore);
  } else {
    lines.push(rotateLine(def.ambient, turn - def.lore.length));
  }
  return lines;
}
