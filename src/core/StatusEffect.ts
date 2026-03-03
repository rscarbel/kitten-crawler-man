/**
 * A status effect applied to a Player (e.g. Burn, Frozen, Paralyzed).
 *
 * Add new status types by adding a string literal to the `type` field.
 * Per-type behaviour is handled in Player.tickStatusEffects().
 * Per-type rendering is handled in HUD.drawStatusIcon().
 */
export interface StatusEffect {
  /** Unique key identifying this status (e.g. 'burn', 'frozen', 'paralyzed'). */
  type: string;
  /** Remaining duration in game ticks (frames at 60 fps). */
  ticksRemaining: number;
  /** Original total duration — used to draw the progress bar in the HUD. */
  totalTicks: number;
}

// ── Preset constructors ───────────────────────────────────────────────────────

/** 8-second burn: 1 damage / second for 8 seconds (480 ticks at 60 fps). */
export function makeBurn(): StatusEffect {
  return { type: 'burn', ticksRemaining: 480, totalTicks: 480 };
}

/** 30-second poison: 1 damage every 2 seconds for 30 seconds (1800 ticks at 60 fps). */
export function makePoison(): StatusEffect {
  return { type: 'poison', ticksRemaining: 1800, totalTicks: 1800 };
}
