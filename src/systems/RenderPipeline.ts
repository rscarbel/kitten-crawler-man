/**
 * RenderPipeline — organizes the dungeon scene's render passes into
 * discrete, named layers. Each layer receives a shared RenderContext
 * so the pipeline doesn't need to know about DungeonScene internals.
 *
 * Usage: create once, call `renderAll(ctx, context)` each frame.
 */

import { MAX_MOB_CULL_MARGIN_TILES, TILE_SIZE } from '../core/constants';
import { nightVisionBonusTiles } from '../core/SkillManager';
import { drawSpriteKey } from '../core/SpriteRenderer';
import { allocCanvas, surfaceContext, type CanvasSurface } from '../core/canvasSurface';
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
import type { SmushEffectSystem } from './SmushEffectSystem';
import type { LavaBallSystem } from './LavaBallSystem';
import type { RockThrowSystem } from './RockThrowSystem';
import type { SkeletonProjectileSystem } from './SkeletonProjectileSystem';
import type { ClownGasSystem } from './ClownGasSystem';
import type { KnightMissileSystem } from './KnightMissileSystem';
import type { DestructiblePropSystem } from './DestructiblePropSystem';
import type { TreeSystem } from './TreeSystem';
import type { WaterAnimationSystem } from './WaterAnimationSystem';
import type { LootSystem } from './LootSystem';
import type { MiniMapSystem } from './MiniMapSystem';
import type { MongoSystem } from './MongoSystem';
import type { PlayerManager } from '../core/PlayerManager';
import type { TreasureChest, TreasureChestSystem } from './TreasureChestSystem';
import type { Townsperson } from '../creatures/Townsperson';
import type { TownPropRenderable } from './townPropRenderable';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { isStandingInWater } from './GameLoopPhases';

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

/** Draw kind for interactive town props (notice board, etc.), rendered via their own render(). */
const DRAW_KIND_TOWN_PROP = 5;

/** Draw kind for a safe room's Mordecai, rendered via his own render(). */
const DRAW_KIND_SAFE_ROOM_NPC = 6;

/** Halfway across a tile — where a crawler's centre line sits. */
const TILE_CENTRE_FRACTION = 0.5;

/** Y-sort offset to account for sprite foot position. */
const ENTITY_SORT_Y_OFFSET = TILE_SIZE;

/**
 * Town props are billboards anchored by one corner but drawn well outside their
 * own tile — a market stall is two tiles wide and its canopy rises three tiles
 * above its Y-sort edge. A one-tile margin would pop those off at the screen
 * edge while part of them was still visible.
 */
const PROP_CULL_MARGIN_TILES = 4;
const PROP_CULL_MARGIN = TILE_SIZE * PROP_CULL_MARGIN_TILES;

/**
 * Mobs are culled by the tile they stand on, but the big ones are drawn far
 * outside it — Signet's ink summons reach nearly three tiles up and to either
 * side. A one-tile margin popped those in at the screen edge with part of them
 * still due on screen.
 *
 * The spatial query has to use the widest margin any mob could need, since a mob
 * it never returns cannot ask for more; each mob is then re-tested against its
 * own `cullMarginTiles` so an ordinary rat four tiles out is still dropped
 * before it costs a sort entry and a draw.
 */
const MOB_QUERY_MARGIN = TILE_SIZE * MAX_MOB_CULL_MARGIN_TILES;

/** Colour of the fully fogged area outside the falloff disc. */
const FOG_SOLID_COLOR = 'rgba(0,0,0,1)';

/** Visibility inner radius in tiles, before any Night Vision bonus. */
const VISIBILITY_INNER_TILES = 30;

/** Visibility outer radius in tiles, before any Night Vision bonus. */
const VISIBILITY_OUTER_TILES = 35;

/** Frame index for tower balcony overlay. */
const TOWER_BALCONY_OVERLAY_FRAME = 4;

/** Extra fog radius the active crawler's Night Vision is worth, in tiles. */
function nightVisionBonusFor(active: HumanPlayer | CatPlayer): number {
  const level = active.skills.getLevel('night_vision');
  return level === 0 ? 0 : nightVisionBonusTiles(level);
}

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
  /**
   * Screen y of the river surface across this entry's sprite, or `null` when it
   * is not standing in water.
   *
   * Carried on the entry rather than recomputed in the draw loop because the
   * loop has only the minimal `render`-shaped entity — resolving it there would
   * need a cast back to `Player`, and the two places that push players already
   * hold the typed instance.
   */
  waterlineScreenY: number | null;
  /** Screen x of the wader's centre; only meaningful when wading. */
  waterlineScreenX: number;
}

/** Everything the render pipeline needs, provided by the scene each frame. */
export interface RenderContext {
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
  /** Interactive town props (notice board, etc.); empty/absent off the town map. */
  townProps?: ReadonlyArray<TownPropRenderable>;
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
  smushFx: SmushEffectSystem;
  lavaBalls: LavaBallSystem;
  rockThrows: RockThrowSystem;
  skeletonShots: SkeletonProjectileSystem;
  clownGas: ClownGasSystem;
  knightMissiles: KnightMissileSystem;
  /** Null on maps without smashable props (the overworld, building interiors). */
  destructibles: DestructiblePropSystem | null;
  /** Null on every map but the overworld, which is the only one that grows trees. */
  trees: TreeSystem | null;
  /** Null on every map but the overworld, which is the only one with rivers. */
  water: WaterAnimationSystem | null;
  loot: LootSystem;
  treasureChests: TreasureChestSystem;
  miniMap: MiniMapSystem;
  mongoSystem: MongoSystem;

  // Pulse counters
  speechBubblePulse: number;
}

export class RenderPipeline {
  /** Baked visibility-fog falloff disc, rebuilt only if the radii change. */
  private _fogDisc: CanvasSurface | null = null;
  private _fogDiscInnerR = 0;
  private _fogDiscOuterR = 0;

  /** Reusable draw-entry pool to avoid per-frame allocations. */
  private _drawPool: DrawEntry[] = [];
  private _drawCount = 0;

  private _getEntry(): DrawEntry {
    if (this._drawCount < this._drawPool.length) {
      const pooled = this._drawPool[this._drawCount++];
      // Cleared here, not at the push sites. Every other field is assigned by
      // all of them, but only the two player pushes know about a waterline — a
      // pooled entry that last held a wading player would otherwise hand a stale
      // clip to whatever decoration or mob reused the slot.
      pooled.waterlineScreenY = null;
      return pooled;
    }
    const e: DrawEntry = {
      sortY: 0,
      kind: 0,
      tx: 0,
      ty: 0,
      entity: null,
      chestRef: null,
      waterlineScreenY: null,
      waterlineScreenX: 0,
    };
    this._drawPool.push(e);
    this._drawCount++;
    return e;
  }
  /**
   * Render the world layer: map tiles, gore puddles, room objects, door hints.
   */
  renderWorld(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
    const {
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
    } = rc;

    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, viewportWidth(), viewportHeight());

    gameMap.renderCanvas(ctx, camX, camY, viewportWidth(), viewportHeight());
    gore.renderPuddles(ctx, camX, camY);
    rc.bodyPartGore.renderSettled(ctx, camX, camY);
    rc.destructibles?.renderWreckage(ctx, camX, camY);
    rc.trees?.renderGround(ctx, camX, camY);
    // Same slot as the trees, and for the same reason: the river's moving parts
    // belong over the chunk-baked ground and under the Y-sorted pass, so the
    // player wades in front of the highlights rather than beneath them.
    rc.water?.renderGround(ctx, camX, camY);
    // Under the Y-sorted pass with the trees and the river: a fire patch is
    // burning floor, and drawn above the entities it would cover the very
    // player it is burning.
    rc.lavaBalls.renderGround(ctx, camX, camY);
    rc.clownGas.renderGround(ctx, camX, camY);

    safeRoom.renderObjects(ctx, camX, camY, active);
    bossRoom.renderObjects(ctx, camX, camY);
    juicerRoom.render(ctx, camX, camY, active);
    arenaRoom.render(ctx, camX, camY, active);
    stairwell.renderStairwells(ctx, camX, camY);
    building?.renderDoorHints(ctx, camX, camY);
  }

  /**
   * Y-sorted draw pass: interleave decoration tiles, mobs, and players
   * so depth (north = behind, south = in front) is respected.
   */
  renderEntities(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
    const {
      camX,
      camY,
      gameMap,
      mobGrid,
      active,
      inactive,
      treasureChests,
      townsfolk,
      townProps,
      safeRoom,
      speechBubblePulse,
    } = rc;

    const visibleMobs = mobGrid.queryRect(
      camX - MOB_QUERY_MARGIN,
      camY - MOB_QUERY_MARGIN,
      viewportWidth() + MOB_QUERY_MARGIN * 2,
      viewportHeight() + MOB_QUERY_MARGIN * 2,
    );

    // Reset pool cursor (reuses existing objects)
    this._drawCount = 0;

    for (const { tx, ty, sortYAnchorPx } of gameMap.getVisibleDecorationTiles(
      camX,
      camY,
      viewportWidth(),
      viewportHeight(),
    )) {
      const e = this._getEntry();
      // Sort by the sprite's visual foot position, derived from manifest
      // geometry. Trees used to be special-cased to a large negative key, which
      // put every tree behind every entity — the player walked in front of a
      // tree they were standing north of. They now sort on their foot like
      // everything else, which is only correct because `tree_oak_a` declares
      // `tileTypeId` and so has a real anchor to sort on.
      e.sortY = ty * TILE_SIZE + sortYAnchorPx;
      e.kind = DRAW_KIND_DECO;
      e.tx = tx;
      e.ty = ty;
      e.entity = null;
      e.chestRef = null;
    }

    // Chests are added before mobs/players so that at equal sortY the entity
    // (added later) sorts in front of the chest — stable sort preserves insertion order.
    const viewMinX = camX - TILE_SIZE;
    const viewMinY = camY - TILE_SIZE;
    const viewMaxX = camX + viewportWidth() + TILE_SIZE;
    const viewMaxY = camY + viewportHeight() + TILE_SIZE;

    for (const chest of treasureChests.allChests) {
      const chestX = chest.tileX * TILE_SIZE;
      const chestY = chest.tileY * TILE_SIZE;
      if (chestX < viewMinX || chestX > viewMaxX || chestY < viewMinY || chestY > viewMaxY)
        continue;
      const e = this._getEntry();
      e.sortY = chest.tileY * TILE_SIZE + ENTITY_SORT_Y_OFFSET;
      e.kind = DRAW_KIND_CHEST;
      e.chestRef = chest;
      e.entity = null;
    }

    for (const mob of visibleMobs) {
      const margin = TILE_SIZE * mob.cullMarginTiles;
      if (
        mob.x < camX - margin ||
        mob.x > camX + viewportWidth() + margin ||
        mob.y < camY - margin ||
        mob.y > camY + viewportHeight() + margin
      ) {
        continue;
      }
      const e = this._getEntry();
      e.sortY = mob.y + ENTITY_SORT_Y_OFFSET;
      e.kind = DRAW_KIND_MOB;
      e.entity = mob;
      e.chestRef = null;
      // Mobs wade too, and a mob drawn whole while standing mid-river reads as
      // walking *on* the water — more obviously wrong than the player would,
      // because there are several of them and they cross at odd angles.
      if (mob.isWading()) {
        e.waterlineScreenY = mob.y + TILE_SIZE - mob.waterlineAboveFootPx - camY;
        e.waterlineScreenX = mob.x + TILE_SIZE * TILE_CENTRE_FRACTION - camX;
      }
    }

    for (const player of [inactive, active]) {
      const e = this._getEntry();
      e.sortY = player.y + ENTITY_SORT_Y_OFFSET;
      e.kind = DRAW_KIND_PLAYER;
      e.entity = player;
      e.chestRef = null;
      e.waterlineScreenY = isStandingInWater(player, gameMap)
        ? player.y + TILE_SIZE - player.waterlineAboveFootPx - camY
        : null;
      e.waterlineScreenX = player.x + TILE_SIZE * TILE_CENTRE_FRACTION - camX;
    }

    // Mordecai sorts with the crawlers rather than with the room he stands in:
    // the Bopca's counter is repainted after the world pass, so anything drawn
    // there ends up behind it.
    for (const figure of safeRoom.sortedRenderables(active, speechBubblePulse)) {
      const e = this._getEntry();
      e.sortY = figure.y + ENTITY_SORT_Y_OFFSET;
      e.kind = DRAW_KIND_SAFE_ROOM_NPC;
      e.entity = figure;
      e.chestRef = null;
    }

    if (townsfolk !== undefined) {
      for (const person of townsfolk) {
        if (
          person.x < viewMinX ||
          person.x > viewMaxX ||
          person.y < viewMinY ||
          person.y > viewMaxY
        )
          continue;
        const e = this._getEntry();
        e.sortY = person.y + ENTITY_SORT_Y_OFFSET;
        e.kind = DRAW_KIND_TOWNSPERSON;
        e.entity = person;
        e.chestRef = null;
      }
    }

    if (townProps !== undefined) {
      for (const prop of townProps) {
        // Per-prop, because the props differ by an order of magnitude in reach:
        // a shop sign is half a tile wide and a bunting span is sixteen.
        const margin =
          prop.cullMarginTiles === undefined ? PROP_CULL_MARGIN : TILE_SIZE * prop.cullMarginTiles;
        const minX = camX - margin;
        const minY = camY - margin;
        const maxX = camX + viewportWidth() + margin;
        const maxY = camY + viewportHeight() + margin;
        if (prop.x < minX || prop.x > maxX || prop.y < minY || prop.y > maxY) continue;
        const e = this._getEntry();
        e.sortY = prop.y + ENTITY_SORT_Y_OFFSET;
        e.kind = DRAW_KIND_TOWN_PROP;
        e.entity = prop;
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
      } else if (item.waterlineScreenY !== null) {
        // Wading: clip the body off at the surface and cap the cut with a
        // meniscus, so the crawler is *in* the river rather than standing on it.
        const waterlineScreenY = item.waterlineScreenY;
        ctx.save();
        ctx.beginPath();
        ctx.rect(0, 0, viewportWidth(), waterlineScreenY);
        ctx.clip();
        item.entity?.render(ctx, camX, camY, TILE_SIZE);
        ctx.restore();
        rc.water?.renderWaterline(ctx, item.waterlineScreenX, waterlineScreenY);
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
    // Droplets go over the entities: water thrown up by a crawler stepping into
    // the river passes in front of the body that threw it. Everything else the
    // water system draws is surface, and stays under them in `renderGround`.
    rc.water?.renderSplashes(ctx, camX, camY);
    rc.destructibles?.renderEffects(ctx, camX, camY);
    rc.trees?.render(ctx, camX, camY);
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
    // Over the entities: a ball crossing the room must never disappear behind
    // the mob it is about to fly past, or the shot reads as having fizzled.
    rc.lavaBalls.render(ctx, camX, camY);
    // Same slot and the same reason for the golem's thrown boulders.
    rc.rockThrows.render(ctx, camX, camY);
    // Same slot and the same reason: a bolt crossing the fight must never vanish
    // behind the skeleton it is about to fly past.
    rc.skeletonShots.render(ctx, camX, camY);
    rc.clownGas.render(ctx, camX, camY);
    rc.knightMissiles.render(ctx, camX, camY);
    // Last of the world effects: the stamp's fire reads as being in front of
    // everything it just hit.
    rc.smushFx.render(ctx, camX, camY);

    // Cat speech bubble for Mongo summon/recall
    mongoSystem.renderSpeechBubble(ctx, pm.cat.x - camX, pm.cat.y - camY);
  }

  /**
   * Radial fog that blacks out everything beyond VISIBILITY_OUTER_TILES from the
   * active player. Defeats the browser-zoom exploit without affecting normal play.
   */
  renderVisibilityFog(ctx: CanvasRenderingContext2D, rc: RenderContext): void {
    const { camX, camY, active } = rc;

    // Night Vision widens both radii for whoever is leading. The baked falloff
    // disc is keyed on the radii, so it simply rebuilds when the pair changes.
    const bonusTiles = nightVisionBonusFor(active);
    const innerR = (VISIBILITY_INNER_TILES + bonusTiles) * TILE_SIZE;
    const outerR = (VISIBILITY_OUTER_TILES + bonusTiles) * TILE_SIZE;

    // Skip the (cheap) gradient if the whole canvas fits inside the clear zone.
    const halfDiag = Math.hypot(viewportWidth() / 2, viewportHeight() / 2);
    if (halfDiag <= innerR) return;

    const cx = active.x + TILE_SIZE / 2 - camX;
    const cy = active.y + TILE_SIZE / 2 - camY;

    // The gradient depends only on the two radii, so it is baked once into a
    // disc and blitted; everything outside the disc is solid black anyway.
    const disc = this.visibilityFogDisc(innerR, outerR);
    const discLeft = cx - outerR;
    const discTop = cy - outerR;
    ctx.drawImage(disc, discLeft, discTop);

    ctx.fillStyle = FOG_SOLID_COLOR;
    const discRight = discLeft + disc.width;
    const discBottom = discTop + disc.height;
    ctx.fillRect(0, 0, viewportWidth(), Math.max(0, discTop));
    ctx.fillRect(0, discBottom, viewportWidth(), Math.max(0, viewportHeight() - discBottom));
    const bandTop = Math.max(0, discTop);
    const bandHeight = Math.max(0, Math.min(viewportHeight(), discBottom) - bandTop);
    ctx.fillRect(0, bandTop, Math.max(0, discLeft), bandHeight);
    ctx.fillRect(discRight, bandTop, Math.max(0, viewportWidth() - discRight), bandHeight);
  }

  /** Lazily bakes (and caches) the fog's radial falloff disc for the given radii. */
  private visibilityFogDisc(innerR: number, outerR: number): CanvasSurface {
    const cached = this._fogDisc;
    if (cached && this._fogDiscInnerR === innerR && this._fogDiscOuterR === outerR) return cached;

    const size = Math.ceil(outerR * 2);
    const disc = allocCanvas(size, size);
    const dctx = surfaceContext(disc);
    const centre = size / 2;
    const grad = dctx.createRadialGradient(centre, centre, innerR, centre, centre, outerR);
    grad.addColorStop(0, 'rgba(0,0,0,0)');
    grad.addColorStop(1, 'rgba(0,0,0,1)');
    dctx.fillStyle = grad;
    dctx.fillRect(0, 0, size, size);

    this._fogDisc = disc;
    this._fogDiscInnerR = innerR;
    this._fogDiscOuterR = outerR;
    return disc;
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
