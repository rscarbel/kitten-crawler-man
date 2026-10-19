/**
 * Playing-field geometry for the keyboard-hero mini-game, one profile per
 * difficulty tier.
 *
 * Lives apart from `KeyboardHeroSystem` so the offline chart generator can share
 * it without importing the DOM-bound system module: the note timings it bakes
 * only make sense against the speed and hit window defined here.
 */

import type { Difficulty } from '../core/difficultyProfiles';

/**
 * The band the note had to overlap under the original overlap rule. Nothing draws
 * it any more — the board's own layout owns where the hit line and its window sit
 * — but `HIT_WINDOW_MS` is derived from it, so the numbers stay frozen here.
 */
export const HIT_ZONE_IMG_TOP = 455;
export const HIT_ZONE_IMG_BOTTOM = 555;

/** A note is perfectly struck when its centre sits here — this is the moment the music note sounds. */
export const HIT_ZONE_IMG_CENTER = (HIT_ZONE_IMG_TOP + HIT_ZONE_IMG_BOTTOM) / 2;

/** Height of each button image. */
export const NOTE_IMG_HEIGHT = 99;

/** Image-Y a note enters the field at. */
export const NOTE_SPAWN_IMG_Y = 0;

const MS_PER_SECOND = 1_000;

/** The Crawler tier's fall speed, which the hit window was originally measured against. */
const CRAWLER_FALL_SPEED_IMG_PX_PER_SEC = 480;

/**
 * How far either side of the perfect moment a press still counts on Kitten and
 * Crawler. Derived once from the old overlap rule at Crawler's speed — the note
 * was hittable while its 99px body overlapped the green band — and then held in
 * milliseconds, so a slower fall gives a player longer to see a note without
 * also handing them a sloppier window.
 */
export const HIT_WINDOW_MS =
  ((HIT_ZONE_IMG_BOTTOM - HIT_ZONE_IMG_TOP) / 2 + NOTE_IMG_HEIGHT / 2) /
  (CRAWLER_FALL_SPEED_IMG_PX_PER_SEC / MS_PER_SECOND);

/**
 * The longest gap in the song clock a run can still be judged fairly across. Any
 * longer and a note's entire hit window can fall inside the gap, leaving the player
 * no moment at which they could have played it. This is the widest window's
 * figure; each tier's own is `KeyboardHeroGeometry.maxPlayableGapMs`.
 */
export const MAX_PLAYABLE_GAP_MS = 2 * HIT_WINDOW_MS;

/** What a tier tunes; everything else on the field is derived from these. */
interface KeyboardHeroTierTuning {
  /** How far either side of the perfect moment a press still counts. */
  readonly hitWindowMs: number;
  /** How many image-pixels per second a note falls. */
  readonly fallSpeedImgPxPerSec: number;
  /** Notes fade in from fully transparent at the top to fully opaque here (image-Y). */
  readonly fadeInEndImgY: number;
  /** Closest two charted moments may sit, so successive keycaps clear each other on screen. */
  readonly minNoteSpacingMs: number;
}

/** One tier's playing field, as the runtime and the chart generator both read it. */
export interface KeyboardHeroGeometry extends KeyboardHeroTierTuning {
  /** Image-pixels a note covers per millisecond. */
  readonly fallSpeedImgPxPerMs: number;
  /** Time a note spends falling from the top of the field to the centre of the hit zone. */
  readonly noteTravelMs: number;
  /** Time a note spends fading in after it enters the field. */
  readonly noteFadeInMs: number;
  /**
   * Earliest a charted note may be struck. Anything sooner would have to enter the
   * field before the song starts, or would still be fading in as it reached the zone.
   */
  readonly chartEarliestHitMs: number;
  readonly maxPlayableGapMs: number;
  /**
   * A song-clock jump larger than this means the mini-game stopped updating while
   * the track kept rolling, and the run is abandoned rather than judged. The line
   * is the widest gap a run can still be judged fairly across.
   */
  readonly suspensionAbandonMs: number;
  /** Half the hit window expressed as note-space pixels — the band drawn around the hit line. */
  readonly hitWindowImgHalfHeight: number;
}

function deriveGeometry(tuning: KeyboardHeroTierTuning): KeyboardHeroGeometry {
  const fallSpeedImgPxPerMs = tuning.fallSpeedImgPxPerSec / MS_PER_SECOND;
  const noteTravelMs = (HIT_ZONE_IMG_CENTER - NOTE_SPAWN_IMG_Y) / fallSpeedImgPxPerMs;
  const noteFadeInMs = (tuning.fadeInEndImgY - NOTE_SPAWN_IMG_Y) / fallSpeedImgPxPerMs;
  const maxPlayableGapMs = 2 * tuning.hitWindowMs;
  return {
    ...tuning,
    fallSpeedImgPxPerMs,
    noteTravelMs,
    noteFadeInMs,
    chartEarliestHitMs: noteTravelMs + noteFadeInMs,
    maxPlayableGapMs,
    suspensionAbandonMs: maxPlayableGapMs,
    hitWindowImgHalfHeight: tuning.hitWindowMs * fallSpeedImgPxPerMs,
  };
}

/**
 * The track's sixteenth-note grid is ~173 ms; two grid steps is the tightest pair
 * a player can reasonably alternate on.
 */
const CRAWLER_MIN_NOTE_SPACING_MS = 345;

const CRAWLER_TUNING = {
  hitWindowMs: HIT_WINDOW_MS,
  fallSpeedImgPxPerSec: CRAWLER_FALL_SPEED_IMG_PX_PER_SEC,
  fadeInEndImgY: 220,
  minNoteSpacingMs: CRAWLER_MIN_NOTE_SPACING_MS,
} as const satisfies KeyboardHeroTierTuning;

/**
 * Kitten trades speed for lead time: a note is on screen for ~1.4 s instead of
 * ~1.05 s and fully opaque about a second before it lands. A taller field would
 * buy the same, but phone landscape is already height-bound. The wider spacing
 * keeps successive keycaps clear of each other at the slower speed, where the
 * same gap in time is fewer pixels apart.
 */
const KITTEN_TUNING = {
  hitWindowMs: HIT_WINDOW_MS,
  fallSpeedImgPxPerSec: 360,
  fadeInEndImgY: 145,
  minNoteSpacingMs: 430,
} as const satisfies KeyboardHeroTierTuning;

/**
 * Nightmare's window as a share of Crawler's. Crawler's is roughly ±207 ms, wide
 * enough that a player can coast; this lands near ±145 ms, still well outside
 * the cosmetic PERFECT band.
 */
const NIGHTMARE_HIT_WINDOW_SHARE = 0.7;

/**
 * One step of the track's sixteenth-note grid. At Nightmare's fall speed two
 * notes this far apart still sit more than a keycap's height apart on screen.
 */
const NIGHTMARE_MIN_NOTE_SPACING_MS = 170;

/**
 * Nightmare falls a quarter faster than Crawler, so a note is on screen for
 * ~0.84 s instead of ~1.05 s, and allows a sixteenth step between notes in
 * different lanes. Its narrower window also narrows how close two notes in one
 * lane may sit, which the chart generator reads from here.
 */
const NIGHTMARE_TUNING = {
  hitWindowMs: HIT_WINDOW_MS * NIGHTMARE_HIT_WINDOW_SHARE,
  fallSpeedImgPxPerSec: 600,
  fadeInEndImgY: 220,
  minNoteSpacingMs: NIGHTMARE_MIN_NOTE_SPACING_MS,
} as const satisfies KeyboardHeroTierTuning;

export const KEYBOARD_HERO_GEOMETRY: Readonly<Record<Difficulty, KeyboardHeroGeometry>> = {
  easy: deriveGeometry(KITTEN_TUNING),
  normal: deriveGeometry(CRAWLER_TUNING),
  hard: deriveGeometry(NIGHTMARE_TUNING),
};
