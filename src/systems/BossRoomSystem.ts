import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import { clamp } from '../utils';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import { TheHoarder } from '../creatures/TheHoarder';
import { Cockroach } from '../creatures/Cockroach';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { MiniMapSystem } from './MiniMapSystem';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawText, TEXT_PRESETS } from '../ui/TextBox';
import { drawSpriteKey, progressFrameIndex, timeFrameIndex } from '../core/SpriteRenderer';

interface VomitProjectile {
  x: number;
  y: number;
  dx: number;
  dy: number;
  ttl: number;
  age: number;
}

interface AcidPuddle {
  x: number;
  y: number;
  ttl: number;
}

interface BossRoomState {
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

export const BOSS_META: Record<string, { displayName: string; color: string }> = {
  the_hoarder: { displayName: 'THE HOARDER', color: '#c084fc' },
  juicer: { displayName: 'THE JUICER', color: '#fb923c' },
  ball_of_swine: { displayName: 'BALL OF SWINE', color: '#f87171' },
  krakaren_clone: { displayName: 'KRAKAREN CLONE', color: '#e05090' },
};

/** 30 seconds at 60 fps. */
const ENTRY_WINDOW_FRAMES = 1800;

const MAX_COCKROACHES = 3;
const MAX_ACID_PUDDLES = 15;
const PUDDLE_TTL = 6000;
const ACID_DAMAGE_INTERVAL = 20;
const PROJECTILE_TTL = 90;
const ACID_PUDDLE_RADIUS = TILE_SIZE * 2;
const PROJECTILE_HIT_RADIUS_FRACTION = 0.8;
const PROJECTILE_HIT_RADIUS = TILE_SIZE * PROJECTILE_HIT_RADIUS_FRACTION;

// Rendering constants
const BOSS_REVIVE_HP_FRACTION = 0.3;
const DEFEAT_TIMER_FRAMES = 300;
const ACID_DAMAGE_FLASH_FRAMES = 8;
const COCKROACH_MOB_CLEANUP_THRESHOLD = 200;
const ENTITY_TILE_CENTER_OFFSET = 0.5;

// Vomit projectile render constants
const VOMIT_BLOB_RADIUS_FRACTION = 0.35;
const VOMIT_ELONGATION_MIN = 0.6;
const VOMIT_ELONGATION_RANGE = 1.4;
const VOMIT_BLOB_HEIGHT_FRACTION = 0.55;
const VOMIT_SPRITE_FRAMES = 7;

// Acid puddle render constants
const PUDDLE_FADE_FRAMES = 300;
const PUDDLE_ANIMATION_FPS = 60;
const PUDDLE_FRAME_ROWS = 6;
const PUDDLE_FRAME_COLS = 4;
const PUDDLE_PULSE_SPEED = 0.12;
const PUDDLE_BASE_ALPHA = 0.7;
const PUDDLE_PULSE_AMP = 0.3;
const PUDDLE_OUTER_ALPHA = 0.45;
const PUDDLE_OUTER_RX_FRACTION = 1.2;
const PUDDLE_OUTER_RY_FRACTION = 0.55;
const PUDDLE_INNER_RX_FRACTION = 0.7;
const PUDDLE_INNER_RY_FRACTION = 0.3;

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

export class BossRoomSystem implements GameSystem {
  private readonly states: BossRoomState[];
  private readonly bossTypes: string[];
  private readonly enteredRooms = new Set<number>();

  private readonly vomitProjectiles: VomitProjectile[] = [];
  private readonly acidPuddles: AcidPuddle[] = [];
  private puddleClock = 0;
  private humanAcidTick = 0;
  private catAcidTick = 0;

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

  /** Set when a boss room is entered for the first time; cleared by DungeonScene. */
  newlyLockedBossType: string | null = null;

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
  }

  getBossRoomStates(): BossRoomState[] {
    return this.states;
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

  /** Returns true when this mob is inside an active (locked) boss room. */
  isBossInLockedRoom(mob: Mob): boolean {
    return this.states.some((s) => s.locked && this.isEntityInRoom(mob, s.bounds));
  }

  update(ctx: SystemContext): void {
    const { mobs, mobGrid, human, cat } = ctx;
    // Tick defeat timers and pulse
    for (const state of this.states) {
      if (state.defeatTimer > 0) state.defeatTimer--;
      if (state.locked || state.defeatTimer > 0) state.pulse++;
    }

    for (let i = 0; i < this.states.length; i++) {
      const state = this.states[i];
      if (state.defeated) continue;

      const boss = mobs.find((m) => m.isBoss && this.isEntityInRoom(m, state.bounds));
      const bossAlive = boss?.isAlive ?? false;

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
          this.vomitProjectiles.length = 0;
          this.acidPuddles.length = 0;
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
        state.entryWindowTimer = ENTRY_WINDOW_FRAMES;
        this.humanIsInsider[i] = humanInRoom;
        this.catIsInsider[i] = catInRoom;
        if (!this.enteredRooms.has(i)) {
          this.enteredRooms.add(i);
          this.newlyLockedBossType = this.bossTypes[i] ?? 'the_hoarder';
        }
      }

      if (!state.locked) {
        // Room is open — track outside positions in case a fight starts next frame.
        this.humanLastOutside[i] = { x: human.x, y: human.y };
        this.catLastOutside[i] = { x: cat.x, y: cat.y };
        continue;
      }

      // Tick the entry window.
      if (state.entryWindowTimer > 0) state.entryWindowTimer--;

      const entryWindowOpen = state.entryWindowTimer > 0;

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
        } else {
          // Outside the room — track position for potential push-back.
          lastOutside[i] = { x: player.x, y: player.y };
        }
      }

      // Boss defeated normally.
      if (!bossAlive) {
        state.locked = false;
        state.defeated = true;
        state.defeatTimer = DEFEAT_TIMER_FRAMES;
        this.humanIsInsider[i] = false;
        this.catIsInsider[i] = false;
        this.miniMap.revealBossNeighborhood(state.bounds);
        for (const mob of mobs) {
          if (mob instanceof Cockroach && mob.isAlive) {
            mob.hp = 0;
            mob.justDied = true;
          }
        }
        this.vomitProjectiles.length = 0;
        this.acidPuddles.length = 0;
        continue;
      }

      // Fight abort: boss still alive but no conscious players remain in the room.
      const humanConscious = humanInRoom && human.isAlive && !human.isKnockedOut;
      const catConscious = catInRoom && cat.isAlive && !cat.isKnockedOut;
      if (boss && !humanConscious && !catConscious) {
        state.locked = false;
        state.fightAborted = true;
        this.humanIsInsider[i] = false;
        this.catIsInsider[i] = false;
        boss.hp = boss.maxHp;
        this.vomitProjectiles.length = 0;
        this.acidPuddles.length = 0;
        continue;
      }
    }

    this.spawnHoarderCockroaches(mobs, mobGrid);
    this.tickCockroachTTLs(mobs, mobGrid);
    this.processVomitProjectiles(human, cat);
    this.tickAcidPuddles(human, cat);
    this.puddleClock++;
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

  private spawnHoarderCockroaches(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    const liveCount = mobs.filter((m) => m instanceof Cockroach && m.isAlive).length;
    for (const mob of mobs) {
      if (!(mob instanceof TheHoarder) || !mob.isAlive) continue;

      // Tell the hoarder whether the cap is full so it can decide to vomit instead
      mob.cockroachAtCap = liveCount >= MAX_COCKROACHES;

      // Drain any pending vomit projectile
      if (mob.pendingVomitProjectile !== null) {
        const p = mob.pendingVomitProjectile;
        mob.pendingVomitProjectile = null;
        this.vomitProjectiles.push({
          x: p.x,
          y: p.y,
          dx: p.dx,
          dy: p.dy,
          ttl: PROJECTILE_TTL,
          age: 0,
        });
      }

      if (mob.cockroachSpawns.length === 0) continue;
      let spawned = liveCount;
      for (const sp of mob.cockroachSpawns) {
        if (spawned >= MAX_COCKROACHES) break;
        const tileX = Math.floor(sp.x / TILE_SIZE);
        const tileY = Math.floor(sp.y / TILE_SIZE);
        if (this.gameMap.isWalkable(tileX, tileY)) {
          const roach = new Cockroach(tileX, tileY, TILE_SIZE);
          roach.setMap(this.gameMap);
          mobs.push(roach);
          mobGrid.insert(roach);
          spawned++;
        }
      }
      mob.cockroachSpawns = [];
    }
  }

  private processVomitProjectiles(human: HumanPlayer, cat: CatPlayer): void {
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
      const hitPlayer = humanDist < PROJECTILE_HIT_RADIUS || catDist < PROJECTILE_HIT_RADIUS;
      if (hitWall || proj.ttl <= 0 || hitPlayer) {
        this.vomitProjectiles.splice(i, 1);
        if (this.acidPuddles.length < MAX_ACID_PUDDLES) {
          // For wall hits use the pre-move position; for player hits use the new position so the puddle lands on them
          const puddleX = hitWall ? proj.x : newX;
          const puddleY = hitWall ? proj.y : newY;
          this.acidPuddles.push({ x: puddleX, y: puddleY, ttl: PUDDLE_TTL });
        }
      } else {
        proj.x = newX;
        proj.y = newY;
        proj.ttl--;
        proj.age++;
      }
    }
  }

  private tickAcidPuddles(human: HumanPlayer, cat: CatPlayer): void {
    for (let i = this.acidPuddles.length - 1; i >= 0; i--) {
      const puddle = this.acidPuddles[i];
      puddle.ttl--;
      if (puddle.ttl <= 0) this.acidPuddles.splice(i, 1);
    }

    // Apply acid damage per player
    const humanInAcid = this.acidPuddles.some(
      (p) =>
        Math.hypot(
          human.x + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET - p.x,
          human.y + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET - p.y,
        ) < ACID_PUDDLE_RADIUS,
    );
    if (humanInAcid) {
      this.humanAcidTick++;
      if (this.humanAcidTick % ACID_DAMAGE_INTERVAL === 0) {
        human.takeDamage(1, { kind: 'mob', mobType: 'TheHoarder', attackType: 'acid_puddle' });
        human.damageFlash = ACID_DAMAGE_FLASH_FRAMES;
      }
    } else {
      this.humanAcidTick = 0;
    }

    const catInAcid = this.acidPuddles.some(
      (p) =>
        Math.hypot(
          cat.x + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET - p.x,
          cat.y + TILE_SIZE * ENTITY_TILE_CENTER_OFFSET - p.y,
        ) < ACID_PUDDLE_RADIUS,
    );
    if (catInAcid) {
      this.catAcidTick++;
      if (this.catAcidTick % ACID_DAMAGE_INTERVAL === 0) {
        cat.takeDamage(1, { kind: 'mob', mobType: 'TheHoarder', attackType: 'acid_puddle' });
        cat.damageFlash = ACID_DAMAGE_FLASH_FRAMES;
      }
    } else {
      this.catAcidTick = 0;
    }
  }

  private tickCockroachTTLs(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    for (const mob of mobs) {
      if (!(mob instanceof Cockroach) || !mob.isAlive) continue;
      mob.ttl--;
      if (mob.ttl <= 0) {
        mob.hp = 0;
        mob.justDied = true;
      }
    }
    if (mobs.length > COCKROACH_MOB_CLEANUP_THRESHOLD) {
      for (const m of mobs) {
        if (!m.isAlive && m instanceof Cockroach) mobGrid.remove(m);
      }
      // Splice dead cockroaches out in place
      let i = mobs.length;
      while (i--) {
        const m = mobs[i];
        if (!m.isAlive && m instanceof Cockroach) mobs.splice(i, 1);
      }
    }
  }

  renderObjects(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (let i = 0; i < this.states.length; i++) {
      const bossType = this.bossTypes[i] ?? 'the_hoarder';
      this.renderSingleBossRoomObjects(ctx, camX, camY, this.states[i].bounds, bossType);
    }
    this.renderAcidPuddles(ctx, camX, camY);
  }

  renderProjectiles(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.vomitProjectiles.length === 0) return;
    ctx.save();
    for (const proj of this.vomitProjectiles) {
      const screenX = proj.x - camX;
      const screenY = proj.y - camY;
      const angle = Math.atan2(proj.dy, proj.dx);
      const progress = proj.age / PROJECTILE_TTL;

      // Procedural bile orb: bright green blob with inner glow
      ctx.save();
      ctx.translate(screenX, screenY);
      ctx.rotate(angle);
      const r = TILE_SIZE * VOMIT_BLOB_RADIUS_FRACTION;
      const len = r * (VOMIT_ELONGATION_MIN + progress * VOMIT_ELONGATION_RANGE);
      const grad = ctx.createLinearGradient(-len, 0, len, 0);
      grad.addColorStop(0, 'rgba(80,200,20,0.9)');
      grad.addColorStop(BOSS_MIDLINE_FRACTION, 'rgba(180,255,60,0.95)');
      grad.addColorStop(1, 'rgba(40,140,10,0.4)');
      ctx.shadowColor = '#a0ff40';
      ctx.shadowBlur = 10;
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.ellipse(0, 0, len, r * VOMIT_BLOB_HEIGHT_FRACTION, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();

      // Overlay sprite if loaded
      const frame = progressFrameIndex(progress, VOMIT_SPRITE_FRAMES);
      drawSpriteKey(ctx, 'hoarder_vomit_arc', 'arc', frame, screenX, screenY, TILE_SIZE, {
        rotation: angle,
      });
    }
    ctx.restore();
  }

  private renderAcidPuddles(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.acidPuddles.length === 0) return;
    const frame = timeFrameIndex(
      this.puddleClock / PUDDLE_ANIMATION_FPS,
      PUDDLE_FRAME_ROWS,
      PUDDLE_FRAME_COLS,
    );
    const pulse =
      1 - PUDDLE_PULSE_AMP + PUDDLE_PULSE_AMP * Math.sin(this.puddleClock * PUDDLE_PULSE_SPEED);
    ctx.save();
    for (const puddle of this.acidPuddles) {
      const fadeAlpha = puddle.ttl < PUDDLE_FADE_FRAMES ? puddle.ttl / PUDDLE_FADE_FRAMES : 1;
      const screenX = puddle.x - camX;
      const screenY = puddle.y - camY;

      // Procedural acid puddle: glowing green ellipse on the floor
      ctx.save();
      ctx.globalAlpha = fadeAlpha * PUDDLE_BASE_ALPHA * pulse;
      ctx.shadowColor = '#80ff20';
      ctx.shadowBlur = 14;
      ctx.fillStyle = '#4aad10';
      ctx.beginPath();
      ctx.ellipse(
        screenX,
        screenY,
        TILE_SIZE * PUDDLE_OUTER_RX_FRACTION,
        TILE_SIZE * PUDDLE_OUTER_RY_FRACTION,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.globalAlpha = fadeAlpha * PUDDLE_OUTER_ALPHA;
      ctx.fillStyle = '#a0ff40';
      ctx.beginPath();
      ctx.ellipse(
        screenX,
        screenY,
        TILE_SIZE * PUDDLE_INNER_RX_FRACTION,
        TILE_SIZE * PUDDLE_INNER_RY_FRACTION,
        0,
        0,
        Math.PI * 2,
      );
      ctx.fill();
      ctx.restore();

      // Overlay sprite if loaded
      drawSpriteKey(ctx, 'hoarder_vomit_puddle', 'puddle', frame, screenX, screenY, TILE_SIZE, {
        alpha: fadeAlpha,
      });
    }
    ctx.restore();
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
      ctx.globalAlpha = PUDDLE_OUTER_ALPHA;
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
    canvas: HTMLCanvasElement,
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
        canvas,
        boss,
        relevantState,
        meta,
        isEnraged,
        hpFrac,
        mobileTopY,
      );
    }

    const barW = Math.min(BOSS_BAR_MAX_WIDTH, canvas.width * BOSS_BAR_WIDTH_FRACTION);
    const barH = BOSS_BAR_HEIGHT;
    const barX = Math.floor((canvas.width - barW) / 2);
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
      x: canvas.width / 2,
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
      x: canvas.width / 2,
      y: barY + barH - BOSS_HP_TEXT_OFFSET,
      size: 9,
      color: '#e2e8f0',
      align: 'center',
    });

    if (relevantState.defeated) {
      drawText(ctx, 'DEFEATED', {
        x: canvas.width / 2,
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
        x: canvas.width / 2,
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
    canvas: HTMLCanvasElement,
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
    const boxW = canvas.width - (mmSize + MOBILE_BOX_GAP) - BOX_X - MOBILE_BOX_GAP;
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
