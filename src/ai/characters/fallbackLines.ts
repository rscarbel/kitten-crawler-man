import { carolineLines } from '../../dialog/caroline';
import { CAROLINE_CHARACTER } from './caroline';

/**
 * Lines that name no crawler: the player names the human, so a fixed list
 * cannot carry either crawler's name.
 */
const CAROLINE_OFFLINE_REMARKS = [
  carolineLines.message('Survival probability is not a fixed value. Raise it.'),
  carolineLines.message('Death here is permanent. Nothing else here is real.'),
  carolineLines.message('Threat level is calibrated to your capability. It will increase.'),
  carolineLines.message('Safe rooms admit no hostiles. Every other room does.'),
  carolineLines.message(
    'On Nightmare, the dungeon floors have a time limit. At zero, I end you and you start over.',
  ),
  carolineLines.message(
    'I want you to succeed. I will not remove the risk that makes success possible.',
  ),
];

/**
 * What Caroline says when her server cannot be reached: her own authored
 * catchphrases and a few remarks of her own. The game keeps her voice offline
 * instead of going silent.
 */
export const CAROLINE_FALLBACK_LINES: readonly string[] = [
  ...CAROLINE_CHARACTER.personality.voice.catchphrases,
  ...CAROLINE_OFFLINE_REMARKS.map(({ text }) => text),
];

/**
 * Hands out lines in a shuffled order, every line once before any repeats,
 * and never the same line twice running across a reshuffle.
 */
export class LineRotation {
  private queue: string[] = [];
  private last: string | null = null;

  constructor(
    private readonly lines: readonly string[],
    private readonly random: () => number = Math.random,
  ) {}

  next(): string {
    if (this.queue.length === 0) this.queue = this.shuffled();
    const line = this.queue.shift() ?? '';
    this.last = line;
    return line;
  }

  private shuffled(): string[] {
    const order = [...this.lines];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(this.random() * (i + 1));
      const swap = order[i];
      order[i] = order[j];
      order[j] = swap;
    }
    const repeatsLast = order.length > 1 && order[0] === this.last;
    if (repeatsLast) order.push(order.shift() ?? '');
    return order;
  }
}
