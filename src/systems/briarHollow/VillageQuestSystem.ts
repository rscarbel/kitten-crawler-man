/**
 * VillageQuestSystem — "Briar Hollow's Plea", the village's questline from
 * the Mayor's first word to his thanks: who says what at each step, the
 * gathering tasks, the journal line and the markers pointing the way, the
 * "We're ready" confirm, and the reward.
 *
 * The phase itself lives in `BriarHollowState.quest`, threaded by reference
 * and rebuilt around on every door visit; this class reads it and moves it
 * on, and holds nothing of its own that a rebuild could lose. The siege is
 * `VillageAssaultSystem`'s; this system starts it and hears how it ended.
 */

import type { AudioManager } from '../../audio/AudioManager';
import type { EventBus } from '../../core/EventBus';
import type { BriarHollowState, VillageQuestState } from '../../core/briarHollowState';
import { hasAcceptedMayorRequest, type VillageQuestPhase } from '../../core/villageQuestPhase';
import { QuestManager, type QuestDef } from '../../core/QuestManager';
import { teachBoth } from '../../core/CraftSkills';
import type { PartyCraftsState } from '../../core/partyCrafts';
import { partyCount } from '../../core/partyResources';
import { awardXp } from '../../core/awardXp';
import { ITEM_DEF, type ItemId } from '../../core/ItemDefs';
import type { GrantedReward } from '../../core/GrantedReward';
import { TILE_SIZE } from '../../core/constants';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { NPCMarkerType } from '../../creatures/QuestNPC';
import type { BriarHollowSite } from '../../map/overworld/briarHollowSite';
import type { TilePoint } from '../../map/town/townPlan';
import { ConfirmModal } from '../../ui/ConfirmModal';
import { drawItemIcon } from '../../ui/InventoryPanel';
import type { OverlayInputClaim } from '../kits/OverlayClaims';
import type { QuestMarkerType } from '../MiniMapSystem';
import { secondsLabel, type TrackerEntry, type TrackerTarget } from '../questTracker';
import type { GroundPickupSystem } from '../GroundPickupSystem';
import type { DefenseStructures } from './DefenseStructures';
import type { Circumstance, VillagerId } from './ratkinDialogue';
import {
  type OpeningPages,
  type QuestLineProvider,
  type QuestOpening,
  type VillagerContext,
  onceFlagFor,
} from './villagerCircumstances';
import type { ConversationController, ConversationTopic, TopicProvider } from './villagerTopics';
import type { VillagerSystem } from './VillagerSystem';
import { ASSAULT_WAVE_COUNT, type VillageAssaultSystem } from './VillageAssaultSystem';

export const BRIAR_HOLLOW_QUEST_ID = 'briar_hollow_plea';
export const BRIAR_HOLLOW_QUEST_NAME = "Briar Hollow's Plea";

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

/** Tikka's gathering tasks: what she wants to see before she will teach Construction. */
export const TIKKA_WOOD_TARGET = 10;
export const TIKKA_STONE_TARGET = 10;
export const TIKKA_BOARDS_TARGET = 1;
export const TIKKA_ROPE_TARGET = 1;

/** Segments at wood or better, alongside stone or a trebuchet, before the Mayor calls it advanced. */
export const FORTIFICATIONS_ADVANCED_WALLS = 8;

const READY_TOPIC_KEY = 'quest_ready';
const HELP_TOPIC_KEY = 'quest_how_can_we_help';
const ACCEPT_TOPIC_KEY = 'quest_accept';
const DECLINE_TOPIC_KEY = 'quest_decline';
const TEACH_AGAIN_TOPIC_KEY = 'quest_construction_again';

const CONFIRM_MESSAGE =
  "The necromancer's forces will march on Briar Hollow once you give the word. Everything you've built is what you'll have. Begin?";

type TaskId = 'wood' | 'stone' | 'boards' | 'rope';

/** A gathering task: the counter it reads, what the party may already hold, and the target. */
interface GatheringTask {
  readonly id: TaskId;
  readonly label: string;
  readonly resource: 'wood' | 'stone' | 'wood_board' | 'rope';
  readonly target: number;
  readonly counted: (quest: VillageQuestState) => number;
}

const GATHERING_TASKS: readonly GatheringTask[] = [
  {
    id: 'wood',
    label: 'Wood',
    resource: 'wood',
    target: TIKKA_WOOD_TARGET,
    counted: (quest) => quest.gathering.woodChopped,
  },
  {
    id: 'stone',
    label: 'Stone',
    resource: 'stone',
    target: TIKKA_STONE_TARGET,
    counted: (quest) => quest.gathering.stoneMined,
  },
  {
    id: 'boards',
    label: 'Boards',
    resource: 'wood_board',
    target: TIKKA_BOARDS_TARGET,
    counted: (quest) => quest.gathering.boardsProcessed,
  },
  {
    id: 'rope',
    label: 'Rope',
    resource: 'rope',
    target: TIKKA_ROPE_TARGET,
    counted: (quest) => quest.gathering.ropeProcessed,
  },
];

/** Tikka's line for the first task still undone, in the order she gives them. */
const TASK_LINE: Readonly<Record<TaskId, Circumstance>> = {
  wood: 'axe_task',
  stone: 'pickaxe_task',
  boards: 'wood_processing_task',
  rope: 'wood_processing_task',
};

/** What the fortifications stand at, for the Mayor's lines and the journal. */
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

/** Any segment at a wooden wall or better: the Mayor will hear "We're ready". */
export function hasWoodenWall(tally: FortificationTally): boolean {
  return tally.wooden + tally.stone + tally.fortified > 0;
}

/** Walls, a trebuchet or a snare built: the village has started to fortify. */
function fortificationsStarted(tally: FortificationTally): boolean {
  return hasWoodenWall(tally) || tally.trebuchets > 0 || tally.snares > 0;
}

/** Most of a wall's length, and something heavier than wood: the village has changed. */
function fortificationsAdvanced(tally: FortificationTally): boolean {
  const walls = tally.wooden + tally.stone + tally.fortified;
  const heavier = tally.stone + tally.fortified > 0 || tally.trebuchets > 0;
  return walls >= FORTIFICATIONS_ADVANCED_WALLS && heavier;
}

export interface VillageQuestSystemDeps {
  readonly bus: EventBus;
  readonly audio: AudioManager | null;
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
}

function itemReward(id: ItemId, quantity: number): GrantedReward {
  const def = ITEM_DEF[id];
  return {
    kind: 'item',
    name: `${def.name} ×${quantity}`,
    description: def.description ?? '',
    renderIcon: (ctx, x, y, size) => drawItemIcon(ctx, { ...def, quantity }, x, y, size),
  };
}

export class VillageQuestSystem implements QuestLineProvider, TopicProvider {
  private readonly questManager = new QuestManager();
  private readonly confirm: ConfirmModal;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(private readonly deps: VillageQuestSystemDeps) {
    this.confirm = new ConfirmModal(deps.audio);
    const def: QuestDef = {
      id: BRIAR_HOLLOW_QUEST_ID,
      name: BRIAR_HOLLOW_QUEST_NAME,
      type: 'story',
      rewards: { xp: BRIAR_HOLLOW_QUEST_XP, coins: BRIAR_HOLLOW_QUEST_COINS },
    };
    this.questManager.register(def);
    this.syncQuestManager();
    deps.villagers.setQuestLineProvider(this);
    deps.villagers.addTopicProvider(this);
    const { bus } = deps;
    this.unsubscribers.push(
      bus.on('toolsGranted', () => {
        if (this.phase === 'need_tools') this.setPhase('gathering');
      }),
      bus.on('resourceHarvested', ({ id, amount }) => this.noteHarvest(id, amount)),
      bus.on('woodProcessed', ({ output, count }) => this.noteProcessed(output, count)),
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

  // ── Gathering ─────────────────────────────────────────────────────────────

  private noteHarvest(id: string, amount: number): void {
    if (this.phase !== 'gathering') return;
    if (id === 'wood') this.quest.gathering.woodChopped += amount;
    else if (id === 'stone') this.quest.gathering.stoneMined += amount;
  }

  private noteProcessed(output: string, count: number): void {
    if (this.phase !== 'gathering') return;
    if (output === 'boards') this.quest.gathering.boardsProcessed += count;
    else if (output === 'rope') this.quest.gathering.ropeProcessed += count;
  }

  /**
   * A task's progress: what was gathered since the tasks were set, or what
   * the party already holds, whichever is more — Tikka wants to see the
   * materials, and does not mind where they came from.
   */
  taskProgress(task: GatheringTask): number {
    const held = partyCount(this.deps.human, this.deps.cat, task.resource);
    return Math.max(task.counted(this.quest), held);
  }

  private taskDone(task: GatheringTask): boolean {
    return this.taskProgress(task) >= task.target;
  }

  /** Whether every one of Tikka's tasks is done. */
  get gatheringComplete(): boolean {
    return GATHERING_TASKS.every((task) => this.taskDone(task));
  }

  private firstUndoneTask(): GatheringTask | null {
    return GATHERING_TASKS.find((task) => !this.taskDone(task)) ?? null;
  }

  // ── Who says what ─────────────────────────────────────────────────────────

  lineFor(villager: VillagerId, ctx: VillagerContext): QuestOpening | null {
    if (villager === 'bramblewick') return this.mayorLine(ctx);
    if (villager === 'tikka') return this.tikkaLine(ctx);
    return null;
  }

  private mayorLine(ctx: VillagerContext): QuestOpening | null {
    const once = (circumstance: Circumstance): string => onceFlagFor('bramblewick', circumstance);
    switch (ctx.quest.phase) {
      case 'unmet':
        // The greeting, and then the rest of what he has to say, come from the
        // ordinary ladder; the offer waits for "How can we help?".
        return null;
      case 'offered':
      case 'declined':
        return { pages: ['quest_offer'] };
      case 'need_tools':
        return { pages: ['before_tools'] };
      case 'gathering': {
        const flag = once('tools_obtained');
        if (!ctx.onceFlags.includes(flag)) return { pages: ['tools_obtained'], onceFlag: flag };
        return { pages: ['resourcing_unlocked'] };
      }
      case 'fortifying': {
        const flag = once('construction_unlocked');
        if (!ctx.onceFlags.includes(flag)) {
          return { pages: ['construction_unlocked'], onceFlag: flag };
        }
        const tally = tallyFortifications(this.deps.state);
        if (fortificationsAdvanced(tally)) return { pages: ['fortifications_advanced'] };
        if (fortificationsStarted(tally)) return { pages: ['fortifications_started'] };
        return { pages: ['construction_unlocked'] };
      }
      case 'victory':
        return {
          pages: this.victoryPages(),
          onShown: (ctl) => this.turnIn(ctl),
        };
      case 'repelled_failed':
        return {
          pages: ['after_village_damage'],
          onShown: (ctl) => {
            this.setPhase('fortifying');
            ctl.showRootTopics();
          },
        };
      case 'complete':
        return { pages: ctx.talkCount % 2 === 0 ? ['quest_complete'] : ['after_victory'] };
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
      ? ['after_victory', 'after_village_damage', 'quest_complete']
      : ['after_victory', 'quest_complete'];
  }

  private tikkaLine(ctx: VillagerContext): QuestOpening | null {
    switch (ctx.quest.phase) {
      case 'unmet':
      case 'offered':
      case 'declined':
        return ctx.talkCount === 0
          ? { pages: ['first_meeting', 'quest_explanation'] }
          : { pages: ['quest_explanation'] };
      case 'need_tools':
        return { pages: ['tools_required'] };
      case 'gathering': {
        const task = this.firstUndoneTask();
        if (task !== null) return { pages: [TASK_LINE[task.id]] };
        return {
          pages: [
            'construction_explanation',
            'construction_skill_granted',
            'construction_tutorial_trigger',
            'wooden_wall_explanation',
          ],
          onShown: (ctl) => this.teachConstruction(ctl),
        };
      }
      case 'fortifying':
      case 'repelled_failed':
        return { pages: ['construction_skill_already_granted'] };
      case 'imminent':
      case 'assault':
      case 'victory':
      case 'complete':
        return null;
    }
  }

  /**
   * Tikka teaches both crawlers Construction as she says so, the village
   * moves on to fortifying, and the explainer opens once the conversation
   * has closed — it halts the world, and a halted world closes a street
   * conversation mid-lesson.
   */
  private teachConstruction(ctl: ConversationController): void {
    teachBoth(this.deps.human, this.deps.cat, 'construction');
    this.setPhase('fortifying');
    ctl.showRootTopics();
    ctl.afterClose(() => {
      if (!this.deps.active().isAlive) return;
      this.deps.afterRewardsDrain(() => this.showConstructionExplainer());
    });
  }

  private showConstructionExplainer(): void {
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

  topics(villager: VillagerId, ctx: VillagerContext): readonly ConversationTopic[] {
    if (villager === 'bramblewick') return this.mayorTopics(ctx);
    if (villager === 'tikka') return this.tikkaTopics(ctx);
    return [];
  }

  private mayorTopics(ctx: VillagerContext): readonly ConversationTopic[] {
    const phase = ctx.quest.phase;
    if (phase === 'unmet') {
      return [
        {
          key: HELP_TOPIC_KEY,
          label: 'How can we help?',
          run: (ctl) => {
            this.setPhase('offered');
            ctl.say('quest_offer');
            ctl.showTopics(this.offerChoices());
          },
        },
      ];
    }
    if (phase === 'offered' || phase === 'declined') return this.offerChoices();
    if (phase === 'fortifying' && hasWoodenWall(tallyFortifications(this.deps.state))) {
      return [
        {
          key: READY_TOPIC_KEY,
          label: "We're ready.",
          run: (ctl) => {
            ctl.afterClose(() => this.confirmReady());
            ctl.close();
          },
        },
      ];
    }
    return [];
  }

  private offerChoices(): readonly ConversationTopic[] {
    return [
      {
        key: ACCEPT_TOPIC_KEY,
        label: 'Accept',
        run: (ctl) => this.accept(ctl),
      },
      {
        key: DECLINE_TOPIC_KEY,
        label: 'Decline',
        run: (ctl) => {
          this.setPhase('declined');
          ctl.say('quest_declined');
          ctl.showRootTopics();
        },
      },
    ];
  }

  private accept(ctl: ConversationController): void {
    if (hasAcceptedMayorRequest(this.phase)) return;
    this.setPhase('need_tools');
    this.deps.bus.emit('questStarted', { questId: BRIAR_HOLLOW_QUEST_ID });
    ctl.say('quest_accepted');
    ctl.showRootTopics();
  }

  private tikkaTopics(ctx: VillagerContext): readonly ConversationTopic[] {
    const phase = ctx.quest.phase;
    const teachable =
      phase === 'fortifying' ||
      phase === 'repelled_failed' ||
      phase === 'victory' ||
      phase === 'complete';
    if (!teachable || !this.constructionLearnedByAnyone()) return [];
    return [
      {
        key: TEACH_AGAIN_TOPIC_KEY,
        label: 'Teach me again',
        run: (ctl) => {
          // Either crawler who somehow lacks it learns it now, as both were taught together.
          teachBoth(this.deps.human, this.deps.cat, 'construction');
          ctl.say('construction_skill_already_granted');
          ctl.afterClose(() => {
            if (this.deps.active().isAlive) this.showConstructionExplainer();
          });
        },
      },
    ];
  }

  // ── "We're ready" ─────────────────────────────────────────────────────────

  private confirmReady(): void {
    if (this.phase !== 'fortifying' || !this.deps.active().isAlive) return;
    this.confirm.open({
      message: CONFIRM_MESSAGE,
      yesLabel: 'Begin',
      noLabel: 'Not yet',
      onYes: () => this.deps.assault()?.begin(),
      onNo: () => undefined,
    });
  }

  // ── The reward ────────────────────────────────────────────────────────────

  /**
   * The Mayor's thanks are spoken: everything the quest promised is handed
   * over, here, in code — the pages only say so — and exactly once, however
   * many times he is asked afterwards.
   */
  private turnIn(ctl: ConversationController): void {
    if (this.phase !== 'victory') return;
    this.grantRewards();
    this.setPhase('complete');
    ctl.showRootTopics();
    ctl.afterClose(() => {
      if (!this.deps.active().isAlive) return;
      this.deps.enqueueReward(itemReward('hamburger', BRIAR_HOLLOW_REWARD_BURGERS));
      this.deps.enqueueReward(itemReward('hollow_stew', BRIAR_HOLLOW_REWARD_STEW));
    });
  }

  /** Pays out the quest's rewards unless they have been paid already. Returns whether it paid. */
  grantRewards(): boolean {
    const quest = this.quest;
    if (quest.rewardsGranted) return false;
    quest.rewardsGranted = true;
    const active = this.deps.active();
    awardXp(active, BRIAR_HOLLOW_QUEST_XP, this.deps.bus);
    active.earnCoins(BRIAR_HOLLOW_QUEST_COINS);
    this.giveOrDrop(active, 'hamburger', BRIAR_HOLLOW_REWARD_BURGERS);
    this.giveOrDrop(active, 'hollow_stew', BRIAR_HOLLOW_REWARD_STEW);
    this.questManager.startQuest(BRIAR_HOLLOW_QUEST_ID);
    this.questManager.completeQuest(BRIAR_HOLLOW_QUEST_ID);
    this.deps.bus.emit('questCompleted', { questId: BRIAR_HOLLOW_QUEST_ID });
    this.deps.announce(
      `${BRIAR_HOLLOW_QUEST_NAME} complete: +${BRIAR_HOLLOW_QUEST_XP} XP, +${BRIAR_HOLLOW_QUEST_COINS} coins`,
    );
    return true;
  }

  /** Into the bag if it fits; otherwise onto the ground at the Mayor's feet. */
  private giveOrDrop(crawler: HumanPlayer | CatPlayer, id: ItemId, quantity: number): void {
    if (crawler.inventory.hasRoomFor(id)) {
      crawler.inventory.addItem(id, quantity);
      return;
    }
    const mayor = this.deps.villagers.villagerFor('bramblewick');
    const x = (mayor?.x ?? crawler.x) + TILE_SIZE * TILE_CENTRE;
    const y = (mayor?.y ?? crawler.y) + TILE_SIZE * TILE_CENTRE;
    if (id === 'hamburger') {
      this.deps.groundPickups.spawnBurgers(x, y, quantity);
      return;
    }
    this.deps.dropItems(x, y, [{ id, quantity }]);
  }

  // ── Markers and the journal ───────────────────────────────────────────────

  /** The glyph over a villager's head. */
  markerFor(villager: VillagerId, _ctx: VillagerContext): NPCMarkerType {
    if (villager === 'bramblewick' && !hasAcceptedMayorRequest(this.phase)) return 'exclamation';
    return this.targetVillager() === villager ? 'question' : 'none';
  }

  /** Whoever the questline wants the party to talk to next, if it is somebody. */
  private targetVillager(): VillagerId | null {
    switch (this.phase) {
      case 'need_tools':
        return 'oren';
      case 'gathering':
        return this.gatheringComplete ? 'tikka' : null;
      case 'fortifying':
        return hasWoodenWall(tallyFortifications(this.deps.state)) ? 'bramblewick' : null;
      case 'offered':
      case 'declined':
      case 'victory':
      case 'repelled_failed':
        return 'bramblewick';
      case 'unmet':
      case 'imminent':
      case 'assault':
      case 'complete':
        return null;
    }
  }

  private villagerTarget(id: VillagerId): TrackerTarget | undefined {
    const villager = this.deps.villagers.villagerFor(id);
    if (villager === null) return undefined;
    return { x: villager.tile.x, y: villager.tile.y, wearsOwnMarker: true };
  }

  private anchorTarget(tiles: readonly TilePoint[] | undefined): TrackerTarget | undefined {
    const tile = tiles?.[0];
    return tile === undefined ? undefined : { x: tile.x, y: tile.y };
  }

  /** Where a gathering task is done: the lumber yard, the quarry, then the sawmill. */
  private taskTarget(task: GatheringTask): TrackerTarget | undefined {
    const anchors = this.deps.site.villagerAnchors;
    switch (task.id) {
      case 'wood':
        return this.anchorTarget(anchors.lumber_yard);
      case 'stone':
        return this.anchorTarget(anchors.quarry);
      case 'boards':
      case 'rope': {
        const saw = this.deps.site.lumberYard.sawmillAnchor;
        return { x: saw.x, y: saw.y };
      }
    }
  }

  private gatheringObjective(): string {
    const parts = GATHERING_TASKS.map(
      (task) => `${task.label} ${Math.min(task.target, this.taskProgress(task))}/${task.target}`,
    );
    return `Gather for Tikka — ${parts.join(' · ')}`;
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
      case 'unmet':
        if (this.deps.state.talkCounts.bramblewick === 0) return null;
        return {
          ...base,
          status: 'available',
          objective: 'Speak with Mayor Bramblewick',
          target: mayor(),
        };
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
      case 'gathering': {
        const task = this.firstUndoneTask();
        if (task === null) {
          return {
            ...base,
            status: 'active',
            objective: 'Report to Tikka',
            target: this.villagerTarget('tikka'),
          };
        }
        return {
          ...base,
          status: 'active',
          objective: this.gatheringObjective(),
          target: this.taskTarget(task),
        };
      }
      case 'fortifying': {
        const tally = tallyFortifications(this.deps.state);
        const objective =
          `Fortify Briar Hollow — ${tally.wooden} wooden · ${tally.stone} stone · ` +
          `${tally.fortified} fortified · ${tally.trebuchets} trebuchets · ${tally.snares} snares`;
        const gate = this.deps.site.gate.inside;
        return {
          ...base,
          status: 'active',
          objective,
          hint: "Tell the Mayor when you're ready.",
          target: hasWoodenWall(tally) ? mayor() : { x: gate.x, y: gate.y },
        };
      }
      case 'imminent': {
        const frames = this.quest.imminentCountdownFrames;
        const bell = this.deps.site.square.bellTile;
        return {
          ...base,
          status: 'active',
          objective: `The dead are coming — ${secondsLabel(frames)}`,
          target: { x: bell.x, y: bell.y },
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
          objective: 'The bell fell. Speak with Mayor Bramblewick.',
          target: mayor(),
        };
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
    const bell = this.deps.site.square.bellTile;
    const objective = lastWave
      ? 'Defeat Vordrick Boneharrow'
      : `Defend Briar Hollow — Wave ${wave}/${ASSAULT_WAVE_COUNT} · Bell ${bellPercent}%`;
    const target: TrackerTarget =
      necro === null
        ? { x: bell.x, y: bell.y }
        : {
            x: Math.floor(necro.x / TILE_SIZE + TILE_CENTRE),
            y: Math.floor(necro.y / TILE_SIZE + TILE_CENTRE),
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

  // ── The confirm modal ─────────────────────────────────────────────────────

  get isConfirmOpen(): boolean {
    return this.confirm.isOpen;
  }

  overlayClaim(): OverlayInputClaim {
    return this.confirm.overlayClaim();
  }

  renderDialog(ctx: CanvasRenderingContext2D): void {
    this.confirm.render(ctx);
  }

  handleClick(mx: number, my: number): boolean {
    return this.confirm.handleClick(mx, my);
  }

  handleKeyDown(key: string): boolean {
    return this.confirm.handleKey(key);
  }

  /** Answers "Not yet" for the player: death, or a rewind, takes the question down. */
  closeConfirm(): void {
    this.confirm.close();
  }

  dispose(): void {
    this.confirm.close();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
    this.deps.villagers.setQuestLineProvider(null);
  }
}

const TILE_CENTRE = 0.5;
const PERCENT = 100;
