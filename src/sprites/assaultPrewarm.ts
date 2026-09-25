/**
 * Keeps the figures an undead assault wave on Briar Hollow is about to put on
 * screen warm through its lead-in: the raised ratkin, the Grave Bull and the
 * necromancer.
 *
 * None of them is seen anywhere else, so none is warm when a wave is
 * announced, and the cache they share is also holding the crawlers — Carl's
 * fight alone keeps nearly 40 MB of its 96 MB drawn every frame. So
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

import type { FigureDef } from './figure/figureDef';
import {
  figureRowFitsWithoutEviction,
  prewarmFigureState,
  touchFigureState,
} from './figure/figureFrameCache';
import { RAISED_RATKIN_LOOKS } from './art/raisedRatkinArt';
import { raisedRatkinFigure, raisedStateName } from './art/raisedRatkinFigure';
import { GRAVE_BULL_FIGURE, graveBullStateName } from './art/graveBullFigure';
import { NECROMANCER_FIGURE, necromancerStateName } from './art/necromancerFigure';
import { GRAVE_BULL_ARRIVAL_ROWS } from './graveBullSprite';
import { NECROMANCER_ARRIVAL_ROWS } from './necromancerSprite';
import { RAISED_ARRIVAL_ROWS } from './raisedRatkinSprite';

/** Which assault wave: the first brings raised ratkin, the second adds a bull, the third him. */
export type AssaultWave = 1 | 2 | 3;

const FIRST_BULL_WAVE = 2;
const NECROMANCER_WAVE = 3;

/** One row of one figure. */
export interface AssaultRow {
  readonly def: FigureDef;
  readonly state: string;
}

/** Every row a wave arrives playing. */
export function assaultWaveRows(wave: AssaultWave): AssaultRow[] {
  const rows: AssaultRow[] = [];
  for (const look of RAISED_RATKIN_LOOKS) {
    const def = raisedRatkinFigure(look);
    for (const row of RAISED_ARRIVAL_ROWS)
      rows.push({ def, state: raisedStateName(row.action, row.view) });
  }
  if (wave >= FIRST_BULL_WAVE) {
    for (const row of GRAVE_BULL_ARRIVAL_ROWS) {
      rows.push({ def: GRAVE_BULL_FIGURE, state: graveBullStateName(row.action, row.view) });
    }
  }
  if (wave >= NECROMANCER_WAVE) {
    for (const row of NECROMANCER_ARRIVAL_ROWS) {
      rows.push({ def: NECROMANCER_FIGURE, state: necromancerStateName(row.action, row.view) });
    }
  }
  return rows;
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

/**
 * Tick once per gameplay update with the number of the wave coming next, from
 * the start of its lead-in until its spawns have emerged, and `null` otherwise:
 *
 * - wave 1 from the start of the 90 s imminent countdown;
 * - waves 2 and 3 from the moment the wave before triggers the advance, through
 *   the lull before them;
 * - `null` once the wave's first spawns are out on every lane it uses. From
 *   then on the rows are drawn by the creatures playing them, which keeps them
 *   warm, and touching the rows nobody draws only competes with the fight.
 */
export class AssaultWavePrewarm {
  private wave: AssaultWave | null = null;
  private rows: readonly AssaultRow[] = [];
  /** How many of the wave's rows have been asked for so far. */
  private next = 0;

  /**
   * @param request How one row is queued: the figure cache's paced prewarm.
   * @param touch How one row is kept warm; returns whether it still is.
   * @param fits Whether a row can be baked without evicting anything.
   */
  constructor(
    private readonly request: (row: AssaultRow) => void = requestRow,
    private readonly touch: (row: AssaultRow) => boolean = touchRow,
    private readonly fits: (row: AssaultRow) => boolean = rowFits,
  ) {}

  update(wave: AssaultWave | null): void {
    if (wave === null) {
      this.wave = null;
      return;
    }
    if (wave !== this.wave) {
      this.wave = wave;
      this.rows = assaultWaveRows(wave);
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
