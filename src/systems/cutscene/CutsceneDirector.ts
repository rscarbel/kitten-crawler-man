import { TILE_SIZE } from '../../core/constants';
import type { Conversation } from '../../dialog/Conversation';
import type { ConversationHandle, ConversationRequest } from '../../dialog/request';
import type { GameMap } from '../../map/GameMap';
import type { Player } from '../../Player';
import { pixelToTile } from '../../utils';
import type { MovementInput } from '../GameLoopPhases';
import type {
  CutsceneFacing,
  CutsceneScript,
  CutsceneStep,
  CutsceneTalk,
  CutsceneTile,
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
export interface CutsceneDirectorDeps {
  /** The scene's one conversation, which every talk in a cutscene opens on. */
  readonly conversation: Conversation;
  /** Takes Dave out of the room he is standing in. */
  readonly teleportDaveOut: () => void;
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
  | { readonly kind: 'waiting'; framesLeft: number };

interface RunningCutscene {
  readonly script: CutsceneScript;
  readonly onComplete: (() => void) | null;
  index: number;
  progress: StepProgress;
}

interface QueuedCutscene {
  readonly script: CutsceneScript;
  readonly onComplete: (() => void) | null;
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
 * a message from Caroline, the guide leaving, a pause. One per scene, built by
 * `CutsceneKit`.
 *
 * Steps start only on a world tick, so nothing a script opens can land on top
 * of the pause menu; a walk and a wait advance with the world and so stop
 * under it. A talk halts the world itself, and ends its step the moment its
 * last page is read.
 *
 * Cutscenes asked for while one plays wait their turn.
 */
export class CutsceneDirector {
  private running: RunningCutscene | null = null;
  private readonly queue: QueuedCutscene[] = [];

  constructor(private readonly deps: CutsceneDirectorDeps) {}

  /** The one flag the rest of the game asks: while true, a script owns the party and input. */
  get isActive(): boolean {
    return this.running !== null || this.queue.length > 0;
  }

  /** Plays `script` now, or after the cutscenes already waiting; `onComplete` runs once its last step ends. */
  play(script: CutsceneScript, onComplete?: () => void): void {
    this.queue.push({ script, onComplete: onComplete ?? null });
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
      }
    }
  }

  /** Drops every cutscene, running and queued, without completing them: the scene is going away. */
  dispose(): void {
    this.running = null;
    this.queue.length = 0;
  }

  private startNextCutscene(): RunningCutscene | null {
    const next = this.queue.shift();
    if (next === undefined) return null;
    this.running = { ...next, index: 0, progress: { kind: 'unstarted' } };
    return this.running;
  }

  private startStep(running: RunningCutscene, active: Player, map: GameMap): void {
    const step: CutsceneStep = running.script[running.index];
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
              false,
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
      default: {
        const unhandled: never = step;
        throw new Error(`unhandled cutscene step ${JSON.stringify(unhandled)}`);
      }
    }
  }

  /**
   * A talk the player must read to the end. Caroline's messages do not halt
   * the world; everything else said in a cutscene does.
   */
  private talkRequest(
    running: RunningCutscene,
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
    running: RunningCutscene,
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

  private finishStep(running: RunningCutscene): void {
    running.index++;
    running.progress = { kind: 'unstarted' };
    if (running.index < running.script.length) return;
    this.running = null;
    running.onComplete?.();
  }
}
