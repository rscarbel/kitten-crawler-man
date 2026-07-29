import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { SkillId } from '../core/SkillManager';
import { getSkillDef } from '../core/SkillManager';

/** What a scene should do after a crawler tried to read a skill book. */
export interface SkillBookUseOutcome {
  /** Whether the book was spent. A refused read leaves it in the pack. */
  consumed: boolean;
  /** Set when the read failed, so the caller can play an error sound. */
  refusalReason: 'wrong_crawler' | 'already_mastered' | 'missing' | null;
  /**
   * System-AI line to announce, or null when the unlock itself already
   * announced through `SkillManager`'s event queue.
   */
  message: string | null;
}

/**
 * Read a skill book.
 *
 * The single place the refusal cases live, so the dungeon and building interiors
 * can't drift on which reads consume the book. The outcome is decided against
 * `previewUnlock` *before* anything is spent, and the book is consumed before
 * the skill is granted — the same order every other consumable in
 * `triggerHotbarActivation` uses, so a failed consume can never hand out a free
 * skill.
 *
 * @param consume Removes one copy from the reader's inventory; false if there
 *   was nothing to remove.
 */
export function useSkillBook(
  reader: HumanPlayer | CatPlayer,
  skillId: SkillId,
  consume: () => boolean,
): SkillBookUseOutcome {
  const def = getSkillDef(skillId);
  const outcome = reader.skills.previewUnlock(skillId);

  if (outcome === 'not_eligible') {
    return {
      consumed: false,
      refusalReason: 'wrong_crawler',
      message: `${def.name} is not written for you. The System suggests handing it to someone with the correct number of legs.`,
    };
  }

  if (outcome === 'already_max') {
    return {
      consumed: false,
      refusalReason: 'already_mastered',
      message: `${def.name} is already at maximum. Sell it. Capitalism finds a way.`,
    };
  }

  if (!consume()) {
    return { consumed: false, refusalReason: 'missing', message: null };
  }

  reader.skills.unlockSkill(skillId);
  return { consumed: true, refusalReason: null, message: null };
}
