/**
 * Localhost-only harness for watching the Krakaren Clone boss.
 *
 * Reached via `?krakaren` in `devBootScene`; never on a production path.
 *
 * Drives the real baked-sheet painters — `drawKrakarenSprite`,
 * `drawKrakarenTentacleSprite` and `drawKrakarenSlamTentacle` — rather than any
 * procedural stand-in. The body grid cycles idle/melee/slam-channel across all
 * four facings and the enrage toggle; the guard-tentacle panel hand-drives the
 * real `KrakarenTentacle` state machine (no live `Mob` instance, since that
 * needs a roster and `Player` targets this harness has neither of) and routes
 * a kill through the real `BodyPartGoreSystem`; the slam panel loops
 * rise/loom/dive/smash off `krakarenAttackTiming.ts`'s shares, the one place
 * that timing is written down.
 */

import { Scene } from '../core/Scene';
import { viewportWidth, viewportHeight } from '../core/Viewport';
import { drawText } from '../ui/TextBox';
import { addButton, playButtonSound, setButtonMouseState, BUTTON_PRESETS } from '../ui/Button';
import { drawProgressBar, PROGRESS_PRESETS } from '../ui/Box';
import {
  drawKrakarenSprite,
  drawKrakarenEnrageGlow,
  drawSlamShadow,
  drawSlamImpact,
  drawKrakarenSlamTentacle,
  KRAKAREN_ENRAGED_FILTER,
  type KrakarenSpriteState,
} from '../sprites/krakarenSprite';
import {
  drawKrakarenTentacleSprite,
  KRAKAREN_TENTACLE_BODY_PART_KEY,
} from '../sprites/krakarenTentacleSprite';
import {
  KRAKAREN_IDLE_FRAMES,
  KRAKAREN_CHANNEL_FRAMES,
  GUARD_TENTACLE_EMERGE_FRAMES,
  GUARD_TENTACLE_IDLE_FRAMES,
  GUARD_TENTACLE_STRIKE_FRAMES,
  GUARD_TENTACLE_RETREAT_FRAMES,
  SLAM_RISE_SHARE,
  SLAM_LOOM_SHARE,
  SLAM_DIVE_SHARE,
} from '../sprites/krakarenAttackTiming';
import {
  TENTACLE_EMERGE_TELEGRAPH_FRAMES,
  TENTACLE_STRIKE_WINDUP_FRAMES,
} from '../creatures/KrakarenTentacle';
import type { SlamTentacleMarker } from '../creatures/KrakarenClone';
import { GameMap } from '../map/GameMap';
import { BodyPartGoreSystem } from '../systems/BodyPartGoreSystem';

/** A facing vector per column, chosen so the wrapper picks each viewpoint. */
interface ViewSpec {
  readonly label: string;
  readonly facingX: number;
  readonly facingY: number;
}

const VIEWS: ReadonlyArray<ViewSpec> = [
  { label: 'side →', facingX: 1, facingY: 0 },
  { label: 'side ←', facingX: -1, facingY: 0 },
  { label: 'toward', facingX: 0, facingY: 1 },
  { label: 'away', facingX: 0, facingY: -1 },
];

type BodyStateKind = 'idle' | 'melee_windup' | 'melee_swing' | 'slam_charging';

interface BodyRowSpec {
  readonly kind: BodyStateKind;
  readonly gameFrames: number;
}

/**
 * Mirrors `KrakarenClone`'s current private windup/swing/slam timers so the
 * preview paces like the real fight; none of the three is exported.
 */
const IDLE_GAME_FRAMES = 90;
const MELEE_WINDUP_GAME_FRAMES = 20;
const MELEE_SWING_GAME_FRAMES = 15;
const SLAM_CHARGE_GAME_FRAMES = 90;

const BODY_ROWS: ReadonlyArray<BodyRowSpec> = [
  { kind: 'idle', gameFrames: IDLE_GAME_FRAMES },
  { kind: 'melee_windup', gameFrames: MELEE_WINDUP_GAME_FRAMES },
  { kind: 'melee_swing', gameFrames: MELEE_SWING_GAME_FRAMES },
  { kind: 'slam_charging', gameFrames: SLAM_CHARGE_GAME_FRAMES },
];

const ZOOM_IN_GAME = 1;
const ZOOM_DOUBLE = 2;
const ZOOM_REVIEW = 4;
const ZOOM_LEVELS: ReadonlyArray<number> = [ZOOM_IN_GAME, ZOOM_DOUBLE, ZOOM_REVIEW];

const SPEED_QUARTER = 0.25;
const SPEED_HALF = 0.5;
const SPEED_FULL = 1;
const SPEED_LEVELS: ReadonlyArray<number> = [SPEED_QUARTER, SPEED_HALF, SPEED_FULL];

/** The floor mids a Krakaren Clone actually stands on, from `scripts/tilegen/palette.ts`. */
const BACKDROPS: ReadonlyArray<{ readonly name: string; readonly color: string }> = [
  { name: 'floor 2 — poured concrete', color: '#888e96' },
  { name: 'unlit cave', color: '#2a2f2b' },
  { name: 'lair — wet stone', color: '#3c4644' },
];

const BASE_TILE_SIZE = 32;
const MARGIN = 16;
const HEADER_HEIGHT = 68;
const ROW_LABEL_WIDTH = 96;
const CELL_PADDING = 10;
const LABEL_SIZE = 11;
const LABEL_GAP = 2;
const TITLE_SIZE = 16;
const BUTTON_HEIGHT = 26;
const BUTTON_WIDTH = 116;
const BUTTON_GAP = 8;
const CONTROL_ROW_GAP = 8;
/** The Krakaren's tentacles reach nearly 3 tiles past its 1-tile footprint. */
const CELL_WIDTH_TILES = 5.2;
const CELL_HEIGHT_TILES = 4.4;
const GROUND_FRACTION = 0.62;
const FRAMES_PER_SECOND = 60;

/** Gore needs a map to settle onto; a small empty one is enough for a preview. */
const PREVIEW_MAP_SIZE = 24;
const KILL_IMPACT_X = 1;
const KILL_IMPACT_Y = -0.4;

// --- Guard tentacle panel: hand-driven `KrakarenTentacle` state machine ----
//
// A live `KrakarenTentacle` mob needs a `GameMap`, a mob roster and `Player`
// targets to drive `updateAI` — none of which this harness has any reason to
// stand up. Its state names, transitions and the sprite calls below match the
// real mob's `drawSelf` exactly; only the *timers that decide when to move
// between states* are this scene's own, since the real ones are either
// player-proximity-driven (there is no player here) or private constants
// `KrakarenTentacle.ts` doesn't export.
type PreviewTentaclePhase =
  | 'emerging'
  | 'idle'
  | 'strike_windup'
  | 'striking'
  | 'strike_cooldown'
  | 'retreating'
  | 'respawn_wait';

/** How long a baked animation cell holds, mirroring `KrakarenTentacle`'s own private per-cell hold (not exported). */
const PREVIEW_TENTACLE_FRAMES_PER_CELL = 3;
const TENTACLE_EMERGE_ANIMATION_FRAMES =
  GUARD_TENTACLE_EMERGE_FRAMES * PREVIEW_TENTACLE_FRAMES_PER_CELL;
const TENTACLE_STRIKE_ANIMATION_FRAMES =
  GUARD_TENTACLE_STRIKE_FRAMES * PREVIEW_TENTACLE_FRAMES_PER_CELL;
const TENTACLE_RETREAT_ANIMATION_FRAMES =
  GUARD_TENTACLE_RETREAT_FRAMES * PREVIEW_TENTACLE_FRAMES_PER_CELL;

/**
 * How long it sways in `idle` before striking on its own. The real tentacle
 * strikes the instant a player is in range rather than on a timer, so this is
 * a preview-only pacing beat that stands in for "a player walked up".
 */
const PREVIEW_IDLE_BEFORE_STRIKE_FRAMES =
  GUARD_TENTACLE_IDLE_FRAMES * PREVIEW_TENTACLE_FRAMES_PER_CELL;

/** Mirrors `KrakarenTentacle`'s private TENTACLE_STRIKE_COOLDOWN_FRAMES, which isn't exported. */
const PREVIEW_TENTACLE_STRIKE_COOLDOWN_FRAMES = 90;

/** Pause between a retreat/kill and the next spawn — a preview-only loop beat, not part of the real machine. */
const PREVIEW_TENTACLE_RESPAWN_WAIT_FRAMES = 40;

/** Mirrors `KrakarenTentacle`'s private GUARD_TENTACLE_HP, which isn't exported. */
const PREVIEW_TENTACLE_MAX_HP = 15;
/** Two clicks of "damage tentacle" is enough to kill it and see the gore route fire. */
const PREVIEW_TENTACLE_STRIKE_DAMAGE = 8;

const TENTACLE_PANEL_WIDTH = 220;
const TENTACLE_PANEL_HEIGHT = 220;
const TENTACLE_HEALTH_BAR_WIDTH = 140;
const TENTACLE_HEALTH_BAR_HEIGHT = 10;

// --- Slam sequence panel ---------------------------------------------------

/** Mirrors `KrakarenClone`'s private SLAM_SHADOW_FRAMES/SLAM_IMPACT_FRAMES, neither of which is exported. */
const SLAM_SHADOW_GAME_FRAMES = 90;
const SLAM_IMPACT_GAME_FRAMES = 20;
const SLAM_LOOP_GAME_FRAMES = SLAM_SHADOW_GAME_FRAMES + SLAM_IMPACT_GAME_FRAMES;
const SLAM_PANEL_SIZE = 220;

/** Where the telegraph window hands the tentacle from one slam row to the next. */
const SLAM_LOOM_START = SLAM_RISE_SHARE;
const SLAM_DIVE_START = SLAM_RISE_SHARE + SLAM_LOOM_SHARE;

/** Where the rise tentacle sits relative to the target ring, as a fraction of the panel. */
const SLAM_RISE_OFFSET_FRACTION = 0.22;

export class KrakarenPreviewScene extends Scene {
  private readonly map = new GameMap({ mapSize: PREVIEW_MAP_SIZE });
  private readonly gore = new BodyPartGoreSystem(this.map);

  private readonly buttons: Array<{
    x: number;
    y: number;
    w: number;
    h: number;
    action?: () => void;
  }> = [];

  private zoomIndex = ZOOM_LEVELS.indexOf(ZOOM_DOUBLE);
  private speedIndex = SPEED_LEVELS.length - 1;
  private backdropIndex = 0;
  private paused = false;
  private isEnraged = false;
  /** Fractional frame counter, so a 0.25× speed still advances. */
  private clock = 0;
  private stepRequested = false;

  private tentaclePhase: PreviewTentaclePhase = 'emerging';
  private tentacleTelegraphTimer = TENTACLE_EMERGE_TELEGRAPH_FRAMES;
  private tentaclePhaseTimer = TENTACLE_EMERGE_ANIMATION_FRAMES;
  private tentacleHp = PREVIEW_TENTACLE_MAX_HP;

  update(): void {
    const stepping = this.stepRequested;
    if (stepping) {
      this.clock += 1;
      this.stepRequested = false;
    } else if (!this.paused) {
      this.clock += SPEED_LEVELS[this.speedIndex];
    }
    if (!this.paused || stepping) {
      this.advanceTentacle();
    }
    this.gore.update();
  }

  private advanceTentacle(): void {
    switch (this.tentaclePhase) {
      case 'emerging':
        this.doEmerging();
        break;
      case 'idle':
        this.doIdle();
        break;
      case 'strike_windup':
        this.doStrikeWindup();
        break;
      case 'striking':
        this.doStriking();
        break;
      case 'strike_cooldown':
        this.doStrikeCooldown();
        break;
      case 'retreating':
        this.doRetreating();
        break;
      case 'respawn_wait':
        this.doRespawnWait();
        break;
    }
  }

  private doEmerging(): void {
    if (this.tentacleTelegraphTimer > 0) {
      this.tentacleTelegraphTimer--;
      return;
    }
    this.tentaclePhaseTimer--;
    if (this.tentaclePhaseTimer <= 0) {
      this.tentaclePhase = 'idle';
      this.tentaclePhaseTimer = PREVIEW_IDLE_BEFORE_STRIKE_FRAMES;
    }
  }

  private doIdle(): void {
    this.tentaclePhaseTimer--;
    if (this.tentaclePhaseTimer <= 0) {
      this.tentaclePhase = 'strike_windup';
      this.tentaclePhaseTimer = TENTACLE_STRIKE_WINDUP_FRAMES;
    }
  }

  private doStrikeWindup(): void {
    this.tentaclePhaseTimer--;
    if (this.tentaclePhaseTimer <= 0) {
      this.tentaclePhase = 'striking';
      this.tentaclePhaseTimer = TENTACLE_STRIKE_ANIMATION_FRAMES;
    }
  }

  private doStriking(): void {
    this.tentaclePhaseTimer--;
    if (this.tentaclePhaseTimer <= 0) {
      this.tentaclePhase = 'strike_cooldown';
      this.tentaclePhaseTimer = PREVIEW_TENTACLE_STRIKE_COOLDOWN_FRAMES;
    }
  }

  private doStrikeCooldown(): void {
    this.tentaclePhaseTimer--;
    if (this.tentaclePhaseTimer <= 0) {
      this.tentaclePhase = 'retreating';
      this.tentaclePhaseTimer = TENTACLE_RETREAT_ANIMATION_FRAMES;
    }
  }

  private doRetreating(): void {
    this.tentaclePhaseTimer--;
    if (this.tentaclePhaseTimer <= 0) this.beginRespawnWait();
  }

  private doRespawnWait(): void {
    this.tentaclePhaseTimer--;
    if (this.tentaclePhaseTimer <= 0) this.beginEmerge();
  }

  private beginRespawnWait(): void {
    this.tentaclePhase = 'respawn_wait';
    this.tentaclePhaseTimer = PREVIEW_TENTACLE_RESPAWN_WAIT_FRAMES;
  }

  private beginEmerge(): void {
    this.tentaclePhase = 'emerging';
    this.tentacleTelegraphTimer = TENTACLE_EMERGE_TELEGRAPH_FRAMES;
    this.tentaclePhaseTimer = TENTACLE_EMERGE_ANIMATION_FRAMES;
    this.tentacleHp = PREVIEW_TENTACLE_MAX_HP;
  }

  /**
   * Manual strike: damages the tentacle and, on a kill, routes the real gore
   * burst through `BodyPartGoreSystem` with the tentacle's own registered
   * parts — the same call a killed `KrakarenTentacle` triggers in the live game.
   */
  private damageTentacle(cx: number, cy: number): void {
    if (this.tentaclePhase === 'respawn_wait') return;
    if (this.tentaclePhase === 'emerging' && this.tentacleTelegraphTimer > 0) return;
    this.tentacleHp -= PREVIEW_TENTACLE_STRIKE_DAMAGE;
    if (this.tentacleHp > 0) return;

    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    this.gore.spawnParts(
      cx,
      cy,
      KRAKAREN_TENTACLE_BODY_PART_KEY,
      tile,
      KILL_IMPACT_X,
      KILL_IMPACT_Y,
    );
    this.beginRespawnWait();
  }

  /** 0–1 through hauling itself out of the floor, or null once it is fully risen. */
  private get tentacleEmergeProgress(): number | null {
    if (this.tentaclePhase !== 'emerging' || this.tentacleTelegraphTimer > 0) return null;
    return 1 - this.tentaclePhaseTimer / TENTACLE_EMERGE_ANIMATION_FRAMES;
  }

  private get tentacleStrikeProgress(): number | null {
    if (this.tentaclePhase !== 'striking') return null;
    return 1 - this.tentaclePhaseTimer / TENTACLE_STRIKE_ANIMATION_FRAMES;
  }

  private get tentacleRetreatProgress(): number | null {
    if (this.tentaclePhase !== 'retreating') return null;
    return 1 - this.tentaclePhaseTimer / TENTACLE_RETREAT_ANIMATION_FRAMES;
  }

  /** False while it is only a floor telegraph, or between a kill/retreat and the next spawn. */
  private get tentacleVisible(): boolean {
    if (this.tentaclePhase === 'respawn_wait') return false;
    if (this.tentaclePhase === 'emerging' && this.tentacleTelegraphTimer > 0) return false;
    return true;
  }

  /** 0–1 through a row's own game-frame span. */
  private progressOf(gameFrames: number): number {
    return (Math.floor(this.clock) % gameFrames) / gameFrames;
  }

  private cellSize(): { readonly w: number; readonly h: number } {
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    return { w: tile * CELL_WIDTH_TILES, h: tile * CELL_HEIGHT_TILES };
  }

  render(ctx: CanvasRenderingContext2D): void {
    const width = viewportWidth();
    const height = viewportHeight();
    this.buttons.length = 0;

    ctx.fillStyle = BACKDROPS[this.backdropIndex].color;
    ctx.fillRect(0, 0, width, height);

    this.renderHeader(ctx, width);
    this.renderBodyGrid(ctx);
    this.renderTentaclePanel(ctx, width);
    this.renderSlamPanel(ctx, width, height);

    this.gore.renderSettled(ctx, 0, 0);
    this.gore.renderFlying(ctx, 0, 0);
  }

  /** Everything the body sprite needs for one row × facing cell. */
  private bodySpriteState(row: BodyRowSpec, view: ViewSpec, progress: number): KrakarenSpriteState {
    const idleFrame =
      row.kind === 'melee_swing'
        ? null
        : Math.floor(
            progress *
              (row.kind === 'slam_charging' ? KRAKAREN_CHANNEL_FRAMES : KRAKAREN_IDLE_FRAMES),
          );

    return {
      facingX: view.facingX,
      facingY: view.facingY,
      // `KrakarenClone.swipeProgress` is only non-null mid-swing — melee windup
      // has no dedicated art of its own and draws idle, same as here.
      swipeProgress: row.kind === 'melee_swing' ? progress : null,
      isChanneling: row.kind === 'slam_charging',
      idleFrame,
    };
  }

  private renderBodyGrid(ctx: CanvasRenderingContext2D): void {
    const cell = this.cellSize();
    const gridLeft = MARGIN + ROW_LABEL_WIDTH;
    const gridTop = HEADER_HEIGHT + MARGIN;
    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    const animTime = this.clock / FRAMES_PER_SECOND;

    VIEWS.forEach((view, column) => {
      const x = gridLeft + column * (cell.w + CELL_PADDING);
      drawText(ctx, view.label, {
        x: x + cell.w / 2,
        y: gridTop - LABEL_SIZE - LABEL_GAP,
        size: LABEL_SIZE,
        align: 'center',
        color: '#f4efe4',
        outline: true,
      });
    });

    BODY_ROWS.forEach((row, rowIndex) => {
      const y = gridTop + rowIndex * (cell.h + CELL_PADDING);
      const progress = this.progressOf(row.gameFrames);
      drawText(ctx, row.kind, {
        x: MARGIN,
        y: y + cell.h / 2 - LABEL_SIZE,
        size: LABEL_SIZE,
        color: '#f4efe4',
        outline: true,
      });
      drawText(ctx, `t${progress.toFixed(2)}  ${row.gameFrames}gf`, {
        x: MARGIN,
        y: y + cell.h / 2 + LABEL_GAP,
        size: LABEL_SIZE,
        color: '#e8dcd4',
        outline: true,
      });

      VIEWS.forEach((view, column) => {
        const x = gridLeft + column * (cell.w + CELL_PADDING);
        const sx = x + cell.w / 2 - tile / 2;
        const sy = y + cell.h * GROUND_FRACTION - tile / 2;

        ctx.save();
        ctx.beginPath();
        ctx.rect(x, y, cell.w, cell.h);
        ctx.clip();

        if (this.isEnraged) {
          drawKrakarenEnrageGlow(ctx, sx, sy, tile, animTime);
          ctx.filter = KRAKAREN_ENRAGED_FILTER;
        }
        drawKrakarenSprite(ctx, sx, sy, tile, this.bodySpriteState(row, view, progress));
        ctx.filter = 'none';
        ctx.restore();

        ctx.strokeStyle = 'rgba(255,255,255,0.14)';
        ctx.strokeRect(x, y, cell.w, cell.h);
      });
    });
  }

  private renderTentaclePanel(ctx: CanvasRenderingContext2D, width: number): void {
    const x = width - TENTACLE_PANEL_WIDTH - MARGIN;
    const y = HEADER_HEIGHT + MARGIN;
    const cx = x + TENTACLE_PANEL_WIDTH / 2;
    const groundY = y + TENTACLE_PANEL_HEIGHT * GROUND_FRACTION;

    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.strokeRect(x, y, TENTACLE_PANEL_WIDTH, TENTACLE_PANEL_HEIGHT);

    drawText(ctx, `guard tentacle — ${this.tentaclePhase}`, {
      x: cx,
      y: y + LABEL_SIZE,
      size: LABEL_SIZE,
      align: 'center',
      color: '#f4efe4',
      outline: true,
    });

    if (this.tentacleVisible) {
      const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, TENTACLE_PANEL_WIDTH, TENTACLE_PANEL_HEIGHT);
      ctx.clip();
      drawKrakarenTentacleSprite(ctx, cx - tile / 2, groundY - tile / 2, tile, {
        facingX: 0,
        facingY: 1,
        emergeProgress: this.tentacleEmergeProgress,
        strikeProgress: this.tentacleStrikeProgress,
        retreatProgress: this.tentacleRetreatProgress,
      });
      ctx.restore();
    }

    drawProgressBar(ctx, {
      x: cx - TENTACLE_HEALTH_BAR_WIDTH / 2,
      y: y + TENTACLE_PANEL_HEIGHT - TENTACLE_HEALTH_BAR_HEIGHT - LABEL_GAP,
      width: TENTACLE_HEALTH_BAR_WIDTH,
      height: TENTACLE_HEALTH_BAR_HEIGHT,
      value: this.tentacleHp / PREVIEW_TENTACLE_MAX_HP,
      ...PROGRESS_PRESETS.hp,
    });
  }

  /**
   * Where the slam tentacle is in its performance this frame, computed the
   * same way `KrakarenClone.slamTentacle` computes it: the telegraph window is
   * divided between `rise`/`loom`/`dive` by `krakarenAttackTiming.ts`'s shares,
   * and the impact window is `smash`.
   */
  private slamMarker(
    frameInLoop: number,
    riseX: number,
    riseY: number,
    targetX: number,
    targetY: number,
  ): SlamTentacleMarker {
    if (frameInLoop < SLAM_SHADOW_GAME_FRAMES) {
      const telegraph = frameInLoop / SLAM_SHADOW_GAME_FRAMES;
      if (telegraph < SLAM_LOOM_START) {
        return {
          phase: 'rise',
          progress: telegraph / SLAM_RISE_SHARE,
          riseX,
          riseY,
          targetX,
          targetY,
          mirrored: false,
        };
      }
      if (telegraph < SLAM_DIVE_START) {
        return {
          phase: 'loom',
          progress: (telegraph - SLAM_LOOM_START) / SLAM_LOOM_SHARE,
          riseX,
          riseY,
          targetX,
          targetY,
          mirrored: false,
        };
      }
      return {
        phase: 'dive',
        progress: (telegraph - SLAM_DIVE_START) / SLAM_DIVE_SHARE,
        riseX,
        riseY,
        targetX,
        targetY,
        mirrored: false,
      };
    }
    return {
      phase: 'smash',
      progress: (frameInLoop - SLAM_SHADOW_GAME_FRAMES) / SLAM_IMPACT_GAME_FRAMES,
      riseX,
      riseY,
      targetX,
      targetY,
      mirrored: false,
    };
  }

  private renderSlamPanel(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const x = width - SLAM_PANEL_SIZE - MARGIN;
    const y = height - SLAM_PANEL_SIZE - MARGIN;
    const targetX = x + SLAM_PANEL_SIZE / 2;
    const targetY = y + SLAM_PANEL_SIZE / 2;
    const riseX = targetX - SLAM_PANEL_SIZE * SLAM_RISE_OFFSET_FRACTION;
    const riseY = targetY - SLAM_PANEL_SIZE * SLAM_RISE_OFFSET_FRACTION;

    ctx.strokeStyle = 'rgba(255,255,255,0.14)';
    ctx.strokeRect(x, y, SLAM_PANEL_SIZE, SLAM_PANEL_SIZE);
    drawText(ctx, 'slam sequence — loop', {
      x: targetX,
      y: y + LABEL_SIZE,
      size: LABEL_SIZE,
      align: 'center',
      color: '#f4efe4',
      outline: true,
    });

    const tile = BASE_TILE_SIZE * ZOOM_LEVELS[this.zoomIndex];
    const frameInLoop = Math.floor(this.clock) % SLAM_LOOP_GAME_FRAMES;
    const marker = this.slamMarker(frameInLoop, riseX, riseY, targetX, targetY);

    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, SLAM_PANEL_SIZE, SLAM_PANEL_SIZE);
    ctx.clip();

    if (frameInLoop < SLAM_SHADOW_GAME_FRAMES) {
      const telegraphProgress = frameInLoop / SLAM_SHADOW_GAME_FRAMES;
      const diveProgress = marker.phase === 'dive' ? marker.progress : 0;
      drawSlamShadow(ctx, targetX, targetY, tile, telegraphProgress, diveProgress);
    } else {
      const impactProgress = (frameInLoop - SLAM_SHADOW_GAME_FRAMES) / SLAM_IMPACT_GAME_FRAMES;
      drawSlamImpact(ctx, targetX, targetY, tile, impactProgress);
    }

    // Decals are floor paint and the tentacle is the thing standing on it, so
    // it is drawn over both — matching `BossRoomSystem.renderKrakarenSlams`.
    const standsAtTarget = marker.phase === 'smash';
    const drawX = standsAtTarget ? marker.targetX : marker.riseX;
    const drawY = standsAtTarget ? marker.targetY : marker.riseY;
    drawKrakarenSlamTentacle(ctx, drawX - tile / 2, drawY - tile / 2, tile, marker);

    ctx.restore();
  }

  private control(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    label: string,
    action: () => void,
  ): number {
    addButton(ctx, this.buttons, {
      ...BUTTON_PRESETS.toggle,
      x,
      y,
      width: BUTTON_WIDTH,
      height: BUTTON_HEIGHT,
      label,
      action,
    });
    return x + BUTTON_WIDTH + BUTTON_GAP;
  }

  private renderHeader(ctx: CanvasRenderingContext2D, width: number): void {
    drawText(ctx, 'krakaren preview — ?krakaren', {
      x: MARGIN,
      y: MARGIN + TITLE_SIZE,
      size: TITLE_SIZE,
      color: '#fdfaf2',
      outline: true,
    });

    let x = MARGIN;
    const y = MARGIN + TITLE_SIZE + CONTROL_ROW_GAP;
    x = this.control(ctx, x, y, `zoom ${ZOOM_LEVELS[this.zoomIndex]}x`, () => {
      this.zoomIndex = (this.zoomIndex + 1) % ZOOM_LEVELS.length;
    });
    x = this.control(ctx, x, y, this.paused ? 'play' : 'pause', () => {
      this.paused = !this.paused;
    });
    x = this.control(ctx, x, y, 'step', () => {
      this.paused = true;
      this.stepRequested = true;
    });
    x = this.control(ctx, x, y, `speed ${SPEED_LEVELS[this.speedIndex]}x`, () => {
      this.speedIndex = (this.speedIndex + 1) % SPEED_LEVELS.length;
    });
    x = this.control(ctx, x, y, 'backdrop', () => {
      this.backdropIndex = (this.backdropIndex + 1) % BACKDROPS.length;
    });
    x = this.control(ctx, x, y, this.isEnraged ? 'enraged: on' : 'enraged: off', () => {
      this.isEnraged = !this.isEnraged;
    });
    this.control(ctx, x, y, 'damage tentacle', () => {
      const vw = viewportWidth();
      const cx = vw - TENTACLE_PANEL_WIDTH / 2 - MARGIN;
      const groundY = HEADER_HEIGHT + MARGIN + TENTACLE_PANEL_HEIGHT * GROUND_FRACTION;
      this.damageTentacle(cx, groundY);
    });

    drawText(ctx, BACKDROPS[this.backdropIndex].name, {
      x: width - MARGIN,
      y: MARGIN + TITLE_SIZE,
      size: LABEL_SIZE,
      align: 'right',
      color: '#e6e0d2',
      outline: true,
    });
  }

  handleMouseMove(mx: number, my: number): void {
    setButtonMouseState(mx, my);
  }

  handleClick(mx: number, my: number): void {
    for (const button of this.buttons) {
      const inside =
        mx >= button.x && mx <= button.x + button.w && my >= button.y && my <= button.y + button.h;
      if (!inside) continue;
      playButtonSound(null);
      button.action?.();
      return;
    }
  }
}
