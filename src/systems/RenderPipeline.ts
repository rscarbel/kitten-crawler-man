/**
 * RenderPipeline — organizes the dungeon scene's render passes into
 * discrete, named layers. Each layer receives a shared RenderContext
 * so the pipeline doesn't need to know about DungeonScene internals.
 *
 * Usage: create once, call `renderAll(ctx, context)` each frame.
 */

import { TILE_SIZE } from '../core/constants';
import { drawSpriteKey } from '../core/SpriteRenderer';
import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { GoreSystem } from './GoreSystem';
import type { BodyPartGoreSystem } from './BodyPartGoreSystem';
import type { SafeRoomSystem } from './SafeRoomSystem';
import type { BossRoomSystem } from './BossRoomSystem';
import type { JuicerRoomSystem } from './JuicerRoomSystem';
import type { ArenaRoomSystem } from './ArenaRoomSystem';
import type { StairwellSystem } from './StairwellSystem';
import type { BuildingSystem } from './BuildingSystem';
import type { BarrierSystem } from './BarrierSystem';
import type { SpellSystem } from './SpellSystem';
import type { DynamiteSystem } from './DynamiteSystem';
import type { LootSystem } from './LootSystem';
import type { MiniMapSystem } from './MiniMapSystem';
import type { MongoSystem } from './MongoSystem';
import type { PlayerManager } from '../core/PlayerManager';
import type { TreasureChest, TreasureChestSystem } from './TreasureChestSystem';
import type { Townsperson } from '../creatures/Townsperson';

/** Draw kind for decoration tiles. */
const DRAW_KIND_DECO = 0;

/** Draw kind for mobs. */
const DRAW_KIND_MOB = 1;

/** Draw kind for players. */
const DRAW_KIND_PLAYER = 2;

/** Draw kind for treasure chests. */
const DRAW_KIND_CHEST = 3;

/** Draw kind for ambient townsfolk (rendered like entities via their own render()). */
const DRAW_KIND_TOWNSPERSON = 4;

/** Tree depth offset to keep trees rendered behind entities. */
const TREE_SORT_DEPTH_OFFSET = 100000;

/** Y-sort offset to account for sprite foot position. */
const ENTITY_SORT_Y_OFFSET = TILE_SIZE;

/** Visibility inner radius in tiles. */
const VISIBILITY_INNER_TILES = 30;

/** Visibility outer radius in tiles. */
const VISIBILITY_OUTER_TILES = 35;

/** Frame index for tower balcony overlay. */
const TOWER_BALCONY_OVERLAY_FRAME = 4;

/** A Y-sorted draw entry that avoids per-frame closure allocation. */
interface DrawEntry {
  sortY: number;
  kind: number;
  tx: number;
  ty: number;
  entity: {
    render(ctx: CanvasRenderingContext2D, camX: number, camY: number, ts: number): void;
  } | null;
  chestRef: TreasureChest | null;
}

/** Everything the render pipeline needs, provided by the scene each frame. */
export interface RenderContext {
  canvas: HTMLCanvasElement;
  camX: number;
  camY: number;
  gameMap: GameMap;
  pm: PlayerManager;
  active: HumanPlayer | CatPlayer;
  inactive: HumanPlayer | CatPlayer;
  mobs: Mob[];
  mobGrid: SpatialGrid<Mob>;
  /** Ambient overworld citizens; empty/absent off the town map. */
  townsfolk?: ReadonlyArray<Townsperson>;
  gameOver: boolean;
  pauseMenuOpen: boolean;

  // Systems
  gore: GoreSystem;
  bodyPartGore: BodyPartGoreSystem;
  safeRoom: SafeRoomSystem;
  bossRoom: BossRoomSystem;
  juicerRoom: JuicerRoomSystem;
  arenaRoom: ArenaRoomSystem;
  stairwell: StairwellSystem;
  building: BuildingSystem | null;
  barriers: BarrierSystem;
  spells: SpellSystem;
  dynamite: DynamiteSystem;
  loot: LootSystem;
  treasureChests: TreasureChestSystem;
  miniMap: MiniMapSystem;
  mongoSystem: MongoSystem;

  // Pulse counters
  speechBubblePulse: number;
}

export class RenderPipeline {
  /** Reusable draw-entry pool to avoid per-frame allocations. */
  private _drawPool: DrawEntry[] = [];
  private _drawCount = 0;

  private _getEntry(): DrawEntry {
    if (this._drawCount < this._drawPool.length) {
      return this._drawPool[this._drawCount++];
    }
    const e: DrawEntry = { sortY: 0, kind: 0, tx: 0, ty: 0, entity: null, chestRef: null };
    this._drawPool.push(e);
    this._drawCount++;
    return e;
  }
  /**
   * Render the world layer: map tiles, gore puddles, room objects, door hints.
   */
  renderWorld(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
    const {
      canvas,
      camX,
      camY,
      gameMap,
      active,
      gore,
      safeRoom,
      bossRoom,
      juicerRoom,
      arenaRoom,
      stairwell,
      building,
      speechBubblePulse,
    } = rc;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    gameMap.renderCanvas(ctx, camX, camY, canvas.width, canvas.height);
    gore.renderPuddles(ctx, camX, camY);
    rc.bodyPartGore.renderSettled(ctx, camX, camY);

    safeRoom.renderObjects(ctx, camX, camY, active, speechBubblePulse);
    bossRoom.renderObjects(ctx, camX, camY);
    juicerRoom.render(ctx, camX, camY, active);
    arenaRoom.render(ctx, camX, camY, active);
    stairwell.renderStairwells(ctx, camX, camY, canvas);
    building?.renderDoorHints(ctx, camX, camY, canvas);
  }

  /**
   * Y-sorted draw pass: interleave decoration tiles, mobs, and players
   * so depth (north = behind, south = in front) is respected.
   */
  renderEntities(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
    const { canvas, camX, camY, gameMap, mobGrid, active, inactive, treasureChests, townsfolk } =
      rc;

    const visibleMobs = mobGrid.queryRect(
      camX - TILE_SIZE,
      camY - TILE_SIZE,
      canvas.width + TILE_SIZE * 2,
      canvas.height + TILE_SIZE * 2,
    );

    // Reset pool cursor (reuses existing objects)
    this._drawCount = 0;

    for (const { tx, ty, isTree, sortYAnchorPx } of gameMap.getVisibleDecorationTiles(
      camX,
      camY,
      canvas.width,
      canvas.height,
    )) {
      const e = this._getEntry();
      // Trees render before all entities (negative sortY) so entities stay on top.
      // Within the tree pass, ascending ty keeps south trees rendering last so
      // their canopies appear above north trees' trunks.
      // For other decorations, sort by the sprite's visual foot position derived
      // from manifest geometry (ty * TILE_SIZE + sortYAnchorPx).
      e.sortY = isTree ? ty - TREE_SORT_DEPTH_OFFSET : ty * TILE_SIZE + sortYAnchorPx;
      e.kind = DRAW_KIND_DECO;
      e.tx = tx;
      e.ty = ty;
      e.entity = null;
      e.chestRef = null;
    }

    // Chests are added before mobs/players so that at equal sortY the entity
    // (added later) sorts in front of the chest — stable sort preserves insertion order.
    for (const chest of treasureChests.allChests) {
      const e = this._getEntry();
      e.sortY = chest.tileY * TILE_SIZE + ENTITY_SORT_Y_OFFSET;
      e.kind = DRAW_KIND_CHEST;
      e.chestRef = chest;
      e.entity = null;
    }

    for (const mob of visibleMobs) {
      const e = this._getEntry();
      e.sortY = mob.y + ENTITY_SORT_Y_OFFSET;
      e.kind = DRAW_KIND_MOB;
      e.entity = mob;
      e.chestRef = null;
    }

    {
      const e = this._getEntry();
      e.sortY = inactive.y + ENTITY_SORT_Y_OFFSET;
      e.kind = DRAW_KIND_PLAYER;
      e.entity = inactive;
      e.chestRef = null;
    }
    {
      const e = this._getEntry();
      e.sortY = active.y + ENTITY_SORT_Y_OFFSET;
      e.kind = DRAW_KIND_PLAYER;
      e.entity = active;
      e.chestRef = null;
    }

    if (townsfolk !== undefined) {
      const minX = camX - TILE_SIZE;
      const minY = camY - TILE_SIZE;
      const maxX = camX + canvas.width + TILE_SIZE;
      const maxY = camY + canvas.height + TILE_SIZE;
      for (const person of townsfolk) {
        if (person.x < minX || person.x > maxX || person.y < minY || person.y > maxY) continue;
        const e = this._getEntry();
        e.sortY = person.y + ENTITY_SORT_Y_OFFSET;
        e.kind = DRAW_KIND_TOWNSPERSON;
        e.entity = person;
        e.chestRef = null;
      }
    }

    // Sort only the active portion of the pool
    const items = this._drawPool;
    const count = this._drawCount;
    // In-place sort of items[0..count)
    items.length = count;
    items.sort((a, b) => a.sortY - b.sortY);

    for (let i = 0; i < count; i++) {
      const item = items[i];
      if (item.kind === DRAW_KIND_DECO) {
        gameMap.drawDecorationAt(ctx, item.tx, item.ty, camX, camY);
      } else if (item.kind === DRAW_KIND_CHEST) {
        const chest = item.chestRef;
        if (chest !== null) {
          treasureChests.renderSingle(ctx, camX, camY, active, chest);
        }
      } else {
        item.entity?.render(ctx, camX, camY, TILE_SIZE);
      }
    }
  }

  /**
   * Render visual effects that appear above entities: gore particles,
   * barriers, spells, level-up flash, dynamite, speech bubbles.
   */
  renderEffects(
    ctx: CanvasRenderingContext2D,
    rc: RenderContext,
    renderLevelUpFlash: (ctx: CanvasRenderingContext2D, camX: number, camY: number) => void,
  ): void {
    const { camX, camY, gore, bodyPartGore, barriers, spells, dynamite, mongoSystem, active, pm } =
      rc;

    gore.renderParticles(ctx, camX, camY);
    bodyPartGore.renderFlying(ctx, camX, camY);
    barriers.render(ctx, camX, camY, active);
    spells.renderShell(ctx, camX, camY);
    spells.renderCatMiniShell(ctx, camX, camY, pm.cat);
    spells.renderChainLightning(ctx, camX, camY);
    spells.renderShockwaveRipples(ctx, camX, camY);
    spells.renderFogs(ctx, camX, camY);
    renderLevelUpFlash(ctx, camX, camY);
    dynamite.render(ctx, camX, camY);
    dynamite.renderThrowPath(ctx, camX, camY, pm.human);

    // Cat speech bubble for Mongo summon/recall
    mongoSystem.renderSpeechBubble(ctx, pm.cat.x - camX, pm.cat.y - camY);
  }

  /**
   * Radial fog that blacks out everything beyond VISIBILITY_OUTER_TILES from the
   * active player. Defeats the browser-zoom exploit without affecting normal play.
   */
  renderVisibilityFog(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
    const { canvas, camX, camY, active } = rc;

    const innerR = VISIBILITY_INNER_TILES * TILE_SIZE;
    const outerR = VISIBILITY_OUTER_TILES * TILE_SIZE;

    // Skip the (cheap) gradient if the whole canvas fits inside the clear zone.
    const halfDiag = Math.hypot(canvas.width / 2, canvas.height / 2);
    if (halfDiag <= innerR) return;

    const cx = active.x + TILE_SIZE / 2 - camX;
    const cy = active.y + TILE_SIZE / 2 - camY;

    const grad = ctx.createRadialGradient(cx, cy, innerR, cx, cy, outerR);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
  }

  /**
   * Draws the tower balcony railing overlay on top of the Y-sorted entity pass.
   * This keeps the railing in front of any entity standing on a balcony.
   */
  renderTowerBalconyOverlay(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
    const { camX, camY, gameMap } = rc;
    const anchor = gameMap.mainTowerAnchor;
    if (!anchor) return;
    const sx = anchor.x * TILE_SIZE - camX;
    const sy = anchor.y * TILE_SIZE - camY;
    // Frame 4 of the 'normal' state is the undamaged balcony railing overlay
    drawSpriteKey(
      ctx,
      'overworld_main_tower',
      'normal',
      TOWER_BALCONY_OVERLAY_FRAME,
      sx,
      sy,
      TILE_SIZE,
    );
  }
}
