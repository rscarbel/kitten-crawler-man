import type { CueSlot } from '../../audio/cueSlot';
import type { JingleId } from '../../audio/sounds';
import type { CarolineMessage } from '../../dialog/caroline';
import type { NonEmpty } from '../../dialog/line';
import type { ConversationRequest } from '../../dialog/request';
import type { CutscenePoint } from './cutsceneCamera';
import type { ShakeProfileId } from './cutsceneShake';

/** Which way a crawler turns once a walk ends: toward whoever they walked up to. */
export type CutsceneFacing = 'up' | 'down' | 'left' | 'right';

/** A map tile, in tile coordinates. */
export interface CutsceneTile {
  readonly x: number;
  readonly y: number;
}

/**
 * What a cutscene's talk says. How it is held is the director's to decide,
 * not the script's: a talk always halts the world, can never be dismissed or
 * walked away from, and ends the step when its last page is read.
 */
export type CutsceneTalk = Pick<ConversationRequest, 'lines' | 'reward' | 'questRelated'>;

/**
 * Whether the world goes on under one of Caroline's messages. She usually
 * speaks over play still running; a message that must freeze everyone where
 * they stand, mobs included, says so.
 */
export type CarolineMessageWorld = 'runs' | 'halts';

/**
 * The crawler the player is steering, whichever that is when the step runs.
 * Every other actor a script names is registered by the playing scene under
 * an id of its own union.
 */
export const ACTIVE_CRAWLER = 'activeCrawler' as const;

/** Who a step moves or hides: the active crawler, or an actor the scene registered as `ActorId`. */
export type CutsceneActorRef<ActorId extends string = never> = typeof ACTIVE_CRAWLER | ActorId;

/**
 * Whether a move holds the script until it ends, or sets the actor off and
 * runs the next step at once, so two bodies can move together. A move left
 * running is joined later by an `awaitActor` step, and a script that ends
 * first snaps it to its end.
 */
export type CutsceneMoveThen = 'waitForArrival' | 'carryOn';

/**
 * Walk an actor to `tile` by the pathfinder, with their own mobility class,
 * then turn them to `face`. The active crawler is the player's own body and is
 * never teleported: blocked or out of time, they stop where they stand. Every
 * other actor is set down on the tile instead, so a script never hangs on a
 * walk.
 */
export interface WalkToStep<ActorId extends string = never> {
  readonly kind: 'walkTo';
  readonly who: CutsceneActorRef<ActorId>;
  readonly tile: CutsceneTile;
  readonly face: CutsceneFacing;
  readonly then: CutsceneMoveThen;
}

/**
 * Carries an actor in a straight line to `to`, in world pixels, over
 * `frames` world ticks, through walls and over the floor: a drop from above,
 * a body thrown aside, a crawler lifted away. `face` turns them as they set
 * off; null leaves their facing alone.
 */
export interface GlideToStep<ActorId extends string = never> {
  readonly kind: 'glideTo';
  readonly who: CutsceneActorRef<ActorId>;
  readonly to: CutscenePoint;
  readonly frames: number;
  readonly face: CutsceneFacing | null;
  readonly then: CutsceneMoveThen;
}

/**
 * A change to the world a scene makes on a script's behalf. Each scene that
 * plays cutscenes owns its own union of these and runs them in one exhaustive
 * switch, so a new kind is one union member and one switch arm in that scene.
 */
export interface CutsceneWorldAction {
  readonly kind: string;
}

/** The takes a `sound` step picks from, one at random; empty stays silent. */
export type CutsceneSoundCue = Pick<CueSlot<string>, 'takes'>;

/**
 * A jingle whose own audio clock a script can wait on. Its group must already
 * be decoded where the script plays: a cue that cannot start this instant is
 * not queued, and the steps waiting on it count world ticks instead.
 */
export type CutsceneTimedCue = JingleId;

/**
 * One step of a cutscene. `Action` is the playing scene's world-action union;
 * a scene with none leaves it `never`, and a `run` step cannot be written for
 * it. `ActorId` is the scene's actor ids; with none, only the active crawler
 * can be named.
 */
export type CutsceneStep<
  Action extends CutsceneWorldAction = never,
  ActorId extends string = never,
> =
  | WalkToStep<ActorId>
  | GlideToStep<ActorId>
  /** Holds the script until the move `who` was set off on ends; moves straight on when none is running. */
  | { readonly kind: 'awaitActor'; readonly who: CutsceneActorRef<ActorId> }
  /**
   * Takes an actor out of sight until a `showActor` step, past the end of the
   * script; the scene's render pass asks the director which bodies it hides.
   * Hidden is only unseen: the actor is still in the world.
   */
  | { readonly kind: 'hideActor'; readonly who: CutsceneActorRef<ActorId> }
  | { readonly kind: 'showActor'; readonly who: CutsceneActorRef<ActorId> }
  /**
   * Eases the full-screen fade from where it stands to `to` (0 clear, 1
   * black) over `frames` world ticks, holding the script until it gets there.
   * A script that ends black stays black for a moment, long enough for the
   * scene change it hands over to, then clears on its own.
   */
  | { readonly kind: 'fade'; readonly to: number; readonly frames: number }
  /** Starts `cue` from its top and restarts its clock, then moves straight on. */
  | { readonly kind: 'playCue'; readonly cue: CutsceneTimedCue }
  /**
   * Holds the script until `cue`, started by a `playCue` step, has played
   * `atS` seconds, read off the audio clock so a step lands on a hit in the
   * recording. Moves straight on when the cue was never started.
   */
  | { readonly kind: 'waitForCue'; readonly cue: CutsceneTimedCue; readonly atS: number }
  | { readonly kind: 'conversation'; readonly request: CutsceneTalk }
  /**
   * A talk that does not hold the script: the world runs under it and the
   * next step starts at once. For lines spoken over steps timed to a cue,
   * which a talk that halts and holds would push off their marks. Read to its
   * end before the next talk opens with an `awaitAside`, or that talk takes
   * the box from it.
   */
  | { readonly kind: 'aside'; readonly request: CutsceneTalk }
  /** Holds the script until the last `aside` has been read; moves straight on when it has. */
  | { readonly kind: 'awaitAside' }
  | {
      readonly kind: 'carolineMessage';
      readonly message: CarolineMessage;
      readonly world: CarolineMessageWorld;
    }
  | { readonly kind: 'daveTeleportOut' }
  | { readonly kind: 'wait'; readonly frames: number }
  /** Lerps the camera from wherever it is now to `to`, then holds it there. */
  | { readonly kind: 'panCamera'; readonly to: CutscenePoint; readonly frames: number }
  /** Keeps the camera where it is for `frames` world ticks. */
  | { readonly kind: 'holdCamera'; readonly frames: number }
  /**
   * Lerps the camera back onto the leader and lets it follow them again. A
   * script that ends without one hands the camera straight back.
   */
  | { readonly kind: 'returnCamera'; readonly frames: number }
  /** Starts a screen shake and moves straight on; the shake dies away on its own. */
  | { readonly kind: 'shake'; readonly profile: ShakeProfileId }
  /** Plays one take of `cue`, from `at` in the world or, when null, from nowhere in particular. */
  | { readonly kind: 'sound'; readonly cue: CutsceneSoundCue; readonly at: CutscenePoint | null }
  /** Has the scene change the world, and moves straight on. */
  | { readonly kind: 'run'; readonly action: Action };

/** A whole cutscene, run in order. */
export type CutsceneScript<
  Action extends CutsceneWorldAction = never,
  ActorId extends string = never,
> = NonEmpty<CutsceneStep<Action, ActorId>>;

/** The world-action runner of a scene that has no world actions. */
export function noWorldActions(action: never): never {
  throw new Error(`no world actions in this scene: ${JSON.stringify(action)}`);
}
