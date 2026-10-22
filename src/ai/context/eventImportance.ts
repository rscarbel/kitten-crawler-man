/**
 * How much each game event matters to the AI, in one table. Every event the
 * game sends carries its own `importance`; this table is where those values
 * come from, and `npm run ai:sync` uploads it to the server as importance
 * hints so the server's salience scoring starts from the game's own view.
 */

/**
 * Importance tiers (0..1) the server's salience scoring starts from. Rolled-up
 * and derived events set their own in `gameEventStream.ts` and the builder.
 */
export const IMPORTANCE = {
  BACKGROUND: 0.05,
  TRIVIA: 0.1,
  MINOR: 0.15,
  LOW: 0.25,
  NOTABLE: 0.3,
  MODERATE: 0.4,
  SIGNIFICANT: 0.5,
  HIGH: 0.6,
  MAJOR: 0.7,
  CRITICAL: 0.8,
  LANDMARK: 0.9,
  MAXIMUM: 1,
} as const;

/** A kill rollup starts here and grows with each kill in it. */
export const KILL_IMPORTANCE_BASE = 0.2;
export const KILL_IMPORTANCE_PER_KILL = 0.04;
export const KILL_IMPORTANCE_CAP = 0.6;
/** A sampled window of dodges. */
export const DODGE_IMPORTANCE = IMPORTANCE.MINOR;

/**
 * Each event type's importance. Where an event's importance varies (a
 * dynamite blast that kills a boss, a conversation with Mordecai, a large kill
 * rollup), this is its usual value and the event raises it.
 */
export const EVENT_IMPORTANCE = {
  combatStarted: IMPORTANCE.NOTABLE,
  mobsKilled: KILL_IMPORTANCE_BASE,
  multiKill: IMPORTANCE.SIGNIFICANT,
  playerDodged: DODGE_IMPORTANCE,
  dynamiteUsed: IMPORTANCE.NOTABLE,
  dynamiteKills: IMPORTANCE.HIGH,
  bossFightInitiated: IMPORTANCE.CRITICAL,
  bossDefeated: IMPORTANCE.LANDMARK,
  healthLow: IMPORTANCE.HIGH,
  healingPotionUsed: IMPORTANCE.NOTABLE,
  potionStockpiling: IMPORTANCE.HIGH,
  crawlerKnockedOut: IMPORTANCE.MAJOR,
  crawlerRevived: IMPORTANCE.SIGNIFICANT,
  roomCleared: IMPORTANCE.MODERATE,
  skillTriggered: IMPORTANCE.MODERATE,
  statusApplied: IMPORTANCE.NOTABLE,
  statusCured: IMPORTANCE.LOW,
  playerDied: IMPORTANCE.MAXIMUM,
  playerLevelUp: IMPORTANCE.SIGNIFICANT,
  skillUnlocked: IMPORTANCE.MODERATE,
  skillLevelUp: IMPORTANCE.NOTABLE,
  craftSkillLearned: IMPORTANCE.NOTABLE,
  craftSkillLevelUp: IMPORTANCE.LOW,
  achievementUnlocked: IMPORTANCE.SIGNIFICANT,
  rewardGranted: IMPORTANCE.MODERATE,
  boxOpened: IMPORTANCE.SIGNIFICANT,
  equipmentChanged: IMPORTANCE.LOW,
  stairwellFound: IMPORTANCE.MAJOR,
  levelComplete: IMPORTANCE.LANDMARK,
  floorEntered: IMPORTANCE.LANDMARK,
  safeRoomEntered: IMPORTANCE.NOTABLE,
  gameSaved: IMPORTANCE.BACKGROUND,
  fastTravelUsed: IMPORTANCE.NOTABLE,
  toolUpgraded: IMPORTANCE.LOW,
  questStarted: IMPORTANCE.HIGH,
  objectiveComplete: IMPORTANCE.SIGNIFICANT,
  questCompleted: IMPORTANCE.MAJOR,
  questFailed: IMPORTANCE.HIGH,
  questAbandoned: IMPORTANCE.SIGNIFICANT,
  villageQuestPhaseChanged: IMPORTANCE.SIGNIFICANT,
  blueprintsQuestPhaseChanged: IMPORTANCE.MODERATE,
  villageAssaultWave: IMPORTANCE.HIGH,
  structureDestroyed: IMPORTANCE.MODERATE,
  conversationStarted: IMPORTANCE.MINOR,
  conversationEnded: IMPORTANCE.MINOR,
  mordecaiAdviceGiven: IMPORTANCE.MODERATE,
  bopcaGreeted: IMPORTANCE.TRIVIA,
  bopcaFoodEaten: IMPORTANCE.MINOR,
  shopPurchase: IMPORTANCE.NOTABLE,
  shopSold: IMPORTANCE.LOW,
  cowPetted: IMPORTANCE.TRIVIA,
  cowKilled: IMPORTANCE.NOTABLE,
  playerIdle: IMPORTANCE.MINOR,
  aiActionWitnessed: IMPORTANCE.NOTABLE,
  challengeAccepted: IMPORTANCE.HIGH,
  challengeDeclined: IMPORTANCE.HIGH,
  challengeCompleted: IMPORTANCE.MAJOR,
  challengeFailed: IMPORTANCE.MAJOR,
  playerAnswered: IMPORTANCE.CRITICAL,
  viewerFavorChanged: IMPORTANCE.LOW,
  aiAchievementAwarded: IMPORTANCE.SIGNIFICANT,
  sponsorBreakEnded: IMPORTANCE.MODERATE,
} as const satisfies Readonly<Record<string, number>>;

export type GameEventType = keyof typeof EVENT_IMPORTANCE;
