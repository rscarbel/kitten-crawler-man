import { TILE_SIZE } from '../core/constants';
import { Mongo } from '../creatures/Mongo';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { GameMap } from '../map/GameMap';
import { drawMongoIcon } from '../sprites/mongoSprite';
import type { GameSystem, SystemContext } from './GameSystem';
import { drawText } from '../ui/TextBox';
import { drawButton } from '../ui/Button';

/** Cooldown in seconds. */
const COOLDOWN_SECONDS = 90;

/** Frames per second. */
const FPS = 60;

/** Cooldown in frames: 90 seconds at 60 fps. */
const COOLDOWN_FRAMES = COOLDOWN_SECONDS * FPS; // 5400

/** Duration speech bubble stays visible (frames). */
const SPEECH_DURATION = 150; // 2.5 seconds

// Rendering constants
const MONGO_BUTTON_ICON_SIZE_RATIO = 0.6;
const MONGO_BUTTON_LABEL_Y_OFFSET = 5;
const MONGO_BUTTON_LABEL_OFFSET = 7;
const MONGO_BUTTON_LABEL_SIZE = 9;
const MONGO_COOLDOWN_TEXT_Y_OFFSET_UP = 10;
const MONGO_COOLDOWN_TEXT_Y_OFFSET_DOWN = 4;
const MONGO_COOLDOWN_TEXT_SIZE = 12;
const MONGO_COOLDOWN_OVERLAY_ALPHA = 0.6;
const MONGO_ICON_Y_OFFSET = 4;

// Speech bubble rendering
const SPEECH_BUBBLE_ALPHA_DECAY_TIME = 30; // frames
const SPEECH_BUBBLE_FONT_SIZE = 11;
const SPEECH_BUBBLE_BOLD_FONT = 'bold 11px monospace';
const SPEECH_BUBBLE_OFFSET_X_RATIO = 0.5;
const SPEECH_BUBBLE_OFFSET_Y = 28;
const SPEECH_BUBBLE_PADDING = 16;
const SPEECH_BUBBLE_PADDING_CORNERS = 6;
const SPEECH_BUBBLE_BG_ALPHA = 0.8;
const SPEECH_BUBBLE_BORDER_WIDTH = 1;
const SPEECH_BUBBLE_BORDER_COLOR = '#60a5fa';
const SPEECH_BUBBLE_POINTER_SIZE = 5;
const SPEECH_BUBBLE_POINTER_HEIGHT = 6;
const SPEECH_BUBBLE_TEXT_Y_OFFSET = 15;
const SPEECH_BUBBLE_TEXT_Y_ADJUST = 9;

export class MongoSystem implements GameSystem {
  /** Whether the player has unlocked Mongo by defeating the Krakaren Clone. */
  unlocked = false;

  /** The currently active Mongo instance (null when not summoned). */
  mongo: Mongo | null = null;

  /** Cooldown timer — when > 0, summon button is disabled. */
  cooldownFrames = 0;

  /** Current speech bubble text shown above the cat. */
  speechText: string | null = null;
  /** Remaining frames for the speech bubble. */
  speechTimer = 0;

  /** Whether Mongo is currently recalling (running back before despawn). */
  private isRecalling = false;

  /**
   * Summon Mongo near the cat.
   * Returns the new Mongo instance to be added to the mobs array + grid.
   */
  summon(cat: CatPlayer, gameMap: GameMap, levelId: string): Mongo | null {
    if (!this.unlocked || this.mongo || this.cooldownFrames > 0) return null;

    // Spawn 1 tile behind the cat
    const tx = Math.floor(cat.x / TILE_SIZE) - Math.round(cat.facingX);
    const ty = Math.floor(cat.y / TILE_SIZE) - Math.round(cat.facingY);
    // Fallback: spawn at cat's tile if behind isn't walkable
    const spawnTx = gameMap.isWalkable(tx, ty) ? tx : Math.floor(cat.x / TILE_SIZE);
    const spawnTy = gameMap.isWalkable(tx, ty) ? ty : Math.floor(cat.y / TILE_SIZE);

    this.mongo = new Mongo(spawnTx, spawnTy, TILE_SIZE, cat, levelId);
    this.mongo.setMap(gameMap);
    this.isRecalling = false;

    this.speechText = 'Go Mongo!';
    this.speechTimer = SPEECH_DURATION;

    return this.mongo;
  }

  /**
   * Called each frame to update Mongo state, cooldown, and speech.
   * Returns true if Mongo just fully despawned (so DungeonScene can remove it).
   */
  update(ctx: SystemContext): boolean {
    const { mobs, mobGrid } = ctx;
    // Tick cooldown
    if (this.cooldownFrames > 0) this.cooldownFrames--;

    // Tick speech
    if (this.speechTimer > 0) this.speechTimer--;
    if (this.speechTimer <= 0) this.speechText = null;

    if (!this.mongo) return false;

    // Set allMobs for Mongo's AI
    this.mongo.allMobs = mobs;

    // Check if Mongo's HP hit 0 from damage (not from recall completion)
    if (!this.isRecalling && this.mongo.hp <= 0 && !this.mongo.isAlive) {
      // Mongo was killed by enemies — start recall
      // Actually his HP is 0 so he's dead. We need to catch before death.
      // Instead, check HP threshold before it reaches 0.
    }

    // Check if Mongo's HP is low enough to trigger recall
    if (!this.isRecalling && this.mongo.isAlive && this.mongo.hp <= 0) {
      this.startRecall();
    }

    // Check HP reaching 1 or below to start recall (before actual death)
    if (!this.isRecalling && this.mongo.isAlive && this.mongo.hp <= 1) {
      this.startRecall();
    }

    // If recalling and Mongo reached the cat (hp set to 0 by Mongo.updateAI)
    if (this.isRecalling && !this.mongo.isAlive) {
      return this.finishDespawn(mobs, mobGrid);
    }

    return false;
  }

  /**
   * Explicitly check Mongo's health. Called from DungeonScene after mob
   * damage resolution. If Mongo took lethal damage, intercept and start recall.
   */
  checkHealth(): void {
    if (!this.mongo || this.isRecalling) return;
    if (this.mongo.hp <= 0) {
      // Restore 1 HP so Mongo can run back
      this.mongo.hp = 1;
      this.startRecall();
    }
  }

  private startRecall(): void {
    if (!this.mongo || this.isRecalling) return;
    this.isRecalling = true;
    this.mongo.recalling = true;
    this.speechText = 'Mongo, come back!';
    this.speechTimer = SPEECH_DURATION;
  }

  private finishDespawn(mobs: Mob[], mobGrid: SpatialGrid<Mob>): boolean {
    if (!this.mongo) return false;
    mobGrid.remove(this.mongo);
    const idx = mobs.indexOf(this.mongo);
    if (idx >= 0) mobs.splice(idx, 1);
    this.mongo = null;
    this.isRecalling = false;
    this.cooldownFrames = COOLDOWN_FRAMES;
    return true;
  }

  /** Manually dismiss Mongo (e.g. floor transition). */
  dismiss(mobs: Mob[], mobGrid: SpatialGrid<Mob>): void {
    if (!this.mongo) return;
    this.finishDespawn(mobs, mobGrid);
    // No cooldown on manual dismiss during floor transitions
    this.cooldownFrames = 0;
  }

  /** Whether the summon button should be shown. */
  get canShow(): boolean {
    return this.unlocked;
  }

  /** Whether the summon button is currently usable. */
  get canSummon(): boolean {
    return this.unlocked && !this.mongo && this.cooldownFrames <= 0;
  }

  /** Returns cooldown remaining as a 0–1 ratio for UI display. */
  get cooldownRatio(): number {
    if (this.cooldownFrames <= 0) return 0;
    return this.cooldownFrames / COOLDOWN_FRAMES;
  }

  /** Returns cooldown in whole seconds for display. */
  get cooldownSeconds(): number {
    return Math.ceil(this.cooldownFrames / FPS);
  }

  /**
   * Render the Summon button. Works for both desktop and mobile.
   * Returns the button rect for hit-testing.
   */
  renderSummonButton(
    ctx: CanvasRenderingContext2D,
    x: number,
    y: number,
    w: number,
    h: number,
    isCatActive: boolean,
  ): { x: number; y: number; w: number; h: number } {
    const rect = { x, y, w, h };
    if (!this.unlocked || !isCatActive) return rect;

    const canUse = this.canSummon;
    const isActive = !!this.mongo;

    drawButton(ctx, {
      x,
      y,
      width: w,
      height: h,
      label: '',
      fill: isActive ? 'rgba(37,99,235,0.30)' : canUse ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.45)',
      border: isActive ? '#2563eb' : canUse ? '#475569' : '#334155',
      borderWidth: 1.5,
      radius: 0,
    });

    // Raptor icon
    const iconSize = Math.min(w, h) * MONGO_BUTTON_ICON_SIZE_RATIO;
    drawMongoIcon(ctx, x + w / 2, y + h / 2 - MONGO_ICON_Y_OFFSET, iconSize);

    // Label
    drawText(ctx, isActive ? 'Active' : 'Summon', {
      x: x + w / 2,
      y: y + h - MONGO_BUTTON_LABEL_Y_OFFSET - MONGO_BUTTON_LABEL_OFFSET,
      size: MONGO_BUTTON_LABEL_SIZE,
      color: canUse ? '#94a3b8' : '#64748b',
      align: 'center',
    });

    // Cooldown overlay
    if (this.cooldownFrames > 0) {
      ctx.save();
      ctx.fillStyle = `rgba(0,0,0,${MONGO_COOLDOWN_OVERLAY_ALPHA})`;
      const fillH = h * this.cooldownRatio;
      ctx.fillRect(x, y + h - fillH, w, fillH);
      ctx.restore();
      drawText(ctx, `${this.cooldownSeconds}s`, {
        x: x + w / 2,
        y: y + h / 2 + MONGO_COOLDOWN_TEXT_Y_OFFSET_DOWN - MONGO_COOLDOWN_TEXT_Y_OFFSET_UP,
        size: MONGO_COOLDOWN_TEXT_SIZE,
        bold: true,
        color: '#ef4444',
        align: 'center',
      });
    }

    return rect;
  }

  /**
   * Render the cat's speech bubble for Mongo-related lines.
   */
  renderSpeechBubble(ctx: CanvasRenderingContext2D, catScreenX: number, catScreenY: number): void {
    if (!this.speechText || this.speechTimer <= 0) return;

    const alpha = Math.min(1, this.speechTimer / SPEECH_BUBBLE_ALPHA_DECAY_TIME);
    const text = this.speechText;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = SPEECH_BUBBLE_BOLD_FONT;
    const tw = ctx.measureText(text).width;
    const bw = tw + SPEECH_BUBBLE_PADDING;
    const bh = 22;
    const bx = catScreenX + TILE_SIZE * SPEECH_BUBBLE_OFFSET_X_RATIO - bw / 2;
    const by = catScreenY - SPEECH_BUBBLE_OFFSET_Y;

    // Bubble background
    ctx.fillStyle = `rgba(0,0,0,${SPEECH_BUBBLE_BG_ALPHA})`;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, SPEECH_BUBBLE_PADDING_CORNERS);
    ctx.fill();

    // Bubble border
    ctx.strokeStyle = SPEECH_BUBBLE_BORDER_COLOR;
    ctx.lineWidth = SPEECH_BUBBLE_BORDER_WIDTH;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, SPEECH_BUBBLE_PADDING_CORNERS);
    ctx.stroke();

    // Pointer triangle
    ctx.fillStyle = `rgba(0,0,0,${SPEECH_BUBBLE_BG_ALPHA})`;
    ctx.beginPath();
    ctx.moveTo(
      catScreenX + TILE_SIZE * SPEECH_BUBBLE_OFFSET_X_RATIO - SPEECH_BUBBLE_POINTER_SIZE,
      by + bh,
    );
    ctx.lineTo(
      catScreenX + TILE_SIZE * SPEECH_BUBBLE_OFFSET_X_RATIO,
      by + bh + SPEECH_BUBBLE_POINTER_HEIGHT,
    );
    ctx.lineTo(
      catScreenX + TILE_SIZE * SPEECH_BUBBLE_OFFSET_X_RATIO + SPEECH_BUBBLE_POINTER_SIZE,
      by + bh,
    );
    ctx.closePath();
    ctx.fill();

    // Text
    drawText(ctx, text, {
      x: catScreenX + TILE_SIZE * SPEECH_BUBBLE_OFFSET_X_RATIO,
      y: by + SPEECH_BUBBLE_TEXT_Y_OFFSET - SPEECH_BUBBLE_TEXT_Y_ADJUST,
      size: SPEECH_BUBBLE_FONT_SIZE,
      bold: true,
      color: '#e0f2fe',
      align: 'center',
      alpha,
    });

    ctx.restore();
  }
}
