import type { AudioManager } from '../audio/AudioManager';
import { MAGIC_MISSILE_SPARK_LEVEL } from '../abilities/magicMissile';
import type { AbilityManager } from '../core/skills/AbilityManager';
import type { MenusKit } from './kits/MenusKit';

/** What a scene hands over for its ability level-ups to land on it. */
export interface AbilityLevelUpTarget {
  readonly abilityManager: AbilityManager;
  readonly menus: MenusKit;
  readonly audio: AudioManager | null;
  /** Mongo grew: his stored health has to be rescaled onto the bigger animal. */
  onPetLevelUp(): void;
  /** Magic Missile reached the level its achievement asks for. */
  onSparkLevel(): void;
}

/**
 * Binds the shared ability manager's level-ups to one scene: the pet's health
 * rescale, the talisman, the award queued on that scene's own dialog and its
 * chime.
 *
 * The manager is handed across every door and every floor, so each scene must
 * bind it as it is built. Left bound to the scene before, a level earned here
 * queues its award on a dialog nobody draws, and a pet that grew keeps a stored
 * health scaled to the smaller animal.
 */
export function bindAbilityLevelUps(target: AbilityLevelUpTarget): void {
  const { abilityManager, menus, audio } = target;
  abilityManager.onLevelUp = (id, newLevel) => {
    if (id === 'mongo') target.onPetLevelUp();
    if (id === 'magic_missile' && newLevel >= MAGIC_MISSILE_SPARK_LEVEL) {
      target.onSparkLevel();
    }
    const def = abilityManager.getDef(id);
    if (def === null) return;
    menus.levelUpDialog.enqueue({
      name: def.name,
      newLevel,
      perkDescription: def.perks.find((perk) => perk.level === newLevel)?.description ?? null,
      renderIcon: def.renderIcon,
    });
    audio?.play('ability_level_up');
  };
}
