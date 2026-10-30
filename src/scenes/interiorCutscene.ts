import type { ResidentId } from '../core/state/residentIds';
import type { CatAllyId } from '../core/party/partySplit';
import type { CrawlerKind } from '../core/skills/SkillManager';
import type { CutsceneTile } from '../systems/cutscene/cutsceneSteps';

/**
 * Who an interior's scripts can name besides the active crawler: either
 * crawler by kind, any resident standing in the room, and a cat ally the
 * room holds.
 */
export type InteriorActorId = CrawlerKind | ResidentActorId | CatAllyId;

/** The id a resident is lent to an interior's scripts under. */
export type ResidentActorId = `resident:${ResidentId}`;

export function residentActorId(resident: ResidentId): ResidentActorId {
  return `resident:${resident}`;
}

/**
 * The changes to the world a cutscene's `run` step can ask
 * `BuildingInteriorScene` for, each kind by what it carries. A new kind is one
 * entry here and one handler in the scene's {@link InteriorWorldActionHost},
 * which fails to compile until the handler exists.
 */
interface InteriorWorldActionPayloads {
  /** Stands the steered crawler on `tile` and the other beside them, without a sound or a step. */
  readonly setPartyDown: { readonly tile: CutsceneTile };
  /** Swings the room's cellar lid open or shut; a room has the one. */
  readonly cellarHatch: { readonly swing: 'open' | 'shut' };
}

type InteriorWorldActionKind = keyof InteriorWorldActionPayloads;

type InteriorWorldActionOf<Kind extends InteriorWorldActionKind> = {
  readonly kind: Kind;
} & InteriorWorldActionPayloads[Kind];

/** A world change an interior cutscene runs. */
export type InteriorWorldAction = {
  [Kind in InteriorWorldActionKind]: InteriorWorldActionOf<Kind>;
}[InteriorWorldActionKind];

/** What the interior does for each world action, one handler per kind. */
export type InteriorWorldActionHost = {
  readonly [Kind in InteriorWorldActionKind]: (action: InteriorWorldActionOf<Kind>) => void;
};

export function runInteriorWorldAction<Kind extends InteriorWorldActionKind>(
  action: InteriorWorldActionOf<Kind>,
  host: InteriorWorldActionHost,
): void {
  const handler: (action: InteriorWorldActionOf<Kind>) => void = host[action.kind];
  handler(action);
}
