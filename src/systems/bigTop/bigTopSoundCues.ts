/**
 * The Big Top's sounds, by what they mean rather than by file.
 *
 * Every Big Top play site raises a cue from this table, never a raw id, so
 * each recording that lands is its registration in `src/audio/sounds.ts` plus
 * one line here. A cue whose own recording has not landed either borrows the
 * sound the tent has always played for that moment or is an empty list —
 * silent — where the tent has never made a sound there; such an entry's JSDoc
 * names the file it is waiting for.
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
  /** A fire grate breathing its column of flame. */
  ventIgnition: [
    'fire_breather_whoosh_1',
    'fire_breather_whoosh_2',
    'fire_breather_whoosh_3',
    'fire_breather_whoosh_4',
    'fire_breather_whoosh_5',
  ],
  /** A grate's telegraph kindling before it breathes. */
  ventKindle: ['fire_grate_kindle_1', 'fire_grate_kindle_2', 'fire_grate_kindle_3'],
  /** A crawler caught and sent back to the act's marks. */
  burnout: ['slide_whistle_fall'],
  /** The interval curtain lifting onto the next act. */
  curtainRise: ['curtain_rise'],
  /** The dead audience applauding an act done, as its curtain lifts. */
  actApplause: ['phantom_applause_1', 'phantom_applause_2', 'phantom_applause_3'],
  /** The hall's limelights flaring up as its curtain lifts. */
  limelightIgnite: ['limelight_ignite'],
  /** Donut ringing a feeding bell. */
  bellRing: ['feeding_bell_ring'],
  /**
   * A bell's follow-spots swinging away to the trough when it is rung, and
   * back onto the floor when its hold runs out.
   */
  followSpotSwing: ['followspot_swing'],
  /** A blow turning a mirror on its stand. */
  mirrorTurn: [
    'mirror_pivot_1',
    'mirror_pivot_2',
    'mirror_pivot_3',
    'mirror_pivot_4',
    'mirror_pivot_5',
  ],
  /** A beam latching a star. */
  starLatch: ['star_target_lit'],
  /** A hall star blazing up as the right light reaches it. Waits on `star_light_up`. */
  starLights: [],
  /** A hall star going dark as its light is taken away. Waits on `star_dim`. */
  starDims: [],
  /** A star sputtering under the wrong crawler's light. Waits on `star_wrong_fizzle`. */
  starWrongFizzle: [],
  /** The marquee chasing and spelling BRAVO as the whole board lights. Waits on `marquee_chase`. */
  marqueeChase: [],
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
 * was struck. Every block gives way to its first blow, so the capstan's one
 * ratchet is also the cage gate it lifts.
 */
export const BIG_TOP_BLOCK_CLEARED_CUES: Readonly<Record<MazeBlockKind, readonly SoundId[]>> = {
  sandbag: ['sandbag_drop'],
  brace: ['wood_breaking_1'],
  release_ring: ['cage_door_release'],
  capstan: ['capstan_ratchet'],
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
