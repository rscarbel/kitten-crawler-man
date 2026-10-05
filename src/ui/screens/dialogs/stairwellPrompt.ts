/**
 * "Descend to the next floor?" when the crawler steps onto a stairwell, with
 * the next floor's recommended level and a warning when the party is under it.
 *
 * Descend is the default: stepping onto the stairs is how the player asks to
 * go down, so a bare accept key takes them. Escape and Stay keep them here.
 */

import type { DescentPrompt, PartyStanding } from '../../../systems/StairwellSystem';
import type { Surface, Ui } from '../../core/UiRoot';
import type { PanelWidth } from '../../theme/tokens';
import { badge, badgeSize, type BadgeTone } from '../../widgets/badge';
import { choiceModalSurface } from '../../widgets/choiceModal';
import {
  iconUnlessCompact,
  keyboardHint,
  stackParts,
  swallowAttackKey,
  textPart,
  type ExtraPart,
} from './choiceDialogParts';

/** What the prompt reads and drives; `StairwellSystem` provides all of it. */
export interface StairwellPromptSource {
  readonly menuOpen: boolean;
  descentPrompt(): DescentPrompt;
  descend(): void;
  closeMenu(): void;
}

const PROMPT_WIDTH: PanelWidth = 'sm';
const DESCEND_BUTTON_INDEX = 1;
const STAY_HINT = 'Esc or Stay to remain on this floor';

const STANDING_TONES: Record<PartyStanding, BadgeTone> = {
  below: 'danger',
  met: 'success',
  above: 'neutral',
};

function recommendedPart(ui: Ui, prompt: DescentPrompt): ExtraPart | null {
  const advice = prompt.advice;
  if (advice === null) return null;
  const label = `Recommended level ${advice.recommended}`;
  return {
    height: badgeSize(ui, { label, kind: 'tag' }).h,
    draw: (rect) => badge(ui, rect, { label, kind: 'tag', tone: STANDING_TONES[advice.standing] }),
  };
}

/** The stairwell prompt as a surface: halts the world and keeps the keyboard while it is up. */
export function stairwellPromptSurface(id: string, source: StairwellPromptSource): Surface {
  return choiceModalSurface({
    id,
    band: 'modal',
    isOpen: () => source.menuOpen,
    haltsWorld: true,
    locksKeyboard: true,
    escape: { kind: 'close', onEscape: () => source.closeMenu() },
    onKey: (key, mods) => swallowAttackKey(key, mods, true),
    content: (ui) => {
      const prompt = source.descentPrompt();
      const warning = prompt.warning;
      return {
        id: 'stairwell',
        overline: 'Stairwell',
        icon: iconUnlessCompact(ui, 'chevronDown'),
        title: `Descend to ${prompt.nextFloorName}?`,
        extra: stackParts(ui, [
          recommendedPart(ui, prompt),
          warning === null ? null : textPart(ui, PROMPT_WIDTH, warning, 'warning'),
          keyboardHint(ui, PROMPT_WIDTH, STAY_HINT),
        ]),
        width: PROMPT_WIDTH,
        buttons: [
          { id: 'stay', label: 'Stay', onTap: () => source.closeMenu() },
          { id: 'descend', label: 'Descend', onTap: () => source.descend() },
        ],
        defaultButton: DESCEND_BUTTON_INDEX,
      };
    },
  });
}
