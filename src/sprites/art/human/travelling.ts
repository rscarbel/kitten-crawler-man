/**
 * What every blow thrown on the move shares: where in the run each of its
 * versions begins, which leg does the kicking or stamping in each, and the
 * feet a blow laid over the run leaves out of reach drawn back in.
 *
 * A blow's impact frame is tied to the tick its hit lands, so a travelling
 * blow cannot wait for the stride to reach the phase its legs were keyed to.
 * Each travelling blow is instead painted once per entry phase in
 * {@link TRAVELLING_ENTRY_PHASES}, legs carried on from there by the run's own
 * feet, and the animator throws whichever version begins nearest the stride on
 * screen. The upper body's beats are the same in every version; only the legs,
 * and which leg a kick or stamp is made with, follow the entry.
 */

import { buildSkeleton, type CarlPose, type CarlView, LEG_MAX_REACH, VIEWS } from '../carl/rig';
import { pt } from '../carl/geometry';
import { type Pt } from '../carlArt';
import { HALF_CYCLE, LEFT_ARM, RIGHT_ARM, wrapPhase } from './gaitShared';
import { RUN_TOE_OFF_PHASE, runFacing, runSide } from './locomotion';
import { RUN_FRAMES } from './timing';

/** Rounding allowance when two phases or two jumps are compared; both are sums of small steps. */
export const PHASE_EPSILON = 1e-9;

/**
 * How many versions of each travelling blow are painted per view: one per
 * frame of the run it can begin on, chosen by {@link entryRunFrames}. The
 * profile run carries its feet nearly the same distance every frame, where
 * head-on the feet barely move through the middle of each stance, so profile
 * takes a version more to keep every run frame near one. The row table names
 * exactly this many versions a view.
 */
const TRAVELLING_VERSIONS: Readonly<Record<CarlView, number>> = {
  side: 5,
  front: 4,
  back: 4,
};

function runPose(view: CarlView, phase: number): CarlPose {
  return view === 'side' ? runSide(phase) : runFacing(phase, view === 'back');
}

/** Both ankles of a run pose, solved on the rig. */
function runAnkles(view: CarlView, phase: number): readonly [Pt, Pt] {
  const skeleton = buildSkeleton(runPose(view, phase), VIEWS[view]);
  return [skeleton.leftLeg.end, skeleton.rightLeg.end];
}

function ankleJump(a: readonly [Pt, Pt], b: readonly [Pt, Pt]): number {
  return Math.max(
    Math.hypot(a[0].x - b[0].x, a[0].y - b[0].y),
    Math.hypot(a[1].x - b[1].x, a[1].y - b[1].y),
  );
}

/** Every way of choosing `count` of `items`, in their order. */
function subsets(items: readonly number[], count: number): number[][] {
  if (count === 0) return [[]];
  const out: number[][] = [];
  for (let last = count - 1; last < items.length; last++) {
    for (const rest of subsets(items.slice(0, last), count - 1)) out.push([...rest, items[last]]);
  }
  return out;
}

/**
 * The run frames a view's versions begin on: of every choice of that many
 * frames, the one whose worst case — the ankles' jump from any run frame to
 * the nearest version's first pose — is smallest, and of equal worst cases the
 * one nearest on average. The animator throws the version nearest the frame
 * on screen, so this worst case is the largest pop a blow on the run can make;
 * `scripts/gates-human.ts` holds it to the run's own largest step.
 *
 * Whole run frames, so each version is exactly the run's pose on one of its
 * frames and is the one thrown from that frame. Measured on the run itself,
 * so the choice follows the run as it is painted. `allowed` narrows the run
 * frames a blow can begin on at all.
 */
function entryRunFrames(view: CarlView, allowed: (runFrame: number) => boolean): readonly number[] {
  const ankles = Array.from({ length: RUN_FRAMES }, (_unused, frame) =>
    runAnkles(view, frame / RUN_FRAMES),
  );
  const jumps = ankles.map((from) => ankles.map((to) => ankleJump(from, to)));
  let best: readonly number[] = [];
  let bestWorst = Number.POSITIVE_INFINITY;
  let bestTotal = Number.POSITIVE_INFINITY;
  const candidates = Array.from({ length: RUN_FRAMES }, (_unused, frame) => frame).filter(allowed);
  for (const entries of subsets(candidates, TRAVELLING_VERSIONS[view])) {
    const nearest = jumps.map((row) => Math.min(...entries.map((entry) => row[entry])));
    const worst = Math.max(...nearest);
    const total = nearest.reduce((sum, jump) => sum + jump, 0);
    const better = worst < bestWorst - PHASE_EPSILON;
    const asGood = Math.abs(worst - bestWorst) <= PHASE_EPSILON && total < bestTotal;
    if (!better && !asGood) continue;
    best = entries;
    bestWorst = worst;
    bestTotal = total;
  }
  return best;
}

/**
 * The run phases one view's versions of a blow begin at, chosen as
 * {@link entryRunFrames} chooses them from the run frames `allowed` passes.
 */
export function entryPhasesWhere(
  view: CarlView,
  allowed: (runFrame: number) => boolean,
): readonly number[] {
  return entryRunFrames(view, allowed).map((frame) => frame / RUN_FRAMES);
}

function entryPhases(view: CarlView): readonly number[] {
  return entryPhasesWhere(view, () => true);
}

/**
 * The run phases, as fractions of the cycle, at which each view's travelling
 * versions begin — one version per phase, in this order.
 */
const TRAVELLING_ENTRY_PHASES: Readonly<Record<CarlView, readonly number[]>> = {
  side: entryPhases('side'),
  front: entryPhases('front'),
  back: entryPhases('back'),
};

/** The run phase one version of a view begins at; out-of-range versions wrap. */
export function travellingEntryPhase(view: CarlView, version: number): number {
  const phases = TRAVELLING_ENTRY_PHASES[view];
  return phases[((version % phases.length) + phases.length) % phases.length];
}

/** `phase − reference` wrapped into `(−½, ½]`: how far ahead of the reference it runs. */
function phaseLead(phase: number, reference: number): number {
  const lead = wrapPhase(phase - reference);
  return lead > HALF_CYCLE ? lead - 1 : lead;
}

/**
 * Which leg does the kicking or stamping in one version of a blow, and how far
 * its own run phase sits from where the blow wants it.
 *
 * - `side`: `RIGHT_ARM` or `LEFT_ARM`, the sign `placeFoot` takes.
 * - `lead`: that leg's own run phase at impact less the phase the blow was
 *   keyed for, in `(−½, ½]`.
 */
export interface BlowLeg {
  readonly side: number;
  readonly lead: number;
}

/**
 * The leg whose own run phase at impact is nearest `wanted` — the phase, of
 * whichever leg, the blow was keyed to kick or stamp at. The left leg's own
 * phase is the right's half a cycle on, so between them one is never more
 * than a quarter of a cycle away. Of two equally near, the one already past
 * `wanted`: a foot that has landed can be stamped back where it stood, where
 * one still in the air would have to be driven down a quarter-cycle early.
 */
export function blowLeg(rightPhaseAtImpact: number, wanted: number): BlowLeg {
  const right = { side: RIGHT_ARM, lead: phaseLead(rightPhaseAtImpact, wanted) };
  const left = { side: LEFT_ARM, lead: phaseLead(rightPhaseAtImpact + HALF_CYCLE, wanted) };
  const gap = Math.abs(left.lead) - Math.abs(right.lead);
  if (Math.abs(gap) <= PHASE_EPSILON) return left.lead > right.lead ? left : right;
  return gap < 0 ? left : right;
}

function inStance(phase: number): boolean {
  return wrapPhase(phase) <= RUN_TOE_OFF_PHASE;
}

/**
 * The leg to kick with. Lifting a foot the run has on the floor leaves him
 * standing on nothing, or on a foot still in the air, so first the leg the
 * kick would take out of the fewest stance frames — each counted by how much
 * of that frame's foot is the kick — and of two equally free, the one
 * {@link blowLeg} would pick.
 *
 * `rightPhaseAt` is the right foot's run phase on each frame of the row, and
 * `kickWeights` how much of each frame's kicking foot is the kick.
 */
export function kickingLeg(
  rightPhaseAt: (frame: number) => number,
  kickWeights: readonly number[],
  impactFrame: number,
  wanted: number,
): BlowLeg {
  const stanceTaken = (side: number): number =>
    kickWeights.reduce(
      (sum, weight, frame) => sum + (inStance(legPhase(rightPhaseAt(frame), side)) ? weight : 0),
      0,
    );
  const rightTaken = stanceTaken(RIGHT_ARM);
  const leftTaken = stanceTaken(LEFT_ARM);
  const nearest = blowLeg(rightPhaseAt(impactFrame), wanted);
  if (Math.abs(rightTaken - leftTaken) <= PHASE_EPSILON) return nearest;
  const side = rightTaken < leftTaken ? RIGHT_ARM : LEFT_ARM;
  return { side, lead: phaseLead(legPhase(rightPhaseAt(impactFrame), side), wanted) };
}

/** A leg's own run phase, given the right foot's. */
export function legPhase(rightPhase: number, side: number): number {
  return side === RIGHT_ARM ? rightPhase : rightPhase + HALF_CYCLE;
}

/**
 * How much of a foot's distance from its hip one easing step keeps, and the
 * most steps taken: enough to draw in any overreach a blow's lift of the body
 * can make, a few per cent of the leg at a time.
 */
const REACH_EASE = 0.97;
const REACH_EASE_STEPS = 12;

/**
 * Draws in a foot off the floor that a blow laid over the run has left past
 * its leg's reach — the body lifted into a hop over a leg the run has trailing
 * straight out behind. A planted foot is left where it stands; it holds the
 * floor, and moving it would slide it.
 */
export function keepSwingFeetInReach(pose: CarlPose, view: CarlView): void {
  for (const side of [RIGHT_ARM, LEFT_ARM]) {
    const planted = side === RIGHT_ARM ? pose.rightFootPlanted : pose.leftFootPlanted;
    if (planted === true) continue;
    for (let step = 0; step < REACH_EASE_STEPS; step++) {
      const skeleton = buildSkeleton(pose, VIEWS[view]);
      const leg = side === RIGHT_ARM ? skeleton.rightLeg : skeleton.leftLeg;
      if (leg.demand <= LEG_MAX_REACH) break;
      const foot = side === RIGHT_ARM ? pose.rightFoot : pose.leftFoot;
      const hip = leg.root;
      const drawn = pt(
        hip.x + (foot.x - hip.x) * REACH_EASE,
        hip.y + (foot.y - hip.y) * REACH_EASE,
      );
      if (side === RIGHT_ARM) {
        pose.rightFoot = view === 'side' ? drawn : pt(foot.x, drawn.y);
        if (pose.rightFootDepth !== undefined) pose.rightFootDepth *= REACH_EASE;
      } else {
        pose.leftFoot = view === 'side' ? drawn : pt(foot.x, drawn.y);
        if (pose.leftFootDepth !== undefined) pose.leftFootDepth *= REACH_EASE;
      }
    }
  }
}
