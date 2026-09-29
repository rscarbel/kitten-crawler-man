/**
 * The Big Top's sounds, by what they mean rather than by file.
 *
 * Every Big Top play site raises a cue from this table, never a raw id, so
 * each recording that lands is its registration in `src/audio/sounds.ts` plus
 * one line here. Most of the tent's own recordings have not landed yet, so a
 * cue either borrows the sound the tent has always played for that moment or
 * is an empty list — silent — where the tent has never made a sound there;
 * each entry's JSDoc names the file it is waiting for.
 *
 * A cue with several takes is rotated by `BigTopMazeSystem`'s cue queue.
 *
 * Every id named here must also be in the `circusQuest` group of
 * `src/audio/sfxGroups.ts`: `AudioManager.play` returns silently on a buffer
 * that was never preloaded, and `verify:bigtop` fails on any id missing there.
 */

import type { SoundId } from '../../audio/sounds';
import type { MazeBlockKind } from '../../map/bigTopMazeLayout';

export const BIG_TOP_CUES = {
  /** A fire grate breathing its column of flame. Waits on `fire_breather_whoosh_1..3`. */
  ventIgnition: ['llama_fireball'],
  /** A grate's telegraph kindling before it breathes. Waits on `fire_grate_kindle`. */
  ventKindle: [],
  /** A crawler caught and sent back to the act's marks. Waits on `slide_whistle_fall`. */
  burnout: ['llama_fireball_explosion'],
  /** The interval curtain lifting onto the next act. Waits on `curtain_rise`. */
  curtainRise: ['gate_opening'],
  /** The dead audience applauding an act done, as its curtain lifts. Waits on `phantom_applause`. */
  actApplause: [],
  /** The hall's limelights flaring up as its curtain lifts. Waits on `limelight_ignite`. */
  limelightIgnite: [],
  /** Donut ringing a feeding bell. Waits on `feeding_bell_ring`. */
  bellRing: ['massive_metal_hit'],
  /** A rung bell's follow-spots swinging away to the trough. Waits on `followspot_swing`. */
  followSpotSwing: [],
  /** A blow turning a mirror on its stand. Waits on `mirror_pivot_1..3`. */
  mirrorTurn: ['hammer_strike'],
  /** A beam latching a star. Waits on `star_target_lit`. */
  starLatch: ['objective_complete'],
  /** The way a latched star opens giving way. */
  starOpensWay: ['gate_opening'],
  /** A blow aimed at the other crawler's prop, refused. */
  refusedBlow: ['error'],
  /** The vine stirring as the last conversation begins. */
  vineStirs: ['grimaldi_plant_moving_3'],
  /** The potion poured over the vine. */
  cure: ['healing_potion'],
  /** The vine flinching as the cure bites. */
  vineHurt: ['grimaldi_vine_taking_damage'],
  /** The vine coming back to itself. */
  vineRevives: ['reviving_tone'],
} as const satisfies Record<string, readonly SoundId[]>;

/**
 * What a cross-character block sounds like as it gives way, by the prop that
 * was struck. The sandbag waits on `sandbag_drop` and the release ring on
 * `cage_door_release`; until then they, and the capstan, sound as the gate.
 */
export const BIG_TOP_BLOCK_CLEARED_CUES: Readonly<Record<MazeBlockKind, readonly SoundId[]>> = {
  sandbag: ['gate_opening'],
  brace: ['wood_breaking_1'],
  release_ring: ['gate_opening'],
  capstan: ['gate_opening'],
};

/** The tent's fight music, from the flap to the cure. */
export const BIG_TOP_MUSIC: SoundId = 'circus_battle';

/** The grounds' music, back once the party walks out cured. */
export const BIG_TOP_EXIT_MUSIC: SoundId = 'circus_theme';

/**
 * The room-wide ambience bed under the tent, or null while it has none.
 * Waits on `big_top_interior_loop`, which goes in `STREAMING_SOUND_IDS` rather
 * than an SFX group; `BuildingInteriorScene` lays it under the Big Top the same
 * way its `INTERIOR_AMBIENT_BEDS` do for the town's rooms.
 */
export const BIG_TOP_AMBIENT_BED: { readonly soundId: SoundId; readonly volume: number } | null =
  null;

/** Every SFX id any Big Top cue can play, for the preload gate. */
export function bigTopCueSoundIds(): ReadonlyArray<SoundId> {
  const ids = new Set<SoundId>();
  for (const takes of Object.values(BIG_TOP_CUES)) for (const id of takes) ids.add(id);
  for (const takes of Object.values(BIG_TOP_BLOCK_CLEARED_CUES))
    for (const id of takes) ids.add(id);
  return [...ids];
}
