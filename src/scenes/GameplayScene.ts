/**
 * Abstract base class for scenes that involve player-controlled gameplay.
 * Extracts shared logic from DungeonScene and BuildingInteriorScene:
 *   - Camera calculation
 *   - Pause menu
 *   - HUD rendering
 *   - Player movement with wall collision
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
import type { HudRect } from '../ui/HUD';
import { drawHUD, renderMobileSkillBadge } from '../ui/HUD';
import { platform } from '../core/Platform';
import { viewportWidth, viewportHeight } from '../core/Viewport';

const CAMERA_CENTER_OFFSET_MULTIPLIER = 0.5;
const HUD_SKILL_BADGE_GAP = 4;

export abstract class GameplayScene extends Scene {
  abstract readonly pm: PlayerManager;
  protected abstract readonly pauseMenu: PauseMenu;
  protected abstract readonly notifPulse: { value: number };

  protected _hudCollapsed = platform.initialHudCollapsed;
  protected _hudToggleRect = { x: 0, y: 0, w: 0, h: 0 };
  protected _hudSkillBannerRect = { x: -9999, y: 0, w: 0, h: 0 };
  /** Screen rect of the HUD health-bar panel, for keeping world arrows clear of it. */
  protected _hudRect: HudRect = { x: 0, y: 0, w: 0, h: 0 };

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

  /**
   * The world point the camera centres on. The active crawler, unless a scene
   * has something to show that they are not standing next to — a cutscene the
   * party is locked out of driving.
   */
  protected cameraFocus(): { x: number; y: number } {
    const player = this.active();
    return { x: player.x, y: player.y };
  }

  protected computeCamera(map: GameMap): { x: number; y: number } {
    const player = this.active();
    const focus = this.cameraFocus();
    const mapPxW = (map.structure[0]?.length ?? map.structure.length) * TILE_SIZE;
    const mapPxH = map.structure.length * TILE_SIZE;
    const viewportH = viewportHeight() - this.viewportBottomInset();
    const cx = focus.x + TILE_SIZE * CAMERA_CENTER_OFFSET_MULTIPLIER - viewportWidth() / 2;
    const cy = focus.y + TILE_SIZE * CAMERA_CENTER_OFFSET_MULTIPLIER - viewportH / 2;
    // Applied after the clamp so the sway still reads in a room smaller than the
    // viewport, where the camera is pinned and every clamped offset would vanish.
    const sway = player.hasStatus('drunk') ? drunkCameraOffset(frameTime) : { x: 0, y: 0 };
    return {
      x:
        (mapPxW <= viewportWidth()
          ? (mapPxW - viewportWidth()) / 2
          : clamp(cx, 0, mapPxW - viewportWidth())) + sway.x,
      y:
        (mapPxH <= viewportH ? (mapPxH - viewportH) / 2 : clamp(cy, 0, mapPxH - viewportH)) +
        sway.y,
    };
  }

  protected renderHUD(ctx: CanvasRenderingContext2D): void {
    const hud = drawHUD(ctx, this.human, this.cat, this.notifPulse, this._hudCollapsed);
    this._hudToggleRect = hud.toggleRect;
    this._hudRect = hud.hudRect;
    if (platform.isMobile) {
      // Skill badge position can be overridden by subclasses that stack boss UI below
      // the HUD bar. Default: place it immediately below the HUD panel.
      this._hudSkillBannerRect = renderMobileSkillBadge(
        ctx,
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
