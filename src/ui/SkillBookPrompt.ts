import type { SkillId } from '../core/SkillManager';
import { getSkillDef } from '../core/SkillManager';
import type { ItemId } from '../core/ItemDefs';
import type { SkillBookReadRequest } from './InventoryInteraction';
import type { AudioManager } from '../audio/AudioManager';
import { wrapTextLines } from './canvasUtils';
import { drawText } from './TextBox';
import { drawOverlay, drawModal } from './Box';
import {
  beginMenuFocus,
  drawButton,
  endMenuFocus,
  BUTTON_PRESETS,
  playButtonSound,
} from './Button';
import { drawSkillIcon } from './icons/skillIcons';
import { pointInRect } from '../utils';
import { viewportWidth, viewportHeight } from '../core/Viewport';

// Panel
const PANEL_MAX_WIDTH = 340;
const PANEL_HORIZONTAL_MARGIN = 32;
const PANEL_MIN_HEIGHT = 250;
const PANEL_BASE_HEIGHT = 208;
const OVERLAY_ALPHA = 0.72;

// Layout
const TITLE_Y_OFFSET = 20;
const TITLE_SIZE = 16;
const ICON_SIZE = 48;
const ICON_Y_OFFSET = 44;
const NAME_Y_GAP = 18;
const NAME_SIZE = 13;
const BODY_Y_GAP = 20;
const BODY_SIZE = 11;
const BODY_LINE_HEIGHT = 15;
const BODY_WIDTH_MARGIN = 36;
const WARNING_Y_GAP = 8;
const WARNING_SIZE = 10;

// Buttons
const BUTTON_WIDTH = 116;
const BUTTON_HEIGHT = 34;
const BUTTON_GAP = 12;
const BUTTON_BOTTOM_OFFSET = 50;

const TITLE_COLOR = '#e9d5ff';
const NAME_COLOR = '#f5f3ff';
const BODY_COLOR = '#c4b5fd';
const WARNING_COLOR = '#fbbf24';
const PANEL_FILL = '#0f172a';
const PANEL_BORDER = '#a855f7';
const PANEL_BORDER_WIDTH = 2.5;

/** What the player chose, or null while the prompt is still up. */
export type SkillBookChoice = 'read' | 'cancel';

/** The choice plus the book it was made about, so the caller need hold no state. */
export interface SkillBookPromptResult {
  choice: SkillBookChoice;
  bookId: ItemId;
  skillId: SkillId;
}

interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

const EMPTY_RECT: Rect = { x: 0, y: 0, w: 0, h: 0 };

/**
 * Confirmation the player gets before spending a skill book.
 *
 * Reading one is irreversible and the book is consumed, so it is the one
 * inventory interaction that asks first. The wording changes with what the read
 * would actually do — teach the skill, or push a skill already known one level
 * higher — which is decided from the reader's own `SkillManager`, not from the
 * item.
 */
export class SkillBookPrompt {
  private request: SkillBookReadRequest | null = null;
  private currentLevel = 0;
  private readBtn: Rect = EMPTY_RECT;
  private cancelBtn: Rect = EMPTY_RECT;
  /** Wrapped body text, together with the panel width it was measured at. */
  private cachedBody: { width: number; lines: string[] } | null = null;

  audio: AudioManager | null = null;

  get isOpen(): boolean {
    return this.request !== null;
  }

  /**
   * @param currentLevel The reader's level in this skill, or 0 if they have yet
   *   to learn it — that is what decides between "grant" and "+1" wording.
   */
  open(request: SkillBookReadRequest, currentLevel: number): void {
    // Re-opening on the same book is a no-op: a mobile hotbar tap arrives as
    // both a slot release and an activation, and the second must not re-play
    // the open cue over the first.
    if (this.request?.bookId === request.bookId) return;
    this.request = request;
    this.currentLevel = currentLevel;
    this.cachedBody = null;
    this.audio?.play('menu_open');
  }

  close(): void {
    this.request = null;
    this.cachedBody = null;
  }

  private body(): string {
    if (this.request === null) return '';
    const def = getSkillDef(this.request.skillId);
    if (this.currentLevel <= 0) {
      return `Reading this book will permanently grant you the ${def.name} skill.`;
    }
    return (
      `You already know ${def.name}. Reading this book will permanently ` +
      `increase the skill level by +1, to level ${this.currentLevel + 1}.`
    );
  }

  /**
   * Returns the player's choice when a button was hit, or null when the click
   * landed elsewhere. The prompt closes itself on either choice; the caller is
   * responsible for acting on 'read'.
   */
  handleClick(mx: number, my: number): SkillBookPromptResult | null {
    const request = this.request;
    if (request === null) return null;
    const choice = pointInRect(mx, my, this.readBtn)
      ? 'read'
      : pointInRect(mx, my, this.cancelBtn)
        ? 'cancel'
        : null;
    if (choice === null) return null;
    playButtonSound(this.audio);
    this.close();
    return { choice, ...request };
  }

  render(ctx: CanvasRenderingContext2D): void {
    const request = this.request;
    if (request === null) return;
    const def = getSkillDef(request.skillId);

    const cw = viewportWidth();
    const ch = viewportHeight();
    drawOverlay(ctx, { canvasWidth: cw, canvasHeight: ch, alpha: OVERLAY_ALPHA });

    const boxW = Math.min(PANEL_MAX_WIDTH, cw - PANEL_HORIZONTAL_MARGIN);
    const bodyText = this.body();
    // Re-wrapped when the panel width changes, so a window resize while the
    // prompt is up cannot leave the warning line floating off the body text.
    if (this.cachedBody?.width !== boxW) {
      ctx.font = `${BODY_SIZE}px monospace`;
      this.cachedBody = {
        width: boxW,
        lines: wrapTextLines(ctx, bodyText, boxW - BODY_WIDTH_MARGIN),
      };
    }
    const bodyLineCount = this.cachedBody.lines.length;
    const boxH = Math.min(
      Math.max(PANEL_MIN_HEIGHT, PANEL_BASE_HEIGHT + bodyLineCount * BODY_LINE_HEIGHT),
      ch - PANEL_HORIZONTAL_MARGIN,
    );

    const { x: bx, y: by } = drawModal(ctx, {
      canvasWidth: cw,
      canvasHeight: ch,
      width: boxW,
      height: boxH,
      fill: PANEL_FILL,
      border: PANEL_BORDER,
      borderWidth: PANEL_BORDER_WIDTH,
    });

    drawText(ctx, 'Read Skill Book?', {
      x: bx + boxW / 2,
      y: by + TITLE_Y_OFFSET,
      size: TITLE_SIZE,
      bold: true,
      color: TITLE_COLOR,
      align: 'center',
    });

    const iconX = bx + boxW / 2 - ICON_SIZE / 2;
    const iconY = by + ICON_Y_OFFSET;
    drawSkillIcon(ctx, iconX, iconY, ICON_SIZE, request.skillId);

    const nameY = iconY + ICON_SIZE + NAME_Y_GAP;
    drawText(ctx, def.name, {
      x: bx + boxW / 2,
      y: nameY,
      size: NAME_SIZE,
      bold: true,
      color: NAME_COLOR,
      align: 'center',
    });

    const bodyY = nameY + BODY_Y_GAP;
    drawText(ctx, bodyText, {
      x: bx + BODY_WIDTH_MARGIN / 2,
      y: bodyY,
      size: BODY_SIZE,
      color: BODY_COLOR,
      align: 'center',
      width: boxW - BODY_WIDTH_MARGIN,
      lineHeight: BODY_LINE_HEIGHT,
    });

    drawText(ctx, 'The book is consumed. This cannot be undone.', {
      x: bx + BODY_WIDTH_MARGIN / 2,
      y: bodyY + bodyLineCount * BODY_LINE_HEIGHT + WARNING_Y_GAP,
      size: WARNING_SIZE,
      color: WARNING_COLOR,
      align: 'center',
      width: boxW - BODY_WIDTH_MARGIN,
      lineHeight: BODY_LINE_HEIGHT,
    });

    const buttonsY = by + boxH - BUTTON_BOTTOM_OFFSET;
    const totalButtonsW = BUTTON_WIDTH * 2 + BUTTON_GAP;
    const readX = bx + boxW / 2 - totalButtonsW / 2;
    const cancelX = readX + BUTTON_WIDTH + BUTTON_GAP;
    this.readBtn = { x: readX, y: buttonsY, w: BUTTON_WIDTH, h: BUTTON_HEIGHT };
    this.cancelBtn = { x: cancelX, y: buttonsY, w: BUTTON_WIDTH, h: BUTTON_HEIGHT };

    beginMenuFocus('skill-book-prompt');
    drawButton(ctx, {
      x: readX,
      y: buttonsY,
      width: BUTTON_WIDTH,
      height: BUTTON_HEIGHT,
      label: 'Read',
      ...BUTTON_PRESETS.award,
      primaryAction: true,
    });
    drawButton(ctx, {
      x: cancelX,
      y: buttonsY,
      width: BUTTON_WIDTH,
      height: BUTTON_HEIGHT,
      label: 'Cancel',
      ...BUTTON_PRESETS.primary,
    });
    endMenuFocus();
  }
}
