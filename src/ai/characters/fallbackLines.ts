import { TITLE_QUIPS } from '../../scenes/title/titleEvents';
import { SYSTEM_CHARACTER } from './system';

/**
 * What the System says when its server cannot be reached: its own authored
 * catchphrases and the sponsor breaks it reads on the title screen. The game
 * keeps its voice offline instead of going silent.
 */
export const SYSTEM_FALLBACK_LINES: readonly string[] = [
  ...SYSTEM_CHARACTER.personality.voice.catchphrases,
  ...TITLE_QUIPS,
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
