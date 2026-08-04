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

const MONGO_REGEN_INTERVAL_FRAMES = 78;
const MONGO_REGEN_PERCENT = 0.01;

/**
 * The HP he has to have recovered before he can be sent back in.
 *
 * One, deliberately: the design allows resummoning him the instant he has a
 * single hit point back, because the interesting decision is *when* to spend
 * him. The exception is `restingUntilFull` — a pet actually knocked out has to
 * heal all the way, and that is the cost of losing him.
 */
export const MONGO_MIN_SUMMON_HP = 1;
