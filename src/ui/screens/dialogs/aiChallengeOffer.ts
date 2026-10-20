/**
 * The card a challenge from the show's AI arrives on: what it asks, the box
 * it pays and Accept / Decline. It halts the world, so the clock cannot start
 * before the player has read it.
 *
 * Accept is the default: the challenge risks nothing but its own box, so a
 * player reading through with Space takes it, as a quest offer is taken.
 * Escape and Decline turn it down.
 */

import { displayNameOf } from '../../../ai/AIChatFeed';
import { SYSTEM_CHARACTER_NAME } from '../../../ai/characters';
import type { BoxTier } from '../../../core/AchievementManager';
import type { Surface, Ui } from '../../core/UiRoot';
import type { PanelWidth } from '../../theme/tokens';
import { badge, badgeSize } from '../../widgets/badge';
import { choiceModalSurface } from '../../widgets/choiceModal';
import { lootTierColor } from './canvasChrome';
import {
  iconUnlessCompact,
  keyboardHint,
  stackParts,
  swallowAttackKey,
  type ExtraPart,
} from './choiceDialogParts';

/** A challenge on the card, as the offer reads it. */
export interface AIChallengeOfferView {
  readonly title: string;
  readonly objective: string;
  /** The AI's sell; may be empty. */
  readonly pitch: string;
  readonly rewardTier: BoxTier;
  readonly offeredBy: string;
}

/** What the card reads and drives; `AIChallengeSystem` provides it through the show stage. */
export interface AIChallengeOfferSource {
  readonly challengeOffer: AIChallengeOfferView | null;
  acceptChallenge(): void;
  declineChallenge(): void;
}

const OFFER_WIDTH: PanelWidth = 'sm';
const ACCEPT_BUTTON_INDEX = 1;
const DECLINE_HINT = 'Esc or Decline to pass';

function rewardPart(ui: Ui, tier: BoxTier): ExtraPart {
  const label = `Reward: ${tier} box`;
  return {
    height: badgeSize(ui, { label, kind: 'tag' }).h,
    draw: (rect) => badge(ui, rect, { label, kind: 'tag', color: lootTierColor(ui.theme, tier) }),
  };
}

export function aiChallengeOfferSurface(id: string, source: AIChallengeOfferSource): Surface {
  return choiceModalSurface({
    id,
    band: 'modal',
    isOpen: () => source.challengeOffer !== null,
    haltsWorld: true,
    locksKeyboard: true,
    escape: { kind: 'close', onEscape: () => source.declineChallenge() },
    onKey: (key, mods) => swallowAttackKey(key, mods, true),
    content: (ui) => {
      const offer = source.challengeOffer;
      const body =
        offer === null ? [] : [offer.objective, ...(offer.pitch === '' ? [] : [offer.pitch])];
      return {
        id: 'ai-challenge',
        overline: `A challenge from ${displayNameOf(offer?.offeredBy ?? SYSTEM_CHARACTER_NAME)}`,
        icon: iconUnlessCompact(ui, 'trophy'),
        tone: 'accent',
        title: offer?.title ?? '',
        body,
        extra: stackParts(ui, [
          offer === null ? null : rewardPart(ui, offer.rewardTier),
          keyboardHint(ui, OFFER_WIDTH, DECLINE_HINT),
        ]),
        width: OFFER_WIDTH,
        buttons: [
          { id: 'decline', label: 'Decline', onTap: () => source.declineChallenge() },
          { id: 'accept', label: 'Accept', onTap: () => source.acceptChallenge() },
        ],
        defaultButton: ACCEPT_BUTTON_INDEX,
      };
    },
  });
}
