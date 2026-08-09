import type { GameMapCheckpoint } from '../map/GameMap';
import type { ArenaCheckpoint } from '../systems/ArenaSystem';
import type { ArenaRoomCheckpoint } from '../systems/ArenaRoomSystem';
import type { BarrierCheckpoint } from '../systems/BarrierSystem';
import type { BopcaCheckpoint } from '../systems/BopcaSystem';
import type { BossRoomCheckpoint } from '../systems/BossRoomSystem';
import type { BountyCheckpoint } from '../systems/BountySystem';
import type { CircusQuestCheckpoint } from '../systems/CircusQuestSystem';
import type { DefendQuestCheckpoint } from '../systems/DefendQuestSystem';
import type { DestructionCheckpoint } from '../systems/kits/DestructionKit';
import type { DifficultyTelemetryCheckpoint } from '../systems/DifficultyTelemetrySystem';
import type { DoomsdayEscapeCheckpoint } from '../systems/DoomsdayEscapeSystem';
import type { JuicerRoomCheckpoint } from '../systems/JuicerRoomSystem';
import type { MercenaryCheckpoint } from '../systems/MercenarySystem';
import type { MiniMapCheckpoint } from '../systems/MiniMapSystem';
import type { MongoCheckpoint } from '../systems/MongoSystem';
import type { MurderMysteryQuestCheckpoint } from '../systems/MurderMysteryQuestSystem';
import type { RecallCheckpoint } from '../systems/RecallSystem';
import type { SafeRoomCheckpoint } from '../systems/SafeRoomSystem';
import type { SpiderQuestCheckpoint } from '../systems/SpiderQuestSystem';
import type { StairwellCheckpoint } from '../systems/StairwellSystem';
import type { TreasureChestCheckpoint } from '../systems/TreasureChestSystem';
import type { TreeCheckpoint } from '../systems/TreeSystem';
import type { MarketStockCheckpoint } from '../systems/market/MarketStock';
import type { BountyProgressCheckpoint } from './BountyProgress';
import type { CircusQuestProgressCheckpoint } from './CircusQuestProgress';
import type { AnchorQuestProgressCheckpoint } from './AnchorQuestProgress';
import type { ClubMembershipCheckpoint } from './ClubMembership';
import type { TownMemoryCheckpoint } from './TownMemory';
import type { GameStatsSnapshot } from './GameStats';
import type { MercenaryRosterCheckpoint } from './MercenaryRoster';
import type { MongoPetStateCheckpoint } from './MongoPetState';
import type { MurderQuestProgressCheckpoint } from './MurderQuestProgress';
import type { JournalProgressCheckpoint } from './JournalProgress';

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
 * and destructible props only exist on the overworld, bounties only where Shady
 * is.
 */
export interface WorldCheckpoint {
  gameMap: GameMapCheckpoint;
  gameStats: GameStatsSnapshot;

  bossRoom: BossRoomCheckpoint;
  arena: ArenaCheckpoint;
  arenaRoom: ArenaRoomCheckpoint;
  juicerRoom: JuicerRoomCheckpoint;
  barriers: BarrierCheckpoint;
  safeRoom: SafeRoomCheckpoint;
  miniMap: MiniMapCheckpoint;
  stairwell: StairwellCheckpoint;
  /**
   * The Wayfinder's Anchor's cooldown alone. The live channel and the trail
   * anchor are dropped by the restore rather than captured — see `RecallSystem`.
   */
  recall: RecallCheckpoint;
  treasureChests: TreasureChestCheckpoint;
  bopca: BopcaCheckpoint;
  difficultyTelemetry: DifficultyTelemetryCheckpoint;
  mercenary: MercenaryCheckpoint;
  mongo: MongoCheckpoint;

  defendQuest: DefendQuestCheckpoint;
  spiderQuest: SpiderQuestCheckpoint;
  circusQuest: CircusQuestCheckpoint;
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
  circusQuestProgress: CircusQuestProgressCheckpoint;
  anchorQuestProgress: AnchorQuestProgressCheckpoint;
  murderQuestProgress: MurderQuestProgressCheckpoint;
  journal: JournalProgressCheckpoint;
  bountyProgress: BountyProgressCheckpoint;
  clubMembership: ClubMembershipCheckpoint;
  marketStock: MarketStockCheckpoint;
  townMemory: TownMemoryCheckpoint;
  mercenaryRoster: MercenaryRosterCheckpoint;
  mongoPetState: MongoPetStateCheckpoint;

  /**
   * One-time kill latches the scene owns directly rather than through a system.
   * `krakarenKilled` gates a reward that must not be collectable twice, and
   * `juicerKilled` does the same for the Desperado Pass tattoo.
   */
  krakarenKilled: boolean;
  krakarenBossRoomIdx: number;
  juicerKilled: boolean;
  juicerBossRoomIdx: number;
}
