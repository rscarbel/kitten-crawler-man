/**
 * Abilities: every ability unlocked with its level, a page per ability with
 * its perks, and the hotbar view that moves ability tomes between the bag
 * and the hotbar.
 */

import {
  isAbilityId,
  type AbilityDef,
  type AbilityId,
  type AbilityManager,
  type AbilityState,
} from '../../../core/AbilityManager';
import type { Inventory } from '../../../core/Inventory';
import { HOTBAR_COUNT } from '../../../core/ItemDefs';
import { CRAWLER_NAMES, type CrawlerKind } from '../../../core/SkillManager';
import { centerIn, grid, inset, splitV, type Rect } from '../../core/geom';
import type { Ui } from '../../core/UiRoot';
import { ITEM_ICONS } from '../../icons/itemIcons';
import { badge, badgeSize } from '../../widgets/badge';
import { button, buttonHeight } from '../../widgets/button';
import { listRow, listRowHeight } from '../../widgets/listRow';
import { meter } from '../../widgets/meter';
import { fillRounded, strokeRounded } from '../../widgets/paint';
import { tooltip } from '../../widgets/tooltip';
import { lineHeightOf, measureTextHeight, text } from '../../widgets/text';
import { keycap } from '../../widgets/keycap';
import { choiceRow, wideButton, type Choice } from './parts';
import type { PauseContext, PauseSection, SectionLayout } from './section';

type AbilitiesView =
  | { readonly kind: 'list' }
  | { readonly kind: 'hotbar' }
  | { readonly kind: 'detail'; readonly id: AbilityId };

const MONGO_ABILITY_ID: AbilityId = 'mongo';

/** The last hotbar slot holds quest items, never an ability. */
const ABILITY_HOTBAR_SLOTS = HOTBAR_COUNT - 1;

const BORDER_WIDTH = 1;
/** A hotbar slot holding an ordinary item shows it faded: it is not an ability. */
const ITEM_SLOT_ALPHA = 0.45;
/** The slot's number sits centred in this fraction of the slot, from its top-left corner. */
const SLOT_KEY_CORNER = 0.5;
/** The bag rows' Add button is this many control heights wide. */
const ADD_BUTTON_WIDTH_CONTROLS = 3;

const CRAWLER_CHOICES: readonly Choice<CrawlerKind>[] = [
  { value: 'human', label: CRAWLER_NAMES.human },
  { value: 'cat', label: CRAWLER_NAMES.cat },
];

function xpFraction(state: AbilityState): number {
  return state.xpToNextLevel === Infinity ? 1 : Math.min(1, state.xp / state.xpToNextLevel);
}

function ownerLabel(state: AbilityState): string {
  return CRAWLER_NAMES[state.owner];
}

/** The largest square in `r` that shares its top-left corner. */
function topLeftSquare(r: Rect): Rect {
  const side = Math.min(r.w, r.h);
  return { x: r.x, y: r.y, w: side, h: side };
}

function paintIcon(
  def: AbilityDef,
  level: number,
): (ctx: CanvasRenderingContext2D, r: Rect) => void {
  return (ctx, r) => def.renderIcon(ctx, topLeftSquare(r), level);
}

// ── List ────────────────────────────────────────────────────────────────────

function abilityRow(
  layout: SectionLayout,
  def: AbilityDef,
  state: AbilityState,
  open: () => void,
): void {
  const { ui } = layout;
  const { space } = ui.theme;
  const rowH = listRowHeight(ui, true) + meterRowHeight(ui);
  const rect = layout.row(rowH, space.xs);
  const tags = [ownerLabel(state), ...(def.tag === undefined ? [] : [def.tag])];
  const tagWidths = tags.map((tag) => badgeSize(ui, { label: tag, kind: 'tag' }).w);
  const tagsW = tagWidths.reduce((sum, w) => sum + w + space.xs, 0);
  const [rowRect, meterRow] = splitV(rect, ['fill', meterRowHeight(ui)], 0);
  const rowState = listRow(ui, rowRect, {
    id: `ability/${def.id}`,
    title: def.name,
    subtitle: `Level ${state.level} / ${def.maxLevel}`,
    leading: { kind: 'paint', paint: paintIcon(def, state.level) },
    trailingWidth: tagsW,
    trailingContent: (cell) => {
      let x = cell.x + cell.w;
      tags.forEach((tag, index) => {
        const w = tagWidths[index];
        x -= w;
        badge(
          ui,
          { x, y: cell.y, w, h: cell.h },
          { label: tag, kind: 'tag', tone: index === 0 ? 'info' : 'danger' },
        );
        x -= space.xs;
      });
    },
    onTap: open,
  });
  layout.track(rowRect, rowState);
  const leadingW = Math.min(rowRect.h - space.sm * 2, ui.theme.size.slot) + space.md * 2;
  meter(ui, inset(meterRow, { l: leadingW, r: space.md, b: space.xs }), {
    id: `ability/${def.id}/xp`,
    kind: 'xp',
    value: xpFraction(state),
    max: 1,
    ghost: false,
  });
}

function meterRowHeight(ui: Ui): number {
  return ui.theme.space.sm + ui.theme.space.xs;
}

function renderList(
  layout: SectionLayout,
  abilities: AbilityManager,
  show: (v: AbilitiesView) => void,
): void {
  wideButton(layout, {
    id: 'equipped-abilities',
    label: 'Hotbar abilities',
    icon: 'zap',
    onTap: () => show({ kind: 'hotbar' }),
  });
  layout.space(layout.ui.theme.space.sm);
  const registered = abilities.getAllRegistered();
  if (registered.length === 0) {
    layout.paragraph('No abilities unlocked yet.', 'muted');
    return;
  }
  for (const def of registered) {
    const state = abilities.getState(def.id);
    if (state === null) continue;
    abilityRow(layout, def, state, () => show({ kind: 'detail', id: def.id }));
  }
}

// ── Detail ──────────────────────────────────────────────────────────────────

function perkRow(
  layout: SectionLayout,
  ui: Ui,
  perk: { level: number; description: string },
  currentLevel: number,
): void {
  const { space, palette, radius, size } = ui.theme;
  const unlocked = currentLevel >= perk.level;
  const description = unlocked ? perk.description : '???';
  const badgeSide = size.icon + space.sm;
  const textW = layout.width - badgeSide - space.md * 2;
  const h = Math.max(
    size.control,
    measureTextHeight(ui, textW, { text: description, role: unlocked ? 'body' : 'muted' }) +
      space.sm * 2,
  );
  const rect = layout.row(h, space.xxs);
  if (perk.level === currentLevel) fillRounded(ui.ctx, rect, radius.sm, palette.accent.soft);
  const pip = centerIn(
    { x: rect.x + space.sm, y: rect.y, w: badgeSide, h: rect.h },
    badgeSide,
    badgeSide,
  );
  fillRounded(ui.ctx, pip, radius.sm, unlocked ? palette.category.book : palette.surface.sunken);
  text(ui, pip, {
    text: String(perk.level),
    role: unlocked ? 'inverse' : 'muted',
    align: 'center',
    tabular: true,
  });
  text(ui, inset(rect, { l: badgeSide + space.md * 2, r: space.sm }), {
    text: description,
    role: unlocked ? 'body' : 'muted',
    wrap: true,
    valign: 'middle',
  });
}

function renderDetail(layout: SectionLayout, ctx: PauseContext, def: AbilityDef): void {
  const { ui } = layout;
  const { space } = ui.theme;
  const state = ctx.abilities.getState(def.id);
  if (state === null) return;
  const equipLine =
    def.tag === undefined
      ? `How to equip: ${def.equipInstructions}`
      : `How to equip: ${def.tag} — no tome, no hotbar slot. ${def.equipInstructions}`;
  layout.paragraph(equipLine, 'muted', space.md);
  const levelRow = layout.row(lineHeightOf(ui, 'label'), space.xs);
  text(ui, levelRow, { text: `Current level: ${state.level}`, role: 'label' });
  text(ui, levelRow, {
    text: `Owner: ${ownerLabel(state)}`,
    role: 'label',
    color: ui.theme.palette.crawler[state.owner],
    align: 'right',
  });
  const atMax = state.level >= def.maxLevel;
  meter(ui, layout.row(lineHeightOf(ui, 'caption') + space.xs, space.md), {
    id: `detail/${def.id}/xp`,
    kind: 'xp',
    value: xpFraction(state),
    max: 1,
    valueText: atMax ? 'MAX LEVEL' : `${state.xp} / ${state.xpToNextLevel} XP`,
    ghost: false,
  });
  const guide = def.id === MONGO_ABILITY_ID ? ctx.guides.mongo : undefined;
  if (guide !== undefined) {
    wideButton(layout, { id: 'mongo-guide', label: 'How Mongo works', icon: 'info', onTap: guide });
    layout.space(space.sm);
  }
  layout.heading('Level perks');
  for (const perk of def.perks) perkRow(layout, ui, perk, state.level);
}

// ── Hotbar ──────────────────────────────────────────────────────────────────

/** Moves an ability tome from the hotbar back into the first free bag slot. */
function returnToBag(inventory: Inventory, slotIndex: number): void {
  const item = inventory.actionBar.slots[slotIndex];
  const emptyIdx = inventory.bag.slots.indexOf(null);
  if (item === null || emptyIdx === -1) return;
  inventory.bag.slots[emptyIdx] = item;
  inventory.actionBar.slots[slotIndex] = null;
}

/**
 * Puts a bag tome on the hotbar: the first empty ability slot, else slot 1.
 * Whatever held that slot takes the tome's place in the bag, so nothing is
 * ever overwritten.
 */
function addToHotbar(inventory: Inventory, bagIndex: number): void {
  const bagItem = inventory.bag.slots[bagIndex];
  if (bagItem === null) return;
  const firstEmpty = inventory.actionBar.slots.findIndex(
    (slot, index) => index < ABILITY_HOTBAR_SLOTS && slot === null,
  );
  const target = firstEmpty === -1 ? 0 : firstEmpty;
  inventory.bag.slots[bagIndex] = inventory.actionBar.slots[target];
  inventory.actionBar.slots[target] = bagItem;
}

function tomeAbility(item: { canDrop?: boolean; abilityId?: string } | null): AbilityId | null {
  if (item?.canDrop !== false || item.abilityId === undefined) return null;
  return isAbilityId(item.abilityId) ? item.abilityId : null;
}

function hotbarSlot(
  layout: SectionLayout,
  ctx: PauseContext,
  inventory: Inventory,
  cell: Rect,
  index: number,
): void {
  const { ui } = layout;
  const { palette, radius, space } = ui.theme;
  const item = inventory.actionBar.slots[index];
  const abilityId = tomeAbility(item);
  const def = abilityId === null ? null : ctx.abilities.getDef(abilityId);
  const filled = def !== null;
  const state = filled
    ? ui.hit(`hotbar/${index}`, cell, { onTap: () => returnToBag(inventory, index) })
    : { hovered: false, pressed: false, focused: false };
  fillRounded(ui.ctx, cell, radius.md, filled ? palette.accent.soft : palette.surface.sunken);
  strokeRounded(
    ui.ctx,
    cell,
    radius.md,
    state.focused || state.hovered ? palette.accent.base : palette.border.subtle,
    BORDER_WIDTH,
  );
  const art = inset(cell, space.sm);
  if (def !== null) {
    def.renderIcon(ui.ctx, topLeftSquare(art), ctx.abilities.getLevel(def.id));
    tooltip(ui, cell, {
      id: `hotbar/${index}/tip`,
      text: `Move ${def.name} back to the bag`,
      show: state.hovered || state.focused,
    });
    layout.track(cell, state);
  } else if (item !== null) {
    ui.ctx.save();
    ui.ctx.globalAlpha *= ITEM_SLOT_ALPHA;
    ITEM_ICONS[item.id](ui.ctx, art);
    ui.ctx.restore();
  }
  keycap(
    ui,
    { x: cell.x, y: cell.y, w: cell.w * SLOT_KEY_CORNER, h: cell.h * SLOT_KEY_CORNER },
    { label: String(index + 1), small: true },
  );
}

function renderHotbar(
  layout: SectionLayout,
  ctx: PauseContext,
  crawler: CrawlerKind,
  pick: (crawler: CrawlerKind) => void,
): void {
  const { ui } = layout;
  const { space, size } = ui.theme;
  choiceRow(layout, {
    id: 'hotbar-crawler',
    choices: CRAWLER_CHOICES,
    selected: crawler,
    onPick: pick,
  });
  const inventory = crawler === 'human' ? ctx.human.inventory : ctx.cat.inventory;

  layout.heading('Hotbar');
  const slotGap = space.sm;
  const slotSide = Math.min(
    size.slot,
    (layout.width - slotGap * (ABILITY_HOTBAR_SLOTS - 1)) / ABILITY_HOTBAR_SLOTS,
  );
  const strip = layout.row(slotSide, space.sm);
  const cells = grid(
    centerIn(
      strip,
      slotSide * ABILITY_HOTBAR_SLOTS + slotGap * (ABILITY_HOTBAR_SLOTS - 1),
      slotSide,
    ),
    ABILITY_HOTBAR_SLOTS,
    { minCell: slotSide, gap: slotGap },
  );
  cells.forEach((cell, index) => hotbarSlot(layout, ctx, inventory, cell, index));
  layout.paragraph('Tap an ability on the hotbar to move it back to the bag.', 'muted', space.md);

  layout.heading('In the bag');
  const tomes: { bagIndex: number; id: AbilityId }[] = [];
  inventory.bag.slots.forEach((slot, bagIndex) => {
    const id = tomeAbility(slot);
    if (id !== null) tomes.push({ bagIndex, id });
  });
  if (tomes.length === 0) {
    layout.paragraph('No abilities in bag.', 'muted');
    return;
  }
  for (const tome of tomes) {
    const def = ctx.abilities.getDef(tome.id);
    if (def === null) continue;
    const rect = layout.row(listRowHeight(ui, false), space.xs);
    const addW = size.control * ADD_BUTTON_WIDTH_CONTROLS;
    listRow(ui, rect, {
      id: `tome/${tome.bagIndex}`,
      title: def.name,
      leading: { kind: 'paint', paint: paintIcon(def, ctx.abilities.getLevel(def.id)) },
      trailingWidth: addW,
      trailingContent: (cell) => {
        const buttonRect = centerIn(cell, cell.w, buttonHeight(ui, 'sm'));
        layout.track(
          buttonRect,
          button(ui, buttonRect, {
            id: `tome/${tome.bagIndex}/add`,
            label: 'Add',
            icon: 'plus',
            size: 'sm',
            variant: 'success',
            onTap: () => addToHotbar(inventory, tome.bagIndex),
          }),
        );
      },
    });
  }
}

// ── Section ─────────────────────────────────────────────────────────────────

export function abilitiesSection(): PauseSection {
  let view: AbilitiesView = { kind: 'list' };
  let hotbarCrawler: CrawlerKind = 'cat';
  const show = (next: AbilitiesView): void => {
    view = next;
  };
  return {
    id: 'abilities',
    label: 'Abilities',
    glyph: 'sparkle',
    title: (ctx) => {
      if (view.kind === 'hotbar') return 'Hotbar abilities';
      if (view.kind === 'detail') return ctx.abilities.getDef(view.id)?.name ?? 'Abilities';
      return 'Abilities';
    },
    render: (layout, ctx) => {
      if (view.kind === 'hotbar') {
        renderHotbar(layout, ctx, hotbarCrawler, (crawler) => {
          hotbarCrawler = crawler;
        });
        return;
      }
      if (view.kind === 'detail') {
        const def = ctx.abilities.getDef(view.id);
        if (def !== null) {
          renderDetail(layout, ctx, def);
          return;
        }
        view = { kind: 'list' };
      }
      renderList(layout, ctx.abilities, show);
    },
    subView: {
      active: () => view.kind !== 'list',
      key: () => (view.kind === 'detail' ? `detail-${view.id}` : view.kind),
      exit: () => {
        view = { kind: 'list' };
      },
    },
    reset: () => {
      view = { kind: 'list' };
    },
  };
}
