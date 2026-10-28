/**
 * Owns the reward screen's side of awards: the HUD's "Rewards waiting" chip
 * and the Reward Chest surface it opens. Every award is already paid by
 * `AchievementAwards` when it is earned; this only presents them, and only
 * when the player asks, so a chest never interrupts play.
 */

import type { AchievementManager } from '../core/progression/AchievementManager';
import type { AudioManager } from '../audio/AudioManager';
import type { RewardPresentation } from '../loot/rewardChest';
import type { Surface } from '../ui/core/UiRoot';
import { RewardChestScreen } from '../ui/screens/rewardChest/RewardChestScreen';
import { rewardsBannerEntry } from '../ui/hud/rewardsBanner';
import type { TopBandEntry } from '../ui/hud/topBand';

export class AchievementUISystem {
  private readonly screen: RewardChestScreen;

  /**
   * Whether the chip may offer the waiting rewards now. While it is false the
   * chip stays hidden and the rewards wait in their crawlers' queues: the
   * tutorial holds them until the player has spoken to Dave.
   */
  presentationGate: () => boolean = () => true;

  /** Told as each presentation is taken off its queue to be shown, before its reveal plays. */
  onPresentationOpened: ((presentation: RewardPresentation) => void) | null = null;

  /** Told as each presentation is put away, with the presentation that closed. */
  onPresentationClosed: ((presentation: RewardPresentation) => void) | null = null;

  constructor(
    private readonly humanAchievements: AchievementManager,
    private readonly catAchievements: AchievementManager,
    audio: AudioManager | null = null,
  ) {
    this.screen = new RewardChestScreen(audio);
    this.screen.bindSource({
      take: () => this.takeNextPresentation(),
      waiting: () => (this.presentationGate() ? this.waitingCount : 0),
      closed: (presentation) => this.onPresentationClosed?.(presentation),
    });
  }

  /** True while the reward screen is up. */
  get isBlocking(): boolean {
    return this.screen.isOpen;
  }

  /** Paid awards waiting for the reward screen, across both crawlers. */
  private get waitingCount(): number {
    return this.humanAchievements.presentationCount + this.catAchievements.presentationCount;
  }

  /**
   * The next paid award to show, taken off its crawler's queue (the human's
   * first), or null when none is waiting or the gate is shut.
   */
  private takeNextPresentation(): RewardPresentation | null {
    if (!this.presentationGate()) return null;
    const next =
      this.humanAchievements.takePresentation() ?? this.catAchievements.takePresentation();
    if (next !== null) this.onPresentationOpened?.(next);
    return next;
  }

  /** The count the HUD's "Rewards waiting" chip shows, or null while it is hidden. */
  hudChipCount(): number | null {
    if (this.screen.isOpen || !this.presentationGate()) return null;
    const waiting = this.waitingCount;
    return waiting > 0 ? waiting : null;
  }

  /**
   * The safe room's wide "rewards waiting" banner for the top band, or null
   * outside a safe room or with nothing waiting. Tapping it opens the screen.
   */
  rewardsBanner(inSafeRoom: boolean): TopBandEntry | null {
    const count = this.hudChipCount();
    if (!inSafeRoom || count === null) return null;
    return rewardsBannerEntry({ count, onTap: () => void this.openRewards() });
  }

  /** Opens the reward screen on the waiting rewards. Returns whether any were waiting. */
  openRewards(): boolean {
    return this.screen.open();
  }

  /** Call once per frame, ahead of the pause and game-over returns, so the reveal never freezes. */
  tick(): void {
    this.screen.tick();
  }

  /** Puts the chest on screen away at once, its guard or not; it is already paid. */
  dismiss(): void {
    this.screen.dismiss();
  }

  /** The Reward Chest surface, mounted once on the scene's `UiRoot`; it halts the world while open. */
  surface(id = 'reward-chest'): Surface {
    return this.screen.surface(id);
  }
}
