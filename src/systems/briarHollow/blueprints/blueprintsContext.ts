/**
 * What every part of "The Borrowed Blueprints" is built with: the village's
 * durable state, the map, the party and the shared surfaces (the villagers'
 * conversation panel, the bus, the audio), plus the quest's own phase switch.
 *
 * One record, handed by `BlueprintsQuestSystem` to each of its parts (the
 * fence, the harvest, Midge's escort, the station upgrades), so a part never
 * reaches into the system or the kit for anything, and adding what one part
 * needs is one field here rather than a new constructor argument everywhere.
 *
 * Rebuilt with the kit on every door visit, so a part must keep nothing
 * durable of its own: whatever has to survive a door goes in
 * `state.blueprints` (or, for Midge's live position, a scene-option record
 * the scenes carry across the door).
 */

import type { AudioManager } from '../../../audio/AudioManager';
import type { EventBus } from '../../../core/EventBus';
import type { BriarHollowState } from '../../../core/briarHollowState';
import type { BlueprintsQuestPhase } from '../../../core/blueprintsQuestPhase';
import type { VillageQuestPhase } from '../../../core/villageQuestPhase';
import type { CatPlayer } from '../../../creatures/CatPlayer';
import type { HumanPlayer } from '../../../creatures/HumanPlayer';
import type { Conversation } from '../../../dialog/Conversation';
import type { GameMap } from '../../../map/GameMap';
import type { BriarHollowSite } from '../../../map/overworld/briarHollowSite';
import type { MobRoster } from '../../kits/SceneWorld';
import type { VillagerSystem } from '../VillagerSystem';
import type { LivestockSystem } from '../LivestockSystem';
import type { SiegeMusicClaim } from '../VillageAssaultSystem';
import type { MidgeEscortCarry } from '../../../core/midgeEscortCarry';
import type { BlueprintsCue } from './blueprintsSoundCues';

export type BlueprintsCrawler = HumanPlayer | CatPlayer;

export interface BlueprintsQuestContext {
  /** The village's durable state; the quest's own record is `state.blueprints`. */
  readonly state: BriarHollowState;
  readonly gameMap: GameMap;
  readonly site: BriarHollowSite;
  readonly bus: EventBus;
  readonly audio: AudioManager | null;
  readonly roster: MobRoster;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  /** The crawler the player is controlling right now. */
  readonly active: () => BlueprintsCrawler;
  readonly villagers: VillagerSystem;
  /** The scene's one shared conversation panel. */
  readonly conversation: Conversation;
  /** A one-line toast over the HUD: "Not enough materials." */
  readonly announce: (message: string) => void;
  /** Floats `text` up off a structure at world pixel (`x`, `y`): "Saw upgraded!". */
  readonly callout: (text: string, x: number, y: number) => void;
  /** Told of every village tile whose type or style changed at runtime. */
  readonly onTileChanged: (tileX: number, tileY: number) => void;
  /** Keeps the resource strip up while something is being built. */
  readonly noteResourceActivity: () => void;
  /** Whether the world is stopped under a menu; timed work waits while it is. */
  readonly worldHalted: () => boolean;
  /** "Briar Hollow's Plea"'s phase, for the siege rules and Merrit's greeting. */
  readonly pleaPhase: () => VillageQuestPhase;
  /** Moves the quest on, with its events. */
  readonly setPhase: (phase: BlueprintsQuestPhase) => void;
  /** Plays a cue from `BLUEPRINTS_CUES`, rotating its takes. */
  readonly cue: (cue: BlueprintsCue) => void;
  /** Merrit's herd, which Midge is walked out of when Merrit calls her. */
  readonly livestock: LivestockSystem | null;
  /** The overworld's zone music, which the escort's fight music takes over from while ambushers live. */
  readonly music: () => SiegeMusicClaim | null;
  /** The level the road's ambushers come at, rolled per body. */
  readonly escortLevel: () => number;
  /** Midge's escort across a door visit: the scene-option record the scenes carry by reference. */
  readonly midgeCarry: MidgeEscortCarry;
}
