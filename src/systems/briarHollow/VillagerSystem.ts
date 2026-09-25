/**
 * Briar Hollow's civilians: where they are, where they are going, what they
 * say, and the conversation the party has with them.
 *
 * Rebuilt with the scene on every door visit. Nothing mid-walk survives that —
 * a rebuilt village has everyone back at their post (or in shelter while the
 * siege is on) — and everything that must survive it lives in the threaded
 * `BriarHollowState`: talk counts, one-shot lines, and the villagers' memory
 * of what recently happened near them.
 */

import type { AudioManager } from '../../audio/AudioManager';
import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import type { BriarHollowState, VillagerMemory } from '../../core/briarHollowState';
import type { VillageQuestPhase } from '../../core/villageQuestPhase';
import { CONVERSATION_WALK_AWAY_TILES } from '../../creatures/townInteraction';
import type { GameMap } from '../../map/GameMap';
import type { BriarHollowSite, VillagerAnchorKind } from '../../map/overworld/briarHollowSite';
import type { TilePoint } from '../../map/town/townPlan';
import { ratkinPortrait } from '../../sprites/ratkinPortrait';
import { drawInteractionPrompt } from '../../ui/InteractionPrompt';
import { type ConversationChoice, VillagerConversation } from '../../ui/VillagerConversation';
import {
  type Circumstance,
  type VillagerId,
  VILLAGER_IDS,
  line,
  villagerEntry,
} from './ratkinDialogue';
import { VillageNavigator } from './villageNavigator';
import { Villager } from './Villager';
import {
  DEPOSIT_NOTICE_RADIUS_TILES,
  type OpeningLine,
  type QuestLineProvider,
  type SoldierStance,
  type VillagerContext,
  type VillagerPartyState,
  openingLine,
} from './villagerCircumstances';
import {
  BACK_LABEL,
  BACK_TOPIC_KEY,
  BUILT_IN_TOPICS,
  type ConversationController,
  type ConversationTopic,
  GOODBYE_LABEL,
  type TopicProvider,
} from './villagerTopics';
import { CIVILIAN_CAST_IDS, type CivilianCastId, VILLAGER_ROUTINES } from './villagerRoutines';
import { SHELTERING_LINE, UNNAMED_VILLAGER_LINES, isUnnamedVillager } from './unnamedVillagerLines';

const UPDATES_PER_SECOND = 60;
const SECONDS_PER_UPDATE = 1 / UPDATES_PER_SECOND;
const TILE_CENTRE = 0.5;

/** How close, centre to centre, a crawler must be to talk to a villager. Facing is not required. */
export const VILLAGER_TALK_RANGE_TILES = 1.6;
/** Within this many tiles a villager's name shows under their feet. */
const NAME_LABEL_RANGE_TILES = 4;

/** A shop or service stays behind its counter while the party is this close to it. */
export const SERVICE_AT_POST_TILES = 6;
/**
 * A service heads back to its counter once the party comes this close — far
 * enough out that a crawler at a run cannot close the gap before the
 * shopkeeper is home.
 */
const SERVICE_RECALL_TILES = 40;
/** A service's outings stay within this many steps of the counter, so the walk home is always short. */
const SERVICE_STROLL_REACH_STEPS = 18;

/** Pace multiplier for anyone hurrying: to shelter, or a shopkeeper back to the counter. */
const HURRY_FACTOR = 1.8;
/** How far a villager looks for a free tile around an anchor. */
const SPOT_SEARCH_STEPS = 6;
/** Attempts at finding a reachable stroll destination before giving up and heading home. */
const STROLL_ATTEMPTS = 4;
/** Extra stops an outing may make before heading home. */
const MAX_EXTRA_STROLL_STOPS = 2;

/** Seconds standing at the post before deciding again. */
const POST_DWELL_MIN_SECONDS = 6;
const POST_DWELL_MAX_SECONDS = 14;
const POST_DWELL_MIN_FRAMES = POST_DWELL_MIN_SECONDS * UPDATES_PER_SECOND;
const POST_DWELL_MAX_FRAMES = POST_DWELL_MAX_SECONDS * UPDATES_PER_SECOND;
/** Seconds lingering at a stroll stop. */
const LINGER_MIN_SECONDS = 3;
const LINGER_MAX_SECONDS = 8;
const LINGER_MIN_FRAMES = LINGER_MIN_SECONDS * UPDATES_PER_SECOND;
const LINGER_MAX_FRAMES = LINGER_MAX_SECONDS * UPDATES_PER_SECOND;
/** A villager who could not plan a route tries again after this long. */
const RETRY_FRAMES = UPDATES_PER_SECOND;
/** Nobody in shelter decides anything; they stay until the siege is over. */
const SHELTER_HOLD_FRAMES = Number.MAX_SAFE_INTEGER;
/** The village comes out of hiding over this long, not all at once. */
const SIEGE_RETURN_SPREAD_SECONDS = 5;
const SIEGE_RETURN_SPREAD_FRAMES = SIEGE_RETURN_SPREAD_SECONDS * UPDATES_PER_SECOND;

/** A crawler this close ahead of a walking villager is in the way. */
const BLOCK_RADIUS_TILES = 0.75;
/** A villager held up this long picks another way round. */
const BLOCK_RETARGET_FRAMES = UPDATES_PER_SECOND;

/** How near the cat must pass for a child to take after her. */
const FOLLOW_NOTICE_TILES = 4;
/** A following child keeps this far back. */
const FOLLOW_KEEP_TILES = 1.2;
/** The longest a child trails the cat. */
const FOLLOW_MAX_SECONDS = 3;
const FOLLOW_MAX_FRAMES = FOLLOW_MAX_SECONDS * UPDATES_PER_SECOND;
/** Before the same child takes after her again. */
const FOLLOW_COOLDOWN_SECONDS = 20;
const FOLLOW_COOLDOWN_FRAMES = FOLLOW_COOLDOWN_SECONDS * UPDATES_PER_SECOND;

/** No villager barks more often than this. */
export const BARK_COOLDOWN_SECONDS = 45;
/** How far a petted cow can be for Merrit to see it. */
export const COW_PET_NOTICE_TILES = 10;
/** How far a crawler reaching for stew can be for Pipkin to see it. */
export const STEW_NOTICE_TILES = 6;
/** The unnamed four pipe up when the party passes this close. */
const AMBIENT_BARK_TILES = 4;
/** On average, how long one of them waits in range before speaking up unprompted. */
const AMBIENT_BARK_MEAN_WAIT_SECONDS = 4;
const AMBIENT_BARK_CHANCE_PER_FRAME = 1 / (AMBIENT_BARK_MEAN_WAIT_SECONDS * UPDATES_PER_SECOND);

const SIEGE_PHASES: ReadonlySet<VillageQuestPhase> = new Set(['imminent', 'assault']);

/** Someone in the party, by the top-left of their tile-sized body. */
export interface VillagerCrawler {
  readonly x: number;
  readonly y: number;
}

/** The party as the villagers see it this frame. */
export interface VillagerFrame {
  readonly human: VillagerCrawler;
  readonly cat: VillagerCrawler;
  readonly active: VillagerCrawler;
}

export interface VillagerSystemDeps {
  readonly gameMap: GameMap;
  readonly site: BriarHollowSite;
  readonly state: BriarHollowState;
  readonly bus: EventBus | null;
  readonly audio: AudioManager | null;
  /** The party's resources, tools and skills, read fresh for every conversation. */
  readonly party: () => VillagerPartyState;
  /** Defaults to `Math.random`; the gates pass a seeded stream. */
  readonly random?: () => number;
}

/**
 * Anyone the conversation panel can be opened with. The civilians are one
 * kind; the militia are another, owned elsewhere, and speak through the same
 * panel by implementing this.
 */
export interface ConversationSpeaker {
  readonly id: VillagerId;
  readonly x: number;
  readonly y: number;
  /** The standing orders a soldier is under; null for a civilian. */
  readonly soldierStance: SoldierStance | null;
  beginTalk(partner: VillagerCrawler): void;
  endTalk(): void;
}

interface ConversationSession {
  readonly speaker: ConversationSpeaker;
  readonly talker: VillagerCrawler;
  readonly controller: ConversationController;
  readonly afterClose: Array<() => void>;
}

function tileDistance(a: VillagerCrawler, b: VillagerCrawler): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_SIZE;
}

function tileOf(body: VillagerCrawler): TilePoint {
  return {
    x: Math.floor(body.x / TILE_SIZE + TILE_CENTRE),
    y: Math.floor(body.y / TILE_SIZE + TILE_CENTRE),
  };
}

function sameTile(a: TilePoint, b: TilePoint): boolean {
  return a.x === b.x && a.y === b.y;
}

function asVillagerId(id: CivilianCastId): VillagerId | null {
  return VILLAGER_IDS.find((villagerId) => villagerId === id) ?? null;
}

export class VillagerSystem {
  readonly villagers: readonly Villager[];
  readonly conversation: VillagerConversation;
  private readonly village: VillageNavigator;
  private readonly quarry: VillageNavigator;
  private readonly random: () => number;
  private readonly topicProviders: TopicProvider[] = [BUILT_IN_TOPICS];
  private questLines: QuestLineProvider | null = null;
  private session: ConversationSession | null = null;
  /**
   * Rows already picked this conversation, so they do not come back — a
   * shop or a submenu included, since choosing "Shop" once is still choosing
   * it. Cleared at the start of every conversation. "Back" is exempt: it is
   * navigation, not a thing to say, and every submenu needs it every time.
   */
  private consumedTopicKeys = new Set<string>();
  /** Bumped by every `showRootTopics`/`showSubmenu`, so a picked row's wrapper can tell whether its own `run` already moved the conversation on, or whether it must repaint the screen it is still standing on. */
  private menuGeneration = 0;
  /** Bumped by every `say`, so a picked row's wrapper can tell whether its `run` answered with lines of its own. */
  private pagesShown = 0;
  private currentTopicsSource: (() => readonly ConversationTopic[]) | null = null;
  private currentMenuIsSubmenu = false;
  private _lastOpening: OpeningLine | null = null;
  private lastPhase: VillageQuestPhase;
  private lastCatPosition: VillagerCrawler | null = null;
  private readonly unsubscribers: Array<() => void> = [];

  constructor(private readonly deps: VillagerSystemDeps) {
    this.random = deps.random ?? Math.random;
    this.village = new VillageNavigator(deps.gameMap, deps.site.interior);
    this.quarry = new VillageNavigator(deps.gameMap, deps.site.quarry.rect);
    this.conversation = new VillagerConversation(deps.audio);
    this.lastPhase = deps.state.quest.phase;
    this.villagers = this.populate();
    this.subscribe();
  }

  private get memory(): VillagerMemory {
    return this.deps.state.villagers;
  }

  private navigatorFor(villager: Villager): VillageNavigator {
    return villager.routine.bounds === 'quarry' ? this.quarry : this.village;
  }

  // ── Population ─────────────────────────────────────────────────────────

  /** The site's tiles for one kind of place. */
  private anchorsFor(kind: VillagerAnchorKind): readonly TilePoint[] {
    return this.deps.site.villagerAnchors[kind];
  }

  /** A free standable tile at one of `kind`'s anchors, starting from the `turn`th. */
  private allocateSpot(
    navigator: VillageNavigator,
    kind: VillagerAnchorKind,
    turn: number,
    taken: Set<number>,
  ): TilePoint {
    const anchors = this.anchorsFor(kind);
    for (let offset = 0; offset < anchors.length; offset++) {
      const anchor = anchors[(turn + offset) % anchors.length];
      const spot = navigator.nearestFreeSpot(anchor, taken, SPOT_SEARCH_STEPS);
      if (spot !== null) {
        taken.add(navigator.keyOf(spot.x, spot.y));
        return spot;
      }
    }
    // Every anchor lies inside the bounds by construction; this only answers
    // a map a later pass has walled in, by standing them somewhere they can.
    const { x, y, w, h } = navigator.bounds;
    const centre = { x: x + Math.floor(w / 2), y: y + Math.floor(h / 2) };
    const fallback = navigator.nearestFreeSpot(centre, taken, Math.max(w, h)) ?? centre;
    taken.add(navigator.keyOf(fallback.x, fallback.y));
    return fallback;
  }

  private populate(): Villager[] {
    const postsTaken = new Set<number>();
    const sheltersTaken = new Set<number>();
    const turns = new Map<VillagerAnchorKind, number>();
    const nextTurn = (kind: VillagerAnchorKind): number => {
      const turn = turns.get(kind) ?? 0;
      turns.set(kind, turn + 1);
      return turn;
    };
    const inSiege = SIEGE_PHASES.has(this.deps.state.quest.phase);
    return CIVILIAN_CAST_IDS.map((id, index) => {
      const routine = VILLAGER_ROUTINES[id];
      const navigator = routine.bounds === 'quarry' ? this.quarry : this.village;
      const post = this.allocateSpot(navigator, routine.post, nextTurn(routine.post), postsTaken);
      const shelter = this.allocateSpot(
        navigator,
        routine.shelter,
        nextTurn(routine.shelter),
        sheltersTaken,
      );
      const named = asVillagerId(id);
      const villager = new Villager(
        id,
        routine,
        named === null ? null : villagerEntry(named).name,
        post,
        shelter,
        inSiege ? shelter : post,
        index,
      );
      villager.state = inSiege ? 'sheltering' : 'working';
      villager.standFrames = inSiege
        ? SHELTER_HOLD_FRAMES
        : this.randomFrames(0, POST_DWELL_MAX_FRAMES);
      return villager;
    });
  }

  private randomFrames(min: number, max: number): number {
    return Math.floor(min + this.random() * (max - min));
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.random() * items.length) % items.length];
  }

  // ── Events ─────────────────────────────────────────────────────────────

  private subscribe(): void {
    const bus = this.deps.bus;
    if (bus === null) return;
    this.unsubscribers.push(
      bus.on('cowPetted', ({ x, y }) => this.noteCowPetted(x, y)),
      bus.on('stewRefusedOnCooldown', ({ eater }) => this.noteStewRefused(eater)),
      bus.on('resourceNodeDepleted', ({ kind, x, y }) => {
        if (kind === 'stone') this.noteDepositDepleted(x, y);
      }),
    );
  }

  private villagerById(id: CivilianCastId): Villager | undefined {
    return this.villagers.find((villager) => villager.id === id);
  }

  /** A cow was petted at world pixel (`x`, `y`). */
  noteCowPetted(x: number, y: number): void {
    const tileX = Math.floor(x / TILE_SIZE);
    const tileY = Math.floor(y / TILE_SIZE);
    this.memory.lastCowPet = { at: this.memory.clockSeconds, tileX, tileY };
    const merrit = this.villagerById('merrit');
    if (merrit === undefined) return;
    if (Math.hypot(merrit.tile.x - tileX, merrit.tile.y - tileY) > COW_PET_NOTICE_TILES) return;
    this.barkLine(merrit, 'cow_petted_nearby');
  }

  noteStewRefused(eater: VillagerCrawler): void {
    const pipkin = this.villagerById('pipkin');
    if (pipkin === undefined || tileDistance(pipkin, eater) > STEW_NOTICE_TILES) return;
    this.barkLine(pipkin, 'stew_cooldown_active');
  }

  /** A rock deposit crumbled at tile (`tileX`, `tileY`). */
  noteDepositDepleted(tileX: number, tileY: number): void {
    this.memory.lastDepositDepleted = { at: this.memory.clockSeconds, tileX, tileY };
    const garn = this.villagerById('garn');
    if (garn === undefined) return;
    if (Math.hypot(garn.tile.x - tileX, garn.tile.y - tileY) > DEPOSIT_NOTICE_RADIUS_TILES) return;
    this.barkLine(garn, 'deposit_depleted');
  }

  // ── Barks ──────────────────────────────────────────────────────────────

  private barkReady(villager: Villager): boolean {
    const readyAt = this.memory.barkReadyAt.get(villager.id) ?? 0;
    return this.memory.clockSeconds >= readyAt;
  }

  private sayBark(villager: Villager, text: string, force: boolean): boolean {
    if (villager.state === 'talking') return false;
    if (!force && !this.barkReady(villager)) return false;
    villager.bark.say(text);
    this.memory.barkReadyAt.set(villager.id, this.memory.clockSeconds + BARK_COOLDOWN_SECONDS);
    return true;
  }

  /** A named villager's verbatim line as a bubble over their head, respecting their cooldown. */
  private barkLine(villager: Villager, circumstance: Circumstance, force = false): boolean {
    const named = asVillagerId(villager.id);
    if (named === null) return false;
    const text = line(named, circumstance);
    if (text === undefined) return false;
    return this.sayBark(villager, text, force);
  }

  /**
   * Has a named villager call out a line over their head, the way the siege
   * and the militia bark. Returns whether it was said: not while they are in
   * a conversation, not while their bark is cooling down, and never a line
   * they do not have. `force` skips the cooldown, for a line answering
   * something the player just did — a shopkeeper finishing the job they
   * were paid for — which must never be swallowed by an earlier remark.
   */
  bark(id: VillagerId, circumstance: Circumstance, force = false): boolean {
    const villager = this.villagers.find((candidate) => candidate.id === id);
    return villager === undefined ? false : this.barkLine(villager, circumstance, force);
  }

  /** The civilian cast member standing in for `id`, or null when there is none on this map. */
  villagerFor(id: VillagerId): Villager | null {
    return this.villagers.find((candidate) => candidate.id === id) ?? null;
  }

  private unnamedRemark(villager: Villager, force: boolean): void {
    if (!isUnnamedVillager(villager.id)) return;
    const text =
      villager.state === 'sheltering'
        ? SHELTERING_LINE
        : this.pick(UNNAMED_VILLAGER_LINES[villager.id]);
    this.sayBark(villager, text, force);
  }

  // ── Providers ──────────────────────────────────────────────────────────

  /**
   * Adds rows under a villager's conversation. Later providers' rows come
   * after earlier ones', unless `first` puts this provider's rows ahead of
   * even the built-in ask-topics — for a service whose primary action (the
   * shop) should lead the list rather than trail the small talk.
   */
  addTopicProvider(provider: TopicProvider, opts?: { readonly first?: boolean }): void {
    if (opts?.first === true) this.topicProviders.unshift(provider);
    else this.topicProviders.push(provider);
  }

  setQuestLineProvider(provider: QuestLineProvider | null): void {
    this.questLines = provider;
  }

  // ── Context ────────────────────────────────────────────────────────────

  /** What `speaker` knows right now, for the opening resolver and the topic providers. */
  contextFor(
    id: VillagerId,
    position: VillagerCrawler,
    soldierStance: SoldierStance | null,
  ): VillagerContext {
    const { state } = this.deps;
    const memory = this.memory;
    const tile = tileOf(position);
    const within = (mark: VillagerMemory['lastCowPet'], radius: number): number | null => {
      if (mark === null) return null;
      return Math.hypot(mark.tileX - tile.x, mark.tileY - tile.y) <= radius ? mark.at : null;
    };
    const segments = state.structures.flatMap((structure) =>
      structure.kind === 'segment' ? [structure] : [],
    );
    const everWooden = segments.some(
      (segment) =>
        segment.tier === 'wood' ||
        segment.tier === 'stone' ||
        segment.tier === 'fortified' ||
        (segment.formerTier !== undefined && segment.formerTier !== 'fence'),
    );
    const stocks = Object.values(state.merchantStock);
    return {
      nowSeconds: memory.clockSeconds,
      quest: state.quest,
      talkCount: state.talkCounts[id],
      onceFlags: state.onceFlags,
      party: this.deps.party(),
      events: {
        lastCowPetNearbyAt: within(memory.lastCowPet, COW_PET_NOTICE_TILES),
        lastDepositDepletedNearAt: within(memory.lastDepositDepleted, DEPOSIT_NOTICE_RADIUS_TILES),
        firstWoodenWallBuilt: everWooden,
        stoneAtLastTalk: memory.stoneAtLastTalk[id] ?? null,
        lastStoneUpgradeHintAt: memory.lastStoneUpgradeHintAt,
      },
      breachExists: segments.some((segment) => segment.tier === 'breach'),
      woodenWallStanding: segments.some((segment) => segment.tier === 'wood'),
      lowestStock: stocks.length === 0 ? null : Math.min(...stocks),
      soldierStance,
    };
  }

  // ── Conversation ───────────────────────────────────────────────────────

  /** The opening the most recent conversation began with. */
  get lastOpening(): OpeningLine | null {
    return this._lastOpening;
  }

  get isConversationOpen(): boolean {
    return this.session !== null;
  }

  /** Where the villager in conversation stands, while the human is the one talking to them. */
  talkSpeakerFor(human: VillagerCrawler): VillagerCrawler | null {
    const session = this.session;
    if (session?.talker !== human) return null;
    return { x: session.speaker.x, y: session.speaker.y };
  }

  /** The nearest villager within talking range of `crawler`, or null. */
  talkTarget(crawler: VillagerCrawler): Villager | null {
    let best: Villager | null = null;
    let bestDistance = VILLAGER_TALK_RANGE_TILES;
    for (const villager of this.villagers) {
      const distance = tileDistance(villager, crawler);
      if (distance <= bestDistance) {
        best = villager;
        bestDistance = distance;
      }
    }
    return best;
  }

  /** The Space chain's entry: talk to the nearest villager in range. Returns whether a press was taken. */
  tryTalk(talker: VillagerCrawler): boolean {
    if (this.session !== null) return false;
    const target = this.talkTarget(talker);
    if (target === null) return false;
    this.talkTo(target, talker);
    return true;
  }

  /** Talks to one villager in particular — the one a tap landed on. */
  talkTo(target: Villager, talker: VillagerCrawler): void {
    const named = asVillagerId(target.id);
    if (named === null) {
      target.faceToward(talker.x, talker.y);
      this.unnamedRemark(target, true);
      return;
    }
    this.openConversation(this.speakerFor(target, named), talker);
  }

  /** The villager whose drawn body covers world pixel (`worldX`, `worldY`), or null. */
  villagerAtPoint(worldX: number, worldY: number): Villager | null {
    for (const villager of this.villagers) {
      const top = villager.headTop(villager.y, TILE_SIZE);
      const inside =
        worldX >= villager.x &&
        worldX <= villager.x + TILE_SIZE &&
        worldY >= top &&
        worldY <= villager.y + TILE_SIZE;
      if (inside) return villager;
    }
    return null;
  }

  private speakerFor(villager: Villager, id: VillagerId): ConversationSpeaker {
    return {
      id,
      get x() {
        return villager.x;
      },
      get y() {
        return villager.y;
      },
      soldierStance: null,
      beginTalk: (partner) => {
        villager.state = 'talking';
        villager.talkPartner = partner;
        villager.clearPath();
        villager.bark.clear();
        villager.faceToward(partner.x, partner.y);
      },
      endTalk: () => {
        villager.talkPartner = null;
        this.resumeAfterTalk(villager);
      },
    };
  }

  /**
   * Opens the panel with `speaker`, on the line the resolver picks for now.
   * Public so the militia, who are not civilians, speak through the same panel.
   */
  openConversation(speaker: ConversationSpeaker, talker: VillagerCrawler): void {
    if (this.session !== null) this.closeConversation();
    this.consumedTopicKeys = new Set();
    this.currentTopicsSource = null;
    this.currentMenuIsSubmenu = false;
    const id = speaker.id;
    const ctx = this.contextFor(id, speaker, speaker.soldierStance);
    const opening = openingLine(id, ctx, this.questLines);
    this._lastOpening = opening;
    const { state } = this.deps;
    state.talkCounts[id] = ctx.talkCount + 1;
    if (opening.onceFlag !== undefined && !state.onceFlags.includes(opening.onceFlag)) {
      state.onceFlags.push(opening.onceFlag);
    }
    if (opening.pages.includes('stone_upgrade_available')) {
      this.memory.lastStoneUpgradeHintAt = this.memory.clockSeconds;
    }
    this.memory.stoneAtLastTalk[id] = ctx.party.stone;

    const afterClose: Array<() => void> = [];
    const controller: ConversationController = {
      villager: id,
      say: (...circumstances) => this.sayInConversation(id, circumstances),
      showTopics: (topics) => this.showSubmenu(topics),
      showRootTopics: () => this.showRootTopics(),
      close: () => this.closeConversation(),
      afterClose: (run) => afterClose.push(run),
    };
    this.session = { speaker, talker, controller, afterClose };
    speaker.beginTalk(talker);
    this.conversation.open(villagerEntry(id).name, ratkinPortrait(id));
    this.showRootTopics();
    this.sayInConversation(id, opening.pages);
    opening.onShown?.(controller);
  }

  private sayInConversation(id: VillagerId, circumstances: readonly Circumstance[]): boolean {
    const texts: string[] = [];
    for (const circumstance of circumstances) {
      const text = line(id, circumstance);
      if (text === undefined) return false;
      texts.push(text);
    }
    this.conversation.showPages(texts);
    this.pagesShown++;
    return true;
  }

  /** Every provider's rows for the villager in conversation, in provider order. */
  rootTopicsFor(id: VillagerId, ctx: VillagerContext): ConversationTopic[] {
    return this.topicProviders.flatMap((provider) => provider.topics(id, ctx));
  }

  /**
   * Turns topics into choices, dropping any non-repeatable one already
   * picked this conversation. Picking one marks it consumed (repeatable
   * rows never are), then — unless its own `run` already moved the
   * conversation elsewhere (a fresh `menuGeneration`) — repaints whichever
   * screen is still showing, so a service menu loses the row just used
   * without losing the rest of what it offers.
   */
  private toChoices(topics: readonly ConversationTopic[]): ConversationChoice[] {
    const session = this.session;
    if (session === null) return [];
    return topics
      .filter((topic) => topic.repeatable === true || !this.consumedTopicKeys.has(topic.key))
      .map((topic) => ({
        label: topic.label,
        run: () => {
          if (topic.repeatable !== true) this.consumedTopicKeys.add(topic.key);
          const generationBeforeRun = this.menuGeneration;
          const pagesBeforeRun = this.pagesShown;
          topic.run(session.controller);
          const menuUnchanged = this.menuGeneration === generationBeforeRun;
          if (this.session === null || !menuUnchanged) return;
          this.renderCurrentMenu();
          // A topic that answers and moves on to nothing else has said its
          // piece: reading its last page ends the talk, so whatever it queued
          // for after the conversation (a reward card, an explainer) follows
          // straight on instead of the menu coming back up in its way.
          const answered = this.pagesShown !== pagesBeforeRun;
          if (answered) this.conversation.endAfterPages(() => this.closeConversation());
        },
      }));
  }

  private showRootTopics(): void {
    const session = this.session;
    if (session === null) return;
    this.menuGeneration++;
    const { id, soldierStance } = session.speaker;
    this.currentTopicsSource = () =>
      this.rootTopicsFor(id, this.contextFor(id, session.speaker, soldierStance));
    this.currentMenuIsSubmenu = false;
    this.renderCurrentMenu();
  }

  private showSubmenu(topics: readonly ConversationTopic[]): void {
    if (this.session === null) return;
    this.menuGeneration++;
    this.currentTopicsSource = () => topics;
    this.currentMenuIsSubmenu = true;
    this.renderCurrentMenu();
  }

  /** Repaints the currently open screen (root or submenu) from its source topics, with consumed rows dropped. */
  private renderCurrentMenu(): void {
    if (this.session === null || this.currentTopicsSource === null) return;
    const topics = this.currentTopicsSource();
    if (!this.currentMenuIsSubmenu) {
      const goodbye: ConversationChoice = {
        label: GOODBYE_LABEL,
        isExit: true,
        run: () => this.closeConversation(),
      };
      this.conversation.setChoices([...this.toChoices(topics), goodbye]);
      return;
    }
    const back: ConversationTopic = {
      key: BACK_TOPIC_KEY,
      label: BACK_LABEL,
      run: () => this.showRootTopics(),
      repeatable: true,
    };
    const choices = this.toChoices([...topics, back]);
    const last = choices.length - 1;
    this.conversation.setChoices(
      choices.map((choice, index) => (index === last ? { ...choice, isExit: true } : choice)),
    );
  }

  closeConversation(): void {
    const session = this.session;
    if (session === null) return;
    this.session = null;
    this.conversation.close();
    session.speaker.endTalk();
    for (const run of session.afterClose) run();
  }

  // ── Routines ───────────────────────────────────────────────────────────

  private isPartyNear(point: TilePoint, frame: VillagerFrame, tiles: number): boolean {
    const at = { x: point.x * TILE_SIZE, y: point.y * TILE_SIZE };
    return tileDistance(frame.human, at) <= tiles || tileDistance(frame.cat, at) <= tiles;
  }

  private occupiedKeys(navigator: VillageNavigator, except: Villager): Set<number> {
    const keys = new Set<number>();
    for (const villager of this.villagers) {
      if (villager === except || this.navigatorFor(villager) !== navigator) continue;
      const spot = villager.destination ?? villager.tile;
      if (navigator.contains(spot.x, spot.y)) keys.add(navigator.keyOf(spot.x, spot.y));
    }
    return keys;
  }

  private walkTo(villager: Villager, goal: TilePoint, avoid?: ReadonlySet<number>): boolean {
    const route = this.navigatorFor(villager).findPath(villager.tile, goal, avoid);
    if (route === null) return false;
    villager.setPath(route);
    return true;
  }

  private goToPost(villager: Villager, hurrying: boolean): void {
    villager.state = 'returning';
    villager.hurrying = hurrying;
    if (sameTile(villager.tile, villager.post)) {
      villager.clearPath();
      this.arrive(villager);
      return;
    }
    if (!this.walkTo(villager, villager.post)) villager.standFrames = RETRY_FRAMES;
  }

  private goToShelter(villager: Villager): void {
    villager.state = 'sheltering';
    villager.hurrying = true;
    villager.followFramesLeft = 0;
    villager.resumeDelayFrames = 0;
    villager.standFrames = SHELTER_HOLD_FRAMES;
    if (sameTile(villager.tile, villager.shelter)) {
      villager.clearPath();
      return;
    }
    if (!this.walkTo(villager, villager.shelter)) villager.standFrames = RETRY_FRAMES;
  }

  /** One leg of an outing: somewhere on the routine's list, reachable and free. */
  private strollLeg(villager: Villager): void {
    const navigator = this.navigatorFor(villager);
    const taken = this.occupiedKeys(navigator, villager);
    for (let attempt = 0; attempt < STROLL_ATTEMPTS; attempt++) {
      const kind = this.pick(villager.routine.strolls);
      const anchors = this.anchorsFor(kind);
      if (anchors.length === 0) continue;
      const spot = navigator.nearestFreeSpot(this.pick(anchors), taken, SPOT_SEARCH_STEPS);
      if (spot === null || sameTile(spot, villager.tile)) continue;
      const route = navigator.findPath(villager.tile, spot);
      if (route === null) continue;
      if (villager.routine.service) {
        const home = navigator.findPath(spot, villager.post);
        if (home === null || home.length > SERVICE_STROLL_REACH_STEPS) continue;
      }
      villager.state = 'strolling';
      villager.hurrying = false;
      villager.setPath(route);
      return;
    }
    this.goToPost(villager, false);
  }

  private arrive(villager: Villager): void {
    villager.hurrying = villager.state === 'sheltering' ? villager.hurrying : false;
    switch (villager.state) {
      case 'strolling':
        villager.standFrames = this.randomFrames(LINGER_MIN_FRAMES, LINGER_MAX_FRAMES);
        return;
      case 'returning':
        villager.state = 'working';
        villager.facingX = 0;
        villager.facingY = 1;
        villager.standFrames = this.randomFrames(POST_DWELL_MIN_FRAMES, POST_DWELL_MAX_FRAMES);
        return;
      case 'sheltering':
        villager.hurrying = false;
        villager.facingX = 0;
        villager.facingY = 1;
        villager.standFrames = SHELTER_HOLD_FRAMES;
        return;
      case 'working':
      case 'talking':
        villager.standFrames = this.randomFrames(POST_DWELL_MIN_FRAMES, POST_DWELL_MAX_FRAMES);
    }
  }

  private decide(villager: Villager, frame: VillagerFrame): void {
    switch (villager.state) {
      case 'sheltering':
        if (!sameTile(villager.tile, villager.shelter)) this.goToShelter(villager);
        else villager.standFrames = SHELTER_HOLD_FRAMES;
        return;
      case 'working': {
        const keptAtCounter =
          villager.routine.service && this.isPartyNear(villager.post, frame, SERVICE_RECALL_TILES);
        if (keptAtCounter || this.random() < villager.routine.postShare) {
          villager.standFrames = this.randomFrames(POST_DWELL_MIN_FRAMES, POST_DWELL_MAX_FRAMES);
          return;
        }
        villager.strollStopsLeft = Math.floor(this.random() * (MAX_EXTRA_STROLL_STOPS + 1));
        this.strollLeg(villager);
        return;
      }
      case 'strolling':
        if (villager.strollStopsLeft > 0) {
          villager.strollStopsLeft--;
          this.strollLeg(villager);
        } else {
          this.goToPost(villager, false);
        }
        return;
      case 'returning':
        this.goToPost(villager, villager.hurrying);
        return;
      case 'talking':
        return;
    }
  }

  private resumeAfterTalk(villager: Villager): void {
    if (SIEGE_PHASES.has(this.deps.state.quest.phase)) {
      this.goToShelter(villager);
      return;
    }
    if (sameTile(villager.tile, villager.post)) {
      villager.state = 'working';
      villager.standFrames = this.randomFrames(POST_DWELL_MIN_FRAMES, POST_DWELL_MAX_FRAMES);
      return;
    }
    this.goToPost(villager, false);
  }

  /** A crawler standing just ahead of a walking villager. */
  private blockingCrawler(villager: Villager, frame: VillagerFrame): boolean {
    const next = villager.nextWaypoint;
    if (next === null) return false;
    const headingX = next.x * TILE_SIZE - villager.x;
    const headingY = next.y * TILE_SIZE - villager.y;
    return [frame.human, frame.cat].some((crawler) => {
      const dx = crawler.x - villager.x;
      const dy = crawler.y - villager.y;
      const close = Math.hypot(dx, dy) <= BLOCK_RADIUS_TILES * TILE_SIZE;
      return close && dx * headingX + dy * headingY > 0;
    });
  }

  /** Held up by a crawler: go round them, or somewhere else entirely. */
  private detour(villager: Villager, frame: VillagerFrame): void {
    const navigator = this.navigatorFor(villager);
    const avoid = new Set<number>();
    for (const crawler of [frame.human, frame.cat]) {
      const tile = tileOf(crawler);
      if (navigator.contains(tile.x, tile.y)) avoid.add(navigator.keyOf(tile.x, tile.y));
    }
    const goal = villager.destination;
    if (goal !== null && !avoid.has(navigator.keyOf(goal.x, goal.y))) {
      if (this.walkTo(villager, goal, avoid)) return;
    }
    villager.clearPath();
    if (villager.state === 'strolling' || villager.state === 'working') {
      this.strollLeg(villager);
    } else {
      villager.standFrames = RETRY_FRAMES;
    }
  }

  private catMoved(frame: VillagerFrame): boolean {
    const last = this.lastCatPosition;
    return last !== null && (last.x !== frame.cat.x || last.y !== frame.cat.y);
  }

  private isInsideBuilding(tile: TilePoint): boolean {
    return this.deps.site.buildings.some(
      (building) =>
        tile.x >= building.rect.x &&
        tile.y >= building.rect.y &&
        tile.x < building.rect.x + building.rect.w &&
        tile.y < building.rect.y + building.rect.h,
    );
  }

  /** A child trailing the cat. Returns whether the child is following this frame. */
  private updateFollow(villager: Villager, frame: VillagerFrame, speedPx: number): boolean {
    if (villager.followCooldownFrames > 0) villager.followCooldownFrames--;
    const catTile = tileOf(frame.cat);
    const catIndoors = this.isInsideBuilding(catTile);
    if (villager.followFramesLeft > 0) {
      villager.followFramesLeft--;
      const navigator = this.navigatorFor(villager);
      const keepBack = tileDistance(villager, frame.cat) <= FOLLOW_KEEP_TILES;
      const ended = villager.followFramesLeft === 0 || catIndoors;
      if (ended || !navigator.isPassable(catTile.x, catTile.y)) {
        villager.followFramesLeft = 0;
        villager.followCooldownFrames = FOLLOW_COOLDOWN_FRAMES;
        this.strollLeg(villager);
        return false;
      }
      if (keepBack) {
        villager.standStill();
        return true;
      }
      const beforeX = villager.x;
      const beforeY = villager.y;
      villager.stepToward(frame.cat.x, frame.cat.y, speedPx);
      const landed = villager.tile;
      if (!navigator.isPassable(landed.x, landed.y)) {
        villager.x = beforeX;
        villager.y = beforeY;
        villager.standStill();
      }
      return true;
    }
    const mayStart =
      villager.routine.followsCat &&
      villager.followCooldownFrames === 0 &&
      !villager.isTravelling &&
      (villager.state === 'working' || villager.state === 'strolling') &&
      this.catMoved(frame) &&
      !catIndoors &&
      tileDistance(villager, frame.cat) <= FOLLOW_NOTICE_TILES;
    if (!mayStart) return false;
    villager.state = 'strolling';
    villager.strollStopsLeft = 0;
    villager.followFramesLeft = FOLLOW_MAX_FRAMES;
    return true;
  }

  private onPhaseChanged(from: VillageQuestPhase, to: VillageQuestPhase): void {
    const wasSiege = SIEGE_PHASES.has(from);
    const isSiege = SIEGE_PHASES.has(to);
    if (isSiege && !wasSiege) {
      for (const villager of this.villagers) {
        if (villager.state !== 'talking') this.goToShelter(villager);
      }
      if (to === 'imminent') {
        const midge = this.villagerById('midge');
        if (midge !== undefined) this.barkLine(midge, 'attack_imminent', true);
      }
    } else if (wasSiege && !isSiege) {
      for (const villager of this.villagers) {
        if (villager.state === 'talking') continue;
        villager.hushed = false;
        villager.clearPath();
        villager.state = 'returning';
        villager.hurrying = false;
        villager.resumeDelayFrames = this.randomFrames(0, SIEGE_RETURN_SPREAD_FRAMES);
        villager.standFrames = 0;
      }
    }
  }

  private speedPx(villager: Villager): number {
    const pace = villager.routine.speed * (villager.hurrying ? HURRY_FACTOR : 1);
    return (pace * TILE_SIZE) / UPDATES_PER_SECOND;
  }

  private updateVillager(villager: Villager, frame: VillagerFrame): void {
    villager.tick();
    villager.hushed =
      isUnnamedVillager(villager.id) && villager.state === 'sheltering' && !villager.isTravelling;

    if (villager.state === 'talking') {
      const partner = villager.talkPartner;
      if (partner !== null) villager.faceToward(partner.x, partner.y);
      villager.standStill();
      return;
    }

    if (villager.resumeDelayFrames > 0) {
      villager.resumeDelayFrames--;
      villager.standStill();
      if (villager.resumeDelayFrames === 0) this.goToPost(villager, false);
      return;
    }

    const speed = this.speedPx(villager);
    if (villager.routine.followsCat && this.updateFollow(villager, frame, speed)) return;

    const recalled =
      villager.routine.service &&
      villager.state === 'strolling' &&
      this.isPartyNear(villager.post, frame, SERVICE_RECALL_TILES);
    if (recalled) this.goToPost(villager, true);

    if (villager.isTravelling) {
      if (this.blockingCrawler(villager, frame)) {
        villager.blockedFrames++;
        villager.standStill();
        if (villager.blockedFrames >= BLOCK_RETARGET_FRAMES) this.detour(villager, frame);
        return;
      }
      villager.blockedFrames = 0;
      if (villager.advance(speed)) {
        villager.clearPath();
        this.arrive(villager);
      }
      return;
    }

    villager.standStill();
    if (
      isUnnamedVillager(villager.id) &&
      villager.state !== 'sheltering' &&
      tileDistance(villager, frame.active) <= AMBIENT_BARK_TILES &&
      this.random() < AMBIENT_BARK_CHANCE_PER_FRAME
    ) {
      this.unnamedRemark(villager, false);
    }
    if (villager.standFrames > 0) {
      villager.standFrames--;
      return;
    }
    this.decide(villager, frame);
  }

  update(frame: VillagerFrame): void {
    this.memory.clockSeconds += SECONDS_PER_UPDATE;
    const phase = this.deps.state.quest.phase;
    if (phase !== this.lastPhase) {
      const from = this.lastPhase;
      this.lastPhase = phase;
      this.onPhaseChanged(from, phase);
    }
    for (const villager of this.villagers) this.updateVillager(villager, frame);
    this.lastCatPosition = { x: frame.cat.x, y: frame.cat.y };

    const session = this.session;
    if (session !== null) {
      const walkedOff =
        tileDistance(session.talker, session.speaker) > CONVERSATION_WALK_AWAY_TILES;
      if (walkedOff) this.closeConversation();
    }
    this.conversation.update();
    this.refreshMarkers(frame.active);
  }

  private refreshMarkers(active: VillagerCrawler): void {
    const questLines = this.questLines;
    for (const villager of this.villagers) {
      villager.showName = tileDistance(villager, active) <= NAME_LABEL_RANGE_TILES;
      const named = asVillagerId(villager.id);
      villager.marker =
        named === null || questLines?.markerFor === undefined
          ? 'none'
          : questLines.markerFor(named, this.contextFor(named, villager, null));
    }
  }

  // ── Rendering ──────────────────────────────────────────────────────────

  /**
   * The Talk prompt over the villager a press would reach. Returns whether it drew.
   */
  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: VillagerCrawler,
  ): boolean {
    if (this.session !== null) return false;
    const target = this.talkTarget(active);
    if (target === null) return false;
    drawInteractionPrompt(ctx, target.x - camX, target.y - camY, TILE_SIZE, 'Talk');
    return true;
  }

  dispose(): void {
    this.closeConversation();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
  }
}
