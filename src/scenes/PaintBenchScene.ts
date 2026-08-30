/**
 * Localhost-only harness that times each painted figure in the browser.
 *
 * Reached via `?paintbench` in `devBootScene`; never on a production path.
 *
 * It exists because the two numbers the figure cache is tuned against — how
 * much of a frame one bake may take, and which figures are cheap enough to fall
 * back to painting straight into the frame — are properties of Chrome's
 * rasteriser, and the offline bench measures node-canvas's. Each subject is
 * painted repeatedly at its own declared cell size, unsupersampled (the
 * fallback's cost) and supersampled (the bake's), and the two are printed to
 * the console as well as drawn, so a run can be read out of browser automation.
 */

import { Scene } from '../core/Scene';
import { viewportHeight, viewportWidth } from '../core/Viewport';
import { PAINT_BENCH_SUBJECTS, type PaintBenchSubject } from '../dev/paintBenchSubjects';
import { allocCanvas, surfaceContext } from '../core/canvasSurface';
import { drawText, TEXT_PRESETS } from '../ui/TextBox';

const BACKGROUND_COLOR = '#12161f';
const MARGIN = 32;
const TITLE_SIZE = 18;
const ROW_SIZE = 12;
const ROW_HEIGHT = 18;
const HEADING_GAP = 26;

/** Untimed passes that let the JIT settle before anything is recorded. */
const WARMUP_PAINTS = 5;
const TIMED_PAINTS = 30;

/** Density a cached cell is baked at, matching the figure cache. */
const SUPERSAMPLE = 2;

const MS_DECIMALS = 3;

/**
 * Desktop paint cost above which a figure is too expensive to fall back on:
 * chosen to survive a three-to-five-fold phone derate inside one frame's slack.
 * Figures over the line need prewarm coverage for every state their AI enters.
 */
const FALLBACK_AFFORDABLE_MS = 1;

/**
 * Where the finished table is published for browser automation to read.
 *
 * The route exists to be driven from outside — the fallback threshold is a
 * Chrome number, and a harness that can only be read by a human looking at a
 * canvas cannot supply one. Console output alone is not enough: a page-load log
 * has usually already scrolled past by the time anything attaches.
 */
declare global {
  var __paintBenchResults: readonly Measurement[] | undefined;
  var __paintBenchDone: boolean | undefined;
}

interface Measurement {
  readonly name: string;
  readonly cellPixels: string;
  readonly directMs: number;
  readonly bakeMs: number;
}

/** Which of the two regimes a measured figure falls into. */
function fallbackVerdict(directMs: number): string {
  return directMs <= FALLBACK_AFFORDABLE_MS ? 'fallback-affordable' : 'prewarm-required';
}

function timePaints(subject: PaintBenchSubject, density: number): number {
  const { def } = subject;
  const width = Math.ceil(def.frameWidth * density);
  const height = Math.ceil(def.frameHeight * density);
  const surface = allocCanvas(width, height);
  const ctx = surfaceContext(surface);
  const frames = def.states.get(subject.state)?.frames ?? 1;

  const paint = (index: number): void => {
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, width, height);
    ctx.save();
    ctx.scale(density, density);
    def.paintFrame(ctx, subject.state, index % frames);
    ctx.restore();
  };

  for (let i = 0; i < WARMUP_PAINTS; i++) paint(i);
  const startedAt = performance.now();
  for (let i = 0; i < TIMED_PAINTS; i++) paint(i);
  return (performance.now() - startedAt) / TIMED_PAINTS;
}

/** Gap between subjects, long enough that the tab stays answerable. */
const SUBJECT_INTERVAL_MS = 0;

export class PaintBenchScene extends Scene {
  private measurements: Measurement[] = [];
  private nextSubject = 0;

  /**
   * Measurement runs off a timer rather than off `update`.
   *
   * A backgrounded tab stops servicing `requestAnimationFrame` entirely, and
   * this route's whole purpose is to be read by browser automation, which
   * cannot guarantee the tab is in front. Driven by the game loop it produced
   * no numbers at all in exactly the case it was built for.
   */
  onEnter(): void {
    this.measureNext();
  }

  update(): void {
    // The timer owns the work; a visible tab would otherwise measure twice.
  }

  private measureNext(): void {
    if (this.nextSubject >= PAINT_BENCH_SUBJECTS.length) return;
    const subject = PAINT_BENCH_SUBJECTS[this.nextSubject];
    this.nextSubject++;
    const directMs = timePaints(subject, 1);
    const bakeMs = timePaints(subject, SUPERSAMPLE);
    const measurement: Measurement = {
      name: `${subject.def.id} (${subject.state})`,
      cellPixels: `${subject.def.frameWidth}×${subject.def.frameHeight}`,
      directMs,
      bakeMs,
    };
    this.measurements.push(measurement);
    console.log(
      `[paintbench] ${measurement.name} ${measurement.cellPixels} ` +
        `direct ${directMs.toFixed(MS_DECIMALS)} ms  bake ${bakeMs.toFixed(MS_DECIMALS)} ms  ` +
        fallbackVerdict(directMs),
    );
    globalThis.__paintBenchResults = [...this.measurements];
    if (this.nextSubject === PAINT_BENCH_SUBJECTS.length) {
      globalThis.__paintBenchDone = true;
      console.log(`[paintbench] done — ${this.measurements.length} figures measured`);
      return;
    }
    setTimeout(() => {
      this.measureNext();
    }, SUBJECT_INTERVAL_MS);
  }

  render(ctx: CanvasRenderingContext2D): void {
    ctx.fillStyle = BACKGROUND_COLOR;
    ctx.fillRect(0, 0, viewportWidth(), viewportHeight());

    drawText(ctx, 'paint bench — ms per painted frame, Chrome', {
      x: MARGIN,
      y: MARGIN,
      size: TITLE_SIZE,
      bold: true,
      color: TEXT_PRESETS.heading.color,
    });

    if (PAINT_BENCH_SUBJECTS.length === 0) {
      drawText(ctx, 'No painted figures are registered yet.', {
        x: MARGIN,
        y: MARGIN + HEADING_GAP,
        size: ROW_SIZE,
        color: TEXT_PRESETS.hint.color,
      });
      return;
    }

    this.measurements.forEach((measurement, index) => {
      const y = MARGIN + HEADING_GAP + index * ROW_HEIGHT;
      const affordable = measurement.directMs <= FALLBACK_AFFORDABLE_MS;
      drawText(
        ctx,
        `${measurement.name}  ${measurement.cellPixels}  ` +
          `direct ${measurement.directMs.toFixed(MS_DECIMALS)} ms  ` +
          `bake ${measurement.bakeMs.toFixed(MS_DECIMALS)} ms  ` +
          fallbackVerdict(measurement.directMs),
        {
          x: MARGIN,
          y,
          size: ROW_SIZE,
          font: 'monospace',
          color: affordable ? TEXT_PRESETS.value.color : TEXT_PRESETS.danger.color,
        },
      );
    });
  }
}
