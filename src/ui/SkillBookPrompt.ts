import type { SkillId } from '../core/SkillManager';
import { getSkillDef } from '../core/SkillManager';
import type { ItemId } from '../core/ItemDefs';
import type { SkillBookReadRequest } from './screens/inventory/InventoryActions';
import type { AudioManager } from '../audio/AudioManager';

export const SKILL_BOOK_PROMPT_TITLE = 'Read Skill Book?';
export const SKILL_BOOK_CONSUMED_WARNING = 'The book is consumed. This cannot be undone.';

/** What the player chose, or null while the prompt is still up. */
export type SkillBookChoice = 'read' | 'cancel';

/** The choice plus the book it was made about, so the caller need hold no state. */
export interface SkillBookPromptResult {
  choice: SkillBookChoice;
  bookId: ItemId;
  skillId: SkillId;
}

/**
 * Confirmation the player gets before spending a skill book.
 *
 * Reading one is irreversible and the book is consumed, so it is the one
 * inventory interaction that asks first. The wording changes with what the read
 * would actually do — teach the skill, or push a skill already known one level
 * higher — which is decided from the reader's own `SkillManager`, not from the
 * item.
 */
export class SkillBookPrompt {
  private request: SkillBookReadRequest | null = null;
  private currentLevel = 0;

  audio: AudioManager | null = null;

  get isOpen(): boolean {
    return this.request !== null;
  }

  /**
   * @param currentLevel The reader's level in this skill, or 0 if they have yet
   *   to learn it — that is what decides between "grant" and "+1" wording.
   */
  open(request: SkillBookReadRequest, currentLevel: number): void {
    // Re-opening on the same book is a no-op: a mobile hotbar tap arrives as
    // both a slot release and an activation, and the second must not re-play
    // the open cue over the first.
    if (this.request?.bookId === request.bookId) return;
    this.request = request;
    this.currentLevel = currentLevel;
    this.audio?.play('menu_open');
  }

  close(): void {
    this.request = null;
  }

  /** The book being asked about, or null while the prompt is down. */
  get pendingRequest(): SkillBookReadRequest | null {
    return this.request;
  }

  /** The prompt's question: teach the skill, or raise one already known. */
  bodyText(): string {
    if (this.request === null) return '';
    const def = getSkillDef(this.request.skillId);
    if (this.currentLevel <= 0) {
      return `Reading this book will permanently grant you the ${def.name} skill.`;
    }
    return (
      `You already know ${def.name}. Reading this book will permanently ` +
      `increase the skill level by +1, to level ${this.currentLevel + 1}.`
    );
  }

  /**
   * Answers the prompt. Returns the choice with the book it was
   * about, or null when the prompt was already down. The prompt closes itself;
   * the caller acts on 'read'.
   */
  choose(choice: SkillBookChoice): SkillBookPromptResult | null {
    const request = this.request;
    if (request === null) return null;
    this.close();
    return { choice, ...request };
  }
}
