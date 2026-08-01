import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { SkillId } from '../core/SkillManager';
import { getSkillDef } from '../core/SkillManager';
import type { GrantedReward } from '../core/GrantedReward';
import type { LevelUpEntry } from '../core/LevelUpEntry';
import type { AudioManager } from '../audio/AudioManager';
import type { SkillBookChoice, SkillBookPrompt } from '../ui/SkillBookPrompt';
import type { SkillBookReadRequest } from '../ui/InventoryInteraction';
import { drawSkillIcon } from '../ui/icons/skillIcons';

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
 * Why this crawler cannot read this book, or null when the read would go ahead.
 *
 * Split out so a caller can find out *before* offering the read — a confirmation
 * prompt that promises a skill and then refuses would be a lie. Nothing is
 * mutated, so it is safe to ask as often as you like.
 */
export function skillBookRefusal(
  reader: HumanPlayer | CatPlayer,
  skillId: SkillId,
): SkillBookUseOutcome | null {
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

  return null;
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
  const refusal = skillBookRefusal(reader, skillId);
  if (refusal !== null) return refusal;

  if (!consume()) {
    return { consumed: false, refusalReason: 'missing', message: null };
  }

  reader.skills.unlockSkill(skillId);
  return { consumed: true, refusalReason: null, message: null };
}

/** A successful read, plus whichever award overlay the scene should now play. */
export interface SkillBookReadResult {
  outcome: SkillBookUseOutcome;
  /** Set when the read taught a skill the reader did not have. */
  grantedReward: GrantedReward | null;
  /** Set when the read pushed a skill the reader already had one level higher. */
  levelUp: LevelUpEntry | null;
}

/**
 * {@link useSkillBook}, plus the award overlay the read earned.
 *
 * Which of the two overlays plays is decided *before* the book is spent — after
 * `unlockSkill` has run, a first read and a second one are indistinguishable
 * from the reader's state alone.
 */
export function readSkillBook(
  reader: HumanPlayer | CatPlayer,
  skillId: SkillId,
  consume: () => boolean,
): SkillBookReadResult {
  const wasUnknown = !reader.skills.isUnlocked(skillId);
  const outcome = useSkillBook(reader, skillId, consume);
  if (!outcome.consumed) {
    return { outcome, grantedReward: null, levelUp: null };
  }

  const def = getSkillDef(skillId);
  const level = reader.skills.getLevel(skillId);
  const renderIcon = (ctx: CanvasRenderingContext2D, x: number, y: number, size: number): void => {
    drawSkillIcon(ctx, x, y, size, skillId);
  };

  if (wasUnknown) {
    return {
      outcome,
      grantedReward: {
        kind: 'skill',
        name: def.name,
        description: def.describeEffect(level),
        renderIcon,
      },
      levelUp: null,
    };
  }

  return {
    outcome,
    grantedReward: null,
    levelUp: {
      name: def.name,
      newLevel: level,
      perkDescription: def.describeEffect(level),
      renderIcon,
    },
  };
}

/** The scene collaborators the two prompt helpers below need. */
export interface SkillBookFlowHost {
  audio: AudioManager | null;
  announce: (message: string) => void;
  prompt: SkillBookPrompt;
  /** Called with the award overlay a successful read earned, if any. */
  showReward: (reward: GrantedReward) => void;
  showLevelUp: (entry: LevelUpEntry) => void;
  /** Closes the bag, so the award overlay replaces it rather than stacking on it. */
  closeInventory: () => void;
}

/**
 * Turns a queued skill-book click into the read confirmation, or into a refusal
 * when this crawler could never read it — offering to spend a book that is about
 * to be handed back would be a lie.
 *
 * Shared by both scenes that own an inventory so the two can't drift on when the
 * prompt appears.
 */
export function promptSkillBookRead(
  host: SkillBookFlowHost,
  reader: HumanPlayer | CatPlayer,
  request: SkillBookReadRequest,
): void {
  const refusal = skillBookRefusal(reader, request.skillId);
  if (refusal !== null) {
    host.audio?.play('error_taking_action');
    if (refusal.message !== null) host.announce(refusal.message);
    return;
  }
  host.prompt.open(request, reader.skills.getLevel(request.skillId));
}

/**
 * Routes a click at the open read prompt, and performs the read if confirmed.
 *
 * @returns the choice made, or null when the click missed both buttons and the
 *   prompt is still up — which is how a caller knows whether to release any
 *   state it pinned for the prompt's lifetime.
 */
export function resolveSkillBookPrompt(
  host: SkillBookFlowHost,
  reader: HumanPlayer | CatPlayer,
  mx: number,
  my: number,
): SkillBookChoice | null {
  const result = host.prompt.handleClick(mx, my);
  if (result === null) return null;
  if (result.choice === 'cancel') return 'cancel';

  host.closeInventory();
  const { outcome, grantedReward, levelUp } = readSkillBook(reader, result.skillId, () =>
    reader.inventory.removeOne(result.bookId),
  );
  host.audio?.play(outcome.consumed ? 'menu_skillpoint_spent' : 'error_taking_action');
  if (outcome.message !== null) host.announce(outcome.message);
  if (grantedReward !== null) host.showReward(grantedReward);
  if (levelUp !== null) host.showLevelUp(levelUp);
  return 'read';
}
