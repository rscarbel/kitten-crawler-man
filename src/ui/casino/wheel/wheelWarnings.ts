/**
 * The two danger prompts in front of the Wheel of Fortune: the blaring
 * warning and "are you sure". Both fill the whole screen with a deep red field
 * under slow hazard stripes, and both answer No to everything that is not a
 * deliberate press of Yes: Enter or Space with nothing focused, Escape, and a
 * tap anywhere off the buttons.
 *
 * The buttons sit in two fixed slots pinned to the bottom of the screen, laid
 * out from the viewport alone so both prompts use the same two rects. The
 * warning puts Yes in the second slot and the confirm puts it in the first, so
 * a double tap on the warning's Yes always lands on the confirm's No.
 */

import { inset, type Rect } from '../../core/geom';
import type { Ui } from '../../core/UiRoot';
import { withAlpha } from '../../theme/color';
import { WHEEL_HEADLINE_MIN_SIZE, WHEEL_HEADLINE_TYPE, wheelInk } from '../../theme/wheelInk';
import type { TypeStyle } from '../../theme/tokens';
import { button, measureButton } from '../../widgets/button';
import { scrollView } from '../../widgets/scrollView';
import { measureText, measureTextHeight, text } from '../../widgets/text';
import { wheelControlHeight } from './wheelLayout';

export type WheelWarningKind = 'warning' | 'confirm';

export const WHEEL_WARNING_NO_LABEL = 'No, I do not want to risk everything';
export const WHEEL_WARNING_YES_LABEL = 'I understand. Continue.';
export const WHEEL_CONFIRM_YES_LABEL = 'Yes, risk everything';

export const WHEEL_WARNING_NO_ID = 'no';
export const WHEEL_WARNING_YES_ID = 'yes';
export const WHEEL_WARNING_SCRIM_ID = 'scrim';

const WARNING_HEADLINE = 'WARNING: THE NOTHING IS PERMANENT DEATH';
const WARNING_BODY: readonly string[] = [
  'One slot on this wheel sends you to the Nothing.',
  'If it lands, the game ends forever.',
  'Every save and all of your progress is erased.',
  'You start over as if you had never played.',
  'There is no undo and no reload.',
];
const CONFIRM_HEADLINE = 'ARE YOU SURE YOU WANT TO RISK EVERYTHING?';
const CONFIRM_BODY: readonly string[] = [
  'The Nothing takes every save, every level, every item and every achievement.',
  'It cannot be undone.',
];
const ARMING_REASON = 'Read the warning first';

export interface WheelWarningSpec {
  readonly kind: WheelWarningKind;
  /** Milliseconds since the prompt appeared, on the host's clock. */
  readonly elapsedMs: number;
  /** How long Yes stays disabled after the prompt appears. */
  readonly armingMs: number;
  readonly onNo: () => void;
  readonly onYes: () => void;
}

/** The two button slots, the same for both prompts on any one screen. */
export interface WarningSlots {
  readonly first: Rect;
  readonly second: Rect;
  /** Side by side, or stacked when the row would squeeze a label. */
  readonly stacked: boolean;
  /** The buttons' size: a short, narrow screen keeps them side by side by stepping down. */
  readonly size: 'lg' | 'md';
}

/** The widest a slot grows on a desktop, so the buttons stay buttons. */
const SLOT_MAX_WIDTH = 420;
/** The prompts' buttons stand a little taller than a menu's. */
const SLOT_HEIGHT_FACTOR = 1.2;
/** A slot needs room for its label plus this much padding on each side. */
const SLOT_LABEL_PAD = 24;
/** The tightest a side-by-side slot may hug its label before the pair stacks instead. */
const SLOT_LABEL_PAD_TIGHT = 6;

const ALL_LABELS = [WHEEL_WARNING_NO_LABEL, WHEEL_WARNING_YES_LABEL, WHEEL_CONFIRM_YES_LABEL];

/** Pinned to the bottom of the safe area; depends on nothing but the viewport. */
export function warningSlots(ui: Ui): WarningSlots {
  const { space } = ui.theme;
  const area = inset(ui.viewport, space.lg);
  const h = wheelControlHeight(ui.theme, ui.uiScale) * SLOT_HEIGHT_FACTOR;
  const gap = space.md;
  const widestAt = (size: 'lg' | 'md', pad: number): number =>
    Math.max(...ALL_LABELS.map((label) => measureButton(ui, { label, size }) + pad * 2));
  const rowSlotW = Math.min(SLOT_MAX_WIDTH, (area.w - gap) / 2);
  // Kept clear of the hazard band along the bottom edge.
  const bottom = Math.min(area.y + area.h, ui.screen.y + ui.screen.h - stripeBand(ui) - space.sm);
  const rowSize =
    rowSlotW >= widestAt('lg', SLOT_LABEL_PAD)
      ? 'lg'
      : rowSlotW >= widestAt('md', SLOT_LABEL_PAD_TIGHT)
        ? 'md'
        : null;
  if (rowSize !== null) {
    const rowW = rowSlotW * 2 + gap;
    const left = area.x + (area.w - rowW) / 2;
    return {
      first: { x: left, y: bottom - h, w: rowSlotW, h },
      second: { x: left + rowSlotW + gap, y: bottom - h, w: rowSlotW, h },
      stacked: false,
      size: rowSize,
    };
  }
  const w = Math.min(SLOT_MAX_WIDTH, area.w);
  const x = area.x + (area.w - w) / 2;
  return {
    first: { x, y: bottom - h * 2 - gap, w, h },
    second: { x, y: bottom - h, w, h },
    stacked: true,
    size: 'lg',
  };
}

/** The slow pulse of the field and the stripes, in milliseconds per beat. */
const PULSE_PERIOD_MS = 1600;
/** How far the stripes crawl sideways each second, as a share of one stripe. */
const STRIPE_CRAWL_PER_SECOND = 0.35;
const STRIPE_BAND_SHARE = 0.055;
const STRIPE_BAND_MIN = 10;
const STRIPE_BAND_MAX = 30;
/** One stripe's width as a multiple of the band's height. */
const STRIPE_WIDTH_FACTOR = 1.1;
const STRIPE_ALPHA_MIN = 0.55;
const STRIPE_ALPHA_SWING = 0.45;
const GLOW_ALPHA_MIN = 0.25;
const GLOW_ALPHA_SWING = 0.35;
const GLOW_RADIUS_SHARE = 0.75;
const MS_PER_SECOND = 1000;
const FULL_TURN = Math.PI * 2;
const HALF = 0.5;
/** Each pass of the headline fit drops the type by this much. */
const HEADLINE_STEP = 2;
/** The headline never takes more than this share of the room above the buttons. */
const HEADLINE_MAX_SHARE = 0.45;
const HEADLINE_LINE_HEIGHT_FACTOR = 1.08;

function stripeBand(ui: Ui): number {
  return Math.min(STRIPE_BAND_MAX, Math.max(STRIPE_BAND_MIN, ui.screen.h * STRIPE_BAND_SHARE));
}

/** Body copy steps up a size where the screen has room for it. */
function bodyRole(ui: Ui): 'body' | 'title' {
  return ui.size === 'compact' ? 'body' : 'title';
}

function pulse(elapsedMs: number): number {
  return (Math.sin((elapsedMs / PULSE_PERIOD_MS) * FULL_TURN) + 1) * HALF;
}

function paintField(ui: Ui, kind: WheelWarningKind, elapsedMs: number): void {
  const { ctx, screen } = ui;
  const ink = wheelInk.warning;
  const beat = pulse(elapsedMs);
  ctx.save();
  const field = ctx.createLinearGradient(screen.x, screen.y, screen.x, screen.y + screen.h);
  const top = kind === 'warning' ? ink.field : ink.confirmField;
  field.addColorStop(0, top);
  field.addColorStop(1, ink.fieldDeep);
  ctx.fillStyle = field;
  ctx.fillRect(screen.x, screen.y, screen.w, screen.h);

  const cx = screen.x + screen.w * HALF;
  const cy = screen.y + screen.h * HALF;
  const glowR = Math.max(screen.w, screen.h) * GLOW_RADIUS_SHARE;
  const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, glowR);
  const pulseInk = kind === 'warning' ? ink.pulse : ink.confirmPulse;
  glow.addColorStop(0, withAlpha(pulseInk, GLOW_ALPHA_MIN + GLOW_ALPHA_SWING * beat));
  glow.addColorStop(1, withAlpha(pulseInk, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(screen.x, screen.y, screen.w, screen.h);

  const band = stripeBand(ui);
  const stripeW = band * STRIPE_WIDTH_FACTOR;
  const crawl =
    ((elapsedMs / MS_PER_SECOND) * STRIPE_CRAWL_PER_SECOND * stripeW * 2) % (stripeW * 2);
  ctx.globalAlpha = STRIPE_ALPHA_MIN + STRIPE_ALPHA_SWING * beat;
  for (const y of [screen.y, screen.y + screen.h - band]) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(screen.x, y, screen.w, band);
    ctx.clip();
    ctx.fillStyle = ink.stripeGap;
    ctx.fillRect(screen.x, y, screen.w, band);
    ctx.fillStyle = ink.stripe;
    for (
      let x = screen.x - stripeW * 2 - band + crawl;
      x < screen.x + screen.w + band;
      x += stripeW * 2
    ) {
      ctx.beginPath();
      ctx.moveTo(x, y + band);
      ctx.lineTo(x + band, y);
      ctx.lineTo(x + band + stripeW, y);
      ctx.lineTo(x + stripeW, y + band);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }
  ctx.restore();
}

function headlineStyle(size: number): TypeStyle {
  return {
    ...WHEEL_HEADLINE_TYPE,
    size,
    lineHeight: Math.round(size * HEADLINE_LINE_HEIGHT_FACTOR),
  };
}

/** The largest headline that leaves room for the body, stepping down to the floor. */
function fitHeadline(ui: Ui, headline: string, body: readonly string[], room: Rect): TypeStyle {
  const gap = ui.theme.space.sm;
  const bodyH =
    body.reduce(
      (sum, line) => sum + measureTextHeight(ui, room.w, { text: line, role: bodyRole(ui) }),
      0,
    ) +
    gap * body.length;
  for (let size = WHEEL_HEADLINE_TYPE.size; size > WHEEL_HEADLINE_MIN_SIZE; size -= HEADLINE_STEP) {
    const style = headlineStyle(size);
    const headH = measureTextHeight(ui, room.w, { text: headline, style });
    // A word too wide for the line would be broken mid-word, so every word must fit whole.
    const widestWord = Math.max(
      ...headline.split(' ').map((word) => measureText(ui, word, { style })),
    );
    const fits = headH <= room.h * HEADLINE_MAX_SHARE && headH + bodyH + gap <= room.h;
    if (fits && widestWord <= room.w) return style;
  }
  return headlineStyle(WHEEL_HEADLINE_MIN_SIZE);
}

/** Paints one prompt and registers its regions. */
export function paintWheelWarning(ui: Ui, spec: WheelWarningSpec): void {
  const { space } = ui.theme;
  const ink = wheelInk.warning;
  ui.hit(WHEEL_WARNING_SCRIM_ID, ui.screen, {
    onTap: spec.onNo,
    focusable: false,
  });
  paintField(ui, spec.kind, spec.elapsedMs);

  const slots = warningSlots(ui);
  const top = slots.first.y;
  const bandRoom = stripeBand(ui);
  const content = inset(
    {
      x: ui.viewport.x,
      y: Math.max(ui.viewport.y, ui.screen.y + bandRoom),
      w: ui.viewport.w,
      h: Math.max(0, top - space.md - Math.max(ui.viewport.y, ui.screen.y + bandRoom)),
    },
    { l: space.xl, r: space.xl, t: space.md },
  );
  const headline = spec.kind === 'warning' ? WARNING_HEADLINE : CONFIRM_HEADLINE;
  const body = spec.kind === 'warning' ? WARNING_BODY : CONFIRM_BODY;
  const style = fitHeadline(ui, headline, body, content);
  const headH = measureTextHeight(ui, content.w, { text: headline, style });
  const bodyHeights = body.map((line) =>
    measureTextHeight(ui, content.w, { text: line, role: bodyRole(ui) }),
  );
  const total = headH + space.md + bodyHeights.reduce((sum, h) => sum + h + space.xs, 0);
  scrollView(ui, content, {
    id: 'warning-body',
    contentHeight: total,
    draw: (laid) => {
      let y = laid.y + Math.max(0, (content.h - total) * HALF);
      text(
        ui,
        { x: content.x, y, w: content.w, h: headH },
        {
          text: headline,
          style,
          color: ink.headline,
          halo: ink.headlineHalo,
          align: 'center',
          wrap: true,
        },
      );
      y += headH + space.md;
      body.forEach((line, index) => {
        const h = bodyHeights[index];
        text(
          ui,
          { x: content.x, y, w: content.w, h },
          {
            text: line,
            role: bodyRole(ui),
            color: index === body.length - 1 ? ink.bodyStrong : ink.body,
            align: 'center',
            wrap: true,
          },
        );
        y += h + space.xs;
      });
    },
  });

  const armed = spec.elapsedMs >= spec.armingMs;
  const yesSlot = spec.kind === 'warning' ? slots.second : slots.first;
  const noSlot = spec.kind === 'warning' ? slots.first : slots.second;
  const yesLabel = spec.kind === 'warning' ? WHEEL_WARNING_YES_LABEL : WHEEL_CONFIRM_YES_LABEL;
  // The safe answer is drawn first and is Enter's default, wherever it sits.
  button(ui, noSlot, {
    id: WHEEL_WARNING_NO_ID,
    label: WHEEL_WARNING_NO_LABEL,
    variant: 'primary',
    size: slots.size,
    primary: true,
    onTap: spec.onNo,
  });
  button(ui, yesSlot, {
    id: WHEEL_WARNING_YES_ID,
    label: yesLabel,
    variant: 'danger',
    size: slots.size,
    disabled: armed ? false : ARMING_REASON,
    onTap: spec.onYes,
  });
  if (!armed) paintArmingBar(ui, yesSlot, spec.elapsedMs / spec.armingMs);
}

const ARMING_BAR_HEIGHT = 3;

/** A thin bar under the disabled Yes that fills while it arms. */
function paintArmingBar(ui: Ui, slot: Rect, progress: number): void {
  const { ctx } = ui;
  const ink = wheelInk.warning;
  const clamped = Math.max(0, Math.min(1, progress));
  ctx.save();
  ctx.fillStyle = withAlpha(ink.stripeGap, HALF);
  ctx.fillRect(slot.x, slot.y + slot.h + ARMING_BAR_HEIGHT, slot.w, ARMING_BAR_HEIGHT);
  ctx.fillStyle = ink.stripe;
  ctx.fillRect(slot.x, slot.y + slot.h + ARMING_BAR_HEIGHT, slot.w * clamped, ARMING_BAR_HEIGHT);
  ctx.restore();
}
