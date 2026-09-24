/**
 * The reporting half every `verify:fairies` section shares, so each rule and
 * its paired run against broken code land in one tally.
 */

export interface FairyGateReport {
  /** Starts a titled block of checks. */
  section(name: string): void;
  /** Records a rule that must hold on the shipped code. */
  check(ok: boolean, message: string, detail?: string): void;
  /**
   * Records a rule run against a deliberately broken copy of what it guards:
   * the rule must fail there, or the check could never have caught the defect.
   */
  checkCatches(ruleHolds: boolean, message: string, detail?: string): void;
  /**
   * Records something a rule's staging leans on — a tuned value, a formula —
   * that no broken copy of the code is run against. Uncounted in the rule
   * tally, but a false one still fails the run: the rules resting on it would
   * be measuring the wrong setup.
   */
  precondition(ok: boolean, message: string, detail?: string): void;
  /** Records a rule that does not apply to this case, and why; never counted. */
  notApplicable(message: string, reason: string): void;
}

export interface FairyGateTally extends FairyGateReport {
  readonly positiveFailures: number;
  readonly negativesThatPassed: number;
  readonly positiveCount: number;
  readonly negativeCount: number;
  readonly preconditionFailures: number;
}

export function createFairyGateTally(): FairyGateTally {
  let positiveFailures = 0;
  let negativesThatPassed = 0;
  let positiveCount = 0;
  let negativeCount = 0;
  let preconditionFailures = 0;
  const suffix = (detail: string | undefined): string =>
    detail === undefined || detail === '' ? '' : ` — ${detail}`;
  return {
    section(name) {
      console.log(`\n${name}`);
    },
    check(ok, message, detail) {
      positiveCount++;
      if (!ok) positiveFailures++;
      console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${message}${suffix(detail)}`);
    },
    checkCatches(ruleHolds, message, detail) {
      negativeCount++;
      if (ruleHolds) negativesThatPassed++;
      const verdict = ruleHolds ? 'FAIL negative stayed green:' : 'ok   negative went red:';
      console.log(`  ${verdict} ${message}${suffix(detail)}`);
    },
    precondition(ok, message, detail) {
      if (!ok) preconditionFailures++;
      console.log(`  ${ok ? 'pre ' : 'FAIL precondition:'} ${message}${suffix(detail)}`);
    },
    notApplicable(message, reason) {
      console.log(`  n/a  ${message}${suffix(reason)}`);
    },
    get positiveFailures() {
      return positiveFailures;
    },
    get negativesThatPassed() {
      return negativesThatPassed;
    },
    get positiveCount() {
      return positiveCount;
    },
    get negativeCount() {
      return negativeCount;
    },
    get preconditionFailures() {
      return preconditionFailures;
    },
  };
}
