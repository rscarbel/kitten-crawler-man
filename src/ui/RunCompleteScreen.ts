import { drawText } from './TextBox';
import {
  beginModalFit,
  drawBox,
  drawDivider,
  drawModal,
  drawOverlay,
  endModalFit,
  fitModal,
  MODAL_FIT_NONE,
  modalFitPoint,
  type ModalFit,
} from './Box';
import {
  BUTTON_PRESETS,
  beginMenuFocus,
  drawButton,
  endMenuFocus,
  resetButtonPointerSpace,
  setButtonPointerSpace,
  occludeRenderedButtons,
  suppressMenuFocus,
  type ButtonResult,
} from './Button';
import { viewportHeight, viewportWidth } from '../core/Viewport';
import { formatPlayTime, type GameStats } from '../core/GameStats';
import type { AchievementManager } from '../core/AchievementManager';

/**
 * Everything the run-complete screen reports, frozen at the moment the party
 * went down the stairs — the screen is a record, and must not keep ticking
 * while it is up.
 */
export interface RunSummary {
  readonly framesPlayed: number;
  readonly deaths: number;
  readonly damageDealt: number;
  readonly damageTaken: number;
  readonly potionsUsed: number;
  readonly goldEarned: number;
  readonly achievementsUnlocked: number;
  readonly achievementsTotal: number;
  readonly humanLevel: number;
  readonly catLevel: number;
  /** Null when Mongo was never unlocked, which drops his row. */
  readonly mongoLevel: number | null;
  readonly totalKills: number;
  readonly bossesDefeated: number;
  readonly hirelingsHired: number;
  readonly hirelingsLost: number;
  readonly topKills: ReadonlyArray<readonly [string, number]>;
}

/** How many creatures the "most slain" block names. */
export const RUN_SUMMARY_TOP_KILLS = 5;

/**
 * Achievements the party holds between them, out of every achievement there is.
 * Counted across both crawlers because several are one crawler's alone, and a
 * party that earned all of them should read as having earned all of them.
 */
export function countPartyAchievements(
  human: AchievementManager,
  cat: AchievementManager,
): { unlocked: number; total: number } {
  const all = human.getAllAchievements();
  const unlocked = all.filter(({ def, unlocked }) => unlocked || cat.isUnlocked(def.id)).length;
  return { unlocked, total: all.length };
}

export function buildRunSummary(input: {
  stats: GameStats;
  humanLevel: number;
  catLevel: number;
  mongoLevel: number | null;
  achievements: { unlocked: number; total: number };
}): RunSummary {
  const { stats, achievements } = input;
  return {
    framesPlayed: stats.framesPlayed,
    deaths: stats.deaths,
    damageDealt: stats.damageDealt,
    damageTaken: stats.damageTaken,
    potionsUsed: stats.potionsUsed,
    goldEarned: stats.goldEarned,
    achievementsUnlocked: achievements.unlocked,
    achievementsTotal: achievements.total,
    humanLevel: input.humanLevel,
    catLevel: input.catLevel,
    mongoLevel: input.mongoLevel,
    totalKills: stats.totalKills,
    bossesDefeated: stats.bossesDefeated,
    hirelingsHired: stats.hirelingsHired,
    hirelingsLost: stats.hirelingsLost,
    topKills: stats.topKills(RUN_SUMMARY_TOP_KILLS),
  };
}

/** What the two buttons do; the scene owns both routes. */
export interface RunCompleteHandlers {
  onKeepExploring: () => void;
  onMainMenu: () => void;
}

/**
 * Ends the run: whoever cannot come down the stairs is settled first, so the
 * save does not record them standing; then achievements, so the screen's count
 * includes the one for escaping; then the save, so a player who closes the tab
 * on the celebration still has the finished run on disk; then the screen.
 */
export function finishRun(
  screen: RunCompleteScreen,
  steps: {
    settleParty: () => void;
    unlockAchievements: () => void;
    save: () => void;
    summarize: () => RunSummary;
    handlers: RunCompleteHandlers;
  },
): void {
  steps.settleParty();
  steps.unlockAchievements();
  steps.save();
  screen.activate(steps.summarize(), steps.handlers);
}

/** Focus ring id; the scene's overlay claim names the same one. */
export const RUN_COMPLETE_FOCUS_ID = 'run-complete';

const HEADING_TEXT = 'CONGRATULATIONS';
const SUBTITLE_TEXT = 'You escaped the city.';
const CAPTION_TEXT = 'Run complete — progress saved.';
const RUN_COLUMN_TITLE = 'THE RUN';
const PARTY_COLUMN_TITLE = 'THE PARTY';
const KILLS_TITLE = 'MOST SLAIN';
const KEEP_EXPLORING_LABEL = 'Keep Exploring';
const MAIN_MENU_LABEL = 'Main Menu';
const NO_KILLS_TEXT = 'Nothing. Not one thing.';

// ── Timeline (render frames) ────────────────────────────────────────────────
const FADE_IN_FRAMES = 45;
/** The panel is not drawn at all until the backdrop has come this far in. */
const PANEL_ALPHA_THRESHOLD = 0.2;
const ROWS_START_FRAME = 60;
const ROW_STAGGER_FRAMES = 7;
const ROW_FADE_FRAMES = 14;
const COUNT_UP_FRAMES = 50;
const BUTTONS_DELAY_AFTER_ROWS_FRAMES = 20;
const BUTTON_FADE_FRAMES = 18;
/** Cubic ease-out: fast at the start, settling onto the final number. */
const COUNT_UP_EASE_POWER = 3;

// ── Layout (design pixels, before the fit scale) ────────────────────────────
const PANEL_MAX_WIDTH = 640;
const PANEL_SIDE_MARGIN = 16;
const PANEL_PAD_X = 20;
const PANEL_PAD_TOP = 18;
const PANEL_PAD_BOTTOM = 18;
const PANEL_RADIUS = 14;
const PANEL_BORDER_WIDTH = 2;
const PANEL_GLOW_BLUR = 32;
const HEADING_MAX_SIZE = 40;
/** Monospace glyphs run about this fraction of the font size wide. */
const MONO_CHAR_WIDTH_RATIO = 0.62;
const HEADING_BLOCK_H = 50;
const HEADING_GLOW_BLUR = 24;
const HEADING_OUTLINE_WIDTH = 3;
const HEADING_PULSE_MIN = 0.96;
const HEADING_PULSE_RANGE = 0.04;
const HEADING_PULSE_FREQ = 2.4;
const SUBTITLE_SIZE = 18;
const SUBTITLE_BLOCK_H = 28;
const SUBTITLE_GLOW_BLUR = 12;
const CAPTION_SIZE = 12;
const CAPTION_BLOCK_H = 22;
const SECTION_GAP = 12;
const COLUMN_GAP = 14;
const CARD_PAD_X = 10;
const CARD_PAD_TOP = 8;
const CARD_PAD_BOTTOM = 8;
const CARD_RADIUS = 8;
const CARD_TITLE_SIZE = 11;
const CARD_TITLE_H = 20;
const ROW_H = 19;
const ROW_MAX_FONT = 13;
/** Characters a stat row must hold at its widest: "Damage dealt" plus a six-digit value and a gap. */
const ROW_CHAR_BUDGET = 20;
const ROW_TEXT_TOP_INSET = 3;
const KILL_RANK_GAP = 4;
/**
 * Below this viewport width the kills list is one column: two columns there
 * leave room for about ten letters of a name, and a portrait phone has the
 * height to spare that a landscape one does not.
 */
const KILLS_SINGLE_COLUMN_BELOW_WIDTH = 480;
const BUTTON_H = 44;
const BUTTON_GAP = 12;
const BUTTON_MARGIN_TOP = 16;
const BUTTON_LABEL_SIZE = 15;
const BUTTON_GLOW_BLUR = 14;
const BUTTON_MAX_WIDTH = 220;
const DIVIDER_INSET = 40;
const DIVIDER_ALPHA = 0.4;
const ELLIPSIS = '…';

// ── Celebration effects ─────────────────────────────────────────────────────
const SPARKLE_COLORS = [
  '#ffd700',
  '#fff5a0',
  '#ffa500',
  '#ff8c00',
  '#da70d6',
  '#c084fc',
  '#60a5fa',
  '#34d399',
] as const;
const CONFETTI_COLORS = ['#ffd700', '#f472b6', '#60a5fa', '#34d399', '#c084fc', '#fb923c'] as const;
const SPARKLE_MIN_SPEED = 1.5;
const SPARKLE_SPEED_RANGE = 5.5;
const SPARKLE_MIN_LIFE = 80;
const SPARKLE_LIFE_RANGE = 80;
const SPARKLE_SPAWN_JITTER_PX = 60;
const SPARKLE_MIN_SIZE = 1.5;
const SPARKLE_SIZE_RANGE = 3.5;
const SPARKLE_GRAVITY = 0.06;
const SPARKLE_DRAG = 0.98;
const SPARKLE_GLOW_MULTIPLIER = 4;
const TWINKLE_BASE = 0.55;
const TWINKLE_RANGE = 0.45;
const TWINKLE_FREQ = 6;
const FIRST_BURST_COUNT = 50;
const EARLY_BURST_INTERVAL = 8;
const EARLY_BURST_COUNT = 10;
const LATE_BURST_INTERVAL = 22;
const LATE_BURST_COUNT = 6;
const LATE_BURSTS_FROM_FRAME = 240;
/** Bursts go off in a ring around the screen centre, never behind the numbers. */
const BURST_RING_MIN_FRACTION = 0.3;
const BURST_RING_RANGE_FRACTION = 0.2;
const CONFETTI_PER_FRAME_EARLY = 3;
const CONFETTI_PER_FRAME_LATE = 1;
const CONFETTI_EARLY_FRAMES = 180;
/** Confetti is spawned only on every Nth late frame, so it thins to a drizzle. */
const CONFETTI_LATE_EVERY = 3;
const CONFETTI_MIN_W = 4;
const CONFETTI_W_RANGE = 4;
const CONFETTI_MIN_H = 6;
const CONFETTI_H_RANGE = 6;
const CONFETTI_MIN_FALL = 1.2;
const CONFETTI_FALL_RANGE = 1.8;
const CONFETTI_DRIFT_RANGE = 1.2;
const CONFETTI_SPIN_RANGE = 0.2;
const CONFETTI_SWAY_AMPLITUDE = 0.6;
const CONFETTI_SWAY_FREQ = 0.05;
const CONFETTI_SPAWN_ABOVE_PX = 20;
const CONFETTI_ALPHA = 0.9;
/** Confetti's flip is a squash of its height by the cosine of its spin. */
const CONFETTI_FLIP_RATE = 2;
const OVERLAY_ALPHA = 0.82;
const RAY_COUNT = 14;
const RAY_SPIN_PER_SECOND = 0.12;
const RAY_ALPHA = 0.1;
const RAY_HALF_WIDTH_RADIANS = 0.09;
const RAY_LENGTH_FRACTION = 0.9;
const RUNE_ALPHA_MIN = 0.3;
const RUNE_ALPHA_RANGE = 0.2;
const RUNE_PULSE_FREQ = 1.8;
const RUNE_LINE_WIDTH = 1.5;
const RUNE_CORNER_LEN = 18;
const RUNE_CORNER_INSET = 10;
const MS_PER_SECOND = 1000;
const HALF = 0.5;
const FULL_TURN = Math.PI * 2;

interface Sparkle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;
  twinkleOffset: number;
}

interface Confetti {
  x: number;
  y: number;
  vx: number;
  vy: number;
  w: number;
  h: number;
  angle: number;
  spin: number;
  swayPhase: number;
  color: string;
}

type StatFormat = 'count' | 'clock' | 'fraction';

interface StatRow {
  readonly label: string;
  readonly value: number;
  readonly format: StatFormat;
  readonly color: string;
  /** For 'fraction' rows, the fixed denominator. */
  readonly outOf?: number;
}

const FALLBACK_EFFECT_COLOR = '#ffd700';

function pickColor(colors: readonly string[]): string {
  return colors[Math.floor(Math.random() * colors.length)] ?? FALLBACK_EFFECT_COLOR;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function fitToChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text;
  return `${text.slice(0, Math.max(0, maxChars - ELLIPSIS.length))}${ELLIPSIS}`;
}

function runRows(summary: RunSummary): StatRow[] {
  return [
    { label: 'Time played', value: summary.framesPlayed, format: 'clock', color: '#e2e8f0' },
    { label: 'Deaths', value: summary.deaths, format: 'count', color: '#f87171' },
    { label: 'Damage dealt', value: summary.damageDealt, format: 'count', color: '#fb923c' },
    { label: 'Damage taken', value: summary.damageTaken, format: 'count', color: '#fca5a5' },
    { label: 'Potions used', value: summary.potionsUsed, format: 'count', color: '#86efac' },
    { label: 'Gold earned', value: summary.goldEarned, format: 'count', color: '#fde047' },
    {
      label: 'Achievements',
      value: summary.achievementsUnlocked,
      format: 'fraction',
      outOf: summary.achievementsTotal,
      color: '#c084fc',
    },
  ];
}

function partyRows(summary: RunSummary): StatRow[] {
  const rows: StatRow[] = [
    { label: 'Human level', value: summary.humanLevel, format: 'count', color: '#93c5fd' },
    { label: 'Cat level', value: summary.catLevel, format: 'count', color: '#fdba74' },
  ];
  if (summary.mongoLevel !== null) {
    rows.push({
      label: 'Mongo level',
      value: summary.mongoLevel,
      format: 'count',
      color: '#4ade80',
    });
  }
  rows.push(
    { label: 'Total kills', value: summary.totalKills, format: 'count', color: '#fbbf24' },
    { label: 'Bosses slain', value: summary.bossesDefeated, format: 'count', color: '#f472b6' },
    { label: 'Hirelings hired', value: summary.hirelingsHired, format: 'count', color: '#e2e8f0' },
    { label: 'Hirelings lost', value: summary.hirelingsLost, format: 'count', color: '#94a3b8' },
  );
  return rows;
}

function formatRowValue(row: StatRow, progress: number): string {
  const shown = row.value * progress;
  switch (row.format) {
    case 'clock':
      return formatPlayTime(shown);
    case 'fraction':
      return `${formatCount(shown)} / ${formatCount(row.outOf ?? row.value)}`;
    case 'count':
      return formatCount(shown);
  }
}

/**
 * The end of the game: the party is down the escape stairwell and out of the
 * city. Fireworks and confetti over a gold panel, the run's numbers counting up
 * row by row, then a choice to keep walking the town or leave for the menu.
 *
 * Advances on render frames, like the level-complete card it is modelled on,
 * because it owns the screen and the world beneath it is halted.
 */
export class RunCompleteScreen {
  private _active = false;
  private frame = 0;
  private summary: RunSummary | null = null;
  private handlers: RunCompleteHandlers | null = null;
  private sparkles: Sparkle[] = [];
  private confetti: Confetti[] = [];
  private fit: ModalFit = MODAL_FIT_NONE;
  private keepExploringButton: ButtonResult | null = null;
  private mainMenuButton: ButtonResult | null = null;

  get isActive(): boolean {
    return this._active;
  }

  activate(summary: RunSummary, handlers: RunCompleteHandlers): void {
    this._active = true;
    this.frame = 0;
    this.summary = summary;
    this.handlers = handlers;
    this.sparkles = [];
    this.confetti = [];
    this.keepExploringButton = null;
    this.mainMenuButton = null;
  }

  /** Frames until the buttons start to fade in, which is also when the count-up has settled. */
  private get buttonsFrame(): number {
    const summary = this.summary;
    if (summary === null) return 0;
    const longestColumn = Math.max(runRows(summary).length, partyRows(summary).length);
    // The kills block reveals after the cards, one row per creature, or one
    // row for the line that says there were none.
    const killRows = Math.max(1, summary.topKills.length);
    return (
      ROWS_START_FRAME +
      (longestColumn + killRows) * ROW_STAGGER_FRAMES +
      COUNT_UP_FRAMES +
      BUTTONS_DELAY_AFTER_ROWS_FRAMES
    );
  }

  /**
   * A press before the buttons are up skips straight to the finished record
   * rather than doing nothing — nobody should have to sit through the count-up
   * a second time to find the button.
   */
  handleClick(mx: number, my: number): boolean {
    if (!this._active) return false;
    if (this.frame < this.buttonsFrame) {
      this.frame = this.buttonsFrame;
      return true;
    }
    const point = modalFitPoint(this.fit, mx, my);
    if (this.keepExploringButton?.contains(point.x, point.y) === true) {
      this.close(this.handlers?.onKeepExploring);
      return true;
    }
    if (this.mainMenuButton?.contains(point.x, point.y) === true) {
      this.close(this.handlers?.onMainMenu);
      return true;
    }
    return true;
  }

  private close(then: (() => void) | undefined): void {
    this._active = false;
    this.summary = null;
    this.handlers = null;
    this.sparkles = [];
    this.confetti = [];
    then?.();
  }

  render(ctx: CanvasRenderingContext2D): void {
    const summary = this.summary;
    if (!this._active || summary === null) return;
    this.frame++;
    // Owns the screen from its first frame, before its buttons exist: without a
    // declared ring, one left over from whatever was drawn under it would take
    // an accept press.
    suppressMenuFocus(RUN_COMPLETE_FOCUS_ID);

    const w = viewportWidth();
    const h = viewportHeight();
    const alpha = clamp01(this.frame / FADE_IN_FRAMES);
    const now = performance.now() / MS_PER_SECOND;

    this.tickEffects(w, h);

    drawOverlay(ctx, {
      canvasWidth: w,
      canvasHeight: h,
      color: '#05000f',
      alpha: alpha * OVERLAY_ALPHA,
    });
    // Everything drawn before this is under the backdrop now; a press on the
    // panel's empty space must not sound a button hidden beneath it.
    occludeRenderedButtons();
    this.renderRays(ctx, w, h, alpha, now);
    this.renderConfetti(ctx, alpha);
    this.renderSparkles(ctx, alpha, now);

    if (alpha < PANEL_ALPHA_THRESHOLD) return;

    const left = runRows(summary);
    const right = partyRows(summary);
    const cardRows = Math.max(left.length, right.length);
    const killColumns = w < KILLS_SINGLE_COLUMN_BELOW_WIDTH ? 1 : 2;
    const killRows = Math.max(1, Math.ceil(summary.topKills.length / killColumns));
    const cardH = CARD_PAD_TOP + CARD_TITLE_H + cardRows * ROW_H + CARD_PAD_BOTTOM;
    const killsH = CARD_PAD_TOP + CARD_TITLE_H + killRows * ROW_H + CARD_PAD_BOTTOM;
    const panelH =
      PANEL_PAD_TOP +
      HEADING_BLOCK_H +
      SUBTITLE_BLOCK_H +
      CAPTION_BLOCK_H +
      SECTION_GAP +
      cardH +
      SECTION_GAP +
      killsH +
      BUTTON_MARGIN_TOP +
      BUTTON_H +
      PANEL_PAD_BOTTOM;

    this.fit = fitModal(panelH);
    // In the fit's design space the viewport is wider than it looks, so a panel
    // shrunk to fit a short screen can use the width that frees up.
    const designWidth = w / this.fit.scale;
    const panelW = Math.min(PANEL_MAX_WIDTH, designWidth - PANEL_SIDE_MARGIN * 2);

    beginModalFit(ctx, this.fit);
    setButtonPointerSpace(this.fit.scale, this.fit.pivotX, this.fit.pivotY);

    const panel = drawModal(ctx, {
      canvasWidth: w,
      canvasHeight: h,
      width: panelW,
      height: panelH,
      fill: '#08021a',
      border: '#ffd700',
      borderWidth: PANEL_BORDER_WIDTH,
      radius: PANEL_RADIUS,
      glow: '#ffd700',
      glowBlur: PANEL_GLOW_BLUR,
      alpha,
    });
    this.renderRunes(ctx, panel, alpha, now);

    const innerX = panel.x + PANEL_PAD_X;
    const innerW = panel.width - PANEL_PAD_X * 2;
    const centreX = panel.x + panel.width / 2;
    let y = panel.y + PANEL_PAD_TOP;

    const headPulse = HEADING_PULSE_MIN + HEADING_PULSE_RANGE * Math.sin(now * HEADING_PULSE_FREQ);
    const headingFitSize = innerW / (HEADING_TEXT.length * MONO_CHAR_WIDTH_RATIO);
    drawText(ctx, HEADING_TEXT, {
      x: centreX,
      y,
      bold: true,
      size: Math.floor(Math.min(HEADING_MAX_SIZE, headingFitSize) * headPulse),
      color: '#ffd700',
      align: 'center',
      glow: '#ffd700',
      glowBlur: HEADING_GLOW_BLUR,
      outline: '#1a0a00',
      outlineWidth: HEADING_OUTLINE_WIDTH,
      alpha,
    });
    y += HEADING_BLOCK_H;

    drawText(ctx, SUBTITLE_TEXT, {
      x: centreX,
      y,
      size: SUBTITLE_SIZE,
      color: '#e9d5ff',
      align: 'center',
      glow: '#a855f7',
      glowBlur: SUBTITLE_GLOW_BLUR,
      alpha,
    });
    y += SUBTITLE_BLOCK_H;

    drawText(ctx, CAPTION_TEXT, {
      x: centreX,
      y,
      size: CAPTION_SIZE,
      color: '#94a3b8',
      align: 'center',
      alpha,
    });
    y += CAPTION_BLOCK_H;

    drawDivider(ctx, {
      x: panel.x + DIVIDER_INSET,
      y,
      length: panel.width - DIVIDER_INSET * 2,
      color: '#ffd700',
      alpha: alpha * DIVIDER_ALPHA,
    });
    y += SECTION_GAP;

    const columnW = (innerW - COLUMN_GAP) / 2;
    this.renderStatCard(ctx, innerX, y, columnW, cardH, RUN_COLUMN_TITLE, left, alpha);
    this.renderStatCard(
      ctx,
      innerX + columnW + COLUMN_GAP,
      y,
      columnW,
      cardH,
      PARTY_COLUMN_TITLE,
      right,
      alpha,
    );
    y += cardH + SECTION_GAP;

    this.renderKills(ctx, innerX, y, innerW, killsH, summary, killColumns, cardRows, alpha);
    y += killsH + BUTTON_MARGIN_TOP;

    this.renderButtons(ctx, centreX, y, innerW, alpha);

    resetButtonPointerSpace();
    endModalFit(ctx);
  }

  private rowFontSize(columnW: number): number {
    const usable = columnW - CARD_PAD_X * 2;
    return Math.min(ROW_MAX_FONT, Math.floor(usable / (ROW_CHAR_BUDGET * MONO_CHAR_WIDTH_RATIO)));
  }

  /** How far into its own reveal a row is: 0 before it starts, 1 once it has settled. */
  private rowReveal(index: number): { alpha: number; count: number } {
    const start = ROWS_START_FRAME + index * ROW_STAGGER_FRAMES;
    const elapsed = this.frame - start;
    const linear = clamp01(elapsed / COUNT_UP_FRAMES);
    return {
      alpha: clamp01(elapsed / ROW_FADE_FRAMES),
      count: 1 - Math.pow(1 - linear, COUNT_UP_EASE_POWER),
    };
  }

  private renderStatCard(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    title: string,
    rows: readonly StatRow[],
    alpha: number,
  ): void {
    drawBox(ctx, {
      x,
      y,
      width,
      height,
      fill: 'rgba(46, 16, 101, 0.55)',
      border: '#6d28d9',
      radius: CARD_RADIUS,
      alpha,
    });
    drawText(ctx, title, {
      x: x + width / 2,
      y: y + CARD_PAD_TOP,
      size: CARD_TITLE_SIZE,
      bold: true,
      color: '#fcd34d',
      align: 'center',
      alpha,
    });
    const fontSize = this.rowFontSize(width);
    let rowY = y + CARD_PAD_TOP + CARD_TITLE_H;
    rows.forEach((row, index) => {
      const reveal = this.rowReveal(index);
      if (reveal.alpha > 0) {
        drawText(ctx, row.label, {
          x: x + CARD_PAD_X,
          y: rowY + ROW_TEXT_TOP_INSET,
          size: fontSize,
          color: '#cbd5e1',
          alpha: alpha * reveal.alpha,
        });
        drawText(ctx, formatRowValue(row, reveal.count), {
          x: x + width - CARD_PAD_X,
          y: rowY + ROW_TEXT_TOP_INSET,
          size: fontSize,
          bold: true,
          color: row.color,
          align: 'right',
          alpha: alpha * reveal.alpha,
        });
      }
      rowY += ROW_H;
    });
  }

  private renderKills(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    width: number,
    height: number,
    summary: RunSummary,
    columns: number,
    rowsBefore: number,
    alpha: number,
  ): void {
    drawBox(ctx, {
      x,
      y,
      width,
      height,
      fill: 'rgba(46, 16, 101, 0.55)',
      border: '#6d28d9',
      radius: CARD_RADIUS,
      alpha,
    });
    drawText(ctx, KILLS_TITLE, {
      x: x + width / 2,
      y: y + CARD_PAD_TOP,
      size: CARD_TITLE_SIZE,
      bold: true,
      color: '#fcd34d',
      align: 'center',
      alpha,
    });
    const top = y + CARD_PAD_TOP + CARD_TITLE_H;
    const columnW = (width - COLUMN_GAP * (columns - 1)) / columns;
    // Sized as the stat cards above are, so a one-column list on a narrow
    // screen does not set its names larger than the numbers over them.
    const statCardW = (width - COLUMN_GAP) / 2;
    const fontSize = this.rowFontSize(statCardW);

    if (summary.topKills.length === 0) {
      const reveal = this.rowReveal(rowsBefore);
      drawText(ctx, NO_KILLS_TEXT, {
        x: x + width / 2,
        y: top + ROW_TEXT_TOP_INSET,
        size: fontSize,
        color: '#94a3b8',
        align: 'center',
        alpha: alpha * reveal.alpha,
      });
      return;
    }

    const rowsPerColumn = Math.ceil(summary.topKills.length / columns);
    const charW = fontSize * MONO_CHAR_WIDTH_RATIO;
    summary.topKills.forEach(([name, count], index) => {
      const column = Math.floor(index / rowsPerColumn);
      const row = index % rowsPerColumn;
      const reveal = this.rowReveal(rowsBefore + index);
      if (reveal.alpha <= 0) return;
      const cellX = x + column * (columnW + COLUMN_GAP);
      const rowY = top + row * ROW_H + ROW_TEXT_TOP_INSET;
      const countText = `×${formatCount(count * reveal.count)}`;
      const rank = `${index + 1}.`;
      const nameChars = Math.floor(
        (columnW - CARD_PAD_X * 2 - KILL_RANK_GAP) / charW - rank.length - countText.length - 1,
      );
      drawText(ctx, `${rank} ${fitToChars(name, nameChars)}`, {
        x: cellX + CARD_PAD_X,
        y: rowY,
        size: fontSize,
        color: index === 0 ? '#fde68a' : '#cbd5e1',
        bold: index === 0,
        alpha: alpha * reveal.alpha,
      });
      drawText(ctx, countText, {
        x: cellX + columnW - CARD_PAD_X,
        y: rowY,
        size: fontSize,
        bold: true,
        color: '#fbbf24',
        align: 'right',
        alpha: alpha * reveal.alpha,
      });
    });
  }

  private renderButtons(
    ctx: CanvasRenderingContext2D,
    centreX: number,
    y: number,
    innerW: number,
    alpha: number,
  ): void {
    const buttonAlpha = clamp01((this.frame - this.buttonsFrame) / BUTTON_FADE_FRAMES);
    if (buttonAlpha <= 0) {
      this.keepExploringButton = null;
      this.mainMenuButton = null;
      return;
    }
    const buttonW = Math.min(BUTTON_MAX_WIDTH, (innerW - BUTTON_GAP) / 2);
    const rowW = buttonW * 2 + BUTTON_GAP;
    const firstX = centreX - rowW / 2;

    // Opened here rather than at the top of `render`: the buttons fade in after
    // the count-up, and a ring declared before they exist would have nothing to
    // take an accept press but the skip.
    beginMenuFocus(RUN_COMPLETE_FOCUS_ID);
    this.keepExploringButton = drawButton(ctx, {
      x: firstX,
      y,
      width: buttonW,
      height: BUTTON_H,
      label: KEEP_EXPLORING_LABEL,
      ...BUTTON_PRESETS.gold,
      labelSize: BUTTON_LABEL_SIZE,
      glowBlur: BUTTON_GLOW_BLUR,
      alpha: buttonAlpha * alpha,
      primaryAction: true,
    });
    this.mainMenuButton = drawButton(ctx, {
      x: firstX + buttonW + BUTTON_GAP,
      y,
      width: buttonW,
      height: BUTTON_H,
      label: MAIN_MENU_LABEL,
      ...BUTTON_PRESETS.primary,
      labelSize: BUTTON_LABEL_SIZE,
      alpha: buttonAlpha * alpha,
    });
    endMenuFocus();
  }

  private renderRunes(
    ctx: CanvasRenderingContext2D,
    panel: { x: number; y: number; width: number; height: number },
    alpha: number,
    now: number,
  ): void {
    const runeAlpha = alpha * (RUNE_ALPHA_MIN + RUNE_ALPHA_RANGE * Math.sin(now * RUNE_PULSE_FREQ));
    const left = panel.x + RUNE_CORNER_INSET;
    const right = panel.x + panel.width - RUNE_CORNER_INSET;
    const top = panel.y + RUNE_CORNER_INSET;
    const bottom = panel.y + panel.height - RUNE_CORNER_INSET;
    ctx.save();
    ctx.globalAlpha = runeAlpha;
    ctx.strokeStyle = '#ffd700';
    ctx.lineWidth = RUNE_LINE_WIDTH;
    for (const [cx, cy, dx, dy] of [
      [left, top, 1, 1],
      [right, top, -1, 1],
      [left, bottom, 1, -1],
      [right, bottom, -1, -1],
    ] as const) {
      ctx.beginPath();
      ctx.moveTo(cx, cy + dy * RUNE_CORNER_LEN);
      ctx.lineTo(cx, cy);
      ctx.lineTo(cx + dx * RUNE_CORNER_LEN, cy);
      ctx.stroke();
    }
    ctx.restore();
  }

  private tickEffects(w: number, h: number): void {
    const cx = w / 2;
    const cy = h / 2;
    const ringBase = Math.min(w, h) * BURST_RING_MIN_FRACTION;
    const ringRange = Math.min(w, h) * BURST_RING_RANGE_FRACTION;
    const burstAround = (count: number): void => {
      const angle = Math.random() * FULL_TURN;
      const r = ringBase + Math.random() * ringRange;
      this.spawnBurst(cx + Math.cos(angle) * r, cy + Math.sin(angle) * r, count);
    };
    if (this.frame === 1) this.spawnBurst(cx, cy, FIRST_BURST_COUNT);
    if (this.frame < LATE_BURSTS_FROM_FRAME && this.frame % EARLY_BURST_INTERVAL === 0) {
      burstAround(EARLY_BURST_COUNT);
    }
    if (this.frame >= LATE_BURSTS_FROM_FRAME && this.frame % LATE_BURST_INTERVAL === 0) {
      burstAround(LATE_BURST_COUNT);
    }

    const confettiThisFrame =
      this.frame < CONFETTI_EARLY_FRAMES
        ? CONFETTI_PER_FRAME_EARLY
        : this.frame % CONFETTI_LATE_EVERY === 0
          ? CONFETTI_PER_FRAME_LATE
          : 0;
    for (let i = 0; i < confettiThisFrame; i++) this.spawnConfetti(w);

    for (const s of this.sparkles) {
      s.x += s.vx;
      s.y += s.vy;
      s.vy += SPARKLE_GRAVITY;
      s.vx *= SPARKLE_DRAG;
      s.life--;
    }
    this.sparkles = this.sparkles.filter((s) => s.life > 0);

    for (const c of this.confetti) {
      c.swayPhase += CONFETTI_SWAY_FREQ;
      c.x += c.vx + Math.sin(c.swayPhase) * CONFETTI_SWAY_AMPLITUDE;
      c.y += c.vy;
      c.angle += c.spin;
    }
    this.confetti = this.confetti.filter((c) => c.y < h + CONFETTI_SPAWN_ABOVE_PX);
  }

  private spawnBurst(cx: number, cy: number, count: number): void {
    for (let i = 0; i < count; i++) {
      const angle = Math.random() * FULL_TURN;
      const speed = SPARKLE_MIN_SPEED + Math.random() * SPARKLE_SPEED_RANGE;
      const maxLife = SPARKLE_MIN_LIFE + Math.floor(Math.random() * SPARKLE_LIFE_RANGE);
      this.sparkles.push({
        x: cx + (Math.random() - HALF) * SPARKLE_SPAWN_JITTER_PX,
        y: cy + (Math.random() - HALF) * SPARKLE_SPAWN_JITTER_PX,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - SPARKLE_MIN_SPEED,
        life: maxLife,
        maxLife,
        size: SPARKLE_MIN_SIZE + Math.random() * SPARKLE_SIZE_RANGE,
        color: pickColor(SPARKLE_COLORS),
        twinkleOffset: Math.random() * FULL_TURN,
      });
    }
  }

  private spawnConfetti(w: number): void {
    this.confetti.push({
      x: Math.random() * w,
      y: -CONFETTI_SPAWN_ABOVE_PX,
      vx: (Math.random() - HALF) * CONFETTI_DRIFT_RANGE,
      vy: CONFETTI_MIN_FALL + Math.random() * CONFETTI_FALL_RANGE,
      w: CONFETTI_MIN_W + Math.random() * CONFETTI_W_RANGE,
      h: CONFETTI_MIN_H + Math.random() * CONFETTI_H_RANGE,
      angle: Math.random() * FULL_TURN,
      spin: (Math.random() - HALF) * CONFETTI_SPIN_RANGE,
      swayPhase: Math.random() * FULL_TURN,
      color: pickColor(CONFETTI_COLORS),
    });
  }

  private renderRays(
    ctx: CanvasRenderingContext2D,
    w: number,
    h: number,
    alpha: number,
    now: number,
  ): void {
    const cx = w / 2;
    const cy = h / 2;
    const length = Math.max(w, h) * RAY_LENGTH_FRACTION;
    const spin = now * RAY_SPIN_PER_SECOND;
    ctx.save();
    ctx.globalAlpha = alpha * RAY_ALPHA;
    const gradient = ctx.createRadialGradient(cx, cy, 0, cx, cy, length);
    gradient.addColorStop(0, '#ffd700');
    gradient.addColorStop(1, 'rgba(255, 215, 0, 0)');
    ctx.fillStyle = gradient;
    for (let i = 0; i < RAY_COUNT; i++) {
      const angle = spin + (i / RAY_COUNT) * FULL_TURN;
      ctx.beginPath();
      ctx.moveTo(cx, cy);
      ctx.arc(cx, cy, length, angle - RAY_HALF_WIDTH_RADIANS, angle + RAY_HALF_WIDTH_RADIANS);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  }

  private renderConfetti(ctx: CanvasRenderingContext2D, alpha: number): void {
    ctx.save();
    ctx.globalAlpha = alpha * CONFETTI_ALPHA;
    for (const c of this.confetti) {
      ctx.save();
      ctx.translate(c.x, c.y);
      ctx.rotate(c.angle);
      ctx.fillStyle = c.color;
      const flippedH = c.h * Math.cos(c.angle * CONFETTI_FLIP_RATE);
      ctx.fillRect(-c.w / 2, -flippedH / 2, c.w, flippedH);
      ctx.restore();
    }
    ctx.restore();
  }

  private renderSparkles(ctx: CanvasRenderingContext2D, alpha: number, now: number): void {
    ctx.save();
    for (const s of this.sparkles) {
      const lifeRatio = s.life / s.maxLife;
      const twinkle = TWINKLE_BASE + TWINKLE_RANGE * Math.sin(now * TWINKLE_FREQ + s.twinkleOffset);
      ctx.globalAlpha = clamp01(lifeRatio * twinkle * alpha);
      ctx.shadowColor = s.color;
      ctx.shadowBlur = s.size * SPARKLE_GLOW_MULTIPLIER;
      ctx.fillStyle = s.color;
      ctx.beginPath();
      ctx.arc(s.x, s.y, s.size * lifeRatio, 0, FULL_TURN);
      ctx.fill();
    }
    ctx.restore();
  }
}
