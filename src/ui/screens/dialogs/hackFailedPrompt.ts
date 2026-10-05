/**
 * "SYSTEM BREACH DETECTED" after a failed Keyboard Hero hack. Retreat is the
 * default: Try Again starts a rhythm game the moment it is chosen, which a
 * stray accept key must not do.
 */

import { type Surface, ACTIVATE_KEYS, FOCUS_MOVE_KEYS } from '../../core/UiRoot';
import { choiceModalSurface } from '../../widgets/choiceModal';
import { iconUnlessCompact } from './choiceDialogParts';

/** What the prompt reads and drives; `SpiderQuestSystem` provides all of it. */
export interface HackFailedSource {
  readonly isHackFailedOpen: boolean;
  retryHack(): void;
  retreatFromHack(): void;
  /** Escape: back to the machine without the retreat's music restore, as the quest decides. */
  dismissDialog(): boolean;
}

const RETREAT_BUTTON_INDEX = 1;
/** Left to the focus ring and Escape; every other key is swallowed while the prompt is up. */
const PASSED_KEYS: ReadonlySet<string> = new Set(['Escape', ...FOCUS_MOVE_KEYS, ...ACTIVATE_KEYS]);

/** The failed-hack prompt as a surface: halts the world and keeps every key while it is up. */
export function hackFailedPromptSurface(id: string, source: HackFailedSource): Surface {
  return choiceModalSurface({
    id,
    band: 'modal',
    isOpen: () => source.isHackFailedOpen,
    haltsWorld: true,
    locksKeyboard: true,
    escape: { kind: 'close', onEscape: () => void source.dismissDialog() },
    onKey: (key) => !PASSED_KEYS.has(key),
    content: (ui) => ({
      id: 'hack-failed',
      icon: iconUnlessCompact(ui, 'alert'),
      tone: 'danger',
      overline: 'System breach detected',
      title: 'The firewall rejected your intrusion.',
      buttons: [
        { id: 'retry', label: 'Try Again', onTap: () => source.retryHack() },
        { id: 'retreat', label: 'Retreat', onTap: () => source.retreatFromHack() },
      ],
      defaultButton: RETREAT_BUTTON_INDEX,
    }),
  });
}
