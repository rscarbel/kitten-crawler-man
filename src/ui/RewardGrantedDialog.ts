import type { GrantedReward, GrantedRewardKind } from '../core/GrantedReward';
import type { AudioManager } from '../audio/AudioManager';

const POWER_UP_FRAMES = 60;

/** The only thing that differs between an ability, a skill and an item grant. */
const REWARD_HEADINGS: Record<GrantedRewardKind, string> = {
  ability: 'New Ability!',
  skill: 'New Skill!',
  item: 'New Item!',
};

type Phase = 'idle' | 'power_up' | 'done';

/** What the card on screen shows this frame. */
export interface RewardGrantedView {
  readonly reward: GrantedReward;
  readonly heading: string;
  /** The icon is still pulsing in. */
  readonly poweringUp: boolean;
  /** 0 to 1 through the pulse. */
  readonly iconPulse: number;
  /** The pulse has finished: the description and OK are shown and OK may be pressed. */
  readonly settled: boolean;
}

/**
 * Pausing overlay shown when the player is granted an ability, a skill, or a
 * special unlock (e.g. Mongo the velociraptor companion) after dismissing an
 * award screen.
 *
 * Multiple rewards are queued and shown one after the other.
 *
 * DungeonScene should:
 *   1. Call enqueue(reward) when a rewardGranted bus event fires.
 *   2. Skip updateGameplay() while isShowing is true.
 *   3. Call update() every frame regardless of pause state, and mount
 *      `rewardGrantedSurface` to draw the card and take its OK.
 */
export class RewardGrantedDialog {
  private queue: GrantedReward[] = [];
  private current: GrantedReward | null = null;
  private phase: Phase = 'idle';
  private frame = 0;
  private iconPulse = 0;
  private drainedCallbacks: Array<() => void> = [];

  audio: AudioManager | null = null;

  /** Returns true while an announcement animation is visible (game should pause). */
  get isShowing(): boolean {
    return this.phase !== 'idle';
  }

  /**
   * Runs `callback` once, when the last queued reward has been dismissed — or at
   * once if nothing is showing. For a follow-up that must not open underneath a
   * reward the player has not yet read.
   */
  afterQueueDrains(callback: () => void): void {
    if (!this.isShowing) {
      callback();
      return;
    }
    this.drainedCallbacks.push(callback);
  }

  /**
   * Drops every queued and showing reward, and the follow-ups waiting on them,
   * without running any of it. For a death rewind: whatever the cards announce
   * was granted in a world the rewind has just undone.
   */
  discard(): void {
    this.queue = [];
    this.current = null;
    this.phase = 'idle';
    this.drainedCallbacks = [];
  }

  /** Push a new reward onto the queue. */
  enqueue(reward: GrantedReward): void {
    this.queue.push(reward);
    if (this.phase === 'idle') this.advance();
  }

  private advance(): void {
    const next = this.queue.shift();
    if (!next) {
      this.phase = 'idle';
      this.current = null;
      const drained = this.drainedCallbacks;
      this.drainedCallbacks = [];
      for (const callback of drained) callback();
      return;
    }
    this.current = next;
    this.phase = 'power_up';
    this.frame = 0;
    this.iconPulse = 0;
    this.audio?.play('ability_level_up');
  }

  update(): void {
    if (this.phase === 'idle') return;
    this.frame++;

    if (this.phase === 'power_up') {
      this.iconPulse = this.frame / POWER_UP_FRAMES;
      if (this.frame >= POWER_UP_FRAMES) {
        this.phase = 'done';
      }
    }
  }

  /** The card on screen, or null when none is. */
  get view(): RewardGrantedView | null {
    const reward = this.current;
    if (this.phase === 'idle' || reward === null) return null;
    return {
      reward,
      heading: REWARD_HEADINGS[reward.kind],
      poweringUp: this.phase === 'power_up',
      iconPulse: this.iconPulse,
      settled: this.phase === 'done',
    };
  }

  /** OK: moves on to the next queued reward, or closes. Ignored until the pulse has finished. */
  acknowledge(): void {
    if (this.phase === 'done') this.advance();
  }
}
