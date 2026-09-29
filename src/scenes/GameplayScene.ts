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
import { frameTime, pointInRect } from '../utils';
import { followCamera, type ScreenRect, type WorldRect } from './interiorCamera';
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
import type { AudioManager } from '../audio/AudioManager';
import type { SkillPointReminderSystem } from '../systems/SkillPointReminderSystem';
import type { SystemContext } from '../systems/GameSystem';
import type { RewardFlySystem } from '../systems/RewardFlySystem';
import { SaveIndicator } from '../ui/SaveIndicator';
import type { EventBus } from '../core/EventBus';

const CAMERA_CENTER_OFFSET_MULTIPLIER = 0.5;
const HUD_SKILL_BADGE_GAP = 4;

export abstract class GameplayScene extends Scene {
  abstract readonly pm: PlayerManager;
  protected abstract readonly pauseMenu: PauseMenu;
  protected abstract readonly notifPulse: { value: number };

  protected _hudCollapsed = platform.initialHudCollapsed;
  protected _hudToggleRect = { x: 0, y: 0, w: 0, h: 0 };
  protected _hudSkillBannerRect = { x: -9999, y: 0, w: 0, h: 0 };
  /**
   * Whether the "spend it" box should render in its flagged, more-prominent
   * state. Owned by each concrete scene's own `SkillPointReminderSystem` (they
   * each have their own mob roster to check for nearby enemies), and copied
   * here each frame before `renderHUD` runs.
   */
  protected skillPointReminderActive = false;
  /** Mirrors `SkillPointReminderSystem.suppressed`: hides the skill-point badge. */
  protected skillPointsSuppressed = false;
  /** Screen rect of the HUD health-bar panel, for keeping world arrows clear of it. */
  protected _hudRect: HudRect = { x: 0, y: 0, w: 0, h: 0 };

  /** Each concrete scene owns its own instance — it has its own mob roster to check. */
  protected abstract readonly skillPointReminder: SkillPointReminderSystem;
  protected abstract readonly audio: AudioManager | null;
  /** Coins/items flying to this scene's own HUD — each concrete scene owns its own instance. */
  protected abstract readonly rewardFly: RewardFlySystem;
  /** The "Saving... / Game Saved" banner — shared so it renders identically in every scene a save can happen in. */
  protected readonly saveIndicator = new SaveIndicator();

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

  /**
   * Height of the band at the top of the screen that on-screen chrome covers,
   * which {@link computeCamera} keeps the map's top edge below. The top-edge
   * sibling of {@link viewportBottomInset}.
   */
  protected viewportTopInset(): number {
    return 0;
  }

  /**
   * The world rect {@link computeCamera} keeps reachable: every edge of it can
   * be brought on screen, and none is pulled further in. The map's tile grid
   * unless a scene frames something larger.
   */
  protected cameraWorldBounds(map: GameMap): WorldRect {
    const mapPxW = (map.structure[0]?.length ?? map.structure.length) * TILE_SIZE;
    const mapPxH = map.structure.length * TILE_SIZE;
    return { left: 0, top: 0, right: mapPxW, bottom: mapPxH };
  }

  /**
   * The part of the view {@link computeCamera} frames the world's edges
   * against — the whole view unless a scene's chrome permanently covers some
   * of it.
   */
  protected cameraClearView(_map: GameMap, view: ScreenRect, _bounds: WorldRect): ScreenRect {
    return view;
  }

  /**
   * The furthest the camera's focus can travel on this map, when a scene
   * knows it — lets {@link computeCamera} reach every edge on a screen too
   * small for a centred focus to get there. Null: centre the focus throughout.
   */
  protected cameraFocusRange(_map: GameMap): WorldRect | null {
    return null;
  }

  protected computeCamera(map: GameMap): { x: number; y: number } {
    const player = this.active();
    const focus = this.cameraFocus();
    const focusCentreOffset = TILE_SIZE * CAMERA_CENTER_OFFSET_MULTIPLIER;
    const bounds = this.cameraWorldBounds(map);
    const view = {
      left: 0,
      top: this.viewportTopInset(),
      right: viewportWidth(),
      bottom: viewportHeight() - this.viewportBottomInset(),
    };
    const camera = followCamera(
      { x: focus.x + focusCentreOffset, y: focus.y + focusCentreOffset },
      bounds,
      view,
      this.cameraClearView(map, view, bounds),
      this.cameraFocusRange(map),
    );
    // Applied after the clamp so the sway still reads in a room smaller than the
    // viewport, where the camera is pinned and every clamped offset would vanish.
    const sway = player.hasStatus('drunk') ? drunkCameraOffset(frameTime) : { x: 0, y: 0 };
    return { x: camera.x + sway.x, y: camera.y + sway.y };
  }

  /** Subscribes the save banner to the scene's own bus — call once per scene setup. */
  protected wireSaveIndicator(bus: EventBus): void {
    bus.on('gameSaved', () => this.saveIndicator.trigger());
  }

  /** Advances the save banner's fade/phase timing — call once per update tick. */
  protected tickSaveIndicator(): void {
    this.saveIndicator.update();
  }

  /** Advances the shared skill-point nag and drains its sound cue into `audio`. */
  protected tickSkillPointReminder(ctx: SystemContext): void {
    this.skillPointReminder.update(ctx);
    this.skillPointReminderActive = this.skillPointReminder.reminderActive;
    this.skillPointsSuppressed = this.skillPointReminder.suppressed;
    if (this.skillPointReminder.reminderSoundPending) {
      this.skillPointReminder.reminderSoundPending = false;
      this.audio?.play('skillpoint_reminder');
    }
  }

  protected renderHUD(ctx: CanvasRenderingContext2D): void {
    const hud = drawHUD(
      ctx,
      this.human,
      this.cat,
      this.notifPulse,
      this._hudCollapsed,
      this.skillPointReminderActive,
      this.skillPointsSuppressed,
      {
        pendingAmount: this.rewardFly.pendingCoinAmount(),
        pulse: this.rewardFly.coinCounterPulse(),
      },
      this.hudToggleClearOfX(),
    );
    this._hudToggleRect = hud.toggleRect;
    this._hudRect = hud.hudRect;
    if (platform.isMobile) {
      this._hudSkillBannerRect = renderMobileSkillBadge(
        ctx,
        this.human,
        this.cat,
        this.notifPulse,
        this.mobileSkillBadgeTop(hud.hudPanelBottom),
        this.skillPointReminderActive,
        this.skillPointsSuppressed,
      );
    } else {
      this._hudSkillBannerRect = hud.notifRect;
    }
    this.saveIndicator.render(ctx);
  }

  /**
   * The minimap's left edge, which the HUD panel's collapse toggle steps
   * aside for (see `hudToggleRect`). A scene with no minimap over the panel
   * leaves the toggle in its corner.
   */
  protected hudToggleClearOfX(): number {
    return Infinity;
  }

  /**
   * Where a phone's skill-point badge starts: just under the HUD panel, unless
   * a scene stacks something of its own there first.
   */
  protected mobileSkillBadgeTop(hudPanelBottom: number): number {
    return hudPanelBottom + HUD_SKILL_BADGE_GAP;
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
