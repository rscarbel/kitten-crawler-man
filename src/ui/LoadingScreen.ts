/**
 * The game's loading screen: a full-screen card with a title, a progress bar, a
 * line saying what is being done, and a rotating tip.
 *
 * Three layers, each usable on its own:
 *
 * - {@link drawLoadingScreen} draws one frame of it from a plain view record.
 *   No state, no clock of its own — what the boot screen and the preview
 *   renderer use.
 * - {@link LoadingOverlay} is the host a scene holds while it loads: it owns a
 *   {@link LoadRunner}, ticks it once per rendered frame, draws the screen,
 *   fades it out once the work is done, and hands the scene an overlay claim so
 *   the keyboard and the world stay still underneath it.
 * - {@link showLoadingScreen} is the boot-time variant, which runs its own
 *   animation loop because there is no scene yet to host it.
 */
import {
  drawBox,
  drawDivider,
  drawOverlay,
  drawProgressBar,
  BOX_PRESETS,
  PROGRESS_PRESETS,
} from './Box';
import { drawText, measureTextBox } from './TextBox';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { LoadRunner, type LoadRunnerOptions, type LoadTask } from '../core/LoadRunner';
import type { OverlayInputClaim } from '../systems/kits/OverlayClaims';

const BACKGROUND_COLOR = '#05070f';
const GOLD = '#facc15';
const TITLE_COLOR = '#f8fafc';
const STATUS_COLOR = '#cbd5e1';
const TIP_COLOR = '#94a3b8';
const TIP_LABEL_COLOR = '#fde68a';
const DIVIDER_COLOR = 'rgba(250,204,21,0.35)';
const TITLE_GLOW = 'rgba(250,204,21,0.45)';
const TITLE_OUTLINE = '#020617';
const MOTE_COLOR = 'rgba(250,204,21,0.5)';

/** Widest the card grows, on a desktop. */
const CARD_MAX_WIDTH = 480;
/** Space kept between the card and the screen edge on a phone. */
const SCREEN_GUTTER = 16;
/** Below this card width the type steps down a size, so a title fits a phone. */
const COMPACT_CARD_WIDTH = 380;
const CARD_PADDING = 28;
const COMPACT_CARD_PADDING = 18;
/**
 * Narrowest the card is ever laid out, however small the canvas: below the
 * padding on both sides the inner width would go negative, and every size
 * derived from it with it.
 */
const MIN_CARD_WIDTH = COMPACT_CARD_PADDING * 2 + 1;

const KICKER_SIZE = 12;
const TITLE_SIZE = 30;
const COMPACT_TITLE_SIZE = 22;
const STATUS_SIZE = 12;
const STATUS_LINE_HEIGHT = 17;
/** Room kept at the right of the status line for "100%". */
const PERCENT_LABEL_RESERVE_PX = 44;
const TIP_SIZE = 12;
const TIP_LINE_HEIGHT = 17;
const TITLE_GLOW_BLUR = 18;
const TITLE_OUTLINE_WIDTH = 4;

const KICKER_TO_TITLE_GAP = 8;
const TITLE_TO_DIVIDER_GAP = 16;
const DIVIDER_TO_BAR_GAP = 20;
const BAR_HEIGHT = 16;
const BAR_TO_STATUS_GAP = 10;
const STATUS_TO_TIP_GAP = 22;
const TIP_LABEL_TO_TEXT_GAP = 6;
/** Share of the card's inner width the divider under the title spans. */
const DIVIDER_WIDTH_FRACTION = 0.5;
/** Nudges the card above centre, where a reader's eye rests on a blank screen. */
const CARD_LIFT_FRACTION = 0.04;

/** Milliseconds the bar's travelling highlight takes to cross once. */
const SHIMMER_PERIOD_MS = 1600;
/** Milliseconds per step of the "…" after the status line. */
const ELLIPSIS_STEP_MS = 400;
const ELLIPSIS_STEPS = 4;
const PERCENT = 100;

/** Drifting specks behind the card: enough to show the screen is alive, too few to busy it. */
const MOTE_COUNT = 18;
/** Milliseconds a mote takes to rise the full height of the screen. */
const MOTE_RISE_MS = 14000;
const MOTE_MIN_SIZE = 1.5;
const MOTE_SIZE_RANGE = 2;
const MOTE_MAX_ALPHA = 0.55;
/** Horizontal sway of a mote as it rises, in px. */
const MOTE_SWAY_PX = 10;
/** Constants of a cheap, fixed hash, so the motes sit in the same places every run. */
const MOTE_HASH_X = 0.6180339887;
const MOTE_HASH_PHASE = 0.3819660113;
const MOTE_HASH_SIZE = 0.7548776662;
const FULL_TURN = Math.PI * 2;

/** One frame's worth of what the loading screen shows. */
export interface LoadingScreenView {
  /** The big line — a floor's name, say. */
  readonly title: string;
  /** A small line above the title ("Floor 3"). Omit for none. */
  readonly kicker?: string;
  /** How far along the load is, `0`–`1`. */
  readonly progress: number;
  /** What is being done right now ("Painting the streets"). */
  readonly status: string;
  /** A hint for the player while they wait. Omit for none. */
  readonly tip?: string;
  /** Animation clock in milliseconds; only differences matter. */
  readonly timeMs: number;
  /** Opacity of the whole screen, for fading out over the world. Default 1. */
  readonly alpha?: number;
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function fractionalPart(value: number): number {
  return value - Math.floor(value);
}

function drawMotes(
  ctx: CanvasRenderingContext2D,
  cw: number,
  ch: number,
  timeMs: number,
  alpha: number,
): void {
  for (let index = 0; index < MOTE_COUNT; index++) {
    const seedX = fractionalPart((index + 1) * MOTE_HASH_X);
    const seedPhase = fractionalPart((index + 1) * MOTE_HASH_PHASE);
    const seedSize = fractionalPart((index + 1) * MOTE_HASH_SIZE);
    const rise = fractionalPart(timeMs / MOTE_RISE_MS + seedPhase);
    const size = MOTE_MIN_SIZE + seedSize * MOTE_SIZE_RANGE;
    const sway = Math.sin((rise + seedX) * FULL_TURN) * MOTE_SWAY_PX;
    // Brightest mid-screen, fading at both ends, so no mote pops in or out.
    const fadeInOut = Math.sin(rise * Math.PI);
    drawBox(ctx, {
      x: seedX * cw + sway,
      y: ch - rise * ch,
      width: size,
      height: size,
      radius: size / 2,
      fill: MOTE_COLOR,
      alpha: alpha * fadeInOut * MOTE_MAX_ALPHA,
    });
  }
}

/**
 * Draws one frame of the loading screen over the whole canvas.
 *
 * Laid out from the canvas size alone, so it holds together from a phone held
 * upright to a wide desktop: the card is at most {@link CARD_MAX_WIDTH} wide,
 * keeps a {@link SCREEN_GUTTER} margin on a narrow screen, and steps its type
 * down a size below {@link COMPACT_CARD_WIDTH}.
 */
export function drawLoadingScreen(
  ctx: CanvasRenderingContext2D,
  view: LoadingScreenView,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const alpha = finiteOr(view.alpha ?? 1, 0);
  if (alpha <= 0) return;
  const cw = Math.max(0, finiteOr(canvasWidth, 0));
  const ch = Math.max(0, finiteOr(canvasHeight, 0));
  // A rAF timestamp is the frame's start, which can predate the
  // `performance.now()` a caller took its start time from, so the first frame
  // of a load can arrive with a slightly negative clock.
  const timeMs = Math.max(0, finiteOr(view.timeMs, 0));

  drawOverlay(ctx, { canvasWidth: cw, canvasHeight: ch, color: BACKGROUND_COLOR, alpha });
  drawMotes(ctx, cw, ch, timeMs, alpha);

  const cardWidth = Math.max(MIN_CARD_WIDTH, Math.min(CARD_MAX_WIDTH, cw - SCREEN_GUTTER * 2));
  const compact = cardWidth < COMPACT_CARD_WIDTH;
  const padding = compact ? COMPACT_CARD_PADDING : CARD_PADDING;
  const innerWidth = cardWidth - padding * 2;
  const titleSize = compact ? COMPACT_TITLE_SIZE : TITLE_SIZE;

  const kickerHeight =
    view.kicker === undefined
      ? 0
      : measureTextBox(ctx, view.kicker, { size: KICKER_SIZE, bold: true, width: innerWidth })
          .totalHeight + KICKER_TO_TITLE_GAP;
  const titleHeight = measureTextBox(ctx, view.title, {
    size: titleSize,
    bold: true,
    width: innerWidth,
  }).totalHeight;
  const statusHeight = STATUS_LINE_HEIGHT;
  const tipLabelHeight = measureTextBox(ctx, 'TIP', { size: KICKER_SIZE, bold: true }).totalHeight;
  const tipHeight =
    view.tip === undefined
      ? 0
      : STATUS_TO_TIP_GAP +
        tipLabelHeight +
        TIP_LABEL_TO_TEXT_GAP +
        measureTextBox(ctx, view.tip, {
          size: TIP_SIZE,
          italic: true,
          width: innerWidth,
          lineHeight: TIP_LINE_HEIGHT,
        }).totalHeight;

  const contentHeight =
    kickerHeight +
    titleHeight +
    TITLE_TO_DIVIDER_GAP +
    DIVIDER_TO_BAR_GAP +
    BAR_HEIGHT +
    BAR_TO_STATUS_GAP +
    statusHeight +
    tipHeight;
  const cardHeight = contentHeight + padding * 2;
  const cardTop = Math.max(
    SCREEN_GUTTER,
    Math.round((ch - cardHeight) / 2 - ch * CARD_LIFT_FRACTION),
  );

  const card = drawBox(ctx, {
    x: Math.round(cw / 2),
    y: cardTop,
    width: cardWidth,
    height: cardHeight,
    alignX: 'center',
    padding,
    alpha,
    ...BOX_PRESETS.loading,
  });
  const inner = card.inner;
  const centreX = inner.x + inner.width / 2;
  let cursorY = inner.y;

  if (view.kicker !== undefined) {
    drawText(ctx, view.kicker.toUpperCase(), {
      x: inner.x,
      y: cursorY,
      width: inner.width,
      align: 'center',
      size: KICKER_SIZE,
      bold: true,
      color: GOLD,
      alpha,
    });
    cursorY += kickerHeight;
  }

  drawText(ctx, view.title, {
    x: inner.x,
    y: cursorY,
    width: inner.width,
    align: 'center',
    size: titleSize,
    bold: true,
    color: TITLE_COLOR,
    outline: TITLE_OUTLINE,
    outlineWidth: TITLE_OUTLINE_WIDTH,
    glow: TITLE_GLOW,
    glowBlur: TITLE_GLOW_BLUR,
    alpha,
  });
  cursorY += titleHeight + TITLE_TO_DIVIDER_GAP;

  const dividerLength = inner.width * DIVIDER_WIDTH_FRACTION;
  drawDivider(ctx, {
    x: centreX - dividerLength / 2,
    y: cursorY,
    length: dividerLength,
    color: DIVIDER_COLOR,
    alpha,
  });
  cursorY += DIVIDER_TO_BAR_GAP;

  const progress = Math.max(0, Math.min(1, finiteOr(view.progress, 0)));
  drawProgressBar(ctx, {
    x: inner.x,
    y: cursorY,
    width: inner.width,
    height: BAR_HEIGHT,
    value: progress,
    alpha,
    shimmerPhase: timeMs / SHIMMER_PERIOD_MS,
    ...PROGRESS_PRESETS.loading,
  });
  cursorY += BAR_HEIGHT + BAR_TO_STATUS_GAP;

  // A finished load has nothing still going on to animate.
  const stillWorking = progress < 1;
  const ellipsis = stillWorking
    ? '.'.repeat(Math.floor(timeMs / ELLIPSIS_STEP_MS) % ELLIPSIS_STEPS)
    : '';
  const percentLabel = `${Math.floor(progress * PERCENT)}%`;
  // Held to one line, clipped rather than wrapped: a status that wrapped would
  // push the tip down and make the card jump between tasks.
  drawText(ctx, `${view.status}${ellipsis}`, {
    x: inner.x,
    y: cursorY,
    width: Math.max(0, inner.width - PERCENT_LABEL_RESERVE_PX),
    size: STATUS_SIZE,
    color: STATUS_COLOR,
    lineHeight: statusHeight,
    height: statusHeight,
    alpha,
  });
  drawText(ctx, percentLabel, {
    x: inner.x + inner.width,
    y: cursorY,
    align: 'right',
    size: STATUS_SIZE,
    bold: true,
    color: GOLD,
    alpha,
  });
  cursorY += statusHeight;

  if (view.tip !== undefined) {
    cursorY += STATUS_TO_TIP_GAP;
    drawText(ctx, 'TIP', {
      x: inner.x,
      y: cursorY,
      width: inner.width,
      align: 'center',
      size: KICKER_SIZE,
      bold: true,
      color: TIP_LABEL_COLOR,
      alpha,
    });
    cursorY += tipLabelHeight + TIP_LABEL_TO_TEXT_GAP;
    drawText(ctx, view.tip, {
      x: inner.x,
      y: cursorY,
      width: inner.width,
      align: 'center',
      size: TIP_SIZE,
      italic: true,
      color: TIP_COLOR,
      lineHeight: TIP_LINE_HEIGHT,
      alpha,
    });
  }
}

/** Milliseconds the screen takes to fade out over the world once the work is done. */
const FADE_OUT_MS = 350;
/** Milliseconds each tip stays up before the next. */
const TIP_ROTATION_MS = 5000;

export interface LoadingOverlayOptions {
  readonly title: string;
  readonly kicker?: string;
  /** Hints shown one at a time while the player waits. */
  readonly tips?: ReadonlyArray<string>;
  readonly tasks: ReadonlyArray<LoadTask>;
  readonly runner?: LoadRunnerOptions;
  /** The clock the fade and the animation run on, `performance.now()` by default. */
  readonly now?: () => number;
}

/**
 * The loading screen as a scene holds it.
 *
 * A scene constructs one when it has up-front work worth covering, and while
 * {@link isOpen} it renders only this — calling {@link renderFrame} once per
 * rendered frame, which is what ticks the work — and skips its own `update`.
 * Once the work is done the overlay stays {@link isVisible} a moment longer,
 * fading out over the world the scene is now drawing beneath it.
 */
export class LoadingOverlay {
  readonly runner: LoadRunner;
  private readonly title: string;
  private readonly kicker: string | undefined;
  private readonly tips: ReadonlyArray<string>;
  private readonly now: () => number;
  private readonly openedAtMs: number;
  private closedAtMs: number | null = null;
  /** Picked once, so two loads in a session do not always open on the same tip. */
  private readonly firstTip: number;

  constructor(options: LoadingOverlayOptions) {
    this.title = options.title;
    this.kicker = options.kicker;
    this.tips = options.tips ?? [];
    this.now = options.now ?? (() => performance.now());
    this.openedAtMs = this.now();
    this.firstTip = this.tips.length > 0 ? Math.floor(Math.random() * this.tips.length) : 0;
    this.runner = new LoadRunner(options.tasks, { now: this.now, ...options.runner });
  }

  /** True until the work is done: the world must neither update nor draw. */
  get isOpen(): boolean {
    return this.closedAtMs === null;
  }

  /** True while the screen still draws anything — open, or fading out. */
  get isVisible(): boolean {
    return this.closedAtMs === null || this.now() - this.closedAtMs < FADE_OUT_MS;
  }

  /**
   * Ticks the work (while open) and draws the screen. Call once per rendered
   * frame, after the world when fading and instead of it while open. Returns
   * {@link isOpen} as it stands after this frame's work.
   */
  renderFrame(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number): boolean {
    if (this.closedAtMs === null) {
      this.runner.tick();
      if (this.runner.isFinished) this.closedAtMs = this.now();
    }
    const timeMs = Math.max(0, this.now() - this.openedAtMs);
    const fadeAlpha =
      this.closedAtMs === null ? 1 : 1 - (this.now() - this.closedAtMs) / FADE_OUT_MS;
    const tipIndex =
      (this.firstTip + Math.floor(timeMs / TIP_ROTATION_MS)) % Math.max(1, this.tips.length);
    drawLoadingScreen(
      ctx,
      {
        title: this.title,
        kicker: this.kicker,
        progress: this.runner.progress,
        status: this.runner.tasksDone ? 'Ready' : this.runner.statusLabel,
        tip: this.tips[tipIndex],
        timeMs,
        alpha: Math.max(0, fadeAlpha),
      },
      canvasWidth,
      canvasHeight,
    );
    return this.isOpen;
  }

  /**
   * The overlay's claim on input while open: the keyboard locked, the world
   * halted, Space swallowed. Nothing on it can be focused.
   */
  overlayClaim(): OverlayInputClaim {
    return {
      isOpen: this.isOpen,
      space: { kind: 'swallow' },
      focusContext: null,
      locksKeyboard: true,
      haltsWorld: true,
    };
  }
}

export interface LoadingScreenHandle {
  /** Update the fraction shown, e.g. as `loadGroups`'s onProgress callback fires. */
  setProgress(loaded: number, total: number): void;
  /** Stop the render loop — call once the first real scene is about to take the canvas. */
  stop(): void;
}

const BOOT_TITLE = 'Kitten Crawler Man';
const BOOT_STATUS = 'Unpacking the dungeon';

/**
 * The boot-time loading screen shown while the `core` sprite group decodes.
 *
 * Runs its own `requestAnimationFrame` loop rather than going through a
 * `Scene`/`SceneManager` — there is no scene yet to hand the canvas to, and
 * a progress bar has no input handling or update-tick needs that would
 * justify the extra machinery.
 */
export function showLoadingScreen(ctx: CanvasRenderingContext2D): LoadingScreenHandle {
  let fraction = 0;
  let stopped = false;
  const startedAt = performance.now();

  function frame(now: number): void {
    if (stopped) return;
    drawLoadingScreen(
      ctx,
      { title: BOOT_TITLE, progress: fraction, status: BOOT_STATUS, timeMs: now - startedAt },
      viewportWidth(),
      viewportHeight(),
    );
    requestAnimationFrame(frame);
  }

  requestAnimationFrame(frame);

  return {
    setProgress(loaded: number, total: number): void {
      fraction = total > 0 ? loaded / total : 1;
    },
    stop(): void {
      stopped = true;
    },
  };
}
