import type { AudioManager } from '../audio/AudioManager';
import type { EventBus } from '../core/EventBus';
import { CRAWLER_NAMES } from '../core/SkillManager';
import { describeConstructionPerk, describeResourcingPerk } from '../core/craftPerks';
import { drawCraftSkillIcon } from '../ui/icons/craftSkillIcons';
import type { MenusKit } from './kits/MenusKit';

const CRAFT_SKILL_ICON_INNER_PADDING = 2;

const CRAFT_SKILL_LABELS = {
  resourcing: 'Resourcing',
  construction: 'Construction',
} as const;

/** What a scene hands over for its craft-skill level-ups to land on it. */
export interface CraftLevelUpTarget {
  readonly bus: EventBus;
  readonly menus: MenusKit;
  readonly audio: AudioManager | null;
}

/**
 * Binds `craftSkillLevelUp` to one scene's level-up dialog and chime, mirroring
 * {@link bindAbilityLevelUps}. Each scene owns a fresh `EventBus`, so this is
 * rebound on every scene build rather than needing an explicit unsubscribe.
 */
export function bindCraftLevelUps(target: CraftLevelUpTarget): void {
  const { bus, menus, audio } = target;
  bus.on('craftSkillLevelUp', ({ crawler, id, level }) => {
    menus.cancelInventoryDragForOverlay();
    menus.levelUpDialog.enqueue({
      name: `${CRAWLER_NAMES[crawler]} — ${CRAFT_SKILL_LABELS[id]}`,
      newLevel: level,
      perkDescription:
        id === 'resourcing' ? describeResourcingPerk(level) : describeConstructionPerk(level),
      renderIcon: (ctx, x, y, size) =>
        drawCraftSkillIcon(
          ctx,
          id,
          x + CRAFT_SKILL_ICON_INNER_PADDING,
          y + CRAFT_SKILL_ICON_INNER_PADDING,
          size - CRAFT_SKILL_ICON_INNER_PADDING * 2,
        ),
    });
    audio?.play('ability_level_up');
  });
}
