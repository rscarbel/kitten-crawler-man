import type { GameMap } from '../map/GameMap';
import { TILE_SIZE } from '../core/constants';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { Mob } from '../creatures/Mob';
import type { HumanPlayer } from '../creatures/HumanPlayer';
import type { CatPlayer } from '../creatures/CatPlayer';
import { drawMordecaiForLevel, drawSpeechBubble } from '../sprites/mordecaiSprite';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawInteractionPrompt } from '../ui/InteractionPrompt';
import { randomFromArray, clamp } from '../utils';
import { drawText, TEXT_PRESETS } from '../ui/TextBox';

interface SafeRoomEntry {
  bounds: { x: number; y: number; w: number; h: number };
  mordecaiHomeTileX: number;
  mordecaiHomeTileY: number;
  bedTileX: number;
  bedTileY: number;
}

export class SafeRoomSystem implements GameSystem {
  private readonly entries: SafeRoomEntry[];

  private _mordecaiDialogOpen = false;
  private mordecaiLine: string | null = null;
  private mordecaiLoading = false;
  private _isSleeping = false;
  private sleepTimer = 0;
  private sleepHealed = false;

  private readonly SLEEP_TOTAL = 150;
  private readonly SLEEP_FADEIN = 30;
  private readonly SLEEP_HOLD = 90;

  // Magic number constants
  private static readonly HALFWIDTH_DIVISOR = 4;
  private static readonly WANDER_PHASE_OFFSET = 210;
  private static readonly WANDER_CYCLE = 500;
  private static readonly WANDER_WALK_FRAMES = 150;
  private static readonly WANDER_IDLE_DURATION = 100;
  private static readonly WANDER_RETURN_FRAMES = 150;
  private static readonly WANDER_MAX_OFFSET_TILES = 1.8;
  private static readonly TILE_CENTER = 0.5;
  private static readonly MORDECAI_NEAR_DISTANCE = 2.5;
  private static readonly BED_NEAR_DISTANCE = 1.8;
  private static readonly SLEEP_HEAL_TRIGGER = 5;
  private static readonly SLEEP_FRAMES_DEDUCTED = 10800;
  private static readonly BANNER_TEXT_SIZE = 10;
  private static readonly BANNER_TILE_Y_OFFSET = -1;
  private static readonly BANNER_Y_BASELINE_OFFSET = 0.65;
  private static readonly BANNER_TEXT_TOP_OFFSET = 8;
  private static readonly DIALOG_HEIGHT = 140;
  private static readonly DIALOG_MAX_WIDTH = 560;
  private static readonly DIALOG_HORIZONTAL_MARGIN = 40;
  private static readonly DIALOG_VERTICAL_MARGIN = 20;
  private static readonly DIALOG_PADDING = 14;
  private static readonly DIALOG_LINE_WIDTH = 2;
  private static readonly DIALOG_SPEAKER_SIZE = 13;
  private static readonly DIALOG_SPEAKER_Y_TOP = 10;
  private static readonly DIALOG_LOADING_SIZE = 12;
  private static readonly DIALOG_LOADING_Y_TOP = 40;
  private static readonly DIALOG_TEXT_SIZE = 12;
  private static readonly DIALOG_TEXT_Y_TOP = 34;
  private static readonly DIALOG_TEXT_WIDTH_OFFSET = 28;
  private static readonly DIALOG_LINE_HEIGHT = 18;
  private static readonly DIALOG_CLOSE_SIZE = 10;
  private static readonly DIALOG_CLOSE_Y_OFFSET = 18;
  private static readonly DIALOG_CLOSE_X_OFFSET = 12;
  private static readonly HUD_BANNER_SIZE = 12;
  private static readonly HUD_BANNER_Y_OFFSET = 18;
  private static readonly HUD_BANNER_TEXT_TOP_OFFSET = 10;
  private static readonly HUD_BANNER_ALPHA = 0.85;
  private static readonly SLEEP_TEXT_Y_OFFSET = 10;
  private static readonly SLEEP_TEXT_TOP_OFFSET = 21;
  private static readonly SLEEP_VISION_ALPHA = 0.92;
  private static readonly ZZZ_Y_OFFSET = 18;
  private static readonly ZZZ_TEXT_TOP_OFFSET = 11;
  private static readonly BED_FRAME_LEFT = 0.05;
  private static readonly BED_FRAME_TOP = 0.12;
  private static readonly BED_FRAME_WIDTH = 0.9;
  private static readonly BED_FRAME_HEIGHT = 0.8;
  private static readonly BED_PILLOW_LEFT = 0.1;
  private static readonly BED_PILLOW_TOP = 0.18;
  private static readonly BED_PILLOW_WIDTH = 0.8;
  private static readonly BED_PILLOW_HEIGHT = 0.65;
  private static readonly BED_SHEET_LEFT = 0.14;
  private static readonly BED_SHEET_TOP = 0.21;
  private static readonly BED_SHEET_WIDTH = 0.72;
  private static readonly BED_SHEET_HEIGHT = 0.2;
  private static readonly BED_BLANKET_LEFT = 0.1;
  private static readonly BED_BLANKET_TOP = 0.41;
  private static readonly BED_BLANKET_WIDTH = 0.8;
  private static readonly BED_BLANKET_HEIGHT = 0.42;
  private static readonly BED_BLANKET_FOLD_HEIGHT = 0.05;
  private static readonly BED_EDGE_HEIGHT = 0.1;
  private static readonly BED_EDGE_BOTTOM_TOP = 0.82;

  // Mordecai wander animation (shared timer, different phase per entry)
  private wanderTime = 0;

  constructor(
    private readonly gameMap: GameMap,
    _startTileX: number,
    _startTileY: number,
    private readonly levelId = 'level1',
  ) {
    this.entries = [];

    if (gameMap.safeRooms.length > 0) {
      for (const sr of gameMap.safeRooms) {
        const halfW = Math.floor(sr.bounds.w / SafeRoomSystem.HALFWIDTH_DIVISOR);
        this.entries.push({
          bounds: sr.bounds,
          mordecaiHomeTileX: sr.centre.x - halfW,
          mordecaiHomeTileY: sr.centre.y,
          bedTileX: sr.centre.x + halfW,
          bedTileY: sr.centre.y,
        });
      }
    }
  }

  /** All Mordecai home tile positions (for minimap). */
  get mordecaiPositions(): Array<{ x: number; y: number }> {
    return this.entries.map((e) => ({
      x: e.mordecaiHomeTileX,
      y: e.mordecaiHomeTileY,
    }));
  }

  get isSleeping(): boolean {
    return this._isSleeping;
  }

  get mordecaiDialogOpen(): boolean {
    return this._mordecaiDialogOpen;
  }

  set mordecaiDialogOpen(v: boolean) {
    this._mordecaiDialogOpen = v;
    if (!v) {
      this.mordecaiLine = null;
      this.mordecaiLoading = false;
    }
  }

  /** Open the dialog and populate it with the async AI response. */
  openMordecaiDialog(responsePromise: Promise<string>): void {
    this._mordecaiDialogOpen = true;
    this.mordecaiLine = null;
    this.mordecaiLoading = true;
    void responsePromise.then((text) => {
      this.mordecaiLine = text;
      this.mordecaiLoading = false;
    });
  }

  update(ctx: SystemContext): void {
    this.evictMobs(ctx.mobs, ctx.mobGrid);
    this.updateWander();
  }

  // Wander update

  updateWander(): void {
    this.wanderTime++;
  }

  /** Returns pixel offset and facing for entry i's Mordecai. */
  private getWanderState(entryIdx: number): {
    offsetX: number;
    isWalking: boolean;
    facingX: number;
  } {
    // Each entry is out of phase with others so they don't walk in unison
    const t = this.wanderTime + entryIdx * SafeRoomSystem.WANDER_PHASE_OFFSET;
    // Cycle: 150f walk right, 100f idle, 150f walk left, 100f idle = 500f
    const cycle = t % SafeRoomSystem.WANDER_CYCLE;
    const maxOffset = TILE_SIZE * SafeRoomSystem.WANDER_MAX_OFFSET_TILES;

    if (cycle < SafeRoomSystem.WANDER_WALK_FRAMES) {
      return {
        offsetX: (cycle / SafeRoomSystem.WANDER_WALK_FRAMES) * maxOffset,
        isWalking: true,
        facingX: 1,
      };
    } else if (cycle < SafeRoomSystem.WANDER_WALK_FRAMES + SafeRoomSystem.WANDER_IDLE_DURATION) {
      return { offsetX: maxOffset, isWalking: false, facingX: 1 };
    } else if (
      cycle <
      SafeRoomSystem.WANDER_WALK_FRAMES +
        SafeRoomSystem.WANDER_IDLE_DURATION +
        SafeRoomSystem.WANDER_RETURN_FRAMES
    ) {
      return {
        offsetX:
          maxOffset -
          ((cycle - SafeRoomSystem.WANDER_WALK_FRAMES - SafeRoomSystem.WANDER_IDLE_DURATION) /
            SafeRoomSystem.WANDER_RETURN_FRAMES) *
            maxOffset,
        isWalking: true,
        facingX: -1,
      };
    } else {
      return { offsetX: 0, isWalking: false, facingX: -1 };
    }
  }

  // Queries

  isEntityInSafeRoom(entity: { x: number; y: number }): boolean {
    const ts = TILE_SIZE;
    const tx = Math.floor((entity.x + ts * SafeRoomSystem.TILE_CENTER) / ts);
    const ty = Math.floor((entity.y + ts * SafeRoomSystem.TILE_CENTER) / ts);
    return this.entries.some(
      (e) =>
        tx >= e.bounds.x &&
        tx < e.bounds.x + e.bounds.w &&
        ty >= e.bounds.y &&
        ty < e.bounds.y + e.bounds.h,
    );
  }

  isNearMordecai(entity: { x: number; y: number }): boolean {
    return this.entries.some((e, i) => {
      const { offsetX } = this.getWanderState(i);
      const mx = e.mordecaiHomeTileX * TILE_SIZE + offsetX;
      const my = e.mordecaiHomeTileY * TILE_SIZE;
      return (
        Math.hypot(entity.x - mx, entity.y - my) < TILE_SIZE * SafeRoomSystem.MORDECAI_NEAR_DISTANCE
      );
    });
  }

  isNearBed(entity: { x: number; y: number }): boolean {
    return this.entries.some((e) => {
      const bx = e.bedTileX * TILE_SIZE;
      const by = e.bedTileY * TILE_SIZE;
      return (
        Math.hypot(entity.x - bx, entity.y - by) < TILE_SIZE * SafeRoomSystem.BED_NEAR_DISTANCE
      );
    });
  }

  evictMobs(_mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    const fallback =
      this.gameMap.mobSpawnPoints.length > 0
        ? this.gameMap.mobSpawnPoints
        : this.gameMap.hallwaySpawnPoints;
    if (fallback.length === 0) return;

    const ts = TILE_SIZE;
    for (const e of this.entries) {
      const b = e.bounds;
      const candidates = mobGrid.queryRect(
        b.x * ts - ts,
        b.y * ts - ts,
        b.w * ts + ts * 2,
        b.h * ts + ts * 2,
      );
      for (const mob of candidates) {
        if (!mob.isAlive) continue;
        if (this.isEntityInSafeRoom(mob)) {
          const ox = mob.x,
            oy = mob.y;
          const pt = randomFromArray(fallback);
          mob.x = pt.x * ts;
          mob.y = pt.y * ts;
          mobGrid.move(mob, ox, oy);
        }
      }
    }
  }

  startSleep(): void {
    this._isSleeping = true;
    this.sleepTimer = this.SLEEP_TOTAL;
    this.sleepHealed = false;
  }

  /** Returns frames to deduct from the level timer when sleep ends (10800), else 0. */
  updateSleep(human: HumanPlayer, cat: CatPlayer): number {
    this.sleepTimer--;

    if (
      !this.sleepHealed &&
      this.sleepTimer <= this.SLEEP_HOLD + this.SLEEP_FADEIN - SafeRoomSystem.SLEEP_HEAL_TRIGGER
    ) {
      human.hp = human.maxHp;
      cat.hp = cat.maxHp;
      this.sleepHealed = true;
    }

    if (this.sleepTimer <= 0) {
      this._isSleeping = false;
      return SafeRoomSystem.SLEEP_FRAMES_DEDUCTED; // 3 minutes at 60 fps
    }
    return 0;
  }

  renderObjects(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    active: { x: number; y: number },
    speechBubblePulse: number,
  ): void {
    const ts = TILE_SIZE;

    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const b = e.bounds;
      const { offsetX, isWalking, facingX } = this.getWanderState(i);

      // "SAFE ROOM" banner (world-space label above the room)
      // size=10, old baseline = bsy + ts*0.65; top = baseline - round(10*0.8) = baseline - 8
      const bannerTileY = b.y + SafeRoomSystem.BANNER_TILE_Y_OFFSET;
      const bannerTileX = b.x + Math.floor(b.w / 2);
      const bsx = bannerTileX * ts - camX;
      const bsy = bannerTileY * ts - camY;
      drawText(ctx, 'SAFE ROOM', {
        ...TEXT_PRESETS.label,
        x: bsx,
        y:
          bsy +
          ts * SafeRoomSystem.BANNER_Y_BASELINE_OFFSET -
          SafeRoomSystem.BANNER_TEXT_TOP_OFFSET,
        size: SafeRoomSystem.BANNER_TEXT_SIZE,
        bold: true,
        color: '#f0e4c8',
        align: 'center',
      });

      // Bed
      const bedSx = e.bedTileX * ts - camX;
      const bedSy = e.bedTileY * ts - camY;
      this.renderBed(ctx, bedSx, bedSy, ts);

      // Mordecai (wandered position)
      const msx = e.mordecaiHomeTileX * ts + offsetX - camX;
      const msy = e.mordecaiHomeTileY * ts - camY;
      drawMordecaiForLevel(ctx, msx, msy, ts, this.wanderTime, isWalking, facingX, this.levelId);

      if (this.isNearMordecai(active) && !this._mordecaiDialogOpen) {
        drawSpeechBubble(ctx, msx, msy, ts, speechBubblePulse);
      }
    }
  }

  renderUI(
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    camX: number,
    camY: number,
    active: { x: number; y: number },
  ): void {
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      const { offsetX } = this.getWanderState(i);

      // Sleep prompt near bed
      if (this.isEntityInSafeRoom(active) && this.isNearBed(active) && !this._isSleeping) {
        const bsx = e.bedTileX * TILE_SIZE - camX;
        const bsy = e.bedTileY * TILE_SIZE - camY;
        drawInteractionPrompt(ctx, bsx, bsy, TILE_SIZE, 'Sleep');
        break; // only prompt for the first nearby bed
      }

      // Talk prompt near Mordecai
      const mx = e.mordecaiHomeTileX * TILE_SIZE + offsetX - camX;
      const my = e.mordecaiHomeTileY * TILE_SIZE - camY;
      const nearThis =
        this.isEntityInSafeRoom(active) &&
        Math.hypot(
          active.x - (e.mordecaiHomeTileX * TILE_SIZE + offsetX),
          active.y - e.mordecaiHomeTileY * TILE_SIZE,
        ) <
          TILE_SIZE * SafeRoomSystem.MORDECAI_NEAR_DISTANCE &&
        !this._mordecaiDialogOpen;
      if (nearThis) {
        drawInteractionPrompt(ctx, mx, my, TILE_SIZE, 'Talk');
        break; // only prompt once
      }
    }

    // "~ Safe Room ~" HUD banner when player is inside
    // size=12, old baseline = canvas.height - 18; top = baseline - round(12*0.8) = baseline - 10
    if (this.isEntityInSafeRoom(active)) {
      drawText(ctx, '~ Safe Room ~', {
        x: canvas.width / 2,
        y:
          canvas.height -
          SafeRoomSystem.HUD_BANNER_Y_OFFSET -
          SafeRoomSystem.HUD_BANNER_TEXT_TOP_OFFSET,
        size: SafeRoomSystem.HUD_BANNER_SIZE,
        bold: true,
        color: '#f0e4c8',
        alpha: SafeRoomSystem.HUD_BANNER_ALPHA,
        align: 'center',
      });
    }
  }

  renderMordecaiDialog(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const dh = SafeRoomSystem.DIALOG_HEIGHT;
    const dw = Math.min(
      SafeRoomSystem.DIALOG_MAX_WIDTH,
      canvas.width - SafeRoomSystem.DIALOG_HORIZONTAL_MARGIN,
    );
    const dx = (canvas.width - dw) / 2;
    const dy = canvas.height - dh - SafeRoomSystem.DIALOG_VERTICAL_MARGIN;

    // Dialog background and border (drawn directly — not text)
    ctx.save();
    ctx.fillStyle = `rgba(10,8,6,${SafeRoomSystem.SLEEP_VISION_ALPHA})`;
    ctx.fillRect(dx, dy, dw, dh);
    ctx.strokeStyle = '#c8a860';
    ctx.lineWidth = SafeRoomSystem.DIALOG_LINE_WIDTH;
    ctx.strokeRect(dx, dy, dw, dh);
    ctx.restore();

    // Speaker name: size=13, old baseline = dy+20; top = dy+20 - round(13*0.8) = dy+10
    drawText(ctx, 'Mordecai', {
      x: dx + SafeRoomSystem.DIALOG_PADDING,
      y: dy + SafeRoomSystem.DIALOG_SPEAKER_Y_TOP,
      size: SafeRoomSystem.DIALOG_SPEAKER_SIZE,
      bold: true,
      color: '#c8a860',
    });

    if (this.mordecaiLoading) {
      // size=12, old baseline = dy+50; top = dy+50 - round(12*0.8) = dy+40
      drawText(ctx, '...', {
        x: dx + SafeRoomSystem.DIALOG_PADDING,
        y: dy + SafeRoomSystem.DIALOG_LOADING_Y_TOP,
        size: SafeRoomSystem.DIALOG_LOADING_SIZE,
        color: '#7a6e5a',
      });
    } else {
      // Speech text with built-in word-wrap; lineHeight=18 matches original spacing
      // First line old baseline = dy+44; top = dy+44 - round(12*0.8) = dy+34
      drawText(ctx, this.mordecaiLine ?? '', {
        x: dx + SafeRoomSystem.DIALOG_PADDING,
        y: dy + SafeRoomSystem.DIALOG_TEXT_Y_TOP,
        size: SafeRoomSystem.DIALOG_TEXT_SIZE,
        color: '#e8dfc8',
        width: dw - SafeRoomSystem.DIALOG_TEXT_WIDTH_OFFSET,
        lineHeight: SafeRoomSystem.DIALOG_LINE_HEIGHT,
      });
    }

    // Close hint: size=10, old baseline = dy+dh-10; top = dy+dh-10 - round(10*0.8) = dy+dh-18
    drawText(ctx, '[Space / Esc] Close', {
      x: dx + dw - SafeRoomSystem.DIALOG_CLOSE_X_OFFSET,
      y: dy + dh - SafeRoomSystem.DIALOG_CLOSE_Y_OFFSET,
      size: SafeRoomSystem.DIALOG_CLOSE_SIZE,
      color: '#7a6e5a',
      align: 'right',
    });
  }

  renderSleepOverlay(ctx: CanvasRenderingContext2D, canvas: HTMLCanvasElement): void {
    const t = this.sleepTimer;
    const fadeIn = this.SLEEP_FADEIN;
    const hold = this.SLEEP_HOLD;

    let alpha: number;
    if (t > hold + fadeIn) {
      alpha = 1 - (t - hold - fadeIn) / fadeIn;
    } else if (t > fadeIn) {
      alpha = 1;
    } else {
      alpha = t / fadeIn;
    }

    ctx.save();
    ctx.globalAlpha = clamp(alpha, 0, 1);
    ctx.fillStyle = '#000000';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    if (t > fadeIn && t <= hold + fadeIn) {
      // "Sleeping..." size=26, old baseline = canvas.height/2 - 10
      // top = (canvas.height/2 - 10) - round(26*0.8) = (canvas.height/2 - 10) - 21
      drawText(ctx, 'Sleeping...', {
        x: canvas.width / 2,
        y:
          canvas.height / 2 -
          SafeRoomSystem.SLEEP_TEXT_Y_OFFSET -
          SafeRoomSystem.SLEEP_TEXT_TOP_OFFSET,
        size: 26,
        bold: true,
        color: '#e2e8f0',
        align: 'center',
      });
      // "zZz" size=14, old baseline = canvas.height/2 + 18
      // top = (canvas.height/2 + 18) - round(14*0.8) = (canvas.height/2 + 18) - 11
      drawText(ctx, 'zZz', {
        x: canvas.width / 2,
        y: canvas.height / 2 + SafeRoomSystem.ZZZ_Y_OFFSET - SafeRoomSystem.ZZZ_TEXT_TOP_OFFSET,
        size: 14,
        color: '#94a3b8',
        align: 'center',
      });
    }
  }

  private renderBed(ctx: CanvasRenderingContext2D, sx: number, sy: number, s: number): void {
    ctx.fillStyle = '#7a4e2c';
    ctx.fillRect(
      sx + s * SafeRoomSystem.BED_FRAME_LEFT,
      sy + s * SafeRoomSystem.BED_FRAME_TOP,
      s * SafeRoomSystem.BED_FRAME_WIDTH,
      s * SafeRoomSystem.BED_FRAME_HEIGHT,
    );

    ctx.fillStyle = '#f0e8d8';
    ctx.fillRect(
      sx + s * SafeRoomSystem.BED_PILLOW_LEFT,
      sy + s * SafeRoomSystem.BED_PILLOW_TOP,
      s * SafeRoomSystem.BED_PILLOW_WIDTH,
      s * SafeRoomSystem.BED_PILLOW_HEIGHT,
    );

    ctx.fillStyle = '#fafaf8';
    ctx.fillRect(
      sx + s * SafeRoomSystem.BED_SHEET_LEFT,
      sy + s * SafeRoomSystem.BED_SHEET_TOP,
      s * SafeRoomSystem.BED_SHEET_WIDTH,
      s * SafeRoomSystem.BED_SHEET_HEIGHT,
    );
    ctx.strokeStyle = '#d8d0c0';
    ctx.lineWidth = 0.5;
    ctx.strokeRect(
      sx + s * SafeRoomSystem.BED_SHEET_LEFT,
      sy + s * SafeRoomSystem.BED_SHEET_TOP,
      s * SafeRoomSystem.BED_SHEET_WIDTH,
      s * SafeRoomSystem.BED_SHEET_HEIGHT,
    );

    ctx.fillStyle = '#3a6e8a';
    ctx.fillRect(
      sx + s * SafeRoomSystem.BED_BLANKET_LEFT,
      sy + s * SafeRoomSystem.BED_BLANKET_TOP,
      s * SafeRoomSystem.BED_BLANKET_WIDTH,
      s * SafeRoomSystem.BED_BLANKET_HEIGHT,
    );

    ctx.fillStyle = '#2e5a74';
    ctx.fillRect(
      sx + s * SafeRoomSystem.BED_BLANKET_LEFT,
      sy + s * SafeRoomSystem.BED_BLANKET_TOP,
      s * SafeRoomSystem.BED_BLANKET_WIDTH,
      s * SafeRoomSystem.BED_BLANKET_FOLD_HEIGHT,
    );

    ctx.fillStyle = '#5c3820';
    ctx.fillRect(
      sx + s * SafeRoomSystem.BED_FRAME_LEFT,
      sy + s * SafeRoomSystem.BED_FRAME_TOP,
      s * SafeRoomSystem.BED_FRAME_WIDTH,
      s * SafeRoomSystem.BED_EDGE_HEIGHT,
    );
    ctx.fillRect(
      sx + s * SafeRoomSystem.BED_FRAME_LEFT,
      sy + s * SafeRoomSystem.BED_EDGE_BOTTOM_TOP,
      s * SafeRoomSystem.BED_FRAME_WIDTH,
      s * SafeRoomSystem.BED_EDGE_HEIGHT,
    );
  }
}
