/**
 * The sounds the tower's storey works make, by what they mean rather than by
 * file. The tower's preload group is built from this table, so a cue played
 * here is always decoded before the party can hear it. Recordings the works
 * want and the game lacks are borrowed from the nearest sound it has; each
 * entry's JSDoc names what stands in.
 */

import type { SoundId } from '../../audio/sounds';
import { ARCHIVE_LANDING_CUES } from '../../map/town/interiors/townCenterTower';

export const TOWER_CUES = {
  /** A paw working at a cage latch. `stall_door_latch` stands in. */
  latchJostle: ['stall_door_latch'],
  /** A latch giving and the cage door swinging. */
  cageOpen: ['door_creak_1'],
  /** The keeper seeing a paw at a latch. `krasue_attack` stands in for a shriek. */
  keeperShriek: ['krasue_attack'],
  /** A ward line biting a crawler that touched it while it burned. */
  wardZap: ['electric_goblin_arc_burst'],
  /** A ward stone split by the human. */
  wardStoneBreak: ['ward_stone_block_2', 'ward_stone_block_3'],
  /** One of the great bells sounding at the top of its swing, on the beat. */
  bellToll: ['bell_toll_hit'],
  /** A swinging bell knocking a crawler off its beam. */
  bellStrike: ['gate_thud'],
  /** The larder's lock turning on the key ring. */
  larderUnlock: ['gate_key_unlock'],
  /** The portcullis chain hauled while it is held fast from above. */
  chainHeld: ['chain_rattle_2', 'chain_rattle_3'],
  /** The tin of tuna opened for the cellmate as it goes up the dumbwaiter. */
  tunaOpened: ['tuna_tin_open'],
  /** Something from upstairs arriving in the dumbwaiter of its own accord. */
  dumbwaiterArrives: ['rope_tightening'],
  /** The things the cat knocks off the archive's shelf tops, landing; heard where they land. */
  archiveLanding: Object.values(ARCHIVE_LANDING_CUES),
} as const satisfies Record<string, readonly SoundId[]>;

export type TowerCue = keyof typeof TOWER_CUES;
