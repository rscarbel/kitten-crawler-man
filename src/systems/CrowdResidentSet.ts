/**
 * A crowd's looks as a resident set: a look is pinned in the figure cache
 * while any citizen wearing it is within reach of the party, and handed back
 * to the cache's idle sweep once all of them are well past it, in a city or
 * out of one.
 *
 * Pinned rows fill a large share of the figure cache, and a fight elsewhere,
 * such as a siege's wave of distinct creatures, needs that room; while a crowd
 * off screen holds it, the fight's own rows evict one another and are painted
 * live. Held again, anything a look is missing is asked for, nearest look
 * first, ahead of its first citizen coming into view.
 */

import {
  citizenFigureRows,
  citizenLookKey,
  pinCitizenFigure,
  unpinCitizenFigure,
  type CitizenFigure,
} from '../creatures/citizenFigure';
import {
  bakeFigurePrewarmFor,
  boostPrewarmBudget,
  figureCacheRoomContested,
  forgiveFigurePrewarmGiveUp,
  isFigureStateQueued,
  isFigureStateWarm,
  prewarmFigureState,
} from '../sprites/figure/figureFrameCache';
import type { DrawnFigureRow } from '../sprites/figure/figureDef';
import { TILE_SIZE } from '../core/constants';
import {
  RESIDENCY_CHECK_INTERVAL_UPDATES,
  type ResidentPlacement,
  type ResidentSet,
  type ResidentUrgency,
  type ResidentWarmth,
} from './WorldResidency';

/**
 * Seconds of walking at full speed a look's rows are asked for ahead of its
 * first citizen coming into view, rebaked within the ordinary prewarm budget.
 * Measured headless at node's cost per cell (several times a browser's): a
 * full-speed walk from the far side of Briar Hollow straight after a fight
 * met a few stand-ins at four seconds and none at five, and a full-speed walk
 * across a city of three by three towns from a cold arrival met 52 at one
 * second and none at five (`verify:town-residency`). Longer would hold the
 * crowd across most of the village, where a siege needs its room.
 */
const CROWD_REWARM_LEAD_SECONDS = 5;

/**
 * Tiles past the hold distance a look must be before it is released, so a
 * party standing on the edge does not release it and hold it again every few
 * steps.
 */
const CROWD_RELEASE_HYSTERESIS_TILES = 12;

/**
 * Milliseconds per frame the figure prewarm may spend, in place of the
 * cache's ordinary steady-state ceiling (see `boostPrewarmBudget`), while
 * looks the cache gave back are owed near the party: behind a death screen
 * covering the world, or with a crawler arriving among or walking towards a
 * crowd. Still a frame budget, not a block: every frame keeps rendering at up
 * to this much baking. Sized to clear floor 3's whole closed set of looks
 * (measured ~2.3 s of total baking, headless) within the crowd's lead without
 * spending enough of a 60 Hz frame to be its own hitch. Never for a recall
 * channel's landing alone, whose caster is still in the fight and walks
 * towards nothing.
 */
const OWED_REWARM_BUDGET_MS = 10;
/** Renewed on every decision, so it lapses one decision after nothing is owed. */
const OWED_REWARM_FRAMES = RESIDENCY_CHECK_INTERVAL_UPDATES + 1;

/** A citizen's footprint, in tiles, for measuring when it comes into view. */
const CITIZEN_AREA_TILES = 1;

/**
 * A citizen, as far as residency cares: where it stands and what it wears.
 * A bespoke resident wears no cast look, so the crowd has nothing to hold for
 * them.
 */
export interface ResidencyCitizen {
  readonly x: number;
  readonly y: number;
  readonly citizenFigure: CitizenFigure | null;
}

export interface CrowdResidentSetDeps {
  /** Every citizen of the crowd, drawn or not. */
  readonly people: () => ReadonlyArray<ResidencyCitizen>;
}

/**
 * Asks for the rows not fully baked, returning whether any is now queued: a
 * row the cache has given up on or refused is not on its way, so no boost
 * can hurry it.
 */
function warmMissing(rows: ReadonlyArray<DrawnFigureRow>, urgent: boolean): boolean {
  let queued = false;
  for (const row of rows) {
    if (isFigureStateWarm(row.def, row.state)) continue;
    prewarmFigureState(row.def, row.state, undefined, urgent);
    if (isFigureStateQueued(row.def, row.state)) queued = true;
  }
  return queued;
}

export class CrowdResidentSet implements ResidentSet<CitizenFigure> {
  readonly leadSeconds = CROWD_REWARM_LEAD_SECONDS;
  readonly releaseHysteresisTiles = CROWD_RELEASE_HYSTERESIS_TILES;
  /** Nothing pins a crowd but this set, so a look is released until a decision holds it. */
  readonly entriesStartHeld = false;
  /** The looks held now, by key. */
  private readonly heldLooks = new Set<string>();

  constructor(private readonly deps: CrowdResidentSetDeps) {}

  keyOf(figure: CitizenFigure): string {
    return citizenLookKey(figure);
  }

  placements(): ReadonlyArray<ResidentPlacement<CitizenFigure>> {
    return this.deps.people().flatMap((person) => {
      const figure = person.citizenFigure;
      if (figure === null) return [];
      return [
        {
          entry: figure,
          area: {
            x: person.x / TILE_SIZE,
            y: person.y / TILE_SIZE,
            w: CITIZEN_AREA_TILES,
            h: CITIZEN_AREA_TILES,
          },
        },
      ];
    });
  }

  hold(figure: CitizenFigure): void {
    this.heldLooks.add(citizenLookKey(figure));
    pinCitizenFigure(figure);
  }

  release(figure: CitizenFigure): void {
    this.heldLooks.delete(citizenLookKey(figure));
    unpinCitizenFigure(figure);
  }

  /**
   * Urgent within the hold ring, because the cache may be full of rows a
   * fight drew a moment ago, which a speculative request may not displace.
   * A look still held just outside it is baked back into whatever room the
   * cache has, unless something drawn lately ran the cache short of room,
   * when the row would only be dropped again; asked for on every decision,
   * since a speculative request for a figure nothing draws lapses. A
   * released look is not asked for at all: its rows are the idle sweep's.
   */
  warm(figure: CitizenFigure, urgency: ResidentUrgency): boolean {
    if (urgency === 'speculative') {
      if (!this.heldLooks.has(citizenLookKey(figure)) || figureCacheRoomContested()) return false;
      return warmMissing(citizenFigureRows(figure), false);
    }
    const rows = citizenFigureRows(figure);
    if (urgency === 'forgiving') {
      for (const row of rows) {
        if (!isFigureStateWarm(row.def, row.state)) forgiveFigurePrewarmGiveUp(row.def, row.state);
      }
    }
    return warmMissing(rows, true);
  }

  warmth(figure: CitizenFigure): ResidentWarmth {
    const missing = citizenFigureRows(figure).filter(
      (row) => !isFigureStateWarm(row.def, row.state),
    );
    if (missing.length === 0) return 'warm';
    return missing.some((row) => isFigureStateQueued(row.def, row.state)) ? 'queued' : 'stalled';
  }

  hurryWhileCovered(): void {
    boostPrewarmBudget(OWED_REWARM_BUDGET_MS, OWED_REWARM_FRAMES);
  }

  /**
   * Spreads a cold crowd's rows across the frames before it comes into view,
   * which still render, rather than leaving them to the ordinary budget that
   * cannot rewarm a whole crowd within the lead; the citizen sprite wrapper's
   * approximate draw path covers whatever has not landed yet with an
   * already-baked stand-in instead of a render-path bake.
   */
  hurryWhileApproached(): void {
    boostPrewarmBudget(OWED_REWARM_BUDGET_MS, OWED_REWARM_FRAMES);
  }

  bakeFor(budgetMs: number, mustProgress: boolean): void {
    bakeFigurePrewarmFor(budgetMs, mustProgress);
  }
}
