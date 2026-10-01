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
import { viewportHeight, viewportWidth } from '../../core/Viewport';
import type { OverlayInputClaim } from '../../systems/kits/OverlayClaims';
import {
  beginModalFit,
  drawModal,
  drawOverlay,
  endModalFit,
  fitModal,
  MODAL_FIT_NONE,
  modalFitPoint,
  type ModalFit,
} from '../Box';
import {
  beginMenuFocus,
  BUTTON_PRESETS,
  clearMenuFocus,
  drawButton,
  endMenuFocus,
  occludeRenderedButtons,
  playButtonSound,
  resetButtonPointerSpace,
  setButtonPointerSpace,
  type ButtonResult,
} from '../Button';
import {
  layoutQuestReward,
  QUEST_REWARD_BRASS,
  QUEST_REWARD_BRASS_GLOW,
  questRewardRevealSteps,
} from './questRewardLayout';
import type { QuestRewardSpec } from './types';

/** Focus ring id; the scene's overlay claim for the screen names the same one. */
export const QUEST_REWARD_FOCUS_ID = 'quest-reward';
export const QUEST_REWARD_CONTINUE_LABEL = 'Continue';

// ── Timeline (render frames) ────────────────────────────────────────────────
const FADE_IN_FRAMES = 18;
const REVEAL_START_FRAME = 16;
const REVEAL_STAGGER_FRAMES = 12;
const REVEAL_FADE_FRAMES = 16;
const MS_PER_SECOND = 1000;

/**
 * Frames until a screen with `revealSteps` staggered rewards has settled; a
 * press before this finishes the reveal instead of leaving.
 */
export function questRewardSettledFrames(revealSteps: number): number {
  const lastStepStart = REVEAL_START_FRAME + Math.max(0, revealSteps - 1) * REVEAL_STAGGER_FRAMES;
  return Math.max(FADE_IN_FRAMES, lastStepStart + REVEAL_FADE_FRAMES);
}

// ── Layout (design pixels, before the fit scales them) ─────────────────────
const OVERLAY_ALPHA = 0.72;
const OVERLAY_COLOR = '#0b0703';
const PANEL_MAX_WIDTH = 540;
const PANEL_SIDE_MARGIN = 16;
const PANEL_PAD_X = 24;
const PANEL_PAD_TOP = 18;
const PANEL_PAD_BOTTOM = 20;
const PANEL_RADIUS = 10;
const PANEL_BORDER_WIDTH = 2.5;
const PANEL_GLOW_BLUR = 26;
const PANEL_FILL = '#1a1208';
const BUTTON_W = 200;
const BUTTON_H = 46;
const BUTTON_MARGIN_TOP = 12;

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
  private fit: ModalFit = MODAL_FIT_NONE;
  private continueButton: ButtonResult | null = null;
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

  /** Queues `spec`; it goes up on the first update nothing stands in its way. */
  enqueue(spec: QuestRewardSpec): void {
    this.queue.push(spec);
  }

  /** Puts `spec` up at once, ahead of anything queued. */
  open(spec: QuestRewardSpec): void {
    this.current = spec;
    this.frame = 0;
    this.settledFrames = questRewardSettledFrames(questRewardRevealSteps(spec));
    this.continueButton = null;
    clearMenuFocus();
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
    playButtonSound(this.audio);
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
    if (this.current === null) return;
    this.current = null;
    this.continueButton = null;
    this.fit = MODAL_FIT_NONE;
    clearMenuFocus();
  }

  /** Every click or tap while the screen is up belongs to it; only Continue leaves. */
  handleClick(mx: number, my: number): boolean {
    if (this.current === null) return false;
    const point = modalFitPoint(this.fit, mx, my);
    const onContinue = this.continueButton?.contains(point.x, point.y) === true;
    if (onContinue || !this.isSettled) this.advance();
    return true;
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

  overlayClaim(): OverlayInputClaim {
    return {
      isOpen: this.current !== null,
      space: { kind: 'swallow' },
      locksKeyboard: true,
      haltsWorld: true,
      focusContext: QUEST_REWARD_FOCUS_ID,
    };
  }

  render(ctx: CanvasRenderingContext2D): void {
    const spec = this.current;
    if (spec === null) return;
    this.frame++;
    const w = viewportWidth();
    const h = viewportHeight();
    const alpha = clamp01(this.frame / FADE_IN_FRAMES);
    const nowSeconds = performance.now() / MS_PER_SECOND;

    drawOverlay(ctx, {
      canvasWidth: w,
      canvasHeight: h,
      color: OVERLAY_COLOR,
      alpha: alpha * OVERLAY_ALPHA,
    });
    // Everything drawn before this is under the backdrop now; a press on the
    // panel's empty space must not sound a button hidden beneath it.
    occludeRenderedButtons();

    const panelW = Math.min(PANEL_MAX_WIDTH, w - PANEL_SIDE_MARGIN * 2);
    const innerW = panelW - PANEL_PAD_X * 2;
    const layout = layoutQuestReward(ctx, spec, innerW);
    const panelH = PANEL_PAD_TOP + layout.height + BUTTON_MARGIN_TOP + BUTTON_H + PANEL_PAD_BOTTOM;

    this.fit = fitModal(panelH);
    beginModalFit(ctx, this.fit);
    setButtonPointerSpace(this.fit.scale, this.fit.pivotX, this.fit.pivotY);

    const panel = drawModal(ctx, {
      canvasWidth: w,
      canvasHeight: h,
      width: panelW,
      height: panelH,
      fill: PANEL_FILL,
      border: QUEST_REWARD_BRASS,
      borderWidth: PANEL_BORDER_WIDTH,
      radius: PANEL_RADIUS,
      glow: QUEST_REWARD_BRASS_GLOW,
      glowBlur: PANEL_GLOW_BLUR,
      alpha,
    });
    const innerX = panel.x + PANEL_PAD_X;
    const blockW = panel.width - PANEL_PAD_X * 2;
    const revealAlpha = (step: number): number =>
      alpha *
      clamp01(
        (this.frame - REVEAL_START_FRAME - step * REVEAL_STAGGER_FRAMES) / REVEAL_FADE_FRAMES,
      );
    let y = panel.y + PANEL_PAD_TOP;
    for (const block of layout.blocks) {
      block.draw(ctx, { x: innerX, y, width: blockW, alpha, revealAlpha, nowSeconds });
      y += block.height;
    }
    y += BUTTON_MARGIN_TOP;

    beginMenuFocus(QUEST_REWARD_FOCUS_ID, true);
    this.continueButton = drawButton(ctx, {
      x: panel.x + panel.width / 2,
      y,
      width: BUTTON_W,
      height: BUTTON_H,
      alignX: 'center',
      label: QUEST_REWARD_CONTINUE_LABEL,
      ...BUTTON_PRESETS.questReward,
      primaryAction: true,
      alpha,
    });
    endMenuFocus();

    resetButtonPointerSpace();
    endModalFit(ctx);
  }
}
