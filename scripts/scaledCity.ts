/**
 * A synthetic city several times floor 3's, for measuring residency where a
 * city is wider than any hold distance and holds more people and buildings
 * than one figure or sheet budget can.
 *
 * The town layout is an authored plan with no size parameter, so the city is
 * built from the real generator instead of a scaled one: a grid of blocks, each
 * a real overworld `GameMap` generated from its own world seed, whose town is
 * set down at the block's offset. Each block's crowd is the real
 * `TownLifeSystem` for that map plus its real `MarketSystem` vendors, the
 * people the overworld scene's residency decides for, so the cast and its
 * looks are the game's own. Building it queues and pins nothing: a residency
 * deciding for its citizens does that, as in the game. A citizen is reported
 * at its block's offset.
 * Each block's buildings are its town plan's, at the same offset.
 *
 * Every block draws the same painted facade sheets, because the facade art is
 * keyed by building, not by place. Each building also
 * carries a `distinctSheetId` unique to its block, for measuring a city whose
 * every block had art of its own, which is what a larger floor would bring.
 *
 * Citizens stand where the crowd was rolled; nothing here moves them.
 *
 * Import only after the browser shim is installed.
 */

import { TILE_SIZE } from '../src/core/constants.js';
import { level3 } from '../src/levels/level3.js';
import { GameMap } from '../src/map/GameMap.js';
import type { TilePoint, TileRect, TownPlan } from '../src/map/town/townPlan.js';
import { getSpriteFootprintByKey } from '../src/core/spriteAssets/SpriteLoader.js';
import { TownLifeSystem } from '../src/systems/TownLifeSystem.js';
import { MarketSystem } from '../src/systems/market/MarketSystem.js';
import { createShopStock } from '../src/economy/shopStock.js';
import type { ResidencyCitizen } from '../src/systems/CrowdResidentSet.js';
import type { ResidencyFocus } from '../src/systems/WorldResidency.js';
import type { Townsperson } from '../src/creatures/Townsperson.js';
import type { CitizenFigure } from '../src/creatures/citizenFigure.js';

/** Blocks along each side by default: nine copies of floor 3's town. */
export const DEFAULT_BLOCKS_PER_SIDE = 3;
/** The first block's world seed; later blocks count up from it. */
const DEFAULT_FIRST_SEED = 1;
/** Open ground between two blocks' walls, so neighbouring towns never overlap. */
const BLOCK_GAP_TILES = 8;

/** Tiles from one block's origin to the next, across and down. */
interface BlockSpan {
  readonly w: number;
  readonly h: number;
}

/** The first block's spacing and wall, which every later block is laid out against. */
interface BlockGrid {
  readonly span: BlockSpan;
  readonly anchor: TileRect;
}

export interface ScaledCityOptions {
  readonly blocksPerSide: number;
  readonly firstSeed?: number;
}

export interface ScaledCityBlock {
  readonly index: number;
  readonly gameMap: GameMap;
  readonly plan: TownPlan;
  /** Tiles from the city's origin (block 0's map origin) to this block's map origin. */
  readonly offsetTiles: TilePoint;
  /** Position in the grid, west to east and north to south. */
  readonly column: number;
  readonly row: number;
  readonly townLife: TownLifeSystem;
  readonly market: MarketSystem;
}

/** A citizen of one block, reported in city coordinates. */
export class ScaledCityCitizen implements ResidencyCitizen {
  constructor(
    readonly person: Townsperson,
    readonly block: number,
    private readonly offsetPx: TilePoint,
  ) {}

  get x(): number {
    return this.person.x + this.offsetPx.x;
  }

  get y(): number {
    return this.person.y + this.offsetPx.y;
  }

  get figure(): CitizenFigure {
    return this.person.figure;
  }

  /** Draws the citizen through its real render path, against a camera in city coordinates. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.person.render(ctx, camX - this.offsetPx.x, camY - this.offsetPx.y, TILE_SIZE);
  }
}

export interface ScaledCityBuilding {
  readonly block: number;
  /** The painted facade sheet this building draws, shared by every block. */
  readonly sheetKey: string;
  /** Unique per block: the sheet this building would need if each block's art were its own. */
  readonly distinctSheetId: string;
  /** The building's plot, in city tiles. */
  readonly area: TileRect;
}

export interface ScaledCity {
  readonly blocksPerSide: number;
  readonly blocks: readonly ScaledCityBlock[];
  readonly citizens: readonly ScaledCityCitizen[];
  readonly buildings: readonly ScaledCityBuilding[];
  /** Every block's wall ring, in city tiles. */
  readonly bounds: TileRect;
  /** A walk across the city through its middle row of plazas, west edge to east edge, in city tiles. */
  readonly crossing: readonly TilePoint[];
}

function translated(rect: TileRect, by: TilePoint): TileRect {
  return { x: rect.x + by.x, y: rect.y + by.y, w: rect.w, h: rect.h };
}

function blockBuildings(block: ScaledCityBlock): ScaledCityBuilding[] {
  const { plan, offsetTiles } = block;
  return plan.buildings.flatMap((building) => {
    const footprint = getSpriteFootprintByKey(building.spriteKey);
    if (footprint === undefined) return [];
    const plot: TileRect = {
      x: plan.centre.x + building.west,
      y: plan.centre.y + building.plotTop,
      w: footprint.w,
      h: building.frontRow - building.plotTop + 1,
    };
    return [
      {
        block: block.index,
        sheetKey: building.spriteKey,
        distinctSheetId: `${building.spriteKey}@block${block.index}`,
        area: translated(plot, offsetTiles),
      },
    ];
  });
}

/** The focus of a camera centred on a city tile. */
export function cityFocus(tile: TilePoint): ResidencyFocus {
  return { x: tile.x * TILE_SIZE, y: tile.y * TILE_SIZE };
}

/**
 * Builds the city. Each block costs a full overworld generation, so a large
 * grid takes a while; nothing is painted, queued or baked here.
 */
export function buildScaledCity(options: ScaledCityOptions): ScaledCity {
  if (!Number.isInteger(options.blocksPerSide) || options.blocksPerSide < 1) {
    throw new Error(`a city needs at least one block per side, not ${options.blocksPerSide}`);
  }
  const firstSeed = options.firstSeed ?? DEFAULT_FIRST_SEED;
  const blocks: ScaledCityBlock[] = [];
  let grid: BlockGrid | null = null;
  for (let index = 0; index < options.blocksPerSide * options.blocksPerSide; index++) {
    const gameMap = new GameMap({
      mapSize: level3.mapSize,
      tileHeight: TILE_SIZE,
      mapType: 'overworld',
      worldSeed: firstSeed + index,
    });
    const plan = gameMap.townPlan;
    if (plan === undefined) throw new Error(`seed ${firstSeed + index} has no town`);
    // Every map centres its town alike, but measured rather than assumed, so a
    // block whose generator placed the town elsewhere still lines up.
    const layout: BlockGrid = grid ?? {
      span: { w: plan.wall.w + BLOCK_GAP_TILES, h: plan.wall.h + BLOCK_GAP_TILES },
      anchor: plan.wall,
    };
    grid = layout;
    const { span, anchor } = layout;
    const column = index % options.blocksPerSide;
    const row = Math.floor(index / options.blocksPerSide);
    const offsetTiles = {
      x: column * span.w + anchor.x - plan.wall.x,
      y: row * span.h + anchor.y - plan.wall.y,
    };
    blocks.push({
      index,
      gameMap,
      plan,
      offsetTiles,
      column,
      row,
      townLife: new TownLifeSystem(gameMap, () => true),
      market: new MarketSystem(
        gameMap,
        createShopStock(),
        () => undefined,
        () => false,
        () => null,
        () => true,
      ),
    });
  }
  const citizens = blocks.flatMap((block) =>
    [...block.townLife.people, ...block.market.vendors].map(
      (person) =>
        new ScaledCityCitizen(person, block.index, {
          x: block.offsetTiles.x * TILE_SIZE,
          y: block.offsetTiles.y * TILE_SIZE,
        }),
    ),
  );
  const walls = blocks.map((block) => translated(block.plan.wall, block.offsetTiles));
  const left = Math.min(...walls.map((wall) => wall.x));
  const top = Math.min(...walls.map((wall) => wall.y));
  const right = Math.max(...walls.map((wall) => wall.x + wall.w));
  const bottom = Math.max(...walls.map((wall) => wall.y + wall.h));
  const middleRow = Math.floor(options.blocksPerSide / 2);
  const crossingRow = blocks
    .filter((block) => block.row === middleRow)
    .map((block) => ({
      x: block.plan.centre.x + block.offsetTiles.x,
      y: block.plan.centre.y + block.offsetTiles.y,
    }));
  const crossingY = crossingRow[0].y;
  return {
    blocksPerSide: options.blocksPerSide,
    blocks,
    citizens,
    buildings: blocks.flatMap(blockBuildings),
    bounds: { x: left, y: top, w: right - left, h: bottom - top },
    crossing: [{ x: left, y: crossingY }, ...crossingRow, { x: right, y: crossingY }],
  };
}
