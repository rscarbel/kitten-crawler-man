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
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { MARKET_STALLS, type StallStock } from './townMarket';
import type { GameMap } from '../map/GameMap';
import type { Player } from '../Player';
import type { AudioManager } from '../audio/AudioManager';
import type { GameSystem } from './GameSystem';

/** A world object drawn in the scene's Y-sorted entity pass. */
export interface TownPropRenderable {
  /** World-pixel top-left, for camera culling and depth sorting. */
  x: number;
  y: number;
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void;
}

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

// Preferred board placement: a few tiles south of the square centre — the player
// spawns at centre and the tower fills the north, so south is the open plaza.
// Searched outward for the first free tile clear of building/sprite footprints.
const BOARD_SOUTH_OFFSET = 4;
const PROP_SEARCH_RADIUS = 4;

// Benches flank the fountain (a 3×3 block in the SE quadrant of the square): one
// to its west, one to its east, on the fountain's middle row.
const FOUNTAIN_FLANK_ROW_OFFSET = 5;
const BENCH_WEST_COL_OFFSET = 3;
const BENCH_EAST_COL_OFFSET = 7;

// Market stalls flank the square on its west and east sides, on the centre row.
const STALL_FLANK_OFFSET = 8;

// The fortune teller sits in the square's southwest, clear of the tower (north),
// the board (due south), the stalls (flanks), and the fountain (southeast).
const FORTUNE_DX = -4;
const FORTUNE_DY = 2;

const CENTER_OFFSET = TILE_SIZE / 2;

interface TileXY {
  x: number;
  y: number;
}

type HealKind = 'fountain' | 'well' | 'bench';

interface HealSpot {
  kind: HealKind;
  label: string;
  healFraction: number;
  cooldownFrames: number;
  tiles: TileXY[];
}

interface Stall {
  tile: TileXY;
  stock: StallStock;
}

export class TownPropSystem implements GameSystem {
  private readonly healSpots: HealSpot[] = [];
  private readonly renderables: TownPropRenderable[] = [];
  private readonly stalls: Stall[] = [];
  private board: NoticeBoardProp | null = null;
  private fortuneTile: TileXY | null = null;
  private healCooldown = 0;
  private readonly occupied = new Set<string>();

  constructor(
    private readonly gameMap: GameMap,
    private readonly onReadBoard: () => void,
    private readonly onBrowseStall: (stock: StallStock) => void,
    private readonly onConsultFortune: () => void,
    // An accessor, not the manager itself: props are placed before the scene's
    // audio field is assigned, so the sound source is resolved lazily at use time.
    private readonly getAudio: () => AudioManager | null,
  ) {
    this.placeBoard();
    this.placeStalls();
    this.placeFortuneTeller();
    this.gatherWaterSpots();
    this.placeBenches();
  }

  update(): void {
    if (this.healCooldown > 0) this.healCooldown--;
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
    const stall = this.nearestStall(active);
    if (stall !== null) {
      this.onBrowseStall(stall.stock);
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
    const stall = this.nearestStall(active);
    if (stall !== null) {
      this.drawPromptAt(ctx, stall.tile, camX, camY, 'Browse');
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
    const fountainTiles: TileXY[] = [];
    const structure = this.gameMap.structure;
    for (let ty = 0; ty < structure.length; ty++) {
      const row = structure[ty];
      for (let tx = 0; tx < row.length; tx++) {
        const type = row[tx].type;
        if (type === FOUNTAIN) {
          fountainTiles.push({ x: tx, y: ty });
        } else if (type === WELL) {
          this.healSpots.push(this.waterSpot('well', [{ x: tx, y: ty }]));
        }
      }
    }
    if (fountainTiles.length > 0) {
      this.healSpots.push(this.waterSpot('fountain', fountainTiles));
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
    const center = Math.floor(this.gameMap.gridSize / 2);
    const tile = this.findFreeTile({ x: center, y: center + BOARD_SOUTH_OFFSET });
    if (tile === null) return;
    this.reserve(tile);
    this.board = new NoticeBoardProp(tile);
    this.renderables.push(this.board);
  }

  private placeStalls(): void {
    const center = Math.floor(this.gameMap.gridSize / 2);
    const preferred: TileXY[] = [
      { x: center - STALL_FLANK_OFFSET, y: center },
      { x: center + STALL_FLANK_OFFSET, y: center },
    ];
    const count = Math.min(MARKET_STALLS.length, preferred.length);
    for (let i = 0; i < count; i++) {
      const tile = this.findFreeTile(preferred[i]);
      if (tile === null) continue;
      this.reserve(tile);
      this.stalls.push({ tile, stock: MARKET_STALLS[i] });
      this.renderables.push(new StallProp(tile, i));
    }
  }

  private nearestStall(active: Player): Stall | null {
    for (const stall of this.stalls) {
      if (this.tileWithinReach(active, stall.tile)) return stall;
    }
    return null;
  }

  private placeFortuneTeller(): void {
    const center = Math.floor(this.gameMap.gridSize / 2);
    const tile = this.findFreeTile({ x: center + FORTUNE_DX, y: center + FORTUNE_DY });
    if (tile === null) return;
    this.reserve(tile);
    this.fortuneTile = tile;
    this.renderables.push(new FortuneTellerProp(tile));
  }

  private placeBenches(): void {
    const center = Math.floor(this.gameMap.gridSize / 2);
    const row = center + FOUNTAIN_FLANK_ROW_OFFSET;
    const preferred: TileXY[] = [
      { x: center + BENCH_WEST_COL_OFFSET, y: row },
      { x: center + BENCH_EAST_COL_OFFSET, y: row },
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
          if (this.occupied.has(tileKey(tx, ty))) continue;
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

function tileKey(tx: number, ty: number): string {
  return `${tx},${ty}`;
}

const WOOD = '#6b4a2b';
const WOOD_DARK = '#4a3018';
const PARCHMENT = '#e8d9a0';
const HEADER = '#8a5a2b';

// Notice-board sprite geometry, drawn with primitives (no art asset). The board
// stands on its tile and rises upward; the tile itself is the foot for Y-sorting.
const POST_WIDTH = 4;
const POST_INSET = 6;
const BOARD_TOP_TILE_FRACTION = 0.85;
const BOARD_BOTTOM_TILE_FRACTION = 0.35;
const BOARD_TOP = -TILE_SIZE * BOARD_TOP_TILE_FRACTION;
const BOARD_BOTTOM = TILE_SIZE * BOARD_BOTTOM_TILE_FRACTION;
const BOARD_SIDE_OVERHANG = 3;
const BOARD_FRAME = 2;
const HEADER_HEIGHT = 6;
const NOTE_INSET = 5;
const NOTE_HEIGHT = 4;
const NOTE_GAP = 3;
const NOTE_COUNT = 3;

class NoticeBoardProp implements TownPropRenderable {
  constructor(readonly tile: TileXY) {}

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    const sx = this.tile.x * tileSize - camX;
    const sy = this.tile.y * tileSize - camY;

    const leftPostX = sx + POST_INSET;
    const rightPostX = sx + tileSize - POST_INSET - POST_WIDTH;
    const postTop = sy + BOARD_TOP + HEADER_HEIGHT;
    const postBottom = sy + tileSize;

    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(leftPostX, postTop, POST_WIDTH, postBottom - postTop);
    ctx.fillRect(rightPostX, postTop, POST_WIDTH, postBottom - postTop);

    const boardX = sx - BOARD_SIDE_OVERHANG;
    const boardW = tileSize + BOARD_SIDE_OVERHANG * 2;
    const boardTop = sy + BOARD_TOP;
    const boardH = BOARD_BOTTOM - BOARD_TOP;

    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(boardX, boardTop, boardW, boardH);
    ctx.fillStyle = WOOD;
    ctx.fillRect(
      boardX + BOARD_FRAME,
      boardTop + BOARD_FRAME,
      boardW - BOARD_FRAME * 2,
      boardH - BOARD_FRAME * 2,
    );

    ctx.fillStyle = HEADER;
    ctx.fillRect(
      boardX + BOARD_FRAME,
      boardTop + BOARD_FRAME,
      boardW - BOARD_FRAME * 2,
      HEADER_HEIGHT,
    );

    const noteX = boardX + NOTE_INSET;
    const noteW = boardW - NOTE_INSET * 2;
    let noteY = boardTop + BOARD_FRAME + HEADER_HEIGHT + NOTE_GAP;
    ctx.fillStyle = PARCHMENT;
    for (let i = 0; i < NOTE_COUNT; i++) {
      ctx.fillRect(noteX, noteY, noteW, NOTE_HEIGHT);
      noteY += NOTE_HEIGHT + NOTE_GAP;
    }
  }
}

// Bench sprite geometry: a low wooden seat with a backrest, sitting on its tile.
const BENCH_SIDE_INSET = 2;
const BENCH_SEAT_TILE_FRACTION = 0.55;
const BENCH_SEAT_THICKNESS = 4;
const BENCH_LEG_WIDTH = 3;
const BENCH_LEG_HEIGHT = 6;
const BENCH_BACK_TILE_FRACTION = 0.28;
const BENCH_BACK_THICKNESS = 3;

class BenchProp implements TownPropRenderable {
  constructor(readonly tile: TileXY) {}

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    const sx = this.tile.x * tileSize - camX;
    const sy = this.tile.y * tileSize - camY;
    const left = sx + BENCH_SIDE_INSET;
    const width = tileSize - BENCH_SIDE_INSET * 2;
    const seatY = sy + tileSize * BENCH_SEAT_TILE_FRACTION;
    const backY = sy + tileSize * BENCH_BACK_TILE_FRACTION;

    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(left, backY, BENCH_BACK_THICKNESS, seatY - backY);
    ctx.fillRect(left + width - BENCH_BACK_THICKNESS, backY, BENCH_BACK_THICKNESS, seatY - backY);
    ctx.fillRect(left, backY, width, BENCH_BACK_THICKNESS);

    ctx.fillStyle = WOOD;
    ctx.fillRect(left, seatY, width, BENCH_SEAT_THICKNESS);

    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(
      left + BENCH_SIDE_INSET,
      seatY + BENCH_SEAT_THICKNESS,
      BENCH_LEG_WIDTH,
      BENCH_LEG_HEIGHT,
    );
    ctx.fillRect(
      left + width - BENCH_SIDE_INSET - BENCH_LEG_WIDTH,
      seatY + BENCH_SEAT_THICKNESS,
      BENCH_LEG_WIDTH,
      BENCH_LEG_HEIGHT,
    );
  }
}

// Market-stall sprite geometry: a counter under a striped awning on two posts,
// with a vendor peeking over the counter and goods on top. The stall stands on
// its tile and rises upward; the tile is the foot for Y-sorting.
const STALL_OVERHANG = 4;
const STALL_AWNING_TOP_FRACTION = 0.75;
const STALL_AWNING_HEIGHT = 8;
const STALL_STRIPE_WIDTH = 5;
const STALL_POST_WIDTH = 3;
const STALL_COUNTER_TOP_FRACTION = 0.55;
const STALL_COUNTER_HEIGHT = 6;
const STALL_VENDOR_HEAD_RADIUS = 3;
const STALL_VENDOR_BODY_WIDTH = 8;
const STALL_VENDOR_BODY_HEIGHT = 7;
const STALL_GOOD_SIZE = 3;
const STALL_GOOD_GAP = 5;
const STALL_GOOD_COUNT = 3;

const STALL_AWNING_COLORS = ['#3f8f4f', '#b2402f'] as const;
const STALL_AWNING_STRIPE = '#f0e8d0';
const STALL_VENDOR_SKIN = '#c98a5a';
const STALL_VENDOR_BODY = '#5a4a7a';
const STALL_GOOD_COLORS = ['#e0b040', '#c05050', '#60a0c0'] as const;

class StallProp implements TownPropRenderable {
  constructor(
    readonly tile: TileXY,
    private readonly variant: number,
  ) {}

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    const sx = this.tile.x * tileSize - camX;
    const sy = this.tile.y * tileSize - camY;
    const left = sx - STALL_OVERHANG;
    const width = tileSize + STALL_OVERHANG * 2;
    const counterTop = sy + tileSize * STALL_COUNTER_TOP_FRACTION;
    const awningTop = sy - tileSize * STALL_AWNING_TOP_FRACTION;

    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(left + STALL_OVERHANG, awningTop, STALL_POST_WIDTH, counterTop - awningTop);
    ctx.fillRect(
      left + width - STALL_OVERHANG - STALL_POST_WIDTH,
      awningTop,
      STALL_POST_WIDTH,
      counterTop - awningTop,
    );

    const vendorCx = sx + tileSize / 2;
    ctx.fillStyle = STALL_VENDOR_SKIN;
    ctx.beginPath();
    ctx.arc(
      vendorCx,
      counterTop - STALL_VENDOR_BODY_HEIGHT - STALL_VENDOR_HEAD_RADIUS,
      STALL_VENDOR_HEAD_RADIUS,
      0,
      Math.PI * 2,
    );
    ctx.fill();
    ctx.fillStyle = STALL_VENDOR_BODY;
    ctx.fillRect(
      vendorCx - STALL_VENDOR_BODY_WIDTH / 2,
      counterTop - STALL_VENDOR_BODY_HEIGHT,
      STALL_VENDOR_BODY_WIDTH,
      STALL_VENDOR_BODY_HEIGHT,
    );

    ctx.fillStyle = WOOD;
    ctx.fillRect(left, counterTop, width, STALL_COUNTER_HEIGHT);
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(left, counterTop + STALL_COUNTER_HEIGHT - 1, width, 1);

    const goodsRowY = counterTop - STALL_GOOD_SIZE;
    const goodsStartX = vendorCx - ((STALL_GOOD_COUNT - 1) * STALL_GOOD_GAP) / 2;
    for (let i = 0; i < STALL_GOOD_COUNT; i++) {
      ctx.fillStyle = STALL_GOOD_COLORS[i % STALL_GOOD_COLORS.length];
      ctx.fillRect(goodsStartX + i * STALL_GOOD_GAP, goodsRowY, STALL_GOOD_SIZE, STALL_GOOD_SIZE);
    }

    const awningColor = STALL_AWNING_COLORS[this.variant % STALL_AWNING_COLORS.length];
    let stripeX = left;
    let stripe = 0;
    while (stripeX < left + width) {
      const w = Math.min(STALL_STRIPE_WIDTH, left + width - stripeX);
      ctx.fillStyle = stripe % 2 === 0 ? awningColor : STALL_AWNING_STRIPE;
      ctx.fillRect(stripeX, awningTop, w, STALL_AWNING_HEIGHT);
      stripeX += STALL_STRIPE_WIDTH;
      stripe++;
    }
  }
}

// Fortune-teller sprite geometry: Madame Voss, a hooded seer seated behind a
// small table, hands framing a glowing crystal orb. Every measure is a fraction
// of tile size so she reads as a person, not a robe-blob. The tile is her foot
// for Y-sorting.
const SEER_TWO_PI = Math.PI * 2;
const SEER_BASE_FRACTION = 0.96; // seat/base line
const SEER_SHOULDER_FRACTION = 0.44; // shoulder line
const SEER_TABLE_TOP_FRACTION = 0.66;
const SEER_TABLE_HEIGHT_FRACTION = 0.13;
const SEER_TABLE_INSET_FRACTION = 0.05;
const SEER_SHOULDER_HALF = 0.28; // half shoulder width
const SEER_HEM_HALF = 0.42; // half robe hem width at the seat
const SEER_ROBE_SEAM_WIDTH = 0.02;
const SEER_HEAD_CY_FRACTION = 0.27;
const SEER_HOOD_R = 0.19;
const SEER_HOOD_LIFT = 0.03; // hood peak above the face center
const SEER_FACE_RX = 0.085;
const SEER_FACE_RY = 0.11;
const SEER_FACE_DROP = 0.02; // face sits below the hood center so the cowl frames it
const SEER_BROW_SHADOW_RY = 0.045;
const SEER_EYE_DX = 0.038;
const SEER_EYE_CY_FRACTION = 0.28;
const SEER_EYE_R = 0.018;
const SEER_ARM_WIDTH = 0.085;
const SEER_HAND_DX = 0.17;
const SEER_HAND_R = 0.045;
const SEER_ORB_RADIUS_FRACTION = 0.09;
const SEER_ORB_LIFT_FRACTION = 0.05;
const SEER_COWL_SIDE_FRACTION = 0.9; // where the cowl meets the head, as a fraction of hood radius
const SEER_COWL_SHOULDER_DROP = 0.02; // how far the cowl laps over the shoulders
const SEER_BROW_SHADOW_RISE = 0.5; // brow shadow center above the face center, as a fraction of face RY
const SEER_EYE_GLOW_BLUR = 0.08;
const SEER_HAND_REST_LIFT = 0.01; // hands sit just above the table surface
const SEER_ARM_ROOT_SPREAD = 0.7; // arm root spacing as a fraction of shoulder half-width
const SEER_ARM_ROOT_DROP = 0.03; // arm root below the shoulder line
const SEER_ARM_ELBOW_DX = 0.24; // elbow bow-out from center
const SEER_ARM_ELBOW_LIFT = 0.04; // elbow above the table surface

const SEER_ROBE = '#3b2f5e';
const SEER_ROBE_SEAM = '#2c2247';
const SEER_HOOD = '#241b38';
const SEER_FACE = '#c9a781';
const SEER_BROW_SHADOW = '#5a3f4a';
const SEER_EYE = '#fff2c4';
const SEER_EYE_GLOW = '#a855f7';
const SEER_ORB = '#c9b8f0';
const SEER_ORB_GLOW = '#a855f7';

class FortuneTellerProp implements TownPropRenderable {
  constructor(readonly tile: TileXY) {}

  get x(): number {
    return this.tile.x * TILE_SIZE;
  }

  get y(): number {
    return this.tile.y * TILE_SIZE;
  }

  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, s: number): void {
    const sx = this.tile.x * s - camX;
    const sy = this.tile.y * s - camY;
    const cx = sx + s / 2;
    const baseY = sy + s * SEER_BASE_FRACTION;
    const shoulderY = sy + s * SEER_SHOULDER_FRACTION;
    const tableTop = sy + s * SEER_TABLE_TOP_FRACTION;
    const headCY = sy + s * SEER_HEAD_CY_FRACTION;

    // Cowl draping from the head down to the shoulders — sits behind the body.
    ctx.fillStyle = SEER_HOOD;
    ctx.beginPath();
    ctx.moveTo(cx - s * SEER_HOOD_R * SEER_COWL_SIDE_FRACTION, headCY);
    ctx.lineTo(cx - s * SEER_SHOULDER_HALF, shoulderY + s * SEER_COWL_SHOULDER_DROP);
    ctx.lineTo(cx + s * SEER_SHOULDER_HALF, shoulderY + s * SEER_COWL_SHOULDER_DROP);
    ctx.lineTo(cx + s * SEER_HOOD_R * SEER_COWL_SIDE_FRACTION, headCY);
    ctx.closePath();
    ctx.fill();

    // Robe body: a trapezoid from the shoulders to a wide hem at the seat.
    ctx.fillStyle = SEER_ROBE;
    ctx.beginPath();
    ctx.moveTo(cx - s * SEER_SHOULDER_HALF, shoulderY);
    ctx.lineTo(cx + s * SEER_SHOULDER_HALF, shoulderY);
    ctx.lineTo(cx + s * SEER_HEM_HALF, baseY);
    ctx.lineTo(cx - s * SEER_HEM_HALF, baseY);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = SEER_ROBE_SEAM;
    ctx.lineWidth = Math.max(1, s * SEER_ROBE_SEAM_WIDTH);
    ctx.beginPath();
    ctx.moveTo(cx, shoulderY);
    ctx.lineTo(cx, baseY);
    ctx.stroke();

    // Head: hood cowl behind, skin face inset, a shaded brow, and glowing eyes.
    ctx.fillStyle = SEER_HOOD;
    ctx.beginPath();
    ctx.arc(cx, headCY - s * SEER_HOOD_LIFT, s * SEER_HOOD_R, 0, SEER_TWO_PI);
    ctx.fill();

    const faceCY = headCY + s * SEER_FACE_DROP;
    ctx.fillStyle = SEER_FACE;
    ctx.beginPath();
    ctx.ellipse(cx, faceCY, s * SEER_FACE_RX, s * SEER_FACE_RY, 0, 0, SEER_TWO_PI);
    ctx.fill();

    ctx.fillStyle = SEER_BROW_SHADOW;
    ctx.beginPath();
    ctx.ellipse(
      cx,
      faceCY - s * SEER_FACE_RY * SEER_BROW_SHADOW_RISE,
      s * SEER_FACE_RX,
      s * SEER_BROW_SHADOW_RY,
      0,
      0,
      SEER_TWO_PI,
    );
    ctx.fill();

    ctx.save();
    ctx.shadowColor = SEER_EYE_GLOW;
    ctx.shadowBlur = s * SEER_EYE_GLOW_BLUR;
    ctx.fillStyle = SEER_EYE;
    const eyeY = sy + s * SEER_EYE_CY_FRACTION;
    ctx.beginPath();
    ctx.arc(cx - s * SEER_EYE_DX, eyeY, s * SEER_EYE_R, 0, SEER_TWO_PI);
    ctx.arc(cx + s * SEER_EYE_DX, eyeY, s * SEER_EYE_R, 0, SEER_TWO_PI);
    ctx.fill();
    ctx.restore();

    // Table in front of her lower body.
    const inset = s * SEER_TABLE_INSET_FRACTION;
    ctx.fillStyle = WOOD_DARK;
    ctx.fillRect(sx + inset, tableTop, s - inset * 2, s * SEER_TABLE_HEIGHT_FRACTION);

    // Sleeved arms resting on the table, hands framing the orb.
    const handY = tableTop - s * SEER_HAND_REST_LIFT;
    ctx.strokeStyle = SEER_ROBE;
    ctx.lineWidth = s * SEER_ARM_WIDTH;
    ctx.lineCap = 'round';
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(
        cx + dir * s * SEER_SHOULDER_HALF * SEER_ARM_ROOT_SPREAD,
        shoulderY + s * SEER_ARM_ROOT_DROP,
      );
      ctx.quadraticCurveTo(
        cx + dir * s * SEER_ARM_ELBOW_DX,
        tableTop - s * SEER_ARM_ELBOW_LIFT,
        cx + dir * s * SEER_HAND_DX,
        handY,
      );
      ctx.stroke();
    }
    ctx.fillStyle = SEER_FACE;
    for (const dir of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(cx + dir * s * SEER_HAND_DX, handY, s * SEER_HAND_R, 0, SEER_TWO_PI);
      ctx.fill();
    }

    // Crystal orb between her hands.
    ctx.save();
    ctx.shadowColor = SEER_ORB_GLOW;
    ctx.shadowBlur = s * SEER_ORB_RADIUS_FRACTION * 2;
    ctx.fillStyle = SEER_ORB;
    ctx.beginPath();
    ctx.arc(
      cx,
      tableTop - s * SEER_ORB_LIFT_FRACTION,
      s * SEER_ORB_RADIUS_FRACTION,
      0,
      SEER_TWO_PI,
    );
    ctx.fill();
    ctx.restore();
  }
}
