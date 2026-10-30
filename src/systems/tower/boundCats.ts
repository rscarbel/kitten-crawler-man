/**
 * The town cats bound to the Warden's circle, as the cattery shows them while
 * the ritual stands: each sat rigid in front of her own pillar, in her own
 * look, so the party can see whose cat holds which pillar. Unbound, a cat
 * bolts for the stair down and waits there, out of the fight, until the
 * Warden falls and she can go home; the one the carrier lifts is the
 * carrier's to draw from the moment she leaves the floor.
 *
 * Moments, not state: the ritual builds these afresh whenever the fight
 * starts, from the cats the questline left bound.
 */

import { TILE_SIZE } from '../../core/constants';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import type { TownCatId } from '../../core/state/townCatIds';
import { findNearbyWalkableTile } from '../../map/findWalkableTile';
import type { GameMap } from '../../map/GameMap';
import { TOWER_BINDING_PILLARS } from '../../map/town/interiors/townCenterTower';
import type { TilePoint } from '../../map/town/townPlan';
import { worldPalette } from '../../ui/theme/worldInk';
import { TownCats, type TownCat } from '../critters/TownCats';
import type { WorldPoint } from '../critters/ScatterSwarm';
import { boundCatOrigin } from '../lichCarrierFlight';

const HALF = 0.5;
/** The ring on the pillar's iron band the tether runs from, down from the top of the pillar's tile. */
const TETHER_RING_TILES_DOWN = 0.45;
/** Her collar, down from the top of her own tile, sat upright. */
const COLLAR_TILES_DOWN = 0.5;
const TETHER_CORE_WIDTH_TILES = 0.04;
const TETHER_GLOW_WIDTH_TILES = 0.12;
/** The pool of ward light she sits in, round the middle of her tile. */
const HALO_RADIUS_TILES = 0.6;
const HALO_CENTRE_TILES_DOWN = 0.6;

/** How far round the stair the unbound cats spread out to wait, so no two settle on one spot. */
const REFUGE_SPREAD_TILES = 1.5;
const REFUGE_SEARCH_TILES = 2;

/** A cat in the room as the fight leaves her, for whoever walks her out. */
export interface CatInRoom {
  readonly id: TownCatId;
  readonly at: WorldPoint;
}

export class BoundCats {
  private readonly cats: TownCats;
  private readonly refuges: ReadonlyMap<TownCatId, TilePoint>;
  /** The tiles each bolting cat has still to cross, in order, round the pillars rather than into them. */
  private readonly routes = new Map<TownCatId, WorldPoint[]>();

  /** Sits each of `bound` at her pillar; once unbound she waits round `stair`, a tile of the stair down. */
  constructor(
    private readonly map: GameMap,
    bound: readonly TownCatId[],
    stair: TilePoint,
    random: () => number,
  ) {
    this.cats = new TownCats((x, y) => map.isWalkable(x, y, 'walker'), random);
    const refuges = new Map<TownCatId, TilePoint>();
    bound.forEach((id, index) => {
      const pillar = TOWER_BINDING_PILLARS[id];
      this.cats.placeBound(id, boundCatOrigin({ col: pillar.x, row: pillar.y }));
      refuges.set(id, refugeFor(map, stair, index, bound.length));
    });
    this.refuges = refuges;
  }

  /** The pillar's light has gone out: `id` is free, and bolts for the stair. */
  unbind(id: TownCatId): void {
    const cat = this.cats.cat(id);
    const refuge = this.refuges.get(id);
    if (cat === null || refuge === undefined || !cat.isBound) return;
    const from = tileUnder(cat);
    const [, ...route] = this.map
      .findPath(from.x, from.y, refuge.x, refuge.y, 'walker')
      .map((tile) => ({ x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE }));
    const first = route.shift() ?? { x: refuge.x * TILE_SIZE, y: refuge.y * TILE_SIZE };
    this.routes.set(id, route);
    this.cats.free(id, first);
  }

  /** The carrier has `id` off the floor: from now on she is drawn in its talons, not here. */
  carriedOff(id: TownCatId): void {
    this.cats.remove(id);
    this.routes.delete(id);
  }

  update(): void {
    this.cats.update();
    for (const [id, route] of this.routes) {
      const cat = this.cats.cat(id);
      if (cat === null || cat.isRunning) continue;
      const next = route.shift();
      if (next === undefined) this.routes.delete(id);
      else cat.runTo(next);
    }
  }

  /** Every cat still in the room and where she is, for the walk out once the Warden is gone. */
  inRoom(): readonly CatInRoom[] {
    return this.cats.cats.map((cat) => ({ id: cat.id, at: { x: cat.x, y: cat.y } }));
  }

  roomFigures(): InteriorFigure[] {
    return this.cats.cats.map((cat) => ({
      y: cat.y,
      render: (ctx, camX, camY, tileSize) => {
        if (!cat.isBound) {
          cat.draw(ctx, camX, camY, tileSize);
          return;
        }
        paintHalo(ctx, cat, camX, camY, tileSize);
        paintTether(ctx, cat, camX, camY, tileSize);
        cat.draw(ctx, camX, camY, tileSize);
      },
    }));
  }

  dispose(): void {
    this.cats.clear();
    this.routes.clear();
  }
}

/** The tile a cat stands on, read from the middle of her tile-sized body. */
function tileUnder(cat: TownCat): TilePoint {
  return {
    x: Math.floor((cat.x + TILE_SIZE * HALF) / TILE_SIZE),
    y: Math.floor((cat.y + TILE_SIZE * HALF) / TILE_SIZE),
  };
}

/** The `index`th of `count` tiles round the stair. */
function refugeFor(map: GameMap, stair: TilePoint, index: number, count: number): TilePoint {
  const angle = (index / Math.max(1, count)) * Math.PI * 2;
  const x = Math.round(stair.x + Math.cos(angle) * REFUGE_SPREAD_TILES);
  const y = Math.round(stair.y + Math.sin(angle) * REFUGE_SPREAD_TILES);
  return findNearbyWalkableTile(map, x, y, REFUGE_SEARCH_TILES) ?? stair;
}

function paintHalo(
  ctx: CanvasRenderingContext2D,
  cat: TownCat,
  camX: number,
  camY: number,
  tileSize: number,
): void {
  const x = cat.x - camX + tileSize * HALF;
  const y = cat.y - camY + tileSize * HALO_CENTRE_TILES_DOWN;
  const radius = tileSize * HALO_RADIUS_TILES;
  const halo = ctx.createRadialGradient(x, y, 0, x, y, radius);
  halo.addColorStop(0, worldPalette.binding.haloCore);
  halo.addColorStop(1, worldPalette.binding.haloFade);
  ctx.save();
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

/** The ward light run out from her pillar's ring to her collar, behind her: she faces the room, her back to the pillar. */
function paintTether(
  ctx: CanvasRenderingContext2D,
  cat: TownCat,
  camX: number,
  camY: number,
  tileSize: number,
): void {
  const pillar = TOWER_BINDING_PILLARS[cat.id];
  const ringX = (pillar.x + HALF) * tileSize - camX;
  const ringY = (pillar.y + TETHER_RING_TILES_DOWN) * tileSize - camY;
  const collarX = cat.x - camX + tileSize * HALF;
  const collarY = cat.y - camY + tileSize * COLLAR_TILES_DOWN;
  ctx.save();
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(ringX, ringY);
  ctx.lineTo(collarX, collarY);
  ctx.strokeStyle = worldPalette.binding.tetherGlow;
  ctx.lineWidth = tileSize * TETHER_GLOW_WIDTH_TILES;
  ctx.stroke();
  ctx.strokeStyle = worldPalette.binding.tetherCore;
  ctx.lineWidth = tileSize * TETHER_CORE_WIDTH_TILES;
  ctx.stroke();
  ctx.restore();
}
