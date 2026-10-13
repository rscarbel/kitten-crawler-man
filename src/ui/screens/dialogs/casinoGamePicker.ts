/**
 * The Desperado Club casino's first question: which game. Slots, blackjack and
 * the wheel are always open; Texas Hold'em is offered only when the party can
 * cover the smallest buy-in, and says so when it can't.
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
  readonly onSlots: () => void;
  readonly onPoker: () => void;
  readonly onBlackjack: () => void;
  /** Opens the wheel's warnings, never the wheel itself. */
  readonly onWheel: () => void;
  readonly onClose: () => void;
}

const TITLE = 'Pick a Game';
const OVERLINE = 'CASINO';
const SLOTS_LABEL = 'Slots';
const POKER_LABEL = "Texas Hold'em";
const BLACKJACK_LABEL = 'Blackjack';
const WHEEL_LABEL = 'Wheel of Fortune';
/** Four games read as a 2×2 grid wherever the labels fit side by side. */
const GAME_COLUMNS = 2;

/** The game picker as a modal: Escape and ✕ walk away from the table. */
export function casinoGamePickerSurface(opts: CasinoGamePickerOptions): Surface {
  return choiceModalSurface({
    id: opts.id,
    isOpen: opts.isOpen,
    haltsWorld: true,
    locksKeyboard: true,
    escape: { kind: 'close', onEscape: opts.onClose },
    content: (ui) => {
      const minBuyIn = opts.minPokerBuyIn.toLocaleString('en-US');
      const canBuyIn = opts.canBuyIntoPoker();
      const pokerRefusal = `You need ${minBuyIn} coins to buy in`;
      const blackjackBets = `bets ${opts.blackjackBets.min}–${opts.blackjackBets.max}`;
      // A phone on its side has no height for a blurb list above the pinned
      // grid, so each game carries its blurb on its own button instead.
      const short = ui.size === 'compact' && ui.viewport.w > ui.viewport.h;
      const hints = {
        slots: 'Loud, bright, pays often',
        poker: canBuyIn ? `Six-handed · buy-in ${minBuyIn}` : `Needs ${minBuyIn} coins`,
        blackjack: `Deuce's table · ${blackjackBets}`,
        wheel: 'One wedge ends your run',
      };
      const hint = (line: string): string | undefined => (short ? line : undefined);
      return {
        id: 'picker',
        overline: OVERLINE,
        title: TITLE,
        body: short
          ? undefined
          : [
              `${SLOTS_LABEL}: Bright, loud and pays out often`,
              `${POKER_LABEL}: Six-handed · buy-in from ${minBuyIn}`,
              `${BLACKJACK_LABEL}: Deuce's table · ${blackjackBets}`,
              `${WHEEL_LABEL}: Tito's wheel · one wedge ends your run for good`,
            ],
        width: 'md',
        buttonColumns: GAME_COLUMNS,
        buttons: [
          {
            id: 'slots',
            label: SLOTS_LABEL,
            hint: hint(hints.slots),
            icon: 'cherry',
            onTap: opts.onSlots,
          },
          {
            id: 'poker',
            label: POKER_LABEL,
            hint: hint(hints.poker),
            icon: 'coin',
            disabled: canBuyIn ? false : pokerRefusal,
            onTap: opts.onPoker,
          },
          {
            id: 'blackjack',
            label: BLACKJACK_LABEL,
            hint: hint(hints.blackjack),
            icon: 'sparkle',
            onTap: opts.onBlackjack,
          },
          {
            id: 'wheel',
            label: WHEEL_LABEL,
            hint: hint(hints.wheel),
            icon: 'skull',
            variant: 'danger',
            onTap: opts.onWheel,
          },
        ],
        defaultButton: 0,
        onClose: opts.onClose,
        onScrimTap: opts.onClose,
      };
    },
  });
}
