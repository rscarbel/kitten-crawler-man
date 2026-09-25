/**
 * ArenaSystem — owns all Ball of Swine arena state: door locking,
 * phase transitions, Tuskling spawning, and arena UI rendering.
 *
 * Subscribes to EventBus events instead of being manually orchestrated.
 */

import type { BossFightHooks } from './bossRooms/BossRoomDressing';
import { clampIntoDrum } from './bossRooms/colosseumSlide';
import { displayHp } from '../core/crawlerFormulas';
import { TILE_SIZE } from '../core/constants';
import { applySpawnDifficulty } from '../core/difficultyProfiles';
import type { EventBus } from '../core/EventBus';
import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import { BallOfSwine } from '../creatures/BallOfSwine';
import { Tuskling } from '../creatures/Tuskling';
import { BOSS_HEALER_ALIVE_NOTICE, type BossRoomSystem } from './BossRoomSystem';
import { createMob } from '../levels/spawner';
import { hasRoomToMove } from '../map/findWalkableTile';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawText } from '../ui/TextBox';
import { drawBox, drawProgressBar } from '../ui/Box';
import { viewportWidth } from '../core/Viewport';
import { ARENA_INTERIOR_RADIUS_TILES, ARENA_REACH } from '../map/arenaGeometry';
import { prewarmTuskling } from '../sprites/tusklingSprite';
import { spawnHardModeBossHealer } from '../levels/fairySpawner';
import { hasLivingBossHealer } from '../creatures/fairies/bossHealerBond';
import { HealingFairy } from '../creatures/fairies/HealingFairy';
import type { FairyConfinement } from '../creatures/fairies/Fairy';
import { settings } from '../core/Settings';
import type { SpatialGrid } from '../core/SpatialGrid';
import { level2 } from '../levels/level2';

/** 30 seconds at 60 fps — mirrors BossRoomSystem.ENTRY_WINDOW_FRAMES. */
const ENTRY_WINDOW_FRAMES = 1800;
/** Number of Tusklings to spawn when Ball of Swine is defeated. */
const TUSKLING_SPAWN_COUNT = 8;
/**
 * Live Tusklings the ball may have shed at once during the fight.
 *
 * Low on purpose. Shedding is meant to add a second thing to watch while dodging a
 * boss that fills a fifth of the arena, not to bury the crawler — an uncapped
 * drip over a long fight ends as a wall of pigs no amount of dodging survives.
 */
export const SHED_MAX_ALIVE = 4;
/** Frames a shed Tuskling spends tumbling before it can act. */
const SHED_DAZE_FRAMES = 40;
/** Tiles from the ball a shed Tuskling is thrown clear. */
const SHED_THROW_TILES = 1.6;
/** Angle between two Tusklings shed on the same frame. */
const SHED_FAN_RADIANS = 0.6;
/** Directions tried around the ball before a shed is abandoned. */
const SHED_PLACEMENT_ANGLES = 12;
const TILE_CENTER_OFFSET = 0.5;
/** Spawn radius in tiles for Tusklings around the arena center. */
const TUSKLING_SPAWN_RADIUS_TILES = 3;
/** Frames Tusklings remain dazed after spawning (10 seconds at 60 fps). */
const TUSKLING_DAZE_FRAMES = 600;
/** Display-bar width cap in pixels. */
const HEALTH_BAR_MAX_W = 360;
/** Display-bar height in pixels. */
const HEALTH_BAR_H = 18;
/** Vertical position of health bar from top of canvas. */
const HEALTH_BAR_Y = 48;
/** Padding around the health bar container box. */
const HEALTH_BAR_PADDING = 6;
/** Tile distance beyond arena radius at which the health bar is hidden. */
const HEALTH_BAR_HIDE_DISTANCE_EXTRA_TILES = 5;
/** Frames per second used for countdown display. */
const DISPLAY_FPS = 60;
/** Pixel inset for boss name label from bar top. */
const LABEL_Y_INSET = 6;
/** Pixel inset for HP text from bar bottom. */
const HP_TEXT_INSET = 4;
/** Y offset for Tuskling counter text below bar area. */
const TUSKLINGS_LABEL_Y_OFFSET = 6;
/** Phase-2 Tusklings label y relative to the bar y anchor. */
const PHASE2_LABEL_Y = 78;
const PHASE2_LABEL_SIZE = 11;
const PHASE2_PENDING_COLOR = '#f87171';
const PHASE2_DONE_COLOR = '#4ade80';
/**
 * How far inside the ring's wall the ball's healer is held, so it hovers over
 * the arena floor rather than over the wall.
 */
const HEALER_WALL_CLEARANCE_TILES = 1;
/** Height of the momentum bar under the health bar. */
const MOMENTUM_BAR_H = 7;
/** Gap between the health bar and the momentum bar — enough to clear its caption. */
const MOMENTUM_BAR_GAP = 9;
const MOMENTUM_BAR_COLOR = '#38bdf8';
const HUD_PANEL_FILL = 'rgba(0,0,0,0.75)';
const HUD_BAR_TRACK = '#0a0a12';
const HUD_STUNNED_COLOR = '#fde68a';
const MOMENTUM_LABEL_INSET = 2;
const MOMENTUM_LABEL_LIFT = 8;
/** Text y anchor adjustment for label rendering. */
const LABEL_TEXT_ADJUST = 9;
/** HP text adjust. */
const HP_TEXT_ADJUST = 7;

/** Point-in-time arena progress, restorable any number of times. */
export interface ArenaCheckpoint {
  arenaLocked: boolean;
  arenaPhase2Active: boolean;
  arenaStairwellUnlocked: boolean;
  arenaLiveTusklings: Tuskling[];
  entryWindowTimer: number;
  humanIsInsider: boolean;
  catIsInsider: boolean;
}

/**
 * What the boss bar says about the ball right now.
 *
 * Named states rather than a bare health bar because each one asks the crawler for
 * something different: run, hit it, or get clear before it launches.
 */
function bossLabel(bos: BallOfSwine): string {
  // `isAlive` stays true through the death burst so the fight cannot end
  // mid-animation, which means the bar is still up while the body comes apart. It
  // should not still be shouting FRENZIED over a corpse at 0 HP.
  if (bos.hp === 0) return 'BALL OF SWINE — DEFEATED';
  if (bos.isStopped) return '★ BALL OF SWINE — VULNERABLE ★';
  if (bos.isFrenzied) return 'BALL OF SWINE — FRENZIED';
  if (bos.isShedding) return 'BALL OF SWINE — COMING APART';
  return 'BALL OF SWINE';
}

/**
 * Tusklings the ball has let loose that are still alive — shed from its body
 * or freed from a cage, one pool with one cap.
 *
 * Counted off the live mob list through a flag on the Tuskling itself, rather
 * than off a list held here. A checkpoint restore deletes every mob spawned
 * after the safe room, and a list would go on holding those references — each
 * one permanently occupying a slot in a cap it can never free, because a mob
 * removed from the scene never stops reporting itself alive.
 */
export function liveShedTusklings(mobs: readonly Mob[]): number {
  return mobs.filter((mob) => mob instanceof Tuskling && mob.shedFromBall && mob.isAlive).length;
}

/**
 * A Tuskling the ball's fight lets loose mid-fight at `tile`, dazed for
 * `dazeFrames`, or null when the spawner will not make one. The caller adds it.
 */
export function createBallTuskling(
  bos: BallOfSwine,
  tile: { x: number; y: number },
  gameMap: GameMap,
  dazeFrames: number,
): Tuskling | null {
  const mob = createMob('tuskling', tile.x, tile.y, gameMap);
  if (!(mob instanceof Tuskling)) return null;
  // Levelled to its parent: a base-stats Tuskling next to a level-15 boss is a
  // distraction the crawler can ignore, which is the opposite of the point.
  mob.applyMobLevel(bos.mobLevel, bos.levelledCurve);
  applySpawnDifficulty(mob);
  mob.shedFromBall = true;
  mob.isBossAdd = true;
  mob.dazeTimer = dazeFrames;
  return mob;
}

export class ArenaSystem implements GameSystem {
  private arenaLocked = false;
  private arenaPhase2Active = false;
  private arenaStairwellUnlocked = false;
  private arenaLiveTusklings: Tuskling[] = [];

  /** Frames remaining in the 30-second window after the fight starts. */
  private entryWindowTimer = 0;
  /**
   * Which players are "insiders" (entered before or during the entry window).
   * Insiders are pushed back if they reach the door during the window.
   */
  private humanIsInsider = false;
  private catIsInsider = false;

  /**
   * The colosseum's dressing, told when the ring seals and when it is won. A
   * death is not an abort: the scene rewinds the dressing with its checkpoint.
   */
  dressing: BossFightHooks | null = null;

  constructor(
    private readonly gameMap: GameMap,
    private readonly bus: EventBus,
    private readonly getMobs: () => Mob[],
    private readonly addMob: (mob: Mob) => void,
    private readonly bossRoom: BossRoomSystem,
  ) {
    this.wireEvents();
  }

  /** Whether the arena has any exteriors on this level. */
  get hasArena(): boolean {
    return this.gameMap.arenaExteriors.length > 0;
  }

  get phase2Active(): boolean {
    return this.arenaPhase2Active;
  }

  get stairwellUnlocked(): boolean {
    return this.arenaStairwellUnlocked;
  }

  /**
   * From the door starting to close on the ball until the last Tuskling falls.
   * The entry window counts: the door is still open, but the fight has begun.
   */
  get isBossFightInProgress(): boolean {
    const tusklingPhaseUnresolved = this.arenaPhase2Active && !this.arenaStairwellUnlocked;
    return this.entryWindowTimer > 0 || this.arenaLocked || tusklingPhaseUnresolved;
  }

  /** Inside the arena's wall ring: the same test that starts the fight. */
  isInsideArena(entity: { x: number; y: number }): boolean {
    if (!this.hasArena) return false;
    const arena = this.gameMap.arenaExteriors[0];
    const centreX = arena.centre.x * TILE_SIZE;
    const centreY = arena.centre.y * TILE_SIZE;
    const innerRadius = ARENA_INTERIOR_RADIUS_TILES * TILE_SIZE;
    return Math.hypot(entity.x - centreX, entity.y - centreY) < innerRadius;
  }

  /**
   * Whether this entity is in the arena while its fight is unfinished — the
   * fight's own clock still running, or the ball or any Tuskling still alive in
   * the ring.
   */
  isEntityInUnresolvedArena(entity: { x: number; y: number }, mobs: readonly Mob[]): boolean {
    if (!this.isInsideArena(entity)) return false;
    if (this.isBossFightInProgress) return true;
    return mobs.some((mob) => mob.isAlive && mob.isHostile && this.isInsideArena(mob));
  }

  /**
   * Unlocks the arena door and clears the entry-window/insider state — used on
   * a checkpoint respawn so the door doesn't stay shut (or slam shut on its
   * own timer) behind a player who is no longer inside. This has to run
   * unconditionally, including during phase 2: the door stays locked for the
   * whole Tuskling fight (`update()` only unlocks it once every Tuskling is
   * dead), so dying mid-phase-2 with `arenaLocked` still true is the exact
   * soft-lock this method exists to prevent. Phase-2 progress itself (which
   * Tusklings are dead) and the boss-defeated unlock are untouched — walking
   * back in re-locks the door only if the boss is still alive.
   */
  resetForCheckpoint(): void {
    this.entryWindowTimer = 0;
    this.humanIsInsider = false;
    this.catIsInsider = false;
    if (this.arenaLocked) {
      this.arenaLocked = false;
      this.gameMap.unlockArenaDoor();
    }
  }

  /**
   * Snapshots arena progress so a death rewinds the Ball of Swine fight and the
   * Tuskling phase that follows it.
   *
   * The Tuskling list is copied but its elements are not: those mobs stay in the
   * scene's mob array for its whole life, so the reference remains the same
   * creature whose `isAlive` the phase-2 check reads.
   *
   * The copy happens again in `restoreCheckpoint`, because one snapshot can be
   * restored many times and handing the stored array to the live field would let
   * the first restore mutate the snapshot.
   */
  captureCheckpoint(): ArenaCheckpoint {
    return {
      arenaLocked: this.arenaLocked,
      arenaPhase2Active: this.arenaPhase2Active,
      arenaStairwellUnlocked: this.arenaStairwellUnlocked,
      arenaLiveTusklings: [...this.arenaLiveTusklings],
      entryWindowTimer: this.entryWindowTimer,
      humanIsInsider: this.humanIsInsider,
      catIsInsider: this.catIsInsider,
    };
  }

  restoreCheckpoint(snapshot: ArenaCheckpoint): void {
    this.arenaPhase2Active = snapshot.arenaPhase2Active;
    this.arenaLiveTusklings = [...snapshot.arenaLiveTusklings];
    this.entryWindowTimer = snapshot.entryWindowTimer;
    this.humanIsInsider = snapshot.humanIsInsider;
    this.catIsInsider = snapshot.catIsInsider;

    // The door tiles on the map and this flag are two halves of one fact, so a
    // restore that moved the flag has to move the map with it or the player is
    // sealed in (or walks out of) an arena whose state disagrees with the door.
    if (snapshot.arenaLocked !== this.arenaLocked) {
      this.arenaLocked = snapshot.arenaLocked;
      if (snapshot.arenaLocked) this.gameMap.lockArenaDoor();
      else this.gameMap.unlockArenaDoor();
    }

    // Never re-locked: `unlockArenaStairwell()` has no inverse, and a rewind
    // restores the map's side separately. A save loaded into a fresh map has no
    // map side to restore, so the unlock is replayed here.
    if (snapshot.arenaStairwellUnlocked && !this.arenaStairwellUnlocked) {
      this.gameMap.unlockArenaStairwell();
    }
    this.arenaStairwellUnlocked = snapshot.arenaStairwellUnlocked;
  }

  private wireEvents(): void {
    // Ball of Swine defeated → spawn 8 dazed Tusklings (phase 2)
    this.bus.on('bossDefeated', (e) => {
      if (e.bossType !== 'ball_of_swine' || this.arenaPhase2Active) return;
      this.dressing?.onBossDefeated();

      // hp hits 0 the instant the killing blow lands, but this event — and the
      // Tusklings it spawns below — waits out the whole burst animation first.
      // A door opened at hp === 0 would stand open through that hold, before a
      // single Tuskling existed to be confined by it, and an escaping party
      // would be past it by the time they spawned. So the entry-window state is
      // reset here, at the moment the Tusklings arrive, and the door is locked
      // (never unlocked) here — it stays shut for the whole Tuskling fight, as a
      // checkpoint respawn expects, and the phase-2 all-dead block in `update`
      // is the only place it opens again.
      this.entryWindowTimer = 0;
      this.humanIsInsider = false;
      this.catIsInsider = false;
      if (!this.arenaLocked) {
        this.arenaLocked = true;
        this.gameMap.lockArenaDoor();
      }

      this.arenaPhase2Active = true;
      this.arenaLiveTusklings = [];

      const arena = this.gameMap.arenaExteriors[0];
      const acx = arena.centre.x;
      const acy = arena.centre.y;

      for (let i = 0; i < TUSKLING_SPAWN_COUNT; i++) {
        const angle = (i / TUSKLING_SPAWN_COUNT) * Math.PI * 2;
        const r = TUSKLING_SPAWN_RADIUS_TILES;
        const tx = acx + Math.round(Math.cos(angle) * r);
        const ty = acy + Math.round(Math.sin(angle) * r);
        const mob = createMob('tuskling', tx, ty, this.gameMap);
        if (mob instanceof Tuskling) {
          mob.isBossAdd = true;
          mob.dazeTimer = TUSKLING_DAZE_FRAMES;
          this.addMob(mob);
          this.arenaLiveTusklings.push(mob);
        }
      }
    });
  }

  update(ctx: SystemContext): void {
    const { human, cat } = ctx;
    if (!this.hasArena) return;

    const arena = this.gameMap.arenaExteriors[0];
    const mobs = this.getMobs();
    const bos = mobs.find((m) => m instanceof BallOfSwine);

    if (bos) {
      this.releaseShedTusklings(bos);

      const cx = arena.centre.x * TILE_SIZE;
      const cy = arena.centre.y * TILE_SIZE;
      const innerRadius = ARENA_INTERIOR_RADIUS_TILES * TILE_SIZE;
      this.resolveStench(bos, ctx, cx, cy, innerRadius);

      const humanInside = this.isInsideArena(human);
      const catInside = this.isInsideArena(cat);

      // Use hp > 0 (not isAlive) because BallOfSwine overrides isAlive to return
      // true during its burst animation even after hp hits 0, which would
      // re-trigger the fight-start logic after the Tuskling phase unlocks it.
      if (
        !this.arenaLocked &&
        this.entryWindowTimer === 0 &&
        bos.hp > 0 &&
        !this.arenaStairwellUnlocked &&
        (humanInside || catInside)
      ) {
        this.entryWindowTimer = ENTRY_WINDOW_FRAMES;
        this.humanIsInsider = humanInside;
        this.catIsInsider = catInside;
        bos.fightStarted = true;
        this.bossRoom.newlyLockedBossType = 'ball_of_swine';
        this.dressing?.onSeal();
        // Sealing the door schedules the whole fight, Tusklings included: the
        // ball sheds them once it is hurt and releases eight more when it comes
        // apart, and no other creature is coming through that door.
        prewarmTuskling();
      }

      // Tick the entry window: keep the door open so the second player can enter,
      // but clamp insiders so they cannot leave through the door.
      if (this.entryWindowTimer > 0 && !this.arenaLocked) {
        this.entryWindowTimer--;

        // Any player who enters during the window becomes a locked-in insider.
        if (humanInside) this.humanIsInsider = true;
        if (catInside) this.catIsInsider = true;

        // Prevent insiders from slipping back out through the door gap.
        if (this.humanIsInsider) this.pushInsiderBackFromDoor(human, arena.doorTile);
        if (this.catIsInsider) this.pushInsiderBackFromDoor(cat, arena.doorTile);

        if (this.entryWindowTimer === 0) {
          this.arenaLocked = true;
          this.gameMap.lockArenaDoor();
          this.spawnSwineHealer(bos, mobs);
        }
      }
    }

    this.confineSwineHealers(mobs, ctx.roster.grid);
    // Both crawlers, whether or not a fight is on: the drum is round either way,
    // and the clamp only ever holds a body standing on the drum's own floor.
    clampIntoDrum(human, arena.centre, this.gameMap);
    clampIntoDrum(cat, arena.centre, this.gameMap);

    // The ball's hard-mode healer is part of the fight it was spawned for, so
    // the stairwell waits on it as it waits on the last Tuskling.
    if (
      this.arenaPhase2Active &&
      !this.arenaStairwellUnlocked &&
      this.arenaLiveTusklings.length > 0 &&
      this.arenaLiveTusklings.every((t) => !t.isAlive) &&
      !this.hasLivingSwineHealer(mobs)
    ) {
      this.arenaStairwellUnlocked = true;
      this.gameMap.unlockArenaStairwell();
      if (this.arenaLocked) {
        this.arenaLocked = false;
        this.gameMap.unlockArenaDoor();
      }
    }
  }

  protected hasLivingSwineHealer(mobs: readonly Mob[]): boolean {
    return hasLivingBossHealer(mobs, (boss) => boss instanceof BallOfSwine);
  }

  /**
   * The ball's hard-mode healer, placed inside the ring once the door has shut.
   * Not before: through an open door the ball can see out onto the concourse,
   * and a healer placed there would stand outside the fight whose stairwell
   * waits on it. One at a time, because a respawn that unlocks the door starts
   * the entry window over while the first healer may still be flying.
   */
  protected spawnSwineHealer(bos: BallOfSwine, mobs: readonly Mob[]): void {
    if (this.hasLivingSwineHealer(mobs)) return;
    spawnHardModeBossHealer(
      bos,
      this.gameMap,
      this.addMob,
      level2.floorNumber,
      settings.difficulty,
      (tileX, tileY) => this.isInsideArena({ x: tileX * TILE_SIZE, y: tileY * TILE_SIZE }),
    );
  }

  /**
   * Holds any healer fairy inside the ring. It flies, and the stairwell waits
   * on it, so a healer that drifted out over the wall — or through the door in
   * the moments it stands open — would seal the party in with nothing left to
   * kill. Positional rather than bond-based: a healer belongs to the arena
   * because it is standing in it, not because it still holds a bond to a
   * living Ball of Swine — one stripped of its bond, or fleeing after the
   * boss is dead, is held exactly the same as one still healing the fight.
   * The arena's own bounds are a circle (memory note: a boss arena is not a
   * rectangle), so this pulls a healer back along the radius rather than
   * clamping to a box.
   *
   * Gated by {@link ARENA_REACH} rather than applied to every healer fairy on
   * the floor: the pull-back only ever fires past the tighter `limitPx`, but
   * without an outer bound a healer fairy going about its business rooms away
   * would be swept toward the arena the instant it drifted from `limitPx` to
   * infinity being "farther than the limit". `ARENA_REACH` already covers the
   * whole structure plus its reserve margin, generous enough that a healer
   * fleeing out through the door is always caught within the same frame it
   * crosses `limitPx` — it can never travel far enough to approach it.
   */
  protected confineSwineHealers(mobs: readonly Mob[], grid: SpatialGrid<Mob>): void {
    const arena = this.gameMap.arenaExteriors[0];
    const centreX = arena.centre.x * TILE_SIZE;
    const centreY = arena.centre.y * TILE_SIZE;
    const limitPx = (ARENA_INTERIOR_RADIUS_TILES - HEALER_WALL_CLEARANCE_TILES) * TILE_SIZE;
    const catchPx = ARENA_REACH * TILE_SIZE;
    const confinement: FairyConfinement = {
      containsPoint: (x, y) => Math.hypot(x - centreX, y - centreY) <= limitPx,
    };
    for (const mob of mobs) {
      if (!mob.isAlive || !(mob instanceof HealingFairy) || !mob.respectsConfinement) continue;
      const offsetX = mob.x - centreX;
      const offsetY = mob.y - centreY;
      const distancePx = Math.hypot(offsetX, offsetY);
      if (distancePx > catchPx) {
        mob.clearConfinement();
        continue;
      }
      mob.confineTo(confinement);
      if (distancePx <= limitPx) continue;
      const oldX = mob.x;
      const oldY = mob.y;
      const pullBack = limitPx / distancePx;
      mob.x = centreX + offsetX * pullBack;
      mob.y = centreY + offsetY * pullBack;
      grid.move(mob, oldX, oldY);
    }
  }

  /**
   * Spawns whatever the ball has torn loose since the last frame.
   *
   * The boss queues a count and this drains it, rather than the boss spawning them
   * itself: a mob has no route to the scene's mob list, and — the rule this
   * codebase repeats at every projectile site — anything owned by a mob is deleted
   * the moment that mob dies, mid-air and mid-fight.
   */
  private releaseShedTusklings(bos: BallOfSwine): void {
    if (bos.pendingSheds <= 0) return;
    // Cleared whether or not anything is spawned. Left set while the cap is full,
    // the queue would bank a shed per interval for the whole fight and then release
    // all of them the instant one died.
    const requested = bos.pendingSheds;
    bos.pendingSheds = 0;

    const alive = liveShedTusklings(this.getMobs());
    const spawning = Math.min(requested, SHED_MAX_ALIVE - alive);

    for (let i = 0; i < spawning; i++) {
      // Thrown clear on the side away from the ball's own heading, so a Tuskling is
      // never dropped under the body that is about to roll over it.
      const behind = Math.atan2(-bos.facingY, -bos.facingX) + (i - spawning / 2) * SHED_FAN_RADIANS;
      const tile = this.shedTile(behind, bos);
      if (tile === null) continue;
      const mob = createBallTuskling(bos, tile, this.gameMap, SHED_DAZE_FRAMES);
      if (mob !== null) this.addMob(mob);
    }
  }

  /**
   * Where a shed Tuskling can actually be put down, or null if nowhere near will do.
   *
   * The preferred spot is behind the ball, but "behind" is wherever it is *not*
   * heading — and the frame after a carom that is straight back out into the arena
   * wall. The ball's own centre reaches within a tile and a half of the ironwork, so
   * the throw lands inside it. Hence the ring search, and hence `hasRoomToMove`
   * rather than `isWalkable`: this codebase's own rule is that a one-tile gap between
   * solid things passes a walkability test and then traps whatever spawns in it.
   */
  private shedTile(preferredAngle: number, bos: BallOfSwine): { x: number; y: number } | null {
    for (let attempt = 0; attempt < SHED_PLACEMENT_ANGLES; attempt++) {
      // The preferred heading first, then the rest of the circle in even steps, so a
      // ball pinned against the wall still finds the open side.
      const angle = preferredAngle + (attempt / SHED_PLACEMENT_ANGLES) * Math.PI * 2;
      // Floored about the ball's tile *centre*: `bos.x` is a tile top-left, so
      // rounding it directly biases every throw half a tile up and to the left.
      const tileX = Math.floor(
        bos.x / TILE_SIZE + TILE_CENTER_OFFSET + Math.cos(angle) * SHED_THROW_TILES,
      );
      const tileY = Math.floor(
        bos.y / TILE_SIZE + TILE_CENTER_OFFSET + Math.sin(angle) * SHED_THROW_TILES,
      );
      if (hasRoomToMove(this.gameMap, tileX, tileY)) return { x: tileX, y: tileY };
    }
    return null;
  }

  /**
   * Resolves a stench burst the frenzied ball has vented.
   *
   * Only the *effect* lives here — the ring the crawler sees is drawn by the boss,
   * which is where the timer for it belongs: the burst is centred on a body that is
   * stationary for the whole slam, so the picture needs no state of its own.
   */
  private resolveStench(
    bos: BallOfSwine,
    ctx: SystemContext,
    arenaCentreX: number,
    arenaCentreY: number,
    interiorRadiusPx: number,
  ): void {
    const burst = bos.pendingStench;
    if (burst === null) return;
    bos.pendingStench = null;

    for (const target of [ctx.human, ctx.cat]) {
      if (!target.isAlive) continue;
      const cx = target.x + TILE_SIZE * TILE_CENTER_OFFSET;
      const cy = target.y + TILE_SIZE * TILE_CENTER_OFFSET;
      if (Math.hypot(cx - burst.x, cy - burst.y) > burst.radius) continue;
      // The burst radius alone reaches past the ring at the wall clamp: a bare
      // distance check would hit a route walker through two tiles of iron. The
      // wall only blocks what is actually behind it, so the target's own
      // distance from the arena centre is the second, load-bearing half of this
      // check.
      if (Math.hypot(cx - arenaCentreX, cy - arenaCentreY) > interiorRadiusPx) continue;
      bos.applyStenchTo(target);
    }
  }

  /**
   * Prevents a locked-in player from leaving through the door gap while the
   * entry window is still open. Snaps them two tiles north of the door, which
   * is safely inside the arena.
   */
  private pushInsiderBackFromDoor(
    player: { x: number; y: number },
    doorTile: { x: number; y: number },
  ): void {
    const tileCenter = 0.5;
    const tx = Math.floor((player.x + TILE_SIZE * tileCenter) / TILE_SIZE);
    const ty = Math.floor((player.y + TILE_SIZE * tileCenter) / TILE_SIZE);
    // One row deeper than the door tiles the map blocks: on a progression floor
    // the row south of the door is the antechamber's own floor, which is
    // deliberately left walkable, so a player who has already joined the fight
    // has to be pushed off it rather than stopped by the map.
    const onDoor =
      tx >= doorTile.x - 1 && tx <= doorTile.x && ty >= doorTile.y - 1 && ty <= doorTile.y + 1;
    if (!onDoor) return;
    player.y = (doorTile.y - 2) * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, activePlayer: { x: number; y: number }): void {
    if (!this.hasArena) return;

    const mobs = this.getMobs();
    const bos = mobs.find((m) => m instanceof BallOfSwine);

    if (bos?.isAlive) {
      const arena = this.gameMap.arenaExteriors[0];
      const distToArena = Math.hypot(
        activePlayer.x - arena.centre.x * TILE_SIZE,
        activePlayer.y - arena.centre.y * TILE_SIZE,
      );
      if (distToArena > (arena.radius + HEALTH_BAR_HIDE_DISTANCE_EXTRA_TILES) * TILE_SIZE) return;

      const meta = { displayName: 'BALL OF SWINE', color: '#f87171' };
      const BAR_WIDTH_FRACTION = 0.5;
      const barW = Math.min(HEALTH_BAR_MAX_W, viewportWidth() * BAR_WIDTH_FRACTION);
      const barH = HEALTH_BAR_H;
      const barX = Math.floor((viewportWidth() - barW) / 2);
      const barY = HEALTH_BAR_Y;
      const hpFrac = Math.max(0, bos.hp / bos.maxHp);

      const momentumY = barY + barH + MOMENTUM_BAR_GAP;
      const barColor = bos.isStopped ? HUD_STUNNED_COLOR : meta.color;
      const labelY = barY - LABEL_Y_INSET - LABEL_TEXT_ADJUST;
      // The panel is sized from the *label* down, not from the health bar down: the
      // name sits above the bar, and a panel that started at the bar left it printed
      // on the world outside the box that is meant to hold it.
      const panelTop = labelY - HEALTH_BAR_PADDING;

      ctx.save();
      drawBox(ctx, {
        x: barX - HEALTH_BAR_PADDING,
        y: panelTop,
        width: barW + HEALTH_BAR_PADDING * 2,
        height: momentumY + MOMENTUM_BAR_H + HEALTH_BAR_PADDING - panelTop,
        fill: HUD_PANEL_FILL,
        border: meta.color,
        borderWidth: 1,
        radius: 0,
      });

      drawText(ctx, bossLabel(bos), {
        x: viewportWidth() / 2,
        y: labelY,
        size: 11,
        bold: true,
        color: barColor,
        align: 'center',
      });

      drawProgressBar(ctx, {
        x: barX,
        y: barY,
        width: barW,
        height: barH,
        value: hpFrac,
        fill: barColor,
        background: HUD_BAR_TRACK,
        border: meta.color,
        radius: 0,
      });

      drawText(ctx, `${displayHp(bos.hp)} / ${bos.maxHp}`, {
        x: viewportWidth() / 2,
        y: barY + barH - HP_TEXT_INSET - HP_TEXT_ADJUST,
        size: 9,
        color: '#e2e8f0',
        align: 'center',
      });

      // The momentum read-out. The fight is *about* momentum, so the crawler has to
      // be able to see it going down — without this, baiting a square slam and
      // grinding it on barriers look identical until the moment it collapses.
      drawProgressBar(ctx, {
        x: barX,
        y: momentumY,
        width: barW,
        height: MOMENTUM_BAR_H,
        value: bos.momentumFraction,
        fill: MOMENTUM_BAR_COLOR,
        background: HUD_BAR_TRACK,
        border: meta.color,
        radius: 0,
      });
      drawText(ctx, 'MOMENTUM', {
        x: barX + MOMENTUM_LABEL_INSET,
        y: momentumY - MOMENTUM_LABEL_LIFT,
        size: 8,
        color: '#94a3b8',
      });

      if (this.entryWindowTimer > 0) {
        const seconds = Math.ceil(this.entryWindowTimer / DISPLAY_FPS);
        drawText(ctx, `Entry closes in ${seconds}s`, {
          x: viewportWidth() / 2,
          y: momentumY + MOMENTUM_BAR_H + TUSKLINGS_LABEL_Y_OFFSET,
          size: 11,
          bold: true,
          color: '#fbbf24',
          align: 'center',
        });
      }

      ctx.restore();
    }

    if (this.arenaPhase2Active && !this.arenaStairwellUnlocked) {
      const alive = this.arenaLiveTusklings.filter((t) => t.isAlive).length;
      const healerAlive = this.hasLivingSwineHealer(mobs);
      const notice =
        alive > 0
          ? { text: `Tusklings remaining: ${alive}`, color: PHASE2_PENDING_COLOR }
          : healerAlive
            ? BOSS_HEALER_ALIVE_NOTICE
            : { text: 'All Tusklings defeated! Stairwell unlocked.', color: PHASE2_DONE_COLOR };
      drawText(ctx, notice.text, {
        x: viewportWidth() / 2,
        y: PHASE2_LABEL_Y - LABEL_TEXT_ADJUST,
        size: PHASE2_LABEL_SIZE,
        bold: true,
        color: notice.color,
        align: 'center',
      });
    }
  }
}
