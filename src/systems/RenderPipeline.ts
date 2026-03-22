/**
 * RenderPipeline — organizes the dungeon scene's render passes into
 * discrete, named layers. Each layer receives a shared RenderContext
 * so the pipeline doesn't need to know about DungeonScene internals.
 *
 * Usage: create once, call `renderAll(ctx, context)` each frame.
 */

import { TILE_SIZE } from '../core/constants';
import type { GameMap } from '../map/GameMap';
import type { Mob } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { GoreSystem } from './GoreSystem';
import type { SafeRoomSystem } from './SafeRoomSystem';
import type { BossRoomSystem } from './BossRoomSystem';
import type { JuicerRoomSystem } from './JuicerRoomSystem';
import type { StairwellSystem } from './StairwellSystem';
import type { BuildingSystem } from './BuildingSystem';
import type { BarrierSystem } from './BarrierSystem';
import type { SpellSystem } from './SpellSystem';
import type { DynamiteSystem } from './DynamiteSystem';
import type { LootSystem } from './LootSystem';
import type { MiniMapSystem } from './MiniMapSystem';
import type { MongoSystem } from './MongoSystem';
import type { PlayerManager } from '../core/PlayerManager';

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
  gameOver: boolean;
  pauseMenuOpen: boolean;

  // Systems
  gore: GoreSystem;
  safeRoom: SafeRoomSystem;
  bossRoom: BossRoomSystem;
  juicerRoom: JuicerRoomSystem;
  stairwell: StairwellSystem;
  building: BuildingSystem | null;
  barriers: BarrierSystem;
  spells: SpellSystem;
  dynamite: DynamiteSystem;
  loot: LootSystem;
  miniMap: MiniMapSystem;
  mongoSystem: MongoSystem;

  // Pulse counters
  speechBubblePulse: number;
}

export class RenderPipeline {
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
      stairwell,
      building,
      speechBubblePulse,
    } = rc;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    gameMap.renderCanvas(ctx, camX, camY, canvas.width, canvas.height);
    gore.renderPuddles(ctx, camX, camY);

    safeRoom.renderObjects(ctx, camX, camY, active, speechBubblePulse);
    bossRoom.renderObjects(ctx, camX, camY);
    juicerRoom.render(ctx, camX, camY, active);
    stairwell.renderStairwells(ctx, camX, camY, canvas);
    building?.renderDoorHints(ctx, camX, camY, canvas);
  }

  /**
   * Y-sorted draw pass: interleave decoration tiles, mobs, and players
   * so depth (north = behind, south = in front) is respected.
   */
  renderEntities(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
    const { canvas, camX, camY, gameMap, mobGrid, active, inactive } = rc;

    const visibleMobs = mobGrid.queryRect(
      camX - TILE_SIZE,
      camY - TILE_SIZE,
      canvas.width + TILE_SIZE * 2,
      canvas.height + TILE_SIZE * 2,
    );

    type DrawItem = { sortY: number; draw: () => void };
    const drawItems: DrawItem[] = [];

    for (const { tx, ty } of gameMap.getVisibleDecorationTiles(
      camX,
      camY,
      canvas.width,
      canvas.height,
    )) {
      const capTx = tx;
      const capTy = ty;
      drawItems.push({
        sortY: (capTy + 1) * TILE_SIZE,
        draw: () => gameMap.drawDecorationAt(ctx, capTx, capTy, camX, camY),
      });
    }

    for (const mob of visibleMobs) {
      const m = mob;
      drawItems.push({
        sortY: m.y + TILE_SIZE,
        draw: () => m.render(ctx, camX, camY, TILE_SIZE),
      });
    }

    drawItems.push({
      sortY: inactive.y + TILE_SIZE,
      draw: () => inactive.render(ctx, camX, camY, TILE_SIZE),
    });
    drawItems.push({
      sortY: active.y + TILE_SIZE,
      draw: () => active.render(ctx, camX, camY, TILE_SIZE),
    });

    drawItems.sort((a, b) => a.sortY - b.sortY);
    for (const item of drawItems) item.draw();
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
    const { camX, camY, gore, barriers, spells, dynamite, mongoSystem, active, pm } = rc;

    gore.renderParticles(ctx, camX, camY);
    barriers.render(ctx, camX, camY, active);
    spells.renderShell(ctx, camX, camY);
    spells.renderFogs(ctx, camX, camY);
    renderLevelUpFlash(ctx, camX, camY);
    dynamite.render(ctx, camX, camY);

    // Cat speech bubble for Mongo summon/recall
    mongoSystem.renderSpeechBubble(ctx, pm.cat.x - camX, pm.cat.y - camY);
  }
}
