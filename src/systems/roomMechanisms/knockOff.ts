/**
 * The verb "knock off": a cat bats a small thing off a ledge or a shelf top,
 * and it tips, flies in an arc with a spin and comes down. Which props can be
 * knocked off, where each is sent and what its landing does are data: the
 * prop's `knock_off` interaction and its placed `KnockOffPlacement`.
 *
 * A long thing is pushed over instead: it rocks off what it leans on, pivots
 * on its foot and slams down flat where it stood, and a hole its length now
 * lies across can be crossed on it, on exactly the tiles it covers.
 *
 * Where a small thing lands is found by flying it: from its tile toward its target until
 * something tall enough to stop a lob is next, and it comes down short of
 * that. What the landing does is then asked of the tile it came down on —
 * the plate or the conveyor end actually there — never of the tile it was
 * aimed at.
 */

import type { SoundId } from '../../audio/sounds';
import { TILE_SIZE } from '../../core/constants';
import { canPerform } from '../../core/party/interactionPerformer';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { GameMap, PlacedTownInteriorProp } from '../../map/GameMap';
import type { GridStep, LobbedKnockOff, ToppledKnockOff } from '../../map/interiorMechanisms';
import { FLOOR_DROP, FLOOR_DROP_SPANNED } from '../../map/tileTypes';
import type { Footing } from '../../map/mobility';
import { tileFooting } from '../../map/walkability';
import type { TilePoint } from '../../map/town/townPlan';
import {
  TOWN_INTERIOR_PROPS,
  drawTownInteriorProp,
  type ToppledPropPainter,
} from '../../sprites/art/townInterior/townInteriorProps';
import { drawInteractionPrompt } from '../../ui/InteractionPrompt';
import type { ConveyorSystem } from './conveyors';
import type { PlateWeight } from './pressurePlates';

type Crawler = HumanPlayer | CatPlayer;

/** How far, in tiles from the cat's centre to the prop's tile centre, a paw reaches. */
const KNOCK_REACH_TILES = 1.3;
/** Frames from the start of her bat to the frame her paw meets the thing. */
const PAW_CONTACT_FRAMES = 10;
/** Frames the thing rocks on the edge before it goes over. */
const TIP_FRAMES = 10;
/** How far it leans over the edge while it tips, in radians. */
const TIP_LEAN_RADIANS = 0.5;
/** Frames of flight per tile it travels, and the shortest flight. */
const FLIGHT_FRAMES_PER_TILE = 7;
const MIN_FLIGHT_FRAMES = 14;
/** How high the arc rises above the floor at its top, as a share of a tile. */
const ARC_PEAK_TILES = 0.6;
const ARC_PEAK_PX = TILE_SIZE * ARC_PEAK_TILES;
/** Turns it spins through over its flight. */
const FLIGHT_SPIN_TURNS = 1.25;
/** The angle it comes to rest at, lying on its side. */
const REST_ANGLE_RADIANS = Math.PI / 2;
/** Frames a toppled thing takes to fall from upright to slamming flat, gathering speed as it goes. */
const TOPPLE_FALL_FRAMES = 24;
/** Frames it rebounds off the floor and settles after the slam, and how far back up it comes, as a share of the fall. */
const TOPPLE_BOUNCE_FRAMES = 10;
const TOPPLE_BOUNCE_SHARE = 0.05;
/** How far over it has come off what it leaned on by the end of its rocking, as a share of the fall. */
const TOPPLE_ROCK_SHARE = 0.04;
const FLAT = 1;
const SHADOW_ALPHA = 0.3;
const SHADOW_RADIUS_X = 0.3;
const SHADOW_RADIUS_Y = 0.12;
const SHADOW_COLOUR = '#000000';
const TILE_CENTRE = 0.5;
const HALF = 0.5;
const TAU = Math.PI * 2;

type KnockPhase =
  | { readonly kind: 'standing' }
  | { readonly kind: 'batted'; framesLeft: number }
  | { readonly kind: 'tipping'; framesLeft: number }
  | { readonly kind: 'flying'; readonly to: TilePoint; frame: number; readonly frames: number }
  | { readonly kind: 'toppling'; frame: number; landed: boolean }
  | { readonly kind: 'lying'; readonly at: TilePoint }
  | { readonly kind: 'fallen' }
  | { readonly kind: 'gone' };

/** How a knockable goes down, with what its placement and its prop say about that. */
type KnockMotion =
  | { readonly kind: 'lobbed'; readonly placement: LobbedKnockOff }
  | {
      readonly kind: 'toppled';
      readonly placement: ToppledKnockOff;
      readonly paint: ToppledPropPainter;
    };

interface Knockable {
  readonly placed: PlacedTownInteriorProp;
  readonly motion: KnockMotion;
  /**
   * What the thing stands on, from its tile's own type: the prop blocks its
   * tile outright, so the map's footing there no longer says it is a ledge.
   */
  readonly sitsOn: Footing;
  phase: KnockPhase;
}

export interface KnockOffSystemOptions {
  readonly map: GameMap;
  /** Breaks the prop where it came down; false leaves it lying there whole. */
  readonly shatter: (placed: PlacedTownInteriorProp, at: TilePoint) => boolean;
  readonly conveyors: ConveyorSystem;
  readonly playSound: (cue: SoundId, at: { readonly x: number; readonly y: number }) => void;
}

function tileCentrePx(tile: TilePoint): { x: number; y: number } {
  return { x: (tile.x + TILE_CENTRE) * TILE_SIZE, y: (tile.y + TILE_CENTRE) * TILE_SIZE };
}

/** How far over a toppling thing is `frame` frames into its fall: gathering speed to the slam, then a small rebound. */
function toppledShare(frame: number): number {
  if (frame < TOPPLE_FALL_FRAMES) {
    const share = frame / TOPPLE_FALL_FRAMES;
    return share * share;
  }
  const settle = Math.min(1, (frame - TOPPLE_FALL_FRAMES) / TOPPLE_BOUNCE_FRAMES);
  return FLAT - TOPPLE_BOUNCE_SHARE * Math.sin(Math.PI * settle);
}

function motionOf(placed: PlacedTownInteriorProp): KnockMotion | null {
  const placement = placed.knockOff;
  if (placement === null) return null;
  if (placement.motion === 'lobbed') return { kind: 'lobbed', placement };
  const interaction = TOWN_INTERIOR_PROPS[placed.propId].interaction;
  if (interaction?.kind !== 'knock_off' || interaction.motion.kind !== 'toppled') {
    throw new Error(`${placed.id} is placed to topple, but its prop cannot be drawn toppling`);
  }
  return { kind: 'toppled', placement, paint: interaction.motion.paint };
}

function sign(value: number): GridStep {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

/** Every knockable prop on one map and whatever has been knocked off so far. */
export class KnockOffSystem {
  private readonly knockables: Knockable[] = [];
  private readonly options: KnockOffSystemOptions;
  /** The knockable whose row was last warmed, so it is warmed once per approach. */
  private cuedFor: Knockable | null = null;

  constructor(options: KnockOffSystemOptions) {
    this.options = options;
    for (const placed of options.map.placedInteriorProps) {
      const motion = motionOf(placed);
      if (motion === null) continue;
      const sitsOn = tileFooting(options.map.structure[placed.tile.y][placed.tile.x]);
      this.knockables.push({ placed, motion, sitsOn, phase: { kind: 'standing' } });
    }
  }

  get isEmpty(): boolean {
    return this.knockables.length === 0;
  }

  /** Ids of every knockable no longer standing where it was placed, for the room's own prop pass to skip. */
  hiddenIds(): ReadonlySet<string> {
    const hidden = new Set<string>();
    for (const knockable of this.knockables) {
      if (knockable.phase.kind !== 'standing') hidden.add(knockable.placed.id);
    }
    return hidden;
  }

  /** Whether the knockable placed as `id` is on the map and still standing where it was placed. */
  isStanding(id: string): boolean {
    return this.knockables.some(
      (knockable) => knockable.placed.id === id && knockable.phase.kind === 'standing',
    );
  }

  /** The things lying where they fell that are heavy enough to hold a plate down. */
  weights(): PlateWeight[] {
    const weights: PlateWeight[] = [];
    for (const knockable of this.knockables) {
      const phase = knockable.phase;
      const motion = knockable.motion;
      if (phase.kind !== 'lying' || motion.kind !== 'lobbed') continue;
      if (motion.placement.landing.kind !== 'pressPlate') continue;
      const at = phase.at;
      weights.push({ occupiesPlate: (tile) => tile.x === at.x && tile.y === at.y });
    }
    return weights;
  }

  private targetFor(crawler: Crawler): Knockable | null {
    if (!crawler.isActive || !crawler.isAlive || crawler.isKnockedOut || !crawler.canAct)
      return null;
    if (crawler.isCrossingFooting) return null;
    const centreX = crawler.x / TILE_SIZE + TILE_CENTRE;
    const centreY = crawler.y / TILE_SIZE + TILE_CENTRE;
    const standsOn = this.options.map.footingAt(Math.floor(centreX), Math.floor(centreY));
    let best: Knockable | null = null;
    let bestDistance = KNOCK_REACH_TILES;
    for (const knockable of this.knockables) {
      if (knockable.phase.kind !== 'standing') continue;
      const interaction = TOWN_INTERIOR_PROPS[knockable.placed.propId].interaction;
      if (interaction?.kind !== 'knock_off' || !canPerform(interaction.performer, crawler))
        continue;
      // A thing up on a shelf top is reached from the shelf top, not batted from the floor below it.
      if (knockable.sitsOn === 'ledge' && standsOn !== 'ledge') continue;
      const tile = knockable.placed.tile;
      const distance = Math.hypot(tile.x + TILE_CENTRE - centreX, tile.y + TILE_CENTRE - centreY);
      if (distance > bestDistance) continue;
      best = knockable;
      bestDistance = distance;
    }
    return best;
  }

  wouldInteract(crawler: Crawler): boolean {
    return this.targetFor(crawler) !== null;
  }

  /** Warms the paw-bat row once as a knockable comes into her reach, so the bat plays at once. */
  cue(crawler: Crawler): void {
    const target = crawler instanceof CatPlayer ? this.targetFor(crawler) : null;
    if (target !== null && target !== this.cuedFor && crawler instanceof CatPlayer) {
      crawler.cueVerb('paw_bat');
    }
    this.cuedFor = target;
  }

  /** Interact: bats the knockable in reach off its ledge. Returns whether one was batted. */
  tryInteract(crawler: Crawler): boolean {
    const target = this.targetFor(crawler);
    if (target === null) return false;
    const tile = target.placed.tile;
    const faceX = tile.x + TILE_CENTRE - (crawler.x / TILE_SIZE + TILE_CENTRE);
    const faceY = tile.y + TILE_CENTRE - (crawler.y / TILE_SIZE + TILE_CENTRE);
    const length = Math.hypot(faceX, faceY);
    if (length > 0) {
      crawler.facingX = faceX / length;
      crawler.facingY = faceY / length;
    }
    if (crawler instanceof CatPlayer) crawler.playVerb('paw_bat');
    target.phase = { kind: 'batted', framesLeft: PAW_CONTACT_FRAMES };
    return true;
  }

  update(): void {
    for (const knockable of this.knockables) this.advance(knockable);
  }

  private advance(knockable: Knockable): void {
    const phase = knockable.phase;
    switch (phase.kind) {
      case 'standing':
      case 'lying':
      case 'fallen':
      case 'gone':
        return;
      case 'batted':
        phase.framesLeft--;
        if (phase.framesLeft <= 0) knockable.phase = { kind: 'tipping', framesLeft: TIP_FRAMES };
        return;
      case 'tipping': {
        phase.framesLeft--;
        if (phase.framesLeft > 0) return;
        const from = knockable.placed.tile;
        this.options.map.unblockTilePermanently(from.x, from.y);
        const motion = knockable.motion;
        if (motion.kind === 'toppled') {
          knockable.phase = { kind: 'toppling', frame: 0, landed: false };
          return;
        }
        const to = this.flightEnd(from, motion.placement);
        const tiles = Math.hypot(to.x - from.x, to.y - from.y);
        const frames = Math.max(MIN_FLIGHT_FRAMES, Math.round(tiles * FLIGHT_FRAMES_PER_TILE));
        knockable.phase = { kind: 'flying', to, frame: 0, frames };
        return;
      }
      case 'flying': {
        phase.frame++;
        const motion = knockable.motion;
        if (phase.frame >= phase.frames && motion.kind === 'lobbed') {
          this.land(knockable, motion.placement, phase.to);
        }
        return;
      }
      case 'toppling': {
        phase.frame++;
        const motion = knockable.motion;
        if (!phase.landed && phase.frame >= TOPPLE_FALL_FRAMES && motion.kind === 'toppled') {
          phase.landed = true;
          this.slamDown(knockable, motion.placement);
        }
        if (phase.frame >= TOPPLE_FALL_FRAMES + TOPPLE_BOUNCE_FRAMES) {
          knockable.phase = { kind: 'fallen' };
        }
        return;
      }
      default: {
        const unreachable: never = phase;
        return unreachable;
      }
    }
  }

  /** Flies the thing from its tile toward its target, one tile at a time, and returns the last tile it clears. */
  private flightEnd(from: TilePoint, placement: LobbedKnockOff): TilePoint {
    const fall = placement.fall;
    const aim =
      fall.kind === 'tile'
        ? fall.tile
        : { x: from.x + fall.dx * fall.reachTiles, y: from.y + fall.dy * fall.reachTiles };
    let current: TilePoint = from;
    while (current.x !== aim.x || current.y !== aim.y) {
      const next = {
        x: current.x + sign(aim.x - current.x),
        y: current.y + sign(aim.y - current.y),
      };
      if (this.options.map.blocksLob(next.x, next.y)) break;
      current = next;
    }
    return current;
  }

  /** Comes down on `at` and does what its landing says, against what is actually there. */
  private land(knockable: Knockable, placement: LobbedKnockOff, at: TilePoint): void {
    const { landing, landingCue } = placement;
    const options = this.options;
    const centre = tileCentrePx(at);
    options.playSound(landingCue, centre);
    switch (landing.kind) {
      case 'pressPlate':
        knockable.phase = { kind: 'lying', at };
        return;
      case 'break': {
        const shattered = options.shatter(knockable.placed, at);
        knockable.phase = shattered ? { kind: 'gone' } : { kind: 'lying', at };
        return;
      }
      case 'deliver': {
        const delivered = options.conveyors.deliverAt(at, landing.item);
        knockable.phase = delivered ? { kind: 'gone' } : { kind: 'lying', at };
        return;
      }
      default: {
        const unreachable: never = landing;
        return unreachable;
      }
    }
  }

  /** The prompt over the knockable in reach. Returns whether it claimed the prompt slot. */
  renderPrompt(
    ctx: CanvasRenderingContext2D,
    camX: number,
    camY: number,
    crawler: Crawler,
  ): boolean {
    const target = this.targetFor(crawler);
    if (target === null) return false;
    const tile = target.placed.tile;
    const left = tile.x * TILE_SIZE - camX;
    const top = tile.y * TILE_SIZE - camY;
    drawInteractionPrompt(ctx, left, top, TILE_SIZE, top + TILE_SIZE, 'to knock it off');
    return true;
  }

  /**
   * The toppled thing hits the floor: every hole tile its length now lies
   * across becomes crossable on it, and nothing else changes.
   */
  private slamDown(knockable: Knockable, placement: ToppledKnockOff): void {
    const from = knockable.placed.tile;
    const { dx, dy } = placement.toward;
    const map = this.options.map;
    const spanned: TilePoint[] = [];
    for (let step = 1; step <= placement.spanTiles; step++) {
      const at = { x: from.x + dx * step, y: from.y + dy * step };
      if (map.structure[at.y]?.[at.x]?.type === FLOOR_DROP) spanned.push(at);
    }
    map.retypeTiles(spanned, FLOOR_DROP_SPANNED);
    const middle = spanned[Math.floor(spanned.length * HALF)] ?? from;
    this.options.playSound(placement.landingCue, tileCentrePx(middle));
  }

  /** Things pushed over and lying flat where they fell, drawn under every body. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const knockable of this.knockables) {
      const motion = knockable.motion;
      if (knockable.phase.kind !== 'fallen' || motion.kind !== 'toppled') continue;
      const { tile, variant } = knockable.placed;
      motion.paint(ctx, tile, variant, motion.placement.toward, FLAT, camX, camY, TILE_SIZE);
    }
  }

  /** Things on their way down and things lying where they fell, in the room's sorted pass. */
  sortedFigures(): InteriorFigure[] {
    const figures: InteriorFigure[] = [];
    for (const knockable of this.knockables) {
      const figure = this.figureFor(knockable);
      if (figure !== null) figures.push(figure);
    }
    return figures;
  }

  private figureFor(knockable: Knockable): InteriorFigure | null {
    const phase = knockable.phase;
    const placed = knockable.placed;
    const motion = knockable.motion;
    if (motion.kind === 'toppled') {
      return this.toppledFigure(knockable, motion.placement, motion.paint);
    }
    const from = tileCentrePx(placed.tile);
    switch (phase.kind) {
      case 'standing':
      case 'gone':
      case 'fallen':
      case 'toppling':
        return null;
      case 'batted':
      case 'tipping': {
        const leanShare = phase.kind === 'tipping' ? 1 - phase.framesLeft / TIP_FRAMES : 0;
        const lean = leanShare * TIP_LEAN_RADIANS * this.leanSide(knockable);
        return {
          y: placed.tile.y * TILE_SIZE,
          render: (ctx, camX, camY) => this.drawAt(ctx, placed, from.x - camX, from.y - camY, lean),
        };
      }
      case 'flying': {
        const t = phase.frame / phase.frames;
        const to = tileCentrePx(phase.to);
        const groundX = from.x + (to.x - from.x) * t;
        const groundY = from.y + (to.y - from.y) * t;
        const height = Math.sin(Math.PI * t) * ARC_PEAK_PX;
        const spin = t * FLIGHT_SPIN_TURNS * TAU * this.leanSide(knockable);
        return {
          y: groundY - TILE_SIZE * TILE_CENTRE,
          render: (ctx, camX, camY) => {
            this.drawShadow(ctx, groundX - camX, groundY - camY);
            this.drawAt(ctx, placed, groundX - camX, groundY - camY - height, spin);
          },
        };
      }
      case 'lying': {
        const at = tileCentrePx(phase.at);
        return {
          y: phase.at.y * TILE_SIZE,
          render: (ctx, camX, camY) =>
            this.drawAt(ctx, placed, at.x - camX, at.y - camY, REST_ANGLE_RADIANS),
        };
      }
      default: {
        const unreachable: never = phase;
        return unreachable;
      }
    }
  }

  /** A pushed-over thing while it rocks off what it leaned on and falls; flat on the floor it is ground paint. */
  private toppledFigure(
    knockable: Knockable,
    placement: ToppledKnockOff,
    paint: ToppledPropPainter,
  ): InteriorFigure | null {
    const phase = knockable.phase;
    const fallen = this.toppledFallen(phase);
    if (fallen === null) return null;
    const { tile, variant } = knockable.placed;
    return {
      y: tile.y * TILE_SIZE,
      render: (ctx, camX, camY, tileSize) =>
        paint(ctx, tile, variant, placement.toward, fallen, camX, camY, tileSize),
    };
  }

  /** How far over a pushed thing is drawn in `phase`, or null while it is drawn elsewhere or not at all. */
  private toppledFallen(phase: KnockPhase): number | null {
    switch (phase.kind) {
      case 'batted':
        return 0;
      case 'tipping':
        return (1 - phase.framesLeft / TIP_FRAMES) * TOPPLE_ROCK_SHARE;
      case 'toppling':
        return TOPPLE_ROCK_SHARE + (FLAT - TOPPLE_ROCK_SHARE) * toppledShare(phase.frame);
      case 'standing':
      case 'flying':
      case 'lying':
      case 'fallen':
      case 'gone':
        return null;
      default: {
        const unreachable: never = phase;
        return unreachable;
      }
    }
  }

  /** Which way it leans and spins: toward where it is sent, west counting as the other way. */
  private leanSide(knockable: Knockable): number {
    const motion = knockable.motion;
    if (motion.kind === 'toppled') return motion.placement.toward.dx < 0 ? -1 : 1;
    const fall = motion.placement.fall;
    const dx = fall.kind === 'tile' ? fall.tile.x - knockable.placed.tile.x : fall.dx;
    return dx < 0 ? -1 : 1;
  }

  private drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number): void {
    ctx.save();
    ctx.globalAlpha = SHADOW_ALPHA;
    ctx.fillStyle = SHADOW_COLOUR;
    ctx.beginPath();
    ctx.ellipse(x, y, TILE_SIZE * SHADOW_RADIUS_X, TILE_SIZE * SHADOW_RADIUS_Y, 0, 0, TAU);
    ctx.fill();
    ctx.restore();
  }

  /** Draws the prop's own art with its footprint's centre at (`x`, `y`) on screen, turned by `angle`. */
  private drawAt(
    ctx: CanvasRenderingContext2D,
    placed: PlacedTownInteriorProp,
    x: number,
    y: number,
    angle: number,
  ): void {
    const { w, h } = TOWN_INTERIOR_PROPS[placed.propId].footprint;
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(angle);
    drawTownInteriorProp(
      ctx,
      placed.propId,
      placed.variant,
      0,
      0,
      w * TILE_SIZE * HALF,
      h * TILE_SIZE * HALF,
      TILE_SIZE,
    );
    ctx.restore();
  }
}
