/**
 * The words of every named Taloncrest resident — the individuals layered on top of
 * the role system in `townDialog.ts` rather than replacing it. Each entry's
 * `ambient` is everyday chatter in their own voice, `lore` is a multi-page life
 * story told one entry per talk, and `reactive` is a quest-gated pool shown as the
 * lead page when their corner of town has something timelier to say. Between
 * them they tell the Fraying, the Hawkfolk and the Carrying, the old circus and
 * the tower, each from where that resident stands (the canon is
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
      'Mind the jars by the door, dearie. Some are pickles, and the rest I’d rather you didn’t open.',
      'Sit down if you like. Not that stool, it wobbles. The other one.',
      'You’ve got ruin dust up to your knees. Brush it off on the step, I’ve only just swept.',
      'Folk come to me for a charm when the deacon’s prayers haven’t done the job. I don’t mind being second choice. The coin spends the same.',
      'Everybody wants a charm against what’s out past the wall. I tell them the best charm in this town is the wall.',
      'Voss reads on the plaza with candles and a velvet cloth. I read at my kitchen table, it costs you less, and you get a cup of tea.',
    ],
    lore: [
      [
        'You’re wondering why the walls are so thick. Everybody does, sooner or later.',
        'This was a city once, dearie. Ten times the size. It ran right out past where the ruins are now.',
        'Then one night the ground split open under it, street after street, like a seam coming undone. The temple calls it the Fraying. I just call it the bad year.',
        'I was young. What I remember most is the noise. Like cloth tearing, and it didn’t stop till morning.',
      ],
      [
        'The things out in the ruins. You’ve fought a few by now, I expect. Did you look at their hands?',
        'The folk caught in the Fraying didn’t die, dearie. They came back wrong and wandered off. But the hands stay near enough to how they were.',
        'The baker on Low Street had a birthmark across his knuckles, like a spilt cup of tea. I saw it again three winters back, on something that walked on all fours.',
        'So I don’t weep over them. But I don’t pretend they were always monsters, either.',
      ],
      [
        'Have you read the proclamations pinned up round town? Curfews, the tax on lamp oil, when the west gate shuts.',
        'Every one of them is in the same handwriting. The same hand that wrote them when I was a girl.',
        'The Warden’s been up in that tower my whole life, and I’ve never met anybody who’s laid eyes on them.',
        'Folk here are more frightened of that tower than of anything past the wall. I’ve never been sure they’re wrong.',
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
      'Mind the shavings. I sweep on feast days, and it’s not a feast day.',
      'Stay out of the lane by the target, would you? I put a bolt through a man’s hat once and I’ve not lived it down.',
      'The dynamite’s for stumps. Briar Hollow buys it by the crate to clear new ground. What you clear with it is your business.',
      'If it rolls in this town and I didn’t build it, I’ve probably fixed it.',
      'Get one spoke wrong and the wheel wobbles all the way down the road, with my name on it.',
      'I shoot between jobs. After a morning bent over spokes it gets my eyes working again.',
    ],
    lore: [
      [
        'That long wagon bed under the sheet, by the door? It’s red under the dust.',
        'I built eleven of those for the circus, back when it still toured the villages.',
        'The owner paid on the day, every time, and asked after my knees. You don’t forget a customer who asks after your knees.',
        'That one was never collected. I sell firewood from my offcuts, and I still can’t bring myself to cut it up.',
      ],
      [
        'I had an apprentice once. Teodo. Good hands, no patience.',
        'He went out past the west gate on a dare. Most lads who do that come home with a scraped knee and a story.',
        'The guards found his belt hung on a fencepost. Just the belt.',
        'So if you’re going out there, go because you need to. Don’t go to prove anything.',
      ],
      [
        'Half my work these days comes from Briar Hollow, the ratkin village out east.',
        'They’ve nothing round them but a wooden palisade. I don’t know how they sleep.',
        'Their carts come in with the axles cracked from the road, and I send them home sound. They pay in turnips about as often as coin.',
        'If you’re headed that way, tell them Steve says grease the hubs. They never grease the hubs.',
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
      'Flour gets on everything in here. You’ll be finding it in your boots for a week.',
      'Sit down and eat something. You look like you’ve been living on whatever you found in a ditch.',
      'The hot plate’s whatever’s in the pot today. Don’t ask what it is, just eat it while it’s hot.',
      'The crisps are my own baking. The ones they sell at the club come off a cart from who knows where.',
      'Sixteen sacks of flour a week go up to the Barracks, and they act like they’re doing me the favour.',
      'If you see my Corvin hanging round the gate, send him home. Tell him his mother said so.',
    ],
    lore: [
      [
        'The Barracks like to say they keep this town alive. They don’t. The mill does.',
        'Sixteen sacks a week to Quartermaster Dann, at a price set years ago. Every time it’s due to be looked at again, the tower puts it off.',
        'I don’t argue. A town with a wall round it and nothing to eat doesn’t last long.',
        'But when the soldiers march past like they own the street, I do think about who baked their breakfast.',
      ],
      [
        'My boy Corvin is fifteen and about as sensible as a barn cat.',
        'He watches people like you come through and thinks that’s the life. Fighting, treasure, everyone telling stories about you.',
        'I’ve told him what you all look like when you come limping back through the gate. He took it as a dare.',
        'So do me a favour. If he asks you what it’s like out there, don’t make it sound good.',
      ],
      [
        'Our fields used to run right out to where the ruins start.',
        'From the loft you can still see the old furrows under the rubble, straight as a ruled line.',
        'My great-grandmother ploughed those. Now I farm a patch inside the wall and folk call it the South Green.',
        'The bad year took the neighbours first and the fields after. Nobody ever talks about the fields.',
      ],
    ],
    reactive: (ctx) => {
      const view = ctx.missingCats;
      if (view.clues.has('mill_hayloft_feather') && !phaseReached(view, 'confession')) {
        return [
          'Corvin wanted that feather for his wall. I told him half the town moults on my roof. It’s only a feather.',
        ];
      }
      return ownCatLines('taloncrest_mill_farm_cat', view, {
        missing: [
          'Chaff kept the mice out of the grain for six years. Without her I can hear every one of them all night.',
          'Corvin keeps leaving the mill door open for Chaff. I’ve stopped telling him not to.',
        ],
        home: [
          'Chaff was asleep in the hopper this morning, white with flour, like she had never been anywhere.',
        ],
      });
    },
  },
  apothecary_fen: {
    ambient: [
      'Tell me what hurts. I promise I’ve heard worse.',
      'If you’re not sure what a bottle does, ask me before you drink it, not after.',
      'Drink it all in one go. It tastes worse in sips.',
      'Baggi does the lifting in here. If it’s on a high shelf, ask her, not me.',
      'Half the people who come in would be fine after a good night’s sleep. I sell them a potion anyway. They sleep better for it.',
      'Kestrel cut her price on potions again, so I cut mine. Keep shopping at both of us and we’ll be giving them away by winter.',
    ],
    lore: [
      [
        'I learned this trade from a Hawkfolk healer, up in the roosts.',
        'Nine years, and he never once told me his name. He’d just point a talon at whatever needed grinding next.',
        'They mend people better than we do, and faster, and they won’t tell you how they do it.',
        'So I watched. Everything I know, I learned by watching over his shoulder.',
      ],
      [
        'Ask anyone who lives near the wall. On stormy nights the edge of the ruins shifts.',
        'The ground out there never settled after the bad year. In the rain, whatever lives in the rubble ends up closer to the gates.',
        'Those are the nights I sell the most bandages, mostly to the low streets.',
        'Nothing on my shelves does a thing about why it happens. I only patch up what it does.',
      ],
      [
        'Everyone asks what’s in a health potion. Mostly honey.',
        'The rest is roots and moss that taste like a cellar floor. They do the work. The honey’s there so you’ll drink it twice.',
        'Kestrel buys hers in from a trader and swears they keep longer than mine.',
        'They do keep longer. They also taste like a cellar floor.',
      ],
    ],
    reactive: null,
  },
  deacon_aviel: {
    ambient: [
      'Thou art welcome under the dome, whatever thou dost believe.',
      'Kneel or stand, as thou wilt. Nobody here will mind which.',
      'The coin for a blessing goes to the poor box, and the poor box goes to whoever needs it that week.',
      'Look up, if thou likest. The sky window is the finest thing in this temple, and I had no hand in it.',
      'The High Roost meets on the dome above us. When they argue, the dust comes down on the pews.',
      'Madame Voss sells comfort on the plaza and I give mine away in here. We do not quarrel. Most weeks.',
    ],
    lore: [
      [
        'My mother never once set foot in this temple. She said a roof is no place to pray, for one who can fly.',
        'She prayed on the wing instead, over the wall at first light, every day until her wings gave out.',
        'I thought her old-fashioned. Thirty years I have kept this temple, and some mornings I think she had the right of it.',
      ],
      [
        'Thou wilt hear folk speak of nest-debt. It began in the bad year, when the old city came apart.',
        'My people flew whoever they could lift over the ruin to this hill. Since then, every one of us who can fly owes a carry to those who cannot.',
        'Refuse a carry and thou art clipped. The roost will not speak thy name again.',
        'I preach it every seventh day, and I believe it. But some nights I wonder at a faith whose first word is a debt.',
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
      'Don’t touch anything on the forge side. If it looks cold, it isn’t.',
      'Hand me the blade, not a story about the blade.',
      'One edge or two? Two works out cheaper. I only have to heat the forge once.',
      'I cut every handle wide enough for talons. Groundfolk hands manage fine on it.',
      'Fifty years at this anvil, and I can still feel it when I’m rushing.',
      'If something’s going to break, I can usually tell you before it does.',
    ],
    lore: [
      [
        'This forge used to do hinges, ploughshares, cart tyres. Horseshoes by the dozen, once. You won’t find a horse inside the wall now.',
        'These days everybody wants an edge. Swords, axes, spearheads, all day long.',
        'I still make hinges, though. Somebody has to, or the doors in this town stop keeping things out.',
      ],
      [
        'See the dip worn into the face of that anvil? Deep as your thumb.',
        'Three smiths wore that in before me. The first one worked out where the ruins are now.',
        'In the bad year they hauled it in on a sledge. Left the house, left the tools, brought the anvil.',
        'Ask anybody in this town what their family saved. It’s always something heavy.',
      ],
      [
        'The garrison sends me their blades bent and I send them back straight.',
        'Every notch tells you something. A notch high on the left means something tall came down at them, and fast.',
        'I’ve seen a lot of high-left notches this season. More than I’ve ever seen.',
        'Bear that in mind if you’re going past the gate. Keep your guard up on that side.',
      ],
    ],
    reactive: ownCatReaction('taloncrest_smithy_cat', {
      missing: [
        'Cinder sleeps on the warm side of the forge wall. I still bank the fire at night for her, out of habit.',
      ],
      home: [
        'Cinder’s back on the forge wall. Singed her whiskers the first night, same as every winter.',
      ],
    }),
  },
  innkeep_ossie: {
    ambient: [
      'Beds upstairs, stew down here. Have one or both, I’m not fussy.',
      'Sit down and eat something. You look like you slept in a hedge, and I mean that kindly.',
      'The attic’s cheapest and the hearth room’s warmest. If it’s raining, take the hearth room. Trust me.',
      'The Stump’s the loud house and the Flagon’s the posh one. This is where you come to actually sleep.',
      'Corporal Pell sends me recruits before they’ve even signed. Says a bed here costs less than a funeral.',
      'I could sleep up in the rafters if I wanted the quiet. I sleep behind the bar. Closer to the till.',
    ],
    lore: [
      [
        'You keep looking at the sign. Everybody does.',
        'Nine years back a cat walked in off the ruins road, sat on that stool there, and wouldn’t be moved.',
        'Believe me or don’t, but that cat talked. Talked me out of a whole ham and was gone before sunrise.',
        'I painted the sign the next morning. It felt rude not to.',
      ],
      [
        'Most of my guests are groundfolk. My own kind mostly sleep at home, up high.',
        'Groundfolk off the roads always ask for a room on the ground floor, like they think I’ll put them up in the rafters.',
        'I tell them the attic has stairs. Half of them still look worried till they’ve seen it.',
      ],
      [
        'Nothing that means you harm has come through that door since you sat down, and it’s not because I’m handy with a ladle.',
        'One evening this was an ordinary inn. By morning nothing hostile could cross the threshold. Nobody asked me, and nobody’s ever explained it.',
        'I still check the latch every night. Old habits.',
        'Ask Dave if you don’t believe me. He took a room and never left, and he’ll tell you how quiet it stays.',
      ],
    ],
    reactive: (ctx) => {
      const view = ctx.missingCats;
      if (!phaseReached(view, 'posters_up')) return null;
      return ownCatLines('taloncrest_inn_cat', view, {
        missing: [
          'Biscuit’s bowl is still by the hearth. I fill it at night, and in the morning it’s still full.',
          'The regulars keep asking after Biscuit. I’ve run out of things to tell them.',
        ],
        home: [
          'Biscuit walked in the front door at breakfast and sat on the stool under the sign, as if she had been there the whole time.',
        ],
      });
    },
  },
  innkeep_brend: {
    ambient: [
      'Welcome to the Flagon. Sit anywhere but the guild booth. They’ll tell you why if you try.',
      'We don’t water the mead and we don’t run tabs for strangers.',
      'Boots off the bench, if you would. That bench is older than both of us.',
      'I hear a great deal behind this bar, and I repeat about a third of it.',
      'Ossie’s is for sleeping and Marlow’s is for fighting. Mine’s where people come to do business.',
      'The guild reserve is the good mead. The wool families drink it at weddings and funerals and not much in between.',
      'Groundfolk drink slower and tip better than my own kind. I’ve never worked out why.',
    ],
    lore: [
      [
        'I could draw you who sits where in here with my eyes shut. For twenty years it hardly changed.',
        'The wool families along the north wall. The guild factors in their booth. The tower clerks by the fire, every seventh night.',
        'When the seating changes, something’s happened in town. You learn to read it like the weather. Lately I’ve had a lot of weather.',
      ],
      [
        'That booth in the guild corner, under the fleece, is the factors’. They were striking deals in it before I had the lease.',
        'When the roads were safe they sent wool carts out to every village around. Now they spend the evening arguing over who gets space on the one cart that still goes to Briar Hollow.',
        'The banner over the booth was stitched by somebody’s grandmother. Don’t hang your coat on it. I’ve seen a man thrown out for less.',
      ],
      [
        'The tower clerks stopped coming about six weeks ago. All of them, the same week.',
        'Twenty years they had the two tables by the fire, every seventh night. Then nothing.',
        'One came back on his own, paid for a room he never slept in, and left before it was light.',
        'I don’t gossip about the tower. I’m only telling you about my own custom.',
      ],
    ],
    reactive: ownCatReaction('taloncrest_flagon_tavern_cat', {
      missing: [
        'Barrel slept on the guild bench for nine years. The factors still sit round the empty end, as if Barrel were there.',
      ],
      home: [
        'Barrel’s back on the guild bench. The factors are pretending they’re not pleased about it.',
      ],
    }),
  },
  innkeep_marlow: {
    ambient: [
      'Ale’s cheap and the stew’s hot. That’s the whole pitch.',
      'Break a glass, you pay for it. Bleed on the floor and Puddles will sort it out.',
      'Nobody in here is anybody. That’s why they drink here.',
      'Don’t go out the back unless you know the alley. It doesn’t go where you’d think.',
      'The floor’s only level in the one corner. Pick your table accordingly.',
      'I’ve thrown out better than you and worse than you, same night, same door.',
    ],
    lore: [
      [
        'The Stump’s got two doors, and only one of them opens on a street.',
        'The other one lets out into the service alley. It runs behind the whole Low Quarter and comes out by the club.',
        'Every barrel and crate that goes into the club goes past my back door first. So does every drunk that comes out of it.',
        'The guard hardly ever walks it. That suits everybody who uses it.',
      ],
      [
        'My regulars are porters and carters, and the lads who stack crates for the club.',
        'Hard work, bad pay, and they drink here because nobody in here looks down on them.',
        'You get a few Hawkfolk too, down from the roosts, when they don’t want to be seen drinking.',
        'I don’t tell anybody who’s been in. That’s half of what they’re paying for.',
      ],
      [
        'They call it the Sunken Stump because the floor’s lower than the street. When it rains, the street comes in.',
        'My father bought it cheap for exactly that reason. He said nobody else would want a pub that floods.',
        'He was right. Nobody else wanted it.',
        'Puddles has mopped it out every wet night for eight years and never once complained to my face.',
      ],
    ],
    reactive: null,
  },
  sgt_kessler: {
    ambient: [
      'This is a garrison post. If you’ve business, say it. If not, there’s a whole town out there.',
      'Two of us on this post and no relief. Don’t ask me about morale.',
      'I don’t need your name. I’d like to know which gate you came in by.',
      'I took my report up to the High Roost and they called it settled. Not one of them has flown down this alley since to check.',
      'Eleven-hour watches. You get used to it, or you don’t.',
      'If you ever hear a whistle from this alley, don’t come running. Go and fetch somebody.',
    ],
    lore: [
      [
        'You’re wondering why there’s a garrison post at the end of a dead-end alley.',
        'See that hatch in the floor? Under it there’s an old cistern, older than the wall, and drains that run under all of Garrison Row.',
        'We’re not here to watch the alley. We’re here to sit on the lid.',
      ],
      [
        'Four sergeants on this post in six years. I’m the only one who’s stayed.',
        'The others all asked for a transfer, and every one of them wrote the same words on the form: "unsuitable for continued duty."',
        'Nobody comes up with a phrase like that on their own. Somebody hands it to you.',
        'I stopped asking for a transfer and started keeping a log of my own instead.',
      ],
      [
        'There were candles down there once. Set out in a ring and burnt to stubs, on a floor nobody’s meant to reach.',
        'Whoever met down there met often, and they weren’t in any hurry to leave.',
        'I reported it twice. Both times it came back marked resolved, from an office that never sent anyone to look.',
        'So I’m telling you instead. Maybe you’ll do more with it than the tower did.',
      ],
    ],
    reactive: (ctx) => {
      const view = ctx.missingCats;
      if (lodgeCellarHeld(view)) {
        return [
          'I had the elves in my log as the thieves. I struck that line out myself, with the one who came up the ladder watching me do it.',
          'Every wave that came up that cistern, the lid held. I’ve written down whose hands were on it.',
        ];
      }
      if (phaseReached(view, 'blame')) {
        return [
          'Half the row has been to my door asking when I’m going to open that lid. They want the elves dragged up.',
        ];
      }
      return null;
    },
  },
  corporal_pell: {
    ambient: [
      'Sand’s raked and the posts are up. Hit something or get off my floor.',
      'You swing like you’re opening a door. Put your hips into it and go again.',
      'Spears go back on the rack, always. Fumble for your weapon out there and you’re done.',
      'Half my recruits come off roost duty and can’t hold a stance. Flying doesn’t teach your feet anything.',
      'Every session’s harder than the last. Your body’s already learned the easy part.',
      'Dann sells the armour, Sydney rents out the hired help, and I’ve got the sand. Pick one.',
    ],
    lore: [
      [
        'I flew the wall patrol for twelve years before they put me on the sand.',
        'Took a spear through the wing out past the west gate. It mended, but it never sat right.',
        'You can’t fly patrol if you can’t make a full circuit. So now I teach.',
        'I like it more than I thought I would. A patrol never thanked me for anything.',
      ],
      [
        'Don’t sleep here. Three of your sort have tried, and I’ve carried all three out.',
        'This is a barracks. Thick walls, soldiers with spears, a bolt on the door. Something big enough can get through all of that.',
        'If you want a room nothing can get into, it’s the Sleeping Cat Inn by the plaza. Ask for Ossie. Nothing hostile has got through that door in my time.',
        'Sleep there. Train here.',
      ],
      [
        'Don’t get too comfortable in this town. People do. There’s a market and a pub and it starts to feel like home.',
        'I’ve watched a few of your sort come through. The ones who settle in are the ones I don’t see again.',
        'Whatever you’ve been putting off, do it this week.',
      ],
    ],
    reactive: null,
  },
  quartermaster_dann: {
    ambient: [
      'You pay, you sign the book, you walk out with it. In that order.',
      'I don’t sell blades. That’s Varga, at the Anvil. I sell what keeps the blade off you.',
      'Hearthguard kit. Same as the garrison wears on the wall, and it’s kept them alive so far.',
      'Try it on here. A strap you can’t find in the dark is no use to you.',
      'Nobody’s ever argued about the price of a helmet after they needed one.',
      'Coin only at this counter. No favours, no nest-debt, no tabs.',
    ],
    lore: [
      [
        'Most of what’s on that rack has been worn before. Patched, restitched, oiled.',
        'New leather’s stiff and it rubs you raw. Broken-in sits better and turns a blow just as well.',
        'Every piece is in the book, with who wore it and when it came back.',
        'Some of them didn’t bring it back themselves. I don’t mention that unless I’m asked.',
      ],
      [
        'On paper the garrison’s forty spears. We’ve got nineteen, and eight of those have never been past the wall.',
        'We eat on sixteen sacks of flour a week from the mill, at a rate nobody’s looked at in years.',
        'Every season the tower asks why the kit isn’t new, and every season I send them back the numbers.',
        'They never read them. I keep writing them anyway. Somebody after me will want the count.',
      ],
    ],
    reactive: null,
  },
  stock_clerk_wick: {
    ambient: [
      'Brenna’s at the counter. I’m the one who knows where everything is.',
      'Rope, lamp oil, chalk. That’s what everyone buys their first week. Every single time.',
      'If you want the really good potions, Fen’s across the plaza. Don’t tell Brenna I said that.',
      'I restock every morning and it’s all gone again by dark. Potions especially.',
      'The smoke bombs live on the top shelf so nobody knocks one off by accident. That’s happened.',
    ],
    lore: [
      [
        'I’ve been writing down what people like you buy for two years now.',
        'First week it’s rope, chalk and a lamp. Very careful.',
        'Second week it’s potions and nothing else.',
        'There isn’t really a third week in the book. I’m not trying to be grim. That’s just what the numbers say.',
      ],
      [
        'Brenna counts every jar in here twice a week, once by hand and once against the till. If they don’t match, I hear about it.',
        'It’s not that I’m careless. Some of it I give away. People come in shaking and can’t pay for a potion.',
        'You can usually tell which ones. One of Caroline’s floating eyes will be hanging over them at the counter, like it’s waiting to see what happens.',
        'Those ones get a potion, and I put it down as breakage. Please don’t tell her.',
      ],
      [
        'Six weeks ago somebody bought every lamp we had in one go. All the oil too, and forty candles.',
        'Not one of your sort. Town clothes, town accent. Paid in old coin and wouldn’t give a name for the book.',
        'Forty candles. I can’t think what anybody needs forty candles for.',
        'I put it in the book under "unknown". I hate writing "unknown".',
      ],
    ],
    reactive: (ctx) => {
      const view = ctx.missingCats;
      if (view.clues.has('store_tuna_ledger') && !phaseReached(view, 'aftermath')) {
        return [
          'I went back through the tower’s tuna order, every week as far as the book goes. Nobody up there has ever bought a saucer.',
        ];
      }
      return null;
    },
  },
  keeper_brenna_kestrel: {
    ambient: [
      'Coin first, then the story. I’ve heard every story, and they all end at the price.',
      'Ask Wick where something is. Ask me what it costs.',
      'I count every jar in this shop twice a week, and the till had better agree with me.',
      'You groundfolk never look up. I could hang the sale sign from the rafters and you’d still ask me where it is.',
      'Fen’s potions are fine. Mine keep longer. That’s all I’ll say about Fen.',
      'If a shelf looks empty, ask. There’s more in the back.',
    ],
    lore: [
      [
        'This shop was my mother’s before it was mine. She ran it with a ledger in one hand and a temper in the other.',
        'I flew supply runs before that. Three years hauling crates between roosts, and nobody once thanked me for landing on time.',
        'When she died I gave up flying and took the counter. The till adds up the same either way.',
        'I don’t regret it. Some months I regret the breakage column.',
      ],
      [
        'Fen and I sell a lot of the same things, and she sets her prices to spite me. I’m fairly sure of it.',
        'Mine keep longer. I’ve tested it. I don’t say so too loudly, because it sounds petty. It is petty.',
        'Wick thinks I should just match her. Wick has never had to explain a loss to the trader who fronts my stock.',
        'I won’t be undercut in my own shop. Call it arithmetic. I stopped pretending it was pride years ago.',
      ],
      [
        'My clerk writes off more breakage than a shop this size has any right to.',
        'I’ve checked his numbers against the shelves twice now. Short both times, and nothing broken that I can find.',
        'He’s not stealing. I’ve caught two who were in nine years, and neither of them was that quiet about it.',
        'Whatever he’s doing, I’d like it to stop before I have to ask him.',
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
      'Sit down. Look at the wall, not the needle. Everybody thinks they’ll be the exception.',
      'One mark of each kind per customer. Don’t ask me for a second. I won’t do it.',
      'It’ll itch for a day. After that it starts paying attention.',
      'The chair’s comfortable on purpose. It’s the only kind thing in here.',
      'I don’t ink anywhere near the flight feathers. Get that wrong and you fly crooked for a year.',
      'No portraits. The ink does strange things with faces.',
      'One of Caroline’s floating eyes hung over my chair all last week. I did the dullest linework of my life until it drifted off.',
    ],
    lore: [
      [
        'One of the dancers at the Cloak & Dagger wears my work. All of it at once, and it moves while she’s thinking.',
        'She came in once, looked at my linework, and fixed it with her thumbnail. Never said a word.',
        'My line’s been better ever since. I put her design in the back of my book and I don’t copy it for anyone.',
      ],
      [
        'People think it’s just ink. It isn’t. A mark from this chair is alive, a little. It wants somewhere to settle.',
        'That’s why I won’t put two of the same kind on you. Two marks argue.',
        'They argue about you, mostly. Nobody’s ever ready for that part.',
        'So pick one you won’t mind hearing from for a long while.',
      ],
      [
        'Most of my customers are groundfolk. My own kind get nervous about ink anywhere near their feathers.',
        'The ones who do come in are usually about to do something brave or stupid, and they want a mark for it first.',
        'I don’t ask which. I just ask them to sit still.',
      ],
    ],
    reactive: null,
  },
  janitor_puddles: {
    ambient: [
      'Mind the wet patch. And the other one. It’s a pub, love, it’s all wet patch.',
      'Somebody always spills the first drink of the night. I’ve a bet with myself on who.',
      'Marlow swears this floor was blue once. Eight years I’ve mopped it and I’ve never seen blue.',
      'Stump floods when it rains. Floods when it doesn’t, too. I’ve stopped asking.',
      'Don’t say sorry for the mud, love. Just walk in a straight line so I know where it went.',
    ],
    lore: [
      [
        'Folk think they call me Puddles because of the job. My mam called me Puddles long before I had a job.',
        'I took this mop off the last fellow when his knees went. The handle’s older than the bar.',
        'Wring it twice, mop with the grain, never mop toward the door. Took me two years to learn that.',
      ],
    ],
    reactive: null,
  },
  janitor_grout: {
    ambient: [
      'Thirty-one rows of flagstones in here, and I know every one that rocks.',
      'Brend wants the guild corner done first, before the factors sit down. Factors never look at floors. Brend does.',
      'If you’re going to bleed, bleed on the stone, not the rug. Stone washes.',
      'A good mop’s like a good dog. Comes back wet and doesn’t complain.',
      'A quiet night’s a dry floor. Haven’t had one of those in a while.',
    ],
    lore: [
      [
        'They call me Grout because of the mason who laid this floor. I kept pestering him about the gaps.',
        'He said the gaps are what let the stones shift without cracking each other. I liked that.',
        'He’s long gone. The floor’s still here, and I keep the gaps clean for him.',
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
        'A candle, a trinket, a lock of hair. You burn it and you wait. The roost calls that begging. We call the roost carriers of dead weight.',
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
