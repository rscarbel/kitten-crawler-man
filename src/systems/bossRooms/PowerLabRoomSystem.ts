import { TILE_SIZE } from '../../core/constants';
import { drawSpriteKey } from '../../core/spriteAssets/SpriteRenderer';
import { worldViewWidth, worldViewHeight } from '../../core/rendering/Viewport';
import type { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import {
  ElectricGoblin,
  SHOCK_GRENADE_ARC_TILES,
  SHOCK_GRENADE_RADIUS_TILES,
  SLAM_WAVE_DEPTH_TILES,
  SLAM_WAVE_HALF_WIDTH_TILES,
} from '../../creatures/ElectricGoblin';
import type { GameMap } from '../../map/GameMap';
import {
  isPuddleWaterCached,
  prewarmPowerLabArt,
  puddleWaterSurface,
} from '../../map/tiles/bossRooms/powerLabTiles';
import { SPRITE_BUILDING_OVERLAY_FPS } from '../../map/tiles/overlayAnimation';
import { POWER_LAB_CONSOLE, POWER_LAB_TANK, positionHash } from '../../map/tileTypes';
import {
  FX_ARC_FRAMES,
  FX_DRIP_FRAMES,
  FX_RIPPLE_FRAMES,
  FX_SPARK_FRAMES,
} from '../../sprites/art/powerLabArt';
import { prewarmElectricGoblin } from '../../sprites/electricGoblinSprite';
import {
  drawGrenadeInFlight,
  drawGrenadeRing,
  drawShockBurst,
  drawSlamLane,
  drawSlamWave,
} from '../../sprites/electricGoblinTelegraphs';
import { drawDangerRegion } from '../../sprites/dangerTelegraph';
import { frameTime } from '../../utils';
import type { SystemContext } from '../GameSystem';
import { stampProps, type TilePoint, type TileRect } from './bossRoomLayout';
import { InertBossRoomDressing } from './InertBossRoomDressing';
import {
  buildPowerLabLayout,
  labTileKey,
  puddleAt,
  registerPowerLab,
  type PowerLabLayout,
} from './powerLabLayout';

/**
 * Wall-clock time the puddle prewarm may take in a frame. Small, because it
 * runs from the floor's first frames alongside everything else loading.
 */
const WATER_PREWARM_BUDGET_MS = 0.5;

// Ambience, all hash-timed on the overlay clock and capped.
const RIPPLE_PERIOD_CELLS = 24;
const MAX_RIPPLES = 18;
const DRIP_PERIOD_CELLS = 40;
const DRIP_ONE_IN = 6;
const MAX_DRIPS = 6;
const DRIP_HASH_SHIFT = 8;
/** Tiles of slack past the viewport before anything is culled. */
const CULL_MARGIN_TILES = 2;

/**
 * While the puddle is told, sparks light only this share of its tiles at the
 * start of the tell and every tile by its end, so the crackle visibly builds.
 */
const TELL_FIRST_SHARE = 0.25;
/** Each tile's place in the order the tell's sparks reach it, out of this many. */
const TELL_ORDER_BUCKETS = 100;
/** A charged puddle's tiles flicker between the arc and the sparks on this many cells. */
const CHARGED_FLICKER_CELLS = 3;

const HALF = 0.5;
/** The puddle's warning is drawn at full strength: the puddle is fixed the moment its tell starts. */
const WARNING_FADE = 1;
/** A live puddle's warning flashes this strongly under its arcs, so live reads apart from told. */
const CHARGED_WARNING_FLASH = 0.3;

/**
 * The power lab, where the Current Goblin fights: its vats and consoles are
 * set dressing, and its two or three large puddles are his.
 *
 * The room owns no fight state of its own. Each frame it hands the boss the
 * puddles he may charge, draws what he is about to land (grenade rings, the
 * charged puddle, the slam lanes and their waves) and tells companions how to get
 * clear of it, all read off the boss.
 */
export class PowerLabRoomSystem extends InertBossRoomDressing {
  readonly layout: PowerLabLayout;
  /** The boss this frame, if he is in the room and alive. */
  private boss: ElectricGoblin | null = null;
  /** Puddle water tiles still to paint ahead of need. */
  private readonly waterPrewarm: TilePoint[];
  /** The floor art and his figure are warmed on the first frame, before any water. */
  private firstFramePrewarmed = false;

  constructor(
    readonly gameMap: GameMap,
    readonly bounds: TileRect,
  ) {
    super();
    const room = gameMap.bossRooms.find((r) => r.bounds.x === bounds.x && r.bounds.y === bounds.y);
    const centre = room?.centre ?? {
      x: Math.floor(bounds.x + bounds.w / 2),
      y: Math.floor(bounds.y + bounds.h / 2),
    };
    this.layout = buildPowerLabLayout(gameMap.structure, bounds, centre);
    registerPowerLab(gameMap.structure, this.layout);
    stampProps(gameMap, [
      ...this.layout.vats.map((v) => ({ ...v.tile, type: POWER_LAB_TANK })),
      ...this.layout.consoles.map((t) => ({ ...t, type: POWER_LAB_CONSOLE })),
    ]);
    this.waterPrewarm = this.layout.puddles.flatMap((p) => [...p.tiles]);
  }

  // ── Frame ──────────────────────────────────────────────────────────────────

  override update(ctx: SystemContext): void {
    this.prewarm();
    this.boss = this.findBoss(ctx);
    if (this.boss !== null) {
      this.boss.arena = { bounds: this.bounds, puddles: this.layout.puddles };
    }
  }

  private findBoss(ctx: SystemContext): ElectricGoblin | null {
    for (const mob of ctx.roster.mobs) {
      if (mob instanceof ElectricGoblin && mob.isAlive && this.contains(mob)) return mob;
    }
    return null;
  }

  /**
   * His figure's cells are slow to paint, so they are queued on the floor's
   * first frame; the puddle water is painted a few tiles a frame after it, so
   * neither the lab's first chunk bake nor his entrance paints inside a frame.
   */
  private prewarm(): void {
    if (!this.firstFramePrewarmed) {
      this.firstFramePrewarmed = true;
      prewarmPowerLabArt(this.layout, TILE_SIZE);
      prewarmElectricGoblin();
      return;
    }
    if (this.waterPrewarm.length === 0) return;
    const start = performance.now();
    while (this.waterPrewarm.length > 0 && performance.now() - start < WATER_PREWARM_BUDGET_MS) {
      const tile = this.waterPrewarm.pop();
      if (tile === undefined) break;
      const puddle = puddleAt(this.layout, tile.x, tile.y);
      if (puddle === null) continue;
      const isWet = (x: number, y: number): boolean => puddle.keys.has(labTileKey(x, y));
      if (isPuddleWaterCached(tile.x, tile.y, TILE_SIZE, isWet)) continue;
      puddleWaterSurface(tile.x, tile.y, TILE_SIZE, isWet);
    }
  }

  private contains(body: { x: number; y: number }): boolean {
    const tx = Math.floor((body.x + TILE_SIZE * HALF) / TILE_SIZE);
    const ty = Math.floor((body.y + TILE_SIZE * HALF) / TILE_SIZE);
    const b = this.bounds;
    return tx >= b.x && ty >= b.y && tx < b.x + b.w && ty < b.y + b.h;
  }

  // ── Hazards ────────────────────────────────────────────────────────────────

  override getHazardEscapeVector(x: number, y: number): { dx: number; dy: number } | null {
    return this.boss?.hazardEscape(this.gameMap, x, y) ?? null;
  }

  // ── Drawing ────────────────────────────────────────────────────────────────

  override renderGround(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    _promptFor: HumanPlayer | CatPlayer | undefined,
  ): void {
    if (!this.onScreen(camX, camY)) return;
    this.drawRipples(ctx, camX, camY, this.overlayCell());
  }

  override renderGroundWarnings(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const boss = this.boss;
    if (boss === null || !this.onScreen(camX, camY)) return;
    this.drawPuddleCharge(ctx, boss, camX, camY, this.overlayCell());
    const ringPx = SHOCK_GRENADE_RADIUS_TILES * TILE_SIZE;
    for (const grenade of boss.shockGrenades) drawGrenadeRing(ctx, grenade, ringPx, camX, camY);
    const halfWidthPx = SLAM_WAVE_HALF_WIDTH_TILES * TILE_SIZE;
    const halfDepthPx = SLAM_WAVE_DEPTH_TILES * TILE_SIZE * HALF;
    for (const lane of boss.slamLanes) drawSlamLane(ctx, lane, halfWidthPx, camX, camY);
    for (const wave of boss.slamWaves) {
      drawSlamWave(ctx, wave, halfWidthPx, halfDepthPx, camX, camY);
    }
  }

  /** The grenades on their lob, and their bursts, go over every body they fly across or catch. */
  override renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const boss = this.boss;
    if (boss === null || !this.onScreen(camX, camY)) return;
    const ringPx = SHOCK_GRENADE_RADIUS_TILES * TILE_SIZE;
    for (const burst of boss.shockBursts) drawShockBurst(ctx, burst, ringPx, camX, camY);
    const arcPx = SHOCK_GRENADE_ARC_TILES * TILE_SIZE;
    for (const grenade of boss.shockGrenades) drawGrenadeInFlight(ctx, grenade, arcPx, camX, camY);
  }

  /** The animation cell the room's overlay sprites are on this frame. */
  private overlayCell(): number {
    return Math.floor(frameTime * SPRITE_BUILDING_OVERLAY_FPS);
  }

  private onScreen(camX: number, camY: number): boolean {
    const margin = CULL_MARGIN_TILES * TILE_SIZE;
    const b = this.bounds;
    return !(
      (b.x + b.w) * TILE_SIZE + margin < camX ||
      (b.y + b.h) * TILE_SIZE + margin < camY ||
      b.x * TILE_SIZE - margin > camX + worldViewWidth() ||
      b.y * TILE_SIZE - margin > camY + worldViewHeight()
    );
  }

  private tileOnScreen(t: TilePoint, camX: number, camY: number): boolean {
    const x = t.x * TILE_SIZE - camX;
    const y = t.y * TILE_SIZE - camY;
    return x > -TILE_SIZE && y > -TILE_SIZE && x < worldViewWidth() && y < worldViewHeight();
  }

  private drawRipples(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    cell: number,
  ): void {
    let ripples = 0;
    let drips = 0;
    for (const puddle of this.layout.puddles) {
      for (const t of puddle.tiles) {
        if (!this.tileOnScreen(t, camX, camY)) continue;
        const hash = positionHash(t.x, t.y);
        const sx = t.x * TILE_SIZE - camX;
        const sy = t.y * TILE_SIZE - camY;
        const rippleStep = (cell + hash) % RIPPLE_PERIOD_CELLS;
        if (rippleStep < FX_RIPPLE_FRAMES && ripples < MAX_RIPPLES) {
          drawSpriteKey(ctx, 'power_lab_fx', 'ripple', rippleStep, sx, sy, TILE_SIZE);
          ripples++;
        }
        if (hash % DRIP_ONE_IN !== 0 || drips >= MAX_DRIPS) continue;
        const dripStep = (cell + (hash >>> DRIP_HASH_SHIFT)) % DRIP_PERIOD_CELLS;
        if (dripStep < FX_DRIP_FRAMES) {
          drawSpriteKey(ctx, 'power_lab_fx', 'drip', dripStep, sx, sy, TILE_SIZE);
          drips++;
        }
      }
    }
  }

  /**
   * The puddle he is charging: the red ground warning filling it from the
   * middle through the tell, under sparks spreading until every tile
   * crackles; then, while it is live, the whole warning flashing under a
   * surface of arcs.
   */
  private drawPuddleCharge(
    ctx: CanvasRenderingContext2D,
    boss: ElectricGoblin,
    camX: number,
    camY: number,
    cell: number,
  ): void {
    const charge = boss.puddleCharge;
    if (charge.kind === 'none') return;
    if (charge.puddle >= this.layout.puddles.length) return;
    const puddle = this.layout.puddles[charge.puddle];
    drawDangerRegion(ctx, puddle.tiles, TILE_SIZE, camX, camY, WARNING_FADE, {
      fillProgress: charge.kind === 'tell' ? charge.progress : 1,
      locked: true,
      strikeFlash: charge.kind === 'charged' ? CHARGED_WARNING_FLASH : 0,
    });
    const litShare =
      charge.kind === 'tell' ? TELL_FIRST_SHARE + (1 - TELL_FIRST_SHARE) * charge.progress : 1;
    for (const t of puddle.tiles) {
      if (!this.tileOnScreen(t, camX, camY)) continue;
      const hash = positionHash(t.x, t.y);
      const sx = t.x * TILE_SIZE - camX;
      const sy = t.y * TILE_SIZE - camY;
      if (charge.kind === 'tell') {
        if ((hash % TELL_ORDER_BUCKETS) / TELL_ORDER_BUCKETS >= litShare) continue;
        const frame = (cell + hash) % FX_SPARK_FRAMES;
        drawSpriteKey(ctx, 'power_lab_wash', 'sparks', frame, sx, sy, TILE_SIZE);
        continue;
      }
      const arcing = (cell + hash) % CHARGED_FLICKER_CELLS !== 0;
      const state = arcing ? 'arc' : 'sparks';
      const frames = arcing ? FX_ARC_FRAMES : FX_SPARK_FRAMES;
      drawSpriteKey(ctx, 'power_lab_wash', state, (cell + hash) % frames, sx, sy, TILE_SIZE);
    }
  }
}
