import type { CarolineMessage } from '../../dialog/caroline';
import type { NonEmpty } from '../../dialog/line';
import type { ConversationRequest } from '../../dialog/request';

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

export type CutsceneStep =
  | WalkToStep
  | { readonly kind: 'conversation'; readonly request: CutsceneTalk }
  | { readonly kind: 'carolineMessage'; readonly message: CarolineMessage }
  | { readonly kind: 'daveTeleportOut' }
  | { readonly kind: 'wait'; readonly frames: number };

/** A whole cutscene, run in order. */
export type CutsceneScript = NonEmpty<CutsceneStep>;
