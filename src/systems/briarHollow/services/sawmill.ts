/**
 * Processing wood by hand at the sawmill's two machines: the saw makes
 * boards, the rope frame makes rope. Each machine does one job, so walking up
 * to one is already the choice of output.
 *
 * One press works one wood, over {@link MANUAL_PROCESS_SECONDS}. Holding the
 * interact key carries straight on to the next wood when one finishes, and a
 * long-press on a machine does the same on a touch screen; either stops when
 * the key is let go, a tap lands, the wood runs out, or the crawler moves.
 * Moving mid-cut cancels it and spends nothing — the wood is only taken when
 * the work is done.
 */

import type { AudioManager } from '../../../audio/AudioManager';
import { TILE_SIZE } from '../../../core/constants';
import type { EventBus } from '../../../core/EventBus';
import { ITEM_DEF } from '../../../core/ItemDefs';
import type { BriarHollowSite } from '../../../map/overworld/briarHollowSite';
import { BUILD_ROWS } from '../../../sprites/art/humanFigure';
import { viewForFacing } from '../../../sprites/humanSprite';
import { drawProgressBar, PROGRESS_PRESETS } from '../../../ui/Box';
import { drawInteractionPrompt } from '../../../ui/InteractionPrompt';
import {
  type ProcessingStation,
  type ProcessingStationKind,
  processingStationInReach,
  processingStationsOf,
} from '../processingStations';
import { BAG_FULL_LINE, type Crawler, type ServiceParty } from './serviceContext';
import {
  MANUAL_PROCESS_SECONDS,
  grantManualProcessingXp,
  outputItem,
  partyWood,
  processWood,
  processableWood,
} from './woodProcessing';

const UPDATES_PER_SECOND = 60;
const MANUAL_PROCESS_FRAMES = Math.round(MANUAL_PROCESS_SECONDS * UPDATES_PER_SECOND);

/**
 * How far the worker may drift before the cut counts as abandoned. Measured
 * from position rather than read off `isMoving`, which means "tried to walk":
 * a shove that moves the body without a key has to end it too.
 */
const WORK_MOTION_TOLERANCE_PX = 0.5;

/** The notice for pressing at a machine with no wood anywhere in the party's packs. */
export const NEED_WOOD_LINE = 'You need wood.';

/** How close Fenna must be to overhear a press with no wood, and tell the party so. */
export const FENNA_OVERHEARS_TILES = 8;

const PROMPT_LABELS: Readonly<Record<ProcessingStationKind, string>> = {
  boards: 'Saw',
  rope: 'Twist',
};

const PROGRESS_BAR_WIDTH = 40;
const PROGRESS_BAR_HEIGHT = 5;
const PROGRESS_BAR_LIFT = 10;
const TILE_CENTRE = 0.5;

export interface SawmillDeps {
  readonly party: ServiceParty;
  readonly site: BriarHollowSite;
  readonly bus: EventBus | null;
  readonly audio: AudioManager | null;
  /** The sawmill's working switch: its blade spins while set. */
  readonly sawmill: { working: boolean };
  readonly announce: (message: string) => void;
  readonly noteResourceActivity: () => void;
  /** Tiles from Fenna to the worker, or null when she is not on the map. */
  readonly fennaTilesFrom: (crawler: Crawler) => number | null;
  /** Has Fenna say she needs wood to work with. */
  readonly fennaNoWood: () => void;
}

interface ManualJob {
  readonly station: ProcessingStation;
  readonly worker: Crawler;
  readonly startX: number;
  readonly startY: number;
  framesLeft: number;
}

function bodyCentre(crawler: Crawler): { x: number; y: number } {
  return { x: crawler.x + TILE_SIZE * TILE_CENTRE, y: crawler.y + TILE_SIZE * TILE_CENTRE };
}

function footprintCentre(station: ProcessingStation): { x: number; y: number } {
  const { x, y, w, h } = station.footprint;
  return { x: (x + w / 2) * TILE_SIZE, y: (y + h / 2) * TILE_SIZE };
}

export type PressOutcome = 'started' | 'busy' | 'no_wood' | 'bag_full';

export class SawmillService {
  private readonly stations: ProcessingStation[];
  private job: ManualJob | null = null;
  /** Whether the interact key is down, as the press that started the run left it. */
  private keyHeld = false;
  /** A long-press asked for the run to carry on until something stops it. */
  private keepGoing = false;

  constructor(private readonly deps: SawmillDeps) {
    this.stations = processingStationsOf(deps.site);
  }

  /** The machine `crawler` can work from where they stand, or null. */
  stationFor(crawler: Crawler): ProcessingStation | null {
    const centre = bodyCentre(crawler);
    return processingStationInReach(this.stations, centre.x, centre.y);
  }

  /** How far `crawler` stands from the nearest machine's footprint, in tiles; Infinity with none. */
  tilesToStation(crawler: Crawler): number {
    const centre = bodyCentre(crawler);
    let best = Infinity;
    for (const station of this.stations) {
      const { x, y, w, h } = station.footprint;
      const tileX = centre.x / TILE_SIZE;
      const tileY = centre.y / TILE_SIZE;
      const dx = Math.max(x - tileX, 0, tileX - (x + w));
      const dy = Math.max(y - tileY, 0, tileY - (y + h));
      best = Math.min(best, Math.hypot(dx, dy));
    }
    return best;
  }

  get isWorking(): boolean {
    return this.job !== null;
  }

  /** Whether the saw itself is cutting — the one machine that is heard while it runs. */
  get isSawing(): boolean {
    return this.job?.station.kind === 'boards';
  }

  /** The interact key went down (`true`) or up (`false`). Only a held key carries a run on. */
  setKeyHeld(held: boolean): void {
    this.keyHeld = held;
  }

  /**
   * A press at a machine: starts one wood, or explains why not. Returns null
   * when `worker` is not at a machine, so the press can go elsewhere.
   */
  press(worker: Crawler, keepGoing = false): PressOutcome | null {
    const station = this.stationFor(worker);
    if (station === null) return null;
    if (this.job !== null) {
      // A tap on the machine while it runs is how a touch player stops a long-press run.
      this.keepGoing = false;
      return 'busy';
    }
    const outcome = this.refusal(worker, station);
    if (outcome !== null) return outcome;
    this.keepGoing = keepGoing;
    this.start(worker, station);
    return 'started';
  }

  private refusal(worker: Crawler, station: ProcessingStation): PressOutcome | null {
    if (partyWood(this.deps.party) < 1) {
      this.deps.announce(NEED_WOOD_LINE);
      this.deps.audio?.play('error');
      const fennaTiles = this.deps.fennaTilesFrom(worker);
      if (fennaTiles !== null && fennaTiles <= FENNA_OVERHEARS_TILES) this.deps.fennaNoWood();
      return 'no_wood';
    }
    if (processableWood(this.deps.party, worker, station.kind) < 1) {
      this.deps.announce(BAG_FULL_LINE);
      this.deps.audio?.play('error');
      return 'bag_full';
    }
    return null;
  }

  private start(worker: Crawler, station: ProcessingStation): void {
    this.job = {
      station,
      worker,
      startX: worker.x,
      startY: worker.y,
      framesLeft: MANUAL_PROCESS_FRAMES,
    };
    if (station.kind === 'boards') this.deps.sawmill.working = true;
    this.startWorkingPose(worker, station);
  }

  private startWorkingPose(worker: Crawler, station: ProcessingStation): void {
    if (worker !== this.deps.party.human) return;
    const from = bodyCentre(worker);
    const to = footprintCentre(station);
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const distance = Math.hypot(dx, dy);
    const faceX = distance > 0 ? dx / distance : worker.facingX;
    const faceY = distance > 0 ? dy / distance : worker.facingY;
    this.deps.party.human.playAction(BUILD_ROWS[viewForFacing(faceX, faceY)], {
      faceX,
      faceY,
      loop: true,
    });
  }

  /** Stops whatever is under way; nothing is spent. */
  cancel(): void {
    const job = this.job;
    if (job === null) return;
    this.job = null;
    this.keepGoing = false;
    this.stopEffects(job);
  }

  private stopEffects(job: ManualJob): void {
    this.deps.sawmill.working = false;
    if (job.worker === this.deps.party.human) this.deps.party.human.stopAction();
  }

  /** One fixed step. `halted`: the world is stopped under a menu, and the cut waits with it. */
  update(halted: boolean): void {
    const job = this.job;
    if (job === null || halted) return;
    const moved = Math.hypot(job.worker.x - job.startX, job.worker.y - job.startY);
    if (moved > WORK_MOTION_TOLERANCE_PX || !job.worker.isActive || !job.worker.isAlive) {
      this.cancel();
      return;
    }
    job.framesLeft--;
    if (job.framesLeft > 0) return;
    this.finish(job);
  }

  private finish(job: ManualJob): void {
    const result = processWood(this.deps.party, job.worker, job.station.kind, 1);
    this.deps.noteResourceActivity();
    if (result === null) {
      this.job = null;
      this.stopEffects(job);
      this.deps.announce(BAG_FULL_LINE);
      return;
    }
    grantManualProcessingXp(job.worker, result.woodSpent);
    if (job.station.kind === 'rope') this.deps.audio?.play('rope_tightening');
    result.recipient.queueFloatingText(
      `+${result.produced} ${ITEM_DEF[outputItem(job.station.kind)].name}`,
      'buff',
    );
    this.deps.bus?.emit('woodProcessed', {
      output: job.station.kind,
      count: result.produced,
      woodSpent: result.woodSpent,
      via: 'manual',
    });
    const carryOn =
      (this.keyHeld || this.keepGoing) &&
      this.stationFor(job.worker) === job.station &&
      processableWood(this.deps.party, job.worker, job.station.kind) >= 1;
    if (carryOn) {
      job.framesLeft = MANUAL_PROCESS_FRAMES;
      return;
    }
    this.job = null;
    this.keepGoing = false;
    this.stopEffects(job);
  }

  /** The machine's SPACE prompt, while the active crawler can work it. Returns whether one was drawn. */
  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: Crawler,
  ): boolean {
    if (this.job !== null) return false;
    const station = this.stationFor(active);
    if (station === null) return false;
    const { x, y, w } = station.footprint;
    drawInteractionPrompt(
      ctx,
      x * TILE_SIZE - camX,
      y * TILE_SIZE - camY,
      w * TILE_SIZE,
      PROMPT_LABELS[station.kind],
    );
    return true;
  }

  /** The cut's progress over the machine, in world space. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const job = this.job;
    if (job === null) return;
    const { x, y, w } = job.station.footprint;
    const centreX = (x + w / 2) * TILE_SIZE - camX;
    drawProgressBar(ctx, {
      x: centreX - PROGRESS_BAR_WIDTH / 2,
      y: y * TILE_SIZE - camY - PROGRESS_BAR_LIFT,
      width: PROGRESS_BAR_WIDTH,
      height: PROGRESS_BAR_HEIGHT,
      value: 1 - job.framesLeft / MANUAL_PROCESS_FRAMES,
      ...PROGRESS_PRESETS.build,
    });
  }

  dispose(): void {
    this.cancel();
  }
}
