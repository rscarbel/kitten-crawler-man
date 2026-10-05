/**
 * The Construction screen: what the active crawler can build, what it costs
 * them, how long it takes them, and — for anything they cannot build right
 * now — why not.
 *
 * Every number on it is the active crawler's own: Carl and Donut each level
 * Construction separately, so costs, build times and discounts change when the
 * player switches crawler. The resource strip is the party's combined stock.
 *
 * Choosing a ready card closes the screen and starts the job at once, in
 * front of the crawler. Hovering or focusing a card (or tapping one that is
 * blocked, which is how a phone sees it) asks the owner to draw its placement
 * ghost in the world, which is how "build in front of you" stays predictable.
 *
 * A card whose kind cannot be built where the party is (indoors, for the
 * outdoor-only kinds) is washed out but stays tappable and in the focus ring,
 * so choosing it raises the refusal as a notice rather than doing nothing.
 *
 * Not world-halting: it is opened mid-siege, and the crawler it builds for
 * has to stay live under it. It does lock the keyboard, so number keys and
 * the rest of the hotbar cannot act behind it.
 */

import { ITEM_DEF } from '../../../core/ItemDefs';
import type { CraftSkills } from '../../../core/CraftSkills';
import { keybindings } from '../../../core/Keybindings';
import type { ResourceCost } from '../../../core/partyResources';
import { RESOURCE_IDS, type ResourceId } from '../../../core/resourceIds';
import {
  NOT_ENOUGH_MATERIALS_STATUS,
  OPTION_LOCKED_STATUS,
  type BuildOption,
  type OptionStatus,
} from '../../../systems/briarHollow/ConstructionSystem';
import { centerIn, grid, inset, splitH, splitV, type Rect, type Track } from '../../core/geom';
import { UI_ERROR_SOUND, type Surface, type Ui, type UiAudio } from '../../core/UiRoot';
import { UiStateSlot } from '../../core/uiState';
import { ITEM_ICONS } from '../../icons/itemIcons';
import { drawGlyph, type GlyphId } from '../../theme/glyphs';
import { skinsFor } from '../../theme/skins';
import { badge, badgeSize } from '../../widgets/badge';
import { card } from '../../widgets/card';
import { costChips, measureCostChips, type CostEntry } from '../../widgets/costChips';
import { meter } from '../../widgets/meter';
import { panel, panelBodyMaxHeight, panelBodyWidth, type PanelOptions } from '../../widgets/panel';
import { scrollGutterWidth, scrollIntoView } from '../../widgets/scrollView';
import { tabs, type TabItem } from '../../widgets/tabs';
import {
  lineHeightOf,
  measureText,
  measureTextHeight,
  tabularNumber,
  text,
} from '../../widgets/text';
import { tooltip } from '../../widgets/tooltip';
import { drawStructureArt } from './structureArt';

/** What the screen needs from whoever owns building in this scene. */
export interface ConstructionScreenSource {
  /** Every option, in screen order, as the active crawler sees it now. */
  rows(): readonly OptionStatus[];
  /** Starts an option's job. Returns whether it started. */
  start(option: BuildOption): boolean;
  /** The option whose ghost the world should draw, or null for none. */
  setPreview(option: BuildOption | null): void;
  /** Called when the screen opens, so anything left over from a prior attempt (a "no room" silhouette) clears. */
  onOpen?(): void;
}

/** The active crawler the screen prices everything for, and the party's stock. */
export interface ConstructionScreenContext {
  readonly crawlerName: string;
  readonly skills: CraftSkills;
  readonly partyCount: (id: ResourceId) => number;
}

/** More options than this and the cards are split into category tabs. */
export const CONSTRUCTION_TABS_FROM = 6;

const CONSTRUCTION_CATEGORIES = ['walls', 'siege'] as const;
type ConstructionCategory = (typeof CONSTRUCTION_CATEGORIES)[number];

const CATEGORY_LABELS: Readonly<Record<ConstructionCategory, string>> = {
  walls: 'Walls',
  siege: 'Siege works',
};

const OPTION_CATEGORY: Readonly<Record<BuildOption, ConstructionCategory>> = {
  wood: 'walls',
  stone: 'walls',
  fortified: 'walls',
  trebuchet: 'siege',
  snare: 'siege',
};

/** The kit a kit-built option spends, shown on its card in place of a price. */
const OPTION_KIT: Readonly<Partial<Record<BuildOption, 'trebuchet_kit' | 'snare_kit'>>> = {
  trebuchet: 'trebuchet_kit',
  snare: 'snare_kit',
};

const PANEL_ID = 'construction';
const PANEL_WIDTH = 'md';
const BODY_SCROLL_ID = `${PANEL_ID}/body`;
/** Narrowest a card gets before the grid drops a column. */
const CARD_MIN_WIDTH = 148;
/** A refused card's picture is faded this far and drained of colour, so it reads as unavailable at a glance. */
const REFUSED_ART_ALPHA = 0.45;
const REFUSED_ART_FILTER = 'grayscale(1)';
/** A blocked (but not refused) card's picture is faded this far. */
const BLOCKED_ART_ALPHA = 0.7;
const SECONDS_DECIMALS = 1;
/** A card's picture is this many item slots tall, so a structure reads as a structure rather than an icon. */
const ART_HEIGHT_SLOTS = 1.4;
const PERCENT = 100;
/** The dash a status line uses between its state and its detail. */
const STATUS_DASH = ' — ';
/** What that dash becomes on a card's ribbon: shorter, so more of the detail fits. */
const RIBBON_SEPARATOR = ' · ';
/** A ribbon wraps to this many lines before it is cut short. */
const RIBBON_MAX_LINES = 2;

const TAB = new UiStateSlot<{ category: ConstructionCategory | null }>('constructionTab', () => ({
  category: null,
}));

type RibbonTone = 'ready' | 'short' | 'blocked' | 'refused';

interface Ribbon {
  readonly text: string;
  readonly tone: RibbonTone;
  readonly glyph: GlyphId;
}

/** A band of the scrolling body, measured from the content's top. */
interface ContentSpan {
  readonly top: number;
  readonly bottom: number;
}

interface BodyLayout {
  readonly height: number;
  readonly cardHeight: number;
  readonly costHeight: number;
}

export interface ConstructionScreenOptions {
  /** Shows a one-line notice, for a refused option's reason; the owner routes it to the scene's toasts. */
  readonly notify: (message: string) => void;
  /** More options than this split into tabs. Defaults to {@link CONSTRUCTION_TABS_FROM}. */
  readonly tabsFrom?: number;
}

export class ConstructionScreen {
  private open = false;
  private source: ConstructionScreenSource | null = null;
  /** A blocked card tapped (a phone has no hover), whose ghost stays up until something else is chosen. */
  private tappedPreview: BuildOption | null = null;
  private readonly tabsFrom: number;

  constructor(
    private readonly audio: UiAudio | null,
    private readonly options: ConstructionScreenOptions,
  ) {
    this.tabsFrom = options.tabsFrom ?? CONSTRUCTION_TABS_FROM;
  }

  get isOpen(): boolean {
    return this.open;
  }

  /** Opens the screen over `source`, which decides every option's state, indoors or out. */
  openWith(source: ConstructionScreenSource): void {
    this.source = source;
    this.open = true;
    this.tappedPreview = null;
    this.audio?.play('menu_open');
    source.onOpen?.();
  }

  close(): void {
    if (!this.open) return;
    this.open = false;
    this.source?.setPreview(null);
    this.tappedPreview = null;
  }

  /**
   * The screen as a surface: modal so a tap beside it closes it rather than
   * reaching the world, but the world runs on under it; the keyboard is
   * locked while it is up.
   *
   * @param context The crawler it prices for and the party's stock, read every frame.
   */
  surface(id: string, context: () => ConstructionScreenContext): Surface {
    return {
      id,
      band: 'modal',
      haltsWorld: false,
      locksKeyboard: true,
      isOpen: () => this.open,
      close: () => this.close(),
      onKey: (key, mods) => {
        if (keybindings.actionFor(key) !== 'construction') return false;
        // A held key repeating is still the press that opened the screen.
        if (mods.repeat !== true) this.close();
        return true;
      },
      render: (ui) => this.render(ui, context()),
    };
  }

  private render(ui: Ui, context: ConstructionScreenContext): void {
    const source = this.source;
    if (!this.open || source === null) return;
    const rows = source.rows();
    const categories = CONSTRUCTION_CATEGORIES.filter((category) =>
      rows.some((row) => OPTION_CATEGORY[row.option] === category),
    );
    const tabbed = rows.length > this.tabsFrom && categories.length > 1;
    const tab = ui.state(TAB, PANEL_ID);
    const firstCategory: ConstructionCategory | null = categories.length > 0 ? categories[0] : null;
    const category =
      tab.category !== null && categories.includes(tab.category) ? tab.category : firstCategory;
    const shown = tabbed ? rows.filter((row) => OPTION_CATEGORY[row.option] === category) : rows;

    const frame: Pick<PanelOptions, 'width' | 'title' | 'subtitle' | 'onClose'> = {
      width: PANEL_WIDTH,
      title: `Construction — ${context.crawlerName}`,
      subtitle: levelLine(context.skills),
      onClose: () => this.close(),
    };
    const fullWidth = panelBodyWidth(ui, PANEL_WIDTH);
    const maxHeight = panelBodyMaxHeight(ui, frame);
    const unscrolled = bodyLayout(ui, fullWidth, shown, tabbed, context);
    const layout =
      unscrolled.height > maxHeight
        ? bodyLayout(ui, fullWidth - scrollGutterWidth(ui), shown, tabbed, context)
        : unscrolled;

    let preview: BuildOption | null = this.tappedPreview;
    const focus: { span: ContentSpan | null } = { span: null };
    const p = panel(ui, {
      ...frame,
      id: PANEL_ID,
      height: 'content',
      contentHeight: layout.height,
      scrollBody: true,
      onScrimTap: () => this.close(),
      content: (content) => {
        const { space } = ui.theme;
        const xpH = skinsFor(ui.theme).meter.xp.height;
        const stripH = ui.theme.size.control;
        const tabsH = tabbed ? ui.theme.size.control : 0;
        const hintH = hintHeight(ui, content.w);
        const tracks: Track[] = tabbed
          ? [xpH, stripH, tabsH, 'fill', hintH]
          : [xpH, stripH, 'fill', hintH];
        const parts = splitV(content, tracks, space.md);
        const [xpRect, stripRect] = parts;
        const cardsRect = parts[parts.length - 2];
        const hintRect = parts[parts.length - 1];
        meter(ui, xpRect, {
          id: 'xp',
          value: xpFraction(context.skills),
          max: 1,
          kind: 'xp',
          ghost: false,
        });
        resourceStrip(ui, stripRect, context.partyCount);
        if (tabbed && category !== null) {
          const items: TabItem[] = categories.map((id) => ({
            id,
            label: CATEGORY_LABELS[id],
            badge: String(rows.filter((row) => OPTION_CATEGORY[row.option] === id).length),
          }));
          tabs(ui, parts[2], {
            id: 'category',
            items,
            selected: category,
            onSelect: (id) => {
              tab.category = categories.find((candidate) => candidate === id) ?? category;
            },
          });
        }
        const cells = cardCells(ui, cardsRect, shown.length, layout.cardHeight);
        shown.forEach((row, index) => {
          const cell = cells[index];
          const state = this.optionCard(ui, cell, row, context, layout.costHeight);
          const pointedAt = state.hovered || state.focused;
          if (pointedAt && row.refusal === null) preview = row.option;
          if (state.focused) {
            focus.span = { top: cell.y - content.y, bottom: cell.y + cell.h - content.y };
          }
        });
        hint(ui, hintRect);
      },
    });
    const span = focus.span;
    if (span !== null) scrollIntoView(ui, BODY_SCROLL_ID, span.top, span.bottom, p.body.h);
    source.setPreview(preview);
  }

  private optionCard(
    ui: Ui,
    cell: Rect,
    row: OptionStatus,
    context: ConstructionScreenContext,
    costHeight: number,
  ): { hovered: boolean; focused: boolean } {
    const { space, palette } = ui.theme;
    const choosable = row.enabled || row.roomBlocked;
    const id = `option-${row.option}`;
    const ribbon = ribbonFor(row, context.partyCount);
    const tapped = this.tappedPreview === row.option;
    const drawnRibbon: { rect: Rect | null; truncated: boolean } = { rect: null, truncated: false };
    const result = card(ui, cell, {
      id,
      selected: tapped,
      sound: choosable ? undefined : UI_ERROR_SOUND,
      onTap: () => this.activate(row),
      content: (body) => {
        const [artRect, nameRect, costRect, ribbonRect] = splitV(
          body,
          cardTracks(ui, costHeight),
          space.sm,
        );
        drawArt(ui, artRect, row);
        discountBadge(ui, artRect, row);
        const seconds = `${row.seconds.toFixed(SECONDS_DECIMALS)} s`;
        const secondsW = measureText(ui, seconds, { role: 'caption', tabular: true });
        const [nameCell, secondsCell] = splitH(nameRect, ['fill', secondsW], space.xs);
        text(ui, nameCell, {
          text: row.label,
          role: 'label',
          color: row.enabled ? undefined : palette.text.secondary,
        });
        tabularNumber(ui, secondsCell, {
          value: seconds,
          role: 'caption',
          align: 'right',
        });
        costLine(ui, costRect, row, context.partyCount);
        drawnRibbon.rect = ribbonRect;
        drawnRibbon.truncated = drawRibbon(ui, ribbonRect, ribbon);
      },
    });
    const { state } = result;
    const ribbonRect = drawnRibbon.rect;
    if (ribbonRect !== null && drawnRibbon.truncated) {
      // Touch and keyboard have no hover, so pressing, focusing or tapping a
      // card is what reveals a reason too long for its ribbon.
      const immediate = state.pressed || state.focused || tapped;
      tooltip(ui, ribbonRect, {
        id: `${id}/ribbon`,
        text: ribbon.text,
        show: state.hovered || immediate,
        immediate,
      });
    }
    return state;
  }

  /** A card chosen, by pointer, tap or the focus ring. */
  private activate(row: OptionStatus): void {
    if (row.refusal !== null) {
      this.options.notify(row.refusal);
      return;
    }
    // Blocked only by room still chooses: the owner shows where it was tried and why not.
    if (row.enabled || row.roomBlocked) {
      this.choose(row.option);
      return;
    }
    this.tappedPreview = row.option;
  }

  private choose(option: BuildOption): void {
    const source = this.source;
    if (source === null) return;
    this.close();
    source.start(option);
  }
}

function levelLine(skills: CraftSkills): string {
  const level = skills.getLevel('construction');
  const xpToNext = skills.xpToNext('construction');
  const xp = skills.getXp('construction');
  return Number.isFinite(xpToNext)
    ? `Level ${level} · ${Math.floor(xp)} / ${Math.floor(xpToNext)} XP`
    : `Level ${level} · mastered`;
}

function xpFraction(skills: CraftSkills): number {
  const xpToNext = skills.xpToNext('construction');
  const mastered = !Number.isFinite(xpToNext) || xpToNext <= 0;
  return mastered ? 1 : skills.getXp('construction') / xpToNext;
}

function artHeight(ui: Ui): number {
  return ui.theme.size.slot * ART_HEIGHT_SLOTS;
}

/** A card's stacked parts, top to bottom: picture, name, price, state ribbon. */
function cardTracks(ui: Ui, costHeight: number): number[] {
  return [artHeight(ui), lineHeightOf(ui, 'label'), costHeight, ribbonHeight(ui)];
}

function ribbonHeight(ui: Ui): number {
  return Math.max(ui.theme.size.icon, lineHeightOf(ui, 'caption') * RIBBON_MAX_LINES);
}

function costEntries(cost: ResourceCost, partyCount: (id: ResourceId) => number): CostEntry[] {
  return RESOURCE_IDS.flatMap((id) => {
    const need = cost[id] ?? 0;
    return need > 0 ? [{ label: '', have: partyCount(id), need, item: id }] : [];
  });
}

function isFree(cost: ResourceCost): boolean {
  return RESOURCE_IDS.every((id) => (cost[id] ?? 0) <= 0);
}

/** The cost block's height: the tallest wrapped chips of any shown card, so every card is the same size. */
function costBlockHeight(
  ui: Ui,
  width: number,
  rows: readonly OptionStatus[],
  partyCount: (id: ResourceId) => number,
): number {
  const single = lineHeightOf(ui, 'label') + ui.theme.space.xs * 2;
  return rows.reduce((tallest, row) => {
    if (row.usesKit || isFree(row.cost)) return tallest;
    const chips = measureCostChips(ui, costEntries(row.cost, partyCount), width);
    return Math.max(tallest, chips.h);
  }, single);
}

function hintText(ui: Ui): string {
  return ui.density === 'touch'
    ? 'Long-press a construction: repair, spikes, destroy'
    : `${keybindings.labelFor('structureMenu')} on a construction: repair, spikes, destroy`;
}

function hintHeight(ui: Ui, width: number): number {
  return measureTextHeight(ui, width, { text: hintText(ui), role: 'caption' });
}

function hint(ui: Ui, rect: Rect): void {
  text(ui, rect, { text: hintText(ui), role: 'caption', align: 'center', wrap: true });
}

function cardColumnsProbe(ui: Ui, rect: Rect, count: number): Rect[] {
  return grid(rect, count, { minCell: CARD_MIN_WIDTH, gap: ui.theme.space.sm });
}

/** The cards' cells: as many columns as fit, every card `cardHeight` tall. */
function cardCells(ui: Ui, rect: Rect, count: number, cardHeight: number): Rect[] {
  const probe = cardColumnsProbe(ui, rect, Math.max(1, count));
  const cellW = probe[0]?.w ?? rect.w;
  return grid(rect, count, {
    minCell: CARD_MIN_WIDTH,
    gap: ui.theme.space.sm,
    aspect: cellW / cardHeight,
  });
}

function bodyLayout(
  ui: Ui,
  width: number,
  rows: readonly OptionStatus[],
  tabbed: boolean,
  context: ConstructionScreenContext,
): BodyLayout {
  const { space, size } = ui.theme;
  const cardPadding = skinsFor(ui.theme).panel.raised.padding;
  const probe = cardColumnsProbe(ui, { x: 0, y: 0, w: width, h: 0 }, Math.max(1, rows.length));
  const cellW = probe[0]?.w ?? width;
  const columns = probe.filter((cell) => cell.y === probe[0]?.y).length;
  const costHeight = costBlockHeight(ui, cellW - cardPadding * 2, rows, context.partyCount);
  const cardParts = cardTracks(ui, costHeight);
  const cardHeight =
    cardPadding * 2 + cardParts.reduce((sum, h) => sum + h, 0) + space.sm * (cardParts.length - 1);
  const cardRows = Math.ceil(rows.length / Math.max(1, columns));
  const cardsHeight = cardRows * cardHeight + Math.max(0, cardRows - 1) * space.sm;
  const xpH = skinsFor(ui.theme).meter.xp.height;
  const tracks = [xpH, size.control, cardsHeight, hintHeight(ui, width)];
  if (tabbed) tracks.push(size.control);
  const height = tracks.reduce((sum, h) => sum + h, 0) + space.md * (tracks.length - 1);
  return { height, cardHeight, costHeight };
}

/** The party's stock of every resource, as icon chips along the top. */
function resourceStrip(ui: Ui, rect: Rect, partyCount: (id: ResourceId) => number): void {
  const { space, size } = ui.theme;
  card(ui, rect, { id: 'stock', kind: 'inset' });
  const cells = splitH(
    inset(rect, { l: space.sm, r: space.sm }),
    RESOURCE_IDS.map((): Track => 'fill'),
    space.xs,
  );
  RESOURCE_IDS.forEach((id, index) => {
    const cell = cells[index];
    const count = String(partyCount(id));
    const countW = measureText(ui, count, { role: 'value', tabular: true });
    const chipW = size.icon + space.xs + countW;
    const chip = centerIn(cell, chipW, size.icon);
    ITEM_ICONS[id](ui.ctx, { x: chip.x, y: chip.y, w: size.icon, h: size.icon });
    tabularNumber(
      ui,
      { x: chip.x + size.icon + space.xs, y: cell.y, w: countW, h: cell.h },
      { value: count, role: 'value' },
    );
  });
}

function drawArt(ui: Ui, rect: Rect, row: OptionStatus): void {
  const { ctx } = ui;
  const box = centerIn(rect, Math.min(rect.w, rect.h * 2), rect.h);
  ctx.save();
  if (row.refusal !== null) {
    ctx.globalAlpha *= REFUSED_ART_ALPHA;
  } else if (!row.enabled) {
    ctx.globalAlpha *= BLOCKED_ART_ALPHA;
  }
  drawStructureArt(ctx, row.option, box, row.refusal === null ? 'normal' : 'washed');
  ctx.restore();
}

/** A "−20%" tag over the picture when this crawler's level discounts the price. */
function discountBadge(ui: Ui, artRect: Rect, row: OptionStatus): void {
  const full = totalOf(row.baseCost);
  const paid = totalOf(row.cost);
  if (row.usesKit || full <= 0 || paid >= full) return;
  const percent = Math.round((1 - paid / full) * PERCENT);
  if (percent <= 0) return;
  const label = `−${percent}%`;
  const pill = badgeSize(ui, { label });
  badge(
    ui,
    { x: artRect.x + artRect.w - pill.w, y: artRect.y, w: pill.w, h: pill.h },
    {
      label,
      tone: 'success',
      variant: 'soft',
    },
  );
}

function totalOf(cost: ResourceCost): number {
  return RESOURCE_IDS.reduce((sum, id) => sum + (cost[id] ?? 0), 0);
}

function costLine(
  ui: Ui,
  rect: Rect,
  row: OptionStatus,
  partyCount: (id: ResourceId) => number,
): void {
  const kit = OPTION_KIT[row.option];
  if (row.usesKit && kit !== undefined) {
    const label = `Use kit (${row.kits})`;
    const pill = badgeSize(ui, { label });
    const iconSide = ui.theme.size.icon;
    ITEM_ICONS[kit](ui.ctx, { x: rect.x, y: rect.y, w: iconSide, h: iconSide });
    badge(
      ui,
      { x: rect.x + iconSide + ui.theme.space.xs, y: rect.y, w: pill.w, h: iconSide },
      { label, tone: 'success', variant: 'soft' },
    );
    return;
  }
  // A locked option is reported with no price at all, which is not the same as free.
  if (row.status === OPTION_LOCKED_STATUS) return;
  if (isFree(row.cost)) {
    text(ui, { ...rect, h: lineHeightOf(ui, 'label') }, { text: 'Free', role: 'success' });
    return;
  }
  const costs = costEntries(row.cost, partyCount);
  if (row.refusal === null) {
    costChips(ui, rect, { costs });
    return;
  }
  // A refused option's price is information, not a shortfall to fix, so it is
  // washed out with the picture rather than shouting red.
  const { ctx } = ui;
  ctx.save();
  ctx.globalAlpha *= REFUSED_ART_ALPHA;
  ctx.filter = REFUSED_ART_FILTER;
  costChips(ui, rect, { costs });
  ctx.restore();
}

function ribbonFor(row: OptionStatus, partyCount: (id: ResourceId) => number): Ribbon {
  if (row.enabled) {
    return {
      text: row.status.replace(STATUS_DASH, RIBBON_SEPARATOR),
      tone: 'ready',
      glyph: 'check',
    };
  }
  if (row.refusal !== null) return { text: row.status, tone: 'refused', glyph: 'lock' };
  if (row.status === OPTION_LOCKED_STATUS)
    return { text: 'Locked', tone: 'refused', glyph: 'lock' };
  if (row.status === NOT_ENOUGH_MATERIALS_STATUS) {
    const short = RESOURCE_IDS.find((id) => partyCount(id) < (row.cost[id] ?? 0));
    if (short !== undefined) {
      const missing = (row.cost[short] ?? 0) - partyCount(short);
      const name = ITEM_DEF[short].name.toLowerCase();
      return { text: `Need ${missing} ${name}`, tone: 'short', glyph: 'alert' };
    }
  }
  return { text: row.status, tone: 'blocked', glyph: 'info' };
}

function ribbonColor(ui: Ui, tone: RibbonTone): string {
  const { palette } = ui.theme;
  switch (tone) {
    case 'ready':
      return palette.state.success;
    case 'short':
      return palette.state.danger;
    case 'blocked':
      return palette.state.warning;
    case 'refused':
      return palette.text.muted;
  }
}

/**
 * The card's state along its foot, wrapped to two lines. Returns whether it
 * still had to be cut short, so the caller can offer it in full.
 */
function drawRibbon(ui: Ui, rect: Rect, ribbon: Ribbon): boolean {
  const { space, size } = ui.theme;
  const color = ribbonColor(ui, ribbon.tone);
  const firstLineH = lineHeightOf(ui, 'caption');
  const iconBox = centerIn({ ...rect, w: size.icon, h: firstLineH }, size.icon, size.icon);
  drawGlyph(ui.ctx, ribbon.glyph, inset(iconBox, space.xxs), { color });
  const textRect = inset(rect, { l: size.icon + space.xs });
  const drawn = text(ui, textRect, {
    text: ribbon.text,
    role: 'caption',
    color,
    wrap: true,
    maxLines: RIBBON_MAX_LINES,
  });
  return drawn.truncated;
}
