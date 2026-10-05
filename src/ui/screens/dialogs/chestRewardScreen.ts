/**
 * The treasure-chest card: the chest rattles open in a burst of sparks, then
 * the haul is listed in two columns, one per crawler.
 *
 * {@link ChestRewardDialog} keeps the timeline (the scene ticks it each
 * update and plays the reward cue when it asks); this surface only draws it.
 *
 * - Band `system`; halts the world and locks the keyboard.
 * - Once the lid is up, any key (Escape included) or a tap on the scrim or the
 *   card's body dismisses it (the card's padding does not); before that every
 *   key and tap is swallowed. Auto-repeats never
 *   dismiss. No sound plays on dismissal.
 */

import { ITEM_DEF, type ItemId } from '../../../core/ItemDefs';
import type { LootDrop } from '../../../creatures/Mob';
import { getChestImage, getChestSourceScale } from '../../../systems/TreasureChestSystem';
import type { ChestLootSplit, ChestRewardDialog, ChestRewardView } from '../../ChestRewardDialog';
import { centerIn, splitH, splitV, type Rect } from '../../core/geom';
import type { Surface, Ui } from '../../core/UiRoot';
import { withAlpha } from '../../theme/color';
import { drawGlyph } from '../../theme/glyphs';
import type { Theme } from '../../theme/tokens';
import { itemSlot } from '../../widgets/itemSlot';
import { strokeRounded } from '../../widgets/paint';
import { panel } from '../../widgets/panel';
import { lineHeightOf, measureTextHeight, text } from '../../widgets/text';
import { fitPanelBody, glowText, headlineStyle } from './endScreenParts';

const TITLE = 'TREASURE!';
const EMPTY_CHEST_TEXT = 'The chest is empty.';
const EMPTY_COLUMN_TEXT = '(empty)';
const CONTINUE_HINT = 'Press any key or click to continue';
const CONTINUE_HINT_TOUCH = 'Tap anywhere to continue';
const HUMAN_COLUMN = 'Human';
const CAT_COLUMN = 'Cat';

const CHEST_SPRITE_SIZE = 64;
/** The chest sheet's frames, authored at their full-resolution 80px size. */
const CHEST_SOURCE_FRAME = 80;
const CHEST_WOODEN_CLOSED_X = 0;
const CHEST_WOODEN_OPEN_X = 80;
const CHEST_SILVER_CLOSED_X = 160;
const CHEST_SILVER_OPEN_X = 240;
const SPARK_RADIUS = 3;
const ENTRY_ICON_SIZE = 24;
const OPENING_DOT_STEP_FRAMES = 10;
const OPENING_DOT_CYCLE = 3;
const GLOW_PULSE_FREQ = 0.08;
const GLOW_BLUR_MIN = 20;
const GLOW_BLUR_RANGE = 20;
const GLOW_EDGE_WIDTH = 2;
const TITLE_GLOW_ALPHA = 0.6;
const COLUMN_RULE_ALPHA = 0.15;
const COLUMN_RULE_WIDTH = 1;
const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

type EntryKind = 'coins' | 'item' | 'custom' | 'empty';

interface LootEntry {
  readonly label: string;
  readonly kind: EntryKind;
  readonly item?: ItemId;
}

function lootEntries(
  loot: LootDrop,
  displayLabels: ChestLootSplit['displayLabels'],
  customEntries: readonly string[] | undefined,
): LootEntry[] {
  const entries: LootEntry[] = [];
  if (loot.coins > 0) entries.push({ label: `${loot.coins} coins`, kind: 'coins' });
  for (const entry of loot.items) {
    const baseName = displayLabels?.[entry.id] ?? ITEM_DEF[entry.id].name;
    const label = entry.quantity > 1 ? `${entry.quantity}x ${baseName}` : baseName;
    entries.push({ label, kind: 'item', item: entry.id });
  }
  for (const label of customEntries ?? []) entries.push({ label, kind: 'custom' });
  if (entries.length === 0) entries.push({ label: EMPTY_COLUMN_TEXT, kind: 'empty' });
  return entries;
}

function entryHeight(ui: Ui, entry: LootEntry, width: number): number {
  const labelH = measureTextHeight(ui, width - ENTRY_ICON_SIZE - ui.theme.space.sm, {
    text: entry.label,
    role: 'caption',
  });
  return Math.max(ENTRY_ICON_SIZE, labelH);
}

function columnHeight(ui: Ui, entries: readonly LootEntry[], width: number): number {
  return entries.reduce((sum, entry) => sum + entryHeight(ui, entry, width) + ui.theme.space.xs, 0);
}

function drawEntry(ui: Ui, rect: Rect, entry: LootEntry, id: string): void {
  const { palette } = ui.theme;
  const [iconCol, labelCol] = splitH(rect, [ENTRY_ICON_SIZE, 'fill'], ui.theme.space.sm);
  const icon = centerIn({ ...iconCol, h: ENTRY_ICON_SIZE }, ENTRY_ICON_SIZE, ENTRY_ICON_SIZE);
  if (entry.kind === 'coins') {
    drawGlyph(ui.ctx, 'coin', icon, { color: palette.accent.base });
  } else if (entry.item !== undefined) {
    itemSlot(ui, icon, { id, item: entry.item, categoryAccent: false, tooltip: true });
  } else if (entry.kind === 'custom') {
    drawGlyph(ui.ctx, 'sparkle', icon, { color: palette.accent.hover });
  }
  text(ui, labelCol, {
    text: entry.label,
    role: entry.kind === 'empty' ? 'muted' : entry.kind === 'coins' ? 'accent' : 'caption',
    color: entry.kind === 'item' || entry.kind === 'custom' ? palette.text.primary : undefined,
    wrap: true,
    valign: 'top',
  });
}

function sparkColors(theme: Theme): readonly string[] {
  const { palette } = theme;
  return [
    palette.accent.base,
    palette.accent.hover,
    palette.state.warning,
    palette.accent.press,
    palette.text.primary,
    palette.state.success,
  ];
}

function drawChest(ui: Ui, rect: Rect, view: ChestRewardView): void {
  const image = getChestImage();
  const sprite = centerIn(rect, CHEST_SPRITE_SIZE, CHEST_SPRITE_SIZE);
  if (image !== undefined) {
    const wooden = view.chestType === 'wooden';
    const sourceX = wooden
      ? view.opened
        ? CHEST_WOODEN_OPEN_X
        : CHEST_WOODEN_CLOSED_X
      : view.opened
        ? CHEST_SILVER_OPEN_X
        : CHEST_SILVER_CLOSED_X;
    const scale = getChestSourceScale();
    ui.ctx.drawImage(
      image,
      sourceX * scale,
      0,
      CHEST_SOURCE_FRAME * scale,
      CHEST_SOURCE_FRAME * scale,
      sprite.x,
      sprite.y,
      sprite.w,
      sprite.h,
    );
  }
  const cx = sprite.x + sprite.w * HALF;
  const cy = sprite.y + sprite.h * HALF;
  const colors = sparkColors(ui.theme);
  const { ctx } = ui;
  ctx.save();
  const base = ctx.globalAlpha;
  view.sparks.forEach((spark, index) => {
    ctx.globalAlpha = base * Math.max(0, spark.life / spark.maxLife);
    ctx.fillStyle = colors[index % colors.length] ?? ui.theme.palette.accent.base;
    ctx.beginPath();
    ctx.arc(cx + spark.x, cy + spark.y, SPARK_RADIUS, 0, FULL_TURN);
    ctx.fill();
  });
  ctx.restore();
}

interface ChestLayout {
  readonly tracks: readonly number[];
  readonly left: readonly LootEntry[];
  readonly right: readonly LootEntry[];
  readonly columnW: number;
}

function layout(ui: Ui, view: ChestRewardView, width: number): ChestLayout {
  const { space } = ui.theme;
  const titleH = headlineStyle(ui, TITLE, width).lineHeight;
  const columnW = (width - space.lg) / 2;
  const split = view.lootSplit;
  const left =
    split === null
      ? []
      : lootEntries(split.humanLoot, split.displayLabels, split.customHumanEntries);
  const right =
    split === null ? [] : lootEntries(split.catLoot, split.displayLabels, split.customCatEntries);
  const listed = view.opened && split !== null;
  const lootH = listed
    ? lineHeightOf(ui, 'label') +
      space.xs +
      Math.max(columnHeight(ui, left, columnW), columnHeight(ui, right, columnW))
    : lineHeightOf(ui, 'muted');
  return {
    tracks: [titleH, CHEST_SPRITE_SIZE, lootH, lineHeightOf(ui, 'muted')],
    left,
    right,
    columnW,
  };
}

function drawColumn(
  ui: Ui,
  rect: Rect,
  heading: string,
  color: string,
  entries: readonly LootEntry[],
  idPrefix: string,
): void {
  const { space } = ui.theme;
  const headH = lineHeightOf(ui, 'label');
  text(ui, { ...rect, h: headH }, { text: heading, role: 'label', color, align: 'center' });
  let y = rect.y + headH + space.xs;
  entries.forEach((entry, index) => {
    const h = entryHeight(ui, entry, rect.w);
    drawEntry(ui, { x: rect.x, y, w: rect.w, h }, entry, `${idPrefix}-${index}`);
    y += h + space.xs;
  });
}

function render(ui: Ui, model: ChestRewardDialog): void {
  const view = model.view;
  if (view === null) return;
  const { ctx, theme } = ui;
  const { palette, space } = theme;
  const heightOf = (tracks: readonly number[]): number =>
    tracks.reduce((sum, h) => sum + h, 0) + space.md * (tracks.length - 1);
  const fit = fitPanelBody(ui, { width: 'sm' }, (width) =>
    heightOf(layout(ui, view, width).tracks),
  );
  const laid = layout(ui, view, fit.width);
  const dismiss = (): void => void model.dismiss();

  const p = panel(ui, {
    id: 'chest-reward',
    width: 'sm',
    height: 'content',
    contentHeight: fit.contentHeight,
    scrollBody: fit.scroll,
    onScrimTap: dismiss,
    onCardTap: dismiss,
    content: (body: Rect) => {
      const [titleRow, chestRow, lootRow, hintRow] = splitV(body, laid.tracks, space.md);
      glowText(ui, titleRow, {
        text: TITLE,
        style: headlineStyle(ui, TITLE, body.w),
        color: palette.accent.base,
        glow: withAlpha(palette.accent.base, TITLE_GLOW_ALPHA),
        glowBlur: space.lg,
      });
      drawChest(ui, chestRow, view);
      const split = view.lootSplit;
      if (!view.opened) {
        const dots = '.'.repeat(
          1 + (Math.floor(view.frame / OPENING_DOT_STEP_FRAMES) % OPENING_DOT_CYCLE),
        );
        text(ui, lootRow, { text: `Opening${dots}`, role: 'muted', align: 'center' });
      } else if (split === null) {
        text(ui, lootRow, { text: EMPTY_CHEST_TEXT, role: 'muted', align: 'center' });
      } else {
        const [leftCol, rightCol] = splitH(lootRow, [laid.columnW, laid.columnW], space.lg);
        drawColumn(ui, leftCol, HUMAN_COLUMN, palette.crawler.human, laid.left, 'human');
        drawColumn(ui, rightCol, CAT_COLUMN, palette.crawler.cat, laid.right, 'cat');
        ctx.save();
        ctx.fillStyle = withAlpha(palette.text.primary, COLUMN_RULE_ALPHA);
        ctx.fillRect(
          lootRow.x + lootRow.w / 2 - COLUMN_RULE_WIDTH / 2,
          lootRow.y,
          COLUMN_RULE_WIDTH,
          lootRow.h,
        );
        ctx.restore();
      }
      if (view.opened) {
        text(ui, hintRow, {
          text: ui.density === 'touch' ? CONTINUE_HINT_TOUCH : CONTINUE_HINT,
          role: 'muted',
          align: 'center',
        });
      }
    },
  });

  const tint = view.chestType === 'silver' ? palette.text.secondary : palette.category.tool;
  const pulse = HALF + HALF * Math.sin(view.frame * GLOW_PULSE_FREQ);
  ctx.save();
  ctx.shadowColor = tint;
  ctx.shadowBlur = GLOW_BLUR_MIN + pulse * GLOW_BLUR_RANGE;
  strokeRounded(ctx, p.frame, theme.radius.lg, tint, GLOW_EDGE_WIDTH);
  ctx.restore();
}

/** The chest card over the scene's `ChestRewardDialog`. */
export function chestRewardSurface(
  model: ChestRewardDialog,
  opts: { readonly id?: string } = {},
): Surface {
  return {
    id: opts.id ?? 'chest-reward',
    band: 'system',
    haltsWorld: true,
    locksKeyboard: true,
    isOpen: () => model.isOpen,
    onKey: (_key, mods) => {
      if (mods.repeat !== true) model.handleKeyDown();
      return true;
    },
    render: (ui) => render(ui, model),
  };
}
