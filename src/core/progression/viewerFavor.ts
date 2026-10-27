/**
 * The viewers' favour: how the galactic audience is taking the party, on a
 * 0–100 meter only the show's AI moves (through `viewer_reaction`).
 *
 * Favour only ever helps. From {@link FAVOR_PERKS}' thresholds up, every reward
 * chest the party earns pays a little more coin; at the bottom of the meter
 * nothing is taken away, because a crawler should never be punished for a
 * model's mood. The perk is deliberately small: it decorates a run, it does
 * not carry one.
 *
 * Party-run state, like the run's tallies: one value for the page's life,
 * written into every save as `viewerFavor`, read back when a save loads and
 * reset when a new run starts.
 */

export const FAVOR_MIN = 0;
export const FAVOR_MAX = 100;
/** Where a new run starts: the audience has not made up its mind. */
export const FAVOR_START = 50;

/** How the meter reads at each height; the first whose `min` the value reaches, scanning from the top. */
export const FAVOR_TIERS = [
  { min: 80, label: 'Adoring' },
  { min: 60, label: 'Hyped' },
  { min: 40, label: 'Watching' },
  { min: 20, label: 'Lukewarm' },
  { min: FAVOR_MIN, label: 'Restless' },
] as const;

export type FavorTierLabel = (typeof FAVOR_TIERS)[number]['label'];

/** The reward-chest coin bonus at each height, highest first. */
export const FAVOR_PERKS = [
  { min: 80, chestCoinMultiplier: 1.2, label: 'Reward chests pay 20% more coins' },
  { min: 60, chestCoinMultiplier: 1.1, label: 'Reward chests pay 10% more coins' },
] as const;

const NO_PERK = { chestCoinMultiplier: 1, label: 'No bonus yet: win the crowd over' } as const;

/** One swing of the meter, as the HUD flashes it. */
export interface FavorSwing {
  readonly delta: number;
  readonly reaction: string;
  /** Counts up with every swing, so the HUD can tell a new one from the last. */
  readonly seq: number;
}

export function clampFavor(value: number): number {
  return Math.max(FAVOR_MIN, Math.min(FAVOR_MAX, Math.round(value)));
}

export function favorTier(value: number): FavorTierLabel {
  const tier = FAVOR_TIERS.find((candidate) => value >= candidate.min);
  return tier?.label ?? 'Restless';
}

export function favorPerk(value: number): {
  readonly chestCoinMultiplier: number;
  readonly label: string;
} {
  return FAVOR_PERKS.find((perk) => value >= perk.min) ?? NO_PERK;
}

/** A save's `viewerFavor`, or undefined when it is not a favour the meter can hold. */
export function parseViewerFavor(raw: unknown): number | undefined {
  if (typeof raw !== 'number' || !Number.isFinite(raw)) return undefined;
  return clampFavor(raw) === raw ? raw : undefined;
}

export class ViewerFavor {
  private current = FAVOR_START;
  private reacted = false;
  private swing: FavorSwing | null = null;
  /** Never resets, so a swing's number is never reused for a later one. */
  private swings = 0;

  get value(): number {
    return this.current;
  }

  /**
   * Whether the viewers have reacted at all this run. The meter is shown only
   * then, so a game played without the AI never carries an idle gauge.
   */
  get engaged(): boolean {
    return this.reacted;
  }

  get lastSwing(): FavorSwing | null {
    return this.swing;
  }

  /** Moves the meter by `delta`, clamped to its range, and returns how far it really moved. */
  adjust(delta: number, reaction: string): number {
    const before = this.current;
    this.current = clampFavor(before + delta);
    this.reacted = true;
    const moved = this.current - before;
    this.swings++;
    this.swing = { delta: moved, reaction, seq: this.swings };
    return moved;
  }

  /** The value a save carries; undefined until the viewers have reacted, so an untouched run writes nothing. */
  serialize(): number | undefined {
    return this.reacted ? this.current : undefined;
  }

  /** Takes up the value a save carried, or starts fresh when it carried none. */
  restore(saved: number | undefined): void {
    this.swing = null;
    if (saved === undefined) {
      this.current = FAVOR_START;
      this.reacted = false;
      return;
    }
    this.current = clampFavor(saved);
    this.reacted = true;
  }

  /**
   * Forgets the last swing, so a scene built after it does not flash it again:
   * the swing belongs to the moment it happened, not to every HUD that follows.
   */
  clearSwing(): void {
    this.swing = null;
  }

  /** A new run: the audience starts over. */
  beginRun(): void {
    this.restore(undefined);
  }
}

/** The run's favour, for the page's life. */
export const viewerFavor = new ViewerFavor();
