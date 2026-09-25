/**
 * The Structure menu: a small panel hung over one construction, with its
 * health (and its spikes' health), and what can be done to it — upgrade,
 * repair, spikes, load, destroy, cancel.
 *
 * It is a presenter only. Its owner builds a {@link StructureMenuModel} every
 * frame from the live structure — so a wall breached while the menu is open
 * shows it at once — and each option carries its own action.
 *
 * Not world-halting: it is used in the middle of a siege. The owner closes it
 * when the crawler walks away.
 */

import type { AudioManager } from '../audio/AudioManager';
import type { OverlayInputClaim } from '../systems/kits/OverlayClaims';
import type { ResourceCost } from '../core/partyResources';
import { RESOURCE_IDS } from '../core/resourceIds';
import { platform } from '../core/Platform';
import { viewportHeight, viewportWidth } from '../core/Viewport';
import { BOX_PRESETS, PROGRESS_PRESETS, drawBox, drawProgressBar } from './Box';
import {
  BUTTON_PRESETS,
  addButton,
  beginMenuFocus,
  clearMenuFocus,
  endMenuFocus,
  playButtonSound,
} from './Button';
import { drawText, TEXT_PRESETS } from './TextBox';
import { drawResourceIcon } from './icons/resourceIcons';

export const STRUCTURE_MENU_FOCUS_ID = 'structure-menu';

export interface StructureMenuOption {
  readonly label: string;
  /** Shown as icons and numbers after the label; red lines the party is short of. */
  readonly cost?: ResourceCost;
  /** Why it cannot be chosen now; the option still shows, greyed, with this under it. */
  readonly disabledReason?: string;
  readonly style?: 'normal' | 'danger' | 'cancel';
  readonly action: () => void;
}

export interface StructureMenuModel {
  readonly title: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly spikesHp: number | null;
  readonly spikesMaxHp: number;
  /** An extra line under the bars, e.g. the trebuchet's ammunition. */
  readonly detail?: string;
  readonly options: readonly StructureMenuOption[];
  /** The structure's screen rectangle, which the panel hangs above. */
  readonly anchor: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
  };
}

const PANEL_WIDTH = 236;
const PADDING = 10;
const TITLE_HEIGHT = 20;
const BAR_HEIGHT = 7;
const BAR_GAP = 5;
const LABEL_SIZE = 10;
const DETAIL_HEIGHT = 16;
const OPTION_HEIGHT_DESKTOP = 30;
/** A thumb needs a bigger target than a pointer. */
const OPTION_HEIGHT_MOBILE = 44;
const OPTION_GAP = 5;
const ANCHOR_GAP = 8;
const SCREEN_MARGIN = 8;
const REASON_HEIGHT = 13;
const COST_ICON = 13;
const COST_SIZE = 10;
const COST_DIGIT_WIDTH = 7;
const COST_GAP = 6;
const COST_OK_COLOR = '#e2e8f0';
const COST_SHORT_COLOR = '#f87171';
const REASON_INDENT = 4;
const PANEL_RADIUS = 6;
/** A reason line sits a pixel under its option, so the two don't touch. */
const REASON_DROP = 1;
/** Room below a label's baseline, so an option's text centres on its letters rather than its box. */
const LABEL_DESCENT = 2;
const OPTION_LABEL_SIZE = LABEL_SIZE + 1;
const COST_ICON_GAP = 2;
const OPTION_TEXT_INSET = 8;

export class StructureMenu {
  private open = false;
  private buttons: Array<{ x: number; y: number; w: number; h: number; action?: () => void }> = [];
  /** Which of `buttons` can be pressed, index for index. */
  private enabled: boolean[] = [];
  private panel: { x: number; y: number; w: number; h: number } | null = null;

  constructor(private readonly audio: AudioManager | null) {}

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    if (!this.open) this.audio?.play('menu_open');
    this.open = true;
    clearMenuFocus();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.buttons = [];
    this.panel = null;
    clearMenuFocus();
  }

  render(
    ctx: CanvasRenderingContext2D,
    model: StructureMenuModel,
    stockOf: (id: (typeof RESOURCE_IDS)[number]) => number,
  ): void {
    if (!this.open) return;
    const optionHeight = platform.isMobile ? OPTION_HEIGHT_MOBILE : OPTION_HEIGHT_DESKTOP;
    const optionBlock = (option: StructureMenuOption) =>
      optionHeight + (option.disabledReason === undefined ? 0 : REASON_HEIGHT) + OPTION_GAP;
    const barsHeight = BAR_HEIGHT + BAR_GAP + (model.spikesHp === null ? 0 : BAR_HEIGHT + BAR_GAP);
    const height =
      PADDING +
      TITLE_HEIGHT +
      (model.maxHp > 0 ? barsHeight : 0) +
      (model.detail === undefined ? 0 : DETAIL_HEIGHT) +
      model.options.reduce((sum, option) => sum + optionBlock(option), 0) +
      PADDING;
    const width = Math.min(PANEL_WIDTH, viewportWidth() - SCREEN_MARGIN * 2);
    const anchorCentre = model.anchor.x + model.anchor.w / 2;
    let x = anchorCentre - width / 2;
    let y = model.anchor.y - ANCHOR_GAP - height;
    // Hung below the structure when there is no room above it.
    if (y < SCREEN_MARGIN) y = model.anchor.y + model.anchor.h + ANCHOR_GAP;
    x = clamp(x, SCREEN_MARGIN, viewportWidth() - SCREEN_MARGIN - width);
    y = clamp(y, SCREEN_MARGIN, viewportHeight() - SCREEN_MARGIN - height);
    this.panel = { x, y, w: width, h: height };

    drawBox(ctx, { x, y, width, height, radius: PANEL_RADIUS, shadow: true, ...BOX_PRESETS.panel });
    const left = x + PADDING;
    const inner = width - PADDING * 2;
    let cursor = y + PADDING;
    drawText(ctx, model.title, { x: left, y: cursor, ...TEXT_PRESETS.heading });
    cursor += TITLE_HEIGHT;
    if (model.maxHp > 0) {
      drawProgressBar(ctx, {
        x: left,
        y: cursor,
        width: inner,
        height: BAR_HEIGHT,
        value: model.hp / model.maxHp,
        ...PROGRESS_PRESETS.structureHp,
      });
      cursor += BAR_HEIGHT + BAR_GAP;
      if (model.spikesHp !== null) {
        drawProgressBar(ctx, {
          x: left,
          y: cursor,
          width: inner,
          height: BAR_HEIGHT,
          value: model.spikesMaxHp > 0 ? model.spikesHp / model.spikesMaxHp : 0,
          ...PROGRESS_PRESETS.spikes,
        });
        cursor += BAR_HEIGHT + BAR_GAP;
      }
    }
    if (model.detail !== undefined) {
      drawText(ctx, model.detail, { x: left, y: cursor, ...TEXT_PRESETS.hint, size: LABEL_SIZE });
      cursor += DETAIL_HEIGHT;
    }

    this.buttons = [];
    this.enabled = [];
    beginMenuFocus(STRUCTURE_MENU_FOCUS_ID);
    for (const option of model.options) {
      const disabled = option.disabledReason !== undefined;
      const preset =
        option.style === 'danger'
          ? BUTTON_PRESETS.danger
          : option.style === 'cancel'
            ? BUTTON_PRESETS.primary
            : BUTTON_PRESETS.trackerRow;
      addButton(ctx, this.buttons, {
        x: left,
        y: cursor,
        width: inner,
        height: optionHeight,
        label: option.cost === undefined ? option.label : '',
        disabled,
        ...preset,
        action: () => {
          playButtonSound(this.audio);
          option.action();
        },
      });
      this.enabled.push(!disabled);
      if (option.cost !== undefined)
        this.renderCostLabel(ctx, option, left, cursor, inner, optionHeight, stockOf);
      cursor += optionHeight;
      if (option.disabledReason !== undefined) {
        drawText(ctx, option.disabledReason, {
          x: left + REASON_INDENT,
          y: cursor + REASON_DROP,
          ...TEXT_PRESETS.hint,
          size: LABEL_SIZE,
        });
        cursor += REASON_HEIGHT;
      }
      cursor += OPTION_GAP;
    }
    endMenuFocus();
  }

  private renderCostLabel(
    ctx: CanvasRenderingContext2D,
    option: StructureMenuOption,
    x: number,
    y: number,
    width: number,
    height: number,
    stockOf: (id: (typeof RESOURCE_IDS)[number]) => number,
  ): void {
    const textY = y + (height - LABEL_SIZE - LABEL_DESCENT) / 2;
    drawText(ctx, option.label, {
      x: x + OPTION_TEXT_INSET,
      y: textY,
      ...TEXT_PRESETS.label,
      size: OPTION_LABEL_SIZE,
    });
    const cost = option.cost ?? {};
    let cursor = x + width - OPTION_TEXT_INSET;
    const lines = RESOURCE_IDS.filter((id) => (cost[id] ?? 0) > 0);
    if (lines.length === 0) {
      drawText(ctx, 'Free', {
        x: cursor,
        y: textY,
        align: 'right',
        ...TEXT_PRESETS.success,
        size: COST_SIZE,
      });
      return;
    }
    for (const id of [...lines].reverse()) {
      const amount = cost[id] ?? 0;
      const text = String(amount);
      drawText(ctx, text, {
        x: cursor,
        y: textY,
        align: 'right',
        size: COST_SIZE,
        bold: true,
        color: stockOf(id) >= amount ? COST_OK_COLOR : COST_SHORT_COLOR,
      });
      cursor -= text.length * COST_DIGIT_WIDTH + COST_ICON_GAP + COST_ICON;
      drawResourceIcon(ctx, id, cursor, y + (height - COST_ICON) / 2, COST_ICON);
      cursor -= COST_GAP;
    }
  }

  /** A click or tap on the panel. Returns whether it landed on it. */
  handleClick(mx: number, my: number): boolean {
    const panel = this.panel;
    if (!this.open || panel === null) return false;
    for (const [index, button] of this.buttons.entries()) {
      const inside =
        mx >= button.x && mx <= button.x + button.w && my >= button.y && my <= button.y + button.h;
      if (!inside) continue;
      if (this.enabled[index]) button.action?.();
      return true;
    }
    return mx >= panel.x && mx <= panel.x + panel.w && my >= panel.y && my <= panel.y + panel.h;
  }

  /** Escape closes it. */
  handleKey(key: string): boolean {
    if (!this.open || key !== 'Escape') return false;
    this.close();
    return true;
  }

  overlayClaim(): OverlayInputClaim {
    return {
      isOpen: this.open,
      space: { kind: 'swallow' },
      locksKeyboard: true,
      haltsWorld: false,
      focusContext: STRUCTURE_MENU_FOCUS_ID,
    };
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
