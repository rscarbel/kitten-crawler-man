/**
 * Character: both crawlers' attributes with the level-up points to spend on
 * them, the skills they have found, and the run's statistics.
 */

import { displayHp } from '../../../core/party/crawlerFormulas';
import { ALL_STATS, STAT_DEFS, type StatId } from '../../../core/party/stats';
import { formatPlayTime, type GameStats } from '../../../core/progression/GameStats';
import { crawlerName } from '../../../characters/characters';
import {
  getSkillDef,
  isEligible,
  SKILL_IDS,
  usesToNextLevel,
  type CrawlerKind,
  type SkillDef,
  type SkillState,
} from '../../../core/skills/SkillManager';
import { proficiencyLevelLabel } from '../../../core/skills/proficiency';
import {
  BRASS_GULLET_LABEL,
  BRASS_GULLET_SKILL,
  STAT_TATTOO_DESIGNS,
  brassGulletDesc,
} from '../../../core/skills/tattoos';
import type { Player } from '../../../Player';
import { centerIn, splitH, type Rect } from '../../core/geom';
import type { Ui } from '../../core/UiRoot';
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
import { activeGearLines } from '../../itemEffectLines';
import type { PauseContext, PauseSection, SectionLayout } from './section';
import { petWords, type PetNames } from '../../../core/party/petNames';

type CharacterTab = 'attributes' | 'skills' | 'run';

const SPEND_SOUND = 'menu_skillpoint_spent';

/** The colour each stat's card is drawn in while a point can go into it. */
const STAT_ACCENTS = {
  health: (theme) => theme.palette.state.success,
  melee: (theme) => theme.palette.category.weapon,
  magic: (theme) => theme.palette.category.book,
  evasiveness: (theme) => theme.palette.state.info,
  ranged: (theme) => theme.palette.category.tool,
  explosivesHandling: (theme) => theme.palette.state.warning,
} as const satisfies Record<StatId, (theme: Theme) => string>;

const SPEND_BUTTON_ID_SUFFIX = '/spend';

/** The widget id of a stat card's "+" spend button, for code that points at it. */
export function statSpendButtonId(crawler: CrawlerKind, stat: StatId): string {
  return `${crawler}/${stat}${SPEND_BUTTON_ID_SUFFIX}`;
}

/** Whether a widget id is one of `crawler`'s stat "+" spend buttons. */
export function isStatSpendButtonOf(crawler: CrawlerKind, widgetId: string): boolean {
  return widgetId.startsWith(`${crawler}/`) && widgetId.endsWith(SPEND_BUTTON_ID_SUFFIX);
}

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
    text: crawlerName(crawler),
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
  stat: StatId,
): void {
  const { ui } = column;
  const { space, palette, size } = ui.theme;
  const player = crawlerOf(ctx, crawler);
  const def = STAT_DEFS[stat];
  const canInvest = player.unspentPoints > 0;
  const padding = skinsFor(ui.theme).panel.raised.padding;
  const plusW = canInvest ? size.control : 0;
  const description = `${def.description} ${def.effectLine(crawler)}`;
  const descW = column.width - padding * 2 - plusW - (canInvest ? space.sm : 0);
  const descH = measureTextHeight(ui, descW, { text: description, role: 'caption' });
  const h = padding * 2 + lineHeightOf(ui, 'label') + space.xxs + descH;
  const rect = column.row(h, space.sm);
  const accent = canInvest ? STAT_ACCENTS[stat](ui.theme) : palette.text.muted;
  card(ui, rect, {
    id: `${crawler}/${stat}`,
    content: (body) => {
      const [textCol, plusCol] = splitH(body, ['fill', plusW], canInvest ? space.sm : 0);
      const nameRow: Rect = { ...textCol, h: lineHeightOf(ui, 'label') };
      text(ui, nameRow, { text: def.label, role: 'label', color: accent });
      text(ui, nameRow, {
        text: String(player.statValue(stat)),
        role: 'value',
        color: accent,
        align: 'right',
        tabular: true,
      });
      text(
        ui,
        { x: textCol.x, y: nameRow.y + nameRow.h + space.xxs, w: textCol.w, h: descH },
        { text: description, role: 'caption', wrap: true },
      );
      if (!canInvest) return;
      const plus = centerIn(plusCol, size.control, size.control);
      column.track(
        plus,
        iconButton(ui, plus, {
          id: statSpendButtonId(crawler, stat),
          icon: 'plus',
          label: `Spend a point on ${def.label}`,
          variant: 'primary',
          sound: SPEND_SOUND,
          onTap: () => player.spendPoint(stat),
        }),
      );
    },
  });
}

/** One line per Quiet Needle mark `player` wears, since nothing else shows what a mark does once bought. */
function tattooLines(player: Player): string[] {
  const lines: string[] = [];
  if (player.tattoo !== null) {
    const design = STAT_TATTOO_DESIGNS[player.tattoo];
    lines.push(`Tattoo: ${design.label}. ${design.desc}`);
  }
  if (player.skillTattoo === BRASS_GULLET_SKILL) {
    const desc = brassGulletDesc(getSkillDef(BRASS_GULLET_SKILL).name);
    lines.push(`Tattoo: ${BRASS_GULLET_LABEL}. ${desc}`);
  }
  return lines;
}

function renderAttributes(layout: SectionLayout, ctx: PauseContext): void {
  perCrawler(layout, (column, crawler) => {
    crawlerHeader(column, ctx, crawler);
    for (const stat of ALL_STATS) statCard(column, ctx, crawler, stat);
    for (const line of tattooLines(crawlerOf(ctx, crawler))) column.paragraph(line, 'muted');
    const gear = activeGearLines([...crawlerOf(ctx, crawler).inventory.equipment.equippedIds()]);
    for (const line of gear) column.paragraph(line, 'success');
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

/**
 * A skill's level beside its name: a pip per level for the short climbs, and
 * the number for a proficiency, whose ceiling is too far off for pips.
 */
function skillLevel(ui: Ui, row: Rect, def: SkillDef, level: number): void {
  switch (def.progression) {
    case 'standard':
      levelPips(ui, row, level, def.maxLevel);
      return;
    case 'proficiency':
      text(ui, row, {
        text: proficiencyLevelLabel(level),
        role: 'secondary',
        align: 'right',
      });
      return;
    default: {
      const unhandled: never = def;
      return unhandled;
    }
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
      skillLevel(ui, nameRow, def, state.level);
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
      text: `${crawlerName(crawler)} · ${states.length} known`,
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
  petNames: PetNames,
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
    {
      label: `${petWords(petNames, 'deinonychus').opening} Petted`,
      value: `${stats.deinonychusPets}`,
      role: 'success',
    },
    { label: 'Cows Petted', value: `${stats.cowPets}`, role: 'success' },
    { label: 'Midge Petted', value: `${stats.midgePets}`, role: 'success' },
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
  for (const row of statRows(stats, ctx.petNames)) valueRow(layout, row.label, row.value, row.role);
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
