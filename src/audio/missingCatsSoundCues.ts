/**
 * "A Cat Always Comes Back"'s sounds, by what they mean rather than by file.
 *
 * Every play site raises a cue from this table, never a raw id, so each
 * recording that lands is its registration in `src/audio/sounds.ts` plus one
 * line here. A cue still waiting on its recording either borrows the nearest
 * sound the game already has or is an empty list — silent — where nothing
 * stands in; each entry's JSDoc names the file it is waiting for.
 *
 * The questline's town half plays anywhere on floor 3, so these ids are
 * preloaded through the `missingCats` group, which floor 3 always holds; the
 * stakeout's decoded music sits in its own gated group (`missingCatsStakeout`),
 * and the capture's and the reunions' jingles in theirs
 * (`missingCatsCapture`, `missingCatsReunion`), held only where those moments
 * can play.
 */

import type { AudioManager } from './AudioManager';
import type { JingleId, MusicTrackId, SoundId } from './sounds';
import type { MusicStemOf } from './music/stemSets';
import { AMBIENT_RAMP_MS, type LoopLevel } from './loopLevels';
import type { CueSlot } from './cueSlot';

/**
 * The elves letting the cellar lid down once it has held. Waits on
 * `cellar_lid_drop`; the lid's creak stands in.
 */
const CELLAR_LID_SHUT_CUE: CueSlot<'cellar_lid_drop'> = {
  takes: ['trapdoor_creak_open'],
  standInFor: 'cellar_lid_drop',
};

/**
 * Something climbing the cistern's iron rungs and out of the lodge's cellar.
 * Waits on the sewer's `iron_ladder_rung_1` … `_3`; the rope ladder stands in.
 */
const CELLAR_CLIMB_CUE: CueSlot<'iron_ladder_rung'> = {
  takes: ['rope_ladder_climb'],
  standInFor: 'iron_ladder_rung',
};

/**
 * A town cat at home purring as a crawler pets her. Waits on
 * `town_cat_purr_1` … `_3`; nothing the game has is a purr, so it is silent
 * until they land.
 */
const TOWN_CAT_PURR_CUE: CueSlot<'town_cat_purr'> = {
  takes: [],
  standInFor: 'town_cat_purr',
};

export const MISSING_CATS_CUES = {
  /** A missing-cat notice read off the plaza board, heard as the notices pinned there. */
  noticesRead: ['notice_pin_tack_1', 'notice_pin_tack_2'],
  /** Belle putting her nose down at a strong point on the scent trail. */
  sniff: ['cat_sniff_1', 'cat_sniff_2', 'cat_sniff_3', 'cat_sniff_4'],
  /** The scent trail running out in open ground. */
  scentTrailEnds: ['scent_trail_fade'],
  /** The grey feather picked up from beside the millstones. */
  featherPickup: ['feather_pickup'],
  /** The tuna dish or the cut latch looked at closely. No recording is asked for; silent. */
  clueExamined: [],
  /** The lodge's cellar lid hauled up by Kessler. */
  cellarLidOpen: ['trapdoor_creak_open'],
  cellarLidShut: CELLAR_LID_SHUT_CUE.takes,
  cellarClimb: CELLAR_CLIMB_CUE.takes,
  /** The lodge's front door thrown open by the elves running in from the alley. */
  lodgeDoorBurst: ['door_creak_1', 'door_creak_2', 'door_creak_3', 'door_creak_4'],
  /** The storm-drain grate heaved up by the cellar elf. Waits on `drain_grate_drag_open`; the cellar lid's creak stands in. */
  grateOpened: ['trapdoor_creak_open'],
  /** The thief launching off a roof with the cat. */
  thiefTakeoff: ['hawkfolk_wing_takeoff_1', 'hawkfolk_wing_takeoff_2'],
  /**
   * The thief passing over the party, placed in the world. These takes carry
   * the "Wings overhead" caption, which the town's own wing foley must not:
   * that plays wherever a Hawkfolk citizen stands.
   */
  thiefFlyby: ['hawkfolk_wing_flyby_1', 'hawkfolk_wing_flyby_2', 'hawkfolk_wing_flyby_3'],
  /** The General Store's cat taken from the step. */
  catSnatched: ['cat_snatched_yowl'],
  /** The hearts floating up off a town cat at home a crawler has just petted: the cow's chime. */
  townCatHearts: ['happy_hearts'],
  townCatPurr: TOWN_CAT_PURR_CUE.takes,
} as const satisfies Record<string, readonly SoundId[]>;

/** The stakeout's music: the thin stem while the party watches, the full mix from the swoop on. */
export const STAKEOUT_MUSIC_STEMS = {
  watching: 'rooftop_chase_stakeout',
  chasing: 'rooftop_chase',
} as const satisfies Record<string, MusicStemOf<'rooftop_chase'>>;

/** The thief gliding between perches, heard from where it flies with the listener beneath it. */
export const THIEF_GLIDE_LOOP = {
  id: 'hawkfolk_wing_glide_loop',
  volume: 0.4,
  fadeInMs: AMBIENT_RAMP_MS,
  fadeOutMs: AMBIENT_RAMP_MS,
} as const satisfies LoopLevel;

/** How far the thief's glide carries, in tiles. */
export const THIEF_GLIDE_HEARING_TILES = 12;

/** Which cue a play site raises. */
export type MissingCatsCue = keyof typeof MISSING_CATS_CUES;

/**
 * Plays a random take of `cue` once, placed at world pixel (`x`, `y`) when a
 * point is given and heard map-wide otherwise. Silent for an empty cue or a
 * missing audio manager.
 */
export function playMissingCatsCue(
  audio: Pick<AudioManager, 'play' | 'playAt'> | null,
  cue: MissingCatsCue,
  at: { readonly x: number; readonly y: number } | null = null,
): void {
  if (audio === null) return;
  const takes: readonly SoundId[] = MISSING_CATS_CUES[cue];
  if (takes.length === 0) return;
  const id = takes[Math.floor(Math.random() * takes.length)];
  if (at === null) audio.play(id);
  else audio.playAt(id, at.x, at.y);
}

/** The jingle the capture at the fountain plays under, and that its steps are timed to. */
export const CAPTURE_CUE = 'capture_at_dusk' as const satisfies JingleId;
/** Seconds into {@link CAPTURE_CUE}: the krasue drop lands on the fountain. */
export const CAPTURE_KRASUE_LANDS_AT_S = 5.0;
/** Seconds into {@link CAPTURE_CUE}: Belle is lifted off toward the spire. */
export const CAPTURE_LIFT_OFF_AT_S = 12.0;
/** Seconds into {@link CAPTURE_CUE}: the cue has faded out, and the screen with it. */
export const CAPTURE_CUE_FADED_BY_S = 24.75;

/** The jingle that plays as a lost cat comes back to the one who lost her. */
export const REUNION_CUE = 'reunion_jingle' as const satisfies JingleId;

/** The song under Dave's and Pumpkin's conversation in the taproom, claimed for that talk alone. */
export const OLD_FRIENDS_SONG = 'old_friends' as const satisfies MusicTrackId;

/** The song the town's playlist gains once every cat is home. */
export const CATS_HOME_SONG = 'taloncrest_cats_home' as const satisfies MusicTrackId;
