/**
 * Keeps the town's crowd out of the figure cache's way while the party is far
 * from town, and its rows back in place before the party sees it again.
 *
 * The crowd's rows are pinned so a strolling crowd never shows a stand-in, and
 * they fill nearly half the figure cache for as long as the overworld scene is
 * open. In Briar Hollow a siege's wave of distinct creatures needs that room;
 * while the crowd off screen holds it, the siege's own rows evict one another
 * and are painted live.
 *
 * Everything is decided by how far a camera would have to travel before a
 * citizen came into view, from each place the next frames may be drawn
 * around: either crawler (a switch moves the camera to the other at once), and
 * the landing of a warp that is coming. Beyond the release distance a look's
 * rows are stood down — still pinned against the idle sweep, but evictable
 * when something on screen needs the room. Within the hold distance they are
 * held again and anything missing is asked for, nearest look first.
 */

import { PLAYER_SPEED, TILE_SIZE } from '../core/constants';
import { viewportHeight, viewportWidth } from '../core/Viewport';
import { REFRESHED_SPEED_FACTOR } from '../core/StatusEffect';
import { SPEED_FIZZ_MULTIPLIER } from '../Player';
import { citizenFigureRows, citizenLookKey, type CitizenFigure } from '../creatures/citizenFigure';
import {
  boostPrewarmBudget,
  forgiveFigurePrewarmGiveUp,
  isFigureStateQueued,
  isFigureStateWarm,
  prewarmFigureState,
  setFigureStatePinStandby,
} from '../sprites/figure/figureFrameCache';
import type { DrawnFigureRow } from '../sprites/figure/figureDef';
import type { TileRect } from '../map/town/townPlan';

const UPDATES_PER_SECOND = 60;

/** The fastest a crawler walks without cheats: Speed Fizz on top of the stall's boon. */
const FASTEST_WALK_TILES_PER_SECOND =
  (PLAYER_SPEED * SPEED_FIZZ_MULTIPLIER * REFRESHED_SPEED_FACTOR * UPDATES_PER_SECOND) / TILE_SIZE;

/**
 * Seconds of walking at full speed a look's rows are asked for ahead of its
 * first citizen coming into view, rebaked within the ordinary prewarm budget.
 * Measured headless at node's cost per cell (several times a browser's): a
 * full-speed walk from the far side of Briar Hollow straight after a fight
 * met a few stand-ins at four seconds and none at five (`verify:town-residency`).
 * Longer would hold the crowd across most of the village, where a siege needs
 * its room.
 */
const CROWD_REWARM_LEAD_SECONDS = 5;

/**
 * Tiles past the hold distance a look must be before it is stood down, so a
 * party standing on the edge does not stand it down and hold it again every
 * few steps.
 */
const RELEASE_HYSTERESIS_TILES = 12;

/** Updates between decisions: often enough that the fastest walk moves under two tiles between them. */
const CHECK_INTERVAL_UPDATES = 10;

/**
 * Milliseconds per frame the figure prewarm may spend while a death screen
 * covers the world and the rows of the save point it leads to are owed: the
 * town arrival's own boost. Never during play — a recall channel included,
 * whose caster is still in the fight — where it would come on top of a full
 * frame.
 */
const COVERED_REWARM_BUDGET_MS = 10;
/** Renewed on every decision, so it lapses one decision after the cover lifts. */
const COVERED_REWARM_FRAMES = CHECK_INTERVAL_UPDATES + 1;

/** A citizen, as far as residency cares: where it stands and what it wears. */
export interface ResidencyCitizen {
  readonly x: number;
  readonly y: number;
  readonly figure: CitizenFigure;
  /** Pins the look worn now and any look worn later; see `Townsperson.pinLook`. */
  pinLook(): void;
}

export interface TownResidencyDeps {
  /** Every citizen of the town, drawn or not: the strolling crowd and the market's vendors. */
  readonly people: () => ReadonlyArray<ResidencyCitizen>;
  /**
   * Whether something far from town is using the figure cache's room — a
   * siege — so a crowd row it evicted is not baked back only to be evicted
   * again.
   */
  readonly roomContested: () => boolean;
}

/** A point, in world pixels, the next frames may be drawn around. */
export interface ResidencyFocus {
  readonly x: number;
  readonly y: number;
}

/** The focus of a camera centred on a map tile. */
export function tileFocus(tile: { readonly x: number; readonly y: number }): ResidencyFocus {
  return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
}

/**
 * What the next frames may show: the points they may be drawn around, and
 * whether the world is covered while the party waits to be put at one of them.
 */
export interface ResidencyOutlook {
  readonly focus: ReadonlyArray<ResidencyFocus>;
  readonly covered: boolean;
}

/**
 * How far, in tiles, a camera centred on `focus` must move before any of
 * `area` comes into view: zero while some of it is in view already.
 */
function tilesUntilInView(focus: ResidencyFocus, area: TileRect): number {
  const halfViewW = viewportWidth() / 2 / TILE_SIZE;
  const halfViewH = viewportHeight() / 2 / TILE_SIZE;
  const focusTileX = focus.x / TILE_SIZE;
  const focusTileY = focus.y / TILE_SIZE;
  const dx = Math.max(area.x - focusTileX, 0, focusTileX - (area.x + area.w)) - halfViewW;
  const dy = Math.max(area.y - focusTileY, 0, focusTileY - (area.y + area.h)) - halfViewH;
  return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
}

function tilesUntilCitizenInView(focus: ResidencyFocus, person: ResidencyCitizen): number {
  return tilesUntilInView(focus, { x: person.x / TILE_SIZE, y: person.y / TILE_SIZE, w: 1, h: 1 });
}

function setStandby(rows: ReadonlyArray<DrawnFigureRow>, standby: boolean): void {
  for (const row of rows) setFigureStatePinStandby(row.def, row.state, standby);
}

function rowsWarm(rows: ReadonlyArray<DrawnFigureRow>): boolean {
  return rows.every((row) => isFigureStateWarm(row.def, row.state));
}

/** Asks for the rows not fully baked, returning whether there were any. */
function warmMissing(rows: ReadonlyArray<DrawnFigureRow>, urgent: boolean): boolean {
  let missing = false;
  for (const row of rows) {
    if (isFigureStateWarm(row.def, row.state)) continue;
    prewarmFigureState(row.def, row.state, undefined, urgent);
    missing = true;
  }
  return missing;
}

const HOLD_TILES = CROWD_REWARM_LEAD_SECONDS * FASTEST_WALK_TILES_PER_SECOND;
const RELEASE_TILES = HOLD_TILES + RELEASE_HYSTERESIS_TILES;

interface LookDistance {
  readonly key: string;
  readonly figure: CitizenFigure;
  readonly tiles: number;
}

export class TownResidency {
  /** Looks whose rows are stood down, keyed by {@link citizenLookKey}. Every look starts held. */
  private readonly standingDown = new Set<string>();
  private updatesUntilCheck = 0;

  constructor(private readonly deps: TownResidencyDeps) {
    // The town pins its strolling crowd as it builds it; everyone else this
    // decides for, such as the market's vendors, is pinned here alike.
    for (const person of deps.people()) person.pinLook();
  }

  /** Decides, every few updates, which looks to hold and which to stand down. */
  update(outlook: ResidencyOutlook): void {
    if (this.updatesUntilCheck > 0) {
      this.updatesUntilCheck--;
      return;
    }
    this.updatesUntilCheck = CHECK_INTERVAL_UPDATES;
    this.settleNow(outlook);
  }

  /** {@link update}'s decision, made now: for a warp that has just moved the party. */
  settleNow(outlook: ResidencyOutlook): void {
    if (outlook.focus.length === 0) return;
    this.settle(outlook);
  }

  /**
   * Whether every look within the hold distance of `focus` is fully baked:
   * for a warp, which must not put the party down where the crowd is cold.
   */
  isWarmAround(focus: ResidencyFocus): boolean {
    for (const look of this.lookDistances([focus])) {
      if (look.tiles > HOLD_TILES) break;
      if (!rowsWarm(citizenFigureRows(look.figure))) return false;
    }
    return true;
  }

  /**
   * Asks again, urgently, for every row missing within the hold distance of
   * `focus`, forgiving any the queue gave up on: for a loading screen
   * covering a warp there, under which room may be made that could not be
   * made in play.
   */
  forgiveAndWarmAround(focus: ResidencyFocus): void {
    for (const look of this.lookDistances([focus])) {
      if (look.tiles > HOLD_TILES) break;
      const rows = citizenFigureRows(look.figure);
      for (const row of rows) {
        if (!isFigureStateWarm(row.def, row.state)) forgiveFigurePrewarmGiveUp(row.def, row.state);
      }
      warmMissing(rows, true);
    }
  }

  /**
   * The share of looks within the hold distance of `focus` that are warm, and
   * whether any row still missing is still queued — none means the queue has
   * baked or given up on all of them.
   */
  warmthAround(focus: ResidencyFocus): { share: number; anyQueued: boolean } {
    const near = this.lookDistances([focus]).filter((look) => look.tiles <= HOLD_TILES);
    if (near.length === 0) return { share: 1, anyQueued: false };
    let warm = 0;
    let anyQueued = false;
    for (const look of near) {
      const missing = citizenFigureRows(look.figure).filter(
        (row) => !isFigureStateWarm(row.def, row.state),
      );
      if (missing.length === 0) warm++;
      if (missing.some((row) => isFigureStateQueued(row.def, row.state))) anyQueued = true;
    }
    return { share: warm / near.length, anyQueued };
  }

  /** Each look's distance from the nearest focus, nearest first. */
  private lookDistances(focus: ReadonlyArray<ResidencyFocus>): LookDistance[] {
    const nearestByLook = new Map<string, LookDistance>();
    for (const person of this.deps.people()) {
      const key = citizenLookKey(person.figure);
      let tiles = Number.POSITIVE_INFINITY;
      for (const point of focus) tiles = Math.min(tiles, tilesUntilCitizenInView(point, person));
      const known = nearestByLook.get(key);
      if (known === undefined || tiles < known.tiles) {
        nearestByLook.set(key, { key, figure: person.figure, tiles });
      }
    }
    return [...nearestByLook.values()].sort((a, b) => a.tiles - b.tiles);
  }

  /**
   * The crowd's rows stay pinned throughout, so the idle sweep never takes
   * them and a quiet visit to the country costs no re-bake. Far from town
   * they are stood down, so a fight that needs the room may evict them.
   */
  private settle(outlook: ResidencyOutlook): void {
    const contested = this.deps.roomContested();
    let owedUnderCover = false;
    // Nearest first, so the queue bakes the looks the camera reaches first.
    for (const look of this.lookDistances(outlook.focus)) {
      const rows = citizenFigureRows(look.figure);
      if (look.tiles <= HOLD_TILES) {
        if (this.standingDown.delete(look.key)) setStandby(rows, false);
        // Urgent, because the cache may be full of rows a fight drew a
        // moment ago, which a speculative request may not displace.
        if (warmMissing(rows, true)) owedUnderCover = outlook.covered;
        continue;
      }
      if (look.tiles > RELEASE_TILES && !this.standingDown.has(look.key)) {
        this.standingDown.add(look.key);
        setStandby(rows, true);
      }
      // Baked back into whatever room the cache has once the fight is over;
      // asked for again on every decision, since a speculative request for a
      // figure nothing draws lapses.
      if (!contested) warmMissing(rows, false);
    }
    if (owedUnderCover) boostPrewarmBudget(COVERED_REWARM_BUDGET_MS, COVERED_REWARM_FRAMES);
  }
}
