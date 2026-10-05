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
 *   {@link LoadRunner} and a surface the scene mounts, which ticks the work
 *   once per rendered frame and draws the screen in place of the world while
 *   the keyboard and the world stay still underneath it. Once the work is done
 *   the scene draws its fade-out over the world.
 * - {@link showLoadingScreen} is the boot-time variant, which runs its own
 *   animation loop because there is no scene yet to host it.
 */
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { keybindings } from '../core/Keybindings';
import { LoadRunner, type LoadRunnerOptions, type LoadTask } from '../core/LoadRunner';
import { chromeTarget, drawBar, drawRule } from './screens/dialogs/canvasChrome';
import { withAlpha } from './theme/color';
import { skinsFor } from './theme/skins';
import { drawGlass, fillRounded, type PaintTarget } from './widgets/paint';
import type { Surface } from './core/UiRoot';
import { measureTextHeight, text } from './widgets/text';

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

/** Room kept at the right of the status line for "100%". */
const PERCENT_LABEL_RESERVE_PX = 44;

const BAR_HEIGHT = 10;
/** Share of the card's inner width the rule under the title spans. */
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
const MOTE_MAX_ALPHA = 0.5;
/** Horizontal sway of a mote as it rises, in px. */
const MOTE_SWAY_PX = 10;
/** Constants of a cheap, fixed hash, so the motes sit in the same places every run. */
const MOTE_HASH_X = 0.6180339887;
const MOTE_HASH_PHASE = 0.3819660113;
const MOTE_HASH_SIZE = 0.7548776662;
const FULL_TURN = Math.PI * 2;
/** Strength of the warm glow pooled behind the card. */
const BACKDROP_GLOW_ALPHA = 0.08;
/** Radius of that glow, as a fraction of the screen's longer side. */
const BACKDROP_GLOW_RADIUS = 0.6;
const TIP_LABEL = 'Tip';

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

function drawBackdrop(target: PaintTarget, cw: number, ch: number, timeMs: number): void {
  const { ctx, theme } = target;
  const { palette } = theme;
  ctx.fillStyle = palette.surface.sunken;
  ctx.fillRect(0, 0, cw, ch);
  const glowRadius = Math.max(1, Math.max(cw, ch) * BACKDROP_GLOW_RADIUS);
  const glow = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, glowRadius);
  glow.addColorStop(0, withAlpha(palette.accent.base, BACKDROP_GLOW_ALPHA));
  glow.addColorStop(1, withAlpha(palette.accent.base, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, cw, ch);

  for (let index = 0; index < MOTE_COUNT; index++) {
    const seedX = fractionalPart((index + 1) * MOTE_HASH_X);
    const seedPhase = fractionalPart((index + 1) * MOTE_HASH_PHASE);
    const seedSize = fractionalPart((index + 1) * MOTE_HASH_SIZE);
    const rise = fractionalPart(timeMs / MOTE_RISE_MS + seedPhase);
    const size = MOTE_MIN_SIZE + seedSize * MOTE_SIZE_RANGE;
    const sway = Math.sin((rise + seedX) * FULL_TURN) * MOTE_SWAY_PX;
    // Brightest mid-screen, fading at both ends, so no mote pops in or out.
    const fadeInOut = Math.sin(rise * Math.PI);
    fillRounded(
      ctx,
      { x: seedX * cw + sway, y: ch - rise * ch, w: size, h: size },
      size / 2,
      withAlpha(palette.accent.base, fadeInOut * MOTE_MAX_ALPHA),
    );
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
  paintLoadingScreen(chromeTarget(ctx), view, canvasWidth, canvasHeight);
}

function paintLoadingScreen(
  target: PaintTarget,
  view: LoadingScreenView,
  canvasWidth: number,
  canvasHeight: number,
): void {
  const { ctx } = target;
  const alpha = finiteOr(view.alpha ?? 1, 0);
  if (alpha <= 0) return;
  const cw = Math.max(0, finiteOr(canvasWidth, 0));
  const ch = Math.max(0, finiteOr(canvasHeight, 0));
  // A rAF timestamp is the frame's start, which can predate the
  // `performance.now()` a caller took its start time from, so the first frame
  // of a load can arrive with a slightly negative clock.
  const timeMs = Math.max(0, finiteOr(view.timeMs, 0));

  const { theme } = target;
  const { type, space, palette } = theme;

  ctx.save();
  ctx.globalAlpha *= Math.min(1, alpha);
  drawBackdrop(target, cw, ch, timeMs);

  const cardWidth = Math.max(MIN_CARD_WIDTH, Math.min(CARD_MAX_WIDTH, cw - SCREEN_GUTTER * 2));
  const compact = cardWidth < COMPACT_CARD_WIDTH;
  const padding = compact ? COMPACT_CARD_PADDING : CARD_PADDING;
  const innerWidth = cardWidth - padding * 2;
  const titleStyle = compact ? type.heading : type.display;

  const kickerHeight = view.kicker === undefined ? 0 : type.overline.lineHeight + space.sm;
  const titleHeight = measureTextHeight(target, innerWidth, {
    text: view.title,
    style: titleStyle,
  });
  const statusHeight = type.caption.lineHeight;
  const tipHeight =
    view.tip === undefined
      ? 0
      : space.xl +
        type.overline.lineHeight +
        space.xs +
        measureTextHeight(target, innerWidth, { text: view.tip, role: 'secondary' });

  const contentHeight =
    kickerHeight +
    titleHeight +
    space.lg +
    space.lg +
    BAR_HEIGHT +
    space.sm +
    statusHeight +
    tipHeight;
  const cardHeight = contentHeight + padding * 2;
  const cardTop = Math.max(
    SCREEN_GUTTER,
    Math.round((ch - cardHeight) / 2 - ch * CARD_LIFT_FRACTION),
  );
  const card = { x: Math.round(cw / 2 - cardWidth / 2), y: cardTop, w: cardWidth, h: cardHeight };
  drawGlass(target, card, skinsFor(theme).panel.card);

  const innerX = card.x + padding;
  const centreX = innerX + innerWidth / 2;
  let cursorY = card.y + padding;

  if (view.kicker !== undefined) {
    text(
      target,
      { x: innerX, y: cursorY, w: innerWidth, h: type.overline.lineHeight },
      { text: view.kicker, role: 'overline', color: palette.accent.base, align: 'center' },
    );
    cursorY += kickerHeight;
  }

  text(
    target,
    { x: innerX, y: cursorY, w: innerWidth, h: titleHeight },
    { text: view.title, style: titleStyle, wrap: true, align: 'center' },
  );
  cursorY += titleHeight + space.lg;

  const dividerLength = innerWidth * DIVIDER_WIDTH_FRACTION;
  drawRule(target, centreX - dividerLength / 2, cursorY, dividerLength, palette.accent.base);
  cursorY += space.lg;

  const progress = Math.max(0, Math.min(1, finiteOr(view.progress, 0)));
  drawBar(
    target,
    { x: innerX, y: cursorY, w: innerWidth, h: BAR_HEIGHT },
    { value: progress, fill: palette.accent.base, shimmerPhase: timeMs / SHIMMER_PERIOD_MS },
  );
  cursorY += BAR_HEIGHT + space.sm;

  // A finished load has nothing still going on to animate.
  const stillWorking = progress < 1;
  const ellipsis = stillWorking
    ? '.'.repeat(Math.floor(timeMs / ELLIPSIS_STEP_MS) % ELLIPSIS_STEPS)
    : '';
  // Held to one line, ending in an ellipsis rather than wrapping: a status that
  // wrapped would push the tip down and make the card jump between tasks.
  text(
    target,
    {
      x: innerX,
      y: cursorY,
      w: Math.max(0, innerWidth - PERCENT_LABEL_RESERVE_PX),
      h: statusHeight,
    },
    { text: `${view.status}${ellipsis}`, role: 'caption' },
  );
  text(
    target,
    { x: innerX, y: cursorY, w: innerWidth, h: statusHeight },
    {
      text: `${Math.floor(progress * PERCENT)}%`,
      style: type.label,
      color: palette.accent.base,
      align: 'right',
      tabular: true,
    },
  );
  cursorY += statusHeight;

  if (view.tip !== undefined) {
    cursorY += space.xl;
    text(
      target,
      { x: innerX, y: cursorY, w: innerWidth, h: type.overline.lineHeight },
      { text: TIP_LABEL, role: 'overline', color: palette.accent.base, align: 'center' },
    );
    cursorY += type.overline.lineHeight + space.xs;
    text(
      target,
      { x: innerX, y: cursorY, w: innerWidth, h: 0 },
      { text: view.tip, role: 'secondary', wrap: true, align: 'center' },
    );
  }
  ctx.restore();
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
 * A scene constructs one when it has up-front work worth covering and mounts
 * its {@link surface}. While {@link isOpen} the scene skips its own `update`
 * and, in `render`, frames only its `UiRoot`: the surface draws the screen
 * over everything, and drawing it is what ticks the work. Once the work is
 * done the overlay stays {@link isVisible} a moment longer, and the scene
 * calls {@link renderFadeOut} after its UI so it fades out over the world.
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

  /**
   * Whether the work is done. A method rather than a getter so a caller that
   * checked {@link isOpen} before framing the surface (which ticks the work)
   * reads it afresh afterwards.
   */
  hasFinished(): boolean {
    return this.closedAtMs !== null;
  }

  /** True while the screen still draws anything — open, or fading out. */
  get isVisible(): boolean {
    return this.closedAtMs === null || this.now() - this.closedAtMs < FADE_OUT_MS;
  }

  /**
   * The screen as a surface: open exactly while {@link isOpen}, in the system
   * band so it covers everything and takes every press, halting the world,
   * locking the keyboard and holding Escape. A fresh press of the attack key
   * is spent on it rather than left to swing a weapon nobody can see.
   */
  surface(id: string): Surface {
    return {
      id,
      band: 'system',
      haltsWorld: true,
      locksKeyboard: true,
      blocksEscape: true,
      isOpen: () => this.isOpen,
      render: (ui) => {
        this.tick();
        paintLoadingScreen(ui, this.view(), ui.screen.w, ui.screen.h);
      },
      onKey: (key) => keybindings.actionFor(key) === 'attack',
    };
  }

  /**
   * Draws the screen fading out over the world, once the work is done; does
   * nothing while it is still open or once the fade has finished. Call after
   * the scene's UI, on a context in canvas CSS pixels.
   */
  renderFadeOut(ctx: CanvasRenderingContext2D, canvasWidth: number, canvasHeight: number): void {
    if (this.isOpen || !this.isVisible) return;
    drawLoadingScreen(ctx, this.view(), canvasWidth, canvasHeight);
  }

  private tick(): void {
    if (this.closedAtMs !== null) return;
    this.runner.tick();
    if (this.runner.isFinished) this.closedAtMs = this.now();
  }

  private view(): LoadingScreenView {
    const timeMs = Math.max(0, this.now() - this.openedAtMs);
    const fadeAlpha =
      this.closedAtMs === null ? 1 : 1 - (this.now() - this.closedAtMs) / FADE_OUT_MS;
    const tipIndex =
      (this.firstTip + Math.floor(timeMs / TIP_ROTATION_MS)) % Math.max(1, this.tips.length);
    return {
      title: this.title,
      kicker: this.kicker,
      progress: this.runner.progress,
      status: this.runner.tasksDone ? 'Ready' : this.runner.statusLabel,
      tip: this.tips[tipIndex],
      timeMs,
      alpha: Math.max(0, fadeAlpha),
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
