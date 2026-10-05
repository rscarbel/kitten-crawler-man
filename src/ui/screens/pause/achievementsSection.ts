/** Achievements: what each crawler has unlocked, and the loot boxes waiting to be opened. */

import {
  ACHIEVEMENT_DEFS,
  isAchievementId,
  type AchievementManager,
} from '../../../core/AchievementManager';
import { CRAWLER_NAMES, type CrawlerKind } from '../../../core/SkillManager';
import { centerIn, inset, splitH } from '../../core/geom';
import type { Ui } from '../../core/UiRoot';
import { drawGlyph } from '../../theme/glyphs';
import type { Theme } from '../../theme/tokens';
import { button, buttonHeight, measureButton } from '../../widgets/button';
import { fillRounded } from '../../widgets/paint';
import { lineHeightOf, measureTextHeight, text } from '../../widgets/text';
import type { PauseContext, PauseSection, SectionLayout } from './section';

const OPEN_BOXES_LABEL = 'Open Boxes';

function tierColor(theme: Theme, tier: string): string {
  const { palette } = theme;
  switch (tier) {
    case 'Bronze':
      return palette.state.warning;
    case 'Silver':
      return palette.text.secondary;
    case 'Gold':
      return palette.accent.base;
    case 'Legendary':
      return palette.category.book;
    case 'Celestial':
      return palette.state.info;
    default:
      return palette.text.primary;
  }
}

function unlockedFor(manager: AchievementManager, crawler: CrawlerKind) {
  return Object.keys(ACHIEVEMENT_DEFS)
    .filter(isAchievementId)
    .filter((id) => {
      const owner = ACHIEVEMENT_DEFS[id].playerType;
      return (owner === 'both' || owner === crawler) && manager.isUnlocked(id);
    })
    .map((id) => ACHIEVEMENT_DEFS[id]);
}

function achievementRow(
  layout: SectionLayout,
  ui: Ui,
  name: string,
  tier: { readonly label: string; readonly color: string } | null,
): void {
  const { space, size, palette, radius } = ui.theme;
  const glyphW = size.icon + space.sm;
  const nameW = layout.width - glyphW - space.sm * 2;
  const nameH = measureTextHeight(ui, nameW, { text: name, role: 'label' });
  const h = space.sm * 2 + nameH + (tier === null ? 0 : lineHeightOf(ui, 'caption'));
  const rect = layout.row(h, space.xs);
  fillRounded(ui.ctx, rect, radius.sm, palette.accent.soft);
  const [glyphCell, textCell] = splitH(inset(rect, space.sm), [glyphW, 'fill'], 0);
  drawGlyph(
    ui.ctx,
    'check',
    centerIn({ ...glyphCell, h: lineHeightOf(ui, 'label') }, size.icon, size.icon),
    { color: palette.state.success },
  );
  text(ui, { ...textCell, h: nameH }, { text: name, role: 'label', wrap: true });
  if (tier !== null) {
    text(
      ui,
      { ...textCell, y: textCell.y + nameH, h: lineHeightOf(ui, 'caption') },
      { text: tier.label, role: 'caption', color: tier.color },
    );
  }
}

function crawlerAchievements(layout: SectionLayout, ctx: PauseContext, crawler: CrawlerKind): void {
  const { ui } = layout;
  const { space } = ui.theme;
  const manager = ctx.achievements[crawler];
  layout.heading(CRAWLER_NAMES[crawler], ui.theme.palette.crawler[crawler]);
  const unlocked = unlockedFor(manager, crawler);
  if (unlocked.length === 0) layout.paragraph('No achievements yet...', 'muted');
  for (const def of unlocked) {
    const tier =
      def.lootBox === undefined
        ? null
        : {
            label: `${def.lootBox.tier} ${def.lootBox.category}`,
            color: tierColor(ui.theme, def.lootBox.tier),
          };
    achievementRow(layout, ui, def.name, tier);
  }

  const boxCount = manager.pendingBoxes.length;
  if (boxCount === 0) {
    layout.space(space.md);
    return;
  }
  const openBoxes = ctx.openBoxes[crawler];
  if (openBoxes !== null) {
    const rect = layout.row(buttonHeight(ui), space.md);
    const buttonW = measureButton(ui, { label: OPEN_BOXES_LABEL, icon: 'sparkle' });
    const [labelCell, buttonCell] = splitH(rect, ['fill', buttonW], space.sm);
    text(ui, labelCell, { text: `Unopened boxes: ${boxCount}`, role: 'secondary' });
    layout.track(
      buttonCell,
      button(ui, buttonCell, {
        id: `${crawler}/open-boxes`,
        label: OPEN_BOXES_LABEL,
        icon: 'sparkle',
        variant: 'success',
        onTap: openBoxes,
      }),
    );
    return;
  }
  // Reached outside a safe room and inside rooms whose scene cannot run the
  // opener (building interiors), so the line names the dungeon.
  const noun = boxCount === 1 ? 'reward' : 'rewards';
  layout.paragraph(
    `${boxCount} unopened ${noun} — open at a dungeon safe room`,
    'warning',
    space.md,
  );
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
