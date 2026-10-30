/**
 * How long each of Brother Anselm's one-shot rows plays and the moment in it
 * that matters to gameplay, for his kit to time its effects by. His rows are
 * the human rig's own (`art/humanFigure.ts`), so every number here is read
 * off their frame counts and impact frames rather than chosen again.
 */

import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../core/constants';
import { WALK_GROUND_PER_CYCLE_PX } from './art/human/locomotion';
import {
  ATTACK_FRAMES,
  ATTACK_IMPACT_FRAME,
  STAFF_CHANNEL_FRAMES,
  STAFF_CHANNEL_RELEASE_FRAME,
  STAFF_CHANNEL_TICKS_PER_FRAME,
  STAFF_FLINCH_FRAMES,
  STAFF_FLINCH_TICKS_PER_FRAME,
  WALK_FRAMES,
} from './art/human/timing';

const MS_PER_SECOND = 1000;

function framesToMs(frames: number, ticksPerFrame: number): number {
  return (frames * ticksPerFrame * MS_PER_SECOND) / WORLD_TICKS_PER_SECOND;
}

/** The whole healing channel, from the hand rising to it coming back down. */
export const ANSELM_MEND_DURATION_MS = framesToMs(
  STAFF_CHANNEL_FRAMES,
  STAFF_CHANNEL_TICKS_PER_FRAME,
);
/** Where in the channel the heal lands: the frame the light in his palm flares. */
export const ANSELM_MEND_RELEASE_PROGRESS = STAFF_CHANNEL_RELEASE_FRAME / STAFF_CHANNEL_FRAMES;

/** The staff's sweep, wind-up to recovery. */
export const ANSELM_STAFF_STRIKE_DURATION_MS = 420;
/**
 * Where in the sweep the staff connects. The row shows frame
 * `floor(progress × frames)`, so the impact frame first appears here.
 */
export const ANSELM_STAFF_STRIKE_IMPACT_PROGRESS = ATTACK_IMPACT_FRAME / ATTACK_FRAMES;

/** The flinch from a blow. */
export const ANSELM_HURT_DURATION_MS = framesToMs(
  STAFF_FLINCH_FRAMES,
  STAFF_FLINCH_TICKS_PER_FRAME,
);
/** The fall, ending on the frame he lies still on. */
export const ANSELM_DEATH_DURATION_MS = 700;

/** Frames in his walk row: the kit turns the flee's phase at most one of these a tick. */
export const ANSELM_WALK_FRAMES = WALK_FRAMES;
/**
 * Ground one walk cycle covers, in tiles. His figure is the player's rig
 * drawn shorter, and its stride runs across the profile at the rig's own
 * depth whatever his height, so the cycle covers the player's own ground.
 */
export const ANSELM_TILES_PER_WALK_CYCLE = WALK_GROUND_PER_CYCLE_PX / TILE_SIZE;
