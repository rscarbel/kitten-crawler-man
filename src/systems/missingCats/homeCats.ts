/**
 * The town cats who live in one room, while they are at home in it: each
 * keeps a spot beside the furniture her `restsBeside` names and wanders a
 * little round it, and either crawler can pet her as they pet a cow. The
 * human reaches down to scratch her, Belle turns to her and washes a paw;
 * she sits and washes, hearts float up off her, and the run counts the pet.
 *
 * Built with the room, like `MissingCatsInteriorSystem`, which owns it: who
 * is at home is read off the questline's record on every entry.
 */

import { TILE_SIZE, WORLD_TICKS_PER_SECOND } from '../../core/constants';
import { activeRunStats } from '../../core/progression/GameStats';
import { townCatIndoors, type MissingCatsProgress } from '../../core/quests/missingCatsProgress';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import { TOWN_CAT_IDS } from '../../core/state/townCatIds';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import { playPetGesture } from '../../creatures/humanGestures';
import type { BuildingId } from '../../map/buildingIds';
import { findNearbyWalkableTile } from '../../map/findWalkableTile';
import type { GameMap } from '../../map/GameMap';
import type { TilePoint } from '../../map/town/townPlan';
import type { AudioManager } from '../../audio/AudioManager';
import { playMissingCatsCue } from '../../audio/missingCatsSoundCues';
import { drawInteractionPrompt } from '../../ui/InteractionPrompt';
import { EmoteEffectSystem } from '../EmoteEffectSystem';
import { TOWN_CATS, TownCats, type TownCat, type TownCatDef } from '../critters/TownCats';

/** How close, centre to centre, a crawler must be to pet a cat: a cow's reach. */
const PET_RANGE_TILES = 1.4;
/** How far from the furniture she keeps by her spot may be, looking for open floor. */
const REST_SEARCH_TILES = 4;
/** She wanders this far round her spot: a step or two, never across the room. */
const HOME_ROAM_TILES = 1.5;
const SECONDS_PER_UPDATE = 1 / WORLD_TICKS_PER_SECOND;
const PET_LABEL = 'Pet';

export interface HomeCatsDeps {
  readonly buildingId: BuildingId;
  readonly map: GameMap;
  readonly progress: Pick<MissingCatsProgress, 'phase'>;
  readonly audio: AudioManager | null;
}

export class HomeCats {
  private readonly cats: TownCats;
  private readonly emotes = new EmoteEffectSystem();

  constructor(private readonly deps: HomeCatsDeps) {
    const { map } = deps;
    this.cats = new TownCats((x, y) => map.isWalkable(x, y, 'walker'), Math.random);
    for (const id of TOWN_CAT_IDS) {
      const def: TownCatDef = TOWN_CATS[id];
      if (def.home !== deps.buildingId || !townCatIndoors(deps.progress, id)) continue;
      const spot = this.restingTile(def);
      if (spot === null) continue;
      this.cats.placeAtHome(id, { x: spot.x * TILE_SIZE, y: spot.y * TILE_SIZE }, HOME_ROAM_TILES);
    }
  }

  /** Open floor beside the first of her furniture the room has, else near the room's middle. */
  private restingTile(def: TownCatDef): TilePoint | null {
    const { map } = this.deps;
    const beside = def.restsBeside
      .map((propId) => map.placedInteriorProps.find((placed) => placed.propId === propId))
      .find((placed) => placed !== undefined);
    const near: TilePoint =
      beside === undefined
        ? {
            x: Math.floor((map.structure[0]?.length ?? 0) / 2),
            y: Math.floor(map.structure.length / 2),
          }
        : { x: beside.tile.x, y: beside.tile.y + 1 };
    return findNearbyWalkableTile(map, near.x, near.y, REST_SEARCH_TILES);
  }

  update(): void {
    this.cats.update();
    this.emotes.update(SECONDS_PER_UPDATE);
  }

  /** The nearest cat at home within reach of `active`, or null. */
  private petTarget(active: HumanPlayer | CatPlayer): TownCat | null {
    let nearest: TownCat | null = null;
    let nearestTiles = PET_RANGE_TILES;
    for (const cat of this.cats.cats) {
      if (!cat.isAtHome) continue;
      const tiles = Math.hypot(cat.x - active.x, cat.y - active.y) / TILE_SIZE;
      if (tiles <= nearestTiles) {
        nearest = cat;
        nearestTiles = tiles;
      }
    }
    return nearest;
  }

  /**
   * Pets the nearest cat in reach. True whenever one is in reach, even inside
   * her pause between pets, so hammering the key never falls through to a
   * swing at her.
   */
  tryPet(active: HumanPlayer | CatPlayer): boolean {
    const cat = this.petTarget(active);
    if (cat === null) return false;
    const petterCentre = { x: active.x + TILE_SIZE / 2, y: active.y + TILE_SIZE / 2 };
    if (!cat.pet(petterCentre)) return true;
    activeRunStats()?.recordTownCatPetted();
    const head = cat.headAnchor();
    this.emotes.spawnHearts(head.x, head.y);
    playMissingCatsCue(this.deps.audio, 'townCatHearts');
    playMissingCatsCue(this.deps.audio, 'townCatPurr', head);
    if (active instanceof HumanPlayer) playPetGesture(active, head);
    else active.playContentGesture(cat.x, cat.y);
    return true;
  }

  /** Raises "Pet" over the cat a press would pet. Returns whether it did. */
  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: HumanPlayer | CatPlayer,
  ): boolean {
    const cat = this.petTarget(active);
    if (cat === null) return false;
    const px = cat.x - camX;
    const py = cat.y - camY;
    drawInteractionPrompt(
      ctx,
      px,
      py,
      TILE_SIZE,
      py + TILE_SIZE,
      `${PET_LABEL} ${cat.displayName}`,
    );
    return true;
  }

  /** The cats, for the room's depth-sorted pass. */
  sortedFigures(): readonly InteriorFigure[] {
    return this.cats.cats.map((cat) => ({
      y: cat.y,
      render: (ctx, camX, camY, tileSize) => cat.draw(ctx, camX, camY, tileSize),
    }));
  }

  /** The hearts, over every body. */
  renderAbove(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    this.emotes.render(ctx, camX, camY);
  }

  dispose(): void {
    this.cats.clear();
    this.emotes.clear();
  }
}
