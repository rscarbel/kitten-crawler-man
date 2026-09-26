/**
 * Briar Hollow's militia: Sedge, Hobb, Marta and Pru, and the orders either
 * crawler can give them.
 *
 * The soldiers are `RatkinSoldier` mobs in the scene's roster, spawned fresh
 * on every build of the kit. Their standing orders live in the threaded
 * `BriarHollowState.soldierOrders`, which survives door visits and saves; a
 * soldier with no record is at their post. This system turns an order into
 * the soldier's duty, runs the village leash on a follower, gets a downed
 * soldier back up, lets a soldier heal between fights, and has them call out
 * what they see.
 *
 * Talking to a soldier opens the villagers' conversation panel; the orders are
 * this system's rows under it, and every reply is the soldier's own verbatim
 * line.
 */

import type { AudioManager } from '../../audio/AudioManager';
import { VILLAGE_CUES } from '../../audio/villageSoundCues';
import { TILE_SIZE } from '../../core/constants';
import type { BriarHollowState, SoldierOrderRecord } from '../../core/briarHollowState';
import type { CrawlerKind } from '../../core/SkillManager';
import { hasAcceptedMayorRequest, type VillageQuestPhase } from '../../core/villageQuestPhase';
import { applySpawnDifficulty } from '../../core/difficultyProfiles';
import { REVIVE_RANGE_PX } from '../../core/reviveRules';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import {
  RALLY_FRAMES,
  RatkinSoldier,
  SOLDIER_PROFILES,
  type SoldierDuty,
} from '../../creatures/RatkinSoldier';
import type { Player } from '../../Player';
import type { GameMap } from '../../map/GameMap';
import type { AssaultLaneId, BriarHollowSite } from '../../map/overworld/briarHollowSite';
import type { TilePoint } from '../../map/town/townPlan';
import { findNearbyWalkableTile } from '../../map/findWalkableTile';
import { RATKIN_SOLDIER_IDS, type RatkinSoldierId } from '../../sprites/art/ratkin/cast';
import { drawTimedSpeechBubble, type TimedBubbleStyle } from '../../sprites/speechBubble';
import { drawInteractionPrompt } from '../../ui/InteractionPrompt';
import { TEXT_PRESETS, drawText } from '../../ui/TextBox';
import type { MobRoster } from '../kits/SceneWorld';
import { hostileWithinAttackRange } from '../interactionPromptGate';
import type { DefenseStructures } from './DefenseStructures';
import { type Circumstance, type VillagerId, line } from './ratkinDialogue';
import {
  type SoldierPosts,
  buildPatrolRoute,
  computeSoldierPosts,
  tilesOutsideRect,
} from './soldierPosts';
import type { SoldierStance } from './villagerCircumstances';
import type { ConversationTopic, TopicProvider } from './villagerTopics';
import { VILLAGER_HEAD_CLEARANCE_TILES } from './Villager';
import {
  VILLAGER_TALK_RANGE_TILES,
  type ConversationSpeaker,
  type VillagerSystem,
} from './VillagerSystem';

const UPDATES_PER_SECOND = 60;
const SECONDS_PER_UPDATE = 1 / UPDATES_PER_SECOND;
const TILE_CENTRE = 0.5;

/** A held position is guarded this far round. */
export const HOLD_ENGAGE_TILES = 3;
/** A follower fights what comes within this many tiles of the crawler it follows. */
export const FOLLOW_ENGAGE_TILES = 6;
/** A patroller fights what comes within this many tiles of its route. */
export const PATROL_ENGAGE_TILES = 6;
/** A post soldier chases this much past the ground it engages over before letting go. */
const POST_CHASE_SLACK_TILES = 2;
/**
 * A follower stays with the crawler up to this far outside the palisade, then
 * says so, stops and heads back to its post.
 */
export const SOLDIER_FOLLOW_MAX_TILES_OUTSIDE = 30;
/** How often the follower's village leash is measured. */
const LEASH_CHECK_FRAMES = UPDATES_PER_SECOND;

/** Outside the siege, a downed soldier gets back up by itself after this long. */
export const SOLDIER_DOWNED_RECOVERY_SECONDS = 60;
const SOLDIER_DOWNED_RECOVERY_FRAMES = SOLDIER_DOWNED_RECOVERY_SECONDS * UPDATES_PER_SECOND;
/** A soldier who gets back up after the siege, or by themselves, has this share of their health. */
export const SOLDIER_RISE_HP_FRACTION = 0.5;
/** A crawler standing over a downed soldier helps them up after this long. */
export const SOLDIER_HELP_UP_SECONDS = 2;
const SOLDIER_HELP_UP_FRAMES = SOLDIER_HELP_UP_SECONDS * UPDATES_PER_SECOND;
/** A soldier helped up early has this share of their health. */
export const SOLDIER_HELP_UP_HP_FRACTION = 0.3;

/** Out of the siege and out of a fight, a soldier heals this share of their health a second. */
export const SOLDIER_REGEN_SHARE_PER_SECOND = 0.01;
/** Healing waits until this long after the last wound. */
const SOLDIER_REGEN_DELAY_SECONDS = 5;
const SOLDIER_REGEN_DELAY_FRAMES = SOLDIER_REGEN_DELAY_SECONDS * UPDATES_PER_SECOND;

/** Cooldowns on each call-out, per soldier, in seconds. */
const ENEMY_SPOTTED_COOLDOWN_SECONDS = 60;
const GATE_UNDER_ATTACK_COOLDOWN_SECONDS = 20;
const ENEMY_BREACH_COOLDOWN_SECONDS = 30;
const PATROL_RETURN_COOLDOWN_SECONDS = 60;
/** The share of completed patrol loops that end in a remark. */
const PATROL_RETURN_CHANCE = 0.25;
/** Marta's rally reaches soldiers this close to her. */
const RALLY_RADIUS_TILES = 6;

/** Within this many tiles a soldier's name shows under their feet, as a villager's does. */
const NAME_LABEL_RANGE_TILES = 4;
const NAME_LABEL_DROP_PX = 1;
const OVERHEAD_GAP_PX = 2;
/** The militia's bubbles: steel and straw, apart from the civilians' warm ones. */
const SOLDIER_BUBBLE_STYLE: TimedBubbleStyle = { border: '#8fa3b8', text: '#eef2f6' };

/** A soldier being worn down yelps no more often than this. */
const HURT_SOUND_GAP_FRAMES = 40;

/** The phases with the enemy on its way or at the walls. */
const SIEGE_PHASES: ReadonlySet<VillageQuestPhase> = new Set(['imminent', 'assault']);
/** The phases that end a siege, when everyone who went down gets back up. */
const SIEGE_ENDINGS: ReadonlySet<VillageQuestPhase> = new Set(['victory', 'repelled_failed']);

/** The bell tower's footprint is two tiles; its centre is one tile in from its corner. */
const BELL_TOWER_HALF_TILES = 1;
/** The dead this close to the bell bring the militia back from the wall to guard it. */
const BELL_FALLBACK_TILES = 12;
/** Where round the tower each soldier takes up their guard: one per side, from its north-west tile. */
const BELL_GUARD_BESIDE = BELL_TOWER_HALF_TILES * 2 + 1;
const BELL_GUARD_OFFSETS: ReadonlyArray<{ readonly x: number; readonly y: number }> = [
  { x: BELL_TOWER_HALF_TILES, y: BELL_GUARD_BESIDE },
  { x: -1, y: BELL_TOWER_HALF_TILES },
  { x: BELL_GUARD_BESIDE, y: BELL_TOWER_HALF_TILES },
  { x: 0, y: BELL_GUARD_BESIDE },
];
/** How far from its side a guard spot may be nudged to open ground. */
const BELL_GUARD_SEARCH_TILES = 3;

/** Topic keys, stable for the gates. */
export const SOLDIER_TOPIC_KEYS = {
  follow: 'soldier_follow',
  hold: 'soldier_hold',
  patrol: 'soldier_patrol',
  post: 'soldier_post',
} as const;

const TOPIC_LABELS = {
  follow: 'Follow me',
  hold: 'Hold this position',
  patrol: 'Patrol the area',
  post: 'Return to your post',
} as const;

/** The party as the militia sees it this frame. */
export interface SoldierFrame {
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  readonly active: HumanPlayer | CatPlayer;
}

export interface SoldierSystemDeps {
  readonly gameMap: GameMap;
  readonly site: BriarHollowSite;
  readonly roster: MobRoster;
  readonly state: BriarHollowState;
  /** The conversation panel the soldiers speak through. */
  readonly villagers: VillagerSystem;
  /** The palisade and the gate, for the call-outs about them; null when there is none. */
  readonly defense: () => DefenseStructures | null;
  readonly audio: AudioManager | null;
  readonly human: HumanPlayer;
  readonly cat: CatPlayer;
  /** The level the siege's undead come at, which the militia is levelled to meet. */
  readonly level: () => number;
  /**
   * The side the coming or current assault wave attacks from, which the
   * militia's battle posts line; null keeps each soldier on their own lane.
   */
  readonly battleLane?: () => AssaultLaneId | null;
  /** Whether the world is stopped under a menu; the soldiers' clocks wait with it. */
  readonly worldHalted?: () => boolean;
  /** Defaults to `Math.random`; the gates pass a seeded stream. */
  readonly random?: () => number;
}

interface SoldierTalk {
  readonly soldier: RatkinSoldier;
  readonly talker: HumanPlayer | CatPlayer;
}

function isSoldierId(id: VillagerId): id is RatkinSoldierId {
  return RATKIN_SOLDIER_IDS.some((soldier) => soldier === id);
}

function centreTile(body: { readonly x: number; readonly y: number }): TilePoint {
  return {
    x: Math.floor(body.x / TILE_SIZE + TILE_CENTRE),
    y: Math.floor(body.y / TILE_SIZE + TILE_CENTRE),
  };
}

export class SoldierSystem {
  readonly soldiers: readonly RatkinSoldier[];
  readonly posts: SoldierPosts;
  private readonly random: () => number;
  private clockSeconds = 0;
  private frame = 0;
  private lastPhase: VillageQuestPhase;
  private talk: SoldierTalk | null = null;
  private readonly barkReadyAt = new Map<string, number>();
  private readonly helpUpFrames = new Map<RatkinSoldier, number>();
  private readonly lastLoops = new Map<RatkinSoldier, number>();
  private readonly lastKills = new Map<RatkinSoldier, number>();
  private readonly lastHp = new Map<RatkinSoldier, number>();
  private readonly framesSinceWound = new Map<RatkinSoldier, number>();
  private readonly regenCarry = new Map<RatkinSoldier, number>();
  private readonly hurtSoundGap = new Map<RatkinSoldier, number>();
  private breachedSegments: ReadonlySet<string>;
  /** Whether the militia has fallen back from the wall to guard the bell. */
  private fallenBack = false;
  private readonly bellStations: Record<RatkinSoldierId, SoldierPosts['post'][RatkinSoldierId]>;
  private lastGateStruck: number | null;

  constructor(private readonly deps: SoldierSystemDeps) {
    this.random = deps.random ?? Math.random;
    this.posts = computeSoldierPosts(deps.gameMap, deps.site);
    this.bellStations = this.computeBellStations();
    this.lastPhase = deps.state.quest.phase;
    this.breachedSegments = this.currentBreaches();
    this.lastGateStruck = deps.defense()?.gateStruckAtSeconds ?? null;
    this.soldiers = RATKIN_SOLDIER_IDS.map((id) => this.spawn(id));
    const provider: TopicProvider = { topics: (villager) => this.topicsFor(villager) };
    deps.villagers.addTopicProvider(provider);
  }

  // ── Orders ─────────────────────────────────────────────────────────────

  /** The standing orders on record for `id`, or undefined for a soldier at their post. */
  orderFor(id: RatkinSoldierId): SoldierOrderRecord | undefined {
    return this.deps.state.soldierOrders.find((order) => order.soldierId === id);
  }

  /** What the resolver reads: the orders, or at their post. */
  stanceOf(id: RatkinSoldierId): SoldierStance {
    return this.orderFor(id)?.order ?? 'post';
  }

  private crawlerOf(kind: CrawlerKind): HumanPlayer | CatPlayer {
    return kind === 'human' ? this.deps.human : this.deps.cat;
  }

  private kindOf(crawler: HumanPlayer | CatPlayer): CrawlerKind {
    return crawler === this.deps.human ? 'human' : 'cat';
  }

  private writeOrder(id: RatkinSoldierId, record: SoldierOrderRecord | null): void {
    const { state } = this.deps;
    state.soldierOrders = state.soldierOrders.filter((order) => order.soldierId !== id);
    if (record !== null) state.soldierOrders.push(record);
    const soldier = this.soldierById(id);
    if (soldier !== null) soldier.setDuty(this.dutyFor(id));
  }

  /** Orders `id` to follow `crawler`. */
  orderFollow(id: RatkinSoldierId, crawler: HumanPlayer | CatPlayer): void {
    this.writeOrder(id, { soldierId: id, order: 'follow', followCrawler: this.kindOf(crawler) });
  }

  /** Orders `id` to hold the tile they stand on. */
  orderHold(id: RatkinSoldierId): void {
    const soldier = this.soldierById(id);
    if (soldier === null) return;
    const tile = soldier.tile;
    this.writeOrder(id, { soldierId: id, order: 'hold', x: tile.x, y: tile.y });
  }

  /**
   * Orders `id` to patrol around where they stand. Returns false, and leaves
   * the orders as they were, when no route from there can be walked.
   */
  orderPatrol(id: RatkinSoldierId): boolean {
    const soldier = this.soldierById(id);
    if (soldier === null) return false;
    const from = soldier.tile;
    const route = buildPatrolRoute(this.deps.gameMap, this.deps.site, from);
    if (route === null) return false;
    this.writeOrder(id, {
      soldierId: id,
      order: 'patrol',
      x: from.x,
      y: from.y,
      patrolRoute: route.map((tile) => ({ x: tile.x, y: tile.y })),
    });
    return true;
  }

  /** Sends `id` back to their post. */
  orderPost(id: RatkinSoldierId): void {
    this.writeOrder(id, null);
  }

  /**
   * Where `id`'s post duty puts them now: their post; their battle post while
   * the siege is on; or round the bell, once the dead are inside and at it.
   */
  private postStation(id: RatkinSoldierId): SoldierPosts['post'][RatkinSoldierId] {
    const inSiege = SIEGE_PHASES.has(this.deps.state.quest.phase);
    if (inSiege && this.fallenBack) return this.bellStations[id];
    if (!inSiege) return this.posts.post[id];
    const lane = this.deps.battleLane?.() ?? null;
    return lane === null ? this.posts.battlePost[id] : this.posts.battlePostByLane[lane][id];
  }

  /**
   * One tile beside the bell tower per soldier, on open ground, facing out
   * from it: where the militia falls back to when the dead reach the square.
   */
  private computeBellStations(): Record<RatkinSoldierId, SoldierPosts['post'][RatkinSoldierId]> {
    const bell = this.deps.site.square.bellTile;
    const centre = { x: bell.x + BELL_TOWER_HALF_TILES, y: bell.y + BELL_TOWER_HALF_TILES };
    const taken = new Set<string>();
    const stationFor = (id: RatkinSoldierId): SoldierPosts['post'][RatkinSoldierId] => {
      const index = RATKIN_SOLDIER_IDS.indexOf(id);
      const offset = BELL_GUARD_OFFSETS[index % BELL_GUARD_OFFSETS.length];
      const aim = { x: bell.x + offset.x, y: bell.y + offset.y };
      const tile =
        findNearbyWalkableTile(
          this.deps.gameMap,
          aim.x,
          aim.y,
          BELL_GUARD_SEARCH_TILES,
          (x, y) => !taken.has(`${x},${y}`),
        ) ?? this.posts.battlePost[id].tile;
      taken.add(`${tile.x},${tile.y}`);
      const dx = tile.x - centre.x;
      const dy = tile.y - centre.y;
      const length = Math.hypot(dx, dy) || 1;
      return { tile, outward: { x: dx / length, y: dy / length } };
    };
    return {
      sedge: stationFor('sedge'),
      hobb: stationFor('hobb'),
      marta: stationFor('marta'),
      pru: stationFor('pru'),
    };
  }

  /**
   * Falls the post soldiers back to the bell while the dead are inside the
   * ring and near it, and sends them back to the wall once the square is
   * clear. A soldier on the player's orders keeps them.
   */
  private checkFallBack(phase: VillageQuestPhase): void {
    if (this.frame % LEASH_CHECK_FRAMES !== 0 && phase === 'assault') return;
    const bell = this.deps.site.square.bellTile;
    const bellX = (bell.x + BELL_TOWER_HALF_TILES) * TILE_SIZE;
    const bellY = (bell.y + BELL_TOWER_HALF_TILES) * TILE_SIZE;
    const reach = BELL_FALLBACK_TILES * TILE_SIZE;
    const threatened =
      phase === 'assault' &&
      this.deps.roster.mobs.some(
        (mob) =>
          mob.isAlive &&
          mob.isHostile &&
          Math.hypot(
            mob.x + TILE_SIZE * TILE_CENTRE - bellX,
            mob.y + TILE_SIZE * TILE_CENTRE - bellY,
          ) <= reach,
      );
    if (threatened === this.fallenBack) return;
    this.fallenBack = threatened;
    for (const id of RATKIN_SOLDIER_IDS) {
      const soldier = this.soldierById(id);
      if (soldier !== null && this.orderFor(id) === undefined) soldier.setDuty(this.dutyFor(id));
    }
  }

  /** The duty `id`'s orders make of them this moment. */
  dutyFor(id: RatkinSoldierId): SoldierDuty {
    const order = this.orderFor(id);
    const profile = SOLDIER_PROFILES[id];
    if (order?.order === 'follow') {
      return {
        kind: 'follow',
        owner: this.crawlerOf(order.followCrawler ?? 'human'),
        engageTiles: FOLLOW_ENGAGE_TILES,
      };
    }
    if (order?.order === 'patrol' && order.patrolRoute !== undefined) {
      if (order.patrolRoute.length > 0) {
        return { kind: 'patrol', route: order.patrolRoute, engageTiles: PATROL_ENGAGE_TILES };
      }
    }
    if (order?.x !== undefined && order.y !== undefined) {
      const anchor = { x: order.x, y: order.y };
      return {
        kind: 'stand',
        anchor,
        engageTiles: HOLD_ENGAGE_TILES,
        leashTiles: HOLD_ENGAGE_TILES,
        outward: this.outwardAt(anchor),
      };
    }
    const station = this.postStation(id);
    const inSiege = SIEGE_PHASES.has(this.deps.state.quest.phase);
    if (id === 'sedge' && !inSiege && this.posts.sedgeBeat.length > 1) {
      return { kind: 'patrol', route: this.posts.sedgeBeat, engageTiles: profile.postEngageTiles };
    }
    return {
      kind: 'stand',
      anchor: station.tile,
      engageTiles: profile.postEngageTiles,
      leashTiles: profile.postEngageTiles + POST_CHASE_SLACK_TILES,
      outward: station.outward,
    };
  }

  private outwardAt(tile: TilePoint): { x: number; y: number } {
    const { centre } = this.deps.site;
    const dx = tile.x - centre.x;
    const dy = tile.y - centre.y;
    const length = Math.hypot(dx, dy);
    return length === 0 ? { x: 0, y: 1 } : { x: dx / length, y: dy / length };
  }

  // ── Spawning ───────────────────────────────────────────────────────────

  /** Where `id` appears on a fresh build, dropping a follow order whose crawler is out of reach. */
  private spawnTile(id: RatkinSoldierId): TilePoint {
    const order = this.orderFor(id);
    if (order?.order === 'follow') {
      const crawler = this.crawlerOf(order.followCrawler ?? 'human');
      const crawlerTile = centreTile(crawler);
      const withinLeash =
        tilesOutsideRect(this.deps.site.palisadeBounds, crawlerTile.x, crawlerTile.y) <=
        SOLDIER_FOLLOW_MAX_TILES_OUTSIDE;
      const beside = withinLeash
        ? findNearbyWalkableTile(
            this.deps.gameMap,
            crawlerTile.x,
            crawlerTile.y,
            FOLLOW_ENGAGE_TILES,
            (x, y) => x !== crawlerTile.x || y !== crawlerTile.y,
          )
        : null;
      if (beside !== null) return beside;
      this.deps.state.soldierOrders = this.deps.state.soldierOrders.filter(
        (record) => record.soldierId !== id,
      );
    }
    const duty = this.dutyFor(id);
    if (duty.kind === 'patrol') return duty.route[0] ?? this.postStation(id).tile;
    if (duty.kind === 'stand') return duty.anchor;
    return this.postStation(id).tile;
  }

  private spawn(id: RatkinSoldierId): RatkinSoldier {
    const tile = this.spawnTile(id);
    const soldier = new RatkinSoldier(tile.x, tile.y, TILE_SIZE, id);
    soldier.applyMobLevel(this.deps.level());
    applySpawnDifficulty(soldier);
    // Built with the scene, not staged after a safe room: a death rewind keeps them.
    soldier.presentAtCheckpoint = true;
    soldier.aliveAtCheckpoint = true;
    this.deps.roster.add(soldier);
    soldier.setDuty(this.dutyFor(id));
    soldier.gateRoute = {
      inside: this.deps.site.gate.inside,
      outside: this.deps.site.gate.outside,
    };
    soldier.villageBounds = this.deps.site.palisadeBounds;
    const gateTiles = this.deps.site.gate.tiles;
    if (gateTiles.length > 0) {
      const gate = gateTiles[Math.floor(gateTiles.length / 2)];
      soldier.gateCentre = { x: gate.x * TILE_SIZE, y: gate.y * TILE_SIZE };
    }
    this.lastHp.set(soldier, soldier.hp);
    return soldier;
  }

  soldierById(id: RatkinSoldierId): RatkinSoldier | null {
    return this.soldiers.find((soldier) => soldier.soldierId === id) ?? null;
  }

  // ── For the rest of the village ─────────────────────────────────────────

  /** Adds every standing soldier to the scene's allied defenders, the bodies hostiles may pick. */
  pushAlliedDefenders(out: Player[]): void {
    for (const soldier of this.soldiers) {
      if (soldier.isAlive && !soldier.isDowned) out.push(soldier);
    }
  }

  /** How many soldiers are on the ground right now. */
  soldiersDowned(): number {
    return this.soldiers.filter((soldier) => soldier.isDowned).length;
  }

  // ── The frame ──────────────────────────────────────────────────────────

  update(frame: SoldierFrame): void {
    const halted = this.deps.worldHalted?.() === true;
    const phase = this.deps.state.quest.phase;
    if (phase !== this.lastPhase) {
      const from = this.lastPhase;
      this.lastPhase = phase;
      this.onPhaseChanged(from, phase);
    }
    const party: readonly Player[] = [frame.human, frame.cat];
    for (const soldier of this.soldiers) {
      soldier.allMobs = this.deps.roster.mobs;
      soldier.party = party;
    }
    if (halted) return;
    this.clockSeconds += SECONDS_PER_UPDATE;
    this.frame++;

    for (const soldier of this.soldiers) {
      if (soldier.fellThisFrame) this.onFell(soldier);
      if (soldier.isDowned) this.tickDowned(soldier, frame);
      else if (this.tickStanding(soldier, phase) && this.talk?.soldier === soldier) {
        // Struck mid-conversation: the talk ends so the soldier can fight back.
        this.deps.villagers.closeConversation();
      }
    }
    if (this.frame % LEASH_CHECK_FRAMES === 0) this.checkVillageLeash();
    this.checkFallBack(phase);
    this.watchTheWalls(phase);

    const talk = this.talk;
    if (talk?.soldier.isDowned === true) this.deps.villagers.closeConversation();
  }

  private onPhaseChanged(from: VillageQuestPhase, to: VillageQuestPhase): void {
    if (SIEGE_ENDINGS.has(to) || (SIEGE_PHASES.has(from) && !SIEGE_PHASES.has(to))) {
      for (const soldier of this.soldiers) {
        if (soldier.isDowned) soldier.rise(SOLDIER_RISE_HP_FRACTION);
      }
    }
    for (const id of RATKIN_SOLDIER_IDS) {
      const soldier = this.soldierById(id);
      if (soldier !== null && this.orderFor(id) === undefined) soldier.setDuty(this.dutyFor(id));
    }
    if (to === 'imminent') {
      this.barkAll(['sedge', 'marta'], 'attack_imminent');
    } else if (to === 'victory') {
      this.barkAll(['marta', 'pru'], 'after_victory');
    }
  }

  private onFell(soldier: RatkinSoldier): void {
    soldier.fellThisFrame = false;
    this.helpUpFrames.delete(soldier);
    // Anything mid-swing at the soldier lets go of the body at once.
    for (const mob of this.deps.roster.mobs) {
      if (mob.currentTarget === soldier) mob.currentTarget = null;
      if (mob.retaliateMob === soldier) mob.retaliateMob = null;
    }
    this.deps.audio?.playRandom(VILLAGE_CUES.soldierDown);
  }

  private tickDowned(soldier: RatkinSoldier, frame: SoldierFrame): void {
    soldier.tickDowned();
    const inAssault = this.deps.state.quest.phase === 'assault';
    if (!inAssault && soldier.downedFrames >= SOLDIER_DOWNED_RECOVERY_FRAMES) {
      soldier.rise(SOLDIER_RISE_HP_FRACTION);
      return;
    }
    const helper = [frame.human, frame.cat].find((crawler) => this.canHelpUp(crawler, soldier));
    if (helper === undefined) {
      this.helpUpFrames.delete(soldier);
      soldier.reviveProgress = 0;
      return;
    }
    const helped = (this.helpUpFrames.get(soldier) ?? 0) + 1;
    this.helpUpFrames.set(soldier, helped);
    soldier.reviveProgress = helped / SOLDIER_HELP_UP_FRAMES;
    if (helped >= SOLDIER_HELP_UP_FRAMES) {
      this.helpUpFrames.delete(soldier);
      soldier.rise(SOLDIER_HELP_UP_HP_FRACTION);
    }
  }

  /** A crawler standing over a downed soldier, with nothing hostile in reach of them, is helping them up. */
  private canHelpUp(crawler: HumanPlayer | CatPlayer, soldier: RatkinSoldier): boolean {
    if (!crawler.isAlive || crawler.isKnockedOut) return false;
    const distance = Math.hypot(crawler.x - soldier.x, crawler.y - soldier.y);
    if (distance > REVIVE_RANGE_PX) return false;
    return !hostileWithinAttackRange(crawler, this.deps.roster.grid);
  }

  /** One frame of a standing soldier's upkeep. Returns whether it was wounded this frame. */
  private tickStanding(soldier: RatkinSoldier, phase: VillageQuestPhase): boolean {
    const previousHp = this.lastHp.get(soldier) ?? soldier.hp;
    const wounded = soldier.hp < previousHp;
    this.lastHp.set(soldier, soldier.hp);
    const sinceWound = wounded ? 0 : (this.framesSinceWound.get(soldier) ?? 0) + 1;
    this.framesSinceWound.set(soldier, sinceWound);
    const gap = Math.max(0, (this.hurtSoundGap.get(soldier) ?? 0) - 1);
    if (wounded && gap === 0) {
      this.deps.audio?.playRandom(VILLAGE_CUES.soldierHurt);
      this.hurtSoundGap.set(soldier, HURT_SOUND_GAP_FRAMES);
    } else {
      this.hurtSoundGap.set(soldier, gap);
    }

    const mayHeal =
      phase !== 'assault' &&
      !soldier.isFighting &&
      sinceWound >= SOLDIER_REGEN_DELAY_FRAMES &&
      soldier.hp < soldier.maxHp;
    if (mayHeal) {
      const carry =
        (this.regenCarry.get(soldier) ?? 0) +
        soldier.maxHp * SOLDIER_REGEN_SHARE_PER_SECOND * SECONDS_PER_UPDATE;
      const whole = Math.floor(carry);
      this.regenCarry.set(soldier, carry - whole);
      if (whole > 0) soldier.hp = Math.min(soldier.maxHp, soldier.hp + whole);
      this.lastHp.set(soldier, soldier.hp);
    }

    if (soldier.engagedFreshThisFrame) {
      soldier.engagedFreshThisFrame = false;
      if (!SIEGE_PHASES.has(phase)) {
        this.bark(soldier, 'enemy_spotted', ENEMY_SPOTTED_COOLDOWN_SECONDS);
      }
    }

    const loops = this.lastLoops.get(soldier) ?? 0;
    if (soldier.loopsCompleted < loops) this.lastLoops.set(soldier, soldier.loopsCompleted);
    if (soldier.loopsCompleted > loops) {
      this.lastLoops.set(soldier, soldier.loopsCompleted);
      const onOrderedPatrol = this.orderFor(soldier.soldierId)?.order === 'patrol';
      if (onOrderedPatrol && this.random() < PATROL_RETURN_CHANCE) {
        this.bark(soldier, 'patrol_return', PATROL_RETURN_COOLDOWN_SECONDS);
      }
    }

    const kills = this.lastKills.get(soldier) ?? 0;
    if (soldier.killsLanded > kills) {
      this.lastKills.set(soldier, soldier.killsLanded);
      if (soldier.soldierId === 'marta') this.rallyAround(soldier);
    }
    return wounded;
  }

  /** Marta's kill steadies everyone near her: their blows land harder for a while. */
  private rallyAround(marta: RatkinSoldier): void {
    for (const soldier of this.soldiers) {
      if (!soldier.isAlive || soldier.isDowned) continue;
      const tiles = Math.hypot(soldier.x - marta.x, soldier.y - marta.y) / TILE_SIZE;
      if (tiles <= RALLY_RADIUS_TILES) soldier.rallyFramesLeft = RALLY_FRAMES;
    }
  }

  /**
   * A follower whose crawler has gone too far past the palisade says their
   * line, stops, and heads back to their post.
   */
  private checkVillageLeash(): void {
    for (const soldier of this.soldiers) {
      const order = this.orderFor(soldier.soldierId);
      if (order?.order !== 'follow') continue;
      const crawler = this.crawlerOf(order.followCrawler ?? 'human');
      const tile = centreTile(crawler);
      const outside = tilesOutsideRect(this.deps.site.palisadeBounds, tile.x, tile.y);
      if (outside <= SOLDIER_FOLLOW_MAX_TILES_OUTSIDE) continue;
      this.bark(soldier, 'follow_active', 0, true);
      this.orderPost(soldier.soldierId);
    }
  }

  private currentBreaches(): ReadonlySet<string> {
    const breached = new Set<string>();
    for (const structure of this.deps.state.structures) {
      if (structure.kind === 'segment' && structure.tier === 'breach') breached.add(structure.id);
    }
    return breached;
  }

  /** Hobb calls out a struck gate; Hobb and Marta call out a breach or a hostile inside. */
  private watchTheWalls(phase: VillageQuestPhase): void {
    const struck = this.deps.defense()?.gateStruckAtSeconds ?? null;
    if (struck !== null && struck !== this.lastGateStruck) {
      const hobb = this.soldierById('hobb');
      if (hobb !== null) this.bark(hobb, 'gate_under_attack', GATE_UNDER_ATTACK_COOLDOWN_SECONDS);
    }
    this.lastGateStruck = struck;

    const breaches = this.currentBreaches();
    const freshBreach = [...breaches].some((id) => !this.breachedSegments.has(id));
    this.breachedSegments = breaches;
    if (phase !== 'assault') return;
    const hostileInside =
      this.frame % LEASH_CHECK_FRAMES === 0 &&
      this.deps.roster.mobs.some(
        (mob) =>
          mob.isAlive &&
          mob.isHostile &&
          this.deps.gameMap.isInBriarHollow(
            mob.x + TILE_SIZE * TILE_CENTRE,
            mob.y + TILE_SIZE * TILE_CENTRE,
          ),
      );
    if (!freshBreach && !hostileInside) return;
    for (const id of ['hobb', 'marta'] as const) {
      const soldier = this.soldierById(id);
      if (soldier !== null) this.bark(soldier, 'enemy_breach', ENEMY_BREACH_COOLDOWN_SECONDS);
    }
  }

  // ── Call-outs ──────────────────────────────────────────────────────────

  private barkAll(ids: readonly RatkinSoldierId[], circumstance: Circumstance): void {
    for (const id of ids) {
      const soldier = this.soldierById(id);
      if (soldier !== null) this.bark(soldier, circumstance, 0, true);
    }
  }

  /**
   * Has a soldier call out their verbatim line for `circumstance` over their
   * head. Never a line they do not have, never while they are down or talking,
   * and not again for `cooldownSeconds` unless `force`d. Returns whether it
   * was said.
   */
  bark(
    soldier: RatkinSoldier,
    circumstance: Circumstance,
    cooldownSeconds: number,
    force = false,
  ): boolean {
    const text = line(soldier.soldierId, circumstance);
    if (text === undefined || soldier.isDowned || soldier.talkPartner !== null) return false;
    const cooldownKey = `${soldier.soldierId}:${circumstance}`;
    if (!force && this.clockSeconds < (this.barkReadyAt.get(cooldownKey) ?? 0)) return false;
    soldier.say(text);
    this.barkReadyAt.set(cooldownKey, this.clockSeconds + cooldownSeconds);
    return true;
  }

  // ── Talk ───────────────────────────────────────────────────────────────

  /**
   * Whether a soldier can be talked to: standing, and not in a fight. A
   * conversation stops the soldier where it stands while the world runs on,
   * so talk yields to combat as it does for everyone else in the village.
   */
  private isFreeToTalk(soldier: RatkinSoldier): boolean {
    return soldier.isAlive && !soldier.isDowned && !soldier.isRising && !soldier.isFighting;
  }

  /** The nearest soldier free to talk within talking range of `crawler`, and how far they are. */
  talkTarget(crawler: HumanPlayer | CatPlayer): { soldier: RatkinSoldier; tiles: number } | null {
    let best: { soldier: RatkinSoldier; tiles: number } | null = null;
    for (const soldier of this.soldiers) {
      if (!this.isFreeToTalk(soldier)) continue;
      const tiles = Math.hypot(soldier.x - crawler.x, soldier.y - crawler.y) / TILE_SIZE;
      if (tiles > VILLAGER_TALK_RANGE_TILES) continue;
      if (best === null || tiles < best.tiles) best = { soldier, tiles };
    }
    return best;
  }

  /** The soldier free to talk whose drawn body covers world pixel (`worldX`, `worldY`), or null. */
  soldierAtPoint(worldX: number, worldY: number): RatkinSoldier | null {
    for (const soldier of this.soldiers) {
      if (!this.isFreeToTalk(soldier)) continue;
      const top = soldier.y - VILLAGER_HEAD_CLEARANCE_TILES * TILE_SIZE;
      const inside =
        worldX >= soldier.x &&
        worldX <= soldier.x + TILE_SIZE &&
        worldY >= top &&
        worldY <= soldier.y + TILE_SIZE;
      if (inside) return soldier;
    }
    return null;
  }

  /** Opens the conversation with `soldier`. */
  talkTo(soldier: RatkinSoldier, talker: HumanPlayer | CatPlayer): void {
    this.deps.villagers.openConversation(this.speakerFor(soldier, talker), talker);
  }

  private speakerFor(soldier: RatkinSoldier, talker: HumanPlayer | CatPlayer): ConversationSpeaker {
    const stanceOf = (): SoldierStance => this.stanceOf(soldier.soldierId);
    return {
      id: soldier.soldierId,
      get x() {
        return soldier.x;
      },
      get y() {
        return soldier.y;
      },
      get soldierStance() {
        return stanceOf();
      },
      beginTalk: (partner) => {
        this.talk = { soldier, talker };
        soldier.talkPartner = partner;
        soldier.speech.clear();
      },
      endTalk: () => {
        if (this.talk?.soldier === soldier) this.talk = null;
        soldier.talkPartner = null;
      },
    };
  }

  /**
   * The order rows under a soldier's conversation. Empty until the Mayor's
   * request is accepted: the militia takes no orders from a crawler the
   * village hasn't vouched for, which the opening line says in their own
   * words instead.
   */
  private topicsFor(villager: VillagerId): readonly ConversationTopic[] {
    if (!isSoldierId(villager)) return [];
    const talk = this.talk;
    if (talk?.soldier.soldierId !== villager) return [];
    if (!hasAcceptedMayorRequest(this.deps.state.quest.phase)) return [];
    const { soldier, talker } = talk;
    const id = soldier.soldierId;
    const acknowledge = (): void => {
      this.deps.audio?.playRandom(VILLAGE_CUES.soldierAck);
    };
    // Orders are standing controls, not questions asked once: a soldier can
    // be given a new one, or the same one again, as often as the conversation
    // needs, so every row here stays on offer after it is picked. The `run`
    // below only acknowledges the order — it never reopens the topic list,
    // so the conversation ends itself on the acknowledgement line the same
    // way any other answered topic does, instead of leaving the order menu
    // sitting open after a command has already been issued.
    const topics: ConversationTopic[] = [
      {
        key: SOLDIER_TOPIC_KEYS.follow,
        label: TOPIC_LABELS.follow,
        repeatable: true,
        run: (ctl) => {
          this.orderFollow(id, talker);
          acknowledge();
          ctl.say('command_follow');
        },
      },
      {
        key: SOLDIER_TOPIC_KEYS.hold,
        label: TOPIC_LABELS.hold,
        repeatable: true,
        run: (ctl) => {
          this.orderHold(id);
          acknowledge();
          ctl.say('command_stay');
        },
      },
      {
        key: SOLDIER_TOPIC_KEYS.patrol,
        label: TOPIC_LABELS.patrol,
        repeatable: true,
        run: (ctl) => {
          // Nowhere walkable to patrol: the soldier holds where they stand instead.
          if (!this.orderPatrol(id)) this.orderHold(id);
          acknowledge();
          ctl.say('command_patrol');
        },
      },
    ];
    if (this.orderFor(id) !== undefined) {
      topics.push({
        key: SOLDIER_TOPIC_KEYS.post,
        label: TOPIC_LABELS.post,
        repeatable: true,
        run: (ctl) => {
          this.orderPost(id);
          acknowledge();
          // No line of their own for it; the plainest acknowledgement they have.
          ctl.say('command_stay');
        },
      });
    }
    return topics;
  }

  // ── Rewind and teardown ────────────────────────────────────────────────

  /** A death rewind on the same scene: everyone on their feet, on the orders the rewound state holds. */
  onRewind(): void {
    this.lastPhase = this.deps.state.quest.phase;
    this.breachedSegments = this.currentBreaches();
    this.helpUpFrames.clear();
    for (const soldier of this.soldiers) {
      soldier.reviveProgress = 0;
      soldier.setDuty(this.dutyFor(soldier.soldierId));
      this.lastHp.set(soldier, soldier.hp);
    }
  }

  /**
   * The scene is going: through a door, off the floor, or out to the menu.
   * Soldiers never go indoors and never leave the floor, so a follow order
   * ends here; the rest outlive the scene in the village's state.
   */
  dispose(): void {
    this.deps.state.soldierOrders = this.deps.state.soldierOrders.filter(
      (order) => order.order !== 'follow',
    );
    this.talk = null;
  }

  // ── Drawing ────────────────────────────────────────────────────────────

  /** Names under the feet and call-outs over the heads, drawn over every body. */
  renderAbove(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: { readonly x: number; readonly y: number },
  ): void {
    for (const soldier of this.soldiers) {
      const sx = soldier.x - camX;
      const sy = soldier.y - camY;
      const tiles = Math.hypot(soldier.x - active.x, soldier.y - active.y) / TILE_SIZE;
      if (tiles <= NAME_LABEL_RANGE_TILES) {
        drawText(ctx, soldier.displayName, {
          ...TEXT_PRESETS.label,
          x: sx + TILE_SIZE * TILE_CENTRE,
          y: sy + TILE_SIZE + NAME_LABEL_DROP_PX,
          align: 'center',
        });
      }
      drawTimedSpeechBubble(
        ctx,
        soldier.speech,
        sx + TILE_SIZE * TILE_CENTRE,
        sy - VILLAGER_HEAD_CLEARANCE_TILES * TILE_SIZE - OVERHEAD_GAP_PX,
        SOLDIER_BUBBLE_STYLE,
      );
    }
  }

  /** The Talk prompt over the soldier a press would reach. Returns whether it drew. */
  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
  ): boolean {
    if (this.deps.villagers.isConversationOpen) return false;
    const target = this.talkTarget(active);
    if (target === null) return false;
    const { soldier } = target;
    drawInteractionPrompt(ctx, soldier.x - camX, soldier.y - camY, TILE_SIZE, 'Talk');
    return true;
  }
}
