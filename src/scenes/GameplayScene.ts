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
const TILE_CENTER_OFFSET = 0.5;
/** Pixels the companion must actually travel in a frame to count as walking. */
const COMPANION_WALK_ANIMATION_EPSILON = 0.05;
/** Horizontal share of the travel direction needed to mirror the companion sprite. */
const COMPANION_FACING_DEADZONE = 0.2;
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

  /**
   * Height of the band at the bottom of the screen that opaque on-screen UI
   * covers, which {@link computeCamera} treats as outside the viewport so world
   * content can't end up hidden behind it. Reserves nothing by default: it only
   * earns its keep where the map's bottom edge holds something the player must
   * see, so a scene that scrolls freely there overlaps the bar harmlessly.
   *
   * Note this binds only scenes that camera through {@link computeCamera};
   * DungeonScene runs its own camera and ignores this.
   */
  protected viewportBottomInset(): number {
    return 0;
  }

  protected computeCamera(map: GameMap): { x: number; y: number } {
    const player = this.active();
    const canvas = this.sceneManager.canvas;
    const mapPxW = (map.structure[0]?.length ?? map.structure.length) * TILE_SIZE;
    const mapPxH = map.structure.length * TILE_SIZE;
    const viewportH = canvas.height - this.viewportBottomInset();
    const cx = player.x + TILE_SIZE * CAMERA_CENTER_OFFSET_MULTIPLIER - canvas.width / 2;
    const cy = player.y + TILE_SIZE * CAMERA_CENTER_OFFSET_MULTIPLIER - viewportH / 2;
    // Applied after the clamp so the sway still reads in a room smaller than the
    // viewport, where the camera is pinned and every clamped offset would vanish.
    const sway = player.hasStatus('drunk') ? drunkCameraOffset(frameTime) : { x: 0, y: 0 };
    return {
      x:
        (mapPxW <= canvas.width
          ? (mapPxW - canvas.width) / 2
          : clamp(cx, 0, mapPxW - canvas.width)) + sway.x,
      y:
        (mapPxH <= viewportH ? (mapPxH - viewportH) / 2 : clamp(cy, 0, mapPxH - viewportH)) +
        sway.y,
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
    if (fdist <= followDist) {
      follower.isMoving = false;
      return;
    }

    // Clamping the step to the remaining gap parks the companion exactly at
    // followDist. Taking a full step instead overshoots inside the gap, so the
    // next frame it stands still, the frame after it steps again — which reads
    // on screen as the sprite snapping between its idle and walk poses.
    const step = Math.min(followSpeed, fdist - followDist);
    const stepX = (fdx / fdist) * step;
    const stepY = (fdy / fdist) * step;

    const startX = follower.x;
    const startY = follower.y;

    const nextX = clamp(follower.x + stepX, 0, mapPxW - TILE_SIZE);
    const nextTileX = Math.floor((nextX + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
    if (
      map.isWalkable(
        nextTileX,
        Math.floor((follower.y + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE),
      )
    )
      follower.x = nextX;
    const nextY = clamp(follower.y + stepY, 0, mapPxH - TILE_SIZE);
    const nextTileY = Math.floor((nextY + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE);
    if (
      map.isWalkable(
        Math.floor((follower.x + TILE_SIZE * TILE_CENTER_OFFSET) / TILE_SIZE),
        nextTileY,
      )
    )
      follower.y = nextY;

    const travelledX = follower.x - startX;
    const travelledY = follower.y - startY;
    const travelled = Math.hypot(travelledX, travelledY);
    follower.isMoving = travelled > COMPANION_WALK_ANIMATION_EPSILON;
    if (follower.isMoving) {
      this.faceCompanionAlongTravel(follower, travelledX / travelled, travelledY / travelled);
    }
  }

  /**
   * Point the companion along the direction it actually travelled. The
   * horizontal sign only changes once there is a decisive left/right component,
   * so a near-vertical chase can't mirror the sprite back and forth while the
   * x delta wobbles around zero.
   */
  private faceCompanionAlongTravel(
    follower: HumanPlayer | CatPlayer,
    dirX: number,
    dirY: number,
  ): void {
    const previousSign = follower.facingX < 0 ? -1 : 1;
    const isHorizontalDecisive = Math.abs(dirX) > COMPANION_FACING_DEADZONE;
    const horizontalSign = isHorizontalDecisive ? Math.sign(dirX) : previousSign;
    follower.facingX = Math.abs(dirX) * horizontalSign;
    follower.facingY = dirY;
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
