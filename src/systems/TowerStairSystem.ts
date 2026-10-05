import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { GameSystem, SystemContext } from './GameSystem';
import { worldText } from '../ui/world/worldText';
import { worldPalette } from '../ui/theme/worldInk';

const FLOOR_LABELS = ['Ground Floor', '2nd Floor', '3rd Floor', 'Top Floor'];

/** Floors are counted from zero; players count from one. */
const FLOOR_NUMBER_BASE = 1;

function floorLabel(floor: number): string {
  return FLOOR_LABELS[floor] ?? `Floor ${floor + FLOOR_NUMBER_BASE}`;
}

const TILE_CENTER_OFFSET = 0.5;

const STAIR_PULSE_CENTER = 0.6;
const STAIR_PULSE_AMPLITUDE = 0.3;
const STAIR_PULSE_PERIOD_MS = 500;
const STAIR_HINT_SIZE_RATIO = 0.45;
const STAIR_HINT_Y_OFFSET = 4;
const STAIR_HINT_Y_SCALE = 0.8;

/**
 * The confirm gate on the last flight of stairs before a floor's final battle.
 *
 * It asks a different question from the ordinary staircase: not "which
 * floor?", which the player who walked onto it has already answered, but "are
 * you ready to be locked into a boss fight?", where the answer a stray press
 * should land on is *no*.
 */
export const FINALE_BODY_TEXT =
  'This will initiate a tough final battle for this floor. Are you sure you want to proceed?';
export const FINALE_DECLINE_LABEL = 'No, I have more to do.';
export const FINALE_CONFIRM_LABEL = 'Yes, I’m ready.';

/** Which stair prompt is up, for a view that draws it. */
export type TowerStairPrompt =
  | { readonly kind: 'ascend' | 'descend'; readonly targetFloorLabel: string }
  | { readonly kind: 'finale' };

export class TowerStairSystem implements GameSystem {
  private onUpStair = false;
  private onDownStair = false;
  private _upMenuOpen = false;
  private _downMenuOpen = false;
  private upDismissed = false;
  private downDismissed = false;

  constructor(
    private map: GameMap,
    private currentFloor: number,
    private readonly onAscend: () => void,
    private readonly onDescend: () => void,
    /**
     * Whether climbing *from this floor* walks into the floor's final battle.
     *
     * A callback rather than a flag: the answer depends on quest state that
     * moves while the player is inside the building, and the stair system has
     * no business knowing which questline decides it.
     */
    private readonly isFinalAscent: () => boolean = () => false,
  ) {}

  get menuOpen(): boolean {
    return this._upMenuOpen || this._downMenuOpen;
  }

  setMap(map: GameMap, floor: number): void {
    this.map = map;
    this.currentFloor = floor;
    this.resetState();
  }

  closeMenu(): void {
    this._upMenuOpen = false;
    this._downMenuOpen = false;
    this.upDismissed = true;
    this.downDismissed = true;
  }

  /** The prompt on screen, or null while none is. */
  get prompt(): TowerStairPrompt | null {
    if (this._upMenuOpen && this.isFinalAscent()) return { kind: 'finale' };
    if (!this._upMenuOpen && !this._downMenuOpen) return null;
    const isUp = this._upMenuOpen;
    const targetFloor = isUp ? this.currentFloor + 1 : this.currentFloor - 1;
    return {
      kind: isUp ? 'ascend' : 'descend',
      targetFloorLabel: floorLabel(targetFloor),
    };
  }

  /** The prompt's Ascend, Descend or finale "Yes". */
  takeStairs(): void {
    if (this._upMenuOpen) this.onAscend();
    else if (this._downMenuOpen) this.onDescend();
  }

  resetState(): void {
    this.onUpStair = false;
    this.onDownStair = false;
    this._upMenuOpen = false;
    this._downMenuOpen = false;
    this.upDismissed = false;
    this.downDismissed = false;
  }

  update(ctx: SystemContext): void {
    this.detect(ctx.active);
  }

  detect(active: { x: number; y: number }): void {
    const tx = Math.floor((active.x + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
    const ty = Math.floor((active.y + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);

    const wasOnUp = this.onUpStair;
    this.onUpStair = this.map._interiorStairUpTiles.some((s) => s.x === tx && s.y === ty);
    if (!this.onUpStair) {
      this.upDismissed = false;
      this._upMenuOpen = false;
    } else if (!wasOnUp && !this.upDismissed) {
      this._upMenuOpen = true;
    }

    const wasOnDown = this.onDownStair;
    this.onDownStair = this.map._interiorStairDownTiles.some((s) => s.x === tx && s.y === ty);
    if (!this.onDownStair) {
      this.downDismissed = false;
      this._downMenuOpen = false;
    } else if (!wasOnDown && !this.downDismissed) {
      this._downMenuOpen = true;
    }
  }

  renderStairHints(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const pulse =
      STAIR_PULSE_CENTER + Math.sin(Date.now() / STAIR_PULSE_PERIOD_MS) * STAIR_PULSE_AMPLITUDE;
    const hintSize = Math.floor(TILE_SIZE * STAIR_HINT_SIZE_RATIO);

    // One label per staircase, not per tile: a staircase is a block of tiles, and
    // labelling each of them stacks four copies of the same word on one landing.
    this.drawBlockHint(ctx, this.map._interiorStairUpTiles, '▲ Up', hintSize, pulse, camX, camY);
    this.drawBlockHint(
      ctx,
      this.map._interiorStairDownTiles,
      '▼ Down',
      hintSize,
      pulse,
      camX,
      camY,
    );
  }

  private drawBlockHint(
    ctx: CanvasRenderingContext2D,
    tiles: ReadonlyArray<{ x: number; y: number }>,
    label: string,
    hintSize: number,
    pulse: number,
    camX: number,
    camY: number,
  ): void {
    if (tiles.length === 0) return;
    const minTileX = Math.min(...tiles.map((t) => t.x));
    const maxTileX = Math.max(...tiles.map((t) => t.x));
    const minTileY = Math.min(...tiles.map((t) => t.y));
    const centreX = ((minTileX + maxTileX + 1) / 2) * TILE_SIZE - camX;
    const topY = minTileY * TILE_SIZE - camY;
    worldText(ctx, label, {
      x: centreX,
      y: topY - STAIR_HINT_Y_OFFSET - Math.round(hintSize * STAIR_HINT_Y_SCALE),
      size: hintSize,
      bold: true,
      color: worldPalette.waymark.stairHint,
      alpha: pulse,
      align: 'center',
    });
  }
}
