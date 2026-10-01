/**
 * Every recurring speaker in the game: who they are, what they look like,
 * how their voice is played, and how their text is cased.
 *
 * A `DialogLine` never carries a speaker's name as a string — it carries a
 * `SpeakerRef`, which is either a fixed entry in {@link SPEAKERS} (a named
 * cast member) or a `transient` speaker built at runtime from a
 * {@link TransientStyleId} preset (a townsperson, a sign, a system message —
 * anyone whose name can't be a compile-time union member).
 */

import type { SoundId } from '../audio/sounds';
import type { ResolvedSpeaker, RevealMode } from '../ui/DialogBox';
import { ratkinPortrait } from '../sprites/ratkinPortrait';
import type { RatkinCastId } from '../sprites/art/ratkin/cast';

/** How a speaker's text is cased when it's drawn — a written-in rule instead of an author convention to remember. */
export type TextCase = 'as-written' | 'upper';

/**
 * How a speaker sounds while their text reveals.
 *   'typing' → the shared typing-click sound, once per revealed token
 *   'clips'  → one of the speaker's own voice clips, once per DialogLine
 *   'silent' → no sound at all
 */
export type SpeakerVoice =
  | { readonly kind: 'typing' }
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

/** A skyfowl citizen's voice when a conversation opens: throaty chatter, never the hostile fowl's squawk. */
const SKYFOWL_CITIZEN_VOICE_SOUNDS: ReadonlyArray<SoundId> = [
  'skyfowl_chatter_1',
  'skyfowl_chatter_2',
];

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

/** Paints (or fetches the cached paint of) the face behind a `PortraitKey`. Ratkin faces are the only source today; branch on `key.source` here when a second one exists. */
export function resolvePortrait(key: PortraitKey): CanvasImageSource {
  return ratkinPortrait(key.id);
}

export interface SpeakerDef {
  /** `null` renders a nameless box — for a narrator, or a voice with no name to show. */
  readonly name: string | null;
  readonly portrait: PortraitKey | null;
  readonly voice: SpeakerVoice;
  readonly reveal: RevealMode;
  readonly textCase: TextCase;
  /** Milliseconds between revealed elements — {@link SPEECH_REVEAL_INTERVAL_MS} for ordinary speech. */
  readonly revealIntervalMs: number;
}

function ratkinVillagerSpeaker(name: string, id: RatkinCastId): SpeakerDef {
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
  carl: {
    name: 'Carl',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  donut: {
    name: 'Princess Donut',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'upper',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  mordecai: {
    name: 'Mordecai',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /** Mordecai's voice coming through in the crawlers' ears rather than spoken face to face — every quest scene's warning, never a safe room or the tutorial. */
  mordecaiInEar: {
    name: 'Mordecai (in your ear)',
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

  // The Krasue Murders and the Circus questline.
  signet: {
    name: 'Tsarina Signet',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  grimaldi: {
    name: 'Grimaldi',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /** Grimaldi's voice calling from inside the Big Top, before Signet can see him again. */
  grimaldiInTent: {
    name: 'Grimaldi (from within the tent)',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  gumgum: {
    name: 'GumGum',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  quill: {
    name: 'Miss Quill',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /** The Lich before its reveal in the Murders questline — the same character as {@link SPEAKERS.lich}, credited under the name the plot hides it behind. */
  mysteriousVoice: {
    name: 'A voice from everywhere',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
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
  hilda: {
    name: 'Old Hilda',
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

  // The Desperado Club, Defend and Spider questlines.
  clarabelle: {
    name: 'Clarabelle',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  goblinMother: {
    name: 'Goblin Mother',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  scientist: {
    name: 'Scientist',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  // The Desperado Club's blackjack table.
  deuce: {
    name: 'Deuce',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },

  // The Meat Shields' hired mercenaries.
  sledge: {
    name: 'The Sledge',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  bomo: {
    name: 'Bomo',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  dongQuixote: {
    name: 'Dong Quixote',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  splashZone: {
    name: 'Splash Zone',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  gluteusMaxx: {
    name: 'Gluteus Maxx',
    portrait: null,
    voice: { kind: 'typing' },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  bucketBoy: {
    name: 'Bucket Boy',
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
  juicer: {
    name: 'The Juicer',
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

export interface TransientStyleDef {
  readonly voice: SpeakerVoice;
  readonly reveal: RevealMode;
  readonly textCase: TextCase;
  /** Milliseconds between revealed elements — {@link SPEECH_REVEAL_INTERVAL_MS} for ordinary speech. */
  readonly revealIntervalMs: number;
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
  /** An Over City human whose look is masculine. */
  townsfolkMasculine: {
    voice: { kind: 'clips', sounds: HUMAN_MASCULINE_VOICE_SOUNDS },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /** An Over City human whose look is feminine. */
  townsfolkFeminine: {
    voice: { kind: 'clips', sounds: HUMAN_FEMININE_VOICE_SOUNDS },
    reveal: 'word',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /** An Over City skyfowl. */
  townsfolkSkyfowl: {
    voice: { kind: 'clips', sounds: SKYFOWL_CITIZEN_VOICE_SOUNDS },
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
  /** An auto-hiding system message, credited to whatever the message names itself. */
  system: {
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /** A room's cook — the name changes with the room, the voice does not. */
  bopca: {
    voice: { kind: 'typing' },
    reveal: 'sentence',
    textCase: 'as-written',
    revealIntervalMs: SPEECH_REVEAL_INTERVAL_MS,
  },
  /**
   * A questline's own narrated beat — Carl or Donut heading back to a
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

/** The styles an Over City citizen speaks in; `townsfolk` itself stays the typed-click voice for Briar Hollow's ratkin. */
export type CitizenSpeechStyle = Extract<
  TransientStyleId,
  'townsfolkMasculine' | 'townsfolkFeminine' | 'townsfolkSkyfowl'
>;

/**
 * Who a `DialogLine` is attributed to: a fixed cast member, resolved by id
 * from {@link SPEAKERS}, or a transient speaker named at runtime and styled
 * by one of {@link TRANSIENT_STYLES}.
 */
export type SpeakerRef =
  | { readonly kind: 'cast'; readonly id: SpeakerId }
  | { readonly kind: 'transient'; readonly name: string; readonly style: TransientStyleId };

/**
 * Resolves a `SpeakerRef` into what `DialogBox` needs to draw it: a cast
 * member's own entry in {@link SPEAKERS} with its portrait painted, or a
 * transient speaker's runtime name wearing one of {@link TRANSIENT_STYLES}.
 */
export function resolveSpeaker(ref: SpeakerRef): ResolvedSpeaker {
  if (ref.kind === 'transient') {
    return { name: ref.name, portrait: null, ...TRANSIENT_STYLES[ref.style] };
  }
  const def = SPEAKERS[ref.id];
  return {
    name: def.name,
    portrait: def.portrait === null ? null : resolvePortrait(def.portrait),
    voice: def.voice,
    reveal: def.reveal,
    textCase: def.textCase,
    revealIntervalMs: def.revealIntervalMs,
  };
}
