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
import type { DialogLine, LineBuilder, NonEmpty } from '../../line';
import type { AvielChoice } from '../../../core/quests/missingCatsProgress';
import { carolineLines, type CarolineMessage } from '../../caroline';

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
      "Biscuit's gone. She's our cat, the fat ginger one who sleeps on the end of the bar. It's been three nights, and she's never missed a supper in her life.",
    ),
    ossie.line(
      "And it isn't just her. Nearly every cat in town has gone missing this month. Every owner put a notice up on the board in the Market Plaza, saying what they know. Read them. Maybe you'll make more of it than we have.",
    ),
    dave.line('A cat always comes back.'),
    dave.line('…Usually.'),
  ];
}

// ── The owners ────────────────────────────────────────────────────────────

export const LORI_OWNER: NonEmpty<DialogLine> = [
  lori.line(
    "Thimble's gone, dearie. She went out through the little window up by the fireplace. I latched it before bed, and in the morning it was standing open.",
  ),
  lori.line('Go and look under it. Then tell me who could reach a window that high.'),
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

/** Read off the plaza board: the notices that say something odd, and the trace only Belle can follow. */
export const NOTICES_READ: NonEmpty<DialogLine> = [
  humanCrawler.line("Most of these only say the cat's gone. Three of them say something odd."),
  humanCrawler.line(
    "Old Lori's went out a window nobody could reach. Baggi at Herb & Remedy found a dish of fish nobody put out. Marta's went missing from inside a bolted mill. Let's ask them.",
  ),
  belle.line(
    "And Biscuit is the inn's cat. If she went out the front door, her scent will still be on the street. Take me to the inn's step and I'll find it.",
  ),
];

// ── The things in the rooms ───────────────────────────────────────────────

export const LATCH_EXAMINED: NonEmpty<DialogLine> = [
  narrator.line(
    "The window's iron latch lies on the floor under it, sawn clean in two. Someone cut through it from outside.",
  ),
  lori.line(
    "The soldiers say an elf climbed up and did that. But I've looked at the herb bed under that window outside, dearie. Not one footprint, not one ladder mark.",
  ),
  lori.line("Whatever came for Thimble didn't climb."),
];

export const TUNA_DISH_EXAMINED: NonEmpty<DialogLine> = [
  narrator.line(
    'A clay saucer on the floor under the window, with the last of some tinned tuna dried onto it. Baggi and Fen never buy tuna, so somebody brought it in.',
  ),
  belle.line("That's tinned tuna. The General Store sells it."),
  humanCrawler.line(
    "Then the store's order book should say who's been buying it. Let's go and read it.",
  ),
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
    "A window opened from above. A feather bigger than any bird's. A scent that stops in open ground. And tuna from the tower's own order.",
  ),
  belle.line("Whatever took them came down out of the sky. That isn't an elf."),
  humanCrawler.line(
    "Then why are the soldiers so sure it's elves? Lori said they were. Sgt. Kessler runs Blackwood Lodge. Let's go and ask him what he's actually found.",
  ),
];

// ── Blackwood Lodge ───────────────────────────────────────────────────────

/** Kessler shows the fur and opens the lid. */
export function kesslerShowsFur(kessler: LineBuilder): NonEmpty<DialogLine> {
  return [
    kessler.line(
      "We found these tied to the cellar lid: tufts of cat fur, wound up with thread. That's elf work. There are elves living down there under the lodge, and I'm opening it. Stand back.",
    ),
  ];
}

/** After the cellar holds: what the fur was. */
export const CELLAR_ELF_EXPLAINS: NonEmpty<DialogLine> = [
  CELLAR_ELF.line("That fur is from our own cats. They've been taken too, the same as yours."),
  CELLAR_ELF.line(
    'We tie a little of their fur at the lid, where the light comes down, as an offering. We hope Caroline sees it and sends them home.',
  ),
  CELLAR_ELF.line(
    'Ours went up into the town at night, the way cats do, and never came down again.',
  ),
  CELLAR_ELF.line('If you ever need us, come to the cellar lid and ask for me.'),
  belle.line(
    "Every cat in town is gone now except one. Penny, the calico who sits on the General Store's step.",
  ),
  humanCrawler.line(
    "Then that's where it comes next. It's getting dark. Let's hide near the store and watch her.",
  ),
];

// ── The stakeout and the chase ────────────────────────────────────────────

/** Announced when the thief sees a crawler in the open and turns away. */
export const THIEF_SAW_YOU = 'It spotted you and flew off. Stay hidden and it will come back.';
/** Announced the moment it takes the cat. */
export const THIEF_SWOOPED = 'It took Penny! Follow it.';
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
    "When the Fraying came, we carried everyone we could. I couldn't lift them all. Our teaching says to remember every name I couldn't lift, and I do.",
  ),
  aviel.line(
    'The Warden told me those people could be brought back, and that it needed cats to do it. So I carried the cats up to the tower. I never asked why.',
  ),
  aviel.line('Now it wants one more. It asked for your cat.'),
];

/** The choice itself, asked once the confession is heard. */
export const AVIEL_CHOICE_PROMPT: NonEmpty<DialogLine> = [
  aviel.line('The High Roost will want to know what I did. Are you going to tell them?'),
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
      "Then they'll clip my wings, and I'll walk from now on. The Roost will send another hawk to fly in my place.",
    ),
    aviel.line(
      'The Warden is expecting your cat. Sit her on the plaza fountain at dusk, and the hawk can pretend to carry her off. Follow, and you will see where the cats are kept.',
    ),
    ...TELL_DAVE_FIRST,
  ],
  kept: [
    aviel.line("Then I owe you a carry, and I'll pay it now."),
    aviel.line(
      'The Warden is expecting your cat. Sit her on the plaza fountain at dusk, and I will pretend to carry her off. Follow us, and you will see where the cats are kept.',
    ),
    ...TELL_DAVE_FIRST,
  ],
} as const satisfies Record<AvielChoice, NonEmpty<DialogLine>>;

// ── The bait ──────────────────────────────────────────────────────────────

/** Belle volunteers, once Dave has refused. */
export const BELLE_VOLUNTEERS: NonEmpty<DialogLine> = [
  belle.line(
    "Then I'll do it. I sit on the fountain at dusk, the carrier pretends to take me, and you follow us to wherever the cats are.",
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
      "Hold still. I'll fly you up to the tower as if I were delivering you. Your friend will follow whoever comes to take you from me.",
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

/** Belle and her cellmate come down into the archive while its wards still burn, and hide. */
export const ARCHIVE_WARDS_BURN_SOLID: NonEmpty<DialogLine> = [
  narrator.line(
    'Lines of pale light stand across the archive from wall to wall, and something with no body drifts between the shelves.',
  ),
  pumpkin.line('not through that. it bites. we wait under the shelf.'),
  belle.line('Wait for what?'),
  pumpkin.line('for it to go dim. it does, sometimes. someone turns the water off.'),
];

/** The card the archive chapter opens behind, once the conduit is shut. */
export const ARCHIVE_CARD_TITLE = 'The warded archive';
export const ARCHIVE_CARD_TIP =
  'The wards are pulsing now. Belle can see where they run, and when they go dark.';
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
  keyRingFirst:
    'Not yet. Knock the key ring into the dumbwaiter first. Someone in the kitchen needs it.',
  sluiceFirst: 'The wards upstairs are still powered. Close the sluice in the cistern first.',
  portcullisBelow:
    'That stair only leads up to the portcullis over the kitchen, and the portcullis is shut.',
  cellmateFirst: 'From the next cage: “let me out first. the latch is on your side.”',
} as const;

/** A tower guard, somewhere off the screen, has half seen someone. */
export const TOWER_GUARD_NOTICES = 'A tower guard stops and looks';

/** The human comes up through the raised portcullis onto the bell storey. */
export const REUNION: NonEmpty<DialogLine> = [
  belle.line('You came up through the kitchen.'),
  humanCrawler.line(
    'Somebody sent a key ring down the dumbwaiter. Then a note with a paw print on it that smelled of fish.',
  ),
  pumpkin.line('the note was me. the tuna was good.'),
  belle.line(
    'This is Pumpkin. She was in the cage next to mine. She opens latches, and she sits on things if you feed her.',
  ),
  belle.line(
    "The Warden is at the top of the tower, with the cats it's still holding. It knows we're inside now. The wards up there move, and I'm the only one who can see them.",
  ),
  pumpkin.line('i am coming. you have more tuna.'),
];

// ── Getting in ────────────────────────────────────────────────────────────

/** The cellar elf, asked for the help it offered once the cellar held. */
export const CELLAR_ELF_OFFERS_THE_DRAIN: NonEmpty<DialogLine> = [
  CELLAR_ELF.line(
    "They took your cat to the tower, and its front door won't open for you. But we know the drains. We've lived down there since the Fraying, and the old drains run right under the tower.",
  ),
  CELLAR_ELF.line(
    "There's a storm-drain grate on the Civic Terrace, near the foot of the tower. I'll meet you there. Bring someone who can fight. Don't come down alone.",
  ),
  CELLAR_ELF.line(
    'If you have nobody to bring, the Barracks lends out fighters. I will send word to the desk that you are coming.',
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
  greeting:
    '"The elves sent word you\'re going under the tower. For that, the desk lends you one fighter, free of charge. Pick a file."',
  signed: (name: string): string =>
    `"${name} is lent to you for the tower, no fee. Bring them back if you can."`,
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
  pumpkin.line('you got old.'),
  dave.line(
    'I sat at the bottom of those stairs for three days. Then I told myself you were dead. It was easier than you being up there with nobody coming.',
  ),
  pumpkin.line('i came down. you were gone.'),
  dave.line(
    "I left your bowl on the bottom step every night for a month. Then I stopped. I'm sorry I stopped.",
  ),
  pumpkin.line('they fed me. i kept walking out.'),
  dave.line('A cat always comes back.'),
  narrator.line(
    'She walks the length of the bar, steps down into his lap and turns round twice. He does not move for a long time.',
  ),
];

/** What Pumpkin says, one a press, once she lives in the taproom. */
export const PUMPKIN_AT_HOME_LINES: NonEmpty<DialogLine> = [
  pumpkin.line('is there tuna.'),
  pumpkin.line('this chair is mine now.'),
  pumpkin.line('he snores. it is fine.'),
  pumpkin.line('i was not lost. i knew where i was.'),
  pumpkin.line('the door is shut. i could open it. i am not going to.'),
];

/** The questline's quote on its reward screen. */
export const MISSING_CATS_REWARD_QUOTE = {
  text: 'A cat always comes back.',
  speaker: 'Dave',
} as const;
