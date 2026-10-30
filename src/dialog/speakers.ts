/**
 * Every recurring speaker in the game: who they are, what they look like,
 * how their voice is played, and how their text is cased.
 *
 * A `DialogLine` never carries a speaker's name as a string — it carries a
 * `SpeakerRef`, which is either a fixed entry in {@link SPEAKERS} (a named
 * cast member) or a `transient` speaker built at runtime from a
 * {@link TransientStyleId} preset (a townsperson, a sign, a narrated caption —
 * anyone whose name can't be a compile-time union member).
 */

import type { SoundId } from '../audio/sounds';
import type { PortraitSource, ResolvedSpeaker, RevealMode } from '../ui/DialogBox';
import { ratkinPortrait } from '../sprites/ratkinPortrait';
import type { RatkinCastId } from '../sprites/art/ratkin/cast';
import { crawlerDisplayName } from '../characters/characters';
import { motion } from '../ui/theme/tokens';
import type { CarolineSpeakerRef } from './caroline';

/** How a speaker's text is cased when it's drawn — a written-in rule instead of an author convention to remember. */
export type TextCase = 'as-written' | 'upper' | 'lower';

/**
 * The face a speaker's words are set in: the UI face, or a terminal face for a
 * voice that is meant to read as a machine. Omitted means `'ui'`.
 */
export type SpeakerTypeface = 'ui' | 'terminal';

/**
 * The box a speaker's words are drawn in: the ordinary dialog box, or
 * Caroline's terminal frame. Decided by the kind of `SpeakerRef`, so only a
 * line made by `carolineLines` can wear `caroline`.
 */
export type SpeakerSkin = 'standard' | 'caroline';

/**
 * How a speaker sounds while their text reveals.
 *   'typing'    → the shared typing-click sound, once per revealed token
 *   'wordTicks' → one of the speaker's own ticks as each word starts revealing,
 *                 for a letter-by-letter reveal too fast to click per letter
 *   'clips'     → one of the speaker's own voice clips, once per DialogLine
 *   'silent'    → no sound at all
 */
export type SpeakerVoice =
  | { readonly kind: 'typing' }
  | { readonly kind: 'wordTicks'; readonly sounds: ReadonlyArray<SoundId> }
  | { readonly kind: 'clips'; readonly sounds: ReadonlyArray<SoundId> }
  | { readonly kind: 'silent' };

/** Milliseconds between revealed elements for ordinary speech — matches the typing-click sound's length. */
export const SPEECH_REVEAL_INTERVAL_MS = 100;

/** A sign is a few words to glance at, not speech to listen to, so it reveals about four times faster than a citizen. */
export const SIGN_REVEAL_INTERVAL_MS = 25;

/** A ratkin's chatter stands in for a voice actor for every Briar Hollow villager. */
const RATKIN_VOICE_SOUNDS: ReadonlyArray<SoundId> = [
  'ratkin_chatter_1',
  'ratkin_chatter_2',
  'ratkin_chatter_3',
  'ratkin_chatter_4',
  'ratkin_chatter_5',
  'ratkin_chatter_6',
];

/** A Hawkfolk citizen's voice when a conversation opens: throaty chatter, never the hostile Hawkfolk's squawk. */
const HAWKFOLK_CITIZEN_VOICE_SOUNDS: ReadonlyArray<SoundId> = [
  'hawkfolk_chatter_1',
  'hawkfolk_chatter_2',
];

/** Slower and deeper: temple keepers and clerks. */
const HAWKFOLK_ELDER_VOICE_SOUNDS: ReadonlyArray<SoundId> = [
  'hawkfolk_elder_chatter_1',
  'hawkfolk_elder_chatter_2',
  'hawkfolk_elder_chatter_3',
];

/** Bright peeping for Hawkfolk children. */
const HAWKFOLK_FLEDGLING_VOICE_SOUNDS: ReadonlyArray<SoundId> = ['hawkfolk_fledgling_chirp_1'];

/** Wordless murmurs, so no line of dialog is ever contradicted by the audio. */
const HUMAN_MASCULINE_VOICE_SOUNDS: ReadonlyArray<SoundId> = [
  'townsfolk_hm_male_1',
  'townsfolk_hm_male_2',
  'townsfolk_hm_male_3',
  'townsfolk_hm_male_4',
  'townsfolk_hm_male_5',
];

const HUMAN_FEMININE_VOICE_SOUNDS: ReadonlyArray<SoundId> = [
  'townsfolk_hm_female_1',
  'townsfolk_hm_female_2',
  'townsfolk_hm_female_3',
  'townsfolk_hm_female_4',
];

/** A source a portrait can be painted from. Ratkin faces are the only source today; add a case here, never a raw string key, when another is needed. */
export type PortraitKey = { readonly source: 'ratkin'; readonly id: RatkinCastId };

/** The face behind a `PortraitKey`, painted when first drawn. Ratkin faces are the only source today; branch on `key.source` here when a second one exists. */
export function resolvePortrait(key: PortraitKey): PortraitSource {
  return ratkinPortrait(key.id);
}

/**
 * Who a speaker is credited as. `null` renders a nameless box, for a narrator
 * or a voice with no name to show; a function is a name not known until the
 * line is shown, such as the player's own.
 */
export type SpeakerName = string | null | (() => string);

export interface SpeakerDef {
  readonly name: SpeakerName;
  readonly portrait: PortraitKey | null;
  readonly voice: SpeakerVoice;
  readonly reveal: RevealMode;
  readonly textCase: TextCase;
  /** Milliseconds between revealed elements — {@link SPEECH_REVEAL_INTERVAL_MS} for ordinary speech. */
  readonly revealIntervalMs: number;
  readonly typeface?: SpeakerTypeface;
}

/** Typed with the exact name, never null, so code that names a villager outside the dialog box needs no fallback. */
function ratkinVillagerSpeaker<const Name extends string>(
  name: Name,
  id: RatkinCastId,
): SpeakerDef & { readonly name: Name } {
  return {
    name,
    portrait: { source: 'ratkin', id },
    voice: { kind: 'clips', sounds: RATKIN_VOICE_SOUNDS },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  };
}

/**
 * A poker regular at the Cloak & Dagger. Their banter shows as a bubble beside
 * their seat, but the dialog layer still credits and voices them like any
 * named cast member.
 */
function pokerRegularSpeaker<const Name extends string>(
  name: Name,
  voiceSounds: ReadonlyArray<SoundId>,
): SpeakerDef & { readonly name: Name } {
  return {
    name,
    portrait: null,
    voice: { kind: 'clips', sounds: voiceSounds },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  };
}

/**
 * Every speaker with a fixed, known-in-advance identity. A procedurally named
 * townsperson or a hand-lettered sign is not here — see {@link SpeakerRef}.
 */
export const SPEAKERS = {
  // Briar Hollow's seventeen named villagers, including its four soldiers.
  bramblewick: ratkinVillagerSpeaker('Mayor Bramblewick', 'bramblewick'),
  merrit: ratkinVillagerSpeaker('Merrit Roottail', 'merrit'),
  pipkin: ratkinVillagerSpeaker('Pipkin Paws', 'pipkin'),
  sella: ratkinVillagerSpeaker('Doctor Sella Morrowtail', 'sella'),
  vetch: ratkinVillagerSpeaker('Vetch Nibnose', 'vetch'),
  oren: ratkinVillagerSpeaker('Oren Ironwhisker', 'oren'),
  tikka: ratkinVillagerSpeaker('Tikka Geargrinder', 'tikka'),
  fenna: ratkinVillagerSpeaker('Fenna Splintertail', 'fenna'),
  garn: ratkinVillagerSpeaker('Garn Picknose', 'garn'),
  sedge: ratkinVillagerSpeaker('Sedge Quickclaw', 'sedge'),
  hobb: ratkinVillagerSpeaker('Hobb Greycloak', 'hobb'),
  marta: ratkinVillagerSpeaker('Marta Redwhisker', 'marta'),
  pru: ratkinVillagerSpeaker('Pru Bristleback', 'pru'),
  nella: ratkinVillagerSpeaker('Nella Softstep', 'nella'),
  cricket: ratkinVillagerSpeaker('Cricket Mudwhisk', 'cricket'),
  wicker: ratkinVillagerSpeaker('Wicker Longtooth', 'wicker'),
  midge: ratkinVillagerSpeaker('Midge Candleear', 'midge'),

  // The two Crawlers.
  human_crawler: {
    name: () => crawlerDisplayName('human'),
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /**
   * Belle's lines are short, simple and affectionate, and spelled correctly:
   * written speech impediments read as typos.
   */
  belle: {
    name: () => crawlerDisplayName('cat'),
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  /**
   * Pumpkin, Dave's lost cat: unhurried, unbothered, and interested in food
   * and doors and nothing else. Short sentences; no line of hers is excited.
   * Lowercased by rule, so a line written with a capital still reads as hers.
   */
  pumpkin: {
    name: 'Pumpkin',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'lower',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  dave: {
    name: 'Dave',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  recruiter: {
    name: 'Corporal Bristle',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  lich: {
    name: 'The Lich',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  // The Anchor questline.
  voss: {
    name: 'Madame Voss',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  lori: {
    name: 'Old Lori',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  aviel: {
    name: 'Deacon Aviel',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  // "The Borrowed Blueprints": the Plumbline Farm resident who holds Fenna's plans.
  wendell: {
    name: 'Wendell',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  shady: {
    name: 'Shady',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  // The Defend and Spider questlines.
  goblinMother: {
    name: 'Goblin Mother',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  bathroomPlumber: {
    name: 'Grubnik, Plumber',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  queueGoblin: {
    name: 'Goblin in Line',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  prisonGateGuard: {
    name: 'Snorgle, Gate Guard',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  prisonGuard: {
    name: 'Prison Guard',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  goblinPrisoner: {
    name: 'Prisoner',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  scientist: {
    name: 'Dr. Ignatius Moult',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  // The Town Center Tower's door and gatehouse.
  towerGuard: {
    name: 'Tower Guard',
    portrait: null,
    voice: { kind: 'clips', sounds: HUMAN_MASCULINE_VOICE_SOUNDS },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  // The Cloak & Dagger's blackjack table.
  deuce: {
    name: 'Deuce',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  // The Cloak & Dagger's Wheel of Fortune.
  donald: {
    name: 'Donald',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  // The Cloak & Dagger's Texas Hold'em regulars; names match `POKER_REGULARS`.
  pokerWren: pokerRegularSpeaker('Wren Halloway', HAWKFOLK_CITIZEN_VOICE_SOUNDS),
  pokerGrizzle: pokerRegularSpeaker('Grizzle Pott', HUMAN_MASCULINE_VOICE_SOUNDS),
  pokerOttoline: pokerRegularSpeaker('Lady Ottoline Fairweather', HAWKFOLK_CITIZEN_VOICE_SOUNDS),
  pokerPell: pokerRegularSpeaker('Sixfinger Pell', HAWKFOLK_CITIZEN_VOICE_SOUNDS),
  pokerDabney: pokerRegularSpeaker('Nervous Dabney', HAWKFOLK_ELDER_VOICE_SOUNDS),
  pokerCorvina: pokerRegularSpeaker('Corvina Lark', HAWKFOLK_ELDER_VOICE_SOUNDS),
  pokerReverend: pokerRegularSpeaker('The Reverend Snake-Eyes', HUMAN_MASCULINE_VOICE_SOUNDS),
  pokerMalloy: pokerRegularSpeaker('Odds Malloy', HUMAN_MASCULINE_VOICE_SOUNDS),
  pokerCrumb: pokerRegularSpeaker('Mother Crumb', HUMAN_FEMININE_VOICE_SOUNDS),
  pokerQuillfeather: pokerRegularSpeaker('Barnaby Quillfeather', HAWKFOLK_ELDER_VOICE_SOUNDS),
  pokerTuppence: pokerRegularSpeaker('Tuppence', HAWKFOLK_CITIZEN_VOICE_SOUNDS),
  pokerVane: pokerRegularSpeaker('Gristle Vane', HAWKFOLK_CITIZEN_VOICE_SOUNDS),
  pokerBrisket: pokerRegularSpeaker('Brisket Mulgrew', HUMAN_MASCULINE_VOICE_SOUNDS),
  pokerMags: pokerRegularSpeaker('Mags the Molt', HAWKFOLK_ELDER_VOICE_SOUNDS),

  // The Barracks Mercenaries' hires.
  crush: {
    name: 'Crush',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  hammerHands: {
    name: 'Hammer Hands',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  ivyAshgrove: {
    name: 'Ivy Ashgrove',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  brotherAnselm: {
    name: 'Brother Anselm',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /** Speaks only through stage directions and grunts — see `TUMBLEDOWN_ACTIONS`. */
  tumbledown: {
    name: 'Tumbledown',
    portrait: null,
    voice: { kind: 'silent' },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  // The gym's boss.
  big_rooster: {
    name: 'Big Rooster',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  /** A nameless box — narration with no speaker to attribute it to. */
  narrator: {
    name: null,
    portrait: null,
    voice: { kind: 'silent' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
} as const satisfies Record<string, SpeakerDef>;

export type SpeakerId = keyof typeof SPEAKERS;

/** The name cast member `id` is credited as at the moment it is asked. */
export function speakerName(id: SpeakerId): string | null {
  return resolveSpeakerName(SPEAKERS[id].name);
}

function resolveSpeakerName(name: SpeakerName): string | null {
  return typeof name === 'function' ? name() : name;
}

const CAROLINE_TEXT_TICKS: ReadonlyArray<SoundId> = [
  'caroline_text_tick_1',
  'caroline_text_tick_2',
  'caroline_text_tick_3',
  'caroline_text_tick_4',
  'caroline_text_tick_5',
  'caroline_text_tick_6',
  'caroline_text_tick_7',
];

/**
 * Caroline, the System AI. Not in {@link SPEAKERS}: she is reached only
 * through a `CarolineSpeakerRef`, which only `carolineLines`
 * (`src/dialog/caroline.ts`) can make. Her frame draws "System AI message:"
 * and "Caroline - " itself, so her name is never set as a plate.
 */
const CAROLINE_SPEAKER = {
  name: 'Caroline',
  portrait: null,
  voice: { kind: 'wordTicks', sounds: CAROLINE_TEXT_TICKS },
  reveal: 'letter',
  textCase: 'as-written',
  revealIntervalMs: motion.carolineSpeechCharacter,
  typeface: 'terminal',
} as const satisfies SpeakerDef;

export interface TransientStyleDef {
  readonly voice: SpeakerVoice;
  readonly reveal: RevealMode;
  readonly textCase: TextCase;
  /** Milliseconds between revealed elements — {@link SPEECH_REVEAL_INTERVAL_MS} for ordinary speech. */
  readonly revealIntervalMs: number;
  readonly typeface?: SpeakerTypeface;
}

/**
 * Voice/reveal/case presets for speakers who can't be a compile-time union
 * member — a procedurally named townsperson, resident, or hired cook is one
 * of these styles wearing a name picked at runtime.
 */
export const TRANSIENT_STYLES = {
  /** Street townsfolk and interior residents. */
  townsfolk: {
    voice: { kind: 'typing' },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /** A Taloncrest human whose look is masculine. */
  townsfolkMasculine: {
    voice: { kind: 'clips', sounds: HUMAN_MASCULINE_VOICE_SOUNDS },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /** A Taloncrest human whose look is feminine. */
  townsfolkFeminine: {
    voice: { kind: 'clips', sounds: HUMAN_FEMININE_VOICE_SOUNDS },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /** A Taloncrest Hawkfolk. */
  townsfolkHawkfolk: {
    voice: { kind: 'clips', sounds: HAWKFOLK_CITIZEN_VOICE_SOUNDS },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /** A Taloncrest Hawkfolk elder, clerk or temple keeper. */
  townsfolkHawkfolkElder: {
    voice: { kind: 'clips', sounds: HAWKFOLK_ELDER_VOICE_SOUNDS },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /** A Taloncrest Hawkfolk child. */
  townsfolkHawkfolkFledgling: {
    voice: { kind: 'clips', sounds: HAWKFOLK_FLEDGLING_VOICE_SOUNDS },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /** A crawler sign or notice — read, not spoken. */
  sign: {
    voice: { kind: 'typing' },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SIGN_REVEAL_INTERVAL_MS,
  },
  /** A safe room's doctor — the name changes with the room, the voice does not. */
  doctor: {
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /**
   * A questline's own narrated beat — a crawler heading back to a
   * villager, a shouted summons. Shown in full at once rather than typed out;
   * it interrupts play to be read, not overheard.
   */
  questLine: {
    voice: { kind: 'typing' },
    reveal: 'all',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /**
   * A narrator page that carries its own heading instead of the nameless
   * `narrator` cast member — a location caption, or a scene's own banner
   * title. Matches `narrator`'s voice, reveal and case exactly; only the name
   * shown above the text differs.
   */
  narration: {
    voice: { kind: 'silent' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
} as const satisfies Record<string, TransientStyleDef>;

export type TransientStyleId = keyof typeof TRANSIENT_STYLES;

/** The styles a Taloncrest citizen speaks in; `townsfolk` itself stays the typed-click voice for Briar Hollow's ratkin. */
export type CitizenSpeechStyle = Extract<
  TransientStyleId,
  | 'townsfolkMasculine'
  | 'townsfolkFeminine'
  | 'townsfolkHawkfolk'
  | 'townsfolkHawkfolkElder'
  | 'townsfolkHawkfolkFledgling'
>;

/** The clips a citizen speaking in `style` is voiced with. Every citizen style speaks in clips. */
export function citizenVoiceSounds(style: CitizenSpeechStyle): ReadonlyArray<SoundId> {
  return TRANSIENT_STYLES[style].voice.sounds;
}

/**
 * Who a `DialogLine` is attributed to: a fixed cast member, resolved by id
 * from {@link SPEAKERS}, a transient speaker named at runtime and styled by
 * one of {@link TRANSIENT_STYLES}, or Caroline, whose ref only
 * `carolineLines` can make.
 */
export type SpeakerRef =
  | { readonly kind: 'cast'; readonly id: SpeakerId }
  | { readonly kind: 'transient'; readonly name: string; readonly style: TransientStyleId }
  | CarolineSpeakerRef;

/**
 * Resolves a `SpeakerRef` into what `DialogBox` needs to draw it: a cast
 * member's own entry in {@link SPEAKERS} with a {@link PortraitSource} that
 * paints its portrait when the box draws, or a transient speaker's runtime
 * name wearing one of {@link TRANSIENT_STYLES}.
 */
export function resolveSpeaker(ref: SpeakerRef): ResolvedSpeaker {
  switch (ref.kind) {
    case 'transient':
      return { name: ref.name, portrait: null, ...TRANSIENT_STYLES[ref.style], skin: 'standard' };
    case 'caroline':
      return { ...CAROLINE_SPEAKER, skin: 'caroline' };
    case 'cast': {
      const def: SpeakerDef = SPEAKERS[ref.id];
      return {
        name: resolveSpeakerName(def.name),
        portrait: def.portrait === null ? null : resolvePortrait(def.portrait),
        voice: def.voice,
        reveal: def.reveal,
        textCase: def.textCase,
        revealIntervalMs: def.revealIntervalMs,
        typeface: def.typeface,
        skin: 'standard',
      };
    }
    default: {
      const unhandled: never = ref;
      return unhandled;
    }
  }
}

function speakerDef(ref: SpeakerRef): SpeakerDef | TransientStyleDef {
  switch (ref.kind) {
    case 'transient':
      return TRANSIENT_STYLES[ref.style];
    case 'caroline':
      return CAROLINE_SPEAKER;
    case 'cast':
      return SPEAKERS[ref.id];
    default: {
      const unhandled: never = ref;
      return unhandled;
    }
  }
}

/** The face a `SpeakerRef`'s words are set in, without painting its portrait. */
export function speakerTypeface(ref: SpeakerRef): SpeakerTypeface {
  return speakerDef(ref).typeface ?? 'ui';
}

/** The box a `SpeakerRef`'s words are drawn in, without painting its portrait. */
export function speakerSkin(ref: SpeakerRef): SpeakerSkin {
  return ref.kind === 'caroline' ? 'caroline' : 'standard';
}
