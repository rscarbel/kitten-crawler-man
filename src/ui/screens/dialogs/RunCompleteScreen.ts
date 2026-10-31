/**
 * Floor 3's run end: the town square's stairwell, opened. Light rays,
 * fireworks and confetti behind a panel holding the party (each crawler's
 * level, attributes and gear) and the run's numbers, which count up row by
 * row; then the choice to stay in Taloncrest or begin a new game carrying
 * everything.
 *
 * The timeline advances one step per render frame, because the screen owns
 * the world beneath it, which is halted.
 *
 * - Band `modal`; halts the world and locks the keyboard.
 * - Escape stays: the screen closes and the party keeps playing floor 3.
 * - Before the buttons are up, a tap anywhere skips straight to the finished
 *   record (silently), so nobody sits through the count-up twice to find a
 *   button. Keys do not skip.
 * - Once they are up, Enter presses Stay in Taloncrest (the primary control).
 *   Begin a new game asks first, in a confirmation of its own over this one.
 */

import { crawlerDisplayName } from '../../../characters/characters';
import { ITEM_DEF } from '../../../core/items/defs/ItemDefs';
import { ALL_STATS, STAT_DEFS, zeroStats, type StatId } from '../../../core/party/stats';
import type { AchievementManager } from '../../../core/progression/AchievementManager';
import type { Player } from '../../../Player';
import type { CrawlerKind } from '../../../core/skills/SkillManager';
import type { GameStats } from '../../../core/progression/GameStats';
import { centerIn, splitH, splitV, type Rect } from '../../core/geom';
import { ACTIVATE_KEYS, type Surface, type Ui } from '../../core/UiRoot';
import { withAlpha } from '../../theme/color';
import { skinsFor } from '../../theme/skins';
import { button, buttonHeight, measureButton } from '../../widgets/button';
import { card } from '../../widgets/card';
import { choiceModalSurface } from '../../widgets/choiceModal';
import { panel, panelBodyMaxHeight, panelBodyWidth } from '../../widgets/panel';
import { scrollGutterWidth, scrollView } from '../../widgets/scrollView';
import { lineHeightOf, measureText, measureTextHeight, text } from '../../widgets/text';
import { formatRunStat, runStatLines, type RunStatLine } from '../runStatLines';
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

/** One crawler as the run left them. */
export interface CrawlerRecord {
  readonly crawler: CrawlerKind;
  readonly name: string;
  readonly level: number;
  /** Each attribute's value, equipment and boosts included, as the Attributes tab shows it. */
  readonly stats: Readonly<Record<StatId, number>>;
  /** The names of what they have equipped. */
  readonly gear: readonly string[];
}

/**
 * Everything the run end screen reports, frozen the moment the party stepped
 * into the stairwell: the screen is a record, and must not keep ticking while
 * it is up.
 */
export interface RunSummary {
  readonly crawlers: readonly [CrawlerRecord, CrawlerRecord];
  readonly lines: readonly RunStatLine[];
  readonly topKills: ReadonlyArray<readonly [string, number]>;
}

/** What the two choices do; the scene owns both routes. */
export interface RunEndChoices {
  /** Stay on floor 3: the screen has closed, and the stairwell stays open. */
  readonly onStay: () => void;
  /** The new game was confirmed. */
  readonly onNewGame: () => void;
}

/** How many creatures the "most slain" block names. */
export const RUN_SUMMARY_TOP_KILLS = 5;

/** What {@link buildRunSummary} reads, gathered by the scene. */
export interface RunSummaryInput {
  readonly stats: GameStats;
  /** The floor the run ends on, which is also how many floors it has cleared. */
  readonly floorNumber: number;
  readonly achievements: { readonly unlocked: number; readonly total: number };
  readonly crawlers: readonly [CrawlerRecord, CrawlerRecord];
}

/** The crawler as the run leaves them: their attributes as the Attributes tab shows them, and their gear by name. */
export function crawlerRecord(
  player: Pick<Player, 'level' | 'statValue' | 'inventory'>,
  crawler: CrawlerKind,
): CrawlerRecord {
  const stats = zeroStats();
  for (const stat of ALL_STATS) stats[stat] = player.statValue(stat);
  const gear = [...player.inventory.equipment.equippedIds()].map((id) => ITEM_DEF[id].name);
  return { crawler, name: crawlerDisplayName(crawler), level: player.level, stats, gear };
}

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

/** The run as the screen shows it: the Stats tab's rows, then the floors and achievements. */
export function buildRunSummary(input: RunSummaryInput): RunSummary {
  const { stats, floorNumber, achievements } = input;
  return {
    crawlers: input.crawlers,
    lines: [
      ...runStatLines(stats, floorNumber),
      { label: 'Floors Cleared', value: floorNumber, format: { kind: 'count' }, role: 'value' },
      {
        label: 'Achievements',
        value: achievements.unlocked,
        format: { kind: 'outOf', total: achievements.total },
        role: 'accent',
      },
    ],
    topKills: stats.topKills(RUN_SUMMARY_TOP_KILLS),
  };
}

const HEADLINE = 'RUN COMPLETE';
const SUBTITLE = 'The stairwell under Taloncrest is open.';
const CAPTION = 'Stay on this floor, or begin again on Floor 1 with everything you carry.';
const RUN_COLUMN_TITLE = 'THE RUN';
const KILLS_TITLE = 'MOST SLAIN';
const STAY_LABEL = 'Stay in Taloncrest';
const NEW_GAME_LABEL = 'Begin a new game';
const NO_KILLS_TEXT = 'Nothing. Not one thing.';
const NO_GEAR_TEXT = 'Nothing equipped';

const CONFIRM_TITLE = 'Start again on Floor 1 with everything you carry?';
const CONFIRM_BODY = 'The world, the quests and the story begin again.';
const CONFIRM_LABEL = 'Begin a new game';
const CANCEL_LABEL = 'Cancel';
const CONFIRM_CANCEL_INDEX = 0;

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
/** Narrower than this, the two crawler cards stack instead of standing side by side. */
const CRAWLER_COLUMN_MIN_WIDTH = 220;
/** Narrower than this, the run's rows and the kills list are one column each. */
const TWO_COLUMN_MIN_WIDTH = 440;
const BUTTON_MAX_WIDTH = 240;
const BUTTON_COUNT = 2;

/** A crawler card's rows before its gear: the level, then one per attribute. */
const CRAWLER_HEADER_ROWS = 1;

interface Reveal {
  readonly alpha: number;
  readonly count: number;
}

/** Where everything in the scrolling part of the panel goes, at one width. */
interface RunLayout {
  readonly height: number;
  readonly crawlersStacked: boolean;
  readonly columns: number;
  readonly crawlerRows: readonly [number, number];
  readonly runRows: number;
  readonly killRows: number;
}

function crawlerRowCount(record: CrawlerRecord): number {
  return CRAWLER_HEADER_ROWS + ALL_STATS.length + Math.max(1, record.gear.length);
}

function subtitleHeight(ui: Ui, width: number): number {
  return measureTextHeight(ui, width, { text: SUBTITLE, role: 'title' });
}

function captionHeight(ui: Ui, width: number): number {
  return measureTextHeight(ui, width, { text: CAPTION, role: 'muted' });
}

/** Whether the two buttons stack, because side by side either label would not fit its half. */
function buttonsStack(ui: Ui, width: number): boolean {
  const widest = Math.max(
    measureButton(ui, { label: STAY_LABEL, size: 'lg' }),
    measureButton(ui, { label: NEW_GAME_LABEL, size: 'lg' }),
  );
  return widest * BUTTON_COUNT + ui.theme.space.md > width;
}

function buttonRowHeight(ui: Ui, width: number): number {
  const buttonH = buttonHeight(ui, 'lg');
  return buttonsStack(ui, width) ? buttonH * BUTTON_COUNT + ui.theme.space.sm : buttonH;
}

function statRowHeight(ui: Ui): number {
  return lineHeightOf(ui, 'secondary') + ui.theme.space.xxs;
}

/** A card holding `rows` rows: its padding, overline and rows. */
function cardHeight(ui: Ui, rows: number): number {
  const padding = skinsFor(ui.theme).panel.raised.padding;
  return padding * 2 + lineHeightOf(ui, 'overline') + ui.theme.space.xxs + rows * statRowHeight(ui);
}

/** The model the scene holds: raised with {@link activate}, drawn by {@link surfaces}. */
export class RunCompleteScreen {
  private active = false;
  private confirming = false;
  private frame = 0;
  private summary: RunSummary | null = null;
  private choices: RunEndChoices | null = null;
  private readonly sparkles = new Sparkles();
  private readonly confetti = new Confetti();

  get isActive(): boolean {
    return this.active;
  }

  activate(summary: RunSummary, choices: RunEndChoices): void {
    this.active = true;
    this.confirming = false;
    this.frame = 0;
    this.summary = summary;
    this.choices = choices;
    this.sparkles.clear();
    this.confetti.clear();
  }

  /** Rows in the party block: the longer crawler card's. */
  private partyRows(summary: RunSummary): number {
    return Math.max(...summary.crawlers.map(crawlerRowCount));
  }

  /** Frames until the buttons start to fade in, which is also when the count-up has settled. */
  private get buttonsFrame(): number {
    const summary = this.summary;
    if (summary === null) return 0;
    const killRows = Math.max(1, summary.topKills.length);
    const rows = this.partyRows(summary) + summary.lines.length + killRows;
    return (
      ROWS_START_FRAME +
      rows * ROW_STAGGER_FRAMES +
      COUNT_UP_FRAMES +
      BUTTONS_DELAY_AFTER_ROWS_FRAMES
    );
  }

  /** Whether the record is still counting up, before its buttons appear. */
  private get counting(): boolean {
    return this.active && this.frame < this.buttonsFrame;
  }

  /** Jumps to the finished record, as a press during the count-up does. */
  skip(): void {
    if (this.active && this.frame < this.buttonsFrame) this.frame = this.buttonsFrame;
  }

  private close(): RunEndChoices | null {
    const choices = this.choices;
    this.active = false;
    this.confirming = false;
    this.summary = null;
    this.choices = null;
    this.sparkles.clear();
    this.confetti.clear();
    return choices;
  }

  /** Closes the screen with the party staying on the floor: the default, and Escape. */
  stay(): void {
    if (!this.active) return;
    this.close()?.onStay();
  }

  private askNewGame(): void {
    this.confirming = true;
  }

  private cancelNewGame(): void {
    this.confirming = false;
  }

  private confirmNewGame(): void {
    this.close()?.onNewGame();
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
    const crawlersStacked = (width - space.md) / 2 < CRAWLER_COLUMN_MIN_WIDTH;
    const columns = width < TWO_COLUMN_MIN_WIDTH ? 1 : 2;
    const [first, second] = summary.crawlers;
    const crawlerRows: readonly [number, number] = [
      crawlerRowCount(first),
      crawlerRowCount(second),
    ];
    const partyH = crawlersStacked
      ? cardHeight(ui, crawlerRows[0]) + space.md + cardHeight(ui, crawlerRows[1])
      : cardHeight(ui, Math.max(...crawlerRows));
    const runRows = Math.ceil(summary.lines.length / columns);
    const killRows = Math.max(1, Math.ceil(summary.topKills.length / columns));
    const tracks = [
      headline,
      subtitleHeight(ui, width),
      captionHeight(ui, width),
      space.sm,
      partyH,
      cardHeight(ui, runRows),
      cardHeight(ui, killRows),
    ];
    const height = tracks.reduce((sum, h) => sum + h, 0) + space.sm * (tracks.length - 1);
    return { height, crawlersStacked, columns, crawlerRows, runRows, killRows };
  }

  /** A label and its value on one row, faded and counted up by its place in the reveal. */
  private valueRow(ui: Ui, rect: Rect, revealIndex: number, row: ValueRow): void {
    const reveal = this.rowReveal(revealIndex);
    if (reveal.alpha <= 0) return;
    const value = row.value(reveal.count);
    const valueW = measureText(ui, value, { role: 'label', tabular: true });
    const [labelRect, valueRect] = splitH(rect, ['fill', valueW], ui.theme.space.sm);
    ui.ctx.save();
    ui.ctx.globalAlpha *= reveal.alpha;
    text(ui, labelRect, { text: row.label, role: 'secondary' });
    text(ui, valueRect, {
      text: value,
      role: 'label',
      color: row.color,
      align: 'right',
      tabular: true,
    });
    ui.ctx.restore();
  }

  private crawlerCard(ui: Ui, rect: Rect, record: CrawlerRecord): void {
    const { palette } = ui.theme;
    const accent = palette.crawler[record.crawler];
    const value = palette.text.primary;
    card(ui, rect, {
      id: `crawler/${record.crawler}`,
      overline: record.name,
      accent,
      content: (body) => {
        const rowH = statRowHeight(ui);
        const at = (index: number): Rect => ({
          x: body.x,
          y: body.y + index * rowH,
          w: body.w,
          h: rowH,
        });
        this.valueRow(ui, at(0), 0, {
          label: 'Level',
          color: accent,
          value: (progress) => countUp(record.level, progress),
        });
        ALL_STATS.forEach((stat, index) => {
          const row = CRAWLER_HEADER_ROWS + index;
          this.valueRow(ui, at(row), row, {
            label: STAT_DEFS[stat].label,
            color: value,
            value: (progress) => countUp(record.stats[stat], progress),
          });
        });
        const gearStart = CRAWLER_HEADER_ROWS + ALL_STATS.length;
        const gear = record.gear.length === 0 ? [NO_GEAR_TEXT] : record.gear;
        gear.forEach((name, index) => {
          const reveal = this.rowReveal(gearStart + index);
          if (reveal.alpha <= 0) return;
          ui.ctx.save();
          ui.ctx.globalAlpha *= reveal.alpha;
          text(ui, at(gearStart + index), {
            text: name,
            role: record.gear.length === 0 ? 'muted' : 'secondary',
            color: record.gear.length === 0 ? undefined : palette.state.success,
          });
          ui.ctx.restore();
        });
      },
    });
  }

  private runLines(ui: Ui, body: Rect, summary: RunSummary, laid: RunLayout, before: number): void {
    const { space } = ui.theme;
    const rowH = statRowHeight(ui);
    const cells = splitH(
      body,
      Array.from({ length: laid.columns }, () => 'fill' as const),
      space.lg,
    );
    const roleColor = (line: RunStatLine): string => skinsFor(ui.theme).text[line.role].color;
    summary.lines.forEach((line, index) => {
      const column = cells[Math.floor(index / laid.runRows)];
      const rect: Rect = {
        x: column.x,
        y: column.y + (index % laid.runRows) * rowH,
        w: column.w,
        h: rowH,
      };
      this.valueRow(ui, rect, before + index, {
        label: line.label,
        color: roleColor(line),
        value: (progress) => formatRunStat(line, line.value * progress),
      });
    });
  }

  private killRowsDraw(
    ui: Ui,
    body: Rect,
    summary: RunSummary,
    laid: RunLayout,
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
    const cells = splitH(
      body,
      Array.from({ length: laid.columns }, () => 'fill' as const),
      space.lg,
    );
    summary.topKills.forEach(([name, count], index) => {
      const reveal = this.rowReveal(rowsBefore + index);
      if (reveal.alpha <= 0) return;
      const column = cells[Math.floor(index / laid.killRows)];
      const rect: Rect = {
        x: column.x,
        y: column.y + (index % laid.killRows) * rowH,
        w: column.w,
        h: rowH,
      };
      const countText = `×${countUp(count, reveal.count)}`;
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
    const { palette, space } = ui.theme;
    const headline = headlineStyle(ui, HEADLINE, area.w);
    const [firstRows, secondRows] = laid.crawlerRows;
    const partyH = laid.crawlersStacked
      ? cardHeight(ui, firstRows) + space.md + cardHeight(ui, secondRows)
      : cardHeight(ui, Math.max(firstRows, secondRows));
    const [headRow, subtitleRow, captionRow, dividerRow, partyRow, runRow, killsRow] = splitV(
      area,
      [
        headline.lineHeight,
        subtitleHeight(ui, area.w),
        captionHeight(ui, area.w),
        space.sm,
        partyH,
        cardHeight(ui, laid.runRows),
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
    text(ui, subtitleRow, { text: SUBTITLE, role: 'title', align: 'center', wrap: true });
    text(ui, captionRow, { text: CAPTION, role: 'muted', align: 'center', wrap: true });
    drawDivider(ui, dividerRow, withAlpha(palette.accent.base, DIVIDER_ALPHA), space.xxl);

    const [firstRect, secondRect] = laid.crawlersStacked
      ? splitV(partyRow, [cardHeight(ui, firstRows), cardHeight(ui, secondRows)], space.md)
      : splitH(partyRow, ['fill', 'fill'], space.md);
    const [first, second] = summary.crawlers;
    this.crawlerCard(ui, firstRect, first);
    this.crawlerCard(ui, secondRect, second);

    const partyRows = this.partyRows(summary);
    card(ui, runRow, {
      id: 'run',
      overline: RUN_COLUMN_TITLE,
      accent: palette.accent.base,
      content: (body) => this.runLines(ui, body, summary, laid, partyRows),
    });
    card(ui, killsRow, {
      id: 'kills',
      overline: KILLS_TITLE,
      accent: palette.accent.base,
      content: (body) =>
        this.killRowsDraw(ui, body, summary, laid, partyRows + summary.lines.length),
    });
  }

  private drawButtons(ui: Ui, row: Rect): void {
    const buttonAlpha = clamp01((this.frame - this.buttonsFrame) / BUTTON_FADE_FRAMES);
    if (buttonAlpha <= 0) return;
    const { space } = ui.theme;
    const stacked = buttonsStack(ui, row.w);
    const buttonH = buttonHeight(ui, 'lg');
    const buttonW = stacked ? row.w : Math.min(BUTTON_MAX_WIDTH, (row.w - space.md) / BUTTON_COUNT);
    const [stayRect, newGameRect] = stacked
      ? splitV(row, [buttonH, buttonH], space.sm)
      : splitH(
          centerIn(row, buttonW * BUTTON_COUNT + space.md, row.h),
          [buttonW, buttonW],
          space.md,
        );
    ui.ctx.save();
    ui.ctx.globalAlpha *= buttonAlpha;
    button(ui, stayRect, {
      id: 'stay',
      label: STAY_LABEL,
      variant: 'primary',
      size: 'lg',
      primary: true,
      onTap: () => this.stay(),
    });
    button(ui, newGameRect, {
      id: 'new-game',
      label: NEW_GAME_LABEL,
      variant: 'secondary',
      size: 'lg',
      onTap: () => this.askNewGame(),
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
      const buttonRowH = buttonRowHeight(ui, panelBodyWidth(ui, 'lg'));
      const bodyW = panelBodyWidth(ui, 'lg');
      const maxBody = panelBodyMaxHeight(ui, { width: 'lg' });
      let laid = this.layout(ui, summary, bodyW);
      const scroll = laid.height + space.lg + buttonRowH > maxBody;
      if (scroll) laid = this.layout(ui, summary, bodyW - scrollGutterWidth(ui));
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
          this.drawButtons(ui, buttonRow);
        },
      });
      drawRuneCorners(ctx, p.frame, palette.accent.base, now);
      ctx.restore();
    }

    if (this.frame < this.buttonsFrame) {
      ui.hit('skip', ui.screen, { onTap: () => this.skip(), focusable: false, sound: null });
    }
  }

  /**
   * This screen and its new-game confirmation, as surfaces. Mount them in this
   * order: the confirmation opens over the screen.
   */
  surfaces(opts: { readonly id?: string } = {}): readonly [Surface, Surface] {
    const id = opts.id ?? 'run-complete';
    const screen: Surface = {
      id,
      band: 'modal',
      haltsWorld: true,
      locksKeyboard: true,
      isOpen: () => this.active,
      close: () => this.stay(),
      render: (ui) => this.render(ui),
      // The buttons are not drawn until the count-up ends, so until then the
      // accept keys skip to them, as a tap anywhere does.
      onKey: (key, mods) => {
        if (!this.counting || !ACTIVATE_KEYS.has(key)) return false;
        if (mods.repeat !== true && mods.predatesSurface !== true) this.skip();
        return true;
      },
    };
    const confirm = choiceModalSurface({
      id: `${id}/confirm`,
      isOpen: () => this.active && this.confirming,
      locksKeyboard: true,
      escape: { kind: 'close', onEscape: () => this.cancelNewGame() },
      content: () => ({
        id: `${id}/confirm`,
        title: CONFIRM_TITLE,
        body: CONFIRM_BODY,
        tone: 'accent',
        buttons: [
          {
            id: 'cancel',
            label: CANCEL_LABEL,
            variant: 'secondary',
            onTap: () => this.cancelNewGame(),
          },
          {
            id: 'confirm',
            label: CONFIRM_LABEL,
            variant: 'primary',
            onTap: () => this.confirmNewGame(),
          },
        ],
        defaultButton: CONFIRM_CANCEL_INDEX,
      }),
    });
    return [screen, confirm];
  }
}

/** One label-and-number row; `value` reads the number at a count-up's progress, 0 to 1. */
interface ValueRow {
  readonly label: string;
  readonly color: string;
  readonly value: (progress: number) => string;
}

function countUp(value: number, progress: number): string {
  return Math.round(value * progress).toLocaleString('en-US');
}
