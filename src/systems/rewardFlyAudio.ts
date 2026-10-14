import type { AudioManager } from '../audio/AudioManager';
import type { RewardLandings } from './RewardFlySystem';

/**
 * Coins arrive up to ten at a time and a frame's landings make one tick (the
 * tick's interval trait), so a stream of coins is a run of ticks well under a
 * single cue's level.
 */
const COIN_TICK_VOLUME = 0.35;
const ITEM_POP_VOLUME = 0.7;

/** Voices the coins and items that reached the HUD this frame. */
export function playRewardLandingCues(audio: AudioManager | null, landings: RewardLandings): void {
  if (!audio) return;
  if (landings.coins > 0) audio.play('coin_land_tick', { volume: COIN_TICK_VOLUME });
  for (let i = 0; i < landings.items; i++) {
    audio.play('item_bag_pop', { volume: ITEM_POP_VOLUME });
  }
}
