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
import { drawInteractionPrompt, interactionPromptsSuppressed } from '../../../ui/InteractionPrompt';
import { drawRopeCoilGlyph, drawSawBladeGlyph } from '../../../ui/icons/stationGlyphs';
import {
  PROCESSING_REACH_TILES,
  type ProcessingStation,
  type ProcessingStationKind,
  footprintCentreTile,
  processingStationInReach,
  processingStationsOf,
  stationArtTopTileY,
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

/**
 * The far indicator's glyph, matching the minimap's: a saw blade for the mill,
 * a rope coil for the frame, so a glance from across the yard already answers
 * "what does this make?" the same way the minimap does.
 */
const STATION_GLYPH: Readonly<
  Record<
    ProcessingStationKind,
    (ctx: CanvasRenderingContext2D, cx: number, cy: number, radius: number) => void
  >
> = {
  boards: drawSawBladeGlyph,
  rope: drawRopeCoilGlyph,
};

const PROGRESS_BAR_WIDTH = 40;
const PROGRESS_BAR_HEIGHT = 5;
const PROGRESS_BAR_LIFT = 10;
const TILE_CENTRE = 0.5;

/** Glyph radius inside the far indicator's badge. */
const FAR_ICON_GLYPH_RADIUS = 7;
/** Badge padding around the glyph. */
const FAR_ICON_PADDING = 5;
const FAR_ICON_BADGE_SIZE = FAR_ICON_GLYPH_RADIUS * 2 + FAR_ICON_PADDING * 2;
const FAR_ICON_BADGE_RADIUS = 5;
const FAR_ICON_BOB_PERIOD_MS = 1100;
const FAR_ICON_BOB_AMPLITUDE = 3;
/** Clear air kept between the badge's lowest point and the prop's own art, at rest. */
const FAR_ICON_GAP_ABOVE_ART = 4;
/**
 * How far above the machine's actual art-top row (per station, via
 * `stationArtTopTileY` — a "tall" sawmill and a "low" rope frame reach different
 * heights) the badge's centre floats, so that even at the lowest point of its
 * bob the whole badge sits clear above the tallest ink the prop's sheet paints.
 */
const FAR_ICON_LIFT = FAR_ICON_BOB_AMPLITUDE + FAR_ICON_BADGE_SIZE / 2 + FAR_ICON_GAP_ABOVE_ART;
/**
 * The badge fades in over this band as the crawler approaches, fully gone by
 * the time the SPACE prompt takes over — so the two affordances never double up.
 */
const FAR_ICON_FADE_START_TILES = 5;
const FAR_ICON_FADE_END_TILES = PROCESSING_REACH_TILES + 1;
/** Opacity floor for the badge when the party is out of wood to feed the machine. */
const FAR_ICON_NO_WOOD_ALPHA = 0.4;
const FAR_ICON_BADGE_FILL = 'rgba(30, 30, 30, 0.78)';
const FAR_ICON_BADGE_BORDER = 'rgba(200, 200, 200, 0.55)';

/**
 * A pulsing glow on the ground under a machine while a crawler is close
 * enough to work it: a soft filled ellipse plus a brighter rim, squashed to
 * read as a mark on the floor rather than a shape floating in the air.
 */
const REACH_GLOW_COLOR = '#f0c85a';
const REACH_GLOW_PULSE_PERIOD_MS = 700;
const REACH_GLOW_PULSE_MIN = 0.35;
const REACH_GLOW_PULSE_RANGE = 0.4;
const REACH_GLOW_LINE_WIDTH = 2;
/** How far the glow's ring extends past the footprint's own edge, in tiles. */
const REACH_GLOW_PADDING_TILES = 0.6;
/** Ground-plane perspective: the ellipse's vertical radius as a fraction of its horizontal one. */
const REACH_GLOW_GROUND_SQUASH = 0.55;
const REACH_GLOW_FILL_ALPHA = 0.22;
const REACH_GLOW_EDGE_ALPHA = 0.55;
/** Recentres the glow's sine term (range -1..1) to a 0..1 fraction. */
const SINE_TO_UNIT_SCALE = 0.5;
const SINE_TO_UNIT_OFFSET = 0.5;

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

  /** Every machine's tile position and output, for the minimap. */
  minimapStations(): Array<{ x: number; y: number; kind: ProcessingStationKind }> {
    return this.stations.map((station) => {
      const tile = footprintCentreTile(station.footprint);
      return { x: tile.x, y: tile.y, kind: station.kind };
    });
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

  /**
   * A pulsing ground glow around the footprint, so being close enough to work
   * the machine is visible before the SPACE prompt appears. Drawn in the
   * ground pass — under the station's own sprite, the player and every mob —
   * so it reads as a mark on the floor rather than an outline stroked over
   * whoever is standing on it.
   */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Crawler): void {
    if (this.job !== null) return;
    const station = this.stationFor(active);
    if (station === null) return;
    const { x, y, w, h } = station.footprint;
    const pulse =
      REACH_GLOW_PULSE_MIN +
      REACH_GLOW_PULSE_RANGE *
        (SINE_TO_UNIT_OFFSET +
          SINE_TO_UNIT_SCALE * Math.sin(performance.now() / REACH_GLOW_PULSE_PERIOD_MS));
    const groundCx = (x + w / 2) * TILE_SIZE - camX;
    const groundCy = (y + h) * TILE_SIZE - camY;
    const radiusX = (Math.max(w, h) / 2 + REACH_GLOW_PADDING_TILES) * TILE_SIZE;
    const radiusY = radiusX * REACH_GLOW_GROUND_SQUASH;

    ctx.save();
    ctx.globalAlpha = pulse * REACH_GLOW_FILL_ALPHA;
    ctx.fillStyle = REACH_GLOW_COLOR;
    ctx.beginPath();
    ctx.ellipse(groundCx, groundCy, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.fill();

    ctx.globalAlpha = pulse * REACH_GLOW_EDGE_ALPHA;
    ctx.strokeStyle = REACH_GLOW_COLOR;
    ctx.lineWidth = REACH_GLOW_LINE_WIDTH;
    ctx.beginPath();
    ctx.ellipse(groundCx, groundCy, radiusX, radiusY, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /**
   * A bobbing badge of the machine's output above every station in view, so a
   * player who has never stood on this tile still knows it does something —
   * fading out as the crawler nears, handing off to the SPACE prompt.
   */
  renderFarIndicators(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: Crawler,
  ): void {
    if (interactionPromptsSuppressed()) return;
    const activeCentre = bodyCentre(active);
    for (const station of this.stations) {
      if (this.job?.station === station) continue;
      this.renderFarIndicator(ctx, camX, camY, activeCentre, station);
    }
  }

  private renderFarIndicator(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    activeCentre: { x: number; y: number },
    station: ProcessingStation,
  ): void {
    const centre = footprintCentre(station);
    const distanceTiles =
      Math.hypot(centre.x - activeCentre.x, centre.y - activeCentre.y) / TILE_SIZE;
    const fade = Math.min(
      1,
      Math.max(
        0,
        (distanceTiles - FAR_ICON_FADE_END_TILES) /
          (FAR_ICON_FADE_START_TILES - FAR_ICON_FADE_END_TILES),
      ),
    );
    if (fade <= 0) return;
    const hasWood = partyWood(this.deps.party) >= 1;
    const alpha = fade * (hasWood ? 1 : FAR_ICON_NO_WOOD_ALPHA);
    const bob = Math.sin(performance.now() / FAR_ICON_BOB_PERIOD_MS) * FAR_ICON_BOB_AMPLITUDE;
    const sx = centre.x - camX;
    const sy = stationArtTopTileY(station) * TILE_SIZE - camY - FAR_ICON_LIFT + bob;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.beginPath();
    const bx = sx - FAR_ICON_BADGE_SIZE / 2;
    const by = sy - FAR_ICON_BADGE_SIZE / 2;
    const r = FAR_ICON_BADGE_RADIUS;
    ctx.moveTo(bx + r, by);
    ctx.arcTo(bx + FAR_ICON_BADGE_SIZE, by, bx + FAR_ICON_BADGE_SIZE, by + FAR_ICON_BADGE_SIZE, r);
    ctx.arcTo(bx + FAR_ICON_BADGE_SIZE, by + FAR_ICON_BADGE_SIZE, bx, by + FAR_ICON_BADGE_SIZE, r);
    ctx.arcTo(bx, by + FAR_ICON_BADGE_SIZE, bx, by, r);
    ctx.arcTo(bx, by, bx + FAR_ICON_BADGE_SIZE, by, r);
    ctx.closePath();
    ctx.fillStyle = FAR_ICON_BADGE_FILL;
    ctx.fill();
    ctx.strokeStyle = FAR_ICON_BADGE_BORDER;
    ctx.lineWidth = 1;
    ctx.stroke();
    STATION_GLYPH[station.kind](ctx, sx, sy, FAR_ICON_GLYPH_RADIUS);
    ctx.restore();
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
