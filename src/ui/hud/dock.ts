/**
 * The HUD's buttons: the dock column under the minimap (Pause, Bag, Build,
 * the achievement chip, the Journal), the Follower and switch buttons and
 * Mongo's Summon card. Every rect comes from
 * `hudLayout`; this module only draws them and wires their taps.
 */

import { inset, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { withAlpha } from '../theme/color';
import { skinsFor } from '../theme/skins';
import { iconButton } from '../widgets/iconButton';
import { keycap, keycapSize } from '../widgets/keycap';
import { meter } from '../widgets/meter';
import { drawGlass, roundRectPath, strokeRounded } from '../widgets/paint';
import { tabularNumber, text } from '../widgets/text';
import { tooltip } from '../widgets/tooltip';
import type { HudButtonRects } from './hudButtonLayout';
import type { DockButtonId, DockButtonModel, SummonModel } from './hudModel';

/** Peak extra scale of a button's landing squash-bounce. */
const BOUNCE_SCALE = 0.18;
/** The attention ring's beat, in milliseconds. */
const PULSE_PERIOD_MS = 660;
const PULSE_RING_WIDTH = 2;
const FULL_TURN = Math.PI * 2;
const TOP = -Math.PI / 2;
const COOLDOWN_SHADE_ALPHA = 0.7;

export interface DockOptions {
  /** Keycap hints in the corners: a keyboard is the likely input. */
  readonly keyHints: boolean;
}

function rectFor(rects: HudButtonRects, id: DockButtonId): Rect | null {
  switch (id) {
    case 'pause':
      return rects.pause;
    case 'bag':
      return rects.bag;
    case 'build':
      return rects.build;
    case 'chip':
      return rects.chip;
    case 'journal':
      return rects.journal;
    case 'follower':
      return rects.follower;
    case 'switch':
      return rects.switchButton;
  }
}

/** Draws every button in `buttons` at its layout rect. Returns where each landed, by id. */
export function dock(
  ui: Ui,
  rects: HudButtonRects,
  buttons: readonly DockButtonModel[],
  opts: DockOptions,
): Map<DockButtonId, Rect> {
  const drawn = new Map<DockButtonId, Rect>();
  for (const model of buttons) {
    const rect = rectFor(rects, model.id);
    if (rect === null) continue;
    dockButton(ui, rect, model, opts);
    drawn.set(model.id, rect);
  }
  return drawn;
}

function dockButton(ui: Ui, rect: Rect, model: DockButtonModel, opts: DockOptions): void {
  const { ctx, theme } = ui;
  const bounce = 1 + Math.sin((model.bounce ?? 0) * Math.PI) * BOUNCE_SCALE;
  ctx.save();
  if (bounce !== 1) {
    const cx = rect.x + rect.w / 2;
    const cy = rect.y + rect.h / 2;
    ctx.translate(cx, cy);
    ctx.scale(bounce, bounce);
    ctx.translate(-cx, -cy);
  }
  const skin = skinsFor(theme).panel.hud;
  drawGlass(ui, rect, { ...skin, radius: theme.radius.md });
  iconButton(ui, rect, {
    id: `dock/${model.id}`,
    icon: model.icon,
    label: model.key === undefined ? model.label : `${model.label} (${model.key})`,
    selected: model.selected,
    badge: model.badge,
    sound: model.sound,
    onTap: () => model.onTap(),
  });
  if (model.pulse === true) {
    const beat = (Math.sin((ui.now / PULSE_PERIOD_MS) * FULL_TURN) + 1) / 2;
    ctx.save();
    ctx.globalAlpha *= beat;
    ctx.shadowColor = theme.palette.accent.base;
    ctx.shadowBlur = theme.space.md;
    strokeRounded(ctx, rect, theme.radius.md, theme.palette.accent.base, PULSE_RING_WIDTH);
    ctx.restore();
  }
  if (opts.keyHints && model.key !== undefined) {
    const cap = keycapSize(ui, { label: model.key, small: true });
    keycap(
      ui,
      {
        x: rect.x - cap.w + theme.space.sm,
        y: rect.y + rect.h - cap.h + theme.space.xs,
        w: cap.w,
        h: cap.h,
      },
      { label: model.key, small: true },
    );
  }
  ctx.restore();
}

/**
 * Mongo's card: his portrait, what a press does, his health (green once he
 * is fit to send in) and level progress, and the recovery still to run as a
 * sweep with its seconds.
 */
export function summonCard(ui: Ui, rect: Rect, model: SummonModel): void {
  const { ctx, theme } = ui;
  const { space, palette } = theme;
  const act = (): void => model.onTap();
  const state = ui.hit('summon', rect, {
    onTap: act,
    disabled: !model.usable,
    focusable: false,
  });
  const skin = skinsFor(theme).panel.hud;
  drawGlass(ui, rect, {
    ...skin,
    border: model.active ? palette.state.info : skin.border,
  });
  if (state.hovered && model.usable) {
    strokeRounded(ctx, rect, skin.radius, palette.border.strong, 1);
  }
  const body = inset(rect, space.xs);
  const icon: Rect = { x: body.x, y: body.y, w: body.h, h: body.h };
  ctx.save();
  if (!model.usable) ctx.globalAlpha *= COOLDOWN_SHADE_ALPHA;
  model.paintIcon(ctx, icon);
  ctx.restore();
  const column: Rect = {
    x: icon.x + icon.w + space.xs,
    y: body.y,
    w: Math.max(0, body.x + body.w - icon.x - icon.w - space.xs),
    h: body.h,
  };
  const barH = space.xs;
  const xpH = space.xxs;
  const hpBar: Rect = { x: column.x, y: column.y + column.h - barH, w: column.w, h: barH };
  const xpBar: Rect = { x: column.x, y: hpBar.y - space.xxs - xpH, w: column.w, h: xpH };
  text(
    ui,
    { ...column, h: xpBar.y - column.y },
    {
      text: model.label,
      style: theme.type.overline,
      color: model.usable ? palette.text.secondary : palette.text.muted,
      valign: 'middle',
    },
  );
  meter(ui, xpBar, { id: 'summon/xp', value: model.xpFraction, max: 1, kind: 'xp', ghost: false });
  meter(ui, hpBar, {
    id: 'summon/hp',
    value: model.hp,
    max: model.maxHp,
    kind: model.ready ? 'stamina' : 'danger',
  });
  if (model.cooldown > 0) {
    const cx = icon.x + icon.w / 2;
    const cy = icon.y + icon.h / 2;
    ctx.save();
    roundRectPath(ctx, icon, theme.radius.sm);
    ctx.clip();
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, icon.w, TOP, TOP + FULL_TURN * Math.min(1, model.cooldown));
    ctx.closePath();
    ctx.fillStyle = withAlpha(palette.surface.sunken, COOLDOWN_SHADE_ALPHA);
    ctx.fill();
    ctx.restore();
    tabularNumber(ui, icon, {
      value: model.cooldownSeconds,
      role: 'label',
      align: 'center',
      halo: palette.surface.sunken,
    });
  }
  tooltip(ui, rect, {
    id: 'summon/tip',
    title: 'Mongo',
    text: `${model.label} · ${model.hp} / ${model.maxHp}`,
    show: state.hovered,
  });
}
