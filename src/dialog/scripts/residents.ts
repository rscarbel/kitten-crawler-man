/**
 * The words of every named Taloncrest resident — the individuals layered on top of
 * the role system in `townDialog.ts` rather than replacing it. Each entry's
 * `ambient` is everyday chatter in their own voice, `lore` is a multi-page life
 * story told one entry per talk, and `reactive` is a quest-gated pool shown as the
 * lead page when their corner of town has something timelier to say. Between
 * them they tell the Fraying, the Hawkfolk and the Carrying, the old circus and
 * Caroline's floating eyes, each from where that resident stands (the canon is
 * the "History and belief" section of `docs/town.md`). A `reactive` hook reads
 * the game's own questlines through the same `TownDialogContext` the street
 * uses.
 */

import type { ResidentId } from '../../core/state/residentIds';
import type { ResidentLines } from '../roles';
import type { NonEmpty } from '../line';
import type { MissingCatsDialogView, TownDialogContext } from '../../systems/townDialog';
import {
  lodgeCellarHeld,
  missingTownCats,
  phaseReached,
} from '../../core/quests/missingCatsProgress';
import type { TownCatId } from '../../core/state/townCatIds';

/** What an owner says while their own cat is gone, and once she has walked home. */
interface OwnCatLines {
  readonly missing: NonEmpty<string>;
  readonly home: NonEmpty<string>;
}

/**
 * An owner's reaction to their own cat: her absence while she is gone, her
 * return once every cat has walked home, and nothing while she is simply at
 * home. Whether she is gone is the questline's to say, so the stakeout's cat
 * is missed only from the night she is taken.
 */
function ownCatLines(
  cat: TownCatId,
  view: MissingCatsDialogView,
  lines: OwnCatLines,
): NonEmpty<string> | null {
  if (missingTownCats(view).includes(cat)) return lines.missing;
  if (phaseReached(view, 'aftermath')) return lines.home;
  return null;
}

/** An owner whose only reaction is to their own cat. */
function ownCatReaction(
  cat: TownCatId,
  lines: OwnCatLines,
): (ctx: TownDialogContext) => NonEmpty<string> | null {
  return (ctx) => ownCatLines(cat, ctx.missingCats, lines);
}

export const RESIDENT_LINES = {
  old_lori: {
    ambient: [
      'Mind the jars by the door, dearie. Two of them are still alive.',
      'Sit if you like. The stool only bites people who lie to me.',
      'You smell of the ruins. Wash it off before it decides to stay.',
      'I have no roof-tax and no god of my own, though I do send Deacon Aviel a jar for the poor box now and then. Suits me and it suits the neighbours..',
      'Everyone wants a charm. Nobody wants to hear what it costs, and I do mean the coin, dearie, not anything spookier.',
      'Voss will read your cards for a fee and dress it up with candles. I will just tell you plain, same as I always have..',
    ],
    lore: [
      [
        'You want to know why the walls are so thick. Everybody does, eventually.',
        'This was a city once, ten times the size, running right out to where the ruins are now.',
        'Then one night the ground came apart under it, street after street, like a seam letting go. The temple calls it the Fraying. I just call it the bad year.',
        'The ones caught inside did not die. That is the part nobody says out loud. They came back wrong, and they wandered off, and some of them are still out there wearing the faces of my neighbours.',
      ],
      [
        'The things in the ruins — you have killed some, I imagine. Did you look at their hands?',
        'They keep the hands. Whatever else goes, the hands stay near enough human to be a problem.',
        'Baker on Low Street had a birthmark like a spilled cup. I saw it again on something with four legs, three winters back.',
        'So no, I do not weep for them. But I do not pretend I am killing monsters, either. Neither should you.',
      ],
      [
        'The tower does not sit on stone. It sits on a crystal, and the crystal is full of people.',
        'Souls, the deacon would say. The Warden’s proclamations call it "civic reserve" and say nothing more.',
        'Whatever it is, it hums. I have felt it in my teeth every night for forty years.',
        'If it ever stops humming, dearie, do not go and look. Run.',
      ],
    ],
    reactive: (ctx) => {
      const view = ctx.missingCats;
      if (view.clues.has('cottage_latch') && !phaseReached(view, 'stakeout')) {
        return [
          'The whole street thinks an elf crept through my garden and took Thimble. This town would blame elves for the weather, dearie.',
        ];
      }
      return ownCatLines('taloncrest_old_lady_cottage_cat', view, {
        missing: [
          'Thimble’s cushion is still by the stove. I plump it every morning like a fool.',
          'I keep the back window shut now. Bit late for that, I know.',
        ],
        home: [
          'Thimble came in by the window she went out of and sat in my good chair. I have not had the heart to move her.',
        ],
      });
    },
  },
  steve_cartwright: {
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
        'I built eleven of those for the circus, back when it still toured the villages instead of standing empty past the wall.',
        'He paid on the day, every time, and he asked after my knees. You do not forget the ones who ask after your knees.',
        'I have not been able to bring myself to burn it. Stupid, for a man who sells firewood.',
      ],
      [
        'I had an apprentice. Teodo. Good hands, no patience — the usual.',
        'He went out past the west gate on a dare. Boys do. Most of them come back with a story and a scraped elbow.',
        'The guards found his belt. Just the belt, hung neat on a fencepost, which is the part that keeps me up. Worst year I have had, and I have had a few.',
        'So when I tell you the ruins are not a place to prove anything — I am not being careful. I am being specific.',
      ],
      [
        'You have noticed them, surely. The floating eyes, out over the plaza.',
        'Caroline’s. They follow the interesting people. That is you, crawler, before you ask.',
        'Whatever she wants with what they see, she has never once told the rest of us.',
        'I keep the shutters closed and I make wheels. Let her watch a man make wheels. Serves her right.',
      ],
    ],
    reactive: null,
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
    reactive: null,
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
        'Sixteen sacks a week to Quartermaster Dann, at a price the tower set in a year when there were roads.',
        'I do not argue. A walled town that goes hungry stops being a walled town very fast — it just becomes a wall.',
        'But do not let anyone tell you the garrison is what keeps us. It is grain. It is always grain.',
      ],
      [
        'My boy Corvin. Fifteen, and about as sensible as a barn cat.',
        'He watches the crawlers come up out of the stairwell and he thinks that is a life. Levels. Loot. A story people tell about him.',
        'I have told him what you all look like on the way back down. He hears it as a challenge, of course.',
        'So do me a kindness. If he asks you what it is like — do not make it sound good.',
      ],
      [
        'The south field used to run right out to where the ruins start.',
        'You can still see the furrows from the loft, under the rubble. Straight as a ruled line, forty rows of them.',
        'My great-grandmother sowed those. Now I farm a square of dirt inside a wall and call it the South Green.',
        'When the ground frayed it took the neighbours first and the acreage after, and nobody writes songs about acreage.',
      ],
    ],
    reactive: (ctx) => {
      const view = ctx.missingCats;
      if (view.clues.has('mill_hayloft_feather') && !phaseReached(view, 'confession')) {
        return [
          'Corvin wanted that feather for his wall. I told him half the town moults on my roof. It is only a feather.',
        ];
      }
      return ownCatLines('taloncrest_mill_farm_cat', view, {
        missing: [
          'Chaff kept the mill clear of mice for six years. Without her I hear every one of them all night.',
          'Corvin leaves the mill door open for Chaff. I have stopped telling him not to.',
        ],
        home: [
          'Chaff was asleep in the hopper this morning, white with flour, like she had never been anywhere.',
        ],
      });
    },
  },
  apothecary_fen: {
    ambient: [
      'Everything on that shelf will help you. Some of it twice, in opposite directions.',
      'Coin on the counter, ailment out loud. I have heard worse than yours.',
      'No, I will not tell you what is in it. You would only worry.',
      'A potion is a promise with a shelf life. Read the date.',
      'I sell cures. Prevention is free and nobody takes it.',
      'Kestrel prices her tonics to spite me and I price mine to spite her back. The customers get the better end of it.',
    ],
    lore: [
      [
        'I trained in the tower roosts. Under the Hawkfolk, not beside them — they are very clear on the distinction.',
        'Nine years grinding for a healer who never once told me his name. Just "the work", and a claw pointing at the next thing.',
        'They mend better than we do. Faster, cleaner, and they will not say why.',
        'What I did learn, I learned by watching. That is most of medicine anyway.',
      ],
      [
        'You want my theory on the ruins? Everyone else has one, so here is mine.',
        'The seam under the old city never closed. Whatever came apart out there is still a little apart, and on a stormy night the edge of the ruins shifts.',
        'That is when the changed things drift toward the low streets. They come in with the weather, and nothing on my shelves has ever turned one back.',
        'I sell remedies for what happens to a body. None of them was ever meant for what happened to a street.',
      ],
      [
        'Bring me anything you find out there in a stoppered jar and I will look at it. I mean that.',
        'Half my stock started as something horrible in a bottle that somebody braver than me carried home.',
        'The blue-veined moss under the ruin shells — that is two of the three things in your health potion.',
        'The third thing is honey, and it is honey because otherwise you would never drink it twice.',
      ],
    ],
    reactive: null,
  },
  deacon_aviel: {
    ambient: [
      'The dome is new. The faith beneath it is not — mind thou dost not confuse the two.',
      'Kneel or stand as thou wilt. It is a roof regardless.',
      'We ask for what thou canst spare, not what thou dost owe. The difference is mostly dignity.',
      'Thou mayest look up in here. Most forget that they are permitted to.',
      'I have buried more of this parish than I have blessed this year. I am working to improve the count.',
      'Madame Voss charges for her comfort and I give mine away. We are, I am told, in the same trade.',
    ],
    lore: [
      [
        'I did not choose the dome. The dome chose rather poorly, some seasons, and here we still are.',
        'My mother roosted two streets from here and never once came inside. She thought the ceiling too low for a sermon.',
        'She was likely right. I have raised it twice in memory and it is, by my own estimation, still too low.',
        'Thirty years under it now. One grows used to a ceiling, the way one grows used to anything that will not move.',
      ],
      [
        'Thou wilt hear it said in the square that a wing is owed. When the Fraying came, my people flew this city over the seam to the hill, and every one of us who can fly owes carries still to those who cannot.',
        'Nest-debt, the street calls it. One who refuses a carry is clipped, and the roost does not speak that name again.',
        'I preach it every seventh day and I believe it. Some nights I wonder at a faith whose first word is a debt. Debt keeps a people honest; it seldom keeps them kind.',
      ],
    ],
    reactive: (ctx) => {
      const view = ctx.missingCats;
      if (phaseReached(view, 'aftermath')) {
        switch (view.avielChoice) {
          case 'exposed':
            return [
              'The bells on the tower have stopped. I heard it from the well, on foot, the way I hear everything now.',
              'I read the names on the seventh day still. The cats are off the list. The rest of it I will carry walking.',
            ];
          case 'kept':
            return [
              'The bells stopped, and the cats came down the hill in the morning. I watched from the dome and counted them.',
              'The carry I owed thee is paid. I would rather have paid it than have what the Warden promised me.',
            ];
          case null:
            break;
          default: {
            const unhandled: never = view.avielChoice;
            throw new Error(`unhandled Aviel choice ${String(unhandled)}`);
          }
        }
      }
      switch (view.avielChoice) {
        case 'exposed':
          return [
            'The High Roost took my flight feathers on the dome, before the whole parish. I walk to the well now, like those I used to carry.',
            'I am kept on to sweep the nave until the Roost sends another.',
          ];
        case 'kept':
          return phaseReached(view, 'captured')
            ? [
                'Thou didst keep what I did from the High Roost, and I paid thee the carry I owed. The tower was waiting at the end of it.',
                'I have never paid a debt I liked less.',
              ]
            : [
                'Thou didst keep what I did from the High Roost. The carry I owe thee, I pay at the fountain at dusk.',
              ];
        case null:
          break;
        default: {
          const unhandled: never = view.avielChoice;
          throw new Error(`unhandled Aviel choice ${String(unhandled)}`);
        }
      }
      if (phaseReached(view, 'posters_up') && !phaseReached(view, 'chase')) {
        return [
          'I have added the missing cats to the names we read on the seventh day. The parish thinks it foolish. I do not.',
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
      'Every handle I cut is wide enough for a talon grip as well as a fist. Groundfolk hands manage on the same shape.',
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
        'Three smiths wore that dish into the face before me, and the first of them worked outside the wall, in a street that is rubble now.',
        'They carried it in on a sledge during the bad year. Left the house, left the tools, brought the anvil.',
        'When you next wonder what this town is — it is the people who chose the anvil.',
      ],
      [
        'Corporal Pell sends me his garrison steel back bent and I send it out straight and neither of us discusses where it got bent.',
        'But I read it. Every dent is a direction. A notch high on the left edge means something tall and quick came down at them.',
        'I have been reading a lot of high notches this season. That is a thing worth knowing before you go past the gate.',
        'I do not go past the gate myself and I do not guess at what put the notch there. I hammer it flat and hand it back.',
      ],
    ],
    reactive: ownCatReaction('taloncrest_smithy_cat', {
      missing: [
        'Cinder slept on the warm side of the forge wall. I still bank it of a night for her, out of habit.',
      ],
      home: [
        'Cinder is back on the forge wall. Singed her whiskers the first night, same as every winter.',
      ],
    }),
  },
  innkeep_ossie: {
    ambient: [
      'Beds are upstairs and the stew is down here, and nobody has died crossing between them yet.',
      'Sit and eat something. You look like you slept in a hedge, and I mean that kindly.',
      'The Stump is the loud house. We are the quiet one. Ask around if you do not believe me.',
      'Everything on the board heals something. Even the bread. Especially the bread.',
      'Pay in coin if you have it. Pay in a good story and I will knock a little off.',
      'Corporal Pell sends me half his recruits before they have signed anything. Says a bed here is cheaper than a coffin.',
      "Wendell's farm used to keep this kitchen in milk. Now I buy it in from further out and it is never quite as good.",
      'I could roost in the rafters if I wanted the quiet. I sleep behind the bar instead, closer to the till.',
    ],
    lore: [
      [
        'You keep looking at the sign. Everybody does, eventually.',
        'A cat walked in off the ruins road nine years back, sat right there on that stool, and would not be moved.',
        'I will say this plainly and you can believe it or not as you please: that cat talked. Argued me out of a very good ham, then left before dawn.',
        'Painted the sign the next morning. Seemed rude not to.',
      ],
      [
        'Folk talk while the stew cools. I gave up trying to stop them years ago.',
        'One woman swore the second floor holds a shopping arcade, fountain and all.',
        'A fellow the week before had a floor that is one room, and the room is a mouth. I wrote that one down twice.',
        'Half of it is the ale talking. I have yet to catch one turning out to be fully invented, though.',
      ],
      [
        'Nothing unfriendly has come through that door since you sat down, and it is not because I am handy with a ladle.',
        'The floor put its mark on this taproom the same as it marks anything it decides matters. I was not asked and nobody explained it — one evening this was a public house, the next it was the safe room.',
        'I still check the latch every night regardless. A habit can outlast the reason for it and I keep this one anyway.',
        'Ask the other guest if you want proof. Dave took a room and never once checked out, and he will vouch for how quiet it stays.',
      ],
    ],
    reactive: (ctx) => {
      const view = ctx.missingCats;
      if (!phaseReached(view, 'posters_up')) return null;
      return ownCatLines('taloncrest_inn_cat', view, {
        missing: [
          'Biscuit’s bowl is still by the hearth. I fill it at night and in the morning it is still full.',
          'The regulars keep asking after Biscuit. I have run out of things to tell them.',
        ],
        home: [
          'Biscuit walked in the front door at breakfast and sat on the stool under the sign, as if she had been there the whole time.',
        ],
      });
    },
  },
  innkeep_brend: {
    ambient: [
      'The Flagon keeps a table. Mind which one you take.',
      'We do not water the mead and we do not extend credit. Both are policy.',
      'That is the guild corner. They will not thank you for sitting in it.',
      'Boots off the bench, please. It is older than your family line.',
      'I hear a great deal in here and repeat about a third of it.',
      'Ossie runs the quiet house down the way. I run the respectable one. We do not compete, we specialise.',
      'Groundfolk drink slower and tip better than my own kind ever do. I have never worked out why.',
    ],
    lore: [
      [
        'This is the respectable house, which mostly means the arguments are quieter and the debts are larger.',
        'Guild factors, the tower clerks, two of the wool families. They all sit where they always sit.',
        'The seating chart in my head has not changed in twenty years. When it changes, something has happened in this town.',
        'It changed last month. I will leave it there for now.',
      ],
      [
        'There is a crawler guild recruiting through here. Brynhild’s Daughters — Hekla’s lot.',
        'They are not subtle. Hekla came in, looked at the room, and named a figure at a stranger inside a minute.',
        'She has her eye on the ones with a reputation. Anybody the town already talks about.',
        'Which is to say: if a very tall woman buys you a mead, she is not buying you a mead.',
      ],
      [
        'The clerks stopped coming. All of them, the same week.',
        'The tower’s people drank here every seventh night for as long as I have had the lease. Then nothing.',
        'One did come back, alone, and paid for a room he did not sleep in, and left before light.',
        'I do not gossip about the tower. I am simply telling you about my custom, which is my own business to discuss.',
      ],
    ],
    reactive: ownCatReaction('taloncrest_flagon_tavern_cat', {
      missing: [
        'Barrel slept on the guild bench for nine years. The factors sit round the empty end now as if it were still taken.',
      ],
      home: [
        'Barrel is back on the guild bench. The factors are pretending not to be pleased about it.',
      ],
    }),
  },
  innkeep_marlow: {
    ambient: [
      'Ale’s cheap, the floor is level in one corner, and that is the whole pitch.',
      'You break it, you bought it. You bleed on it, that is free.',
      'Nobody in here is anybody. That is why they come.',
      'I have thrown out better than you and worse than you in the same hour.',
      'Do not go out the back way unless you know the back way.',
      "Sgt. Kessler's post is two streets over and he has never once walked my alley. I have decided not to wonder why.",
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
        'The Cloak & Dagger lets anybody in and asks nothing, which makes it the safest room in the city and the worst one to be seen in.',
        'Deals get struck there and settled out here in the dark. That is the arrangement and it has held for years.',
        'It has stopped holding. Somebody has started settling things that were never struck.',
      ],
    ],
    reactive: null,
  },
  sgt_kessler: {
    ambient: [
      'Lodge is garrison ground. Be useful or be brief.',
      'Two of us, one alley, no relief. You do the arithmetic.',
      'I do not want your name. I want to know which way you came in.',
      'I took my report up to the High Roost and they called it settled. Not one of them has flown down this alley since to see whether it is.',
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
        'No soldier reaches for that phrase on his own. Somebody hands it to him and he learns to say it back.',
        'I stopped filing requests and started keeping a log instead. The log is not on the wall.',
      ],
      [
        'There were candles down there. Set out properly, in a ring, and burnt to stubs on a floor nobody is supposed to reach.',
        'Whoever met in that cellar met often and met quietly and did not leave in a hurry.',
        'I reported it up the chain twice. Both times the report came back marked resolved by an office that never sent anyone.',
        'So now I tell people like you instead. Do with it what the tower will not.',
      ],
    ],
    reactive: (ctx) => {
      const view = ctx.missingCats;
      if (lodgeCellarHeld(view)) {
        return [
          'I had the elves in my log as thieves. I struck the line out myself, with the one who came up the ladder watching me do it.',
          'Every wave they sent up that cistern, the lid held. I have written down whose hands were on it.',
        ];
      }
      if (phaseReached(view, 'blame')) {
        return [
          'Half the row has been to my door asking when I mean to open that lid. They want the elves brought up.',
        ];
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
      "Half the new recruits come off roost duty and cannot hold a stance. Flying does not teach a man's feet anything.",
    ],
    lore: [
      [
        'I ran the second floor. Whole thing, gate to gate, with eleven others.',
        'Four came up. Then two of those went back for reasons I have stopped asking about.',
        'The garrison took me on because I could describe a stairwell accurately, in order, without shaking. That got me this rank.',
        'Now I stand on sand and shout at people who are going to die anyway. It is not nothing. Four came up.',
      ],
      [
        'Do not sleep here. I have had three crawlers try it and I have thrown out three crawlers.',
        'This is a barracks. Thick walls, men with spears, a bolt on the door. Every bit of that is an opinion, and an opinion can be argued with by something big enough.',
        'You want a room that cannot be argued with, it is the Sleeping Cat Inn, down the way. Ask for Ossie. Whatever ward the floor put on that taproom, it has held for longer than my watch rotation has.',
        'Sleep there. Train here. I am not confusing the two and neither are you.',
      ],
      [
        'Do not settle in, crawler. Everyone settles in, because the town has a market and a pub and it feels like a place.',
        'It is a stop on the way down. The stairs are still there, whether or not you feel ready for them.',
        'Caroline moves crawlers along when she sees fit, and nobody down here has ever worked out her schedule.',
        'Do the thing you are putting off. Whatever it is. Do it this week.',
      ],
    ],
    reactive: null,
  },
  quartermaster_dann: {
    ambient: [
      'Everything behind this counter is signed for. Everything in front of it is yours to bleed in.',
      'I do not sell edge. Edge is the smith, up the hill. I sell what stands between you and the floor.',
      'Padded, boiled, riveted. That is the order of the price and it is also the order of the use.',
      'A crawler who argues the cost of a helm has generally still got a head to argue with.',
      'Try it on here. A strap you cannot find in the dark is a strap you do not own.',
      'I owe no nest-debt to anyone on this counter. Coin only, and the count comes out even every night.',
    ],
    lore: [
      [
        'Every piece on that rack was worn by somebody who came up the stair and did not go back down it.',
        'I do not scrub the inside. Scrubbing takes the shape out, and the shape is half of what you are paying me for.',
        'A gambeson that has already been hit sits better than one that has not. Any of them out on the sand will tell you the same.',
        'Call it compression, not superstition. I have the dates written in the book and the book does not flatter anybody.',
      ],
      [
        'Sixteen sacks a week from the mill at a rate set in the ninth year, and eleven reviews deferred. That is the garrison, on paper.',
        'On paper we are also forty spears. We are nineteen. Eight of those are boys who have not been past the wall.',
        'So when the tower asks me why the issue kit is not new, I write the number down and I send it back up the stair.',
        'They will not read it. I write it anyway. Somebody after me is going to want the count.',
      ],
    ],
    reactive: null,
  },
  stock_clerk_wick: {
    ambient: [
      'Kestrel is at the counter. I am the one who knows where anything is.',
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
        'Caroline’s floating eyes come in here too. Three of them, usually over the potion shelf.',
        'They are not interested in the shop. They are interested in who is buying in a hurry.',
        'I worked out early that if the eyes crowd somebody at my counter, that person is having a day.',
        'So I give those ones an extra potion and put it down as breakage. Do not tell the shopkeep.',
      ],
      [
        'Somebody bought every lamp in the shop in one go. Six weeks back. Paid in old coin.',
        'Not a crawler. Town clothes, town accent, would not give a name for the book.',
        'Lamps, oil, and forty candles. Forty. For a house nobody in this town has ever been invited to.',
        'I wrote it in the ledger under "unknown". The ledger does not like unknowns, and neither do I.',
      ],
    ],
    reactive: (ctx) => {
      const view = ctx.missingCats;
      if (view.clues.has('store_tuna_ledger') && !phaseReached(view, 'aftermath')) {
        return [
          'I went back through the tower’s tuna order. Every week for as long as I have kept the book. Nobody up there has ever asked for a saucer.',
        ];
      }
      return null;
    },
  },
  keeper_brenna_kestrel: {
    ambient: [
      'Coin first, story after. I have heard every story and they all end at the price.',
      'Ask Wick where a thing sits on the shelf. Ask me what it costs and why.',
      'Every jar in here gets counted twice a week — once by me, once by the till, and they had better agree.',
      'You lot never look up. I could hang the sale sign from the eaves and you would still ask me where it is.',
      'Ask the herbalist about her tinctures if you like. Ask me about mine and I will tell you which keeps longer.',
      'A shop with an empty shelf is a shop somebody has stopped trusting. Mine are never empty for long.',
    ],
    lore: [
      [
        'This shop was my mother’s before it was mine. She ran it with a ledger in one hand and a temper in the other.',
        'I flew supply runs before that. Three years hauling crates between roosts that never once thanked me for landing on time.',
        'When she died I grounded myself and took the counter instead. Turns out a till adds the same whether you are standing at it or flying to it.',
        'I have not regretted the trade. I regret the breakage column some months. Not the shop.',
      ],
      [
        'The apothecary sells half of what I sell, at a price she sets to spite me, I am fairly sure.',
        'A tincture is a tincture whether it comes off her counter or my shelf. Mine keeps longer. I have tested this, and I do not say so out loud because it sounds petty. It is petty.',
        'Wick thinks I should simply match her price. Wick has never had to explain a loss to the trader who fronts my stock.',
        'I will not be undercut in my own store. Call it arithmetic — I gave up pretending it was pride years ago.',
      ],
      [
        'My clerk writes off more stock as breakage than a store this size ought to manage.',
        'I have counted his numbers against the shelf twice now. Short both times, and nothing broken that I can find.',
        'He is not stealing. I would know — I have caught two who were, in nine years, and neither did it that quietly.',
        'Whatever it is, it had better stop before the ledger notices what I already have.',
      ],
    ],
    reactive: (ctx) => {
      const view = ctx.missingCats;
      if (view.phase === 'stakeout') {
        return ['If you mean to watch my shop all evening, buy something first.'];
      }
      if (phaseReached(view, 'posters_up') && !phaseReached(view, 'stakeout')) {
        return [
          'Penny is the last cat this side of the wall. I lock her in the stockroom at night and every morning she is on the roof.',
        ];
      }
      return ownCatLines('taloncrest_general_store_cat', view, {
        missing: [
          'The stockroom was bolted. Penny was on the roof, and then she was not on anything at all.',
        ],
        home: ['Penny was asleep in the till drawer this morning, curled up on the day’s takings.'],
      });
    },
  },
  tattooist_nim: {
    ambient: [
      'Sit. Do not watch the needle, watch the wall. Everyone thinks they are the exception.',
      'One mark per crawler. I have explained why. I will not explain again today.',
      'No, I cannot do a portrait. The ink gets ideas about faces.',
      'It will itch for a day and then it will start paying attention.',
      'The chair is comfortable. That is deliberate and it is the only kindness in here.',
      'No ink anywhere near the flight feathers. Ask the wrong artist for that and you fly crooked for a year.',
    ],
    lore: [
      [
        'The board outside used to carry a name. It is a needle now. That was my doing and I will not be drawn on it.',
        'A dancer from the club wears my work. All of it, all at once, and it moves when she is thinking.',
        'She came through once, looked at my line, and corrected it with her thumbnail. Did not say a word.',
        'The line has been better ever since. I am not sure it is still mine, and I am not sure I want her hand over my door.',
      ],
      [
        'Living ink is not decoration. It is a small agreement with something that wants a place to sit.',
        'That is why one mark per crawler. Two marks argue. I have seen two marks argue and I would like to stop seeing it.',
        'They argue about you, by the way. That is the part people are never ready for.',
        'Choose the one you want to be nagged by for the rest of your run.',
      ],
      [
        'Caroline watches this shop. Closely. There are three of her floating eyes in here right now.',
        'A crawler getting inked is worth recording, I suppose — pain, a decision, and a shape she can recognise later.',
        'They hovered over my chair for a whole season. My chair. I have never been told why and I have never been asked.',
        'So I have started doing very slow, very boring linework whenever the eyes get close. Bore them enough and they drift off to watch someone else.',
      ],
    ],
    reactive: null,
  },
  janitor_puddles: {
    ambient: [
      'Mind the wet patch. Mind the other wet patch. It is a pub, it is all wet patch.',
      'Somebody always spills the first drink of the night. I have a bet with myself on who.',
      'Marlow says the floor was blue once. I have been mopping eight years and I have never seen blue.',
      'Stump floods when it rains. Stump floods when it does not rain. I have stopped asking.',
      'Do not apologise for the mud, love. Just walk in a straight line so I know where it went.',
    ],
    lore: [
      [
        'People call me Puddles because of the job. My mam called me Puddles first, and that was not because of any job.',
        'I took this mop off the last fellow when his knees went. Handle is older than the bar.',
        'Wring it twice, mop with the grain, never mop toward the door. That is the whole trade and it took me two years.',
      ],
    ],
    reactive: null,
  },
  janitor_grout: {
    ambient: [
      'Flagstones. Thirty-one rows. I know which ones rock.',
      'Brend wants the guild corner done first, before the factors sit. Factors do not look at floors, but Brend does.',
      'If you are going to bleed, bleed on the stone, not the rug. Stone forgives.',
      'Good mop is like a good dog. Comes back wet and does not complain.',
      'Quiet night is a dry floor. I have not had a quiet night in a while.',
    ],
    lore: [
      [
        'Grout is a nickname. Got it from the mason who laid this floor, because I kept asking him about the gaps.',
        'He said the gaps are what hold the stones apart, so they never crack into each other. I liked that.',
        'Thirty years later the stones are still in one piece and so is the mason. Neither of them needs me, but I scrub the gaps anyway.',
      ],
    ],
    reactive: null,
  },
  sydney: {
    ambient: [
      'Fighters for hire. The desk is right here.',
      'Everyone on the board is rested and ready.',
      'I keep the files tidy, so I can find the right fighter fast.',
      'Come back in one piece. That is all I ask.',
      'Busy day. Good.',
    ],
    lore: [
      [
        'I used to count blankets for the garrison. Now I count fighters. Fighters talk back more.',
        'Every one of them is good at something. My job is matching them to you.',
        'Bring them home, and I am always happy to send them out again.',
      ],
    ],
    reactive: null,
  },
  brandon: {
    ambient: [
      'Evening. Good to see you again.',
      'Enjoy yourselves.',
      'Busy night. Busy is good.',
      'Mind your purse near the wheel.',
      'Stay as long as you like.',
    ],
    lore: [['Evening. Welcome to the Cloak & Dagger. Enjoy yourselves.']],
    reactive: null,
  },
  taloncrest_apothecary_assistant: {
    ambient: [
      'Fen does the remedies. I do the lifting, the bunching and the sweeping. The remedies would not get far without me.',
      'Fen hung the drying rack at her own height. I have walked into it every morning for four years.',
      'Folk look at the tusks first and the apron second. In here the apron is the one that matters.',
      'I sweep the ruin dust out twice a day. The moss in the back does not like it, and neither do I.',
    ],
    lore: [
      [
        'Four years in this room. Fen took me on because I could lift the still on my own.',
        'She kept me on because I can tell marsh root from bitterwort by the smell. She cannot, though she will not say so.',
        'I do the drying room, she does the counter. Customers think the shop is her, and that suits us both.',
      ],
      [
        'The cat is Sage. She came with the shop, or the shop came with her, depending on who you ask.',
        'She sleeps on the warm end of the still and eats the mice that eat the seed.',
      ],
      [
        'Not many of my kind inside the wall. Enough to fill a table, never a street.',
        'My grandmother was carried over the fray in the bad year. She weighed more than the Hawkfolk who lifted her, and the two of them argued about it until he died.',
        'He never once took a fee for it. She sent him a pie every seventh day regardless.',
      ],
    ],
    reactive: (ctx) => {
      const view = ctx.missingCats;
      if (view.clues.has('apothecary_tuna_dish') && !phaseReached(view, 'aftermath')) {
        return [
          'That dish of tuna in the back room. I never bought it and Fen never bought it. We have asked each other twice now, very politely.',
        ];
      }
      return ownCatLines('taloncrest_apothecary_cat', view, {
        missing: [
          'Sage has not been in for her cream. I pour it anyway.',
          'If Sage turns up out there, tell her Baggi has the good cream.',
        ],
        home: [
          'Sage is back on the warm end of the still, and she has not said where she has been.',
        ],
      });
    },
  },
  taloncrest_lodge_cellar_elf: {
    ambient: [
      'The lid stays shut from this side now. Kessler and I agree on that much.',
      'The Hawkfolk on this row take the long way round me in the alley. Kessler’s men stopped doing that after the cellar.',
      'I light one candle at the lid at night. Kessler pretends not to see it.',
      'Mind the third board from the lid. It talks.',
      'My mother was offered a carry in the bad year. She took the cellar stairs instead, and she never told me why.',
    ],
    lore: [
      [
        'When the old city came apart, the Hawkfolk took people up. We would not be carried. We went down.',
        'Cellars first, then the cisterns, then the drains under the hill. The better part of a year in the dark.',
        'We came up knowing every pipe under this town, and the town has kept an eye on its cellars ever since.',
      ],
      [
        'You have seen the mark. An open eye over a cupped hand.',
        'She chooses whom she speaks to. We hold that she can be made to choose, if you hold a thing up where she can see it.',
        'A candle, a trinket, a lock of hair. You burn it and you wait. The roost calls that begging. We call them carriers of dead weight.',
      ],
      [
        'The drains under this hill run everywhere the old streets did. Under the plaza, under the temple, all the way under the tower.',
        'We do not go in under the tower. None of us has ever said why.',
      ],
    ],
    reactive: (ctx) => {
      const view = ctx.missingCats;
      if (phaseReached(view, 'aftermath')) {
        return [
          'Our cats came up the drain this morning, one after another, wet and cross. A cat always comes back.',
        ];
      }
      if (phaseReached(view, 'captured')) {
        return ['They took your cat off the fountain. Ours have been up there longer. I am sorry.'];
      }
      return [
        'Whatever takes the cats, it does not come through the drains. We would have smelled it.',
      ];
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
