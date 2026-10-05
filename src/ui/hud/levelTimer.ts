/**
 * The level's collapse timer, as a top-band entry, and the audible cues it
 * owes as it crosses each warning tier.
 *
 * Urgency grows through colour, weight and pulse rather than size: amber at
 * ten minutes, red and throbbing at five, and in the final minute a large
 * pulsing readout that is the only thing the card says.
 */

import type { Ui } from '../core/UiRoot';
import { stackedBandEntry, TOP_BAND_WIDTH, type BandRow, type BandTone } from './topBandStack';
import { tabularNumber } from '../widgets/text';
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
  const throb = throbbing
    ? (now: number): number => URGENT_OPACITY + Math.sin(now / URGENT_WAVE_PERIOD) * URGENT_WAVE_AMP
    : undefined;
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
