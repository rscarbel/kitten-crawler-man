/**
 * Deuce, the Desperado Club's blackjack dealer — drawn at runtime like the rest
 * of the club's cast, in two renderings. The painters live in `art/deuce/`.
 *
 * The **world figure** stands behind the table on the club floor. It is drawn
 * in two passes around the table: the body before it, the arms and hands
 * after it, because the hands lie on the felt. The **portrait** lives inside
 * the panel and is the one the player actually looks at: chest up, working
 * the deck, eyes on the cards, with a reaction for every outcome.
 */

import { lerp } from './art/carlArt';
import { scaleHumanoidBox } from './humanoidScale';
import { deucePoseAt, type DealerState } from './art/deuce/motion';
import { paintDeucePortrait } from './art/deuce/portrait';
import { paintDeuceWorldBody, paintDeuceWorldHands } from './art/deuce/world';
import type { TablePhase } from '../systems/casino/BlackjackTable';
import type { RoundOutcome } from '../systems/casino/blackjackRules';

export type { DealerState } from './art/deuce/motion';

export interface DealerPortraitOpts {
  /** −1→1 horizontal hint for the pupils: where the panel's live hand is. */
  lookX?: number;
  /**
   * −1→1 vertical hint: the panel points it at whichever hand is live. Each
   * state decides how far the hint may steer him; one that is watching
   * something particular keeps its own gaze.
   */
  lookY?: number;
}

/**
 * Deuce from the chest up, filling the rect (x, y, w, h). Everything scales off
 * the rect, so the wide panel's tall portrait and the compact header's little
 * bust are the same drawing at two sizes. `phaseMs` is a real millisecond clock.
 */
export function drawDeucePortrait(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  state: DealerState,
  phaseMs: number,
  opts: DealerPortraitOpts = {},
): void {
  const pose = deucePoseAt(state, phaseMs);
  const own = pose.expression;
  const share = pose.panelGazeShare;
  const expression = {
    ...own,
    lookX: lerp(own.lookX, opts.lookX ?? own.lookX, share),
    lookY: lerp(own.lookY, opts.lookY ?? own.lookY, share),
  };
  paintDeucePortrait(ctx, x, y, w, h, { ...pose, expression });
}

/**
 * Deuce's body standing at the table on the club floor, sized to a `s`-pixel
 * tile box exactly like the other club NPCs. `dealing` works the deck while the
 * table is open; otherwise he rests. Draw {@link drawCasinoDealerHands} after
 * the table with the same arguments.
 */
export function drawCasinoDealer(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  phaseMs: number,
  dealing: boolean,
): void {
  const box = scaleHumanoidBox(sx, sy, s);
  paintDeuceWorldBody(ctx, box.sx, box.sy, box.s, phaseMs, dealing);
}

/** Deuce's arms and hands, lying over the table's rim onto the felt — the pass drawn over the table. */
export function drawCasinoDealerHands(
  ctx: CanvasRenderingContext2D,
  sx: number,
  sy: number,
  s: number,
  phaseMs: number,
  dealing: boolean,
): void {
  const box = scaleHumanoidBox(sx, sy, s);
  paintDeuceWorldHands(ctx, box.sx, box.sy, box.s, phaseMs, dealing);
}

/** Which portrait state a phase and outcome imply, so callers don't hand-roll the mapping. */
export function dealerStateFor(
  phase: TablePhase,
  outcomeKind: RoundOutcome['kind'] | null,
  dealerBusted: boolean,
  holeRevealed: boolean,
): DealerState {
  switch (phase) {
    case 'dealing':
      return 'dealing';
    case 'player_turn':
      return 'waiting_on_player';
    case 'dealer_turn':
      return holeRevealed ? 'dealing' : 'flipping';
    case 'settled':
      if (dealerBusted) return 'bust';
      if (outcomeKind === 'player_blackjack') return 'impressed';
      if (outcomeKind === 'player_win') return 'concede';
      if (outcomeKind === 'dealer_win') return 'smug';
      return 'idle';
    case 'betting':
    case 'turned_away':
      return 'idle';
  }
}
