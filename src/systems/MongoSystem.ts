import { TILE_SIZE } from '../core/constants';
import { Mongo } from '../creatures/Mongo';
import type { CatPlayer } from '../creatures/CatPlayer';
import type { Mob } from '../creatures/Mob';
import type { SpatialGrid } from '../core/SpatialGrid';
import type { GameMap } from '../map/GameMap';
import { drawMongoIcon } from '../sprites/mongoSprite';
import type { GameSystem, SystemContext } from './GameSystem';

/** Cooldown in frames: 90 seconds at 60 fps. */
const COOLDOWN_FRAMES = 90 * 60; // 5400

/** Duration speech bubble stays visible (frames). */
const SPEECH_DURATION = 150; // 2.5 seconds

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
    return Math.ceil(this.cooldownFrames / 60);
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

    // Background
    ctx.fillStyle = isActive
      ? 'rgba(37,99,235,0.30)'
      : canUse
        ? 'rgba(0,0,0,0.65)'
        : 'rgba(0,0,0,0.45)';
    ctx.fillRect(x, y, w, h);

    // Border
    ctx.strokeStyle = isActive ? '#2563eb' : canUse ? '#475569' : '#334155';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x, y, w, h);

    // Raptor icon
    const iconSize = Math.min(w, h) * 0.6;
    drawMongoIcon(ctx, x + w / 2, y + h / 2 - 4, iconSize);

    // Label
    ctx.textAlign = 'center';
    ctx.font = '9px monospace';
    ctx.fillStyle = canUse ? '#94a3b8' : '#64748b';
    ctx.fillText(isActive ? 'Active' : 'Summon', x + w / 2, y + h - 5);

    // Cooldown overlay
    if (this.cooldownFrames > 0) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      const fillH = h * this.cooldownRatio;
      ctx.fillRect(x, y + h - fillH, w, fillH);

      ctx.fillStyle = '#ef4444';
      ctx.font = 'bold 12px monospace';
      ctx.fillText(`${this.cooldownSeconds}s`, x + w / 2, y + h / 2 + 4);
    }

    ctx.textAlign = 'left';
    return rect;
  }

  /**
   * Render the cat's speech bubble for Mongo-related lines.
   */
  renderSpeechBubble(ctx: CanvasRenderingContext2D, catScreenX: number, catScreenY: number): void {
    if (!this.speechText || this.speechTimer <= 0) return;

    const alpha = Math.min(1, this.speechTimer / 30); // fade out in last 0.5s
    const text = this.speechText;

    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = 'bold 11px monospace';
    const tw = ctx.measureText(text).width;
    const bw = tw + 16;
    const bh = 22;
    const bx = catScreenX + TILE_SIZE * 0.5 - bw / 2;
    const by = catScreenY - 28;

    // Bubble background
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 6);
    ctx.fill();

    // Bubble border
    ctx.strokeStyle = '#60a5fa';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.roundRect(bx, by, bw, bh, 6);
    ctx.stroke();

    // Pointer triangle
    ctx.fillStyle = 'rgba(0,0,0,0.8)';
    ctx.beginPath();
    ctx.moveTo(catScreenX + TILE_SIZE * 0.5 - 5, by + bh);
    ctx.lineTo(catScreenX + TILE_SIZE * 0.5, by + bh + 6);
    ctx.lineTo(catScreenX + TILE_SIZE * 0.5 + 5, by + bh);
    ctx.closePath();
    ctx.fill();

    // Text
    ctx.fillStyle = '#e0f2fe';
    ctx.textAlign = 'center';
    ctx.fillText(text, catScreenX + TILE_SIZE * 0.5, by + 15);
    ctx.textAlign = 'left';

    ctx.restore();
  }
}
