/**
 * The payoff: upgrading Fenna's saw and rope walk from Tikka's blueprints
 * during `build_stations`, with X (desktop) or a double tap (mobile) on a
 * station in reach.
 *
 * Owned by `BlueprintsQuestSystem`, which asks it for the nearest station
 * still to upgrade (for guidance and the tracker) and routes X, double taps
 * and the render passes to it. Which stations stand upgraded is durable
 * (`ctx.state.blueprints.stationsUpgraded`); a channel in progress lives here
 * and a rewind drops it. When the second station is done this part calls
 * `onBothUpgraded`, which the quest system answers by completing the quest.
 *
 * The upgraded look is a flag on the machine's anchor tile
 * (`TileContent.stationUpgraded`), reapplied from state every frame, so a
 * save loaded with upgraded stations, a rebuilt map and a finished channel
 * all end in the same art. The prop id stamped on the map never changes.
 */

import type { SoundId } from '../../../audio/sounds';
import { TILE_SIZE } from '../../../core/constants';
import { keybindings } from '../../../core/Keybindings';
import { platform } from '../../../core/Platform';
import {
  canAfford,
  costRequirements,
  spend,
  type ResourceCost,
} from '../../../core/partyResources';
import { viewportHeight, viewportWidth } from '../../../core/Viewport';
import { isVillageUnderSiege } from '../../../core/villageQuestPhase';
import {
  BLUEPRINTS_STATION_IDS,
  type BlueprintsStationId,
} from '../../../core/blueprintsQuestPhase';
import type { TilePoint } from '../../../map/town/townPlan';
import { BUILD_ROWS } from '../../../sprites/art/humanFigure';
import { viewForFacing } from '../../../sprites/humanSprite';
import {
  drawAreaHighlightFrame,
  drawAreaHighlightGround,
  type AreaHighlightMood,
  type AreaHighlightRect,
} from '../../../ui/AreaHighlight';
import { BOX_PRESETS, drawBox, drawProgressBar, PROGRESS_PRESETS } from '../../../ui/Box';
import { interactionPromptsSuppressed } from '../../../ui/InteractionPrompt';
import {
  drawRequirementColumn,
  measureRequirementColumn,
  requirementsMet,
  type Requirement,
} from '../../../ui/RequirementRow';
import { drawText, measureTextWidth, TEXT_PRESETS } from '../../../ui/TextBox';
import {
  processingStationInReach,
  processingStationsOf,
  stationArtTopTileY,
  type ProcessingStation,
  type ProcessingStationKind,
} from '../processingStations';
import type { ProcessingStationId, TileRect } from '../questGuidance';
import { CALLOUT_FRAMES } from '../structureCallouts';
import { CONSTRUCTION_XP } from '../structureRules';
import type { BlueprintsCrawler, BlueprintsQuestContext } from './blueprintsContext';
import { isHeld } from './blueprintsProgress';
import { BLUEPRINTS_CUES } from './blueprintsSoundCues';

/**
 * What upgrading the saw costs. Fixed: the Construction level discount does
 * not apply, so the figure the player was told stays true.
 */
export const SAW_UPGRADE_COST: ResourceCost = { wood_board: 30, rope: 15, stone: 20 };
/** What upgrading the rope walk costs; fixed, like the saw's. */
export const ROPE_WALK_UPGRADE_COST: ResourceCost = { wood_board: 12, rope: 20, stone: 10 };
/** How long the upgrade channel on one station takes. */
export const STATION_UPGRADE_SECONDS = 4;
/** Wood an upgraded station works per press, against one for a plain station. */
export const UPGRADED_WOOD_PER_PRESS = 4;
/** The notice for starting an upgrade the party cannot pay for. */
export const STATION_UPGRADE_SHORT_LINE = 'Not enough materials.';
/**
 * Construction XP for rebuilding a station. A whole machine rebuilt from
 * plans is a job on the scale of raising a trebuchet, so it pays the same.
 */
export const STATION_UPGRADE_CONSTRUCTION_XP = CONSTRUCTION_XP.trebuchet;

/** The fixed cost of upgrading `station`. */
export function stationUpgradeCost(station: BlueprintsStationId): ResourceCost {
  return station === 'saw' ? SAW_UPGRADE_COST : ROPE_WALK_UPGRADE_COST;
}

/** Which blueprint station a processing machine is, by what it makes. */
const STATION_FOR_KIND: Readonly<Record<ProcessingStationKind, BlueprintsStationId>> = {
  boards: 'saw',
  rope: 'ropeWalk',
};

/** Which blueprint station the machine making `kind` is. */
export function blueprintsStationFor(kind: ProcessingStationKind): BlueprintsStationId {
  return STATION_FOR_KIND[kind];
}

/** The guidance's name for a blueprint station. */
const GUIDANCE_ID_FOR_STATION: Readonly<Record<BlueprintsStationId, ProcessingStationId>> = {
  saw: 'saw',
  ropeWalk: 'rope_walk',
};

/** The caption's title: short, because the two machines stand close enough for their captions to meet. */
const STATION_CAPTION_TITLE: Readonly<Record<BlueprintsStationId, string>> = {
  saw: 'Upgrade saw',
  ropeWalk: 'Upgrade rope walk',
};
const STATION_UPGRADED_CALLOUT: Readonly<Record<BlueprintsStationId, string>> = {
  saw: 'Saw upgraded!',
  ropeWalk: 'Rope walk upgraded!',
};

const UPDATES_PER_SECOND = 60;
const STATION_UPGRADE_FRAMES = Math.round(STATION_UPGRADE_SECONDS * UPDATES_PER_SECOND);
/** The resource strip stays up for the whole channel, renewed this often. */
const RESOURCE_NOTE_INTERVAL_FRAMES = UPDATES_PER_SECOND;
/**
 * How far the worker may drift before the channel counts as abandoned.
 * Measured from position rather than read off `isMoving`, which means "tried
 * to walk": a shove that moves the body without a key has to end it too.
 */
const WORK_MOTION_TOLERANCE_PX = 0.5;
const TILE_CENTRE = 0.5;
/** A tall machine's art stands above its footprint; a tap this far above it is still a tap on it. */
const TAP_ART_ALLOWANCE_TILES = 1;
const UPGRADE_LOOP_VOLUME = 0.7;

const PROGRESS_BAR_WIDTH = 40;
const PROGRESS_BAR_HEIGHT = 5;
const PROGRESS_BAR_LIFT = 10;

/** Matches the quest guide's gold, so a station ready to upgrade is marked like every other objective. */
const READY_HIGHLIGHT_COLOR = '#facc15';
/** Orange rather than gold, so a station still short of materials never reads as ready. */
const PENDING_HIGHLIGHT_COLOR = '#fb923c';
/**
 * Clear air between the machine's art and the caption: room for the
 * sawmill's own bobbing output badge, which stands just above the art.
 */
const CAPTION_GAP_ABOVE_ART_PX = 34;
const CAPTION_PADDING_X_PX = 7;
const CAPTION_PADDING_Y_PX = 5;
const CAPTION_LINE_HEIGHT_PX = 13;
/** How far a caption may sit past the viewport and still be drawn, since it is centred on a machine that may be just off screen. */
const CAPTION_CULL_MARGIN_PX = 120;

/** A station still waiting for its upgrade, where it stands. */
export interface StationToUpgrade {
  readonly station: BlueprintsStationId;
  readonly guidanceId: ProcessingStationId;
  readonly footprint: TileRect;
}

/** What this part is built with: the slice of the quest's context it reads. */
export type StationUpgradesContext = Pick<
  BlueprintsQuestContext,
  | 'state'
  | 'gameMap'
  | 'site'
  | 'audio'
  | 'human'
  | 'cat'
  | 'announce'
  | 'callout'
  | 'onTileChanged'
  | 'noteResourceActivity'
  | 'worldHalted'
  | 'cue'
  | 'active'
  | 'pleaPhase'
>;

/** One station caption, laid out: see `StationUpgrades.captionPlan`. */
interface CaptionPlan {
  readonly requirements: readonly Requirement[];
  readonly ready: boolean;
  readonly title: string;
  readonly actionLine: string | null;
  readonly panelHeight: number;
  readonly panelTopWorldY: number;
}

interface UpgradeChannel {
  readonly machine: ProcessingStation;
  readonly station: BlueprintsStationId;
  readonly worker: BlueprintsCrawler;
  readonly startX: number;
  readonly startY: number;
  framesLeft: number;
  framesWorked: number;
  /** Whether Carl's hammering pose is this channel's, so ending it only ever stops its own. */
  posing: boolean;
}

function bodyCentre(crawler: BlueprintsCrawler): { x: number; y: number } {
  return { x: crawler.x + TILE_SIZE * TILE_CENTRE, y: crawler.y + TILE_SIZE * TILE_CENTRE };
}

/** The hammering bed's recording: the first take of its cue, or null while the cue is silent. */
function upgradeLoopSound(): SoundId | null {
  const takes: readonly SoundId[] = BLUEPRINTS_CUES.stationUpgradeLoop;
  return takes.length > 0 ? takes[0] : null;
}

export class StationUpgrades {
  /** The village's two machines, read once: the site's layout never moves them. */
  private readonly machines: readonly ProcessingStation[];
  private channel: UpgradeChannel | null = null;
  /**
   * Updates left while the "Saw upgraded!" callout floats over the finished
   * machine. The machine's own Space prompt and the guide's next caption
   * would otherwise stack on top of it the frame the channel ends.
   */
  private celebrationFramesLeft = 0;
  /** The machine the callout floats over, whose own prompt it keeps off. */
  private celebratedMachine: ProcessingStation | null = null;
  /** Whether the hammering bed playing is this part's, so only this part ever stops it. */
  private ownsLoop = false;

  constructor(
    protected readonly ctx: StationUpgradesContext,
    /** Runs once the second station stands upgraded. */
    protected readonly onBothUpgraded: () => void,
  ) {
    this.machines = processingStationsOf(ctx.site);
    this.syncStationArt();
  }

  /** How many of the two stations stand upgraded. */
  get upgradedCount(): number {
    const upgraded = this.ctx.state.blueprints.stationsUpgraded;
    return BLUEPRINTS_STATION_IDS.filter((station) => upgraded[station]).length;
  }

  /** Whether both stations stand upgraded. */
  get allUpgraded(): boolean {
    return this.upgradedCount >= BLUEPRINTS_STATION_IDS.length;
  }

  /** Whether an upgrade channel is under way. */
  get isUpgrading(): boolean {
    return this.channel !== null;
  }

  /** Whether a finished upgrade's callout is still up over its machine. */
  get isCelebrating(): boolean {
    return this.celebrationFramesLeft > 0;
  }

  /** The upgrade channel's progress, 0 to 1; null with none under way. */
  get progress(): number | null {
    const channel = this.channel;
    return channel === null ? null : 1 - channel.framesLeft / STATION_UPGRADE_FRAMES;
  }

  private isUpgraded(machine: ProcessingStation): boolean {
    return this.ctx.state.blueprints.stationsUpgraded[blueprintsStationFor(machine.kind)];
  }

  /** The station still to upgrade nearest `from`, or null when both are done or the map has none. */
  nearestToUpgrade(from: TilePoint): StationToUpgrade | null {
    let best: ProcessingStation | null = null;
    let bestDistSq = Infinity;
    for (const machine of this.machines) {
      if (this.isUpgraded(machine)) continue;
      const { x, y, w, h } = machine.footprint;
      const dx = x + w / 2 - from.x;
      const dy = y + h / 2 - from.y;
      const distSq = dx * dx + dy * dy;
      if (distSq >= bestDistSq) continue;
      bestDistSq = distSq;
      best = machine;
    }
    return best === null ? null : stationToUpgrade(best);
  }

  /**
   * The station guidance should point `active` at: the one whose upgrade
   * prompt is showing, when one is in reach, so the guide's caption and the
   * prompt always name the same machine; otherwise the nearest still to
   * upgrade. Footprint centres and the prompt's reach rule disagree about
   * "nearest" when the crawler stands between the two machines.
   */
  stationToGuide(active: BlueprintsCrawler): StationToUpgrade | null {
    const inReach = this.upgradableInReach(active);
    if (inReach !== null) return stationToUpgrade(inReach);
    const centre = bodyCentre(active);
    return this.nearestToUpgrade({
      x: Math.floor(centre.x / TILE_SIZE),
      y: Math.floor(centre.y / TILE_SIZE),
    });
  }

  /**
   * The machine `active` could start upgrading right now: only during
   * `build_stations`, only while a crawler holds the blueprints, and only a
   * machine not yet upgraded that `active` stands within reach of.
   */
  upgradableInReach(active: BlueprintsCrawler): ProcessingStation | null {
    if (this.ctx.state.blueprints.phase !== 'build_stations') return null;
    if (!isHeld([this.ctx.human, this.ctx.cat], 'quest_blueprints')) return null;
    const waiting = this.machines.filter((machine) => !this.isUpgraded(machine));
    const centre = bodyCentre(active);
    return processingStationInReach(waiting, centre.x, centre.y);
  }

  // ── Input ────────────────────────────────────────────────────────────────

  /**
   * X (`quickLoad`), from `BriarHollowKit.repairOrLoad` before anything else:
   * starts upgrading a station in reach during `build_stations` while a
   * crawler holds the blueprints (or says "Not enough materials."). Returns
   * whether the press was taken; false sends it on to repair or load.
   *
   * Desktop only, like `ConstructionKit.tryBuildWall`: on a touch screen the
   * double tap is the one way in, so no single gesture can start an upgrade
   * the prompt never offered.
   */
  tryUpgrade(active: BlueprintsCrawler): boolean {
    if (platform.isMobile) return false;
    return this.begin(active, this.upgradableInReach(active));
  }

  /**
   * A double tap at world pixel (`worldX`, `worldY`): the mobile equivalent
   * of {@link tryUpgrade}, asked before `ConstructionKit.handleDoubleTap`.
   * Only a tap on the machine that could be upgraded is taken.
   */
  handleDoubleTap(worldX: number, worldY: number, active: BlueprintsCrawler): boolean {
    const machine = this.upgradableInReach(active);
    if (machine === null) return false;
    const { x, y, w, h } = machine.footprint;
    const tileX = worldX / TILE_SIZE;
    const tileY = worldY / TILE_SIZE;
    const onMachine =
      tileX >= x && tileX <= x + w && tileY >= y - TAP_ART_ALLOWANCE_TILES && tileY <= y + h;
    if (!onMachine) return false;
    return this.begin(active, machine);
  }

  private begin(active: BlueprintsCrawler, machine: ProcessingStation | null): boolean {
    if (machine === null) return false;
    if (this.channel !== null) return true;
    const station = blueprintsStationFor(machine.kind);
    if (!canAfford(this.ctx.human, this.ctx.cat, stationUpgradeCost(station))) {
      this.ctx.announce(STATION_UPGRADE_SHORT_LINE);
      this.ctx.audio?.play('error');
      return true;
    }
    const channel: UpgradeChannel = {
      machine,
      station,
      worker: active,
      startX: active.x,
      startY: active.y,
      framesLeft: STATION_UPGRADE_FRAMES,
      framesWorked: 0,
      posing: false,
    };
    this.channel = channel;
    this.startWorkingPose(channel);
    this.ctx.noteResourceActivity();
    return true;
  }

  private startWorkingPose(channel: UpgradeChannel): void {
    const { worker, machine } = channel;
    const human = this.ctx.human;
    if (worker !== human) return;
    const from = bodyCentre(worker);
    const { x, y, w, h } = machine.footprint;
    const dx = (x + w / 2) * TILE_SIZE - from.x;
    const dy = (y + h / 2) * TILE_SIZE - from.y;
    const distance = Math.hypot(dx, dy);
    const faceX = distance > 0 ? dx / distance : human.facingX;
    const faceY = distance > 0 ? dy / distance : human.facingY;
    channel.posing = human.playAction(BUILD_ROWS[viewForFacing(faceX, faceY)], {
      faceX,
      faceY,
      loop: true,
      onEnd: () => {
        channel.posing = false;
      },
    });
  }

  // ── The channel ──────────────────────────────────────────────────────────

  /** Once per gameplay frame: advances an upgrade channel, cancelling it when the crawler moves. */
  update(): void {
    this.syncStationArt();
    if (this.celebrationFramesLeft > 0 && !this.ctx.worldHalted()) this.celebrationFramesLeft--;
    this.advanceChannel();
    this.syncLoop();
  }

  private advanceChannel(): void {
    const channel = this.channel;
    if (channel === null || this.ctx.worldHalted()) return;
    const worker = channel.worker;
    const moved = Math.hypot(worker.x - channel.startX, worker.y - channel.startY);
    const stillWorking =
      moved <= WORK_MOTION_TOLERANCE_PX &&
      worker.isActive &&
      worker.isAlive &&
      this.upgradableInReach(worker) === channel.machine;
    if (!stillWorking) {
      this.cancel();
      return;
    }
    channel.framesWorked++;
    if (channel.framesWorked % RESOURCE_NOTE_INTERVAL_FRAMES === 0) {
      this.ctx.noteResourceActivity();
    }
    channel.framesLeft--;
    if (channel.framesLeft > 0) return;
    this.finish(channel);
  }

  private finish(channel: UpgradeChannel): void {
    this.endChannel();
    const { human, cat } = this.ctx;
    if (!spend(human, cat, stationUpgradeCost(channel.station), channel.worker)) {
      this.ctx.announce(STATION_UPGRADE_SHORT_LINE);
      this.ctx.audio?.play('error');
      return;
    }
    this.ctx.state.blueprints.stationsUpgraded[channel.station] = true;
    this.celebrationFramesLeft = CALLOUT_FRAMES;
    this.celebratedMachine = channel.machine;
    this.syncStationArt();
    this.ctx.cue('stationUpgraded');
    this.ctx.cue('stationUpgradeFlourish');
    const { x, w } = channel.machine.footprint;
    this.ctx.callout(
      STATION_UPGRADED_CALLOUT[channel.station],
      (x + w / 2) * TILE_SIZE,
      stationArtTopTileY(channel.machine, true) * TILE_SIZE,
    );
    channel.worker.craftSkills.addXp('construction', STATION_UPGRADE_CONSTRUCTION_XP);
    this.ctx.noteResourceActivity();
    if (this.allUpgraded) this.onBothUpgraded();
  }

  /** Drops the channel in progress, if any; nothing is spent until it finishes. */
  cancel(): void {
    if (this.channel === null) return;
    this.endChannel();
    this.syncLoop();
  }

  private endChannel(): void {
    const channel = this.channel;
    if (channel === null) return;
    this.channel = null;
    if (channel.posing) this.ctx.human.stopAction();
  }

  /**
   * Keyed off the live channel rather than started and stopped at each call
   * site, because a channel ends in several ways (finished, walked off, the
   * blueprints lost, a rewind, dispose) and every one must silence the loop.
   */
  private syncLoop(): void {
    const audio = this.ctx.audio;
    const loop = upgradeLoopSound();
    if (audio === null || loop === null) return;
    if (this.channel !== null) {
      audio.startAmbientLoop(loop, UPGRADE_LOOP_VOLUME);
      this.ownsLoop = true;
    } else if (this.ownsLoop) {
      audio.stopAmbientLoop(loop);
      this.ownsLoop = false;
    }
  }

  /**
   * Carries `stationsUpgraded` onto each machine's anchor tile for the prop
   * renderer. The anchor tile is a fresh object whenever the map is rebuilt,
   * so this runs every frame and only touches a tile whose flag disagrees.
   * Every tile of the footprint and the ring round it is re-baked, since the
   * upgraded art's envelope and its neighbours' seams differ from the plain one's.
   */
  private syncStationArt(): void {
    const { gameMap } = this.ctx;
    const structure = gameMap.structure;
    for (const machine of this.machines) {
      const { x, y, w, h } = machine.footprint;
      const anchor = y >= 0 && y < structure.length ? structure[y][x] : undefined;
      if (anchor === undefined) continue;
      const upgraded = this.isUpgraded(machine);
      if ((anchor.stationUpgraded === true) === upgraded) continue;
      anchor.stationUpgraded = upgraded ? true : undefined;
      for (let tileY = y - 1; tileY <= y + h; tileY++) {
        for (let tileX = x - 1; tileX <= x + w; tileX++) gameMap.markTileDirty(tileX, tileY);
      }
      this.ctx.onTileChanged(x, y);
    }
  }

  // ── Drawing ──────────────────────────────────────────────────────────────

  /**
   * Every station still to upgrade, while the upgrade is the step: from
   * `build_stations` on, with the blueprints in a crawler's pack. Marked the
   * whole time — even while guidance has sent the party off to chop, mine or
   * process for a shortfall — so the goal never drops off the screen. The
   * siege is the exception: the quest stands down while the village is
   * fighting, and the machines' marks with it.
   */
  private machinesToMark(): readonly ProcessingStation[] {
    if (this.ctx.state.blueprints.phase !== 'build_stations') return [];
    if (isVillageUnderSiege(this.ctx.pleaPhase())) return [];
    if (!isHeld([this.ctx.human, this.ctx.cat], 'quest_blueprints')) return [];
    return this.machines.filter((machine) => !this.isUpgraded(machine));
  }

  /**
   * Whether either crawler is down. A downed crawler's arrow is the only
   * marker the game allows over the world then, so the frames and captions
   * stand down with the village guide's until they are revived.
   */
  private crawlerDown(): boolean {
    return this.ctx.human.isKnockedOut || this.ctx.cat.isKnockedOut;
  }

  /**
   * The top edge of the upgrade caption's panel over the machine making
   * `kind`, in world pixels, so another caption can stack clear above it;
   * null while no caption stands over that machine.
   */
  captionTopWorldY(kind: ProcessingStationKind): number | null {
    if (this.crawlerDown()) return null;
    const machine = this.machinesToMark().find((candidate) => candidate.kind === kind);
    if (machine === undefined || this.channel?.machine === machine) return null;
    return this.captionPlan(machine).panelTopWorldY;
  }

  /**
   * Whether this part is marking the machine that makes `kind` with its own
   * highlight, so the quest guide draws no second one over it.
   */
  marksStation(kind: ProcessingStationKind): boolean {
    return this.machinesToMark().some((machine) => machine.kind === kind);
  }

  private canAffordUpgrade(machine: ProcessingStation): boolean {
    const cost = stationUpgradeCost(blueprintsStationFor(machine.kind));
    return canAfford(this.ctx.human, this.ctx.cat, cost);
  }

  private highlightMood(machine: ProcessingStation): AreaHighlightMood {
    return this.canAffordUpgrade(machine) ? 'ready' : 'pending';
  }

  /** Under every body: each station still to upgrade, gold when the party can pay for it, orange while short. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const nowMs = performance.now();
    for (const machine of this.machinesToMark()) {
      const mood = this.highlightMood(machine);
      drawAreaHighlightGround(ctx, footprintRect(machine, camX, camY), {
        color: mood === 'ready' ? READY_HIGHLIGHT_COLOR : PENDING_HIGHLIGHT_COLOR,
        nowMs,
        mood,
      });
    }
  }

  /**
   * Over every body: the frame and caption over each station still to
   * upgrade, and the upgrade channel's progress bar. The caption shows from
   * anywhere on screen, not only in reach, and the frame spans the machine's
   * whole art so a tall saw is marked top to bottom. While a crawler is down
   * only the progress bar stays.
   */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const nowMs = performance.now();
    const channel = this.channel;
    const machinesFramed = this.crawlerDown() ? [] : this.machinesToMark();
    for (const machine of machinesFramed) {
      const mood = this.highlightMood(machine);
      drawAreaHighlightFrame(ctx, artRect(machine, camX, camY), {
        color: mood === 'ready' ? READY_HIGHLIGHT_COLOR : PENDING_HIGHLIGHT_COLOR,
        nowMs,
        mood,
      });
      if (channel?.machine !== machine) this.renderCaption(ctx, camX, camY, machine);
    }
    if (channel === null) return;
    const { x, y, w } = channel.machine.footprint;
    const centreX = (x + w / 2) * TILE_SIZE - camX;
    drawProgressBar(ctx, {
      x: centreX - PROGRESS_BAR_WIDTH / 2,
      y: y * TILE_SIZE - camY - PROGRESS_BAR_LIFT,
      width: PROGRESS_BAR_WIDTH,
      height: PROGRESS_BAR_HEIGHT,
      value: 1 - channel.framesLeft / STATION_UPGRADE_FRAMES,
      ...PROGRESS_PRESETS.build,
    });
  }

  /**
   * "Upgrade saw" over its checklist of materials — each line green with a
   * tick once the party holds enough, red while short — in a panel whose
   * border turns gold when every line is met. In reach of a machine the party
   * can pay for, a last line says which key does it.
   */
  private renderCaption(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    machine: ProcessingStation,
  ): void {
    const { requirements, ready, title, actionLine, panelHeight, panelTopWorldY } =
      this.captionPlan(machine);
    const titleStyle = ready ? TEXT_PRESETS.ready : TEXT_PRESETS.label;
    const contentWidth = Math.max(
      measureTextWidth(ctx, title, titleStyle),
      measureRequirementColumn(ctx, requirements),
      actionLine === null ? 0 : measureTextWidth(ctx, actionLine, TEXT_PRESETS.ready),
    );
    const panelWidth = contentWidth + CAPTION_PADDING_X_PX * 2;
    const { x, w } = machine.footprint;
    const centreX = (x + w / 2) * TILE_SIZE - camX;
    const panelTop = panelTopWorldY - camY;
    const panelBottom = panelTop + panelHeight;
    const offScreen =
      centreX < -CAPTION_CULL_MARGIN_PX ||
      centreX > viewportWidth() + CAPTION_CULL_MARGIN_PX ||
      panelBottom < 0 ||
      panelTop > viewportHeight();
    if (offScreen) return;

    drawBox(ctx, {
      x: centreX,
      y: panelTop,
      width: panelWidth,
      height: panelHeight,
      alignX: 'center',
      ...(ready ? BOX_PRESETS.worldCaptionReady : BOX_PRESETS.worldCaptionPending),
    });
    const textTop = panelTop + CAPTION_PADDING_Y_PX;
    drawText(ctx, title, { x: centreX, y: textTop, align: 'center', ...titleStyle });
    const listTop = textTop + CAPTION_LINE_HEIGHT_PX;
    drawRequirementColumn(ctx, requirements, centreX, listTop, CAPTION_LINE_HEIGHT_PX);
    if (actionLine !== null) {
      drawText(ctx, actionLine, {
        x: centreX,
        y: listTop + requirements.length * CAPTION_LINE_HEIGHT_PX,
        align: 'center',
        ...TEXT_PRESETS.ready,
      });
    }
  }

  /** What the caption over `machine` says and how tall its panel stands, for drawing it and for stacking above it. */
  private captionPlan(machine: ProcessingStation): CaptionPlan {
    const station = blueprintsStationFor(machine.kind);
    const requirements = costRequirements(
      this.ctx.human,
      this.ctx.cat,
      stationUpgradeCost(station),
    );
    const ready = requirementsMet(requirements);
    const actionLine = ready ? this.actionLineFor(machine) : null;
    const lineCount = 1 + requirements.length + (actionLine === null ? 0 : 1);
    const panelHeight = lineCount * CAPTION_LINE_HEIGHT_PX + CAPTION_PADDING_Y_PX * 2;
    const artTopWorldY = stationArtTopTileY(machine) * TILE_SIZE;
    return {
      requirements,
      ready,
      title: STATION_CAPTION_TITLE[station],
      actionLine,
      panelHeight,
      panelTopWorldY: artTopWorldY - CAPTION_GAP_ABOVE_ART_PX - panelHeight,
    };
  }

  /** "Press X to upgrade" while the active crawler stands in reach of `machine`; null anywhere else. */
  private actionLineFor(machine: ProcessingStation): string | null {
    if (interactionPromptsSuppressed()) return null;
    if (this.upgradableInReach(this.ctx.active()) !== machine) return null;
    return platform.isMobile
      ? 'Double tap to upgrade'
      : `Press ${keybindings.labelFor('quickLoad')} to upgrade`;
  }

  /**
   * The prompt slot, in `BriarHollowKit.renderPrompt` order. Returns whether
   * it claimed the slot; it never draws, because the station's own caption
   * already carries "Press X to upgrade". In reach of a machine the party can
   * pay for, it claims the slot so no other prompt stacks on that caption.
   * Short of materials it leaves the slot to the machine's own "process"
   * prompt, which is how the shortfall gets made up. While a finished
   * upgrade's callout is up, and the crawler still stands where that
   * machine's own prompt would show, it claims the slot too, so that prompt
   * does not stack on the callout; anywhere else the slot is left to whoever
   * else has something to say.
   */
  renderPrompt(active: BlueprintsCrawler): boolean {
    if (this.isCelebrating && this.nearCelebratedMachine(active)) return true;
    if (this.channel !== null || interactionPromptsSuppressed()) return false;
    const machine = this.upgradableInReach(active);
    if (machine === null) return false;
    return this.canAffordUpgrade(machine);
  }

  /** Whether `active` stands within the reach the just-upgraded machine's own prompt shows at. */
  private nearCelebratedMachine(active: BlueprintsCrawler): boolean {
    const machine = this.celebratedMachine;
    if (machine === null) return false;
    const centre = bodyCentre(active);
    return processingStationInReach([machine], centre.x, centre.y) !== null;
  }

  /** A death rewind on the same scene: drop any channel in progress. */
  onRewind(): void {
    this.cancel();
    this.celebrationFramesLeft = 0;
  }

  /** The scene is being torn down: stop any loop this part started. */
  dispose(): void {
    this.cancel();
  }
}

/** A machine's footprint, in screen pixels. */
function footprintRect(machine: ProcessingStation, camX: number, camY: number): AreaHighlightRect {
  const { x, y, w, h } = machine.footprint;
  return {
    x: x * TILE_SIZE - camX,
    y: y * TILE_SIZE - camY,
    width: w * TILE_SIZE,
    height: h * TILE_SIZE,
  };
}

/** A machine's whole art, from the top of its ink down to its footprint's south edge, in screen pixels. */
function artRect(machine: ProcessingStation, camX: number, camY: number): AreaHighlightRect {
  const { x, y, w, h } = machine.footprint;
  const top = stationArtTopTileY(machine) * TILE_SIZE - camY;
  const bottom = (y + h) * TILE_SIZE - camY;
  return { x: x * TILE_SIZE - camX, y: top, width: w * TILE_SIZE, height: bottom - top };
}

function stationToUpgrade(machine: ProcessingStation): StationToUpgrade {
  const station = blueprintsStationFor(machine.kind);
  const { x, y, w, h } = machine.footprint;
  return {
    station,
    guidanceId: GUIDANCE_ID_FOR_STATION[station],
    footprint: { x, y, width: w, height: h },
  };
}
