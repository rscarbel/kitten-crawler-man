/**
 * The card a challenge from the AI arrives on: what it asks, the box
 * it pays and Accept / Decline. It halts the world, so the clock cannot start
 * before the player has read it.
 *
 * Accept is the default: the challenge risks nothing but its own box, so a
 * player reading through with Space takes it, as a quest offer is taken.
 * Escape and Decline turn it down.
 */

import { speaksInCarolineFrame } from '../../../ai/AIChatFeed';
import { CAROLINE_CHARACTER_NAME } from '../../../ai/characters';
import type { Rarity } from '../../../core/items/defs/rarity';
import type { Surface, Ui } from '../../core/UiRoot';
import type { PanelWidth } from '../../theme/tokens';
import { badge, badgeSize } from '../../widgets/badge';
import { choiceModalSurface } from '../../widgets/choiceModal';
import { rarityColor } from './canvasChrome';
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
  readonly rewardRarity: Rarity;
  readonly offeredBy: string;
}

/** What the card reads and drives; `AIChallengeSystem` provides it through `AIInteractionStage`. */
export interface AIChallengeOfferSource {
  readonly challengeOffer: AIChallengeOfferView | null;
  acceptChallenge(): void;
  declineChallenge(): void;
}

const OFFER_WIDTH: PanelWidth = 'sm';
const ACCEPT_BUTTON_INDEX = 1;
const DECLINE_HINT = 'Esc or Decline to pass';

function rewardPart(ui: Ui, rarity: Rarity): ExtraPart {
  const label = `Reward: ${rarity} chest`;
  return {
    height: badgeSize(ui, { label, kind: 'tag' }).h,
    draw: (rect) => badge(ui, rect, { label, kind: 'tag', color: rarityColor(ui.theme, rarity) }),
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
      const offeredBy = offer?.offeredBy ?? CAROLINE_CHARACTER_NAME;
      return {
        id: 'ai-challenge',
        chrome: speaksInCarolineFrame(offeredBy) ? 'caroline' : 'glass',
        overline: `A challenge from ${offeredBy}`,
        icon: iconUnlessCompact(ui, 'trophy'),
        tone: 'accent',
        title: offer?.title ?? '',
        body,
        extra: stackParts(ui, [
          offer === null ? null : rewardPart(ui, offer.rewardRarity),
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
