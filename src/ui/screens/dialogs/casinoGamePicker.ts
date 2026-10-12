/**
 * The Desperado Club casino's first question: which game. Blackjack is always
 * open; Texas Hold'em is offered only when the party can cover the smallest
 * buy-in, and says so when it can't.
 */

import type { Surface } from '../../core/UiRoot';
import { choiceModalSurface } from '../../widgets/choiceModal';

export interface CasinoGamePickerOptions {
  readonly id: string;
  readonly isOpen: () => boolean;
  /** The cheapest poker buy-in, shown in the blurb and the refusal. */
  readonly minPokerBuyIn: number;
  /** The blackjack table's betting range, for its blurb. */
  readonly blackjackBets: { readonly min: number; readonly max: number };
  /** Whether the party can cover {@link minPokerBuyIn} right now. */
  readonly canBuyIntoPoker: () => boolean;
  readonly onBlackjack: () => void;
  readonly onPoker: () => void;
  readonly onClose: () => void;
}

const TITLE = 'Play Cards';
const OVERLINE = 'CASINO';
const BLACKJACK_LABEL = 'Blackjack';
const POKER_LABEL = "Texas Hold'em";
/** Both games sit side by side in one row. */
const GAME_COUNT = 2;

/** The game picker as a modal: Escape and ✕ walk away from the table. */
export function casinoGamePickerSurface(opts: CasinoGamePickerOptions): Surface {
  return choiceModalSurface({
    id: opts.id,
    isOpen: opts.isOpen,
    haltsWorld: true,
    locksKeyboard: true,
    escape: { kind: 'close', onEscape: opts.onClose },
    content: () => {
      const minBuyIn = opts.minPokerBuyIn.toLocaleString('en-US');
      const pokerRefusal = `You need ${minBuyIn} coins to buy in`;
      return {
        id: 'picker',
        overline: OVERLINE,
        title: TITLE,
        body: [
          `${BLACKJACK_LABEL}: Deuce's table · bets ${opts.blackjackBets.min}–${opts.blackjackBets.max}`,
          `${POKER_LABEL}: Six-handed · buy-in from ${minBuyIn}`,
        ],
        width: 'md',
        buttonsPerRow: GAME_COUNT,
        buttons: [
          { id: 'blackjack', label: BLACKJACK_LABEL, icon: 'sparkle', onTap: opts.onBlackjack },
          {
            id: 'poker',
            label: POKER_LABEL,
            icon: 'coin',
            disabled: opts.canBuyIntoPoker() ? false : pokerRefusal,
            onTap: opts.onPoker,
          },
        ],
        defaultButton: 0,
        onClose: opts.onClose,
        onScrimTap: opts.onClose,
      };
    },
  });
}
