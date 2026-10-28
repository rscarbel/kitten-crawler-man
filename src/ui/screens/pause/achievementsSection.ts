/**
 * Achievements: what each crawler has unlocked, the chest each one pays and
 * its fixed rewards, and a meter toward each tally still being counted.
 */

import { ABILITY_DEFS } from '../../../abilities/abilityDefs';
import {
  ACHIEVEMENT_DEFS,
  achievementProgress,
  type AchievementDef,
} from '../../../core/progression/AchievementManager';
import { isAchievementId } from '../../../core/progression/achievementSave';
import { crawlerDisplayName } from '../../../characters/characters';
import { ITEM_DEF } from '../../../core/items/defs/ItemDefs';
import type { Rarity } from '../../../core/items/defs/rarity';
import { type CrawlerKind } from '../../../core/skills/SkillManager';
import { paintRewardChest } from '../../../sprites/art/rewardChestArt';
import { centerIn, inset, splitH, type Rect } from '../../core/geom';
import type { Ui } from '../../core/UiRoot';
import { drawGlyph } from '../../theme/glyphs';
import { REWARD_CHEST_INK } from '../../theme/rewardChestInk';
import { meter } from '../../widgets/meter';
import { fillRounded } from '../../widgets/paint';
import { lineHeightOf, measureTextHeight, text } from '../../widgets/text';
import { rarityColor } from '../dialogs/canvasChrome';
import type { PauseContext, PauseSection, SectionLayout } from './section';

const AI_AWARDS_HEADING = 'Special awards';
/** The chest mark stands this many icon sizes wide. */
const CHEST_MARK_SCALE = 1.6;
/** Where the chest's footprint sits up its cell, as a share of its width. */
const CHEST_MARK_BASE_SHARE = 0.2;
const METER_H = 6;
/** The chest line wraps to this many lines, so an AI award's description is read whole. */
const CHEST_LINE_MAX_LINES = 2;
const HALF = 0.5;

/**
 * The achievements a crawler's page lists: every one it has unlocked, and
 * those still locked that count toward a tally, so their meters show how
 * close they are. The rest stay a surprise.
 */
function listedFor(ctx: PauseContext, crawler: CrawlerKind): readonly ListedAchievement[] {
  const manager = ctx.achievements[crawler];
  return Object.keys(ACHIEVEMENT_DEFS)
    .filter(isAchievementId)
    .filter((id) => {
      const owner = ACHIEVEMENT_DEFS[id].playerType;
      return owner === 'both' || owner === crawler;
    })
    .map((id) => ({
      def: ACHIEVEMENT_DEFS[id],
      unlocked: manager.isUnlocked(id),
      progress: achievementProgress(ctx.achievements, crawler, id),
    }))
    .filter((entry) => entry.unlocked || entry.progress !== null);
}

interface ListedAchievement {
  readonly def: AchievementDef;
  readonly unlocked: boolean;
  readonly progress: { readonly current: number; readonly target: number } | null;
}

/** The names of the fixed rewards an achievement pays `crawler`, beside its chest. */
function fixedRewardNames(def: AchievementDef, crawler: CrawlerKind): string[] {
  return (def.reward.fixed ?? [])
    .filter((reward) => reward.to === undefined || reward.to === 'active' || reward.to === crawler)
    .map((reward) =>
      reward.kind === 'companion'
        ? ABILITY_DEFS.deinonychus.name
        : reward.quantity > 1
          ? `${reward.quantity} × ${ITEM_DEF[reward.id].name}`
          : ITEM_DEF[reward.id].name,
    );
}

interface RowView {
  readonly id: string;
  readonly name: string;
  readonly unlocked: boolean;
  readonly rarity: Rarity;
  /** What the chest line says after the chest: its fixed rewards, or an award's description. */
  readonly extra: string;
  readonly progress: { readonly current: number; readonly target: number } | null;
}

/** A closed chest of the rarity, painted small, as the row's reward mark. */
function chestMark(ui: Ui, cell: Rect, rarity: Rarity): void {
  const width = cell.w;
  paintRewardChest(
    ui.ctx,
    cell.x + width * HALF,
    cell.y + cell.h - width * CHEST_MARK_BASE_SHARE,
    width,
    { rarity, lidAngle: 0, haspLift: 0, seamGlow: 0, innerGlow: 0, runePulse: 1, time: 0 },
    REWARD_CHEST_INK[rarity],
  );
}

function achievementRow(layout: SectionLayout, ui: Ui, view: RowView): void {
  const { space, size, palette, radius } = ui.theme;
  const markW = size.icon * CHEST_MARK_SCALE;
  const textW = layout.width - markW - space.sm - space.sm * 2;
  const nameH = measureTextHeight(ui, textW, { text: view.name, role: 'label' });
  const captionH = lineHeightOf(ui, 'caption');
  const chestLine = [`${view.rarity} chest`, view.extra].filter((part) => part !== '').join(' · ');
  const chestH = Math.min(
    measureTextHeight(ui, textW, { text: chestLine, role: 'caption' }),
    captionH * CHEST_LINE_MAX_LINES,
  );
  const meterBlock = view.progress === null || view.unlocked ? 0 : space.xs + METER_H + captionH;
  const h = space.sm * 2 + nameH + chestH + meterBlock;
  const rect = layout.row(h, space.xs);
  fillRounded(
    ui.ctx,
    rect,
    radius.sm,
    view.unlocked ? palette.accent.soft : palette.surface.raised,
  );
  const [markCell, textCell] = splitH(inset(rect, space.sm), [markW, 'fill'], space.sm);
  chestMark(ui, { ...markCell, h: Math.min(markCell.h, markW) }, view.rarity);
  const nameRow = { ...textCell, h: nameH };
  const checkW = view.unlocked ? size.icon + space.xs : 0;
  if (view.unlocked) {
    drawGlyph(ui.ctx, 'check', centerIn({ ...nameRow, w: size.icon }, size.icon, size.icon), {
      color: palette.state.success,
    });
  }
  text(
    ui,
    { ...nameRow, x: nameRow.x + checkW, w: nameRow.w - checkW },
    {
      text: view.name,
      role: view.unlocked ? 'label' : 'labelMuted',
      wrap: true,
    },
  );
  text(
    ui,
    { ...textCell, y: textCell.y + nameH, h: chestH },
    {
      text: chestLine,
      role: 'caption',
      color: rarityColor(ui.theme, view.rarity),
      wrap: true,
      maxLines: CHEST_LINE_MAX_LINES,
    },
  );
  if (view.progress !== null && !view.unlocked) {
    const meterY = textCell.y + nameH + chestH + space.xs;
    meter(
      ui,
      { x: textCell.x, y: meterY, w: textCell.w, h: METER_H },
      {
        id: `progress-${view.id}`,
        value: view.progress.current,
        max: view.progress.target,
        ghost: false,
      },
    );
    text(
      ui,
      { ...textCell, y: meterY + METER_H, h: captionH },
      {
        text: `${view.progress.current.toLocaleString()} / ${view.progress.target.toLocaleString()}`,
        role: 'caption',
        align: 'right',
        tabular: true,
      },
    );
  }
}

function crawlerAchievements(layout: SectionLayout, ctx: PauseContext, crawler: CrawlerKind): void {
  const { ui } = layout;
  const { space } = ui.theme;
  const manager = ctx.achievements[crawler];
  layout.heading(crawlerDisplayName(crawler), ui.theme.palette.crawler[crawler]);
  const listed = listedFor(ctx, crawler);
  const aiAwards = manager.aiAchievements();
  if (!listed.some((entry) => entry.unlocked) && aiAwards.length === 0) {
    layout.paragraph('No achievements yet...', 'muted');
  }
  const ordered = [...listed.filter((e) => e.unlocked), ...listed.filter((e) => !e.unlocked)];
  for (const { def, unlocked, progress } of ordered) {
    achievementRow(layout, ui, {
      id: `${crawler}-${def.id}`,
      name: def.name,
      unlocked,
      rarity: def.reward.rarity,
      extra: fixedRewardNames(def, crawler).join(', '),
      progress,
    });
  }
  if (aiAwards.length > 0) layout.paragraph(AI_AWARDS_HEADING, 'muted', space.xs);
  for (const award of aiAwards) {
    achievementRow(layout, ui, {
      id: `${crawler}-${award.id}`,
      name: award.name,
      unlocked: true,
      rarity: award.rarity,
      extra: award.description,
      progress: null,
    });
  }

  layout.space(space.md);
}

export function achievementsSection(): PauseSection {
  return {
    id: 'achievements',
    label: 'Achievements',
    glyph: 'trophy',
    badge: (ctx) => {
      const unseen = ctx.achievements.human.menuUnseenCount + ctx.achievements.cat.menuUnseenCount;
      return unseen > 0 ? `${unseen} new` : null;
    },
    render: (layout, ctx) => {
      // Marked as the page draws, so a badge the player has looked at never outlives the look.
      ctx.achievements.human.markMenuSeen();
      ctx.achievements.cat.markMenuSeen();
      crawlerAchievements(layout, ctx, 'human');
      crawlerAchievements(layout, ctx, 'cat');
    },
  };
}
