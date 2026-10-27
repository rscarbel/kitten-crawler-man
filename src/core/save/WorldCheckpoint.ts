import type { GameMapCheckpoint } from '../../map/GameMap';
import type { AttackCowStateCheckpoint } from '../state/AttackCowState';
import type { ArenaCheckpoint } from '../../systems/ArenaSystem';
import type { ArenaRoomCheckpoint } from '../../systems/ArenaRoomSystem';
import type { BarrierCheckpoint } from '../../systems/BarrierSystem';
import type { BopcaCheckpoint } from '../../systems/BopcaSystem';
import type { BossRoomCheckpoint } from '../../systems/BossRoomSystem';
import type { BossRoomDressingCheckpoint } from '../../systems/bossRooms/bossRoomDressingCheckpoint';
import type { BountyCheckpoint } from '../../systems/BountySystem';
import type { DefendQuestCheckpoint } from '../../systems/DefendQuestSystem';
import type { CloggedBathroomCheckpoint } from '../../systems/cloggedBathroom/cloggedBathroomCheckpoint';
import type { StealthKeySnatchCheckpoint } from '../../systems/stealthKeySnatch/stealthKeySnatchCheckpoint';
import type { DestructionCheckpoint } from '../../systems/kits/DestructionKit';
import type { DifficultyTelemetryCheckpoint } from '../../systems/DifficultyTelemetrySystem';
import type { DoomsdayEscapeCheckpoint } from '../../systems/DoomsdayEscapeSystem';
import type { MercenaryCheckpoint } from '../../systems/MercenarySystem';
import type { MiniMapCheckpoint } from '../../systems/MiniMapSystem';
import type { MongoCheckpoint } from '../../systems/MongoSystem';
import type { MurderMysteryQuestCheckpoint } from '../../systems/MurderMysteryQuestSystem';
import type { RecallCheckpoint } from '../../systems/RecallSystem';
import type { SpiderQuestCheckpoint } from '../../systems/SpiderQuestSystem';
import type { StairwellCheckpoint } from '../../systems/StairwellSystem';
import type { TreasureChestCheckpoint } from '../../systems/TreasureChestSystem';
import type { TreeCheckpoint } from '../../systems/TreeSystem';
import type { ShopStockSnapshot } from '../../economy/shopStock';
import type { BountyProgressCheckpoint } from '../quests/BountyProgress';
import type { StarlightTentProgressCheckpoint } from '../state/StarlightTentProgress';
import type { AnchorQuestProgressCheckpoint } from '../quests/AnchorQuestProgress';
import type { CasinoStateCheckpoint } from '../club/CasinoState';
import type { TownMemoryCheckpoint } from '../state/TownMemory';
import type { GameStatsSnapshot } from '../progression/GameStats';
import type { MercenaryRosterCheckpoint } from '../party/MercenaryRoster';
import type { MongoPetStateCheckpoint } from '../state/MongoPetState';
import type { MurderQuestProgressCheckpoint } from '../quests/MurderQuestProgress';
import type { JournalProgressCheckpoint } from '../quests/JournalProgress';
import type { BriarHollowStateSnapshot } from '../quests/briarHollowState';

/**
 * Everything about the floor — and the run — that a safe-room checkpoint has to
 * be able to put back.
 *
 * The party half of a checkpoint lives in {@link LevelCheckpoint}; this is the
 * other half. The split matters because the two are captured from opposite
 * directions: a player snapshot is a value copied out of the crawler, while
 * almost everything here is a system asked to describe itself, since the state
 * is spread across thirty-odd owners that each know their own invariants.
 *
 * A field is nullable exactly when its system is optional on the floor — trees
 * only grow on the overworld, bounties only exist where Shady is.
 */
export interface WorldCheckpoint {
  gameMap: GameMapCheckpoint;
  gameStats: GameStatsSnapshot;

  bossRoom: BossRoomCheckpoint;
  arena: ArenaCheckpoint;
  arenaRoom: ArenaRoomCheckpoint;
  /** The props, slow ground and room hazards each boss room changes during its fight. */
  bossRoomDressing: BossRoomDressingCheckpoint;
  barriers: BarrierCheckpoint;
  miniMap: MiniMapCheckpoint;
  stairwell: StairwellCheckpoint;
  /**
   * The Wayfinder's Anchor's cooldown alone. The live channel is dropped by
   * the restore rather than captured — see `RecallSystem`.
   */
  recall: RecallCheckpoint;
  treasureChests: TreasureChestCheckpoint;
  bopca: BopcaCheckpoint;
  difficultyTelemetry: DifficultyTelemetryCheckpoint;
  mercenary: MercenaryCheckpoint;
  mongo: MongoCheckpoint;

  defendQuest: DefendQuestCheckpoint;
  /** Where the bathroom quest stands and whether its explainer was seen; the board's turns are not kept. */
  cloggedBathroom: CloggedBathroomCheckpoint;
  /** Where the stealth gate's key quest stands; the gate itself is in `gameMap`. */
  stealthKeySnatch: StealthKeySnatchCheckpoint;
  spiderQuest: SpiderQuestCheckpoint;
  murderQuest: MurderMysteryQuestCheckpoint;
  doomsdayEscape: DoomsdayEscapeCheckpoint;

  /** Floor loot and smashable props together — what the destruction kit owns. */
  destruction: DestructionCheckpoint;
  trees: TreeCheckpoint | null;
  bounty: BountyCheckpoint | null;

  /**
   * The run-scoped objects threaded by reference through every scene. Rewinding
   * them is what stops a death refunding the coins for a purchase while leaving
   * the goods bought.
   */
  starlightTentProgress: StarlightTentProgressCheckpoint;
  anchorQuestProgress: AnchorQuestProgressCheckpoint;
  murderQuestProgress: MurderQuestProgressCheckpoint;
  journal: JournalProgressCheckpoint;
  bountyProgress: BountyProgressCheckpoint;
  casinoState: CasinoStateCheckpoint;
  shopStock: ShopStockSnapshot;
  townMemory: TownMemoryCheckpoint;
  mercenaryRoster: MercenaryRosterCheckpoint;
  mongoPetState: MongoPetStateCheckpoint;
  /** The human crawler's attack cow: owned, her health and her rest, rewound like Mongo's. */
  attackCowState: AttackCowStateCheckpoint;
  /** Briar Hollow's quest, structures and soldier orders. Empty on every floor but 3. */
  briarHollow: BriarHollowStateSnapshot;

  /**
   * One-time kill latches the scene owns directly rather than through a system.
   * `krakarenKilled` and `bigRoosterKilled` record each boss's defeat, which
   * the music library reads; Big Rooster's also gates the Pecking Order
   * achievement.
   */
  krakarenKilled: boolean;
  bigRoosterKilled: boolean;
  bigRoosterBossRoomIdx: number;
}
