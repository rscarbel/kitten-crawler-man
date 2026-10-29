import { TILE_SIZE } from '../../core/constants';
import type { Conversation } from '../../dialog/Conversation';
import type { ConversationHandle, ConversationRequest } from '../../dialog/request';
import type { GameMap } from '../../map/GameMap';
import type { Player } from '../../Player';
import { pixelToTile } from '../../utils';
import type { MovementInput } from '../GameLoopPhases';
import { CutsceneCamera, type CutscenePoint } from './cutsceneCamera';
import { CutsceneShake } from './cutsceneShake';
import type {
  CutsceneFacing,
  CutsceneScript,
  CutsceneSoundCue,
  CutsceneStep,
  CutsceneTalk,
  CutsceneTile,
  CutsceneWorldAction,
  WalkToStep,
} from './cutsceneSteps';

/** About four seconds: longer than any walk across a room, short enough that a stuck walk is not felt. */
export const WALK_UP_TIMEOUT_FRAMES = 240;

/** The furthest a walk-up searches for its path; a speaker further off is talked to from where the crawler stands. */
export const WALK_UP_MAX_PATH_TILES = 24;

/** How near a waypoint, as a share of a tile, the crawler must come before steering for the next one. */
const WAYPOINT_REACHED_TILE_FRACTION = 0.25;
const WAYPOINT_REACHED_PX = TILE_SIZE * WAYPOINT_REACHED_TILE_FRACTION;

const FACING_VECTORS: Readonly<Record<CutsceneFacing, { readonly x: number; readonly y: number }>> =
  {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

/** What the scene a cutscene plays in does for the steps the director cannot do itself. */
export interface CutsceneDirectorDeps<Action extends CutsceneWorldAction = never> {
  /** The scene's one conversation, which every talk in a cutscene opens on. */
  readonly conversation: Conversation;
  /** Takes Dave out of the room he is standing in. */
  readonly teleportDaveOut: () => void;
  /** Plays one take of `cue`, placed at `at` when it is given. */
  readonly playSound: (cue: CutsceneSoundCue, at: CutscenePoint | null) => void;
  /** Makes the change to the world a `run` step names; `noWorldActions` for a scene with none. */
  readonly runWorldAction: (action: Action) => void;
}

/** Where the step being run has got to. */
type StepProgress =
  | { readonly kind: 'unstarted' }
  | {
      readonly kind: 'walking';
      readonly step: WalkToStep;
      readonly waypoints: CutsceneTile[];
      frames: number;
    }
  | { readonly kind: 'talking'; readonly handle: ConversationHandle }
  | { readonly kind: 'waiting'; framesLeft: number }
  | { readonly kind: 'movingCamera' };

interface QueuedCutscene<Action extends CutsceneWorldAction> {
  readonly script: CutsceneScript<Action>;
  readonly onComplete: (() => void) | null;
  readonly onStart: (() => void) | null;
}

interface RunningCutscene<Action extends CutsceneWorldAction> extends QueuedCutscene<Action> {
  index: number;
  progress: StepProgress;
}

function tileOf(player: Player): CutsceneTile {
  return { x: pixelToTile(player.x), y: pixelToTile(player.y) };
}

function face(player: Player, facing: CutsceneFacing): void {
  const vector = FACING_VECTORS[facing];
  player.facingX = vector.x;
  player.facingY = vector.y;
}

/**
 * Runs scripted moments in which a script owns the party: a walk-up, a talk,
 * a message from Caroline, the guide leaving, a pause, camera moves and
 * shakes, sounds, and the playing scene's own world actions. One per scene,
 * built by `CutsceneKit`.
 *
 * Steps start only on a world tick, so nothing a script opens can land on top
 * of the pause menu; a walk, a wait and a camera move advance with the world
 * and so stop under it. A talk halts the world itself, and ends its step the
 * moment its last page is read.
 *
 * Cutscenes asked for while one plays wait their turn.
 */
export class CutsceneDirector<Action extends CutsceneWorldAction = never> {
  private running: RunningCutscene<Action> | null = null;
  private readonly queue: QueuedCutscene<Action>[] = [];
  private readonly camera = new CutsceneCamera();
  private readonly shake = new CutsceneShake();

  constructor(private readonly deps: CutsceneDirectorDeps<Action>) {}

  /** The one flag the rest of the game asks: while true, a script owns the party and input. */
  get isActive(): boolean {
    return this.running !== null || this.queue.length > 0;
  }

  /**
   * Plays `script` now, or after the cutscenes already waiting. `onStart` runs
   * on the world tick its first step starts, which is later than this call
   * whenever another cutscene is running or queued; `onComplete` runs once its
   * last step ends.
   */
  play(script: CutsceneScript<Action>, onComplete?: () => void, onStart?: () => void): void {
    this.queue.push({ script, onComplete: onComplete ?? null, onStart: onStart ?? null });
  }

  /**
   * Where a cutscene has pointed the camera, or null to follow `leader`. The
   * scene asks this in its camera's priority chain.
   */
  cameraFocus(leader: CutscenePoint): CutscenePoint | null {
    return this.camera.focus(leader);
  }

  /** This frame's shake, which the scene adds to the camera after clamping. */
  get cameraShake(): CutscenePoint {
    return this.shake.offset;
  }

  /**
   * One world tick of the camera and the shake. Run on every world tick,
   * cutscene or not, ahead of {@link tickWorld}, since a shake outlives the
   * script that started it.
   */
  tickEffects(): void {
    this.camera.tick();
    this.shake.tick();
  }

  /**
   * One world tick of the running cutscene. Starts whatever steps are due and
   * steers a walk.
   *
   * @returns the active crawler's movement for this tick while they are
   *   walking, or null while the script holds them still.
   */
  tickWorld(active: Player, map: GameMap): MovementInput | null {
    for (;;) {
      const running = this.running ?? this.startNextCutscene();
      if (running === null) return null;
      const progress = running.progress;
      switch (progress.kind) {
        case 'unstarted':
          this.startStep(running, active, map);
          continue;
        case 'walking': {
          const move = this.steer(running, progress, active);
          if (move !== null) return move;
          continue;
        }
        case 'talking':
          // A talk ends by its own close; one another request pushed off the box ends here.
          if (this.deps.conversation.isActive(progress.handle)) return null;
          this.finishStep(running);
          continue;
        case 'waiting':
          progress.framesLeft--;
          if (progress.framesLeft > 0) return null;
          this.finishStep(running);
          continue;
        case 'movingCamera':
          if (this.camera.isMoving) return null;
          this.finishStep(running);
          continue;
      }
    }
  }

  /**
   * Drops every cutscene, running and queued, and lets go of the camera and
   * the shake, without completing any of them: a checkpoint restore rewinds
   * the world the scripts were written against, so their completions must not
   * fire into it.
   */
  resetForCheckpoint(): void {
    this.running = null;
    this.queue.length = 0;
    this.camera.release();
    this.shake.stop();
  }

  /** The scene is going away. */
  dispose(): void {
    this.resetForCheckpoint();
  }

  private startNextCutscene(): RunningCutscene<Action> | null {
    const next = this.queue.shift();
    if (next === undefined) return null;
    const running: RunningCutscene<Action> = { ...next, index: 0, progress: { kind: 'unstarted' } };
    this.running = running;
    running.onStart?.();
    return running;
  }

  private startStep(running: RunningCutscene<Action>, active: Player, map: GameMap): void {
    const step: CutsceneStep<Action> = running.script[running.index];
    switch (step.kind) {
      case 'walkTo':
        running.progress = {
          kind: 'walking',
          step,
          waypoints: this.pathTo(active, map, step.tile),
          frames: 0,
        };
        return;
      case 'conversation':
        running.progress = {
          kind: 'talking',
          handle: this.deps.conversation.open(this.talkRequest(running, step.request, true)),
        };
        return;
      case 'carolineMessage':
        running.progress = {
          kind: 'talking',
          handle: this.deps.conversation.open(
            this.talkRequest(
              running,
              { lines: [step.message.line], reward: null, questRelated: false },
              step.world === 'halts',
            ),
          ),
        };
        return;
      case 'daveTeleportOut':
        this.deps.teleportDaveOut();
        this.finishStep(running);
        return;
      case 'wait':
        running.progress = { kind: 'waiting', framesLeft: step.frames };
        return;
      case 'panCamera':
        this.camera.panTo(step.to, step.frames, active);
        running.progress = { kind: 'movingCamera' };
        return;
      case 'holdCamera':
        this.camera.hold(active);
        running.progress = { kind: 'waiting', framesLeft: step.frames };
        return;
      case 'returnCamera':
        this.camera.returnToLeader(step.frames, active);
        running.progress = { kind: 'movingCamera' };
        return;
      case 'shake':
        this.shake.start(step.profile);
        this.finishStep(running);
        return;
      case 'sound':
        this.deps.playSound(step.cue, step.at);
        this.finishStep(running);
        return;
      case 'run':
        this.deps.runWorldAction(step.action);
        this.finishStep(running);
        return;
      default: {
        const unhandled: never = step;
        throw new Error(`unhandled cutscene step ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /**
   * A talk the player must read to the end. Caroline's messages halt the
   * world only when their step says so; everything else said in a cutscene
   * does.
   */
  private talkRequest(
    running: RunningCutscene<Action>,
    talk: CutsceneTalk,
    haltsWorld: boolean,
  ): ConversationRequest {
    const index = running.index;
    return {
      ...talk,
      ending: {
        kind: 'close',
        onClosed: () => {
          if (this.running === running && running.index === index) this.finishStep(running);
        },
      },
      dismiss: { kind: 'blocked' },
      haltsWorld,
      anchor: null,
      locksKeyboard: true,
    };
  }

  /** The tiles to walk through, without the one already stood on; empty when there is no way there. */
  private pathTo(active: Player, map: GameMap, goal: CutsceneTile): CutsceneTile[] {
    const start = tileOf(active);
    const path = map.findPath(start.x, start.y, goal.x, goal.y, WALK_UP_MAX_PATH_TILES);
    const startsUnderfoot = path.length > 0 && path[0].x === start.x && path[0].y === start.y;
    if (startsUnderfoot) path.shift();
    return path;
  }

  /** Steers toward the next waypoint, or ends the walk where the crawler stands. */
  private steer(
    running: RunningCutscene<Action>,
    walk: Extract<StepProgress, { kind: 'walking' }>,
    active: Player,
  ): MovementInput | null {
    walk.frames++;
    while (walk.waypoints.length > 0) {
      const next = walk.waypoints[0];
      const dx = next.x * TILE_SIZE - active.x;
      const dy = next.y * TILE_SIZE - active.y;
      const distance = Math.hypot(dx, dy);
      if (distance <= WAYPOINT_REACHED_PX) {
        walk.waypoints.shift();
        continue;
      }
      if (walk.frames > WALK_UP_TIMEOUT_FRAMES) break;
      return { dx: dx / distance, dy: dy / distance, isMobile: true };
    }
    face(active, walk.step.face);
    this.finishStep(running);
    return null;
  }

  private finishStep(running: RunningCutscene<Action>): void {
    running.index++;
    running.progress = { kind: 'unstarted' };
    if (running.index < running.script.length) return;
    this.running = null;
    this.camera.release();
    running.onComplete?.();
  }
}
