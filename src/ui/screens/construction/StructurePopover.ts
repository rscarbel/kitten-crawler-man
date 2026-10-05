/**
 * The Structure popover: a small panel hung over one construction, with its
 * health (and its spikes' health), and what can be done to it — upgrade,
 * repair, spikes, load, destroy, cancel.
 *
 * It is a presenter only. Its owner builds a {@link StructurePopoverModel}
 * every frame from the live structure — so a wall breached while it is open
 * shows it at once — and each option carries its own action.
 *
 * Not world-halting: it is used in the middle of a siege, and only its own
 * panel takes taps, so a tap beside it still reaches the world. The owner
 * closes it when the crawler walks away.
 */

import type { ResourceCost } from '../../../core/partyResources';
import { RESOURCE_IDS, type ResourceId } from '../../../core/resourceIds';
import { inset, splitH, splitV, type Rect } from '../../core/geom';
import type { KeyModifiers, Surface, Ui, UiAudio } from '../../core/UiRoot';
import { skinsFor } from '../../theme/skins';
import type { MeterKind } from '../../theme/skins';
import { button, buttonHeight } from '../../widgets/button';
import { costChips, measureCostChips, type CostEntry } from '../../widgets/costChips';
import { listRow, listRowHeight } from '../../widgets/listRow';
import { meter } from '../../widgets/meter';
import { popover } from '../../widgets/popover';
import { scrollGutterWidth, scrollView } from '../../widgets/scrollView';
import { lineHeightOf, measureText, text } from '../../widgets/text';

export interface StructurePopoverOption {
  readonly label: string;
  /** Shown as resource chips beside the label, red where the party is short. */
  readonly cost?: ResourceCost;
  /** Why it cannot be chosen now; the option still shows, greyed, with this under it. */
  readonly disabledReason?: string;
  readonly style?: 'normal' | 'danger' | 'cancel';
  readonly action: () => void;
}

export interface StructurePopoverModel {
  readonly title: string;
  readonly hp: number;
  readonly maxHp: number;
  readonly spikesHp: number | null;
  readonly spikesMaxHp: number;
  /** An extra line under the bars, e.g. the trebuchet's ammunition. */
  readonly detail?: string;
  readonly options: readonly StructurePopoverOption[];
  /** The structure's rectangle on screen, in canvas CSS pixels, which the popover hangs above. */
  readonly anchor: Rect;
}

export interface StructurePopoverSurfaceOptions {
  /** The live model, or null when there is nothing to hang it on this frame. */
  readonly model: () => StructurePopoverModel | null;
  /** The party's stock of a resource, for colouring costs. */
  readonly stockOf: (id: ResourceId) => number;
  /** The owner's keys for it, such as the key that opened it. Escape is handled by `close`. */
  readonly onKey?: (key: string, mods: KeyModifiers) => boolean;
  /** How the owner closes it, so its own state goes with it. */
  readonly close?: () => void;
}

/** Outer width of the popover, in UI units. */
const POPOVER_WIDTH = 320;
const METER_LABELS: Readonly<Record<'hp' | 'spikes', string>> = { hp: 'Health', spikes: 'Spikes' };
const METER_KINDS: Readonly<Record<'hp' | 'spikes', MeterKind>> = { hp: 'hp', spikes: 'progress' };
/** Below this share of its health a structure's bar turns to its low colour. */
const STRUCTURE_LOW_HP = 0.3;

type Block =
  | {
      readonly kind: 'meter';
      readonly which: 'hp' | 'spikes';
      readonly value: number;
      readonly max: number;
    }
  | { readonly kind: 'detail'; readonly text: string }
  | { readonly kind: 'option'; readonly option: StructurePopoverOption; readonly index: number };

export class StructurePopover {
  private open = false;

  constructor(private readonly audio: UiAudio | null) {}

  get isOpen(): boolean {
    return this.open;
  }

  show(): void {
    if (!this.open) this.audio?.play('menu_open');
    this.open = true;
  }

  close(): void {
    this.open = false;
  }

  surface(id: string, opts: StructurePopoverSurfaceOptions): Surface {
    const close = opts.close ?? (() => this.close());
    return {
      id,
      band: 'panel',
      haltsWorld: false,
      locksKeyboard: true,
      isOpen: () => this.open,
      close,
      onKey: opts.onKey,
      render: (ui) => {
        const model = opts.model();
        if (model !== null) renderPopover(ui, model, opts.stockOf);
      },
    };
  }
}

function blocksOf(model: StructurePopoverModel): Block[] {
  const blocks: Block[] = [];
  if (model.maxHp > 0) {
    blocks.push({ kind: 'meter', which: 'hp', value: model.hp, max: model.maxHp });
    if (model.spikesHp !== null) {
      blocks.push({
        kind: 'meter',
        which: 'spikes',
        value: model.spikesHp,
        max: model.spikesMaxHp,
      });
    }
  }
  if (model.detail !== undefined) blocks.push({ kind: 'detail', text: model.detail });
  model.options.forEach((option, index) => blocks.push({ kind: 'option', option, index }));
  return blocks;
}

function costEntries(cost: ResourceCost, stockOf: (id: ResourceId) => number): CostEntry[] {
  return RESOURCE_IDS.flatMap((id) => {
    const need = cost[id] ?? 0;
    return need > 0 ? [{ label: '', have: stockOf(id), need, item: id }] : [];
  });
}

/** How wide an option's price may get in a row `rowW` wide: half the row's padded content, as `listRow` gives its trailing content. */
function costWidth(ui: Ui, rowW: number): number {
  return (rowW - ui.theme.space.md * 2) / 2;
}

function optionHeight(
  ui: Ui,
  option: StructurePopoverOption,
  innerW: number,
  stockOf: (id: ResourceId) => number,
): number {
  const style = option.style ?? 'normal';
  if (style !== 'normal') return buttonHeight(ui);
  const rowH = listRowHeight(ui, option.disabledReason !== undefined);
  if (option.cost === undefined) return rowH;
  const chips = measureCostChips(ui, costEntries(option.cost, stockOf), costWidth(ui, innerW));
  return Math.max(rowH, chips.h + ui.theme.space.sm * 2);
}

function blockHeight(
  ui: Ui,
  block: Block,
  innerW: number,
  stockOf: (id: ResourceId) => number,
): number {
  switch (block.kind) {
    case 'meter':
      return Math.max(
        lineHeightOf(ui, 'caption'),
        skinsFor(ui.theme).meter[METER_KINDS[block.which]].height,
      );
    case 'detail':
      return lineHeightOf(ui, 'caption');
    case 'option':
      return optionHeight(ui, block.option, innerW, stockOf);
  }
}

function renderPopover(
  ui: Ui,
  model: StructurePopoverModel,
  stockOf: (id: ResourceId) => number,
): void {
  const { space } = ui.theme;
  const padding = skinsFor(ui.theme).panel.popover.padding;
  const outerW = Math.min(POPOVER_WIDTH, ui.viewport.w - space.sm * 2);
  const toUi = 1 / ui.uiScale;
  const anchor: Rect = {
    x: model.anchor.x * toUi,
    y: model.anchor.y * toUi,
    w: model.anchor.w * toUi,
    h: model.anchor.h * toUi,
  };
  const bounds = inset(ui.viewport, space.sm);
  const clearance = space.lg;
  const fitsBeside =
    anchor.x + anchor.w + clearance + outerW <= bounds.x + bounds.w ||
    anchor.x - clearance - outerW >= bounds.x;
  // With no room beside the structure, a tall popover is held to the larger
  // gap above or below it and scrolls, rather than being clamped over it.
  const spaceAbove = anchor.y - clearance - bounds.y;
  const spaceBelow = bounds.y + bounds.h - (anchor.y + anchor.h) - clearance;
  const maxOuterH = fitsBeside ? bounds.h : Math.max(spaceAbove, spaceBelow, 0);
  const placement = spaceAbove >= spaceBelow ? 'above' : 'below';
  const blocks = blocksOf(model);
  const layoutAt = (innerW: number): { tracks: number[]; contentH: number } => {
    const tracks = [
      lineHeightOf(ui, 'title'),
      ...blocks.map((block) => blockHeight(ui, block, innerW, stockOf)),
    ];
    const contentH = tracks.reduce((sum, h) => sum + h, 0) + space.sm * (tracks.length - 1);
    return { tracks, contentH };
  };
  const fullInnerW = outerW - padding * 2;
  const unscrolled = layoutAt(fullInnerW);
  const scrolls = unscrolled.contentH + padding * 2 > maxOuterH;
  const { tracks, contentH } = scrolls ? layoutAt(fullInnerW - scrollGutterWidth(ui)) : unscrolled;
  popover(ui, {
    id: 'structure',
    anchor,
    w: outerW,
    h: Math.min(contentH + padding * 2, maxOuterH),
    placement: fitsBeside ? 'above' : placement,
    draw: (body) => {
      const drawContent = (content: Rect): void => {
        const [titleRect, ...rects] = splitV(content, tracks, space.sm);
        text(ui, titleRect, { text: model.title, role: 'title' });
        blocks.forEach((block, index) => drawBlock(ui, rects[index], block, stockOf));
      };
      // A short phone cannot fit every option; the popover then scrolls rather than cutting them off.
      if (!scrolls) drawContent(body);
      else
        scrollView(ui, body, {
          id: 'structure/scroll',
          contentHeight: contentH,
          draw: drawContent,
        });
    },
  });
}

function drawBlock(ui: Ui, rect: Rect, block: Block, stockOf: (id: ResourceId) => number): void {
  switch (block.kind) {
    case 'meter': {
      const label = METER_LABELS[block.which];
      const labelW = Math.max(
        measureText(ui, METER_LABELS.hp, { role: 'caption' }),
        measureText(ui, METER_LABELS.spikes, { role: 'caption' }),
      );
      const [labelRect, barRect] = splitH(rect, [labelW, 'fill'], ui.theme.space.sm);
      text(ui, labelRect, { text: label, role: 'caption' });
      const barH = skinsFor(ui.theme).meter[METER_KINDS[block.which]].height;
      meter(
        ui,
        { ...barRect, y: barRect.y + (barRect.h - barH) / 2, h: barH },
        {
          id: `meter-${block.which}`,
          value: block.value,
          max: block.max > 0 ? block.max : 1,
          kind: METER_KINDS[block.which],
          lowBelow: block.which === 'hp' ? STRUCTURE_LOW_HP : undefined,
        },
      );
      return;
    }
    case 'detail':
      text(ui, rect, { text: block.text, role: 'caption' });
      return;
    case 'option':
      drawOption(ui, rect, block.option, block.index, stockOf);
  }
}

function drawOption(
  ui: Ui,
  rect: Rect,
  option: StructurePopoverOption,
  index: number,
  stockOf: (id: ResourceId) => number,
): void {
  const id = `option-${index}`;
  const style = option.style ?? 'normal';
  if (style !== 'normal') {
    button(ui, rect, {
      id,
      label: option.label,
      variant: style === 'danger' ? 'danger' : 'secondary',
      disabled: option.disabledReason,
      onTap: () => option.action(),
    });
    return;
  }
  const cost = option.cost;
  const entries = cost === undefined ? [] : costEntries(cost, stockOf);
  const chipsW =
    cost === undefined
      ? 0
      : entries.length === 0
        ? measureText(ui, 'Free', { role: 'success' })
        : measureCostChips(ui, entries, costWidth(ui, rect.w)).w;
  listRow(ui, rect, {
    id,
    title: option.label,
    subtitle: option.disabledReason,
    disabled: option.disabledReason,
    trailingWidth: cost === undefined ? undefined : chipsW,
    trailingContent:
      cost === undefined
        ? undefined
        : (trailing) => {
            if (entries.length === 0) {
              text(ui, trailing, { text: 'Free', role: 'success', align: 'right' });
              return;
            }
            const chipsH = measureCostChips(ui, entries, trailing.w).h;
            costChips(
              ui,
              { ...trailing, y: trailing.y + (trailing.h - chipsH) / 2, h: chipsH },
              { costs: entries, align: 'right' },
            );
          },
    onTap: () => option.action(),
  });
}
