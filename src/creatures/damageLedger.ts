/** A blow never rounds away to nothing; a resistance softens hits, it does not void them. */
const MIN_DAMAGE_TAKEN = 1;
/**
 * The most the ledger may ever run in the wearer's favour, in hit points.
 *
 * A bound rather than a tuning number — see {@link DamageLedger.charge}. Without
 * one the ledger is a sink that both voids the resistance on small hits and
 * banks the difference as free hit points to spend later.
 */
const MAX_SOFTENING_CREDIT = 1;

/**
 * A flat damage resistance for an ally that has to take a fixed share of every
 * blow, one-point ticks included.
 *
 * Used by every creature on the party's side whose resistance is a multiplier
 * on incoming damage (Mongo, the Meat Shields hirelings). Such a creature
 * charges its incoming damage here in *both* of `Mob`'s damage entry points,
 * because they are genuinely two doors rather than one wrapping the other:
 * `takeDamage` is what a mob swinging at a player-like target calls,
 * `takeDamageFrom` is what a mob swinging at another *mob* calls — the golem's
 * boulders and the Ball of Swine's charge go through the second — and it writes
 * hp itself rather than delegating. Softened in one place only, half the things
 * on the floor would ignore the resistance entirely. Because neither method
 * calls the other, charging both cannot double-apply.
 *
 * Kept as a running ledger rather than rounded per blow, and that is not
 * fussiness — rounding each blow would give the resistance a rate that depends
 * on the size of the hit, with *no effect at all* on the one damage class an
 * ally cannot walk away from: every damage-over-time tick in the game is one
 * point, and one point softened and rounded is still one point, so burn,
 * poison, sepsis and the rest would land at full strength. Charging whole
 * points off an accumulated balance makes a run of ticks cost exactly the
 * multiplier on average.
 *
 * The balance is bounded on the credit side, and that bound is the whole safety
 * of the scheme. A blow forced up to {@link MIN_DAMAGE_TAKEN} bills the
 * difference back to the ledger, and unbounded that is a sink: a stream of
 * one-point hits pushes the balance further negative every time, so the
 * resistance stops applying to them *and* the accumulated credit is later spent
 * as flat immunity — measured at seventy-six free hit points after two hundred
 * ticks of a shell edge at a 0.6 multiplier, which is a damage shield rather
 * than a resistance. Clamped, the most the ledger can ever owe or be owed is one
 * hit point in either direction.
 */
export class DamageLedger {
  /**
   * Damage softened away but not yet charged, in fractions of a hit point.
   *
   * Approximate across a dodge or an absorbed blow — the balance is added to
   * before the base class decides whether the hit landed at all — which is worth
   * a sentence only to say it does not matter: the drift is under a hit point
   * and it falls in the wearer's favour.
   */
  private owed = 0;

  /** @param multiplier the share of each blow actually taken. */
  constructor(private readonly multiplier: number) {}

  /**
   * The whole hit points to charge for a blow of `amount`, with the remainder
   * carried to the next one.
   *
   * @param mayLandForNothing whether the blow is allowed to charge zero. True
   *   wherever nothing reads a "did not connect" answer — every status tick, and
   *   `takeDamageFrom`, which returns nothing at all. False only for a blow
   *   arriving through `takeDamage`, where returning false means "missed" and
   *   attackers use it to hold back the status riders they swing alongside.
   */
  charge(amount: number, mayLandForNothing: boolean): number {
    if (amount <= 0) return amount;
    this.owed += amount * this.multiplier;
    let charged = Math.max(0, Math.floor(this.owed));
    if (charged < MIN_DAMAGE_TAKEN && !mayLandForNothing) charged = MIN_DAMAGE_TAKEN;
    this.owed = Math.max(-MAX_SOFTENING_CREDIT, this.owed - charged);
    return charged;
  }
}
