/**
 * Crafts: each crawler's Resourcing and Construction progress, side by side
 * so the two never read as one shared meter.
 */

import { MAX_CRAFT_LEVEL, type CraftSkillId, type CraftSkills } from '../../../core/CraftSkills';
import {
  describeConstructionPerk,
  describeResourcingPerk,
  nextConstructionUnlock,
  nextResourcingUnlock,
  thrallCount,
} from '../../../core/craftPerks';
import { CRAWLER_NAMES, type CrawlerKind } from '../../../core/SkillManager';
import { thrallCooldownSecondsLeft } from '../../../core/thrallCooldowns';
import type { CatPlayer } from '../../../creatures/CatPlayer';
import type { HumanPlayer } from '../../../creatures/HumanPlayer';
import { inset, splitH, type Rect } from '../../core/geom';
import { drawCraftSkillIcon } from '../../icons/craftSkillIcons';
import { skinsFor } from '../../theme/skins';
import { button, buttonHeight } from '../../widgets/button';
import { card } from '../../widgets/card';
import { meter } from '../../widgets/meter';
import { lineHeightOf, measureTextHeight, text } from '../../widgets/text';
import { perCrawler } from './parts';
import type { PauseContext, PauseSection, SectionLayout } from './section';

const CRAFT_SKILL_ORDER: readonly CraftSkillId[] = ['resourcing', 'construction'];

const CRAFT_SKILL_LABELS: Readonly<Record<CraftSkillId, string>> = {
  resourcing: 'Resourcing',
  construction: 'Construction',
};

/** The craft icon is this many title lines tall. */
const ICON_TITLE_LINES = 2;

/** True once either crawler has learned a craft skill: the page's visibility gate. */
export function hasAnyCraftSkill(human: HumanPlayer, cat: CatPlayer): boolean {
  return CRAFT_SKILL_ORDER.some(
    (id) => human.craftSkills.isLearned(id) || cat.craftSkills.isLearned(id),
  );
}

/** The summon's readiness, for a crawler whose Resourcing has the thrall unlock. */
function thrallStatus(skills: CraftSkills, id: CraftSkillId): string {
  const crawler = skills.crawlerKind;
  if (id !== 'resourcing' || crawler === null) return '';
  if (thrallCount(skills.getLevel(id)) === 0) return '';
  const wait = thrallCooldownSecondsLeft(crawler);
  return wait > 0 ? ` · Thrall ready in ${wait}s` : ' · Thrall ready';
}

function perkText(id: CraftSkillId, level: number): string {
  return id === 'resourcing' ? describeResourcingPerk(level) : describeConstructionPerk(level);
}

function unlockText(skills: CraftSkills, id: CraftSkillId): string {
  const level = skills.getLevel(id);
  const next = id === 'resourcing' ? nextResourcingUnlock(level) : nextConstructionUnlock(level);
  const progress =
    level >= MAX_CRAFT_LEVEL || next === null
      ? 'Mastered'
      : `Next at Lv ${next.level}: ${next.text}`;
  return `${progress}${thrallStatus(skills, id)}`;
}

function craftCard(
  column: SectionLayout,
  ctx: PauseContext,
  crawler: CrawlerKind,
  skills: CraftSkills,
  id: CraftSkillId,
): void {
  const { ui } = column;
  const { space } = ui.theme;
  const padding = skinsFor(ui.theme).panel.raised.padding;
  const textW = column.width - padding * 2;
  const level = skills.getLevel(id);
  const perk = perkText(id, level);
  const unlock = unlockText(skills, id);
  const perkH = measureTextHeight(ui, textW, { text: perk, role: 'secondary' });
  const unlockH = measureTextHeight(ui, textW, { text: unlock, role: 'info' });
  const headerH = lineHeightOf(ui, 'title') * ICON_TITLE_LINES;
  const meterH = lineHeightOf(ui, 'caption') + space.xs;
  const processing = id === 'resourcing' ? ctx.guides.processing : undefined;
  const buttonH = buttonHeight(ui, 'sm');
  const buttonsH = buttonH + (processing === undefined ? 0 : buttonH + space.xs);
  const h =
    padding * 2 +
    headerH +
    space.sm +
    meterH +
    space.sm +
    perkH +
    space.xs +
    unlockH +
    space.sm +
    buttonsH;
  const rect = column.row(h, space.sm);
  card(ui, rect, {
    id: `${crawler}/craft/${id}`,
    content: (body) => {
      let y = body.y;
      const take = (rowH: number, after: number): Rect => {
        const row: Rect = { x: body.x, y, w: body.w, h: rowH };
        y += rowH + after;
        return row;
      };
      const header = take(headerH, space.sm);
      const [iconCell, titleCell] = splitH(header, [headerH, 'fill'], space.sm);
      drawCraftSkillIcon(ui.ctx, iconCell, id);
      text(
        ui,
        { ...titleCell, h: lineHeightOf(ui, 'title') },
        { text: CRAFT_SKILL_LABELS[id], role: 'title' },
      );
      text(ui, inset(titleCell, { t: lineHeightOf(ui, 'title') }), {
        text: `Level ${level} / ${MAX_CRAFT_LEVEL}`,
        role: 'muted',
        valign: 'top',
      });
      const atMax = level >= MAX_CRAFT_LEVEL;
      const xpToNext = skills.xpToNext(id);
      const xp = skills.getXp(id);
      const full = atMax || xpToNext === Infinity || xpToNext <= 0;
      meter(ui, take(meterH, space.sm), {
        id: `${crawler}/craft/${id}/xp`,
        kind: id === 'resourcing' ? 'stamina' : 'progress',
        value: full ? 1 : xp,
        max: full ? 1 : xpToNext,
        valueText: atMax ? 'MAX LEVEL' : `${xp} / ${xpToNext} XP`,
        ghost: false,
      });
      text(ui, take(perkH, space.xs), { text: perk, role: 'secondary', wrap: true });
      text(ui, take(unlockH, space.sm), { text: unlock, role: 'info', wrap: true });
      const guide = ctx.guides.craft;
      const howRect = take(buttonH, space.xs);
      column.track(
        howRect,
        button(ui, howRect, {
          id: `${crawler}/craft/${id}/how`,
          label: 'How it works',
          size: 'sm',
          disabled: guide === undefined,
          onTap: () => guide?.(id),
        }),
        { focusable: guide !== undefined },
      );
      if (processing !== undefined) {
        const processingRect = take(buttonH, 0);
        column.track(
          processingRect,
          button(ui, processingRect, {
            id: `${crawler}/craft/processing`,
            label: 'How Processing Works',
            size: 'sm',
            variant: 'ghost',
            onTap: processing,
          }),
        );
      }
    },
  });
}

function renderCrafts(layout: SectionLayout, ctx: PauseContext): void {
  perCrawler(layout, (column, crawler) => {
    const { ui } = column;
    const player = crawler === 'human' ? ctx.human : ctx.cat;
    const titleRow = column.row(lineHeightOf(ui, 'title'), ui.theme.space.sm);
    text(ui, titleRow, {
      text: CRAWLER_NAMES[crawler],
      role: 'title',
      color: ui.theme.palette.crawler[crawler],
    });
    const learned = CRAFT_SKILL_ORDER.filter((id) => player.craftSkills.isLearned(id));
    if (learned.length === 0) column.paragraph('No crafts learned yet.', 'muted');
    for (const id of learned) craftCard(column, ctx, crawler, player.craftSkills, id);
    column.space(ui.theme.space.md);
  });
}

export function craftsSection(): PauseSection {
  return {
    id: 'crafts',
    label: 'Crafts',
    glyph: 'hammer',
    available: (ctx) => hasAnyCraftSkill(ctx.human, ctx.cat),
    render: renderCrafts,
  };
}
