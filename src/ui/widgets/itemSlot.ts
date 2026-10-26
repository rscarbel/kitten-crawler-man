/**
 * One item cell: the bag grid, the hotbar, gear slots, shop and reward lines.
 * Draws the item's icon from `itemIconPainter`, its category accent, quantity, an
 * optional key hint, a cooldown sweep, and the selected / dragged / drop-target
 * looks.
 */

import { ITEM_DEF, type ItemId } from '../../core/items/defs/ItemDefs';
import type { Rarity } from '../../core/items/defs/rarity';
import { drawRarityFrame, rarityTooltipLines } from '../screens/dialogs/canvasChrome';
import { centerIn, inset, type Rect } from '../core/geom';
import type { DragHandlers, HitHandlers, HitState, Ui } from '../core/UiRoot';
import { withAlpha } from '../theme/color';
import { drawGlyph, type GlyphId } from '../theme/glyphs';
import { skinsFor } from '../theme/skins';
import { itemIconPainter } from '../icons/itemIcons';
import { paintIsolated } from '../isolatedPaint';
import { keycap, keycapSize } from './keycap';
import {
  disabledReason,
  drawFocusRing,
  fillRounded,
  hoverAmount,
  isDisabled,
  roundRectPath,
  strokeRounded,
} from './paint';
import { tabularNumber, text } from './text';
import { tooltip } from './tooltip';

/** What every slot takes, whatever it holds. */
interface ItemSlotCommon {
  readonly id: string;
  /** Drawn bottom-right when above one. */
  readonly quantity?: number;
  /** A key hint in the top-left corner (hotbar). */
  readonly keycap?: string;
  /** Fraction of a cooldown still to run, 0 to 1. */
  readonly cooldown?: number;
  /** Seconds left, drawn in the middle of the sweep. */
  readonly cooldownText?: string;
  readonly selected?: boolean;
  /** This slot's item is being dragged elsewhere: it shows as a ghost. */
  readonly dragging?: boolean;
  /** A dragged item is over this slot and would land here. */
  readonly dropTarget?: boolean;
  /** Worn or wielded: a small check in the top-right corner. */
  readonly equipped?: boolean;
  readonly disabled?: boolean | string;
  /** Show the category accent. Defaults to true. */
  readonly categoryAccent?: boolean;
  /**
   * Show the item's name and description on hover and focus. A slot with no
   * handlers then registers a hover-only region, so taps still reach what is
   * beneath it; touch has no hover, so there it shows nothing.
   */
  readonly tooltip?: boolean;
  readonly onTap?: () => void;
  /** Fires on pointer down: hotbar slots only, where waiting for release feels laggy. */
  readonly onPress?: () => void;
  readonly onDrag?: DragHandlers;
  /** Further input on the slot: a right-click menu, a long-press timer, a quieter tap. */
  readonly handlers?: Pick<
    HitHandlers,
    'onSecondaryTap' | 'onDown' | 'onRelease' | 'dragSlop' | 'sound'
  >;
}

/** A slot holding an item: its icon, its category accent and its rarity frame. */
interface HeldItemSlot extends ItemSlotCommon {
  readonly item: ItemId;
  /** The item has awakened for its owner: it shows its awakened icon. */
  readonly awakened?: boolean;
}

/** A slot with no item in it: empty, or showing a picture of a reward that is not an item. */
interface EmptyItemSlot extends ItemSlotCommon {
  readonly item: null;
  /** Paints the slot's picture: coins, a companion. */
  readonly picture?: (ctx: CanvasRenderingContext2D, rect: Rect) => void;
  /** The rarity frame round the picture. */
  readonly rarity?: Rarity;
  /** A glyph shown faintly in an empty slot (a gear slot's silhouette). */
  readonly placeholder?: GlyphId;
}

export type ItemSlotOptions = HeldItemSlot | EmptyItemSlot;

/** What a slot holds, for a caller whose stack may be empty. */
export type ItemSlotContent = Pick<HeldItemSlot, 'item' | 'awakened'> | Pick<EmptyItemSlot, 'item'>;

/** The slot's content for `item`, awake or not; an empty slot for null. */
export function slotContent(item: ItemId | null, awakened: boolean): ItemSlotContent {
  return item === null ? { item: null } : { item, awakened };
}

const CATEGORY_TINT_ALPHA = 0.1;
const CATEGORY_EDGE_ALPHA = 0.85;
const CATEGORY_EDGE_HEIGHT = 2;
const CATEGORY_EDGE_INSET_RATIO = 0.3;
const HOVER_FILL_ALPHA = 0.05;
const DRAG_GHOST_ALPHA = 0.3;
const DISABLED_ALPHA = 0.4;
const COOLDOWN_SHADE_ALPHA = 0.72;
const DROP_TARGET_DASH = 4;
const EMPTY_GLYPH_SCALE = 0.42;
const EMPTY_GLYPH_ALPHA = 0.35;
const EQUIPPED_DOT_SCALE = 0.3;
const EQUIPPED_CHECK_INSET_RATIO = 0.18;
/** Heavier than the glyph default so the tick reads at dot size. */
const EQUIPPED_CHECK_STROKE = 3;
const BORDER_WIDTH = 1;
const SELECTED_BORDER_WIDTH = 2;
/** The icon fills the slot minus this fraction on each side. */
const ICON_INSET_RATIO = 0.14;
const FULL_TURN = Math.PI * 2;
const TOP = -Math.PI / 2;
const NO_STATE: HitState = { hovered: false, pressed: false, focused: false };

export function itemSlot(ui: Ui, rect: Rect, opts: ItemSlotOptions): HitState {
  const { theme, ctx } = ui;
  const { palette, radius, space } = theme;
  const disabled = isDisabled(opts.disabled);
  const onTap = opts.onTap;
  const onPress = opts.onPress;
  const interactive =
    onTap !== undefined ||
    onPress !== undefined ||
    opts.onDrag !== undefined ||
    opts.handlers !== undefined ||
    disabled;
  const tooltipItem = opts.tooltip === true ? opts.item : null;
  const state = interactive
    ? ui.hit(opts.id, rect, {
        ...opts.handlers,
        onTap: onTap === undefined ? undefined : () => onTap(),
        onPress: onPress === undefined ? undefined : () => onPress(),
        onDrag: opts.onDrag,
        disabled,
        focusable: onTap !== undefined || onPress !== undefined ? undefined : false,
      })
    : tooltipItem !== null
      ? ui.hit(opts.id, rect, { hoverOnly: true })
      : NO_STATE;
  const hover = hoverAmount(ui, opts.id, state.hovered && !disabled);
  const pressed = state.pressed && !disabled && opts.onPress === undefined;
  const r: Rect = pressed ? { ...rect, y: rect.y + skinsFor(theme).pressDrop } : rect;
  const corner = radius.md;
  const category = opts.item === null ? null : ITEM_DEF[opts.item].category;
  const accent =
    category === null || opts.categoryAccent === false ? null : palette.category[category];
  const selected = opts.selected === true;
  const frameRarity = opts.item === null ? opts.rarity : ITEM_DEF[opts.item].rarity;

  fillRounded(ctx, r, corner, palette.surface.sunken);
  if (accent !== null) {
    const tint = ctx.createLinearGradient(0, r.y, 0, r.y + r.h);
    tint.addColorStop(0, withAlpha(accent, 0));
    tint.addColorStop(1, withAlpha(accent, CATEGORY_TINT_ALPHA));
    ctx.save();
    ctx.fillStyle = tint;
    roundRectPath(ctx, r, corner);
    ctx.fill();
    ctx.restore();
  }
  if (selected) fillRounded(ctx, r, corner, palette.accent.soft);
  if (hover > 0) {
    ctx.save();
    ctx.globalAlpha *= hover;
    fillRounded(ctx, r, corner, withAlpha(palette.text.primary, HOVER_FILL_ALPHA));
    ctx.restore();
  }

  const art = inset(r, Math.round(r.w * ICON_INSET_RATIO));
  // Painters scale their curves off the square they are given, so one with
  // no area (a window squeezed to nothing) would hand the canvas a NaN.
  const artHasArea = art.w > 0 && art.h > 0;
  if (opts.item !== null) {
    if (artHasArea) {
      ctx.save();
      if (opts.dragging === true) ctx.globalAlpha *= DRAG_GHOST_ALPHA;
      else if (disabled) ctx.globalAlpha *= DISABLED_ALPHA;
      const id = opts.item;
      const paintIcon = itemIconPainter(id, opts.awakened === true);
      paintIsolated(ctx, `item icon "${id}"`, () => paintIcon(ctx, art));
      ctx.restore();
    }
  } else if (opts.picture !== undefined) {
    const picture = opts.picture;
    if (artHasArea) paintIsolated(ctx, 'slot picture', () => picture(ctx, art));
  } else if (opts.placeholder !== undefined) {
    const side = r.w * EMPTY_GLYPH_SCALE;
    ctx.save();
    ctx.globalAlpha *= EMPTY_GLYPH_ALPHA;
    drawGlyph(ctx, opts.placeholder, centerIn(r, side, side), { color: palette.text.muted });
    ctx.restore();
  }

  if (accent !== null) {
    const edgeInset = r.w * CATEGORY_EDGE_INSET_RATIO;
    fillRounded(
      ctx,
      {
        x: r.x + edgeInset,
        y: r.y + r.h - CATEGORY_EDGE_HEIGHT - space.xxs,
        w: r.w - edgeInset * 2,
        h: CATEGORY_EDGE_HEIGHT,
      },
      radius.pill,
      withAlpha(accent, CATEGORY_EDGE_ALPHA),
    );
  }

  const cooldown = opts.cooldown ?? 0;
  if (cooldown > 0) {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    ctx.save();
    roundRectPath(ctx, r, corner);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, Math.hypot(r.w, r.h), TOP, TOP + FULL_TURN * Math.min(1, cooldown));
    ctx.closePath();
    ctx.fillStyle = withAlpha(palette.surface.sunken, COOLDOWN_SHADE_ALPHA);
    ctx.fill();
    ctx.restore();
    if (opts.cooldownText !== undefined) {
      text(ui, r, {
        text: opts.cooldownText,
        role: 'title',
        align: 'center',
        tabular: true,
        halo: palette.surface.sunken,
      });
    }
  }

  const quantity = opts.quantity ?? 0;
  if (opts.item !== null && quantity > 1) {
    const qRect = inset(r, { r: space.xs, b: space.xs + CATEGORY_EDGE_HEIGHT });
    tabularNumber(ui, qRect, {
      value: quantity,
      role: 'label',
      align: 'right',
      valign: 'bottom',
      halo: palette.surface.sunken,
    });
  }

  if (opts.keycap !== undefined) {
    const cap = keycapSize(ui, { label: opts.keycap, small: true });
    keycap(
      ui,
      { x: r.x + space.xxs, y: r.y + space.xxs, w: cap.w, h: cap.h },
      { label: opts.keycap, small: true },
    );
  }

  if (opts.equipped === true) {
    const dot = Math.max(space.md, r.w * EQUIPPED_DOT_SCALE);
    const dotRect: Rect = { x: r.x + r.w - dot - space.xxs, y: r.y + space.xxs, w: dot, h: dot };
    fillRounded(ctx, dotRect, radius.pill, palette.accent.base);
    drawGlyph(ctx, 'check', inset(dotRect, dot * EQUIPPED_CHECK_INSET_RATIO), {
      color: palette.text.inverse,
      strokeWidth: EQUIPPED_CHECK_STROKE,
    });
  }

  if (opts.dropTarget === true) {
    ctx.save();
    ctx.setLineDash([DROP_TARGET_DASH, DROP_TARGET_DASH]);
    strokeRounded(ctx, r, corner, palette.accent.base, SELECTED_BORDER_WIDTH);
    ctx.restore();
  } else if (selected) {
    strokeRounded(ctx, r, corner, palette.accent.base, SELECTED_BORDER_WIDTH);
  } else if (frameRarity !== undefined) {
    drawRarityFrame(ui, r, corner, frameRarity);
  } else {
    strokeRounded(
      ctx,
      r,
      corner,
      hover > 0 ? palette.border.strong : palette.border.subtle,
      BORDER_WIDTH,
    );
  }
  if (state.focused) drawFocusRing(ui, r, corner);

  const reason = disabledReason(opts.disabled);
  if (tooltipItem !== null) {
    const def = ITEM_DEF[tooltipItem];
    tooltip(ui, rect, {
      id: `${opts.id}/tip`,
      title: def.name,
      lines: rarityTooltipLines(theme, tooltipItem),
      accent: accent ?? undefined,
      text: reason ?? def.description ?? def.category,
      show: state.hovered || state.focused || (reason !== null && state.pressed),
      immediate: state.focused || state.pressed,
    });
  } else if (reason !== null) {
    tooltip(ui, rect, {
      id: `${opts.id}/reason`,
      text: reason,
      show: state.hovered || state.pressed,
      immediate: state.pressed,
    });
  }
  return state;
}
