/**
 * The Construction menu: what the active crawler can build, what it costs
 * them, how long it takes them, and — for anything they cannot build right
 * now — why not.
 *
 * Every number on it is the active crawler's own: Carl and Donut each level
 * Construction separately, so costs, build times and discounts change when the
 * player switches crawler. The resource row is the party's combined stock,
 * the same as the resource strip.
 *
 * Choosing an enabled row closes the menu and starts the job at once, in
 * front of the crawler. Hovering or focusing a row (or tapping a disabled one,
 * on a phone) asks the owner to draw its placement ghost in the world, which
 * is how "build in front of you" stays predictable.
 *
 * Not world-halting: it is opened mid-siege, and the crawler it builds for
 * has to stay live under it. It does lock the keyboard, so number keys and
 * the rest of the hotbar cannot act behind it.
 */

import type { AudioManager } from '../audio/AudioManager';
import type { OverlayInputClaim } from '../systems/kits/OverlayClaims';
import type { BuildOption, OptionStatus } from '../systems/briarHollow/ConstructionSystem';
import type { CraftSkills } from '../core/CraftSkills';
import type { ResourceCost } from '../core/partyResources';
import { RESOURCE_IDS, type ResourceId } from '../core/resourceIds';
import { keybindings } from '../core/Keybindings';
import { platform } from '../core/Platform';
import { viewportHeight, viewportWidth } from '../core/Viewport';
import {
  BOX_PRESETS,
  PROGRESS_PRESETS,
  beginModalFit,
  drawBox,
  drawModal,
  drawProgressBar,
  endModalFit,
  modalFitPoint,
  type ModalFit,
} from './Box';
import {
  BUTTON_PRESETS,
  addButton,
  beginMenuFocus,
  clearMenuFocus,
  endMenuFocus,
  playButtonSound,
  pointerOverRect,
  resetButtonPointerSpace,
  setButtonPointerSpace,
  type ButtonResult,
} from './Button';
import { drawText, TEXT_PRESETS } from './TextBox';
import { fitPanel } from './panelFit';
import { drawResourceIcon } from './icons/resourceIcons';
import { drawKitIcon } from './icons/kitIcons';
import { drawConstructionIcon } from './icons/constructionIcon';
import { paintPalisadeForReview, PALISADE_DIRS } from '../map/tiles/hollowPalisadeTiles';

export const CONSTRUCTION_MENU_FOCUS_ID = 'construction-menu';

/** What the menu needs from whoever owns building in this scene. */
export interface ConstructionMenuSource {
  /** Every row, in menu order, as the active crawler sees it now. */
  rows(): readonly OptionStatus[];
  /** Starts a row's job. Returns whether it started. */
  start(option: BuildOption): boolean;
  /** The row whose ghost the world should draw, or null for none. */
  setPreview(option: BuildOption | null): void;
}

/** The active crawler's header line. */
export interface ConstructionMenuCrawler {
  readonly name: string;
  readonly skills: CraftSkills;
}

const PANEL_WIDTH = 440;
const PADDING = 16;
const TITLE_SIZE = 16;
const TITLE_HEIGHT = 24;
const LEVEL_LINE_HEIGHT = 16;
const XP_BAR_HEIGHT = 7;
const XP_BAR_GAP = 10;
const RESOURCE_ROW_HEIGHT = 34;
const RESOURCE_ICON = 22;
const RESOURCE_GAP_BELOW = 10;
const ROW_HEIGHT = 62;
const ROW_GAP = 6;
const ROW_ICON = 40;
const ROW_ICON_PAD = 10;
const ROW_TEXT_X = ROW_ICON_PAD * 2 + ROW_ICON;
const COST_ICON = 14;
const COST_ITEM_GAP = 10;
const COST_NUMBER_GAP = 3;
const COST_NUMBER_WIDTH_PER_DIGIT = 7;
const FOOTER_HEIGHT = 24;
const CLOSE_SIZE = 28;
const NAME_SIZE = 13;
const DETAIL_SIZE = 11;
const STATUS_READY_COLOR = '#86efac';
const STATUS_BLOCKED_COLOR = '#94a3b8';
const COST_OK_COLOR = '#e2e8f0';
const COST_SHORT_COLOR = '#f87171';
const STRUCK_COLOR = '#64748b';
/** The mini palisade in a wall row's icon is drawn at this share of the icon box. */
const WALL_ICON_TILE_SHARE = 0.5;
const SECONDS_DECIMALS = 1;
const TITLE_ICON_GAP = 8;
const CLOSE_RAISE = 4;
const FOOTER_TEXT_GAP = 4;
const RESOURCE_NUMBER_GAP = 4;
/** Where each line of a row sits, down from the row's top. */
const ROW_NAME_Y = 6;
const ROW_COST_Y = 24;
const ROW_STATUS_Y = 43;
const STATUS_LEADING = 3;
const PANEL_RADIUS = 8;
const RESOURCE_BOX_RADIUS = 4;
/** The title icon sits a hair above the title's cap line, so the two read as one line. */
const TITLE_ICON_RAISE = 2;
const RESOURCE_NUMBER_INSET = 2;
/** Cost icons ride a pixel high, so they centre on the digits beside them. */
const COST_ICON_RAISE = 1;
const ROW_NAME_COLOR = '#f1f5f9';
const ROW_NAME_DISABLED_COLOR = STATUS_BLOCKED_COLOR;

/**
 * A row has to be at least this tall on screen for a thumb, whatever the
 * panel is scaled to. Below it the menu switches to its compact layout.
 */
const MIN_TOUCH_ROW_PX = 44;
/**
 * The compact layout, for a screen too short to show every row full size:
 * two columns of short rows, each showing its cost when it can be built and
 * the reason when it cannot, in place of both.
 */
const COMPACT_COLUMNS = 2;
const COMPACT_ROW_HEIGHT = 48;
const COMPACT_ROW_GAP = 4;
const COMPACT_COLUMN_GAP = 8;
const COMPACT_ICON = 28;
const COMPACT_ICON_PAD = 6;
const COMPACT_TEXT_X = COMPACT_ICON_PAD * 2 + COMPACT_ICON;
const COMPACT_NAME_SIZE = 12;
const COMPACT_NAME_Y = 6;
const COMPACT_DETAIL_Y = 26;
const COMPACT_DETAIL_SIZE = 10;
/** Room under the compact rows for the one-line hint. */
const COMPACT_FOOTER_HEIGHT = 14;

interface MenuLayout {
  readonly compact: boolean;
  readonly height: number;
}

interface RowHit {
  readonly option: BuildOption;
  readonly enabled: boolean;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export class ConstructionMenu {
  private open = false;
  private readOnly = false;
  private fit: ModalFit = { scale: 1, pivotX: 0, pivotY: 0 };
  private modalContains: ((px: number, py: number) => boolean) | null = null;
  private buttons: Array<{ x: number; y: number; w: number; h: number; action?: () => void }> = [];
  private rowHits: RowHit[] = [];
  private closeButton: ButtonResult | null = null;
  /** A disabled row tapped on a phone, whose ghost stays up until something else is chosen. */
  private tappedPreview: BuildOption | null = null;
  private source: ConstructionMenuSource | null = null;

  constructor(private readonly audio: AudioManager | null) {}

  get isOpen(): boolean {
    return this.open;
  }

  get isReadOnly(): boolean {
    return this.readOnly;
  }

  /** Opens the menu over `source`. Read-only shows every row disabled, for indoors. */
  openWith(source: ConstructionMenuSource, readOnly: boolean): void {
    this.source = source;
    this.readOnly = readOnly;
    this.open = true;
    this.tappedPreview = null;
    clearMenuFocus();
    this.audio?.play('menu_open');
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.source?.setPreview(null);
    this.tappedPreview = null;
    this.buttons = [];
    this.rowHits = [];
    this.modalContains = null;
    clearMenuFocus();
  }

  private headerHeight(): number {
    return (
      PADDING +
      TITLE_HEIGHT +
      LEVEL_LINE_HEIGHT +
      XP_BAR_HEIGHT +
      XP_BAR_GAP +
      RESOURCE_ROW_HEIGHT +
      RESOURCE_GAP_BELOW
    );
  }

  /**
   * The full layout when its rows stay thumb-sized once the panel is fitted to
   * the screen, the compact one otherwise.
   */
  private layoutFor(rowCount: number): MenuLayout {
    const fullHeight =
      this.headerHeight() + rowCount * (ROW_HEIGHT + ROW_GAP) + FOOTER_HEIGHT + PADDING;
    const fullScale = fitPanel(PANEL_WIDTH, fullHeight).scale;
    if (ROW_HEIGHT * fullScale >= MIN_TOUCH_ROW_PX) return { compact: false, height: fullHeight };
    const rowsPerColumn = Math.ceil(rowCount / COMPACT_COLUMNS);
    const compactHeight =
      this.headerHeight() +
      rowsPerColumn * (COMPACT_ROW_HEIGHT + COMPACT_ROW_GAP) +
      COMPACT_FOOTER_HEIGHT +
      PADDING;
    return { compact: true, height: compactHeight };
  }

  render(
    ctx: CanvasRenderingContext2D,
    crawler: ConstructionMenuCrawler,
    partyCount: (id: ResourceId) => number,
  ): void {
    const source = this.source;
    if (!this.open || source === null) return;
    const rows = source.rows();
    const layout = this.layoutFor(rows.length);
    const height = layout.height;
    this.fit = fitPanel(PANEL_WIDTH, height);
    beginModalFit(ctx, this.fit);
    setButtonPointerSpace(this.fit.scale, this.fit.pivotX, this.fit.pivotY);
    const modal = drawModal(ctx, {
      canvasWidth: viewportWidth(),
      canvasHeight: viewportHeight(),
      width: PANEL_WIDTH,
      height,
      radius: PANEL_RADIUS,
      shadow: true,
      ...BOX_PRESETS.panel,
    });
    this.modalContains = (px, py) => modal.contains(px, py);
    this.buttons = [];
    this.rowHits = [];
    const left = modal.x + PADDING;
    const innerWidth = modal.width - PADDING * 2;
    let y = modal.y + PADDING;

    beginMenuFocus(CONSTRUCTION_MENU_FOCUS_ID);
    drawConstructionIcon(ctx, left, y - TITLE_ICON_RAISE, TITLE_HEIGHT);
    drawText(ctx, `Construction — ${crawler.name}`, {
      x: left + TITLE_HEIGHT + TITLE_ICON_GAP,
      y,
      ...TEXT_PRESETS.heading,
      size: TITLE_SIZE,
    });
    this.closeButton = addButton(ctx, this.buttons, {
      x: modal.x + modal.width - PADDING - CLOSE_SIZE,
      y: y - CLOSE_RAISE,
      width: CLOSE_SIZE,
      height: CLOSE_SIZE,
      label: '✕',
      ...BUTTON_PRESETS.primary,
      action: () => this.close(),
    });
    y += TITLE_HEIGHT;

    const level = crawler.skills.getLevel('construction');
    const xpToNext = crawler.skills.xpToNext('construction');
    const xp = crawler.skills.getXp('construction');
    const levelText = Number.isFinite(xpToNext)
      ? `Level ${level} · ${Math.floor(xp)} / ${Math.floor(xpToNext)} XP`
      : `Level ${level} · mastered`;
    drawText(ctx, levelText, { x: left, y, ...TEXT_PRESETS.hint, size: DETAIL_SIZE });
    y += LEVEL_LINE_HEIGHT;
    drawProgressBar(ctx, {
      x: left,
      y,
      width: innerWidth,
      height: XP_BAR_HEIGHT,
      value: Number.isFinite(xpToNext) && xpToNext > 0 ? xp / xpToNext : 1,
      ...PROGRESS_PRESETS.construction,
    });
    y += XP_BAR_HEIGHT + XP_BAR_GAP;

    this.renderResources(ctx, left, y, innerWidth, partyCount);
    y += RESOURCE_ROW_HEIGHT + RESOURCE_GAP_BELOW;

    let preview: BuildOption | null = this.tappedPreview;
    const rowsTop = y;
    const rowsPerColumn = Math.ceil(rows.length / COMPACT_COLUMNS);
    const columnWidth = (innerWidth - COMPACT_COLUMN_GAP * (COMPACT_COLUMNS - 1)) / COMPACT_COLUMNS;
    rows.forEach((row, index) => {
      const enabled = row.enabled && !this.readOnly;
      const column = layout.compact ? Math.floor(index / rowsPerColumn) : 0;
      const rowInColumn = layout.compact ? index % rowsPerColumn : index;
      const rowHeight = layout.compact ? COMPACT_ROW_HEIGHT : ROW_HEIGHT;
      const rowGap = layout.compact ? COMPACT_ROW_GAP : ROW_GAP;
      const rowWidth = layout.compact ? columnWidth : innerWidth;
      const rowX = left + column * (columnWidth + COMPACT_COLUMN_GAP);
      const rowY = rowsTop + rowInColumn * (rowHeight + rowGap);
      const result = addButton(ctx, this.buttons, {
        x: rowX,
        y: rowY,
        width: rowWidth,
        height: rowHeight,
        label: '',
        disabled: !enabled,
        ...BUTTON_PRESETS.trackerRow,
        action: () => this.choose(row.option),
      });
      this.rowHits.push({
        option: row.option,
        enabled,
        x: rowX,
        y: rowY,
        w: rowWidth,
        h: rowHeight,
      });
      if (result.focused || pointerOverRect(rowX, rowY, rowWidth, rowHeight)) preview = row.option;
      if (layout.compact)
        this.renderCompactRow(ctx, row, rowX, rowY, rowWidth, enabled, partyCount);
      else this.renderRow(ctx, row, rowX, rowY, rowWidth, enabled, partyCount);
      y = Math.max(y, rowY + rowHeight + rowGap);
    });
    endMenuFocus();

    const structureKey = keybindings.labelFor('structureMenu');
    // The only place a phone player is told about the long-press, so the
    // compact layout keeps a short version of it.
    const hint = layout.compact
      ? platform.isMobile
        ? 'Long-press a construction to repair'
        : `${structureKey}: repair, spikes, destroy`
      : platform.isMobile
        ? 'Long-press a construction: repair, spikes, destroy'
        : `${structureKey} on a construction: repair, spikes, destroy`;
    drawText(ctx, hint, {
      x: modal.x + modal.width / 2,
      y: y + FOOTER_TEXT_GAP,
      align: 'center',
      ...TEXT_PRESETS.hint,
    });

    endModalFit(ctx);
    resetButtonPointerSpace();
    source.setPreview(this.readOnly ? null : preview);
  }

  private renderResources(
    ctx: CanvasRenderingContext2D,
    left: number,
    y: number,
    width: number,
    partyCount: (id: ResourceId) => number,
  ): void {
    drawBox(ctx, {
      x: left,
      y,
      width,
      height: RESOURCE_ROW_HEIGHT,
      radius: RESOURCE_BOX_RADIUS,
      ...BOX_PRESETS.panel,
    });
    const cell = width / RESOURCE_IDS.length;
    RESOURCE_IDS.forEach((id, index) => {
      const cellX = left + index * cell;
      const iconY = y + (RESOURCE_ROW_HEIGHT - RESOURCE_ICON) / 2;
      drawResourceIcon(
        ctx,
        id,
        cellX + cell / 2 - RESOURCE_ICON - RESOURCE_NUMBER_GAP,
        iconY,
        RESOURCE_ICON,
      );
      drawText(ctx, String(partyCount(id)), {
        x: cellX + cell / 2 + RESOURCE_NUMBER_INSET,
        y: y + (RESOURCE_ROW_HEIGHT - NAME_SIZE) / 2,
        ...TEXT_PRESETS.value,
        size: NAME_SIZE,
      });
    });
  }

  private renderRow(
    ctx: CanvasRenderingContext2D,
    row: OptionStatus,
    x: number,
    y: number,
    width: number,
    enabled: boolean,
    partyCount: (id: ResourceId) => number,
  ): void {
    const iconX = x + ROW_ICON_PAD;
    const iconY = y + (ROW_HEIGHT - ROW_ICON) / 2;
    this.renderRowIcon(ctx, row.option, iconX, iconY);
    const textX = x + ROW_TEXT_X;
    drawText(ctx, row.label, {
      x: textX,
      y: y + ROW_NAME_Y,
      ...TEXT_PRESETS.heading,
      size: NAME_SIZE,
      color: enabled ? ROW_NAME_COLOR : ROW_NAME_DISABLED_COLOR,
    });
    drawText(ctx, `${row.seconds.toFixed(SECONDS_DECIMALS)} s`, {
      x: x + width - ROW_ICON_PAD,
      y: y + ROW_NAME_Y,
      align: 'right',
      ...TEXT_PRESETS.hint,
      size: DETAIL_SIZE,
    });
    const costY = y + ROW_COST_Y;
    if (row.usesKit) {
      drawText(ctx, `Use kit (${row.kits})`, {
        x: textX,
        y: costY,
        ...TEXT_PRESETS.success,
        size: DETAIL_SIZE,
      });
    } else {
      this.renderCost(ctx, row, textX, costY, partyCount);
    }
    const status = this.readOnly ? 'Build outdoors' : row.status;
    drawText(ctx, status, {
      x: textX,
      y: y + ROW_STATUS_Y,
      size: DETAIL_SIZE,
      color: enabled ? STATUS_READY_COLOR : STATUS_BLOCKED_COLOR,
      width: width - ROW_TEXT_X - ROW_ICON_PAD,
      lineHeight: DETAIL_SIZE + STATUS_LEADING,
      height: DETAIL_SIZE + STATUS_LEADING,
    });
  }

  /** A compact row: icon and name, then the cost if it can be built or the reason if not. */
  private renderCompactRow(
    ctx: CanvasRenderingContext2D,
    row: OptionStatus,
    x: number,
    y: number,
    width: number,
    enabled: boolean,
    partyCount: (id: ResourceId) => number,
  ): void {
    this.renderRowIcon(
      ctx,
      row.option,
      x + COMPACT_ICON_PAD,
      y + (COMPACT_ROW_HEIGHT - COMPACT_ICON) / 2,
      COMPACT_ICON,
    );
    const textX = x + COMPACT_TEXT_X;
    const textWidth = width - COMPACT_TEXT_X - COMPACT_ICON_PAD;
    drawText(ctx, row.label, {
      x: textX,
      y: y + COMPACT_NAME_Y,
      ...TEXT_PRESETS.heading,
      size: COMPACT_NAME_SIZE,
      color: enabled ? ROW_NAME_COLOR : ROW_NAME_DISABLED_COLOR,
      width: textWidth,
      lineHeight: COMPACT_NAME_SIZE + STATUS_LEADING,
      height: COMPACT_NAME_SIZE + STATUS_LEADING,
    });
    const detailY = y + COMPACT_DETAIL_Y;
    if (enabled && row.usesKit) {
      drawText(ctx, `Use kit (${row.kits})`, {
        x: textX,
        y: detailY,
        ...TEXT_PRESETS.success,
        size: COMPACT_DETAIL_SIZE,
      });
    } else if (enabled) {
      this.renderCost(ctx, row, textX, detailY, partyCount);
    } else {
      drawText(ctx, this.readOnly ? 'Build outdoors' : row.status, {
        x: textX,
        y: detailY,
        size: COMPACT_DETAIL_SIZE,
        color: STATUS_BLOCKED_COLOR,
        width: textWidth,
        lineHeight: COMPACT_DETAIL_SIZE + STATUS_LEADING,
        height: COMPACT_DETAIL_SIZE + STATUS_LEADING,
      });
    }
  }

  /** The cost line: the price struck through when a discount changed it, then what this crawler pays. */
  private renderCost(
    ctx: CanvasRenderingContext2D,
    row: OptionStatus,
    x: number,
    y: number,
    partyCount: (id: ResourceId) => number,
  ): void {
    let cursor = x;
    const discounted = !sameCost(row.baseCost, row.cost);
    if (discounted)
      cursor = this.renderCostItems(ctx, row.baseCost, cursor, y, () => STRUCK_COLOR, true);
    if (isEmptyCost(row.cost)) {
      drawText(ctx, 'Free', { x: cursor, y, ...TEXT_PRESETS.success, size: DETAIL_SIZE });
      return;
    }
    this.renderCostItems(
      ctx,
      row.cost,
      cursor,
      y,
      (id, amount) => (partyCount(id) >= amount ? COST_OK_COLOR : COST_SHORT_COLOR),
      false,
    );
  }

  private renderCostItems(
    ctx: CanvasRenderingContext2D,
    cost: ResourceCost,
    x: number,
    y: number,
    color: (id: ResourceId, amount: number) => string,
    struck: boolean,
  ): number {
    let cursor = x;
    for (const id of RESOURCE_IDS) {
      const amount = cost[id];
      if (amount === undefined || amount <= 0) continue;
      drawResourceIcon(ctx, id, cursor, y - COST_ICON_RAISE, COST_ICON);
      cursor += COST_ICON + COST_NUMBER_GAP;
      const text = String(amount);
      drawText(ctx, text, {
        x: cursor,
        y,
        size: DETAIL_SIZE,
        bold: true,
        color: color(id, amount),
        strikethrough: struck,
      });
      cursor += text.length * COST_NUMBER_WIDTH_PER_DIGIT + COST_ITEM_GAP;
    }
    return cursor;
  }

  private renderRowIcon(
    ctx: CanvasRenderingContext2D,
    option: BuildOption,
    x: number,
    y: number,
    size: number = ROW_ICON,
  ): void {
    if (option === 'trebuchet') {
      drawKitIcon(ctx, 'trebuchet_kit', x, y, size);
      return;
    }
    if (option === 'snare') {
      drawKitIcon(ctx, 'snare_kit', x, y, size);
      return;
    }
    const tile = size * WALL_ICON_TILE_SHARE;
    const look = {
      tier: option,
      stage: 0,
      outside: 'south' as const,
      spiked: false,
      buttress: false,
      variant: 0,
    };
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, size, size);
    ctx.clip();
    paintPalisadeForReview(ctx, x, y + tile, tile, { ...look, mask: PALISADE_DIRS.east });
    paintPalisadeForReview(ctx, x + tile, y + tile, tile, { ...look, mask: PALISADE_DIRS.west });
    ctx.restore();
  }

  private choose(option: BuildOption): void {
    const source = this.source;
    if (source === null || this.readOnly) return;
    playButtonSound(this.audio);
    this.close();
    source.start(option);
  }

  /**
   * A click or tap. Returns true whenever the menu is open: a press outside
   * the panel closes it rather than reaching the world behind.
   */
  handleClick(canvasX: number, canvasY: number): boolean {
    if (!this.open) return false;
    const { x: mx, y: my } = modalFitPoint(this.fit, canvasX, canvasY);
    if (this.closeButton?.contains(mx, my) === true) {
      playButtonSound(this.audio);
      this.close();
      return true;
    }
    for (const hit of this.rowHits) {
      const inside = mx >= hit.x && mx <= hit.x + hit.w && my >= hit.y && my <= hit.y + hit.h;
      if (!inside) continue;
      if (hit.enabled) this.choose(hit.option);
      // A disabled row still shows where it would go and why it cannot.
      else this.tappedPreview = hit.option;
      return true;
    }
    if (this.modalContains?.(mx, my) === true) return true;
    this.close();
    return true;
  }

  /** Escape closes; so does the Construction key pressed again. Returns whether the key was taken. */
  handleKey(key: string, repeat = false): boolean {
    if (!this.open) return false;
    if (key === 'Escape' || keybindings.actionFor(key) === 'construction') {
      // A held key repeating is still the press that opened the menu.
      if (!repeat) this.close();
      return true;
    }
    return false;
  }

  overlayClaim(): OverlayInputClaim {
    return {
      isOpen: this.open,
      space: { kind: 'swallow' },
      locksKeyboard: true,
      haltsWorld: false,
      focusContext: CONSTRUCTION_MENU_FOCUS_ID,
    };
  }
}

function isEmptyCost(cost: ResourceCost): boolean {
  return RESOURCE_IDS.every((id) => (cost[id] ?? 0) <= 0);
}

function sameCost(a: ResourceCost, b: ResourceCost): boolean {
  return RESOURCE_IDS.every((id) => (a[id] ?? 0) === (b[id] ?? 0));
}
