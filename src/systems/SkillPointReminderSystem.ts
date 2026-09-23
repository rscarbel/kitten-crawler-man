/**
 * SkillPointReminderSystem — nags the party about a banked, unspent level-up
 * point they've been sitting on.
 *
 * The wait only counts while a point is actually unspent (see `update`). Once
 * it elapses the nag fires immediately unless the party is mid-fight, in which
 * case it retries once a second — never waiting for a full quiet room, just for
 * the fight itself to stop — until it can fire. Firing sets `reminderActive`
 * for a few seconds — the HUD renders the "spend it" box bigger, glowing and
 * flashing for that window, then it drops back to its normal state — and the
 * wait restarts so an ignored point keeps nagging every cycle instead of
 * flagging once and going quiet.
 *
 * Inside a boss room whose fight is not over the nag never fires and the HUD
 * hides the badge outright (see `suppressed`). A boss kill is often the level-up
 * that banks the point, and the room can still be full of what the boss left
 * behind; a "go spend it" prompt over that fight invites the player to open a
 * menu at the worst moment of the floor.
 */

import type { Mob } from '../creatures/Mob';
import type { GameSystem, SystemContext } from './GameSystem';

const FRAMES_PER_SECOND = 60;
const REMINDER_DELAY_SECONDS = 90;
const REMINDER_DELAY_FRAMES = REMINDER_DELAY_SECONDS * FRAMES_PER_SECOND;
/** How often a blocked reminder retries once the 90s wait has already elapsed. */
const RETRY_INTERVAL_FRAMES = FRAMES_PER_SECOND;
/** How long the HUD stays in its flagged, more-prominent state once a nag fires. */
const FLASH_DURATION_SECONDS = 3;
const FLASH_DURATION_FRAMES = FLASH_DURATION_SECONDS * FRAMES_PER_SECOND;

/**
 * A blow lands well under a second apart in any real exchange, so a mob that
 * struck the party this recently is still swinging, not just a wasp that
 * tagged somebody a floor ago. {@link Mob.framesSinceStruckPlayer} is exactly
 * this recency, not the `hasStruckPlayer` latch, which never clears.
 */
const RECENTLY_STRUCK_FRAMES = 2 * FRAMES_PER_SECOND;

/**
 * Whether the party stands in a boss room whose fight is not over. Supplied by
 * the scene, the only thing that knows which boss systems it runs.
 */
export type UnresolvedBossRoomCheck = (ctx: SystemContext) => boolean;

export class SkillPointReminderSystem implements GameSystem {
  private elapsedFrames = 0;
  private retryCountdown = 0;
  /** Counts down while the HUD is in its flagged state; `reminderActive` tracks whether it's still > 0. */
  private flashFramesRemaining = 0;
  private previousUnspentTotal = 0;
  /**
   * Set only after the first `update()` call, so a scene rebuild that restores
   * `unspentPoints` from a save snapshot isn't misread as "the player just
   * spent a point" and silently swallows the very first nag.
   */
  private hasBaseline = false;

  /** True for a few seconds after a nag fires — read by the HUD. */
  reminderActive = false;
  /** Set once per fire; the scene drains this into a sound cue. */
  reminderSoundPending = false;
  /** True while the party is in an unfinished boss room — read by the HUD, which hides the badge. */
  suppressed = false;

  constructor(private readonly isInUnresolvedBossRoom: UnresolvedBossRoomCheck = () => false) {}

  update(ctx: SystemContext): void {
    const total = ctx.human.unspentPoints + ctx.cat.unspentPoints;
    // Ahead of every early return, so a point banked by this frame's boss kill
    // is already hidden when the HUD draws it.
    this.suppressed = this.isInUnresolvedBossRoom(ctx);

    if (!this.hasBaseline) {
      this.hasBaseline = true;
      this.previousUnspentTotal = total;
      return;
    }

    if (total <= 0) {
      this.resetWait();
      this.flashFramesRemaining = 0;
      this.reminderActive = false;
      this.previousUnspentTotal = total;
      return;
    }

    if (total < this.previousUnspentTotal) {
      // A point was spent, but at least one is still banked — restart the wait
      // rather than clearing it outright.
      this.resetWait();
      this.flashFramesRemaining = 0;
      this.reminderActive = false;
    }
    this.previousUnspentTotal = total;

    if (this.suppressed) {
      // A flash already running when the party walked in is cut short too.
      this.flashFramesRemaining = 0;
      this.reminderActive = false;
    }

    if (this.flashFramesRemaining > 0) {
      this.flashFramesRemaining--;
      this.reminderActive = this.flashFramesRemaining > 0;
      return;
    }

    if (this.elapsedFrames < REMINDER_DELAY_FRAMES) {
      this.elapsedFrames++;
      return;
    }

    // The wait is over. Try immediately; if blocked, back off a full second
    // before trying again rather than re-scanning the roster every frame.
    if (this.retryCountdown > 0) {
      this.retryCountdown--;
      return;
    }
    // The wait keeps counting inside the room, so the nag lands on the first
    // retry after the room is cleared rather than after another full wait.
    if (this.suppressed || this.isInCombat(ctx)) {
      this.retryCountdown = RETRY_INTERVAL_FRAMES;
      return;
    }

    this.flashFramesRemaining = FLASH_DURATION_FRAMES;
    this.reminderActive = true;
    this.reminderSoundPending = true;
    this.resetWait();
  }

  private resetWait(): void {
    this.elapsedFrames = 0;
    // Zero, not the full interval, so the moment the next wait elapses it
    // fires on the spot instead of sitting through one more idle second.
    this.retryCountdown = 0;
  }

  private isInCombat(ctx: SystemContext): boolean {
    if (ctx.human.isSwinging || ctx.cat.isSwinging) return true;
    // A slingshot volley never sets isSwinging — it swaps the attack key for
    // triggerSlingshot() instead — so a cooling-down sling is its ranged
    // equivalent of a mid-swing melee attack.
    if (ctx.human.isWieldingSlingshot && ctx.human.slingshotCooldown > 0) return true;
    return ctx.roster.mobs.some(
      (mob: Mob) =>
        mob.isAlive && mob.isHostile && mob.framesSinceStruckPlayer < RECENTLY_STRUCK_FRAMES,
    );
  }
}
