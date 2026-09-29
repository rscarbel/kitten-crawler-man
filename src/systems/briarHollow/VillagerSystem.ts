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
import type { SoundId } from '../../audio/sounds';
import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import type { BriarHollowState, VillagerMemory } from '../../core/briarHollowState';
import type { VillageQuestPhase } from '../../core/villageQuestPhase';
import {
  pickByTalkPriority,
  TALK_TIER_AMBIENT,
  TALK_TIER_NAMED,
  TALK_TIER_QUEST,
} from '../../creatures/talkPriority';
import type { GameMap } from '../../map/GameMap';
import type { BriarHollowSite, VillagerAnchorKind } from '../../map/overworld/briarHollowSite';
import type { TilePoint } from '../../map/town/townPlan';
import { ratkinCastEventFrame, ratkinCastLoopFrame } from '../../sprites/ratkinCastSprite';
import { drawInteractionPrompt } from '../../ui/InteractionPrompt';
import type { Conversation } from '../../dialog/Conversation';
import type { BarkLine, DialogLine, NonEmpty } from '../../dialog/line';
import type {
  Choice,
  ConversationHandle,
  ConversationRequest,
  ConversationTopic,
  Ending,
} from '../../dialog/request';
import { topicMenu } from '../../dialog/topics';
import { SPEAKERS } from '../../dialog/speakers';
import {
  GARN,
  MERRIT,
  MIDGE,
  PIPKIN,
  VILLAGER_IDS,
  WICKER,
  type VillagerId,
} from '../../dialog/scripts/briarHollow';
import { VILLAGER_SCRIPTS } from '../../dialog/villagerRegistry';
import { VillageNavigator } from './villageNavigator';
import { Villager, facingFor } from './Villager';
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
  BUILT_IN_TOPICS,
  GOODBYE_LABEL,
  type TopicProvider,
  type VillagerConversationFlow,
} from './villagerTopics';
import { CIVILIAN_CAST_IDS, type CivilianCastId, VILLAGER_ROUTINES } from './villagerRoutines';
import { SHELTERING_LINE, isUnnamedVillager } from '../../dialog/scripts/briarHollow/unnamed';
import { UNNAMED_VILLAGERS } from '../../dialog/villagerRegistry';

const UPDATES_PER_SECOND = 60;
const SECONDS_PER_UPDATE = 1 / UPDATES_PER_SECOND;
const TILE_CENTRE = 0.5;
const MS_PER_SECOND = 1000;

/** How close, centre to centre, a crawler must be to talk to a villager. Facing is not required. */
export const VILLAGER_TALK_RANGE_TILES = 1.6;
/** Tooltip body for a civilian who is neither a named villager nor one of the four unnamed regulars. */
const UNNAMED_VILLAGER_FALLBACK_DESCRIPTION = 'One of Briar Hollow’s ratkin villagers.';

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

/** Oren's hammer, read one at a time so a random draw does not fire twice on the same strike. */
const ANVIL_STRIKE_SOUNDS: readonly SoundId[] = [
  'anvil_strike_1',
  'anvil_strike_2',
  'anvil_strike_3',
];
/** Beyond this the forge is out of earshot. */
const ANVIL_STRIKE_AUDIBLE_RADIUS_TILES = 11;
/** Loudest at zero distance, before the radius falloff. */
const ANVIL_STRIKE_VOLUME = 0.85;
/** The anvil's face sits centred over its tile, a little above the ground like the village's other low props. */
const ANVIL_FACE_X_FRACTION = 0.5;
const ANVIL_FACE_Y_FRACTION = 0.55;

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
  /** The one conversation panel the whole game shares — never this system's own. */
  readonly conversation: Conversation;
  /** The party's resources, tools and skills, read fresh for every conversation. */
  readonly party: () => VillagerPartyState;
  /** Defaults to `Math.random`; the gates pass a seeded stream. */
  readonly random?: () => number;
  /**
   * Whether a menu the conversation handed off to — a shop, a quantity
   * picker — is still open. While it is, a villager who just finished
   * talking is held rather than sent back to their post: the shop and the
   * villager behind its counter close together, not the villager first.
   */
  readonly isVillagerBusy?: () => boolean;
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
}

function tileDistance(a: VillagerCrawler, b: VillagerCrawler): number {
  return Math.hypot(a.x - b.x, a.y - b.y) / TILE_SIZE;
}

/** A villager the current quest has business with always outranks one that doesn't; a named villager with their own service or lines outranks one of the unnamed four. */
function villagerTalkTier(villager: Villager) {
  if (villager.marker !== 'none') return TALK_TIER_QUEST;
  return isUnnamedVillager(villager.id) ? TALK_TIER_AMBIENT : TALK_TIER_NAMED;
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
  /** The shared game-wide conversation panel — see {@link VillagerSystemDeps.conversation}. */
  readonly conversation: Conversation;
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
  /** Whether the choice row currently on screen is a submenu (its exit choice is "Back", to the root) rather than the root itself (whose exit choice is "Goodbye"). */
  private inSubmenu = false;
  /** The handle the conversation's currently open request returned — chains every later beat of this same conversation. `null` before the first line has been shown. */
  private handle: ConversationHandle | null = null;
  /** The `DialogLine`s last shown, reused when a beat swaps the choice row over the page already on screen rather than turning to a new one. */
  private lastLines: NonEmpty<DialogLine> | null = null;
  /** The `Ending` last put on screen, reused when a beat says a line without moving the choice row it left showing. */
  private lastEnding: Ending | null = null;
  private currentQuestRelated = false;
  /** Callbacks queued by `VillagerConversationFlow.closeAfter`/`onEventualClose`, run once this conversation actually closes — however many more screens it shows first. */
  private pendingAfterClose: Array<() => void> = [];
  private _lastOpening: OpeningLine | null = null;
  private lastPhase: VillageQuestPhase;
  private lastCatPosition: VillagerCrawler | null = null;
  private readonly unsubscribers: Array<() => void> = [];
  private readonly oren: Villager | null;
  private readonly orenAnvilPoint: VillagerCrawler | null;
  /** The work loop's frame as of the last update, so a strike is caught on the tick the loop reaches it rather than every tick it stays there. */
  private orenLastWorkFrame = -1;
  /**
   * Set when a conversation ends while `deps.isVillagerBusy` still says yes —
   * a shop just opened in the conversation's place. Cleared, and the villager
   * sent back to their post, once the menu actually closes; also cleared the
   * moment a fresh conversation with them begins, so a stale hold can never
   * cut a new conversation short.
   */
  private pendingResume: CivilianCastId | null = null;

  constructor(private readonly deps: VillagerSystemDeps) {
    this.random = deps.random ?? Math.random;
    this.village = new VillageNavigator(deps.gameMap, deps.site.interior);
    this.quarry = new VillageNavigator(deps.gameMap, deps.site.quarry.rect);
    this.conversation = deps.conversation;
    this.lastPhase = deps.state.quest.phase;
    // Computed before `populate()` so a working villager's first pose (Oren's
    // included) is already faced correctly, not corrected a tick later.
    this.orenAnvilPoint = this.findAnvilPoint();
    this.villagers = this.populate();
    this.oren = this.villagers.find((villager) => villager.id === 'oren') ?? null;
    this.subscribe();
  }

  /** Where the hammer needs to land: the forge's anvil, read off the site's own furniture placement. */
  private findAnvilPoint(): VillagerCrawler | null {
    const forge = this.deps.site.buildings.find((building) => building.id === 'forge');
    const anvil = forge?.furniture.find((prop) => prop.prop === 'anvil');
    if (anvil === undefined) return null;
    return {
      x: (anvil.x + ANVIL_FACE_X_FRACTION) * TILE_SIZE,
      y: (anvil.y + ANVIL_FACE_Y_FRACTION) * TILE_SIZE,
    };
  }

  /**
   * The facing Oren should hold at his post, computed from the anvil's real
   * position relative to him rather than assumed — a layout change moves the
   * anvil and his facing follows it, instead of silently pointing his swing
   * at empty air. `null` when the site has no anvil to read.
   */
  private orenWorkFacing(oren: Villager): { readonly x: number; readonly y: number } | null {
    const anvil = this.orenAnvilPoint;
    if (anvil === null) return null;
    return facingFor(anvil.x - oren.x, anvil.y - oren.y);
  }

  /** Faces a villager toward their work as they enter the work loop: Oren toward the anvil, everyone else the village's south-facing convention. */
  private faceWork(villager: Villager): void {
    if (villager.id === 'oren') {
      const facing = this.orenWorkFacing(villager);
      if (facing !== null) {
        villager.facingX = facing.x;
        villager.facingY = facing.y;
        return;
      }
    }
    villager.facingX = 0;
    villager.facingY = 1;
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
      const description =
        named !== null
          ? VILLAGER_SCRIPTS[named].backstory
          : isUnnamedVillager(id)
            ? UNNAMED_VILLAGERS[id].description
            : UNNAMED_VILLAGER_FALLBACK_DESCRIPTION;
      const villager = new Villager(
        id,
        routine,
        named === null ? null : SPEAKERS[named].name,
        description,
        post,
        shelter,
        inSiege ? shelter : post,
        index,
      );
      villager.state = inSiege ? 'sheltering' : 'working';
      if (villager.state === 'working') this.faceWork(villager);
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
    this.barkLine(merrit, MERRIT.cowPettedNearby);
  }

  noteStewRefused(eater: VillagerCrawler): void {
    const pipkin = this.villagerById('pipkin');
    if (pipkin === undefined || tileDistance(pipkin, eater) > STEW_NOTICE_TILES) return;
    this.barkLine(pipkin, PIPKIN.stewCooldownActive);
  }

  /** A rock deposit crumbled at tile (`tileX`, `tileY`). */
  noteDepositDepleted(tileX: number, tileY: number): void {
    this.memory.lastDepositDepleted = { at: this.memory.clockSeconds, tileX, tileY };
    const garn = this.villagerById('garn');
    if (garn === undefined) return;
    if (Math.hypot(garn.tile.x - tileX, garn.tile.y - tileY) > DEPOSIT_NOTICE_RADIUS_TILES) return;
    this.barkLine(garn, GARN.depositDepleted);
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
  private barkLine(villager: Villager, line: BarkLine, force = false): boolean {
    return this.sayBark(villager, line.paragraphs[0], force);
  }

  /**
   * Has a named villager call out `line` over their head, the way the siege
   * and the militia bark. Returns whether it was said: not while they are in
   * a conversation, and not while their bark is cooling down. `force` skips
   * the cooldown, for a line answering something the player just did — a
   * shopkeeper finishing the job they were paid for — which must never be
   * swallowed by an earlier remark.
   */
  bark(id: VillagerId, line: BarkLine, force = false): boolean {
    const villager = this.villagers.find((candidate) => candidate.id === id);
    return villager === undefined ? false : this.barkLine(villager, line, force);
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
        : this.pick(UNNAMED_VILLAGERS[villager.id].lines).paragraphs[0];
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
      unlocks: state.unlocks,
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

  /**
   * The best villager to talk to within `VILLAGER_TALK_RANGE_TILES` of
   * `crawler`: a quest-marked villager first, then a named villager with
   * their own service or lines, then whoever is closest. `null` when nobody
   * is close enough.
   */
  talkTarget(crawler: VillagerCrawler): Villager | null {
    return pickByTalkPriority(
      this.villagers,
      villagerTalkTier,
      (villager) => tileDistance(villager, crawler),
      VILLAGER_TALK_RANGE_TILES,
    );
  }

  /** The Space chain's entry: talk to the nearest villager in range. Returns whether a press was taken. */
  tryTalk(talker: VillagerCrawler): boolean {
    const target = this.talkTarget(talker);
    if (target === null) return false;
    // A press that reaches here with a conversation already open was handed on
    // by `Conversation.handOff` because the crawler has turned to someone else;
    // the one already talking keeps their own box.
    if (this.session?.speaker.id === target.id) return false;
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
        if (this.pendingResume === villager.id) this.pendingResume = null;
        villager.state = 'talking';
        villager.talkPartner = partner;
        villager.clearPath();
        villager.bark.clear();
        villager.faceToward(partner.x, partner.y);
      },
      endTalk: () => {
        villager.talkPartner = null;
        // A shop or picker the conversation just handed off to may still be
        // open (`closeConversation` runs `afterClose` before this): keep the
        // villager attending rather than starting them back to work under it.
        if (this.deps.isVillagerBusy?.() === true) {
          this.pendingResume = villager.id;
          return;
        }
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
    this.inSubmenu = false;
    this.handle = null;
    this.lastLines = null;
    this.lastEnding = null;
    this.pendingAfterClose = [];
    const id = speaker.id;
    const ctx = this.contextFor(id, speaker, speaker.soldierStance);
    const opening = openingLine(id, ctx, this.questLines);
    this._lastOpening = opening;
    const { state } = this.deps;
    state.talkCounts[id] = ctx.talkCount + 1;
    if (opening.onceFlag !== undefined && !state.onceFlags.includes(opening.onceFlag)) {
      state.onceFlags.push(opening.onceFlag);
    }
    if (id === 'wicker' && opening.pages.includes(WICKER.stoneUpgradeAvailable)) {
      this.memory.lastStoneUpgradeHintAt = this.memory.clockSeconds;
    }
    this.memory.stoneAtLastTalk[id] = ctx.party.stone;

    this.session = { speaker, talker };
    speaker.beginTalk(talker);
    const onEventualClose =
      opening.after.kind === 'close' ? opening.after.onClosed : opening.after.onEventualClose;
    if (onEventualClose !== null) this.runOnEventualClose(onEventualClose);

    const questRelated = opening.questRelated === true;
    const ending: Ending =
      opening.after.kind === 'close'
        ? { kind: 'close', onClosed: () => this.closeConversation() }
        : { kind: 'choices', choices: this.rootChoices() };
    this.handle = this.conversation.open(this.requestFor(opening.pages, ending, questRelated));
  }

  /** Builds a `ConversationRequest` for the villager currently in conversation: `lines` plus the anchor, dismiss and `haltsWorld` every beat of a villager talk shares. */
  private requestFor(
    lines: NonEmpty<DialogLine>,
    ending: Ending,
    questRelated: boolean,
  ): ConversationRequest {
    const session = this.session;
    if (session === null) throw new Error('VillagerSystem: no conversation is open');
    this.lastLines = lines;
    this.lastEnding = ending;
    this.currentQuestRelated = questRelated;
    const speaker = session.speaker;
    return {
      lines,
      reward: null,
      questRelated,
      ending,
      dismiss: { kind: 'allowed', onDismissed: () => this.closeConversation() },
      haltsWorld: false,
      anchor: {
        position: () => ({ x: speaker.x, y: speaker.y }),
        talkRangeTiles: VILLAGER_TALK_RANGE_TILES,
      },
      // The number keys choose, and they are the hotbar's too.
      locksKeyboard: true,
    };
  }

  /** The line(s) currently on screen — for a beat that swaps the choice row without turning to a new page. */
  private currentLines(): NonEmpty<DialogLine> {
    const lines = this.lastLines;
    if (lines === null) throw new Error('VillagerSystem: no line is on screen');
    return lines;
  }

  /** The `Ending` currently in force — for a beat that says a line without disturbing whatever choice row was already up. */
  private currentEnding(): Ending {
    const ending = this.lastEnding;
    if (ending === null) throw new Error('VillagerSystem: no ending is on screen');
    return ending;
  }

  private runOnEventualClose(fn: () => void): void {
    this.pendingAfterClose.push(fn);
  }

  /** Every provider's rows for the villager in conversation, in provider order. */
  rootTopicsFor(id: VillagerId, ctx: VillagerContext): ConversationTopic[] {
    const flow = this.flow();
    return this.topicProviders.flatMap((provider) => provider.topics(id, ctx, flow));
  }

  /** The villager's own topics, freshly rebuilt, as a choice row — the conversation's root menu. */
  private rootChoices(): NonEmpty<Choice> {
    const session = this.session;
    if (session === null) throw new Error('VillagerSystem: no conversation is open');
    this.inSubmenu = false;
    const { id, soldierStance } = session.speaker;
    const ctx = this.contextFor(id, session.speaker, soldierStance);
    const topics = this.rootTopicsFor(id, ctx);
    const goodbye: Choice = {
      label: GOODBYE_LABEL,
      tone: 'exit',
      run: (convo) =>
        convo.play(
          this.requestFor(
            this.currentLines(),
            { kind: 'close', onClosed: () => this.closeConversation() },
            false,
          ),
        ),
    };
    return topicMenu(topics, this.consumedTopicKeys, goodbye, (choices) =>
      this.requestFor(this.currentLines(), { kind: 'choices', choices }, false),
    );
  }

  /** `topics` as a choice row with a "Back" to the root appended — a submenu a topic opened. */
  private submenuChoices(topics: readonly ConversationTopic[]): NonEmpty<Choice> {
    this.inSubmenu = true;
    const back: Choice = {
      label: BACK_LABEL,
      tone: 'exit',
      run: (convo) =>
        convo.play(
          this.requestFor(
            this.currentLines(),
            { kind: 'choices', choices: this.rootChoices() },
            false,
          ),
        ),
    };
    return topicMenu(topics, this.consumedTopicKeys, back, (choices) =>
      this.requestFor(this.currentLines(), { kind: 'choices', choices }, false),
    );
  }

  /** The flow every topic and opening builds its next beat through — see {@link VillagerConversationFlow}. */
  private flow(): VillagerConversationFlow {
    return {
      answer: (lines, questRelated = false) =>
        this.requestFor(
          lines,
          { kind: 'close', onClosed: () => this.closeConversation() },
          questRelated,
        ),
      answerWithTopics: (lines, topics, questRelated = false) =>
        this.requestFor(
          lines,
          { kind: 'choices', choices: this.submenuChoices(topics) },
          questRelated,
        ),
      answerAndReturnToRoot: (lines, questRelated = false) =>
        this.requestFor(lines, { kind: 'choices', choices: this.rootChoices() }, questRelated),
      sayKeepingMenu: (lines, questRelated = false) =>
        this.requestFor(lines, this.currentEnding(), questRelated),
      returnToRoot: () =>
        this.requestFor(
          this.currentLines(),
          { kind: 'choices', choices: this.rootChoices() },
          false,
        ),
      openTopics: (topics) =>
        this.requestFor(
          this.currentLines(),
          { kind: 'choices', choices: this.submenuChoices(topics) },
          this.currentQuestRelated,
        ),
      closeNow: () =>
        this.requestFor(
          this.currentLines(),
          { kind: 'close', onClosed: () => this.closeConversation() },
          this.currentQuestRelated,
        ),
      closeAfter: (lines, onClosed, questRelated = false) => {
        this.runOnEventualClose(onClosed);
        return this.requestFor(
          lines,
          { kind: 'close', onClosed: () => this.closeConversation() },
          questRelated,
        );
      },
      onEventualClose: (fn) => this.runOnEventualClose(fn),
    };
  }

  /**
   * Escape's own hook: from an open submenu it backs out to the root topics
   * the way "Back" does, and only closes the conversation outright from the
   * root itself. Returns whether there was a conversation open to act on.
   */
  escapeConversation(): boolean {
    if (this.session === null) return false;
    if (this.inSubmenu && this.conversation.isShowingChoices) {
      this.handle?.play(
        this.requestFor(
          this.currentLines(),
          { kind: 'choices', choices: this.rootChoices() },
          false,
        ),
      );
      return true;
    }
    this.closeConversation();
    return true;
  }

  closeConversation(): void {
    const session = this.session;
    if (session === null) return;
    this.session = null;
    this.conversation.close();
    this.handle = null;
    this.lastLines = null;
    this.lastEnding = null;
    const pending = this.pendingAfterClose;
    this.pendingAfterClose = [];
    // Run before `endTalk`: a topic that hands off to a shop (`shopTopic`)
    // opens it from here, so `endTalk`'s busy check sees it already open
    // rather than deciding a tick too early that nothing is keeping the
    // villager at their post.
    for (const run of pending) run();
    session.speaker.endTalk();
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
        this.faceWork(villager);
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
      // Snapped exactly rather than trusting the tile check alone: talking
      // never moves a villager, but this is also the "may still be there
      // stale from a route" fallback everywhere else `arrive` is not.
      villager.x = villager.post.x * TILE_SIZE;
      villager.y = villager.post.y * TILE_SIZE;
      villager.state = 'working';
      this.faceWork(villager);
      villager.standFrames = this.randomFrames(POST_DWELL_MIN_FRAMES, POST_DWELL_MAX_FRAMES);
      return;
    }
    this.goToPost(villager, false);
  }

  /** Lets a villager held mid-transaction go back to their post once the menu that held them there has actually closed. */
  private checkPendingResume(): void {
    const id = this.pendingResume;
    if (id === null || this.deps.isVillagerBusy?.() === true) return;
    this.pendingResume = null;
    const villager = this.villagerById(id);
    if (villager !== undefined) this.resumeAfterTalk(villager);
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
        if (midge !== undefined) this.barkLine(midge, MIDGE.attackImminent, true);
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

  /**
   * Fires the hammer's strike the tick the work loop's own clock reaches it —
   * the same clock `Villager.render` draws the swing from, so the sparks, the
   * sound and the frame the hammer head is down on the anvil never drift
   * apart. Silent and effect-free once the crawler is out of earshot.
   */
  private updateOrenHammer(frame: VillagerFrame): void {
    const oren = this.oren;
    const anvil = this.orenAnvilPoint;
    if (oren === null || anvil === null || !oren.isWorking) {
      this.orenLastWorkFrame = -1;
      return;
    }
    // Only while he is actually squared up to the anvil — not, say, still
    // turned toward wherever the player was standing a moment ago — does the
    // swing land on anything.
    const facing = this.orenWorkFacing(oren);
    if (facing === null) {
      this.orenLastWorkFrame = -1;
      return;
    }
    if (oren.facingX !== facing.x || oren.facingY !== facing.y) {
      this.orenLastWorkFrame = -1;
      return;
    }
    const nowSeconds = performance.now() / MS_PER_SECOND;
    const strikeFrame = ratkinCastEventFrame('oren', 'work', oren.facingX, oren.facingY, 'strike');
    const currentFrame = ratkinCastLoopFrame(
      'oren',
      'work',
      oren.facingX,
      oren.facingY,
      oren.loopOffsetSeconds,
      nowSeconds,
    );
    if (strikeFrame === undefined || currentFrame === undefined) return;
    const justStruck = currentFrame === strikeFrame && this.orenLastWorkFrame !== strikeFrame;
    this.orenLastWorkFrame = currentFrame;
    if (!justStruck) return;

    oren.burstSparksAt(anvil.x, anvil.y);

    const distanceTiles = tileDistance(anvil, frame.active);
    if (distanceTiles > ANVIL_STRIKE_AUDIBLE_RADIUS_TILES) return;
    const falloff = 1 - distanceTiles / ANVIL_STRIKE_AUDIBLE_RADIUS_TILES;
    this.deps.audio?.playRandom(ANVIL_STRIKE_SOUNDS, { volume: ANVIL_STRIKE_VOLUME * falloff });
  }

  update(frame: VillagerFrame): void {
    this.memory.clockSeconds += SECONDS_PER_UPDATE;
    const phase = this.deps.state.quest.phase;
    if (phase !== this.lastPhase) {
      const from = this.lastPhase;
      this.lastPhase = phase;
      this.onPhaseChanged(from, phase);
    }
    this.checkPendingResume();
    for (const villager of this.villagers) this.updateVillager(villager, frame);
    this.updateOrenHammer(frame);
    this.lastCatPosition = { x: frame.cat.x, y: frame.cat.y };
    // The scene ticks the shared `Conversation` once per frame with the
    // active player's position — this system only opens beats on it and
    // reacts to how it ends.
    this.refreshMarkers();
  }

  private refreshMarkers(): void {
    const questLines = this.questLines;
    for (const villager of this.villagers) {
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

  /**
   * Every villager's bark bubble, drawn after the Y-sorted entity pass so a
   * tall standing prop sorted later — a sawmill machine, the rope walk —
   * never paints over a bubble floating above the villager's head.
   */
  renderBarks(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const villager of this.villagers) villager.renderBark(ctx, camX, camY, TILE_SIZE);
  }

  dispose(): void {
    this.closeConversation();
    for (const unsubscribe of this.unsubscribers) unsubscribe();
    this.unsubscribers.length = 0;
  }
}
