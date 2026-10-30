/**
 * The Stealth Key Snatch on floor 2: the gate room's locked gate, Snorgle the
 * gate guard, the PRISON sign beside the prison's door, and the mini quest
 * "The Stealth Key Snatch".
 *
 * The prison itself is a separate interior scene. This system owns only what
 * the floor owns: where the quest stands, the gate it opens, and whether the
 * prison's explainer has been read. The interior reads and changes those
 * through {@link StealthKeySnatchVisit}, which this system is.
 */

import { stealthGateExtentsPx } from '../../map/tiles/stealthGateTiles';
import type { AudioManager } from '../../audio/AudioManager';
import {
  awardPartyXp,
  type CrawlerPair,
  type PartyXpApplied,
} from '../../core/progression/awardXp';
import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import { QuestManager, type QuestId, type QuestStatus } from '../../core/quests/QuestManager';
import { PrisonGoblin } from '../../creatures/PrisonGoblin';
import {
  minimapMarkerFor,
  npcMarkerShows,
  type NpcQuestMarker,
} from '../../sprites/npcQuestMarker';
import {
  TALK_TIER_NAMED,
  TALK_TIER_QUEST,
  pickByTalkPriority,
  type TalkTier,
} from '../../creatures/talkPriority';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { Conversation } from '../../dialog/Conversation';
import type { DialogLine, NonEmpty } from '../../dialog/line';
import type { ConversationHandle, ConversationRequest } from '../../dialog/request';
import { pickFreshLine } from '../../dialog/scripts/scenes/cloggedBathroom';
import {
  GATE_GUARD_LINES,
  GATE_LOCKED_BARK,
  GATE_UNLOCKED_BARK,
  STEALTH_GATE_PROMPTS,
} from '../../dialog/scripts/scenes/stealthKeySnatch';
import { prisonSignLine } from '../../dialog/scripts/prisonSign';
import { roomSaveTile } from '../../map/findWalkableTile';
import type { GameMap } from '../../map/GameMap';
import type { Point } from '../../map/roomDoorways';
import type { StealthGateRoomData } from '../../map/stealthGateLayout';
import { prewarmPrisonGoblins } from '../../sprites/goblinGuardSprite';
import { drawInteractionPrompt, drawInteractionPromptOver } from '../../ui/InteractionPrompt';
import type { ToastOptions } from '../../ui/hud/toasts';
import { partyXpSections } from '../../ui/questReward/rewardLines';
import type { QuestRewardSpec, RewardItemLine } from '../../ui/questReward/types';
import { grantQuestGear } from '../../loot/questGear';
import type { GearId } from '../../loot/gearPools';
import type { GameSystem, SystemContext } from '../GameSystem';
import type { MobRoster } from '../kits/SceneWorld';
import type { QuestMarkerType } from '../MiniMapSystem';
import type { ObjectiveBeaconSource, TrackerEntry, TrackerTarget } from '../questTracker';
import { DUNGEON_BEACON_BRIGHTNESS } from '../../ui/ObjectiveBeacon';
import { playPrisonCue, type PrisonCue } from '../../audio/prisonSoundCues';
import type {
  StealthKeySnatchCheckpoint,
  StealthKeySnatchPhase,
} from './stealthKeySnatchCheckpoint';
import {
  PRISON_KEY_ITEM,
  partyHoldsPrisonKey,
  type PrisonKeyHolders,
  type StealthKeySnatchVisit,
} from './stealthKeySnatchVisit';

export const STEALTH_KEY_SNATCH_QUEST_ID = 'stealth_key_snatch' as const satisfies QuestId;
export const STEALTH_KEY_SNATCH_QUEST_NAME = 'The Stealth Key Snatch';
/** The bathroom's scale: the real reward is the open path. */
export const STEALTH_KEY_SNATCH_XP_REWARD = 150;
/** Coins for the crawler who handed the key over, drawn evenly from this range. */
const REWARD_COINS_MIN = 15;
const REWARD_COINS_MAX = 30;
/** The floor-2 consumables the reward picks one of. */
const REWARD_GEAR = 'prowler_mantle' as const satisfies GearId;

const GET_KEY_OBJECTIVE = 'Get the key from the Goblin High Security Prison';
const HAND_OVER_OBJECTIVE = 'Bring the key to the gate guard';
const KEY_RETURNED_TOAST = 'The Key slipped away. It is back on its pedestal in the prison.';

/** How close, in tiles, the party must stand to talk to the guard, try the gate or read the sign. */
export const STEALTH_GATE_TALK_RANGE_TILES = 1.6;
const STEALTH_GATE_TALK_RANGE_PX = STEALTH_GATE_TALK_RANGE_TILES * TILE_SIZE;
/** How close a crawler's centre must be to a gate tile's to count as walking into it. */
const GATE_BUMP_REACH_TILES = 1.1;
const GATE_BUMP_REACH_PX = GATE_BUMP_REACH_TILES * TILE_SIZE;
/** Frames between two rattles of a gate a crawler keeps pushing at. */
const GATE_RATTLE_COOLDOWN_FRAMES = 90;
/** Frames between the key turning and the gate going up, so the two sounds read as two steps. */
const GATE_RAISE_DELAY_FRAMES = 40;
const HALF = 0.5;
/** The door stands in the wall one row north of its approach tile; its beam rises from there. */
const PRISON_DOOR_BEAM_BACKSET_TILES = 1;
const NO_BEACONS: ReadonlyArray<TrackerTarget> = [];

/** What a press in the gate room reaches. */
type StealthGateTarget =
  | { readonly kind: 'guard' }
  | { readonly kind: 'gate'; readonly tile: Point }
  | { readonly kind: 'sign' };

export interface StealthKeySnatchDeps {
  readonly gameMap: GameMap;
  readonly bus: EventBus;
  readonly roster: MobRoster;
  readonly conversation: Conversation;
  readonly audio: AudioManager | null;
  /** Posts a toast. */
  readonly announce: (message: string, opts?: ToastOptions) => void;
  /** A run dropped past the gate room (a dev or playtest start) begins with the gate open. */
  readonly startOpened: boolean;
}

function tileCentre(tile: Point): Point {
  return { x: (tile.x + HALF) * TILE_SIZE, y: (tile.y + HALF) * TILE_SIZE };
}

function entityCentre(entity: { readonly x: number; readonly y: number }): Point {
  return { x: entity.x + TILE_SIZE * HALF, y: entity.y + TILE_SIZE * HALF };
}

function distance(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** A fixed seed for the guard's line picks, from the world seed. */
const GUARD_SEED_SALT = 0x51ea1;

/**
 * The gate guard's marker in each phase: his ask until he is met, then the
 * turn-in once the key is in hand, since it opens his gate.
 */
const GATE_GUARD_MARKER_BY_PHASE = {
  unmet: 'available',
  briefed: 'none',
  keyHeld: 'turnIn',
  opened: 'none',
} as const satisfies Record<StealthKeySnatchPhase, NpcQuestMarker>;

/**
 * The phase machine `unmet → briefed → keyHeld → opened`:
 * - `unmet`: the guard wears a gold '!'; his talk explains the gate, the key
 *   and the prison through the side door, and closing it starts the quest.
 *   The prison door refuses entry until then.
 * - `briefed`: no marker; the tracker points at the prison door.
 * - `keyHeld`: the turn-in '?'. Talking to him, or Space at the gate, hands the key
 *   over and opens the gate.
 * - `opened`: the gate is open and the quest complete.
 *
 * `briefed` and `keyHeld` follow possession of {@link PRISON_KEY_ITEM} every
 * frame, read from both inventories: a key evicted from the quest slot drops
 * the phase back to `briefed` (and the prison's pedestal holds it again).
 */
export class StealthKeySnatchSystem
  implements GameSystem, StealthKeySnatchVisit, ObjectiveBeaconSource
{
  /** The gate guard, or null on a floor without a gate room. */
  readonly guard: PrisonGoblin | null;
  private readonly room: StealthGateRoomData | null;
  private readonly prisonDoorBeacons: ReadonlyArray<TrackerTarget>;
  private readonly questManager = new QuestManager();
  private currentPhase: StealthKeySnatchPhase = 'unmet';
  private seenExplainer = false;
  private guardTalks = 0;
  private guardLastLine: DialogLine | null = null;
  private rattleCooldown = 0;
  private raiseCueIn = 0;
  private conversationHandle: ConversationHandle | null = null;
  private readonly stopListening: () => void;

  constructor(private readonly deps: StealthKeySnatchDeps) {
    this.room = deps.gameMap.stealthGateRoom;
    this.prisonDoorBeacons = this.room === null ? NO_BEACONS : this.prisonDoorBeaconsFor(this.room);
    this.questManager.register({
      id: STEALTH_KEY_SNATCH_QUEST_ID,
      name: STEALTH_KEY_SNATCH_QUEST_NAME,
      type: 'mini',
      rewards: { xp: STEALTH_KEY_SNATCH_XP_REWARD },
    });
    this.guard = this.room === null ? null : this.spawnGuard(this.room);
    if (this.guard !== null) prewarmPrisonGoblins();
    this.stopListening = deps.bus.on('questItemEvicted', (event) => {
      if (event.itemId !== PRISON_KEY_ITEM || this.currentPhase !== 'keyHeld') return;
      this.deps.announce(KEY_RETURNED_TOAST);
    });
    const alreadyOpen = deps.startOpened || deps.gameMap.stealthGateState() === 'open';
    this.applyPhase(alreadyOpen ? 'opened' : 'unmet');
  }

  private spawnGuard(room: StealthGateRoomData): PrisonGoblin {
    const guard = new PrisonGoblin(
      room.guardTile.x,
      room.guardTile.y,
      TILE_SIZE,
      'gateGuard',
      (this.deps.gameMap.worldSeed ^ GUARD_SEED_SALT) >>> 0,
    );
    guard.faceTile(room.entranceTile);
    this.deps.roster.add(guard);
    return guard;
  }

  /** Whether this floor has a gate room at all. */
  get isPresent(): boolean {
    return this.room !== null;
  }

  get phase(): StealthKeySnatchPhase {
    return this.currentPhase;
  }

  get explainerSeen(): boolean {
    return this.seenExplainer;
  }

  markExplainerSeen(): void {
    this.seenExplainer = true;
  }

  /** Whether the guard has explained the gate, which is what lets the prison door open. */
  get isGuardBriefed(): boolean {
    return this.currentPhase !== 'unmet';
  }

  get questStatus(): QuestStatus | null {
    return this.questManager.getStatus(STEALTH_KEY_SNATCH_QUEST_ID);
  }

  // ── Phase and quest ──────────────────────────────────────────────────────

  /** Puts the quest, the gate and the guard's marker into `phase` at once, as a restore sees it. */
  private applyPhase(phase: StealthKeySnatchPhase): void {
    this.currentPhase = phase;
    this.raiseCueIn = 0;
    if (this.room !== null) {
      this.deps.gameMap.setStealthGate(phase === 'opened' ? 'open' : 'locked');
    }
    this.syncQuestStatus();
    this.syncMarkers();
  }

  private syncQuestStatus(): void {
    const status: QuestStatus =
      this.currentPhase === 'unmet'
        ? 'available'
        : this.currentPhase === 'opened'
          ? 'completed'
          : 'active';
    this.questManager.restoreStatuses([[STEALTH_KEY_SNATCH_QUEST_ID, status]]);
  }

  private startQuestIfNew(): void {
    if (this.questManager.getStatus(STEALTH_KEY_SNATCH_QUEST_ID) !== 'available') return;
    this.questManager.startQuest(STEALTH_KEY_SNATCH_QUEST_ID);
    this.deps.bus.emit('questStarted', { questId: STEALTH_KEY_SNATCH_QUEST_ID });
  }

  private guardMarker(): NpcQuestMarker {
    return GATE_GUARD_MARKER_BY_PHASE[this.currentPhase];
  }

  /** Puts the guard's glyph in step with the phase; the scene calls it on halted frames too. */
  syncMarkers(): void {
    if (this.guard !== null) this.guard.marker = this.guardMarker();
  }

  syncWithInventories(party: PrisonKeyHolders): void {
    if (this.currentPhase === 'opened' || this.room === null) return;
    const held = partyHoldsPrisonKey(party);
    if (this.currentPhase === 'unmet') {
      if (!held) return;
      this.startQuestIfNew();
    }
    const next: StealthKeySnatchPhase = held ? 'keyHeld' : 'briefed';
    if (next === this.currentPhase) return;
    this.currentPhase = next;
    this.syncMarkers();
  }

  private brief(): void {
    if (this.currentPhase !== 'unmet') return;
    this.currentPhase = 'briefed';
    this.startQuestIfNew();
    this.syncMarkers();
  }

  /**
   * Takes the key from whoever carries it, opens the gate and pays the quest.
   * The crawler who handed it over gets the coins; the gear goes to the one who can wear it.
   */
  private openGate(active: HumanPlayer | CatPlayer, party: CrawlerPair): void {
    if (this.currentPhase !== 'keyHeld') return;
    party.human.inventory.clearQuestItem(PRISON_KEY_ITEM);
    party.cat.inventory.clearQuestItem(PRISON_KEY_ITEM);
    this.startQuestIfNew();
    this.applyPhase('opened');
    this.cue('gateUnlock');
    this.raiseCueIn = GATE_RAISE_DELAY_FRAMES;
    this.questManager.completeQuest(STEALTH_KEY_SNATCH_QUEST_ID);
    const xpApplied = awardPartyXp(
      party.human,
      party.cat,
      STEALTH_KEY_SNATCH_XP_REWARD,
      this.deps.bus,
    );
    const coins =
      REWARD_COINS_MIN + Math.floor(Math.random() * (REWARD_COINS_MAX - REWARD_COINS_MIN + 1));
    active.earnCoins(coins);
    const gear = grantQuestGear(party, REWARD_GEAR, active === party.human ? 'human' : 'cat');
    this.deps.bus.emit('questCompleted', { questId: STEALTH_KEY_SNATCH_QUEST_ID });
    this.deps.bus.emit('questRewardShown', this.rewardSpec(xpApplied, coins, gear));
  }

  private rewardSpec(
    xpApplied: PartyXpApplied,
    coins: number,
    gear: RewardItemLine,
  ): QuestRewardSpec {
    return {
      questTitle: STEALTH_KEY_SNATCH_QUEST_NAME,
      sections: [
        ...partyXpSections(xpApplied),
        { kind: 'coins', amount: coins },
        { kind: 'items', items: [gear] },
      ],
    };
  }

  // ── Interaction ──────────────────────────────────────────────────────────

  private signStandPoint(room: StealthGateRoomData): Point {
    return tileCentre({ x: room.signTile.x, y: room.signTile.y + 1 });
  }

  private nearestGateTile(room: StealthGateRoomData, from: Point): Point | null {
    let best: Point | null = null;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const tile of room.gateTiles) {
      const d = distance(tileCentre(tile), from);
      if (d < bestDistance) {
        bestDistance = d;
        best = tile;
      }
    }
    return best;
  }

  private targetFor(active: { readonly x: number; readonly y: number }): StealthGateTarget | null {
    const room = this.room;
    const guard = this.guard;
    if (room === null || guard === null) return null;
    const centre = entityCentre(active);
    const candidates: Array<{ target: StealthGateTarget; at: Point; tier: TalkTier }> = [
      {
        target: { kind: 'guard' },
        at: entityCentre(guard),
        tier: this.guardMarker() === 'none' ? TALK_TIER_NAMED : TALK_TIER_QUEST,
      },
      { target: { kind: 'sign' }, at: this.signStandPoint(room), tier: TALK_TIER_NAMED },
    ];
    const gateTile = this.currentPhase === 'opened' ? null : this.nearestGateTile(room, centre);
    if (gateTile !== null) {
      candidates.push({
        target: { kind: 'gate', tile: gateTile },
        at: tileCentre(gateTile),
        tier: TALK_TIER_NAMED,
      });
    }
    const best = pickByTalkPriority(
      candidates,
      (candidate) => candidate.tier,
      (candidate) => distance(candidate.at, centre),
      STEALTH_GATE_TALK_RANGE_PX,
    );
    return best?.target ?? null;
  }

  /** Whether a press from `active` would reach the guard, the gate or the sign. */
  wouldInteract(active: { readonly x: number; readonly y: number }): boolean {
    return this.targetFor(active) !== null;
  }

  /** The gate room's link in the interact chain. Returns whether it took the press. */
  tryInteract(active: HumanPlayer | CatPlayer, party: CrawlerPair): boolean {
    const target = this.targetFor(active);
    if (target === null) return false;
    this.syncWithInventories(party);
    switch (target.kind) {
      case 'guard':
        this.talkToGuard(active, party);
        return true;
      case 'gate':
        if (this.currentPhase === 'keyHeld') {
          this.openGate(active, party);
          this.guard?.bark(GATE_UNLOCKED_BARK);
        } else {
          this.rattleGate();
        }
        return true;
      case 'sign':
        this.readSign();
        return true;
    }
  }

  private rattleGate(): void {
    this.rattleCooldown = GATE_RATTLE_COOLDOWN_FRAMES;
    this.cue('gateLocked');
    this.guard?.bark(GATE_LOCKED_BARK);
  }

  private guardRequest(lines: NonEmpty<DialogLine>, onClosed: () => void): ConversationRequest {
    return {
      lines,
      reward: null,
      questRelated: true,
      ending: { kind: 'close', onClosed },
      dismiss: { kind: 'allowed', onDismissed: () => undefined },
      haltsWorld: true,
      anchor: null,
      locksKeyboard: true,
    };
  }

  private talkToGuard(active: HumanPlayer | CatPlayer, party: CrawlerPair): void {
    const guard = this.guard;
    if (guard === null) return;
    guard.faceTile({ x: Math.round(active.x / TILE_SIZE), y: Math.round(active.y / TILE_SIZE) });
    this.cue('gateGuardTalk');
    switch (this.currentPhase) {
      case 'unmet':
        this.openGuardConversation(GATE_GUARD_LINES.firstTalk, () => this.brief());
        return;
      case 'briefed':
        this.openGuardConversation(
          [this.nextGuardLine(GATE_GUARD_LINES.briefedPool)],
          () => undefined,
        );
        return;
      case 'keyHeld':
        this.openGuardConversation(GATE_GUARD_LINES.handOver, () => this.openGate(active, party));
        return;
      case 'opened':
        this.openGuardConversation(
          [this.nextGuardLine(GATE_GUARD_LINES.afterPool)],
          () => undefined,
        );
        return;
    }
  }

  private openGuardConversation(lines: NonEmpty<DialogLine>, onClosed: () => void): void {
    this.conversationHandle = this.deps.conversation.open(this.guardRequest(lines, onClosed));
  }

  private nextGuardLine(pool: NonEmpty<DialogLine>): DialogLine {
    const seed = this.guard?.seed ?? 0;
    const line = pickFreshLine(pool, seed, this.guardTalks, this.guardLastLine);
    this.guardLastLine = line;
    this.guardTalks++;
    return line;
  }

  private readSign(): void {
    const room = this.room;
    if (room === null) return;
    const stand = this.signStandPoint(room);
    this.conversationHandle = this.deps.conversation.open({
      lines: [prisonSignLine],
      reward: null,
      questRelated: false,
      ending: { kind: 'close', onClosed: () => undefined },
      dismiss: { kind: 'allowed', onDismissed: () => undefined },
      haltsWorld: false,
      anchor: {
        position: () => ({ x: stand.x - TILE_SIZE * HALF, y: stand.y - TILE_SIZE * HALF }),
        talkRangeTiles: STEALTH_GATE_TALK_RANGE_TILES,
      },
      locksKeyboard: false,
    });
  }

  /** Whether the conversation on screen is one this system opened. */
  get isDialogOpen(): boolean {
    return (
      this.conversationHandle !== null && this.deps.conversation.isActive(this.conversationHandle)
    );
  }

  // ── Frame ────────────────────────────────────────────────────────────────

  update(ctx: SystemContext): void {
    const guard = this.guard;
    if (this.room === null || guard === null) return;
    this.syncWithInventories(ctx);
    guard.gateActivity = this.isDialogOpen ? 'talk' : 'idle';
    if (guard.owCuePending) {
      guard.owCuePending = false;
      this.cue('guardHit');
    }
    if (this.raiseCueIn > 0) {
      this.raiseCueIn--;
      if (this.raiseCueIn === 0) this.cue('gateOpen');
    }
    this.tickGateBump(ctx.active);
    this.syncMarkers();
  }

  /** A crawler walking into the locked gate rattles it, and the guard says why it will not open. */
  private tickGateBump(active: HumanPlayer | CatPlayer): void {
    if (this.rattleCooldown > 0) this.rattleCooldown--;
    const room = this.room;
    if (room === null || this.currentPhase === 'opened' || this.currentPhase === 'keyHeld') return;
    if (!active.isMoving || this.rattleCooldown > 0) return;
    const centre = entityCentre(active);
    const tile = this.nearestGateTile(room, centre);
    if (tile === null) return;
    const gate = tileCentre(tile);
    if (distance(gate, centre) > GATE_BUMP_REACH_PX) return;
    const headingIntoGate =
      active.facingX * (gate.x - centre.x) + active.facingY * (gate.y - centre.y);
    if (headingIntoGate <= 0) return;
    this.rattleGate();
  }

  private cue(cue: PrisonCue): void {
    playPrisonCue(this.deps.audio, cue);
  }

  // ── Rendering ────────────────────────────────────────────────────────────

  /** Draws the prompt for what a press from `promptFor` would reach; pass none where a press would not. */
  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    promptFor: HumanPlayer | CatPlayer | undefined,
  ): void {
    const room = this.room;
    const guard = this.guard;
    if (room === null || guard === null || promptFor === undefined) return;
    const target = this.targetFor(promptFor);
    if (target === null) return;
    switch (target.kind) {
      case 'guard':
        drawInteractionPromptOver(ctx, guard, camX, camY, STEALTH_GATE_PROMPTS.talkToGuard);
        return;
      case 'gate': {
        const label =
          this.currentPhase === 'keyHeld'
            ? STEALTH_GATE_PROMPTS.unlockGate
            : STEALTH_GATE_PROMPTS.tryGate;
        const { x, y } = target.tile;
        const gateRisePx = stealthGateExtentsPx(this.deps.gameMap.structure, x, y, TILE_SIZE).up;
        drawInteractionPrompt(
          ctx,
          x * TILE_SIZE - camX,
          y * TILE_SIZE - camY - gateRisePx,
          TILE_SIZE,
          (y + 1) * TILE_SIZE - camY,
          label,
        );
        return;
      }
      case 'sign':
        drawInteractionPrompt(
          ctx,
          room.signTile.x * TILE_SIZE - camX,
          room.signTile.y * TILE_SIZE - camY,
          TILE_SIZE,
          (room.signTile.y + 1) * TILE_SIZE - camY,
          STEALTH_GATE_PROMPTS.readSign,
        );
        return;
    }
  }

  // ── Guidance ─────────────────────────────────────────────────────────────

  /**
   * A beam over the prison door from the guard's briefing until the key is in
   * hand, whether or not the Journal tracks the quest: "through the side door"
   * has to land on a door the player can see. Anchored on the door's approach
   * tile, where the tracker's own target stands, so a pin never stacks a
   * second beam on it, and set back one tile so the light rises from the
   * door's foot across its full width.
   */
  objectiveBeacons(): ReadonlyArray<TrackerTarget> {
    return this.currentPhase === 'briefed' ? this.prisonDoorBeacons : NO_BEACONS;
  }

  private prisonDoorBeaconsFor(room: StealthGateRoomData): ReadonlyArray<TrackerTarget> {
    const anchor = this.prisonDoorTile(room);
    return [
      {
        x: anchor.x,
        y: anchor.y,
        widthTiles: room.prisonDoor.faceTiles.length,
        backsetTiles: PRISON_DOOR_BEAM_BACKSET_TILES,
        brightness: DUNGEON_BEACON_BRIGHTNESS,
      },
    ];
  }

  private prisonDoorTile(room: StealthGateRoomData): Point {
    return room.prisonDoor.approachTiles[0] ?? room.centre;
  }

  get questMarkers(): Array<{ x: number; y: number; type: QuestMarkerType }> {
    const room = this.room;
    const marker = this.guardMarker();
    if (room === null || !npcMarkerShows(marker)) return [];
    const type = minimapMarkerFor(marker);
    return [{ x: room.guardTile.x, y: room.guardTile.y, type }];
  }

  trackerEntries(): ReadonlyArray<TrackerEntry> {
    const room = this.room;
    if (room === null) return [];
    const base = {
      kind: 'single',
      id: STEALTH_KEY_SNATCH_QUEST_ID,
      name: STEALTH_KEY_SNATCH_QUEST_NAME,
    } as const;
    switch (this.currentPhase) {
      case 'unmet':
        return [
          {
            ...base,
            status: 'available',
            objective: 'Find out why the gate is locked',
            hint: 'The goblin guarding the gate will tell you. At length.',
            target: room.guardTile,
          },
        ];
      case 'briefed':
        return [
          {
            ...base,
            status: 'active',
            objective: GET_KEY_OBJECTIVE,
            hint: 'The prison is through the double door in the side of the gate room.',
            target: this.prisonDoorTile(room),
          },
        ];
      case 'keyHeld':
        return [
          { ...base, status: 'active', objective: HAND_OVER_OBJECTIVE, target: room.guardTile },
        ];
      case 'opened':
        return [{ ...base, status: 'completed', objective: 'The gate is open' }];
    }
  }

  /**
   * Where a save taken by `body` would resume, or null when it is not standing
   * in the gate room with the gate open. From then on the room is a save point
   * only, never a safe room: nothing about who may enter it changes.
   */
  saveTileAt(body: { readonly x: number; readonly y: number }): Point | null {
    const room = this.room;
    if (room === null || this.currentPhase !== 'opened') return null;
    return roomSaveTile(this.deps.gameMap, room, body);
  }

  // ── Checkpoint ───────────────────────────────────────────────────────────

  captureCheckpoint(): StealthKeySnatchCheckpoint {
    return { phase: this.currentPhase, explainerSeen: this.seenExplainer };
  }

  /**
   * Puts the quest and the gate back as captured. Restored after the map's
   * own checkpoint, so the gate it sets is the one that sticks.
   */
  restoreCheckpoint(snapshot: StealthKeySnatchCheckpoint): void {
    this.seenExplainer = snapshot.explainerSeen;
    this.rattleCooldown = 0;
    this.applyPhase(snapshot.phase);
  }

  dispose(): void {
    this.stopListening();
  }
}
