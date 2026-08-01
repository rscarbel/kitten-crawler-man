/**
 * Interactive fixtures of the Over City square — the "things to do in town"
 * layer. Owned by `DungeonScene` and active only on the overworld, it gives the
 * player standing reasons to linger:
 *
 *  - A **notice board** planted in the square: pressing Space beside it opens the
 *    `NoticeBoardPanel` (the scene supplies the callback), surfacing the current
 *    quest/bounty state. The board is a physical prop — it renders in the scene's
 *    Y-sorted entity pass and blocks its tile so citizens and players walk around
 *    it.
 *  - **Heal spots** — the fountain and wells already placed by `OverworldGenerator`
 *    (a quick "Drink"), plus a pair of **benches** the system plants flanking the
 *    fountain (a slower, deeper "Rest"). Both restore a fraction of max HP on a
 *    cooldown, so a wounded player can top off between errands without burning a
 *    potion. The town is already a safe zone with a free bed, so this is
 *    convenience/flavor, not a combat heal.
 *
 * The system exposes `tryInteract` for the scene's Space-priority chain (yielding
 * to combat/quests/citizens like every other interaction) and `renderPrompt` for
 * the floating SPACE hint. Purely additive: it never touches combat or mobs.
 */

import { TILE_SIZE } from '../core/constants';
import { FOUNTAIN, WELL } from '../map/tileTypes';
import { drawTownSheetFrame } from '../sprites/townSheetProp';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { tileKey } from './tileKey';
import type { GameMap } from '../map/GameMap';
import type { Player } from '../Player';
import type { AudioManager } from '../audio/AudioManager';
import type { GameSystem } from './GameSystem';
import type { TownPropRenderable } from './townPropRenderable';

// How close (tile centre to tile centre) the player must be to a prop to act on
// it. Just over a diagonal step so standing on any adjacent tile counts.
const INTERACT_RADIUS_TILES = 1.6;
const INTERACT_RADIUS = TILE_SIZE * INTERACT_RADIUS_TILES;

// A drink at the fountain/well is a quick sip: a small heal on a short lockout.
const DRINK_HEAL_FRACTION = 0.12;
const DRINK_COOLDOWN_FRAMES = 90;

// Resting on a bench recovers more, but takes longer before you can rest again.
const REST_HEAL_FRACTION = 0.25;
const REST_COOLDOWN_FRAMES = 360;

// Preferred board placement: the plaza's north-west quadrant. It used to be due
// south of centre on the rationale that "the tower fills the north" — the tower
// now stands in the north wall and the terrace approach runs down the centre
// line, so the open quarters are the corners, and due south is the arrival
// sightline from the south gate. Searched outward for the first free tile clear
// of building/sprite footprints.
const BOARD_OFFSET: TileOffset = { dx: -4, dy: -4 };
const PROP_SEARCH_RADIUS = 4;

// Benches flank the fountain, one either side, on its middle row. Derived from
// the fountain's own tiles rather than from a copy of its plan offsets: those
// offsets move with the plaza, and a bench row hard-coded to a stale fountain
// position would sit in open flagstone with nothing to face.
const BENCH_COLUMN_GAP = 2;

// The fortune teller sits in the plaza's north-east quadrant, clear of the
// terrace mouth (centre north), the board (north-west), the stalls (flanks on
// the centre row) and the fountain (south-east).
const FORTUNE_OFFSET: TileOffset = { dx: 4, dy: -4 };

const CENTER_OFFSET = TILE_SIZE / 2;

interface TileXY {
  x: number;
  y: number;
}

/** Signed tile offset from the plaza centre. */
interface TileOffset {
  readonly dx: number;
  readonly dy: number;
}

type HealKind = 'fountain' | 'well' | 'bench';

interface HealSpot {
  kind: HealKind;
  label: string;
  healFraction: number;
  cooldownFrames: number;
  tiles: TileXY[];
}

export class TownPropSystem implements GameSystem {
  private readonly healSpots: HealSpot[] = [];
  private readonly renderables: TownPropRenderable[] = [];
  private board: NoticeBoardProp | null = null;
  private fortuneTile: TileXY | null = null;
  private healCooldown = 0;
  private readonly occupied = new Set<string>();

  constructor(
    private readonly gameMap: GameMap,
    private readonly onReadBoard: () => void,
    private readonly onConsultFortune: () => void,
    // An accessor, not the manager itself: props are placed before the scene's
    // audio field is assigned, so the sound source is resolved lazily at use time.
    private readonly getAudio: () => AudioManager | null,
    /**
     * Tiles another system has already claimed — the market's stall footprints.
     * Needed because prop placement tests `isWalkableIgnoringPermanent`, which by
     * design ignores the permanent blocks those systems set.
     */
    private readonly claimedElsewhere: ReadonlySet<string> = new Set(),
  ) {
    this.placeBoard();
    this.placeFortuneTeller();
    this.gatherWaterSpots();
    this.placeBenches();
  }

  update(): void {
    if (this.healCooldown > 0) this.healCooldown--;
  }

  /**
   * Tiles this system's props stand on, for the systems built after it. Same
   * contract and same reason as `MarketSystem.reservedTiles`: placement tests
   * `isWalkableIgnoringPermanent`, which by design ignores the permanent blocks
   * these props set, so a later system would otherwise put a lamp inside the
   * notice board.
   */
  get reservedTiles(): ReadonlySet<string> {
    return this.occupied;
  }

  /** Renderable props for the scene's Y-sorted entity pass. */
  get props(): ReadonlyArray<TownPropRenderable> {
    return this.renderables;
  }

  /**
   * Space-key handler for the scene's interaction chain. Opens the board or heals
   * at the nearest fountain/well/bench in reach. Returns whether the press was used.
   */
  tryInteract(active: Player): boolean {
    if (this.board !== null && this.tileWithinReach(active, this.board.tile)) {
      this.onReadBoard();
      return true;
    }
    if (this.fortuneTile !== null && this.tileWithinReach(active, this.fortuneTile)) {
      this.onConsultFortune();
      return true;
    }
    if (this.healCooldown <= 0 && active.hp < active.maxHp) {
      const near = this.nearestHealSpot(active);
      if (near !== null) {
        this.heal(active, near.spot);
        return true;
      }
    }
    return false;
  }

  /** Floats a SPACE prompt over the nearest actionable prop, if one is in range. */
  renderPrompt(ctx: CanvasRenderingContext2D, camX: number, camY: number, active: Player): void {
    if (this.board !== null && this.tileWithinReach(active, this.board.tile)) {
      this.drawPromptAt(ctx, this.board.tile, camX, camY, 'Read');
      return;
    }
    if (this.fortuneTile !== null && this.tileWithinReach(active, this.fortuneTile)) {
      this.drawPromptAt(ctx, this.fortuneTile, camX, camY, 'Consult');
      return;
    }
    if (this.healCooldown <= 0 && active.hp < active.maxHp) {
      const near = this.nearestHealSpot(active);
      if (near !== null) this.drawPromptAt(ctx, near.tile, camX, camY, near.spot.label);
    }
  }

  private drawPromptAt(
    ctx: CanvasRenderingContext2D,
    tile: TileXY,
    camX: number,
    camY: number,
    label: string,
  ): void {
    drawInteractionPrompt(
      ctx,
      tile.x * TILE_SIZE - camX,
      tile.y * TILE_SIZE - camY,
      TILE_SIZE,
      label,
    );
  }

  private heal(active: Player, spot: HealSpot): void {
    const amount = Math.max(1, Math.round(active.maxHp * spot.healFraction));
    active.hp = Math.min(active.maxHp, active.hp + amount);
    this.healCooldown = spot.cooldownFrames;
    this.getAudio()?.play('potion_drink');
  }

  private gatherWaterSpots(): void {
    for (const well of this.gameMap.tilesOfType(WELL)) {
      this.healSpots.push(this.waterSpot('well', [{ x: well.x, y: well.y }]));
    }
    const fountainTiles = this.gameMap.tilesOfType(FOUNTAIN);
    if (fountainTiles.length > 0) {
      this.healSpots.push(this.waterSpot('fountain', [...fountainTiles]));
    }
  }

  private waterSpot(kind: 'fountain' | 'well', tiles: TileXY[]): HealSpot {
    return {
      kind,
      label: 'Drink',
      healFraction: DRINK_HEAL_FRACTION,
      cooldownFrames: DRINK_COOLDOWN_FRAMES,
      tiles,
    };
  }

  private placeBoard(): void {
    const centre = this.plazaCentre();
    const tile = this.findFreeTile({
      x: centre.x + BOARD_OFFSET.dx,
      y: centre.y + BOARD_OFFSET.dy,
    });
    if (tile === null) return;
    this.reserve(tile);
    this.board = new NoticeBoardProp(tile);
    this.renderables.push(this.board);
  }

  private placeFortuneTeller(): void {
    const centre = this.plazaCentre();
    const tile = this.findFreeTile({
      x: centre.x + FORTUNE_OFFSET.dx,
      y: centre.y + FORTUNE_OFFSET.dy,
    });
    if (tile === null) return;
    this.reserve(tile);
    this.fortuneTile = tile;
    this.renderables.push(new FortuneTellerProp(tile));
  }

  private placeBenches(): void {
    const fountain = this.gameMap.fountainCentre;
    if (fountain === undefined) return;
    const preferred: TileXY[] = [
      { x: fountain.x - BENCH_COLUMN_GAP, y: fountain.y },
      { x: fountain.x + BENCH_COLUMN_GAP, y: fountain.y },
    ];
    for (const want of preferred) {
      const tile = this.findFreeTile(want);
      if (tile === null) continue;
      this.reserve(tile);
      const bench = new BenchProp(tile);
      this.renderables.push(bench);
      this.healSpots.push({
        kind: 'bench',
        label: 'Rest',
        healFraction: REST_HEAL_FRACTION,
        cooldownFrames: REST_COOLDOWN_FRAMES,
        tiles: [tile],
      });
    }
  }

  /**
   * Centre of the market plaza. Read from the map rather than recomputed as
   * `gridSize / 2`, which was only ever right because the plaza happened to be
   * centred on the map.
   */
  private plazaCentre(): TileXY {
    return (
      this.gameMap.townSquareCentre ?? {
        x: Math.floor(this.gameMap.gridSize / 2),
        y: Math.floor(this.gameMap.gridSize / 2),
      }
    );
  }

  private reserve(tile: TileXY): void {
    this.gameMap.blockTilePermanently(tile.x, tile.y);
    this.occupied.add(tileKey(tile.x, tile.y));
  }

  /**
   * Spiral outward from `preferred` for the first free tile, so a prop never
   * lands in a wall, a building/sprite footprint, or atop another prop. Tested
   * against `isWalkableIgnoringPermanent`, not `isWalkable`: the overworld map
   * instance is reused across building round-trips, and a prop's own permanent
   * block would otherwise make this pick drift to (and leak) a new tile every
   * trip. That predicate is stable across reconstructions, so re-placement is
   * idempotent — it re-selects the same tile.
   */
  private findFreeTile(preferred: TileXY): TileXY | null {
    for (let ring = 0; ring <= PROP_SEARCH_RADIUS; ring++) {
      for (let dy = -ring; dy <= ring; dy++) {
        for (let dx = -ring; dx <= ring; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dy)) !== ring) continue;
          const tx = preferred.x + dx;
          const ty = preferred.y + dy;
          const key = tileKey(tx, ty);
          if (this.occupied.has(key) || this.claimedElsewhere.has(key)) continue;
          if (this.gameMap.isWalkableIgnoringPermanent(tx, ty)) return { x: tx, y: ty };
        }
      }
    }
    return null;
  }

  private tileWithinReach(active: Player, tile: TileXY): boolean {
    const px = active.x + CENTER_OFFSET;
    const py = active.y + CENTER_OFFSET;
    const tileCx = tile.x * TILE_SIZE + CENTER_OFFSET;
    const tileCy = tile.y * TILE_SIZE + CENTER_OFFSET;
    return Math.hypot(px - tileCx, py - tileCy) <= INTERACT_RADIUS;
  }

  private nearestHealSpot(active: Player): { spot: HealSpot; tile: TileXY } | null {
    let best: { spot: HealSpot; tile: TileXY } | null = null;
    let bestDist = INTERACT_RADIUS;
    const px = active.x + CENTER_OFFSET;
    const py = active.y + CENTER_OFFSET;
    for (const spot of this.healSpots) {
      for (const tile of spot.tiles) {
        const dist = Math.hypot(
          px - (tile.x * TILE_SIZE + CENTER_OFFSET),
          py - (tile.y * TILE_SIZE + CENTER_OFFSET),
        );
        if (dist <= bestDist) {
          bestDist = dist;
          best = { spot, tile };
        }
      }
    }
    return best;
  }
}

/**
 * The baked sheets these fixtures draw from. The bench and the board are street
 * furniture any town could have, so they are baked by
 * `scripts/generate-townscape-sprites.ts`; the seer is Madame Voss by name, so
 * she is baked by `generate-over-city-sprites.ts` into this town's own folder.
 */
const NOTICE_BOARD_SHEET_KEY = 'town_notice_board';
const BENCH_SHEET_KEY = 'town_bench';
const FORTUNE_TELLER_SHEET_KEY = 'over_city_fortune_teller';

/** None of the three moves, so each is one picture in a single-state sheet. */
const FIXTURE_STATE = 'idle';
const FIXTURE_FRAME = 0;

class NoticeBoardProp implements TownPropRenderable {
  constructor(readonly tile: TileXY) {}

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawTownSheetFrame(
      ctx,
      NOTICE_BOARD_SHEET_KEY,
      FIXTURE_STATE,
      FIXTURE_FRAME,
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
    );
  }
}

class BenchProp implements TownPropRenderable {
  constructor(readonly tile: TileXY) {}

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawTownSheetFrame(
      ctx,
      BENCH_SHEET_KEY,
      FIXTURE_STATE,
      FIXTURE_FRAME,
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
    );
  }
}

class FortuneTellerProp implements TownPropRenderable {
  constructor(readonly tile: TileXY) {}

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    drawTownSheetFrame(
      ctx,
      FORTUNE_TELLER_SHEET_KEY,
      FIXTURE_STATE,
      FIXTURE_FRAME,
      this.tile.x * tileSize - camX,
      this.tile.y * tileSize - camY,
      tileSize,
    );
  }
}
