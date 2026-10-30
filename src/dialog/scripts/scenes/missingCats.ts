/**
 * "A Cat Always Comes Back": the owners, the clues, the lodge cellar, the
 * temple and the bait, as the questline's own scenes say them.
 *
 * The owners speak in the voice their figure was drawn with, so each beat
 * that is one of theirs takes the owner's `LineBuilder` rather than fixing a
 * style here. One fact per conversation: each owner says what is missing and
 * what in the room is wrong, and the room says the rest.
 */

import { speakerLines, transientSpeaker } from '../../line';
import type { BarkLine, DialogLine, LineBuilder, NonEmpty } from '../../line';
import type { CitizenSpeechStyle } from '../../speakers';
import type { QuestRewardSpec } from '../../../ui/questReward/types';
import type { AvielChoice, MissingCatsClueId } from '../../../core/quests/missingCatsProgress';
import { CLUE_PLACES } from '../../../core/quests/missingCatsLeads';
import { carolineLines, type CarolineMessage } from '../../caroline';
import { crawlerDisplayName } from '../../../characters/characters';

const dave = speakerLines('dave');
const belle = speakerLines('belle');
const lori = speakerLines('lori');
const aviel = speakerLines('aviel');
const narrator = speakerLines('narrator');
const pumpkin = speakerLines('pumpkin');
const humanCrawler = speakerLines('human_crawler');

/** The hawk the High Roost sends to carry in Aviel's place, once he has been clipped. */
const ROOST_HAWK = transientSpeaker('High Roost hawk', 'townsfolkHawkfolk');

/** The cellar elf, before the party knows any of them by more than that. */
const CELLAR_ELF = transientSpeaker('Cellar elf', 'townsfolk');

// ── The hook, in the Sleeping Cat Inn ─────────────────────────────────────

/** Ossie tells the party the inn's cat is gone, and Dave answers with the town's saying. */
export function innHook(ossie: LineBuilder): NonEmpty<DialogLine> {
  return [
    ossie.line(
      "Biscuit's gone. She's our cat, the fat ginger one who sleeps on the end of the bar. It's been three nights, and she's never missed a supper in her life. And it isn't just her. Nearly every cat in town has gone missing this month. Every owner put a notice up on the board in the Market Plaza, saying what they know. Read them. Maybe you'll make more of it than we have.",
    ),
    dave.line('A cat always comes back.'),
    dave.line('…Usually.'),
  ];
}

/**
 * The regular on the bench against the inn's front wall, before anyone has
 * asked Ossie and after, in `voice`, the one their look is painted for.
 */
export function innWallSitterLines(voice: CitizenSpeechStyle) {
  const sitter = transientSpeaker('Inn regular', voice);
  return {
    catMissing: sitter.line(
      "Did you hear that the innkeeper's cat went missing? It's really sad. That cat is what made this place feel like home.",
    ),
    catHome: sitter.line(
      "Biscuit's back asleep on the end of the bar, like she never left. This place feels like home again.",
    ),
  } as const satisfies Record<'catMissing' | 'catHome', DialogLine>;
}

/** The prompt over the regular on the bench. */
export const INN_WALL_SITTER_PROMPT = 'Talk';

// ── The owners ────────────────────────────────────────────────────────────

export const LORI_OWNER: NonEmpty<DialogLine> = [
  lori.line(
    "Thimble's gone, dearie. She went out through the little window by the fireplace, the one over my back garden. I latched it before bed, and in the morning it was standing open. Go and look under it. Then tell me how anybody got to that window without setting foot in my garden.",
  ),
];

/** Baggi, about the shop cat and the dish under the drying-room window. */
export function baggiOwner(baggi: LineBuilder): NonEmpty<DialogLine> {
  return [
    baggi.line(
      "Sage is gone. She kept the mice off the drying racks. And somebody left a dish of tuna in the back room, under the window by the potting bench. I didn't put it there, and neither did Fen.",
    ),
  ];
}

/** Marta, about the mill cat and the millstones she slept on. */
export function martaOwner(marta: LineBuilder): NonEmpty<DialogLine> {
  return [
    marta.line(
      "Chaff slept up on the millstones every night of her life. Now she's gone, and the only thing by those stones is a feather.",
    ),
  ];
}

// ── The notice board ──────────────────────────────────────────────────────

const INN = CLUE_PLACES.inn_scent_trail.name;
const COTTAGE = CLUE_PLACES.cottage_owner_heard.name;
const APOTHECARY = CLUE_PLACES.apothecary_owner_heard.name;
const STORE = CLUE_PLACES.store_tuna_ledger.name;
const MILL = CLUE_PLACES.mill_owner_heard.name;

/**
 * What the party says to send themselves to each clue's place, once the
 * last thing they found leaves the story pointing somewhere else. Each names
 * the place the Journal then points at, read off the same table.
 */
export const LEADS_ONWARD = {
  inn_scent_trail: [
    belle.line(
      `Biscuit is the inn's cat. If she went out the front door, her scent will still be on the street outside ${INN}. Take me to its step and I'll find it.`,
    ),
  ],
  cottage_owner_heard: [
    humanCrawler.line(
      `Old Lori's notice said Thimble went out a window nobody walked up to. Let's go to ${COTTAGE} and ask her.`,
    ),
  ],
  cottage_latch: [
    belle.line(`We never looked under that window of Lori's. Let's go back to ${COTTAGE}.`),
  ],
  apothecary_owner_heard: [
    humanCrawler.line(
      `Baggi's notice said someone left a dish of fish nobody put out. Let's go to ${APOTHECARY} and ask him.`,
    ),
  ],
  apothecary_tuna_dish: [
    belle.line(`We still haven't looked at that dish in the back room at ${APOTHECARY}.`),
  ],
  store_tuna_ledger: [
    humanCrawler.line(
      `The order book at ${STORE} should say who's been buying that tuna. Let's go and read it.`,
    ),
  ],
  mill_owner_heard: [
    humanCrawler.line(
      `Marta's notice said Chaff went missing from inside a bolted mill. Let's go to ${MILL} and ask her.`,
    ),
  ],
  mill_hayloft_feather: [
    belle.line(`Marta said there was a feather by her millstones. Let's go back to ${MILL}.`),
  ],
} as const satisfies Record<MissingCatsClueId, NonEmpty<DialogLine>>;

/**
 * Read off the plaza board: the notices that say something odd. It names no
 * next step of its own: the lead to the clue the story points at first, from
 * {@link LEADS_ONWARD}, follows it, so the party and the Journal agree.
 */
export const NOTICES_READ: NonEmpty<DialogLine> = [
  humanCrawler.line("Most of these only say the cat's gone. Three of them say something odd."),
  humanCrawler.line(
    `Old Lori's went out a window nobody walked up to. Baggi at ${APOTHECARY} found a dish of fish nobody put out. Marta's went missing from inside a bolted mill.`,
  ),
];

// ── The things in the rooms ───────────────────────────────────────────────

export const LATCH_EXAMINED: NonEmpty<DialogLine> = [
  narrator.line(
    "The window's iron latch lies on the floor under it, sawn clean in two. Someone cut through it from outside.",
  ),
  lori.line(
    'The soldiers say an elf crept through my garden and did that. I have been over every inch of it, dearie. Not a trodden leaf, not a bent stem, not one footprint in the soil under that window. Whatever came for Thimble never walked up to my window.',
  ),
];

export const TUNA_DISH_EXAMINED: NonEmpty<DialogLine> = [
  narrator.line(
    'A clay saucer on the floor under the window, with the last of some tinned tuna dried onto it. Baggi and Fen never buy tuna, so somebody brought it in.',
  ),
  belle.line(`That's tinned tuna. You can only buy that at ${STORE}.`),
];

/** What the party sees beside the millstones, and what the owner makes of it. */
export function featherFound(marta: LineBuilder): NonEmpty<DialogLine> {
  return [
    narrator.line(
      'A grey feather lies on the floor beside the millstones. It is longer than your forearm, far too big for any ordinary bird.',
    ),
    marta.line('Hawkfolk drop feathers all over town. Keep it if you want it.'),
  ];
}

/** The feather is back by the millstones because nobody is carrying it. */
export const FEATHER_FOUND_AGAIN: NonEmpty<DialogLine> = [
  narrator.line(
    'The grey feather is back on the floor beside the millstones, where you first found it.',
  ),
];

export const SCENT_TRAIL_ENDS: NonEmpty<DialogLine> = [
  belle.line(
    "Biscuit's scent just stops here, out in the open. Whatever took her didn't walk away.",
  ),
];

/** Read off the General Store's order book once the dish has been seen. */
export const LEDGER_READ: NonEmpty<DialogLine> = [
  belle.line(
    "The tower used to take two tins a week. Now it's twelve, more than the rest of town buys in a year.",
  ),
  humanCrawler.line(
    'And the order went up the same month the cats started going missing. Whoever left that dish at Herb & Remedy got the tuna from the tower.',
  ),
];

/**
 * Said once the last clue is found, wherever it was: what the four add up to,
 * and why the next door is the Lodge. Every clue is heard by then, so Lori's
 * word about the soldiers is always behind it.
 */
export const INVESTIGATION_SOLVED: NonEmpty<DialogLine> = [
  humanCrawler.line(
    "A window nobody walked up to. A feather bigger than any bird's. A scent that stops in open ground. And tuna from the tower's own order.",
  ),
  belle.line("Whatever took them came down out of the sky. That isn't an elf."),
  humanCrawler.line(
    "Then why are the soldiers so sure it's elves? Lori said they were. Sgt. Kessler runs Blackwood Lodge. Let's go and ask him what he's actually found.",
  ),
];

// ── Blackwood Lodge ───────────────────────────────────────────────────────

/**
 * Kessler shows the fur and says he is opening the lid to drag an elf up;
 * Belle smells that what is down there is not elves, before anyone sees it.
 */
export function kesslerShowsFur(kessler: LineBuilder): NonEmpty<DialogLine> {
  return [
    kessler.line(
      "We found these tied to the underside of the cellar lid: tufts of cat fur, wound up with thread. That's elf work. They live in the cistern under this lodge, close enough to tie things to my floor. I'm opening it, and one of them is coming up to answer for the cats.",
    ),
    belle.line("Wait. Something under there smells wrong. Old and rotten. That isn't elves."),
    kessler.line('Stand back.'),
  ];
}

/** Said once the lid is up: what is climbing out of the shaft, and that the party holds it. */
export function cellarShaftClimbing(kessler: LineBuilder): NonEmpty<DialogLine> {
  return [
    narrator.line(
      'Cold air rolls up out of the shaft, and with it a smell like an opened grave. Far below, something is climbing the iron rungs. More than one. Behind them, pale heads with nothing under them come rising up the middle of the shaft.',
    ),
    kessler.line('Ghouls! And floating heads! Up out of the deep cistern!'),
    humanCrawler.line('Then we hold the hole. Nothing gets out past that lid.'),
  ];
}

/**
 * Said once the elves are through the lodge's front door: why they came in
 * from the alley rather than up the shaft, and that they are on the party's side.
 */
export function elvesComeInFromTheAlley(kessler: LineBuilder): NonEmpty<DialogLine> {
  return [
    narrator.line(
      'The lodge door bangs open. Three elves run in from the alley, soaked to the knee, knives already out.',
    ),
    CELLAR_ELF.line(
      "We're the elves who live in the drains under this lodge. We never took a cat. We're here to help you. That bar on the lid was all that kept the ghouls and the floating heads under the hill. Now the lid is open, they will climb out into the lodge, and then the town. They're all over the ladder, so we couldn't come up the shaft. We ran round through the alley drain instead. Help us keep them in the hole.",
    ),
    kessler.line('…Fine. Hold the hole!'),
  ];
}

/** The elves let the lid down once the last ghoul and floating head is dead, before the elf explains the fur. */
export const CELLAR_LID_LET_DOWN: NonEmpty<DialogLine> = [
  narrator.line('The elves heave the lid down over the shaft and drop the bar back across it.'),
];

/** After the cellar holds: what the fur was. */
export const CELLAR_ELF_EXPLAINS: NonEmpty<DialogLine> = [
  CELLAR_ELF.line(
    "The ghouls come up from old ruins deep under the hill, and the floating heads rise up after them. Down in the drains, we fight them back every night. Up here, only that barred lid stopped them. The fur you found is from our own cats. They went up into the town at night, the way cats do, and never came back. Whatever took yours took ours too. We tie a little of their fur under the lid as an offering. It's the highest place we can reach, where Caroline might see it. We hope she sends them home. We know every drain under this town. If you ever need us, come to the cellar lid and ask for me.",
  ),
  belle.line(
    "Every cat in town is gone now except one. Penny, the General Store's calico. At dusk she sits out on the store's step.",
  ),
  humanCrawler.line(
    "Then that's where it comes next. It's getting dark. Let's hide near the store and watch her.",
  ),
  belle.line(
    "And when it comes, we don't fight it. We stay out of sight and follow it, all the way to wherever it takes the cats.",
  ),
];

// ── The stakeout and the chase ────────────────────────────────────────────

/**
 * Said the first time the thief sees a crawler in the open and turns away:
 * the stakeout is about watching unseen, and being seen only costs a wait.
 */
export const THIEF_FIRST_SPOTTED: NonEmpty<DialogLine> = [
  belle.line('I think it saw us. We scared it off.'),
  humanCrawler.line(
    "It'll come back for Penny. We have to watch from somewhere it can't see us. Let's get into one of those hiding spots and keep still.",
  ),
];

/** Said over the steered crawler's head each later time it sees the party and turns away. */
export const THIEF_SPOTTED_AGAIN = {
  human: humanCrawler.bark('It saw us again. Back into hiding.'),
  cat: belle.bark('It saw us! Hide, hide!'),
} as const satisfies Record<'human' | 'cat', BarkLine>;

/** Said as it lifts off with Penny: the chase is a follow, not a fight. */
export const THIEF_TOOK_PENNY: NonEmpty<DialogLine> = [
  belle.line("It's got Penny! After it!"),
  humanCrawler.line(
    "Follow it, but don't try to catch it. Keep it in sight over the roofs and see where it lands. That's where the cats are going.",
  ),
];
/** Announced while it waits on a roof for the party to catch up. */
export const THIEF_WAITING = 'It has landed on a rooftop.';
/** Announced when it comes down on the temple. */
export const THIEF_LANDED = 'It landed on the dome of the Temple of the Sky.';

/** Said once it is down on the temple: whose roof that is, and what the party carries that could match it. */
export const THIEF_LANDED_REMARK: NonEmpty<DialogLine> = [
  belle.line('It went down on the temple dome. Did you see those wings? Big and grey.'),
  humanCrawler.line(
    "Grey, like the feather from the mill. Deacon Aviel keeps that temple, and he's Hawkfolk. Let's show him the feather and see what he says.",
  ),
];

// ── The temple ────────────────────────────────────────────────────────────

/** Aviel turns away a party without the feather. */
export const AVIEL_NO_FEATHER: NonEmpty<DialogLine> = [
  aviel.line(
    'I have nothing to say to you. Feathers fall all over this town, and nobody can say whose wing one came from.',
  ),
];

/** The feather against the one on the dais, and his confession. */
export const AVIEL_CONFESSION: NonEmpty<DialogLine> = [
  narrator.line(
    'A grey feather lies on the altar, an exact match for the one you found at the mill. Aviel looks at the two of them for a long time.',
  ),
  aviel.line(
    'Yes. It was I who took them. Hear me out before thou dost judge me. Taloncrest was once a great city. In one night, long ago, the ground under it split open, and the streets fell into ruin. My people flew everyone we could out of it, up to this hill. I could not lift them all. Our faith bids me remember every name I left behind, and I read those names in this temple every seventh day. The Warden, who rules from the tower, sent me word that it could bring those people back. It said it needed cats to do it. So I took the cats from their homes by night and flew them up to the tower. I did not ask what it wanted with them. The cats are up there still, and whatever the Warden means to do with them, it has not done it yet. It is waiting for one more cat, and it asked for thy cat by name.',
  ),
];

/** The choice itself, asked once the confession is heard. */
export const AVIEL_CHOICE_PROMPT: NonEmpty<DialogLine> = [
  aviel.line(
    'The High Roost, the council of my people, will want to know what I have done. Wilt thou tell them?',
  ),
];

export const AVIEL_CHOICE_LABELS = {
  exposed: 'Tell the High Roost',
  kept: 'Keep his secret',
} as const satisfies Record<AvielChoice, string>;

/** Said once Aviel has told the plan: it puts Belle in the Warden's hands, so Dave hears it first. */
const TELL_DAVE_FIRST = [
  humanCrawler.line(
    "Before we sit Belle on that fountain, I want Dave to hear this. He's been on this floor longer than anyone.",
  ),
  belle.line("He'll be at the Sleeping Cat Inn. Let's go and tell him."),
] as const;

/** What Aviel says once the party has chosen. */
export const AVIEL_AFTER_CHOICE = {
  exposed: [
    aviel.line(
      'Then they will clip my wings, and I shall walk from now on. The Roost will send another hawk to fly in my place. The Warden is expecting thy cat. Sit her on the plaza fountain at dusk, and that hawk will pretend to carry her off. Follow them, and thou wilt see where the cats are kept.',
    ),
    ...TELL_DAVE_FIRST,
  ],
  kept: [
    aviel.line(
      'Then I owe thee a carry, and I shall pay it now. The Warden is expecting thy cat. Sit her on the plaza fountain at dusk, and I will pretend to carry her off. Follow us, and thou wilt see where the cats are kept.',
    ),
    ...TELL_DAVE_FIRST,
  ],
} as const satisfies Record<AvielChoice, NonEmpty<DialogLine>>;

// ── The bait ──────────────────────────────────────────────────────────────

/** The party brings Dave up to date, which is what his story answers. */
export const DAVE_HEARS_THE_PLAN = narrator.line(
  () => `${crawlerDisplayName('human')} and Belle tell Dave everything that is going on.`,
);

/** Belle volunteers, once Dave has begged the party to find another way. */
export const BELLE_VOLUNTEERS: NonEmpty<DialogLine> = [
  belle.line(
    "Dave's scared for me. That's sweet. But the cats are up there right now, and this is the only way in we've got. So I'll do it. I sit on the fountain at dusk, the carrier pretends to take me, and you follow us to wherever the cats are.",
  ),
];

// ── The capture at the fountain ───────────────────────────────────────────

/** Who flies in to make a show of taking Belle, by what the party chose to do with Aviel's secret. */
function carrier(choice: AvielChoice): LineBuilder {
  return choice === 'kept' ? aviel : ROOST_HAWK;
}

/** The carrier settles on the fountain's rim and the pretence starts. */
export const CAPTURE_PRETENCE = {
  kept: [
    aviel.line(
      'Hold still. I shall fly thee up to the tower as if I were delivering thee. Thy friend will follow whoever comes to take thee from me.',
    ),
    belle.line('Make it look real.'),
  ],
  exposed: [
    ROOST_HAWK.line(
      "Hold still, little one. I'll fly you up to the tower for whoever is watching. Your friend will follow whoever comes to take you from me.",
    ),
    belle.line('Make it look real.'),
  ],
} as const satisfies Record<AvielChoice, NonEmpty<DialogLine>>;

/** Thrown off the fountain, the carrier sees what the plan walked into. */
export function captureSprung(choice: AvielChoice): NonEmpty<DialogLine> {
  const voice = carrier(choice);
  return choice === 'kept'
    ? [voice.line('They knew! They were waiting for us before I ever left the dome.')]
    : [voice.line('They were waiting for us. The tower knew we were coming.')];
}

/** Said to Belle as she is carried off: the plan was the Warden's before it was hers. */
export const CAROLINE_TO_TAKEN_BELLE: CarolineMessage = carolineLines.message(
  'Belle. The Warden prepared for this plan before you made it. You are being carried to the top of the tower. It needs you alive, so you will arrive alive.',
);

/** The "Meanwhile…" card the split opens behind, on Belle in her cage. */
export const CAPTURED_CARD_TITLE = 'The top of the tower';
export const SPLIT_CARD_KICKER = 'Meanwhile…';
/** The card the human's side of the split opens behind, back on the street under the tower. */
export const HUMAN_SIDE_CARD_TITLE = 'The street below';

// ── The tower, two sides ──────────────────────────────────────────────────

/** Pumpkin, before she has given Belle her name. */
const NEIGHBORING_CAT = speakerLines('tower_cattery_cellmate');

/** Belle wakes in her cage at the top of the tower, and the cat in the next cage speaks up. */
export const BELLE_MEETS_PUMPKIN: NonEmpty<DialogLine> = [
  belle.line('Where am I?'),
  NEIGHBORING_CAT.line(
    'These dimwits have been taking all the cats in town. You must be new; my name is Pumpkin.',
  ),
  belle.line('Pumpkin?!?!'),
  pumpkin.line("Yes? That's a beautiful name, I'll have you know."),
  belle.line(
    () =>
      `I know of you! I know Dave. He has been helping me and my human, ${crawlerDisplayName('human')}, ever since Caroline decided to put us on this crazy adventure.`,
  ),
  pumpkin.line(
    'Dave? He is alive? They told me they killed him because he broke into the tower. They brought me his sword as proof. It was definitely his; it had his scent, and he would never give up his sword.',
  ),
  belle.line("Why haven't you gone back to him?"),
  pumpkin.line(
    "They clip all of our claws when we're taken in, and they cut them every few days so they never grow back. None of us here can get through the locks without our claws, and the locks have magical protection.",
  ),
  belle.line(
    "They haven't clipped my claws. They took me in a rush, instead of ambushing me in the night like everyone else. I think I can get us out.",
  ),
];

/** Belle at the cattery's stair with Pumpkin still shut in her cage. */
export const BELLE_FREES_PUMPKIN_FIRST: BarkLine = belle.bark('I better free Pumpkin while I can.');

/** Belle and her cellmate come down into the archive while its wards still burn, and hide. */
export const ARCHIVE_WARDS_BURN_SOLID: NonEmpty<DialogLine> = [
  narrator.line(
    'Red lines of light stand across every doorway of the archive, and something with no body drifts between the shelves.',
  ),
  pumpkin.line('Not through that. It bites. We wait under the shelf.'),
  belle.line('Wait for what?'),
  pumpkin.line('For it to go dim. It does, sometimes. Someone turns the water off.'),
];

/**
 * Back on the archive with the conduit shut: what is dangerous here and that
 * there may be a way past it, never the way itself. The room's own fittings
 * teach the rest.
 */
export const ARCHIVE_WARDS_EXPLAINED: NonEmpty<DialogLine> = [
  belle.line('The red lines are flickering now. Someone must have turned the water off.'),
  pumpkin.line('Flickering still bites. Not while it burns bright.'),
  belle.line(
    'The stair down is in the west room, behind more of those lines. And that head is in there.',
  ),
  pumpkin.line(
    "The archive's keeper. If its light finds us, it chases us back up the stairs. It only leaves that room to fetch whatever comes up the dumbwaiter.",
  ),
  belle.line('Those keys on the shelf over the dumbwaiter... someone down below could use them.'),
];

/** The key ring Belle batted off its shelf goes down to the human: what just happened, and why it matters. */
export const KEY_RING_SENT_DOWN: NonEmpty<DialogLine> = [
  narrator.line(
    () =>
      `The key ring drops into the dumbwaiter and rattles all the way down the shaft to the kitchen, where ${crawlerDisplayName('human')} can reach it.`,
  ),
];

/** The card the archive chapter opens behind, once the conduit is shut. */
export const ARCHIVE_CARD_TITLE = 'The warded archive';
export const ARCHIVE_CARD_TIP =
  'The red lines are wards, and something floats between the shelves. Watch both before you move.';
/** The card the gatehouse chapter opens behind, once the key ring has gone down. */
export const GATEHOUSE_CARD_TITLE = 'The gatehouse';
export const GATEHOUSE_CARD_TIP =
  "The tower guards don't hit. If they catch you, they walk you back to the cellar stair.";
/** The card the bell storey chapter opens behind, once the tuna has gone up. */
export const BELL_STOREY_CARD_TITLE = 'The bell storey';
export const BELL_STOREY_CARD_TIP =
  'Pumpkin has been fed. She will sit where Belle needs her, for a while.';
/** The card the party comes back together behind, at the top of the kitchen stair. */
export const REUNION_CARD_KICKER = 'The bell storey';
export const REUNION_CARD_TITLE = 'The portcullis is up';
export const REUNION_CARD_TIP = 'Someone is coming up the kitchen stair.';
/** The card the climb opens behind once the party is whole again. */
export const ASCENT_CARD_KICKER = 'The tower';
export const ASCENT_CARD_TITLE = 'Up together';
export const ASCENT_CARD_TIP =
  'The wards upstairs sweep back and forth now, and only Belle can see them. Break the glowing stones that power them.';

/** Why a stair will not take whoever is playing the split's chapter: it leads off their side. */
export const SPLIT_STAIR_REFUSALS = {
  keyRingFirst: 'Not yet. Someone down in the kitchen needs those keys by the dumbwaiter.',
  sluiceFirst: 'The wards upstairs are still powered. Close the sluice in the cistern first.',
  portcullisBelow:
    'That stair only leads up to the portcullis over the kitchen, and the portcullis is shut.',
} as const;

/** The human opens the larder with the key ring and works out who to ask next. */
export const LARDER_OPENED_REMARK: NonEmpty<DialogLine> = [
  humanCrawler.line(
    "Shelves of stores, and a chain running up through the ceiling. Whoever sent these keys down is still up there. The dumbwaiter has a bell. I'll ring it and see what they send back.",
  ),
];

/** The human reads the cellmate's note: what it asks for, and where to get it. */
export const CELLMATE_NOTE_READ = {
  wantsTuna: [
    humanCrawler.line(
      "No words. Just a paw print, and it reeks of fish. A cat sent that key ring down, and she's hungry. The General Store sells tinned tuna. I'll buy a tin and send it up the dumbwaiter. The front door downstairs is the quickest way out, if I can talk my way past the guards.",
    ),
  ],
  tunaInHand: [
    humanCrawler.line(
      "No words. Just a paw print, and it reeks of fish. A cat sent that key ring down, and she's hungry. Good thing I've got a tin of tuna. Up the dumbwaiter it goes.",
    ),
  ],
} as const satisfies Record<string, NonEmpty<DialogLine>>;

/** The human, as each other step of the kitchen comes up: what he does next, and why. */
export const KITCHEN_REMARKS = {
  keyRingInDumbwaiter: [
    humanCrawler.line(
      "Something's sitting in the dumbwaiter hatch. Keys? Somebody upstairs sent them down. I'll take them.",
    ),
  ],
  keyRingInHand: [
    humanCrawler.line(
      "One key is stamped LARDER. That's the door in the south wall. Somebody wants me in there.",
    ),
  ],
  bellRung: [
    humanCrawler.line(
      "That'll carry up the shaft. I'll wait by the hatch and see what comes down.",
    ),
  ],
  noteInDumbwaiter: [humanCrawler.line('Something just came down the dumbwaiter. An answer.')],
  tunaSent: [
    humanCrawler.line(
      "Up it goes. Eat it, whoever you are, and let go of that portcullis. I'll wait by the stair.",
    ),
  ],
} as const satisfies Record<string, NonEmpty<DialogLine>>;

/** Why a kitchen fitting does nothing yet: the larder is shut until its key is in hand. */
export const LARDER_LOCKED_NOTICE =
  'The larder is locked. Its key is on the ring in the dumbwaiter.';

/** Why a kitchen fitting does nothing yet, with the step that comes first. */
export function kitchenNotYetNotice(objective: string): string {
  return `Not yet. ${objective}.`;
}

/** A tower guard, somewhere off the screen, has half seen someone. */
export const TOWER_GUARD_NOTICES = 'A tower guard stops and looks';

/** The human comes up through the raised portcullis onto the bell storey. */
export const REUNION: NonEmpty<DialogLine> = [
  belle.line("You're here. You're really here!"),
  humanCrawler.line("Are you okay? Did they hurt you? I didn't know if you were even—"),
  belle.line("I'm okay! I'm okay. Stop looking at me like that. I'm okay."),
  humanCrawler.line("I thought I'd lost you."),
  belle.line("You can't lose me. I always come back. That's the whole saying."),
  humanCrawler.line(
    'Then who sent a key ring down the dumbwaiter? And a note that smelled like fish?',
  ),
  pumpkin.line('Me. The tuna was good.'),
  belle.line(
    "This is Pumpkin. She was in the cage next to mine. They clipped her claws, so she can't open a latch, but if you feed her she'll sit on anything.",
  ),
  pumpkin.line('Anything.'),
  belle.line(
    "Okay. Business. The Warden is at the top of the tower with the other cats, and it knows we're inside now.",
  ),
  belle.line(
    "The red lines up there move around now, and I'm the only one who can see them. So stay close and do what I say. For once.",
  ),
  pumpkin.line('I am coming. You have more tuna.'),
];

// ── Getting in ────────────────────────────────────────────────────────────

/** The cellar elf, asked for the help it offered once the cellar held. */
export const CELLAR_ELF_OFFERS_THE_DRAIN: NonEmpty<DialogLine> = [
  CELLAR_ELF.line(
    "They took your cat to the tower, and its front door won't open for you. But we know the drains. We've lived down there since the Fraying, and the old drains run right under the tower. There's a storm-drain grate on the Civic Terrace, near the foot of the tower. I'll meet you there. Bring someone who can fight. Don't come down alone. If you have nobody to bring, the Barracks lends out fighters. I will send word to the desk that you are coming.",
  ),
];

/** The elf at the grate, to a human with nobody beside them. */
export const CELLAR_ELF_WANTS_A_PARTNER: NonEmpty<DialogLine> = [
  CELLAR_ELF.line(
    "Not alone. The Barracks lends out fighters. Ask at the desk, and tell them where you're going.",
  ),
];

/** The elf opens the grate for a human who has brought someone. */
export const CELLAR_ELF_OPENS_THE_GRATE: NonEmpty<DialogLine> = [
  narrator.line(
    'The elf reaches under the grate, works its bolts loose and heaves it up. Cold air rises out of the dark, with the sound of running water.',
  ),
  CELLAR_ELF.line('Stay behind me. Down there, the water decides where you can walk.'),
];

/** What the town's guards and talk say to steer a human looking for a way in. */
export const TOWER_DOOR_SEEKER_HINT =
  "The tower guards won't open the door. The cellar elf at Blackwood Lodge said to ask if you ever needed help.";

/** Sydney's lines when she lends a hire for the tower at no charge. */
export const SYDNEY_TOWER_LOAN = {
  greeting: '"The elves told me where you\'re headed. Take one fighter, no charge."',
  signed: (name: string): string => `"${name} goes with you, free. Bring them back safe."`,
} as const;

// ── The aftermath ─────────────────────────────────────────────────────────

/** The bound cats, let go, run for the stairs. */
export const CATS_WALK_OUT: NonEmpty<DialogLine> = [
  narrator.line(
    'With the circle dark, the cats that were held in it get up, shake themselves, and trot down the stairs one after another without looking back.',
  ),
  belle.line('They know the way home. Biscuit will be heading for the inn.'),
  humanCrawler.line(
    'Then so are we. Ossie will want to see her, and Dave should hear how this ended.',
  ),
];

/** Pumpkin walks into the taproom while Dave is in it. */
export const PUMPKIN_WALKS_IN: NonEmpty<DialogLine> = [
  narrator.line(
    'A long-haired tortoiseshell noses the taproom door open and walks in as if she has been out for an hour.',
  ),
  dave.line('…Pumpkin?'),
  pumpkin.line('You got old.'),
  dave.line(
    'They showed me your fur and your claws and told me I was too late. I believed them. I never went back up to make sure.',
  ),
  pumpkin.line('They brought me your sword. They said you were dead. I believed them too.'),
  dave.line(
    "I filled your bowl every night for a month anyway. Then I stopped. I'm sorry I stopped.",
  ),
  pumpkin.line('They cut my claws every few days. I could not open one lock. I tried every one.'),
  dave.line('A cat always comes back.'),
  narrator.line(
    'She walks the length of the bar, steps down into his lap and turns round twice. He does not move for a long time.',
  ),
];

/** What Pumpkin says, one a press, once she lives in the taproom. */
export const PUMPKIN_AT_HOME_LINES: NonEmpty<DialogLine> = [
  pumpkin.line('Is there tuna?'),
  pumpkin.line('This chair is mine now.'),
  pumpkin.line('He snores. It is fine.'),
  pumpkin.line('My claws are growing back. Slowly.'),
  pumpkin.line('The door is shut. I could open it now. I am not going to.'),
];

/** The questline's quote on its reward screen. */
export const MISSING_CATS_REWARD_QUOTE = {
  text: 'A cat always comes back.',
  speaker: 'Dave',
} as const satisfies NonNullable<QuestRewardSpec['quote']>;
