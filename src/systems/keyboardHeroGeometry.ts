/**
 * Playing-field geometry for the keyboard-hero mini-game.
 *
 * Lives apart from `KeyboardHeroSystem` so the offline chart generator can share
 * it without importing the DOM-bound system module: the note timings it bakes
 * only make sense against the speed and hit window defined here.
 */

/** Playing-field image dimensions (from the sprite manifest). */
export const FIELD_IMG_W = 426;
export const FIELD_IMG_H = 586;

/** The visible green band in the playing field, in image-Y coordinates. */
export const HIT_ZONE_IMG_TOP = 455;
export const HIT_ZONE_IMG_BOTTOM = 555;

/** A note is perfectly struck when its centre sits here — this is the moment the music note sounds. */
export const HIT_ZONE_IMG_CENTER = (HIT_ZONE_IMG_TOP + HIT_ZONE_IMG_BOTTOM) / 2;

/** Height of each button image. */
export const NOTE_IMG_HEIGHT = 99;

/** Image-Y a note enters the field at. */
export const NOTE_SPAWN_IMG_Y = 0;

/** How many image-pixels per second a note falls. */
export const FALL_SPEED_IMG_PX_PER_SEC = 480;

/** Notes fade in from fully transparent at the top to fully opaque here (image-Y). */
export const FADE_IN_END_IMG_Y = 220;

const MS_PER_SECOND = 1_000;

/** Image-pixels a note covers per millisecond. */
export const FALL_SPEED_IMG_PX_PER_MS = FALL_SPEED_IMG_PX_PER_SEC / MS_PER_SECOND;

/** Time a note spends falling from the top of the field to the centre of the hit zone. */
export const NOTE_TRAVEL_MS = (HIT_ZONE_IMG_CENTER - NOTE_SPAWN_IMG_Y) / FALL_SPEED_IMG_PX_PER_MS;

/** Time a note spends fading in after it enters the field. */
export const NOTE_FADE_IN_MS = (FADE_IN_END_IMG_Y - NOTE_SPAWN_IMG_Y) / FALL_SPEED_IMG_PX_PER_MS;

/**
 * How far either side of the perfect moment a press still counts. Derived from the
 * old overlap rule: the note is hittable while its 99px body overlaps the green band.
 */
export const HIT_WINDOW_MS =
  ((HIT_ZONE_IMG_BOTTOM - HIT_ZONE_IMG_TOP) / 2 + NOTE_IMG_HEIGHT / 2) / FALL_SPEED_IMG_PX_PER_MS;

/**
 * The longest gap in the song clock a run can still be judged fairly across. Any
 * longer and a note's entire hit window can fall inside the gap, leaving the player
 * no moment at which they could have played it.
 */
export const MAX_PLAYABLE_GAP_MS = 2 * HIT_WINDOW_MS;

/**
 * Earliest a charted note may be struck. Anything sooner would have to enter the
 * field before the song starts, or would still be fading in as it reached the zone.
 */
export const CHART_EARLIEST_HIT_MS = NOTE_TRAVEL_MS + NOTE_FADE_IN_MS;
