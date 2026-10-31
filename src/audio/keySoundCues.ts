/**
 * The Golden Key's sounds, by what they mean rather than by file: the
 * fragment and forge ceremonies, the key ring, the sealed stairwells, the
 * "Find the Key" floor intros and floor 3's run end.
 *
 * Every play site raises a cue from this table, never a raw id. The keys play
 * on every floor, so every id here is preloaded through the `universal` group.
 */

import type { AudioManager } from './AudioManager';
import type { OneShotBus } from './buses';
import type { SoundId } from './sounds';
import type { StairwellStyleId } from '../sprites/art/stairwellArt';

export const KEY_CUES = {
  /** The shaft of gold light slamming down at the start of a fragment ceremony. */
  fragmentColumnSlam: ['key_fragment_column_slam'],
  /** The fragment spinning up out of the column. */
  fragmentRise: ['key_fragment_rise'],
  /** The fragment's reveal: it faces the player and flares. */
  fragmentFanfare: ['key_fragment_fanfare'],
  /** The fragment locking into its socket in the key's silhouette. */
  fragmentSocketLock: ['key_fragment_socket_lock'],
  /** Every fragment appearing in its ring of columns as the forge begins. */
  forgeSummon: ['golden_key_fragments_summon'],
  /** The fragments' orbit tightening, the rumble and the choir climbing. */
  forgeOrbitBuild: ['golden_key_orbit_build'],
  /** The fragments slamming together in the white flash. */
  forgeFlash: ['golden_key_forge_flash'],
  /** The whole Golden Key revealed. */
  forgeFanfare: ['golden_key_fanfare'],
  /** The forged key shrinking and flying to the Keys dock button. */
  forgeFlyToRing: ['golden_key_fly_to_ring'],
  /** The key ring menu opening. */
  keyRingOpen: ['key_ring_open'],
  /** A crawler stepping onto a sealed stairwell without the floor's key. */
  sealLockedRattle: [
    'stairwell_seal_locked_rattle_1',
    'stairwell_seal_locked_rattle_2',
    'stairwell_seal_locked_rattle_3',
    'stairwell_seal_locked_rattle_4',
  ],
  /** The key flying from the dock to the seal's padlock. */
  sealKeyFlight: ['stairwell_key_flight'],
  /** The key turning in the padlock. */
  sealKeyTurn: ['stairwell_key_turn'],
  /** Gold light running out along the seal's chains and straps. */
  sealRunesIgnite: ['stairwell_seal_runes_ignite'],
  /** The padlock bursting into motes. */
  sealPadlockBurst: ['stairwell_padlock_burst'],
  /** The chains slithering off the seal's edges. */
  sealChainsFall: ['stairwell_chains_fall'],
  /** Warm light and a draft rising out of the opened stairwell. */
  sealLightFromBelow: ['stairwell_light_from_below'],
  /** The low swell under the "Find the Key" intro's opening black, per floor theme. */
  introCellars: ['find_the_key_intro_cellars'],
  introDungeon: ['find_the_key_intro_dungeon'],
  introServiceLevel: ['find_the_key_intro_service_level'],
  introTaloncrest: ['find_the_key_intro_taloncrest'],
  /** "FIND THE KEY" slamming in. */
  introSlam: ['find_the_key_slam'],
  /** Floor 3's run end screen revealing the run's stats. */
  runEndReveal: ['run_end_reveal'],
  /** A new game carrying everything, confirmed. */
  newGameBegin: ['new_game_begin_whoosh'],
  /** A carried Wayfinder's Anchor waking on the new run's first arrival on floor 3. */
  anchorWake: ['wayfinders_anchor_wake'],
} as const satisfies Record<string, readonly SoundId[]>;

/** Which cue a play site raises. */
export type KeyCue = keyof typeof KEY_CUES;

/**
 * The intro's soft knocks, one per socket as the silhouette counts its
 * fragments out, in the order they play. A key with more sockets than knocks
 * cycles back to the first.
 */
export const INTRO_SOCKET_KNOCKS = [
  'find_the_key_socket_knock_1',
  'find_the_key_socket_knock_2',
  'find_the_key_socket_knock_3',
] as const satisfies readonly SoundId[];

/** The sound of each stairwell style's cover moving off its stairs, in its material's way. */
export const SEAL_COVER_SOUNDS = {
  cellars: 'stairwell_cover_drag_oak',
  service_level: 'stairwell_cover_swing_steel',
  street: 'stairwell_cover_fold_bronze',
} as const satisfies Record<StairwellStyleId, SoundId>;

/** Every id the key cues can play, for the `universal` preload group. */
export const KEY_SOUND_IDS: readonly SoundId[] = [
  ...Object.values(KEY_CUES).flat(),
  ...INTRO_SOCKET_KNOCKS,
  ...Object.values(SEAL_COVER_SOUNDS),
];

/**
 * Plays a random take of `cue` once, placed at world pixel (`x`, `y`) when a
 * point is given and heard map-wide otherwise. Silent for a missing audio
 * manager. A ceremony that hushes the world's effects plays its own cues on
 * the `ui` bus, the one the hush leaves open. Returns the take it played, so
 * a skipped ceremony can cut a long cue short; null when nothing played.
 */
export function playKeyCue(
  audio: Pick<AudioManager, 'play' | 'playAt'> | null,
  cue: KeyCue,
  at: { readonly x: number; readonly y: number } | null = null,
  bus: OneShotBus = 'sfx',
): SoundId | null {
  if (audio === null) return null;
  const takes: readonly SoundId[] = KEY_CUES[cue];
  const id = takes[Math.floor(Math.random() * takes.length)];
  if (at === null) audio.play(id, { bus });
  else audio.playAt(id, at.x, at.y, { bus });
  return id;
}
