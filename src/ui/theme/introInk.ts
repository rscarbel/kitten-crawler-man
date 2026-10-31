/**
 * Colours and type for the "Find the Key" intro each floor opens with: the
 * dark it opens on, its words, the flash of the title's slam, and the light
 * each floor's ambience is painted in.
 *
 * Every colour is a `#rrggbb` hex, so painters can fade one with `withAlpha`.
 */

import { type, type TypeStyle } from './tokens';

/** The intro's own colours, shared by every floor's beats. */
export interface FloorIntroInk {
  /** The dark the intro opens on, top of the screen to bottom: tinted, never flat black. */
  readonly backdropTop: string;
  readonly backdropBottom: string;
  /** The darkening drawn in from the screen's edges, over the ambience and under the words. */
  readonly vignette: string;
  /** The floor's name over the key. */
  readonly kicker: string;
  /** The line under "FIND THE KEY". */
  readonly subline: string;
  /** The dark outline every line of words is set off from the ambience with. */
  readonly halo: string;
  /** The burst of light the title slams in with. */
  readonly flash: string;
  /** The soft glow pooled behind the title as it lands. */
  readonly titleGlow: string;
  /** The glow a socket gives off as it is counted. */
  readonly socketGlow: string;
}

/** The tutorial's cellars: warm candle pools in deep brown dark. */
export interface CandlelightInk {
  readonly pool: string;
  readonly flameOuter: string;
  readonly flameCore: string;
  readonly wick: string;
  readonly candle: string;
  readonly dust: string;
}

/** Floor 1's dungeon: torch fire on wet stone. */
export interface TorchlightInk {
  readonly glow: string;
  readonly flameOuter: string;
  readonly flameCore: string;
  readonly sconce: string;
  /** The highlight wet stone catches near a torch. */
  readonly wetStone: string;
  readonly drip: string;
  readonly smoke: string;
}

/** Floor 2's service level: failing strip lights, sparks and steam. */
export interface StripLightInk {
  readonly tube: string;
  readonly tubeGlow: string;
  readonly housing: string;
  readonly spark: string;
  readonly sparkHot: string;
  readonly steam: string;
}

/** Floor 3's Taloncrest: dusk sky over the town's roofs and its far tower. */
export interface DuskInk {
  readonly skyHigh: string;
  readonly skyLow: string;
  readonly horizonGlow: string;
  readonly farRoofs: string;
  readonly nearRoofs: string;
  readonly tower: string;
  readonly towerWindow: string;
  readonly leaves: readonly [string, ...string[]];
}

export const CELLARS_INTRO_INK = {
  backdropTop: '#07050a',
  backdropBottom: '#140c06',
  vignette: '#000000',
  kicker: '#f3d9a8',
  subline: '#e7d6b8',
  halo: '#050304',
  flash: '#ffe7b0',
  titleGlow: '#ffb347',
  socketGlow: '#ffc861',
} as const satisfies FloorIntroInk;

export const DUNGEON_INTRO_INK = {
  backdropTop: '#05060a',
  backdropBottom: '#0d0b0a',
  vignette: '#000000',
  kicker: '#efd3a0',
  subline: '#dcd2c2',
  halo: '#030304',
  flash: '#ffe3a6',
  titleGlow: '#ff9b3d',
  socketGlow: '#ffc861',
} as const satisfies FloorIntroInk;

export const SERVICE_LEVEL_INTRO_INK = {
  backdropTop: '#04070a',
  backdropBottom: '#0a0f12',
  vignette: '#000000',
  kicker: '#cfe6ef',
  subline: '#d4dde2',
  halo: '#020405',
  flash: '#f2fbff',
  titleGlow: '#9fd8ff',
  socketGlow: '#ffd36b',
} as const satisfies FloorIntroInk;

export const TALONCREST_INTRO_INK = {
  backdropTop: '#0b0a18',
  backdropBottom: '#1a0f14',
  vignette: '#000000',
  kicker: '#f7d9b6',
  subline: '#eedcc8',
  halo: '#07050c',
  flash: '#fff0d0',
  titleGlow: '#ff9a52',
  socketGlow: '#ffc861',
} as const satisfies FloorIntroInk;

export const CELLARS_CANDLELIGHT_INK = {
  pool: '#d9741f',
  flameOuter: '#ff9a2e',
  flameCore: '#fff2b8',
  wick: '#2a1a0c',
  candle: '#c9b48c',
  dust: '#f6c98a',
} as const satisfies CandlelightInk;

export const DUNGEON_TORCHLIGHT_INK = {
  glow: '#e0661c',
  flameOuter: '#ff7a1f',
  flameCore: '#ffe9a0',
  sconce: '#2b2622',
  wetStone: '#8fa3b0',
  drip: '#a9c3d4',
  smoke: '#6b6460',
} as const satisfies TorchlightInk;

export const SERVICE_LEVEL_STRIP_LIGHT_INK = {
  tube: '#e8fbff',
  tubeGlow: '#7fd2ee',
  housing: '#1c2328',
  spark: '#ffb43d',
  sparkHot: '#fff6c8',
  steam: '#c9d6dc',
} as const satisfies StripLightInk;

export const TALONCREST_DUSK_INK = {
  skyHigh: '#1b1838',
  skyLow: '#c4583a',
  horizonGlow: '#ffb070',
  farRoofs: '#2a1c2c',
  nearRoofs: '#120c16',
  tower: '#1c1322',
  towerWindow: '#ffc45e',
  leaves: ['#c4642a', '#9e3f22', '#d89a3a', '#6e4a22'],
} as const satisfies DuskInk;

/** How far apart the kicker's capitals are tracked, in UI units: a wide-spaced title card. */
const KICKER_TRACKING = 3;

/** The type the intro's lines are set in; "FIND THE KEY" itself is the title wordmark's face. */
export const FLOOR_INTRO_TYPE = {
  kicker: { ...type.title, letterSpacing: KICKER_TRACKING, upper: true },
  subline: type.heading,
  sublineCompact: type.title,
} as const satisfies Record<string, TypeStyle>;
