/**
 * Pressure plates and what a set of them drives. A plate is a placed
 * `pressure_plate` prop; anything with a body standing on it weighs it down,
 * asked through {@link PlateWeight} so a crawler, a companion and a thing
 * knocked off a shelf all answer the same question. A {@link PlateSetDef}
 * reads "every plate in this set is down" and opens its target: a door
 * swings, a portcullis rises, a counterweight drops and hauls a grate clear.
 */

import type { SoundId } from '../../audio/sounds';
import { TILE_SIZE } from '../../core/constants';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import { tileUnderFeet } from '../../map/collisionAnchors';
import type { GameMap, PlacedTownInteriorProp } from '../../map/GameMap';
import type { PlateSetDef, PlateSetTarget } from '../../map/interiorMechanisms';
import type { TilePoint } from '../../map/town/townPlan';
import { PRESSURE_PLATE_SINK_STEPS } from '../../sprites/art/townInterior/townInteriorProps';
import type { CompanionDirective } from '../CompanionSystem';

/** Anything that can weigh a plate down. */
export interface PlateWeight {
  occupiesPlate(tile: TilePoint): boolean;
}

/** A body that stands on its feet: a crawler, a hire, a cat ally. It weighs on the tile under its soles. */
export function bodyWeight(body: { readonly x: number; readonly y: number }): PlateWeight {
  return {
    occupiesPlate: (tile) => {
      const feet = tileUnderFeet(body, TILE_SIZE);
      return feet.x === tile.x && feet.y === tile.y;
    },
  };
}

/** Frames a plate takes to sink home under a weight, or to rise once it lifts. */
const PLATE_TRAVEL_FRAMES = 12;
/** Frames a target takes to open fully, or to shut. */
const TARGET_TRAVEL_FRAMES: Readonly<Record<PlateSetTarget['kind'], number>> = {
  door: 36,
  portcullis: 70,
  counterweight: 90,
};
const TARGET_CUES: Readonly<
  Record<PlateSetTarget['kind'], { readonly open: SoundId; readonly shut: SoundId }>
> = {
  door: { open: 'door_creak_1', shut: 'door_creak_2' },
  portcullis: { open: 'heavy_metal_gate_raise', shut: 'gate_thud' },
  counterweight: { open: 'rope_tightening', shut: 'gate_thud' },
};
const PLATE_DOWN_CUE: SoundId = 'stone_set_mortar_1';
const PLATE_UP_CUE: SoundId = 'stone_set_mortar_2';
const TILE_CENTRE = 0.5;

interface Plate {
  readonly placed: PlacedTownInteriorProp;
  held: boolean;
  /** 0 resting proud, 1 sunk home. */
  sink: number;
}

interface PlateSet {
  readonly def: PlateSetDef;
  readonly plates: readonly Plate[];
  /** 0 shut, 1 open. */
  open: number;
  opening: boolean;
}

export interface PressurePlateSystemOptions {
  readonly map: GameMap;
  readonly plateSets: readonly PlateSetDef[];
  readonly playSound: (cue: SoundId, at: { readonly x: number; readonly y: number }) => void;
  /** Told once each time a set's target comes fully open. */
  readonly onSetOpened: (id: string) => void;
}

function tileCentrePx(tile: TilePoint): { x: number; y: number } {
  return { x: (tile.x + TILE_CENTRE) * TILE_SIZE, y: (tile.y + TILE_CENTRE) * TILE_SIZE };
}

function step(value: number, toward: number, frames: number): number {
  const delta = 1 / frames;
  return toward > value ? Math.min(toward, value + delta) : Math.max(toward, value - delta);
}

/** Every plate on one map and the sets that read them. */
export class PressurePlateSystem {
  private readonly map: GameMap;
  private readonly playSound: PressurePlateSystemOptions['playSound'];
  private readonly onSetOpened: PressurePlateSystemOptions['onSetOpened'];
  private readonly plates = new Map<string, Plate>();
  private readonly sets: PlateSet[] = [];

  constructor(options: PressurePlateSystemOptions) {
    this.map = options.map;
    this.playSound = options.playSound;
    this.onSetOpened = options.onSetOpened;
    for (const placed of options.map.placedInteriorProps) {
      if (placed.propId !== 'pressure_plate') continue;
      this.plates.set(placed.id, { placed, held: false, sink: 0 });
    }
    for (const def of options.plateSets) {
      const plates = def.plates.map((id) => {
        const plate = this.plates.get(id);
        if (plate === undefined) throw new Error(`plate set '${def.id}' names no plate '${id}'`);
        return plate;
      });
      this.sets.push({ def, plates, open: 0, opening: false });
      for (const tile of def.target.tiles) this.map.blockTilePermanently(tile.x, tile.y);
    }
  }

  get isEmpty(): boolean {
    return this.plates.size === 0;
  }

  /** Whether something is weighing the plate `id` down this frame. */
  isPlateHeld(id: string): boolean {
    return this.plates.get(id)?.held === true;
  }

  /**
   * Stands a latching set's target fully open at once, with no travel and no
   * sound: for a room built after the set was opened on an earlier visit,
   * whose owner keeps that outcome. A set that does not latch is left alone.
   */
  settleOpen(id: string): void {
    const set = this.sets.find((candidate) => candidate.def.id === id);
    if (set?.def.hold !== 'latches') return;
    set.opening = true;
    set.open = 1;
    for (const tile of set.def.target.tiles) this.map.unblockTilePermanently(tile.x, tile.y);
  }

  /**
   * The order that stands a companion on a plate and keeps it there: given to
   * the crawler companion's `setDirective`, or a cat ally's. Holding fire,
   * because a companion that runs off after something to fight lifts the plate.
   */
  holdSpot(plateId: string): CompanionDirective | null {
    const plate = this.plates.get(plateId);
    if (plate === undefined) return null;
    return { x: plate.placed.tile.x * TILE_SIZE, y: plate.placed.tile.y * TILE_SIZE, hold: true };
  }

  /** Once a frame, with everything that has a body on this map. */
  update(weights: readonly PlateWeight[]): void {
    for (const plate of this.plates.values()) this.updatePlate(plate, weights);
    for (const set of this.sets) this.updateSet(set, weights);
  }

  private updatePlate(plate: Plate, weights: readonly PlateWeight[]): void {
    const tile = plate.placed.tile;
    const held = weights.some((weight) => weight.occupiesPlate(tile));
    if (held !== plate.held) {
      plate.held = held;
      this.playSound(held ? PLATE_DOWN_CUE : PLATE_UP_CUE, tileCentrePx(tile));
    }
    plate.sink = step(plate.sink, held ? 1 : 0, PLATE_TRAVEL_FRAMES);
    const depth = Math.round(plate.sink * (PRESSURE_PLATE_SINK_STEPS - 1));
    this.map.setPlacedInteriorPropVariant(plate.placed.id, depth);
  }

  private updateSet(set: PlateSet, weights: readonly PlateWeight[]): void {
    const allHeld = set.plates.every((plate) => plate.held);
    const latched = set.def.hold === 'latches' && set.opening;
    const wantsOpen = allHeld || latched;
    const target = set.def.target;
    if (wantsOpen && !set.opening) {
      set.opening = true;
      this.playSound(TARGET_CUES[target.kind].open, this.targetCentre(target));
    } else if (!wantsOpen && set.opening) {
      // Never shut on a body standing in the way: it would be sealed inside a wall.
      const blockedByBody = target.tiles.some((tile) =>
        weights.some((weight) => weight.occupiesPlate(tile)),
      );
      if (blockedByBody) return;
      set.opening = false;
      for (const tile of target.tiles) this.map.blockTilePermanently(tile.x, tile.y);
      this.playSound(TARGET_CUES[target.kind].shut, this.targetCentre(target));
    }
    const wasOpen = set.open >= 1;
    set.open = step(set.open, set.opening ? 1 : 0, TARGET_TRAVEL_FRAMES[target.kind]);
    if (!wasOpen && set.open >= 1) {
      for (const tile of target.tiles) this.map.unblockTilePermanently(tile.x, tile.y);
      this.onSetOpened(set.def.id);
    }
  }

  private targetCentre(target: PlateSetTarget): { x: number; y: number } {
    if (target.kind === 'counterweight') return tileCentrePx(target.weightTile);
    if (target.tiles.length === 0) return { x: 0, y: 0 };
    return tileCentrePx(target.tiles[0]);
  }

  /** The targets' art, in the room's sorted pass. */
  sortedFigures(): InteriorFigure[] {
    return this.sets.flatMap((set) => targetFigures(set.def.target, set.open));
  }
}

const IRON = '#2b2d31';
const IRON_LIGHT = '#5a5e66';
const IRON_SHADOW = 'rgba(0, 0, 0, 0.35)';
const OAK = '#5b3a22';
const OAK_LIGHT = '#7a5233';
const OAK_SEAM = '#3a2414';
const ROPE = '#b08a55';
const STONE_WEIGHT = '#6b6a66';
const STONE_WEIGHT_LIGHT = '#8c8a84';

const BAR_COUNT = 4;
const BAR_WIDTH_SHARE = 0.12;
const CROSSBAR_HEIGHT_SHARE = 0.1;
const UPPER_CROSSBAR_AT = 0.3;
const LOWER_CROSSBAR_AT = 0.7;
const CROSSBAR_AT_SHARES = [UPPER_CROSSBAR_AT, LOWER_CROSSBAR_AT] as const;
/** How tall a portcullis or a door stands above its tile, as a share of a tile. */
const BARRIER_RISE_TILES = 1.2;
const DOOR_PLANKS = 3;
const DOOR_THICKNESS_SHARE = 0.18;
const WEIGHT_SIZE_SHARE = 0.6;
const ROPE_WIDTH_PX = 2;
const HALF = 0.5;

function targetFigures(target: PlateSetTarget, open: number): InteriorFigure[] {
  switch (target.kind) {
    case 'portcullis':
      return target.tiles.map((tile) => gridFigure(tile, open));
    case 'door':
      return target.tiles.map((tile) => doorFigure(tile, target.hinge, open));
    case 'counterweight':
      return [
        weightFigure(target.weightTile, target.dropTiles, open),
        ...target.tiles.map((tile) => gridFigure(tile, open)),
      ];
    default: {
      const unreachable: never = target;
      return unreachable;
    }
  }
}

/** Iron bars over a tile, drawn raised by `open` of their height and clipped where they go into the lintel. */
function gridFigure(tile: TilePoint, open: number): InteriorFigure {
  return {
    y: tile.y * TILE_SIZE,
    render: (ctx, camX, camY, tileSize) => {
      if (open >= 1) return;
      const left = tile.x * tileSize - camX;
      const floor = (tile.y + 1) * tileSize - camY;
      const height = tileSize * BARRIER_RISE_TILES;
      const top = floor - height;
      const lift = height * open;
      ctx.save();
      ctx.beginPath();
      ctx.rect(left, top, tileSize, height);
      ctx.clip();
      ctx.fillStyle = IRON_SHADOW;
      ctx.fillRect(
        left,
        floor - lift - tileSize * CROSSBAR_HEIGHT_SHARE,
        tileSize,
        tileSize * CROSSBAR_HEIGHT_SHARE,
      );
      const barWidth = tileSize * BAR_WIDTH_SHARE;
      for (let bar = 0; bar < BAR_COUNT; bar++) {
        const x = left + ((bar + HALF) / BAR_COUNT) * tileSize - barWidth * HALF;
        ctx.fillStyle = IRON;
        ctx.fillRect(x, top - lift, barWidth, height);
        ctx.fillStyle = IRON_LIGHT;
        ctx.fillRect(x, top - lift, barWidth * HALF, height);
      }
      for (const share of CROSSBAR_AT_SHARES) {
        ctx.fillStyle = IRON;
        ctx.fillRect(left, top - lift + height * share, tileSize, tileSize * CROSSBAR_HEIGHT_SHARE);
      }
      ctx.restore();
    },
  };
}

/** A plank door seen from above, swinging off its hinge side: it narrows to its edge as it opens. */
function doorFigure(tile: TilePoint, hinge: 'west' | 'east', open: number): InteriorFigure {
  return {
    y: tile.y * TILE_SIZE,
    render: (ctx, camX, camY, tileSize) => {
      const left = tile.x * tileSize - camX;
      const floor = (tile.y + 1) * tileSize - camY;
      const height = tileSize * BARRIER_RISE_TILES;
      const swung = Math.cos((open * Math.PI) / 2);
      const width = Math.max(tileSize * DOOR_THICKNESS_SHARE, tileSize * swung);
      const x = hinge === 'west' ? left : left + tileSize - width;
      ctx.save();
      ctx.fillStyle = OAK;
      ctx.fillRect(x, floor - height, width, height);
      ctx.fillStyle = OAK_LIGHT;
      ctx.fillRect(x, floor - height, width, height * CROSSBAR_HEIGHT_SHARE);
      ctx.strokeStyle = OAK_SEAM;
      for (let plank = 1; plank < DOOR_PLANKS; plank++) {
        const seamX = x + (width * plank) / DOOR_PLANKS;
        ctx.beginPath();
        ctx.moveTo(seamX, floor - height);
        ctx.lineTo(seamX, floor);
        ctx.stroke();
      }
      ctx.restore();
    },
  };
}

/** A stone weight on a rope, lowered by `open` of its drop. */
function weightFigure(tile: TilePoint, dropTiles: number, open: number): InteriorFigure {
  return {
    y: (tile.y + dropTiles) * TILE_SIZE,
    render: (ctx, camX, camY, tileSize) => {
      const centreX = (tile.x + HALF) * tileSize - camX;
      const anchorY = tile.y * tileSize - camY;
      const size = tileSize * WEIGHT_SIZE_SHARE;
      const hangY = anchorY + dropTiles * tileSize * open;
      ctx.save();
      ctx.strokeStyle = ROPE;
      ctx.lineWidth = ROPE_WIDTH_PX;
      ctx.beginPath();
      ctx.moveTo(centreX, anchorY - tileSize);
      ctx.lineTo(centreX, hangY);
      ctx.stroke();
      ctx.fillStyle = STONE_WEIGHT;
      ctx.fillRect(centreX - size * HALF, hangY, size, size);
      ctx.fillStyle = STONE_WEIGHT_LIGHT;
      ctx.fillRect(centreX - size * HALF, hangY, size, size * CROSSBAR_HEIGHT_SHARE);
      ctx.restore();
    },
  };
}
