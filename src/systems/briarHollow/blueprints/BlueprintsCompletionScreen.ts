/**
 * The finish of "The Borrowed Blueprints": a centred quest-complete screen
 * over the halted village naming what the party earned — the saw and the
 * rope walk, upgraded for good, with what each now does in numbers read from
 * the constants the sawmill itself works by.
 *
 * Goes up once, the first frame the quest stands `complete` with nothing else
 * on screen: the last upgrade's "upgraded!" callout played out, no
 * conversation open, nothing else halting the world, and the Plea's siege
 * not on. Whether it has been read through is durable
 * (`state.blueprints.completionScreenSeen`), set by Continue, so a door
 * visit, a reload or a rewind never raises it again.
 *
 * Owned by `BlueprintsQuestSystem`; `BriarHollowKit` routes its overlay claim,
 * clicks, keys and render with the village's other modal, the Plea's
 * confirm. Its reveal advances on render frames, as the run-complete screen's
 * does, because it owns the screen and the world beneath it is halted.
 */

import { isVillageUnderSiege } from '../../../core/villageQuestPhase';
import type { BlueprintsStationId } from '../../../core/blueprintsQuestPhase';
import { viewportHeight, viewportWidth } from '../../../core/Viewport';
import {
  beginModalFit,
  drawBox,
  drawDivider,
  drawModal,
  drawOverlay,
  endModalFit,
  fitModal,
  MODAL_FIT_NONE,
  modalFitPoint,
  type ModalFit,
} from '../../../ui/Box';
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
} from '../../../ui/Button';
import { drawBlueprintsQuestIcon } from '../../../ui/icons/blueprintsQuestIcons';
import { drawRopeCoilGlyph, drawSawBladeGlyph } from '../../../ui/icons/stationGlyphs';
import { drawText, measureTextBox, measureTextWidth } from '../../../ui/TextBox';
import type { OverlayInputClaim } from '../../kits/OverlayClaims';
import { PLAIN_WOOD_PER_PRESS } from '../processingStations';
import { BOARDS_PER_WOOD, MANUAL_PROCESS_SECONDS, ROPE_PER_WOOD } from '../services/woodProcessing';
import type { BlueprintsQuestContext } from './blueprintsContext';
import { BLUEPRINTS_QUEST_NAME } from './blueprintsProgress';
import { UPGRADED_WOOD_PER_PRESS } from './StationUpgrades';

/** Focus ring id; the kit's overlay claim for the screen names the same one. */
export const BLUEPRINTS_COMPLETE_FOCUS_ID = 'blueprints-complete';

export const BLUEPRINTS_COMPLETE_KICKER = 'QUEST COMPLETE';
export const BLUEPRINTS_COMPLETE_TITLE = BLUEPRINTS_QUEST_NAME;
/** Fenna's word on the finished machines, in her own voice. */
export const BLUEPRINTS_COMPLETE_FLAVOUR =
  '"A saw that eats logs like butter, and a rope walk that don\'t need three of us on the crank." — Fenna';
export const BLUEPRINTS_REWARDS_HEADING = 'PERMANENT UPGRADES';
export const BLUEPRINTS_CONTINUE_LABEL = 'Continue';

/** One upgraded station as the screen lists it. */
export interface StationReward {
  readonly station: BlueprintsStationId;
  readonly name: string;
  /** What one press now takes in, against a plain station's. */
  readonly intake: string;
  /** What one press now puts out, against a plain station's. */
  readonly output: string;
}

/** A press's length as the screen says it: "1.2s". */
const PRESS_SECONDS_TEXT = `${MANUAL_PROCESS_SECONDS}s`;
const OUTPUT_MULTIPLIER = UPGRADED_WOOD_PER_PRESS / PLAIN_WOOD_PER_PRESS;

/**
 * What each upgraded station now does, worded from the constants the sawmill
 * works by, so the promise on screen is the machine's behaviour.
 */
export function blueprintsStationRewards(): readonly StationReward[] {
  const intake = `${UPGRADED_WOOD_PER_PRESS} wood per press (was ${PLAIN_WOOD_PER_PRESS})`;
  return [
    {
      station: 'saw',
      name: 'Upgraded Saw',
      intake,
      output: `${UPGRADED_WOOD_PER_PRESS * BOARDS_PER_WOOD} boards a press (was ${PLAIN_WOOD_PER_PRESS * BOARDS_PER_WOOD})`,
    },
    {
      station: 'ropeWalk',
      name: 'Upgraded Rope Walk',
      intake,
      output: `${UPGRADED_WOOD_PER_PRESS * ROPE_PER_WOOD} rope a press (was ${PLAIN_WOOD_PER_PRESS * ROPE_PER_WOOD})`,
    },
  ];
}

/** The line under the reward cards: the press is no slower, only fuller. */
export const BLUEPRINTS_REWARDS_FOOTNOTE = `Same ${PRESS_SECONDS_TEXT} press, ${OUTPUT_MULTIPLIER}x the output. Yours for good.`;

// ── Timeline (render frames) ────────────────────────────────────────────────
const FADE_IN_FRAMES = 18;
const CARDS_START_FRAME = 16;
const CARD_STAGGER_FRAMES = 12;
const CARD_FADE_FRAMES = 16;
/** Frames until everything has settled; a press before this finishes the reveal instead of leaving. */
export const BLUEPRINTS_COMPLETE_SETTLED_FRAMES =
  CARDS_START_FRAME + CARD_STAGGER_FRAMES + CARD_FADE_FRAMES;
const MS_PER_SECOND = 1000;
const TITLE_GLOW_PULSE_HZ = 0.6;
const TITLE_GLOW_MIN_BLUR = 10;
const TITLE_GLOW_BLUR_RANGE = 8;
const FULL_TURN = Math.PI * 2;
const GLYPH_SPIN_TURNS_PER_SECOND = 0.25;

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
const BRASS = '#d6a64a';
const BRASS_GLOW = '#fbbf24';

const ICON_SIZE = 44;
const ICON_GAP = 6;
const KICKER_SIZE = 14;
const KICKER_BLOCK_H = 22;
const KICKER_COLOR = '#a8f070';
const KICKER_GLOW = '#3a6a2a';
const TITLE_MAX_SIZE = 30;
const TITLE_BLOCK_GAP = 10;
const TITLE_COLOR = '#fcd34d';
const TITLE_OUTLINE = '#2a1804';
const TITLE_OUTLINE_WIDTH = 4;
const FLAVOUR_SIZE = 13;
const FLAVOUR_LINE_H = 18;
const FLAVOUR_COLOR = '#e8d9b8';
const SECTION_GAP = 14;
const DIVIDER_INSET = 36;
const DIVIDER_ALPHA = 0.6;
const HEADING_SIZE = 13;
const HEADING_BLOCK_H = 30;

const CARD_GAP = 12;
/** Narrower than this, the two cards stack instead of standing side by side. */
const CARDS_SIDE_BY_SIDE_MIN_WIDTH = 400;
const CARD_H = 118;
const CARD_RADIUS = 8;
const CARD_FILL = 'rgba(58, 39, 8, 0.72)';
const CARD_BORDER = '#8a6a2c';
const CARD_PAD_X = 10;
const CARD_GLYPH_RADIUS = 17;
const CARD_GLYPH_CENTRE_Y = 26;
const CARD_NAME_Y = 50;
const CARD_NAME_SIZE = 15;
const CARD_NAME_COLOR = '#fef3c7';
const CARD_INTAKE_Y = 72;
const CARD_INTAKE_SIZE = 12;
const CARD_INTAKE_COLOR = '#a8f070';
const CARD_OUTPUT_Y = 92;
const CARD_OUTPUT_SIZE = 12;
const CARD_OUTPUT_COLOR = '#f5d58a';
const FOOTNOTE_SIZE = 11;
const FOOTNOTE_LINE_H = 15;
const FOOTNOTE_PAD_Y = 7;
const FOOTNOTE_COLOR = '#b8a888';

const BUTTON_W = 200;
const BUTTON_H = 46;
const BUTTON_MARGIN_TOP = 12;

/** What the screen reads and raises: the quest's record, the screen's neighbours, its fanfare. */
export type BlueprintsCompletionContext = Pick<
  BlueprintsQuestContext,
  'state' | 'conversation' | 'worldHalted' | 'pleaPhase' | 'cue' | 'audio'
>;

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export class BlueprintsCompletionScreen {
  private open = false;
  private frame = 0;
  private fit: ModalFit = MODAL_FIT_NONE;
  private continueButton: ButtonResult | null = null;

  /**
   * @param isCelebrating - whether the last upgrade's callout is still up;
   *   the screen waits it out, so the machine is seen changing first.
   */
  constructor(
    private readonly ctx: BlueprintsCompletionContext,
    private readonly isCelebrating: () => boolean,
  ) {}

  get isOpen(): boolean {
    return this.open;
  }

  /** Whether the reveal has settled and Continue will leave rather than finish it. */
  get isSettled(): boolean {
    return this.frame >= BLUEPRINTS_COMPLETE_SETTLED_FRAMES;
  }

  /** Once per update, halted or not: raises the screen the first frame it is due and clear to. */
  update(): void {
    if (this.open || !this.isDue()) return;
    this.open = true;
    this.frame = 0;
    this.continueButton = null;
    clearMenuFocus();
    this.ctx.cue('questComplete');
  }

  private isDue(): boolean {
    const quest = this.ctx.state.blueprints;
    if (quest.phase !== 'complete' || quest.completionScreenSeen) return false;
    if (isVillageUnderSiege(this.ctx.pleaPhase())) return false;
    if (this.isCelebrating()) return false;
    return !this.ctx.conversation.isOpen && !this.ctx.worldHalted();
  }

  /**
   * Continue: finishes the reveal if it is still playing, otherwise records
   * the screen as seen and takes it down.
   */
  advance(): void {
    if (!this.open) return;
    if (!this.isSettled) {
      this.frame = BLUEPRINTS_COMPLETE_SETTLED_FRAMES;
      return;
    }
    playButtonSound(this.ctx.audio);
    this.ctx.state.blueprints.completionScreenSeen = true;
    this.close();
  }

  /** Takes the screen down without recording it as seen, for a rewind or a teardown. */
  close(): void {
    if (!this.open) return;
    this.open = false;
    this.continueButton = null;
    this.fit = MODAL_FIT_NONE;
    clearMenuFocus();
  }

  /** Every click or tap while the screen is up belongs to it; only Continue leaves. */
  handleClick(mx: number, my: number): boolean {
    if (!this.open) return false;
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
    if (!this.open) return false;
    if (key === 'Escape' && !repeat) this.advance();
    return true;
  }

  overlayClaim(): OverlayInputClaim {
    return {
      isOpen: this.open,
      space: { kind: 'swallow' },
      locksKeyboard: true,
      haltsWorld: true,
      focusContext: BLUEPRINTS_COMPLETE_FOCUS_ID,
    };
  }

  render(ctx: CanvasRenderingContext2D): void {
    if (!this.open) return;
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

    const stackCards = w - PANEL_SIDE_MARGIN * 2 < CARDS_SIDE_BY_SIDE_MIN_WIDTH;
    const rewards = blueprintsStationRewards();
    const cardsH = stackCards ? rewards.length * CARD_H + (rewards.length - 1) * CARD_GAP : CARD_H;
    const provisionalInnerW =
      Math.min(PANEL_MAX_WIDTH, w - PANEL_SIDE_MARGIN * 2) - PANEL_PAD_X * 2;
    const flavourLines = measureTextBox(ctx, BLUEPRINTS_COMPLETE_FLAVOUR, {
      size: FLAVOUR_SIZE,
      italic: true,
      width: provisionalInnerW,
      lineHeight: FLAVOUR_LINE_H,
    }).lineCount;
    const footnoteLines = measureTextBox(ctx, BLUEPRINTS_REWARDS_FOOTNOTE, {
      size: FOOTNOTE_SIZE,
      width: provisionalInnerW,
      lineHeight: FOOTNOTE_LINE_H,
    }).lineCount;
    const footnoteH = footnoteLines * FOOTNOTE_LINE_H + FOOTNOTE_PAD_Y * 2;
    const panelH =
      PANEL_PAD_TOP +
      ICON_SIZE +
      ICON_GAP +
      KICKER_BLOCK_H +
      TITLE_MAX_SIZE +
      TITLE_BLOCK_GAP +
      flavourLines * FLAVOUR_LINE_H +
      SECTION_GAP +
      HEADING_BLOCK_H +
      cardsH +
      footnoteH +
      BUTTON_MARGIN_TOP +
      BUTTON_H +
      PANEL_PAD_BOTTOM;

    this.fit = fitModal(panelH);
    const panelW = Math.min(PANEL_MAX_WIDTH, w - PANEL_SIDE_MARGIN * 2);
    beginModalFit(ctx, this.fit);
    setButtonPointerSpace(this.fit.scale, this.fit.pivotX, this.fit.pivotY);

    const panel = drawModal(ctx, {
      canvasWidth: w,
      canvasHeight: h,
      width: panelW,
      height: panelH,
      fill: PANEL_FILL,
      border: BRASS,
      borderWidth: PANEL_BORDER_WIDTH,
      radius: PANEL_RADIUS,
      glow: BRASS_GLOW,
      glowBlur: PANEL_GLOW_BLUR,
      alpha,
    });
    const innerX = panel.x + PANEL_PAD_X;
    const innerW = panel.width - PANEL_PAD_X * 2;
    const centreX = panel.x + panel.width / 2;
    let y = panel.y + PANEL_PAD_TOP;

    ctx.save();
    ctx.globalAlpha = alpha;
    drawBlueprintsQuestIcon(ctx, 'quest_blueprints', centreX - ICON_SIZE / 2, y, ICON_SIZE);
    ctx.restore();
    y += ICON_SIZE + ICON_GAP;

    drawText(ctx, BLUEPRINTS_COMPLETE_KICKER, {
      x: centreX,
      y,
      size: KICKER_SIZE,
      bold: true,
      color: KICKER_COLOR,
      align: 'center',
      glow: KICKER_GLOW,
      alpha,
    });
    y += KICKER_BLOCK_H;

    const titleWidthAtMax = measureTextWidth(ctx, BLUEPRINTS_COMPLETE_TITLE, {
      size: TITLE_MAX_SIZE,
      bold: true,
    });
    const titleSize = Math.floor(TITLE_MAX_SIZE * Math.min(1, innerW / titleWidthAtMax));
    const titleGlowPulse = (1 + Math.sin(nowSeconds * FULL_TURN * TITLE_GLOW_PULSE_HZ)) / 2;
    drawText(ctx, BLUEPRINTS_COMPLETE_TITLE, {
      x: centreX,
      y: y + (TITLE_MAX_SIZE - titleSize) / 2,
      size: titleSize,
      bold: true,
      color: TITLE_COLOR,
      align: 'center',
      glow: BRASS_GLOW,
      glowBlur: TITLE_GLOW_MIN_BLUR + TITLE_GLOW_BLUR_RANGE * titleGlowPulse,
      outline: TITLE_OUTLINE,
      outlineWidth: TITLE_OUTLINE_WIDTH,
      alpha,
    });
    y += TITLE_MAX_SIZE + TITLE_BLOCK_GAP;

    drawText(ctx, BLUEPRINTS_COMPLETE_FLAVOUR, {
      x: innerX,
      y,
      size: FLAVOUR_SIZE,
      italic: true,
      color: FLAVOUR_COLOR,
      align: 'center',
      width: innerW,
      lineHeight: FLAVOUR_LINE_H,
      alpha,
    });
    y += flavourLines * FLAVOUR_LINE_H + SECTION_GAP / 2;

    drawDivider(ctx, {
      x: panel.x + DIVIDER_INSET,
      y,
      length: panel.width - DIVIDER_INSET * 2,
      color: BRASS,
      alpha: alpha * DIVIDER_ALPHA,
    });
    y += SECTION_GAP / 2;

    drawText(ctx, BLUEPRINTS_REWARDS_HEADING, {
      x: centreX,
      y: y + (HEADING_BLOCK_H - HEADING_SIZE) / 2,
      size: HEADING_SIZE,
      bold: true,
      color: TITLE_COLOR,
      align: 'center',
      alpha,
    });
    y += HEADING_BLOCK_H;

    const cardW = stackCards ? innerW : (innerW - CARD_GAP) / 2;
    rewards.forEach((reward, index) => {
      const cardX = stackCards ? innerX : innerX + index * (cardW + CARD_GAP);
      const cardY = stackCards ? y + index * (CARD_H + CARD_GAP) : y;
      const reveal = clamp01(
        (this.frame - CARDS_START_FRAME - index * CARD_STAGGER_FRAMES) / CARD_FADE_FRAMES,
      );
      this.renderRewardCard(ctx, reward, cardX, cardY, cardW, alpha * reveal, nowSeconds);
    });
    y += cardsH;

    drawText(ctx, BLUEPRINTS_REWARDS_FOOTNOTE, {
      x: innerX,
      y: y + FOOTNOTE_PAD_Y,
      size: FOOTNOTE_SIZE,
      color: FOOTNOTE_COLOR,
      align: 'center',
      width: innerW,
      lineHeight: FOOTNOTE_LINE_H,
      alpha,
    });
    y += footnoteH + BUTTON_MARGIN_TOP;

    beginMenuFocus(BLUEPRINTS_COMPLETE_FOCUS_ID, true);
    this.continueButton = drawButton(ctx, {
      x: centreX,
      y,
      width: BUTTON_W,
      height: BUTTON_H,
      alignX: 'center',
      label: BLUEPRINTS_CONTINUE_LABEL,
      ...BUTTON_PRESETS.villageCelebration,
      primaryAction: true,
      alpha,
    });
    endMenuFocus();

    resetButtonPointerSpace();
    endModalFit(ctx);
  }

  private renderRewardCard(
    ctx: CanvasRenderingContext2D,
    reward: StationReward,
    x: number,
    y: number,
    width: number,
    alpha: number,
    nowSeconds: number,
  ): void {
    if (alpha <= 0) return;
    drawBox(ctx, {
      x,
      y,
      width,
      height: CARD_H,
      fill: CARD_FILL,
      border: CARD_BORDER,
      radius: CARD_RADIUS,
      alpha,
    });
    const centreX = x + width / 2;
    const glyphY = y + CARD_GLYPH_CENTRE_Y;
    ctx.save();
    ctx.globalAlpha = alpha;
    if (reward.station === 'saw') {
      // Turning, as the upgraded bench's blade does.
      ctx.translate(centreX, glyphY);
      ctx.rotate(nowSeconds * FULL_TURN * GLYPH_SPIN_TURNS_PER_SECOND);
      drawSawBladeGlyph(ctx, 0, 0, CARD_GLYPH_RADIUS);
    } else {
      drawRopeCoilGlyph(ctx, centreX, glyphY, CARD_GLYPH_RADIUS);
    }
    ctx.restore();

    const textX = x + CARD_PAD_X;
    const textW = width - CARD_PAD_X * 2;
    drawText(ctx, reward.name, {
      x: textX,
      y: y + CARD_NAME_Y,
      size: CARD_NAME_SIZE,
      bold: true,
      color: CARD_NAME_COLOR,
      align: 'center',
      width: textW,
      alpha,
    });
    drawText(ctx, reward.intake, {
      x: textX,
      y: y + CARD_INTAKE_Y,
      size: CARD_INTAKE_SIZE,
      bold: true,
      color: CARD_INTAKE_COLOR,
      align: 'center',
      width: textW,
      alpha,
    });
    drawText(ctx, reward.output, {
      x: textX,
      y: y + CARD_OUTPUT_Y,
      size: CARD_OUTPUT_SIZE,
      color: CARD_OUTPUT_COLOR,
      align: 'center',
      width: textW,
      alpha,
    });
  }
}
