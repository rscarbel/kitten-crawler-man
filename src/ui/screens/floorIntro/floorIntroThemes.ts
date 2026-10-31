/**
 * What each floor's "Find the Key" intro looks, reads and sounds like.
 *
 * Keyed by every {@link LevelId}, so a new floor cannot ship without its
 * intro. The beats themselves are shared (`floorIntroTimeline.ts`); a theme
 * only names the floor's ink, its ambience, its words and its swell.
 */

import { stairwellKey, type FloorKey, type FragmentSourceKind } from '../../../core/keys/floorKeys';
import type { KeyCue } from '../../../audio/keySoundCues';
import { capitalisedCountWord } from '../../../core/text/countWords';
import type { LevelId } from '../../../levels/levelIds';
import {
  CELLARS_CANDLELIGHT_INK,
  CELLARS_INTRO_INK,
  DUNGEON_INTRO_INK,
  DUNGEON_TORCHLIGHT_INK,
  SERVICE_LEVEL_INTRO_INK,
  SERVICE_LEVEL_STRIP_LIGHT_INK,
  TALONCREST_DUSK_INK,
  TALONCREST_INTRO_INK,
  type CandlelightInk,
  type DuskInk,
  type FloorIntroInk,
  type StripLightInk,
  type TorchlightInk,
} from '../../theme/introInk';

/**
 * The floor's ambience behind the words. Every painter is a switch over
 * `kind` ending in a `never` check, so a new look fails to compile until it
 * is painted.
 */
export type IntroAmbience =
  /** Warm, wavering pools of candlelight in the dark, dust falling through them. */
  | { readonly kind: 'candlelight'; readonly ink: CandlelightInk }
  /** Torches on wet stone, drips falling through the frame and smoke drifting up. */
  | { readonly kind: 'torchlight'; readonly ink: TorchlightInk }
  /** Flickering strip lights overhead, sparks spitting from them, steam venting across. */
  | { readonly kind: 'stripLights'; readonly ink: StripLightInk }
  /** A dusk sky over the town's roofs, its tower far off, leaves blowing across. */
  | { readonly kind: 'dusk'; readonly ink: DuskInk };

export type IntroAmbienceKind = IntroAmbience['kind'];

/** The intro cues that are a floor's opening swell, one per floor theme. */
export type IntroSwellCue = Extract<
  KeyCue,
  'introCellars' | 'introDungeon' | 'introServiceLevel' | 'introTaloncrest'
>;

/** A floor's swell, and where in its recording the swell cuts out for the title's slam. */
export interface IntroSwell {
  readonly cue: IntroSwellCue;
  /**
   * Milliseconds into the recording where the swell stops, measured from the
   * delivered file. The recording plays whole from the intro's first frame;
   * the title slams in here and the beats before it are paced to fit. Any
   * tail after it rings on over the card and into play.
   */
  readonly cutsOutAtMs: number;
}

/**
 * The line under "FIND THE KEY". One that states a number builds it from the
 * floor's key table, so it stays true when the count changes.
 */
export type IntroSubline =
  | { readonly kind: 'line'; readonly text: string }
  /** How many of the floor's fragments its bosses hold, counted from `FLOOR_KEYS`. */
  | { readonly kind: 'guardians' };

export interface FloorIntroTheme {
  readonly ink: FloorIntroInk;
  readonly ambience: IntroAmbience;
  /** The floor's name, shown over the key. */
  readonly kicker: string;
  readonly subline: IntroSubline;
  readonly swell: IntroSwell;
}

export const FLOOR_INTRO_THEMES = {
  tutorial: {
    ink: CELLARS_INTRO_INK,
    ambience: { kind: 'candlelight', ink: CELLARS_CANDLELIGHT_INK },
    kicker: 'The Cellars',
    subline: { kind: 'line', text: 'Every way out is locked.' },
    swell: { cue: 'introCellars', cutsOutAtMs: 2400 },
  },
  level1: {
    ink: DUNGEON_INTRO_INK,
    ambience: { kind: 'torchlight', ink: DUNGEON_TORCHLIGHT_INK },
    kicker: 'Floor 1 · The Dungeon',
    subline: { kind: 'guardians' },
    swell: { cue: 'introDungeon', cutsOutAtMs: 4000 },
  },
  level2: {
    ink: SERVICE_LEVEL_INTRO_INK,
    ambience: { kind: 'stripLights', ink: SERVICE_LEVEL_STRIP_LIGHT_INK },
    kicker: 'Floor 2 · The Service Level',
    subline: { kind: 'guardians' },
    swell: { cue: 'introServiceLevel', cutsOutAtMs: 4250 },
  },
  level3: {
    ink: TALONCREST_INTRO_INK,
    ambience: { kind: 'dusk', ink: TALONCREST_DUSK_INK },
    kicker: 'Floor 3 · Taloncrest',
    subline: { kind: 'line', text: 'The people of Taloncrest hold it. Earn it.' },
    swell: { cue: 'introTaloncrest', cutsOutAtMs: 4150 },
  },
} as const satisfies Record<LevelId, FloorIntroTheme>;

export function floorIntroTheme(levelId: LevelId): FloorIntroTheme {
  return FLOOR_INTRO_THEMES[levelId];
}

/**
 * The words of `levelId`'s subline. A guardians line counts the bosses that
 * hold fragments of the floor's key, and says "part of it" when other deeds
 * hold the rest.
 */
export function introSublineText(levelId: LevelId, subline: IntroSubline): string {
  switch (subline.kind) {
    case 'line':
      return subline.text;
    case 'guardians':
      return guardiansLine(levelId);
    default: {
      const unhandled: never = subline;
      return unhandled;
    }
  }
}

/** How many of `key`'s fragments each kind of deed issues. */
function fragmentKindTally(key: FloorKey): Record<FragmentSourceKind, number> {
  const tally: Record<FragmentSourceKind, number> = {
    storyBeat: 0,
    bossDefeated: 0,
    questCompleted: 0,
  };
  for (const fragment of key.fragments) tally[fragment.source.kind]++;
  return tally;
}

function guardiansLine(levelId: LevelId): string {
  const key = stairwellKey(levelId);
  const fragments = key.fragments.length;
  const guardians = fragmentKindTally(key).bossDefeated;
  if (guardians === 0) return 'It is somewhere on this floor. Find it.';
  const alone = guardians === 1;
  const holder = alone ? 'A guardian holds' : `${capitalisedCountWord(guardians)} guardians hold`;
  if (guardians < fragments) {
    return `${holder} part of it. ${alone ? 'Take what it holds.' : 'Take what they hold.'}`;
  }
  return `${holder} it. ${alone ? 'Take it.' : 'Take it from them.'}`;
}
