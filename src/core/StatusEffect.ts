import type { Player } from '../Player';

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
  /**
   * Who inflicted this effect, so a tick that lands the killing point of HP is
   * an attributable kill rather than an anonymous one — a mob that dies to the
   * sepsis crown's proc credits the crawler wearing the crown.
   *
   * Null for anything nobody owns: an acid pool, a burning tree, a lava flame,
   * a status restored from a snapshot taken in another scene. Every consumer of
   * kill credit already treats null as "not killed by anyone".
   */
  applier: Player | null;
}

/**
 * The statuses that are done *to* a crawler rather than bought by one.
 *
 * Anything that cures or clears status effects must work from this list rather
 * than wiping `statusEffects` wholesale: a service that takes coin and deletes
 * the Speed Fizz the player just paid for is a trap, not a service. `drunk` is
 * on it because it is a real handicap, even when it was self-inflicted.
 */
export const AILMENT_STATUSES: ReadonlyArray<string> = [
  'burn',
  'magic_burn',
  'poison',
  'sepsis',
  'spit_venom',
  'electrified',
  'stuck',
  'stun',
  'drunk',
];

// Preset constructors

/** 8-second burn: 1 damage / second for 8 seconds (480 ticks at 60 fps). */
export function makeBurn(applier: Player | null = null): StatusEffect {
  return { type: 'burn', ticksRemaining: 480, totalTicks: 480, applier };
}

/** 30-second poison: 1 damage every 2 seconds for 30 seconds (1800 ticks at 60 fps). */
export function makePoison(applier: Player | null = null): StatusEffect {
  return { type: 'poison', ticksRemaining: 1800, totalTicks: 1800, applier };
}

/** Sepsis: permanent DoT (1 damage every 2 seconds) that lasts until the target dies. */
export function makeSepsis(applier: Player | null = null): StatusEffect {
  // 999999 ticks ≈ 4.6 hours — effectively infinite
  return { type: 'sepsis', ticksRemaining: 999999, totalTicks: 999999, applier };
}

/** Magic Burn: 10-second arcane DoT from a level-15 Magic Missile shockwave. 1 dmg/s. */
export function makeMagicBurn(applier: Player | null = null): StatusEffect {
  return { type: 'magic_burn', ticksRemaining: 600, totalTicks: 600, applier };
}

/** Electrified: 10-second DoT + movement slow from level-15 shell shock wave. */
export function makeElectrified(applier: Player | null = null): StatusEffect {
  return { type: 'electrified', ticksRemaining: 600, totalTicks: 600, applier };
}

/** Four seconds at 60 fps. */
const SPIDER_WEB_TICKS = 240;

/**
 * Immobilises the target. Defaults to the spider's web, which is where the
 * effect started; callers that root for a different length pass their own ticks
 * rather than mutating the returned effect.
 */
export function makeStuck(ticks: number = SPIDER_WEB_TICKS): StatusEffect {
  return { type: 'stuck', ticksRemaining: ticks, totalTicks: ticks, applier: null };
}

/** Spider spit venom: acid DoT applied alongside stuck — 1 damage every 40 ticks (~6 dmg over 4 s). */
export function makeSpitVenom(applier: Player | null = null): StatusEffect {
  return { type: 'spit_venom', ticksRemaining: 240, totalTicks: 240, applier };
}

/** Stun: immobilises the target for the given number of ticks. */
export function makeStun(ticks: number): StatusEffect {
  return { type: 'stun', ticksRemaining: ticks, totalTicks: ticks, applier: null };
}

/** Speed Fizz: doubles movement speed for 25 seconds (1500 ticks at 60 fps). */
export function makeSpeedFizz(): StatusEffect {
  return { type: 'speed_fizz', ticksRemaining: 1500, totalTicks: 1500, applier: null };
}

/** Jugg Juice: temporarily boosts max HP by 50% + 5 for 30 seconds (1800 ticks at 60 fps). */
export function makeJuggJuice(): StatusEffect {
  return { type: 'jugg_juice', ticksRemaining: 1800, totalTicks: 1800, applier: null };
}

/** Base drunk duration: 30 seconds at 60 fps. */
const DRUNK_TICKS = 1800;

/**
 * Drunk: 30 seconds (1800 ticks at 60 fps) of swaying camera, a wandering walk and
 * a little extra melee damage. Re-drinking refreshes rather than stacks, which is
 * the intended "keep the round going" loop. See `src/core/DrunkEffect.ts`.
 *
 * @param durationScale Shortens the effect — Iron Stomach passes its time scale.
 */
export function makeDrunk(durationScale = 1): StatusEffect {
  const ticks = Math.max(1, Math.round(DRUNK_TICKS * durationScale));
  return { type: 'drunk', ticksRemaining: ticks, totalTicks: ticks, applier: null };
}

/** Whetstone: three minutes at 60 fps — long enough to be worth carrying out the door. */
const WHETSTONE_TICKS = 10800;

/** Melee damage a freshly-stoned edge adds, on top of strength. */
export const WHETSTONE_MELEE_DAMAGE_BONUS = 3;

/**
 * Whetstone: the smith's edge. Pure melee damage for as long as it holds — no
 * per-tick behaviour, so `Player.tickStatusEffects` only has to count it down.
 */
export function makeWhetstone(): StatusEffect {
  return {
    type: 'whetstone',
    ticksRemaining: WHETSTONE_TICKS,
    totalTicks: WHETSTONE_TICKS,
    applier: null,
  };
}

/** Cooldown Crisp: halves all ability cooldowns for 25 seconds (1500 ticks at 60 fps). */
export function makeCooldownCrisp(): StatusEffect {
  return { type: 'cooldown_crisp', ticksRemaining: 1500, totalTicks: 1500, applier: null };
}
