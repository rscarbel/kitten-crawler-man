import { Mob, type LootDrop, type PlayerDamageType } from './Mob';
import type { Player } from '../Player';
import type { EyePlacement } from '../sprites/eyePlacement';
import type { StatusEffect } from '../core/combat/StatusEffect';
import { timeFrameIndex } from '../core/spriteAssets/SpriteRenderer';
import {
  GOBLIN_PRISONER_EYES,
  drawGoblinPrisonerSprite,
  type GoblinPrisonerState,
} from '../sprites/goblinGuardSprite';
import { GOBLIN_PRISONER_ROWS } from '../sprites/art/goblinGuardFigure';
import { TimedSpeech, drawTimedSpeechBubble, type TimedBubbleStyle } from '../sprites/speechBubble';
import { worldPalette } from '../ui/theme/worldInk';
import type { BarkLine } from '../dialog/line';
import { PRISONER_HECKLE_BARKS } from '../dialog/scripts/scenes/stealthKeySnatch';
import { pickFreshLine } from '../dialog/scripts/scenes/cloggedBathroom';
import { bathroomSeedFraction } from './BathroomGoblin';

const MINIMUM_LIVE_HP = 1;
const FRAMES_PER_SECOND = 60;
const MILLISECONDS_PER_SECOND = 1000;
const HALF = 0.5;
const PRISONER_CULL_MARGIN_TILES = 1.5;
const PRISONER_LOOP_FPS = 8;

/** The shortest and longest a prisoner holds one idle before choosing the next, in frames. */
const BEAT_MIN_SECONDS = 3;
const BEAT_SPREAD_SECONDS = 4;
const BEAT_MIN_FRAMES = BEAT_MIN_SECONDS * FRAMES_PER_SECOND;
const BEAT_SPREAD_FRAMES = BEAT_SPREAD_SECONDS * FRAMES_PER_SECOND;
/** How long a heckle's bubble stays up. */
const HECKLE_BUBBLE_FRAMES = 120;

/** The idles a prisoner cycles through, in the order its seed walks them. */
const PRISONER_BEATS: ReadonlyArray<GoblinPrisonerState> = [
  'idle',
  'rattle',
  'idle',
  'lean',
  'heckle',
];

const PRISONER_BUBBLE_STYLE: TimedBubbleStyle = {
  border: worldPalette.ink.hint,
  text: worldPalette.ink.bright,
};

function rowFrameCount(name: GoblinPrisonerState): number {
  return GOBLIN_PRISONER_ROWS.find((row) => row.name === name)?.frameCount ?? 1;
}

/**
 * A goblin locked in one of the prison's cells: scenery that rattles the bars,
 * leans and heckles.
 *
 * A `Mob` so it draws, sorts and shows eye shine like every other body in the
 * dark, but it is nothing else: nobody's enemy, never hit (no weapon reaches
 * it, not even a blast), never pushed, never detected and never detecting,
 * and it never blocks a crawler — its cell's bars do that. It moves on
 * its own schedule only, so the owning scene just ticks it; a heckle raises
 * {@link heckleCuePending} and a rattle {@link rattleCuePending} for the scene
 * to voice.
 */
export class PrisonerGoblin extends Mob {
  readonly xpValue = 0;
  protected coinDropMin = 0;
  protected coinDropMax = 0;
  displayName = 'Prisoner';
  description = 'Says he is innocent. Is not.';

  readonly seed: number;
  readonly speech = new TimedSpeech();
  /** The idle it is playing now. */
  beat: GoblinPrisonerState = 'idle';
  /** Set when it starts a heckle; the owning scene plays the cue and clears it. */
  heckleCuePending = false;
  /** Set when it starts rattling its bars; the owning scene plays the cue and clears it. */
  rattleCuePending = false;

  private beatIndex: number;
  private beatFramesLeft: number;
  private heckles = 0;
  private lastHeckle: BarkLine | null = null;

  protected override get eyePlacement(): EyePlacement {
    return GOBLIN_PRISONER_EYES;
  }

  /** @param seed fixes its rhythm and its lines, so neighbouring cells never act in step. */
  constructor(tileX: number, tileY: number, tileSize: number, seed: number) {
    super(tileX, tileY, tileSize, MINIMUM_LIVE_HP, 0);
    this.seed = seed;
    this.paysNoRewards = true;
    this.cannotBeKilled = true;
    this.immuneToConfusion = true;
    this.beatIndex = Math.floor(bathroomSeedFraction(seed, 0) * PRISONER_BEATS.length);
    this.beatFramesLeft = this.rollBeatFrames();
  }

  private rollBeatFrames(): number {
    const fraction = bathroomSeedFraction(this.seed, this.beatIndex + 1);
    return BEAT_MIN_FRAMES + Math.floor(fraction * BEAT_SPREAD_FRAMES);
  }

  override get isHostile(): boolean {
    return false;
  }

  override get isPetAttackable(): boolean {
    return false;
  }

  override get countsTowardRoomClear(): boolean {
    return false;
  }

  override canBeConverted(): boolean {
    return false;
  }

  override get blowsEarnNothing(): boolean {
    return true;
  }

  override get acceptsWards(): boolean {
    return false;
  }

  override get separationAnchored(): boolean {
    return true;
  }

  override get ignoresMobCollision(): boolean {
    return true;
  }

  override get displacesPlayers(): boolean {
    return false;
  }

  protected override acceptsShove(_x: number, _y: number): boolean {
    return false;
  }

  override applyKnockback(
    _dirX: number,
    _dirY: number,
    _distancePx: number,
    _frames: number,
  ): void {
    // Refused: nothing the party does may move or hold this goblin.
  }

  override applyStatus(_effect: StatusEffect): void {
    // Refused: nothing the party does may move or hold this goblin.
  }

  override get cullMarginTiles(): number {
    return PRISONER_CULL_MARGIN_TILES;
  }

  protected override get isDamageImmune(): boolean {
    return true;
  }

  protected override admitsPlayerDamage(_damageType: PlayerDamageType | null): boolean {
    return false;
  }

  protected rollLootItems(_killer: Player | null): LootDrop['items'] {
    return [];
  }

  /** Its idle schedule and speech. */
  updateAI(_targets: Player[]): void {
    this.speech.tick();
    this.beatFramesLeft--;
    if (this.beatFramesLeft > 0) return;
    this.beatIndex = (this.beatIndex + 1) % PRISONER_BEATS.length;
    this.beat = PRISONER_BEATS[this.beatIndex];
    this.beatFramesLeft = this.rollBeatFrames();
    if (this.beat === 'rattle') this.rattleCuePending = true;
    if (this.beat !== 'heckle') return;
    const line = pickFreshLine(PRISONER_HECKLE_BARKS, this.seed, this.heckles, this.lastHeckle);
    this.lastHeckle = line;
    this.heckles++;
    this.speech.say(line.paragraphs[0], { durationFrames: HECKLE_BUBBLE_FRAMES });
    this.heckleCuePending = true;
  }

  /** Never far enough from the party to sleep: a cell block heckles whoever walks it. */
  override get exemptFromAiActivationRadius(): boolean {
    return true;
  }

  protected override drawSelf(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    tileSize: number,
  ): void {
    if (!this.isAlive) return;
    const seconds = performance.now() / MILLISECONDS_PER_SECOND;
    const sx = this.x - camX;
    const sy = this.y - camY;
    const frame = timeFrameIndex(seconds, PRISONER_LOOP_FPS, rowFrameCount(this.beat));
    const artTopY = this.paintSpriteMeasuringTop(ctx, sy, () => {
      drawGoblinPrisonerSprite(ctx, {
        x: sx,
        y: sy,
        tileSize,
        facingX: this.facingX,
        state: this.beat,
        frame,
      });
    });
    drawTimedSpeechBubble(ctx, this.speech, sx + tileSize * HALF, artTopY, PRISONER_BUBBLE_STYLE);
  }
}
