/**
 * The hotbar: a glass bar at the bottom centre with one item slot per key.
 * Each slot shows its keycap top left and its quantity bottom right; a
 * cooldown sweeps over it with the seconds left. The quest slot sits after a
 * divider with a gold edge.
 *
 * A slot fires the moment it is pressed, mouse or finger: in a fight, waiting
 * for the release feels late. Arranging the bar belongs to the inventory
 * screen's own hotbar row.
 */

import { QUEST_SLOT_IDX } from '../../core/ItemDefs';
import { HOTBAR_ACTIONS, keybindings } from '../../core/Keybindings';
import type { Ui } from '../core/UiRoot';
import { skinsFor } from '../theme/skins';
import { itemSlot } from '../widgets/itemSlot';
import { drawGlass, fillRounded, strokeRounded } from '../widgets/paint';
import type { HotbarRects } from './hudLayout';
import type { HotbarModel } from './hudModel';

const QUEST_EDGE_WIDTH = 2;
const DIVIDER_WIDTH = 1;
const UNSEEN_DOT_RATIO = 0.16;

export function hotbar(ui: Ui, rects: HotbarRects, model: HotbarModel): void {
  const { ctx, theme } = ui;
  const { palette, space } = theme;
  ui.block(rects.strip);
  drawGlass(ui, rects.strip, { ...skinsFor(theme).panel.hud, radius: theme.radius.lg });

  model.slots.forEach((slot, index) => {
    const rect = rects.slots[index];
    const isQuest = index === QUEST_SLOT_IDX;
    if (isQuest) {
      const dividerX = rect.x - space.sm + space.xxs;
      ctx.save();
      ctx.strokeStyle = palette.border.strong;
      ctx.lineWidth = DIVIDER_WIDTH;
      ctx.beginPath();
      ctx.moveTo(dividerX, rect.y + space.xs);
      ctx.lineTo(dividerX, rect.y + rect.h - space.xs);
      ctx.stroke();
      ctx.restore();
    }
    const item = slot.item;
    itemSlot(ui, rect, {
      id: `hotbar/${index}`,
      item: item?.id ?? null,
      quantity: item?.quantity,
      keycap: keybindings.labelFor(HOTBAR_ACTIONS[index]),
      cooldown: slot.cooldown,
      cooldownText: slot.cooldown > 0 ? slot.cooldownLabel : undefined,
      equipped: slot.equipped,
      tooltip: true,
      onPress: () => model.input.press(index),
      handlers: { onRelease: () => model.input.release(index), sound: null },
    });
    if (isQuest) {
      strokeRounded(ctx, rect, theme.radius.md, palette.accent.base, QUEST_EDGE_WIDTH);
    }
    if (slot.unseen && !slot.equipped) {
      const dot = Math.max(space.sm, rect.w * UNSEEN_DOT_RATIO);
      fillRounded(
        ctx,
        { x: rect.x + rect.w - dot - space.xxs, y: rect.y + space.xxs, w: dot, h: dot },
        theme.radius.pill,
        palette.state.success,
      );
    }
  });
}
