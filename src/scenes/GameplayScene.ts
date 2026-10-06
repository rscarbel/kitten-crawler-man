/**
 * Abstract base class for scenes that involve player-controlled gameplay.
 * Extracts shared logic from DungeonScene and BuildingInteriorScene:
 *   - Camera calculation
 *   - Pause menu
 *   - The HUD's crawler frames, purse and skill-point badge
 *   - Player movement with wall collision
 *   - Inventory / gear panel interaction
 */

import type { SceneManager } from '../core/Scene';
import { Scene } from '../core/Scene';
import type { InputManager } from '../core/InputManager';
import { TILE_SIZE } from '../core/constants';
import { frameTime } from '../utils';
import { followCamera, type WorldRect } from './interiorCamera';
import type { ArrivalLoader } from './ArrivalLoader';
import { drunkCameraOffset } from '../core/DrunkEffect';
import type { GameMap } from '../map/GameMap';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { PlayerManager } from '../core/PlayerManager';
import type { PauseScreen } from '../ui/screens/pause/PauseScreen';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import type { AudioManager } from '../audio/AudioManager';
import type { SkillPointReminderSystem } from '../systems/SkillPointReminderSystem';
import type { SystemContext } from '../systems/GameSystem';
import type { FlyTargets, RewardFlySystem } from '../systems/RewardFlySystem';
import { SaveIndicator } from '../ui/SaveIndicator';
import type { EventBus } from '../core/EventBus';
import { displayHp } from '../core/crawlerFormulas';
import { partyCoins } from '../core/partyCoins';
import { CRAWLER_NAMES } from '../core/SkillManager';
import { statusRemainingFraction } from '../core/StatusEffect';
import { statusBadge } from '../sprites/status/statusEffectVisuals';
import type { Rect } from '../ui/core/geom';
import { toCssRect, type HudSurface } from '../ui/hud/HudSurface';
import type { HudToasts } from '../ui/hud/toasts';
import { liveHudLayout } from '../ui/hud/liveHudLayout';
import type {
  CoinModel,
  SkillPointsModel,
  StatusPillModel,
  UnitFrameModel,
} from '../ui/hud/hudModel';
import { palette } from '../ui/theme/tokens';

const CAMERA_CENTER_OFFSET_MULTIPLIER = 0.5;
/** The Cockroach pill's label: a standing capability rather than a timed effect. */
const COCKROACH_PILL_LABEL = 'ROACH';

export abstract class GameplayScene extends Scene {
  abstract readonly pm: PlayerManager;
  protected abstract readonly pauseScreen: PauseScreen;
  /**
   * Whether the skill-point badge should render in its flagged, more
   * prominent state. Owned by each concrete scene's own
   * `SkillPointReminderSystem` (they each have their own mob roster to check
   * for nearby enemies), and copied here each frame.
   */
  protected skillPointReminderActive = false;
  /** Mirrors `SkillPointReminderSystem.suppressed`: hides the skill-point badge. */
  protected skillPointsSuppressed = false;
  /** The scene's HUD, drawn from the model the scene builds each frame. */
  protected abstract readonly hud: HudSurface;

  /** Each concrete scene owns its own instance — it has its own mob roster to check. */
  protected abstract readonly skillPointReminder: SkillPointReminderSystem;
  protected abstract readonly audio: AudioManager | null;
  /**
   * The loading screen this scene arrives behind. Every gameplay scene holds
   * one, begins it last in its constructor and mounts its surfaces; while it is
   * open the scene neither updates nor draws the world.
   */
  protected abstract readonly arrivalLoading: ArrivalLoader;

  /** Whether the arrival's loading screen is still up, for harnesses waiting on it. */
  get arrivalLoadingOpen(): boolean {
    return this.arrivalLoading.isOpen;
  }

  assertReadyToEnter(): void {
    if (!this.arrivalLoading.hasBegun) {
      throw new Error(`${this.constructor.name} was entered without beginning its arrival`);
    }
  }
  /** Coins/items flying to this scene's own HUD — each concrete scene owns its own instance. */
  protected abstract readonly rewardFly: RewardFlySystem;
  /** The "Saving... / Game Saved" toast — shared so it reads the same in every scene a save can happen in. */
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
  protected cameraClearView(_map: GameMap, view: Rect, _bounds: WorldRect): Rect {
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
    const viewTop = this.viewportTopInset();
    const view: Rect = {
      x: 0,
      y: viewTop,
      w: viewportWidth(),
      h: viewportHeight() - this.viewportBottomInset() - viewTop,
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

  /** Subscribes the save toast to the scene's own bus and toast stack — call once per scene setup. */
  protected wireSaveIndicator(bus: EventBus, toasts: HudToasts): void {
    this.saveIndicator.attach(toasts);
    bus.on('gameSaved', () => this.saveIndicator.trigger());
  }

  /** Advances the save toast from "Saving..." to "Game Saved" — call once per update tick. */
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

  /** Both crawlers' unit frames, the active one first. */
  protected hudCrawlerFrames(): readonly [UnitFrameModel, UnitFrameModel] {
    return [this.unitFrameModel(this.active()), this.unitFrameModel(this.inactive())];
  }

  private unitFrameModel(player: HumanPlayer | CatPlayer): UnitFrameModel {
    const kind = player === this.human ? 'human' : 'cat';
    const status: StatusPillModel[] = player.statusEffects.map((effect, index) => {
      const badge = statusBadge(effect.type);
      return {
        id: `${effect.type}-${index}`,
        label: badge.label,
        color: badge.color,
        remaining: statusRemainingFraction(effect),
        harmful: badge.harmful,
      };
    });
    if (player.skills.isUnlocked('cockroach')) {
      const ready = player.isCockroachReady;
      status.push({
        id: 'cockroach',
        label: COCKROACH_PILL_LABEL,
        color: ready ? palette.state.warning : palette.text.muted,
        remaining: player.cockroachRechargeFraction(),
        harmful: false,
        spent: !ready,
      });
    }
    return {
      id: kind,
      name: CRAWLER_NAMES[kind],
      glyph: kind === 'human' ? 'user' : 'cat',
      level: player.level,
      hp: displayHp(player.hp),
      maxHp: player.maxHp,
      xp: player.xp,
      xpMax: player.xpNeededForNextLevel,
      status,
      skillPoints: player.unspentPoints,
    };
  }

  /**
   * The party's purse. The figure lags the real one by whatever is still in
   * flight, so it visibly ticks up as each coin sprite lands rather than
   * jumping the instant the coins are earned.
   */
  protected hudCoins(): CoinModel {
    const pending = Math.round(this.rewardFly.pendingCoinAmount());
    return {
      shown: Math.max(0, partyCoins(this.human, this.cat) - pending),
      split: `${CRAWLER_NAMES.human} ${this.human.coins} · ${CRAWLER_NAMES.cat} ${this.cat.coins}`,
      pulse: this.rewardFly.coinCounterPulse(),
    };
  }

  protected hudSkillPoints(open: () => void): SkillPointsModel {
    return { hidden: this.skillPointsSuppressed, nag: this.skillPointReminderActive, open };
  }

  /**
   * The unit frames in CSS pixels, for world chrome that keeps clear of them
   * (arrows clamped to the screen's edge): as last drawn, or as they will be
   * before the HUD's first frame.
   */
  protected hudFramesRect(): Rect {
    const frame = this.hud.frame;
    if (frame !== null) return toCssRect(frame.geometry.framesBlock, frame.uiScale);
    const live = liveHudLayout({ miniMapExpanded: false, build: false });
    return toCssRect(live.geometry.framesBlock, live.uiScale);
  }

  /**
   * Everything the HUD drew last frame that other chrome must keep off, in
   * CSS pixels: the unit frames, the minimap, the hotbar and every button.
   */
  protected hudKeepoutsCss(): Rect[] {
    const frame = this.hud.frame;
    if (frame === null) return [];
    const { geometry } = frame;
    return [
      geometry.framesBlock,
      geometry.miniMap,
      geometry.hotbar.strip,
      ...frame.dock.values(),
    ].map((rect) => toCssRect(rect, frame.uiScale));
  }

  /** Where flying coins and items land: the coin pill and the Bag button as last drawn. */
  protected hudFlyTargets(): FlyTargets {
    const coin = this.hudCoinTarget();
    return {
      coinX: coin.x,
      coinY: coin.y,
      bagRect: this.hud.cssDockRect('bag') ?? { x: coin.x, y: coin.y, w: 0, h: 0 },
    };
  }

  /** Where a flying coin lands: the middle of the coin pill as last drawn. */
  protected hudCoinTarget(): { x: number; y: number } {
    const frame = this.hud.frame;
    if (frame === null) return { x: 0, y: 0 };
    const pill = toCssRect(frame.coins, frame.uiScale);
    return { x: pill.x + pill.h / 2, y: pill.y + pill.h / 2 };
  }
}
