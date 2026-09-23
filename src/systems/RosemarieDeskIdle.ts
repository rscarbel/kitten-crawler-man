import { TILE_SIZE } from '../core/constants';
import { CLUB_DANCER_TILES } from '../core/clubLayout';
import {
  drawRosemarieSprite,
  drawThrownCoin,
  rosemarieCoinReleasePoint,
} from '../sprites/rosemarieSprite';
import {
  ROSEMARIE_COIN_TOSS_DURATION_MS,
  ROSEMARIE_COIN_TOSS_RELEASE_PROGRESS,
} from '../sprites/rosemarieTiming';
import { TimedSpeech, drawTimedSpeechBubble, type TimedBubbleStyle } from '../sprites/speechBubble';

const FRAMES_PER_SECOND = 60;
const MS_PER_SECOND = 1000;
const COIN_TOSS_FRAMES = Math.round(
  (ROSEMARIE_COIN_TOSS_DURATION_MS * FRAMES_PER_SECOND) / MS_PER_SECOND,
);

/**
 * Seconds between one toss and the next. Long enough that a player at the desk
 * sees it as a habit of hers rather than a loop, short enough that anyone
 * crossing the club catches one.
 */
const MIN_SECONDS_BETWEEN_TOSSES = 7;
const MAX_SECONDS_BETWEEN_TOSSES = 15;
/** The first toss comes sooner, so walking in is when the habit shows. */
const FIRST_TOSS_SECONDS = 3;

/** Ground the coin covers per frame: quick enough to read as a flick, not a lob. */
const COIN_PIXELS_PER_FRAME = 7;
const MIN_COIN_FLIGHT_FRAMES = 24;
/** Peak height of the arc as a share of the distance thrown. */
const COIN_ARC_HEIGHT_PER_DISTANCE = 0.3;
/** Turns a second the coin spins in flight. */
const COIN_SPIN_TURNS_PER_SECOND = 3;
/** The parabola `4t(1 − t)` peaks at 1 halfway through, so scaling it by the arc height is exact. */
const PARABOLA_PEAK_SCALE = 4;

/**
 * Where on a dancer she aims, in tiles below the dancer's tile top: the face.
 * Club dancers are grown to a crawler's height, so the head sits above the tile.
 */
const DANCER_FACE_Y_IN_TILE = -0.2;
/** The top of a dancer's head above its tile, where a bark's pointer lands. */
const DANCER_HEAD_Y_IN_TILE = -0.5;
const TILE_CENTRE = 0.5;

/** Not every coin gets a complaint; the ones that do read as the room's running joke. */
const DANCER_BARK_CHANCE = 0.55;
const DANCER_BARKS: readonly string[] = [
  'Not the eye, Rosemarie!',
  'OW! That one had an edge on it!',
  "Rosemarie, I've only got the one good eye left!",
  'Tip the stage, not my face!',
  "She's winding up again!",
  'Every. Single. Night.',
];
/** Club-light pink, so a dancer's yelp never reads as a hireling's bark. */
const DANCER_SPEECH_STYLE: TimedBubbleStyle = { border: '#ff2d78', text: '#ffe0ee' };

interface CoinFlight {
  readonly startX: number;
  readonly startY: number;
  readonly endX: number;
  readonly endY: number;
  readonly arcHeight: number;
  readonly frames: number;
  readonly dancerIndex: number;
  elapsed: number;
}

/**
 * Rosemarie's life behind the Meat Shields desk when nobody is hiring: she
 * hobbles on her cane, and every so often she flicks a coin at a dancer's face
 * and the dancer complains about it.
 *
 * Owns her clock, her coin-toss row and the coin in flight, so the figure the
 * club sorts and the coin it flies agree on the frame the coin leaves her hand.
 */
export class RosemarieDeskIdle {
  private clockFrames = 0;
  private tossFrame: number | null = null;
  private framesUntilToss = FIRST_TOSS_SECONDS * FRAMES_PER_SECOND;
  private coin: CoinFlight | null = null;
  private readonly bark = new TimedSpeech();
  private barkingDancer = 0;

  constructor(
    private readonly tile: { readonly x: number; readonly y: number },
    private readonly random: () => number = Math.random,
  ) {}

  /** 60 Hz ticks on her own steady clock, for anything animating in step with the desk. */
  get ticks(): number {
    return this.clockFrames;
  }

  /** The same clock in seconds, which is what her figure runs on. */
  get timeSeconds(): number {
    return this.clockFrames / FRAMES_PER_SECOND;
  }

  /**
   * One 60 Hz tick. `serving` holds off a new toss while the player is at her
   * desk — she is busy selling — but lets a coin already in the air land.
   */
  update(serving: boolean): void {
    this.clockFrames++;
    this.bark.tick();
    this.advanceCoin();
    if (this.tossFrame !== null) {
      this.advanceToss();
      return;
    }
    if (serving) return;
    this.framesUntilToss--;
    if (this.framesUntilToss <= 0) this.tossFrame = 0;
  }

  private advanceToss(): void {
    if (this.tossFrame === null) return;
    const before = this.tossFrame / COIN_TOSS_FRAMES;
    this.tossFrame++;
    const after = this.tossFrame / COIN_TOSS_FRAMES;
    const crossedRelease =
      before < ROSEMARIE_COIN_TOSS_RELEASE_PROGRESS &&
      after >= ROSEMARIE_COIN_TOSS_RELEASE_PROGRESS;
    if (crossedRelease) this.releaseCoin();
    if (this.tossFrame >= COIN_TOSS_FRAMES) {
      this.tossFrame = null;
      this.framesUntilToss = this.nextTossDelayFrames();
    }
  }

  private nextTossDelayFrames(): number {
    const spread = MAX_SECONDS_BETWEEN_TOSSES - MIN_SECONDS_BETWEEN_TOSSES;
    const seconds = MIN_SECONDS_BETWEEN_TOSSES + this.random() * spread;
    return Math.round(seconds * FRAMES_PER_SECOND);
  }

  private releaseCoin(): void {
    const dancerIndex = Math.floor(this.random() * CLUB_DANCER_TILES.length);
    const dancer = CLUB_DANCER_TILES[dancerIndex];
    const hand = rosemarieCoinReleasePoint();
    const startX = (this.tile.x + hand.x) * TILE_SIZE;
    const startY = (this.tile.y + hand.y) * TILE_SIZE;
    const endX = (dancer.x + TILE_CENTRE) * TILE_SIZE;
    const endY = (dancer.y + DANCER_FACE_Y_IN_TILE) * TILE_SIZE;
    const distance = Math.hypot(endX - startX, endY - startY);
    this.coin = {
      startX,
      startY,
      endX,
      endY,
      arcHeight: distance * COIN_ARC_HEIGHT_PER_DISTANCE,
      frames: Math.max(MIN_COIN_FLIGHT_FRAMES, Math.round(distance / COIN_PIXELS_PER_FRAME)),
      dancerIndex,
      elapsed: 0,
    };
  }

  private advanceCoin(): void {
    const coin = this.coin;
    if (coin === null) return;
    coin.elapsed++;
    if (coin.elapsed < coin.frames) return;
    this.coin = null;
    if (this.random() >= DANCER_BARK_CHANCE) return;
    const line = DANCER_BARKS[Math.floor(this.random() * DANCER_BARKS.length)];
    this.barkingDancer = coin.dancerIndex;
    this.bark.say(line);
  }

  /** Draws her at the desk; the club sorts her on her own tile like the rest of the staff. */
  render(ctx: CanvasRenderingContext2D, camX: number, camY: number, tileSize: number): void {
    const tossFrame = this.tossFrame;
    const sx = this.tile.x * TILE_SIZE - camX;
    const sy = this.tile.y * TILE_SIZE - camY;
    if (tossFrame === null) {
      drawRosemarieSprite(ctx, sx, sy, tileSize, { row: 'idle', timeSeconds: this.timeSeconds });
      return;
    }
    drawRosemarieSprite(ctx, sx, sy, tileSize, {
      row: 'coin_toss',
      timeSeconds: this.timeSeconds,
      progress: tossFrame / COIN_TOSS_FRAMES,
    });
  }

  /**
   * The coin in flight and any dancer's complaint, drawn over the sorted pass:
   * the coin is in the air above everyone, and a bark behind a patron is a bark
   * nobody reads.
   */
  renderOverlay(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    const coin = this.coin;
    if (coin !== null) {
      const t = coin.elapsed / coin.frames;
      const lift = PARABOLA_PEAK_SCALE * t * (1 - t) * coin.arcHeight;
      const x = coin.startX + (coin.endX - coin.startX) * t - camX;
      const y = coin.startY + (coin.endY - coin.startY) * t - lift - camY;
      const spin = (coin.elapsed / FRAMES_PER_SECOND) * COIN_SPIN_TURNS_PER_SECOND;
      drawThrownCoin(ctx, x, y, TILE_SIZE, spin);
    }
    const dancer = CLUB_DANCER_TILES[this.barkingDancer];
    drawTimedSpeechBubble(
      ctx,
      this.bark,
      (dancer.x + TILE_CENTRE) * TILE_SIZE - camX,
      (dancer.y + DANCER_HEAD_Y_IN_TILE) * TILE_SIZE - camY,
      DANCER_SPEECH_STYLE,
    );
  }
}
