/**
 * The words of every named Over City resident — the individuals layered on
 * top of the role system in `townDialog.ts` rather than replacing it. Each
 * entry's `ambient` is everyday chatter in their own voice, `lore` is a
 * multi-page life story told one entry per talk, and `reactive` is a
 * quest-gated pool shown as the lead page when their corner of town has
 * something timelier to say. The lore is sourced from the Over City as it
 * appears in the books — Scolopendra's curse, the skyfowl and their
 * watchers, Featherfall's magistracy, Grimaldi's circus, and the Syndicate's
 * cameras — and from the game's own questlines, which the `reactive` hooks
 * read through the same `TownDialogContext` the street uses.
 */

import type { TownDialogContext } from '../../systems/townDialog';
import type { ResidentId } from '../../systems/townResidents';
import { isCircusResolvedStage } from '../../core/CircusQuestProgress';
import type { ResidentLines } from '../roles';

function circusResolved(ctx: TownDialogContext): boolean {
  return isCircusResolvedStage(ctx.circus);
}

function circusUnderway(ctx: TownDialogContext): boolean {
  return ctx.circus === 'heather_hunt' || ctx.circus === 'bigtop_ready';
}

function murderResolved(ctx: TownDialogContext): boolean {
  return ctx.murder === 'lich_slain' || ctx.murder === 'complete';
}

function murderOpen(ctx: TownDialogContext): boolean {
  return (
    ctx.murder === 'body_waiting' ||
    ctx.murder === 'investigation' ||
    ctx.murder === 'cult_hideout' ||
    ctx.murder === 'confrontation' ||
    ctx.murder === 'quill_slain'
  );
}

export const RESIDENT_LINES = {
  old_hilda: {
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
  brann_cartwright: {
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
  wendell: {
    ambient: [
      'A house is never finished, strictly speaking. There is always a hinge that may be improved, a board that may be better fitted, or a client who has changed his mind.',
      'I was once told that farming was a simple profession. I have since discovered that so is drowning, provided one does not object to the particulars.',
      "I spent several years building other people's houses. It is a curious thing, to know precisely how a room ought to be arranged and yet never be invited to choose one's own.",
      'I had thought that owning a pasture would make me a gentleman. At present it has chiefly made me a man who is forever repairing fences.',
      'There are few things more discouraging than a poorly built wall. There are, naturally, many things more discouraging than a well-built wall that belongs to someone else.',
      "I studied architecture for years. I have built considerably more houses than I have designed, which is perhaps the universe's rather indirect way of offering its opinion.",
      'The trouble with plans is that they are terribly reasonable before construction begins.',
      'A proper foundation will outlast nearly anything. This is why I have given mine rather more attention than my neighbors believe strictly necessary.',
      'I have discovered that cows possess very definite opinions about fences, and none of them coincide with mine.',
      'My ambition at present is to become a respectable farmer. I was an architect once, and I see no reason not to make another questionable decision.',
    ],
    lore: [
      [
        'I did, in fact, train as an architect. Quite seriously, too. I learned proportions, load calculations, drafting, all the respectable subjects.',
        'Unfortunately, there was remarkably little demand for an architect who was not already important enough to be worth hiring.',
        'So I went into construction. It was not what I had imagined for myself, but it proved rather pleasant in one respect: when a roof stood properly, no one could dispute that I had done something useful.',
        "I built houses, repaired walls, replaced floors, corrected other men's mistakes, and occasionally corrected mistakes they insisted were not mistakes at all.",
        'One becomes philosophical about these things when one has enough years and enough badly hung doors.',
      ],
      [
        'I have always wanted a bit of land of my own. Not an estate, you understand. I have no desire to spend my mornings managing six hundred acres and a man who lies about fences.',
        'A pasture, a respectable cottage, a few cows. Something modest that I might improve with my own hands.',
        'After years of constructing houses for other people, the idea of growing something instead of merely building it had its appeal.',
        'The cows did not agree with the timetable, unfortunately. Every one I had died.',
        'I miss them rather more than I care to admit. There is something humiliating about becoming attached to an animal whose principal contribution to the household is standing in the same field every day.',
        'There is also the matter of the milk. I had begun selling it to the inns and taverns here, and a farmer whose dairy produces nothing is a farmer chiefly in theory.',
      ],
    ],
    reactive: (ctx) => {
      if (murderOpen(ctx)) {
        return [
          "There has been enough disorder lately without people pretending it is ordinary. I have spent too many years repairing the consequences of other people's carelessness.",
          'A person leaves evidence, whether they intend to or not. Broken hinges, disturbed ground, a door opened the wrong way—everything leaves a mark.',
          'I should think the guards ought to pay rather more attention to such details. Then again, no one ever asks the carpenter until after the house has fallen down.',
        ];
      }
      if (circusUnderway(ctx)) {
        return [
          'The circus has attracted rather more excitement than I care for. I have nothing against entertainment, provided it remains where one expects to find it.',
          'My animals have been unsettled by all the noise. I am beginning to suspect they possess better judgment than some of our visitors.',
        ];
      }
      if (ctx.doomsday === 'complete') {
        return [
          'The tower has fallen, and yet my pasture remains standing. I confess this has restored some of my confidence in foundations.',
          'I inspected the fence twice afterward. Every post was still where I had put it. There are moments when a builder is permitted a little satisfaction.',
        ];
      }

      return null;
    },
  },
  marta_miller: {
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
  apothecary_fen: {
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
  deacon_aviel: {
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
      if (
        !murderResolved(ctx) &&
        (ctx.murder === 'cult_hideout' || ctx.murder === 'confrontation' || ctx.quillNamed)
      ) {
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
  smith_varga: {
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
  innkeep_ossie: {
    ambient: [
      'Beds upstairs, stew downstairs, and nothing hostile past that door. The floor decided that, not me.',
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
        'You will have noticed nothing has tried to come through that door since you sat down. That is not the door. That is the floor deciding.',
        'The System put its mark on my taproom and the mark holds. Nothing hostile crosses it. Not the changed, not the krasue, not whatever you carried up the stair on your boot.',
        'I was not asked and I was not warned. One morning this was a public house and by the evening it was the safe room, and the garrison up the road was just a garrison with cold men in it.',
        'So sleep. Actually sleep. It is the only promise anybody on this floor has kept, and I have watched crawlers refuse to believe it and go and sit out in the rain instead.',
      ],
    ],
    reactive: (ctx) => {
      if (murderOpen(ctx)) {
        return [
          'I am not letting rooms after dark this week. Not to anyone. Say what you like about the coin.',
        ];
      }
      // Doomsday first. Its stage is armed on the same frame the murders close,
      // so ranked below them its line could never be reached.
      if (ctx.doomsday === 'complete') {
        return ['The Sleeping Cat is still standing. So is everything else. Stew is free today.'];
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
      return null;
    },
  },
  innkeep_brend: {
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
      // Resolved first. `quillNamed` latches when the letter naming the
      // schoolteacher is read on the street, and only a checkpoint rewind clears it, so testing it above the
      // resolved branch left him urging the party to go after a woman whose body
      // is upstairs — and made the line below it unreachable for the rest of the
      // game.
      if (murderResolved(ctx)) {
        return [
          'The clerks are back and the seating chart is nearly right again. That is my measure of a town at peace.',
        ];
      }
      if (ctx.murder === 'quill_slain') {
        return [
          'Word is she is dead. Word is it did not stop. I have kept a room empty for a magistrate who has not come down those stairs in a long while.',
        ];
      }
      if (ctx.quillNamed || ctx.murder === 'confrontation') {
        return [
          'Quill. She sat at the guild corner twice and drank nothing both times. I remember it because nobody does that.',
          'If you are going after her, do it while the clerks are still frightened of her. Afterwards they will all have been suspicious of her from the start.',
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
  innkeep_marlow: {
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
      if (ctx.doomsday === 'complete') {
        return ['Whole city nearly went and the Stump did not lose a single glass. Cursed place.'];
      }
      if (murderResolved(ctx)) {
        return [
          'You went and did it. For my lot, who nobody was counting. Your money is no good in the Stump, and I say that to nobody.',
        ];
      }
      return null;
    },
  },
  sgt_kessler: {
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
      if (murderResolved(ctx)) {
        return [
          'They have finally sent me a second pair of boots for this post. That is what a win looks like at my rank.',
          'What we found in the cellar went to the temple, not the magistracy. Deacon Aviel insisted. So did I.',
        ];
      }
      if (ctx.quillNamed) {
        return [
          'A name at last, and it came out of my cellar. Six years of reports marked resolved by an office that never sent anyone — and now I know which office.',
        ];
      }
      if (murderOpen(ctx)) {
        return ['Doubled the alley watch. It is still two of us. I have doubled the walking.'];
      }
      return null;
    },
  },
  corporal_pell: {
    ambient: [
      'Sand is raked and the pells are stood up. Hit something or get off my floor.',
      'You swing like a man opening a door. Put your hip into it and swing again.',
      'The quartermaster is behind his counter. He will not be hurried and he will not be haggled.',
      'Spears racked at the wall, always. A man fumbling for his weapon is already dead.',
      'I have been down. I am not going back down. I can still make you better at it.',
    ],
    lore: [
      [
        'I ran the second floor. Whole thing, gate to gate, with eleven others.',
        'Four came up. Then two of those went back for reasons I have stopped asking about.',
        'The garrison took me on because I could describe a stairwell accurately. That is the whole of my qualification.',
        'Now I stand on sand and shout at people who are going to die anyway. It is not nothing. Four came up.',
      ],
      [
        'Do not sleep here. I have had three crawlers try it and I have thrown out three crawlers.',
        'This is a barracks. Thick walls, men with spears, a bolt on the door. Every bit of that is an opinion, and an opinion can be argued with by something big enough.',
        'You want a room that cannot be argued with, it is the Sleeping Cat Inn, down the way. Ask for Ossie. Nothing hostile crosses that threshold and the floor itself says so.',
        'Sleep there. Train here. I am not confusing the two and neither are you.',
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
  quartermaster_dann: {
    ambient: [
      'Everything behind this counter is signed for. Everything in front of it is yours to bleed in.',
      'I do not sell edge. Edge is the smith, up the hill. I sell what stands between you and the floor.',
      'Padded, boiled, riveted. That is the order of the price and it is also the order of the use.',
      'A crawler who argues the cost of a helm has generally still got a head to argue with.',
      'Try it on here. A strap you cannot find in the dark is a strap you do not own.',
    ],
    lore: [
      [
        'Every piece on that rack was worn by somebody who came up the stair and did not go back down it.',
        'I do not scrub the inside. Scrubbing takes the shape out, and the shape is half of what you are paying me for.',
        'A gambeson that has already been hit sits better than one that has not. Any of them out on the sand will tell you the same.',
        'That is not superstition, it is compression. I have the dates written in the book and the book does not flatter anybody.',
      ],
      [
        'Sixteen sacks a week from the mill at a rate set in the ninth year, and eleven reviews deferred. That is the garrison, on paper.',
        'On paper we are also forty spears. We are nineteen. Eight of those are boys who have not been past the wall.',
        'So when the magistracy asks me why the issue kit is not new, I write the number down and I send it back up.',
        'They will not read it. I write it anyway. Somebody after me is going to want the count.',
      ],
    ],
    reactive: null,
  },
  stock_clerk_wick: {
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
      if (ctx.doomsday === 'complete') {
        return [
          'Sold out of everything in an hour that night and gave most of it away. The shopkeep has decided to be proud of me about it.',
        ];
      }
      if (murderResolved(ctx)) {
        return ['Nobody has bought a candle in bulk since. I check. I will always check now.'];
      }
      return null;
    },
  },
  tattooist_nim: {
    ambient: [
      'Sit. Do not watch the needle, watch the wall. Everyone thinks they are the exception.',
      'One mark per crawler. I have explained why. I will not explain again today.',
      'No, I cannot do a portrait. The ink gets ideas about faces.',
      'It will itch for a day and then it will start paying attention.',
      'The chair is comfortable. That is deliberate and it is the only kindness in here.',
    ],
    lore: [
      [
        'The board outside used to carry a name. It is a needle now. That was my doing and I will not be drawn on it.',
        'Tsarina Signet wears her work. All of it, all at once, and it moves when she is thinking.',
        'She came through once, looked at my line, and corrected it with her thumbnail. Did not say a word.',
        'The line has been better ever since. I am not sure it is still mine, and I am not sure I want her name over my door.',
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
} as const satisfies Record<ResidentId, ResidentLines>;

/**
 * `RESIDENT_LINES[id]`, widened to {@link ResidentLines} — callers read
 * `ambient`/`lore`/`reactive` through the role interface rather than through
 * one resident's own literal type, the same way any other id-keyed lookup in
 * `src/dialog/` does.
 */
export function residentLinesFor(id: ResidentId): ResidentLines {
  return RESIDENT_LINES[id];
}
