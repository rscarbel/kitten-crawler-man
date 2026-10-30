import type { TileRect } from '../map/town/townPlan';
import type { FloodedPumpRoomIntroBeat } from '../systems/bossRooms/floodedPumpRoom/floodedPumpRoomState';
import type { CaptureScriptActorId } from '../systems/missingCats/captureCutscene';

/**
 * Who a dungeon's scripts can name besides the active crawler: either crawler,
 * by kind, and the bodies the capture at the fountain stages for its scene.
 */
export type DungeonActorId = CaptureScriptActorId;

/**
 * The changes to the world a cutscene's `run` step can ask `DungeonScene` for,
 * each kind by what it carries. A new kind is one entry here and one handler
 * in the scene's {@link DungeonWorldActionHost}, which fails to compile until
 * the handler exists.
 */
interface DungeonWorldActionPayloads {
  /**
   * Sets every crawler, companion and hireling down inside `target`, standing
   * anyone who was down back up, without a sound or an animation.
   */
  readonly gatherParty: { readonly target: TileRect };
  /** One beat of the Kraken's flooded pump room's intro, carried out by the room. */
  readonly floodedPumpRoom: { readonly beat: FloodedPumpRoomIntroBeat };
}

type DungeonWorldActionKind = keyof DungeonWorldActionPayloads;

type DungeonWorldActionOf<Kind extends DungeonWorldActionKind> = {
  readonly kind: Kind;
} & DungeonWorldActionPayloads[Kind];

/** A world change a dungeon cutscene runs. */
export type DungeonWorldAction = {
  [Kind in DungeonWorldActionKind]: DungeonWorldActionOf<Kind>;
}[DungeonWorldActionKind];

/** What the dungeon does for each world action, one handler per kind. */
export type DungeonWorldActionHost = {
  readonly [Kind in DungeonWorldActionKind]: (action: DungeonWorldActionOf<Kind>) => void;
};

export function runDungeonWorldAction<Kind extends DungeonWorldActionKind>(
  action: DungeonWorldActionOf<Kind>,
  host: DungeonWorldActionHost,
): void {
  const handler: (action: DungeonWorldActionOf<Kind>) => void = host[action.kind];
  handler(action);
}
