/**
 * The level's collapse timer — a card in the top band on a roomy screen, a
 * chip beside the coin pill on a compact one — and the audible cues it owes
 * as it crosses each warning tier.
 *
 * Urgency grows through colour, weight and pulse rather than size: amber at
 * ten minutes, red and throbbing at five, and in the final minute a pulsing
 * red readout (on the card, large digits that are the only thing it says). A
 * paused clock reads blue.
 */

import { centerIn, type Rect } from '../core/geom';
import type { Ui } from '../core/UiRoot';
import { drawGlyph } from '../theme/glyphs';
import { skinsFor } from '../theme/skins';
import { drawGlass } from '../widgets/paint';
import {
  bandToneColor,
  stackedBandEntry,
  TOP_BAND_WIDTH,
  type BandRow,
  type BandTone,
} from './topBandStack';
import { measureText, tabularNumber } from '../widgets/text';
import type { LevelTimerModel } from './hudModel';
import type { TopBandEntry } from './topBand';

const SECONDS_PER_MINUTE = 60;
const FRAMES_PER_SECOND = 60;
const TEN_MINUTES = 10;
const FIVE_MINUTES = 5;
const ONE_MINUTE = 1;
/** ≤10 min: the card turns amber. */
const TEN_MINUTE_WARNING_SECONDS = TEN_MINUTES * SECONDS_PER_MINUTE;
/** ≤5 min: red, and the digits throb. */
const FIVE_MINUTE_WARNING_SECONDS = FIVE_MINUTES * SECONDS_PER_MINUTE;
/** ≤1 min: the label goes and the digits take the whole card, pulsing once a second. */
const ONE_MINUTE_CRITICAL_SECONDS = ONE_MINUTE * SECONDS_PER_MINUTE;

/** The five-minute throb's resting opacity and swing, and its period in ms. */
const URGENT_OPACITY = 0.85;
const URGENT_WAVE_AMP = 0.12;
const URGENT_WAVE_PERIOD = 160;
/** How far the final minute's digits swell above their base size, once per second. */
const CRITICAL_PULSE_AMPLITUDE = 0.18;
/** The chip's final-minute pulse: its faintest opacity, reached between beats. */
const CRITICAL_CHIP_MIN_OPACITY = 0.55;

const TIME_REMAINING_LABEL = 'TIME REMAINING';
/**
 * A held clock reads cool and still: the label says why, and blue takes over
 * from the warning reds so a paused final minute does not look like a live one.
 */
const TIMER_PAUSED_LABEL = 'TIMER PAUSED';

export type LevelTimerCue = 'ten_minute_warning' | 'five_minute_warning' | 'final_minute_heartbeat';

const secondsShown = (timerFrames: number): number =>
  Math.max(0, Math.ceil(timerFrames / FRAMES_PER_SECOND));

/**
 * The audible cue owed for one frame of countdown, judged on the whole seconds
 * the readout shows so the sound lands on the same beat as the display. Null
 * when nothing was crossed; a timer rewound by a checkpoint restore never
 * passes through here, so it cannot re-announce a tier.
 */
export function levelTimerCue(framesBefore: number, framesAfter: number): LevelTimerCue | null {
  const before = secondsShown(framesBefore);
  const after = secondsShown(framesAfter);
  if (before === after) return null;
  if (after <= ONE_MINUTE_CRITICAL_SECONDS) return 'final_minute_heartbeat';
  if (before > FIVE_MINUTE_WARNING_SECONDS && after <= FIVE_MINUTE_WARNING_SECONDS) {
    return 'five_minute_warning';
  }
  if (before > TEN_MINUTE_WARNING_SECONDS && after <= TEN_MINUTE_WARNING_SECONDS) {
    return 'ten_minute_warning';
  }
  return null;
}

function clockText(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / SECONDS_PER_MINUTE);
  const seconds = totalSeconds % SECONDS_PER_MINUTE;
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** The final minute's readout: display-sized digits that swell on every second. */
function criticalClockRow(clock: string, timerFrames: number, paused: boolean): BandRow {
  const secondPhase = (timerFrames % FRAMES_PER_SECOND) / FRAMES_PER_SECOND;
  const pulse = paused ? 1 : 1 + CRITICAL_PULSE_AMPLITUDE * Math.sin(secondPhase * Math.PI);
  return {
    kind: 'custom',
    height: (ui: Ui) =>
      Math.ceil(ui.theme.type.display.lineHeight * (1 + CRITICAL_PULSE_AMPLITUDE)),
    render: (ui, rect) => {
      const display = ui.theme.type.display;
      const { palette } = ui.theme;
      tabularNumber(ui, rect, {
        value: clock,
        style: { ...display, size: Math.round(display.size * pulse) },
        color: paused ? palette.state.info : palette.state.danger,
        align: 'center',
      });
    },
  };
}

function runningTone(totalSeconds: number): BandTone | null {
  if (totalSeconds <= FIVE_MINUTE_WARNING_SECONDS) return 'danger';
  if (totalSeconds <= TEN_MINUTE_WARNING_SECONDS) return 'warning';
  return null;
}

const urgentThrob = (now: number): number =>
  URGENT_OPACITY + Math.sin(now / URGENT_WAVE_PERIOD) * URGENT_WAVE_AMP;

/** The chip's opacity this frame: a beat each second in the final minute, a throb under five. */
function chipOpacity(ui: Ui, model: LevelTimerModel, totalSeconds: number): number {
  if (model.paused) return 1;
  if (totalSeconds <= ONE_MINUTE_CRITICAL_SECONDS) {
    const secondPhase = (model.frames % FRAMES_PER_SECOND) / FRAMES_PER_SECOND;
    const beat = Math.sin(secondPhase * Math.PI);
    return CRITICAL_CHIP_MIN_OPACITY + (1 - CRITICAL_CHIP_MIN_OPACITY) * beat;
  }
  return totalSeconds <= FIVE_MINUTE_WARNING_SECONDS ? urgentThrob(ui.now) : 1;
}

/**
 * The collapse timer as one pill-shaped line — a clock glyph and the time —
 * drawn from `slot`'s top-left corner and sized to its reading. Returns the
 * drawn chip.
 */
export function levelTimerChip(ui: Ui, slot: Rect, model: LevelTimerModel): Rect {
  const { ctx, theme } = ui;
  const { space, palette } = theme;
  const totalSeconds = secondsShown(model.frames);
  const clock = clockText(totalSeconds);
  const tone: BandTone | null = model.paused ? 'info' : runningTone(totalSeconds);
  const color = tone === null ? palette.text.primary : bandToneColor(theme, tone);
  const icon = theme.size.icon;
  const clockW = measureText(ui, clock, { role: 'label', tabular: true });
  const chip: Rect = {
    x: slot.x,
    y: slot.y,
    w: Math.ceil(space.sm + icon + space.xs + clockW + space.md),
    h: slot.h,
  };
  const skin = skinsFor(theme).panel.hud;
  drawGlass(ui, chip, tone === null ? skin : { ...skin, border: color }, theme.radius.pill);
  ctx.save();
  ctx.globalAlpha *= chipOpacity(ui, model, totalSeconds);
  drawGlyph(
    ctx,
    'clock',
    centerIn({ x: chip.x + space.sm, y: chip.y, w: icon, h: chip.h }, icon, icon),
    { color: tone === null ? palette.text.muted : color },
  );
  tabularNumber(
    ui,
    { x: chip.x + space.sm + icon + space.xs, y: chip.y, w: clockW + space.xs, h: chip.h },
    { value: clock, role: 'label', color },
  );
  ctx.restore();
  return chip;
}

/** The collapse timer's card for `timerFrames` left on the clock. */
export function levelTimerEntry(timerFrames: number, paused: boolean): TopBandEntry {
  const totalSeconds = secondsShown(timerFrames);
  const clock = clockText(totalSeconds);
  const base = {
    id: 'level-timer',
    priority: 'countdown',
    maxWidth: TOP_BAND_WIDTH.narrow,
  } as const;

  if (totalSeconds <= ONE_MINUTE_CRITICAL_SECONDS) {
    const rows: BandRow[] = [criticalClockRow(clock, timerFrames, paused)];
    if (paused) {
      rows.push({ kind: 'text', text: TIMER_PAUSED_LABEL, role: 'overline', tone: 'info' });
    }
    return stackedBandEntry({ ...base, accentTone: paused ? 'info' : 'danger', rows });
  }

  if (paused) {
    return stackedBandEntry({
      ...base,
      accentTone: 'info',
      rows: [
        { kind: 'text', text: TIMER_PAUSED_LABEL, role: 'overline', tone: 'info' },
        { kind: 'text', text: clock, role: 'heading', tone: 'info', tabular: true },
      ],
    });
  }

  const tone = runningTone(totalSeconds);
  const throbbing = totalSeconds <= FIVE_MINUTE_WARNING_SECONDS;
  const throb = throbbing ? urgentThrob : undefined;
  return stackedBandEntry({
    ...base,
    accentTone: tone ?? undefined,
    rows: [
      { kind: 'text', text: TIME_REMAINING_LABEL, role: 'overline', tone: tone ?? 'muted' },
      {
        kind: 'text',
        text: clock,
        role: tone === null ? 'title' : 'heading',
        tone: tone ?? 'neutral',
        tabular: true,
        alpha: throb,
      },
    ],
  });
}
