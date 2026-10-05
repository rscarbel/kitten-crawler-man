/**
 * The one quest-complete screen: a centred panel over the halted world naming
 * the quest and what finishing it paid, built from a {@link QuestRewardSpec}.
 *
 * A scene owns one, on its `MenusKit`. Quests never hold it: they emit
 * `questRewardShown` with a spec once they have paid, and the scene queues it
 * here. Two quests finishing in the same frame are shown one after the other.
 *
 * A queued screen goes up only when nothing else holds the screen — no
 * conversation open and no other overlay halting the world — so a quest that
 * ends in a conversation asks for its screen at once and it appears when the
 * conversation closes. Its reveal advances on render frames, because it owns
 * the screen and the world beneath it is halted.
 */

import type { AudioManager } from '../../audio/AudioManager';
import { UI_TAP_SOUND } from '../core/UiRoot';
import { questRewardRevealSteps } from './questRewardLayout';
import type { QuestRewardSpec } from './types';

export const QUEST_REWARD_CONTINUE_LABEL = 'Continue';

// ── Timeline (render frames) ────────────────────────────────────────────────
const FADE_IN_FRAMES = 18;
const REVEAL_START_FRAME = 16;
const REVEAL_STAGGER_FRAMES = 12;
const REVEAL_FADE_FRAMES = 16;

/**
 * Frames until a screen with `revealSteps` staggered rewards has settled; a
 * press before this finishes the reveal instead of leaving.
 */
export function questRewardSettledFrames(revealSteps: number): number {
  const lastStepStart = REVEAL_START_FRAME + Math.max(0, revealSteps - 1) * REVEAL_STAGGER_FRAMES;
  return Math.max(FADE_IN_FRAMES, lastStepStart + REVEAL_FADE_FRAMES);
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** When a queued screen may go up; both default to "never in the way". */
export interface QuestRewardOpenConditions {
  readonly conversationOpen: () => boolean;
  /** Whether anything other than this screen is halting the world. */
  readonly worldHeld: () => boolean;
}

export class QuestRewardScreen {
  private queue: QuestRewardSpec[] = [];
  private current: QuestRewardSpec | null = null;
  private frame = 0;
  private settledFrames = questRewardSettledFrames(0);
  private conditions: QuestRewardOpenConditions = {
    conversationOpen: () => false,
    worldHeld: () => false,
  };

  /** Runs after the player dismisses a screen, with the spec it showed — where a scene starts its fly-ins. */
  onClosed: ((spec: QuestRewardSpec) => void) | null = null;

  constructor(private readonly audio: AudioManager | null) {}

  /** Tells the screen what it must wait out before a queued spec may go up. */
  setOpenConditions(conditions: QuestRewardOpenConditions): void {
    this.conditions = conditions;
  }

  get isOpen(): boolean {
    return this.current !== null;
  }

  /** The spec on screen, or null. */
  get showing(): QuestRewardSpec | null {
    return this.current;
  }

  /** How many specs are waiting behind the one on screen. */
  get queuedCount(): number {
    return this.queue.length;
  }

  /** Whether the reveal has settled and Continue will leave rather than finish it. */
  get isSettled(): boolean {
    return this.frame >= this.settledFrames;
  }

  /** Moves the open screen's timeline on by one render frame. */
  advanceFrame(): void {
    if (this.current !== null) this.frame++;
  }

  /** How far the panel has faded in, from 0 to 1. */
  get fadeIn(): number {
    return clamp01(this.frame / FADE_IN_FRAMES);
  }

  /** How far reveal step `step` has faded in, from 0 to 1. */
  revealProgress(step: number): number {
    return clamp01(
      (this.frame - REVEAL_START_FRAME - step * REVEAL_STAGGER_FRAMES) / REVEAL_FADE_FRAMES,
    );
  }

  /** Queues `spec`; it goes up on the first update nothing stands in its way. */
  enqueue(spec: QuestRewardSpec): void {
    this.queue.push(spec);
  }

  /** Puts `spec` up at once, ahead of anything queued. */
  open(spec: QuestRewardSpec): void {
    this.current = spec;
    this.frame = 0;
    this.settledFrames = questRewardSettledFrames(questRewardRevealSteps(spec));
    this.audio?.play('quest_complete');
  }

  /**
   * Once per update, halted or not: raises the next queued screen the first
   * frame it is clear to. Returns whether a screen went up this call.
   */
  update(): boolean {
    if (this.current !== null || this.queue.length === 0) return false;
    if (this.conditions.conversationOpen() || this.conditions.worldHeld()) return false;
    const next = this.queue.shift();
    if (next === undefined) return false;
    this.open(next);
    return true;
  }

  /** Continue: finishes the reveal if it is still playing, otherwise dismisses the screen. */
  advance(): void {
    const spec = this.current;
    if (spec === null) return;
    this.audio?.play(UI_TAP_SOUND);
    if (!this.isSettled) {
      this.frame = this.settledFrames;
      return;
    }
    this.takeDown();
    spec.onDismissed?.();
    this.onClosed?.(spec);
  }

  /**
   * Drops the screen and everything queued without running any dismissal, for
   * a death rewind or a teardown: what the screens announce was paid in a
   * world that is being undone.
   */
  discard(): void {
    this.queue = [];
    this.takeDown();
  }

  private takeDown(): void {
    this.current = null;
  }

  /**
   * Escape leaves as Continue does; every other key is swallowed. Space and
   * Enter reach Continue through the focus ring before they get here.
   */
  handleKeyDown(key: string, repeat: boolean): boolean {
    if (this.current === null) return false;
    if (key === 'Escape' && !repeat) this.advance();
    return true;
  }
}
