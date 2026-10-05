/**
 * The end of the game: the party is down the escape stairwell and out of the
 * city. Light rays, fireworks and confetti behind a panel whose numbers count
 * up row by row, then a choice to keep walking the town or leave for the menu.
 *
 * The timeline advances one step per render frame, because the screen owns
 * the world beneath it, which is halted.
 *
 * - Band `modal`; halts the world and locks the keyboard.
 * - Escape is blocked: the only ways on are its two buttons.
 * - Before the buttons are up, a tap anywhere skips straight to the finished
 *   record (silently), so nobody sits through the count-up twice to find a
 *   button. Keys do not skip.
 * - Once they are up, Enter or Space presses Keep Exploring (the primary
 *   control); Tab and the arrows move to Main Menu. A tap anywhere else does
 *   nothing.
 */

import type { AchievementManager } from '../../../core/AchievementManager';
import { formatPlayTime, type GameStats } from '../../../core/GameStats';
import { centerIn, splitH, splitV, type Rect } from '../../core/geom';
import type { Surface, Ui } from '../../core/UiRoot';
import { withAlpha } from '../../theme/color';
import { skinsFor } from '../../theme/skins';
import type { Theme } from '../../theme/tokens';
import { button, buttonHeight } from '../../widgets/button';
import { card } from '../../widgets/card';
import { panel, panelBodyMaxHeight, panelBodyWidth } from '../../widgets/panel';
import { scrollGutterWidth, scrollView } from '../../widgets/scrollView';
import { lineHeightOf, measureText, text } from '../../widgets/text';
import {
  clamp01,
  Confetti,
  confettiColors,
  drawBackdrop,
  drawDivider,
  drawRays,
  drawRuneCorners,
  glowText,
  headlineStyle,
  seconds,
  sparkleColors,
  Sparkles,
} from './endScreenParts';

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
  screen: Pick<RunCompleteScreen, 'activate'>,
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

const HEADLINE = 'CONGRATULATIONS';
const SUBTITLE = 'You escaped the city.';
const CAPTION = 'Run complete — progress saved.';
const RUN_COLUMN_TITLE = 'THE RUN';
const PARTY_COLUMN_TITLE = 'THE PARTY';
const KILLS_TITLE = 'MOST SLAIN';
const KEEP_EXPLORING_LABEL = 'Keep Exploring';
const MAIN_MENU_LABEL = 'Main Menu';
const NO_KILLS_TEXT = 'Nothing. Not one thing.';

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
const OVERLAY_ALPHA = 0.82;

const FIRST_BURST_COUNT = 50;
const EARLY_BURST_INTERVAL = 8;
const EARLY_BURST_COUNT = 10;
const LATE_BURST_INTERVAL = 22;
const LATE_BURST_COUNT = 6;
const LATE_BURSTS_FROM_FRAME = 240;
/** Bursts go off in a ring round the screen centre, never behind the numbers. */
const BURST_RING_MIN_FRACTION = 0.3;
const BURST_RING_RANGE_FRACTION = 0.2;
const CONFETTI_PER_FRAME_EARLY = 3;
const CONFETTI_PER_FRAME_LATE = 1;
const CONFETTI_EARLY_FRAMES = 180;
/** Late confetti falls only on every Nth frame, so it thins to a drizzle. */
const CONFETTI_LATE_EVERY = 3;

const HEADLINE_PULSE_MIN = 0.96;
const HEADLINE_PULSE_RANGE = 0.04;
const HEADLINE_PULSE_FREQ = 2.4;
const HEADLINE_GLOW_ALPHA = 0.6;
const DIVIDER_ALPHA = 0.4;
/** Narrower than this, the two stat cards stack instead of standing side by side. */
const STAT_COLUMN_MIN_WIDTH = 200;
/** Narrower than this, the kills list is one column. */
const KILLS_TWO_COLUMN_MIN_WIDTH = 440;
const BUTTON_MAX_WIDTH = 220;

type StatFormat = 'count' | 'clock' | 'fraction';

/** The palette colour a stat's value is set in. */
type StatTone =
  | 'plain'
  | 'muted'
  | 'danger'
  | 'success'
  | 'warning'
  | 'gold'
  | 'magic'
  | 'boss'
  | 'human'
  | 'cat'
  | 'hurt';

function toneColor(theme: Theme, tone: StatTone): string {
  const { palette } = theme;
  switch (tone) {
    case 'plain':
      return palette.text.primary;
    case 'muted':
      return palette.text.secondary;
    case 'danger':
      return palette.state.danger;
    case 'success':
      return palette.state.success;
    case 'warning':
      return palette.state.warning;
    case 'gold':
      return palette.accent.base;
    case 'magic':
      return palette.category.book;
    case 'boss':
      return palette.meter.boss;
    case 'human':
      return palette.crawler.human;
    case 'cat':
      return palette.crawler.cat;
    case 'hurt':
      return palette.meter.hpLow;
  }
}

interface StatRow {
  readonly label: string;
  readonly value: number;
  readonly format: StatFormat;
  readonly tone: StatTone;
  /** For 'fraction' rows, the fixed denominator. */
  readonly outOf?: number;
}

function formatCount(value: number): string {
  return Math.round(value).toLocaleString('en-US');
}

function runRows(summary: RunSummary): StatRow[] {
  return [
    { label: 'Time played', value: summary.framesPlayed, format: 'clock', tone: 'plain' },
    { label: 'Deaths', value: summary.deaths, format: 'count', tone: 'danger' },
    { label: 'Damage dealt', value: summary.damageDealt, format: 'count', tone: 'cat' },
    { label: 'Damage taken', value: summary.damageTaken, format: 'count', tone: 'hurt' },
    { label: 'Potions used', value: summary.potionsUsed, format: 'count', tone: 'success' },
    { label: 'Gold earned', value: summary.goldEarned, format: 'count', tone: 'gold' },
    {
      label: 'Achievements',
      value: summary.achievementsUnlocked,
      format: 'fraction',
      outOf: summary.achievementsTotal,
      tone: 'magic',
    },
  ];
}

function partyRows(summary: RunSummary): StatRow[] {
  const rows: StatRow[] = [
    { label: 'Human level', value: summary.humanLevel, format: 'count', tone: 'human' },
    { label: 'Cat level', value: summary.catLevel, format: 'count', tone: 'cat' },
  ];
  if (summary.mongoLevel !== null) {
    rows.push({
      label: 'Mongo level',
      value: summary.mongoLevel,
      format: 'count',
      tone: 'success',
    });
  }
  rows.push(
    { label: 'Total kills', value: summary.totalKills, format: 'count', tone: 'warning' },
    { label: 'Bosses slain', value: summary.bossesDefeated, format: 'count', tone: 'boss' },
    { label: 'Hirelings hired', value: summary.hirelingsHired, format: 'count', tone: 'plain' },
    { label: 'Hirelings lost', value: summary.hirelingsLost, format: 'count', tone: 'muted' },
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

interface Reveal {
  readonly alpha: number;
  readonly count: number;
}

/** Where everything in the scrolling part of the panel goes, at one width. */
interface RunLayout {
  readonly height: number;
  readonly stacked: boolean;
  readonly killColumns: number;
  readonly cardRows: number;
  readonly killRows: number;
}

/** The model the scene holds: raised with {@link activate}, drawn by {@link surface}. */
export class RunCompleteScreen {
  private active = false;
  private frame = 0;
  private summary: RunSummary | null = null;
  private handlers: RunCompleteHandlers | null = null;
  private readonly sparkles = new Sparkles();
  private readonly confetti = new Confetti();

  get isActive(): boolean {
    return this.active;
  }

  activate(summary: RunSummary, handlers: RunCompleteHandlers): void {
    this.active = true;
    this.frame = 0;
    this.summary = summary;
    this.handlers = handlers;
    this.sparkles.clear();
    this.confetti.clear();
  }

  /** Frames until the buttons start to fade in, which is also when the count-up has settled. */
  private get buttonsFrame(): number {
    const summary = this.summary;
    if (summary === null) return 0;
    const longestColumn = Math.max(runRows(summary).length, partyRows(summary).length);
    const killRows = Math.max(1, summary.topKills.length);
    return (
      ROWS_START_FRAME +
      (longestColumn + killRows) * ROW_STAGGER_FRAMES +
      COUNT_UP_FRAMES +
      BUTTONS_DELAY_AFTER_ROWS_FRAMES
    );
  }

  /** Jumps to the finished record, as a press during the count-up does. */
  skip(): void {
    if (this.active && this.frame < this.buttonsFrame) this.frame = this.buttonsFrame;
  }

  private close(then: (() => void) | undefined): void {
    this.active = false;
    this.summary = null;
    this.handlers = null;
    this.sparkles.clear();
    this.confetti.clear();
    then?.();
  }

  private rowReveal(index: number): Reveal {
    const elapsed = this.frame - (ROWS_START_FRAME + index * ROW_STAGGER_FRAMES);
    const linear = clamp01(elapsed / COUNT_UP_FRAMES);
    return {
      alpha: clamp01(elapsed / ROW_FADE_FRAMES),
      count: 1 - Math.pow(1 - linear, COUNT_UP_EASE_POWER),
    };
  }

  private tickEffects(ui: Ui): void {
    const area = ui.screen;
    const cx = area.x + area.w / 2;
    const cy = area.y + area.h / 2;
    const shorter = Math.min(area.w, area.h);
    const ring = {
      min: shorter * BURST_RING_MIN_FRACTION,
      range: shorter * BURST_RING_RANGE_FRACTION,
    };
    const colors = sparkleColors(ui.theme);
    if (this.frame === 1) this.sparkles.burst(cx, cy, FIRST_BURST_COUNT, colors);
    if (this.frame < LATE_BURSTS_FROM_FRAME && this.frame % EARLY_BURST_INTERVAL === 0) {
      this.sparkles.burstAround(cx, cy, ring, EARLY_BURST_COUNT, colors);
    }
    if (this.frame >= LATE_BURSTS_FROM_FRAME && this.frame % LATE_BURST_INTERVAL === 0) {
      this.sparkles.burstAround(cx, cy, ring, LATE_BURST_COUNT, colors);
    }
    const confettiThisFrame =
      this.frame < CONFETTI_EARLY_FRAMES
        ? CONFETTI_PER_FRAME_EARLY
        : this.frame % CONFETTI_LATE_EVERY === 0
          ? CONFETTI_PER_FRAME_LATE
          : 0;
    const pieceColors = confettiColors(ui.theme);
    for (let i = 0; i < confettiThisFrame; i++) this.confetti.spawn(area, pieceColors);
    this.sparkles.tick();
    this.confetti.tick(area);
  }

  private layout(ui: Ui, summary: RunSummary, width: number): RunLayout {
    const { space } = ui.theme;
    const headline = headlineStyle(ui, HEADLINE, width).lineHeight;
    const stacked = (width - space.md) / 2 < STAT_COLUMN_MIN_WIDTH;
    const runCount = runRows(summary).length;
    const partyCount = partyRows(summary).length;
    const cardRows = Math.max(runCount, partyCount);
    const killColumns = width < KILLS_TWO_COLUMN_MIN_WIDTH ? 1 : 2;
    const killRows = Math.max(1, Math.ceil(summary.topKills.length / killColumns));
    const statsH = stacked
      ? cardHeight(ui, runCount) + space.md + cardHeight(ui, partyCount)
      : cardHeight(ui, cardRows);
    const tracks = [
      headline,
      lineHeightOf(ui, 'title'),
      lineHeightOf(ui, 'muted'),
      space.sm,
      statsH,
      cardHeight(ui, killRows),
    ];
    const height = tracks.reduce((sum, h) => sum + h, 0) + space.sm * (tracks.length - 1);
    return { height, stacked, killColumns, cardRows, killRows };
  }

  private statRows(ui: Ui, body: Rect, rows: readonly StatRow[]): void {
    const rowH = statRowHeight(ui);
    rows.forEach((row, index) => {
      const reveal = this.rowReveal(index);
      if (reveal.alpha <= 0) return;
      const rect: Rect = { x: body.x, y: body.y + index * rowH, w: body.w, h: rowH };
      ui.ctx.save();
      ui.ctx.globalAlpha *= reveal.alpha;
      const value = formatRowValue(row, reveal.count);
      const valueW = measureText(ui, value, { role: 'label', tabular: true });
      const [labelRect, valueRect] = splitH(rect, ['fill', valueW], ui.theme.space.sm);
      text(ui, labelRect, { text: row.label, role: 'secondary' });
      text(ui, valueRect, {
        text: value,
        role: 'label',
        color: toneColor(ui.theme, row.tone),
        align: 'right',
        tabular: true,
      });
      ui.ctx.restore();
    });
  }

  private killRowsDraw(
    ui: Ui,
    body: Rect,
    summary: RunSummary,
    columns: number,
    rowsBefore: number,
  ): void {
    const { palette, space } = ui.theme;
    const rowH = statRowHeight(ui);
    if (summary.topKills.length === 0) {
      const reveal = this.rowReveal(rowsBefore);
      ui.ctx.save();
      ui.ctx.globalAlpha *= reveal.alpha;
      text(ui, { ...body, h: rowH }, { text: NO_KILLS_TEXT, role: 'muted', align: 'center' });
      ui.ctx.restore();
      return;
    }
    const rowsPerColumn = Math.ceil(summary.topKills.length / columns);
    const cells = splitH(
      body,
      Array.from({ length: columns }, () => 'fill' as const),
      space.lg,
    );
    summary.topKills.forEach(([name, count], index) => {
      const reveal = this.rowReveal(rowsBefore + index);
      if (reveal.alpha <= 0) return;
      const column = cells[Math.floor(index / rowsPerColumn)];
      const rect: Rect = {
        x: column.x,
        y: column.y + (index % rowsPerColumn) * rowH,
        w: column.w,
        h: rowH,
      };
      const countText = `×${formatCount(count * reveal.count)}`;
      const countW = measureText(ui, countText, { role: 'label', tabular: true });
      const [nameRect, countRect] = splitH(rect, ['fill', countW], space.sm);
      const first = index === 0;
      ui.ctx.save();
      ui.ctx.globalAlpha *= reveal.alpha;
      text(ui, nameRect, {
        text: `${index + 1}. ${name}`,
        role: first ? 'label' : 'secondary',
        color: first ? palette.accent.hover : undefined,
      });
      text(ui, countRect, {
        text: countText,
        role: 'label',
        color: palette.state.warning,
        align: 'right',
        tabular: true,
      });
      ui.ctx.restore();
    });
  }

  private drawScrolling(
    ui: Ui,
    area: Rect,
    summary: RunSummary,
    laid: RunLayout,
    now: number,
  ): void {
    const { theme } = ui;
    const { palette, space } = theme;
    const headline = headlineStyle(ui, HEADLINE, area.w);
    const run = runRows(summary);
    const party = partyRows(summary);
    const runCardH = cardHeight(ui, run.length);
    const partyCardH = cardHeight(ui, party.length);
    const statsH = laid.stacked ? runCardH + space.md + partyCardH : cardHeight(ui, laid.cardRows);
    const [headRow, subtitleRow, captionRow, dividerRow, statsRow, killsRow] = splitV(
      area,
      [
        headline.lineHeight,
        lineHeightOf(ui, 'title'),
        lineHeightOf(ui, 'muted'),
        space.sm,
        statsH,
        cardHeight(ui, laid.killRows),
      ],
      space.sm,
    );
    const pulse = HEADLINE_PULSE_MIN + HEADLINE_PULSE_RANGE * Math.sin(now * HEADLINE_PULSE_FREQ);
    const { ctx } = ui;
    const headCx = headRow.x + headRow.w / 2;
    const headCy = headRow.y + headRow.h / 2;
    ctx.save();
    ctx.translate(headCx, headCy);
    ctx.scale(pulse, pulse);
    ctx.translate(-headCx, -headCy);
    glowText(ui, headRow, {
      text: HEADLINE,
      style: headline,
      color: palette.accent.base,
      glow: withAlpha(palette.accent.base, HEADLINE_GLOW_ALPHA),
      glowBlur: space.xl,
    });
    ctx.restore();
    text(ui, subtitleRow, { text: SUBTITLE, role: 'title', align: 'center' });
    text(ui, captionRow, { text: CAPTION, role: 'muted', align: 'center' });
    drawDivider(ui, dividerRow, withAlpha(palette.accent.base, DIVIDER_ALPHA), space.xxl);

    const [runRect, partyRect] = laid.stacked
      ? splitV(statsRow, [runCardH, partyCardH], space.md)
      : splitH(statsRow, ['fill', 'fill'], space.md);
    card(ui, runRect, {
      id: 'run',
      overline: RUN_COLUMN_TITLE,
      accent: palette.accent.base,
      content: (body) => this.statRows(ui, body, run),
    });
    card(ui, partyRect, {
      id: 'party',
      overline: PARTY_COLUMN_TITLE,
      accent: palette.accent.base,
      content: (body) => this.statRows(ui, body, party),
    });
    card(ui, killsRow, {
      id: 'kills',
      overline: KILLS_TITLE,
      accent: palette.accent.base,
      content: (body) => this.killRowsDraw(ui, body, summary, laid.killColumns, laid.cardRows),
    });
  }

  private drawButtons(ui: Ui, row: Rect, handlers: RunCompleteHandlers | null): void {
    const buttonAlpha = clamp01((this.frame - this.buttonsFrame) / BUTTON_FADE_FRAMES);
    if (buttonAlpha <= 0) return;
    const { space } = ui.theme;
    const buttonW = Math.min(BUTTON_MAX_WIDTH, (row.w - space.md) / 2);
    const group = centerIn(row, buttonW * 2 + space.md, row.h);
    const [keepRect, menuRect] = splitH(group, [buttonW, buttonW], space.md);
    ui.ctx.save();
    ui.ctx.globalAlpha *= buttonAlpha;
    button(ui, keepRect, {
      id: 'keep-exploring',
      label: KEEP_EXPLORING_LABEL,
      variant: 'primary',
      size: 'lg',
      primary: true,
      onTap: () => this.close(handlers?.onKeepExploring),
    });
    button(ui, menuRect, {
      id: 'main-menu',
      label: MAIN_MENU_LABEL,
      variant: 'secondary',
      size: 'lg',
      onTap: () => this.close(handlers?.onMainMenu),
    });
    ui.ctx.restore();
  }

  private render(ui: Ui): void {
    const summary = this.summary;
    if (!this.active || summary === null) return;
    this.frame++;
    this.tickEffects(ui);
    const { ctx, theme } = ui;
    const { palette, space } = theme;
    const now = seconds(ui);
    const alpha = clamp01(this.frame / FADE_IN_FRAMES);

    drawBackdrop(ui, alpha * OVERLAY_ALPHA);
    drawRays(ctx, ui.screen, palette.accent.base, alpha, now);
    this.confetti.draw(ctx, alpha);
    this.sparkles.draw(ctx, alpha, now);

    if (alpha >= PANEL_ALPHA_THRESHOLD) {
      const buttonRowH = buttonHeight(ui, 'lg');
      const bodyW = panelBodyWidth(ui, 'lg');
      const maxBody = panelBodyMaxHeight(ui, { width: 'lg' });
      let laid = this.layout(ui, summary, bodyW);
      const scroll = laid.height + space.lg + buttonRowH > maxBody;
      if (scroll) laid = this.layout(ui, summary, bodyW - scrollGutterWidth(ui));
      const handlers = this.handlers;
      ctx.save();
      ctx.globalAlpha *= alpha;
      const p = panel(ui, {
        id: 'run-complete',
        width: 'lg',
        height: 'content',
        contentHeight: laid.height + space.lg + buttonRowH,
        scrim: false,
        content: (body: Rect) => {
          const [scrollRect, buttonRow] = splitV(body, ['fill', buttonRowH], space.lg);
          if (scroll) {
            scrollView(ui, scrollRect, {
              id: 'run-complete/stats',
              contentHeight: laid.height,
              draw: (content) => this.drawScrolling(ui, content, summary, laid, now),
            });
          } else {
            this.drawScrolling(ui, scrollRect, summary, laid, now);
          }
          this.drawButtons(ui, buttonRow, handlers);
        },
      });
      drawRuneCorners(ctx, p.frame, palette.accent.base, now);
      ctx.restore();
    }

    if (this.frame < this.buttonsFrame) {
      ui.hit('skip', ui.screen, { onTap: () => this.skip(), focusable: false, sound: null });
    }
  }

  /** This screen as a surface. */
  surface(opts: { readonly id?: string } = {}): Surface {
    return {
      id: opts.id ?? 'run-complete',
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      blocksEscape: true,
      isOpen: () => this.active,
      render: (ui) => this.render(ui),
    };
  }
}

function statRowHeight(ui: Ui): number {
  return lineHeightOf(ui, 'secondary') + ui.theme.space.xxs;
}

/** A stat card holding `rows` rows: its padding, overline and rows. */
function cardHeight(ui: Ui, rows: number): number {
  const padding = skinsFor(ui.theme).panel.raised.padding;
  return padding * 2 + lineHeightOf(ui, 'overline') + ui.theme.space.xxs + rows * statRowHeight(ui);
}
