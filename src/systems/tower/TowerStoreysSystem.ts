/**
 * What runs on the tower's storeys while the party is inside: the cistern's
 * ward conduit, the gatehouse watch, each upper storey's works (the
 * kitchen's, the bell storey's, the archive's and the cattery's, one
 * `StoreyWorks` each) and, at the top, the Warden's ritual
 * (`TowerRitualSystem`), with the split's chapters (`TowerChapters`) and the
 * cattery's stray once she is out. One encounter for the whole tower, answering for
 * whichever storey the party stands on, so each storey's part is a field here
 * rather than another encounter the scene has to hold. The storeys are places
 * worked through rather than fights, so the room's own fittings stay.
 *
 * ## The ward conduit
 *
 * The sluice on the cistern's north wall is a valve wheel: a few hauls wind
 * its gate down, the conduit's light gutters out, its channel runs down, and
 * the questline's `conduitShut` is set, which is what makes the archive's
 * wards pulse the next time that storey is built. A sluice found shut is
 * built shut and its wheel is already wound. The wheel and gate are drawn
 * live over the baked sluice, turning and dropping with each haul, and a
 * faint lift in the cistern's dark marks the wheel while it still turns. The
 * conduit stays shut to every body until its water has run off.
 *
 * ## The gatehouse watch
 *
 * The tower guards walk the loops `gatehouseWatch.ts` compiles, on the shared
 * clock, and look along the cones it casts: the shape drawn on the floor is
 * the shape that sees. A guard catches at a glance (`stepSuspicion`'s
 * `on_sight` rule): a crawler in its full view is caught within
 * `CAUGHT_AFTER_SEEN_FRAMES`, one at the edge of its look only puts it on
 * orange alert, and on orange any sight of a crawler is the catch, as is
 * being walked into, or struck while it watches a crawler. A guard struck
 * while it sees only a companion, or nobody, walks over to look
 * (`respondToNoise`) and back onto its loop. Being caught does
 * no harm: the screen goes dark, the party and its companions are set down
 * on the cellar stair's landing, every loop starts again, and the screen
 * comes back.
 *
 * A guard is there to catch the crawlers, never a companion; but a companion
 * it sees puts it on orange alert, which is why every companion walks the
 * leader's own trail while the party hides (`partyHidesTogether`).
 */

import type { AudioManager } from '../../audio/AudioManager';
import { TILE_SIZE } from '../../core/constants';
import type { Difficulty } from '../../core/difficulty/difficultyProfiles';
import type { MissingCatsProgress } from '../../core/quests/missingCatsProgress';
import type { Camera } from '../../core/rendering/camera';
import type { WorldRows } from '../../core/rendering/worldRect';
import type { SpatialGrid } from '../../core/world/SpatialGrid';
import type { Mob } from '../../creatures/Mob';
import { TowerGuard, type TowerGuardActivity } from '../../creatures/TowerGuard';
import type { GameMap } from '../../map/GameMap';
import type { PrisonGrid } from '../../map/goblinPrisonPlan';
import {
  towerStandsDown,
  towerStoreyIndex,
  towerStoreyPlan,
  WARD_CONDUIT_SLUICE_ID,
  WARD_CONDUIT_SLUICE_TILE,
  WARD_CONDUIT_SLUICE_VARIANT,
  type TowerConditions,
  type TowerTile,
} from '../../map/town/interiors/townCenterTower';
import type { Player } from '../../Player';
import { TURN_VALVE_ROWS } from '../../sprites/art/humanFigure';
import {
  TOWN_INTERIOR_PROPS,
  townInteriorPropSortY,
} from '../../sprites/art/townInterior/townInteriorProps';
import {
  paintWardConduitSluiceWorks,
  sluiceWheelCentre,
  type SluiceFrame,
} from '../../sprites/art/townInterior/rooms/towerStoreys';
import { screenFadeSurface } from '../../ui/ScreenFade';
import type { Surface } from '../../ui/core/UiRoot';
import type { TopBandEntry } from '../../ui/hud/topBand';
import { drawSightFan } from '../../ui/world/worldSightFan';
import { drawSuspicionMarker } from '../../ui/world/suspicionMarker';
import type { SystemContext } from '../GameSystem';
import { MashInteraction, type MashInteractionDef, type MashPress } from '../MashInteraction';
import { SewerLighting, type SewerLightSource } from '../sewer/sewerLighting';
import { SEWER_CUES, type SewerCue } from '../../audio/sewerSoundCues';
import { renderQuality } from '../../core/perf/RenderQuality';
import { WaterAnimationSystem } from '../WaterAnimationSystem';
import {
  bodyTouchesGuard,
  lightSeesBody,
  stepSuspicion,
  SUSPICION_CAPTURE,
  type ConeShape,
  type PrisonPoint,
} from '../stealthKeySnatch/detection';
import {
  investigationPoseAt,
  loopShiftAfter,
  respondToNoise,
  type InvestigationPlan,
} from '../stealthKeySnatch/prisonNoise';
import {
  guardCone,
  guardPoseAt,
  type CompiledGuard,
  type CompiledStealth,
  type GuardActivity,
  type GuardPose,
} from '../stealthKeySnatch/prisonPatrols';
import type { WorkChannelBuilder } from '../WorkChannel';
import { compileGatehouseWatch, gatehouseCellarLanding } from './gatehouseWatch';
import { TOWER_GUARD_NOTICES } from '../../dialog/scripts/scenes/missingCats';
import type { TowerRitualSystem } from './TowerRitualSystem';
import type { EventBus } from '../../core/EventBus';
import type { PartySplitState } from '../../core/party/partySplit';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import type { RoomMechanisms } from '../roomMechanisms/RoomMechanisms';
import type { SenseLayer } from '../senses/SenseLayer';
import { ArchiveWorks } from './archiveWorks';
import { BellStoreyWorks, type BellStoreyCellmate } from './bellStoreyWorks';
import { CaptureFade } from './captureFade';
import { CatteryWorks, type CatteryCellmate } from './catteryWorks';
import { KitchenWorks } from './kitchenWorks';
import type { StoreyWorks, StoreyWorksDeps } from './storeyWorks';
import type { TowerChapters } from '../missingCats/towerChapters';
import type { CatAllySystem } from '../CatAllySystem';
import type { CarriedCompanion } from '../companionCarry';
import type { TrailFollowSwitch } from '../partyTrail';
import type { StairDirection, StairRefusal } from '../TowerStairSystem';

const CISTERN_STOREY = towerStoreyIndex('cistern');
const GATEHOUSE_STOREY = towerStoreyIndex('gatehouse');
const CATTERY_STOREY = towerStoreyIndex('cattery');
const KITCHEN_STOREY = towerStoreyIndex('kitchen');
const BELL_STOREY = towerStoreyIndex('bell_storey');
const ARCHIVE_STOREY = towerStoreyIndex('archive');
const NOTHING_HIDDEN: ReadonlySet<string> = new Set();

/** What the tower is handed about the cattery's stray: everything its storeys ask of her. */
export type TowerCellmate = CatteryCellmate & BellStoreyCellmate;

// ── The sluice ───────────────────────────────────────────────────────────────

/** Hauls on the wheel that wind the conduit's gate down. */
export const SLUICE_PRESSES = 6;
/** From the sluice's footprint to the crawler, in tiles: from the walkway either side or below it. */
const SLUICE_REACH_TILES = 1.6;
/** How far the sluice's wheel stands above its footprint, in pixels. */
const SLUICE_ART_RISE_PX = 18;
/** Frames the conduit takes to run down once its gate is shut. */
const CONDUIT_DRAIN_TICKS = 180;
/** The conduit's light is laid in pools along its channel, this many tiles apart. */
const CONDUIT_POOL_SPACING_TILES = 3;
/** Each haul turns the sluice's wheel this far round. */
const SLUICE_TURNS_PER_PRESS = 0.25;
/** How much of one haul the drawn wheel and gate catch up by each tick, so a haul is seen to turn. */
const SLUICE_CATCH_UP_PER_TICK = 0.08;
/** The works sort just after the sluice they belong to, so they draw over it and under anyone in front. */
const SLUICE_WORKS_SORT_NUDGE_PX = 1;

/** Where the sluice's footprint lies, in world pixels less the camera's offset. */
function sluiceFrame(camX: number, camY: number): SluiceFrame {
  const { footprint } = TOWN_INTERIOR_PROPS.ward_conduit_sluice;
  return {
    left: WARD_CONDUIT_SLUICE_TILE.x * TILE_SIZE - camX,
    bottom: (WARD_CONDUIT_SLUICE_TILE.y + footprint.h) * TILE_SIZE - camY,
    width: footprint.w * TILE_SIZE,
    tileSize: TILE_SIZE,
  };
}

/**
 * The sluice's gate and wheel, drawn over the baked sluice as far as
 * `shownPresses` hauls (of {@link SLUICE_PRESSES}) have wound them.
 */
export function sluiceWorksFigure(shownPresses: () => number): InteriorFigure {
  const { footprint } = TOWN_INTERIOR_PROPS.ward_conduit_sluice;
  const sortY = townInteriorPropSortY(WARD_CONDUIT_SLUICE_TILE.y, footprint, TILE_SIZE);
  return {
    y: sortY + SLUICE_WORKS_SORT_NUDGE_PX,
    render: (ctx, camX, camY) => {
      const shown = shownPresses();
      paintWardConduitSluiceWorks(
        ctx,
        sluiceFrame(camX, camY),
        shown / SLUICE_PRESSES,
        shown * SLUICE_TURNS_PER_PRESS,
      );
    },
  };
}

const SLUICE_DEF: MashInteractionDef = {
  pressesRequired: SLUICE_PRESSES,
  deed: 'wind the sluice shut',
  humanRows: TURN_VALVE_ROWS,
  barStyle: 'build',
  reachTiles: SLUICE_REACH_TILES,
  artRisePx: SLUICE_ART_RISE_PX,
};

// ── The watch ────────────────────────────────────────────────────────────────

function bodyCentre(body: Player): PrisonPoint {
  return { x: body.x + TILE_SIZE * HALF, y: body.y + TILE_SIZE * HALF };
}

/** The body among `centres` a look takes in most strongly, and how strongly; nobody at weight 0. */
function strongestSighting(
  grid: PrisonGrid,
  cone: ConeShape,
  centres: readonly PrisonPoint[],
  edgeWeight: number,
): { readonly weight: number; readonly at: PrisonPoint | null } {
  let weight = 0;
  let at: PrisonPoint | null = null;
  for (const centre of centres) {
    const seen = lightSeesBody(grid, cone, centre, edgeWeight);
    if (seen <= weight) continue;
    weight = seen;
    at = centre;
  }
  return { weight, at };
}

/** What the toast says as the screen comes back. */
const CAPTURE_TOAST = 'A guard caught you and walked you back to the cellar stairs.';

/** How fast a suspicious guard turns to the crawler it half saw, in radians per frame. */
const SUSPICIOUS_HALF_TURN_FRAMES = 30;
const SUSPICIOUS_TURN_RADIANS_PER_FRAME = Math.PI / SUSPICIOUS_HALF_TURN_FRAMES;
/** The marker floats this far above a guard's tile. */
const MARKER_LIFT_TILES = 1.1;
const MARKER_LIFT_PX = TILE_SIZE * MARKER_LIFT_TILES;
const HALF = 0.5;

/**
 * Who a guard has in its look. Only a crawler is the party caught: a companion
 * seen puts the guard on its guard and turns it, and no more.
 */
interface GuardSighting {
  readonly kind: 'crawler' | 'companion';
  readonly at: PrisonPoint;
}

/** The crawler a guard sees if it sees one, else the companion, else nobody. */
function sightingOf(
  crawler: PrisonPoint | null,
  companion: PrisonPoint | null,
): GuardSighting | null {
  if (crawler !== null) return { kind: 'crawler', at: crawler };
  if (companion !== null) return { kind: 'companion', at: companion };
  return null;
}

interface WatchGuard {
  readonly compiled: CompiledGuard;
  readonly mob: TowerGuard;
  suspicion: number;
  /** Loop frames the guard has been held back by, so its loop picks up where it stopped. */
  shift: number;
  /** The crawler, or failing one the companion, it half sees, and turns to. */
  seen: GuardSighting | null;
  /** Where it was when something turned it: while held, it stands here and only its facing moves. */
  held: GuardPose | null;
  investigation: {
    readonly plan: InvestigationPlan;
    readonly start: GuardPose;
    frames: number;
  } | null;
  pose: GuardPose;
  cone: ConeShape;
}

const POSE_ACTIVITY: Readonly<Record<GuardActivity, TowerGuardActivity>> = {
  move: 'walk',
  turn: 'idle',
  hold: 'idle',
  sweep: 'idle',
};

export interface TowerStoreysDeps {
  /** Every storey's map, by storey index. */
  readonly storeys: ReadonlyArray<GameMap>;
  readonly progress: MissingCatsProgress;
  readonly conditions: TowerConditions;
  readonly difficulty: Difficulty;
  readonly currentStorey: () => number;
  /** Puts a creature into the roster of the storey at `storey`. */
  readonly addMob: (storey: number, mob: Mob) => void;
  /** Takes a creature out of the roster of the storey at `storey` for good. */
  readonly removeMob: (storey: number, mob: Mob) => void;
  readonly bus: EventBus;
  readonly split: PartySplitState;
  /** Each storey's sense layer and room works, by storey index. */
  readonly sensesOf: (storey: number) => SenseLayer;
  readonly mechanismsOf: (storey: number) => RoomMechanisms;
  /** What the storeys ask of the cattery's stray, who is the party's cat ally once she is out. */
  readonly cellmate: TowerCellmate;
  /** The stray herself: ticked, carried between storeys and fought for with the party. */
  readonly cellmateAlly: CatAllySystem;
  /** The split's chapters, which end and hand over inside the tower. */
  readonly chapters: TowerChapters;
  readonly audio: AudioManager | null;
  /** The crawlers standing on the storey on show. */
  readonly presentCrawlers: () => readonly Player[];
  /** The party's own companions standing on the storey on show, whom a watcher is put on its guard by. */
  readonly presentCompanions: () => readonly Player[];
  /** Stands the party's own companions on the storey on show beside the crawler each follows. */
  readonly regroupCompanions: () => void;
  /** Sets both crawlers down together on `tile` of the storey on show, their companions beside them. */
  readonly setPartyDown: (tile: TowerTile) => void;
  readonly toast: (text: string) => void;
  /**
   * Something happened at world pixel `at` that the party should hear about:
   * captioned when it is off the screen, where nothing shows it.
   */
  readonly heardOffScreen: (text: string, at: PrisonPoint) => void;
  /** The Warden's ritual at the top, which answers for the cattery. */
  readonly ritual: TowerRitualSystem;
}

export class TowerStoreysSystem {
  get defeatMessage(): string {
    return this.onCattery ? this.deps.ritual.defeatMessage : 'You fell inside the tower.';
  }

  private get onCattery(): boolean {
    return this.deps.currentStorey() === CATTERY_STOREY;
  }

  private readonly sluice: MashInteraction;
  /** The hauls the drawn wheel and gate show, easing after the hauls made. */
  private sluiceShownPresses: number;
  /** Whether the shut conduit's channel is still running off, and so still shut to every body. */
  private conduitDraining = false;
  private cisternLighting: SewerLighting;
  /** World ticks run on the cistern storey, which its glints breathe on. */
  private cisternTicks = 0;
  private readonly cisternWater: WaterAnimationSystem;
  private readonly watch: CompiledStealth;
  private readonly guards: WatchGuard[];
  /** Whether the storeys standing built have been stood down for the Warden's fall. */
  private stoodDown = false;
  private readonly cellarLanding: TowerTile;
  private clock = 0;
  private readonly capture = new CaptureFade();
  private readonly works = new Map<number, StoreyWorks>();
  private readonly archive: ArchiveWorks;
  private readonly cattery: CatteryWorks;
  /** The storey whose works were last ticked, so arriving on another one is noticed. */
  private worksStorey: number | null = null;

  constructor(private readonly deps: TowerStoreysDeps) {
    const sluiceDef = TOWN_INTERIOR_PROPS.ward_conduit_sluice;
    this.sluice = new MashInteraction({
      def: SLUICE_DEF,
      footprint: {
        x: WARD_CONDUIT_SLUICE_TILE.x,
        y: WARD_CONDUIT_SLUICE_TILE.y,
        w: sluiceDef.footprint.w,
        h: sluiceDef.footprint.h,
      },
      pressesDone: deps.progress.conduitShut ? SLUICE_PRESSES : 0,
      onPress: (press) => this.onSluicePress(press),
    });
    this.sluiceShownPresses = this.sluice.pressesDone;
    this.cisternLighting = this.buildCisternLighting();
    this.cisternWater = new WaterAnimationSystem(
      deps.storeys[CISTERN_STOREY],
      () => renderQuality.fullDetail,
    );
    this.archive = new ArchiveWorks(this.worksDeps(deps, ARCHIVE_STOREY));
    this.cattery = new CatteryWorks({
      ...this.worksDeps(deps, CATTERY_STOREY),
      cellmate: deps.cellmate,
    });
    this.raiseWorks(deps);
    this.watch = compileGatehouseWatch(deps.conditions, deps.difficulty);
    this.cellarLanding = gatehouseCellarLanding(deps.conditions);
    this.guards = towerStandsDown(deps.progress)
      ? []
      : this.watch.guards.map((compiled, index) => this.raiseGuard(compiled, index));
  }

  /** The tower's storeys are places worked through: their furniture can still be read, searched and broken. */
  readonly keepsRoomFittings = true;

  /** Whether a watcher on the storey on show is looking for the party, so every companion keeps to the leader's trail. */
  get partyHidesTogether(): boolean {
    switch (this.deps.currentStorey()) {
      case GATEHOUSE_STOREY:
        return this.guards.length > 0;
      case ARCHIVE_STOREY:
        return this.archive.watched;
      case CATTERY_STOREY:
        return this.cattery.watched;
      default:
        return false;
    }
  }

  /** Whether the party's input is withheld: a capture is under way. */
  get playerLocked(): boolean {
    return (
      this.capture.active ||
      this.archive.playerLocked ||
      this.cattery.playerLocked ||
      this.deps.ritual.playerLocked
    );
  }

  /** The full-screen fades the captures run through; mount once on the scene's `UiRoot`. */
  surfaces(): Surface[] {
    return [
      screenFadeSurface('tower-gatehouse-capture-fade', { alpha: () => this.capture.alpha }),
      screenFadeSurface('tower-archive-capture-fade', { alpha: () => this.archive.fadeAlpha }),
      screenFadeSurface('tower-cattery-capture-fade', { alpha: () => this.cattery.fadeAlpha }),
    ];
  }

  private get worksHere(): StoreyWorks | null {
    return this.works.get(this.deps.currentStorey()) ?? null;
  }

  /** What the storey on show draws in the room's depth-sorted pass. */
  roomFigures(): InteriorFigure[] {
    const works = this.worksHere?.roomFigures?.() ?? [];
    if (this.deps.currentStorey() === CISTERN_STOREY)
      return [...works, sluiceWorksFigure(() => this.sluiceShownPresses)];
    return this.onCattery ? [...works, ...this.deps.ritual.roomFigures()] : works;
  }

  /** Placed props the storey on show draws itself, or that no longer stand where they were placed. */
  hiddenProps(): ReadonlySet<string> {
    return this.worksHere?.hiddenProps?.() ?? NOTHING_HIDDEN;
  }

  /** Runs the storey on show's works, telling them first when the party has just arrived. */
  private tickWorks(ctx: SystemContext): void {
    const storey = this.deps.currentStorey();
    if (this.worksStorey !== storey) {
      if (this.worksStorey !== null) this.works.get(this.worksStorey)?.leave?.();
      this.worksStorey = storey;
      this.works.get(storey)?.enter?.(ctx);
    }
    this.works.get(storey)?.update(ctx);
  }

  private worksDeps(deps: TowerStoreysDeps, storey: number): StoreyWorksDeps {
    return {
      map: deps.storeys[storey],
      progress: deps.progress,
      conditions: deps.conditions,
      bus: deps.bus,
      audio: deps.audio,
      senses: deps.sensesOf(storey),
      mechanisms: deps.mechanismsOf(storey),
      split: deps.split,
      addMob: (mob) => deps.addMob(storey, mob),
      removeMob: (mob) => deps.removeMob(storey, mob),
      presentCrawlers: deps.presentCrawlers,
      presentCompanions: deps.presentCompanions,
      regroupCompanions: deps.regroupCompanions,
      setPartyDown: deps.setPartyDown,
      toast: deps.toast,
    };
  }

  private raiseWorks(deps: TowerStoreysDeps): void {
    this.works.set(KITCHEN_STOREY, new KitchenWorks(this.worksDeps(deps, KITCHEN_STOREY)));
    this.works.set(
      BELL_STOREY,
      new BellStoreyWorks({ ...this.worksDeps(deps, BELL_STOREY), cellmate: deps.cellmate }),
    );
    this.works.set(ARCHIVE_STOREY, this.archive);
    this.works.set(CATTERY_STOREY, this.cattery);
  }

  update(ctx: SystemContext): void {
    this.deps.chapters.update();
    this.updateStoreys(ctx);
    // Caged, she belongs to no group yet, and the ally would put her away as
    // left behind; the cattery holds her in her cage until Belle lets her out.
    if (this.deps.progress.cellmateFreed) this.deps.cellmateAlly.update(ctx);
  }

  /** Why the stair on the storey on show will not take whoever is playing, or null when it will. */
  stairRefusal(going: StairDirection): StairRefusal | null {
    if (going === 'down' && this.onCattery) {
      const fightRefusal = this.deps.ritual.stairDownRefusal;
      if (fightRefusal !== null) return fightRefusal;
    }
    return this.deps.chapters.stairRefusal(going);
  }

  /** The stray, who climbs and descends with the crawler she follows. */
  carriedCompanions(): CarriedCompanion[] {
    return [this.deps.cellmateAlly.asCarriedCompanion()];
  }

  /** The stray, who keeps to the leader's trail with the rest while the party hides. */
  trailFollowers(): TrailFollowSwitch[] {
    return [this.deps.cellmateAlly];
  }

  /** The stray, once she is out: the tower's hostiles may go for her too. */
  allyTargets(): readonly Player[] {
    const body = this.deps.cellmateAlly.body;
    return body === null || !this.deps.progress.cellmateFreed ? [] : [body];
  }

  private updateStoreys(ctx: SystemContext): void {
    this.deps.ritual.update(ctx, this.deps.currentStorey());
    if (!this.stoodDown && towerStandsDown(this.deps.progress)) this.standDown();
    this.tickWorks(ctx);
    if (this.deps.currentStorey() === CISTERN_STOREY) {
      this.tickCisternWater(ctx);
      return;
    }
    if (this.deps.currentStorey() !== GATEHOUSE_STOREY) return;
    if (this.capture.active) {
      this.stepCapture();
      return;
    }
    this.clock++;
    if (this.answerStrikes()) return;
    this.moveGuards(ctx.roster.grid);
    this.watchForCrawlers();
  }

  tryInteract(ctx: SystemContext): boolean {
    if (this.onCattery && this.deps.ritual.tryInteract(ctx)) return true;
    if (this.worksHere?.tryInteract?.(ctx) === true) return true;
    if (this.deps.currentStorey() !== CISTERN_STOREY) return false;
    return this.sluice.tryInteract(ctx.active);
  }

  topBandEntries(): TopBandEntry[] {
    return this.onCattery ? this.deps.ritual.topBandEntries() : [];
  }

  cameraKeepRows(): WorldRows | null {
    return this.onCattery ? this.deps.ritual.cameraKeepRows() : null;
  }

  renderInteractionPrompts(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: WorkChannelBuilder,
  ): void {
    if (this.onCattery) this.deps.ritual.renderInteractionPrompts(ctx, camX, camY, active);
    this.worksHere?.renderInteractionPrompts?.(ctx, camX, camY, active);
    if (this.deps.currentStorey() !== CISTERN_STOREY) return;
    this.sluice.renderProgress(ctx, camX, camY);
    if (active.isActive) this.sluice.renderPrompt(ctx, camX, camY, active);
  }

  /** The guards' looks, washed over the floor under the figures. */
  renderWorld(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const { x: camX, y: camY } = camera;
    if (this.onCattery) this.deps.ritual.renderWorld(ctx, camX, camY);
    this.worksHere?.renderWorld?.(ctx, camX, camY);
    if (this.deps.currentStorey() === CISTERN_STOREY) {
      this.cisternWater.renderGround(ctx, camera);
      return;
    }
    if (this.deps.currentStorey() !== GATEHOUSE_STOREY) return;
    for (const guard of this.guards) {
      const { cone } = guard;
      drawSightFan(ctx, {
        origin: { x: cone.origin.x - camX, y: cone.origin.y - camY },
        rim: { kind: 'rays', ends: cone.ends.map((end) => ({ x: end.x - camX, y: end.y - camY })) },
        suspicion: guard.suspicion,
      });
    }
  }

  /** Each guard's `?` while it half sees someone, and its `!` once it has seen enough. */
  renderEffects(ctx: CanvasRenderingContext2D, camera: Camera): void {
    const { x: camX, y: camY } = camera;
    if (this.onCattery) this.deps.ritual.renderEffects(ctx, camX, camY);
    this.worksHere?.renderEffects?.(ctx, camX, camY);
    if (this.deps.currentStorey() === CISTERN_STOREY) {
      this.cisternWater.renderSplashes(ctx, camX, camY);
      return;
    }
    if (this.deps.currentStorey() !== GATEHOUSE_STOREY) return;
    const nowMs = performance.now();
    const alarmed = this.capture.active;
    for (const guard of this.guards) {
      drawSuspicionMarker(ctx, {
        x: guard.pose.x - camX,
        y: guard.pose.y - camY - MARKER_LIFT_PX,
        suspicion: guard.suspicion,
        alarmed: alarmed && guard.suspicion >= SUSPICION_CAPTURE,
        nowMs,
      });
    }
  }

  renderDarkness(ctx: CanvasRenderingContext2D, camera: Camera): void {
    if (this.deps.currentStorey() !== CISTERN_STOREY) return;
    const lit: readonly SewerLightSource[] = this.deps.presentCrawlers();
    const glints = this.sluice.isFinished ? [] : [sluiceWheelCentre(sluiceFrame(0, 0))];
    this.cisternLighting.renderDarkness(ctx, camera, lit, glints, this.cisternTicks);
  }

  leaveFloor(ctx: SystemContext): void {
    if (this.onCattery) this.deps.ritual.leaveFloor(ctx);
    if (this.worksStorey !== null) this.works.get(this.worksStorey)?.leave?.();
    this.worksStorey = null;
    this.cisternLighting.release();
    if (!this.capture.active) return;
    this.resetWatch();
    this.capture.cancel();
  }

  dispose(): void {
    this.deps.chapters.dispose();
    this.deps.cellmateAlly.dispose();
    for (const works of this.works.values()) works.dispose?.();
    this.cisternLighting.release();
    this.cisternWater.dispose();
    this.deps.ritual.dispose();
  }

  // ── The sluice ─────────────────────────────────────────────────────────────

  /** Runs the conduit down after its gate is shut, and lets the water answer whoever wades it. */
  private tickCisternWater(ctx: SystemContext): void {
    this.cisternTicks++;
    const cistern = this.deps.storeys[CISTERN_STOREY];
    cistern.advanceWaterDrains();
    this.easeSluiceWorks();
    this.openDrainedConduit(cistern);
    this.cisternWater.beginFrame();
    const centre = TILE_SIZE * HALF;
    for (const crawler of this.deps.presentCrawlers()) {
      const tileX = Math.floor((crawler.x + centre) / TILE_SIZE);
      const tileY = Math.floor((crawler.y + centre) / TILE_SIZE);
      const wet = cistern.isWadeable(tileX, tileY);
      if (this.cisternWater.updateWader(crawler, crawler.x + centre, crawler.y + centre, wet)) {
        this.deps.audio?.play(crawler === ctx.human ? 'human_splash' : 'cat_splash');
      }
    }
  }

  private easeSluiceWorks(): void {
    const target = this.sluice.pressesDone;
    const gap = target - this.sluiceShownPresses;
    this.sluiceShownPresses =
      Math.abs(gap) <= SLUICE_CATCH_UP_PER_TICK
        ? target
        : this.sluiceShownPresses + Math.sign(gap) * SLUICE_CATCH_UP_PER_TICK;
  }

  /** Opens the conduit's channel once its last water has run off, and not before. */
  private openDrainedConduit(cistern: GameMap): void {
    if (!this.conduitDraining) return;
    const { conduit } = towerStoreyPlan('cistern');
    if (conduit.some((tile) => cistern.dungeonWaterDepthAt(tile.x, tile.y) > 0)) return;
    this.conduitDraining = false;
    for (const tile of conduit) cistern.unblockTilePermanently(tile.x, tile.y);
  }

  private buildCisternLighting(): SewerLighting {
    const plan = towerStoreyPlan('cistern');
    const pools = this.deps.progress.conduitShut
      ? []
      : plan.conduit.filter((_tile, index) => index % CONDUIT_POOL_SPACING_TILES === 0);
    return new SewerLighting(plan.width, plan.height, pools);
  }

  private onSluicePress(press: MashPress): void {
    const at = {
      x: (WARD_CONDUIT_SLUICE_TILE.x + 1) * TILE_SIZE,
      y: (WARD_CONDUIT_SLUICE_TILE.y + HALF) * TILE_SIZE,
    };
    switch (press.kind) {
      case 'advanced':
        this.play('valveTurn', at);
        return;
      case 'finished':
        this.play('sluiceShut', at);
        this.shutConduit();
        return;
      default: {
        const unhandled: never = press;
        throw new Error(`unhandled press ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /** The gate is down: the conduit goes dark and runs down, and the archive's wards will pulse. */
  private shutConduit(): void {
    this.deps.progress.conduitShut = true;
    const cistern = this.deps.storeys[CISTERN_STOREY];
    cistern.setPlacedInteriorPropVariant(WARD_CONDUIT_SLUICE_ID, WARD_CONDUIT_SLUICE_VARIANT.shut);
    const { conduit } = towerStoreyPlan('cistern');
    cistern.drainWater(conduit, CONDUIT_DRAIN_TICKS);
    this.conduitDraining = true;
    this.cisternLighting.release();
    this.cisternLighting = this.buildCisternLighting();
  }

  private play(cue: SewerCue, at: PrisonPoint): void {
    this.deps.audio?.playRandomAt(SEWER_CUES[cue], at.x, at.y);
  }

  /**
   * The Warden has fallen with every storey already built as the fight found
   * it: the gatehouse's guards go off watch and each storey's works let the
   * party by, so the way down to the street door is open.
   */
  private standDown(): void {
    this.stoodDown = true;
    for (const guard of this.guards) this.deps.removeMob(GATEHOUSE_STOREY, guard.mob);
    this.guards.length = 0;
    for (const works of this.works.values()) works.standDown?.();
  }

  // ── The watch ──────────────────────────────────────────────────────────────

  private raiseGuard(compiled: CompiledGuard, index: number): WatchGuard {
    const pose = guardPoseAt(compiled, 0);
    const mob = new TowerGuard(
      Math.floor(pose.x / TILE_SIZE),
      Math.floor(pose.y / TILE_SIZE),
      TILE_SIZE,
      index,
    );
    mob.applyPose({ x: pose.x, y: pose.y, facing: pose.facing, activity: 'idle' });
    this.deps.addMob(GATEHOUSE_STOREY, mob);
    return {
      compiled,
      mob,
      suspicion: 0,
      shift: 0,
      seen: null,
      held: null,
      investigation: null,
      pose,
      cone: guardCone(this.watch, pose, 0),
    };
  }

  private loopPose(guard: WatchGuard): GuardPose {
    return guardPoseAt(guard.compiled, this.clock - guard.shift);
  }

  private moveGuards(grid: SpatialGrid<Mob>): void {
    for (const guard of this.guards) {
      guard.pose = this.nextPose(guard);
      guard.cone = guardCone(this.watch, guard.pose, this.clock, guard.suspicion > 0);
      guard.mob.applyPose(
        {
          x: guard.pose.x,
          y: guard.pose.y,
          facing: guard.pose.facing,
          activity: guard.suspicion > 0 ? 'alert' : POSE_ACTIVITY[guard.pose.activity],
        },
        grid,
      );
      guard.mob.setMarker(guard.suspicion > 0 ? 'question' : 'none');
    }
  }

  private nextPose(guard: WatchGuard): GuardPose {
    if (guard.seen !== null) {
      const from = guard.held ?? guard.pose;
      guard.held = from;
      guard.shift++;
      const toward = Math.atan2(guard.seen.at.y - from.y, guard.seen.at.x - from.x);
      const turn = Math.atan2(Math.sin(toward - from.facing), Math.cos(toward - from.facing));
      const step = Math.max(
        -SUSPICIOUS_TURN_RADIANS_PER_FRAME,
        Math.min(SUSPICIOUS_TURN_RADIANS_PER_FRAME, turn),
      );
      const held = {
        ...from,
        facing: from.facing + step,
        moving: false,
        activity: 'hold' as const,
      };
      guard.held = held;
      return held;
    }
    if (guard.held !== null) {
      guard.held = null;
      if (guard.investigation === null) return this.loopPose(guard);
    }
    const investigation = guard.investigation;
    if (investigation !== null) {
      investigation.frames++;
      const { pose, done } = investigationPoseAt(
        investigation.plan,
        investigation.start,
        investigation.frames,
      );
      if (!done) return pose;
      guard.investigation = null;
      guard.shift = loopShiftAfter(investigation.plan, this.clock - investigation.frames);
    }
    return this.loopPose(guard);
  }

  private crawlerCentres(): PrisonPoint[] {
    return this.deps.presentCrawlers().map(bodyCentre);
  }

  private watchForCrawlers(): void {
    const { grid } = this.watch.parsed;
    const { suspicion } = this.watch.tuning;
    const centres = this.crawlerCentres();
    const companionCentres = this.deps.presentCompanions().map(bodyCentre);
    for (const guard of this.guards) {
      const crawler = strongestSighting(grid, guard.cone, centres, suspicion.coneEdgeWeight);
      const companion = strongestSighting(
        grid,
        guard.cone,
        companionCentres,
        suspicion.coneEdgeWeight,
      );
      guard.seen = sightingOf(crawler.at, companion.at);
      const wasUnaware = guard.suspicion <= 0;
      guard.suspicion = stepSuspicion(
        guard.suspicion,
        'cone',
        { crawler: crawler.weight, companion: companion.weight },
        suspicion,
      );
      if (wasUnaware && guard.suspicion > 0) {
        this.deps.heardOffScreen(TOWER_GUARD_NOTICES, { x: guard.pose.x, y: guard.pose.y });
      }
      if (guard.suspicion >= SUSPICION_CAPTURE) {
        this.beginCapture(guard);
        return;
      }
      const body = { x: guard.pose.x, y: guard.pose.y, facing: guard.pose.facing };
      if (centres.some((centre) => bodyTouchesGuard(grid, body, centre))) {
        this.beginCapture(guard);
        return;
      }
    }
  }

  /**
   * A guard struck while it watches a crawler is a catch; struck unseen, it
   * goes to look. Returns whether a blow got the party caught.
   */
  private answerStrikes(): boolean {
    const centres = this.crawlerCentres();
    const striker = centres.length > 0 ? centres[0] : null;
    for (const guard of this.guards) {
      if (guard.mob.takeStrikes() <= 0 || striker === null) continue;
      if (guard.seen?.kind === 'crawler') {
        this.beginCapture(guard);
        return true;
      }
      const response = respondToNoise(this.watch, guard.compiled, guard.pose, this.clock, {
        kind: 'melee',
        at: striker,
        struckGuardId: guard.compiled.def.id,
      });
      switch (response.kind) {
        case 'alarm':
          this.beginCapture(guard);
          return true;
        case 'investigate':
          guard.investigation = { plan: response.plan, start: guard.pose, frames: 0 };
          continue;
        case 'ignore':
          continue;
        default: {
          const unhandled: never = response;
          throw new Error(`unhandled noise response ${JSON.stringify(unhandled)}`);
        }
      }
    }
    return false;
  }

  private beginCapture(guard: WatchGuard): void {
    guard.suspicion = SUSPICION_CAPTURE;
    guard.mob.setMarker('exclamation');
    this.capture.begin();
  }

  private stepCapture(): void {
    const step = this.capture.step();
    switch (step.kind) {
      case 'none':
        return;
      case 'reset':
        this.deps.setPartyDown(this.cellarLanding);
        this.resetWatch();
        return;
      case 'returning':
        this.deps.toast(CAPTURE_TOAST);
        return;
      default: {
        const unhandled: never = step;
        throw new Error(`unhandled capture step ${JSON.stringify(unhandled)}`);
      }
    }
  }

  private resetWatch(): void {
    this.clock = 0;
    for (const guard of this.guards) {
      guard.suspicion = 0;
      guard.shift = 0;
      guard.seen = null;
      guard.held = null;
      guard.investigation = null;
      guard.pose = guardPoseAt(guard.compiled, 0);
      guard.cone = guardCone(this.watch, guard.pose, 0);
      guard.mob.setMarker('none');
    }
  }
}
