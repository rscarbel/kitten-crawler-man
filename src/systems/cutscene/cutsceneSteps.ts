import type { CueSlot } from '../../audio/cueSlot';
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

/** Walk the active crawler to `tile` by the pathfinder, then turn them to `face`. */
export interface WalkToStep {
  readonly kind: 'walkTo';
  readonly who: 'activeCrawler';
  readonly tile: CutsceneTile;
  readonly face: CutsceneFacing;
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
 * One step of a cutscene. `Action` is the playing scene's world-action union;
 * a scene with none leaves it `never`, and a `run` step cannot be written for it.
 */
export type CutsceneStep<Action extends CutsceneWorldAction = never> =
  | WalkToStep
  | { readonly kind: 'conversation'; readonly request: CutsceneTalk }
  | { readonly kind: 'carolineMessage'; readonly message: CarolineMessage }
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
export type CutsceneScript<Action extends CutsceneWorldAction = never> = NonEmpty<
  CutsceneStep<Action>
>;

/** The world-action runner of a scene that has no world actions. */
export function noWorldActions(action: never): never {
  throw new Error(`no world actions in this scene: ${JSON.stringify(action)}`);
}
