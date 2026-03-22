/**
 * Abstract base class for scenes that involve player-controlled gameplay.
 * Extracts shared logic from DungeonScene and BuildingInteriorScene:
 *   - Camera calculation
 *   - Pause menu
 *   - HUD rendering
 *   - Player movement with wall collision
 *   - Companion follow
 *   - Inventory / gear panel interaction
 */

import { Scene, SceneManager } from '../core/Scene';
import { InputManager } from '../core/InputManager';
import { TILE_SIZE, PLAYER_SPEED } from '../core/constants';
import { GameMap } from '../map/GameMap';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import { PlayerManager } from '../core/PlayerManager';
import { PauseMenu } from '../ui/PauseMenu';
import { drawHUD } from '../ui/HUD';
import { IS_MOBILE } from '../core/MobileDetect';

export abstract class GameplayScene extends Scene {
  abstract readonly pm: PlayerManager;
  protected abstract readonly pauseMenu: PauseMenu;
  protected abstract readonly notifPulse: { value: number };

  protected _hudCollapsed = IS_MOBILE;
  protected _hudToggleRect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(
    protected readonly input: InputManager,
    protected readonly sceneManager: SceneManager,
  ) {
    super();
  }

  // ── Shared accessors ──────────────────────────────────────────

  protected get human(): HumanPlayer {
    return this.pm.human;
  }

  protected get cat(): CatPlayer {
    return this.pm.cat;
  }

  protected active(): HumanPlayer | CatPlayer {
    return this.pm.active();
  }

  protected inactive(): HumanPlayer | CatPlayer {
    return this.pm.inactive();
  }

  // ── Camera ────────────────────────────────────────────────────

  protected computeCamera(map: GameMap): { x: number; y: number } {
    const player = this.active();
    const canvas = this.sceneManager.canvas;
    const mapPxW = (map.structure[0]?.length ?? map.structure.length) * TILE_SIZE;
    const mapPxH = map.structure.length * TILE_SIZE;
    const cx = player.x + TILE_SIZE / 2 - canvas.width / 2;
    const cy = player.y + TILE_SIZE / 2 - canvas.height / 2;
    return {
      x:
        mapPxW <= canvas.width
          ? (mapPxW - canvas.width) / 2
          : Math.max(0, Math.min(mapPxW - canvas.width, cx)),
      y:
        mapPxH <= canvas.height
          ? (mapPxH - canvas.height) / 2
          : Math.max(0, Math.min(mapPxH - canvas.height, cy)),
    };
  }

  // ── Movement ──────────────────────────────────────────────────

  /**
   * Read WASD/Arrow input and apply collision-checked movement
   * to the active player on the given map.
   */
  protected applyPlayerMovement(map: GameMap, extraDx = 0, extraDy = 0): void {
    const player = this.active();
    const mapPxW = (map.structure[0]?.length ?? map.structure.length) * TILE_SIZE;
    const mapPxH = map.structure.length * TILE_SIZE;

    let dx = extraDx;
    let dy = extraDy;
    if (this.input.has('ArrowUp') || this.input.has('w')) dy -= 1;
    if (this.input.has('ArrowDown') || this.input.has('s')) dy += 1;
    if (this.input.has('ArrowLeft') || this.input.has('a')) dx -= 1;
    if (this.input.has('ArrowRight') || this.input.has('d')) dx += 1;

    player.isMoving = dx !== 0 || dy !== 0;
    if (dx !== 0 || dy !== 0) {
      const len = Math.hypot(dx, dy);
      player.facingX = dx / len;
      player.facingY = dy / len;
    }
    if (dx !== 0 && dy !== 0) {
      dx *= 0.7071;
      dy *= 0.7071;
    }
    dx *= PLAYER_SPEED;
    dy *= PLAYER_SPEED;

    const nextX = Math.max(0, Math.min(mapPxW - TILE_SIZE, player.x + dx));
    const tileXnext = Math.floor((nextX + TILE_SIZE * 0.5) / TILE_SIZE);
    const tileYcur = Math.floor((player.y + TILE_SIZE * 0.5) / TILE_SIZE);
    if (map.isWalkable(tileXnext, tileYcur)) player.x = nextX;

    const nextY = Math.max(0, Math.min(mapPxH - TILE_SIZE, player.y + dy));
    const tileXcur = Math.floor((player.x + TILE_SIZE * 0.5) / TILE_SIZE);
    const tileYnext = Math.floor((nextY + TILE_SIZE * 0.5) / TILE_SIZE);
    if (map.isWalkable(tileXcur, tileYnext)) player.y = nextY;
  }

  /**
   * Simple companion follow: nudge the inactive player toward the active one,
   * with wall collision on the given map.
   */
  protected applyCompanionFollow(
    map: GameMap,
    followDist = TILE_SIZE * 1.5,
    followSpeed = 3.5,
  ): void {
    const player = this.active();
    const follower = this.inactive();
    const mapPxW = (map.structure[0]?.length ?? map.structure.length) * TILE_SIZE;
    const mapPxH = map.structure.length * TILE_SIZE;

    const fdx = player.x - follower.x;
    const fdy = player.y - follower.y;
    const fdist = Math.hypot(fdx, fdy);
    if (fdist > followDist) {
      const fmx = (fdx / fdist) * followSpeed;
      const fmy = (fdy / fdist) * followSpeed;
      const fnx = Math.max(0, Math.min(mapPxW - TILE_SIZE, follower.x + fmx));
      const ftxn = Math.floor((fnx + TILE_SIZE * 0.5) / TILE_SIZE);
      if (map.isWalkable(ftxn, Math.floor((follower.y + TILE_SIZE * 0.5) / TILE_SIZE)))
        follower.x = fnx;
      const fny = Math.max(0, Math.min(mapPxH - TILE_SIZE, follower.y + fmy));
      const ftyn = Math.floor((fny + TILE_SIZE * 0.5) / TILE_SIZE);
      if (map.isWalkable(Math.floor((follower.x + TILE_SIZE * 0.5) / TILE_SIZE), ftyn))
        follower.y = fny;
    }
    follower.isMoving = fdist > TILE_SIZE * 1.5;
  }

  // ── HUD ───────────────────────────────────────────────────────

  protected renderHUD(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    this._hudToggleRect = drawHUD(
      ctx,
      canvas,
      this.human,
      this.cat,
      this.notifPulse,
      this._hudCollapsed,
    );
  }

  // ── Shared mouse/keyboard helpers ─────────────────────────────

  protected handleHudToggleTap(x: number, y: number): boolean {
    if (!IS_MOBILE) return false;
    const ht = this._hudToggleRect;
    if (x >= ht.x && x <= ht.x + ht.w && y >= ht.y && y <= ht.y + ht.h) {
      this._hudCollapsed = !this._hudCollapsed;
      return true;
    }
    return false;
  }
}
