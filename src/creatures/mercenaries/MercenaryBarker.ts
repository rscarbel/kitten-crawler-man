import {
  BARK_COOLDOWN_FRAMES,
  BARK_MIN_GAP_FRAMES,
  GAP_EXEMPT_TRIGGERS,
  linesFor,
  type MercenaryBarkTrigger,
  type MercenaryGrunt,
  type MercenaryVoice,
} from './mercenaryVoices';
import type { BarkLine, NonEmpty } from '../../dialog/line';

/** What one bark comes out as: words, a stage direction, a noise, or a direction with a noise. */
export interface MercenaryUtterance {
  readonly text: string | null;
  /** True for a stage direction rather than a spoken line. */
  readonly italic: boolean;
  readonly grunt: MercenaryGrunt | null;
}

/**
 * Decides whether a hireling may speak right now and picks what it says.
 *
 * Holds only timing and repetition state; the words live in the voice table
 * and the drawing in `TimedSpeech`. Counted in its own ticks rather than a
 * shared clock so it pauses whenever the hireling's update does.
 */
export class MercenaryBarker {
  private frame = 0;
  private lastBarkFrame = Number.NEGATIVE_INFINITY;
  private readonly lastFrameByTrigger = new Map<MercenaryBarkTrigger, number>();
  /** The line said last per trigger, so the same trigger never says the same thing twice running. */
  private readonly lastLineByTrigger = new Map<MercenaryBarkTrigger, string>();

  constructor(
    private readonly voice: MercenaryVoice,
    private readonly random: () => number = Math.random,
  ) {}

  tick(): void {
    this.frame++;
  }

  /** Whether `trigger` is off cooldown and clear of the minimum gap, without spending either. */
  canBark(trigger: MercenaryBarkTrigger): boolean {
    if (!this.hasAnything(trigger)) return false;
    if (
      !GAP_EXEMPT_TRIGGERS.has(trigger) &&
      this.frame - this.lastBarkFrame < BARK_MIN_GAP_FRAMES
    ) {
      return false;
    }
    const lastForTrigger = this.lastFrameByTrigger.get(trigger);
    return (
      lastForTrigger === undefined || this.frame - lastForTrigger >= BARK_COOLDOWN_FRAMES[trigger]
    );
  }

  /**
   * Picks what to say for `trigger` and starts its cooldowns, or returns null
   * when the hireling must stay quiet. A trigger the voice has nothing for
   * spends no cooldown, so it never blocks a trigger that does.
   */
  bark(trigger: MercenaryBarkTrigger): MercenaryUtterance | null {
    if (!this.canBark(trigger)) return null;
    const spoken = linesFor(this.voice.lines, trigger);
    const narrated = linesFor(this.voice.actions, trigger);
    const pool = spoken ?? narrated;
    const text = pool === undefined ? null : this.pickLine(trigger, pool);
    const italic = text !== null && pool === narrated;
    const grunt = this.voice.grunts?.[trigger] ?? null;

    this.lastBarkFrame = this.frame;
    this.lastFrameByTrigger.set(trigger, this.frame);
    return { text, italic, grunt };
  }

  private hasAnything(trigger: MercenaryBarkTrigger): boolean {
    const grunt = this.voice.grunts?.[trigger];
    return (
      linesFor(this.voice.lines, trigger) !== undefined ||
      linesFor(this.voice.actions, trigger) !== undefined ||
      grunt !== undefined
    );
  }

  private pickLine(trigger: MercenaryBarkTrigger, pool: NonEmpty<BarkLine>): string {
    const previous = this.lastLineByTrigger.get(trigger);
    const fresh = pool.length > 1 ? pool.filter((line) => line.paragraphs[0] !== previous) : pool;
    const index = Math.min(fresh.length - 1, Math.floor(this.random() * fresh.length));
    const line = fresh[index];
    this.lastLineByTrigger.set(trigger, line.paragraphs[0]);
    return line.paragraphs[0];
  }
}
