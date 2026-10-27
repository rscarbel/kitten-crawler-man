/**
 * The high striker on the circus grounds, played for fun. A press beside it
 * raises a power meter; a second press locks the power in, and the crawler
 * steps to the side of the pad, takes up the striker's mallet and brings it
 * down. The puck runs up the mast as far as the power sends it — to the bell
 * at the top of the meter — and drops back, and the striker calls the swing.
 * Nothing is won and nothing is gated.
 *
 * The swing is the crawler's own overhead work swing (the human's pick swing, and
 * the cat's), with the striker's mallet put in their hands for it, so the
 * mallet leaning on the striker is drawn live here and left off while it is
 * held. `high_striker_bell` starts on the tick the swing's bite is on screen;
 * a swing short of the bell has the recording cut where its puck peaks (see
 * `highStrikerTimeline.ts`).
 *
 * After the impact everything runs off the audio clock the recording plays
 * on, not off update ticks: it stops when the page is backgrounded or the
 * context interrupted, and so the puck and the lockout stop with the sound.
 * Only a swing heard by nobody (no audio, or a context not running) runs off
 * the wall clock instead.
 */

import type { AudioManager } from '../../audio/AudioManager';
import {
  allocCanvas,
  releaseSurface,
  surfaceContext,
  type CanvasSurface,
} from '../../core/rendering/canvasSurface';
import { onCanvasRecovery } from '../../core/rendering/canvasRecovery';
import { TILE_SIZE } from '../../core/constants';
import { MILLISECONDS_PER_SECOND } from '../../core/spriteAssets/SpriteRenderer';
import type { WorkingTool } from '../../core/items/gathering/toolTiers';
import type { CatPlayer } from '../../creatures/CatPlayer';
import { HumanPlayer } from '../../creatures/HumanPlayer';
import type { GameMap } from '../../map/GameMap';
import {
  CIRCUS_KEEP_CLEAR_BANDS,
  CIRCUS_STRUCTURES,
  CIRCUS_TERRAIN_CLEARANCE_TILES,
  keepClearBandTiles,
  type CircusGroundsSite,
} from '../../map/overworld/circusGroundsLayout';
import type { TilePoint } from '../../map/town/townPlan';
import {
  CIRCUS_STRUCTURE_ART,
  CIRCUS_TILE_SCALE,
  paintHighStrikerMallet,
  paintHighStrikerPuck,
  type CircusFrame,
} from '../../sprites/art/circusArt';
import { HIGH_STRIKER_BELL, HIGH_STRIKER_PUCK } from '../../sprites/art/circusOverlayAnchors';
import { MINE_IMPACT_FRAME } from '../../sprites/art/human/actionsGather';
import { TICKS_PER_SECOND } from '../../sprites/art/human/timing';
import { MINE_ROWS, eventFrame } from '../../sprites/art/humanFigure';
import { rgba } from '../../sprites/art/town/townArt';
import { getCircusRamp } from '../../sprites/art/town/townPalette';
import {
  CAT_WORK_SWING_DURATION_TICKS,
  CAT_WORK_SWING_IMPACT_TICKS,
} from '../../sprites/catSprite';
import { drawRadialGlow, type GlowStop } from '../../sprites/radialGlow';
import { drawInteractionPrompt } from '../../ui/InteractionPrompt';
import { STRIKER_METER_LOOK, worldPalette } from '../../ui/theme/worldInk';
import { worldBar, worldPlate } from '../../ui/world/worldShapes';
import { worldText } from '../../ui/world/worldText';
import type { TownPropRenderable } from '../townPropRenderable';
import {
  HIGH_STRIKER_CUT_FADE_S,
  HIGH_STRIKER_RING_THRESHOLD,
  highStrikerBellGlow,
  highStrikerCutAtS,
  highStrikerCycleS,
  highStrikerMeterPower,
  highStrikerPeakAtS,
  highStrikerPuckRattleTiles,
  highStrikerPuckUp,
  highStrikerRings,
  highStrikerVerdict,
} from './highStrikerTimeline';

type Ctx = CanvasRenderingContext2D;
type Crawler = HumanPlayer | CatPlayer;

// ── The bell's light ──────────────────────────────────────────────────────────

/** The bell's halo and its hot core, in tiles. */
const BELL_HALO_RADIUS_TILES = 1.1;
const BELL_CORE_RADIUS_TILES = 0.32;
const BELL_HALO_ALPHA = 0.55;
/** The halo's warm shoulder: its offset out and its alpha there. */
const BELL_HALO_SHOULDER = { offset: 0.35, alpha: 0.4 } as const;

const LIMELIGHT = getCircusRamp('circus_limelight');
const BRASS = getCircusRamp('circus_brass');
const BELL_HALO_STOPS: ReadonlyArray<GlowStop> = [
  { offset: 0, color: rgba(LIMELIGHT.light, 1) },
  { offset: BELL_HALO_SHOULDER.offset, color: rgba(LIMELIGHT.mid, BELL_HALO_SHOULDER.alpha) },
  { offset: 1, color: rgba(LIMELIGHT.shadow, 0) },
];
const BELL_CORE_STOPS: ReadonlyArray<GlowStop> = [
  { offset: 0, color: rgba(BRASS.accent, 1) },
  { offset: 1, color: rgba(BRASS.light, 0) },
];

// ── The meter ─────────────────────────────────────────────────────────────────

/** One of the game's fixed update steps, in seconds: what the meter's sweep is paced by. */
const UPDATE_STEP_S = 1 / TICKS_PER_SECOND;
/** A meter nobody locks in is put away after this long. */
const METER_TIMEOUT_S = 8;
/**
 * A press this soon after the meter appears is swallowed rather than taken
 * as the lock-in: a held or bounced key would otherwise lock it at nothing.
 */
const METER_MIN_LOCK_S = 0.15;
/**
 * The meter stands beside the mast, on the side away from the crawler: its
 * centre's offset from the mast, clear of the base, its height and its foot.
 */
const METER_OFFSET_TILES = 0.7;
const METER_HEIGHT_TILES = 1.7;
const METER_FOOT_UP_TILES = 0.45;
const QUARTER_TURN = Math.PI / 2;
const FULL_TURN = Math.PI * 2;
/** A sine's swing, halved: `HALF + HALF * sin` runs 0 to 1. */
const HALF = 1 / 2;

/** Where a meter stands, in world pixels: its centre line, its foot, the top of its bar and the top of its lamp. */
interface MeterPlace {
  readonly centreX: number;
  readonly foot: number;
  readonly barTop: number;
  readonly lampTop: number;
}

function meterPlace(striker: Striker, meter: Meter): MeterPlace {
  const foot = striker.ground - METER_FOOT_UP_TILES * TILE_SIZE;
  const barTop = foot - METER_HEIGHT_TILES * TILE_SIZE;
  return {
    centreX: striker.centreX + meter.side * METER_OFFSET_TILES * TILE_SIZE,
    foot,
    barTop,
    lampTop: barTop - STRIKER_METER_LOOK.capGapPx - STRIKER_METER_LOOK.capSizePx,
  };
}

// ── The verdict ───────────────────────────────────────────────────────────────

/** The striker's verdict hangs beside the puck's peak this long, rising and fading. */
const VERDICT_S = 1.4;
const VERDICT_RISE_TILES = 0.4;
/** The share of its life over which the verdict fades out, at the end. */
const VERDICT_FADE_SHARE = 0.4;
/** It is called above the puck's peak, or above the bell when it rang. */
const VERDICT_ABOVE_PEAK_TILES = 0.3;
const VERDICT_ABOVE_BELL_TILES = 0.35;

// ── The live parts' pictures ──────────────────────────────────────────────────

const STRIKER_SPEC = CIRCUS_STRUCTURES.high_striker;
const FRAME_WIDTH_TILES = STRIKER_SPEC.w;
const FRAME_HEIGHT_TILES = STRIKER_SPEC.h + CIRCUS_STRUCTURE_ART.high_striker.headroomTiles;

/** The frame the striker's sheet row is painted in, so the live parts land on its baked art. */
function strikerFrame(): CircusFrame {
  const ts = CIRCUS_TILE_SCALE;
  return {
    originX: STRIKER_SPEC.drawTile.dx * ts,
    originY: (FRAME_HEIGHT_TILES - (STRIKER_SPEC.h - STRIKER_SPEC.drawTile.dy)) * ts,
    tileScale: ts,
  };
}

function paintedFrame(paint: (ctx: Ctx, frame: CircusFrame) => void): CanvasSurface {
  const surface = allocCanvas(
    'circus',
    FRAME_WIDTH_TILES * CIRCUS_TILE_SCALE,
    FRAME_HEIGHT_TILES * CIRCUS_TILE_SCALE,
  );
  paint(surfaceContext(surface), strikerFrame());
  return surface;
}

interface LiveParts {
  readonly mallet: CanvasSurface;
  readonly puck: CanvasSurface;
}

let liveParts: LiveParts | null = null;
// Painted once and shared by every striker; a purge would leave them blank.
onCanvasRecovery(() => {
  if (liveParts !== null) {
    releaseSurface(liveParts.mallet);
    releaseSurface(liveParts.puck);
  }
  liveParts = null;
});

function strikerLiveParts(): LiveParts {
  liveParts ??= {
    mallet: paintedFrame(paintHighStrikerMallet),
    puck: paintedFrame(paintHighStrikerPuck),
  };
  return liveParts;
}

// ── Play ──────────────────────────────────────────────────────────────────────

/** How close (crawler's tile centre to the striker's) a crawler must stand to play: any adjacent tile. */
const INTERACT_RADIUS_TILES = 1.6;
const INTERACT_RADIUS_PX = INTERACT_RADIUS_TILES * TILE_SIZE;
const TILE_MIDDLE = 1 / 2;
/** Beyond its footprint, how far the striker's live parts reach in tiles: the mast's height. */
const CULL_REACH_TILES = FRAME_HEIGHT_TILES;
const PLAY_PROMPT = 'Swing';
const LOCK_PROMPT = 'Strike';
/** The striking spots either side of the pad: a crawler there swings side-on, so the blow lands on it. */
const STRIKING_SIDES = [-1, 1] as const;

const STRIKER_MALLET_TOOL: WorkingTool = { kind: 'striker_mallet', tier: 0 };

const NEIGHBOUR_STEPS: ReadonlyArray<TilePoint> = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/**
 * Whether a crawler on `from` could walk to the forecourt in front of the
 * Starlight Tent without leaving the grounds and their clearance band. A tile
 * merely walkable can be a pocket — a ledge shut in by the terrain or the rim's
 * own props — and a crawler set down in one has no way out. Steps are
 * four-way because a crawler's collision is tested a step per axis, so two
 * blocked tiles touching corners are a wall to them.
 */
export function walksToForecourt(
  gameMap: GameMap,
  site: CircusGroundsSite,
  from: TilePoint,
): boolean {
  if (!gameMap.isWalkable(from.x, from.y)) return false;
  const reachTiles = site.radiusTiles + CIRCUS_TERRAIN_CLEARANCE_TILES;
  const rowWidth = gameMap.structure[0]?.length ?? 0;
  const keyOf = (tile: TilePoint): number => tile.y * rowWidth + tile.x;
  const forecourt = new Set(
    keepClearBandTiles(CIRCUS_KEEP_CLEAR_BANDS.forecourt, site.centre).map(keyOf),
  );
  const seen = new Set<number>([keyOf(from)]);
  const frontier: TilePoint[] = [from];
  for (let tile = frontier.pop(); tile !== undefined; tile = frontier.pop()) {
    if (forecourt.has(keyOf(tile))) return true;
    for (const step of NEIGHBOUR_STEPS) {
      const next = { x: tile.x + step.x, y: tile.y + step.y };
      const key = keyOf(next);
      if (seen.has(key)) continue;
      const withinGrounds =
        Math.hypot(next.x - site.centre.x, next.y - site.centre.y) <= reachTiles;
      if (!withinGrounds || !gameMap.isWalkable(next.x, next.y)) continue;
      seen.add(key);
      frontier.push(next);
    }
  }
  return false;
}

/** Seconds on a clock that keeps running whatever the world does. */
export type HighStrikerClock = () => number;

const wallClockSeconds: HighStrikerClock = () => performance.now() / MILLISECONDS_PER_SECOND;

/** A meter up beside a striker, waiting on its crawler's lock-in press. */
interface Meter {
  readonly crawler: Crawler;
  /** Seconds it has swept, counted in the world's own update steps. */
  seconds: number;
  /** Which side of the mast it stands: -1 west, 1 east. */
  readonly side: -1 | 1;
}

/** One swing's aftermath: its power, and when its impact landed on the clock it is timed by. */
interface Cycle {
  readonly power: number;
  readonly startedAt: number;
  /** Timed off the audio clock its recording plays on, or off the wall clock when nothing is heard. */
  readonly onAudioClock: boolean;
}

interface Striker {
  /** World pixels: the footprint's west edge and the tile row it sorts on. */
  readonly left: number;
  readonly sortY: number;
  /** World y of the top of the live parts' frame, and of the ground line. */
  readonly frameTop: number;
  readonly ground: number;
  readonly centreX: number;
  readonly centreY: number;
  readonly tileX: number;
  readonly tileY: number;
  meter: Meter | null;
  /** The power the swing in hand was locked at. */
  power: number;
  /** Who has the mallet in hand, if anyone: it is not drawn on the striker meanwhile. */
  holder: Crawler | null;
  /** A swing is on its way down and has not yet struck. */
  strikePending: boolean;
  /** The human crawler's swing row is this striker's, so abandoning it stops only that. */
  humanSwinging: boolean;
  /** Ticks into the cat's swing, which the system paces itself; null when she is not swinging. */
  catSwingTicks: number | null;
  cycle: Cycle | null;
}

export interface HighStrikerOptions {
  readonly audio: AudioManager | null;
  /** The wall clock a swing nobody hears is timed by; `performance.now` unless a harness pins it. */
  readonly clock?: HighStrikerClock;
}

export class HighStrikerSystem {
  private readonly audio: AudioManager | null;
  private readonly wallClock: HighStrikerClock;
  private site: CircusGroundsSite | null = null;
  private gameMap: GameMap | null = null;
  private strikers: Striker[] = [];
  private readonly renderables: TownPropRenderable[] = [];

  constructor(options: HighStrikerOptions) {
    this.audio = options.audio;
    this.wallClock = options.clock ?? wallClockSeconds;
  }

  /**
   * Picks up the grounds on `gameMap`, sweeps any meter and paces the cat's
   * swing. `worldHalted` is whether the world is stopped under an overlay
   * this tick, as her own animation is; the meter waits with it.
   */
  update(gameMap: GameMap, worldHalted: boolean): void {
    this.gameMap = gameMap;
    const site = gameMap.circusGrounds;
    if (site !== this.site) this.rebuild(site);
    if (worldHalted) return;
    for (const striker of this.strikers) {
      this.sweepMeter(striker);
      this.paceCatSwing(striker);
    }
  }

  /**
   * Takes a press from `active` that belongs to a striker they are already
   * playing — the lock-in on their meter, or any press while their swing is
   * still on its way down — ahead of everything else a press can reach, a
   * swing at a monster included. Returns whether it took it.
   */
  claimPress(active: Crawler): boolean {
    for (const striker of this.strikers) {
      const meter = striker.meter;
      if (meter !== null && meter.crawler === active) {
        if (meter.seconds >= METER_MIN_LOCK_S) this.lockIn(striker, meter);
        return true;
      }
      if (striker.holder === active && striker.strikePending) return true;
    }
    return false;
  }

  /** Whether a press from `active` would raise a striker's meter right now. */
  wouldInteract(active: Crawler): boolean {
    return this.strikerInReach(active) !== null;
  }

  /** Raises the meter of the striker beside `active`, if one is in reach and quiet. Returns whether the press was used. */
  tryInteract(active: Crawler): boolean {
    const striker = this.strikerInReach(active);
    if (striker === null) return false;
    const crawlerX = active.x + TILE_SIZE * TILE_MIDDLE;
    striker.meter = { crawler: active, seconds: 0, side: crawlerX < striker.centreX ? 1 : -1 };
    return true;
  }

  /**
   * Floats the lock-in prompt over the striker whose meter `active` has up.
   * Returns whether it drew. Drawn ahead of every other prompt and every
   * check that withholds prompts, because {@link claimPress} takes the press
   * ahead of all of them.
   */
  renderLockPrompt(ctx: Ctx, camX: number, camY: number, active: Crawler): boolean {
    const metering = this.strikers.find((striker) => striker.meter?.crawler === active);
    const meter = metering?.meter;
    if (metering === undefined || meter === null || meter === undefined) return false;
    // Anchored on the meter's lamp: the pill is raised above its anchor at any
    // UI scale, so it can never cover the meter it is asking the player to read.
    const place = meterPlace(metering, meter);
    drawInteractionPrompt(
      ctx,
      place.centreX - STRIKER_METER_LOOK.widthPx / 2 - camX,
      place.lampTop - camY,
      STRIKER_METER_LOOK.widthPx,
      place.foot - camY,
      LOCK_PROMPT,
    );
    return true;
  }

  /** Floats the prompt over the quiet striker a press would raise the meter on. Returns whether it drew. */
  renderPrompt(ctx: Ctx, camX: number, camY: number, active: Crawler): boolean {
    const striker = this.strikerInReach(active);
    if (striker === null) return false;
    this.drawPrompt(ctx, striker, camX, camY, PLAY_PROMPT);
    return true;
  }

  /** Whether `crawler`'s swing at a striker has yet to land: they are held on the striking spot until it does. */
  holdsCrawler(crawler: Crawler): boolean {
    return this.strikers.some((striker) => striker.holder === crawler && striker.strikePending);
  }

  /** Hung over the top of the striker's frame, which its bell and crest fill: the mast stands far taller than the crawler beside it. */
  private drawPrompt(ctx: Ctx, striker: Striker, camX: number, camY: number, label: string): void {
    drawInteractionPrompt(
      ctx,
      striker.left - camX,
      striker.frameTop - camY,
      FRAME_WIDTH_TILES * TILE_SIZE,
      striker.ground - camY,
      label,
    );
  }

  /** The live parts, merged into the scene's Y-sorted entity pass over the baked striker. */
  renderEntities(): ReadonlyArray<TownPropRenderable> {
    return this.renderables;
  }

  /** The meter and the striker's verdict, over every body. */
  renderAbove(ctx: Ctx, camX: number, camY: number): void {
    for (const striker of this.strikers) {
      this.drawMeter(ctx, striker, camX, camY);
      this.drawVerdict(ctx, striker, camX, camY);
    }
  }

  /** Clock seconds of the most recent impact on any striker, or null before the first. */
  latestImpactAt(): number | null {
    let latest: number | null = null;
    for (const striker of this.strikers) {
      const startedAt = striker.cycle?.startedAt;
      if (startedAt !== undefined && (latest === null || startedAt > latest)) latest = startedAt;
    }
    return latest;
  }

  /** Drops every meter and every swing not yet landed, with nothing struck: a defeat or a rewind. */
  abandonAll(): void {
    for (const striker of this.strikers) this.abandon(striker);
  }

  dispose(): void {
    this.abandonAll();
    this.strikers = [];
    this.renderables.length = 0;
    this.site = null;
  }

  private rebuild(site: CircusGroundsSite | null): void {
    for (const striker of this.strikers) this.abandon(striker);
    this.site = site;
    this.strikers = (site?.structures ?? [])
      .filter((placed) => placed.structure === 'high_striker')
      .map((placed) => {
        const ground = (placed.rect.y + placed.rect.h) * TILE_SIZE;
        const tileX = placed.rect.x + STRIKER_SPEC.drawTile.dx;
        const tileY = placed.rect.y + STRIKER_SPEC.drawTile.dy;
        return {
          left: placed.rect.x * TILE_SIZE,
          sortY: tileY * TILE_SIZE,
          frameTop: ground - FRAME_HEIGHT_TILES * TILE_SIZE,
          ground,
          centreX: (tileX + TILE_MIDDLE) * TILE_SIZE,
          centreY: (tileY + TILE_MIDDLE) * TILE_SIZE,
          tileX,
          tileY,
          meter: null,
          power: 0,
          holder: null,
          strikePending: false,
          humanSwinging: false,
          catSwingTicks: null,
          cycle: null,
        };
      });
    this.renderables.length = 0;
    for (const striker of this.strikers) {
      this.renderables.push({
        x: striker.left,
        y: striker.sortY,
        cullMarginTiles: CULL_REACH_TILES,
        render: (ctx, camX, camY) => this.draw(ctx, striker, camX, camY),
      });
    }
  }

  /**
   * Drops whatever a striker was in the middle of, with nothing struck: its
   * meter, and a swing still on its way down, stopped so a closure the swing
   * still holds can never ring this striker later.
   */
  private abandon(striker: Striker): void {
    striker.meter = null;
    striker.strikePending = false;
    const holder = striker.holder;
    if (striker.humanSwinging && holder instanceof HumanPlayer) holder.stopAction();
    striker.humanSwinging = false;
    this.putMalletBack(striker);
  }

  private strikerInReach(active: Crawler): Striker | null {
    if (!active.isAlive || active.isKnockedOut) return null;
    let nearest: Striker | null = null;
    let nearestDistance = INTERACT_RADIUS_PX;
    for (const striker of this.strikers) {
      if (this.isBusy(striker)) continue;
      const distance = this.distanceTo(striker, active);
      if (distance > nearestDistance) continue;
      nearest = striker;
      nearestDistance = distance;
    }
    return nearest;
  }

  private distanceTo(striker: Striker, crawler: Crawler): number {
    return Math.hypot(
      striker.centreX - (crawler.x + TILE_SIZE * TILE_MIDDLE),
      striker.centreY - (crawler.y + TILE_SIZE * TILE_MIDDLE),
    );
  }

  /**
   * In use: a meter is up, the mallet is out, a blow is on its way, or the
   * last one's cycle is not over — and its verdict not yet gone, because the
   * prompt a quiet striker floats would stand where the verdict hangs.
   */
  private isBusy(striker: Striker): boolean {
    if (striker.meter !== null || striker.holder !== null || striker.strikePending) return true;
    const cycle = striker.cycle;
    if (cycle === null) return false;
    const verdictGoneAt = highStrikerPeakAtS(cycle.power) + VERDICT_S;
    return this.secondsSince(cycle) < Math.max(highStrikerCycleS(cycle.power), verdictGoneAt);
  }

  private secondsSince(cycle: Cycle): number {
    const now =
      cycle.onAudioClock && this.audio !== null ? this.audio.clockSeconds : this.wallClock();
    return now - cycle.startedAt;
  }

  /** Puts a meter away quietly once its crawler walks off, goes down, is switched away from or never presses. */
  private sweepMeter(striker: Striker): void {
    const meter = striker.meter;
    if (meter === null) return;
    meter.seconds += UPDATE_STEP_S;
    const crawler = meter.crawler;
    const walkedOff = this.distanceTo(striker, crawler) > INTERACT_RADIUS_PX;
    const outOfPlay = !crawler.isActive || !crawler.isAlive || crawler.isKnockedOut;
    if (walkedOff || outOfPlay || meter.seconds > METER_TIMEOUT_S) striker.meter = null;
  }

  private lockIn(striker: Striker, meter: Meter): void {
    striker.meter = null;
    striker.power = highStrikerMeterPower(meter.seconds);
    const swinger = meter.crawler;
    this.stepToStrikingSpot(striker, swinger);
    striker.strikePending = true;
    striker.holder = swinger;
    swinger.setWorkingTool(STRIKER_MALLET_TOOL);
    if (swinger instanceof HumanPlayer) {
      this.swingAsHuman(striker, swinger);
      return;
    }
    striker.catSwingTicks = 0;
    swinger.playWorkSwing();
  }

  /**
   * Puts the swinger side-on to the pad on whichever side of it is nearer and
   * open, facing it: the swing comes down ahead of them, and from the side
   * that is onto the pad, where from the south it would be at their feet. A
   * striking spot is only taken when it is open ground joined to the rest of
   * the grounds, so they walk off it as from anywhere. With neither side
   * open they swing from where they stand, which they walked to.
   */
  private stepToStrikingSpot(striker: Striker, swinger: Crawler): void {
    const gameMap = this.gameMap;
    const site = this.site;
    const spots = STRIKING_SIDES.map((side) => ({
      side,
      x: striker.tileX + side,
      y: striker.tileY,
    }))
      .filter((spot) => gameMap !== null && site !== null && walksToForecourt(gameMap, site, spot))
      .map((spot) => ({
        ...spot,
        distance: Math.hypot(spot.x * TILE_SIZE - swinger.x, spot.y * TILE_SIZE - swinger.y),
      }))
      .sort((a, b) => a.distance - b.distance);
    const spot = spots.length > 0 ? spots[0] : null;
    if (spot === null) {
      this.faceStriker(striker, swinger);
      return;
    }
    swinger.placeAt(spot.x * TILE_SIZE, spot.y * TILE_SIZE);
    swinger.facingX = -spot.side;
    swinger.facingY = 0;
  }

  private faceStriker(striker: Striker, swinger: Crawler): void {
    const dx = striker.centreX - (swinger.x + TILE_SIZE * TILE_MIDDLE);
    const dy = striker.centreY - (swinger.y + TILE_SIZE * TILE_MIDDLE);
    const length = Math.hypot(dx, dy);
    if (length === 0) return;
    swinger.facingX = dx / length;
    swinger.facingY = dy / length;
  }

  /**
   * His pick swing, the recording starting on its impact frame. As with every
   * gesture, a swing he cannot play, or one cut short, still strikes — the
   * press is never lost to the picture — unless he went down part-way, or
   * was knocked out of it.
   */
  private swingAsHuman(striker: Striker, human: HumanPlayer): void {
    const row = human.rowFacing(MINE_ROWS);
    const accepted = human.playAction(row, {
      faceX: human.facingX,
      faceY: human.facingY,
      onFrame: [
        { frame: eventFrame(row, 'impact') ?? MINE_IMPACT_FRAME, run: () => this.strike(striker) },
      ],
      onEnd: (reason) => {
        striker.humanSwinging = false;
        const wentDown = reason === 'defeated' || human.isKnockedOut || !human.isAlive;
        if (wentDown) striker.strikePending = false;
        else this.strike(striker);
        this.putMalletBack(striker);
      },
    });
    striker.humanSwinging = accepted;
    if (accepted) return;
    this.putMalletBack(striker);
    this.strike(striker);
  }

  /** The cat's swing has no frame events, so its bite is counted here in her own ticks. */
  private paceCatSwing(striker: Striker): void {
    const ticks = striker.catSwingTicks;
    const cat = striker.holder;
    if (ticks === null || cat === null) return;
    if (!cat.isAlive || cat.isKnockedOut) {
      striker.strikePending = false;
      this.putMalletBack(striker);
      return;
    }
    const next = ticks + 1;
    striker.catSwingTicks = next;
    if (next >= CAT_WORK_SWING_IMPACT_TICKS) this.strike(striker);
    if (next >= CAT_WORK_SWING_DURATION_TICKS) this.putMalletBack(striker);
  }

  /**
   * The impact: the recording starts now or not at all, cut where the puck
   * peaks if the swing falls short, and the cycle is timed by whichever clock
   * will actually run alongside what is heard.
   */
  private strike(striker: Striker): void {
    if (!striker.strikePending) return;
    striker.strikePending = false;
    const power = striker.power;
    const cutAt = highStrikerCutAtS(power);
    const heardFrom =
      this.audio?.playNow(
        'high_striker_bell',
        cutAt === null ? {} : { fadeOut: { atS: cutAt, durationS: HIGH_STRIKER_CUT_FADE_S } },
      ) ?? null;
    striker.cycle =
      heardFrom === null
        ? { power, startedAt: this.wallClock(), onAudioClock: false }
        : { power, startedAt: heardFrom, onAudioClock: true };
  }

  private putMalletBack(striker: Striker): void {
    striker.holder?.setWorkingTool(null);
    striker.holder = null;
    striker.catSwingTicks = null;
  }

  private draw(ctx: Ctx, striker: Striker, camX: number, camY: number): void {
    const parts = strikerLiveParts();
    const width = FRAME_WIDTH_TILES * TILE_SIZE;
    const height = FRAME_HEIGHT_TILES * TILE_SIZE;
    const x = striker.left - camX;
    const y = striker.frameTop - camY;
    const cycle = striker.cycle;
    const sinceImpact = cycle === null ? null : this.secondsSince(cycle);
    const power = cycle?.power ?? 0;

    const puckUp =
      sinceImpact === null ? HIGH_STRIKER_PUCK.restUp : highStrikerPuckUp(sinceImpact, power);
    const puckLift = (puckUp - HIGH_STRIKER_PUCK.restUp) * TILE_SIZE;
    const rattle =
      sinceImpact === null ? 0 : highStrikerPuckRattleTiles(sinceImpact, power) * TILE_SIZE;
    ctx.drawImage(parts.puck, x + rattle, y - puckLift, width, height);
    if (striker.holder === null) ctx.drawImage(parts.mallet, x, y, width, height);

    const glow = sinceImpact === null ? 0 : highStrikerBellGlow(sinceImpact, power);
    if (glow <= 0) return;
    const bellX = striker.left + HIGH_STRIKER_BELL.x * TILE_SIZE - camX;
    const bellY = striker.ground - HIGH_STRIKER_BELL.up * TILE_SIZE - camY;
    ctx.save();
    try {
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = glow * BELL_HALO_ALPHA;
      drawRadialGlow(ctx, bellX, bellY, BELL_HALO_RADIUS_TILES * TILE_SIZE, BELL_HALO_STOPS);
      ctx.globalAlpha = glow;
      drawRadialGlow(ctx, bellX, bellY, BELL_CORE_RADIUS_TILES * TILE_SIZE, BELL_CORE_STOPS);
    } finally {
      ctx.restore();
    }
  }

  /**
   * An upright bar beside the mast, filling to the sweep's power. The ring
   * zone stands on its track in gold at all times; while the fill is inside
   * it the fill turns hot and pulses with a glow and the lamp on top lights,
   * so the moment to strike reads at a glance.
   */
  private drawMeter(ctx: Ctx, striker: Striker, camX: number, camY: number): void {
    const meter = striker.meter;
    if (meter === null) return;
    const power = highStrikerMeterPower(meter.seconds);
    const hot = highStrikerRings(power);
    const look = STRIKER_METER_LOOK;
    const place = meterPlace(striker, meter);
    const length = place.foot - place.barTop;
    const ringFrom = length * HIGH_STRIKER_RING_THRESHOLD;
    const pulse = HALF + HALF * Math.sin(meter.seconds * look.hotPulseHz * FULL_TURN);
    const glowBlur = look.hotGlowBlurPx * (1 - look.hotPulseDepth + look.hotPulseDepth * pulse);
    ctx.save();
    try {
      // Turned a quarter, a world bar fills upward from the meter's foot.
      ctx.translate(place.centreX - look.widthPx / 2 - camX, place.foot - camY);
      ctx.rotate(-QUARTER_TURN);
      const bar = { x: 0, y: 0, w: length, h: look.widthPx };
      worldBar(ctx, bar, { style: 'strikerMeterTrack', value: 0 });
      worldPlate(
        ctx,
        { x: ringFrom, y: 0, w: length - ringFrom, h: look.widthPx },
        { style: 'strikerRingZone' },
      );
      worldBar(
        ctx,
        bar,
        hot
          ? {
              style: 'strikerMeterHot',
              value: power,
              glow: worldPalette.highStriker.meterHotGlow,
              glowBlur,
            }
          : { style: 'strikerMeterFill', value: power },
      );
      worldPlate(
        ctx,
        {
          x: ringFrom - look.ringLinePx / 2,
          y: -look.ringLineOverhangPx,
          w: look.ringLinePx,
          h: look.widthPx + look.ringLineOverhangPx * 2,
        },
        { style: 'strikerRingLine' },
      );
    } finally {
      ctx.restore();
    }
    worldPlate(
      ctx,
      {
        x: place.centreX - look.capSizePx / 2 - camX,
        y: place.lampTop - camY,
        w: look.capSizePx,
        h: look.capSizePx,
      },
      hot
        ? { style: 'strikerCapOn', glow: worldPalette.highStriker.meterHotGlow, glowBlur }
        : { style: 'strikerCapOff' },
    );
  }

  /** The striker's call on the last swing, beside where its puck peaked, rising and fading. */
  private drawVerdict(ctx: Ctx, striker: Striker, camX: number, camY: number): void {
    const cycle = striker.cycle;
    if (cycle === null) return;
    const shown = this.secondsSince(cycle) - highStrikerPeakAtS(cycle.power);
    if (shown < 0 || shown >= VERDICT_S) return;
    const life = shown / VERDICT_S;
    const fadeFrom = 1 - VERDICT_FADE_SHARE;
    const alpha = life < fadeFrom ? 1 : (1 - life) / VERDICT_FADE_SHARE;
    const rings = highStrikerRings(cycle.power);
    const peakUp = highStrikerPuckUp(highStrikerPeakAtS(cycle.power), cycle.power);
    const anchorUp = rings
      ? HIGH_STRIKER_BELL.up + HIGH_STRIKER_BELL.radius + VERDICT_ABOVE_BELL_TILES
      : peakUp + VERDICT_ABOVE_PEAK_TILES;
    worldText(ctx, highStrikerVerdict(cycle.power), {
      x: striker.centreX - camX,
      y: striker.ground - (anchorUp + VERDICT_RISE_TILES * life) * TILE_SIZE - camY,
      style: rings ? 'strikerRatingTop' : 'strikerRating',
      align: 'center',
      baseline: 'alphabetic',
      alpha,
    });
  }
}
