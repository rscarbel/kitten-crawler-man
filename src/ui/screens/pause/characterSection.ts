/**
 * Character: both crawlers' attributes with the level-up points to spend on
 * them, the skills they have found, and the run's statistics.
 */

import { CON_HP_BONUS_PER_POINT, displayHp } from '../../../core/crawlerFormulas';
import { formatPlayTime, type GameStats } from '../../../core/GameStats';
import {
  CRAWLER_NAMES,
  getSkillDef,
  isEligible,
  SKILL_IDS,
  usesToNextLevel,
  type CrawlerKind,
  type SkillState,
} from '../../../core/SkillManager';
import { HumanPlayer } from '../../../creatures/HumanPlayer';
import type { Player, StatName } from '../../../Player';
import { DYN_MOB_DAMAGE_FRACTION_PER_HANDLING_LEVEL } from '../../../systems/DynamiteSystem';
import { centerIn, inset, splitH, type Rect } from '../../core/geom';
import type { Ui } from '../../core/UiRoot';
import { drawGlyph } from '../../theme/glyphs';
import { skinsFor, type TextRole } from '../../theme/skins';
import type { Theme } from '../../theme/tokens';
import { badge, badgeSize } from '../../widgets/badge';
import { card } from '../../widgets/card';
import { iconButton } from '../../widgets/iconButton';
import { listRow } from '../../widgets/listRow';
import { meter } from '../../widgets/meter';
import { fillRounded } from '../../widgets/paint';
import { lineHeightOf, measureTextHeight, text } from '../../widgets/text';
import { choiceRow, perCrawler, type Choice } from './parts';
import type { PauseContext, PauseSection, SectionLayout } from './section';

type CharacterTab = 'attributes' | 'skills' | 'run';

const PERCENT = 100;
const EXPLOSIVE_DAMAGE_PERCENT_PER_POINT = Math.round(
  DYN_MOB_DAMAGE_FRACTION_PER_HANDLING_LEVEL * PERCENT,
);

const SPEND_SOUND = 'menu_skillpoint_spent';

interface StatDef {
  /** The stat this card invests in; null for the human-only Explosives Handling track. */
  readonly statName: StatName | null;
  readonly name: string;
  readonly description: string;
  /** Shown instead of the description when the System refuses points into this stat. */
  readonly lockedNote?: string;
  readonly accent: (theme: Theme) => string;
  readonly value: (p: Player) => number;
  /** Invests one banked level-up point into this card's stat. */
  readonly spend: (p: Player) => void;
}

const strengthAccent = (theme: Theme): string => theme.palette.category.weapon;
const constitutionAccent = (theme: Theme): string => theme.palette.state.success;
const dexterityAccent = (theme: Theme): string => theme.palette.state.info;

const HUMAN_STATS: readonly StatDef[] = [
  {
    statName: 'strength',
    name: 'Strength',
    description: 'Hit harder. Each point raises melee damage by 1.',
    accent: strengthAccent,
    value: (p) => p.strength,
    spend: (p) => p.spendPoint('strength'),
  },
  {
    statName: null,
    name: 'Explosives Handling',
    description: `Bigger booms. Each point adds +${EXPLOSIVE_DAMAGE_PERCENT_PER_POINT}% dynamite damage to enemies and a longer throw.`,
    accent: (theme) => theme.palette.state.warning,
    value: (p) => (p instanceof HumanPlayer ? p.explosivesHandling : 0),
    spend: (p) => {
      if (p instanceof HumanPlayer) p.spendPoint('explosivesHandling');
    },
  },
  {
    statName: 'constitution',
    name: 'Constitution',
    description: `Toughen up. Each point grants +${CON_HP_BONUS_PER_POINT} maximum HP.`,
    accent: constitutionAccent,
    value: (p) => p.constitution,
    spend: (p) => p.spendPoint('constitution'),
  },
  {
    statName: 'dexterity',
    name: 'Dexterity',
    description: 'Stay untouched. Each point improves your chance to dodge an attack.',
    accent: dexterityAccent,
    value: (p) => p.dexterity,
    spend: (p) => p.spendPoint('dexterity'),
  },
];

const CAT_STATS: readonly StatDef[] = [
  {
    statName: 'strength',
    name: 'Strength',
    description: 'Sharper claws. Each point raises claw attack damage.',
    accent: strengthAccent,
    value: (p) => p.strength,
    spend: (p) => p.spendPoint('strength'),
  },
  {
    statName: 'intelligence',
    name: 'Intelligence',
    description: 'Think bigger. Amplifies magic missile power & range.',
    accent: (theme) => theme.palette.category.book,
    value: (p) => p.intelligence,
    spend: (p) => p.spendPoint('intelligence'),
  },
  {
    statName: 'constitution',
    name: 'Constitution',
    description: `Nine lives. Each point grants +${CON_HP_BONUS_PER_POINT} maximum HP.`,
    lockedNote:
      'Attribute locked by the System. Pet biscuit enhancement is permanent and non-negotiable.',
    accent: constitutionAccent,
    value: (p) => p.constitution,
    spend: (p) => p.spendPoint('constitution'),
  },
  {
    statName: 'dexterity',
    name: 'Dexterity',
    description: 'Feline grace. Each point improves your chance to dodge an attack.',
    lockedNote: 'Auto-allocated by Enhanced Growth on level-up. No input required.',
    accent: dexterityAccent,
    value: (p) => p.dexterity,
    spend: (p) => p.spendPoint('dexterity'),
  },
];

const STATS_BY_CRAWLER: Readonly<Record<CrawlerKind, readonly StatDef[]>> = {
  human: HUMAN_STATS,
  cat: CAT_STATS,
};

function crawlerOf(ctx: PauseContext, crawler: CrawlerKind): Player {
  return crawler === 'human' ? ctx.human : ctx.cat;
}

function crawlerColor(theme: Theme, crawler: CrawlerKind): string {
  return theme.palette.crawler[crawler];
}

function unspentTotal(ctx: PauseContext): number {
  return ctx.human.unspentPoints + ctx.cat.unspentPoints;
}

// ── Attributes ──────────────────────────────────────────────────────────────

function meterHeight(ui: Ui): number {
  return lineHeightOf(ui, 'caption') + ui.theme.space.xs;
}

function crawlerHeader(column: SectionLayout, ctx: PauseContext, crawler: CrawlerKind): void {
  const { ui } = column;
  const { space } = ui.theme;
  const player = crawlerOf(ctx, crawler);
  const titleRow = column.row(lineHeightOf(ui, 'title'), space.xs);
  text(ui, titleRow, {
    text: CRAWLER_NAMES[crawler],
    role: 'title',
    color: crawlerColor(ui.theme, crawler),
  });
  const points = player.unspentPoints;
  if (points > 0) {
    const label = `${points} point${points === 1 ? '' : 's'} to spend`;
    const pill = badgeSize(ui, { label });
    badge(
      ui,
      { x: titleRow.x + titleRow.w - pill.w, y: titleRow.y, w: pill.w, h: titleRow.h },
      { label },
    );
  } else {
    text(ui, titleRow, { text: `Level ${player.level}`, role: 'muted', align: 'right' });
  }
  meter(ui, column.row(meterHeight(ui), space.xs), {
    id: `${crawler}/hp`,
    kind: 'hp',
    value: displayHp(player.hp),
    max: player.maxHp,
    label: 'HP',
    valueText: true,
    ghost: false,
  });
  meter(ui, column.row(meterHeight(ui), space.md), {
    id: `${crawler}/xp`,
    kind: 'xp',
    value: player.xp,
    max: player.xpNeededForNextLevel,
    label: `Level ${player.level}`,
    valueText: `${player.xp} / ${player.xpNeededForNextLevel} XP`,
    ghost: false,
  });
}

function statCard(
  column: SectionLayout,
  ctx: PauseContext,
  crawler: CrawlerKind,
  stat: StatDef,
): void {
  const { ui } = column;
  const { space, palette, size } = ui.theme;
  const player = crawlerOf(ctx, crawler);
  // A locked card reads like the no-points state; the difference is that no
  // amount of banked points will ever open it.
  const locked = stat.statName !== null && !player.canSpendPointInto(stat.statName);
  const canInvest = player.unspentPoints > 0 && !locked;
  const padding = skinsFor(ui.theme).panel.raised.padding;
  const plusW = canInvest ? size.control : 0;
  const description = locked ? (stat.lockedNote ?? stat.description) : stat.description;
  const descW = column.width - padding * 2 - plusW - (canInvest ? space.sm : 0);
  const descH = measureTextHeight(ui, descW, { text: description, role: 'caption' });
  const h = padding * 2 + lineHeightOf(ui, 'label') + space.xxs + descH;
  const rect = column.row(h, space.sm);
  const accent = canInvest ? stat.accent(ui.theme) : palette.text.muted;
  card(ui, rect, {
    id: `${crawler}/${stat.name}`,
    content: (body) => {
      const [textCol, plusCol] = splitH(body, ['fill', plusW], canInvest ? space.sm : 0);
      const nameRow: Rect = { ...textCol, h: lineHeightOf(ui, 'label') };
      let nameRect = nameRow;
      if (locked) {
        const side = size.icon;
        drawGlyph(ui.ctx, 'lock', centerIn({ ...nameRow, w: side }, side, side), {
          color: palette.text.muted,
        });
        nameRect = inset(nameRow, { l: side + space.xs });
      }
      text(ui, nameRect, { text: stat.name, role: 'label', color: accent });
      text(ui, nameRow, {
        text: String(stat.value(player)),
        role: 'value',
        color: accent,
        align: 'right',
        tabular: true,
      });
      text(
        ui,
        { x: textCol.x, y: nameRow.y + nameRow.h + space.xxs, w: textCol.w, h: descH },
        {
          text: description,
          role: 'caption',
          color: locked ? palette.state.warning : undefined,
          wrap: true,
        },
      );
      if (!canInvest) return;
      const plus = centerIn(plusCol, size.control, size.control);
      column.track(
        plus,
        iconButton(ui, plus, {
          id: `${crawler}/${stat.name}/spend`,
          icon: 'plus',
          label: `Spend a point on ${stat.name}`,
          variant: 'primary',
          sound: SPEND_SOUND,
          onTap: () => stat.spend(player),
        }),
      );
    },
  });
}

function renderAttributes(layout: SectionLayout, ctx: PauseContext): void {
  perCrawler(layout, (column, crawler) => {
    crawlerHeader(column, ctx, crawler);
    for (const stat of STATS_BY_CRAWLER[crawler]) statCard(column, ctx, crawler, stat);
    column.space(column.ui.theme.space.md);
  });
}

// ── Skills ──────────────────────────────────────────────────────────────────

const PIP_SIZE = 7;

function undiscoveredCount(crawler: CrawlerKind, known: number): number {
  const eligible = SKILL_IDS.filter((id) => isEligible(getSkillDef(id), crawler)).length;
  return Math.max(0, eligible - known);
}

function levelPips(ui: Ui, row: Rect, level: number, maxLevel: number): void {
  const { space, palette, radius } = ui.theme;
  const total = maxLevel * PIP_SIZE + (maxLevel - 1) * space.xxs;
  let x = row.x + row.w - total;
  const y = row.y + (row.h - PIP_SIZE) / 2;
  for (let index = 0; index < maxLevel; index++) {
    fillRounded(
      ui.ctx,
      { x, y, w: PIP_SIZE, h: PIP_SIZE },
      radius.pill,
      index < level ? palette.category.book : palette.meter.track,
    );
    x += PIP_SIZE + space.xxs;
  }
}

function skillCard(column: SectionLayout, crawler: CrawlerKind, state: SkillState): void {
  const { ui } = column;
  const { space } = ui.theme;
  const def = getSkillDef(state.id);
  const padding = skinsFor(ui.theme).panel.raised.padding;
  const textW = column.width - padding * 2;
  const effect = def.describeEffect(state.level);
  const effectH = measureTextHeight(ui, textW, { text: effect, role: 'secondary' });
  const flavorH = measureTextHeight(ui, textW, { text: def.flavor, role: 'muted' });
  const h =
    padding * 2 +
    lineHeightOf(ui, 'label') +
    space.xs +
    effectH +
    space.xxs +
    flavorH +
    space.sm +
    meterHeight(ui);
  const rect = column.row(h, space.sm);
  const needed = usesToNextLevel(def, state.level);
  const mastered = !Number.isFinite(needed);
  card(ui, rect, {
    id: `${crawler}/skill/${state.id}`,
    content: (body) => {
      let y = body.y;
      const take = (rowH: number, after: number): Rect => {
        const rowRect: Rect = { x: body.x, y, w: body.w, h: rowH };
        y += rowH + after;
        return rowRect;
      };
      const nameRow = take(lineHeightOf(ui, 'label'), space.xs);
      text(ui, nameRow, { text: def.name, role: 'label', color: ui.theme.palette.category.book });
      levelPips(ui, nameRow, state.level, def.maxLevel);
      text(ui, take(effectH, space.xxs), { text: effect, role: 'secondary', wrap: true });
      text(ui, take(flavorH, space.sm), { text: def.flavor, role: 'muted', wrap: true });
      meter(ui, take(meterHeight(ui), 0), {
        id: `${crawler}/skill/${state.id}/uses`,
        kind: 'progress',
        value: mastered ? 1 : state.usesTowardNext,
        max: mastered ? 1 : needed,
        valueText: mastered ? 'Mastered' : `${state.usesTowardNext} / ${needed} uses`,
        ghost: false,
      });
    },
  });
}

function renderSkills(layout: SectionLayout, ctx: PauseContext): void {
  perCrawler(layout, (column, crawler) => {
    const { ui } = column;
    const player = crawlerOf(ctx, crawler);
    const states = player.skills.unlockedStates();
    const remaining = undiscoveredCount(crawler, states.length);
    const titleRow = column.row(lineHeightOf(ui, 'title'), ui.theme.space.sm);
    text(ui, titleRow, {
      text: `${CRAWLER_NAMES[crawler]} · ${states.length} known`,
      role: 'title',
      color: crawlerColor(ui.theme, crawler),
    });
    if (remaining > 0) {
      text(ui, titleRow, { text: `${remaining} undiscovered`, role: 'muted', align: 'right' });
    }
    if (states.length === 0) {
      column.paragraph('No skills yet. The dungeon has not offered any.', 'muted');
      column.paragraph('Skill books drop from the things that lived by them.', 'muted');
    }
    for (const state of states) skillCard(column, crawler, state);
    if (remaining > 0) {
      // Named skills stay hidden until found: the discovery is the reward.
      column.paragraph(
        `Undiscovered skills: ${remaining}. The dungeon provides. Eventually.`,
        'muted',
      );
    }
    column.space(ui.theme.space.md);
  });
}

// ── Run statistics ──────────────────────────────────────────────────────────

function statRows(
  stats: GameStats,
): ReadonlyArray<{ label: string; value: string; role: TextRole }> {
  return [
    { label: 'Time Played', value: formatPlayTime(stats.framesPlayed), role: 'value' },
    { label: 'Total Kills', value: `${stats.totalKills}`, role: 'accent' },
    { label: 'Bosses Slain', value: `${stats.bossesDefeated}`, role: 'accent' },
    { label: 'Deaths', value: `${stats.deaths}`, role: 'danger' },
    { label: 'Damage Dealt', value: `${stats.damageDealt}`, role: 'value' },
    { label: 'Damage Taken', value: `${stats.damageTaken}`, role: 'danger' },
    { label: 'Potions Used', value: `${stats.potionsUsed}`, role: 'success' },
    { label: 'Gold Earned', value: `${stats.goldEarned}`, role: 'accent' },
    { label: 'Hirelings Hired', value: `${stats.hirelingsHired}`, role: 'value' },
    { label: 'Hirelings Lost', value: `${stats.hirelingsLost}`, role: 'muted' },
  ];
}

function valueRow(layout: SectionLayout, label: string, value: string, role: TextRole): void {
  const { ui } = layout;
  const rect = layout.row(ui.theme.size.row, 0);
  listRow(ui, rect, {
    id: `run/${label}`,
    title: label,
    trailing: value,
    trailingColor: skinsFor(ui.theme).text[role].color,
  });
}

function renderRun(layout: SectionLayout, ctx: PauseContext): void {
  const stats = ctx.gameStats;
  for (const row of statRows(stats)) valueRow(layout, row.label, row.value, row.role);
  layout.heading('Enemies killed');
  const kills = [...stats.killsByType.entries()].sort((a, b) => b[1] - a[1]);
  if (kills.length === 0) layout.paragraph('No kills yet', 'muted');
  for (const [name, count] of kills) valueRow(layout, name, `${count}`, 'accent');
}

// ── Section ─────────────────────────────────────────────────────────────────

export function characterSection(): PauseSection {
  let tab: CharacterTab = 'attributes';
  return {
    id: 'character',
    label: 'Character',
    glyph: 'user',
    badge: (ctx) => {
      const points = unspentTotal(ctx);
      return points > 0 ? String(points) : null;
    },
    subtitle: (ctx) => {
      const points = unspentTotal(ctx);
      return points > 0 ? 'Grow stronger between battles' : undefined;
    },
    render: (layout, ctx) => {
      const { ui } = layout;
      const points = unspentTotal(ctx);
      const choices: readonly Choice<CharacterTab>[] = [
        { value: 'attributes', label: points > 0 ? `Attributes · ${points}` : 'Attributes' },
        { value: 'skills', label: 'Skills' },
        { value: 'run', label: 'Run' },
      ];
      choiceRow(layout, {
        id: 'character-tab',
        choices,
        selected: tab,
        onPick: (picked) => {
          tab = picked;
        },
      });
      layout.space(ui.theme.space.xs);
      if (tab === 'attributes') renderAttributes(layout, ctx);
      else if (tab === 'skills') renderSkills(layout, ctx);
      else renderRun(layout, ctx);
    },
    reset: () => {
      tab = 'attributes';
    },
  };
}
