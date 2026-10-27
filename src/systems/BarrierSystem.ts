import { TILE_SIZE } from '../core/constants';
import type { Player } from '../Player';
import type { Mob } from '../creatures/Mob';
import type { GameMap } from '../map/GameMap';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import {
  drawDumbbellFloor,
  drawBenchPressFloor,
  drawTreadmillFloor,
  treadmillFloorArtTop,
} from '../sprites/gymEquipmentSprite';
import { worldPalette } from '../ui/theme/worldInk';
import { worldText } from '../ui/world/worldText';
import { viewportWidth, viewportHeight } from '../core/rendering/Viewport';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { PLACE_ROWS } from '../sprites/art/humanFigure';
import { PLACE_RELEASE_TICKS } from '../sprites/art/human/actionsBuild';

export type BarrierItemId = 'gym_dumbbell' | 'gym_bench_press' | 'gym_treadmill';

/**
 * The construct lasts exactly as long as he takes to set the case down, so the
 * equipment stands on the tick his hands leave it.
 */
const CONSTRUCT_FRAMES = PLACE_RELEASE_TICKS;
/** Slow zone radius as a fraction of a tile. */
const SLOW_RADIUS_TILE_FRACTION = 0.9;
/** Tiles adjacent to a barrier that count as a slow zone (half-tile radius). */
const SLOW_RADIUS_PX = TILE_SIZE * SLOW_RADIUS_TILE_FRACTION;
/** Fraction of tile size used as center offset for tile-center calculations. */
const TILE_CENTER_FRACTION = 0.5;
/** Progress arc radius multiplier relative to tile size. */
const CONSTRUCT_ARC_RADIUS_MULT = 1.2;
/** Label y offset above the arc radius. */
const CONSTRUCT_LABEL_Y_OFFSET = 14;
/** Lifts the label from where its baseline would sit to where its top sits. */
const CONSTRUCT_LABEL_ADJUST = 7;
const CONSTRUCT_LABEL_SIZE = 9;
const CONSTRUCT_RING_WIDTH = 4;
const CONSTRUCT_TRACK_ALPHA = 0.5;
const CONSTRUCT_PROGRESS_ALPHA = 0.9;
/** Slow zone pulse ring alpha base and range. */
const SLOW_PULSE_ALPHA_BASE = 0.18;
const SLOW_PULSE_ALPHA_RANGE = 0.08;
/** Pulse speed for slow zone ring animation. */
const SLOW_PULSE_SPEED = 0.004;
const SLOW_RING_WIDTH = 2;

export interface PlacedBarrier {
  tileX: number;
  tileY: number;
  worldX: number; // = tileX * TILE_SIZE
  worldY: number;
  itemId: BarrierItemId;
  placer: Player; // who placed it (used for pickup-back logic)
}

export interface PendingConstruct {
  player: Player;
  hotbarIdx: number;
  itemId: BarrierItemId;
  framesLeft: number;
}

export interface BarrierCheckpoint {
  barriers: PlacedBarrier[];
  pending: PendingConstruct | null;
}

/** `placer` stays a bare reference: it decides who reclaims the item. */
function clonePlacedBarrier(barrier: PlacedBarrier): PlacedBarrier {
  return {
    tileX: barrier.tileX,
    tileY: barrier.tileY,
    worldX: barrier.worldX,
    worldY: barrier.worldY,
    itemId: barrier.itemId,
    placer: barrier.placer,
  };
}

function clonePendingConstruct(construct: PendingConstruct): PendingConstruct {
  return {
    player: construct.player,
    hotbarIdx: construct.hotbarIdx,
    itemId: construct.itemId,
    framesLeft: construct.framesLeft,
  };
}

export class BarrierSystem implements GameSystem {
  private barriers: PlacedBarrier[] = [];
  private pending: PendingConstruct | null = null;
  /** The human while he is drawn setting the piece down, so a cancel can stand him back up. */
  private placingHuman: HumanPlayer | null = null;
  /** Mobs this system slowed last frame — only these need their flag cleared. */
  private slowedLastFrame: Mob[] = [];
  /** Reused result set for the slow-zone neighbour query. */
  private readonly slowZoneQuery = new Set<Mob>();

  constructor(private readonly gameMap: GameMap) {}

  // Queries

  get isConstructing(): boolean {
    return this.pending !== null;
  }

  get pendingConstructHotbarIdx(): number {
    return this.pending?.hotbarIdx ?? -1;
  }

  // Actions

  /**
   * Start the 1-second construct for the given hotbar slot. The human squats
   * and sets the piece down while it runs; the placing row is timed so his
   * hands leave the case on the tick the equipment appears.
   */
  beginConstruct(player: Player, hotbarIdx: number, itemId: BarrierItemId): void {
    if (this.pending) return;
    this.pending = {
      player,
      hotbarIdx,
      itemId,
      framesLeft: CONSTRUCT_FRAMES,
    };
    if (player instanceof HumanPlayer) {
      const faceX = player.facingX;
      const faceY = player.facingY;
      const placing = player.playAction(player.rowFacing(PLACE_ROWS, faceX, faceY), {
        faceX,
        faceY,
        onEnd: () => {
          if (this.placingHuman === player) this.placingHuman = null;
        },
      });
      if (placing) this.placingHuman = player;
    }
  }

  /** Cancel any in-progress construction (e.g. player dies or pauses). */
  cancelConstruct(): void {
    this.pending = null;
    this.placingHuman?.stopAction();
  }

  captureCheckpoint(): BarrierCheckpoint {
    return {
      barriers: this.barriers.map(clonePlacedBarrier),
      pending: this.pending === null ? null : clonePendingConstruct(this.pending),
    };
  }

  /**
   * A barrier placed after the capture has to leave the map, otherwise it stays
   * standing while the item that paid for it returns to the rewound inventory.
   */
  restoreCheckpoint(snapshot: BarrierCheckpoint): void {
    this.barriers = snapshot.barriers.map(clonePlacedBarrier);
    this.pending = snapshot.pending === null ? null : clonePendingConstruct(snapshot.pending);
    // Barriers that just vanished can no longer clear these flags themselves,
    // so a mob standing in a removed slow zone would stay slowed forever.
    for (const mob of this.slowedLastFrame) {
      mob.slowedByBarrier = false;
    }
    this.slowedLastFrame.length = 0;
  }

  // Update

  update(ctx: SystemContext): void {
    for (const mob of this.slowedLastFrame) {
      mob.slowedByBarrier = false;
    }
    this.slowedLastFrame.length = 0;

    if (!this.pending && this.barriers.length === 0) return;

    const { grid: mobGrid } = ctx.roster;

    if (this.pending) {
      this.pending.framesLeft--;
      if (this.pending.framesLeft <= 0) {
        this.finishConstruct(this.pending);
        this.pending = null;
      }
    }

    for (const barrier of this.barriers) {
      const bwcx = barrier.worldX + TILE_SIZE * TILE_CENTER_FRACTION;
      const bwcy = barrier.worldY + TILE_SIZE * TILE_CENTER_FRACTION;
      // Mob centres are half a tile off their origins, so widen the query by
      // that much rather than missing a mob standing on the zone's edge.
      this.slowZoneQuery.clear();
      const nearBarrier = mobGrid.queryCircle(
        bwcx,
        bwcy,
        SLOW_RADIUS_PX + TILE_SIZE,
        this.slowZoneQuery,
      );
      for (const mob of nearBarrier) {
        if (!mob.isAlive) continue;
        const mcx = mob.x + TILE_SIZE * TILE_CENTER_FRACTION;
        const mcy = mob.y + TILE_SIZE * TILE_CENTER_FRACTION;
        if (mob.slowedByBarrier) continue;
        const dx = mcx - bwcx;
        const dy = mcy - bwcy;
        if (dx * dx + dy * dy < SLOW_RADIUS_PX * SLOW_RADIUS_PX) {
          mob.slowedByBarrier = true;
          this.slowedLastFrame.push(mob);
        }
      }
    }
  }

  private finishConstruct(c: PendingConstruct): void {
    const removed = c.player.inventory.removeOne(c.itemId);
    if (!removed) return; // Player lost the item before construction finished

    const ts = TILE_SIZE;
    const px = c.player.x + ts * TILE_CENTER_FRACTION;
    const py = c.player.y + ts * TILE_CENTER_FRACTION;
    const tileX = Math.floor(px / ts);
    const tileY = Math.floor(py / ts);

    const occupied = this.barriers.some((b) => b.tileX === tileX && b.tileY === tileY);
    if (occupied) {
      c.player.inventory.addItem(c.itemId, 1);
      return;
    }

    if (!this.gameMap.isWalkable(tileX, tileY)) {
      c.player.inventory.addItem(c.itemId, 1);
      return;
    }

    this.barriers.push({
      tileX,
      tileY,
      worldX: tileX * ts,
      worldY: tileY * ts,
      itemId: c.itemId,
      placer: c.player,
    });
  }

  /** Whether an interact press from `player` would reclaim the barrier under them. */
  wouldPickUp(player: Player): boolean {
    return player.isAlive && this.indexUnder(player) !== -1;
  }

  /**
   * Reclaims the barrier `player` is standing on, on an interact press.
   * Returns true if an item was reclaimed.
   */
  tryPickupNear(player: Player): boolean {
    if (!player.isAlive) return false;
    return this.reclaim(player, this.indexUnder(player));
  }

  /**
   * Reclaims the barrier at a tapped or clicked world point, when `player`
   * stands on it. Pointing at the piece says what the press is for, so this
   * holds even with a hostile in reach, where a bare press would swing.
   */
  tryPickupAt(worldX: number, worldY: number, player: Player): boolean {
    if (!player.isAlive) return false;
    const index = this.indexUnder(player);
    if (index === -1) return false;
    const barrier = this.barriers[index];
    const tappedOwnTile =
      Math.floor(worldX / TILE_SIZE) === barrier.tileX &&
      Math.floor(worldY / TILE_SIZE) === barrier.tileY;
    return tappedOwnTile && this.reclaim(player, index);
  }

  private indexUnder(player: Player): number {
    const ptx = Math.floor((player.x + TILE_SIZE * TILE_CENTER_FRACTION) / TILE_SIZE);
    const pty = Math.floor((player.y + TILE_SIZE * TILE_CENTER_FRACTION) / TILE_SIZE);
    return this.barriers.findIndex((b) => b.tileX === ptx && b.tileY === pty);
  }

  private reclaim(player: Player, index: number): boolean {
    if (index === -1) return false;
    player.inventory.addItem(this.barriers[index].itemId, 1);
    this.barriers.splice(index, 1);
    return true;
  }

  // Render

  /**
   * @param promptFor The crawler a "Pick up" prompt is offered to, or undefined
   *   while a press from them would not reach a barrier.
   */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, promptFor?: Player): void {
    const promptIndex = promptFor === undefined ? -1 : this.indexUnder(promptFor);
    this.barriers.forEach((b, index) => {
      const sx = b.worldX - camX;
      const sy = b.worldY - camY;

      switch (b.itemId) {
        case 'gym_dumbbell':
          drawDumbbellFloor(ctx, sx, sy, TILE_SIZE);
          break;
        case 'gym_bench_press':
          drawBenchPressFloor(ctx, sx, sy, TILE_SIZE);
          break;
        case 'gym_treadmill':
          drawTreadmillFloor(ctx, sx, sy, TILE_SIZE);
          break;
      }

      ctx.save();
      ctx.globalAlpha =
        SLOW_PULSE_ALPHA_BASE + SLOW_PULSE_ALPHA_RANGE * Math.sin(Date.now() * SLOW_PULSE_SPEED);
      ctx.strokeStyle = worldPalette.spell.barrierSlowZone;
      ctx.lineWidth = SLOW_RING_WIDTH;
      ctx.beginPath();
      ctx.arc(
        sx + TILE_SIZE * TILE_CENTER_FRACTION,
        sy + TILE_SIZE * TILE_CENTER_FRACTION,
        SLOW_RADIUS_PX,
        0,
        Math.PI * 2,
      );
      ctx.stroke();
      ctx.restore();

      if (index === promptIndex) {
        const artTop = b.itemId === 'gym_treadmill' ? treadmillFloorArtTop(sy, TILE_SIZE) : sy;
        drawInteractionPrompt(ctx, sx, artTop, TILE_SIZE, sy + TILE_SIZE, 'Pick up');
      }
    });
  }

  /**
   * Render the construct progress indicator around the player's feet.
   * Draw this on top of the HUD layer.
   */
  renderConstructUI(ctx: CanvasRenderingContext2D): void {
    if (!this.pending) return;

    const ratio = 1 - this.pending.framesLeft / CONSTRUCT_FRAMES;
    const cx = viewportWidth() * TILE_CENTER_FRACTION;
    const cy = viewportHeight() * TILE_CENTER_FRACTION;

    // Small progress arc near screen center (represents player's feet area)
    const radius = TILE_SIZE * CONSTRUCT_ARC_RADIUS_MULT;
    const startAngle = -Math.PI / 2;
    const endAngle = startAngle + Math.PI * 2 * ratio;

    ctx.save();
    ctx.globalAlpha = CONSTRUCT_TRACK_ALPHA;
    ctx.strokeStyle = worldPalette.spell.barrierTrack;
    ctx.lineWidth = CONSTRUCT_RING_WIDTH;
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.globalAlpha = CONSTRUCT_PROGRESS_ALPHA;
    ctx.strokeStyle = worldPalette.spell.barrierPlacing;
    ctx.lineWidth = CONSTRUCT_RING_WIDTH;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(cx, cy, radius, startAngle, endAngle);
    ctx.stroke();
    ctx.lineCap = 'butt';

    ctx.restore();

    worldText(ctx, 'PLACING...', {
      x: cx,
      y: cy + radius + CONSTRUCT_LABEL_Y_OFFSET - CONSTRUCT_LABEL_ADJUST,
      size: CONSTRUCT_LABEL_SIZE,
      bold: true,
      color: worldPalette.spell.barrierPlacing,
      align: 'center',
    });
  }
}
