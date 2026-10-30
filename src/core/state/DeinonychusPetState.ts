/**
 * The part of Deinonychus that outlives a summon.
 *
 * His HP is now persistent: it does not reset when he is called back, it does
 * not reset when he is summoned again, and it regenerates only while he is off
 * duty. That makes it party state rather than creature state — the `Deinonychus`
 * instance is thrown away on every despawn, so anything stored on it is lost.
 *
 * Threaded through `DungeonSceneOptions` by reference, exactly like the quest
 * progress objects, so it survives floor transitions and building entries.
 */

import { WORLD_TICKS_PER_SECOND } from '../constants';

export interface DeinonychusPetState {
  /** Current HP, carried across summons. Zero means he has to rest first. */
  hp: number;
  /**
   * Frames since the last recovery tick.
   *
   * Kept here rather than on `DeinonychusSystem` because every scene builds its own
   * system: parked on one, every floor transition and every door threw away
   * most of a tick.
   */
  regenFrames: number;
  /**
   * The maximum HP the stored value was last measured against.
   *
   * Kept rather than re-derived from `level - 1`: god mode pins the level Deinonychus
   * reports, so the previous level's maximum is not what his stored HP was
   * actually scaled to, and rescaling against it heals or guts him on every
   * level-up.
   */
  scaledAgainstMaxHp: number;
  /**
   * Set when he leaves the field spent, and held until he is back to *full*.
   *
   * Being knocked out is the one thing that costs real time. Without the latch he
   * is summonable again as soon as he clears the ordinary summon floor — the
   * player sends a dinosaur in, watches him collapse, and sends the same dinosaur
   * back in well before he has recovered from it. The latch is what makes a
   * knockout cost the whole climb to full rather than the climb to fit-to-fight.
   * It has to survive a reload, or quitting to the menu is a way of skipping the
   * recovery.
   */
  restingUntilFull: boolean;
  /**
   * Whether the knockout rule has already been stated this run.
   *
   * Lives beside the latch it explains rather than on `DeinonychusSystem`, because the
   * two have to share a lifetime. {@link restingUntilFull} stays true for the
   * half minute of regen a knockout costs, and the notice is raised from
   * that state rather than from the despawn that produced it — so a flag scoped
   * to the system, which is rebuilt for every scene, turns "once" into once per
   * stairwell and once per shop door. The player was told three times.
   *
   * Deliberately absent from {@link DeinonychusPetStateCheckpoint} and from the saved
   * fields: a checkpoint rewind must not un-teach a rule the player has already
   * read, and persisting it lets an autosave mark taught a rule that was never
   * shown.
   */
  knockoutRuleExplained: boolean;
}

/**
 * A point-in-time copy of the pet state, for the in-run safe-room checkpoint.
 *
 * Every field is a primitive, so the record itself is the only container that
 * needs copying — and it is copied on the way out *and* on the way back in,
 * because the player can die many times against one checkpoint.
 */
export interface DeinonychusPetStateCheckpoint {
  hp: number;
  regenFrames: number;
  scaledAgainstMaxHp: number;
  restingUntilFull: boolean;
}

export function captureDeinonychusPetState(
  state: DeinonychusPetState,
): DeinonychusPetStateCheckpoint {
  return {
    hp: state.hp,
    regenFrames: state.regenFrames,
    scaledAgainstMaxHp: state.scaledAgainstMaxHp,
    restingUntilFull: state.restingUntilFull,
  };
}

/**
 * Rewinds the pet state in place.
 *
 * In place because this object is threaded by reference through every scene and
 * through `DeinonychusSystem` itself — replacing it would leave both holding the old
 * one. Must run *after* `DeinonychusSystem.dismiss`, which writes the live creature's
 * remaining HP into these same fields on its way out.
 */
export function restoreDeinonychusPetState(
  state: DeinonychusPetState,
  snapshot: DeinonychusPetStateCheckpoint,
): void {
  state.hp = snapshot.hp;
  state.regenFrames = snapshot.regenFrames;
  state.scaledAgainstMaxHp = snapshot.scaledAgainstMaxHp;
  state.restingUntilFull = snapshot.restingUntilFull;
}

export function createDeinonychusPetState(
  hp: number,
  maxHp: number,
  restingUntilFull = hp <= 0,
): DeinonychusPetState {
  return {
    hp,
    regenFrames: 0,
    scaledAgainstMaxHp: maxHp,
    restingUntilFull,
    knockoutRuleExplained: false,
  };
}

/**
 * Frames of off-duty recovery left before he is fit to be sent in again.
 *
 * Zero once he is summonable — which, while he is resting off a knockout, means
 * once he is at full health rather than once he has a hit point.
 *
 * `minSummonHp` is passed in rather than read from {@link DEINONYCHUS_MIN_SUMMON_HP}
 * because the floor is no longer a constant: a pet too wounded to fight is held
 * back until he can, and a countdown measured against a floor the button does
 * not use reaches zero over a button that still refuses.
 */
export function deinonychusFramesUntilReady(
  state: DeinonychusPetState,
  maxHp: number,
  minSummonHp: number,
): number {
  const targetHp = state.restingUntilFull ? maxHp : minSummonHp;
  if (state.hp >= targetHp) return 0;
  const healPerTick = Math.max(1, Math.ceil(maxHp * DEINONYCHUS_REGEN_PERCENT));
  const ticksNeeded = Math.ceil((targetHp - state.hp) / healPerTick);
  return Math.max(1, ticksNeeded * DEINONYCHUS_REGEN_INTERVAL_FRAMES - state.regenFrames);
}

/** The whole recovery, for scaling the countdown's drain overlay. */
export function deinonychusTotalRecoveryFrames(
  state: DeinonychusPetState,
  maxHp: number,
  minSummonHp: number,
): number {
  const targetHp = state.restingUntilFull ? maxHp : minSummonHp;
  const healPerTick = Math.max(1, Math.ceil(maxHp * DEINONYCHUS_REGEN_PERCENT));
  return Math.max(1, Math.ceil(targetHp / healPerTick) * DEINONYCHUS_REGEN_INTERVAL_FRAMES);
}

/**
 * Off-duty recovery: a {@link DEINONYCHUS_REGEN_TICKS_TO_FULL}th of his maximum,
 * rounded up, every {@link DEINONYCHUS_REGEN_INTERVAL_FRAMES} frames.
 *
 * Rounded up rather than down so the tick count to full can never exceed
 * {@link DEINONYCHUS_REGEN_TICKS_TO_FULL} — the rounding is what keeps the 30-second
 * ceiling a ceiling at every level, including a juvenile whose share of a tick
 * is a fraction of a hit point.
 *
 * Call once per game frame from any scene the party can be in while the pet is
 * not summoned.
 */
export function tickDeinonychusRegen(state: DeinonychusPetState, maxHp: number): void {
  if (state.hp >= maxHp) {
    state.hp = Math.min(state.hp, maxHp);
    state.regenFrames = 0;
    state.restingUntilFull = false;
    return;
  }
  state.regenFrames++;
  if (state.regenFrames < DEINONYCHUS_REGEN_INTERVAL_FRAMES) return;
  state.regenFrames = 0;
  state.hp = Math.min(maxHp, state.hp + Math.ceil(maxHp * DEINONYCHUS_REGEN_PERCENT));
  // Cleared on the tick that tops him up rather than on the next one, or the
  // button reads 'Resting' over a countdown of zero for a frame.
  if (state.hp >= maxHp) state.restingUntilFull = false;
}

/**
 * Brings the off-duty recovery forward by `frames`, returning the wait that
 * actually removed.
 *
 * The return value is the point of the function. `frames` is what was offered,
 * not what was taken: the last kill before he comes up only cuts the seconds
 * that were left, and one landing on a pet who is already fit cuts nothing.
 * Anything reporting the boost to the player has to say what happened, not what
 * was asked for.
 *
 * Carries the leftover into `regenFrames` rather than zeroing it the way an
 * ordinary tick does, because a boost is a whole chunk of time arriving at once
 * and dropping its remainder would make a large one worth less than the sum of
 * the small ones it replaced.
 */
export function advanceDeinonychusRecovery(
  state: DeinonychusPetState,
  maxHp: number,
  minSummonHp: number,
  frames: number,
): number {
  const waitBefore = deinonychusFramesUntilReady(state, maxHp, minSummonHp);
  if (waitBefore <= 0 || frames <= 0) return 0;

  state.regenFrames += frames;
  const healPerTick = Math.max(1, Math.ceil(maxHp * DEINONYCHUS_REGEN_PERCENT));
  while (state.regenFrames >= DEINONYCHUS_REGEN_INTERVAL_FRAMES && state.hp < maxHp) {
    state.regenFrames -= DEINONYCHUS_REGEN_INTERVAL_FRAMES;
    state.hp = Math.min(maxHp, state.hp + healPerTick);
  }
  if (state.hp >= maxHp) {
    state.regenFrames = 0;
    state.restingUntilFull = false;
  }

  return waitBefore - deinonychusFramesUntilReady(state, maxHp, minSummonHp);
}

/**
 * The longest he can ever be off duty: from zero — a knockout — to full.
 *
 * A ceiling rather than a typical wait, and chosen as one. A recall at any
 * health, or a knockout, costs at most this; anything longer and the pet stops
 * being part of the fight the player is in and becomes part of the next one.
 */
const DEINONYCHUS_FULL_RECOVERY_SECONDS = 30;
/** How many regen ticks a full recovery is split into — the countdown's granularity. */
const DEINONYCHUS_REGEN_TICKS_TO_FULL = 25;
const DEINONYCHUS_REGEN_INTERVAL_FRAMES = Math.round(
  (DEINONYCHUS_FULL_RECOVERY_SECONDS * WORLD_TICKS_PER_SECOND) / DEINONYCHUS_REGEN_TICKS_TO_FULL,
);
const DEINONYCHUS_REGEN_PERCENT = 1 / DEINONYCHUS_REGEN_TICKS_TO_FULL;

/**
 * How much recovery one kill takes off the clock: exactly one regen tick.
 *
 * A kill is worth the same wait a tick of resting is, which is the whole idea —
 * pressing on is never slower than standing still, and the pet's recovery is one
 * more thing the fight pays for. Deliberately not scaled by the mob: a rat and a
 * boss both mean the party moved forward, and rating them would push the player
 * toward farming whichever one paid best.
 */
export const DEINONYCHUS_KILL_RECOVERY_FRAMES = DEINONYCHUS_REGEN_INTERVAL_FRAMES;

/**
 * The HP he has to have recovered before he can be sent back in.
 *
 * A floor under the floor, and no longer the operative one. The number that
 * actually gates the button is `DeinonychusSystem.minSummonHp`, which asks the
 * creature how much health it takes to be worth sending in — because a pet below
 * the wounded-retreat threshold walks out and refuses to fight, which is a trap
 * rather than the "spend him whenever you like" decision this one was written
 * for. It still binds when that retreat behaviour is switched off.
 */
export const DEINONYCHUS_MIN_SUMMON_HP = 1;
