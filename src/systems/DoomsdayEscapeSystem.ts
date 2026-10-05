/**
 * DoomsdayEscapeSystem — the overworld half of "Carl's Doomsday Scenario".
 *
 * The escape stairwell by the tower door is on the map from the moment the
 * countdown starts, so the player always knows where the way out is. It is
 * sealed until the soul crystal is contained; after that, reaching it before
 * the deadline ends the run. It stays for good once the party has escaped: a
 * player who chose to keep exploring can walk back down it, and end the run
 * again, whenever they like. Letting the deadline pass — while escaping or, if
 * the player left the tower without containing the crystal, while containing —
 * kills both players via a dedicated death cause.
 *
 * The escape tile is read from `gameMap.doomsdayEscapeTile`, a dedicated
 * field set at overworld generation time — deliberately not part of
 * `gameMap.stairwellTiles`, which feeds StairwellSystem's floor-descent menu
 * and MiniMapSystem's minimap reveal. Adding it there would make the stairwell
 * a floor exit, and expose a permanent marker from the start of the floor,
 * long before the finale exists.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { GameSystem, SystemContext } from './GameSystem';
import {
  DOOMSDAY_CONTAIN_OBJECTIVE,
  type DoomsdayProgress,
  formatCountdownClock,
  isCountdownUrgent,
  isDoomsdayCountdownLive,
  triggerDoomsdayExplosionIfExpired,
} from '../core/DoomsdayProgress';
import { renderEscapeStairwell, STAIRWELL_SCALE } from '../sprites/doomsdayStairwell';
import type { TopBandEntry } from '../ui/hud/topBand';
import { stackedBandEntry, type BandRow } from '../ui/hud/topBandStack';
import type { TownPropRenderable } from './townPropRenderable';
import type { TrackerEntry, TrackerSource, TrackerTarget } from './questTracker';
import { towerApproachBeaconTarget } from './objectiveBeaconTargets';

/** How close the player must be to the escape tile to take the stairs. */
const REACH_RANGE_TILES = 1.2;

/**
 * How far north of its own tile the stairwell sorts in the Y-sorted pass.
 *
 * It is a hole in the ground: anybody standing on or beside it has to be drawn
 * over it. Sorting on its own tile row would put it level with a crawler whose
 * feet are on that row, and the pass breaks that tie in the prop's favour. One
 * row up still sorts well south of the tower, whose art would otherwise cover it.
 */
const STAIRWELL_SORT_LIFT_TILES = 1;

/** What the countdown card says while the crystal is still loose, in the city and in the tower alike. */
export const CONTAINMENT_LABEL = 'THE SOUL CRYSTAL IS DESTABILIZING';

/** Shown once per visit when the party steps on the stairs before the crystal is contained. */
export const STAIRWELL_SEALED_TOAST = 'The crystal must be contained first';

/**
 * Shown when the party reaches the open stairs with a crawler knocked out. The
 * run ends at the bottom of them, so a companion left lying here could never be
 * revived — and a save taken over a knockout would stand them up for free.
 */
export const STAIRWELL_KNOCKED_OUT_TOAST = 'Revive your partner before you go down';

/** Stable Journal id for the finale, so a pin on it survives the objective changing under it. */
export const DOOMSDAY_TRACKER_ID = 'doomsday_scenario';
const DOOMSDAY_TRACKER_NAME = "Carl's Doomsday Scenario";
const ESCAPE_OBJECTIVE = 'Reach the escape stairwell';
const ESCAPED_OBJECTIVE = 'You escaped the city';
/** The stairwell's art is two tiles wide; the beacon should stand over all of it. */
const STAIRWELL_BEACON_WIDTH_TILES = 2;

/** A point-in-time copy of the escape one-shot latch. */
export interface DoomsdayEscapeCheckpoint {
  floorEscapedPending: boolean;
}

export class DoomsdayEscapeSystem implements GameSystem, TrackerSource {
  /**
   * Set once the player reaches the stairs in time. DungeonScene reads and
   * clears it to save the run and put up the run-complete screen.
   */
  floorEscapedPending = false;
  /**
   * Set on the first frame this scene sees the countdown running. The scene
   * pins the finale's Journal entry in answer, so the world arrow and beacon
   * point at the crystal or the stairs without the player having to find the
   * pin — the finale is started by a boss dying, not by accepting a quest.
   */
  pinRequested = false;

  private countdownSeen = false;
  /** Latched while the party stands on the sealed stairs, so the refusal toasts once per visit. */
  private standingOnSealedStairs = false;
  /**
   * Whether the party has been off the stairs since this scene set them down.
   *
   * After the escape, going back down the stairs ends the run again, but only
   * as a fresh step onto them: the party is standing on the stairs when they
   * choose to keep exploring, and a save taken there reloads them onto it.
   */
  private steppedOffStairs = false;

  /** The stairwell as a Y-sorted fixture, for the scene to hand the render pipeline. */
  readonly stairwellProp: TownPropRenderable;

  constructor(
    private readonly gameMap: GameMap,
    private readonly progress: DoomsdayProgress,
    private readonly showToast: (message: string) => void,
    /**
     * Why the party cannot go down the stairs yet, or null when it can. Asked
     * only once the crystal is contained.
     */
    private readonly escapeRefusal: () => string | null = () => null,
  ) {
    this.stairwellProp = this.buildStairwellProp();
  }

  /**
   * Snapshots only this system's own latch. `DoomsdayProgress` is deliberately
   * left alone: the countdown keeps running through a death, so its stage and
   * deadline are not the checkpoint's to rewind.
   */
  captureCheckpoint(): DoomsdayEscapeCheckpoint {
    return { floorEscapedPending: this.floorEscapedPending };
  }

  restoreCheckpoint(snapshot: DoomsdayEscapeCheckpoint): void {
    this.floorEscapedPending = snapshot.floorEscapedPending;
    // The respawn may set the party down on the stairs they saved beside.
    this.steppedOffStairs = false;
  }

  /** The stairwell's tile whenever it stands on the map, for the minimap; null otherwise. */
  get escapeMarkerTile(): { x: number; y: number } | null {
    if (!isEscapeStairwellStanding(this.progress)) return null;
    return this.gameMap.doomsdayEscapeTile ?? null;
  }

  update(ctx: SystemContext): void {
    if (isDoomsdayCountdownLive(this.progress) && !this.countdownSeen) {
      this.countdownSeen = true;
      this.pinRequested = true;
    }

    const escapeTile = this.gameMap.doomsdayEscapeTile;
    const onStairs =
      escapeTile !== undefined &&
      Math.hypot(
        ctx.active.x - escapeTile.x * TILE_SIZE,
        ctx.active.y - escapeTile.y * TILE_SIZE,
      ) <=
        TILE_SIZE * REACH_RANGE_TILES;

    const refusal = !onStairs
      ? null
      : this.progress.stage === 'containment'
        ? STAIRWELL_SEALED_TOAST
        : this.progress.stage === 'escape' || this.progress.stage === 'complete'
          ? this.escapeRefusal()
          : null;

    if (onStairs && this.progress.stage === 'escape' && refusal === null) {
      this.progress.stage = 'complete';
      this.progress.deadlineAt = null;
      this.floorEscapedPending = true;
      this.steppedOffStairs = false;
      return;
    }

    const returnsDownStairs =
      onStairs && this.progress.stage === 'complete' && this.steppedOffStairs && refusal === null;
    if (returnsDownStairs) {
      this.floorEscapedPending = true;
      this.steppedOffStairs = false;
      return;
    }
    if (!onStairs) this.steppedOffStairs = true;

    const sealed = refusal !== null;
    if (refusal !== null && !this.standingOnSealedStairs) this.showToast(refusal);
    this.standingOnSealedStairs = sealed;

    triggerDoomsdayExplosionIfExpired(this.progress, ctx.human, ctx.cat);
  }

  trackerEntries(): ReadonlyArray<TrackerEntry> {
    switch (this.progress.stage) {
      case 'inactive':
        return [];
      case 'containment': {
        const towerDoor = this.gameMap.buildingEntries.find((entry) => entry.type === 'tower');
        const target = towerApproachBeaconTarget(towerDoor ?? null) ?? undefined;
        return [this.trackerEntry('active', DOOMSDAY_CONTAIN_OBJECTIVE, target)];
      }
      case 'escape': {
        const escapeTile = this.gameMap.doomsdayEscapeTile;
        const target: TrackerTarget | undefined =
          escapeTile === undefined
            ? undefined
            : { x: escapeTile.x, y: escapeTile.y, widthTiles: STAIRWELL_BEACON_WIDTH_TILES };
        return [this.trackerEntry('active', ESCAPE_OBJECTIVE, target)];
      }
      case 'complete':
        return [this.trackerEntry('completed', ESCAPED_OBJECTIVE, undefined)];
    }
  }

  private trackerEntry(
    status: TrackerEntry['status'],
    objective: string,
    target: TrackerTarget | undefined,
  ): TrackerEntry {
    return target === undefined
      ? { id: DOOMSDAY_TRACKER_ID, name: DOOMSDAY_TRACKER_NAME, status, objective }
      : { id: DOOMSDAY_TRACKER_ID, name: DOOMSDAY_TRACKER_NAME, status, objective, target };
  }

  private buildStairwellProp(): TownPropRenderable {
    const escapeTile = this.gameMap.doomsdayEscapeTile;
    const progress = this.progress;
    return {
      x: (escapeTile?.x ?? 0) * TILE_SIZE,
      y: ((escapeTile?.y ?? 0) - STAIRWELL_SORT_LIFT_TILES) * TILE_SIZE,
      cullMarginTiles: STAIRWELL_SCALE + STAIRWELL_SORT_LIFT_TILES,
      render(ctx, camX, camY) {
        if (escapeTile === undefined || !isEscapeStairwellStanding(progress)) return;
        renderEscapeStairwell(ctx, escapeTile, camX, camY, progress.stage !== 'containment');
      },
    };
  }

  /** Countdown HUD — shown while the doomsday countdown is running, whether the crystal is contained yet or not. */
  topBandEntry(): TopBandEntry | null {
    const { stage, deadlineAt } = this.progress;
    if (!isDoomsdayCountdownLive(this.progress) || deadlineAt === null) return null;
    return doomsdayCountdownEntry({
      id: 'doomsday-countdown',
      label: stage === 'containment' ? CONTAINMENT_LABEL : 'GET TO THE ESCAPE ROUTE',
      deadlineAt,
    });
  }
}

/** What a doomsday countdown card says, and when it runs out. */
export interface DoomsdayCountdownOptions {
  /** Unique within the band this frame. */
  readonly id: string;
  readonly label: string;
  readonly deadlineAt: number;
  /** A line under the label saying what to do about it. */
  readonly objective?: string;
}

/**
 * The doomsday countdown as a top-band entry: the clock, what it is counting
 * down to, and optionally what to do about it. Shared by the overworld and the
 * tower, so the deadline reads the same wherever the party stands.
 */
export function doomsdayCountdownEntry(opts: DoomsdayCountdownOptions): TopBandEntry {
  const tone = isCountdownUrgent(opts.deadlineAt) ? 'danger' : 'warning';
  const rows: BandRow[] = [
    {
      kind: 'text',
      text: formatCountdownClock(opts.deadlineAt),
      role: 'heading',
      tone,
      tabular: true,
    },
    { kind: 'text', text: opts.label, role: 'label', tone: 'danger', wrap: true, maxLines: 2 },
  ];
  if (opts.objective !== undefined) {
    rows.push({ kind: 'text', text: opts.objective, role: 'caption', wrap: true, maxLines: 2 });
  }
  return stackedBandEntry({
    id: opts.id,
    priority: 'countdown',
    accentTone: tone,
    rows,
  });
}

/**
 * Whether the escape stairwell is on the map: from the moment the countdown
 * starts, and permanently once the party has escaped down it.
 */
function isEscapeStairwellStanding(progress: DoomsdayProgress): boolean {
  return isDoomsdayCountdownLive(progress) || progress.stage === 'complete';
}
