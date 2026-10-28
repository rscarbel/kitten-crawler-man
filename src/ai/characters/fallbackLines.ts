import { TITLE_QUIPS } from '../../scenes/title/titleEvents';
import { CAROLINE_CHARACTER } from './caroline';

/**
 * What Caroline says when her server cannot be reached: her own authored
 * catchphrases and the lines she shows on the title screen. The game keeps
 * her voice offline instead of going silent.
 */
export const CAROLINE_FALLBACK_LINES: readonly string[] = [
  ...CAROLINE_CHARACTER.personality.voice.catchphrases,
  ...TITLE_QUIPS.map(({ text }) => text),
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
