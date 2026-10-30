/**
 * The verb "knock off": a cat bats a small thing off a ledge or a shelf top,
 * and it tips, flies in an arc with a spin and comes down. Which props can be
 * knocked off, where each is sent and what its landing does are data: the
 * prop's `knock_off` interaction and its placed `KnockOffPlacement`.
 *
 * Where it lands is found by flying it: from its tile toward its target until
 * something tall enough to stop a lob is next, and it comes down short of
 * that. What the landing does is then asked of the tile it came down on —
 * the plate, the conveyor end or the gap actually there — never of the tile
 * it was aimed at.
 */

import type { SoundId } from '../../audio/sounds';
import { TILE_SIZE } from '../../core/constants';
import type { EventBus } from '../../core/EventBus';
import { canPerform } from '../../core/party/interactionPerformer';
import type { InteriorFigure } from '../../core/rendering/InteriorFigure';
import { CatPlayer } from '../../creatures/CatPlayer';
import type { HumanPlayer } from '../../creatures/HumanPlayer';
import type { GameMap, PlacedTownInteriorProp } from '../../map/GameMap';
import type { GridStep, KnockOffPlacement } from '../../map/interiorMechanisms';
import type { Footing } from '../../map/mobility';
import { tileFooting } from '../../map/walkability';
import type { TilePoint } from '../../map/town/townPlan';
import {
  TOWN_INTERIOR_PROPS,
  drawTownInteriorProp,
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
  | { readonly kind: 'lying'; readonly at: TilePoint; readonly flat: boolean }
  | { readonly kind: 'gone' };

interface Knockable {
  readonly placed: PlacedTownInteriorProp;
  readonly knockOff: KnockOffPlacement;
  /**
   * What the thing stands on, from its tile's own type: the prop blocks its
   * tile outright, so the map's footing there no longer says it is a ledge.
   */
  readonly sitsOn: Footing;
  phase: KnockPhase;
}

export interface KnockOffSystemOptions {
  readonly map: GameMap;
  readonly bus: EventBus;
  /** Breaks the prop where it came down; false leaves it lying there whole. */
  readonly shatter: (placed: PlacedTownInteriorProp, at: TilePoint) => boolean;
  readonly conveyors: ConveyorSystem;
  readonly playSound: (cue: SoundId, at: { readonly x: number; readonly y: number }) => void;
}

function tileCentrePx(tile: TilePoint): { x: number; y: number } {
  return { x: (tile.x + TILE_CENTRE) * TILE_SIZE, y: (tile.y + TILE_CENTRE) * TILE_SIZE };
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
      if (placed.knockOff === null) continue;
      const sitsOn = tileFooting(options.map.structure[placed.tile.y][placed.tile.x]);
      this.knockables.push({
        placed,
        knockOff: placed.knockOff,
        sitsOn,
        phase: { kind: 'standing' },
      });
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

  /** The things lying where they fell that are heavy enough to hold a plate down. */
  weights(): PlateWeight[] {
    const weights: PlateWeight[] = [];
    for (const knockable of this.knockables) {
      const phase = knockable.phase;
      if (phase.kind !== 'lying' || knockable.knockOff.landing.kind !== 'pressPlate') continue;
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
        const to = this.flightEnd(knockable);
        const tiles = Math.hypot(to.x - from.x, to.y - from.y);
        const frames = Math.max(MIN_FLIGHT_FRAMES, Math.round(tiles * FLIGHT_FRAMES_PER_TILE));
        knockable.phase = { kind: 'flying', to, frame: 0, frames };
        return;
      }
      case 'flying':
        phase.frame++;
        if (phase.frame >= phase.frames) this.land(knockable, phase.to);
        return;
      default: {
        const unreachable: never = phase;
        return unreachable;
      }
    }
  }

  /** Flies the thing from its tile toward its target, one tile at a time, and returns the last tile it clears. */
  private flightEnd(knockable: Knockable): TilePoint {
    const from = knockable.placed.tile;
    const fall = knockable.knockOff.fall;
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
  private land(knockable: Knockable, at: TilePoint): void {
    const { landing, landingCue } = knockable.knockOff;
    const options = this.options;
    const centre = tileCentrePx(at);
    options.playSound(landingCue, centre);
    switch (landing.kind) {
      case 'pressPlate':
        knockable.phase = { kind: 'lying', at, flat: false };
        return;
      case 'makeNoise':
        knockable.phase = { kind: 'lying', at, flat: false };
        options.bus.emit('worldNoise', {
          x: centre.x,
          y: centre.y,
          radiusTiles: landing.radiusTiles,
          cause: 'knocked_off',
        });
        return;
      case 'break': {
        const shattered = options.shatter(knockable.placed, at);
        knockable.phase = shattered ? { kind: 'gone' } : { kind: 'lying', at, flat: false };
        return;
      }
      case 'bridge': {
        const from = knockable.placed.tile;
        const dx = sign(at.x - from.x);
        const dy = sign(at.y - from.y);
        const span: TilePoint[] = [];
        for (let index = 0; index < landing.spanTiles; index++) {
          span.push({ x: at.x + dx * index, y: at.y + dy * index });
        }
        options.map.retypeTiles(span, landing.floorTileType);
        knockable.phase = { kind: 'lying', at, flat: true };
        return;
      }
      case 'deliver': {
        const delivered = options.conveyors.deliverAt(at, landing.item);
        knockable.phase = delivered ? { kind: 'gone' } : { kind: 'lying', at, flat: false };
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

  /** Things knocked flat across the floor, drawn under every body. */
  renderGround(ctx: CanvasRenderingContext2D, camX: number, camY: number): void {
    for (const knockable of this.knockables) {
      const phase = knockable.phase;
      if (phase.kind !== 'lying' || !phase.flat) continue;
      const centre = tileCentrePx(phase.at);
      this.drawAt(ctx, knockable.placed, centre.x - camX, centre.y - camY, REST_ANGLE_RADIANS);
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
    const from = tileCentrePx(placed.tile);
    switch (phase.kind) {
      case 'standing':
      case 'gone':
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
        if (phase.flat) return null;
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

  /** Which way it leans and spins: toward where it is sent, west counting as the other way. */
  private leanSide(knockable: Knockable): number {
    const fall = knockable.knockOff.fall;
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
