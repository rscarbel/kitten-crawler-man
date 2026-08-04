import { Mob } from './Mob';
import type { Player } from './../Player';
import type { LootDrop } from './Mob';
import { drawShadySprite, SCRATCH_DURATION_FRAMES } from '../sprites/shadySprite';
import { drawQuestMarker, QUEST_MARKER_GOLD, QUEST_MARKER_GREEN } from '../sprites/questNPCSprite';
import { randomInt } from '../utils';

/** He never fights and never dies; the HP exists only because every Mob has one. */
const SHADY_HP = 30;
const SHADY_SPEED = 0;

/** Frames between neck scratches — long enough that it stays a tic, not a loop. */
const SCRATCH_GAP_MIN_FRAMES = 360;
const SCRATCH_GAP_MAX_FRAMES = 720;

/** Seconds of phase offset a second Shady would be desynced by. */
const LOOP_OFFSET_SPREAD_SECONDS = 4;

/**
 * How far his hood's crown stands above the top of his own tile, in tiles.
 *
 * His sheet is 1.44 tiles of art anchored with the soles near the tile's floor,
 * so everything hung off the tile origin — the quest marker most of all — lands
 * somewhere around his chest unless it is lifted by this. Measured off the bake,
 * not guessed: `npm run gen:shady` prints the anchor the gate checks.
 */
const HEAD_ABOVE_TILE_TILES = 0.78;

/** Which glyph floats over him, or none. Driven by `BountyProgress.phase`. */
export type ShadyMarker = 'exclamation' | 'question' | 'none';

/**
 * Shady — the hooded man beside the town notice board who issues and pays out
 * bounties.
 *
 * A stationary, non-combatant hook NPC in the GumGum mould: non-hostile, so
 * player attacks pass straight through him. `BountySystem` owns the state
 * machine; this class owns only where he stands, what he is doing with his
 * hands, and which glyph is over his head.
 */
export class Shady extends Mob {
  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'Shady';
  description = 'A hooded man who never quite looks at you, and never stops moving.';

  /** Set by the scene each frame from `BountyProgress.phase`. */
  markerType: ShadyMarker = 'none';
  /** Set by the scene while his dialog is open, so he leans in while he talks. */
  isTalking = false;

  private scratchFramesLeft = 0;
  private framesUntilScratch = randomInt(SCRATCH_GAP_MIN_FRAMES, SCRATCH_GAP_MAX_FRAMES);
  /**
   * Kept per-instance rather than derived from the wall clock alone: the loops
   * run off `performance.now()`, which is identical for every instance, so two
   * of him would otherwise fidget in perfect lockstep.
   */
  private readonly loopOffsetSeconds = Math.random() * LOOP_OFFSET_SPREAD_SECONDS;

  constructor(tileX: number, tileY: number, tileSize: number) {
    super(tileX, tileY, tileSize, SHADY_HP, SHADY_SPEED);
  }

  /** Drops any scratch in progress and re-arms the gap. */
  cancelScratch(): void {
    this.scratchFramesLeft = 0;
  }

  /** Plays the neck scratch now. For the preview harness, which cannot wait out its gap. */
  forceScratch(): void {
    this.scratchFramesLeft = SCRATCH_DURATION_FRAMES;
    this.framesUntilScratch = randomInt(SCRATCH_GAP_MIN_FRAMES, SCRATCH_GAP_MAX_FRAMES);
  }

  /** A bystander — never hostile, never targetable by player attacks. */
  override get isHostile(): boolean {
    return false;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  updateAI(_targets: Player[]): void {
    this.isMoving = false;
    if (this.scratchFramesLeft > 0) {
      this.scratchFramesLeft--;
      return;
    }
    // The tic is suppressed mid-conversation: reaching up under his own hood
    // while the player is reading his dialog reads as him leaving.
    if (this.isTalking) return;
    if (this.framesUntilScratch > 0) {
      this.framesUntilScratch--;
      return;
    }
    this.scratchFramesLeft = SCRATCH_DURATION_FRAMES;
    this.framesUntilScratch = randomInt(SCRATCH_GAP_MIN_FRAMES, SCRATCH_GAP_MAX_FRAMES);
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive) return;
    const box = this.spriteBox(camX, camY, tileSize);
    // Talking wins over scratching, not the other way round. `updateAI` — the
    // only thing that advances the scratch — does not run while a dialog is
    // open, so a conversation started mid-tic would otherwise freeze him with
    // his hand under his own hood for its entire duration, and the lean-in pose
    // would never appear on the ~11% of presses that land inside a scratch.
    const scratching = this.scratchFramesLeft > 0 && !this.isTalking;
    drawShadySprite(ctx, box.sx, box.sy, box.s, {
      activity: this.isTalking ? 'talk' : scratching ? 'scratch' : 'idle',
      // Counts down, so the progress it stands for runs the other way.
      scratchProgress: 1 - this.scratchFramesLeft / SCRATCH_DURATION_FRAMES,
      loopOffsetSeconds: this.loopOffsetSeconds,
    });
  }

  /**
   * Draws the bounty marker above him. Separate from `drawSelf` so the glyph is
   * painted in the scene's overlay pass rather than the Y-sorted entity pass,
   * where a market stall drawn after him would cover it.
   */
  renderMarker(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    if (!this.isAlive || this.markerType === 'none') return;
    const box = this.spriteBox(camX, camY, tileSize);
    const markerY = box.sy - tileSize * HEAD_ABOVE_TILE_TILES;
    if (this.markerType === 'exclamation') {
      drawQuestMarker(ctx, box.sx, markerY, box.s, '!', QUEST_MARKER_GOLD);
      return;
    }
    drawQuestMarker(ctx, box.sx, markerY, box.s, '?', QUEST_MARKER_GREEN);
  }

  /**
   * Drawn at plain tile size, unlike the runtime-drawn humanoid NPCs that go
   * through `scaleHumanoidBox`.
   *
   * Those figures are painted to fill a single tile and have to be enlarged to
   * stand beside the player without looking dwarfed. Shady's sheet already
   * encodes his height — 1.42 tiles against Carl's 1.46 — so scaling him again
   * would multiply the two and stand him head and shoulders over the party.
   */
  private spriteBox(camX: number, camY: number, tileSize: number) {
    return { sx: this.x - camX, sy: this.y - camY, s: tileSize };
  }
}
