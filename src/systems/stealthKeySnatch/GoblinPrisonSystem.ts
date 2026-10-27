/**
 * The Goblin High Security Prison while the party is inside it: the patrols
 * walking their loops, the lights they cast, being seen, being caught, the
 * holding cells and the noise a fight makes.
 *
 * ## Drawn is caught
 *
 * Every guard stands where `prisonStateAt`'s loop puts it (shifted only by a
 * noise investigation or a suspicious pause), and its cone is `guardCone` of
 * that pose — the polygon the darkness is cut with, the warm wash is filled
 * with and {@link lightSeesBody} tests the crawlers against. A guard's art is
 * pinned to the same `guardAnimation` its lens is read from. There is one
 * shape per light per frame and everything reads it.
 *
 * ## Being seen
 *
 * Each guard and spotlight keeps a suspicion from 0 to 1 that rises while its
 * shape holds a crawler and drains while it does not. A guard whose suspicion
 * is rising stops where it is and turns its light toward the crawler — the
 * warning — and picks its loop up again from the same moment once it drains.
 * At 1 the capture starts. Walking into a guard, or hitting a guard whose
 * light is on you, is a capture outright.
 *
 * ## Captured
 *
 * The patrols, the spotlights and every suspicion stop, the party's input is
 * withheld, the guard shouts, the screen fades to black (through
 * {@link fadeSurface}), and while it is black both crawlers are put in the
 * first holding cell, its door is re-boarded and every patrol, spotlight and
 * suspicion goes back to the start of its loop. Combat keeps ticking under
 * the fade, so a shot or a stick already in the air still lands; whatever
 * noise or blow it makes is ignored until the capture ends, and a door it
 * breaks simply stays open. Nothing is taken: the key, if held, stays held
 * and the quest's phase is untouched.
 *
 * ## Noise, and what cannot bypass the guards
 *
 * Every blow that lands on a guard or a cell door, and every explosion, is a
 * noise at that spot (`respondToNoise`): a guard whose light is on the spot
 * raises the alarm, one that only hears it walks over to look and sweeps.
 * Abilities and items were audited against the guards:
 *
 * - **Magic Missile, Smush, melee, slingshot, dynamite**: `PrisonGoblin` is
 *   damage immune and immovable; every blow only makes noise (and is a catch
 *   if the guard can see the crawler who threw it).
 * - **Protective Shell**: guards refuse every shove (`acceptsShove`), so the
 *   shell cannot push one out of a doorway; it breaks a cell door like any blow.
 * - **Mongo and the hireling**: never inside — the prison admits no
 *   companions — so nothing can fight or block a guard.
 * - **Knockback, fear, stun, slow, root, confusion**: `PrisonGoblin` refuses
 *   every status and displacement, so none of them moves or holds a guard.
 * - **Speed buffs and potions** (the bathroom's `refreshed` included): only
 *   change how fast a crawler walks, which the patrols are timed to survive;
 *   detection is geometric and does not care.
 * - **Darkness changes**: being seen is being inside a shape, never how lit
 *   a crawler is, so they change nothing.
 * - **Recall and travel**: refused, as in every interior
 *   (`refuseAnchorIndoors`); the only way out is the exit by the entrance.
 * - **Dynamite on walls**: nothing in the prison breaks. Its grid has no
 *   destructible props, no structures and no wall fixtures, so a blast is
 *   only noise.
 */

import type { AudioManager } from '../../audio/AudioManager';
import type { AudioScope } from '../../audio/AudioScope';
import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import type { SpatialGrid } from '../../core/world/SpatialGrid';
import { viewportHeight, viewportWidth } from '../../core/rendering/Viewport';
import type { Mob, PlayerDamageType } from '../../creatures/Mob';
import { PrisonCellDoor } from '../../creatures/PrisonCellDoor';
import { PrisonerGoblin } from '../../creatures/PrisonerGoblin';
import { PrisonGoblin } from '../../creatures/PrisonGoblin';
import { bathroomSeedFraction } from '../../creatures/BathroomGoblin';
import type { GameMap } from '../../map/GameMap';
import type { PrisonSectionId } from '../../map/goblinPrisonLayouts';
import {
  PRISON_TILE,
  prisonSectionAt,
  prisonTileAt,
  type PrisonHoldingCell,
  type PrisonPlan,
  type PrisonTile,
} from '../../map/goblinPrisonPlan';
import type { Player } from '../../Player';
import { drawInteractionPromptOver } from '../../ui/InteractionPrompt';
import { screenFadeSurface } from '../../ui/ScreenFade';
import type { Surface } from '../../ui/core/UiRoot';
import { drawSuspicionMarker } from '../../ui/world/suspicionMarker';
import type { TopBandEntry } from '../../ui/hud/topBand';
import { drawEyePair, eyesOpenAt } from '../lighting/eyeShine';
import { LIGHTING_TUNING } from '../lighting/lightingTuning';
import { beginAboveDarkness, flushAboveDarkness } from '../lighting/aboveDarkness';
import type { SystemContext } from '../GameSystem';
import {
  bodyTouchesGuard,
  castDisc,
  lightSeesBody,
  stepSuspicion,
  SUSPICION_CAPTURE,
  wrapAngle,
  DEGREES_TO_RADIANS,
  type LightShape,
  type PrisonPoint,
} from './detection';
import { PrisonGround } from './prisonGround';
import { PrisonLighting, type LitPrisonLight, type PrisonLightSource } from './prisonLighting';
import {
  investigationPoseAt,
  loopShiftAfter,
  respondToNoise,
  type InvestigationPlan,
  type PrisonNoise,
} from './prisonNoise';
import {
  compilePrison,
  guardAnimation,
  guardCone,
  guardFacingX,
  guardPoseAt,
  tileCentrePx,
  type CompiledGuard,
  type CompiledPrison,
  type CompiledSpotlight,
  type GuardActivity,
  type GuardPose,
} from './prisonPatrols';
import { playPrisonCue, PRISON_CUES, type PrisonCue } from './prisonSoundCues';

// ── Capture timing ──────────────────────────────────────────────────────────

/** The frozen beat after a guard sees enough: the shout and the sting, before the fade. */
export const CAPTURE_FREEZE_FRAMES = 40;
/** The fade to black: about half a second. */
export const CAPTURE_FADE_OUT_FRAMES = 30;
/** Held black while the party is moved and the prison reset: about 0.8 s. */
export const CAPTURE_HOLD_FRAMES = 48;
/** The fade back in, the cell door slamming as it starts. */
export const CAPTURE_FADE_IN_FRAMES = 30;

/** What the capture toast says when nothing else rewrites it. */
export const CAPTURE_TOAST = 'Caught! Thrown in a cell.';
/** What the capture toast says when the party is caught holding the key, which the guards never take. */
export const CAPTURE_WITH_KEY_TOAST = "Caught! They didn't notice the key.";

/** The prompt over an intact cell door while a crawler stands inside its cell. */
export const CELL_DOOR_PROMPT = 'Break door';

/**
 * Frames from the press inside a cell to the blow landing on its door: the
 * swing's wind-up, so the door breaks as the fist or claw comes down.
 */
const CELL_DOOR_SWING_FRAMES = 10;

/** How strongly a light must see a crawler to count at all; anything inside counts. */
const SEEN_EDGE_WEIGHT_FLOOR = 0;

/** Wood chips thrown off a breaking door. */
const DOOR_CHIP_COUNT = 9;
const DOOR_CHIP_LIFE_FRAMES = 36;
const DOOR_CHIP_SPEED_PX = 2.2;
const DOOR_CHIP_LIFT_PX = 1.8;
const DOOR_CHIP_GRAVITY_PX = 0.14;
const DOOR_CHIP_SIZE_PX = 3;
const DOOR_CHIP_COLOR = '#8a6c4c';

/** A suspicion heartbeat sounds at most this often while any light is filling. */
const SUSPICION_HEARTBEAT_FRAMES = 40;
/** Frames between one guard's "huh?" barks. */
const SUSPICIOUS_BARK_THROTTLE_FRAMES = 150;
/** The shortest and the spread of walking frames between one guard's patrol mutters. */
const PATROL_MUTTER_MIN_FRAMES = 600;
const PATROL_MUTTER_SPREAD_FRAMES = 720;

/**
 * A spotlight's disc moving less than this in a frame is standing still, so a
 * dwell between two sweeps carries no heading and the turn is heard where the
 * disc sets off the other way.
 */
const SPOT_STILL_PX_PER_FRAME = 0.05;

/** Positional loops fall to silence this many tiles from the controlled crawler. */
const POSITIONAL_FALLOFF_TILES = 9;
const POSITIONAL_MAX_VOLUME = 0.45;
/** One-shot cues from a body in the prison fall off over this many tiles. */
const ONE_SHOT_FALLOFF_TILES = 12;

/** Prisoners: share of eligible cell tiles that get one, and the gap kept between two. */
const PRISONER_DENSITY = 0.35;
const PRISONER_MIN_GAP_TILES = 2;
const PRISONER_SEED_BASE = 9100;
const GUARD_SEED_BASE = 4200;

/** The suspicion marker floats this far above a guard's tile top when its art top is unknown. */
const MARKER_FALLBACK_LIFT_TILES = 0.6;

const HALF = 0.5;

const HASH_PRIME_X = 73856093;
const HASH_PRIME_Y = 19349663;
const UNIT_MASK = 0xffff;

/** An element by index, or undefined past either end. */
function elementAt<T>(items: ReadonlyArray<T>, index: number): T | undefined {
  return index >= 0 && index < items.length ? items[index] : undefined;
}

function tileHash(x: number, y: number): number {
  const h = Math.imul(x, HASH_PRIME_X) ^ Math.imul(y, HASH_PRIME_Y);
  return ((h >>> 0) & UNIT_MASK) / UNIT_MASK;
}

/** The point a body is tested from: its tile's centre, from a top-left position. */
function bodyCentre(body: { readonly x: number; readonly y: number }): PrisonPoint {
  return { x: body.x + TILE_SIZE * HALF, y: body.y + TILE_SIZE * HALF };
}

function tileOfBody(body: { readonly x: number; readonly y: number }): PrisonTile {
  const centre = bodyCentre(body);
  return { x: Math.floor(centre.x / TILE_SIZE), y: Math.floor(centre.y / TILE_SIZE) };
}

// ── Public types ────────────────────────────────────────────────────────────

/** Where a capture is in its sequence, or `idle` when none is running. */
export type PrisonCapturePhase = 'idle' | 'freeze' | 'fadeOut' | 'hold' | 'fadeIn';

/** What started a capture. */
export type PrisonCaptureCause =
  | { readonly kind: 'seen'; readonly sourceId: string }
  | { readonly kind: 'touched'; readonly guardId: string }
  | { readonly kind: 'struck'; readonly guardId: string }
  | { readonly kind: 'alarm'; readonly guardId: string }
  | { readonly kind: 'scripted' };

/**
 * One capture, handed to every {@link GoblinPrisonSystem.onCapture} listener
 * while the screen is black, after the party has been put in its cell and
 * before the fade back in.
 */
export interface PrisonCapture {
  readonly cause: PrisonCaptureCause;
  /** The holding cell the party now stands in. */
  readonly cell: PrisonHoldingCell;
  /** What the toast will say as the screen comes back. A listener may rewrite it. */
  toast: string;
}

export type PrisonCaptureListener = (capture: PrisonCapture) => void;

export interface GoblinPrisonDeps {
  readonly map: GameMap;
  readonly plan: PrisonPlan;
  readonly bus: EventBus;
  readonly audio: AudioManager | null;
  /** Where the positional loops run, faded out with the scene. */
  readonly audioScope: AudioScope | null;
  readonly addMob: (mob: Mob) => void;
  readonly toast: (text: string, tone: 'danger') => void;
  /** Starts the controlled crawler's attack, the same as pressing the attack key. */
  readonly triggerAttack: () => void;
}

// ── Internal state ──────────────────────────────────────────────────────────

interface Investigation {
  readonly plan: InvestigationPlan;
  readonly startPose: GuardPose;
  noiseFrame: number;
}

/** A guard stopped by its own suspicion, its light turning toward what it saw. */
interface SuspiciousHold {
  readonly pose: GuardPose;
  facing: number;
}

/** Seeded, so a headless run's random stream is untouched and no two guards grumble in step. */
function patrolMutterGap(seed: number, mutters: number): number {
  return (
    PATROL_MUTTER_MIN_FRAMES +
    Math.floor(bathroomSeedFraction(seed, mutters) * PATROL_MUTTER_SPREAD_FRAMES)
  );
}

interface GuardRuntime {
  readonly compiled: CompiledGuard;
  readonly mob: PrisonGoblin;
  shift: number;
  investigation: Investigation | null;
  hold: SuspiciousHold | null;
  suspicion: number;
  pose: GuardPose;
  cone: LightShape;
  /** The crawler point its light holds this frame, if any. */
  seen: PrisonPoint | null;
  seenWeight: number;
  barkThrottle: number;
  /** Walking frames left before he next grumbles to himself. */
  mutterIn: number;
  mutters: number;
  /** The patrol activity of the previous frame, so a scripted hold is heard as it begins. */
  lastActivity: GuardActivity;
}

interface SpotRuntime {
  readonly compiled: CompiledSpotlight;
  suspicion: number;
  shape: LightShape;
  seenWeight: number;
  centre: PrisonPoint;
  /** The disc's last frame of real movement; null until it has moved. */
  heading: PrisonPoint | null;
}

interface CellRuntime {
  readonly cell: PrisonHoldingCell;
  readonly door: PrisonCellDoor;
  readonly tileKeys: ReadonlySet<string>;
}

interface WoodChip {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

interface DoorSwing {
  readonly door: PrisonCellDoor;
  readonly crawler: Player;
  framesLeft: number;
}

function keyOf(tile: PrisonTile): string {
  return `${tile.x},${tile.y}`;
}

/**
 * The Goblin High Security Prison's live state, built by the interior scene
 * for the `goblin_prison` variant and run as its encounter.
 */
export class GoblinPrisonSystem {
  readonly defeatMessage = 'The prison kept what was left of you.';
  readonly compiled: CompiledPrison;
  readonly ground: PrisonGround;
  readonly lighting: PrisonLighting;

  private clock = 0;
  private readonly guards: GuardRuntime[];
  private readonly spots: SpotRuntime[];
  private readonly cells: CellRuntime[];
  private readonly prisoners: PrisonerGoblin[] = [];
  private readonly noises: PrisonNoise[] = [];
  private readonly listeners = new Set<PrisonCaptureListener>();
  private readonly lightSources = new Set<PrisonLightSource>();
  private readonly chips: WoodChip[] = [];
  /** One entry per guard then per spotlight, rewritten in place every frame rather than rebuilt. */
  private readonly lit: Array<{ shape: LightShape; catching: number; tower?: PrisonPoint }>;
  private doorSwing: DoorSwing | null = null;
  private readonly unsubscribe: Array<() => void> = [];
  private capturePhase: PrisonCapturePhase = 'idle';
  private captureFrame = 0;
  private captureCause: PrisonCaptureCause = { kind: 'scripted' };
  private alarmedSourceId: string | null = null;
  private heartbeatCooldown = 0;
  private readonly loopsRunning = new Set<PrisonCue>();
  private crawlers: ReadonlyArray<Player> = [];
  /** The roster's grid, from the frame being run: a driven guard is moved in it, so weapons find him where he stands. */
  private grid: SpatialGrid<Mob> | null = null;
  private readonly eyeScratch = { x: 0, y: 0, spacingPx: 0 };
  private active: Player | null = null;
  private lastCaptureCell: PrisonHoldingCell | null = null;
  /** How many captures have run; for gates and the scene's own bookkeeping. */
  captureCount = 0;

  constructor(private readonly deps: GoblinPrisonDeps) {
    const { parsed } = deps.plan;
    this.compiled = compilePrison(parsed, deps.plan.difficulty);
    this.ground = new PrisonGround(parsed);
    this.lighting = new PrisonLighting(parsed, this.ground.lamps);

    this.guards = this.compiled.guards.map((compiled, index) => {
      const pose = guardPoseAt(compiled, 0);
      const tile = { x: Math.floor(pose.x / TILE_SIZE), y: Math.floor(pose.y / TILE_SIZE) };
      const mob = new PrisonGoblin(tile.x, tile.y, TILE_SIZE, 'patrol', GUARD_SEED_BASE + index);
      mob.setMap(deps.map);
      deps.addMob(mob);
      return {
        compiled,
        mob,
        shift: 0,
        investigation: null,
        hold: null,
        suspicion: 0,
        pose,
        cone: guardCone(this.compiled, pose, 0),
        seen: null,
        seenWeight: 0,
        barkThrottle: 0,
        mutterIn: patrolMutterGap(mob.seed, 0),
        mutters: 0,
        lastActivity: pose.activity,
      };
    });
    this.spots = this.compiled.spotlights.map((compiled) => ({
      compiled,
      suspicion: 0,
      shape: this.castSpot(compiled, 0),
      seenWeight: 0,
      centre: compiled.centreAt(0),
      heading: null,
    }));
    this.cells = parsed.holdingCells.map((cell) => {
      const run = cell.door.y === cell.hall.y ? 'along' : 'across';
      const door = new PrisonCellDoor(cell.door.x, cell.door.y, TILE_SIZE, run);
      door.setMap(deps.map);
      deps.addMob(door);
      deps.map.setBodyBlock(cell.door.x, cell.door.y, true);
      return { cell, door, tileKeys: new Set(cell.tiles.map(keyOf)) };
    });
    this.lit = [
      ...this.guards.map((guard) => ({ shape: guard.cone, catching: 0 })),
      ...this.spots.map((spot) => ({
        shape: spot.shape,
        catching: 0,
        tower: spot.compiled.anchor,
      })),
    ];
    this.placePrisoners();
    this.applyGuardPoses();
    this.unsubscribe.push(
      deps.bus.on('blastLanded', ({ x, y }) => {
        this.noises.push({ kind: 'explosion', at: { x, y } });
      }),
    );
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Whether a capture is running: the world is frozen and the party is not the player's. */
  get isCapturing(): boolean {
    return this.capturePhase !== 'idle';
  }

  /** Where the running capture is. */
  get capturePhaseNow(): PrisonCapturePhase {
    return this.capturePhase;
  }

  /** Whether the party's input is withheld: for the whole of a capture. */
  get playerLocked(): boolean {
    return this.isCapturing;
  }

  /** How dark the full-screen fade is right now, 0 to 1. */
  get fadeAlpha(): number {
    switch (this.capturePhase) {
      case 'idle':
      case 'freeze':
        return 0;
      case 'fadeOut':
        return Math.min(1, this.captureFrame / CAPTURE_FADE_OUT_FRAMES);
      case 'hold':
        return 1;
      case 'fadeIn':
        return Math.max(0, 1 - this.captureFrame / CAPTURE_FADE_IN_FRAMES);
    }
  }

  /** The full-screen fade the capture runs through; mount once on the scene's `UiRoot`. */
  fadeSurface(id = 'prison-capture-fade'): Surface {
    return screenFadeSurface(id, { alpha: () => this.fadeAlpha });
  }

  /**
   * Starts a capture, as if a guard had seen enough. Does nothing while one
   * is already running.
   */
  capture(cause: PrisonCaptureCause = { kind: 'scripted' }): void {
    if (this.isCapturing) return;
    this.captureCause = cause;
    this.capturePhase = 'freeze';
    this.captureFrame = 0;
    this.alarmedSourceId =
      cause.kind === 'seen' ? cause.sourceId : cause.kind === 'scripted' ? null : cause.guardId;
    this.doorSwing = null;
    this.playCue('guardHey');
    this.playCue('caught');
  }

  /**
   * Hears every capture while the screen is black, after the party is in its
   * cell. A listener may rewrite the capture's toast. Returns the unsubscribe.
   */
  onCapture(listener: PrisonCaptureListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /**
   * Cuts an extra pool out of the prison's darkness every frame until the
   * returned function is called. The source is read each frame, so it may
   * move or change strength.
   */
  addLightSource(source: PrisonLightSource): () => void {
    this.lightSources.add(source);
    return () => this.lightSources.delete(source);
  }

  /** Which section a tile is in, or null for the walls between them. */
  sectionAt(tileX: number, tileY: number): PrisonSectionId | null {
    return prisonSectionAt(this.compiled.parsed.layout, tileX, tileY);
  }

  /** The holding cell a crawler stands in, or null. */
  cellOf(body: { readonly x: number; readonly y: number }): PrisonHoldingCell | null {
    return this.cellRuntimeOf(body)?.cell ?? null;
  }

  /** Every holding cell's door, in the layout's cell order. */
  get cellDoors(): ReadonlyArray<PrisonCellDoor> {
    return this.cells.map((cell) => cell.door);
  }

  /** Every patrol guard, in the layout's order. */
  get guardMobs(): ReadonlyArray<PrisonGoblin> {
    return this.guards.map((guard) => guard.mob);
  }

  /** Every prisoner in the cell block. */
  get prisonerMobs(): ReadonlyArray<PrisonerGoblin> {
    return this.prisoners;
  }

  /** Each guard's and spotlight's suspicion by its id, 0..1. */
  suspicionById(): ReadonlyMap<string, number> {
    const entries: Array<[string, number]> = [
      ...this.guards.map((guard): [string, number] => [guard.compiled.def.id, guard.suspicion]),
      ...this.spots.map((spot): [string, number] => [spot.compiled.def.id, spot.suspicion]),
    ];
    return new Map(entries);
  }

  /** The shared loop clock: frames since entry or since the last capture's reset. */
  get loopFrame(): number {
    return this.clock;
  }

  /** Every light's shape this frame: the polygons drawn and tested. */
  lightShapes(): ReadonlyArray<LitPrisonLight> {
    return this.lit;
  }

  /** Brings {@link lit} up to this frame's shapes and suspicions, in place. */
  private refreshLights(): void {
    this.guards.forEach((guard, index) => {
      const light = elementAt(this.lit, index);
      if (light === undefined) return;
      light.shape = guard.cone;
      light.catching = guard.suspicion;
    });
    this.spots.forEach((spot, index) => {
      const light = elementAt(this.lit, this.guards.length + index);
      if (light === undefined) return;
      light.shape = spot.shape;
      light.catching = spot.suspicion;
    });
  }

  /** The prompt is shown, and Space breaks a door, while the active crawler stands in a cell whose door is whole. */
  doorPromptFor(body: { readonly x: number; readonly y: number }): PrisonCellDoor | null {
    const cell = this.cellRuntimeOf(body);
    if (cell === null || cell.door.broken) return null;
    return cell.door;
  }

  // ── Frame ─────────────────────────────────────────────────────────────────

  update(ctx: SystemContext): void {
    this.crawlers = [ctx.human, ctx.cat];
    this.active = ctx.active;
    this.grid = ctx.roster.grid;
    this.tickChips();
    this.drainCreatureCues(ctx.active);
    if (this.isCapturing) {
      this.ignoreWhileCapturing();
      this.stepCapture(ctx);
      this.updatePositionalLoops(ctx.active);
      return;
    }
    this.stepDoorSwing();
    this.collectDoorBreaks();
    this.clock++;
    this.stepGuards();
    this.stepSpots();
    this.stepDetection();
    this.answerStrikes();
    this.answerNoises();
    this.applyGuardPoses();
    this.refreshLights();
    this.updatePositionalLoops(ctx.active);
  }

  /**
   * Space inside a cell whose door is whole: turns the crawler to the door and
   * swings, and the blow lands on the door. Breaking out of a cell is always
   * one press, wherever in the cell the crawler stands.
   */
  tryInteract(ctx: SystemContext): boolean {
    if (this.isCapturing) return false;
    const door = this.doorPromptFor(ctx.active);
    if (door === null) return false;
    const toDoorX = door.x - ctx.active.x;
    const toDoorY = door.y - ctx.active.y;
    const length = Math.hypot(toDoorX, toDoorY);
    if (length > 0) {
      ctx.active.facingX = toDoorX / length;
      ctx.active.facingY = toDoorY / length;
    }
    this.deps.triggerAttack();
    this.doorSwing = { door, crawler: ctx.active, framesLeft: CELL_DOOR_SWING_FRAMES };
    return true;
  }

  private stepDoorSwing(): void {
    const swing = this.doorSwing;
    if (swing === null) return;
    swing.framesLeft--;
    if (swing.framesLeft > 0) return;
    this.doorSwing = null;
    if (!swing.door.broken) swing.door.takeDamageFrom(1, swing.crawler, 'melee');
  }

  private cellRuntimeOf(body: { readonly x: number; readonly y: number }): CellRuntime | null {
    const key = keyOf(tileOfBody(body));
    return this.cells.find((cell) => cell.tileKeys.has(key)) ?? null;
  }

  private castSpot(spot: CompiledSpotlight, frame: number): LightShape {
    return this.castDiscAt(spot.centreAt(frame));
  }

  private castDiscAt(centre: PrisonPoint): LightShape {
    const radius = this.compiled.tuning.spotlight.radiusTiles * TILE_SIZE;
    return castDisc(this.compiled.parsed.grid, centre, radius);
  }

  private loopPoseOf(guard: GuardRuntime): GuardPose {
    const investigation = guard.investigation;
    if (investigation !== null) {
      const result = investigationPoseAt(
        investigation.plan,
        investigation.startPose,
        this.clock - investigation.noiseFrame,
      );
      if (!result.done) return result.pose;
      guard.shift = loopShiftAfter(investigation.plan, investigation.noiseFrame);
      guard.investigation = null;
      this.playCueFrom('guardGivesUp', result.pose);
    }
    return guardPoseAt(guard.compiled, this.clock - guard.shift);
  }

  private stepGuards(): void {
    const turnRate = this.compiled.tuning.turnDegPerFrame * DEGREES_TO_RADIANS;
    for (const guard of this.guards) {
      if (guard.barkThrottle > 0) guard.barkThrottle--;
      if (guard.hold !== null) {
        guard.shift++;
        if (guard.investigation !== null) guard.investigation.noiseFrame++;
      }
      const loopPose = this.loopPoseOf(guard);
      const hold = guard.hold;
      if (hold === null) {
        guard.pose = loopPose;
        this.tickPatrolMutter(guard);
        this.tickBatonTap(guard);
      } else {
        const target =
          guard.seen !== null
            ? Math.atan2(guard.seen.y - hold.pose.y, guard.seen.x - hold.pose.x)
            : loopPose.facing;
        const remaining = wrapAngle(target - hold.facing);
        hold.facing =
          Math.abs(remaining) <= turnRate
            ? target
            : wrapAngle(hold.facing + Math.sign(remaining) * turnRate);
        const backOnLoop =
          guard.suspicion <= 0 && Math.abs(wrapAngle(loopPose.facing - hold.facing)) < turnRate;
        if (backOnLoop) {
          guard.hold = null;
          guard.pose = loopPose;
        } else {
          guard.pose = { ...hold.pose, facing: hold.facing, moving: false, activity: 'hold' };
        }
      }
      guard.cone = guardCone(
        this.compiled,
        guard.pose,
        this.animationClockOf(guard),
        guard.suspicion > 0,
      );
    }
  }

  private tickPatrolMutter(guard: GuardRuntime): void {
    const onPlainPatrol = guard.investigation === null && guard.pose.moving;
    if (!onPlainPatrol) return;
    guard.mutterIn--;
    if (guard.mutterIn > 0) return;
    guard.mutters++;
    guard.mutterIn = patrolMutterGap(guard.mob.seed, guard.mutters);
    this.playCueFrom('guardMutter', guard.pose);
  }

  private tickBatonTap(guard: GuardRuntime): void {
    const activity = guard.pose.activity;
    const startedHold =
      activity === 'hold' && guard.lastActivity !== 'hold' && guard.investigation === null;
    guard.lastActivity = activity;
    if (startedHold) this.playCueFrom('guardBatonTap', guard.pose);
  }

  /** The clock a guard's art and lens run on: its own loop's frame, which is the shared clock until a pause or a noise shifts it. */
  private animationClockOf(guard: GuardRuntime): number {
    return this.clock - guard.shift;
  }

  private stepSpots(): void {
    for (const spot of this.spots) {
      const centre = spot.compiled.centreAt(this.clock);
      spot.shape = this.castDiscAt(centre);
      this.tickSpotTurn(spot, centre);
    }
  }

  private tickSpotTurn(spot: SpotRuntime, centre: PrisonPoint): void {
    const step = { x: centre.x - spot.centre.x, y: centre.y - spot.centre.y };
    spot.centre = centre;
    if (Math.hypot(step.x, step.y) < SPOT_STILL_PX_PER_FRAME) return;
    const previous = spot.heading;
    spot.heading = step;
    if (previous === null) return;
    const reversed = previous.x * step.x + previous.y * step.y < 0;
    if (reversed) this.playCueFrom('spotlightTurn', spot.compiled.anchor);
  }

  private crawlerCentres(): PrisonPoint[] {
    return this.crawlers.filter((crawler) => crawler.isAlive).map(bodyCentre);
  }

  private stepDetection(): void {
    const { grid } = this.compiled.parsed;
    const { suspicion } = this.compiled.tuning;
    const centres = this.crawlerCentres();
    let anyRising = false;
    for (const guard of this.guards) {
      let best = 0;
      let seen: PrisonPoint | null = null;
      for (const centre of centres) {
        const weight = lightSeesBody(grid, guard.cone, centre, suspicion.coneEdgeWeight);
        if (weight > best) {
          best = weight;
          seen = centre;
        }
      }
      const was = guard.suspicion;
      guard.seenWeight = best;
      guard.seen = seen;
      guard.suspicion = stepSuspicion(guard.suspicion, 'cone', best, suspicion);
      if (best > SEEN_EDGE_WEIGHT_FLOOR) {
        anyRising = true;
        guard.hold ??= { pose: guard.pose, facing: guard.pose.facing };
        if (was <= 0 && guard.barkThrottle <= 0) {
          guard.barkThrottle = SUSPICIOUS_BARK_THROTTLE_FRAMES;
          this.playCueFrom('guardSuspicious', guard.pose);
        }
      }
      if (guard.suspicion >= SUSPICION_CAPTURE) {
        this.capture({ kind: 'seen', sourceId: guard.compiled.def.id });
        return;
      }
    }
    for (const spot of this.spots) {
      let best = 0;
      for (const centre of centres) {
        best = Math.max(best, lightSeesBody(grid, spot.shape, centre, 1));
      }
      spot.seenWeight = best;
      spot.suspicion = stepSuspicion(spot.suspicion, 'disc', best, suspicion);
      if (best > SEEN_EDGE_WEIGHT_FLOOR) anyRising = true;
      if (spot.suspicion >= SUSPICION_CAPTURE) {
        this.capture({ kind: 'seen', sourceId: spot.compiled.def.id });
        return;
      }
    }
    for (const guard of this.guards) {
      const body = { x: guard.pose.x, y: guard.pose.y, facing: guard.pose.facing };
      if (centres.some((centre) => bodyTouchesGuard(grid, body, centre))) {
        this.capture({ kind: 'touched', guardId: guard.compiled.def.id });
        return;
      }
    }
    if (this.heartbeatCooldown > 0) this.heartbeatCooldown--;
    if (anyRising && this.heartbeatCooldown <= 0) {
      this.heartbeatCooldown = SUSPICION_HEARTBEAT_FRAMES;
      this.playCue('suspicionRising');
    }
  }

  /**
   * A blow on a guard whose light holds a crawler is a catch; any other blow
   * is a noise from where it was thrown, with that weapon's reach, so the
   * struck guard turns to look at whoever hit it.
   */
  private answerStrikes(): void {
    for (const guard of this.guards) {
      const strikes = guard.mob.takeStrikes();
      const strike = guard.mob.lastStrike;
      guard.mob.lastStrike = null;
      if (strikes <= 0) continue;
      if (guard.seenWeight > SEEN_EDGE_WEIGHT_FLOOR) {
        this.capture({ kind: 'struck', guardId: guard.compiled.def.id });
        return;
      }
      const at =
        strike === null
          ? { x: guard.pose.x, y: guard.pose.y }
          : { x: strike.fromX, y: strike.fromY };
      this.noises.push({
        kind: strike?.damageType ?? 'melee',
        at,
        struckGuardId: guard.compiled.def.id,
      });
    }
  }

  /** Whatever lands while a capture runs is let go: the prison is not listening, and the reset must hold. */
  private ignoreWhileCapturing(): void {
    this.noises.length = 0;
    for (const guard of this.guards) {
      guard.mob.takeStrikes();
      guard.mob.lastStrike = null;
    }
    for (const cell of this.cells) {
      if (cell.door.brokenBy === null) continue;
      cell.door.brokenBy = null;
      this.deps.map.setBodyBlock(cell.cell.door.x, cell.cell.door.y, false);
    }
  }

  private collectDoorBreaks(): void {
    for (const cell of this.cells) {
      const brokenBy = cell.door.brokenBy;
      if (brokenBy === null) continue;
      cell.door.brokenBy = null;
      this.onDoorBroken(cell, brokenBy);
    }
  }

  private onDoorBroken(cell: CellRuntime, brokenBy: PlayerDamageType): void {
    const { door } = cell.cell;
    this.deps.map.setBodyBlock(door.x, door.y, false);
    const at = tileCentrePx(door);
    this.noises.push({ kind: brokenBy, at });
    this.playCueFrom('cellDoorBreak', { x: at.x, y: at.y });
    for (let index = 0; index < DOOR_CHIP_COUNT; index++) {
      const angle = (index / DOOR_CHIP_COUNT) * Math.PI * 2 + tileHash(door.x, index);
      this.chips.push({
        x: at.x,
        y: at.y,
        vx: Math.cos(angle) * DOOR_CHIP_SPEED_PX,
        vy: Math.sin(angle) * DOOR_CHIP_SPEED_PX - DOOR_CHIP_LIFT_PX,
        life: DOOR_CHIP_LIFE_FRAMES,
      });
    }
  }

  private answerNoises(): void {
    if (this.noises.length === 0) return;
    const noises = this.noises.splice(0);
    if (this.isCapturing) return;
    for (const noise of noises) {
      for (const guard of this.guards) {
        const response = respondToNoise(
          this.compiled,
          guard.compiled,
          guard.pose,
          this.animationClockOf(guard),
          noise,
        );
        if (response.kind === 'alarm') {
          this.capture({ kind: 'alarm', guardId: guard.compiled.def.id });
          return;
        }
        if (response.kind === 'investigate') {
          guard.investigation = {
            plan: response.plan,
            startPose: guard.pose,
            noiseFrame: this.clock,
          };
          this.playCueFrom('guardInvestigate', guard.pose);
        }
      }
    }
  }

  private applyGuardPoses(): void {
    const speed = this.compiled.tuning.patrolSpeedPxPerFrame;
    for (const guard of this.guards) {
      const alert = guard.suspicion > 0 || this.alarmedSourceId === guard.compiled.def.id;
      const animation = guardAnimation(guard.pose, this.animationClockOf(guard), speed, alert);
      guard.mob.applyPose(
        {
          x: guard.pose.x,
          y: guard.pose.y,
          facing: guard.pose.facing,
          activity: animation.state,
        },
        this.grid ?? undefined,
      );
      guard.mob.applyDrivenArt({
        state: animation.state,
        frame: animation.frame,
        facingX: guardFacingX(guard.pose.facing),
      });
    }
  }

  // ── Capture ───────────────────────────────────────────────────────────────

  private stepCapture(ctx: SystemContext): void {
    this.captureFrame++;
    switch (this.capturePhase) {
      case 'idle':
        return;
      case 'freeze':
        if (this.captureFrame >= CAPTURE_FREEZE_FRAMES) this.enterCapturePhase('fadeOut');
        return;
      case 'fadeOut':
        if (this.captureFrame >= CAPTURE_FADE_OUT_FRAMES) {
          this.enterCapturePhase('hold');
          this.throwInCell(ctx);
        }
        return;
      case 'hold':
        if (this.captureFrame >= CAPTURE_HOLD_FRAMES) {
          this.enterCapturePhase('fadeIn');
          this.playCue('cellDoorSlam');
        }
        return;
      case 'fadeIn':
        if (this.captureFrame >= CAPTURE_FADE_IN_FRAMES) {
          this.capturePhase = 'idle';
          this.captureFrame = 0;
          this.alarmedSourceId = null;
          this.applyGuardPoses();
        }
        return;
    }
  }

  private enterCapturePhase(phase: PrisonCapturePhase): void {
    this.capturePhase = phase;
    this.captureFrame = 0;
  }

  /** Everything the black screen hides: the party in a cell, the door boarded, the loops reset. */
  private throwInCell(ctx: SystemContext): void {
    const cell = elementAt(this.cells, 0);
    if (cell === undefined) return;
    this.placeInCell(cell, [ctx.active, ctx.inactive]);
    if (cell.door.broken) cell.door.reboard();
    cell.door.brokenBy = null;
    this.deps.map.setBodyBlock(cell.cell.door.x, cell.cell.door.y, true);
    this.resetLoops();
    this.captureCount++;
    this.lastCaptureCell = cell.cell;
    const capture: PrisonCapture = {
      cause: this.captureCause,
      cell: cell.cell,
      toast: CAPTURE_TOAST,
    };
    for (const listener of this.listeners) listener(capture);
    this.deps.toast(capture.toast, 'danger');
  }

  /** The holding cell the last capture used, or null before any. */
  get lastCaptureHoldingCell(): PrisonHoldingCell | null {
    return this.lastCaptureCell;
  }

  /** Stands each crawler on its own cell tile, the active one farthest from the door. */
  private placeInCell(cell: CellRuntime, crawlers: ReadonlyArray<Player>): void {
    const door = cell.cell.door;
    const byDistance = [...cell.cell.tiles].sort(
      (a, b) =>
        Math.hypot(b.x - door.x, b.y - door.y) - Math.hypot(a.x - door.x, a.y - door.y) ||
        a.y - b.y ||
        a.x - b.x,
    );
    crawlers.forEach((crawler, index) => {
      const tile = elementAt(byDistance, Math.min(index, byDistance.length - 1));
      if (tile === undefined) return;
      crawler.x = tile.x * TILE_SIZE;
      crawler.y = tile.y * TILE_SIZE;
      crawler.isMoving = false;
      const toDoorX = door.x - tile.x;
      const toDoorY = door.y - tile.y;
      const length = Math.hypot(toDoorX, toDoorY);
      if (length > 0) {
        crawler.facingX = toDoorX / length;
        crawler.facingY = toDoorY / length;
      }
    });
  }

  private resetLoops(): void {
    this.clock = 0;
    this.noises.length = 0;
    this.doorSwing = null;
    for (const guard of this.guards) {
      guard.shift = 0;
      guard.investigation = null;
      guard.hold = null;
      guard.suspicion = 0;
      guard.seen = null;
      guard.seenWeight = 0;
      guard.pose = guardPoseAt(guard.compiled, 0);
      guard.lastActivity = guard.pose.activity;
      guard.cone = guardCone(this.compiled, guard.pose, 0);
      guard.mob.takeStrikes();
      guard.mob.lastStrike = null;
    }
    for (const spot of this.spots) {
      spot.suspicion = 0;
      spot.seenWeight = 0;
      spot.shape = this.castSpot(spot.compiled, 0);
      spot.centre = spot.compiled.centreAt(0);
      spot.heading = null;
    }
    this.applyGuardPoses();
    this.refreshLights();
  }

  // ── Prisoners ─────────────────────────────────────────────────────────────

  private placePrisoners(): void {
    const { grid } = this.compiled.parsed;
    const placed: PrisonTile[] = [];
    for (let y = 0; y < grid.height; y++) {
      for (let x = 0; x < grid.width; x++) {
        if (prisonTileAt(grid, x, y) !== PRISON_TILE.prisonerFloor) continue;
        if (tileHash(x, y) >= PRISONER_DENSITY) continue;
        const crowded = placed.some(
          (tile) => Math.max(Math.abs(tile.x - x), Math.abs(tile.y - y)) < PRISONER_MIN_GAP_TILES,
        );
        if (crowded) continue;
        placed.push({ x, y });
      }
    }
    placed.forEach((tile, index) => {
      const prisoner = new PrisonerGoblin(tile.x, tile.y, TILE_SIZE, PRISONER_SEED_BASE + index);
      prisoner.facingX = tileHash(tile.y, tile.x) < HALF ? -1 : 1;
      prisoner.setMap(this.deps.map);
      this.deps.addMob(prisoner);
      this.prisoners.push(prisoner);
    });
  }

  // ── Sound ─────────────────────────────────────────────────────────────────

  private playCue(cue: PrisonCue, volume?: number): void {
    playPrisonCue(this.deps.audio, cue, volume);
  }

  /** A one-shot from a body in the prison, quieter the further it is from the controlled crawler. */
  private playCueFrom(cue: PrisonCue, at: PrisonPoint): void {
    const listener = this.active;
    if (listener === null) {
      this.playCue(cue);
      return;
    }
    const centre = bodyCentre(listener);
    const distanceTiles = Math.hypot(at.x - centre.x, at.y - centre.y) / TILE_SIZE;
    const volume = Math.max(0, 1 - distanceTiles / ONE_SHOT_FALLOFF_TILES);
    if (volume <= 0) return;
    this.playCue(cue, volume);
  }

  private drainCreatureCues(active: Player): void {
    for (const guard of this.guards) {
      if (!guard.mob.owCuePending) continue;
      guard.mob.owCuePending = false;
      this.playCueFrom('guardHit', bodyCentre(guard.mob));
    }
    for (const prisoner of this.prisoners) {
      if (!prisoner.heckleCuePending) continue;
      prisoner.heckleCuePending = false;
      this.playCueFrom('prisonerHeckle', bodyCentre(prisoner));
    }
    for (const prisoner of this.prisoners) {
      if (!prisoner.rattleCuePending) continue;
      prisoner.rattleCuePending = false;
      this.playCueFrom('prisonerRattle', bodyCentre(prisoner));
    }
    this.active = active;
  }

  /**
   * The spotlights' hum and the patrols' footsteps, each a loop whose volume
   * is set by the nearest source to the controlled crawler, so the player can
   * hear a guard coming before its light shows.
   */
  private updatePositionalLoops(active: Player): void {
    const audio = this.deps.audioScope;
    if (audio === null) return;
    const centre = bodyCentre(active);
    let nearestWalker = Infinity;
    if (!this.isCapturing) {
      for (const guard of this.guards) {
        if (!guard.pose.moving) continue;
        const distance = Math.hypot(guard.pose.x - centre.x, guard.pose.y - centre.y);
        nearestWalker = Math.min(nearestWalker, distance);
      }
    }
    let nearestSpot = Infinity;
    for (const spot of this.spots) {
      const at = spot.shape.kind === 'disc' ? spot.shape.centre : spot.compiled.anchor;
      nearestSpot = Math.min(nearestSpot, Math.hypot(at.x - centre.x, at.y - centre.y));
    }
    this.setPositionalLoop(audio, 'guardFootsteps', nearestWalker);
    this.setPositionalLoop(audio, 'spotlightHum', nearestSpot);
  }

  private setPositionalLoop(audio: AudioScope, cue: PrisonCue, distancePx: number): void {
    const takes: ReadonlyArray<string> = PRISON_CUES[cue];
    const sound = PRISON_CUES[cue][0];
    if (takes.length === 0 || sound === undefined) return;
    const volume =
      POSITIONAL_MAX_VOLUME * Math.max(0, 1 - distancePx / (POSITIONAL_FALLOFF_TILES * TILE_SIZE));
    if (volume <= 0) {
      if (this.loopsRunning.delete(cue)) audio.stopAmbientLoop(sound);
      return;
    }
    // Asked of the scope rather than of `loopsRunning`: a start declined
    // while the buffer is still decoding or the context is locked must be
    // retried on a later frame.
    if (!audio.isAmbientLoopRunning(sound)) {
      audio.startAmbientLoop(sound, volume);
      this.loopsRunning.add(cue);
      return;
    }
    audio.setAmbientLoopVolume(sound, volume);
  }

  // ── Render ────────────────────────────────────────────────────────────────

  /** The walls, floor and wall furniture, in place of the map's own tiles. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.ground.renderGround(ctx, camX, camY, viewportWidth(), viewportHeight());
  }

  /** Opens the queue that lifts health bars and markers over the darkness drawn in {@link renderEffects}. */
  renderWorld(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    beginAboveDarkness((worldX, worldY) => this.darknessAt(worldX, worldY));
    const door = this.isCapturing ? null : this.doorPromptFor(active);
    if (door !== null) {
      drawInteractionPromptOver(ctx, door, camX, camY, CELL_DOOR_PROMPT);
    }
  }

  /** Bars and cover, sorted with the bodies. */
  sortedFigures(camX: number, camY: number): InteriorFigure[] {
    return this.ground.sortedFigures(camX, camY, viewportWidth(), viewportHeight());
  }

  /**
   * The dark, the lights and the eye shine, straight over the sorted pass and
   * under every shot, blast and spell, which carry their own light; then the
   * health bars and markers the sorted pass held back.
   */
  renderDarkness(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const viewW = viewportWidth();
    const viewH = viewportHeight();
    this.lighting.renderDarkness(ctx, camX, camY, viewW, viewH, this.lit, this.lightSources);
    const nowMs = performance.now();
    this.lighting.renderLiveLights(ctx, camX, camY, viewW, viewH, this.lit, nowMs);
    this.renderEyeShine(ctx, camX, camY, viewW, viewH, nowMs);
    flushAboveDarkness(ctx);
  }

  /** The chips off a broken door and the suspicion markers, over everything in the world. */
  renderEffects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.renderChips(ctx, camX, camY);
    this.renderMarkers(ctx, camX, camY, performance.now());
  }

  /** How dark the world is at a point this frame: the static dark, unless a light covers it. */
  darknessAt(worldX: number, worldY: number): number {
    const point = { x: worldX, y: worldY };
    const { grid } = this.compiled.parsed;
    for (const light of this.lit) {
      const { bounds } = light.shape;
      if (
        worldX < bounds.minX ||
        worldX > bounds.maxX ||
        worldY < bounds.minY ||
        worldY > bounds.maxY
      ) {
        continue;
      }
      if (lightSeesBody(grid, light.shape, point, 1) > 0) return 0;
    }
    return this.lighting.staticDarknessAt(worldX, worldY);
  }

  private renderEyeShine(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    viewW: number,
    viewH: number,
    nowMs: number,
  ): void {
    const eyes = this.eyeScratch;
    const shine = (body: Mob, seed: number): void => {
      const sx = body.x - camX;
      const sy = body.y - camY;
      if (sx < -TILE_SIZE || sy < -TILE_SIZE || sx > viewW || sy > viewH) return;
      if (!eyesOpenAt(nowMs, seed)) return;
      const centre = bodyCentre(body);
      if (this.darknessAt(centre.x, centre.y) < LIGHTING_TUNING.eyeShineMinDarkness) return;
      if (!body.eyeShineAnchor(eyes)) return;
      drawEyePair(ctx, eyes.x - camX, eyes.y - camY, eyes.spacingPx);
    };
    this.guards.forEach((guard, index) => shine(guard.mob, index));
    this.prisoners.forEach((prisoner, index) => shine(prisoner, this.guards.length + index));
  }

  private tickChips(): void {
    for (const chip of this.chips) {
      chip.x += chip.vx;
      chip.y += chip.vy;
      chip.vy += DOOR_CHIP_GRAVITY_PX;
      chip.life--;
    }
    for (let index = this.chips.length - 1; index >= 0; index--) {
      if ((this.chips[index]?.life ?? 0) <= 0) this.chips.splice(index, 1);
    }
  }

  private renderChips(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.chips.length === 0) return;
    ctx.save();
    ctx.fillStyle = DOOR_CHIP_COLOR;
    for (const chip of this.chips) {
      ctx.globalAlpha = Math.min(1, chip.life / (DOOR_CHIP_LIFE_FRAMES * HALF));
      ctx.fillRect(chip.x - camX, chip.y - camY, DOOR_CHIP_SIZE_PX, DOOR_CHIP_SIZE_PX);
    }
    ctx.restore();
  }

  private renderMarkers(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    nowMs: number,
  ): void {
    for (const guard of this.guards) {
      const alarmed = this.alarmedSourceId === guard.compiled.def.id;
      if (!alarmed && guard.suspicion <= 0) continue;
      const top = Number.isNaN(guard.mob.artTopWorldY)
        ? guard.mob.y - TILE_SIZE * MARKER_FALLBACK_LIFT_TILES
        : guard.mob.artTopWorldY;
      drawSuspicionMarker(ctx, {
        x: guard.mob.x + TILE_SIZE * HALF - camX,
        y: top - camY,
        suspicion: guard.suspicion,
        alarmed,
        nowMs,
      });
    }
    for (const spot of this.spots) {
      const alarmed = this.alarmedSourceId === spot.compiled.def.id;
      if (!alarmed && spot.suspicion <= 0) continue;
      const anchor = spot.compiled.anchor;
      drawSuspicionMarker(ctx, {
        x: anchor.x - camX,
        y: anchor.y - TILE_SIZE * HALF - camY,
        suspicion: spot.suspicion,
        alarmed,
        nowMs,
      });
    }
  }

  topBandEntries(): TopBandEntry[] {
    return [];
  }

  /** Stops the positional loops, lets go of the bus and gives back the prison's baked art. */
  dispose(): void {
    this.ground.release();
    this.lighting.release();
    for (const off of this.unsubscribe) off();
    this.unsubscribe.length = 0;
    const audio = this.deps.audioScope;
    if (audio !== null) {
      for (const cue of this.loopsRunning) {
        const sound = PRISON_CUES[cue][0];
        if (sound !== undefined) audio.stopAmbientLoop(sound);
      }
    }
    this.loopsRunning.clear();
    this.listeners.clear();
    this.lightSources.clear();
  }
}
