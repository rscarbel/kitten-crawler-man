/**
 * Keeps the figures an undead assault wave on Briar Hollow is about to put on
 * screen warm through its lead-in: the raised ratkin, the Grave Bull and the
 * necromancer, then every other figure-drawn kind the siege planned the
 * mini-wave with, at the variety tier it was planned at.
 *
 * The undead are seen nowhere else, so none is warm when a wave is
 * announced, and the cache they share is also holding the crawlers — the human
 * crawler's fight alone keeps nearly 40 MB of the cache's own ceiling drawn every frame. So
 * {@link AssaultWavePrewarm}:
 *
 * - **Warms a small set.** Only the rows a wave arrives playing, in the views
 *   its lanes show — about 16 MB for the third wave. Everything else is warmed
 *   in stages as each creature closes in (`prewarmRaisedRatkin`,
 *   `prewarmGraveBullAttack`, `prewarmNecromancerStanding`, …).
 * - **Asks for one row at a time.** Its next row is asked for once every row it
 *   has asked for is warm, so it never holds more than one row's place in the
 *   prewarm queue, however long the queue is.
 * - **Touches instead of re-queuing.** Rows warmed but not yet drawn are the
 *   stalest in the cache, so its idle sweep would take them first. Every update
 *   each warm row is touched (`touchFigureState`), which keeps it from the
 *   sweep without queuing anything. A touch does not outrank a draw: under
 *   pressure, a row only touched goes before any figure drawn since.
 * - **Never evicts for itself.** A row is asked for, or asked for again, only
 *   while it fits without evicting anything (`figureRowFitsWithoutEviction`).
 *   The prewarm queue drains at the start of a frame, before anything is drawn
 *   in it, so a bake allowed to evict could take a row that is on screen, whose
 *   rebake on the draw would then take the warmed row back: a row lost every
 *   frame.
 */

import {
  figureRowFitsWithoutEviction,
  prewarmFigureState,
  touchFigureState,
} from './figure/figureFrameCache';
import type { ApproachView, FigureRow } from './figure/approachRows';
import { raisedRatkinFigure, raisedStateName } from './art/raisedRatkinFigure';
import { GRAVE_BULL_FIGURE, graveBullStateName } from './art/graveBullFigure';
import { NECROMANCER_FIGURE, necromancerStateName } from './art/necromancerFigure';
import { GRAVE_BULL_ARRIVAL_ROWS } from './graveBullSprite';
import { NECROMANCER_ARRIVAL_ROWS } from './necromancerSprite';
import { RAISED_ARRIVAL_ROWS } from './raisedRatkinSprite';
import { variantsInPlay } from '../core/mobs/mobVariantFamily';
import { BRIAR_HOLLOW_SIEGE, lookTierFor, NECROMANCER_RAISES } from '../levels/encounters';
import type { VarietyTier } from '../core/perf/varietyTier';
import { MOB_KINDS, type MobKind } from '../levels/mobKinds';
import type { Roster } from '../levels/ladder';

/** One row of one figure. */
export type AssaultRow = FigureRow;

/**
 * What a mini-wave's lead-in warms for: the roster the siege planned for it,
 * at the variety tier it was planned at, coming up a lane facing `view`.
 */
export interface AssaultLeadIn {
  readonly roster: Roster;
  readonly tier: VarietyTier;
  readonly view: ApproachView;
}

function rosterHas(roster: Roster, kind: MobKind): boolean {
  return roster.some((entry) => entry.kind === kind && entry.count > 0);
}

/**
 * Every row the necromancer's undead in `leadIn` arrive playing: the raised
 * ratkin's rise in every look the tier lets them wear, the Grave Bull's
 * entrance when the roster brings one, and his own arrival, which leads every
 * wave.
 */
function assaultUndeadRows(leadIn: AssaultLeadIn): AssaultRow[] {
  const rows: AssaultRow[] = [];
  if (rosterHas(leadIn.roster, 'raised_ratkin')) {
    const lookTier = lookTierFor(NECROMANCER_RAISES, leadIn.tier);
    for (const look of variantsInPlay(MOB_KINDS.raised_ratkin.family, lookTier)) {
      const def = raisedRatkinFigure(look);
      for (const row of RAISED_ARRIVAL_ROWS) {
        rows.push({ def, state: raisedStateName(row.action, row.view) });
      }
    }
  }
  if (rosterHas(leadIn.roster, 'grave_bull')) {
    for (const row of GRAVE_BULL_ARRIVAL_ROWS) {
      rows.push({ def: GRAVE_BULL_FIGURE, state: graveBullStateName(row.action, row.view) });
    }
  }
  for (const row of NECROMANCER_ARRIVAL_ROWS) {
    rows.push({ def: NECROMANCER_FIGURE, state: necromancerStateName(row.action, row.view) });
  }
  return rows;
}

/**
 * The rows the rest of a planned roster arrives playing, as each kind's
 * registry entry declares them (`approachRows`), in the order they are worth
 * warming. Every kind's walk comes before any attack, since a body is seen
 * walking up the lane far longer than it is seen swinging; within each, the
 * most numerous kind first, and kinds equally many in the order they come up
 * the lane. A cache too full for all of it then warms what is on screen most.
 */
export function assaultRosterRows(leadIn: AssaultLeadIn): AssaultRow[] {
  const byCount = leadIn.roster
    .map((entry, arrivalIndex) => ({ entry, arrivalIndex }))
    .filter(({ entry }) => entry.count > 0)
    .sort((a, b) => b.entry.count - a.entry.count || a.arrivalIndex - b.arrivalIndex);
  const lookTier = lookTierFor(BRIAR_HOLLOW_SIEGE, leadIn.tier);
  const kinds = byCount.map(({ entry }) =>
    MOB_KINDS[entry.kind].approachRows(lookTier, leadIn.view),
  );
  return [...kinds.flatMap((rows) => rows.walk), ...kinds.flatMap((rows) => rows.attack)].filter(
    (row) => row.def.states.has(row.state),
  );
}

/** Every row a lead-in warms: the undead arrivals first, then the rest of the roster. */
function assaultLeadInRows(leadIn: AssaultLeadIn): AssaultRow[] {
  return [...assaultUndeadRows(leadIn), ...assaultRosterRows(leadIn)];
}

function sameLeadIn(a: AssaultLeadIn, b: AssaultLeadIn): boolean {
  if (a === b) return true;
  if (a.tier !== b.tier || a.view !== b.view || a.roster.length !== b.roster.length) return false;
  return a.roster.every((entry, i) => {
    const other = b.roster[i];
    return other.kind === entry.kind && other.count === entry.count;
  });
}

function requestRow(row: AssaultRow): void {
  prewarmFigureState(row.def, row.state);
}

function touchRow(row: AssaultRow): boolean {
  return touchFigureState(row.def, row.state);
}

function rowFits(row: AssaultRow): boolean {
  return figureRowFitsWithoutEviction(row.def, row.state);
}

/** How the ticker reaches the cache; each defaults to the real thing. */
export interface AssaultPrewarmHooks {
  /** How one row is queued: the figure cache's paced prewarm. */
  readonly request: (row: AssaultRow) => void;
  /** How one row is kept warm; returns whether it still is. */
  readonly touch: (row: AssaultRow) => boolean;
  /** Whether a row can be baked without evicting anything. */
  readonly fits: (row: AssaultRow) => boolean;
}

/**
 * Tick once per gameplay update with the lead-in of the mini-wave coming
 * next, from the start of its lead-in until its spawns have emerged, and
 * `null` otherwise:
 *
 * - the first wave's roster from the start of the imminent countdown, and
 *   again through every lull, since each wave opens on it;
 * - each later mini-wave from the moment it is planned;
 * - `null` once the mini-wave's spawns and leaders are out. From then on the
 *   rows are drawn by the creatures playing them, which keeps them warm, and
 *   touching the rows nobody draws only competes with the fight.
 *
 * A lead-in that changes (another roster, tier or lane) starts its rows over.
 * Its undead arrival rows come first, then the rest of the roster's rows,
 * all under the same one-row-at-a-time rule.
 */
export class AssaultWavePrewarm {
  private leadIn: AssaultLeadIn | null = null;
  private rows: readonly AssaultRow[] = [];
  /** How many of the lead-in's rows have been asked for so far. */
  private next = 0;
  private readonly request: AssaultPrewarmHooks['request'];
  private readonly touch: AssaultPrewarmHooks['touch'];
  private readonly fits: AssaultPrewarmHooks['fits'];

  constructor(hooks: Partial<AssaultPrewarmHooks> = {}) {
    this.request = hooks.request ?? requestRow;
    this.touch = hooks.touch ?? touchRow;
    this.fits = hooks.fits ?? rowFits;
  }

  update(leadIn: AssaultLeadIn | null): void {
    if (leadIn === null) {
      this.leadIn = null;
      return;
    }
    if (this.leadIn === null || !sameLeadIn(leadIn, this.leadIn)) {
      this.leadIn = leadIn;
      this.rows = assaultLeadInRows(leadIn);
      this.next = 0;
    }
    let firstCold: AssaultRow | null = null;
    for (let i = 0; i < this.next; i++) {
      const held = this.rows[i];
      if (!this.touch(held) && firstCold === null) firstCold = held;
    }
    if (firstCold !== null) {
      // Still queued, or let go by the cache: only this one is asked for
      // again, so a burst of evictions never puts more than one row of the
      // ticker's ahead of the creatures' own staged rows. A request for a row
      // already queued merges with it.
      if (this.fits(firstCold)) this.request(firstCold);
      return;
    }
    if (this.next >= this.rows.length) return;
    const upcoming = this.rows[this.next];
    if (!this.fits(upcoming)) return;
    this.request(upcoming);
    this.next++;
  }
}
