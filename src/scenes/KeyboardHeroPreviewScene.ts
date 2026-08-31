/**
 * Localhost-only harness for reviewing the keyboard-hero mini-game, reached via
 * `?keyboardhero` in `devBootScene`. Ships no behaviour to players.
 *
 * Four tabs:
 *  - **Board** — the board composed from the shared drawing primitives at a
 *    chosen viewport, letterboxed the way `CasinoPreviewScene`'s Panel tab
 *    letterboxes the table, so a desktop reviewer sees the phone fit accurately.
 *    The board's static layers come from the same `drawBoardBase` the live game
 *    composites through, so the order reviewed here is the order that ships.
 *  - **States** — every note, receptor and touch state for all four lanes,
 *    captioned with the lane's name and the state's, drawn on the lane's own bed
 *    because that is the only surface any of them is ever seen against.
 *  - **Autoplay** — the real `KeyboardHeroSystem` driven by a simulated song
 *    clock that advances in real time, with the real chart auto-played through
 *    the real key bindings. A small deliberate timing jitter makes both PERFECT
 *    and HIT judgements appear, so the beat pulse, particles, streak, receptor
 *    flashes and countdown can all be reviewed in motion.
 *  - **Failure** — the same run with notes deliberately dropped, so the firewall
 *    pip shatter, the red lane flash, the board shake, the glitch bars and the
 *    two-strike fail sequence can be reviewed without having to play badly.
 */

import { Scene } from '../core/Scene';
import { keybindings, type GameAction } from '../core/Keybindings';
import { setViewportSize, viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { drawButton, BUTTON_PRESETS, setButtonMouseState, type ButtonResult } from '../ui/Button';
import { KeyboardHeroSystem } from '../systems/KeyboardHeroSystem';
import { KEYBOARD_HERO_CHART } from '../systems/keyboardHeroChart';
import { HIT_ZONE_IMG_CENTER } from '../systems/keyboardHeroGeometry';
import {
  LANE_BED_IMG_H,
  LANE_INDICES,
  LANE_PALETTES,
  NOTE_IMG_SIZE,
  RECEPTOR_IMG_SIZE,
  TOUCH_IMG_SIZE,
  computeKeyboardHeroLayout,
  noteImgYToScreenY,
  type KeyboardHeroLayout,
  type LaneIndex,
} from '../systems/keyboardHeroLayout';
import {
  drawBoardBase,
  drawLaneBedSlice,
  drawLaneHighlight,
  drawNoteKeycap,
  drawReceptorInRect,
  drawTouchButton,
  type NoteArtState,
  type ReceptorArtState,
  type TouchArtState,
} from '../systems/keyboardHeroBoardArt';

const BG_COLOR = '#0b0f14';
const PANEL_COLOR = '#05070a';
const LABEL_COLOR = '#e8eef6';
const SUBLABEL_COLOR = '#8fa3bd';
const WARNING_COLOR = '#f0b34a';

const MARGIN = 24;
const TITLE_SIZE = 18;
const LABEL_SIZE = 12;
const SMALL_LABEL_SIZE = 10;
const LINE_HEIGHT = 18;
const TAB_HEIGHT = 30;
const TAB_WIDTH = 96;
const TAB_GAP = 6;
const TAB_ROW_Y = 40;
const TAB_ROW_GAP = 16;
const CONTENT_TOP = TAB_ROW_Y + TAB_HEIGHT + TAB_ROW_GAP;

const BTN_HEIGHT = 26;
const BTN_GAP = 6;
const VIEWPORT_BTN_WIDTH = 116;
const CONTROL_BTN_WIDTH = 150;

const TABS = ['Board', 'States', 'Autoplay', 'Failure'] as const;
type PreviewTab = (typeof TABS)[number];

interface PreviewViewport {
  readonly label: string;
  readonly width: number;
  readonly height: number;
  readonly isMobile: boolean;
}

const VIEWPORT_MATRIX: ReadonlyArray<PreviewViewport> = [
  { label: '1280×720', width: 1280, height: 720, isMobile: false },
  { label: '1920×1080', width: 1920, height: 1080, isMobile: false },
  { label: '1024×640', width: 1024, height: 640, isMobile: false },
  { label: '390×844 📱', width: 390, height: 844, isMobile: true },
  { label: '360×640 📱', width: 360, height: 640, isMobile: true },
  { label: '844×390 📱', width: 844, height: 390, isMobile: true },
  { label: '768×1024 📱', width: 768, height: 1024, isMobile: true },
];

const NOTE_STATES: ReadonlyArray<NoteArtState> = ['normal', 'hit', 'missed'];
const RECEPTOR_STATES: ReadonlyArray<ReceptorArtState> = ['idle', 'pressed', 'flash'];
const TOUCH_STATES: ReadonlyArray<TouchArtState> = ['idle', 'pressed'];

// ── States tab ──────────────────────────────────────────────────────────────

const SWATCH_GAP = 10;
const SWATCH_CAPTION_GAP = 14;
const SWATCH_SECTION_GAP = 18;
/** The lane bed slice drawn behind a swatch, in board-space pixels. */
const SWATCH_BED_DEPTH_IMG = 120;

// ── Board tab ───────────────────────────────────────────────────────────────

/** Review notes staggered down the lanes, so keycaps are judged at several depths. */
const REVIEW_NOTE_FIRST_DEPTH = 0.14;
const REVIEW_NOTE_DEPTH_STRIDE = 0.16;
/** The one lane shown lit, so the press highlight is reviewable at rest. */
const HIGHLIGHTED_LANE: LaneIndex = 1;
const HIGHLIGHT_STRENGTH = 0.8;
const HIT_WINDOW_LINE_SCALE = 1;
/** The Board tab is a still, so its beds sit where the beat pulse's peak puts them. */
const STATIC_BED_ALPHA = 1;

// ── Autoplay tabs ───────────────────────────────────────────────────────────

/**
 * One 60 fps frame. `SceneManager` drives `update` on a fixed step of exactly
 * this, so advancing the simulated song clock by it per call keeps the fake
 * track in step with the wall clock the system's own effects run on.
 */
const MS_PER_SECOND = 1000;
const PREVIEW_FRAME_RATE = 60;
const SIM_FRAME_MS = MS_PER_SECOND / PREVIEW_FRAME_RATE;

/** Turns the letterbox's 0-1 scale into the percentage its caption reads in. */
const PERCENT = 100;

/**
 * How far off perfect an auto-played press may land, in milliseconds.
 *
 * Comfortably inside the frozen hit window and comfortably outside the cosmetic
 * PERFECT threshold, so a run shows both judgement grades rather than a wall of
 * one of them. Applied as a repeating sweep across the chart rather than at
 * random, so two viewings of the same bar look the same.
 */
const AUTOPLAY_JITTER_MS = 95;
/** Length of the jitter sweep, in chart entries. */
const AUTOPLAY_JITTER_PERIOD = 7;

/** In the failure view, every Nth charted note is left to fall past its window. */
const DROP_EVERY_NTH_NOTE = 6;

/** How long a finished run rests on screen before the harness restarts it. */
const RESTART_DELAY_MS = 1600;

/** The movement action each lane's key is bound to, in lane order. */
const LANE_ACTIONS: readonly GameAction[] = ['moveLeft', 'moveUp', 'moveDown', 'moveRight'];

type RunOutcome = 'running' | 'completed' | 'failed';

function laneKey(lane: LaneIndex): string | null {
  const keys = keybindings.keysFor(LANE_ACTIONS[lane]);
  return keys.length === 0 ? null : keys[0];
}

/**
 * The offset this chart entry is auto-played at. Index-derived rather than
 * random so a reviewer watching the same passage twice sees the same grades.
 */
function autoplayOffsetMs(chartIndex: number): number {
  const phase = (chartIndex % AUTOPLAY_JITTER_PERIOD) / (AUTOPLAY_JITTER_PERIOD - 1);
  return (phase * 2 - 1) * AUTOPLAY_JITTER_MS;
}

export class KeyboardHeroPreviewScene extends Scene {
  private tab: PreviewTab = 'Board';
  private viewportIndex = 0;
  private playPerfectly = false;

  private mouseX = 0;
  private mouseY = 0;

  private tabButtons: Array<{ result: ButtonResult; tab: PreviewTab }> = [];
  private viewportButtons: Array<{ result: ButtonResult; index: number }> = [];
  private restartButton: ButtonResult | null = null;
  private perfectButton: ButtonResult | null = null;

  private readonly board = new KeyboardHeroSystem();
  private songTimeMs = 0;
  private nextChartIndex = 0;
  private outcome: RunOutcome = 'running';
  /** Wall-clock time the finished run is restarted; 0 while a run is live. */
  private restartAtMs = 0;
  private missingBinding = false;

  handleMouseMove(mx: number, my: number): void {
    this.mouseX = mx;
    this.mouseY = my;
  }

  handleClick(mx: number, my: number): void {
    for (const tab of this.tabButtons) {
      if (!tab.result.contains(mx, my)) continue;
      this.tab = tab.tab;
      if (this.isAutoplayTab()) this.startRun();
      return;
    }
    for (const button of this.viewportButtons) {
      if (button.result.contains(mx, my)) {
        this.viewportIndex = button.index;
        return;
      }
    }
    if (this.restartButton?.contains(mx, my) === true) {
      this.startRun();
      return;
    }
    if (this.perfectButton?.contains(mx, my) === true) {
      this.playPerfectly = !this.playPerfectly;
      this.startRun();
    }
  }

  private isAutoplayTab(): boolean {
    return this.tab === 'Autoplay' || this.tab === 'Failure';
  }

  private startRun(): void {
    this.songTimeMs = 0;
    this.nextChartIndex = 0;
    this.outcome = 'running';
    this.restartAtMs = 0;
    // The unbound-action warning belongs to the run that hit it. Latching it for
    // the session would keep accusing a keymap that has since been fixed.
    this.missingBinding = false;
    this.board.start(
      () => {
        this.outcome = 'completed';
      },
      () => {
        this.outcome = 'failed';
      },
    );
  }

  update(): void {
    if (!this.isAutoplayTab()) return;

    if (!this.board.isActive) {
      if (this.restartAtMs === 0) this.restartAtMs = performance.now() + RESTART_DELAY_MS;
      if (performance.now() >= this.restartAtMs) this.startRun();
      return;
    }

    this.songTimeMs += SIM_FRAME_MS;
    this.playDueNotes();
    this.board.update(this.songTimeMs);
  }

  /**
   * Presses every note whose moment has arrived, through the same
   * `handleKeyDown` path a player's keyboard reaches — bindings included, so a
   * rebound keymap is exercised rather than bypassed.
   */
  private playDueNotes(): void {
    while (this.nextChartIndex < KEYBOARD_HERO_CHART.length) {
      const entry = KEYBOARD_HERO_CHART[this.nextChartIndex];
      const offsetMs = this.playPerfectly ? 0 : autoplayOffsetMs(this.nextChartIndex);
      const pressAtMs = entry.timeMs + offsetMs;
      if (pressAtMs > this.songTimeMs) break;
      this.nextChartIndex++;

      const dropped = this.tab === 'Failure' && this.nextChartIndex % DROP_EVERY_NTH_NOTE === 0;
      if (dropped) continue;

      const key = laneKey(entry.column);
      if (key === null) {
        this.missingBinding = true;
        continue;
      }
      this.board.handleKeyDown(key, pressAtMs);
    }
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    ctx.fillStyle = BG_COLOR;
    ctx.fillRect(0, 0, width, height);

    setButtonMouseState(this.mouseX, this.mouseY);
    this.viewportButtons = [];
    this.restartButton = null;
    this.perfectButton = null;

    drawText(ctx, 'Keyboard hero — mini-game review harness', {
      x: MARGIN,
      y: 14,
      size: TITLE_SIZE,
      bold: true,
      color: LABEL_COLOR,
    });

    this.renderTabs(ctx);

    switch (this.tab) {
      case 'Board':
        this.renderBoardTab(ctx, width, height);
        return;
      case 'States':
        this.renderStatesTab(ctx, width);
        return;
      case 'Autoplay':
      case 'Failure':
        this.renderRunTab(ctx, width, height);
        return;
    }
  }

  private renderTabs(ctx: CanvasRenderingContext2D): void {
    this.tabButtons = [];
    TABS.forEach((tab, i) => {
      const result = drawButton(ctx, {
        x: MARGIN + i * (TAB_WIDTH + TAB_GAP),
        y: TAB_ROW_Y,
        width: TAB_WIDTH,
        height: TAB_HEIGHT,
        label: tab,
        ...(tab === this.tab ? BUTTON_PRESETS.gold : BUTTON_PRESETS.primary),
      });
      this.tabButtons.push({ result, tab });
    });
  }

  private renderViewportButtons(ctx: CanvasRenderingContext2D): void {
    VIEWPORT_MATRIX.forEach((viewport, i) => {
      const result = drawButton(ctx, {
        x: MARGIN + i * (VIEWPORT_BTN_WIDTH + BTN_GAP),
        y: CONTENT_TOP,
        width: VIEWPORT_BTN_WIDTH,
        height: BTN_HEIGHT,
        label: viewport.label,
        labelSize: SMALL_LABEL_SIZE,
        ...(i === this.viewportIndex ? BUTTON_PRESETS.gold : BUTTON_PRESETS.primary),
      });
      this.viewportButtons.push({ result, index: i });
    });
  }

  private panelTop(): number {
    return CONTENT_TOP + BTN_HEIGHT + BTN_GAP + BTN_HEIGHT + TAB_ROW_GAP;
  }

  /**
   * Runs `draw` with the simulated viewport installed and the canvas letterboxed
   * to it, scaled down when the simulated size does not fit the review window.
   * Returns the scale used so the caption can say so.
   */
  private letterbox(
    ctx: CanvasRenderingContext2D,
    viewport: PreviewViewport,
    windowW: number,
    windowH: number,
    draw: (layoutViewport: PreviewViewport) => void,
  ): number {
    const top = this.panelTop();
    const availableW = windowW - MARGIN * 2;
    const availableH = windowH - top - MARGIN - LINE_HEIGHT;
    const scale = Math.min(1, availableW / viewport.width, availableH / viewport.height);

    ctx.save();
    ctx.translate(MARGIN, top);
    ctx.scale(scale, scale);
    ctx.beginPath();
    ctx.rect(0, 0, viewport.width, viewport.height);
    ctx.clip();
    ctx.fillStyle = PANEL_COLOR;
    ctx.fillRect(0, 0, viewport.width, viewport.height);
    setViewportSize(viewport.width, viewport.height);
    draw(viewport);
    setViewportSize(windowW, windowH);
    ctx.restore();
    setButtonMouseState(this.mouseX, this.mouseY);
    return scale;
  }

  private renderBoardTab(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.renderViewportButtons(ctx);

    const viewport = VIEWPORT_MATRIX[this.viewportIndex];
    const scale = this.letterbox(ctx, viewport, width, height, (simulated) => {
      const layout = computeKeyboardHeroLayout(
        simulated.width,
        simulated.height,
        simulated.isMobile,
      );
      this.drawStaticBoard(ctx, layout);
    });

    drawText(ctx, `${viewport.label} at ${(scale * PERCENT).toFixed(0)}%`, {
      x: MARGIN,
      y: height - MARGIN,
      size: LABEL_SIZE,
      color: SUBLABEL_COLOR,
    });
  }

  /** The board at rest: beds, hit window, one lit lane, notes, receptors, touch row. */
  private drawStaticBoard(ctx: CanvasRenderingContext2D, layout: KeyboardHeroLayout): void {
    drawBoardBase(ctx, layout, () => STATIC_BED_ALPHA, HIT_WINDOW_LINE_SCALE);
    drawLaneHighlight(
      ctx,
      layout,
      HIGHLIGHTED_LANE,
      LANE_PALETTES[HIGHLIGHTED_LANE].hue,
      HIGHLIGHT_STRENGTH,
    );

    for (const lane of LANE_INDICES) {
      const depth = REVIEW_NOTE_FIRST_DEPTH + lane * REVIEW_NOTE_DEPTH_STRIDE;
      const laneRect = layout.lanes[lane];
      drawNoteKeycap(
        ctx,
        lane,
        laneRect.x + laneRect.width / 2,
        noteImgYToScreenY(layout, depth * LANE_BED_IMG_H),
        layout.noteSize,
        'normal',
        1,
      );
      drawReceptorInRect(
        ctx,
        layout.receptors[lane],
        lane,
        lane === HIGHLIGHTED_LANE ? 'pressed' : 'idle',
      );
    }

    const buttons = layout.touchButtons;
    if (buttons === null) return;
    for (const lane of LANE_INDICES) {
      drawTouchButton(ctx, buttons[lane], lane, lane === HIGHLIGHTED_LANE ? 'pressed' : 'idle');
    }
  }

  private renderStatesTab(ctx: CanvasRenderingContext2D, width: number): void {
    drawText(ctx, `Board-space sizes, each swatch on its own lane's bed. Window ${width}px wide.`, {
      x: MARGIN,
      y: CONTENT_TOP,
      size: SMALL_LABEL_SIZE,
      color: SUBLABEL_COLOR,
    });

    // The three families sit side by side rather than stacked: stacked, the
    // touch row falls off the bottom of every ordinary window, and comparing a
    // note against the receptor it lands in means seeing both at once.
    const top = CONTENT_TOP + LINE_HEIGHT;
    let x = MARGIN;
    x += this.drawStateBlock(
      ctx,
      'Notes',
      NOTE_IMG_SIZE,
      NOTE_STATES,
      x,
      top,
      (lane, state, rect) => {
        drawNoteKeycap(
          ctx,
          lane,
          rect.x + rect.size / 2,
          rect.y + rect.size / 2,
          rect.size,
          state,
          1,
        );
      },
    );
    x += this.drawStateBlock(
      ctx,
      'Receptors',
      RECEPTOR_IMG_SIZE,
      RECEPTOR_STATES,
      x,
      top,
      (lane, state, rect) => {
        drawReceptorInRect(ctx, boxOf(rect), lane, state);
      },
    );
    this.drawStateBlock(
      ctx,
      'Touch buttons',
      TOUCH_IMG_SIZE,
      TOUCH_STATES,
      x,
      top,
      (lane, state, rect) => {
        drawTouchButton(ctx, boxOf(rect), lane, state);
      },
    );
  }

  /** Draws one family's lane × state grid and returns the width it occupied. */
  private drawStateBlock<TState extends string>(
    ctx: CanvasRenderingContext2D,
    title: string,
    size: number,
    states: ReadonlyArray<TState>,
    left: number,
    top: number,
    paint: (lane: LaneIndex, state: TState, rect: SwatchRect) => void,
  ): number {
    drawText(ctx, title, {
      x: left,
      y: top,
      size: LABEL_SIZE,
      bold: true,
      color: LABEL_COLOR,
    });
    const gridTop = top + LINE_HEIGHT;
    const rowStride = size + SWATCH_CAPTION_GAP + SWATCH_GAP;
    for (const lane of LANE_INDICES) {
      states.forEach((state, index) => {
        const rect: SwatchRect = {
          x: left + index * (size + SWATCH_GAP),
          y: gridTop + lane * rowStride,
          size,
        };
        this.drawSwatchBed(ctx, lane, rect);
        paint(lane, state, rect);
        drawText(ctx, `${LANE_PALETTES[lane].name} · ${state}`, {
          x: rect.x,
          y: rect.y + size + 2,
          size: SMALL_LABEL_SIZE,
          color: SUBLABEL_COLOR,
        });
      });
    }
    return states.length * (size + SWATCH_GAP) + SWATCH_SECTION_GAP;
  }

  /**
   * The slice of the lane's bed that sits behind a note at the hit line, drawn
   * under every swatch. A keycap judged on the page background is judged against
   * a surface it never meets.
   */
  private drawSwatchBed(ctx: CanvasRenderingContext2D, lane: LaneIndex, rect: SwatchRect): void {
    drawLaneBedSlice(
      ctx,
      { x: rect.x, y: rect.y, width: rect.size, height: rect.size },
      lane,
      HIT_ZONE_IMG_CENTER,
      SWATCH_BED_DEPTH_IMG,
    );
  }

  private renderRunTab(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    this.renderViewportButtons(ctx);
    const controlsY = CONTENT_TOP + BTN_HEIGHT + BTN_GAP;
    this.restartButton = drawButton(ctx, {
      x: MARGIN,
      y: controlsY,
      width: CONTROL_BTN_WIDTH,
      height: BTN_HEIGHT,
      label: 'Restart run',
      labelSize: SMALL_LABEL_SIZE,
      ...BUTTON_PRESETS.gold,
    });
    if (this.tab === 'Autoplay') {
      this.perfectButton = drawButton(ctx, {
        x: MARGIN + CONTROL_BTN_WIDTH + BTN_GAP,
        y: controlsY,
        width: CONTROL_BTN_WIDTH,
        height: BTN_HEIGHT,
        label: this.playPerfectly ? 'Timing: perfect' : 'Timing: jittered',
        ...BUTTON_PRESETS.toggle,
        labelSize: SMALL_LABEL_SIZE,
      });
    }

    const viewport = VIEWPORT_MATRIX[this.viewportIndex];
    const scale = this.letterbox(ctx, viewport, width, height, () => {
      this.board.render(ctx);
    });

    const detail =
      this.tab === 'Failure'
        ? `dropping every ${DROP_EVERY_NTH_NOTE}th note`
        : this.playPerfectly
          ? 'every press dead on the beat'
          : `presses swept ±${AUTOPLAY_JITTER_MS}ms`;
    const status = this.missingBinding
      ? 'a movement action has no key bound, so its lane cannot be auto-played'
      : `${this.outcome} · ${detail} · the board reads the real device flag, so the touch row ` +
        'only appears on a real phone';
    drawText(ctx, `${viewport.label} at ${(scale * PERCENT).toFixed(0)}% — ${status}`, {
      x: MARGIN,
      y: height - MARGIN,
      size: LABEL_SIZE,
      color: this.missingBinding ? WARNING_COLOR : SUBLABEL_COLOR,
    });
  }
}

interface SwatchRect {
  readonly x: number;
  readonly y: number;
  readonly size: number;
}

function boxOf(rect: SwatchRect): { x: number; y: number; width: number; height: number } {
  return { x: rect.x, y: rect.y, width: rect.size, height: rect.size };
}
