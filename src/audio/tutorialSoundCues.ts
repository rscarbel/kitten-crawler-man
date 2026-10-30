/**
 * The tutorial's gate sounds, by what they mean rather than by file.
 *
 * Every play site raises a cue from this table, never a raw id, so each
 * recording that lands is its registration in `src/audio/sounds.ts` plus one
 * line here. A cue still waiting on its recording borrows the nearest sound
 * the game already has; each entry's JSDoc names the file it is waiting for.
 *
 * Only the tutorial raises these, so every id here is preloaded through the
 * `tutorial` group in `src/audio/sfxGroups.ts`.
 */

import type { SoundId } from './sounds';
import { TILE_SIZE } from '../core/constants';

export const TUTORIAL_CUES = {
  /** A crawler walking into a gate that is still shut. */
  gateLocked: [
    'metal_gate_locked_rattle_1',
    'metal_gate_locked_rattle_2',
    'metal_gate_locked_rattle_3',
  ],
  /** A gate's latch letting go the moment the step that frees it is done. Waits on `gate_mechanism_unlock`; `gate_key_unlock` stands in. */
  gateUnlock: ['gate_key_unlock'],
  /** A portcullis winding up into its headbox. */
  gateRaise: ['heavy_metal_gate_raise'],
  /** Goblin B's heavy cellar door swinging open. */
  doorOpen: ['prison_door_heavy_open'],
  /** The low fence's double gate swinging open. Waits on `fence_gate_swing_open`; `door_creak_1` stands in. */
  fenceGateSwing: ['door_creak_1'],
} as const satisfies Record<string, readonly SoundId[]>;

/** Which cue a play site raises. */
export type TutorialCue = keyof typeof TUTORIAL_CUES;

/** A cue raised at a point in the world, for the scene to play from there. */
export interface TutorialCueAt {
  readonly cue: TutorialCue;
  readonly x: number;
  readonly y: number;
}

/**
 * The furthest from the listener a gate's unlock is placed. Its whole point is
 * telling the player their action worked, so a gate further off than anything
 * can be heard is still heard, from this far away in its direction.
 */
export const UNLOCK_CARRY_TILES = 9;
const UNLOCK_CARRY_PX = UNLOCK_CARRY_TILES * TILE_SIZE;
const TILE_CENTRE = 0.5;

/**
 * Where to play a raised cue from, heard by `listener` (a crawler, by its
 * tile's top-left). Every cue sounds from its gate, except an unlock beyond
 * {@link UNLOCK_CARRY_TILES}, which is drawn in along the line to the gate so
 * it still sounds far and to the right side.
 */
export function tutorialCueSource(
  raised: TutorialCueAt,
  listener: { readonly x: number; readonly y: number },
): { x: number; y: number } {
  if (raised.cue !== 'gateUnlock') return { x: raised.x, y: raised.y };
  const ears = { x: listener.x + TILE_SIZE * TILE_CENTRE, y: listener.y + TILE_SIZE * TILE_CENTRE };
  const dx = raised.x - ears.x;
  const dy = raised.y - ears.y;
  const distance = Math.hypot(dx, dy);
  if (distance <= UNLOCK_CARRY_PX) return { x: raised.x, y: raised.y };
  const pull = UNLOCK_CARRY_PX / distance;
  return { x: ears.x + dx * pull, y: ears.y + dy * pull };
}
