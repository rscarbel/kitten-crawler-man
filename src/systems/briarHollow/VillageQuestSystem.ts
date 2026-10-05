/**
 * VillageQuestSystem — "Briar Hollow's Plea", the village's questline from
 * the Mayor's first word to his thanks: who says what at each step, the
 * guided build-up (tools, wood, stone, processing, the first trebuchet and
 * wall), the journal line and the markers pointing the way, the siege itself,
 * and the reward.
 *
 * The phase itself lives in `BriarHollowState.quest`, threaded by reference
 * and rebuilt around on every door visit; this class reads it and moves it
 * on, and holds nothing of its own that a rebuild could lose. The siege is
 * `VillageAssaultSystem`'s; this system starts it and hears how it ended.
 * Some steps only move once the party has done something in the world (held
 * enough of a resource, built a trebuchet, loaded it) rather than said
 * anything to anybody — `update()` polls for those every gameplay frame.
 */

import type { EventBus } from '../../core/EventBus';
import type {
  BriarHollowState,
  TrebuchetStructureRecord,
  VillageQuestState,
} from '../../core/briarHollowState';
import {
  BRIAR_HOLLOW_QUEST_NAME,
  hasAcceptedMayorRequest,
  type VillageQuestPhase,
} from '../../core/villageQuestPhase';
import { grantConstructionUnlocks, TIKKA_PLANS_UNLOCKS } from '../../core/villageUnlocks';
import { QuestManager, type QuestDef } from '../../core/QuestManager';
import { teachBoth } from '../../core/CraftSkills';
import type { PartyCraftsState } from '../../core/partyCrafts';
import { canAfford, partyCount, type ResourceCost } from '../../core/partyResources';
import { awardPartyXp, type PartyXpApplied } from '../../core/awardXp';
import type { ItemId } from '../../core/ItemDefs';
import type { GrantedReward } from '../../core/GrantedReward';
import { TILE_SIZE } from '../../core/constants';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { NPCMarkerType } from '../../creatures/QuestNPC';
import type { BriarHollowSite } from '../../map/overworld/briarHollowSite';
import type { TilePoint } from '../../map/town/townPlan';
import { bagItemRewardLine, partyXpSections } from '../../ui/questReward/rewardLines';
import type { QuestRewardSpec, RewardItemLine } from '../../ui/questReward/types';
import { drawCraftSkillIcon } from '../../ui/icons/craftSkillIcons';
import type { QuestMarkerType } from '../MiniMapSystem';
import {
  characterTarget,
  secondsLabel,
  type TrackerEntry,
  type TrackerTarget,
} from '../questTracker';
import type { GroundPickupSystem } from '../GroundPickupSystem';
import type { DefenseStructures } from './DefenseStructures';
import {
  shortfallGuidance,
  type QuestGuidance,
  type StationGuidance,
  type TileRect,
} from './questGuidance';
import {
  BELL_TOWER_REPAIR_COST,
  TREBUCHET_BUILD_COST,
  TREBUCHET_HEIGHT_TILES,
  WALL_TIERS,
} from './structureRules';
import { CRAWLER_NAMES } from '../../core/SkillManager';
import { BRAMBLEWICK, FENNA, OREN, TIKKA, type VillagerId } from '../../dialog/scripts/briarHollow';
import type { ConversationRequest, ConversationTopic } from '../../dialog/request';
import {
  KEEP_TALKING,
  type OpeningPages,
  type QuestLineProvider,
  type QuestOpening,
  type VillagerContext,
} from './villagerCircumstances';
import type { TopicProvider, VillagerConversationFlow } from './villagerTopics';
import type { VillagerSystem } from './VillagerSystem';
import { ASSAULT_WAVE_COUNT, type VillageAssaultSystem } from './VillageAssaultSystem';
import { BOARDS_PER_WOOD } from './services/woodProcessing';
import { travelUnlocksSection, type TravelUnlockState } from '../travel/travelDestinations';

export const BRIAR_HOLLOW_QUEST_ID = 'briar_hollow_plea';

/**
 * The questline's XP, set against the floor's other questlines: the circus's
 * (1800) is the longest of them, and this one — gathering, building, and a
 * three-wave siege with a boss — is longer still.
 */
export const BRIAR_HOLLOW_QUEST_XP = 2000;
/** The Mayor's purse, paid to whoever turns the quest in. */
export const BRIAR_HOLLOW_QUEST_COINS = 500;
/** Pipkin's "something special": burgers and stew from the cookhouse. */
export const BRIAR_HOLLOW_REWARD_BURGERS = 5;
export const BRIAR_HOLLOW_REWARD_STEW = 3;

/** Wood held before the lumber yard sends the party on to the quarry. */
export const WOOD_TARGET = 15;
/** Stone held before the quarry sends the party to report to Tikka. */
export const STONE_TARGET = 10;
/** Boards Tikka needs before she can draw up her plans. */
export const PROCESSING_BOARDS_TARGET = 20;
/** Rope Tikka needs alongside the boards. */
export const PROCESSING_ROPE_TARGET = 5;

const HELP_TOPIC_KEY = 'quest_how_can_we_help';
const ACCEPT_TOPIC_KEY = 'quest_accept';
const DECLINE_TOPIC_KEY = 'quest_decline';
const TEACH_AGAIN_TOPIC_KEY = 'quest_construction_again';
const MORE_TIME_TOPIC_KEY = 'quest_more_time';
const READY_FOR_ASSAULT_TOPIC_KEY = 'quest_ready_for_assault';

/** What the active crawler says once processing is done, before heading back to Tikka. */
export const PROCESSING_DONE_LINE =
  "Alright, now let's bring this back to Tikka and see what she has for us.";

/** What the active crawler says once enough wood is held, before heading to the quarry. */
export const QUARRY_SPOTTED_LINE =
  'I think I saw a quarry by the southern gate. We should test our pickaxe out there.';

/** What the active crawler says once enough stone is held, before heading back to Tikka. */
export const STONE_GATHERED_LINE =
  "Oren mentioned we should speak with Tikka once we've collected some wood and stone. We should go see what she has for us.";

/** What the Mayor shouts once the wall is up, summoning both crawlers to hear his ask. */
export const MAYOR_SHOUT_SUMMONS_SPEAKER = 'Mayor Bramblewick [shouting]';
export const MAYOR_SHOUT_SUMMONS_TEXT =
  'Carl, Donut, come and speak with me. I have something for you.';

/** What the fortifications stand at, for the journal's fortifying-phase tally. */
export interface FortificationTally {
  readonly wooden: number;
  readonly stone: number;
  readonly fortified: number;
  readonly trebuchets: number;
  readonly snares: number;
}

export function tallyFortifications(state: BriarHollowState): FortificationTally {
  let wooden = 0;
  let stone = 0;
  let fortified = 0;
  let trebuchets = 0;
  let snares = 0;
  for (const record of state.structures) {
    if (record.kind === 'trebuchet') trebuchets++;
    else if (record.kind === 'snare') snares++;
    else if (record.tier === 'wood') wooden++;
    else if (record.tier === 'stone') stone++;
    else if (record.tier === 'fortified') fortified++;
  }
  return { wooden, stone, fortified, trebuchets, snares };
}

/** Any segment at a wooden wall or better. */
export function hasWoodenWall(tally: FortificationTally): boolean {
  return tally.wooden + tally.stone + tally.fortified > 0;
}

export interface VillageQuestSystemDeps {
  readonly bus: EventBus;
  readonly state: BriarHollowState;
  readonly site: BriarHollowSite;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly partyCrafts: PartyCraftsState;
  readonly villagers: VillagerSystem;
  readonly defense: DefenseStructures;
  readonly assault: () => VillageAssaultSystem | null;
  readonly active: () => HumanPlayer | CatPlayer;
  /** Opens the Construction explainer. */
  readonly openConstructionExplainer: () => void;
  /** Whether the Construction explainer is still on screen. */
  readonly isConstructionExplainerOpen: () => boolean;
  /** Opens the Processing explainer — the saw and rope walk's own "how it works". */
  readonly openProcessingExplainer: () => void;
  /**
   * Where `VillageQuestGuide` is currently highlighting in the world — the
   * tree, rock, station or wall it picked for the guidance this frame — for
   * the tracker's own arrow. Null when the guide has nothing picked, in which
   * case the tracker falls back to an area anchor.
   */
  readonly guideTarget: () => TrackerTarget | null;
  /**
   * A one-off narrated line — never a topic choice — shown as a dialog box
   * from `speaker`. `onClosed`, when given, runs once the box has been
   * dismissed — the place to move a phase whose arrow must not jump while
   * the line is still on screen.
   */
  readonly showQuestLine: (speaker: string, text: string, onClosed?: () => void) => void;
  /** Queues a "New Item!" card; cards halt the world, so they are only raised after a conversation. */
  readonly enqueueReward: (reward: GrantedReward) => void;
  /** Runs once every queued card has been read. */
  readonly afterRewardsDrain: (run: () => void) => void;
  readonly announce: (message: string) => void;
  /** Where burgers that do not fit the bag land. */
  readonly groundPickups: GroundPickupSystem;
  /** Drops items on the floor as a loot pile, for stew that does not fit the bag. */
  readonly dropItems: (
    x: number,
    y: number,
    items: ReadonlyArray<{ id: ItemId; quantity: number }>,
  ) => void;
  /**
   * Grants Oren's starter tools and the Resourcing lesson, as the questline's
   * own opening line for him. Returns the follow-up to run once the
   * conversation eventually closes, or `null` when the party already had them.
   */
  readonly grantOrenTools: () => (() => void) | null;
  /**
   * The soldier posted in the Over City's own square who can start this
   * questline before the party has ever reached the village; null when none
   * is posted.
   */
  readonly recruiter: () => { readonly name: string; readonly tile: TilePoint } | null;
  /** Read when the reward screen is built, to say whether the stone can use its new destination yet. */
  readonly travelUnlocks: Pick<TravelUnlockState, 'anchor'>;
}

/** The note on a reward line whose items did not fit the bag and were left on the ground. */
const LEFT_AT_MAYORS_FEET_NOTE = "Your bag was full — left at the Mayor's feet.";

/** A reward line for food the Plea paid, flown to the bag only if it went in. */
function foodRewardLine(id: ItemId, quantity: number, bagged: boolean): RewardItemLine {
  if (bagged) return bagItemRewardLine(id, quantity);
  return bagItemRewardLine(id, quantity, { note: LEFT_AT_MAYORS_FEET_NOTE, flyToBag: false });
}

/** The skill-unlocked card Tikka's plans are announced with. */
function constructionUnlockedReward(): GrantedReward {
  return {
    kind: 'skill',
    name: 'Construction',
    description:
      'You have unlocked the Construction skill. You may now earn construction experience.',
    renderIcon: (ctx, rect) => drawCraftSkillIcon(ctx, rect, 'construction'),
  };
}

export class VillageQuestSystem implements QuestLineProvider, TopicProvider {
  private readonly questManager = new QuestManager();
  private readonly unsubscribers: Array<() => void> = [];
  /** Set while waiting for the Construction explainer, opened after Tikka hands over her plans, to close. */
  private awaitingPlansExplainerClose = false;
  /** Set while the quarry-spotted line is queued or on screen, so the wood target can't re-queue it. */
  private quarryLineRequested = false;
  /** Set while the processing-done line is queued or on screen, so a held target can't re-queue it. */
  private processingLineRequested = false;
  /** Set while the stone-gathered line is queued or on screen, so the stone target can't re-queue it. */
  private stoneLineRequested = false;
  /** Set while the Mayor's summons is queued or on screen, so a standing wall can't re-queue it. */
  private mayorSummonsRequested = false;

  constructor(private readonly deps: VillageQuestSystemDeps) {
    const def: QuestDef = {
      id: BRIAR_HOLLOW_QUEST_ID,
      name: BRIAR_HOLLOW_QUEST_NAME,
      type: 'story',
      rewards: { xp: BRIAR_HOLLOW_QUEST_XP, coins: BRIAR_HOLLOW_QUEST_COINS },
    };
    this.questManager.register(def);
    this.syncQuestManager();
    deps.villagers.addQuestLineProvider(this);
    deps.villagers.addTopicProvider(this);
    const { bus } = deps;
    this.unsubscribers.push(
      bus.on('toolsGranted', () => {
        if (this.phase === 'need_tools') this.setPhase('gather_wood');
      }),
      bus.on('bellTowerRepaired', () => {
        if (this.phase === 'repair_bell') this.setPhase('fortifying');
      }),
    );
  }

  // ── The phase ─────────────────────────────────────────────────────────────

  private get quest(): VillageQuestState {
    return this.deps.state.quest;
  }

  get phase(): VillageQuestPhase {
    return this.quest.phase;
  }

  /** Moves the questline to `phase` and tells everyone listening. */
  setPhase(phase: VillageQuestPhase): void {
    if (this.quest.phase === phase) return;
    this.quest.phase = phase;
    this.syncQuestManager();
    this.deps.bus.emit('villageQuestPhaseChanged', { phase });
  }

  private syncQuestManager(): void {
    const phase = this.phase;
    if (!hasAcceptedMayorRequest(phase)) return;
    this.questManager.startQuest(BRIAR_HOLLOW_QUEST_ID);
    if (phase === 'complete') this.questManager.completeQuest(BRIAR_HOLLOW_QUEST_ID);
  }

  /** The quest's status as the quest manager holds it. */
  get status(): ReturnType<QuestManager['getStatus']> {
    return this.questManager.getStatus(BRIAR_HOLLOW_QUEST_ID);
  }

  // ── Held resources ───────────────────────────────────────────────────────

  private woodHeld(): number {
    return partyCount(this.deps.human, this.deps.cat, 'wood');
  }

  private stoneHeld(): number {
    return partyCount(this.deps.human, this.deps.cat, 'stone');
  }

  private boardsHeld(): number {
    return partyCount(this.deps.human, this.deps.cat, 'wood_board');
  }

  private ropeHeld(): number {
    return partyCount(this.deps.human, this.deps.cat, 'rope');
  }

  private canAfford(cost: ResourceCost): boolean {
    return canAfford(this.deps.human, this.deps.cat, cost);
  }

  private firstTrebuchet(): TrebuchetStructureRecord | null {
    for (const record of this.deps.state.structures) {
      if (record.kind === 'trebuchet') return record;
    }
    return null;
  }

  /** The display name for whichever crawler is currently active. */
  private activeCrawlerName(): string {
    return this.deps.active() === this.deps.human ? CRAWLER_NAMES.human : CRAWLER_NAMES.cat;
  }

  // ── Polling: steps the world itself finishes, not a conversation ─────────

  /**
   * Every gameplay frame: moves a phase on the moment its world condition is
   * met, whether that happened through gathering, processing, building or a
   * conversation elsewhere in the village.
   */
  update(): void {
    switch (this.phase) {
      case 'gather_wood':
        if (!this.quarryLineRequested && this.woodHeld() >= WOOD_TARGET) {
          this.quarryLineRequested = true;
          this.deps.showQuestLine(this.activeCrawlerName(), QUARRY_SPOTTED_LINE, () => {
            this.quarryLineRequested = false;
            this.setPhase('gather_stone');
          });
        }
        return;
      case 'gather_stone':
        if (!this.stoneLineRequested && this.stoneHeld() >= STONE_TARGET) {
          this.stoneLineRequested = true;
          this.deps.showQuestLine(this.activeCrawlerName(), STONE_GATHERED_LINE, () => {
            this.stoneLineRequested = false;
            this.setPhase('report_tikka');
          });
        }
        return;
      case 'processing':
        if (
          !this.processingLineRequested &&
          this.boardsHeld() >= PROCESSING_BOARDS_TARGET &&
          this.ropeHeld() >= PROCESSING_ROPE_TARGET
        ) {
          this.processingLineRequested = true;
          this.deps.showQuestLine(this.activeCrawlerName(), PROCESSING_DONE_LINE, () => {
            this.processingLineRequested = false;
            this.setPhase('return_tikka');
          });
        }
        return;
      case 'return_tikka':
        if (this.awaitingPlansExplainerClose && !this.deps.isConstructionExplainerOpen()) {
          this.awaitingPlansExplainerClose = false;
          this.setPhase('build_trebuchet');
        }
        return;
      case 'build_trebuchet':
        if (this.firstTrebuchet() !== null) this.setPhase('load_trebuchet');
        return;
      case 'load_trebuchet': {
        const trebuchet = this.firstTrebuchet();
        if (trebuchet === null) {
          this.setPhase('build_trebuchet');
        } else if (trebuchet.ammo > 0) {
          this.setPhase('build_wall');
        }
        return;
      }
      case 'build_wall':
        if (!this.mayorSummonsRequested && hasWoodenWall(tallyFortifications(this.deps.state))) {
          this.mayorSummonsRequested = true;
          this.deps.showQuestLine(MAYOR_SHOUT_SUMMONS_SPEAKER, MAYOR_SHOUT_SUMMONS_TEXT, () => {
            this.mayorSummonsRequested = false;
            this.setPhase('summoned_by_mayor');
          });
        }
        return;
      case 'unmet':
      case 'offered':
      case 'declined':
      case 'need_tools':
      case 'report_tikka':
      case 'see_fenna':
      case 'summoned_by_mayor':
      case 'fortifying':
      case 'imminent':
      case 'assault':
      case 'repelled_failed':
      case 'victory':
      case 'complete':
        return;
      case 'repair_bell':
        // Normally the repair event moves the quest on; this covers a tower that
        // is already whole when the step begins, which would otherwise wait on
        // an event that can never fire again.
        if (!this.deps.state.quest.bellTowerBroken) this.setPhase('fortifying');
        return;
    }
  }

  // ── Guidance: what the guide should highlight in the world ───────────────

  private shortfallGuidance(cost: ResourceCost): QuestGuidance {
    return shortfallGuidance(this.deps.human, this.deps.cat, cost);
  }

  private processingGuidance(): QuestGuidance {
    const boards = this.boardsHeld();
    const rope = this.ropeHeld();
    const boardsNeeded = Math.max(0, PROCESSING_BOARDS_TARGET - boards);
    const ropeNeeded = Math.max(0, PROCESSING_ROPE_TARGET - rope);
    const woodNeeded = Math.ceil(boardsNeeded / BOARDS_PER_WOOD) + ropeNeeded;
    if (woodNeeded > 0 && this.woodHeld() === 0) {
      return { kind: 'chop', progress: { have: 0, target: woodNeeded } };
    }
    const stations: StationGuidance[] = [];
    if (boardsNeeded > 0) {
      stations.push({
        station: 'saw',
        progress: { have: boards, target: PROCESSING_BOARDS_TARGET },
      });
    }
    if (ropeNeeded > 0) {
      stations.push({
        station: 'rope_walk',
        progress: { have: rope, target: PROCESSING_ROPE_TARGET },
      });
    }
    return { kind: 'process', stations };
  }

  /**
   * A few open patches hugging the inside of the south wall, suggested for
   * the first trebuchet: an engine set back deep in the village would still
   * have to fire over the same wall, so pressing it right up against the
   * palisade is what buys it the extra reach against anything approaching
   * the gate.
   */
  private trebuchetZones(): readonly TileRect[] {
    const gate = this.deps.site.gate.inside;
    const wallY = this.deps.site.gate.tiles[0].y;
    const zoneWidth = 3;
    // Tall enough for the trebuchet's fixed 2×3 footprint regardless of which way the builder faces it.
    const zoneHeight = TREBUCHET_HEIGHT_TILES;
    const gap = 2;
    const y = wallY - zoneHeight;
    return [
      { x: gate.x - zoneWidth - gap, y, width: zoneWidth, height: zoneHeight },
      { x: gate.x + gap, y, width: zoneWidth, height: zoneHeight },
    ];
  }

  /** What the guide should highlight right now; null while the step is purely a conversation. */
  guidance(): QuestGuidance | null {
    switch (this.phase) {
      case 'gather_wood':
        return { kind: 'chop', progress: { have: this.woodHeld(), target: WOOD_TARGET } };
      case 'gather_stone':
        return { kind: 'mine', progress: { have: this.stoneHeld(), target: STONE_TARGET } };
      case 'processing':
        return this.processingGuidance();
      case 'build_trebuchet':
        return this.canAfford(TREBUCHET_BUILD_COST)
          ? { kind: 'build_trebuchet', zones: this.trebuchetZones() }
          : this.shortfallGuidance(TREBUCHET_BUILD_COST);
      case 'load_trebuchet': {
        const trebuchet = this.firstTrebuchet();
        if (trebuchet === null) return null;
        if (this.stoneHeld() === 0) {
          return { kind: 'mine', progress: { have: 0, target: STONE_TARGET } };
        }
        return { kind: 'load_trebuchet', at: { x: trebuchet.x, y: trebuchet.y } };
      }
      case 'build_wall': {
        if (this.mayorSummonsRequested) return null;
        const cost = WALL_TIERS.wood.upgradeCost ?? {};
        return this.canAfford(cost) ? { kind: 'upgrade_wall' } : this.shortfallGuidance(cost);
      }
      case 'repair_bell':
        return this.canAfford(BELL_TOWER_REPAIR_COST)
          ? { kind: 'repair_bell' }
          : this.shortfallGuidance(BELL_TOWER_REPAIR_COST);
      case 'unmet':
      case 'offered':
      case 'declined':
      case 'need_tools':
      case 'report_tikka':
      case 'see_fenna':
      case 'return_tikka':
      case 'summoned_by_mayor':
      case 'fortifying':
      case 'imminent':
      case 'assault':
      case 'repelled_failed':
      case 'victory':
      case 'complete':
        return null;
    }
  }

  // ── Who says what ─────────────────────────────────────────────────────────

  lineFor(villager: VillagerId, ctx: VillagerContext): QuestOpening | null {
    if (villager === 'bramblewick') return this.mayorLine(ctx);
    if (villager === 'tikka') return this.tikkaLine(ctx);
    if (villager === 'fenna') return this.fennaLine(ctx);
    if (villager === 'oren') return this.orenLine(ctx);
    return null;
  }

  private orenLine(ctx: VillagerContext): QuestOpening | null {
    if (ctx.quest.phase !== 'need_tools') return null;
    return {
      pages: [OREN.grantBasicTools],
      questRelated: true,
      // The grant runs once this page has been read, not the instant it is
      // chosen — a player who walks away or presses Escape mid-page must
      // still find the forge willing to grant the tools on the next talk.
      after: { kind: 'close', onClosed: () => this.deps.grantOrenTools()?.() },
    };
  }

  private mayorLine(ctx: VillagerContext): QuestOpening | null {
    switch (ctx.quest.phase) {
      case 'unmet':
        // The greeting, and then the rest of what he has to say, come from the
        // ordinary ladder; the offer waits for "How can we help?".
        return null;
      case 'offered':
      case 'declined':
        return { pages: [BRAMBLEWICK.questOffer], after: KEEP_TALKING };
      case 'need_tools':
        return { pages: [BRAMBLEWICK.beforeTools], after: KEEP_TALKING };
      case 'summoned_by_mayor':
        return {
          pages: [BRAMBLEWICK.briefing],
          questRelated: true,
          after: {
            kind: 'close',
            onClosed: () => {
              this.deps.state.unlocks.soldierCommands = true;
              this.setPhase('fortifying');
            },
          },
        };
      case 'fortifying':
        return { pages: [BRAMBLEWICK.fortifyingAwaitingWord], after: KEEP_TALKING };
      case 'repelled_failed':
        return {
          pages: [BRAMBLEWICK.repelledFailed],
          questRelated: true,
          after: { kind: 'close', onClosed: () => this.setPhase('repair_bell') },
        };
      case 'repair_bell':
        return { pages: [BRAMBLEWICK.repairBellReminder], after: KEEP_TALKING };
      case 'victory': {
        const pages = this.victoryPages();
        this.grantRewards();
        this.setPhase('complete');
        return { pages, questRelated: true, after: KEEP_TALKING };
      }
      case 'complete':
        return {
          pages: [ctx.talkCount % 2 === 0 ? BRAMBLEWICK.questComplete : BRAMBLEWICK.afterVictory],
          after: KEEP_TALKING,
        };
      case 'gather_wood':
      case 'gather_stone':
      case 'report_tikka':
      case 'see_fenna':
      case 'processing':
      case 'return_tikka':
      case 'build_trebuchet':
      case 'load_trebuchet':
      case 'build_wall':
      case 'imminent':
      case 'assault':
        return null;
    }
  }

  /** The Mayor's thanks: relief, a word on the damage if there was any, then the gratitude. */
  private victoryPages(): OpeningPages {
    const siege = this.quest.lastSiege;
    const damaged =
      siege !== null &&
      siege.segmentsBreached + siege.structuresDestroyed + siege.soldiersDowned > 0;
    return damaged
      ? [BRAMBLEWICK.afterVictory, BRAMBLEWICK.afterVillageDamage, BRAMBLEWICK.questComplete]
      : [BRAMBLEWICK.afterVictory, BRAMBLEWICK.questComplete];
  }

  private tikkaLine(ctx: VillagerContext): QuestOpening | null {
    switch (ctx.quest.phase) {
      case 'unmet':
      case 'offered':
      case 'declined':
        return ctx.talkCount === 0
          ? { pages: [TIKKA.firstMeeting, TIKKA.questExplanation], after: KEEP_TALKING }
          : { pages: [TIKKA.questExplanation], after: KEEP_TALKING };
      case 'need_tools':
        return { pages: [TIKKA.toolsRequired], after: KEEP_TALKING };
      case 'gather_wood':
        return { pages: [TIKKA.axeTask], after: KEEP_TALKING };
      case 'gather_stone':
        return { pages: [TIKKA.pickaxeTask], after: KEEP_TALKING };
      case 'report_tikka':
        teachBoth(this.deps.human, this.deps.cat, 'construction');
        return {
          pages: [TIKKA.reportPlans],
          questRelated: true,
          after: {
            kind: 'close',
            onClosed: () => {
              this.setPhase('see_fenna');
              if (!this.deps.active().isAlive) return;
              this.deps.enqueueReward(constructionUnlockedReward());
            },
          },
        };
      case 'see_fenna':
      case 'processing':
        return { pages: [TIKKA.woodProcessingTask], after: KEEP_TALKING };
      case 'return_tikka':
        grantConstructionUnlocks(this.deps.state.unlocks, TIKKA_PLANS_UNLOCKS);
        return {
          pages: [TIKKA.plansHandoff],
          questRelated: true,
          after: {
            kind: 'close',
            onClosed: () => {
              if (!this.deps.active().isAlive) return;
              this.deps.afterRewardsDrain(() => {
                this.awaitingPlansExplainerClose = true;
                this.openConstructionExplainer();
              });
            },
          },
        };
      case 'fortifying':
      case 'repelled_failed':
      case 'repair_bell':
        return { pages: [TIKKA.constructionSkillAlreadyGranted], after: KEEP_TALKING };
      case 'build_trebuchet':
      case 'load_trebuchet':
      case 'build_wall':
      case 'summoned_by_mayor':
      case 'imminent':
      case 'assault':
      case 'victory':
      case 'complete':
        return null;
    }
  }

  private fennaLine(ctx: VillagerContext): QuestOpening | null {
    if (ctx.quest.phase !== 'see_fenna') return null;
    this.deps.state.unlocks.processingStations = true;
    return {
      pages: [FENNA.grantsAccess],
      questRelated: true,
      after: {
        kind: 'close',
        onClosed: () => {
          this.setPhase('processing');
          if (!this.deps.active().isAlive) return;
          this.deps.afterRewardsDrain(() => this.deps.openProcessingExplainer());
        },
      },
    };
  }

  /** Opens the Construction explainer and records that it has been shown. */
  private openConstructionExplainer(): void {
    const seen = this.deps.partyCrafts.explainersSeen;
    if (!seen.includes('construction')) seen.push('construction');
    this.deps.openConstructionExplainer();
  }

  private constructionLearnedByAnyone(): boolean {
    return (
      this.deps.human.craftSkills.isLearned('construction') ||
      this.deps.cat.craftSkills.isLearned('construction')
    );
  }

  // ── Topics ────────────────────────────────────────────────────────────────

  topics(
    villager: VillagerId,
    ctx: VillagerContext,
    flow: VillagerConversationFlow,
  ): readonly ConversationTopic[] {
    if (villager === 'bramblewick') return this.mayorTopics(ctx, flow);
    if (villager === 'tikka') return this.tikkaTopics(ctx, flow);
    return [];
  }

  private mayorTopics(
    ctx: VillagerContext,
    flow: VillagerConversationFlow,
  ): readonly ConversationTopic[] {
    const phase = ctx.quest.phase;
    if (phase === 'unmet') {
      return [
        {
          key: HELP_TOPIC_KEY,
          label: 'How can we help?',
          tone: 'normal',
          repeatable: false,
          grouping: 'root',
          run: (convo) => {
            this.setPhase('offered');
            convo.play(flow.answerWithTopics([BRAMBLEWICK.questOffer], this.offerChoices(flow)));
          },
        },
      ];
    }
    if (phase === 'offered' || phase === 'declined') return this.offerChoices(flow);
    if (phase === 'fortifying') {
      return [
        {
          key: MORE_TIME_TOPIC_KEY,
          label: 'I need more time',
          tone: 'normal',
          repeatable: false,
          grouping: 'root',
          run: (convo) => convo.play(flow.answer([BRAMBLEWICK.moreTimeGranted])),
        },
        {
          key: READY_FOR_ASSAULT_TOPIC_KEY,
          label: "I'm ready",
          tone: 'quest',
          // Starts the assault on the spot with no way to call it off, so the
          // player aims at it; Space falls to asking for more time.
          keyboard: 'never',
          repeatable: false,
          grouping: 'root',
          run: (convo) => {
            convo.play(flow.closeNow());
            this.deps.assault()?.begin();
          },
        },
      ];
    }
    return [];
  }

  private offerChoices(flow: VillagerConversationFlow): readonly ConversationTopic[] {
    return [
      {
        key: ACCEPT_TOPIC_KEY,
        label: 'Accept',
        tone: 'quest',
        repeatable: false,
        grouping: 'root',
        run: (convo) => convo.play(this.accept(flow)),
      },
      {
        key: DECLINE_TOPIC_KEY,
        label: 'Decline',
        tone: 'normal',
        repeatable: false,
        grouping: 'root',
        run: (convo) => {
          this.setPhase('declined');
          convo.play(flow.answerAndReturnToRoot([BRAMBLEWICK.questDeclined]));
        },
      },
    ];
  }

  private accept(flow: VillagerConversationFlow): ConversationRequest {
    // Defensive against a double Accept race; the row only ever shows while
    // the request is still unaccepted, so nothing here should normally run.
    if (hasAcceptedMayorRequest(this.phase)) return flow.closeNow();
    this.setPhase('need_tools');
    this.deps.bus.emit('questStarted', { questId: BRIAR_HOLLOW_QUEST_ID });
    return flow.answerAndReturnToRoot([BRAMBLEWICK.questAccepted]);
  }

  private tikkaTopics(
    ctx: VillagerContext,
    flow: VillagerConversationFlow,
  ): readonly ConversationTopic[] {
    const phase = ctx.quest.phase;
    const teachable =
      phase === 'fortifying' ||
      phase === 'repelled_failed' ||
      phase === 'repair_bell' ||
      phase === 'victory' ||
      phase === 'complete';
    if (!teachable || !this.constructionLearnedByAnyone()) return [];
    return [
      {
        key: TEACH_AGAIN_TOPIC_KEY,
        label: 'Teach me again',
        tone: 'normal',
        repeatable: false,
        grouping: 'question',
        run: (convo) => {
          // Either crawler who somehow lacks it learns it now, as both were taught together.
          teachBoth(this.deps.human, this.deps.cat, 'construction');
          convo.play(
            flow.closeAfter([TIKKA.constructionSkillAlreadyGranted], () => {
              if (this.deps.active().isAlive) this.openConstructionExplainer();
            }),
          );
        },
      },
    ];
  }

  // ── The reward ────────────────────────────────────────────────────────────

  /**
   * Pays out the quest's rewards unless they have been paid already. Returns
   * whether it paid. Both crawlers earn the full XP; the coins and food go to
   * the active crawler.
   */
  grantRewards(): boolean {
    const quest = this.quest;
    if (quest.rewardsGranted) return false;
    quest.rewardsGranted = true;
    const active = this.deps.active();
    const xpApplied = awardPartyXp(
      this.deps.human,
      this.deps.cat,
      BRIAR_HOLLOW_QUEST_XP,
      this.deps.bus,
    );
    active.earnCoins(BRIAR_HOLLOW_QUEST_COINS);
    const burgersBagged = this.giveOrDrop(active, 'hamburger', BRIAR_HOLLOW_REWARD_BURGERS);
    const stewBagged = this.giveOrDrop(active, 'hollow_stew', BRIAR_HOLLOW_REWARD_STEW);
    this.questManager.startQuest(BRIAR_HOLLOW_QUEST_ID);
    this.questManager.completeQuest(BRIAR_HOLLOW_QUEST_ID);
    this.deps.bus.emit('questCompleted', { questId: BRIAR_HOLLOW_QUEST_ID });
    this.deps.bus.emit(
      'questRewardShown',
      this.rewardSpec({ xpApplied, coins: BRIAR_HOLLOW_QUEST_COINS, burgersBagged, stewBagged }),
    );
    return true;
  }

  /**
   * The Plea's quest-complete screen, describing what {@link grantRewards}
   * actually paid. It goes up once the Mayor's thanks have been read.
   */
  private rewardSpec(paid: {
    readonly xpApplied: PartyXpApplied;
    readonly coins: number;
    readonly burgersBagged: boolean;
    readonly stewBagged: boolean;
  }): QuestRewardSpec {
    return {
      questTitle: BRIAR_HOLLOW_QUEST_NAME,
      sections: [
        ...partyXpSections(paid.xpApplied),
        { kind: 'coins', amount: paid.coins },
        {
          kind: 'items',
          items: [
            foodRewardLine('hamburger', BRIAR_HOLLOW_REWARD_BURGERS, paid.burgersBagged),
            foodRewardLine('hollow_stew', BRIAR_HOLLOW_REWARD_STEW, paid.stewBagged),
          ],
        },
        travelUnlocksSection(['briar_hollow'], this.deps.travelUnlocks),
      ],
    };
  }

  /**
   * Into the bag if it fits; otherwise onto the ground at the Mayor's feet.
   * Returns whether it went into the bag.
   */
  private giveOrDrop(crawler: HumanPlayer | CatPlayer, id: ItemId, quantity: number): boolean {
    if (crawler.inventory.hasRoomFor(id)) {
      crawler.inventory.addItem(id, quantity);
      return true;
    }
    const mayor = this.deps.villagers.villagerFor('bramblewick');
    const x = (mayor?.x ?? crawler.x) + TILE_SIZE * TILE_CENTRE;
    const y = (mayor?.y ?? crawler.y) + TILE_SIZE * TILE_CENTRE;
    if (id === 'hamburger') {
      this.deps.groundPickups.spawnBurgers(x, y, quantity);
      return false;
    }
    this.deps.dropItems(x, y, [{ id, quantity }]);
    return false;
  }

  // ── Markers and the journal ───────────────────────────────────────────────

  /** The glyph over a villager's head. */
  markerFor(villager: VillagerId, _ctx: VillagerContext): NPCMarkerType {
    const phase = this.phase;
    if (villager === 'bramblewick') {
      if (phase === 'unmet' || phase === 'declined') return 'exclamation';
      const question: readonly VillageQuestPhase[] = [
        'offered',
        'summoned_by_mayor',
        'fortifying',
        'repelled_failed',
        'victory',
      ];
      return question.includes(phase) ? 'question' : 'none';
    }
    if (villager === 'oren') return phase === 'need_tools' ? 'question' : 'none';
    if (villager === 'tikka') {
      return phase === 'report_tikka' || phase === 'return_tikka' ? 'question' : 'none';
    }
    if (villager === 'fenna') return phase === 'see_fenna' ? 'question' : 'none';
    return 'none';
  }

  private villagerTarget(id: VillagerId): TrackerTarget | undefined {
    const villager = this.deps.villagers.villagerFor(id);
    if (villager === null) return undefined;
    return characterTarget(villager.tile);
  }

  private anchorTarget(tiles: readonly TilePoint[] | undefined): TrackerTarget | undefined {
    const tile = tiles?.[0];
    return tile === undefined ? undefined : { x: tile.x, y: tile.y };
  }

  /** The guide's own pick for this frame, or `fallback` when it has nothing highlighted yet. */
  private guidedTarget(fallback: TrackerTarget | undefined): TrackerTarget | undefined {
    return this.deps.guideTarget() ?? fallback;
  }

  private fortifyingObjective(): string {
    const tally = tallyFortifications(this.deps.state);
    return (
      `Fortify Briar Hollow — ${tally.wooden} wooden · ${tally.stone} stone · ` +
      `${tally.fortified} fortified · ${tally.trebuchets} trebuchets · ${tally.snares} snares`
    );
  }

  trackerEntries(): ReadonlyArray<TrackerEntry> {
    const entry = this.trackerEntry();
    return entry === null ? [] : [entry];
  }

  private trackerEntry(): TrackerEntry | null {
    const phase = this.phase;
    const base = { id: BRIAR_HOLLOW_QUEST_ID, name: BRIAR_HOLLOW_QUEST_NAME } as const;
    const mayor = (): TrackerTarget | undefined => this.villagerTarget('bramblewick');
    switch (phase) {
      case 'unmet': {
        if (this.deps.state.talkCounts.bramblewick === 0) {
          const recruiter = this.deps.recruiter();
          if (recruiter === null) return null;
          return {
            ...base,
            status: 'available',
            objective: `Speak with ${recruiter.name} in the town square`,
            target: characterTarget(recruiter.tile),
          };
        }
        return {
          ...base,
          status: 'available',
          objective: 'Speak with Mayor Bramblewick',
          target: mayor(),
        };
      }
      case 'offered':
      case 'declined':
        return {
          ...base,
          status: 'available',
          objective: 'Speak with Mayor Bramblewick',
          target: mayor(),
        };
      case 'need_tools':
        return {
          ...base,
          status: 'active',
          objective: 'Get tools from Oren at the forge',
          target: this.villagerTarget('oren'),
        };
      case 'gather_wood':
        return {
          ...base,
          status: 'active',
          objective: `Chop wood in the lumber yard — ${Math.min(this.woodHeld(), WOOD_TARGET)}/${WOOD_TARGET}`,
          target: this.guidedTarget(this.anchorTarget(this.deps.site.villagerAnchors.lumber_yard)),
        };
      case 'gather_stone':
        return {
          ...base,
          status: 'active',
          objective: `Mine stone in the quarry — ${Math.min(this.stoneHeld(), STONE_TARGET)}/${STONE_TARGET}`,
          target: this.guidedTarget(this.anchorTarget(this.deps.site.villagerAnchors.quarry)),
        };
      case 'report_tikka':
        return {
          ...base,
          status: 'active',
          objective: "Report to Tikka at the Engineer's Workshop",
          target: this.villagerTarget('tikka'),
        };
      case 'see_fenna':
        return {
          ...base,
          status: 'active',
          objective: 'Ask Fenna for the saw and rope walk',
          target: this.villagerTarget('fenna'),
        };
      case 'processing': {
        const boards = Math.min(this.boardsHeld(), PROCESSING_BOARDS_TARGET);
        const rope = Math.min(this.ropeHeld(), PROCESSING_ROPE_TARGET);
        const saw = this.deps.site.lumberYard.sawmillAnchor;
        return {
          ...base,
          status: 'active',
          objective: `Process wood — Boards ${boards}/${PROCESSING_BOARDS_TARGET} · Rope ${rope}/${PROCESSING_ROPE_TARGET}`,
          target: this.guidedTarget({ x: saw.x, y: saw.y }),
        };
      }
      case 'return_tikka':
        return {
          ...base,
          status: 'active',
          objective: 'Bring the materials to Tikka',
          target: this.villagerTarget('tikka'),
        };
      case 'build_trebuchet': {
        const gate = this.deps.site.gate.inside;
        return {
          ...base,
          status: 'active',
          objective: 'Build a trebuchet',
          target: this.guidedTarget({ x: gate.x, y: gate.y }),
        };
      }
      case 'load_trebuchet': {
        const trebuchet = this.firstTrebuchet();
        const gate = this.deps.site.gate.inside;
        const fallback =
          trebuchet === null ? { x: gate.x, y: gate.y } : { x: trebuchet.x, y: trebuchet.y };
        return {
          ...base,
          status: 'active',
          objective: 'Load the trebuchet with stone',
          target: this.guidedTarget(fallback),
        };
      }
      case 'build_wall': {
        if (this.mayorSummonsRequested) {
          return {
            ...base,
            status: 'active',
            objective: 'Speak with Mayor Bramblewick',
            target: mayor(),
          };
        }
        const gate = this.deps.site.gate.inside;
        return {
          ...base,
          status: 'active',
          objective: 'Upgrade a fence to a wooden wall',
          target: this.guidedTarget({ x: gate.x, y: gate.y }),
        };
      }
      case 'summoned_by_mayor':
        return {
          ...base,
          status: 'active',
          objective: 'Speak with Mayor Bramblewick',
          target: mayor(),
        };
      case 'fortifying':
        return {
          ...base,
          status: 'active',
          objective: this.fortifyingObjective(),
          hint: "Tell the Mayor when you're ready.",
          target: undefined,
        };
      case 'imminent': {
        // No target: there is nothing to do at the bell, and an arrow there
        // would draw the party away from the walls they are about to defend.
        const frames = this.quest.imminentCountdownFrames;
        return {
          ...base,
          status: 'active',
          objective: `The dead are coming — ${secondsLabel(frames)}`,
        };
      }
      case 'assault':
        return this.assaultEntry(base);
      case 'victory':
        return {
          ...base,
          status: 'active',
          objective: 'Speak with Mayor Bramblewick',
          target: mayor(),
        };
      case 'repelled_failed':
        return {
          ...base,
          status: 'active',
          objective: 'Speak with Mayor Bramblewick',
          target: mayor(),
        };
      case 'repair_bell': {
        const bell = this.deps.site.square.bellTile;
        return {
          ...base,
          status: 'active',
          objective: 'Repair the bell tower',
          target: this.guidedTarget({ x: bell.x, y: bell.y }),
        };
      }
      case 'complete':
        return { ...base, status: 'completed', objective: 'Briar Hollow is safe.' };
    }
  }

  private assaultEntry(base: { readonly id: string; readonly name: string }): TrackerEntry {
    const assault = this.deps.assault();
    const wave = assault?.waveNumber ?? 1;
    const bellPercent = Math.round((assault?.bellFraction ?? 1) * PERCENT);
    const necro = assault?.activeNecromancer ?? null;
    const lastWave = wave >= ASSAULT_WAVE_COUNT;
    const objective = lastWave
      ? 'Defeat Vordrick Boneharrow'
      : `Defend Briar Hollow — Wave ${wave}/${ASSAULT_WAVE_COUNT} · Bell ${bellPercent}%`;
    // Only Vordrick is worth an arrow. Between his appearances the bell would
    // be the fallback, but standing by it defends nothing.
    const target: TrackerTarget | undefined =
      necro === null
        ? undefined
        : {
            x: Math.floor(necro.x / TILE_SIZE + TILE_CENTRE),
            y: Math.floor(necro.y / TILE_SIZE + TILE_CENTRE),
            hidesArrowOnScreen: true,
          };
    return {
      ...base,
      status: 'active',
      objective,
      hint: lastWave ? `Bell ${bellPercent}%` : undefined,
      target,
    };
  }

  /** Minimap pips at wherever the journal points. */
  get questMarkers(): Array<{ x: number; y: number; type: QuestMarkerType }> {
    const entry = this.trackerEntry();
    const target = entry?.target;
    if (entry === null || target === undefined) return [];
    const type: QuestMarkerType = !hasAcceptedMayorRequest(this.phase) ? 'exclamation' : 'question';
    return [{ x: target.x, y: target.y, type }];
  }

  dispose(): void {
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.deps.villagers.removeQuestLineProvider(this);
  }
}

const TILE_CENTRE = 0.5;
const PERCENT = 100;
