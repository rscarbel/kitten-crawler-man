import type { GameProgressInput } from '../auth/AuthClient';
import type { SavePoint } from '../core/save/SavePoint';
import type { WorldCheckpoint } from '../core/save/WorldCheckpoint';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { Mob } from '../creatures/Mob';
import type { FairyRoomLedger } from '../levels/fairySpawner';
import type { TilePoint } from '../map/town/townPlan';
import type { MordecaiDebriefCheckpoint } from '../systems/mordecaiDebrief';

/**
 * A dungeon floor held aside while the party is inside one of its buildings,
 * and handed to the scene rebuilt at the door on the way out.
 *
 * The overworld can be regenerated around a party walking out of a shop; a
 * dungeon floor cannot, because its population and every room on it are the
 * record of what the party has done there. So the scene that is left hands
 * over the live objects that hold that record — the two crawlers and every
 * creature, corpses included — together with a checkpoint of every system,
 * and the rebuilt scene applies the checkpoint to its fresh systems instead of
 * spawning a new floor.
 *
 * In memory only. A reload inside the building resumes from the save the
 * floor wrote at the door.
 */
export interface DungeonInteriorReturn {
  /** The crawlers every held creature and system points at; restored from the interior's snapshots. */
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  /**
   * The floor's population as it stood at the door, less the creatures a
   * system stands up in its own constructor: the rebuilt system stands those
   * up again and its checkpoint seats them.
   */
  readonly mobs: readonly Mob[];
  /** Which rooms got fairies, so the rebuilt fairy system knows the ones it already placed. */
  readonly fairyLedger: FairyRoomLedger | null;
  /** Every system's durable state at the door. */
  readonly world: WorldCheckpoint;
  /**
   * The collapse clock at the door. No frame is spent indoors, so this is
   * exactly what the clock reads again on the way out.
   */
  readonly levelTimerFrames: number;
  /** Where the party stands on the way out: the tile in front of the door. */
  readonly returnTile: TilePoint;
  /**
   * The save a death returns to, its checkpoint included: the checkpoint's mob
   * flags live on the creatures in {@link mobs}, which come back unchanged.
   */
  readonly lastSave: SavePoint | null;
  readonly lastSavePointTile: TilePoint | null;
  readonly staleCarriedSave: GameProgressInput | null;
  /** The floor's starting occupancy, which a stairwell room's entry save is gated on. */
  readonly roomsClearAtFloorStart: ReadonlySet<number>;
  /** Stairwell rooms that already took their one save. */
  readonly stairwellRoomsSaved: ReadonlySet<number>;
  /** What Mordecai has already said after each boss. */
  readonly mordecaiDebrief: MordecaiDebriefCheckpoint;
}
