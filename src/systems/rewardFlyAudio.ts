import type { AudioManager } from '../audio/AudioManager';
import type { RewardLandings } from './RewardFlySystem';

/** Coins arrive up to ten at a time, so each tick sits well under a single cue's level. */
const COIN_TICK_VOLUME = 0.35;
/** Each landing detunes by up to this fraction either way so a stream of coins does not repeat one pitch. */
const COIN_TICK_PITCH_JITTER = 0.15;
const PITCH_CENTER_FRACTION = 0.5;
const ITEM_POP_VOLUME = 0.7;

/** Voices the coins and items that reached the HUD this frame. */
export function playRewardLandingCues(audio: AudioManager | null, landings: RewardLandings): void {
  if (!audio) return;
  for (let i = 0; i < landings.coins; i++) {
    const detune = (Math.random() - PITCH_CENTER_FRACTION) * 2 * COIN_TICK_PITCH_JITTER;
    audio.play('coin_land_tick', { volume: COIN_TICK_VOLUME, playbackRate: 1 + detune });
  }
  for (let i = 0; i < landings.items; i++) {
    audio.play('item_bag_pop', { volume: ITEM_POP_VOLUME });
  }
}
