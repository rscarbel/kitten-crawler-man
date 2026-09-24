import { TILE_SIZE } from '../../core/constants';
import { isRecord } from '../../core/guards';
import { getSpriteDef } from '../../core/SpriteLoader';
import { drawSpriteKey } from '../../core/SpriteRenderer';
import { viewportHeight, viewportWidth } from '../../core/Viewport';
import { BallOfSwine } from '../../creatures/BallOfSwine';
import type { Mob } from '../../creatures/Mob';
import type { ArenaExterior } from '../../map/DungeonGenerator';
import { hasRoomToMove } from '../../map/findWalkableTile';
import type { GameMap } from '../../map/GameMap';
import { SPRITE_BUILDING_OVERLAY_FPS } from '../../map/tiles/overlayAnimation';
import {
  COLOSSEUM_DOOR_OPENING,
  COLOSSEUM_FOOTING_RADIUS_TILES,
  colosseumCapInnerRadius,
  colosseumLayoutAt,
  type ColosseumLayout,
} from '../../map/tiles/bossRooms/colosseumGeometry';
import { hashLattice } from '../../map/tilegen/noise';
import { ARENA_MUD } from '../../map/tileTypes';
import type { SoundId } from '../../audio/sounds';
import { BOS_BODY_RADIUS_TILES } from '../../sprites/ballOfSwineSheet';
import {
  BANNER_FRAMES,
  CAGE_BURST_FRAMES,
  CAGE_IDLE_FRAMES,
  CAGE_RATTLE_FRAMES,
  CHEER_FRAMES,
  MUD_SPLATTER_VARIANTS,
  PORTCULLIS_FRAMES,
} from '../../sprites/art/colosseumArt';
import { CHEER_ROWS } from '../../sprites/sheets/bossRooms/colosseumSheets';
import { createBallTuskling, liveShedTusklings, SHED_MAX_ALIVE } from '../ArenaSystem';
import type { SystemContext } from '../GameSystem';
import type { CheckpointedDressing, DressingRenderable } from './BossRoomDressing';
import { stampProps, type TilePoint } from './bossRoomLayout';
import { InertBossRoomDressing } from './InertBossRoomDressing';

const FRAMES_PER_SECOND = 60;
const HALF = 0.5;
const FULL_TURN = Math.PI * 2;
const HALF_TILE = TILE_SIZE / 2;

// ── Mud wallows ─────────────────────────────────────────────────────────────

/**
 * The colosseum's mud wallows, in tiles from the arena's centre tile.
 *
 * Authored rather than seeded, so every floor's ring has the same ground under
 * the same fight. At mid-radius and well off the south door's approach: the
 * chords the ball slams along run through the middle and out to the wall, and a
 * crawler slowed in the middle of one is where the fight would stop being
 * fair. Off the gym pickups too, so a bench is never sunk in a wallow.
 */
export const COLOSSEUM_MUD_WALLOWS: ReadonlyArray<readonly TilePoint[]> = [
  // West-north-west.
  [
    { x: -8, y: -3 },
    { x: -7, y: -3 },
    { x: -8, y: -2 },
    { x: -7, y: -2 },
    { x: -6, y: -2 },
    { x: -7, y: -1 },
  ],
  // North-north-east.
  [
    { x: 1, y: -8 },
    { x: 2, y: -8 },
    { x: 1, y: -7 },
    { x: 2, y: -7 },
    { x: 3, y: -7 },
    { x: 2, y: -6 },
    { x: 3, y: -6 },
  ],
  // East-south-east.
  [
    { x: 7, y: 1 },
    { x: 8, y: 1 },
    { x: 6, y: 2 },
    { x: 7, y: 2 },
    { x: 8, y: 2 },
    { x: 7, y: 3 },
  ],
  // West-south-west.
  [
    { x: -9, y: 3 },
    { x: -8, y: 3 },
    { x: -9, y: 4 },
    { x: -8, y: 4 },
    { x: -7, y: 4 },
  ],
];

// ── Cages ───────────────────────────────────────────────────────────────────

/** Frames a cage rattles, bars shaking and pig panicking, before its door gives. */
export const CAGE_RATTLE_TOTAL_FRAMES = 45;
/** Most cages the ball may burst in one fight. */
export const CAGE_RELEASE_MAX = 6;
/** How near a slam's point of impact a cage must be for the blow to shake it loose, in tiles. */
export const CAGE_SLAM_REACH_TILES = 2;
/** Frames the burst plays before the cage settles open. */
const CAGE_BURST_TOTAL_FRAMES = 24;
/** Frames a freed Tuskling spends shaking itself off before it charges. */
const CAGE_TUSKLING_DAZE_FRAMES = 30;
/** Where a freed Tuskling lands: this far in from the iron's foot, along the cage's bearing. */
const CAGE_RELEASE_INSET_TILES = 0.8;
/** Further in, a tile at a time, when that spot has no room to move. */
const CAGE_RELEASE_SEARCH_TILES = 4;
/** Game frames per rattle frame: the rattle loops, fast. */
const CAGE_RATTLE_TICKS = 4;
/** Game frames per idle frame: a pig shuffling, slow and out of step with its neighbours. */
const CAGE_IDLE_TICKS = 22;

type CagePhase = 'idle' | 'rattling' | 'bursting' | 'open';

interface CageState {
  readonly index: number;
  readonly angle: number;
  /** World pixels of the cage tile's centre. */
  readonly worldX: number;
  readonly worldY: number;
  phase: CagePhase;
  timer: number;
}

// ── Portcullis ──────────────────────────────────────────────────────────────

/** Game frames per portcullis frame; six of them make a quick, heavy drop. */
const PORTCULLIS_TICKS = 4;
const PORTCULLIS_LAST_FRAME = PORTCULLIS_FRAMES - 1;
/** Frames the dust from the gate's landing hangs in the air. */
const DUST_TOTAL_FRAMES = 32;
const DUST_PUFFS = 7;
const DUST_SPREAD_TILES = 0.9;
const DUST_RADIUS_TILES = 0.22;
const DUST_ALPHA = 0.5;
const DUST_COLOR = '#a58c6a';
/** The frame sits in front of anything inside the arena that shares its row. */
const PORTCULLIS_SORT_NUDGE_PX = 1;
const PORTCULLIS_CULL_MARGIN_TILES = 3;

// ── The crowd ───────────────────────────────────────────────────────────────

/** Radians per frame the wave's front runs round the stands, each way from where it started. */
const WAVE_SPEED_RADIANS = 0.05;
/** How wide a band of the crowd is on its feet behind the front. */
const WAVE_WIDTH_RADIANS = 0.9;
/** Most spectators drawn on their feet at once. */
export const WAVE_MAX_RAISED = 40;
/** Game frames per arm-raise frame; the wave plays on the overlay clock. */
const CHEER_TICKS = FRAMES_PER_SECOND / SPRITE_BUILDING_OVERLAY_FPS;

// ── Banners ─────────────────────────────────────────────────────────────────

/**
 * Bearings the banners hang at: in pairs either side of due north, on the far
 * wall's face, which is the only stretch of it the viewer sees.
 */
const DUE_NORTH = -Math.PI * HALF;
const BANNER_NEAR_SPREAD_RADIANS = 0.5;
const BANNER_FAR_SPREAD_RADIANS = 0.88;
const BANNER_BEARINGS: readonly number[] = [
  DUE_NORTH - BANNER_FAR_SPREAD_RADIANS,
  DUE_NORTH - BANNER_NEAR_SPREAD_RADIANS,
  DUE_NORTH + BANNER_NEAR_SPREAD_RADIANS,
  DUE_NORTH + BANNER_FAR_SPREAD_RADIANS,
];
const BANNER_TICKS = 10;
/** How far below the wall's top edge a banner's rod is fixed. */
const BANNER_HANG_TILES = 0.08;

// ── Decals ──────────────────────────────────────────────────────────────────

/** Most mud splatters on the sand at once, and how long one lasts. */
export const MUD_SPLATTER_MAX = 24;
const MUD_SPLATTER_LIFE_FRAMES = 900;
const MUD_SPLATTER_FADE_FRAMES = 240;
/** Frames between splatters thrown while the ball rolls through a wallow. */
const MUD_SPLATTER_INTERVAL = 6;
const MUD_SPLATTER_SCATTER_TILES = 0.9;
/** Most blood decals the trample leaves on the sand, and how long one lasts. */
export const BLOOD_DECAL_MAX = 12;
const BLOOD_DECAL_LIFE_FRAMES = 3600;
const BLOOD_DECAL_FADE_FRAMES = 600;
const BLOOD_DECAL_ALPHA = 0.8;
const BLOOD_DECAL_MIN_RADIUS_PX = 7;
const BLOOD_DECAL_RADIUS_RANGE_PX = 6;
const BLOOD_DECAL_ASPECT = 0.65;
const BLOOD_VARIANTS = 6;
/** Decals keep this far inside the sand's edge, so nothing is ever painted on iron. */
const DECAL_WALL_CLEARANCE_TILES = 0.3;
/** Offscreen margin inside which a decal or sprite is still drawn. */
const CULL_MARGIN_PX = TILE_SIZE * 2;

const DECAL_SEED = 811;

interface GroundDecal {
  x: number;
  y: number;
  variant: number;
  life: number;
}

/** What the Iron Colosseum's dressing has to put back after a death. */
export interface ColosseumDressingCheckpoint {
  /** Indices of the cages whose doors have burst, in bearing order. */
  readonly openCages: readonly number[];
  readonly portcullisDown: boolean;
  readonly mudSplatter: readonly Readonly<GroundDecal>[];
  readonly bloodDecals: readonly Readonly<GroundDecal>[];
}

/**
 * Ball of Swine's Iron Colosseum: its portcullis, its caged pigs, its crowd,
 * its mud, and the stains the fight leaves.
 *
 * Dressing only. The fight itself — the door lock, the ball, the Tuskling phase
 * — stays with `ArenaSystem`. This watches the door and the ball rather than
 * being told about them, so it can never disagree with either.
 */
export class ColosseumDressingSystem
  extends InertBossRoomDressing
  implements CheckpointedDressing<ColosseumDressingCheckpoint>
{
  private readonly layout: ColosseumLayout | null;
  private readonly centreX: number;
  private readonly centreY: number;
  private readonly cages: CageState[];
  private readonly mudCentroids: ReadonlyArray<{ x: number; y: number }>;

  private portcullisTick = 0;
  private dustTimer = 0;
  private waveOrigin = 0;
  private waveAge = -1;
  private clock = 0;
  private mudSplatter: GroundDecal[] = [];
  private bloodDecals: GroundDecal[] = [];
  private decalsLaid = 0;
  private splatterCooldown = 0;
  private seenSlams = 0;
  private seenTramples = 0;
  private seenBallHp = 0;
  /** After a rewind the ball's counters are wherever they are; the next update only reads them. */
  private resyncWithBall = true;
  private pendingCue: SoundId | null = null;
  private preSeal: ColosseumDressingCheckpoint | null = null;
  private readonly portcullisRenderable: DressingRenderable;
  private readonly renderables: DressingRenderable[] = [];

  constructor(
    readonly gameMap: GameMap,
    readonly arena: ArenaExterior,
  ) {
    super();
    const { centre } = arena;
    this.centreX = centre.x * TILE_SIZE + HALF_TILE;
    this.centreY = centre.y * TILE_SIZE + HALF_TILE;
    stampProps(
      gameMap,
      COLOSSEUM_MUD_WALLOWS.flat().map((offset) => ({
        x: centre.x + offset.x,
        y: centre.y + offset.y,
        type: ARENA_MUD,
      })),
    );
    this.mudCentroids = COLOSSEUM_MUD_WALLOWS.map((patch) => ({
      x: (centre.x + patch.reduce((sum, tile) => sum + tile.x, 0) / patch.length) * TILE_SIZE,
      y: (centre.y + patch.reduce((sum, tile) => sum + tile.y, 0) / patch.length) * TILE_SIZE,
    }));
    this.layout = colosseumLayoutAt(gameMap.structure, centre.x, centre.y);
    this.cages = (this.layout?.cages ?? []).map((cage, index) => ({
      index,
      angle: cage.angle,
      worldX: cage.tileX * TILE_SIZE + HALF_TILE,
      worldY: cage.tileY * TILE_SIZE + HALF_TILE,
      phase: 'idle',
      timer: 0,
    }));
    const door = COLOSSEUM_DOOR_OPENING;
    // The gate stands across the passage's outer end, facing the antechamber.
    const doorFootPx = this.centreY + door.bottom * TILE_SIZE;
    const doorLeftPx = this.centreX + door.left * TILE_SIZE;
    this.portcullisRenderable = {
      x: doorLeftPx,
      y: doorFootPx - TILE_SIZE + PORTCULLIS_SORT_NUDGE_PX,
      cullMarginTiles: PORTCULLIS_CULL_MARGIN_TILES,
      render: (ctx, camX, camY, tileSize) => {
        drawSpriteKey(
          ctx,
          'colosseum_portcullis',
          'drop',
          this.portcullisFrame,
          doorLeftPx - camX,
          doorFootPx - camY,
          tileSize,
        );
      },
    };
  }

  /** A sound the room wants played this frame, taken once. */
  takeSoundCue(): SoundId | null {
    const cue = this.pendingCue;
    this.pendingCue = null;
    return cue;
  }

  /** How many cages have burst or are on their way to it, this fight. */
  get cagesReleased(): number {
    return this.cages.filter((cage) => cage.phase !== 'idle').length;
  }

  /** The cages, in bearing order, for gates and the render harness. */
  get cagePhases(): readonly CagePhase[] {
    return this.cages.map((cage) => cage.phase);
  }

  get portcullisFrame(): number {
    return Math.min(PORTCULLIS_LAST_FRAME, Math.floor(this.portcullisTick / PORTCULLIS_TICKS));
  }

  get splatterCount(): number {
    return this.mudSplatter.length;
  }

  get bloodCount(): number {
    return this.bloodDecals.length;
  }

  /** Spectators on their feet this frame. */
  get raisedCount(): number {
    return this.raisedSeats().length;
  }

  override update(ctx: SystemContext): void {
    this.clock++;
    this.updatePortcullis();
    if (this.dustTimer > 0) this.dustTimer--;
    if (this.waveAge >= 0) {
      this.waveAge++;
      if (this.waveAge * WAVE_SPEED_RADIANS > Math.PI + WAVE_WIDTH_RADIANS) this.waveAge = -1;
    }
    const ball = findBall(ctx.roster.mobs);
    if (ball !== null) this.watchBall(ball, ctx);
    this.advanceCages(ball, ctx);
    ageDecals(this.mudSplatter);
    ageDecals(this.bloodDecals);
  }

  private updatePortcullis(): void {
    const downTick = PORTCULLIS_LAST_FRAME * PORTCULLIS_TICKS;
    if (this.gameMap.arenaDoorLocked) {
      if (this.portcullisTick === 0) this.pendingCue = 'gate_opening';
      if (this.portcullisTick < downTick) {
        this.portcullisTick++;
        if (this.portcullisTick === downTick) {
          this.dustTimer = DUST_TOTAL_FRAMES;
          this.pendingCue = 'massive_metal_hit';
        }
      }
    } else if (this.portcullisTick > 0) {
      if (this.portcullisTick === downTick) this.pendingCue = 'gate_opening';
      this.portcullisTick--;
    }
  }

  private watchBall(ball: BallOfSwine, ctx: SystemContext): void {
    if (this.resyncWithBall) {
      this.resyncWithBall = false;
      this.seenSlams = ball.slamCount;
      this.seenTramples = ball.trampleHitCount;
      this.seenBallHp = ball.hp;
      return;
    }
    if (ball.slamCount !== this.seenSlams) {
      this.seenSlams = ball.slamCount;
      this.onSlam(ball, ctx.roster.mobs);
    }
    if (ball.trampleHitCount !== this.seenTramples) {
      this.seenTramples = ball.trampleHitCount;
      this.layBlood(ball.lastTrampleAt.x, ball.lastTrampleAt.y);
    }
    const struckWhileDown = ball.isStopped && ball.hp < this.seenBallHp;
    if (struckWhileDown) this.startWave(this.bearingOf(ball.x + HALF_TILE, ball.y + HALF_TILE));
    this.seenBallHp = ball.hp;
    this.throwMud(ball);
  }

  private bearingOf(worldX: number, worldY: number): number {
    return Math.atan2(worldY - this.centreY, worldX - this.centreX);
  }

  private startWave(origin: number): void {
    this.waveOrigin = origin;
    this.waveAge = 0;
  }

  private onSlam(ball: BallOfSwine, mobs: readonly Mob[]): void {
    const at = ball.lastSlamAt;
    const bearing = this.bearingOf(at.x, at.y);
    this.startWave(bearing);
    if (!ball.isShedding || ball.hp <= 0) return;
    // Where the ball met the iron, not where its middle was.
    const reach = BOS_BODY_RADIUS_TILES * TILE_SIZE;
    const distance = Math.hypot(at.x - this.centreX, at.y - this.centreY);
    const impactScale = distance === 0 ? 0 : (distance + reach) / distance;
    const impactX = this.centreX + (at.x - this.centreX) * impactScale;
    const impactY = this.centreY + (at.y - this.centreY) * impactScale;
    const shaken = this.cages
      .filter((cage) => cage.phase === 'idle')
      .map((cage) => ({ cage, gap: Math.hypot(cage.worldX - impactX, cage.worldY - impactY) }))
      .filter(({ gap }) => gap <= CAGE_SLAM_REACH_TILES * TILE_SIZE)
      .sort((a, b) => a.gap - b.gap);
    for (const { cage } of shaken) {
      if (!this.hasRoomForAnotherPig(mobs)) break;
      cage.phase = 'rattling';
      cage.timer = CAGE_RATTLE_TOTAL_FRAMES;
    }
  }

  /**
   * Whether one more cage may start to rattle. A rattling cage is a Tuskling
   * already promised, so it counts against both caps: the shared live pool the
   * ball's shedding draws on, and the fight's own cage budget.
   */
  private hasRoomForAnotherPig(mobs: readonly Mob[]): boolean {
    const promised = this.cages.filter((cage) => cage.phase === 'rattling').length;
    if (liveShedTusklings(mobs) + promised >= SHED_MAX_ALIVE) return false;
    return this.cagesReleased < CAGE_RELEASE_MAX;
  }

  private advanceCages(ball: BallOfSwine | null, ctx: SystemContext): void {
    const ballFighting = ball !== null && ball.hp > 0;
    for (const cage of this.cages) {
      if (cage.phase === 'rattling') {
        // A pig the fight no longer needs settles back down.
        if (!ballFighting) {
          cage.phase = 'idle';
          cage.timer = 0;
          continue;
        }
        cage.timer--;
        if (cage.timer > 0) continue;
        this.releasePig(cage, ball, ctx);
      } else if (cage.phase === 'bursting') {
        cage.timer--;
        if (cage.timer <= 0) cage.phase = 'open';
      }
    }
  }

  private releasePig(cage: CageState, ball: BallOfSwine, ctx: SystemContext): void {
    // The ball may have shed into the pool while this cage rattled; the cap
    // still holds, and the door holds with it.
    if (liveShedTusklings(ctx.roster.mobs) >= SHED_MAX_ALIVE) {
      cage.phase = 'idle';
      cage.timer = 0;
      return;
    }
    const tile = this.releaseTile(cage);
    const pig =
      tile === null
        ? null
        : createBallTuskling(ball, tile, this.gameMap, CAGE_TUSKLING_DAZE_FRAMES);
    if (pig === null) {
      // Nowhere to put it: the door holds this time.
      cage.phase = 'idle';
      return;
    }
    ctx.roster.add(pig);
    cage.phase = 'bursting';
    cage.timer = CAGE_BURST_TOTAL_FRAMES;
  }

  private releaseTile(cage: CageState): TilePoint | null {
    const { centre } = this.arena;
    for (let step = 0; step <= CAGE_RELEASE_SEARCH_TILES; step++) {
      const radius = COLOSSEUM_FOOTING_RADIUS_TILES - CAGE_RELEASE_INSET_TILES - step;
      const tileX = centre.x + Math.round(Math.cos(cage.angle) * radius);
      const tileY = centre.y + Math.round(Math.sin(cage.angle) * radius);
      if (hasRoomToMove(this.gameMap, tileX, tileY)) return { x: tileX, y: tileY };
    }
    return null;
  }

  private throwMud(ball: BallOfSwine): void {
    if (this.splatterCooldown > 0) this.splatterCooldown--;
    if (!ball.isMoving || this.splatterCooldown > 0) return;
    const tileX = Math.floor((ball.x + HALF_TILE) / TILE_SIZE);
    const tileY = Math.floor((ball.y + HALF_TILE) / TILE_SIZE);
    if (this.gameMap.structure[tileY]?.[tileX]?.type !== ARENA_MUD) return;
    this.splatterCooldown = MUD_SPLATTER_INTERVAL;
    const behind = Math.atan2(-ball.facingY, -ball.facingX);
    const scatter = (hashLattice(this.decalsLaid, 0, DECAL_SEED) - HALF) * Math.PI;
    const reach =
      (BOS_BODY_RADIUS_TILES +
        hashLattice(this.decalsLaid, 1, DECAL_SEED) * MUD_SPLATTER_SCATTER_TILES) *
      TILE_SIZE;
    this.layDecal(
      this.mudSplatter,
      MUD_SPLATTER_MAX,
      ball.x + HALF_TILE + Math.cos(behind + scatter) * reach,
      ball.y + HALF_TILE + Math.sin(behind + scatter) * reach,
      MUD_SPLATTER_VARIANTS,
      MUD_SPLATTER_LIFE_FRAMES,
    );
  }

  private layBlood(worldX: number, worldY: number): void {
    this.layDecal(
      this.bloodDecals,
      BLOOD_DECAL_MAX,
      worldX,
      worldY,
      BLOOD_VARIANTS,
      BLOOD_DECAL_LIFE_FRAMES,
    );
  }

  /** Adds a decal, pulled inside the sand and onto walkable ground, and trims the list to its cap. */
  private layDecal(
    list: GroundDecal[],
    cap: number,
    worldX: number,
    worldY: number,
    variants: number,
    life: number,
  ): void {
    this.decalsLaid++;
    const limit = (COLOSSEUM_FOOTING_RADIUS_TILES - DECAL_WALL_CLEARANCE_TILES) * TILE_SIZE;
    const offX = worldX - this.centreX;
    const offY = worldY - this.centreY;
    const distance = Math.hypot(offX, offY);
    const pull = distance > limit ? limit / distance : 1;
    const x = this.centreX + offX * pull;
    const y = this.centreY + offY * pull;
    if (!this.gameMap.isWalkable(Math.floor(x / TILE_SIZE), Math.floor(y / TILE_SIZE))) return;
    list.push({
      x,
      y,
      variant: Math.floor(hashLattice(this.decalsLaid, 2, DECAL_SEED) * variants),
      life,
    });
    while (list.length > cap) list.shift();
  }

  override onSeal(): void {
    this.preSeal = this.captureCheckpoint();
    this.startWave(Math.PI * HALF);
  }

  /** A won ring settles: any pig still rattling calms down. Safe to repeat. */
  override onBossDefeated(): void {
    for (const cage of this.cages) {
      if (cage.phase === 'rattling') {
        cage.phase = 'idle';
        cage.timer = 0;
      }
    }
  }

  override onFightAborted(): void {
    if (this.preSeal !== null) this.restoreCheckpoint(this.preSeal);
  }

  override resetForCheckpoint(): void {
    this.waveAge = -1;
    this.dustTimer = 0;
    this.splatterCooldown = 0;
    this.pendingCue = null;
    this.resyncWithBall = true;
    for (const cage of this.cages) {
      if (cage.phase === 'rattling') {
        cage.phase = 'idle';
        cage.timer = 0;
      }
    }
  }

  /**
   * A crawler standing in a wallow is told the way out: away from the middle of
   * the patch, which is the short way off a blob of mud.
   */
  override getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    const tileX = Math.floor((x + HALF_TILE) / TILE_SIZE);
    const tileY = Math.floor((y + HALF_TILE) / TILE_SIZE);
    if (this.gameMap.structure[tileY]?.[tileX]?.type !== ARENA_MUD) return null;
    let nearest = this.mudCentroids[0];
    let nearestGap = Infinity;
    for (const centroid of this.mudCentroids) {
      const gap = Math.hypot(centroid.x - x, centroid.y - y);
      if (gap < nearestGap) {
        nearest = centroid;
        nearestGap = gap;
      }
    }
    const dx = x - nearest.x;
    const dy = y - nearest.y;
    const length = Math.hypot(dx, dy);
    // Dead centre: out toward the arena's middle, which is never iron.
    if (length === 0) {
      const inward = { dx: this.centreX - HALF_TILE - x, dy: this.centreY - HALF_TILE - y };
      const inwardLength = Math.hypot(inward.dx, inward.dy);
      return inwardLength === 0
        ? { dx: 0, dy: 1 }
        : { dx: inward.dx / inwardLength, dy: inward.dy / inwardLength };
    }
    return { dx: dx / length, dy: dy / length };
  }

  override renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.drawDecals(ctx, camX, camY);
    this.drawBanners(ctx, camX, camY);
    this.drawCages(ctx, camX, camY);
    this.drawWave(ctx, camX, camY);
  }

  override renderEntities(): ReadonlyArray<DressingRenderable> {
    this.renderables.length = 0;
    this.renderables.push(this.portcullisRenderable);
    return this.renderables;
  }

  override renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    if (this.dustTimer <= 0) return;
    const door = COLOSSEUM_DOOR_OPENING;
    const footX = this.centreX + (door.left + door.right) * HALF * TILE_SIZE - camX;
    const footY = this.centreY + door.bottom * TILE_SIZE - camY;
    const age = 1 - this.dustTimer / DUST_TOTAL_FRAMES;
    ctx.save();
    ctx.fillStyle = DUST_COLOR;
    ctx.globalAlpha = DUST_ALPHA * (1 - age);
    for (let puff = 0; puff < DUST_PUFFS; puff++) {
      const spread =
        ((puff / (DUST_PUFFS - 1)) * 2 - 1) * DUST_SPREAD_TILES * TILE_SIZE * (HALF + age);
      const rise = hashLattice(puff, 0, DECAL_SEED) * DUST_RADIUS_TILES * TILE_SIZE * age;
      ctx.beginPath();
      ctx.arc(
        footX + spread,
        footY - rise,
        DUST_RADIUS_TILES * TILE_SIZE * (HALF + age),
        0,
        FULL_TURN,
      );
      ctx.fill();
    }
    ctx.restore();
  }

  private onScreen(worldX: number, worldY: number, camX: number, camY: number): boolean {
    const sx = worldX - camX;
    const sy = worldY - camY;
    return (
      sx > -CULL_MARGIN_PX &&
      sy > -CULL_MARGIN_PX &&
      sx < viewportWidth() + CULL_MARGIN_PX &&
      sy < viewportHeight() + CULL_MARGIN_PX
    );
  }

  private drawDecals(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const splat of this.mudSplatter) {
      if (!this.onScreen(splat.x, splat.y, camX, camY)) continue;
      drawSpriteKey(
        ctx,
        'colosseum_mud_splatter',
        'splat',
        splat.variant,
        splat.x - camX,
        splat.y - camY,
        TILE_SIZE,
        {
          alpha: fadeOf(splat.life, MUD_SPLATTER_FADE_FRAMES),
          rotation: splat.variant,
        },
      );
    }
    for (const blood of this.bloodDecals) {
      if (!this.onScreen(blood.x, blood.y, camX, camY)) continue;
      drawBloodDecal(ctx, blood, camX, camY);
    }
  }

  private drawBanners(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const frame = Math.floor(this.clock / BANNER_TICKS) % BANNER_FRAMES;
    BANNER_BEARINGS.forEach((bearing, index) => {
      const radius = colosseumCapInnerRadius(bearing) - BANNER_HANG_TILES;
      const x = this.centreX + Math.cos(bearing) * radius * TILE_SIZE;
      const y = this.centreY + Math.sin(bearing) * radius * TILE_SIZE;
      if (!this.onScreen(x, y, camX, camY)) return;
      drawSpriteKey(
        ctx,
        'colosseum_banner',
        'sway',
        (frame + index) % BANNER_FRAMES,
        x - camX,
        y - camY,
        TILE_SIZE,
      );
    });
  }

  private drawCages(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const cage of this.cages) {
      if (!this.onScreen(cage.worldX, cage.worldY, camX, camY)) continue;
      const { row, frame } = this.cageFrame(cage);
      drawSpriteKey(
        ctx,
        'colosseum_cage',
        row,
        frame,
        cage.worldX - camX,
        cage.worldY - camY,
        TILE_SIZE,
        {
          // The sprite's mouth is its −y side; turned so it faces the arena.
          rotation: cage.angle - Math.PI * HALF,
        },
      );
    }
  }

  private cageFrame(cage: CageState): { row: 'idle' | 'rattle' | 'burst' | 'open'; frame: number } {
    switch (cage.phase) {
      case 'idle': {
        const phase = Math.floor((this.clock + cage.index * CAGE_IDLE_TICKS) / CAGE_IDLE_TICKS);
        return { row: 'idle', frame: phase % CAGE_IDLE_FRAMES };
      }
      case 'rattling':
        return {
          row: 'rattle',
          frame: Math.floor(this.clock / CAGE_RATTLE_TICKS) % CAGE_RATTLE_FRAMES,
        };
      case 'bursting': {
        const progress = 1 - cage.timer / CAGE_BURST_TOTAL_FRAMES;
        return {
          row: 'burst',
          frame: Math.min(CAGE_BURST_FRAMES - 1, Math.floor(progress * CAGE_BURST_FRAMES)),
        };
      }
      case 'open':
        return { row: 'open', frame: 0 };
    }
  }

  /** The seats inside the wave's band this frame, nearest the front first, capped. */
  private raisedSeats(): ColosseumLayout['spectators'] {
    if (this.waveAge < 0 || this.layout === null) return [];
    const front = this.waveAge * WAVE_SPEED_RADIANS;
    const raised = this.layout.spectators
      .map((seat) => ({ seat, behind: front - angularGap(seat.angle, this.waveOrigin) }))
      .filter(({ behind }) => behind >= 0 && behind <= WAVE_WIDTH_RADIANS)
      .sort((a, b) => a.behind - b.behind)
      .slice(0, WAVE_MAX_RAISED);
    return raised.map(({ seat }) => seat);
  }

  private drawWave(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const frame = Math.floor(this.clock / CHEER_TICKS) % CHEER_FRAMES;
    for (const seat of this.raisedSeats()) {
      const x = this.centreX + seat.x * TILE_SIZE;
      const y = this.centreY + seat.y * TILE_SIZE;
      if (!this.onScreen(x, y, camX, camY)) continue;
      drawSpriteKey(
        ctx,
        'colosseum_cheer',
        CHEER_ROWS[seat.variant % CHEER_ROWS.length],
        frame,
        x - camX,
        y - camY,
        TILE_SIZE,
      );
    }
  }

  captureCheckpoint(): ColosseumDressingCheckpoint {
    return {
      openCages: this.cages
        .filter((cage) => cage.phase === 'open' || cage.phase === 'bursting')
        .map((cage) => cage.index),
      portcullisDown: this.gameMap.arenaDoorLocked,
      mudSplatter: this.mudSplatter.map((decal) => ({ ...decal })),
      bloodDecals: this.bloodDecals.map((decal) => ({ ...decal })),
    };
  }

  restoreCheckpoint(snapshot: ColosseumDressingCheckpoint): void {
    for (const cage of this.cages) {
      cage.phase = snapshot.openCages.includes(cage.index) ? 'open' : 'idle';
      cage.timer = 0;
    }
    // Straight to where it was: a rewind is not something the gate lived through.
    this.portcullisTick = snapshot.portcullisDown ? PORTCULLIS_LAST_FRAME * PORTCULLIS_TICKS : 0;
    this.dustTimer = 0;
    this.mudSplatter = snapshot.mudSplatter.slice(-MUD_SPLATTER_MAX).map((decal) => ({ ...decal }));
    this.bloodDecals = snapshot.bloodDecals.slice(-BLOOD_DECAL_MAX).map((decal) => ({ ...decal }));
    this.resyncWithBall = true;
  }
}

function findBall(mobs: readonly Mob[]): BallOfSwine | null {
  for (const mob of mobs) if (mob instanceof BallOfSwine) return mob;
  return null;
}

function angularGap(a: number, b: number): number {
  const raw = Math.abs(a - b) % FULL_TURN;
  return raw > Math.PI ? FULL_TURN - raw : raw;
}

function ageDecals(list: GroundDecal[]): void {
  for (const decal of list) decal.life--;
  let write = 0;
  for (const decal of list) if (decal.life > 0) list[write++] = decal;
  list.length = write;
}

function fadeOf(life: number, fadeFrames: number): number {
  return life >= fadeFrames ? 1 : Math.max(0, life / fadeFrames);
}

/** A trample's blood on the sand, drawn with the gore system's own puddle art. */
function drawBloodDecal(
  ctx: CanvasRenderingContext2D,
  decal: GroundDecal,
  camX: number,
  camY: number,
): void {
  const def = getSpriteDef('blood_puddle');
  const state = def?.states.get('puddle');
  if (def === undefined || state === undefined) return;
  const radiusX =
    BLOOD_DECAL_MIN_RADIUS_PX +
    hashLattice(decal.variant, decal.life, DECAL_SEED) * BLOOD_DECAL_RADIUS_RANGE_PX;
  const radiusY = radiusX * BLOOD_DECAL_ASPECT;
  const frame = decal.variant % state.frameCount;
  ctx.save();
  ctx.globalAlpha = BLOOD_DECAL_ALPHA * fadeOf(decal.life, BLOOD_DECAL_FADE_FRAMES);
  ctx.drawImage(
    def.img,
    frame * def.frameWidth,
    state.row * def.frameHeight,
    def.frameWidth,
    def.frameHeight,
    decal.x - camX - radiusX,
    decal.y - camY - radiusY,
    radiusX * 2,
    radiusY * 2,
  );
  ctx.restore();
}

// ── Save parsing ────────────────────────────────────────────────────────────

/** A decal list from a save; absent means none were laid, as in a save older than the list. */
function parseDecals(value: unknown): GroundDecal[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const decals: GroundDecal[] = [];
  for (const entry of value) {
    if (!isRecord(entry)) return undefined;
    const { x, y, variant, life } = entry;
    if (typeof x !== 'number' || typeof y !== 'number') return undefined;
    if (typeof variant !== 'number' || typeof life !== 'number') return undefined;
    decals.push({ x, y, variant, life });
  }
  return decals;
}

function parseCageIndices(value: unknown): number[] | undefined {
  if (value === undefined) return [];
  if (!Array.isArray(value)) return undefined;
  const indices: number[] = [];
  for (const entry of value) {
    if (typeof entry !== 'number') return undefined;
    indices.push(entry);
  }
  return indices;
}

/**
 * Reads the colosseum's part of a saved checkpoint back from untrusted JSON. A
 * field a save does not carry reads as untouched; a field of the wrong shape
 * rejects the whole snapshot.
 */
export function parseColosseumDressingCheckpoint(
  value: unknown,
): ColosseumDressingCheckpoint | undefined {
  if (!isRecord(value)) return undefined;
  const { openCages, portcullisDown, mudSplatter, bloodDecals } = value;
  const cages = parseCageIndices(openCages);
  const splatter = parseDecals(mudSplatter);
  const blood = parseDecals(bloodDecals);
  if (cages === undefined || splatter === undefined || blood === undefined) return undefined;
  if (portcullisDown !== undefined && typeof portcullisDown !== 'boolean') return undefined;
  return {
    openCages: cages,
    portcullisDown: portcullisDown ?? false,
    mudSplatter: splatter,
    bloodDecals: blood,
  };
}
