/**
 * One crawler's card in the top-left stack: a portrait glyph ringed in the
 * crawler's colour, its name, a level disc, the HP meter with its numbers
 * inside and a draining ghost, a thin XP meter, and the status pills hung
 * under the card. Unspent skill points put a gold `+N` badge on the portrait,
 * beside the level disc, that opens the Spend section.
 */

import { centerIn, inset, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { withAlpha } from '../theme/color';
import { drawGlyph } from '../theme/glyphs';
import { skinsFor } from '../theme/skins';
import { badge, badgeSize } from '../widgets/badge';
import { meter } from '../widgets/meter';
import { drawGlass, fillRounded, strokeRounded } from '../widgets/paint';
import { measureText, tabularNumber, text } from '../widgets/text';
import { tooltip } from '../widgets/tooltip';
import type { UnitFrameRects } from './hudLayout';
import type { SkillPointsModel, StatusPillModel, UnitFrameModel } from './hudModel';

/** Below this fraction of max HP the meter turns to its low colour. */
const LOW_HP_FRACTION = 0.25;
const PORTRAIT_RING_WIDTH = 2;
const ACTIVE_BORDER_WIDTH = 1.5;
/** The glyph fills this fraction of the portrait. */
const PORTRAIT_GLYPH_RATIO = 0.56;
const PORTRAIT_FILL_ALPHA = 0.16;
/** A resting crawler's card is dimmed a touch so the active one leads. */
const COMPANION_ALPHA = 0.88;
const PILL_FILL_ALPHA = 0.24;
const PILL_SPENT_ALPHA = 0.45;
/** The XP strip is a few units tall; its hover target reaches this far above and below it. */
const XP_HOVER_REACH = 4;
const FULL_TURN = Math.PI * 2;
const TOP = -Math.PI / 2;
/** The skill badge's pulse, in milliseconds per beat; faster while the reminder nags. */
const BADGE_PULSE_MS = 900;
const BADGE_NAG_PULSE_MS = 380;
const BADGE_GLOW_MIN = 0.35;
const BADGE_NAG_GLOW_BLUR_SCALE = 2;

export interface UnitFrameOptions {
  readonly active: boolean;
  /** Crawler colour token for the ring and accents. */
  readonly color: string;
  readonly skillPoints: SkillPointsModel;
}

/** Draws the card. Returns the skill-point badge's tap target, when it shows. */
export function unitFrame(
  ui: Ui,
  rects: UnitFrameRects,
  model: UnitFrameModel,
  opts: UnitFrameOptions,
): Rect | null {
  const { ctx, theme } = ui;
  const { palette } = theme;
  const skin = skinsFor(theme).panel.hud;
  ctx.save();
  if (!opts.active) ctx.globalAlpha *= COMPANION_ALPHA;
  ui.block(rects.card);
  drawGlass(ui, rects.card, skin);
  if (opts.active) {
    strokeRounded(ctx, rects.card, skin.radius, palette.accent.base, ACTIVE_BORDER_WIDTH);
  }
  portrait(ui, rects.portrait, model, opts.color);
  levelDisc(ui, rects.levelDisc, model.level);
  text(ui, rects.name, {
    text: model.name,
    role: opts.active ? 'label' : 'caption',
    valign: 'middle',
  });
  meter(ui, rects.hp, {
    id: `${model.id}/hp`,
    value: model.hp,
    max: model.maxHp,
    kind: 'hp',
    lowBelow: LOW_HP_FRACTION,
    valueText: `${model.hp} / ${model.maxHp}`,
  });
  meter(ui, rects.xp, {
    id: `${model.id}/xp`,
    value: model.xp,
    max: model.xpMax,
    kind: 'xp',
    ghost: false,
  });
  ctx.restore();
  const xpHover = ui.hit(
    `${model.id}/xp`,
    inset(rects.xp, { t: -XP_HOVER_REACH, b: -XP_HOVER_REACH }),
    {
      focusable: false,
    },
  );
  tooltip(ui, rects.xp, {
    id: `${model.id}/xp/tip`,
    title: `${model.name} · level ${model.level}`,
    text: `${model.xp} / ${model.xpMax} XP`,
    show: xpHover.hovered,
  });
  statusRow(ui, rects.status, model.status);
  if (model.skillPoints <= 0 || opts.skillPoints.hidden) return null;
  return skillBadge(ui, rects, model, opts);
}

function portrait(ui: Ui, r: Rect, model: UnitFrameModel, color: string): void {
  const { ctx, theme } = ui;
  const radius = r.w / 2;
  fillRounded(ctx, r, radius, theme.palette.surface.sunken);
  fillRounded(ctx, r, radius, withAlpha(color, PORTRAIT_FILL_ALPHA));
  strokeRounded(ctx, inset(r, PORTRAIT_RING_WIDTH / 2), radius, color, PORTRAIT_RING_WIDTH);
  const side = r.w * PORTRAIT_GLYPH_RATIO;
  drawGlyph(ctx, model.glyph, centerIn(r, side, side), { color });
}

function levelDisc(ui: Ui, r: Rect, level: number): void {
  const { ctx, theme } = ui;
  fillRounded(ctx, r, r.w / 2, theme.palette.surface.raised);
  strokeRounded(ctx, r, r.w / 2, theme.palette.border.strong, 1);
  tabularNumber(ui, r, {
    value: level,
    style: theme.type.overline,
    color: theme.palette.text.primary,
    align: 'center',
  });
}

function skillBadge(
  ui: Ui,
  rects: UnitFrameRects,
  model: UnitFrameModel,
  opts: UnitFrameOptions,
): Rect {
  const { ctx, theme } = ui;
  const label = `+${model.skillPoints}`;
  const size = badgeSize(ui, { label });
  const portrait = rects.portrait;
  const pill: Rect = {
    x: portrait.x + portrait.w - size.w + theme.space.xs,
    y: portrait.y - size.h / 2 + theme.space.xxs,
    w: size.w,
    h: size.h,
  };
  const target: Rect = {
    x: portrait.x,
    y: pill.y,
    w: Math.max(portrait.x + portrait.w, pill.x + pill.w) - portrait.x,
    h: portrait.y + portrait.h - pill.y,
  };
  const open = (): void => opts.skillPoints.open();
  const state = ui.hit(`${model.id}/skill-points`, target, {
    onTap: open,
    sound: null,
  });
  const period = opts.skillPoints.nag ? BADGE_NAG_PULSE_MS : BADGE_PULSE_MS;
  const beat = (Math.sin((ui.now / period) * FULL_TURN) + 1) / 2;
  ctx.save();
  ctx.shadowColor = theme.palette.accent.base;
  ctx.shadowBlur =
    theme.space.sm *
    (BADGE_GLOW_MIN + beat) *
    (opts.skillPoints.nag ? BADGE_NAG_GLOW_BLUR_SCALE : 1);
  badge(ui, pill, { label, tone: 'accent' });
  ctx.restore();
  tooltip(ui, target, {
    id: `${model.id}/skill-points/tip`,
    title: `${model.skillPoints} skill point${model.skillPoints === 1 ? '' : 's'} to spend`,
    text: ui.density === 'touch' ? 'Tap to spend' : 'Click to spend',
    show: state.hovered,
  });
  return target;
}

/**
 * The pills that fit the row, each measured before it is drawn; when some
 * don't fit, the last place goes to a `+N` pill counting the rest.
 */
function statusRow(ui: Ui, row: Rect, pills: readonly StatusPillModel[]): void {
  const gap = ui.theme.space.xs;
  const right = row.x + row.w;
  let x = row.x;
  for (const [index, pill] of pills.entries()) {
    const w = statusPillWidth(ui, row.h, pill.label);
    const left = pills.length - index - 1;
    const overflowW = left > 0 ? gap + countPillWidth(ui, row.h, left) : 0;
    if (x + w + overflowW > right) {
      countPill(
        ui,
        { x, y: row.y, w: countPillWidth(ui, row.h, pills.length - index), h: row.h },
        pills.length - index,
      );
      return;
    }
    statusPill(ui, { x, y: row.y, w, h: row.h }, pill);
    x += w + gap;
  }
}

function statusPillWidth(ui: Ui, h: number, label: string): number {
  const { theme } = ui;
  const timer = h - theme.space.xxs * 2;
  const labelW = measureText(ui, label, { style: theme.type.overline });
  return Math.ceil(theme.space.xxs + timer + theme.space.xs + labelW + theme.space.sm);
}

function countPillWidth(ui: Ui, h: number, count: number): number {
  const labelW = measureText(ui, `+${count}`, { style: ui.theme.type.overline });
  return Math.max(h, Math.ceil(labelW + ui.theme.space.sm * 2));
}

function countPill(ui: Ui, r: Rect, count: number): void {
  const { ctx, theme } = ui;
  fillRounded(ctx, r, theme.radius.pill, theme.palette.surface.raised);
  strokeRounded(ctx, r, theme.radius.pill, theme.palette.border.strong, 1);
  text(ui, r, {
    text: `+${count}`,
    style: theme.type.overline,
    color: theme.palette.text.secondary,
    align: 'center',
  });
}

/** Draws one pill in `r`, as wide as {@link statusPillWidth} measured it. */
function statusPill(ui: Ui, r: Rect, pill: StatusPillModel): void {
  const { ctx, theme } = ui;
  const style = theme.type.overline;
  const timer = r.h - theme.space.xxs * 2;
  const labelW = measureText(ui, pill.label, { style });
  ctx.save();
  if (pill.spent === true) ctx.globalAlpha *= PILL_SPENT_ALPHA;
  fillRounded(ctx, r, theme.radius.pill, withAlpha(pill.color, PILL_FILL_ALPHA));
  strokeRounded(
    ctx,
    r,
    theme.radius.pill,
    pill.harmful ? pill.color : theme.palette.border.strong,
    1,
  );
  const dial: Rect = { x: r.x + theme.space.xxs, y: r.y + theme.space.xxs, w: timer, h: timer };
  const cx = dial.x + timer / 2;
  const cy = dial.y + timer / 2;
  ctx.fillStyle = withAlpha(pill.color, PILL_FILL_ALPHA);
  ctx.beginPath();
  ctx.arc(cx, cy, timer / 2, 0, FULL_TURN);
  ctx.fill();
  const remaining = pill.remaining ?? 1;
  if (remaining > 0) {
    ctx.fillStyle = pill.color;
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, timer / 2, TOP, TOP + FULL_TURN * Math.min(1, remaining));
    ctx.closePath();
    ctx.fill();
  }
  text(
    ui,
    { x: dial.x + timer + theme.space.xs, y: r.y, w: labelW + theme.space.xxs, h: r.h },
    { text: pill.label, style, color: theme.palette.text.primary },
  );
  ctx.restore();
}
