import type { LevelId } from '../../levels/levelIds';
import type { Player } from '../../Player';
import type { JsonObject } from './json';
import type { PetNames } from '../../core/party/petNames';
import type { CrawlerKind } from '../../core/skills/SkillManager';

/**
 * A game event as the AI server receives it. `witnessedBy` names every
 * character that perceived the event; when it is absent only omniscient
 * characters see it.
 */
export interface GameEvent {
  ts: number;
  type: string;
  data: JsonObject;
  summary?: string;
  /** 0..1; absent means the server scores salience itself. */
  importance?: number;
  witnessedBy?: string[];
}

export type ThreatLevel = 'trivial' | 'low' | 'moderate' | 'high' | 'deadly';

export type LocationKind =
  'safeRoom' | 'bossArena' | 'stairwell' | 'room' | 'corridor' | 'overworld' | 'building';

/** Where the active crawler is, in words the AI can repeat back. */
export interface SemanticLocation {
  kind: LocationKind;
  /** e.g. "safe room", "boss arena (the Trash Gremlin)", "General Store", "dark corridor near stairwell". */
  label: string;
  inSafeRoom: boolean;
  inBossArena: boolean;
  /** Index of the dungeon room the crawler stands in, when the map has rooms. */
  roomIndex?: number;
}

export interface CrawlerState {
  kind: CrawlerKind;
  hp: number;
  maxHp: number;
  level: number;
  xp: number;
  coins: number;
  isActive: boolean;
  knockedOut: boolean;
  statusEffects: string[];
  /** Display names of everything equipped, keyed by equipment slot. */
  equipped: Record<string, string>;
  /** Item display name → count, for the items worth the AI's attention (potions, explosives, quest items, gear in the bag). */
  notableItems: Record<string, number>;
  healthPotions: number;
  tileX: number;
  tileY: number;
}

export interface NearbyMobState {
  name: string;
  level: number;
  isBoss: boolean;
  threat: ThreatLevel;
  hpPercent: number;
  distanceTiles: number;
}

export interface QuestSummary {
  id: string;
  name: string;
  objective: string;
}

/** Slow-changing facts about the run: what `context_set` is built from. */
export interface SessionInput {
  floorNumber: number;
  levelId: LevelId;
  floorName: string;
  /** Seconds left on the floor's collapse clock; absent on a floor without one. */
  levelTimerSeconds?: number;
  levelTimerRunning: boolean;
  difficulty: string;
  secondsPlayed: number;
  deaths: number;
  activeQuests: QuestSummary[];
  /**
   * Companions out with the party (Deinonychus, hirelings, the attack cow),
   * each by kind and never by a pet's name: those are player-typed text and
   * travel apart, in the context's `petNames`, where the server fences them.
   */
  companions: string[];
  /** Rooms on this floor's map, for the exploration share. Absent where the map has none. */
  roomCount?: number;
  indoors: boolean;
}

/** Fast-changing state: what `state_snapshot` is built from. */
export interface LiveInput {
  activeCrawler: CrawlerKind;
  /** Both crawlers, keyed by species: which character plays each is the registry's business, not this record's. */
  crawlers: Record<CrawlerKind, CrawlerState>;
  location: SemanticLocation;
  nearbyMobs: NearbyMobState[];
  combatInProgress: boolean;
  bossFightActive: boolean;
  /** The world is halted: pause screen, a menu, a dialog, the death screen. */
  isPaused: boolean;
  /** A menu or dialog (not the pause screen) is up. */
  menuOpen: boolean;
}

/**
 * What a scene exposes to the context builder. Every read returns plain data
 * so the builder can be driven headlessly.
 */
export interface AIContextSource {
  readSession(): SessionInput;
  readLive(): LiveInput;
  /** Cheap check used per event to decide whether Dave saw it: is the active crawler in a safe room? */
  isPartyInSafeRoom(): boolean;
  /** The same check for one crawler, for events that happened to that crawler. */
  isCrawlerInSafeRoom(crawler: CrawlerKind): boolean;
  /** Which crawler `player` is, or null for a player that is neither. */
  crawlerKindOf(player: Player): CrawlerKind | null;
  /** The run's pet names, so a pet is told about by the name the player gave it. */
  readonly petNames: PetNames;
}
