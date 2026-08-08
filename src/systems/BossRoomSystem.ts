import type { GameMap } from '../map/GameMap';
import type { DamageSource, Player } from '../Player';
import { TILE_SIZE } from '../core/constants';
import { applyActiveDifficultyRewards } from '../core/difficultyProfiles';
import { clamp } from '../utils';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import { POINT_BLANK_TILES, TheHoarder } from '../creatures/TheHoarder';
import { Cockroach } from '../creatures/Cockroach';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { MiniMapSystem } from './MiniMapSystem';
import type { GroundHazardSource } from './GroundHazardSource';
import type { GameSystem, SystemContext } from './GameSystem';
import type { MobRoster } from './kits/SceneWorld';
import { drawText, TEXT_PRESETS } from '../ui/TextBox';
import { drawHoarderAcidPool, drawHoarderBile } from '../sprites/hoarderBileSprite';
import {
  KrakarenClone,
  MAX_GUARD_TENTACLES,
  KRAKAREN_VISUAL_SCALE,
} from '../creatures/KrakarenClone';
import { KrakarenTentacle } from '../creatures/KrakarenTentacle';
import { hasRoomToMove } from '../map/findWalkableTile';
import {
  drawSlamShadow,
  drawSlamImpact,
  drawKrakarenSlamTentacle,
} from '../sprites/krakarenSprite';
import { viewportWidth } from '../core/Viewport';

interface VomitProjectile {
  x: number;
  y: number;
  dx: number;
  dy: number;
  ttl: number;
  age: number;
  /**
   * The Hoarder that brought it up, so a hit can be recorded against her.
   *
   * A bolus in the air outlives her — this system keeps flying it after she
   * dies — so this may reference a dead mob, which is fine: it is only ever read
   * to note blood. Held on the record rather than on her precisely because a
   * projectile stored on a mob is deleted in mid-air when that mob dies.
   */
  readonly owner: TheHoarder;
}

interface AcidPuddle {
  x: number;
  y: number;
  ttl: number;
  /**
   * The Hoarder whose bolus poured it. A pool routinely outlives her, which is
   * why burning in one only counts as her blow while she is still alive — see
   * `tickAcidPuddles`.
   */
  readonly owner: TheHoarder;
}

export interface BossRoomState {
  bounds: { x: number; y: number; w: number; h: number };
  locked: boolean;
  defeated: boolean;
  defeatTimer: number;
  pulse: number;
  /** Frames remaining in the 30-second entry window after fight starts. */
  entryWindowTimer: number;
  /** True when boss is alive but no conscious players remain in the room (boss HP reset). */
  fightAborted: boolean;
}

/**
 * The mutable half of a `BossRoomState`. `bounds` is map geometry handed over by
 * `GameMap.bossRooms` and never changes, so a checkpoint neither copies nor
 * restores it.
 */
type BossRoomProgress = Omit<BossRoomState, 'bounds'>;

/** Point-in-time boss-room progress, restorable any number of times. */
export interface BossRoomCheckpoint {
  rooms: BossRoomProgress[];
  enteredRoomIndices: number[];
  humanIsInsider: boolean[];
  catIsInsider: boolean[];
  unenteredRegenDelay: number[];
  regenNoticeGiven: boolean[];
}

export const BOSS_META: Record<string, { displayName: string; color: string }> = {
  the_hoarder: { displayName: 'THE HOARDER', color: '#c084fc' },
  juicer: { displayName: 'THE JUICER', color: '#fb923c' },
  ball_of_swine: { displayName: 'BALL OF SWINE', color: '#f87171' },
  krakaren_clone: { displayName: 'KRAKAREN CLONE', color: '#e05090' },
};

/** 30 seconds at 60 fps. */
const ENTRY_WINDOW_FRAMES = 1800;

/**
 * Five seconds of nobody hurting an un-entered boss before it heals back up —
 * the same cadence the abort-heal uses for a fight that had actually started.
 * Long enough that an opener thrown from the threshold still counts for the
 * player walking in behind it.
 */
const UNENTERED_BOSS_REGEN_DELAY_FRAMES = 300;

/**
 * Said when it happens, because a boss quietly refilling its health bar off
 * screen is indistinguishable from the damage never having landed. The player
 * has to be able to learn the rule from playing, and the rule is that a boss
 * fight starts when you walk in.
 */
const UNENTERED_BOSS_REGEN_NOTICE = 'The boss is healing — this fight starts inside its room';

/** How near a room the party must be for a notice about that room to be worth reading. */
const REGEN_NOTICE_RANGE_TILES = 20;

/**
 * Drops every hazard a given boss laid, in place. In place because the arrays
 * are held by reference — the renderer and the companion's hazard-avoidance
 * both read them — and by owner because one system owns the hazards of every
 * boss room on the floor at once.
 */
function removeOwnedBy(items: Array<{ readonly owner: Mob }>, owner: Mob): void {
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i].owner === owner) items.splice(i, 1);
  }
}

const MAX_COCKROACHES = 5;
/**
 * At `ACID_PUDDLE_RADIUS` each and no two of them overlapping, this is about a
 * fifth of the boss room's floor. Fifteen was over half of it, which is not a
 * hazard to walk around — it is a wall, and the melee half of the party could
 * not reach her through it.
 */
const MAX_ACID_PUDDLES = 6;
/**
 * Twenty seconds. It was a hundred, from a time when the Hoarder almost never
 * spat: now that the bile is on its own clock, pools at the old lifetime would
 * simply accumulate until they owned the arena.
 */
const PUDDLE_TTL = 1200;
const ACID_DAMAGE_INTERVAL = 20;
const ACID_DAMAGE = 1;
/**
 * A direct hit used to do nothing at all — the bolus passed through the player
 * and the only harm was the pool it dropped. Small, because the pool is still
 * the real threat and this is meant to be the easy fight.
 */
const VOMIT_IMPACT_DAMAGE = 2;
const PROJECTILE_TTL = 90;
const ACID_PUDDLE_RADIUS = TILE_SIZE * 2;
const PROJECTILE_HIT_RADIUS_FRACTION = 0.8;
const PROJECTILE_HIT_RADIUS = TILE_SIZE * PROJECTILE_HIT_RADIUS_FRACTION;
/**
 * How close to a live pool a fresh one may land: exactly far enough apart that
 * two of them are tangent, so pools never overlap at all and the hazard spreads
 * around the room instead of merging into one wall with no lane through it.
 * Derived rather than written as a distance, because the tangency *is* the
 * reasoning — at a hand-set 2.5 tiles they still overlapped by a tile and a half
 * each and a run of them across an approach was a wall.
 */
const POOLS_TANGENT_MULTIPLIER = 2;
const PUDDLE_CROWDING_RADIUS = ACID_PUDDLE_RADIUS * POOLS_TANGENT_MULTIPLIER;
/**
 * No acid forms this close to a living Hoarder, so a bolus landing at the edge
 * of the bubble still cannot burn back into the ring a melee attacker stands in.
 * Otherwise a boss who backs into a corner spits a moat around herself and the
 * only way in is through it, which is exactly how the fight played.
 *
 * The same rule decides who she is willing to aim at, so it is her constant.
 */
const HOARDER_CLEAR_RADIUS = TILE_SIZE * POINT_BLANK_TILES;

// Rendering constants
const BOSS_REVIVE_HP_FRACTION = 0.3;
const DEFEAT_TIMER_FRAMES = 300;
const ACID_DAMAGE_FLASH_FRAMES = 8;
/**
 * Attributed to The Hoarder so the death screen can name what dissolved you, but
 * marked undodgeable: a puddle you are standing in is not something you sidestep.
 */
const ACID_PUDDLE_DAMAGE_SOURCE: DamageSource = {
  kind: 'mob',
  mobType: 'TheHoarder',
  attackType: 'acid_puddle',
  undodgeable: true,
};

/** A direct hit is dodgeable; standing in the pool it leaves is not. */
const VOMIT_IMPACT_DAMAGE_SOURCE: DamageSource = {
  kind: 'mob',
  mobType: 'TheHoarder',
  attackType: 'acid_puddle',
};
const COCKROACH_MOB_CLEANUP_THRESHOLD = 200;
const ENTITY_TILE_CENTER_OFFSET = 0.5;
/** Tile deltas around a position, nearest (orthogonal) first. */
const ADJACENT_TILE_OFFSETS = [
  [0, 1],
  [0, -1],
  [1, 0],
  [-1, 0],
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1],
] as const;

/** Alpha of the old puke stains painted into the room's floor decoration. */
const PUKE_STAIN_ALPHA = 0.45;
/** A quarter of the pool's life, so it visibly recedes rather than vanishing. */
const PUDDLE_FADE_FRAMES = 300;

// Hoarder room decoration constants
const GARBAGE_BAG_COUNT = 7;
const CARDBOARD_BOX_COUNT = 4;
const CRUSHED_CAN_COUNT = 8;
const PUKE_STAIN_COUNT = 5;
const PAPER_SCRAP_COUNT = 10;
const DECORATION_SCATTER_FRACTION = 0.5;

// Hoarder room: RNG seed factors
const RNG_SEED_X_FACTOR = 31;
const RNG_SEED_Y_FACTOR = 17;
const RNG_NOISE_SCALE = 127.1;
const RNG_NOISE_LARGE = 43758.5453;

// Garbage bag render
const GARBAGE_SCATTER_FRACTION = 0.7;
const GARBAGE_BAG_W_MIN = 0.5;
const GARBAGE_BAG_W_RANGE = 0.4;
const GARBAGE_BAG_H_MIN = 0.35;
const GARBAGE_BAG_H_RANGE = 0.25;
const GARBAGE_KNOT_RADIUS = 0.08;

// Cardboard box render
const BOX_SCATTER_FRACTION = 0.65;
const BOX_W_MIN = 0.4;
const BOX_W_RANGE = 0.35;
const BOX_H_MIN = 0.3;
const BOX_H_RANGE = 0.25;

// Crushed can render
const CAN_SCATTER_FRACTION = 0.75;
const CAN_RX_FRACTION = 0.1;
const CAN_RY_FRACTION = 0.06;

// Puke stain render
const PUKE_SCATTER_FRACTION = 0.6;
const PUKE_RX_MIN = 0.28;
const PUKE_RX_RANGE = 0.2;
const PUKE_RY_MIN = 0.14;
const PUKE_RY_RANGE = 0.1;

// Paper scrap render
const PAPER_SCATTER_FRACTION = 0.8;
const PAPER_COLOR_THRESHOLD = 0.5;
const PAPER_HALF_W = 0.12;
const PAPER_HALF_H = 0.07;

// RNG offset groups for each decoration type
const RNG_OFFSET_BAGS_10 = 10;
const RNG_OFFSET_BAGS_20 = 20;
const RNG_OFFSET_BAGS_30 = 30;
const RNG_OFFSET_BAGS_40 = 40;
const RNG_OFFSET_BAGS_5 = 5;
const RNG_OFFSET_BOXES_50 = 50;
const RNG_OFFSET_BOXES_60 = 60;
const RNG_OFFSET_BOXES_70 = 70;
const RNG_OFFSET_BOXES_80 = 80;
const RNG_OFFSET_CANS_90 = 90;
const RNG_OFFSET_CANS_100 = 100;
const RNG_OFFSET_CANS_110 = 110;
const RNG_OFFSET_PUKE_120 = 120;
const RNG_OFFSET_PUKE_130 = 130;
const RNG_OFFSET_PUKE_140 = 140;
const RNG_OFFSET_PUKE_150 = 150;
const RNG_OFFSET_PUKE_160 = 160;
const RNG_OFFSET_PAPER_170 = 170;
const RNG_OFFSET_PAPER_180 = 180;
const RNG_OFFSET_PAPER_190 = 190;
const RNG_OFFSET_PAPER_200 = 200;

// Krakaren clone room decoration constants
const WATER_PUDDLE_COUNT = 8;
const SLIME_TRAIL_COUNT = 6;
const WATER_SCATTER_FRACTION = 0.7;
const WATER_PUDDLE_ALPHA = 0.2;
const WATER_RX_MIN = 0.4;
const WATER_RX_RANGE = 0.3;
const WATER_RY_MIN = 0.2;
const WATER_RY_RANGE = 0.15;
const SLIME_SCATTER_FRACTION = 0.6;
const SLIME_ALPHA = 0.25;
const SLIME_RX_MIN = 0.15;
const SLIME_RX_RANGE = 0.2;
const SLIME_RY_MIN = 0.08;
const SLIME_RY_RANGE = 0.1;

// RNG offset groups for krakaren room
const RNG_OFFSET_WATER_10 = 10;
const RNG_OFFSET_WATER_20 = 20;
const RNG_OFFSET_WATER_30 = 30;
const RNG_OFFSET_WATER_40 = 40;
const RNG_OFFSET_SLIME_50 = 50;
const RNG_OFFSET_SLIME_60 = 60;
const RNG_OFFSET_SLIME_70 = 70;
const RNG_OFFSET_SLIME_80 = 80;
const RNG_OFFSET_SLIME_90 = 90;

// Boss HUD layout constants (desktop)
const BOSS_BAR_MAX_WIDTH = 360;
const BOSS_BAR_WIDTH_FRACTION = 0.5;
const BOSS_BAR_HEIGHT = 18;
const BOSS_BAR_TOP_Y = 48;
const BOSS_CONTAINER_PAD_X = 6;
const BOSS_CONTAINER_PAD_TOP = 22;
const BOSS_CONTAINER_SUBTEXT_H = 46;
const BOSS_CONTAINER_BASE_H = 30;
const BOSS_NAME_Y_OFFSET = 15;
const BOSS_HP_TEXT_OFFSET = 11;
const BOSS_DEFEATED_TEXT_Y = 6;
const BOSS_ENTRY_TEXT_Y = 6;
const BOSS_MIDLINE_FRACTION = 0.5;
const FRAMES_PER_SECOND = 60;
const BOSS_LABEL_BASELINE_FRACTION = 0.65;
const BOSS_LABEL_SIZE = 10;
const BOSS_LABEL_ASCENT_OFFSET = 8;

// Boss HUD layout constants (mobile)
const MOBILE_BOX_MARGIN = 8;
const MOBILE_BOX_GAP = 8;
const MOBILE_INNER_W_INSET = 12;
const MOBILE_INNER_X_OFFSET = 6;
const MOBILE_PAD_V = 6;
const MOBILE_NAME_H = 12;
const MOBILE_GAP = 4;
const MOBILE_BAR_H = 14;
const MOBILE_NAME_SIZE = 10;
const MOBILE_HP_SIZE = 9;
const MOBILE_SUBTEXT_SIZE = 10;

// Locked room border
const BORDER_PULSE_SPEED = 0.12;
const BORDER_PULSE_MIN = 0.55;
const BORDER_PULSE_AMP = 0.25;
const BORDER_LINE_WIDTH = 3;
const BORDER_CROSS_OFFSET = 4;

// Corner X markers

export class BossRoomSystem implements GameSystem, GroundHazardSource {
  private readonly states: BossRoomState[];
  private readonly bossTypes: string[];
  private readonly enteredRooms = new Set<number>();

  private readonly vomitProjectiles: VomitProjectile[] = [];
  private readonly acidPuddles: AcidPuddle[] = [];

  /**
   * Rebuilt from the mob list every frame rather than kept across frames, so a
   * checkpoint restore can never leave a disposed boss in here.
   */
  private readonly liveKrakarens: KrakarenClone[] = [];
  private humanAcidTick = 0;
  private catAcidTick = 0;

  /**
   * Whether a fresh pool here would crowd a live one. Used where a bolus lands.
   *
   * Every pool counts, including one already receding: it fades over five
   * seconds and burns at full strength the whole way down, so "it will be gone
   * by then" — which an earlier version of this said — was never true of ground
   * a bolus is landing on right now.
   */
  private readonly isPuddleCrowdedAt = (x: number, y: number): boolean =>
    this.acidPuddles.some(
      (puddle) => Math.hypot(puddle.x - x, puddle.y - y) < PUDDLE_CROWDING_RADIUS,
    );

  /**
   * Whether this point is inside acid *now*. Handed to the Hoarder so she does
   * not waste a spit on someone the floor is already burning; bound once rather
   * than rebuilt per frame, because she holds it across frames.
   *
   * A separate question from crowding and a much tighter radius: crowding asks
   * whether two pools would overlap, this asks whether a player is standing in
   * one. Answered at the crowding radius she would decline to shoot at anyone
   * within four tiles of any pool, which is most of the room she fights in.
   */
  private readonly isStandingInAcidAt = (x: number, y: number): boolean =>
    this.acidPuddles.some((puddle) => Math.hypot(puddle.x - x, puddle.y - y) < ACID_PUDDLE_RADIUS);

  /**
   * Last known positions for each player while they were OUTSIDE a boss room.
   * Used to push them back if they try to enter after the entry window closes.
   * Indexed by boss room state index.
   */
  private humanLastOutside: Array<{ x: number; y: number } | null>;
  private catLastOutside: Array<{ x: number; y: number } | null>;
  /**
   * Whether each player has legitimately entered each boss room (either was
   * inside when the fight started or entered during the 30-second window).
   * Only insiders are clamped in; non-insiders are pushed back when the
   * entry window closes.
   */
  private humanIsInsider: boolean[];
  private catIsInsider: boolean[];
  /** Frames each un-entered room's boss has gone unharmed; see `tickUnenteredBossRegen`. */
  private readonly unenteredRegenDelay: number[];
  /**
   * Whether each room still had a living boss standing in it last frame.
   *
   * Starts true so a companion's boss-room veto holds from the first frame,
   * before this system has looked at anything: assuming a fight is pending and
   * being wrong costs a moment of caution, while assuming one is not and being
   * wrong is the whole bug the veto exists to stop.
   */
  private readonly roomHasLivingBoss: boolean[];
  /** Whether the un-entered-regen lesson has already been given for each room. */
  private readonly regenNoticeGiven: boolean[];

  /** Set when a boss room is entered for the first time; cleared by DungeonScene. */
  newlyLockedBossType: string | null = null;

  /**
   * Rooms that flipped to `defeated` this frame, with the body that did it.
   * Drained by `DungeonScene`, which uses it as the last line of defence on the
   * boss chest: the kill pipeline is what normally fills the chest, and this
   * exists for the deaths it cannot attribute — a boss nobody ever hit, killed
   * by the environment, whose empty damage ledger leaves the loot gate closed.
   *
   * Deliberately a queue rather than a flag: two rooms can resolve on one frame,
   * and a chest that stays locked because a second boss overwrote the first is
   * the exact failure this is here to prevent.
   */
  readonly newlyDefeatedRooms: Array<{ roomIndex: number; boss: Mob }> = [];

  constructor(
    private readonly gameMap: GameMap,
    private readonly miniMap: MiniMapSystem,
    bossTypes: string[] = [],
  ) {
    this.bossTypes = bossTypes;
    this.states = gameMap.bossRooms.map((br) => ({
      bounds: br.bounds,
      locked: false,
      defeated: false,
      defeatTimer: 0,
      pulse: 0,
      entryWindowTimer: 0,
      fightAborted: false,
    }));
    this.humanLastOutside = gameMap.bossRooms.map(() => null);
    this.catLastOutside = gameMap.bossRooms.map(() => null);
    this.humanIsInsider = gameMap.bossRooms.map(() => false);
    this.catIsInsider = gameMap.bossRooms.map(() => false);
    this.unenteredRegenDelay = gameMap.bossRooms.map(() => 0);
    this.roomHasLivingBoss = gameMap.bossRooms.map(() => true);
    this.regenNoticeGiven = gameMap.bossRooms.map(() => false);
  }

  getBossRoomStates(): BossRoomState[] {
    return this.states;
  }

  /**
   * Whether this room still holds a boss fight nobody has had yet.
   *
   * The question a companion's veto actually wants answered. "Is this mob
   * standing inside boss-room bounds" is not the same thing: those bounds
   * outlive the fight, so once the boss is dead — or on a map that generated a
   * room the level never put a boss in — every hostile that wanders into them
   * would otherwise be invisible to the companion for the rest of the run.
   */
  isFightPending(state: BossRoomState): boolean {
    if (state.defeated) return false;
    const index = this.states.indexOf(state);
    return index >= 0 && this.roomHasLivingBoss[index];
  }

  /**
   * Unlocks every non-defeated room and drops standing acid/vomit so a
   * checkpoint respawn doesn't land the player inside a damage field left over
   * from the fight that killed them. Defeated rooms are left untouched. Walking
   * back in re-triggers the normal lock sequence via `update()`.
   */
  resetForCheckpoint(): void {
    for (let i = 0; i < this.states.length; i++) {
      const state = this.states[i];
      if (state.defeated) continue;
      state.locked = false;
      state.entryWindowTimer = 0;
      state.fightAborted = false;
      this.humanIsInsider[i] = false;
      this.catIsInsider[i] = false;
    }
    this.vomitProjectiles.length = 0;
    this.acidPuddles.length = 0;
  }

  /**
   * Snapshots every room's progress so a death can rewind a boss killed after
   * the checkpoint back to alive-and-unfought.
   *
   * Every container is copied on the way out and again on the way back in
   * (`restoreCheckpoint`), because the player can die repeatedly against one
   * snapshot and a shared array would let the first restore mutate it.
   */
  captureCheckpoint(): BossRoomCheckpoint {
    return {
      rooms: this.states.map((state) => ({
        locked: state.locked,
        defeated: state.defeated,
        defeatTimer: state.defeatTimer,
        pulse: state.pulse,
        entryWindowTimer: state.entryWindowTimer,
        fightAborted: state.fightAborted,
      })),
      enteredRoomIndices: [...this.enteredRooms],
      humanIsInsider: [...this.humanIsInsider],
      catIsInsider: [...this.catIsInsider],
      unenteredRegenDelay: [...this.unenteredRegenDelay],
      regenNoticeGiven: [...this.regenNoticeGiven],
    };
  }

  restoreCheckpoint(snapshot: BossRoomCheckpoint): void {
    const restoreCount = Math.min(this.states.length, snapshot.rooms.length);
    for (let index = 0; index < restoreCount; index++) {
      const state = this.states[index];
      const room = snapshot.rooms[index];
      state.locked = room.locked;
      state.defeated = room.defeated;
      state.defeatTimer = room.defeatTimer;
      state.pulse = room.pulse;
      state.entryWindowTimer = room.entryWindowTimer;
      state.fightAborted = room.fightAborted;
    }
    this.enteredRooms.clear();
    for (const index of snapshot.enteredRoomIndices) this.enteredRooms.add(index);
    this.humanIsInsider = [...snapshot.humanIsInsider];
    this.catIsInsider = [...snapshot.catIsInsider];
    for (let index = 0; index < this.unenteredRegenDelay.length; index++) {
      this.unenteredRegenDelay[index] = snapshot.unenteredRegenDelay[index] ?? 0;
      this.regenNoticeGiven[index] = snapshot.regenNoticeGiven[index] ?? false;
    }
  }

  /**
   * Which boss types have been killed, by the snake_case ids from
   * `levelDef.bossRooms[].type` (`'the_hoarder'`, `'juicer'`, `'krakaren_clone'`).
   *
   * A set of what is dead rather than a widening of `bossTypes` to public: that
   * is the question every caller actually has, and it is the only answer that
   * survives a scene rebuild. The `bossDefeated` event says the same thing in
   * the same vocabulary, but it says it once, at the moment of the kill — a
   * listener built after the fact, or rebuilt on a floor re-entry, never hears
   * it at all.
   */
  get defeatedBossTypes(): ReadonlySet<string> {
    const defeated = new Set<string>();
    // `bossTypes` can be shorter than `states`: the states come from the map's
    // generated boss rooms and the types from the level definition, and a level
    // that asked for more rooms than it named types for leaves the tail unnamed.
    this.states.forEach((state, index) => {
      if (state.defeated && index < this.bossTypes.length) defeated.add(this.bossTypes[index]);
    });
    return defeated;
  }

  isEntityInRoom(
    entity: { x: number; y: number },
    bounds: { x: number; y: number; w: number; h: number },
  ): boolean {
    const tx = Math.floor((entity.x + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET) / TILE_SIZE);
    const ty = Math.floor((entity.y + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET) / TILE_SIZE);
    return tx >= bounds.x && tx < bounds.x + bounds.w && ty >= bounds.y && ty < bounds.y + bounds.h;
  }

  isEntityInAnyBossRoom(entity: { x: number; y: number }): boolean {
    return this.states.some((s) => this.isEntityInRoom(entity, s.bounds));
  }

  /**
   * If the given pixel position is inside an active acid puddle, returns the unit
   * escape vector pointing away from the nearest puddle centre. Returns null when
   * the position is not in any hazard.
   */
  getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    const cx = x + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET;
    const cy = y + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET;
    let closestDist = Infinity;
    let closestPuddle: AcidPuddle | null = null;
    for (const p of this.acidPuddles) {
      const dist = Math.hypot(cx - p.x, cy - p.y);
      if (dist < ACID_PUDDLE_RADIUS && dist < closestDist) {
        closestDist = dist;
        closestPuddle = p;
      }
    }
    if (!closestPuddle) return null;
    const ex = cx - closestPuddle.x;
    const ey = cy - closestPuddle.y;
    const len = Math.hypot(ex, ey);
    if (len === 0) {
      const angle = Math.random() * Math.PI * 2;
      return { dx: Math.cos(angle), dy: Math.sin(angle) };
    }
    return { dx: ex / len, dy: ey / len };
  }

  /** Returns true if any boss room is currently locked (players clamped inside). */
  get anyLocked(): boolean {
    return this.states.some((s) => s.locked);
  }

  /**
   * Whether any boss room's bounds contain this mob, locked or not — i.e.
   * whether this system is the thing that should be deciding the mob's aggro.
   *
   * A boss that stands in no room at all belongs to somebody else (a bounty
   * encounter out in the wilderness), and its owner's `forceAggro` must not be
   * overwritten by a system with no rooms to speak for.
   */
  governsBoss(mob: Mob): boolean {
    return this.states.some((s) => this.isEntityInRoom(mob, s.bounds));
  }

  /** Returns true when this mob is inside an active (locked) boss room. */
  isBossInLockedRoom(mob: Mob): boolean {
    return this.states.some((s) => s.locked && this.isEntityInRoom(mob, s.bounds));
  }

  /**
   * Whether an alive player is standing in the same boss room as this boss.
   *
   * Unlike {@link isAnyPlayerInBossRoom} this does not require the room to be
   * locked, because the question it answers is about the moment *before* the
   * fight: a boss with a ten-tile aggro range can see down a corridor through
   * its own doorway, and the Hoarder was spitting acid across the threshold at
   * a party that had not come in yet — walling off her own entrance with pools
   * the companion AI would not path through.
   */
  sharesRoomWithPlayer(
    mob: Mob,
    players: ReadonlyArray<{ x: number; y: number; isAlive: boolean }>,
  ): boolean {
    for (const state of this.states) {
      if (!this.isEntityInRoom(mob, state.bounds)) continue;
      return players.some((p) => p.isAlive && this.isEntityInRoom(p, state.bounds));
    }
    return false;
  }

  /** Returns true when any alive player is inside the same locked boss room as this mob. */
  isAnyPlayerInBossRoom(
    mob: Mob,
    players: ReadonlyArray<{ x: number; y: number; isAlive: boolean }>,
  ): boolean {
    for (const state of this.states) {
      if (state.locked && this.isEntityInRoom(mob, state.bounds)) {
        return players.some((p) => p.isAlive && this.isEntityInRoom(p, state.bounds));
      }
    }
    return false;
  }

  update(ctx: SystemContext): void {
    const { human, cat } = ctx;
    const { mobs, grid: mobGrid } = ctx.roster;
    // Tick defeat timers and pulse
    for (const state of this.states) {
      if (state.defeatTimer > 0) state.defeatTimer--;
      if (state.locked || state.defeatTimer > 0) state.pulse++;
    }

    for (let i = 0; i < this.states.length; i++) {
      const state = this.states[i];
      if (state.defeated) {
        this.roomHasLivingBoss[i] = false;
        continue;
      }

      const boss = mobs.find((m) => m.isBoss && this.isEntityInRoom(m, state.bounds));
      const bossAlive = boss?.isAlive ?? false;
      this.roomHasLivingBoss[i] = bossAlive;

      const humanInRoom = this.isEntityInRoom(human, state.bounds);
      const catInRoom = this.isEntityInRoom(cat, state.bounds);

      // Resolve fight-aborted state: boss alive but no conscious players were in room.
      // If anyone re-enters, revive the knocked-out companion and restart the fight.
      if (state.fightAborted) {
        if (!bossAlive) {
          // Boss died while aborted (e.g. ranged kill from hallway) — mark defeated.
          state.fightAborted = false;
          state.defeated = true;
          state.defeatTimer = DEFEAT_TIMER_FRAMES;
          this.humanIsInsider[i] = false;
          this.catIsInsider[i] = false;
          this.miniMap.revealBossNeighborhood(state.bounds);
          if (boss) this.newlyDefeatedRooms.push({ roomIndex: i, boss });
        } else if (!humanInRoom && !catInRoom && boss !== undefined) {
          // An aborted room is still a room nobody is standing in, so the rule
          // that a boss cannot be emptied from the corridor has to reach it —
          // otherwise this is the one state in which it silently does not.
          this.tickUnenteredBossRegen(i, boss, state, ctx.active);
        } else if (humanInRoom || catInRoom) {
          // Player entered to revive companion — reset insider state, start fresh.
          state.fightAborted = false;
          this.humanIsInsider[i] = humanInRoom;
          this.catIsInsider[i] = catInRoom;
          if (!human.isAlive && humanInRoom) {
            human.hp = Math.max(1, Math.floor(human.maxHp * BOSS_REVIVE_HP_FRACTION));
            human.isKnockedOut = false;
            human.knockedOutFrames = 0;
            human.reviveProgress = 0;
          }
          if (!cat.isAlive && catInRoom) {
            cat.hp = Math.max(1, Math.floor(cat.maxHp * BOSS_REVIVE_HP_FRACTION));
            cat.isKnockedOut = false;
            cat.knockedOutFrames = 0;
            cat.reviveProgress = 0;
          }
        }
        continue;
      }

      // Start a new fight when a player enters a room with a living boss.
      if (!state.locked && bossAlive && (humanInRoom || catInRoom)) {
        state.locked = true;
        // They walked in, so the lesson landed. A later retreat and a second
        // poke earns it again.
        this.regenNoticeGiven[i] = false;
        state.entryWindowTimer = ENTRY_WINDOW_FRAMES;
        this.humanIsInsider[i] = humanInRoom;
        this.catIsInsider[i] = catInRoom;
        if (!this.enteredRooms.has(i)) {
          this.enteredRooms.add(i);
          this.newlyLockedBossType = this.bossTypes[i] ?? 'the_hoarder';
        }
      }

      if (!state.locked) {
        if (boss !== undefined && !bossAlive) {
          // A boss can die without its room ever locking — sniped through the
          // doorway, or finished by something the party left burning on it.
          // Everything downstream of a boss room hangs off this transition, so
          // without it the room stays "undefeated" for the rest of the run: no
          // minimap reveal, no silver chest, and a gateway floor that will not
          // let the party past a boss whose body is lying in front of them.
          //
          // Guarded on a boss actually existing rather than on `bossAlive`
          // alone: a map can hold more boss rooms than the level populates, and
          // an empty one would otherwise declare itself won on the first frame.
          state.defeated = true;
          state.defeatTimer = DEFEAT_TIMER_FRAMES;
          this.humanIsInsider[i] = false;
          this.catIsInsider[i] = false;
          this.miniMap.revealBossNeighborhood(state.bounds);
          this.newlyDefeatedRooms.push({ roomIndex: i, boss });
          continue;
        }
        if (boss !== undefined && bossAlive)
          this.tickUnenteredBossRegen(i, boss, state, ctx.active);
        // Room is open — track outside positions in case a fight starts next frame.
        this.humanLastOutside[i] = { x: human.x, y: human.y };
        this.catLastOutside[i] = { x: cat.x, y: cat.y };
        continue;
      }
      this.unenteredRegenDelay[i] = 0;

      // Tick the entry window.
      if (state.entryWindowTimer > 0) state.entryWindowTimer--;

      const entryWindowOpen = state.entryWindowTimer > 0;

      // A companion who goes down outside a sealed room is otherwise unreachable:
      // the active player is clamped in and the revive clock is already running,
      // so the fight would be an unavoidable loss. Drag them in, still down.
      const activePlayer = human.isActive ? human : cat;
      const companion = human.isActive ? cat : human;
      if (
        companion.isKnockedOut &&
        this.isEntityInRoom(activePlayer, state.bounds) &&
        !this.isEntityInRoom(companion, state.bounds)
      ) {
        this.dragIntoBossRoom(companion, activePlayer, state.bounds);
        if (human.isActive) this.catIsInsider[i] = true;
        else this.humanIsInsider[i] = true;
      }

      // The inactive (AI-controlled) companion knocked out inside counts as an
      // exception: the active player may enter at any time to revive them.
      const inactivePlayer = human.isActive ? cat : human;
      const companionDownInRoom =
        !inactivePlayer.isAlive && this.isEntityInRoom(inactivePlayer, state.bounds);

      // Handle each player's inside/outside status.
      for (const [player, lastOutside, isInsider] of [
        [human, this.humanLastOutside, 'humanIsInsider'] as const,
        [cat, this.catLastOutside, 'catIsInsider'] as const,
      ]) {
        const inRoom = this.isEntityInRoom(player, state.bounds);
        if (inRoom) {
          if (this[isInsider][i]) {
            // Already a legitimate insider — keep them clamped in.
            this.clampToBossRoom(player, state.bounds);
          } else if (entryWindowOpen || companionDownInRoom) {
            // Entering during the window or companion-down exception — welcome them in.
            this[isInsider][i] = true;
            this.clampToBossRoom(player, state.bounds);
          } else {
            // Entry window closed, no exception — push back to last outside position.
            const prev = lastOutside[i];
            if (prev !== null) {
              const prevTx = Math.floor(
                (prev.x + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET) / TILE_SIZE,
              );
              const prevTy = Math.floor(
                (prev.y + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET) / TILE_SIZE,
              );
              if (this.gameMap.isWalkable(prevTx, prevTy)) {
                player.x = prev.x;
                player.y = prev.y;
              }
            }
          }
        } else if (this[isInsider][i]) {
          // A player who joined the fight and is now outside it was moved there by
          // something other than walking — knockback through the doorway, or the
          // companion AI, which runs after this system has already clamped. Put
          // them back rather than recording the spot as somewhere they may stand:
          // a gateway boss room has a door on its far side, so treating "outside"
          // as safe ground would hand the player the whole floor beyond a living
          // boss.
          this.clampToBossRoom(player, state.bounds);
        } else {
          // Outside the room — track position for potential push-back.
          lastOutside[i] = { x: player.x, y: player.y };
        }
      }

      // Boss defeated normally. Nothing is cleaned up: the pools fade on their
      // own clock, a bolus still in the air lands and leaves one more, and the
      // cockroaches die where they stand rather than blinking out — the moment
      // the boss dropped, the whole room used to empty itself in one frame,
      // which reads as the level being reset rather than as a fight ending.
      if (!bossAlive) {
        state.locked = false;
        state.defeated = true;
        state.defeatTimer = DEFEAT_TIMER_FRAMES;
        this.humanIsInsider[i] = false;
        this.catIsInsider[i] = false;
        this.miniMap.revealBossNeighborhood(state.bounds);
        if (boss) this.newlyDefeatedRooms.push({ roomIndex: i, boss });
        // Her swarm outlives her by exactly as long as it takes to die. Killed
        // through `justDied` they come apart and leave the mob grid the way
        // anything else does, rather than being spliced out of existence. The
        // kill is unattributed unless the party had already been hitting that
        // roach — nobody earns a cockroach for killing its summoner.
        for (const mob of mobs) {
          if (mob instanceof Cockroach && mob.isAlive) {
            mob.hp = 0;
            mob.justDied = true;
          }
        }
        continue;
      }

      // Fight abort: boss still alive but no conscious players remain in the room.
      // Re-tested after the clamp above, so a player pulled back in this frame is
      // not counted as having left.
      const humanConscious =
        this.isEntityInRoom(human, state.bounds) && human.isAlive && !human.isKnockedOut;
      const catConscious =
        this.isEntityInRoom(cat, state.bounds) && cat.isAlive && !cat.isKnockedOut;
      if (boss && !humanConscious && !catConscious) {
        state.locked = false;
        state.fightAborted = true;
        this.humanIsInsider[i] = false;
        this.catIsInsider[i] = false;
        // The whole fight is unwound, not only the health bar: the damage
        // ledger the companion reads as "blood has been drawn here", and the
        // phase the boss latched on the way down. Refilling HP alone left both,
        // so an aborted fight permanently re-commissioned the companion against
        // a boss standing at full health — and handed the party a Juicer back
        // at full health that was still permanently enraged.
        boss.healAndForgetFight();
        removeOwnedBy(this.vomitProjectiles, boss);
        removeOwnedBy(this.acidPuddles, boss);
        continue;
      }
    }

    this.cacheLiveKrakarens(mobs);
    this.spawnHoarderCockroaches(ctx.roster);
    this.spawnKrakarenTentacles(ctx.roster);
    this.tickSummonedMobTTLs(mobs, mobGrid);
    this.processVomitProjectiles(mobs, human, cat);
    this.tickAcidPuddles(human, cat);
  }

  /**
   * Undoes damage dealt to a boss whose room nobody has walked into, once the
   * party has stopped dealing it.
   *
   * The room lock is what makes a boss a boss fight — the intro, the entry
   * window, the clamp, the abort-heal when the party is wiped or runs. All of
   * it is skipped by standing in the corridor and shooting through the doorway,
   * and a boss that cannot close the distance (the Krakaren does not move at
   * all) has no answer to it whatsoever. The abort-heal already refuses that
   * trade for a fight that *started*; this refuses it for one that never did.
   *
   * Five seconds from the first wound, and ongoing fire does not extend it.
   * That is the whole rule: an opener thrown from the threshold still counts
   * for the player who walks in behind it, and a party that would rather stand
   * in the corridor emptying a health bar it can already reach is told, once,
   * where the fight is. Measuring quiet instead was strictly worse — a cat
   * firing several missiles a second never leaves a quiet frame, so the party
   * that most needed telling was the one party the rule could never reach.
   *
   * The clock resets only when there is nothing to undo: a boss back at full
   * health with a clean ledger. Walking in stops it another way — the room
   * locks, and a locked room never reaches this at all.
   */
  private tickUnenteredBossRegen(
    roomIndex: number,
    boss: Mob,
    state: BossRoomState,
    active: HumanPlayer | CatPlayer,
  ): void {
    const untouched = boss.hp >= boss.maxHp && !boss.wasDamagedByParty;
    if (untouched) {
      this.unenteredRegenDelay[roomIndex] = 0;
      return;
    }
    this.unenteredRegenDelay[roomIndex]++;
    if (this.unenteredRegenDelay[roomIndex] < UNENTERED_BOSS_REGEN_DELAY_FRAMES) return;
    this.unenteredRegenDelay[roomIndex] = 0;
    boss.healAndForgetFight();
    // The ground this boss flooded goes with its wounds — a restored Hoarder
    // standing behind a wall of her own acid has sealed the doorway the notice
    // is telling the player to use. Filtered by owner rather than emptied:
    // these two arrays are shared by every room on the floor, and truncating
    // them would delete another boss's live hazards mid-fight.
    removeOwnedBy(this.vomitProjectiles, boss);
    removeOwnedBy(this.acidPuddles, boss);
    // Only to somebody close enough for it to mean anything. A line about a
    // boss healing, read three rooms away in the middle of a different fight,
    // is noise rather than the lesson it is meant to be.
    if (!this.regenNoticeGiven[roomIndex] && this.isWithinNoticeRange(active, state.bounds)) {
      this.regenNoticeGiven[roomIndex] = true;
      active.queueSystemNotice(UNENTERED_BOSS_REGEN_NOTICE);
    }
  }

  /** Whether this player is near enough a room for a notice about it to land. */
  private isWithinNoticeRange(
    player: { readonly x: number; readonly y: number },
    bounds: { x: number; y: number; w: number; h: number },
  ): boolean {
    const tileX = player.x / TILE_SIZE;
    const tileY = player.y / TILE_SIZE;
    const dx = Math.max(bounds.x - tileX, 0, tileX - (bounds.x + bounds.w));
    const dy = Math.max(bounds.y - tileY, 0, tileY - (bounds.y + bounds.h));
    return Math.hypot(dx, dy) <= REGEN_NOTICE_RANGE_TILES;
  }

  /** Clamps a boss mob to its own boss room (call after mob AI runs each frame). */
  clampBossToRoom(mob: Mob): void {
    // Only clamp to the room this mob is currently inside.
    // Clamping to every room sequentially would displace bosses to the last room.
    for (const state of this.states) {
      if (this.isEntityInRoom(mob, state.bounds)) {
        this.clampToBossRoom(mob, state.bounds);
        return;
      }
    }
    // Mob outside all rooms (shouldn't normally happen): clamp to nearest by center.
    let bestState: BossRoomState | null = null;
    let bestDist = Infinity;
    const mx = mob.x + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET;
    const my = mob.y + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET;
    for (const state of this.states) {
      const b = state.bounds;
      const cx = (b.x + b.w * ENTITY_TILE_CENTER_OFFSET) * TILE_SIZE;
      const cy = (b.y + b.h * ENTITY_TILE_CENTER_OFFSET) * TILE_SIZE;
      const d = Math.hypot(mx - cx, my - cy);
      if (d < bestDist) {
        bestDist = d;
        bestState = state;
      }
    }
    if (bestState) this.clampToBossRoom(mob, bestState.bounds);
  }

  /**
   * Drops a knocked-out crawler on the nearest free tile beside `anchor`, inside
   * the room, so the active player can stand over them and revive.
   */
  private dragIntoBossRoom(
    downed: HumanPlayer | CatPlayer,
    anchor: HumanPlayer | CatPlayer,
    bounds: { x: number; y: number; w: number; h: number },
  ): void {
    const anchorTileX = Math.floor((anchor.x + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET) / TILE_SIZE);
    const anchorTileY = Math.floor((anchor.y + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET) / TILE_SIZE);

    for (const [offsetX, offsetY] of ADJACENT_TILE_OFFSETS) {
      const tileX = anchorTileX + offsetX;
      const tileY = anchorTileY + offsetY;
      const insideRoom =
        tileX >= bounds.x &&
        tileX < bounds.x + bounds.w &&
        tileY >= bounds.y &&
        tileY < bounds.y + bounds.h;
      if (!insideRoom || !this.gameMap.isWalkable(tileX, tileY)) continue;
      downed.x = tileX * TILE_SIZE;
      downed.y = tileY * TILE_SIZE;
      return;
    }

    // Nowhere free: sharing the active player's tile still beats being sealed out.
    downed.x = anchor.x;
    downed.y = anchor.y;
  }

  /**
   * Re-clamps every player who has joined a live fight.
   *
   * Called again after the companion AI has moved, which happens later in the
   * frame than this system's own update — without it the companion can be walked
   * out of a sealed boss room and end the frame beyond it.
   */
  clampJoinedPlayers(human: { x: number; y: number }, cat: { x: number; y: number }): void {
    for (let i = 0; i < this.states.length; i++) {
      const state = this.states[i];
      if (!state.locked || state.defeated) continue;
      if (this.humanIsInsider[i]) this.clampToBossRoom(human, state.bounds);
      if (this.catIsInsider[i]) this.clampToBossRoom(cat, state.bounds);
    }
  }

  private clampToBossRoom(
    entity: { x: number; y: number },
    bounds: { x: number; y: number; w: number; h: number },
  ): void {
    const minPx = bounds.x * TILE_SIZE;
    const minPy = bounds.y * TILE_SIZE;
    const maxPx = (bounds.x + bounds.w - 1) * TILE_SIZE;
    const maxPy = (bounds.y + bounds.h - 1) * TILE_SIZE;
    entity.x = clamp(entity.x, minPx, maxPx);
    entity.y = clamp(entity.y, minPy, maxPy);
  }

  private cacheLiveKrakarens(mobs: Mob[]): void {
    this.liveKrakarens.length = 0;
    for (const mob of mobs) {
      if (mob instanceof KrakarenClone && mob.isAlive) this.liveKrakarens.push(mob);
    }
  }

  private spawnHoarderCockroaches(roster: MobRoster): void {
    const { mobs } = roster;
    // Counted rather than filtered into a new array, and only once a live
    // Hoarder is known to exist: this runs every frame on every floor, and on
    // the three floors with no Hoarder on them the filter was allocating an
    // array per frame to learn nothing.
    let hoarders = 0;
    let liveCount = 0;
    for (const mob of mobs) {
      if (!mob.isAlive) continue;
      if (mob instanceof Cockroach) liveCount++;
      else if (mob instanceof TheHoarder) hoarders++;
    }
    if (hoarders === 0) return;

    for (const mob of mobs) {
      if (!(mob instanceof TheHoarder) || !mob.isAlive) continue;

      mob.cockroachAtCap = liveCount >= MAX_COCKROACHES;
      mob.isAcidCovered = this.isStandingInAcidAt;

      // Enraged she brings up a spread, which is why this is a list rather than
      // the single slot it used to be.
      for (const p of mob.pendingVomitProjectiles) {
        this.vomitProjectiles.push({
          x: p.x,
          y: p.y,
          dx: p.dx,
          dy: p.dy,
          ttl: PROJECTILE_TTL,
          age: 0,
          owner: mob,
        });
      }
      mob.pendingVomitProjectiles.length = 0;

      if (mob.cockroachSpawns.length === 0) continue;
      let spawned = liveCount;
      for (const sp of mob.cockroachSpawns) {
        if (spawned >= MAX_COCKROACHES) break;
        const tileX = Math.floor(sp.x / TILE_SIZE);
        const tileY = Math.floor(sp.y / TILE_SIZE);
        if (this.gameMap.isWalkable(tileX, tileY)) {
          // Through the roster rather than by hand: a roach that never received
          // the scene's spell context walks straight through a protective shell.
          roster.add(new Cockroach(tileX, tileY, TILE_SIZE));
          spawned++;
        }
      }
      mob.cockroachSpawns = [];
    }
  }

  /**
   * True when a fresh pool here would land on the ground around a living
   * Hoarder. Tested where a bolus lands, so it keeps that ground clear at the
   * moment the acid appears; she is free to walk onto her own pools afterwards,
   * and a player chasing her is free to follow.
   */
  private isUnderfootOfHoarder(mobs: readonly Mob[], x: number, y: number): boolean {
    for (const mob of mobs) {
      if (!(mob instanceof TheHoarder) || !mob.isAlive) continue;
      const centreX = mob.x + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET;
      const centreY = mob.y + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET;
      if (Math.hypot(centreX - x, centreY - y) < HOARDER_CLEAR_RADIUS) return true;
    }
    return false;
  }

  private processVomitProjectiles(mobs: readonly Mob[], human: HumanPlayer, cat: CatPlayer): void {
    for (let i = this.vomitProjectiles.length - 1; i >= 0; i--) {
      const proj = this.vomitProjectiles[i];
      const newX = proj.x + proj.dx;
      const newY = proj.y + proj.dy;
      const tileX = Math.floor(newX / TILE_SIZE);
      const tileY = Math.floor(newY / TILE_SIZE);
      const hitWall = !this.gameMap.isWalkable(tileX, tileY);
      const humanDist = Math.hypot(
        newX - (human.x + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET),
        newY - (human.y + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET),
      );
      const catDist = Math.hypot(
        newX - (cat.x + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET),
        newY - (cat.y + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET),
      );
      const humanHit = human.isAlive && humanDist < PROJECTILE_HIT_RADIUS;
      const catHit = cat.isAlive && catDist < PROJECTILE_HIT_RADIUS;
      const hitPlayer = humanHit || catHit;
      if (hitWall || proj.ttl <= 0 || hitPlayer) {
        this.vomitProjectiles.splice(i, 1);
        if (humanHit && human.takeDamage(VOMIT_IMPACT_DAMAGE, VOMIT_IMPACT_DAMAGE_SOURCE)) {
          proj.owner.noteStruckPlayer(human);
        }
        if (catHit && cat.takeDamage(VOMIT_IMPACT_DAMAGE, VOMIT_IMPACT_DAMAGE_SOURCE)) {
          proj.owner.noteStruckPlayer(cat);
        }
        // A wall hit puddles where the bolus was, a player hit where it now is,
        // so the pool lands on them.
        const puddleX = hitWall ? proj.x : newX;
        const puddleY = hitWall ? proj.y : newY;
        // Crowding is decided here rather than where the bolus was aimed: it
        // flies until a wall, a player or its lifetime stops it, so the Hoarder
        // cannot know where it will come down, and the enraged spread's flanks
        // miss the target by construction and fly the whole way. A pool poured
        // into a live pool adds no hazard and takes another lane away, and one
        // at her own feet takes away the only ground anyone can hit her from.
        if (
          this.acidPuddles.length < MAX_ACID_PUDDLES &&
          !this.isPuddleCrowdedAt(puddleX, puddleY) &&
          !this.isUnderfootOfHoarder(mobs, puddleX, puddleY)
        ) {
          this.acidPuddles.push({ x: puddleX, y: puddleY, ttl: PUDDLE_TTL, owner: proj.owner });
        }
      } else {
        proj.x = newX;
        proj.y = newY;
        proj.ttl--;
        proj.age++;
      }
    }
  }

  /** The pool this player is standing in, if any. */
  private puddleUnder(player: Player): AcidPuddle | null {
    const centreX = player.x + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET;
    const centreY = player.y + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET;
    for (const puddle of this.acidPuddles) {
      if (Math.hypot(centreX - puddle.x, centreY - puddle.y) < ACID_PUDDLE_RADIUS) return puddle;
    }
    return null;
  }

  /**
   * One player's acid burn. Returns the new unbroken-contact count, which the
   * caller stores against that player.
   */
  private tickAcidFor(player: Player, contactFrames: number): number {
    const puddle = this.puddleUnder(player);
    if (puddle === null) return 0;

    const frames = contactFrames + 1;
    if (frames % ACID_DAMAGE_INTERVAL === 0) {
      const connected = player.takeDamage(ACID_DAMAGE, ACID_PUDDLE_DAMAGE_SOURCE);
      player.damageFlash = ACID_DAMAGE_FLASH_FRAMES;
      // Standing in a live Hoarder's acid is being in a fight with the Hoarder,
      // so the burn counts as her blow. Only while she lives: a pool outlasts
      // her, and reviving the flag for a dead boss would keep pointing the
      // companion at a corpse.
      if (connected && puddle.owner.isAlive) puddle.owner.noteStruckPlayer(player);
    }
    return frames;
  }

  private tickAcidPuddles(human: HumanPlayer, cat: CatPlayer): void {
    for (let i = this.acidPuddles.length - 1; i >= 0; i--) {
      const puddle = this.acidPuddles[i];
      puddle.ttl--;
      if (puddle.ttl <= 0) this.acidPuddles.splice(i, 1);
    }

    this.humanAcidTick = this.tickAcidFor(human, this.humanAcidTick);
    this.catAcidTick = this.tickAcidFor(cat, this.catAcidTick);
  }

  /**
   * One guard tentacle's frame. Returns 1 when it is a spent body the
   * compaction below should drop, 0 otherwise.
   *
   * A tentacle leaves twice over: it stops counting towards the guard the
   * moment it starts sliding back under, and it stops existing when the row
   * finishes. TTL expiry and the death of the boss that raised it both send it
   * on the same exit, so an add the player walked away from cannot go on
   * quartering their damage from across the room.
   */
  private tickGuardTentacle(tentacle: KrakarenTentacle): number {
    if (!tentacle.isAlive) return tentacle.justDied ? 0 : 1;
    const ownerFell = tentacle.owner !== null && !tentacle.owner.isAlive;
    if (ownerFell) {
      tentacle.beginRetreat();
      return 0;
    }
    if (tentacle.isLeaving) return 0;
    tentacle.ttl--;
    if (tentacle.ttl <= 0) tentacle.beginRetreat();
    return 0;
  }

  /**
   * Drains the Krakaren's pending guard tentacles, the way the Hoarder's
   * roaches are drained.
   *
   * The map test is `hasRoomToMove` rather than a bare walkability check: a
   * one-tile pocket between props is walkable ground that would root an add the
   * player then has to squeeze in to reach, in a fight whose whole mechanic is
   * reaching it.
   */
  private spawnKrakarenTentacles(roster: MobRoster): void {
    const { mobs } = roster;
    let bosses = 0;
    let liveCount = 0;
    for (const mob of mobs) {
      if (!mob.isAlive) continue;
      if (mob instanceof KrakarenTentacle) liveCount++;
      else if (mob instanceof KrakarenClone) bosses++;
    }
    if (bosses === 0) return;

    for (const mob of mobs) {
      if (!(mob instanceof KrakarenClone) || !mob.isAlive) continue;

      mob.guardTentacleAtCap = liveCount >= MAX_GUARD_TENTACLES;
      if (mob.tentacleSpawns.length === 0) continue;

      for (const sp of mob.tentacleSpawns) {
        if (liveCount >= MAX_GUARD_TENTACLES) break;
        const tileX = Math.floor(sp.x / TILE_SIZE);
        const tileY = Math.floor(sp.y / TILE_SIZE);
        if (!hasRoomToMove(this.gameMap, tileX, tileY)) continue;
        const tentacle = new KrakarenTentacle(tileX, tileY, TILE_SIZE, mob);
        // Once, at spawn, from the boss that raised it: an add levelled to a
        // weaker curve than the fight it belongs to is free damage reduction.
        tentacle.applyMobLevel(mob.mobLevel);
        applyActiveDifficultyRewards(tentacle);
        // Through the roster rather than by hand, so it receives the scene's
        // map and spell context like anything else that joins a fight.
        roster.add(tentacle);
        mob.registerGuardTentacle(tentacle);
        liveCount++;
      }
      mob.tentacleSpawns = [];
    }
  }

  /**
   * The clock on everything a boss brings up mid-fight, and the one pass that
   * clears the spent ones out of the roster.
   *
   * Roaches and guard tentacles leave differently — a roach simply stops
   * existing, a tentacle plays itself back underground first — but both end as
   * a zero-HP mob nothing killed, and both are compacted out here.
   */
  private tickSummonedMobTTLs(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    let expired = 0;
    for (const mob of mobs) {
      if (mob instanceof KrakarenTentacle) {
        expired += this.tickGuardTentacle(mob);
        continue;
      }
      if (!(mob instanceof Cockroach) || !mob.isAlive) continue;
      mob.ttl--;
      if (mob.ttl <= 0) {
        // Despawned, not killed. It used to be marked `justDied` purely to get
        // it out of the mob grid, which was harmless only while the kill
        // resolver dropped a mob nothing had damaged — now that it does not, a
        // roach that merely ran out of time would spray gore, leave a corpse
        // marker and add itself to the party's kill count.
        mob.hp = 0;
        expired++;
      }
    }
    if (expired === 0 && mobs.length <= COCKROACH_MOB_CLEANUP_THRESHOLD) return;

    // One compaction pass rather than a scan to un-grid the dead followed by a
    // reverse scan splicing them out one at a time: `splice` reshuffles the tail
    // on every removal, so clearing a whole swarm cost a quadratic amount of
    // copying on the exact frame the swarm was already at its largest.
    let keptCount = 0;
    for (const mob of mobs) {
      // A roach the checkpoint saw alive is owed a resurrection if the party
      // dies, and compacting it away is the one thing that makes that
      // impossible — the rewind can only reach what is still in the array.
      const isOwedToCheckpoint = mob.presentAtCheckpoint && mob.aliveAtCheckpoint;
      const isSpentSummon =
        !mob.isAlive && (mob instanceof Cockroach || mob instanceof KrakarenTentacle);
      // A death the kill resolver has not seen yet is not spent: compacting it
      // out of the array here is the one way to lose its gore and its rewards
      // outright, and this pass now runs on any frame a roach times out rather
      // than only on the rare frame the swarm is enormous.
      if (isSpentSummon && !mob.justDied) {
        // Out of the grid on both paths. A dead mob is never `belongsInMobGrid`,
        // and one held back for the checkpoint is re-inserted when the rewind
        // rebuilds the grid — kept in the grid it is a stale entry that outlives
        // the floor, because nothing else on this path ever removes it now that
        // a timed-out roach is no longer marked `justDied`.
        mobGrid.remove(mob);
        if (!isOwedToCheckpoint) {
          mob.dispose();
          continue;
        }
      }
      mobs[keptCount] = mob;
      keptCount++;
    }
    mobs.length = keptCount;
  }

  renderObjects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (let i = 0; i < this.states.length; i++) {
      const bossType = this.bossTypes[i] ?? 'the_hoarder';
      this.renderSingleBossRoomObjects(ctx, camX, camY, this.states[i].bounds, bossType);
    }
    this.renderAcidPuddles(ctx, camX, camY);
    this.renderKrakarenSlams(ctx, camX, camY);
  }

  renderProjectiles(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const proj of this.vomitProjectiles) {
      drawHoarderBile(
        ctx,
        proj.x - camX,
        proj.y - camY,
        TILE_SIZE,
        proj.age,
        Math.atan2(proj.dy, proj.dx),
      );
    }
  }

  private renderAcidPuddles(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const puddle of this.acidPuddles) {
      drawHoarderAcidPool(
        ctx,
        puddle.x - camX,
        puddle.y - camY,
        TILE_SIZE,
        PUDDLE_TTL - puddle.ttl,
        puddle.ttl,
        PUDDLE_FADE_FRAMES,
      );
    }
  }

  /**
   * The slam telegraph is floor paint, not part of the boss: drawn here it
   * survives the boss being culled off screen and the silhouette composite that
   * clips whatever a flashing mob draws beyond its own tile.
   */
  private renderKrakarenSlams(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const boss of this.liveKrakarens) {
      const tentacle = boss.slamTentacle;
      const shadow = boss.slamShadow;
      if (shadow) {
        const diveProgress = tentacle?.phase === 'dive' ? tentacle.progress : 0;
        drawSlamShadow(
          ctx,
          shadow.x - camX,
          shadow.y - camY,
          TILE_SIZE,
          shadow.progress,
          diveProgress,
        );
      }
      const impact = boss.slamImpact;
      if (impact) {
        drawSlamImpact(ctx, impact.x - camX, impact.y - camY, TILE_SIZE, impact.progress);
      }
      if (tentacle) {
        // Decals are floor paint and the tentacle is the thing standing on it,
        // so it goes over both of them.
        const standsAtTarget = tentacle.phase === 'smash';
        const worldX = standsAtTarget ? tentacle.targetX : tentacle.riseX;
        const worldY = standsAtTarget ? tentacle.targetY : tentacle.riseY;
        const tileOriginOffset = TILE_SIZE * ENTITY_TILE_CENTER_OFFSET;
        // Drawn at the boss's own visual scale, anchored on the same world
        // point, so it reads as belonging to her rather than to a smaller,
        // separate creature.
        drawKrakarenSlamTentacle(
          ctx,
          worldX - camX - tileOriginOffset,
          worldY - camY - tileOriginOffset,
          TILE_SIZE * KRAKAREN_VISUAL_SCALE,
          tentacle,
        );
      }
    }
  }

  private renderSingleBossRoomObjects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    b: { x: number; y: number; w: number; h: number },
    bossType: string,
  ): void {
    const ts = TILE_SIZE;
    const cx = (b.x + b.w * ENTITY_TILE_CENTER_OFFSET) * ts - camX;
    const cy = (b.y + b.h * ENTITY_TILE_CENTER_OFFSET) * ts - camY;

    const meta = BOSS_META[bossType] ?? BOSS_META.the_hoarder;
    const bannerX = (b.x + Math.floor(b.w / 2)) * ts - camX;
    const bannerY = (b.y - 1) * ts - camY;
    // "BOSS ROOM" world-space label
    // size=BOSS_LABEL_SIZE, old baseline = bannerY + ts*BOSS_LABEL_BASELINE_FRACTION; top = baseline - BOSS_LABEL_ASCENT_OFFSET
    drawText(ctx, 'BOSS ROOM', {
      ...TEXT_PRESETS.label,
      x: bannerX,
      y: bannerY + ts * BOSS_LABEL_BASELINE_FRACTION - BOSS_LABEL_ASCENT_OFFSET,
      size: BOSS_LABEL_SIZE,
      bold: true,
      color: meta.color,
      align: 'center',
    });

    // Juicer's gym room — decoration handled by JuicerRoomSystem
    if (bossType === 'juicer') return;

    // Krakaren Clone lair — water puddles and slime
    if (bossType === 'krakaren_clone') {
      ctx.save();
      const kseed = b.x * RNG_SEED_X_FACTOR + b.y * RNG_SEED_Y_FACTOR;
      const krng = (n: number) => {
        const sv = Math.sin(kseed + n * RNG_NOISE_SCALE) * RNG_NOISE_LARGE;
        return sv - Math.floor(sv);
      };
      // Water puddles
      for (let i = 0; i < WATER_PUDDLE_COUNT; i++) {
        const px = cx + (krng(i) - DECORATION_SCATTER_FRACTION) * b.w * ts * WATER_SCATTER_FRACTION;
        const py =
          cy +
          (krng(i + RNG_OFFSET_WATER_10) - DECORATION_SCATTER_FRACTION) *
            b.h *
            ts *
            WATER_SCATTER_FRACTION;
        ctx.globalAlpha = WATER_PUDDLE_ALPHA;
        ctx.fillStyle = '#4080a0';
        ctx.beginPath();
        ctx.ellipse(
          px,
          py,
          ts * (WATER_RX_MIN + krng(i + RNG_OFFSET_WATER_20) * WATER_RX_RANGE),
          ts * (WATER_RY_MIN + krng(i + RNG_OFFSET_WATER_30) * WATER_RY_RANGE),
          krng(i + RNG_OFFSET_WATER_40) * Math.PI,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      // Pink slime trails
      for (let i = 0; i < SLIME_TRAIL_COUNT; i++) {
        const slx =
          cx +
          (krng(i + RNG_OFFSET_SLIME_50) - DECORATION_SCATTER_FRACTION) *
            b.w *
            ts *
            SLIME_SCATTER_FRACTION;
        const sly =
          cy +
          (krng(i + RNG_OFFSET_SLIME_60) - DECORATION_SCATTER_FRACTION) *
            b.h *
            ts *
            SLIME_SCATTER_FRACTION;
        ctx.globalAlpha = SLIME_ALPHA;
        ctx.fillStyle = '#d06888';
        ctx.beginPath();
        ctx.ellipse(
          slx,
          sly,
          ts * (SLIME_RX_MIN + krng(i + RNG_OFFSET_SLIME_70) * SLIME_RX_RANGE),
          ts * (SLIME_RY_MIN + krng(i + RNG_OFFSET_SLIME_80) * SLIME_RY_RANGE),
          krng(i + RNG_OFFSET_SLIME_90) * Math.PI,
          0,
          Math.PI * 2,
        );
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      ctx.restore();
      return;
    }

    ctx.save();

    const seed = b.x * RNG_SEED_X_FACTOR + b.y * RNG_SEED_Y_FACTOR;
    const rng = (n: number) => {
      const s = Math.sin(seed + n * RNG_NOISE_SCALE) * RNG_NOISE_LARGE;
      return s - Math.floor(s);
    };

    // Garbage bags
    for (let i = 0; i < GARBAGE_BAG_COUNT; i++) {
      const gx = cx + (rng(i) - DECORATION_SCATTER_FRACTION) * b.w * ts * GARBAGE_SCATTER_FRACTION;
      const gy =
        cy +
        (rng(i + RNG_OFFSET_BAGS_10) - DECORATION_SCATTER_FRACTION) *
          b.h *
          ts *
          GARBAGE_SCATTER_FRACTION;
      const gw = ts * (GARBAGE_BAG_W_MIN + rng(i + RNG_OFFSET_BAGS_20) * GARBAGE_BAG_W_RANGE);
      const gh = ts * (GARBAGE_BAG_H_MIN + rng(i + RNG_OFFSET_BAGS_30) * GARBAGE_BAG_H_RANGE);
      ctx.fillStyle = rng(i + RNG_OFFSET_BAGS_5) > PAPER_COLOR_THRESHOLD ? '#1a3018' : '#0f1f0e';
      ctx.beginPath();
      ctx.ellipse(
        gx,
        gy,
        gw * DECORATION_SCATTER_FRACTION,
        gh * DECORATION_SCATTER_FRACTION,
        rng(i + RNG_OFFSET_BAGS_40) * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.fillStyle = '#4a7a40';
      ctx.beginPath();
      ctx.arc(gx, gy - gh * GARBAGE_BAG_H_MIN, gw * GARBAGE_KNOT_RADIUS, 0, Math.PI * 2);
      ctx.fill();
    }

    // Cardboard boxes
    for (let i = 0; i < CARDBOARD_BOX_COUNT; i++) {
      const bx =
        cx +
        (rng(i + RNG_OFFSET_BOXES_50) - DECORATION_SCATTER_FRACTION) *
          b.w *
          ts *
          BOX_SCATTER_FRACTION;
      const by =
        cy +
        (rng(i + RNG_OFFSET_BOXES_60) - DECORATION_SCATTER_FRACTION) *
          b.h *
          ts *
          BOX_SCATTER_FRACTION;
      const bw = ts * (BOX_W_MIN + rng(i + RNG_OFFSET_BOXES_70) * BOX_W_RANGE);
      const bh = ts * (BOX_H_MIN + rng(i + RNG_OFFSET_BOXES_80) * BOX_H_RANGE);
      ctx.fillStyle = '#4a3010';
      ctx.fillRect(
        bx - bw * DECORATION_SCATTER_FRACTION,
        by - bh * DECORATION_SCATTER_FRACTION,
        bw,
        bh,
      );
      ctx.strokeStyle = '#2a1a06';
      ctx.lineWidth = DECORATION_SCATTER_FRACTION;
      ctx.strokeRect(
        bx - bw * DECORATION_SCATTER_FRACTION,
        by - bh * DECORATION_SCATTER_FRACTION,
        bw,
        bh,
      );
      ctx.beginPath();
      ctx.moveTo(bx, by - bh * DECORATION_SCATTER_FRACTION);
      ctx.lineTo(bx, by + bh * DECORATION_SCATTER_FRACTION);
      ctx.moveTo(bx - bw * DECORATION_SCATTER_FRACTION, by);
      ctx.lineTo(bx + bw * DECORATION_SCATTER_FRACTION, by);
      ctx.stroke();
    }

    // Crushed cans
    for (let i = 0; i < CRUSHED_CAN_COUNT; i++) {
      const canX =
        cx +
        (rng(i + RNG_OFFSET_CANS_90) - DECORATION_SCATTER_FRACTION) *
          b.w *
          ts *
          CAN_SCATTER_FRACTION;
      const canY =
        cy +
        (rng(i + RNG_OFFSET_CANS_100) - DECORATION_SCATTER_FRACTION) *
          b.h *
          ts *
          CAN_SCATTER_FRACTION;
      ctx.fillStyle = '#8a8888';
      ctx.beginPath();
      ctx.ellipse(
        canX,
        canY,
        ts * CAN_RX_FRACTION,
        ts * CAN_RY_FRACTION,
        rng(i + RNG_OFFSET_CANS_110) * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }

    // Puke stains
    for (let i = 0; i < PUKE_STAIN_COUNT; i++) {
      const px =
        cx +
        (rng(i + RNG_OFFSET_PUKE_120) - DECORATION_SCATTER_FRACTION) *
          b.w *
          ts *
          PUKE_SCATTER_FRACTION;
      const py =
        cy +
        (rng(i + RNG_OFFSET_PUKE_130) - DECORATION_SCATTER_FRACTION) *
          b.h *
          ts *
          PUKE_SCATTER_FRACTION;
      ctx.globalAlpha = PUKE_STAIN_ALPHA;
      ctx.fillStyle = '#8fbc14';
      ctx.beginPath();
      ctx.ellipse(
        px,
        py,
        ts * (PUKE_RX_MIN + rng(i + RNG_OFFSET_PUKE_140) * PUKE_RX_RANGE),
        ts * (PUKE_RY_MIN + rng(i + RNG_OFFSET_PUKE_150) * PUKE_RY_RANGE),
        rng(i + RNG_OFFSET_PUKE_160) * Math.PI,
        0,
        Math.PI * 2,
      );
      ctx.fill();
    }
    ctx.globalAlpha = 1;

    // Paper scraps
    for (let i = 0; i < PAPER_SCRAP_COUNT; i++) {
      const px =
        cx +
        (rng(i + RNG_OFFSET_PAPER_170) - DECORATION_SCATTER_FRACTION) *
          b.w *
          ts *
          PAPER_SCATTER_FRACTION;
      const py =
        cy +
        (rng(i + RNG_OFFSET_PAPER_180) - DECORATION_SCATTER_FRACTION) *
          b.h *
          ts *
          PAPER_SCATTER_FRACTION;
      ctx.save();
      ctx.translate(px, py);
      ctx.rotate(rng(i + RNG_OFFSET_PAPER_190) * Math.PI);
      ctx.fillStyle = rng(i + RNG_OFFSET_PAPER_200) > PAPER_COLOR_THRESHOLD ? '#c8c0a8' : '#d8d0b8';
      ctx.fillRect(
        -ts * PAPER_HALF_W,
        -ts * PAPER_HALF_H,
        ts * PAPER_HALF_W * 2,
        ts * PAPER_HALF_H * 2,
      );
      ctx.restore();
    }

    ctx.restore();
  }

  /**
   * Renders the boss-room UI overlay.
   *
   * On mobile pass `mobileTopY` (pixels from canvas top where the box should
   * start). The method then returns the bottom Y of the rendered box so the
   * caller can stack the skill-points badge below it.
   *
   * On desktop omit `mobileTopY` — the centred desktop layout is used and
   * `null` is returned.
   */
  renderUI(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    mobs: Mob[],
    human: HumanPlayer,
    cat: CatPlayer,
    mobileTopY?: number,
  ): number | null {
    if (this.states.length === 0) return null;

    // Barrier lines for locked rooms
    for (const state of this.states) {
      if (!state.locked) continue;
      const b = state.bounds;
      const ts = TILE_SIZE;
      ctx.save();
      const pulse =
        BORDER_PULSE_MIN + BORDER_PULSE_AMP * Math.sin(state.pulse * BORDER_PULSE_SPEED);
      ctx.globalAlpha = pulse;
      // Yellow border while entry window is open; red once it closes.
      ctx.strokeStyle = state.entryWindowTimer > 0 ? '#fbbf24' : '#ef4444';
      ctx.lineWidth = BORDER_LINE_WIDTH;
      ctx.strokeRect(b.x * ts - camX, b.y * ts - camY, b.w * ts, b.h * ts);
      ctx.lineWidth = 2;
      const corners: [number, number][] = [
        [b.x, b.y],
        [b.x + b.w - 1, b.y],
        [b.x, b.y + b.h - 1],
        [b.x + b.w - 1, b.y + b.h - 1],
      ];
      for (const [ex, ey] of corners) {
        const sx = ex * ts - camX;
        const sy = ey * ts - camY;
        ctx.beginPath();
        ctx.moveTo(sx + BORDER_CROSS_OFFSET, sy + BORDER_CROSS_OFFSET);
        ctx.lineTo(sx + ts - BORDER_CROSS_OFFSET, sy + ts - BORDER_CROSS_OFFSET);
        ctx.moveTo(sx + ts - BORDER_CROSS_OFFSET, sy + BORDER_CROSS_OFFSET);
        ctx.lineTo(sx + BORDER_CROSS_OFFSET, sy + ts - BORDER_CROSS_OFFSET);
        ctx.stroke();
      }
      ctx.restore();
    }

    // Boss health bar
    const active = human.isActive ? human : cat;
    const relevantState = this.states.find(
      (s) =>
        s.locked ||
        s.defeatTimer > 0 ||
        this.isEntityInRoom(active, s.bounds) ||
        this.isEntityInRoom(human, s.bounds) ||
        this.isEntityInRoom(cat, s.bounds),
    );
    if (!relevantState) return null;

    const relevantStateIdx = this.states.indexOf(relevantState);
    const bossType = this.bossTypes[relevantStateIdx] ?? 'the_hoarder';
    const meta = BOSS_META[bossType] ?? BOSS_META.the_hoarder;

    const boss = mobs.find((m) => m.isBoss && this.isEntityInRoom(m, relevantState.bounds));
    if (!boss) return null;

    const isEnraged = boss.isEnraged ?? false;
    const hpFrac = Math.max(0, boss.hp / boss.maxHp);

    if (mobileTopY !== undefined) {
      return this.renderMobileBossBar(
        ctx,
        boss,
        relevantState,
        meta,
        isEnraged,
        hpFrac,
        mobileTopY,
      );
    }

    const barW = Math.min(BOSS_BAR_MAX_WIDTH, viewportWidth() * BOSS_BAR_WIDTH_FRACTION);
    const barH = BOSS_BAR_HEIGHT;
    const barX = Math.floor((viewportWidth() - barW) / 2);
    const barY = BOSS_BAR_TOP_Y;

    const showSubText =
      relevantState.defeated || (relevantState.locked && relevantState.entryWindowTimer > 0);
    // Expand container height when sub-text (DEFEATED / countdown) is present so
    // the text is not bisected by the box border.
    const containerH = showSubText ? barH + BOSS_CONTAINER_SUBTEXT_H : barH + BOSS_CONTAINER_BASE_H;

    ctx.save();

    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(
      barX - BOSS_CONTAINER_PAD_X,
      barY - BOSS_CONTAINER_PAD_TOP,
      barW + BOSS_CONTAINER_PAD_X * 2,
      containerH,
    );
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(
      barX - BOSS_CONTAINER_PAD_X,
      barY - BOSS_CONTAINER_PAD_TOP,
      barW + BOSS_CONTAINER_PAD_X * 2,
      containerH,
    );

    const nameText = isEnraged ? `⚠ ${meta.displayName} [ENRAGED] ⚠` : meta.displayName;
    drawText(ctx, nameText, {
      x: viewportWidth() / 2,
      y: barY - BOSS_NAME_Y_OFFSET,
      size: 11,
      bold: true,
      color: isEnraged ? '#ef4444' : meta.color,
      align: 'center',
    });

    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(barX, barY, barW, barH);

    ctx.fillStyle = isEnraged ? '#ef4444' : meta.color;
    ctx.fillRect(barX, barY, barW * hpFrac, barH);

    ctx.strokeStyle = 'rgba(239,68,68,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(barX + barW * BOSS_MIDLINE_FRACTION, barY);
    ctx.lineTo(barX + barW * BOSS_MIDLINE_FRACTION, barY + barH);
    ctx.stroke();

    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(barX, barY, barW, barH);

    ctx.restore();

    drawText(ctx, `${boss.hp} / ${boss.maxHp}`, {
      x: viewportWidth() / 2,
      y: barY + barH - BOSS_HP_TEXT_OFFSET,
      size: 9,
      color: '#e2e8f0',
      align: 'center',
    });

    if (relevantState.defeated) {
      drawText(ctx, 'DEFEATED', {
        x: viewportWidth() / 2,
        y: barY + barH + BOSS_DEFEATED_TEXT_Y,
        size: 12,
        bold: true,
        color: '#4ade80',
        align: 'center',
      });
    }

    if (relevantState.locked && relevantState.entryWindowTimer > 0) {
      const seconds = Math.ceil(relevantState.entryWindowTimer / FRAMES_PER_SECOND);
      drawText(ctx, `Entry closes in ${seconds}s`, {
        x: viewportWidth() / 2,
        y: barY + barH + BOSS_ENTRY_TEXT_Y,
        size: 11,
        bold: true,
        color: '#fbbf24',
        align: 'center',
      });
    }

    void camX;
    void camY;
    return null;
  }

  private renderMobileBossBar(
    ctx: CanvasRenderingContext2D,
    boss: Mob,
    state: BossRoomState,
    meta: { displayName: string; color: string },
    isEnraged: boolean,
    hpFrac: number,
    topY: number,
  ): number {
    const mmSize = this.miniMap.isExpanded ? this.miniMap.EXPANDED_SIZE : this.miniMap.NORMAL_SIZE;
    const BOX_X = MOBILE_BOX_MARGIN;
    // Leave MOBILE_BOX_GAP px between the box's right edge and the minimap's left edge.
    const boxW = viewportWidth() - (mmSize + MOBILE_BOX_GAP) - BOX_X - MOBILE_BOX_GAP;
    const innerW = boxW - MOBILE_INNER_W_INSET;
    const innerX = BOX_X + MOBILE_INNER_X_OFFSET;

    const PAD_V = MOBILE_PAD_V;
    const NAME_H = MOBILE_NAME_H;
    const GAP = MOBILE_GAP;
    const BAR_H = MOBILE_BAR_H;

    const hasSubText = state.defeated || (state.locked && state.entryWindowTimer > 0);
    const boxH = PAD_V + NAME_H + GAP + BAR_H + (hasSubText ? GAP + NAME_H : 0) + PAD_V;

    // Container
    ctx.save();
    ctx.fillStyle = 'rgba(0,0,0,0.75)';
    ctx.fillRect(BOX_X, topY, boxW, boxH);
    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(BOX_X, topY, boxW, boxH);
    ctx.restore();

    // Boss name — no flanking ⚠ symbols; enraged state shown via red colour
    const nameY = topY + PAD_V;
    const nameText = isEnraged ? `${meta.displayName} [ENRAGED]` : meta.displayName;
    drawText(ctx, nameText, {
      x: innerX + innerW / 2,
      y: nameY,
      size: MOBILE_NAME_SIZE,
      bold: true,
      color: isEnraged ? '#ef4444' : meta.color,
      align: 'center',
    });

    // HP bar
    const barY = nameY + NAME_H + GAP;
    ctx.save();
    ctx.fillStyle = '#0a0a12';
    ctx.fillRect(innerX, barY, innerW, BAR_H);
    ctx.fillStyle = isEnraged ? '#ef4444' : meta.color;
    ctx.fillRect(innerX, barY, innerW * hpFrac, BAR_H);

    ctx.strokeStyle = 'rgba(239,68,68,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(innerX + innerW * BOSS_MIDLINE_FRACTION, barY);
    ctx.lineTo(innerX + innerW * BOSS_MIDLINE_FRACTION, barY + BAR_H);
    ctx.stroke();

    ctx.strokeStyle = meta.color;
    ctx.lineWidth = 1;
    ctx.strokeRect(innerX, barY, innerW, BAR_H);
    ctx.restore();

    drawText(ctx, `${boss.hp} / ${boss.maxHp}`, {
      x: innerX + innerW / 2,
      y: barY + Math.floor((BAR_H - MOBILE_HP_SIZE) / 2),
      size: MOBILE_HP_SIZE,
      color: '#e2e8f0',
      align: 'center',
    });

    // Sub-text (DEFEATED or entry countdown)
    if (hasSubText) {
      const subY = barY + BAR_H + GAP;
      if (state.defeated) {
        drawText(ctx, 'DEFEATED', {
          x: BOX_X + boxW / 2,
          y: subY,
          size: MOBILE_SUBTEXT_SIZE,
          bold: true,
          color: '#4ade80',
          align: 'center',
        });
      } else if (state.locked && state.entryWindowTimer > 0) {
        const seconds = Math.ceil(state.entryWindowTimer / FRAMES_PER_SECOND);
        drawText(ctx, `Entry closes in ${seconds}s`, {
          x: BOX_X + boxW / 2,
          y: subY,
          size: MOBILE_SUBTEXT_SIZE,
          bold: true,
          color: '#fbbf24',
          align: 'center',
        });
      }
    }

    return topY + boxH;
  }
}
