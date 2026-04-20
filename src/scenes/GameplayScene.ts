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
import { TILE_SIZE } from '../core/constants';
import { clamp, pointInRect } from '../utils';
import { GameMap } from '../map/GameMap';
import { HumanPlayer } from '../creatures/HumanPlayer';
import { CatPlayer } from '../creatures/CatPlayer';
import { PlayerManager } from '../core/PlayerManager';
import { PauseMenu } from '../ui/PauseMenu';
import { drawHUD } from '../ui/HUD';
import { platform } from '../core/Platform';

export abstract class GameplayScene extends Scene {
  abstract readonly pm: PlayerManager;
  protected abstract readonly pauseMenu: PauseMenu;
  protected abstract readonly notifPulse: { value: number };

  protected _hudCollapsed = platform.initialHudCollapsed;
  protected _hudToggleRect = { x: 0, y: 0, w: 0, h: 0 };

  constructor(
    protected readonly input: InputManager,
    protected readonly sceneManager: SceneManager,
  ) {
    super();
  }

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

  protected computeCamera(map: GameMap): { x: number; y: number } {
    const player = this.active();
    const canvas = this.sceneManager.canvas;
    const mapPxW = (map.structure[0]?.length ?? map.structure.length) * TILE_SIZE;
    const mapPxH = map.structure.length * TILE_SIZE;
    const cx = player.x + TILE_SIZE / 2 - canvas.width / 2;
    const cy = player.y + TILE_SIZE / 2 - canvas.height / 2;
    return {
      x: mapPxW <= canvas.width ? (mapPxW - canvas.width) / 2 : clamp(cx, 0, mapPxW - canvas.width),
      y:
        mapPxH <= canvas.height
          ? (mapPxH - canvas.height) / 2
          : clamp(cy, 0, mapPxH - canvas.height),
    };
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
      const fnx = clamp(follower.x + fmx, 0, mapPxW - TILE_SIZE);
      const ftxn = Math.floor((fnx + TILE_SIZE * 0.5) / TILE_SIZE);
      if (map.isWalkable(ftxn, Math.floor((follower.y + TILE_SIZE * 0.5) / TILE_SIZE)))
        follower.x = fnx;
      const fny = clamp(follower.y + fmy, 0, mapPxH - TILE_SIZE);
      const ftyn = Math.floor((fny + TILE_SIZE * 0.5) / TILE_SIZE);
      if (map.isWalkable(Math.floor((follower.x + TILE_SIZE * 0.5) / TILE_SIZE), ftyn))
        follower.y = fny;
    }
    follower.isMoving = fdist > TILE_SIZE * 1.5;
  }

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

  protected handleHudToggleTap(x: number, y: number): boolean {
    if (!platform.showHudCollapseToggle) return false;
    const ht = this._hudToggleRect;
    if (pointInRect(x, y, ht)) {
      this._hudCollapsed = !this._hudCollapsed;
      return true;
    }
    return false;
  }
}
