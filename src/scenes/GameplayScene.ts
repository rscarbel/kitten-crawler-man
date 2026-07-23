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

import type { SceneManager } from '../core/Scene';
import { Scene } from '../core/Scene';
import type { InputManager } from '../core/InputManager';
import { TILE_SIZE } from '../core/constants';
import { clamp, frameTime, pointInRect } from '../utils';
import { drunkCameraOffset } from '../core/DrunkEffect';
import type { GameMap } from '../map/GameMap';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { PlayerManager } from '../core/PlayerManager';
import type { PauseMenu } from '../ui/PauseMenu';
import { drawHUD, renderMobileSkillBadge } from '../ui/HUD';
import { platform } from '../core/Platform';

const FOLLOW_DISTANCE_MULTIPLIER = 1.5;
const COMPANION_FOLLOW_SPEED = 3.5;
const CAMERA_CENTER_OFFSET_MULTIPLIER = 0.5;
const COMPANION_MOVE_CHECK_OFFSET = 1.5;
const HUD_SKILL_BADGE_GAP = 4;

export abstract class GameplayScene extends Scene {
  abstract readonly pm: PlayerManager;
  protected abstract readonly pauseMenu: PauseMenu;
  protected abstract readonly notifPulse: { value: number };

  protected _hudCollapsed = platform.initialHudCollapsed;
  protected _hudToggleRect = { x: 0, y: 0, w: 0, h: 0 };
  protected _hudSkillBannerRect = { x: -9999, y: 0, w: 0, h: 0 };

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
    const cx = player.x + TILE_SIZE * CAMERA_CENTER_OFFSET_MULTIPLIER - canvas.width / 2;
    const cy = player.y + TILE_SIZE * CAMERA_CENTER_OFFSET_MULTIPLIER - canvas.height / 2;
    // Applied after the clamp so the sway still reads in a room smaller than the
    // viewport, where the camera is pinned and every clamped offset would vanish.
    const sway = player.hasStatus('drunk') ? drunkCameraOffset(frameTime) : { x: 0, y: 0 };
    return {
      x:
        (mapPxW <= canvas.width
          ? (mapPxW - canvas.width) / 2
          : clamp(cx, 0, mapPxW - canvas.width)) + sway.x,
      y:
        (mapPxH <= canvas.height
          ? (mapPxH - canvas.height) / 2
          : clamp(cy, 0, mapPxH - canvas.height)) + sway.y,
    };
  }

  /**
   * Simple companion follow: nudge the inactive player toward the active one,
   * with wall collision on the given map.
   */
  protected applyCompanionFollow(
    map: GameMap,
    followDist = TILE_SIZE * FOLLOW_DISTANCE_MULTIPLIER,
    followSpeed = COMPANION_FOLLOW_SPEED,
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
      const ftxn = Math.floor((fnx + TILE_SIZE * CAMERA_CENTER_OFFSET_MULTIPLIER) / TILE_SIZE);
      if (
        map.isWalkable(
          ftxn,
          Math.floor((follower.y + TILE_SIZE * CAMERA_CENTER_OFFSET_MULTIPLIER) / TILE_SIZE),
        )
      )
        follower.x = fnx;
      const fny = clamp(follower.y + fmy, 0, mapPxH - TILE_SIZE);
      const ftyn = Math.floor((fny + TILE_SIZE * CAMERA_CENTER_OFFSET_MULTIPLIER) / TILE_SIZE);
      if (
        map.isWalkable(
          Math.floor((follower.x + TILE_SIZE * CAMERA_CENTER_OFFSET_MULTIPLIER) / TILE_SIZE),
          ftyn,
        )
      )
        follower.y = fny;
    }
    follower.isMoving = fdist > TILE_SIZE * COMPANION_MOVE_CHECK_OFFSET;
  }

  protected renderHUD(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const hud = drawHUD(ctx, canvas, this.human, this.cat, this.notifPulse, this._hudCollapsed);
    this._hudToggleRect = hud.toggleRect;
    if (platform.isMobile) {
      // Skill badge position can be overridden by subclasses that stack boss UI below
      // the HUD bar. Default: place it immediately below the HUD panel.
      this._hudSkillBannerRect = renderMobileSkillBadge(
        ctx,
        canvas,
        this.human,
        this.cat,
        this.notifPulse,
        hud.hudPanelBottom + HUD_SKILL_BADGE_GAP,
      );
    } else {
      this._hudSkillBannerRect = hud.notifRect;
    }
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
