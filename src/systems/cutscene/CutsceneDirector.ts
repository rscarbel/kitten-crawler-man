import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../../core/constants';
import type { Conversation } from '../../dialog/Conversation';
import type { ConversationHandle, ConversationRequest } from '../../dialog/request';
import type { GameMap } from '../../map/GameMap';
import type { Player } from '../../Player';
import { pixelToTile } from '../../utils';
import type { MovementInput } from '../GameLoopPhases';
import {
  CutsceneActorRegistry,
  FACING_VECTORS,
  type CutsceneActor,
  type CutsceneHeading,
} from './cutsceneActors';
import { CutsceneCamera, type CutscenePoint } from './cutsceneCamera';
import { CutsceneFade } from './cutsceneFade';
import { CutsceneShake } from './cutsceneShake';
import {
  ACTIVE_CRAWLER,
  type CutsceneActorRef,
  type CutsceneFacing,
  type CutsceneScript,
  type CutsceneSoundCue,
  type CutsceneStep,
  type CutsceneTalk,
  type CutsceneTile,
  type CutsceneTimedCue,
  type CutsceneWorldAction,
  type GlideToStep,
  type WalkToStep,
} from './cutsceneSteps';

/** About four seconds: longer than any walk across a room, short enough that a stuck walk is not felt. */
export const WALK_UP_TIMEOUT_FRAMES = 240;

/** The furthest a walk-up searches for its path; a speaker further off is talked to from where the crawler stands. */
export const WALK_UP_MAX_PATH_TILES = 24;

/**
 * How much longer than the path takes at their own pace an actor other than
 * the active crawler may walk before they are set down at the end: room for
 * corners and bodies in the way, never for a walk that is not getting there.
 */
const SCRIPTED_WALK_TIME_SLACK = 2;

/** How near a waypoint, as a share of a tile, the crawler must come before steering for the next one. */
const WAYPOINT_REACHED_TILE_FRACTION = 0.25;
const WAYPOINT_REACHED_PX = TILE_SIZE * WAYPOINT_REACHED_TILE_FRACTION;

/**
 * How far past its mark a cue wait may run, counted in world ticks, before it
 * stops trusting an audio clock that is not moving: a context the browser
 * suspended would otherwise hold the script for good.
 */
export const CUE_CLOCK_STALL_GRACE_S = 2;

/** What a scene plays a script's timed cues on. */
export interface CutsceneCueClock {
  /**
   * Starts `cue` this instant, `fromS` seconds into its recording, and
   * returns the audio-clock second it began at; null when it could not start now.
   */
  readonly start: (cue: CutsceneTimedCue, fromS: number) => number | null;
  /** The audio clock, in seconds; null in a scene with no audio. */
  readonly nowS: () => number | null;
}

/** The cue clock of a scene with no audio: every timed wait counts world ticks. */
export const SILENT_CUE_CLOCK: CutsceneCueClock = { start: () => null, nowS: () => null };

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
  readonly cueClock: CutsceneCueClock;
}

/** Where the step being run has got to. */
type StepProgress<ActorId extends string> =
  | { readonly kind: 'unstarted' }
  | { readonly kind: 'awaitingMove'; readonly who: CutsceneActorRef<ActorId> }
  | { readonly kind: 'talking'; readonly handle: ConversationHandle }
  | { readonly kind: 'waiting'; framesLeft: number }
  | { readonly kind: 'movingCamera' }
  | { readonly kind: 'fading' }
  | { readonly kind: 'waitingForCue'; readonly cue: CueStart; readonly atS: number };

/** One move under way, of the actor it is keyed by. */
type ActorMove<ActorId extends string> =
  | {
      readonly kind: 'walk';
      readonly step: WalkToStep<ActorId>;
      readonly waypoints: CutsceneTile[];
      readonly timeoutFrames: number;
      frames: number;
    }
  | {
      readonly kind: 'glide';
      readonly step: GlideToStep<ActorId>;
      readonly from: CutscenePoint;
      frames: number;
    };

/**
 * Where a timed cue's recording began, on the audio clock when it really
 * started and on the director's ticks: a cue started partway in is dated
 * back to where its top would have been.
 */
interface CueStart {
  readonly atAudioS: number | null;
  readonly atTick: number;
}

interface QueuedCutscene<Action extends CutsceneWorldAction, ActorId extends string> {
  readonly script: CutsceneScript<Action, ActorId>;
  readonly onComplete: (() => void) | null;
  readonly onStart: (() => void) | null;
}

interface RunningCutscene<
  Action extends CutsceneWorldAction,
  ActorId extends string,
> extends QueuedCutscene<Action, ActorId> {
  index: number;
  progress: StepProgress<ActorId>;
}

/**
 * The body a move steers this tick: the active crawler, whom the scene walks
 * with its own movement phase, or an actor the scene lent the script.
 */
type MovedBody = { readonly kind: 'active'; readonly player: Player } | CutsceneActor;

function tileOf(at: CutscenePoint): CutsceneTile {
  return { x: pixelToTile(at.x), y: pixelToTile(at.y) };
}

function tilePoint(tile: CutsceneTile): CutscenePoint {
  return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
}

function facePlayer(player: Player, facing: CutsceneFacing): void {
  const vector = FACING_VECTORS[facing];
  player.facingX = vector.dx;
  player.facingY = vector.dy;
}

function isActiveBody(
  body: MovedBody,
): body is { readonly kind: 'active'; readonly player: Player } {
  return 'kind' in body;
}

function positionOf(body: MovedBody): CutscenePoint {
  return isActiveBody(body) ? { x: body.player.x, y: body.player.y } : body.position();
}

function placeBody(body: MovedBody, at: CutscenePoint): void {
  if (isActiveBody(body)) {
    body.player.x = at.x;
    body.player.y = at.y;
    return;
  }
  body.place(at);
}

function faceBody(body: MovedBody, facing: CutsceneFacing): void {
  if (isActiveBody(body)) facePlayer(body.player, facing);
  else body.face(facing);
}

/**
 * Runs scripted moments in which a script owns the party: walks and glides of
 * the active crawler and of any actor the scene registers in {@link actors},
 * talks, Caroline's messages, the guide leaving, pauses, camera moves and
 * shakes, a full-screen fade, sounds, waits timed to a cue's own clock, and
 * the playing scene's own world actions. One per scene, built by
 * `CutsceneKit`.
 *
 * Steps start only on a world tick, so nothing a script opens can land on top
 * of the pause menu; a move, a wait, a fade and a camera move advance with the
 * world and so stop under it. A talk halts the world itself, and ends its
 * step the moment its last page is read.
 *
 * Cutscenes asked for while one plays wait their turn.
 */
export class CutsceneDirector<
  Action extends CutsceneWorldAction = never,
  ActorId extends string = never,
> {
  /** The actors this scene lends its scripts, by the ids its scripts name them with. */
  readonly actors = new CutsceneActorRegistry<ActorId>();
  private running: RunningCutscene<Action, ActorId> | null = null;
  private readonly queue: QueuedCutscene<Action, ActorId>[] = [];
  private readonly camera = new CutsceneCamera();
  private readonly shake = new CutsceneShake();
  private readonly fade = new CutsceneFade();
  private readonly moves = new Map<CutsceneActorRef<ActorId>, ActorMove<ActorId>>();
  /** Every actor the running script has moved, by body, to let go of when it ends. */
  private readonly held = new Map<object, CutsceneActor>();
  private readonly hidden = new Set<object>();
  private readonly cueStarts = new Map<CutsceneTimedCue, CueStart>();
  /** The last aside opened, until a script waits it out or the director is reset. */
  private aside: ConversationHandle | null = null;
  private ticks = 0;
  /** The crawler the player steered on the last world tick, whom a script that ends sets down too. */
  private lastActive: Player | null = null;

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
  play(
    script: CutsceneScript<Action, ActorId>,
    onComplete?: () => void,
    onStart?: () => void,
  ): void {
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

  /** How dark the cutscene's full-screen fade is, 0 to 1; `CutsceneKit` mounts the surface that draws it. */
  get fadeAlpha(): number {
    return this.fade.alpha;
  }

  /**
   * Whether a script has taken `body` out of sight. The scene's render pass
   * leaves out every body this answers true for.
   */
  hides(body: object): boolean {
    return this.hidden.has(body);
  }

  /**
   * One world tick of the camera, the shake and the fade. Run on every world
   * tick, cutscene or not, ahead of {@link tickWorld}, since a shake and a
   * dark screen outlive the script that started them.
   */
  tickEffects(): void {
    this.camera.tick();
    this.shake.tick();
    this.fade.tick(this.isActive);
  }

  /**
   * One world tick of the running cutscene. Starts whatever steps are due and
   * carries every move under way one tick on.
   *
   * @returns the active crawler's movement for this tick while a script walks
   *   them, or null while the script holds them still.
   */
  tickWorld(active: Player, map: GameMap): MovementInput | null {
    this.ticks++;
    this.lastActive = active;
    this.advanceSteps(active, map);
    return this.tickMoves(active);
  }

  /**
   * Drops every cutscene, running and queued, and lets go of the camera, the
   * shake, the fade, every actor a script held or hid, and every cue clock,
   * without completing any of them: a checkpoint restore rewinds the world the
   * scripts were written against, so their completions must not fire into it.
   */
  resetForCheckpoint(): void {
    this.running = null;
    this.queue.length = 0;
    this.lastActive = null;
    this.moves.clear();
    this.releaseHeld();
    this.hidden.clear();
    this.cueStarts.clear();
    this.aside = null;
    this.camera.release();
    this.shake.stop();
    this.fade.clear();
  }

  /** The scene is going away. */
  dispose(): void {
    this.resetForCheckpoint();
  }

  private advanceSteps(active: Player, map: GameMap): void {
    for (;;) {
      const running = this.running ?? this.startNextCutscene();
      if (running === null) return;
      const progress = running.progress;
      switch (progress.kind) {
        case 'unstarted':
          this.startStep(running, active, map);
          continue;
        case 'awaitingMove':
          if (this.moves.has(progress.who)) return;
          this.finishStep(running);
          continue;
        case 'talking':
          // A talk ends by its own close; one another request pushed off the box ends here.
          if (this.deps.conversation.isActive(progress.handle)) return;
          this.finishStep(running);
          continue;
        case 'waiting':
          progress.framesLeft--;
          if (progress.framesLeft > 0) return;
          this.finishStep(running);
          continue;
        case 'movingCamera':
          if (this.camera.isMoving) return;
          this.finishStep(running);
          continue;
        case 'fading':
          if (this.fade.isMoving) return;
          this.finishStep(running);
          continue;
        case 'waitingForCue':
          if (!this.cueReached(progress.cue, progress.atS)) return;
          this.finishStep(running);
          continue;
      }
    }
  }

  private startNextCutscene(): RunningCutscene<Action, ActorId> | null {
    const next = this.queue.shift();
    if (next === undefined) return null;
    const running: RunningCutscene<Action, ActorId> = {
      ...next,
      index: 0,
      progress: { kind: 'unstarted' },
    };
    this.running = running;
    running.onStart?.();
    return running;
  }

  private startStep(running: RunningCutscene<Action, ActorId>, active: Player, map: GameMap): void {
    const step: CutsceneStep<Action, ActorId> = running.script[running.index];
    switch (step.kind) {
      case 'walkTo':
        this.startWalk(running, step, active, map);
        return;
      case 'glideTo':
        this.startGlide(running, step, active);
        return;
      case 'awaitActor':
        running.progress = { kind: 'awaitingMove', who: step.who };
        return;
      case 'hideActor':
      case 'showActor': {
        const body = this.bodyOf(step.who, active);
        if (body !== null && step.kind === 'hideActor') this.hidden.add(body);
        if (body !== null && step.kind === 'showActor') this.hidden.delete(body);
        this.finishStep(running);
        return;
      }
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
      case 'aside':
        this.aside = this.deps.conversation.open(this.asideRequest(step.request));
        this.finishStep(running);
        return;
      case 'awaitAside': {
        const aside = this.aside;
        this.aside = null;
        if (aside === null || !this.deps.conversation.isActive(aside)) {
          this.finishStep(running);
          return;
        }
        running.progress = { kind: 'talking', handle: aside };
        return;
      }
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
      case 'fade':
        this.fade.fadeTo(step.to, step.frames);
        running.progress = { kind: 'fading' };
        return;
      case 'sound':
        this.deps.playSound(step.cue, step.at);
        this.finishStep(running);
        return;
      case 'playCue': {
        const fromS = step.fromS ?? 0;
        const startedAtAudioS = this.deps.cueClock.start(step.cue, fromS);
        this.cueStarts.set(step.cue, {
          atAudioS: startedAtAudioS === null ? null : startedAtAudioS - fromS,
          atTick: this.ticks - fromS * WORLD_TICKS_PER_SECOND,
        });
        this.finishStep(running);
        return;
      }
      case 'waitForCue': {
        const cue = this.cueStarts.get(step.cue);
        if (cue === undefined) {
          this.finishStep(running);
          return;
        }
        running.progress = { kind: 'waitingForCue', cue, atS: step.atS };
        return;
      }
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
   * The body `who` names right now, or null for an actor the scene has not
   * lent the script or that is not in the world. An actor a script moves is
   * held from here until the script ends.
   */
  private resolve(who: CutsceneActorRef<ActorId>, active: Player): MovedBody | null {
    if (who === ACTIVE_CRAWLER) return { kind: 'active', player: active };
    const actor = this.actors.find(who);
    if (actor === null) return null;
    if (!this.held.has(actor.body)) {
      this.held.set(actor.body, actor);
      actor.hold(true);
    }
    return actor;
  }

  private bodyOf(who: CutsceneActorRef<ActorId>, active: Player): object | null {
    if (who === ACTIVE_CRAWLER) return active;
    return this.actors.find(who)?.body ?? null;
  }

  private startWalk(
    running: RunningCutscene<Action, ActorId>,
    step: WalkToStep<ActorId>,
    active: Player,
    map: GameMap,
  ): void {
    const body = this.resolve(step.who, active);
    if (body !== null) {
      const waypoints = this.pathFor(body, map, step.tile);
      const timeoutFrames = isActiveBody(body)
        ? WALK_UP_TIMEOUT_FRAMES
        : Math.max(
            WALK_UP_TIMEOUT_FRAMES,
            Math.ceil(
              ((waypoints.length * TILE_SIZE) / body.walkPxPerTick()[step.pace]) *
                SCRIPTED_WALK_TIME_SLACK,
            ),
          );
      this.moves.set(step.who, { kind: 'walk', step, waypoints, timeoutFrames, frames: 0 });
    }
    this.afterMoveStarted(running, step);
  }

  private startGlide(
    running: RunningCutscene<Action, ActorId>,
    step: GlideToStep<ActorId>,
    active: Player,
  ): void {
    const body = this.resolve(step.who, active);
    if (body !== null) {
      if (step.face !== null) faceBody(body, step.face);
      this.moves.set(step.who, { kind: 'glide', step, from: positionOf(body), frames: 0 });
    }
    this.afterMoveStarted(running, step);
  }

  private afterMoveStarted(
    running: RunningCutscene<Action, ActorId>,
    step: WalkToStep<ActorId> | GlideToStep<ActorId>,
  ): void {
    if (step.then === 'waitForArrival') running.progress = { kind: 'awaitingMove', who: step.who };
    else this.finishStep(running);
  }

  /**
   * The tiles to walk through, without the one already stood on; empty when
   * there is no way there. A walk-up of the active crawler searches only so
   * far; an actor's walk searches as far as any mob's path does.
   */
  private pathFor(body: MovedBody, map: GameMap, goal: CutsceneTile): CutsceneTile[] {
    const start = tileOf(positionOf(body));
    const path = isActiveBody(body)
      ? map.findPath(start.x, start.y, goal.x, goal.y, body.player.mobility, WALK_UP_MAX_PATH_TILES)
      : map.findPath(start.x, start.y, goal.x, goal.y, body.mobility);
    const startsUnderfoot = path.length > 0 && path[0].x === start.x && path[0].y === start.y;
    if (startsUnderfoot) path.shift();
    return path;
  }

  /** Carries every move one tick on, and returns the active crawler's step. */
  private tickMoves(active: Player): MovementInput | null {
    let activeMove: MovementInput | null = null;
    for (const [who, move] of this.moves) {
      const body = this.resolve(who, active);
      if (body === null) {
        this.moves.delete(who);
        continue;
      }
      if (move.kind === 'glide') {
        if (this.glide(body, move) === 'ended') this.moves.delete(who);
        continue;
      }
      const heading = this.steer(body, move);
      if (heading === null) this.moves.delete(who);
      if (isActiveBody(body)) {
        if (heading !== null) activeMove = { ...heading, isMobile: true };
      } else {
        body.walk(heading, move.step.pace);
      }
    }
    return activeMove;
  }

  /**
   * Steers toward the next waypoint. At the end of the path, or out of time,
   * the walk ends: the active crawler where they stand, any other actor set
   * down on the tile they were sent to.
   *
   * @returns this tick's heading, or null once the walk has ended.
   */
  private steer(
    body: MovedBody,
    walk: Extract<ActorMove<ActorId>, { kind: 'walk' }>,
  ): CutsceneHeading | null {
    walk.frames++;
    const at = positionOf(body);
    // An actor comes all the way onto their last tile, so the set-down that
    // ends their walk is never more than one of their own steps.
    const lastReachPx = isActiveBody(body)
      ? WAYPOINT_REACHED_PX
      : body.walkPxPerTick()[walk.step.pace];
    while (walk.waypoints.length > 0) {
      const next = walk.waypoints[0];
      const dx = next.x * TILE_SIZE - at.x;
      const dy = next.y * TILE_SIZE - at.y;
      const distance = Math.hypot(dx, dy);
      const reachPx = walk.waypoints.length === 1 ? lastReachPx : WAYPOINT_REACHED_PX;
      if (distance <= reachPx) {
        walk.waypoints.shift();
        continue;
      }
      if (walk.frames > walk.timeoutFrames) break;
      return { dx: dx / distance, dy: dy / distance };
    }
    if (!isActiveBody(body)) body.place(tilePoint(walk.step.tile));
    faceBody(body, walk.step.face);
    return null;
  }

  private glide(
    body: MovedBody,
    glide: Extract<ActorMove<ActorId>, { kind: 'glide' }>,
  ): 'gliding' | 'ended' {
    glide.frames++;
    const to = glide.step.to;
    const share = glide.step.frames <= 0 ? 1 : Math.min(1, glide.frames / glide.step.frames);
    placeBody(body, {
      x: glide.from.x + (to.x - glide.from.x) * share,
      y: glide.from.y + (to.y - glide.from.y) * share,
    });
    return share < 1 ? 'gliding' : 'ended';
  }

  private cueReached(cue: CueStart, atS: number): boolean {
    const tickSeconds = (this.ticks - cue.atTick) / WORLD_TICKS_PER_SECOND;
    if (tickSeconds >= atS + CUE_CLOCK_STALL_GRACE_S) return true;
    const nowS = this.deps.cueClock.nowS();
    if (cue.atAudioS === null || nowS === null) return tickSeconds >= atS;
    return nowS - cue.atAudioS >= atS;
  }

  /**
   * A talk the player must read to the end. Caroline's messages halt the
   * world only when their step says so; everything else said in a cutscene
   * does.
   */
  private talkRequest(
    running: RunningCutscene<Action, ActorId>,
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

  private asideRequest(talk: CutsceneTalk): ConversationRequest {
    return {
      ...talk,
      ending: {
        kind: 'close',
        onClosed: () => {
          // An aside holds no step, so its close has nothing to finish.
        },
      },
      dismiss: { kind: 'blocked' },
      haltsWorld: false,
      anchor: null,
      locksKeyboard: true,
    };
  }

  private finishStep(running: RunningCutscene<Action, ActorId>): void {
    running.index++;
    running.progress = { kind: 'unstarted' };
    if (running.index < running.script.length) return;
    this.running = null;
    this.finishMoves();
    this.camera.release();
    running.onComplete?.();
  }

  /** Sets every move still under way down at its end, and lets go of every actor the script held. */
  private finishMoves(): void {
    for (const move of this.moves.values()) {
      const who = move.step.who;
      const active = this.lastActive;
      const body: MovedBody | null =
        who === ACTIVE_CRAWLER
          ? active === null
            ? null
            : { kind: 'active', player: active }
          : this.actors.find(who);
      if (body === null) continue;
      if (move.kind === 'glide') {
        placeBody(body, move.step.to);
        continue;
      }
      if (!isActiveBody(body)) {
        body.place(tilePoint(move.step.tile));
        body.walk(null, move.step.pace);
      }
      faceBody(body, move.step.face);
    }
    this.moves.clear();
    this.releaseHeld();
  }

  private releaseHeld(): void {
    for (const actor of this.held.values()) actor.hold(false);
    this.held.clear();
  }
}
