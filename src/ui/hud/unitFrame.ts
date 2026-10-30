/**
 * One crawler's card in the top-left stack: a portrait glyph ringed in the
 * crawler's colour, its name, a level disc, the HP meter with its numbers
 * inside and a draining ghost, a thin XP meter, and the status pills: hung
 * under the card on a roomy screen, right-aligned in the name row on a
 * compact one. Unspent skill points put a gold `+N` badge on the portrait,
 * beside the level disc, that opens the Spend section. While something only
 * the crawler perceives is in their reach, the portrait breathes a cream sense
 * ring with a sparkle on its shoulder.
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
/** A crawler on another map is greyed well back: it cannot be steered, hurt or helped from here. */
const AWAY_ALPHA = 0.55;
const AWAY_TAG = 'AWAY';
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
/** Pills in the name row stop short of this much name, so the crawler stays identifiable. */
const INLINE_NAME_MIN_W = 36;
/** The sense ring stands this far outside the portrait. */
const SENSE_RING_OFFSET = 2.5;
const SENSE_RING_WIDTH = 2;
const SENSE_PULSE_MS = 1100;
const SENSE_RING_MIN_ALPHA = 0.4;
/** The sparkle on the portrait's shoulder, as a fraction of the portrait. */
const SENSE_SPARKLE_RATIO = 0.42;
const SENSE_TOOLTIP_TITLE = 'Senses something nearby';
const SENSE_TOOLTIP_TEXT = 'Something here only she can perceive. Switch to her to use it.';

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
  const away = model.presence === 'away';
  ctx.save();
  if (!opts.active) ctx.globalAlpha *= away ? AWAY_ALPHA : COMPANION_ALPHA;
  ui.block(rects.card);
  drawGlass(ui, rects.card, skin);
  if (opts.active) {
    strokeRounded(ctx, rects.card, skin.radius, palette.accent.base, ACTIVE_BORDER_WIDTH);
  }
  portrait(ui, rects.portrait, model, away ? palette.text.muted : opts.color);
  levelDisc(ui, rects.levelDisc, model.level);
  const inlinePills = rects.statusInline
    ? fitStatusPills(
        ui,
        rects.status.h,
        Math.max(0, rects.status.w - INLINE_NAME_MIN_W),
        model.status,
      )
    : null;
  const inlineGap = inlinePills === null || inlinePills.width === 0 ? 0 : ui.theme.space.xs;
  const nameRect: Rect = {
    ...rects.name,
    w: rects.name.w - (inlinePills?.width ?? 0) - inlineGap,
  };
  text(ui, nameRect, {
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
  if (inlinePills === null) {
    drawStatusPills(
      ui,
      rects.status,
      rects.status.x,
      fitStatusPills(ui, rects.status.h, rects.status.w, model.status),
    );
  } else {
    const right = rects.status.x + rects.status.w;
    drawStatusPills(ui, rects.status, right - inlinePills.width, inlinePills);
  }
  if (away) awayTag(ui, rects.portrait);
  if (model.senseCue && !away) senseRing(ui, rects.portrait, model);
  if (model.skillPoints <= 0 || opts.skillPoints.hidden) return null;
  return skillBadge(ui, rects, model, opts);
}

/** The breathing ring and sparkle that say something only this crawler perceives is near. */
function senseRing(ui: Ui, portrait: Rect, model: UnitFrameModel): void {
  const { ctx, theme } = ui;
  const color = theme.palette.sense.cue;
  const beat = (Math.sin((ui.now / SENSE_PULSE_MS) * FULL_TURN) + 1) / 2;
  const ring = inset(portrait, -SENSE_RING_OFFSET);
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = theme.space.sm * (SENSE_RING_MIN_ALPHA + beat);
  ctx.globalAlpha *= SENSE_RING_MIN_ALPHA + (1 - SENSE_RING_MIN_ALPHA) * beat;
  strokeRounded(ctx, ring, ring.w / 2, color, SENSE_RING_WIDTH);
  ctx.restore();
  const side = portrait.w * SENSE_SPARKLE_RATIO;
  const sparkle: Rect = {
    x: ring.x - side / 2 + SENSE_RING_OFFSET,
    y: ring.y - side / 2 + SENSE_RING_OFFSET,
    w: side,
    h: side,
  };
  drawGlyph(ctx, 'sparkle', sparkle, { color });
  const hover = ui.hit(`${model.id}/sense`, ring, { focusable: false });
  tooltip(ui, ring, {
    id: `${model.id}/sense/tip`,
    title: SENSE_TOOLTIP_TITLE,
    text: SENSE_TOOLTIP_TEXT,
    show: hover.hovered,
  });
}

/** The away tag, hung across the foot of the portrait. */
function awayTag(ui: Ui, portrait: Rect): void {
  const size = badgeSize(ui, { label: AWAY_TAG, kind: 'tag' });
  const tag: Rect = {
    x: portrait.x + (portrait.w - size.w) / 2,
    y: portrait.y + portrait.h - size.h / 2,
    w: size.w,
    h: size.h,
  };
  badge(ui, tag, { label: AWAY_TAG, kind: 'tag', tone: 'neutral', variant: 'solid' });
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

type FittedPill =
  | { readonly kind: 'pill'; readonly pill: StatusPillModel; readonly w: number }
  | { readonly kind: 'count'; readonly count: number; readonly w: number };

interface FittedPills {
  readonly items: readonly FittedPill[];
  /** From the first pill's left edge to the last one's right. */
  readonly width: number;
}

/**
 * The pills that fit in `maxW`, each measured before it is placed; when some
 * don't fit, the last place goes to a `+N` pill counting the rest.
 */
function fitStatusPills(
  ui: Ui,
  h: number,
  maxW: number,
  pills: readonly StatusPillModel[],
): FittedPills {
  const gap = ui.theme.space.xs;
  const items: FittedPill[] = [];
  let x = 0;
  for (const [index, pill] of pills.entries()) {
    const w = statusPillWidth(ui, h, pill.label);
    const left = pills.length - index - 1;
    const overflowW = left > 0 ? gap + countPillWidth(ui, h, left) : 0;
    if (x + w + overflowW > maxW) {
      const count = pills.length - index;
      const countW = countPillWidth(ui, h, count);
      items.push({ kind: 'count', count, w: countW });
      return { items, width: x + countW };
    }
    items.push({ kind: 'pill', pill, w });
    x += w + gap;
  }
  return { items, width: Math.max(0, x - gap) };
}

/** Draws fitted pills left to right from `x` along `row`. */
function drawStatusPills(ui: Ui, row: Rect, x: number, fitted: FittedPills): void {
  const gap = ui.theme.space.xs;
  let cursor = x;
  for (const item of fitted.items) {
    const r: Rect = { x: cursor, y: row.y, w: item.w, h: row.h };
    if (item.kind === 'pill') statusPill(ui, r, item.pill);
    else countPill(ui, r, item.count);
    cursor += item.w + gap;
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
