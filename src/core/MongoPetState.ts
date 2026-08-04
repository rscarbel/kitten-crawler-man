/**
 * The part of Mongo that outlives a summon.
 *
 * His HP is now persistent: it does not reset when he is called back, it does
 * not reset when he is summoned again, and it regenerates only while he is off
 * duty. That makes it party state rather than creature state — the `Mongo`
 * instance is thrown away on every despawn, so anything stored on it is lost.
 *
 * Threaded through `DungeonSceneOptions` by reference, exactly like the quest
 * progress objects, so it survives floor transitions and building entries.
 */
export interface MongoPetState {
  /** Current HP, carried across summons. Zero means he has to rest first. */
  hp: number;
  /**
   * Frames since the last recovery tick.
   *
   * Kept here rather than on `MongoSystem` because that system only exists on
   * the dungeon scene: parked on it, an hour spent shopping indoors healed the
   * pet by nothing, and every floor transition threw away most of a tick.
   */
  regenFrames: number;
  /**
   * The maximum HP the stored value was last measured against.
   *
   * Kept rather than re-derived from `level - 1`: god mode pins the level Mongo
   * reports, so the previous level's maximum is not what his stored HP was
   * actually scaled to, and rescaling against it heals or guts him on every
   * level-up.
   */
  scaledAgainstMaxHp: number;
  /**
   * Set while the circus quest holds Mongo as Signet's collateral.
   *
   * An explicit flag rather than a very large cooldown: the cooldown it
   * replaced was cleared by any code that had its own reason to zero a
   * cooldown, which silently freed a kidnapped pet.
   */
  summonLocked: boolean;
  /**
   * Set when he leaves the field spent, and held until he is back to *full*.
   *
   * Being knocked out is the one thing that costs real time. Without the latch
   * he is summonable again the moment the first regen tick lands, which for a
   * high-level pet is a hit point out of two hundred and change — the player
   * sends a raptor in, watches him collapse, and sends the same raptor back in
   * two seconds later. It has to survive a reload, or quitting to the menu is a
   * way of skipping the recovery.
   */
  restingUntilFull: boolean;
}

/**
 * A point-in-time copy of the pet state, for the in-run safe-room checkpoint.
 *
 * Every field is a primitive, so the record itself is the only container that
 * needs copying — and it is copied on the way out *and* on the way back in,
 * because the player can die many times against one checkpoint.
 */
export interface MongoPetStateCheckpoint {
  hp: number;
  regenFrames: number;
  scaledAgainstMaxHp: number;
  summonLocked: boolean;
  restingUntilFull: boolean;
}

export function captureMongoPetState(state: MongoPetState): MongoPetStateCheckpoint {
  return {
    hp: state.hp,
    regenFrames: state.regenFrames,
    scaledAgainstMaxHp: state.scaledAgainstMaxHp,
    summonLocked: state.summonLocked,
    restingUntilFull: state.restingUntilFull,
  };
}

/**
 * Rewinds the pet state in place.
 *
 * In place because this object is threaded by reference through every scene and
 * through `MongoSystem` itself — replacing it would leave both holding the old
 * one. Must run *after* `MongoSystem.dismiss`, which writes the live creature's
 * remaining HP into these same fields on its way out.
 */
export function restoreMongoPetState(
  state: MongoPetState,
  snapshot: MongoPetStateCheckpoint,
): void {
  state.hp = snapshot.hp;
  state.regenFrames = snapshot.regenFrames;
  state.scaledAgainstMaxHp = snapshot.scaledAgainstMaxHp;
  state.summonLocked = snapshot.summonLocked;
  state.restingUntilFull = snapshot.restingUntilFull;
}

export function createMongoPetState(
  hp: number,
  maxHp: number,
  restingUntilFull = hp <= 0,
): MongoPetState {
  return { hp, regenFrames: 0, scaledAgainstMaxHp: maxHp, summonLocked: false, restingUntilFull };
}

/**
 * Frames of off-duty recovery left before he is fit to be sent in again.
 *
 * Zero once he is summonable — which, while he is resting off a knockout, means
 * once he is at full health rather than once he has a hit point.
 */
export function mongoFramesUntilReady(state: MongoPetState, maxHp: number): number {
  const targetHp = state.restingUntilFull ? maxHp : MONGO_MIN_SUMMON_HP;
  if (state.hp >= targetHp) return 0;
  const healPerTick = Math.max(1, Math.ceil(maxHp * MONGO_REGEN_PERCENT));
  const ticksNeeded = Math.ceil((targetHp - state.hp) / healPerTick);
  return Math.max(1, ticksNeeded * MONGO_REGEN_INTERVAL_FRAMES - state.regenFrames);
}

/** The whole recovery, for scaling the countdown's drain overlay. */
export function mongoTotalRecoveryFrames(state: MongoPetState, maxHp: number): number {
  const targetHp = state.restingUntilFull ? maxHp : MONGO_MIN_SUMMON_HP;
  const healPerTick = Math.max(1, Math.ceil(maxHp * MONGO_REGEN_PERCENT));
  return Math.max(1, Math.ceil(targetHp / healPerTick) * MONGO_REGEN_INTERVAL_FRAMES);
}

/**
 * Off-duty recovery: one percent of his maximum, rounded up, every 1.3 seconds.
 *
 * Rounded up rather than down so a low-level Mongo — whose one percent is a
 * fraction of a hit point — recovers at all instead of sitting at zero forever.
 *
 * Call once per game frame from any scene the party can be in while the pet is
 * not summoned.
 */
export function tickMongoRegen(state: MongoPetState, maxHp: number): void {
  if (state.hp >= maxHp) {
    state.hp = Math.min(state.hp, maxHp);
    state.regenFrames = 0;
    state.restingUntilFull = false;
    return;
  }
  state.regenFrames++;
  if (state.regenFrames < MONGO_REGEN_INTERVAL_FRAMES) return;
  state.regenFrames = 0;
  state.hp = Math.min(maxHp, state.hp + Math.ceil(maxHp * MONGO_REGEN_PERCENT));
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
export function advanceMongoRecovery(state: MongoPetState, maxHp: number, frames: number): number {
  const waitBefore = mongoFramesUntilReady(state, maxHp);
  if (waitBefore <= 0 || frames <= 0) return 0;

  state.regenFrames += frames;
  const healPerTick = Math.max(1, Math.ceil(maxHp * MONGO_REGEN_PERCENT));
  while (state.regenFrames >= MONGO_REGEN_INTERVAL_FRAMES && state.hp < maxHp) {
    state.regenFrames -= MONGO_REGEN_INTERVAL_FRAMES;
    state.hp = Math.min(maxHp, state.hp + healPerTick);
  }
  if (state.hp >= maxHp) {
    state.regenFrames = 0;
    state.restingUntilFull = false;
  }

  return waitBefore - mongoFramesUntilReady(state, maxHp);
}

const MONGO_REGEN_INTERVAL_FRAMES = 78;
const MONGO_REGEN_PERCENT = 0.01;

/**
 * How much recovery one kill takes off the clock: exactly one regen tick.
 *
 * A kill is worth the same wait a tick of resting is, which is the whole idea —
 * pressing on is never slower than standing still, and the pet's recovery is one
 * more thing the fight pays for. Deliberately not scaled by the mob: a rat and a
 * boss both mean the party moved forward, and rating them would push the player
 * toward farming whichever one paid best.
 */
export const MONGO_KILL_RECOVERY_FRAMES = MONGO_REGEN_INTERVAL_FRAMES;

/**
 * The HP he has to have recovered before he can be sent back in.
 *
 * One, deliberately: the design allows resummoning him the instant he has a
 * single hit point back, because the interesting decision is *when* to spend
 * him. The exception is `restingUntilFull` — a pet actually knocked out has to
 * heal all the way, and that is the cost of losing him.
 */
export const MONGO_MIN_SUMMON_HP = 1;
